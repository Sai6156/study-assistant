import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { registerUser, authenticateUser } from "./users.js";

dotenv.config();

const app = express();
app.use(express.json({ limit: "6mb" }));

const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
app.use(cors({
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
}));
app.options("*", cors());

// ─── Auth (file-backed user registry) ─────────────────────────────────────────
// Users must sign up before they can sign in. Passwords are hashed with scrypt.
// User data in notebooks/chats stays in browser localStorage, keyed per uid.
const JWT_SECRET = process.env.JWT_SECRET || "study-assistant-secret-2026";
const UID_PEPPER  = process.env.UID_PEPPER  || "sa-uid-pepper-2026";

// Mentor credentials (hardcoded — no DB needed)
const MENTOR_USERNAME = "ss6156";
const MENTOR_PASSWORD  = "saishashank";
const MENTOR_UID       = "mentor_ss6156";

function deriveUid(email, password) {
  return crypto.createHmac("sha256", UID_PEPPER)
    .update(`${email.toLowerCase().trim()}::${password}`)
    .digest("hex")
    .slice(0, 28);
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "365d" });
}

function verifyToken(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  try { return jwt.verify(h.slice(7), JWT_SECRET); } catch { return null; }
}

// ─── Auth endpoints ────────────────────────────────────────────────────────────

