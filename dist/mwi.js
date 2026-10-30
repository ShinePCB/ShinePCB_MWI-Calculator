import { t as i18n, language, localeTag, canonicalText, localizeStatic, changeLanguage } from "./i18n.js?v=095996b694";
/* 晟电板材阻抗计算器 – page logic.
 * Layout and workflow follow a microwave-impedance calculator: pick a structure, a SUNDEN material,
 * conductor / circuit / electrical parameters, then Calculate (analysis or width synthesis, at one
 * frequency or over a range). Numbers come from engine.js (KiCad WASM + closed-form models).
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { createEngine, DESIGNS as ENGINE_DESIGNS, djordjevicSarkar, NP2DB } from "./engine.js?v=095996b694";
import { MATERIALS } from "./materials.js?v=095996b694";

const DESIGNS = ENGINE_DESIGNS.map(d => ({ ...d, name: i18n(d.name) }));
const designOf = code => DESIGNS.find(d => d.code === code);
localizeStatic();

/* Site links used by the menu. */
const LINKS = {
  samples: "https://www.shinepcba.com/contact",
  contact: "https://www.shinepcba.com/contact",
};

/* Copper foils. Roughness values are typical industry figures for each foil class (Huray SAI and
 * nodule radius, RMS roughness); replace them with the foil supplier's data where available. */
const COPPER = [
  { desc: i18n("1/2 oz ED 电解铜"), t: 18, sai: 3.0, nodule: 0.2, rms: 2.0 },
  { desc: i18n("1 oz ED 电解铜"), t: 35, sai: 3.2, nodule: 0.2, rms: 2.4 },
  { desc: i18n("2 oz ED 电解铜"), t: 70, sai: 3.4, nodule: 0.2, rms: 2.8 },
  { desc: i18n("1/2 oz RTF 反转铜"), t: 18, sai: 2.3, nodule: 0.17, rms: 1.0 },
  { desc: i18n("1 oz RTF 反转铜"), t: 35, sai: 2.3, nodule: 0.17, rms: 1.1 },
  { desc: i18n("1/2 oz VLP 低轮廓铜"), t: 18, sai: 2.0, nodule: 0.17, rms: 0.8 },
  { desc: i18n("1/2 oz HVLP 超低轮廓铜"), t: 18, sai: 1.8, nodule: 0.15, rms: 0.5 },
  { desc: i18n("1 oz HVLP 超低轮廓铜"), t: 35, sai: 1.8, nodule: 0.15, rms: 0.5 },
  { desc: i18n("1/2 oz RA 压延铜"), t: 18, sai: 1.0, nodule: 0, rms: 0.4 },
  { desc: i18n("1 oz RA 压延铜"), t: 35, sai: 1.0, nodule: 0, rms: 0.4 },
];

/* Laminate thicknesses offered in the dropdown when the datasheet has no list (mm). */
const THICKNESS_MM = [0.127, 0.168, 0.254, 0.338, 0.381, 0.508, 0.762, 1.016, 1.524];

const DK_TYPES = [
  ["bulk", i18n("Bulk 体 Dk（10 GHz）")],
  ["wideband", i18n("Wideband 设计 Dk")],
  ["discrete", i18n("Discrete 离散频率 Dk")],
];

const UNITS = {
  metric: { dim: ["mm", 1e-3], thin: ["µm", 1e-6], len: ["mm", 1e-3], wave: ["mm", 1e-3], loss: ["dB/cm", 0.01], per: ["ps/cm", 0.01] },
  english: { dim: ["mil", 25.4e-6], thin: ["mil", 25.4e-6], len: ["inch", 0.0254], wave: ["inch", 0.0254], loss: ["dB/inch", 0.0254], per: ["ps/inch", 0.0254] },
};
/* Which unit kind each length field uses. */
const LEN_FIELDS = { h: "dim", t: "thin", w: "dim", s: "dim", len: "len" };

const AREAS = {
  designTypes: i18n("结构类型"),
  selectMaterial: i18n("选择材料"),
  materialProperties: i18n("材料属性"),
  conductorParameters: i18n("导体参数"),
  circuitParameters: i18n("线路参数"),
  electricalParameters: i18n("电气参数"),
};

