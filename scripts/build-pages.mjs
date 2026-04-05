import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "dist");
const rootIndexPath = path.join(rootDir, "index.html");
const rootStylePath = path.join(rootDir, "style.css");
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

const resetOutputDir = (targetDir) => {
  try {
    rmSync(targetDir, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== "EBUSY" || !existsSync(targetDir)) {
      throw error;
    }

    for (const entry of readdirSync(targetDir)) {
      rmSync(path.join(targetDir, entry), { recursive: true, force: true });
    }
  }

  mkdirSync(targetDir, { recursive: true });
};

resetOutputDir(outputDir);
copyDir(rootIndexPath, path.join(outputDir, "index.html"));
copyDir(rootStylePath, path.join(outputDir, "style.css"));

const gameEntries = [
  { slug: "2048" },
  { slug: "siege" },
  { slug: "dual-front" },
  { slug: "billiards" },
];

for (const game of gameEntries) {
  const gameDir = path.join(gamesDir, game.slug);
  run(["run", "build"], gameDir);

  const gameDistDir = path.join(gameDir, "dist");
  if (!existsSync(gameDistDir)) {
    throw new Error(`未找到构建输出: ${gameDistDir}`);
  }

  const targetDir = path.join(outputDir, "games", game.slug);
  copyDir(gameDistDir, targetDir);
}
