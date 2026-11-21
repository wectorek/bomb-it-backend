import { BOARD_SIZE, ZONE_CELL_MS } from "./config.js";
import { judge } from "./status.js";
import { isOutsideSafe } from "./zone.js";

const COUNTDOWN_MS = 3000;
const BOMB_PREVIEW_MS = 700;

export { COUNTDOWN_MS, BOMB_PREVIEW_MS };

export function effectiveMode(mode, actorCount) {
  if (mode === "teams" && actorCount >= 4) {
    return "teams";
  }
  if (mode === "hill") {
    return mode;
  }
  if (mode === "teams") {
    return "classic";
  }
  return "classic";
}

export function teamForSeatIndex(index) {
  return index % 2 === 0 ? 0 : 1;
}

export function hillCells(boardSize = BOARD_SIZE) {
  const center = Math.floor((boardSize - 1) / 2);
  const cells = [{ row: center, col: center }];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) {
        continue;
      }
      const row = center + dr;
      const col = center + dc;
      if (row >= 1 && col >= 1 && row < boardSize - 1 && col < boardSize - 1) {
        cells.push({ row, col });
      }
    }
  }
  return cells;
}

function onHill(position, cells) {
  if (!position) {
    return false;
  }
  return cells.some(
    (cell) => cell.row === position.row && cell.col === position.col,
  );
}

function highestScoreWinners(actors) {
  const scores = actors.map((actor) => actor.score ?? 0);
  const best = Math.max(...scores);
  return actors.filter((actor) => (actor.score ?? 0) === best);
}

function outcomesFromWinners(actors, winnerIds) {
  const winners = new Set(winnerIds);
  const outcomes = {};
  for (const actor of actors) {
    if (winners.has(actor.id)) {
      outcomes[actor.id] = winners.size > 1 ? "draw" : "win";
    } else {
      outcomes[actor.id] = "lose";
    }
  }
  return outcomes;
}

function judgeTeams(actors) {
  const alive = actors.filter((actor) => actor.alive);
  if (alive.length >= 2) {
    const teamsAlive = new Set(alive.map((actor) => actor.team));
    if (teamsAlive.size >= 2) {
      return { status: "playing", outcomes: {} };
    }
  }
  const teamAlive = new Map();
  for (const actor of actors) {
    const team = actor.team ?? 0;
    if (!teamAlive.has(team)) {
      teamAlive.set(team, []);
    }
    teamAlive.get(team).push(actor);
  }
  const survivingTeams = [...teamAlive.entries()].filter(([, group]) =>
    group.some((actor) => actor.alive),
  );
  if (survivingTeams.length !== 1) {
    return { status: "playing", outcomes: {} };
  }
  const [winTeam] = survivingTeams[0];
  const winnerIds = actors
    .filter((actor) => actor.team === winTeam)
    .map((actor) => actor.id);
  return {
    status: "ended",
    outcomes: outcomesFromWinners(actors, winnerIds),
    winningTeam: winTeam,
  };
}

function judgeByScore(actors, threshold) {
  const reached = actors.filter((actor) => (actor.score ?? 0) >= threshold);
  if (reached.length > 0) {
    const winners = highestScoreWinners(reached);
    return {
      status: "ended",
      outcomes: outcomesFromWinners(
        actors,
        winners.map((actor) => actor.id),
      ),
    };
  }
  const alive = actors.filter((actor) => actor.alive);
  if (alive.length === 1) {
    return {
      status: "ended",
      outcomes: outcomesFromWinners(actors, [alive[0].id]),
    };
  }
  if (alive.length === 0) {
    const winners = highestScoreWinners(actors);
    return {
      status: "ended",
      outcomes: outcomesFromWinners(
        actors,
        winners.map((actor) => actor.id),
      ),
    };
  }
  return { status: "playing", outcomes: {} };
}

export function judgeMatch(state, now) {
  const mode = state.modeEffective ?? "classic";
  if (mode === "classic") {
    return judge(state.actors);
  }
  if (mode === "teams") {
    return judgeTeams(state.actors);
  }
  if (mode === "hill") {
    return judgeByScore(state.actors, state.settings?.hillPoints ?? 10);
  }
  return judge(state.actors);
}

export function tickHillScoring(state, now) {
  const cells = state.hillCells ?? hillCells();
  const since = { ...(state.hillTickSince ?? {}) };
  let actors = state.actors;
  let changed = false;

  for (const actor of actors) {
    if (!actor.alive || !actor.position || !onHill(actor.position, cells)) {
      if (Object.hasOwn(since, actor.id)) {
        delete since[actor.id];
      }
      continue;
    }
    const last = since[actor.id] ?? state.countdownUntil ?? state.startedAt ?? 0;
    if (now - last < 1000) {
      if (!Object.hasOwn(since, actor.id)) {
        since[actor.id] = last;
      }
      continue;
    }
    since[actor.id] = now;
    changed = true;
    actors = actors.map((item) =>
      item.id === actor.id
        ? { ...item, score: (item.score ?? 0) + 1 }
        : item,
    );
  }

  return changed || Object.keys(since).length !== Object.keys(state.hillTickSince ?? {}).length
    ? { actors, hillTickSince: since }
    : null;
}

export function zoneCellMs(settings) {
  const sec = settings?.zoneCellSec;
  if (typeof sec === "number" && Number.isFinite(sec)) {
    return sec * 1000;
  }
  return ZONE_CELL_MS;
}

export function millisToNextZoneRing(zoneStartedAt, now, settings) {
  if (zoneStartedAt == null) {
    return null;
  }
  const cellMs = zoneCellMs(settings);
  const elapsed = Math.max(0, now - zoneStartedAt);
  const intoCell = elapsed % cellMs;
  return cellMs - intoCell;
}

export function isFrozen(state, now) {
  return (
    state.countdownUntil != null &&
    typeof state.countdownUntil === "number" &&
    now < state.countdownUntil
  );
}

export function isHazardPosition(position, hazards) {
  if (!position) {
    return false;
  }
  return hazards.some(
    (cell) => cell.row === position.row && cell.col === position.col,
  );
}

export function isZoneThreat(position, half, boardSize) {
  if (half == null || !position) {
    return false;
  }
  return isOutsideSafe(position, half, boardSize);
}