export const WARNING_THRESHOLD_RATIO = 0.8;

function secondsFromMinutes(minutes) {
  return minutes * 60;
}

export function isBlocked(hostname, day, settings) {
  if (!hostname || settings.ignoredSites.includes(hostname)) {
    return { blocked: false, reason: null };
  }

  const siteBlocked = !!day.blocked.sites[hostname] && !day.unlocked.sites[hostname];
  const globalBlocked = !!day.blocked.global && !day.unlocked.global;

  if (siteBlocked) return { blocked: true, reason: "site" };
  if (globalBlocked) return { blocked: true, reason: "global" };
  return { blocked: false, reason: null };
}

export function evaluateLimits(day, settings) {
  const siteJustExceeded = [];

  for (const [hostname, minutes] of Object.entries(settings.siteLimits)) {
    if (!minutes || minutes <= 0) continue;
    const elapsed = day.tracking.sites[hostname] || 0;
    const alreadyBlocked = !!day.blocked.sites[hostname];
    if (!alreadyBlocked && elapsed >= secondsFromMinutes(minutes)) {
      siteJustExceeded.push(hostname);
    }
  }

  let globalJustExceeded = false;
  if (settings.globalDailyLimitMinutes && settings.globalDailyLimitMinutes > 0) {
    const alreadyBlocked = !!day.blocked.global;
    if (!alreadyBlocked && day.tracking.total >= secondsFromMinutes(settings.globalDailyLimitMinutes)) {
      globalJustExceeded = true;
    }
  }

  return { siteJustExceeded, globalJustExceeded };
}

// Fires once per day, per scope, the first time usage crosses WARNING_THRESHOLD_RATIO
// of its limit but hasn't reached it yet. `day.warned` tracks what's already fired
// so repeated flushes don't re-notify every minute while still under the limit.
export function evaluateWarnings(day, settings) {
  const siteJustWarned = [];

  for (const [hostname, minutes] of Object.entries(settings.siteLimits)) {
    if (!minutes || minutes <= 0) continue;
    const limitSeconds = secondsFromMinutes(minutes);
    const elapsed = day.tracking.sites[hostname] || 0;
    const alreadyWarned = !!day.warned.sites[hostname];
    const alreadyBlocked = !!day.blocked.sites[hostname];
    if (!alreadyWarned && !alreadyBlocked && elapsed >= limitSeconds * WARNING_THRESHOLD_RATIO && elapsed < limitSeconds) {
      siteJustWarned.push(hostname);
    }
  }

  let globalJustWarned = false;
  if (settings.globalDailyLimitMinutes && settings.globalDailyLimitMinutes > 0) {
    const limitSeconds = secondsFromMinutes(settings.globalDailyLimitMinutes);
    const alreadyWarned = !!day.warned.global;
    const alreadyBlocked = !!day.blocked.global;
    if (
      !alreadyWarned &&
      !alreadyBlocked &&
      day.tracking.total >= limitSeconds * WARNING_THRESHOLD_RATIO &&
      day.tracking.total < limitSeconds
    ) {
      globalJustWarned = true;
    }
  }

  return { siteJustWarned, globalJustWarned };
}
