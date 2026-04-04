import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "dist");
const siteDir = path.join(rootDir, "site");
const gamesDir = path.join(rootDir, "games");
const npmCommand = process.platform === "win32" ? "npm" : "npm";

const run = (args, cwd) => {
  execSync(`${npmCommand} ${args.join(" ")}`, {
    cwd,
    shell: true,
    stdio: "inherit",
  });
};

const copyDir = (source, target) => {
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
};

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
copyDir(siteDir, outputDir);

const gameEntries = [
  { slug: "2048" },
];

for (const game of gameEntries) {
  const gameDir = path.join(gamesDir, game.slug);
  run(["run", "build"], gameDir);

  const gameDistDir = path.join(gameDir, "dist");
  if (!existsSync(gameDistDir)) {
    throw new Error(`未找到构建输出: ${gameDistDir}`);
  }

  copyDir(gameDistDir, path.join(outputDir, "games", game.slug));
}
