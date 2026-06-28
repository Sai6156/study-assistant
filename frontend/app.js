/* ════════════════════════════════════════════════════════════════════
   Study Assistant — app.js
   NotebookLM-faithful 3-panel layout + Auth
════════════════════════════════════════════════════════════════════ */

"use strict";

const API = window.VSA_CONFIG?.API_BASE ?? (
  (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://localhost:3000"
    : "https://voice-study-assistant-api.onrender.com"
);
const USE_STREAMING = true;

// ─── Auth guard ───────────────────────────────────────────────────
let currentUser = null;
let authToken   = null;
let NB_STORAGE_KEY = "sa_notebooks_v2"; // overridden per-user below

(function checkAuth() {
  try {
    const raw = localStorage.getItem("sa_auth");
    if (!raw) { location.replace("auth.html"); return; }
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.user) { location.replace("auth.html"); return; }
    currentUser = parsed.user;
    authToken   = parsed.token;
    // User-scoped storage key so notebooks don't mix between users
    NB_STORAGE_KEY = `sa_notebooks_v2_${currentUser.uid}`;
  } catch {
    location.replace("auth.html");
  }
})();

function getAuthHeaders() {
  return { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` };
}

function activeNbKey() {
  return currentUser ? `sa_active_nb_${currentUser.uid}` : "sa_active_nb";
}

function activeChatKey(nbId) {
  return currentUser ? `sa_active_chat_${currentUser.uid}_${nbId}` : `sa_active_chat_${nbId}`;
}

function signOut() {
  if (!confirm("Sign out of Study Assistant?")) return;
  localStorage.removeItem("sa_auth");
  location.replace("auth.html");
}

// ─── marked / hljs config ─────────────────────────────────────────
if (window.marked) {
  marked.setOptions({
    highlight: (code, lang) => {
      if (window.hljs) {
        const l = hljs.getLanguage(lang) ? lang : "plaintext";
        return hljs.highlight(code, { language: l }).value;
      }
      return code;
    },
    breaks: true,
    gfm: true,
  });
}
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
}

// ─── State ───────────────────────────────────────────────────────────
const state = {
  notebooks:        {},
  activeNotebookId: null,
  activeChat:       null,
  defaultLang:      "English",
  voiceEnabled:     true,
  speed:            1,
  currentMindMap:   null,
  currentAudio:     null,
};

// ─── Storage helpers (server merge via sync.js) ───────────────────
const { mergeNotebooks, notebooksEqual, touchNotebook } = window.VSA_SYNC;

let _serverSyncTimer = null;
let _notebooksUpdatedAt = 0;
let _syncInFlight = null;

function touchActiveNotebook() {
  if (state.activeNotebookId && state.notebooks[state.activeNotebookId]) {
    touchNotebook(state.notebooks[state.activeNotebookId]);
  }
}

function saveNotebooks() {
  touchActiveNotebook();
  try { localStorage.setItem(NB_STORAGE_KEY, JSON.stringify(state.notebooks)); }
  catch (e) {
    for (const nb of Object.values(state.notebooks)) {
      if (nb.studioOutputs?.length > 5) nb.studioOutputs = nb.studioOutputs.slice(0, 5);
    }
    try { localStorage.setItem(NB_STORAGE_KEY, JSON.stringify(state.notebooks)); } catch {}
  }
  scheduleServerNotebookSync();
}

async function fetchServerNotebooks() {
  if (!authToken) return { notebooks: {}, updatedAt: 0 };
  return window.VSA_SYNC.fetchServerNotebooks(authToken);
}

function scheduleServerNotebookSync() {
  if (!authToken || !currentUser?.uid) return;
  clearTimeout(_serverSyncTimer);
  _serverSyncTimer = setTimeout(() => { syncNotebooksToServer(); }, 700);
}

async function syncNotebooksToServer() {
  if (!authToken || !currentUser?.uid) return;
  if (_syncInFlight) return _syncInFlight;
  _syncInFlight = (async () => {
    try {
      const data = await window.VSA_SYNC.putServerNotebooks(authToken, state.notebooks);
      _notebooksUpdatedAt = Number(data.updatedAt) || Date.now();
      if (data.notebooks && typeof data.notebooks === "object") {
        state.notebooks = data.notebooks;
        localStorage.setItem(NB_STORAGE_KEY, JSON.stringify(data.notebooks));
      }
    } catch (e) {
      toast("Sync failed — changes may not appear on other devices");
      console.error("Notebook sync failed:", e);
    } finally {
      _syncInFlight = null;
    }
  })();
  return _syncInFlight;
}

function flushServerNotebookSync() {
  clearTimeout(_serverSyncTimer);
  if (!authToken || !currentUser?.uid) return;
  fetch(`${API}/api/notebooks`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ notebooks: state.notebooks }),
    keepalive: true,
  }).catch(() => {});
}

function loadNotebooks() {
  try { const r = localStorage.getItem(NB_STORAGE_KEY); if (r) return JSON.parse(r); }
  catch {}
  return null;
}

function makeId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function nb()         { return state.notebooks[state.activeNotebookId]; }
function nbSources()  { return nb()?.sources       || []; }
function nbChats()    { return nb()?.chats          || []; }
function nbNotes()    { return nb()?.notes          || []; }
function nbOutputs()  { return nb()?.studioOutputs  || []; }
function activeChat() { return nbChats().find(c => c.id === state.activeChat); }

// ─── Migrate old data (scoped per user — never steal another account's keys) ──
function migrateOldData() {
  if (!currentUser?.uid) return null;
  const legacyKey = `sa_legacy_migrated_${currentUser.uid}`;
  if (localStorage.getItem(legacyKey)) return null;

  const oldSources = localStorage.getItem("sa_sources");
  const oldChats   = localStorage.getItem("sa_chats");
  const oldNotes   = localStorage.getItem("sa_notes");
  const legacyNotebooks = localStorage.getItem("sa_notebooks_v2");
  if (!oldSources && !oldChats && !oldNotes && !legacyNotebooks) return null;

  localStorage.setItem(legacyKey, "1");

  if (legacyNotebooks) {
    try {
      const parsed = JSON.parse(legacyNotebooks);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        ["sa_sources", "sa_chats", "sa_notes", "sa_notebooks_v2"].forEach(k => localStorage.removeItem(k));
        return { all: parsed };
      }
    } catch {}
  }

  if (!oldSources && !oldChats && !oldNotes) return null;
  ["sa_sources", "sa_chats", "sa_notes", "sa_notebooks_v2"].forEach(k => localStorage.removeItem(k));
  return {
    id: "default", name: "My Notebook", emoji: "📓",
    sources: JSON.parse(oldSources || "[]"),
    chats:   JSON.parse(oldChats   || "[]"),
    notes:   JSON.parse(oldNotes   || "[]"),
    studioOutputs: [],
  };
}

function applyNotebookState(saved) {
  state.notebooks = saved;
  for (const n of Object.values(state.notebooks)) {
    if (!n.studioOutputs) n.studioOutputs = [];
  }
  state.activeNotebookId = localStorage.getItem(activeNbKey()) || Object.keys(saved)[0];
  if (!state.notebooks[state.activeNotebookId]) {
    state.activeNotebookId = Object.keys(saved)[0];
  }
  const chats = nbChats();
  if (!chats.length) createNewChat();
  else {
    const last = localStorage.getItem(activeChatKey(state.activeNotebookId));
    state.activeChat = (last && chats.find(c => c.id === last)) ? last : chats[chats.length - 1].id;
  }
}

async function initNotebooks() {
  setStatus("Syncing notebooks…");
  const local = loadNotebooks() || {};
  const remote = await fetchServerNotebooks();
  const remoteNotebooks = remote?.notebooks || {};

  let merged = mergeNotebooks(local, remoteNotebooks);

  const migrated = migrateOldData();
  if (migrated?.all) {
    merged = mergeNotebooks(merged, migrated.all);
  } else if (migrated && Object.keys(merged).length === 0) {
    const id = "nb_" + makeId();
    const n = { ...migrated, id, studioOutputs: migrated.studioOutputs || [] };
    merged = { [id]: n };
  }

  if (Object.keys(merged).length === 0) {
    const id = "nb_" + makeId();
    merged[id] = {
      id, name: "My Notebook", emoji: "📓",
      sources: [], chats: [], notes: [], studioOutputs: [],
      updatedAt: Date.now(),
    };
  }

  state.notebooks = merged;
  localStorage.setItem(NB_STORAGE_KEY, JSON.stringify(merged));
  _notebooksUpdatedAt = remote.updatedAt || 0;

  const needsUpload = !notebooksEqual(merged, remoteNotebooks);
  if (needsUpload) {
    try {
      const data = await window.VSA_SYNC.putServerNotebooks(authToken, merged);
      _notebooksUpdatedAt = Number(data.updatedAt) || Date.now();
      if (data.notebooks && typeof data.notebooks === "object") {
        state.notebooks = data.notebooks;
        localStorage.setItem(NB_STORAGE_KEY, JSON.stringify(data.notebooks));
      }
      toast("Notebooks synced");
    } catch (e) {
      toast("Sync failed — open the profile with your sources and refresh");
      console.error("Initial notebook sync failed:", e);
    }
  }

  applyNotebookState(state.notebooks);
  setStatus("");
}

function createNotebook(name = "New Notebook") {
  const id = "nb_" + makeId();
  const n = { id, name, emoji: "📓", sources: [], chats: [], notes: [], studioOutputs: [], updatedAt: Date.now() };
  state.notebooks[id] = n;
  saveNotebooks();
  return id;
}

function switchNotebook(id) {
  if (!state.notebooks[id]) return;
  state.activeNotebookId = id;
  localStorage.setItem(activeNbKey(), id);
  const chats = nb().chats;
  if (!chats.length) createNewChat();
  else {
    const last = localStorage.getItem(activeChatKey(id));
    state.activeChat = (last && chats.find(c => c.id === last)) ? last : chats[chats.length - 1].id;
  }
  render();
}

function deleteNotebook(id) {
  if (Object.keys(state.notebooks).length <= 1) { toast("Can't delete the last notebook"); return; }
  delete state.notebooks[id];
  if (state.activeNotebookId === id) state.activeNotebookId = Object.keys(state.notebooks)[0];
  saveNotebooks();
  render();
}

function renameNotebook(id, name) {
  if (!state.notebooks[id] || !name?.trim()) return;
  state.notebooks[id].name = name.trim();
  saveNotebooks();
  renderNotebookDropdown();
  updateNbTitle();
}

function saveNb() {
  saveNotebooks();
  localStorage.setItem(activeNbKey(), state.activeNotebookId);
  if (state.activeChat) localStorage.setItem(activeChatKey(state.activeNotebookId), state.activeChat);
}

// ─── Studio Output persistence ────────────────────────────────────
const TYPE_ICONS = {
  mindmap:"🗺", slides:"🖼", report:"📋", flashcards:"🃏", quiz:"❓",
  datatable:"📊", audio:"🎙", faq:"💬", briefing:"📄", outline:"📑",
  explain:"💡", resources:"📚", infographic:"🦋",
};

function saveStudioOutput(type, title, data) {
  if (!nb()) return;
  if (!nb().studioOutputs) nb().studioOutputs = [];
  // Strip audio bytes from stored data (too large)
  const stored = type === "audio"
    ? { title: data.title, segments: data.segments }
    : data;
  nb().studioOutputs.unshift({ id: "so_" + makeId(), type, title, data: stored, createdAt: Date.now() });
  if (nb().studioOutputs.length > 30) nb().studioOutputs = nb().studioOutputs.slice(0, 30);
  saveNb();
  renderStudioOutputs();
}

function renderStudioOutputs() {
  const list = $("studio-saved-list");
  if (!list) return;
  const outputs = nbOutputs();
  if (!outputs.length) {
    list.innerHTML = `<div class="studio-saved-empty">Generated content will appear here.<br>Click any studio card above to create.</div>`;
    return;
  }
  list.innerHTML = "";
  for (const out of outputs) {
    const item = el("div", { class: "studio-saved-item" });
    const date = new Date(out.createdAt);
    const dateStr = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    item.innerHTML = `
      <span class="ssi-icon">${TYPE_ICONS[out.type] || "📌"}</span>
      <div class="ssi-info">
        <div class="ssi-title">${esc(out.title)}</div>
        <div class="ssi-meta">
          <span class="ssi-type">${out.type}</span>
          <span class="ssi-date">${dateStr}</span>
        </div>
      </div>
      <button class="ssi-del" title="Delete">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>
      </button>`;
    item.addEventListener("click", (e) => {
      if (e.target.closest(".ssi-del")) return;
      reopenStudioOutput(out);
    });
    item.querySelector(".ssi-del").addEventListener("click", (e) => {
      e.stopPropagation();
      nb().studioOutputs = nb().studioOutputs.filter(o => o.id !== out.id);
      saveNb(); renderStudioOutputs();
    });
    list.appendChild(item);
  }
}

function reopenStudioOutput(out) {
  if (state.currentMindMap) { state.currentMindMap.destroy(); state.currentMindMap = null; }
  $("studio-output-overlay").classList.remove("hidden");
  const { type, title, data } = out;
  if (type === "flashcards") fcKnown = new Set();
  if (type === "quiz") { quizQuestions = []; quizIdx = 0; quizScore = 0; }
  if      (type === "slides")     renderSlides(data);
  else if (type === "mindmap")    renderMindMap(data);
  else if (type === "flashcards") renderFlashcards(data.cards);
  else if (type === "quiz")       renderQuiz(data.questions);
  else if (type === "datatable")  renderDataTable(data);
  else if (type === "audio")      renderAudioOverview(data);
  else if (type === "faq")        renderFAQ(data);
  else if (type === "briefing")   renderBriefing(data);
  else if (type === "outline")    renderOutline(data);
  else if (type === "resources")   renderStudyResources(data);
  else if (type === "infographic") renderInfographic(data);
  else if (type === "explain") {
    // Navigate to the source message, then replay the explanation audio
    if (data.chatId && data.msgId) {
      const chats = nbChats();
      const chat = chats.find(c => c.id === data.chatId);
      if (chat) { switchChat(data.chatId); renderThread(); }
      // Scroll to message after render
      requestAnimationFrame(() => {
        const msgEl = document.getElementById(`msg-${data.msgId}`);
        if (msgEl) {
          msgEl.scrollIntoView({ behavior: "smooth", block: "center" });
          msgEl.classList.add("explain-highlight");
          setTimeout(() => msgEl.classList.remove("explain-highlight"), 1800);
        }
        // Replay the audio
        playExplainAudio(data.explanation, data.lang || "English", data.level || "");
      });
    } else {
      playExplainAudio(data.explanation, data.lang || "English", data.level || "");
    }
  }
  else if (type === "report") {
    openSOP(title, `<div class="report-body md-body">${renderMd(data.report)}</div>`, [
      { label: "📋 Copy", handler: () => { navigator.clipboard?.writeText(data.report); toast("Copied!"); } },
    ]);
  }
}

// ─── Chat helpers ────────────────────────────────────────────────
function createNewChat(name) {
  const id = "chat_" + makeId();
  nb().chats.push({ id, name: name || "Chat", messages: [], createdAt: Date.now() });
  state.activeChat = id;
  saveNb();
  return id;
}

function switchChat(id) {
  if (!nbChats().find(c => c.id === id)) return;
  state.activeChat = id;
  localStorage.setItem(activeChatKey(state.activeNotebookId), id);
  renderThread();
  renderChatTabs();
}

function deleteChat(id) {
  const chats = nb().chats;
  if (chats.length <= 1) { toast("Can't delete the last chat"); return; }
  nb().chats = chats.filter(c => c.id !== id);
  if (state.activeChat === id) state.activeChat = nb().chats[nb().chats.length - 1].id;
  saveNb(); renderChatTabs(); renderThread();
}

// ─── Sources ─────────────────────────────────────────────────────
function addSource(src) {
  const id = "src_" + makeId();
  const source = { id, type: src.type || "text", title: src.title || "Untitled",
    text: src.text || "", url: src.url || null, summary: null, enabled: true, createdAt: Date.now() };
  nb().sources.push(source);
  saveNb(); renderSourceList(); updateSourceCountPill();
  autoSummary(source);
  return source;
}

function deleteSource(id) {
  nb().sources = nbSources().filter(s => s.id !== id);
  saveNb(); renderSourceList(); updateSourceCountPill();
}

async function autoSummary(source) {
  if (source.summary || source.text.length < 200) return;
  try {
    const res = await fetch(`${API}/api/summary`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: source.text.slice(0, 6000) }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.summary) { source.summary = data.summary; saveNb(); }
  } catch {}
}

// ─── Main render ────────────────────────────────────────────────
function render() {
  renderNotebookDropdown();
  updateNbTitle();
  renderSourceList();
  updateSourceCountPill();
  renderChatTabs();
  renderThread();
  renderNotesList();
  renderStudioOutputs();
}

function updateNbTitle() {
  const n = nb();
  $("nb-current-title").textContent = n ? n.name : "Untitled";
}

function renderNotebookDropdown() {
  const list = $("nb-dropdown-list");
  list.innerHTML = "";
  for (const [id, n] of Object.entries(state.notebooks)) {
    const item = el("div", { class: "nb-item" + (id === state.activeNotebookId ? " active" : "") });
    item.innerHTML = `
      <span class="nb-item-icon">${n.emoji || "📓"}</span>
      <span class="nb-item-name" data-id="${id}">${esc(n.name)}</span>
      <button class="nb-item-rename" title="Rename" data-id="${id}">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="11" height="11"><path d="M11.5 2.5a1.5 1.5 0 0 1 2 2L5 13l-3 1 1-3 8.5-8.5z"/></svg>
      </button>
      <button class="nb-item-del" title="Delete" data-id="${id}">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>
      </button>`;
    item.addEventListener("click", (e) => {
      if (e.target.closest(".nb-item-del") || e.target.closest(".nb-item-rename")) return;
      switchNotebook(id); closeNbDropdown();
    });
    item.querySelector(".nb-item-rename").addEventListener("click", (e) => {
      e.stopPropagation();
      const current = state.notebooks[id]?.name || "";
      const newName = prompt("Rename notebook:", current);
      if (newName?.trim()) { renameNotebook(id, newName); closeNbDropdown(); }
    });
    item.querySelector(".nb-item-del").addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Delete notebook "${n.name}"?`)) { deleteNotebook(id); closeNbDropdown(); }
    });
    list.appendChild(item);
  }
}

