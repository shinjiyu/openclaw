/**
 * Inline HTML for the WebChat Portal SPA.
 * Served at `<basePath>/` and `<basePath>/login`.
 * Self-contained: uses the gateway WebSocket protocol directly (no build step).
 */

export const PORTAL_ASSET_VERSION = "1";

export function buildPortalHtml(opts: {
  basePath: string;
  assistantName: string;
}): string {
  const { basePath, assistantName } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(assistantName)} Portal</title>
  <style>
    :root {
      --bg: #0f1117;
      --surface: #1a1d27;
      --surface2: #22263a;
      --border: #2e3350;
      --accent: #6c7dff;
      --accent-hover: #8390ff;
      --text: #e8eaf0;
      --muted: #7a82a0;
      --success: #3ecf8e;
      --error: #f55d6c;
      --warn: #f5a623;
      --user-bubble: #2a3058;
      --assistant-bubble: #1d2035;
      --radius: 12px;
      --radius-sm: 8px;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100dvh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Login ─────────────────────────────────────────────── */
    #login-view {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .login-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 2.5rem 3rem;
      width: min(400px, 90vw);
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    .login-card h1 {
      font-size: 1.4rem;
      font-weight: 600;
      color: var(--text);
    }
    .login-card .subtitle {
      font-size: 0.85rem;
      color: var(--muted);
      margin-top: -0.75rem;
    }
    .form-field {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .form-field label {
      font-size: 0.8rem;
      color: var(--muted);
      font-weight: 500;
      letter-spacing: 0.03em;
    }
    .form-field input {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-size: 0.95rem;
      padding: 0.65rem 0.9rem;
      outline: none;
      transition: border-color 0.15s;
    }
    .form-field input:focus { border-color: var(--accent); }
    .btn-primary {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: var(--radius-sm);
      padding: 0.7rem 1.2rem;
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
      align-self: stretch;
    }
    .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .login-error {
      background: rgba(245,93,108,0.1);
      border: 1px solid var(--error);
      color: var(--error);
      border-radius: var(--radius-sm);
      padding: 0.6rem 0.9rem;
      font-size: 0.85rem;
      display: none;
    }
    .login-error.visible { display: block; }

    /* ── App shell ──────────────────────────────────────────── */
    #app-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1.25rem;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      flex-shrink: 0;
    }
    .topbar .title {
      font-size: 1rem;
      font-weight: 600;
      flex: 1;
    }
    .topbar .conn-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--muted);
      transition: background 0.3s;
    }
    .topbar .conn-dot.connected { background: var(--success); }
    .topbar .username-tag {
      font-size: 0.78rem;
      color: var(--muted);
      background: var(--surface2);
      padding: 0.25rem 0.6rem;
      border-radius: 99px;
      border: 1px solid var(--border);
    }
    .topbar .btn-logout {
      background: none;
      border: 1px solid var(--border);
      color: var(--muted);
      border-radius: var(--radius-sm);
      padding: 0.3rem 0.7rem;
      font-size: 0.8rem;
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
    }
    .topbar .btn-logout:hover { color: var(--text); border-color: var(--muted); }

    /* ── Split layout ───────────────────────────────────────── */
    .split {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    /* ── Chat panel ─────────────────────────────────────────── */
    .chat-panel {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--border);
    }
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      scroll-behavior: smooth;
    }
    .chat-messages::-webkit-scrollbar { width: 4px; }
    .chat-messages::-webkit-scrollbar-track { background: transparent; }
    .chat-messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    .msg {
      display: flex;
      flex-direction: column;
      max-width: 80%;
      gap: 0.3rem;
    }
    .msg.user { align-self: flex-end; align-items: flex-end; }
    .msg.assistant { align-self: flex-start; align-items: flex-start; }
    .msg.system { align-self: center; align-items: center; max-width: 90%; }

    .msg-bubble {
      border-radius: var(--radius);
      padding: 0.65rem 0.95rem;
      font-size: 0.9rem;
      line-height: 1.55;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .msg.user .msg-bubble {
      background: var(--user-bubble);
      border-bottom-right-radius: 3px;
    }
    .msg.assistant .msg-bubble {
      background: var(--assistant-bubble);
      border: 1px solid var(--border);
      border-bottom-left-radius: 3px;
    }
    .msg.system .msg-bubble {
      background: transparent;
      color: var(--muted);
      font-size: 0.78rem;
      text-align: center;
      border: none;
      padding: 0.2rem 0;
    }
    .msg-label {
      font-size: 0.72rem;
      color: var(--muted);
      padding: 0 0.2rem;
    }

    /* Streaming cursor */
    .cursor-blink::after {
      content: "▋";
      animation: blink 0.9s step-end infinite;
    }
    @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }

    /* Thinking */
    .thinking-indicator {
      color: var(--muted);
      font-size: 0.82rem;
      font-style: italic;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .thinking-dots span {
      display: inline-block;
      width: 4px;
      height: 4px;
      background: var(--muted);
      border-radius: 50%;
      animation: bounce 1.2s infinite;
    }
    .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
    .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce { 0%,80%,100% { transform: translateY(0); } 40% { transform: translateY(-4px); } }

    /* Chat input area */
    .chat-input-area {
      padding: 0.85rem 1.25rem 1rem;
      border-top: 1px solid var(--border);
      background: var(--surface);
      flex-shrink: 0;
    }
    .chat-input-row {
      display: flex;
      gap: 0.6rem;
      align-items: flex-end;
    }
    .chat-textarea {
      flex: 1;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-size: 0.9rem;
      padding: 0.6rem 0.8rem;
      resize: none;
      min-height: 40px;
      max-height: 200px;
      outline: none;
      font-family: inherit;
      line-height: 1.5;
      transition: border-color 0.15s;
    }
    .chat-textarea:focus { border-color: var(--accent); }
    .chat-textarea:disabled { opacity: 0.5; }
    .send-btn {
      background: var(--accent);
      border: none;
      border-radius: var(--radius-sm);
      color: #fff;
      width: 38px;
      height: 38px;
      flex-shrink: 0;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .send-btn:hover:not(:disabled) { background: var(--accent-hover); }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .send-btn svg { width: 16px; height: 16px; }

    /* ── Tasks panel ────────────────────────────────────────── */
    .tasks-panel {
      width: 340px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .tasks-header {
      padding: 0.85rem 1.25rem 0.65rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--surface);
      flex-shrink: 0;
    }
    .tasks-header h2 {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .tasks-stats {
      display: flex;
      gap: 0.5rem;
    }
    .stat-pill {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 99px;
      padding: 0.15rem 0.55rem;
      font-size: 0.72rem;
      color: var(--muted);
    }
    .stat-pill.active { color: var(--accent); border-color: var(--accent); }

    .tasks-list {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem;
    }
    .tasks-list::-webkit-scrollbar { width: 4px; }
    .tasks-list::-webkit-scrollbar-track { background: transparent; }
    .tasks-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    .task-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.75rem 1rem;
      margin-bottom: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      cursor: default;
    }
    .task-card-top {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .task-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .task-status-dot.queued { background: var(--muted); }
    .task-status-dot.running {
      background: var(--accent);
      animation: pulse-dot 1.5s ease-in-out infinite;
    }
    @keyframes pulse-dot {
      0%,100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.3); }
    }
    .task-status-dot.completed { background: var(--success); }
    .task-status-dot.failed { background: var(--error); }
    .task-status-dot.cancelled { background: var(--muted); }

    .task-msg {
      font-size: 0.82rem;
      color: var(--text);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .task-meta {
      font-size: 0.72rem;
      color: var(--muted);
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .task-result {
      font-size: 0.8rem;
      color: var(--muted);
      border-top: 1px solid var(--border);
      padding-top: 0.4rem;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 120px;
      overflow-y: auto;
    }
    .task-result.error { color: var(--error); }

    .tasks-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      height: 120px;
      color: var(--muted);
      font-size: 0.82rem;
    }

    /* ── Responsive ─────────────────────────────────────────── */
    @media (max-width: 640px) {
      .tasks-panel { display: none; }
    }
  </style>
</head>
<body>

<!-- ── Login view ──────────────────────────────────────────── -->
<div id="login-view">
  <div class="login-card">
    <div>
      <h1>${escapeHtml(assistantName)} Portal</h1>
      <p class="subtitle">Sign in to start a conversation.</p>
    </div>
    <div id="login-error" class="login-error"></div>
    <form id="login-form">
      <div style="display:flex;flex-direction:column;gap:0.9rem;">
        <div class="form-field">
          <label for="username-input">Username</label>
          <input id="username-input" type="text" autocomplete="username" required placeholder="your-username">
        </div>
        <div class="form-field">
          <label for="password-input">Password</label>
          <input id="password-input" type="password" autocomplete="current-password" required placeholder="••••••••">
        </div>
        <button type="submit" class="btn-primary" id="login-btn">Sign In</button>
      </div>
    </form>
  </div>
</div>

<!-- ── App view ────────────────────────────────────────────── -->
<div id="app-view" style="display:none;">
  <div class="topbar">
    <span class="title">${escapeHtml(assistantName)}</span>
    <span class="conn-dot" id="conn-dot"></span>
    <span class="username-tag" id="username-display"></span>
    <button class="btn-logout" id="logout-btn">Sign out</button>
  </div>
  <div class="split">
    <!-- Chat -->
    <div class="chat-panel">
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-area">
        <div class="chat-input-row">
          <textarea
            id="chat-textarea"
            class="chat-textarea"
            placeholder="Send a message…"
            rows="1"
            disabled
          ></textarea>
          <button class="send-btn" id="send-btn" disabled title="Send">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Tasks -->
    <div class="tasks-panel">
      <div class="tasks-header">
        <h2>Background Tasks</h2>
        <div class="tasks-stats">
          <span class="stat-pill active" id="tasks-running-pill" style="display:none;"></span>
          <span class="stat-pill" id="tasks-queued-pill" style="display:none;"></span>
        </div>
      </div>
      <div class="tasks-list" id="tasks-list">
        <div class="tasks-empty">No tasks yet</div>
      </div>
    </div>
  </div>
</div>

<script>
(function() {
'use strict';

const BASE_PATH = ${JSON.stringify(basePath)};
const GW_WS_URL = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws';
const AUTH_URL = BASE_PATH + '/api/auth';

// ── State ────────────────────────────────────────────────────
let token = sessionStorage.getItem('portal_token');
let username = sessionStorage.getItem('portal_username');
let ws = null;
let wsReady = false;
let pendingCallbacks = new Map();
let callId = 0;
let streaming = false;
let streamEl = null;
let tasks = [];
let taskPollTimer = null;

// ── DOM refs ─────────────────────────────────────────────────
const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');
const loginForm = document.getElementById('login-form');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
const connDot = document.getElementById('conn-dot');
const usernameDisplay = document.getElementById('username-display');
const logoutBtn = document.getElementById('logout-btn');
const chatMessages = document.getElementById('chat-messages');
const chatTextarea = document.getElementById('chat-textarea');
const sendBtn = document.getElementById('send-btn');
const tasksList = document.getElementById('tasks-list');
const tasksRunningPill = document.getElementById('tasks-running-pill');
const tasksQueuedPill = document.getElementById('tasks-queued-pill');

// ── Utilities ────────────────────────────────────────────────
function escEl(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function genId() {
  return 'p-' + (++callId) + '-' + Math.random().toString(36).slice(2);
}

function formatDuration(ms) {
  if (!ms) return '';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms/1000).toFixed(1) + 's';
  return Math.floor(ms/60000) + 'm ' + Math.floor((ms%60000)/1000) + 's';
}

function formatRelTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  return Math.floor(diff/86400000) + 'd ago';
}

// ── Login ────────────────────────────────────────────────────
function showLogin() {
  loginView.style.display = 'flex';
  appView.style.display = 'none';
}

function showApp() {
  loginView.style.display = 'none';
  appView.style.display = 'flex';
  usernameDisplay.textContent = username || '';
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.remove('visible');
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in…';
  try {
    const res = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput.value, password: passwordInput.value }),
    });
    const data = await res.json();
    if (!res.ok || !data.token) {
      throw new Error(data.error || 'Login failed');
    }
    token = data.token;
    username = data.username;
    sessionStorage.setItem('portal_token', token);
    sessionStorage.setItem('portal_username', username);
    showApp();
    connectWs();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.add('visible');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
  }
});

