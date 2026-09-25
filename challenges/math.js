export const REQUIRED_CORRECT = 3;

export function generateProblem() {
  const operators = ["+", "-", "×"];
  const operator = operators[Math.floor(Math.random() * operators.length)];

  let a = Math.floor(Math.random() * 20) + 1;
  let b = Math.floor(Math.random() * 20) + 1;

  if (operator === "×") {
    a = Math.floor(Math.random() * 12) + 1;
    b = Math.floor(Math.random() * 12) + 1;
  }

  if (operator === "-" && b > a) {
    [a, b] = [b, a];
  }

  let answer;
  if (operator === "+") answer = a + b;
  else if (operator === "-") answer = a - b;
  else answer = a * b;

  return { prompt: `${a} ${operator} ${b}`, answer };
}