function renderSourceList() {
  const list = $("sources-list");
  const sources = nbSources();
  if (!sources.length) {
    list.innerHTML = `<div class="source-empty">No sources yet.<br>Click "Add sources" to begin.</div>`;
  } else {
    list.innerHTML = "";
    for (const src of sources) {
      const card = el("div", { class: "source-card" });
      card.innerHTML = `
        <input type="checkbox" ${src.enabled ? "checked" : ""} title="Include in answers" />
        <div class="source-card-body">
          <div class="source-type-badge type-${src.type}">${src.type.toUpperCase()}</div>
          <div class="source-card-title">${esc(src.title)}</div>
        </div>
        <button class="source-card-del" title="Remove source">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>
        </button>`;
      card.querySelector("input").addEventListener("change", (e) => {
        src.enabled = e.target.checked; saveNb(); updateSourceCountPill();
      });
      card.querySelector(".source-card-del").addEventListener("click", (e) => {
        e.stopPropagation(); deleteSource(src.id);
      });
      card.addEventListener("click", (e) => {
        if (e.target.closest("input") || e.target.closest(".source-card-del")) return;
        showSourceViewer(src);
      });
      list.appendChild(card);
    }
  }
  const saEl = $("select-all-sources");
  if (saEl && sources.length) {
    const all  = sources.every(s => s.enabled);
    const none = sources.every(s => !s.enabled);
    saEl.checked = all; saEl.indeterminate = !all && !none;
  }
}

function updateSourceCountPill() {
  const active = nbSources().filter(s => s.enabled).length;
  const total  = nbSources().length;
  $("source-count-pill").textContent = `${active} source${active !== 1 ? "s" : ""}${total !== active ? ` / ${total}` : ""}`;
}

function renderChatTabs() {
  const tabs = $("chat-tabs");
  tabs.innerHTML = "";
  for (const chat of nbChats()) {
    const tab = el("button", { class: "chat-tab" + (chat.id === state.activeChat ? " active" : "") });
    tab.innerHTML = `<span>${esc(chat.name)}</span><button class="chat-tab-del" title="Delete chat">✕</button>`;
    tab.addEventListener("click", (e) => { if (e.target.closest(".chat-tab-del")) return; switchChat(chat.id); });
    tab.querySelector(".chat-tab-del").addEventListener("click", (e) => { e.stopPropagation(); deleteChat(chat.id); });
    tabs.appendChild(tab);
  }
}

function renderThread() {
  const thread = $("thread");
  const chat = activeChat();
  if (!chat || !chat.messages.length) {
    thread.innerHTML = `
      <div class="thread-empty">
        <div class="thread-empty-icon">💬</div>
        <h3>Start a conversation</h3>
        <p>Ask anything about your sources, or try a suggestion below.</p>
        <div class="suggestion-chips">
          <button class="chip" data-q="Summarize the key points from all sources">Summarize key points</button>
          <button class="chip" data-q="What are the most important concepts I should understand?">Key concepts</button>
          <button class="chip" data-q="Create a detailed study plan for this material">Study plan</button>
          <button class="chip" data-q="What questions should I be able to answer after studying this?">Study questions</button>
        </div>
      </div>`;
    thread.querySelectorAll(".chip").forEach(c =>
      c.addEventListener("click", () => sendMessage(c.dataset.q)));
    return;
  }
  thread.innerHTML = "";
  for (const msg of chat.messages) {
    if (msg.role === "user") appendUserBubble(msg.content);
    else appendAiBubble(msg.content, msg.citations, msg.id);
  }
  thread.scrollTop = thread.scrollHeight;
}

function renderNotesList() {
  const list = $("notes-list");
  list.innerHTML = "";
  for (const note of nbNotes()) {
    const card = el("div", { class: "note-card" });
    card.innerHTML = `
      <div class="note-card-title">${esc(note.title || "Untitled note")}</div>
      <div class="note-card-body">${esc((note.text || "").slice(0, 80))}</div>
      <button class="note-card-del" title="Delete note">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/></svg>
      </button>`;
    card.querySelector(".note-card-del").addEventListener("click", (e) => {
      e.stopPropagation();
      nb().notes = nbNotes().filter(n => n.id !== note.id);
      saveNb(); renderNotesList();
    });
    list.appendChild(card);
  }
}

// ─── Message rendering ───────────────────────────────────────────

function appendUserBubble(text) {
  const thread = $("thread");
  if (thread.querySelector(".thread-empty")) thread.innerHTML = "";
  const wrap = el("div", { class: "msg-wrap" });
  const bub  = el("div", { class: "msg-user" });
  bub.textContent = text;
  wrap.appendChild(bub);
  thread.appendChild(wrap);
  thread.scrollTop = thread.scrollHeight;
}

function appendAiBubble(markdown, citations = [], msgId) {
  const thread = $("thread");
  if (thread.querySelector(".thread-empty")) thread.innerHTML = "";
  const wrap = el("div", { class: "msg-wrap" });
  if (msgId) wrap.id = `msg-${msgId}`;
  const bub  = el("div", { class: "msg-ai" });

  const meta = el("div", { class: "msg-ai-meta" });
  meta.innerHTML = `<div class="ai-avatar">✦</div><span class="ai-label">Study Assistant</span>`;
  bub.appendChild(meta);

  const body = el("div", { class: "md-body" });
  body.innerHTML = renderMd(markdown);
  body.querySelectorAll("pre").forEach(pre => {
    const btn = el("button", { class: "code-copy-btn" }); btn.textContent = "Copy";
    btn.addEventListener("click", () => { navigator.clipboard?.writeText(pre.querySelector("code")?.textContent || ""); btn.textContent = "Copied!"; setTimeout(() => btn.textContent = "Copy", 1500); });
    pre.style.position = "relative"; pre.appendChild(btn);
  });
  body.innerHTML = body.innerHTML.replace(/\[Source\s+(\d+)\]/gi, (_, n) =>
    `<span class="src-ref" data-src="${n}" title="Source ${n}">${n}</span>`);
  body.querySelectorAll(".src-ref").forEach(ref => {
    ref.addEventListener("click", () => {
      const idx = parseInt(ref.dataset.src, 10) - 1;
      const src = nbSources().filter(s => s.enabled)[idx];
      if (src) showSourceViewer(src);
    });
  });
  bub.appendChild(body);

  if (citations?.length) {
    const pills = el("div", { class: "citation-pills" });
    [...new Set(citations.map(c => c.source))].forEach(n => {
      const src = nbSources().filter(s => s.enabled)[n - 1];
      const p = el("span", { class: "citation-pill" });
      p.textContent = `[${n}] ${src ? src.title.slice(0, 24) : "Source " + n}`;
      p.addEventListener("click", () => src && showSourceViewer(src));
      pills.appendChild(p);
    });
    bub.appendChild(pills);
  }

  attachMsgActions(bub, wrap, markdown, msgId);

  wrap.appendChild(bub);
  thread.appendChild(wrap);
  thread.scrollTop = thread.scrollHeight;
  return bub;
}

function createStreamingBubble() {
  const thread = $("thread");
  if (thread.querySelector(".thread-empty")) thread.innerHTML = "";
  const wrap = el("div", { class: "msg-wrap" });
  const bub  = el("div", { class: "msg-ai" });
  const meta = el("div", { class: "msg-ai-meta" });
  meta.innerHTML = `<div class="ai-avatar">✦</div><span class="ai-label">Study Assistant</span>`;
  bub.appendChild(meta);
  const body = el("div", { class: "md-body stream-cursor" });
  bub.appendChild(body);
  wrap.appendChild(bub);
  thread.appendChild(wrap);
  thread.scrollTop = thread.scrollHeight;
  return { bub, body };
}

function updateStreamingBubble(body, text) {
  body.innerHTML = renderMd(text);
  $("thread").scrollTop = $("thread").scrollHeight;
}

function finalizeStreamingBubble(body, text) {
  body.classList.remove("stream-cursor");
  body.innerHTML = renderMd(text);
  body.querySelectorAll("pre").forEach(pre => {
    const btn = el("button", { class: "code-copy-btn" }); btn.textContent = "Copy";
    btn.addEventListener("click", () => { navigator.clipboard?.writeText(pre.querySelector("code")?.textContent || ""); btn.textContent = "Copied!"; setTimeout(() => btn.textContent = "Copy", 1500); });
    pre.style.position = "relative"; pre.appendChild(btn);
  });
  body.innerHTML = body.innerHTML.replace(/\[Source\s+(\d+)\]/gi, (_, n) =>
    `<span class="src-ref" data-src="${n}" title="Source ${n}">${n}</span>`);
  body.querySelectorAll(".src-ref").forEach(ref => {
    ref.addEventListener("click", () => {
      const idx = parseInt(ref.dataset.src, 10) - 1;
      const src = nbSources().filter(s => s.enabled)[idx];
      if (src) showSourceViewer(src);
    });
  });
  $("thread").scrollTop = $("thread").scrollHeight;
}

// Attach action buttons (Speak, Translate, Explain, Podcast) to an existing bubble element.
// Called both for streaming bubbles (after stream ends) and static history bubbles.
function attachMsgActions(bub, wrap, markdown, msgId) {
  // Remove any stale actions first (safety)
  bub.querySelector(".msg-actions")?.remove();

  const acts = el("div", { class: "msg-actions" });
  acts.innerHTML = `
    <button class="msg-action-btn" data-action="copy">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M2 11V3a1 1 0 0 1 1-1h8"/></svg> Copy
    </button>
    <button class="msg-action-btn" data-action="tts">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><polygon points="1 4 7 4 7 12 1 12"/><path d="M10 6a4 4 0 0 1 0 4"/><path d="M13 3a8 8 0 0 1 0 10"/></svg> Speak
    </button>
    <button class="msg-action-btn" data-action="translate">🌐 Translate</button>
    <button class="msg-action-btn accent" data-action="explain">💡 Explain</button>
    <button class="msg-action-btn podcast-btn" data-action="podcast">🎙 Continue in Podcast</button>`;

  acts.querySelector("[data-action=copy]").addEventListener("click", () => { navigator.clipboard?.writeText(markdown); toast("Copied"); });
  acts.querySelector("[data-action=tts]").addEventListener("click", () => speakText(markdown));
  acts.querySelector("[data-action=translate]").addEventListener("click", () => openTranslateModal(markdown));

  const explainBtn = acts.querySelector("[data-action=explain]");
  const refreshExplainLabel = () => {
    if (!msgId) return;
    const saved = nbOutputs().find(o => o.type === "explain" && o.data?.msgId === msgId);
    explainBtn.innerHTML = saved ? `▶ Replay` : `💡 Explain`;
    if (saved) explainBtn.title = "Replay saved explanation";
  };
  refreshExplainLabel();
  explainBtn.addEventListener("mouseenter", refreshExplainLabel);
  explainBtn.addEventListener("click", () => {
    const saved = msgId ? nbOutputs().find(o => o.type === "explain" && o.data?.msgId === msgId) : null;
    if (saved) {
      playExplainAudio(saved.data.explanation, saved.data.lang || "English", saved.data.level || "");
    } else {
      const chat = activeChat();
      const msgs = chat?.messages || [];
      const lastUser = [...msgs].reverse().find(m => m.role === "user");
      showExplainPanel(wrap, markdown, lastUser?.content || "", msgId);
    }
  });

  acts.querySelector("[data-action=podcast]").addEventListener("click", () => {
    const chat = activeChat();
    const msgs = chat?.messages || [];
    const myIndex = msgs.findIndex(m => m.content === markdown && m.role === "assistant");
    const userQ = myIndex > 0 ? msgs.slice(0, myIndex).reverse().find(m => m.role === "user")?.content || "" : "";
    continueInPodcast(markdown, userQ, msgs);
  });

  bub.appendChild(acts);
}

