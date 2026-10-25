# Spesifikasi Sistem Manajemen Pocoan (Gaji Jahitan) & Penggajian Konveksi

Dokumen ini adalah spesifikasi kebutuhan dalam bentuk teks. Tidak ada kode di dalamnya. Seluruh implementasi (struktur tabel, query, logika aplikasi, antarmuka) dirancang dan ditulis oleh opencode berdasarkan deskripsi di bawah. Jika ada bagian yang ambigu, opencode diminta memilih solusi paling sederhana yang aman, lalu mencatat keputusannya.

---

## 1. Tujuan Sistem

Sistem ini dipakai oleh sebuah konveksi untuk:

1. Mencatat hasil jahitan harian setiap penjahit, dipisahkan antara unit yang lolos QC dan unit reject.
2. Menghitung upah berdasarkan sistem pocoan, yaitu upah per potong (pcs) yang tarifnya bergantung pada model yang dijahit dan kategori keahlian penjahit.
3. Mencatat kasbon (pinjaman) penjahit dan memotongnya saat gajian.
4. Memproses penggajian mingguan secara aman dan tidak bisa berubah setelah dikunci.
5. Mengirim slip gaji ke masing-masing penjahit lewat WhatsApp.

Pengguna sistem adalah Owner, Admin, Mandor QC, dan Kasir. Penjahit tidak login ke sistem; mereka hanya menerima slip lewat WhatsApp.

---

## 2. Gambaran Arsitektur

Sistem terdiri dari tiga lapisan.

**Lapisan antarmuka pengguna.** Berupa aplikasi web yang responsif (nyaman di HP maupun komputer). Isinya: dashboard untuk admin dan mandor, form input cepat untuk hasil produksi harian, serta panel payroll yang juga berfungsi sebagai pembuat slip WhatsApp. Teknologi antarmuka (misalnya WebAssembly atau web biasa) dibebaskan kepada opencode, asalkan tetap bisa dipakai nyaman di layar HP.

**Lapisan logika aplikasi.** Berisi empat komponen:

- Penentu tarif bertingkat: mencari tarif yang berlaku berdasarkan model dan kategori keahlian penjahit.
- Mesin aturan bisnis: menangani audit QC, potongan, dan bonus.
- Pengendali transaksi: memastikan proses payroll berjalan atomik (berhasil seluruhnya atau dibatalkan seluruhnya).
- Pembuat tautan WhatsApp: menyusun pesan slip dan mengubahnya menjadi tautan yang bisa dibuka di WhatsApp.

**Lapisan data.** Menggunakan SQLite 3 dengan pemeriksaan relasi antar tabel (foreign key) wajib diaktifkan setiap kali koneksi dibuka.

---

## 3. Data yang Dikelola

Ada enam entitas data. Berikut deskripsi tiap entitas beserta aturannya.

### 3.1 Penjahit (master operator)

Menyimpan data setiap penjahit.

- Identitas otomatis (nomor urut unik).
- Nama penjahit, wajib diisi.
- Nomor WhatsApp, wajib diisi dan tidak boleh sama dengan penjahit lain. Disimpan dalam format internasional tanpa spasi atau simbol, contohnya 628123456789.
- Kategori keahlian, pilihannya hanya Senior, Junior, atau Magang. Jika tidak diisi, otomatis Senior.
- Status aktif, hanya bernilai aktif atau tidak aktif. Bawaannya aktif. Penjahit yang tidak aktif tidak muncul di rekap, tetapi datanya tidak dihapus.
- Waktu pembuatan data, terisi otomatis.

### 3.2 Model Jahitan (master produk)

Menyimpan daftar model yang diproduksi.

- Identitas otomatis.
- Kode model, wajib dan unik. Contoh: KMEJA-01 untuk kemeja, GAMIS-02 untuk gamis.
- Nama model, wajib diisi.
- Deskripsi, opsional.
- Waktu pembuatan, terisi otomatis.

### 3.3 Tarif Pocoan Bertingkat

Menyimpan tarif upah per pcs untuk kombinasi model dan kategori keahlian.

- Identitas otomatis.
- Model yang dirujuk, wajib. Jika model dihapus, seluruh tarifnya ikut terhapus.
- Kategori keahlian (Senior, Junior, Magang).
- Tarif per pcs, wajib dan tidak boleh negatif.
- Setiap kombinasi model dan kategori hanya boleh punya satu tarif. Tidak boleh ada duplikat.

### 3.4 Setoran Harian (hasil produksi dan QC)

Mencatat hasil kerja setiap penjahit per hari per model.

