-- SUNDEN specification data. Numeric calculator fields are extracted on CSV import.
PRAGMA foreign_keys = ON;

CREATE TABLE materials (
  id INTEGER PRIMARY KEY,
  model TEXT NOT NULL UNIQUE CHECK (length(trim(model)) > 0),
  series TEXT NOT NULL,
  material_type TEXT NOT NULL CHECK (material_type IN ('laminate', 'bonding-film')),
  dk REAL CHECK (dk > 1),
  dk_tolerance REAL CHECK (dk_tolerance >= 0),
  design_dk REAL CHECK (design_dk > 1),
  df REAL CHECK (df >= 0),
  tcdk REAL,
  thermal_conductivity REAL CHECK (thermal_conductivity > 0),
  cured_thickness_mm REAL CHECK (cured_thickness_mm > 0)
) STRICT;

CREATE TABLE material_parameters (
  id INTEGER PRIMARY KEY,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  parameter_cn TEXT NOT NULL,
  parameter_en TEXT NOT NULL,
  typical_value_raw TEXT NOT NULL,
  direction TEXT NOT NULL,
  unit TEXT NOT NULL,
  test_method TEXT NOT NULL,
  condition_raw TEXT NOT NULL,
  source_page INTEGER CHECK (source_page > 0),
  notes TEXT NOT NULL,
  source_row INTEGER NOT NULL UNIQUE CHECK (source_row >= 2),
  UNIQUE (id, material_id)
) STRICT;

CREATE INDEX material_parameters_material ON material_parameters(material_id);

CREATE TABLE material_thickness_dk (
  id INTEGER PRIMARY KEY,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  thickness_mm REAL NOT NULL CHECK (thickness_mm > 0),
  thickness_tolerance_mm REAL CHECK (thickness_tolerance_mm >= 0),
  dk REAL NOT NULL CHECK (dk > 1),
  dk_tolerance REAL CHECK (dk_tolerance >= 0),
  source_parameter_id INTEGER NOT NULL UNIQUE,
  FOREIGN KEY (source_parameter_id, material_id) REFERENCES material_parameters(id, material_id),
  UNIQUE (material_id, thickness_mm)
) STRICT;

PRAGMA user_version = 1;
