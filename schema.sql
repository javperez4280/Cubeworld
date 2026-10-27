CREATE TABLE IF NOT EXISTS mundos (
  nombre TEXT PRIMARY KEY,
  semilla INTEGER NOT NULL,
  datos TEXT NOT NULL,
  actualizado TEXT NOT NULL DEFAULT (datetime('now'))
);