// Sign up — creates a new account (email must be unique)
app.post("/api/auth/signup", (req, res) => {
  try {
    const { email, password, username } = req.body || {};
    if (!email || !password || !username)
      return res.status(400).json({ error: "email, password and username are required" });
    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters" });

    const uid = "u_" + deriveUid(email, password);
    const result = registerUser({ email, password, username, uid });
    if (result.error) return res.status(result.status).json({ error: result.error });

    const user = { uid: result.user.uid, email: result.user.email, username: result.user.username, role: "student" };
    res.json({ token: signToken(user), user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sign in — only registered users with correct password
app.post("/api/auth/signin", (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ error: "email and password are required" });

    // Mentor shortcut (hardcoded admin)
    if (email.trim() === MENTOR_USERNAME || email.trim().toLowerCase() === "mentor@studyassistant.app") {
      if (password !== MENTOR_PASSWORD)
        return res.status(401).json({ error: "Incorrect mentor password" });
      const user = { uid: MENTOR_UID, email: "mentor@studyassistant.app", username: MENTOR_USERNAME, role: "mentor" };
      return res.json({ token: signToken(user), user });
    }

    const result = authenticateUser(email, password);
    if (result.error) return res.status(result.status).json({ error: result.error });

    const user = { uid: result.user.uid, email: result.user.email, username: result.user.username, role: "student" };
    res.json({ token: signToken(user), user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Verify token — returns user info embedded in JWT (no DB lookup)
app.get("/api/auth/me", (req, res) => {
  const payload = verifyToken(req);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });
  const { uid, email, username, role } = payload;
  res.json({ uid, email, username, role });
});

const API_KEY = process.env.OPENROUTER_API_KEY;
const DEFAULT_MODEL = process.env.OPENROUTER_DEFAULT_MODEL || "deepseek/deepseek-v3.2";
const FALLBACK_MODELS = ["deepseek/deepseek-v3.2", "google/gemini-2.0-flash"];
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

if (!API_KEY) {
  console.error("WARNING: OPENROUTER_API_KEY not set — AI endpoints will return 503");
}

const MODEL_CHAIN = [DEFAULT_MODEL, ...FALLBACK_MODELS];

const OR_HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
  "HTTP-Referer": "http://localhost:3000",
  "X-Title": "Study Assistant",
};

async function callOpenRouter(messages, opts = {}) {
  const { temperature = 0.5, max_tokens = 1200, response_format = null, tryModels = MODEL_CHAIN } = opts;
  let lastErr = null;
  for (const model of tryModels) {
    const body = { model, messages, temperature, max_tokens };
    if (response_format) body.response_format = response_format;
    try {
      const res = await fetch(OPENROUTER_URL, { method: "POST", headers: OR_HEADERS, body: JSON.stringify(body) });
      if (res.status === 429) { lastErr = new Error(`Rate limited on ${model}`); await sleep(400); continue; }
      if (!res.ok) { const t = await res.text(); lastErr = new Error(`OpenRouter ${res.status}: ${t.slice(0, 200)}`); continue; }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      if (!content) { lastErr = new Error(`Empty content from ${model}`); continue; }
      return { content, model };
    } catch (e) { lastErr = e; continue; }
  }
  throw lastErr || new Error("All models failed");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractJSON(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) {
    // Try array
    const as = t.indexOf("["), ae = t.lastIndexOf("]");
    if (as !== -1 && ae !== -1) { try { return JSON.parse(t.slice(as, ae + 1)); } catch {} }
    return null;
  }
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

function tryParseJSON(content, fallback = null) {
  try { const d = JSON.parse(content); if (d) return d; } catch {}
  return extractJSON(content) || fallback;
}

function sysPrompt(text) { return { role: "system", content: text }; }
function userPrompt(text) { return { role: "user", content: text }; }

function buildSourcesBlock(sources) {
  if (!sources || !sources.length) return "";
  return `\n\nSOURCES:\n${sources.map((s, i) => {
    const ctx = s.context || "full";
    const body = ctx === "summary" ? (s.summary || s.text.slice(0, 600)) : s.text.slice(0, 6000);
    return `[Source ${i + 1}] (title: ${s.title || "untitled"}, type: ${s.type || "text"})\n${body}`;
  }).join("\n\n")}`;
}

// ─── Health ───────────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => res.json({ status: "ok", model: DEFAULT_MODEL, time: Date.now() }));

// ─── Chat (with SSE streaming support) ───────────────────────────────────────

app.post("/api/chat", async (req, res) => {
  try {
    if (!API_KEY) return res.status(503).json({ error: "AI service not configured (missing API key)" });

    const { messages = [], sources = [], subject, default_lang = "English", notes = [], stream: doStream } = req.body || {};

    let sysContent = `You are an expert, patient study tutor. Explain concepts clearly with examples and analogies. Use Markdown formatting. Keep answers focused and educational.`;
    if (subject) sysContent += ` Subject context: ${subject}.`;
    if (default_lang !== "English") sysContent += ` IMPORTANT: Write your entire response in ${default_lang}. Only code/technical terms may stay in English.`;
    const activeSources = sources.filter(s => s.context !== "excluded");
    if (activeSources.length) {
      sysContent += `\nWhen you rely on a provided source, cite it as [Source N] inline where N matches the source number.`;
      sysContent += buildSourcesBlock(activeSources);
    }
    if (notes.length) {
      sysContent += `\n\nStudent notes (use for context if relevant):\n${notes.map((n, i) => `Note ${i + 1}: ${n.title || ""}\n${(n.text || "").slice(0, 1500)}`).join("\n\n")}`;
    }

    const sys = sysPrompt(sysContent);
    const allMsgs = [sys, ...messages.filter(m => m.role === "user" || m.role === "assistant").slice(-10)];

    if (doStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      res.write(": connected\n\n"); // immediate byte so client/proxy knows we're alive

      const streamRes = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: OR_HEADERS,
        body: JSON.stringify({ model: DEFAULT_MODEL, messages: allMsgs, temperature: 0.4, max_tokens: 1500, stream: true }),
      });

      if (!streamRes.ok) {
        const t = await streamRes.text();
        res.write(`data: ${JSON.stringify({ error: `API ${streamRes.status}: ${t.slice(0, 200)}` })}\n\n`);
        return res.end();
      }

      const reader = streamRes.body.getReader();
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
          if (!t || t === "data: [DONE]") continue;
          if (!t.startsWith("data: ")) continue;
          try {
            const chunk = JSON.parse(t.slice(6));
            const token = chunk?.choices?.[0]?.delta?.content || "";
            if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
          } catch {}
        }
      }
      res.write("data: [DONE]\n\n");
      return res.end();
    }

    // Non-streaming fallback
    const { content, model } = await callOpenRouter(allMsgs, { temperature: 0.4, max_tokens: 1500 });
    const citations = [];
    const re = /\[Source\s+(\d+)\]/gi;
    let m;
    while ((m = re.exec(content)) !== null) citations.push({ source: parseInt(m[1], 10), index: m.index });
    res.json({ reply: content, model, citations });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ─── Quiz ─────────────────────────────────────────────────────────────────────

app.post("/api/quiz", async (req, res) => {
  try {
    const { topic, count = 10, level = "medium", sources = [], default_lang = "English", from_text } = req.body || {};
    if (!topic && !from_text && !sources.length) return res.status(400).json({ error: "topic, from_text, or sources required" });
    const n = Math.min(Math.max(parseInt(count, 10) || 10, 1), 10);
    const lvl = ["easy", "medium", "hard"].includes(level) ? level : "medium";
    let sysContent = `You are a quiz generator. Generate ${n} multiple-choice questions at ${lvl} difficulty. Return STRICT JSON only:\n{"questions":[{"q":"question","options":["A","B","C","D"],"answer_index":0,"explanation":"why correct"}]}\nExactly 4 options. answer_index is 0-based. Output ONLY the JSON object.`;
    if (default_lang !== "English") sysContent += ` Write in ${default_lang}.`;
    const sys = sysPrompt(sysContent);
    let userContent = "";
    if (from_text) userContent += `Generate questions from this content:\n\n${from_text.slice(0, 8000)}\n\n`;
    if (topic) userContent += `Topic: ${topic}\n`;
    if (sources.length) userContent += `\nBase questions on these sources:\n${sources.filter(s => s.context !== "excluded").map((s, i) => `[Source ${i + 1}] ${s.text.slice(0, 3000)}`).join("\n\n")}\n`;
    userContent += `Difficulty: ${lvl}\nCount: ${n}`;
    const { content, model } = await callOpenRouter([sys, userPrompt(userContent)], { temperature: 0.7, max_tokens: 2200, response_format: { type: "json_object" } });
    const parsed = tryParseJSON(content, null);
    if (!parsed || !Array.isArray(parsed.questions)) return res.status(502).json({ error: "Quiz JSON parse failed", raw: content });
    res.json({ questions: parsed.questions.slice(0, n), model });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Summary ──────────────────────────────────────────────────────────────────

app.post("/api/summary", async (req, res) => {
  try {
    const { topic, text, sources = [], default_lang = "English" } = req.body || {};
    if (!topic && !text && !sources.length) return res.status(400).json({ error: "topic, text, or sources required" });
    let sysContent = `You are a study-notes summarizer. Produce concise bullet-point revision notes in Markdown. Use ## headings, bullet points, and **bold** key terms. Max ~250 words. No fluff.`;
    if (default_lang !== "English") sysContent += ` Write in ${default_lang}.`;
    let userContent = "";
    if (text) userContent += `Summarize:\n\n${text.slice(0, 8000)}\n\n`;
    if (topic) userContent += `Topic: "${topic}"\n`;
    if (sources.length) userContent += `\nSources:\n${sources.filter(s => s.context !== "excluded").map((s, i) => `[Source ${i + 1}] ${s.text.slice(0, 3000)}`).join("\n\n")}\n`;
    const { content, model } = await callOpenRouter([sysPrompt(sysContent), userPrompt(userContent)], { temperature: 0.3, max_tokens: 1200 });
    res.json({ summary: content, model });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Translate ────────────────────────────────────────────────────────────────

app.post("/api/translate", async (req, res) => {
  try {
    const { text, source_lang = "English", target_lang = "Hindi" } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });
    const sys = sysPrompt(`You are an expert educational translator. Translate from ${source_lang} to ${target_lang}.\nRules:\n1. Translate ALL prose into ${target_lang} — no English sentences left untranslated.\n2. Keep code blocks exactly as-is.\n3. Keep technical terms with no equivalent in ${target_lang} in English (add a ${target_lang} gloss on first use).\n4. Do NOT transliterate — produce fluent natural ${target_lang}.\n5. Preserve all Markdown formatting.\n6. Output ONLY the translated text.`);
    const { content, model } = await callOpenRouter([sys, userPrompt(text)], { temperature: 0.2, max_tokens: 2500 });
    res.json({ translation: content.trim(), model });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Recommend ────────────────────────────────────────────────────────────────

app.post("/api/recommend", async (req, res) => {
  try {
    const { topic, level = "beginner", default_lang = "English" } = req.body || {};
    if (!topic) return res.status(400).json({ error: "topic required" });
    let sysContent = `You are a study advisor. For the given topic, suggest a learning path. Return STRICT JSON only:\n{"resources":[{"type":"topic"|"youtube"|"book"|"practice","title":"short title","query":"search query string"}]}\nProvide 6-8 resources mixing types. Output ONLY the JSON object.`;
    if (default_lang !== "English") sysContent += ` Write titles in ${default_lang}.`;
    const { content, model } = await callOpenRouter([sysPrompt(sysContent), userPrompt(`Topic: ${topic}\nLevel: ${level}`)], { temperature: 0.6, max_tokens: 1200, response_format: { type: "json_object" } });
    const parsed = tryParseJSON(content, null);
    if (!parsed || !Array.isArray(parsed.resources)) return res.status(502).json({ error: "Recommend JSON parse failed", raw: content });
    res.json({ resources: parsed.resources, model });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Podcast ──────────────────────────────────────────────────────────────────

app.post("/api/podcast", async (req, res) => {
  try {
    const { sources = [], notes = [], topic, default_lang = "English", length = "medium" } = req.body || {};
    if (!sources.length && !notes.length && !topic) return res.status(400).json({ error: "sources, notes, or topic required" });
    const lengthMap = { short: "6-8 segments total", medium: "10-14 segments total", long: "16-20 segments total" };
    const segCount = lengthMap[length] || lengthMap.medium;
    let sysContent = `You are an expert educational podcast scriptwriter. Write a REAL, substantive conversation between two people who are genuinely discussing the source material.

SPEAKERS:
- "Host": A curious interviewer who asks pointed, specific questions referencing actual concepts, terms, and facts from the source material. NEVER just reacts — always drives the conversation forward with a specific question.
- "Expert": A knowledgeable teacher who gives detailed, concrete answers using specific facts, examples, mechanisms, and explanations drawn from the source material.

ABSOLUTE PROHIBITIONS — instantly reject any segment starting with or containing:
"Fascinating", "Great question", "Absolutely", "Certainly", "Of course", "Indeed", "Exactly", "That's interesting", "That's a great point", "You make an excellent point", "Definitely", "Totally", "Sure thing", "Right!", "Wonderful", "Amazing", "Brilliant", "Incredible", "Wow", "Impressive"

CONVERSATION RULES:
1. Every "Host" segment: contains a SPECIFIC question about a named concept, term, mechanism, or fact from the sources — no generic "tell me about..." openers
2. Every "Expert" segment: contains SPECIFIC information from the sources (names, numbers, mechanisms, examples) — no vague generalizations
3. Each segment directly responds to the previous one — this is a DIALOGUE, not two independent monologues
4. Host opens by citing a specific surprising or counterintuitive aspect of the content, then asks why/how
5. Expert closes by connecting the topic to a real-world implication or application drawn from the sources
6. Segments alternate strictly: Host, Expert, Host, Expert...

Return STRICT JSON only:
{"title":"descriptive podcast title","segments":[{"speaker":"Host"|"Expert","text":"substantive dialogue here","lang":"BCP-47 code"}]}
- ${segCount} (strictly alternating, starting with Host)
- Each segment: 2-4 sentences of substantive content
- "lang": BCP-47 code for ${default_lang}
- Output ONLY the JSON object, no markdown fences`;
    let userContent = "";
    if (topic) userContent += `Topic: ${topic}\n`;
    if (sources.length) userContent += `\nSources:\n${sources.filter(s => s.context !== "excluded").map((s, i) => `[Source ${i + 1}] ${s.text.slice(0, 3000)}`).join("\n\n")}\n`;
    if (notes.length) userContent += `\nStudent notes:\n${notes.map((n, i) => `Note ${i + 1}: ${n.text.slice(0, 1500)}`).join("\n\n")}\n`;
    const { content, model } = await callOpenRouter([sysPrompt(sysContent), userPrompt(userContent)], { temperature: 0.7, max_tokens: 3000, response_format: { type: "json_object" } });
    const parsed = tryParseJSON(content, null);
    if (!parsed || !Array.isArray(parsed.segments)) return res.status(502).json({ error: "Podcast JSON parse failed", raw: content });
    res.json({ title: parsed.title || "Study Podcast", segments: parsed.segments, model });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Fetch URL (new) ──────────────────────────────────────────────────────────

app.post("/api/fetch-url", async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: "Valid http/https URL required" });
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; StudyAssistant/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return res.status(502).json({ error: `Remote server returned ${response.status}` });
    const html = await response.text();
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim().slice(0, 120) : url;
    // Strip scripts, styles, nav, footer, header
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s{3,}/g, "\n\n")
      .trim()
      .slice(0, 20000);
    if (!text || text.length < 100) return res.status(422).json({ error: "Could not extract readable text from this URL" });
    res.json({ text, title: pageTitle, url });
  } catch (e) {
    if (e.name === "TimeoutError") return res.status(504).json({ error: "URL fetch timed out (12s)" });
    res.status(502).json({ error: `Fetch failed: ${e.message}` });
  }
});

// ─── Study Guide: FAQ ─────────────────────────────────────────────────────────

app.post("/api/study-guide/faq", async (req, res) => {
  try {
    const { sources = [], notes = [], default_lang = "English" } = req.body || {};
    const activeSources = sources.filter(s => s.context !== "excluded");
    if (!activeSources.length && !notes.length) return res.status(400).json({ error: "sources or notes required" });
    const sysContent = `You are a study guide creator. Based on the provided source material, generate a comprehensive FAQ with 8-10 questions and detailed answers. Return STRICT JSON only:\n{"faq":[{"question":"Q?","answer":"detailed answer 2-4 sentences","sourceHint":"brief hint about which source this came from"}]}\nMake questions cover the most important concepts. Answers should be clear and educational. Output ONLY the JSON object.`;
    let userContent = buildSourcesBlock(activeSources);
    if (notes.length) userContent += `\n\nStudent notes:\n${notes.map((n, i) => `Note ${i + 1}: ${n.text.slice(0, 1500)}`).join("\n\n")}`;
    if (default_lang !== "English") userContent += `\n\nWrite all questions and answers in ${default_lang}.`;
    const { content, model } = await callOpenRouter([sysPrompt(sysContent), userPrompt(userContent)], { temperature: 0.4, max_tokens: 2500, response_format: { type: "json_object" } });
    const parsed = tryParseJSON(content, null);
    if (!parsed || !Array.isArray(parsed.faq)) return res.status(502).json({ error: "FAQ parse failed", raw: content });
    res.json({ faq: parsed.faq, model });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Study Guide: Briefing Doc ────────────────────────────────────────────────

app.post("/api/study-guide/briefing", async (req, res) => {
  try {
    const { sources = [], notes = [], default_lang = "English" } = req.body || {};
    const activeSources = sources.filter(s => s.context !== "excluded");
    if (!activeSources.length && !notes.length) return res.status(400).json({ error: "sources or notes required" });
    const sysContent = `You are a professional study brief writer. Based on the source material, create a comprehensive briefing document using this EXACT Markdown structure:\n\n## Executive Summary\n3-sentence overview.\n\n## Key Findings\n- Finding 1\n- Finding 2\n(5-7 bullet points)\n\n## Important Details\nDetailed paragraphs on the most important content.\n\n## Key Terms & Definitions\n**Term**: Definition\n(List 5-8 key terms)\n\n## Key Takeaways\n- Takeaway 1\n(3-5 actionable takeaways)\n\nBe thorough, precise, and educational.`;
    let userContent = buildSourcesBlock(activeSources);
    if (notes.length) userContent += `\n\nStudent notes:\n${notes.map((n, i) => `Note ${i + 1}: ${n.text.slice(0, 1500)}`).join("\n\n")}`;
    if (default_lang !== "English") userContent += `\n\nWrite the entire document in ${default_lang}.`;
    const { content, model } = await callOpenRouter([sysPrompt(sysContent), userPrompt(userContent)], { temperature: 0.3, max_tokens: 2000 });
    res.json({ briefing: content, model });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Study Guide: Outline ─────────────────────────────────────────────────────

app.post("/api/study-guide/outline", async (req, res) => {
  try {
    const { sources = [], notes = [], default_lang = "English" } = req.body || {};
    const activeSources = sources.filter(s => s.context !== "excluded");
    if (!activeSources.length && !notes.length) return res.status(400).json({ error: "sources or notes required" });
    const sysContent = `You are a curriculum outline creator. Based on the source material, create a hierarchical outline of all topics and subtopics. Return STRICT JSON:\n{"title":"Overall Topic","outline":[{"topic":"I. Main Topic","subtopics":["A. Subtopic 1","B. Subtopic 2"],"summary":"1-sentence summary of this section"}]}\nCover all major themes. Include 4-8 main topics. Output ONLY the JSON object.`;
    let userContent = buildSourcesBlock(activeSources);
    if (notes.length) userContent += `\n\nStudent notes:\n${notes.map((n, i) => `Note ${i + 1}: ${n.text.slice(0, 1500)}`).join("\n\n")}`;
    if (default_lang !== "English") userContent += `\n\nWrite all topics in ${default_lang}.`;
    const { content, model } = await callOpenRouter([sysPrompt(sysContent), userPrompt(userContent)], { temperature: 0.4, max_tokens: 2000, response_format: { type: "json_object" } });
    const parsed = tryParseJSON(content, null);
    if (!parsed || !Array.isArray(parsed.outline)) return res.status(502).json({ error: "Outline parse failed", raw: content });
    res.json({ title: parsed.title || "Study Outline", outline: parsed.outline, model });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Studio: Slides ───────────────────────────────────────────────────────────

app.post("/api/studio/slides", async (req, res) => {
  try {
    const { sources = [], notes = [], topic, default_lang = "English" } = req.body || {};
    const activeSources = sources.filter(s => s.context !== "excluded");
    if (!activeSources.length && !notes.length && !topic) return res.status(400).json({ error: "sources, notes, or topic required" });
    const sysContent = `You are a presentation designer. Create a clear educational slide deck from the provided content. Return STRICT JSON only:
{"title":"Deck Title","slides":[{"heading":"Slide Title","bullets":["Point 1","Point 2","Point 3"],"note":"1-sentence speaker note"}]}
Rules:
- 6-8 slides total
- First slide: overview/introduction
- Last slide: key takeaways
- 3-5 bullets per slide, each bullet max 12 words
- No bullet starts with the same word twice in a row
- Output ONLY the JSON object`;
    let userContent = topic ? `Topic: ${topic}\n` : "";
    userContent += buildSourcesBlock(activeSources);
    if (notes.length) userContent += `\n\nStudent notes:\n${notes.map((n, i) => `Note ${i + 1}: ${n.text.slice(0, 1500)}`).join("\n\n")}`;
    if (default_lang !== "English") userContent += `\n\nWrite all content in ${default_lang}.`;
    const { content, model } = await callOpenRouter([sysPrompt(sysContent), userPrompt(userContent)], { temperature: 0.4, max_tokens: 2500, response_format: { type: "json_object" } });
    const parsed = tryParseJSON(content, null);
    if (!parsed || !Array.isArray(parsed.slides)) return res.status(502).json({ error: "Slides parse failed", raw: content.slice(0, 300) });
    res.json({ title: parsed.title || "Slide Deck", slides: parsed.slides, model });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Studio: Mind Map ─────────────────────────────────────────────────────────

app.post("/api/studio/mindmap", async (req, res) => {
  try {
    const { sources = [], notes = [], topic, default_lang = "English" } = req.body || {};
    const activeSources = sources.filter(s => s.context !== "excluded");
    if (!activeSources.length && !notes.length && !topic) return res.status(400).json({ error: "sources, notes, or topic required" });
    const sysContent = `You are a knowledge-mapping expert. Extract the core concepts from the provided content and organize them into a hierarchical mind map. Return STRICT JSON only:
{"title":"Central Topic","root":{"id":"root","label":"Central Topic","children":[{"id":"n1","label":"Main Branch 1","children":[{"id":"n1a","label":"Sub-concept","children":[]},{"id":"n1b","label":"Sub-concept","children":[]}]},{"id":"n2","label":"Main Branch 2","children":[]}]}}
Rules:
- Root node: the overarching topic (1-4 words)
- 4-7 main branches off root
- Each branch: 2-4 sub-nodes
- Sub-nodes may have 0-2 children (max depth 3 from root)
- Every label: 1-5 words, crystal-clear
- Every node must have a unique "id"
- Total nodes: 20-40
- Output ONLY the JSON object`;
    let userContent = topic ? `Topic: ${topic}\n` : "";
    userContent += buildSourcesBlock(activeSources);
    if (notes.length) userContent += `\n\nStudent notes:\n${notes.map((n, i) => `Note ${i + 1}: ${n.text.slice(0, 1500)}`).join("\n\n")}`;
    if (default_lang !== "English") userContent += `\n\nWrite all labels in ${default_lang}.`;
    const { content, model } = await callOpenRouter([sysPrompt(sysContent), userPrompt(userContent)], { temperature: 0.3, max_tokens: 3000, response_format: { type: "json_object" } });
    const parsed = tryParseJSON(content, null);
    if (!parsed || !parsed.root) return res.status(502).json({ error: "Mind map parse failed", raw: content.slice(0, 300) });
    res.json({ title: parsed.title || "Mind Map", root: parsed.root, model });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Studio: Report ───────────────────────────────────────────────────────────

app.post("/api/studio/report", async (req, res) => {
  try {
    const { sources = [], notes = [], topic, default_lang = "English" } = req.body || {};
    const activeSources = sources.filter(s => s.context !== "excluded");
    if (!activeSources.length && !notes.length && !topic) return res.status(400).json({ error: "sources, notes, or topic required" });
    const sysContent = `You are an expert academic report writer. Based on the source material, produce a comprehensive, well-structured report in Markdown. Use this structure:

# [Report Title]

## Abstract
2-3 sentence summary of the entire report.

## 1. Introduction
Background, context, and why this matters.

## 2. Core Concepts
Explain the main ideas in depth. Use sub-sections (### 2.1, ### 2.2) as needed.

## 3. Key Findings & Analysis
Detailed analysis of important points with evidence from sources. Cite sources inline as [1], [2], etc.

## 4. Implications & Applications
Real-world applications and why these findings matter.

## 5. Conclusion
Synthesis of key points and future directions.

## References
List sources cited.

Be thorough, analytical, and educational. Minimum 600 words.`;
    let userContent = topic ? `Topic: ${topic}\n` : "";
    userContent += buildSourcesBlock(activeSources);
    if (notes.length) userContent += `\n\nStudent notes:\n${notes.map((n, i) => `Note ${i + 1}: ${n.text.slice(0, 1500)}`).join("\n\n")}`;
    if (default_lang !== "English") userContent += `\n\nWrite the entire report in ${default_lang}.`;
    const { content, model } = await callOpenRouter([sysPrompt(sysContent), userPrompt(userContent)], { temperature: 0.3, max_tokens: 4000 });
    res.json({ report: content, model });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Studio: Flashcards ───────────────────────────────────────────────────────

app.post("/api/studio/flashcards", async (req, res) => {
  try {
    const { sources = [], notes = [], topic, default_lang = "English" } = req.body || {};
    const activeSources = sources.filter(s => s.context !== "excluded");
    if (!activeSources.length && !notes.length && !topic) return res.status(400).json({ error: "sources, notes, or topic required" });
    const sysContent = `You are a flashcard creator for active recall learning. Generate flashcards from the provided content. Return STRICT JSON only:
{"cards":[{"id":"fc1","front":"Question or term on the front","back":"Answer or definition on the back","hint":"optional 1-3 word hint","difficulty":"easy"|"medium"|"hard"}]}
Rules:
- 12-18 cards
- Front: a question, term, or fill-in-the-blank prompt
- Back: concise answer, definition, or completion (max 50 words)
- Mix question types: definition, "what is", "how does", "why", fill-in-blank
- Vary difficulty: ~30% easy, ~50% medium, ~20% hard
- Cover all major concepts from the source
- Output ONLY the JSON object`;
    let userContent = topic ? `Topic: ${topic}\n` : "";
    userContent += buildSourcesBlock(activeSources);
    if (notes.length) userContent += `\n\nStudent notes:\n${notes.map((n, i) => `Note ${i + 1}: ${n.text.slice(0, 1500)}`).join("\n\n")}`;
    if (default_lang !== "English") userContent += `\n\nWrite all cards in ${default_lang}.`;
    const { content, model } = await callOpenRouter([sysPrompt(sysContent), userPrompt(userContent)], { temperature: 0.5, max_tokens: 3000, response_format: { type: "json_object" } });
    const parsed = tryParseJSON(content, null);
    if (!parsed || !Array.isArray(parsed.cards)) return res.status(502).json({ error: "Flashcards parse failed", raw: content.slice(0, 300) });
    res.json({ cards: parsed.cards, model });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Studio: Data Table ───────────────────────────────────────────────────────

app.post("/api/studio/datatable", async (req, res) => {
  try {
    const { sources = [], notes = [], topic, default_lang = "English" } = req.body || {};
    const activeSources = sources.filter(s => s.context !== "excluded");
    if (!activeSources.length && !notes.length && !topic) return res.status(400).json({ error: "sources, notes, or topic required" });
    const sysContent = `You are a data extraction specialist. Extract structured tabular data from the provided content. Return STRICT JSON only:
{"title":"Table Title","description":"1-sentence description of what this table shows","columns":["Column 1","Column 2","Column 3"],"rows":[["cell1","cell2","cell3"],["cell1","cell2","cell3"]]}
Rules:
- Extract or synthesize the most useful tabular representation of the content
- Good candidates: comparisons, timelines, feature lists, step-by-step processes, classifications
- 3-6 columns, 5-15 rows
- Each cell: concise, max 10 words
- Column headers: short, descriptive
- If content doesn't have obvious tabular data, create a comparison/summary table of key concepts
- Output ONLY the JSON object`;
    let userContent = topic ? `Topic: ${topic}\n` : "";
    userContent += buildSourcesBlock(activeSources);
    if (notes.length) userContent += `\n\nStudent notes:\n${notes.map((n, i) => `Note ${i + 1}: ${n.text.slice(0, 1500)}`).join("\n\n")}`;
    if (default_lang !== "English") userContent += `\n\nWrite all content in ${default_lang}.`;
    const { content, model } = await callOpenRouter([sysPrompt(sysContent), userPrompt(userContent)], { temperature: 0.3, max_tokens: 2000, response_format: { type: "json_object" } });
    const parsed = tryParseJSON(content, null);
    if (!parsed || !Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return res.status(502).json({ error: "Data table parse failed", raw: content.slice(0, 300) });
    res.json({ title: parsed.title || "Data Table", description: parsed.description || "", columns: parsed.columns, rows: parsed.rows, model });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── TTS ──────────────────────────────────────────────────────────────────────

function pcm16ToWav(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + dataSize, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28); header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34); header.write("data", 36); header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

// ─── Explain endpoint ──────────────────────────────────────────────────────────
app.post("/api/explain", async (req, res) => {
  try {
    const { content, question, lang = "English", chatHistory = [] } = req.body || {};
    if (!content) return res.status(400).json({ error: "content required" });

    // Infer user level from their chat history
    let levelHint = "";
    if (chatHistory.length >= 2) {
      const userMsgs = chatHistory
        .filter(m => m.role === "user")
        .map(m => m.content)
        .slice(-10)
        .join("\n");
      const avgLen = userMsgs.split("\n").reduce((a, b) => a + b.length, 0) / Math.max(userMsgs.split("\n").length, 1);
      const hasCode = /```|function|class |import |def |var |const |let |print\(|console\./.test(userMsgs);
      const hasAdvanced = /complexity|algorithm|recursion|pointer|async|promise|optimization|O\(n|O\(log/.test(userMsgs.toLowerCase());
      const hasBeginner = /what is|how do|why does|explain|what does|i don't understand|what are/i.test(userMsgs);

      if (hasAdvanced || (hasCode && avgLen > 80)) levelHint = "intermediate-to-advanced";
      else if (hasBeginner || avgLen < 40)          levelHint = "beginner";
      else                                           levelHint = "intermediate";
    } else {
      levelHint = "intermediate";
    }

    const levelGuide = {
      "beginner":                "Use very simple language, real-life analogies, and avoid jargon. Break every concept into tiny steps. Think: explaining to a first-year student.",
      "intermediate":            "Use clear technical language with occasional analogies. Assume familiarity with basics but not advanced concepts.",
      "intermediate-to-advanced":"Be precise and technical. Use proper terminology. Include complexity or nuance. Treat the user as a capable developer/student.",
    }[levelHint];

    const inLang = lang !== "English"
      ? `CRITICAL: Write your ENTIRE explanation in ${lang}. Only code identifiers or technical keywords may stay in English.`
      : "";

    // Build a mini conversation context so the explanation feels personalized
    const recentContext = chatHistory
      .filter(m => m.role === "user")
      .slice(-5)
      .map(m => `- "${m.content.slice(0, 120)}"`)
      .join("\n");

    const sys = sysPrompt(`You are an expert tutor crafting a spoken audio explanation — NOT a text document.

KEY RULES:
- Write in a natural, flowing spoken style (no bullet points, no markdown, no ## headings)
- Use smooth transitions like "Now, let's talk about…", "Here's the key insight:", "Think of it this way:"
- Each sentence should flow naturally when read aloud
- Adapt to this student's level: ${levelHint} — ${levelGuide}
- Personalize based on what they've been asking about:
${recentContext || "  (no prior context)"}
- Length: 3-5 paragraphs of spoken prose (about 60-90 seconds of audio)
- Do NOT start with "Great question!" or filler phrases — dive right in
${inLang}`);

    const user = userPrompt(
      question
        ? `The student asked: "${question.slice(0, 300)}"\n\nThe AI replied with:\n${content.slice(0, 3000)}\n\nNow give a rich spoken audio explanation that builds on this, calibrated to their level.`
        : `Explain this content as a spoken audio lesson:\n${content.slice(0, 3000)}`
    );

    const { content: explanation, model } = await callOpenRouter(
      [sys, user],
      { temperature: 0.5, max_tokens: 1800 }
    );
    res.json({ explanation, model, level: levelHint });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Study Resources endpoint ─────────────────────────────────────────────────
app.post("/api/studio/resources", async (req, res) => {
  try {
    const { sources = [], topic = "", default_lang = "English" } = req.body || {};
    const hasSources = sources.length > 0;
    if (!hasSources && !topic.trim()) return res.status(400).json({ error: "sources or topic required" });

    const context = hasSources
      ? buildSourcesBlock(sources)
      : `Topic to master: "${topic.trim()}"`;

    const inLang = default_lang !== "English"
      ? `\nWrite ALL content in ${default_lang}. Only keep technical terms / URLs in English.`
      : "";

    const sys = sysPrompt(`You are an expert study advisor. Given source material or a topic, produce a comprehensive, curated study resource guide that helps a student truly master the subject.

Return STRICT JSON only matching this schema:
{
  "title": "Study Resources: <topic name>",
  "overview": "2-3 sentence summary of what will be mastered",
  "roadmap": [
    { "phase": "Phase 1: Foundations", "duration": "1-2 weeks", "goals": ["goal 1", "goal 2"] }
  ],
  "resources": [
    {
      "category": "Books / Articles / Courses / Practice / Videos / Tools",
      "items": [
        {
          "name": "Resource name",
          "type": "book|course|video|article|tool|practice",
          "description": "What you'll learn and why it's valuable",
          "level": "beginner|intermediate|advanced",
          "url_hint": "search query or URL if well-known (e.g. 'MIT OpenCourseWare 6.006')",
          "free": true
        }
      ]
    }
  ],
  "practice_plan": "Detailed weekly practice suggestions as a short paragraph",
  "tips": ["Tip 1 for mastery", "Tip 2"]
}

Rules:
- Include 4-6 resource categories with 2-4 items each
- Prioritize free, high-quality resources (MOOCs, official docs, open textbooks)
- Tailor depth to the source material's complexity
- Be specific — name real books, courses, channels, tools
- Output ONLY the JSON object, no markdown fences${inLang}`);

    const { content, model } = await callOpenRouter(
      [sys, userPrompt(context)],
      { temperature: 0.4, max_tokens: 3000, response_format: { type: "json_object" } }
    );
    const parsed = tryParseJSON(content, null);
    if (!parsed) return res.status(502).json({ error: "Invalid JSON from model", raw: content.slice(0, 300) });
    res.json({ ...parsed, model });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Infographic syntax endpoint ──────────────────────────────────────────────
app.post("/api/studio/infographic", async (req, res) => {
  try {
    const { sources = [], topic = "", default_lang = "English" } = req.body || {};
    const context = sources.length ? buildSourcesBlock(sources) : `Topic: ${topic}`;

    const sys = sysPrompt(`You are an expert at creating AntV Infographic syntax. Given content, generate a clear, visually appealing infographic in AntV Infographic DSL syntax.

Rules:
- Choose the most appropriate layout for the content (list-card, timeline, comparison, etc.)
- Include a clear title
- Be concise — each item max 15 words
- Return ONLY the raw infographic syntax, no explanation, no markdown fences, no JSON
- Start directly with "infographic ..." 

Example layouts you can use:
  infographic list-card-vertical
  infographic timeline-vertical  
  infographic comparison-table
  infographic steps-horizontal
  infographic mindmap (for hierarchical content)

${default_lang !== "English" ? `Write all text content in ${default_lang}.` : ""}`);

    const { content } = await callOpenRouter([sys, userPrompt(context)], { temperature: 0.4, max_tokens: 1500 });
    // Clean: remove any markdown fences if model adds them
    const syntax = content.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();
    res.json({ syntax });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Map openai voice names → Gemini voice names
const GEMINI_VOICE_MAP = {
  alloy: "Zephyr", nova: "Aoede", echo: "Puck", sage: "Kore",
  shimmer: "Leda", verse: "Orus", ash: "Fenrir", coral: "Charon",
};

app.post("/api/tts", async (req, res) => {
  try {
    const { text, voice = "alloy" } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });

    // ── Attempt 1: Google Gemini Flash TTS (best multilingual quality) ────────
    try {
      const geminiVoice = GEMINI_VOICE_MAP[voice] || "Aoede";
      const gRes = await fetch("https://openrouter.ai/api/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "Study Assistant",
        },
        body: JSON.stringify({
          model: "google/gemini-3.1-flash-tts-preview",
          input: text,
          voice: geminiVoice,
          response_format: "pcm",
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (gRes.ok) {
        const buf = await gRes.arrayBuffer();
        if (buf.byteLength > 200) {
          // Gemini returns raw PCM16 at 24000Hz mono — wrap in WAV
          const wavData = pcm16ToWav(Buffer.from(buf), 24000, 1, 16);
          res.json({ audio: wavData.toString("base64"), format: "wav", transcript: "" });
          return;
        }
      } else {
        const errText = await gRes.text().catch(() => "");
        console.log(`Gemini TTS ${gRes.status}: ${errText.slice(0, 120)}`);
      }
    } catch (e) { console.log("Gemini TTS error:", e.message); }

    // ── Attempt 2: openai/gpt-audio-mini via audio modalities ────────────────
    const voices = ["alloy", "verse", "nova", "shimmer", "echo", "sage", "ash", "coral"];
    const v = voices.includes(voice) ? voice : "alloy";
    const body = { model: "openai/gpt-audio-mini", messages: [{ role: "user", content: text }], modalities: ["text", "audio"], audio: { voice: v, format: "pcm16" }, stream: true };
    const r = await fetch(OPENROUTER_URL, { method: "POST", headers: OR_HEADERS, body: JSON.stringify(body) });
    if (!r.ok) { const t = await r.text(); return res.status(502).json({ error: `TTS API ${r.status}: ${t.slice(0, 300)}` }); }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const audioChunks = [];
    let transcript = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const chunk = JSON.parse(data);
          const delta = chunk?.choices?.[0]?.delta;
          if (delta?.audio?.data) audioChunks.push(Buffer.from(delta.audio.data, "base64"));
          if (delta?.content) transcript += delta.content;
        } catch {}
      }
    }
    if (!audioChunks.length) return res.status(502).json({ error: "No audio data received" });
    const wavData = pcm16ToWav(Buffer.concat(audioChunks));
    res.json({ audio: wavData.toString("base64"), format: "wav", transcript });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── Start (local dev) / Export (Vercel serverless) ───────────────────────────

export default app;

// Only bind to a port when running locally (not in Vercel serverless)
if (process.env.VERCEL !== "1") {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Study Assistant backend listening on port ${PORT}`);
    console.log(`Model: ${DEFAULT_MODEL}`);
  });
}
