import {
  Bodies,
  Body,
  Composite,
  Engine,
  Events,
  Vector,
  World,
} from "matter-js";

const WORLD_WIDTH = 3600;
const WORLD_HEIGHT = 1960;
const FLOOR_Y = 1772;
const LAUNCH_ZONE = {
  x: 476,
  y: 1300,
  radius: 960,
};
const SPAWN_ZONE = {
  x: WORLD_WIDTH - 360,
  y: FLOOR_Y - 176,
  radius: 220,
};
const LAUNCH_POWER_DISTANCE = 240;
const LAUNCH_POWER_MULTIPLIER = 1.8;
const PROJECTILE_RETIRE_MS = 4800;
const FIXED_STEP = 1000 / 60;
const INITIAL_SPAWN_INTERVAL_MS = 2400;
const MIN_SPAWN_INTERVAL_MS = 520;

const PROJECTILES = {
  heavy: {
    label: "超重慢速球",
    radius: 34,
    density: 0.018,
    restitution: 0.68,
    frictionAir: 0.008,
    launchFactor: 0.065,
    cooldownMs: 1000,
    fill: "#5d6780",
    rim: "#dde7f7",
    trail: "#ffe19a",
  },
  swift: {
    label: "超快轻质球",
    radius: 24,
    density: 0.00075,
    restitution: 0.52,
    frictionAir: 0.0018,
    launchFactor: 0.16,
    cooldownMs: 0,
    fill: "#6fdbff",
    rim: "#dff8ff",
    trail: "#99efff",
  },
  blast: {
    label: "碰撞爆炸球",
    radius: 28,
    density: 0.0022,
    restitution: 0.18,
    frictionAir: 0.006,
    launchFactor: 0.12,
    cooldownMs: 3000,
    fill: "#ff8f59",
    rim: "#fff1d0",
    trail: "#ffb173",
    blastRadius: 250,
  },
};

const ENEMY_LEVELS = {
  1: {
    radius: 30,
    hp: 1,
    score: 80,
    penalty: 30,
    fill: "#80e8ff",
    rim: "#e6fbff",
    glow: "rgba(128, 232, 255, 0.28)",
  },
  2: {
    radius: 40,
    hp: 2,
    score: 150,
    penalty: 60,
    fill: "#ffbf6a",
    rim: "#fff1cc",
    glow: "rgba(255, 191, 106, 0.24)",
  },
  3: {
    radius: 52,
    hp: 3,
    score: 260,
    penalty: 120,
    fill: "#ff706f",
    rim: "#ffe4dc",
    glow: "rgba(255, 112, 111, 0.26)",
  },
};

const elements = {
  stage: document.getElementById("stage"),
  score: document.getElementById("score"),
  missed: document.getElementById("targets"),
  active: document.getElementById("blocks"),
  cleared: document.getElementById("shots"),
  spawnRate: document.getElementById("spawn-rate"),
  spawnStatus: document.getElementById("spawn-status"),
  pressurePill: document.getElementById("ammo-total"),
  ammoCounts: {
    heavy: document.getElementById("ammo-heavy"),
    swift: document.getElementById("ammo-swift"),
    blast: document.getElementById("ammo-blast"),
  },
  ammoButtons: [...document.querySelectorAll("[data-projectile-type]")],
  restart: document.getElementById("restart"),
};

const ctx = elements.stage.getContext("2d");
const engine = Engine.create({ enableSleeping: false });
engine.gravity.y = 1.02;

