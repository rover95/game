import {
  Bodies,
  Body,
  Composite,
  Engine,
  Events,
  Vector,
  World,
} from "matter-js";

const WORLD_WIDTH = 1400;
const WORLD_HEIGHT = 800;
const FLOOR_Y = 716;
const ANCHOR = { x: 192, y: 518 };
const MAX_PULL = 122;
const READY_SPAWN_DELAY_MS = 820;
const PROJECTILE_RETIRE_MS = 2800;
const FIXED_STEP = 1000 / 60;

const MATERIALS = {
  wood: {
    fill: "#cf8a4d",
    stroke: "#7b4924",
    density: 0.0021,
    score: 40,
  },
  stone: {
    fill: "#7d8898",
    stroke: "#424958",
    density: 0.0043,
    score: 55,
  },
  glass: {
    fill: "rgba(126, 214, 255, 0.52)",
    stroke: "#6bc9f0",
    density: 0.0014,
    score: 65,
  },
};

const PROJECTILES = {
  heavy: {
    label: "超重慢速球",
    radius: 28,
    density: 0.03,
    restitution: 0.1,
    frictionAir: 0.012,
    launchFactor: 0.13,
    fill: "#5d6780",
    rim: "#dde7f7",
    trail: "#ffe19a",
  },
  swift: {
    label: "超快轻质球",
    radius: 22,
    density: 0.0032,
    restitution: 0.3,
    frictionAir: 0.0022,
    launchFactor: 0.285,
    fill: "#6fdbff",
    rim: "#dff8ff",
    trail: "#99efff",
  },
  blast: {
    label: "碰撞爆炸球",
    radius: 24,
    density: 0.0065,
    restitution: 0.18,
    frictionAir: 0.006,
    launchFactor: 0.22,
    fill: "#ff8f59",
    rim: "#fff1d0",
    trail: "#ffb173",
    blastRadius: 192,
  },
};

const PRESETS = [
  {
    id: "sky-gate",
    name: "Sky Gate",
    ammo: { heavy: 2, swift: 2, blast: 2 },
    build(builder) {
      const baseY = FLOOR_Y - 48;

      [896, 946, 1086, 1136].forEach((x) => {
        builder.column(x, baseY, 3, 28, 96, "wood");
      });

      builder.beam(1016, FLOOR_Y - 286, 194, 24, "stone");
      builder.beam(1016, FLOOR_Y - 322, 156, 20, "glass");
      builder.beam(1016, FLOOR_Y - 148, 210, 18, "glass");
      builder.brace(936, FLOOR_Y - 142, 150, 18, "glass", Math.PI / 3.55);
      builder.brace(1096, FLOOR_Y - 142, 150, 18, "glass", -Math.PI / 3.55);
      builder.target(1016, FLOOR_Y - 190, 24);
      builder.target(1016, FLOOR_Y - 360, 20);
    },
  },
  {
    id: "needle-keep",
    name: "Needle Keep",
    ammo: { heavy: 1, swift: 3, blast: 2 },
    build(builder) {
      [930, 986, 1042, 1098].forEach((x) => {
        builder.column(x, FLOOR_Y - 46, 2, 30, 92, "stone");
      });

      builder.beam(1014, FLOOR_Y - 158, 246, 20, "wood");
      builder.beam(1014, FLOOR_Y - 262, 190, 18, "glass");
      builder.beam(1014, FLOOR_Y - 344, 144, 16, "glass");
      builder.column(1014, FLOOR_Y - 98, 4, 24, 76, "wood");
      builder.column(1014, FLOOR_Y - 388, 2, 26, 84, "stone");
      builder.brace(972, FLOOR_Y - 232, 122, 14, "glass", Math.PI / 3.8);
      builder.brace(1056, FLOOR_Y - 232, 122, 14, "glass", -Math.PI / 3.8);
      builder.target(1014, FLOOR_Y - 304, 21);
      builder.target(1014, FLOOR_Y - 458, 18);
    },
  },
  {
    id: "domino-lab",
    name: "Domino Lab",
    ammo: { heavy: 2, swift: 2, blast: 2 },
    build(builder) {
      const startX = 862;

      for (let index = 0; index < 6; index += 1) {
        builder.block(startX + index * 74, FLOOR_Y - 28, 62, 56, "stone");
      }

      for (let index = 0; index < 7; index += 1) {
        builder.block(startX - 10 + index * 62, FLOOR_Y - 118, 16, 108, "glass");
      }

      builder.beam(1012, FLOOR_Y - 184, 360, 18, "wood");
      builder.column(916, FLOOR_Y - 226, 2, 24, 72, "wood");
      builder.column(1012, FLOOR_Y - 226, 2, 24, 72, "glass");
      builder.column(1108, FLOOR_Y - 226, 2, 24, 72, "wood");
      builder.beam(1012, FLOOR_Y - 314, 226, 16, "stone");
      builder.target(916, FLOOR_Y - 260, 21);
      builder.target(1012, FLOOR_Y - 260, 21);
      builder.target(1108, FLOOR_Y - 260, 21);
    },
  },
  {
    id: "citadel-stack",
    name: "Citadel Stack",
    ammo: { heavy: 2, swift: 1, blast: 3 },
    build(builder) {
      [906, 962, 1066, 1122].forEach((x) => {
        builder.column(x, FLOOR_Y - 44, 2, 30, 88, "stone");
      });

      builder.beam(1014, FLOOR_Y - 154, 276, 22, "wood");
      builder.column(1014, FLOOR_Y - 114, 3, 30, 78, "glass");
      builder.beam(1014, FLOOR_Y - 290, 220, 20, "stone");
      builder.column(960, FLOOR_Y - 236, 2, 24, 74, "wood");
      builder.column(1068, FLOOR_Y - 236, 2, 24, 74, "wood");
      builder.brace(966, FLOOR_Y - 276, 136, 16, "glass", Math.PI / 4.4);
      builder.brace(1062, FLOOR_Y - 276, 136, 16, "glass", -Math.PI / 4.4);
      builder.target(1014, FLOOR_Y - 194, 22);
      builder.target(960, FLOOR_Y - 348, 18);
      builder.target(1068, FLOOR_Y - 348, 18);
    },
  },
];

