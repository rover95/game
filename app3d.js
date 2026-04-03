import "./style.css";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const BOARD_SIZE = 4;
const CELL_SPACING = 1.52;
const TILE_SIZE = 1.05;
const TILE_HEIGHT = 0.62;
const STACK_STEP = TILE_HEIGHT * 1.04;
const STACK_RIGID_THRESHOLD = 4;
const BOARD_THICKNESS = 0.7;
const BOARD_PADDING = 0.78;
const FIXED_STEP = 1 / 90;
const MAX_PIXEL_RATIO = 1.35;
const SHADOW_MAP_SIZE = 1024;
const MERGE_DROP_HEIGHT = 1.35;
const DROPLET_COUNT = 5;
const BEST_SCORE_KEY = "impact-merge-2048-best";

const viewportEl = document.getElementById("viewport");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const restartButtonEl = document.getElementById("restart");
const continueButtonEl = document.getElementById("continue");
const overlayRestartButtonEl = document.getElementById("overlay-restart");
const overlayEl = document.getElementById("overlay");
const overlayTagEl = document.getElementById("overlay-tag");
const overlayTitleEl = document.getElementById("overlay-title");
const overlayBodyEl = document.getElementById("overlay-body");

const tileActors = new Map();
const labelTextureCache = new Map();
const tweens = [];
const mergeSimulations = [];
const droplets = [];

let state = null;
let inputLocked = false;
let overlayMode = null;
let stageImpulse = 0;
let stageTime = 0;

const directionVectors = {
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  up: new THREE.Vector3(0, 0, -1),
  down: new THREE.Vector3(0, 0, 1),
};

