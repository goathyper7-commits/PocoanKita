'use strict';

/* ---------------- utilitas ---------------- */

const $ = (sel, akar = document) => akar.querySelector(sel);
const $$ = (sel, akar = document) => Array.from(akar.querySelectorAll(sel));

function esc(nilai) {
  return String(nilai === null || nilai === undefined ? '' : nilai).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function rupiah(nilai) {
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.trunc(Number(nilai) || 0));
}

function iso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function hariIni() {
  return iso(new Date());
}

function mingguBerjalan() {
  const sekarang = new Date();
  const selisihSabtu = (6 - sekarang.getDay() + 7) % 7;
  const sabtu = new Date(sekarang);
  sabtu.setDate(sekarang.getDate() + selisihSabtu);
  const senin = new Date(sabtu);
  senin.setDate(sabtu.getDate() - 5);
  return [iso(senin), iso(sabtu)];
}

async function api(jalur, opsi = {}) {
  const opsiFetch = { method: opsi.method || 'GET' };
  if (opsi.body !== undefined) {
    opsiFetch.headers = { 'Content-Type': 'application/json' };
    opsiFetch.body = JSON.stringify(opsi.body);
  }
  const res = await fetch(jalur, opsiFetch);
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data.pesan || `Permintaan gagal (HTTP ${res.status})`);
  }
  return data.data;
}

let timerPesan = 0;
function beritahu(tipe, teks) {
  const kotak = $('#pesan');
  kotak.className = 'kotak-pesan ' + (tipe === 'ok' ? 'ok' : 'gagal');
  kotak.textContent = teks;
  kotak.hidden = false;
  clearTimeout(timerPesan);
  timerPesan = setTimeout(() => {
    kotak.hidden = true;
  }, 5000);
}

function tanganiError(err) {
  console.error(err);
  beritahu('gagal', err.message || String(err));
}

function kosong(kolom, teks = 'Tidak ada data') {
  return `<tr><td colspan="${kolom}" class="kosong">${esc(teks)}</td></tr>`;
}

const muatPenjahit = (aktifSaja = true) =>
  api('/api/penjahit' + (aktifSaja ? '?aktif=1' : ''));
const muatModel = () => api('/api/model');

function opsiPenjahit(daftar) {
  return daftar.map((p) => `<option value="${p.id}">${esc(p.nama)} (${esc(p.kategori)})</option>`).join('');
}

async function kirimSlip(payrollId) {
  const data = await api(`/api/payroll/${payrollId}/slip`);
  window.open(data.tautan, '_blank', 'noopener');
}

/* ---------------- halaman: rekap ---------------- */

async function halamanRekap() {
  const [dari, sampai] = mingguBerjalan();
  $('#halaman').innerHTML = `
    <div class="kartu">
      <div class="judul-halaman">
        <h2>Rekap Mingguan</h2>
        <p>Satu baris per penjahit aktif yang punya produksi atau sisa kasbon.</p>
      </div>
      <div class="baris-3" style="margin-top:.75rem">
        <div><label for="dari">Periode awal</label><input type="date" id="dari" value="${dari}"></div>
        <div><label for="sampai">Periode akhir</label><input type="date" id="sampai" value="${sampai}"></div>
        <div style="display:flex;align-items:flex-end"><button class="tombol" id="tampil" style="width:100%">Tampilkan Rekap</button></div>
      </div>
    </div>
    <div class="kartu">
      <div id="isiRekap" class="kosong">Memuat rekap…</div>
    </div>`;

  $('#tampil').addEventListener('click', () => muatRekap().catch(tanganiError));
  await muatRekap();
}

