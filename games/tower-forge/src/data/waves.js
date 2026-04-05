import { TOTAL_WAVES } from "../game/constants.js";

const entry = (enemyId, count, interval, start = 0) => ({ enemyId, count, interval, start });

const waves = [
  { name: "试探接触", rewardGold: 55, entries: [entry("normal", 8, 0.95)] },
  { name: "快袭群", rewardGold: 65, entries: [entry("normal", 10, 0.82), entry("runner", 5, 0.55, 3)] },
  { name: "首次重压", rewardGold: 74, entries: [entry("normal", 12, 0.78), entry("armored", 4, 0.95, 5)] },
  { name: "裂体试探", rewardGold: 84, entries: [entry("runner", 10, 0.48), entry("normal", 10, 0.72, 2), entry("splitter", 3, 0.95, 7)] },
  { name: "精英逼近", rewardGold: 96, entries: [entry("elite", 3, 1.05, 1.5), entry("armored", 8, 0.82, 3.5), entry("normal", 12, 0.66)] },
  { name: "高速穿插", rewardGold: 108, entries: [entry("normal", 16, 0.64), entry("runner", 12, 0.42, 2.5), entry("splitter", 4, 0.72, 8)] },
  { name: "护甲推进", rewardGold: 120, entries: [entry("armored", 10, 0.72), entry("elite", 4, 0.92, 3), entry("runner", 10, 0.42, 6)] },
  { name: "双折回廊", rewardGold: 132, entries: [entry("splitter", 8, 0.62), entry("normal", 20, 0.56, 1.5), entry("armored", 6, 0.76, 7)] },
  { name: "前线抽打", rewardGold: 146, entries: [entry("elite", 6, 0.75), entry("runner", 16, 0.36, 2.5), entry("armored", 8, 0.68, 7.5)] },
  { name: "中型 Boss", rewardGold: 165, entries: [entry("armored", 10, 0.68), entry("splitter", 6, 0.6, 4.5), entry("runner", 12, 0.34, 6), entry("boss", 1, 1, 8.5)] },
  { name: "双线堆压", rewardGold: 176, entries: [entry("normal", 24, 0.5), entry("runner", 18, 0.32, 3), entry("elite", 6, 0.62, 8)] },
  { name: "钝刀锯肉", rewardGold: 190, entries: [entry("armored", 14, 0.62), entry("splitter", 12, 0.5, 2), entry("elite", 8, 0.6, 7)] },
  { name: "裂谷冲锋", rewardGold: 205, entries: [entry("runner", 24, 0.3), entry("elite", 10, 0.52, 3), entry("splitter", 10, 0.46, 6)] },
  { name: "深层铁潮", rewardGold: 220, entries: [entry("armored", 18, 0.56), entry("elite", 10, 0.48, 3.5), entry("splitter", 12, 0.48, 8)] },
  { name: "第二 Boss 波", rewardGold: 240, entries: [entry("runner", 24, 0.28), entry("armored", 12, 0.54, 2), entry("elite", 12, 0.48, 5.5), entry("boss", 1, 1, 10)] },
  { name: "崩口决堤", rewardGold: 255, entries: [entry("armored", 20, 0.5), entry("elite", 12, 0.44, 2.5), entry("splitter", 14, 0.42, 5.5), entry("runner", 20, 0.28, 7)] },
  { name: "终幕前压迫", rewardGold: 275, entries: [entry("elite", 16, 0.42), entry("runner", 28, 0.25, 2.8), entry("armored", 18, 0.48, 6.2), entry("splitter", 16, 0.4, 9)] },
  { name: "最终 Boss 波", rewardGold: 320, entries: [entry("boss", 1, 1, 2), entry("elite", 18, 0.4, 4.5), entry("armored", 20, 0.45, 6), entry("runner", 24, 0.26, 8.5), entry("splitter", 18, 0.38, 10)] },
];

export const WAVES = waves.slice(0, TOTAL_WAVES).map((wave, index) => ({
  id: index + 1,
  hpScale: 1 + index * 0.18,
  speedScale: 1 + index * 0.024,
  goldScale: 1 + index * 0.045,
  expScale: 1 + index * 0.05,
  ...wave,
  rewardGold: Math.round(wave.rewardGold * 0.85),
}));
