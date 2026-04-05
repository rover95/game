const WORLD = {
  width: 1600,
  height: 960,
};

const TABLE = {
  left: 120,
  top: 120,
  right: 1480,
  bottom: 840,
  cornerRadius: 34,
};

const BALL_RADIUS = 16;
const BALL_DIAMETER = BALL_RADIUS * 2;
const FIXED_DT_MS = 1000 / 120;
const FIXED_DT = FIXED_DT_MS / 1000;
const FRICTION_PER_SECOND = 170;
const STOP_SPEED = 6;
const WALL_RESTITUTION = 0.94;
const BALL_RESTITUTION = 0.985;
const MAX_GUIDE_BOUNCES = 4;
const BEST_SCORE_KEY = "corner-run-billiards-best";
const POWER_MIN = 0.18;
const POWER_MAX = 1;
const POWER_SWEEP_PER_SECOND = 1.45;
const GUIDE_IMPACT_LINE_LENGTH = 180;

const POCKETS = [
  { x: TABLE.left + 18, y: TABLE.top + 18, radius: 35 },
  { x: (TABLE.left + TABLE.right) * 0.5, y: TABLE.top + 14, radius: 34 },
  { x: TABLE.right - 18, y: TABLE.top + 18, radius: 35 },
  { x: TABLE.left + 18, y: TABLE.bottom - 18, radius: 35 },
  { x: (TABLE.left + TABLE.right) * 0.5, y: TABLE.bottom - 14, radius: 34 },
  { x: TABLE.right - 18, y: TABLE.bottom - 18, radius: 35 },
];

const BALL_COLORS = [
  "#eecb5d",
  "#4875ff",
  "#d6474d",
  "#7a36d1",
  "#ff9545",
  "#43b156",
  "#943621",
  "#141414",
];

const elements = {
  stage: document.getElementById("stage"),
  strokes: document.getElementById("strokes"),
  remaining: document.getElementById("remaining"),
  roundSize: document.getElementById("round-size"),
  bestScore: document.getElementById("best-score"),
  phasePill: document.getElementById("phase-pill"),
  speedPill: document.getElementById("speed-pill"),
  powerValue: document.getElementById("power-value"),
  angleValue: document.getElementById("angle-value"),
  spinPad: document.getElementById("spin-pad"),
  spinDot: document.getElementById("spin-dot"),
  spinValue: document.getElementById("spin-value"),
  spinReset: document.getElementById("spin-reset"),
  statusText: document.getElementById("status-text"),
  fire: document.getElementById("fire"),
  newRound: document.getElementById("new-round"),
  result: document.getElementById("result"),
  resultTitle: document.getElementById("result-title"),
  resultCopy: document.getElementById("result-copy"),
  resultRestart: document.getElementById("result-restart"),
};

const ctx = elements.stage.getContext("2d");
const audioState = {
  ctx: null,
  lastImpactAt: 0,
  lastPocketAt: 0,
  lastWallAt: 0,
};

const state = {
  balls: [],
  cueBall: null,
  strokes: 0,
  remaining: 0,
  roundBallCount: 0,
  bestScores: loadBestScores(),
  power: 0.68,
  aimAngle: 0,
  cueSpin: { x: 0, y: 0 },
  phase: "idle",
  moving: false,
  scratchPending: false,
  won: false,
  chargeDirection: 1,
  spinPadDragging: false,
  statusText: "清掉所有彩球即可过关。白球落袋会在停稳后重摆。",
  lastFrameTime: 0,
  accumulator: 0,
  layout: {
    width: 0,
    height: 0,
    pixelWidth: 0,
    pixelHeight: 0,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  },
};

function loadBestScores() {
  try {
    const raw = window.localStorage.getItem(BEST_SCORE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(([count, strokes]) => {
        return Number.isInteger(Number(count)) && Number.isInteger(strokes) && Number(count) > 0 && strokes > 0;
      }),
    );
  } catch (error) {
    console.warn("无法读取最佳成绩", error);
  }

  return {};
}

function saveBestScores() {
  try {
    window.localStorage.setItem(BEST_SCORE_KEY, JSON.stringify(state.bestScores));
  } catch (error) {
    console.warn("无法保存最佳成绩", error);
  }
}

