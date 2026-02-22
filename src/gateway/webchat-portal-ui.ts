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
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
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
    @media (max-width: 640px) {
      /* font-size: 16px prevents iOS Safari from zooming on textarea focus */
      .chat-textarea { font-size: 16px; min-height: 44px; }
      .send-btn { width: 44px; height: 44px; }
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
      width: 380px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .tasks-header {
      padding: 0 1.25rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: stretch;
      background: var(--surface);
      flex-shrink: 0;
      gap: 0;
    }
    .tab-btn {
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--muted);
      font-size: 0.8rem;
      font-weight: 600;
      padding: 0.7rem 0.6rem 0.55rem;
      cursor: pointer;
      letter-spacing: 0.03em;
      transition: color 0.15s, border-color 0.15s;
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
    .tab-badge {
      background: var(--accent);
      color: #fff;
      font-size: 0.65rem;
      font-weight: 700;
      padding: 0.08rem 0.4rem;
      border-radius: 99px;
      min-width: 16px;
      text-align: center;
    }
    .tab-badge.muted { background: var(--surface2); color: var(--muted); }

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
    .task-card.running { border-color: rgba(108,125,255,0.35); }
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
      align-items: center;
    }
    .task-meta .trigger-tag {
      background: var(--surface2);
      border: 1px solid var(--border);
      padding: 0.05rem 0.4rem;
      border-radius: 99px;
      font-size: 0.68rem;
    }
    .task-activity {
      font-size: 0.75rem;
      color: var(--accent);
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.3rem 0;
    }
    .task-activity .activity-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--accent);
      animation: pulse-dot 1.2s ease-in-out infinite;
    }
    .task-activity .llm-time {
      color: var(--warn);
      font-weight: 600;
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

    /* ── Cron tab ─────────────────────────────────────────────── */
    .cron-status-bar {
      font-size: 0.75rem;
      color: var(--muted);
      padding: 0.5rem 1rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      gap: 0.75rem;
      align-items: center;
      flex-shrink: 0;
      background: var(--surface);
    }
    .cron-status-bar .cron-ok { color: var(--success); font-weight: 600; }
    .cron-status-bar .cron-err { color: var(--error); font-weight: 600; }
    .cron-job-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 0.65rem 0.9rem;
      margin-bottom: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .cron-job-card.disabled { opacity: 0.5; }
    .cron-job-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .cron-job-name {
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--text);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cron-enabled-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .cron-enabled-dot.on { background: var(--success); }
    .cron-enabled-dot.off { background: var(--muted); }
    .cron-job-meta {
      font-size: 0.72rem;
      color: var(--muted);
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .cron-job-meta .cron-tag {
      background: var(--surface2);
      border: 1px solid var(--border);
      padding: 0.05rem 0.4rem;
      border-radius: 99px;
      font-size: 0.68rem;
    }
    .cron-run-list {
      margin-top: 0.3rem;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .cron-run-entry {
      font-size: 0.72rem;
      color: var(--muted);
      display: flex;
      gap: 0.4rem;
      align-items: flex-start;
      border-top: 1px solid var(--border);
      padding-top: 0.25rem;
    }
    .cron-run-ok { color: var(--success); }
    .cron-run-err { color: var(--error); }
    .cron-run-skip { color: var(--warn); }
    .cron-run-summary {
      flex: 1;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 60px;
      overflow-y: auto;
    }
    .cron-run-section { margin-top: 0.4rem; }
    .cron-run-loading {
      font-size: 0.72rem;
      color: var(--muted);
      padding: 0.25rem 0;
    }
    .cron-run-btn {
      font-size: 0.68rem;
      background: var(--surface2);
      border: 1px solid var(--border);
      color: var(--muted);
      border-radius: 4px;
      padding: 0.15rem 0.6rem;
      cursor: pointer;
      margin-top: 0.35rem;
      display: inline-block;
    }
    .cron-run-btn:hover:not(:disabled) { color: var(--text); border-color: var(--muted); }
    .cron-run-btn:disabled { opacity: 0.5; cursor: default; }

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

    /* ── Tasks toggle button (mobile only) ─────────────────────── */
    .tasks-toggle-btn {
      display: none;
      align-items: center;
      gap: 0.35rem;
      background: none;
      border: 1px solid var(--border);
      color: var(--muted);
      border-radius: var(--radius-sm);
      padding: 0.3rem 0.65rem;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
      position: relative;
    }
    .tasks-toggle-btn:hover { color: var(--text); border-color: var(--muted); }
    .tasks-toggle-btn.has-active { color: var(--accent); border-color: rgba(108,125,255,0.5); }
    .tasks-toggle-badge {
      background: var(--accent);
      color: #fff;
      font-size: 0.6rem;
      font-weight: 700;
      padding: 0.05rem 0.35rem;
      border-radius: 99px;
      min-width: 14px;
      text-align: center;
      display: none;
    }
    .tasks-panel-close {
      display: none;
      position: absolute;
      top: 0.75rem;
      right: 1.25rem;
      background: none;
      border: 1px solid var(--border);
      color: var(--muted);
      border-radius: var(--radius-sm);
      padding: 0.35rem 0.75rem;
      font-size: 0.8rem;
      cursor: pointer;
    }

    /* ── Responsive ─────────────────────────────────────────── */
    @media (max-width: 640px) {
      .tasks-toggle-btn { display: flex; }

      /* Tasks panel: hidden by default on mobile, shown as overlay when open */
      .tasks-panel {
        display: none;
        position: fixed;
        inset: 0;
        width: 100%;
        z-index: 100;
        background: var(--bg);
      }
      .tasks-panel.mobile-open { display: flex; }
      .tasks-panel-close { display: block; }
      .tasks-header { padding-right: 90px; } /* make room for close btn */
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
    <button class="tasks-toggle-btn" id="tasks-toggle-btn" title="View background tasks">
      Tasks <span class="tasks-toggle-badge" id="tasks-toggle-badge"></span>
    </button>
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
    <div class="tasks-panel" id="tasks-panel">
      <div class="tasks-header">
        <button class="tab-btn active" id="tab-active" data-tab="active">
          Active <span class="tab-badge" id="badge-active" style="display:none;">0</span>
        </button>
        <button class="tab-btn" id="tab-history" data-tab="history">
          History <span class="tab-badge muted" id="badge-history" style="display:none;">0</span>
        </button>
        <button class="tab-btn" id="tab-cron" data-tab="cron">
          Cron <span class="tab-badge muted" id="badge-cron" style="display:none;">0</span>
        </button>
      </div>
      <div id="cron-status-bar" class="cron-status-bar" style="display:none;"></div>
      <div class="tasks-list" id="tasks-list">
        <div class="tasks-empty">No active tasks</div>
      </div>
      <button class="tasks-panel-close" id="tasks-panel-close">✕ Close</button>
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
let taskTab = 'active';
// taskId → originSessionKey: populated from "created" events so we can filter
// subsequent progress/started/finished events to only show portal-owned tasks.
const taskOrigins = new Map();
let taskProgress = {};  // taskId → { activity, llmStartedAt, lastLlmMs }
let durationTimer = null;
// Cron state — no auto-polling; loaded on demand
let cronJobs = [];
let cronStatusSummary = null;
let cronExpanded = {};        // jobId → bool
let cronRunsState = {};       // jobId → { entries, loading, hasMore }
const CRON_RUNS_PAGE = 20;

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
const tabActive = document.getElementById('tab-active');
const tabHistory = document.getElementById('tab-history');
const tabCron = document.getElementById('tab-cron');
const badgeActive = document.getElementById('badge-active');
const badgeHistory = document.getElementById('badge-history');
const badgeCron = document.getElementById('badge-cron');
const cronStatusBar = document.getElementById('cron-status-bar');
const tasksPanel = document.getElementById('tasks-panel');
const tasksToggleBtn = document.getElementById('tasks-toggle-btn');
const tasksToggleBadge = document.getElementById('tasks-toggle-badge');
const tasksPanelClose = document.getElementById('tasks-panel-close');

// Mobile tasks panel toggle
if (tasksToggleBtn && tasksPanel && tasksPanelClose) {
  tasksToggleBtn.addEventListener('click', () => {
    tasksPanel.classList.add('mobile-open');
  });
  tasksPanelClose.addEventListener('click', () => {
    tasksPanel.classList.remove('mobile-open');
  });
}

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
  cronJobs = [];
  cronExpanded = {};
  cronRunsState = {};
  cronStatusSummary = null;
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
        const errMsg = (msg.error?.message || '').toLowerCase();
        if (errMsg.includes('session expired') || errMsg.includes('sign in again')) {
          sessionStorage.removeItem('portal_token');
          sessionStorage.removeItem('portal_username');
          token = null;
          username = null;
          showLogin();
        }
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

  ws.addEventListener('close', (ev) => {
    setConnected(false);
    wsReady = false;
    const reason = (ev.reason || '').toLowerCase();
    if (reason.includes('session expired') || reason.includes('sign in again')) {
      sessionStorage.removeItem('portal_token');
      sessionStorage.removeItem('portal_username');
      token = null;
      username = null;
      showLogin();
      return;
    }
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

  // ── Session routing guard ────────────────────────────────────────────────
  // The server broadcasts all events to all connected WS clients.  We filter
  // here so this portal user only sees events that belong to their session.
  //
  // chat / agent events carry a sessionKey.  Both the raw form
  // ("portal:<user>") and the canonical form ("agent:<id>:portal:<user>")
  // contain "portal:<user>" as a substring, so we match on that.
  // Events with no sessionKey are always shown (e.g. system events).
  //
  // task events carry originSessionKey (set by the tasks service).
  // We cache originSessionKey per taskId on "created" events and apply it
  // for all subsequent events (started/progress/finished/updated).
  // Tasks with no originSessionKey (e.g. created via API) are shown to all.

  const myPortalSegment = 'portal:' + (username || 'anon').toLowerCase();

  if (ev === 'chat' || ev === 'agent') {
    const sk = (p.sessionKey || '').toLowerCase();
    if (sk && !sk.includes(myPortalSegment)) {
      return; // belongs to a different session
    }
  }

  if (ev === 'task') {
    const tid = p.taskId;
    if (p.action === 'created' && p.task) {
      // Cache the originSessionKey so we can filter later events.
      taskOrigins.set(tid, (p.task.originSessionKey || '').toLowerCase());
    } else if (p.originSessionKey !== undefined) {
      // Server now includes originSessionKey on all events — update cache.
      taskOrigins.set(tid, (p.originSessionKey || '').toLowerCase());
    }
    const osk = taskOrigins.get(tid) ?? '';
    if (osk && !osk.includes(myPortalSegment)) {
      return; // task originated from a different channel (e.g. Feishu)
    }
  }

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

  // ── "task" event — handle task lifecycle + progress
  if (ev === 'task') {
    handleTaskEvent(p);
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

// Tab switching
tabActive.addEventListener('click', () => switchTab('active'));
tabHistory.addEventListener('click', () => switchTab('history'));
tabCron.addEventListener('click', () => switchTab('cron'));

function switchTab(tab) {
  taskTab = tab;
  tabActive.className = 'tab-btn' + (tab === 'active' ? ' active' : '');
  tabHistory.className = 'tab-btn' + (tab === 'history' ? ' active' : '');
  tabCron.className = 'tab-btn' + (tab === 'cron' ? ' active' : '');
  cronStatusBar.style.display = tab === 'cron' ? 'flex' : 'none';
  if (tab === 'cron') {
    // Load on first switch or if job list is empty; otherwise just render cached state.
    if (cronJobs.length === 0) {
      void loadCronData();
    } else {
      renderCronTab();
    }
  } else {
    renderTasks();
  }
}

function startTaskPoll() {
  clearTaskPoll();
  void loadTasks();
  taskPollTimer = setInterval(() => void loadTasks(), 8000);
  startDurationTimer();
}

function clearTaskPoll() {
  if (taskPollTimer) { clearInterval(taskPollTimer); taskPollTimer = null; }
  if (durationTimer) { clearInterval(durationTimer); durationTimer = null; }
}

function startDurationTimer() {
  if (durationTimer) return;
  durationTimer = setInterval(() => {
    const runningTasks = tasks.filter(t => t.status === 'running' || t.status === 'queued');
    if (runningTasks.length === 0) return;
    document.querySelectorAll('.task-live-duration').forEach(el => {
      const startedAt = parseInt(el.dataset.startedAt);
      if (startedAt) el.textContent = formatDuration(Date.now() - startedAt);
    });
  }, 1000);
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
  updateBadges(status);
  renderTasks();
}

function handleTaskEvent(evt) {
  const id = evt.taskId;
  if (!id) return;

  if (evt.action === 'progress' && evt.event) {
    const stream = evt.event.stream;
    const data = evt.event.data || {};
    if (!taskProgress[id]) taskProgress[id] = {};
    const tp = taskProgress[id];

    if (stream === 'lifecycle') {
      // Backend emits phase "start" (run/LLM start) and "end" (run/LLM end), not llm-start/llm-end.
      if (data.phase === 'llm-start' || (data.phase === 'start' && !data.name)) {
        tp.llmStartedAt = Date.now();
        tp.activity = 'Calling LLM…';
      } else if (data.phase === 'llm-end' || data.phase === 'end') {
        tp.lastLlmMs = tp.llmStartedAt ? Date.now() - tp.llmStartedAt : (data.durationMs || 0);
        tp.llmStartedAt = null;
        tp.activity = 'LLM responded';
      } else if (data.phase === 'tool-start') {
        tp.activity = 'Tool: ' + (data.toolName || data.name || '…');
        tp.llmStartedAt = null;
      } else if (data.phase === 'tool-end') {
        tp.activity = null;
      }
    } else if (stream === 'tool') {
      // Backend emits phase "start" (tool start) and "result" (tool end).
      if (data.phase === 'result') {
        tp.activity = null;
      } else {
        tp.activity = 'Tool: ' + (data.name || data.toolName || '…');
        tp.llmStartedAt = null;
      }
    } else if (stream === 'assistant') {
      tp.activity = 'Generating…';
    }

    updateTaskActivityUI(id);
    return;
  }

  if (evt.action === 'created' || evt.action === 'started' || evt.action === 'finished') {
    void loadTasks();
    if (evt.action === 'finished') {
      delete taskProgress[id];
    }
  }
}

function updateTaskActivityUI(taskId) {
  const el = document.getElementById('task-activity-' + taskId);
  if (!el) { renderTasks(); return; }
  const tp = taskProgress[taskId] || {};
  if (tp.activity) {
    let html = '<span class="activity-dot"></span> ' + escEl(tp.activity);
    if (tp.llmStartedAt) {
      html += ' <span class="llm-time">' + formatDuration(Date.now() - tp.llmStartedAt) + '</span>';
    } else if (tp.lastLlmMs) {
      html += ' <span class="llm-time">' + formatDuration(tp.lastLlmMs) + '</span>';
    }
    el.innerHTML = html;
    el.style.display = 'flex';
  } else {
    el.style.display = 'none';
  }
}

function updateBadges(status) {
  const activeN = (status.runningCount || 0) + (status.queuedCount || 0);
  const historyN = status.recentCount || 0;
  if (activeN > 0) {
    badgeActive.textContent = activeN;
    badgeActive.style.display = 'inline-block';
  } else {
    badgeActive.style.display = 'none';
  }
  if (historyN > 0) {
    badgeHistory.textContent = historyN;
    badgeHistory.style.display = 'inline-block';
  } else {
    badgeHistory.style.display = 'none';
  }
  // Update mobile toggle button badge
  if (tasksToggleBtn && tasksToggleBadge) {
    if (activeN > 0) {
      tasksToggleBtn.classList.add('has-active');
      tasksToggleBadge.textContent = activeN;
      tasksToggleBadge.style.display = 'inline-block';
    } else {
      tasksToggleBtn.classList.remove('has-active');
      tasksToggleBadge.style.display = 'none';
    }
  }
}

function renderTasks() {
  const activeTasks = tasks.filter(t => t.status === 'running' || t.status === 'queued');
  const historyTasks = tasks.filter(t => t.status !== 'running' && t.status !== 'queued');
  const display = taskTab === 'active' ? activeTasks : historyTasks;

  if (display.length === 0) {
    const emptyMsg = taskTab === 'active' ? 'No active tasks' : 'No task history';
    tasksList.innerHTML = '<div class="tasks-empty">' + emptyMsg + '</div>';
    return;
  }
  tasksList.innerHTML = display.map(renderTaskCard).join('');
}

function resolveTrigger(task) {
  if (task.originChannel) return task.originChannel;
  if (task.originSessionKey) {
    const sk = task.originSessionKey;
    if (sk.startsWith('portal:')) return 'portal';
    if (sk.includes(':')) return sk.split(':')[0];
    return sk;
  }
  return 'heartbeat';
}

function renderTaskCard(task) {
  const isActive = task.status === 'running' || task.status === 'queued';
  const duration = task.completedAt && task.startedAt
    ? formatDuration(task.completedAt - task.startedAt)
    : '';
  const ts = formatRelTime(task.createdAt);
  const tokens = task.totalTokens ? task.totalTokens.toLocaleString() + ' tok' : '';
  const trigger = resolveTrigger(task);

  let activityHtml = '';
  if (isActive) {
    const tp = taskProgress[task.id] || {};
    let actContent = '';
    if (tp.activity) {
      actContent = '<span class="activity-dot"></span> ' + escEl(tp.activity);
      if (tp.llmStartedAt) {
        actContent += ' <span class="llm-time">' + formatDuration(Date.now() - tp.llmStartedAt) + '</span>';
      } else if (tp.lastLlmMs) {
        actContent += ' <span class="llm-time">' + formatDuration(tp.lastLlmMs) + '</span>';
      }
    } else {
      // No progress yet: show fallback so user sees "running" means the worker is active.
      actContent = '<span class="activity-dot"></span> Running…';
    }
    activityHtml = '<div class="task-activity" id="task-activity-' + escEl(task.id) + '" style="' + (actContent ? '' : 'display:none;') + '">' + actContent + '</div>';
  }

  let resultHtml = '';
  if (!isActive && task.result) {
    resultHtml = '<div class="task-result">' + escEl(task.result) + '</div>';
  } else if (!isActive && task.error) {
    resultHtml = '<div class="task-result error">' + escEl(task.error) + '</div>';
  }

  const liveDuration = isActive && task.startedAt
    ? '<span class="task-live-duration" data-started-at="' + task.startedAt + '">' + formatDuration(Date.now() - task.startedAt) + '</span>'
    : '';

  return \`
    <div class="task-card\${isActive ? ' running' : ''}">
      <div class="task-card-top">
        <span class="task-status-dot \${escEl(task.status)}"></span>
        <span class="task-msg">\${escEl(task.message)}</span>
      </div>
      <div class="task-meta">
        <span>\${escEl(task.status)}</span>
        <span class="trigger-tag">\${escEl(trigger)}</span>
        \${isActive && liveDuration ? liveDuration : ''}
        \${!isActive && duration ? '<span>' + escEl(duration) + '</span>' : ''}
        \${ts ? '<span>' + escEl(ts) + '</span>' : ''}
        \${tokens ? '<span>' + escEl(tokens) + '</span>' : ''}
      </div>
      \${activityHtml}
      \${resultHtml}
    </div>
  \`;
}

// ── Cron ─────────────────────────────────────────────────────
// Load only job list + status; run history is fetched lazily per job.
async function loadCronData() {
  if (!wsReady || !ws || ws.readyState !== 1) return;
  renderCronStatusBar('Loading…');
  const [statusRes, listRes] = await Promise.all([
    call('cron.status', {}),
    call('cron.list', { includeDisabled: true }),
  ]);
  if (statusRes.ok && statusRes.payload) cronStatusSummary = statusRes.payload;
  if (listRes.ok && listRes.payload && Array.isArray(listRes.payload.jobs)) {
    cronJobs = listRes.payload.jobs;
    if (badgeCron) {
      if (cronJobs.length > 0) {
        badgeCron.textContent = cronJobs.length;
        badgeCron.style.display = 'inline-block';
      } else {
        badgeCron.style.display = 'none';
      }
    }
  }
  if (taskTab === 'cron') renderCronTab();
}

// Fetch the first page of runs for a job and expand it.
async function expandCronJob(jobId) {
  cronExpanded[jobId] = true;
  if (!cronRunsState[jobId]) {
    cronRunsState[jobId] = { entries: [], loading: true, hasMore: true };
    renderCronJobRunsSection(jobId);
    const res = await call('cron.runs', { id: jobId, limit: CRON_RUNS_PAGE });
    const entries = (res.ok && res.payload && Array.isArray(res.payload.entries))
      ? res.payload.entries : [];
    cronRunsState[jobId] = {
      entries,
      loading: false,
      hasMore: entries.length >= CRON_RUNS_PAGE,
    };
  }
  renderCronJobRunsSection(jobId);
}

// Load more (older) runs for a job using beforeTs cursor.
async function loadMoreCronRuns(jobId) {
  const state = cronRunsState[jobId];
  if (!state || state.loading) return;
  state.loading = true;
  renderCronJobRunsSection(jobId);
  const oldest = state.entries.length > 0 ? state.entries[0].ts : undefined;
  const res = await call('cron.runs', { id: jobId, limit: CRON_RUNS_PAGE, beforeTs: oldest });
  const more = (res.ok && res.payload && Array.isArray(res.payload.entries))
    ? res.payload.entries : [];
  state.entries = [...more, ...state.entries];
  state.loading = false;
  state.hasMore = more.length >= CRON_RUNS_PAGE;
  renderCronJobRunsSection(jobId);
}

// Re-render only the runs section of a single expanded job card (no full list re-render).
function renderCronJobRunsSection(jobId) {
  const el = document.getElementById('cron-runs-' + jobId);
  if (!el) return;
  el.innerHTML = buildCronRunsSectionHtml(jobId);
}

function buildCronRunsSectionHtml(jobId) {
  const state = cronRunsState[jobId];
  if (!state) return '';
  if (state.loading && state.entries.length === 0) {
    return '<div class="cron-run-loading">Loading…</div>';
  }
  const entries = state.entries;
  const runsHtml = entries.length === 0
    ? '<div class="cron-run-loading">No runs recorded yet</div>'
    : entries.map(r => {
        const statusClass = r.status === 'ok' ? 'cron-run-ok' : r.status === 'error' ? 'cron-run-err' : 'cron-run-skip';
        const statusIcon = r.status === 'ok' ? '✓' : r.status === 'error' ? '✗' : '—';
        const timeAgo = r.ts ? formatRelTime(r.ts) : '';
        const dur = r.durationMs ? formatDuration(r.durationMs) : '';
        const tok = r.usage && r.usage.total_tokens ? r.usage.total_tokens.toLocaleString() + ' tok' : '';
        const text = r.summary || (r.status === 'error' && r.error ? r.error : '');
        return \`<div class="cron-run-entry">
          <span class="\${statusClass}">\${statusIcon}</span>
          <div class="cron-run-summary">
            \${timeAgo ? '<span style="color:var(--muted)">' + escEl(timeAgo) + '</span> ' : ''}
            \${dur ? '<span>' + escEl(dur) + '</span> ' : ''}
            \${tok ? '<span>' + escEl(tok) + '</span>' : ''}
            \${text ? '<div>' + escEl(text) + '</div>' : ''}
          </div>
        </div>\`;
      }).join('');

  const moreBtn = state.hasMore
    ? \`<button class="cron-run-btn" onclick="loadMoreCronRuns('\${escEl(jobId)}')" \${state.loading ? 'disabled' : ''}>
        \${state.loading ? 'Loading…' : 'Load older'}
      </button>\`
    : (entries.length > 0 ? '<div class="cron-run-loading" style="font-size:0.68rem">No more history</div>' : '');

  return '<div class="cron-run-list">' + runsHtml + '</div>' + moreBtn;
}

function renderCronStatusBar(msg) {
  if (!cronStatusBar) return;
  if (msg) {
    cronStatusBar.innerHTML = '<span>' + escEl(msg) + '</span>'
      + '<button class="cron-run-btn" style="margin-left:auto" onclick="void loadCronData()">Refresh</button>';
    return;
  }
  const s = cronStatusSummary;
  if (!s) return;
  const enabledHtml = s.enabled
    ? '<span class="cron-ok">● Enabled</span>'
    : '<span class="cron-err">● Disabled</span>';
  const jobsHtml = '<span>Jobs: ' + escEl(String(s.jobs ?? cronJobs.length)) + '</span>';
  let nextHtml = '';
  if (s.nextWakeAtMs) {
    const diff = s.nextWakeAtMs - Date.now();
    nextHtml = diff > 0
      ? '<span>Next: ' + escEl(formatDuration(diff)) + '</span>'
      : '<span>Next: soon</span>';
  }
  cronStatusBar.innerHTML = enabledHtml + jobsHtml + nextHtml
    + '<button class="cron-run-btn" style="margin-left:auto" onclick="void loadCronData()">Refresh</button>';
}

function renderCronTab() {
  renderCronStatusBar(null);
  if (cronJobs.length === 0) {
    tasksList.innerHTML = '<div class="tasks-empty">No cron jobs configured</div>';
    return;
  }
  tasksList.innerHTML = cronJobs.map(renderCronJobCard).join('');
}

function formatCronSchedule(job) {
  const sch = job.schedule;
  if (!sch) return '';
  // Protocol schedule uses "kind" field (not "type").
  if (sch.kind === 'cron') return sch.expr || '';
  if (sch.kind === 'every') {
    const ms = sch.everyMs;
    if (!ms) return 'every ?';
    if (ms < 60000) return 'every ' + (ms / 1000).toFixed(0) + 's';
    if (ms < 3600000) return 'every ' + (ms / 60000).toFixed(0) + 'm';
    if (ms < 86400000) return 'every ' + (ms / 3600000).toFixed(1) + 'h';
    return 'every ' + (ms / 86400000).toFixed(1) + 'd';
  }
  if (sch.kind === 'at') {
    const d = sch.at ? new Date(sch.at) : null;
    return 'at ' + (d ? d.toLocaleString() : String(sch.at || ''));
  }
  return JSON.stringify(sch);
}

function renderCronJobCard(job) {
  const enabled = job.enabled !== false;
  const state = job.state || {};
  const lastStatus = state.lastStatus;
  const lastRunAt = state.lastRunAtMs ? formatRelTime(state.lastRunAtMs) : null;
  const nextRunAt = state.nextRunAtMs
    ? (state.nextRunAtMs > Date.now()
        ? formatDuration(state.nextRunAtMs - Date.now())
        : 'soon')
    : null;

  const lastStatusBadge = lastStatus
    ? (lastStatus === 'ok'
        ? '<span class="cron-run-ok">✓</span>'
        : lastStatus === 'error'
          ? '<span class="cron-run-err">✗</span>'
          : '<span class="cron-run-skip">—</span>')
    : '';

  const isExpanded = !!cronExpanded[job.id];
  const chevron = isExpanded ? '▾' : '▸';
  // Inline onclick expands/collapses; toggle is handled via global functions exposed below.
  const headerOnclick = isExpanded
    ? \`collapseCronJob('\${escEl(job.id)}')\`
    : \`expandCronJob('\${escEl(job.id)}')\`;

  const runsSection = isExpanded
    ? \`<div id="cron-runs-\${escEl(job.id)}" class="cron-run-section">\${buildCronRunsSectionHtml(job.id)}</div>\`
    : \`<div id="cron-runs-\${escEl(job.id)}" class="cron-run-section" style="display:none;"></div>\`;

  return \`<div class="cron-job-card\${enabled ? '' : ' disabled'}">
    <div class="cron-job-header" onclick="\${headerOnclick}" style="cursor:pointer">
      <span class="cron-enabled-dot \${enabled ? 'on' : 'off'}"></span>
      <span class="cron-job-name">\${escEl(job.name || job.id)}</span>
      \${lastStatusBadge}
      <span style="color:var(--muted);font-size:0.75rem;margin-left:auto">\${chevron}</span>
    </div>
    <div class="cron-job-meta">
      <span class="cron-tag">\${escEl(formatCronSchedule(job))}</span>
      \${nextRunAt ? '<span>Next: ' + escEl(nextRunAt) + '</span>' : ''}
      \${lastRunAt ? '<span>Last: ' + escEl(lastRunAt) + '</span>' : ''}
    </div>
    \${job.description ? '<div style="font-size:0.72rem;color:var(--muted);margin-top:0.15rem">' + escEl(job.description) + '</div>' : ''}
    \${runsSection}
  </div>\`;
}

function collapseCronJob(jobId) {
  cronExpanded[jobId] = false;
  // Re-render just this card.
  renderCronTab();
}

// Expose cron interaction functions to global scope for inline onclick handlers.
window.expandCronJob = expandCronJob;
window.collapseCronJob = collapseCronJob;
window.loadMoreCronRuns = loadMoreCronRuns;
window.loadCronData = loadCronData;

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
