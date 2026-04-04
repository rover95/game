const BOARD_SIZE = 4;
const MOVE_DURATION_MS = 190;
const EFFECT_DURATION_MS = 460;
const BEST_SCORE_KEY = "impact-cubes-best-score";

const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const gridLayerEl = document.getElementById("grid-layer");
const tileLayerEl = document.getElementById("tile-layer");
const effectLayerEl = document.getElementById("effect-layer");
const boardEl = document.getElementById("game-board");
const messageLayerEl = document.getElementById("message-layer");
const messageTagEl = document.getElementById("message-tag");
const messageTitleEl = document.getElementById("message-title");
const messageBodyEl = document.getElementById("message-body");
const restartButtonEl = document.getElementById("restart");
const continueButtonEl = document.getElementById("continue");
const messageRestartButtonEl = document.getElementById("message-restart");

let state = null;
let isAnimating = false;
let transientTimer = null;
let overlayMode = null;

/**
 * Creates a new tile model with optional transient flags for render effects.
 * Params: `value` is the tile number, `row` and `col` are board coordinates.
 */
const createTile = (id, value, row, col, flags = {}) => ({
  id,
  value,
  row,
  col,
  justSpawned: Boolean(flags.justSpawned),
  justMerged: Boolean(flags.justMerged),
});

/**
 * Loads the saved best score while treating storage as optional.
 * Usage boundary: browsers without localStorage simply fall back to zero.
 */
const loadBestScore = () => {
  try {
    return Number(window.localStorage.getItem(BEST_SCORE_KEY)) || 0;
  } catch (error) {
    return 0;
  }
};

/**
 * Persists the best score when storage is available.
 * Param: `value` must already be a validated non-negative integer score.
 */
const saveBestScore = (value) => {
  try {
    window.localStorage.setItem(BEST_SCORE_KEY, String(value));
  } catch (error) {
    // Ignore storage failures; gameplay does not depend on persistence.
  }
};

/**
 * Builds a fresh game state and seeds it with two random tiles.
 * Usage boundary: this is the only initializer used by restart and first boot.
 */
const createInitialState = () => {
  const draft = {
    size: BOARD_SIZE,
    score: 0,
    best: loadBestScore(),
    won: false,
    continued: false,
    over: false,
    nextId: 1,
    tiles: [],
  };

  const withFirstTile = addRandomTile(draft);
  return addRandomTile(withFirstTile);
};

/**
 * Returns all empty board coordinates for the current tile set.
 * Param: `tiles` is the canonical tile list for the board.
 */
const getEmptyCells = (tiles) => {
  const occupied = new Set(tiles.map((tile) => `${tile.row}:${tile.col}`));
  const cells = [];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (!occupied.has(`${row}:${col}`)) {
        cells.push({ row, col });
      }
    }
  }

  return cells;
};

/**
 * Adds a random 2 or 4 tile to the provided state.
 * Usage boundary: call only after a legal move or during initial setup.
 */
const addRandomTile = (sourceState) => {
  const emptyCells = getEmptyCells(sourceState.tiles);

  if (emptyCells.length === 0) {
    return sourceState;
  }

  const index = Math.floor(Math.random() * emptyCells.length);
  const { row, col } = emptyCells[index];
  const value = Math.random() < 0.9 ? 2 : 4;
  const newTile = createTile(sourceState.nextId, value, row, col, { justSpawned: true });

  return {
    ...sourceState,
    nextId: sourceState.nextId + 1,
    tiles: [...sourceState.tiles, newTile],
  };
};

/**
 * Projects board coordinates into a normalized line/offset pair for move logic.
 * Params: `tile` is the source tile, `direction` is one of left/right/up/down.
 */
const projectTile = (tile, direction) => {
  switch (direction) {
    case "left":
      return { line: tile.row, offset: tile.col };
    case "right":
      return { line: tile.row, offset: BOARD_SIZE - 1 - tile.col };
    case "up":
      return { line: tile.col, offset: tile.row };
    case "down":
      return { line: tile.col, offset: BOARD_SIZE - 1 - tile.row };
    default:
      throw new Error(`Unsupported direction: ${direction}`);
  }
};

/**
 * Converts normalized move coordinates back into board row/col positions.
 * Params: `line` and `offset` must come from the normalized move pipeline.
 */
const restoreCoord = (line, offset, direction) => {
  switch (direction) {
    case "left":
      return { row: line, col: offset };
    case "right":
      return { row: line, col: BOARD_SIZE - 1 - offset };
    case "up":
      return { row: offset, col: line };
    case "down":
      return { row: BOARD_SIZE - 1 - offset, col: line };
    default:
      throw new Error(`Unsupported direction: ${direction}`);
  }
};

