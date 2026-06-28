// Voice Study Assistant — frontend config
// In production (Vercel), the API lives on the same origin under /api.
// In local dev, the backend runs on localhost:3000.
window.VSA_CONFIG = {
  API_BASE: (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://localhost:3000"
    : "https://voice-study-assistant-api.onrender.com",
};
