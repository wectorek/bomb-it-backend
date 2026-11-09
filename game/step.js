import {
  aliveActors,
  getActor,
  moveIntervalFor,
  updateActor,
} from "./actors.js";
import {
  bonusToastText,
  collectBonuses,
  expireActorEffects,
  hasEffect,
  pruneBonuses,
  rangeFor,
  spawnBonusesFromWalls,
  survivingBonuses,
} from "./bonus.js";
import { resolveExplosionOutcome, getGrenadeTarget, isBombAt, ownsBomb } from "./bomb.js";
import { nextBotTurn } from "./bot.js";
import {
  BOMB_RANGE,
  BOMB_TIMER_MS,
  EXPLOSION_DURATION_MS,
  GRENADE_FLIGHT_MS,
  GRENADE_TIMER_MS,
  HEDGE_REGROW_MS,
  HEDGE_RETRY_MS,
  TOAST_MS,
} from "./config.js";
import {
  cellAfterStep,
  facingFromDirection,
  isPlayerStepBlocked,
} from "./playerMovement.js";
import { createRandom } from "./rng.js";
import { judge } from "./status.js";
import { applyZoneDamage, safeRadius } from "./zone.js";

function takeId(state) {
  const id = state.nextId;
  state.nextId += 1;
  return id;
}

function cellBlocked(state, row, col) {
  if (
    state.actors.some(
      (actor) =>
        actor.alive && actor.position?.row === row && actor.position?.col === col,
    )
  ) {
    return true;
  }
  if (
    state.bombs.some(
      (bomb) => !bomb.airborne && bomb.row === row && bomb.col === col,
    )
  ) {
    return true;
  }
  return state.walls.some((wall) => wall.row === row && wall.col === col);
}

function plantBomb(state, actor, now) {
  if (!actor.position || ownsBomb(state.bombs, actor.id)) {
    return false;
  }
  if (isBombAt(actor.position, state.bombs)) {
    return false;
  }
  state.bombs.push({
    id: takeId(state),
    row: actor.position.row,
    col: actor.position.col,
    owner: actor.id,
    range: rangeFor(actor, now),
    kind: "bomb",
    airborne: false,
    from: null,
    landAt: null,
    explodeAt: now + BOMB_TIMER_MS,
  });
  return true;
}

function throwGrenade(state, actor, facing, now) {
  if (!actor.position || !facing || ownsBomb(state.bombs, actor.id)) {
    return false;
  }
  const target = getGrenadeTarget(
    actor.position,
    facing,
    state.walls,
    state.borders,
    state.bombs,
  );
  if (!target) {
    return false;
  }
  state.bombs.push({
    id: takeId(state),
    row: target.row,
    col: target.col,
    owner: actor.id,
    range: BOMB_RANGE,
    kind: "grenade",
    airborne: true,
    from: { row: actor.position.row, col: actor.position.col },
    landAt: now + GRENADE_FLIGHT_MS,
    explodeAt: null,
  });
  return true;
}

function consumeGrenade(state, actor) {
  const effects = { ...(actor.effects ?? {}) };
  delete effects.grenade;
  state.actors = updateActor(state.actors, actor.id, { effects });
  return getActor(state.actors, actor.id);
}

function releaseCharge(state, actor, now) {
  if (hasEffect(actor, "grenade", now)) {
    const threw = throwGrenade(state, actor, actor.facing, now);
    if (threw) {
      return consumeGrenade(state, actor);
    }
  }
  plantBomb(state, actor, now);
  return actor;
}

function applyHuman(state, actorId, input, now) {
  if (!input) {
    return;
  }
  let actor = getActor(state.actors, actorId);
  if (!actor?.alive || !actor.position || actor.kind !== "player") {
    return;
  }

  if (input.direction) {
    const facing = facingFromDirection(input.direction);
    if (facing !== actor.facing) {
      state.actors = updateActor(state.actors, actorId, { facing });
      actor = getActor(state.actors, actorId);
    }
  }

  if (input.action === "bomb") {
    actor = releaseCharge(state, actor, now);
  }

  if (!input.direction || now < actor.nextMoveAt) {
    return;
  }

  const nextCell = cellAfterStep(actor.position, input.direction);
  if (
    isPlayerStepBlocked(nextCell, state.walls, state.borders, state.bombs, {
      blockWalls: true,
      blockBombs: true,
    })
  ) {
    return;
  }

  state.actors = updateActor(state.actors, actorId, {
    position: nextCell,
    nextMoveAt: now + moveIntervalFor(actor, now),
  });
}

function applyBot(state, actorId, now, random) {
  const actor = getActor(state.actors, actorId);
  if (!actor?.alive || !actor.position || now < actor.nextMoveAt) {
    return;
  }

  const turn = nextBotTurn(
    actor.position,
    actor.direction,
    state.walls,
    state.borders,
    state.bombs,
    actor.id,
    rangeFor(actor, now),
    {
      hasGrenade: hasEffect(actor, "grenade", now),
      facing: actor.facing,
      others: aliveActors(state.actors)
        .filter((other) => other.id !== actor.id && other.position)
        .map((other) => other.position),
    },
    random,
  );

  let effects;
  if (turn.grenade && turn.grenadeFacing) {
    const threw = throwGrenade(state, actor, turn.grenadeFacing, now);
    if (threw) {
      effects = { ...(actor.effects ?? {}) };
      delete effects.grenade;
    }
  } else if (turn.plant) {
    plantBomb(state, actor, now);
  }

  const patch = {
    position: turn.position,
    direction: turn.direction
      ? { row: turn.direction.row, col: turn.direction.col }
      : null,
    nextMoveAt: now + moveIntervalFor(actor, now),
  };
  if (effects) {
    patch.effects = effects;
  }
  if (turn.direction) {
    patch.facing = facingFromDirection(turn.direction);
  }
  state.actors = updateActor(state.actors, actor.id, patch);
}

