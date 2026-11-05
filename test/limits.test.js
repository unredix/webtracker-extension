import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isBlocked,
  isOutsideSchedule,
  parseTimeToHours,
  formatHoursToTime,
  evaluateLimits,
  evaluateWarnings,
  evaluateGraceStarted,
  exceedsRollingLimit,
  computeUnderLimitStreak,
  WARNING_THRESHOLD_RATIO,
} from "../lib/limits.js";

function emptyDay() {
  return {
    tracking: { total: 0, sites: {} },
    blocked: { sites: {}, global: false },
    unlocked: { sites: {}, global: [] },
    warned: { sites: {}, global: false },
    grace: { sites: {}, global: false },
    pendingKick: { sites: {}, global: null },
  };
}

function baseSettings(overrides = {}) {
  return {
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
    ...overrides,
  };
}

test("isBlocked: ignored site is never blocked", () => {
  const day = emptyDay();
  day.blocked.sites["example.com"] = true;
  const settings = baseSettings({ ignoredSites: ["example.com"] });
  assert.deepEqual(isBlocked("example.com", day, settings), { blocked: false, reason: null, period: null });
});

test("isBlocked: blocked site reports reason 'site', period 'day' for a plain boolean mark", () => {
  const day = emptyDay();
  day.blocked.sites["example.com"] = true;
  assert.deepEqual(isBlocked("example.com", day, baseSettings()), { blocked: true, reason: "site", period: "day" });
});

test("isBlocked: a string block mark surfaces as the period", () => {
  const day = emptyDay();
  day.blocked.sites["example.com"] = "week";
  assert.deepEqual(isBlocked("example.com", day, baseSettings()), { blocked: true, reason: "site", period: "week" });
});

test("isBlocked: unlocking the same period that blocked a site clears it", () => {
  const day = emptyDay();
  day.blocked.sites["example.com"] = true; // legacy boolean mark == period "day"
  day.unlocked.sites["example.com"] = ["day"];
  assert.deepEqual(isBlocked("example.com", day, baseSettings()), { blocked: false, reason: null, period: null });
});

test("isBlocked: unlocking a DIFFERENT period does not clear this one (regression)", () => {
  const day = emptyDay();
  day.blocked.sites["example.com"] = "week";
  day.unlocked.sites["example.com"] = ["day"]; // solved the daily-limit challenge, not the weekly one
  assert.deepEqual(isBlocked("example.com", day, baseSettings()), { blocked: true, reason: "site", period: "week" });
});

test("isBlocked: a daily unlock must not also clear a schedule block on the same site (regression)", () => {
  const day = emptyDay();
  day.blocked.sites["example.com"] = true;
  day.unlocked.sites["example.com"] = ["day"];
  const settings = baseSettings({ siteSchedules: { "example.com": { startHour: 9, endHour: 17 } } });
  const outside = new Date(2026, 0, 1, 20, 0);
  assert.deepEqual(isBlocked("example.com", day, settings, outside), { blocked: true, reason: "site", period: "schedule" });
});

test("isBlocked: global block applies to any non-ignored site", () => {
  const day = emptyDay();
  day.blocked.global = true;
  assert.deepEqual(isBlocked("anything.com", day, baseSettings()), { blocked: true, reason: "global", period: "day" });
});

test("isBlocked: site block takes priority over global in the reported reason", () => {
  const day = emptyDay();
  day.blocked.sites["example.com"] = true;
  day.blocked.global = true;
  assert.deepEqual(isBlocked("example.com", day, baseSettings()), { blocked: true, reason: "site", period: "day" });
});

test("isBlocked: a site outside its schedule blocks even with no limit configured", () => {
  const day = emptyDay();
  const settings = baseSettings({ siteSchedules: { "example.com": { startHour: 9, endHour: 17 } } });
  const outside = new Date(2026, 0, 1, 20, 0); // 8pm, outside 9-17
  assert.deepEqual(isBlocked("example.com", day, settings, outside), { blocked: true, reason: "site", period: "schedule" });
});

