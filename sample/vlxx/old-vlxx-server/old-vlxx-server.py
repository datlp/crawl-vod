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
import difflib
import platform
import subprocess
import shutil
import signal
from urllib.parse import urlparse, parse_qs, quote

def detect_os():
    if "TERMUX_VERSION" in os.environ:
        return "termux"
    return platform.system().lower()

def check_and_install_packages():
    os_name = detect_os()
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Phát hiện môi trường/hệ điều hành: {os_name} ✔️")
    
    required_packages = {
        'flask': 'flask',
        'psutil': 'psutil',
        'nltk': 'nltk'
    }
    
    needs_restart = False
    for mod_name, pkg_name in required_packages.items():
        try:
            __import__(mod_name)
        except ImportError:
            print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Thư viện '{pkg_name}' chưa được cài đặt. Đang tự động tải về... ⚠️")
            try:
                subprocess.check_call([sys.executable, "-m", "pip", "install", pkg_name])
                needs_restart = True
            except Exception as e:
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Lỗi khi cài đặt '{pkg_name}': {e} ❌")
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Vui lòng cài đặt thủ công bằng lệnh: pip install {pkg_name} ❌")
                sys.exit(1)
                
    if needs_restart:
        print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Quá trình tự động cài đặt hoàn tất. Đang khởi động lại ứng dụng... ✔️")
        os.execv(sys.executable, [sys.executable] + sys.argv)

check_and_install_packages()

import psutil
from flask import Flask, request, jsonify, Response, make_response
# 
try:
    import spacy
except ImportError:
    spacy = None
try:
    import underthesea
except ImportError:
    underthesea = None

scraper_classes = {}

try:
    from crawler.javtiful import JavtifulScraper
    scraper_classes['javtiful'] = JavtifulScraper
except Exception as e:
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Bỏ qua JavtifulScraper do lỗi: {e} ❌")

try:
    from crawler.vlxx import VlxxScraper
    scraper_classes['vlxx'] = VlxxScraper
except Exception as e:
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Bỏ qua VlxxScraper do lỗi: {e} ❌")

try:
    from crawler.javmost import JavmostScraper
    scraper_classes['javmost'] = JavmostScraper
except Exception as e:
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Bỏ qua JavmostScraper do lỗi: {e} ❌")

try:
    from crawler.sextop1 import Sextop1Scraper
    scraper_classes['sextop1'] = Sextop1Scraper
except Exception as e:
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Bỏ qua Sextop1Scraper do lỗi: {e} ❌")

try:
    from crawler.javtrailer import JavtrailerScraper
    scraper_classes['javtrailer'] = JavtrailerScraper
except Exception as e:
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Bỏ qua JavtrailerScraper do lỗi: {e} ❌")

try:
    from crawler.missav import MissavScraper
    scraper_classes['missav'] = MissavScraper
except Exception as e:
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Bỏ qua MissavScraper do lỗi: {e} ❌")

try:
    from crawler.fshare import FshareScraper
    scraper_classes['fshare'] = FshareScraper
except Exception as e:
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Bỏ qua FshareScraper do lỗi: {e} ❌")

try:
    import nltk
except ImportError:
    nltk = None

global_last_request_time = time.time()
CLIENT_IDLE_TIMEOUT = 60

