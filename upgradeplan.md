# Upgrade Plan — Voice Study Assistant → NotebookLM Level
**Stack stays the same:** Vanilla JS + Node.js/Express + OpenRouter API  
**No RAG, no vector DB, no framework rewrite**  
**Total effort: ~10–14 days of focused work**

---

## What NotebookLM Does That This Project Doesn't

| NotebookLM Feature | Current Status | Fix |
|---|---|---|
| Multiple notebooks (separate projects) | ❌ Everything is global | Phase 1 |
| Sources scoped per notebook | ❌ One global source list | Phase 1 |
| Audio Overview (2-speaker podcast) | ❌ Broken — `pickVoice` ReferenceError | Phase 0 (immediate) |
| Study Guide: FAQ, Briefing Doc, Outline | ❌ Only generic summary exists | Phase 3 |
| URL source ingestion (add a webpage) | ❌ Copy-paste only | Phase 2 |
| Source summaries (auto on add) | ❌ Raw text only | Phase 2 |
| Notes per notebook | ❌ Notes are global | Phase 1 |
| Streaming chat responses (live typing) | ❌ Waits for full response | Phase 4 |
| Chat export (download conversation) | ❌ Not implemented | Phase 4 |
| 3-pane NotebookLM layout | ❌ Single-panel sidebar | Phase 5 |
| Source context viewer (see cited text) | ❌ No viewer panel | Phase 5 |

---

## Phase 0 — Fix Existing Bugs (Day 1, ~2 hours)

These are broken right now. Fix before anything else.

### Bug 1 — Podcast crashes on play (CRITICAL)
**File:** `frontend/app.js` line 1083  
**Problem:** `pickVoice(u.lang)` is called but the function is named `pickVoiceFallback` elsewhere  
**Fix:** Rename all occurrences to `pickVoice` consistently, or define it as:
```js
function pickVoice(lang) {
  const voices = window.speechSynthesis.getVoices();
  return voices.find(v => v.lang.startsWith(lang.split('-')[0])) || null;
}
```

### Bug 2 — AI TTS pause doesn't stop audio
**File:** `frontend/app.js` (pause/stop logic)  
**Problem:** Stop logic calls `speechSynthesis.cancel()` but `currentAudio` (AI TTS blob) keeps playing  
**Fix:** In every stop/clear function, add:
```js
if (window.currentAudio) { window.currentAudio.pause(); window.currentAudio = null; }
```

### Bug 3 — Dead `/api/sources` endpoint
**File:** `backend/server.js`  
**Problem:** Endpoint exists but frontend never calls it — dead code causing confusion  
**Fix:** Remove the endpoint from server.js OR wire it up as the dedicated grounded Q&A route

---

## Phase 1 — Multi-Notebook System (Days 2–4)

The single biggest missing piece vs NotebookLM. Everything scoped globally needs to become per-notebook.

### New localStorage Data Model

Replace the current flat structure with:

```js
// vsa-notebooks  →  array of notebook objects
{
  id: "nb_<timestamp>",
  title: "My Research",
  description: "",
  createdAt: 1234567890,
  updatedAt: 1234567890
}

// vsa-sources-<notebookId>  →  array of sources for that notebook
{
  id: "src_<timestamp>",
  title: "Chapter 1 Notes",
  text: "...",
  type: "text" | "pdf" | "url",
  url: "",        // if type=url
  summary: "",    // auto-generated on add
  context: "full" | "summary" | "excluded",
  addedAt: 1234567890
}

// vsa-chats-<notebookId>  →  array of chat sessions for that notebook
// vsa-notes-<notebookId>  →  array of notes for that notebook
// vsa-active-notebook     →  currently open notebookId
```

### What to build

**Notebook sidebar (left panel):**
- List all notebooks with title + source count
- "New Notebook" button → prompt for title
- Click notebook → switches active notebook (all panels update)
- Right-click / 3-dot menu → Rename, Delete

**Notebook header:**
- Shows active notebook title
- Source count badge
- "Add Source" button

**Data migration:**
- On first load with new code, migrate existing `vsa-sources`, `vsa-chats`, `vsa-notes` into a default notebook called "My Notebook"

### Files to change
- `frontend/app.js` — update `state` object, all load/save functions, re-scope all renders
- `frontend/index.html` — add notebooks section to sidebar
- `frontend/styles.css` — notebook list styles

---

## Phase 2 — Better Source Management (Days 4–6)