const scene = new THREE.Scene();
scene.background = new THREE.Color("#071119");
scene.fog = new THREE.FogExp2("#071119", 0.06);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 8.8, 5.8);
camera.lookAt(0, 0.3, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
viewportEl.appendChild(renderer.domElement);

const clock = new THREE.Clock();

const worldRoot = new THREE.Group();
const boardGroup = new THREE.Group();
const tilesGroup = new THREE.Group();
const effectsGroup = new THREE.Group();
const dropletsGroup = new THREE.Group();
scene.add(worldRoot);
worldRoot.add(boardGroup);
worldRoot.add(tilesGroup);
worldRoot.add(effectsGroup);
worldRoot.add(dropletsGroup);

const boardWidth = (BOARD_SIZE - 1) * CELL_SPACING + TILE_SIZE + BOARD_PADDING * 2;
const tileGeometry = new RoundedBoxGeometry(TILE_SIZE, TILE_HEIGHT, TILE_SIZE, 6, 0.16);
const slotGeometry = new RoundedBoxGeometry(TILE_SIZE * 1.02, 0.18, TILE_SIZE * 1.02, 4, 0.14);
const boardGeometry = new RoundedBoxGeometry(boardWidth, BOARD_THICKNESS, boardWidth, 10, 0.26);
const shadowGeometry = new THREE.CircleGeometry(TILE_SIZE * 0.48, 18);
const dropletGeometry = new THREE.SphereGeometry(0.05, 10, 10);
const STACK_VISUAL_STEP = TILE_HEIGHT * 0.56;
const MAX_RENDER_STACK_LAYERS = 6;

/**
 * Clamps logical stack counts into the number of rendered cube slices.
 * Param: `stackCount` is the logical merge stack size carried by one tile.
 */
const getVisibleLayerCount = (stackCount = 1) => Math.min(Math.max(stackCount, 1), MAX_RENDER_STACK_LAYERS);

/**
 * Returns the visible tower height used by labels, staging, and squash effects.
 * Param: `stackCount` is the logical merge stack size carried by one tile.
 */
const getTowerHeight = (stackCount = 1) => TILE_HEIGHT + (getVisibleLayerCount(stackCount) - 1) * STACK_VISUAL_STEP;

/**
 * Builds one rounded cube slice for a stacked tile actor.
 * Params: `bodyMaterial` and `edgeMaterial` are shared within one actor instance.
 */
const createStackLayer = (bodyMaterial, edgeMaterial, layerIndex) => {
  const tileMesh = new THREE.Mesh(tileGeometry, bodyMaterial);
  tileMesh.castShadow = true;
  tileMesh.receiveShadow = true;
  tileMesh.position.y = layerIndex * STACK_VISUAL_STEP;

  const edgeMesh = new THREE.Mesh(tileGeometry, edgeMaterial);
  edgeMesh.position.y = tileMesh.position.y + 0.02;
  edgeMesh.scale.setScalar(1.01);

  return { tileMesh, edgeMesh };
};

/**
 * Creates the static scene lighting for the fixed overhead camera.
 * Usage boundary: call once before adding dynamic tile actors.
 */
const setupStageLighting = () => {
  scene.add(new THREE.HemisphereLight("#dff8ff", "#071119", 1.4));

  const keyLight = new THREE.DirectionalLight("#f6fcff", 1.9);
  keyLight.position.set(4.8, 10, 3.2);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  keyLight.shadow.camera.left = -7;
  keyLight.shadow.camera.right = 7;
  keyLight.shadow.camera.top = 7;
  keyLight.shadow.camera.bottom = -7;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 24;
  scene.add(keyLight);

  const rimLight = new THREE.PointLight("#6be6ff", 24, 18, 2);
  rimLight.position.set(-4.4, 4.4, -3.2);
  scene.add(rimLight);

  const warmLift = new THREE.PointLight("#ff9b75", 18, 16, 2);
  warmLift.position.set(4.2, 2.8, 5.4);
  scene.add(warmLift);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(9.5, 48),
    new THREE.MeshBasicMaterial({ color: "#03080d", transparent: true, opacity: 0.4 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.35;
  ground.scale.set(1.2, 1, 1);
  worldRoot.add(ground);
};

/**
 * Converts board row/col coordinates into world-space tile centers.
 * Params: `row` and `col` must be valid zero-based board indices.
 */
const gridToWorld = (row, col, level = 0) => {
  const offset = ((BOARD_SIZE - 1) * CELL_SPACING) / 2;
  return new THREE.Vector3(
    col * CELL_SPACING - offset,
    TILE_HEIGHT * 0.5 + level * STACK_STEP,
    row * CELL_SPACING - offset,
  );
};

/**
 * Produces a stable lookup key for one board cell.
 * Params: `row` and `col` must be zero-based board coordinates.
 */
const getCellKey = (row, col) => `${row}:${col}`;

/**
 * Counts how many tiles belong to each board cell in a snapshot.
 * Param: `tiles` is the canonical board tile collection.
 */
const buildCellStackSizeMap = (tiles) => tiles.reduce((sizes, tile) => {
  const key = getCellKey(tile.row, tile.col);
  sizes.set(key, (sizes.get(key) ?? 0) + 1);
  return sizes;
}, new Map());

/**
 * Maps tile values to the palette used by solid meshes, labels, and liquid effects.
 * Usage boundary: supports arbitrary powers of two beyond 2048 with a generated fallback hue.
 */
const getPalette = (value) => {
  const fixed = {
    2: { body: "#efe8dd", edge: "#fffef8", label: "#46372c", emissive: "#6c584a", liquid: "#f8efe1" },
    4: { body: "#f1dbbd", edge: "#fff5e2", label: "#473527", emissive: "#79624b", liquid: "#f6dec0" },
    8: { body: "#f4b176", edge: "#ffd5aa", label: "#2d1808", emissive: "#ad6a2c", liquid: "#f6c08e" },
    16: { body: "#f0885f", edge: "#ffc29e", label: "#fff6ef", emissive: "#cc5f36", liquid: "#f5a07f" },
    32: { body: "#ea6657", edge: "#ff9b92", label: "#fff6f4", emissive: "#d44d40", liquid: "#ee7d6d" },
    64: { body: "#e94855", edge: "#ff8498", label: "#fff2f4", emissive: "#d22e3d", liquid: "#ed5f71" },
    128: { body: "#d3a73f", edge: "#ffd86e", label: "#1f1703", emissive: "#ac8025", liquid: "#e5bf59" },
    256: { body: "#c7c841", edge: "#f3f56d", label: "#1a2005", emissive: "#9ca22d", liquid: "#dadd58" },
    512: { body: "#78c85b", edge: "#b2f288", label: "#0c1907", emissive: "#4e9c34", liquid: "#92da75" },
    1024: { body: "#34c9ba", edge: "#8af6eb", label: "#041614", emissive: "#229b8f", liquid: "#65ded2" },
    2048: { body: "#2aaeda", edge: "#8de9ff", label: "#041017", emissive: "#1d7ea5", liquid: "#69d9f7" },
  };

  if (fixed[value]) {
    return fixed[value];
  }

  const power = Math.log2(value);
  const hue = 190 + ((power - 11) * 17) % 130;
  return {
    body: new THREE.Color().setHSL(hue / 360, 0.72, 0.58).getStyle(),
    edge: new THREE.Color().setHSL(hue / 360, 0.8, 0.77).getStyle(),
    label: "#041018",
    emissive: new THREE.Color().setHSL(hue / 360, 0.66, 0.34).getStyle(),
    liquid: new THREE.Color().setHSL(hue / 360, 0.74, 0.66).getStyle(),
  };
};

/**
 * Draws a numeric label into a cached canvas texture.
 * Params: `value` is the tile number, `color` is the text fill color.
 */
const getLabelTexture = (value, color) => {
  const cacheKey = `${value}:${color}`;
  if (labelTextureCache.has(cacheKey)) {
    return labelTextureCache.get(cacheKey);
  }

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  const digits = String(value).length;
  const fontSize = digits >= 5 ? 172 : digits >= 4 ? 210 : digits >= 3 ? 240 : 280;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `900 ${fontSize}px "Segoe UI", sans-serif`;
  context.fillStyle = color;
  context.shadowColor = "rgba(255,255,255,0.16)";
  context.shadowBlur = 12;
  context.fillText(String(value), canvas.width / 2, canvas.height / 2 - 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  labelTextureCache.set(cacheKey, texture);
  return texture;
};

/**
 * Creates the board base and recessed slots.
 * Usage boundary: static geometry only; keep game state out of this method.
 */
const createBoard = () => {
  const boardMesh = new THREE.Mesh(
    boardGeometry,
    new THREE.MeshStandardMaterial({ color: "#12313d", roughness: 0.44, metalness: 0.18 }),
  );
  boardMesh.position.y = -BOARD_THICKNESS / 2;
  boardMesh.receiveShadow = true;
  boardMesh.castShadow = true;
  boardGroup.add(boardMesh);

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const slot = new THREE.Mesh(
        slotGeometry,
        new THREE.MeshStandardMaterial({ color: "#0b1d26", roughness: 0.82, metalness: 0.04 }),
      );
      slot.position.copy(gridToWorld(row, col));
      slot.position.y = -0.03;
      slot.receiveShadow = true;
      boardGroup.add(slot);
    }
  }
};

/**
 * Creates a full render actor for one logical tile using stacked cube slices.
 * Param: `appearMode` controls whether the tile pops as a spawn or a merge result.
 */
const createTileActor = (tile, appearMode = "idle") => {
  const palette = getPalette(tile.value);
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: palette.body,
    emissive: palette.emissive,
    emissiveIntensity: tile.value >= 128 ? 0.2 : 0.1,
    roughness: 0.28,
    metalness: 0.14,
    clearcoat: 0.2,
    clearcoatRoughness: 0.24,
  });
  const edgeMaterial = new THREE.MeshBasicMaterial({ color: palette.edge, transparent: true, opacity: 0.12 });

  const stackRoot = new THREE.Group();
  const layerMeshes = [];
  for (let layerIndex = 0; layerIndex < getVisibleLayerCount(tile.stackCount); layerIndex += 1) {
    const layer = createStackLayer(bodyMaterial, edgeMaterial, layerIndex);
    stackRoot.add(layer.tileMesh);
    stackRoot.add(layer.edgeMesh);
    layerMeshes.push(layer);
  }

  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getLabelTexture(tile.value, palette.label),
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }),
  );
  label.scale.set(0.74, 0.74, 0.74);
  label.renderOrder = 10;

  const shadow = new THREE.Mesh(
    shadowGeometry,
    new THREE.MeshBasicMaterial({ color: "#02070a", transparent: true, opacity: 0.24 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -TILE_HEIGHT * 0.5 + 0.02;
  shadow.scale.set(1.12, 1.12, 1.12);

  const group = new THREE.Group();
  group.position.copy(gridToWorld(tile.row, tile.col));
  group.add(shadow);
  group.add(stackRoot);
  group.add(label);
  tilesGroup.add(group);

  const actor = { tile, group, stackRoot, layerMeshes, bodyMaterial, edgeMaterial, label, shadow };
  tileActors.set(tile.id, actor);
  updateActorStackVisual(actor, tile.stackCount ?? 1);

  if (appearMode !== "idle") {
    group.scale.setScalar(0.001);
    animateScale(group, appearMode === "merge" ? 0.28 : 0.22, appearMode === "merge" ? 1.18 : 1.08);
  }

  return actor;
};

/**
 * Adjusts tower height, slice count, and top label placement for one logical tile.
 * Params: `actor` is a tile render actor, `stackCount` is its logical merged layer count.
 */
const updateActorStackVisual = (actor, stackCount = 1) => {
  const visibleLayers = getVisibleLayerCount(stackCount);
  const towerHeight = getTowerHeight(stackCount);
  const widthBoost = Math.min((stackCount - 1) * 0.02, 0.12);
  const labelBoost = 1 + Math.min((stackCount - 1) * 0.07, 0.35);

  while (actor.layerMeshes.length < visibleLayers) {
    const layer = createStackLayer(actor.bodyMaterial, actor.edgeMaterial, actor.layerMeshes.length);
    actor.stackRoot.add(layer.tileMesh);
    actor.stackRoot.add(layer.edgeMesh);
    actor.layerMeshes.push(layer);
  }

  actor.layerMeshes.forEach((layer, index) => {
    const visible = index < visibleLayers;
    layer.tileMesh.visible = visible;
    layer.edgeMesh.visible = visible;
    layer.tileMesh.position.y = index * STACK_VISUAL_STEP;
    layer.edgeMesh.position.y = layer.tileMesh.position.y + 0.02;
  });

  actor.stackRoot.scale.set(1 + widthBoost, 1, 1 + widthBoost);
  actor.label.scale.set(0.74 * labelBoost, 0.74 * labelBoost, 0.74 * labelBoost);
  actor.label.position.set(0, towerHeight * 0.72 + 0.36, 0);
  actor.shadow.visible = true;
  actor.shadow.scale.setScalar(1.12 + widthBoost * 0.6);
};

/**
 * Removes an actor and disposes its GPU resources.
 * Param: `tileId` must correspond to an existing render actor or it is ignored.
 */
const removeTileActor = (tileId) => {
  const actor = tileActors.get(tileId);
  if (!actor) {
    return;
  }

  actor.group.removeFromParent();
  actor.bodyMaterial.dispose();
  actor.edgeMaterial.dispose();
  actor.label.material.dispose();
  actor.shadow.material.dispose();
  tileActors.delete(tileId);
};

/**
 * Reconciles rendered tile actors with the current committed board state.
 * Usage boundary: call only after a move has fully resolved.
 */
const syncActorsToState = (nextState) => {
  const nextIds = new Set(nextState.tiles.map((tile) => tile.id));

  Array.from(tileActors.keys()).forEach((tileId) => {
    if (!nextIds.has(tileId)) {
      removeTileActor(tileId);
    }
  });

  nextState.tiles.forEach((tile) => {
    const actor = tileActors.get(tile.id);
    if (!actor) {
      createTileActor(tile, tile.justMerged ? "merge" : tile.justSpawned ? "spawn" : "idle");
      return;
    }

    actor.tile = tile;
    actor.group.visible = true;
    actor.group.scale.setScalar(1);
    actor.group.position.copy(gridToWorld(tile.row, tile.col));
    updateActorStackVisual(actor, tile.stackCount ?? 1);
  });
};

/**
 * Creates a logical 2048 tile model plus transient render flags.
 * Params: `value`, `row`, and `col` define the stable board position of the tile.
 */
const createTile = (id, value, row, col, flags = {}) => ({
  id,
  value,
  row,
  col,
  stackCount: flags.stackCount ?? 1,
  justSpawned: Boolean(flags.justSpawned),
  justMerged: Boolean(flags.justMerged),
});

/**
 * Loads the best score from localStorage without making persistence mandatory.
 * Usage boundary: storage failures should never interrupt play.
 */
const loadBestScore = () => {
  try {
    return Number(window.localStorage.getItem(BEST_SCORE_KEY)) || 0;
  } catch (error) {
    return 0;
  }
};

/**
 * Saves the best score after a successful state commit.
 * Param: `value` must already be a validated non-negative integer.
 */
const saveBestScore = (value) => {
  try {
    window.localStorage.setItem(BEST_SCORE_KEY, String(value));
  } catch (error) {
    // Persistence is optional and should not block gameplay.
  }
};

/**
 * Returns all empty cells for the provided tile set.
 * Param: `tiles` is the canonical tile collection of the board.
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
 * Appends a random 2 or 4 tile to a state snapshot.
 * Usage boundary: use only during initial setup or after a legal move.
 */
const addRandomTile = (sourceState) => {
  const emptyCells = getEmptyCells(sourceState.tiles);
  if (emptyCells.length === 0) {
    return sourceState;
  }

  const cell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
  const value = Math.random() < 0.9 ? 2 : 4;

  return {
    ...sourceState,
    nextId: sourceState.nextId + 1,
    tiles: [
      ...sourceState.tiles,
      createTile(sourceState.nextId, value, cell.row, cell.col, { stackCount: 1, justSpawned: true }),
    ],
  };
};

/**
 * Builds a fresh match state with the standard two opening tiles.
 * Usage boundary: shared by startup and all restart paths.
 */
const createInitialState = () => addRandomTile(addRandomTile({
  size: BOARD_SIZE,
  score: 0,
  best: loadBestScore(),
  won: false,
  continued: false,
  over: false,
  nextId: 1,
  tiles: [],
}));

/**
 * Projects a tile into the normalized line/offset space used by the 2048 solver.
 * Params: `tile` is a board tile, `direction` must be left/right/up/down.
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
 * Restores normalized move coordinates back into row/col board positions.
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
 * Checks whether the board still has at least one legal 2048 move.
 * Param: `tiles` is the canonical logical tile collection for one board state.
 */
const hasLegalMoves = (tiles) => {
  if (tiles.length < BOARD_SIZE * BOARD_SIZE) {
    return true;
  }

  const grid = new Map(tiles.map((tile) => [getCellKey(tile.row, tile.col), tile.value]));
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const value = grid.get(getCellKey(row, col));
      if (value === grid.get(getCellKey(row + 1, col)) || value === grid.get(getCellKey(row, col + 1))) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Computes the full result of a standard 2048 move with stacked visual metadata.
 * Param: `direction` must be one of the normalized movement directions.
 */
const buildMovePlan = (sourceState, direction) => {
  const projected = sourceState.tiles.map((tile) => ({ tile, ...projectTile(tile, direction) }));
  const resultTiles = [];
  const moveEntries = [];
  const mergePairs = [];
  let nextId = sourceState.nextId;
  let scoreGain = 0;
  let reached2048 = sourceState.won;

  for (let lineIndex = 0; lineIndex < BOARD_SIZE; lineIndex += 1) {
    const lineTiles = projected
      .filter((entry) => entry.line === lineIndex)
      .sort((a, b) => a.offset - b.offset);

    let sourceIndex = 0;
    let targetOffset = 0;

    while (sourceIndex < lineTiles.length) {
      const current = lineTiles[sourceIndex];
      const next = lineTiles[sourceIndex + 1];
      const target = restoreCoord(lineIndex, targetOffset, direction);

      if (next && next.tile.value === current.tile.value) {
        const mergedValue = current.tile.value * 2;
        const mergedStackCount = (current.tile.stackCount ?? 1) + (next.tile.stackCount ?? 1);

        moveEntries.push({
          id: current.tile.id,
          fromRow: current.tile.row,
          fromCol: current.tile.col,
          toRow: target.row,
          toCol: target.col,
        });
        moveEntries.push({
          id: next.tile.id,
          fromRow: next.tile.row,
          fromCol: next.tile.col,
          toRow: target.row,
          toCol: target.col,
        });
        mergePairs.push({
          sourceIds: [current.tile.id, next.tile.id],
          targetRow: target.row,
          targetCol: target.col,
          direction,
        });
        resultTiles.push(createTile(nextId, mergedValue, target.row, target.col, {
          stackCount: mergedStackCount,
          justMerged: true,
        }));

        nextId += 1;
        scoreGain += mergedValue;
        reached2048 = reached2048 || mergedValue >= 2048;
        sourceIndex += 2;
      } else {
        moveEntries.push({
          id: current.tile.id,
          fromRow: current.tile.row,
          fromCol: current.tile.col,
          toRow: target.row,
          toCol: target.col,
        });
        resultTiles.push(createTile(current.tile.id, current.tile.value, target.row, target.col, {
          stackCount: current.tile.stackCount ?? 1,
        }));
        sourceIndex += 1;
      }

      targetOffset += 1;
    }
  }

  const moved = mergePairs.length > 0 || moveEntries.some((entry) => (
    entry.fromRow !== entry.toRow ||
    entry.fromCol !== entry.toCol
  ));

  if (!moved) {
    return null;
  }

  const movedState = {
    ...sourceState,
    score: sourceState.score + scoreGain,
    best: Math.max(sourceState.best, sourceState.score + scoreGain),
    nextId,
    tiles: resultTiles,
  };
  const withSpawn = addRandomTile(movedState);

  return {
    moveEntries,
    mergePairs,
    resultState: {
      ...withSpawn,
      best: Math.max(sourceState.best, sourceState.score + scoreGain),
      won: reached2048,
      over: !hasLegalMoves(withSpawn.tiles),
    },
  };
};

/**
 * Updates the HUD and persists any newly achieved best score.
 * Usage boundary: call only after a committed state change.
 */
const renderHud = () => {
  scoreEl.textContent = String(state.score);
  bestEl.textContent = String(state.best);
  saveBestScore(state.best);
};

/**
 * Controls the overlay panel and its action availability.
 * Param: `mode` is either `null`, `win`, or `game-over`.
 */
const renderOverlay = (mode) => {
  overlayMode = mode;
  overlayEl.classList.toggle("hidden", mode === null);

  if (mode === null) {
    return;
  }

  if (mode === "win") {
    overlayTagEl.textContent = "Merge Complete";
    overlayTitleEl.textContent = "2048 已达成";
    overlayBodyEl.textContent = "当前已经打到 2048。你可以继续堆更大的数字，或者直接重开。";
    continueButtonEl.hidden = false;
  } else {
    overlayTagEl.textContent = "No Moves Left";
    overlayTitleEl.textContent = "棋盘锁死";
    overlayBodyEl.textContent = "当前没有任何合法移动。重新开局，再走一条更干净的合并路线。";
    continueButtonEl.hidden = true;
  }
};

/**
 * Refreshes the overlay strictly from the committed board state.
 * Usage boundary: centralize all win/lose decisions here after state transitions.
 */
const renderOverlayFromState = () => {
  if (state.won && !state.continued) {
    renderOverlay("win");
    return;
  }

  if (state.over) {
    renderOverlay("game-over");
    return;
  }

  renderOverlay(null);
};

/**
 * Creates a tween tracked by the global animation loop.
 * Params: `duration` is in seconds, `onUpdate` receives eased progress in [0, 1].
 */
const addTween = ({ duration, delay = 0, easing = (value) => value, onUpdate, onComplete }) => (
  new Promise((resolve) => {
    tweens.push({ elapsed: 0, delay, duration, easing, onUpdate, onComplete, resolve });
  })
);

/**
 * Drives all in-flight tweens from the render loop.
 * Param: `delta` is the frame delta time in seconds.
 */
const updateTweens = (delta) => {
  for (let index = tweens.length - 1; index >= 0; index -= 1) {
    const tween = tweens[index];
    tween.elapsed += delta;

    if (tween.elapsed < tween.delay) {
      continue;
    }

    const localTime = Math.min((tween.elapsed - tween.delay) / tween.duration, 1);
    tween.onUpdate?.(tween.easing(localTime), localTime);

    if (localTime >= 1) {
      tween.onComplete?.();
      tween.resolve();
      tweens.splice(index, 1);
    }
  }
};

/**
 * Animates a group's position to a target world coordinate.
 * Params: `group` is the tile actor group, `target` is the desired world position.
 */
const animatePosition = (group, target, duration = 0.12) => {
  const start = group.position.clone();
  return addTween({
    duration,
    easing: (value) => 1 - (1 - value) ** 3,
    onUpdate: (progress) => {
      group.position.lerpVectors(start, target, progress);
    },
  });
};

/**
 * Plays a short pop animation for newly spawned or newly merged tiles.
 * Params: `duration` is in seconds and `overshoot` is the peak scale.
 */
const animateScale = (group, duration, overshoot) => addTween({
  duration,
  easing: (value) => 1 - (1 - value) ** 3,
  onUpdate: (progress) => {
    const pulse = progress < 0.7
      ? THREE.MathUtils.lerp(0.001, overshoot, progress / 0.7)
      : THREE.MathUtils.lerp(overshoot, 1, (progress - 0.7) / 0.3);
    group.scale.setScalar(pulse);
  },
});

/**
 * Sets opacity across all visible parts of a tile actor for blend-out animations.
 * Param: `opacity` is clamped to [0, 1] before being applied to actor materials.
 */
const setActorOpacity = (actor, opacity) => {
  const alpha = THREE.MathUtils.clamp(opacity, 0, 1);
  actor.bodyMaterial.transparent = alpha < 1;
  actor.bodyMaterial.opacity = alpha;
  actor.edgeMaterial.opacity = 0.12 * alpha;
  actor.label.material.opacity = alpha;
  actor.shadow.material.opacity = 0.24 * alpha;
};

/**
 * Plays a short impact wobble to sell cube compression and rebound after a collision.
 * Params: `axis` is the collision direction, `strength` scales wobble amplitude.
 */
const playCollisionWobble = (actor, axis, strength = 1) => addTween({
  duration: 0.18,
  easing: (value) => value,
  onUpdate: (_, linear) => {
    const damp = Math.exp(-5.8 * linear);
    const swing = Math.sin(linear * Math.PI * 5.5) * damp * 0.14 * strength;
    const squash = 1 - Math.sin(Math.min(linear * 1.3, 1) * Math.PI) * 0.12 * strength;
    const stretch = 1 + Math.sin(Math.min(linear * 1.3, 1) * Math.PI) * 0.08 * strength;

    actor.group.rotation.z = axis.x !== 0 ? swing : swing * 0.35;
    actor.group.rotation.x = axis.z !== 0 ? -swing : swing * 0.35;
    actor.group.scale.set(
      axis.x !== 0 ? squash : stretch,
      stretch,
      axis.z !== 0 ? squash : stretch,
    );
  },
  onComplete: () => {
    actor.group.rotation.set(0, 0, 0);
    actor.group.scale.setScalar(1);
  },
});

/**
 * Creates simple liquid droplets around a merge impact point.
 * Params: `position` is the world-space impact point, `color` tints the droplets.
 */
const spawnDroplets = (position, color) => {
  for (let index = 0; index < DROPLET_COUNT; index += 1) {
    const mesh = new THREE.Mesh(
      dropletGeometry,
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.2,
        roughness: 0.08,
        metalness: 0.02,
      }),
    );
    mesh.position.copy(position);
    mesh.scale.setScalar(0.8 + Math.random() * 0.9);
    dropletsGroup.add(mesh);

    droplets.push({
      mesh,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 1.4,
        0.35 + Math.random() * 0.45,
        (Math.random() - 0.5) * 1.4,
      ),
      life: 0,
      duration: 0.38 + Math.random() * 0.16,
    });
  }
};