memory_lock = threading.Lock()
db_lock = threading.Lock()
db_buffer = {
    'javtiful_videos': {},
    'vlxx_videos': {},
    'javmost_videos': {},
    'sextop1_videos': {},
    'javtrailer_videos': {},
    'missav_videos': {},
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

def extract_dvd_code(text):
    if not text:
        return None
    match = re.search(r'([a-zA-Z]{2,5}-\d{2,5})', text)
    if match:
        return match.group(1).upper()
    return None

def sync_movies_references(db_conn):
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Đang đồng bộ reference keys thành mảng (xxx_ids) cho bảng movies... ⏳")
    cursor = db_conn.cursor()
    
    for col in ['javtrailer_ids', 'javtiful_ids', 'vlxx_ids', 'javmost_ids', 'sextop1_ids', 'missav_ids']:
        try:
            cursor.execute(f'ALTER TABLE movies ADD COLUMN {col} TEXT')
        except sqlite3.OperationalError:
            pass
            
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Tải danh sách movies.dvd vào bộ nhớ... ⏳")
    cursor.execute("SELECT dvd FROM movies WHERE dvd IS NOT NULL")
    movies_dvds_rows = cursor.fetchall()
    movies_dvds_map = {row[0].upper(): row[0] for row in movies_dvds_rows}
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Đã tải {len(movies_dvds_map)} movies.dvd. ✔️")

    sources = ['javtiful', 'vlxx', 'javmost', 'sextop1', 'javtrailer', 'missav']
    
    for source in sources:
        print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Quét bảng {source}_videos... ⏳")
        table_name = f"{source}_videos"
        
        try:
            cursor.execute(f"SELECT id, title, cover FROM {table_name}")
            rows = cursor.fetchall()
        except sqlite3.OperationalError:
            continue
            
        movie_mappings = {}
        movie_info = {}
        for vid_id, title, cover in rows:
            dvd = extract_dvd_code(vid_id) or extract_dvd_code(title)
            
            if not dvd and vid_id:
                if source == 'javtrailer':
                    dvd = vid_id.upper()
                elif source in ['javtiful', 'missav', 'javmost']:
                    upper_vid_id = vid_id.upper()
                    if upper_vid_id in movies_dvds_map:
                        dvd = movies_dvds_map[upper_vid_id]
            if dvd:
                if dvd not in movie_mappings:
                    movie_mappings[dvd] = []
                    movie_info[dvd] = {"title": title, "cover": cover}
                if vid_id not in movie_mappings[dvd]:
                    movie_mappings[dvd].append(vid_id)
                    
        print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Cập nhật {source}_ids cho {len(movie_mappings)} movies... ⏳")
        for dvd, ids in movie_mappings.items():
            cursor.execute("SELECT title FROM movies WHERE dvd = ?", (dvd,))
            row = cursor.fetchone()
            if not row:
                cursor.execute("INSERT OR IGNORE INTO movies (dvd, title, cover) VALUES (?, ?, ?)", (dvd, movie_info[dvd]['title'], movie_info[dvd]['cover']))
                
            cursor.execute(f"SELECT {source}_ids FROM movies WHERE dvd = ?", (dvd,))
            current_ids_row = cursor.fetchone()
            current_ids = json.loads(current_ids_row[0]) if current_ids_row and current_ids_row[0] else []
            
            try:
                cursor.execute(f"SELECT {source}_id FROM movies WHERE dvd = ?", (dvd,))
                old_id_row = cursor.fetchone()
                if old_id_row and old_id_row[0] and old_id_row[0] not in current_ids:
                    current_ids.append(old_id_row[0])
            except sqlite3.OperationalError:
                pass
                
            for vid_id in ids:
                if vid_id not in current_ids:
                    current_ids.append(vid_id)
                    
            cursor.execute(f"UPDATE movies SET {source}_ids = ? WHERE dvd = ?", (json.dumps(current_ids), dvd))
            
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Đồng bộ fshare_videos.video_dvd với movies.dvd... ⏳")
    try:
        # Re-fetch map in case new movies were added in the loop above
        cursor.execute("SELECT dvd FROM movies WHERE dvd IS NOT NULL")
        movies_dvds_rows = cursor.fetchall()
        movies_dvds_map = {row[0].upper(): row[0] for row in movies_dvds_rows}
        cursor.execute("SELECT file_code, video_dvd FROM fshare_videos WHERE video_dvd IS NOT NULL")
        fshare_rows = cursor.fetchall()

        updates = []
        for file_code, video_dvd in fshare_rows:
            upper_video_dvd = video_dvd.upper()
            if upper_video_dvd in movies_dvds_map:
                correct_dvd_casing = movies_dvds_map[upper_video_dvd]
                if correct_dvd_casing != video_dvd:
                    updates.append((correct_dvd_casing, file_code))
        
        if updates:
            print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Cập nhật {len(updates)} fshare_videos.video_dvd để khớp với movies.dvd... ⏳")
            cursor.executemany("UPDATE fshare_videos SET video_dvd = ? WHERE file_code = ?", updates)
    except sqlite3.OperationalError as e:
        print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Lỗi khi đồng bộ fshare_videos: {e} ❌")

    db_conn.commit()
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Đã đồng bộ xong reference keys cho movies. ✔️")

def flush_db_buffer(db_conn, media_db_conn):
    with memory_lock:
        jav_videos_to_save = db_buffer['javtiful_videos'].copy()
        vlxx_videos_to_save = db_buffer['vlxx_videos'].copy()
        javmost_videos_to_save = db_buffer['javmost_videos'].copy()
        sextop1_videos_to_save = db_buffer['sextop1_videos'].copy()
        javtrailer_videos_to_save = db_buffer['javtrailer_videos'].copy()
        missav_videos_to_save = db_buffer['missav_videos'].copy()
        urls_to_save = db_buffer['video_urls'].copy()
        media_to_save = db_buffer['media'].copy()
        
        db_buffer['javtiful_videos'].clear()
        db_buffer['vlxx_videos'].clear()
        db_buffer['javmost_videos'].clear()
        db_buffer['sextop1_videos'].clear()
        db_buffer['javtrailer_videos'].clear()
        db_buffer['missav_videos'].clear()
        db_buffer['video_urls'].clear()
        db_buffer['media'].clear()
        
    if not any([jav_videos_to_save, vlxx_videos_to_save, javmost_videos_to_save, sextop1_videos_to_save, javtrailer_videos_to_save, missav_videos_to_save, urls_to_save, media_to_save]):
        return
        
    try:
        with db_lock:
            cursor = db_conn.cursor()
            cursor.execute("BEGIN TRANSACTION;")
            
            for vid_id, vid in jav_videos_to_save.items():
                cursor.execute('''
                    INSERT INTO javtiful_videos (id, title, cover, added_at, release_date, release_date_raw)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        title = excluded.title,
                        cover = excluded.cover,
                        added_at = excluded.added_at,
                        release_date = excluded.release_date,
                        release_date_raw = excluded.release_date_raw
                ''', (vid['id'], vid['title'], vid['cover'], vid['added_at'], vid.get('release_date', ''), vid.get('release_date_raw', '')))
                
                dvd = extract_dvd_code(vid_id) or extract_dvd_code(vid['title'])
                if dvd:
                    cursor.execute('INSERT OR IGNORE INTO movies (dvd, title, cover) VALUES (?, ?, ?)', (dvd, vid['title'], vid['cover']))
                    cursor.execute('UPDATE movies SET javtiful_id = ? WHERE dvd = ?', (vid_id, dvd))
                
            for vid_id, vid in sextop1_videos_to_save.items():
                cursor.execute('''
                    INSERT INTO sextop1_videos (id, title, cover, added_at, release_date, release_date_raw)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        title = excluded.title,
                        cover = excluded.cover,
                        added_at = excluded.added_at,
                        release_date = excluded.release_date,
                        release_date_raw = excluded.release_date_raw
                ''', (vid['id'], vid['title'], vid['cover'], vid['added_at'], vid.get('release_date', ''), vid.get('release_date_raw', '')))
                
                dvd = extract_dvd_code(vid_id) or extract_dvd_code(vid['title'])
                if dvd:
                    cursor.execute('INSERT OR IGNORE INTO movies (dvd, title, cover) VALUES (?, ?, ?)', (dvd, vid['title'], vid['cover']))
                    cursor.execute('UPDATE movies SET sextop1_id = ? WHERE dvd = ?', (vid_id, dvd))
                
            for vid_id, vid in vlxx_videos_to_save.items():
                cursor.execute('''
                    INSERT INTO vlxx_videos (id, title, cover, added_at, release_date, release_date_raw)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        title = excluded.title,
                        cover = excluded.cover,
                        added_at = excluded.added_at,
                        release_date = excluded.release_date,
                        release_date_raw = excluded.release_date_raw
                ''', (vid['id'], vid['title'], vid['cover'], vid['added_at'], vid.get('release_date', ''), vid.get('release_date_raw', '')))
                
                dvd = extract_dvd_code(vid_id) or extract_dvd_code(vid['title'])
                if dvd:
                    cursor.execute('INSERT OR IGNORE INTO movies (dvd, title, cover) VALUES (?, ?, ?)', (dvd, vid['title'], vid['cover']))
                    cursor.execute('UPDATE movies SET vlxx_id = ? WHERE dvd = ?', (vid_id, dvd))
                
            for vid_id, vid in javmost_videos_to_save.items():
                cursor.execute('''
                    INSERT INTO javmost_videos (id, title, cover, added_at, release_date, release_date_raw)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        title = excluded.title,
                        cover = excluded.cover,
                        added_at = excluded.added_at,
                        release_date = excluded.release_date,
                        release_date_raw = excluded.release_date_raw
                ''', (vid['id'], vid['title'], vid['cover'], vid['added_at'], vid.get('release_date', ''), vid.get('release_date_raw', '')))
                
                dvd = extract_dvd_code(vid_id) or extract_dvd_code(vid['title'])
                if dvd:
                    cursor.execute('INSERT OR IGNORE INTO movies (dvd, title, cover) VALUES (?, ?, ?)', (dvd, vid['title'], vid['cover']))
                    cursor.execute('UPDATE movies SET javmost_id = ? WHERE dvd = ?', (vid_id, dvd))
                
            for vid_id, vid in javtrailer_videos_to_save.items():
                cursor.execute('''
                    INSERT INTO javtrailer_videos (id, title, cover, added_at, release_date, release_date_raw)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        title = excluded.title,
                        cover = excluded.cover,
                        added_at = excluded.added_at,
                        release_date = excluded.release_date,
                        release_date_raw = excluded.release_date_raw
                ''', (vid['id'], vid['title'], vid['cover'], vid['added_at'], vid.get('release_date', ''), vid.get('release_date_raw', '')))
                
                dvd = extract_dvd_code(vid_id) or extract_dvd_code(vid['title']) or (vid_id.upper() if vid_id else None)
                cursor.execute('''
                    INSERT INTO movies (dvd, title, cover, release_date, release_date_raw, javtrailer_id)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(dvd) DO UPDATE SET
                        title = COALESCE(movies.title, excluded.title),
                        cover = COALESCE(movies.cover, excluded.cover),
                        release_date = COALESCE(movies.release_date, excluded.release_date),
                        release_date_raw = COALESCE(movies.release_date_raw, excluded.release_date_raw),
                        javtrailer_id = excluded.javtrailer_id
                ''', (dvd, vid['title'], vid['cover'], vid.get('release_date', ''), vid.get('release_date_raw', ''), vid['id']))
                
            for vid_id, vid in missav_videos_to_save.items():
                cursor.execute('''
                    INSERT INTO missav_videos (id, title, cover, added_at, release_date, release_date_raw)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        title = excluded.title,
                        cover = excluded.cover,
                        added_at = excluded.added_at,
                        release_date = excluded.release_date,
                        release_date_raw = excluded.release_date_raw
                ''', (vid['id'], vid['title'], vid['cover'], vid['added_at'], vid.get('release_date', ''), vid.get('release_date_raw', '')))
                
                dvd = extract_dvd_code(vid_id) or extract_dvd_code(vid['title'])
                if dvd:
                    cursor.execute('INSERT OR IGNORE INTO movies (dvd, title, cover) VALUES (?, ?, ?)', (dvd, vid['title'], vid['cover']))
                    cursor.execute('UPDATE movies SET missav_id = ? WHERE dvd = ?', (vid_id, dvd))
                
            for (table_name, vid_id), url in urls_to_save.items():
                cursor.execute(f"UPDATE {table_name} SET url = ? WHERE id = ?", (url, vid_id))
                
            db_conn.commit()
    except Exception as e:
        print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Lỗi khi ghi DB: {e} ❌")
        try:
            with db_lock:
                db_conn.rollback()
        except:
            pass
        with memory_lock:
            for vid_id, vid in jav_videos_to_save.items():
                if vid_id not in db_buffer['javtiful_videos']: db_buffer['javtiful_videos'][vid_id] = vid
            for vid_id, vid in vlxx_videos_to_save.items():
                if vid_id not in db_buffer['vlxx_videos']: db_buffer['vlxx_videos'][vid_id] = vid
            for vid_id, vid in javmost_videos_to_save.items():
                if vid_id not in db_buffer['javmost_videos']: db_buffer['javmost_videos'][vid_id] = vid
            for vid_id, vid in sextop1_videos_to_save.items():
                if vid_id not in db_buffer['sextop1_videos']: db_buffer['sextop1_videos'][vid_id] = vid
            for vid_id, vid in javtrailer_videos_to_save.items():
                if vid_id not in db_buffer['javtrailer_videos']: db_buffer['javtrailer_videos'][vid_id] = vid
            for vid_id, vid in missav_videos_to_save.items():
                if vid_id not in db_buffer['missav_videos']: db_buffer['missav_videos'][vid_id] = vid
            for key, url in urls_to_save.items():
                if key not in db_buffer['video_urls']: db_buffer['video_urls'][key] = url

    if media_to_save:
        try:
            with db_lock:
                media_cursor = media_db_conn.cursor()
                media_cursor.execute("BEGIN TRANSACTION;")
                for media_id, m in media_to_save.items():
                    media_cursor.execute("INSERT OR REPLACE INTO media (id, data, content_type) VALUES (?, ?, ?)", (media_id, m['data'], m['content_type']))
                media_db_conn.commit()
        except Exception as e:
            print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Lỗi khi ghi Media DB: {e} ❌")
            try:
                with db_lock:
                    media_db_conn.rollback()
            except: pass
            with memory_lock:
                for media_id, m in media_to_save.items():
                    if media_id not in db_buffer['media']: db_buffer['media'][media_id] = m

def resource_monitor_worker():
    process = psutil.Process(os.getpid())
    while True:
        try:
            # Process RAM
            rss_mb = process.memory_info().rss / (1024 * 1024)

            # Buffer size
            buffer_size_bytes = 0
            buffer_item_counts = {}
            with memory_lock:
                try:
                    serialized_buffer = json.dumps(db_buffer, default=str)
                    buffer_size_bytes = len(serialized_buffer.encode('utf-8'))
                except Exception:
                    buffer_size_bytes = -1 

                for key, value in db_buffer.items():
                    if isinstance(value, (dict, set)):
                        buffer_item_counts[key] = len(value)

            buffer_size_mb = buffer_size_bytes / (1024 * 1024)
            counts_str = ", ".join([f"{k}: {v}" for k, v in buffer_item_counts.items() if v > 0])
            print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Process RAM: {rss_mb:.2f} MB | DB Buffer (est.): {buffer_size_mb:.2f} MB [{counts_str}]")
        except Exception as e:
            print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Error in monitor: {e} ❌")
        time.sleep(5)

def background_db_worker(db_conn, media_db_conn):
    while True:
        time.sleep(5)
        flush_db_buffer(db_conn, media_db_conn)

def get_db_connection(db_path, limit_buffer='200M'):
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
            print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Lỗi khi set limit buffer: {e} ❌")
            
    conn.execute('''
        CREATE TABLE IF NOT EXISTS movies (
            dvd TEXT PRIMARY KEY,
            title TEXT,
            cover TEXT,
            release_date TEXT,
            release_date_raw TEXT,
            actress TEXT,
            genre TEXT,
            maker TEXT,
            details TEXT,
            javtrailer_id TEXT,
            javtiful_id TEXT,
            vlxx_id TEXT,
            javmost_id TEXT,
            sextop1_id TEXT,
            missav_id TEXT
        )
    ''')
    
    for col in ['javtrailer_id', 'javtiful_id', 'vlxx_id', 'javmost_id', 'sextop1_id', 'missav_id']:
        try:
            conn.execute(f'ALTER TABLE movies ADD COLUMN {col} TEXT')
        except sqlite3.OperationalError:
            pass

    conn.execute('CREATE INDEX IF NOT EXISTS idx_movies_javtrailer ON movies(javtrailer_id)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_movies_release ON movies(release_date DESC)')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS fshare_videos (
            file_code TEXT PRIMARY KEY,
            video_dvd TEXT,
            file_name TEXT,
            file_bytes INTEGER,
            create_date INTEGER DEFAULT 0,
            status INTEGER DEFAULT 1,
            check_time INTEGER DEFAULT 0,
            fshare_title TEXT DEFAULT "",
            FOREIGN KEY (video_dvd) REFERENCES movies(dvd)
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_fshare_videos_video_dvd ON fshare_videos(video_dvd)')

    for table in ['movies', 'javtiful_videos', 'sextop1_videos', 'javtrailer_videos', 'vlxx_videos', 'javmost_videos', 'missav_videos']:
        try:
            conn.execute(f'ALTER TABLE {table} ADD COLUMN release_date_raw TEXT')
        except sqlite3.OperationalError:
            pass

    conn.execute('''
        CREATE TABLE IF NOT EXISTS javtiful_videos (
            id TEXT PRIMARY KEY,
            title TEXT,
            cover TEXT,
            url TEXT,
            added_at TEXT,
            release_date TEXT,
            release_date_raw TEXT,
            actress TEXT,
            genre TEXT,
            maker TEXT,
            details TEXT,
            details_fetched INTEGER DEFAULT 0
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_javtiful_videos_details_fetched ON javtiful_videos(details_fetched, added_at ASC)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_javtiful_videos_search_actress ON javtiful_videos(actress)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_javtiful_videos_search_genre ON javtiful_videos(genre)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_javtiful_videos_search_maker ON javtiful_videos(maker)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_javtiful_videos_search_details ON javtiful_videos(details)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_javtiful_videos_search_title ON javtiful_videos(title)')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS sextop1_videos (
            id TEXT PRIMARY KEY,
            title TEXT,
            cover TEXT,
            url TEXT,
            added_at TEXT,
            release_date TEXT,
            release_date_raw TEXT,
            actress TEXT,
            genre TEXT,
            maker TEXT,
            details TEXT,
            details_fetched INTEGER DEFAULT 0
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_sextop1_videos_details_fetched ON sextop1_videos(details_fetched, added_at ASC)')
    conn.execute('''
        CREATE VIRTUAL TABLE IF NOT EXISTS sextop1_videos_fts USING fts5(
            title, actress, genre, maker, details, content='sextop1_videos', content_rowid='rowid'
        )
    ''')
    for trigger_sql in [
        "CREATE TRIGGER IF NOT EXISTS sextop1_videos_ai AFTER INSERT ON sextop1_videos BEGIN INSERT INTO sextop1_videos_fts(rowid, title, actress, genre, maker, details) VALUES (new.rowid, new.title, new.actress, new.genre, new.maker, new.details); END;",
        "CREATE TRIGGER IF NOT EXISTS sextop1_videos_ad AFTER DELETE ON sextop1_videos BEGIN INSERT INTO sextop1_videos_fts(sextop1_videos_fts, rowid, title, actress, genre, maker, details) VALUES ('delete', old.rowid, old.title, old.actress, old.genre, old.maker, old.details); END;",
        "CREATE TRIGGER IF NOT EXISTS sextop1_videos_au AFTER UPDATE ON sextop1_videos BEGIN INSERT INTO sextop1_videos_fts(sextop1_videos_fts, rowid, title, actress, genre, maker, details) VALUES ('delete', old.rowid, old.title, old.actress, old.genre, old.maker, old.details); INSERT INTO sextop1_videos_fts(rowid, title, actress, genre, maker, details) VALUES (new.rowid, new.title, new.actress, new.genre, new.maker, new.details); END;"
    ]:
        conn.execute(trigger_sql)

    conn.execute('''
        CREATE TABLE IF NOT EXISTS javtrailer_videos (
            id TEXT PRIMARY KEY,
            title TEXT,
            cover TEXT,
            url TEXT,
            added_at TEXT,
            release_date TEXT,
            release_date_raw TEXT,
            actress TEXT,
            genre TEXT,
            maker TEXT,
            details TEXT,
            details_fetched INTEGER DEFAULT 0
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_javtrailer_videos_details_fetched ON javtrailer_videos(details_fetched, added_at ASC)')
    conn.execute('''
        CREATE VIRTUAL TABLE IF NOT EXISTS javtrailer_videos_fts USING fts5(
            title, actress, genre, maker, details, content='javtrailer_videos', content_rowid='rowid'
        )
    ''')
    for trigger_sql in [
        "CREATE TRIGGER IF NOT EXISTS javtrailer_videos_ai AFTER INSERT ON javtrailer_videos BEGIN INSERT INTO javtrailer_videos_fts(rowid, title, actress, genre, maker, details) VALUES (new.rowid, new.title, new.actress, new.genre, new.maker, new.details); END;",
        "CREATE TRIGGER IF NOT EXISTS javtrailer_videos_ad AFTER DELETE ON javtrailer_videos BEGIN INSERT INTO javtrailer_videos_fts(javtrailer_videos_fts, rowid, title, actress, genre, maker, details) VALUES ('delete', old.rowid, old.title, old.actress, old.genre, old.maker, old.details); END;",
        "CREATE TRIGGER IF NOT EXISTS javtrailer_videos_au AFTER UPDATE ON javtrailer_videos BEGIN INSERT INTO javtrailer_videos_fts(javtrailer_videos_fts, rowid, title, actress, genre, maker, details) VALUES ('delete', old.rowid, old.title, old.actress, old.genre, old.maker, old.details); INSERT INTO javtrailer_videos_fts(rowid, title, actress, genre, maker, details) VALUES (new.rowid, new.title, new.actress, new.genre, new.maker, new.details); END;"
    ]:
        conn.execute(trigger_sql)

    conn.execute('''
        CREATE TABLE IF NOT EXISTS vlxx_videos (
            id TEXT PRIMARY KEY,
            title TEXT,
            cover TEXT,
            url TEXT,
            added_at TEXT,
            release_date TEXT,
            release_date_raw TEXT,
            actress TEXT,
            genre TEXT,
            maker TEXT,
            details TEXT,
            details_fetched INTEGER DEFAULT 0
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_vlxx_videos_details_fetched ON vlxx_videos(details_fetched, added_at ASC)')
    conn.execute('''
        CREATE VIRTUAL TABLE IF NOT EXISTS vlxx_videos_fts USING fts5(
            title, actress, genre, maker, details, content='vlxx_videos', content_rowid='rowid'
        )
    ''')
    for trigger_sql in [
        "CREATE TRIGGER IF NOT EXISTS vlxx_videos_ai AFTER INSERT ON vlxx_videos BEGIN INSERT INTO vlxx_videos_fts(rowid, title, actress, genre, maker, details) VALUES (new.rowid, new.title, new.actress, new.genre, new.maker, new.details); END;",
        "CREATE TRIGGER IF NOT EXISTS vlxx_videos_ad AFTER DELETE ON vlxx_videos BEGIN INSERT INTO vlxx_videos_fts(vlxx_videos_fts, rowid, title, actress, genre, maker, details) VALUES ('delete', old.rowid, old.title, old.actress, old.genre, old.maker, old.details); END;",
        "CREATE TRIGGER IF NOT EXISTS vlxx_videos_au AFTER UPDATE ON vlxx_videos BEGIN INSERT INTO vlxx_videos_fts(vlxx_videos_fts, rowid, title, actress, genre, maker, details) VALUES ('delete', old.rowid, old.title, old.actress, old.genre, old.maker, old.details); INSERT INTO vlxx_videos_fts(rowid, title, actress, genre, maker, details) VALUES (new.rowid, new.title, new.actress, new.genre, new.maker, new.details); END;"
    ]:
        conn.execute(trigger_sql)

    conn.execute('''
        CREATE TABLE IF NOT EXISTS javmost_videos (
            id TEXT PRIMARY KEY,
            title TEXT,
            cover TEXT,
            url TEXT,
            added_at TEXT,
            release_date TEXT,
            release_date_raw TEXT,
            actress TEXT,
            genre TEXT,
            maker TEXT,
            details TEXT,
            details_fetched INTEGER DEFAULT 0
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_javmost_videos_details_fetched ON javmost_videos(details_fetched, added_at ASC)')
    conn.execute('''
        CREATE VIRTUAL TABLE IF NOT EXISTS javmost_videos_fts USING fts5(
            title, actress, genre, maker, details, content='javmost_videos', content_rowid='rowid'
        )
    ''')
    for trigger_sql in [
        "CREATE TRIGGER IF NOT EXISTS javmost_videos_ai AFTER INSERT ON javmost_videos BEGIN INSERT INTO javmost_videos_fts(rowid, title, actress, genre, maker, details) VALUES (new.rowid, new.title, new.actress, new.genre, new.maker, new.details); END;",
        "CREATE TRIGGER IF NOT EXISTS javmost_videos_ad AFTER DELETE ON javmost_videos BEGIN INSERT INTO javmost_videos_fts(javmost_videos_fts, rowid, title, actress, genre, maker, details) VALUES ('delete', old.rowid, old.title, old.actress, old.genre, old.maker, old.details); END;",
        "CREATE TRIGGER IF NOT EXISTS javmost_videos_au AFTER UPDATE ON javmost_videos BEGIN INSERT INTO javmost_videos_fts(javmost_videos_fts, rowid, title, actress, genre, maker, details) VALUES ('delete', old.rowid, old.title, old.actress, old.genre, old.maker, old.details); INSERT INTO javmost_videos_fts(rowid, title, actress, genre, maker, details) VALUES (new.rowid, new.title, new.actress, new.genre, new.maker, new.details); END;"
    ]:
        conn.execute(trigger_sql)

    conn.execute('''
        CREATE TABLE IF NOT EXISTS missav_videos (
            id TEXT PRIMARY KEY,
            title TEXT,
            cover TEXT,
            url TEXT,
            added_at TEXT,
            release_date TEXT,
            release_date_raw TEXT,
            actress TEXT,
            genre TEXT,
            maker TEXT,
            details TEXT,
            details_fetched INTEGER DEFAULT 0
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_missav_videos_details_fetched ON missav_videos(details_fetched, added_at ASC)')
    conn.execute('''
        CREATE VIRTUAL TABLE IF NOT EXISTS missav_videos_fts USING fts5(
            title, actress, genre, maker, details, content='missav_videos', content_rowid='rowid'
        )
    ''')
    for trigger_sql in [
        "CREATE TRIGGER IF NOT EXISTS missav_videos_ai AFTER INSERT ON missav_videos BEGIN INSERT INTO missav_videos_fts(rowid, title, actress, genre, maker, details) VALUES (new.rowid, new.title, new.actress, new.genre, new.maker, new.details); END;",
        "CREATE TRIGGER IF NOT EXISTS missav_videos_ad AFTER DELETE ON missav_videos BEGIN INSERT INTO missav_videos_fts(missav_videos_fts, rowid, title, actress, genre, maker, details) VALUES ('delete', old.rowid, old.title, old.actress, old.genre, old.maker, old.details); END;",
        "CREATE TRIGGER IF NOT EXISTS missav_videos_au AFTER UPDATE ON missav_videos BEGIN INSERT INTO missav_videos_fts(missav_videos_fts, rowid, title, actress, genre, maker, details) VALUES ('delete', old.rowid, old.title, old.actress, old.genre, old.maker, old.details); INSERT INTO missav_videos_fts(rowid, title, actress, genre, maker, details) VALUES (new.rowid, new.title, new.actress, new.genre, new.maker, new.details); END;"
    ]:
        conn.execute(trigger_sql)

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

    conn.execute('''
        CREATE TABLE IF NOT EXISTS configs (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')

    conn.execute('''
        CREATE VIRTUAL TABLE IF NOT EXISTS javtiful_videos_fts USING fts5(
            title, actress, genre, maker, details,
            content='javtiful_videos', content_rowid='rowid'
        )
    ''')
    for trigger_sql in [
        "CREATE TRIGGER IF NOT EXISTS javtiful_videos_ai AFTER INSERT ON javtiful_videos BEGIN INSERT INTO javtiful_videos_fts(rowid, title, actress, genre, maker, details) VALUES (new.rowid, new.title, new.actress, new.genre, new.maker, new.details); END;",
        "CREATE TRIGGER IF NOT EXISTS javtiful_videos_ad AFTER DELETE ON javtiful_videos BEGIN INSERT INTO javtiful_videos_fts(javtiful_videos_fts, rowid, title, actress, genre, maker, details) VALUES ('delete', old.rowid, old.title, old.actress, old.genre, old.maker, old.details); END;",
        "CREATE TRIGGER IF NOT EXISTS javtiful_videos_au AFTER UPDATE ON javtiful_videos BEGIN INSERT INTO javtiful_videos_fts(javtiful_videos_fts, rowid, title, actress, genre, maker, details) VALUES ('delete', old.rowid, old.title, old.actress, old.genre, old.maker, old.details); INSERT INTO javtiful_videos_fts(rowid, title, actress, genre, maker, details) VALUES (new.rowid, new.title, new.actress, new.genre, new.maker, new.details); END;"
    ]:
        conn.execute(trigger_sql)
        
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM javtiful_videos_fts")
    if cursor.fetchone()[0] == 0:
        cursor.execute('''
            INSERT INTO javtiful_videos_fts(rowid, title, actress, genre, maker, details)
            SELECT rowid, title, actress, genre, maker, details FROM javtiful_videos
        ''')
    conn.commit()
    return conn

def get_media_db_connection(db_path, limit_buffer='200M'):
    os.makedirs(os.path.dirname(os.path.abspath(db_path)) or '.', exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute('PRAGMA journal_mode=WAL;')
    
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
            print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Media DB] Lỗi khi set limit buffer: {e} ❌")
            
    conn.execute('''
        CREATE TABLE IF NOT EXISTS media (
            id TEXT PRIMARY KEY,
            data BLOB,
            content_type TEXT
        )
    ''')
    conn.commit()
    return conn

def extract_media_from_main_db(db_conn, media_db_conn):
    cursor = db_conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='media'")
    if cursor.fetchone():
        print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Đang di chuyển dữ liệu ảnh (Media) sang database riêng... ⏳")
        cursor.execute("SELECT id, data, content_type FROM media")
        while True:
            rows = cursor.fetchmany(500)
            if not rows:
                break
            media_cursor = media_db_conn.cursor()
            media_cursor.execute("BEGIN TRANSACTION;")
            media_cursor.executemany("INSERT OR IGNORE INTO media (id, data, content_type) VALUES (?, ?, ?)", rows)
            media_db_conn.commit()
            
        cursor.execute("DROP TABLE media")
        cursor.execute("VACUUM")
        db_conn.commit()
        print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Di chuyển dữ liệu ảnh hoàn tất. ✔️")

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
            print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Load tags cache error: {e} ❌")

def rebuild_tags_fts(db_conn):
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Đang tổng hợp dữ liệu actress, genre, maker... ⏳")
    cursor = db_conn.cursor()
    cursor.execute("SELECT actress, genre, maker FROM javtiful_videos UNION ALL SELECT actress, genre, maker FROM vlxx_videos UNION ALL SELECT actress, genre, maker FROM javmost_videos UNION ALL SELECT actress, genre, maker FROM sextop1_videos UNION ALL SELECT actress, genre, maker FROM javtrailer_videos UNION ALL SELECT actress, genre, maker FROM missav_videos")
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
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Hoàn tất tổng hợp tags. ✔️")

class BackgroundScanner(threading.Thread):
    def __init__(self, scraper, db_conn):
        super().__init__(daemon=True)
        self.scraper = scraper
        self.db_conn = db_conn

    def run(self):
        self.scraper.update_sync_tasks_from_menu()
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
                with db_lock:
                    cursor = self.db_conn.cursor()
                    cursor.execute("SELECT url_pattern FROM sync_tasks ORDER BY CASE WHEN url_pattern LIKE '%chinese-av%' THEN 0 ELSE 1 END")
                    tasks = cursor.fetchall()
                
                for task in tasks:
                    url_pattern = task[0]
                    if not self.scraper.can_handle(url_pattern): continue
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
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Lỗi kiểm tra video mới ({self.scraper.get_table_name()}): {e} ❌")
                
            last_scan_time = time.time()
            
    def details_scan_loop(self):
        global global_last_request_time
        while True:
            time.sleep(0.5)
            try:
                if time.time() - global_last_request_time < CLIENT_IDLE_TIMEOUT:
                    continue
                    
                with db_lock:
                    cursor = self.db_conn.cursor()
                    cursor.execute(f"SELECT id FROM {self.scraper.get_table_name()} WHERE details_fetched = 0 ORDER BY added_at ASC LIMIT 1")
                    row = cursor.fetchone()
                    
                if row:
                    vid_id = row[0]
                    self.scraper.sync_video_details(vid_id)
            except Exception as e:
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Lỗi quét chi tiết ({self.scraper.get_table_name()}): {e} ❌")

    def backlog_scan_loop(self):
        global global_last_request_time

        while True:
            time.sleep(1)
            try:
                if time.time() - global_last_request_time < CLIENT_IDLE_TIMEOUT:
                    continue
                    
                with db_lock:
                    cursor = self.db_conn.cursor()
                    cursor.execute("SELECT url_pattern, current_page, total_pages FROM sync_tasks WHERE is_completed = 0 ORDER BY CASE WHEN url_pattern LIKE '%chinese-av%' THEN 0 ELSE 1 END")
                    tasks = cursor.fetchall()
                    
                if not tasks:
                    time.sleep(10)
                    continue
                    
                for task in tasks:
                    if time.time() - global_last_request_time < CLIENT_IDLE_TIMEOUT:
                        break
                        
                    url_pattern, current_page, total_pages = task
                    if not self.scraper.can_handle(url_pattern): continue
                    
                    if current_page > total_pages or current_page > 2000:
                        with db_lock:
                            cursor = self.db_conn.cursor()
                            cursor.execute("UPDATE sync_tasks SET is_completed = 1 WHERE url_pattern = ?", (url_pattern,))
                            self.db_conn.commit()
                        continue
                        
                    new_inserted, found, extracted_total = self.scraper.sync_list_page(url_pattern, current_page)
                        
                    if found == -1:
                        time.sleep(5)
                        continue
                        
                    with db_lock:
                        cursor = self.db_conn.cursor()
                        next_page = current_page + 1
                        new_total = extracted_total if extracted_total > 0 else total_pages
                        is_completed = 1 if (next_page > new_total or next_page > 2000 or found == 0) else 0
                        cursor.execute("UPDATE sync_tasks SET current_page = ?, total_pages = ?, last_fetched = ?, is_completed = ? WHERE url_pattern = ?", 
                                       (next_page, new_total, int(time.time()), is_completed, url_pattern))
                        self.db_conn.commit()
                    
                    time.sleep(1)
            except Exception as e:
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Lỗi backlog scanner ({self.scraper.get_table_name()}): {e} ❌")

app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False
import logging
log = logging.getLogger('werkzeug')
log.disabled = True

@app.route('/api/sources', methods=['GET'])
def get_sources():
    return jsonify({"success": True, "sources": sorted(list(scraper_instances.keys()))})

scraper_instances = {}
db_conn_instance = None
media_db_conn_instance = None
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
    now_str = datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]
    print(f"{now_str} [API] {request.remote_addr} {request.method} {response.status_code} {request.full_path}")
    response.headers.add('Access-Control-Allow-Origin', '*')
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

def parse_search_query(search_key):
    terms = []
    pattern = r'(?P<field>actress|genre|maker|title)\s*:\s*(?:"(?P<val1>[^"]+)"|(?P<val2>[^\s]+))'
    
    def repl(m):
        field = m.group('field').lower()
        val = m.group('val1') or m.group('val2')
        safe_val = ' '.join([f'"{w}"*' for w in val.replace('"', '').split()])
        if safe_val:
            terms.append(f"{field} : ({safe_val})")
        return ""
        
    remaining = re.sub(pattern, repl, search_key, flags=re.IGNORECASE).strip()
    if remaining:
        safe_rem = ' '.join([f'"{w}"*' for w in remaining.replace('"', '').split()])
        if safe_rem:
            terms.append(f"({safe_rem})")
            
    return ' AND '.join(terms) if terms else ""

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
    source = request.args.get('source', 'all')
    tables_to_query = list(scraper_instances.keys()) if source == 'all' or not source else [s.strip() for s in source.split(',')]
    
    count_all = 0
    count_fav = 0
    count_recent = 0
    count_global = 0

    with db_lock:
        cursor = db_conn_instance.cursor()
        for src in tables_to_query:
            if src not in scraper_instances: continue
            
            if src == 'fshare':
                from_clause = "fshare_videos v LEFT JOIN movies m ON v.video_dvd = m.dvd"
                where_clauses = ["v.status = 1"]
                search_params = []
                
                if search_key:
                    clean_key = re.sub(r'(actress|genre|maker|title)\s*:\s*', '', search_key, flags=re.IGNORECASE)
                    words = [w.replace('"', '').strip() for w in clean_key.split() if w.replace('"', '').strip()]
                    for word in words:
                        if word.upper() not in ['AND', 'OR']:
                            where_clauses.append("(m.title LIKE ? OR m.actress LIKE ? OR m.maker LIKE ? OR m.genre LIKE ? OR v.file_name LIKE ? OR v.fshare_title LIKE ?)")
                            search_params.extend([f"%{word}%"] * 6)
                            
                where_all = "WHERE " + " AND ".join(where_clauses)
                cursor.execute(f"SELECT COUNT(*) FROM {from_clause} {where_all}", search_params)
                count_all += cursor.fetchone()[0]
                
                if identifier:
                    where_fav = "WHERE f.username = ?" + (" AND " + " AND ".join(where_clauses) if where_clauses else "")
                    cursor.execute(f"SELECT COUNT(*) FROM favorites f JOIN {from_clause} ON f.video_id = v.file_code {where_fav}", [identifier] + search_params)
                    count_fav += cursor.fetchone()[0]
                    
                    where_hist = "WHERE h.username = ?" + (" AND " + " AND ".join(where_clauses) if where_clauses else "")
                    cursor.execute(f"SELECT COUNT(*) FROM history h JOIN {from_clause} ON h.video_id = v.file_code {where_hist}", [identifier] + search_params)
                    count_recent += cursor.fetchone()[0]
                
                cursor.execute(f"SELECT COUNT(DISTINCT h.video_id) FROM history h JOIN {from_clause} ON h.video_id = v.file_code {where_all}", search_params)
                count_global += cursor.fetchone()[0]
                continue

            table_name = scraper_instances[src].get_table_name()
            fts_table = table_name + '_fts'
            
            search_where_v = ""
            search_params = []
            fts_join = ""
            
            if search_key:
                fts_query = parse_search_query(search_key)
                if fts_query:
                    fts_join = f" JOIN {fts_table} ON v.rowid = {fts_table}.rowid"
                    search_where_v = f"{fts_table} MATCH ?"
                    search_params.append(fts_query)

            where_all = ("WHERE " + search_where_v) if search_where_v else ""
            cursor.execute(f"SELECT COUNT(*) FROM {table_name} v {fts_join} {where_all}", search_params)
            count_all += cursor.fetchone()[0]
            
            if identifier:
                where_fav = "WHERE f.username = ?" + (f" AND {search_where_v}" if search_where_v else "")
                cursor.execute(f"SELECT COUNT(*) FROM favorites f JOIN {table_name} v ON f.video_id = v.id {fts_join} {where_fav}", [identifier] + search_params)
                count_fav += cursor.fetchone()[0]
                
                where_hist = "WHERE h.username = ?" + (f" AND {search_where_v}" if search_where_v else "")
                cursor.execute(f"SELECT COUNT(*) FROM history h JOIN {table_name} v ON h.video_id = v.id {fts_join} {where_hist}", [identifier] + search_params)
                count_recent += cursor.fetchone()[0]
            
            where_glob = ("WHERE " + search_where_v) if search_where_v else ""
            cursor.execute(f"SELECT COUNT(DISTINCT h.video_id) FROM history h JOIN {table_name} v ON h.video_id = v.id {fts_join} {where_glob}", search_params)
            count_global += cursor.fetchone()[0]

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
    source = request.args.get('source', 'all')
    tables_to_query = list(scraper_instances.keys()) if source == 'all' or not source else [s.strip() for s in source.split(',')]

    with db_lock:
        cursor = db_conn_instance.cursor()
        union_queries = []
        union_params = []
        
        safe_key = ""
        if search_key:
            safe_key = parse_search_query(search_key)
            
        for src in tables_to_query:
            if src not in scraper_instances: continue
            
            if src == 'fshare':
                from_clause = "fshare_videos v LEFT JOIN movies m ON v.video_dvd = m.dvd"
                select_cols = f"'{src}' as source, v.file_code as id, COALESCE(m.title, v.fshare_title, v.file_name) as title, m.cover as cover, '' as url, m.release_date as release_date, m.actress as actress, m.genre as genre, m.maker as maker, m.details as details, datetime(v.create_date, 'unixepoch', 'localtime') as added_at"
                where_clauses = ["v.status = 1"]
                params = []
                
                if tab == 'favorites':
                    if not identifier: continue
                    from_clause += " JOIN favorites f ON v.file_code = f.video_id"
                    where_clauses.append("f.username = ?")
                    params.append(identifier)
                    select_cols += ", f.added_at as extra_sort1, 0 as extra_sort2"
                elif tab in ['recent', 'frequent']:
                    if not identifier: continue
                    from_clause += " JOIN history h ON v.file_code = h.video_id"
                    where_clauses.append("h.username = ?")
                    params.append(identifier)
                    if tab == 'recent': select_cols += ", h.last_watched as extra_sort1, 0 as extra_sort2"
                    else: select_cols += ", h.watch_count as extra_sort1, 0 as extra_sort2"
                elif tab == 'global_frequent':
                    from_clause += " JOIN (SELECT video_id, SUM(watch_count) as total_watches FROM history GROUP BY video_id) h ON v.file_code = h.video_id"
                    select_cols += ", h.total_watches as extra_sort1, 0 as extra_sort2"
                elif tab == 'trending_day':
                    day_ago = int(time.time()) - 86400
                    from_clause += " JOIN (SELECT video_id, COUNT(*) as c FROM history_logs WHERE watched_at > ? GROUP BY video_id) h ON v.file_code = h.video_id"
                    params.append(day_ago)
                    select_cols += ", h.c as extra_sort1, 0 as extra_sort2"
                elif tab == 'trending_month':
                    month_ago = int(time.time()) - 30*86400
                    from_clause += " JOIN (SELECT video_id, COUNT(*) as c FROM history_logs WHERE watched_at > ? GROUP BY video_id) h ON v.file_code = h.video_id"
                    params.append(month_ago)
                    select_cols += ", h.c as extra_sort1, 0 as extra_sort2"
                else:
                    select_cols += ", 0 as extra_sort1, 0 as extra_sort2"
                    
                if search_key:
                    select_cols += ", 0 as bm25_score"
                    clean_key = re.sub(r'(actress|genre|maker|title)\s*:\s*', '', search_key, flags=re.IGNORECASE)
                    words = [w.replace('"', '').strip() for w in clean_key.split() if w.replace('"', '').strip()]
                    for word in words:
                        if word.upper() not in ['AND', 'OR']:
                            where_clauses.append("(m.title LIKE ? OR m.actress LIKE ? OR m.maker LIKE ? OR m.genre LIKE ? OR v.file_name LIKE ? OR v.fshare_title LIKE ?)")
                            params.extend([f"%{word}%"] * 6)
                else:
                    select_cols += ", 0 as bm25_score"

                where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
                union_queries.append(f"SELECT {select_cols} FROM {from_clause} {where_sql}")
                union_params.extend(params)
                continue

            table_name = scraper_instances[src].get_table_name()
            fts_table = table_name + '_fts'
            
            where_clauses = []
            params = []
            from_clause = f"{table_name} v"
            select_cols = f"'{src}' as source, v.id, v.title, v.cover, v.url, v.release_date, v.actress, v.genre, v.maker, v.details, v.added_at"
            
            if tab == 'favorites':
                if not identifier: continue
                from_clause = f"{table_name} v JOIN favorites f ON v.id = f.video_id"
                where_clauses.append("f.username = ?")
                params.append(identifier)
                select_cols += ", f.added_at as extra_sort1, 0 as extra_sort2"
            elif tab in ['recent', 'frequent']:
                if not identifier: continue
                from_clause = f"{table_name} v JOIN history h ON v.id = h.video_id"
                where_clauses.append("h.username = ?")
                params.append(identifier)
                if tab == 'recent': select_cols += ", h.last_watched as extra_sort1, 0 as extra_sort2"
                else: select_cols += ", h.watch_count as extra_sort1, 0 as extra_sort2"
            elif tab == 'global_frequent':
                from_clause = f"{table_name} v JOIN (SELECT video_id, SUM(watch_count) as total_watches FROM history GROUP BY video_id) h ON v.id = h.video_id"
                select_cols += ", h.total_watches as extra_sort1, 0 as extra_sort2"
            elif tab == 'trending_day':
                day_ago = int(time.time()) - 86400
                from_clause = f"{table_name} v JOIN (SELECT video_id, COUNT(*) as c FROM history_logs WHERE watched_at > ? GROUP BY video_id) h ON v.id = h.video_id"
                params.append(day_ago)
                select_cols += ", h.c as extra_sort1, 0 as extra_sort2"
            elif tab == 'trending_month':
                month_ago = int(time.time()) - 30*86400
                from_clause = f"{table_name} v JOIN (SELECT video_id, COUNT(*) as c FROM history_logs WHERE watched_at > ? GROUP BY video_id) h ON v.id = h.video_id"
                params.append(month_ago)
                select_cols += ", h.c as extra_sort1, 0 as extra_sort2"
            else:
                select_cols += ", 0 as extra_sort1, 0 as extra_sort2"
                
            if safe_key:
                from_clause += f" JOIN {fts_table} ON v.rowid = {fts_table}.rowid"
                where_clauses.append(f"{fts_table} MATCH ?")
                params.append(safe_key)
                select_cols += f", bm25({fts_table}, 5.0, 10.0, 2.0, 1.0, 0.5) as bm25_score"
            else:
                select_cols += ", 0 as bm25_score"

            where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
            union_queries.append(f"SELECT {select_cols} FROM {from_clause} {where_sql}")
            union_params.extend(params)
            
        if not union_queries:
            return jsonify({"items": [], "total": 0, "page": page})

        full_query = " UNION ALL ".join(union_queries)
        
        if tab == 'global_frequent' and not search_key:
            cursor.execute("SELECT COUNT(DISTINCT video_id) FROM history")
            total = cursor.fetchone()[0]
        else:
            cursor.execute(f"SELECT COUNT(*) FROM ({full_query})", union_params)
            total = cursor.fetchone()[0]
            
        if tab == 'favorites':
            order_clause = "ORDER BY release_date DESC, extra_sort1 DESC"
        elif tab == 'recent':
            order_clause = "ORDER BY extra_sort1 DESC, release_date DESC"
        elif tab in ['frequent', 'global_frequent', 'trending_day', 'trending_month']:
            order_clause = "ORDER BY extra_sort1 DESC, release_date DESC"
        elif safe_key:
            order_clause = "ORDER BY release_date DESC, bm25_score ASC, added_at DESC"
        else:
            order_clause = "ORDER BY release_date DESC, added_at DESC"
            
        final_query = f"SELECT id, title, cover, url, release_date, actress, genre, maker, details, source FROM ({full_query}) {order_clause} LIMIT ? OFFSET ?"
        cursor.execute(final_query, union_params + [per_page, offset])
        rows = cursor.fetchall()
        
    videos = []
    for row in rows:
        cover_url = row[2]
        source = row[9] if len(row) > 9 else ''
        if cover_url:
            cover_url = f"/api/media?id={row[0]}&source={source}&url={quote(cover_url)}"
        else:
            cover_url = f"/api/media?id={row[0]}"

        videos.append({
            "id": row[0],
            "title": row[1],
            "cover": cover_url,
            "url": row[3],
            "release_date": row[4] if len(row) > 4 else '',
            "actress": row[5] if len(row) > 5 else '',
            "genre": row[6] if len(row) > 6 else '',
            "maker": row[7] if len(row) > 7 else '',
            "details": row[8] if len(row) > 8 else '',
            "source": row[9] if len(row) > 9 else ''
        })
    return jsonify({"items": videos, "total": total, "page": page})

@app.route('/api/related', methods=['GET'])
def get_related():
    vid_id = request.args.get('id', '')
    source = request.args.get('source', '')
    if not vid_id:
        return jsonify({"items": []})
        
    row = None
    with db_lock:
        cursor = db_conn_instance.cursor()
        if source and source in scraper_instances:
            if source != 'fshare':
                table_name = scraper_instances[source].get_table_name()
                cursor.execute(f"SELECT title, actress, genre, maker FROM {table_name} WHERE id = ?", (vid_id,))
                row = cursor.fetchone()
            else:
                cursor.execute("SELECT m.title, m.actress, m.genre, m.maker FROM fshare_videos v JOIN movies m ON v.video_dvd = m.dvd WHERE v.file_code = ?", (vid_id,))
                row = cursor.fetchone()
        else:
            for src, scraper in scraper_instances.items():
                if src == 'fshare':
                    cursor.execute("SELECT m.title, m.actress, m.genre, m.maker FROM fshare_videos v JOIN movies m ON v.video_dvd = m.dvd WHERE v.file_code = ?", (vid_id,))
                    row = cursor.fetchone()
                else:
                    table_name = scraper.get_table_name()
                    cursor.execute(f"SELECT title, actress, genre, maker FROM {table_name} WHERE id = ?", (vid_id,))
                    row = cursor.fetchone()
                if row: break
        
    if not row:
        return jsonify({"items": []})
        
    title, actress, genre, maker = row
    
    keywords = extract_clean_keywords_bulletproof(title) if title else []
            
    query_parts = []
    if actress:
        actresses = [a.strip() for a in actress.split(',') if a.strip()]
        if actresses:
            actress_query = ' OR '.join([f'"{a}"' for a in actresses])
            query_parts.append(f'actress : ({actress_query})')
    if genre:
        genres = [g.strip() for g in genre.split(',') if g.strip()]
        if genres:
            genre_query = ' OR '.join([f'"{g}"' for g in genres])
            query_parts.append(f'genre : ({genre_query})')
    if maker:
        if maker.strip():
            query_parts.append(f'maker : "{maker.strip()}"')
        
    if keywords:
        kw_str = ' OR '.join([f'"{k}"*' for k in keywords[:5]])
        query_parts.append(f'title : ({kw_str})')
        
    fts_query = ' OR '.join([p for p in query_parts if p])
    
    if not fts_query:
        return jsonify({"items": []})
        
    tables_to_query = list(scraper_instances.keys()) if (source == 'all' or not source) else [source]
    union_queries = []
    union_params = []
    
    for src in tables_to_query:
        if src not in scraper_instances: continue
        
        if src == 'fshare':
            if not fts_query: continue
            from_clause = "fshare_videos v LEFT JOIN movies m ON v.video_dvd = m.dvd"
            select_cols = f"v.file_code as id, COALESCE(m.title, v.fshare_title, v.file_name) as title, m.cover as cover, '' as url, m.release_date as release_date, m.actress as actress, m.genre as genre, m.maker as maker, m.details as details, '{src}' as source, 0 as bm25_score"
            where_clauses = ["v.status = 1", "v.file_code != ?"]
            params = [vid_id]
            
            or_conditions = []
            for kw in keywords[:5]:
                or_conditions.append("(m.title LIKE ? OR m.actress LIKE ? OR m.maker LIKE ? OR m.genre LIKE ?)")
                params.extend([f"%{kw}%"] * 4)
                
            if or_conditions:
                where_clauses.append("(" + " OR ".join(or_conditions) + ")")
                
            where_sql = "WHERE " + " AND ".join(where_clauses)
            union_queries.append(f"SELECT {select_cols} FROM {from_clause} {where_sql}")
            union_params.extend(params)
            continue
            
        table_name = scraper_instances[src].get_table_name()
        fts_table = table_name + '_fts'
        union_queries.append(f'''
            SELECT v.id, v.title, v.cover, v.url, v.release_date, v.actress, v.genre, v.maker, v.details, '{src}' as source, bm25({fts_table}, 5.0, 10.0, 2.0, 1.0, 0.5) as bm25_score
            FROM {table_name} v
            JOIN {fts_table} ON v.rowid = {fts_table}.rowid
            WHERE {fts_table} MATCH ? AND v.id != ?
        ''')
        union_params.extend([fts_query, vid_id])
        
    if not union_queries:
        return jsonify({"items": []})
        
    full_query = " UNION ALL ".join(union_queries)
    
    with db_lock:
        cursor = db_conn_instance.cursor()
        sql = f'''
            SELECT * FROM ({full_query})
            ORDER BY bm25_score ASC, release_date DESC
            LIMIT 12
        '''
        try:
            cursor.execute(sql, union_params)
            rows = cursor.fetchall()
        except Exception as e:
            print("FTS Related Error:", e)
            rows = []
            
    videos = []
    for row in rows:
        cover_url = row[2]
        source = row[9] if len(row) > 9 else ''
        if cover_url:
            cover_url = f"/api/media?id={row[0]}&source={source}&url={quote(cover_url)}"
        else:
            cover_url = f"/api/media?id={row[0]}"

        videos.append({
            "id": row[0],
            "title": row[1],
            "cover": cover_url,
            "url": row[3],
            "release_date": row[4] if row[4] else '',
            "actress": row[5] if row[5] else '',
            "genre": row[6] if row[6] else '',
            "maker": row[7] if row[7] else '',
            "details": row[8] if row[8] else '',
            "source": row[9] if len(row) > 9 else ''
        })
    return jsonify({"items": videos})

@app.route('/api/proxy', methods=['GET'])
def proxy_video():
    target_url = request.args.get('url', '')
    source = request.args.get('source', '')
    if not target_url:
        return Response(status=400)
        
    target_url = target_url.split('#')[0]
    client_range = request.headers.get('Range')
    
    if source and source in scraper_instances:
        scraper = scraper_instances[source]
    else:
        scraper = next((s for s in scraper_instances.values() if s.can_handle(target_url)), None)
        if not scraper and scraper_instances:
            scraper = list(scraper_instances.values())[0]
        
    if not scraper:
        return Response("No active scrapers available to handle this request", status=500)

    source_name = source.capitalize() if source else (scraper.get_table_name().split('_')[0].capitalize() if scraper else "System")
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [{source_name}] [proxy] {target_url}")

    referer = f"https://{getattr(scraper, 'domain', 'javtiful.com').rstrip('/')}/"
    headers = {"Referer": referer}
        
    now_str = datetime.datetime.now().strftime('%y%m%d_%H%M%S.%f')[:-3]
    domain = urlparse(target_url).netloc

    try:
        is_m3u8 = target_url.split('?')[0].endswith('.m3u8') or target_url.split('?')[0].endswith('.vl')
        if is_m3u8:
            res = scraper.session.get(target_url, headers=headers, timeout=15)
            resp_headers = {k: v for k, v in res.headers.items() if k.lower() not in ['content-encoding', 'transfer-encoding', 'content-length', 'connection', 'access-control-allow-origin']}
            resp_headers['Access-Control-Allow-Origin'] = '*'
            resp_headers['Content-Type'] = 'application/x-mpegURL'
            
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
                    new_content.append(f"/api/proxy?source={source}&url={quote(new_url)}")
            body = '\n'.join(new_content).encode('utf-8')
            return Response(body, status=res.status_code, headers=resp_headers)

        head_req = scraper.session.get(target_url, headers={"Referer": referer, "Range": "bytes=0-1"}, timeout=10)
        
        total_size = 0
        is_range_supported = False
        
        if head_req.status_code == 206:
            cr = head_req.headers.get('Content-Range', '')
            match = re.search(r'/(\d+)', cr)
            if match:
                total_size = int(match.group(1))
                is_range_supported = True
                
        # Nếu Server không hỗ trợ tải nhiều luồng / không trả về size, dùng Proxy 1 luồng cơ bản
        if not is_range_supported or total_size == 0:
            if client_range:
                headers['Range'] = client_range
            res = scraper.session.get(target_url, headers=headers, timeout=15, stream=True)
            resp_headers = {k: v for k, v in res.headers.items() if k.lower() not in ['content-encoding', 'transfer-encoding', 'connection', 'access-control-allow-origin']}
            resp_headers['Access-Control-Allow-Origin'] = '*'
            
            def generate_fallback():
                for chunk in res.iter_content(chunk_size=128*1024):
                    if chunk:
                        yield chunk
                        global global_last_request_time
                        global_last_request_time = time.time()
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
            
        chunk_size = 256 * 1024  # 0.5MB mỗi khối (tối ưu cho 720p và tua cực mượt)
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
            
        def fetch_range(r):
            for _ in range(3): # Thử tối đa 3 lần nếu có lỗi tải khối này
                try:
                    res = scraper.session.get(target_url, headers={"Referer": referer, "Range": f"bytes={r[0]}-{r[1]}"}, timeout=15)
                    if res.status_code in (200, 206): return res.content
                except Exception:
                    time.sleep(1)
            return None
            
        def generate_multithread():
            global global_last_request_time
            executor = concurrent.futures.ThreadPoolExecutor(max_workers=6) # Sử dụng 8 luồng tải song song (cân bằng hoàn hảo)
            try:
                window_size = 8 # Giữ ở RAM tối đa 8 khối (8 * 0.5MB = 4MB) siêu nhẹ
                idx = 0
                while idx < len(ranges_to_fetch):
                    batch = ranges_to_fetch[idx:idx+window_size]
                    futures = [executor.submit(fetch_range, b) for b in batch]
                    for f in futures:
                        data = f.result()
                        if data:
                            # Trả về từng mảnh nhỏ 128KB để player dễ dàng hiển thị dần
                            for i in range(0, len(data), 128*1024):
                                yield data[i:i+128*1024]
                                global_last_request_time = time.time()
                        else:
                            return # Ngắt quá trình stream nếu gặp block lỗi nặng
                    idx += window_size
            finally:
                if sys.version_info >= (3, 9): executor.shutdown(wait=False, cancel_futures=True)
                else: executor.shutdown(wait=False)
                
        return Response(generate_multithread(), status=status_code, headers=resp_headers)
    except Exception as e:
        print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [{source_name}] [proxy] Error fetching {target_url}: {e} ❌")
        return Response(status=500)

@app.route('/api/sync', methods=['GET'])
def sync_api():
    with db_lock:
        cursor = db_conn_instance.cursor()
        cursor.execute("SELECT url_pattern FROM sync_tasks")
        tasks = cursor.fetchall()
    for task in tasks:
        scraper = next((s for s in scraper_instances.values() if s.can_handle(task[0])), None)
        if scraper:
            scraper.sync_list_page(task[0], 1)
    return jsonify({"success": True})

@app.route('/api/video_url', methods=['GET'])
def video_url_api():
    vid_id = request.args.get('id', '')
    source = request.args.get('source', '')
    force_refresh = request.args.get('refresh', '0').lower() in ['1', 'true', 'yes']
    
    if not source:
        with db_lock:
            cursor = db_conn_instance.cursor()
            for src, scraper in scraper_instances.items():
                if src == 'fshare':
                    try:
                        cursor.execute("SELECT file_code FROM fshare_videos WHERE file_code = ?", (vid_id,))
                        if cursor.fetchone():
                            source = src
                            break
                    except Exception:
                        pass
                else:
                    table_name = scraper.get_table_name()
                    try:
                        cursor.execute(f"SELECT id FROM {table_name} WHERE id = ?", (vid_id,))
                        if cursor.fetchone():
                            source = src
                            break
                    except Exception:
                        pass
                    
    url = None
    if source and source in scraper_instances:
        print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Đang extract link ở {source}")
        url = scraper_instances[source].get_video_url(vid_id, force_refresh=force_refresh)
    else:
        for src_name, scraper in scraper_instances.items():
            print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Đang extract link ở {src_name}")
            url = scraper.get_video_url(vid_id, force_refresh=force_refresh)
            if url:
                source = src_name
                break
            
    if url:
        return jsonify({"success": True, "url": url, "source": source})
    return jsonify({"success": False, "error": "Cannot extract URL"})

@app.route('/api/video_details', methods=['GET'])
def video_details_api():
    vid_id = request.args.get('id', '')
    source = request.args.get('source', '')
    if not vid_id:
        return jsonify({"success": False, "error": "Missing id"})
    
    row = None
    with db_lock:
        cursor = db_conn_instance.cursor()
        if source and source in scraper_instances:
            table_name = scraper_instances[source].get_table_name()
            cursor.execute(f"SELECT id, title, cover, url, release_date, actress, genre, maker, details, '{source}' FROM {table_name} WHERE id = ?", (vid_id,))
            row = cursor.fetchone()
        else:
            for src, scraper in scraper_instances.items():
                table_name = scraper.get_table_name()
                cursor.execute(f"SELECT id, title, cover, url, release_date, actress, genre, maker, details, '{src}' FROM {table_name} WHERE id = ?", (vid_id,))
                row = cursor.fetchone()
                if row: break
        
    if row:
        cover_url = row[2]
        source = row[9] if len(row) > 9 else ''
        if cover_url:
            cover_url = f"/api/media?id={row[0]}&source={source}&url={quote(cover_url)}"
        else:
            cover_url = f"/api/media?id={row[0]}"

        return jsonify({
            "success": True,
            "data": {
                "id": row[0],
                "title": row[1],
                "cover": cover_url,
                "url": row[3],
                "release_date": row[4] if row[4] else '',
                "actress": row[5] if row[5] else '',
                "genre": row[6] if row[6] else '',
                "maker": row[7] if row[7] else '',
                "details": row[8] if row[8] else '',
                "source": row[9] if len(row) > 9 else ''
            }
        })
    return jsonify({"success": False, "error": "Not found"})

@app.route('/api/media', methods=['GET'])
def media_api():
    vid_id = request.args.get('id', '')
    source = request.args.get('source', '')
    url_param = request.args.get('url', '')
    
    with memory_lock:
        media_in_buffer = db_buffer['media'].get(vid_id)
    if media_in_buffer:
        resp = make_response(media_in_buffer['data'])
        resp.headers['Content-Type'] = media_in_buffer['content_type'] or 'image/jpeg'
        resp.headers['Cache-Control'] = 'public, max-age=31536000'
        return resp
        
    with db_lock:
        cursor = media_db_conn_instance.cursor()
        cursor.execute("SELECT data, content_type FROM media WHERE id = ?", (vid_id,))
        row = cursor.fetchone()
        
    if row:
        resp = make_response(row[0])
        resp.headers['Content-Type'] = row[1] or 'image/jpeg'
        resp.headers['Cache-Control'] = 'public, max-age=31536000'
        return resp
        
    # Fallback: Download cover if not in media table
    cover_url = url_param
    if not cover_url:
        with db_lock:
            cursor = db_conn_instance.cursor()
            if source and source in scraper_instances:
                if source == 'fshare':
                    try:
                        cursor.execute("SELECT m.cover FROM fshare_videos v JOIN movies m ON v.video_dvd = m.dvd WHERE v.file_code = ?", (vid_id,))
                        vrow = cursor.fetchone()
                        if vrow and vrow[0]:
                            cover_url = vrow[0]
                    except Exception:
                        pass
                else:
                    table_name = scraper_instances[source].get_table_name()
                    try:
                        cursor.execute(f"SELECT cover FROM {table_name} WHERE id = ?", (vid_id,))
                        vrow = cursor.fetchone()
                        if vrow and vrow[0]:
                            cover_url = vrow[0]
                    except Exception:
                        pass
            if not cover_url:
                for src, scraper in scraper_instances.items():
                    if src == 'fshare':
                        try:
                            cursor.execute("SELECT m.cover FROM fshare_videos v JOIN movies m ON v.video_dvd = m.dvd WHERE v.file_code = ?", (vid_id,))
                            vrow = cursor.fetchone()
                            if vrow and vrow[0]:
                                cover_url = vrow[0]
                                source = src
                                break
                        except Exception:
                            pass
                    else:
                        table_name = scraper.get_table_name()
                        try:
                            cursor.execute(f"SELECT cover FROM {table_name} WHERE id = ?", (vid_id,))
                            vrow = cursor.fetchone()
                            if vrow and vrow[0]:
                                cover_url = vrow[0]
                                source = src
                                break
                        except Exception:
                            pass
                    
    if cover_url:
        if cover_url.startswith('//'):
            cover_url = 'https:' + cover_url
            
        if vid_id in downloading_media:
            for _ in range(100):
                time.sleep(0.1)
                if vid_id not in downloading_media:
                    break
            with memory_lock:
                media_in_buffer = db_buffer['media'].get(vid_id)
            if media_in_buffer:
                resp = make_response(media_in_buffer['data'])
                resp.headers['Content-Type'] = media_in_buffer['content_type'] or 'image/jpeg'
                resp.headers['Cache-Control'] = 'public, max-age=31536000'
                return resp
                
        downloading_media.add(vid_id)
        try:
            scraper = scraper_instances.get(source)
            if not scraper:
                scraper = next((s for s in scraper_instances.values() if s.can_handle(cover_url)), None)
            
            headers = {}
            if scraper:
                headers = {"Referer": f"https://{getattr(scraper, 'domain', 'missav.ai').rstrip('/')}/"}
                res = scraper.session.get(cover_url, headers=headers, timeout=10)
            else:
                import requests
                res = requests.get(cover_url, timeout=10)
                
            if res.status_code == 200:
                content_type = res.headers.get('Content-Type', 'image/jpeg')
                with memory_lock:
                    db_buffer['media'][vid_id] = {
                        'data': res.content,
                        'content_type': content_type
                    }
                resp = make_response(res.content)
                resp.headers['Content-Type'] = content_type
                resp.headers['Cache-Control'] = 'public, max-age=31536000'
                return resp
        except Exception as e:
            print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Media] Lỗi tải cover cho {vid_id}: {e} ❌")
        finally:
            downloading_media.discard(vid_id)

    return Response(status=404)

@app.route('/api/search_suggestions', methods=['GET'])
def search_suggestions():
    q = request.args.get('q', '').strip().lower()
    history_page = int(request.args.get('history_page', 1))
    source = request.args.get('source', 'all')
    tables_to_query = list(scraper_instances.keys()) if source == 'all' or not source else [s.strip() for s in source.split(',')]
    identifier = get_identifier()
    suggestions = []
    
    with db_lock:
        cursor = db_conn_instance.cursor()
        if identifier:
            per_page = 20
            offset = (history_page - 1) * per_page

            sql_history = ""
            params_history = []

            if not q:
                sql_history = "SELECT keyword FROM search_history WHERE username = ? ORDER BY searched_at DESC LIMIT ? OFFSET ?"
                params_history = [identifier, per_page, offset]
            elif history_page == 1:
                sql_history = "SELECT keyword FROM search_history WHERE username = ? AND keyword LIKE ? ORDER BY searched_at DESC LIMIT 10"
                params_history = [identifier, f'%{q}%']
            
            if sql_history:
                cursor.execute(sql_history, params_history)
                for r in cursor.fetchall():
                    suggestions.append({"text": r[0], "type": "history"})

    if history_page > 1:
        return jsonify({"success": True, "suggestions": suggestions})
            
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
        clean_q = re.sub(r'(actress|genre|maker|title)\s*:\s*"[^"]+"', ' ', q, flags=re.IGNORECASE)
        clean_q = re.sub(r'(actress|genre|maker|title)\s*:\s*', ' ', clean_q, flags=re.IGNORECASE)
        words = [w for w in clean_q.replace('"', '').split() if w]
        
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
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] FTS tags search error: {e} ❌")
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
                union_queries = []
                union_params = []
                for src in tables_to_query:
                    if src not in scraper_instances: continue
                    
                    if src == 'fshare':
                        where_clauses = []
                        for word in words:
                            if word.upper() not in ['AND', 'OR']:
                                where_clauses.append("(m.title LIKE ? OR v.file_name LIKE ? OR v.fshare_title LIKE ?)")
                                union_params.extend([f"%{word}%"] * 3)
                        
                        if where_clauses:
                            where_sql = " AND ".join(where_clauses)
                            union_queries.append(f'''
                                SELECT COALESCE(m.title, v.fshare_title, v.file_name) as title, v.file_code as id, '{src}' as source, 0 as bm25_score
                                FROM fshare_videos v
                                LEFT JOIN movies m ON v.video_dvd = m.dvd
                                WHERE v.status = 1 AND ({where_sql})
                            ''')
                        continue

                    table_name = scraper_instances[src].get_table_name()
                    fts_table = table_name + '_fts'
                    union_queries.append(f'''
                        SELECT v.title, v.id, '{src}' as source, bm25({fts_table}, 5.0, 10.0, 2.0, 1.0, 0.5) as bm25_score
                        FROM {table_name} v
                        JOIN {fts_table} ON v.rowid = {fts_table}.rowid
                        WHERE {fts_table} MATCH ?
                    ''')
                    union_params.append(f"title : ({safe_key_or})")
                if union_queries:
                    full_query = " UNION ALL ".join(union_queries)
                    cursor.execute(f"SELECT title, id, source FROM ({full_query}) ORDER BY bm25_score ASC LIMIT 10", union_params)
                    for row in cursor.fetchall():
                        t = row[0].strip()
                        if t:
                            match_title.append({"text": t[:80] + ("..." if len(t)>80 else ""), "type": "title", "id": row[1], "source": row[2]})
            except Exception as e:
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] FTS title search error: {e} ❌")
                
        for a in match_actress[:7]:
            suggestions.append({"text": a["text"], "type": "actress"})
        for g in match_genre[:7]:
            suggestions.append({"text": g["text"], "type": "genre"})
        for m in match_maker[:7]:
            suggestions.append({"text": m["text"], "type": "maker"})
            
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
    html_path = 'index.html'
    try:
        if not os.path.isabs(html_path):
            html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), html_path)
        with open(html_path, 'rb') as f:
            content = f.read()
        return Response(content, mimetype='text/html; charset=utf-8')
    except Exception as e:
        return Response(f"HTML not found: index.html ({e})", status=404)

def migrate_old_database(db_conn, media_db_conn, old_db_path, db_type='default'):
    if not os.path.exists(old_db_path):
        print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] Không tìm thấy file database cũ tại {old_db_path} ❌")
        return
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] Đang gắn (attach) database cũ từ {old_db_path} (loại: {db_type})... ⏳")
    try:
        cursor = db_conn.cursor()
        cursor.execute("ATTACH DATABASE ? AS old_db", (old_db_path,))
        
        media_cursor = media_db_conn.cursor()
        media_cursor.execute("ATTACH DATABASE ? AS old_db", (old_db_path,))
        
        if db_type == 'javtrailer':
            print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] ⏳ bảng javtrailer_videos, media, jobs.")
            try:
                cursor.execute('''
                    INSERT OR IGNORE INTO javtrailer_videos (id, title, cover, url, release_date, release_date_raw, actress, genre, maker, details, details_fetched)
                    SELECT dvd, title, image_url, trailer, release_date, release_date,
                           REPLACE(REPLACE(REPLACE(casts, '["', ''), '"]', ''), '","', ', '),
                           REPLACE(REPLACE(REPLACE(categories, '["', ''), '"]', ''), '","', ', '),
                           studio, director, detail_status
                    FROM old_db.javtrailer_videos
                    GROUP BY dvd
                ''')
                media_cursor.execute('''
                    INSERT OR IGNORE INTO media (id, data, content_type)
                    SELECT j.dvd, i.data, 'image/jpeg'
                    FROM old_db.images i
                    JOIN old_db.javtrailer_videos j ON i.url = j.image_url
                    WHERE i.data IS NOT NULL AND i.data != ''
                ''')
                cursor.execute("SELECT MAX(page) FROM old_db.javtrailer_jobs WHERE status = 2")
                max_page = cursor.fetchone()
                if max_page and max_page[0]:
                    cursor.execute("INSERT OR REPLACE INTO sync_tasks (url_pattern, current_page, is_completed) VALUES ('https://javtrailers.com/videos?page={page}', ?, 0)", (max_page[0] + 1,))
                db_conn.commit()
                media_db_conn.commit()
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] ✅ bảng javtrailer_videos, media, jobs.")
            except Exception as e:
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] Lỗi khi đồng bộ javtrailer: {e} ❌")

        elif db_type == 'missav':
            print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] ⏳ bảng missav_videos.")
            try:
                cursor.execute('''
                    INSERT OR IGNORE INTO missav_videos (id, title, cover, url, added_at, release_date, release_date_raw, actress, genre, maker, details, details_fetched)
                    SELECT id, title, cover, url,
                           CASE WHEN typeof(added_at) = 'integer' THEN datetime(added_at, 'unixepoch', 'localtime') ELSE added_at END, 
                           release_date, release_date, actress, genre, maker, details, details_fetched
                    FROM old_db.missav_videos
                    GROUP BY id
                ''')
                db_conn.commit()
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] ✅ bảng missav_videos.")
            except Exception as e:
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] Lỗi khi đồng bộ missav_videos: {e} ❌")
                
            tables_to_sync = ['media', 'identities', 'user_sessions', 'favorites', 'history', 'sync_tasks']
            for table in tables_to_sync:
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] ⏳ bảng {table}.")
                target_cursor = media_cursor if table == 'media' else cursor
                target_db_conn = media_db_conn if table == 'media' else db_conn
                
                try:
                    target_cursor.execute(f"PRAGMA table_info({table})")
                    new_cols = [row[1] for row in target_cursor.fetchall()]
                    
                    target_cursor.execute(f"PRAGMA old_db.table_info({table})")
                    old_cols = [row[1] for row in target_cursor.fetchall()]
                    
                    if not old_cols:
                        print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] Bảng {table} không tìm thấy trong file database cũ, bỏ qua. ⚠️")
                        continue
                        
                    common_cols = [col for col in new_cols if col in old_cols]
                    cols_str = ", ".join(common_cols)
                    
                    group_by_str = ""
                    if table == 'movies':
                        group_by_str = " GROUP BY dvd"
                    elif table.endswith('_videos') or table == 'media':
                        group_by_str = " GROUP BY id"
                    elif table in ['favorites', 'history']:
                        group_by_str = " GROUP BY username, video_id"
                    elif table == 'sync_tasks':
                        group_by_str = " GROUP BY url_pattern"
                    elif table == 'identities':
                        group_by_str = " GROUP BY username"
                    elif table == 'user_sessions':
                        group_by_str = " GROUP BY session_id"
                    elif table == 'search_history':
                        group_by_str = " GROUP BY username, keyword"
                        
                    if table == 'favorites':
                        target_cursor.execute(f"INSERT OR IGNORE INTO {table} ({cols_str}) SELECT username, video_id, CASE WHEN typeof(added_at) = 'integer' THEN datetime(added_at, 'unixepoch', 'localtime') ELSE added_at END FROM old_db.{table}{group_by_str}")
                    else:
                        target_cursor.execute(f"INSERT OR IGNORE INTO {table} ({cols_str}) SELECT {cols_str} FROM old_db.{table}{group_by_str}")
                    target_db_conn.commit()
                    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] Đã đồng bộ bảng {table}. ✔️")
                except Exception as e:
                    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] Lỗi khi đồng bộ bảng {table}: {e} ❌")

        elif db_type == 'fshare':
            print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] ⏳ bảng files -> fshare_videos.")
            try:
                cursor.execute("PRAGMA old_db.table_info(files)")
                old_cols = [row[1] for row in cursor.fetchall()]
                
                if old_cols:
                    if 'video_dvd' in old_cols:
                        cursor.execute("INSERT OR IGNORE INTO movies (dvd) SELECT DISTINCT video_dvd FROM old_db.files WHERE video_dvd IS NOT NULL")
                    
                    cursor.execute("PRAGMA table_info(fshare_videos)")
                    new_cols = [row[1] for row in cursor.fetchall()]
                    
                    common_cols = [col for col in new_cols if col in old_cols]
                    cols_str = ", ".join(common_cols)
                    
                    cursor.execute(f"INSERT OR IGNORE INTO fshare_videos ({cols_str}) SELECT {cols_str} FROM old_db.files GROUP BY file_code")
                    db_conn.commit()
                    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] ✅ bảng files -> fshare_videos.")
                else:
                    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] Bảng files không tìm thấy trong file database cũ, bỏ qua. ⚠️")
            except Exception as e:
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] Lỗi khi đồng bộ fshare_videos: {e} ❌")

        else:
            tables_to_sync = [
                'movies', 'javtiful_videos', 'vlxx_videos', 'javmost_videos', 'sextop1_videos', 'javtrailer_videos', 'missav_videos', 'media', 'identities', 'user_sessions', 
                'favorites', 'history', 'sync_tasks', 'history_logs', 'search_history'
            ]
            
            for table in tables_to_sync:
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] ⏳ bảng {table}.")
                target_cursor = media_cursor if table == 'media' else cursor
                target_db_conn = media_db_conn if table == 'media' else db_conn
                
                try:
                    target_cursor.execute(f"PRAGMA table_info({table})")
                    new_cols = [row[1] for row in target_cursor.fetchall()]
                    
                    target_cursor.execute(f"PRAGMA old_db.table_info({table})")
                    old_cols = [row[1] for row in target_cursor.fetchall()]
                    
                    if not old_cols:
                        print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] Bảng {table} không tìm thấy trong file database cũ, bỏ qua. ⚠️")
                        continue
                        
                    common_cols = [col for col in new_cols if col in old_cols]
                    cols_str = ", ".join(common_cols)
                    
                    group_by_str = ""
                    if table == 'movies':
                        group_by_str = " GROUP BY dvd"
                    elif table.endswith('_videos') or table == 'media':
                        group_by_str = " GROUP BY id"
                    elif table in ['favorites', 'history']:
                        group_by_str = " GROUP BY username, video_id"
                    elif table == 'sync_tasks':
                        group_by_str = " GROUP BY url_pattern"
                    elif table == 'identities':
                        group_by_str = " GROUP BY username"
                    elif table == 'user_sessions':
                        group_by_str = " GROUP BY session_id"
                    elif table == 'search_history':
                        group_by_str = " GROUP BY username, keyword"
                        
                    target_cursor.execute(f"INSERT OR IGNORE INTO {table} ({cols_str}) SELECT {cols_str} FROM old_db.{table}{group_by_str}")
                    target_db_conn.commit()
                    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] ✅ bảng {table}.")
                except Exception as e:
                    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] Lỗi khi đồng bộ bảng {table}: {e} ❌")
        
        cursor.execute("DETACH DATABASE old_db")
        media_cursor.execute("DETACH DATABASE old_db")
        print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] Hoàn tất đồng bộ dữ liệu từ {old_db_path}! ✔️")
    except Exception as e:
        print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Migration] Lỗi trong quá trình migration: {e} ❌")