// ─── Send message ────────────────────────────────────────────────
// ─── Language auto-detection ──────────────────────────────────────
function detectInputLanguage(text) {
  if (!text || text.length < 3) return state.defaultLang || "English";
  if (/[\u0C00-\u0C7F]/.test(text)) return "Telugu";
  if (/[\u0900-\u097F]/.test(text)) return "Hindi";
  if (/[\u0B80-\u0BFF]/.test(text)) return "Tamil";
  if (/[\u0980-\u09FF]/.test(text)) return "Bengali";
  if (/[\u0C80-\u0CFF]/.test(text)) return "Kannada";
  if (/[\u0D00-\u0D7F]/.test(text)) return "Malayalam";
  if (/[\u0A80-\u0AFF]/.test(text)) return "Gujarati";
  if (/[\u0A00-\u0A7F]/.test(text)) return "Punjabi";
  if (/[\u0600-\u06FF]/.test(text)) return "Arabic";
  if (/[\u3040-\u30FF]/.test(text)) return "Japanese";
  if (/[\u4E00-\u9FFF]/.test(text) && !/[\u3040-\u30FF]/.test(text)) return "Chinese";
  if (/[\uAC00-\uD7AF]/.test(text)) return "Korean";
  if (/[ñ¿¡]/.test(text)) return "Spanish";
  if (/[àâéèêîïôùûüæœ]/i.test(text)) return "French";
  if (/[äöüß]/i.test(text)) return "German";
  return "English";
}

function updateLangIndicator(lang) {
  const el2 = $("lang-indicator"); if (!el2) return;
  if (!lang || lang === "English") {
    el2.classList.add("hidden"); return;
  }
  el2.textContent = `🌐 ${lang}`;
  el2.classList.remove("hidden");
  el2.title = `Auto-detected: ${lang} — AI will reply in ${lang}`;
}

// ─── Explain Panel ────────────────────────────────────────────────
function showExplainPanel(wrap, aiText, userQuestion, msgId = null) {
  wrap.querySelector(".explain-panel")?.remove();

  const detectedLang = state.lastInputLang || "English";
  const preferredLangs = detectedLang !== "English"
    ? [detectedLang, "English"]
    : ["English", "Hindi", "Telugu", "Tamil"];

  const panel = document.createElement("div");
  panel.className = "explain-panel";
  panel.innerHTML = `
    <div class="ep-header">
      <span class="ep-icon">💡</span>
      <span>Get a deeper explanation in:</span>
      <button class="ep-close">✕</button>
    </div>
    <div class="ep-options">
      ${preferredLangs.slice(0,2).map(l =>
        `<button class="ep-lang-btn" data-lang="${esc(l)}">${esc(l)}</button>`
      ).join("")}
      <select class="ep-lang-select">
        <option value="">Other language…</option>
        <option value="Telugu">Telugu</option>
        <option value="Hindi">Hindi</option>
        <option value="Tamil">Tamil</option>
        <option value="Bengali">Bengali</option>
        <option value="Kannada">Kannada</option>
        <option value="Malayalam">Malayalam</option>
        <option value="Spanish">Spanish</option>
        <option value="French">French</option>
        <option value="German">German</option>
        <option value="Japanese">Japanese</option>
        <option value="Chinese">Chinese</option>
      </select>
    </div>`;

  panel.querySelector(".ep-close").addEventListener("click", () => panel.remove());
  panel.querySelectorAll(".ep-lang-btn").forEach(btn => {
    btn.addEventListener("click", () => { panel.remove(); generateExplanation(aiText, userQuestion, btn.dataset.lang, msgId); });
  });
  panel.querySelector(".ep-lang-select").addEventListener("change", (e) => {
    if (e.target.value) { panel.remove(); generateExplanation(aiText, userQuestion, e.target.value, msgId); }
  });
  wrap.appendChild(panel);
}

// ─── Explain: fetch TTS for one chunk, return blob URL ───────────
async function fetchTTSChunk(text) {
  try {
    const res = await fetch(`${API}/api/tts`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: "alloy" }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d.audio) return null;
    const mt = d.format === "mp3" ? "audio/mpeg" : "audio/wav";
    const bytes = atob(d.audio);
    const ab = new ArrayBuffer(bytes.length);
    new Uint8Array(ab).set(Array.from(bytes, c => c.charCodeAt(0)));
    return { url: URL.createObjectURL(new Blob([ab], { type: mt })), mt };
  } catch { return null; }
}

// ─── Explain player overlay ───────────────────────────────────────
function createExplainOverlay(lang, levelLabel) {
  document.getElementById("explain-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "explain-overlay";
  overlay.className = "explain-overlay";
  overlay.innerHTML = `
    <div class="explain-player">
      <div class="explp-header">
        <span class="explp-icon">💡</span>
        <div class="explp-meta">
          <div class="explp-title">Generating explanation…</div>
          <div class="explp-lang" id="explp-lang">${esc(lang)}${levelLabel ? " · " + esc(levelLabel) : ""}</div>
        </div>
        <button class="explp-close" id="explp-close" title="Close">✕</button>
      </div>
      <div class="explp-text-wrap">
        <div class="explp-text" id="explp-text">
          <div class="explp-loading">
            <div class="ao-typing-dots"><span></span><span></span><span></span></div>
            <span>Calibrating to your learning level…</span>
          </div>
        </div>
      </div>
      <div class="explp-progress-row">
        <div class="ao-pbar"><div class="ao-pfill" id="explp-pfill" style="width:0%"></div></div>
      </div>
      <div class="explp-controls">
        <div class="explp-wave" id="explp-wave">
          <span></span><span></span><span></span><span></span><span></span>
          <span></span><span></span><span></span>
        </div>
        <div class="explp-status" id="explp-status">Preparing…</div>
        <button class="explp-stop-btn" id="explp-stop-btn">■ Stop</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

// ─── Play explanation audio with pipelined TTS (no gaps) ─────────
async function playExplainAudio(explanation, lang = "English", levelLabel = "", stoppedRef = null) {
  const LEVELS = { beginner: "Beginner", intermediate: "Intermediate", "intermediate-to-advanced": "Advanced" };
  const overlay = createExplainOverlay(lang, LEVELS[levelLabel] || levelLabel);

  let stopped = false;
  let currentAudio = null;

  const stopFn = () => {
    stopped = true;
    if (stoppedRef) stoppedRef.stopped = true;
    if (currentAudio) { try { currentAudio.pause(); currentAudio.src = ""; } catch {} }
    speechSynthesis?.cancel();
    overlay.remove();
    setStatus("");
  };

  document.getElementById("explp-close").addEventListener("click", stopFn);
  document.getElementById("explp-stop-btn").addEventListener("click", stopFn);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) stopFn(); });

  const textEl = document.getElementById("explp-text");
  if (textEl) textEl.innerHTML = renderMd(explanation);

  const titleEl = overlay.querySelector(".explp-title");
  if (titleEl) titleEl.textContent = `Explanation${LEVELS[levelLabel] ? " · " + LEVELS[levelLabel] + " level" : ""}`;

  const chunks = splitIntoChunks(explanation, 450);
  const wave   = document.getElementById("explp-wave");
  const status = document.getElementById("explp-status");
  const pfill  = document.getElementById("explp-pfill");

  // Pre-fetch first chunk immediately
  let nextChunkPromise = chunks.length > 0 ? fetchTTSChunk(chunks[0]) : null;

  for (let i = 0; i < chunks.length; i++) {
    if (stopped) break;

    // Start fetching i+1 WHILE we await i's data (parallel pipeline)
    const chunkDataPromise = nextChunkPromise;
    nextChunkPromise = (i + 1 < chunks.length) ? fetchTTSChunk(chunks[i + 1]) : null;

    // Update UI
    if (pfill) pfill.style.width = Math.round((i / chunks.length) * 100) + "%";
    if (status) status.textContent = `Speaking… (${i + 1} / ${chunks.length})`;
    if (wave) wave.classList.remove("hidden");

    const chunkData = await chunkDataPromise;  // likely already done or nearly done
    if (stopped) break;

    let played = false;
    if (chunkData?.url) {
      const audio = new Audio(chunkData.url);
      audio.playbackRate = state.speed;
      currentAudio = audio;
      await new Promise(resolve => {
        audio.addEventListener("ended", resolve);
        audio.addEventListener("error", resolve);
        audio.play().catch(resolve);
      });
      URL.revokeObjectURL(chunkData.url);
      played = true;
    }

    if (!played && !stopped && window.speechSynthesis) {
      await new Promise(resolve => {
        const utt = new SpeechSynthesisUtterance(chunks[i]);
        utt.rate = state.speed;
        pickVoice(utt);
        utt.onend = resolve; utt.onerror = resolve;
        speechSynthesis.speak(utt);
      });
    }
  }

  if (!stopped) {
    if (pfill) pfill.style.width = "100%";
    if (status) status.textContent = "Explanation complete ✓";
    if (wave) wave.classList.add("hidden");
    setTimeout(() => { if (!stopped) overlay.remove(); }, 2500);
  }
  setStatus("");
}

// ─── Generate explanation from AI then play it ───────────────────
async function generateExplanation(content, question, lang = "English", msgId = null) {
  const overlay = createExplainOverlay(lang, "");
  let stopped = false;
  const stoppedRef = { stopped: false };

  const stopFn = () => {
    stopped = true; stoppedRef.stopped = true;
    speechSynthesis?.cancel();
    overlay.remove();
    setStatus("");
  };
  document.getElementById("explp-close").addEventListener("click", stopFn);
  document.getElementById("explp-stop-btn").addEventListener("click", stopFn);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) stopFn(); });

  setStatus(`Generating explanation in ${lang}…`);
  try {
    const chat = activeChat();
    const chatHistory = (chat?.messages || [])
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role, content: m.content.slice(0, 300) }));

    const res = await fetch(`${API}/api/explain`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, question, lang, chatHistory }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Explain failed"); }
    const data = await res.json();
    if (stopped) return;

    overlay.remove(); // playExplainAudio will create a fresh overlay
    setStatus("");

    const explanation = data.explanation || "";
    const level = data.level || "intermediate";

    // Save to chat history
    const prefix = lang !== "English" ? `**[Explanation in ${lang}]**\n\n` : `**[Explanation]**\n\n`;
    const full = prefix + explanation;
    if (chat) { chat.messages.push({ role: "assistant", content: full }); saveNb(); renderChatTabs(); }

    // Store in studioOutputs for replay
    const chatId = chat?.id || null;
    saveStudioOutput("explain", `Explanation: ${question?.slice(0, 40) || lang}`, {
      explanation, lang, level, question, chatId, msgId,
    });

    // Update Explain button label on the message
    if (msgId) {
      const msgWrap = document.getElementById(`msg-${msgId}`);
      const btn = msgWrap?.querySelector("[data-action=explain]");
      if (btn) btn.innerHTML = "▶ Replay";
    }

    // Play with pipelined TTS
    await playExplainAudio(explanation, lang, level, stoppedRef);

  } catch (e) {
    overlay.remove();
    toast("Explain error: " + e.message);
    setStatus("");
  }
}

// Split text at sentence boundaries for TTS chunks
function splitIntoChunks(text, maxLen = 450) {
  const clean = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*>]\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();

  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  const chunks = [];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > maxLen && current) {
      chunks.push(current.trim()); current = s;
    } else { current += " " + s; }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c => c.length > 5);
}

async function sendMessage(text) {
  text = (text || "").trim();
  if (!text) return;
  $("text-input").value = "";
  $("text-input").style.height = "";
  setStatus("");

  if (!activeChat()) createNewChat();

  // Auto-detect language
  const detectedLang = detectInputLanguage(text);
  state.lastInputLang = detectedLang;
  const replyLang = detectedLang !== "English" ? detectedLang : (state.defaultLang || "English");
  updateLangIndicator(replyLang !== "English" ? replyLang : "");

  activeChat().messages.push({ role: "user", content: text });
  saveNb();
  appendUserBubble(text);
  renderChatTabs();

  const sources = nbSources().filter(s => s.enabled).map(s => ({
    id: s.id, title: s.title, type: s.type, text: s.text, summary: s.summary, context: "full",
  }));

  $("send-btn").disabled = true;
  setStatus(USE_STREAMING ? "Thinking…" : "Thinking… (may take 15–25s)");

  try {
    const allMsgs = activeChat().messages
      .filter(m => m.role !== "system")
      .map(m => ({ role: m.role, content: m.content }));

    const { bub, body } = createStreamingBubble();
    let accumulated = "";

    const controller = new AbortController();
    const timeoutMs = USE_STREAMING ? 90000 : 55000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        messages: allMsgs, sources, notes: nbNotes(),
        subject: $("subject").value,
        default_lang: replyLang,
        stream: USE_STREAMING,
      }),
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
      finalizeStreamingBubble(body, `Error: ${err.error || "Request failed"}`);
      attachMsgActions(bub, bub.parentElement, `Error: ${err.error || "Request failed"}`, null);
      setStatus("Error");
      return;
    }

    if (USE_STREAMING && res.body) {
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const t = line.trim();
          if (!t || t === "data: [DONE]" || !t.startsWith("data: ")) continue;
          try {
            const chunk = JSON.parse(t.slice(6));
            if (chunk.error) { accumulated = `Error: ${chunk.error}`; break; }
            if (chunk.token) { accumulated += chunk.token; updateStreamingBubble(body, accumulated); }
          } catch {}
        }
      }
    } else {
      // Production: non-streaming JSON (reliable on Vercel serverless)
      const data = await res.json();
      if (data.error) accumulated = `Error: ${data.error}`;
      else accumulated = data.reply || "No response received.";
      updateStreamingBubble(body, accumulated);
    }

    finalizeStreamingBubble(body, accumulated);
    setStatus("");

    const msgId = "msg_" + makeId();
    if (bub.parentElement) bub.parentElement.id = `msg-${msgId}`;
    attachMsgActions(bub, bub.parentElement, accumulated, msgId);

    activeChat().messages.push({ role: "assistant", content: accumulated, id: msgId });
    if (activeChat().name === "Chat" && activeChat().messages.length <= 3) {
      activeChat().name = text.slice(0, 30) + (text.length > 30 ? "…" : "");
    }
    saveNb();
    renderChatTabs();

  } catch (e) {
    const thread = $("thread");
    const lastBody = thread.querySelector(".msg-ai:last-child .md-body");
    const errMsg = e.name === "AbortError"
      ? "Request timed out. The server may be waking up — please try again."
      : (e.message || "Network error — check your connection and retry.");
    if (lastBody) {
      finalizeStreamingBubble(lastBody, `Error: ${errMsg}`);
      const lastBub = lastBody.closest(".msg-ai");
      if (lastBub) attachMsgActions(lastBub, lastBub.parentElement, `Error: ${errMsg}`, null);
    } else {
      appendAiBubble(`Error: ${errMsg}`);
    }
    setStatus("Error");
  } finally {
    $("send-btn").disabled = false;
  }
}

// ─── Source viewer ───────────────────────────────────────────────
function showSourceViewer(src) {
  $("sv-title").textContent = src.title;
  $("sv-type-badge").textContent = src.type.toUpperCase();
  $("sv-type-badge").className = `source-type-badge type-${src.type}`;
  if (src.url) { $("sv-url").textContent = src.url; $("sv-url").classList.remove("hidden"); }
  else $("sv-url").classList.add("hidden");
  if (src.summary) { $("sv-summary").innerHTML = renderMd(src.summary); $("sv-summary").classList.remove("hidden"); }
  else $("sv-summary").classList.add("hidden");
  $("sv-content").textContent = src.text;
  $("source-viewer").classList.remove("hidden");
  $("sources-list").classList.add("hidden");
  $("add-source-btn").classList.add("hidden");
}

function hideSourceViewer() {
  $("source-viewer").classList.add("hidden");
  $("sources-list").classList.remove("hidden");
  $("add-source-btn").classList.remove("hidden");
}

// ─── Source modal ────────────────────────────────────────────────
function openSourceModal() {
  $("source-title").value = "";
  $("source-text").value  = "";
  $("source-url").value   = "";
  $("pdf-file-name").textContent = "";
  $("pdf-drop-zone").classList.remove("has-file");
  $("url-status").className = "url-status hidden";
  $("source-modal").classList.remove("hidden");
  setActiveModalTab("text");
}
function closeSourceModal() { $("source-modal").classList.add("hidden"); }

function setActiveModalTab(tab) {
  document.querySelectorAll(".mtab").forEach(t => t.classList.toggle("active", t.dataset.mtab === tab));
  document.querySelectorAll(".mtab-content").forEach(c => c.classList.toggle("hidden", c.id.replace("mtab-","") !== tab));
}

async function saveSourceFromModal() {
  const activeTab = document.querySelector(".mtab.active")?.dataset?.mtab || "text";
  if (activeTab === "text") {
    const text = $("source-text").value.trim();
    if (!text) { toast("Please paste some text"); return; }
    const title = $("source-title").value.trim() || text.slice(0, 40) + "…";
    addSource({ type: "text", title, text });
    closeSourceModal();
  } else if (activeTab === "pdf") {
    const file = $("modal-pdf-input").files[0];
    if (!file) { toast("Please select a PDF file"); return; }
    setStatus("Extracting PDF…");
    try { const text = await extractPDF(file); addSource({ type: "pdf", title: file.name.replace(/\.pdf$/i,""), text }); closeSourceModal(); }
    catch (e) { toast("PDF error: " + e.message); }
    setStatus("");
  } else if (activeTab === "url") {
    const url = $("source-url").value.trim();
    if (!url || !/^https?:\/\//i.test(url)) { toast("Enter a valid URL"); return; }
    const st = $("url-status");
    st.className = "url-status loading"; st.textContent = "Fetching…";
    try {
      const r = await fetch(`${API}/api/fetch-url`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Fetch failed"); }
      const data = await r.json();
      st.className = "url-status success"; st.textContent = `✓ Fetched: "${data.title}"`;
      addSource({ type: "url", title: data.title, text: data.text, url });
      setTimeout(closeSourceModal, 600);
    } catch (e) { st.className = "url-status error"; st.textContent = "✕ " + e.message; }
  }
}

// ─── PDF extraction ──────────────────────────────────────────────
async function extractPDF(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(" ") + "\n";
  }
  return text.trim();
}

// ─── TTS Player bar ──────────────────────────────────────────────
let _ttsIsPaused = false;

function showTTSPlayer(previewText = "Speaking…") {
  const bar = $("tts-player");
  if (!bar) return;
  const preview = previewText.replace(/```[\s\S]*?```/g,"").replace(/[#*_`>\[\]]/g,"").trim().slice(0, 60);
  $("tts-player-text").textContent = preview || "Speaking…";
  bar.classList.remove("hidden", "paused");
  _ttsIsPaused = false;
  $("tts-pause-icon").style.display = "";
  $("tts-play-icon").style.display  = "none";
}