- Identitas otomatis.
- Tanggal, bawaannya hari ini menurut waktu lokal.
- Penjahit dan model yang dirujuk, keduanya wajib.
- Jumlah bagus, yaitu unit yang lolos QC. Wajib, tidak boleh negatif.
- Jumlah reject, yaitu unit cacat. Bawaannya nol, tidak boleh negatif.
- Tarif yang diterapkan. Ini adalah salinan tarif yang berlaku pada saat setoran diinput dan dikunci di baris setoran itu. Tujuannya agar perubahan tarif di kemudian hari tidak mengubah upah yang sudah tercatat di masa lalu.
- Subtotal upah, dihitung otomatis oleh basis data sebagai jumlah bagus dikali tarif yang diterapkan. Pengguna tidak boleh mengisinya manual.
- Catatan, opsional.

Aturan penting: hanya unit yang lolos QC yang dibayar. Unit reject dicatat untuk keperluan pemantauan kualitas tetapi tidak menambah upah.

### 3.5 Kasbon (pinjaman dan potongan)

Mencatat setiap pengambilan kasbon oleh penjahit.

- Identitas otomatis.
- Tanggal, bawaannya hari ini.
- Penjahit yang meminjam, wajib.
- Nominal, wajib dan harus lebih dari nol.
- Status lunas, hanya belum lunas atau lunas. Bawaannya belum lunas.
- Referensi ke payroll yang melunasi kasbon ini. Kosong sampai kasbon dipotong pada suatu proses payroll.
- Keterangan, opsional.

### 3.6 Payroll Periode (rekap penggajian yang dikunci)

Satu baris mewakili gaji satu penjahit untuk satu periode.

- Identitas otomatis.
- Penjahit, periode awal, dan periode akhir, semuanya wajib.
- Total pcs, wajib.
- Gaji kotor, wajib.
- Total kasbon yang dipotong, bawaannya nol.
- Bonus lembur, bawaannya nol.
- Gaji bersih, dihitung otomatis oleh basis data: gaji kotor ditambah bonus lembur dikurangi total kasbon dipotong.
- Status bayar, hanya Draft atau Diberikan. Bawaannya Draft.
- Tanggal dibayar, terisi saat status menjadi Diberikan.

---

## 4. Fitur Rekap dan Pelaporan Mingguan

Sistem harus punya satu laporan rekap per periode (misalnya satu minggu) yang menampilkan satu baris untuk setiap penjahit aktif. Periode awal dan akhir dimasukkan oleh pengguna.

Kolom yang harus tampil di setiap baris:

- Identitas penjahit, nama, kategori keahlian, dan nomor WhatsApp.
- Total pcs bagus dalam periode.
- Total pcs reject dalam periode.
- Gaji kotor dalam periode, yaitu jumlah seluruh subtotal upah.
- Kasbon baru dalam periode, yaitu kasbon yang belum lunas dan tanggalnya jatuh dalam periode.
- Total sisa kasbon, yaitu seluruh kasbon belum lunas milik penjahit tersebut dari kapan pun.
- Estimasi gaji bersih, yaitu gaji kotor dikurangi kasbon baru dalam periode.

Aturan tampilan:

- Hanya penjahit berstatus aktif yang ditampilkan.
- Penjahit ditampilkan jika punya produksi dalam periode atau punya sisa kasbon belum lunas. Penjahit yang tidak punya keduanya disembunyikan.
- Urutan berdasarkan nama penjahit dari A ke Z.
- Penjahit yang tidak punya produksi tetapi punya kasbon tetap muncul dengan nilai produksi nol.

Aturan teknis yang wajib dijaga: tiga sumber angka (produksi, kasbon periode, sisa kasbon total) harus dihitung terpisah per penjahit terlebih dahulu, baru digabungkan. Jangan menggabungkan tabel setoran dan tabel kasbon secara langsung lalu menjumlahkan, karena hasilnya akan terhitung berlipat ganda (masalah perkalian baris). Opencode wajib menguji ini dengan data contoh yang punya banyak setoran dan banyak kasbon untuk satu penjahit.

---

## 5. Proses Eksekusi Payroll

Proses ini dijalankan Admin setiap Sabtu untuk setiap penjahit. Seluruh langkah harus berjalan dalam satu transaksi atomik: kalau salah satu langkah gagal, tidak ada perubahan apa pun yang tersimpan.

Langkah-langkahnya:

1. Buat satu record payroll berisi penjahit, periode awal dan akhir, total pcs, gaji kotor, total kasbon yang dipotong, bonus lembur, status Diberikan, dan waktu pembayaran saat itu.
2. Ambil identitas payroll yang baru dibuat.
3. Tandai kasbon penjahit tersebut yang masih belum lunas dan tanggalnya sampai dengan akhir periode sebagai lunas, lalu isi referensi payroll pada kasbon itu dengan identitas dari langkah 2.
4. Jika semua berhasil, simpan transaksi. Jika ada kegagalan, batalkan semuanya.