const INFO = {
  h: [i18n("基材厚度"), i18n("单层介质的厚度，不含铜厚。带状线两侧各有一层该厚度的介质，地平面间距 = 2h + T；宽边耦合带状线的两根导体之间另有间距 S。下拉列表给出常用厚度，晟电板材厚度可按需定制。")],
  dkType: [i18n("Dk 类型"), i18n("Bulk：规格书在 10 GHz 下测得的 Z 向介电常数（IPC-TM-650 2.5.5.5）。Wideband：规格书的设计 Dk（8–40 GHz，差分相位长度法），适合阻抗设计、宽带射频与高速数字；有分厚度 Dk 的型号按所选厚度取值；没有设计 Dk 的型号取 10 GHz 值。Discrete：以设计 Dk 与 Df 拟合 Djordjevic–Sarkar 宽带模型，给出所选频率下的 Dk / Df。")],
  dk: ["Dk", i18n("计算使用的介电常数。选择材料或 Dk 类型时会自动填入，也可以手动修改；建议使用 Dk 类型给出的数值。")],
  df: ["Df", i18n("计算使用的损耗因子（tan δ），来自规格书 10 GHz 典型值，可手动修改。")],
  kth: [i18n("导热系数"), i18n("基材本身（不含铜）的 Z 向导热系数，来自规格书 80 ℃ 测试值，用于估算温升与功率容量。")],
  cuType: [i18n("铜箔类型"), i18n("选择铜箔后会带入铜厚和表面粗糙度参数。粗糙度参数为该类铜箔的行业典型值，实际以铜箔供应商数据为准。")],
  t: [i18n("铜厚"), i18n("导体（信号线）的厚度。选铜箔类型时带入基铜厚度；实际成品通常还有电镀加厚，建议按成品铜厚填写。")],
  sai: [i18n("表面积指数 SAI"), i18n("Huray 粗糙度模型中的表面积指数（铜瘤总表面积与平面面积之比）。与平均瘤粒半径一起修正铜箔粗糙度带来的额外导体损耗。")],
  nodule: [i18n("平均瘤粒半径"), i18n("Huray 模型中铜瘤的平均半径。填 0 时改用 Hammerstad 模型，按 RMS 粗糙度修正导体损耗。")],
  rms: [i18n("表面粗糙度 RMS"), i18n("铜箔表面的均方根粗糙度，瘤粒半径为 0 时用于 Hammerstad 粗糙度修正。")],
  sigma: [i18n("电导率"), i18n("铜的电导率，默认 5.8 × 10⁷ S/m（退火纯铜）。除非清楚它对模型的影响，一般不建议修改。")],
  w: [i18n("线宽 W"), i18n("信号导体的宽度。综合模式下由目标阻抗反求得到。")],
  s: [i18n("间距 S"), i18n("耦合线两根导体之间的间距；接地共面波导为信号线到两侧地的间隙；宽边耦合带状线为上下两根导体之间的介质厚度。单根微带线和带状线不使用该值。")],
  len: [i18n("线长 L"), i18n("传输线长度，用于总插损、传播时延、相位和温升计算。")],
  calc: [i18n("计算类型"), i18n("分析：由几何尺寸计算阻抗、损耗等全部结果，推荐使用。综合：保持其他参数不变，由目标阻抗反求线宽 W（耦合线按差分阻抗求解），然后给出该线宽下的分析结果。")],
  freq: [i18n("频率计算"), i18n("离散：在单个频率下计算。范围：在最小与最大频率之间按步长扫描，输出每个频点的 Dk、阻抗与损耗表格和曲线。")],
  z: [i18n("目标阻抗"), i18n("综合模式使用的目标阻抗。单端结构为特性阻抗 Z0，耦合结构为差分阻抗 Zdiff。")],
  f: [i18n("离散频率"), i18n("单频计算使用的频率；综合模式下也是反求线宽的频率。")],
  fmin: [i18n("最小频率"), i18n("范围计算的起始频率。")],
  fmax: [i18n("最大频率"), i18n("范围计算的终止频率。")],
  fstep: [i18n("步长"), i18n("范围计算的频率间隔，最多 2000 个频点。")],
};

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
const round = (v, sig = 6) => (Number.isFinite(v) ? String(Number(v.toPrecision(sig))) : "");
const fx = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const sci = (v, d = 3) => (Number.isFinite(v) ? v.toExponential(d).replace("e+", "e") : "—");
const numOf = (id) => { const el = document.getElementById(id); if (!el) return NaN; const t = el.value.trim().replace(",", "."); return t === "" ? NaN : Number(t); };
const INFO_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 7v4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="4.6" r="1" fill="currentColor"/></svg>`;

/* ---------- state ---------- */
let engine;
let units = "metric";
let design = "M";
let material = MATERIALS.find((m) => m.name === "CFG294") ?? MATERIALS[0];
let last = null; // last calculation, for the CSV download

const DEFAULTS = {
  metric: { h: "0.254", t: "18", w: "0.62", s: "0.2", len: "25.4" },
  english: { h: "10", t: "0.71", w: "24.4", s: "7.87", len: "1" },
};

/* ---------- area markup ---------- */
const infoBtn = (k) => (INFO[k] ? i18n`<button type="button" class="info" data-info="${k}" aria-label="${esc(INFO[k][0])} 说明">${INFO_ICON}</button>` : "");
function frow(id, label, ctl, unit = "", info = id) {
  return `<div class="frow" data-row="${id}"><label for="${id}">${label}</label><div class="ctl">${ctl}${unit !== null ? `<span class="unit" id="${id}-u">${unit}</span>` : ""}</div>${infoBtn(info)}</div>`;
}
const input = (id, v = "") => `<input id="${id}" inputmode="decimal" autocomplete="off" spellcheck="false" value="${esc(v)}">`;
const combo = (id, v = "", mode = "decimal") => i18n`<div class="combo">${`<input id="${id}" inputmode="${mode}" autocomplete="off" spellcheck="false" value="${esc(v)}">`}<button type="button" class="combo-btn" data-combo="${id}" aria-label="展开选项"></button><ul class="combo-list" id="${id}-list" hidden></ul></div>`;
const toggle = (id, off, on, info) => `<div class="frow" data-row="${id}"><span class="lbl">${INFO[info][0]}</span><div class="ctl toggle"><button type="button" class="switch-lbl" data-tog="${id}" data-val="0">${off}</button><label class="switch"><input type="checkbox" id="${id}" aria-label="${esc(INFO[info][0])}"><span></span></label><button type="button" class="switch-lbl" data-tog="${id}" data-val="1">${on}</button></div>${infoBtn(info)}</div>`;

function buildAreas() {
  const series = [...new Set(MATERIALS.map((m) => m.series))];
  const img = (d) => i18n`<img src="${imgSrc(d)}" alt="${esc(d.name)}截面示意">`;
  const html = {
    designTypes: DESIGNS.map((d) => `<button type="button" class="dt" data-design="${d.code}">
        <span class="dt-head"><strong>${d.name}</strong><small>${d.en}</small></span>
        <span class="dt-img">${img(d)}</span>
        <span class="dt-note">${designNote(d.code)}</span>
      </button>`).join(""),
    selectMaterial: i18n`<div class="mat-tools"><input id="matSearch" type="search" placeholder="搜索型号" aria-label="搜索型号">
        <button type="button" class="chip" data-series="" aria-pressed="true">全部</button>${series.map((s) => `<button type="button" class="chip" data-series="${esc(s)}" aria-pressed="false">${esc(i18n(s))}</button>`).join("")}</div>
      <div class="mat-wrap"><table class="mat-table"><thead><tr><th>型号</th><th class="num">Dk<br><small>10 GHz</small></th><th class="num">设计 Dk<br><small>8–40 GHz</small></th><th class="num">Df<br><small>10 GHz</small></th><th class="num">导热系数<br><small>W/(m·K)</small></th></tr></thead>
      <tbody>${MATERIALS.map((m) => `<tr data-mat="${esc(m.name)}" data-series="${esc(i18n(m.series))}"><td><b>${esc(m.name)}</b> <span class="series">${esc(i18n(m.series))}</span></td><td class="num">${m.dk.toFixed(2)}${m.dkTol ? `<small class="na"> ±${m.dkTol}</small>` : ""}</td><td class="num">${m.designDk ?? `<span class="na">—</span>`}</td><td class="num">${m.df}</td><td class="num">${m.kth ?? `<span class="na">—</span>`}</td></tr>`).join("")}</tbody></table></div>
      <p class="frow-note">数据来自《晟电产品规格书》典型值。点击一行选择材料，会带入 Dk、Df、导热系数和常用厚度。</p>`,
    materialProperties: [
      frow("h", i18n("基材厚度 h"), combo("h"), ""),
      frow("dkType", i18n("Dk 类型"), `<select id="dkType">${DK_TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`, null),
      frow("dk", "Dk", input("dk"), ""),
      frow("df", "Df", input("df"), ""),
      frow("kth", i18n("导热系数"), input("kth"), "W/(m·K)"),
      `<p class="frow-note" id="matNote"></p>`,
    ].join(""),
    conductorParameters: [
      frow("cuType", i18n("铜箔类型"), combo("cuType", "", "text"), null),
      frow("t", i18n("铜厚 T"), input("t"), ""),
      frow("sai", i18n("表面积指数 SAI"), input("sai"), ""),
      frow("nodule", i18n("平均瘤粒半径"), input("nodule"), "µm"),
      frow("rms", i18n("表面粗糙度 RMS"), input("rms"), "µm"),
      frow("sigma", i18n("电导率"), input("sigma", "5.8"), "× 10⁷ S/m"),
      i18n(`<p class="frow-note">铜箔粗糙度参数为行业典型值，可按铜箔供应商数据修改。</p>`),
    ].join(""),
    circuitParameters: [
      frow("w", i18n("线宽 W"), input("w"), ""),
      frow("s", i18n("间距 S"), input("s"), ""),
      frow("len", i18n("线长 L"), input("len"), ""),
      `<p class="frow-note" id="spaceNote"></p>`,
    ].join(""),
    electricalParameters: [
      toggle("calcType", i18n("分析"), i18n("综合"), "calc"),
      toggle("freqType", i18n("离散"), i18n("范围"), "freq"),
      frow("z", i18n(`<span id="zLabel">目标阻抗 Z0</span>`), input("z", "50"), "Ω"),
      frow("f", i18n("离散频率"), input("f", "10"), "GHz"),
      i18n(`<p class="frow-note">范围计算的频率：</p>`),
      frow("fmin", i18n("最小频率"), input("fmin", "1"), "GHz"),
      frow("fmax", i18n("最大频率"), input("fmax", "40"), "GHz"),
      frow("fstep", i18n("步长"), input("fstep", "1"), "GHz"),
    ].join(""),
  };
  $("#areaSection").innerHTML = Object.entries(html).map(([k, v]) => `<div class="area-pane" data-pane="${k}" hidden>${v}</div>`).join("");
}

function designNote(code) {
  return {
    GC: i18n("信号线两侧为共面地（间隙 S），底面为参考地。"),
    M: i18n("表层信号线，下方一层介质 h 到参考地。"),
    ME: i18n("表层两根平行信号线，间距 S。"),
    S: i18n("内层信号线居中，上下各一层介质 h（地间距 2h + T）。"),
    SE: i18n("内层两根平行信号线居中，间距 S。"),
    SB: i18n("上下叠放的两根信号线，相距 S，外侧各一层介质 h。"),
  }[code];
}
const imgSrc = (d) => (d.code === "SB" ? "./img/broadside_stripline.svg?v=095996b694" : `./img/kicad/${d.img}.png`);

/* ---------- area switching ---------- */
let area = "designTypes";
function switchArea(name, flash) {
  area = name;
  $("#areaName").textContent = AREAS[name];
  for (const p of $$(".area-pane")) p.hidden = p.dataset.pane !== name;
  for (const a of $$(".nav-tree a")) {
    const active = a.dataset.area === name;
    a.classList.toggle("is-active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  $(".design-pick").classList.toggle("is-active", name === "designTypes");
  if (name === "selectMaterial") $(`tr[data-mat="${CSS.escape(material.name)}"]`)?.scrollIntoView({ block: "nearest" });
  for (const b of $$(".sum-item")) b.classList.toggle("is-active", b.dataset.area === name && (!flash || b.dataset.field === flash));
  if (flash) {
    const row = $(`.frow[data-row="${flash}"]`);
    if (row) { row.classList.remove("is-flash"); void row.offsetWidth; row.classList.add("is-flash"); }
  }
  if (matchMedia("(max-width: 900px)").matches) {
    const wasOpen = $("#sideNav").classList.contains("is-open");
    setNavOpen(false);
    if (wasOpen) $("#areaName").focus({ preventScroll: true });
    $(".col-area").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
  }
}

/* ---------- design / material / copper ---------- */
function setDesign(code, quiet) {
  const prev = designOf(design);
  design = code;
  const d = designOf(code);
  for (const b of $$(".dt")) b.classList.toggle("is-active", b.dataset.design === code);
  $("#designImg").innerHTML = i18n`<img src="${imgSrc(d)}" alt="${esc(d.name)}截面示意">`;
  $("#designCaption").textContent = i18n`${d.name} · 选择结构类型`;
  // Space is only used by some structures; give it a sensible value when it becomes relevant.
  $("#s").disabled = !d.space;
  $(`.frow[data-row="s"]`).classList.toggle("is-off", !d.space);
  if (d.space && !(numOf("s") > 0)) $("#s").value = DEFAULTS[units].s;
  $("#spaceNote").textContent = d.space ? designNote(code) : i18n`${d.name}不使用间距 S。`;
  $("#zLabel").textContent = d.coupled ? i18n("目标差分阻抗 Zdiff") : i18n("目标阻抗 Z0");
  if (!quiet && prev && prev.coupled !== d.coupled) $("#z").value = d.coupled ? "100" : "50";
  changed();
}

function thicknessesMm(m) {
  if (m.cured) return [m.cured];
  if (m.dkByThickness) return m.dkByThickness.map((e) => e.h);
  return THICKNESS_MM;
}
const mmToDisplay = (mm) => round((mm * 1e-3) / UNITS[units].dim[1], units === "metric" ? 6 : 4);
function fillThicknessList() {
  const list = thicknessesMm(material);
  $("#h-list").innerHTML = list.map((mm) => {
    const dk = material.dkByThickness?.find((e) => e.h === mm)?.dk;
    return `<li><button type="button" data-pick="h" data-v="${mmToDisplay(mm)}">${mmToDisplay(mm)} ${UNITS[units].dim[0]}${dk ? `<small>Dk ${dk}</small>` : ""}</button></li>`;
  }).join("");
}
function fillCopperList() {
  $("#cuType-list").innerHTML = COPPER.map((c, i) => `<li><button type="button" data-pick="cuType" data-i="${i}">${esc(c.desc)}</button></li>`).join("");
}
function applyCopper(i) {
  const c = COPPER[i];
  $("#cuType").value = c.desc;
  $("#t").value = round((c.t * 1e-6) / UNITS[units].thin[1], 3);
  $("#sai").value = c.sai;
  $("#nodule").value = c.nodule;
  $("#rms").value = c.rms;
}

function setMaterial(name, quiet) {
  material = MATERIALS.find((m) => m.name === name) ?? material;
  for (const tr of $$("tr[data-mat]")) tr.classList.toggle("is-active", tr.dataset.mat === material.name);
  $("#dkType").value = "bulk";
  $("#dk").value = material.dk;
  $("#df").value = material.df;
  $("#kth").value = material.kth ?? "";
  // Keep the thickness when the new material offers it, otherwise take 0.254 mm or the first entry.
  const list = thicknessesMm(material);
  const hmm = hMm();
  if (!quiet && !list.some((mm) => Math.abs(mm - hmm) < 1e-6)) {
    $("#h").value = mmToDisplay(list.includes(0.254) ? 0.254 : list[0]);
  }
  fillThicknessList();
  matNote();
  changed();
}
function matNote() {
  const m = material;
  const bits = [`${m.name}：Dk ${m.dk}${m.dkTol ? ` ± ${m.dkTol}` : ""} @ 10 GHz，Df ${m.df}`];
  if (m.designDk) bits.push(i18n`设计 Dk ${m.designDk}（8–40 GHz）`);
  if (m.dkByThickness) bits.push(i18n`按厚度 Dk：${m.dkByThickness.map((e) => `${e.h} mm → ${e.dk}`).join("，")}`);
  if (m.cured) bits.push(i18n`粘结片固化厚度 ${m.cured} mm`);
  if (m.tcdk !== null && m.tcdk !== undefined) bits.push(`TCDk ${m.tcdk} ppm/℃`);
  if (m.kth === null) bits.push(i18n("规格书未给出导热系数，温升不计算"));
  $("#matNote").textContent = bits.join("；") + "。";
}

/* ---------- Dk type ---------- */
const hMm = () => (numOf("h") * UNITS[units].dim[1]) / 1e-3;
function wideDk(m, mm) {
  if (m.dkByThickness && Number.isFinite(mm)) {
    let best = null;
    for (const e of m.dkByThickness) if (Math.abs(e.h - mm) <= (e.hTol ?? 0.01) && (!best || Math.abs(e.h - mm) < Math.abs(best.h - mm))) best = e;
    if (best) return best.dk;
  }
  return m.designDk ?? m.dk;
}
function dkFor(type, fHz) {
  const m = material;
  if (type === "bulk") return { dk: m.dk, df: m.df };
  const wd = wideDk(m, hMm());
  if (type === "wideband") return { dk: wd, df: m.df };
  const ds = djordjevicSarkar(wd, m.df, 10e9);
  return { dk: ds.eps(fHz), df: ds.tan(fHz) };
}
function refreshDk() {
  const type = $("#dkType").value;
  const f = numOf("f") * 1e9;
  const { dk, df } = dkFor(type, Number.isFinite(f) && f > 0 ? f : 10e9);
  $("#dk").value = type === "bulk" ? dk : dk.toFixed(3);
  $("#df").value = type === "discrete" ? df.toFixed(5) : df;
  changed();
}

/* ---------- electrical toggles ---------- */
function electrical() {
  const synth = $("#calcType").checked, range = $("#freqType").checked;
  $("#z").readOnly = !synth;
  $("#f").readOnly = range && !synth;
  for (const id of ["fmin", "fmax", "fstep"]) $(`#${id}`).readOnly = !range;
  for (const b of $$("[data-tog]")) {
    const on = $(`#${b.dataset.tog}`).checked;
    b.classList.toggle("is-on", (b.dataset.val === "1") === on);
  }
  changed();
}

