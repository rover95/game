import { BUILDING_LIST, BUILDING_TYPES, ATTACK_BUILDINGS } from "../data/buildings.js";
import { ENEMY_TYPES } from "../data/enemies.js";
import { BUILD_SET, PATH_POINTS, PICKUP_TARGET } from "../data/map.js";
import { PLAYER_PERKS, RELICS } from "../data/rewards.js";
import { WAVES } from "../data/waves.js";
import {
  CANVAS_WIDTH,
  CORE_MAX_HP,
  DEFAULT_MODIFIERS,
  MAX_LOG_ITEMS,
  PREP_DURATION,
  SELL_RATIO,
  STARTING_GOLD,
  TILE_SIZE,
  TOTAL_WAVES,
} from "./constants.js";
import { drawGame } from "./render.js";
import { GameUI } from "./ui.js";
import {
  chance,
  clamp,
  cellCenter,
  describeModifier,
  distance,
  keyOfCell,
  sampleWithoutReplacement,
  squaredDistance,
  worldToCell,
} from "./utils.js";

const nextId = (() => {
  let value = 1;
  return (prefix) => `${prefix}-${value += 1}`;
})();

const FX_TIME = {
  hit: 0.18,
  arc: 0.16,
  boom: 0.32,
  cone: 0.14,
  ground: 4.2,
};

const isStatused = (enemy) => (
  enemy.status.burn.stacks > 0
  || enemy.status.slow.remaining > 0
  || enemy.status.shred.remaining > 0
  || enemy.stalledBy
);

const normalizeAngle = (angle) => {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
};

const expNeeded = (level) => Math.round(42 + level * 28 + level * level * 5);
const BALANCE_STORAGE_KEY = "tower-forge-balance-v1";
const DEFAULT_BALANCE_CONFIG = {
  enemyHpBaseMult: 1,
  enemyHpGrowthPerWave: 0,
  enemySpeedBaseMult: 1,
  enemySpeedGrowthPerWave: 0,
  spawnIntervalBaseMult: 1,
  spawnIntervalReductionPerWave: 0,
  armorGrowthPerWave: 0,
  eliteHpMult: 1,
  bossHpMult: 1,
};

