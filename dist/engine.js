/* Board calculator engine.
 * Impedance / εeff / microstrip, coupled-line and coplanar losses come from KiCad's
 * transline_calculations classes (kicad-transline.wasm). Closed-form models fill what KiCad lacks:
 * Huray copper roughness, Pozar stripline conductor loss, Ghione CPW conductor loss,
 * Cohn broadside-coupled stripline, Djordjevic–Sarkar dispersion, and the derived rows
 * (wavelengths, phase, RLGC, open-end fringing, higher-order modes, radiation, temperature rise).
 * Everything is SI internally. Pure module: runs in the browser and in Node (scripts/test-engine.mjs).
 * SPDX-License-Identifier: GPL-3.0-or-later */

export const C0 = 299792458;
const MU0 = 4e-7 * Math.PI;
export const NP2DB = 20 / Math.LN10;

/* KiCad TRANSLINE_PARAMETERS ids (transline_calculation_base.h). */
const P = {
  EPSILONR: 0, TAND: 1, H: 3, H_T: 4, T: 5, W: 6, S: 8, LEN: 10, ROUGH: 11, MUR: 12, MURC: 13,
  FREQ: 14, A: 15, Z0: 18, Z0E: 19, Z0O: 20, SIGMA: 23, SKIN: 24, LOSS_D: 25, LOSS_C: 26,
  EEFF: 28, EEFF_E: 29, EEFF_O: 30, AC: 34, ACE: 35, ACO: 36, AD: 37, ADE: 38, ADO: 39,
  BACKMETAL: 43, DIEL: 44, SPEC: 45, SM: 46,
};
const KICAD = { M: 0, ME: 1, S: 2, SE: 3, GC: 4 };

/* The six structures, in the order of the design-type list. h is the dielectric thickness of one
 * layer; striplines have a layer on each side (ground spacing b = 2h + T, broadside b = 2h + S). */
export const DESIGNS = [
  { code: "GC", name: "接地共面波导", en: "Coplanar · Conductor Backed", coupled: false, space: true, img: "cpw_back" },
  { code: "M", name: "微带线", en: "Microstrip · Conventional", coupled: false, space: false, img: "microstrip" },
  { code: "ME", name: "边缘耦合微带线", en: "Microstrip · Edge Coupled", coupled: true, space: true, img: "c_microstrip" },
  { code: "S", name: "带状线", en: "Stripline · Homogeneous, Balanced", coupled: false, space: false, img: "stripline" },
  { code: "SE", name: "边缘耦合带状线", en: "Stripline · Edge Coupled", coupled: true, space: true, img: "coupled_stripline" },
  { code: "SB", name: "宽边耦合带状线", en: "Stripline · Broadside Coupled", coupled: true, space: true, img: "broadside_stripline" },
];
export const designOf = (code) => DESIGNS.find((d) => d.code === code);

/* ---------- small maths ---------- */
/** Complete elliptic integral of the first kind K(k), by the arithmetic–geometric mean. */
export function ellipK(k) {
  let a = 1, b = Math.sqrt(1 - k * k);
  for (let i = 0; i < 60 && Math.abs(a - b) > 1e-15 * a; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)];
  return Math.PI / (2 * a);
}
export const skinDepth = (f, sigma) => 1 / Math.sqrt(Math.PI * f * MU0 * sigma);
export const surfaceResistance = (f, sigma) => Math.sqrt((Math.PI * f * MU0) / sigma);

/** Conductor-loss multiplier for rough copper. Huray "snowball" model with the surface area index
 * (SAI = N·4πa²/A_flat) and nodule radius a; Hammerstad–Jensen on the RMS roughness when no nodule
 * data is given (e.g. rolled copper). */
export function roughness(f, sigma, cu) {
  const d = skinDepth(f, sigma);
  const a = cu?.nodule ?? 0, sai = cu?.sai ?? 0, rms = cu?.rms ?? 0;
  if (a > 0 && sai > 0) return 1 + (1.5 * sai) / (1 + d / a + (d * d) / (2 * a * a));
  if (rms > 0) return 1 + (2 / Math.PI) * Math.atan(1.4 * (rms / d) ** 2);
  return 1;
}

/** Djordjevic–Sarkar wideband Debye model fitted to (εr, tanδ) at fSpec, as KiCad's
 * DIELECTRIC_DJORDJEVIC_SARKAR (f1 = 1 kHz, f2 = 1 THz). Returns real εr and tanδ at any f. */