async function muatRekap() {
  const dari = $('#dari').value;
  const sampai = $('#sampai').value;
  if (!dari || !sampai) throw new Error('Periode awal dan akhir wajib diisi');

  const isi = $('#isiRekap');
  isi.className = '';
  isi.innerHTML = '<div class="kosong">Memuat…</div>';

  const [rekap, payroll] = await Promise.all([
    api(`/api/rekap?dari=${dari}&sampai=${sampai}`),
    api(`/api/payroll?dari=${dari}&sampai=${sampai}`)
  ]);

  const terkunci = new Map();
  for (const p of payroll) {
    if (p.periode_mulai === dari && p.periode_selesai === sampai) {
      terkunci.set(p.penjahit_id, p);
    }
  }

  if (rekap.baris.length === 0) {
    isi.className = 'kosong';
    isi.textContent = 'Tidak ada penjahit dengan produksi atau kasbon pada periode ini.';
    return;
  }

  const baris = rekap.baris
    .map((r) => {
      const kunci = terkunci.get(r.penjahit_id);
      const aksi = kunci
        ? `<span class="lencan lencan-hijau">Sudah diproses</span>
           <button class="tombol tombol-kecil tombol-wa" data-kirim="${kunci.id}">Kirim Slip WA</button>`
        : `<input type="number" min="0" step="1" value="0" data-bonus="${r.penjahit_id}" style="width:7.5rem;text-align:right" aria-label="Bonus lembur">
           <button class="tombol tombol-kecil" data-proses="${r.penjahit_id}">Proses</button>`;

      return `<tr>
        <td data-label="Penjahit"><strong>${esc(r.nama)}</strong><br><small>${esc(r.kategori)} · ${esc(waLokal(r.wa))}</small></td>
        <td data-label="PCS Bagus" class="angka">${r.total_bagus}</td>
        <td data-label="PCS Reject" class="angka">${r.total_reject}</td>
        <td data-label="Gaji Kotor" class="angka">${rupiah(r.gaji_kotor)}</td>
        <td data-label="Kasbon Baru" class="angka">${rupiah(r.kasbon_periode)}</td>
        <td data-label="Sisa Kasbon" class="angka">${rupiah(r.sisa_kasbon)}</td>
        <td data-label="Estimasi Bersih" class="angka"><strong>${rupiah(r.estimasi_bersih)}</strong></td>
        <td data-label="Bonus" class="angka">${aksi}</td>
      </tr>`;
    })
    .join('');

  isi.innerHTML = `
    <div class="bungkus-tabel">
      <table class="tabel-kartu">
        <thead>
          <tr>
            <th>Penjahit</th>
            <th class="angka">PCS Bagus</th>
            <th class="angka">PCS Reject</th>
            <th class="angka">Gaji Kotor</th>
            <th class="angka">Kasbon Baru</th>
            <th class="angka">Sisa Kasbon</th>
            <th class="angka">Estimasi Bersih</th>
            <th class="angka">Bonus / Aksi</th>
          </tr>
        </thead>
        <tbody>${baris}</tbody>
      </table>
    </div>
    <p style="font-size:.8rem;color:#64748b;margin:.75rem 0 0">
      Setelah payroll diproses, kasbon sampai dengan akhir periode otomatis dilunasi dan
      slip siap dikirim lewat WhatsApp. Gaji kotor dihitung dari setoran yang lolos QC.
    </p>`;

  $$('[data-proses]', isi).forEach((tombol) =>
    tombol.addEventListener('click', () => prosesBaris(Number(tombol.dataset.proses), dari, sampai))
  );
  $$('[data-kirim]', isi).forEach((tombol) =>
    tombol.addEventListener('click', () => kirimSlip(Number(tombol.dataset.kirim)).catch(tanganiError))
  );
}

async function prosesBaris(penjahitId, dari, sampai) {
  const input = $(`[data-bonus="${penjahitId}"]`);
  const bonus = Number(input ? input.value || 0 : 0);
  if (!Number.isInteger(bonus) || bonus < 0) {
    throw new Error('Bonus lembur harus bilangan bulat tidak negatif');
  }

  const baris = $$('#isiRekap tr').find((tr) => $(`[data-bonus="${penjahitId}"]`, tr));
  const nama = baris ? $('strong', baris).textContent : 'penjahit';

  const konfirmasi = window.confirm(
    `Proses payroll untuk ${nama}?\n` +
      `Periode: ${dari} s.d. ${sampai}\n` +
      `Bonus lembur: ${rupiah(bonus)}\n\n` +
      'Payroll yang sudah diproses tidak bisa diubah, dan kasbon sampai akhir periode akan dilunasi.'
  );
  if (!konfirmasi) return;

  try {
    const hasil = await api('/api/payroll', {
      method: 'POST',
      body: {
        penjahit_id: penjahitId,
        periode_mulai: dari,
        periode_selesai: sampai,
        bonus
      }
    });
    beritahu('ok', `Payroll ${nama} diproses. Total diterima ${rupiah(hasil.gaji_bersih)}.`);
    await muatRekap();
  } catch (err) {
    tanganiError(err);
  }
}

/* ---------------- halaman: setoran ---------------- */

