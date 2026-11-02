# ShinePCB_MWI Calculator

[在线使用 / Live calculator](https://board.calculator.shinepcba.com/)

中英文微波板材阻抗计算器。计算在浏览器本地运行，使用 KiCad 传输线模型编译的 WebAssembly 内核，无需账号、API 密钥或后端服务。

A Chinese/English microwave impedance calculator from ShinePCB. Calculations run locally in the browser using KiCad transmission-line models compiled to WebAssembly. No account, API key, or application backend is required.

## Features

- Impedance analysis and line-width synthesis for six transmission-line structures.
- Single-frequency and frequency-sweep calculations, with CSV export.
- Impedance, effective permittivity, delay, phase, RLGC, and supported loss estimates.
- Copper roughness correction using Huray or Hammerstad models.
- Metric/imperial units, light/dark themes, and Chinese/English UI.
- Local input persistence, JSON export, and share links that encode inputs.
- SUNDEN material parameters maintained in SQLite and generated as static browser data.

## Run locally / 本地运行

Use Node.js **22.13.0 or newer** and pnpm **11.19.0**.

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run dev
```

Open http://127.0.0.1:18771. Select English with `?lang=en` or the language button; use `?lang=zh` for Chinese. The language preference and calculation inputs stay in browser storage. Share links include the input parameters; check those values before sharing.

`dist/` contains a ready-to-serve static website, including the compiled WASM engine. Any static HTTP host that serves `.wasm` as `application/wasm` can host it, including under a subdirectory. Serve over HTTP(S) rather than opening `index.html` as a local file. Hosting access logs depend on the hosting provider; the application does not send parameters to a calculation API.

## Website embedding

The ShinePCB website embeds the calculator at `https://shinepcba.com/en/board-calculator/`
(Chinese: `/zh/board-calculator/`). The iframe uses `?lang=en&embed=1` or
`?lang=zh&embed=1`. In this optional mode the host sets the language, owns scrolling,
and exchanges validated viewport/resize messages with `dist/embed.js`. Messages are
accepted only from the parent at `https://shinepcba.com`, `https://www.shinepcba.com`,
or an HTTP localhost/127.0.0.1 development origin. The standalone page keeps its
own language switch and layout.

## Models and limits

| Code | Structure | Model | Loss estimate |
| --- | --- | --- | --- |
| M | Microstrip | KiCad `MICROSTRIP` | Yes |
| S | Symmetric homogeneous stripline | KiCad `STRIPLINE`, b = 2h + T | Yes |
| GC | Grounded coplanar waveguide | KiCad `COPLANAR` with back metal | Yes |
| ME | Edge-coupled microstrip | KiCad `COUPLED_MICROSTRIP` | Odd-mode propagation loss |
| SE | Edge-coupled stripline | KiCad `COUPLED_STRIPLINE`, b = 2h + T | Not modeled |
| SB | Broadside-coupled stripline | Cohn thin-strip model, b = 2h + S | Not modeled |

`h` is one dielectric layer's thickness. SB impedance ignores copper thickness. Stripline models assume symmetric, homogeneous dielectric. Loss estimates exclude connectors, vias, and mismatch. Missing loss models are not treated as zero loss.

Dk modes include bulk datasheet Dk at 10 GHz, design/thickness-specific Dk, and a Djordjevic–Sarkar wideband fit. Frequency-dependent values are model estimates. Copper roughness presets and the thickness dropdown are generic reference values; confirm finished-board dimensions and foil data with the supplier.

The engine rejects nonfinite inputs, Dk ≤ 1, invalid thickness-corrected coplanar slots, and unresolved or invalid model outputs. Width synthesis verifies final impedance against its target. The coupled-microstrip core treats H_T ≥ 1e20 m as an open-cover sentinel and skips empirical cover corrections for that sentinel; finite-cover behavior is preserved.

Saved RO4350B reference checks typically agree with MWI within 1–3% for microstrip/stripline outputs, 2–5% for coupled-line impedance, and 1.5% for synthesis widths; grounded-coplanar insertion loss differs by about 15%. These saved comparisons are not a full-range accuracy guarantee. Copper-thickness sensitivity is not fully validated: some empirical microstrip/coplanar corrections show small reversed trends. Validate critical designs with a field solver and measurements.

## Material data

The source is `data/sunden-materials.sqlite`, migrated from `data/sunden-materials.csv`. The schema is in `data/materials-schema.sql`:

- `materials`: 29 materials, including 24 laminates and five bonding films.
- `material_parameters`: 502 source parameter records, with conditions, methods, and source pages.
- `material_thickness_dk`: 16 thickness/Dk mappings, including tolerances.

Missing numeric values are NULL. `pnpm run build` reads SQLite without modifying it and generates `dist/materials.js`; browsers load this static file. Normal builds do not reimport CSV. After editing SQLite, rebuild and publish `dist/`.

```sh
pnpm run materials:import --input path/to/source.csv --output path/to/new.sqlite
```

Import refuses to overwrite an existing database. Numeric fields and thickness mappings are extracted from the original parameters; maintain their consistency when editing manually. Source attribution remains SUNDEN.

## Test and rebuild

```sh
pnpm test
pnpm exec playwright install chromium
pnpm run test:browser
```

Tests check material migration, WASM ABI, saved references, model-domain guards, synthesis round trips, and calculator browser behavior. No external service credentials are needed.

To rebuild WASM, activate **Emscripten 6.0.10**, then run:

```sh
node scripts/build-wasm.mjs
pnpm run build
```

Included corresponding source is under `src/kicad/` and `src/wasm/`. `pnpm run source` creates an archive under ignored `tmp/` for redistribution.

## License and attribution

GPL-3.0-or-later, subject to preserved upstream file notices. See [LICENSE](LICENSE), [NOTICE.md](NOTICE.md), and [KICAD_AUTHORS.txt](KICAD_AUTHORS.txt). KiCad source copyright belongs to its respective contributors. SUNDEN material data and ShinePCB branding retain their source attribution; no third-party trademark ownership is claimed.