/**
 * Checks whether at least one legal move still exists.
 * Usage boundary: call against a stable post-move tile list, not an animation frame.
 */
const canMove = (tiles) => {
  if (tiles.length < BOARD_SIZE * BOARD_SIZE) {
    return true;
  }

  const tileMap = new Map(tiles.map((tile) => [`${tile.row}:${tile.col}`, tile.value]));

  for (const tile of tiles) {
    const right = tileMap.get(`${tile.row}:${tile.col + 1}`);
    const down = tileMap.get(`${tile.row + 1}:${tile.col}`);

    if (right === tile.value || down === tile.value) {
      return true;
    }
  }

  return false;
};

/**
 * Maps tile values to a layered color palette for the cube faces.
 * Param: `value` can exceed 2048, so fallback colors are generated dynamically.
 */
const getTilePalette = (value) => {
  const fixedPalette = {
    2: ["#f8eee0", "#fff7ee", "#e7cbb1", "#5d4a3d", "rgba(111, 79, 55, 0.2)"],
    4: ["#f7dfbf", "#fff0d2", "#e5bb8d", "#634633", "rgba(138, 92, 53, 0.22)"],
    8: ["#f4b47f", "#ffd1a6", "#d98a56", "#43240d", "rgba(191, 102, 43, 0.28)"],
    16: ["#f28b63", "#ffb28b", "#cd5b39", "#fff3eb", "rgba(196, 84, 52, 0.3)"],
    32: ["#ef6a58", "#ff998f", "#c74533", "#fff4f3", "rgba(204, 74, 54, 0.32)"],
    64: ["#e74a5d", "#ff7f8f", "#bb2640", "#fff2f5", "rgba(183, 43, 74, 0.34)"],
    128: ["#e9b446", "#ffd86b", "#ca9223", "#3b2a03", "rgba(205, 150, 41, 0.34)"],
    256: ["#d7d043", "#f4ee6d", "#abb12e", "#293000", "rgba(180, 191, 54, 0.34)"],
    512: ["#8fd95f", "#b2f487", "#5db33a", "#13300a", "rgba(94, 176, 62, 0.34)"],
    1024: ["#42d2bf", "#78f1e4", "#1ca494", "#032822", "rgba(34, 171, 155, 0.34)"],
    2048: ["#2eb7d3", "#82ecff", "#188ea6", "#01232d", "rgba(34, 163, 190, 0.36)"],
  };

  if (fixedPalette[value]) {
    const [front, top, side, text, shadow] = fixedPalette[value];
    return { front, top, side, text, shadow };
  }

  const power = Math.log2(value);
  const hue = 190 + ((power - 11) * 17) % 120;
  return {
    front: `hsl(${hue} 72% 55%)`,
    top: `hsl(${hue} 82% 72%)`,
    side: `hsl(${hue} 68% 38%)`,
    text: "#041318",
    shadow: `hsla(${hue} 76% 34% / 0.34)`,
  };
};

/**
 * Produces the CSS translate expression for a board coordinate.
 * Params: `row` and `col` are zero-based board positions.
 */
const tileTranslate = (row, col) =>
  `translate(calc(var(--board-pad) + ${col} * (var(--cell-size) + var(--gap))), calc(var(--board-pad) + ${row} * (var(--cell-size) + var(--gap))))`;

/**
 * Builds the static recessed grid cells once on startup.
 * Usage boundary: only called during init because the board size is fixed.
 */
const renderGrid = () => {
  const fragment = document.createDocumentFragment();

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const cell = document.createElement("div");
      cell.className = "grid-cell";
      cell.style.transform = tileTranslate(row, col);
      fragment.appendChild(cell);
    }
  }

  gridLayerEl.appendChild(fragment);
};

/**
 * Builds a full move plan, including animated source tiles and final board state.
 * Param: `direction` must already be normalized to left/right/up/down.
 */