Aturan tambahan yang diminta:

- Setelah payroll berstatus Diberikan, record tersebut tidak boleh diubah atau dihapus oleh pengguna biasa.
- Satu penjahit tidak boleh diproses dua kali untuk periode yang sama atau periode yang saling tumpang tindih. Sistem harus menolak dan memberi pesan jelas.
- Nilai total pcs dan gaji kotor di payroll harus berasal dari perhitungan sistem berdasarkan setoran harian pada periode itu, bukan diketik manual.

---

## 6. Integrasi Slip Gaji WhatsApp

### 6.1 Isi dan susunan slip

Slip berupa teks biasa yang mudah dibaca di layar HP, dengan garis pemisah dari tanda sama dengan dan tanda strip. Susunannya dari atas ke bawah:

1. Judul tebal: SLIP GAJI POCOAN PRODUKSI.
2. Blok identitas: nama penjahit, kategori, dan periode (tanggal awal sampai tanggal akhir).
3. Judul bagian: RINCIAN HASIL KERJA (PASS QC), diikuti daftar rincian. Satu baris per model, memuat nama model, jumlah pcs, tarif per pcs, dan subtotalnya. Contoh bentuk satu baris: Kemeja Polos (120 pcs @ Rp 2.500) = Rp 300.000.
4. Blok ringkasan: total produksi dalam pcs, total upah kotor, bonus atau lembur, dan potongan kasbon (ditulis dengan tanda minus).
5. Baris tebal: TOTAL DITERIMA, berisi gaji bersih.
6. Baris tebal: sisa kasbon aktif milik penjahit setelah pemotongan.
7. Catatan penutup bercetak miring bahwa slip diterbitkan otomatis dan sebaiknya diperiksa kembali.

Format huruf tebal dan miring mengikuti sintaks WhatsApp (tanda bintang untuk tebal, garis bawah untuk miring).

### 6.2 Aturan pembuatan tautan

- Nomor WhatsApp dibersihkan dari semua karakter selain angka.
- Jika nomor diawali nol, nol itu diganti dengan kode negara 62 (Indonesia).
- Angka uang ditampilkan dalam format rupiah Indonesia, yaitu titik sebagai pemisah ribuan.
- Seluruh teks pesan di-encode agar aman dimasukkan ke dalam tautan, lalu dipasang pada alamat wa.me dengan nomor penjahit.
- Ketika tombol kirim ditekan, tautan dibuka dan WhatsApp menampilkan pesan yang sudah terisi, tinggal ditekan kirim oleh admin.
- Setiap penjahit mendapat tombol kirim sendiri. Sistem tidak mengirim otomatis tanpa aksi pengguna.

---

## 7. Prosedur Operasional (SOP)

| Tahapan | Penanggung jawab | Frekuensi | Tindakan sistem |
|---|---|---|---|
| Setup model dan tarif | Admin / Owner | Insidental | Menambah kode model baru dan menetapkan tarif untuk tiap kategori keahlian. |
| Pencatatan hasil produksi | Mandor QC | Harian, sore hari | Input jumlah bagus dan jumlah reject. Tarif otomatis dicari dan dikunci pada baris setoran saat input. |
| Pencatatan pinjaman | Kasir / Admin | Harian | Entri kasbon. Status otomatis belum lunas. |
| Review dan verifikasi | Owner / Admin | Mingguan, Sabtu | Menjalankan laporan rekap. Mencocokkan total unit setoran dengan stok hasil produksi fisik. |
| Penutupan payroll dan pengiriman | Admin | Mingguan, Sabtu | Menjalankan transaksi payroll, mengirim slip WhatsApp ke tiap penjahit, dan melunasi kasbon terkait. |

---

## 8. Kebutuhan Layar Antarmuka

Opencode merancang tata letak detailnya, tetapi minimal harus ada layar berikut:

1. **Master penjahit.** Daftar, tambah, ubah, nonaktifkan.
2. **Master model dan matriks tarif.** Menampilkan model dengan tiga kolom tarif (Senior, Junior, Magang) yang bisa diedit langsung.
3. **Input setoran harian.** Form cepat yang dioptimalkan untuk HP: pilih tanggal, penjahit, model, isi jumlah bagus dan reject. Tarif muncul otomatis sebagai informasi dan tidak bisa diketik.
4. **Input kasbon.** Form sederhana plus riwayat kasbon per penjahit.
5. **Rekap mingguan.** Menampilkan laporan pada bagian 4 dengan pemilih periode.
6. **Proses payroll.** Dari rekap, admin memeriksa angka, mengisi bonus bila ada, menekan proses, lalu muncul tombol kirim slip WhatsApp per penjahit.
7. **Riwayat payroll.** Daftar payroll yang sudah dikunci, bisa difilter per periode dan penjahit, dengan opsi mengirim ulang slip.

