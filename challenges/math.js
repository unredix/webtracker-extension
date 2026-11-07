export const DIFFICULTIES = ["easy", "medium", "hard"];

const CONFIG = {
  easy: { operators: ["+", "-"], addSubRange: [1, 20], mulRange: [2, 10], requiredCorrect: 3 },
  medium: { operators: ["+", "-", "×"], addSubRange: [10, 40], mulRange: [2, 12], requiredCorrect: 4 },
  hard: {
    operators: ["+", "-", "×", "÷"],
    addSubRange: [10, 60],
    mulRange: [3, 15],
    divRange: [2, 12],
    requiredCorrect: 5,
  },
};

function configFor(difficulty) {
  return CONFIG[difficulty] || CONFIG.medium;
}

export function getRequiredCorrect(difficulty) {
  return configFor(difficulty).requiredCorrect;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateProblem(difficulty) {
  const config = configFor(difficulty);
  const operator = config.operators[Math.floor(Math.random() * config.operators.length)];

  let a;
  let b;
  let answer;

  if (operator === "×") {
    [a, b] = [randomInt(...config.mulRange), randomInt(...config.mulRange)];
    answer = a * b;
  } else if (operator === "÷") {
    const [divMin, divMax] = config.divRange;
    b = randomInt(divMin, divMax);
    answer = randomInt(divMin, divMax);
    a = b * answer;
  } else {
    const [min, max] = config.addSubRange;
    a = randomInt(min, max);
    b = randomInt(min, max);
    if (operator === "-" && b > a) {
      [a, b] = [b, a];
    }
    answer = operator === "+" ? a + b : a - b;
  }

  return { prompt: `${a} ${operator} ${b}`, answer };
}
