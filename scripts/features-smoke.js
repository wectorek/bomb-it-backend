import assert from "node:assert/strict";
import { createMatch } from "../game/createMatch.js";
import { getActor } from "../game/actors.js";
import { isFrozen } from "../game/modes.js";
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

console.log("features-smoke ok");