function hideTTSPlayer() {
  $("tts-player")?.classList.add("hidden");
  _ttsIsPaused = false;
}

function pauseResumeTTS() {
  if (_ttsIsPaused) {
    // Resume
    if (state.currentAudio) state.currentAudio.play().catch(() => {});
    else if (window.speechSynthesis) speechSynthesis.resume();
    _ttsIsPaused = false;
    $("tts-player")?.classList.remove("paused");
    $("tts-pause-icon").style.display = "";
    $("tts-play-icon").style.display  = "none";
  } else {
    // Pause
    if (state.currentAudio) state.currentAudio.pause();
    else if (window.speechSynthesis) speechSynthesis.pause();
    _ttsIsPaused = true;
    $("tts-player")?.classList.add("paused");
    $("tts-pause-icon").style.display = "none";
    $("tts-play-icon").style.display  = "";
  }
}

// ─── TTS / Speech ────────────────────────────────────────────────
function stopCurrentAudio() {
  if (state.currentAudio) { state.currentAudio.pause(); state.currentAudio = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
  hideTTSPlayer();
}

function mimeType(format) {
  if (format === "mp3") return "audio/mpeg";
  if (format === "wav") return "audio/wav";
  return "audio/mpeg";
}

async function speakText(text, fromChat = false) {
  if (!state.voiceEnabled) return;
  stopCurrentAudio();
  const clean = text.replace(/```[\s\S]*?```/g,"code block").replace(/[#*_`>\[\]]/g,"").trim().slice(0, 800);
  if (!clean) return;
  showTTSPlayer(clean);
  try {
    const res = await fetch(`${API}/api/tts`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, voice: "alloy" }),
    });
    if (!res.ok) throw new Error("TTS failed");
    const data = await res.json();
    if (data.audio) {
      const bytes = atob(data.audio);
      const ab    = new ArrayBuffer(bytes.length);
      new Uint8Array(ab).set(Array.from(bytes, c => c.charCodeAt(0)));
      const blob  = new Blob([ab], { type: mimeType(data.format || "mp3") });
      const url   = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = state.speed;
      state.currentAudio = audio;
      audio.addEventListener("ended",  () => { URL.revokeObjectURL(url); hideTTSPlayer(); });
      audio.addEventListener("error",  () => { URL.revokeObjectURL(url); hideTTSPlayer(); });
      audio.play().catch(() => hideTTSPlayer());
      return;
    }
  } catch (e) { console.warn("TTS API:", e.message); }
  // Fallback: Web Speech API
  if (!window.speechSynthesis) { hideTTSPlayer(); return; }
  const utt = new SpeechSynthesisUtterance(clean);
  utt.rate  = state.speed;
  pickVoice(utt);
  utt.onend   = hideTTSPlayer;
  utt.onerror = hideTTSPlayer;
  speechSynthesis.speak(utt);
}

function pickVoice(utt) {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return;
  const langMap = { Hindi:"hi",Telugu:"te",Tamil:"ta",Bengali:"bn",Kannada:"kn",Marathi:"mr",Gujarati:"gu",Spanish:"es",French:"fr",German:"de",Arabic:"ar",Japanese:"ja",Chinese:"zh" };
  const code = langMap[state.defaultLang];
  if (code) { const m = voices.find(v => v.lang.startsWith(code)); if (m) { utt.lang = m.lang; utt.voice = m; } }
}

// ─── Voice input (STT) ───────────────────────────────────────────
let recognition = null;
function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  recognition = new SR();
  recognition.continuous = false; recognition.interimResults = true;
  recognition.onresult = (e) => {
    const t = Array.from(e.results).map(r => r[0].transcript).join("");
    $("text-input").value = t; autoResize($("text-input"));
    if (e.results[e.results.length-1].isFinal) { $("mic-btn").classList.remove("listening"); sendMessage(t); }
  };
  recognition.onerror = (e) => { $("mic-btn").classList.remove("listening"); setStatus("Mic error: " + e.error); };
  recognition.onend = () => $("mic-btn").classList.remove("listening");
}

function toggleMic() {
  if (!recognition) { toast("Speech recognition not available"); return; }
  if ($("mic-btn").classList.contains("listening")) { recognition.stop(); $("mic-btn").classList.remove("listening"); }
  else { try { recognition.start(); $("mic-btn").classList.add("listening"); } catch {} }
}

// ─── Studio Output Panel ─────────────────────────────────────────
function openSOP(title, content, actions = []) {
  $("sop-title").textContent = title;
  $("sop-body").innerHTML = content;
  $("sop-body").style.padding = "";
  $("sop-body").style.overflow = "";
  const actEl = $("sop-actions");
  actEl.innerHTML = "";
  actions.forEach(a => {
    const btn = el("button", { class: `sop-action-btn ${a.primary ? "primary" : ""}` });
    btn.textContent = a.label;
    btn.addEventListener("click", a.handler);
    actEl.appendChild(btn);
  });
  $("studio-output-overlay").classList.remove("hidden");
}

function closeSOP() {
  $("studio-output-overlay").classList.add("hidden");
  $("sop-body").innerHTML = "";
  if (state.currentMindMap) { state.currentMindMap.destroy(); state.currentMindMap = null; }
  document.removeEventListener("keydown", slideKeyListener);
}

function showStudioLoading(label = "Generating…") {
  return `<div class="studio-loading"><div class="spinner"></div><p>${label}</p></div>`;
}

function activeSrcs() {
  return nbSources().filter(s => s.enabled).map(s => ({ title: s.title, text: s.text, context: "full" }));
}

// ─── Studio: Audio Overview ──────────────────────────────────────
function studioAudio() { $("audio-options-modal").classList.remove("hidden"); }

async function generateAudio() {
  $("audio-options-modal").classList.add("hidden");
  const topic  = $("audio-topic").value.trim();
  const length = $("audio-length").value;
  const srcs   = activeSrcs();
  if (!srcs.length && !topic) { toast("Add sources first"); return; }

  openSOP("Audio Overview", showStudioLoading("Generating podcast…"), []);
  try {
    const res = await fetch(`${API}/api/podcast`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: srcs, topic, length, default_lang: state.defaultLang }),
    });
    if (!res.ok) throw new Error("Podcast API failed");
    const data = await res.json();
    saveStudioOutput("audio", data.title || "Audio Overview", data);
    renderAudioOverview(data);
  } catch (e) {
    $("sop-body").innerHTML = `<p style="color:var(--red)">Error: ${esc(e.message)}</p>`;
  }
}

let podcastSegments = [], podcastIdx = 0, podcastPlaying = false, podcastData = null;

function renderAudioOverview(data) {
  podcastSegments = data.segments || [];
  podcastData = data;
  podcastIdx = 0; podcastPlaying = false;

  // Build conversation-style messages with typing separators
  let convHtml = "";
  podcastSegments.forEach((seg, i) => {
    const isHost = seg.speaker === "Host";
    const cls = isHost ? "host" : "expert";
    convHtml += `
      <div class="ao-msg ${cls}" id="ao-msg-${i}">
        <div class="ao-avatar ${cls}-av">${isHost ? "H" : "E"}</div>
        <div class="ao-bubble">
          <div class="ao-spk-label">${esc(seg.speaker)}</div>
          <div class="ao-msg-text">${esc(seg.text)}</div>
          <div class="ao-wave hidden" id="ao-wave-${i}">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
        </div>
      </div>`;
    if (i < podcastSegments.length - 1) {
      const nextCls = podcastSegments[i+1].speaker === "Host" ? "host" : "expert";
      convHtml += `
        <div class="ao-typing-sep hidden" id="ao-sep-${i}">
          <div class="ao-typing-dots">
            <span></span><span></span><span></span>
          </div>
          <span class="ao-sep-label">${esc(podcastSegments[i+1].speaker)} is responding…</span>
        </div>`;
    }
  });

  const html = `
    <div class="ao-container">
      <div class="ao-header">
        <div class="ao-title-text">${esc(data.title || "Audio Overview")}</div>
        <div class="ao-progress-row">
          <div class="ao-pbar"><div class="ao-pfill" id="ao-pfill"></div></div>
          <span class="ao-counter" id="ao-counter">0 / ${podcastSegments.length}</span>
        </div>
      </div>
      <div class="ao-controls-row">
        <button class="ao-play-btn" id="ao-play-btn" title="Play / Pause">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
        <div class="ao-play-status" id="ao-play-status">Click ▶ to start the conversation</div>
        <button class="ao-stop-btn" id="ao-stop-btn">■ Stop</button>
      </div>
      <div class="ao-conversation" id="ao-conversation">${convHtml}</div>
      <div class="ao-bottom-btns">
        <button class="ao-bottom-btn join" id="ao-join-btn">🎤 Join the conversation</button>
        <button class="ao-bottom-btn export" id="ao-export-btn">📄 Export transcript</button>
      </div>
    </div>`;

  openSOP("Audio Overview", html, []);
  $("ao-play-btn").addEventListener("click", togglePodcastPlay);
  $("ao-stop-btn").addEventListener("click", stopPodcast);
  $("ao-join-btn").addEventListener("click", joinConversation);
  $("ao-export-btn").addEventListener("click", () => exportAudioTranscript(data));
}

async function togglePodcastPlay() {
  if (podcastPlaying) { stopCurrentAudio(); podcastPlaying = false; updatePodcastBtn(false); return; }
  podcastPlaying = true; updatePodcastBtn(true);
  await playPodcastFrom(podcastIdx);
}

