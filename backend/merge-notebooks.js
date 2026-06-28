function nbTime(nb) {
  return Number(nb?.updatedAt) || 0;
}

export function notebookRichness(nb) {
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

export function mergeNotebooks(local = {}, remote = {}) {
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

export function notebooksEqual(a = {}, b = {}) {
  return JSON.stringify(a) === JSON.stringify(b);
}
