"""
Minimal, dependency-free RAG layer.

- Loads a single Markdown knowledge file.
- Splits it into heading-aware chunks.
- Scores chunks with BM25 (pure Python). If an Azure OpenAI embedding
  deployment is configured, it also scores by cosine similarity and fuses
  both rankings with Reciprocal Rank Fusion.
- Returns the top-k chunks plus one "core" chunk (the Snapshot section) so the
  model always knows who Ravish is, even for vague or conversational questions.

No vector database, no third-party retrieval service.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Optional

log = logging.getLogger("portfolio-bot.rag")

# ---------------------------------------------------------------------------
# Tokenisation
# ---------------------------------------------------------------------------

_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "could", "did",
    "do", "does", "for", "from", "had", "has", "have", "he", "her", "him",
    "his", "how", "i", "if", "in", "into", "is", "it", "its", "me", "my",
    "of", "on", "or", "our", "s", "she", "should", "so", "tell", "that",
    "the", "their", "them", "there", "these", "they", "this", "to", "us",
    "was", "we", "were", "what", "when", "where", "which", "who", "whom",
    "why", "will", "with", "would", "you", "your", "about", "please", "any",
    "some", "like", "know", "want", "ravish", "raheja",
}

# Query-side synonym expansion: maps common recruiter phrasing to the vocabulary
# used in the knowledge file. Values are appended to the query tokens.
_SYNONYMS: dict[str, tuple[str, ...]] = {
    "cert": ("certification", "certified"),
    "certs": ("certification", "certified"),
    "certificate": ("certification", "certified"),
    "certificates": ("certification", "certified"),
    "certified": ("certification",),
    "credential": ("certification", "credential id"),
    "credentials": ("certification",),
    "college": ("university", "education", "degree"),
    "school": ("university", "education", "degree"),
    "university": ("education", "degree"),
    "degree": ("education", "bachelor"),
    "study": ("education", "university"),
    "studying": ("education", "university"),
    "major": ("computer science", "education"),
    "gpa": ("cgpa",),
    "grades": ("cgpa",),
    "grade": ("cgpa",),
    "marks": ("cgpa",),
    "score": ("cgpa",),
    "graduate": ("graduation", "expected"),
    "graduating": ("graduation", "expected"),
    "job": ("looking for", "open to", "internship"),
    "jobs": ("looking for", "open to", "internship"),
    "hire": ("looking for", "open to", "contact"),
    "hiring": ("looking for", "open to", "contact"),
    "available": ("looking for", "open to"),
    "availability": ("looking for", "open to"),
    "intern": ("internship", "looking for"),
    "role": ("looking for", "open to"),
    "roles": ("looking for", "open to"),
    "position": ("looking for", "open to"),
    "contact": ("email", "linkedin"),
    "reach": ("email", "contact", "linkedin"),
    "mail": ("email",),
    "phone": ("contact", "email"),
    "stack": ("skills", "tech stack", "frameworks"),
    "technologies": ("skills", "frameworks"),
    "tools": ("devops", "skills"),
    "languages": ("programming languages", "skills"),
    "language": ("programming languages", "skills"),
    "code": ("github", "programming"),
    "coding": ("programming", "skills"),
    "cloud": ("azure", "microsoft azure"),
    "aws": ("route53", "cloud"),
    "database": ("databases", "postgresql"),
    "databases": ("postgresql", "mongodb"),
    "frontend": ("react", "next.js", "javascript"),
    "backend": ("fastapi", "django"),
    "ai": ("llm", "rag", "agents"),
    "ml": ("machine learning",),
    "llm": ("rag", "agents", "openai"),
    "chatbot": ("agent", "rag", "smartbase"),
    "agent": ("agents", "mcp"),
    "agents": ("mcp", "tool calling"),
    "hackathon": ("prize", "winner", "achievements"),
    "hackathons": ("prize", "winner", "achievements"),
    "award": ("achievements", "prize"),
    "awards": ("achievements", "prize"),
    "won": ("prize", "winner", "achievements"),
    "win": ("prize", "winner", "achievements"),
    "prize": ("achievements", "winner"),
    "achievement": ("achievements", "prize"),
    "accomplishments": ("achievements", "prize"),
    "lead": ("leadership", "president"),
    "leader": ("leadership", "president"),
    "leadership": ("president", "chapter"),
    "club": ("chapter", "leadership"),
    "extracurricular": ("leadership", "activities"),
    "experience": ("projects", "role", "leadership"),
    "work": ("projects", "experience"),
    "worked": ("projects", "role"),
    "built": ("projects",),
    "build": ("projects",),
    "project": ("projects",),
    "portfolio": ("projects",),
    "demo": ("live demo",),
    "live": ("live demo",),
    "where": ("location", "gurugram"),
    "location": ("gurugram", "based"),
    "based": ("location", "gurugram"),
    "city": ("location", "gurugram"),
    "country": ("india", "location"),
    "strength": ("strongest", "skills"),
    "strengths": ("strongest", "skills"),
    "good": ("strongest", "skills"),
    "best": ("strongest",),
    "summary": ("snapshot",),
    "overview": ("snapshot",),
    "introduce": ("snapshot",),
    "introduction": ("snapshot",),
    "bio": ("snapshot",),
    "himself": ("snapshot",),
    "yourself": ("snapshot",),
    "values": ("working style",),
    "personality": ("working style", "values"),
    "iot": ("campuspay", "arduino"),
    "hardware": ("arduino", "rfid"),
    "powerbi": ("power bi",),
    "dns": ("route53",),
    "speech": ("aura", "nlp"),
    "voice": ("aura", "elevenlabs"),
    "rag": ("retrieval", "smartbase"),
    "retrieval": ("rag", "smartbase"),
    "azure": ("microsoft azure", "foundry"),
    "foundry": ("azure ai foundry", "smartbase"),
}

_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9+#.\-]*")


def _normalise_token(tok: str) -> str:
    tok = tok.strip(".-")
    if len(tok) > 3 and tok.endswith("s") and not tok.endswith("ss"):
        tok = tok[:-1]
    return tok


def tokenize(text: str) -> list[str]:
    out = []
    for raw in _TOKEN_RE.findall(text.lower()):
        tok = _normalise_token(raw)
        if tok and tok not in _STOPWORDS:
            out.append(tok)
    return out


def expand_query(text: str) -> list[str]:
    """Tokenise a query and append synonym tokens so recruiter phrasing
    ("certs", "college", "gpa") hits the knowledge file vocabulary."""
    base_words = _TOKEN_RE.findall(text.lower())
    tokens = tokenize(text)
    extra: list[str] = []
    for w in base_words:
        for key in (w, _normalise_token(w)):
            if key in _SYNONYMS:
                for phrase in _SYNONYMS[key]:
                    extra.extend(tokenize(phrase))
                break
    return tokens + extra


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------

@dataclass
class Chunk:
    id: int
    heading: str          # "Section > Subsection"
    text: str             # body text (without heading line)
    tokens: list[str] = field(default_factory=list)
    embedding: Optional[list[float]] = None

    @property
    def as_context(self) -> str:
        return f"[{self.heading}]\n{self.text}"


def _split_long(text: str, max_chars: int = 1400) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    parts, cur = [], ""
    for para in re.split(r"\n\s*\n", text):
        para = para.strip()
        if not para:
            continue
        if cur and len(cur) + len(para) + 2 > max_chars:
            parts.append(cur)
            cur = para
        else:
            cur = f"{cur}\n\n{para}" if cur else para
    if cur:
        parts.append(cur)
    return parts


def chunk_markdown(md: str) -> list[Chunk]:
    """Split Markdown by ## / ### headings. Each chunk keeps its heading path."""
    lines = md.splitlines()
    chunks: list[Chunk] = []
    h2, h3 = "", ""
    buf: list[str] = []

    def flush():
        body = "\n".join(buf).strip()
        buf.clear()
        if not body:
            return
        heading = " > ".join(h for h in (h2, h3) if h) or "General"
        for piece in _split_long(body):
            chunks.append(Chunk(id=len(chunks), heading=heading, text=piece))

    for line in lines:
        if line.startswith("# "):           # document title: skip
            continue
        if line.startswith("## "):
            flush()
            h2, h3 = line[3:].strip(), ""
            continue
        if line.startswith("### "):
            flush()
            h3 = line[4:].strip()
            continue
        buf.append(line)
    flush()

    for c in chunks:
        # Index heading words too: a question about "certifications" should
        # match the chunk whose heading says so even if the body doesn't.
        c.tokens = tokenize(c.heading) * 2 + tokenize(c.text)
    return chunks


