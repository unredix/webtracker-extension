import { test } from "node:test";
import assert from "node:assert/strict";
import { generateProblem, getRequiredCorrect, DIFFICULTIES } from "../challenges/math.js";

function evaluate(prompt) {
  const match = prompt.match(/^(\d+) (.) (\d+)$/u);
  const [, aStr, operator, bStr] = match;
  const a = Number(aStr);
  const b = Number(bStr);
  if (operator === "+") return a + b;
  if (operator === "-") return a - b;
  if (operator === "×") return a * b;
  if (operator === "÷") return a / b;
  throw new Error(`unknown operator ${operator}`);
}

test("getRequiredCorrect: increases with difficulty", () => {
  const easy = getRequiredCorrect("easy");
  const medium = getRequiredCorrect("medium");
  const hard = getRequiredCorrect("hard");
  assert.ok(easy < medium && medium < hard, `expected ${easy} < ${medium} < ${hard}`);
});

test("getRequiredCorrect: falls back to medium for an unknown difficulty", () => {
  assert.equal(getRequiredCorrect("nonsense"), getRequiredCorrect("medium"));
});

for (const difficulty of DIFFICULTIES) {
  test(`generateProblem(${difficulty}): the stated answer is always arithmetically correct`, () => {
    for (let i = 0; i < 200; i++) {
      const { prompt, answer } = generateProblem(difficulty);
      assert.equal(evaluate(prompt), answer, `prompt "${prompt}" should evaluate to ${answer}`);
    }
  });

  test(`generateProblem(${difficulty}): subtraction never produces a negative answer`, () => {
    for (let i = 0; i < 200; i++) {
      const { prompt, answer } = generateProblem(difficulty);
      if (prompt.includes(" - ")) assert.ok(answer >= 0, `"${prompt}" = ${answer} should be >= 0`);
    }
  });
}

test("generateProblem(easy): never uses multiplication or division", () => {
  for (let i = 0; i < 100; i++) {
    const { prompt } = generateProblem("easy");
    assert.ok(!prompt.includes("×") && !prompt.includes("÷"), `"${prompt}" should only use + or -`);
  }
});

test("generateProblem(hard): division always divides evenly", () => {
  let sawDivision = false;
  for (let i = 0; i < 500; i++) {
    const { prompt, answer } = generateProblem("hard");
    if (prompt.includes("÷")) {
      sawDivision = true;
      assert.ok(Number.isInteger(answer));
    }
  }
  assert.ok(sawDivision, "expected at least one division problem in 500 tries");
});