const elements = {
  stage: document.getElementById("stage"),
  score: document.getElementById("score"),
  targets: document.getElementById("targets"),
  blocks: document.getElementById("blocks"),
  shots: document.getElementById("shots"),
  presetName: document.getElementById("preset-name"),
  ammoTotal: document.getElementById("ammo-total"),
  ammoCounts: {
    heavy: document.getElementById("ammo-heavy"),
    swift: document.getElementById("ammo-swift"),
    blast: document.getElementById("ammo-blast"),
  },
  ammoButtons: [...document.querySelectorAll("[data-projectile-type]")],
  presetButtons: [...document.querySelectorAll("[data-preset-index]")],
  restart: document.getElementById("restart"),
  nextPreset: document.getElementById("next-preset"),
  result: document.getElementById("result"),
  resultTag: document.getElementById("result-tag"),
  resultTitle: document.getElementById("result-title"),
  resultBody: document.getElementById("result-body"),
  resultRestart: document.getElementById("result-restart"),
  resultNext: document.getElementById("result-next"),
};

const ctx = elements.stage.getContext("2d");
const engine = Engine.create({ enableSleeping: false });
engine.gravity.y = 1.18;

const world = engine.world;
const state = {
  presetIndex: 0,
  ammo: { heavy: 0, swift: 0, blast: 0 },
  selectedType: "heavy",
  currentProjectile: null,
  dragging: false,
  dragPosition: { ...ANCHOR },
  score: 0,
  destroyedBlocks: 0,
  destroyedTargets: 0,
  totalTargets: 0,
  shotsTaken: 0,
  particles: [],
  mode: "playing",
  spawnTimer: null,
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

const createStaticWorld = () => {
  const ground = Bodies.rectangle(WORLD_WIDTH / 2, FLOOR_Y + 46, WORLD_WIDTH + 260, 96, {
    isStatic: true,
    friction: 1,
    restitution: 0,
    render: { visible: false },
  });
  ground.plugin.entity = { kind: "ground" };

  const rightWall = Bodies.rectangle(WORLD_WIDTH + 60, WORLD_HEIGHT / 2, 120, WORLD_HEIGHT + 200, {
    isStatic: true,
    render: { visible: false },
  });
  rightWall.plugin.entity = { kind: "wall" };

  const leftWall = Bodies.rectangle(-60, WORLD_HEIGHT / 2, 120, WORLD_HEIGHT + 200, {
    isStatic: true,
    render: { visible: false },
  });
  leftWall.plugin.entity = { kind: "wall" };

  persistentBodies.push(ground, rightWall, leftWall);
  World.add(world, persistentBodies);
};

const createBlock = (x, y, width, height, materialName, angle = 0) => {
  const material = MATERIALS[materialName];
  const body = Bodies.rectangle(x, y, width, height, {
    angle,
    density: material.density,
    friction: 0.82,
    frictionStatic: 0.95,
    restitution: materialName === "glass" ? 0.22 : 0.08,
    chamfer: { radius: Math.max(4, Math.min(width, height) * 0.14) },
    render: { visible: false },
  });

  body.plugin.entity = {
    kind: "block",
    material: materialName,
    fill: material.fill,
    stroke: material.stroke,
    score: material.score,
    removed: false,
  };

  return body;
};

const createTarget = (x, y, radius) => {
  const body = Bodies.polygon(x, y, 6, radius, {
    density: 0.0028,
    friction: 0.66,
    restitution: 0.18,
    render: { visible: false },
  });

  body.plugin.entity = {
    kind: "target",
    radius,
    fill: "#f7d96d",
    stroke: "#8f5d12",
    score: 260,
    removed: false,
  };

  return body;
};

const createProjectile = (type) => {
  const config = PROJECTILES[type];
  const body = Bodies.circle(ANCHOR.x, ANCHOR.y, config.radius, {
    density: config.density,
    friction: 0.005,
    restitution: config.restitution,
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
    launchedAt: 0,
    removeAt: 0,
  };

  Body.setStatic(body, true);
  Body.setPosition(body, ANCHOR);
  Body.setVelocity(body, { x: 0, y: 0 });
  return body;
};

const settleScene = (steps = 28) => {
  for (let index = 0; index < steps; index += 1) {
    Engine.update(engine, FIXED_STEP);
  }
};

const builderFactory = (bodies) => ({
  block(x, y, width, height, material, angle = 0) {
    bodies.push(createBlock(x, y, width, height, material, angle));
  },
  column(x, bottomY, levels, width, height, material) {
    for (let index = 0; index < levels; index += 1) {
      const y = bottomY - index * (height + 6);
      bodies.push(createBlock(x, y, width, height, material));
    }
  },
  beam(x, y, width, height, material) {
    bodies.push(createBlock(x, y, width, height, material));
  },
  brace(x, y, width, height, material, angle) {
    bodies.push(createBlock(x, y, width, height, material, angle));
  },
  target(x, y, radius) {
    bodies.push(createTarget(x, y, radius));
  },
});

const getDynamicBodies = () =>
  Composite.allBodies(world).filter((body) => !persistentBodies.includes(body));

const clearScene = () => {
  window.clearTimeout(state.spawnTimer);
  state.spawnTimer = null;
  state.currentProjectile = null;
  state.dragging = false;
  state.particles = [];

  getDynamicBodies().forEach((body) => {
    World.remove(world, body);
  });
};

const sumAmmo = (ammo) => Object.values(ammo).reduce((sum, value) => sum + value, 0);

const getFirstAvailableType = () =>
  Object.keys(state.ammo).find((type) => state.ammo[type] > 0) ?? null;

const updateResultOverlay = (visible, tag = "", title = "", body = "") => {
  elements.result.classList.toggle("hidden", !visible);
  elements.resultTag.textContent = tag;
  elements.resultTitle.textContent = title;
  elements.resultBody.textContent = body;
};

const updateHud = () => {
  elements.score.textContent = String(state.score);
  elements.targets.textContent = `${state.destroyedTargets} / ${state.totalTargets}`;
  elements.blocks.textContent = String(state.destroyedBlocks);
  elements.shots.textContent = String(state.shotsTaken);
  elements.presetName.textContent = PRESETS[state.presetIndex].name;
  elements.ammoTotal.textContent = String(sumAmmo(state.ammo));

  Object.entries(elements.ammoCounts).forEach(([type, element]) => {
    element.textContent = String(state.ammo[type]);
  });

  elements.ammoButtons.forEach((button) => {
    const type = button.dataset.projectileType;
    const isActive = type === state.selectedType;
    const isEmpty = state.ammo[type] <= 0;
    button.classList.toggle("is-active", isActive);
    button.classList.toggle("is-empty", isEmpty);
    button.disabled = isEmpty;
  });

  elements.presetButtons.forEach((button, index) => {
    button.classList.toggle("is-active", index === state.presetIndex);
  });
};

const spawnParticleBurst = (origin, options = {}) => {
  const count = options.count ?? 14;
  const palette = Array.isArray(options.colors) ? options.colors : [options.color ?? "#ffffff"];

  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count + (Math.random() - 0.5) * 0.52;
    const speed = (options.minSpeed ?? 1.8) + Math.random() * (options.maxSpeed ?? 4.5);
    const size = (options.minSize ?? 4) + Math.random() * (options.maxSize ?? 8);
    const life = (options.life ?? 450) + Math.random() * 220;

    state.particles.push({
      kind: options.kind ?? "spark",
      x: origin.x,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (options.lift ?? 0),
      size,
      life,
      maxLife: life,
      color: palette[index % palette.length],
      ringRadius: options.ringRadius ?? 0,
    });
  }
};

const destroyBody = (body, scoreValue, colors) => {
  const entity = body?.plugin?.entity;
  if (!entity || entity.removed) {
    return;
  }

  entity.removed = true;
  World.remove(world, body);
  state.score += scoreValue;
  spawnParticleBurst(body.position, {
    colors,
    count: 16,
    minSpeed: 1.8,
    maxSpeed: 5.6,
    life: 520,
  });
};

const destroyBlock = (body) => {
  const entity = body.plugin.entity;
  destroyBody(body, entity.score, [entity.fill, "#fef1cb"]);
  state.destroyedBlocks += 1;
};

const destroyTarget = (body) => {
  destroyBody(body, body.plugin.entity.score, ["#ffe37e", "#ffae54", "#fff6d3"]);
  state.destroyedTargets += 1;

  if (state.destroyedTargets >= state.totalTargets && state.mode === "playing") {
    state.mode = "won";
    window.clearTimeout(state.spawnTimer);
    updateResultOverlay(
      true,
      "Structure Broken",
      "建筑核心已清空",
      `你用 ${state.shotsTaken} 发弹体打掉了当前结构的全部核心目标。可以继续切换到下一个预设。`,
    );
  }
};

const hasActiveProjectileBodies = () =>
  getDynamicBodies().some((body) => body.plugin?.entity?.kind === "projectile");

const ensureSelectedType = () => {
  if (state.ammo[state.selectedType] > 0) {
    return state.selectedType;
  }

  const fallback = getFirstAvailableType();
  if (fallback) {
    state.selectedType = fallback;
  }
  return fallback;
};

const spawnReadyProjectile = () => {
  if (state.mode !== "playing" || state.currentProjectile || !ensureSelectedType()) {
    updateHud();
    return;
  }

  const body = createProjectile(state.selectedType);
  World.add(world, body);
  state.currentProjectile = body;
  state.dragPosition = { ...ANCHOR };
  updateHud();
};

const queueNextProjectile = () => {
  window.clearTimeout(state.spawnTimer);
  if (state.mode !== "playing" || sumAmmo(state.ammo) <= 0) {
    return;
  }

  state.spawnTimer = window.setTimeout(() => {
    spawnReadyProjectile();
  }, READY_SPAWN_DELAY_MS);
};

const loadPreset = (index) => {
  clearScene();
  state.presetIndex = index;
  state.score = 0;
  state.destroyedBlocks = 0;
  state.destroyedTargets = 0;
  state.shotsTaken = 0;
  state.mode = "playing";
  updateResultOverlay(false);

  const preset = PRESETS[index];
  state.ammo = { ...preset.ammo };
  state.selectedType = Object.keys(state.ammo).find((type) => state.ammo[type] > 0) ?? "heavy";

  const bodies = [];
  preset.build(builderFactory(bodies));
  state.totalTargets = bodies.filter((body) => body.plugin.entity.kind === "target").length;

  World.add(world, bodies);
  settleScene();
  spawnReadyProjectile();
  updateHud();
};

const selectProjectileType = (type) => {
  if (state.ammo[type] <= 0) {
    return;
  }

  state.selectedType = type;

  if (state.currentProjectile && !state.currentProjectile.plugin.entity.launched) {
    World.remove(world, state.currentProjectile);
    state.currentProjectile = null;
    spawnReadyProjectile();
  } else {
    updateHud();
  }
};

const resizeCanvas = () => {
  const rect = elements.stage.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  elements.stage.width = Math.round(width * pixelRatio);
  elements.stage.height = Math.round(height * pixelRatio);

  state.layout = {
    width,
    height,
    pixelWidth: elements.stage.width,
    pixelHeight: elements.stage.height,
    scale: Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT),
    offsetX: (width - WORLD_WIDTH * Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT)) / 2,
    offsetY: (height - WORLD_HEIGHT * Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT)) / 2,
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

