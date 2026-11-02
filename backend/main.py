"""
FastAPI backend for the "Ask me anything" assistant on ravishraheja's portfolio.

Endpoints
  GET  /api/health   -> service + index status
  POST /api/chat     -> {message, history?} -> {reply, sources}

Run locally:
  cd backend
  cp .env.example .env   # fill in your Foundry / Azure OpenAI values
  .venv/bin/uvicorn main:app --reload --port 8000

Set SERVE_FRONTEND=true to also serve the static portfolio from the repo root
at http://localhost:8000/ for local end-to-end testing.
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from llm import AzureChat
from rag import KnowledgeIndex

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("portfolio-bot")

KNOWLEDGE_PATH = Path(os.getenv("KNOWLEDGE_PATH", BASE_DIR / "knowledge" / "profile.md"))
TOP_K = int(os.getenv("RAG_TOP_K", "5"))
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "20"))
SERVE_FRONTEND = os.getenv("SERVE_FRONTEND", "false").lower() in ("1", "true", "yes")
QUESTION_LOG_PATH = Path(os.getenv("QUESTION_LOG", BASE_DIR / "logs" / "questions.jsonl"))
EMBED_CACHE_PATH = KNOWLEDGE_PATH.with_name(".embeddings_cache.json")

_default_origins = "https://ravishraheja.github.io,https://r-ravish.github.io"
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", _default_origins).split(",") if o.strip()
]

llm = AzureChat()
index: KnowledgeIndex | None = None


# ---------------------------------------------------------------------------
# App + lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_: FastAPI):
    global index
    embed_fn = None
    if llm.configured and llm.embedding_deployment:
        embed_fn = llm.embed
        log.info("Embedding deployment '%s' enabled (hybrid retrieval).", llm.embedding_deployment)
    try:
        index = KnowledgeIndex(KNOWLEDGE_PATH, embed=embed_fn,
                               cache_path=EMBED_CACHE_PATH,
                               cache_tag=llm.embedding_deployment)
    except Exception as exc:  # embeddings may fail; fall back to BM25 only
        log.warning("Index build with embeddings failed (%s); falling back to BM25.", exc)
        index = KnowledgeIndex(KNOWLEDGE_PATH, embed=None)
    log.info("Knowledge index ready: %s", index.stats())
    if not llm.configured:
        log.warning("Azure OpenAI not configured; /api/chat will return 503 until it is.")
    yield


app = FastAPI(
    title="Ravish Raheja — Portfolio Assistant API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


# ---------------------------------------------------------------------------
# Simple in-memory rate limit (per client IP, sliding one-minute window)
# ---------------------------------------------------------------------------

_hits: dict[str, deque] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate_limit(request: Request) -> None:
    if RATE_LIMIT_PER_MINUTE <= 0:
        return
    ip = _client_ip(request)
    now = time.monotonic()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= RATE_LIMIT_PER_MINUTE:
        raise HTTPException(
            status_code=429,
            detail="Too many messages in a short time. Please wait a minute and try again.",
        )
    q.append(now)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=2000)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=1000)
    history: list[Turn] = Field(default_factory=list, max_length=12)

    @field_validator("message")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("message must not be blank")
        return v


class ChatResponse(BaseModel):
    reply: str
    sources: list[str]


# ---------------------------------------------------------------------------
# Question log (what visitors actually ask -> what to add to the profile next)
# ---------------------------------------------------------------------------

def _log_question(question: str, sources: list[str], latency_ms: float | None,
                  ok: bool | None, mode: str) -> None:
    try:
        QUESTION_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "question": question,
            "sources": sources,
            "mode": mode,
        }
        if latency_ms is not None:
            record["latency_ms"] = round(latency_ms)
        if ok is not None:
            record["ok"] = ok
        with QUESTION_LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        log.exception("question log write failed")


def _prepare_chat(body: "ChatRequest", request: Request):
    """Shared validation + retrieval for both chat endpoints."""
    _check_rate_limit(request)
    if index is None:
        raise HTTPException(status_code=503, detail="Knowledge index not ready.")
    if not llm.configured:
        raise HTTPException(
            status_code=503,
            detail="The assistant is not configured yet (missing Azure OpenAI settings).",
        )
    history = [t.model_dump() for t in body.history][-8:]
    prior_user = next((t["content"] for t in reversed(history) if t["role"] == "user"), "")
    chunks = index.retrieve(body.message, k=TOP_K, prior_query=prior_user)
    sources: list[str] = []
    for c in chunks:
        if c.heading not in sources:
            sources.append(c.heading)
    return history, chunks, sources


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "llm_configured": llm.configured,
        "deployment": llm.deployment if llm.configured else None,
        "index": index.stats() if index else None,
    }


@app.post("/api/chat", response_model=ChatResponse)
def chat(body: ChatRequest, request: Request) -> ChatResponse:
    history, chunks, sources = _prepare_chat(body, request)
    start = time.monotonic()
    try:
        reply = llm.answer(body.message, chunks, history)
    except Exception as exc:  # network / auth / quota errors from Azure
        log.exception("LLM call failed")
        _log_question(body.message, sources, (time.monotonic() - start) * 1000, False, "sync")
        raise HTTPException(
            status_code=502,
            detail="The assistant could not reach the language model. Please try again shortly.",
        ) from exc

    _log_question(body.message, sources, (time.monotonic() - start) * 1000, True, "sync")
    log.info("chat ip=%s q=%r sources=%s", _client_ip(request), body.message[:80], sources)
    return ChatResponse(reply=reply, sources=sources)


@app.post("/api/chat/stream")
def chat_stream(body: ChatRequest, request: Request) -> StreamingResponse:
    """Server-Sent Events: {'type':'sources'|'delta'|'done'|'error', ...}."""
    history, chunks, sources = _prepare_chat(body, request)

    # Log up front: a cancelled generator (visitor closes the tab mid-answer)
    # is not reliably finalised, and the question itself is the valuable part.
    _log_question(body.message, sources, None, None, "stream")
    log.info("chat(stream) ip=%s q=%r sources=%s", _client_ip(request), body.message[:80], sources)

    def sse(obj: dict) -> str:
        return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"

    def generate():
        got_text = False
        try:
            yield sse({"type": "sources", "sources": sources})
            for delta in llm.answer_stream(body.message, chunks, history):
                got_text = True
                yield sse({"type": "delta", "text": delta})
            if not got_text:
                yield sse({"type": "delta", "text":
                           "I couldn't generate a response just now. Please try again, or "
                           "email Ravish at www.ravishraheja@gmail.com."})
            yield sse({"type": "done"})
        except GeneratorExit:  # client went away; nothing left to send
            raise
        except Exception:
            log.exception("LLM stream failed")
            yield sse({"type": "error", "detail":
                       "The assistant could not reach the language model. Please try again shortly."})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# Optional: serve the static portfolio for local end-to-end testing.
# Guarded so a stray SERVE_FRONTEND=true in a container (where the parent dir is
# the filesystem root) can never expose arbitrary files.
_SITE_DIR = BASE_DIR.parent
if SERVE_FRONTEND and (_SITE_DIR / "index.html").exists() and (_SITE_DIR / "about.html").exists():
    app.mount("/", StaticFiles(directory=_SITE_DIR, html=True), name="site")
elif SERVE_FRONTEND:
    log.warning("SERVE_FRONTEND=true but no portfolio HTML found next to backend/; not serving static files.")
