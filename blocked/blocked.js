import { generateProblem, getRequiredCorrect } from "../challenges/math.js";
import { getRandomPhrase, phraseMatches } from "../challenges/typing.js";
import { getCooldownSeconds } from "../challenges/cooldown.js";
import { getSettings } from "../lib/storage.js";

const params = new URLSearchParams(location.search);
const site = params.get("site") || "";
const reason = params.get("reason") || "site";
const period = params.get("period") || "day";
const from = params.get("from") || (site ? `https://${site}/` : "about:blank");

const heading = document.getElementById("heading");
const subheading = document.getElementById("subheading");
const choiceSection = document.getElementById("choice");
const chooseMathButton = document.getElementById("choose-math");
const chooseReadingButton = document.getElementById("choose-reading");
const chooseTypingButton = document.getElementById("choose-typing");
const chooseCooldownButton = document.getElementById("choose-cooldown");

const mathSection = document.getElementById("math-challenge");
const mathProgress = document.getElementById("math-progress");
const mathPrompt = document.getElementById("math-prompt");
const mathAnswer = document.getElementById("math-answer");
const mathSubmit = document.getElementById("math-submit");
const mathFeedback = document.getElementById("math-feedback");

const readingSection = document.getElementById("reading-challenge");
const readingTitle = document.getElementById("reading-title");
const readingText = document.getElementById("reading-text");
const readingQuestions = document.getElementById("reading-questions");
const readingSubmit = document.getElementById("reading-submit");
const readingReroll = document.getElementById("reading-reroll");
const readingFeedback = document.getElementById("reading-feedback");

const typingSection = document.getElementById("typing-challenge");
const typingTarget = document.getElementById("typing-target");
const typingInput = document.getElementById("typing-input");
const typingSubmit = document.getElementById("typing-submit");
const typingReroll = document.getElementById("typing-reroll");
const typingFeedback = document.getElementById("typing-feedback");

const cooldownSection = document.getElementById("cooldown-challenge");
const cooldownTimer = document.getElementById("cooldown-timer");
const cooldownContinue = document.getElementById("cooldown-continue");

const PERIOD_LABEL = { day: "Daily", week: "Weekly", month: "Monthly", schedule: "Scheduled access" };
const periodLabel = PERIOD_LABEL[period] || "Daily";

if (period === "schedule") {
  heading.textContent = `${site} is outside its allowed hours`;
  subheading.textContent = `Complete a quick challenge to unlock ${site} for the rest of today anyway.`;
} else {
  heading.textContent =
    reason === "global" ? `${periodLabel} browsing limit reached` : `${periodLabel} limit reached for ${site}`;
  subheading.textContent =
    reason === "global"
      ? "Complete a quick challenge to keep browsing for the rest of today."
      : `Complete a quick challenge to unlock ${site} for the rest of today.`;
}

let settings = null;
async function ensureSettings() {
  if (!settings) settings = await getSettings();
  return settings;
}

chooseMathButton.addEventListener("click", async () => {
  choiceSection.hidden = true;
  mathSection.hidden = false;
  await startMathChallenge();
});

chooseReadingButton.addEventListener("click", async () => {
  choiceSection.hidden = true;
  readingSection.hidden = false;
  await loadReadingChallenge();
});

chooseTypingButton.addEventListener("click", async () => {
  choiceSection.hidden = true;
  typingSection.hidden = false;
  await startTypingChallenge();
});

chooseCooldownButton.addEventListener("click", async () => {
  choiceSection.hidden = true;
  cooldownSection.hidden = false;
  await startCooldownChallenge();
});

let mathCorrectStreak = 0;
let mathRequiredCorrect = 5;

async function startMathChallenge() {
  const { challengeDifficulty } = await ensureSettings();
  mathRequiredCorrect = getRequiredCorrect(challengeDifficulty);
  mathCorrectStreak = 0;
  nextMathProblem(challengeDifficulty);
}

let currentProblem = null;
let mathDifficulty = "medium";

function nextMathProblem(difficulty) {
  if (difficulty) mathDifficulty = difficulty;
  currentProblem = generateProblem(mathDifficulty);
  mathProgress.textContent = `${mathCorrectStreak} / ${mathRequiredCorrect} correct in a row`;
  mathPrompt.textContent = `${currentProblem.prompt} = ?`;
  mathAnswer.value = "";
  mathFeedback.textContent = "";
  mathAnswer.focus();
}

mathSubmit.addEventListener("click", submitMathAnswer);
mathAnswer.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitMathAnswer();
});

