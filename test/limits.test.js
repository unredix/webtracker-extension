import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlocked, evaluateLimits, evaluateWarnings, WARNING_THRESHOLD_RATIO } from "../lib/limits.js";

function emptyDay() {
  return {
    tracking: { total: 0, sites: {} },
    blocked: { sites: {}, global: false },
    unlocked: { sites: {}, global: false },
    warned: { sites: {}, global: false },
  };
}

function baseSettings(overrides = {}) {
  return {
    ignoredSites: [],
    ignoreInIncognito: false,
    siteLimits: {},
    globalDailyLimitMinutes: null,
    ...overrides,
  };
}

test("isBlocked: ignored site is never blocked", () => {
  const day = emptyDay();
  day.blocked.sites["example.com"] = true;
  const settings = baseSettings({ ignoredSites: ["example.com"] });
  assert.deepEqual(isBlocked("example.com", day, settings), { blocked: false, reason: null });
});

test("isBlocked: blocked site reports reason 'site'", () => {
  const day = emptyDay();
  day.blocked.sites["example.com"] = true;
  assert.deepEqual(isBlocked("example.com", day, baseSettings()), { blocked: true, reason: "site" });
});

test("isBlocked: unlocked site overrides blocked", () => {
  const day = emptyDay();
  day.blocked.sites["example.com"] = true;
  day.unlocked.sites["example.com"] = true;
  assert.deepEqual(isBlocked("example.com", day, baseSettings()), { blocked: false, reason: null });
});

test("isBlocked: global block applies to any non-ignored site", () => {
  const day = emptyDay();
  day.blocked.global = true;
  assert.deepEqual(isBlocked("anything.com", day, baseSettings()), { blocked: true, reason: "global" });
});

test("isBlocked: site block takes priority over global in the reported reason", () => {
  const day = emptyDay();
  day.blocked.sites["example.com"] = true;
  day.blocked.global = true;
  assert.deepEqual(isBlocked("example.com", day, baseSettings()), { blocked: true, reason: "site" });
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
