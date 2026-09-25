import {
  getSettings,
  getDayState,
  saveDayState,
  todayKey,
  pruneOldDayKeys,
  getActiveSession,
  saveActiveSession,
} from "./lib/storage.js";
import { isBlocked, evaluateLimits } from "./lib/limits.js";

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

async function flush(now = Date.now()) {
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
      if (siteJustExceeded.length || globalJustExceeded) {
        siteJustExceeded.forEach((h) => (day.blocked.sites[h] = true));
        if (globalJustExceeded) day.blocked.global = true;
        await saveDayState(dateKey, day);
        notifyLimitReached(siteJustExceeded, globalJustExceeded);
        await maybeKickActiveTab(day, settings);
      } else {
        await saveDayState(dateKey, day);
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
      `&from=${encodeURIComponent(tab.url)}`;
    await chrome.tabs.update(activeSession.tabId, { url: blockedUrl });
  } catch {
    // Tab may no longer exist; nothing to do.
  }
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
      if (message.reason === "global") {
        day.unlocked.global = true;
      } else {
        day.unlocked.sites[message.hostname] = true;
      }
      await saveDayState(dateKey, day);
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ error: "unknown message type" });
  })();

  return true;
}