test("isBlocked: inside the scheduled window is not blocked", () => {
  const day = emptyDay();
  const settings = baseSettings({ siteSchedules: { "example.com": { startHour: 9, endHour: 17 } } });
  const inside = new Date(2026, 0, 1, 12, 0);
  assert.deepEqual(isBlocked("example.com", day, settings, inside), { blocked: false, reason: null, period: null });
});

test("isBlocked: unlocking the schedule period holds even outside its window", () => {
  const day = emptyDay();
  day.unlocked.sites["example.com"] = ["schedule"];
  const settings = baseSettings({ siteSchedules: { "example.com": { startHour: 9, endHour: 17 } } });
  const outside = new Date(2026, 0, 1, 20, 0);
  assert.deepEqual(isBlocked("example.com", day, settings, outside), { blocked: false, reason: null, period: null });
});

test("isOutsideSchedule: no schedule configured means never outside", () => {
  assert.equal(isOutsideSchedule("example.com", baseSettings()), false);
});

test("isOutsideSchedule: startHour === endHour reads as no restriction, not always-outside", () => {
  const settings = baseSettings({ siteSchedules: { "example.com": { startHour: 9, endHour: 9 } } });
  assert.equal(isOutsideSchedule("example.com", settings, new Date(2026, 0, 1, 3, 0)), false);
});

test("isOutsideSchedule: a reversed startHour > endHour reads as no restriction, not blocked 24/7", () => {
  const settings = baseSettings({ siteSchedules: { "example.com": { startHour: 17, endHour: 9 } } });
  for (const hour of [0, 6, 12, 18, 23]) {
    assert.equal(
      isOutsideSchedule("example.com", settings, new Date(2026, 0, 1, hour, 0)),
      false,
      `hour ${hour} should not be blocked by a reversed schedule`
    );
  }
});

test("isOutsideSchedule: non-numeric schedule fields read as no restriction", () => {
  const settings = baseSettings({ siteSchedules: { "example.com": { startHour: "9", endHour: 17 } } });
  assert.equal(isOutsideSchedule("example.com", settings, new Date(2026, 0, 1, 20, 0)), false);
});

test("parseTimeToHours: parses HH:MM into decimal hours", () => {
  assert.equal(parseTimeToHours("18:30"), 18.5);
  assert.equal(parseTimeToHours("00:00"), 0);
  assert.equal(parseTimeToHours("09:15"), 9.25);
});

test("parseTimeToHours: rejects malformed input", () => {
  assert.equal(parseTimeToHours("25:00"), null);
  assert.equal(parseTimeToHours("12:75"), null);
  assert.equal(parseTimeToHours("not a time"), null);
  assert.equal(parseTimeToHours(null), null);
});

test("formatHoursToTime: round-trips parseTimeToHours", () => {
  assert.equal(formatHoursToTime(18.5), "18:30");
  assert.equal(formatHoursToTime(9.25), "09:15");
  assert.equal(formatHoursToTime(0), "00:00");
});

test("evaluateLimits: flags a site that just crossed its minutes limit", () => {
  const day = emptyDay();
  day.tracking.sites["example.com"] = 1800; // 30 minutes
  const settings = baseSettings({ siteLimits: { "example.com": 30 } });
  const result = evaluateLimits(day, settings);
  assert.deepEqual(result.siteJustExceeded, ["example.com"]);
  assert.equal(result.globalJustExceeded, false);
});

test("evaluateLimits: does not re-flag an already-blocked site", () => {
  const day = emptyDay();
  day.tracking.sites["example.com"] = 1800;
  day.blocked.sites["example.com"] = true;
  const settings = baseSettings({ siteLimits: { "example.com": 30 } });
  assert.deepEqual(evaluateLimits(day, settings).siteJustExceeded, []);
});