/**
 * Moves the two merging tiles into a vertical drop staging pose over the target cell.
 * Params: `baseActor` settles on the board, `fallingActor` is lifted above for gravity drop.
 */
const animateMergeDropSetup = (baseActor, fallingActor, targetPosition, baseTargetPosition = targetPosition) => {
  const fallingStart = fallingActor.group.position.clone();
  const raisedTarget = targetPosition.clone();
  raisedTarget.y += MERGE_DROP_HEIGHT + Math.max(getTowerHeight(baseActor.tile.stackCount ?? 1) - TILE_HEIGHT, 0);

  const baseTween = animatePosition(baseActor.group, baseTargetPosition, 0.08);
  const fallingTween = addTween({
    duration: 0.1,
    easing: (value) => 1 - (1 - value) ** 3,
    onUpdate: (progress) => {
      fallingActor.group.position.lerpVectors(fallingStart, raisedTarget, progress);
      fallingActor.group.position.y += Math.sin(progress * Math.PI) * 0.12;
    },
  });

  return Promise.all([baseTween, fallingTween]);
};

/**
 * Plays a pure stacked merge presentation without any fusion or sinking motion.
 * Params: `baseActor` remains on the board, `fallingActor` stacks above it before resolve.
 */
const startStackMergeEffect = ({ baseActor, fallingActor, targetPosition }) => (
  new Promise((resolve) => {
    const baseStart = baseActor.group.position.clone();
    const fallingStart = fallingActor.group.position.clone();
    const bottomTarget = targetPosition.clone();
    const topTarget = targetPosition.clone();
    topTarget.y += getTowerHeight(baseActor.tile.stackCount ?? 1);

    addTween({
      duration: 0.08,
      easing: (value) => 1 - (1 - value) ** 3,
      onUpdate: (progress) => {
        baseActor.group.position.lerpVectors(baseStart, bottomTarget, progress);
        fallingActor.group.position.lerpVectors(fallingStart, topTarget, progress);

        const settle = Math.sin(progress * Math.PI);
        baseActor.group.scale.set(1 + settle * 0.03, 1 - settle * 0.06, 1 + settle * 0.03);
        fallingActor.group.scale.set(1 - settle * 0.04, 1 + settle * 0.05, 1 - settle * 0.04);
      },
    }).then(() => addTween({
      duration: 0.08,
      onUpdate: () => {
        baseActor.group.position.copy(bottomTarget);
        fallingActor.group.position.copy(topTarget);
        baseActor.group.scale.setScalar(1);
        fallingActor.group.scale.setScalar(1);
        setActorOpacity(baseActor, 1);
        setActorOpacity(fallingActor, 1);
      },
    })).then(resolve);
  })
);

