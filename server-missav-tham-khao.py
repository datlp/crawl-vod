import argparse
import os
import sys
import time
import json
import re
import sqlite3
import base64
import hmac
import hashlib
import threading
from urllib.parse import urlparse, parse_qs, quote
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from curl_cffi import requests as curl_requests
from bs4 import BeautifulSoup

global_last_request_time = time.time()
CLIENT_IDLE_TIMEOUT = 60

memory_lock = threading.Lock()
db_lock = threading.Lock()
db_buffer = {
    'videos': {},
    'video_urls': {},
    'media': {}
}
downloading_media = set()

JWT_SECRET = "missav-player-secret-key-2026"

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
                cursor.execute('''
                    INSERT INTO missav_videos (id, title, cover, added_at, release_date)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        title = excluded.title,
                        cover = excluded.cover,
                        added_at = excluded.added_at,
                        release_date = excluded.release_date
                ''', (vid['id'], vid['title'], vid['cover'], vid['added_at'], vid.get('release_date', '')))
                
            for vid_id, url in urls_to_save.items():
                cursor.execute("UPDATE missav_videos SET url = ? WHERE id = ?", (url, vid_id))
                
            for media_id, m in media_to_save.items():
                cursor.execute("INSERT OR REPLACE INTO media (id, data, content_type) VALUES (?, ?, ?)", (media_id, m['data'], m['content_type']))
                
            db_conn.commit()
    except Exception as e:
        print(f"Lỗi khi ghi DB: {e}")
        with memory_lock:
            for vid_id, vid in videos_to_save.items():
                if vid_id not in db_buffer['videos']: db_buffer['videos'][vid_id] = vid
            for vid_id, url in urls_to_save.items():
                if vid_id not in db_buffer['video_urls']: db_buffer['video_urls'][vid_id] = url
            for media_id, m in media_to_save.items():
                if media_id not in db_buffer['media']: db_buffer['media'][media_id] = m

def background_db_worker(db_conn):
    while True:
        time.sleep(5)
        flush_db_buffer(db_conn)

