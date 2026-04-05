const W = 1000;
const H = 1000;
const MID = 500;
const FLOOR = 914;
const LEFT_EDGE = 74;
const RIGHT_EDGE = 82;
const LEFT_WIDTH = MID - LEFT_EDGE * 2;
const RIGHT_WIDTH = W - MID - RIGHT_EDGE * 2;
const LEFT_LANES = Array.from({ length: 8 }, (_, index) => LEFT_EDGE + (LEFT_WIDTH / 7) * index);
const RIGHT_LANES = Array.from({ length: 5 }, (_, index) => MID + RIGHT_EDGE + (RIGHT_WIDTH / 4) * index);
const LEFT_SLOT_COST = 12;
const LEVEL_COLORS = ["#7de7ff", "#67d8ff", "#8fdca3", "#ffc86e", "#ff8f6b"];
const LEVEL_EDGES = ["#38a8bf", "#2f8bb3", "#4e9f66", "#c08a28", "#cf5e43"];

const MONSTER_BASE = [
  { r: 25, hp: 5, vy: 60, score: 16, gold: 4, fill: "#9bf2ff", edge: "#46acc5" },
  { r: 33, hp: 10, vy: 46, score: 34, gold: 7, fill: "#68d6e6", edge: "#2c879e" },
  { r: 39, hp: 16, vy: 34, score: 60, gold: 10, fill: "#3ea8c6", edge: "#135f7f" },
];

const BLOCK_W = 38;
const BLOCK_H = 46;
const BLOCK_GAP = 12;
const BLOCKS = {
  core: { hp: 5, damage: 8, score: 12, fill: "#ff956f", edge: "#d85a43" },
  armor: { hp: 10, damage: 14, score: 24, fill: "#f2bf65", edge: "#aa7320" },
  volatile: { hp: 4, damage: 10, score: 18, fill: "#8bdfff", edge: "#4481ff" },
  relic: { hp: 8, damage: 12, score: 28, fill: "#ffe07c", edge: "#c79a28" },
};

const el = {
  stage: document.getElementById("stage"),
  dangerPill: document.getElementById("danger-pill"),
  status: document.getElementById("spawn-status"),
  restart: document.getElementById("restart"),
  result: document.getElementById("result"),
  resultText: document.getElementById("result-text"),
  resultRestart: document.getElementById("result-restart"),
  choiceModal: document.getElementById("choice-modal"),
  choiceList: document.getElementById("choice-list"),
};

const ctx = el.stage.getContext("2d");
const state = {
  score: 0,
  gold: 24,
  baseHp: 100,
  maxBaseHp: 100,
  time: 0,
  meteorAt: 1300,
  monsterAt: 900,
  lastFrame: 0,
  nextHudAt: 0,
  running: true,
  paused: false,
  leftSlots: [],
  rightWeapons: [],
  blocks: [],
  monsters: [],
  bullets: [],
  particles: [],
  note: "",
  noteUntil: 0,
  dragging: null,
  chestChoices: null,
  perks: {
    leftDamage: 0,
    leftFireRate: 1,
    rightDamage: 0,
    rightFireRate: 1,
    injectBonus: 0,
    goldBonus: 1,
    baseRegen: 0,
  },
  layout: { width: 0, height: 0, pixelWidth: 0, pixelHeight: 0, scale: 1, offsetX: 0, offsetY: 0 },
};

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => performance.now();
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const tint = (hex, alpha) => {
  const s = hex.slice(1);
  const n = s.length === 3 ? s.split("").map((v) => v + v).join("") : s;
  return `rgba(${Number.parseInt(n.slice(0, 2), 16)}, ${Number.parseInt(n.slice(2, 4), 16)}, ${Number.parseInt(n.slice(4, 6), 16)}, ${alpha})`;
};

const shuffle = (list) => {
  const next = [...list];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

const note = (text, duration = 1500) => {
  state.note = text;
  state.noteUntil = now() + duration;
};

const levelColor = (level) => LEVEL_COLORS[Math.min(level - 1, LEVEL_COLORS.length - 1)];
const levelEdge = (level) => LEVEL_EDGES[Math.min(level - 1, LEVEL_EDGES.length - 1)];
const progressFactor = () => 1 + state.time / 90000;
const pickSparseLanes = (count) => {
  const lanes = shuffle(Array.from({ length: LEFT_LANES.length }, (_, index) => index));
  const picks = [];
  lanes.forEach((lane) => {
    if (picks.length >= count) {
      return;
    }
    if (picks.every((picked) => Math.abs(picked - lane) > 1)) {
      picks.push(lane);
    }
  });

  if (picks.length < count) {
    lanes.forEach((lane) => {
      if (picks.length >= count) {
        return;
      }
      if (!picks.includes(lane)) {
        picks.push(lane);
      }
    });
  }

  return picks.sort((a, b) => a - b);
};

const rightStats = (level) => ({
  damage: level + state.perks.rightDamage,
  fireCd: Math.max(58, (152 - level * 16) * state.perks.rightFireRate),
});

const leftStats = (level) => ({
  damage: level + state.perks.leftDamage,
  fireCd: Math.max(120, (510 - level * 44) * state.perks.leftFireRate),
});

const upgradeCost = (weapon) => 10 + weapon.level * 8;

const spawnFx = (x, y, color, count = 10, speed = 180) => {
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count + rand(-0.28, 0.28);
    const velocity = rand(speed * 0.45, speed);
    const life = rand(160, 420);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      life,
      maxLife: life,
      size: rand(3, 8),
      color,
    });
  }
};

