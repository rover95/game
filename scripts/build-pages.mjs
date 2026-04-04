import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const ensureGameStylesheet = (gameRootDir) => {
  const htmlPath = path.join(gameRootDir, "index.html");
  const cssPath = path.join(gameRootDir, "style.css");
  const sourceCssPath = path.join(rootDir, "games", "2048", "style.css");

  if (!existsSync(cssPath)) {
    cpSync(sourceCssPath, cssPath);
  }

  const html = readFileSync(htmlPath, "utf8");
  if (html.includes('href="./style.css"')) {
    return;
  }

  const patchedHtml = html.replace(
    "<title>Impact Merge 2048</title>",
    '<title>Impact Merge 2048</title>\n  <link rel="stylesheet" href="./style.css">',
  );
  writeFileSync(htmlPath, patchedHtml, "utf8");
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

  const targetDir = path.join(outputDir, "games", game.slug);
  copyDir(gameDistDir, targetDir);
  ensureGameStylesheet(targetDir);
}