export function djordjevicSarkar(eps, tan, fSpec, f1 = 1e3, f2 = 1e12) {
  if (!(tan > 0)) return { eps: () => eps, tan: () => 0 };
  const clog = (re, im) => [Math.log(Math.hypot(re, im)), Math.atan2(im, re)];
  // ln((f2 + j f) / (f1 + j f))
  const L = (f) => { const [a1, b1] = clog(f2, f), [a0, b0] = clog(f1, f); return [a1 - a0, b1 - b0]; };
  const [kr, ki] = L(fSpec);
  const m = (-tan * eps) / ki;
  const epsInf = eps * (1 + (tan * kr) / ki);
  const at = (f) => { const [lr, li] = L(f); return [epsInf + m * lr, m * li]; };
  return { eps: (f) => at(f)[0], tan: (f) => -at(f)[1] / at(f)[0] };
}

/* ---------- closed-form line models ---------- */
/** Pozar (Wheeler incremental inductance) stripline conductor attenuation, Np/m. b = ground spacing. */
function striplineAlphaC(Rs, er, z0, b, w, t) {
  t = Math.max(t, 1e-7);
  if (Math.sqrt(er) * z0 < 120) {
    const A = 1 + (2 * w) / (b - t) + (1 / Math.PI) * ((b + t) / (b - t)) * Math.log((2 * b - t) / t);
    return ((2.7e-3 * Rs * er * z0) / (30 * Math.PI * (b - t))) * A;
  }
  const B = 1 + (b / (0.5 * w + 0.7 * t)) * (0.5 + (0.414 * t) / w + (1 / (2 * Math.PI)) * Math.log((4 * Math.PI * w) / t));
  return ((0.16 * Rs) / (z0 * b)) * B;
}

/** Ghione / Owyang–Wu coplanar-waveguide conductor attenuation, Np/m (centre strip + side grounds). */
function cpwAlphaC(Rs, eeff, w, s, t) {
  t = Math.max(t, 1e-7);
  const a = w / 2, b = w / 2 + s, k = a / b, kp = Math.sqrt(1 - k * k);
  const term = (x) => (Math.PI + Math.log((8 * Math.PI * x * (1 - k)) / (t * (1 + k)))) / x;
  return ((Rs * Math.sqrt(eeff)) / (480 * Math.PI * ellipK(k) * ellipK(kp) * (1 - k * k))) * (term(a) + term(b));
}

/** Cohn (1960) broadside-coupled, centred, thin strips between grounds spaced b, strips s apart. */
function cohnBroadside(w, s, b, er) {
  const wb = (k) => {
    const R = Math.sqrt((k * b / s - 1) / (b / (k * s) - 1));
    return (Math.log((1 + R) / (1 - R)) - (s / b) * Math.log((1 + R / k) / (1 - R / k))) / Math.PI;
  };
  let lo = (s / b) * (1 + 1e-12), hi = 1 - 1e-15;
  const target = w / b;
  const invalid = () => new Error("宽边耦合薄导体模型无法求解此几何尺寸，请调整线宽、层间距或使用场求解器");
  if (!(wb(lo) <= target && target <= wb(hi))) throw invalid();
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (wb(m) < w / b) lo = m; else hi = m; }
  const k = (lo + hi) / 2, kp = Math.sqrt(1 - k * k);
  if (!(Math.abs(wb(k) - target) <= 1e-6 * target)) throw invalid();
  return { ze: (188.3 / Math.sqrt(er)) * ellipK(kp) / ellipK(k), zo: ((296.1 / Math.sqrt(er)) * (s / b)) / Math.atanh(k) };
}

/** Hammerstad–Bekkadal open-end (gap) length extension of a microstrip. */
function openEnd(h, w, eeff) {
  const u = w / h;
  return (0.412 * h * (eeff + 0.3) * (u + 0.264)) / ((eeff - 0.258) * (u + 0.8));
}

/** Hammerstad's radiation factor F(εeff) for an open microstrip end. */
function radiationF(e) {
  const s = Math.sqrt(e);
  return (e + 1) / e - ((e - 1) ** 2 / (2 * e ** 1.5)) * Math.log((s + 1) / (s - 1));
}

