import { BOARD_SIZE, ZONE_CELL_MS, ZONE_DAMAGE_MS } from "./config.js";

function boardCenterIndex(boardSize) {
  return Math.floor((boardSize - 1) / 2);
}

// Na starcie cały kwadrat planszy jest bezpieczny. Co ZONE_CELL_MS odpada jeden pierścień.
export function safeHalf(elapsedMs, boardSize = BOARD_SIZE) {
  const closed = Math.floor(Math.max(0, elapsedMs) / ZONE_CELL_MS);
  return boardCenterIndex(boardSize) - closed;
}

export function isOutsideSafe(position, half, boardSize = BOARD_SIZE) {
  if (!position) {
    return false;
  }
  const center = boardCenterIndex(boardSize);
  const distance = Math.max(
    Math.abs(position.row - center),
    Math.abs(position.col - center),
  );
  return distance > half;
}

// Co pełne 5 sekund w burzy zabiera jedno życie. Wyjście zeruje licznik.
// Jedno wywołanie zadaje co najwyżej jedno obrażenie, tak jak tick 50 ms.
export function applyZoneDamage(actors, half, now, sinceMap = {}) {
  const since = { ...sinceMap };
  let actorsChanged = false;
  const next = actors.map((actor) => {
    if (!actor.alive || !actor.position || !isOutsideSafe(actor.position, half)) {
      if (Object.hasOwn(since, actor.id)) {
        delete since[actor.id];
      }
      return actor;
    }

    if (!Object.hasOwn(since, actor.id)) {
      since[actor.id] = now;
    }
    if (now - since[actor.id] < ZONE_DAMAGE_MS) {
      return actor;
    }

    since[actor.id] = now;
    actorsChanged = true;
    const lives = Math.max(0, actor.lives - 1);
    const alive = lives > 0;
    return {
      ...actor,
      lives,
      alive,
      ...(!alive && actor.diedAt == null ? { diedAt: now } : {}),
    };
  });

  return {
    actors: actorsChanged ? next : actors,
    since,
  };
}
