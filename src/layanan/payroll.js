'use strict';

const { Ragu, transaksi, validasiTanggal, validasiBilanganBulat } = require('../db');

function prosesPayroll(db, { penjahit_id, periode_mulai, periode_selesai, bonus = 0 }) {
  const penjahitId = validasiBilanganBulat(penjahit_id, 'Penjahit');
  const mulai = validasiTanggal(periode_mulai, 'Periode awal');
  const selesai = validasiTanggal(periode_selesai, 'Periode akhir');
  const bonusNilai = validasiBilanganBulat(bonus, 'Bonus lembur', { minimal: 0 });

  if (mulai > selesai) throw new Ragu('Periode awal tidak boleh lewat periode akhir');

  const penjahit = db
    .prepare('SELECT id, nama, kategori, wa, aktif FROM penjahit WHERE id = ?')
    .get(penjahitId);
  if (!penjahit) throw new Ragu('Penjahit tidak ditemukan', 404);

  return transaksi(db, () => {
    const tumpang = db
      .prepare(
        `SELECT id, periode_mulai, periode_selesai
           FROM payroll
          WHERE penjahit_id = ?
            AND periode_mulai <= ?
            AND periode_selesai >= ?`
      )
      .get(penjahitId, selesai, mulai);
    if (tumpang) {
      throw new Ragu(
        `Penjahit ${penjahit.nama} sudah memiliki payroll untuk periode yang tumpang tindih ` +
          `(${tumpang.periode_mulai} s.d. ${tumpang.periode_selesai}).`,
        409
      );
    }

    const prod = db
      .prepare(
        `SELECT COALESCE(SUM(bagus),0) AS total_pcs,
                COALESCE(SUM(subtotal),0) AS gaji_kotor
           FROM setoran
          WHERE penjahit_id = ? AND tanggal BETWEEN ? AND ?`
      )
      .get(penjahitId, mulai, selesai);

    const kasbon = db
      .prepare(
        `SELECT COALESCE(SUM(nominal),0) AS total, COUNT(*) AS jml
           FROM kasbon
          WHERE penjahit_id = ? AND status = 'Belum Lunas' AND tanggal <= ?`
      )
      .get(penjahitId, selesai);

    const gajiBersih = prod.gaji_kotor + bonusNilai - kasbon.total;
    if (gajiBersih < 0) {
      throw new Ragu(
        `Gaji bersih menjadi negatif (kotor ${prod.gaji_kotor} + bonus ${bonusNilai} ` +
          `- kasbon ${kasbon.total} = ${gajiBersih}). ` +
          `Proses dibatalkan, mohon sesuaikan bonus atau minta penjahit melunasi sebagian kasbon.`,
        422
      );
    }

    const sisip = db
      .prepare(
        `INSERT INTO payroll
           (penjahit_id, periode_mulai, periode_selesai, total_pcs, gaji_kotor,
            total_kasbon, bonus, status, dibayar_pada)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Diberikan', datetime('now','localtime'))`
      )
      .run(
        penjahitId,
        mulai,
        selesai,
        prod.total_pcs,
        prod.gaji_kotor,
        kasbon.total,
        bonusNilai
      );
    const payrollId = Number(sisip.lastInsertRowid);

    const ubah = db
      .prepare(
        `UPDATE kasbon
            SET status = 'Lunas', payroll_id = ?
          WHERE penjahit_id = ? AND status = 'Belum Lunas' AND tanggal <= ?`
      )
      .run(payrollId, penjahitId, selesai);

    if (Number(ubah.changes) !== kasbon.jml) {
      throw new Ragu(
        `Jumlah kasbon yang dilunasi (${ubah.changes}) berbeda dengan total kasbon tercatat ` +
          `(${kasbon.jml}). Transaksi dibatalkan.`,
        500
      );
    }

    const hasil = db
      .prepare(
        `SELECT id, penjahit_id, periode_mulai, periode_selesai, total_pcs, gaji_kotor,
                total_kasbon, bonus, gaji_bersih, status, dibayar_pada
           FROM payroll WHERE id = ?`
      )
      .get(payrollId);

    return { ...hasil, nama_penjahit: penjahit.nama, wa: penjahit.wa };
  });
}

function detailPayroll(db, payrollId) {
  const p = db
    .prepare(
      `SELECT p.*, j.nama AS nama_penjahit, j.kategori, j.wa
         FROM payroll p JOIN penjahit j ON j.id = p.penjahit_id
        WHERE p.id = ?`
    )
    .get(payrollId);
  if (!p) throw new Ragu('Payroll tidak ditemukan', 404);

  const rincian = db
    .prepare(
      `SELECT m.nama AS nama_model,
              s.tarif_diterapkan AS tarif,
              SUM(s.bagus) AS pcs,
              SUM(s.subtotal) AS subtotal
         FROM setoran s JOIN model m ON m.id = s.model_id
        WHERE s.penjahit_id = ? AND s.tanggal BETWEEN ? AND ?
        GROUP BY s.model_id, s.tarif_diterapkan
        HAVING SUM(s.bagus) > 0
        ORDER BY m.nama COLLATE NOCASE ASC`
    )
    .all(p.penjahit_id, p.periode_mulai, p.periode_selesai);

  const sisaKasbon = db
    .prepare(
      `SELECT COALESCE(SUM(nominal),0) AS total
         FROM kasbon WHERE penjahit_id = ? AND status = 'Belum Lunas'`
    )
    .get(p.penjahit_id).total;

  const kembalian = db
    .prepare(
      `SELECT COALESCE(SUM(s.uang_dibawa - s.subtotal), 0) AS total
         FROM setoran s
        WHERE s.penjahit_id = ? AND s.tanggal BETWEEN ? AND ?`
    )
    .get(p.penjahit_id, p.periode_mulai, p.periode_selesai).total;

  return { ...p, rincian, sisa_kasbon: sisaKasbon, kembalian_periode: kembalian };
}

function riwayatPayroll(db, { dari, sampai, penjahit_id } = {}) {
  const klausul = [];
  const argumen = [];
  if (dari) {
    klausul.push('p.periode_selesai >= ?');
    argumen.push(validasiTanggal(dari, 'Periode awal'));
  }
  if (sampai) {
    klausul.push('p.periode_mulai <= ?');
    argumen.push(validasiTanggal(sampai, 'Periode akhir'));
  }
  if (penjahit_id) {
    klausul.push('p.penjahit_id = ?');
    argumen.push(validasiBilanganBulat(penjahit_id, 'Penjahit'));
  }
  const where = klausul.length ? 'WHERE ' + klausul.join(' AND ') : '';
  return db
    .prepare(
      `SELECT p.id, p.penjahit_id, p.periode_mulai, p.periode_selesai, p.total_pcs,
              p.gaji_kotor, p.total_kasbon, p.bonus, p.gaji_bersih, p.status, p.dibayar_pada,
              j.nama AS nama_penjahit, j.kategori, j.wa
         FROM payroll p JOIN penjahit j ON j.id = p.penjahit_id
         ${where}
        ORDER BY p.periode_mulai DESC, p.periode_selesai DESC, j.nama COLLATE NOCASE ASC`
    )
    .all(...argumen);
}

module.exports = { prosesPayroll, detailPayroll, riwayatPayroll };
