# 📚 Study Assistant — AI-Powered NotebookLM Clone

> A full-stack, locally-runnable AI study environment with audio overviews, mind maps, flashcards, multilingual explanations, and more. Inspired by Google NotebookLM, built entirely with open-source tools and the OpenRouter API.

**Live Demo:** [https://voice-study-assistant.vercel.app](https://voice-study-assistant.vercel.app)

---

## Table of Contents
1. [Features](#features)
2. [Tech Stack](#tech-stack)
3. [Architecture](#architecture)
4. [Getting Started (Local)](#getting-started-local)
5. [Environment Variables](#environment-variables)
6. [API Reference](#api-reference)
7. [Authentication](#authentication)
8. [Deployment (Vercel)](#deployment-vercel)
9. [Storage Model](#storage-model)
10. [Project Structure](#project-structure)

---

## Features

### Core Study Features
| Feature | Description |
|---|---|
| **Multi-notebook system** | Create, rename, and switch between notebooks, each with independent sources, chats, and outputs |
| **Source upload** | Upload PDFs (via pdf.js) or paste text — content is extracted and fed to the AI |
| **Streaming AI chat** | Real-time streamed responses via SSE using DeepSeek v3.2 on OpenRouter |
| **Inline citations** | AI responses reference source content |
| **Language auto-detection** | Input language detected; AI responds in the same language |

### Studio Features (Right Panel)
| Studio Card | Description |
|---|---|
| **Mind Map** | Interactive SVG mind map with pan/zoom, expand/collapse, color depth coding, PNG export |
| **Slide Deck** | Auto-generated presentation slides with speaker notes |
| **Flashcards** | CSS 3D flip flashcards for active recall |
| **FAQ** | Q&A accordion from source material |
| **Briefing Doc** | Structured summary document |
| **Study Outline** | Hierarchical topic tree |
| **Data Table** | Sortable/filterable HTML table extracted from sources |
| **Study Resources** | Full learning roadmap, curated resources, practice plan, and mastery tips |
| **Infographic** | Visual infographic powered by AntV Infographic library |

### Audio & Voice Features
| Feature | Description |
|---|---|
| **Audio Overview** | Host + Expert podcast-style conversation over your sources |
| **Join the Conversation** | Interrupt the podcast and ask questions; host responds in real-time |
| **Export Podcast as PDF** | Download the full conversation transcript as a PDF |
| **Continue in Podcast** | Continue any chat message as an interactive expert podcast |
| **Speak** | Text-to-speech for any AI response (Google Gemini TTS — multilingual) |
| **Explain Tab** | Audio-first, personalized explanation tuned to your learning level |
| **Translate** | Translate any response and hear it in the target language |
| **TTS Player Bar** | Pause/resume/stop controls for all audio playback |

### Persistence
- All notebooks, chats, studio outputs, and sources persist in **localStorage** scoped per user
- All generated content (mind maps, slides, flashcards, explanations) saved and replayable
- Works fully offline after initial page load

### Authentication
- **Email sign-up / sign-in** — users own their data, no cross-contamination
- **Mentor login** — elevated access (username: `ss6156`)
- JWT-based sessions stored in localStorage (`sa_auth`)
- User-scoped localStorage keys (`sa_notebooks_v2_<uid>`)

---

## Tech Stack

### Frontend
| Layer | Technology |
|---|---|
| UI Framework | Vanilla HTML5, CSS3, JavaScript (ES2022) |
| Markdown rendering | `marked.js` + `highlight.js` |
| PDF extraction | `pdf.js` (Mozilla) |
| Mind map | Pure SVG/JS — Reingold-Tilford tree layout |
| Infographic | AntV `@antv/infographic` (CDN) |
| Fonts | Google Fonts (Inter) |

### Backend
| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express.js |
| AI API | OpenRouter (`https://openrouter.ai/api/v1`) |
| Auth | `jsonwebtoken` + `bcryptjs` |
| Streaming | Server-Sent Events (SSE) |
| TTS | `google/gemini-3.1-flash-tts-preview` via OpenRouter |
| Env management | `dotenv` |

### AI Models (via OpenRouter)
| Purpose | Model |
|---|---|
| Chat / Study AI | `deepseek/deepseek-v3.2` (default) |
| Fallback | `google/gemini-2.0-flash` |
| Text-to-Speech | `google/gemini-3.1-flash-tts-preview` |

### Deployment
| Service | Role |
|---|---|
| Vercel | Static frontend + Node.js serverless functions |
| Vercel Environment Variables | API keys, JWT secret |

---

## Architecture

```
voice-study-assistant/
├── frontend/               # Static assets (served as Vercel static)
│   ├── index.html          # Main 3-panel application
│   ├── auth.html           # Premium sign-in / sign-up page
│   ├── app.js              # All frontend logic (~2800 lines)
│   ├── styles.css          # Application styles
│   └── config.js           # API_BASE switcher (local vs. production)
├── backend/
│   ├── server.js           # Express API server (~850 lines)
│   ├── package.json
│   └── .env                # Local environment variables (not committed)
├── vercel.json             # Vercel monorepo config
└── README.md
```

### 3-Panel Layout
```
┌─────────────────┬───────────────────────────┬─────────────────┐
│  Notebooks      │  Chat                     │  Studio         │
│  + Sources      │  (Streaming SSE)          │  (Generated     │
│                 │  Speak · Explain ·        │   Outputs)      │
│                 │  Translate · Podcast      │                 │
└─────────────────┴───────────────────────────┴─────────────────┘
```

### Data Flow
```
User → Frontend (JS) → Backend (Express/SSE) → OpenRouter API → LLM
                    ↓
               localStorage (per-user, scoped by uid)
```

---

## Getting Started (Local)

### Prerequisites
- Node.js 18+
- An [OpenRouter API key](https://openrouter.ai)

### 1. Clone / open the project
```bash
cd "voice-study-assistant"
```

### 2. Install backend dependencies
```bash
cd backend
npm install
```

### 3. Set environment variables
Create `backend/.env`:
```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_DEFAULT_MODEL=deepseek/deepseek-v3.2
ALLOWED_ORIGIN=*
PORT=3000
JWT_SECRET=your-secret-here
```

### 4. Start the backend
```bash
node server.js
```

### 5. Serve the frontend
Open `frontend/index.html` directly in the browser, or use any static server:
```bash
npx serve frontend
```

Navigate to `http://localhost:3000` or the static server URL.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENROUTER_API_KEY` | ✅ | — | Your OpenRouter API key |
| `OPENROUTER_DEFAULT_MODEL` | ❌ | `deepseek/deepseek-v3.2` | Primary AI model |
| `ALLOWED_ORIGIN` | ❌ | `*` | CORS allowed origin |
| `PORT` | ❌ | `3000` | Server port |
| `JWT_SECRET` | ❌ | `study-assistant-secret-2026` | JWT signing secret (change in production) |

---

## API Reference

All endpoints are prefixed with `/api`.

### Auth Endpoints

#### `POST /api/auth/signup`
Register a new user.
```json
// Request
{ "email": "user@example.com", "password": "secret123", "username": "Alice" }

// Response 200
{ "token": "<jwt>", "user": { "uid": "u_abc123", "email": "...", "username": "Alice", "role": "student" } }

// Response 409
{ "error": "Email already registered" }
```

#### `POST /api/auth/signin`
Sign in with email (or mentor username).
```json
// Request
{ "email": "user@example.com", "password": "secret123" }

// Response 200
{ "token": "<jwt>", "user": { ... } }
```

#### `GET /api/auth/me`
Get the current user from a JWT.
```
Authorization: Bearer <jwt>
```
```json
{ "uid": "...", "email": "...", "username": "...", "role": "student" }
```

### AI Chat

#### `POST /api/chat`
Stream AI response as Server-Sent Events.
```json
{
  "messages": [{ "role": "user", "content": "Explain photosynthesis" }],
  "sources": ["...extracted text..."],
  "language": "English"
}
```
Response is an SSE stream: `data: <token>\n\n` ... `data: [DONE]\n\n`

### Text-to-Speech

#### `POST /api/tts`
Convert text to speech using Google Gemini TTS.
```json
{ "text": "Hello world", "voice": "Kore", "language": "English" }
```
Returns `audio/wav` binary.

### Studio Endpoints

#### `POST /api/studio/mindmap`
Generate mind map JSON from sources.

#### `POST /api/studio/slides`
Generate slide deck markdown from sources.

#### `POST /api/studio/flashcards`
Generate flashcard Q&A pairs.

#### `POST /api/studio/faq`
Generate FAQ from sources.

#### `POST /api/studio/briefing`
Generate briefing document.

#### `POST /api/studio/outline`
Generate study outline.

#### `POST /api/studio/datatable`
Generate structured data table.

#### `POST /api/studio/resources`
Generate study resources roadmap.
```json
{ "sources": ["..."], "topic": "Machine Learning", "language": "English" }
```

#### `POST /api/studio/infographic`
Generate AntV Infographic DSL syntax.

### Audio Overview

#### `POST /api/audio-overview`
Generate host/expert podcast script.

#### `POST /api/explain`
Generate a personalized audio explanation.
```json
{
  "text": "The AI response to explain",
  "question": "User's question",
  "language": "English",
  "chatHistory": [...]
}
```

---

## Authentication

Authentication uses **JWT tokens** (HS256) stored in `localStorage` under key `sa_auth`:

```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "user": { "uid": "u_abc123", "email": "user@example.com", "username": "Alice", "role": "student" }
}
```

### User Roles
| Role | Access |
|---|---|
| `student` | Full app access, own private notebooks |
| `mentor` | Full app access + mentor badge (username: `ss6156`) |

### Mentor Credentials
| Field | Value |
|---|---|
| Username | `ss6156` |
| Password | `saishashank` |
| Role | `mentor` |

### Session Lifetime
JWTs expire after **30 days**. On expiry the user is redirected to `auth.html`.

---

## Deployment (Vercel)

The project is configured for Vercel monorepo deployment via `vercel.json`:

```json
{
  "version": 2,
  "builds": [
    { "src": "backend/server.js", "use": "@vercel/node" },
    { "src": "frontend/**", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "backend/server.js" },
    { "src": "/(.*)", "dest": "frontend/$1" }
  ]
}
```

### Deploy
```bash
npm install -g vercel
cd "voice-study-assistant"
vercel --prod
```

### Required Vercel Environment Variables
Set these in the Vercel dashboard or via CLI:
- `OPENROUTER_API_KEY`
- `JWT_SECRET`
- `OPENROUTER_DEFAULT_MODEL` = `deepseek/deepseek-v3.2`
- `ALLOWED_ORIGIN` = `*`

---

## Storage Model

All user data is stored in **browser localStorage**, scoped by user ID:

| Key | Contents |
|---|---|
| `sa_auth` | Auth token + user object |
| `sa_notebooks_v2_<uid>` | All notebooks (sources, chats, studio outputs) |
| `sa_theme` | UI theme preference (`dark` / `light`) |

### Notebook Object Schema
```json
{
  "id": "nb_abc123",
  "name": "My Notebook",
  "createdAt": "2026-06-26T...",
  "sources": [{ "id": "src_1", "name": "lecture.pdf", "content": "..." }],
  "chats": [{ "id": "ch_1", "messages": [...] }],
  "studioOutputs": [
    { "id": "so_1", "type": "mindmap", "title": "Mind Map", "data": {...}, "createdAt": "..." }
  ]
}
```

---

## License

MIT — built for learning purposes. Not affiliated with Google NotebookLM.