/* ---------- units ---------- */
function setUnits(next) {
  if (next === units) return;
  const from = UNITS[units], to = UNITS[next];
  for (const [id, kind] of Object.entries(LEN_FIELDS)) {
    const el = $(`#${id}`), v = numOf(id);
    if (!Number.isFinite(v)) continue;
    // Keep the exact SI value across round trips unless the user edited the shown number.
    const si = el.dataset.shown === el.value && el.dataset.si ? Number(el.dataset.si) : v * from[kind][1];
    el.value = round(si / to[kind][1], 6);
    el.dataset.si = si;
    el.dataset.shown = el.value;
  }
  units = next;
  $("#unitSwitch").checked = next === "metric";
  unitLabels();
  fillThicknessList();
  store.set("sunden.units", next);
  changed();
}
function unitLabels() {
  for (const [id, kind] of Object.entries(LEN_FIELDS)) $(`#${id}-u`).textContent = UNITS[units][kind][0];
  for (const b of $$("[data-unit]")) b.disabled = b.dataset.unit === units;
}

/* ---------- inputs → engine ---------- */
function gather() {
  const U = UNITS[units];
  const cu = { sai: numOf("sai"), nodule: numOf("nodule") * 1e-6, rms: numOf("rms") * 1e-6 };
  if (!(cu.sai >= 0)) cu.sai = 0;
  if (!(cu.nodule >= 0)) cu.nodule = 0;
  if (!(cu.rms >= 0)) cu.rms = 0;
  const d = designOf(design);
  return {
    design,
    er: numOf("dk"), tand: numOf("df"), kth: numOf("kth"),
    h: numOf("h") * U.dim[1], t: numOf("t") * U.thin[1], w: numOf("w") * U.dim[1],
    s: d.space ? numOf("s") * U.dim[1] : 0, len: numOf("len") * U.len[1],
    sigma: numOf("sigma") * 1e7, cu,
    f: numOf("f") * 1e9,
  };
}

