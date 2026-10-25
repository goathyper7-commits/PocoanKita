'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Ragu } = require('./db');
const { tanganiApi, kirimJson } = require('./api');

const FOLDER_STATIS = path.join(__dirname, '..', 'public');
const LOG_API = process.env.LOG_API === '1';
const TIPE = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function pesanKesalahan(err) {
  if (err instanceof Ragu) return { kode: err.kode, pesan: err.message };
  const pesan = String(err && err.message ? err.message : err);
  if (pesan.includes('UNIQUE constraint failed')) {
    if (pesan.includes('wa')) return { kode: 409, pesan: 'Nomor WhatsApp sudah dipakai penjahit lain.' };
    if (pesan.includes('kode')) return { kode: 409, pesan: 'Kode model sudah dipakai. Gunakan kode lain.' };
    if (pesan.includes('penjahit_id, periode_mulai')) {
      return { kode: 409, pesan: 'Penjahit sudah memiliki payroll untuk periode tersebut.' };
    }
    return { kode: 409, pesan: 'Data ganda tidak diizinkan: ' + pesan };
  }
  if (pesan.includes('FOREIGN KEY constraint failed')) {
    return { kode: 409, pesan: 'Data yang dirujuk tidak ditemukan atau masih dipakai data lain.' };
  }
  if (pesan.includes('CHECK constraint failed')) {
    return { kode: 422, pesan: 'Nilai tidak memenuhi aturan basis data: ' + pesan };
  }
  return { kode: 500, pesan: 'Kesalahan server: ' + pesan };
}

function sajikanStatis(res, urlPath) {
  let relatif = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  const tujuan = path.resolve(FOLDER_STATIS, '.' + path.posix.normalize(relatif));
  if (!tujuan.startsWith(FOLDER_STATIS)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Terlarang');
    return;
  }
  fs.readFile(tujuan, (err, isi) => {
    if (err) {
      // fallback: aplikasi SPA — sajikan index untuk rute non-file
      fs.readFile(path.join(FOLDER_STATIS, 'index.html'), (err2, halaman) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Tidak ditemukan');
          return;
        }
        res.writeHead(200, { 'Content-Type': TIPE['.html'] });
        res.end(halaman);
      });
      return;
    }
    const ekstensi = path.extname(tujuan).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TIPE[ekstensi] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(isi);
  });
}

function buatServer(db) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (LOG_API) console.log(`> ${req.method} ${url.pathname}${url.search}`);
        const mulai = Date.now();
        res.on('finish', () => {
          if (LOG_API) console.log(`< ${res.statusCode} ${req.method} ${url.pathname} (${Date.now() - mulai}ms)`);
        });
        await tanganiApi(db, req, res, url);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new Ragu('Metode tidak diizinkan', 405);
      }
      sajikanStatis(res, url.pathname);
    } catch (err) {
      const { kode, pesan } = pesanKesalahan(err);
      if (!res.headersSent) {
        kirimJson(res, kode, { ok: false, pesan });
      } else {
        res.end();
      }
    }
  });
}

module.exports = { buatServer };
