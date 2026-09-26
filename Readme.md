# Crawl VOD - Video On Demand System

Hệ thống xem video và crawl dữ liệu đa nguồn (VOD) hiệu suất cao, tích hợp server proxy phát đa phương tiện HLS/m3u8, cơ sở dữ liệu SQLite tối ưu bộ nhớ và giao diện web hiện đại.

---

## 📌 Tổng Quan

**Crawl VOD** là giải pháp toàn diện bao gồm backend Python Flask và frontend Web SPA (Single Page Application) đáp ứng nhu cầu xem video, tìm kiếm nâng cao và quản lý nội dung yêu thích/lịch sử xem.

### 🌟 Tính năng nổi bật:
- **Đa nguồn dữ liệu (Multi-source Scrapers)**: Hỗ trợ tự động thu thập và xử lý dữ liệu từ nhiều nguồn (`javtiful`, `missav`, `vlxx`, `sextop1`, `javguru`).
- **Proxy Streaming đa luồng**: Trình phát video HLS (`.m3u8`) thông qua proxy đa luồng, hỗ trợ chunking linh hoạt và bypass anti-hotlinking/CORS.
- **Tự động theo dõi tên miền (Auto Domain Tracking)**: Tự động phát hiện và cập nhật tên miền mới khi nguồn crawl thay đổi domain hoặc redirect.
- **Quản lý bộ nhớ tối ưu (Termux Friendly)**: Cơ chế đệm bộ nhớ SQLite WAL, giới hạn buffer RAM thích hợp cho các thiết bị di động (như Android Termux).
- **Hệ thống Định danh & Tài khoản**: Hỗ trợ Đăng ký / Đăng nhập JWT, xác thực OTP qua Email để đổi/khôi phục mật khẩu.
- **Giao diện Modern SPA**: Tách biệt frontend modular (`HTML`, `CSS`, `JS`), trình xem video Video.js tinh chỉnh với hệ thống điều khiển overlay mượt mà.

---

## 🏗️ Cấu Trúc Dự Án

Thư mục dự án được tổ chức tách biệt giữa Backend và Frontend:

```
crawl-vod/
├── backend/
│   ├── server.py              # Flask HTTP API & Proxy server chính
│   ├── source-javguru.py      # Scraper module cho Javguru
│   ├── source-javtiful.py     # Scraper module cho Javtiful
│   ├── source-missav.py       # Scraper module cho MissAV
│   ├── source-sextop1.py      # Scraper module cho Sextop1
│   ├── source-vlxx.py         # Scraper module cho VLXX
│   ├── update_added_at.py     # Script tiện ích cập nhật thời gian
│   └── sample/                # Mẫu HTML/dữ liệu phục vụ kiểm thử
├── frontend/
│   ├── css/                   # Stylesheet chia theo module (base, components, pages, player)
│   ├── js/                    # Scripts xử lý logic (api, config, gallery, player, profile, search, ...)
│   └── index.html             # Trang HTML Single Page Application chính
├── Readme.md                  # Tài liệu hướng dẫn sử dụng
└── .gitignore
```

---

## 🚀 Hướng Dẫn Chạy

### 1. Yêu cầu môi trường
- Python 3.8+
- Cài đặt các gói thư viện cần thiết:
  ```bash
  pip install curl_cffi beautifulsoup4 flask psutil
  ```
  *(Tùy chọn: cài đặt `nltk`, `underthesea` hoặc `spacy` để tối ưu hóa khả năng tách từ khóa tìm kiếm).*

### 2. Các tham số dòng lệnh (`backend/server.py`)

| Tham số | Mặc định | Mô tả |
| :--- | :--- | :--- |
| `-source` | `javtiful` | Nguồn dữ liệu (`javtiful`, `missav`, `vlxx`, `sextop1`, `javguru`) |
| `-port` | `5004` (VLXX: `5005`) | Cổng kết nối HTTP Server |
| `-domain` | Tự động | Domain chính của nguồn crawler |
| `-sqlite3` | Tự động theo OS | Đường dẫn file SQLite Database (`D:\Database\<source>.db` trên Windows) |
| `-limit-buffer` | `200M` | Giới hạn bộ nhớ RAM đệm cho SQLite |
| `-news-threads` | `0` | Số luồng quét video mới |
| `-detail-threads` | `0` | Số luồng cào thông tin chi tiết video |
| `-videos-threads` | `0` | Số luồng cào danh sách video backlog |
| `-proxy-threads` | `8` | Số luồng tải file Proxy đa luồng cho video stream |
| `-chunk_size` | `128KB` | Kích thước chunk proxy (ví dụ: `512KB`) |
| `-timeout` | `connect=3.0,read=None` | Cấu hình timeout cho kết nối proxy |

