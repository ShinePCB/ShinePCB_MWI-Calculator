/* One-time CSV migration. GPL-3.0-or-later */
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { csvPath, databasePath, importMaterials } from "./materials-db.mjs";

const { values } = parseArgs({ options: { input: { type: "string" }, output: { type: "string" } } });
const input = values.input ?? fileURLToPath(csvPath);
const output = values.output ?? fileURLToPath(databasePath);
const counts = importMaterials(input, output);
console.log(`${output}: ${counts.materials} materials, ${counts.parameters} parameters, ${counts.thicknesses} thickness-Dk rows`);
