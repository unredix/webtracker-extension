const COOLDOWN_SECONDS = { easy: 20, medium: 45, hard: 90 };

export function getCooldownSeconds(difficulty) {
  return COOLDOWN_SECONDS[difficulty] || COOLDOWN_SECONDS.medium;
}