const buildMovePlan = (sourceState, direction) => {
  const projected = sourceState.tiles.map((tile) => ({
    tile,
    ...projectTile(tile, direction),
  }));

  const animatedTiles = [];
  const placements = [];
  const mergeEvents = [];
  let moved = false;
  let scoreGain = 0;

  for (let lineIndex = 0; lineIndex < BOARD_SIZE; lineIndex += 1) {
    const lineTiles = projected
      .filter((item) => item.line === lineIndex)
      .sort((a, b) => a.offset - b.offset);

    const linePlacements = [];

    for (const item of lineTiles) {
      const previousPlacement = linePlacements[linePlacements.length - 1];

      if (previousPlacement && !previousPlacement.locked && previousPlacement.value === item.tile.value) {
        animatedTiles.push({
          ...item.tile,
          targetRow: previousPlacement.target.row,
          targetCol: previousPlacement.target.col,
          movingMerge: true,
        });

        previousPlacement.locked = true;
        previousPlacement.value *= 2;
        previousPlacement.sourceIds.push(item.tile.id);
        previousPlacement.merged = true;
        continue;
      }

      const target = restoreCoord(lineIndex, linePlacements.length, direction);

      animatedTiles.push({
        ...item.tile,
        targetRow: target.row,
        targetCol: target.col,
        movingMerge: false,
      });

      linePlacements.push({
        target,
        value: item.tile.value,
        sourceIds: [item.tile.id],
        originalId: item.tile.id,
        merged: false,
        locked: false,
      });
    }

    placements.push(...linePlacements);
  }

  const mergeSourceIds = new Set(
    placements.flatMap((placement) => (placement.merged ? placement.sourceIds : [])),
  );

  for (const animatedTile of animatedTiles) {
    if (
      animatedTile.row !== animatedTile.targetRow ||
      animatedTile.col !== animatedTile.targetCol ||
      mergeSourceIds.has(animatedTile.id)
    ) {
      moved = true;
    }
  }

  if (!moved) {
    return null;
  }

  let nextId = sourceState.nextId;
  const resultTiles = placements.map((placement) => {
    if (placement.merged) {
      scoreGain += placement.value;
      mergeEvents.push({
        row: placement.target.row,
        col: placement.target.col,
        value: placement.value,
      });

      const mergedTile = createTile(nextId, placement.value, placement.target.row, placement.target.col, {
        justMerged: true,
      });
      nextId += 1;
      return mergedTile;
    }

    return createTile(placement.originalId, placement.value, placement.target.row, placement.target.col);
  });

  const best = Math.max(sourceState.best, sourceState.score + scoreGain);
  const afterMergeState = {
    ...sourceState,
    tiles: resultTiles,
    score: sourceState.score + scoreGain,
    best,
    nextId,
  };

  const withSpawn = addRandomTile(afterMergeState);
  const wonNow = !sourceState.won && withSpawn.tiles.some((tile) => tile.value >= 2048);
  const over = !canMove(withSpawn.tiles);

  return {
    animatedTiles,
    mergeEvents,
    resultState: {
      ...withSpawn,
      won: sourceState.won || wonNow,
      over,
    },
    wonNow,
  };
};

/**
 * Renders the current or animated tile collection into the tile layer.
 * Param: `options.animateFromSource` enables source-to-target interpolation.
 */
const renderTiles = (tiles, options = {}) => {
  tileLayerEl.innerHTML = "";
  const fragment = document.createDocumentFragment();
  const deferredMoves = [];

  tiles.forEach((tile) => {
    const palette = getTilePalette(tile.value);
    const tileEl = document.createElement("div");
    const digits = String(tile.value).length;
    const targetRow = tile.targetRow ?? tile.row;
    const targetCol = tile.targetCol ?? tile.col;
    const initialRow = options.animateFromSource ? tile.row : targetRow;
    const initialCol = options.animateFromSource ? tile.col : targetCol;

    tileEl.className = "tile";
    tileEl.dataset.id = String(tile.id);
    tileEl.dataset.digits = String(digits);
    tileEl.style.setProperty("--tile-x", `calc(var(--board-pad) + ${targetCol} * (var(--cell-size) + var(--gap)))`);
    tileEl.style.setProperty("--tile-y", `calc(var(--board-pad) + ${targetRow} * (var(--cell-size) + var(--gap)))`);
    tileEl.style.transform = `${tileTranslate(initialRow, initialCol)} translateZ(0) scale(1)`;
    tileEl.style.setProperty("--tile-front", palette.front);
    tileEl.style.setProperty("--tile-front-deep", palette.side);
    tileEl.style.setProperty("--tile-top", palette.top);
    tileEl.style.setProperty("--tile-side", palette.side);
    tileEl.style.setProperty("--tile-text", palette.text);
    tileEl.style.setProperty("--tile-shadow", palette.shadow);
    tileEl.style.zIndex = String(20 + Math.max(tile.row, targetRow) * BOARD_SIZE + Math.max(tile.col, targetCol));

    if (tile.justSpawned) {
      tileEl.classList.add("tile--spawn");
    }

    if (tile.justMerged) {
      tileEl.classList.add("tile--merge");
    }

    if (tile.movingMerge) {
      tileEl.classList.add("tile--moving-merge");
    }

    const bodyEl = document.createElement("div");
    bodyEl.className = "tile__body";

    const topFaceEl = document.createElement("div");
    topFaceEl.className = "tile__face tile__face--top";

    const sideFaceEl = document.createElement("div");
    sideFaceEl.className = "tile__face tile__face--side";

    const frontFaceEl = document.createElement("div");
    frontFaceEl.className = "tile__face tile__face--front";

    const numberEl = document.createElement("div");
    numberEl.className = "tile__number";
    numberEl.textContent = String(tile.value);

    bodyEl.appendChild(topFaceEl);
    bodyEl.appendChild(sideFaceEl);
    bodyEl.appendChild(frontFaceEl);
    bodyEl.appendChild(numberEl);
    tileEl.appendChild(bodyEl);
    fragment.appendChild(tileEl);

    if (options.animateFromSource) {
      deferredMoves.push({
        element: tileEl,
        transform: `${tileTranslate(targetRow, targetCol)} translateZ(0) scale(1)`,
      });
    }
  });

  tileLayerEl.appendChild(fragment);

  if (options.animateFromSource && deferredMoves.length > 0) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        deferredMoves.forEach(({ element, transform }) => {
          element.style.transform = transform;
        });
      });
    });
  }
};