const clampPull = (pointer) => {
  const delta = Vector.sub(pointer, ANCHOR);
  const clampedX = Math.min(delta.x, 26);
  const limited = { x: clampedX, y: Math.max(-94, Math.min(94, delta.y)) };
  const magnitude = Vector.magnitude(limited);

  if (magnitude <= MAX_PULL) {
    return Vector.add(ANCHOR, limited);
  }

  const normalized = Vector.normalise(limited);
  return Vector.add(ANCHOR, Vector.mult(normalized, MAX_PULL));
};

const updateReadyProjectile = (position) => {
  if (!state.currentProjectile) {
    return;
  }

  Body.setPosition(state.currentProjectile, position);
  Body.setVelocity(state.currentProjectile, { x: 0, y: 0 });
  Body.setAngularVelocity(state.currentProjectile, 0);
  state.dragPosition = position;
};

const launchProjectile = () => {
  if (!state.currentProjectile) {
    return;
  }

  const projectile = state.currentProjectile;
  const entity = projectile.plugin.entity;
  const config = PROJECTILES[entity.type];
  const pullVector = Vector.sub(projectile.position, ANCHOR);
  const pullMagnitude = Vector.magnitude(pullVector);

  if (pullMagnitude < 18) {
    updateReadyProjectile(ANCHOR);
    return;
  }

  Body.setStatic(projectile, false);
  Body.setVelocity(projectile, {
    x: -pullVector.x * config.launchFactor,
    y: -pullVector.y * config.launchFactor,
  });
  Body.setAngularVelocity(projectile, (Math.random() - 0.5) * 0.28);
  entity.launched = true;
  entity.launchedAt = performance.now();
  entity.removeAt = entity.launchedAt + PROJECTILE_RETIRE_MS;

  state.ammo[entity.type] -= 1;
  state.shotsTaken += 1;
  state.currentProjectile = null;
  state.dragging = false;
  queueNextProjectile();
  updateHud();
};

