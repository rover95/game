import { cellCenter } from "./utils.js";

export class GameUI {
  constructor(game, refs) {
    this.game = game;
    this.refs = refs;
    this.buildButtonsSignature = "";
    this.modalSignature = "";
    this.bind();
  }

  bind() {
    const { refs, game } = this;
    refs.startWaveBtn.addEventListener("click", () => game.startWaveManually());
    refs.pauseBtn.addEventListener("click", () => game.togglePause());
    refs.restartBtn.addEventListener("click", () => game.reset());
    refs.upgradeBtn.addEventListener("click", () => game.upgradeSelectedBuilding());
    refs.sellBtn.addEventListener("click", () => game.sellSelectedBuilding());
    refs.overclockBtn.addEventListener("click", () => game.activateOverclock());
    refs.speed1xBtn.addEventListener("click", () => game.setTimeScale(1));
    refs.speed2xBtn.addEventListener("click", () => game.setTimeScale(2));
  }

  renderBuildButtons() {
    const { game, refs } = this;
    const signature = `${game.state.selectedBuildTypeId}|${Math.floor(game.state.gold)}`;
    if (signature === this.buildButtonsSignature) {
      return;
    }
    this.buildButtonsSignature = signature;
    refs.buildButtons.innerHTML = game.buildCatalog.map((building) => `
      <button
        class="build-button${game.state.selectedBuildTypeId === building.id ? " is-selected" : ""}"
        type="button"
        data-build-id="${building.id}"
        ${game.state.gold < building.buildCost && game.state.selectedBuildTypeId !== building.id ? "disabled" : ""}
        title="${building.description}"
      >
        <div class="build-button__title"><span>${building.name}</span><span>${building.buildCost}G</span></div>
        <div class="build-button__meta">${building.short}</div>
      </button>
    `).join("");
    refs.buildButtons.querySelectorAll("[data-build-id]").forEach((button) => {
      button.addEventListener("click", () => game.selectBuildType(button.dataset.buildId));
    });
  }

  renderSelection() {
    const { refs, game } = this;
    const building = game.selectedBuilding();
    if (!building) {
      refs.selectionPanel.innerHTML = '<p class="empty-state">点击地图中的建筑查看详情。</p>';
      return;
    }
    const detail = game.getBuildingPreview(building);
    refs.selectionPanel.innerHTML = `
      <h3 class="selection-title">${detail.name}</h3>
      <p class="selection-subtitle">Lv.${detail.level} / ${detail.role}</p>
      <p class="hint">${detail.description}</p>
      <div class="mini-list">
        <div class="selection-stat">建造格: (${building.cell.x + 1}, ${building.cell.y + 1})</div>
        <div class="selection-stat">升级费用: ${detail.upgradeCost ?? "已满级"}</div>
        <div class="selection-stat">出售返还: ${detail.sellValue}</div>
        ${detail.overclocked ? '<div class="selection-stat">状态: 超频中</div>' : ""}
        ${Object.entries(detail.stats).map(([key, value]) => `<div class="selection-stat">${key}: ${value}</div>`).join("")}
      </div>
    `;
  }

  renderSelectionActionOverlay() {
    const { refs, game } = this;
    const building = game.selectedBuilding();
    if (!building) {
      refs.selectionActionOverlay.classList.add("hidden");
      return;
    }

    const center = cellCenter(building.cell);
    const canvasRect = game.canvas.getBoundingClientRect();
    const panelRect = refs.selectionActionOverlay.parentElement.getBoundingClientRect();
    const scaleX = canvasRect.width / game.canvas.width;
    const scaleY = canvasRect.height / game.canvas.height;
    const x = canvasRect.left - panelRect.left + center.x * scaleX;
    const y = canvasRect.top - panelRect.top + center.y * scaleY - 34;

    refs.selectionActionOverlay.classList.remove("hidden");
    refs.selectionActionOverlay.style.left = `${x}px`;
    refs.selectionActionOverlay.style.top = `${y}px`;
  }

  renderModal() {
    const { refs, game } = this;
    const overlay = game.activeOverlay();
    if (!overlay) {
      this.modalSignature = "";
      refs.modalRoot.classList.add("hidden");
      return;
    }
    const signature = `${overlay.type}|${overlay.title}|${overlay.options.map((option) => option.id ?? option.name).join("|")}`;
    refs.modalRoot.classList.remove("hidden");
    if (signature === this.modalSignature) {
      return;
    }
    this.modalSignature = signature;
    refs.modalTag.textContent = overlay.tag;
    refs.modalTitle.textContent = overlay.title;
    refs.modalBody.textContent = overlay.body;
    refs.modalOptions.innerHTML = overlay.options.map((option, index) => `
      <button class="choice-button" type="button" data-choice-index="${index}">
        <strong>${option.name}</strong>
        <small>${option.category}</small>
        <span>${option.description}</span>
      </button>
    `).join("");
  }

