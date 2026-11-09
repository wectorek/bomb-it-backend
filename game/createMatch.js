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

export function createMatch({
  zone = false,
  humans,
  fillBots = false,
  seed = 1,
  now = 0,
} = {}) {
  if (!Array.isArray(humans) || humans.length === 0) {
    throw new Error("createMatch wymaga co najmniej jednego gracza");
  }

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
    while (roster.length < SEAT_COUNT) {
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
  const walls = generateMaze(BOARD_SIZE, boardAnchor(), random);
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
    if (seat.kind === "bot") {
      actor.nextMoveAt = now + moveIntervalFor(actor, now);
    }
    return actor;
  });

  return {
    status: "playing",
    outcomes: {},
    startedAt: now,
    rng: box.state,
    nextId: 1,
    zone: zone ? { startedAt: now } : null,
    zoneSince: {},
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
