'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { dbUji } = require('./util');
const { buatServer } = require('../src/http');

let server;
let db;
let dasar;

before(async () => {
  db = dbUji();
  server = buatServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  dasar = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
});

async function meminta(jalur, opsi = {}) {
  const res = await fetch(dasar + jalur, {
    method: opsi.method || 'GET',
    headers: opsi.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opsi.body ? JSON.stringify(opsi.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('alur lengkap lewat HTTP: master, setoran, rekap, payroll, slip, penjaga', async () => {
  // 1. penjahit dengan nomor berformat kotor
  const p = await meminta('/api/penjahit', {
    method: 'POST',
    body: { nama: 'Budi Santoso', wa: '0812 3456-7890', kategori: 'Senior' }
  });
  assert.equal(p.status, 201);
  assert.equal(p.data.data.wa, '6281234567890', 'nomor dinormalkan saat disimpan');

  const duplikat = await meminta('/api/penjahit', {
    method: 'POST',
    body: { nama: 'Pemain Baru', wa: '+62 812-3456-7890' }
  });
  assert.equal(duplikat.status, 409, 'nomor ganda ditolak');

  // 2. model + tarif
  const m = await meminta('/api/model', {
    method: 'POST',
    body: { kode: 'KMEJA-01', nama: 'Kemeja Polos' }
  });
  assert.equal(m.status, 201);
  const modelId = m.data.data.id;

  const t = await meminta('/api/tarif', {
    method: 'PUT',
    body: { model_id: modelId, tarif: { Senior: 2500, Junior: 2000 } }
  });
  assert.equal(t.status, 200);
  assert.deepEqual(t.data.data, { Senior: 2500, Junior: 2000 }, 'tarif Magang sengaja belum diatur');

  // 3. setoran tanpa tarif kategori lain → ditolak jelas
  const pMagang = await meminta('/api/penjahit', {
    method: 'POST',
    body: { nama: 'Anak Magang', wa: '08999999999', kategori: 'Magang' }
  });
  const magangId = pMagang.data.data.id;
  const tanpaTarif = await meminta('/api/setoran', {
    method: 'POST',
    body: { tanggal: '2026-10-20', penjahit_id: magangId, model_id: modelId, bagus: 5, reject: 0 }
  });
  assert.equal(tanpaTarif.status, 422);
  assert.match(tanpaTarif.data.pesan, /Tarif belum diatur/);

  // 4. setoran sah, lengkap dengan uang dibawa
  const budiId = p.data.data.id;
  const s1 = await meminta('/api/setoran', {
    method: 'POST',
    body: {
      tanggal: '2026-10-20',
      penjahit_id: budiId,
      model_id: modelId,
      bagus: 120,
      reject: 5,
      uang_dibawa: 400000
    }
  });
  assert.equal(s1.status, 201);
  assert.equal(s1.data.data.subtotal, 300000);
  assert.equal(s1.data.data.uang_dibawa, 400000);
  assert.equal(s1.data.data.kembalian, 100000, 'kembalian = uang dibawa − subtotal upah');

  // uang kurang tidak membatalkan setoran, hanya menghasilkan kembalian negatif
  const kurang = await meminta('/api/setoran', {
    method: 'POST',
    body: { tanggal: '2026-10-21', penjahit_id: budiId, model_id: modelId, bagus: 10, uang_dibawa: 10000 }
  });
  assert.equal(kurang.status, 201);
  assert.equal(kurang.data.data.kembalian, 10000 - 25000, 'kembalian negatif = uang kurang');
  await meminta(`/api/setoran/${kurang.data.data.id}`, { method: 'DELETE' });

  const uangNegatif = await meminta('/api/setoran', {
    method: 'POST',
    body: { tanggal: '2026-10-20', penjahit_id: budiId, model_id: modelId, bagus: 1, uang_dibawa: -1000 }
  });
  assert.equal(uangNegatif.status, 400, 'uang dibawa negatif ditolak');
  assert.match(uangNegatif.data.pesan, /Uang dibawa tidak boleh kurang dari 0/);

  const daftarSetoran = await meminta('/api/setoran');
  const lihatS1 = daftarSetoran.data.data.find((s) => s.id === s1.data.data.id);
  assert.equal(lihatS1.kembalian, 100000, 'daftar setoran ikut mengirim kembalian');

  const s2 = await meminta('/api/setoran', {
    method: 'POST',
    body: { tanggal: '2026-10-21', penjahit_id: budiId, model_id: modelId, bagus: 80, reject: 0 }
  });
  assert.equal(s2.status, 201);
  assert.equal(s2.data.data.uang_dibawa, 0, 'uang dibawa bawaan nol');
  assert.equal(s2.data.data.kembalian, -200000, 'tanpa uang, kembalian = −subtotal');

  // 5. kasbon
  const k = await meminta('/api/kasbon', {
    method: 'POST',
    body: { tanggal: '2026-10-22', penjahit_id: budiId, nominal: 100000, keterangan: 'DP' }
  });
  assert.equal(k.status, 201);
  const kasbonId = k.data.data.id;

  // 6. rekap
  const r = await meminta('/api/rekap?dari=2026-10-19&sampai=2026-10-24');
  assert.equal(r.status, 200);
  const baris = r.data.data.baris;
  const budi = baris.find((b) => b.penjahit_id === budiId);
  assert.ok(budi, 'Budi muncul di rekap');
  assert.equal(budi.total_bagus, 200);
  assert.equal(budi.total_reject, 5);
  assert.equal(budi.gaji_kotor, 500000);
  assert.equal(budi.kasbon_periode, 100000);
  assert.equal(budi.sisa_kasbon, 100000);

  // 7. payroll atomik
  const pay = await meminta('/api/payroll', {
    method: 'POST',
    body: { penjahit_id: budiId, periode_mulai: '2026-10-19', periode_selesai: '2026-10-24', bonus: 20000 }
  });
  assert.equal(pay.status, 201);
  const payrollId = pay.data.data.id;
  assert.equal(pay.data.data.gaji_bersih, 500000 + 20000 - 100000);

  // kasbon lunas tertaut
  const kLunas = await meminta(`/api/kasbon?penjahit_id=${budiId}&status=Lunas`);
  assert.equal(kLunas.data.data.length, 1);
  assert.equal(kLunas.data.data[0].payroll_id, payrollId);

  // 8. penjaga: setoran pada periode terkunci masih tidak boleh diubah
  const ubahSetoran = await meminta(`/api/setoran/${s1.data.data.id}`, {
    method: 'PUT',
    body: { bagus: 999 }
  });
  assert.equal(ubahSetoran.status, 409);
  assert.match(ubahSetoran.data.pesan, /payroll yang dikunci/);

  // 9. penjaga: kasbon lunas tidak bisa diubah manual jadi lunas/dihapus
  const ubahKasbon = await meminta(`/api/kasbon/${kasbonId}`, {
    method: 'PUT',
    body: { nominal: 1, status: 'Lunas' }
  });
  assert.equal(ubahKasbon.status, 409);

  // 10. penjaga: payroll ganda / tumpang tindih
  const dobel = await meminta('/api/payroll', {
    method: 'POST',
    body: { penjahit_id: budiId, periode_mulai: '2026-10-19', periode_selesai: '2026-10-24', bonus: 0 }
  });
  assert.equal(dobel.status, 409);
  assert.match(dobel.data.pesan, /tumpang tindih/);

  const tumpang = await meminta('/api/payroll', {
    method: 'POST',
    body: { penjahit_id: budiId, periode_mulai: '2026-10-22', periode_selesai: '2026-10-30', bonus: 0 }
  });
  assert.equal(tumpang.status, 409);

  // 11. slip WhatsApp
  const slip = await meminta(`/api/payroll/${payrollId}/slip`);
  assert.equal(slip.status, 200);
  assert.ok(slip.data.data.tautan.startsWith('https://wa.me/6281234567890?text='));
  assert.ok(slip.data.data.teks.includes('*SLIP GAJI POCOAN PRODUKSI*'));
  assert.ok(slip.data.data.teks.includes('Kemeja Polos (200 pcs @ Rp 2.500) = Rp 500.000'));
  assert.ok(slip.data.data.teks.includes('*TOTAL DITERIMA:* Rp 420.000'));
  assert.ok(slip.data.data.teks.includes('*Sisa Kasbon Aktif:* Rp 0'));

  // kembalian periode = total (uang dibawa − subtotal) seluruh setoran periode
  const detail = await meminta(`/api/payroll/${payrollId}`);
  assert.equal(detail.data.data.kembalian_periode, 100000 - 200000);
  const kembalianSlip = slip.data.data.teks.split('*Kembalian periode ini:* ')[1].split('\n')[0];
  assert.equal(kembalianSlip, 'kurang Rp 100.000', 'kembalian negatif ditulis "kurang"');

  // 12. riwayat
  const riwayat = await meminta(`/api/payroll?dari=2026-10-19&sampai=2026-10-24`);
  assert.equal(riwayat.data.data.length, 1);
  assert.equal(riwayat.data.data[0].status, 'Diberikan');

  // 13. setoran tetap bisa dihapus meski sudah dipayroll;
  //     record payroll yang terkunci tidak dihitung ulang
  const hapusSetoran = await meminta(`/api/setoran/${s1.data.data.id}`, { method: 'DELETE' });
  assert.equal(hapusSetoran.status, 200, 'hapus setoran terkunci tetap diizinkan');

  const setoranSisa = await meminta('/api/setoran');
  assert.equal(setoranSisa.data.data.length, 1, 'satu setoran tersisa');

  const paySesudah = await meminta(`/api/payroll/${payrollId}`);
  assert.equal(paySesudah.status, 200);
  assert.equal(paySesudah.data.data.total_pcs, 200, 'total pcs payroll tetap 200');
  assert.equal(paySesudah.data.data.gaji_kotor, 500000, 'gaji kotor payroll tetap Rp 500.000');
  assert.equal(paySesudah.data.data.gaji_bersih, 420000);

  // rekap periode berubah mengikuti setoran yang dihapus
  const rekapSesudah = await meminta('/api/rekap?dari=2026-10-19&sampai=2026-10-24');
  const budiSesudah = rekapSesudah.data.data.baris.find((b) => b.penjahit_id === budiId);
  assert.equal(budiSesudah.total_bagus, 80);
  assert.equal(budiSesudah.gaji_kotor, 200000);
});

test('endpoint tidak dikenal mengembalikan 404 JSON', async () => {
  const res = await meminta('/api/tidak-ada');
  assert.equal(res.status, 404);
  assert.equal(res.data.ok, false);
  assert.ok(res.data.pesan);
});

test('halaman utama disajikan sebagai HTML', async () => {
  const res = await fetch(dasar + '/');
  assert.equal(res.status, 200);
  const teks = await res.text();
  assert.ok(teks.includes('Pocoan Payroll'));
  assert.ok(teks.includes('app.js'));
});

test('percobaan path traversal statis diblokir', async () => {
  const res = await fetch(dasar + '/../package.json');
  const teks = await res.text();
  assert.ok(!teks.includes('"scripts"'), 'berkas di luar folder publik tidak boleh terbaca');
});