function updatePodcastBtn(playing) {
  const btn = $("ao-play-btn"); if (!btn) return;
  btn.innerHTML = playing
    ? `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
}

function stopPodcast() {
  podcastPlaying = false; podcastIdx = 0;
  stopCurrentAudio(); updatePodcastBtn(false);
  document.querySelectorAll(".ao-msg").forEach(s => s.classList.remove("active", "done"));
  document.querySelectorAll(".ao-typing-sep").forEach(s => s.classList.add("hidden"));
  document.querySelectorAll(".ao-wave").forEach(w => w.classList.add("hidden"));
  const st = $("ao-play-status"); if (st) st.textContent = "Click ▶ to start the conversation";
  const pf = $("ao-pfill"); if (pf) pf.style.width = "0%";
  const ct = $("ao-counter"); if (ct) ct.textContent = `0 / ${podcastSegments.length}`;
}

async function playPodcastFrom(idx) {
  if (!podcastPlaying || idx >= podcastSegments.length) {
    podcastPlaying = false; updatePodcastBtn(false);
    // Mark all done
    document.querySelectorAll(".ao-msg").forEach(m => { m.classList.remove("active"); m.classList.add("done"); });
    const st = $("ao-play-status"); if (st) st.textContent = "Conversation complete";
    return;
  }
  podcastIdx = idx;
  const seg = podcastSegments[idx];

  // Update progress
  const pct = Math.round((idx / podcastSegments.length) * 100);
  const pf = $("ao-pfill"); if (pf) pf.style.width = pct + "%";
  const ct = $("ao-counter"); if (ct) ct.textContent = `${idx + 1} / ${podcastSegments.length}`;
  const st = $("ao-play-status"); if (st) st.textContent = `${seg.speaker} speaking…`;

  // Dim previous, activate current
  document.querySelectorAll(".ao-msg").forEach((m, i) => {
    m.classList.remove("active");
    if (i < idx) m.classList.add("done");
    else m.classList.remove("done");
  });
  document.querySelectorAll(".ao-wave").forEach(w => w.classList.add("hidden"));
  document.querySelectorAll(".ao-typing-sep").forEach(s => s.classList.add("hidden"));

  const msgEl = document.getElementById(`ao-msg-${idx}`);
  if (msgEl) {
    msgEl.classList.add("active");
    msgEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    document.getElementById(`ao-wave-${idx}`)?.classList.remove("hidden");
  }

  // Try AI TTS first, then browser fallback
  const voice = seg.speaker === "Host" ? "alloy" : "nova";
  let played = false;
  try {
    const res = await fetch(`${API}/api/tts`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: seg.text, voice }),
    });
    if (res.ok) {
      const d = await res.json();
      if (d.audio) {
        const mimeType = d.format === "mp3" ? "audio/mpeg" : "audio/wav";
        const bytes = atob(d.audio);
        const ab = new ArrayBuffer(bytes.length);
        new Uint8Array(ab).set(Array.from(bytes, c => c.charCodeAt(0)));
        const blob = new Blob([ab], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.playbackRate = state.speed;
        state.currentAudio = audio;
        await new Promise(resolve => {
          audio.addEventListener("ended", resolve);
          audio.addEventListener("error", resolve);
          audio.play().catch(resolve);
        });
        URL.revokeObjectURL(url);
        played = true;
      }
    }
  } catch (e) { console.log("TTS error, falling back to browser:", e.message); }

  // Browser TTS fallback — simple, no voice preference to avoid errors
  if (!played && window.speechSynthesis) {
    const utt = new SpeechSynthesisUtterance(seg.text);
    utt.rate = state.speed;
    utt.pitch = seg.speaker === "Host" ? 1.1 : 0.9;
    await new Promise(resolve => { utt.onend = resolve; utt.onerror = resolve; speechSynthesis.speak(utt); });
  }

  // Hide wave, show typing separator before next
  document.getElementById(`ao-wave-${idx}`)?.classList.add("hidden");
  msgEl?.classList.remove("active"); msgEl?.classList.add("done");

  if (podcastPlaying && idx + 1 < podcastSegments.length) {
    // Show typing dots briefly
    const sep = document.getElementById(`ao-sep-${idx}`);
    if (sep) {
      sep.classList.remove("hidden");
      await new Promise(r => setTimeout(r, 900));
      sep.classList.add("hidden");
    }
    await playPodcastFrom(idx + 1);
  } else {
    podcastPlaying = false; updatePodcastBtn(false);
    const pf2 = $("ao-pfill"); if (pf2) pf2.style.width = "100%";
    const st2 = $("ao-play-status"); if (st2) st2.textContent = "Conversation complete ✓";
  }
}

// ─── Join Conversation ────────────────────────────────────────────
async function joinConversation() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("Speech recognition not supported in this browser"); return; }

  const btn = $("ao-join-btn"); if (!btn) return;
  btn.textContent = "🎤 Listening…"; btn.disabled = true;
  if (podcastPlaying) { stopPodcast(); }

  const sr = new SR();
  sr.continuous = false; sr.interimResults = false; sr.lang = "en-US";

  sr.onresult = async (e) => {
    const userText = Array.from(e.results).map(r => r[0].transcript).join(" ").trim();
    btn.textContent = "🎤 Join the conversation"; btn.disabled = false;
    if (!userText) return;

    const convo = $("ao-conversation"); if (!convo) return;

    // Append user message
    const userMsg = document.createElement("div");
    userMsg.className = "ao-msg user";
    userMsg.innerHTML = `
      <div class="ao-avatar user-av">YOU</div>
      <div class="ao-bubble">
        <div class="ao-spk-label">You</div>
        <div class="ao-msg-text">${esc(userText)}</div>
      </div>`;
    convo.appendChild(userMsg);

    // Typing indicator
    const typingRow = document.createElement("div");
    typingRow.className = "ao-typing-sep";
    typingRow.innerHTML = `<div class="ao-typing-dots"><span></span><span></span><span></span></div><span class="ao-sep-label">Expert is thinking…</span>`;
    convo.appendChild(typingRow);
    convo.scrollTop = convo.scrollHeight;

    try {
      const context = podcastSegments.slice(-8).map(s => `${s.speaker}: ${s.text}`).join("\n");
      const title = podcastData?.title || "the topic";
      const srcs = activeSrcs();
      const res = await fetch(`${API}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: `You are the Expert in a podcast about "${title}". The conversation so far:\n\n${context}\n\nA listener joined and asked: "${userText}"\n\nRespond naturally as the Expert — answer their specific question using information from the sources. Be conversational and clear. 2-4 sentences max.` }],
          sources: srcs, stream: false,
          default_lang: detectInputLanguage(userText),
        }),
      });
      typingRow.remove();

      const d = await res.json();
      const reply = d.reply || d.content || "I'm not sure about that one.";

      const expertMsg = document.createElement("div");
      expertMsg.className = "ao-msg expert active";
      expertMsg.innerHTML = `
        <div class="ao-avatar expert-av">E</div>
        <div class="ao-bubble">
          <div class="ao-spk-label">Expert</div>
          <div class="ao-msg-text">${esc(reply)}</div>
          <div class="ao-wave" id="ao-wave-join">
            <span></span><span></span><span></span><span></span><span></span>
          </div>
        </div>`;
      convo.appendChild(expertMsg);
      convo.scrollTop = convo.scrollHeight;

      podcastSegments.push({ speaker: "You", text: userText });
      podcastSegments.push({ speaker: "Expert", text: reply });

      // Speak the reply
      const ttsRes = await fetch(`${API}/api/tts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply, voice: "nova" }),
      }).catch(() => null);
      if (ttsRes?.ok) {
        const td = await ttsRes.json();
        if (td.audio) {
          const mt = td.format === "mp3" ? "audio/mpeg" : "audio/wav";
          const bytes = atob(td.audio);
          const ab = new ArrayBuffer(bytes.length);
          new Uint8Array(ab).set(Array.from(bytes, c => c.charCodeAt(0)));
          const audio = new Audio(URL.createObjectURL(new Blob([ab], { type: mt })));
          audio.playbackRate = state.speed;
          state.currentAudio = audio;
          await new Promise(r => { audio.onended = r; audio.onerror = r; audio.play().catch(r); });
        }
      } else if (window.speechSynthesis) {
        const utt = new SpeechSynthesisUtterance(reply);
        utt.rate = state.speed; utt.pitch = 0.9;
        await new Promise(r => { utt.onend = r; speechSynthesis.speak(utt); });
      }
      document.getElementById("ao-wave-join")?.classList.add("hidden");
      expertMsg.classList.remove("active"); expertMsg.classList.add("done");
    } catch (ex) {
      typingRow.remove();
      toast("Could not get Expert response: " + ex.message);
    }
  };

  sr.onerror = () => { btn.textContent = "🎤 Join the conversation"; btn.disabled = false; toast("Mic error — check browser permissions"); };
  sr.start();
}

// ─── Export Audio Transcript ──────────────────────────────────────
function exportAudioTranscript(data) {
  const title = data?.title || "Audio Overview";
  const win = window.open("", "_blank");
  if (!win) { toast("Popup blocked — allow popups to export"); return; }
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8"><title>${esc(title)}</title>
    <style>
      body{font-family:Georgia,serif;max-width:700px;margin:48px auto;line-height:1.8;color:#111}
      h1{font-size:1.5rem;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:24px}
      .seg{margin:16px 0;padding:14px 18px;border-radius:10px}
      .host-seg{background:#f0f0ff;border-left:4px solid #6b5ce7}
      .expert-seg{background:#efffef;border-left:4px solid #00a878}
      .you-seg{background:#fff8e1;border-left:4px solid #f4a261}
      .spk{font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;opacity:.7}
      @media print{body{margin:24px}}
    </style></head><body>
    <h1>${esc(title)}</h1>
    ${podcastSegments.map(s => {
      const cls = s.speaker === "Host" ? "host-seg" : s.speaker === "You" ? "you-seg" : "expert-seg";
      return `<div class="seg ${cls}"><div class="spk">${esc(s.speaker)}</div><p>${esc(s.text)}</p></div>`;
    }).join("")}
    <script>setTimeout(()=>window.print(),300);<\/script>
  </body></html>`);
  win.document.close();
}

// ─── Studio: Slides ──────────────────────────────────────────────
async function studioSlides() {
  const srcs = activeSrcs();
  if (!srcs.length) { toast("Add sources first"); return; }
  openSOP("Slide Deck", showStudioLoading("Creating slides…"), []);
  try {
    const res = await fetch(`${API}/api/studio/slides`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: srcs, default_lang: state.defaultLang }),
    });
    if (!res.ok) throw new Error("Slides API failed");
    const data = await res.json();
    saveStudioOutput("slides", data.title || "Slide Deck", data);
    renderSlides(data);
  } catch (e) {
    $("sop-body").innerHTML = `<p style="color:var(--red)">Error: ${esc(e.message)}</p>`;
  }
}

let currentSlide = 0, totalSlides = 0;

function renderSlides(data) {
  currentSlide = 0; totalSlides = data.slides.length;
  const slidesHtml = data.slides.map((s, i) =>
    `<div class="slide ${i === 0 ? "active" : ""}" id="slide-${i}">
      <div class="slide-number">Slide ${i+1} of ${totalSlides}</div>
      <div class="slide-heading">${esc(s.heading)}</div>
      <ul class="slide-bullets">${s.bullets.map(b => `<li>${esc(b)}</li>`).join("")}</ul>
      ${s.note ? `<div class="slide-note">💡 ${esc(s.note)}</div>` : ""}
    </div>`
  ).join("");

  const html = `
    <div class="slide-deck">
      <div class="slide-viewer">${slidesHtml}</div>
      <div class="slide-nav">
        <button class="slide-nav-btn" id="slide-prev" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="slide-counter" id="slide-counter">1 / ${totalSlides}</span>
        <button class="slide-nav-btn" id="slide-next" ${totalSlides <= 1 ? "disabled" : ""}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    </div>`;

  openSOP(data.title || "Slide Deck", html, [
    { label: "⬇ Export (Print)", handler: () => toast("Use browser print → Save as PDF") },
  ]);
  $("slide-prev").addEventListener("click", () => navSlide(-1));
  $("slide-next").addEventListener("click", () => navSlide(1));
  document.addEventListener("keydown", slideKeyListener);
}

function navSlide(delta) {
  const slides = $("sop-body").querySelectorAll(".slide");
  slides[currentSlide]?.classList.remove("active");
  currentSlide = Math.max(0, Math.min(currentSlide + delta, totalSlides - 1));
  slides[currentSlide]?.classList.add("active");
  $("slide-counter").textContent = `${currentSlide+1} / ${totalSlides}`;
  $("slide-prev").disabled = currentSlide === 0;
  $("slide-next").disabled = currentSlide === totalSlides - 1;
}

function slideKeyListener(e) {
  if ($("studio-output-overlay").classList.contains("hidden")) return;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") navSlide(1);
  if (e.key === "ArrowLeft"  || e.key === "ArrowUp")   navSlide(-1);
}

// ─── Studio: Mind Map ────────────────────────────────────────────
async function studioMindmap() {
  const srcs = activeSrcs();
  if (!srcs.length) { toast("Add sources first"); return; }
  openSOP("Mind Map", showStudioLoading("Building mind map…"), []);
  try {
    const res = await fetch(`${API}/api/studio/mindmap`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: srcs, default_lang: state.defaultLang }),
    });
    if (!res.ok) throw new Error("Mind map API failed");
    const data = await res.json();
    saveStudioOutput("mindmap", data.title || "Mind Map", data);
    renderMindMap(data);
  } catch (e) {
    $("sop-body").innerHTML = `<p style="color:var(--red)">Error: ${esc(e.message)}</p>`;
  }
}

function renderMindMap(data) {
  $("studio-output-overlay").classList.remove("hidden");
  const container = el("div", { class: "mindmap-container", style: "width:100%;height:600px" });
  $("sop-body").innerHTML = "";
  $("sop-body").style.padding = "0";
  $("sop-body").style.overflow = "hidden";
  $("sop-body").appendChild(container);

  if (state.currentMindMap) { state.currentMindMap.destroy(); state.currentMindMap = null; }
  state.currentMindMap = window.MindMap.create(container, data, {
    onAsk: (label) => {
      closeSOP();
      $("text-input").value = `Explain: ${label}`;
      autoResize($("text-input"));
      $("text-input").focus();
    },
  });

  $("sop-actions").innerHTML = "";
  const exportBtn = el("button", { class: "sop-action-btn primary" });
  exportBtn.textContent = "⬇ Export PNG";
  exportBtn.addEventListener("click", () => state.currentMindMap?.exportPNG());
  $("sop-actions").appendChild(exportBtn);
  $("sop-title").textContent = data.title || "Mind Map";
}

// ─── Studio: Report ──────────────────────────────────────────────
async function studioReport() {
  const srcs = activeSrcs();
  if (!srcs.length) { toast("Add sources first"); return; }
  openSOP("Report", showStudioLoading("Writing report…"), []);
  try {
    const res = await fetch(`${API}/api/studio/report`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: srcs, default_lang: state.defaultLang }),
    });
    if (!res.ok) throw new Error("Report API failed");
    const data = await res.json();
    saveStudioOutput("report", "Report", data);
    openSOP("Report", `<div class="report-body md-body">${renderMd(data.report)}</div>`, [
      { label: "📋 Copy", handler: () => { navigator.clipboard?.writeText(data.report); toast("Copied!"); } },
    ]);
  } catch (e) {
    $("sop-body").innerHTML = `<p style="color:var(--red)">Error: ${esc(e.message)}</p>`;
  }
}

// ─── Studio: Flashcards ──────────────────────────────────────────
async function studioFlashcards() {
  const srcs = activeSrcs();
  if (!srcs.length) { toast("Add sources first"); return; }
  openSOP("Flashcards", showStudioLoading("Creating flashcards…"), []);
  try {
    const res = await fetch(`${API}/api/studio/flashcards`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: srcs, default_lang: state.defaultLang }),
    });
    if (!res.ok) throw new Error("Flashcards API failed");
    const data = await res.json();
    saveStudioOutput("flashcards", "Flashcards", { cards: data.cards });
    renderFlashcards(data.cards);
  } catch (e) {
    $("sop-body").innerHTML = `<p style="color:var(--red)">Error: ${esc(e.message)}</p>`;
  }
}

let fcCards = [], fcIdx = 0, fcKnown = new Set();