const perkPool = () => [
  {
    id: "left-speed",
    title: "超频齿轮",
    body: "左侧全部炮塔攻速提升 14%。",
    apply: () => { state.perks.leftFireRate *= 0.86; },
  },
  {
    id: "left-damage",
    title: "破岩弹芯",
    body: "左侧全部炮塔伤害 +1。",
    apply: () => { state.perks.leftDamage += 1; },
  },
  {
    id: "right-damage",
    title: "高能供弹",
    body: "右侧全部火线伤害 +1。",
    apply: () => { state.perks.rightDamage += 1; },
  },
  {
    id: "right-speed",
    title: "快反枪机",
    body: "右侧全部火线攻速提升 12%。",
    apply: () => { state.perks.rightFireRate *= 0.88; },
  },
  {
    id: "inject",
    title: "加大弹仓",
    body: "每次注弹额外获得 +2 发。",
    apply: () => { state.perks.injectBonus += 2; },
  },
  {
    id: "gold",
    title: "赏金协议",
    body: "怪物金币掉落提升 25%。",
    apply: () => { state.perks.goldBonus += 0.25; },
  },
  {
    id: "repair",
    title: "基地修复",
    body: "左侧基地立刻回复 18 点生命。",
    apply: () => { state.baseHp = Math.min(state.maxBaseHp, state.baseHp + 18); },
  },
];

const openChest = () => {
  if (state.chestChoices || !state.running) {
    return;
  }
  const options = perkPool()
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);
  state.chestChoices = options;
  state.paused = true;
  el.choiceList.innerHTML = options.map((choice, index) => `
    <button class="choice-button" type="button" data-choice-index="${index}">
      <strong>${choice.title}</strong>
      <span>${choice.body}</span>
    </button>
  `).join("");
  el.choiceModal.classList.remove("hidden");
};

const chooseChest = (index) => {
  const choice = state.chestChoices?.[index];
  if (!choice) {
    return;
  }
  choice.apply();
  state.chestChoices = null;
  state.paused = false;
  el.choiceModal.classList.add("hidden");
  note(`获得强化: ${choice.title}`, 1200);
  syncHud();
};

const reset = () => {
  state.score = 0;
  state.gold = 24;
  state.baseHp = 100;
  state.time = 0;
  state.meteorAt = 1300;
  state.monsterAt = 900;
  state.lastFrame = 0;
  state.nextHudAt = 0;
  state.running = true;
  state.paused = false;
  state.blocks = [];
  state.monsters = [];
  state.bullets = [];
  state.particles = [];
  state.dragging = null;
  state.chestChoices = null;
  state.perks = {
    leftDamage: 0,
    leftFireRate: 1,
    rightDamage: 0,
    rightFireRate: 1,
    injectBonus: 0,
    goldBonus: 1,
    baseRegen: 0,
  };
  state.note = "右侧点击武器注弹，左侧点击空槽创建炮塔；同级拖拽可合并升级。";
  state.noteUntil = now() + 2400;
  state.leftSlots = LEFT_LANES.map((x, lane) => ({ lane, x, y: FLOOR - 28, weapon: null }));
  state.rightWeapons = RIGHT_LANES.map((x, lane) => ({
    id: `right-${lane + 1}`,
    lane,
    x,
    y: FLOOR - 40,
    level: 1,
    magazine: 3,
    nextFire: 0,
    nextPassiveAmmoAt: 1000,
    disabledUntil: 0,
    integrity: 3,
  }));
  el.choiceModal.classList.add("hidden");
  el.result.classList.add("hidden");
  syncHud();
};

const spawnMonster = () => {
  const progress = clamp(state.time / 90000, 0, 1);
  const roll = Math.random();
  const baseIndex = roll < 0.12 + progress * 0.28 ? 2 : roll < 0.46 + progress * 0.24 ? 1 : 0;
  const base = MONSTER_BASE[baseIndex];
  const factor = progressFactor();
  const lane = Math.floor(Math.random() * RIGHT_LANES.length);
  const level = clamp(baseIndex + 1 + Math.floor(progress * 2), 1, 5);
  state.monsters.push({
    lane,
    x: RIGHT_LANES[lane],
    y: -base.r - 20,
    r: base.r + Math.floor(progress * 4),
    hp: Math.ceil(base.hp * factor),
    maxHp: Math.ceil(base.hp * factor),
    vy: base.vy + progress * 9,
    score: Math.ceil(base.score * (1 + progress * 0.5)),
    gold: Math.ceil(base.gold * state.perks.goldBonus),
    impactDamage: Math.ceil((5 + level * 2) * (1 + progress * 0.25)),
    level,
    fill: levelColor(level),
    edge: levelEdge(level),
  });
};

