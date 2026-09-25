const DEFAULT_SETTINGS = {
  ignoredSites: [],
  ignoreInIncognito: false,
  siteLimits: {},
  globalDailyLimitMinutes: null,
};

function emptyDayState() {
  return {
    tracking: { total: 0, sites: {} },
    blocked: { sites: {}, global: false },
    unlocked: { sites: {}, global: false },
  };
}

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function getSettings() {
  const stored = await chrome.storage.sync.get([
    "ignoredSites",
    "ignoreInIncognito",
    "siteLimits",
    "globalDailyLimitMinutes",
  ]);
  return {
    ignoredSites: Array.isArray(stored.ignoredSites) ? stored.ignoredSites : DEFAULT_SETTINGS.ignoredSites,
    ignoreInIncognito:
      typeof stored.ignoreInIncognito === "boolean" ? stored.ignoreInIncognito : DEFAULT_SETTINGS.ignoreInIncognito,
    siteLimits:
      stored.siteLimits && typeof stored.siteLimits === "object" ? stored.siteLimits : DEFAULT_SETTINGS.siteLimits,
    globalDailyLimitMinutes:
      typeof stored.globalDailyLimitMinutes === "number"
        ? stored.globalDailyLimitMinutes
        : DEFAULT_SETTINGS.globalDailyLimitMinutes,
  };
}

export async function setSettings(partial) {
  await chrome.storage.sync.set(partial);
}

export async function getDayState(dateKey = todayKey()) {
  const key = `tracking-day:${dateKey}`;
  const stored = await chrome.storage.local.get(key);
  const saved = stored[key];
  if (!saved) return emptyDayState();
  const fresh = emptyDayState();
  return {
    tracking: { ...fresh.tracking, ...saved.tracking },
    blocked: { ...fresh.blocked, ...saved.blocked },
    unlocked: { ...fresh.unlocked, ...saved.unlocked },
  };
}

export async function saveDayState(dateKey, state) {
  const key = `tracking-day:${dateKey}`;
  await chrome.storage.local.set({ [key]: state });
}

export function normalizeHostname(input) {
  if (!input || typeof input !== "string") return null;
  let candidate = input.trim();
  if (!candidate) return null;

  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(candidate)) {
    candidate = `http://${candidate}`;
  }

  try {
    const hostname = new URL(candidate).hostname.toLowerCase();
    const hostnamePattern = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/;
    if (!hostname || !hostnamePattern.test(hostname)) return null;
    return hostname;
  } catch {
    return null;
  }
}

const ACTIVE_SESSION_KEY = "activeSession";

export async function getActiveSession() {
  const stored = await chrome.storage.session.get(ACTIVE_SESSION_KEY);
  return stored[ACTIVE_SESSION_KEY] || null;
}

export async function saveActiveSession(session) {
  await chrome.storage.session.set({ [ACTIVE_SESSION_KEY]: session });
}

export async function pruneOldDayKeys(maxAgeDays = 90) {
  const { lastPruneDate } = await chrome.storage.local.get("lastPruneDate");
  const today = todayKey();
  if (lastPruneDate === today) return;

  const all = await chrome.storage.local.get(null);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);

  const keysToRemove = Object.keys(all).filter((key) => {
    const match = key.match(/^tracking-day:(\d{4}-\d{2}-\d{2})$/);
    if (!match) return false;
    return new Date(match[1]) < cutoff;
  });

  if (keysToRemove.length) await chrome.storage.local.remove(keysToRemove);
  await chrome.storage.local.set({ lastPruneDate: today });
}
