import { BOARD_SIZE, ZONE_CELL_MS, ZONE_DAMAGE_MS } from "./config.js";

function boardCenter(boardSize) {
  return boardSize / 2;
}

export function initialSafeRadius(boardSize = BOARD_SIZE) {
  const mid = boardCenter(boardSize);
  return Math.hypot(mid - 0.5, mid - 0.5) + 0.35;
}

export function safeRadius(elapsedMs, boardSize = BOARD_SIZE) {
  const shrunk = Math.max(0, elapsedMs) / ZONE_CELL_MS;
  return Math.max(0, initialSafeRadius(boardSize) - shrunk);
}

export function isOutsideSafe(position, radius, boardSize = BOARD_SIZE) {
  if (!position) {
    return false;
  }
  const mid = boardCenter(boardSize);
  const distance = Math.hypot(
    position.row + 0.5 - mid,
    position.col + 0.5 - mid,
  );
  return distance > radius;
}

// Co pełne 5 sekund w burzy zabiera jedno życie. Wyjście zeruje licznik.
// Jedno wywołanie zadaje co najwyżej jedno obrażenie, tak jak tick 50 ms.
export function applyZoneDamage(actors, radius, now, sinceMap = {}) {
  const since = { ...sinceMap };
  let actorsChanged = false;
  const next = actors.map((actor) => {
    if (!actor.alive || !actor.position || !isOutsideSafe(actor.position, radius)) {
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
