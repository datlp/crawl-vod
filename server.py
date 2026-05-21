import argparse
import os
import sys
import time
import datetime
import json
import re
import sqlite3
import base64
import hmac
import hashlib
import threading
import concurrent.futures
import importlib.util
import builtins
import difflib
import signal
import queue
from urllib.parse import urlparse, parse_qs, quote



def custom_log(category, message):
    now = datetime.datetime.now()
    timestamp = now.strftime('%y%m%d_%H%M%S_') + f"{now.microsecond // 1000:03d}"
    print(f"{timestamp} [{category}] {message}", flush=True)

# Đưa custom_log vào builtins để các file source-*.py gọi được mà không cần import builtins
builtins.custom_log = custom_log

try:
    from curl_cffi import requests as curl_requests
    from bs4 import BeautifulSoup
    from flask import Flask, request, jsonify, Response, make_response
    import psutil
    custom_log("System", "✔️ Kiểm tra đủ package cơ bản...")
except ImportError as e:
    print(f"Lỗi: Không tìm thấy thư viện bắt buộc. Chi tiết: {e}")
    print("Vui lòng cài đặt các thư viện cần thiết bằng lệnh sau:")
    print("pip install curl_cffi beautifulsoup4 flask")
    custom_log("System", f"❌ Không tìm thấy thư viện bắt buộc. Chi tiết: {e}")
    custom_log("System", "⚠️ Vui lòng cài đặt bằng lệnh: pip install curl_cffi beautifulsoup4 flask psutil")
    sys.exit(1)
#  
try:
    import spacy
except ImportError:
    spacy = None
try:
    import underthesea
except ImportError:
    underthesea = None

try:
    import nltk
except ImportError:
    nltk = None

global_last_request_time = time.time()
CLIENT_IDLE_TIMEOUT = 5
DB_FLUSH_INTERVAL = 5 # Khoảng thời gian (giây) định kỳ ghi buffer xuống DB

memory_lock = threading.Lock()
db_lock = threading.Lock()
db_buffer = {
    'videos': {},
    'video_urls': {},
    'media': {}
}
downloading_media = set()

JWT_SECRET = "javtiful-player-secret-key-2026"

def create_jwt(payload):
    header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(',', ':')).encode()).decode().rstrip('=')
    payload_enc = base64.urlsafe_b64encode(json.dumps(payload, separators=(',', ':')).encode()).decode().rstrip('=')
    signature = base64.urlsafe_b64encode(hmac.new(JWT_SECRET.encode(), f"{header}.{payload_enc}".encode(), hashlib.sha256).digest()).decode().rstrip('=')
    return f"{header}.{payload_enc}.{signature}"

def verify_jwt(token):
    try:
        header, payload_enc, signature = token.split('.')
        expected_sig = base64.urlsafe_b64encode(hmac.new(JWT_SECRET.encode(), f"{header}.{payload_enc}".encode(), hashlib.sha256).digest()).decode().rstrip('=')
        if hmac.compare_digest(signature, expected_sig):
            payload_padded = payload_enc + '=' * (-len(payload_enc) % 4)
            return json.loads(base64.urlsafe_b64decode(payload_padded.encode()).decode())
    except Exception:
        pass
    return None

def extract_clean_keywords_bulletproof(text):
    if not text:
        return []
    text = re.sub(r'[^\w\s]', ' ', text.lower())
    words = text.split()
    
    if nltk:
        try:
            try:
                nltk.data.find('corpora/stopwords')
            except LookupError:
                nltk.download('stopwords', quiet=True)
            from nltk.corpus import stopwords
            stop_words = set(stopwords.words('english'))
            words = [w for w in words if w not in stop_words and not w.isdigit() and len(w) > 2]
            return list(dict.fromkeys(words))
        except Exception:
            pass
            
    # Fallback nếu không có nltk hoặc nltk bị lỗi
    basic_stopwords = {'the', 'is', 'are', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'this', 'that'}
    words = [w for w in words if w not in basic_stopwords and not w.isdigit() and len(w) > 2]
    return list(dict.fromkeys(words))

VIDEOS_TABLE = "javtiful_videos"

def flush_db_buffer(db_conn):
    with memory_lock:
        videos_to_save = db_buffer['videos'].copy()
        urls_to_save = db_buffer['video_urls'].copy()
        media_to_save = db_buffer['media'].copy()
        
        db_buffer['videos'].clear()
        db_buffer['video_urls'].clear()
        db_buffer['media'].clear()
        
    if not any([videos_to_save, urls_to_save, media_to_save]):
        return
        
    try:
        with db_lock:
            cursor = db_conn.cursor()
            cursor.execute("BEGIN TRANSACTION;")
            
            for vid_id, vid in videos_to_save.items():
                cursor.execute(f'''
                    INSERT INTO {VIDEOS_TABLE} (id, title, cover, added_at, release_date, dvd)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        title = excluded.title,
                        cover = excluded.cover,
                        added_at = excluded.added_at,
                        release_date = excluded.release_date,
                        dvd = excluded.dvd
                ''', (vid['id'], vid['title'], vid['cover'], vid['added_at'], vid.get('release_date', ''), vid.get('dvd', '')))
                
            for vid_id, url in urls_to_save.items():
                cursor.execute(f"UPDATE {VIDEOS_TABLE} SET url = ? WHERE id = ?", (url, vid_id))
                
            for media_id, m in media_to_save.items():
                cursor.execute("INSERT OR REPLACE INTO media (id, data, content_type) VALUES (?, ?, ?)", (media_id, m['data'], m['content_type']))
                
            db_conn.commit()
            
        details_ids = ",".join(urls_to_save.keys())
        custom_log("System", f"✔️ Buffer ghi xuống DB: {len(videos_to_save)} videos | {len(urls_to_save)} details: {details_ids}")
    except Exception as e:
        custom_log("System", f"❌ Lỗi khi ghi DB: {e}")
        try:
            with db_lock:
                db_conn.rollback()
        except:
            pass
        with memory_lock:
            for vid_id, vid in videos_to_save.items():
                if vid_id not in db_buffer['videos']: db_buffer['videos'][vid_id] = vid
            for vid_id, url in urls_to_save.items():
                if vid_id not in db_buffer['video_urls']: db_buffer['video_urls'][vid_id] = url
            for media_id, m in media_to_save.items():
                if media_id not in db_buffer['media']: db_buffer['media'][media_id] = m

def background_db_worker(db_conn):
    while True:
        time.sleep(DB_FLUSH_INTERVAL)
        flush_db_buffer(db_conn)

