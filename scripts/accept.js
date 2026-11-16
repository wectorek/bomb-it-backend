import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { getActor } from "../game/actors.js";
import { createMatch } from "../game/createMatch.js";
import {
  BOMB_TIMER_MS,
  GRENADE_FLIGHT_MS,
  GRENADE_TIMER_MS,
  HEDGE_REGROW_MS,
} from "../game/config.js";
import { snapshot } from "../game/snapshot.js";
import { step } from "../game/step.js";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  noteInput,
  startServer,
} from "../server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function solo(seed, extra = {}) {
  return createMatch({
    seed,
    now: 0,
    humans: [{ id: "p1", name: "Ty", color: "blue" }],
    fillBots: true,
    zone: false,
    ...extra,
  });
}

function freezeBots(state) {
  for (const actor of state.actors) {
    if (actor.kind === "bot") {
      actor.nextMoveAt = 1e15;
    }
  }
  return state;
}

function isOpen(state, row, col) {
  if (row < 0 || col < 0 || row >= 15 || col >= 15) {
    return false;
  }
  if (state.borders.some((cell) => cell.row === row && cell.col === col)) {
    return false;
  }
  if (state.walls.some((wall) => wall.row === row && wall.col === col)) {
    return false;
  }
  return !state.actors.some(
    (actor) =>
      actor.alive && actor.position?.row === row && actor.position?.col === col,
  );
}

function hedgeAt(state, cell) {
  return state.walls.some(
    (wall) => wall.type === "hedge" && wall.row === cell.row && wall.col === cell.col,
  );
}

function findHedgeSpot(state) {
  const deltas = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (const hedge of state.walls) {
    if (hedge.type !== "hedge") {
      continue;
    }
    for (const [dRow, dCol] of deltas) {
      const spot = { row: hedge.row + dRow, col: hedge.col + dCol };
      if (isOpen(state, spot.row, spot.col)) {
        return { hedge, spot };
      }
    }
  }
  return null;
}

function rulesArePure() {
  for (const name of readdirSync(path.join(root, "game"))) {
    if (!name.endsWith(".js")) {
      continue;
    }
    const source = readFileSync(path.join(root, "game", name), "utf8");
    assert.equal(source.includes("Math.random"), false, `${name} używa Math.random`);
    assert.equal(source.includes("Date.now"), false, `${name} używa Date.now`);
    assert.equal(source.includes("setTimeout"), false, `${name} używa setTimeout`);
    assert.equal(source.includes("setInterval"), false, `${name} używa setInterval`);
  }
}

function sameMatchTwice() {
  assert.deepEqual(solo(4), solo(4));
  assert.notDeepEqual(solo(4), solo(5));
}

function stepIsRepeatable() {
  const state = solo(3);
  const snapshotBefore = structuredClone(state);
  const inputs = [
    { actorId: "p1", direction: { row: 0, col: 1 }, action: "bomb" },
  ];
  const once = step(state, inputs, 1000);
  const twice = step(state, inputs, 1000);
  assert.deepEqual(once, twice);
  assert.deepEqual(state, snapshotBefore);
  assert.notEqual(once, state);

  let left = solo(8);
  let right = solo(8);
  for (let now = 0; now <= 2500; now += 50) {
    const frame = [
      {
        actorId: "p1",
        direction: { row: 0, col: 1 },
        action: now === 400 ? "bomb" : null,
      },
    ];
    left = step(left, frame, now);
    right = step(right, frame, now);
  }
  assert.deepEqual(left, right);
  assert.notEqual(left.status, undefined);
}

function botsWalk() {
  let state = solo(1);
  const start = state.actors
    .filter((actor) => actor.kind === "bot")
    .map((actor) => ({ ...actor.position }));
  for (let now = 50; now <= 3000; now += 50) {
    state = step(state, [], now);
  }
  const moved = state.actors
    .filter((actor) => actor.kind === "bot")
    .some(
      (actor, index) =>
        actor.position.row !== start[index].row ||
        actor.position.col !== start[index].col,
    );
  assert.equal(moved, true, "boty nie ruszyły się w 3 s");
}

