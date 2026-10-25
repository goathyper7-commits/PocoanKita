# Keputusan Desain — Sistem Manajemen Pocoan & Penggajian

Dokumen ini mencatat keputusan opencode sesuai permintaan bagian 10 dan 11 dari
`spesifikasi_sistem_pocoan_payroll.md`.

## Lingkungan

- **Stack:** Node.js 24 (sudah terpasang), memakai modul bawaan `node:sqlite`
  (SQLite 3.51.2), `node:http`, `node:test`. Nol dependensi npm — `npm install`
  tidak diperlukan sama sekali.
- **Antarmuka:** web biasa (HTML/CSS/JS murni, tanpa framework), mobile-first,
  di-hash-routing. Bukan WebAssembly: kebutuhan layar lebih baik dicapai dengan
  HTML responsif biasa.
- **Jalankan:** `npm start` (port 3000, hanya `127.0.0.1`), uji: `npm test`.
- **Basis data:** `data/pocoan.db` dibuat otomatis; `PRAGMA foreign_keys = ON`
  dijalankan setiap kali koneksi dibuka (`src/db.js`).

## Keputusan bagian 10

1. **Kasbon dipotong semua atau sebagian.**
   Diputuskan: **dipotong seluruhnya**. Payroll mengambil semua kasbon berstatus
   *Belum Lunas* dengan `tanggal <= periode_selesai`, menandainya lunas, dan
   menautkannya ke payroll. Sistem **menolak proses** bila gaji bersih menjadi
   negatif, dengan pesan yang menyebut angka kotor, bonus, dan kasbon sehingga
   admin bisa menyesuaikan. Konsistensi dijaga: jumlah baris kasbon yang berubah
   diverifikasi sama dengan `total_kasbon` yang tersimpan; bila berbeda,
   transaksi dibatalkan. Cicilan/pelunasan parsial tidak didukung pada v1.

2. **Gaji bersih negatif.**
   Ditolak **sebelum** record payroll disisipkan (langkah 4 dalam
   `src/layanan/payroll.js`), sehingga tidak ada perubahan sama sekali. UI
   menampilkan ringkasan angka pada dialog konfirmasi sebelum proses dijalankan,
   sehingga admin melihat estimasi lebih dulu. Estimasi negatif di layar rekap
   juga terlihat sebelum tombol *Proses* ditekan.

3. **Tarif tidak ditemukan.**
   Server mengambil tarif berdasarkan model + kategori penjahit saat setoran
   disimpan (`wajibAdaTarif`). Jika tidak ada → respons **422** dengan pesan:
   "Tarif belum diatur untuk model X kategori Y…". Tidak pernah ada tarif nol
   diam-diam. Form input juga menampilkan peringatan merah secara langsung
   begitu kombinasi tanpa tarif dipilih.

4. **Definisi kolom gaji bersih.**
   `gaji_bersih INTEGER GENERATED ALWAYS AS (gaji_kotor + bonus - total_kasbon)
   VIRTUAL` — tipe eksplisit INTEGER, dihitung basis data, tidak bisa diisi
   manual. Kolom `subtotal` setoran juga generated:
   `INTEGER GENERATED ALWAYS AS (bagus * tarif_diterapkan) VIRTUAL`.
   Semua nilai uang memakai INTEGER rupiah (tanpa desimal) agar tidak ada galat
   floating point.

5. **Urutan referensi antar tabel.**
   Urutan pembuatan: `penjahit → model → tarif → setoran → payroll → kasbon`,
   sehingga rujukan `kasbon.payroll_id` tidak perlu dibuat sebelum tabel payroll
   ada. Migrasi memakai `PRAGMA user_version` (`src/migrasi.js`): versi baru
   cukup ditambahkan sebagai entri baru dalam `daftarMigrasi` dan dijalankan
   berurutan dalam satu transaksi. Skema saat ini berada di **versi 2**
   (versi 2 = penambahan kolom `uang_dibawa` pada tabel setoran);
   basis data lama otomatis dinaikkan saat aplikasi dibuka — lihat
   `tests/migrasi.test.js`.

6. **Pengambilan identitas payroll.**
   `info.lastInsertRowid` dibaca **segera setelah** langkah INSERT dan
   disimpan ke variabel lokal (`payrollId`), lalu dipakai oleh UPDATE kasbon di
   transaksi yang sama. Tidak ada pencarian "baris terakhir yang disisipkan".

7. **Periode tumpang tindih.**
   Ditolak lewat dua lapis: query overlap
   (`periode_mulai <= akhir AND periode_selesai >= awal`) memberi pesan jelas
   menyebut periode lama, dan `UNIQUE(penjahit_id, periode_mulai,
   periode_selesai)` menjadi jaring pengaman terakhir di tingkat basis data.
   Keduanya diuji di `tests/payroll.test.js`.

8. **Zona waktu.**
   Seluruh tanggal memakai waktu lokal: default tabel
   `date('now','localtime')` / `datetime('now','localtime')`, format disimpan
   `YYYY-MM-DD` (teks ISO, bisa dibandingkan secara leksikografis), dan validasi
   `validasiTanggal` menolak format lain. Batas periode selalu eksklisit
   (`BETWEEN ... AND ...` termasuk ujung), konsisten di rekap maupun payroll.