async function halamanSetoran() {
  $('#halaman').innerHTML = `
    <div class="kartu">
      <div class="judul-halaman">
        <h2>Input Setoran Harian</h2>
        <p>Hanya pcs lolos QC yang dibayar. Tarif terkunci otomatis saat disimpan.</p>
      </div>
      <form id="formSetoran" class="baris-2" style="margin-top:.75rem">
        <div><label for="sTanggal">Tanggal</label><input type="date" id="sTanggal" required value="${hariIni()}"></div>
        <div><label for="sPenjahit">Penjahit</label><select id="sPenjahit" required></select></div>
        <div><label for="sModel">Model</label><select id="sModel" required></select></div>
        <div><label>Tarif berlaku</label><div class="info-tarif" id="sTarif">Pilih penjahit dan model</div></div>
        <div><label for="sBagus">Jumlah bagus (lolos QC)</label><input type="number" id="sBagus" min="0" step="1" required value="0"></div>
        <div><label for="sReject">Jumlah reject</label><input type="number" id="sReject" min="0" step="1" value="0"></div>
        <div><label for="sUang">Uang dibawa (Rp)</label><input type="number" id="sUang" min="0" step="1000" value="0" placeholder="200000"></div>
        <div><label>Kembalian (uang − subtotal upah)</label><div class="info-tarif" id="sKembalian">Isi uang dibawa untuk menghitung kembalian</div></div>
        <div style="grid-column:1/-1"><label for="sCatatan">Catatan (opsional)</label><input type="text" id="sCatatan" maxlength="500" placeholder="Mis. bahan kurang, dikerjakan lembur"></div>
        <div style="grid-column:1/-1"><button class="tombol" type="submit">Simpan Setoran</button></div>
      </form>
    </div>
    <div class="kartu">
      <h2>Setoran Terakhir</h2>
      <div id="isiSetoran"><div class="kosong">Memuat…</div></div>
    </div>`;

  const [penjahit, model] = await Promise.all([muatPenjahit(), muatModel()]);
  if (penjahit.length === 0) {
    beritahu('gagal', 'Belum ada penjahit. Tambah dulu di menu Penjahit.');
  }

  $('#sPenjahit').innerHTML = opsiPenjahit(penjahit);
  $('#sModel').innerHTML = model
    .map((m) => `<option value="${m.id}">${esc(m.kode)} — ${esc(m.nama)}</option>`)
    .join('');

  const tampilkanTarif = () => {
    const p = penjahit.find((x) => String(x.id) === $('#sPenjahit').value);
    const m = model.find((x) => String(x.id) === $('#sModel').value);
    const kotak = $('#sTarif');
    const nilai = p && m ? m.tarif[p.kategori] : undefined;
    if (nilai === undefined || nilai === null) {
      kotak.className = 'info-tarif bahaya';
      kotak.textContent = 'Tarif belum diatur — input akan ditolak';
    } else {
      kotak.className = 'info-tarif';
      kotak.textContent = `${rupiah(nilai)} / pcs (${p.kategori})`;
    }
  };

  const hitungKembalian = () => {
    const p = penjahit.find((x) => String(x.id) === $('#sPenjahit').value);
    const m = model.find((x) => String(x.id) === $('#sModel').value);
    const tarif = p && m ? m.tarif[p.kategori] : undefined;
    const kotak = $('#sKembalian');

    if (tarif === undefined || tarif === null) {
      kotak.className = 'info-tarif bahaya';
      kotak.textContent = 'Tarif belum diatur — input akan ditolak';
      return;
    }

    const bagus = Number($('#sBagus').value || 0);
    const subtotal = bagus * tarif;
    const uang = Number($('#sUang').value || 0);

    if (uang === 0) {
      kotak.className = 'info-tarif';
      kotak.textContent = `Subtotal upah ${rupiah(subtotal)} — isi uang dibawa untuk hitung kembalian`;
      return;
    }
    const kembalian = uang - subtotal;
    if (kembalian < 0) {
      kotak.className = 'info-tarif bahaya';
      kotak.textContent = `Uang kurang: ${rupiah(subtotal)} − ${rupiah(uang)} = ${rupiah(-kembalian)}`;
    } else {
      kotak.className = 'info-tarif';
      kotak.textContent = `${rupiah(uang)} − ${rupiah(subtotal)} = kembalian ${rupiah(kembalian)}`;
    }
  };

  $('#sPenjahit').addEventListener('change', () => {
    tampilkanTarif();
    hitungKembalian();
  });
  $('#sModel').addEventListener('change', () => {
    tampilkanTarif();
    hitungKembalian();
  });
  $('#sBagus').addEventListener('input', hitungKembalian);
  $('#sUang').addEventListener('input', hitungKembalian);
  tampilkanTarif();
  hitungKembalian();

  $('#formSetoran').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const uang = Number($('#sUang').value || 0);
      const data = await api('/api/setoran', {
        method: 'POST',
        body: {
          tanggal: $('#sTanggal').value,
          penjahit_id: Number($('#sPenjahit').value),
          model_id: Number($('#sModel').value),
          bagus: Number($('#sBagus').value),
          reject: Number($('#sReject').value),
          uang_dibawa: uang,
          catatan: $('#sCatatan').value
        }
      });
      const pesanKembalian =
        uang > 0
          ? data.kembalian >= 0
            ? ` Kembalian ${rupiah(data.kembalian)}.`
            : ` Uang kurang ${rupiah(-data.kembalian)}.`
          : '';
      beritahu('ok', `Setoran tersimpan. Subtotal ${rupiah(data.subtotal)}.${pesanKembalian}`);
      $('#sBagus').value = '0';
      $('#sReject').value = '0';
      $('#sUang').value = '0';
      $('#sCatatan').value = '';
      hitungKembalian();
      await muatSetoran();
    } catch (err) {
      tanganiError(err);
    }
  });

  await muatSetoran();
}