def start_reloader():
    def reloader_thread():
        mtime = os.path.getmtime(__file__)
        while True:
            time.sleep(2)
            if os.path.getmtime(__file__) != mtime:
                print("\n[AutoReloader] Phát hiện thay đổi code, tự động khởi động lại...")
                os.execv(sys.executable, [sys.executable] + sys.argv)
    threading.Thread(target=reloader_thread, daemon=True).start()

def graceful_shutdown(sig=None, frame=None):
    print(f"\n{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Phát hiện tín hiệu đóng ứng dụng (Ctrl+C)... ⚠️")
    if db_conn_instance and media_db_conn_instance:
        try:
            print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Đang ghi nốt dữ liệu đệm (buffer) vào database... ⏳")
            flush_db_buffer(db_conn_instance, media_db_conn_instance)
            db_conn_instance.close()
            media_db_conn_instance.close()
        except Exception as e:
            print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Lỗi khi lưu DB: {e} ❌")

    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Đang dọn dẹp thư mục cache (__pycache__)... ⏳")
    base_dir = os.path.dirname(os.path.abspath(__file__)) or '.'
    for root, dirs, files in os.walk(base_dir):
        if '__pycache__' in dirs:
            cache_dir = os.path.join(root, '__pycache__')
            try:
                shutil.rmtree(cache_dir)
            except: pass
        for file in files:
            if file.endswith('.pyc') or file.endswith('.pyo'):
                try: os.remove(os.path.join(root, file))
                except: pass
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Đã dọn cache và đóng ứng dụng an toàn. ✔️")
    sys.exit(0)

