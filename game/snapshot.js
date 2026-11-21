import { moveIntervalFor } from "./actors.js";
import { effectsForView } from "./bonus.js";
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
  if (typeof actor.diedAt === "number") {
    view.diedAt = actor.diedAt;
  }
  return view;
}

export function snapshot(state, { roomId, you, now }) {
  return {
    roomId,
    you,
    status: viewerStatus(state, you),
    startedAt: state.startedAt,
    serverNow: now,
    zone: state.zone
      ? {
          startedAt: state.zone.startedAt,
          radius: safeHalf(Math.max(0, now - state.zone.startedAt)),
        }
      : null,
    actors: state.actors.map((actor) => actorView(actor, now, state.settings)),
    walls: state.walls.map((wall) => ({
      row: wall.row,
      col: wall.col,
      type: wall.type === "bonus" ? "destructible" : wall.type,
    })),
    bonuses: state.bonuses.map((bonus) => ({
      id: bonus.id,
      row: bonus.row,
      col: bonus.col,
    })),
    bombs: state.bombs.map((bomb) => ({
      id: bomb.id,
      row: bomb.row,
      col: bomb.col,
      kind: bomb.kind ?? "bomb",
      airborne: Boolean(bomb.airborne),
      from: bomb.from ? { row: bomb.from.row, col: bomb.from.col } : null,
    })),
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
  };
}
