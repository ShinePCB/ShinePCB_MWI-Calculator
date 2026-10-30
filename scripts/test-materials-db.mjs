/* Lossless SQLite migration and calculator compatibility. GPL-3.0-or-later */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, unlinkSync, rmdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { csvPath, csvHeaders, databasePath, importMaterials, readMaterials, parseCsv } from "./materials-db.mjs";

// Saved from the CSV-generated calculator data before migration, including order and null values.
const legacyDigest = "197e3cc9d6491b67a4a67847dca1fa5b0a8b43cf0becfb496a0867adf73f715a";
const digest = materials => createHash("sha256").update(JSON.stringify(materials)).digest("hex");
const csv = readFileSync(csvPath, "utf8");
const encode = rows => [csvHeaders, ...rows].map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");

function temporary(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "sunden-materials-"));
  t.after(() => {
    for (const name of readdirSync(directory)) unlinkSync(path.join(directory, name));
    rmdirSync(directory);
  });
  return directory;
}

test("SQLite preserves all 502 original CSV records and ten source columns", () => {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    const stored = db.prepare(`SELECT m.model, p.parameter_cn, p.parameter_en, p.typical_value_raw,
      p.direction, p.unit, p.test_method, p.condition_raw, p.source_page, p.notes, p.source_row
      FROM material_parameters p JOIN materials m ON m.id = p.material_id ORDER BY p.source_row`).all();
    const original = parseCsv(csv);
    assert.equal(stored.length, 502);
    assert.deepEqual(stored.map(row => ({
      values: [row.model, row.parameter_cn, row.parameter_en, row.typical_value_raw, row.direction,
        row.unit, row.test_method, row.condition_raw, row.source_page === null ? "" : String(row.source_page), row.notes],
      line: row.source_row,
    })), original);
    assert.equal(db.prepare("SELECT count(*) AS n FROM materials WHERE material_type = 'laminate'").get().n, 24);
    assert.equal(db.prepare("SELECT count(*) AS n FROM materials WHERE material_type = 'bonding-film'").get().n, 5);
    assert.equal(db.prepare("SELECT count(*) AS n FROM material_thickness_dk").get().n, 16);
    assert.deepEqual({ ...db.prepare(`SELECT t.thickness_tolerance_mm, t.dk_tolerance FROM material_thickness_dk t
      JOIN materials m ON m.id = t.material_id WHERE m.model = 'CFG294' AND t.thickness_mm = 0.127`).get() },
    { thickness_tolerance_mm: 0.015, dk_tolerance: 0.03 });
  } finally { db.close(); }
});

test("All 29 calculator materials exactly match the pre-migration snapshot", () => {
  const materials = readMaterials();
  assert.equal(materials.length, 29);
  assert.equal(digest(materials), legacyDigest);
  assert.equal(materials.find(material => material.name === "CM6").kth, null);
});

test("A fresh import reproduces the data; database changes are read without reimporting CSV", t => {
  const directory = temporary(t), output = path.join(directory, "materials.sqlite");
  assert.deepEqual(importMaterials(csvPath, output), { materials: 29, parameters: 502, thicknesses: 16 });
  assert.equal(digest(readMaterials(output)), legacyDigest);
  const before = readFileSync(output);
  assert.throws(() => importMaterials(csvPath, output), /already exists/);
  assert.deepEqual(readFileSync(output), before);
  const db = new DatabaseSync(output);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    assert.throws(() => db.prepare("UPDATE materials SET dk = ? WHERE model = ?").run(-2, "CF220G2"), /CHECK/);
    assert.throws(() => db.exec("UPDATE material_thickness_dk SET material_id = 99999 WHERE id = 1"), /FOREIGN KEY/);
    const otherId = db.prepare("SELECT id FROM materials WHERE model = 'CF220G2'").get().id;
    assert.throws(() => db.prepare("UPDATE material_thickness_dk SET material_id = ? WHERE id = 1").run(otherId), /FOREIGN KEY/);
    db.prepare("UPDATE materials SET dk = ? WHERE model = ?").run(2.25, "CF220G2");
  } finally { db.close(); }
  assert.equal(readMaterials(output).find(material => material.name === "CF220G2").dk, 2.25);
});

test("Import handles quoted raw values and physical line numbers without losing missing or zero values", t => {
  const directory = temporary(t), input = path.join(directory, "input.csv"), output = path.join(directory, "output.sqlite");
  const source = [
    ["TEST", "介电常数（10 GHz）", "Dk", "2.20±0.02", "Z", "-", "IPC", "", "1", "包含逗号,及\"引号\"\r\n第二行"],
    ["TEST", "损耗因子（10 GHz）", "Df", "0", "Z", "-", "IPC", "", "1", ""],
    ["TEST", "玻璃化转变温度", "Tg", ">280", "-", "℃", "", "", "1", ""],
  ];
  writeFileSync(input, "\uFEFF" + encode(source));
  assert.deepEqual(importMaterials(input, output), { materials: 1, parameters: 3, thicknesses: 0 });
  const material = readMaterials(output)[0];
  assert.equal(material.dk, 2.2); assert.equal(material.dkTol, 0.02);
  assert.equal(material.df, 0); assert.equal(material.kth, null);
  const db = new DatabaseSync(output, { readOnly: true });
  try {
    const rows = db.prepare("SELECT notes, source_row, typical_value_raw FROM material_parameters ORDER BY id").all();
    assert.equal(rows[0].notes, source[0][9]);
    assert.deepEqual(rows.map(row => row.source_row), [2, 4, 5]);
    assert.equal(rows[2].typical_value_raw, ">280");
  } finally { db.close(); }
});

test("Invalid numeric data and duplicate thicknesses never publish a partial database", t => {
  const directory = temporary(t), input = path.join(directory, "bad.csv"), output = path.join(directory, "bad.sqlite");
  const invalid = csv.replace("2.20±0.02", "not-a-number");
  assert.notEqual(invalid, csv);
  writeFileSync(input, invalid);
  assert.throws(() => importMaterials(input, output), /Invalid numeric specification/);
  assert.equal(existsSync(output), false);
  const rows = parseCsv(csv).map(row => row.values);
  rows.push(rows.find(row => row[1] === "标称厚度对应Dk"));
  writeFileSync(input, encode(rows));
  assert.throws(() => importMaterials(input, output), /UNIQUE/);
  assert.deepEqual(readdirSync(directory), ["bad.csv"]);
  assert.throws(() => parseCsv('wrong,headers\n'), /headers/);
  assert.throws(() => parseCsv(csvHeaders.join(",") + '\n"unfinished'), /Unclosed/);
});