function renderFlashcards(cards) {
  fcCards = cards.filter(c => !fcKnown.has(c.id));
  fcIdx = 0;
  if (!fcCards.length) {
    openSOP("Flashcards", `<div class="quiz-result"><div class="quiz-result-score">🎉</div><div class="quiz-result-label">All cards mastered!</div><button class="quiz-btn primary" id="fc-restart">Start over</button></div>`, []);
    $("fc-restart")?.addEventListener("click", () => { fcKnown.clear(); renderFlashcards(cards); });
    return;
  }
  showFlashcard();
}

function showFlashcard() {
  $("studio-output-overlay").classList.remove("hidden");
  if (fcIdx >= fcCards.length) {
    openSOP("Flashcards", `<div class="quiz-result"><div class="quiz-result-score">✓</div><div class="quiz-result-label">${fcKnown.size} mastered, ${fcCards.length - fcKnown.size} remaining</div><button class="quiz-btn primary" id="fc-continue">Continue</button></div>`, []);
    $("fc-continue")?.addEventListener("click", () => renderFlashcards(fcCards));
    return;
  }
  const card = fcCards[fcIdx];
  const total = fcCards.length, seen = fcIdx;
  const html = `
    <div class="flashcard-deck">
      <div class="flashcard-progress">
        <div class="fc-progress-bar"><div class="fc-progress-fill" style="width:${(seen/total*100).toFixed(0)}%"></div></div>
        <span class="fc-count">${seen} / ${total}</span>
      </div>
      <div class="flashcard-scene" id="fc-scene">
        <div class="flashcard-inner">
          <div class="flashcard-face flashcard-front">
            <div class="fc-label">Question</div>
            <div class="fc-text">${esc(card.front)}</div>
            ${card.hint ? `<div class="fc-hint">Hint: ${esc(card.hint)}</div>` : ""}
            <div class="fc-diff-badge fc-diff-${card.difficulty || "medium"}">${(card.difficulty||"medium").toUpperCase()}</div>
          </div>
          <div class="flashcard-face flashcard-back">
            <div class="fc-label">Answer</div>
            <div class="fc-text">${esc(card.back)}</div>
          </div>
        </div>
      </div>
      <div class="fc-tap-hint">Tap card to flip</div>
      <div class="flashcard-actions">
        <button class="fc-btn shuffle" id="fc-shuffle">🔀 Shuffle</button>
        <button class="fc-btn skip"    id="fc-skip">✗ Skip</button>
        <button class="fc-btn good"    id="fc-known">✓ Know it</button>
      </div>
    </div>`;
  $("sop-body").innerHTML = html;
  $("sop-title").textContent = "Flashcards";
  $("sop-actions").innerHTML = `<span style="font-size:12px;color:var(--text-faint)">${fcKnown.size} mastered</span>`;
  $("fc-scene").addEventListener("click", () => $("fc-scene").classList.toggle("flipped"));
  $("fc-skip").addEventListener("click",  () => { fcIdx++; showFlashcard(); });
  $("fc-known").addEventListener("click", () => { fcKnown.add(card.id); fcIdx++; showFlashcard(); });
  $("fc-shuffle").addEventListener("click", () => {
    for (let i = fcCards.length-1; i>0; i--) { const j = Math.floor(Math.random()*(i+1)); [fcCards[i],fcCards[j]]=[fcCards[j],fcCards[i]]; }
    fcIdx = 0; showFlashcard();
  });
}

// ─── Studio: Quiz ────────────────────────────────────────────────
function studioQuiz() { $("quiz-options-modal").classList.remove("hidden"); }

async function generateQuiz() {
  $("quiz-options-modal").classList.add("hidden");
  const topic = $("quiz-topic").value.trim();
  const count = parseInt($("quiz-count").value,10)||5;
  const level = $("quiz-level").value;
  const srcs  = activeSrcs();
  if (!srcs.length && !topic) { toast("Add sources or enter a topic"); return; }
  openSOP("Quiz", showStudioLoading("Generating quiz…"), []);
  try {
    const res = await fetch(`${API}/api/quiz`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, count, level, sources: srcs, default_lang: state.defaultLang }),
    });
    if (!res.ok) throw new Error("Quiz API failed");
    const data = await res.json();
    saveStudioOutput("quiz", "Quiz", { questions: data.questions });
    renderQuiz(data.questions);
  } catch (e) {
    $("sop-body").innerHTML = `<p style="color:var(--red)">Error: ${esc(e.message)}</p>`;
  }
}

let quizQuestions = [], quizIdx = 0, quizScore = 0;

function renderQuiz(questions) {
  quizQuestions = questions; quizIdx = 0; quizScore = 0;
  showQuizQuestion();
}

function showQuizQuestion() {
  $("studio-output-overlay").classList.remove("hidden");
  $("sop-title").textContent = "Quiz";
  if (quizIdx >= quizQuestions.length) {
    const pct = Math.round((quizScore/quizQuestions.length)*100);
    $("sop-body").innerHTML = `
      <div class="quiz-result">
        <div class="quiz-result-score">${pct}%</div>
        <div class="quiz-result-label">Score: ${quizScore} / ${quizQuestions.length}</div>
        <div style="margin-top:8px;font-size:13px;color:var(--text-dim)">${pct>=80?"Excellent! 🎉":pct>=60?"Good job! Keep studying.":"Keep practicing! 💪"}</div>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button class="quiz-btn" id="quiz-review">Review answers</button>
          <button class="quiz-btn primary" id="quiz-restart">Try again</button>
        </div>
      </div>`;
    $("quiz-restart")?.addEventListener("click", () => renderQuiz(quizQuestions));
    $("quiz-review")?.addEventListener("click", renderQuizReview);
    return;
  }
  const q = quizQuestions[quizIdx];
  const letters = ["A","B","C","D"];
  $("sop-body").innerHTML = `
    <div class="quiz-container">
      <div class="quiz-progress-row">
        <span>Question ${quizIdx+1} of ${quizQuestions.length}</span>
        <span class="quiz-score">Score: ${quizScore}</span>
      </div>
      <div class="quiz-card">
        <div class="quiz-question-num">Q${quizIdx+1}</div>
        <div class="quiz-question">${esc(q.q)}</div>
        <div class="quiz-options">${q.options.map((opt,i)=>`<div class="quiz-option" data-idx="${i}"><div class="quiz-opt-letter">${letters[i]}</div>${esc(opt)}</div>`).join("")}</div>
        <div class="quiz-explanation" id="quiz-explanation">${esc(q.explanation||"")}</div>
      </div>
      <div class="quiz-nav"><button class="quiz-btn primary" id="quiz-next" disabled>Next →</button></div>
    </div>`;
  $("sop-body").querySelectorAll(".quiz-option").forEach(opt => {
    opt.addEventListener("click", () => {
      const chosen = parseInt(opt.dataset.idx, 10), correct = q.answer_index;
      $("sop-body").querySelectorAll(".quiz-option").forEach(o => o.classList.add("locked"));
      opt.classList.add(chosen===correct?"correct":"wrong");
      $("sop-body").querySelectorAll(".quiz-option")[correct]?.classList.add("correct");
      if (chosen===correct) quizScore++;
      $("quiz-explanation").classList.add("visible");
      $("quiz-next").disabled = false;
    });
  });
  $("quiz-next").addEventListener("click", () => { quizIdx++; showQuizQuestion(); });
}

function renderQuizReview() {
  $("sop-body").innerHTML = quizQuestions.map((q,i) => {
    const letters = ["A","B","C","D"];
    return `<div class="quiz-card" style="margin-bottom:16px">
      <div class="quiz-question-num">Q${i+1}</div>
      <div class="quiz-question">${esc(q.q)}</div>
      <div style="margin-top:8px;padding:8px 12px;background:var(--bg);border-radius:8px;border-left:3px solid var(--green);font-size:13px;color:var(--text-dim)">
        ✓ ${esc(q.options[q.answer_index])} — ${esc(q.explanation||"")}
      </div>
    </div>`;
  }).join("");
}

// ─── Studio: Data Table ──────────────────────────────────────────
async function studioDataTable() {
  const srcs = activeSrcs();
  if (!srcs.length) { toast("Add sources first"); return; }
  openSOP("Data Table", showStudioLoading("Extracting data…"), []);
  try {
    const res = await fetch(`${API}/api/studio/datatable`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: srcs, default_lang: state.defaultLang }),
    });
    if (!res.ok) throw new Error("Data table API failed");
    const data = await res.json();
    saveStudioOutput("datatable", data.title || "Data Table", data);
    renderDataTable(data);
  } catch (e) {
    $("sop-body").innerHTML = `<p style="color:var(--red)">Error: ${esc(e.message)}</p>`;
  }
}

let dtData = null, dtSortCol = -1, dtSortAsc = true;

