import argparse
import os
import sys
import time
import datetime
import sqlite3
import threading
import importlib.util
import builtins
import queue
import json

def custom_log(category, message):
    now = datetime.datetime.now()
    timestamp = now.strftime('%y%m%d_%H%M%S_') + f"{now.microsecond // 1000:03d}"
    print(f"{timestamp} [{category}] {message}", flush=True)

builtins.custom_log = custom_log

DB_FLUSH_INTERVAL = 5

memory_lock = threading.Lock()
db_lock = threading.Lock()
db_buffer = {
    'videos': {},
    'video_urls': {},
    'media': {}
}

def flush_db_buffer(db_conn, table_name):
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
                    INSERT INTO {table_name} (id, title, cover, added_at, release_date, dvd)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        title = excluded.title,
                        cover = excluded.cover,
                        added_at = excluded.added_at,
                        release_date = excluded.release_date,
                        dvd = excluded.dvd
                ''', (vid['id'], vid['title'], vid['cover'], vid['added_at'], vid.get('release_date', ''), vid.get('dvd', '')))
                
            for vid_id, url in urls_to_save.items():
                cursor.execute(f"UPDATE {table_name} SET url = ? WHERE id = ?", (url, vid_id))
                
            for media_id, m in media_to_save.items():
                cursor.execute("INSERT OR REPLACE INTO media (id, data, content_type) VALUES (?, ?, ?)", (media_id, m['data'], m['content_type']))
                
            db_conn.commit()
            
        details_ids = ",".join(urls_to_save.keys())
        if videos_to_save or urls_to_save:
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

def background_db_worker(db_conn, table_name):
    while True:
        time.sleep(DB_FLUSH_INTERVAL)
        flush_db_buffer(db_conn, table_name)

def get_db_connection(db_path):
    os.makedirs(os.path.dirname(os.path.abspath(db_path)) or '.', exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute('PRAGMA journal_mode=WAL;')
    return conn

class BackgroundScanner(threading.Thread):
    def __init__(self, scraper, table_name, upgrade_all=False, news_threads=0, detail_threads=0, videos_threads=0):
        super().__init__(daemon=True)
        self.scraper = scraper
        self.table_name = table_name
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
        source_name = getattr(self.scraper, 'source_name', 'System')
        while True:
            try:
                url_pattern = self.news_queue.get(timeout=5)
            except queue.Empty:
                continue
                
            page = 1
            while True:
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
        source_name = getattr(self.scraper, 'source_name', 'System')
        while True:
            time.sleep(0.5)
            try:
                with db_lock:
                    cursor = self.scraper.db_conn.cursor()
                    cursor.execute(f"SELECT id FROM {self.table_name} WHERE details_fetched = 0 ORDER BY added_at ASC LIMIT 1")
                    row = cursor.fetchone()
                    if row:
                        vid_id = row[0]
                        cursor.execute(f"UPDATE {self.table_name} SET details_fetched = -2 WHERE id = ?", (vid_id,))
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
        source_name = getattr(self.scraper, 'source_name', 'System')
        domain_base = self.scraper.domain.split('.')[0].lower()
        src_lower = source_name.lower()
        while True:
            time.sleep(1)
            try:
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

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('-api', type=str, default="localhost:5004", help="API URL của server (nếu cần)")
    parser.add_argument('-detail-threads', type=int, default=0, help="Số luồng lấy chi tiết video")
    parser.add_argument('-news-threads', type=int, default=0, help="Số luồng quét video mới")
    parser.add_argument('-videos-threads', type=int, default=0, help="Số luồng quét video backlog")
    parser.add_argument('-upgrade-all', action='store_true', help="Quét lại từ page 1")
    
    args = parser.parse_args()
    
    try:
        import urllib.request
        api_url = f"http://{args.api}/api/config"
        req = urllib.request.Request(api_url)
        with urllib.request.urlopen(req) as response:
            config = json.loads(response.read().decode())
            args.source = config.get('source')
            args.domain = config.get('domain')
            args.sqlite3 = config.get('sqlite3')
    except Exception as e:
        custom_log("System", f"❌ Không thể lấy cấu hình từ server {args.api}: {e}")
        sys.exit(1)
        
    if not getattr(args, 'source', None) or not getattr(args, 'sqlite3', None):
        custom_log("System", "❌ Lỗi: Cấu hình trả về từ Server không hợp lệ.")
        sys.exit(1)

    table_name = f"{args.source}_videos"
    source_module = load_source_module(args.source)
    db_conn_instance = get_db_connection(args.sqlite3)
    
    if hasattr(source_module, 'setup_db'):
        source_module.setup_db(db_conn_instance, table_name)
    else:
        db_conn_instance.execute(f'''
            CREATE TABLE IF NOT EXISTS {table_name} (
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
        db_conn_instance.commit()
    
    scraper_instance = source_module.Scraper(db_conn_instance, db_lock, memory_lock, db_buffer, table_name, domain=args.domain)
    
    threading.Thread(target=background_db_worker, args=(db_conn_instance, table_name), daemon=True).start()
    
    scanner = BackgroundScanner(
        scraper_instance,
        table_name,
        upgrade_all=args.upgrade_all,
        news_threads=args.news_threads,
        detail_threads=args.detail_threads,
        videos_threads=args.videos_threads
    )
    scanner.start()
    
    custom_log("System", f"✔️ Crawler {args.source} started.")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        custom_log("System", "⚠️ Đang tắt crawler...")
        flush_db_buffer(db_conn_instance, table_name)
        db_conn_instance.close()
        sys.exit(0)

if __name__ == '__main__':
    main()