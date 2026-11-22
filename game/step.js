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
import { damageFor } from "./bonus.js";
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
import {
  isFrozen,
  judgeMatch,
  tickHillScoring,
  zoneCellMs,
} from "./modes.js";
import { createRandom } from "./rng.js";
import { applyZoneDamage, safeHalf } from "./zone.js";

const FINALE_DROP_FALL_MS = 1200;
const MESS_SLOW_MULTIPLIER = 2.5;
const FINALE_DROP_EVERY_MS = 700;
// Mecz od startu we dwójkę nie czyści areny od razu.
const FINALE_DUEL_DELAY_MS = 30_000;

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
    range: rangeFor(actor, now, state.settings),
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
  if (isFrozen(state, now)) {
    return;
  }
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
    nextMoveAt: now + stepDelay(state, actor, nextCell, now),
  });
}

// Wejście w zasrane pole spowalnia ruch.
function stepDelay(state, actor, cell, now) {
  const base = moveIntervalFor(actor, now, state.settings);
  const messy = cell && (state.mess ?? []).some(
    (spot) => spot.row === cell.row && spot.col === cell.col,
  );
  return messy ? Math.round(base * MESS_SLOW_MULTIPLIER) : base;
}

function applyBot(state, actorId, now, random) {
  if (isFrozen(state, now)) {
    return;
  }
  const actor = getActor(state.actors, actorId);
  if (!actor?.alive || !actor.position || now < actor.nextMoveAt) {
    return;
  }

  const cellMs = zoneCellMs(state.settings);
  const half =
    state.zone != null
      ? safeHalf(Math.max(0, now - state.zone.startedAt), undefined, cellMs)
      : null;

  const turn = nextBotTurn(
    actor.position,
    actor.direction,
    state.walls,
    state.borders,
    state.bombs,
    actor.id,
    rangeFor(actor, now, state.settings),
    {
      hasGrenade: hasEffect(actor, "grenade", now),
      facing: actor.facing,
      others: aliveActors(state.actors)
        .filter((other) => other.id !== actor.id && other.position)
        .map((other) => other.position),
      botDifficulty: state.settings?.botDifficulty ?? "normal",
      drops: state.drops ?? [],
      mess: state.mess ?? [],
      zoneHalf: half,
      now,
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
    nextMoveAt: now + stepDelay(state, actor, turn.position, now),
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
    shape: state.finale ? "square" : "cross",
  });

  const kept = survivingBonuses(state.bonuses, outcome.cells);
  const spawned = spawnBonusesFromWalls(
    outcome.destroyedWalls,
    random,
    at,
    state.settings,
  ).map(
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
        regrowAt:
          at +
          (state.settings?.hedgeRegrowSec != null
            ? state.settings.hedgeRegrowSec * 1000
            : HEDGE_REGROW_MS),
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

// Finał: z góry spadają kawałki, które po wylądowaniu ranią stojących na polu.
function runFinaleDrops(state, now, random) {
  const size = state.borders ? Math.max(...state.borders.map((b) => b.col)) : 14;
  const alive = state.actors.filter((actor) => actor.alive && actor.position);

  if (now >= (state.nextDropAt ?? 0)) {
    const count = Math.max(1, alive.length);
    for (let i = 0; i < count; i += 1) {
      let cell;
      if (alive.length > 0 && random() < 0.5) {
        const target = alive[Math.floor(random() * alive.length)];
        cell = { row: target.position.row, col: target.position.col };
      } else {
        cell = {
          row: 1 + Math.floor(random() * (size - 1)),
          col: 1 + Math.floor(random() * (size - 1)),
        };
      }
      state.drops.push({
        id: takeId(state),
        row: cell.row,
        col: cell.col,
        at: now,
        landAt: now + FINALE_DROP_FALL_MS,
      });
    }
    state.nextDropAt = now + FINALE_DROP_EVERY_MS;
  }

  const landed = state.drops.filter((drop) => drop.landAt <= now);
  if (landed.length === 0) {
    return;
  }
  state.drops = state.drops.filter((drop) => drop.landAt > now);
  for (const drop of landed) {
    if (!state.mess.some((s) => s.row === drop.row && s.col === drop.col)) {
      state.mess.push({ row: drop.row, col: drop.col });
    }
  }
  state.actors = state.actors.map((actor) => {
    if (!actor.alive || !actor.position) {
      return actor;
    }
    const hits = landed.filter(
      (drop) => drop.row === actor.position.row && drop.col === actor.position.col,
    ).length;
    if (hits === 0) {
      return actor;
    }
    const damage = damageFor(actor, now) * hits;
    if (damage <= 0) {
      return actor;
    }
    const lives = Math.max(0, actor.lives - damage);
    const aliveNow = lives > 0;
    return {
      ...actor,
      lives,
      alive: aliveNow,
      ...(!aliveNow && actor.diedAt == null ? { diedAt: now } : {}),
    };
  });
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

  const pickup = collectBonuses(
    next.actors,
    next.bonuses,
    now,
    next.settings,
  );
  next.actors = pickup.actors;
  next.bonuses = pruneBonuses(pickup.bonuses, now);
  for (const item of pickup.collected) {
    next.toasts.push({
      id: item.id,
      text: bonusToastText(item.type, item.actorName),
      until: now + TOAST_MS,
    });
  }

  if (next.modeEffective === "hill") {
    const hill = tickHillScoring(next, now);
    if (hill) {
      next.actors = hill.actors;
      next.hillTickSince = hill.hillTickSince;
    }
  }

  if (next.zone) {
    const half = safeHalf(
      Math.max(0, now - next.zone.startedAt),
      undefined,
      zoneCellMs(next.settings),
    );
    const zoned = applyZoneDamage(next.actors, half, now, next.zoneSince);
    next.actors = zoned.actors;
    next.zoneSince = zoned.since;
  }

  const aliveCount = next.actors.filter((actor) => actor.alive).length;
  const duelClock = next.countdownUntil ?? next.startedAt ?? now;
  const duelReady =
    next.settings?.finaleOnDuel === true &&
    aliveCount === 2 &&
    (next.startActors > 2 || now - duelClock >= FINALE_DUEL_DELAY_MS);
  const timeReady =
    typeof next.finaleStartsAt === "number" && now >= next.finaleStartsAt;
  if (!next.finale && (timeReady || duelReady)) {
    next.finale = { startedAt: now };
    next.drops = [];
    next.mess = [];
    next.nextDropAt = now + 800;
    next.walls = [];
    next.hedges = [];
    next.bonuses = [];
    next.toasts.push({
      id: takeId(next),
      text: "Rozwolnienie!",
      until: now + TOAST_MS * 2,
    });
  }

  if (next.finale) {
    runFinaleDrops(next, now, random);
  }

  const outcome = judgeMatch(next, now);
  if (outcome.status !== "playing") {
    next.status = outcome.status;
    next.outcomes = outcome.outcomes;
    if (outcome.winningTeam != null) {
      next.winningTeam = outcome.winningTeam;
    }
  }

  next.rng = rng.state;
  return next;
}
