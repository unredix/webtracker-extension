import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHostname } from "../lib/storage.js";

test("normalizeHostname: accepts a bare hostname, lowercases it", () => {
  assert.equal(normalizeHostname("Example.COM"), "example.com");
});

test("normalizeHostname: strips scheme/path/query from a full URL", () => {
  assert.equal(normalizeHostname("https://Example.com/path?x=1"), "example.com");
});

test("normalizeHostname: accepts subdomains", () => {
  assert.equal(normalizeHostname("sub.example.co.uk"), "sub.example.co.uk");
});

test("normalizeHostname: trims surrounding whitespace", () => {
  assert.equal(normalizeHostname("  example.com  "), "example.com");
});

test("normalizeHostname: rejects empty or whitespace-only input", () => {
  assert.equal(normalizeHostname(""), null);
  assert.equal(normalizeHostname("   "), null);
});

test("normalizeHostname: rejects non-string input", () => {
  assert.equal(normalizeHostname(null), null);
  assert.equal(normalizeHostname(undefined), null);
  assert.equal(normalizeHostname(42), null);
});

test("normalizeHostname: rejects a leading-dash label", () => {
  assert.equal(normalizeHostname("-leading-dash.com"), null);
});

test("normalizeHostname: rejects disallowed characters", () => {
  assert.equal(normalizeHostname("exa_mple.com"), null);
});