# ---------------------------------------------------------------------------
# BM25
# ---------------------------------------------------------------------------

class BM25:
    def __init__(self, docs: list[list[str]], k1: float = 1.5, b: float = 0.75):
        self.k1, self.b = k1, b
        self.docs = docs
        self.n = len(docs)
        self.avgdl = (sum(len(d) for d in docs) / self.n) if self.n else 0.0
        self.tf: list[Counter] = [Counter(d) for d in docs]
        df: Counter = Counter()
        for d in docs:
            df.update(set(d))
        self.idf = {
            t: math.log(1 + (self.n - f + 0.5) / (f + 0.5)) for t, f in df.items()
        }

    def score(self, query: Iterable[str]) -> list[float]:
        scores = [0.0] * self.n
        q = list(query)
        for i, tf in enumerate(self.tf):
            dl = len(self.docs[i])
            denom_norm = self.k1 * (1 - self.b + self.b * dl / (self.avgdl or 1))
            s = 0.0
            for t in q:
                f = tf.get(t)
                if not f:
                    continue
                s += self.idf.get(t, 0.0) * (f * (self.k1 + 1)) / (f + denom_norm)
            scores[i] = s
        return scores


# ---------------------------------------------------------------------------
# Index
# ---------------------------------------------------------------------------

def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