function frequencies() {
  const a = numOf("fmin"), b = numOf("fmax"), st = numOf("fstep");
  if (!(a > 0 && b >= a && st > 0)) throw new Error(i18n("请填写有效的范围：最小频率 > 0，最大频率 ≥ 最小频率，步长 > 0。"));
  const n = Math.floor((b - a) / st + 1e-9) + 1;
  if (n > 2000) throw new Error(i18n`频点数 ${n} 超过 2000，请加大步长。`);
  const out = [];
  for (let i = 0; i < n; i++) out.push(Number((a + i * st).toPrecision(12)));
  if (out[out.length - 1] < b - 1e-9) out.push(b);
  return out;
}

function calculate() {
  const btns = $$(".calc-btn");
  for (const b of btns) { b.classList.add("is-busy"); b.disabled = true; }
  // Let the spinner paint before a long sweep.
  setTimeout(() => {
    try { runCalc(); } catch (e) { showError(e.message); }
    finally { for (const b of btns) { b.classList.remove("is-busy"); b.disabled = false; } }
  }, 30);
}

function runCalc() {
  const inp = gather();
  const synth = $("#calcType").checked, range = $("#freqType").checked;
  const d = designOf(design);
  let synthInfo = null;
  if (synth) {
    const target = numOf("z");
    if (!(target > 0)) throw new Error(i18n("请填写有效的目标阻抗。"));
    if (!(inp.f > 0)) throw new Error(i18n("请填写有效的离散频率（综合在该频率下求解）。"));
    const s = engine.synthesize(inp, target);
    inp.w = s.w;
    $("#w").value = round(s.w / UNITS[units].dim[1], 5);
    synthInfo = { target, w: s.w };
  }
  if (!range) {
    const r = engine.analyse(inp);
    last = { kind: "discrete", rows: resultRows(r, inp, synthInfo) };
    renderDiscrete(last.rows);
  } else {
    const fs = frequencies();
    const type = $("#dkType").value;
    // Discrete Dk type: disperse around the Dk / Df shown for the discrete frequency; otherwise constant.
    const ds = type === "discrete" && inp.f > 0 ? djordjevicSarkar(inp.er, inp.tand, inp.f) : null;
    const points = fs.map((g) => {
      const f = g * 1e9;
      const er = ds ? ds.eps(f) : inp.er, tand = ds ? ds.tan(f) : inp.tand;
      return engine.analyse({ ...inp, f, er, tand });
    });
    last = { kind: "range", ...rangeTable(points, inp, d), head: [[i18n("模型"), modelName(inp)], ...(synthInfo ? synthRows(synthInfo, d) : [])] };
    renderRange(last);
  }
  $("#csvBtn").hidden = false;
  summary();
}

/* ---------- result rows ---------- */
function modelName(inp) {
  const d = designOf(design), U = UNITS[units];
  return i18n`${d.name}，${round(inp.h / U.dim[1], 5)} ${U.dim[0]} 厚 ${material.name}，${$("#cuType").value || i18n("自定义铜箔")}`;
}
const dkTypeLabel = () => DK_TYPES.find(([v]) => v === $("#dkType").value)?.[1] ?? "";
function synthRows(s, d) {
  const U = UNITS[units];
  return [[i18n("综合线宽 W"), `${fx(s.w / U.dim[1], units === "metric" ? 4 : 3)} ${U.dim[0]}`, "key"], [d.coupled ? i18n("目标差分阻抗") : i18n("目标阻抗"), `${s.target} Ω`]];
}