const detonateProjectile = (projectile, contactPoint) => {
  const entity = projectile.plugin.entity;
  if (entity.exploded) {
    return;
  }

  entity.exploded = true;
  const radius = PROJECTILES.blast.blastRadius;

  spawnParticleBurst(contactPoint, {
    colors: ["#ffe091", "#ff9862", "#fff7d8"],
    count: 28,
    minSpeed: 2.8,
    maxSpeed: 7.4,
    life: 620,
  });
  state.particles.push({
    kind: "ring",
    x: contactPoint.x,
    y: contactPoint.y,
    ringRadius: radius,
    size: 0,
    life: 360,
    maxLife: 360,
    color: "rgba(255, 221, 162, 0.95)",
  });

  getDynamicBodies().forEach((body) => {
    if (body === projectile || body.isStatic) {
      return;
    }

    const other = body.plugin?.entity;
    if (!other || (other.kind !== "block" && other.kind !== "target")) {
      return;
    }

    const direction = Vector.sub(body.position, contactPoint);
    const distance = Math.max(20, Vector.magnitude(direction));
    if (distance > radius) {
      return;
    }

    const forceScale = 1 - distance / radius;
    const normal = Vector.normalise(direction);
    Body.applyForce(
      body,
      body.position,
      Vector.mult(normal, 0.018 * forceScale * body.mass),
    );

    if (other.kind === "block" && forceScale > 0.66) {
      destroyBlock(body);
    }

    if (other.kind === "target" && forceScale > 0.74) {
      destroyTarget(body);
    }
  });

  World.remove(world, projectile);
};

