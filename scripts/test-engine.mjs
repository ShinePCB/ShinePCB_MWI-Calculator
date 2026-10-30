/* Engine regression test. Reference values: Rogers MWI calculator for RO4350B (Dk 3.66, Df 0.0037,
 * k 0.69 W/mK), h = 0.010 in, T = 0.0006 in, W = 0.022 in, S = 0.005 in, L = 1 in, 10 GHz,
 * 1/2 oz ED copper (SAI 3.8, nodule 0.28 µm), σ = 5.813e7 S/m. Tolerances reflect the model
 * differences documented in README.md.
 * GPL-3.0-or-later */
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine, djordjevicSarkar, roughness } from "../dist/engine.js";
import { MATERIALS } from "../dist/materials.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { instance } = await WebAssembly.instantiate(await readFile(path.join(root, "dist", "kicad-transline.wasm")));
const E = createEngine(instance.exports);
const IN = 0.0254;
const base = { f: 10e9, er: 3.66, tand: 0.0037, h: 0.01 * IN, t: 0.0006 * IN, w: 0.022 * IN, s: 0.005 * IN, len: IN, sigma: 5.813e7, cu: { sai: 3.8, nodule: 0.28e-6, rms: 2.8e-6 }, kth: 0.69 };
const perIn = (dbPerM) => dbPerM * IN;
let n = 0;
const near = (got, want, rel, what) => { n++; assert.ok(Math.abs(got - want) <= Math.abs(want) * rel, `${what}: got ${got}, want ${want} ±${rel * 100}%`); };

const M = E.analyse({ ...base, design: "M" });
near(M.z0, 49.30, 0.01, "microstrip Z0");
near(M.eeff, 2.842, 0.01, "microstrip εeff");
near(perIn(M.il), 0.391, 0.03, "microstrip IL");
near(perIn(M.ac), 0.262, 0.04, "microstrip conductor loss");
near(perIn(M.ad), 0.129, 0.03, "microstrip dielectric loss");
near(M.lambda / IN, 0.700, 0.01, "microstrip wavelength");
near(M.delay * 1e12, 142.839, 0.01, "microstrip delay");
near(M.fringe / IN, 0.0041, 0.03, "microstrip open-end fringing");
near(M.thetaPerW, 2.234, 0.02, "microstrip temperature rise");
near(M.p100, 44.77, 0.02, "microstrip 100 °C power");
near(M.fRad / 1e9, 43, 0.1, "microstrip radiation frequency");

const S = E.analyse({ ...base, design: "S" });
near(S.z0, 30.93, 0.005, "stripline Z0");
near(perIn(S.il), 0.486, 0.03, "stripline IL");
near(perIn(S.ad), 0.164, 0.01, "stripline dielectric loss");
near(S.thetaPerW, 1.373, 0.03, "stripline temperature rise");

const GC = E.analyse({ ...base, design: "GC" });
near(GC.z0, 41.82, 0.03, "GCPW Z0");
near(perIn(GC.il), 0.475, 0.2, "GCPW IL");

const ME = E.analyse({ ...base, design: "ME" });
near(ME.ze, 56.42, 0.04, "coupled microstrip Zeven");
near(ME.zo, 38.68, 0.02, "coupled microstrip Zodd");
near(ME.zdiffTD, 68.546, 0.01, "coupled microstrip Zdiff (TD)");
near(ME.eeffO, 2.569, 0.01, "coupled microstrip εeff odd");

const SE = E.analyse({ ...base, design: "SE" });
near(SE.ze, 32.95, 0.05, "edge-coupled stripline Zeven");
near(SE.zo, 27.92, 0.05, "edge-coupled stripline Zodd");

const SB = E.analyse({ ...base, design: "SB" });
near(SB.zo, 15.17, 0.005, "broadside stripline Zodd");
near(SB.ze, 55.23, 0.04, "broadside stripline Zeven");

// Synthesis: MWI gives 0.02156 in (microstrip) and 0.00990 in (stripline) for 50 Ω.
near(E.synthesize({ ...base, design: "M" }, 50).w / IN, 0.02156, 0.015, "microstrip synthesis");
near(E.synthesize({ ...base, design: "S" }, 50).w / IN, 0.00990, 0.01, "stripline synthesis");
for (const d of ["GC", "ME", "SE", "SB"]) {
  const target = d === "GC" ? 50 : 100;
  const r = E.synthesize({ ...base, design: d }, target).result;
  near(d === "GC" ? r.z0 : r.zdiff, target, 1e-6, `${d} synthesis round trip`);
}

// Model pieces.
const ds = djordjevicSarkar(3.66, 0.0037, 10e9);
near(ds.eps(10e9), 3.66, 1e-9, "Djordjevic–Sarkar anchor εr");
near(ds.tan(10e9), 0.0037, 1e-6, "Djordjevic–Sarkar anchor tanδ");
assert.ok(ds.eps(1e9) > ds.eps(40e9), "Djordjevic–Sarkar εr falls with frequency"); n++;
near(roughness(1e9, 5.813e7, { sai: 3.8, nodule: 0.28e-6 }), 1.157, 0.01, "Huray factor @1 GHz");
near(roughness(10e9, 5.8e7, { sai: 1, nodule: 0, rms: 0 }), 1, 1e-12, "smooth copper"); n++;

// Every material analyses in every structure.
for (const m of MATERIALS) for (const d of ["GC", "M", "ME", "S", "SE", "SB"]) {
  const r = E.analyse({ ...base, design: d, er: m.dk, tand: m.df, kth: m.kth ?? NaN, h: 0.254e-3, w: 0.3e-3, s: 0.2e-3, t: 18e-6 });
  const z = r.kind === "single" ? r.z0 : r.zdiff;
  assert.ok(Number.isFinite(z) && z > 0, `${m.name} ${d}: Z=${z}`); n++;
}
console.log(`engine OK (${n} checks, ${MATERIALS.length} materials)`);