logoutBtn.addEventListener('click', () => {
  sessionStorage.removeItem('portal_token');
  sessionStorage.removeItem('portal_username');
  token = null;
  username = null;
  if (ws) { try { ws.close(); } catch(e) {} }
  ws = null;
  wsReady = false;
  clearTaskPoll();
  chatMessages.innerHTML = '';
  tasks = [];
  renderTasks();
  showLogin();
});

// ── WebSocket ────────────────────────────────────────────────
function connectWs() {
  if (ws && ws.readyState <= 1) return;
  setConnected(false);
  ws = new WebSocket(GW_WS_URL);

  ws.addEventListener('open', () => {
    // Send connect handshake with portal token
    const connectId = genId();
    pendingCallbacks.set(connectId, (msg) => {
      if (msg.ok) {
        setConnected(true);
        wsReady = true;
        enableInput(true);
        loadHistory();
        startTaskPoll();
      } else {
        console.error('WebSocket connect rejected:', msg.error);
        ws.close();
      }
    });
    const frame = {
      type: 'req',
      method: 'connect',
      id: connectId,
      params: {
        minProtocol: 1,
        maxProtocol: 3,
        auth: { token },
        client: {
          id: 'webchat',
          displayName: 'WebChat Portal',
          version: '1.0.0',
          platform: 'web',
          mode: 'webchat',
        },
        caps: ['tool-events'],
      },
    };
    ws.send(JSON.stringify(frame));
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch(e) { return; }
    handleWsMessage(msg);
  });

  ws.addEventListener('close', () => {
    setConnected(false);
    wsReady = false;
    // Auto-reconnect after 3 s if still logged in
    if (token) {
      setTimeout(connectWs, 3000);
    }
  });

  ws.addEventListener('error', () => {
    // close event will trigger reconnect
  });
}