### 3. Lệnh chạy mẫu

#### 🌐 Danh sách Cổng (Ports) chuẩn hệ sinh thái:
- `3010`: `nextdjav-admin` (Admin server / Watchdog)
- `3011`: `nextdjav` (Dedicated GDrive OnePlayer)
- `3012`: `crawl-vod` - Javtiful (`javtiful.com`)
- `3013`: `crawl-vod` - MissAV (`missav.ws`)
- `3014`: `crawl-vod` - VLXX (`vlxx.phd`)
- `3015`: `crawl-vod` - Sextop1 (`sextop1.spa`)

#### 💻 Trên Windows (PC)
```powershell
python backend/server.py -source javtiful -port 3012 -domain javtiful.com -news-threads 1 -detail-threads 1
```

#### 📱 Trên Android (Tab S8 / Termux)
```bash
cd "/sdcard/Projects/crawl-vod"

# Chạy toàn bộ hệ sinh thái background
python /sdcard/Projects/nextdjav-admin/start.py --sqlite3 "/sdcard/Database/nextdjav.db" --port 3010 &
python /sdcard/Projects/nextdjav/start.py       --sqlite3 "/sdcard/Database/nextdjav.db" --port 3011 &
python /sdcard/Projects/crawl-vod/backend/server.py -source javtiful -domain javtiful.com -detail-threads 1 -news-threads 1 -port 3012 -proxy-threads 7 -chunk_size 512KB -max_connections 30 -max_keepalive 10 -timeout "connect=3.0,read=None" & 
python /sdcard/Projects/crawl-vod/backend/server.py -source missav -domain missav.ws -detail-threads 1 -news-threads 1 -port 3013 -proxy-threads 7 -chunk_size 512KB -max_connections 30 -max_keepalive 10 -timeout "connect=3.0,read=None" & 
python /sdcard/Projects/crawl-vod/backend/server.py -source vlxx -domain vlxx.phd -detail-threads 1 -news-threads 1 -port 3014 -proxy-threads 7 -chunk_size 512KB -max_connections 30 -max_keepalive 10 -timeout "connect=3.0,read=None" & 
python /sdcard/Projects/crawl-vod/backend/server.py -source sextop1 -domain sextop1.spa -detail-threads 1 -news-threads 1 -port 3015 -proxy-threads 7 -chunk_size 512KB -max_connections 30 -max_keepalive 10 -timeout "connect=3.0,read=None" & 
```

---

## 📝 Nhật Ký Thay Đổi (Changelog)

### 🔄 Phiên bản Refactor Cấu Trúc Mới (Frontend & Backend)
- **Tái cấu trúc thư mục toàn diện**:
  - Phân chia rõ ràng mã nguồn thành `./frontend` và `./backend`.
  - Chuyển toàn bộ các script Python (`server.py`, `source-*.py`, `update_added_at.py`) và tài nguyên cào dữ liệu mẫu vào `./backend`.
  - Tách giao diện người dùng thành các module CSS (`base`, `components`, `pages`, `player`) và JavaScript (`api`, `config`, `details`, `gallery`, `main`, `player`, `profile`, `search`) trong `./frontend`.
- **Cập nhật hệ thống định vị đường dẫn backend**:
  - `server.py` tự động phục vụ file tĩnh từ `../frontend` và nạp module scraper tương ứng từ `./backend` bất kể thư mục thực thi.

### 🎨 Cải tiến Giao diện & Trình phát (Player & UI)
- **Overlay Video Player**:
  - Tinh chỉnh giao diện trình phát Video.js với bộ nút điều khiển tập trung, hỗ trợ gesture vuốt/tăng giảm tiến trình mượt mà.
  - Tích hợp animation thả tim khi yêu thích video và indicator tua nhanh.
- **Quản lý Tài khoản & Định danh**:
  - Hệ thống đăng nhập/đăng ký bằng JWT.
  - Gửi mã OTP xác thực Email cho tính năng đổi và khôi phục mật khẩu.

### ⚡ Tối ưu Backend & Cơ sở dữ liệu
- **Auto Domain Update**: Thêm callback tự động ghi nhận và cập nhật domain mới vào database SQLite khi trang web nguồn đổi tên miền.
- **SQLite Memory Safety**: Áp dụng chế độ đệm ghi WAL và cài đặt PRAGMA cache/mmap động nhằm hạn chế tình trạng tràn RAM trên các thiết bị Android Termux.