### URL Source Ingestion
NotebookLM lets you paste a URL and it reads the webpage. Add a backend endpoint that fetches and cleans webpage text:

**New backend endpoint** `POST /api/fetch-url`:
```js
// backend/server.js — add this endpoint
app.post("/api/fetch-url", async (req, res) => {
  const { url } = req.body;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const html = await response.text();
    // Strip HTML tags, keep text
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 15000); // limit to 15k chars
    res.json({ text, title: url });
  } catch (e) {
    res.status(500).json({ error: "Could not fetch URL: " + e.message });
  }
});
```

**Frontend — Add Source modal:**
Add a third tab "URL" alongside "Paste Text" and "Upload PDF":
```
[ Paste Text ] [ Upload PDF ] [ From URL ]
              URL input: https://...
              [Fetch & Add]
```

### Auto-Summary on Source Add
When a source is added, immediately call `/api/summary` on its text and store the result as `source.summary`. This:
- Gives users instant context on what the source contains
- Used for the Study Guide features later
- Can be shown collapsed under each source

```js
async function addSourceWithSummary(source) {
  state.sources.push(source);
  renderSources();
  // Generate summary in background
  const { summary } = await api("/api/summary", { text: source.text.slice(0, 8000) });
  source.summary = summary;
  saveSources();
  renderSources();
}
```

### Source Viewer Panel
When user clicks on a `[Source N]` citation in chat, show the source text highlighted in a side panel instead of just showing the title. Add a collapsible source viewer to the right of chat:
- Source title + type badge (PDF / URL / Text)
- Full source text in scrollable container
- Collapse/expand button

---

## Phase 3 — Study Guide (NotebookLM's Core Feature) (Days 6–8)

This is the feature that makes NotebookLM feel like a research assistant, not just a chatbot. Add three new study tools:

### Tool 1: FAQ Generator
**Endpoint** `POST /api/study-guide/faq`:
```js
// Generate 8-12 Q&A pairs from sources
prompt: `Based on these sources, generate a comprehensive FAQ with 10 questions 
and detailed answers. Format as JSON: [{question, answer, sourceHint}]`
```
**UI:** Cards with question as header, answer below, collapsible. Button: "Ask this in chat"

### Tool 2: Briefing Document
**Endpoint** `POST /api/study-guide/briefing`:
```js
// Executive summary style doc from sources
prompt: `Create a professional briefing document from these sources. Include:
1. Executive Summary (3 sentences)
2. Key Findings (5-7 bullet points)  
3. Important Details (paragraph form)
4. Key Terms & Definitions
Format with clear headings.`
```
**UI:** Rendered markdown, Download as .txt button

### Tool 3: Outline / Table of Contents
**Endpoint** `POST /api/study-guide/outline`:
```js
// Structured outline of all source material
prompt: `Create a hierarchical outline of all topics covered in these sources.
Use Roman numerals for main topics, letters for subtopics.`
```
**UI:** Indented outline, click any section → auto-generates explanation in chat

### Where these live in UI
Add a "Study Guide" tab alongside Chat, Quiz, Summary, etc. with three sub-tabs:
```
[ FAQ ] [ Briefing Doc ] [ Outline ]
[Generate from Sources]
```

---

## Phase 4 — Streaming Responses + Chat Export (Days 8–10)

### Streaming Chat (real-time typing effect)
The single biggest UX improvement. Instead of waiting 10 seconds for a full response, show tokens appearing word by word.

**Backend change** (server.js `/api/chat`):
```js
app.post("/api/chat", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  
  const stream = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true })
  });
  
  for await (const chunk of stream.body) {
    const lines = Buffer.from(chunk).toString().split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        const data = JSON.parse(line.slice(6));
        const token = data.choices?.[0]?.delta?.content || "";
        if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    }
  }
  res.write("data: [DONE]\n\n");
  res.end();
});
```

**Frontend change** (app.js):
```js
async function streamChat(body) {
  const msgEl = appendMessage("assistant", "");
  const res = await fetch(`${API}/api/chat`, { method: "POST", ... });
  const reader = res.body.getReader();
  let fullText = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = new TextDecoder().decode(value).split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        const { token } = JSON.parse(line.slice(6));
        fullText += token;
        msgEl.innerHTML = marked.parse(fullText);
      }
    }
  }
}
```