const handleCollisions = (event) => {
  event.pairs.forEach((pair) => {
    const bodies = [pair.bodyA, pair.bodyB];
    const projectile = bodies.find((body) => body.plugin?.entity?.kind === "projectile");
    const target = bodies.find((body) => {
      const kind = body.plugin?.entity?.kind;
      return kind === "block" || kind === "target";
    });

    if (!projectile || !target) {
      return;
    }

    const projectileEntity = projectile.plugin.entity;
    const relativeSpeed = Vector.magnitude(Vector.sub(pair.bodyA.velocity, pair.bodyB.velocity));
    const contactPoint = pair.collision.supports[0] ?? projectile.position;

    spawnParticleBurst(contactPoint, {
      colors: [projectileEntity.trail, "#fff0c8"],
      count: relativeSpeed > 9 ? 12 : 7,
      minSpeed: 1.4,
      maxSpeed: 4.2,
      life: 260,
      minSize: 2,
      maxSize: 5,
    });

    if (projectileEntity.type === "blast" && projectileEntity.launched && relativeSpeed > 4.8) {
      detonateProjectile(projectile, contactPoint);
      return;
    }

    if (target.plugin.entity.kind === "block" && relativeSpeed > 12.5) {
      destroyBlock(target);
    }

    if (target.plugin.entity.kind === "target" && relativeSpeed > 10.2) {
      destroyTarget(target);
    }
  });
};