  render() {
    const { refs, game } = this;
    const { state } = game;
    refs.goldValue.textContent = `${Math.floor(state.gold)}`;
    refs.expValue.textContent = `${Math.floor(state.exp)} / ${Math.floor(state.expToNext)}`;
    refs.levelValue.textContent = `${state.level}`;
    refs.coreValue.textContent = `${Math.ceil(state.coreHp)} / ${state.maxCoreHp}`;
    refs.waveValue.textContent = `${Math.min(state.waveIndex + 1, game.totalWaves)} / ${game.totalWaves}`;
    refs.phasePill.textContent = game.getPhaseLabel();
    refs.pauseBtn.textContent = state.manualPause ? "继续" : "暂停";
    refs.speed1xBtn.classList.toggle("is-active", state.timeScale === 1);
    refs.speed2xBtn.classList.toggle("is-active", state.timeScale === 2);
    refs.startWaveBtn.disabled = state.phase !== "prep" || game.hasBlockingOverlay();
    refs.upgradeBtn.disabled = !game.canUpgradeSelected();
    refs.sellBtn.disabled = !state.selectedBuildingId;
    refs.overclockBtn.disabled = !game.canOverclockSelected();
    refs.buildHint.textContent = state.selectedBuildTypeId
      ? `已选择 ${game.buildingTypes[state.selectedBuildTypeId].name}，点击空建筑格建造，再次点击按钮可取消。`
      : "选择一种建筑后点击地图中的蓝色格子";

    const wave = game.currentWave();
    const pressure = game.getWavePressurePreview(wave);
    refs.waveSummary.textContent = wave
      ? `第 ${wave.id} 波: ${wave.name}。波后奖励 ${Math.floor(wave.rewardGold * state.modifiers.waveRewardGoldMult)} 金币。`
      : "本局已完成全部波次。";
    refs.growthPreview.innerHTML = [
      pressure.hp,
      pressure.speed,
      pressure.spawn,
      pressure.armor,
    ].map((item) => `<span class="tag">${item}</span>`).join("");

    if (state.phase === "prep") {
      refs.prepTimer.textContent = `准备倒计时: ${Math.max(0, Math.ceil(state.prepRemaining))} 秒`;
    } else if (state.phase === "combat") {
      refs.prepTimer.textContent = `本波剩余生成: ${state.spawnQueue.length}，场上敌人: ${state.enemies.length}`;
    } else {
      refs.prepTimer.textContent = state.result?.message || "";
    }

    refs.upcomingWavePanel.innerHTML = wave
      ? wave.entries.map((item) => `<div class="mini-item">${game.enemyTypes[item.enemyId].name} x ${item.count}${item.start > 0 ? `，${item.start.toFixed(1)}s 后加入` : ""}</div>`).join("")
      : '<div class="mini-item">全部波次已结束。</div>';
    refs.perkList.innerHTML = state.acquiredPerks.length
      ? state.acquiredPerks.map((item) => `<div class="mini-item">${item.name}</div>`).join("")
      : '<div class="mini-item">尚未获得强化</div>';
    refs.relicList.innerHTML = state.acquiredRelics.length
      ? state.acquiredRelics.map((item) => `<div class="mini-item">${item.name}</div>`).join("")
      : '<div class="mini-item">尚未获得饰品</div>';
    refs.buildSummary.innerHTML = [
      `攻速 ${Math.round((state.modifiers.attackSpeedMult - 1) * 100)}%`,
      `暴击 ${Math.round(state.modifiers.critChance * 100)}%`,
      `暴伤 ${Math.round((state.modifiers.critDamage - 1) * 100)}%`,
      `灼烧 ${Math.round((state.modifiers.burnDamageMult - 1) * 100)}%`,
      `减速 ${Math.round(state.modifiers.slowPower * 100)}%`,
      `连锁 +${state.modifiers.chainExtra}`,
      `范围 ${Math.round((state.modifiers.areaRadiusMult - 1) * 100)}%`,
    ].map((item) => `<span class="tag">${item}</span>`).join("");
    refs.eventLog.innerHTML = state.log.length
      ? state.log.map((item) => `<div class="log-item">${item}</div>`).join("")
      : '<p class="empty-state">战斗开始后，这里会记录关键事件。</p>';

    this.renderBuildButtons();
    this.renderSelection();
    this.renderSelectionActionOverlay();
    this.renderModal();
  }
}
