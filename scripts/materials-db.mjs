/* SQLite material import/export; GPL-3.0-or-later. Node.js >= 22.13.0. */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, linkSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const databasePath = new URL("../data/sunden-materials.sqlite", import.meta.url);
export const csvPath = new URL("../data/sunden-materials.csv", import.meta.url);
const schema = new URL("../data/materials-schema.sql", import.meta.url);
export const csvHeaders = ["型号", "参数中文", "Parameter_EN", "典型值", "方向", "单位", "测试方法", "条件/厚度", "来源页码", "通用规格备注"];

// Preserve quoted commas, escaped quotes, embedded newlines and physical source line numbers.
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const records = [];
  let values = [], cell = "", quoted = false, closed = false, line = 1, start = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else {
        cell += ch;
        if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) line++;
      }
    } else if (ch === ",") {
      values.push(cell); cell = ""; closed = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      values.push(cell);
      if (values.some(value => value !== "")) records.push({ values, line: start });
      values = []; cell = ""; closed = false; line++; start = line;
    } else if (ch === '"' && cell === "" && !closed) {
      quoted = true;
    } else {
      if (closed || ch === '"') throw new Error(`Invalid CSV quoting at line ${line}`);
      cell += ch;
    }
  }
  if (quoted) throw new Error(`Unclosed CSV quote at line ${start}`);
  values.push(cell);
  if (values.some(value => value !== "")) records.push({ values, line: start });
  if (JSON.stringify(records[0]?.values) !== JSON.stringify(csvHeaders)) throw new Error("Unexpected material CSV headers");
  const rows = records.slice(1);
  if (!rows.length) throw new Error("Material CSV has no data rows");
  for (const row of rows) {
    if (row.values.length !== csvHeaders.length) throw new Error(`Expected ${csvHeaders.length} columns at CSV line ${row.line}`);
  }
  return rows;
}

function numeric(value, label) {
  if (value === "") return { value: null, tolerance: null };
  const match = value.match(/^(-?\d+(?:\.\d+)?)(?:\s*±\s*(\d+(?:\.\d+)?))?$/);
  if (!match) throw new Error(`Invalid numeric specification (${label}): ${value}`);
  const result = { value: Number(match[1]), tolerance: match[2] === undefined ? null : Number(match[2]) };
  if (!Number.isFinite(result.value) || (result.tolerance !== null && !Number.isFinite(result.tolerance))) {
    throw new Error(`Nonfinite specification (${label})`);
  }
  return result;
}