const world = engine.world;
const state = {
  selectedType: "heavy",
  currentProjectile: null,
  cooldowns: {
    heavy: 0,
    swift: 0,
    blast: 0,
  },
  readyTimer: null,
  spawnTimer: null,
  spawnIntervalMs: INITIAL_SPAWN_INTERVAL_MS,
  elapsedMs: 0,
  score: 0,
  missed: 0,
  cleared: 0,
  launchedShots: 0,
  particles: [],
  shakeUntil: 0,
  shakeMagnitude: 0,
  lastFrameTime: 0,
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

const persistentBodies = [];

const getNow = () => performance.now();

const createStaticWorld = () => {
  const ground = Bodies.rectangle(WORLD_WIDTH / 2, FLOOR_Y + 56, WORLD_WIDTH + 280, 112, {
    isStatic: true,
    restitution: 0.24,
    friction: 1,
    render: { visible: false },
  });
  ground.plugin.entity = { kind: "ground" };

  const leftWall = Bodies.rectangle(12, WORLD_HEIGHT / 2, 24, WORLD_HEIGHT + 420, {
    isStatic: true,
    restitution: 0.9,
    render: { visible: false },
  });
  leftWall.plugin.entity = { kind: "wall" };

  const rightWall = Bodies.rectangle(WORLD_WIDTH - 12, WORLD_HEIGHT / 2, 24, WORLD_HEIGHT + 420, {
    isStatic: true,
    restitution: 0.9,
    render: { visible: false },
  });
  rightWall.plugin.entity = { kind: "wall" };

  persistentBodies.push(ground, leftWall, rightWall);
  World.add(world, persistentBodies);
};

const getDynamicBodies = () =>
  Composite.allBodies(world).filter((body) => !persistentBodies.includes(body));

const getEnemyBodies = () =>
  getDynamicBodies().filter((body) => body.plugin?.entity?.kind === "enemy");

const createEnemy = (level, x, y) => {
  const config = ENEMY_LEVELS[level];
  const body = Bodies.circle(x, y, config.radius, {
    density: 0.005 + level * 0.001,
    restitution: 0.72,
    friction: 0.02,
    frictionAir: 0.0008 + level * 0.0003,
    render: { visible: false },
  });

  body.plugin.entity = {
    kind: "enemy",
    level,
    hp: config.hp,
    maxHp: config.hp,
    radius: config.radius,
    fill: config.fill,
    rim: config.rim,
    glow: config.glow,
    missed: false,
    removed: false,
  };

  return body;
};

const createProjectile = (type) => {
  const config = PROJECTILES[type];
  const body = Bodies.circle(LAUNCH_ZONE.x, LAUNCH_ZONE.y, config.radius, {
    density: config.density,
    restitution: config.restitution,
    friction: 0.01,
    frictionAir: config.frictionAir,
    render: { visible: false },
  });

  body.plugin.entity = {
    kind: "projectile",
    type,
    radius: config.radius,
    fill: config.fill,
    rim: config.rim,
    trail: config.trail,
    launched: false,
    exploded: false,
    removed: false,
    launchedAt: 0,
    removeAt: 0,
    lastImpactAt: -1,
  };

  Body.setStatic(body, true);
  Body.setPosition(body, { x: LAUNCH_ZONE.x, y: LAUNCH_ZONE.y });
  Body.setVelocity(body, { x: 0, y: 0 });
  return body;
};

const clearScene = () => {
  window.clearTimeout(state.readyTimer);
  window.clearTimeout(state.spawnTimer);
  state.readyTimer = null;
  state.spawnTimer = null;
  state.currentProjectile = null;
  state.particles = [];

  getDynamicBodies().forEach((body) => {
    World.remove(world, body);
  });
};

const settleScene = (steps = 16) => {
  for (let index = 0; index < steps; index += 1) {
    Engine.update(engine, FIXED_STEP);
  }
};

const spawnParticleBurst = (origin, options = {}) => {
  const count = options.count ?? 12;
  const colors = Array.isArray(options.colors) ? options.colors : [options.color ?? "#ffffff"];

  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count + (Math.random() - 0.5) * 0.45;
    const speed = (options.minSpeed ?? 1.5) + Math.random() * (options.maxSpeed ?? 4.5);
    const life = (options.life ?? 300) + Math.random() * 220;
    const size = (options.minSize ?? 3) + Math.random() * (options.maxSize ?? 6);

    state.particles.push({
      kind: options.kind ?? "spark",
      x: origin.x,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (options.lift ?? 0),
      life,
      maxLife: life,
      size,
      color: colors[index % colors.length],
      ringRadius: options.ringRadius ?? 0,
    });
  }
};