function bombHedgeAndBonus() {
  const staged = freezeBots(solo(1));
  const spot = findHedgeSpot(staged);
  assert.ok(spot, "brak żywopłotu z wolnym sąsiednim polem");
  const player = getActor(staged.actors, "p1");
  player.position = { ...spot.spot };
  player.lives = 3;

  const planted = step(
    staged,
    [{ actorId: "p1", direction: null, action: "bomb" }],
    0,
  );
  const bomb = planted.bombs.find((item) => item.owner === "p1");
  assert.ok(bomb);
  assert.equal(bomb.explodeAt, BOMB_TIMER_MS);

  const held = step(planted, [], BOMB_TIMER_MS - 1);
  assert.equal(
    held.bombs.some((item) => item.id === bomb.id),
    true,
  );
  assert.equal(held.explosions.length, 0);

  const blown = step(planted, [], BOMB_TIMER_MS);
  assert.equal(
    blown.bombs.some((item) => item.id === bomb.id),
    false,
  );
  assert.equal(hedgeAt(blown, spot.hedge), false);
  assert.ok(blown.explosions.some((blast) => blast.id === bomb.id));
  assert.equal(blown.status, "playing");

  const early = step(blown, [], BOMB_TIMER_MS + HEDGE_REGROW_MS - 1);
  assert.equal(hedgeAt(early, spot.hedge), false);
  const grown = step(blown, [], BOMB_TIMER_MS + HEDGE_REGROW_MS);
  assert.equal(hedgeAt(grown, spot.hedge), true);

  const withBonus = solo(2);
  const standing = getActor(withBonus.actors, "p1");
  withBonus.bonuses = [
    {
      id: 7,
      row: standing.position.row,
      col: standing.position.col,
      type: "speed",
    },
  ];
  const picked = step(withBonus, [], 0);
  assert.equal(picked.bonuses.length, 0);
  const enriched = getActor(picked.actors, "p1");
  assert.equal(enriched.stats.bonusesCollected.positive, 1);
  assert.ok(enriched.effects.speed);
  assert.equal(
    picked.toasts.some((toast) => toast.text.includes("Szybkość")),
    true,
  );
}

function grenadeTimesOut() {
  let state = null;
  let facing = null;
  for (let seed = 1; seed <= 12 && !facing; seed += 1) {
    const candidate = freezeBots(solo(seed));
    const actor = getActor(candidate.actors, "p1");
    const options = [
      ["right", 0, 1],
      ["left", 0, -1],
      ["down", 1, 0],
      ["up", -1, 0],
    ];
    for (const [name, dRow, dCol] of options) {
      const row = actor.position.row + dRow * 2;
      const col = actor.position.col + dCol * 2;
      if (isOpen(candidate, row, col)) {
        state = candidate;
        facing = name;
        break;
      }
    }
  }
  assert.ok(facing, "brak pola na rzut granatem");
  const player = getActor(state.actors, "p1");
  player.facing = facing;
  player.effects = { grenade: {} };

  const thrown = step(
    state,
    [{ actorId: "p1", direction: null, action: "bomb" }],
    0,
  );
  const grenade = thrown.bombs.find((bomb) => bomb.kind === "grenade");
  assert.ok(grenade?.airborne);
  assert.equal(grenade.landAt, GRENADE_FLIGHT_MS);
  assert.equal(getActor(thrown.actors, "p1").effects.grenade, undefined);

  const inFlight = step(thrown, [], GRENADE_FLIGHT_MS - 1);
  assert.equal(inFlight.bombs[0].airborne, true);
  const landed = step(thrown, [], GRENADE_FLIGHT_MS);
  assert.equal(landed.bombs[0].airborne, false);
  assert.equal(landed.bombs[0].explodeAt, GRENADE_FLIGHT_MS + GRENADE_TIMER_MS);
  const blown = step(landed, [], GRENADE_FLIGHT_MS + GRENADE_TIMER_MS);
  assert.equal(
    blown.bombs.some((bomb) => bomb.id === grenade.id),
    false,
  );
  assert.ok(blown.explosions.some((blast) => blast.id === grenade.id));
}

