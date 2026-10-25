'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dbUji, tambahPenjahit, tambahModel, tambahTarif, tambahSetoran, tambahKasbon } = require('./util');
const { rekapMingguan } = require('../src/layanan/rekap');

const DARI = '2026-10-19';
const SAMPAI = '2026-10-24';

function isiData(db) {
  const modelA = tambahModel(db, { kode: 'KMEJA-01', nama: 'Kemeja Polos' });
  const modelB = tambahModel(db, { kode: 'GAMIS-02', nama: 'Gamis Cantik' });
  tambahTarif(db, modelA, 'Senior', 2500);
  tambahTarif(db, modelB, 'Senior', 3000);

  // Budi: banyak setoran DAN banyak kasbon (uji anti fan-out)
  const budi = tambahPenjahit(db, { nama: 'Budi Santoso', wa: '628111111111' });
  tambahSetoran(db, { tanggal: '2026-10-19', penjahitId: budi, modelId: modelA, bagus: 10, reject: 1, tarif: 2500 });
  tambahSetoran(db, { tanggal: '2026-10-20', penjahitId: budi, modelId: modelA, bagus: 20, reject: 2, tarif: 2500 });
  tambahSetoran(db, { tanggal: '2026-10-21', penjahitId: budi, modelId: modelA, bagus: 5, reject: 0, tarif: 2500 });
  tambahSetoran(db, { tanggal: '2026-10-22', penjahitId: budi, modelId: modelB, bagus: 7, reject: 3, tarif: 3000 });
  tambahSetoran(db, { tanggal: '2026-10-23', penjahitId: budi, modelId: modelB, bagus: 12, reject: 0, tarif: 3000 });
  tambahKasbon(db, { tanggal: '2026-10-20', penjahitId: budi, nominal: 100000 });
  tambahKasbon(db, { tanggal: '2026-10-23', penjahitId: budi, nominal: 50000 });
  tambahKasbon(db, { tanggal: '2026-10-01', penjahitId: budi, nominal: 70000 });
  const kasbonLunas = tambahKasbon(db, { tanggal: '2026-10-21', penjahitId: budi, nominal: 30000 });
  db.prepare("UPDATE kasbon SET status = 'Lunas' WHERE id = ?").run(kasbonLunas);

  // Cahaya: tanpa produksi, punya sisa kasbon → tetap tampil dengan nol
  const cahaya = tambahPenjahit(db, { nama: 'Cahaya', wa: '628222222222', kategori: 'Junior' });
  tambahKasbon(db, { tanggal: '2026-09-10', penjahitId: cahaya, nominal: 25000 });

  // Dedi: tanpa produksi dan tanpa kasbon → disembunyikan
  tambahPenjahit(db, { nama: 'Dedi', wa: '628333333333' });

  // Eka: nonaktif → tidak muncul meski punya produksi
  const eka = tambahPenjahit(db, { nama: 'Eka', wa: '628444444444', aktif: 0 });
  tambahSetoran(db, { tanggal: '2026-10-19', penjahitId: eka, modelId: modelA, bagus: 99, reject: 0, tarif: 2500 });

  return { budi, cahaya };
}

test('rekap menghitung tiga sumber angka terpisah tanpa perkalian baris', () => {
  const db = dbUji();
  const { budi, cahaya } = isiData(db);

  const hasil = rekapMingguan(db, DARI, SAMPAI);
  assert.equal(hasil.dari, DARI);
  assert.equal(hasil.sampai, SAMPAI);

  const namaUrut = hasil.baris.map((b) => b.nama);
  assert.deepEqual(namaUrut, ['Budi Santoso', 'Cahaya'], 'urut nama A-Z dan penjahit tanpa data disembunyikan');

  const budiBaris = hasil.baris.find((b) => b.penjahit_id === budi);
  // Nilai dihitung manual dari data contoh di atas.
  assert.equal(budiBaris.total_bagus, 10 + 20 + 5 + 7 + 12);
  assert.equal(budiBaris.total_reject, 1 + 2 + 0 + 3 + 0);
  assert.equal(budiBaris.gaji_kotor, 10 * 2500 + 20 * 2500 + 5 * 2500 + 7 * 3000 + 12 * 3000);
  assert.equal(budiBaris.kasbon_periode, 100000 + 50000, 'kasbon lunas di periode tidak dihitung');
  assert.equal(budiBaris.sisa_kasbon, 100000 + 50000 + 70000, 'hanya kasbon belum lunas, dari kapan pun');
  assert.equal(budiBaris.estimasi_bersih, budiBaris.gaji_kotor - budiBaris.kasbon_periode);
  assert.equal(budiBaris.wa, '628111111111');

  const cahayaBaris = hasil.baris.find((b) => b.penjahit_id === cahaya);
  assert.equal(cahayaBaris.total_bagus, 0);
  assert.equal(cahayaBaris.total_reject, 0);
  assert.equal(cahayaBaris.gaji_kotor, 0);
  assert.equal(cahayaBaris.kasbon_periode, 0, 'kasbon luar periode bukan kasbon periode');
  assert.equal(cahayaBaris.sisa_kasbon, 25000);
  assert.equal(cahayaBaris.estimasi_bersih, 0, 'kasbon luar periode tidak mengurangi estimasi periode ini');

  db.close();
});

test('rekap periode kosong tetap menampilkan penjahit yang punya sisa kasbon', () => {
  const db = dbUji();
  const { budi, cahaya } = isiData(db);
  const hasil = rekapMingguan(db, '2027-01-01', '2027-01-07');
  assert.deepEqual(hasil.baris.map((b) => b.penjahit_id).sort(), [budi, cahaya].sort());
  for (const baris of hasil.baris) {
    assert.equal(baris.total_bagus, 0);
    assert.equal(baris.gaji_kotor, 0);
    assert.equal(baris.kasbon_periode, 0);
  }
  db.close();
});

test('rekap menolak periode yang kebalik atau format salah', () => {
  const db = dbUji();
  assert.throws(() => rekapMingguan(db, SAMPAI, DARI), /tidak boleh lewat/);
  assert.throws(() => rekapMingguan(db, '24-10-2026', SAMPAI), /YYYY-MM-DD/);
  db.close();
});