/**
 * Simulates one falling cube landing on top of an existing stack.
 * Params: `targetLevel` is the final zero-based stack level for the falling actor.
 */
const startSingleStackDrop = ({ baseActor, fallingActor, targetRow, targetCol, targetLevel }) => (
  new Promise((resolve) => {
    const targetPosition = gridToWorld(targetRow, targetCol, targetLevel);
    const basePosition = gridToWorld(targetRow, targetCol, targetLevel - 1);

    animateMergeDropSetup(baseActor, fallingActor, targetPosition, basePosition).then(() => {
      const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -28, 0) });
      world.solver.iterations = 10;

      const material = new CANNON.Material("stack-material");
      world.addContactMaterial(new CANNON.ContactMaterial(material, material, {
        friction: 0.02,
        restitution: 0.34,
      }));

      const shape = new CANNON.Box(new CANNON.Vec3(TILE_SIZE * 0.42, TILE_HEIGHT * 0.4, TILE_SIZE * 0.42));
      const baseBody = new CANNON.Body({ mass: 0, material, shape });
      const fallingBody = new CANNON.Body({
        mass: 0.95,
        material,
        shape,
        linearDamping: 0.06,
        angularDamping: 1,
      });

      baseBody.position.set(basePosition.x, basePosition.y, basePosition.z);
      fallingBody.position.set(targetPosition.x, targetPosition.y + MERGE_DROP_HEIGHT, targetPosition.z);
      baseBody.fixedRotation = true;
      fallingBody.fixedRotation = true;
      baseBody.updateMassProperties();
      fallingBody.updateMassProperties();

      world.addBody(baseBody);
      world.addBody(fallingBody);

      const simulation = {
        stackOnly: true,
        world,
        frontBody: baseBody,
        backBody: fallingBody,
        frontActor: baseActor,
        backActor: fallingActor,
        targetPosition,
        targetRow,
        targetCol,
        targetLevel,
        stackSize: targetLevel + 1,
        elapsed: 0,
        phase: "drop-1",
        pendingContact: false,
        secondContactArmed: false,
        contactLockUntil: 0,
        forceFinalAt: 0.42,
        collisionAxis: new THREE.Vector3(1, 0, 0),
        resolve,
      };

      fallingBody.addEventListener("collide", () => {
        simulation.pendingContact = true;
      });

      mergeSimulations.push(simulation);
    });
  })
);