const spawnMeteorWall = () => {
  const rows = 1 + (Math.random() < 0.22 ? 1 : 0);
  const factor = progressFactor();
  const speed = rand(5.5, 8.5) + Math.min(3.5, state.time / 32000);
  const relicRow = Math.random() < 0.22 ? Math.floor(Math.random() * rows) : -1;
  const rowLanes = Array.from({ length: rows }, (_, row) => {
    const count = row === 0 ? Math.floor(rand(3, 6)) : Math.floor(rand(2, 5));
    return pickSparseLanes(count);
  });
  const relicLane = relicRow === -1 ? -1 : rowLanes[relicRow][Math.floor(Math.random() * rowLanes[relicRow].length)];
  for (let row = 0; row < rows; row += 1) {
    rowLanes[row].forEach((lane) => {
      const roll = Math.random();
      const type = row === relicRow && lane === relicLane
        ? "relic"
        : roll < 0.15 ? "volatile" : roll < 0.42 ? "armor" : "core";
      const config = BLOCKS[type];
      const baseLevel = type === "core" ? 1 : type === "volatile" ? 2 : type === "armor" ? 3 : 5;
      const level = clamp(baseLevel + Math.floor(state.time / 45000), 1, 5);
      state.blocks.push({
        lane,
        type,
        x: LEFT_LANES[lane] - BLOCK_W / 2,
        y: -row * (BLOCK_H + BLOCK_GAP + 12) - BLOCK_H,
        w: BLOCK_W,
        h: BLOCK_H,
        vy: speed,
        hp: Math.ceil(config.hp * factor),
        maxHp: Math.ceil(config.hp * factor),
        damage: Math.ceil(config.damage * (1 + state.time / 150000)),
        score: config.score,
        level,
        fill: type === "relic" ? config.fill : levelColor(level),
        edge: type === "relic" ? config.edge : levelEdge(level),
        carriesChest: type === "relic",
        dead: false,
        exploded: false,
      });
    });
  }
};

const blockCenter = (block) => ({ x: block.x + block.w / 2, y: block.y + block.h / 2 });

const maybeDropChest = (block) => {
  if (!block.carriesChest) {
    return;
  }
  openChest();
};

const damageBlock = (block, amount, chain = false) => {
  if (block.dead) {
    return;
  }
  block.hp -= amount;
  spawnFx(block.x + block.w / 2, block.y + block.h / 2, block.type === "volatile" ? "#89deff" : block.fill, 8, 120);
  if (block.hp > 0) {
    return;
  }
  block.dead = true;
  state.score += block.score;
  maybeDropChest(block);
  spawnFx(block.x + block.w / 2, block.y + block.h / 2, block.fill, 18, 240);

  if (block.type === "volatile" && !block.exploded && !chain) {
    block.exploded = true;
    const origin = blockCenter(block);
    state.blocks.forEach((other) => {
      if (!other.dead && other !== block && dist(origin, blockCenter(other)) < 110) {
        damageBlock(other, 2, true);
      }
    });
  }
};

const damageMonster = (monster, amount) => {
  monster.hp -= amount;
  spawnFx(monster.x, monster.y, monster.fill, 7, 120);
  if (monster.hp > 0) {
    return;
  }
  monster.dead = true;
  state.score += monster.score;
  state.gold += monster.gold;
  note(`获得 ${monster.gold} 金币`, 900);
  spawnFx(monster.x, monster.y, monster.fill, 18, 250);
};

const injectWeapon = (weapon) => {
  const injectAmount = 5 + state.perks.injectBonus;
  if (state.gold < 5) {
    note("金币不足，无法注入。");
    return;
  }
  state.gold -= 5;
  weapon.magazine = Math.min(80, weapon.magazine + injectAmount);
  syncHud();
};

const upgradeWeapon = (weapon) => {
  const cost = upgradeCost(weapon);
  if (weapon.level >= 5) {
    note("该武器已满级。");
    return;
  }
  if (state.gold < cost) {
    note(`升级需要 ${cost} 金币。`);
    return;
  }
  state.gold -= cost;
  weapon.level += 1;
  note(`火线 ${weapon.lane + 1} 升至 Lv.${weapon.level}`);
  syncHud();
};

const createLeftWeapon = (slot) => {
  if (slot.weapon) {
    return;
  }
  if (state.gold < LEFT_SLOT_COST) {
    note(`创建炮塔需要 ${LEFT_SLOT_COST} 金币。`);
    return;
  }
  state.gold -= LEFT_SLOT_COST;
  slot.weapon = {
    id: `left-${slot.lane}-${Math.round(Math.random() * 1e6)}`,
    level: 1,
    nextFire: 0,
  };
  syncHud();
};

