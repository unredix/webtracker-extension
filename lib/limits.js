export const WARNING_THRESHOLD_RATIO = 0.8;

function secondsFromMinutes(minutes) {
  return minutes * 60;
}

function graceSecondsFromSettings(settings) {
  return secondsFromMinutes(settings.graceMinutes || 0);
}

// Converts an "HH:MM" string to decimal hours (e.g. "18:30" -> 18.5). Returns
// null for anything that doesn't parse, so callers can treat a bad value as
// "no restriction" rather than crash.
export function parseTimeToHours(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours + minutes / 60;
}

export function formatHoursToTime(hours) {
  const h = Math.floor(hours) % 24;
  const m = Math.round((hours - Math.floor(hours)) * 60) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// A site with a configured schedule is only reachable between startHour and
// endHour (both decimal hours, startHour <= endHour - no overnight wraparound,
// kept simple on purpose). Outside that window it reads as blocked, same as
// any other limit, so it goes through the same challenge-to-unlock flow.
export function isOutsideSchedule(hostname, settings, now = new Date()) {
  const schedule = settings.siteSchedules && settings.siteSchedules[hostname];
  if (!schedule) return false;
  const hour = now.getHours() + now.getMinutes() / 60;
  return hour < schedule.startHour || hour >= schedule.endHour;
}

export function isBlocked(hostname, day, settings, now = new Date()) {
  if (!hostname || settings.ignoredSites.includes(hostname)) {
    return { blocked: false, reason: null, period: null };
  }

  const alreadyUnlockedSite = !!day.unlocked.sites[hostname];
  if (isOutsideSchedule(hostname, settings, now) && !alreadyUnlockedSite) {
    return { blocked: true, reason: "site", period: "schedule" };
  }

  const siteMark = day.blocked.sites[hostname];
  const siteBlocked = !!siteMark && !alreadyUnlockedSite;
  const globalMark = day.blocked.global;
  const globalBlocked = !!globalMark && !day.unlocked.global;

  if (siteBlocked) return { blocked: true, reason: "site", period: typeof siteMark === "string" ? siteMark : "day" };
  if (globalBlocked) return { blocked: true, reason: "global", period: typeof globalMark === "string" ? globalMark : "day" };
  return { blocked: false, reason: null, period: null };
}

// Daily limits only - weekly/monthly caps are evaluated separately against a
// rolling window (see background.js's evaluateRollingCaps), since they need
// several days of storage, not just today's. A configured grace period adds
// extra allowed seconds on top of the raw limit before a site actually blocks.
export function evaluateLimits(day, settings) {
  const graceSeconds = graceSecondsFromSettings(settings);
  const siteJustExceeded = [];

  for (const [hostname, minutes] of Object.entries(settings.siteLimits)) {
    if (!minutes || minutes <= 0) continue;
    const elapsed = day.tracking.sites[hostname] || 0;
    const alreadyBlocked = !!day.blocked.sites[hostname];
    if (!alreadyBlocked && elapsed >= secondsFromMinutes(minutes) + graceSeconds) {
      siteJustExceeded.push(hostname);
    }
  }

  let globalJustExceeded = false;
  if (settings.globalDailyLimitMinutes && settings.globalDailyLimitMinutes > 0) {
    const alreadyBlocked = !!day.blocked.global;
    if (!alreadyBlocked && day.tracking.total >= secondsFromMinutes(settings.globalDailyLimitMinutes) + graceSeconds) {
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

// Fires once per day, per scope, the moment usage crosses the *raw* limit
// (before grace is added) while a grace period is configured - lets the
// background worker notify "limit reached, N minutes of grace left" distinct
// from the actual block, which only happens once the grace window also elapses.
export function evaluateGraceStarted(day, settings) {
  const graceSeconds = graceSecondsFromSettings(settings);
  const siteJustGraced = [];

  if (graceSeconds > 0) {
    for (const [hostname, minutes] of Object.entries(settings.siteLimits)) {
      if (!minutes || minutes <= 0) continue;
      const limitSeconds = secondsFromMinutes(minutes);
      const elapsed = day.tracking.sites[hostname] || 0;
      const alreadyGraced = !!day.grace.sites[hostname];
      const alreadyBlocked = !!day.blocked.sites[hostname];
      if (!alreadyGraced && !alreadyBlocked && elapsed >= limitSeconds && elapsed < limitSeconds + graceSeconds) {
        siteJustGraced.push(hostname);
      }
    }
  }

  let globalJustGraced = false;
  if (graceSeconds > 0 && settings.globalDailyLimitMinutes && settings.globalDailyLimitMinutes > 0) {
    const limitSeconds = secondsFromMinutes(settings.globalDailyLimitMinutes);
    const alreadyGraced = !!day.grace.global;
    const alreadyBlocked = !!day.blocked.global;
    if (
      !alreadyGraced &&
      !alreadyBlocked &&
      day.tracking.total >= limitSeconds &&
      day.tracking.total < limitSeconds + graceSeconds
    ) {
      globalJustGraced = true;
    }
  }

  return { siteJustGraced, globalJustGraced };
}

// Pure threshold check reused by background.js's rolling week/month evaluator,
// which has to sum several days of storage first (async) before it has a
// number to compare - kept here so the comparison itself stays testable.
export function exceedsRollingLimit(totalSeconds, limitMinutes) {
  if (!limitMinutes || limitMinutes <= 0) return false;
  return totalSeconds >= secondsFromMinutes(limitMinutes);
}

// "N days in a row with any tracked activity that stayed at or under the
// global daily limit", walking backward from the most recently *complete*
// day (today is excluded - it isn't over yet). A day with zero tracked time
// breaks the streak rather than extending it: it's ambiguous (did they stay
// under the limit, or just not use the browser?) and crediting it either way
// would be easy to game. Returns 0 when no global daily limit is configured,
// since "under your limit" is meaningless without one.
export function computeUnderLimitStreak(recentDayStates, settings) {
  if (!settings.globalDailyLimitMinutes || settings.globalDailyLimitMinutes <= 0) return 0;
  const limitSeconds = secondsFromMinutes(settings.globalDailyLimitMinutes);
  const pastDays = recentDayStates.slice(0, -1); // oldest-first; drop today (last entry)

  let streak = 0;
  for (let i = pastDays.length - 1; i >= 0; i--) {
    const total = pastDays[i].state.tracking.total;
    if (total > 0 && total <= limitSeconds) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}