def main():
    os_name = detect_os()
    default_db = 'javtiful.db'
    if os_name == 'windows':
        default_db = r'D:\database\movies-test.db'
    elif os_name == 'termux':
        default_db = '/sdcard/Projects/Database/movies.db'

    parser = argparse.ArgumentParser()
    parser.add_argument('-port', type=int, default=5000, help="Port to run the HTTP server on")
    parser.add_argument('-sqlite3', type=str, default=default_db, help="Path to the SQLite3 database file")
    parser.add_argument('-upgrade-all', action='store_true', help="Start scanning from page 1 instead of backlog")
    parser.add_argument('-emailPass', type=str, default="szywozapustydcuw", help="App password for email")
    parser.add_argument('-email', type=str, default="infor.dkeeps@gmail.com", help="Email to send OTP from")
    parser.add_argument('-old-sqlite3', action='append', default=[], help="Path to an old SQLite3 database to migrate data from")
    parser.add_argument('-old-javtrailer-sqlite3', action='append', default=[], help="Path to old djav.db for javtrailer")
    parser.add_argument('-old-missav-sqlite3', action='append', default=[], help="Path to old missav database")
    parser.add_argument('-old-javtiful-sqlite3', action='append', default=[], help="Path to old javtiful database")
    parser.add_argument('-old-fshare-sqlite3', action='append', default=[], help="Path to old fshare database (djav.db)")
    parser.add_argument('-sync-movies', action='store_true', help="Sync and identify reference keys with xxx_videos as JSON array in movies.xxx_ids")
    parser.add_argument('-limit-bufer', '-limit-buffer', type=str, default='200M', dest='limit_buffer', help="Limit memory buffer size to avoid Termux killing the process")
    parser.add_argument('-domain-vlxx', type=str, default='vlxx.moi', help="Domain for VLXX")
    parser.add_argument('-domain-javtiful', type=str, default='javtiful.com', help="Domain for Javtiful")
    parser.add_argument('-re-scan-vlxx', action='store_true', help="Start scanning VLXX from page 1")
    parser.add_argument('-domain-javmost', type=str, default='javmost.ws', help="Domain for Javmost")
    parser.add_argument('-re-scan-javmost', action='store_true', help="Start scanning Javmost from page 1")
    parser.add_argument('-domain-sextop1', type=str, default='sextop1.buzz', help="Domain for Sextop1")
    parser.add_argument('-re-scan-sextop1', action='store_true', help="Start scanning Sextop1 from page 1")
    parser.add_argument('-domain-javtrailer', type=str, default='javtrailers.com', help="Domain for Javtrailer")
    parser.add_argument('-re-scan-javtrailer', action='store_true', help="Start scanning Javtrailer from page 1")
    parser.add_argument('-domain-missav', type=str, default='missav.ai', help="Domain for MissAV")
    parser.add_argument('-re-scan-missav', action='store_true', help="Start scanning MissAV from page 1")
    parser.add_argument('-fs-email', type=str, default="writephudat@gmail.com", help="Fshare VIP Email")
    parser.add_argument('-fs-pass', type=str, default="2211Dat!", help="Fshare VIP Password")
    
    args = parser.parse_args()
    
    global db_conn_instance, media_db_conn_instance, scraper_instances, app_args
    app_args = args
    
    start_reloader()
    
    threading.Thread(target=resource_monitor_worker, daemon=True).start()
    
    base_name, ext = os.path.splitext(args.sqlite3)
    media_db_path = f"{base_name}_media{ext}"
    
    db_conn_instance = get_db_connection(args.sqlite3, args.limit_buffer)
    media_db_conn_instance = get_media_db_connection(media_db_path, args.limit_buffer)
    
    extract_media_from_main_db(db_conn_instance, media_db_conn_instance)
    
    for path in args.old_sqlite3:
        if path: migrate_old_database(db_conn_instance, media_db_conn_instance, path, 'default')
    for path in args.old_javtrailer_sqlite3:
        if path: migrate_old_database(db_conn_instance, media_db_conn_instance, path, 'javtrailer')
    for path in args.old_missav_sqlite3:
        if path: migrate_old_database(db_conn_instance, media_db_conn_instance, path, 'missav')
    for path in args.old_javtiful_sqlite3:
        if path: migrate_old_database(db_conn_instance, media_db_conn_instance, path, 'default')
    for path in args.old_fshare_sqlite3:
        if path: migrate_old_database(db_conn_instance, media_db_conn_instance, path, 'fshare')
        
    if args.sync_movies:
        sync_movies_references(db_conn_instance)

    rebuild_tags_fts(db_conn_instance)
    
    if args.upgrade_all:
        with db_lock:
            cursor = db_conn_instance.cursor()
            cursor.execute("UPDATE sync_tasks SET current_page = 1, is_completed = 0")
            db_conn_instance.commit()
    elif args.re_scan_vlxx:
        with db_lock:
            cursor = db_conn_instance.cursor()
            cursor.execute("UPDATE sync_tasks SET current_page = 1, is_completed = 0 WHERE url_pattern LIKE '%vlxx%'")
            db_conn_instance.commit()
    elif args.re_scan_javmost:
        with db_lock:
            cursor = db_conn_instance.cursor()
            cursor.execute("UPDATE sync_tasks SET current_page = 1, is_completed = 0 WHERE url_pattern LIKE '%javmost%'")
            db_conn_instance.commit()
    elif args.re_scan_sextop1:
        with db_lock:
            cursor = db_conn_instance.cursor()
            cursor.execute("UPDATE sync_tasks SET current_page = 1, is_completed = 0 WHERE url_pattern LIKE '%sextop1%'")
            db_conn_instance.commit()
    elif args.re_scan_javtrailer:
        with db_lock:
            cursor = db_conn_instance.cursor()
            cursor.execute("UPDATE sync_tasks SET current_page = 1, is_completed = 0 WHERE url_pattern LIKE '%javtrailer%'")
            db_conn_instance.commit()
    elif args.re_scan_missav:
        with db_lock:
            cursor = db_conn_instance.cursor()
            cursor.execute("UPDATE sync_tasks SET current_page = 1, is_completed = 0 WHERE url_pattern LIKE '%missav%'")
            db_conn_instance.commit()

    if 'javtiful' in scraper_classes:
        scraper_instances['javtiful'] = scraper_classes['javtiful'](db_conn_instance, db_lock, memory_lock, db_buffer, args.domain_javtiful)
    if 'vlxx' in scraper_classes:
        scraper_instances['vlxx'] = scraper_classes['vlxx'](db_conn_instance, db_lock, memory_lock, db_buffer, args.domain_vlxx)
    if 'javmost' in scraper_classes:
        scraper_instances['javmost'] = scraper_classes['javmost'](db_conn_instance, db_lock, memory_lock, db_buffer, args.domain_javmost)
    if 'sextop1' in scraper_classes:
        scraper_instances['sextop1'] = scraper_classes['sextop1'](db_conn_instance, db_lock, memory_lock, db_buffer, args.domain_sextop1)
    if 'javtrailer' in scraper_classes:
        scraper_instances['javtrailer'] = scraper_classes['javtrailer'](db_conn_instance, db_lock, memory_lock, db_buffer, args.domain_javtrailer)
    if 'missav' in scraper_classes:
        scraper_instances['missav'] = scraper_classes['missav'](db_conn_instance, db_lock, memory_lock, db_buffer, args.domain_missav)
    if 'fshare' in scraper_classes:
        scraper_instances['fshare'] = scraper_classes['fshare'](db_conn_instance, db_lock, memory_lock, db_buffer, args.fs_email, args.fs_pass)
    
    for scraper in scraper_instances.values():
        threading.Thread(target=scraper.warm_up, daemon=True).start()
        
    threading.Thread(target=background_db_worker, args=(db_conn_instance, media_db_conn_instance), daemon=True).start()
    
    for name, scraper in scraper_instances.items():
        scanner = BackgroundScanner(scraper, db_conn_instance)
        scanner.start()
    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [System] Javtiful Player worker started at http://localhost:{args.port} ✔️")
        
    signal.signal(signal.SIGINT, graceful_shutdown)
    signal.signal(signal.SIGTERM, graceful_shutdown)
    try:
        app.run(host='0.0.0.0', port=args.port, threaded=True, use_reloader=False)
    except KeyboardInterrupt:
        graceful_shutdown()

if __name__ == '__main__':
    main()