def get_db_connection(db_path):
    os.makedirs(os.path.dirname(os.path.abspath(db_path)) or '.', exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute('PRAGMA journal_mode=WAL;')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS missav_videos (
            id TEXT PRIMARY KEY,
            title TEXT,
            cover TEXT,
            url TEXT,
            added_at INTEGER,
            release_date TEXT
        )
    ''')
    try:
        conn.execute('ALTER TABLE missav_videos ADD COLUMN release_date TEXT')
    except sqlite3.OperationalError:
        pass
    
    for col in ['actress', 'genre', 'maker', 'details']:
        try:
            conn.execute(f'ALTER TABLE missav_videos ADD COLUMN {col} TEXT')
        except sqlite3.OperationalError:
            pass
            
    try:
        conn.execute('ALTER TABLE missav_videos ADD COLUMN details_fetched INTEGER DEFAULT 0')
    except sqlite3.OperationalError:
        pass
        
    conn.execute('CREATE INDEX IF NOT EXISTS idx_missav_videos_details_fetched ON missav_videos(details_fetched, added_at ASC)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_missav_videos_search_actress ON missav_videos(actress)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_missav_videos_search_genre ON missav_videos(genre)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_missav_videos_search_maker ON missav_videos(maker)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_missav_videos_search_details ON missav_videos(details)')

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
            otp_expire INTEGER
        )
    ''')
    try:
        conn.execute('ALTER TABLE identities ADD COLUMN created_at INTEGER')
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute('ALTER TABLE identities ADD COLUMN verified INTEGER DEFAULT 0')
    except sqlite3.OperationalError:
        pass
        
    conn.execute('''
        CREATE TABLE IF NOT EXISTS user_sessions (
            username TEXT,
            session_id TEXT PRIMARY KEY
        )
    ''')
    conn.commit()

    conn.execute('''
        CREATE TABLE IF NOT EXISTS favorites (
            username TEXT,
            video_id TEXT,
            added_at INTEGER,
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
    
    return conn

class MissavScraper:
    def __init__(self, db_conn):
        self.db_conn = db_conn
        # Không ghi đè User-Agent và Accept. Để curl_cffi tự sinh headers khớp với TLS fingerprint
        # Nâng cấp impersonate lên bản chrome mới hơn (yêu cầu curl_cffi bản mới)
        self.session = curl_requests.Session(impersonate="chrome120")
        self.sync_lock = threading.Lock()
        
    def update_sync_tasks_from_menu(self):
        print("[Scraper] Đang quét toàn bộ header/menu để lấy sync_tasks...")
        try:
            res = self.session.get("https://missav.ai/en", timeout=15)
            soup = BeautifulSoup(res.text, 'html.parser')
            
            nav_links = soup.find_all('a')
            tasks_found = set()
            
            # Pattern: bắt đầu bằng http(s)://(domain)/dm(số)/en/(loại)
            url_pattern_regex = re.compile(r'^(https?://[^/]+/dm\d+/en/([a-zA-Z0-9_-]+))(?:[#?].*)?$')
            
            for a in nav_links:
                href = a.get('href')
                if href:
                    if href.startswith('/'):
                        parsed_res = urlparse(res.url)
                        href = f"{parsed_res.scheme}://{parsed_res.netloc}{href}"
                        
                    match = url_pattern_regex.match(href)
                    if match:
                        base_url = match.group(1)
                        category_type = match.group(2)
                        
                        # Bỏ qua nếu có vẻ là link video cụ thể (chứa số và gạch ngang, ID dài hơn bình thường)
                        if len(category_type) > 15 and re.search(r'\d', category_type) and '-' in category_type:
                            continue
                            
                        task_url = base_url + "?page={page}"
                        tasks_found.add(task_url)
                        
            if tasks_found:
                with db_lock:
                    cursor = self.db_conn.cursor()
                    for url in tasks_found:
                        cursor.execute("INSERT OR IGNORE INTO sync_tasks (url_pattern) VALUES (?)", (url,))
                    self.db_conn.commit()
                print(f"[Scraper] Đã tự động cập nhật {len(tasks_found)} categories (sync_tasks) từ menu.")
        except Exception as e:
            print(f"[Scraper] Lỗi khi quét menu để cập nhật sync_tasks: {e}")

    def sync_list_page(self, url_pattern, page):
        with self.sync_lock:
            return self._sync_list_page(url_pattern, page)
            
    def _sync_list_page(self, url_pattern, page):
        url = url_pattern.replace("{page}", str(page))
        if page == 1 and "?page=1" in url:
            url = url.replace("?page=1", "")
            
        print(f"[Scraper] Syncing {url}")
        try:
            res = self.session.get(url, timeout=15)
            soup = BeautifulSoup(res.text, 'html.parser')
            videos = []
            
            total_pages = 0
            # Tìm total_pages trong class pagination
            pagination = soup.select('ul.pagination li a')
            for a in pagination:
                try:
                    num = int(a.text.strip())
                    if num > total_pages:
                        total_pages = num
                except:
                    pass
                    
            # Tìm theo mẫu số / số (page / total)
            total_match = re.search(r'(?:Page\s*)?\d+\s*/\s*(\d+)', res.text, re.IGNORECASE)
            if total_match:
                try:
                    total_pages = max(total_pages, int(total_match.group(1)))
                except:
                    pass

            items = soup.select('div.thumbnail')
            now = int(time.time())
            for idx, item in enumerate(items):
                a_tag = item.select_one('a')
                if not a_tag: continue
                href = a_tag.get('href', '')
                vid_id = href.split('/')[-1] if '/' in href else href
                if '#' in vid_id:
                    vid_id = vid_id.split('#')[0]
                
                img_tag = item.select_one('img')
                cover = img_tag.get('data-src') or img_tag.get('src') if img_tag else ''
                
                title_tag = item.select_one('div.my-2 a, div.truncate a')
                title = title_tag.text.strip() if title_tag else vid_id
                
                date_text = item.text
                if not re.search(r'\b20\d{2}-\d{2}-\d{2}\b', date_text) and item.parent:
                    date_text = item.parent.text
                date_match = re.search(r'\b(20\d{2}-\d{2}-\d{2})\b', date_text)
                release_date = date_match.group(1) if date_match else ''
                
                if vid_id and cover:
                    # Tạo pseudo-time để giữ đúng thứ tự release (page nhỏ, index nhỏ -> timestamp lớn hơn)
                    pseudo_time = now - (page * 10000) - idx
                    videos.append((vid_id, title, cover, pseudo_time, release_date))
                    
            with db_lock:
                cursor = self.db_conn.cursor()
                new_count = 0
                for vid in videos:
                    vid_id = vid[0]
                    cursor.execute("SELECT id FROM missav_videos WHERE id = ?", (vid_id,))
                    if not cursor.fetchone():
                        with memory_lock:
                            if vid_id not in db_buffer['videos']:
                                new_count += 1
                    
                with memory_lock:
                    for vid in videos:
                        vid_id = vid[0]
                        db_buffer['videos'][vid_id] = {
                            'id': vid[0], 'title': vid[1], 'cover': vid[2], 'added_at': vid[3], 'release_date': vid[4]
                        }
            print(f"[Scraper] Synced {len(videos)} videos from {url} (New: {new_count}).")
            return new_count, len(videos), total_pages
        except Exception as e:
            print(f"[Scraper] Sync failed: {e}")
            return 0, -1, 0

    def get_video_url(self, vid_id, refresh=False):
        if not refresh:
            with memory_lock:
                url_in_buffer = db_buffer['video_urls'].get(vid_id)
            if url_in_buffer:
                url_str = url_in_buffer
                parsed_domain = urlparse(url_str).netloc
                if not re.match(r'^[a-f0-9]{8}\.com$', parsed_domain):
                    return url_str
                    
            with db_lock:
                cursor = self.db_conn.cursor()
                cursor.execute("SELECT url FROM missav_videos WHERE id = ? AND url IS NOT NULL", (vid_id,))
                row = cursor.fetchone()
                
            if row and row[0]:
                url_str = row[0].replace('1080p/video.m3u8', 'playlist.m3u8')
                parsed_domain = urlparse(url_str).netloc
                # Phát hiện và bỏ qua tên miền lỗi do thuật toán cũ
                if not re.match(r'^[a-f0-9]{8}\.com$', parsed_domain):
                    return url_str
            
        url = f"https://missav.ai/en/{vid_id}"
        print(f"[Scraper] Fetching video URL for {vid_id} at {url}")
        try:
            res = self.session.get(url, timeout=15)
            
            m3u8_url = None
            eval_match = re.search(r"return p}\('(.*?)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*?)'\.split\('\|'\)", res.text)
            if eval_match:
                p_str = eval_match.group(1).replace("\\'", "'")
                a_radix = int(eval_match.group(2))
                c_count = int(eval_match.group(3))
                k_words = eval_match.group(4).split('|')
                
                def e_base(num, b):
                    if num == 0: return "0"
                    chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
                    res_str = ""
                    while num > 0:
                        res_str = chars[num % b] + res_str
                        num //= b
                    return res_str
                
                for i in range(c_count - 1, -1, -1):
                    if i < len(k_words) and k_words[i]:
                        word = e_base(i, a_radix)
                        p_str = re.sub(r'\b' + word + r'\b', k_words[i], p_str)
                
                playlist_match = re.search(r'(https://[^/\'"]+/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/playlist\.m3u8)', p_str)
                if playlist_match:
                    m3u8_url = playlist_match.group(1)
                else:
                    any_m3u8 = re.search(r'(https://[^/\'"]+/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/[^/]+/[^\'"]*\.m3u8)', p_str)
                    if any_m3u8:
                        m3u8_url = any_m3u8.group(1)
                        m3u8_url = re.sub(r'/[^/]+/[^\']*\.m3u8$', '/playlist.m3u8', m3u8_url)

            if not m3u8_url:
                # Phân tích dự phòng
                uuid_match = re.search(r'([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})', res.text)
                if not uuid_match:
                    print(f"[Scraper] UUID not found for {vid_id}")
                    return None
                video_uuid = uuid_match.group(1)
                
                domain = "surrit.com"
                eval_fallback = re.search(r'eval\(function\(p,a,c,k,e,d\).*?\'([^\']+)\'\.split\(\'\|\'\)', res.text)
                if eval_fallback:
                    words = eval_fallback.group(1).split('|')
                    for w in words:
                        if w in ['surrit', 'nineyu', 'vipanicdn', 'missav']:
                            domain = f"{w}.com"
                            break
                            
                m3u8_url = f"https://{domain}/{video_uuid}/playlist.m3u8"
            
            with memory_lock:
                db_buffer['video_urls'][vid_id] = m3u8_url
            return m3u8_url
        except Exception as e:
            print(f"[Scraper] Failed to get video URL for {vid_id}: {e}")
            return None

    def sync_video_details(self, vid_id):
        with self.sync_lock:
            url = f"https://missav.ai/en/{vid_id}"
            try:
                res = self.session.get(url, timeout=15)
                if res.status_code != 200:
                    with db_lock:
                        cursor = self.db_conn.cursor()
                        cursor.execute("UPDATE missav_videos SET details_fetched = -1 WHERE id = ?", (vid_id,))
                        self.db_conn.commit()
                    return False
                    
                soup = BeautifulSoup(res.text, 'html.parser')
                
                actress_arr = []
                genre_arr = []
                maker = ""
                details = ""
                release_date = ""
                
                info_divs = soup.find_all('div', class_='text-secondary')
                for div in info_divs:
                    span = div.find('span')
                    if not span:
                        continue
                    label_text = span.get_text(strip=True).lower()
                    if 'actress:' in label_text:
                        actress_arr = [a.get_text(strip=True) for a in div.find_all('a')]
                    elif 'genre:' in label_text or 'tags:' in label_text:
                        genre_arr = [a.get_text(strip=True) for a in div.find_all('a')]
                    elif 'maker:' in label_text:
                        a_tag = div.find('a')
                        if a_tag:
                            maker = a_tag.get_text(strip=True)
                    elif 'release date:' in label_text or 'date:' in label_text:
                        date_str = div.get_text(strip=True).replace(span.get_text(strip=True), '').strip()
                        date_match = re.search(r'\b(20\d{2}-\d{2}-\d{2})\b', date_str)
                        if date_match:
                            release_date = date_match.group(1)
                    elif 'description:' in label_text:
                        details = div.get_text(strip=True).replace(span.get_text(strip=True), '').strip()
                
                desc_meta = soup.find('meta', {'name': 'description'})
                if desc_meta:
                    meta_content = desc_meta.get('content', '')
                    if meta_content:
                        details = meta_content
                
                actress_str = ", ".join(actress_arr)
                genre_str = ", ".join(genre_arr)
                
                with db_lock:
                    cursor = self.db_conn.cursor()
                    if release_date:
                        cursor.execute('''
                            UPDATE missav_videos
                            SET actress = ?, genre = ?, maker = ?, details = ?, release_date = ?, details_fetched = 1
                            WHERE id = ?
                        ''', (actress_str, genre_str, maker, details, release_date, vid_id))
                    else:
                        cursor.execute('''
                            UPDATE missav_videos
                            SET actress = ?, genre = ?, maker = ?, details = ?, details_fetched = 1
                            WHERE id = ?
                        ''', (actress_str, genre_str, maker, details, vid_id))
                    self.db_conn.commit()
                    
                return True
            except Exception as e:
                print(f"[Scraper] Lỗi lấy chi tiết video {vid_id}: {e}")
                with db_lock:
                    cursor = self.db_conn.cursor()
                    cursor.execute("UPDATE missav_videos SET details_fetched = -1 WHERE id = ?", (vid_id,))
                    self.db_conn.commit()
                return False

class BackgroundScanner(threading.Thread):
    def __init__(self, scraper, upgrade_all=False):
        super().__init__(daemon=True)
        self.scraper = scraper
        self.upgrade_all = upgrade_all

    def run(self):
        # Cập nhật danh sách sync_tasks từ menu trang web trước
        self.scraper.update_sync_tasks_from_menu()
        
        # Khởi chạy luồng quét các trang 1 độc lập
        threading.Thread(target=self.recent_scan_loop, daemon=True).start()
        threading.Thread(target=self.details_scan_loop, daemon=True).start()
        self.backlog_scan_loop()

    def recent_scan_loop(self):
        global global_last_request_time
        last_scan_time = 0
        while True:
            time.sleep(5)
            now = time.time()
            if now - global_last_request_time < CLIENT_IDLE_TIMEOUT:
                continue
            if now - last_scan_time < 300:
                continue
                
            try:
                print("\n[Scanner] Định kỳ 5 phút: Kiểm tra các video mới...")
                with db_lock:
                    cursor = self.scraper.db_conn.cursor()
                    cursor.execute("SELECT url_pattern FROM sync_tasks")
                    tasks = cursor.fetchall()
                
                for task in tasks:
                    url_pattern = task[0]
                    page = 1
                    while True:
                        if time.time() - global_last_request_time < CLIENT_IDLE_TIMEOUT:
                            break
                        new_inserted, found, _ = self.scraper.sync_list_page(url_pattern, page)
                        if found == -1:
                            time.sleep(5)
                            break
                        if new_inserted > 0 and found > 0:
                            page += 1
                            time.sleep(1)
                        else:
                            break
            except Exception as e:
                print(f"[Scanner] Lỗi kiểm tra video mới: {e}")
                
            last_scan_time = time.time()

    def details_scan_loop(self):
        global global_last_request_time
        while True:
            time.sleep(0.5)
            try:
                # Tạm dừng quét nếu có tương tác từ UI
                if time.time() - global_last_request_time < CLIENT_IDLE_TIMEOUT:
                    continue
                    
                with db_lock:
                    cursor = self.scraper.db_conn.cursor()
                    cursor.execute("SELECT id FROM missav_videos WHERE details_fetched = 0 ORDER BY added_at ASC LIMIT 1")
                    row = cursor.fetchone()
                    
                if not row:
                    time.sleep(10)
                    continue
                    
                vid_id = row[0]
                print(f"[Scanner] Đang lấy chi tiết video: {vid_id}")
                self.scraper.sync_video_details(vid_id)
            except Exception as e:
                print(f"[Scanner] Lỗi quét chi tiết: {e}")

    def backlog_scan_loop(self):
        global global_last_request_time
        
        if self.upgrade_all:
            with db_lock:
                cursor = self.scraper.db_conn.cursor()
                cursor.execute("UPDATE sync_tasks SET current_page = 1, is_completed = 0")
                self.scraper.db_conn.commit()

        while True:
            time.sleep(1)
            try:
                # Tạm dừng quét nếu có tương tác từ UI
                if time.time() - global_last_request_time < CLIENT_IDLE_TIMEOUT:
                    continue
                    
                with db_lock:
                    cursor = self.scraper.db_conn.cursor()
                    cursor.execute("SELECT url_pattern, current_page, total_pages FROM sync_tasks WHERE is_completed = 0")
                    tasks = cursor.fetchall()
                    
                if not tasks:
                    time.sleep(10)
                    continue
                    
                for task in tasks:
                    if time.time() - global_last_request_time < CLIENT_IDLE_TIMEOUT:
                        break
                        
                    url_pattern, current_page, total_pages = task
                    
                    if current_page > total_pages or current_page > 2000:
                        with db_lock:
                            cursor = self.scraper.db_conn.cursor()
                            cursor.execute("UPDATE sync_tasks SET is_completed = 1 WHERE url_pattern = ?", (url_pattern,))
                            self.scraper.db_conn.commit()
                        continue
                        
                    print(f"[Scanner] Sync backlog {url_pattern} page {current_page}/{total_pages}...")
                    new_inserted, found, extracted_total = self.scraper.sync_list_page(url_pattern, current_page)
                    
                    if found == -1:
                        time.sleep(5)
                        continue
                        
                    with db_lock:
                        cursor = self.scraper.db_conn.cursor()
                        next_page = current_page + 1
                        new_total = extracted_total if extracted_total > 0 else total_pages
                        is_completed = 1 if (next_page > new_total or next_page > 2000 or found == 0) else 0
                        cursor.execute("UPDATE sync_tasks SET current_page = ?, total_pages = ?, last_fetched = ?, is_completed = ? WHERE url_pattern = ?", 
                                       (next_page, new_total, int(time.time()), is_completed, url_pattern))
                        self.scraper.db_conn.commit()
                    
                    # Mỗi giây 1 page ở từng list
                    time.sleep(1)
                    
            except Exception as e:
                print(f"[Scanner] Lỗi backlog scanner: {e}")
                

class PlayerRequestHandler(BaseHTTPRequestHandler):
    scraper = None
    db_conn = None
    client_html_file = 'index.html'

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_OPTIONS(self):
        global global_last_request_time
        global_last_request_time = time.time()
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        
        req_headers = self.headers.get('Access-Control-Request-Headers')
        if req_headers:
            self.send_header('Access-Control-Allow-Headers', req_headers)
        else:
            self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

    def do_GET(self):
        global global_last_request_time
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        # Cập nhật idle time liên tục khi có request
        global_last_request_time = time.time()

        if parsed.path == '/api/identity/me':
            auth_header = self.headers.get('Authorization', '')
            if not auth_header.startswith('Bearer '):
                self.send_json({"success": False, "error": "Unauthorized"}, status=401)
                return
            token = auth_header.split(' ')[1]
            jwt_payload = verify_jwt(token)
            if not jwt_payload or 'username' not in jwt_payload:
                self.send_json({"success": False, "error": "Unauthorized"}, status=401)
                return
            
            with db_lock:
                cursor = self.db_conn.cursor()
                cursor.execute("SELECT username, email, verified FROM identities WHERE username = ?", (jwt_payload['username'],))
                row = cursor.fetchone()
            if row:
                self.send_json({"success": True, "username": row[0], "email": row[1], "verified": bool(row[2])})
            else:
                self.send_json({"success": False, "error": "User not found"})
            return

        if parsed.path == '/api/videos':
            page = int(qs.get('page', ['1'])[0])
            search_key = qs.get('search_key', [''])[0].strip()
            tab = qs.get('tab', ['all'])[0]
            session_id = qs.get('session_id', [''])[0]
            per_page = 24
            offset = (page - 1) * per_page
            
            auth_header = self.headers.get('Authorization', '')
            username = None
            if auth_header.startswith('Bearer '):
                token = auth_header.split(' ')[1]
                jwt_payload = verify_jwt(token)
                if jwt_payload and 'username' in jwt_payload:
                    username = jwt_payload['username']
                    
            if not username and session_id:
                with db_lock:
                    cursor = self.db_conn.cursor()
                    cursor.execute("SELECT username FROM user_sessions WHERE session_id = ?", (session_id,))
                    row = cursor.fetchone()
                    if row:
                        username = row[0]
                        
            identifier = username if username else session_id

            with db_lock:
                cursor = self.db_conn.cursor()
                
                where_clauses = []
                params = []
                from_clause = "missav_videos v"
                
                if tab == 'favorites':
                    if not identifier:
                        self.send_json({"items": [], "total": 0, "page": page})
                        return
                    from_clause = "missav_videos v JOIN favorites f ON v.id = f.video_id"
                    where_clauses.append("f.username = ?")
                    params.append(identifier)
                elif tab == 'recent':
                    if not identifier:
                        self.send_json({"items": [], "total": 0, "page": page})
                        return
                    from_clause = "missav_videos v JOIN history h ON v.id = h.video_id"
                    where_clauses.append("h.username = ?")
                    params.append(identifier)
                elif tab == 'frequent':
                    if not identifier:
                        self.send_json({"items": [], "total": 0, "page": page})
                        return
                    from_clause = "missav_videos v JOIN history h ON v.id = h.video_id"
                    where_clauses.append("h.username = ?")
                    params.append(identifier)
                elif tab == 'global_frequent':
                    from_clause = "missav_videos v JOIN (SELECT video_id, SUM(watch_count) as total_watches FROM history GROUP BY video_id) h ON v.id = h.video_id"

                if search_key:
                    words = search_key.split()
                    for word in words:
                        where_clauses.append("(v.title LIKE ? OR v.id LIKE ? OR v.actress LIKE ? OR v.genre LIKE ? OR v.maker LIKE ? OR v.details LIKE ?)")
                        params.extend([f"%{word}%"] * 6)
                        
                where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
                
                if tab == 'global_frequent' and not search_key:
                    cursor.execute("SELECT COUNT(DISTINCT video_id) FROM history")
                    total = cursor.fetchone()[0]
                else:
                    cursor.execute(f"SELECT COUNT(*) FROM {from_clause} {where_sql}", params)
                    total = cursor.fetchone()[0]
                    
                order_clause = "ORDER BY v.added_at DESC, v.release_date DESC"
                if tab == 'favorites':
                    order_clause = "ORDER BY f.added_at DESC"
                elif tab == 'recent':
                    order_clause = "ORDER BY h.last_watched DESC"
                elif tab == 'frequent':
                    order_clause = "ORDER BY h.watch_count DESC"
                elif tab == 'global_frequent':
                    order_clause = "ORDER BY h.total_watches DESC"
                    
                query = f"SELECT v.id, v.title, v.cover, v.url, v.release_date, v.actress, v.genre, v.maker, v.details FROM {from_clause} {where_sql} {order_clause} LIMIT ? OFFSET ?"
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
                    "details": row[8] if len(row) > 8 else ''
                })
            self.send_json({"items": videos, "total": total, "page": page})
            
        elif parsed.path == '/api/media':
            vid_id = qs.get('id', [''])[0]
            
            with memory_lock:
                media_in_buffer = db_buffer['media'].get(vid_id)
            if media_in_buffer:
                self.send_response(200)
                self.send_header('Content-Type', media_in_buffer['content_type'] or 'image/jpeg')
                self.send_header('Cache-Control', 'public, max-age=31536000')
                self.end_headers()
                self.wfile.write(media_in_buffer['data'])
                return
                
            with db_lock:
                cursor = self.db_conn.cursor()
                cursor.execute("SELECT data, content_type FROM media WHERE id = ?", (vid_id,))
                row = cursor.fetchone()
                
            if row:
                self.send_response(200)
                self.send_header('Content-Type', row[1] or 'image/jpeg')
                self.send_header('Cache-Control', 'public, max-age=31536000')
                self.end_headers()
                self.wfile.write(row[0])
            else:
                cover_url = None
                with db_lock:
                    cursor = self.db_conn.cursor()
                    cursor.execute("SELECT cover FROM missav_videos WHERE id = ?", (vid_id,))
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
                            self.send_response(200)
                            self.send_header('Content-Type', media_in_buffer['content_type'] or 'image/jpeg')
                            self.send_header('Cache-Control', 'public, max-age=31536000')
                            self.end_headers()
                            self.wfile.write(media_in_buffer['data'])
                            return
                    
                    downloading_media.add(vid_id)
                    try:
                        res = self.scraper.session.get(cover_url, timeout=10)
                        if res.status_code == 200:
                            content_type = res.headers.get('Content-Type', 'image/jpeg')
                            with memory_lock:
                                db_buffer['media'][vid_id] = {
                                    'data': res.content,
                                    'content_type': content_type
                                }
                            self.send_response(200)
                            self.send_header('Content-Type', content_type)
                            self.send_header('Cache-Control', 'public, max-age=31536000')
                            self.end_headers()
                            self.wfile.write(res.content)
                            return
                    except Exception as e:
                        pass
                    finally:
                        downloading_media.discard(vid_id)
                        
                self.send_response(404)
                self.end_headers()

        elif parsed.path == '/api/proxy':
            target_url = qs.get('url', [''])[0]
            if not target_url:
                self.send_response(400)
                self.end_headers()
                return
                
            headers = {
                "Referer": "https://missav.ai/"
            }
            
            if 'Range' in self.headers:
                headers['Range'] = self.headers['Range']
                
            try:
                is_m3u8 = target_url.split('?')[0].endswith('.m3u8')
                
                if not is_m3u8:
                    import select, socket
                    # Debounce proxy khi tua (seeking): chờ 0.15s xem client có hủy request không
                    time.sleep(0.15)
                    try:
                        r, _, _ = select.select([self.connection], [], [], 0)
                        if r:
                            peek = self.connection.recv(1, socket.MSG_PEEK)
                            if not peek:
                                return
                    except Exception:
                        pass
                
                if is_m3u8:
                    res = self.scraper.session.get(target_url, headers=headers, timeout=15)
                    self.send_response(res.status_code)
                    for k, v in res.headers.items():
                        if k.lower() not in ['content-encoding', 'transfer-encoding', 'content-length', 'connection', 'access-control-allow-origin']:
                            self.send_header(k, v)
                    self.send_header('Access-Control-Allow-Origin', '*')
                    
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
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    res = self.scraper.session.get(target_url, headers=headers, timeout=15, stream=True)
                    self.send_response(res.status_code)
                    
                    content_length = None
                    accept_ranges = False
                    for k, v in res.headers.items():
                        k_lower = k.lower()
                        if k_lower not in ['content-encoding', 'transfer-encoding', 'connection', 'access-control-allow-origin']:
                            self.send_header(k, v)
                        if k_lower == 'content-length':
                            content_length = int(v)
                        if k_lower == 'accept-ranges' and 'bytes' in v.lower():
                            accept_ranges = True
                            
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()

                    is_partial = res.status_code == 206
                    # Kích hoạt đa luồng IDM style cho file > 512KB
                    can_multithread = content_length and content_length > 512 * 1024 and (accept_ranges or is_partial)
                    
                    if can_multithread:
                        res.close()
                        
                        start_byte = 0
                        end_byte = content_length - 1
                        
                        if is_partial:
                            cr = res.headers.get('Content-Range', '')
                            m = re.match(r'bytes\s+(\d+)-(\d+)/', cr)
                            if m:
                                start_byte = int(m.group(1))
                                end_byte = int(m.group(2))
                        
                        # Tối đa 8 luồng thay vì 32 để tránh spam quá nhiều request khi tua
                        num_threads = min(8, max(2, (end_byte - start_byte + 1) // (256 * 1024)))
                        chunk_size = (end_byte - start_byte + 1) // num_threads
                        
                        ranges = []
                        for i in range(num_threads):
                            s = start_byte + i * chunk_size
                            e = s + chunk_size - 1 if i < num_threads - 1 else end_byte
                            ranges.append((s, e))
                            
                        import concurrent.futures
                        abort_flag = [False]
                        
                        def fetch_range(r_start, r_end):
                            if abort_flag[0]: return b''
                            h = headers.copy()
                            h['Range'] = f'bytes={r_start}-{r_end}'
                            
                            def _download(timeout):
                                global global_last_request_time
                                r = self.scraper.session.get(target_url, headers=h, timeout=timeout, stream=True)
                                data = bytearray()
                                for chunk in r.iter_content(chunk_size=64*1024):
                                    if abort_flag[0]:
                                        r.close()
                                        return b''
                                    if chunk:
                                        data.extend(chunk)
                                        global_last_request_time = time.time()
                                return bytes(data)
                                
                            try:
                                return _download(10)
                            except:
                                if abort_flag[0]: return b''
                                return _download(15)

                        with concurrent.futures.ThreadPoolExecutor(max_workers=num_threads) as executor:
                            futures = [executor.submit(fetch_range, s, e) for s, e in ranges]
                            try:
                                for future in futures:
                                    data = future.result(timeout=25)
                                    if data:
                                        self.wfile.write(data)
                                        global_last_request_time = time.time()
                            except Exception as e:
                                abort_flag[0] = True
                                for f in futures:
                                    f.cancel()
                    else:
                        for chunk in res.iter_content(chunk_size=128*1024):
                            if chunk:
                                try:
                                    self.wfile.write(chunk)
                                    global_last_request_time = time.time()
                                except Exception:
                                    break
                        res.close()
            except Exception as e:
                print(f"[Proxy] Error fetching {target_url}: {e}")
                self.send_response(500)
                self.end_headers()

        elif parsed.path == '/api/sync':
            with db_lock:
                cursor = self.db_conn.cursor()
                cursor.execute("SELECT url_pattern FROM sync_tasks")
                tasks = cursor.fetchall()
            for task in tasks:
                self.scraper.sync_list_page(task[0], 1)
            self.send_json({"success": True})
            
        elif parsed.path == '/api/video_url':
            vid_id = qs.get('id', [''])[0]
            refresh = qs.get('refresh', ['0'])[0] == '1'
            url = self.scraper.get_video_url(vid_id, refresh)
            if url:
                self.send_json({"success": True, "url": url})
            else:
                self.send_json({"success": False, "error": "Cannot extract URL"})
                
        elif parsed.path == '/api/video_details':
            vid_id = qs.get('id', [''])[0]
            if not vid_id:
                self.send_json({"success": False, "error": "Missing id"})
                return
            
            with db_lock:
                cursor = self.db_conn.cursor()
                cursor.execute("SELECT id, title, cover, url, release_date, actress, genre, maker, details FROM missav_videos WHERE id = ?", (vid_id,))
                row = cursor.fetchone()
                
            if row:
                self.send_json({
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
                        "details": row[8] if row[8] else ''
                    }
                })
            else:
                self.send_json({"success": False, "error": "Not found"})

        elif parsed.path.startswith('/api'):
            self.send_response(404)
            self.end_headers()
            
        else:
            try:
                html_path = self.client_html_file
                if not os.path.isabs(html_path):
                    html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), html_path)
                with open(html_path, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.end_headers()
                self.wfile.write(content)
            except Exception as e:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(f"HTML not found: {html_path} ({e})".encode('utf-8'))

    def do_POST(self):
        global global_last_request_time
        global_last_request_time = time.time()
        parsed = urlparse(self.path)
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)
        
        try:
            payload = json.loads(post_data.decode('utf-8'))
        except:
            payload = {}

        if parsed.path == '/api/identity/check':
            query = payload.get('query', '').strip()
            with db_lock:
                cursor = self.db_conn.cursor()
                cursor.execute("SELECT username FROM identities WHERE username = ? OR email = ?", (query, query))
                row = cursor.fetchone()
            self.send_json({"exists": bool(row)})
        elif parsed.path == '/api/identity/send_otp':
            query = payload.get('query', '').strip()
            with db_lock:
                cursor = self.db_conn.cursor()
                cursor.execute("SELECT email FROM identities WHERE username = ? OR email = ?", (query, query))
                row = cursor.fetchone()
            if not row or not row[0]:
                self.send_json({"success": False, "error": "Tài khoản không tồn tại hoặc chưa liên kết email."})
                return
            
            user_email = row[0]
            import random
            otp = str(random.randint(100000, 999999))
            expire = int(time.time()) + 300
            with db_lock:
                cursor = self.db_conn.cursor()
                cursor.execute("UPDATE identities SET otp = ?, otp_expire = ? WHERE email = ?", (otp, expire, user_email))
                self.db_conn.commit()
            
            args_email = getattr(self.args, 'email', None)
            args_email_pass = getattr(self.args, 'emailPass', None)
            if args_email_pass:
                args_email_pass = args_email_pass.strip()
                
            if not args_email or not args_email_pass:
                self.send_json({"success": False, "error": "Server chưa cấu hình email."})
                return
                
            try:
                import smtplib
                from email.mime.text import MIMEText
                msg = MIMEText(f"Mã OTP đăng nhập của bạn là: {otp}\nCó hiệu lực trong 5 phút.")
                msg['Subject'] = 'Mã OTP Định Danh MissAV Player'
                msg['From'] = args_email
                msg['To'] = user_email
                server = smtplib.SMTP('smtp.gmail.com', 587)
                server.starttls()
                server.login(args_email, args_email_pass)
                server.send_message(msg)
                server.quit()
                self.send_json({"success": True})
            except Exception as e:
                self.send_json({"success": False, "error": str(e)})
        elif parsed.path == '/api/identity/register':
            username = payload.get('username', '').strip()
            email = payload.get('email', '').strip()
            password = payload.get('password', '')
            session_id = payload.get('session_id', '')
            
            if not username or not password:
                self.send_json({"success": False, "error": "Thiếu thông tin."})
                return
                
            with db_lock:
                cursor = self.db_conn.cursor()
                if email:
                    cursor.execute("SELECT username, created_at, verified FROM identities WHERE email = ?", (email,))
                    row = cursor.fetchone()
                    if row:
                        created_at = row[1]
                        verified = row[2]
                        if not verified and created_at and (int(time.time()) - created_at > 3600):
                            cursor.execute("DELETE FROM identities WHERE email = ?", (email,))
                            self.db_conn.commit()
                        else:
                            self.send_json({"success": False, "error": "Email đã được sử dụng."})
                            return
                        
                try:
                    cursor.execute("INSERT INTO identities (username, email, password, session_id, created_at, verified) VALUES (?, ?, ?, ?, ?, ?)", 
                                   (username, email if email else None, password, session_id, int(time.time()), 0))
                    if session_id:
                        cursor.execute("INSERT OR REPLACE INTO user_sessions (username, session_id) VALUES (?, ?)", (username, session_id))
                        cursor.execute("UPDATE OR IGNORE history SET username = ? WHERE username = ?", (username, session_id))
                        cursor.execute("DELETE FROM history WHERE username = ?", (session_id,))
                        cursor.execute("UPDATE OR IGNORE favorites SET username = ? WHERE username = ?", (username, session_id))
                        cursor.execute("DELETE FROM favorites WHERE username = ?", (session_id,))
                    self.db_conn.commit()
                    token = create_jwt({"username": username})
                    self.send_json({"success": True, "username": username, "token": token})
                except sqlite3.IntegrityError:
                    self.send_json({"success": False, "error": "Username đã tồn tại."})
        elif parsed.path == '/api/identity/login':
            query = payload.get('query', '').strip()
            password = payload.get('password', '')
            otp = payload.get('otp', '')
            session_id = payload.get('session_id', '')
            
            with db_lock:
                cursor = self.db_conn.cursor()
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
                        self.db_conn.commit()
                        token = create_jwt({"username": row[0]})
                        self.send_json({"success": True, "username": row[0], "token": token})
                    else:
                        self.send_json({"success": False, "error": "Sai thông tin đăng nhập."})
                elif otp:
                    cursor.execute("SELECT username, otp_expire FROM identities WHERE (username = ? OR email = ?) AND otp = ?", (query, query, otp))
                    row = cursor.fetchone()
                    if row:
                        if row[1] < int(time.time()):
                            self.send_json({"success": False, "error": "OTP đã hết hạn."})
                        else:
                            cursor.execute("UPDATE identities SET session_id = ?, otp = NULL, verified = 1 WHERE username = ?", (session_id, row[0]))
                            if session_id:
                                cursor.execute("INSERT OR REPLACE INTO user_sessions (username, session_id) VALUES (?, ?)", (row[0], session_id))
                                cursor.execute("UPDATE OR IGNORE history SET username = ? WHERE username = ?", (row[0], session_id))
                                cursor.execute("DELETE FROM history WHERE username = ?", (session_id,))
                                cursor.execute("UPDATE OR IGNORE favorites SET username = ? WHERE username = ?", (row[0], session_id))
                                cursor.execute("DELETE FROM favorites WHERE username = ?", (session_id,))
                            self.db_conn.commit()
                            token = create_jwt({"username": row[0]})
                            self.send_json({"success": True, "username": row[0], "token": token})
                    else:
                        self.send_json({"success": False, "error": "OTP không hợp lệ."})
                else:
                    self.send_json({"success": False, "error": "Thiếu password hoặc OTP."})
        elif parsed.path == '/api/identity/verify_email':
            auth_header = self.headers.get('Authorization', '')
            if not auth_header.startswith('Bearer '):
                self.send_json({"success": False, "error": "Unauthorized"}, status=401)
                return
            token = auth_header.split(' ')[1]
            jwt_payload = verify_jwt(token)
            if not jwt_payload or 'username' not in jwt_payload:
                self.send_json({"success": False, "error": "Unauthorized"}, status=401)
                return
            
            username = jwt_payload['username']
            otp = payload.get('otp', '')
            
            with db_lock:
                cursor = self.db_conn.cursor()
                cursor.execute("SELECT otp_expire FROM identities WHERE username = ? AND otp = ?", (username, otp))
                row = cursor.fetchone()
                if row:
                    if row[0] < int(time.time()):
                        self.send_json({"success": False, "error": "OTP đã hết hạn."})
                    else:
                        cursor.execute("UPDATE identities SET otp = NULL, verified = 1 WHERE username = ?", (username,))
                        self.db_conn.commit()
                        self.send_json({"success": True})
                else:
                    self.send_json({"success": False, "error": "OTP không hợp lệ."})
                    
        elif parsed.path == '/api/identity/update_profile':
            auth_header = self.headers.get('Authorization', '')
            if not auth_header.startswith('Bearer '):
                self.send_json({"success": False, "error": "Unauthorized"}, status=401)
                return
            token = auth_header.split(' ')[1]
            jwt_payload = verify_jwt(token)
            if not jwt_payload or 'username' not in jwt_payload:
                self.send_json({"success": False, "error": "Unauthorized"}, status=401)
                return
                
            current_username = jwt_payload['username']
            new_username = payload.get('username', '').strip()
            new_password = payload.get('password', '')
            
            with db_lock:
                cursor = self.db_conn.cursor()
                try:
                    if new_username and new_username != current_username:
                        cursor.execute("UPDATE identities SET username = ? WHERE username = ?", (new_username, current_username))
                        current_username = new_username
                    if new_password:
                        cursor.execute("UPDATE identities SET password = ? WHERE username = ?", (new_password, current_username))
                    self.db_conn.commit()
                    token = create_jwt({"username": current_username})
                    self.send_json({"success": True, "username": current_username, "token": token})
                except sqlite3.IntegrityError:
                    self.send_json({"success": False, "error": "Username đã tồn tại."})
                    
        elif parsed.path == '/api/identity/reset_password':
            query = payload.get('query', '').strip()
            otp = payload.get('otp', '')
            new_password = payload.get('new_password', '')
            
            with db_lock:
                cursor = self.db_conn.cursor()
                cursor.execute("SELECT username, otp_expire FROM identities WHERE (username = ? OR email = ?) AND otp = ?", (query, query, otp))
                row = cursor.fetchone()
                if row:
                    if row[1] < int(time.time()):
                        self.send_json({"success": False, "error": "OTP đã hết hạn."})
                    else:
                        cursor.execute("UPDATE identities SET password = ?, otp = NULL, verified = 1 WHERE username = ?", (new_password, row[0]))
                        self.db_conn.commit()
                        self.send_json({"success": True})
                else:
                    self.send_json({"success": False, "error": "OTP không hợp lệ."})
        
        elif parsed.path == '/api/favorites/toggle':
            auth_header = self.headers.get('Authorization', '')
            username = None
            if auth_header.startswith('Bearer '):
                token = auth_header.split(' ')[1]
                jwt_payload = verify_jwt(token)
                if jwt_payload and 'username' in jwt_payload:
                    username = jwt_payload['username']
                    
            session_id = payload.get('session_id')
            
            if not username and session_id:
                with db_lock:
                    cursor = self.db_conn.cursor()
                    cursor.execute("SELECT username FROM user_sessions WHERE session_id = ?", (session_id,))
                    row = cursor.fetchone()
                    if row:
                        username = row[0]
                        
            identifier = username if username else session_id
            
            if not identifier:
                self.send_json({"success": False, "error": "Unauthorized"}, status=401)
                return
                
            video_id = payload.get('video_id')
            
            with db_lock:
                cursor = self.db_conn.cursor()
                cursor.execute("SELECT 1 FROM favorites WHERE username = ? AND video_id = ?", (identifier, video_id))
                exists = cursor.fetchone()
                if exists:
                    cursor.execute("DELETE FROM favorites WHERE username = ? AND video_id = ?", (identifier, video_id))
                    self.db_conn.commit()
                    self.send_json({"success": True, "added": False})
                else:
                    cursor.execute("INSERT INTO favorites (username, video_id, added_at) VALUES (?, ?, ?)", (identifier, video_id, int(time.time())))
                    self.db_conn.commit()
                    self.send_json({"success": True, "added": True})
                    
        elif parsed.path == '/api/history/record':
            auth_header = self.headers.get('Authorization', '')
            username = None
            if auth_header.startswith('Bearer '):
                token = auth_header.split(' ')[1]
                jwt_payload = verify_jwt(token)
                if jwt_payload and 'username' in jwt_payload:
                    username = jwt_payload['username']
                
            session_id = payload.get('session_id')
            
            if not username and session_id:
                with db_lock:
                    cursor = self.db_conn.cursor()
                    cursor.execute("SELECT username FROM user_sessions WHERE session_id = ?", (session_id,))
                    row = cursor.fetchone()
                    if row:
                        username = row[0]
            
            identifier = username if username else session_id
            
            if not identifier:
                self.send_json({"success": False, "error": "No identifier provided"}, status=400)
                return
                
            video_id = payload.get('video_id')
            
            with db_lock:
                cursor = self.db_conn.cursor()
                cursor.execute("SELECT watch_count FROM history WHERE username = ? AND video_id = ?", (identifier, video_id))
                row = cursor.fetchone()
                now_ts = int(time.time())
                if row:
                    cursor.execute("UPDATE history SET watch_count = ?, last_watched = ? WHERE username = ? AND video_id = ?", (row[0] + 1, now_ts, identifier, video_id))
                else:
                    cursor.execute("INSERT INTO history (username, video_id, watch_count, last_watched) VALUES (?, ?, ?, ?)", (identifier, video_id, 1, now_ts))
                self.db_conn.commit()
                self.send_json({"success": True})

        else:
            self.send_response(404)
            self.end_headers()

def start_reloader():
    def reloader_thread():
        mtime = os.path.getmtime(__file__)
        while True:
            time.sleep(2)
            if os.path.getmtime(__file__) != mtime:
                print("\n[AutoReloader] Phát hiện thay đổi code, tự động khởi động lại...")
                os.execv(sys.executable, [sys.executable] + sys.argv)
    threading.Thread(target=reloader_thread, daemon=True).start()

def main():
    start_reloader()
    parser = argparse.ArgumentParser()
    parser.add_argument('-port', type=int, default=5009, help="Port to run the HTTP server on")
    parser.add_argument('-sqlite3', type=str, required=True, help="Path to the SQLite3 database file")
    parser.add_argument('-upgrade-all', action='store_true', help="Start scanning from page 1 instead of backlog")
    parser.add_argument('-emailPass', type=str, default="szywozapustydcuw", help="App password for email")
    parser.add_argument('-email', type=str, default="infor.dkeeps@gmail.com", help="Email to send OTP from")
    
    args = parser.parse_args()
    
    try:
        db_conn = get_db_connection(args.sqlite3)
        scraper = MissavScraper(db_conn)
        
        PlayerRequestHandler.db_conn = db_conn
        PlayerRequestHandler.scraper = scraper
        PlayerRequestHandler.client_html_file = 'index.html'
        PlayerRequestHandler.args = args
        
        threading.Thread(target=background_db_worker, args=(db_conn,), daemon=True).start()
        
        scanner = BackgroundScanner(scraper, upgrade_all=args.upgrade_all)
        scanner.start()
        
        server_address = ('', args.port)
        httpd = ThreadingHTTPServer(server_address, PlayerRequestHandler)
        
        print(f"MissAV Player server running at http://localhost:{args.port}")
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == '__main__':
    main()