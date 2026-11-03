export const PHRASES = {
  easy: [
    "the quick fox jumps",
    "stay focused today",
    "small steps matter",
    "breathe and refocus",
    "progress over perfection",
  ],
  medium: [
    "discipline is choosing what you want most over what you want now",
    "a journey of a thousand miles begins with a single step",
    "consistency beats intensity in the long run",
    "the best time to start was yesterday, the next best time is now",
  ],
  hard: [
    "Success is the sum of small efforts repeated day in and day out, 24/7.",
    '"Patience", she said, "is a virtue worth cultivating slowly."',
    "Of the 100 habits worth building, discipline tops the list - no exceptions!",
    "Great things are done by a series of small things brought together (quote, 1887).",
  ],
};

export function getRandomPhrase(difficulty) {
  const pool = PHRASES[difficulty] || PHRASES.medium;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function phraseMatches(input, phrase) {
  if (typeof input !== "string") return false;
  return input.trim().toLowerCase() === phrase.trim().toLowerCase();
}
