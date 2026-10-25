'use strict';

const { Ragu } = require('../db');

const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

function normalisasiWa(nilai) {
  const bersih = String(nilai == null ? '' : nilai).replace(/\D+/g, '');
  if (bersih.startsWith('0')) return '62' + bersih.slice(1);
  return bersih;
}

function validasiWa(nilai) {
  const nomor = normalisasiWa(nilai);
  if (!/^62\d{9,13}$/.test(nomor)) {
    throw new Ragu(
      `Nomor WhatsApp tidak valid: "${nilai}". ` +
        'Gunakan angka saja, diawali 0 (contoh 08123456789) atau 62 (contoh 628123456789).'
    );
  }
  return nomor;
}

function formatRupiah(nilai) {
  const n = Number(nilai) || 0;
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.trunc(n));
}

function formatTanggal(teks) {
  const [t, b, h] = String(teks).split('-').map(Number);
  if (!t || !b || !h) return String(teks);
  return `${h} ${BULAN[b - 1]} ${t}`;
}

function buatTautanWa(nomor, teks) {
  const nomorBersih = normalisasiWa(nomor);
  return `https://wa.me/${nomorBersih}?text=${encodeURIComponent(teks)}`;
}

const GARIS_SAMA_DENGAN = '='.repeat(28);
const GARIS_STRIP = '-'.repeat(28);

function buatSlip({ nama, kategori, periode_mulai, periode_selesai, rincian, total_pcs, gaji_kotor, bonus, total_kasbon, gaji_bersih, sisa_kasbon, kembalian = 0 }) {
  const baris = [];
  baris.push('*SLIP GAJI POCOAN PRODUKSI*');
  baris.push(GARIS_SAMA_DENGAN);
  baris.push(GARIS_STRIP);
  baris.push('');
  baris.push(`*Nama:* ${nama}`);
  baris.push(`*Kategori:* ${kategori}`);
  baris.push(`*Periode:* ${formatTanggal(periode_mulai)} s.d. ${formatTanggal(periode_selesai)}`);
  baris.push('');
  baris.push('*RINCIAN HASIL KERJA (PASS QC)*');

  if (!rincian || rincian.length === 0) {
    baris.push('Belum ada produksi lolos QC pada periode ini.');
  } else {
    for (const r of rincian) {
      baris.push(
        `${r.nama_model} (${r.pcs} pcs @ ${formatRupiah(r.tarif)}) = ${formatRupiah(r.subtotal)}`
      );
    }
  }

  baris.push(GARIS_STRIP);
  baris.push('');
  baris.push(`*Total Produksi:* ${total_pcs} pcs`);
  baris.push(`*Upah Kotor:* ${formatRupiah(gaji_kotor)}`);
  baris.push(`*Bonus / Lembur:* ${formatRupiah(bonus)}`);
  baris.push(`*Potongan Kasbon:* - ${formatRupiah(total_kasbon)}`);
  baris.push('');
  baris.push(`*TOTAL DITERIMA:* ${formatRupiah(gaji_bersih)}`);
  const selisih = Number(kembalian) || 0;
  baris.push(
    `*Kembalian periode ini:* ${selisih < 0 ? 'kurang ' : ''}${formatRupiah(Math.abs(selisih))}`
  );
  baris.push(`*Sisa Kasbon Aktif:* ${formatRupiah(sisa_kasbon)}`);
  baris.push(
    '_Slip ini diterbitkan otomatis oleh sistem. Mohon diperiksa kembali sebelum disimpan._'
  );

  return baris.join('\n');
}

module.exports = {
  normalisasiWa,
  validasiWa,
  formatRupiah,
  formatTanggal,
  buatTautanWa,
  buatSlip
};
