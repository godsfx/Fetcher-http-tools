# M3U8 & Resource Detector v3.5

Userscript untuk memantau request media/resource jaringan (`.m3u8`, `.mp4`, `.js`, `.json`, endpoint API), memindai token sesi lintas sumber, menginspeksi/melakukan *live patch* pada skrip JS, respons JSON, dan Web Storage (`localStorage` / `sessionStorage`), serta mencatat log fungsi secara real-time langsung melalui panel mengambang (*floating overlay*) di browser.

## Fitur Utama

- **Network & DOM Resource Monitor**: Menangkap URL media (`.m3u8`, `.mp4`, `.webm`, `.mpd`) dan aset (`.js`, `.json`, endpoint API) melalui hook `fetch`, `XMLHttpRequest`, `PerformanceObserver`, serta pemindaian elemen DOM (`<video>`, `<source>`, `<iframe>`, `<script>`).
- **Multi-Source Token Scanner**: Mendeteksi token autentikasi secara otomatis dari `localStorage`, `sessionStorage`, properti global `window`, tag `<meta>`, `IndexedDB`, cookie, URL, dan header request/response.
- **Valid Link Builder & Auto-Match**: Menyusun ulang URL API dengan mempertahankan parameter kueri asli sambil menyuntikkan token aktif yang terdeteksi.
- **JS Viewer & Live Patch (`.plist` Mode)**: Membuka kode sumber `.js` yang terdeteksi, menampilkan indeks struktur fungsi/timer/hook dalam format XML `.plist`, serta menjalankan dan menyimpan *live patch* lokal dengan opsi `Auto-Run`.
- **JSON Editor & Response Override (`.plist` Mode)**: Memformat (*pretty-print*), me-*minify*, mengonversi ke format `.plist`, serta melakukan *mock/override* respons JSON untuk pola endpoint tertentu.
- **Storage Live Patch (`.plist` & Search)**: Mencari key/value pada `localStorage` atau `sessionStorage`, mengedit nilainya dalam tampilan `.plist` maupun JSON/teks, dan menerapkannya secara langsung.
- **Live Function Log**: Menampilkan aliran aktivitas eksekusi *live patch* JS, *override* JSON, mutasi Storage, pemblokiran *polling*, dan pembersihan sesi dengan filter kategori dan pencarian.
- **Active Tab Cookie & Cache Cleaner**: Menghapus cookie, `CacheStorage`, Service Worker, dan *resource timings* pada tab/domain aktif dalam satu klik.
- **Experimental Server Poll Guard (`[EXP] Stop Server Poll`)**: Opsi eksperimental untuk menahan interval/timeout/request *polling* berkala pada halaman aktif.

## Persyaratan & Kompatibilitas

Memerlukan ekstensi atau aplikasi *userscript manager* pada browser:
- **iOS / iPadOS (Safari)**: [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) atau Tampermonkey for Safari
- **Desktop (Chrome, Edge, Firefox, Brave)**: Tampermonkey atau Violentmonkey
- **Android**: Kiwi Browser / Firefox dengan ekstensi Tampermonkey atau Violentmonkey

## Cara Instalasi

1. Unduh file **`m3u8-auto-detector-v3.5-fix.user.js`** dari repositori ini.
2. Buka dashboard *userscript manager* Anda (Tampermonkey / Violentmonkey / Userscripts).
3. Pilih menu **Import / Utilities / Tambah Skrip Baru**, lalu arahkan ke file `m3u8-auto-detector-v3.5-fix.user.js` (atau tempelkan seluruh isi kodenya).
4. Simpan dan pastikan status skrip dalam keadaan **Aktif (Enabled)**.
5. Muat ulang halaman web target; panel mengambang **Media (0) • Tok (0)** akan muncul di pojok layar dan dapat digeser (*drag*) ke posisi mana pun.

## Panduan Singkat Penggunaan

| Tombol / Panel | Fungsi |
| :--- | :--- |
| **`API/Tok`** | Membuka laci konfigurasi *Valid Link Builder*, daftar endpoint API kustom, dan daftar token yang terdeteksi. |
| **`Match`** | Memindai ulang storage, DOM, dan skrip halaman lalu mencocokkan kombinasi API dan token secara otomatis. |
| **`JS Editor`** | Membuka editor sumber `.js` untuk inspeksi struktur (`.plist`) dan injeksi *live patch* lokal. |
| **`JSON Editor`** | Membuka editor respons JSON dan mengatur aturan *override* respons untuk pola URL tertentu. |
| **`Storage Patch`** | Membuka editor pencarian dan modifikasi langsung `localStorage` / `sessionStorage`. |
| **`Live Log`** | Membuka jendela log real-time untuk memantau aktivitas JS, JSON, Storage, dan *polling*. |
| **`Clear Cookie/Cache`** | Membersihkan cookie, `CacheStorage`, dan Service Worker pada tab yang sedang dibuka. |
| **`Play .m3u8`** | Menyalin dan membuka tautan `.m3u8` terbaru yang tertangkap. |

## Struktur Repositori

```text
.
├── m3u8-auto-detector-v3.5-fix.user.js   # Skrip userscript utama (v3.5)
└── README.md                             # Dokumentasi repositori
```

## Catatan Penggunaan

Skrip ini ditujukan untuk keperluan inspeksi jaringan, *debugging* frontend, dan pengujian lokal di sisi klien (*client-side*). Gunakan secara bertanggung jawab dan patuhi ketentuan layanan dari situs web yang Anda akses.
