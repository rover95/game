import * as THREE from "three";
import * as CANNON from "cannon-es";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const DEFAULT_BOARD_SIZE = 4;
const BOARD_SIZE_OPTIONS = [4, 5, 6];
const CELL_SPACING = 1.52;
const TILE_SIZE = 1.05;
const TILE_HEIGHT = 0.22;
const STACK_STEP = TILE_HEIGHT * 1.04;
const STACK_RIGID_THRESHOLD = 4;
const BOARD_THICKNESS = 0.7;
const BOARD_PADDING = 0.78;
const FIXED_STEP = 1 / 90;
const MAX_PIXEL_RATIO = 1.35;
const SHADOW_MAP_SIZE = 1024;
const MERGE_DROP_HEIGHT = 1.35;
const BEST_SCORE_KEY_PREFIX = "impact-merge-2048-best";
const SAVED_GAME_KEY = "impact-merge-2048-session";
const MAX_UNDO_STEPS = 5;
const BASE_CAMERA_FOV = 42;
const BASE_CAMERA_Y = 8.8;
const BASE_CAMERA_Z = 5.8;
const BASE_LOOK_AT_Y = 0.3;
const POST_64_STACK_INCREMENT = 16;
const BASE_FOG_DENSITY = 0.06;
const MIN_FOG_DENSITY = 0.028;

const viewportEl = document.getElementById("viewport");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const undoButtonEl = document.getElementById("undo");
const restartButtonEl = document.getElementById("restart");
const boardSizeSelectEl = document.getElementById("board-size");
const continueButtonEl = document.getElementById("continue");
const overlayRestartButtonEl = document.getElementById("overlay-restart");
const overlayEl = document.getElementById("overlay");
const overlayTagEl = document.getElementById("overlay-tag");
const overlayTitleEl = document.getElementById("overlay-title");
const overlayBodyEl = document.getElementById("overlay-body");
const debugToggleButtonEl = document.getElementById("debug-toggle");
const debugPanelEl = document.getElementById("debug-panel");
const debugPresetButtonEls = Array.from(document.querySelectorAll("[data-debug-preset]"));

const tileActors = new Map();
const labelTextureCache = new Map();
const tweens = [];
const mergeSimulations = [];
const stageLighting = {};
let audioContext = null;
let audioPrimed = false;

let state = null;
let inputLocked = false;
let overlayMode = null;
let stageImpulse = 0;
let stageTime = 0;
let currentBoardSize = Number(new URLSearchParams(window.location.search).get("size")) || DEFAULT_BOARD_SIZE;
let debugMode = new URLSearchParams(window.location.search).get("debug") === "1";
let activeDebugPreset = null;
let currentStateFactory = null;
let queuedDirection = null;
let skipAnimationsRequested = false;
let undoHistory = [];
let swipePointerId = null;
let swipeStartX = 0;
let swipeStartY = 0;
let swipeLastX = 0;
let swipeLastY = 0;

const MIN_SWIPE_DISTANCE = 26;

const directionVectors = {
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  up: new THREE.Vector3(0, 0, -1),
  down: new THREE.Vector3(0, 0, 1),
};
const cameraUpBase = new THREE.Vector3(0, 1, 0);
const cameraUpTopDown = new THREE.Vector3(0, 0, -1);
const cameraUpCurrent = new THREE.Vector3();
const cameraFitEye = new THREE.Vector3();
const cameraFitTarget = new THREE.Vector3();
const cameraFitUp = new THREE.Vector3();
const cameraFitPoint = new THREE.Vector3();
const cameraFitViewMatrix = new THREE.Matrix4();

const scene = new THREE.Scene();
scene.background = new THREE.Color("#071119");
scene.fog = new THREE.FogExp2("#071119", BASE_FOG_DENSITY);