async function muatSetoran() {
  const isi = $('#isiSetoran');
  if (!isi) return;
  const daftar = await api('/api/setoran');
  if (daftar.length === 0) {
    isi.className = 'kosong';
    isi.textContent = 'Belum ada setoran.';
    return;
  }
  isi.className = '';
  isi.innerHTML = `
    <div class="bungkus-tabel">
      <table class="tabel-kartu">
        <thead>
          <tr><th>Tanggal</th><th>Penjahit</th><th>Model</th><th class="angka">Bagus</th>
              <th class="angka">Reject</th><th class="angka">Uang / Kembalian</th><th class="angka">Tarif</th>
              <th class="angka">Subtotal</th><th></th></tr>
        </thead>
        <tbody>
          ${daftar
            .map(
              (s) => `<tr>
                <td data-label="Tanggal">${esc(s.tanggal)}</td>
                <td data-label="Penjahit">${esc(s.nama_penjahit)} <small>(${esc(s.kategori)})</small></td>
                <td data-label="Model">${esc(s.nama_model)}</td>
                <td data-label="Bagus" class="angka">${s.bagus}</td>
                <td data-label="Reject" class="angka">${s.reject}</td>
                <td data-label="Uang / Kembalian" class="angka">${
                  s.uang_dibawa > 0
                    ? `${rupiah(s.uang_dibawa)} → ${
                        s.kembalian >= 0
                          ? `kembali <strong>${rupiah(s.kembalian)}</strong>`
                          : `kurang <strong>${rupiah(-s.kembalian)}</strong>`
                      }`
                    : '—'
                }</td>
                <td data-label="Tarif" class="angka">${rupiah(s.tarif_diterapkan)}</td>
                <td data-label="Subtotal" class="angka"><strong>${rupiah(s.subtotal)}</strong></td>
                <td class="aksi"><button class="tombol tombol-kecil tombol-bahaya" data-hapus="${s.id}">Hapus</button></td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;

  $$('[data-hapus]', isi).forEach((tombol) =>
    tombol.addEventListener('click', async () => {
      const baris = tombol.closest('tr');
      const keterangan = baris ? baris.children[0].textContent.trim() : '';
      if (!window.confirm(`Hapus setoran tanggal ${keterangan}?\n\nSetoran yang sudah dipayroll tetap bisa dihapus, tetapi angka payroll yang sudah terkunci tidak dihitung ulang.`)) return;
      try {
        await api(`/api/setoran/${tombol.dataset.hapus}`, { method: 'DELETE' });
        beritahu('ok', 'Setoran dihapus.');
        await muatSetoran();
      } catch (err) {
        tanganiError(err);
      }
    })
  );
}

/* ---------------- halaman: kasbon ---------------- */

async function halamanKasbon() {
  $('#halaman').innerHTML = `
    <div class="kartu">
      <div class="judul-halaman">
        <h2>Input Kasbon</h2>
        <p>Kasbon hanya bisa lunas lewat proses payroll.</p>
      </div>
      <form id="formKasbon" class="baris-4" style="margin-top:.75rem">
        <div><label for="kTanggal">Tanggal</label><input type="date" id="kTanggal" required value="${hariIni()}"></div>
        <div><label for="kPenjahit">Penjahit</label><select id="kPenjahit" required></select></div>
        <div><label for="kNominal">Nominal (Rp)</label><input type="number" id="kNominal" min="1" step="1" required placeholder="50000"></div>
        <div><label for="kKet">Keterangan</label><input type="text" id="kKet" maxlength="500" placeholder="Mis. DP seragam"></div>
        <div style="grid-column:1/-1"><button class="tombol" type="submit">Simpan Kasbon</button></div>
      </form>
    </div>
    <div class="kartu">
      <div class="judul-halaman">
        <h2>Riwayat Kasbon</h2>
        <div><label for="kFilter" style="margin:0">Filter penjahit</label>
        <select id="kFilter" style="width:auto;min-width:14rem"><option value="">Semua penjahit</option></select></div>
      </div>
      <div id="isiKasbon" style="margin-top:.75rem"><div class="kosong">Memuat…</div></div>
    </div>`;

  const penjahit = await muatPenjahit(false);
  $('#kPenjahit').innerHTML = opsiPenjahit(penjahit.filter((p) => p.aktif === 1));
  $('#kFilter').innerHTML =
    '<option value="">Semua penjahit</option>' +
    penjahit.map((p) => `<option value="${p.id}">${esc(p.nama)}${p.aktif ? '' : ' (nonaktif)'}</option>`).join('');

  $('#kFilter').addEventListener('change', () => muatKasbon().catch(tanganiError));

  $('#formKasbon').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const data = await api('/api/kasbon', {
        method: 'POST',
        body: {
          tanggal: $('#kTanggal').value,
          penjahit_id: Number($('#kPenjahit').value),
          nominal: Number($('#kNominal').value),
          keterangan: $('#kKet').value
        }
      });
      beritahu('ok', `Kasbon ${rupiah(data.nominal)} tercatat.`);
      $('#kNominal').value = '';
      $('#kKet').value = '';
      await muatKasbon();
    } catch (err) {
      tanganiError(err);
    }
  });

  await muatKasbon();
}

