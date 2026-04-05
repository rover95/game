# Tower Forge Frontier

一个基于原仓库多游戏 Vite 结构接入的 2D 俯视角塔防原型。

## 运行

在仓库根目录执行：

```bash
npm run dev:tower-forge
```

单独构建：

```bash
npm run build:tower-forge
```

## 目录

```text
games/tower-forge
├─ index.html
├─ style.css
├─ package.json
├─ vite.config.js
└─ src
   ├─ main.js
   ├─ data
   └─ game
```

## 扩展点

- 在 `src/data/buildings.js` 新增建筑或分支升级
- 在 `src/data/enemies.js` 与 `src/data/waves.js` 增加怪物和波次
- 在 `src/data/rewards.js` 继续补三选一强化与饰品
- 在 `src/game/Game.js` 的事件钩子处扩展新的 trait/modifier 行为
