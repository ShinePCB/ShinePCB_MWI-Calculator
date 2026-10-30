# KiCad PCB Calculator WebAssembly port

This project includes source files from KiCad's `common/transline_calculations`
and `pcb_calculator` directories at commit
`99c64afbf83fbca8b97093a0e966e00e28915dca`, plus WebAssembly C API bridges
and a browser interface.

KiCad is copyright its respective contributors. The included KiCad sources
and this combined work are distributed under the GNU General Public License,
version 3 or (where an upstream file permits it) any later version.

Upstream source: https://gitlab.com/kicad/code/kicad

Local modification (2026-10-08): `coupled_microstrip.cpp` skips even/odd impedance cover
corrections when H_T >= 1e20 m, the board engine's explicit open-space sentinel. The empirical
finite-cover fit otherwise produces a spurious correction at large line spacing. The corresponding
WebAssembly module has been rebuilt from these modified sources.

The ShinePCB browser UI (dist/mwi.js, dist/engine.js) is a laminate impedance
calculator built on the KiCad transmission-line classes. Material data comes from
SUNDEN's product specification, preserved in data/sunden-materials.csv and
data/sunden-materials.sqlite. The open-source distribution is a static calculator.

The transmission-line cross-section pictures in `dist/img/kicad/` are KiCad's
own bitmaps (`microstrip`, `c_microstrip`, `stripline`, `coupled_stripline`,
`cpw`, `cpw_back`, `rectwaveguide`, `coax`, `twistedpair`,
`microstrip_zodd_zeven`, light and dark variants), taken unmodified from the
KiCad 10.0 `resources/images` archive and distributed under GPL-3.0-or-later.
KiCad has no broadside-coupled stripline picture; `dist/img/broadside_stripline.svg`
was drawn for this project in the same palette.
