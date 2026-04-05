import { GRID_OFFSET_X, GRID_OFFSET_Y, TILE_SIZE } from "./constants.js";

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const squaredDistance = (a, b) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};
export const chance = (value) => Math.random() < value;
export const keyOfCell = (x, y) => `${x},${y}`;
export const cellCenter = ({ x, y }) => ({
  x: GRID_OFFSET_X + x * TILE_SIZE + TILE_SIZE / 2,
  y: GRID_OFFSET_Y + y * TILE_SIZE + TILE_SIZE / 2,
});
export const cellRect = ({ x, y }) => ({
  x: GRID_OFFSET_X + x * TILE_SIZE,
  y: GRID_OFFSET_Y + y * TILE_SIZE,
  w: TILE_SIZE,
  h: TILE_SIZE,
});
export const worldToCell = (point) => ({
  x: Math.floor((point.x - GRID_OFFSET_X) / TILE_SIZE),
  y: Math.floor((point.y - GRID_OFFSET_Y) / TILE_SIZE),
});

export const sampleWithoutReplacement = (items, count) => {
  const pool = [...items];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, count);
};

export const describeModifier = (value, isPercent = true) => {
  if (isPercent) {
    return `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
  }
  return `${value >= 0 ? "+" : ""}${value}`;
};

export const formatSeconds = (seconds) => (seconds < 10 ? seconds.toFixed(1) : `${Math.max(0, Math.ceil(seconds))}`);