function resultRows(r, inp, synthInfo) {
  const U = UNITS[units], d = designOf(design);
  const loss = (v) => `${fx(v * U.loss[1], 4)} ${U.loss[0]}`;
  const wave = (v) => `${fx(v / U.wave[1], 3)} ${U.wave[0]}`;
  const dim = (v) => `${fx(v / U.dim[1], units === "metric" ? 4 : 3)} ${U.dim[0]}`;
  const ghz = (v) => (Number.isFinite(v) ? `${fx(v / 1e9, v < 10e9 ? 1 : 0)} GHz` : "—");
  const L = `${round(inp.len / U.len[1], 5)} ${U.len[0]}`;
  const rows = [[i18n("模型"), modelName(inp)]];
  if (synthInfo) rows.push(...synthRows(synthInfo, d));
  rows.push([i18n("频率"), `${round(inp.f / 1e9)} GHz`], [i18n("Dk 类型"), dkTypeLabel()], ["Dk", fx(r.er, 3)], ["Df", round(r.tand, 4)]);

  if (r.kind === "single") {
    rows.push(
      [i18n("特性阻抗 Z0"), `${fx(r.z0, 2)} Ω`, "key"],
      [i18n("有效介电常数 εeff"), fx(r.eeff, 3)],
      [i18n("插入损耗"), loss(r.il), "key"],
      [i18n("导体损耗"), loss(r.ac)],
      [i18n("介质损耗"), loss(r.ad)],
      [i18n("铜箔粗糙度系数 K"), fx(r.K, 3)],
      [i18n`线长 ${L} 总插损`, `${fx(r.ilTotal, 4)} dB`],
      [i18n("波长 λg"), wave(r.lambda)],
      [i18n("1/2 波长"), wave(r.lambda / 2)],
      [i18n("1/4 波长"), wave(r.lambda / 4)],
      [i18n("1/8 波长"), wave(r.lambda / 8)],
      [i18n("1/10 波长"), wave(r.lambda / 10)],
    );
    if (r.fSpur) rows.push([i18n("高次模 / 杂散模最低频率"), ghz(r.fSpur)]);
    if (r.fRad) rows.push([i18n("开路端辐射超过 5% 的最低频率"), ghz(r.fRad)]);
    rows.push(
      [i18n("相速度"), `${sci(r.vp)} m/s`],
      [i18n`传播时延（线长 ${L}）`, `${fx(r.delay * 1e12, 3)} ps`],
      [i18n("单位长度时延"), `${fx(r.delayPerM * 1e12 * U.per[1], 3)} ${U.per[0]}`],
      [i18n("展开相位"), `${fx(r.unwrapped, 3)}°`],
      [i18n("相位"), `${fx(r.phase, 3)}°`],
      [i18n("趋肤深度"), units === "metric" ? `${fx(r.skin * 1e6, 3)} µm` : `${fx(r.skin / 25.4e-6, 4)} mil`],
    );
    if (r.fringe) rows.push([i18n("开路端 / 缝隙边缘效应长度"), dim(r.fringe)]);
    rows.push(
      [i18n("RLGC 参数 R"), `${sci(r.R)} Ω/m`],
      [i18n("RLGC 参数 L"), `${sci(r.L)} H/m`],
      [i18n("RLGC 参数 G"), `${sci(r.G)} S/m`],
      [i18n("RLGC 参数 C"), `${sci(r.C)} F/m`],
    );
    if (r.thetaPerW) rows.push([i18n("近似温升"), `${fx(r.thetaPerW, 3)} ℃/W`], [i18n("温升 100 ℃ 对应功率"), `${fx(r.p100, 2)} W`]);
  } else {
    if (design === "ME") rows.push([i18n("单线特性阻抗 Z0（无耦合）"), `${fx(r.z0single, 2)} Ω`]);
    else rows.push([i18n("特性阻抗 √(Ze·Zo)"), `${fx(r.z0, 2)} Ω`]);
    rows.push(
      [i18n("偶模阻抗 Zeven"), `${fx(r.ze, 2)} Ω`],
      [i18n("奇模阻抗 Zodd"), `${fx(r.zo, 2)} Ω`],
      [i18n("共模阻抗 Zcomm"), `${fx(r.zcomm, 2)} Ω`],
      [i18n("差分阻抗 Zdiff"), `${fx(r.zdiff, 2)} Ω`, "key"],
    );
    if (design === "ME") rows.push([i18n("差分阻抗（时域，IPC-2141）"), `${fx(r.zdiffTD, 2)} Ω`], [i18n("偶模有效介电常数"), fx(r.eeffE, 3)], [i18n("奇模有效介电常数"), fx(r.eeffO, 3)]);
    rows.push([i18n("耦合度"), `${fx(r.cc, 2)} dB`]);
    if (design === "ME") rows.push([i18n("差分插入损耗"), loss(r.ilDiff)], [i18n`线长 ${L} 差分总插损`, `${fx(r.ilDiffTotal, 4)} dB`]);
    rows.push([i18n`奇模传播时延（线长 ${L}）`, `${fx(r.delayOdd * 1e12, 3)} ps`], [i18n("奇模波长"), wave(r.lambdaOdd)]);
  }
  return rows;
}

function rangeTable(points, inp, d) {
  const U = UNITS[units];
  const lo = (v) => fx(v * U.loss[1], 4);
  if (!d.coupled) {
    return {
      cols: [i18n("频率 (GHz)"), "Dk", "Df", "Z0 (Ω)", "εeff", i18n`介质损耗 (${U.loss[0]})`, i18n`导体损耗 (${U.loss[0]})`, i18n`插入损耗 (${U.loss[0]})`],
      rows: points.map((r) => [round(r.f / 1e9), fx(r.er, 3), round(r.tand, 4), fx(r.z0, 2), fx(r.eeff, 3), lo(r.ad), lo(r.ac), lo(r.il)]),
      chart: { unit: U.loss[0], title: i18n("损耗随频率变化"), series: [[i18n("插入损耗"), "#3d8bfd", points.map((r) => r.il * U.loss[1])], [i18n("导体损耗"), "#f0883e", points.map((r) => r.ac * U.loss[1])], [i18n("介质损耗"), "#3fb950", points.map((r) => r.ad * U.loss[1])]], x: points.map((r) => r.f / 1e9) },
    };
  }
  const me = design === "ME";
  return {
    cols: [i18n("频率 (GHz)"), "Dk", "Zdiff (Ω)", "Zeven (Ω)", "Zodd (Ω)", i18n("耦合度 (dB)"), ...(me ? [i18n`差分插损 (${U.loss[0]})`] : [])],
    rows: points.map((r) => [round(r.f / 1e9), fx(r.er, 3), fx(r.zdiff, 2), fx(r.ze, 2), fx(r.zo, 2), fx(r.cc, 2), ...(me ? [lo(r.ilDiff)] : [])]),
    chart: me
      ? { unit: U.loss[0], title: i18n("差分插入损耗随频率变化"), series: [[i18n("差分插损"), "#3d8bfd", points.map((r) => r.ilDiff * U.loss[1])]], x: points.map((r) => r.f / 1e9) }
      : { unit: "Ω", title: i18n("阻抗随频率变化"), series: [["Zdiff", "#3d8bfd", points.map((r) => r.zdiff)], ["Zeven", "#f0883e", points.map((r) => r.ze)], ["Zodd", "#3fb950", points.map((r) => r.zo)]], x: points.map((r) => r.f / 1e9) },
  };
}