const camera = new THREE.PerspectiveCamera(BASE_CAMERA_FOV, 1, 0.1, 100);
camera.position.set(0, BASE_CAMERA_Y, BASE_CAMERA_Z);
camera.lookAt(0, BASE_LOOK_AT_Y, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
viewportEl.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = "none";

const clock = new THREE.Clock();

const worldRoot = new THREE.Group();
const boardGroup = new THREE.Group();
const tilesGroup = new THREE.Group();
const effectsGroup = new THREE.Group();
scene.add(worldRoot);
worldRoot.add(boardGroup);
worldRoot.add(tilesGroup);
worldRoot.add(effectsGroup);

const tileGeometry = new RoundedBoxGeometry(TILE_SIZE, TILE_HEIGHT, TILE_SIZE, 5, 0.08);
const slotGeometry = new RoundedBoxGeometry(TILE_SIZE * 1.02, 0.18, TILE_SIZE * 1.02, 4, 0.09);
const shadowGeometry = new THREE.CircleGeometry(TILE_SIZE * 0.48, 18);
const labelGeometry = new THREE.PlaneGeometry(TILE_SIZE * 0.72, TILE_SIZE * 0.72);
const STACK_VISUAL_STEP = TILE_HEIGHT * 0.9;
const MAX_RENDER_STACK_LAYERS = 256;

if (!BOARD_SIZE_OPTIONS.includes(currentBoardSize)) {
  currentBoardSize = DEFAULT_BOARD_SIZE;
}

/**
 * Returns the active board size from state or current configuration.
 * Param: `sourceState` is optional and may carry a size field.
 */
const getBoardSize = (sourceState = state) => sourceState?.size ?? currentBoardSize;

/**
 * Returns the rendered board width for a given size.
 * Param: `size` is the board side length in cells.
 */
const getBoardWidth = (size = currentBoardSize) => (size - 1) * CELL_SPACING + TILE_SIZE + BOARD_PADDING * 2;

/**
 * Returns the half-span of the playable tile footprint, excluding decorative board padding.
 * Param: `size` is the board side length in cells.
 */
const getPlayableHalfSpan = (size = currentBoardSize) => ((size - 1) * CELL_SPACING) / 2 + TILE_SIZE * 0.5;

/**
 * Computes the vertical FOV needed to fit the board prism and tallest tower on screen.
 * Params describe the candidate camera framing before interpolation is applied.
 */
const getRequiredFovForFraming = ({
  size = currentBoardSize,
  tallestHeight = TILE_HEIGHT,
  cameraY = BASE_CAMERA_Y,
  cameraZ = BASE_CAMERA_Z,
  lookAtY = BASE_LOOK_AT_Y,
  up = cameraUpBase,
  aspect = camera.aspect || 1,
}) => {
  const halfSpan = getPlayableHalfSpan(size);
  const topY = tallestHeight + 0.03;
  const bottomY = -BOARD_THICKNESS * 0.5;
  const corners = [
    [-halfSpan, bottomY, -halfSpan],
    [halfSpan, bottomY, -halfSpan],
    [-halfSpan, bottomY, halfSpan],
    [halfSpan, bottomY, halfSpan],
    [-halfSpan, topY, -halfSpan],
    [halfSpan, topY, -halfSpan],
    [-halfSpan, topY, halfSpan],
    [halfSpan, topY, halfSpan],
  ];

  cameraFitEye.set(0, cameraY, cameraZ);
  cameraFitTarget.set(0, lookAtY, 0);
  cameraFitUp.copy(up).normalize();
  cameraFitViewMatrix.lookAt(cameraFitEye, cameraFitTarget, cameraFitUp);

  let maxTanHalfVertical = 0;
  for (const [x, y, z] of corners) {
    cameraFitPoint.set(x, y, z).applyMatrix4(cameraFitViewMatrix);
    const depth = Math.max(-cameraFitPoint.z, 0.001);
    const verticalNeed = Math.abs(cameraFitPoint.y) / depth;
    const horizontalNeed = Math.abs(cameraFitPoint.x) / (depth * Math.max(aspect, 0.001));
    maxTanHalfVertical = Math.max(maxTanHalfVertical, verticalNeed, horizontalNeed);
  }

  return THREE.MathUtils.clamp(
    THREE.MathUtils.radToDeg(2 * Math.atan(maxTanHalfVertical * 1.03)),
    12,
    BASE_CAMERA_FOV,
  );
};

/**
 * Returns the preferred FOV that keeps the board footprint visually stable as the camera moves.
 * Params describe the candidate camera framing before interpolation is applied.
 */
const getStableBoardFov = ({
  size = currentBoardSize,
  cameraY = BASE_CAMERA_Y,
  cameraZ = BASE_CAMERA_Z,
  lookAtY = BASE_LOOK_AT_Y,
}) => {
  const boardScale = getBoardWidth(size) / getBoardWidth(DEFAULT_BOARD_SIZE);
  const baseDistance = Math.hypot(BASE_CAMERA_Y - BASE_LOOK_AT_Y, BASE_CAMERA_Z);
  const targetDistance = Math.hypot(cameraY - lookAtY, cameraZ);
  const baseFrustumHeight = 2 * baseDistance * Math.tan(THREE.MathUtils.degToRad(BASE_CAMERA_FOV * 0.5));

  return THREE.MathUtils.clamp(
    THREE.MathUtils.radToDeg(2 * Math.atan((baseFrustumHeight * boardScale) / (2 * Math.max(targetDistance, 0.001)))),
    12,
    BASE_CAMERA_FOV,
  );
};

/**
 * Returns the per-size storage key for best score tracking.
 * Param: `size` is the board side length in cells.
 */
const getBestScoreKey = (size = currentBoardSize) => `${BEST_SCORE_KEY_PREFIX}-${size}`;

/**
 * Converts a tile value into the tower height units used by stacked rendering.
 * Param: `value` must be a positive power-of-two tile number.
 */
const getStackCountForValue = (value = 2) => {
  if (value <= 64) {
    return Math.max(1, value / 2);
  }

  return 32 + (Math.log2(value) - 6) * POST_64_STACK_INCREMENT;
};

/**
 * Clamps tower units into the number of rendered cube slices.
 * Param: `stackCount` is the visible tower unit count for one tile.
 */
const getVisibleLayerCount = (stackCount = 1) => Math.min(Math.max(Math.round(stackCount), 1), MAX_RENDER_STACK_LAYERS);

/**
 * Returns the visible tower height used by labels, staging, and squash effects.
 * Param: `stackCount` is the logical merge stack size carried by one tile.
 */
const getTowerHeight = (stackCount = 1) => TILE_HEIGHT + (getVisibleLayerCount(stackCount) - 1) * STACK_VISUAL_STEP;

/**
 * Lazily creates a Web Audio context after the first user gesture.
 * Usage boundary: safe to call repeatedly from keyboard or pointer handlers.
 */
const ensureAudioContext = () => {
  const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextCtor();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  return audioContext;
};

/**
 * Performs a near-silent user-gesture playback to reliably unlock Web Audio on mobile browsers.
 * Usage boundary: call only from direct input handlers such as touch, pointer, or keyboard events.
 */
const primeAudioContext = () => {
  const context = ensureAudioContext();
  if (!context) {
    return null;
  }

  if (audioPrimed && context.state === "running") {
    return context;
  }

  const now = context.currentTime;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.00001, now);
  gain.connect(context.destination);

  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(440, now);
  oscillator.connect(gain);

  try {
    oscillator.start(now);
    oscillator.stop(now + 0.001);
    audioPrimed = true;
  } catch {
    // Some browsers may reject repeated starts during edge transitions; keep best-effort unlock behavior.
  }

  return context;
};

/**
 * Plays a short synthetic merge chime whose tone scales with the merged value.
 * Param: `value` is the final post-merge tile number.
 */
const playMergeSound = (value) => {
  const context = ensureAudioContext();
  if (!context) {
    return;
  }

  if (context.state !== "running") {
    context.resume().catch(() => {});
  }

  if (context.state !== "running") {
    return;
  }

  const now = context.currentTime;
  const power = Math.max(1, Math.log2(value));
  const masterGain = context.createGain();
  masterGain.gain.setValueAtTime(0.0001, now);
  masterGain.gain.exponentialRampToValueAtTime(Math.min(0.11 + power * 0.003, 0.17), now + 0.012);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  masterGain.connect(context.destination);

  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(2400 + power * 110, now);
  lowpass.Q.value = 0.8;
  lowpass.connect(masterGain);

  const oscillator = context.createOscillator();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(280 + power * 18, now);
  oscillator.frequency.exponentialRampToValueAtTime(440 + power * 26, now + 0.11);
  oscillator.connect(lowpass);
  oscillator.start(now);
  oscillator.stop(now + 0.24);

  const sparkleGain = context.createGain();
  sparkleGain.gain.setValueAtTime(0.0001, now);
  sparkleGain.gain.exponentialRampToValueAtTime(0.045, now + 0.006);
  sparkleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
  sparkleGain.connect(masterGain);

  const sparkle = context.createOscillator();
  sparkle.type = "sine";
  sparkle.frequency.setValueAtTime(920 + power * 20, now);
  sparkle.frequency.exponentialRampToValueAtTime(1400 + power * 24, now + 0.05);
  sparkle.connect(sparkleGain);
  sparkle.start(now);
  sparkle.stop(now + 0.09);
};

/**
 * Returns how much vertical space a tower adds above one base cube.
 * Param: `stackCount` is the logical merge stack size carried by one tile.
 */
const getTowerLift = (stackCount = 1) => Math.max(getTowerHeight(stackCount) - TILE_HEIGHT, 0);

/**
 * Returns the tallest visible tower height in the current committed state.
 * Param: `tiles` is the canonical logical tile collection for one board state.
 */
const getTallestTowerHeight = (tiles) => {
  if (!tiles?.length) {
    return TILE_HEIGHT;
  }

  return tiles.reduce(
    (maxHeight, tile) => Math.max(maxHeight, getTowerHeight(tile.stackCount ?? 1)),
    TILE_HEIGHT,
  );
};

/**
 * Returns the highest numeric tile currently present on the board.
 * Param: `tiles` is the canonical logical tile collection for one board state.
 */
