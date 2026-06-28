/* Notebook merge + server sync helpers (shared by app.js and auth.html) */
"use strict";

window.VSA_SYNC = (function () {
  function nbTime(nb) {
    return Number(nb?.updatedAt) || 0;
  }

  function notebookRichness(nb) {
    if (!nb) return 0;
    return (nb.sources?.length || 0) + (nb.chats?.length || 0) + (nb.notes?.length || 0);
  }

  function unionById(a = [], b = [], idKey = "id") {
    const map = new Map();
    for (const item of a) {
      if (item && item[idKey] != null) map.set(item[idKey], item);
    }
    for (const item of b) {
      if (!item || item[idKey] == null) continue;
      const existing = map.get(item[idKey]);
      if (!existing) {
        map.set(item[idKey], item);
        continue;
      }
      const aTime = Number(existing.updatedAt || existing.createdAt) || 0;
      const bTime = Number(item.updatedAt || item.createdAt) || 0;
      map.set(item[idKey], bTime >= aTime ? item : existing);
    }
    return [...map.values()];
  }

  function mergeChatMessages(a = [], b = []) {
    const map = new Map();
    for (const msg of a) {
      const key = `${msg.role}::${msg.content}`;
      map.set(key, msg);
    }
    for (const msg of b) {
      const key = `${msg.role}::${msg.content}`;
      if (!map.has(key)) map.set(key, msg);
    }
    return [...map.values()];
  }

  function mergeChats(a = [], b = []) {
    const map = new Map();
    for (const chat of a) {
      if (chat?.id) map.set(chat.id, chat);
    }
    for (const chat of b) {
      if (!chat?.id) continue;
      const existing = map.get(chat.id);
      if (!existing) {
        map.set(chat.id, chat);
        continue;
      }
      const aTime = Number(existing.updatedAt || existing.createdAt) || 0;
      const bTime = Number(chat.updatedAt || chat.createdAt) || 0;
      const newer = bTime >= aTime ? chat : existing;
      const older = bTime >= aTime ? existing : chat;
      map.set(chat.id, {
        ...newer,
        messages: mergeChatMessages(older.messages || [], newer.messages || []),
      });
    }
    return [...map.values()];
  }

  function mergeNotebook(a, b) {
    const aTime = nbTime(a);
    const bTime = nbTime(b);
    const primary = bTime >= aTime ? b : a;
    const secondary = bTime >= aTime ? a : b;
    const name =
      bTime > aTime ? (b.name || a.name) :
      aTime > bTime ? (a.name || b.name) :
      notebookRichness(b) >= notebookRichness(a) ? (b.name || a.name) : (a.name || b.name);

    return {
      ...primary,
      id: a.id || b.id,
      name: name || "My Notebook",
      emoji: primary.emoji || secondary.emoji || "📓",
      sources: unionById(a.sources, b.sources),
      chats: mergeChats(a.chats, b.chats),
      notes: unionById(a.notes, b.notes),
      studioOutputs: unionById(a.studioOutputs, b.studioOutputs),
      updatedAt: Math.max(aTime, bTime, Date.now()),
    };
  }

  function mergeNotebooks(local = {}, remote = {}) {
    const merged = {};
    const ids = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]);
    for (const id of ids) {
      const a = local[id];
      const b = remote[id];
      if (a && b) merged[id] = mergeNotebook(a, b);
      else merged[id] = a || b;
    }
    return merged;
  }

  function notebooksEqual(a = {}, b = {}) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function touchNotebook(nb) {
    if (nb) nb.updatedAt = Date.now();
  }

  function apiBase() {
    return window.VSA_CONFIG?.API_BASE ?? (
      (location.hostname === "localhost" || location.hostname === "127.0.0.1")
        ? "http://localhost:3000"
        : "https://voice-study-assistant-api.onrender.com"
    );
  }

  async function fetchServerNotebooks(token) {
    try {
      const res = await fetch(`${apiBase()}/api/notebooks`, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { notebooks: {}, updatedAt: 0 };
      const data = await res.json();
      return {
        notebooks: data?.notebooks && typeof data.notebooks === "object" ? data.notebooks : {},
        updatedAt: Number(data.updatedAt) || 0,
      };
    } catch {
      return { notebooks: {}, updatedAt: 0 };
    }
  }

  async function putServerNotebooks(token, notebooks) {
    const res = await fetch(`${apiBase()}/api/notebooks`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ notebooks }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Sync failed (${res.status})`);
    }
    return res.json();
  }

  async function syncAccountNotebooks({ token, uid, storageKey }) {
    const key = storageKey || `sa_notebooks_v2_${uid}`;
    let local = {};
    try {
      const raw = localStorage.getItem(key);
      if (raw) local = JSON.parse(raw);
    } catch {}

    const remote = await fetchServerNotebooks(token);
    const merged = mergeNotebooks(local, remote.notebooks);
    localStorage.setItem(key, JSON.stringify(merged));

    const needsUpload = !notebooksEqual(merged, remote.notebooks) || Object.keys(local).length !== Object.keys(remote.notebooks).length;
    if (needsUpload || Object.keys(merged).length > 0) {
      const result = await putServerNotebooks(token, merged);
      if (result.notebooks && typeof result.notebooks === "object") {
        localStorage.setItem(key, JSON.stringify(result.notebooks));
        return { notebooks: result.notebooks, updatedAt: result.updatedAt };
      }
    }
    return { notebooks: merged, updatedAt: remote.updatedAt };
  }

  return {
    mergeNotebooks,
    notebooksEqual,
    notebookRichness,
    touchNotebook,
    fetchServerNotebooks,
    putServerNotebooks,
    syncAccountNotebooks,
  };
})();