const triggerLeftImpactShake = (magnitude = 10, durationMs = 180) => {
  state.shakeUntil = Math.max(state.shakeUntil, getNow() + durationMs);
  state.shakeMagnitude = Math.max(state.shakeMagnitude, magnitude);
};

const formatCooldown = (type) => {
  const remaining = Math.max(0, state.cooldowns[type] - getNow());
  if (remaining <= 0) {
    return "READY";
  }

  return `${(remaining / 1000).toFixed(1)}s`;
};

const describePressure = () => {
  if (state.spawnIntervalMs > 1800) {
    return "Warmup";
  }
  if (state.spawnIntervalMs > 1200) {
    return "Rising";
  }
  if (state.spawnIntervalMs > 760) {
    return "Dense";
  }
  return "Overload";
};

const updateHud = () => {
  elements.score.textContent = String(state.score);
  elements.missed.textContent = String(state.missed);
  elements.active.textContent = String(getEnemyBodies().length);
  elements.cleared.textContent = String(state.cleared);
  elements.spawnRate.textContent = `${(state.spawnIntervalMs / 1000).toFixed(2)}s`;
  elements.spawnStatus.textContent = `已坚持 ${(state.elapsedMs / 1000).toFixed(1)} 秒。右下生成区正在持续把 1 到 3 级球抛向左侧。`;
  elements.pressurePill.textContent = describePressure();

  elements.ammoButtons.forEach((button) => {
    const type = button.dataset.projectileType;
    button.classList.toggle("is-active", type === state.selectedType);
  });

  Object.entries(elements.ammoCounts).forEach(([type, element]) => {
    element.textContent = formatCooldown(type);
  });
};

const destroyEnemy = (enemyBody, options = {}) => {
  const entity = enemyBody?.plugin?.entity;
  if (!entity || entity.removed) {
    return;
  }

  entity.removed = true;
  World.remove(world, enemyBody);
  state.cleared += 1;
  state.score += options.score ?? ENEMY_LEVELS[entity.level].score;

  spawnParticleBurst(enemyBody.position, {
    colors: [entity.fill, entity.rim, "#fff6da"],
    count: 18 + entity.level * 4,
    minSpeed: 2.2,
    maxSpeed: 7.2,
    life: 520,
  });
};

const damageEnemy = (enemyBody, amount, point) => {
  const entity = enemyBody?.plugin?.entity;
  if (!entity || entity.removed) {
    return;
  }

  entity.hp -= amount;

  spawnParticleBurst(point ?? enemyBody.position, {
    colors: [entity.rim, "#ffffff"],
    count: 8,
    minSpeed: 1.2,
    maxSpeed: 3.8,
    life: 220,
    minSize: 2,
    maxSize: 4,
  });

  if (entity.hp <= 0) {
    destroyEnemy(enemyBody);
  }
};

const missEnemy = (enemyBody) => {
  const entity = enemyBody?.plugin?.entity;
  if (!entity || entity.removed || entity.missed) {
    return;
  }

  entity.missed = true;
  entity.removed = true;
  World.remove(world, enemyBody);
  state.missed += 1;
  state.score -= ENEMY_LEVELS[entity.level].penalty;
  triggerLeftImpactShake(9 + entity.level * 2, 190);

  spawnParticleBurst(enemyBody.position, {
    colors: ["#ff8a7a", "#ffd0c8"],
    count: 16,
    minSpeed: 1.8,
    maxSpeed: 5.8,
    life: 440,
  });
};

const removeProjectile = (projectile, point) => {
  const entity = projectile?.plugin?.entity;
  if (!entity || entity.removed) {
    return;
  }

  entity.removed = true;
  World.remove(world, projectile);

  if (point) {
    spawnParticleBurst(point, {
      colors: [entity.trail, "#fff0cf"],
      count: 10,
      minSpeed: 1.2,
      maxSpeed: 4.2,
      life: 260,
    });
  }
};

