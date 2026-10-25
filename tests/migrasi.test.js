'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { daftarMigrasi, terapkanMigrasi, versiSkema } = require('../src/migrasi');
const { bukaDatabase } = require('../src/db');

test('basis data lama (v1) naik ke v2 dan menambah kolom uang_dibawa', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');

  // bangun skema versi 1 persis seperti rilis awal
  db.exec(daftarMigrasi[0].sql);
  db.exec('PRAGMA user_version = 1');
  assert.equal(versiSkema(db), 1);
  assert.throws(() => db.prepare('SELECT uang_dibawa FROM setoran').all(), /no such column/);

  // ada data lama yang harus bertahan
  db.prepare("INSERT INTO penjahit (nama, wa) VALUES ('Lama', '6281111000')").run();
  const idPenjahit = db.prepare('SELECT id FROM penjahit').get().id;
  db.prepare("INSERT INTO model (kode, nama) VALUES ('LAMA-01', 'Model Lama')").run();
  const idModel = db.prepare('SELECT id FROM model').get().id;
  db.prepare('INSERT INTO tarif (model_id, kategori, tarif_pcs) VALUES (?, ?, ?)').run(
    idModel,
    'Senior',
    2500
  );
  db.prepare(
    `INSERT INTO setoran (tanggal, penjahit_id, model_id, bagus, reject, tarif_diterapkan)
     VALUES ('2026-10-01', ?, ?, 70, 2, 2500)`
  ).run(idPenjahit, idModel);

  const versi = terapkanMigrasi(db);
  assert.equal(versi, 2, 'user_version naik ke 2');

  const kolom = db.prepare('PRAGMA table_info(setoran)').all().map((c) => c.name);
  assert.ok(kolom.includes('uang_dibawa'), 'kolom uang_dibawa tersedia');
  assert.ok(!kolom.includes('bawa'), 'kolom bawa pcs lama tidak ada');

  // baris lama mendapat nilai bawaan nol
  const lama = db.prepare('SELECT * FROM setoran').get();
  assert.equal(lama.uang_dibawa, 0);

  // kembalian lama = uang_dibawa − subtotal (contoh: uang 200.000, setoran 175.000)
  db.prepare('UPDATE setoran SET uang_dibawa = 200000 WHERE id = ?').run(lama.id);
  const contoh = db
    .prepare('SELECT (uang_dibawa - subtotal) AS kembalian, subtotal FROM setoran WHERE id = ?')
    .get(lama.id);
  assert.equal(contoh.subtotal, 70 * 2500, 'subtotal 175.000');
  assert.equal(contoh.kembalian, 25000, 'kembalian 25.000');

  // setoran baru bisa memakai kolom baru
  db.prepare(
    `INSERT INTO setoran (tanggal, penjahit_id, model_id, bagus, reject, uang_dibawa, tarif_diterapkan)
     VALUES ('2026-10-02', ?, ?, 8, 1, 50000, 2500)`
  ).run(idPenjahit, idModel);
  const baru = db.prepare("SELECT * FROM setoran WHERE tanggal = '2026-10-02'").get();
  assert.equal(baru.uang_dibawa, 50000);

  // nilai negatif ditolak CHECK constraint
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO setoran (tanggal, penjahit_id, model_id, bagus, reject, uang_dibawa, tarif_diterapkan)
           VALUES ('2026-10-03', ?, ?, 1, 0, -1000, 2500)`
        )
        .run(idPenjahit, idModel),
    /CHECK constraint failed/
  );

  // migrasi idempoten: dijalankan lagi tidak error
  assert.equal(terapkanMigrasi(db), 2);
  db.close();
});

test('bukaDatabase baru membuat skema lengkap versi terkini', () => {
  const db = bukaDatabase(':memory:');
  assert.equal(versiSkema(db), daftarMigrasi[daftarMigrasi.length - 1].versi);
  const kolom = db.prepare('PRAGMA table_info(setoran)').all().map((c) => c.name);
  assert.ok(kolom.includes('uang_dibawa'));
  db.close();
});
