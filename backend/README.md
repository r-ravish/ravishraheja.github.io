# Portfolio assistant backend

A small FastAPI service that powers the "Ask me anything" chat on the
*Get to know me* page. It is a plain RAG setup with no external vector store:

```
knowledge/profile.md  ──►  rag.py (heading-aware chunks + BM25)  ──►  top-k chunks
                                                                          │
visitor question ─────────────────────────────────────────────────────────┤
                                                                          ▼
                                             llm.py (GPT-4o on Microsoft Foundry, strict system prompt)
```

* **`knowledge/profile.md`** — the only thing the bot knows. Edit this file to
  change answers. Headings (`##`, `###`) become retrieval chunks, so keep facts
  under descriptive headings.
* **`rag.py`** — chunking, BM25 scoring, query synonym expansion, optional
  embedding fusion. Pure Python.
* **`llm.py`** — Azure OpenAI client and the grounding system prompt.
* **`main.py`** — FastAPI app: `/api/chat`, `/api/health`, CORS, rate limit.

## Run locally

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env            # fill in AZURE_OPENAI_ENDPOINT / API_KEY / DEPLOYMENT
.venv/bin/uvicorn main:app --reload --port 8000
```

With `SERVE_FRONTEND=true` (the default in `.env.example`) the whole portfolio
is served at <http://localhost:8000/about.html>, so the chat works end to end
without any extra static server. Interactive API docs: <http://localhost:8000/api/docs>.

Quick check without the browser:

```bash
curl -s localhost:8000/api/health
curl -s localhost:8000/api/chat -H 'content-type: application/json' \
     -d '{"message":"What certifications does Ravish have?"}'
```

## Deploy

See [`../DEPLOYMENT.md`](../DEPLOYMENT.md) for the full plan (Azure App Service,
Container Apps via the included `Dockerfile`, or Render), the environment
variables to set, and how to point `chat.js` at the deployed URL.

## Guardrails

* The system prompt forbids answering from anything other than the retrieved
  profile context and declines off-topic requests.
* Messages are capped at 1000 characters and 12 history turns.
* 20 requests per minute per IP (configurable) to protect your Azure quota.
* Missing credentials → `503`; Azure errors → `502`; the frontend shows a
  friendly offline state in both cases.