// Never overwrite an existing database. Publish the complete transaction only after validation.
export function importMaterials(input, output) {
  if (existsSync(output)) throw new Error(`Database already exists: ${output}. Use a new output path.`);
  const rows = parseCsv(readFileSync(input, "utf8"));
  const temporary = `${output}.${randomUUID()}.tmp`;
  let db;
  try {
    db = new DatabaseSync(temporary);
    db.exec(readFileSync(schema, "utf8"));
    db.exec("BEGIN IMMEDIATE");
    const addMaterial = db.prepare("INSERT INTO materials(model, series, material_type) VALUES (?, ?, 'laminate')");
    const addParameter = db.prepare(`INSERT INTO material_parameters
      (material_id, parameter_cn, parameter_en, typical_value_raw, direction, unit, test_method, condition_raw, source_page, notes, source_row)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const addThickness = db.prepare(`INSERT INTO material_thickness_dk
      (material_id, thickness_mm, thickness_tolerance_mm, dk, dk_tolerance, source_parameter_id) VALUES (?, ?, ?, ?, ?, ?)`);
    const byName = new Map(), assigned = new Set();
    for (const { values, line } of rows) {
      const [model, cn, en, raw, direction, unit, method, condition, page, notes] = values;
      if (!model.trim() || !cn.trim()) throw new Error(`Missing material or parameter at CSV line ${line}`);
      if (!byName.has(model)) {
        const series = /^(CFS|CFG|CBG|CF|CM)/.exec(model)?.[1] ?? "其他";
        byName.set(model, Number(addMaterial.run(model, series).lastInsertRowid));
      }
      const id = byName.get(model);
      if (page !== "" && !/^[1-9]\d*$/.test(page)) throw new Error(`Invalid source page at CSV line ${line}`);
      const parameterId = Number(addParameter.run(id, cn, en, raw, direction, unit, method, condition, page === "" ? null : Number(page), notes, line).lastInsertRowid);
      const column = cn === "介电常数（10 GHz）" ? "dk"
        : cn.startsWith("设计介电常数") ? "design_dk"
        : cn === "损耗因子（10 GHz）" ? "df"
        : cn.startsWith("介电常数温度系数") ? "tcdk"
        : cn.startsWith("热导率") ? "thermal_conductivity"
        : cn === "固化厚度" ? "cured_thickness_mm" : null;
      if (column) {
        const key = `${id}:${column}`;
        if (assigned.has(key)) throw new Error(`Ambiguous calculator parameter: ${model} ${cn}`);
        assigned.add(key);
        const number = numeric(raw, `${model} ${cn}`);
        // Column is selected exclusively from the fixed mapping above; all values are bound.
        db.prepare(`UPDATE materials SET ${column} = ? WHERE id = ?`).run(number.value, id);
        if (column === "dk") db.prepare("UPDATE materials SET dk_tolerance = ? WHERE id = ?").run(number.tolerance, id);
        if (column === "cured_thickness_mm" && number.value !== null) {
          db.prepare("UPDATE materials SET material_type = 'bonding-film' WHERE id = ?").run(id);
        }
      } else if (cn === "标称厚度对应Dk") {
        const height = /标称厚度\s*(\d+(?:\.\d+)?)\s*mm/.exec(condition);
        const heightTolerance = /厚度公差\s*±\s*(\d+(?:\.\d+)?)/.exec(condition);
        const dkTolerance = /Dk公差\s*±\s*(\d+(?:\.\d+)?)/.exec(condition);
        if (!height || (/厚度公差/.test(condition) && !heightTolerance) || (/Dk公差/.test(condition) && !dkTolerance)) {
          throw new Error(`Invalid thickness specification at CSV line ${line}`);
        }
        const dk = numeric(raw, `${model} thickness Dk`);
        addThickness.run(id, Number(height[1]), heightTolerance ? Number(heightTolerance[1]) : null,
          dk.value, dkTolerance ? Number(dkTolerance[1]) : dk.tolerance, parameterId);
      }
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Material foreign key check failed");
    const counts = {
      materials: db.prepare("SELECT count(*) AS n FROM materials").get().n,
      parameters: db.prepare("SELECT count(*) AS n FROM material_parameters").get().n,
      thicknesses: db.prepare("SELECT count(*) AS n FROM material_thickness_dk").get().n,
    };
    db.exec("COMMIT");
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Material integrity check failed");
    db.close(); db = undefined;
    // Exclusive hard link refuses a concurrently created destination.
    linkSync(temporary, output);
    return counts;
  } finally {
    if (db) db.close();
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function readMaterials(input = databasePath) {
  const db = new DatabaseSync(input, { readOnly: true });
  try {
    if (db.prepare("PRAGMA user_version").get().user_version !== 1) throw new Error("Unsupported materials schema version");
    const thickness = db.prepare(`SELECT thickness_mm AS h, dk, thickness_tolerance_mm AS hTol
      FROM material_thickness_dk WHERE material_id = ? ORDER BY id`);
    return db.prepare(`SELECT m.*, (SELECT p.source_page FROM material_parameters p
      WHERE p.material_id = m.id ORDER BY p.source_row LIMIT 1) AS source_page
      FROM materials m WHERE m.dk IS NOT NULL AND m.df IS NOT NULL ORDER BY m.id`).all().map(row => {
      const material = {
        name: row.model,
        series: row.material_type === "bonding-film" ? "粘结片" : row.series === "其他" ? "其他" : `${row.series} 系列`,
        page: row.source_page, dk: row.dk, dkTol: row.dk_tolerance, designDk: row.design_dk,
        df: row.df, tcdk: row.tcdk, kth: row.thermal_conductivity,
        dkByThickness: thickness.all(row.id).map(entry => ({ ...entry })), cured: row.cured_thickness_mm,
      };
      if (!material.dkByThickness.length) delete material.dkByThickness;
      return material;
    });
  } finally { db.close(); }
}