async function muatKasbon() {
  const isi = $('#isiKasbon');
  if (!isi) return;
  const filter = $('#kFilter');
  const qs = filter && filter.value ? `?penjahit_id=${filter.value}` : '';
  const daftar = await api('/api/kasbon' + qs);

  if (daftar.length === 0) {
    isi.className = 'kosong';
    isi.textContent = 'Belum ada kasbon.';
    return;
  }
  isi.className = '';
  isi.innerHTML = `
    <div class="bungkus-tabel">
      <table class="tabel-kartu">
        <thead>
          <tr><th>Tanggal</th><th>Penjahit</th><th class="angka">Nominal</th><th>Status</th>
              <th>Keterangan</th><th>Payroll</th><th></th></tr>
        </thead>
        <tbody>
          ${daftar
            .map(
              (k) => `<tr>
                <td data-label="Tanggal">${esc(k.tanggal)}</td>
                <td data-label="Penjahit">${esc(k.nama_penjahit)}</td>
                <td data-label="Nominal" class="angka"><strong>${rupiah(k.nominal)}</strong></td>
                <td data-label="Status"><span class="lencan ${k.status === 'Lunas' ? 'lencan-hijau' : 'lencan-kuning'}">${esc(k.status)}</span></td>
                <td data-label="Keterangan">${esc(k.keterangan || '—')}</td>
                <td data-label="Payroll">${k.payroll_id ? '#' + k.payroll_id : '—'}</td>
                <td class="aksi">${
                  k.status === 'Belum Lunas'
                    ? `<button class="tombol tombol-kecil tombol-bahaya" data-hapus="${k.id}">Hapus</button>`
                    : '<span class="lencan lencan-abu">terkunci</span>'
                }</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;

  $$('[data-hapus]', isi).forEach((tombol) =>
    tombol.addEventListener('click', async () => {
      if (!window.confirm('Hapus kasbon ini?')) return;
      try {
        await api(`/api/kasbon/${tombol.dataset.hapus}`, { method: 'DELETE' });
        beritahu('ok', 'Kasbon dihapus.');
        await muatKasbon();
      } catch (err) {
        tanganiError(err);
      }
    })
  );
}

/* ---------------- halaman: penjahit ---------------- */

async function halamanPenjahit() {
  $('#halaman').innerHTML = `
    <div class="kartu">
      <div class="judul-halaman">
        <h2 id="judulForm">Tambah Penjahit</h2>
        <button class="tombol tombol-kecil tombol-abu" id="batalUbah" hidden>Batal ubah</button>
      </div>
      <form id="formPenjahit" class="baris-4" style="margin-top:.75rem">
        <input type="hidden" id="pId">
        <div><label for="pNama">Nama penjahit</label><input type="text" id="pNama" required maxlength="100"></div>
        <div><label for="pWa">Nomor WhatsApp</label><input type="text" id="pWa" required placeholder="08123456789" inputmode="numeric"><small class="catatan-form" id="pWaPratinjau"></small></div>
        <div><label for="pKat">Kategori keahlian</label>
          <select id="pKat"><option>Senior</option><option>Junior</option><option>Magang</option></select></div>
        <div style="display:flex;align-items:flex-end;gap:.5rem">
          <button class="tombol" type="submit">Simpan</button>
        </div>
      </form>
    </div>
    <div class="kartu">
      <h2>Daftar Penjahit</h2>
      <div id="isiPenjahit"><div class="kosong">Memuat…</div></div>
    </div>`;

  $('#formPenjahit').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const id = $('#pId').value;
    const body = {
      nama: $('#pNama').value,
      wa: $('#pWa').value,
      kategori: $('#pKat').value
    };
    try {
      if (id) {
        await api(`/api/penjahit/${id}`, { method: 'PUT', body });
        beritahu('ok', 'Penjahit diperbarui.');
      } else {
        await api('/api/penjahit', { method: 'POST', body });
        beritahu('ok', 'Penjahit ditambahkan.');
      }
      resetFormPenjahit();
      await muatPenjahitTabel();
    } catch (err) {
      tanganiError(err);
    }
  });

  $('#batalUbah').addEventListener('click', resetFormPenjahit);
  $('#pWa').addEventListener('input', pratinjauWa);
  await muatPenjahitTabel();
}

function normalisasiWaLokal(nilai) {
  const bersih = String(nilai || '').replace(/\D+/g, '');
  return bersih.startsWith('0') ? '62' + bersih.slice(1) : bersih;
}