/**
 * Runs one full stack-building sequence for a line after horizontal movement has settled.
 * Params: `tileIds` must be ordered from the bottom cube to the top cube.
 */
const startStackGroupSimulation = ({ targetRow, targetCol, tileIds }) => (
  new Promise(async (resolve) => {
    if (tileIds.length === 0) {
      resolve();
      return;
    }

    const baseActor = tileActors.get(tileIds[0]);
    if (!baseActor) {
      resolve();
      return;
    }

    const actors = tileIds.map((tileId) => tileActors.get(tileId)).filter(Boolean);
    const approachTarget = gridToWorld(targetRow, targetCol, 0);

    actors.forEach((actor, index) => {
      actor.tile.row = targetRow;
      actor.tile.col = targetCol;
      actor.tile.level = index;
      updateActorStackVisual(actor, tileIds.length);
    });

    await Promise.all(actors.map((actor, index) => {
      const target = actor.group.position.clone();
      target.x = approachTarget.x;
      target.z = approachTarget.z;

      if (index === 0) {
        target.y = approachTarget.y;
      }

      return animatePosition(actor.group, target, 0.08);
    }));

    baseActor.group.position.copy(gridToWorld(targetRow, targetCol, 0));
    baseActor.tile.row = targetRow;
    baseActor.tile.col = targetCol;
    baseActor.tile.level = 0;
    updateActorStackVisual(baseActor, tileIds.length);

    let topActor = baseActor;

    for (let index = 1; index < tileIds.length; index += 1) {
      const fallingActor = tileActors.get(tileIds[index]);
      if (!fallingActor) {
        continue;
      }

      fallingActor.tile.row = targetRow;
      fallingActor.tile.col = targetCol;
      fallingActor.tile.level = index;
      updateActorStackVisual(fallingActor, tileIds.length);

      await startSingleStackDrop({
        baseActor: topActor,
        fallingActor,
        targetRow,
        targetCol,
        targetLevel: index,
      });

      topActor = fallingActor;
    }

    resolve();
  })
);

