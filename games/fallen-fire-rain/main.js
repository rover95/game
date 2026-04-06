const WORLD_W = 640;
const WORLD_H = 1280;
const BASE_Y = WORLD_H - 70;
const BASE_HP_START = 20;
const WAVE_MS = 25000;

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
const ui = {
  wave: document.getElementById("wave"),
  hp: document.getElementById("hp"),
  gold: document.getElementById("gold"),
  level: document.getElementById("level"),
  ammo: document.getElementById("ammo"),
  restart: document.getElementById("restart"),
  openShop: document.getElementById("open-shop"),
  bulletModal: document.getElementById("bullet-modal"),
  bulletTitle: document.getElementById("bullet-title"),
  bulletHint: document.getElementById("bullet-hint"),
  bulletOptions: document.getElementById("bullet-options"),
  levelModal: document.getElementById("level-modal"),
  levelOptions: document.getElementById("level-options"),
  shopModal: document.getElementById("shop-modal"),
  shopOptions: document.getElementById("shop-options"),
  skipShop: document.getElementById("skip-shop"),
  resultModal: document.getElementById("result-modal"),
  resultTitle: document.getElementById("result-title"),
  resultText: document.getElementById("result-text"),
  resultRestart: document.getElementById("result-restart"),
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const shuffle = (list) => [...list].sort(() => Math.random() - 0.5);
const levelCurve = (level) => Math.floor(36 + level * level * 14 + level * 6);
const AudioCtor = window.AudioContext || window.webkitAudioContext;

const audioState = {
  ctx: null,
  master: null,
  lastImpactAt: 0,
};

const parseHexColor = (hex) => {
  const normalized = hex.replace("#", "");
  const full = normalized.length === 3 ? normalized.split("").map((char) => char + char).join("") : normalized;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
};

const mixHexColors = (colors) => {
  if (!colors.length) return "#9de8ff";
  const total = colors.reduce((acc, color) => {
    const parsed = parseHexColor(color);
    acc.r += parsed.r;
    acc.g += parsed.g;
    acc.b += parsed.b;
    return acc;
  }, { r: 0, g: 0, b: 0 });
  const toHex = (value) => Math.round(value).toString(16).padStart(2, "0");
  return `#${toHex(total.r / colors.length)}${toHex(total.g / colors.length)}${toHex(total.b / colors.length)}`;
};

const rgba = (hex, alpha) => {
  const { r, g, b } = parseHexColor(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

function glowCircle(context, x, y, radius, hex, alpha = 1) {
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, rgba(hex, 0.9 * alpha));
  gradient.addColorStop(0.4, rgba(hex, 0.25 * alpha));
  gradient.addColorStop(1, rgba(hex, 0));
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

function ring(context, x, y, radius, thickness, hex, alpha = 1) {
  context.strokeStyle = rgba(hex, alpha);
  context.lineWidth = thickness;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.stroke();
}

function lineGlow(context, x1, y1, x2, y2, width, hex, alpha = 1) {
  context.strokeStyle = rgba(hex, alpha);
  context.lineWidth = width;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function ensureAudio() {
  if (!AudioCtor) return null;
  if (!audioState.ctx) {
    audioState.ctx = new AudioCtor();
    audioState.master = audioState.ctx.createGain();
    audioState.master.gain.value = 0.18;
    audioState.master.connect(audioState.ctx.destination);
  }
  return audioState.ctx;
}

function primeAudio() {
  const ctx = ensureAudio();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

function playTone({
  type = "sine",
  frequency = 440,
  endFrequency = frequency,
  duration = 0.12,
  volume = 0.05,
  attack = 0.002,
  detune = 0,
}) {
  const ctx = ensureAudio();
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), now + duration);
  osc.detune.value = detune;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(volume, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain);
  gain.connect(audioState.master);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function playShootSfx(loadout, shotCount = 1) {
  const base = loadout.gravity ? 170 : loadout.rapid ? 520 : 340;
  playTone({
    type: loadout.gravity ? "triangle" : loadout.rapid ? "square" : "sawtooth",
    frequency: base,
    endFrequency: base * (loadout.gravity ? 0.72 : 1.35),
    duration: loadout.gravity ? 0.18 : 0.08,
    volume: Math.min(0.08, 0.04 + shotCount * 0.008),
  });
}

function playImpactSfx(loadout, heavy = false) {
  const ctx = ensureAudio();
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  if (now - audioState.lastImpactAt < 0.025) return;
  audioState.lastImpactAt = now;
  playTone({
    type: heavy || loadout.gravity ? "triangle" : "square",
    frequency: heavy ? 180 : 260,
    endFrequency: heavy ? 90 : 150,
    duration: heavy ? 0.16 : 0.08,
    volume: heavy ? 0.075 : 0.045,
  });
}

function playExplosionSfx() {
  playTone({
    type: "sawtooth",
    frequency: 210,
    endFrequency: 62,
    duration: 0.28,
    volume: 0.08,
  });
}

function playArcSfx() {
  playTone({
    type: "square",
    frequency: 760,
    endFrequency: 320,
    duration: 0.09,
    volume: 0.035,
  });
}

function playUiSfx(kind = "select") {
  if (kind === "open") {
    playTone({ type: "triangle", frequency: 360, endFrequency: 520, duration: 0.12, volume: 0.04 });
    return;
  }
  if (kind === "skill") {
    playTone({ type: "sine", frequency: 280, endFrequency: 620, duration: 0.24, volume: 0.06 });
    return;
  }
  playTone({ type: "triangle", frequency: 520, endFrequency: 760, duration: 0.08, volume: 0.04 });
}

const bulletCatalog = [
  { id: "blast", title: "爆裂弹", body: "命中会炸开冲击圈，造成范围伤害并继承其他异常效果。", color: "#ff9d6a", trailColor: "#ffd1a8" },
  { id: "burn", title: "燃烧弹", body: "附加灼烧，命中会喷出炽热火环。", color: "#ff7c4e", trailColor: "#ffb173" },
  { id: "frost", title: "寒霜弹", body: "附加冻结减速，命中绽开冰晶脉冲。", color: "#7fd8ff", trailColor: "#c6f3ff" },
  { id: "arc", title: "电弧弹", body: "命中后链向附近目标，并能带过去其他异常。", color: "#9f8dff", trailColor: "#d9d1ff" },
  { id: "corrosion", title: "腐蚀弹", body: "削甲并施加腐蚀，装甲目标会持续掉血。", color: "#8ef085", trailColor: "#c9ff9a" },
  { id: "absorb", title: "吸收弹", body: "保持普通威力，子弹命中经验或金币时会立刻触发回收飞向炮塔。", color: "#ffe56f", trailColor: "#fff3b5" },
  { id: "split", title: "分裂弹", body: "首次命中后裂成双弹继续追击。", color: "#ff8fbe", trailColor: "#ffd0e4" },
  { id: "rapid", title: "高速弹", body: "弹速极高但单发伤害较低，会留下细长残影。", color: "#ffd66e", trailColor: "#fff0a6" },
  { id: "gravity", title: "重力弹", body: "弹速偏慢但威力巨大，命中压出暗色重压波。", color: "#8f9cff", trailColor: "#c2c8ff" },
  { id: "ricochet", title: "反弹弹", body: "子弹会无限反弹，直到飞出屏幕底部才会消散。", color: "#7ff0d2", trailColor: "#c6fff0" },
];
const bulletTypeMap = Object.fromEntries(bulletCatalog.map((type) => [type.id, type]));

const upgrades = [
  { id: "dmg", rarity: "普通", title: "高能装药", body: "子弹伤害 +25%", apply: (s) => { s.stats.damage *= 1.25; } },
  { id: "as", rarity: "普通", title: "快装供弹", body: "攻速 +20%", apply: (s) => { s.stats.fireRate *= 1.2; } },
  { id: "crit", rarity: "普通", title: "精准校准", body: "暴击率 +10%", apply: (s) => { s.stats.crit += 0.1; } },
  { id: "critMul", rarity: "稀有", title: "致命装填", body: "暴击伤害 +35%", apply: (s) => { s.stats.critMul += 0.35; } },
  { id: "ricochet-up", rarity: "普通", title: "强化反弹", body: "反弹次数 +2", apply: (s) => { s.stats.bounces += 2; } },
  { id: "multi", rarity: "稀有", title: "双联炮口", body: "每次发射 +1 枚子弹", apply: (s) => { s.stats.shots += 1; } },
  { id: "pierce", rarity: "稀有", title: "穿甲弹仓", body: "穿透 +1", apply: (s) => { s.stats.pierce += 1; } },
  { id: "velocity", rarity: "普通", title: "涡轮推进", body: "基础弹速 +16%", apply: (s) => { s.stats.bulletSpeed *= 1.16; } },
  { id: "magnet", rarity: "普通", title: "资源磁吸", body: "自动吸收范围提升", apply: (s) => { s.stats.pickupRange += 70; } },
  { id: "repair", rarity: "普通", title: "战地维修", body: "基地回复 2 点", apply: (s) => { s.baseHp = Math.min(s.maxBaseHp, s.baseHp + 2); } },
  { id: "fort", rarity: "稀有", title: "防线加固", body: "基地上限 +5，并回复 5", apply: (s) => { s.maxBaseHp += 5; s.baseHp = Math.min(s.maxBaseHp, s.baseHp + 5); } },
  { id: "bounty", rarity: "普通", title: "赏金猎人", body: "金币获取 +25%", apply: (s) => { s.stats.goldRate += 0.25; } },
  { id: "xp", rarity: "普通", title: "经验富集", body: "经验获取 +20%", apply: (s) => { s.stats.xpRate += 0.2; } },
];

const shopPool = [
  { title: "攻击 +10%", cost: 80, apply: (s) => { s.stats.damage *= 1.1; } },
  { title: "攻速 +10%", cost: 90, apply: (s) => { s.stats.fireRate *= 1.1; } },
  { title: "弹速 +12%", cost: 70, apply: (s) => { s.stats.bulletSpeed *= 1.12; } },
  { title: "反弹 +1", cost: 110, apply: (s) => { s.stats.bounces += 1; } },
  { title: "基地 +3", cost: 70, apply: (s) => { s.baseHp = Math.min(s.maxBaseHp, s.baseHp + 3); } },
  { title: "立刻 +100 金币", cost: 60, apply: (s) => { s.gold += 100; } },
  { title: "稀有升级", cost: 130, apply: (s) => { enqueueModal(s, { type: "level", onlyRare: true }); } },
];

let state;

function createEnemyStatus() {
  return { burnTimer: 0, burnDps: 0, frostTimer: 0, slowMul: 1, corrosionTimer: 0, corrosionArmor: 0, corrosionDps: 0 };
}

function createState() {
  return {
    running: true,
    paused: false,
    activeModal: null,
    modalQueue: [],
    turret: { x: WORLD_W / 2, y: BASE_Y, angle: -Math.PI / 2, firing: false, cooldown: 0, mode: "normal" },
    stats: { damage: 20, fireRate: 4, bulletSpeed: 378, bounces: 3, crit: 0.05, critMul: 1.5, shots: 1, pierce: 0, pickupRange: 120, goldRate: 1, xpRate: 1 },
    bulletTypes: [],
    bullets: [],
    enemies: [],
    drops: [],
    effects: [],
    mouse: { x: WORLD_W / 2, y: WORLD_H * 0.65 },
    baseHp: BASE_HP_START,
    maxBaseHp: BASE_HP_START,
    wave: 1,
    waveTimer: 0,
    spawnTimer: 0,
    eliteTimer: 7,
    bossAlive: false,
    exp: 0,
    level: 1,
    expNeed: levelCurve(1),
    gold: 0,
    skillCd: 0,
    elapsed: 0,
    shopReady: false,
    layout: null,
  };
}

function aimToMouse(s) {
  const dx = s.mouse.x - s.turret.x;
  const dy = s.mouse.y - s.turret.y;
  s.turret.angle = clamp(Math.atan2(dy, dx), -Math.PI + 0.18, -0.18);
}

function getRemainingBulletTypes(s) {
  return bulletCatalog.filter((type) => !s.bulletTypes.includes(type.id));
}

function hasBulletType(s, id) {
  return s.bulletTypes.includes(id);
}

function buildBulletLoadout(s) {
  const activeTypes = s.bulletTypes.map((id) => bulletTypeMap[id]).filter(Boolean);
  const loadout = {
    ids: activeTypes.map((type) => type.id),
    titles: activeTypes.map((type) => type.title),
    damageMul: 1,
    speedMul: 1,
    sizeMul: 1,
    splitCount: 0,
    pickupBonus: 0,
    fireRateMul: 1,
    blast: false,
    burn: false,
    frost: false,
    arc: false,
    corrosion: false,
    absorb: false,
    gravity: false,
    rapid: false,
    infiniteBounce: false,
    coreColor: "#9de8ff",
    trailColor: "#9de8ff",
    glowColor: "#dff8ff",
  };
  activeTypes.forEach((type) => {
    switch (type.id) {
      case "blast": loadout.blast = true; break;
      case "burn": loadout.burn = true; break;
      case "frost": loadout.frost = true; break;
      case "arc": loadout.arc = true; break;
      case "corrosion": loadout.corrosion = true; break;
      case "absorb": loadout.absorb = true; break;
      case "split": loadout.splitCount += 1; break;
      case "rapid": loadout.rapid = true; loadout.speedMul *= 2; loadout.fireRateMul *= 2; loadout.damageMul *= 0.4; loadout.sizeMul *= 0.82; break;
      case "gravity": loadout.gravity = true; loadout.speedMul *= 0.6; loadout.damageMul *= 2.2; loadout.sizeMul *= 1.28; break;
      case "ricochet": loadout.infiniteBounce = true; break;
      default: break;
    }
  });
  if (activeTypes.length) {
    loadout.coreColor = mixHexColors(activeTypes.map((type) => type.color));
    loadout.trailColor = mixHexColors(activeTypes.map((type) => type.trailColor));
    loadout.glowColor = mixHexColors(activeTypes.map((type) => type.trailColor));
  }
  return loadout;
}

function getPickupRange(s) {
  return s.stats.pickupRange + buildBulletLoadout(s).pickupBonus;
}

function enqueueModal(s, modal) {
  if (modal.type === "bullet" && !getRemainingBulletTypes(s).length) return;
  s.modalQueue.push(modal);
}

function closeActiveModal(s) {
  s.paused = false;
  s.activeModal = null;
  syncHud(s);
  openNextModal(s);
}

function openNextModal(s) {
  if (!s.running || s.paused || s.activeModal || !s.modalQueue.length) return;
  const next = s.modalQueue.shift();
  if (!next) return;
  if (next.type === "level") showLevelUp(s, Boolean(next.onlyRare));
  else if (next.type === "shop") showShop(s);
  else if (next.type === "bullet") showBulletDraft(s, next.reason);
}

function showLevelUp(s, onlyRare = false) {
  s.paused = true;
  s.activeModal = "level";
  playUiSfx("open");
  ui.levelModal.classList.remove("hidden");
  const pool = onlyRare ? upgrades.filter((upgrade) => ["稀有", "史诗"].includes(upgrade.rarity)) : upgrades;
  const picks = shuffle(pool).slice(0, 3);
  ui.levelOptions.innerHTML = picks.map((upgrade, index) => `<button class="card" data-upgrade="${index}"><strong>${upgrade.title}</strong><small>${upgrade.rarity}</small><small>${upgrade.body}</small></button>`).join("");
  ui.levelOptions.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      picks[Number(button.dataset.upgrade)].apply(s);
      playUiSfx("select");
      ui.levelModal.classList.add("hidden");
      closeActiveModal(s);
    }, { once: true });
  });
}