const updatePassiveAmmo = () => {
  state.rightWeapons.forEach((weapon) => {
    while (state.time >= weapon.nextPassiveAmmoAt) {
      weapon.magazine = Math.min(80, weapon.magazine + 1);
      weapon.nextPassiveAmmoAt += 1000;
    }
  });
};

const fireLeftWeapons = () => {
  const time = now();
  state.leftSlots.forEach((slot) => {
    if (!slot.weapon || time < slot.weapon.nextFire) {
      return;
    }
    const target = state.blocks.find((block) => !block.dead && block.lane === slot.lane);
    if (!target) {
      return;
    }
    const stats = leftStats(slot.weapon.level);
    state.bullets.push({
      side: "left",
      lane: slot.lane,
      x: slot.x,
      y: slot.y - 28,
      vy: -860,
      r: 7,
      damage: stats.damage,
      color: levelColor(slot.weapon.level),
      life: 1400,
    });
    slot.weapon.nextFire = time + stats.fireCd;
  });
};

const fireRightWeapons = () => {
  const time = now();
  state.rightWeapons.forEach((weapon) => {
    if (time < weapon.nextFire || time < weapon.disabledUntil || weapon.magazine <= 0) {
      return;
    }
    const target = state.monsters.find((monster) => !monster.dead && monster.lane === weapon.lane);
    if (!target) {
      return;
    }
    const stats = rightStats(weapon.level);
    state.bullets.push({
      side: "right",
      lane: weapon.lane,
      x: weapon.x,
      y: weapon.y - 72,
      vy: -1220,
      r: 8,
      damage: stats.damage,
      color: levelColor(weapon.level),
      life: 1100,
    });
    weapon.magazine -= 1;
    weapon.nextFire = time + stats.fireCd;
  });
};

const updateBullets = (dt) => {
  const keep = [];
  state.bullets.forEach((bullet) => {
    bullet.life -= dt;
    if (bullet.life <= 0) {
      return;
    }
    bullet.y += bullet.vy * dt / 1000;
    if (bullet.y < -40 || bullet.y > H + 40) {
      return;
    }

    if (bullet.side === "left") {
      const hitBlock = state.blocks.find((block) => !block.dead
        && block.lane === bullet.lane
        && bullet.y >= block.y
        && bullet.y <= block.y + block.h);
      if (hitBlock) {
        damageBlock(hitBlock, bullet.damage);
        return;
      }
    } else {
      const hitMonster = state.monsters.find((monster) => !monster.dead
        && monster.lane === bullet.lane
        && Math.abs(bullet.y - monster.y) <= monster.r + bullet.r);
      if (hitMonster) {
        damageMonster(hitMonster, bullet.damage);
        return;
      }
    }

    keep.push(bullet);
  });
  state.bullets = keep;
};

const hitRightWeapon = (monster) => {
  const weapon = state.rightWeapons[monster.lane];
  weapon.integrity = Math.max(0, weapon.integrity - 1);
  weapon.disabledUntil = now() + 5000;
  state.baseHp = Math.max(0, state.baseHp - monster.impactDamage);
  note(`火线 ${monster.lane + 1} 被撞击，基地损失 ${monster.impactDamage} 点生命。`);
  spawnFx(monster.x, monster.y, "#86f4ff", 16, 180);
  if (state.baseHp <= 0) {
    endGame();
  }
};

const updateMonsters = (dt) => {
  state.monsters.forEach((monster) => {
    monster.y += monster.vy * dt / 1000;
    if (monster.y + monster.r >= state.rightWeapons[monster.lane].y - 8) {
      monster.dead = true;
      hitRightWeapon(monster);
    }
  });
  state.monsters = state.monsters.filter((monster) => !monster.dead);
};

const updateBlocks = (dt) => {
  state.blocks.forEach((block) => {
    block.y += block.vy * dt / 1000;
    if (block.y + block.h >= FLOOR) {
      block.dead = true;
      state.baseHp = Math.max(0, state.baseHp - block.damage);
      note(`左侧基地受到 ${block.damage} 点伤害。`, 900);
      spawnFx(block.x + block.w / 2, FLOOR - 12, block.fill, 16, 180);
      if (state.baseHp <= 0) {
        endGame();
      }
    }
  });
  state.blocks = state.blocks.filter((block) => !block.dead);
};

const updateParticles = (dt) => {
  state.particles = state.particles.filter((particle) => {
    particle.life -= dt;
    if (particle.life <= 0) {
      return false;
    }
    particle.x += particle.vx * dt / 1000;
    particle.y += particle.vy * dt / 1000;
    particle.vy += 110 * dt / 1000;
    particle.vx *= 0.986;
    return true;
  });
};

const dangerText = () => {
  const value = state.blocks.length * 1.3 + state.monsters.length;
  if (value < 10) return "稳定";
  if (value < 18) return "升温";
  if (value < 26) return "高压";
  return "失控";
};

const syncHud = () => {
  el.dangerPill.textContent = dangerText();
  el.status.textContent = `左侧陨石与右侧怪物会随时间变强。点击右侧武器注弹，点击左侧空槽创建炮塔；出现宝箱时选择一项强化。`;
};