/**
 * Moves a tall tower as one rigid body once the stack reaches the configured threshold.
 * Params: `tileIds` must be ordered from bottom to top for stable final levels.
 */
const startRigidStackMove = ({ targetRow, targetCol, tileIds }) => (
  new Promise(async (resolve) => {
    const actors = tileIds.map((tileId) => tileActors.get(tileId)).filter(Boolean);
    if (actors.length === 0) {
      resolve();
      return;
    }

    await Promise.all(actors.map((actor, level) => {
      actor.tile.row = targetRow;
      actor.tile.col = targetCol;
      actor.tile.level = level;
      updateActorStackVisual(actor, tileIds.length);
      return animatePosition(actor.group, gridToWorld(targetRow, targetCol, level), 0.1);
    }));

    actors.forEach((actor, index) => {
      actor.group.position.copy(gridToWorld(targetRow, targetCol, index));
      playCollisionWobble(actor, new THREE.Vector3(0.55, 0, 1), 0.35 + index * 0.04);
    });

    resolve();
  })
);

/**
 * Simulates a merge collision with cannon-es before the liquid fusion starts.
 * Param: `mergePair` comes from the move plan and contains source ids and target cell.
 */
const startMergeSimulation = (mergePair) => (
  new Promise((resolve) => {
    const [firstId, secondId] = mergePair.sourceIds;
    const firstActor = tileActors.get(firstId);
    const secondActor = tileActors.get(secondId);

    if (!firstActor || !secondActor) {
      resolve();
      return;
    }

    const targetPosition = gridToWorld(mergePair.targetRow, mergePair.targetCol);
    const firstDistance = firstActor.group.position.distanceTo(targetPosition);
    const secondDistance = secondActor.group.position.distanceTo(targetPosition);
    const baseActor = firstDistance <= secondDistance ? firstActor : secondActor;
    const fallingActor = baseActor === firstActor ? secondActor : firstActor;

    animateMergeDropSetup(baseActor, fallingActor, targetPosition).then(() => {
      const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -28, 0) });
      world.solver.iterations = 10;

      const material = new CANNON.Material("tile-material");
      world.addContactMaterial(new CANNON.ContactMaterial(material, material, {
        friction: 0.02,
        restitution: 0.34,
      }));

      const shape = new CANNON.Box(new CANNON.Vec3(TILE_SIZE * 0.42, TILE_HEIGHT * 0.4, TILE_SIZE * 0.42));
      const baseBody = new CANNON.Body({
        mass: 0,
        material,
        shape,
      });
      const fallingBody = new CANNON.Body({
        mass: 0.95,
        material,
        shape,
        linearDamping: 0.06,
        angularDamping: 1,
      });

      baseBody.position.set(targetPosition.x, targetPosition.y, targetPosition.z);
      fallingBody.position.set(targetPosition.x, targetPosition.y + MERGE_DROP_HEIGHT, targetPosition.z);
      baseBody.fixedRotation = true;
      fallingBody.fixedRotation = true;
      baseBody.updateMassProperties();
      fallingBody.updateMassProperties();

      world.addBody(baseBody);
      world.addBody(fallingBody);

      const simulation = {
        mergePair,
        world,
        frontBody: baseBody,
        backBody: fallingBody,
        frontActor: baseActor,
        backActor: fallingActor,
        targetPosition,
        elapsed: 0,
        phase: "drop-1",
        impactCount: 0,
        pendingContact: false,
        secondContactArmed: false,
        contactLockUntil: 0,
        forceFinalAt: 0.48,
        resolve,
      };

      fallingBody.addEventListener("collide", () => {
        simulation.pendingContact = true;
      });

      mergeSimulations.push(simulation);
    });
  })
);

