import { TowerForgeGame } from "./game/Game.js";

const refs = {
  goldValue: document.getElementById("gold-value"),
  expValue: document.getElementById("exp-value"),
  levelValue: document.getElementById("level-value"),
  coreValue: document.getElementById("core-value"),
  waveValue: document.getElementById("wave-value"),
  buildHint: document.getElementById("build-hint"),
  phasePill: document.getElementById("phase-pill"),
  buildButtons: document.getElementById("build-buttons"),
  startWaveBtn: document.getElementById("start-wave-btn"),
  pauseBtn: document.getElementById("pause-btn"),
  restartBtn: document.getElementById("restart-btn"),
  speed1xBtn: document.getElementById("speed-1x-btn"),
  speed2xBtn: document.getElementById("speed-2x-btn"),
  waveSummary: document.getElementById("wave-summary"),
  prepTimer: document.getElementById("prep-timer"),
  growthPreview: document.getElementById("growth-preview"),
  buildSummary: document.getElementById("build-summary"),
  perkList: document.getElementById("perk-list"),
  relicList: document.getElementById("relic-list"),
  selectionActionOverlay: document.getElementById("selection-action-overlay"),
  enemyHpBaseInput: document.getElementById("enemy-hp-base-input"),
  enemyHpGrowthInput: document.getElementById("enemy-hp-growth-input"),
  enemySpeedBaseInput: document.getElementById("enemy-speed-base-input"),
  enemySpeedGrowthInput: document.getElementById("enemy-speed-growth-input"),
  enemySpawnBaseInput: document.getElementById("enemy-spawn-base-input"),
  enemySpawnGrowthInput: document.getElementById("enemy-spawn-growth-input"),
  enemyArmorGrowthInput: document.getElementById("enemy-armor-growth-input"),
  eliteHpMultInput: document.getElementById("elite-hp-mult-input"),
  bossHpMultInput: document.getElementById("boss-hp-mult-input"),
  applyGrowthBtn: document.getElementById("apply-growth-btn"),
  applyGrowthResetBtn: document.getElementById("apply-growth-reset-btn"),
  selectionPanel: document.getElementById("selection-panel"),
  upgradeBtn: document.getElementById("upgrade-btn"),
  sellBtn: document.getElementById("sell-btn"),
  overclockBtn: document.getElementById("overclock-btn"),
  upcomingWavePanel: document.getElementById("upcoming-wave-panel"),
  eventLog: document.getElementById("event-log"),
  modalRoot: document.getElementById("modal-root"),
  modalTag: document.getElementById("modal-tag"),
  modalTitle: document.getElementById("modal-title"),
  modalBody: document.getElementById("modal-body"),
  modalOptions: document.getElementById("modal-options"),
};

const canvas = document.getElementById("game-canvas");
const game = new TowerForgeGame(canvas, refs);

const fillBalanceInputs = () => {
  const config = game.getBalanceConfig();
  refs.enemyHpBaseInput.value = config.enemyHpBaseMult.toFixed(2);
  refs.enemyHpGrowthInput.value = Math.round(config.enemyHpGrowthPerWave * 100);
  refs.enemySpeedBaseInput.value = config.enemySpeedBaseMult.toFixed(2);
  refs.enemySpeedGrowthInput.value = (config.enemySpeedGrowthPerWave * 100).toFixed(1);
  refs.enemySpawnBaseInput.value = config.spawnIntervalBaseMult.toFixed(2);
  refs.enemySpawnGrowthInput.value = (config.spawnIntervalReductionPerWave * 100).toFixed(1);
  refs.enemyArmorGrowthInput.value = config.armorGrowthPerWave.toFixed(3);
  refs.eliteHpMultInput.value = config.eliteHpMult.toFixed(2);
  refs.bossHpMultInput.value = config.bossHpMult.toFixed(2);
};

const readBalanceInputs = () => ({
  enemyHpBaseMult: Number(refs.enemyHpBaseInput.value),
  enemyHpGrowthPerWave: Number(refs.enemyHpGrowthInput.value) / 100,
  enemySpeedBaseMult: Number(refs.enemySpeedBaseInput.value),
  enemySpeedGrowthPerWave: Number(refs.enemySpeedGrowthInput.value) / 100,
  spawnIntervalBaseMult: Number(refs.enemySpawnBaseInput.value),
  spawnIntervalReductionPerWave: Number(refs.enemySpawnGrowthInput.value) / 100,
  armorGrowthPerWave: Number(refs.enemyArmorGrowthInput.value),
  eliteHpMult: Number(refs.eliteHpMultInput.value),
  bossHpMult: Number(refs.bossHpMultInput.value),
});

refs.applyGrowthBtn.addEventListener("click", () => {
  game.applyBalanceConfig(readBalanceInputs());
  fillBalanceInputs();
});

refs.applyGrowthResetBtn.addEventListener("click", () => {
  game.applyBalanceConfig(readBalanceInputs());
  fillBalanceInputs();
  game.reset();
});

refs.modalOptions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-choice-index]");
  if (!button) return;
  const overlay = game.activeOverlay();
  const option = overlay?.options?.[Number(button.dataset.choiceIndex)];
  if (option?.restart) {
    game.reset();
    return;
  }
  game.pickOverlayOption(Number(button.dataset.choiceIndex));
});

fillBalanceInputs();
game.start();
