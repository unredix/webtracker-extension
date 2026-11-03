import { test } from "node:test";
import assert from "node:assert/strict";
import { formatHMS, formatCompact, formatMinutes } from "../lib/time.js";

test("formatHMS: pads to HH:MM:SS", () => {
  assert.equal(formatHMS(0), "00:00:00");
  assert.equal(formatHMS(5), "00:00:05");
  assert.equal(formatHMS(65), "00:01:05");
  assert.equal(formatHMS(3661), "01:01:01");
});

test("formatHMS: clamps negative input to zero", () => {
  assert.equal(formatHMS(-50), "00:00:00");
});

test("formatCompact: drops the unit that's zero", () => {
  assert.equal(formatCompact(0), "0m");
  assert.equal(formatCompact(59), "0m");
  assert.equal(formatCompact(60), "1m");
  assert.equal(formatCompact(3600), "1h");
  assert.equal(formatCompact(3660), "1h 1m");
});

test("formatMinutes: same compacting behavior, input already in minutes", () => {
  assert.equal(formatMinutes(0), "0m");
  assert.equal(formatMinutes(45), "45m");
  assert.equal(formatMinutes(60), "1h");
  assert.equal(formatMinutes(90), "1h 30m");
});

test("formatMinutes: rounds and clamps negative input", () => {
  assert.equal(formatMinutes(-10), "0m");
  assert.equal(formatMinutes(29.6), "30m");
});