/**
 * Applies the first physical impact response after the falling cube hits the base cube.
 * Usage boundary: called once for the initial gravity-driven impact.
 */
const triggerFirstImpact = (simulation) => {
  if (simulation.phase !== "drop-1") {
    return;
  }

  simulation.phase = "bounce-up";
  simulation.impactCount = 1;
  simulation.contactLockUntil = simulation.elapsed + 0.04;
  stageImpulse = Math.max(stageImpulse, 0.18);
  const wobbleAxis = simulation.collisionAxis ?? directionVectors[simulation.mergePair?.direction] ?? new THREE.Vector3(1, 0, 0);

  playCollisionWobble(simulation.frontActor, wobbleAxis, 0.8);
  playCollisionWobble(simulation.backActor, wobbleAxis, 1.15);
};

/**
 * Triggers the final stacked merge presentation after the second contact occurs.
 * Usage boundary: called once, after a visible rebound has already happened.
 */
const triggerFinalMerge = (simulation) => {
  if (simulation.phase === "finalizing" || simulation.phase === "done") {
    return;
  }

  simulation.phase = "finalizing";
  simulation.frontBody.velocity.set(0, 0, 0);
  simulation.backBody.velocity.set(0, 0, 0);
  stageImpulse = Math.max(stageImpulse, 0.28);
  const wobbleAxis = simulation.collisionAxis ?? directionVectors[simulation.mergePair?.direction] ?? new THREE.Vector3(1, 0, 0);

  playCollisionWobble(simulation.frontActor, wobbleAxis, 0.8);
  playCollisionWobble(simulation.backActor, wobbleAxis, 0.8);

  startStackMergeEffect({
    baseActor: simulation.frontActor,
    fallingActor: simulation.backActor,
    targetPosition: simulation.targetPosition,
  }).then(() => {
    if (simulation.stackOnly) {
      simulation.frontActor.tile.level = simulation.targetLevel - 1;
      simulation.backActor.tile.level = simulation.targetLevel;
      simulation.frontActor.group.position.copy(gridToWorld(simulation.targetRow, simulation.targetCol, simulation.targetLevel - 1));
      simulation.backActor.group.position.copy(gridToWorld(simulation.targetRow, simulation.targetCol, simulation.targetLevel));
      updateActorStackVisual(simulation.frontActor, simulation.stackSize);
      updateActorStackVisual(simulation.backActor, simulation.stackSize);
    } else {
      removeTileActor(simulation.mergePair.sourceIds[0]);
      removeTileActor(simulation.mergePair.sourceIds[1]);
    }
    simulation.resolve();
    simulation.done = true;
    simulation.phase = "done";
  });
};

/**
 * Advances all active physics merge simulations and syncs their mesh actors each frame.
 * Param: `delta` is the current frame delta time in seconds.
 */
