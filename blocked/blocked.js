import { generateProblem, REQUIRED_CORRECT } from "../challenges/math.js";

const params = new URLSearchParams(location.search);
const site = params.get("site") || "";
const reason = params.get("reason") || "site";
const from = params.get("from") || (site ? `https://${site}/` : "about:blank");

const heading = document.getElementById("heading");
const subheading = document.getElementById("subheading");
const choiceSection = document.getElementById("choice");
const chooseMathButton = document.getElementById("choose-math");
const chooseReadingButton = document.getElementById("choose-reading");

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

heading.textContent =
  reason === "global" ? "Daily browsing limit reached" : `Daily limit reached for ${site}`;
subheading.textContent =
  reason === "global"
    ? "Complete a quick challenge to keep browsing for the rest of today."
    : `Complete a quick challenge to unlock ${site} for the rest of today.`;

chooseMathButton.addEventListener("click", () => {
  choiceSection.hidden = true;
  mathSection.hidden = false;
  startMathChallenge();
});

chooseReadingButton.addEventListener("click", () => {
  choiceSection.hidden = true;
  readingSection.hidden = false;
  loadReadingChallenge();
});

let mathCorrectStreak = 0;

function startMathChallenge() {
  mathCorrectStreak = 0;
  nextMathProblem();
}

let currentProblem = null;

function nextMathProblem() {
  currentProblem = generateProblem();
  mathProgress.textContent = `${mathCorrectStreak} / ${REQUIRED_CORRECT} correct in a row`;
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
    if (mathCorrectStreak >= REQUIRED_CORRECT) {
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

const REQUIRED_READING_CORRECT = 2;
let currentPassage = null;
let readingLibrary = null;

async function loadReadingLibrary() {
  if (readingLibrary) return readingLibrary;
  const url = chrome.runtime.getURL("challenges/reading-library.json");
  const response = await fetch(url);
  const data = await response.json();
  readingLibrary = data.passages;
  return readingLibrary;
}

async function loadReadingChallenge() {
  readingFeedback.textContent = "";
  const passages = await loadReadingLibrary();
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

readingSubmit.addEventListener("click", () => {
  let correctCount = 0;
  currentPassage.questions.forEach((question, questionIndex) => {
    const selected = document.querySelector(`input[name="question-${questionIndex}"]:checked`);
    if (selected && Number(selected.value) === question.correctIndex) correctCount += 1;
  });

  if (correctCount >= REQUIRED_READING_CORRECT) {
    completeChallenge();
  } else {
    readingFeedback.textContent = `You got ${correctCount} of ${currentPassage.questions.length} right. Try another passage.`;
  }
});

async function completeChallenge() {
  await chrome.runtime.sendMessage({ type: "completeChallenge", hostname: site, reason });
  location.replace(from);
}
