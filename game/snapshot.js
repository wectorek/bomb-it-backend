import { moveIntervalFor } from "./actors.js";
import { effectsForView } from "./bonus.js";
import { getExplosionCells } from "./bomb.js";
import { BOMB_PREVIEW_MS, millisToNextZoneRing, zoneCellMs } from "./modes.js";
import { viewerStatus } from "./status.js";
import { safeHalf } from "./zone.js";

function actorView(actor, now, settings) {
  const view = {
    id: actor.id,
    kind: actor.kind,
    color: actor.color,
    name: actor.name,
    position: actor.position
      ? { row: actor.position.row, col: actor.position.col }
      : null,
    facing: actor.facing,
    lives: actor.lives,
    alive: actor.alive,
    moveIntervalMs: moveIntervalFor(actor, now, settings),
    effects: effectsForView(actor, now),
    stats: {
      wallsDestroyed: actor.stats?.wallsDestroyed ?? 0,
      bonusesCollected: {
        positive: actor.stats?.bonusesCollected?.positive ?? 0,
        negative: actor.stats?.bonusesCollected?.negative ?? 0,
      },
      kills: actor.stats?.kills ?? 0,
    },
  };
  if (typeof actor.team === "number") {
    view.team = actor.team;
  }
  if (typeof actor.score === "number") {
    view.score = actor.score;
  }
  if (typeof actor.diedAt === "number") {
    view.diedAt = actor.diedAt;
  }
  return view;
}

function bombView(bomb, state, now) {
  const view = {
    id: bomb.id,
    row: bomb.row,
    col: bomb.col,
    kind: bomb.kind ?? "bomb",
    airborne: Boolean(bomb.airborne),
    from: bomb.from ? { row: bomb.from.row, col: bomb.from.col } : null,
  };
  if (
    !bomb.airborne &&
    typeof bomb.explodeAt === "number" &&
    bomb.explodeAt - now < BOMB_PREVIEW_MS &&
    bomb.explodeAt > now
  ) {
    const shape = state.finale ? "square" : "cross";
    view.previewCells = getExplosionCells(
      bomb,
      state.walls,
      state.borders,
      bomb.range,
      shape,
    ).map((cell) => ({ row: cell.row, col: cell.col }));
  }
  return view;
}

export function snapshot(state, { roomId, you, now, roomExtras = null } = {}) {
  const settings = state.settings ?? {};
  const cellMs = zoneCellMs(settings);
  const zoneBody = state.zone
    ? (() => {
        const elapsed = Math.max(0, now - state.zone.startedAt);
        const closingInMs = millisToNextZoneRing(state.zone.startedAt, now, settings);
        const zoneWarn =
          closingInMs != null && closingInMs < 3000 ? true : undefined;
        return {
          startedAt: state.zone.startedAt,
          radius: safeHalf(elapsed, undefined, cellMs),
          closingInMs: zoneWarn ? closingInMs : undefined,
          zoneWarn,
        };
      })()
    : null;

  const base = {
    roomId,
    you,
    status: viewerStatus(state, you),
    startedAt: state.startedAt,
    serverNow: now,
    countdownUntil: state.countdownUntil ?? null,
    modeEffective: state.modeEffective ?? "classic",
    modeRequested: state.modeRequested ?? settings.mode ?? "classic",
    winningTeam: state.winningTeam ?? null,
    finaleStartsAt: state.finaleStartsAt ?? null,
    hillCells: state.hillCells ?? null,
    zone: zoneBody,
    finale: state.finale ? { startedAt: state.finale.startedAt } : null,
    actors: state.actors.map((actor) => actorView(actor, now, settings)),
    walls: state.walls.map((wall) => ({
      row: wall.row,
      col: wall.col,
      type: wall.type === "bonus" ? "destructible" : wall.type,
    })),
    mess: (state.mess ?? []).map((spot) => ({ row: spot.row, col: spot.col })),
    drops: (state.drops ?? []).map((drop) => ({
      id: drop.id,
      row: drop.row,
      col: drop.col,
      at: drop.at,
      landAt: drop.landAt,
    })),
    bonuses: state.bonuses.map((bonus) => ({
      id: bonus.id,
      row: bonus.row,
      col: bonus.col,
    })),
    bombs: state.bombs.map((bomb) => bombView(bomb, state, now)),
    explosions: state.explosions.map((blast) => ({
      id: blast.id,
      cells: blast.cells.map((cell) => ({ row: cell.row, col: cell.col })),
      until: blast.until,
    })),
    toasts: state.toasts.map((toast) => ({
      id: toast.id,
      text: toast.text,
      until: toast.until,
    })),
    chat: roomExtras?.chat ?? [],
    sessionWins: roomExtras?.sessionWins ?? null,
    sessionScores: roomExtras?.sessionScores ?? null,
  };
  return base;
}