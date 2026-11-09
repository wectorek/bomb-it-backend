import { renderBorder } from "./border.js";
import { isBombAt } from "./bomb.js";
import { checkCollision } from "./maze.js";

export function cellAfterStep(position, direction) {
  return {
    row: position.row + direction.row,
    col: position.col + direction.col,
  };
}

export function facingFromDirection(direction) {
  if (direction.row < 0) return "up";
  if (direction.row > 0) return "down";
  if (direction.col < 0) return "left";
  return "right";
}

export function isPlayerStepBlocked(
  cell,
  walls,
  borders,
  bomb,
  { blockWalls, blockBombs },
) {
  const hitsWall = blockWalls && checkCollision(cell, walls);
  const hitsBorder = renderBorder(cell.row, cell.col, borders);
  const hitsBomb = blockBombs && isBombAt(cell, bomb);
  return hitsWall || hitsBorder || hitsBomb;
}

export function unitDirection(direction) {
  if (!direction || typeof direction !== "object") {
    return null;
  }
  const row = direction.row;
  const col = direction.col;
  const straight =
    (row === -1 || row === 0 || row === 1) &&
    (col === -1 || col === 0 || col === 1) &&
    Math.abs(row) + Math.abs(col) === 1;
  return straight ? { row, col } : null;
}