function statusLeavesPlaying() {
  const fatal = freezeBots(solo(1));
  getActor(fatal.actors, "p1").lives = 1;
  const planted = step(
    fatal,
    [{ actorId: "p1", direction: null, action: "bomb" }],
    0,
  );
  const ended = step(planted, [], BOMB_TIMER_MS);
  assert.equal(ended.status, "lose");
  assert.equal(ended.outcomes.p1, "lose");
  assert.equal(step(ended, [], BOMB_TIMER_MS + 50), ended);

  const draw = freezeBots(solo(1));
  const cell = { ...getActor(draw.actors, "p1").position };
  for (const actor of draw.actors) {
    actor.position = { ...cell };
    actor.lives = 1;
  }
  const armed = step(
    draw,
    [{ actorId: "p1", direction: null, action: "bomb" }],
    0,
  );
  const tied = step(armed, [], BOMB_TIMER_MS);
  assert.equal(tied.status, "draw");

  const alone = createMatch({
    seed: 1,
    now: 0,
    zone: false,
    fillBots: false,
    humans: [{ id: "p1", name: "Ty", color: "blue" }],
  });
  assert.equal(alone.actors.length, 1);
  assert.equal(step(alone, [], 50).status, "playing");

  let multi = createMatch({
    seed: 1,
    now: 0,
    zone: false,
    fillBots: false,
    humans: [
      { id: "p1", name: "A", color: "blue" },
      { id: "p2", name: "B", color: "red" },
    ],
  });
  const second = getActor(multi.actors, "p2");
  second.alive = false;
  second.lives = 0;
  second.diedAt = 1;
  multi = step(multi, [], 50);
  assert.equal(multi.status, "ended");
  assert.equal(multi.outcomes.p1, "win");
  assert.equal(multi.outcomes.p2, "lose");

  let together = createMatch({
    seed: 2,
    now: 0,
    zone: false,
    fillBots: false,
    humans: [
      { id: "p1", name: "A", color: "blue" },
      { id: "p2", name: "B", color: "red" },
    ],
  });
  for (const id of ["p1", "p2"]) {
    const actor = getActor(together.actors, id);
    actor.alive = false;
    actor.lives = 0;
    actor.diedAt = 5;
  }
  together = step(together, [], 50);
  assert.equal(together.outcomes.p1, "draw");
  assert.equal(together.outcomes.p2, "draw");
}

function roundEnds() {
  let ended = null;
  for (let seed = 1; seed <= 6 && !ended; seed += 1) {
    let state = solo(seed, { zone: true });
    let now = 0;
    for (; now <= 120000 && state.status === "playing"; now += 50) {
      state = step(state, [], now);
    }
    if (state.status !== "playing") {
      ended = { seed, status: state.status, now };
    }
  }
  assert.ok(ended, "żadna z sześciu rund ze strefą nie zeszła ze statusu playing");
  assert.ok(["win", "lose", "draw"].includes(ended.status));
  console.log(
    `runda seed=${ended.seed} status=${ended.status} po ${ended.now} ms`,
  );
}

function viewHidesSecrets() {
  const state = solo(6);
  const bonusWall = state.walls.find((wall) => wall.type === "bonus");
  assert.ok(bonusWall, "labirynt nie ma ściany z bonusem");
  state.bonuses = [{ id: 50, row: 3, col: 3, type: "speed" }];
  const view = snapshot(state, { roomId: "ABCD", you: "p1", now: 0 });
  assert.equal(view.rng, undefined);
  assert.equal(view.walls.some((wall) => wall.type === "bonus"), false);
  assert.equal(
    view.walls.find(
      (wall) => wall.row === bonusWall.row && wall.col === bonusWall.col,
    ).type,
    "destructible",
  );
  assert.deepEqual(view.bonuses, [{ id: 50, row: 3, col: 3 }]);
  assert.equal(view.actors[0].nextMoveAt, undefined);
  assert.equal(typeof view.actors[0].moveIntervalMs, "number");
  assert.equal(view.status, "playing");
}

function inputSeq() {
  const conn = { lastSeq: 0, direction: null, pendingAction: null };
  assert.equal(
    noteInput(conn, {
      seq: 1,
      direction: { row: 0, col: 1 },
      action: "bomb",
    }),
    true,
  );
  assert.equal(
    noteInput(conn, {
      seq: 1,
      direction: { row: 1, col: 0 },
      action: null,
    }),
    false,
  );
  assert.deepEqual(conn.direction, { row: 0, col: 1 });
  assert.equal(conn.pendingAction, "bomb");
  assert.equal(
    noteInput(conn, { seq: 2, direction: { row: 1, col: 1 }, action: null }),
    true,
  );
  assert.equal(conn.direction, null);
  assert.equal(conn.pendingAction, "bomb");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const queue = [];
    let pending = null;
    let timer = null;

    function deliver(message) {
      if (pending) {
        clearTimeout(timer);
        const resolvePending = pending;
        pending = null;
        resolvePending(message);
        return;
      }
      queue.push(message);
    }

    ws.on("message", (raw) => deliver(JSON.parse(String(raw))));
    ws.on("error", reject);
    ws.on("open", () => {
      resolve({
        ws,
        send(payload) {
          ws.send(JSON.stringify(payload));
        },
        next(timeoutMs = 2000) {
          if (queue.length > 0) {
            return Promise.resolve(queue.shift());
          }
          return new Promise((resolveNext, rejectNext) => {
            pending = resolveNext;
            timer = setTimeout(() => {
              pending = null;
              rejectNext(new Error("timeout czekania na wiadomość"));
            }, timeoutMs);
          });
        },
      });
    });
  });
}

