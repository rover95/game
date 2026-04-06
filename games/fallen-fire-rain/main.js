const WORLD_W = 720;
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
  restart: document.getElementById("restart"),
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

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const levelCurve = (lv) => Math.floor(18 + lv * lv * 7);

const upgrades = [
  { id: "dmg", rarity: "普通", title: "高能装药", body: "子弹伤害 +25%", apply: (s) => { s.stats.damage *= 1.25; } },
  { id: "as", rarity: "普通", title: "快装供弹", body: "攻速 +20%", apply: (s) => { s.stats.fireRate *= 1.2; } },
  { id: "crit", rarity: "普通", title: "精准校准", body: "暴击率 +10%", apply: (s) => { s.stats.crit += 0.1; } },
  { id: "ricochet", rarity: "普通", title: "强化反弹", body: "反弹次数 +2", apply: (s) => { s.stats.bounces += 2; } },
  { id: "multi", rarity: "稀有", title: "双联炮口", body: "每次发射 +1 枚子弹", apply: (s) => { s.stats.shots += 1; } },
  { id: "pierce", rarity: "稀有", title: "穿甲弹", body: "穿透 +1", apply: (s) => { s.stats.pierce += 1; } },
  { id: "arc", rarity: "稀有", title: "电弧弹", body: "命中会连锁 2 个附近目标", apply: (s) => { s.flags.arc = true; } },
  { id: "blast", rarity: "稀有", title: "爆裂弹", body: "命中造成小范围爆炸", apply: (s) => { s.flags.blast = true; } },
  { id: "bounce-rage", rarity: "史诗", title: "反弹狂热", body: "每次反弹伤害 +8%（单发叠加）", apply: (s) => { s.flags.bounceRage = true; } },
  { id: "magnet", rarity: "普通", title: "资源磁吸", body: "拾取范围提升", apply: (s) => { s.stats.pickupRange += 80; } },
  { id: "repair", rarity: "普通", title: "战地维修", body: "基地回复 2 点", apply: (s) => { s.baseHp = Math.min(s.maxBaseHp, s.baseHp + 2); } },
  { id: "fort", rarity: "稀有", title: "防线加固", body: "基地上限 +5，并回复 5", apply: (s) => { s.maxBaseHp += 5; s.baseHp += 5; } },
  { id: "bounty", rarity: "普通", title: "赏金猎人", body: "金币获取 +25%", apply: (s) => { s.stats.goldRate += 0.25; } },
  { id: "xp", rarity: "普通", title: "经验富集", body: "经验获取 +20%", apply: (s) => { s.stats.xpRate += 0.2; } },
];

const shopPool = [
  { title: "攻击 +10%", cost: 80, apply: (s) => { s.stats.damage *= 1.1; } },
  { title: "攻速 +10%", cost: 90, apply: (s) => { s.stats.fireRate *= 1.1; } },
  { title: "反弹 +1", cost: 110, apply: (s) => { s.stats.bounces += 1; } },
  { title: "基地 +3", cost: 70, apply: (s) => { s.baseHp = Math.min(s.maxBaseHp, s.baseHp + 3); } },
  { title: "立刻 +100 金币", cost: 60, apply: (s) => { s.gold += 100; } },
  { title: "稀有升级", cost: 130, apply: (s) => { showLevelUp(s, true); } },
];

let state;

function createState() {
  return {
    running: true,
    paused: false,
    turret: { x: WORLD_W / 2, y: BASE_Y, angle: -Math.PI / 2, firing: false, cooldown: 0, mode: "normal" },
    stats: { damage: 10, fireRate: 4, bulletSpeed: 900, bounces: 3, crit: 0.05, critMul: 1.5, shots: 1, pierce: 0, pickupRange: 90, goldRate: 1, xpRate: 1 },
    flags: { arc: false, blast: false, bounceRage: false },
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
    eliteTimer: 0,
    bossAlive: false,
    exp: 0,
    level: 1,
    expNeed: levelCurve(1),
    gold: 0,
    skillCd: 0,
    elapsed: 0,
  };
}