def get_db_connection(db_path, limit_buffer='200M', source_module=None):
    os.makedirs(os.path.dirname(os.path.abspath(db_path)) or '.', exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute('PRAGMA journal_mode=WAL;')
    
    # Thiết lập cache_size và mmap_size cho SQLite để tránh Android Termux kill process do tốn RAM
    if limit_buffer and limit_buffer != '0':
        limit_str = str(limit_buffer).strip().upper()
        kb = 2000
        try:
            if limit_str.endswith('G'): kb = int(float(limit_str[:-1]) * 1024 * 1024)
            elif limit_str.endswith('M'): kb = int(float(limit_str[:-1]) * 1024)
            elif limit_str.endswith('K'): kb = int(float(limit_str[:-1]))
            elif limit_str.isdigit(): kb = int(limit_str) // 1024
            
            if kb > 0:
                conn.execute(f'PRAGMA cache_size=-{kb};')
                conn.execute(f'PRAGMA mmap_size={kb * 1024};')
        except Exception as e:
            custom_log("System", f"⚠️ Lỗi khi set limit buffer: {e}")
            
    if source_module and hasattr(source_module, 'setup_db'):
        source_module.setup_db(conn, VIDEOS_TABLE)
    else:
        # Fallback sử dụng bảng mặc định nếu plugin không tự định nghĩa
        conn.execute(f'''
            CREATE TABLE IF NOT EXISTS {VIDEOS_TABLE} (
                id TEXT PRIMARY KEY,
                title TEXT,
                cover TEXT,
                url TEXT,
                added_at TEXT,
                release_date TEXT,
                actress TEXT,
                genre TEXT,
                maker TEXT,
                details TEXT,
                dvd TEXT,
                details_fetched INTEGER DEFAULT 0
            )
        ''')
        try:
            conn.execute(f"ALTER TABLE {VIDEOS_TABLE} ADD COLUMN dvd TEXT")
        except sqlite3.OperationalError:
            pass
            
        cursor = conn.cursor()
        cursor.execute(f"UPDATE {VIDEOS_TABLE} SET dvd = substr(title, 1, instr(title || ' ', ' ') - 1) WHERE dvd IS NULL OR dvd = ''")
        
        conn.execute(f'CREATE INDEX IF NOT EXISTS idx_{VIDEOS_TABLE}_details_fetched ON {VIDEOS_TABLE}(details_fetched, added_at ASC)')
        conn.execute(f'CREATE INDEX IF NOT EXISTS idx_{VIDEOS_TABLE}_search_actress ON {VIDEOS_TABLE}(actress)')
        conn.execute(f'CREATE INDEX IF NOT EXISTS idx_{VIDEOS_TABLE}_search_genre ON {VIDEOS_TABLE}(genre)')
        conn.execute(f'CREATE INDEX IF NOT EXISTS idx_{VIDEOS_TABLE}_search_maker ON {VIDEOS_TABLE}(maker)')
        conn.execute(f'CREATE INDEX IF NOT EXISTS idx_{VIDEOS_TABLE}_search_details ON {VIDEOS_TABLE}(details)')
        conn.execute(f'CREATE INDEX IF NOT EXISTS idx_{VIDEOS_TABLE}_search_title ON {VIDEOS_TABLE}(title)')

        cursor.execute(f"PRAGMA table_info({VIDEOS_TABLE}_fts)")
        fts_cols = [row[1] for row in cursor.fetchall()]
        if 'dvd' not in fts_cols:
            cursor.execute(f"DROP TABLE IF EXISTS {VIDEOS_TABLE}_fts")
            cursor.execute(f"DROP TRIGGER IF EXISTS {VIDEOS_TABLE}_ai")
            cursor.execute(f"DROP TRIGGER IF EXISTS {VIDEOS_TABLE}_ad")
            cursor.execute(f"DROP TRIGGER IF EXISTS {VIDEOS_TABLE}_au")

        conn.execute(f'''
            CREATE VIRTUAL TABLE IF NOT EXISTS {VIDEOS_TABLE}_fts USING fts5(
                title, actress, genre, maker, details, dvd,
                content='{VIDEOS_TABLE}', content_rowid='rowid'
            )
        ''')
        for trigger_sql in [
            f"CREATE TRIGGER IF NOT EXISTS {VIDEOS_TABLE}_ai AFTER INSERT ON {VIDEOS_TABLE} BEGIN INSERT INTO {VIDEOS_TABLE}_fts(rowid, title, actress, genre, maker, details, dvd) VALUES (new.rowid, new.title, new.actress, new.genre, new.maker, new.details, new.dvd); END;",
            f"CREATE TRIGGER IF NOT EXISTS {VIDEOS_TABLE}_ad AFTER DELETE ON {VIDEOS_TABLE} BEGIN INSERT INTO {VIDEOS_TABLE}_fts({VIDEOS_TABLE}_fts, rowid, title, actress, genre, maker, details, dvd) VALUES ('delete', old.rowid, old.title, old.actress, old.genre, old.maker, old.details, old.dvd); END;",
            f"CREATE TRIGGER IF NOT EXISTS {VIDEOS_TABLE}_au AFTER UPDATE ON {VIDEOS_TABLE} BEGIN INSERT INTO {VIDEOS_TABLE}_fts({VIDEOS_TABLE}_fts, rowid, title, actress, genre, maker, details, dvd) VALUES ('delete', old.rowid, old.title, old.actress, old.genre, old.maker, old.details, old.dvd); INSERT INTO {VIDEOS_TABLE}_fts(rowid, title, actress, genre, maker, details, dvd) VALUES (new.rowid, new.title, new.actress, new.genre, new.maker, new.details, new.dvd); END;"
        ]:
            conn.execute(trigger_sql)
            
        cursor.execute(f"SELECT COUNT(*) FROM {VIDEOS_TABLE}_fts")
        if cursor.fetchone()[0] == 0:
            custom_log("System", "⏳ Backfilling FTS index...")
            cursor.execute(f'''
                INSERT INTO {VIDEOS_TABLE}_fts(rowid, title, actress, genre, maker, details, dvd)
                SELECT rowid, title, actress, genre, maker, details, dvd FROM {VIDEOS_TABLE}
            ''')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS media (
            id TEXT PRIMARY KEY,
            data BLOB,
            content_type TEXT
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS identities (
            username TEXT PRIMARY KEY,
            email TEXT UNIQUE,
            password TEXT,
            session_id TEXT,
            otp TEXT,
            otp_expire INTEGER,
            created_at INTEGER,
            verified INTEGER DEFAULT 0
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS user_sessions (
            username TEXT,
            session_id TEXT PRIMARY KEY
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS favorites (
            username TEXT,
            video_id TEXT,
            added_at TEXT,
            PRIMARY KEY (username, video_id)
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS history (
            username TEXT,
            video_id TEXT,
            watch_count INTEGER DEFAULT 1,
            last_watched INTEGER,
            PRIMARY KEY (username, video_id)
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS sync_tasks (
            url_pattern TEXT PRIMARY KEY,
            current_page INTEGER DEFAULT 1,
            total_pages INTEGER DEFAULT 2000,
            last_fetched INTEGER DEFAULT 0,
            is_completed INTEGER DEFAULT 0
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS history_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            video_id TEXT,
            watched_at INTEGER
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_history_logs_time ON history_logs(watched_at)')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS search_history (
            username TEXT,
            keyword TEXT,
            searched_at INTEGER,
            PRIMARY KEY (username, keyword)
        )
    ''')
    conn.commit()
    return conn

tags_cache = []
def load_tags_cache_if_needed(cursor):
    global tags_cache
    if not tags_cache:
        try:
            cursor.execute("SELECT keyword, type, count FROM tags_summary")
            for r in cursor.fetchall():
                kw = r[0]
                if not kw: continue
                low = kw.lower()
                sorted_low = " ".join(sorted(low.split()))
                tags_cache.append((kw, r[1], r[2], low, sorted_low))
        except Exception as e:
            custom_log("System", f"❌ Load tags cache error: {e}")

def rebuild_tags_fts(db_conn):
    custom_log("System", "⏳ Đang tổng hợp dữ liệu actress, genre, maker...")
    cursor = db_conn.cursor()
    cursor.execute(f"SELECT actress, genre, maker FROM {VIDEOS_TABLE}")
    rows = cursor.fetchall()
    
    actress_counts = {}
    genre_counts = {}
    maker_counts = {}
    
    for row in rows:
        if row[0]:
            for a in row[0].split(','):
                a = a.strip()
                if a: actress_counts[a] = actress_counts.get(a, 0) + 1
        if row[1]:
            for g in row[1].split(','):
                g = g.strip()
                if g: genre_counts[g] = genre_counts.get(g, 0) + 1
        if row[2]:
            for m in row[2].split(','):
                m = m.strip()
                if m: maker_counts[m] = maker_counts.get(m, 0) + 1
                
    cursor.execute("DROP TABLE IF EXISTS tags_summary")
    cursor.execute("DROP TABLE IF EXISTS tags_fts")
    
    cursor.execute("CREATE TABLE tags_summary (keyword TEXT, type TEXT, count INTEGER)")
    cursor.execute("CREATE VIRTUAL TABLE tags_fts USING fts5(keyword, type UNINDEXED, count UNINDEXED, content='tags_summary', content_rowid='rowid')")
    
    data = []
    for k, c in actress_counts.items(): data.append((k, 'actress', c))
    for k, c in genre_counts.items(): data.append((k, 'genre', c))
    for k, c in maker_counts.items(): data.append((k, 'maker', c))
    
    cursor.executemany("INSERT INTO tags_summary (keyword, type, count) VALUES (?, ?, ?)", data)
    cursor.execute("INSERT INTO tags_fts(tags_fts) VALUES('rebuild')")
    db_conn.commit()
    global tags_cache
    tags_cache = []
    custom_log("System", "✔️ Hoàn tất tổng hợp tags.")

class BackgroundScanner(threading.Thread):
    def __init__(self, scraper, upgrade_all=False, news_threads=0, detail_threads=0, videos_threads=0):
        super().__init__(daemon=True)
        self.scraper = scraper
        self.upgrade_all = upgrade_all
        self.news_threads = news_threads
        self.detail_threads = detail_threads
        self.videos_threads = videos_threads
        self.news_queue = queue.Queue()

    def run(self):
        self.scraper.update_sync_tasks_from_menu()
        
        if self.upgrade_all:
            domain_base = self.scraper.domain.split('.')[0].lower()
            source_name = getattr(self.scraper, 'source_name', '').lower()
            with db_lock:
                cursor = self.scraper.db_conn.cursor()
                cursor.execute("UPDATE sync_tasks SET current_page = 1, is_completed = 0")
                cursor.execute("UPDATE sync_tasks SET current_page = 1, is_completed = 0 WHERE LOWER(url_pattern) LIKE ? OR LOWER(url_pattern) LIKE ?", (f"%{domain_base}%", f"%{source_name}%"))
                self.scraper.db_conn.commit()
                
        if self.news_threads > 0:
            threading.Thread(target=self.news_dispatcher_loop, daemon=True).start()
        
        for i in range(self.news_threads):
            threading.Thread(target=self.news_scan_worker, args=(i+1,), daemon=True).start()
            
        for i in range(self.detail_threads):
            threading.Thread(target=self.details_scan_worker, args=(i+1,), daemon=True).start()
            
        for i in range(self.videos_threads):
            threading.Thread(target=self.backlog_scan_worker, args=(i+1,), daemon=True).start()
            
        while True:
            time.sleep(3600)

    def news_dispatcher_loop(self):
        while True:
            try:
                domain_base = self.scraper.domain.split('.')[0].lower()
                source_name = getattr(self.scraper, 'source_name', '').lower()
                with db_lock:
                    cursor = self.scraper.db_conn.cursor()
                    cursor.execute("SELECT url_pattern FROM sync_tasks ORDER BY CASE WHEN url_pattern LIKE '%chinese-av%' THEN 0 ELSE 1 END")
                    cursor.execute("SELECT url_pattern FROM sync_tasks WHERE LOWER(url_pattern) LIKE ? OR LOWER(url_pattern) LIKE ? ORDER BY CASE WHEN url_pattern LIKE '%chinese-av%' THEN 0 ELSE 1 END", (f"%{domain_base}%", f"%{source_name}%"))
                    tasks = cursor.fetchall()
                
                if self.news_queue.empty():
                    for task in tasks:
                        self.news_queue.put(task[0])
            except Exception as e:
                custom_log("System", f"❌ Lỗi dispatcher video mới: {e}")
                
            time.sleep(300)

    def news_scan_worker(self, thread_num):
        global global_last_request_time
        source_name = getattr(self.scraper, 'source_name', 'System')
        while True:
            try:
                url_pattern = self.news_queue.get(timeout=5)
            except queue.Empty:
                continue
                
            page = 1
            while True:
                if time.time() - global_last_request_time < CLIENT_IDLE_TIMEOUT:
                    time.sleep(2)
                    continue
                    
                try:
                    custom_log(source_name, f"⏳[News Thread {thread_num}] {url_pattern} page {page}...")
                    new_inserted, found, _ = self.scraper.sync_list_page(url_pattern, page)
                    if found == -1:
                        time.sleep(5)
                        break
                    custom_log(source_name, f"✔️[News Thread {thread_num}] {url_pattern} page {page} - {new_inserted} new, {found} found")
                    if new_inserted > 0 and found > 0:
                        page += 1
                        time.sleep(1)
                    else:
                        custom_log(source_name, f"⏳[News Thread {thread_num}] Done Đang chuyển giao cho tác vụ khác...")
                        break
                except Exception as e:
                    custom_log("System", f"❌ Lỗi kiểm tra video mới: {e}")
                    break
            self.news_queue.task_done()
            
    def details_scan_worker(self, thread_num):
        global global_last_request_time
        source_name = getattr(self.scraper, 'source_name', 'System')
        while True:
            time.sleep(0.5)
            try:
                if time.time() - global_last_request_time < CLIENT_IDLE_TIMEOUT:
                    continue
                    
                with db_lock:
                    cursor = self.scraper.db_conn.cursor()
                    cursor.execute(f"SELECT id FROM {VIDEOS_TABLE} WHERE details_fetched = 0 ORDER BY added_at ASC LIMIT 1")
                    row = cursor.fetchone()
                    if row:
                        vid_id = row[0]
                        cursor.execute(f"UPDATE {VIDEOS_TABLE} SET details_fetched = -2 WHERE id = ?", (vid_id,))
                        self.scraper.db_conn.commit()
                    
                if not row:
                    time.sleep(300)
                    continue
                    
                custom_log(source_name, f"⏳[Detail Thread {thread_num}] {vid_id}")
                success = self.scraper.sync_video_details(vid_id)
                custom_log(source_name, f"✔️[Detail Thread {thread_num}] {vid_id} - {'Success' if success else 'Failed'}")
            except Exception as e:
                custom_log("System", f"❌ Lỗi quét chi tiết: {e}")
                time.sleep(5)

    def backlog_scan_worker(self, thread_num):
        global global_last_request_time
        source_name = getattr(self.scraper, 'source_name', 'System')
        domain_base = self.scraper.domain.split('.')[0].lower()
        src_lower = source_name.lower()
        while True:
            time.sleep(1)
            try:
                if time.time() - global_last_request_time < CLIENT_IDLE_TIMEOUT:
                    continue
                    
                task_to_run = None
                with db_lock:
                    cursor = self.scraper.db_conn.cursor()
                    cursor.execute("SELECT url_pattern, current_page, total_pages FROM sync_tasks WHERE is_completed = 0 ORDER BY CASE WHEN url_pattern LIKE '%chinese-av%' THEN 0 ELSE 1 END LIMIT 1")
                    cursor.execute("SELECT url_pattern, current_page, total_pages FROM sync_tasks WHERE is_completed = 0 AND (LOWER(url_pattern) LIKE ? OR LOWER(url_pattern) LIKE ?) ORDER BY CASE WHEN url_pattern LIKE '%chinese-av%' THEN 0 ELSE 1 END LIMIT 1", (f"%{domain_base}%", f"%{src_lower}%"))
                    row = cursor.fetchone()
                    if row:
                        url_pattern, current_page, total_pages = row
                        if current_page > total_pages or current_page > 2000:
                            cursor.execute("UPDATE sync_tasks SET is_completed = 1 WHERE url_pattern = ?", (url_pattern,))
                            self.scraper.db_conn.commit()
                        else:
                            cursor.execute("UPDATE sync_tasks SET current_page = current_page + 1 WHERE url_pattern = ?", (url_pattern,))
                            self.scraper.db_conn.commit()
                            task_to_run = (url_pattern, current_page, total_pages)
                    
                if not task_to_run:
                    time.sleep(60)
                    continue
                    
                url_pattern, current_page, total_pages = task_to_run
                
                custom_log(source_name, f"⏳[Videos Thread {thread_num}] {url_pattern} page {current_page}/{total_pages}")
                new_inserted, found, extracted_total = self.scraper.sync_list_page(url_pattern, current_page)
                
                if found == -1:
                    with db_lock:
                        cursor = self.scraper.db_conn.cursor()
                        cursor.execute("UPDATE sync_tasks SET current_page = current_page - 1 WHERE url_pattern = ? AND current_page > 1", (url_pattern,))
                        self.scraper.db_conn.commit()
                    time.sleep(5)
                    continue
                    
                custom_log(source_name, f"✔️[Videos Thread {thread_num}] {url_pattern} page {current_page}/{total_pages} - {new_inserted} new, {found} found")

                with db_lock:
                    cursor = self.scraper.db_conn.cursor()
                    new_total = extracted_total if extracted_total > 0 else total_pages
                    if found == 0 or current_page >= new_total or current_page >= 2000:
                        cursor.execute("UPDATE sync_tasks SET is_completed = 1, total_pages = ?, last_fetched = ? WHERE url_pattern = ?", 
                                       (new_total, int(time.time()), url_pattern))
                    else:
                        cursor.execute("UPDATE sync_tasks SET total_pages = ?, last_fetched = ? WHERE url_pattern = ?", 
                                       (new_total, int(time.time()), url_pattern))
                    self.scraper.db_conn.commit()
                
            except Exception as e:
                custom_log("System", f"❌ Lỗi backlog scanner: {e}")
                time.sleep(5)

app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False
import logging
log = logging.getLogger('werkzeug')
log.disabled = True

scraper_instance = None
db_conn_instance = None
app_args = None

@app.before_request
def handle_options():
    global global_last_request_time
    global_last_request_time = time.time()
    if request.method == 'OPTIONS':
        resp = Response(status=204)
        resp.headers['Access-Control-Allow-Origin'] = '*'
        resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        resp.headers['Access-Control-Allow-Headers'] = request.headers.get('Access-Control-Request-Headers', '*')
        return resp

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    ip = request.remote_addr
    method = request.method
    code = response.status_code
    url = request.full_path.rstrip('?')
    custom_log("API", f"{ip} {method} {code} {url}")
    return response

def get_identifier():
    auth_header = request.headers.get('Authorization', '')
    username = None
    if auth_header.startswith('Bearer '):
        token = auth_header.split(' ')[1]
        jwt_payload = verify_jwt(token)
        if jwt_payload and 'username' in jwt_payload:
            username = jwt_payload['username']
            
    session_id = request.headers.get('Session-Id', '') or request.args.get('session_id', '')
    if not username and session_id:
        with db_lock:
            cursor = db_conn_instance.cursor()
            cursor.execute("SELECT username FROM user_sessions WHERE session_id = ?", (session_id,))
            row = cursor.fetchone()
            if row:
                username = row[0]
    return username if username else session_id

@app.route('/api/identity/me', methods=['GET'])
def identity_me():
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    token = auth_header.split(' ')[1]
    jwt_payload = verify_jwt(token)
    if not jwt_payload or 'username' not in jwt_payload:
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    
    with db_lock:
        cursor = db_conn_instance.cursor()
        cursor.execute("SELECT username, email, verified FROM identities WHERE username = ?", (jwt_payload['username'],))
        row = cursor.fetchone()
    if row:
        return jsonify({"success": True, "username": row[0], "email": row[1], "verified": bool(row[2])})
    return jsonify({"success": False, "error": "User not found"})

@app.route('/api/counts', methods=['GET'])
def get_counts():
    search_key = request.args.get('search_key', '').strip()
    identifier = get_identifier()
    
    with db_lock:
        cursor = db_conn_instance.cursor()
        search_where_v = ""
        search_params = []
        fts_join = ""
        
        if search_key:
            match_field = re.match(r'^(actress|genre|maker|title|dvd)\s*:\s*(.*)$', search_key, re.IGNORECASE)
            if match_field:
                field = match_field.group(1).lower()
                val = match_field.group(2).strip()
                safe_val = ' '.join([f'"{w}"*' for w in val.replace('"', '').split()])
                if safe_val:
                    fts_join = f" JOIN {VIDEOS_TABLE}_fts ON v.rowid = {VIDEOS_TABLE}_fts.rowid"
                    search_where_v = f"{VIDEOS_TABLE}_fts MATCH ?"
                    search_params.append(f"{field} : ({safe_val})")
            else:
                safe_key = ' '.join([f'"{w}"*' for w in search_key.replace('"', '').split()])
                if safe_key:
                    fts_join = f" JOIN {VIDEOS_TABLE}_fts ON v.rowid = {VIDEOS_TABLE}_fts.rowid"
                    search_where_v = f"{VIDEOS_TABLE}_fts MATCH ?"
                    search_params.append(safe_key)

        where_all = ("WHERE " + search_where_v) if search_where_v else ""
        cursor.execute(f"SELECT COUNT(*) FROM {VIDEOS_TABLE} v {fts_join} {where_all}", search_params)
        count_all = cursor.fetchone()[0]
        
        count_fav = 0
        count_recent = 0
        if identifier:
            where_fav = "WHERE f.username = ?" + (f" AND {search_where_v}" if search_where_v else "")
            cursor.execute(f"SELECT COUNT(*) FROM favorites f JOIN {VIDEOS_TABLE} v ON f.video_id = v.id {fts_join} {where_fav}", [identifier] + search_params)
            count_fav = cursor.fetchone()[0]
            
            where_hist = "WHERE h.username = ?" + (f" AND {search_where_v}" if search_where_v else "")
            cursor.execute(f"SELECT COUNT(*) FROM history h JOIN {VIDEOS_TABLE} v ON h.video_id = v.id {fts_join} {where_hist}", [identifier] + search_params)
            count_recent = cursor.fetchone()[0]
        
        where_glob = ("WHERE " + search_where_v) if search_where_v else ""
        cursor.execute(f"SELECT COUNT(DISTINCT h.video_id) FROM history h JOIN {VIDEOS_TABLE} v ON h.video_id = v.id {fts_join} {where_glob}", search_params)
        count_global = cursor.fetchone()[0]

    return jsonify({
        "all": count_all,
        "favorites": count_fav,
        "recent": count_recent,
        "frequent": count_recent,
        "global_frequent": count_global,
        "trending_day": 0,
        "trending_month": 0
    })

@app.route('/api/videos', methods=['GET'])
def get_videos():
    page = int(request.args.get('page', 1))
    search_key = request.args.get('search_key', '').strip()
    tab = request.args.get('tab', 'all')
    per_page = 24
    offset = (page - 1) * per_page
    identifier = get_identifier()

    with db_lock:
        cursor = db_conn_instance.cursor()
        where_clauses = []
        params = []
        from_clause = f"{VIDEOS_TABLE} v"
        
        if tab == 'favorites':
            if not identifier:
                return jsonify({"items": [], "total": 0, "page": page})
            from_clause = f"{VIDEOS_TABLE} v JOIN favorites f ON v.id = f.video_id"
            where_clauses.append("f.username = ?")
            params.append(identifier)
        elif tab in ['recent', 'frequent']:
            if not identifier:
                return jsonify({"items": [], "total": 0, "page": page})
            from_clause = f"{VIDEOS_TABLE} v JOIN history h ON v.id = h.video_id"
            where_clauses.append("h.username = ?")
            params.append(identifier)
        elif tab == 'global_frequent':
            from_clause = f"{VIDEOS_TABLE} v JOIN (SELECT video_id, SUM(watch_count) as total_watches FROM history GROUP BY video_id) h ON v.id = h.video_id"
        elif tab == 'trending_day':
            day_ago = int(time.time()) - 86400
            from_clause = f"{VIDEOS_TABLE} v JOIN (SELECT video_id, COUNT(*) as c FROM history_logs WHERE watched_at > ? GROUP BY video_id) h ON v.id = h.video_id"
            params.append(day_ago)
        elif tab == 'trending_month':
            month_ago = int(time.time()) - 30*86400
            from_clause = f"{VIDEOS_TABLE} v JOIN (SELECT video_id, COUNT(*) as c FROM history_logs WHERE watched_at > ? GROUP BY video_id) h ON v.id = h.video_id"
            params.append(month_ago)

        safe_key = ""
        if search_key:
            match_field = re.match(r'^(actress|genre|maker|title|dvd)\s*:\s*(.*)$', search_key, re.IGNORECASE)
            if match_field:
                field = match_field.group(1).lower()
                val = match_field.group(2).strip()
                safe_val = ' '.join([f'"{w}"*' for w in val.replace('"', '').split()])
                if safe_val:
                    from_clause += f" JOIN {VIDEOS_TABLE}_fts ON v.rowid = {VIDEOS_TABLE}_fts.rowid"
                    where_clauses.append(f"{VIDEOS_TABLE}_fts MATCH ?")
                    safe_key = f"{field} : ({safe_val})"
                    params.append(safe_key)
            else:
                safe_key_fmt = ' '.join([f'"{w}"*' for w in search_key.replace('"', '').split()])
                if safe_key_fmt:
                    from_clause += f" JOIN {VIDEOS_TABLE}_fts ON v.rowid = {VIDEOS_TABLE}_fts.rowid"
                    where_clauses.append(f"{VIDEOS_TABLE}_fts MATCH ?")
                    safe_key = safe_key_fmt
                    params.append(safe_key)
                
        where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
        
        if tab == 'global_frequent' and not search_key:
            cursor.execute("SELECT COUNT(DISTINCT video_id) FROM history")
            total = cursor.fetchone()[0]
        else:
            cursor.execute(f"SELECT COUNT(*) FROM {from_clause} {where_sql}", params)
            total = cursor.fetchone()[0]
            
        if tab == 'favorites':
            order_clause = "ORDER BY v.release_date DESC, f.added_at DESC"
        elif tab == 'recent':
            order_clause = "ORDER BY h.last_watched DESC, v.release_date DESC"
        elif tab == 'frequent':
            order_clause = "ORDER BY h.watch_count DESC, v.release_date DESC"
        elif tab == 'global_frequent':
            order_clause = "ORDER BY h.total_watches DESC, v.release_date DESC"
        elif tab in ['trending_day', 'trending_month']:
            order_clause = "ORDER BY h.c DESC, v.release_date DESC"
        elif safe_key:
            order_clause = f"ORDER BY v.release_date DESC, bm25({VIDEOS_TABLE}_fts, 5.0, 10.0, 2.0, 1.0, 0.5) ASC, v.added_at DESC"
        else:
            order_clause = "ORDER BY v.release_date DESC, v.added_at DESC"
            
        query = f"SELECT v.id, v.title, v.cover, v.url, v.release_date, v.actress, v.genre, v.maker, v.details, v.dvd FROM {from_clause} {where_sql} {order_clause} LIMIT ? OFFSET ?"
        cursor.execute(query, params + [per_page, offset])
        rows = cursor.fetchall()
        
    videos = []
    for row in rows:
        videos.append({
            "id": row[0],
            "title": row[1],
            "cover": f"/api/media?id={row[0]}",
            "url": row[3],
            "release_date": row[4] if len(row) > 4 else '',
            "actress": row[5] if len(row) > 5 else '',
            "genre": row[6] if len(row) > 6 else '',
            "maker": row[7] if len(row) > 7 else '',
            "details": row[8] if len(row) > 8 else '',
            "dvd": row[9] if len(row) > 9 else ''
        })
    return jsonify({"items": videos, "total": total, "page": page})

@app.route('/api/related', methods=['GET'])
def get_related():
    vid_id = request.args.get('id', '')
    if not vid_id:
        return jsonify({"items": []})
        
    with db_lock:
        cursor = db_conn_instance.cursor()
        cursor.execute(f"SELECT title, actress, genre, maker FROM {VIDEOS_TABLE} WHERE id = ?", (vid_id,))
        row = cursor.fetchone()
        
    if not row:
        return jsonify({"items": []})
        
    title, actress, genre, maker = row
    
    if hasattr(scraper_instance, 'clean_keywords'):
        keywords = scraper_instance.clean_keywords(title) if title else []
    else:
        keywords = extract_clean_keywords_bulletproof(title) if title else []
            
    query_parts = []
    if actress:
        actresses = [a.strip() for a in actress.split(',')]
        query_parts.append(' OR '.join([f'actress : "{a}"' for a in actresses if a]))
    if genre:
        genres = [g.strip() for g in genre.split(',')]
        query_parts.append(' OR '.join([f'genre : "{g}"' for g in genres if g]))
    if maker:
        query_parts.append(f'maker : "{maker}"')
        
    if keywords:
        kw_str = ' OR '.join([f'"{k}"*' for k in keywords[:5]])
        query_parts.append(f'title : ({kw_str})')
        
    fts_query = ' OR '.join([p for p in query_parts if p])
    
    if not fts_query:
        return jsonify({"items": []})
        
    with db_lock:
        cursor = db_conn_instance.cursor()
        sql = f'''
            SELECT v.id, v.title, v.cover, v.url, v.release_date, v.actress, v.genre, v.maker, v.details, v.dvd
            FROM {VIDEOS_TABLE} v
            JOIN {VIDEOS_TABLE}_fts ON v.rowid = {VIDEOS_TABLE}_fts.rowid
            WHERE {VIDEOS_TABLE}_fts MATCH ? AND v.id != ?
            ORDER BY bm25({VIDEOS_TABLE}_fts, 5.0, 10.0, 2.0, 1.0, 0.5) ASC, v.release_date DESC
            LIMIT 12
        '''
        try:
            cursor.execute(sql, (fts_query, vid_id))
            rows = cursor.fetchall()
        except Exception as e:
            custom_log("System", f"❌ FTS Related Error: {e}")
            rows = []
            
    videos = []
    for row in rows:
        videos.append({
            "id": row[0],
            "title": row[1],
            "cover": f"/api/media?id={row[0]}",
            "url": row[3],
            "release_date": row[4] if row[4] else '',
            "actress": row[5] if row[5] else '',
            "genre": row[6] if row[6] else '',
            "maker": row[7] if row[7] else '',
            "details": row[8] if row[8] else '',
            "dvd": row[9] if len(row) > 9 and row[9] else ''
        })
    return jsonify({"items": videos})

@app.route('/api/media', methods=['GET'])
def get_media():
    vid_id = request.args.get('id', '')
    
    with memory_lock:
        media_in_buffer = db_buffer['media'].get(vid_id)
    if media_in_buffer:
        return Response(media_in_buffer['data'], mimetype=media_in_buffer['content_type'] or 'image/jpeg', headers={'Cache-Control': 'public, max-age=31536000'})
        
    with db_lock:
        cursor = db_conn_instance.cursor()
        cursor.execute("SELECT data, content_type FROM media WHERE id = ?", (vid_id,))
        row = cursor.fetchone()
        
    if row:
        return Response(row[0], mimetype=row[1] or 'image/jpeg', headers={'Cache-Control': 'public, max-age=31536000'})
    else:
        cover_url = None
        with db_lock:
            cursor = db_conn_instance.cursor()
            cursor.execute(f"SELECT cover FROM {VIDEOS_TABLE} WHERE id = ?", (vid_id,))
            vrow = cursor.fetchone()
            
        if vrow and vrow[0]:
            cover_url = vrow[0]
            if cover_url.startswith('//'):
                cover_url = 'https:' + cover_url
        
        if cover_url:
            if vid_id in downloading_media:
                for _ in range(100):
                    time.sleep(0.1)
                    if vid_id not in downloading_media:
                        break
                
                with memory_lock:
                    media_in_buffer = db_buffer['media'].get(vid_id)
                if media_in_buffer:
                    return Response(media_in_buffer['data'], mimetype=media_in_buffer['content_type'] or 'image/jpeg', headers={'Cache-Control': 'public, max-age=31536000'})
            
            downloading_media.add(vid_id)
            try:
                res = scraper_instance.session.get(cover_url, headers={"Referer": getattr(scraper_instance, 'referer', '')}, timeout=10)
                if res.status_code == 200:
                    content_type = res.headers.get('Content-Type', 'image/jpeg')
                    with memory_lock:
                        db_buffer['media'][vid_id] = {
                            'data': res.content,
                            'content_type': content_type
                        }
                    return Response(res.content, mimetype=content_type, headers={'Cache-Control': 'public, max-age=31536000'})
            except Exception as e:
                pass
            finally:
                downloading_media.discard(vid_id)
                
        return Response(status=404)

@app.route('/api/proxy', methods=['GET'])
def proxy_video():
    target_url = request.args.get('url', '')
    if not target_url:
        return Response(status=400)
        
    target_url = target_url.split('#')[0]
    client_range = request.headers.get('Range')
    headers = {"Referer": getattr(scraper_instance, 'referer', '')}
        
    try:
        is_m3u8 = target_url.split('?')[0].endswith('.m3u8') or target_url.split('?')[0].endswith('.vl')
        
        if is_m3u8:
            res = scraper_instance.session.get(target_url, headers=headers, timeout=15)
            content = res.text
            base_url = target_url.rsplit('/', 1)[0] + '/'
            
            if target_url.split('?')[0].endswith('playlist.m3u8'):
                lines = content.splitlines()
                best_info = ""
                best_url = ""
                max_val = -1
                for i in range(len(lines)):
                    if lines[i].startswith('#EXT-X-STREAM-INF'):
                        match = re.search(r'RESOLUTION=\d+x(\d+)', lines[i])
                        val = int(match.group(1)) if match else 0
                        if val == 0:
                            match_bw = re.search(r'BANDWIDTH=(\d+)', lines[i])
                            val = int(match_bw.group(1)) if match_bw else 0
                        if val >= max_val and i + 1 < len(lines):
                            max_val = val
                            best_info = lines[i]
                            best_url = lines[i+1].strip()
                if best_url:
                    content = f"#EXTM3U\n{best_info}\n{best_url}"

            new_content = []
            for line in content.splitlines():
                if line.startswith('#') or not line.strip():
                    new_content.append(line)
                else:
                    if line.startswith('http'):
                        new_url = line
                    elif line.startswith('/'):
                        parsed_base = urlparse(target_url)
                        new_url = f"{parsed_base.scheme}://{parsed_base.netloc}{line}"
                    else:
                        new_url = base_url + line
                    new_content.append(f"/api/proxy?url={quote(new_url)}")
            body = '\n'.join(new_content).encode('utf-8')
            
            resp_headers = {k: v for k, v in res.headers.items() if k.lower() not in ['content-encoding', 'transfer-encoding', 'content-length', 'connection', 'access-control-allow-origin']}
            resp_headers['Access-Control-Allow-Origin'] = '*'
            resp_headers['Content-Length'] = str(len(body))
            resp_headers['Content-Type'] = 'application/x-mpegURL'
            return Response(body, status=res.status_code, headers=resp_headers)

        # Bước 1: Request 2 byte đầu tiên để lấy Content-Length và kiểm tra HTTP Range
        head_req = scraper_instance.session.get(target_url, headers={"Referer": getattr(scraper_instance, 'referer', ''), "Range": "bytes=0-1"}, timeout=10)
        
        total_size = 0
        is_range_supported = False
        
        if head_req.status_code == 206:
            cr = head_req.headers.get('Content-Range', '')
            match = re.search(r'/(\d+)', cr)
            if match:
                total_size = int(match.group(1))
                is_range_supported = True
                
        # Nếu Server không hỗ trợ tải nhiều luồng / không trả về size, dùng Proxy 1 luồng cơ bản
        if not is_range_supported or total_size == 0 or total_size < 5 * 1024 * 1024 or target_url.split('?')[0].endswith('.ts'):
            if client_range:
                headers['Range'] = client_range
            res = scraper_instance.session.get(target_url, headers=headers, timeout=15, stream=True)
            resp_headers = {k: v for k, v in res.headers.items() if k.lower() not in ['content-encoding', 'transfer-encoding', 'connection', 'access-control-allow-origin']}
            resp_headers['Access-Control-Allow-Origin'] = '*'
            
            def generate_fallback():
                try:
                    for chunk in res.iter_content(chunk_size=128*1024):
                        if chunk:
                            yield chunk
                            global global_last_request_time
                            global_last_request_time = time.time()
                except GeneratorExit:
                    pass
                finally:
                    res.close()
            return Response(generate_fallback(), status=res.status_code, headers=resp_headers)
            
        # Bước 2: Proxy Đa luồng (Hoạt động giống IDM để tăng tốc stream)
        start = 0
        end = total_size - 1
        
        if client_range:
            match = re.match(r'bytes=(\d+)-(\d*)', client_range)
            if match:
                start = int(match.group(1))
                if match.group(2): end = int(match.group(2))
                    
        if start > end or start >= total_size:
            return Response(status=416, headers={'Content-Range': f'bytes */{total_size}'})
        if end >= total_size:
            end = total_size - 1
            
        source_name_upper = getattr(scraper_instance, 'source_name', '').upper()
        if source_name_upper == 'VLXX':
            chunk_size = 2 * 1024 * 1024  # Ép xung: 2MB mỗi khối cho VLXX để kéo mảng dữ liệu lớn nhanh hơn
        else:
            chunk_size = 512 * 1024   # Ép xung: 0.5MB cho các server khác
            
        ranges_to_fetch = []
        curr = start
        while curr <= end:
            next_curr = min(curr + chunk_size - 1, end)
            ranges_to_fetch.append((curr, next_curr))
            curr = next_curr + 1
            
        resp_headers = {
            'Content-Type': head_req.headers.get('Content-Type', 'video/mp4'),
            'Accept-Ranges': 'bytes',
            'Content-Length': str(end - start + 1),
            'Access-Control-Allow-Origin': '*'
        }
        status_code = 200
        if client_range:
            status_code = 206
            resp_headers['Content-Range'] = f'bytes {start}-{end}/{total_size}'
            
        abort_event = threading.Event()
            
        def fetch_range(r):
            for _ in range(3): # Thử tối đa 3 lần nếu có lỗi tải khối này
                if abort_event.is_set():
                    return None
                try:
                    # Dùng stream=True để ngắt kết nối lập tức (I/O Blocking fix) khi client hủy
                    res = scraper_instance.session.get(target_url, headers={"Referer": getattr(scraper_instance, 'referer', ''), "Range": f"bytes={r[0]}-{r[1]}"}, timeout=15, stream=True)
                    if res.status_code in (200, 206):
                        data = bytearray()
                        for chunk in res.iter_content(chunk_size=256*1024): # Tăng đường ống ghi RAM nội bộ lên 256KB
                            if abort_event.is_set():
                                res.close()
                                return None
                            if chunk:
                                data.extend(chunk)
                        return bytes(data)
                except Exception:
                    time.sleep(1)
            return None
            
        def generate_multithread():
            global global_last_request_time
            if source_name_upper == 'VLXX':
                max_workers = 8 # Ép xung lên 8 luồng (ngưỡng an toàn tối đa của Google Photos)
                window_size = max_workers * 2 # Đệm trước 16 khối (32MB) vào RAM
            else:
                max_workers = 16 # IDM Mode: 16 luồng song song cho các nguồn bình thường
                window_size = max_workers * 2 # Đệm trước 32 khối
                
            executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
            try:
                futures = {}
                submit_idx = 0
                
                def submit_next():
                    nonlocal submit_idx
                    if submit_idx < len(ranges_to_fetch) and not abort_event.is_set():
                        futures[submit_idx] = executor.submit(fetch_range, ranges_to_fetch[submit_idx])
                        submit_idx += 1
                        
                # Khởi tạo nạp trước các khối vào hàng đợi
                for _ in range(window_size):
                    submit_next()
                    
                yield_idx = 0
                while yield_idx < len(ranges_to_fetch):
                    f = futures.pop(yield_idx)
                    data = f.result()
                    if data:
                        # Trả về từng mảnh nhỏ 128KB để player dễ dàng hiển thị dần
                        for i in range(0, len(data), 128*1024):
                            yield data[i:i+128*1024]
                            global_last_request_time = time.time()
                        
                        # Ngay khi 1 khối đã yield xong, nạp ngay khối mới để luồng nào xong việc có thể lấy chạy tiếp
                        submit_next()
                        yield_idx += 1
                    else:
                        break # Ngắt quá trình stream nếu gặp block lỗi nặng hoặc client abort
            except GeneratorExit:
                abort_event.set()
            finally:
                abort_event.set()
                if sys.version_info >= (3, 9): executor.shutdown(wait=False, cancel_futures=True)
                else: executor.shutdown(wait=False)
                
        return Response(generate_multithread(), status=status_code, headers=resp_headers)
    except Exception as e:
        custom_log("System", f"❌ Error fetching {target_url}: {e}")
        return Response(status=500)

@app.route('/api/sync', methods=['GET'])
def sync_api():
    domain_base = scraper_instance.domain.split('.')[0].lower()
    source_name = getattr(scraper_instance, 'source_name', '').lower()
    with db_lock:
        cursor = db_conn_instance.cursor()
        cursor.execute("SELECT url_pattern FROM sync_tasks")
        cursor.execute("SELECT url_pattern FROM sync_tasks WHERE LOWER(url_pattern) LIKE ? OR LOWER(url_pattern) LIKE ?", (f"%{domain_base}%", f"%{source_name}%"))
        tasks = cursor.fetchall()
    for task in tasks:
        scraper_instance.sync_list_page(task[0], 1)
    return jsonify({"success": True})

@app.route('/api/video_url', methods=['GET'])
def video_url_api():
    vid_id = request.args.get('id', '')
    force_refresh = request.args.get('refresh', '0').lower() in ['1', 'true', 'yes']
    url = scraper_instance.get_video_url(vid_id, force_refresh=force_refresh)
    if url:
        return jsonify({"success": True, "url": url})
    return jsonify({"success": False, "error": "Cannot extract URL"})

@app.route('/api/video_details', methods=['GET'])
def video_details_api():
    vid_id = request.args.get('id', '')
    if not vid_id:
        return jsonify({"success": False, "error": "Missing id"})
    
    with db_lock:
        cursor = db_conn_instance.cursor()
        cursor.execute(f"SELECT id, title, cover, url, release_date, actress, genre, maker, details, dvd FROM {VIDEOS_TABLE} WHERE id = ?", (vid_id,))
        row = cursor.fetchone()
        
    if row:
        return jsonify({
            "success": True,
            "data": {
                "id": row[0],
                "title": row[1],
                "cover": f"/api/media?id={row[0]}",
                "url": row[3],
                "release_date": row[4] if row[4] else '',
                "actress": row[5] if row[5] else '',
                "genre": row[6] if row[6] else '',
                "maker": row[7] if row[7] else '',
                "details": row[8] if row[8] else '',
                "dvd": row[9] if row[9] else ''
            }
        })
    return jsonify({"success": False, "error": "Not found"})

@app.route('/api/search_suggestions', methods=['GET'])
def search_suggestions():
    q = request.args.get('q', '').strip().lower()
    identifier = get_identifier()
    suggestions = []
    
    with db_lock:
        cursor = db_conn_instance.cursor()
        if identifier:
            if not q:
                cursor.execute("SELECT keyword FROM search_history WHERE username = ? ORDER BY searched_at DESC LIMIT 10", (identifier,))
            else:
                cursor.execute("SELECT keyword FROM search_history WHERE username = ? AND keyword LIKE ? ORDER BY searched_at DESC LIMIT 10", (identifier, f'%{q}%'))
            for r in cursor.fetchall():
                suggestions.append({"text": r[0], "type": "history"})
            
    if not q:
        with db_lock:
            cursor = db_conn_instance.cursor()
            cursor.execute("SELECT keyword FROM tags_summary WHERE type='actress' ORDER BY count DESC LIMIT 10")
            for r in cursor.fetchall(): suggestions.append({"text": r[0], "type": "actress"})
            
            cursor.execute("SELECT keyword FROM tags_summary WHERE type='genre' ORDER BY count DESC LIMIT 10")
            for r in cursor.fetchall(): suggestions.append({"text": r[0], "type": "genre"})
            
            cursor.execute("SELECT keyword FROM tags_summary WHERE type='maker' ORDER BY count DESC LIMIT 10")
            for r in cursor.fetchall(): suggestions.append({"text": r[0], "type": "maker"})
            
        return jsonify({"success": True, "suggestions": suggestions})
    
    else:
        words = q.replace('"', '').split()
        if not words:
            return jsonify({"success": True, "suggestions": suggestions})
            
        safe_key_and = ' AND '.join([f'"{w}"*' for w in words])
        safe_key_or = ' OR '.join([f'"{w}"*' for w in words])
        
        with db_lock:
            cursor = db_conn_instance.cursor()
            try:
                cursor.execute('''
                    SELECT keyword, type, count
                    FROM tags_fts
                    WHERE tags_fts MATCH ?
                    ORDER BY count DESC
                    LIMIT 30
                ''', (safe_key_and,))
                tag_rows = cursor.fetchall()
            except Exception as e:
                custom_log("System", f"❌ FTS tags search error: {e}")
                tag_rows = []
                
            # Fuzzy Search (Tìm kiếm mờ) bổ sung nếu FTS không trả về đủ kết quả
            if len(tag_rows) < 15:
                load_tags_cache_if_needed(cursor)
                seen_tags = set([r[0] for r in tag_rows])
                q_low = q.lower()
                q_sorted = " ".join(sorted(q_low.split()))
                q_words = q_low.split()
                
                fuzzy_matches = []
                for kw, t, c, low, sorted_low in tags_cache:
                    if kw in seen_tags:
                        continue
                    # Nếu chứa chuỗi hoặc chứa đủ các từ khóa, gán điểm tuyệt đối
                    if q_low in low:
                        fuzzy_matches.append((1.0, c, kw, t))
                    elif all(w in low for w in q_words):
                        fuzzy_matches.append((0.95, c, kw, t))
                    else:
                        # Dùng difflib đo độ tương đồng, ngưỡng >= 0.75 để chặn nhiễu
                        matcher = difflib.SequenceMatcher(None, q_sorted, sorted_low)
                        if matcher.quick_ratio() >= 0.75:
                            score = matcher.ratio()
                            if score >= 0.75:
                                fuzzy_matches.append((score, c, kw, t))
                                
                fuzzy_matches.sort(key=lambda x: (x[0], x[1]), reverse=True)
                for score, c, kw, t in fuzzy_matches[:15]:
                    tag_rows.append((kw, t, c))
                    seen_tags.add(kw)

            match_actress = []
            match_genre = []
            match_maker = []
            match_title = []
            
            for row in tag_rows:
                k, t, c = row
                if t == 'actress': match_actress.append({"text": k, "count": c})
                elif t == 'genre': match_genre.append({"text": k, "count": c})
                elif t == 'maker': match_maker.append({"text": k, "count": c})
                
            try:
                cursor.execute(f'''
                    SELECT v.title, v.id, v.cover
                    FROM {VIDEOS_TABLE} v
                    JOIN {VIDEOS_TABLE}_fts ON v.rowid = {VIDEOS_TABLE}_fts.rowid
                    WHERE {VIDEOS_TABLE}_fts MATCH ?
                    ORDER BY bm25({VIDEOS_TABLE}_fts, 5.0, 10.0, 2.0, 1.0, 0.5) ASC LIMIT 10
                ''', (f"title : ({safe_key_or})",))
                for row in cursor.fetchall():
                    t = row[0].strip()
                    if t:
                        match_title.append({
                            "text": t[:80] + ("..." if len(t)>80 else ""), 
                            "type": "title", 
                            "id": row[1],
                            "cover": f"/api/media?id={row[1]}"
                        })
            except Exception as e:
                custom_log("System", f"❌ FTS title search error: {e}")
                
        chips = []
        for a in match_actress[:5]: chips.append({"text": a["text"], "type": "actress"})
        for g in match_genre[:5]: chips.append({"text": g["text"], "type": "genre"})
        for m in match_maker[:5]: chips.append({"text": m["text"], "type": "maker"})
            
        for c in chips[:10]:
            suggestions.append(c)
            
        for t in match_title:
            suggestions.append(t)
            
        return jsonify({"success": True, "suggestions": suggestions})

@app.route('/api/search_history', methods=['POST', 'DELETE'])
def manage_search_history():
    identifier = get_identifier()
    if not identifier:
        return jsonify({"success": False, "error": "Unauthorized"}), 401
        
    payload = request.get_json(silent=True) or {}
    keyword = payload.get('keyword', '').strip()
    
    if not keyword:
        return jsonify({"success": False, "error": "Missing keyword"}), 400
        
    if request.method == 'POST':
        now_ts = int(time.time())
        with db_lock:
            cursor = db_conn_instance.cursor()
            cursor.execute("INSERT OR REPLACE INTO search_history (username, keyword, searched_at) VALUES (?, ?, ?)", (identifier, keyword, now_ts))
            cursor.execute("DELETE FROM search_history WHERE username = ? AND keyword IN (SELECT keyword FROM search_history WHERE username = ? ORDER BY searched_at DESC LIMIT -1 OFFSET 20)", (identifier, identifier))
            db_conn_instance.commit()
        return jsonify({"success": True})
        
    elif request.method == 'DELETE':
        with db_lock:
            cursor = db_conn_instance.cursor()
            cursor.execute("DELETE FROM search_history WHERE username = ? AND keyword = ?", (identifier, keyword))
            db_conn_instance.commit()
        return jsonify({"success": True})

@app.route('/api/identity/check', methods=['POST'])
def identity_check():
    payload = request.get_json(silent=True) or {}
    query = payload.get('query', '').strip()
    with db_lock:
        cursor = db_conn_instance.cursor()
        cursor.execute("SELECT username FROM identities WHERE username = ? OR email = ?", (query, query))
        row = cursor.fetchone()
    return jsonify({"exists": bool(row)})

@app.route('/api/identity/send_otp', methods=['POST'])
def identity_send_otp():
    payload = request.get_json(silent=True) or {}
    query = payload.get('query', '').strip()
    with db_lock:
        cursor = db_conn_instance.cursor()
        cursor.execute("SELECT email FROM identities WHERE username = ? OR email = ?", (query, query))
        row = cursor.fetchone()
    if not row or not row[0]:
        return jsonify({"success": False, "error": "Tài khoản không tồn tại hoặc chưa liên kết email."})
    
    user_email = row[0]
    import random
    otp = str(random.randint(100000, 999999))
    expire = int(time.time()) + 300
    with db_lock:
        cursor = db_conn_instance.cursor()
        cursor.execute("UPDATE identities SET otp = ?, otp_expire = ? WHERE email = ?", (otp, expire, user_email))
        db_conn_instance.commit()
    
    args_email = getattr(app_args, 'email', None)
    args_email_pass = getattr(app_args, 'emailPass', None)
        
    if not args_email or not args_email_pass:
        return jsonify({"success": False, "error": "Server chưa cấu hình email."})
        
    try:
        import smtplib
        from email.mime.text import MIMEText
        msg = MIMEText(f"Mã OTP đăng nhập của bạn là: {otp}\nCó hiệu lực trong 5 phút.")
        msg['Subject'] = 'Mã OTP Định Danh Javtiful Player'
        msg['From'] = args_email
        msg['To'] = user_email
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(args_email, args_email_pass.strip())
        server.send_message(msg)
        server.quit()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route('/api/identity/register', methods=['POST'])
def identity_register():
    payload = request.get_json(silent=True) or {}
    username = payload.get('username', '').strip()
    password = payload.get('password', '')
    session_id = payload.get('session_id', '') or request.headers.get('Session-Id', '')
    
    if not username or not password:
        return jsonify({"success": False, "error": "Thiếu thông tin."})
        
    with db_lock:
        cursor = db_conn_instance.cursor()
                
        try:
            cursor.execute("INSERT INTO identities (username, email, password, session_id, created_at, verified) VALUES (?, ?, ?, ?, ?, ?)", 
                           (username, None, password, session_id, int(time.time()), 0))
            if session_id:
                cursor.execute("INSERT OR REPLACE INTO user_sessions (username, session_id) VALUES (?, ?)", (username, session_id))
                cursor.execute("UPDATE OR IGNORE history SET username = ? WHERE username = ?", (username, session_id))
                cursor.execute("DELETE FROM history WHERE username = ?", (session_id,))
                cursor.execute("UPDATE OR IGNORE favorites SET username = ? WHERE username = ?", (username, session_id))
                cursor.execute("DELETE FROM favorites WHERE username = ?", (session_id,))
            db_conn_instance.commit()
            token = create_jwt({"username": username})
            return jsonify({"success": True, "username": username, "token": token})
        except sqlite3.IntegrityError:
            return jsonify({"success": False, "error": "Username đã tồn tại."})

@app.route('/api/identity/login', methods=['POST'])
def identity_login():
    payload = request.get_json(silent=True) or {}
    query = payload.get('query', '').strip()
    password = payload.get('password', '')
    otp = payload.get('otp', '')
    session_id = payload.get('session_id', '') or request.headers.get('Session-Id', '')
    
    with db_lock:
        cursor = db_conn_instance.cursor()
        if password:
            cursor.execute("SELECT username FROM identities WHERE (username = ? OR email = ?) AND password = ?", (query, query, password))
            row = cursor.fetchone()
            if row:
                cursor.execute("UPDATE identities SET session_id = ? WHERE username = ?", (session_id, row[0]))
                if session_id:
                    cursor.execute("INSERT OR REPLACE INTO user_sessions (username, session_id) VALUES (?, ?)", (row[0], session_id))
                    cursor.execute("UPDATE OR IGNORE history SET username = ? WHERE username = ?", (row[0], session_id))
                    cursor.execute("DELETE FROM history WHERE username = ?", (session_id,))
                    cursor.execute("UPDATE OR IGNORE favorites SET username = ? WHERE username = ?", (row[0], session_id))
                    cursor.execute("DELETE FROM favorites WHERE username = ?", (session_id,))
                db_conn_instance.commit()
                token = create_jwt({"username": row[0]})
                return jsonify({"success": True, "username": row[0], "token": token})
            else:
                return jsonify({"success": False, "error": "Sai thông tin đăng nhập."})
        elif otp:
            cursor.execute("SELECT username, otp_expire FROM identities WHERE (username = ? OR email = ?) AND otp = ?", (query, query, otp))
            row = cursor.fetchone()
            if row:
                if row[1] < int(time.time()):
                    return jsonify({"success": False, "error": "OTP đã hết hạn."})
                else:
                    cursor.execute("UPDATE identities SET session_id = ?, otp = NULL, verified = 1 WHERE username = ?", (session_id, row[0]))
                    if session_id:
                        cursor.execute("INSERT OR REPLACE INTO user_sessions (username, session_id) VALUES (?, ?)", (row[0], session_id))
                        cursor.execute("UPDATE OR IGNORE history SET username = ? WHERE username = ?", (row[0], session_id))
                        cursor.execute("DELETE FROM history WHERE username = ?", (session_id,))
                        cursor.execute("UPDATE OR IGNORE favorites SET username = ? WHERE username = ?", (row[0], session_id))
                        cursor.execute("DELETE FROM favorites WHERE username = ?", (session_id,))
                    db_conn_instance.commit()
                    token = create_jwt({"username": row[0]})
                    return jsonify({"success": True, "username": row[0], "token": token})
            else:
                return jsonify({"success": False, "error": "OTP không hợp lệ."})
        else:
            return jsonify({"success": False, "error": "Thiếu password hoặc OTP."})

@app.route('/api/identity/verify_email', methods=['POST'])
def identity_verify_email():
    payload = request.get_json(silent=True) or {}
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    token = auth_header.split(' ')[1]
    jwt_payload = verify_jwt(token)
    if not jwt_payload or 'username' not in jwt_payload:
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    
    username = jwt_payload['username']
    otp = payload.get('otp', '')
    
    with db_lock:
        cursor = db_conn_instance.cursor()
        cursor.execute("SELECT otp_expire FROM identities WHERE username = ? AND otp = ?", (username, otp))
        row = cursor.fetchone()
        if row:
            if row[0] < int(time.time()):
                return jsonify({"success": False, "error": "OTP đã hết hạn."})
            else:
                cursor.execute("UPDATE identities SET otp = NULL, verified = 1 WHERE username = ?", (username,))
                db_conn_instance.commit()
                return jsonify({"success": True})
        else:
            return jsonify({"success": False, "error": "OTP không hợp lệ."})

@app.route('/api/identity/update_profile', methods=['POST'])
def identity_update_profile():
    payload = request.get_json(silent=True) or {}
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    token = auth_header.split(' ')[1]
    jwt_payload = verify_jwt(token)
    if not jwt_payload or 'username' not in jwt_payload:
        return jsonify({"success": False, "error": "Unauthorized"}), 401
        
    current_username = jwt_payload['username']
    new_password = payload.get('password', '')
    new_email = payload.get('email', '').strip()
    
    with db_lock:
        cursor = db_conn_instance.cursor()
        try:
            if new_email:
                cursor.execute("SELECT username FROM identities WHERE email = ? AND username != ?", (new_email, current_username))
                if cursor.fetchone():
                    return jsonify({"success": False, "error": "Email đã được sử dụng."})
                    
                cursor.execute("SELECT email FROM identities WHERE username = ?", (current_username,))
                row = cursor.fetchone()
                if not row or row[0] != new_email:
                    cursor.execute("UPDATE identities SET email = ?, verified = 0 WHERE username = ?", (new_email, current_username))
                    
            if new_password:
                cursor.execute("SELECT verified FROM identities WHERE username = ?", (current_username,))
                v_row = cursor.fetchone()
                if not v_row or v_row[0] != 1:
                    return jsonify({"success": False, "error": "Cần xác thực email để đổi mật khẩu."})
                cursor.execute("UPDATE identities SET password = ? WHERE username = ?", (new_password, current_username))
            db_conn_instance.commit()
            return jsonify({"success": True})
        except Exception as e:
            return jsonify({"success": False, "error": str(e)})

@app.route('/api/identity/reset_password', methods=['POST'])
def identity_reset_password():
    payload = request.get_json(silent=True) or {}
    query = payload.get('query', '').strip()
    otp = payload.get('otp', '')
    new_password = payload.get('new_password', '')
    
    with db_lock:
        cursor = db_conn_instance.cursor()
        cursor.execute("SELECT username, otp_expire FROM identities WHERE (username = ? OR email = ?) AND otp = ?", (query, query, otp))
        row = cursor.fetchone()
        if row:
            if row[1] < int(time.time()):
                return jsonify({"success": False, "error": "OTP đã hết hạn."})
            else:
                cursor.execute("UPDATE identities SET password = ?, otp = NULL, verified = 1 WHERE username = ?", (new_password, row[0]))
                db_conn_instance.commit()
                return jsonify({"success": True})
        else:
            return jsonify({"success": False, "error": "OTP không hợp lệ."})

@app.route('/api/favorites/toggle', methods=['POST'])
def favorites_toggle():
    payload = request.get_json(silent=True) or {}
    identifier = get_identifier()
    if not identifier:
        return jsonify({"success": False, "error": "Unauthorized"}), 401
        
    video_id = payload.get('video_id')
    action = payload.get('action', 'toggle')
    with db_lock:
        cursor = db_conn_instance.cursor()
        cursor.execute("SELECT 1 FROM favorites WHERE username = ? AND video_id = ?", (identifier, video_id))
        exists = cursor.fetchone()
        if exists:
            if action == 'add':
                return jsonify({"success": True, "added": True})
            cursor.execute("DELETE FROM favorites WHERE username = ? AND video_id = ?", (identifier, video_id))
            db_conn_instance.commit()
            return jsonify({"success": True, "added": False})
        else:
            if action == 'remove':
                return jsonify({"success": True, "added": False})
            now_dt = time.strftime('%Y-%m-%d %H:%M:%S')
            cursor.execute("INSERT INTO favorites (username, video_id, added_at) VALUES (?, ?, ?)", (identifier, video_id, now_dt))
            db_conn_instance.commit()
            return jsonify({"success": True, "added": True})

@app.route('/api/favorites/status', methods=['GET'])
def favorites_status():
    identifier = get_identifier()
    if not identifier:
        return jsonify({"is_favorited": False})
        
    video_id = request.args.get('video_id')
    with db_lock:
        cursor = db_conn_instance.cursor()
        cursor.execute("SELECT 1 FROM favorites WHERE username = ? AND video_id = ?", (identifier, video_id))
        exists = cursor.fetchone()
    return jsonify({"is_favorited": bool(exists)})

@app.route('/api/history/record', methods=['POST'])
def history_record():
    payload = request.get_json(silent=True) or {}
    identifier = get_identifier()
    if not identifier:
        return jsonify({"success": False, "error": "No identifier provided"}), 400
        
    video_id = payload.get('video_id')
    now_ts = int(time.time())
    with db_lock:
        cursor = db_conn_instance.cursor()
        cursor.execute("SELECT watch_count FROM history WHERE username = ? AND video_id = ?", (identifier, video_id))
        row = cursor.fetchone()
        if row:
            cursor.execute("UPDATE history SET watch_count = ?, last_watched = ? WHERE username = ? AND video_id = ?", (row[0] + 1, now_ts, identifier, video_id))
        else:
            cursor.execute("INSERT INTO history (username, video_id, watch_count, last_watched) VALUES (?, ?, ?, ?)", (identifier, video_id, 1, now_ts))
            
        cursor.execute("INSERT INTO history_logs (video_id, watched_at) VALUES (?, ?)", (video_id, now_ts))
        db_conn_instance.commit()
        return jsonify({"success": True})

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_html(path):
    try:
        html_path = 'index.html'
        if not os.path.isabs(html_path):
            html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), html_path)
        with open(html_path, 'rb') as f:
            content = f.read()

        if app_args and hasattr(app_args, 'source'):
            source_name = app_args.source.capitalize()
            new_title = f"{source_name} Player"
            content = re.sub(b'<title>.*?</title>', f'<title>{new_title}</title>'.encode('utf-8'), content, count=1, flags=re.IGNORECASE)

        return Response(content, mimetype='text/html; charset=utf-8')
    except Exception as e:
        return Response(f"HTML not found: index.html ({e})", status=404)

def migrate_old_database(db_conn, old_db_path):
    if not os.path.exists(old_db_path):
        custom_log("System", f"⚠️ Không tìm thấy file database cũ tại {old_db_path}")
        return
# 
    custom_log("System", f"⏳ Đang gắn (attach) database cũ từ {old_db_path}...")
    try:
        cursor = db_conn.cursor()
        cursor.execute("ATTACH DATABASE ? AS old_db", (old_db_path,))
        
        tables_to_sync = [
            VIDEOS_TABLE, 'media', 'identities', 'user_sessions', 
            'favorites', 'history', 'sync_tasks', 'history_logs', 'search_history'
        ]
        
        for table in tables_to_sync:
            custom_log("System", f"⏳ Đang đồng bộ bảng: {table}...")
            try:
                cursor.execute(f"PRAGMA table_info({table})")
                new_cols = [row[1] for row in cursor.fetchall()]
                
                cursor.execute(f"PRAGMA old_db.table_info({table})")
                old_cols = [row[1] for row in cursor.fetchall()]
                
                if not old_cols:
                    custom_log("System", f"⚠️ Bảng {table} không tồn tại trong DB cũ, bỏ qua.")
                    continue
                    
                common_cols = [col for col in new_cols if col in old_cols]
                cols_str = ", ".join(common_cols)
                
                cursor.execute(f"INSERT OR IGNORE INTO {table} ({cols_str}) SELECT {cols_str} FROM old_db.{table}")
                db_conn.commit()
                custom_log("System", f"✔️ Đã đồng bộ bảng {table}.")
            except Exception as e:
                custom_log("System", f"❌ Lỗi khi đồng bộ bảng {table}: {e}")
        
        cursor.execute("DETACH DATABASE old_db")
        custom_log("System", "✔️ Hoàn tất đồng bộ dữ liệu từ database cũ!")
    except Exception as e:
        custom_log("System", f"❌ Lỗi trong quá trình migration: {e}")

def start_reloader():
    import glob
    def get_mtimes():
        base_dir = os.path.dirname(os.path.abspath(__file__)) or '.'
        files = [__file__] + glob.glob(os.path.join(base_dir, 'source-*.py'))
        mtimes = {}
        for f in files:
            try: mtimes[f] = os.path.getmtime(f)
            except OSError: pass
        return mtimes

    def reloader_thread():
        mtimes = get_mtimes()
        while True:
            time.sleep(2)
            if get_mtimes() != mtimes:
                custom_log("System", "⚠️ Phát hiện thay đổi code, tự động khởi động lại...")
                os.execv(sys.executable, [sys.executable] + sys.argv)
    threading.Thread(target=reloader_thread, daemon=True).start()

def load_source_module(source_name):
    file_path = f"./source-{source_name}.py"
    if not os.path.exists(file_path):
        custom_log("System", f"❌ Lỗi: Không tìm thấy file {file_path}")
        sys.exit(1)
    
    spec = importlib.util.spec_from_file_location(f"source_{source_name}", file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module

def system_monitor_worker():
    try: import psutil
    except ImportError: return
    while True:
        try:
            cpu = psutil.cpu_percent(interval=None)
            process = psutil.Process(os.getpid())
            ram_mb = process.memory_info().rss / 1048576.0
            nltk_mb = sys.getsizeof(sys.modules.get('nltk')) / 1048576.0 if 'nltk' in sys.modules else 0.0
            custom_log("System", f"✔️RAM chiếm dụng: {ram_mb:.2f}M | NLTK: {nltk_mb:.2f}M | CPU: {cpu}%")
        except Exception: pass
        time.sleep(5)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('-port', type=int, default=5004, help="Port to run the HTTP server on")
    parser.add_argument('-sqlite3', type=str, default=None, help="Path to the SQLite3 database file")
    parser.add_argument('-upgrade-all', action='store_true', help="Start scanning from page 1 instead of backlog")
    parser.add_argument('-emailPass', type=str, default="szywozapustydcuw", help="App password for email")
    parser.add_argument('-email', type=str, default="infor.dkeeps@gmail.com", help="Email to send OTP from")
    parser.add_argument('-old-sqlite3', type=str, default="", help="Path to an old SQLite3 database to migrate data from")
    parser.add_argument('-limit-bufer', '-limit-buffer', type=str, default='200M', dest='limit_buffer', help="Limit memory buffer size to avoid Termux killing the process")
    parser.add_argument('-source', type=str, default='javtiful', help="Nguồn crawl dữ liệu (ví dụ: javtiful, missav)")
    parser.add_argument('-news-threads', type=int, default=0, help="Số luồng quét video mới (mặc định 0)")
    parser.add_argument('-detail-threads', type=int, default=0, help="Số luồng lấy chi tiết video (mặc định 0)")
    parser.add_argument('-videos-threads', type=int, default=0, help="Số luồng quét video backlog (mặc định 0)")
    parser.add_argument('-domain', type=str, default=None, help="Tên miền (domain) cho scraper")
    
    args = parser.parse_args()
    
    if '-port' not in sys.argv and args.source == 'vlxx':
        args.port = 5005

    if args.sqlite3 is None:
        if os.name == 'nt':
            args.sqlite3 = f"D:\\Database\\{args.source}.db"
        else:
            args.sqlite3 = f"/sdcard/Projects/Database/{args.source}.db"
    
    global db_conn_instance, scraper_instance, app_args, VIDEOS_TABLE
    app_args = args
    VIDEOS_TABLE = f"{args.source}_videos"
    
    # Xóa cache trong bộ nhớ khi khởi động hoặc tải lại để đảm bảo không có dữ liệu cũ
    global tags_cache
    with memory_lock:
        db_buffer['videos'].clear()
        db_buffer['video_urls'].clear()
        db_buffer['media'].clear()
    downloading_media.clear()
    tags_cache = []
    custom_log("System", "✔️ Đã xóa cache trong bộ nhớ khi khởi động.")

    start_reloader()
    threading.Thread(target=system_monitor_worker, daemon=True).start()
    
    source_module = load_source_module(args.source)
    db_conn_instance = get_db_connection(args.sqlite3, args.limit_buffer, source_module)
    if args.old_sqlite3:
        migrate_old_database(db_conn_instance, args.old_sqlite3)
        
    rebuild_tags_fts(db_conn_instance)
    
    scraper_instance = source_module.Scraper(db_conn_instance, db_lock, memory_lock, db_buffer, VIDEOS_TABLE, domain=args.domain)
    threading.Thread(target=background_db_worker, args=(db_conn_instance,), daemon=True).start()
    scanner = BackgroundScanner(
        scraper_instance, 
        upgrade_all=args.upgrade_all,
        news_threads=args.news_threads,
        detail_threads=args.detail_threads,
        videos_threads=args.videos_threads
    )
    scanner.start()
    custom_log("System", f"✔️ {args.source.capitalize()} Player worker started at http://localhost:{args.port}")
        
    def graceful_exit(sig, frame):
        custom_log("System", "⚠️ Nhận tín hiệu dừng (Ctrl+C), đang lưu dữ liệu an toàn...")
        if db_conn_instance:
            flush_db_buffer(db_conn_instance)
            try: db_conn_instance.close()
            except Exception: pass
        custom_log("System", "✔️ Đã thoát an toàn.")
        sys.exit(0)
        
    signal.signal(signal.SIGINT, graceful_exit)
    signal.signal(signal.SIGTERM, graceful_exit)

    try:
        app.run(host='0.0.0.0', port=args.port, threaded=True, use_reloader=False)
    except KeyboardInterrupt:
        graceful_exit(None, None)

if __name__ == '__main__':
    main()