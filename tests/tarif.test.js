'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dbUji, tambahPenjahit, tambahModel, tambahTarif, tambahSetoran } = require('./util');
const { wajibAdaTarif, simpanTarif, daftarTarif } = require('../src/layanan/tarif');
const { prosesPayroll } = require('../src/layanan/payroll');

test('tarif terkunci pada setoran lama saat tarif diubah', () => {
  const db = dbUji();
  const model = tambahModel(db, { kode: 'KMEJA-01', nama: 'Kemeja Polos' });
  tambahTarif(db, model, 'Senior', 2500);
  const budi = tambahPenjahit(db, { nama: 'Budi', wa: '628111111111' });

  tambahSetoran(db, { tanggal: '2026-10-20', penjahitId: budi, modelId: model, bagus: 10, reject: 0, tarif: 2500 });
  const lama = db.prepare('SELECT * FROM setoran').get();
  assert.equal(lama.tarif_diterapkan, 2500);
  assert.equal(lama.subtotal, 25000);

  simpanTarif(db, model, { Senior: 4000 });

  const sesudah = db.prepare('SELECT * FROM setoran').get();
  assert.equal(sesudah.tarif_diterapkan, 2500, 'tarif lama tidak berubah');
  assert.equal(sesudah.subtotal, 25000, 'subtotal lama tidak berubah');

  tambahSetoran(db, { tanggal: '2026-10-21', penjahitId: budi, modelId: model, bagus: 10, reject: 0, tarif: wajibAdaTarif(db, model, 'Senior') });
  const baru = db.prepare('SELECT * FROM setoran ORDER BY id DESC').get();
  assert.equal(baru.tarif_diterapkan, 4000, 'setoran baru memakai tarif terbaru');
  assert.equal(baru.subtotal, 40000);

  db.close();
});

test('tarif tidak ditemukan ditolak dengan pesan jelas, bukan nol diam-diam', () => {
  const db = dbUji();
  const model = tambahModel(db, { kode: 'GAMIS-02', nama: 'Gamis' });
  const siti = tambahPenjahit(db, { nama: 'Siti', wa: '628222222222', kategori: 'Magang' });

  assert.throws(
    () => wajibAdaTarif(db, model, 'Magang'),
    /Tarif belum diatur untuk model GAMIS-02 - Gamis kategori Magang/
  );

  // pastikan tidak ada baris setoran yang tersimpan saat tarif absen
  assert.equal(db.prepare('SELECT COUNT(*) c FROM setoran').get().c, 0);
  assert.ok(siti);
  db.close();
});

test('upah hanya dihitung dari pcs lolos QC', () => {
  const db = dbUji();
  const model = tambahModel(db);
  tambahTarif(db, model, 'Senior', 2500);
  const budi = tambahPenjahit(db, { wa: '628111111111' });

  tambahSetoran(db, { tanggal: '2026-10-20', penjahitId: budi, modelId: model, bagus: 8, reject: 12, tarif: 2500 });
  const baris = db.prepare('SELECT * FROM setoran').get();
  assert.equal(baris.subtotal, 8 * 2500, 'reject tidak menambah upah');

  const hasil = prosesPayroll(db, {
    penjahit_id: budi,
    periode_mulai: '2026-10-19',
    periode_selesai: '2026-10-25',
    bonus: 0
  });
  assert.equal(hasil.total_pcs, 8);
  assert.equal(hasil.gaji_kotor, 20000);
  db.close();
});

test('matriks tarif hanya boleh satu nilai per kombinasi model dan kategori', () => {
  const db = dbUji();
  const model = tambahModel(db);
  simpanTarif(db, model, { Senior: 2500, Junior: 2000, Magang: 1500 });
  simpanTarif(db, model, { Senior: 2600 });

  const semua = daftarTarif(db)[model];
  assert.deepEqual(semua, { Senior: 2600, Junior: 2000, Magang: 1500 });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tarif WHERE model_id = ?').get(model).c, 3);

  assert.throws(() => simpanTarif(db, model, { Senior: -100 }), /tidak boleh negatif/);
  db.close();
});