function aimToMouse(s) {
  const dx = s.mouse.x - s.turret.x;
  const dy = s.mouse.y - s.turret.y;
  const raw = Math.atan2(dy, dx);
  s.turret.angle = clamp(raw, -Math.PI + 0.18, -0.18);
}

function spawnBullet(s, angleOffset = 0) {
  const speed = s.stats.bulletSpeed;
  const a = s.turret.angle + angleOffset;
  s.bullets.push({
    x: s.turret.x,
    y: s.turret.y - 24,
    vx: Math.cos(a) * speed,
    vy: Math.sin(a) * speed,
    leftBounce: s.stats.bounces,
    leftPierce: s.turret.mode === "pierce" ? s.stats.pierce + 1 : s.stats.pierce,
    damage: s.stats.damage,
    rage: 0,
    radius: 6,
  });
}

function spawnEnemy(s, type = "auto") {
  const scale = 1 + (s.wave - 1) * 0.14;
  const table = [
    { kind: "meteor_s", hp: 30, speed: 130, r: 20, touch: 1, exp: 8, gold: 9, color: "#ff8d5c" },
    { kind: "meteor_m", hp: 68, speed: 95, r: 30, touch: 2, exp: 14, gold: 14, color: "#f5b26e" },
    { kind: "drone", hp: 38, speed: 155, r: 18, touch: 1, exp: 10, gold: 10, color: "#8dd9ff", drift: true },
    { kind: "dash", hp: 45, speed: 115, r: 16, touch: 1, exp: 12, gold: 11, color: "#abf7ff", dash: true },
    { kind: "armor", hp: 120, speed: 90, r: 28, touch: 2, exp: 20, gold: 20, color: "#9fbdff", armor: 4 },
  ];
  const boss = { kind: "boss", hp: 1200 + s.wave * 120, speed: 58, r: 66, touch: 5, exp: 180, gold: 220, color: "#ff5f89" };

  let base;
  if (type === "boss") {
    base = boss;
    s.bossAlive = true;
  } else {
    base = pick(table);
  }

  s.enemies.push({
    ...base,
    hp: Math.floor(base.hp * scale),
    maxHp: Math.floor(base.hp * scale),
    x: rand(base.r + 16, WORLD_W - base.r - 16),
    y: -base.r - rand(20, 180),
    vx: rand(-28, 28),
    vy: base.speed * (1 + (s.wave - 1) * 0.03),
    dashUsed: false,
  });
}

function addDrop(s, x, y, type, value) {
  s.drops.push({ x, y, type, value, vx: rand(-20, 20), vy: rand(10, 60), r: type === "xp" ? 8 : 9 });
}

function damageEnemy(s, enemy, rawDamage) {
  const armor = enemy.armor || 0;
  const dealt = Math.max(1, rawDamage - armor);
  enemy.hp -= dealt;
  s.effects.push({ x: enemy.x, y: enemy.y, life: 220, text: `-${Math.floor(dealt)}` });
  if (enemy.hp <= 0) {
    const xpCount = Math.max(1, Math.floor(enemy.exp / 10));
    const goldCount = Math.max(1, Math.floor(enemy.gold / 10));
    for (let i = 0; i < xpCount; i += 1) addDrop(s, enemy.x, enemy.y, "xp", Math.max(1, Math.floor(enemy.exp / xpCount)));
    for (let i = 0; i < goldCount; i += 1) addDrop(s, enemy.x, enemy.y, "gold", Math.max(1, Math.floor(enemy.gold / goldCount)));
    if (enemy.kind === "boss") s.bossAlive = false;
    return true;
  }
  return false;
}

