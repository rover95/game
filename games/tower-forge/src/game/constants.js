export const TILE_SIZE = 56;
export const GRID_COLS = 14;
export const GRID_ROWS = 9;
export const GRID_OFFSET_X = 20;
export const GRID_OFFSET_Y = 20;
export const CANVAS_WIDTH = GRID_OFFSET_X * 2 + GRID_COLS * TILE_SIZE;
export const CANVAS_HEIGHT = GRID_OFFSET_Y * 2 + GRID_ROWS * TILE_SIZE;
export const TOTAL_WAVES = 18;
export const PREP_DURATION = 18;
export const STARTING_GOLD = 165;
export const CORE_MAX_HP = 30;
export const BASE_CRIT_CHANCE = 0.05;
export const BASE_CRIT_DAMAGE = 1.5;
export const SELL_RATIO = 0.6;
export const MAX_LOG_ITEMS = 8;

export const DEFAULT_MODIFIERS = {
  mineGoldMult: 1,
  killGoldFlat: 0,
  waveRewardGoldMult: 1,
  attackSpeedMult: 1,
  critChance: BASE_CRIT_CHANCE,
  critDamage: BASE_CRIT_DAMAGE,
  burnDamageMult: 1,
  slowPower: 0,
  chainExtra: 0,
  statusDamageBonus: 0,
  areaRadiusMult: 1,
  chainRangeMult: 1,
  adjacencyDamagePerNeighbor: 0,
  beaconEffectMult: 1,
  diversityDamagePerType: 0,
  globalDamageMult: 1,
  controlledAreaTakenBonus: 0,
  flameRangeMult: 1,
  pickupSpeedMult: 1,
  pickupRadiusBonus: 0,
  spendDamageThreshold: 0,
  spendDamageGain: 0,
  projectileEchoChance: 0,
  focusEliteBonus: 0,
  overclockChargesPerWave: 0,
  overclockDamageMult: 1.8,
  overclockSpeedMult: 1.8,
  overclockDuration: 16,
  burnExplosionDamage: 48,
  burnExplosionRadius: 74,
  frostNovaDamage: 34,
  frostNovaRadius: 82,
  frostNovaSlow: 0.42,
  frostNovaDuration: 2.4,
};

export const COLORS = {
  bgTop: "#0b1724",
  bgBottom: "#07111a",
  grid: "rgba(255,255,255,0.05)",
  buildCell: "#17354d",
  buildCellEdge: "#4eb4ff",
  pathCell: "#5b4130",
  pathCellEdge: "#d19b6d",
  spawn: "#81d7ff",
  core: "#ff9074",
  text: "#e8f6ff",
  textMuted: "#98b6c7",
  burn: "#ff8a52",
  slow: "#86dcff",
  arc: "#9d99ff",
  success: "#89f0a0",
  danger: "#ff886f",
  gold: "#ffd66b",
  exp: "#87b6ff",
  accent: "#78d9ff",
};
