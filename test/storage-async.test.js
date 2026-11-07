import { test } from "node:test";
import assert from "node:assert/strict";

function makeArea() {
  const map = new Map();
  return {
    async get(keys) {
      if (keys == null) return Object.fromEntries(map);
      const keyList = typeof keys === "string" ? [keys] : keys;
      const result = {};
      for (const key of keyList) if (map.has(key)) result[key] = map.get(key);
      return result;
    },
    async set(obj) {
      for (const [key, value] of Object.entries(obj)) map.set(key, value);
    },
    async remove(keys) {
      const keyList = typeof keys === "string" ? [keys] : keys;
      for (const key of keyList) map.delete(key);
    },
  };
}

globalThis.chrome = {
  storage: { local: makeArea(), sync: makeArea(), session: makeArea() },
};

const { getDayState, saveDayState, getSettings, setSettings, getRecentDayStates, getKnownCategories, todayKey } =
  await import("../lib/storage.js");

test("getDayState: a never-saved day returns the full empty shape", async () => {
  const day = await getDayState("2026-01-01");
  assert.deepEqual(day, {
    tracking: { total: 0, sites: {} },
    blocked: { sites: {}, global: false },
    unlocked: { sites: {}, global: [] },
    warned: { sites: {}, global: false },
    grace: { sites: {}, global: false },
    pendingKick: { sites: {}, global: null },
  });
});

test("getDayState: merging a saved day still returns every top-level key (regression: grace was dropped)", async () => {
  const dateKey = "2026-02-02";
  const day = await getDayState(dateKey);
  day.blocked.sites["example.com"] = true;
  await saveDayState(dateKey, day);

  const reloaded = await getDayState(dateKey);
  assert.deepEqual(reloaded.blocked, { sites: { "example.com": true }, global: false });
  // Every field getDayState can return must survive a round trip through
  // storage, not just the one that was actually mutated before saving.
  assert.deepEqual(reloaded.grace, { sites: {}, global: false });
  assert.deepEqual(reloaded.warned, { sites: {}, global: false });
  assert.deepEqual(reloaded.unlocked, { sites: {}, global: [] });
  assert.deepEqual(reloaded.tracking, { total: 0, sites: {} });
  assert.deepEqual(reloaded.pendingKick, { sites: {}, global: null });
});

test("concurrent-write pattern: a late merge-before-save must not clobber tracking written mid-scan (regression)", async () => {
  // Mirrors background.js's evaluateRollingCaps: take a snapshot, decide a
  // block is needed, but don't save yet (standing in for the time a real
  // multi-day rolling scan takes).
  const dateKey = "2026-03-03";
  const snapshot = await getDayState(dateKey);
  snapshot.blocked.sites["example.com"] = "week";

  // While that "scan" is in flight, a concurrent flush() writes fresh
  // tracking data and saves it.
  const concurrent = await getDayState(dateKey);
  concurrent.tracking.sites["example.com"] = 999;
  concurrent.tracking.total = 999;
  await saveDayState(dateKey, concurrent);

  // The scan finishes: re-read fresh and layer on only the new blocked flag,
  // instead of saving the stale snapshot wholesale.
  const fresh = await getDayState(dateKey);
  for (const [hostname, periodTag] of Object.entries(snapshot.blocked.sites)) {
    if (!fresh.blocked.sites[hostname]) fresh.blocked.sites[hostname] = periodTag;
  }
  await saveDayState(dateKey, fresh);

  const final = await getDayState(dateKey);
  assert.equal(final.tracking.total, 999, "the concurrent tracking write must survive");
  assert.equal(final.blocked.sites["example.com"], "week", "the scan's own blocked flag must still land");
});

test("getSettings: returns documented defaults when nothing is stored", async () => {
  const settings = await getSettings();
  assert.equal(settings.globalDailyLimitMinutes, null);
  assert.deepEqual(settings.siteLimits, {});
  assert.deepEqual(settings.siteSchedules, {});
  assert.deepEqual(settings.siteCategories, {});
  assert.equal(settings.graceMinutes, 0);
  assert.equal(settings.challengeDifficulty, "medium");
  assert.deepEqual(settings.customPassages, []);
});

test("setSettings + getSettings: round-trips every field", async () => {
  await setSettings({
    siteLimits: { "example.com": 30 },
    graceMinutes: 5,
    siteCategories: { "example.com": "Work" },
    challengeDifficulty: "hard",
    customPassages: [{ id: "1", title: "Custom", text: "Some text.", question: { prompt: "?", choices: ["a", "b"], correctIndex: 0 } }],
  });
  const settings = await getSettings();
  assert.deepEqual(settings.siteLimits, { "example.com": 30 });
  assert.equal(settings.graceMinutes, 5);
  assert.deepEqual(settings.siteCategories, { "example.com": "Work" });
  assert.equal(settings.challengeDifficulty, "hard");
  assert.equal(settings.customPassages.length, 1);
});

test("getSettings: drops a malformed schedule entry instead of letting it reach isOutsideSchedule", async () => {
  await setSettings({
    siteSchedules: {
      "good.com": { startHour: 9, endHour: 17 },
      "reversed.com": { startHour: 17, endHour: 9 },
      "missing.com": { startHour: 9 },
      "stringy.com": { startHour: "9", endHour: "17" },
    },
  });
  const settings = await getSettings();
  assert.deepEqual(settings.siteSchedules, { "good.com": { startHour: 9, endHour: 17 } });
});

test("getSettings: rejects an invalid challengeDifficulty and falls back to medium", async () => {
  await setSettings({ challengeDifficulty: "impossible" });
  const settings = await getSettings();
  assert.equal(settings.challengeDifficulty, "medium");
});

test("getRecentDayStates: oldest first, ending today with no offset", async () => {
  const days = await getRecentDayStates(3);
  assert.equal(days.length, 3);
  assert.equal(days[2].dateKey, todayKey());
});

test("getRecentDayStates: offsetDays shifts the whole window into the past", async () => {
  const thisWeek = await getRecentDayStates(7, 0);
  const lastWeek = await getRecentDayStates(7, 7);
  for (let i = 0; i < 7; i++) {
    const diffDays = Math.round((new Date(thisWeek[i].dateKey) - new Date(lastWeek[i].dateKey)) / 86400000);
    assert.equal(diffDays, 7, `day ${i} of this week should be exactly 7 days after the same index last week`);
  }
});

test("getKnownCategories: distinct, sorted category names from settings", () => {
  const settings = { siteCategories: { a: "Work", b: "Social", c: "Work" } };
  assert.deepEqual(getKnownCategories(settings), ["Social", "Work"]);
});

test("getKnownCategories: empty when no categories are assigned", () => {
  assert.deepEqual(getKnownCategories({ siteCategories: {} }), []);
});