function showShop(s) {
  s.paused = true;
  s.activeModal = "shop";
  playUiSfx("open");
  ui.shopModal.classList.remove("hidden");
  const picks = shuffle(shopPool).slice(0, 4);
  ui.shopOptions.innerHTML = picks.map((option, index) => `<button class="card" data-shop="${index}"><strong>${option.title}</strong><small>花费 ${option.cost} 金币</small></button>`).join("");
  ui.shopOptions.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const option = picks[Number(button.dataset.shop)];
      if (s.gold < option.cost) return;
      s.gold -= option.cost;
      option.apply(s);
      playUiSfx("select");
      s.shopReady = false;
      ui.shopModal.classList.add("hidden");
      closeActiveModal(s);
    });
  });
}

function showBulletDraft(s, reason = "elite") {
  const remaining = getRemainingBulletTypes(s);
  if (!remaining.length) {
    closeActiveModal(s);
    return;
  }
  s.paused = true;
  s.activeModal = "bullet";
  playUiSfx("open");
  ui.bulletModal.classList.remove("hidden");
  ui.bulletTitle.textContent = reason === "start" ? "开局选择一种子弹类型" : "精英核心解锁新子弹";
  ui.bulletHint.textContent = reason === "start"
    ? "从 3 种初始弹种中选 1 种作为开局核心，后续击败精英敌人可继续叠加新的弹种特性。"
    : "击败精英后可从 3 种新弹种中选 1 种。已获得的弹种会与当前弹药特性叠加。";
  const picks = shuffle(remaining).slice(0, Math.min(3, remaining.length));
  ui.bulletOptions.innerHTML = picks.map((type, index) => `<button class="card" data-bullet="${index}"><strong>${type.title}</strong><small>${type.body}</small></button>`).join("");
  ui.bulletOptions.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      const type = picks[Number(button.dataset.bullet)];
      if (!s.bulletTypes.includes(type.id)) s.bulletTypes.push(type.id);
      playUiSfx("select");
      ui.bulletModal.classList.add("hidden");
      closeActiveModal(s);
    }, { once: true });
  });
}
function spawnRingEffect(s, x, y, color, maxRadius, life, lineWidth = 4) {
  s.effects.push({ kind: "ring", x, y, color, maxRadius, maxLife: life, life, lineWidth });
}

function spawnChainEffect(s, fromX, fromY, toX, toY, color, life = 170) {
  s.effects.push({ kind: "chain", fromX, fromY, toX, toY, color, maxLife: life, life });
}

function spawnTextEffect(s, x, y, text, color = "#ffe7b1") {
  s.effects.push({ kind: "text", x, y, text, color, maxLife: 240, life: 240 });
}

function spawnParticleEffect(s, options) {
  s.effects.push({
    kind: "particle",
    x: options.x,
    y: options.y,
    vx: options.vx,
    vy: options.vy,
    radius: options.radius,
    color: options.color,
    alpha: options.alpha ?? 1,
    drag: options.drag ?? 0.96,
    shrink: options.shrink ?? 0.98,
    gravity: options.gravity ?? 0,
    maxLife: options.life,
    life: options.life,
  });
}

