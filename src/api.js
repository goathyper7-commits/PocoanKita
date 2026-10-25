'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Ragu, transaksi, validasiTanggal, validasiBilanganBulat } = require('./db');
const {
  KATEGORI,
  wajibAdaTarif,
  daftarTarif,
  simpanTarif
} = require('./layanan/tarif');
const { rekapMingguan } = require('./layanan/rekap');
const { prosesPayroll, detailPayroll, riwayatPayroll } = require('./layanan/payroll');
const wa = require('./layanan/wa');
const { buatCadangan } = require('./layanan/cadangan');

async function bacaJson(req) {
  const potongan = [];
  let ukuran = 0;
  for await (const chunk of req) {
    ukuran += chunk.length;
    if (ukuran > 1_000_000) throw new Ragu('Data terlalu besar', 413);
    potongan.push(chunk);
  }
  if (potongan.length === 0) return {};
  try {
    const objek = JSON.parse(Buffer.concat(potongan).toString('utf8'));
    if (process.env.LOG_API === '1') console.log(`  body: ${JSON.stringify(objek)}`);
    return objek;
  } catch {
    throw new Ragu('Isi permintaan bukan JSON yang valid');
  }
}

function kirimJson(res, kode, objek) {
  const badan = JSON.stringify(objek);
  res.writeHead(kode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(badan);
}

function wajibAda(objek, daftar, nama) {
  for (const kunci of daftar) {
    const nilai = objek[kunci];
    if (nilai === undefined || nilai === null || String(nilai).trim() === '') {
      throw new Ragu(`${nama}: kolom ${kunci} wajib diisi`);
    }
  }
}

function penjahitAktif(db, id) {
  const p = db.prepare('SELECT * FROM penjahit WHERE id = ?').get(id);
  if (!p) throw new Ragu('Penjahit tidak ditemukan', 404);
  return p;
}

function setoranTerkunci(db, penjahitId, tanggal) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 AS ada FROM payroll
          WHERE penjahit_id = ? AND status = 'Diberikan'
            AND periode_mulai <= ? AND periode_selesai >= ?`
      )
      .get(penjahitId, tanggal, tanggal)
  );
}

// kembalian = uang dibawa − subtotal upah (dihitung basis data dari kolom generated)
const PILIH_SETORAN = `
  SELECT s.*, (s.uang_dibawa - s.subtotal) AS kembalian,
         j.nama AS nama_penjahit, j.kategori, m.kode AS kode_model, m.nama AS nama_model
    FROM setoran s
    JOIN penjahit j ON j.id = s.penjahit_id
    JOIN model m ON m.id = s.model_id`;

function bacaSetoran(db, isi) {
  const tanggal = validasiTanggal(isi.tanggal, 'Tanggal setoran');
  const penjahitId = validasiBilanganBulat(isi.penjahit_id, 'Penjahit');
  const modelId = validasiBilanganBulat(isi.model_id, 'Model');
  const bagus = validasiBilanganBulat(isi.bagus, 'Jumlah bagus', { minimal: 0 });
  const reject = validasiBilanganBulat(isi.reject, 'Jumlah reject', { minimal: 0, wajib: false });
  const uangDibawa = validasiBilanganBulat(isi.uang_dibawa, 'Uang dibawa', { minimal: 0, wajib: false });
  const catatan = isi.catatan ? String(isi.catatan).slice(0, 500) : null;

  const penjahit = penjahitAktif(db, penjahitId);
  const model = db.prepare('SELECT id, kode, nama FROM model WHERE id = ?').get(modelId);
  if (!model) throw new Ragu('Model tidak ditemukan', 404);

  const tarif = wajibAdaTarif(db, modelId, penjahit.kategori);
  return { tanggal, penjahitId, modelId, bagus, reject, uangDibawa, catatan, tarif };
}

async function tanganiApi(db, req, res, url) {
  const metode = req.method.toUpperCase();
  const bagian = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const segmen = bagian.slice(1);
  const kunci = segmen[0] || '';
  const id = segmen[1] ? Number(segmen[1]) : null;
  const q = url.searchParams;

  if (kunci === 'health') {
    return kirimJson(res, 200, { ok: true, versi: db.prepare('PRAGMA user_version').get().user_version });
  }

  if (kunci === 'penjahit') {
    if (metode === 'GET') {
      const hanyaAktif = q.get('aktif') === '1';
      const sql = hanyaAktif
        ? 'SELECT * FROM penjahit WHERE aktif = 1 ORDER BY nama COLLATE NOCASE ASC'
        : 'SELECT * FROM penjahit ORDER BY aktif DESC, nama COLLATE NOCASE ASC';
      return kirimJson(res, 200, { ok: true, data: db.prepare(sql).all() });
    }
    if (metode === 'POST') {
      const isi = await bacaJson(req);
      wajibAda(isi, ['nama', 'wa'], 'Penjahit');
      const nomor = wa.validasiWa(isi.wa);
      const kategori = isi.kategori && isi.kategori !== '' ? isi.kategori : 'Senior';
      if (!KATEGORI.includes(kategori)) throw new Ragu(`Kategori tidak dikenal: ${kategori}`);
      const hasil = db
        .prepare(
          `INSERT INTO penjahit (nama, wa, kategori, aktif) VALUES (?, ?, ?, ?)`
        )
        .run(
          String(isi.nama).trim(),
          nomor,
          kategori,
          isi.aktif === undefined || isi.aktif === null ? 1 : Number(isi.aktif) ? 1 : 0
        );
      return kirimJson(res, 201, {
        ok: true,
        data: db.prepare('SELECT * FROM penjahit WHERE id = ?').get(Number(hasil.lastInsertRowid))
      });
    }
    if (metode === 'PUT' && id) {
      const isi = await bacaJson(req);
      const lama = penjahitAktif(db, id);
      wajibAda(isi, ['nama', 'wa'], 'Penjahit');
      const nomor = wa.validasiWa(isi.wa);
      const kategori = isi.kategori || lama.kategori;
      if (!KATEGORI.includes(kategori)) throw new Ragu(`Kategori tidak dikenal: ${kategori}`);
      db.prepare(
        'UPDATE penjahit SET nama = ?, wa = ?, kategori = ?, aktif = ? WHERE id = ?'
      ).run(
        String(isi.nama).trim(),
        nomor,
        kategori,
        isi.aktif === undefined ? lama.aktif : Number(isi.aktif) ? 1 : 0,
        id
      );
      return kirimJson(res, 200, {
        ok: true,
        data: db.prepare('SELECT * FROM penjahit WHERE id = ?').get(id)
      });
    }
  }

  if (kunci === 'model') {
    if (metode === 'GET') {
      const models = db.prepare('SELECT * FROM model ORDER BY kode COLLATE NOCASE ASC').all();
      const tarif = daftarTarif(db);
      return kirimJson(res, 200, {
        ok: true,
        data: models.map((m) => ({ ...m, tarif: tarif[m.id] || {} }))
      });
    }
    if (metode === 'POST') {
      const isi = await bacaJson(req);
      wajibAda(isi, ['kode', 'nama'], 'Model');
      const hasil = db
        .prepare('INSERT INTO model (kode, nama, deskripsi) VALUES (?, ?, ?)')
        .run(
          String(isi.kode).trim().toUpperCase(),
          String(isi.nama).trim(),
          isi.deskripsi ? String(isi.deskripsi).trim() : null
        );
      const idBaru = Number(hasil.lastInsertRowid);
      if (isi.tarif) await simpanTarif(db, idBaru, isi.tarif);
      return kirimJson(res, 201, {
        ok: true,
        data: db.prepare('SELECT * FROM model WHERE id = ?').get(idBaru)
      });
    }
    if (metode === 'PUT' && id) {
      const isi = await bacaJson(req);
      const lama = db.prepare('SELECT * FROM model WHERE id = ?').get(id);
      if (!lama) throw new Ragu('Model tidak ditemukan', 404);
      wajibAda(isi, ['kode', 'nama'], 'Model');
      db.prepare('UPDATE model SET kode = ?, nama = ?, deskripsi = ? WHERE id = ?').run(
        String(isi.kode).trim().toUpperCase(),
        String(isi.nama).trim(),
        isi.deskripsi ? String(isi.deskripsi).trim() : null,
        id
      );
      if (isi.tarif) await simpanTarif(db, id, isi.tarif);
      const model = db.prepare('SELECT * FROM model WHERE id = ?').get(id);
      return kirimJson(res, 200, {
        ok: true,
        data: { ...model, tarif: daftarTarif(db)[id] || {} }
      });
    }
  }

  if (kunci === 'tarif' && metode === 'PUT') {
    const isi = await bacaJson(req);
    wajibAda(isi, ['model_id'], 'Tarif');
    const hasil = simpanTarif(db, Number(isi.model_id), isi.tarif || isi);
    return kirimJson(res, 200, { ok: true, data: hasil });
  }

  if (kunci === 'setoran') {
    if (metode === 'GET') {
      const klausul = [];
      const argumen = [];
      if (q.get('dari')) {
        klausul.push('s.tanggal >= ?');
        argumen.push(validasiTanggal(q.get('dari'), 'Tanggal awal'));
      }
      if (q.get('sampai')) {
        klausul.push('s.tanggal <= ?');
        argumen.push(validasiTanggal(q.get('sampai'), 'Tanggal akhir'));
      }
      if (q.get('penjahit_id')) {
        klausul.push('s.penjahit_id = ?');
        argumen.push(validasiBilanganBulat(q.get('penjahit_id'), 'Penjahit'));
      }
      const where = klausul.length ? 'WHERE ' + klausul.join(' AND ') : '';
      const data = db
        .prepare(
          `${PILIH_SETORAN}
             ${where}
            ORDER BY s.tanggal DESC, s.id DESC
            LIMIT 500`
        )
        .all(...argumen);
      return kirimJson(res, 200, { ok: true, data });
    }
    if (metode === 'POST') {
      const isi = await bacaJson(req);
      const s = bacaSetoran(db, isi);
      const hasil = db
        .prepare(
          `INSERT INTO setoran (tanggal, penjahit_id, model_id, bagus, reject, uang_dibawa, tarif_diterapkan, catatan)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(s.tanggal, s.penjahitId, s.modelId, s.bagus, s.reject, s.uangDibawa, s.tarif, s.catatan);
      return kirimJson(res, 201, {
        ok: true,
        data: db.prepare(`${PILIH_SETORAN} WHERE s.id = ?`).get(Number(hasil.lastInsertRowid))
      });
    }
    if (metode === 'DELETE' && id) {
      // Hapus selalu diizinkan, termasuk setoran pada periode payroll yang sudah
      // dikunci: total payroll tersimpan sebagai salinan, jadi tidak berubah.
      const lama = db.prepare('SELECT * FROM setoran WHERE id = ?').get(id);
      if (!lama) throw new Ragu('Setoran tidak ditemukan', 404);
      db.prepare('DELETE FROM setoran WHERE id = ?').run(id);
      return kirimJson(res, 200, { ok: true, data: { id } });
    }
    if (metode === 'PUT' && id) {
      const lama = db.prepare('SELECT * FROM setoran WHERE id = ?').get(id);
      if (!lama) throw new Ragu('Setoran tidak ditemukan', 404);
      if (setoranTerkunci(db, lama.penjahit_id, lama.tanggal)) {
        throw new Ragu(
          `Setoran tanggal ${lama.tanggal} tidak bisa diubah karena sudah masuk payroll yang dikunci. ` +
            'Anda tetap bisa menghapusnya bila memang perlu.',
          409
        );
      }
      const isi = await bacaJson(req);
      const s = bacaSetoran(db, {
        tanggal: isi.tanggal ?? lama.tanggal,
        penjahit_id: isi.penjahit_id ?? lama.penjahit_id,
        model_id: isi.model_id ?? lama.model_id,
        bagus: isi.bagus ?? lama.bagus,
        reject: isi.reject ?? lama.reject,
        uang_dibawa: isi.uang_dibawa ?? lama.uang_dibawa,
        catatan: isi.catatan ?? lama.catatan
      });
      if (setoranTerkunci(db, s.penjahitId, s.tanggal)) {
        throw new Ragu(
          `Setoran tanggal ${s.tanggal} tidak bisa dipindah ke periode yang sudah dikunci.`,
          409
        );
      }
      db.prepare(
        `UPDATE setoran SET tanggal = ?, penjahit_id = ?, model_id = ?, bagus = ?, reject = ?,
                            uang_dibawa = ?, tarif_diterapkan = ?, catatan = ?
          WHERE id = ?`
      ).run(
        s.tanggal,
        s.penjahitId,
        s.modelId,
        s.bagus,
        s.reject,
        s.uangDibawa,
        s.tarif,
        s.catatan,
        id
      );
      return kirimJson(res, 200, {
        ok: true,
        data: db.prepare(`${PILIH_SETORAN} WHERE s.id = ?`).get(id)
      });
    }
  }

  if (kunci === 'kasbon') {
    if (metode === 'GET') {
      const klausul = [];
      const argumen = [];
      if (q.get('penjahit_id')) {
        klausul.push('k.penjahit_id = ?');
        argumen.push(validasiBilanganBulat(q.get('penjahit_id'), 'Penjahit'));
      }
      if (q.get('dari')) {
        klausul.push('k.tanggal >= ?');
        argumen.push(validasiTanggal(q.get('dari'), 'Tanggal awal'));
      }
      if (q.get('sampai')) {
        klausul.push('k.tanggal <= ?');
        argumen.push(validasiTanggal(q.get('sampai'), 'Tanggal akhir'));
      }
      if (q.get('status')) {
        klausul.push('k.status = ?');
        argumen.push(String(q.get('status')));
      }
      const where = klausul.length ? 'WHERE ' + klausul.join(' AND ') : '';
      const data = db
        .prepare(
          `SELECT k.*, j.nama AS nama_penjahit, j.kategori
             FROM kasbon k JOIN penjahit j ON j.id = k.penjahit_id
             ${where}
            ORDER BY k.tanggal DESC, k.id DESC
            LIMIT 500`
        )
        .all(...argumen);
      return kirimJson(res, 200, { ok: true, data });
    }
    if (metode === 'POST') {
      const isi = await bacaJson(req);
      wajibAda(isi, ['penjahit_id', 'nominal'], 'Kasbon');
      const tanggal = validasiTanggal(isi.tanggal || String(new Date().toISOString()).slice(0, 10), 'Tanggal kasbon');
      const penjahitId = validasiBilanganBulat(isi.penjahit_id, 'Penjahit');
      const nominal = validasiBilanganBulat(isi.nominal, 'Nominal kasbon', { minimal: 1 });
      penjahitAktif(db, penjahitId);
      const hasil = db
        .prepare(
          `INSERT INTO kasbon (tanggal, penjahit_id, nominal, keterangan) VALUES (?, ?, ?, ?)`
        )
        .run(tanggal, penjahitId, nominal, isi.keterangan ? String(isi.keterangan).slice(0, 500) : null);
      return kirimJson(res, 201, {
        ok: true,
        data: db.prepare('SELECT * FROM kasbon WHERE id = ?').get(Number(hasil.lastInsertRowid))
      });
    }
    if ((metode === 'PUT' || metode === 'DELETE') && id) {
      const lama = db.prepare('SELECT * FROM kasbon WHERE id = ?').get(id);
      if (!lama) throw new Ragu('Kasbon tidak ditemukan', 404);
      if (lama.status === 'Lunas') {
        throw new Ragu(
          'Kasbon yang sudah lunas tidak bisa diubah atau dihapus. Pelunasan hanya terjadi lewat proses payroll.',
          409
        );
      }
      if (metode === 'DELETE') {
        db.prepare('DELETE FROM kasbon WHERE id = ?').run(id);
        return kirimJson(res, 200, { ok: true, data: { id } });
      }
      const isi = await bacaJson(req);
      if (isi.status !== undefined && isi.status !== 'Belum Lunas') {
        throw new Ragu('Status kasbon hanya bisa berubah menjadi lunas melalui proses payroll', 409);
      }
      const tanggal = validasiTanggal(isi.tanggal ?? lama.tanggal, 'Tanggal kasbon');
      const nominal = validasiBilanganBulat(isi.nominal ?? lama.nominal, 'Nominal kasbon', { minimal: 1 });
      db.prepare('UPDATE kasbon SET tanggal = ?, nominal = ?, keterangan = ? WHERE id = ?').run(
        tanggal,
        nominal,
        isi.keterangan === undefined
          ? lama.keterangan
          : isi.keterangan
            ? String(isi.keterangan).slice(0, 500)
            : null,
        id
      );
      return kirimJson(res, 200, {
        ok: true,
        data: db.prepare('SELECT * FROM kasbon WHERE id = ?').get(id)
      });
    }
  }

  if (kunci === 'rekap' && metode === 'GET') {
    const data = rekapMingguan(db, q.get('dari'), q.get('sampai'));
    return kirimJson(res, 200, { ok: true, data });
  }

  if (kunci === 'payroll') {
    if (metode === 'POST' && !id) {
      const isi = await bacaJson(req);
      const hasil = prosesPayroll(db, isi);
      return kirimJson(res, 201, { ok: true, data: hasil });
    }
    if (metode === 'GET' && id && segmen[2] === 'slip') {
      const detail = detailPayroll(db, id);
      const teks = wa.buatSlip({
        nama: detail.nama_penjahit,
        kategori: detail.kategori,
        periode_mulai: detail.periode_mulai,
        periode_selesai: detail.periode_selesai,
        rincian: detail.rincian,
        total_pcs: detail.total_pcs,
        gaji_kotor: detail.gaji_kotor,
        bonus: detail.bonus,
        total_kasbon: detail.total_kasbon,
        gaji_bersih: detail.gaji_bersih,
        sisa_kasbon: detail.sisa_kasbon,
        kembalian: detail.kembalian_periode
      });
      const tautan = wa.buatTautanWa(detail.wa, teks);
      return kirimJson(res, 200, {
        ok: true,
        data: { id: detail.id, wa: detail.wa, teks, tautan }
      });
    }
    if (metode === 'GET' && id) {
      const detail = detailPayroll(db, id);
      return kirimJson(res, 200, { ok: true, data: detail });
    }
    if (metode === 'GET') {
      return kirimJson(res, 200, {
        ok: true,
        data: riwayatPayroll(db, {
          dari: q.get('dari'),
          sampai: q.get('sampai'),
          penjahit_id: q.get('penjahit_id')
        })
      });
    }
  }

  if (kunci === 'cadangan' && metode === 'GET') {
    const berkas = buatCadangan(db);
    const ukuran = fs.statSync(berkas).size;
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${path.basename(berkas)}"`,
      'Content-Length': ukuran
    });
    const stream = fs.createReadStream(berkas);
    stream.pipe(res);
    stream.on('close', () => {
      try {
        fs.rmSync(berkas, { force: true });
      } catch {
        /* abaikan */
      }
    });
    return undefined;
  }

  throw new Ragu(`Endpoint tidak ditemukan: ${metode} ${url.pathname}`, 404);
}

module.exports = { tanganiApi, kirimJson };
