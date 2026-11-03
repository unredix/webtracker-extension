import { test } from "node:test";
import assert from "node:assert/strict";
import { getRandomPhrase, phraseMatches, PHRASES } from "../challenges/typing.js";

test("getRandomPhrase: returns a phrase from the requested difficulty's pool", () => {
  for (const difficulty of Object.keys(PHRASES)) {
    const phrase = getRandomPhrase(difficulty);
    assert.ok(PHRASES[difficulty].includes(phrase));
  }
});

test("getRandomPhrase: falls back to medium for an unknown difficulty", () => {
  const phrase = getRandomPhrase("nonsense");
  assert.ok(PHRASES.medium.includes(phrase));
});

test("phraseMatches: exact match passes", () => {
  assert.equal(phraseMatches("stay focused today", "stay focused today"), true);
});

test("phraseMatches: case-insensitive, trims surrounding whitespace", () => {
  assert.equal(phraseMatches("  Stay Focused Today  ", "stay focused today"), true);
});

test("phraseMatches: punctuation and wording still have to match", () => {
  assert.equal(phraseMatches("stay focused today.", "stay focused today"), false);
  assert.equal(phraseMatches("stay focused", "stay focused today"), false);
});

test("phraseMatches: non-string input never matches", () => {
  assert.equal(phraseMatches(null, "stay focused today"), false);
  assert.equal(phraseMatches(undefined, "stay focused today"), false);
});
