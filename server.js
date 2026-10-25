'use strict';

const { bukaDatabase, BERKAS_DB } = require('./src/db');
const { buatServer } = require('./src/http');

const PORT = Number(process.env.PORT || 3000);

function jalankan(port = PORT, berkasDb = BERKAS_DB) {
  const db = bukaDatabase(berkasDb);
  const server = buatServer(db);
  server.listen(port, '127.0.0.1', () => {
    console.log(`Sistem Pocoan berjalan di http://127.0.0.1:${server.address().port}`);
    console.log(`Basis data: ${berkasDb}`);
  });
  const tutup = () => {
    server.close(() => {
      try {
        db.close();
      } catch {
        /* sudah tertutup */
      }
      process.exit(0);
    });
  };
  process.on('SIGINT', tutup);
  process.on('SIGTERM', tutup);
  return { db, server };
}

if (require.main === module) {
  jalankan();
}

module.exports = { jalankan };
