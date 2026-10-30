/* Algorithm regressions and model-domain checks. GPL-3.0-or-later */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createEngine, DESIGNS } from "../dist/engine.js";
import { MATERIALS } from "../dist/materials.js";

const { instance: { exports: wasm } } = await WebAssembly.instantiate(await readFile(new URL("../dist/kicad-transline.wasm", import.meta.url)));
const E = createEngine(wasm);
const base = { design: "M", f: 10e9, er: 3.66, tand: 0.0037, h: .254e-3, t: 15.24e-6,
  w: .5588e-3, s: .127e-3, len: .0254, sigma: 5.813e7, kth: .69,
  cu: { sai: 3.8, nodule: .28e-6, rms: 2.8e-6 } };
let checks = 0;
function ok(condition, message) { assert.ok(condition, message); checks++; }
function near(actual, expected, tolerance, label) { ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual}, expected ${expected} ±${tolerance}`); }
function rejects(input, pattern) { assert.throws(() => E.analyse({ ...base, ...input }), pattern); checks++; }
function valid(r) {
  for (const [k, v] of Object.entries(r)) if (typeof v === "number")
    ok(Number.isFinite(v) || (k === "cc" && r.ze === r.zo && v === Infinity) || (k === "p100" && r.thetaPerW === 0 && v === Infinity), `${r.design}.${k}=${v}`);
  ok(r.z0 > 0, `${r.design}: positive impedance`);
  if (r.kind === "coupled") ok(r.ze >= r.zo && r.zo > 0, `${r.design}: valid modes`);
  else ok(r.ac >= 0 && r.ad >= 0 && r.eeff >= 1 && r.eeff <= r.er * (1 + 1e-9), `${r.design}: passive line`);
}

// The negative-even-mode regression is exercised with company data, not another brand's presets.
const ownMaterialCases = [];
for (const name of ["CF220G2", "CFG294", "CFG1600"]) {
  const m = MATERIALS.find(m => m.name === name);
  const input = { ...base, design: "ME", er: m.dk, tand: m.df, kth: m.kth, t: 18e-6, sigma: 5.8e7, s: 8 * base.h };
  const r = E.analyse(input);
  valid(r);
  ownMaterialCases.push({ name, ze: r.ze, zo: r.zo, ilDiff: r.ilDiff });
  for (const gap of [8, 10]) {
    const solved = E.synthesize({ ...input, s: gap * base.h }, 100);
    valid(solved.result);
    near(solved.result.zdiff, 100, 1e-5, `${name} S/h=${gap} synthesis`);
  }
}

// An independent physical limit: weakly coupled thin strips approach a single isolated line.
for (const er of [2.2, 3.66, 10.2, 16]) {
  const input = { ...base, er, t: 0, f: 1e3 };
  const single = E.analyse(input);
  const pair = E.analyse({ ...input, design: "ME", s: 10 * input.h });
  near(pair.ze / single.z0, 1, .025, "weak coupling even limit");
  near(pair.zo / single.z0, 1, .025, "weak coupling odd limit");
}

// Preserve actual finite-cover behavior while disabling its fit for the explicit open sentinel.
function covered(cover) {
  const h = wasm.tl_create(1);
  try {
    for (const [p, v] of [[0,3.66],[1,.0037],[3,.000254],[4,cover],[5,0],[6,.0005588],[8,.000127],
      [10,1],[11,0],[12,1],[13,1],[14,1e3],[23,5.813e7],[44,0],[45,1e9],[46,0]]) wasm.tl_set_parameter(h,p,v);
    assert.equal(wasm.tl_analyse(h), 1);
    assert.equal(wasm.tl_get_analysis_status(h,19), 0);
    return { ze: wasm.tl_get_analysis_value(h,19), zo: wasm.tl_get_analysis_value(h,20) };
  } finally { wasm.tl_destroy(h); }
}
const shielded = covered(.00254), open = covered(1e20);
near(shielded.ze, 57.52293086539101, 1e-8, "finite cover even regression");
near(shielded.zo, 39.57156368172852, 1e-8, "finite cover odd regression");
ok(open.ze > shielded.ze, "a physical cover still affects impedance");

// Published Rogers Cohn examples: coupling is independent of Dk, so no cross-brand material substitution.
// https://www.rogerscorp.com/-/media/project/rogerscorp/documents/advanced-electronics-solutions/english/electrical-design-data/design-equations-for-broadside-and-edgewise-stripline.pdf
for (const [h, s, w, cc] of [[.031,.005,.200,1.47],[.030,.005,.060,1.88],[.050,.010,.100,2.22],
  [.050,.010,.125,2.11],[.060,.015,.200,2.42]]) {
  const r = E.analyse({ ...base, design: "SB", t: 0, h: h * .0254, s: s * .0254, w: w * .0254 });
  near(r.cc, cc, .0051, "published Cohn coupling (rounded to .01 dB)");
}
rejects({ design: "SB", er: 2.2, h: .127e-3, w: .03175e-3, s: 1.27e-3 }, /奇偶模关系/);
rejects({ design: "SB", w: 1 }, /薄导体模型无法求解/);
rejects({ design: "GC", er: 2.2, h: .127e-3, w: .03175e-3, s: .0254e-3, t: 18e-6 }, /铜厚修正后的间隙无效/);
for (const input of [{ f: 0 }, { w: -1 }, { w: Infinity }, { f: Infinity }, { er: 1 }, { er: .5 },
  { er: Infinity }, { tand: Infinity }, { t: NaN }, { len: Infinity }, { sigma: Infinity },
  { design: "GC", s: Infinity }, { cu: { sai: -1 } }, { cu: { rms: Infinity } }, { kth: Infinity }]) rejects(input, /有效的有限数值/);
rejects({ design: "unknown" }, /有效的传输线结构/);
for (const target of [0, -1, Infinity, NaN]) { assert.throws(() => E.synthesize(base, target), /目标阻抗必须/); checks++; }
valid(E.analyse({ ...base, len: 0, tand: 0, kth: NaN }));
near(E.synthesize({ ...base, w: NaN }, 50).result.z0, 50, 1e-5, "synthesis does not require an initial width");

// Ensure the wrapper respects a core error even if a core happens to return finite numbers.
const errorEngine = createEngine({ ...wasm, tl_get_analysis_status(h, p) {
  return p === 18 ? 2 : wasm.tl_get_analysis_status(h, p);
} });
assert.throws(() => errorEngine.analyse(base), /计算失败（Z0）/); checks++;

// A discontinuous but finite model can bracket 50 ohms without ever attaining it.
// The residual check must reject this, instead of claiming that bisection converged.
const discontinuous = createEngine({ ...wasm, tl_get_analysis_value(h, p) {
  const value = wasm.tl_get_analysis_value(h, p);
  return p === 18 ? (value > 50 ? 60 : 40) : value;
} });
assert.throws(() => discontinuous.synthesize(base, 50), /回代阻抗未达到目标/); checks++;

// Quasi-static zero-thickness single-line equations, independent of the C++ implementation.
// Hammerstad-Jensen: https://qucs.sourceforge.net/tech/node75.html
for (const er of [2.2,3.66,4.4,10.2]) for (const u of [.25,.5,1,2,4,8]) {
  const a = 1 + Math.log((u**4+(u/52)**2)/(u**4+.432))/49 + Math.log(1+(u/18.1)**3)/18.7;
  const b = .564*((er-.9)/(er+3))**.053;
  const eeff = (er+1)/2+(er-1)/2*(1+10/u)**(-a*b);
  const fu = 6+(2*Math.PI-6)*Math.exp(-((30.666/u)**.7528));
  const z0 = 376.730313668/(2*Math.PI*Math.sqrt(eeff))*Math.log(fu/u+Math.sqrt(1+4/u**2));
  const r = E.analyse({ ...base, er, w: u*base.h, t: 0, f: 1e3 });
  near(r.z0, z0, 1e-8, "independent quasi-static impedance");
  near(r.eeff, eeff, 1e-8, "independent quasi-static effective Dk");
}

// Engineering trends at company-material working points. One variable changes at a time.
let trendChecks = 0;
const thicknessReview = { cases: 0, adverse: [], maxRisePercent: 0 };
for (const m of MATERIALS) for (const { code: design, coupled, space } of DESIGNS) for (const f of [1e9,10e9,40e9]) {
  const input = { ...base, design, er: m.dk, tand: m.df, kth: m.kth, f, t: 18e-6, w: .62e-3, s: .2e-3 };
  const r = E.analyse(input);
  const trend = (condition, label) => { ok(condition, `${m.name} ${design} ${f/1e9} GHz: ${label}`); trendChecks++; };
  for (const [key, direction] of [["w",-1],["er",-1],["h",1], ...(space ? [["s",0]] : [])]) {
    const changed = E.analyse({ ...input, [key]: input[key]*1.1 });
    for (const output of coupled ? ["ze","zo"] : ["z0"]) {
      const sign = key === "s" ? (output === "ze" ? -1 : 1) : direction;
      trend(sign*(changed[output]-r[output]) >= -1e-10, `${key} trend for ${output}`);
    }
  }
  const longer = E.analyse({ ...input, len: 2*input.len });
  if (coupled) {
    trend(r.zdiff === 2*r.zo && r.zcomm === r.ze/2, "mode definitions");
    trend(Math.abs(longer.delayOdd/r.delayOdd-2) < 1e-12, "delay proportional to length");
  } else {
    trend(Math.abs(Math.sqrt(r.L/r.C)/r.z0-1) < 1e-12, "Z0 = sqrt(L/C)");
    trend(Math.abs(longer.delay/r.delay-2) < 1e-12 && Math.abs(longer.ilTotal/r.ilTotal-2) < 1e-12, "length scaling");
    const smooth = E.analyse({ ...input, cu: { sai:0, nodule:0, rms:0 } });
    trend(smooth.ac <= r.ac && smooth.z0 === r.z0, "roughness increases loss only");
    const lossier = E.analyse({ ...input, tand: 2*input.tand });
    trend(Math.abs(lossier.ad/r.ad-2) < 1e-12, "dielectric loss proportional to Df");
    const conductive = E.analyse({ ...input, sigma: 2*input.sigma, cu: { sai:0, nodule:0, rms:0 } });
    trend(conductive.ac < smooth.ac, "higher conductivity lowers conductor loss");
  }
  if (design !== "SB") {
    const thicker = E.analyse({ ...input, t: input.t*1.1 });
    for (const key of coupled ? ["ze","zo"] : ["z0"]) {
      thicknessReview.cases++;
      if (thicker[key] > r[key]+1e-10) {
        const risePercent = 100*(thicker[key]/r[key]-1);
        thicknessReview.maxRisePercent = Math.max(thicknessReview.maxRisePercent, risePercent);
        thicknessReview.adverse.push({ material: m.name, design, fGHz:f/1e9, key, before:r[key], after:thicker[key], risePercent });
      } else if (!["ME","GC"].includes(design)) trend(true, "thicker copper does not raise impedance");
    }
  }
}

// Typical company geometries: both bulk and existing design/thickness Dk selection, all structures/frequencies.
let materialRuns = 0;
for (const m of MATERIALS) for (const mode of ["bulk", "design"]) for (const { code: design } of DESIGNS) for (const f of [1e9, 10e9, 40e9]) {
  const h = m.cured ? m.cured * 1e-3 : base.h;
  const row = m.dkByThickness?.filter(e => Math.abs(e.h - h * 1e3) <= e.hTol).sort((a,b) => Math.abs(a.h-h*1e3)-Math.abs(b.h-h*1e3))[0];
  const er = mode === "bulk" ? m.dk : row?.dk ?? m.designDk ?? m.dk;
  valid(E.analyse({ ...base, design, f, h, er, tand: m.df, kth: m.kth, t: 18e-6, w: .62e-3, s: .2e-3 }));
  materialRuns++;
}

// Audit grid includes unsupported geometries. They must be explicitly rejected, never returned as NaN/negative results.
const grid = {};
for (const { code: design, space } of DESIGNS) {
  grid[design] = { valid: 0, rejected: 0 };
  for (const er of [2.2,3.66,4.4,10.2]) for (const h of [.127e-3,.254e-3,.508e-3])
  for (const u of [.25,.5,1,2,4,8]) for (const gap of space ? [.2,.5,1,2,10] : [.5]) for (const f of [1e9,10e9,40e9]) {
    let r;
    try { r = E.analyse({ ...base, design, er, h, w: u*h, s: gap*h, t: 18e-6, f }); }
    catch (error) {
      ok(["GC", "SB"].includes(design) || (design === "ME" && f === 40e9 && h === .508e-3 && gap === 10 && u >= 4),
        `unexpected rejection: ${design} ${error.message}`);
      ok(/模型|间隙无效/.test(error.message), "specific model-domain error");
      grid[design].rejected++; continue;
    }
    valid(r); grid[design].valid++;
  }
}
ok(grid.GC.valid >= 984 && grid.SB.valid >= 900 && grid.ME.valid >= 1077, "domain guards retain ordinary supported geometries");
const report = { checks, materialRuns, trendChecks, ownMaterialCases, grid, thicknessReview };
if (process.argv.includes("--report")) await writeFile(new URL("../reports/algorithm-fixes-2026-10-08.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, thicknessReview: { cases: thicknessReview.cases, adverseCount: thicknessReview.adverse.length,
  maxRisePercent: thicknessReview.maxRisePercent, examples: thicknessReview.adverse.filter(r => ["CF220G2","CFG1600"].includes(r.material)).slice(0,6) } }, null, 2));