/* ---------- engine ---------- */
export function createEngine(wasm) {
  /** Runs one KiCad model and returns a getter over its result / parameter maps. */
  function kicad(design, params) {
    const h = wasm.tl_create(KICAD[design]);
    if (!h) throw new Error("KiCad 计算内核创建失败");
    try {
      const set = (p, v) => { if (wasm.tl_has_parameter(h, p)) wasm.tl_set_parameter(h, p, v); };
      set(P.MUR, 1); set(P.MURC, 1); set(P.ROUGH, 0); set(P.SM, 0); set(P.H_T, 1e20); set(P.DIEL, 0); set(P.SPEC, 1e9); set(P.LEN, 1);
      if (design === "GC") set(P.BACKMETAL, 1);
      for (const [k, v] of Object.entries(params)) set(P[k], v);
      if (wasm.tl_analyse(h) !== 1) throw new Error("KiCad 计算失败");
      const out = {};
      const required = { M: ["Z0", "EEFF", "AC", "AD"], GC: ["Z0", "EEFF", "LOSS_D"], S: ["Z0"],
        ME: ["Z0E", "Z0O", "EEFF_E", "EEFF_O", "ACO", "ADO"], SE: ["Z0E", "Z0O"] }[design];
      for (const [k, p] of Object.entries(P)) {
        const status = wasm.tl_get_analysis_status(h, p);
        if (status === 2 && required.includes(k)) throw new Error(`${designOf(design).name}计算失败（${k}），当前参数超出模型可用范围`);
        out[k] = status !== -1 ? wasm.tl_get_analysis_value(h, p) : (wasm.tl_has_parameter(h, p) ? wasm.tl_get_parameter(h, p) : NaN);
      }
      return out;
    } finally {
      wasm.tl_destroy(h);
    }
  }

  /**
   * One frequency point.
   * inp: { design, f, er, tand, h, t, w, s, len, sigma, cu: {sai, nodule (m), rms (m)}, kth }
   * Losses are returned in dB/m, lengths in m, time in s, angles in degrees.
   */
  function analyse(inp) {
    const { design, f, er, tand, h, t, w, s, len, sigma, cu, kth } = inp;
    check(inp);
    const K = roughness(f, sigma, cu);
    const skin = skinDepth(f, sigma);
    const Rs = surfaceResistance(f, sigma);
    const base = { EPSILONR: er, TAND: tand, SIGMA: sigma, T: t, W: w, FREQ: f };
    const r = { design, f, er, tand, K, skin };

    if (design === "M" || design === "GC" || design === "S") {
      let z0, eeff, acSmooth, ad, b = 0;
      if (design === "M") {
        const k = kicad("M", { ...base, H: h });
        z0 = k.Z0; eeff = k.EEFF; acSmooth = k.AC; ad = k.AD;
      } else if (design === "GC") {
        const k = kicad("GC", { ...base, H: h, S: s });
        z0 = k.Z0; eeff = k.EEFF; ad = k.LOSS_D;
        acSmooth = cpwAlphaC(Rs, eeff, w, s, t) * NP2DB;
      } else {
        b = 2 * h + t;
        const k = kicad("S", { ...base, H: b, A: h });
        z0 = k.Z0; eeff = er;
        acSmooth = striplineAlphaC(Rs, er, z0, b, w, t) * NP2DB;
        ad = ((Math.PI * f * Math.sqrt(er) * tand) / C0) * NP2DB;
      }
      const ac = acSmooth * K, il = ac + ad;
      const vp = C0 / Math.sqrt(eeff), lambda = vp / f;
      const unwrapped = (360 * len) / lambda;
      Object.assign(r, {
        kind: "single", z0, eeff, ac, acSmooth, ad, il, ilTotal: il * len,
        lambda, vp, delay: len / vp, delayPerM: 1 / vp, unwrapped, phase: ((unwrapped % 360) + 360) % 360,
        // Transmission-line constants from Z0, εeff and the attenuation split (α = R/2Z0 + G·Z0/2).
        R: (2 * z0 * ac) / NP2DB, L: (z0 * Math.sqrt(eeff)) / C0, G: (2 * ad) / NP2DB / z0, C: Math.sqrt(eeff) / (C0 * z0),
      });
      if (design === "M") {
        r.fringe = openEnd(h, w, eeff);
        // Lowest of the TM1 surface wave and the transverse (half-wave across W) resonance.
        const fTM = (C0 * Math.atan(er)) / (Math.SQRT2 * Math.PI * h * Math.sqrt(er - 1));
        const fTR = C0 / (Math.sqrt(er) * (2 * w + 0.8 * h));
        r.fSpur = Math.min(fTM, fTR);
        // Open-end radiated power 240π²(h/λ0)²·F(εeff)/Z0 reaches 5 % of the incident power.
        r.fRad = (C0 / (Math.PI * h)) * Math.sqrt((0.05 * z0) / (240 * radiationF(eeff)));
      } else if (design === "S") {
        r.fringe = openEnd(b / 2, w, er);
        // TE1 (transverse) and parallel-plate TM1 cut-offs.
        const fTE = C0 / (2 * Math.sqrt(er) * (w + (Math.PI * b) / 4));
        const fPP = C0 / (2 * b * Math.sqrt(er));
        r.fSpur = Math.min(fTE, fPP);
      }
      // Heat through the dielectric under the strip (two paths for stripline).
      if (kth > 0 && len > 0) {
        const lost = 1 - 10 ** (-(il * len) / 10);
        r.thetaPerW = (lost * h) / (kth * w * len) / (design === "S" ? 2 : 1);
        r.p100 = 100 / r.thetaPerW;
      }
      return validateResult(r);
    }

    // Coupled pairs.
    let ze, zo, eeffE, eeffO, extra = {};
    if (design === "ME") {
      const k = kicad("ME", { ...base, H: h, S: s });
      ze = k.Z0E; zo = k.Z0O; eeffE = k.EEFF_E; eeffO = k.EEFF_O;
      const single = kicad("M", { ...base, H: h, FREQ: 1e6 });
      extra.z0single = single.Z0;
      // IPC-2141 time-domain differential impedance of an edge-coupled microstrip.
      extra.zdiffTD = 2 * single.Z0 * (1 - 0.48 * Math.exp((-0.96 * s) / h));
      extra.acOdd = k.ACO * K; extra.adOdd = k.ADO; extra.ilDiff = extra.acOdd + extra.adOdd;
    } else if (design === "SE") {
      const k = kicad("SE", { ...base, H: 2 * h + t, A: 0, S: s });
      ze = k.Z0E; zo = k.Z0O; eeffE = eeffO = er;
    } else {
      ({ ze, zo } = cohnBroadside(w, s, 2 * h + s, er));
      eeffE = eeffO = er;
    }
    const vpO = C0 / Math.sqrt(eeffO);
    Object.assign(r, extra, {
      kind: "coupled", ze, zo, zcomm: ze / 2, zdiff: 2 * zo, z0: Math.sqrt(ze * zo),
      cc: 20 * Math.log10((ze + zo) / (ze - zo)), eeffE, eeffO,
      delayOdd: len / vpO, lambdaOdd: vpO / f,
    });
    if (extra.ilDiff !== undefined) r.ilDiffTotal = extra.ilDiff * len;
    return validateResult(r);
  }

  /** Synthesis: conductor width giving the target Z0 (single) or Zdiff (coupled); other inputs fixed. */
  function synthesize(inp, target) {
    // The input width is an output of synthesis, so validate the other inputs with a seed width.
    check({ ...inp, w: inp.h }, false);
    if (!Number.isFinite(target) || target <= 0) throw new Error("目标阻抗必须为有限正数");
    const coupled = designOf(inp.design).coupled;
    const z = (w) => { try { const r = analyse({ ...inp, w }); return coupled ? r.zdiff : r.z0; } catch { return NaN; } };
    // Impedance falls with width. Scan a log grid for a bracket of finite values (some models fail at
    // extreme widths), then bisect.
    const a = Math.log(inp.h / 500), b = Math.log(inp.h * 60), n = 48;
    let lo = NaN, hi = NaN, zmin = Infinity, zmax = -Infinity, prev = null;
    for (let i = 0; i <= n; i++) {
      const x = a + ((b - a) * i) / n, zx = z(Math.exp(x));
      if (!Number.isFinite(zx)) { prev = null; continue; }
      zmin = Math.min(zmin, zx); zmax = Math.max(zmax, zx);
      if (prev && prev.z >= target && zx <= target) { lo = prev.x; hi = x; break; }
      prev = { x, z: zx };
    }
    if (!Number.isFinite(lo)) throw new Error(Number.isFinite(zmin)
      ? `目标阻抗 ${target} Ω 超出已扫描的有效线宽区间（阻抗约 ${fmt(zmin)}–${fmt(zmax)} Ω）`
      : "当前参数没有可合成的有效线宽，请检查材料和几何尺寸");
    for (let i = 0; i < 80; i++) {
      const m = (lo + hi) / 2, zm = z(Math.exp(m));
      if (!Number.isFinite(zm)) throw new Error("线宽求解进入模型无效区域，无法可靠合成此目标阻抗");
      if (zm > target) lo = m; else hi = m;
      if (hi - lo < 1e-10) break;
    }
    const w = Math.exp((lo + hi) / 2);
    const result = analyse({ ...inp, w });
    const actual = coupled ? result.zdiff : result.z0;
    if (Math.abs(actual - target) > Math.max(1e-6, target * 1e-7)) throw new Error("线宽求解未收敛，回代阻抗未达到目标");
    return { w, result };
  }

  return { analyse, synthesize };
}