function handleWsMessage(msg) {
  // type:"res" — response to a pending call
  if (msg.type === 'res' && msg.id && pendingCallbacks.has(msg.id)) {
    const cb = pendingCallbacks.get(msg.id);
    pendingCallbacks.delete(msg.id);
    cb(msg);
    return;
  }

  // type:"event" — server-push events
  if (msg.type !== 'event' || !msg.event) return;
  const ev = msg.event;
  const p = msg.payload || {};

  // ── "chat" event ──
  // payload: {runId, sessionKey, seq, state, message?, errorMessage?}
  // state: "delta" | "final" | "aborted" | "error"
  if (ev === 'chat') {
    if (p.state === 'delta') {
      const text = extractText(p.message?.content);
      if (text) handleStreamReplace(text);
    } else if (p.state === 'final') {
      finishAssistantReply(p.message);
    } else if (p.state === 'aborted') {
      finishAssistantReply(p.message);
      appendSystemMsg('Run aborted.');
    } else if (p.state === 'error') {
      finalizeStream();
      appendSystemMsg('⚠ ' + (p.errorMessage || 'An error occurred.'));
      enableInput(true);
    }
    return;
  }

  // ── "agent" event ──
  // payload: {runId, seq, stream, ts, data, sessionKey?}
  // stream "assistant": data.text (cumulative), data.delta (incremental)
  if (ev === 'agent') {
    if (p.stream === 'assistant' && p.data) {
      const delta = p.data.delta || '';
      if (delta) handleStreamAppend(delta);
    }
    return;
  }

  // ── "task" event — refresh task list
  if (ev === 'task') {
    void loadTasks();
    return;
  }
}