const getHighestTileValue = (tiles) => {
  if (!tiles?.length) {
    return 2;
  }

  return tiles.reduce((highest, tile) => Math.max(highest, tile.value), 2);
};

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
  const hemisphere = new THREE.HemisphereLight("#dff8ff", "#071119", 1.4);
  scene.add(hemisphere);

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
  keyLight.shadow.bias = -0.00035;
  keyLight.shadow.normalBias = 0.018;
  scene.add(keyLight);

  const rimLight = new THREE.PointLight("#6be6ff", 24, 18, 2);
  rimLight.position.set(-4.4, 4.4, -3.2);
  scene.add(rimLight);

  const warmLift = new THREE.PointLight("#ff9b75", 18, 16, 2);
  warmLift.position.set(4.2, 2.8, 5.4);
  scene.add(warmLift);

  const baseFill = new THREE.PointLight("#9edfff", 14, 18, 2);
  baseFill.position.set(0, 1.5, 4.8);
  scene.add(baseFill);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(9.5, 48),
    new THREE.MeshBasicMaterial({ color: "#03080d", transparent: true, opacity: 0.3 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.35;
  ground.scale.set(1.2, 1, 1);
  worldRoot.add(ground);

  stageLighting.hemisphere = hemisphere;
  stageLighting.keyLight = keyLight;
  stageLighting.rimLight = rimLight;
  stageLighting.warmLift = warmLift;
  stageLighting.baseFill = baseFill;
  stageLighting.ground = ground;
};

/**
 * Disposes all current board meshes before rebuilding the board for a new size.
 * Usage boundary: call only when recreating the static board shell.
 */
const clearBoard = () => {
  for (let index = boardGroup.children.length - 1; index >= 0; index -= 1) {
    const child = boardGroup.children[index];
    child.removeFromParent();
    child.geometry?.dispose?.();

    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  }
};

/**
 * Converts board row/col coordinates into world-space tile centers.
 * Params: `row` and `col` must be valid zero-based board indices.
 */
const gridToWorld = (row, col, level = 0, size = currentBoardSize) => {
  const offset = ((size - 1) * CELL_SPACING) / 2;
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

const saturateColorStyle = (style, amount = 0.06) => {
  const color = new THREE.Color(style);
  const hsl = {};
  color.getHSL(hsl);
  color.setHSL(hsl.h, THREE.MathUtils.clamp(hsl.s + amount, 0, 1), hsl.l);
  return color.getStyle();
};

/**
 * Maps tile values to the palette used by solid meshes, labels, and liquid effects.
 * Usage boundary: supports arbitrary powers of two beyond 2048 with a generated fallback hue.
 */
const getPalette = (value) => {
  const fixed = {
    2: { body: "#8bc8ff", edge: "#dff1ff", label: "#0f2536", emissive: "#427fab", liquid: "#b8defd" },
    4: { body: "#62d3e4", edge: "#c9f9ff", label: "#08262b", emissive: "#2f98aa", liquid: "#9ce8f2" },
    8: { body: "#6fd7b1", edge: "#d5ffee", label: "#0c241b", emissive: "#38936f", liquid: "#a2edd0" },
    16: { body: "#a4d96c", edge: "#ebffc9", label: "#18270a", emissive: "#69953a", liquid: "#c7eba0" },
    32: { body: "#d9d062", edge: "#fff7bd", label: "#292206", emissive: "#9b8f2a", liquid: "#eee28f" },
    64: { body: "#efbf57", edge: "#ffe9ae", label: "#332005", emissive: "#b77e21", liquid: "#f7d88c" },
    128: { body: "#f2a14f", edge: "#ffd4a2", label: "#351b05", emissive: "#c66d22", liquid: "#f7c381" },
    256: { body: "#ee844c", edge: "#ffc19c", label: "#391507", emissive: "#c5542f", liquid: "#f4a579" },
    512: { body: "#ea6a4f", edge: "#ffab97", label: "#fff4ef", emissive: "#cf4331", liquid: "#f08e78" },
    1024: { body: "#e55347", edge: "#ff8f89", label: "#fff2f1", emissive: "#cd332d", liquid: "#eb746f" },
    2048: { body: "#df433e", edge: "#ff8078", label: "#fff3f2", emissive: "#c72724", liquid: "#e96460" },
  };

  if (fixed[value]) {
    return {
      body: saturateColorStyle(fixed[value].body, 0.17),
      edge: saturateColorStyle(fixed[value].edge, 0.04),
      label: fixed[value].label,
      emissive: saturateColorStyle(fixed[value].emissive, 0.08),
      liquid: saturateColorStyle(fixed[value].liquid, 0.06),
    };
  }

  const power = Math.log2(value);
  const warmth = THREE.MathUtils.clamp((power - 11) / 8, 0, 1);
  const hue = THREE.MathUtils.lerp(8, 32, (Math.sin((power - 11) * 0.8) * 0.5 + 0.5) * 0.35 + (1 - warmth) * 0.65);
  const lightness = THREE.MathUtils.lerp(0.56, 0.48, warmth);
  return {
    body: new THREE.Color().setHSL(hue / 360, 0.82, lightness).getStyle(),
    edge: new THREE.Color().setHSL(hue / 360, 0.89, Math.min(lightness + 0.16, 0.78)).getStyle(),
    label: "#fff3ef",
    emissive: new THREE.Color().setHSL(hue / 360, 0.79, Math.max(lightness - 0.18, 0.24)).getStyle(),
    liquid: new THREE.Color().setHSL(hue / 360, 0.86, Math.min(lightness + 0.08, 0.72)).getStyle(),
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
const createBoard = (size = currentBoardSize) => {
  clearBoard();
  const boardWidth = getBoardWidth(size);
  const boardGeometry = new RoundedBoxGeometry(boardWidth, BOARD_THICKNESS, boardWidth, 10, 0.10);
  const boardMesh = new THREE.Mesh(
    boardGeometry,
    new THREE.MeshStandardMaterial({ color: "#12313d", roughness: 0.44, metalness: 0.18 }),
  );
  boardMesh.position.y = -BOARD_THICKNESS / 2;
  boardMesh.receiveShadow = true;
  boardMesh.castShadow = true;
  boardGroup.add(boardMesh);

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const slot = new THREE.Mesh(
        slotGeometry,
        new THREE.MeshStandardMaterial({ color: "#0b1d26", roughness: 0.82, metalness: 0.04 }),
      );
      slot.position.copy(gridToWorld(row, col, 0, size));
      slot.position.y = -0.03;
      slot.receiveShadow = true;
      boardGroup.add(slot);
    }
  }

  if (stageLighting.ground) {
    const groundScale = Math.max(boardWidth / 8.2, 1.2);
    stageLighting.ground.scale.set(groundScale, 1, groundScale);
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

  const label = new THREE.Mesh(
    labelGeometry,
    new THREE.MeshBasicMaterial({
      map: getLabelTexture(tile.value, palette.label),
      transparent: false,
      depthWrite: false,
      depthTest: true,
      alphaTest: 0.18,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    }),
  );
  label.rotation.x = -Math.PI / 2;
  label.renderOrder = 3;

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
 * Adjusts tower height, slice count, and top-surface label placement for one logical tile.
 * Params: `actor` is a tile render actor, `stackCount` is its logical merged layer count.
 */
const updateActorStackVisual = (actor, stackCount = 1) => {
  const visibleLayers = getVisibleLayerCount(stackCount);
  const towerTop = (visibleLayers - 1) * STACK_VISUAL_STEP + TILE_HEIGHT * 0.5;

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

  actor.stackRoot.scale.set(1, 1, 1);
  actor.label.position.set(0, towerTop + 0.014, 0);
  actor.shadow.visible = true;
  actor.shadow.scale.setScalar(1.12);
};

/**
 * Builds a physics body whose collision volume matches a tile's full rendered tower height.
 * Param: `actor` supplies the current tile height and world-space root position.
 */
const createTowerBody = (actor, options) => {
  const towerHeight = getTowerHeight(actor.tile.stackCount ?? 1);
  const body = new CANNON.Body(options);
  const shape = new CANNON.Box(new CANNON.Vec3(TILE_SIZE * 0.4, towerHeight * 0.52, TILE_SIZE * 0.4));
  const localOffset = new CANNON.Vec3(0, towerHeight * 0.52 - TILE_HEIGHT * 0.5, 0);
  body.addShape(shape, localOffset);
  body.fixedRotation = true;
  body.position.set(actor.group.position.x, actor.group.position.y, actor.group.position.z);
  body.updateMassProperties();
  return body;
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
  stackCount: flags.stackCount ?? getStackCountForValue(value),
  justSpawned: Boolean(flags.justSpawned),
  justMerged: Boolean(flags.justMerged),
});

/**
 * Loads the best score from localStorage without making persistence mandatory.
 * Usage boundary: storage failures should never interrupt play.
 */
const loadBestScore = (size = currentBoardSize) => {
  try {
    return Number(window.localStorage.getItem(getBestScoreKey(size))) || 0;
  } catch (error) {
    return 0;
  }
};

/**
 * Saves the best score after a successful state commit.
 * Param: `value` must already be a validated non-negative integer.
 */
const saveBestScore = (value, size = currentBoardSize) => {
  try {
    window.localStorage.setItem(getBestScoreKey(size), String(value));
  } catch (error) {
    // Persistence is optional and should not block gameplay.
  }
};

/**
 * Strips transient render-only flags before state persistence or stable re-use.
 * Param: `sourceState` is a committed gameplay snapshot.
 */
const getSettledState = (sourceState) => ({
  ...sourceState,
  tiles: sourceState.tiles.map((tile) => ({
    ...tile,
    justSpawned: false,
    justMerged: false,
  })),
});

const cloneStateSnapshot = (sourceState) => getSettledState(sourceState);

const createPersistedStateSnapshot = (sourceState) => {
  const snapshot = getSettledState(sourceState);
  return {
    size: snapshot.size,
    score: snapshot.score,
    best: snapshot.best,
    won: snapshot.won,
    continued: snapshot.continued,
    over: snapshot.over,
    nextId: snapshot.nextId,
    tiles: snapshot.tiles.map((tile) => ({
      id: tile.id,
      value: tile.value,
      row: tile.row,
      col: tile.col,
      stackCount: tile.stackCount,
    })),
  };
};

const restorePersistedStateSnapshot = (parsed, expectedSize = null) => {
  if (!BOARD_SIZE_OPTIONS.includes(parsed?.size) || !Array.isArray(parsed?.tiles)) {
    return null;
  }

  const size = parsed.size;
  const limit = size * size;
  if (
    (expectedSize !== null && size !== expectedSize) ||
    !Number.isFinite(parsed.score) ||
    !Number.isFinite(parsed.best) ||
    !Number.isFinite(parsed.nextId) ||
    parsed.score < 0 ||
    parsed.best < 0 ||
    parsed.nextId < 1 ||
    parsed.tiles.length > limit
  ) {
    return null;
  }

  const occupied = new Set();
  const tiles = [];
  for (const tile of parsed.tiles) {
    if (
      !Number.isInteger(tile?.id) ||
      !Number.isFinite(tile?.value) ||
      !Number.isInteger(tile?.row) ||
      !Number.isInteger(tile?.col) ||
      tile.row < 0 ||
      tile.row >= size ||
      tile.col < 0 ||
      tile.col >= size ||
      tile.value < 2
    ) {
      return null;
    }

    const key = getCellKey(tile.row, tile.col);
    if (occupied.has(key)) {
      return null;
    }
    occupied.add(key);

    tiles.push(createTile(tile.id, tile.value, tile.row, tile.col, {
      stackCount: Number.isFinite(tile.stackCount) ? tile.stackCount : getStackCountForValue(tile.value),
    }));
  }

  return {
    size,
    score: parsed.score,
    best: Math.max(parsed.best, loadBestScore(size)),
    won: Boolean(parsed.won),
    continued: Boolean(parsed.continued),
    over: Boolean(parsed.over),
    nextId: parsed.nextId,
    tiles,
  };
};

const updateUndoUi = () => {
  undoButtonEl.textContent = undoHistory.length > 0 ? `退回 (${undoHistory.length})` : "退回";
  undoButtonEl.disabled = inputLocked || undoHistory.length === 0;
};

const pushUndoState = (sourceState) => {
  undoHistory.push(cloneStateSnapshot(sourceState));
  if (undoHistory.length > MAX_UNDO_STEPS) {
    undoHistory = undoHistory.slice(-MAX_UNDO_STEPS);
  }
};

/**
 * Saves the current playable snapshot so the next page load can restore it.
 * Param: `sourceState` must already be a committed gameplay state.
 */
const saveGameState = (sourceState) => {
  try {
    const snapshot = createPersistedStateSnapshot(sourceState);
    window.localStorage.setItem(SAVED_GAME_KEY, JSON.stringify({
      ...snapshot,
      history: undoHistory.map((entry) => createPersistedStateSnapshot(entry)),
    }));
  } catch (error) {
    // Persistence is optional and should not interrupt play.
  }
};

/**
 * Loads and validates the last saved game snapshot from localStorage.
 * Usage boundary: call during bootstrap only, then hand control back to normal factories.
 */
const loadSavedGame = () => {
  try {
    const raw = window.localStorage.getItem(SAVED_GAME_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    const restoredState = restorePersistedStateSnapshot(parsed);
    if (!restoredState) {
      return null;
    }

    const history = [];
    if (parsed.history !== undefined) {
      if (!Array.isArray(parsed.history)) {
        return null;
      }

      for (const entry of parsed.history.slice(-MAX_UNDO_STEPS)) {
        const restoredEntry = restorePersistedStateSnapshot(entry, restoredState.size);
        if (!restoredEntry) {
          return null;
        }
        history.push(restoredEntry);
      }
    }

    return { state: restoredState, history };
  } catch (error) {
    return null;
  }
};

/**
 * Builds a state snapshot from explicit tile specs without random spawning.
 * Param: `tileSpecs` is an array of `{ value, row, col }` objects.
 */
const createStateFromTiles = (tileSpecs, size = currentBoardSize) => ({
  size,
  score: 0,
  best: loadBestScore(size),
  won: false,
  continued: false,
  over: false,
  nextId: tileSpecs.length + 1,
  tiles: tileSpecs.map((tile, index) => createTile(index + 1, tile.value, tile.row, tile.col)),
});

/**
 * Builds a debug board where one left move immediately merges a large tile pair.
 * Param: `mergeValue` is the tile number produced after the next merge.
 */
const createDebugMergeState = (mergeValue) => {
  const size = currentBoardSize;
  const centerRow = Math.floor(size / 2);
  const anchorCol = Math.max(1, Math.floor(size / 2) - 1);
  const sideCol = size - 1;

  return createStateFromTiles([
    { value: mergeValue / 2, row: centerRow, col: anchorCol },
    { value: mergeValue / 2, row: centerRow, col: anchorCol + 1 },
    { value: 64, row: 0, col: sideCol },
    { value: 32, row: Math.min(centerRow + 1, size - 1), col: sideCol },
    { value: 16, row: size - 1, col: sideCol },
  ], size);
};

/**
 * Returns all empty cells for the provided tile set.
 * Param: `tiles` is the canonical tile collection of the board.
 */
const getEmptyCells = (tiles, size = currentBoardSize) => {
  const occupied = new Set(tiles.map((tile) => `${tile.row}:${tile.col}`));
  const cells = [];

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
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
  const boardSize = getBoardSize(sourceState);
  const emptyCells = getEmptyCells(sourceState.tiles, boardSize);
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
      createTile(sourceState.nextId, value, cell.row, cell.col, { justSpawned: true }),
    ],
  };
};

/**
 * Builds a fresh match state with the standard two opening tiles.
 * Usage boundary: shared by startup and all restart paths.
 */
const createInitialState = () => addRandomTile(addRandomTile({
  size: currentBoardSize,
  score: 0,
  best: loadBestScore(currentBoardSize),
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
const projectTile = (tile, direction, size = currentBoardSize) => {
  switch (direction) {
    case "left":
      return { line: tile.row, offset: tile.col };
    case "right":
      return { line: tile.row, offset: size - 1 - tile.col };
    case "up":
      return { line: tile.col, offset: tile.row };
    case "down":
      return { line: tile.col, offset: size - 1 - tile.row };
    default:
      throw new Error(`Unsupported direction: ${direction}`);
  }
};

/**
 * Restores normalized move coordinates back into row/col board positions.
 * Params: `line` and `offset` must come from the normalized move pipeline.
 */
const restoreCoord = (line, offset, direction, size = currentBoardSize) => {
  switch (direction) {
    case "left":
      return { row: line, col: offset };
    case "right":
      return { row: line, col: size - 1 - offset };
    case "up":
      return { row: offset, col: line };
    case "down":
      return { row: size - 1 - offset, col: line };
    default:
      throw new Error(`Unsupported direction: ${direction}`);
  }
};

/**
 * Checks whether the board still has at least one legal 2048 move.
 * Param: `tiles` is the canonical logical tile collection for one board state.
 */
const hasLegalMoves = (tiles, size = currentBoardSize) => {
  if (tiles.length < size * size) {
    return true;
  }

  const grid = new Map(tiles.map((tile) => [getCellKey(tile.row, tile.col), tile.value]));
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
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
  const boardSize = getBoardSize(sourceState);
  const projected = sourceState.tiles.map((tile) => ({ tile, ...projectTile(tile, direction, boardSize) }));
  const resultTiles = [];
  const moveEntries = [];
  const mergePairs = [];
  let nextId = sourceState.nextId;
  let scoreGain = 0;
  let reached2048 = sourceState.won;

  for (let lineIndex = 0; lineIndex < boardSize; lineIndex += 1) {
    const lineTiles = projected
      .filter((entry) => entry.line === lineIndex)
      .sort((a, b) => a.offset - b.offset);

    let sourceIndex = 0;
    let targetOffset = 0;

    while (sourceIndex < lineTiles.length) {
      const current = lineTiles[sourceIndex];
      const next = lineTiles[sourceIndex + 1];
      const target = restoreCoord(lineIndex, targetOffset, direction, boardSize);

      if (next && next.tile.value === current.tile.value) {
        const mergedValue = current.tile.value * 2;

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
          stackCount: getStackCountForValue(current.tile.value),
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
      over: !hasLegalMoves(withSpawn.tiles, boardSize),
    },
  };
};

/**
 * Updates the HUD and persists any newly achieved best score.
 * Usage boundary: call only after a committed state change.
 */
const renderHud = () => {
  const persistedBest = Math.max(state.best, loadBestScore(state.size));
  if (persistedBest !== state.best) {
    state = { ...state, best: persistedBest };
  }
  scoreEl.textContent = String(state.score);
  bestEl.textContent = String(persistedBest);
  saveBestScore(persistedBest, state.size);
  updateUndoUi();
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
const addTween = ({
  duration,
  delay = 0,
  easing = (value) => value,
  onUpdate,
  onComplete,
  skipMode = "complete",
}) => (
  new Promise((resolve) => {
    if (skipAnimationsRequested) {
      if (skipMode !== "cancel") {
        onUpdate?.(easing(1), 1);
        onComplete?.();
      }
      resolve();
      return;
    }

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
 * Applies a temporary merge scale so source tiles do not visually mush into each other.
 * Params: `actor` is the render actor and `scale` is the temporary merge scale multiplier.
 */
const setMergeContactScale = (actor, scale = 1) => {
  actor.group.scale.set(scale, scale * 0.98, scale);
};

/**
 * Plays a short impact wobble to sell cube compression and rebound after a collision.
 * Params: `axis` is the collision direction, `strength` scales wobble amplitude.
 */
const playCollisionWobble = (actor, axis, strength = 1, duration = 0.18) => addTween({
  duration,
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
 * Scales merge shake intensity and duration from the post-merge tile value.
 * Param: `mergedValue` is the final tile number created by the merge.
 */
const getMergeFeedbackProfile = (mergedValue) => {
  const power = Math.max(2, Math.log2(mergedValue));
  const normalized = THREE.MathUtils.clamp((power - 2) / 9, 0, 1);
  const heavyweight = THREE.MathUtils.clamp((power - 9) / 2, 0, 1);
  return {
    stage: 0.18 + normalized * 0.16 + heavyweight * 0.1,
    finalStage: 0.34 + normalized * 0.3 + heavyweight * 0.2,
    frontStrength: 0.78 + normalized * 0.52 + heavyweight * 0.12,
    backStrength: 1.02 + normalized * 0.58 + heavyweight * 0.16,
    finalStrength: 0.72 + normalized * 0.5 + heavyweight * 0.12,
    duration: 0.17 + normalized * 0.08 + heavyweight * 0.03,
  };
};

/**
 * Plays the merge shake and sound after the merged tile has appeared on the board.
 * Params: `tile` is the committed merged tile, `direction` is the source merge direction.
 */
const triggerMergedTileFeedback = (tile, direction) => {
  const actor = tileActors.get(tile.id);
  if (!actor) {
    return;
  }

  const feedback = getMergeFeedbackProfile(tile.value);
  const axis = directionVectors[direction] ?? new THREE.Vector3(0.7, 0, 1);

  addTween({
    duration: 0.001,
    delay: 0.16,
    skipMode: "cancel",
    onUpdate: () => {},
    onComplete: () => {
      stageImpulse = Math.max(stageImpulse, feedback.finalStage);
      playCollisionWobble(actor, axis, feedback.finalStrength, feedback.duration);
      playMergeSound(tile.value);
    },
  });
};

/**
 * Moves the two merging tiles into a vertical drop staging pose over the target cell.
 * Params: `baseActor` settles on the board, `fallingActor` is lifted above for gravity drop.
 */
const animateMergeDropSetup = (baseActor, fallingActor, targetPosition, baseTargetPosition = targetPosition) => {
  const fallingStart = fallingActor.group.position.clone();
  const raisedTarget = targetPosition.clone();
  raisedTarget.y += MERGE_DROP_HEIGHT + getTowerLift(baseActor.tile.stackCount ?? 1);

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
      duration: 0.09,
      easing: (value) => 1 - (1 - value) ** 3,
      onUpdate: (progress) => {
        baseActor.group.position.lerpVectors(baseStart, bottomTarget, progress);
        fallingActor.group.position.lerpVectors(fallingStart, topTarget, progress);
        fallingActor.group.position.y += Math.sin(progress * Math.PI) * 0.04;
      },
    }).then(() => addTween({
      duration: 0.06,
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

      const baseBody = createTowerBody(baseActor, { mass: 0, material });
      const fallingBody = createTowerBody(fallingActor, {
        mass: 0.95,
        material,
        linearDamping: 0.06,
        angularDamping: 1,
      });

      baseBody.position.set(basePosition.x, basePosition.y, basePosition.z);
      fallingBody.position.set(
        targetPosition.x,
        targetPosition.y + MERGE_DROP_HEIGHT + getTowerLift(baseActor.tile.stackCount ?? 1),
        targetPosition.z,
      );

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
    setMergeContactScale(baseActor, 0.94);
    setMergeContactScale(fallingActor, 0.94);

    animateMergeDropSetup(baseActor, fallingActor, targetPosition).then(() => {
      if (skipAnimationsRequested) {
        setMergeContactScale(baseActor, 1);
        setMergeContactScale(fallingActor, 1);
        resolve();
        return;
      }

      const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -28, 0) });
      world.solver.iterations = 10;

      const material = new CANNON.Material("tile-material");
      world.addContactMaterial(new CANNON.ContactMaterial(material, material, {
        friction: 0.02,
        restitution: 0.34,
      }));

      const baseBody = createTowerBody(baseActor, {
        mass: 0,
        material,
      });
      const fallingBody = createTowerBody(fallingActor, {
        mass: 0.95,
        material,
        linearDamping: 0.06,
        angularDamping: 1,
      });

      baseBody.position.set(targetPosition.x, targetPosition.y, targetPosition.z);
      fallingBody.position.set(
        targetPosition.x,
        targetPosition.y + MERGE_DROP_HEIGHT + getTowerLift(baseActor.tile.stackCount ?? 1),
        targetPosition.z,
      );

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
  const wobbleAxis = simulation.collisionAxis ?? directionVectors[simulation.mergePair?.direction] ?? new THREE.Vector3(1, 0, 0);

  if (!simulation.stackOnly) {
    return;
  }

  stageImpulse = Math.max(stageImpulse, 0.18);
  playCollisionWobble(simulation.frontActor, wobbleAxis, 0.8, 0.18);
  playCollisionWobble(simulation.backActor, wobbleAxis, 1.15, 0.18);
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
  const wobbleAxis = simulation.collisionAxis ?? directionVectors[simulation.mergePair?.direction] ?? new THREE.Vector3(1, 0, 0);

  if (simulation.stackOnly) {
    stageImpulse = Math.max(stageImpulse, 0.28);
    playCollisionWobble(simulation.frontActor, wobbleAxis, 0.8, 0.18);
    playCollisionWobble(simulation.backActor, wobbleAxis, 0.8, 0.18);
    startStackMergeEffect({
      baseActor: simulation.frontActor,
      fallingActor: simulation.backActor,
      targetPosition: simulation.targetPosition,
    }).then(() => {
      simulation.frontActor.tile.level = simulation.targetLevel - 1;
      simulation.backActor.tile.level = simulation.targetLevel;
      simulation.frontActor.group.position.copy(gridToWorld(simulation.targetRow, simulation.targetCol, simulation.targetLevel - 1));
      simulation.backActor.group.position.copy(gridToWorld(simulation.targetRow, simulation.targetCol, simulation.targetLevel));
      updateActorStackVisual(simulation.frontActor, simulation.stackSize);
      updateActorStackVisual(simulation.backActor, simulation.stackSize);
      simulation.resolve();
      simulation.done = true;
      simulation.phase = "done";
    });
    return;
  }

  setMergeContactScale(simulation.frontActor, 1);
  setMergeContactScale(simulation.backActor, 1);
  removeTileActor(simulation.mergePair.sourceIds[0]);
  removeTileActor(simulation.mergePair.sourceIds[1]);
  simulation.resolve();
  simulation.done = true;
  simulation.phase = "done";
};

/**
 * Forces one active merge simulation into its finished visual state.
 * Param: `simulation` is one entry currently tracked in `mergeSimulations`.
 */
const finalizeMergeSimulation = (simulation) => {
  if (simulation.done) {
    return;
  }

  if (simulation.stackOnly) {
    simulation.frontActor.tile.level = simulation.targetLevel - 1;
    simulation.backActor.tile.level = simulation.targetLevel;
    simulation.frontActor.group.position.copy(gridToWorld(simulation.targetRow, simulation.targetCol, simulation.targetLevel - 1));
    simulation.backActor.group.position.copy(gridToWorld(simulation.targetRow, simulation.targetCol, simulation.targetLevel));
    updateActorStackVisual(simulation.frontActor, simulation.stackSize);
    updateActorStackVisual(simulation.backActor, simulation.stackSize);
  } else if (simulation.mergePair) {
    setMergeContactScale(simulation.frontActor, 1);
    setMergeContactScale(simulation.backActor, 1);
    removeTileActor(simulation.mergePair.sourceIds[0]);
    removeTileActor(simulation.mergePair.sourceIds[1]);
  }

  simulation.resolve?.();
  simulation.done = true;
  simulation.phase = "done";
};

/**
 * Immediately completes all current visual animations so rapid inputs can chain moves.
 * Usage boundary: call only when a new direction arrives during `inputLocked`.
 */
const skipActiveAnimations = () => {
  if (!inputLocked) {
    return;
  }

  skipAnimationsRequested = true;

  for (let index = tweens.length - 1; index >= 0; index -= 1) {
    const tween = tweens[index];
    tween.onUpdate?.(tween.easing(1), 1);
    tween.onComplete?.();
    tween.resolve();
  }
  tweens.length = 0;

  for (let index = mergeSimulations.length - 1; index >= 0; index -= 1) {
    finalizeMergeSimulation(mergeSimulations[index]);
  }
  mergeSimulations.length = 0;

  queueMicrotask(() => {
    skipAnimationsRequested = false;
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
 * Applies the short board-wide recoil caused by invalid inputs and merge impacts.
 * Param: `delta` is the current frame delta time in seconds.
 */
const updateStageImpulse = (delta) => {
  stageTime += delta;
  stageImpulse *= 0.9;
  worldRoot.rotation.z = Math.sin(stageTime * 28) * 0.048 * stageImpulse;
  worldRoot.rotation.x = Math.sin(stageTime * 18) * 0.024 * stageImpulse;
  worldRoot.position.y = Math.sin(stageTime * 40) * 0.112 * stageImpulse;
};

/**
 * Raises the fixed overhead camera as towers grow so tall stacks stay framed.
 * Param: `delta` is the current frame delta time in seconds.
 */
const updateCameraFraming = (delta) => {
  const boardSizeLift = Math.max(currentBoardSize - DEFAULT_BOARD_SIZE, 0);
  const tallestHeight = getTallestTowerHeight(state?.tiles ?? []);
  const highestTileValue = getHighestTileValue(state?.tiles ?? []);
  const extraHeight = Math.max(tallestHeight - TILE_HEIGHT * 3.2, 0);
  const heightProgress = THREE.MathUtils.clamp(
    extraHeight / Math.max(getTowerHeight(getStackCountForValue(2048)) - TILE_HEIGHT * 3.2, 1),
    0,
    1,
  );
  const valueProgress = THREE.MathUtils.clamp((Math.log2(highestTileValue) - 6) / 3.2, 0, 1);
  const topDownProgress = state?.won
    ? 1
    : THREE.MathUtils.clamp(Math.max(heightProgress * 1.18, valueProgress * 1.1), 0, 1);
  const easedTopDown = 1 - (1 - topDownProgress) ** 2.4;
  const baseTargetY = BASE_CAMERA_Y + boardSizeLift * 1.18 + extraHeight * 1.7;
  const baseTargetZ = BASE_CAMERA_Z + boardSizeLift * 0.96 + extraHeight * 0.55;
  const baseLookAtY = BASE_LOOK_AT_Y + boardSizeLift * 0.08 + extraHeight * 0.38;
  const targetY = baseTargetY + easedTopDown * (2.75 + boardSizeLift * 0.72);
  const targetZ = THREE.MathUtils.lerp(baseTargetZ, 0.08 + boardSizeLift * 0.04, easedTopDown);
  const lookAtY = THREE.MathUtils.lerp(baseLookAtY, 0.7 + extraHeight * 0.78, easedTopDown);
  const blend = 1 - Math.exp(-delta * 7.5);
  const lightingBoost = Math.min(extraHeight, 8);
  cameraUpCurrent.lerpVectors(cameraUpBase, cameraUpTopDown, easedTopDown).normalize();
  const stableFov = getStableBoardFov({
    size: currentBoardSize,
    cameraY: targetY,
    cameraZ: targetZ,
    lookAtY,
  });
  const safeFov = getRequiredFovForFraming({
    size: currentBoardSize,
    tallestHeight,
    cameraY: targetY,
    cameraZ: targetZ,
    lookAtY,
    up: cameraUpCurrent,
  });
  const targetFov = Math.min(safeFov, stableFov + 1.2);

  camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, blend);
  camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, blend);
  camera.up.copy(cameraUpCurrent);
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, blend);
  camera.updateProjectionMatrix();
  camera.lookAt(0, lookAtY, 0);

  scene.fog.density = THREE.MathUtils.lerp(
    BASE_FOG_DENSITY,
    MIN_FOG_DENSITY,
    THREE.MathUtils.clamp(extraHeight / 8, 0, 1),
  );

  if (stageLighting.keyLight) {
    stageLighting.hemisphere.intensity = 1.4 + lightingBoost * 0.08;
    stageLighting.keyLight.intensity = 1.9 + lightingBoost * 0.08;
    stageLighting.keyLight.position.set(4.8, 10 + boardSizeLift * 0.55 + lightingBoost * 0.85, 3.2 + lightingBoost * 0.24);
    const shadowExtent = 7 + boardSizeLift * 1.1 + lightingBoost * 0.55;
    stageLighting.keyLight.shadow.camera.left = -shadowExtent;
    stageLighting.keyLight.shadow.camera.right = shadowExtent;
    stageLighting.keyLight.shadow.camera.top = shadowExtent;
    stageLighting.keyLight.shadow.camera.bottom = -shadowExtent;
    stageLighting.keyLight.shadow.camera.far = 24 + lightingBoost * 2.4;
    stageLighting.keyLight.shadow.camera.updateProjectionMatrix();
    stageLighting.rimLight.intensity = 24 + lightingBoost * 1.4;
    stageLighting.rimLight.position.set(-4.4, 4.4 + lightingBoost * 0.26, -3.2);
    stageLighting.warmLift.intensity = 18 + lightingBoost * 0.95;
    stageLighting.warmLift.position.set(4.2, 2.8 + lightingBoost * 0.18, 5.4 + lightingBoost * 0.12);
    stageLighting.baseFill.intensity = 14 + lightingBoost * 1.5;
    stageLighting.baseFill.position.set(0, 1.5 + lightingBoost * 0.08, 4.8 + lightingBoost * 0.2);
    stageLighting.ground.material.opacity = 0.3 - Math.min(lightingBoost * 0.01, 0.08);
  }
};

/**
 * Runs one full 2048 move, coordinating deterministic logic with render and physics effects.
 * Param: `direction` must be one of the normalized movement directions.
 */
const performMove = async (direction) => {
  if (inputLocked) {
    queuedDirection = direction;
    skipActiveAnimations();
    return;
  }

  const plan = buildMovePlan(state, direction);
  if (!plan) {
    stageImpulse = Math.max(stageImpulse, 0.14);
    return;
  }

  const previousState = cloneStateSnapshot(state);
  inputLocked = true;
  updateUndoUi();
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
  const mergedTiles = state.tiles.filter((tile) => tile.justMerged);
  mergedTiles.forEach((tile, index) => {
    triggerMergedTileFeedback(tile, plan.mergePairs[index]?.direction);
  });
  state = getSettledState(state);
  pushUndoState(previousState);
  inputLocked = false;
  renderHud();
  renderOverlayFromState();
  saveGameState(state);
};

/**
 * Maps keyboard input into game moves and prevents page scrolling.
 * Usage boundary: bind once to `window` during initialization.
 */
const handleKeydown = (event) => {
  if (event.key.toLowerCase() === "z" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    primeAudioContext();
    applyUndo();
    return;
  }

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
  primeAudioContext();
  performMove(direction);
};

const beginSwipeTracking = (pointerId, clientX, clientY) => {
  primeAudioContext();
  swipePointerId = pointerId;
  swipeStartX = clientX;
  swipeStartY = clientY;
  swipeLastX = clientX;
  swipeLastY = clientY;
};

const updateSwipeTracking = (pointerId, clientX, clientY) => {
  if (pointerId !== swipePointerId) {
    return false;
  }

  swipeLastX = clientX;
  swipeLastY = clientY;
  return true;
};

const finishSwipeTracking = (pointerId) => {
  if (pointerId !== swipePointerId) {
    return;
  }

  const deltaX = swipeLastX - swipeStartX;
  const deltaY = swipeLastY - swipeStartY;
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  swipePointerId = null;

  if (Math.max(absX, absY) < MIN_SWIPE_DISTANCE) {
    return;
  }

  const direction = absX >= absY
    ? (deltaX < 0 ? "left" : "right")
    : (deltaY < 0 ? "up" : "down");

  performMove(direction);
};

const cancelSwipeTracking = (pointerId) => {
  if (pointerId === swipePointerId) {
    swipePointerId = null;
  }
};

/**
 * Starts tracking a touch-style swipe on the 3D viewport.
 * Usage boundary: binds to the renderer canvas and ignores secondary pointers.
 */
const handleSwipeStart = (event) => {
  if (!event.isPrimary) {
    return;
  }

  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }

  beginSwipeTracking(event.pointerId, event.clientX, event.clientY);
  renderer.domElement.setPointerCapture?.(event.pointerId);
};

/**
 * Updates the tracked swipe coordinates while the primary pointer moves.
 * Usage boundary: keeps the latest drag endpoint for swipe direction resolution.
 */
const handleSwipeMove = (event) => {
  updateSwipeTracking(event.pointerId, event.clientX, event.clientY);
};

/**
 * Resolves the tracked swipe into a move direction once the pointer is released.
 * Usage boundary: only fires for meaningful drags to avoid accidental taps.
 */
const handleSwipeEnd = (event) => {
  if (event.pointerId !== swipePointerId) {
    return;
  }

  renderer.domElement.releasePointerCapture?.(event.pointerId);
  finishSwipeTracking(event.pointerId);
};

/**
 * Cancels the active swipe without triggering a move.
 * Usage boundary: used for pointer cancellation or interrupted gestures.
 */
const handleSwipeCancel = (event) => {
  if (event.pointerId !== swipePointerId) {
    return;
  }

  renderer.domElement.releasePointerCapture?.(event.pointerId);
  cancelSwipeTracking(event.pointerId);
};

const handleTouchStart = (event) => {
  if (swipePointerId !== null || event.changedTouches.length === 0) {
    return;
  }

  const touch = event.changedTouches[0];
  beginSwipeTracking(`touch:${touch.identifier}`, touch.clientX, touch.clientY);
  event.preventDefault();
};

const handleTouchMove = (event) => {
  if (typeof swipePointerId !== "string" || !swipePointerId.startsWith("touch:")) {
    return;
  }

  const touchId = Number(swipePointerId.slice(6));
  const touch = Array.from(event.changedTouches).find((item) => item.identifier === touchId);
  if (!touch) {
    return;
  }

  updateSwipeTracking(swipePointerId, touch.clientX, touch.clientY);
  event.preventDefault();
};

const handleTouchEnd = (event) => {
  if (typeof swipePointerId !== "string" || !swipePointerId.startsWith("touch:")) {
    return;
  }

  const touchId = Number(swipePointerId.slice(6));
  const touch = Array.from(event.changedTouches).find((item) => item.identifier === touchId);
  if (!touch) {
    return;
  }

  updateSwipeTracking(swipePointerId, touch.clientX, touch.clientY);
  finishSwipeTracking(swipePointerId);
  event.preventDefault();
};

const handleTouchCancel = (event) => {
  if (typeof swipePointerId !== "string" || !swipePointerId.startsWith("touch:")) {
    return;
  }

  const touchId = Number(swipePointerId.slice(6));
  const cancelled = Array.from(event.changedTouches).some((item) => item.identifier === touchId);
  if (!cancelled) {
    return;
  }

  cancelSwipeTracking(swipePointerId);
};

/**
 * Syncs the debug panel with the current mode and active preset.
 * Usage boundary: call after every debug mode or preset change.
 */
const renderDebugUi = () => {
  debugPanelEl.classList.toggle("hidden", !debugMode);
  debugToggleButtonEl.classList.toggle("is-active", debugMode);
  debugToggleButtonEl.textContent = debugMode ? "关闭" : "开启";
  boardSizeSelectEl.value = String(currentBoardSize);

  debugPresetButtonEls.forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.debugPreset === activeDebugPreset);
  });
};

const restoreBoardState = (nextState) => {
  tweens.length = 0;
  mergeSimulations.length = 0;
  Array.from(tileActors.keys()).forEach(removeTileActor);
  inputLocked = false;
  queuedDirection = null;
  skipAnimationsRequested = false;
  stageImpulse = 0;
  state = cloneStateSnapshot(nextState);
  syncActorsToState(state);
  renderHud();
  renderOverlayFromState();
  saveGameState(state);
};

const applyUndo = () => {
  if (inputLocked || undoHistory.length === 0) {
    return;
  }

  const previousState = undoHistory.pop();
  restoreBoardState(previousState);
};

/**
 * Clears transient simulations and rebuilds the board from the current state factory.
 * Usage boundary: shared by startup, restart, and debug preset swaps.
 */
const restartGame = () => {
  tweens.length = 0;
  mergeSimulations.length = 0;

  Array.from(tileActors.keys()).forEach(removeTileActor);
  inputLocked = false;
  queuedDirection = null;
  skipAnimationsRequested = false;
  stageImpulse = 0;
  undoHistory = [];

  const nextState = (currentStateFactory ?? createInitialState)();
  state = nextState;
  syncActorsToState(state);
  renderHud();
  renderOverlayFromState();
  state = getSettledState(state);
  saveGameState(state);

  if (queuedDirection) {
    const nextDirection = queuedDirection;
    queuedDirection = null;
    performMove(nextDirection);
  }
};

/**
 * Enables or disables debug mode. Leaving debug mode restores the normal random opener.
 * Param: `enabled` toggles whether debug presets are available and active.
 */
const setDebugMode = (enabled) => {
  debugMode = enabled;

  if (!enabled) {
    activeDebugPreset = null;
    currentStateFactory = createInitialState;
  } else if (!activeDebugPreset) {
    activeDebugPreset = "512";
    currentStateFactory = () => createDebugMergeState(512);
  }

  renderDebugUi();
  restartGame();
};

/**
 * Loads a specific large-merge debug preset and resets the board into it.
 * Param: `mergeValue` is the tile number produced by the first left move.
 */
const loadDebugPreset = (mergeValue) => {
  activeDebugPreset = String(mergeValue);
  currentStateFactory = () => createDebugMergeState(mergeValue);
  if (!debugMode) {
    debugMode = true;
  }
  renderDebugUi();
  restartGame();
};

/**
 * Applies a new board size, rebuilds the board shell, and restarts the current mode.
 * Param: `size` must be one of the supported board size options.
 */
const setBoardSize = (size) => {
  if (!BOARD_SIZE_OPTIONS.includes(size) || size === currentBoardSize) {
    renderDebugUi();
    return;
  }

  currentBoardSize = size;
  createBoard(currentBoardSize);

  if (debugMode && activeDebugPreset) {
    currentStateFactory = () => createDebugMergeState(Number(activeDebugPreset));
  } else {
    currentStateFactory = createInitialState;
  }

  renderDebugUi();
  restartGame();
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
  updateStageImpulse(delta);
  updateCameraFraming(delta);
  renderer.render(scene, camera);
};

/**
 * Wires all UI events, builds the static scene, and starts the render loop.
 * Usage boundary: one-time application bootstrap.
 */
const init = () => {
  const restoredSession = loadSavedGame();
  if (restoredSession) {
    currentBoardSize = restoredSession.state.size;
  }

  setupStageLighting();
  createBoard(currentBoardSize);
  resizeViewport();
  currentStateFactory = debugMode ? () => createDebugMergeState(512) : createInitialState;
  activeDebugPreset = debugMode ? "512" : null;
  renderDebugUi();
  if (restoredSession) {
    undoHistory = restoredSession.history;
    state = restoredSession.state;
    syncActorsToState(state);
    renderHud();
    renderOverlayFromState();
    state = getSettledState(state);
    saveGameState(state);
  } else {
    restartGame();
  }

  restartButtonEl.addEventListener("click", () => {
    primeAudioContext();
    restartGame();
  });
  undoButtonEl.addEventListener("click", () => {
    primeAudioContext();
    applyUndo();
  });
  overlayRestartButtonEl.addEventListener("click", () => {
    primeAudioContext();
    restartGame();
  });
  continueButtonEl.addEventListener("click", () => {
    primeAudioContext();
    state = { ...state, continued: true };
    renderOverlayFromState();
    saveGameState(state);
  });
  debugToggleButtonEl.addEventListener("click", () => {
    primeAudioContext();
    setDebugMode(!debugMode);
  });
  debugPresetButtonEls.forEach((button) => {
    button.addEventListener("click", () => {
      primeAudioContext();
      loadDebugPreset(Number(button.dataset.debugPreset));
    });
  });
  boardSizeSelectEl.addEventListener("change", (event) => {
    primeAudioContext();
    setBoardSize(Number(event.target.value));
  });
  renderer.domElement.addEventListener("pointerdown", primeAudioContext, { passive: true });
  renderer.domElement.addEventListener("pointerdown", handleSwipeStart, { passive: true });
  renderer.domElement.addEventListener("pointermove", handleSwipeMove, { passive: true });
  renderer.domElement.addEventListener("pointerup", handleSwipeEnd, { passive: true });
  renderer.domElement.addEventListener("pointercancel", handleSwipeCancel, { passive: true });
  renderer.domElement.addEventListener("touchstart", handleTouchStart, { passive: false });
  renderer.domElement.addEventListener("touchmove", handleTouchMove, { passive: false });
  renderer.domElement.addEventListener("touchend", handleTouchEnd, { passive: false });
  renderer.domElement.addEventListener("touchcancel", handleTouchCancel, { passive: false });
  window.addEventListener("resize", resizeViewport);
  window.addEventListener("keydown", handleKeydown, { passive: false });
  renderer.setAnimationLoop(renderFrame);
};

init();