function addBurst(s, x, y, count, colorList, speedMin, speedMax, radiusMin, radiusMax, lifeMin, lifeMax, gravity = 0) {
  for (let index = 0; index < count; index += 1) {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(speedMin, speedMax);
    spawnParticleEffect(s, {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: rand(radiusMin, radiusMax),
      color: pick(colorList),
      life: rand(lifeMin, lifeMax),
      gravity,
      drag: 0.93,
      shrink: 0.97,
    });
  }
}

function spawnSparkLineEffect(s, points, color, life = 0.18, width = 2.5) {
  s.effects.push({ kind: "spark", points, color, maxLife: life, life, width });
}

function addLightning(s, x1, y1, x2, y2, color) {
  const segments = 8;
  const points = [{ x: x1, y: y1 }];
  for (let index = 1; index < segments; index += 1) {
    const t = index / segments;
    points.push({
      x: x1 + (x2 - x1) * t + rand(-10, 10),
      y: y1 + (y2 - y1) * t + rand(-10, 10),
    });
  }
  points.push({ x: x2, y: y2 });
  spawnSparkLineEffect(s, points, color, 0.16, 3);
  spawnSparkLineEffect(s, points, "#ffffff", 0.08, 1.25);
}

function spawnTrailGhost(s, bullet, color, widthScale = 1, life = 0.12, length = 40) {
  s.effects.push({
    kind: "ghost",
    x: bullet.x,
    y: bullet.y,
    angle: Math.atan2(bullet.vy, bullet.vx),
    length,
    width: bullet.radius * widthScale,
    color,
    alpha: 0.9,
    maxLife: life,
    life,
  });
}

function emitBulletAmbientEffects(s, bullet) {
  if (bullet.loadout.blast) {
    spawnTrailGhost(s, bullet, "#ff8232", 1.4, 0.1, 28);
  }
  if (bullet.loadout.burn && Math.random() < 0.7) {
    spawnParticleEffect(s, {
      x: bullet.x - Math.cos(Math.atan2(bullet.vy, bullet.vx)) * 12 + rand(-2, 2),
      y: bullet.y - Math.sin(Math.atan2(bullet.vy, bullet.vx)) * 12 + rand(-2, 2),
      vx: rand(-18, 18),
      vy: rand(12, 45),
      radius: rand(5, 9),
      color: pick(["#ff7c14", "#ffc23c", "#ff4b14"]),
      life: 0.22,
      drag: 0.92,
      shrink: 0.95,
    });
  }
  if (bullet.loadout.frost && Math.random() < 0.45) {
    spawnParticleEffect(s, {
      x: bullet.x + rand(-3, 3),
      y: bullet.y + rand(-3, 3),
      vx: rand(-12, 12),
      vy: rand(-6, 20),
      radius: rand(3, 6),
      color: "#b4e6ff",
      life: 0.24,
      drag: 0.94,
      shrink: 0.97,
    });
  }
  if (bullet.loadout.arc) {
    spawnTrailGhost(s, bullet, "#b45aff", 1.2, 0.08, 22);
  }
  if (bullet.loadout.corrosion && Math.random() < 0.55) {
    spawnParticleEffect(s, {
      x: bullet.x + rand(-4, 4),
      y: bullet.y + rand(-4, 4),
      vx: rand(-15, 15),
      vy: rand(-5, 20),
      radius: rand(4, 8),
      color: "#64ff78",
      life: 0.3,
      drag: 0.94,
      shrink: 0.975,
    });
  }
  if (bullet.loadout.absorb) {
    spawnTrailGhost(s, bullet, "#ffdc46", 1.3, 0.09, 24);
  }
  if (bullet.loadout.split) {
    spawnTrailGhost(s, bullet, "#ff78dc", 1.2, 0.08, 24);
  }
  if (bullet.loadout.rapid) {
    spawnTrailGhost(s, bullet, "#96d2ff", 0.6, 0.08, 110);
    spawnTrailGhost(s, bullet, "#ffffff", 0.3, 0.04, 68);
  }
  if (bullet.loadout.gravity) {
    spawnTrailGhost(s, bullet, "#6e64ff", 1.9, 0.14, 34);
    spawnTrailGhost(s, bullet, "#be8cff", 1.2, 0.1, 22);
  }
  if (bullet.loadout.infiniteBounce) {
    spawnTrailGhost(s, bullet, "#46ffdC", 1.0, 0.1, 32);
  }
}

function spawnBullet(s, angleOffset = 0, options = {}) {
  const loadout = options.loadout || buildBulletLoadout(s);
  const angle = (options.angle ?? s.turret.angle) + angleOffset;
  const speed = (options.baseSpeed ?? s.stats.bulletSpeed) * loadout.speedMul * (options.speedMul ?? 1);
  const radius = (options.radius ?? 12) * loadout.sizeMul * (options.radiusMul ?? 1);
  const damage = (options.damage ?? s.stats.damage) * loadout.damageMul * (options.damageMul ?? 1);
  s.bullets.push({
    x: options.x ?? s.turret.x,
    y: options.y ?? s.turret.y - 24,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    leftBounce: options.leftBounce ?? s.stats.bounces,
    leftPierce: options.leftPierce ?? (s.turret.mode === "pierce" ? s.stats.pierce + 1 : s.stats.pierce),
    damage,
    rage: options.rage ?? 0,
    radius,
    loadout,
    splitLeft: options.splitLeft ?? loadout.splitCount,
    infiniteBounce: options.infiniteBounce ?? loadout.infiniteBounce,
    dead: false,
  });
}

function spawnSplitBullets(s, bullet) {
  if (bullet.splitLeft <= 0) return;
  const baseAngle = Math.atan2(bullet.vy, bullet.vx);
  [-0.28, 0.28].forEach((offset) => {
    spawnBullet(s, 0, {
      x: bullet.x,
      y: bullet.y,
      angle: baseAngle + offset,
      baseSpeed: Math.hypot(bullet.vx, bullet.vy) * 0.96,
      damage: bullet.damage * 0.56,
      radius: bullet.radius * 0.9,
      leftBounce: Math.max(1, bullet.leftBounce),
      leftPierce: bullet.leftPierce,
      splitLeft: bullet.splitLeft - 1,
      loadout: bullet.loadout,
      infiniteBounce: bullet.infiniteBounce,
      rage: bullet.rage,
    });
  });
  spawnRingEffect(s, bullet.x, bullet.y, "#ffd2ea", 52, 180, 3);
  bullet.splitLeft = 0;
}

function spawnEnemy(s, type = "auto") {
  const speedScale = 0.25;
  const hpScale = 2 * (1 + (s.wave - 1) * 0.28);
  const table = [
    { kind: "meteor_s", hp: 30, speed: 130 * speedScale, r: 20, touch: 1, exp: 8, gold: 9, color: "#ff8d5c", shape: "triangle", sides: 3 },
    { kind: "drone", hp: 38, speed: 155 * speedScale, r: 18, touch: 1, exp: 10, gold: 10, color: "#8dd9ff", drift: true, shape: "triangle", sides: 3 },
    { kind: "meteor_m", hp: 68, speed: 95 * speedScale, r: 30, touch: 2, exp: 14, gold: 14, color: "#f5b26e", shape: "square", sides: 4 },
    { kind: "dash", hp: 84, speed: 115 * speedScale, r: 16, touch: 1, exp: 12, gold: 11, color: "#abf7ff", dash: true, shape: "square", sides: 4 },
    { kind: "armor", hp: 120, speed: 90 * speedScale, r: 28, touch: 2, exp: 20, gold: 20, color: "#9fbdff", armor: 4, shape: "pentagon", sides: 5 },
  ];
  const elite = { kind: "elite", hp: 220, speed: 98 * speedScale, r: 26, touch: 3, exp: 46, gold: 56, color: "#ffd679", armor: 2, shape: "pentagon", sides: 5, elite: true };
  const boss = { kind: "boss", hp: 1200 + s.wave * 120, speed: 58 * speedScale, r: 66, touch: 5, exp: 180, gold: 220, color: "#ff5f89", shape: "pentagon", sides: 5 };
  let base;
  if (type === "boss") {
    base = boss;
    s.bossAlive = true;
  } else if (type === "elite") {
    base = elite;
  } else {
    base = pick(table);
  }
  const sizeScale = base.kind === "boss" ? 1 : rand(0.94, 1.08);
  s.enemies.push({
    ...base,
    hp: Math.floor(base.hp * hpScale),
    maxHp: Math.floor(base.hp * hpScale),
    x: rand(base.r + 18, WORLD_W - base.r - 18),
    y: -base.r * 1.4 - rand(20, 180),
    vx: rand(-11, 11),
    baseSpeed: base.speed * (1 + (s.wave - 1) * 0.03),
    dashMult: 1,
    dashUsed: false,
    driftSeed: rand(0, Math.PI * 2),
    rotation: rand(0, Math.PI * 2),
    spin: rand(-0.7, 0.7),
    status: createEnemyStatus(),
    deadHandled: false,
    r: base.r * sizeScale,
  });
}

function addDrop(s, x, y, type, value) {
  s.drops.push({
    x,
    y,
    type,
    value,
    vx: rand(-22, 22),
    vy: rand(80, 140),
    fallSpeed: rand(120, 180),
    r: type === "xp" ? 8 : 9,
    collecting: false,
  });
}