EmbedFn = Callable[[list[str]], list[list[float]]]


class KnowledgeIndex:
    def __init__(self, path: Path, embed: Optional[EmbedFn] = None,
                 core_heading: str = "Snapshot",
                 cache_path: Optional[Path] = None, cache_tag: str = ""):
        self.path = Path(path)
        self.embed = embed
        self.core_heading = core_heading
        # Embedding cache: avoids re-embedding the profile on every restart.
        # Keyed on a hash of the file content + model tag, so edits invalidate it.
        self.cache_path = Path(cache_path) if cache_path else None
        self.cache_tag = cache_tag
        self.chunks: list[Chunk] = []
        self.bm25: Optional[BM25] = None
        self.core: Optional[Chunk] = None
        self.reload()

    # -- embedding cache -----------------------------------------------------
    def _cache_hash(self, md: str) -> str:
        return hashlib.sha256((self.cache_tag + "\x00" + md).encode("utf-8")).hexdigest()

    def _load_cached_vectors(self, md: str) -> Optional[list[list[float]]]:
        if not self.cache_path or not self.cache_path.exists():
            return None
        try:
            data = json.loads(self.cache_path.read_text(encoding="utf-8"))
            if data.get("hash") == self._cache_hash(md) and \
                    len(data.get("vectors", [])) == len(self.chunks):
                return data["vectors"]
        except Exception as exc:
            log.warning("Embedding cache unreadable (%s); recomputing.", exc)
        return None

    def _save_cached_vectors(self, md: str, vectors: list[list[float]]) -> None:
        if not self.cache_path:
            return
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(
                json.dumps({"hash": self._cache_hash(md), "vectors": vectors}),
                encoding="utf-8",
            )
        except Exception as exc:
            log.warning("Could not write embedding cache: %s", exc)

    # -- build ---------------------------------------------------------------
    def reload(self) -> None:
        md = self.path.read_text(encoding="utf-8")
        self.chunks = chunk_markdown(md)
        if not self.chunks:
            raise ValueError(f"No chunks parsed from {self.path}")
        self.bm25 = BM25([c.tokens for c in self.chunks])
        self.core = next(
            (c for c in self.chunks if c.heading.lower().startswith(self.core_heading.lower())),
            self.chunks[0],
        )
        if self.embed is not None:
            vectors = self._load_cached_vectors(md)
            if vectors is not None:
                log.info("Embeddings loaded from cache (%d chunks).", len(vectors))
            else:
                vectors = self.embed([c.as_context for c in self.chunks])
                self._save_cached_vectors(md, vectors)
                log.info("Embeddings computed and cached (%d chunks).", len(vectors))
            for c, v in zip(self.chunks, vectors):
                c.embedding = v

    # -- query ---------------------------------------------------------------
    def retrieve(self, query: str, k: int = 4, prior_query: str = "") -> list[Chunk]:
        """Return the top-k chunks for `query`.

        `prior_query` (the previous user turn) is blended in with lower weight so
        follow-ups such as "when did he get it?" still retrieve the right topic.
        """
        q_tokens = expand_query(query)
        if prior_query:
            q_tokens = q_tokens + expand_query(prior_query)[:6]

        assert self.bm25 is not None
        bm25_scores = self.bm25.score(q_tokens)
        bm25_rank = sorted(range(len(self.chunks)), key=lambda i: -bm25_scores[i])

        if self.embed is not None and all(c.embedding for c in self.chunks):
            qv = self.embed([query])[0]
            emb_scores = [_cosine(qv, c.embedding or []) for c in self.chunks]
            emb_rank = sorted(range(len(self.chunks)), key=lambda i: -emb_scores[i])
            fused: dict[int, float] = {}
            for rank_list in (bm25_rank, emb_rank):
                for r, i in enumerate(rank_list[:20]):
                    fused[i] = fused.get(i, 0.0) + 1.0 / (60 + r)
            ordered = sorted(fused, key=lambda i: -fused[i])
        else:
            ordered = [i for i in bm25_rank if bm25_scores[i] > 0]

        # FAQ chunks are phrased like questions, so embeddings rank them very
        # high for almost any query. Cap them so primary sections still get in.
        picked: list[Chunk] = []
        faq_count = 0
        for i in ordered:
            c = self.chunks[i]
            if c is self.core:
                continue
            if c.heading.lower().startswith("frequently asked"):
                if faq_count >= 2:
                    continue
                faq_count += 1
            picked.append(c)
            if len(picked) >= k:
                break

        result = [self.core] if self.core else []
        result.extend(picked)
        return result

    def stats(self) -> dict:
        return {
            "knowledge_file": str(self.path.name),
            "chunks": len(self.chunks),
            "embeddings": self.embed is not None,
        }