function call(method, params) {
  return new Promise((resolve) => {
    const id = genId();
    pendingCallbacks.set(id, resolve);
    ws.send(JSON.stringify({ type: 'req', method, id, params }));
    // Timeout after 30 s
    setTimeout(() => {
      if (pendingCallbacks.has(id)) {
        pendingCallbacks.delete(id);
        resolve({ error: { message: 'Request timed out' } });
      }
    }, 30000);
  });
}

function setConnected(ok) {
  connDot.className = 'conn-dot' + (ok ? ' connected' : '');
}

function enableInput(ok) {
  chatTextarea.disabled = !ok;
  sendBtn.disabled = !ok;
}

// ── Chat history ─────────────────────────────────────────────
async function loadHistory() {
  const sessionKey = 'portal:' + (username || 'anon');
  const res = await call('chat.history', { sessionKey, limit: 80 });
  const data = res.payload;
  if (!res.ok || res.error || !data) return;
  const messages = data.messages || [];
  chatMessages.innerHTML = '';
  for (const m of messages) {
    if (m.role === 'user') {
      const text = extractText(m.content);
      if (text) appendMsg('user', text, false);
    } else if (m.role === 'assistant') {
      const text = extractText(m.content);
      if (text) appendMsg('assistant', text, false);
    }
  }
  scrollBottom(false);
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text')
      .map(c => c.text || '')
      .join('');
  }
  return '';
}

