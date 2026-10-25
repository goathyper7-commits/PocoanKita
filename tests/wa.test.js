'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalisasiWa,
  validasiWa,
  formatRupiah,
  formatTanggal,
  buatTautanWa,
  buatSlip
} = require('../src/layanan/wa');

test('normalisasi nomor WhatsApp berbagai format', () => {
  const kasus = [
    ['08123456789', '628123456789'],
    ['628123456789', '628123456789'],
    ['+62 812-3456-789', '628123456789'],
    ['0812 3456 7890', '6281234567890'],
    ['0812-3456-7890', '6281234567890'],
    ['(0812) 3456.7890', '6281234567890'],
    ['62 812 3456 789', '628123456789'],
    ['08123456789xyz', '628123456789']
  ];
  for (const [masukan, harapan] of kasus) {
    assert.equal(normalisasiWa(masukan), harapan, `normalisasi ${masukan}`);
    assert.equal(validasiWa(masukan), harapan, `validasi ${masukan}`);
  }
  dbujiTidakValid();
});

function dbujiTidakValid() {
  for (const salah of ['', '12345', '0812', 'abc', '+1 555 123 4567']) {
    assert.throws(() => validasiWa(salah), /tidak valid/, `menolak ${salah}`);
  }
}

test('format rupiah memakai pemisah ribuan titik', () => {
  assert.equal(formatRupiah(0), 'Rp 0');
  assert.equal(formatRupiah(2500), 'Rp 2.500');
  assert.equal(formatRupiah(300000), 'Rp 300.000');
  assert.equal(formatRupiah(1500000), 'Rp 1.500.000');
  assert.equal(formatRupiah(123456789), 'Rp 123.456.789');
  assert.equal(formatRupiah(null), 'Rp 0');
});

test('tautan wa.me memakai nomor bersih dan pesan ter-encode', () => {
  const tautan = buatTautanWa('0812 3456-7890', 'Halo, gaji kamu Rp 1.500.000');
  assert.ok(tautan.startsWith('https://wa.me/6281234567890?text='));
  const pesan = tautan.split('?text=')[1];
  assert.ok(!pesan.includes(' '), 'pesan harus ter-encode');
  assert.ok(decodeURIComponent(pesan).includes('Rp 1.500.000'));
});

test('slip memakai susunan sesuai spesifikasi bagian 6.1', () => {
  const teks = buatSlip({
    nama: 'Budi Santoso',
    kategori: 'Senior',
    periode_mulai: '2026-10-19',
    periode_selesai: '2026-10-24',
    rincian: [
      { nama_model: 'Kemeja Polos', pcs: 120, tarif: 2500, subtotal: 300000 },
      { nama_model: 'Gamis Cantik', pcs: 40, tarif: 3000, subtotal: 120000 }
    ],
    total_pcs: 160,
    gaji_kotor: 420000,
    bonus: 50000,
    total_kasbon: 70000,
    gaji_bersih: 400000,
    sisa_kasbon: 30000,
    kembalian: 25000
  });

  const urutan = [
    '*SLIP GAJI POCOAN PRODUKSI*',
    'Budi Santoso',
    'Senior',
    '19 Oktober 2026 s.d. 24 Oktober 2026',
    '*RINCIAN HASIL KERJA (PASS QC)*',
    'Kemeja Polos (120 pcs @ Rp 2.500) = Rp 300.000',
    'Gamis Cantik (40 pcs @ Rp 3.000) = Rp 120.000',
    '*Total Produksi:* 160 pcs',
    '*Upah Kotor:* Rp 420.000',
    '*Bonus / Lembur:* Rp 50.000',
    '*Potongan Kasbon:* - Rp 70.000',
    '*TOTAL DITERIMA:* Rp 400.000',
    '*Kembalian periode ini:* Rp 25.000',
    '*Sisa Kasbon Aktif:* Rp 30.000',
    '_Slip ini diterbitkan otomatis oleh sistem. Mohon diperiksa kembali sebelum disimpan._'
  ];

  let posisi = -1;
  for (const potongan of urutan) {
    const ditemukan = teks.indexOf(potongan);
    assert.ok(ditemukan > posisi, `bagian "${potongan}" harus muncul setelah bagian sebelumnya`);
    posisi = ditemukan;
  }

  assert.ok(teks.includes('='.repeat(8)), 'garis pemisah sama dengan');
  assert.ok(teks.includes('-'.repeat(8)), 'garis pemisah strip');
  assert.ok(teks.endsWith('._'), 'penutup miring');
});

test('slip tetap valid saat tidak ada produksi', () => {
  const teks = buatSlip({
    nama: 'Cahaya',
    kategori: 'Junior',
    periode_mulai: '2026-10-19',
    periode_selesai: '2026-10-24',
    rincian: [],
    total_pcs: 0,
    gaji_kotor: 0,
    bonus: 0,
    total_kasbon: 25000,
    gaji_bersih: -25000,
    sisa_kasbon: 0
  });
  assert.ok(teks.includes('Belum ada produksi lolos QC'));
  assert.ok(teks.includes('*TOTAL DITERIMA:*'));
  assert.ok(teks.includes('*Kembalian periode ini:* Rp 0'), 'kembalian bawaan nol tetap tampil');
  assert.ok(teks.includes('25.000'), 'nominal potongan tampil di total diterima');
});