function submitMathAnswer() {
  const value = Number(mathAnswer.value);
  if (Number.isNaN(value)) {
    mathFeedback.textContent = "Enter a number.";
    return;
  }

  if (value === currentProblem.answer) {
    mathCorrectStreak += 1;
    if (mathCorrectStreak >= mathRequiredCorrect) {
      completeChallenge();
      return;
    }
    mathFeedback.textContent = "Correct!";
    nextMathProblem();
  } else {
    mathCorrectStreak = 0;
    mathFeedback.textContent = "Not quite, try again.";
    nextMathProblem();
  }
}

const READING_PASS_RATIO_BY_DIFFICULTY = { easy: 0.5, medium: 0.75, hard: 1 };
let currentPassage = null;
let bundledReadingLibrary = null;

async function loadBundledReadingLibrary() {
  if (bundledReadingLibrary) return bundledReadingLibrary;
  const url = chrome.runtime.getURL("challenges/reading-library.json");
  const response = await fetch(url);
  const data = await response.json();
  bundledReadingLibrary = data.passages;
  return bundledReadingLibrary;
}

// Custom passages are stored with a single question (see options.js); normalized
// to the same { questions: [...] } shape the bundled library uses so the rest
// of this challenge's logic doesn't need to know which library a passage came from.
function normalizeCustomPassage(passage) {
  return { ...passage, questions: [passage.question] };
}

async function loadReadingChallenge() {
  readingFeedback.textContent = "";
  const { customPassages } = await ensureSettings();
  const bundled = await loadBundledReadingLibrary();
  const passages = [...bundled, ...customPassages.map(normalizeCustomPassage)];
  currentPassage = passages[Math.floor(Math.random() * passages.length)];

  readingTitle.textContent = currentPassage.title;
  readingText.textContent = currentPassage.text;
  readingQuestions.innerHTML = "";

  currentPassage.questions.forEach((question, questionIndex) => {
    const wrapper = document.createElement("div");
    wrapper.className = "question";

    const prompt = document.createElement("p");
    prompt.textContent = question.prompt;
    wrapper.appendChild(prompt);

    question.choices.forEach((choice, choiceIndex) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `question-${questionIndex}`;
      input.value = String(choiceIndex);
      label.appendChild(input);
      label.append(` ${choice}`);
      wrapper.appendChild(label);
    });

    readingQuestions.appendChild(wrapper);
  });
}

readingReroll.addEventListener("click", loadReadingChallenge);

readingSubmit.addEventListener("click", async () => {
  const { challengeDifficulty } = await ensureSettings();
  const passRatio = READING_PASS_RATIO_BY_DIFFICULTY[challengeDifficulty] || READING_PASS_RATIO_BY_DIFFICULTY.medium;

  let correctCount = 0;
  currentPassage.questions.forEach((question, questionIndex) => {
    const selected = document.querySelector(`input[name="question-${questionIndex}"]:checked`);
    if (selected && Number(selected.value) === question.correctIndex) correctCount += 1;
  });

  const requiredCorrect = Math.ceil(currentPassage.questions.length * passRatio);
  if (correctCount >= requiredCorrect) {
    completeChallenge();
  } else {
    readingFeedback.textContent = `You got ${correctCount} of ${currentPassage.questions.length} right (need ${requiredCorrect}). Try another passage.`;
  }
});

let currentPhrase = null;

async function startTypingChallenge() {
  const { challengeDifficulty } = await ensureSettings();
  nextTypingPhrase(challengeDifficulty);
}

let typingDifficulty = "medium";

function nextTypingPhrase(difficulty) {
  if (difficulty) typingDifficulty = difficulty;
  currentPhrase = getRandomPhrase(typingDifficulty);
  typingTarget.textContent = currentPhrase;
  typingInput.value = "";
  typingFeedback.textContent = "";
  typingInput.focus();
}

typingReroll.addEventListener("click", () => nextTypingPhrase());
typingSubmit.addEventListener("click", submitTyping);
typingInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitTyping();
});

function submitTyping() {
  if (phraseMatches(typingInput.value, currentPhrase)) {
    completeChallenge();
  } else {
    typingFeedback.textContent = "That doesn't match exactly - try again.";
  }
}

let cooldownIntervalId = null;

async function startCooldownChallenge() {
  const { challengeDifficulty } = await ensureSettings();
  let remaining = getCooldownSeconds(challengeDifficulty);
  cooldownContinue.disabled = true;
  cooldownTimer.textContent = formatCooldown(remaining);

  cooldownIntervalId = setInterval(() => {
    remaining -= 1;
    cooldownTimer.textContent = formatCooldown(Math.max(0, remaining));
    if (remaining <= 0) {
      clearInterval(cooldownIntervalId);
      cooldownContinue.disabled = false;
    }
  }, 1000);
}

function formatCooldown(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

cooldownContinue.addEventListener("click", () => {
  if (cooldownContinue.disabled) return;
  completeChallenge();
});

async function completeChallenge() {
  await chrome.runtime.sendMessage({ type: "completeChallenge", hostname: site, reason });
  location.replace(from);
}