/* ---------- output rendering ---------- */
function renderDiscrete(rows) {
  $("#output").innerHTML = rows.map(([k, v, cls]) => `<div class="out-row${cls ? ` ${cls}` : ""}"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("") + notes();
}
function renderRange(res) {
  $("#output").innerHTML = res.head.map(([k, v, cls]) => `<div class="out-row${cls ? ` ${cls}` : ""}"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("") +
    `<div class="chart">${chart(res.chart)}</div>` +
    `<div class="range-wrap"><table><thead><tr>${res.cols.map((c) => `<th class="num">${esc(c)}</th>`).join("")}</tr></thead><tbody>${res.rows.map((r) => `<tr>${r.map((c) => `<td class="num">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` + notes();
}
function notes() {
  const d = designOf(design);
  const n = [i18n("阻抗、有效介电常数与微带 / 共面 / 耦合线损耗由 KiCad 传输线模型计算；导体损耗含 Huray / Hammerstad 铜箔粗糙度修正。")];
  if (design === "S") n.push(i18n("带状线导体损耗采用 Pozar（Wheeler 增量电感）公式。"));
  if (design === "GC") n.push(i18n("接地共面波导导体损耗采用 Ghione 公式。"));
  if (design === "SB") n.push(i18n("宽边耦合带状线采用 Cohn 公式（导体按零厚度处理）。"));
  if (!d.coupled && numOf("kth") > 0 && last?.kind === "discrete") n.push(i18n("温升按介质单向（带状线双向）导热、损耗功率全部转为热量估算，仅供参考。"));
  if (!d.coupled && !(numOf("kth") > 0)) n.push(i18n("未填写导热系数，不计算温升。"));
  return n.map((t) => `<p class="out-note">${esc(t)}</p>`).join("");
}
function showError(msg) {
  $("#output").innerHTML = `<div class="err-box" role="alert">${esc(i18n(msg))}</div>`;
  $("#csvBtn").hidden = true;
  last = null;
}
function clearOutput() {
  if (!last && $("#output .empty")) return;
  last = null;
  $("#output").innerHTML = i18n(`<p class="empty">暂无计算结果。设置参数后点击“计算”。</p>`);
  $("#csvBtn").hidden = true;
}

/** Plain SVG line chart: x in GHz, one or more series sharing the y axis. */
function chart({ x, series, unit, title }) {
  const W = 520, H = 280, L = 52, R = 12, T = 26, B = 40;
  const ys = series.flatMap(([, , v]) => v).filter(Number.isFinite);
  if (!ys.length || x.length < 2) return "";
  const x0 = x[0], x1 = x[x.length - 1];
  let y0 = Math.min(0, ...ys), y1 = Math.max(...ys);
  if (unit === "Ω") { y0 = Math.min(...ys); y1 = Math.max(...ys); const pad = (y1 - y0) * 0.1 || 1; y0 -= pad; y1 += pad; }
  const ticks = niceTicks(y0, y1, 5);
  y0 = ticks[0]; y1 = ticks[ticks.length - 1];
  const xt = niceTicks(x0, x1, 6).filter((v) => v >= x0 - 1e-9 && v <= x1 + 1e-9);
  const px = (v) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - R);
  const py = (v) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);
  const grid = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${py(v)}" y2="${py(v)}" stroke="var(--chart-grid)"/><text x="${L - 8}" y="${py(v) + 4}" text-anchor="end">${round(v, 4)}</text>`).join("");
  const xg = xt.map((v) => `<text x="${px(v)}" y="${H - B + 18}" text-anchor="middle">${round(v, 4)}</text>`).join("");
  const lines = series.map(([, color, v]) => `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${v.map((y, i) => `${px(x[i]).toFixed(1)},${py(y).toFixed(1)}`).join(" ")}"/>`).join("");
  return i18n`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" font-size="12.5" fill="var(--muted)">
    <text x="${L}" y="15" font-size="13.5" fill="var(--text)">${esc(title)}（${esc(unit)}）</text>${grid}${xg}
    <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="var(--muted)"/>
    <text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">频率 (GHz)</text>${lines}</svg>
    <div class="legend">${series.map(([n, c]) => `<span><i style="background:${c}"></i>${esc(n)}</span>`).join("")}</div>`;
}
function niceTicks(a, b, n) {
  if (a === b) b = a + 1;
  const raw = (b - a) / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.floor(a / step) * step; v <= b + step * 0.5; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/* ---------- CSV ---------- */
function downloadCsv() {
  if (!last) return;
  const q = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = last.kind === "discrete"
    ? last.rows.map(([k, v]) => `${q(k)},${q(v)}`)
    : [...last.head.map(([k, v]) => `${q(k)},${q(v)}`), "", last.cols.map(q).join(","), ...last.rows.map((r) => r.map(q).join(","))];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${material.name}_${design}_${last.kind === "range" ? "frequency_range" : "results"}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- summary, JSON, share link ---------- */
const FIELD_IDS = ["h", "dkType", "dk", "df", "kth", "cuType", "t", "sai", "nodule", "rms", "sigma", "w", "s", "len", "z", "f", "fmin", "fmax", "fstep"];
function snapshot() {
  const fields = {};
  for (const id of FIELD_IDS) fields[id] = $(`#${id}`).value;
  return { v: 1, design, material: material.name, units, calc: $("#calcType").checked ? "synthesis" : "analysis", freq: $("#freqType").checked ? "range" : "discrete", fields };
}
function restore(st) {
  if (!st || st.v !== 1) return false;
  if (st.units && UNITS[st.units]) { units = st.units; $("#unitSwitch").checked = units === "metric"; unitLabels(); }
  if (st.material) setMaterial(st.material, true);
  for (const [id, v] of Object.entries(st.fields ?? {})) if (FIELD_IDS.includes(id) && $(`#${id}`)) $(`#${id}`).value = id === "cuType" ? i18n(canonicalText(v)) : v;
  fillThicknessList();
  matNote();
  $("#calcType").checked = st.calc === "synthesis";
  $("#freqType").checked = st.freq === "range";
  setDesign(designOf(st.design) ? st.design : design, true);
  electrical();
  return true;
}

function summary() {
  const d = designOf(design), U = UNITS[units];
  $("#inputTitle").textContent = i18n`输入参数 · ${d.name}`;
  const range = $("#freqType").checked, synth = $("#calcType").checked;
  const items = [
    [i18n("材料"), material.name, "selectMaterial", ""],
    [i18n("Dk 类型"), DK_TYPES.find(([v]) => v === $("#dkType").value)?.[1].split(" ")[0] ?? "", "materialProperties", "dkType"],
    ["Dk, Df", `${$("#dk").value}, ${$("#df").value}`, "materialProperties", "dk"],
    [i18n("基材厚度"), `${$("#h").value} ${U.dim[0]}`, "materialProperties", "h"],
    [i18n("铜箔类型"), $("#cuType").value || "—", "conductorParameters", "cuType"],
    [i18n("铜厚"), `${$("#t").value} ${U.thin[0]}`, "conductorParameters", "t"],
    [i18n("线宽 W"), `${$("#w").value} ${U.dim[0]}`, "circuitParameters", "w"],
    ...(d.space ? [[i18n("间距 S"), `${$("#s").value} ${U.dim[0]}`, "circuitParameters", "s"]] : []),
    [i18n("线长 L"), `${$("#len").value} ${U.len[0]}`, "circuitParameters", "len"],
    [i18n("计算类型"), synth ? i18n`综合 ${$("#z").value} Ω` : i18n("分析"), "electricalParameters", synth ? "z" : "calcType"],
    [range ? i18n("频率范围") : i18n("离散频率"), range ? `${$("#fmin").value}–${$("#fmax").value} GHz` : `${$("#f").value} GHz`, "electricalParameters", range ? "fmin" : "f"],
  ];
  $("#inputSummary").innerHTML = items.map(([k, v, a, f]) => `<button type="button" class="sum-item" data-area="${a}" data-field="${f}"><span>${esc(k)}</span><b>${esc(v)}</b></button>`).join("");

  const inp = (() => { try { return gather(); } catch { return {}; } })();
  const json = {
    design, design_name: d.name, material: material.name, dk_type: $("#dkType").value,
    dk: inp.er, df: inp.tand, thermal_conductivity_W_mK: inp.kth,
    substrate_thickness_m: inp.h, copper: { type: $("#cuType").value, thickness_m: inp.t, sai: inp.cu?.sai, nodule_radius_m: inp.cu?.nodule, rms_m: inp.cu?.rms, conductivity_S_m: inp.sigma },
    conductor_width_m: inp.w, space_m: inp.s, length_m: inp.len,
    calculation: synth ? { type: "synthesis", target_impedance_ohm: numOf("z") } : { type: "analysis" },
    frequency: range ? { type: "range", min_GHz: numOf("fmin"), max_GHz: numOf("fmax"), step_GHz: numOf("fstep") } : { type: "discrete", GHz: numOf("f") },
  };
  $("#paramJson").value = JSON.stringify(json, null, 2);
}
function shareUrl() {
  const u = new URL(location.href);
  u.hash = `s=${encodeURIComponent(JSON.stringify(snapshot()))}`;
  return u.href;
}
function readHash() {
  const m = location.hash.match(/^#s=(.+)$/);
  if (!m) return null;
  try { return JSON.parse(decodeURIComponent(m[1])); } catch { return null; }
}

let saveTimer = 0;
function changed() {
  clearOutput();
  summary();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set("sunden.state", JSON.stringify(snapshot())), 300);
}

/* ---------- modal ---------- */
function openModal(title, html) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  $("#modal").hidden = false;
  $("#modal .x").focus();
}
function closeModal() { $("#modal").hidden = true; }
const TUTORIAL = i18n(`<ol>
  <li><b>选择结构类型</b>：点左上角的截面图，从六种结构中选择（接地共面波导、微带线、边缘耦合微带线、带状线、边缘耦合带状线、宽边耦合带状线）。</li>
  <li><b>选择材料</b>：在材料表中点击晟电板材型号，Dk、Df、导热系数和常用厚度会自动带入。</li>
  <li><b>材料属性</b>：选择基材厚度和 Dk 类型（Bulk / Wideband / Discrete）。</li>
  <li><b>导体参数</b>：选择铜箔类型，按成品铜厚修改铜厚。</li>
  <li><b>线路参数</b>：填写线宽 W、间距 S 和线长 L。</li>
  <li><b>电气参数</b>：选择分析或综合（由目标阻抗反求线宽），以及单个频率或频率范围。</li>
  <li>点击<b>计算</b>。右侧“输入参数”中的每一项可点击，跳到对应的设置处；结果可下载 CSV，或复制分享链接保存全部输入。</li>
</ol>`);

/* ---------- combo dropdowns ---------- */
function closeCombos(except) { for (const l of $$(".combo-list")) if (l !== except) l.hidden = true; }

/* ---------- wiring ---------- */
function setNavOpen(open) {
  $("#sideNav").classList.toggle("is-open", open);
  $("#navToggle").setAttribute("aria-expanded", String(open));
  $("#navBackdrop").hidden = !open;
  document.body.classList.toggle("nav-open", open);
}

function wire() {
  const compactNav = matchMedia("(max-width: 900px)");
  compactNav.addEventListener("change", () => setNavOpen(false));
  $("#navToggle").onclick = () => {
    const open = !$("#sideNav").classList.contains("is-open");
    setNavOpen(open);
    if (open) $("#menuBtn").focus();
  };
  $("#navBackdrop").onclick = () => { setNavOpen(false); $("#navToggle").focus(); };
  $("#sideNav").addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || !compactNav.matches || !$("#sideNav").classList.contains("is-open")) return;
    const controls = $$("button:not(:disabled), a[href], input:not(:disabled)", $("#sideNav")).filter((el) => el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (e.shiftKey && e.target === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && e.target === last) { e.preventDefault(); first.focus(); }
  });
  document.addEventListener("click", (e) => {
    const t = e.target;
    const areaLink = t.closest("[data-area]");
    if (areaLink) { e.preventDefault(); switchArea(areaLink.dataset.area, areaLink.dataset.field || null); }
    if (t.closest("[data-calc]")) calculate();
    const dt = t.closest(".dt");
    if (dt) setDesign(dt.dataset.design);
    const tr = t.closest("tr[data-mat]");
    if (tr) setMaterial(tr.dataset.mat);
    const info = t.closest("[data-info]");
    if (info) openModal(INFO[info.dataset.info][0], `<p>${esc(INFO[info.dataset.info][1])}</p>`);
    if (t.closest("[data-close]") || t === $("#modal")) closeModal();

    const cb = t.closest(".combo-btn");
    if (cb) { const l = $(`#${cb.dataset.combo}-list`); closeCombos(l); l.hidden = !l.hidden; if (!l.hidden) l.querySelector("button")?.focus(); }
    else if (!t.closest(".combo-list")) closeCombos();
    const pick = t.closest("[data-pick]");
    if (pick) {
      closeCombos();
      if (pick.dataset.pick === "h") { $("#h").value = pick.dataset.v; if ($("#dkType").value !== "bulk") refreshDk(); else changed(); }
      else { applyCopper(Number(pick.dataset.i)); changed(); }
    }

    const tog = t.closest("[data-tog]");
    if (tog) { const box = $(`#${tog.dataset.tog}`); box.checked = tog.dataset.val === "1"; electrical(); }
    const ub = t.closest("[data-unit]");
    if (ub) setUnits(ub.dataset.unit);
    const chip = t.closest(".chip");
    if (chip) { for (const c of $$(".chip")) c.setAttribute("aria-pressed", String(c === chip)); filterMaterials(); }

    // menu
    const mb = t.closest("#menuBtn");
    if (mb) { const open = $("#menuList").hidden; $("#menuList").hidden = !open; mb.setAttribute("aria-expanded", String(open)); }
    else if (!t.closest("#menuList")) { $("#menuList").hidden = true; $("#menuBtn").setAttribute("aria-expanded", "false"); }
    const act = t.closest("[data-act]")?.dataset.act;
    if (act) { $("#menuList").hidden = true; $("#menuBtn").setAttribute("aria-expanded", "false"); }
    if (act === "new") { store.set("sunden.state", ""); history.replaceState(null, "", location.pathname); location.reload(); }
    if (act === "tutorial") openModal(i18n("使用教程"), TUTORIAL);
    if (act === "theme") setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal(); closeCombos(); $("#menuList").hidden = true;
      $("#menuBtn").setAttribute("aria-expanded", "false");
      if ($("#sideNav").classList.contains("is-open")) { setNavOpen(false); $("#navToggle").focus(); }
    }
    if (e.key === "Enter" && e.target.matches(".area input:not([type=search])")) { e.preventDefault(); e.target.dispatchEvent(new Event("change", { bubbles: true })); calculate(); }
  });

  const area = $("#areaSection");
  area.addEventListener("input", (e) => {
    const id = e.target.id;
    if (id === "matSearch") return filterMaterials();
    if (FIELD_IDS.includes(id)) changed();
  });
  area.addEventListener("change", (e) => {
    const id = e.target.id;
    if (id === "dkType") refreshDk();
    else if (id === "h" && $("#dkType").value !== "bulk") refreshDk();
    else if (id === "f" && $("#dkType").value === "discrete") refreshDk();
    else if (id === "calcType" || id === "freqType") electrical();
  });
  $("#unitSwitch").addEventListener("change", (e) => setUnits(e.target.checked ? "metric" : "english"));
  $("#csvBtn").onclick = downloadCsv;
  $("#copyJson").onclick = () => copy($("#paramJson").value, i18n("已复制 JSON"));
  $("#copyLink").onclick = () => copy(shareUrl(), i18n("已复制分享链接"));
  $("#lnkSamples").href = LINKS.samples;
  $("#lnkContact").href = LINKS.contact;
}

