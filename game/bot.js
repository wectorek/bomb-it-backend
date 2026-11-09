import { renderBorder } from "./border.js";
import { BOMB_RANGE, BOT_ENGAGE_DISTANCE } from "./config.js";
import { getExplosionCells, getGrenadeTarget, isBombAt, isInExplosion } from "./bomb.js";
import { renderWall, checkCollision } from "./maze.js";
import { facingFromDirection } from "./playerMovement.js";

const DIRECTIONS = [
  { row: -1, col: 0 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
  { row: 0, col: 1 },
];

function sameDirection(a, b) {
  return Boolean(a && b && a.row === b.row && a.col === b.col);
}

function isBlocked(position, walls, borders, bomb) {
  return (
    checkCollision(position, walls) ||
    renderBorder(position.row, position.col, borders) ||
    isBombAt(position, bomb)
  );
}

function step(position, direction) {
  return {
    row: position.row + direction.row,
    col: position.col + direction.col,
  };
}

export function getOpenDirections(position, walls, borders, bomb) {
  return DIRECTIONS.filter(
    (direction) => !isBlocked(step(position, direction), walls, borders, bomb),
  );
}

function requireRandom(random) {
  if (typeof random !== "function") {
    throw new Error("Ruch bota wymaga generatora random");
  }
  return random;
}

export function pickOpenDirection(position, walls, borders, bomb, random) {
  const roll = requireRandom(random);
  const openDirections = getOpenDirections(position, walls, borders, bomb);
  if (openDirections.length === 0) {
    return null;
  }
  return openDirections[Math.floor(roll() * openDirections.length)];
}

export function nextBotMove(position, direction, walls, borders, bomb, random) {
  const roll = requireRandom(random);
  const openDirections = getOpenDirections(position, walls, borders, bomb);
  const isIntersection = openDirections.length > 2;

  let currentDirection;
  if (isIntersection) {
    currentDirection = openDirections[Math.floor(roll() * openDirections.length)];
  } else if (
    direction &&
    openDirections.some((item) => sameDirection(item, direction))
  ) {
    currentDirection = openDirections.find((item) => sameDirection(item, direction));
  } else if (openDirections.length > 0) {
    currentDirection = openDirections[Math.floor(roll() * openDirections.length)];
  } else {
    currentDirection = null;
  }

  if (!currentDirection) {
    return { position, direction: null };
  }

  return {
    position: step(position, currentDirection),
    direction: currentDirection,
  };
}

function manhattan(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function canEscapeBlast(
  origin,
  walls,
  borders,
  bombs,
  owner,
  range = BOMB_RANGE,
  start = origin,
) {
  const planted = { row: origin.row, col: origin.col, owner, range };
  const bombsForMove = [...bombs, planted];
  const danger = new Set(
    getExplosionCells(origin, walls, borders, range).map(
      (cell) => `${cell.row},${cell.col}`,
    ),
  );
  const queue = [{ row: start.row, col: start.col, distance: 0 }];
  const seen = new Set([`${start.row},${start.col}`]);
  const thrown = start.row !== origin.row || start.col !== origin.col;

  while (queue.length > 0) {
    const current = queue.shift();
    const key = `${current.row},${current.col}`;
    if (!danger.has(key) && (current.distance > 0 || thrown)) {
      return true;
    }
    if (current.distance > range + 1) {
      continue;
    }

    for (const direction of getOpenDirections(
      current,
      walls,
      borders,
      bombsForMove,
    )) {
      const next = step(current, direction);
      const nextKey = `${next.row},${next.col}`;
      if (seen.has(nextKey)) {
        continue;
      }
      seen.add(nextKey);
      queue.push({
        row: next.row,
        col: next.col,
        distance: current.distance + 1,
      });
    }
  }

  return false;
}

function pickFrom(pool, direction, random) {
  if (pool.length === 0) {
    return null;
  }
  if (direction && pool.some((item) => sameDirection(item, direction))) {
    return pool.find((item) => sameDirection(item, direction));
  }
  return pool[Math.floor(random() * pool.length)];
}

export function nextBotTurn(
  position,
  direction,
  walls,
  borders,
  bombs = [],
  owner = "bot-1",
  range = BOMB_RANGE,
  options = {},
  random,
) {
  const roll = requireRandom(random);
  const hasGrenade = Boolean(options.hasGrenade);
  const throwFacing = direction
    ? facingFromDirection(direction)
    : (options.facing ?? null);
  const grenadeTarget =
    hasGrenade && throwFacing
      ? getGrenadeTarget(position, throwFacing, walls, borders, bombs)
      : null;

  const nearestOther = (options.others ?? []).reduce((best, other) => {
    if (!other) {
      return best;
    }
    const distance =
      Math.abs(position.row - other.row) + Math.abs(position.col - other.col);
    return Math.min(best, distance);
  }, Infinity);
  const engaged = nearestOther <= BOT_ENGAGE_DISTANCE;
  const hasOwnBomb = bombs.some((bomb) => bomb.owner === owner);
  const canLeave = getOpenDirections(position, walls, borders, bombs).length > 0;
  const feetFree = !isBombAt(position, bombs);
  const canThrow =
    engaged &&
    Boolean(grenadeTarget) &&
    !hasOwnBomb &&
    canLeave &&
    canEscapeBlast(
      grenadeTarget,
      walls,
      borders,
      bombs,
      owner,
      BOMB_RANGE,
      position,
    );
  const canPlantBomb =
    engaged &&
    !canThrow &&
    !hasOwnBomb &&
    feetFree &&
    canLeave &&
    (!hasGrenade || !grenadeTarget) &&
    canEscapeBlast(position, walls, borders, bombs, owner, range);

  const grenadeCell = canThrow ? grenadeTarget : null;
  const plantedCell = canPlantBomb
    ? { row: position.row, col: position.col }
    : null;
  const blastCell = grenadeCell ?? plantedCell;
  const blastRange = grenadeCell ? BOMB_RANGE : range;
  const bombsForMove = blastCell
    ? [
        ...bombs,
        {
          row: blastCell.row,
          col: blastCell.col,
          owner,
          range: blastRange,
        },
      ]
    : bombs;
  const threats = bombsForMove.filter((bomb) =>
    isInExplosion(
      position,
      getExplosionCells(bomb, walls, borders, bomb.range ?? BOMB_RANGE),
    ),
  );
  const turn = {
    plant: plantedCell,
    grenade: grenadeCell,
    grenadeFacing: grenadeCell ? throwFacing : null,
  };

  if (threats.length === 0) {
    return {
      ...turn,
      ...nextBotMove(position, direction, walls, borders, bombsForMove, roll),
    };
  }

  const openDirections = getOpenDirections(
    position,
    walls,
    borders,
    bombsForMove,
  );
  const here = Math.min(...threats.map((bomb) => manhattan(position, bomb)));
  const away = openDirections.filter((dir) => {
    const next = step(position, dir);
    const nextDistance = Math.min(
      ...threats.map((bomb) => manhattan(next, bomb)),
    );
    return nextDistance > here;
  });
  const currentDirection = pickFrom(
    away.length > 0 ? away : openDirections,
    direction,
    roll,
  );

  if (!currentDirection) {
    return { ...turn, position, direction: null };
  }

  return {
    ...turn,
    position: step(position, currentDirection),
    direction: currentDirection,
  };
}

export function pickEmptyPosition(size, walls, borders, blocked = [], random) {
  const roll = requireRandom(random);
  const emptyCells = [];

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const taken = blocked.some((cell) => cell.row === row && cell.col === col);
      if (
        taken ||
        renderWall(row, col, walls) ||
        renderBorder(row, col, borders)
      ) {
        continue;
      }
      emptyCells.push({ row, col });
    }
  }

  if (emptyCells.length === 0) {
    return null;
  }

  return emptyCells[Math.floor(roll() * emptyCells.length)];
}