async function until(socket, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = await socket.next(deadline - Date.now());
    if (predicate(message)) {
      return message;
    }
  }
  throw new Error("timeout warunku");
}

async function protocol() {
  assert.equal(DEFAULT_HOST, "0.0.0.0");
  assert.equal(DEFAULT_PORT, 8787);
  const server = await startServer({ port: 0, host: "127.0.0.1", silent: true });
  const sockets = [];
  try {
    const health = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.equal(health.status, 200);

    const player = await connect(`ws://127.0.0.1:${server.port}`);
    sockets.push(player);
    player.send({ type: "create", nick: "Ty", zone: false, fillBots: true });
    const welcome = await player.next();
    assert.equal(welcome.type, "welcome");
    assert.equal(welcome.code, welcome.roomId);
    assert.equal(welcome.you, "p1");

    const opened = await until(
      player,
      (message) => message.type === "state" && message.status === "playing",
      2000,
    );
    assert.equal(opened.actors.length, 4);
    assert.equal(opened.you, "p1");
    const knownBombs = new Set(opened.bombs.map((bomb) => bomb.id));

    const other = await connect(`ws://127.0.0.1:${server.port}`);
    sockets.push(other);
    other.send({ type: "join", code: welcome.code, nick: "Inny" });
    const rejoined = await other.next();
    assert.equal(rejoined.type, "welcome");
    assert.equal(rejoined.you, welcome.you);
    const otherView = await until(
      other,
      (message) => message.type === "state",
      2000,
    );
    assert.equal(otherView.you, "p1");

    player.send({
      type: "input",
      direction: null,
      action: "bomb",
      seq: 1,
    });
    const armed = await until(
      player,
      (message) =>
        message.type === "state" &&
        message.bombs.some((bomb) => !knownBombs.has(bomb.id)),
      2000,
    );
    const bombId = armed.bombs.find((bomb) => !knownBombs.has(bomb.id)).id;
    const blown = await until(
      player,
      (message) =>
        message.type === "state" &&
        message.explosions.some((blast) => blast.id === bombId),
      5000,
    );
    assert.ok(blown.explosions.find((blast) => blast.id === bombId).cells.length > 0);

    player.send({ type: "restart" });
    const restarted = await until(
      player,
      (message) =>
        message.type === "state" &&
        message.startedAt !== opened.startedAt &&
        message.bombs.length === 0 &&
        message.actors.every((actor) => actor.lives === 3 && actor.alive),
      2000,
    );
    assert.equal(restarted.status, "playing");

    const host = await connect(`ws://127.0.0.1:${server.port}`);
    sockets.push(host);
    host.send({ type: "create", nick: "Ala", zone: true, fillBots: false });
    await host.next();
    const lobby = await until(
      host,
      (message) => message.type === "state" && message.status === "lobby",
      2000,
    );
    assert.equal(lobby.actors.length, 1);
    assert.equal(lobby.fillBots, false);
    host.send({ type: "restart" });
    const started = await until(
      host,
      (message) => message.type === "state" && message.status === "playing",
      2000,
    );
    assert.equal(started.actors.length, 1);
    assert.equal(started.actors[0].kind, "player");
    assert.ok(started.zone);
    assert.equal(typeof started.zone.radius, "number");

    const withBots = await connect(`ws://127.0.0.1:${server.port}`);
    sockets.push(withBots);
    withBots.send({
      type: "create",
      nick: "Ola",
      zone: false,
      fillBots: true,
      lobby: true,
    });
    await withBots.next();
    const waiting = await until(
      withBots,
      (message) => message.type === "state" && message.status === "lobby",
      2000,
    );
    assert.equal(waiting.fillBots, true);
    withBots.send({ type: "restart" });
    const filled = await until(
      withBots,
      (message) => message.type === "state" && message.status === "playing",
      2000,
    );
    assert.equal(filled.actors.filter((actor) => actor.kind === "bot").length, 3);
  } finally {
    for (const socket of sockets) {
      socket.ws.close();
    }
    await server.close();
  }
}

rulesArePure();
sameMatchTwice();
stepIsRepeatable();
botsWalk();
bombHedgeAndBonus();
grenadeTimesOut();
statusLeavesPlaying();
viewHidesSecrets();
inputSeq();
const started = Date.now();
roundEnds();
console.log(`symulacja ${Date.now() - started} ms`);
await protocol();
console.log("accept ok");
