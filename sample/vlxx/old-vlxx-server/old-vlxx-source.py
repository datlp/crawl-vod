import sys
import os
import subprocess

def _check_dependencies():
    try:
        import bs4
        import curl_cffi
    except ImportError:
        print("[VlxxScraper] Đang cài đặt thư viện bắt buộc (beautifulsoup4, curl_cffi)...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "beautifulsoup4", "curl_cffi"])
        os.execv(sys.executable, [sys.executable] + sys.argv)

_check_dependencies()

import time
import datetime
import re
import json
import threading
from curl_cffi import requests as curl_requests
from bs4 import BeautifulSoup

# Có thể tái sử dụng parse_release_date nếu vlxx dùng format tương tự
from crawler.javtiful import parse_release_date

class VlxxScraper:
    def __init__(self, db_conn, db_lock, memory_lock, db_buffer, domain="vlxx.moi"):
        self.db_conn = db_conn
        self.db_lock = db_lock
        self.memory_lock = memory_lock
        self.db_buffer = db_buffer
        self.domain = domain.rstrip('/')
        self.session = curl_requests.Session(impersonate="chrome120")
        self.sync_lock = threading.Lock()
        
    def load_session(self):
        with self.db_lock:
            cursor = self.db_conn.cursor()
            cursor.execute("SELECT value FROM configs WHERE key = ?", (f"{self.get_table_name()}_cookies",))
            row = cursor.fetchone()
        if row and row[0]:
            try:
                cookies = json.loads(row[0])
                for k, v in cookies.items():
                    self.session.cookies.set(k, v, domain=f".{self.domain.replace('www.', '')}")
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Vlxx] Đã load session từ database.")
            except Exception:
                pass

    def save_session(self):
        cookies = self.session.cookies.get_dict()
        with self.db_lock:
            cursor = self.db_conn.cursor()
            cursor.execute("INSERT OR REPLACE INTO configs (key, value) VALUES (?, ?)", (f"{self.get_table_name()}_cookies", json.dumps(cookies)))
            self.db_conn.commit()

    def warm_up(self):
        self.load_session()
        fail_count = 0
        while True:
            try:
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Vlxx] Warming up session... ⏳")
                res = self.session.get(f"https://{self.domain}/", timeout=15)
                if res.status_code in [200, 301, 302, 403, 404]:
                    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Vlxx] Session is warm. ✔️")
                    fail_count = 0
                    self.save_session()
                else:
                    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Vlxx] Session warm-up unexpected status: {res.status_code} ⚠️")
                    fail_count += 1
            except Exception as e:
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Vlxx] Session warm-up failed: {e} ❌")
                fail_count += 1
                
            if fail_count >= 3:
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Vlxx] Re-initializing session to bypass Cloudflare... 🔄")
                self.session = curl_requests.Session(impersonate="chrome120")
                fail_count = 0
                
            time.sleep(180)
        
    def can_handle(self, url):
        return 'vlxx' in url or self.domain in url
        
    def get_table_name(self):
        return 'vlxx_videos'
        
    def update_sync_tasks_from_menu(self):
        print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Vlxx] Khởi tạo sync_tasks... ⏳")
        tasks = [
            f"https://{self.domain}/new/{{page}}/", 
            f"https://{self.domain}/jav/{{page}}/",
            f"https://{self.domain}/vietsub/{{page}}/",
            f"https://{self.domain}/khong-che/{{page}}/",
            f"https://{self.domain}/chau-au/{{page}}/"
        ]
        with self.db_lock:
            cursor = self.db_conn.cursor()
            for url in tasks:
                cursor.execute("INSERT OR IGNORE INTO sync_tasks (url_pattern) VALUES (?)", (url,))
            self.db_conn.commit()

    def sync_list_page(self, url_pattern, page):
        with self.sync_lock:
            url = url_pattern.replace("{page}", str(page))
            if page == 1:
                url = url.replace("new/1/", "")
                url = url.replace("1/", "")
            try:
                res = self.session.get(url, timeout=15)
                soup = BeautifulSoup(res.text, 'html.parser')
                videos = []
                total_pages = 0
                
                # Lấy tổng số trang để backlog quét không bị lố
                nav_links = soup.select('.pagenavi a[data-page]')
                for a in nav_links:
                    try:
                        p = int(a.get('data-page'))
                        if p > total_pages: total_pages = p
                    except: pass
                if total_pages == 0: total_pages = 2000
                
                items = soup.select('.video-item') 
                now = int(time.time())
                for idx, item in enumerate(items):
                    a_tag = item.select_one('a')
                    if not a_tag: continue
                    
                    href = a_tag.get('href', '').strip('/')
                    if not href.startswith('video/'): continue
                    
                    # Lưu toàn bộ đoạn slug + id (VD: phai-long-bo-chong-yuri-hirose/3137)
                    vid_id = href[len('video/'):] 
                    title = a_tag.get('title', '')
                    
                    img_tag = a_tag.select_one('img')
                    cover = img_tag.get('data-original') or img_tag.get('src') if img_tag else ''
                    if cover and cover.startswith('/'): cover = f"https://{self.domain}" + cover
                        
                    release_date = ""
                    
                    if vid_id and cover:
                        videos.append((vid_id, title, cover, time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(now - (page * 10000) - idx)), parse_release_date(release_date), release_date))
                        
                with self.db_lock:
                    cursor = self.db_conn.cursor()
                    new_count = 0
                    for vid in videos:
                        cursor.execute("SELECT id FROM vlxx_videos WHERE id = ?", (vid[0],))
                        if not cursor.fetchone():
                            with self.memory_lock:
                                if vid[0] not in self.db_buffer[self.get_table_name()]: new_count += 1
                    with self.memory_lock:
                        for vid in videos:
                            self.db_buffer[self.get_table_name()][vid[0]] = {'id': vid[0], 'title': vid[1], 'cover': vid[2], 'added_at': vid[3], 'release_date': vid[4], 'release_date_raw': vid[5]}
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Vlxx] [videos] ➕ {new_count} | 🔄 {len(videos) - new_count}")
                return new_count, len(videos), total_pages
            except Exception as e:
                return 0, -1, 0

    def get_video_url(self, vid_id, force_refresh=False):
        if not force_refresh:
            with self.memory_lock:
                url_in_buffer = self.db_buffer['video_urls'].get((self.get_table_name(), vid_id))
            if url_in_buffer: return url_in_buffer
            with self.db_lock:
                cursor = self.db_conn.cursor()
                cursor.execute("SELECT url FROM vlxx_videos WHERE id = ? AND url IS NOT NULL", (vid_id,))
                row = cursor.fetchone()
                if row and row[0]: return row[0]
        
        numeric_id = vid_id.split('/')[-1]
        if not numeric_id.isdigit():
            return None

        print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Vlxx] [Get link] {vid_id}")

        fail_count = 0
        while fail_count < 3:
            try:
                ajax_url = f"https://{self.domain}/ajax.php"
                referer_url = f"https://{self.domain}/video/{vid_id}/"
                mp4_url = None
                
                # Thử các server khác nhau, bắt đầu với server=2 như trong ví dụ
                for server_num in [2, 1, 3, 4]:
                    payload = {
                        'vlxx_server': '0',
                        'id': numeric_id,
                        'server': str(server_num)
                    }
                    
                    headers = {
                        'Referer': referer_url,
                        'X-Requested-With': 'XMLHttpRequest',
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                    }
                    
                    res = self.session.post(ajax_url, data=payload, headers=headers, timeout=15)
                    
                    if res.status_code == 200:
                        json_data = res.json()
                        player_html = json_data.get('player')
                        if player_html:
                            soup = BeautifulSoup(player_html, 'html.parser')
                            iframe = soup.find('iframe')
                            if iframe and iframe.get('src'):
                                iframe_url = iframe['src']
                                if iframe_url.startswith('//'): iframe_url = 'https:' + iframe_url
                                
                                embed_res = self.session.get(iframe_url, headers={'Referer': referer_url}, timeout=15)
                                if embed_res.status_code == 200:
                                    unpacked_text = ""
                                    
                                    p_match = re.search(r"return p}\('(.*?)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*?)'\.split\('\|'\)", embed_res.text)
                                    if p_match:
                                        try:
                                            p_str, a_radix_str, c_count_str, k_words_str = p_match.groups()
                                            p_str = p_str.replace("\\'", "'")
                                            a_radix = int(a_radix_str)
                                            c_count = int(c_count_str)
                                            k_words = k_words_str.split('|')
                                            
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
                                            unpacked_text = p_str
                                        except Exception: pass

                                    search_text = unpacked_text if unpacked_text else embed_res.text
                                    match = re.search(r'["\']?file["\']?\s*:\s*["\'](https?://[^"\']+)["\']', search_text) or \
                                            re.search(r'["\'](https?://[^"\']+\.(?:m3u8|mp4|vl)[^"\']*)["\']', search_text)
                                    if match: 
                                        mp4_url = match.group(1)
                                        
                                        # Trích xuất thêm jwplayer.key nếu có để Frontend giải mã
                                        key_match = re.search(r'jwplayer\.key\s*=\s*["\']([^"\']+)["\']', embed_res.text)
                                        if key_match:
                                            jw_key = key_match.group(1)
                                            mp4_url = f"{mp4_url}#jwkey={jw_key}"
                                            
                                        break # Tìm được link thì thoát vòng lặp server_num
                                        
                if mp4_url:
                    with self.memory_lock: self.db_buffer['video_urls'][(self.get_table_name(), vid_id)] = mp4_url
                    return mp4_url
                else:
                    raise Exception("Không tìm thấy link video (m3u8/mp4) trong player từ bất kỳ server nào.")
                    
            except Exception as e:
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Vlxx] Lỗi lấy link (lần {fail_count + 1}): {e} ❌")
                fail_count += 1
                if fail_count < 3:
                    print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Vlxx] Khởi tạo lại session và thử lại...")
                    self.session = curl_requests.Session(impersonate="chrome120")
                    time.sleep(1)
                    
        return None

    def sync_video_details(self, vid_id):
        with self.sync_lock:
            url = f"https://{self.domain}/video/{vid_id}/"
            # Đánh dấu details_fetched = 1 để BackgroundScanner không bị kẹt ở video này mãi mãi
            with self.db_lock:
                cursor = self.db_conn.cursor()
                cursor.execute("UPDATE vlxx_videos SET details_fetched = 1 WHERE id = ?", (vid_id,))
                self.db_conn.commit()
                
            try:
                res = self.session.get(url, timeout=15)
                # Tùy chỉnh bóc tách thông tin VLXX (actress, genre, maker) ở đây
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Vlxx] [detail] {vid_id} [💃 0 | 🎭 0] | 🏢 0")
                return True
            except Exception:
                print(f"{datetime.datetime.now().strftime('%y%m%d_%H%M%S_%f')[:-3]} [Vlxx] Lỗi lấy chi tiết video {vid_id} ❌")
                return False