const updateParticles = (deltaMs) => {
  const gravity = 0.0048 * deltaMs;
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
  const now = performance.now();

  getDynamicBodies().forEach((body) => {
    const entity = body.plugin?.entity;
    if (!entity) {
      return;
    }

    if (entity.kind === "block") {
      if (body.position.y > FLOOR_Y + 120 || body.position.x < -120 || body.position.x > WORLD_WIDTH + 120) {
        destroyBlock(body);
      }
      return;
    }

    if (entity.kind === "target") {
      if (
        body.position.y > FLOOR_Y + 80 ||
        body.position.x < 70 ||
        body.position.x > WORLD_WIDTH + 90 ||
        Math.abs(body.angle) > 1.48
      ) {
        destroyTarget(body);
      }
      return;
    }

    if (entity.kind === "projectile" && entity.launched) {
      if (
        body.position.y > WORLD_HEIGHT + 220 ||
        body.position.x > WORLD_WIDTH + 220 ||
        body.position.x < -220 ||
        (now > entity.removeAt && body.speed < 0.35)
      ) {
        World.remove(world, body);
      }
    }
  });
};

const maybeEndRound = () => {
  if (state.mode !== "playing") {
    return;
  }

  if (state.destroyedTargets >= state.totalTargets) {
    return;
  }

  if (sumAmmo(state.ammo) > 0 || state.currentProjectile || hasActiveProjectileBodies()) {
    return;
  }

  state.mode = "lost";
  updateResultOverlay(
    true,
    "Out Of Ammo",
    "弹药已耗尽",
    `当前预设还剩 ${state.totalTargets - state.destroyedTargets} 个核心目标。调整球种组合或切换到其它建筑继续测试。`,
  );
};

const drawRoundedPath = (body) => {
  const vertices = body.vertices;
  ctx.beginPath();
  ctx.moveTo(vertices[0].x, vertices[0].y);

  for (let index = 1; index < vertices.length; index += 1) {
    ctx.lineTo(vertices[index].x, vertices[index].y);
  }

  ctx.closePath();
};

