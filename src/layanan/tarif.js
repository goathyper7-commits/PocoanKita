'use strict';

const { Ragu, transaksi } = require('../db');

const KATEGORI = ['Senior', 'Junior', 'Magang'];

function cariTarif(db, modelId, kategori) {
  const baris = db
    .prepare('SELECT tarif_pcs FROM tarif WHERE model_id = ? AND kategori = ?')
    .get(modelId, kategori);
  return baris ? baris.tarif_pcs : null;
}

function wajibAdaTarif(db, modelId, kategori) {
  const tarif = cariTarif(db, modelId, kategori);
  if (tarif === null) {
    const model = db.prepare('SELECT kode, nama FROM model WHERE id = ?').get(modelId);
    const namaModel = model ? `${model.kode} - ${model.nama}` : `id ${modelId}`;
    throw new Ragu(
      `Tarif belum diatur untuk model ${namaModel} kategori ${kategori}. ` +
        `Atur dulu di menu Model & Tarif sebelum input setoran.`,
      422
    );
  }
  return tarif;
}

function daftarTarif(db) {
  const hasil = {};
  for (const baris of db.prepare('SELECT model_id, kategori, tarif_pcs FROM tarif').all()) {
    hasil[baris.model_id] = hasil[baris.model_id] || {};
    hasil[baris.model_id][baris.kategori] = baris.tarif_pcs;
  }
  return hasil;
}

function simpanTarif(db, modelId, isi) {
  const model = db.prepare('SELECT id FROM model WHERE id = ?').get(modelId);
  if (!model) throw new Ragu('Model tidak ditemukan', 404);

  return transaksi(db, () => {
    for (const kategori of KATEGORI) {
      const nilai = isi ? isi[kategori] : undefined;
      if (nilai === undefined || nilai === null || nilai === '') continue;
      const n = Number(nilai);
      if (!Number.isInteger(n)) throw new Ragu(`Tarif ${kategori} harus bilangan bulat`);
      if (n < 0) throw new Ragu(`Tarif ${kategori} tidak boleh negatif`);
      db.prepare(
        `INSERT INTO tarif (model_id, kategori, tarif_pcs) VALUES (?, ?, ?)
         ON CONFLICT(model_id, kategori) DO UPDATE SET tarif_pcs = excluded.tarif_pcs`
      ).run(modelId, kategori, n);
    }
    return daftarTarif(db)[modelId] || {};
  });
}

module.exports = { KATEGORI, cariTarif, wajibAdaTarif, daftarTarif, simpanTarif };