const resize = () => {
  const rect = el.stage.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  el.stage.width = Math.round(width * ratio);
  el.stage.height = Math.round(height * ratio);
  const scale = Math.min(width / W, height / H);
  state.layout = {
    width,
    height,
    pixelWidth: el.stage.width,
    pixelHeight: el.stage.height,
    scale,
    offsetX: (width - W * scale) / 2,
    offsetY: (height - H * scale) / 2,
  };
};

const toWorld = (clientX, clientY) => {
  const rect = el.stage.getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.layout.offsetX) / state.layout.scale,
    y: (clientY - rect.top - state.layout.offsetY) / state.layout.scale,
  };
};

const leftLaneFromX = (x) => LEFT_LANES.reduce((best, laneX, index) => (
  Math.abs(laneX - x) < Math.abs(LEFT_LANES[best] - x) ? index : best
), 0);

const stageWeaponAt = (point) => state.rightWeapons.find((weapon) => (
  point.x > weapon.x - 60
  && point.x < weapon.x + 60
  && point.y > weapon.y - 90
  && point.y < weapon.y + 28
));

const upgradeButtonAt = (point) => state.rightWeapons.find((weapon) => (
  point.x > weapon.x - 64
  && point.x < weapon.x + 64
  && point.y > weapon.y + 34
  && point.y < weapon.y + 84
));

const leftSlotAt = (point) => state.leftSlots
  .filter((slot) => (
    point.x > slot.x - 30
    && point.x < slot.x + 30
    && point.y > slot.y - 82
    && point.y < slot.y + 44
  ))
  .sort((a, b) => Math.abs(a.x - point.x) - Math.abs(b.x - point.x))[0];

const onPointerDown = (event) => {
  if (!state.running || state.paused) {
    return;
  }
  const point = toWorld(event.clientX, event.clientY);

  const upgradeTarget = upgradeButtonAt(point);
  if (upgradeTarget) {
    upgradeWeapon(upgradeTarget);
    return;
  }

  const rightWeapon = stageWeaponAt(point);
  if (rightWeapon) {
    injectWeapon(rightWeapon);
    return;
  }

  const slot = leftSlotAt(point);
  if (!slot) {
    return;
  }

  if (slot.weapon) {
    state.dragging = {
      fromLane: slot.lane,
      weapon: slot.weapon,
      x: point.x,
      y: point.y,
      pointerId: event.pointerId,
    };
    slot.weapon = null;
    el.stage.setPointerCapture(event.pointerId);
    return;
  }

  createLeftWeapon(slot);
};

const onPointerMove = (event) => {
  if (!state.dragging || state.dragging.pointerId !== event.pointerId) {
    return;
  }
  const point = toWorld(event.clientX, event.clientY);
  state.dragging.x = point.x;
  state.dragging.y = point.y;
};

const onPointerUp = (event) => {
  if (!state.dragging || state.dragging.pointerId !== event.pointerId) {
    return;
  }
  const lane = leftLaneFromX(toWorld(event.clientX, event.clientY).x);
  const target = state.leftSlots[lane];
  const source = state.dragging.weapon;

  if (!target.weapon) {
    target.weapon = source;
  } else if (target.weapon.level === source.level && target.weapon.level < 5) {
    target.weapon.level += 1;
    note(`左侧防线合并为 Lv.${target.weapon.level}`);
    spawnFx(target.x, target.y - 10, "#ffe28b", 16, 180);
  } else {
    const origin = state.leftSlots[state.dragging.fromLane];
    origin.weapon = target.weapon;
    target.weapon = source;
  }

  if (el.stage.hasPointerCapture(event.pointerId)) {
    el.stage.releasePointerCapture(event.pointerId);
  }
  state.dragging = null;
};

const renderBackdrop = () => {
  const gradient = ctx.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, "#09111e");
  gradient.addColorStop(1, "#040915");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "rgba(255,255,255,0.03)";
  for (let x = 0; x < W; x += 64) ctx.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += 64) ctx.fillRect(0, y, W, 1);

  ctx.fillStyle = "rgba(255, 150, 107, 0.08)";
  ctx.fillRect(0, 0, MID, H);
  ctx.fillStyle = "rgba(98, 211, 223, 0.08)";
  ctx.fillRect(MID, 0, W - MID, H);

  ctx.strokeStyle = "rgba(255,150,107,0.24)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(MID, 20);
  ctx.lineTo(MID, FLOOR + 18);
  ctx.stroke();

  LEFT_LANES.forEach((laneX) => {
    ctx.strokeStyle = "rgba(255,150,107,0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(laneX, 100);
    ctx.lineTo(laneX, FLOOR - 86);
    ctx.stroke();
  });

  RIGHT_LANES.forEach((laneX) => {
    ctx.strokeStyle = "rgba(98,211,223,0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(laneX, 100);
    ctx.lineTo(laneX, FLOOR - 120);
    ctx.stroke();
  });

  ctx.fillStyle = "#ff9b74";
  ctx.font = '700 26px "Bahnschrift", "Segoe UI", sans-serif';
  ctx.textAlign = "left";
  ctx.fillText("Meteor Strata", 30, 52);
  ctx.fillStyle = "#84efff";
  ctx.textAlign = "right";
  ctx.fillText("Coin Lanes", W - 28, 52);
};

