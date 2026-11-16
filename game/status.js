// Solo: wygrana, gdy człowiek żyje i nie żyje żaden bot; przegrana, gdy człowiek
// zginął, a bot został; remis tylko gdy wszyscy zginęli w tym samym momencie.
export function soloStatus(human, bots) {
  if (!human) {
    return "playing";
  }
  if (bots.length === 0) {
    return human.alive ? "playing" : "lose";
  }
  const anyBotAlive = bots.some((bot) => bot.alive);
  if (human.alive && !anyBotAlive) {
    return "win";
  }
  if (human.alive) {
    return "playing";
  }
  if (anyBotAlive) {
    return "lose";
  }
  const times = [human, ...bots].map((actor) => actor.diedAt);
  const sameTime = times.every((time) => time != null && time === times[0]);
  return sameTime ? "draw" : "lose";
}

export function judge(actors) {
  const humans = actors.filter((actor) => actor.kind === "player");
  const bots = actors.filter((actor) => actor.kind === "bot");

  if (humans.length <= 1) {
    const status = humans.length === 0 ? "playing" : soloStatus(humans[0], bots);
    const outcomes = {};
    if (humans[0] && status !== "playing") {
      outcomes[humans[0].id] = status;
    }
    return { status, outcomes };
  }

  const alive = humans.filter((human) => human.alive);
  if (alive.length >= 2) {
    return { status: "playing", outcomes: {} };
  }

  if (alive.length === 1) {
    const winnerId = alive[0].id;
    const outcomes = {};
    for (const human of humans) {
      outcomes[human.id] = human.id === winnerId ? "win" : "lose";
    }
    return { status: "ended", outcomes };
  }

  const latest = Math.max(...humans.map((human) => human.diedAt ?? -Infinity));
  const last = humans.filter((human) => human.diedAt === latest);
  const lastIds = new Set(last.map((human) => human.id));
  const outcomes = {};
  for (const human of humans) {
    if (last.length === 1) {
      outcomes[human.id] = human.id === last[0].id ? "win" : "lose";
    } else if (lastIds.has(human.id)) {
      outcomes[human.id] = "draw";
    } else {
      outcomes[human.id] = "lose";
    }
  }
  return { status: "ended", outcomes };
}

export function viewerStatus(state, you) {
  if (state?.outcomes && Object.hasOwn(state.outcomes, you)) {
    return state.outcomes[you];
  }
  return state?.status ?? "playing";
}