const explodeProjectile = (projectile, point) => {
  const entity = projectile.plugin.entity;
  if (entity.exploded || entity.removed) {
    return;
  }

  entity.exploded = true;
  const radius = PROJECTILES.blast.blastRadius;

  state.particles.push({
    kind: "ring",
    x: point.x,
    y: point.y,
    ringRadius: radius,
    life: 380,
    maxLife: 380,
    size: 0,
    color: "rgba(255, 220, 170, 0.95)",
  });

  spawnParticleBurst(point, {
    colors: ["#ffb26f", "#fff3cf", "#ff7f52"],
    count: 30,
    minSpeed: 2.8,
    maxSpeed: 8.8,
    life: 620,
  });

  getDynamicBodies().forEach((body) => {
    if (body === projectile) {
      return;
    }

    const other = body.plugin?.entity;
    if (!other || other.removed) {
      return;
    }

    const direction = Vector.sub(body.position, point);
    const distance = Math.max(18, Vector.magnitude(direction));
    if (distance > radius) {
      return;
    }

    const normal = Vector.normalise(direction);
    const forceScale = 1 - distance / radius;

    Body.applyForce(
      body,
      body.position,
      Vector.mult(normal, 0.028 * forceScale * body.mass),
    );

    if (other.kind === "enemy") {
      destroyEnemy(body, { score: ENEMY_LEVELS[other.level].score + 20 });
    }
  });

  removeProjectile(projectile, point);
};

const processProjectileImpact = (projectile, otherBody, point) => {
  const projectileEntity = projectile.plugin.entity;
  const other = otherBody.plugin?.entity;

  spawnParticleBurst(point, {
    colors: [projectileEntity.trail, "#fff0cc"],
    count: 8,
    minSpeed: 1.2,
    maxSpeed: 3.6,
    life: 180,
    minSize: 2,
    maxSize: 4,
  });

  if (projectileEntity.type === "blast") {
    explodeProjectile(projectile, point);
    return;
  }

  if (projectileEntity.type === "swift") {
    if (other?.kind === "enemy") {
      damageEnemy(otherBody, 1, point);
    }
    removeProjectile(projectile, point);
    return;
  }

  if (projectileEntity.type === "heavy" && other?.kind === "enemy") {
    destroyEnemy(otherBody);
  }
};

const handleCollisions = (event) => {
  event.pairs.forEach((pair) => {
    const enemy = [pair.bodyA, pair.bodyB].find((body) => body.plugin?.entity?.kind === "enemy");
    const leftSideHit = [pair.bodyA, pair.bodyB].some((body) => body.plugin?.entity?.kind === "wall")
      || [pair.bodyA, pair.bodyB].some((body) => body.plugin?.entity?.kind === "ground");

    if (enemy && leftSideHit && enemy.position.x < WORLD_WIDTH * 0.34) {
      triggerLeftImpactShake(5 + enemy.plugin.entity.level * 1.2, 120);
    }

    const projectile = [pair.bodyA, pair.bodyB].find(
      (body) => body.plugin?.entity?.kind === "projectile" && body.plugin.entity.launched,
    );

    if (!projectile) {
      return;
    }

    const entity = projectile.plugin.entity;
    if (entity.lastImpactAt === engine.timing.timestamp) {
      return;
    }

    const otherBody = projectile === pair.bodyA ? pair.bodyB : pair.bodyA;
    entity.lastImpactAt = engine.timing.timestamp;

    const point = pair.collision.supports[0] ?? projectile.position;
    processProjectileImpact(projectile, otherBody, point);
  });
};

const updateParticles = (deltaMs) => {
  const gravity = 0.0044 * deltaMs;
  state.particles = state.particles.filter((particle) => {
    particle.life -= deltaMs;
    if (particle.life <= 0) {
      return false;
    }

    if (particle.kind !== "ring") {
      particle.x += particle.vx * (deltaMs / 16.666);
      particle.y += particle.vy * (deltaMs / 16.666);
      particle.vy += gravity;
      particle.vx *= 0.992;
    }

    return true;
  });
};

