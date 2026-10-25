'use strict';

const daftarMigrasi = [
  {
    versi: 1,
    sql: `
      CREATE TABLE penjahit (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        nama       TEXT    NOT NULL,
        wa         TEXT    NOT NULL UNIQUE,
        kategori   TEXT    NOT NULL DEFAULT 'Senior'
                   CHECK (kategori IN ('Senior','Junior','Magang')),
        aktif      INTEGER NOT NULL DEFAULT 1 CHECK (aktif IN (0,1)),
        created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE model (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        kode       TEXT NOT NULL UNIQUE,
        nama       TEXT NOT NULL,
        deskripsi  TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE tarif (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        model_id  INTEGER NOT NULL REFERENCES model(id) ON DELETE CASCADE,
        kategori  TEXT    NOT NULL CHECK (kategori IN ('Senior','Junior','Magang')),
        tarif_pcs INTEGER NOT NULL CHECK (tarif_pcs >= 0),
        UNIQUE (model_id, kategori)
      );

      CREATE TABLE setoran (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        tanggal          TEXT    NOT NULL DEFAULT (date('now','localtime')),
        penjahit_id      INTEGER NOT NULL REFERENCES penjahit(id),
        model_id         INTEGER NOT NULL REFERENCES model(id),
        bagus            INTEGER NOT NULL CHECK (bagus >= 0),
        reject           INTEGER NOT NULL DEFAULT 0 CHECK (reject >= 0),
        tarif_diterapkan INTEGER NOT NULL CHECK (tarif_diterapkan >= 0),
        subtotal         INTEGER GENERATED ALWAYS AS (bagus * tarif_diterapkan) VIRTUAL,
        catatan          TEXT
      );
      CREATE INDEX idx_setoran_tanggal   ON setoran(tanggal);
      CREATE INDEX idx_setoran_penjahit  ON setoran(penjahit_id, tanggal);

      CREATE TABLE payroll (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        penjahit_id     INTEGER NOT NULL REFERENCES penjahit(id),
        periode_mulai   TEXT    NOT NULL,
        periode_selesai TEXT    NOT NULL,
        total_pcs       INTEGER NOT NULL DEFAULT 0,
        gaji_kotor      INTEGER NOT NULL DEFAULT 0,
        total_kasbon    INTEGER NOT NULL DEFAULT 0,
        bonus           INTEGER NOT NULL DEFAULT 0 CHECK (bonus >= 0),
        gaji_bersih     INTEGER GENERATED ALWAYS AS (gaji_kotor + bonus - total_kasbon) VIRTUAL,
        status          TEXT    NOT NULL DEFAULT 'Draft'
                        CHECK (status IN ('Draft','Diberikan')),
        dibayar_pada    TEXT,
        CHECK (periode_mulai <= periode_selesai)
      );
      CREATE UNIQUE INDEX idx_payroll_unik    ON payroll(penjahit_id, periode_mulai, periode_selesai);
      CREATE INDEX        idx_payroll_periode ON payroll(periode_mulai, periode_selesai);
      CREATE INDEX        idx_payroll_status  ON payroll(status);

      CREATE TABLE kasbon (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        tanggal     TEXT    NOT NULL DEFAULT (date('now','localtime')),
        penjahit_id INTEGER NOT NULL REFERENCES penjahit(id),
        nominal     INTEGER NOT NULL CHECK (nominal > 0),
        status      TEXT    NOT NULL DEFAULT 'Belum Lunas'
                    CHECK (status IN ('Belum Lunas','Lunas')),
        payroll_id  INTEGER REFERENCES payroll(id),
        keterangan  TEXT
      );
      CREATE INDEX idx_kasbon_penjahit ON kasbon(penjahit_id, status);
      CREATE INDEX idx_kasbon_tanggal  ON kasbon(tanggal, status);

      CREATE TRIGGER trg_payroll_kunci_ubah
      BEFORE UPDATE ON payroll
      FOR EACH ROW WHEN OLD.status = 'Diberikan'
      BEGIN
        SELECT RAISE(ABORT, 'Payroll berstatus Diberikan tidak boleh diubah');
      END;

      CREATE TRIGGER trg_payroll_kunci_hapus
      BEFORE DELETE ON payroll
      FOR EACH ROW WHEN OLD.status = 'Diberikan'
      BEGIN
        SELECT RAISE(ABORT, 'Payroll berstatus Diberikan tidak boleh dihapus');
      END;
    `
  },
  {
    versi: 2,
    sql: `
      ALTER TABLE setoran ADD COLUMN uang_dibawa INTEGER NOT NULL DEFAULT 0 CHECK (uang_dibawa >= 0);
    `
  }
];

function versiSkema(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

function terapkanMigrasi(db) {
  const sekarang = versiSkema(db);
  const perlu = daftarMigrasi.filter((m) => m.versi > sekarang);
  if (perlu.length === 0) return sekarang;

  db.exec('BEGIN');
  try {
    for (const migrasi of perlu) {
      db.exec(migrasi.sql);
      db.exec('PRAGMA user_version = ' + Number(migrasi.versi));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return versiSkema(db);
}

module.exports = { terapkanMigrasi, versiSkema, daftarMigrasi };