const renderTopStats = () => {
  const cards = [
    { label: "Score", value: String(state.score), x: 20, y: 118, color: "#ff9b74" },
    { label: "Gold", value: String(state.gold), x: 20, y: 182, color: "#ffd56f" },
    { label: "Time", value: `${(state.time / 1000).toFixed(1)}s`, x: W - 144, y: 118, color: "#8cf2ff" },
    { label: "Threats", value: String(state.blocks.length + state.monsters.length), x: W - 144, y: 182, color: "#d6e9ff" },
  ];

  cards.forEach((card) => {
    ctx.fillStyle = "rgba(7,14,26,0.74)";
    ctx.beginPath();
    ctx.roundRect(card.x, card.y, 124, 54, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "rgba(214,231,244,0.72)";
    ctx.font = '700 11px "Bahnschrift", "Segoe UI", sans-serif';
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(card.label, card.x + 14, card.y + 12);
    ctx.fillStyle = card.color;
    ctx.font = '700 22px "Bahnschrift", "Segoe UI", sans-serif';
    ctx.fillText(card.value, card.x + 14, card.y + 26);
  });
};

const renderBaseHp = () => {
  const width = MID - 70;
  const left = 35;
  const top = FLOOR + 26;
  const fill = width * (state.baseHp / state.maxBaseHp);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.roundRect(left, top, width, 18, 10);
  ctx.fill();
  ctx.fillStyle = state.baseHp > 55 ? "#72e0a9" : state.baseHp > 25 ? "#ffd36f" : "#ff8368";
  ctx.beginPath();
  ctx.roundRect(left, top, fill, 18, 10);
  ctx.fill();
  ctx.fillStyle = "#edf7ff";
  ctx.font = '700 15px "Bahnschrift", "Segoe UI", sans-serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(`左侧基地生命 ${state.baseHp}/${state.maxBaseHp}`, left, top - 6);
};

const renderBlock = (block) => {
  ctx.save();
  ctx.translate(block.x, block.y);
  ctx.beginPath();
  ctx.roundRect(0, 0, block.w, block.h, 12);
  ctx.fillStyle = block.fill;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = block.edge;
  ctx.stroke();

  if (block.type === "volatile") {
    ctx.strokeStyle = "#eef7ff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(block.w * 0.42, 12);
    ctx.lineTo(block.w * 0.58, 24);
    ctx.lineTo(block.w * 0.48, 38);
    ctx.stroke();
  } else if (block.type === "armor") {
    ctx.strokeStyle = "#fff7dd";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(block.w / 2, block.h / 2, 10, 0, Math.PI * 2);
    ctx.stroke();
  } else if (block.type === "relic") {
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath();
    ctx.roundRect(10, 8, block.w - 20, 10, 5);
    ctx.fill();
    ctx.fillStyle = "#8a5c0f";
    ctx.beginPath();
    ctx.roundRect(12, 18, block.w - 24, block.h - 28, 8);
    ctx.fill();
    ctx.strokeStyle = "#fff5cb";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(block.w / 2, 16);
    ctx.lineTo(block.w / 2, block.h - 14);
    ctx.moveTo(16, block.h / 2);
    ctx.lineTo(block.w - 16, block.h / 2);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(8, block.h - 8);
  ctx.lineTo(8 + (block.w - 16) * (block.hp / block.maxHp), block.h - 8);
  ctx.stroke();
  ctx.restore();
};

const renderMonster = (monster) => {
  const variant = Math.floor((monster.level - 1) / 3) % 3;
  ctx.save();
  ctx.translate(monster.x, monster.y);
  ctx.fillStyle = monster.fill;
  ctx.strokeStyle = monster.edge;
  ctx.lineWidth = 5;

  ctx.beginPath();
  if (variant === 0) {
    ctx.moveTo(0, monster.r * 1.08);
    ctx.lineTo(monster.r * 0.34, monster.r * 0.3);
    ctx.lineTo(monster.r * 1.04, -monster.r * 0.04);
    ctx.lineTo(monster.r * 0.52, -monster.r * 0.22);
    ctx.lineTo(monster.r * 0.3, -monster.r * 0.9);
    ctx.lineTo(0, -monster.r * 0.6);
    ctx.lineTo(-monster.r * 0.3, -monster.r * 0.9);
    ctx.lineTo(-monster.r * 0.52, -monster.r * 0.22);
    ctx.lineTo(-monster.r * 1.04, -monster.r * 0.04);
    ctx.lineTo(-monster.r * 0.34, monster.r * 0.3);
  } else if (variant === 1) {
    ctx.moveTo(0, monster.r * 1.14);
    ctx.lineTo(monster.r * 0.26, monster.r * 0.34);
    ctx.lineTo(monster.r * 0.9, monster.r * 0.12);
    ctx.lineTo(monster.r * 1.12, -monster.r * 0.3);
    ctx.lineTo(monster.r * 0.44, -monster.r * 0.26);
    ctx.lineTo(monster.r * 0.2, -monster.r * 0.94);
    ctx.lineTo(-monster.r * 0.2, -monster.r * 0.94);
    ctx.lineTo(-monster.r * 0.44, -monster.r * 0.26);
    ctx.lineTo(-monster.r * 1.12, -monster.r * 0.3);
    ctx.lineTo(-monster.r * 0.9, monster.r * 0.12);
    ctx.lineTo(-monster.r * 0.26, monster.r * 0.34);
  } else {
    ctx.moveTo(0, monster.r * 1.16);
    ctx.lineTo(monster.r * 0.22, monster.r * 0.26);
    ctx.lineTo(monster.r * 0.62, monster.r * 0.02);
    ctx.lineTo(monster.r * 1.16, -monster.r * 0.02);
    ctx.lineTo(monster.r * 0.54, -monster.r * 0.34);
    ctx.lineTo(monster.r * 0.3, -monster.r * 0.96);
    ctx.lineTo(0, -monster.r * 0.52);
    ctx.lineTo(-monster.r * 0.3, -monster.r * 0.96);
    ctx.lineTo(-monster.r * 0.54, -monster.r * 0.34);
    ctx.lineTo(-monster.r * 1.16, -monster.r * 0.02);
    ctx.lineTo(-monster.r * 0.62, monster.r * 0.02);
    ctx.lineTo(-monster.r * 0.22, monster.r * 0.26);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-monster.r * 0.66, -monster.r * 0.06);
  ctx.lineTo(-monster.r * 1.18, -monster.r * 0.34);
  ctx.lineTo(-monster.r * 0.36, -monster.r * 0.22);
  ctx.closePath();
  ctx.moveTo(monster.r * 0.66, -monster.r * 0.06);
  ctx.lineTo(monster.r * 1.18, -monster.r * 0.34);
  ctx.lineTo(monster.r * 0.36, -monster.r * 0.22);
  ctx.closePath();
  ctx.fillStyle = tint(monster.edge, 0.35);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.beginPath();
  ctx.ellipse(0, monster.r * 0.16, monster.r * 0.2, monster.r * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = tint(monster.fill, 0.24);
  ctx.beginPath();
  ctx.roundRect(-monster.r * 0.18, -monster.r * 0.42, monster.r * 0.36, monster.r * 0.42, 10);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, monster.r + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (monster.hp / monster.maxHp));
  ctx.strokeStyle = "rgba(255,255,255,0.88)";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
};

const renderLeftSlots = () => {
  state.leftSlots.forEach((slot) => {
    const weapon = slot.weapon;
    ctx.save();
    ctx.translate(slot.x, slot.y);
    ctx.beginPath();
    ctx.ellipse(0, 0, 34, 22, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,154,114,0.12)";
    ctx.fill();

    if (!weapon) {
      ctx.beginPath();
      ctx.roundRect(-20, -44, 40, 54, 16);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,154,114,0.28)";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "#ffd8ca";
      ctx.font = '700 18px "Bahnschrift", "Segoe UI", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("+", 0, -18);
      ctx.font = '700 11px "Bahnschrift", "Segoe UI", sans-serif';
      ctx.fillText(`${LEFT_SLOT_COST}G`, 0, 0);
      ctx.restore();
      return;
    }

    const color = levelColor(weapon.level);
    ctx.beginPath();
    ctx.roundRect(-20, -44, 40, 54, 16);
    ctx.fillStyle = "#ffece2";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(-5, -68, 10, 26);
    ctx.fillStyle = "#311f18";
    ctx.font = '700 13px "Bahnschrift", "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`L${weapon.level}`, 0, -14);
    ctx.restore();
  });

  if (state.dragging) {
    const color = levelColor(state.dragging.weapon.level);
    ctx.save();
    ctx.translate(state.dragging.x, state.dragging.y);
    ctx.globalAlpha = 0.86;
    ctx.beginPath();
    ctx.roundRect(-20, -44, 40, 54, 16);
    ctx.fillStyle = "#fff1e9";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(-5, -68, 10, 26);
    ctx.fillStyle = "#311f18";
    ctx.font = '700 13px "Bahnschrift", "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`L${state.dragging.weapon.level}`, 0, -14);
    ctx.restore();
  }
};

const renderRightWeapons = () => {
  state.rightWeapons.forEach((weapon) => {
    const color = levelColor(weapon.level);
    const isDown = now() < weapon.disabledUntil;
    const hpColor = weapon.integrity >= 3 ? "#76e0aa" : weapon.integrity === 2 ? "#ffd56f" : "#ff886d";
    ctx.save();
    ctx.translate(weapon.x, weapon.y);
    ctx.beginPath();
    ctx.roundRect(-36, -56, 72, 84, 24);
    ctx.fillStyle = isDown ? "rgba(120,151,168,0.5)" : "rgba(228,250,255,0.92)";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = isDown ? "#7ca9b4" : color;
    ctx.stroke();

    ctx.fillStyle = isDown ? "#7ca9b4" : color;
    ctx.beginPath();
    ctx.roundRect(-6, -78, 12, 30, 7);
    ctx.fill();

    const fillHeight = clamp(weapon.magazine / 80, 0, 1) * 46;
    ctx.fillStyle = "rgba(93,211,224,0.18)";
    ctx.beginPath();
    ctx.roundRect(-22, -24, 44, 46, 14);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-22, 22 - fillHeight, 44, fillHeight, 14);
    ctx.fill();

    ctx.fillStyle = "#17363e";
    ctx.font = '700 14px "Bahnschrift", "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`L${weapon.level}`, 0, -8);
    ctx.fillText(`${weapon.magazine}`, 0, 8);

    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.roundRect(-28, -92, 56, 7, 6);
    ctx.fill();
    ctx.fillStyle = hpColor;
    ctx.beginPath();
    ctx.roundRect(-28, -92, (56 * weapon.integrity) / 3, 7, 6);
    ctx.fill();

    ctx.beginPath();
    ctx.roundRect(-40, 34, 80, 28, 15);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = "#1f1110";
    ctx.font = '700 12px "Bahnschrift", "Segoe UI", sans-serif';
    ctx.fillText(`升级 ${upgradeCost(weapon)}`, 0, 48);
    ctx.restore();
  });
};