function renderDataTable(data) {
  dtData = data; dtSortCol = -1; dtSortAsc = true;
  const html = `
    <div class="datatable-wrap">
      ${data.description ? `<div class="datatable-desc">${esc(data.description)}</div>` : ""}
      <div class="datatable-search">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="7" cy="7" r="5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg>
        <input type="text" id="dt-search" placeholder="Search table…" />
      </div>
      <div class="datatable-container">
        <table class="datatable-table" id="dt-table">
          <thead><tr>${data.columns.map((c,i) => `<th data-col="${i}">${esc(c)}<span class="sort-indicator"></span></th>`).join("")}</tr></thead>
          <tbody id="dt-body">${data.rows.map(row=>`<tr>${row.map(cell=>`<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    </div>`;
  openSOP(data.title||"Data Table", html, [
    { label: "⬇ CSV", handler: () => exportCSV(data) },
  ]);
  $("dt-search")?.addEventListener("input", (e) => filterTable(e.target.value));
  $("dt-table")?.querySelectorAll("th").forEach(th =>
    th.addEventListener("click", () => sortTable(parseInt(th.dataset.col, 10))));
}

function filterTable(q) {
  $("dt-body")?.querySelectorAll("tr").forEach(row =>
    row.classList.toggle("hidden-row", !!q && !row.textContent.toLowerCase().includes(q.toLowerCase())));
}

function sortTable(colIdx) {
  if (!dtData) return;
  dtSortAsc = dtSortCol === colIdx ? !dtSortAsc : true;
  dtSortCol = colIdx;
  const sorted = [...dtData.rows].sort((a, b) => {
    const av=a[colIdx]||"", bv=b[colIdx]||"";
    const n=parseFloat(av), m=parseFloat(bv);
    if (!isNaN(n)&&!isNaN(m)) return dtSortAsc?n-m:m-n;
    return dtSortAsc?av.localeCompare(bv):bv.localeCompare(av);
  });
  const tbody = $("dt-body"); if (!tbody) return;
  tbody.innerHTML = sorted.map(row=>`<tr>${row.map(cell=>`<td>${esc(cell)}</td>`).join("")}</tr>`).join("");
  $("dt-table")?.querySelectorAll("th").forEach((th,i)=>{
    th.classList.toggle("sorted-asc",  i===colIdx&&dtSortAsc);
    th.classList.toggle("sorted-desc", i===colIdx&&!dtSortAsc);
  });
}

function exportCSV(data) {
  const rows = [data.columns, ...data.rows];
  const csv  = rows.map(r=>r.map(c=>`"${(c||"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = el("a", { href: url, download: "data.csv" });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Studio: FAQ ─────────────────────────────────────────────────
async function studioFAQ() {
  const srcs = activeSrcs();
  if (!srcs.length) { toast("Add sources first"); return; }
  openSOP("FAQ", showStudioLoading("Generating FAQ…"), []);
  try {
    const res = await fetch(`${API}/api/study-guide/faq`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: srcs, notes: nbNotes(), default_lang: state.defaultLang }),
    });
    if (!res.ok) throw new Error("FAQ API failed");
    const data = await res.json();
    saveStudioOutput("faq", "FAQ", data);
    renderFAQ(data);
  } catch (e) {
    $("sop-body").innerHTML = `<p style="color:var(--red)">Error: ${esc(e.message)}</p>`;
  }
}

function renderFAQ(data) {
  const items = data.faq || [];
  const html = `<div class="faq-list">${items.map((item, i) => `
    <div class="faq-item" id="faq-${i}">
      <div class="faq-q" data-idx="${i}">
        <span class="faq-q-num">${i+1}</span>
        <span class="faq-q-text">${esc(item.question)}</span>
        <svg class="faq-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="faq-a">
        ${esc(item.answer)}
        ${item.sourceHint ? `<div class="faq-hint">📎 ${esc(item.sourceHint)}</div>` : ""}
      </div>
    </div>`).join("")}</div>`;

  openSOP("FAQ", html, [
    { label: "📋 Copy all", handler: () => {
      const text = items.map((it,i)=>`Q${i+1}: ${it.question}\n\nA: ${it.answer}`).join("\n\n---\n\n");
      navigator.clipboard?.writeText(text); toast("Copied!");
    }},
  ]);

  $("sop-body").querySelectorAll(".faq-q").forEach(q => {
    q.addEventListener("click", () => {
      const item = $("faq-" + q.dataset.idx);
      item.classList.toggle("open");
    });
  });
}

// ─── Studio: Briefing ────────────────────────────────────────────
async function studioBriefing() {
  const srcs = activeSrcs();
  if (!srcs.length) { toast("Add sources first"); return; }
  openSOP("Briefing Document", showStudioLoading("Writing briefing…"), []);
  try {
    const res = await fetch(`${API}/api/study-guide/briefing`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: srcs, notes: nbNotes(), default_lang: state.defaultLang }),
    });
    if (!res.ok) throw new Error("Briefing API failed");
    const data = await res.json();
    saveStudioOutput("briefing", "Briefing Document", data);
    renderBriefing(data);
  } catch (e) {
    $("sop-body").innerHTML = `<p style="color:var(--red)">Error: ${esc(e.message)}</p>`;
  }
}

function renderBriefing(data) {
  openSOP("Briefing Document", `<div class="report-body md-body">${renderMd(data.briefing)}</div>`, [
    { label: "📋 Copy", handler: () => { navigator.clipboard?.writeText(data.briefing); toast("Copied!"); } },
  ]);
}

// ─── Studio: Outline ─────────────────────────────────────────────
async function studioOutline() {
  const srcs = activeSrcs();
  if (!srcs.length) { toast("Add sources first"); return; }
  openSOP("Study Outline", showStudioLoading("Building outline…"), []);
  try {
    const res = await fetch(`${API}/api/study-guide/outline`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: srcs, notes: nbNotes(), default_lang: state.defaultLang }),
    });
    if (!res.ok) throw new Error("Outline API failed");
    const data = await res.json();
    saveStudioOutput("outline", "Study Outline: " + (data.title || ""), data);
    renderOutline(data);
  } catch (e) {
    $("sop-body").innerHTML = `<p style="color:var(--red)">Error: ${esc(e.message)}</p>`;
  }
}

function renderOutline(data) {
  const items = data.outline || [];
  const html = `<div class="outline-list">${items.map((item, i) => `
    <div class="outline-item" id="ol-${i}">
      <div class="outline-topic-row" data-idx="${i}">
        <span class="outline-topic-num">${item.topic.match(/^[IVXLCDM]+\.|^\d+\./)?.[0] || (i+1)+"."}</span>
        <span class="outline-topic-text">${esc(item.topic.replace(/^[IVXLCDM]+\.\s*|\d+\.\s*/,""))}</span>
        <svg class="outline-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="outline-body">
        ${item.summary ? `<div class="outline-summary">${esc(item.summary)}</div>` : ""}
        ${item.subtopics?.length ? `<ul class="outline-subtopics">${item.subtopics.map(s=>`<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      </div>
    </div>`).join("")}</div>`;

  openSOP(data.title ? `Study Outline: ${data.title}` : "Study Outline", html, [
    { label: "📋 Copy", handler: () => {
      const text = items.map(it=>`${it.topic}\n${it.summary||""}\n${(it.subtopics||[]).map(s=>"  • "+s).join("\n")}`).join("\n\n");
      navigator.clipboard?.writeText(text); toast("Copied!");
    }},
  ]);

  $("sop-body").querySelectorAll(".outline-topic-row").forEach(row => {
    row.addEventListener("click", () => {
      const item = $("ol-" + row.dataset.idx);
      item.classList.toggle("open");
    });
  });
}

// ─── Continue in Podcast ─────────────────────────────────────────
let cipSession = null; // active continue-in-podcast session

async function continueInPodcast(aiResponse, userQuestion, chatHistory = []) {
  // Build context from recent chat
  const recentMsgs = chatHistory.slice(-10)
    .map(m => `${m.role === "user" ? "Learner" : "Expert"}: ${m.content.slice(0, 200)}`)
    .join("\n");

  // Create the podcast UI overlay
  document.getElementById("cip-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "cip-overlay";
  overlay.className = "cip-overlay";
  overlay.innerHTML = `
    <div class="cip-panel">
      <div class="cip-header">
        <div class="cip-title">
          <span>🎙</span> <span id="cip-status-label">Podcast Conversation</span>
        </div>
        <div class="cip-header-btns">
          <button class="cip-btn pause" id="cip-pause-btn" title="Pause / take thinking time">⏸ Pause</button>
          <button class="cip-btn stop"  id="cip-close-btn" title="End conversation">✕ End</button>
        </div>
      </div>
      <div class="cip-wave-row" id="cip-wave-row">
        <div class="cip-avatar expert-av" id="cip-avatar">E</div>
        <div class="ao-wave" id="cip-wave"><span></span><span></span><span></span><span></span><span></span></div>
        <span class="cip-speaker-label" id="cip-speaker">Expert</span>
      </div>
      <div class="cip-transcript" id="cip-transcript"></div>
      <div class="cip-think-panel hidden" id="cip-think-panel">
        <div class="cip-think-msg" id="cip-think-msg">Take your time… press Play when ready or ask a question.</div>
        <div class="cip-think-btns">
          <button class="cip-btn play" id="cip-play-btn">▶ Resume</button>
          <button class="cip-mic-btn" id="cip-mic-btn">🎤 Ask a question</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let stopped = false, paused = false;
  let currentAudio = null;
  const session = { stopped: false };
  cipSession = session;

  const addLine = (speaker, text, cls) => {
    const t = $("cip-transcript"); if (!t) return;
    const d = document.createElement("div");
    d.className = `cip-line ${cls}`;
    d.innerHTML = `<span class="cip-line-spk">${esc(speaker)}</span><span class="cip-line-txt">${esc(text)}</span>`;
    t.appendChild(d); t.scrollTop = t.scrollHeight;
  };

  const setLabel = (spk) => {
    const lbl = $("cip-speaker"), av = $("cip-avatar"), label = $("cip-status-label");
    if (lbl) lbl.textContent = spk;
    if (av) { av.textContent = spk === "Expert" ? "E" : spk === "Host" ? "H" : "YOU"; av.className = `cip-avatar ${spk === "Expert" ? "expert-av" : spk === "Host" ? "host-av" : "user-av"}`; }
    if (label) label.textContent = `${spk} speaking…`;
  };

  const showWave = (show) => { $("cip-wave")?.classList.toggle("hidden", !show); };

  const speakLine = async (text, voice = "nova") => {
    showWave(true);
    let played = false;
    try {
      const res = await fetch(`${API}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice }) });
      if (res.ok) {
        const d = await res.json();
        if (d.audio) {
          const mt = d.format === "mp3" ? "audio/mpeg" : "audio/wav";
          const bytes = atob(d.audio); const ab = new ArrayBuffer(bytes.length);
          new Uint8Array(ab).set(Array.from(bytes, c => c.charCodeAt(0)));
          const audio = new Audio(URL.createObjectURL(new Blob([ab], { type: mt })));
          audio.playbackRate = state.speed; currentAudio = audio;
          await new Promise(r => { audio.onended = r; audio.onerror = r; audio.play().catch(r); });
          played = true;
        }
      }
    } catch {}
    if (!played && window.speechSynthesis) {
      const utt = new SpeechSynthesisUtterance(text); utt.rate = state.speed; utt.pitch = voice === "alloy" ? 1.1 : 0.9;
      await new Promise(r => { utt.onend = r; utt.onerror = r; speechSynthesis.speak(utt); });
    }
    showWave(false);
  };

  const stopAll = () => {
    stopped = session.stopped = true;
    if (currentAudio) { try { currentAudio.pause(); } catch {} }
    speechSynthesis?.cancel();
    overlay.remove(); cipSession = null;
  };

  const enterPause = () => {
    paused = true;
    if (currentAudio) { try { currentAudio.pause(); } catch {} }
    speechSynthesis?.cancel();
    $("cip-think-panel")?.classList.remove("hidden");
    $("cip-wave-row")?.classList.add("hidden");
    const lbl = $("cip-status-label"); if (lbl) lbl.textContent = "Thinking time…";
    // Personalized prompt based on topics
    const topics = chatHistory.filter(m => m.role === "user").slice(-3).map(m => m.content.slice(0, 60)).join(", ");
    const msg = $("cip-think-msg");
    if (msg) msg.textContent = `Take your time! We were discussing: ${topics || "the topic"}. Press Resume when ready, or ask a follow-up question.`;
  };

  const exitPause = () => {
    paused = false;
    $("cip-think-panel")?.classList.add("hidden");
    $("cip-wave-row")?.classList.remove("hidden");
  };

  $("cip-close-btn").addEventListener("click", stopAll);
  $("cip-pause-btn").addEventListener("click", () => { if (!paused) enterPause(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) stopAll(); });

  // Conversation loop
  const convoHistory = [
    { role: "user", content: `Context of our discussion:\n${recentMsgs}\n\nThe learner asked: "${userQuestion}"\n\nExpert's latest response: "${aiResponse.slice(0, 400)}"` }
  ];

  // Initial Expert opening
  setLabel("Expert");
  const openingPrompt = `You are an Expert in a continuous podcast conversation with a Learner. The Learner asked: "${userQuestion.slice(0, 200)}". The previous AI answer was: "${aiResponse.slice(0, 300)}".

Start by briefly acknowledging what was asked, then dive deeper into the concept with a clear explanation and ask the Learner if they want to explore a specific part further. Be warm, natural, conversational. 2-4 sentences max.`;

  try {
    const openingRes = await fetch(`${API}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: openingPrompt }], sources: activeSrcs(), stream: false }),
    });
    const od = await openingRes.json();
    const opening = od.reply || od.content || "Let's explore this topic further. What aspect would you like to understand better?";
    if (!stopped) {
      addLine("Expert", opening, "expert");
      setLabel("Expert");
      await speakLine(opening, "nova");
      convoHistory.push({ role: "assistant", content: opening });
    }
  } catch {}

  // Resume button — just hides the panel and resumes
  $("cip-play-btn")?.addEventListener("click", async () => {
    exitPause();
    if (stopped) return;
    // If no user question was asked during pause, send a personalized prompt
    const topics = chatHistory.filter(m => m.role === "user").slice(-3).map(m => m.content.slice(0, 60)).join(", ");
    const nudge = `The learner paused to think. Gently prompt them back into the conversation about: ${topics || "the discussed topic"}. Ask if they have any doubts or want you to clarify something specific. 1-2 sentences, warm and encouraging.`;
    try {
      const nr = await fetch(`${API}/api/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...convoHistory, { role: "user", content: nudge }], sources: activeSrcs(), stream: false }),
      });
      const nd = await nr.json();
      const nudgeText = nd.reply || nd.content || "Welcome back! Any questions on what we covered?";
      if (!stopped) { addLine("Expert", nudgeText, "expert"); setLabel("Expert"); await speakLine(nudgeText, "nova"); }
    } catch {}
  });

  // Mic button — let user ask a question
  $("cip-mic-btn")?.addEventListener("click", async () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("Speech recognition not supported"); return; }
    exitPause();
    const cipMicBtn = $("cip-mic-btn"); if (cipMicBtn) { cipMicBtn.textContent = "🔴 Listening…"; cipMicBtn.disabled = true; }
    const sr = new SR(); sr.continuous = false; sr.interimResults = false; sr.lang = "en-US";
    sr.onresult = async (e) => {
      const userText = Array.from(e.results).map(r => r[0].transcript).join(" ").trim();
      if (cipMicBtn) { cipMicBtn.textContent = "🎤 Ask a question"; cipMicBtn.disabled = false; }
      if (!userText) return;
      addLine("You", userText, "user");
      convoHistory.push({ role: "user", content: userText });
      // Get expert response
      const expertPrompt = `The learner asked: "${userText}". Continue the podcast conversation naturally. Answer clearly and concisely (2-4 sentences), then ask if they want to go deeper or if they're clear on it.`;
      try {
        const er = await fetch(`${API}/api/chat`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [...convoHistory, { role: "user", content: expertPrompt }], sources: activeSrcs(), stream: false }),
        });
        const ed = await er.json();
        const expertReply = ed.reply || ed.content || "Great question! Let me explain that.";
        addLine("Expert", expertReply, "expert"); setLabel("Expert");
        convoHistory.push({ role: "assistant", content: expertReply });
        await speakLine(expertReply, "nova");
      } catch (ex) { toast("Error: " + ex.message); }
    };
    sr.onerror = () => { if (cipMicBtn) { cipMicBtn.textContent = "🎤 Ask a question"; cipMicBtn.disabled = false; } };
    sr.start();
  });
}

// ─── Studio: Study Resources ─────────────────────────────────────
let _resModeSelected = "sources";

function studioResources() {
  // Reset modal state
  _resModeSelected = "sources";
  $("res-mode-sources")?.classList.add("active");
  $("res-mode-topic")?.classList.remove("active");
  $("res-topic-row")?.classList.add("hidden");
  if ($("res-topic-input")) $("res-topic-input").value = "";
  $("resources-modal").classList.remove("hidden");
}

async function generateResources() {
  const mode = _resModeSelected;
  let topic = "";

  if (mode === "topic") {
    topic = ($("res-topic-input")?.value || "").trim();
    if (!topic) { toast("Enter a topic name"); return; }
  } else {
    const srcs = activeSrcs();
    if (!srcs.length) { toast("Add sources first"); return; }
  }

  $("resources-modal").classList.add("hidden");
  const title = mode === "topic" ? `Study Resources: ${topic}` : "Study Resources (from sources)";
  openSOP(title, showStudioLoading("Building your mastery roadmap…"), []);

  try {
    const srcs = mode === "sources" ? activeSrcs() : [];
    const res = await fetch(`${API}/api/studio/resources`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: srcs, topic, default_lang: state.defaultLang }),
    });
    if (!res.ok) throw new Error("Resources API failed");
    const data = await res.json();
    saveStudioOutput("resources", data.title || title, data);
    renderStudyResources(data);
  } catch (e) {
    $("sop-body").innerHTML = `<p style="color:var(--red)">Error: ${esc(e.message)}</p>`;
  }
}

function renderStudyResources(data) {
  const LEVEL_COLOR = { beginner: "#a6e3a1", intermediate: "#89b4fa", advanced: "#cba6f7" };
  const TYPE_ICON   = { book:"📖", course:"🎓", video:"▶️", article:"📄", tool:"🛠", practice:"💪" };

  const roadmapHtml = (data.roadmap || []).map((phase, i) => `
    <div class="sr-phase">
      <div class="sr-phase-header">
        <span class="sr-phase-num">${i + 1}</span>
        <div>
          <div class="sr-phase-name">${esc(phase.phase)}</div>
          ${phase.duration ? `<div class="sr-phase-dur">⏱ ${esc(phase.duration)}</div>` : ""}
        </div>
      </div>
      <ul class="sr-phase-goals">${(phase.goals || []).map(g => `<li>${esc(g)}</li>`).join("")}</ul>
    </div>`).join("");

  const resourcesHtml = (data.resources || []).map(cat => `
    <div class="sr-category">
      <div class="sr-cat-title">${esc(cat.category)}</div>
      <div class="sr-items">${(cat.items || []).map(item => `
        <div class="sr-item">
          <div class="sr-item-top">
            <span class="sr-item-icon">${TYPE_ICON[item.type] || "📌"}</span>
            <div class="sr-item-name">${esc(item.name)}</div>
            ${item.free ? `<span class="sr-free-badge">FREE</span>` : ""}
            ${item.level ? `<span class="sr-level-badge" style="background:${LEVEL_COLOR[item.level] || "#585b70"}22;color:${LEVEL_COLOR[item.level] || "#cdd6f4"}">${esc(item.level)}</span>` : ""}
          </div>
          <div class="sr-item-desc">${esc(item.description)}</div>
          ${item.url_hint ? `<div class="sr-item-hint">🔍 ${esc(item.url_hint)}</div>` : ""}
        </div>`).join("")}
      </div>
    </div>`).join("");

  const html = `
    <div class="study-resources">
      ${data.overview ? `<div class="sr-overview">${esc(data.overview)}</div>` : ""}

      ${data.roadmap?.length ? `
        <div class="sr-section-title">📍 Learning Roadmap</div>
        <div class="sr-roadmap">${roadmapHtml}</div>` : ""}

      ${data.resources?.length ? `
        <div class="sr-section-title">📚 Curated Resources</div>
        ${resourcesHtml}` : ""}

      ${data.practice_plan ? `
        <div class="sr-section-title">🗓 Practice Plan</div>
        <div class="sr-practice">${esc(data.practice_plan)}</div>` : ""}

      ${data.tips?.length ? `
        <div class="sr-section-title">💡 Mastery Tips</div>
        <ul class="sr-tips">${data.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
    </div>`;

  openSOP(data.title || "Study Resources", html, [
    { label: "📋 Copy", handler: () => {
      const text = [
        data.title, "", data.overview || "",
        "", "ROADMAP", ...(data.roadmap || []).map(p => `${p.phase} (${p.duration})\n${(p.goals||[]).map(g => "  • "+g).join("\n")}`),
        "", "RESOURCES", ...(data.resources || []).flatMap(c => [c.category, ...(c.items||[]).map(i => `  • ${i.name}: ${i.description}`)]),
        "", "TIPS", ...(data.tips||[]).map(t => "• "+t),
      ].join("\n");
      navigator.clipboard?.writeText(text); toast("Copied!");
    }},
  ]);
}

// ─── Studio: Infographic ─────────────────────────────────────────
async function studioInfographic() {
  const srcs = activeSrcs();
  if (!srcs.length) { toast("Add sources first"); return; }

  if (window.InfographicUnavailable || !window.Infographic) {
    toast("Infographic library not loaded — check internet connection");
    return;
  }

  openSOP("Infographic", showStudioLoading("Generating infographic…"), []);
  try {
    const res = await fetch(`${API}/api/studio/infographic`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: srcs, default_lang: state.defaultLang }),
    });
    if (!res.ok) throw new Error("Infographic API failed");
    const data = await res.json();
    saveStudioOutput("infographic", "Infographic", data);
    renderInfographic(data);
  } catch (e) {
    $("sop-body").innerHTML = `<p style="color:var(--red)">Error: ${esc(e.message)}</p>`;
  }
}

function renderInfographic(data) {
  const syntax = data.syntax || "";
  const containerId = "infographic-render-" + makeId();

  const html = `
    <div class="infographic-wrap">
      <div id="${containerId}" class="infographic-container"></div>
      <details class="infographic-syntax-details" style="margin-top:16px">
        <summary style="font-size:12px;color:var(--text-faint);cursor:pointer">Show syntax</summary>
        <pre class="infographic-syntax-pre">${esc(syntax)}</pre>
      </details>
    </div>`;

  openSOP("Infographic", html, [
    { label: "📋 Copy syntax", handler: () => { navigator.clipboard?.writeText(syntax); toast("Copied!"); } },
  ]);

  // Render using the AntV Infographic library
  requestAnimationFrame(() => {
    const container = document.getElementById(containerId);
    if (!container) return;
    try {
      const ig = new window.Infographic({
        container: `#${containerId}`,
        width: "100%",
        height: 480,
        editable: false,
      });
      ig.render(syntax);
    } catch (e) {
      if (container) container.innerHTML = `<p style="color:var(--red)">Render error: ${esc(e.message)}</p><pre style="font-size:11px;color:var(--text-faint);white-space:pre-wrap">${esc(syntax)}</pre>`;
    }
  });
}

