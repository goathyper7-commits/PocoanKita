'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dbUji, tambahPenjahit, tambahModel, tambahTarif, tambahSetoran, tambahKasbon } = require('./util');
const { prosesPayroll } = require('../src/layanan/payroll');

const DARI = '2026-10-19';
const SAMPAI = '2026-10-24';

function siapkan(db) {
  const model = tambahModel(db, { kode: 'KMEJA-01', nama: 'Kemeja Polos' });
  tambahTarif(db, model, 'Senior', 2500);
  const budi = tambahPenjahit(db, { nama: 'Budi', wa: '628111111111' });
  tambahSetoran(db, { tanggal: '2026-10-20', penjahitId: budi, modelId: model, bagus: 40, reject: 2, tarif: 2500 });
  tambahSetoran(db, { tanggal: '2026-10-21', penjahitId: budi, modelId: model, bagus: 60, reject: 0, tarif: 2500 });
  tambahSetoran(db, { tanggal: '2026-10-26', penjahitId: budi, modelId: model, bagus: 100, reject: 0, tarif: 2500 }); // di luar periode
  tambahKasbon(db, { tanggal: '2026-10-19', penjahitId: budi, nominal: 80000 });
  tambahKasbon(db, { tanggal: '2026-10-24', penjahitId: budi, nominal: 20000 });
  tambahKasbon(db, { tanggal: '2026-10-25', penjahitId: budi, nominal: 50000 }); // setelah periode
  return { budi, model };
}

test('payroll menghitung dari setoran, melunasi kasbon, dan mengunci record', () => {
  const db = dbUji();
  const { budi } = siapkan(db);

  const hasil = prosesPayroll(db, {
    penjahit_id: budi,
    periode_mulai: DARI,
    periode_selesai: SAMPAI,
    bonus: 15000
  });

  assert.equal(hasil.status, 'Diberikan');
  assert.ok(hasil.dibayar_pada, 'waktu bayar terisi');
  assert.equal(hasil.total_pcs, 40 + 60, 'hanya pcs lolos QC, di luar periode tidak dihitung');
  assert.equal(hasil.gaji_kotor, (40 + 60) * 2500);
  assert.equal(hasil.total_kasbon, 80000 + 20000, 'kasbon setelah akhir periode tidak dipotong');
  assert.equal(hasil.bonus, 15000);
  assert.equal(hasil.gaji_bersih, 100 * 2500 + 15000 - 100000);

  // gaji_bersih adalah kolom generated yang dihitung basis data
  const baris = db.prepare('SELECT gaji_bersih FROM payroll WHERE id = ?').get(hasil.id);
  assert.equal(baris.gaji_bersih, hasil.gaji_bersih);

  // kasbon tertaut ke payroll dan berstatus lunas
  const lunas = db
    .prepare("SELECT id, payroll_id FROM kasbon WHERE penjahit_id = ? AND status = 'Lunas' ORDER BY id")
    .all(budi);
  assert.equal(lunas.length, 2);
  for (const k of lunas) assert.equal(k.payroll_id, hasil.id);

  const sisa = db
    .prepare("SELECT COUNT(*) c FROM kasbon WHERE penjahit_id = ? AND status = 'Belum Lunas'")
    .get(budi).c;
  assert.equal(sisa, 1, 'kasbon setelah periode tetap belum lunas');

  db.close();
});

test('payroll menolak periode sama dan tumpang tindih', () => {
  const db = dbUji();
  const { budi } = siapkan(db);
  prosesPayroll(db, { penjahit_id: budi, periode_mulai: DARI, periode_selesai: SAMPAI, bonus: 0 });

  assert.throws(
    () => prosesPayroll(db, { penjahit_id: budi, periode_mulai: DARI, periode_selesai: SAMPAI, bonus: 0 }),
    /tumpang tindih/
  );
  assert.throws(
    () => prosesPayroll(db, { penjahit_id: budi, periode_mulai: '2026-10-22', periode_selesai: '2026-10-30', bonus: 0 }),
    /tumpang tindih/
  );

  const jumlah = db.prepare('SELECT COUNT(*) c FROM payroll').get().c;
  assert.equal(jumlah, 1, 'hanya satu payroll tersimpan');
  db.close();
});

