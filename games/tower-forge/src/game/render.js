import { BUILD_CELLS, CORE_CELL, PATH_CELLS, PATH_POINTS, PICKUP_TARGET, SPAWN_CELL } from "../data/map.js";
import { COLORS, GRID_OFFSET_X, GRID_OFFSET_Y, TILE_SIZE } from "./constants.js";
import { cellCenter, cellRect } from "./utils.js";

const drawEnemyShape = (ctx, enemy) => {
  const { x, y } = enemy.position;
  const r = enemy.template.size * enemy.scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = enemy.template.color;
  ctx.strokeStyle = enemy.template.edge;
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (enemy.template.shape === "circle") {
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  } else if (enemy.template.shape === "diamond") {
    ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath();
  } else if (enemy.template.shape === "square") {
    ctx.roundRect(-r, -r, r * 2, r * 2, 8);
  } else if (enemy.template.shape === "hex") {
    for (let index = 0; index < 6; index += 1) {
      const angle = Math.PI / 3 * index - Math.PI / 6;
      const px = Math.cos(angle) * r;
      const py = Math.sin(angle) * r;
      if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (enemy.template.shape === "star") {
    for (let index = 0; index < 10; index += 1) {
      const angle = Math.PI / 5 * index - Math.PI / 2;
      const radius = index % 2 === 0 ? r : r * 0.45;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else {
    ctx.roundRect(-r * 1.2, -r * 0.8, r * 2.4, r * 1.6, 16);
  }
  ctx.fill();
  ctx.stroke();

  const hpWidth = r * 2.3;
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(-hpWidth / 2, r + 8, hpWidth, 5);
  ctx.fillStyle = enemy.template.boss ? COLORS.danger : COLORS.success;
  ctx.fillRect(-hpWidth / 2, r + 8, hpWidth * (enemy.hp / enemy.maxHp), 5);
  if (enemy.template.boss || enemy.template.elite) {
    ctx.fillStyle = "#06121b";
    ctx.font = "700 14px Segoe UI";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(enemy.template.boss ? "B" : "E", 0, 0);
  }
  if (enemy.status.slow.remaining > 0) {
    ctx.strokeStyle = COLORS.slow;
    ctx.beginPath();
    ctx.arc(0, 0, r + 12, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
};

const drawBuilding = (ctx, game, building) => {
  const center = cellCenter(building.cell);
  const config = game.buildingTypes[building.typeId];
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.fillStyle = config.color;
  ctx.strokeStyle = "rgba(255,255,255,0.78)";
  ctx.lineWidth = 3;
  if (building.typeId === "mine") {
    ctx.beginPath(); ctx.roundRect(-20, -20, 40, 40, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#3a2504"; ctx.fillRect(-8, -10, 16, 20);
  } else if (building.typeId === "beacon") {
    ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(20, 8); ctx.lineTo(0, 24); ctx.lineTo(-20, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (building.typeId === "barricade") {
    ctx.beginPath(); ctx.roundRect(-22, -14, 44, 28, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#463121"; ctx.fillRect(-10, -8, 20, 16);
  } else {
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#08131d"; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "#08131d";
  ctx.font = "700 13px Segoe UI";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`L${building.level + 1}`, 0, 0);
  if (building.overclockRemaining > 0) {
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 28, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (building.typeId === "barricade") {
    const ratio = building.hp / building.maxHp;
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(-22, 26, 44, 5);
    ctx.fillStyle = ratio > 0.4 ? COLORS.success : COLORS.danger;
    ctx.fillRect(-22, 26, 44 * ratio, 5);
  }
  ctx.restore();
  if (game.state.selectedBuildingId === building.id) {
    const preview = game.getBuildingPreview(building);
    if (preview.rangePx > 0) {
      ctx.fillStyle = "rgba(120, 217, 255, 0.08)";
      ctx.strokeStyle = "rgba(120, 217, 255, 0.22)";
      ctx.beginPath();
      ctx.arc(center.x, center.y, preview.rangePx, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255, 210, 113, 0.8)";
    ctx.lineWidth = 3;
    ctx.strokeRect(center.x - 26, center.y - 26, 52, 52);
  }
};

const drawEffect = (ctx, effect) => {
  const alpha = Math.max(0, effect.life / effect.maxLife);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (effect.type === "line") {
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = effect.width;
    ctx.beginPath();
    ctx.moveTo(effect.from.x, effect.from.y);
    ctx.lineTo(effect.to.x, effect.to.y);
    ctx.stroke();
  } else if (effect.type === "circle") {
    ctx.fillStyle = effect.fill;
    ctx.strokeStyle = effect.stroke;
    ctx.beginPath();
    ctx.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (effect.type === "cone") {
    ctx.fillStyle = effect.fill;
    ctx.beginPath();
    ctx.moveTo(effect.origin.x, effect.origin.y);
    ctx.arc(effect.origin.x, effect.origin.y, effect.radius, effect.startAngle, effect.endAngle);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
};

export const drawGame = (ctx, game) => {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
  gradient.addColorStop(0, COLORS.bgTop);
  gradient.addColorStop(1, COLORS.bgBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x <= 14; x += 1) {
    ctx.beginPath();
    ctx.moveTo(GRID_OFFSET_X + x * TILE_SIZE, GRID_OFFSET_Y);
    ctx.lineTo(GRID_OFFSET_X + x * TILE_SIZE, GRID_OFFSET_Y + 9 * TILE_SIZE);
    ctx.stroke();
  }
  for (let y = 0; y <= 9; y += 1) {
    ctx.beginPath();
    ctx.moveTo(GRID_OFFSET_X, GRID_OFFSET_Y + y * TILE_SIZE);
    ctx.lineTo(GRID_OFFSET_X + 14 * TILE_SIZE, GRID_OFFSET_Y + y * TILE_SIZE);
    ctx.stroke();
  }

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(44, 28, 18, 0.92)";
  ctx.lineWidth = TILE_SIZE * 0.92;
  ctx.beginPath();
  ctx.moveTo(PATH_POINTS[0].x, PATH_POINTS[0].y);
  PATH_POINTS.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.stroke();

  ctx.strokeStyle = COLORS.pathCell;
  ctx.lineWidth = TILE_SIZE * 0.74;
  ctx.beginPath();
  ctx.moveTo(PATH_POINTS[0].x, PATH_POINTS[0].y);
  PATH_POINTS.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.stroke();

  ctx.strokeStyle = COLORS.pathCellEdge;
  ctx.lineWidth = TILE_SIZE * 0.08;
  ctx.beginPath();
  ctx.moveTo(PATH_POINTS[0].x, PATH_POINTS[0].y);
  PATH_POINTS.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.stroke();

  ctx.setLineDash([10, 14]);
  ctx.strokeStyle = "rgba(255, 220, 180, 0.26)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PATH_POINTS[0].x, PATH_POINTS[0].y);
  PATH_POINTS.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.stroke();
  ctx.restore();
  BUILD_CELLS.forEach((cell) => {
    const rect = cellRect(cell);
    ctx.beginPath(); ctx.roundRect(rect.x + 6, rect.y + 6, rect.w - 12, rect.h - 12, 10);
    ctx.fillStyle = COLORS.buildCell; ctx.fill();
    ctx.strokeStyle = COLORS.buildCellEdge; ctx.lineWidth = 2; ctx.stroke();
  });

  const spawnCenter = cellCenter(SPAWN_CELL);
  const coreCenter = cellCenter(CORE_CELL);
  ctx.fillStyle = COLORS.spawn;
  ctx.beginPath(); ctx.arc(spawnCenter.x, spawnCenter.y, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = COLORS.core;
  ctx.beginPath(); ctx.roundRect(coreCenter.x - 22, coreCenter.y - 22, 44, 44, 12); ctx.fill();

  game.state.groundEffects.forEach((effect) => drawEffect(ctx, effect));
  game.state.buildings.forEach((building) => drawBuilding(ctx, game, building));
  game.state.projectiles.forEach((projectile) => {
    ctx.fillStyle = projectile.color;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
    ctx.fill();
  });
  game.state.effects.forEach((effect) => drawEffect(ctx, effect));
  game.state.pickups.forEach((pickup) => {
    ctx.fillStyle = pickup.kind === "gold" ? COLORS.gold : COLORS.exp;
    ctx.beginPath();
    ctx.arc(pickup.x, pickup.y, pickup.kind === "gold" ? 7 : 6, 0, Math.PI * 2);
    ctx.fill();
  });
  game.state.enemies.forEach((enemy) => drawEnemyShape(ctx, enemy));

  ctx.fillStyle = COLORS.text;
  ctx.font = "700 14px Segoe UI";
  ctx.fillText("出生点", spawnCenter.x - 20, spawnCenter.y - 28);
  ctx.fillText("核心", coreCenter.x - 14, coreCenter.y - 30);
  ctx.fillText("掉落回收", PICKUP_TARGET.x - 56, PICKUP_TARGET.y - 14);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.roundRect(PICKUP_TARGET.x - 32, PICKUP_TARGET.y - 16, 64, 28, 12);
  ctx.fill();
};
