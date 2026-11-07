import {
  getSettings,
  getDayState,
  saveDayState,
  getRecentDayStates,
  todayKey,
  pruneOldDayKeys,
  getActiveSession,
  saveActiveSession,
} from "./lib/storage.js";
import { isBlocked, evaluateLimits, evaluateWarnings, evaluateGraceStarted, exceedsRollingLimit } from "./lib/limits.js";

const ROLLING_PERIODS = [
  { key: "week", days: 7, siteSetting: "siteWeeklyLimits", globalSetting: "globalWeeklyLimitMinutes" },
  { key: "month", days: 30, siteSetting: "siteMonthlyLimits", globalSetting: "globalMonthlyLimitMinutes" },
];

const IDLE_DETECTION_SECONDS = 15;
const MAX_FLUSH_SECONDS = 600; // cap a single flush (e.g. after OS sleep) so a long gap can't over-attribute time

let activeSession = null;

chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
chrome.alarms.create("heartbeat", { periodInMinutes: 1 });

chrome.tabs.onActivated.addListener(handleTabActivated);
chrome.tabs.onUpdated.addListener(handleTabUpdated);
chrome.tabs.onRemoved.addListener(handleTabRemoved);
chrome.windows.onFocusChanged.addListener(handleWindowFocusChanged);
chrome.idle.onStateChanged.addListener(handleIdleStateChanged);
chrome.alarms.onAlarm.addListener(handleAlarm);
chrome.runtime.onMessage.addListener(handleMessage);

wakeAndReconcile();

function hostnameFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function loadActiveSession() {
  if (!activeSession) {
    activeSession = (await getActiveSession()) || {
      hostname: null,
      tabId: null,
      windowId: null,
      startedAt: Date.now(),
      idle: false,
      windowFocused: true,
    };
  }
  return activeSession;
}

// Called on every service-worker wake (fresh module execution). Flushes any
// time that elapsed against the *persisted* anchor (which may predate this
// wake by anywhere from a few seconds to the full suspension) before
// re-deriving what's actually on screen right now.
async function wakeAndReconcile() {
  await flush();

  try {
    const win = await chrome.windows.getLastFocused({ populate: false });
    const windowFocused = !!win && win.focused;
    let hostname = null;
    let tabId = null;
    const windowId = win ? win.id : null;

    if (windowFocused) {
      const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
      if (tab && !tab.incognito) {
        hostname = hostnameFromUrl(tab.url);
        tabId = tab.id;
      } else if (tab && tab.incognito) {
        const settings = await getSettings();
        if (!settings.ignoreInIncognito) {
          hostname = hostnameFromUrl(tab.url);
          tabId = tab.id;
        }
      }
    }

    let idle = false;
    try {
      const state = await chrome.idle.queryState(IDLE_DETECTION_SECONDS);
      idle = state !== "active";
    } catch {
      idle = false;
    }

    activeSession.hostname = hostname;
    activeSession.tabId = tabId;
    activeSession.windowId = windowId;
    activeSession.windowFocused = windowFocused;
    activeSession.idle = idle;
    await saveActiveSession(activeSession);
  } catch {
    // Leave the just-flushed state as-is; the next event will retry reconciliation.
  }
}

// flush() is called from seven different event handlers with no natural
// ordering between them (a fast tab-switch can land right on the once-a-
// minute heartbeat). Without serialization, two overlapping calls would both
// read the same stale activeSession.startedAt, double-count the same elapsed
// interval, and race two saveDayState writes to the same key. Queue every
// call behind a single promise chain so only one doFlush() body ever runs
// at a time; a throwing call still lets the chain continue for the next one.
let flushChain = Promise.resolve();

function flush() {
  const run = flushChain.then(() => doFlush());
  flushChain = run.catch(() => {});
  return run;
}

