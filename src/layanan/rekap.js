'use strict';

const { Ragu, validasiTanggal } = require('../db');

function rekapMingguan(db, dari, sampai) {
  const t1 = validasiTanggal(dari, 'Periode awal');
  const t2 = validasiTanggal(sampai, 'Periode akhir');
  if (t1 > t2) throw new Ragu('Periode awal tidak boleh lewat periode akhir');

  // Tiga sumber angka dihitung terpisah per penjahit, baru digabungkan.
  // Tidak pernah menggabungkan setoran dan kasbon dalam satu query
  // (mencegah perkalian baris / fan-out).
  const produksi = new Map();
  for (const r of db
    .prepare(
      `SELECT penjahit_id,
              COUNT(*)              AS jml_setoran,
              COALESCE(SUM(bagus),0)  AS total_bagus,
              COALESCE(SUM(reject),0) AS total_reject,
              COALESCE(SUM(subtotal),0) AS gaji_kotor
         FROM setoran
        WHERE tanggal BETWEEN ? AND ?
        GROUP BY penjahit_id`
    )
    .all(t1, t2)) {
    produksi.set(r.penjahit_id, r);
  }

  const kasbonPeriode = new Map();
  for (const r of db
    .prepare(
      `SELECT penjahit_id, COALESCE(SUM(nominal),0) AS total
         FROM kasbon
        WHERE status = 'Belum Lunas' AND tanggal BETWEEN ? AND ?
        GROUP BY penjahit_id`
    )
    .all(t1, t2)) {
    kasbonPeriode.set(r.penjahit_id, r.total);
  }

  const sisaKasbon = new Map();
  for (const r of db
    .prepare(
      `SELECT penjahit_id, COALESCE(SUM(nominal),0) AS total
         FROM kasbon
        WHERE status = 'Belum Lunas'
        GROUP BY penjahit_id`
    )
    .all()) {
    sisaKasbon.set(r.penjahit_id, r.total);
  }

  const baris = [];
  const penjahitAktif = db
    .prepare("SELECT id, nama, kategori, wa FROM penjahit WHERE aktif = 1 ORDER BY nama COLLATE NOCASE ASC")
    .all();

  for (const p of penjahitAktif) {
    const prod = produksi.get(p.id) || {
      jml_setoran: 0,
      total_bagus: 0,
      total_reject: 0,
      gaji_kotor: 0
    };
    const kasPeriode = kasbonPeriode.get(p.id) || 0;
    const sisa = sisaKasbon.get(p.id) || 0;

    const punyaProduksi = prod.jml_setoran > 0;
    if (!punyaProduksi && sisa === 0) continue;

    baris.push({
      penjahit_id: p.id,
      nama: p.nama,
      kategori: p.kategori,
      wa: p.wa,
      total_bagus: prod.total_bagus,
      total_reject: prod.total_reject,
      gaji_kotor: prod.gaji_kotor,
      kasbon_periode: kasPeriode,
      sisa_kasbon: sisa,
      estimasi_bersih: prod.gaji_kotor - kasPeriode
    });
  }

  return { dari: t1, sampai: t2, baris };
}

module.exports = { rekapMingguan };