function showLevelUp(s, onlyRare = false) {
  s.paused = true;
  ui.levelModal.classList.remove("hidden");
  const pool = onlyRare ? upgrades.filter((u) => ["稀有", "史诗"].includes(u.rarity)) : upgrades;
  const picks = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
  ui.levelOptions.innerHTML = picks
    .map((u, index) => `<button class="card" data-upgrade="${index}"><strong>${u.title}</strong><small>${u.rarity}</small><small>${u.body}</small></button>`)
    .join("");
  ui.levelOptions.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const upgrade = picks[Number(btn.dataset.upgrade)];
      upgrade.apply(s);
      s.paused = false;
      ui.levelModal.classList.add("hidden");
      syncHud(s);
    }, { once: true });
  });
}

function showShop(s) {
  s.paused = true;
  ui.shopModal.classList.remove("hidden");
  const picks = [...shopPool].sort(() => Math.random() - 0.5).slice(0, 4);
  ui.shopOptions.innerHTML = picks
    .map((o, index) => `<button class="card" data-shop="${index}"><strong>${o.title}</strong><small>花费 ${o.cost} 金币</small></button>`)
    .join("");
  ui.shopOptions.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const option = picks[Number(btn.dataset.shop)];
      if (s.gold < option.cost) return;
      s.gold -= option.cost;
      option.apply(s);
      closeShop(s);
    });
  });
}

function closeShop(s) {
  s.paused = false;
  ui.shopModal.classList.add("hidden");
  syncHud(s);
}

function skillPulse(s) {
  if (s.skillCd > 0 || !s.running || s.paused) return;
  s.skillCd = 14;
  s.enemies.forEach((e) => {
    const d = Math.hypot(e.x - s.turret.x, e.y - s.turret.y);
    if (d < 430) e.hp -= 140;
  });
  s.effects.push({ x: s.turret.x, y: s.turret.y - 40, life: 500, pulse: true, r: 0 });
}