async function doFlush() {
  const now = Date.now();
  await loadActiveSession();
  const settings = await getSettings();
  const wasCounting =
    activeSession.hostname &&
    activeSession.windowFocused &&
    !activeSession.idle &&
    !settings.ignoredSites.includes(activeSession.hostname);

  if (wasCounting) {
    const rawElapsedSec = Math.max(0, Math.round((now - activeSession.startedAt) / 1000));
    const elapsedSec = Math.min(rawElapsedSec, MAX_FLUSH_SECONDS);
    if (elapsedSec > 0) {
      const dateKey = todayKey();
      const day = await getDayState(dateKey);
      day.tracking.sites[activeSession.hostname] = (day.tracking.sites[activeSession.hostname] || 0) + elapsedSec;
      day.tracking.total += elapsedSec;

      const { siteJustExceeded, globalJustExceeded } = evaluateLimits(day, settings);
      siteJustExceeded.forEach((h) => (day.blocked.sites[h] = true));
      if (globalJustExceeded) day.blocked.global = true;

      // Checked after the block mutations above, so a span that jumps straight past
      // 100% in one flush is recorded as blocked, not warned.
      const { siteJustWarned, globalJustWarned } = evaluateWarnings(day, settings);
      siteJustWarned.forEach((h) => (day.warned.sites[h] = true));
      if (globalJustWarned) day.warned.global = true;

      // Also checked after the block mutations: once a grace period's window has
      // fully elapsed the scope is already blocked above, so there's nothing left
      // to "start" grace on.
      const { siteJustGraced, globalJustGraced } = evaluateGraceStarted(day, settings);
      siteJustGraced.forEach((h) => (day.grace.sites[h] = true));
      if (globalJustGraced) day.grace.global = true;

      await saveDayState(dateKey, day);

      if (siteJustExceeded.length || globalJustExceeded) {
        notifyLimitReached(siteJustExceeded, globalJustExceeded);
        await maybeKickActiveTab(day, settings);
      }
      if (siteJustWarned.length || globalJustWarned) {
        notifyApproachingLimit(siteJustWarned, globalJustWarned, settings);
      }
      if (siteJustGraced.length || globalJustGraced) {
        notifyGraceStarted(siteJustGraced, globalJustGraced, settings);
      }
    }
  }

  activeSession.startedAt = now;
  await saveActiveSession(activeSession);
}

async function maybeKickActiveTab(day, settings) {
  if (!activeSession.hostname || activeSession.tabId == null) return;
  const result = isBlocked(activeSession.hostname, day, settings);
  if (!result.blocked) return;

  try {
    const tab = await chrome.tabs.get(activeSession.tabId);
    const blockedUrl =
      chrome.runtime.getURL("blocked/blocked.html") +
      `?site=${encodeURIComponent(activeSession.hostname)}` +
      `&reason=${encodeURIComponent(result.reason)}` +
      `&period=${encodeURIComponent(result.period || "day")}` +
      `&from=${encodeURIComponent(tab.url)}`;
    await chrome.tabs.update(activeSession.tabId, { url: blockedUrl });
  } catch {
    // Tab may no longer exist; nothing to do.
  }
}

// Daily limits already get a configurable, accumulated-seconds grace window
// before they block (see evaluateGraceStarted). A schedule window closing or
// a rolling week/month cap tripping has no such window to extend - the
// instant they're detected, they're already true - so without this, the
// heartbeat's catch-all kick would cut an already-open tab with zero warning
// (destroying in-progress typed input). This gives those two kinds of block
// exactly one heartbeat tick (~1 minute) of warning first: the first tick a
// scope is found blocked, it's only recorded as "about to block" and a
// notification fires; only if it's *still* blocked on the next tick does the
// tab actually get redirected. Returns true if `day.pendingKick` changed and
// needs saving.
async function maybeWarnOrKick(day, settings) {
  if (!activeSession.hostname || activeSession.tabId == null) return false;
  const result = isBlocked(activeSession.hostname, day, settings);

  if (!result.blocked) {
    if (day.pendingKick.sites[activeSession.hostname]) {
      delete day.pendingKick.sites[activeSession.hostname];
      return true;
    }
    if (day.pendingKick.global) {
      day.pendingKick.global = null;
      return true;
    }
    return false;
  }

  if (result.period === "day") {
    await maybeKickActiveTab(day, settings);
    return false;
  }

  const pendingTag = `${result.reason}:${result.period}`;
  const alreadyWarned =
    result.reason === "global"
      ? day.pendingKick.global === pendingTag
      : day.pendingKick.sites[activeSession.hostname] === pendingTag;

  if (alreadyWarned) {
    await maybeKickActiveTab(day, settings);
    return false;
  }

  if (result.reason === "global") {
    day.pendingKick.global = pendingTag;
  } else {
    day.pendingKick.sites[activeSession.hostname] = pendingTag;
  }
  notifyAboutToBlock(activeSession.hostname, result);
  return true;
}