function waLokal(nilai) {
  const bersih = String(nilai || '').replace(/\D+/g, '');
  return bersih.startsWith('62') ? '0' + bersih.slice(2) : bersih;
}

function pratinjauWa() {
  const kotak = $('#pWaPratinjau');
  if (!kotak) return;
  const nomor = normalisasiWaLokal($('#pWa').value);
  kotak.textContent = nomor ? `Akan disimpan sebagai ${nomor}` : '';
}

function resetFormPenjahit() {
  $('#pId').value = '';
  $('#pNama').value = '';
  $('#pWa').value = '';
  $('#pKat').value = 'Senior';
  $('#judulForm').textContent = 'Tambah Penjahit';
  $('#batalUbah').hidden = true;
  $('#formPenjahit').closest('.kartu').classList.remove('kartu-mode-ubah');
  pratinjauWa();
}

async function muatPenjahitTabel() {
  const isi = $('#isiPenjahit');
  if (!isi) return;
  const daftar = await muatPenjahit(false);
  if (daftar.length === 0) {
    isi.className = 'kosong';
    isi.textContent = 'Belum ada penjahit.';
    return;
  }
  isi.className = '';
  isi.innerHTML = `
    <div class="bungkus-tabel">
      <table class="tabel-kartu">
        <thead><tr><th>Nama</th><th>WhatsApp</th><th>Kategori</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${daftar
            .map(
              (p) => `<tr>
                <td data-label="Nama"><strong>${esc(p.nama)}</strong></td>
                <td data-label="WhatsApp">${esc(waLokal(p.wa))}</td>
                <td data-label="Kategori">${esc(p.kategori)}</td>
                <td data-label="Status"><span class="lencan ${p.aktif ? 'lencan-hijau' : 'lencan-abu'}">${p.aktif ? 'Aktif' : 'Tidak aktif'}</span></td>
                <td class="aksi">
                  <button class="tombol tombol-kecil tombol-buka" data-ubah="${p.id}">Ubah</button>
                  <button class="tombol tombol-kecil tombol-abu" data-status="${p.id}" data-aktif="${p.aktif}">${p.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button>
                </td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;

  $$('[data-ubah]', isi).forEach((tombol) =>
    tombol.addEventListener('click', () => {
      const p = daftar.find((x) => String(x.id) === tombol.dataset.ubah);
      if (!p) return;
      $('#pId').value = p.id;
      $('#pNama').value = p.nama;
      $('#pWa').value = waLokal(p.wa);
      $('#pKat').value = p.kategori;
      $('#judulForm').textContent = 'Ubah Penjahit';
      $('#batalUbah').hidden = false;
      $('#formPenjahit').closest('.kartu').classList.add('kartu-mode-ubah');
      pratinjauWa();
      $('#pNama').focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    })
  );

  $$('[data-status]', isi).forEach((tombol) =>
    tombol.addEventListener('click', async () => {
      const p = daftar.find((x) => String(x.id) === tombol.dataset.status);
      if (!p) return;
      try {
        await api(`/api/penjahit/${p.id}`, {
          method: 'PUT',
          body: {
            nama: p.nama,
            wa: p.wa,
            kategori: p.kategori,
            aktif: p.aktif ? 0 : 1
          }
        });
        beritahu('ok', p.aktif ? `${p.nama} dinonaktifkan.` : `${p.nama} diaktifkan.`);
        await muatPenjahitTabel();
      } catch (err) {
        tanganiError(err);
      }
    })
  );
}

/* ---------------- halaman: model & tarif ---------------- */

async function halamanModel() {
  $('#halaman').innerHTML = `
    <div class="kartu">
      <div class="judul-halaman">
        <h2 id="judulModel">Tambah Model</h2>
        <button class="tombol tombol-kecil tombol-abu" id="batalModel" hidden>Batal ubah</button>
      </div>
      <form id="formModel" class="baris-4" style="margin-top:.75rem">
        <input type="hidden" id="mId">
        <div><label for="mKode">Kode model</label><input type="text" id="mKode" required placeholder="KMEJA-01" maxlength="30"></div>
        <div><label for="mNama">Nama model</label><input type="text" id="mNama" required maxlength="100"></div>
        <div style="grid-column:span 2"><label for="mDesk">Deskripsi (opsional)</label><input type="text" id="mDesk" maxlength="500"></div>
        <div><label for="mS">Tarif Senior (Rp/pcs)</label><input type="number" id="mS" min="0" step="1" placeholder="2500"></div>
        <div><label for="mJ">Tarif Junior (Rp/pcs)</label><input type="number" id="mJ" min="0" step="1" placeholder="2000"></div>
        <div><label for="mM">Tarif Magang (Rp/pcs)</label><input type="number" id="mM" min="0" step="1" placeholder="1500"></div>
        <div style="display:flex;align-items:flex-end"><button class="tombol" type="submit">Simpan</button></div>
      </form>
    </div>
    <div class="kartu">
      <div class="judul-halaman">
        <h2>Matriks Tarif</h2>
        <p>Tarif baru hanya berlaku untuk setoran berikutnya.</p>
      </div>
      <div id="isiModel" style="margin-top:.75rem"><div class="kosong">Memuat…</div></div>
    </div>`;

  $('#formModel').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const id = $('#mId').value;
    const tarif = {
      Senior: $('#mS').value === '' ? undefined : Number($('#mS').value),
      Junior: $('#mJ').value === '' ? undefined : Number($('#mJ').value),
      Magang: $('#mM').value === '' ? undefined : Number($('#mM').value)
    };
    const body = {
      kode: $('#mKode').value,
      nama: $('#mNama').value,
      deskripsi: $('#mDesk').value,
      tarif
    };
    try {
      if (id) {
        await api(`/api/model/${id}`, { method: 'PUT', body });
        beritahu('ok', 'Model diperbarui.');
      } else {
        await api('/api/model', { method: 'POST', body });
        beritahu('ok', 'Model ditambahkan.');
      }
      resetFormModel();
      await muatModelTabel();
    } catch (err) {
      tanganiError(err);
    }
  });

  $('#batalModel').addEventListener('click', resetFormModel);
  await muatModelTabel();
}

