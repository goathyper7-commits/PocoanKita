'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { terapkanMigrasi } = require('./migrasi');

const BERKAS_DB = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'pocoan.db');

function bukaDatabase(berkas = BERKAS_DB) {
  if (berkas !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(berkas)), { recursive: true });
  }
  const db = new DatabaseSync(berkas);
  db.exec('PRAGMA foreign_keys = ON');
  if (berkas !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  terapkanMigrasi(db);
  return db;
}

class Ragu extends Error {
  constructor(pesan, kode = 400) {
    super(pesan);
    this.name = 'Ragu';
    this.kode = kode;
  }
}

function transaksi(db, jalankan) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const hasil = jalankan();
    db.exec('COMMIT');
    return hasil;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* transaksi sudah gagal sendiri */
    }
    throw err;
  }
}

function validasiTanggal(nilai, nama) {
  const teks = String(nilai || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teks)) {
    throw new Ragu(`${nama} harus berformat YYYY-MM-DD, diterima: "${teks}"`);
  }
  const [t, b, h] = teks.split('-').map(Number);
  const d = new Date(Date.UTC(t, b - 1, h));
  if (d.getUTCFullYear() !== t || d.getUTCMonth() !== b - 1 || d.getUTCDate() !== h) {
    throw new Ragu(`${nama} bukan tanggal valid: "${teks}"`);
  }
  return teks;
}

function validasiBilanganBulat(nilai, nama, { minimal = 0, wajib = true } = {}) {
  if (nilai === undefined || nilai === null || nilai === '') {
    if (wajib) throw new Ragu(`${nama} wajib diisi`);
    return 0;
  }
  const n = Number(nilai);
  if (!Number.isInteger(n)) throw new Ragu(`${nama} harus berupa bilangan bulat, diterima: "${nilai}"`);
  if (n < minimal) throw new Ragu(`${nama} tidak boleh kurang dari ${minimal}`);
  return n;
}

module.exports = { bukaDatabase, Ragu, transaksi, validasiTanggal, validasiBilanganBulat, BERKAS_DB };