// ── Messaging ────────────────────────────────────────────────
async function sendMessage() {
  const text = chatTextarea.value.trim();
  if (!text || !wsReady) return;
  chatTextarea.value = '';
  chatTextarea.style.height = 'auto';
  enableInput(false);

  appendMsg('user', text, false);
  scrollBottom(true);
  showThinking();

  const idempotencyKey = genId();
  const sessionKey = 'portal:' + (username || 'anon');
  const res = await call('chat.send', {
    sessionKey,
    message: text,
    idempotencyKey,
  });

  if (!res.ok || res.error) {
    hideThinking();
    enableInput(true);
    appendSystemMsg('⚠ ' + (res.error?.message || 'Send failed'));
  }
  // response/streaming handled via events
}

sendBtn.addEventListener('click', () => void sendMessage());
chatTextarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void sendMessage();
  }
});
chatTextarea.addEventListener('input', () => {
  chatTextarea.style.height = 'auto';
  chatTextarea.style.height = Math.min(chatTextarea.scrollHeight, 200) + 'px';
});

// ── Streaming ────────────────────────────────────────────────
let thinkingEl = null;

function showThinking() {
  hideThinking();
  thinkingEl = document.createElement('div');
  thinkingEl.className = 'msg assistant';
  thinkingEl.innerHTML = \`
    <div class="thinking-indicator">
      <span class="thinking-dots">
        <span></span><span></span><span></span>
      </span>
      thinking
    </div>
  \`;
  chatMessages.appendChild(thinkingEl);
  scrollBottom(true);
}

function hideThinking() {
  if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
}

// Ensure a streaming bubble exists; returns the .msg-bubble element.
function ensureStreamBubble() {
  hideThinking();
  if (!streaming || !streamEl) {
    streaming = true;
    streamEl = document.createElement('div');
    streamEl.className = 'msg assistant';
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble cursor-blink';
    bubble.dataset.raw = '';
    streamEl.appendChild(bubble);
    chatMessages.appendChild(streamEl);
  }
  return streamEl.querySelector('.msg-bubble');
}

// Replace full text (used by chat "delta" events which carry cumulative text).
function handleStreamReplace(fullText) {
  const bubble = ensureStreamBubble();
  bubble.dataset.raw = fullText;
  bubble.textContent = fullText;
  scrollBottom(true);
}

// Append incremental text (used by agent "assistant" stream events).
function handleStreamAppend(delta) {
  const bubble = ensureStreamBubble();
  bubble.dataset.raw += delta;
  bubble.textContent = bubble.dataset.raw;
  scrollBottom(true);
}

// Finish the assistant reply: finalize stream, show final message if present.
function finishAssistantReply(message) {
  if (streaming && streamEl) {
    // Stream was active — just finalize the existing bubble.
    finalizeStream();
  } else if (message) {
    // No stream was active — render the final message directly.
    hideThinking();
    const text = extractText(message.content);
    if (text) appendMsg('assistant', text, true);
  } else {
    hideThinking();
  }
  enableInput(true);
  void loadTasks();
}

function finalizeStream() {
  hideThinking();
  if (streamEl) {
    const bubble = streamEl.querySelector('.msg-bubble');
    if (bubble) bubble.classList.remove('cursor-blink');
    streamEl = null;
  }
  streaming = false;
}

// ── Message rendering ────────────────────────────────────────
function appendMsg(role, text, scroll) {
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = text;
  el.appendChild(bubble);
  chatMessages.appendChild(el);
  if (scroll) scrollBottom(true);
  return el;
}

function appendSystemMsg(text) {
  const el = document.createElement('div');
  el.className = 'msg system';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = text;
  el.appendChild(bubble);
  chatMessages.appendChild(el);
  scrollBottom(true);
}

function scrollBottom(smooth) {
  chatMessages.scrollTo({
    top: chatMessages.scrollHeight,
    behavior: smooth ? 'smooth' : 'instant',
  });
}

// ── Tasks ────────────────────────────────────────────────────
function startTaskPoll() {
  clearTaskPoll();
  void loadTasks();
  taskPollTimer = setInterval(() => void loadTasks(), 5000);
}

function clearTaskPoll() {
  if (taskPollTimer) { clearInterval(taskPollTimer); taskPollTimer = null; }
}

async function loadTasks() {
  if (!wsReady || !ws || ws.readyState !== 1) return;
  const res = await call('tasks.status', {});
  const status = res.payload;
  if (!res.ok || res.error || !status) return;
  tasks = [
    ...(status.running || []),
    ...(status.queued || []),
    ...(status.recent || []),
  ];
  renderTasks();
  updateTaskPills(status);
}

function updateTaskPills(status) {
  const running = status.runningCount || 0;
  const queued = status.queuedCount || 0;
  if (running > 0) {
    tasksRunningPill.textContent = running + ' running';
    tasksRunningPill.style.display = 'inline-block';
  } else {
    tasksRunningPill.style.display = 'none';
  }
  if (queued > 0) {
    tasksQueuedPill.textContent = queued + ' queued';
    tasksQueuedPill.style.display = 'inline-block';
  } else {
    tasksQueuedPill.style.display = 'none';
  }
}

function renderTasks() {
  if (tasks.length === 0) {
    tasksList.innerHTML = '<div class="tasks-empty">No tasks yet</div>';
    return;
  }
  tasksList.innerHTML = tasks.map(renderTaskCard).join('');
}

function renderTaskCard(task) {
  const dotClass = task.status;
  const duration = task.completedAt && task.startedAt
    ? formatDuration(task.completedAt - task.startedAt)
    : task.startedAt ? formatDuration(Date.now() - task.startedAt) : '';
  const ts = formatRelTime(task.createdAt);
  const tokens = task.totalTokens ? task.totalTokens.toLocaleString() + ' tok' : '';

  let resultHtml = '';
  if (task.result) {
    resultHtml = '<div class="task-result">' + escEl(task.result.slice(0, 400)) + (task.result.length > 400 ? '…' : '') + '</div>';
  } else if (task.error) {
    resultHtml = '<div class="task-result error">' + escEl(task.error.slice(0, 300)) + '</div>';
  }

  return \`
    <div class="task-card">
      <div class="task-card-top">
        <span class="task-status-dot \${escEl(dotClass)}"></span>
        <span class="task-msg">\${escEl(task.message)}</span>
      </div>
      <div class="task-meta">
        <span>\${escEl(task.status)}</span>
        \${duration ? '<span>' + escEl(duration) + '</span>' : ''}
        \${ts ? '<span>' + escEl(ts) + '</span>' : ''}
        \${tokens ? '<span>' + escEl(tokens) + '</span>' : ''}
      </div>
      \${resultHtml}
    </div>
  \`;
}

// ── Boot ─────────────────────────────────────────────────────
if (token && username) {
  showApp();
  connectWs();
} else {
  showLogin();
}

})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