const renderBullets = () => {
  state.bullets.forEach((bullet) => {
    ctx.fillStyle = bullet.color;
    ctx.beginPath();
    ctx.roundRect(bullet.x - 3, bullet.y - 14, 6, 24, 4);
    ctx.fill();
  });
};

const renderParticles = () => {
  state.particles.forEach((particle) => {
    const alpha = particle.life / particle.maxLife;
    ctx.fillStyle = tint(particle.color, alpha);
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * alpha, 0, Math.PI * 2);
    ctx.fill();
  });
};

const renderNote = () => {
  if (!state.note || now() >= state.noteUntil) {
    return;
  }
  const alpha = (state.noteUntil - now()) / 400;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = "rgba(4,10,20,0.82)";
  ctx.beginPath();
  ctx.roundRect(W / 2 - 240, 84, 480, 48, 20);
  ctx.fill();
  ctx.fillStyle = "#ebf7ff";
  ctx.font = '700 18px "Bahnschrift", "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(state.note, W / 2, 108);
  ctx.restore();
};

const render = () => {
  const { width, height, pixelWidth, pixelHeight, scale, offsetX, offsetY } = state.layout;
  ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  renderBackdrop();
  state.blocks.forEach(renderBlock);
  state.monsters.forEach(renderMonster);
  renderLeftSlots();
  renderRightWeapons();
  renderBaseHp();
  renderBullets();
  renderParticles();
  renderTopStats();
  renderNote();
  ctx.restore();
};