function triggerDropCollect(s, drop, x = drop.x, y = drop.y) {
  if (drop.collecting || drop.dead) return;
  drop.collecting = true;
  spawnRingEffect(s, x, y, "#ffe56f", 26, 120, 2);
  addBurst(s, x, y, 8, ["#ffe050"], 20, 90, 2, 5, 0.12, 0.26);
  playUiSfx("select");
}

function handleEnemyDeath(s, enemy) {
  const xpCount = Math.max(1, Math.floor(enemy.exp / 10));
  const goldCount = Math.max(1, Math.floor(enemy.gold / 10));
  for (let index = 0; index < xpCount; index += 1) addDrop(s, enemy.x, enemy.y, "xp", Math.max(1, Math.floor(enemy.exp / xpCount)));
  for (let index = 0; index < goldCount; index += 1) addDrop(s, enemy.x, enemy.y, "gold", Math.max(1, Math.floor(enemy.gold / goldCount)));
  addBurst(s, enemy.x, enemy.y, 14, [enemy.color, "#ffffff"], 30, 120, 2, 6, 0.18, 0.4);
  playExplosionSfx();
  if (enemy.kind === "boss") s.bossAlive = false;
  if (enemy.elite) enqueueModal(s, { type: "bullet", reason: "elite" });
}

function damageEnemy(s, enemy, rawDamage, options = {}) {
  if (enemy.deadHandled) return true;
  const reducedArmor = Math.max(0, (enemy.armor || 0) - (enemy.status.corrosionArmor || 0));
  const armor = options.ignoreArmor ? 0 : reducedArmor;
  const dealt = Math.max(1, rawDamage - armor);
  enemy.hp -= dealt;
  if (!options.silent) spawnTextEffect(s, enemy.x, enemy.y, `-${Math.floor(dealt)}`, options.color);
  if (enemy.hp <= 0 && !enemy.deadHandled) {
    enemy.deadHandled = true;
    handleEnemyDeath(s, enemy);
    return true;
  }
  return false;
}

function applyStatusEffectsFromBullet(s, bullet, enemy, scale = 1) {
  if (bullet.loadout.burn) {
    enemy.status.burnTimer = Math.max(enemy.status.burnTimer, 3.2);
    enemy.status.burnDps = Math.max(enemy.status.burnDps, bullet.damage * 0.22 * scale);
    spawnRingEffect(s, enemy.x, enemy.y, "#ff955c", 38 * scale, 170, 3);
    addBurst(s, enemy.x, enemy.y, 12, ["#ff8014", "#ffc850"], 40, 120, 3, 7, 0.18, 0.36, 180);
  }
  if (bullet.loadout.frost) {
    enemy.status.frostTimer = Math.max(enemy.status.frostTimer, 2.6);
    enemy.status.slowMul = Math.min(enemy.status.slowMul, 0.56);
    spawnRingEffect(s, enemy.x, enemy.y, "#8fdfff", 44 * scale, 180, 3);
    addBurst(s, enemy.x, enemy.y, 10, ["#b4f0ff", "#7fd8ff"], 30, 110, 2, 5, 0.18, 0.34);
  }
  if (bullet.loadout.corrosion) {
    enemy.status.corrosionTimer = Math.max(enemy.status.corrosionTimer, 4.2);
    enemy.status.corrosionArmor = Math.max(enemy.status.corrosionArmor, 6 * scale);
    enemy.status.corrosionDps = Math.max(enemy.status.corrosionDps, bullet.damage * 0.12 * scale);
    spawnRingEffect(s, enemy.x, enemy.y, "#9dff8f", 40 * scale, 190, 3);
    addBurst(s, enemy.x, enemy.y, 12, ["#5cff7c", "#9cff58"], 40, 130, 3, 7, 0.22, 0.46);
  }
}

function triggerGravityPulse(s, x, y, damage) {
  spawnRingEffect(s, x, y, "#a5b2ff", 110, 260, 5);
  s.effects.push({ kind: "flash", x, y, radius: 86, color: "#5a46ff", maxLife: 140, life: 140, alpha: 0.6 });
  s.enemies.forEach((enemy) => {
    if (enemy.hp <= 0) return;
    const dx = x - enemy.x;
    const dy = y - enemy.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0 || distance > 120) return;
    const pull = (1 - distance / 120) * 32;
    enemy.x += (dx / distance) * pull;
    enemy.y += (dy / distance) * pull;
    if (distance < 80) damageEnemy(s, enemy, damage * 0.22, { silent: true });
  });
}

function triggerBlast(s, bullet, x, y, primaryEnemy) {
  spawnRingEffect(s, x, y, "#ffb26d", 96, 220, 5);
  addBurst(s, x, y, 24, ["#ffa53c", "#ff7830"], 50, 260, 3, 8, 0.28, 0.6);
  playExplosionSfx();
  s.enemies.forEach((enemy) => {
    if (enemy === primaryEnemy || enemy.hp <= 0) return;
    const distance = Math.hypot(enemy.x - x, enemy.y - y);
    if (distance > 92) return;
    damageEnemy(s, enemy, bullet.damage * 0.48 * (1 - distance / 120), { color: "#ffd4a8" });
    applyStatusEffectsFromBullet(s, bullet, enemy, 0.55);
  });
}

function triggerArc(s, bullet, sourceEnemy) {
  playArcSfx();
  s.enemies
    .filter((enemy) => enemy !== sourceEnemy && enemy.hp > 0)
    .sort((a, b) => Math.hypot(a.x - sourceEnemy.x, a.y - sourceEnemy.y) - Math.hypot(b.x - sourceEnemy.x, b.y - sourceEnemy.y))
    .slice(0, 2)
    .forEach((enemy) => {
      const distance = Math.hypot(enemy.x - sourceEnemy.x, enemy.y - sourceEnemy.y);
      if (distance > 190) return;
      addLightning(s, sourceEnemy.x, sourceEnemy.y, enemy.x, enemy.y, "#b464ff");
      spawnChainEffect(s, sourceEnemy.x, sourceEnemy.y, enemy.x, enemy.y, "#b8a8ff");
      damageEnemy(s, enemy, bullet.damage * 0.42, { color: "#e0d4ff" });
      applyStatusEffectsFromBullet(s, bullet, enemy, 0.52);
    });
}

function applyBulletImpact(s, bullet, enemy) {
  applyStatusEffectsFromBullet(s, bullet, enemy, 1);
  if (bullet.loadout.blast) triggerBlast(s, bullet, enemy.x, enemy.y, enemy);
  if (bullet.loadout.arc) triggerArc(s, bullet, enemy);
  if (bullet.loadout.gravity) triggerGravityPulse(s, enemy.x, enemy.y, bullet.damage);
  if (bullet.splitLeft > 0) spawnSplitBullets(s, bullet);
}

function skillPulse(s) {
  if (s.skillCd > 0 || !s.running || s.paused) return;
  s.skillCd = 14;
  playUiSfx("skill");
  s.enemies.forEach((enemy) => {
    if (Math.hypot(enemy.x - s.turret.x, enemy.y - s.turret.y) < 430) damageEnemy(s, enemy, 140, { ignoreArmor: true, color: "#dff5ff" });
  });
  s.effects.push({ kind: "pulse", x: s.turret.x, y: s.turret.y - 40, maxLife: 500, life: 500, r: 0 });
}

