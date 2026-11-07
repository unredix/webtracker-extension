import { getSettings, getDayState, getActiveSession } from "../lib/storage.js";
import { isBlocked, WARNING_THRESHOLD_RATIO } from "../lib/limits.js";
import { formatHMS } from "../lib/time.js";

const statusEl = document.getElementById("status");
const siteEl = document.getElementById("cSite");
const timeEl = document.getElementById("cTime");

const PERIOD_LABEL = { day: "Daily", week: "Weekly", month: "Monthly" };

let currentHostname = null;
let tickInterval = null;

document.addEventListener("DOMContentLoaded", async function () {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.url) return;

  let hostname;
  try {
    hostname = new URL(tab.url).hostname;
  } catch {
    siteEl.textContent = "N/A";
    return;
  }

  currentHostname = hostname;
  siteEl.textContent = hostname.toUpperCase();

  await render();
  tickInterval = setInterval(render, 1000);
});

async function render() {
  if (!currentHostname) return;

  const settings = await getSettings();
  const day = await getDayState();
  const live = await liveEstimateSeconds();

  const storedSeconds = day.tracking.sites[currentHostname] || 0;
  const elapsedSeconds = storedSeconds + live;
  const liveTotalSeconds = day.tracking.total + live;

  const limitMinutes = settings.siteLimits[currentHostname];
  timeEl.textContent = limitMinutes
    ? `${formatHMS(elapsedSeconds)} / ${formatHMS(limitMinutes * 60)}`
    : formatHMS(elapsedSeconds);

  if (settings.ignoredSites.includes(currentHostname)) {
    showStatus("This site is on your ignore list — not tracked.");
    return;
  }

  // Daily site/global limits are checked live, from the exact same
  // elapsedSeconds/liveTotalSeconds numbers the clock above is built from -
  // deliberately not from isBlocked()'s stored `day.blocked` flag, which can
  // lag up to ~60s behind. Mixing the two (stale stored flag for "blocked",
  // fresh local math for "in grace") could make the popup visibly regress
  // from a grace countdown back to a plain warning for a few seconds right
  // as the grace window actually expires, before jumping to "blocked" once
  // the background caught up. Deriving both from one consistent set of live
  // numbers means it can only ever move forward: approaching -> grace ->
  // blocked, never back.
  const graceSeconds = (settings.graceMinutes || 0) * 60;

  if (limitMinutes) {
    const limitSeconds = limitMinutes * 60;
    if (elapsedSeconds >= limitSeconds + graceSeconds) {
      showStatus("Daily limit reached — complete a challenge to continue.");
      return;
    }
    if (graceSeconds > 0 && elapsedSeconds >= limitSeconds) {
      const remaining = Math.ceil((limitSeconds + graceSeconds - elapsedSeconds) / 60);
      showStatus(`Limit reached — this site blocks in ${remaining} more minute${remaining === 1 ? "" : "s"}.`, "grace");
      return;
    }
  }

  if (settings.globalDailyLimitMinutes) {
    const globalLimitSeconds = settings.globalDailyLimitMinutes * 60;
    if (liveTotalSeconds >= globalLimitSeconds + graceSeconds) {
      showStatus("Daily limit reached — complete a challenge to continue.");
      return;
    }
    if (graceSeconds > 0 && liveTotalSeconds >= globalLimitSeconds) {
      const remaining = Math.ceil((globalLimitSeconds + graceSeconds - liveTotalSeconds) / 60);
      showStatus(`Daily limit reached — browsing blocks in ${remaining} more minute${remaining === 1 ? "" : "s"}.`, "grace");
      return;
    }
  }

  // Schedule windows and weekly/monthly caps can't be recomputed live from a
  // single day's data (schedule needs no extra data, but staying consistent
  // with the rest of this function; rolling caps need several days of
  // storage), so these fall back to the background-confirmed state.
  const result = isBlocked(currentHostname, day, settings);
  if (result.blocked) {
    const message =
      result.period === "schedule"
        ? "Outside allowed hours — complete a challenge to continue."
        : `${PERIOD_LABEL[result.period] || "Daily"} limit reached — complete a challenge to continue.`;
    showStatus(message);
    return;
  }

  const siteNearLimit = limitMinutes && elapsedSeconds >= limitMinutes * 60 * WARNING_THRESHOLD_RATIO;
  const globalNearLimit =
    settings.globalDailyLimitMinutes &&
    liveTotalSeconds >= settings.globalDailyLimitMinutes * 60 * WARNING_THRESHOLD_RATIO;

  if (siteNearLimit) {
    showStatus(`Approaching your ${limitMinutes}-minute daily limit for this site.`, "warning");
  } else if (globalNearLimit) {
    showStatus("Approaching your overall daily browsing limit.", "warning");
  } else {
    hideStatus();
  }
}

// The background worker only writes accumulated time to storage on discrete
// events (tab/focus/idle changes, or a once-a-minute heartbeat). Add the
// in-flight seconds since its last write so the popup ticks live instead of
// jumping once a minute. Read-only: nothing is written back from here.
async function liveEstimateSeconds() {
  const session = await getActiveSession();
  if (!session || session.hostname !== currentHostname) return 0;
  if (!session.windowFocused || session.idle) return 0;
  return Math.max(0, (Date.now() - session.startedAt) / 1000);
}

function showStatus(message, variant = "info") {
  statusEl.textContent = message;
  statusEl.style.display = "block";
  statusEl.classList.toggle("status-warning", variant === "warning");
  statusEl.classList.toggle("status-grace", variant === "grace");
}

function hideStatus() {
  statusEl.textContent = "";
  statusEl.style.display = "none";
  statusEl.classList.remove("status-warning", "status-grace");
}
