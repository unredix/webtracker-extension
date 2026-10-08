export const REQUIRED_CORRECT = 5;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateProblem() {
  const operators = ["+", "-", "×", "÷"];
  const operator = operators[Math.floor(Math.random() * operators.length)];

  let a;
  let b;
  let answer;

  if (operator === "×") {
    a = randomInt(3, 15);
    b = randomInt(3, 15);
    answer = a * b;
  } else if (operator === "÷") {
    b = randomInt(2, 12);
    answer = randomInt(2, 12);
    a = b * answer;
  } else {
    a = randomInt(10, 60);
    b = randomInt(10, 60);
    if (operator === "-" && b > a) {
      [a, b] = [b, a];
    }
    answer = operator === "+" ? a + b : a - b;
  }

  return { prompt: `${a} ${operator} ${b}`, answer };
}