function updateEnemyStatuses(dt, s) {
  s.enemies.forEach((enemy) => {
    const status = enemy.status;
    if (status.burnTimer > 0) {
      status.burnTimer = Math.max(0, status.burnTimer - dt);
      if (enemy.hp > 0) damageEnemy(s, enemy, status.burnDps * dt, { silent: true, ignoreArmor: true });
    }
    if (status.frostTimer > 0) status.frostTimer = Math.max(0, status.frostTimer - dt);
    else status.slowMul = 1;
    if (status.corrosionTimer > 0) {
      status.corrosionTimer = Math.max(0, status.corrosionTimer - dt);
      if (enemy.hp > 0) damageEnemy(s, enemy, status.corrosionDps * dt, { silent: true });
    } else {
      status.corrosionArmor = 0;
      status.corrosionDps = 0;
    }
  });
}
function update(dt, s) {
  if (!s.running) return;
  if (!s.paused) {
    s.elapsed += dt;
    s.waveTimer += dt * 1000;
    s.spawnTimer -= dt;
    s.eliteTimer -= dt;
    s.turret.cooldown -= dt;
    s.skillCd = Math.max(0, s.skillCd - dt);
    aimToMouse(s);
    updateEnemyStatuses(dt, s);

    const spawnGap = Math.max(0.24, 0.98 - s.wave * 0.035);
    if (s.spawnTimer <= 0) {
      spawnEnemy(s);
      s.spawnTimer = spawnGap;
    }
    if (s.wave >= 2 && s.eliteTimer <= 0 && !s.enemies.some((enemy) => enemy.elite)) {
      spawnEnemy(s, "elite");
      s.eliteTimer = Math.max(8.2, 12.5 - s.wave * 0.22);
    }
    if (s.waveTimer >= WAVE_MS) {
      s.wave += 1;
      s.waveTimer = 0;
      s.shopReady = true;
      if (s.wave % 5 === 0 && !s.bossAlive) spawnEnemy(s, "boss");
    }

    if (s.turret.firing && s.turret.cooldown <= 0) {
      const count = s.stats.shots;
      const volleyLoadout = buildBulletLoadout(s);
      for (let index = 0; index < count; index += 1) {
        const spread = count === 1 ? 0 : ((index / (count - 1)) - 0.5) * 0.22;
        spawnBullet(s, spread, { loadout: volleyLoadout });
      }
      playShootSfx(volleyLoadout, count);
      s.turret.cooldown = 1 / (s.stats.fireRate * volleyLoadout.fireRateMul);
    }

    s.enemies.forEach((enemy) => {
      if (enemy.hp <= 0) return;
      const slowMul = enemy.status.frostTimer > 0 ? enemy.status.slowMul : 1;
      if (enemy.drift) enemy.x += Math.sin(s.elapsed * 1.8 + enemy.driftSeed + enemy.y * 0.008) * 14 * dt;
      if (enemy.dash && !enemy.dashUsed && enemy.y > WORLD_H * 0.44) {
        enemy.dashMult = 1.6;
        enemy.dashUsed = true;
        spawnRingEffect(s, enemy.x, enemy.y, "#bafcff", 28, 140, 2);
      }
      enemy.x += enemy.vx * slowMul * dt;
      enemy.y += enemy.baseSpeed * enemy.dashMult * slowMul * dt;
      enemy.rotation += enemy.spin * dt;
      if (enemy.x < enemy.r || enemy.x > WORLD_W - enemy.r) enemy.vx *= -1;
      if (enemy.y > WORLD_H + enemy.r) {
        s.baseHp -= enemy.touch;
        enemy.hp = -1;
        enemy.deadHandled = true;
      }
    });

    s.bullets.forEach((bullet) => {
      if (bullet.dead) return;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      emitBulletAmbientEffects(s, bullet);
      if (bullet.x <= bullet.radius || bullet.x >= WORLD_W - bullet.radius) {
        bullet.vx *= -1;
        spawnRingEffect(s, bullet.x, bullet.y, bullet.loadout.trailColor, 20, 100, 2);
      }
      if (bullet.y <= bullet.radius) {
        bullet.vy *= -1;
        spawnRingEffect(s, bullet.x, bullet.y, bullet.loadout.trailColor, 20, 100, 2);
      }
      if (bullet.y > WORLD_H + 24) bullet.dead = true;

      for (const enemy of s.enemies) {
        if (enemy.hp <= 0) continue;
        const hitDist = enemy.r + bullet.radius;
        const dx = enemy.x - bullet.x;
        const dy = enemy.y - bullet.y;
        if (dx * dx + dy * dy > hitDist * hitDist) continue;
        const crit = Math.random() < s.stats.crit ? s.stats.critMul : 1;
        playImpactSfx(bullet.loadout, crit > 1 || bullet.loadout.gravity);
        damageEnemy(s, enemy, bullet.damage * (1 + bullet.rage) * crit, { color: crit > 1 ? "#ffd880" : "#ffe7b1" });
        applyBulletImpact(s, bullet, enemy);
        const normalLen = Math.hypot(dx, dy) || 1;
        const nx = dx / normalLen;
        const ny = dy / normalLen;
        const dot = bullet.vx * nx + bullet.vy * ny;
        bullet.vx -= 2 * dot * nx;
        bullet.vy -= 2 * dot * ny;
        if (!bullet.infiniteBounce) bullet.leftBounce -= 1;
        if (bullet.leftPierce > 0) {
          bullet.leftPierce -= 1;
          continue;
        }
        break;
      }

      if (bullet.loadout.absorb) {
        for (const drop of s.drops) {
          if (drop.dead || drop.collecting) continue;
          const hitDist = bullet.radius + drop.r + 4;
          const dx = drop.x - bullet.x;
          const dy = drop.y - bullet.y;
          if (dx * dx + dy * dy > hitDist * hitDist) continue;
          triggerDropCollect(s, drop, drop.x, drop.y);
        }
      }
    });

    const pickupRange = getPickupRange(s);
    s.drops.forEach((drop) => {
      if (drop.collecting) {
        const dx = s.turret.x - drop.x;
        const dy = s.turret.y - drop.y;
        const distance = Math.hypot(dx, dy);
        const pull = 1200 + (1 - clamp(distance / WORLD_H, 0, 1)) * 800;
        drop.vx += (dx / (distance || 1)) * pull * dt;
        drop.vy += (dy / (distance || 1)) * pull * dt;
        drop.x += drop.vx * dt;
        drop.y += drop.vy * dt;
        drop.vx *= 0.98;
        drop.vy *= 0.98;
        if (distance < 20) {
          if (drop.type === "xp") s.exp += drop.value * s.stats.xpRate;
          else s.gold += drop.value * s.stats.goldRate;
          drop.dead = true;
        }
        return;
      }

      drop.vy = Math.min(drop.fallSpeed, drop.vy + 220 * dt);
      drop.y += drop.vy * dt;
      drop.x += drop.vx * dt;
      drop.vx *= 0.985;
      const dx = s.turret.x - drop.x;
      const dy = s.turret.y - drop.y;
      const distance = Math.hypot(dx, dy);
      if (distance < pickupRange) {
        const pull = 620 + (1 - distance / Math.max(1, pickupRange)) * 780;
        drop.vx += (dx / (distance || 1)) * pull * dt;
        drop.vy += (dy / (distance || 1)) * pull * dt;
      }
      if (distance < 20) {
        if (drop.type === "xp") s.exp += drop.value * s.stats.xpRate;
        else s.gold += drop.value * s.stats.goldRate;
        drop.dead = true;
      }
    });

    s.effects.forEach((effect) => {
      effect.life -= dt * 1000;
      if (effect.kind === "pulse") effect.r += dt * 600;
      if (effect.kind === "particle") {
        effect.x += effect.vx * dt;
        effect.y += effect.vy * dt;
        effect.vx *= effect.drag;
        effect.vy *= effect.drag;
        effect.radius *= effect.shrink;
        if (effect.gravity) effect.vy += effect.gravity * dt;
      }
    });

    s.enemies = s.enemies.filter((enemy) => enemy.hp > 0);
    s.bullets = s.bullets.filter((bullet) => !bullet.dead && (bullet.infiniteBounce || bullet.leftBounce >= 0));
    s.drops = s.drops.filter((drop) => !drop.dead && drop.y < WORLD_H + 40);
    s.effects = s.effects.filter((effect) => effect.life > 0 && (effect.kind !== "particle" || effect.radius >= 0.25));

    while (s.exp >= s.expNeed) {
      s.exp -= s.expNeed;
      s.level += 1;
      s.expNeed = levelCurve(s.level);
      enqueueModal(s, { type: "level" });
    }

    if (s.baseHp <= 0) {
      s.running = false;
      s.paused = true;
      s.activeModal = "result";
      ui.resultTitle.textContent = "基地被摧毁";
      ui.resultText.textContent = `你守到了第 ${s.wave} 波。优先成型 2 到 3 种子弹特性会比单纯堆数值更稳。`;
      ui.resultModal.classList.remove("hidden");
    }
  }
  openNextModal(s);
}

