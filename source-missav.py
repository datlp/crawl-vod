import time
import datetime
import re
import threading
from curl_cffi import requests as curl_requests
from bs4 import BeautifulSoup

def parse_release_date(date_str):
    if not date_str:
        return ""
    date_str = date_str.strip().lower()
    if re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
        return f"{date_str} 00:00:00"
    return date_str

class Scraper:
    def __init__(self, db_conn, db_lock, memory_lock, db_buffer):
        self.db_conn = db_conn
        self.db_lock = db_lock
        self.memory_lock = memory_lock
        self.db_buffer = db_buffer
        self.session = curl_requests.Session(impersonate="chrome120")
        self.sync_lock = threading.Lock()
        self.referer = "https://missav.com/"

    def update_sync_tasks_from_menu(self):
        print("[Scraper] Khởi tạo sync_tasks cho MissAV...")
        tasks = [
            "https://missav.com/vi/new?page={page}",
            "https://missav.com/vi/uncensored-leak?page={page}",
            "https://missav.com/vi/genres/VR?page={page}",
            "https://missav.com/vi/chinese-subtitle?page={page}"
        ]
        with self.db_lock:
            cursor = self.db_conn.cursor()
            for url in tasks:
                cursor.execute("INSERT OR IGNORE INTO sync_tasks (url_pattern) VALUES (?)", (url,))
            self.db_conn.commit()

    def sync_list_page(self, url_pattern, page):
        with self.sync_lock:
            return self._sync_list_page(url_pattern, page)
            
    def _sync_list_page(self, url_pattern, page):
        url = url_pattern.replace("{page}", str(page))
        print(f"[Scraper] Syncing {url}")
        try:
            res = self.session.get(url, timeout=15)
            soup = BeautifulSoup(res.text, 'html.parser')
            videos = []
            
            total_pages = 2000
            last_page_link = soup.select('a[href*="?page="]')
            for a in last_page_link:
                try:
                    num = int(a.text.strip())
                    if num > total_pages:
                        total_pages = num
                except:
                    pass
            
            items = soup.select('div.thumbnail, div.max-w-64, div[class*="aspect-video"]') 
            if not items:
                items = soup.select('a[href*="missav.com/vi/"]')
                
            now = int(time.time())
            for idx, item in enumerate(items):
                a_tag = item if item.name == 'a' else item.select_one('a')
                if not a_tag: continue
                href = a_tag.get('href', '')
                
                if '/genres/' in href or '/makers/' in href or '/actresses/' in href or '?page=' in href: continue
                
                parts = href.split('/')
                vid_id = parts[-1]
                if not vid_id: continue
                
                img_tag = a_tag.select_one('img')
                if not img_tag and item.name != 'a':
                    img_tag = item.select_one('img')
                    
                cover = img_tag.get('data-src') or img_tag.get('src') if img_tag else ''
                title_tag = item.select_one('.text-secondary') or item.select_one('a.truncate') or a_tag
                title = title_tag.text.strip() if title_tag else vid_id
                
                if len(title) < 4: continue
                
                if vid_id and cover and "missav" in href:
                    pseudo_time = now - (page * 10000) - idx
                    added_at_dt = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(pseudo_time))
                    videos.append((vid_id, title, cover, added_at_dt, ""))
                    
            with self.db_lock:
                cursor = self.db_conn.cursor()
                new_count = 0
                for vid in set(videos):
                    vid_id = vid[0]
                    cursor.execute("SELECT id FROM javtiful_videos WHERE id = ?", (vid_id,))
                    if not cursor.fetchone():
                        with self.memory_lock:
                            if vid_id not in self.db_buffer['videos']:
                                new_count += 1
                    
                with self.memory_lock:
                    for vid in set(videos):
                        vid_id = vid[0]
                        self.db_buffer['videos'][vid_id] = {
                            'id': vid[0], 'title': vid[1], 'cover': vid[2], 'added_at': vid[3], 'release_date': vid[4]
                        }
            print(f"[Scraper] Synced {len(videos)} videos from {url} (New: {new_count}).")
            return new_count, len(videos), total_pages
        except Exception as e:
            print(f"[Scraper] Sync failed: {e}")
            return 0, -1, 0

    def get_video_url(self, vid_id, force_refresh=False):
        if not force_refresh:
            with self.memory_lock:
                url_in_buffer = self.db_buffer['video_urls'].get(vid_id)
            if url_in_buffer:
                return url_in_buffer
                    
            with self.db_lock:
                cursor = self.db_conn.cursor()
                cursor.execute("SELECT url FROM javtiful_videos WHERE id = ? AND url IS NOT NULL", (vid_id,))
                row = cursor.fetchone()
                if row and row[0]: return row[0]
            
        url = f"https://missav.com/vi/{vid_id}"
        print(f"[Scraper] Fetching video URL for {vid_id} at {url}")
        try:
            res = self.session.get(url, timeout=15)
            m3u8_url = None
            match = re.search(r'source\s*:\s*[\'"]([^\'"]+\.m3u8[^\'"]*)[\'"]', res.text)
            if match:
                m3u8_url = match.group(1).replace('\\/', '/')
            else:
                match2 = re.search(r'(https:\/\/[^\'"]+\.m3u8[^\'"]*)', res.text)
                if match2: m3u8_url = match2.group(1).replace('\\/', '/')
                    
            if m3u8_url:
                with self.memory_lock:
                    self.db_buffer['video_urls'][vid_id] = m3u8_url
                return m3u8_url
            return None
        except Exception as e:
            print(f"[Scraper] Failed to get video URL for {vid_id}: {e}")
            return None

    def sync_video_details(self, vid_id):
        with self.sync_lock:
            url = f"https://missav.com/vi/{vid_id}"
            try:
                res = self.session.get(url, timeout=15)
                if res.status_code != 200:
                    with self.db_lock:
                        cursor = self.db_conn.cursor()
                        cursor.execute("UPDATE javtiful_videos SET details_fetched = -1 WHERE id = ?", (vid_id,))
                        self.db_conn.commit()
                    return False
                soup = BeautifulSoup(res.text, 'html.parser')
                
                actress_arr = [a.text.strip() for a in soup.select('a[href*="/actresses/"]') if a.text.strip()]
                genre_arr = [a.text.strip() for a in soup.select('a[href*="/genres/"]') if a.text.strip()]
                
                maker_tag = soup.select_one('a[href*="/makers/"]')
                maker = maker_tag.text.strip() if maker_tag else ""
                
                date_match = re.search(r'\b(20\d{2}-\d{2}-\d{2})\b', res.text)
                release_date = date_match.group(1) + " 00:00:00" if date_match else ""
                
                desc_meta = soup.find('meta', {'name': 'description'})
                details = desc_meta.get('content', '') if desc_meta else ""
                
                with self.db_lock:
                    cursor = self.db_conn.cursor()
                    if release_date:
                        cursor.execute('''UPDATE javtiful_videos SET actress = ?, genre = ?, maker = ?, details = ?, release_date = ?, details_fetched = 1 WHERE id = ?''', (", ".join(set(actress_arr)), ", ".join(set(genre_arr)), maker, details, release_date, vid_id))
                    else:
                        cursor.execute('''UPDATE javtiful_videos SET actress = ?, genre = ?, maker = ?, details = ?, details_fetched = 1 WHERE id = ?''', (", ".join(set(actress_arr)), ", ".join(set(genre_arr)), maker, details, vid_id))
                    self.db_conn.commit()
                return True
            except Exception as e:
                print(f"[Scraper] Lỗi lấy chi tiết video {vid_id}: {e}")
                with self.db_lock:
                    cursor = self.db_conn.cursor()
                    cursor.execute("UPDATE javtiful_videos SET details_fetched = -1 WHERE id = ?", (vid_id,))
                    self.db_conn.commit()
                return False