function update(dt, s) {
  if (!s.running || s.paused) return;
  s.elapsed += dt;
  s.waveTimer += dt * 1000;
  s.spawnTimer -= dt;
  s.eliteTimer -= dt;
  s.turret.cooldown -= dt;
  s.skillCd = Math.max(0, s.skillCd - dt);

  aimToMouse(s);

  const spawnGap = Math.max(0.22, 0.92 - s.wave * 0.04);
  if (s.spawnTimer <= 0) {
    spawnEnemy(s);
    s.spawnTimer = spawnGap;
  }
  if (s.wave >= 6 && s.eliteTimer <= 0) {
    spawnEnemy(s, "auto");
    s.eliteTimer = 3.8;
  }

  if (s.waveTimer >= WAVE_MS) {
    s.wave += 1;
    s.waveTimer = 0;
    showShop(s);
    if (s.wave % 5 === 0 && !s.bossAlive) spawnEnemy(s, "boss");
  }

  if (s.turret.firing && s.turret.cooldown <= 0) {
    const count = s.stats.shots;
    for (let i = 0; i < count; i += 1) {
      const spread = count === 1 ? 0 : ((i / (count - 1)) - 0.5) * 0.22;
      spawnBullet(s, spread);
    }
    s.turret.cooldown = 1 / s.stats.fireRate;
  }

  s.enemies.forEach((e) => {
    if (e.drift) e.x += Math.sin(s.elapsed * 2.1 + e.y * 0.01) * 18 * dt;
    if (e.dash && !e.dashUsed && e.y > WORLD_H * 0.46) {
      e.vy *= 2.2;
      e.dashUsed = true;
    }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    if (e.x < e.r || e.x > WORLD_W - e.r) e.vx *= -1;
    if (e.y > WORLD_H + e.r) {
      s.baseHp -= e.touch;
      e.hp = -1;
    }
  });

  s.bullets.forEach((b) => {
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.x <= b.radius || b.x >= WORLD_W - b.radius) {
      b.vx *= -1;
      b.leftBounce -= 1;
      if (s.flags.bounceRage) b.rage += 0.08;
    }
    if (b.y <= b.radius) {
      b.vy *= -1;
      b.leftBounce -= 1;
      if (s.flags.bounceRage) b.rage += 0.08;
    }
    if (b.y > WORLD_H + 20) b.leftBounce = -1;

    for (const enemy of s.enemies) {
      if (enemy.hp <= 0) continue;
      const hitDist = enemy.r + b.radius;
      const dx = enemy.x - b.x;
      const dy = enemy.y - b.y;
      if (dx * dx + dy * dy > hitDist * hitDist) continue;
      const mult = 1 + b.rage;
      const crit = Math.random() < s.stats.crit ? s.stats.critMul : 1;
      const killed = damageEnemy(s, enemy, b.damage * mult * crit);

      if (s.flags.blast) {
        s.enemies.forEach((other) => {
          if (other === enemy || other.hp <= 0) return;
          const d = Math.hypot(other.x - enemy.x, other.y - enemy.y);
          if (d < 84) damageEnemy(s, other, b.damage * 0.45);
        });
      }
      if (s.flags.arc) {
        const near = s.enemies
          .filter((other) => other !== enemy && other.hp > 0)
          .sort((a, c) => Math.hypot(a.x - enemy.x, a.y - enemy.y) - Math.hypot(c.x - enemy.x, c.y - enemy.y))
          .slice(0, 2);
        near.forEach((other) => damageEnemy(s, other, b.damage * 0.4));
      }

      const n = Math.hypot(dx, dy) || 1;
      const nx = dx / n;
      const ny = dy / n;
      const dot = b.vx * nx + b.vy * ny;
      b.vx -= 2 * dot * nx;
      b.vy -= 2 * dot * ny;
      b.leftBounce -= 1;
      if (!killed && b.leftPierce > 0) {
        b.leftPierce -= 1;
      } else {
        break;
      }
    }
  });

  s.drops.forEach((d) => {
    d.y += d.vy * dt;
    d.x += d.vx * dt;
    d.vx *= 0.98;
    d.vy *= 0.98;
    const dx = s.turret.x - d.x;
    const dy = s.turret.y - d.y;
    const dist = Math.hypot(dx, dy);
    if (dist < s.stats.pickupRange + 20) {
      d.vx += (dx / (dist || 1)) * 220 * dt;
      d.vy += (dy / (dist || 1)) * 220 * dt;
    }
    if (dist < 20) {
      if (d.type === "xp") {
        s.exp += d.value * s.stats.xpRate;
      } else {
        s.gold += d.value * s.stats.goldRate;
      }
      d.dead = true;
    }
  });

  s.effects.forEach((e) => {
    e.life -= dt * 1000;
    if (e.pulse) e.r += dt * 600;
  });

  s.enemies = s.enemies.filter((e) => e.hp > 0);
  s.bullets = s.bullets.filter((b) => b.leftBounce >= 0);
  s.drops = s.drops.filter((d) => !d.dead && d.y < WORLD_H + 30);
  s.effects = s.effects.filter((e) => e.life > 0);

  while (s.exp >= s.expNeed) {
    s.exp -= s.expNeed;
    s.level += 1;
    s.expNeed = levelCurve(s.level);
    showLevelUp(s);
  }

  if (s.baseHp <= 0) {
    s.running = false;
    ui.resultTitle.textContent = "基地被摧毁";
    ui.resultText.textContent = `你守到了第 ${s.wave} 波，建议优先拿强化反弹 + 资源磁吸快速成型。`;
    ui.resultModal.classList.remove("hidden");
  }
}