function drawPolygon(context, x, y, radius, sides, stretchY = 1, rotation = 0) {
  context.beginPath();
  for (let index = 0; index < sides; index += 1) {
    const angle = rotation + (Math.PI * 2 * index) / sides - Math.PI / 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius * stretchY;
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
}

function drawEnemyShape(context, enemy) {
  switch (enemy.shape) {
    case "triangle":
      drawPolygon(context, enemy.x, enemy.y, enemy.r * 0.96, 3, 1, enemy.rotation);
      break;
    case "square":
      drawPolygon(context, enemy.x, enemy.y, enemy.r * 0.92, 4, 1, enemy.rotation + Math.PI / 4);
      break;
    case "pentagon":
      drawPolygon(context, enemy.x, enemy.y, enemy.r * (enemy.kind === "boss" ? 1 : 0.96), 5, 1, enemy.rotation);
      break;
    default:
      drawPolygon(context, enemy.x, enemy.y, enemy.r * 0.96, enemy.sides || 4, 1, enemy.rotation);
      break;
  }
}

function drawBulletTrail(context, bullet) {
  const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
  const ux = bullet.vx / speed;
  const uy = bullet.vy / speed;
  const length = 36 + speed * 0.02 + (bullet.loadout.rapid ? 26 : 0) + (bullet.loadout.gravity ? 18 : 0);
  const tailX = bullet.x - ux * length;
  const tailY = bullet.y - uy * length;
  const nx = -uy;
  const ny = ux;
  const headWidth = bullet.radius * (bullet.loadout.gravity ? 1.7 : 1.35);
  const midWidth = headWidth * 0.42;
  const headLeftX = bullet.x + nx * headWidth;
  const headLeftY = bullet.y + ny * headWidth;
  const headRightX = bullet.x - nx * headWidth;
  const headRightY = bullet.y - ny * headWidth;
  const midX = bullet.x - ux * length * 0.26;
  const midY = bullet.y - uy * length * 0.26;
  const midLeftX = midX + nx * midWidth;
  const midLeftY = midY + ny * midWidth;
  const midRightX = midX - nx * midWidth;
  const midRightY = midY - ny * midWidth;

  context.save();
  context.globalCompositeOperation = "screen";

  const outer = context.createLinearGradient(bullet.x, bullet.y, tailX, tailY);
  outer.addColorStop(0, rgba(bullet.loadout.trailColor, 0.9));
  outer.addColorStop(0.32, rgba(bullet.loadout.trailColor, 0.42));
  outer.addColorStop(1, rgba(bullet.loadout.trailColor, 0));
  context.beginPath();
  context.moveTo(headLeftX, headLeftY);
  context.lineTo(midLeftX, midLeftY);
  context.lineTo(tailX, tailY);
  context.lineTo(midRightX, midRightY);
  context.lineTo(headRightX, headRightY);
  context.closePath();
  context.fillStyle = outer;
  context.shadowColor = rgba(bullet.loadout.glowColor, 0.6);
  context.shadowBlur = bullet.radius * 2.6;
  context.fill();

  const inner = context.createLinearGradient(bullet.x, bullet.y, tailX, tailY);
  inner.addColorStop(0, rgba("#ffffff", 0.95));
  inner.addColorStop(0.22, rgba("#ffffff", 0.45));
  inner.addColorStop(1, rgba("#ffffff", 0));
  context.beginPath();
  context.moveTo(bullet.x + nx * headWidth * 0.34, bullet.y + ny * headWidth * 0.34);
  context.lineTo(midX + nx * midWidth * 0.18, midY + ny * midWidth * 0.18);
  context.lineTo(tailX, tailY);
  context.lineTo(midX - nx * midWidth * 0.18, midY - ny * midWidth * 0.18);
  context.lineTo(bullet.x - nx * headWidth * 0.34, bullet.y - ny * headWidth * 0.34);
  context.closePath();
  context.fillStyle = inner;
  context.shadowBlur = 0;
  context.fill();

  if (bullet.loadout.rapid || bullet.loadout.split) {
    context.beginPath();
    context.moveTo(headLeftX, headLeftY);
    context.lineTo(tailX, tailY);
    context.lineTo(headRightX, headRightY);
    context.strokeStyle = rgba(bullet.loadout.trailColor, 0.28);
    context.lineWidth = Math.max(1, bullet.radius * 0.24);
    context.stroke();
  }

  context.restore();
}

function drawBulletBody(context, bullet) {
  const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
  const ux = bullet.vx / speed;
  const uy = bullet.vy / speed;
  const angle = Math.atan2(uy, ux);
  const ids = bullet.loadout.ids || [];

  context.save();
  context.globalCompositeOperation = "screen";

  glowCircle(context, bullet.x, bullet.y, bullet.radius * 2.4, bullet.loadout.glowColor, bullet.loadout.gravity ? 0.34 : 0.24);

  context.translate(bullet.x, bullet.y);
  context.rotate(angle);

  if (ids.includes("rapid")) {
    const gradient = context.createLinearGradient(-bullet.radius * 2.3, 0, bullet.radius * 2.3, 0);
    gradient.addColorStop(0, rgba("#78beff", 0));
    gradient.addColorStop(0.5, rgba("#dcf5ff", 1));
    gradient.addColorStop(1, rgba("#78beff", 0));
    context.fillStyle = gradient;
    context.fillRect(-bullet.radius * 2.3, -bullet.radius * 0.28, bullet.radius * 4.6, bullet.radius * 0.56);
  }

  if (ids.includes("blast")) {
    context.fillStyle = "#2b1a12";
    context.beginPath();
    context.arc(0, 0, bullet.radius * 0.78, 0, Math.PI * 2);
    context.fill();
  }

  if (ids.includes("burn")) {
    context.fillStyle = "#ffd07a";
    context.beginPath();
    context.arc(0, 0, bullet.radius * 0.7, 0, Math.PI * 2);
    context.fill();
  }

  if (ids.includes("frost")) {
    context.fillStyle = "#d9f4ff";
    context.beginPath();
    context.arc(0, 0, bullet.radius * 0.76, 0, Math.PI * 2);
    context.fill();
  }

  if (ids.includes("arc")) {
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(0, 0, bullet.radius * 0.62, 0, Math.PI * 2);
    context.fill();
  }

  if (ids.includes("corrosion")) {
    context.fillStyle = "#d8ff7d";
    context.beginPath();
    context.arc(0, 0, bullet.radius * 0.66, 0, Math.PI * 2);
    context.fill();
  }

  if (ids.includes("absorb")) {
    context.fillStyle = "#fff2a2";
    context.beginPath();
    context.arc(0, 0, bullet.radius * 0.65, 0, Math.PI * 2);
    context.fill();
  }

  if (ids.includes("split")) {
    context.fillStyle = "#ffd5f3";
    context.beginPath();
    context.arc(0, 0, bullet.radius * 0.63, 0, Math.PI * 2);
    context.fill();
  }

  if (ids.includes("gravity")) {
    context.fillStyle = "#dad3ff";
    context.beginPath();
    context.arc(0, 0, bullet.radius * 0.92, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(134,118,255,0.95)";
    context.lineWidth = Math.max(2, bullet.radius * 0.22);
    context.beginPath();
    context.arc(0, 0, bullet.radius * 1.26, 0, Math.PI * 2);
    context.stroke();
  }

  if (ids.includes("ricochet")) {
    context.fillStyle = "#d8fff8";
    context.beginPath();
    context.arc(0, 0, bullet.radius * 0.65, 0, Math.PI * 2);
    context.fill();
  }

  if (!ids.length) {
    context.fillStyle = rgba(bullet.loadout.coreColor, 0.95);
    context.beginPath();
    context.arc(0, 0, bullet.radius * 0.8, 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = rgba("#ffffff", 0.34);
  context.beginPath();
  context.ellipse(-bullet.radius * 0.3, -bullet.radius * 0.18, bullet.radius * 0.4, bullet.radius * 0.16, 0.2, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

function drawDemoBulletLayers(context, bullet, time) {
  const ids = bullet.loadout.ids || [];
  const angle = Math.atan2(bullet.vy, bullet.vx);
  const scale = bullet.radius / 10;

  if (!ids.length) {
    glowCircle(context, bullet.x, bullet.y, bullet.radius * 1.8, bullet.loadout.glowColor, 0.22);
    context.fillStyle = "#dff4ff";
    context.beginPath();
    context.arc(bullet.x, bullet.y, bullet.radius * 0.58, 0, Math.PI * 2);
    context.fill();
    return;
  }

  if (ids.includes("blast")) {
    glowCircle(context, bullet.x, bullet.y, 24 * scale, "#ff8032", 0.45);
    context.save();
    context.translate(bullet.x, bullet.y);
    context.rotate(angle);
    context.fillStyle = "#2b1a12";
    context.beginPath();
    context.arc(0, 0, 8 * scale, 0, Math.PI * 2);
    context.fill();
    for (let index = 0; index < 4; index += 1) {
      context.strokeStyle = "rgba(255,155,70,0.9)";
      context.lineWidth = 1.4 * scale;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(Math.cos(index * 1.4) * 7 * scale, Math.sin(index * 1.4) * 7 * scale);
      context.stroke();
    }
    context.restore();
  }

  if (ids.includes("burn")) {
    glowCircle(context, bullet.x, bullet.y, 28 * scale, "#ff6e1e", 0.35);
    context.fillStyle = "#ffd07a";
    context.beginPath();
    context.arc(bullet.x, bullet.y, 7 * scale, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(255,72,20,0.9)";
    context.lineWidth = 2 * scale;
    context.beginPath();
    context.arc(bullet.x, bullet.y, 10 * scale, 0, Math.PI * 2);
    context.stroke();
  }

  if (ids.includes("frost")) {
    glowCircle(context, bullet.x, bullet.y, 24 * scale, "#78dcff", 0.25);
    context.fillStyle = "#d9f4ff";
    context.beginPath();
    context.arc(bullet.x, bullet.y, 7.5 * scale, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(80,180,255,0.95)";
    context.lineWidth = 2.4 * scale;
    context.beginPath();
    context.arc(bullet.x, bullet.y, 10 * scale, 0, Math.PI * 2);
    context.stroke();
  }

  if (ids.includes("arc")) {
    glowCircle(context, bullet.x, bullet.y, 20 * scale, "#be6eff", 0.3);
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(bullet.x, bullet.y, 6.2 * scale, 0, Math.PI * 2);
    context.fill();
    for (let index = 0; index < 3; index += 1) {
      const a = time * 9 + index * 2.09;
      lineGlow(
        context,
        bullet.x,
        bullet.y,
        bullet.x + Math.cos(a) * 14 * scale,
        bullet.y + Math.sin(a) * 14 * scale,
        1.2 * scale,
        "#ba72ff",
        0.8,
      );
    }
  }

  if (ids.includes("corrosion")) {
    glowCircle(context, bullet.x, bullet.y, 26 * scale, "#5aff78", 0.2);
    context.fillStyle = "#d8ff7d";
    context.beginPath();
    context.arc(bullet.x, bullet.y, 6.6 * scale, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(88,240,116,0.95)";
    context.lineWidth = 2 * scale;
    context.beginPath();
    context.arc(bullet.x, bullet.y, 10.5 * scale, 0, Math.PI * 2);
    context.stroke();
  }

  if (ids.includes("absorb")) {
    glowCircle(context, bullet.x, bullet.y, 30 * scale, "#ffd75a", 0.24);
    ring(context, bullet.x, bullet.y, (14 + Math.sin(time * 8) * 2) * scale, 2 * scale, "#ffdc5a", 0.75);
    context.fillStyle = "#fff2a2";
    context.beginPath();
    context.arc(bullet.x, bullet.y, 6.5 * scale, 0, Math.PI * 2);
    context.fill();
  }

  if (ids.includes("split")) {
    glowCircle(context, bullet.x, bullet.y, 20 * scale, "#ff78dc", 0.22);
    context.fillStyle = "#ffd5f3";
    context.beginPath();
    context.arc(bullet.x, bullet.y, 6.3 * scale, 0, Math.PI * 2);
    context.fill();
  }

  if (ids.includes("rapid")) {
    context.save();
    context.translate(bullet.x, bullet.y);
    context.rotate(angle);
    const gradient = context.createLinearGradient(-18 * scale, 0, 18 * scale, 0);
    gradient.addColorStop(0, "rgba(120,190,255,0)");
    gradient.addColorStop(0.5, "rgba(220,245,255,1)");
    gradient.addColorStop(1, "rgba(120,190,255,0)");
    context.fillStyle = gradient;
    context.fillRect(-18 * scale, -2 * scale, 36 * scale, 4 * scale);
    context.restore();
  }

  if (ids.includes("gravity")) {
    glowCircle(context, bullet.x, bullet.y, 32 * scale, "#6e64ff", 0.28);
    context.fillStyle = "#dad3ff";
    context.beginPath();
    context.arc(bullet.x, bullet.y, 10 * scale, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(134,118,255,0.95)";
    context.lineWidth = 3 * scale;
    context.beginPath();
    context.arc(bullet.x, bullet.y, 14 * scale, 0, Math.PI * 2);
    context.stroke();
  }

  if (ids.includes("ricochet")) {
    glowCircle(context, bullet.x, bullet.y, 20 * scale, "#46ffdC", 0.22);
    context.fillStyle = "#d8fff8";
    context.beginPath();
    context.arc(bullet.x, bullet.y, 6.5 * scale, 0, Math.PI * 2);
    context.fill();
  }
}

function render(s) {
  ctx.clearRect(0, 0, WORLD_W, WORLD_H);
  const gradient = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  gradient.addColorStop(0, "#0a1430");
  gradient.addColorStop(1, "#09111d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let y = 40; y < WORLD_H; y += 80) ctx.fillRect(0, y, WORLD_W, 1);
  ctx.fillStyle = "#2a3f70";
  ctx.fillRect(0, BASE_Y + 40, WORLD_W, WORLD_H - BASE_Y);

  const pickupRange = getPickupRange(s);
  ctx.beginPath();
  ctx.arc(s.turret.x, s.turret.y, pickupRange, 0, Math.PI * 2);
  ctx.strokeStyle = rgba("#86d8ff", 0.08);
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  ctx.translate(s.turret.x, s.turret.y);
  ctx.rotate(s.turret.angle + Math.PI / 2);
  ctx.fillStyle = "#f7c67a";
  ctx.fillRect(-12, -36, 24, 52);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(s.turret.x, s.turret.y, 26, 0, Math.PI * 2);
  ctx.fillStyle = "#88ccff";
  ctx.fill();

  s.bullets.forEach((bullet) => {
    drawDemoBulletLayers(ctx, bullet, s.elapsed);
  });

  s.enemies.forEach((enemy) => {
    drawEnemyShape(ctx, enemy);
    ctx.fillStyle = enemy.color;
    ctx.fill();
    if (enemy.elite) {
      drawEnemyShape(ctx, enemy);
      ctx.strokeStyle = rgba("#ffd679", 0.82);
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (enemy.status.burnTimer > 0) {
      drawEnemyShape(ctx, enemy);
      ctx.strokeStyle = rgba("#ff8f5e", 0.55);
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    if (enemy.status.frostTimer > 0) {
      drawEnemyShape(ctx, enemy);
      ctx.strokeStyle = rgba("#9fe4ff", 0.75);
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    if (enemy.status.corrosionTimer > 0) {
      drawEnemyShape(ctx, enemy);
      ctx.strokeStyle = rgba("#9fff9a", 0.75);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const barWidth = enemy.r * 1.6;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(enemy.x - barWidth / 2, enemy.y - enemy.r - 18, barWidth, 6);
    ctx.fillStyle = enemy.elite ? "#ffe17f" : "#76f5ff";
    ctx.fillRect(enemy.x - barWidth / 2, enemy.y - enemy.r - 18, barWidth * clamp(enemy.hp / enemy.maxHp, 0, 1), 6);
  });

  s.drops.forEach((drop) => {
    ctx.beginPath();
    ctx.arc(drop.x, drop.y, drop.r, 0, Math.PI * 2);
    ctx.fillStyle = drop.type === "xp" ? "#76f6c8" : "#ffd871";
    ctx.fill();
    if (drop.collecting) {
      ctx.beginPath();
      ctx.arc(drop.x, drop.y, drop.r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = rgba("#ffe56f", 0.7);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });

  s.effects.forEach((effect) => {
    if (effect.kind === "ghost") {
      const alpha = clamp(effect.life / effect.maxLife, 0, 1) * effect.alpha;
      ctx.save();
      ctx.translate(effect.x, effect.y);
      ctx.rotate(effect.angle);
      const gradient = ctx.createLinearGradient(-effect.length / 2, 0, effect.length / 2, 0);
      gradient.addColorStop(0, rgba(effect.color, 0));
      gradient.addColorStop(0.5, rgba(effect.color, alpha));
      gradient.addColorStop(1, rgba(effect.color, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(-effect.length / 2, -effect.width / 2, effect.length, effect.width);
      ctx.restore();
      return;
    }

    if (effect.kind === "particle") {
      const alpha = clamp(effect.life / effect.maxLife, 0, 1) * effect.alpha;
      glowCircle(ctx, effect.x, effect.y, Math.max(0.5, effect.radius), effect.color, alpha);
      return;
    }

    if (effect.kind === "spark") {
      const alpha = clamp(effect.life / effect.maxLife, 0, 1);
      ctx.strokeStyle = rgba(effect.color, alpha);
      ctx.lineWidth = effect.width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(effect.points[0].x, effect.points[0].y);
      for (let index = 1; index < effect.points.length; index += 1) {
        ctx.lineTo(effect.points[index].x, effect.points[index].y);
      }
      ctx.stroke();
      return;
    }

    if (effect.kind === "flash") {
      glowCircle(ctx, effect.x, effect.y, effect.radius, effect.color, clamp(effect.life / effect.maxLife, 0, 1) * effect.alpha);
      return;
    }

    if (effect.kind === "pulse") {
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(120,220,255,${clamp(1 - effect.r / 430, 0, 1)})`;
      ctx.lineWidth = 5;
      ctx.stroke();
      return;
    }
    if (effect.kind === "text") {
      ctx.fillStyle = rgba(effect.color, clamp(effect.life / effect.maxLife, 0, 1));
      ctx.fillText(effect.text, effect.x, effect.y - (1 - effect.life / effect.maxLife) * 18);
      return;
    }
    if (effect.kind === "ring") {
      const progress = 1 - effect.life / effect.maxLife;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.maxRadius * progress, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(effect.color, clamp(1 - progress, 0, 1) * 0.9);
      ctx.lineWidth = effect.lineWidth;
      ctx.stroke();
      return;
    }
    if (effect.kind === "chain") {
      const alpha = clamp(effect.life / effect.maxLife, 0, 1) * 0.9;
      ctx.beginPath();
      ctx.moveTo(effect.fromX, effect.fromY);
      ctx.lineTo((effect.fromX + effect.toX) / 2, (effect.fromY + effect.toY) / 2 + rand(-8, 8));
      ctx.lineTo(effect.toX, effect.toY);
      ctx.strokeStyle = rgba(effect.color, alpha);
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  });

  if (!s.turret.firing && !s.paused) {
    ctx.fillStyle = "rgba(220,238,255,0.85)";
    ctx.font = "24px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("按住左键持续开火", WORLD_W / 2, BASE_Y - 120);
    ctx.textAlign = "start";
  }
}

function drawBulletEnhancements(context, bullet, time) {
  context.save();
  context.translate(bullet.x, bullet.y);
  context.globalCompositeOperation = "screen";

  const shellRadius = bullet.radius * 1.02;

  if (bullet.loadout.blast) {
    context.save();
    context.beginPath();
    context.arc(0, 0, shellRadius, 0, Math.PI * 2);
    context.clip();
    context.strokeStyle = rgba("#ff7b2f", 0.95);
    context.lineWidth = 1.8;
    for (let index = 0; index < 5; index += 1) {
      const angle = time * 0.42 + index * 1.17;
      context.beginPath();
      context.moveTo(Math.cos(angle) * bullet.radius * 0.08, Math.sin(angle) * bullet.radius * 0.08);
      context.lineTo(Math.cos(angle + 0.12) * bullet.radius * 0.34, Math.sin(angle + 0.12) * bullet.radius * 0.34);
      context.lineTo(Math.cos(angle - 0.09) * bullet.radius * 0.72, Math.sin(angle - 0.09) * bullet.radius * 0.72);
      context.lineTo(Math.cos(angle + 0.05) * bullet.radius * 0.96, Math.sin(angle + 0.05) * bullet.radius * 0.96);
      context.stroke();
    }
    context.restore();
  }

  if (bullet.loadout.burn) {
    context.strokeStyle = rgba("#ff944f", 0.72);
    context.lineWidth = 2.8;
    context.beginPath();
    context.arc(0, 0, bullet.radius + 3 + Math.sin(time * 11) * 1.3, 0, Math.PI * 2);
    context.stroke();
    for (let index = 0; index < 4; index += 1) {
      const angle = time * 4.8 + index * 1.57;
      const distance = bullet.radius + 4 + Math.sin(time * 7 + index) * 1.8;
      context.beginPath();
      context.ellipse(
        Math.cos(angle) * distance,
        Math.sin(angle) * distance,
        3.6,
        1.7,
        angle,
        0,
        Math.PI * 2,
      );
      context.fillStyle = rgba(index % 2 === 0 ? "#ffb36c" : "#ffd3a1", 0.5);
      context.fill();
    }
  }

  if (bullet.loadout.frost) {
    context.strokeStyle = rgba("#d8f8ff", 0.9);
    context.lineWidth = 2;
    context.beginPath();
    context.arc(0, 0, bullet.radius + 3, 0, Math.PI * 2);
    context.stroke();
    for (let index = 0; index < 6; index += 1) {
      const angle = index * (Math.PI / 3) + time * 0.35;
      context.beginPath();
      context.moveTo(Math.cos(angle) * (bullet.radius + 0.8), Math.sin(angle) * (bullet.radius + 0.8));
      context.lineTo(Math.cos(angle) * (bullet.radius + 5.8), Math.sin(angle) * (bullet.radius + 5.8));
      context.moveTo(Math.cos(angle) * (bullet.radius + 3.3), Math.sin(angle) * (bullet.radius + 3.3));
      context.lineTo(Math.cos(angle + 0.22) * (bullet.radius + 5.2), Math.sin(angle + 0.22) * (bullet.radius + 5.2));
      context.moveTo(Math.cos(angle) * (bullet.radius + 3.3), Math.sin(angle) * (bullet.radius + 3.3));
      context.lineTo(Math.cos(angle - 0.22) * (bullet.radius + 5.2), Math.sin(angle - 0.22) * (bullet.radius + 5.2));
      context.stroke();
    }
  }

  if (bullet.loadout.arc) {
    context.strokeStyle = rgba("#d6c7ff", 0.95);
    context.lineWidth = 1.7;
    for (let index = 0; index < 3; index += 1) {
      const base = time * 6.5 + index * 2.09;
      context.beginPath();
      context.moveTo(Math.cos(base) * (bullet.radius + 1.4), Math.sin(base) * (bullet.radius + 1.4));
      context.lineTo(Math.cos(base + 0.14) * (bullet.radius + 4.6), Math.sin(base - 0.12) * (bullet.radius + 3.5));
      context.lineTo(Math.cos(base - 0.18) * (bullet.radius + 7.4), Math.sin(base + 0.15) * (bullet.radius + 5.4));
      context.lineTo(Math.cos(base + 0.08) * (bullet.radius + 9.2), Math.sin(base - 0.08) * (bullet.radius + 6.5));
      context.stroke();
    }
  }

  if (bullet.loadout.corrosion) {
    for (let index = 0; index < 5; index += 1) {
      const angle = time * 1.8 + index * 2.09;
      const distance = bullet.radius + 4 + Math.sin(time * 4 + index) * 1.8;
      context.beginPath();
      context.arc(Math.cos(angle) * distance, Math.sin(angle) * distance, 2.6 + (index % 2) * 0.7, 0, Math.PI * 2);
      context.fillStyle = rgba(index % 2 === 0 ? "#9dff9a" : "#d7ffc1", 0.26);
      context.fill();
    }
    context.beginPath();
    context.arc(0, 0, bullet.radius + 2.4, 0, Math.PI * 2);
    context.strokeStyle = rgba("#9aff88", 0.35);
    context.lineWidth = 2.4;
    context.stroke();
  }

  if (bullet.loadout.absorb) {
    context.strokeStyle = rgba("#ffe993", 0.8);
    context.lineWidth = 1.8;
    for (let index = 0; index < 3; index += 1) {
      const angle = time * 2.2 + index * 2.09;
      const orbit = bullet.radius + 5.2;
      context.beginPath();
      context.arc(Math.cos(angle) * orbit, Math.sin(angle) * orbit, 1.8, 0, Math.PI * 2);
      context.fillStyle = rgba("#ffe993", 0.72);
      context.fill();
    }
    context.beginPath();
    context.arc(0, 0, bullet.radius + 4.2, time * 1.1, time * 1.1 + Math.PI * 1.25);
    context.stroke();
  }

  if (bullet.loadout.split) {
    for (let index = 0; index < 2; index += 1) {
      const side = index === 0 ? -1 : 1;
      context.beginPath();
      context.arc(side * bullet.radius * 1.05, 0, bullet.radius * 0.38, 0, Math.PI * 2);
      context.fillStyle = rgba("#ffd4e6", 0.28);
      context.fill();
    }
  }

  if (bullet.loadout.rapid) {
    context.beginPath();
    context.ellipse(0, 0, bullet.radius * 1.55, bullet.radius * 0.42, Math.atan2(bullet.vy, bullet.vx), 0, Math.PI * 2);
    context.strokeStyle = rgba("#fff0a8", 0.55);
    context.lineWidth = 1.6;
    context.stroke();
  }

  if (bullet.loadout.gravity) {
    context.beginPath();
    context.arc(0, 0, bullet.radius + 6, 0, Math.PI * 2);
    context.strokeStyle = rgba("#8895ff", 0.55);
    context.lineWidth = 3;
    context.stroke();
    context.beginPath();
    context.arc(0, 0, bullet.radius * 0.5, 0, Math.PI * 2);
    context.fillStyle = rgba("#070a16", 0.45);
    context.fill();
  }

  if (bullet.loadout.infiniteBounce) {
    context.beginPath();
    context.arc(0, 0, bullet.radius + 5, 0, Math.PI * 2);
    context.strokeStyle = rgba("#c8fff1", 0.75);
    context.lineWidth = 1.7;
    context.setLineDash([5, 4]);
    context.lineDashOffset = -time * 28;
    context.stroke();
    context.setLineDash([]);
  }

  context.restore();
}

function syncHud(s) {
  ui.wave.textContent = `波次 ${s.wave}`;
  ui.hp.textContent = `基地 ${Math.max(0, Math.ceil(s.baseHp))}/${s.maxBaseHp}`;
  ui.gold.textContent = `金币 ${Math.floor(s.gold)}`;
  ui.level.textContent = `Lv${s.level}  EXP ${Math.floor(s.exp)}/${s.expNeed}`;
  ui.ammo.textContent = s.bulletTypes.length ? `弹药 ${s.bulletTypes.map((id) => bulletTypeMap[id].title).join(" + ")}` : "子弹 未选择";
  ui.openShop.disabled = !s.shopReady || s.paused || !s.running;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / WORLD_W, rect.height / WORLD_H);
  const x = (rect.width - WORLD_W * scale) / 2;
  const y = (rect.height - WORLD_H * scale) / 2;
  state.layout = { rect, scale, x, y };
}

function screenToWorld(clientX, clientY) {
  const { rect, scale, x, y } = state.layout;
  return { x: clamp((clientX - rect.left - x) / scale, 0, WORLD_W), y: clamp((clientY - rect.top - y) / scale, 0, WORLD_H) };
}

let last = 0;
function loop(timestamp) {
  const dt = Math.min(0.033, (timestamp - last) / 1000 || 0.016);
  last = timestamp;
  update(dt, state);
  render(state);
  syncHud(state);
  requestAnimationFrame(loop);
}
function bindEvents() {
  const onPointer = (event) => {
    state.mouse = screenToWorld(event.clientX, event.clientY);
    state.turret.firing = (event.buttons & 1) === 1;
  };
  const stopFiring = (event) => {
    if (event?.pointerId !== undefined && canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    state.turret.firing = false;
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    primeAudio();
    onPointer(event);
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointermove", onPointer);
  canvas.addEventListener("pointerup", stopFiring);
  canvas.addEventListener("pointercancel", stopFiring);
  canvas.addEventListener("lostpointercapture", () => { state.turret.firing = false; });
  canvas.addEventListener("pointerleave", (event) => { if ((event.buttons & 1) === 0) state.turret.firing = false; });
  window.addEventListener("keydown", (event) => {
    primeAudio();
    if (event.code === "KeyQ" || event.code === "KeyE") state.turret.mode = state.turret.mode === "normal" ? "pierce" : "normal";
    if (event.code === "Space") { event.preventDefault(); skillPulse(state); }
  });
  ui.restart.addEventListener("click", resetGame);
  ui.resultRestart.addEventListener("click", resetGame);
  ui.openShop.addEventListener("click", () => {
    primeAudio();
    if (!state.shopReady || state.paused || !state.running) return;
    showShop(state);
  });
  ui.skipShop.addEventListener("click", () => {
    playUiSfx("select");
    ui.shopModal.classList.add("hidden");
    state.shopReady = false;
    closeActiveModal(state);
  });
  window.addEventListener("resize", resizeCanvas);
}

function resetGame() {
  state = createState();
  ui.resultModal.classList.add("hidden");
  ui.bulletModal.classList.add("hidden");
  ui.levelModal.classList.add("hidden");
  ui.shopModal.classList.add("hidden");
  resizeCanvas();
  syncHud(state);
  enqueueModal(state, { type: "bullet", reason: "start" });
  openNextModal(state);
}

resetGame();
bindEvents();
requestAnimationFrame(loop);