function notifyAboutToBlock(hostname, result) {
  const periodLabel = { week: "weekly", month: "monthly", schedule: "scheduled-access" }[result.period] || result.period;
  const message =
    result.reason === "global"
      ? `You're about to hit your ${periodLabel} browsing limit - this tab will block in about a minute.`
      : `${hostname} is about to block (${periodLabel}) - this tab will redirect in about a minute.`;
  chrome.notifications.create(`about-to-block-${result.reason}-${hostname || "global"}-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon.png"),
    title: "About to block",
    message,
  });
}

function notifyLimitReached(siteJustExceeded, globalJustExceeded) {
  if (siteJustExceeded.length) {
    for (const hostname of siteJustExceeded) {
      chrome.notifications.create(`limit-site-${hostname}-${Date.now()}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icon.png"),
        title: "Daily limit reached",
        message: `You've reached your daily time limit for ${hostname}.`,
      });
    }
  }
  if (globalJustExceeded) {
    chrome.notifications.create(`limit-global-${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon.png"),
      title: "Daily limit reached",
      message: "You've reached your overall daily browsing time limit.",
    });
  }
}

function notifyApproachingLimit(siteJustWarned, globalJustWarned, settings) {
  for (const hostname of siteJustWarned) {
    const limitMinutes = settings.siteLimits[hostname];
    chrome.notifications.create(`warn-site-${hostname}-${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon.png"),
      title: "Approaching daily limit",
      message: `You're close to your ${limitMinutes}-minute daily limit for ${hostname}.`,
    });
  }
  if (globalJustWarned) {
    chrome.notifications.create(`warn-global-${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon.png"),
      title: "Approaching daily limit",
      message: `You're close to your ${settings.globalDailyLimitMinutes}-minute overall daily browsing limit.`,
    });
  }
}

function notifyGraceStarted(siteJustGraced, globalJustGraced, settings) {
  for (const hostname of siteJustGraced) {
    chrome.notifications.create(`grace-site-${hostname}-${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon.png"),
      title: "Daily limit reached",
      message: `${hostname} will block in ${settings.graceMinutes} more minute${settings.graceMinutes === 1 ? "" : "s"}.`,
    });
  }
  if (globalJustGraced) {
    chrome.notifications.create(`grace-global-${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon.png"),
      title: "Daily limit reached",
      message: `Browsing will block in ${settings.graceMinutes} more minute${settings.graceMinutes === 1 ? "" : "s"}.`,
    });
  }
}

function notifyRollingBlocks(newlyBlocked) {
  for (const item of newlyBlocked) {
    const periodLabel = item.period === "week" ? "weekly" : "monthly";
    if (item.scope === "site") {
      chrome.notifications.create(`limit-${item.period}-${item.hostname}-${Date.now()}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icon.png"),
        title: "Limit reached",
        message: `You've reached your ${periodLabel} time limit for ${item.hostname}.`,
      });
    } else {
      chrome.notifications.create(`limit-${item.period}-global-${Date.now()}`, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icon.png"),
        title: "Limit reached",
        message: `You've reached your overall ${periodLabel} browsing time limit.`,
      });
    }
  }
}

// Weekly/monthly caps need several days of storage summed together, so unlike
// the daily checks in flush() this only runs once a minute from the heartbeat
// alarm rather than on every tab/focus/idle event - plenty tight for a cap
// measured in hours, and far cheaper than re-summing a 30-day window on every
// tab switch.
// Returns the day state the caller should use for any further checks this
// tick (so it doesn't need its own extra getDayState() call), or null if
// there was nothing configured to evaluate at all.
async function evaluateRollingCaps(settings) {
  const hasAnyRollingLimit = ROLLING_PERIODS.some(
    (period) => Object.keys(settings[period.siteSetting]).length > 0 || settings[period.globalSetting]
  );
  if (!hasAnyRollingLimit) return null;

  const dateKey = todayKey();
  const snapshot = await getDayState(dateKey);
  const newlyBlocked = [];
  let changed = false;

  for (const period of ROLLING_PERIODS) {
    changed = (await applyRollingPeriod(period, settings, snapshot, newlyBlocked)) || changed;
  }

  if (!changed) return snapshot;

  // This scan can take ~2 batched storage reads worth of wall-clock time
  // (one per rolling period) - long enough for a concurrent flush() to have
  // written fresh tracking/warned/grace data in the meantime. Re-read right
  // before saving and only layer this scan's *new* blocked flags on top of
  // whatever's there now, rather than overwriting the whole day with the
  // stale snapshot taken before the scan started.
  const fresh = await getDayState(dateKey);
  for (const [hostname, periodTag] of Object.entries(snapshot.blocked.sites)) {
    if (!fresh.blocked.sites[hostname]) fresh.blocked.sites[hostname] = periodTag;
  }
  if (snapshot.blocked.global && !fresh.blocked.global) fresh.blocked.global = snapshot.blocked.global;

  await saveDayState(dateKey, fresh);
  notifyRollingBlocks(newlyBlocked);
  return fresh;
}