const removeExpiredBodies = () => {
  const now = getNow();

  getDynamicBodies().forEach((body) => {
    const entity = body.plugin?.entity;
    if (!entity || entity.removed) {
      return;
    }

    if (entity.kind === "enemy") {
      if (body.position.y >= FLOOR_Y - entity.radius && body.position.x < WORLD_WIDTH * 0.55) {
        missEnemy(body);
        return;
      }

      if (
        body.position.y > WORLD_HEIGHT + 260 ||
        body.position.x < -260 ||
        body.position.x > WORLD_WIDTH + 260
      ) {
        entity.removed = true;
        World.remove(world, body);
      }
      return;
    }

    if (entity.kind === "projectile" && entity.launched) {
      if (
        body.position.y > WORLD_HEIGHT + 260 ||
        body.position.x < -260 ||
        body.position.x > WORLD_WIDTH + 260 ||
        (now > entity.removeAt && body.speed < 0.28)
      ) {
        removeProjectile(body);
      }
    }
  });
};

const getSpawnLevel = () => {
  const progress = Math.min(1, state.elapsedMs / 70000);
  const roll = Math.random();
  const levelThreeChance = 0.12 + progress * 0.32;
  const levelTwoChance = 0.34 + progress * 0.2;

  if (roll < levelThreeChance) {
    return 3;
  }
  if (roll < levelThreeChance + levelTwoChance) {
    return 2;
  }
  return 1;
};

const spawnEnemy = () => {
  const level = getSpawnLevel();
  const radius = Math.random() * (SPAWN_ZONE.radius - 24);
  const offsetAngle = Math.random() * Math.PI * 2;
  const x = SPAWN_ZONE.x + Math.cos(offsetAngle) * radius * 0.56;
  const y = SPAWN_ZONE.y + Math.sin(offsetAngle) * radius * 0.4;
  const body = createEnemy(level, x, y);

  const targetX = 520 + Math.random() * (WORLD_WIDTH * 0.28);
  const targetY = FLOOR_Y - 180 + Math.random() * 110;
  const direction = Vector.normalise(Vector.sub({ x: targetX, y: targetY }, { x, y }));
  const speed = (18 + Math.random() * 10 + level * 1.8) * 0.5;
  const lift = (22 + Math.random() * 14 + level * 1.6) * 0.5;
  const velocity = {
    x: direction.x * speed,
    y: direction.y * speed - lift,
  };

  World.add(world, body);
  Body.setVelocity(body, velocity);
  Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.22);

  spawnParticleBurst({ x, y }, {
    colors: [ENEMY_LEVELS[level].fill, ENEMY_LEVELS[level].rim],
    count: 10,
    minSpeed: 1.4,
    maxSpeed: 3.4,
    life: 220,
    minSize: 3,
    maxSize: 5,
  });
};

const applyEnemyGravityCompensation = () => {
  const counterGravity = engine.gravity.y * engine.gravity.scale * 0.5;

  getEnemyBodies().forEach((body) => {
    Body.applyForce(body, body.position, {
      x: 0,
      y: -body.mass * counterGravity,
    });
  });
};

const scheduleSpawn = () => {
  window.clearTimeout(state.spawnTimer);
  state.spawnTimer = window.setTimeout(() => {
    spawnEnemy();
    state.spawnIntervalMs = Math.max(MIN_SPAWN_INTERVAL_MS, state.spawnIntervalMs * 0.972);
    updateHud();
    scheduleSpawn();
  }, state.spawnIntervalMs);
};

const scheduleReadyProjectile = () => {
  window.clearTimeout(state.readyTimer);
  if (state.currentProjectile) {
    return;
  }

  const delay = Math.max(0, state.cooldowns[state.selectedType] - getNow());
  state.readyTimer = window.setTimeout(() => {
    if (state.currentProjectile) {
      return;
    }

    const projectile = createProjectile(state.selectedType);
    World.add(world, projectile);
    state.currentProjectile = projectile;
    updateHud();
  }, delay);
};

