/* =========================================================================
   Portfolio assistant — frontend for backend/main.py
   -------------------------------------------------------------------------
   Set API_BASE_PROD to your deployed FastAPI URL (no trailing slash), e.g.
   'https://ravish-portfolio-api.onrender.com'. On localhost the page talks
   to http://localhost:8000 automatically (or same-origin when the FastAPI
   dev server is serving this page with SERVE_FRONTEND=true).

   Streams answers token-by-token from /api/chat/stream (SSE) and falls back
   to the plain /api/chat endpoint if streaming isn't available. Handles
   free-tier hosts that sleep: retries the health check with a "waking up"
   state instead of giving up on the first failed attempt.
   ========================================================================= */
(function () {
  const API_BASE_PROD = '';

  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const API_BASE = isLocal
    ? (window.location.port === '8000' ? '' : 'http://localhost:8000')
    : API_BASE_PROD;

  // Free-tier hosts (Render etc.) sleep after idle and can take ~60s to wake.
  const WAKE_ATTEMPTS = 14;        // total tries before giving up
  const WAKE_INTERVAL_MS = 5000;   // between tries

  const shell = document.getElementById('chatShell');
  if (!shell) return;

  const messagesEl = document.getElementById('chatMessages');
  const form = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSend');
  const statusEl = document.getElementById('chatStatus');
  const chipsEl = document.getElementById('chatChips');

  const history = [];           // [{role, content}] sent back to the API
  let online = false;
  let pending = false;
  let wakeAttempt = 0;
  let wakeTimer = null;

  /* ---------- helpers ---------- */
  function setStatus(text, state) {
    statusEl.innerHTML = '<span class="chat-dot"></span>' + text;
    statusEl.dataset.state = state;
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Minimal safe renderer: escape, linkify URLs/emails, turn "- " lines into lists,
  // **bold** into <strong>. Everything else stays plain text.
  function render(text) {
    const lines = text.split(/\r?\n/);
    let html = '', inList = false;
    const inline = (s) => {
      s = escapeHtml(s);
      s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      // Markdown links first: [label](https://...)
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      // Then bare URLs, skipping ones already inside an anchor (preceded by " or >)
      s = s.replace(/(?<!["'>])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
      s = s.replace(/(^|[\s(])([\w.+-]+@[\w-]+\.[\w.]+)/g, '$1<a href="mailto:$2">$2</a>');
      return s;
    };
    for (const raw of lines) {
      const line = raw.trim();
      const m = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (m) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + inline(m[1]) + '</li>';
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        if (line) html += '<p>' + inline(line) + '</p>';
      }
    }
    if (inList) html += '</ul>';
    return html;
  }

  // The thread lives in the page (no inner scroll area): newest entry on top,
  // right under the ask box, so nothing needs to scroll.
  function scrollToBottom() {}

  const MAX_ENTRIES = 6;
  let currentEntry = null;   // the entry waiting for its answer

  function newEntry(question) {
    const entry = document.createElement('article');
    entry.className = 'ask-entry';
    if (question) {
      const q = document.createElement('h4');
      q.className = 'ask-q';
      q.textContent = question;
      entry.appendChild(q);
    }
    const a = document.createElement('div');
    a.className = 'ask-a';
    entry.appendChild(a);
    messagesEl.prepend(entry);
    while (messagesEl.children.length > MAX_ENTRIES) messagesEl.lastElementChild.remove();
    return entry;
  }

  function addMessage(role, text, opts = {}) {
    if (role === 'user') {
      currentEntry = newEntry(text);
      return currentEntry;
    }
    // Bot: fill the entry waiting for an answer, otherwise show a standalone notice.
    const entry = (currentEntry && !currentEntry.dataset.answered) ? currentEntry : newEntry('');
    entry.dataset.answered = '1';
    currentEntry = null;
    const a = entry.querySelector('.ask-a');
    a.innerHTML = render(text);
    if (opts.error) entry.classList.add('error');
    if (opts.sources && opts.sources.length) addSources(entry, opts.sources);
    return entry;
  }

  function addSources(entry, sources) {
    const src = document.createElement('div');
    src.className = 'chat-sources';
    src.textContent = 'Grounded in: ' + sources.map(s => s.split(' > ').pop()).join(' · ');
    entry.appendChild(src);
  }

  function addTyping() {
    const entry = currentEntry || newEntry('');
    const t = document.createElement('span');
    t.className = 'chat-typing';
    t.innerHTML = '<i></i><i></i><i></i>';
    entry.querySelector('.ask-a').appendChild(t);
    return t;
  }

  function setPending(v) {
    pending = v;
    sendBtn.disabled = v || !online;
    input.disabled = v;
    shell.classList.toggle('is-pending', v);
  }

  function setOnline(v, label, state) {
    online = v;
    shell.classList.toggle('is-offline', !v);
    sendBtn.disabled = !v || pending;
    input.placeholder = v ? 'Ask anything about Ravish…'
      : (state === 'waking' ? 'Waking up the assistant…' : 'Assistant is offline right now');
    setStatus(label, state || (v ? 'online' : 'offline'));
  }

  /* ---------- health / wake-up ---------- */
  async function checkHealth() {
    if (!API_BASE && !isLocal) {
      setOnline(false, 'Offline · not connected');
      return;
    }
    try {
      const res = await fetch(API_BASE + '/api/health', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.llm_configured) {
        wakeAttempt = 0;
        setOnline(true, 'Online');
        return;
      }
      // Server is up but the model isn't configured: retrying won't help.
      setOnline(false, 'Offline · model not configured');
    } catch (_) {
      // Network error: the host is probably asleep (free tiers) — keep trying.
      wakeAttempt++;
      if (wakeAttempt < WAKE_ATTEMPTS) {
        setOnline(false, 'Waking up the assistant…', 'waking');
        clearTimeout(wakeTimer);
        wakeTimer = setTimeout(checkHealth, WAKE_INTERVAL_MS);
      } else {
        setOnline(false, 'Offline');
      }
    }
  }

  function restartWake() {
    wakeAttempt = 0;
    clearTimeout(wakeTimer);
    checkHealth();
  }

  /* ---------- asking ---------- */
  async function ask(question) {
    if (pending || !question) return;
    if (!online) {
      const state = statusEl.dataset.state;
      if (state !== 'waking') restartWake();
      addMessage('bot', "The assistant is just waking up — give it a few seconds and try again. If it stays offline, you can email Ravish at www.ravishraheja@gmail.com.", { error: true });
      return;
    }

    addMessage('user', question);
    history.push({ role: 'user', content: question });
    input.value = '';
    setPending(true);
    const typing = addTyping();

    try {
      const done = await askStreaming(question, typing);
      if (!done) await askFallback(question, typing);
    } catch (_) {
      typing.remove();
      history.pop();
      addMessage('bot', "I couldn't reach the assistant. Check your connection and try again, or email Ravish at www.ravishraheja@gmail.com.", { error: true });
      restartWake();
    } finally {
      setPending(false);
      if (window.matchMedia('(min-width: 769px)').matches) input.focus();
    }
  }

  // Returns true if the streaming endpoint handled the question (even with an
  // in-stream error); false means "endpoint unavailable, use the fallback".
  async function askStreaming(question, typing) {
    let res;
    try {
      res = await fetch(API_BASE + '/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, history: history.slice(-8, -1) })
      });
    } catch (_) {
      return false;
    }

    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.includes('text/event-stream') || !res.body) {
      if (res.status === 404 || res.status === 405) return false;  // old backend
      const data = await res.json().catch(() => ({}));
      typing.remove();
      const detail = typeof data.detail === 'string' ? data.detail : 'Something went wrong. Please try again.';
      addMessage('bot', detail, { error: true });
      history.pop();
      if (res.status === 503) setOnline(false, 'Offline · model not configured');
      return true;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', acc = '', sources = [], wrap = null, bubble = null, failed = false;

    const handle = (ev) => {
      if (ev.type === 'sources') { sources = ev.sources || []; return; }
      if (ev.type === 'delta') {
        acc += ev.text;
        if (!wrap) {
          typing.remove();
          wrap = addMessage('bot', '');
          bubble = wrap.querySelector('.ask-a');
        }
        bubble.innerHTML = render(acc);
        scrollToBottom();
        return;
      }
      if (ev.type === 'error') {
        failed = true;
        if (wrap) wrap.classList.add('error');
        else { typing.remove(); addMessage('bot', ev.detail || 'Something went wrong. Please try again.', { error: true }); }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data: ')) {
            try { handle(JSON.parse(line.slice(6))); } catch (_) { /* skip bad frame */ }
          }
        }
      }
    }

    if (failed || !acc) { history.pop(); return true; }
    if (wrap && sources.length) addSources(wrap, sources);
    history.push({ role: 'assistant', content: acc });
    return true;
  }

  async function askFallback(question, typing) {
    const res = await fetch(API_BASE + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: question, history: history.slice(-8, -1) })
    });
    const data = await res.json().catch(() => ({}));
    typing.remove();

    if (!res.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : 'Something went wrong. Please try again.';
      addMessage('bot', detail, { error: true });
      history.pop();
      if (res.status === 503) setOnline(false, 'Offline · model not configured');
      return;
    }
    addMessage('bot', data.reply, { sources: data.sources || [] });
    history.push({ role: 'assistant', content: data.reply });
  }

  /* ---------- wiring ---------- */
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    ask(input.value.trim());
  });

  chipsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.chat-chip');
    if (!chip) return;
    ask(chip.dataset.q);
  });

  setStatus('Connecting…', 'waking');
  checkHealth();
})();