async function applyRollingPeriod(period, settings, day, newlyBlocked) {
  const siteLimitsForPeriod = settings[period.siteSetting];
  const globalLimitForPeriod = settings[period.globalSetting];
  if (!Object.keys(siteLimitsForPeriod).length && !globalLimitForPeriod) return false;

  const recent = await getRecentDayStates(period.days);
  let changed = false;

  for (const [hostname, minutes] of Object.entries(siteLimitsForPeriod)) {
    if (day.blocked.sites[hostname]) continue; // already blocked for some reason today
    const totalSeconds = recent.reduce((sum, { state }) => sum + (state.tracking.sites[hostname] || 0), 0);
    if (exceedsRollingLimit(totalSeconds, minutes)) {
      day.blocked.sites[hostname] = period.key;
      newlyBlocked.push({ scope: "site", hostname, period: period.key });
      changed = true;
    }
  }

  if (globalLimitForPeriod && !day.blocked.global) {
    const totalSeconds = recent.reduce((sum, { state }) => sum + state.tracking.total, 0);
    if (exceedsRollingLimit(totalSeconds, globalLimitForPeriod)) {
      day.blocked.global = period.key;
      newlyBlocked.push({ scope: "global", period: period.key });
      changed = true;
    }
  }

  return changed;
}

async function handleTabActivated({ tabId, windowId }) {
  await flush();
  try {
    const tab = await chrome.tabs.get(tabId);
    const settings = await getSettings();
    const win = await chrome.windows.get(windowId);
    const allowIncognito = tab.incognito ? !settings.ignoreInIncognito : true;
    activeSession.hostname = allowIncognito ? hostnameFromUrl(tab.url) : null;
    activeSession.tabId = tabId;
    activeSession.windowId = windowId;
    activeSession.windowFocused = win.focused;
  } catch {
    activeSession.hostname = null;
    activeSession.tabId = null;
  }
  await saveActiveSession(activeSession);
}

async function handleTabUpdated(tabId, changeInfo, tab) {
  await loadActiveSession();
  if (tabId !== activeSession.tabId) return;
  if (!changeInfo.url) return;
  await flush();
  const settings = await getSettings();
  const allowIncognito = tab.incognito ? !settings.ignoreInIncognito : true;
  activeSession.hostname = allowIncognito ? hostnameFromUrl(changeInfo.url) : null;
  await saveActiveSession(activeSession);
}

async function handleTabRemoved(tabId) {
  await loadActiveSession();
  if (tabId !== activeSession.tabId) return;
  await flush();
  activeSession.hostname = null;
  activeSession.tabId = null;
  await saveActiveSession(activeSession);
}

async function handleWindowFocusChanged(windowId) {
  await flush();
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    activeSession.windowFocused = false;
    activeSession.hostname = null;
    activeSession.tabId = null;
    await saveActiveSession(activeSession);
    return;
  }
  try {
    const win = await chrome.windows.get(windowId);
    activeSession.windowFocused = win.focused;
    if (win.focused) {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (tab) {
        const settings = await getSettings();
        const allowIncognito = tab.incognito ? !settings.ignoreInIncognito : true;
        activeSession.hostname = allowIncognito ? hostnameFromUrl(tab.url) : null;
        activeSession.tabId = tab.id;
        activeSession.windowId = windowId;
      }
    } else {
      activeSession.hostname = null;
      activeSession.tabId = null;
    }
  } catch {
    activeSession.windowFocused = false;
  }
  await saveActiveSession(activeSession);
}

async function handleIdleStateChanged(state) {
  await flush();
  activeSession.idle = state !== "active";
  await saveActiveSession(activeSession);
}

async function handleAlarm(alarm) {
  if (alarm.name !== "heartbeat") return;
  await flush();
  await pruneOldDayKeys();

  const settings = await getSettings();
  // evaluateRollingCaps already has to read the latest day state to decide
  // whether anything newly tripped; reuse its result instead of fetching it
  // a third time this tick (flush() and this are the other two reads).
  const day = (await evaluateRollingCaps(settings)) || (await getDayState());

  // Catch-all: covers cases flush()'s immediate check doesn't, like a
  // schedule window ending or a rolling cap just evaluated above, for
  // whatever tab happens to be open right now. Daily blocks still kick
  // immediately; schedule/rolling blocks get one tick of warning first (see
  // maybeWarnOrKick).
  const pendingKickChanged = await maybeWarnOrKick(day, settings);
  if (pendingKickChanged) await saveDayState(todayKey(), day);
}

function handleMessage(message, sender, sendResponse) {
  (async () => {
    if (message?.type === "checkBlocked") {
      await flush();
      const settings = await getSettings();
      const day = await getDayState();
      sendResponse(isBlocked(message.hostname, day, settings));
      return;
    }

    if (message?.type === "completeChallenge") {
      const dateKey = todayKey();
      const day = await getDayState(dateKey);
      const period = message.period || "day";
      if (message.reason === "global") {
        day.unlocked.global = [...new Set([...(day.unlocked.global || []), period])];
      } else {
        const existing = day.unlocked.sites[message.hostname] || [];
        day.unlocked.sites[message.hostname] = [...new Set([...existing, period])];
      }
      await saveDayState(dateKey, day);
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ error: "unknown message type" });
  })();

  return true;
}