const endGame = () => {
  state.running = false;
  state.paused = false;
  el.choiceModal.classList.add("hidden");
  el.result.classList.remove("hidden");
  el.resultText.textContent = `坚持 ${(state.time / 1000).toFixed(1)} 秒，剩余金币 ${state.gold}，左侧基地生命已归零。`;
  syncHud();
};

const step = (frameTime) => {
  if (!state.lastFrame) {
    state.lastFrame = frameTime;
  }
  const dt = Math.min(1000 / 15, frameTime - state.lastFrame);
  state.lastFrame = frameTime;

  if (state.running && !state.paused) {
    state.time += dt;
    updatePassiveAmmo();

    const topIsClear = !state.blocks.some((block) => !block.dead && block.y < 160);
    if (state.time >= state.meteorAt && topIsClear) {
      spawnMeteorWall();
      state.meteorAt = state.time + clamp(7600 - state.time * 0.003, 5200, 7600);
    }
    if (state.time >= state.monsterAt) {
      spawnMonster();
      state.monsterAt = state.time + clamp(1880 - state.time * 0.0035, 1180, 1880);
    }

    fireLeftWeapons();
    fireRightWeapons();
    updateBullets(dt);
    updateMonsters(dt);
    updateBlocks(dt);
    if (state.running) {
      updateParticles(dt);
      if (state.time >= state.nextHudAt) {
        syncHud();
        state.nextHudAt = state.time + 140;
      }
    }
  }

  render();
  window.requestAnimationFrame(step);
};

el.choiceList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-choice-index]");
  if (!button) {
    return;
  }
  chooseChest(Number(button.dataset.choiceIndex));
});

el.stage.addEventListener("pointerdown", onPointerDown);
el.stage.addEventListener("pointermove", onPointerMove);
el.stage.addEventListener("pointerup", onPointerUp);
el.stage.addEventListener("pointercancel", onPointerUp);
window.addEventListener("resize", resize);
el.restart.addEventListener("click", reset);
el.resultRestart.addEventListener("click", reset);

resize();
reset();
window.requestAnimationFrame(step);
