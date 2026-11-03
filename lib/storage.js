const DEFAULT_SETTINGS = {
  ignoredSites: [],
  ignoreInIncognito: false,
  siteLimits: {},
  globalDailyLimitMinutes: null,
  siteWeeklyLimits: {},
  globalWeeklyLimitMinutes: null,
  siteMonthlyLimits: {},
  globalMonthlyLimitMinutes: null,
  graceMinutes: 0,
  siteSchedules: {},
  siteCategories: {},
  challengeDifficulty: "medium",
  customPassages: [],
};

function emptyDayState() {
  return {
    tracking: { total: 0, sites: {} },
    blocked: { sites: {}, global: false },
    unlocked: { sites: {}, global: false },
    warned: { sites: {}, global: false },
    grace: { sites: {}, global: false },
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
    "siteWeeklyLimits",
    "globalWeeklyLimitMinutes",
    "siteMonthlyLimits",
    "globalMonthlyLimitMinutes",
    "graceMinutes",
    "siteSchedules",
    "siteCategories",
    "challengeDifficulty",
    "customPassages",
  ]);

  function minutesOrNull(value) {
    return typeof value === "number" ? value : null;
  }

  return {
    ignoredSites: Array.isArray(stored.ignoredSites) ? stored.ignoredSites : DEFAULT_SETTINGS.ignoredSites,
    ignoreInIncognito:
      typeof stored.ignoreInIncognito === "boolean" ? stored.ignoreInIncognito : DEFAULT_SETTINGS.ignoreInIncognito,
    siteLimits:
      stored.siteLimits && typeof stored.siteLimits === "object" ? stored.siteLimits : DEFAULT_SETTINGS.siteLimits,
    globalDailyLimitMinutes: minutesOrNull(stored.globalDailyLimitMinutes),
    siteWeeklyLimits:
      stored.siteWeeklyLimits && typeof stored.siteWeeklyLimits === "object"
        ? stored.siteWeeklyLimits
        : DEFAULT_SETTINGS.siteWeeklyLimits,
    globalWeeklyLimitMinutes: minutesOrNull(stored.globalWeeklyLimitMinutes),
    siteMonthlyLimits:
      stored.siteMonthlyLimits && typeof stored.siteMonthlyLimits === "object"
        ? stored.siteMonthlyLimits
        : DEFAULT_SETTINGS.siteMonthlyLimits,
    globalMonthlyLimitMinutes: minutesOrNull(stored.globalMonthlyLimitMinutes),
    graceMinutes: typeof stored.graceMinutes === "number" ? stored.graceMinutes : DEFAULT_SETTINGS.graceMinutes,
    siteSchedules:
      stored.siteSchedules && typeof stored.siteSchedules === "object"
        ? stored.siteSchedules
        : DEFAULT_SETTINGS.siteSchedules,
    siteCategories:
      stored.siteCategories && typeof stored.siteCategories === "object"
        ? stored.siteCategories
        : DEFAULT_SETTINGS.siteCategories,
    challengeDifficulty: ["easy", "medium", "hard"].includes(stored.challengeDifficulty)
      ? stored.challengeDifficulty
      : DEFAULT_SETTINGS.challengeDifficulty,
    customPassages: Array.isArray(stored.customPassages) ? stored.customPassages : DEFAULT_SETTINGS.customPassages,
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
    warned: { ...fresh.warned, ...saved.warned },
    grace: { ...fresh.grace, ...saved.grace },
  };
}

export async function saveDayState(dateKey, state) {
  const key = `tracking-day:${dateKey}`;
  await chrome.storage.local.set({ [key]: state });
}

// Oldest first, today (minus offsetDays) last. offsetDays shifts the whole
// window further into the past - e.g. getRecentDayStates(7, 7) is "the 7
// days before the current 7-day window", used for week-over-week deltas.
export async function getRecentDayStates(days = 7, offsetDays = 0) {
  const results = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i - offsetDays);
    const dateKey = todayKey(d);
    results.push({ dateKey, state: await getDayState(dateKey) });
  }
  return results;
}

// Hostnames with any tracked time in the last `days` days, most-time-first.
export async function getKnownHostnames(days = 30) {
  const recent = await getRecentDayStates(days);
  const totals = {};
  for (const { state } of recent) {
    for (const [hostname, seconds] of Object.entries(state.tracking.sites)) {
      totals[hostname] = (totals[hostname] || 0) + seconds;
    }
  }
  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([hostname]) => hostname);
}

// Distinct category names already assigned to any site, for the options
// page's category-input autocomplete. Pure given settings - no storage read
// of its own.
export function getKnownCategories(settings) {
  return [...new Set(Object.values(settings.siteCategories))].sort((a, b) => a.localeCompare(b));
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
