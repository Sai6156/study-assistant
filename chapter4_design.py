"""Expanded Chapter 4 — Design Methodology content."""


def build_chapter4(doc, diagrams, helpers):
    """Build detailed Design Methodology chapter. helpers: h1,h2,h3,para,bullet,fig,table_caption,tbl,pb,os,basename"""
    h1, h2, h3 = helpers["h1"], helpers["h2"], helpers["h3"]
    para, bullet, fig = helpers["para"], helpers["bullet"], helpers["fig"]
    pb = helpers["pb"]
    import os
    bname = os.path.basename

    h1(doc, "CHAPTER 4")
    h1(doc, "DESIGN METHODOLOGY")

    h2(doc, "4.1 Introduction")
    para(doc, "Design methodology translates the requirements identified in Chapter 3 into a concrete, deployable architecture for the Voice-Controlled AI Study Assistant. This chapter documents the complete A-to-Z design process: layered system architecture, monorepo organisation, module decomposition, data-flow and behavioural models, persistence schema, core algorithms, operational flow, and security controls.")
    para(doc, "The design follows four guiding principles adopted throughout development: (1) source-grounded responses — every AI answer must be traceable to user-uploaded material; (2) multimodal interaction — text and voice are first-class input/output channels; (3) stateless serverless backend — no database server is required for academic-scale deployment; and (4) per-user isolation — notebooks and studio outputs must not leak between accounts on a shared Vercel link.")
    para(doc, "Fig. 4.1 presents the high-level three-tier architecture comprising the presentation layer (browser client), application layer (Express.js on Vercel), and external AI services layer (OpenRouter LLM and TTS). Subsequent sections refine this overview into module-level designs, DFDs, UML-style diagrams, and algorithms.")
    fig(doc, "Fig. 4.1 — High-Level Architecture of Proposed System", bname(diagrams["fig_4_1"]), 5.5)

    h2(doc, "4.2 Architecture of the Proposed System")
    para(doc, "The project is organised as a Vercel monorepo with two primary directories. The folder frontend/ contains static HTML, CSS, and JavaScript assets — index.html (main three-panel app), auth.html (sign-in/sign-up), app.js (~2800 lines of client logic), styles.css, mindmap.js (Reingold-Tilford SVG layout), and config.js (API base URL switcher). The folder backend/ hosts server.js (~880 lines), an Express application exposing REST and SSE endpoints, JWT authentication, and OpenRouter API proxying.")
    para(doc, "Vercel routing (vercel.json) maps /api/* to the Node.js serverless function and /* to static frontend files. In development, the backend listens on port 3000 while the frontend is served statically; config.js points API_BASE to http://localhost:3000. In production, API_BASE is empty so requests are same-origin — eliminating CORS friction and simplifying deployment.")
    para(doc, "Data never persists on the server. All notebooks, sources, chat histories, and studio outputs are stored in browser localStorage under keys scoped by HMAC-derived user ID (sa_notebooks_v2_<uid>). The JWT in sa_auth carries user identity for API authorisation without a central user database. Fig. 4.2 shows the Level 0 data flow between the student, the study assistant, and OpenRouter.")
    fig(doc, "Fig. 4.2 — Data Flow Diagram (Level 0)", bname(diagrams["fig_4_2"]), 5.5)

    h3(doc, "4.2.1 End-to-End Development Phases")
    para(doc, "Development proceeded in six iterative phases, each producing a testable increment:")
    for phase in [
        "Phase 1 — Core Chat: Static three-panel UI, POST /api/chat non-streaming, manual text input, basic OpenRouter integration.",
        "Phase 2 — Source Grounding: PDF upload via pdf.js, source enable/disable toggles, source text injected into LLM system prompt with [Source N] citation format.",
        "Phase 3 — Studio Outputs: Mind map, slides, flashcards, FAQ, briefing, outline, data table, resources, and infographic endpoints with structured JSON parsing.",
        "Phase 4 — Voice & Audio: Web Speech API input, Gemini TTS output, audio overview podcasts, explain/translate actions, pipelined audio playback.",
        "Phase 5 — Authentication: Stateless JWT sign-up/sign-in, HMAC uid derivation, mentor portal, per-user localStorage isolation.",
        "Phase 6 — Deployment & Hardening: Vercel monorepo deploy, SSE streaming, cold-start fixes, CORS configuration, action-button post-stream attachment.",
    ]:
        bullet(doc, phase)
    para(doc, "Each phase was validated against the functional requirements in Table 3.3 before proceeding to the next, ensuring traceability from design to implementation.")

    h3(doc, "4.2.2 REST API and Endpoint Design")
    para(doc, "The backend exposes a cohesive REST and SSE API surface. Authentication endpoints (/api/auth/signup, /api/auth/signin, /api/auth/me) return JWT tokens without persisting credentials server-side. The chat endpoint (/api/chat) accepts a JSON body with messages[], sources[], notes, stream flag, and default_lang; when stream=true it returns text/event-stream with incremental tokens. Studio endpoints under /api/studio/* accept source excerpts and return strictly structured JSON for each artifact type. Audio endpoints (/api/tts, /api/explain, /api/podcast) proxy Gemini TTS and multi-speaker podcast scripts. All routes validate Authorization: Bearer <JWT> except signup/signin.")
    para(doc, "Error responses follow a consistent JSON schema: { error: string, code?: number }. HTTP 401 indicates invalid or expired JWT; 503 signals missing OPENROUTER_API_KEY; 429 triggers automatic model fallback from DeepSeek to Gemini. This predictable contract simplified frontend error banners and retry logic during implementation.")

    h3(doc, "4.2.3 Prompt Engineering and Source Grounding Strategy")
    para(doc, "Source grounding is the central design differentiator. For every chat request, server.js concatenates enabled source texts (truncated to 6000 characters per source to respect context limits) into the system prompt with explicit [Source N] labels. The model is instructed to cite these labels when quoting or paraphrasing uploaded material and to state clearly when an answer is general knowledge rather than source-derived. Studio prompts add JSON schema examples inline — for example, mind map responses must be nested { name, children[] } trees parseable by mindmap.js. Temperature is kept low (0.3–0.5) for structured outputs and moderate (0.7) for conversational chat to balance creativity with faithfulness to sources.")

    h2(doc, "4.3 Module Description")
    para(doc, "The system is decomposed into six cooperating modules. Each module has defined inputs, outputs, and interfaces. Together they implement the NotebookLM-inspired workflow: upload sources, chat with grounded AI, generate studio artifacts, and revise using voice.")

    h3(doc, "4.3.1 Voice Input Module")
    para(doc, "The Voice Input Module captures spoken queries through the browser Web Speech API (SpeechRecognition interface). When the user clicks the microphone button, recognition starts with interim results displayed in the input field for visual feedback. On a final transcript event, the recognised text is passed to sendMessage() — the same pipeline used for typed queries. The module supports English and browser-supported Indian languages. Error handling covers permission denial, no-speech timeout, and network unavailability, with graceful fallback to keyboard input.")

    h3(doc, "4.3.2 Speech-to-Text Module")
    para(doc, "STT is implemented entirely client-side via the Web Speech API — no server-side Whisper or cloud STT endpoint is required. A regex-based language detector inspects Unicode script ranges in the transcript to identify Telugu (U+0C00–U+0C7F), Hindi/Devanagari, Tamil, and other scripts. Detected language is forwarded to the backend as default_lang so the LLM responds in the same language. Accuracy depends on browser engine (typically Chrome/Edge), microphone quality, and ambient noise; Chapter 6 quantifies observed performance.")

    h3(doc, "4.3.3 NLP Processing Module")
    para(doc, "Rather than a local NLP library, this module orchestrates LLM prompts on the backend. For each chat request, server.js constructs a system message containing: tutor persona instructions, subject context, active source texts (up to 6000 characters per source), student notes, and language directives. The last ten user/assistant turns are included for conversational continuity. Source grounding is enforced by instructing the model to cite [Source N] inline when relying on uploaded material. Studio endpoints use specialised system prompts requesting strict JSON output for mind maps, flashcards, slides, and other structured artifacts.")

    h3(doc, "4.3.4 AI Response Generation Module")
    para(doc, "POST /api/chat accepts messages, sources, notes, and a stream flag. When stream=true, the backend opens an SSE connection to OpenRouter with DeepSeek v3.2, forwarding token chunks to the client as data: {\"token\": \"...\"} events. The frontend creates a streaming bubble, appends tokens via updateStreamingBubble(), and calls finalizeStreamingBubble() on [DONE]. Action buttons (Speak, Explain, Translate, Podcast) are attached via attachMsgActions() after the stream completes. Non-streaming mode returns a complete JSON reply for simpler clients. Model fallback chain: DeepSeek v3.2 → Gemini 2.0 Flash on rate limit or error.")

    h3(doc, "4.3.5 Database Module")
    para(doc, "Persistence uses browser localStorage — a key-value store with ~5 MB per-origin limit. Keys include: sa_auth (JWT token and user object), sa_notebooks_v2_<uid> (JSON array of notebooks), and sa_theme (dark/light preference). Each notebook contains id, name, createdAt, sources[], chats[], and studioOutputs[]. Sources store extracted PDF/text, enabled flag, and context mode. Chats store message arrays with role, content, and unique ids. Studio outputs store type, title, data payload, and timestamp. This schema supports offline re-display of all generated content without server round-trips.")

    h3(doc, "4.3.6 User Interface Module")
    para(doc, "The UI follows a NotebookLM-inspired three-panel layout. The left panel lists notebooks and uploaded sources with enable/disable checkboxes. The centre panel shows the active chat thread with streaming markdown rendering (marked.js + highlight.js for code blocks). The right panel contains Studio generation cards (mind map, slides, flashcards, etc.) and a Saved outputs panel. auth.html provides a premium dark-themed sign-in/sign-up experience with mentor portal modal. Responsive CSS supports 1366×768 and above with collapsible panels on narrower viewports.")

    h3(doc, "4.3.7 Error Handling and Resilience")
    para(doc, "Client-side error handling covers network timeouts (30 s fetch abort), SSE stream interruption (partial bubble preserved with retry prompt), localStorage quota exceeded (user alert to delete old notebooks), and microphone permission denial (fallback to keyboard). Server-side middleware catches OpenRouter rate limits and switches models transparently. Vercel cold starts on the first request after idle are mitigated by displaying a loading spinner and caching JWT in localStorage to avoid redundant auth round-trips during a study session.")

    para(doc, "Fig. 4.3 decomposes the Level 0 DFD into five Level 1 processes — authentication, notebook/source management, chat/voice processing, studio generation, and TTS/audio — with localStorage and OpenRouter as external data stores and services.")
    fig(doc, "Fig. 4.3 — Data Flow Diagram (Level 1)", bname(diagrams["fig_4_3"]), 6.0)

    h2(doc, "4.4 Data Flow Diagram (DFD)")
    para(doc, "Data flow modelling clarifies how information moves between the student, client-side stores, backend processes, and OpenRouter. At Level 0 (Fig. 4.2), the student submits queries and sources; the system returns AI responses and studio artifacts; OpenRouter handles LLM inference and TTS synthesis. At Level 1 (Fig. 4.3), Process 1.0 authenticates via HMAC-derived uid; Process 2.0 reads/writes notebook JSON in localStorage; Process 3.0 streams chat completions; Process 4.0 generates structured studio JSON; Process 5.0 fetches WAV audio from Gemini TTS. Disabled sources (context=excluded) are filtered before prompt construction.")

    h2(doc, "4.5 Use Case Diagram")
    para(doc, "Two human actors interact with the system: Student (primary user with full notebook access) and Mentor (elevated role via username ss6156 for demonstration and review). The OpenRouter API acts as a secondary actor providing LLM and TTS services. Core use cases include: Sign Up, Sign In, Upload Source (PDF/text), Chat via Text, Chat via Voice, Generate Mind Map, Generate Slide Deck, Generate Flashcards, Generate Audio Overview, Explain Response, Translate Response, Save Studio Output, and Sign Out. Fig. 4.4 maps actors to these use cases.")
    fig(doc, "Fig. 4.4 — Use Case Diagram", bname(diagrams["fig_4_4"]), 6.0)

    h2(doc, "4.6 Sequence Diagram")
    para(doc, "The chat interaction sequence demonstrates the synchronous-asynchronous hybrid pattern used throughout the application. The student types or speaks a query; the frontend POSTs to /api/chat with stream=true; the backend opens an SSE stream to OpenRouter; tokens arrive incrementally and are rendered in the UI; upon completion, action buttons are injected and the updated chat is serialised to localStorage. Error paths include API key missing (503), rate limiting (model fallback), and network timeout (user-visible error banner). Fig. 4.5 illustrates this sequence.")
    fig(doc, "Fig. 4.5 — Sequence Diagram (Chat Interaction)", bname(diagrams["fig_4_5"]), 6.0)

    h2(doc, "4.7 Activity Diagram")
    para(doc, "A typical study session begins with authentication (redirect to auth.html if sa_auth is absent), notebook selection, and source upload. The student enables relevant sources, then asks questions via text or microphone. The AI streams a response; optional actions include Speak (TTS), Explain (personalised audio lesson), Translate (with TTS in target language), or Continue in Podcast. Studio cards generate mind maps, slides, or flashcards from the same source corpus. All outputs appear in the Saved panel for later review. Fig. 4.6 captures this activity flow.")
    fig(doc, "Fig. 4.6 — Activity Diagram (User Study Session)", bname(diagrams["fig_4_6"]), 5.5)

    h2(doc, "4.8 ER Diagram / Database Design")
    para(doc, "Although no relational database is deployed, a logical ER model describes the localStorage JSON schema. Entity User (uid, email, username, role) has a one-to-many relationship with Notebook. Notebook has one-to-many relationships with Source, Chat, and StudioOutput. Chat has one-to-many Message (role, content, id). Source stores title, type (pdf/text), extracted text, and enabled flag. StudioOutput stores type (mindmap/slides/flashcards/etc.), title, data blob, and createdAt. Fig. 4.7 presents this logical model used during design and implementation.")
    fig(doc, "Fig. 4.7 — Entity Relationship Diagram (Logical Data Model)", bname(diagrams["fig_4_7"]), 6.0)

    h2(doc, "4.9 Algorithm Design")
    para(doc, "Algorithm 1 — Stateless User Identity Derivation:")
    para(doc, "Input: email E, password P. Output: stable user id uid.")
    para(doc, "uid ← 'u_' || HMAC-SHA256(UID_PEPPER, lowercase(E) || '::' || P)[0:28]")
    para(doc, "The same credentials always produce the same uid, enabling localStorage lookup without server-side user records. Password is never stored — only the derived uid appears in the JWT payload.")
    para(doc, "Algorithm 2 — Mind Map Layout (Reingold-Tilford):")
    para(doc, "Input: hierarchical JSON tree from /api/studio/mindmap. The algorithm assigns x/y coordinates to each node using the Reingold-Tilford tidy tree layout, renders SVG paths for edges, and supports pan/zoom, expand/collapse, and PNG export via mindmap.js.")
    para(doc, "Algorithm 3 — Pipelined Explain Audio:")
    para(doc, "Input: explanation text from /api/explain. Split into sentence chunks. While chunk N plays via HTMLAudioElement, chunk N+1 is fetched from /api/tts in parallel. This reduces perceived latency for 60–90 second spoken explanations compared to sequential fetch-play.")

    h2(doc, "4.10 Flowchart of System Operation")
    para(doc, "The operational flowchart (Fig. 4.8) summarises the decision logic from application entry to output display: check authentication → load notebooks → upload sources → choose chat or studio path → call OpenRouter → render result → optionally save to localStorage. Error branches handle auth failure (redirect), API unavailability (retry message), and empty source list (prompt user to upload).")
    fig(doc, "Fig. 4.8 — System Operation Flowchart", bname(diagrams["fig_4_8"]), 5.5)

    h2(doc, "4.11 Security and Privacy Considerations")
    para(doc, "Security was designed into the architecture from the outset, consistent with non-functional requirements in Table 3.4:")
    for s in [
        "OPENROUTER_API_KEY and JWT_SECRET reside only in server environment variables — never in frontend source or client bundles.",
        "JWT tokens use HS256 signing with 365-day expiry; /api/auth/me verifies token integrity without database lookup.",
        "Passwords are never transmitted to persistent server storage; HMAC uid derivation provides stateless identity.",
        "Per-user localStorage keys (sa_notebooks_v2_<uid>) prevent notebook mixing when multiple students use the same browser sequentially.",
        "HTTPS is enforced on the Vercel deployment; CORS headers restrict API methods to GET/POST.",
        "Source text is sent to OpenRouter only during active queries — no third-party analytics or tracking scripts are embedded.",
    ]:
        bullet(doc, s)
    pb(doc)
