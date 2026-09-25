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