/**
 * Updates the numeric HUD and stores any new best score.
 * Usage boundary: call after every state commit so the UI stays canonical.
 */
const renderHud = () => {
  scoreEl.textContent = String(state.score);
  bestEl.textContent = String(state.best);
  saveBestScore(state.best);
};

/**
 * Controls the overlay state for win and game-over moments.
 * Param: `mode` is null, `win`, or `game-over`.
 */
const renderOverlay = (mode) => {
  overlayMode = mode;
  const hidden = mode === null;
  messageLayerEl.classList.toggle("is-hidden", hidden);

  if (hidden) {
    return;
  }

  if (mode === "win") {
    messageTagEl.textContent = "Impact Achieved";
    messageTitleEl.textContent = "2048 已达成";
    messageBodyEl.textContent = "你已经打出了 2048。可以继续冲高分，也可以直接再开一局。";
    continueButtonEl.hidden = false;
  } else {
    messageTagEl.textContent = "No Moves Left";
    messageTitleEl.textContent = "棋盘锁死了";
    messageBodyEl.textContent = "当前已经没有合法移动方向。重开后再试一次更高效率的合并路线。";
    continueButtonEl.hidden = true;
  }
};

/**
 * Renders the stable committed game state and schedules transient cleanup.
 * Usage boundary: use this after state commits, not during move interpolation.
 */
const renderState = () => {
  renderTiles(state.tiles);
  renderHud();

  if (state.over) {
    renderOverlay("game-over");
  } else if (state.won && !state.continued) {
    renderOverlay("win");
  } else {
    renderOverlay(null);
  }

  window.clearTimeout(transientTimer);
  transientTimer = window.setTimeout(() => {
    const needsCleanup = state.tiles.some((tile) => tile.justSpawned || tile.justMerged);

    if (!needsCleanup) {
      return;
    }

    state = {
      ...state,
      tiles: state.tiles.map((tile) => ({
        ...tile,
        justSpawned: false,
        justMerged: false,
      })),
    };

    renderTiles(state.tiles);
  }, 280);
};

/**
 * Resolves the center point for a given board coordinate in effect-layer pixels.
 * Params: `row` and `col` are zero-based board positions on the main board.
 */
const getCellCenter = (row, col) => {
  const styles = getComputedStyle(boardEl);
  const cellSize = Number.parseFloat(styles.getPropertyValue("--cell-size"));
  const gap = Number.parseFloat(styles.getPropertyValue("--gap"));
  const pad = Number.parseFloat(styles.getPropertyValue("--board-pad"));
  const depth = Number.parseFloat(styles.getPropertyValue("--tile-depth"));

  return {
    x: pad + col * (cellSize + gap) + (cellSize - depth) / 2,
    y: pad + row * (cellSize + gap) + (cellSize - depth) / 2,
  };
};

/**
 * Emits the merge collision spray and a short board punch effect.
 * Param: `event` contains the merged tile row, col, and value.
 */