function resetFormModel() {
  $('#mId').value = '';
  $('#mKode').value = '';
  $('#mNama').value = '';
  $('#mDesk').value = '';
  $('#mS').value = '';
  $('#mJ').value = '';
  $('#mM').value = '';
  $('#judulModel').textContent = 'Tambah Model';
  $('#batalModel').hidden = true;
}

async function muatModelTabel() {
  const isi = $('#isiModel');
  if (!isi) return;
  const daftar = await muatModel();
  if (daftar.length === 0) {
    isi.className = 'kosong';
    isi.textContent = 'Belum ada model. Tambah model dulu, lalu isi tarifnya.';
    return;
  }
  isi.className = '';
  isi.innerHTML = `
    <div class="bungkus-tabel">
      <table class="tabel-kartu">
        <thead>
          <tr><th>Kode</th><th>Nama</th><th class="angka">Tarif Senior</th><th class="angka">Tarif Junior</th>
              <th class="angka">Tarif Magang</th><th></th></tr>
        </thead>
        <tbody>
          ${daftar
            .map(
              (m) => `<tr data-baris="${m.id}">
                <td data-label="Kode"><strong>${esc(m.kode)}</strong></td>
                <td data-label="Nama">${esc(m.nama)}</td>
                <td data-label="Tarif Senior" class="angka"><input type="number" min="0" step="1" data-t="Senior" value="${m.tarif.Senior ?? ''}" style="text-align:right"></td>
                <td data-label="Tarif Junior" class="angka"><input type="number" min="0" step="1" data-t="Junior" value="${m.tarif.Junior ?? ''}" style="text-align:right"></td>
                <td data-label="Tarif Magang" class="angka"><input type="number" min="0" step="1" data-t="Magang" value="${m.tarif.Magang ?? ''}" style="text-align:right"></td>
                <td class="aksi">
                  <button class="tombol tombol-kecil" data-simpan="${m.id}">Simpan Tarif</button>
                  <button class="tombol tombol-kecil tombol-buka" data-ubah="${m.id}">Ubah</button>
                </td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;

  $$('[data-simpan]', isi).forEach((tombol) =>
    tombol.addEventListener('click', async () => {
      const tr = tombol.closest('tr');
      const isiTarif = {};
      $$('[data-t]', tr).forEach((input) => {
        if (input.value !== '') isiTarif[input.dataset.t] = Number(input.value);
      });
      try {
        await api('/api/tarif', {
          method: 'PUT',
          body: { model_id: Number(tombol.dataset.simpan), tarif: isiTarif }
        });
        beritahu('ok', 'Tarif disimpan. Setoran lama tidak berubah.');
        await muatModelTabel();
      } catch (err) {
        tanganiError(err);
      }
    })
  );

  $$('[data-ubah]', isi).forEach((tombol) =>
    tombol.addEventListener('click', () => {
      const m = daftar.find((x) => String(x.id) === tombol.dataset.ubah);
      if (!m) return;
      $('#mId').value = m.id;
      $('#mKode').value = m.kode;
      $('#mNama').value = m.nama;
      $('#mDesk').value = m.deskripsi || '';
      $('#mS').value = m.tarif.Senior ?? '';
      $('#mJ').value = m.tarif.Junior ?? '';
      $('#mM').value = m.tarif.Magang ?? '';
      $('#judulModel').textContent = 'Ubah Model';
      $('#batalModel').hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    })
  );
}

/* ---------------- halaman: riwayat payroll ---------------- */