9. **Keamanan dan akses.**
   **Tanpa login pada v1** (dikonfirmasi pengguna): sistem dipakai satu
   komputer di lokasi konveksi. Server hanya mendengarkan `127.0.0.1`, sehingga
   tidak terbuka dari jaringan. Jika kelak perlu peran, tambahkan sesi login di
   lapisan `src/http.js` — struktur API per-endpoint sudah terpisah rapi.
   Pertahanan tingkat data tetap ada: trigger pengunci mencegah ubah/hapus
   payroll *Diberikan* meski ada bug di lapisan aplikasi.

10. **Cadangan data.**
    Tombol **Cadangan** di header menjalankan `VACUUM INTO` ke berkas `.db`
    segar di folder temp lalu mengunduhnya lewat browser (endpoint
    `GET /api/cadangan`). Berkas salinan dihapus setelah unduhan selesai; berkas
    asli tidak pernah disentuh. Pengguna cukup menyimpan hasil unduhan
    berkala.

11. **Pengujian.**
    24 uji lulus (`npm test`), mencakup semua yang diminta:
    - rekap tanpa ganda dengan 5 setoran + 4 kasbon untuk satu penjahit
      (`tests/rekap.test.js`) — nilai dibandingkan angka manual;
    - tarif terkunci setelah tarif diubah (`tests/tarif.test.js`);
    - transaksi payroll dibatalkan penuh saat gagal di tengah jalan, memakai
      pemicu sabotase (`tests/payroll.test.js`);
    - normalisasi nomor WA berbagai format dan tautan ter-encode
      (`tests/wa.test.js`);
    - format rupiah dan urutan bagian slip (`tests/wa.test.js`);
    - alur HTTP lengkap termasuk penjaga periode terkunci, payroll ganda,
      hapus setoran setelah payroll, dan pemblokiran path traversal
      (`tests/api.test.js`);
    - naik tingkat skema v1 → v2 beserta idempotensinya (`tests/migrasi.test.js`).

## Keputusan tambahan di luar bagian 10

- **Nomor WhatsApp** dinormalkan saat disimpan: buang semua non-digit, ganti
  awalan `0` menjadi `62`. Nomor yang tidak berawalan `0`/`62` setelah
  dinormalkan **ditolak** dengan pesan contoh format — keputusan ini memilih
  kepatuhan pada spesifikasi bagian 6.2 alih-alih menebak kode negara.
  Normalisasi dijalankan lagi saat membangun tautan (idempoten), sehingga
  `08…`, `62…`, `+62 812-3456`, dan `0812 3456 7890` semuanya aman.
- **Status `Draft`** tetap ada di skema (sesuai spesifikasi bagian 3.6), tetapi
  pada v1 payroll dibuat langsung `Diberikan` sesuai langkah bagian 5. Jalur
  draft dapat dihidupkan nanti tanpa migrasi.
- **Koreksi data** (diizinkan pengguna):
  - **Hapus setoran selalu diizinkan**, termasuk setoran yang sudah masuk
    payroll `Diberikan` (permintaan pengguna setelah rilis awal). Alasannya aman:
    total payroll tersimpan sebagai salinan (`total_pcs`, `gaji_kotor`) dan
    record `Diberikan` dikunci trigger, jadi penghapusan tidak mengubah gaji
    yang sudah dibayarkan — hanya rekap berikutnya yang mencerminkan data
    terbaru. Konfirmasi sebelum hapus mengingatkan efek ini.
  - **Ubah setoran tetap terkunci** begitu tanggalnya masuk payroll
    `Diberikan` (respons 409 dengan pesan yang menyarankan menghapus bila perlu).
  - Kasbon hanya bisa diubah selama masih *Belum Lunas*; status kasbon tidak
    pernah bisa diubah manual menjadi lunas.
  - Catatan: rincian per model pada slip diambil dari setoran yang masih ada.
    Bila setoran dihapus setelah payroll, angka ringkasan payroll tetap
    terkunci, sedangkan rincian model pada slip menyusut mengikuti data terbaru.
- **Fitur kembalian uang (permintaan pengguna, migrasi v2).**
  Form setoran mempunyai kolom opsional **Uang dibawa (Rp)** beserta kotak
  **Kembalian** yang dihitung langsung di layar:
  `kembalian = uang dibawa − subtotal upah`. Contoh sesuai permintaan pengguna:
  uang Rp 200.000, setoran (upah) Rp 175.000 → kembalian Rp 25.000.
  - Uang disimpan di kolom `uang_dibawa` (INTEGER, default 0, CHECK ≥ 0).
  - Kembalian **tidak disimpan** — selalu dihitung dari kolom generated
    `subtotal`, sehingga otomatis benar walau setoran diubah. API
    mengirimkannya sebagai `kembalian` dan daftar setoran menampilkan
    `Rp 200.000 → kembali Rp 25.000`.
  - Kembalian negatif (uang kurang) **tidak membatalkan** input setoran —
    hanya tampil merah sebagai peringatan bagi admin.
  - Uang dibawa tidak memengaruhi upah: yang dibayar tetap pcs lolos QC
    dikalikan tarif terkunci.
- **Saat setoran diubah**, tarif diambil ulang dari tarif yang berlaku saat itu
  (anggap sebagai input baru); setoran lama yang tidak disentuh tetap memakai
  tarif terkunci lamanya.
- **Slip WhatsApp** dibuka lewat `https://wa.me/<nomor>?text=<pesan>` — admin
  menekan kirim di WhatsApp. Tidak ada pengiriman otomatis, sesuai spesifikasi.
- **Backup file** dan **database WAL**: koneksi memakai `journal_mode = WAL`
  agar pembacaan rekap tidak menghalangi input setoran.