const fmt = (v) => (Number.isFinite(v) ? Number(v.toPrecision(4)) : "—");

function validateResult(r) {
  const positive = r.kind === "single" ? ["z0", "eeff", "lambda", "vp", "delayPerM", "L", "C"]
    : ["ze", "zo", "zcomm", "zdiff", "z0", "eeffE", "eeffO", "lambdaOdd"];
  const nonnegative = r.kind === "single" ? ["ac", "acSmooth", "ad", "il", "ilTotal", "delay", "unwrapped", "phase", "R", "G"]
    : ["delayOdd"];
  for (const key of ["acOdd", "adOdd", "ilDiff", "ilDiffTotal", "thetaPerW"]) if (key in r) nonnegative.push(key);
  for (const key of ["fringe", "fSpur", "fRad", "z0single", "zdiffTD", "K", "skin"]) if (key in r) positive.push(key);
  const bad = positive.filter(k => !Number.isFinite(r[k]) || r[k] <= 0)
    .concat(nonnegative.filter(k => !Number.isFinite(r[k]) || r[k] < 0));
  const eps = r.kind === "single" ? [r.eeff] : [r.eeffE, r.eeffO];
  if (eps.some(e => e < 1 || e > r.er * (1 + 1e-9))) bad.push("有效介电常数");
  if (r.kind === "coupled" && (!(r.ze >= r.zo) || Number.isNaN(r.cc) || r.cc < 0)) bad.push("奇偶模关系");
  if ("p100" in r && !(r.p100 > 0 && (Number.isFinite(r.p100) || r.thetaPerW === 0))) bad.push("热估算");
  if (bad.length) throw new Error(`${designOf(r.design).name}模型在当前参数下无有效结果（${bad.join("、")}），请调整几何尺寸或使用场求解器`);
  return r;
}

