import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../game/constants.js";
import { cellCenter, keyOfCell } from "../game/utils.js";

export const PATH_CELLS = [
  { x: 0, y: 4 }, { x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 },
  { x: 3, y: 3 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }, { x: 6, y: 2 },
  { x: 6, y: 3 }, { x: 6, y: 4 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 7, y: 6 },
  { x: 8, y: 6 }, { x: 9, y: 6 }, { x: 10, y: 6 }, { x: 10, y: 5 }, { x: 10, y: 4 },
  { x: 10, y: 3 }, { x: 11, y: 3 }, { x: 12, y: 3 }, { x: 13, y: 3 },
];

export const BUILD_CELLS = [
  { x: 1, y: 2 }, { x: 1, y: 6 }, { x: 2, y: 2 }, { x: 2, y: 6 }, { x: 3, y: 6 },
  { x: 4, y: 1 }, { x: 4, y: 4 }, { x: 4, y: 6 }, { x: 5, y: 1 }, { x: 5, y: 4 },
  { x: 5, y: 7 }, { x: 7, y: 1 }, { x: 7, y: 4 }, { x: 7, y: 7 }, { x: 8, y: 4 },
  { x: 8, y: 7 }, { x: 9, y: 2 }, { x: 9, y: 5 }, { x: 11, y: 1 }, { x: 11, y: 6 },
  { x: 12, y: 1 }, { x: 12, y: 5 },
];

export const PATH_SET = new Set(PATH_CELLS.map((cell) => keyOfCell(cell.x, cell.y)));
export const BUILD_SET = new Set(BUILD_CELLS.map((cell) => keyOfCell(cell.x, cell.y)));
export const PATH_POINTS = [
  { x: -38, y: cellCenter(PATH_CELLS[0]).y },
  ...PATH_CELLS.map(cellCenter),
  { x: CANVAS_WIDTH - 12, y: cellCenter(PATH_CELLS[PATH_CELLS.length - 1]).y },
];

export const SPAWN_CELL = PATH_CELLS[0];
export const CORE_CELL = PATH_CELLS[PATH_CELLS.length - 1];
export const PICKUP_TARGET = { x: CANVAS_WIDTH - 56, y: CANVAS_HEIGHT - 34 };
