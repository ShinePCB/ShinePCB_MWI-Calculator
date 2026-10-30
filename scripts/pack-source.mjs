/* GPL-3.0: packs the corresponding source of the site into tmp/board-calculator-source.tar.gz
 * (KiCad sources, WASM bridges, build scripts, material data and the front end).
 * GPL-3.0-or-later */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["LICENSE", "NOTICE.md", "README.md", "KICAD_AUTHORS.txt", "package.json", "pnpm-lock.yaml", "playwright.config.ts", "scripts", "src", "data",
  "dist/index.html", "dist/i18n.js", "dist/locales", "dist/mwi.js", "dist/engine.js", "dist/materials.js", "dist/styles.css", "dist/kicad-transline.wasm", "dist/sunden-datasheet.pdf", "dist/_headers", "dist/favicon.svg", "dist/img"];
mkdirSync(path.join(root, "tmp"), { recursive: true });
execFileSync("tar", ["-czf", "tmp/board-calculator-source.tar.gz", ...files], { cwd: root, stdio: "inherit" });
console.log("tmp/board-calculator-source.tar.gz written (local only)");