function render(s) {
  ctx.clearRect(0, 0, WORLD_W, WORLD_H);
  const g = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  g.addColorStop(0, "#0a1430");
  g.addColorStop(1, "#09111d");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let y = 40; y < WORLD_H; y += 80) ctx.fillRect(0, y, WORLD_W, 1);

  ctx.fillStyle = "#2a3f70";
  ctx.fillRect(0, BASE_Y + 40, WORLD_W, WORLD_H - BASE_Y);

  const t = s.turret;
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(t.angle + Math.PI / 2);
  ctx.fillStyle = "#f7c67a";
  ctx.fillRect(-12, -36, 24, 52);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(t.x, t.y, 26, 0, Math.PI * 2);
  ctx.fillStyle = "#88ccff";
  ctx.fill();

  s.bullets.forEach((b) => {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.fillStyle = s.turret.mode === "pierce" ? "#ffd36f" : "#9de8ff";
    ctx.fill();
  });

  s.enemies.forEach((e) => {
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
    ctx.fillStyle = e.color;
    ctx.fill();
    const barW = e.r * 1.6;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(e.x - barW / 2, e.y - e.r - 12, barW, 5);
    ctx.fillStyle = "#76f5ff";
    ctx.fillRect(e.x - barW / 2, e.y - e.r - 12, barW * clamp(e.hp / e.maxHp, 0, 1), 5);
  });

  s.drops.forEach((d) => {
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fillStyle = d.type === "xp" ? "#76f6c8" : "#ffd871";
    ctx.fill();
  });

  s.effects.forEach((e) => {
    if (e.pulse) {
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(120,220,255,${clamp(1 - e.r / 430, 0, 1)})`;
      ctx.lineWidth = 5;
      ctx.stroke();
      return;
    }
    ctx.fillStyle = `rgba(255,230,180,${clamp(e.life / 220, 0, 1)})`;
    ctx.fillText(e.text, e.x, e.y);
  });

  if (!s.turret.firing) {
    ctx.fillStyle = "rgba(220,238,255,0.85)";
    ctx.font = "24px sans-serif";
    ctx.fillText("点击战场启动自动开火", WORLD_W / 2 - 120, BASE_Y - 120);
  }
}

function syncHud(s) {
  ui.wave.textContent = `波次 ${s.wave}`;
  ui.hp.textContent = `基地 ${Math.max(0, Math.ceil(s.baseHp))}/${s.maxBaseHp}`;
  ui.gold.textContent = `金币 ${Math.floor(s.gold)}`;
  ui.level.textContent = `Lv${s.level}  EXP ${Math.floor(s.exp)}/${s.expNeed}`;
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
  return {
    x: clamp((clientX - rect.left - x) / scale, 0, WORLD_W),
    y: clamp((clientY - rect.top - y) / scale, 0, WORLD_H),
  };
}

let last = 0;
function loop(ts) {
  const dt = Math.min(0.033, (ts - last) / 1000 || 0.016);
  last = ts;
  update(dt, state);
  render(state);
  syncHud(state);
  requestAnimationFrame(loop);
}

function bindEvents() {
  const onPointer = (event) => {
    const p = screenToWorld(event.clientX, event.clientY);
    state.mouse = p;
  };
  canvas.addEventListener("pointerdown", (event) => {
    onPointer(event);
    state.turret.firing = true;
  });
  canvas.addEventListener("pointermove", onPointer);
  window.addEventListener("keydown", (event) => {
    if (event.code === "KeyQ" || event.code === "KeyE") {
      state.turret.mode = state.turret.mode === "normal" ? "pierce" : "normal";
    }
    if (event.code === "Space") {
      event.preventDefault();
      skillPulse(state);
    }
  });

  ui.restart.addEventListener("click", resetGame);
  ui.resultRestart.addEventListener("click", resetGame);
  ui.skipShop.addEventListener("click", () => closeShop(state));
  window.addEventListener("resize", resizeCanvas);
}

function resetGame() {
  state = createState();
  ui.resultModal.classList.add("hidden");
  ui.levelModal.classList.add("hidden");
  ui.shopModal.classList.add("hidden");
  resizeCanvas();
  syncHud(state);
}

resetGame();
bindEvents();
requestAnimationFrame(loop);