async function halamanRiwayat() {
  const [d1, d2] = mingguBerjalan();
  $('#halaman').innerHTML = `
    <div class="kartu">
      <div class="judul-halaman">
        <h2>Riwayat Payroll</h2>
        <p>Payroll yang sudah Diberikan bersifat final dan tidak bisa diubah.</p>
      </div>
      <div class="baris-3" style="margin-top:.75rem">
        <div><label for="rDari">Dari tanggal</label><input type="date" id="rDari" value="${d1}"></div>
        <div><label for="rSampai">Sampai tanggal</label><input type="date" id="rSampai" value="${d2}"></div>
        <div style="display:flex;align-items:flex-end"><button class="tombol" id="rTampil" style="width:100%">Tampilkan</button></div>
      </div>
    </div>
    <div id="isiRiwayat"></div>`;

  $('#rTampil').addEventListener('click', () => muatRiwayat().catch(tanganiError));
  await muatRiwayat();
}

async function muatRiwayat() {
  const isi = $('#isiRiwayat');
  const dari = $('#rDari').value;
  const sampai = $('#rSampai').value;
  const qs = new URLSearchParams();
  if (dari) qs.set('dari', dari);
  if (sampai) qs.set('sampai', sampai);

  const daftar = await api('/api/payroll' + (qs.toString() ? '?' + qs : ''));
  if (daftar.length === 0) {
    isi.innerHTML = '<div class="kartu"><div class="kosong">Belum ada payroll pada periode tersebut.</div></div>';
    return;
  }

  isi.innerHTML = daftar
    .map(
      (p) => `
      <div class="kartu" data-p="${p.id}">
        <div class="judul-halaman">
          <h2>${esc(p.nama_penjahit)} · ${esc(p.periode_mulai)} s.d. ${esc(p.periode_selesai)}</h2>
          <span class="lencan ${p.status === 'Diberikan' ? 'lencan-hijau' : 'lencan-kuning'}">${esc(p.status)}</span>
        </div>
        <div class="ringkas" style="margin-top:.6rem">
          <span>Total PCS: <b>${p.total_pcs}</b></span>
          <span>Gaji kotor: <b>${rupiah(p.gaji_kotor)}</b></span>
          <span>Bonus: <b>${rupiah(p.bonus)}</b></span>
          <span>Potongan kasbon: <b>- ${rupiah(p.total_kasbon)}</b></span>
          <span>Total diterima: <b>${rupiah(p.gaji_bersih)}</b></span>
          <span>Dibayar: <b>${esc(p.dibayar_pada || '—')}</b></span>
        </div>
        <div class="aksi" style="justify-content:flex-start">
          <button class="tombol tombol-kecil tombol-abu" data-slip="${p.id}">Lihat Slip</button>
          <button class="tombol tombol-kecil tombol-wa" data-kirim="${p.id}">Kirim Slip WA</button>
        </div>
        <pre class="slip sembunyi" id="slip-${p.id}">Memuat slip…</pre>
      </div>`
    )
    .join('');

  $$('[data-slip]', isi).forEach((tombol) =>
    tombol.addEventListener('click', async () => {
      const pre = $('#slip-' + tombol.dataset.slip);
      if (!pre.classList.contains('sembunyi')) {
        pre.classList.add('sembunyi');
        return;
      }
      try {
        const data = await api(`/api/payroll/${tombol.dataset.slip}/slip`);
        pre.textContent = data.teks;
        pre.classList.remove('sembunyi');
      } catch (err) {
        tanganiError(err);
      }
    })
  );

  $$('[data-kirim]', isi).forEach((tombol) =>
    tombol.addEventListener('click', () => kirimSlip(Number(tombol.dataset.kirim)).catch(tanganiError))
  );
}

/* ---------------- router ---------------- */

const RUTE = {
  '#/rekap': halamanRekap,
  '#/setoran': halamanSetoran,
  '#/kasbon': halamanKasbon,
  '#/penjahit': halamanPenjahit,
  '#/model': halamanModel,
  '#/riwayat': halamanRiwayat
};

let sudahNavigasi = false;
async function navigasi() {
  if (sudahNavigasi) return;
  sudahNavigasi = true;
  const hash = location.hash && RUTE[location.hash] ? location.hash : '#/rekap';
  $$('#navigasi a').forEach((a) => a.classList.toggle('aktif', a.getAttribute('href') === hash));
  $('#halaman').innerHTML = '<div class="kartu"><div class="kosong">Memuat…</div></div>';
  try {
    await RUTE[hash]();
  } catch (err) {
    tanganiError(err);
    $('#halaman').innerHTML = `<div class="kartu"><div class="kosong">${esc(err.message)}</div></div>`;
  } finally {
    sudahNavigasi = false;
  }
}

window.addEventListener('hashchange', navigasi);
document.addEventListener('DOMContentLoaded', navigasi);
if (document.readyState !== 'loading') navigasi();