const spawnMergeBurst = (event) => {
  const center = getCellCenter(event.row, event.col);
  const palette = getTilePalette(event.value);

  const ring = document.createElement("div");
  ring.className = "merge-ring";
  ring.style.left = `${center.x}px`;
  ring.style.top = `${center.y}px`;
  ring.style.color = palette.top;
  effectLayerEl.appendChild(ring);

  ring.animate(
    [
      { transform: "scale(0.2)", opacity: 0.86 },
      { transform: "scale(2.9)", opacity: 0 },
    ],
    {
      duration: EFFECT_DURATION_MS,
      easing: "cubic-bezier(0.12, 0.76, 0.22, 1)",
      fill: "forwards",
    },
  ).finished.finally(() => ring.remove());

  for (let index = 0; index < 12; index += 1) {
    const particle = document.createElement("div");
    const angle = (Math.PI * 2 * index) / 12 + (Math.random() - 0.5) * 0.26;
    const distance = 28 + Math.random() * 34;
    const size = 5 + Math.random() * 9;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;

    particle.className = "merge-particle";
    particle.style.left = `${center.x}px`;
    particle.style.top = `${center.y}px`;
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.marginLeft = `${size / -2}px`;
    particle.style.marginTop = `${size / -2}px`;
    particle.style.color = index % 2 === 0 ? palette.top : palette.front;
    effectLayerEl.appendChild(particle);

    particle.animate(
      [
        { transform: "translate(0px, 0px) scale(0.8)", opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.2)`, opacity: 0 },
      ],
      {
        duration: EFFECT_DURATION_MS - 40 + Math.random() * 90,
        easing: "cubic-bezier(0.08, 0.7, 0.18, 1)",
        fill: "forwards",
      },
    ).finished.finally(() => particle.remove());
  }

  boardEl.animate(
    [
      { transform: "perspective(1600px) rotateX(16deg) rotateZ(-9deg) scale(1)" },
      { transform: "perspective(1600px) rotateX(17deg) rotateZ(-8.2deg) scale(1.022)" },
      { transform: "perspective(1600px) rotateX(16deg) rotateZ(-9deg) scale(1)" },
    ],
    {
      duration: 260,
      easing: "cubic-bezier(0.2, 0.9, 0.3, 1)",
    },
  );
};

/**
 * Runs one full move cycle, including interpolation, commit, and impact effects.
 * Param: `direction` must be left/right/up/down and is ignored during animations.
 */
const move = (direction) => {
  if (isAnimating || overlayMode === "game-over") {
    return;
  }

  const plan = buildMovePlan(state, direction);

  if (!plan) {
    boardEl.animate(
      [
        { transform: "perspective(1600px) rotateX(16deg) rotateZ(-9deg) translateX(0px)" },
        { transform: "perspective(1600px) rotateX(16deg) rotateZ(-9deg) translateX(-6px)" },
        { transform: "perspective(1600px) rotateX(16deg) rotateZ(-9deg) translateX(4px)" },
        { transform: "perspective(1600px) rotateX(16deg) rotateZ(-9deg) translateX(0px)" },
      ],
      { duration: 180, easing: "ease-out" },
    );
    return;
  }

  isAnimating = true;
  window.clearTimeout(transientTimer);
  renderTiles(plan.animatedTiles, { animateFromSource: true });

  window.setTimeout(() => {
    state = plan.resultState;
    renderState();
    plan.mergeEvents.forEach(spawnMergeBurst);
    isAnimating = false;
  }, MOVE_DURATION_MS);
};

/**
 * Maps keyboard input to movement directions and suppresses page scrolling.
 * Usage boundary: bound once at startup on the window object.
 */
const handleKeydown = (event) => {
  const directionMap = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    a: "left",
    d: "right",
    w: "up",
    s: "down",
  };

  const direction = directionMap[event.key] ?? directionMap[event.key.toLowerCase()];

  if (!direction) {
    return;
  }

  event.preventDefault();

  if (overlayMode === "win") {
    state = {
      ...state,
      continued: true,
    };
    renderOverlay(null);
  }

  move(direction);
};

/**
 * Resets the match and redraws the entire interface from scratch.
 * Usage boundary: shared by all restart buttons for consistent reset behavior.
 */
const restartGame = () => {
  isAnimating = false;
  overlayMode = null;
  window.clearTimeout(transientTimer);
  effectLayerEl.innerHTML = "";
  state = createInitialState();
  renderState();
};

/**
 * Wires event listeners and performs the initial render.
 * Usage boundary: entry point for this standalone browser implementation.
 */
const init = () => {
  renderGrid();
  restartButtonEl.addEventListener("click", restartGame);
  messageRestartButtonEl.addEventListener("click", restartGame);
  continueButtonEl.addEventListener("click", () => {
    state = {
      ...state,
      continued: true,
    };
    renderState();
  });
  window.addEventListener("keydown", handleKeydown, { passive: false });
  restartGame();
};

init();