function check(inp, geometry = true) {
  const design = designOf(inp.design);
  if (!design) throw new Error("请选择有效的传输线结构");
  const bad = [];
  const need = { f: "频率", h: "基材厚度", w: "线宽 W", sigma: "电导率" };
  for (const [k, label] of Object.entries(need)) if (!Number.isFinite(inp[k]) || !(inp[k] > 0)) bad.push(label);
  if (!Number.isFinite(inp.er) || inp.er <= 1) bad.push("Dk（当前板材模型要求大于 1）");
  for (const [k, label] of Object.entries({ tand: "Df", t: "铜厚", len: "线长" }))
    if (!Number.isFinite(inp[k]) || inp[k] < 0) bad.push(label);
  if (design.space && (!Number.isFinite(inp.s) || inp.s <= 0)) bad.push("间距 S");
  for (const k of ["sai", "nodule", "rms"]) if (inp.cu?.[k] != null && (!Number.isFinite(inp.cu[k]) || inp.cu[k] < 0)) bad.push(`铜箔 ${k}`);
  // Missing thermal data is represented by null/undefined/NaN in the material table/UI.
  if (inp.kth != null && !Number.isNaN(inp.kth) && (!Number.isFinite(inp.kth) || inp.kth <= 0)) bad.push("导热系数");
  if (bad.length) throw new Error(`请填写有效的有限数值：${bad.join("、")}`);
  if (geometry && inp.design === "GC" && inp.t > 0) {
    const d = (inp.t * 1.25 / Math.PI) * (1 + Math.log(4 * Math.PI * inp.w / inp.t));
    if (!Number.isFinite(d) || d < 0 || inp.s <= d)
      throw new Error("共面波导铜厚修正后的间隙无效，请增大间距 S 或减小铜厚");
  }
}