const drawBlock = (body, entity) => {
  drawRoundedPath(body);
  ctx.fillStyle = entity.fill;
  ctx.strokeStyle = entity.stroke;
  ctx.lineWidth = 3;
  ctx.fill();
  ctx.stroke();

  const diagonal = Math.hypot(body.bounds.max.x - body.bounds.min.x, body.bounds.max.y - body.bounds.min.y);
  const stripeAlpha = entity.material === "glass" ? 0.26 : 0.12;
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = `rgba(255,255,255,${stripeAlpha})`;
  ctx.lineWidth = 2;
  for (let offset = -diagonal; offset < diagonal * 1.2; offset += 18) {
    ctx.beginPath();
    ctx.moveTo(body.position.x - diagonal, body.position.y + offset);
    ctx.lineTo(body.position.x + diagonal, body.position.y + offset - diagonal);
    ctx.stroke();
  }
  ctx.restore();
};

const drawTarget = (body, entity) => {
  drawRoundedPath(body);
  ctx.fillStyle = entity.fill;
  ctx.strokeStyle = entity.stroke;
  ctx.lineWidth = 3;
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);
  ctx.fillStyle = "#49310d";
  ctx.beginPath();
  ctx.arc(0, 0, entity.radius * 0.32, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#fff3be";
  ctx.beginPath();
  ctx.arc(-entity.radius * 0.18, -entity.radius * 0.12, entity.radius * 0.08, 0, Math.PI * 2);
  ctx.arc(entity.radius * 0.18, -entity.radius * 0.12, entity.radius * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const drawProjectile = (body, entity) => {
  const config = PROJECTILES[entity.type];
  const pulse = entity.type === "blast" ? 1 + Math.sin(performance.now() / 120) * 0.04 : 1;

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
  ctx.arc(-config.radius * 0.22, -config.radius * 0.26, config.radius * 0.26, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fill();

  if (entity.type === "blast") {
    ctx.beginPath();
    ctx.moveTo(-5, -10);
    ctx.lineTo(7, -2);
    ctx.lineTo(-2, 11);
    ctx.strokeStyle = "#fff4d8";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.restore();
};

const drawSling = () => {
  const readyBody = state.currentProjectile;
  const projectilePosition = readyBody ? readyBody.position : ANCHOR;
  const backArm = { x: ANCHOR.x - 18, y: ANCHOR.y - 10 };
  const frontArm = { x: ANCHOR.x + 18, y: ANCHOR.y + 18 };

  ctx.fillStyle = "#5a3118";
  ctx.fillRect(ANCHOR.x - 32, FLOOR_Y - 168, 18, 168);
  ctx.fillRect(ANCHOR.x + 12, FLOOR_Y - 188, 18, 188);
  ctx.fillStyle = "#77502b";
  ctx.fillRect(ANCHOR.x - 48, FLOOR_Y - 14, 108, 18);

  if (readyBody) {
    ctx.strokeStyle = "#f2d6ab";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(backArm.x, backArm.y);
    ctx.lineTo(projectilePosition.x, projectilePosition.y);
    ctx.lineTo(frontArm.x, frontArm.y);
    ctx.stroke();
  }
};

const drawTrajectory = () => {
  if (!state.dragging || !state.currentProjectile) {
    return;
  }

  const projectile = state.currentProjectile;
  const config = PROJECTILES[projectile.plugin.entity.type];
  const pull = Vector.sub(projectile.position, ANCHOR);
  const velocity = {
    x: -pull.x * config.launchFactor,
    y: -pull.y * config.launchFactor,
  };

  ctx.fillStyle = "rgba(255, 240, 202, 0.75)";
  let simX = ANCHOR.x;
  let simY = ANCHOR.y;
  let simVx = velocity.x;
  let simVy = velocity.y;
  for (let step = 1; step <= 14; step += 1) {
    const size = Math.max(2.2, 6 - step * 0.28);
    simX += simVx * 6.4;
    simY += simVy * 6.4;
    simVy += 0.42;
    ctx.beginPath();
    ctx.arc(simX, simY, size, 0, Math.PI * 2);
    ctx.fill();
  }
};

const drawBackdrop = () => {
  const gradient = ctx.createLinearGradient(0, 0, 0, WORLD_HEIGHT);
  gradient.addColorStop(0, "#24170f");
  gradient.addColorStop(0.55, "#3c2b1a");
  gradient.addColorStop(1, "#17110b");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  ctx.fillStyle = "rgba(255, 207, 133, 0.08)";
  ctx.beginPath();
  ctx.arc(1080, 160, 170, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
  for (let x = 0; x < WORLD_WIDTH; x += 86) {
    ctx.fillRect(x, FLOOR_Y + 8, 42, 64);
  }

  ctx.fillStyle = "#654321";
  ctx.fillRect(0, FLOOR_Y, WORLD_WIDTH, WORLD_HEIGHT - FLOOR_Y);

  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x < WORLD_WIDTH; x += 72) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, FLOOR_Y);
    ctx.stroke();
  }
};

const colorWithAlpha = (color, alpha) => {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const normalized = hex.length === 3
      ? hex.split("").map((char) => char + char).join("")
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

const drawParticles = () => {
  state.particles.forEach((particle) => {
    const alpha = particle.life / particle.maxLife;
    if (particle.kind === "ring") {
      const radius = particle.ringRadius * (1 - alpha * 0.1);
      ctx.strokeStyle = colorWithAlpha(particle.color, alpha);
      ctx.lineWidth = 8 * alpha;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, radius * (1 - alpha), 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    ctx.fillStyle = colorWithAlpha(particle.color, Math.max(0.12, alpha));
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
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  drawBackdrop();
  drawTrajectory();
  drawSling();

  const drawBodies = getDynamicBodies().sort((a, b) => a.position.y - b.position.y);
  drawBodies.forEach((body) => {
    const entity = body.plugin.entity;
    if (entity.kind === "block") {
      drawBlock(body, entity);
    } else if (entity.kind === "target") {
      drawTarget(body, entity);
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

  if (!state.dragging) {
    Engine.update(engine, delta);
  }

  updateParticles(delta);
  removeExpiredBodies();
  maybeEndRound();
  render();
  window.requestAnimationFrame(tick);
};

const handlePointerDown = (event) => {
  if (!state.currentProjectile || state.mode !== "playing") {
    return;
  }

  const pointer = screenToWorld(event.clientX, event.clientY);
  const distance = Vector.magnitude(Vector.sub(pointer, state.currentProjectile.position));

  if (distance > PROJECTILES[state.currentProjectile.plugin.entity.type].radius * 1.8) {
    return;
  }

  state.dragging = true;
  updateReadyProjectile(clampPull(pointer));
  elements.stage.setPointerCapture(event.pointerId);
};

const handlePointerMove = (event) => {
  if (!state.dragging || !state.currentProjectile) {
    return;
  }

  updateReadyProjectile(clampPull(screenToWorld(event.clientX, event.clientY)));
};

const handlePointerUp = (event) => {
  if (!state.dragging) {
    return;
  }

  if (elements.stage.hasPointerCapture(event.pointerId)) {
    elements.stage.releasePointerCapture(event.pointerId);
  }

  launchProjectile();
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
    loadPreset(state.presetIndex);
  } else if (key === "n") {
    loadPreset((state.presetIndex + 1) % PRESETS.length);
  }
};

createStaticWorld();
Events.on(engine, "collisionStart", handleCollisions);

elements.ammoButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectProjectileType(button.dataset.projectileType);
  });
});

elements.presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    loadPreset(Number(button.dataset.presetIndex));
  });
});

elements.restart.addEventListener("click", () => {
  loadPreset(state.presetIndex);
});

elements.nextPreset.addEventListener("click", () => {
  loadPreset((state.presetIndex + 1) % PRESETS.length);
});

elements.resultRestart.addEventListener("click", () => {
  loadPreset(state.presetIndex);
});

elements.resultNext.addEventListener("click", () => {
  loadPreset((state.presetIndex + 1) % PRESETS.length);
});

elements.stage.addEventListener("pointerdown", handlePointerDown);
elements.stage.addEventListener("pointermove", handlePointerMove);
elements.stage.addEventListener("pointerup", handlePointerUp);
elements.stage.addEventListener("pointercancel", handlePointerUp);
window.addEventListener("keydown", handleKeydown);
window.addEventListener("resize", resizeCanvas);

resizeCanvas();
loadPreset(0);
window.requestAnimationFrame(tick);
