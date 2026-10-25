'use strict';

const { bukaDatabase } = require('../src/db');

function dbUji() {
  return bukaDatabase(':memory:');
}

function tambahPenjahit(db, opsi = {}) {
  const res = db
    .prepare('INSERT INTO penjahit (nama, wa, kategori, aktif) VALUES (?, ?, ?, ?)')
    .run(
      opsi.nama || 'Penjahit Uji',
      opsi.wa || '628123456789',
      opsi.kategori || 'Senior',
      opsi.aktif === undefined ? 1 : opsi.aktif
    );
  return Number(res.lastInsertRowid);
}

function tambahModel(db, opsi = {}) {
  const res = db
    .prepare('INSERT INTO model (kode, nama, deskripsi) VALUES (?, ?, ?)')
    .run(opsi.kode || 'KMEJA-01', opsi.nama || 'Kemeja Polos', opsi.deskripsi || null);
  return Number(res.lastInsertRowid);
}

function tambahTarif(db, modelId, kategori, nilai) {
  db.prepare('INSERT INTO tarif (model_id, kategori, tarif_pcs) VALUES (?, ?, ?)').run(
    modelId,
    kategori,
    nilai
  );
}

function tambahSetoran(db, opsi) {
  const tarif = opsi.tarif;
  const res = db
    .prepare(
      `INSERT INTO setoran (tanggal, penjahit_id, model_id, bagus, reject, tarif_diterapkan, catatan)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      opsi.tanggal,
      opsi.penjahitId,
      opsi.modelId,
      opsi.bagus,
      opsi.reject || 0,
      tarif,
      opsi.catatan || null
    );
  return Number(res.lastInsertRowid);
}

function tambahKasbon(db, opsi) {
  const res = db
    .prepare("INSERT INTO kasbon (tanggal, penjahit_id, nominal, status, keterangan) VALUES (?, ?, ?, 'Belum Lunas', ?)")
    .run(opsi.tanggal, opsi.penjahitId, opsi.nominal, opsi.keterangan || null);
  return Number(res.lastInsertRowid);
}

module.exports = { dbUji, tambahPenjahit, tambahModel, tambahTarif, tambahSetoran, tambahKasbon };
