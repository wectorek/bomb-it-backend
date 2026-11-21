import {
  boardAnchor,
  colorName,
  createActor,
  moveIntervalFor,
  pickSpawnPositions,
  PLAYER_START,
} from "./actors.js";
import { createMapBorder } from "./border.js";
import { BOARD_SIZE, SEAT_COLORS, SEAT_COUNT } from "./config.js";
import { generateMaze } from "./maze.js";
import { createRandom } from "./rng.js";
import {
  COUNTDOWN_MS,
  effectiveMode,
  hillCells,
  teamForSeatIndex,
} from "./modes.js";
import { normalizeSettings } from "./settings.js";

export function createMatch({
  zone = false,
  humans,
  fillBots = false,
  botCount = null,
  settings: rawSettings = null,
  seed = 1,
  now = 0,
} = {}) {
  if (!Array.isArray(humans) || humans.length === 0) {
    throw new Error("createMatch wymaga co najmniej jednego gracza");
  }

  const settings = normalizeSettings({ ...rawSettings, zone: zone || rawSettings?.zone });
  const box = { state: seed | 0 };
  const random = createRandom(box);
  const roster = humans.map((human) => ({
    id: human.id,
    kind: human.kind === "bot" ? "bot" : "player",
    name: human.name ?? null,
    color: human.color ?? null,
  }));

  if (fillBots) {
    let number = 1;
    const target = Number.isInteger(botCount)
      ? Math.min(SEAT_COUNT, roster.length + Math.max(0, botCount))
      : SEAT_COUNT;
    while (roster.length < target) {
      while (roster.some((seat) => seat.id === `bot-${number}`)) {
        number += 1;
      }
      roster.push({
        id: `bot-${number}`,
        kind: "bot",
        name: null,
        color: null,
      });
      number += 1;
    }
  }

  const seats = roster.slice(0, SEAT_COUNT);
  const usedColors = new Set(seats.map((seat) => seat.color).filter(Boolean));
  for (const seat of seats) {
    if (!seat.color) {
      seat.color =
        SEAT_COLORS.find((color) => !usedColors.has(color)) ?? SEAT_COLORS[0];
      usedColors.add(seat.color);
    }
    if (!seat.name) {
      seat.name = seat.kind === "bot" ? colorName(seat.color) : "Ty";
    }
  }

  const borders = createMapBorder(BOARD_SIZE);
  const walls = generateMaze(
    BOARD_SIZE,
    boardAnchor(),
    random,
    1,
    settings.wallDensity,
  );
  const positions = pickSpawnPositions(walls, borders, seats.length, PLAYER_START);
  const actors = seats.map((seat, index) => {
    const actor = createActor({
      id: seat.id,
      kind: seat.kind,
      color: seat.color,
      name: seat.name,
      position: positions[index] ?? null,
      facing: "down",
      nextMoveAt: 0,
    });
    actor.score = 0;
    return actor;
  });

  const countdownUntil = now > 0 ? now + COUNTDOWN_MS : null;
  for (const actor of actors) {
    if (countdownUntil != null) {
      actor.nextMoveAt = countdownUntil;
      continue;
    }
    actor.nextMoveAt =
      actor.kind === "bot"
        ? now + moveIntervalFor(actor, now, settings)
        : now;
  }

  const modeEffective = effectiveMode(settings.mode, actors.length);
  if (modeEffective === "teams") {
    for (let index = 0; index < actors.length; index += 1) {
      actors[index].team = teamForSeatIndex(index);
    }
  }

  const finaleAfterSec = settings.finaleAfterSec ?? 0;
  const finaleStartsAt =
    finaleAfterSec > 0
      ? (countdownUntil ?? now) + finaleAfterSec * 1000
      : null;

  return {
    status: "playing",
    outcomes: {},
    startedAt: now,
    countdownUntil,
    modeEffective,
    modeRequested: settings.mode ?? "classic",
    finaleStartsAt,
    hillCells: modeEffective === "hill" ? hillCells(BOARD_SIZE) : null,
    hillTickSince: {},
    rng: box.state,
    nextId: 1,
    settings,
    finale: null,
    startActors: actors.length,
    zone: zone || settings.zone ? { startedAt: now } : null,
    zoneSince: {},
    drops: [],
    mess: [],
    borders,
    walls,
    actors,
    bonuses: [],
    bombs: [],
    explosions: [],
    hedges: [],
    toasts: [],
  };
}