// ─── Translate modal ─────────────────────────────────────────────
let _translateTarget = null;

function translateLastResponse() {
  const chat = activeChat();
  if (!chat) { toast("No conversation yet"); return; }
  const lastAI = [...chat.messages].reverse().find(m => m.role === "assistant");
  if (!lastAI) { toast("No AI response to translate"); return; }
  openTranslateModal(lastAI.content);
}

function openTranslateModal(text) { _translateTarget = text; $("translate-modal").classList.remove("hidden"); }

async function doTranslate() {
  const target = $("translate-target").value;
  const setDefault = $("translate-set-default").checked;
  if (setDefault) { state.defaultLang = target; $("default-lang").value = target; }
  $("translate-modal").classList.add("hidden");
  if (!_translateTarget) return;
  setStatus(`Translating to ${target}…`);

  // Detect source language — if the current default is non-English, translate from that
  const sourceLang = state.defaultLang !== target ? state.defaultLang : "auto-detect";

  try {
    const res = await fetch(`${API}/api/translate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: _translateTarget, source_lang: sourceLang, target_lang: target }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Translation failed"); }
    const data = await res.json();

    // Save to active chat
    if (activeChat()) {
      activeChat().messages.push({ role: "assistant", content: data.translation });
      saveNb();
    }
    appendAiBubble(data.translation);

    // Read the translation aloud if voice is enabled
    if (state.voiceEnabled) speakText(data.translation.slice(0, 600));
  } catch (e) { toast("Translation error: " + e.message); }
  setStatus("");
}

// ─── Export chat ─────────────────────────────────────────────────
function exportChat() {
  const chat = activeChat(); if (!chat) return;
  const lines = chat.messages.map(m =>
    m.role === "user" ? `**You:** ${m.content}` : `**Assistant:** ${m.content}`);
  const md = `# ${chat.name}\n\n${lines.join("\n\n---\n\n")}`;
  const blob = new Blob([md], { type: "text/markdown" });
  const url  = URL.createObjectURL(blob);
  const a    = el("a", { href: url, download: `chat-${chat.name.slice(0,20)}.md` });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("Chat exported");
}

// ─── Notes ───────────────────────────────────────────────────────
function openNoteEditor() {
  const existing = $("studio-panel").querySelector(".note-editor");
  if (existing) { existing.remove(); return; }
  const editor = el("div", { class: "note-editor" });
  editor.innerHTML = `
    <input type="text" id="note-title-inp" placeholder="Title" />
    <textarea id="note-body-inp" placeholder="Write your note…" rows="4"></textarea>
    <div class="note-editor-btns">
      <button class="ne-btn" id="ne-cancel">Cancel</button>
      <button class="ne-btn save" id="ne-save">Save</button>
    </div>`;
  $("add-note-btn").after(editor);
  $("note-title-inp").focus();
  $("ne-cancel").addEventListener("click", () => editor.remove());
  $("ne-save").addEventListener("click", () => {
    const title = $("note-title-inp").value.trim();
    const text  = $("note-body-inp").value.trim();
    if (!text) { toast("Note is empty"); return; }
    nb().notes.push({ id: "note_"+makeId(), title: title||"Untitled", text, createdAt: Date.now() });
    saveNb(); renderNotesList(); editor.remove(); toast("Note saved");
  });
}

// ─── Theme toggle ────────────────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  html.setAttribute("data-theme", isDark ? "light" : "dark");
  $("theme-icon-dark").style.display  = isDark ? "none" : "";
  $("theme-icon-light").style.display = isDark ? "" : "none";
  localStorage.setItem("sa_theme", isDark ? "light" : "dark");
  const hlTheme = $("hljs-theme");
  if (hlTheme) hlTheme.href = isDark
    ? "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github.min.css"
    : "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.css";
  state.currentMindMap?.updateTheme();
}

// ─── Notebook switcher UI ─────────────────────────────────────────
function openNbDropdown()  { renderNotebookDropdown(); $("nb-dropdown").classList.remove("hidden"); $("nb-switcher").classList.add("open"); }
function closeNbDropdown() { $("nb-dropdown").classList.add("hidden"); $("nb-switcher").classList.remove("open"); }

// ─── Utility ─────────────────────────────────────────────────────
function $(id)  { return document.getElementById(id); }
function el(tag, attrs = {}) { const e = document.createElement(tag); for (const [k,v] of Object.entries(attrs)) e.setAttribute(k,v); return e; }
function esc(str) { return String(str??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function renderMd(text) { if (!window.marked) return `<pre>${esc(text)}</pre>`; try { return marked.parse(text||""); } catch { return `<pre>${esc(text)}</pre>`; } }
function setStatus(msg) { const s=$("status"); if(s) s.textContent=msg; }
function autoResize(el) { el.style.height="auto"; el.style.height=Math.min(el.scrollHeight,160)+"px"; }

let toastTimer=null;
function toast(msg, ms=2500) {
  const t=$("toast"); t.textContent=msg;
  t.classList.remove("hidden"); requestAnimationFrame(()=>t.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{ t.classList.remove("show"); setTimeout(()=>t.classList.add("hidden"),260); }, ms);
}

// ─── Event wiring ────────────────────────────────────────────────
function initEvents() {
  // Send
  $("send-btn").addEventListener("click", () => sendMessage($("text-input").value));
  $("text-input").addEventListener("keydown", (e) => { if (e.key==="Enter"&&!e.shiftKey) { e.preventDefault(); sendMessage($("text-input").value); } });
  $("text-input").addEventListener("input", () => autoResize($("text-input")));

  // Mic
  $("mic-btn").addEventListener("click", toggleMic);

  // Source modal
  $("add-source-btn").addEventListener("click", openSourceModal);
  $("source-cancel").addEventListener("click", closeSourceModal);
  $("source-save").addEventListener("click", saveSourceFromModal);
  document.querySelectorAll(".mtab").forEach(t => t.addEventListener("click", () => setActiveModalTab(t.dataset.mtab)));
  $("modal-pdf-input").addEventListener("change", (e) => {
    const name = e.target.files[0]?.name;
    if (name) { $("pdf-file-name").textContent=name; $("pdf-drop-zone").classList.add("has-file"); }
  });
  $("source-modal").querySelector(".modal-backdrop").addEventListener("click", closeSourceModal);

  // Source viewer back
  $("sv-back").addEventListener("click", hideSourceViewer);

  // Select-all sources
  $("select-all-sources").addEventListener("change", (e) => {
    nbSources().forEach(s => s.enabled = e.target.checked);
    saveNb(); renderSourceList(); updateSourceCountPill();
  });

  // Theme
  $("theme-toggle").addEventListener("click", toggleTheme);

  // Notebook switcher
  $("nb-switcher").addEventListener("click", (e) => {
    const open = !$("nb-dropdown").classList.contains("hidden");
    if (open) closeNbDropdown(); else openNbDropdown();
    e.stopPropagation();
  });
  $("nb-new-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const name = prompt("Notebook name:");
    if (name?.trim()) { const id=createNotebook(name.trim()); switchNotebook(id); closeNbDropdown(); }
  });
  // Double-click title to rename
  $("nb-current-title").addEventListener("dblclick", () => {
    const current = nb()?.name || "";
    const newName = prompt("Rename notebook:", current);
    if (newName?.trim()) renameNotebook(state.activeNotebookId, newName);
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("#nb-switcher")) closeNbDropdown(); });

  // Chat controls
  $("new-chat-btn").addEventListener("click", () => {
    createNewChat(); renderChatTabs(); renderThread();
  });
  $("export-chat-btn").addEventListener("click", exportChat);
  $("translate-last-btn").addEventListener("click", translateLastResponse);

  // TTS player controls
  $("tts-pause-btn").addEventListener("click", pauseResumeTTS);
  $("tts-stop-btn").addEventListener("click",  stopCurrentAudio);

  // Language
  $("default-lang").addEventListener("change", (e) => { state.defaultLang = e.target.value; });

  // Speed
  $("speed").addEventListener("input", (e) => { state.speed=parseFloat(e.target.value); $("speed-val").textContent=state.speed+"×"; });

  // Voice
  $("voice-toggle").addEventListener("change", (e) => { state.voiceEnabled=e.target.checked; });

  // Studio cards — ALL types
  document.querySelectorAll(".studio-card").forEach(card => {
    card.addEventListener("click", () => {
      const type = card.dataset.studio;
      const map = {
        audio:      studioAudio,
        slides:     studioSlides,
        mindmap:    studioMindmap,
        report:     studioReport,
        flashcards: studioFlashcards,
        quiz:       studioQuiz,
        datatable:  studioDataTable,
        faq:        studioFAQ,
        briefing:   studioBriefing,
        outline:    studioOutline,
        resources:    studioResources,
        infographic:  studioInfographic,
      };
      map[type]?.();
    });
  });

  // Studio output close
  $("sop-close").addEventListener("click", closeSOP);
  $("studio-output-overlay").addEventListener("click", (e) => { if (e.target===$("studio-output-overlay")) closeSOP(); });

  // Audio modal
  $("audio-options-cancel").addEventListener("click", () => $("audio-options-modal").classList.add("hidden"));
  $("audio-generate-btn").addEventListener("click", generateAudio);
  $("audio-options-modal").querySelector(".modal-backdrop")?.addEventListener("click", () => $("audio-options-modal").classList.add("hidden"));

  // Quiz modal
  $("quiz-options-cancel").addEventListener("click", () => $("quiz-options-modal").classList.add("hidden"));
  $("quiz-generate-btn").addEventListener("click", generateQuiz);
  $("quiz-options-modal").querySelector(".modal-backdrop")?.addEventListener("click", () => $("quiz-options-modal").classList.add("hidden"));

  // Resources modal
  $("resources-cancel").addEventListener("click", () => $("resources-modal").classList.add("hidden"));
  $("resources-generate-btn").addEventListener("click", generateResources);
  $("resources-modal").querySelector(".modal-backdrop")?.addEventListener("click", () => $("resources-modal").classList.add("hidden"));
  document.querySelectorAll(".resources-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".resources-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      _resModeSelected = btn.dataset.mode;
      if (_resModeSelected === "topic") $("res-topic-row").classList.remove("hidden");
      else $("res-topic-row").classList.add("hidden");
    });
  });
  $("res-topic-input")?.addEventListener("keydown", (e) => { if (e.key === "Enter") generateResources(); });

  // Translate modal
  $("translate-cancel").addEventListener("click", () => $("translate-modal").classList.add("hidden"));
  $("translate-go").addEventListener("click", doTranslate);
  $("translate-modal").querySelector(".modal-backdrop")?.addEventListener("click", () => $("translate-modal").classList.add("hidden"));

  // Add note
  $("add-note-btn").addEventListener("click", openNoteEditor);

  // Clear saved outputs
  $("clear-saved-btn")?.addEventListener("click", () => {
    if (!nbOutputs().length) return;
    if (confirm("Clear all saved outputs for this notebook?")) {
      nb().studioOutputs = []; saveNb(); renderStudioOutputs();
    }
  });

  // Mobile menu
  $("mobile-menu-btn")?.addEventListener("click", () => $("sources-panel").classList.toggle("mobile-open"));

  // Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key==="Escape") {
      closeSOP(); closeNbDropdown();
      $("source-modal").classList.add("hidden");
      $("translate-modal").classList.add("hidden");
      $("audio-options-modal").classList.add("hidden");
      $("quiz-options-modal").classList.add("hidden");
      $("resources-modal").classList.add("hidden");
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushServerNotebookSync();
  });
  window.addEventListener("pagehide", () => flushServerNotebookSync());
  window.addEventListener("beforeunload", () => flushServerNotebookSync());
}

// ─── Init ────────────────────────────────────────────────────────
function initUserBadge() {
  if (!currentUser) return;
  const avatar = document.getElementById("user-avatar");
  const nameBadge = document.getElementById("user-name-badge");
  if (avatar) avatar.textContent = (currentUser.username || currentUser.email || "U")[0].toUpperCase();
  if (nameBadge) {
    nameBadge.textContent = currentUser.username || currentUser.email;
    nameBadge.title = `Signed in as ${currentUser.email}\nClick to sign out`;
    if (currentUser.role === "mentor") {
      nameBadge.textContent = "🎓 " + nameBadge.textContent;
    }
  }
}

function init() {
  initUserBadge();
  const savedTheme = localStorage.getItem("sa_theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
  $("theme-icon-dark").style.display  = savedTheme==="dark" ? "" : "none";
  $("theme-icon-light").style.display = savedTheme==="light" ? "" : "none";
  if (savedTheme==="light") {
    const hl=$("hljs-theme");
    if (hl) hl.href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github.min.css";
  }
  $("speed-val").textContent = parseFloat($("speed").value) + "×";
  initSpeechRecognition();
  initEvents();
  initNotebooks().then(() => render()).catch(() => render());
}

document.addEventListener("DOMContentLoaded", init);