export class TowerForgeGame {
  constructor(canvas, refs) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.totalWaves = TOTAL_WAVES;
    this.buildCatalog = BUILDING_LIST;
    this.buildingTypes = BUILDING_TYPES;
    this.enemyTypes = ENEMY_TYPES;
    this.perkPool = PLAYER_PERKS;
    this.relicPool = RELICS;
    this.balanceConfig = this.loadBalanceConfig();
    this.state = this.createState();
    this.ui = new GameUI(this, refs);
    this.bindCanvas();
  }

  createState() {
    return {
      gold: STARTING_GOLD,
      exp: 0,
      expToNext: expNeeded(1),
      level: 1,
      coreHp: CORE_MAX_HP,
      maxCoreHp: CORE_MAX_HP,
      phase: "prep",
      prepRemaining: PREP_DURATION,
      waveIndex: 0,
      elapsed: 0,
      timeScale: 1,
      manualPause: false,
      selectedBuildTypeId: "crossbow",
      selectedBuildingId: null,
      buildings: [],
      enemies: [],
      projectiles: [],
      pickups: [],
      effects: [],
      groundEffects: [],
      spawnQueue: [],
      pendingOverlays: [],
      overlay: null,
      acquiredPerks: [],
      acquiredRelics: [],
      modifiers: { ...DEFAULT_MODIFIERS },
      traits: new Set(),
      log: ["建立第一道火力网，准备迎接第 1 波。"],
      spentGoldTracker: 0,
      overclockCharges: 0,
      result: null,
    };
  }

  start() {
    this.lastFrame = performance.now();
    this.ui.render();
    requestAnimationFrame((time) => this.frame(time));
  }

  reset() {
    this.state = this.createState();
    this.lastFrame = performance.now();
    this.ui.render();
  }

  loadBalanceConfig() {
    try {
      const raw = window.localStorage.getItem(BALANCE_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_BALANCE_CONFIG };
      return { ...DEFAULT_BALANCE_CONFIG, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_BALANCE_CONFIG };
    }
  }

  saveBalanceConfig() {
    try {
      window.localStorage.setItem(BALANCE_STORAGE_KEY, JSON.stringify(this.balanceConfig));
    } catch {
      // ignore persistence errors
    }
  }

  bindCanvas() {
    this.canvas.addEventListener("click", (event) => this.onCanvasClick(event));
  }

  frame(time) {
    const dt = Math.min(0.05, (time - this.lastFrame) / 1000);
    this.lastFrame = time;
    if (!this.state.manualPause && !this.hasBlockingOverlay() && !["defeat", "victory"].includes(this.state.phase)) {
      const scaled = dt * this.state.timeScale;
      this.update(scaled);
      this.state.elapsed += scaled;
    }
    drawGame(this.ctx, this);
    this.ui.render();
    requestAnimationFrame((next) => this.frame(next));
  }

  update(dt) {
    this.updateEffects(dt);
    this.updateGroundEffects(dt);
    this.updatePickups(dt);

    if (this.state.phase === "prep") {
      this.state.prepRemaining -= dt;
      if (this.state.prepRemaining <= 0) this.startWave();
      return;
    }

    if (this.state.phase !== "combat") return;
    this.spawnEnemies(dt);
    this.updateBuildings(dt);
    this.updateProjectiles(dt);
    this.updateEnemies(dt);
    if (this.state.phase === "combat" && this.state.spawnQueue.length === 0 && this.state.enemies.length === 0) {
      this.completeWave();
    }
  }

  updateEffects(dt) {
    this.state.effects = this.state.effects.filter((effect) => {
      effect.life -= dt;
      return effect.life > 0;
    });
  }

  updateGroundEffects(dt) {
    this.state.groundEffects = this.state.groundEffects.filter((effect) => {
      effect.life -= dt;
      effect.tick -= dt;
      if (effect.tick <= 0) {
        effect.tick += effect.interval;
        this.state.enemies.forEach((enemy) => {
          if (distance(effect, enemy.position) <= effect.radius) {
            this.damageEnemy(enemy, effect.damage, { area: true, sourceType: "flamethrower", canCrit: false });
            this.applyBurn(enemy, 1, effect.burnDps, 1.5);
          }
        });
      }
      return effect.life > 0;
    });
  }

  updatePickups(dt) {
    const radius = 110 + this.state.modifiers.pickupRadiusBonus;
    const speed = 180 * this.state.modifiers.pickupSpeedMult;
    this.state.pickups = this.state.pickups.filter((pickup) => {
      pickup.age += dt;
      const dx = PICKUP_TARGET.x - pickup.x;
      const dy = PICKUP_TARGET.y - pickup.y;
      const dist = Math.hypot(dx, dy);
      if (dist < radius * (pickup.age > 0.4 ? 2 : 1) || pickup.age > 1.2) {
        pickup.x += dx / Math.max(dist, 0.0001) * speed * dt;
        pickup.y += dy / Math.max(dist, 0.0001) * speed * dt;
      } else {
        pickup.y += Math.sin(pickup.age * 4 + pickup.seed) * 6 * dt;
      }
      if (dist < 18) {
        if (pickup.kind === "gold") this.state.gold += pickup.value;
        else this.addExp(pickup.value);
        return false;
      }
      return true;
    });
  }

  currentWave() {
    return WAVES[this.state.waveIndex] ?? null;
  }

  getEffectiveWaveScaling(wave = this.currentWave()) {
    if (!wave) {
      return {
        hpScale: 1,
        speedScale: 1,
        spawnIntervalScale: 1,
        armorBonus: 0,
        eliteHpMult: 1,
        bossHpMult: 1,
      };
    }
    const waveOffset = Number.isFinite(wave.id) ? wave.id - 1 : this.state.waveIndex;
    return {
      hpScale: wave.hpScale * this.balanceConfig.enemyHpBaseMult * (1 + this.balanceConfig.enemyHpGrowthPerWave * waveOffset),
      speedScale: wave.speedScale * this.balanceConfig.enemySpeedBaseMult * (1 + this.balanceConfig.enemySpeedGrowthPerWave * waveOffset),
      spawnIntervalScale: clamp(
        this.balanceConfig.spawnIntervalBaseMult * (1 - this.balanceConfig.spawnIntervalReductionPerWave * waveOffset),
        0.28,
        3,
      ),
      armorBonus: this.balanceConfig.armorGrowthPerWave * waveOffset,
      eliteHpMult: this.balanceConfig.eliteHpMult,
      bossHpMult: this.balanceConfig.bossHpMult,
    };
  }

  getBalanceConfig() {
    return { ...this.balanceConfig };
  }

  applyBalanceConfig(nextConfig) {
    this.balanceConfig = {
      enemyHpBaseMult: clamp(Number(nextConfig.enemyHpBaseMult) || 1, 0.2, 20),
      enemyHpGrowthPerWave: clamp(Number(nextConfig.enemyHpGrowthPerWave) || 0, 0, 1),
      enemySpeedBaseMult: clamp(Number(nextConfig.enemySpeedBaseMult) || 1, 0.2, 4),
      enemySpeedGrowthPerWave: clamp(Number(nextConfig.enemySpeedGrowthPerWave) || 0, 0, 0.5),
      spawnIntervalBaseMult: clamp(Number(nextConfig.spawnIntervalBaseMult) || 1, 0.2, 3),
      spawnIntervalReductionPerWave: clamp(Number(nextConfig.spawnIntervalReductionPerWave) || 0, 0, 0.2),
      armorGrowthPerWave: clamp(Number(nextConfig.armorGrowthPerWave) || 0, 0, 0.08),
      eliteHpMult: clamp(Number(nextConfig.eliteHpMult) || 1, 0.2, 10),
      bossHpMult: clamp(Number(nextConfig.bossHpMult) || 1, 0.2, 20),
    };
    this.saveBalanceConfig();
    this.pushLog("已更新怪物成长配置");
  }

  getWavePressurePreview(wave = this.currentWave()) {
    const scaling = this.getEffectiveWaveScaling(wave);
    return {
      hp: `生命 x${scaling.hpScale.toFixed(2)}`,
      speed: `速度 x${scaling.speedScale.toFixed(2)}`,
      spawn: `刷新 x${scaling.spawnIntervalScale.toFixed(2)}`,
      armor: `护甲 +${scaling.armorBonus.toFixed(2)}`,
    };
  }

  getPhaseLabel() {
    return {
      prep: "准备阶段",
      combat: "战斗阶段",
      defeat: "防线崩溃",
      victory: "守住核心",
    }[this.state.phase] ?? "选择中";
  }

  startWaveManually() {
    if (this.state.phase === "prep" && !this.hasBlockingOverlay()) this.startWave();
  }

  startWave() {
    const wave = this.currentWave();
    if (!wave) return;
    this.state.phase = "combat";
    this.state.spawnQueue = this.buildSpawnQueue(wave);
    this.state.overclockCharges = this.state.modifiers.overclockChargesPerWave;
    this.pushLog(`第 ${wave.id} 波开始: ${wave.name}`);
  }

  buildSpawnQueue(wave) {
    const scaling = this.getEffectiveWaveScaling(wave);
    return wave.entries.flatMap((entry) => Array.from({ length: entry.count }, (_, index) => ({
      enemyId: entry.enemyId,
      time: entry.start * scaling.spawnIntervalScale + entry.interval * scaling.spawnIntervalScale * index,
    }))).sort((a, b) => a.time - b.time);
  }

  spawnEnemies(dt) {
    const wave = this.currentWave();
    if (!wave) return;
    this.state.spawnQueue.forEach((spawn) => { spawn.time -= dt; });
    while (this.state.spawnQueue[0] && this.state.spawnQueue[0].time <= 0) {
      const spawn = this.state.spawnQueue.shift();
      this.state.enemies.push(this.createEnemy(spawn.enemyId, wave));
    }
  }

  createEnemy(enemyId, wave, inherited = null) {
    const template = this.enemyTypes[enemyId];
    const scaling = this.getEffectiveWaveScaling(wave);
    const hpScale = inherited?.hpScale ?? scaling.hpScale;
    const speedScale = inherited?.speedScale ?? scaling.speedScale;
    const goldScale = inherited?.goldScale ?? wave.goldScale;
    const expScale = inherited?.expScale ?? wave.expScale;
    const armor = clamp(
      template.armor + scaling.armorBonus,
      0,
      0.85,
    );
    const rarityHpMult = template.boss ? scaling.bossHpMult : template.elite ? scaling.eliteHpMult : 1;
    return {
      id: nextId("enemy"),
      typeId: enemyId,
      template,
      hp: Math.round(template.hp * hpScale * rarityHpMult),
      maxHp: Math.round(template.hp * hpScale * rarityHpMult),
      speed: template.speed * speedScale * TILE_SIZE,
      armor,
      gold: Math.round(template.gold * goldScale),
      exp: Math.round(template.exp * expScale),
      segmentIndex: 0,
      segmentProgress: 0,
      distanceTravelled: 0,
      position: { ...PATH_POINTS[0] },
      scale: template.boss ? 1.18 : template.elite ? 1.08 : 1,
      attackCooldown: 0.8,
      stalledBy: null,
      status: {
        burn: { stacks: 0, maxStacks: 6, dps: 0, remaining: 0 },
        slow: { value: 0, remaining: 0 },
        shred: { stacks: 0, remaining: 0 },
      },
    };
  }

  updateEnemies(dt) {
    const killed = new Set();
    this.state.enemies.forEach((enemy) => {
      this.tickEnemyStatuses(enemy, dt);
      if (enemy.hp <= 0) {
        killed.add(enemy.id);
        return;
      }

      const barricade = this.findBarricadeTarget(enemy);
      if (barricade) {
        enemy.stalledBy = barricade.id;
        enemy.attackCooldown -= dt;
        if (enemy.attackCooldown <= 0) {
          enemy.attackCooldown = 0.8;
          barricade.hp -= enemy.template.contactDamage;
          if (barricade.hp <= 0) {
            this.state.buildings = this.state.buildings.filter((item) => item.id !== barricade.id);
            if (this.state.selectedBuildingId === barricade.id) this.state.selectedBuildingId = null;
            this.pushLog("路障被摧毁");
          }
        }
        return;
      }

      enemy.stalledBy = null;
      const move = enemy.speed * clamp(1 - enemy.status.slow.value, 0.18, 1) * dt;
      this.advanceEnemy(enemy, move);
      if (enemy.segmentIndex >= PATH_POINTS.length - 1) {
        this.hitCore(enemy);
        killed.add(enemy.id);
      }
    });
    this.state.enemies = this.state.enemies.filter((enemy) => !killed.has(enemy.id) && enemy.hp > 0);
  }

  advanceEnemy(enemy, moveDistance) {
    let remaining = moveDistance;
    while (remaining > 0 && enemy.segmentIndex < PATH_POINTS.length - 1) {
      const from = PATH_POINTS[enemy.segmentIndex];
      const to = PATH_POINTS[enemy.segmentIndex + 1];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const segmentLength = Math.hypot(dx, dy);
      const left = segmentLength - enemy.segmentProgress;
      const step = Math.min(left, remaining);
      enemy.segmentProgress += step;
      enemy.distanceTravelled += step;
      remaining -= step;
      const t = segmentLength === 0 ? 1 : enemy.segmentProgress / segmentLength;
      enemy.position = { x: from.x + dx * t, y: from.y + dy * t };
      if (enemy.segmentProgress >= segmentLength) {
        enemy.segmentIndex += 1;
        enemy.segmentProgress = 0;
        enemy.position = { ...to };
      }
    }
  }

  hitCore(enemy) {
    this.state.coreHp = Math.max(0, this.state.coreHp - enemy.template.coreDamage);
    this.pushLog(`${enemy.template.name} 突破防线，核心 -${enemy.template.coreDamage}`);
    if (this.state.coreHp <= 0) this.finishRun("defeat", `核心被摧毁，止步于第 ${this.state.waveIndex + 1} 波。`);
  }

  updateBuildings(dt) {
    this.state.buildings.forEach((building) => {
      building.cooldown -= dt;
      if (building.overclockRemaining > 0) building.overclockRemaining = Math.max(0, building.overclockRemaining - dt);
      if (building.typeId === "mine") {
        if (building.cooldown <= 0) {
          const stats = this.getComputedStats(building);
          building.cooldown += stats.interval;
          this.state.gold += stats.income;
          this.pushFx("circle", {
            x: cellCenter(building.cell).x,
            y: cellCenter(building.cell).y,
            radius: 24,
            fill: "rgba(255, 214, 107, 0.16)",
            stroke: "rgba(255, 214, 107, 0.6)",
          }, FX_TIME.hit);
        }
        return;
      }
      if (building.typeId === "beacon" || building.typeId === "barricade") return;
      if (building.cooldown > 0) return;
      this.fireBuilding(building);
    });
  }

  fireBuilding(building) {
    const stats = this.getComputedStats(building);
    const center = cellCenter(building.cell);
    if (building.typeId === "flamethrower") {
      const candidates = this.enemiesInRange(center, stats.rangePx);
      const primary = candidates.sort((a, b) => b.distanceTravelled - a.distanceTravelled)[0];
      if (!primary) return;
      const aimAngle = Math.atan2(primary.position.y - center.y, primary.position.x - center.x);
      const halfCone = (stats.coneAngle * Math.PI / 180) / 2;
      const targets = candidates
        .filter((enemy) => Math.abs(normalizeAngle(Math.atan2(enemy.position.y - center.y, enemy.position.x - center.x) - aimAngle)) <= halfCone);
      if (!targets.length) return;
      building.cooldown = stats.cooldown;
      targets.forEach((enemy) => {
        this.damageEnemy(enemy, stats.damage, { area: true, sourceType: building.typeId, canCrit: true });
        this.applyBurn(enemy, 1, stats.burnDps, stats.burnDuration);
      });
      this.pushFx("cone", {
        origin: center,
        radius: stats.rangePx,
        startAngle: aimAngle - halfCone,
        endAngle: aimAngle + halfCone,
        fill: "rgba(255, 138, 82, 0.18)",
      }, FX_TIME.cone);
      if (this.state.traits.has("flameTrail")) {
        const furthest = [...targets].sort((a, b) => b.distanceTravelled - a.distanceTravelled)[0];
        this.state.groundEffects.push({
          type: "circle",
          x: furthest.position.x,
          y: furthest.position.y,
          radius: 44 * this.state.modifiers.areaRadiusMult,
          damage: stats.damage * 0.42,
          burnDps: stats.burnDps,
          fill: "rgba(255, 136, 92, 0.14)",
          stroke: "rgba(255, 136, 92, 0.44)",
          life: FX_TIME.ground,
          maxLife: FX_TIME.ground,
          interval: 0.4,
          tick: 0.12,
        });
      }
      return;
    }

    if (building.typeId === "arc") {
      const primary = this.pickTarget(building, stats.rangePx);
      if (!primary) return;
      building.cooldown = stats.cooldown;
      const hits = this.collectArcTargets(primary, stats);
      hits.forEach((enemy, index) => {
        this.damageEnemy(enemy, stats.damage * (index === 0 ? 1 : 0.76), { area: true, sourceType: building.typeId, canCrit: true });
        if (index > 0) {
          this.pushFx("line", {
            from: hits[index - 1].position,
            to: enemy.position,
            color: "rgba(165, 147, 255, 0.9)",
            width: 3,
          }, FX_TIME.arc);
        }
      });
      this.pushFx("line", {
        from: center,
        to: primary.position,
        color: "rgba(165, 147, 255, 0.9)",
        width: 3.5,
      }, FX_TIME.arc);
      return;
    }

    const target = this.pickTarget(building, stats.rangePx);
    if (!target) return;
    building.cooldown = stats.cooldown;
    const angle = Math.atan2(target.position.y - center.y, target.position.x - center.x);
    this.state.projectiles.push({
      id: nextId("projectile"),
      sourceType: building.typeId,
      x: center.x,
      y: center.y,
      vx: Math.cos(angle) * stats.projectileSpeed,
      vy: Math.sin(angle) * stats.projectileSpeed,
      damage: stats.damage,
      radius: building.typeId === "machinegun" ? 4 : 6,
      color: building.typeId === "ice" ? "rgba(126, 203, 255, 0.95)" : "rgba(245, 236, 221, 0.95)",
      maxDistance: stats.rangePx + 60,
      travelled: 0,
      slow: stats.slow,
      slowDuration: stats.slowDuration,
      canCrit: true,
    });
  }

  collectArcTargets(primary, stats) {
    const picked = [primary];
    let current = primary;
    while (picked.length < Math.max(1, stats.chainCount)) {
      const next = this.state.enemies
        .filter((enemy) => !picked.some((item) => item.id === enemy.id))
        .filter((enemy) => distance(enemy.position, current.position) <= stats.chainRangePx)
        .sort((a, b) => a.distanceTravelled - b.distanceTravelled)[0];
      if (!next) break;
      picked.push(next);
      current = next;
    }
    if (this.state.traits.has("arcSlowedBonus")) {
      const slowed = this.state.enemies.find((enemy) => enemy.status.slow.remaining > 0 && !picked.some((item) => item.id === enemy.id));
      if (slowed) picked.push(slowed);
    }
    if (this.state.traits.has("arcFork")) {
      const fork = this.state.enemies.find((enemy) => !picked.some((item) => item.id === enemy.id) && distance(enemy.position, primary.position) <= stats.chainRangePx * 0.92);
      if (fork) {
        picked.push(fork);
        this.pushFx("line", {
          from: primary.position,
          to: fork.position,
          color: "rgba(130, 220, 255, 0.86)",
          width: 2.4,
        }, FX_TIME.arc);
      }
    }
    return picked;
  }

  updateProjectiles(dt) {
    const remove = new Set();
    this.state.projectiles.forEach((projectile) => {
      const dx = projectile.vx * dt;
      const dy = projectile.vy * dt;
      projectile.x += dx;
      projectile.y += dy;
      projectile.travelled += Math.hypot(dx, dy);
      const hit = this.state.enemies.find((enemy) => distance(enemy.position, projectile) <= enemy.template.size * enemy.scale + projectile.radius);
      if (hit) {
        this.damageEnemy(hit, projectile.damage, { sourceType: projectile.sourceType, canCrit: projectile.canCrit, area: false });
        if (projectile.sourceType === "ice") this.applySlow(hit, projectile.slow, projectile.slowDuration);
        if (projectile.sourceType === "machinegun" && this.state.traits.has("machinegunShred")) this.applyShred(hit, 1, 3.5);
        if (this.state.modifiers.projectileEchoChance > 0 && chance(this.state.modifiers.projectileEchoChance)) {
          const other = this.state.enemies.find((enemy) => enemy.id !== hit.id && distance(enemy.position, hit.position) <= 92);
          if (other) {
            this.damageEnemy(other, projectile.damage * 0.6, { sourceType: projectile.sourceType, canCrit: false, area: false });
            this.pushFx("line", { from: hit.position, to: other.position, color: "rgba(236, 246, 255, 0.72)", width: 2 }, FX_TIME.arc);
          }
        }
        remove.add(projectile.id);
      } else if (projectile.travelled >= projectile.maxDistance) {
        remove.add(projectile.id);
      }
    });
    this.state.projectiles = this.state.projectiles.filter((projectile) => !remove.has(projectile.id));
  }

  tickEnemyStatuses(enemy, dt) {
    if (enemy.status.burn.remaining > 0 && enemy.status.burn.stacks > 0) {
      enemy.status.burn.remaining -= dt;
      this.damageEnemy(enemy, enemy.status.burn.dps * enemy.status.burn.stacks * this.state.modifiers.burnDamageMult * dt, {
        sourceType: "burn",
        canCrit: false,
        area: true,
      });
      if (enemy.status.burn.remaining <= 0) {
        enemy.status.burn.stacks = 0;
        enemy.status.burn.dps = 0;
      }
    }
    if (enemy.status.slow.remaining > 0) {
      enemy.status.slow.remaining -= dt;
      if (enemy.status.slow.remaining <= 0) enemy.status.slow.value = 0;
    }
    if (enemy.status.shred.remaining > 0) {
      enemy.status.shred.remaining -= dt;
      if (enemy.status.shred.remaining <= 0) enemy.status.shred.stacks = 0;
    }
  }

  damageEnemy(enemy, amount, context = {}) {
    if (enemy.hp <= 0) return;
    let multiplier = this.state.modifiers.globalDamageMult;
    if (isStatused(enemy)) multiplier *= 1 + this.state.modifiers.statusDamageBonus;
    if (context.area && (enemy.status.slow.remaining > 0 || enemy.stalledBy)) multiplier *= 1 + this.state.modifiers.controlledAreaTakenBonus;
    if (this.state.traits.has("focusElite") && (enemy.template.elite || enemy.template.boss) && ["crossbow", "machinegun"].includes(context.sourceType)) {
      multiplier *= 1 + this.state.modifiers.focusEliteBonus;
    }
    const armor = clamp(enemy.armor - enemy.status.shred.stacks * 0.05, 0, 0.85);
    let value = amount * multiplier * (1 - armor);
    if (context.canCrit && chance(this.state.modifiers.critChance)) value *= this.state.modifiers.critDamage;
    enemy.hp -= value;
    if (enemy.hp <= 0) this.onEnemyKilled(enemy);
  }

  onEnemyKilled(enemy) {
    this.state.enemies = this.state.enemies.filter((item) => item.id !== enemy.id);
    this.spawnPickup("gold", enemy.gold + this.state.modifiers.killGoldFlat, enemy.position);
    this.spawnPickup("exp", enemy.exp, enemy.position);
    if (enemy.template.splitInto) {
      for (let index = 0; index < enemy.template.splitInto.count; index += 1) {
        const split = this.createEnemy(enemy.template.splitInto.id, { hpScale: 1, speedScale: 1, goldScale: 1, expScale: 1 }, { hpScale: 1, speedScale: 1, goldScale: 1, expScale: 1 });
        split.segmentIndex = enemy.segmentIndex;
        split.segmentProgress = enemy.segmentProgress;
        split.distanceTravelled = enemy.distanceTravelled;
        split.position = { x: enemy.position.x + (index === 0 ? -8 : 8), y: enemy.position.y + (index === 0 ? -10 : 10) };
        this.state.enemies.push(split);
      }
    }
    if (this.state.traits.has("frostNova") && enemy.status.slow.remaining > 0 && enemy.status.slow.value >= 0.5) {
      const radius = this.state.modifiers.frostNovaRadius * this.state.modifiers.areaRadiusMult;
      this.state.enemies.forEach((other) => {
        if (distance(other.position, enemy.position) <= radius) {
          this.damageEnemy(other, this.state.modifiers.frostNovaDamage, { area: true, sourceType: "ice", canCrit: false });
          this.applySlow(other, this.state.modifiers.frostNovaSlow, this.state.modifiers.frostNovaDuration);
        }
      });
      this.pushFx("circle", {
        x: enemy.position.x,
        y: enemy.position.y,
        radius,
        fill: "rgba(126, 203, 255, 0.12)",
        stroke: "rgba(126, 203, 255, 0.55)",
      }, FX_TIME.boom);
    }
  }

  applyBurn(enemy, stacks, dps, duration) {
    enemy.status.burn.stacks = Math.min(enemy.status.burn.maxStacks, enemy.status.burn.stacks + stacks);
    enemy.status.burn.dps = Math.max(enemy.status.burn.dps, dps);
    enemy.status.burn.remaining = Math.max(enemy.status.burn.remaining, duration);
    if (enemy.status.burn.stacks >= enemy.status.burn.maxStacks && this.state.traits.has("burnExplodes")) {
      this.triggerBurnExplosion(enemy);
      enemy.status.burn.stacks = 2;
    }
  }

  triggerBurnExplosion(enemy) {
    const radius = this.state.modifiers.burnExplosionRadius * this.state.modifiers.areaRadiusMult;
    this.state.enemies.forEach((other) => {
      if (distance(other.position, enemy.position) <= radius) {
        this.damageEnemy(other, this.state.modifiers.burnExplosionDamage, { area: true, sourceType: "flamethrower", canCrit: false });
      }
    });
    this.pushFx("circle", {
      x: enemy.position.x,
      y: enemy.position.y,
      radius,
      fill: "rgba(255, 138, 82, 0.16)",
      stroke: "rgba(255, 138, 82, 0.7)",
    }, FX_TIME.boom);
  }

  applySlow(enemy, amount, duration) {
    enemy.status.slow.value = Math.max(enemy.status.slow.value, clamp(amount + this.state.modifiers.slowPower, 0, 0.75));
    enemy.status.slow.remaining = Math.max(enemy.status.slow.remaining, duration);
  }

  applyShred(enemy, stacks, duration) {
    enemy.status.shred.stacks = Math.min(6, enemy.status.shred.stacks + stacks);
    enemy.status.shred.remaining = Math.max(enemy.status.shred.remaining, duration);
  }

  spawnPickup(kind, value, position) {
    this.state.pickups.push({
      id: nextId("pickup"),
      kind,
      value,
      x: position.x,
      y: position.y,
      age: 0,
      seed: Math.random() * Math.PI * 2,
    });
  }

  selectedBuilding() {
    return this.state.buildings.find((building) => building.id === this.state.selectedBuildingId) ?? null;
  }

  selectBuildType(typeId) {
    this.state.selectedBuildTypeId = this.state.selectedBuildTypeId === typeId ? null : typeId;
  }

  onCanvasClick(event) {
    if (this.hasBlockingOverlay()) return;
    const rect = this.canvas.getBoundingClientRect();
    const point = {
      x: (event.clientX - rect.left) * (CANVAS_WIDTH / rect.width),
      y: (event.clientY - rect.top) * (this.canvas.height / rect.height),
    };
    const cell = worldToCell(point);
    const key = keyOfCell(cell.x, cell.y);
    const existing = this.state.buildings.find((item) => item.cell.x === cell.x && item.cell.y === cell.y);
    if (existing) {
      this.state.selectedBuildingId = existing.id;
      return;
    }
    if (!BUILD_SET.has(key)) {
      this.state.selectedBuildingId = null;
      return;
    }
    if (this.state.selectedBuildTypeId) this.buildOnCell(cell, this.state.selectedBuildTypeId);
  }

  buildOnCell(cell, typeId) {
    const config = this.buildingTypes[typeId];
    if (!config) return;
    if (this.state.gold < config.buildCost) {
      this.pushLog(`${config.name} 需要 ${config.buildCost} 金币`);
      return;
    }
    this.spendGold(config.buildCost);
    const building = {
      id: nextId("building"),
      typeId,
      cell,
      level: 0,
      cooldown: 0.15,
      spentGold: config.buildCost,
      hp: config.levels[0].maxHp ?? 0,
      maxHp: config.levels[0].maxHp ?? 0,
      overclockRemaining: 0,
    };
    this.state.buildings.push(building);
    this.state.selectedBuildingId = building.id;
    this.pushLog(`建造 ${config.name}`);
  }

  spendGold(amount) {
    this.state.gold -= amount;
    this.state.spentGoldTracker += amount;
    const threshold = this.state.modifiers.spendDamageThreshold;
    if (threshold > 0 && this.state.modifiers.spendDamageGain > 0) {
      while (this.state.spentGoldTracker >= threshold) {
        this.state.spentGoldTracker -= threshold;
        this.state.modifiers.globalDamageMult *= 1 + this.state.modifiers.spendDamageGain;
        this.pushLog(`金币熔炉触发，全体建筑伤害 ${describeModifier(this.state.modifiers.spendDamageGain)}`);
      }
    }
  }

  canUpgradeSelected() {
    const building = this.selectedBuilding();
    if (!building) return false;
    const cost = this.buildingTypes[building.typeId].levels[building.level]?.upgradeCost;
    return !!cost && this.state.gold >= cost;
  }

  upgradeSelectedBuilding() {
    const building = this.selectedBuilding();
    if (!building) return;
    const config = this.buildingTypes[building.typeId];
    const cost = config.levels[building.level]?.upgradeCost;
    if (!cost) {
      this.pushLog("该建筑已满级");
      return;
    }
    if (this.state.gold < cost) {
      this.pushLog(`升级需要 ${cost} 金币`);
      return;
    }
    this.spendGold(cost);
    building.level += 1;
    building.spentGold += cost;
    if (config.levels[building.level].maxHp) {
      building.maxHp = config.levels[building.level].maxHp;
      building.hp = Math.max(building.hp, building.maxHp);
    }
    this.pushLog(`${config.name} 升至 Lv.${building.level + 1}`);
  }

  sellSelectedBuilding() {
    const building = this.selectedBuilding();
    if (!building) return;
    const value = Math.round(building.spentGold * SELL_RATIO);
    this.state.gold += value;
    this.state.buildings = this.state.buildings.filter((item) => item.id !== building.id);
    this.state.selectedBuildingId = null;
    this.pushLog(`出售 ${this.buildingTypes[building.typeId].name}，返还 ${value} 金币`);
  }

  canOverclockSelected() {
    const building = this.selectedBuilding();
    return !!building && ATTACK_BUILDINGS.has(building.typeId) && this.state.traits.has("overclock") && this.state.overclockCharges > 0;
  }

  activateOverclock() {
    const building = this.selectedBuilding();
    if (!this.canOverclockSelected() || !building) return;
    building.overclockRemaining = this.state.modifiers.overclockDuration;
    this.state.overclockCharges -= 1;
    this.pushLog(`${this.buildingTypes[building.typeId].name} 获得超频强化`);
  }

  getComputedStats(building) {
    const config = this.buildingTypes[building.typeId];
    const base = config.levels[building.level];
    const center = cellCenter(building.cell);
    const diversity = new Set(this.state.buildings.filter((item) => ATTACK_BUILDINGS.has(item.typeId)).map((item) => item.typeId)).size;
    const adjacency = this.state.buildings.filter((other) => other.id !== building.id)
      .filter((other) => Math.abs(other.cell.x - building.cell.x) <= 1 && Math.abs(other.cell.y - building.cell.y) <= 1).length;
    const beaconBuff = this.state.buildings
      .filter((other) => other.typeId === "beacon" && other.id !== building.id)
      .reduce((sum, other) => {
        const aura = this.buildingTypes.beacon.levels[other.level];
        if (distance(cellCenter(other.cell), center) > aura.auraRange * TILE_SIZE) return sum;
        return {
          damage: sum.damage + aura.damageBuff * this.state.modifiers.beaconEffectMult,
          speed: sum.speed + aura.speedBuff * this.state.modifiers.beaconEffectMult,
        };
      }, { damage: 0, speed: 0 });
    const damageMult = ATTACK_BUILDINGS.has(building.typeId)
      ? (1 + this.state.modifiers.adjacencyDamagePerNeighbor * adjacency + this.state.modifiers.diversityDamagePerType * diversity + beaconBuff.damage)
        * (building.overclockRemaining > 0 ? this.state.modifiers.overclockDamageMult : 1)
      : 1;
    const speedMult = ATTACK_BUILDINGS.has(building.typeId)
      ? this.state.modifiers.attackSpeedMult * (1 + beaconBuff.speed) * (building.overclockRemaining > 0 ? this.state.modifiers.overclockSpeedMult : 1)
      : 1;
    return {
      ...base,
      income: base.income ? Math.round(base.income * this.state.modifiers.mineGoldMult) : undefined,
      damage: base.damage ? base.damage * damageMult : undefined,
      cooldown: base.cooldown ? base.cooldown / speedMult : base.interval,
      interval: base.interval,
      rangePx: base.range ? base.range * TILE_SIZE * (building.typeId === "flamethrower" ? this.state.modifiers.flameRangeMult : 1) : 0,
      projectileSpeed: base.projectileSpeed ?? 0,
      burnDps: base.burnDps ?? 0,
      burnDuration: base.burnDuration ?? 0,
      coneAngle: base.coneAngle ?? 0,
      slow: base.slow ?? 0,
      slowDuration: base.slowDuration ?? 0,
      chainCount: (base.chainCount ?? 0) + this.state.modifiers.chainExtra,
      chainRangePx: (base.chainRange ?? 0) * TILE_SIZE * this.state.modifiers.chainRangeMult,
      tauntRangePx: base.tauntRange ? base.tauntRange * TILE_SIZE : 0,
      auraRangePx: base.auraRange ? base.auraRange * TILE_SIZE : 0,
    };
  }

  enemiesInRange(origin, rangePx) {
    const rangeSq = rangePx * rangePx;
    return this.state.enemies.filter((enemy) => squaredDistance(origin, enemy.position) <= rangeSq);
  }

  pickTarget(building, rangePx) {
    const origin = cellCenter(building.cell);
    const candidates = this.enemiesInRange(origin, rangePx);
    if (!candidates.length) return null;
    if (this.state.traits.has("focusElite") && ["crossbow", "machinegun"].includes(building.typeId)) {
      const elite = candidates.filter((enemy) => enemy.template.elite || enemy.template.boss).sort((a, b) => b.distanceTravelled - a.distanceTravelled)[0];
      if (elite) return elite;
    }
    return candidates.sort((a, b) => b.distanceTravelled - a.distanceTravelled)[0];
  }

  findBarricadeTarget(enemy) {
    return this.state.buildings
      .filter((building) => building.typeId === "barricade" && building.hp > 0)
      .map((building) => ({ building, range: this.getComputedStats(building).tauntRangePx }))
      .find(({ building, range }) => distance(enemy.position, cellCenter(building.cell)) <= range)?.building ?? null;
  }

  addExp(amount) {
    this.state.exp += amount;
    while (this.state.exp >= this.state.expToNext) {
      this.state.exp -= this.state.expToNext;
      this.state.level += 1;
      this.state.expToNext = expNeeded(this.state.level);
      this.queueOverlay("perk");
      this.pushLog(`等级提升至 ${this.state.level}`);
    }
  }

  completeWave() {
    const wave = this.currentWave();
    if (!wave) return;
    const reward = Math.floor(wave.rewardGold * this.state.modifiers.waveRewardGoldMult);
    this.state.gold += reward;
    this.pushLog(`第 ${wave.id} 波完成，获得 ${reward} 波次金币`);
    if (this.state.waveIndex >= this.totalWaves - 1) {
      this.finishRun("victory", `全部 ${this.totalWaves} 波守住，核心剩余 ${Math.ceil(this.state.coreHp)} 点生命。`);
      return;
    }
    this.state.waveIndex += 1;
    this.state.phase = "prep";
    this.state.prepRemaining = PREP_DURATION;
    this.queueOverlay("relic");
  }

  queueOverlay(type) {
    this.state.pendingOverlays.push(type);
    this.maybeOpenOverlay();
  }

  maybeOpenOverlay() {
    if (this.state.overlay || this.state.pendingOverlays.length === 0 || ["defeat", "victory"].includes(this.state.phase)) return;
    const type = this.state.pendingOverlays.shift();
    if (type === "perk") {
      this.state.overlay = {
        type,
        tag: "Level Up",
        title: "选择 1 项玩家强化",
        body: "强化为本局永久效果。优先决定这局是贪经济、补控制还是继续放大已有流派。",
        options: sampleWithoutReplacement(this.perkPool, 3),
      };
    } else {
      const owned = new Set(this.state.acquiredRelics.map((item) => item.id));
      const pool = this.relicPool.filter((item) => !owned.has(item.id));
      if (!pool.length) return;
      this.state.overlay = {
        type,
        tag: "Relic Reward",
        title: "波次结束，选择 1 件饰品",
        body: "饰品会显著改变攻击逻辑、联动方式或资源节奏。",
        options: sampleWithoutReplacement(pool, Math.min(3, pool.length)),
      };
    }
  }

  activeOverlay() {
    return this.state.overlay;
  }

  hasBlockingOverlay() {
    return !!this.state.overlay;
  }

  pickOverlayOption(index) {
    const option = this.state.overlay?.options?.[index];
    if (!option) return;
    this.applyChoice(option);
    if (this.state.overlay.type === "perk") this.state.acquiredPerks.push(option);
    else this.state.acquiredRelics.push(option);
    this.pushLog(`获得${this.state.overlay.type === "perk" ? "强化" : "饰品"}: ${option.name}`);
    this.state.overlay = null;
    this.maybeOpenOverlay();
  }

  applyChoice(choice) {
    choice.effects.forEach((effect) => {
      if (effect.type === "add") this.state.modifiers[effect.key] += effect.value;
      else if (effect.type === "mul") this.state.modifiers[effect.key] *= effect.value;
      else if (effect.type === "set") this.state.modifiers[effect.key] = effect.value;
      else if (effect.type === "trait" && effect.value) this.state.traits.add(effect.key);
    });
    if (this.state.phase === "prep" && this.state.modifiers.overclockChargesPerWave > 0) {
      this.state.overclockCharges = Math.max(this.state.overclockCharges, this.state.modifiers.overclockChargesPerWave);
    }
  }

  togglePause() {
    this.state.manualPause = !this.state.manualPause;
  }

  setTimeScale(value) {
    this.state.timeScale = value;
  }

  finishRun(type, message) {
    this.state.phase = type;
    this.state.result = { message };
    this.state.overlay = {
      type,
      tag: type === "victory" ? "Victory" : "Game Over",
      title: type === "victory" ? "守住了全部波次" : "核心被摧毁",
      body: message,
      options: [{ name: "重新开始", category: "新一局", description: "点击后立即重新生成地图与波次。", restart: true, effects: [] }],
    };
  }

  pushFx(type, data, lifetime) {
    this.state.effects.push({ type, ...data, life: lifetime, maxLife: lifetime });
  }

  getBuildingPreview(building) {
    const config = this.buildingTypes[building.typeId];
    const stats = this.getComputedStats(building);
    const preview = {
      name: config.name,
      role: config.short,
      description: config.description,
      level: building.level + 1,
      upgradeCost: config.levels[building.level]?.upgradeCost ?? null,
      sellValue: Math.round(building.spentGold * SELL_RATIO),
      rangePx: stats.rangePx || stats.auraRangePx || stats.tauntRangePx || 0,
      overclocked: building.overclockRemaining > 0,
      stats: {},
    };
    if (building.typeId === "mine") preview.stats = { "产出": `${stats.income} 金币`, "周期": `${stats.interval.toFixed(1)} 秒` };
    else if (building.typeId === "beacon") preview.stats = { "范围": `${(stats.auraRangePx / TILE_SIZE).toFixed(1)} 格`, "伤害增益": `${Math.round(this.buildingTypes.beacon.levels[building.level].damageBuff * this.state.modifiers.beaconEffectMult * 100)}%`, "攻速增益": `${Math.round(this.buildingTypes.beacon.levels[building.level].speedBuff * this.state.modifiers.beaconEffectMult * 100)}%` };
    else if (building.typeId === "barricade") preview.stats = { "生命": `${Math.ceil(building.hp)} / ${building.maxHp}`, "拖延范围": `${(stats.tauntRangePx / TILE_SIZE).toFixed(1)} 格` };
    else {
      preview.stats = { "伤害": `${Math.round(stats.damage)}`, "攻速": `${(1 / stats.cooldown).toFixed(2)} / 秒`, "射程": `${(stats.rangePx / TILE_SIZE).toFixed(1)} 格` };
      if (building.typeId === "flamethrower") preview.stats["灼烧"] = `${Math.round(stats.burnDps)} / 秒`;
      if (building.typeId === "arc") preview.stats["连锁"] = `${stats.chainCount} 次`;
      if (building.typeId === "ice") preview.stats["减速"] = `${Math.round(stats.slow * 100)}%`;
    }
    return preview;
  }

  pushLog(text) {
    this.state.log.unshift(text);
    this.state.log = this.state.log.slice(0, MAX_LOG_ITEMS);
  }
}