test('payroll menolak gaji bersih negatif tanpa menyimpan apa pun', () => {
  const db = dbUji();
  const model = tambahModel(db, { kode: 'MINI-01', nama: 'Produksi Mini' });
  tambahTarif(db, model, 'Senior', 100);
  const mini = tambahPenjahit(db, { nama: 'Mini', wa: '628555555555' });
  tambahSetoran(db, { tanggal: '2026-10-20', penjahitId: mini, modelId: model, bagus: 10, reject: 0, tarif: 100 });
  tambahKasbon(db, { tanggal: '2026-10-21', penjahitId: mini, nominal: 5000 });

  assert.throws(
    () => prosesPayroll(db, { penjahit_id: mini, periode_mulai: DARI, periode_selesai: SAMPAI, bonus: 0 }),
    /negatif/
  );

  assert.equal(db.prepare('SELECT COUNT(*) c FROM payroll').get().c, 0);
  const lunas = db.prepare("SELECT COUNT(*) c FROM kasbon WHERE status = 'Lunas'").get().c;
  assert.equal(lunas, 0, 'tidak ada kasbon yang berubah');
  db.close();
});

test('kegagalan di tengah transaksi membatalkan seluruh payroll (rollback penuh)', () => {
  const db = dbUji();
  const { budi } = siapkan(db);

  // Sabotase: paksa pembaruan kasbon gagal setelah record payroll sempat disisipkan
  db.exec(`
    CREATE TRIGGER gagal_kasbon BEFORE UPDATE ON kasbon
    BEGIN SELECT RAISE(ABORT, 'simulasi kegagalan'); END
  `);

  assert.throws(
    () => prosesPayroll(db, { penjahit_id: budi, periode_mulai: DARI, periode_selesai: SAMPAI, bonus: 0 }),
    /simulasi kegagalan/
  );

  assert.equal(db.prepare('SELECT COUNT(*) c FROM payroll').get().c, 0, 'record payroll ikut terhapus');
  const lunas = db.prepare("SELECT COUNT(*) c FROM kasbon WHERE status = 'Lunas'").get().c;
  assert.equal(lunas, 0, 'kasbon tetap belum lunas');

  db.exec('DROP TRIGGER gagal_kasbon');

  // Setelah pemicu dilepas, proses berjalan normal (bukti DB tidak korup)
  const hasil = prosesPayroll(db, {
    penjahit_id: budi,
    periode_mulai: DARI,
    periode_selesai: SAMPAI,
    bonus: 0
  });
  assert.equal(hasil.status, 'Diberikan');
  db.close();
});

test('payroll Diberikan tidak bisa diubah atau dihapus (trigger pengunci)', () => {
  const db = dbUji();
  const { budi } = siapkan(db);
  const hasil = prosesPayroll(db, {
    penjahit_id: budi,
    periode_mulai: DARI,
    periode_selesai: SAMPAI,
    bonus: 0
  });

  assert.throws(
    () => db.prepare('UPDATE payroll SET bonus = 999999 WHERE id = ?').run(hasil.id),
    /tidak boleh diubah/
  );
  assert.throws(() => db.prepare('DELETE FROM payroll WHERE id = ?').run(hasil.id), /tidak boleh dihapus/);

  const bonus = db.prepare('SELECT bonus FROM payroll WHERE id = ?').get(hasil.id).bonus;
  assert.equal(bonus, 0);
  db.close();
});

test('payroll menolak input tidak valid', () => {
  const db = dbUji();
  const { budi } = siapkan(db);
  assert.throws(() => prosesPayroll(db, { penjahit_id: budi, periode_mulai: '19/10/2026', periode_selesai: SAMPAI }), /YYYY-MM-DD/);
  assert.throws(() => prosesPayroll(db, { penjahit_id: 9999, periode_mulai: DARI, periode_selesai: SAMPAI }), /tidak ditemukan/);
  assert.throws(() => prosesPayroll(db, { penjahit_id: budi, periode_mulai: SAMPAI, periode_selesai: DARI }), /tidak boleh lewat/);
  assert.throws(() => prosesPayroll(db, { penjahit_id: budi, periode_mulai: DARI, periode_selesai: SAMPAI, bonus: -5 }), /tidak boleh/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM payroll').get().c, 0);
  db.close();
});