const launchProjectileTo = (point) => {
  if (!state.currentProjectile) {
    return;
  }

  const projectile = state.currentProjectile;
  const config = PROJECTILES[projectile.plugin.entity.type];
  const direction = Vector.sub(point, LAUNCH_ZONE);
  const distance = Vector.magnitude(direction);

  if (distance < 12) {
    return;
  }

  const normalized = Vector.normalise(direction);
  const powerDistance = Math.min(distance / LAUNCH_ZONE.radius, 1) * LAUNCH_POWER_DISTANCE;
  const velocity = Vector.mult(normalized, powerDistance * config.launchFactor * LAUNCH_POWER_MULTIPLIER);

  Body.setStatic(projectile, false);
  Body.setVelocity(projectile, velocity);
  Body.setAngularVelocity(projectile, (Math.random() - 0.5) * 0.24);
  projectile.plugin.entity.launched = true;
  projectile.plugin.entity.launchedAt = getNow();
  projectile.plugin.entity.removeAt = projectile.plugin.entity.launchedAt + PROJECTILE_RETIRE_MS;

  state.cooldowns[projectile.plugin.entity.type] = getNow() + config.cooldownMs;
  state.currentProjectile = null;
  state.launchedShots += 1;
  scheduleReadyProjectile();
  updateHud();
};

const selectProjectileType = (type) => {
  state.selectedType = type;

  if (state.currentProjectile && !state.currentProjectile.plugin.entity.launched) {
    World.remove(world, state.currentProjectile);
    state.currentProjectile = null;
  }

  scheduleReadyProjectile();
  updateHud();
};

const resetGame = () => {
  clearScene();
  state.score = 0;
  state.missed = 0;
  state.cleared = 0;
  state.launchedShots = 0;
  state.elapsedMs = 0;
  state.spawnIntervalMs = INITIAL_SPAWN_INTERVAL_MS;
  state.cooldowns = {
    heavy: 0,
    swift: 0,
    blast: 0,
  };

  settleScene();
  scheduleReadyProjectile();
  scheduleSpawn();
  updateHud();
};

const resizeCanvas = () => {
  const rect = elements.stage.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  elements.stage.width = Math.round(width * pixelRatio);
  elements.stage.height = Math.round(height * pixelRatio);

  const scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
  state.layout = {
    width,
    height,
    pixelWidth: elements.stage.width,
    pixelHeight: elements.stage.height,
    scale,
    offsetX: (width - WORLD_WIDTH * scale) / 2,
    offsetY: (height - WORLD_HEIGHT * scale) / 2,
  };
};

const screenToWorld = (clientX, clientY) => {
  const rect = elements.stage.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return {
    x: (x - state.layout.offsetX) / state.layout.scale,
    y: (y - state.layout.offsetY) / state.layout.scale,
  };
};

const colorWithAlpha = (color, alpha) => {
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
};

const drawBackdrop = () => {
  const gradient = ctx.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
  gradient.addColorStop(0, "#23160e");
  gradient.addColorStop(0.55, "#382617");
  gradient.addColorStop(1, "#120c08");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
  for (let x = 0; x < WORLD_WIDTH; x += 120) {
    ctx.fillRect(x, 0, 2, FLOOR_Y - 18);
  }

  ctx.fillStyle = "#684124";
  ctx.fillRect(0, FLOOR_Y, WORLD_WIDTH, WORLD_HEIGHT - FLOOR_Y);

  ctx.fillStyle = "rgba(255, 224, 138, 0.07)";
  ctx.fillRect(0, FLOOR_Y - 16, WORLD_WIDTH, 16);
};

const drawLaunchZone = () => {
  ctx.save();
  ctx.beginPath();
  ctx.arc(LAUNCH_ZONE.x, LAUNCH_ZONE.y, LAUNCH_ZONE.radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 182, 104, 0.12)";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(255, 217, 168, 0.34)";
  ctx.stroke();
  ctx.restore();
};