test("evaluateLimits: ignores a limit of 0", () => {
  const day = emptyDay();
  day.tracking.sites["example.com"] = 999999;
  const settings = baseSettings({ siteLimits: { "example.com": 0 } });
  assert.deepEqual(evaluateLimits(day, settings).siteJustExceeded, []);
});

test("evaluateLimits: flags the global total crossing the global limit", () => {
  const day = emptyDay();
  day.tracking.total = 7200; // 2 hours
  const settings = baseSettings({ globalDailyLimitMinutes: 120 });
  assert.equal(evaluateLimits(day, settings).globalJustExceeded, true);
});

test("evaluateLimits: does not re-flag an already-blocked global scope", () => {
  const day = emptyDay();
  day.tracking.total = 7200;
  day.blocked.global = true;
  const settings = baseSettings({ globalDailyLimitMinutes: 120 });
  assert.equal(evaluateLimits(day, settings).globalJustExceeded, false);
});

test("evaluateLimits: a grace period delays the actual block past the raw limit", () => {
  const day = emptyDay();
  const settings = baseSettings({ siteLimits: { "example.com": 30 }, graceMinutes: 5 });
  day.tracking.sites["example.com"] = 30 * 60; // right at the raw limit
  assert.deepEqual(evaluateLimits(day, settings).siteJustExceeded, []);
  day.tracking.sites["example.com"] = 35 * 60; // raw limit + grace
  assert.deepEqual(evaluateLimits(day, settings).siteJustExceeded, ["example.com"]);
});

test("evaluateWarnings: flags a site crossing the warning threshold but under the limit", () => {
  const day = emptyDay();
  const limitMinutes = 30;
  const limitSeconds = limitMinutes * 60;
  day.tracking.sites["example.com"] = Math.ceil(limitSeconds * WARNING_THRESHOLD_RATIO);
  const settings = baseSettings({ siteLimits: { "example.com": limitMinutes } });
  assert.deepEqual(evaluateWarnings(day, settings).siteJustWarned, ["example.com"]);
});

test("evaluateWarnings: does not warn once the limit is actually reached", () => {
  const day = emptyDay();
  const limitMinutes = 30;
  day.tracking.sites["example.com"] = limitMinutes * 60; // exactly at the limit
  const settings = baseSettings({ siteLimits: { "example.com": limitMinutes } });
  assert.deepEqual(evaluateWarnings(day, settings).siteJustWarned, []);
});

test("evaluateWarnings: does not re-warn the same scope twice in a day", () => {
  const day = emptyDay();
  const limitMinutes = 30;
  day.tracking.sites["example.com"] = Math.ceil(limitMinutes * 60 * WARNING_THRESHOLD_RATIO);
  day.warned.sites["example.com"] = true;
  const settings = baseSettings({ siteLimits: { "example.com": limitMinutes } });
  assert.deepEqual(evaluateWarnings(day, settings).siteJustWarned, []);
});

test("evaluateWarnings: skips a site that's already blocked", () => {
  const day = emptyDay();
  const limitMinutes = 30;
  day.tracking.sites["example.com"] = Math.ceil(limitMinutes * 60 * WARNING_THRESHOLD_RATIO);
  day.blocked.sites["example.com"] = true;
  const settings = baseSettings({ siteLimits: { "example.com": limitMinutes } });
  assert.deepEqual(evaluateWarnings(day, settings).siteJustWarned, []);
});

test("evaluateWarnings: global warning mirrors the site warning logic", () => {
  const day = emptyDay();
  const limitMinutes = 60;
  day.tracking.total = Math.ceil(limitMinutes * 60 * WARNING_THRESHOLD_RATIO);
  const settings = baseSettings({ globalDailyLimitMinutes: limitMinutes });
  assert.equal(evaluateWarnings(day, settings).globalJustWarned, true);
});

test("evaluateGraceStarted: fires once the raw limit is crossed, before the grace window elapses", () => {
  const day = emptyDay();
  const settings = baseSettings({ siteLimits: { "example.com": 30 }, graceMinutes: 5 });
  day.tracking.sites["example.com"] = 30 * 60 + 60; // 1 minute into the grace window
  assert.deepEqual(evaluateGraceStarted(day, settings).siteJustGraced, ["example.com"]);
});

