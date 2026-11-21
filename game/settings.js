import {
  BONUS_DURATION_MS,
  FREEZE_DURATION_MS,
  HEDGE_REGROW_MS,
  RANGE_BONUS,
  SLOW_MULTIPLIER,
  SPEED_MULTIPLIER,
} from "./config.js";

export const BONUS_IDS = [
  "immunity",
  "speed",
  "range",
  "grenade",
  "slow",
  "fragile",
  "freeze",
];

const DURATION_IDS = ["immunity", "speed", "range", "slow", "fragile", "freeze"];

export const DEFAULT_SETTINGS = Object.freeze({
  zone: false,
  finale: false,
  finaleAfterSec: 0,
  mode: "classic",
  botDifficulty: "normal",
  zoneCellSec: 20,
  hillPoints: 10,
  playerSpeed: 1,
  wallDensity: 1,
  hedgeRegrowSec: HEDGE_REGROW_MS / 1000,
  rangeBonus: RANGE_BONUS,
  speedMultiplier: SPEED_MULTIPLIER,
  slowMultiplier: SLOW_MULTIPLIER,
  durationsSec: Object.freeze({
    immunity: BONUS_DURATION_MS / 1000,
    speed: BONUS_DURATION_MS / 1000,
    range: BONUS_DURATION_MS / 1000,
    slow: BONUS_DURATION_MS / 1000,
    fragile: BONUS_DURATION_MS / 1000,
    freeze: FREEZE_DURATION_MS / 1000,
  }),
  enabledBonuses: Object.freeze(Object.fromEntries(BONUS_IDS.map((id) => [id, true]))),
});

const MODES = new Set(["classic", "teams", "hill"]);
const BOT_LEVELS = new Set(["easy", "normal", "hard"]);

function pickEnum(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

function finaleDelaySec(input, defaults) {
  if (input.finaleAfterSec != null) {
    const seconds = Math.round(num(input.finaleAfterSec, 0, 0, 600));
    if (seconds === 0) {
      return 0;
    }
    return Math.max(30, seconds);
  }
  if (input.finale === true) {
    return defaults.finaleAfterSec > 0 ? defaults.finaleAfterSec : 120;
  }
  return 0;
}

function num(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

export function normalizeSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const d = DEFAULT_SETTINGS;
  const durationsSec = {};
  for (const id of DURATION_IDS) {
    durationsSec[id] = num(input.durationsSec?.[id], d.durationsSec[id], 1, 60);
  }
  const enabledBonuses = {};
  for (const id of BONUS_IDS) {
    enabledBonuses[id] = input.enabledBonuses?.[id] !== false;
  }
  const finaleAfterSec = finaleDelaySec(input, d);
  return {
    zone: input.zone === true,
    finale: finaleAfterSec > 0,
    finaleAfterSec,
    mode: pickEnum(input.mode === "points" ? "classic" : input.mode, MODES, d.mode),
    botDifficulty: pickEnum(input.botDifficulty, BOT_LEVELS, d.botDifficulty),
    zoneCellSec: Math.round(num(input.zoneCellSec, d.zoneCellSec, 5, 60)),
    hillPoints: Math.round(num(input.hillPoints, d.hillPoints, 3, 50)),
    playerSpeed: num(input.playerSpeed, d.playerSpeed, 0.5, 2.5),
    wallDensity: num(input.wallDensity, d.wallDensity, 0.1, 2),
    hedgeRegrowSec: num(input.hedgeRegrowSec, d.hedgeRegrowSec, 1, 60),
    rangeBonus: Math.round(num(input.rangeBonus, d.rangeBonus, 1, 5)),
    speedMultiplier: num(input.speedMultiplier, d.speedMultiplier, 0.3, 0.9),
    slowMultiplier: num(input.slowMultiplier, d.slowMultiplier, 1.2, 3),
    durationsSec,
    enabledBonuses,
  };
}
