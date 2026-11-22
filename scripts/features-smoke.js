import assert from "node:assert/strict";
import { createMatch } from "../game/createMatch.js";
import { getActor } from "../game/actors.js";
import { isFrozen } from "../game/modes.js";
import { snapshot } from "../game/snapshot.js";
import { step } from "../game/step.js";

function freezeBots(state) {
  for (const actor of state.actors) {
    if (actor.kind === "bot") {
      actor.nextMoveAt = 1e15;
    }
  }
  return state;
}

const live = createMatch({
  seed: 3,
  now: 1000,
  humans: [{ id: "p1", name: "Ty", color: "blue" }],
  fillBots: true,
});
assert.equal(isFrozen(live, 1500), true, "countdown zamraża ruch");
assert.deepEqual(
  getActor(
    step(live, [{ actorId: "p1", direction: { row: 0, col: 1 } }], 1500).actors,
    "p1",
  ).position,
  getActor(live.actors, "p1").position,
  "ruch zablokowany w countdown",
);
assert.equal(isFrozen(live, live.countdownUntil), false);

const hill = freezeBots(
  createMatch({
    seed: 9,
    now: 0,
    humans: [{ id: "p1", name: "Ty", color: "blue" }],
    fillBots: false,
    settings: { mode: "hill", hillPoints: 2 },
  }),
);
const center = hill.hillCells[0];
getActor(hill.actors, "p1").position = { ...center };
const hillMid = step(hill, [], 2000);
assert.ok(
  (getActor(hillMid.actors, "p1").score ?? 0) >= 1,
  "hill nalicza punkty",
);

const quiet = freezeBots(
  createMatch({
    seed: 2,
    now: 0,
    humans: [{ id: "p1", name: "Ty", color: "blue" }],
    fillBots: false,
    settings: { finaleAfterSec: 120 },
  }),
);
assert.equal(quiet.settings.mode, "classic");
assert.equal(quiet.finaleStartsAt, 120000);
const before = step(quiet, [], 119000);
assert.equal(before.finale, null, "rozwolnienie czeka na ustawiony czas");
const after = step(before, [], 120000);
assert.ok(after.finale, "rozwolnienie startuje po czasie");
const off = createMatch({
  seed: 2,
  now: 0,
  humans: [{ id: "p1", name: "Ty", color: "blue" }],
  fillBots: false,
  settings: { mode: "points", finale: false },
});
assert.equal(off.settings.mode, "classic", "tryb punktów odpada");
assert.equal(off.finaleStartsAt, null);

const duel = freezeBots(
  createMatch({
    seed: 4,
    now: 1000,
    humans: [
      { id: "p1", name: "A", color: "blue" },
      { id: "p2", name: "B", color: "red" },
      { id: "p3", name: "C", color: "green" },
    ],
    fillBots: false,
    settings: { finaleOnDuel: true },
  }),
);
assert.equal(duel.settings.finaleOnDuel, true);
assert.equal(duel.finaleStartsAt, null);
getActor(duel.actors, "p3").alive = false;
getActor(duel.actors, "p3").lives = 0;
const duelStart = step(duel, [], duel.countdownUntil + 1000);
assert.ok(duelStart.finale, "rozwolnienie przy dwóch żywych");

const pair = freezeBots(
  createMatch({
    seed: 5,
    now: 1000,
    humans: [
      { id: "p1", name: "A", color: "blue" },
      { id: "p2", name: "B", color: "red" },
    ],
    fillBots: false,
    settings: { finaleOnDuel: true },
  }),
);
const pairEarly = step(pair, [], pair.countdownUntil + 1000);
assert.equal(pairEarly.finale, null, "dwójka od startu czeka");
const pairLate = step(pairEarly, [], pair.countdownUntil + 30000);
assert.ok(pairLate.finale, "dwójka od startu po 30 s");

const warned = createMatch({
  seed: 6,
  now: 0,
  humans: [{ id: "p1", name: "Ty", color: "blue" }],
  fillBots: false,
});
const feet = getActor(warned.actors, "p1").position;
warned.bombs.push({
  id: 1,
  row: feet.row,
  col: feet.col,
  range: 2,
  owner: "p1",
  explodeAt: 10000,
});
const during = snapshot(warned, { roomId: "t", you: "p1", now: 9500 });
assert.ok(
  (during.bombs[0].previewCells ?? []).length > 0,
  "przed wybuchem widać ostrzeżenie",
);
warned.status = "ended";
const afterRound = snapshot(warned, { roomId: "t", you: "p1", now: 9500 });
assert.ok(
  afterRound.bombs.every((bomb) => !bomb.previewCells?.length),
  "po rundzie nie ma kwadratów ostrzegawczych",
);

console.log("features-smoke ok");