test("evaluateGraceStarted: never fires when no grace period is configured", () => {
  const day = emptyDay();
  const settings = baseSettings({ siteLimits: { "example.com": 30 }, graceMinutes: 0 });
  day.tracking.sites["example.com"] = 30 * 60 + 60;
  assert.deepEqual(evaluateGraceStarted(day, settings).siteJustGraced, []);
});

test("evaluateGraceStarted: does not re-fire for a scope already in grace", () => {
  const day = emptyDay();
  const settings = baseSettings({ siteLimits: { "example.com": 30 }, graceMinutes: 5 });
  day.tracking.sites["example.com"] = 30 * 60 + 60;
  day.grace.sites["example.com"] = true;
  assert.deepEqual(evaluateGraceStarted(day, settings).siteJustGraced, []);
});

test("evaluateGraceStarted: stops firing once the grace window has fully elapsed (now actually blocked)", () => {
  const day = emptyDay();
  const settings = baseSettings({ siteLimits: { "example.com": 30 }, graceMinutes: 5 });
  day.tracking.sites["example.com"] = 36 * 60; // past raw limit + grace
  assert.deepEqual(evaluateGraceStarted(day, settings).siteJustGraced, []);
});

test("exceedsRollingLimit: compares total seconds against a minutes limit", () => {
  assert.equal(exceedsRollingLimit(1800, 30), true);
  assert.equal(exceedsRollingLimit(1799, 30), false);
});

test("exceedsRollingLimit: a missing or zero limit never exceeds", () => {
  assert.equal(exceedsRollingLimit(999999, 0), false);
  assert.equal(exceedsRollingLimit(999999, null), false);
});

test("computeUnderLimitStreak: returns 0 with no global daily limit configured", () => {
  const days = [{ dateKey: "2026-01-01", state: { tracking: { total: 100 } } }];
  assert.equal(computeUnderLimitStreak(days, baseSettings()), 0);
});

test("computeUnderLimitStreak: counts consecutive complete days at or under the limit", () => {
  const settings = baseSettings({ globalDailyLimitMinutes: 60 });
  const under = 50 * 60;
  const today = { dateKey: "2026-01-04", state: { tracking: { total: 999999 } } }; // excluded regardless
  const days = [
    { dateKey: "2026-01-01", state: { tracking: { total: under } } },
    { dateKey: "2026-01-02", state: { tracking: { total: under } } },
    { dateKey: "2026-01-03", state: { tracking: { total: under } } },
    today,
  ];
  assert.equal(computeUnderLimitStreak(days, settings), 3);
});

test("computeUnderLimitStreak: a day over the limit breaks the streak", () => {
  const settings = baseSettings({ globalDailyLimitMinutes: 60 });
  const under = 50 * 60;
  const over = 70 * 60;
  const days = [
    { dateKey: "2026-01-01", state: { tracking: { total: under } } },
    { dateKey: "2026-01-02", state: { tracking: { total: over } } },
    { dateKey: "2026-01-03", state: { tracking: { total: under } } },
    { dateKey: "2026-01-04", state: { tracking: { total: 0 } } }, // today, excluded
  ];
  assert.equal(computeUnderLimitStreak(days, settings), 1);
});

test("computeUnderLimitStreak: a zero-activity day breaks the streak rather than extending it", () => {
  const settings = baseSettings({ globalDailyLimitMinutes: 60 });
  const under = 50 * 60;
  const days = [
    { dateKey: "2026-01-01", state: { tracking: { total: under } } },
    { dateKey: "2026-01-02", state: { tracking: { total: 0 } } },
    { dateKey: "2026-01-03", state: { tracking: { total: under } } },
    { dateKey: "2026-01-04", state: { tracking: { total: 0 } } }, // today, excluded
  ];
  assert.equal(computeUnderLimitStreak(days, settings), 1);
});