### Chat Export
Add "Export" button to chat title bar → downloads chat as Markdown:
```js
function exportChat() {
  const chat = curChat();
  const md = chat.messages
    .map(m => `**${m.role === "user" ? "You" : "Assistant"}:** ${m.content}`)
    .join("\n\n---\n\n");
  const blob = new Blob([`# ${chat.title}\n\n${md}`], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${chat.title}.md`;
  a.click();
}
```

---

## Phase 5 — UI Overhaul to NotebookLM Layout (Days 10–14)

### Target Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [≡] NotebookLM Clone                              [Settings]   │
├──────────────┬──────────────────────────┬───────────────────────┤
│              │                          │                       │
│  NOTEBOOKS   │    SOURCES               │   CHAT / WORKSPACE    │
│              │                          │                       │
│  • My Study  │  + Add Source            │  [Chat] [Study Guide] │
│  • Project 2 │                          │                       │
│  • Research  │  [PDF] Chapter 1   ✓    │  AI response here...  │
│              │  [URL] Wikipedia   ✓    │                       │
│  [+ New]     │  [TXT] My Notes    ✓    │  ─────────────────    │
│              │                          │  [You]: question...   │
│              │  NOTES (3)               │                       │
│              │  • Key insight           │  [Assistant]: ans...  │
│              │  • Summary              │                       │
│              │  [+ Add Note]            │  ─────────────────    │
│              │                          │  [🎙] [____________]  │
└──────────────┴──────────────────────────┴───────────────────────┘
```

### CSS/HTML changes
- Change from current sidebar + main to **3-column CSS grid** layout:
  ```css
  .app-layout {
    display: grid;
    grid-template-columns: 220px 300px 1fr;
    height: 100vh;
  }
  ```
- Left column: notebook list (thin, ~220px)
- Middle column: sources + notes for active notebook (~300px)
- Right column: chat workspace (flex)
- Responsive: on mobile, show only one panel at a time with back button

### Source type badges
Each source in the sources panel should show a colored badge:
```
[PDF] [URL] [TXT] [YT] 
```

### Notebook quick stats
Each notebook card shows:
- Title
- `3 sources · 2 chats · 5 notes`
- Last updated date

---

## New Backend Endpoints Summary

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/fetch-url` | Fetch and clean text from a URL |
| POST | `/api/study-guide/faq` | Generate FAQ from sources |
| POST | `/api/study-guide/briefing` | Generate briefing document |
| POST | `/api/study-guide/outline` | Generate structured outline |
| POST | `/api/chat` (updated) | Add streaming SSE support |

---

## Execution Order (Day by Day)

| Day | Task |
|---|---|
| Day 1 | Fix all 3 bugs from Phase 0 (podcast, TTS, dead endpoint) |
| Day 2 | New localStorage data model, migrate existing data |
| Day 3 | Notebook CRUD in UI (create, switch, rename, delete) |
| Day 4 | Re-scope sources/chats/notes to active notebook |
| Day 5 | `/api/fetch-url` endpoint + URL source tab in modal |
| Day 6 | Auto-summary on source add, source viewer panel |
| Day 7 | Study Guide: FAQ generator endpoint + UI |
| Day 8 | Study Guide: Briefing Doc + Outline |
| Day 9 | Streaming chat responses (SSE) |
| Day 10 | Chat export (.md), notes per notebook cleanup |
| Day 11-12 | 3-column layout redesign in HTML/CSS |
| Day 13 | Source type badges, notebook stats, visual polish |
| Day 14 | Testing all flows, edge cases, demo prep |

---

## What You'll Have After This

1. **Multiple notebooks** — create a notebook per subject/project, switch between them
2. **Sources per notebook** — add PDFs, paste text, or paste a URL to any notebook
3. **Working Audio Overview** — 2-speaker podcast that actually plays (fixed)
4. **Study Guide** — FAQ, Briefing Doc, and Outline generated from your sources
5. **Streaming responses** — answers appear word-by-word (not 10-second waits)
6. **NotebookLM-style 3-pane layout** — notebooks | sources+notes | chat
7. **Chat export** — download any conversation as Markdown
8. **Auto source summaries** — every source gets a summary when added

All of this runs with just your OpenRouter key, no new dependencies except the URL fetching feature (which is pure Node.js `fetch`).

---

## What This Does NOT Include (Intentionally)

- RAG / vector search — context is passed as full text (works fine with GPT-4o-mini's 128k context)  
- Local AI / Ollama — OpenRouter only  
- React rewrite — staying vanilla JS  
- Real audio MP3 podcast — Web Speech API only (free, no extra API needed)  
- User authentication — single-user local app  
- Database — localStorage (sufficient for local use)
