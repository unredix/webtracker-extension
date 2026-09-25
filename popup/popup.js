import { getSettings, getDayState } from "../lib/storage.js";
import { isBlocked } from "../lib/limits.js";
import { formatHMS } from "../lib/time.js";

const statusEl = document.getElementById("status");
const siteEl = document.getElementById("cSite");
const timeEl = document.getElementById("cTime");

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

  if (settings.ignoredSites.includes(currentHostname)) {
    showStatus("This site is on your ignore list — not tracked.");
  } else {
    const result = isBlocked(currentHostname, day, settings);
    if (result.blocked) {
      showStatus("Daily limit reached — complete a challenge to continue.");
    } else {
      hideStatus();
    }
  }

  const elapsedSeconds = day.tracking.sites[currentHostname] || 0;
  const limitMinutes = settings.siteLimits[currentHostname];
  timeEl.textContent = limitMinutes
    ? `${formatHMS(elapsedSeconds)} / ${formatHMS(limitMinutes * 60)}`
    : formatHMS(elapsedSeconds);
}

function showStatus(message) {
  statusEl.textContent = message;
  statusEl.style.display = "block";
}

function hideStatus() {
  statusEl.textContent = "";
  statusEl.style.display = "none";
}
