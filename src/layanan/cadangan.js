'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { BERKAS_DB } = require('../db');

function buatCadangan(db, folderSementara = path.join(require('node:os').tmpdir(), 'pocoan-cadangan')) {
  fs.mkdirSync(folderSementara, { recursive: true });
  const nama = `pocoan-cadangan-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
  const tujuan = path.join(folderSementara, nama);
  if (fs.existsSync(tujuan)) fs.rmSync(tujuan);
  db.exec(`VACUUM INTO '${tujuan.replace(/'/g, "''")}'`);
  return tujuan;
}

module.exports = { buatCadangan, BERKAS_DB };