function bestForCurrentCount() {
  return state.bestScores[String(state.roundBallCount)] ?? null;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleToDegrees(radians) {
  const degrees = ((radians * 180) / Math.PI + 360) % 360;
  return Math.round(degrees);
}

function colorWithAlpha(color, alpha) {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const normalized = hex.length === 3
      ? hex.split("").map((part) => part + part).join("")
      : hex;
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  if (color.startsWith("rgba(")) {
    return color.replace(/rgba\((.+),\s*[\d.]+\)/, `rgba($1, ${alpha})`);
  }

  if (color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  }

  return color;
}

function reflect(direction, normal) {
  const dot = direction.x * normal.x + direction.y * normal.y;
  return {
    x: direction.x - 2 * dot * normal.x,
    y: direction.y - 2 * dot * normal.y,
  };
}

function setCueSpin(x, y) {
  const magnitude = Math.hypot(x, y);
  if (magnitude > 1) {
    state.cueSpin.x = x / magnitude;
    state.cueSpin.y = y / magnitude;
  } else {
    state.cueSpin.x = x;
    state.cueSpin.y = y;
  }
}

function describeCueSpin() {
  const { x, y } = state.cueSpin;
  const parts = [];

  if (y < -0.22) {
    parts.push(Math.abs(y) > 0.72 ? "强上旋" : "上旋");
  } else if (y > 0.22) {
    parts.push(Math.abs(y) > 0.72 ? "强低杆" : "低杆");
  }

  if (x < -0.22) {
    parts.push(Math.abs(x) > 0.72 ? "强左塞" : "左塞");
  } else if (x > 0.22) {
    parts.push(Math.abs(x) > 0.72 ? "强右塞" : "右塞");
  }

  if (!parts.length) {
    return "当前: 中杆";
  }

  return `当前: ${parts.join(" + ")}`;
}

function updateSpinUi() {
  const rect = elements.spinPad.getBoundingClientRect();
  const range = Math.max(1, Math.min(rect.width, rect.height) * 0.5 - 18);
  elements.spinDot.style.left = `calc(50% + ${state.cueSpin.x * range}px)`;
  elements.spinDot.style.top = `calc(50% + ${state.cueSpin.y * range}px)`;
  elements.spinValue.textContent = describeCueSpin();
}

function createBall(kind, x, y, index = 0) {
  const color = kind === "cue"
    ? "#f7f6ef"
    : BALL_COLORS[index % BALL_COLORS.length];

  return {
    id: `${kind}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    number: kind === "cue" ? 0 : index + 1,
    x,
    y,
    vx: 0,
    vy: 0,
    radius: BALL_RADIUS,
    color,
    potted: false,
    spin: 0,
    spinAxis: 0,
    sideSpin: 0,
    forwardSpin: 0,
  };
}

function allActiveBalls() {
  return state.balls.filter((ball) => !ball.potted);
}

function targetBalls() {
  return state.balls.filter((ball) => ball.kind === "target" && !ball.potted);
}

function canPlaceBall(x, y, ignoreId = null) {
  const outOfPocket = POCKETS.every((pocket) => distance({ x, y }, pocket) > pocket.radius + 18);
  if (!outOfPocket) {
    return false;
  }

  return allActiveBalls().every((ball) => {
    if (ball.id === ignoreId) {
      return true;
    }
    return distance({ x, y }, ball) > BALL_DIAMETER + 6;
  });
}

function respotCueBall() {
  const cue = state.cueBall;
  if (!cue) {
    return;
  }

  const spots = [];
  const baseX = TABLE.left + (TABLE.right - TABLE.left) * 0.24;
  const baseY = (TABLE.top + TABLE.bottom) * 0.5;
  for (let ring = 0; ring < 10; ring += 1) {
    const radius = ring * 34;
    const points = ring === 0 ? 1 : 10 + ring * 6;
    for (let index = 0; index < points; index += 1) {
      const angle = (Math.PI * 2 * index) / points;
      spots.push({
        x: baseX + Math.cos(angle) * radius,
        y: baseY + Math.sin(angle) * radius,
      });
    }
  }

  const chosen = spots.find((spot) => (
    spot.x > TABLE.left + BALL_RADIUS
    && spot.x < TABLE.right - BALL_RADIUS
    && spot.y > TABLE.top + BALL_RADIUS
    && spot.y < TABLE.bottom - BALL_RADIUS
    && canPlaceBall(spot.x, spot.y, cue.id)
  ));

  if (!chosen) {
    return;
  }

  cue.x = chosen.x;
  cue.y = chosen.y;
  cue.vx = 0;
  cue.vy = 0;
  cue.sideSpin = 0;
  cue.forwardSpin = 0;
  cue.potted = false;
  state.aimAngle = 0;
}

function createRandomRack() {
  state.balls = [];
  state.strokes = 0;
  state.scratchPending = false;
  state.moving = false;
  state.won = false;
  state.phase = "idle";
  state.power = 0.68;
  state.chargeDirection = 1;
  setCueSpin(0, 0);
  elements.result.classList.add("hidden");

  const cue = createBall(
    "cue",
    TABLE.left + (TABLE.right - TABLE.left) * 0.24,
    (TABLE.top + TABLE.bottom) * 0.5,
  );
  state.balls.push(cue);
  state.cueBall = cue;
  state.aimAngle = 0;

  const count = randInt(4, 8);
  state.roundBallCount = count;

  for (let index = 0; index < count; index += 1) {
    let placed = false;
    for (let attempt = 0; attempt < 800 && !placed; attempt += 1) {
      const x = rand(TABLE.left + (TABLE.right - TABLE.left) * 0.52, TABLE.right - 96);
      const y = rand(TABLE.top + 70, TABLE.bottom - 70);
      if (!canPlaceBall(x, y)) {
        continue;
      }

      const ball = createBall("target", x, y, index);
      state.balls.push(ball);
      placed = true;
    }
  }

  state.remaining = targetBalls().length;
  state.statusText = `本局随机生成了 ${state.remaining} 颗目标球。右键进入瞄准模式。`;
  updateHud();
}

function getAudioContext() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) {
    return null;
  }

  if (!audioState.ctx) {
    audioState.ctx = new AudioCtor();
  }

  if (audioState.ctx.state === "suspended") {
    audioState.ctx.resume().catch(() => {});
  }

  return audioState.ctx;
}

function playTone({
  frequency,
  duration = 0.08,
  type = "sine",
  volume = 0.04,
  attack = 0.004,
  endFrequency = null,
}) {
  const audioCtx = getAudioContext();
  if (!audioCtx) {
    return;
  }

  const now = audioCtx.currentTime;
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  if (endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), now + duration);
  }

  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(volume, now + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

function playImpactSound(strength) {
  const now = performance.now();
  if (now - audioState.lastImpactAt < 26) {
    return;
  }

  audioState.lastImpactAt = now;
  const intensity = clamp(strength / 720, 0.12, 1);
  playTone({
    frequency: 180 + intensity * 220,
    endFrequency: 130 + intensity * 120,
    duration: 0.05 + intensity * 0.04,
    type: "triangle",
    volume: 0.015 + intensity * 0.035,
  });
}

function playWallSound(strength) {
  const now = performance.now();
  if (now - audioState.lastWallAt < 34) {
    return;
  }

  audioState.lastWallAt = now;
  const intensity = clamp(strength / 760, 0.08, 1);
  playTone({
    frequency: 110 + intensity * 80,
    endFrequency: 80 + intensity * 36,
    duration: 0.04 + intensity * 0.03,
    type: "square",
    volume: 0.01 + intensity * 0.02,
  });
}

function playPocketSound(kind) {
  const now = performance.now();
  if (now - audioState.lastPocketAt < 70) {
    return;
  }

  audioState.lastPocketAt = now;
  if (kind === "cue") {
    playTone({
      frequency: 420,
      endFrequency: 180,
      duration: 0.22,
      type: "sawtooth",
      volume: 0.045,
    });
    return;
  }

  playTone({
    frequency: 520,
    endFrequency: 260,
    duration: 0.14,
    type: "triangle",
    volume: 0.04,
  });
  window.setTimeout(() => {
    playTone({
      frequency: 320,
      endFrequency: 200,
      duration: 0.1,
      type: "sine",
      volume: 0.022,
    });
  }, 28);
}

function updateHud() {
  elements.strokes.textContent = String(state.strokes);
  elements.remaining.textContent = String(state.remaining);
  elements.roundSize.textContent = `${state.roundBallCount} 球`;
  elements.powerValue.textContent = `${Math.round(state.power * 100)}%`;
  elements.angleValue.textContent = `${angleToDegrees(state.aimAngle)}°`;
  elements.phasePill.textContent = getPhaseLabel();
  elements.speedPill.textContent = state.moving ? "滚动" : "静止";
  elements.statusText.textContent = state.statusText;
  elements.fire.disabled = state.phase !== "charging" || state.moving || !state.cueBall || state.cueBall.potted || state.won;
  updateSpinUi();

  const best = bestForCurrentCount();
  if (best) {
    elements.bestScore.textContent = `${state.roundBallCount} 球 / ${best} 杆`;
  } else {
    elements.bestScore.textContent = "-";
  }
}

function getPhaseLabel() {
  if (state.won) {
    return "已清台";
  }

  if (state.moving) {
    return "运动中";
  }

  if (state.phase === "aiming") {
    return "瞄准中";
  }

  if (state.phase === "charging") {
    return "待发射";
  }

  return "待命";
}

function pocketBall(ball) {
  if (ball.potted) {
    return;
  }

  ball.potted = true;
  ball.vx = 0;
  ball.vy = 0;
  ball.sideSpin = 0;
  ball.forwardSpin = 0;
  playPocketSound(ball.kind);

  if (ball.kind === "cue") {
    state.scratchPending = true;
    state.phase = "idle";
    state.statusText = "白球落袋，等待所有球停稳后自动重摆。";
    return;
  }

  state.remaining = Math.max(0, state.remaining - 1);
  state.statusText = `收下一颗目标球，还剩 ${state.remaining} 颗。`;
}

function maybePocketBall(ball) {
  for (const pocket of POCKETS) {
    if (distance(ball, pocket) <= pocket.radius - 1) {
      pocketBall(ball);
      return true;
    }
  }
  return false;
}

function handleWallCollision(ball) {
  const minX = TABLE.left + ball.radius;
  const maxX = TABLE.right - ball.radius;
  const minY = TABLE.top + ball.radius;
  const maxY = TABLE.bottom - ball.radius;
  let impactStrength = 0;

  if (ball.x < minX) {
    impactStrength = Math.max(impactStrength, Math.abs(ball.vx));
    ball.x = minX;
    ball.vx = Math.abs(ball.vx) * WALL_RESTITUTION;
    if (ball.kind === "cue") {
      ball.vy += ball.sideSpin * 140;
      ball.sideSpin *= -0.58;
      ball.forwardSpin *= 0.92;
    }
  } else if (ball.x > maxX) {
    impactStrength = Math.max(impactStrength, Math.abs(ball.vx));
    ball.x = maxX;
    ball.vx = -Math.abs(ball.vx) * WALL_RESTITUTION;
    if (ball.kind === "cue") {
      ball.vy -= ball.sideSpin * 140;
      ball.sideSpin *= -0.58;
      ball.forwardSpin *= 0.92;
    }
  }

  if (ball.y < minY) {
    impactStrength = Math.max(impactStrength, Math.abs(ball.vy));
    ball.y = minY;
    ball.vy = Math.abs(ball.vy) * WALL_RESTITUTION;
    if (ball.kind === "cue") {
      ball.vx -= ball.sideSpin * 140;
      ball.sideSpin *= -0.58;
      ball.forwardSpin *= 0.92;
    }
  } else if (ball.y > maxY) {
    impactStrength = Math.max(impactStrength, Math.abs(ball.vy));
    ball.y = maxY;
    ball.vy = -Math.abs(ball.vy) * WALL_RESTITUTION;
    if (ball.kind === "cue") {
      ball.vx += ball.sideSpin * 140;
      ball.sideSpin *= -0.58;
      ball.forwardSpin *= 0.92;
    }
  }

  if (impactStrength > 140) {
    playWallSound(impactStrength);
  }
}

function applyFriction(ball, dt) {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (!speed) {
    return;
  }

  const nextSpeed = Math.max(0, speed - FRICTION_PER_SECOND * dt);
  if (nextSpeed <= STOP_SPEED) {
    ball.vx = 0;
    ball.vy = 0;
    return;
  }

  const scale = nextSpeed / speed;
  ball.vx *= scale;
  ball.vy *= scale;
}

function resolveBallCollision(a, b) {
  if (a.potted || b.potted) {
    return 0;
  }

  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let dist = Math.hypot(dx, dy);
  const minDist = a.radius + b.radius;

  if (dist >= minDist) {
    return 0;
  }

  if (!dist) {
    dx = 1;
    dy = 0;
    dist = 1;
  }

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;

  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;

  const relativeVelocity = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (relativeVelocity >= 0) {
    return 0;
  }

  const impulse = -((1 + BALL_RESTITUTION) * relativeVelocity) / 2;
  a.vx -= impulse * nx;
  a.vy -= impulse * ny;
  b.vx += impulse * nx;
  b.vy += impulse * ny;

  const cue = a.kind === "cue" ? a : (b.kind === "cue" ? b : null);
  const target = a.kind === "target" ? a : (b.kind === "target" ? b : null);
  if (cue && target) {
    const cueToTargetX = cue === a ? nx : -nx;
    const cueToTargetY = cue === a ? ny : -ny;
    const tangentX = -cueToTargetY;
    const tangentY = cueToTargetX;
    const impactStrength = impulse * 2;
    const follow = cue.forwardSpin * impactStrength * 0.105;
    const sideKick = cue.sideSpin * impactStrength * 0.08;
    const objectThrow = cue.sideSpin * impactStrength * 0.024;

    cue.vx += cueToTargetX * follow + tangentX * sideKick;
    cue.vy += cueToTargetY * follow + tangentY * sideKick;
    target.vx += tangentX * objectThrow;
    target.vy += tangentY * objectThrow;

    cue.sideSpin *= 0.5;
    cue.forwardSpin *= 0.3;
  }

  return impulse * 2;
}

function stepPhysics(dt) {
  for (const ball of state.balls) {
    if (ball.potted) {
      continue;
    }

    const speedBefore = Math.hypot(ball.vx, ball.vy);
    if (speedBefore > 0.5) {
      ball.spinAxis = Math.atan2(ball.vy, ball.vx);
      ball.spin += (speedBefore * dt) / ball.radius;

      if (ball.kind === "cue") {
        const dirX = ball.vx / speedBefore;
        const dirY = ball.vy / speedBefore;
        const tangentX = -dirY;
        const tangentY = dirX;
        const swerveStrength = ball.sideSpin * 54 * clamp(1.2 - speedBefore / 1400, 0.18, 1);
        const rollStrength = ball.forwardSpin * 48;
        ball.vx += tangentX * swerveStrength * dt + dirX * rollStrength * dt;
        ball.vy += tangentY * swerveStrength * dt + dirY * rollStrength * dt;
        ball.sideSpin *= Math.max(0, 1 - dt * 0.95);
        ball.forwardSpin *= Math.max(0, 1 - dt * 1.18);
      }
    }

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (maybePocketBall(ball)) {
      continue;
    }

    handleWallCollision(ball);
    maybePocketBall(ball);
    applyFriction(ball, dt);
  }

  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = 0; index < state.balls.length; index += 1) {
      for (let other = index + 1; other < state.balls.length; other += 1) {
        const impact = resolveBallCollision(state.balls[index], state.balls[other]);
        if (impact > 90) {
          playImpactSound(impact);
        }
      }
    }
  }

  if (!state.moving) {
    return;
  }

  const settled = state.balls.every((ball) => ball.potted || Math.hypot(ball.vx, ball.vy) <= STOP_SPEED);
  if (!settled) {
    return;
  }

  state.moving = false;
  state.phase = "idle";

  if (state.remaining === 0) {
    state.won = true;
    const countKey = String(state.roundBallCount);
    const currentBest = state.bestScores[countKey];

    if (!currentBest || state.strokes < currentBest) {
      state.bestScores[countKey] = state.strokes;
      saveBestScores();
    }

    elements.resultTitle.textContent = `清掉 ${state.roundBallCount} 球`;
    elements.resultCopy.textContent = `这一局用了 ${state.strokes} 杆。目标球数量越多、杆数越少，成绩越好。`;
    elements.result.classList.remove("hidden");
    state.statusText = `本局完成，共 ${state.strokes} 杆。点击“再来一局”重新随机开球。`;
  } else if (state.scratchPending) {
    respotCueBall();
    state.scratchPending = false;
    state.statusText = "白球已经重摆，右键重新进入瞄准模式。";
  } else {
    state.statusText = "全部停稳，右键重新进入瞄准模式。";
  }

  updateHud();
}

function calculateGuide() {
  const cue = state.cueBall;
  if (!cue || cue.potted || state.moving || state.phase !== "aiming") {
    return { segments: [], target: null };
  }

  let origin = { x: cue.x, y: cue.y };
  let direction = {
    x: Math.cos(state.aimAngle),
    y: Math.sin(state.aimAngle),
  };

  const segments = [];
  let targetHit = null;

  for (let bounce = 0; bounce < MAX_GUIDE_BOUNCES; bounce += 1) {
    const wallHit = getWallIntersection(origin, direction);
    const ballHit = getBallIntersection(origin, direction);

    if (ballHit && ballHit.t < wallHit.t) {
      const end = {
        x: origin.x + direction.x * ballHit.t,
        y: origin.y + direction.y * ballHit.t,
      };
      segments.push({ from: origin, to: end, type: "ball" });
      targetHit = ballHit;
      break;
    }

    const end = {
      x: origin.x + direction.x * wallHit.t,
      y: origin.y + direction.y * wallHit.t,
    };
    segments.push({ from: origin, to: end, type: "wall" });
    direction = reflect(direction, wallHit.normal);
    origin = {
      x: end.x + direction.x * 0.1,
      y: end.y + direction.y * 0.1,
    };
  }

  return { segments, target: targetHit };
}

function getWallIntersection(origin, direction) {
  const hits = [];
  const minX = TABLE.left + BALL_RADIUS;
  const maxX = TABLE.right - BALL_RADIUS;
  const minY = TABLE.top + BALL_RADIUS;
  const maxY = TABLE.bottom - BALL_RADIUS;

  if (direction.x > 0) {
    hits.push({
      t: (maxX - origin.x) / direction.x,
      normal: { x: -1, y: 0 },
    });
  } else if (direction.x < 0) {
    hits.push({
      t: (minX - origin.x) / direction.x,
      normal: { x: 1, y: 0 },
    });
  }

  if (direction.y > 0) {
    hits.push({
      t: (maxY - origin.y) / direction.y,
      normal: { x: 0, y: -1 },
    });
  } else if (direction.y < 0) {
    hits.push({
      t: (minY - origin.y) / direction.y,
      normal: { x: 0, y: 1 },
    });
  }

  return hits
    .filter((hit) => hit.t > 0.001)
    .sort((a, b) => a.t - b.t)[0];
}

function getBallIntersection(origin, direction) {
  let best = null;

  for (const ball of targetBalls()) {
    const rx = origin.x - ball.x;
    const ry = origin.y - ball.y;
    const collisionRadius = BALL_RADIUS * 2;

    const b = 2 * (direction.x * rx + direction.y * ry);
    const c = rx * rx + ry * ry - collisionRadius * collisionRadius;
    const discriminant = b * b - 4 * c;

    if (discriminant < 0) {
      continue;
    }

    const root = Math.sqrt(discriminant);
    const t = (-b - root) / 2;
    if (t <= 0.001) {
      continue;
    }

    if (!best || t < best.t) {
      best = { ball, t };
    }
  }

  return best;
}

function resizeCanvas() {
  const rect = elements.stage.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  elements.stage.width = Math.round(width * pixelRatio);
  elements.stage.height = Math.round(height * pixelRatio);

  const scale = Math.min(width / WORLD.width, height / WORLD.height);
  state.layout = {
    width,
    height,
    pixelWidth: elements.stage.width,
    pixelHeight: elements.stage.height,
    scale,
    offsetX: (width - WORLD.width * scale) / 2,
    offsetY: (height - WORLD.height * scale) / 2,
  };
  updateSpinUi();
}

function screenToWorld(clientX, clientY) {
  const rect = elements.stage.getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.layout.offsetX) / state.layout.scale,
    y: (clientY - rect.top - state.layout.offsetY) / state.layout.scale,
  };
}

function updateAimFromPoint(point) {
  const cue = state.cueBall;
  if (!cue || cue.potted || state.moving || state.phase !== "aiming") {
    return;
  }

  const dx = point.x - cue.x;
  const dy = point.y - cue.y;
  if (Math.hypot(dx, dy) < 8) {
    return;
  }

  state.aimAngle = Math.atan2(dy, dx);
  updateHud();
}

function shoot() {
  const cue = state.cueBall;
  if (!cue || cue.potted || state.moving || state.won || state.phase !== "charging") {
    return;
  }

  getAudioContext();
  const speed = lerp(360, 1320, state.power);
  cue.vx = Math.cos(state.aimAngle) * speed;
  cue.vy = Math.sin(state.aimAngle) * speed;
  cue.sideSpin = state.cueSpin.x * (0.95 + state.power * 0.55);
  cue.forwardSpin = -state.cueSpin.y * (1.1 + state.power * 0.65);
  state.strokes += 1;
  state.moving = true;
  state.phase = "idle";
  state.statusText = `第 ${state.strokes} 杆已出手，等待球停稳。`;
  updateHud();
}

function enterAiming() {
  if (state.moving || state.won || !state.cueBall || state.cueBall.potted) {
    return;
  }

  state.phase = "aiming";
  state.statusText = "瞄准模式: 移动鼠标选择方向，右键锁定并进入待发射。";
  updateHud();
}

function enterCharging() {
  if (state.moving || state.won || !state.cueBall || state.cueBall.potted) {
    return;
  }

  state.phase = "charging";
  state.power = POWER_MIN;
  state.chargeDirection = 1;
  state.statusText = "待发射: 力量条已锁定到白球上方，左键发射，右键返回瞄准。";
  updateHud();
}

function toggleAimMode(point = null) {
  getAudioContext();
  if (point && state.phase === "aiming") {
    updateAimFromPoint(point);
  }

  if (state.phase === "idle") {
    enterAiming();
    if (point) {
      updateAimFromPoint(point);
    }
    return;
  }

  if (state.phase === "aiming") {
    enterCharging();
    return;
  }

  if (state.phase === "charging") {
    enterAiming();
  }
}

function updateChargingPower(deltaMs) {
  if (state.phase !== "charging" || state.moving || state.won) {
    return;
  }

  state.power += state.chargeDirection * POWER_SWEEP_PER_SECOND * (deltaMs / 1000);

  if (state.power >= POWER_MAX) {
    state.power = POWER_MAX;
    state.chargeDirection = -1;
  } else if (state.power <= POWER_MIN) {
    state.power = POWER_MIN;
    state.chargeDirection = 1;
  }

  updateHud();
}

function drawRoundedRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawBackground() {
  const bg = ctx.createLinearGradient(0, 0, 0, WORLD.height);
  bg.addColorStop(0, "#103624");
  bg.addColorStop(1, "#06120d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  drawRoundedRect(
    TABLE.left - 58,
    TABLE.top - 58,
    TABLE.right - TABLE.left + 116,
    TABLE.bottom - TABLE.top + 116,
    54,
  );
  const wood = ctx.createLinearGradient(TABLE.left - 58, TABLE.top - 58, TABLE.right + 58, TABLE.bottom + 58);
  wood.addColorStop(0, "#6a4624");
  wood.addColorStop(0.5, "#8e6030");
  wood.addColorStop(1, "#503116");
  ctx.fillStyle = wood;
  ctx.fill();

  drawRoundedRect(
    TABLE.left,
    TABLE.top,
    TABLE.right - TABLE.left,
    TABLE.bottom - TABLE.top,
    TABLE.cornerRadius,
  );
  const felt = ctx.createLinearGradient(TABLE.left, TABLE.top, TABLE.right, TABLE.bottom);
  felt.addColorStop(0, "#267553");
  felt.addColorStop(0.5, "#145639");
  felt.addColorStop(1, "#0d3f2d");
  ctx.fillStyle = felt;
  ctx.fill();

  ctx.save();
  ctx.globalAlpha = 0.1;
  for (let x = TABLE.left + 22; x < TABLE.right; x += 44) {
    ctx.fillStyle = x % 88 === 0 ? "#ffffff" : "#c8efdb";
    ctx.fillRect(x, TABLE.top + 18, 2, TABLE.bottom - TABLE.top - 36);
  }
  ctx.restore();

  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(232, 245, 220, 0.14)";
  drawRoundedRect(
    TABLE.left + 12,
    TABLE.top + 12,
    TABLE.right - TABLE.left - 24,
    TABLE.bottom - TABLE.top - 24,
    26,
  );
  ctx.stroke();
}

function drawPockets() {
  for (const pocket of POCKETS) {
    const gradient = ctx.createRadialGradient(
      pocket.x - 4,
      pocket.y - 4,
      6,
      pocket.x,
      pocket.y,
      pocket.radius * 1.15,
    );
    gradient.addColorStop(0, "#040504");
    gradient.addColorStop(0.6, "#060807");
    gradient.addColorStop(1, "#11140f");
    ctx.beginPath();
    ctx.arc(pocket.x, pocket.y, pocket.radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(pocket.x, pocket.y, pocket.radius + 10, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.18)";
    ctx.lineWidth = 12;
    ctx.stroke();
  }
}

function drawGuide() {
  const cue = state.cueBall;
  if (!cue || cue.potted || state.moving || state.won) {
    return;
  }

  const guide = calculateGuide();
  if (!guide.segments.length) {
    return;
  }

  ctx.save();
  ctx.setLineDash([16, 10]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  ctx.shadowColor = "rgba(255, 255, 255, 0.18)";
  ctx.shadowBlur = 12;

  ctx.beginPath();
  ctx.moveTo(guide.segments[0].from.x, guide.segments[0].from.y);
  for (const segment of guide.segments) {
    ctx.lineTo(segment.to.x, segment.to.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  for (const segment of guide.segments) {
    if (segment.type !== "wall") {
      continue;
    }
    ctx.beginPath();
    ctx.arc(segment.to.x, segment.to.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 236, 188, 0.92)";
    ctx.fill();
  }

  if (guide.target) {
    const hitX = guide.segments.at(-1).to.x;
    const hitY = guide.segments.at(-1).to.y;
    const ball = guide.target.ball;
    const dirX = ball.x - hitX;
    const dirY = ball.y - hitY;
    const mag = Math.hypot(dirX, dirY) || 1;
    const nx = dirX / mag;
    const ny = dirY / mag;

    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y);
    ctx.lineTo(ball.x + nx * GUIDE_IMPACT_LINE_LENGTH, ball.y + ny * GUIDE_IMPACT_LINE_LENGTH);
    ctx.strokeStyle = "rgba(243, 211, 124, 0.92)";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(hitX, hitY, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#f3d37c";
    ctx.fill();
  }
}

function drawCueStick() {
  const cue = state.cueBall;
  if (!cue || cue.potted || state.moving || state.won || state.phase === "idle") {
    return;
  }

  const dirX = Math.cos(state.aimAngle);
  const dirY = Math.sin(state.aimAngle);
  const pullback = 38 + state.power * 54;
  const tipX = cue.x - dirX * (cue.radius + pullback);
  const tipY = cue.y - dirY * (cue.radius + pullback);
  const buttX = cue.x - dirX * (cue.radius + pullback + 340);
  const buttY = cue.y - dirY * (cue.radius + pullback + 340);

  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "#d1b07c";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(buttX, buttY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  ctx.strokeStyle = "#35200f";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(lerp(buttX, tipX, 0.74), lerp(buttY, tipY, 0.74));
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  ctx.strokeStyle = "#f7f2e4";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX + dirX * 10, tipY + dirY * 10);
  ctx.stroke();
  ctx.restore();
}

function drawPowerMeter() {
  const cue = state.cueBall;
  if (!cue || cue.potted || state.phase !== "charging" || state.moving || state.won) {
    return;
  }

  const width = 160;
  const height = 18;
  const x = cue.x - width / 2;
  const y = cue.y - 68;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 9);
  ctx.fillStyle = "rgba(6, 14, 10, 0.72)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.stroke();

  const fillWidth = (width - 6) * state.power;
  const gradient = ctx.createLinearGradient(x, y, x + width, y);
  gradient.addColorStop(0, "#8de07d");
  gradient.addColorStop(0.55, "#f3d37c");
  gradient.addColorStop(1, "#ff8f5c");
  ctx.beginPath();
  ctx.roundRect(x + 3, y + 3, fillWidth, height - 6, 7);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.fillStyle = "#eefbec";
  ctx.font = '700 12px "Bahnschrift", "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("POWER", cue.x, y - 6);
  ctx.restore();
}

function drawBall(ball) {
  if (ball.potted) {
    return;
  }

  ctx.beginPath();
  ctx.ellipse(ball.x + 3, ball.y + 6, ball.radius * 0.92, ball.radius * 0.76, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
  ctx.fill();

  const ballGradient = ctx.createRadialGradient(
    ball.x - ball.radius * 0.28,
    ball.y - ball.radius * 0.32,
    3,
    ball.x,
    ball.y,
    ball.radius,
  );
  if (ball.kind === "cue") {
    ballGradient.addColorStop(0, "#ffffff");
    ballGradient.addColorStop(0.6, "#f4f1e9");
    ballGradient.addColorStop(1, "#d9d2c4");
  } else {
    ballGradient.addColorStop(0, "#ffffff");
    ballGradient.addColorStop(0.28, ball.color);
    ballGradient.addColorStop(1, "#0e1110");
  }

  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fillStyle = ballGradient;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(ball.x, ball.y);
  ctx.rotate(ball.spinAxis);

  const rollOffset = Math.sin(ball.spin) * ball.radius * 0.62;
  const bandHeight = ball.radius * (0.22 + Math.abs(Math.cos(ball.spin)) * 0.18);

  ctx.beginPath();
  ctx.ellipse(0, rollOffset, ball.radius * 0.98, bandHeight, 0, 0, Math.PI * 2);
  ctx.fillStyle = ball.kind === "cue"
    ? "rgba(133, 148, 160, 0.18)"
    : colorWithAlpha(ball.color, 0.2);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(0, -rollOffset * 0.72, ball.radius * 0.9, bandHeight * 0.72, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
  ctx.fill();
  ctx.restore();

  if (ball.kind === "target") {
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius * (0.4 + Math.abs(Math.cos(ball.spin)) * 0.04), 0, Math.PI * 2);
    ctx.fillStyle = "#faf7f0";
    ctx.fill();

    ctx.fillStyle = "#111111";
    ctx.font = `700 ${Math.round(ball.radius * 0.95)}px "Bahnschrift", "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      String(ball.number),
      ball.x,
      ball.y + 1 + Math.sin(ball.spin) * 1.8,
    );
  } else {
    ctx.beginPath();
    ctx.arc(
      ball.x - 4 + Math.cos(ball.spinAxis) * Math.sin(ball.spin) * 2.6,
      ball.y - 4 + Math.sin(ball.spinAxis) * Math.sin(ball.spin) * 2.6,
      ball.radius * 0.24,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
    ctx.fill();

    if (!state.moving && !state.won) {
      ctx.beginPath();
      ctx.arc(
        ball.x + state.cueSpin.x * ball.radius * 0.46,
        ball.y + state.cueSpin.y * ball.radius * 0.46,
        ball.radius * 0.16,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "#24333d";
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
      ctx.stroke();
    }
  }
}

function render() {
  const { width, height, pixelWidth, pixelHeight, scale, offsetX, offsetY } = state.layout;
  ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  drawBackground();
  drawPockets();
  drawGuide();
  drawCueStick();
  drawPowerMeter();
  state.balls.forEach(drawBall);

  ctx.restore();
}

function tick(time) {
  if (!state.lastFrameTime) {
    state.lastFrameTime = time;
  }

  const delta = Math.min(32, time - state.lastFrameTime);
  state.lastFrameTime = time;
  state.accumulator += delta;
  updateChargingPower(delta);

  while (state.accumulator >= FIXED_DT_MS) {
    stepPhysics(FIXED_DT);
    state.accumulator -= FIXED_DT_MS;
  }

  render();
  window.requestAnimationFrame(tick);
}

function handlePointer(event) {
  const point = screenToWorld(event.clientX, event.clientY);
  updateAimFromPoint(point);
}

function handlePointerDown(event) {
  const point = screenToWorld(event.clientX, event.clientY);

  if (event.button === 2) {
    event.preventDefault();
    toggleAimMode(point);
    return;
  }

  if (event.button === 0 && state.phase === "charging") {
    event.preventDefault();
    shoot();
  }
}

function setSpinFromClientPoint(clientX, clientY) {
  if (state.moving || state.won) {
    return;
  }

  const rect = elements.spinPad.getBoundingClientRect();
  const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.5 - 18);
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const x = (clientX - centerX) / radius;
  const y = (clientY - centerY) / radius;
  setCueSpin(x, y);
  updateHud();
}

function handleSpinPointerDown(event) {
  event.preventDefault();
  state.spinPadDragging = true;
  elements.spinPad.setPointerCapture(event.pointerId);
  setSpinFromClientPoint(event.clientX, event.clientY);
}

function handleSpinPointerMove(event) {
  if (!state.spinPadDragging) {
    return;
  }

  setSpinFromClientPoint(event.clientX, event.clientY);
}

function stopSpinDragging(event) {
  if (state.spinPadDragging && event?.pointerId !== undefined) {
    try {
      elements.spinPad.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Ignore release errors from canceled pointers.
    }
  }
  state.spinPadDragging = false;
}

function handleKeydown(event) {
  if (event.key === " ") {
    event.preventDefault();
    if (state.phase === "charging") {
      shoot();
    } else {
      toggleAimMode();
    }
    return;
  }

  if (event.key.toLowerCase() === "r") {
    createRandomRack();
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    state.aimAngle -= Math.PI / 90;
    updateHud();
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    state.aimAngle += Math.PI / 90;
    updateHud();
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (state.phase === "idle") {
      enterAiming();
    } else if (state.phase === "aiming") {
      enterCharging();
    }
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (state.phase === "charging") {
      enterAiming();
    } else if (state.phase === "aiming") {
      state.phase = "idle";
      state.statusText = "已退出瞄准模式，右键重新进入。";
      updateHud();
    }
  }
}

elements.fire.addEventListener("click", shoot);
elements.newRound.addEventListener("click", createRandomRack);
elements.resultRestart.addEventListener("click", createRandomRack);
elements.spinReset.addEventListener("click", () => {
  if (state.moving || state.won) {
    return;
  }
  setCueSpin(0, 0);
  updateHud();
});
elements.spinPad.addEventListener("pointerdown", handleSpinPointerDown);
elements.spinPad.addEventListener("pointermove", handleSpinPointerMove);
elements.spinPad.addEventListener("pointerup", stopSpinDragging);
elements.spinPad.addEventListener("pointercancel", stopSpinDragging);
elements.stage.addEventListener("pointerdown", handlePointerDown);
elements.stage.addEventListener("pointermove", handlePointer);
elements.stage.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});
window.addEventListener("keydown", handleKeydown);
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
createRandomRack();
window.requestAnimationFrame(tick);
