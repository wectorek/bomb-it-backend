import {
  BONUS_WALL_CHANCE,
  HEDGE_WALL_CHANCE,
  SOLID_WALL_CHANCE,
} from "./config.js";

function cellKey(row, col) {
  return `${row},${col}`;
}

function shuffle(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function alignToLattice(value, min) {
  return value - ((value - min) % 2);
}

function wallType(random) {
  const roll = random();
  if (roll < SOLID_WALL_CHANCE) {
    return "solid";
  }
  const bonusCut =
    SOLID_WALL_CHANCE + (1 - SOLID_WALL_CHANCE) * BONUS_WALL_CHANCE;
  if (roll < bonusCut) {
    return "bonus";
  }
  const hedgeCut = bonusCut + (1 - bonusCut) * HEDGE_WALL_CHANCE;
  if (roll < hedgeCut) {
    return "hedge";
  }
  return "destructible";
}

export function generateMaze(
  size,
  start,
  random,
  inset = 1,
  wallDensity = 1,
) {
  if (typeof random !== "function") {
    throw new Error("generateMaze wymaga generatora random");
  }

  const min = inset;
  const max = size - inset;
  const walls = new Set();
  for (let row = min; row < max; row += 1) {
    for (let col = min; col < max; col += 1) {
      walls.add(cellKey(row, col));
    }
  }

  const visited = new Set();
  const steps = [
    { row: -2, col: 0 },
    { row: 2, col: 0 },
    { row: 0, col: -2 },
    { row: 0, col: 2 },
  ];

  function carve(row, col) {
    visited.add(cellKey(row, col));
    walls.delete(cellKey(row, col));

    for (const step of shuffle(steps, random)) {
      const nextRow = row + step.row;
      const nextCol = col + step.col;
      if (
        nextRow < min ||
        nextCol < min ||
        nextRow >= max ||
        nextCol >= max ||
        visited.has(cellKey(nextRow, nextCol))
      ) {
        continue;
      }

      walls.delete(cellKey(row + step.row / 2, col + step.col / 2));
      carve(nextRow, nextCol);
    }
  }

  carve(alignToLattice(start.row, min), alignToLattice(start.col, min));
  walls.delete(cellKey(start.row, start.col));

  if (wallDensity > 1) {
    // Gęściej: dosadzamy bloki w wolnych polach, ale zostawiamy rogi dla graczy.
    const extra = Math.min(1, (wallDensity - 1) * 0.5);
    const reserve = 4;
    for (let row = min; row < max; row += 1) {
      for (let col = min; col < max; col += 1) {
        const key = cellKey(row, col);
        const nearCornerRow = row < min + reserve || row >= max - reserve;
        const nearCornerCol = col < min + reserve || col >= max - reserve;
        if (walls.has(key) || (nearCornerRow && nearCornerCol)) {
          continue;
        }
        if (random() < extra) {
          walls.add(key);
        }
      }
    }
  }

  const kept =
    wallDensity >= 1
      ? [...walls]
      : [...walls].filter(() => random() < wallDensity);

  return kept.map((key) => {
    const [row, col] = key.split(",").map(Number);
    const type = wallType(random);
    return { row, col, type };
  });
}

export function renderWall(row, col, walls) {
  return walls.some((wall) => wall.row === row && wall.col === col);
}

export function checkCollision(position, walls) {
  return renderWall(position.row, position.col, walls);
}