const updateMergeSimulations = (delta) => {
  for (let index = mergeSimulations.length - 1; index >= 0; index -= 1) {
    const simulation = mergeSimulations[index];

    if (simulation.done) {
      mergeSimulations.splice(index, 1);
      continue;
    }

    if (simulation.phase === "finalizing") {
      continue;
    }

    simulation.elapsed += delta;
    simulation.world.step(FIXED_STEP, delta, 4);

    simulation.frontActor.group.position.set(
      simulation.frontBody.position.x,
      simulation.frontBody.position.y,
      simulation.frontBody.position.z,
    );
    simulation.backActor.group.position.set(
      simulation.backBody.position.x,
      simulation.backBody.position.y,
      simulation.backBody.position.z,
    );

    if (simulation.pendingContact && simulation.elapsed >= simulation.contactLockUntil) {
      simulation.pendingContact = false;

      if (simulation.phase === "drop-1") {
        triggerFirstImpact(simulation);
      } else if (simulation.phase === "drop-2") {
        triggerFinalMerge(simulation);
      }
    }

    if (simulation.phase === "bounce-up") {
      if (simulation.backBody.velocity.y > 0.35 || simulation.backActor.group.position.y >= simulation.targetPosition.y + 0.58) {
        simulation.secondContactArmed = true;
      }

      if (simulation.secondContactArmed && simulation.backBody.velocity.y < -0.05) {
        simulation.phase = "drop-2";
      } else if (simulation.elapsed >= simulation.forceFinalAt) {
        simulation.phase = "drop-2";
      }
      continue;
    }

    if (simulation.phase === "drop-2" && simulation.elapsed >= simulation.forceFinalAt) {
        triggerFinalMerge(simulation);
    }
  }
};

/**
 * Advances the transient liquid droplets created during merge impacts.
 * Param: `delta` is the frame delta time in seconds.
 */
const updateDroplets = (delta) => {
  for (let index = droplets.length - 1; index >= 0; index -= 1) {
    const droplet = droplets[index];
    droplet.life += delta;
    droplet.velocity.y -= 2.8 * delta;
    droplet.mesh.position.addScaledVector(droplet.velocity, delta);
    const fade = 1 - droplet.life / droplet.duration;
    droplet.mesh.scale.setScalar(Math.max(0.001, fade));
    droplet.mesh.material.opacity = fade;
    droplet.mesh.material.transparent = true;

    if (droplet.life >= droplet.duration) {
      droplet.mesh.removeFromParent();
      droplet.mesh.material.dispose();
      droplets.splice(index, 1);
    }
  }
};

/**
 * Applies the short board-wide recoil caused by invalid inputs and merge impacts.
 * Param: `delta` is the current frame delta time in seconds.
 */
const updateStageImpulse = (delta) => {
  stageTime += delta;
  stageImpulse *= 0.88;
  worldRoot.rotation.z = Math.sin(stageTime * 28) * 0.035 * stageImpulse;
  worldRoot.rotation.x = Math.sin(stageTime * 18) * 0.018 * stageImpulse;
  worldRoot.position.y = Math.sin(stageTime * 40) * 0.08 * stageImpulse;
};

/**
 * Runs one full 2048 move, coordinating deterministic logic with render and physics effects.
 * Param: `direction` must be one of the normalized movement directions.
 */
const performMove = async (direction) => {
  if (inputLocked) {
    return;
  }

  const plan = buildMovePlan(state, direction);
  if (!plan) {
    stageImpulse = Math.max(stageImpulse, 0.14);
    return;
  }

  inputLocked = true;
  const mergedIds = new Set(plan.mergePairs.flatMap((pair) => pair.sourceIds));
  const moveTweens = plan.moveEntries
    .filter((entry) => !mergedIds.has(entry.id))
    .map((entry) => {
      const actor = tileActors.get(entry.id);
      return actor ? animatePosition(actor.group, gridToWorld(entry.toRow, entry.toCol), 0.1) : Promise.resolve();
    });
  const mergeTweens = plan.mergePairs.map((pair) => startMergeSimulation(pair));

  await Promise.all([...moveTweens, ...mergeTweens]);

  state = plan.resultState;
  syncActorsToState(state);
  renderHud();
  renderOverlayFromState();
  inputLocked = false;
  state = {
    ...state,
    tiles: state.tiles.map((tile) => ({ ...tile, justSpawned: false, justMerged: false })),
  };
};

/**
 * Maps keyboard input into game moves and prevents page scrolling.
 * Usage boundary: bind once to `window` during initialization.
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
  performMove(direction);
};

/**
 * Clears transient simulations and rebuilds the match from a fresh initial state.
 * Usage boundary: shared by startup and every restart button in the UI.
 */
const restartGame = () => {
  tweens.length = 0;
  mergeSimulations.length = 0;
  droplets.forEach((droplet) => {
    droplet.mesh.removeFromParent();
    droplet.mesh.material.dispose();
  });
  droplets.length = 0;

  Array.from(tileActors.keys()).forEach(removeTileActor);
  inputLocked = false;
  stageImpulse = 0;

  state = createInitialState();
  syncActorsToState(state);
  renderHud();
  renderOverlayFromState();
  state = {
    ...state,
    tiles: state.tiles.map((tile) => ({ ...tile, justSpawned: false, justMerged: false })),
  };
};

/**
 * Keeps the renderer and camera aligned with the viewport container.
 * Usage boundary: call on startup and on every relevant resize event.
 */
const resizeViewport = () => {
  const width = viewportEl.clientWidth;
  const height = viewportEl.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
};

/**
 * Advances the entire frame: tweens, physics, liquid meshes, and final render.
 * Usage boundary: bound once as the renderer's animation loop.
 */
const renderFrame = () => {
  const delta = Math.min(clock.getDelta(), 0.033);
  updateTweens(delta);
  updateMergeSimulations(delta);
  updateDroplets(delta);
  updateStageImpulse(delta);
  renderer.render(scene, camera);
};

/**
 * Wires all UI events, builds the static scene, and starts the render loop.
 * Usage boundary: one-time application bootstrap.
 */
const init = () => {
  setupStageLighting();
  createBoard();
  resizeViewport();
  restartGame();

  restartButtonEl.addEventListener("click", restartGame);
  overlayRestartButtonEl.addEventListener("click", restartGame);
  continueButtonEl.addEventListener("click", () => {
    state = { ...state, continued: true };
    renderOverlayFromState();
  });
  window.addEventListener("resize", resizeViewport);
  window.addEventListener("keydown", handleKeydown, { passive: false });
  renderer.setAnimationLoop(renderFrame);
};

init();