function landGrenades(state, now) {
  state.bombs = state.bombs.map((bomb) => {
    if (bomb.kind !== "grenade" || !bomb.airborne || bomb.landAt == null) {
      return bomb;
    }
    if (bomb.landAt > now) {
      return bomb;
    }
    return {
      ...bomb,
      airborne: false,
      explodeAt: bomb.landAt + GRENADE_TIMER_MS,
    };
  });
}

function explodeOne(state, bomb, random) {
  state.bombs = state.bombs.filter((item) => item.id !== bomb.id);
  const at = bomb.explodeAt ?? 0;
  const outcome = resolveExplosionOutcome({
    bombPosition: bomb,
    walls: state.walls,
    borders: state.borders,
    actors: state.actors,
    range: bomb.range,
    now: at,
    owner: bomb.owner,
  });

  const kept = survivingBonuses(state.bonuses, outcome.cells);
  const spawned = spawnBonusesFromWalls(outcome.destroyedWalls, random, at).map(
    (bonus) => ({ ...bonus, id: takeId(state) }),
  );
  state.bonuses =
    spawned.length === 0 && kept === state.bonuses ? kept : [...kept, ...spawned];
  state.walls = outcome.walls;
  state.actors = outcome.actors;

  for (const wall of outcome.destroyedWalls) {
    if (wall.type === "hedge") {
      state.hedges.push({
        row: wall.row,
        col: wall.col,
        regrowAt: at + HEDGE_REGROW_MS,
      });
    }
  }

  state.explosions.push({
    id: bomb.id,
    cells: outcome.cells,
    until: at + EXPLOSION_DURATION_MS,
  });
}

function explodeDueBombs(state, now, random) {
  for (;;) {
    const due = state.bombs
      .filter(
        (bomb) =>
          !bomb.airborne && bomb.explodeAt != null && bomb.explodeAt <= now,
      )
      .sort((left, right) => left.explodeAt - right.explodeAt || left.id - right.id);
    if (due.length === 0) {
      return;
    }
    explodeOne(state, due[0], random);
  }
}

function regrowHedges(state, now) {
  const pending = [];
  for (const hedge of state.hedges) {
    if (hedge.regrowAt > now) {
      pending.push(hedge);
      continue;
    }
    let at = hedge.regrowAt;
    let placed = false;
    while (at <= now) {
      if (!cellBlocked(state, hedge.row, hedge.col)) {
        state.walls.push({ row: hedge.row, col: hedge.col, type: "hedge" });
        placed = true;
        break;
      }
      at += HEDGE_RETRY_MS;
    }
    if (!placed) {
      pending.push({ row: hedge.row, col: hedge.col, regrowAt: at });
    }
  }
  state.hedges = pending;
}

export function step(state, inputs = [], now) {
  if (!state || state.status !== "playing") {
    return state;
  }

  const next = structuredClone(state);
  const rng = { state: next.rng };
  const random = createRandom(rng);
  next.toasts = next.toasts.filter((toast) => toast.until > now);
  next.explosions = next.explosions.filter((blast) => blast.until > now);
  next.actors = expireActorEffects(next.actors, now);
  landGrenades(next, now);
  explodeDueBombs(next, now, random);
  regrowHedges(next, now);

  const inputById = new Map();
  if (Array.isArray(inputs)) {
    for (const input of inputs) {
      if (input?.actorId) {
        inputById.set(input.actorId, input);
      }
    }
  }

  const humanIds = next.actors
    .filter((actor) => actor.kind === "player")
    .map((actor) => actor.id);
  for (const actorId of humanIds) {
    applyHuman(next, actorId, inputById.get(actorId) ?? null, now);
  }

  const botIds = next.actors
    .filter((actor) => actor.kind === "bot")
    .map((actor) => actor.id);
  for (const actorId of botIds) {
    applyBot(next, actorId, now, random);
  }

  const pickup = collectBonuses(next.actors, next.bonuses, now);
  next.actors = pickup.actors;
  next.bonuses = pruneBonuses(pickup.bonuses, now);
  for (const item of pickup.collected) {
    next.toasts.push({
      id: item.id,
      text: bonusToastText(item.type, item.actorName),
      until: now + TOAST_MS,
    });
  }

  if (next.zone) {
    const radius = safeRadius(Math.max(0, now - next.zone.startedAt));
    const zoned = applyZoneDamage(next.actors, radius, now, next.zoneSince);
    next.actors = zoned.actors;
    next.zoneSince = zoned.since;
  }

  const outcome = judge(next.actors);
  if (outcome.status !== "playing") {
    next.status = outcome.status;
    next.outcomes = outcome.outcomes;
  }

  next.rng = rng.state;
  return next;
}