const drawSpawnZone = () => {
  ctx.save();
  ctx.beginPath();
  ctx.arc(SPAWN_ZONE.x, SPAWN_ZONE.y, SPAWN_ZONE.radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(107, 220, 255, 0.14)";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(167, 239, 255, 0.42)";
  ctx.stroke();
  ctx.restore();
};

const drawProjectile = (body, entity) => {
  const config = PROJECTILES[entity.type];
  const pulse = entity.type === "blast" ? 1 + Math.sin(getNow() / 120) * 0.04 : 1;

  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);
  ctx.scale(pulse, pulse);
  ctx.beginPath();
  ctx.arc(0, 0, config.radius, 0, Math.PI * 2);
  ctx.fillStyle = entity.fill;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = entity.rim;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(-config.radius * 0.2, -config.radius * 0.24, config.radius * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fill();

  if (entity.type === "blast") {
    ctx.beginPath();
    ctx.moveTo(-6, -12);
    ctx.lineTo(8, -3);
    ctx.lineTo(-2, 14);
    ctx.strokeStyle = "#fff6df";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.restore();
};

const drawEnemy = (body, entity) => {
  const config = ENEMY_LEVELS[entity.level];
  const hpRatio = Math.max(0, entity.hp / entity.maxHp);

  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);

  ctx.shadowColor = config.glow;
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(0, 0, config.radius, 0, Math.PI * 2);
  ctx.fillStyle = config.fill;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 5;
  ctx.strokeStyle = config.rim;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, config.radius * 0.65, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpRatio);
  ctx.strokeStyle = "#fff8de";
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.fillStyle = "#23120d";
  ctx.font = `700 ${Math.round(config.radius * 0.9)}px "Bahnschrift", "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(entity.level), 0, 2);
  ctx.restore();
};

const drawParticles = () => {
  state.particles.forEach((particle) => {
    const alpha = particle.life / particle.maxLife;
    if (particle.kind === "ring") {
      ctx.strokeStyle = colorWithAlpha(particle.color, alpha);
      ctx.lineWidth = 10 * alpha;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.ringRadius * (1 - alpha), 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    ctx.fillStyle = colorWithAlpha(particle.color, Math.max(0.1, alpha));
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * alpha, 0, Math.PI * 2);
    ctx.fill();
  });
};

const render = () => {
  const { width, height, pixelWidth, pixelHeight, scale, offsetX, offsetY } = state.layout;
  ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  const shaking = getNow() < state.shakeUntil;
  const shakeX = shaking ? (Math.random() - 0.5) * state.shakeMagnitude : 0;
  const shakeY = shaking ? (Math.random() - 0.5) * state.shakeMagnitude * 0.45 : 0;
  if (!shaking) {
    state.shakeMagnitude = 0;
  }

  ctx.translate(offsetX + shakeX, offsetY + shakeY);
  ctx.scale(scale, scale);

  drawBackdrop();
  drawLaunchZone();
  drawSpawnZone();

  getDynamicBodies()
    .sort((a, b) => a.position.y - b.position.y)
    .forEach((body) => {
      const entity = body.plugin.entity;
      if (entity.kind === "enemy") {
        drawEnemy(body, entity);
      } else if (entity.kind === "projectile") {
        drawProjectile(body, entity);
      }
    });

  drawParticles();
  ctx.restore();
};

const tick = (time) => {
  if (!state.lastFrameTime) {
    state.lastFrameTime = time;
  }

  const delta = Math.min(33, time - state.lastFrameTime);
  state.lastFrameTime = time;
  state.elapsedMs += delta;

  applyEnemyGravityCompensation();
  Engine.update(engine, delta);
  updateParticles(delta);
  removeExpiredBodies();
  updateHud();
  render();
  window.requestAnimationFrame(tick);
};

const handlePointerDown = (event) => {
  const point = screenToWorld(event.clientX, event.clientY);
  launchProjectileTo(point);
};

const handleKeydown = (event) => {
  const key = event.key.toLowerCase();
  if (key === "1") {
    selectProjectileType("heavy");
  } else if (key === "2") {
    selectProjectileType("swift");
  } else if (key === "3") {
    selectProjectileType("blast");
  } else if (key === "r") {
    resetGame();
  }
};

createStaticWorld();
Events.on(engine, "collisionStart", handleCollisions);

elements.ammoButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectProjectileType(button.dataset.projectileType);
  });
});

elements.restart.addEventListener("click", () => {
  resetGame();
});

elements.stage.addEventListener("pointerdown", handlePointerDown);
window.addEventListener("keydown", handleKeydown);
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
resetGame();
window.requestAnimationFrame(tick);
