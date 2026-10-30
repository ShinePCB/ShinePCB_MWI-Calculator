/* Cache busting for dist/: stamps every reference to a versioned file with ?v=<content hash>.
 * The hash covers all versioned files (ignoring existing stamps), so any change yields a new URL for
 * all of them at once. Run after editing anything in dist/.
 * GPL-3.0-or-later */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "dist");
const TEXT = ["index.html", "mwi.js", "engine.js", "materials.js", "i18n.js", "locales/en.js", "styles.css"];
const BINARY = ["kicad-transline.wasm", "img/broadside_stripline.svg", "img/shinepcb-logo.png"];
const STAMP = /\?v=[0-9a-f]+/g;
// Every in-page reference to a versioned file, e.g. "./mwi.js" or "./mwi.js?v=0123abcd".
const REF = /(\.\/(?:styles\.css|i18n\.js|locales\/en\.js|img\/shinepcb-logo\.png|mwi\.js|engine\.js|materials\.js|kicad-transline\.wasm|img\/broadside_stripline\.svg))(?:\?v=[0-9a-f]+)?(?=["'`])/g;

const texts = Object.fromEntries(await Promise.all(TEXT.map(async (f) => [f, await readFile(path.join(dist, f), "utf8")])));
const hash = createHash("sha256");
for (const f of TEXT) hash.update(f).update(texts[f].replace(STAMP, ""));
for (const f of BINARY) hash.update(f).update(await readFile(path.join(dist, f)));
const version = hash.digest("hex").slice(0, 10);

let changed = 0;
for (const f of TEXT) {
  const next = texts[f].replace(REF, `$1?v=${version}`);
  if (next !== texts[f]) { await writeFile(path.join(dist, f), next); changed++; }
}
console.log(`dist version ${version} (${changed} file${changed === 1 ? "" : "s"} updated)`);