---

## 9. Aturan Bisnis Ringkas

1. Hanya pcs lolos QC yang dibayar. Reject hanya dicatat.
2. Tarif ditentukan oleh kombinasi model dan kategori keahlian penjahit, lalu dikunci di setiap baris setoran.
3. Perubahan tarif hanya berlaku untuk setoran baru, tidak pernah mengubah setoran lama.
4. Gaji bersih selalu dihitung sebagai gaji kotor ditambah bonus dikurangi potongan kasbon.
5. Kasbon hanya berubah menjadi lunas lewat proses payroll, dan harus tertaut ke payroll yang melunasinya.
6. Payroll yang sudah Diberikan bersifat final.
7. Penjahit yang tidak aktif disembunyikan, bukan dihapus.
8. Semua operasi yang mengubah beberapa tabel sekaligus harus atomik.

---

## 10. Hal yang Perlu Diputuskan atau Diwaspadai Opencode

Berikut celah yang ditemukan saat meninjau blueprint asli. Opencode diminta menanganinya dan mencatat solusi yang dipilih.

1. **Kasbon dipotong semua atau sebagian.** Blueprint asli melunasi seluruh kasbon belum lunas sampai akhir periode, padahal jumlah potongan yang dicatat di payroll bisa berbeda (misalnya dibatasi agar gaji tidak minus). Perlu dipastikan potongan yang tercatat selalu sama dengan total kasbon yang ditandai lunas. Jika ingin mendukung cicilan atau potongan sebagian, tabel kasbon perlu cara mencatat pelunasan parsial. Untuk versi pertama, pilihan paling sederhana adalah memotong seluruh kasbon dan menolak proses jika gaji bersih menjadi negatif, lalu meminta admin menyesuaikan.
2. **Gaji bersih negatif.** Tentukan perilaku bila potongan melebihi gaji kotor plus bonus. Disarankan ada peringatan sebelum proses dikunci.
3. **Tarif tidak ditemukan.** Jika saat input setoran belum ada tarif untuk kombinasi model dan kategori penjahit, sistem harus menolak input dan menjelaskan bahwa tarif belum diatur, bukan mengisi nol diam-diam.
4. **Definisi kolom gaji bersih.** Kolom hasil hitung otomatis pada payroll sebaiknya didefinisikan dengan tipe data eksplisit.
5. **Urutan referensi antar tabel.** Tabel kasbon merujuk ke payroll, sedangkan payroll didefinisikan setelahnya. SQLite mengizinkan ini, tetapi opencode sebaiknya menyusun urutan pembuatan tabel dengan rapi dan menyiapkan sistem migrasi versi.
6. **Pengambilan identitas payroll.** Pada blueprint asli, identitas payroll baru diambil dengan fungsi "baris terakhir yang disisipkan". Implementasi harus aman terhadap koneksi bersamaan dan sebaiknya menyimpan identitas itu ke variabel setelah langkah pertama.
7. **Periode tumpang tindih.** Cegah payroll ganda seperti dijelaskan di bagian 5.
8. **Zona waktu.** Tanggal bawaan memakai waktu lokal. Pastikan seluruh aplikasi konsisten, karena rekap mingguan sangat bergantung pada batas tanggal.
9. **Keamanan dan akses.** Blueprint belum membahas login dan peran. Disarankan ada login sederhana dengan pembagian peran: Mandor hanya input produksi, Kasir hanya kasbon, Admin dan Owner mengakses payroll.
10. **Cadangan data.** Karena data berupa satu berkas SQLite, sediakan fitur ekspor atau cadangan berkala.
11. **Pengujian.** Siapkan data contoh dan uji minimal: perhitungan rekap tanpa ganda, tarif terkunci setelah tarif diubah, transaksi payroll yang dibatalkan penuh saat gagal, normalisasi nomor WhatsApp berbagai format, dan format rupiah pada slip.

---

## 11. Kriteria Selesai

Sistem dianggap selesai jika:

- Seluruh enam entitas data tersedia dengan aturan seperti di bagian 3, dan pemeriksaan relasi aktif.
- Semua layar di bagian 8 berfungsi dan nyaman di HP.
- Laporan rekap menghasilkan angka yang benar pada data uji yang punya banyak setoran dan kasbon per penjahit.
- Payroll berjalan atomik, mencegah duplikasi, dan melunasi kasbon dengan referensi yang benar.
- Slip WhatsApp tampil sesuai susunan bagian 6 dan tautan terbuka dengan benar untuk nomor berformat 08..., 62..., maupun yang memakai spasi atau simbol.
- Poin-poin di bagian 10 sudah ditangani dan keputusannya didokumentasikan.