function filterMaterials() {
  const q = $("#matSearch").value.trim().toLowerCase();
  const s = $(".chip[aria-pressed=true]")?.dataset.series ?? "";
  for (const tr of $$("tr[data-mat]")) tr.hidden = (s && tr.dataset.series !== s) || (q && !tr.dataset.mat.toLowerCase().includes(q));
}
async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); $("#copied").textContent = msg; }
  catch { $("#copied").textContent = i18n("复制失败，请手动选择复制"); }
  setTimeout(() => { $("#copied").textContent = ""; }, 2500);
}
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  $("meta[name=theme-color]").content = t === "dark" ? "#111111" : "#ffffff";
  $("#themeBtn").textContent = i18n`主题：${t === "dark" ? i18n("深色") : i18n("浅色")}`;
  store.set("sunden.theme", t);
}

/* ---------- boot ---------- */
async function boot() {
  let wasm;
  try {
    const resp = await fetch("./kicad-transline.wasm?v=095996b694");
    if (!resp.ok) throw new Error(i18n`kicad-transline.wasm 返回 HTTP ${resp.status}`);
    ({ instance: { exports: wasm } } = await WebAssembly.instantiate(await resp.arrayBuffer()));
    if (wasm.tl_abi_version() !== 1) throw new Error(i18n("WASM 接口版本与页面不匹配"));
  } catch (err) {
    $("#output").innerHTML = i18n`<div class="err-box">无法载入计算内核：${esc(err.message)}。请通过 HTTP 服务器打开本页。</div>`;
    return;
  }
  engine = createEngine(wasm);

  buildAreas();
  fillCopperList();
  wire();
  setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");

  const savedUnits = store.get("sunden.units");
  units = savedUnits === "english" ? "english" : "metric";
  $("#unitSwitch").checked = units === "metric";
  unitLabels();
  for (const [id, v] of Object.entries(DEFAULTS[units])) $(`#${id}`).value = v;
  applyCopper(0);
  setMaterial(material.name, true);

  const fromHash = readHash();
  let fromStore = null;
  try { fromStore = JSON.parse(store.get("sunden.state") || "null"); } catch { /* ignore */ }
  let languageState = null;
  try { languageState = JSON.parse(sessionStorage.getItem("shinepcb.language-state") || "null"); sessionStorage.removeItem("shinepcb.language-state"); } catch {}
  if (!restore(languageState?.state) && !restore(fromHash) && !restore(fromStore)) {
    setDesign("M", true);
    electrical();
  }
  switchArea(AREAS[languageState?.area] ? languageState.area : "designTypes");
  if (languageState?.hadResult) { try { runCalc(); } catch (error) { showError(error.message); } }
  if (languageState?.dimensions) for (const [id, cache] of Object.entries(languageState.dimensions)) {
    if (id in LEN_FIELDS && cache?.shown === $(`#${id}`).value) { $(`#${id}`).dataset.si = cache.si; $(`#${id}`).dataset.shown = cache.shown; }
  }
  summary();
  window.sundenCalculator = {
    read() {
      const p = gather();
      return {
        design, material: material.name, dkMode: $("#dkType").value,
        frequencyGHz: p.f / 1e9, heightMm: p.h * 1e3,
        copperUm: p.t * 1e6, widthMm: p.w * 1e3, gapMm: p.s * 1e3,
        lengthMm: p.len * 1e3, er: p.er, df: p.tand,
        kth: Number.isFinite(p.kth) ? p.kth : null, sigma: p.sigma,
        copper: { label: $("#cuType").value, sai: p.cu.sai, noduleUm: p.cu.nodule * 1e6, rmsUm: p.cu.rms * 1e6 },
      };
    },
    apply(c) {
      if (!MATERIALS.some(m => m.name === c.material) || !designOf(c.design)) throw new Error(i18n("无效的板材方案"));
      const U = UNITS[units];
      const fields = {
        h: c.heightMm * 1e-3 / U.dim[1], t: c.copperUm * 1e-6 / U.thin[1],
        w: c.widthMm * 1e-3 / U.dim[1], s: c.gapMm * 1e-3 / U.dim[1],
        len: c.lengthMm * 1e-3 / U.len[1], f: c.frequencyGHz,
        dkType: c.dkMode, dk: c.er, df: c.df, kth: c.kth ?? "",
        sigma: c.sigma / 1e7, cuType: c.copper.label,
        sai: c.copper.sai, nodule: c.copper.noduleUm, rms: c.copper.rmsUm,
      };
      restore({ v: 1, units, design: c.design, material: c.material, calc: "analysis", freq: "discrete", fields });
      runCalc();
    },
  };
  window.dispatchEvent(new Event("sunden:ready"));
}

window.addEventListener("sunden:language-change", () => {
  if (!engine) return;
  const state = snapshot(); store.set("sunden.state", JSON.stringify(state));
  const dimensions = Object.fromEntries(Object.keys(LEN_FIELDS).map(id => [id, { si: $(`#${id}`).dataset.si, shown: $(`#${id}`).dataset.shown }]));
  try { sessionStorage.setItem("shinepcb.language-state", JSON.stringify({ state, area, dimensions, hadResult: !!last })); } catch {}
});
const languageButton = document.getElementById("languageBtn");
if (languageButton) { languageButton.textContent = language === "zh" ? "English" : "中文"; languageButton.onclick = () => changeLanguage(language === "zh" ? "en" : "zh"); }
boot();
