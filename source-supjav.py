import time
import datetime
import re
import json
import threading
from curl_cffi import requests as curl_requests
from bs4 import BeautifulSoup

def parse_release_date(date_str):
    if not date_str:
        return ""
    
    original_date_str = date_str.strip()
    lower_date_str = original_date_str.lower()
    now = datetime.datetime.now()
    
    if re.match(r'^\d{1,2}:\d{2}:\d{2}$', lower_date_str) or re.match(r'^\d{1,2}:\d{2}$', lower_date_str):
        return ""

    if re.match(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$', lower_date_str):
        return original_date_str
        
    if re.match(r'^\d{4}-\d{2}-\d{2}$', lower_date_str):
        return f"{original_date_str} 00:00:00"

    # Format: "Published on: May 12, 2024" or "May 12, 2024"
    cleaned_str = re.sub(r'published on:', '', original_date_str, flags=re.IGNORECASE).strip()
    try:
        dt = datetime.datetime.strptime(cleaned_str, '%b %d, %Y')
        return dt.strftime('%Y-%m-%d 00:00:00')
    except ValueError:
        pass
        
    match_en = re.match(r'^(\d+)\s+(year|month|week|day|hour|minute|second)s?\s+ago$', lower_date_str)
    match_vi = re.match(r'^(\d+)\s+(năm|tháng|tuần|ngày|giờ|phút|giây)\s+trước$', lower_date_str)
    
    if match_en or match_vi:
        if match_en:
            val = int(match_en.group(1))
            unit = match_en.group(2)
        else:
            val = int(match_vi.group(1))
            unit_vi = match_vi.group(2)
            unit_map = {'năm': 'year', 'tháng': 'month', 'tuần': 'week', 'ngày': 'day', 'giờ': 'hour', 'phút': 'minute', 'giây': 'second'}
            unit = unit_map[unit_vi]
            
        if unit == 'year': dt = now - datetime.timedelta(days=val*365)
        elif unit == 'month': dt = now - datetime.timedelta(days=val*30)
        elif unit == 'week': dt = now - datetime.timedelta(weeks=val)
        elif unit == 'day': dt = now - datetime.timedelta(days=val)
        elif unit == 'hour': dt = now - datetime.timedelta(hours=val)
        elif unit == 'minute': dt = now - datetime.timedelta(minutes=val)
        elif unit == 'second': dt = now - datetime.timedelta(seconds=val)
        return dt.strftime('%Y-%m-%d %H:%M:%S')
        
    if re.match(r'^\d{2}-\d{2}-\d{2}$', lower_date_str):
        parts = lower_date_str.split('-')
        year = int(parts[0])
        if year < 100: year += 2000
        return f"{year}-{parts[1]}-{parts[2]} 00:00:00"

    return original_date_str

class Scraper:
    def __init__(self, db_conn, db_lock, memory_lock, db_buffer):
        self.db_conn = db_conn
        self.db_lock = db_lock
        self.memory_lock = memory_lock
        self.db_buffer = db_buffer
        self.session = curl_requests.Session(impersonate="chrome120")
        self.sync_lock = threading.Lock()
        self.referer = "https://supjav.com/"
        self.base_url = "https://supjav.com"

    def update_sync_tasks_from_menu(self):
        print("[Scraper] Khởi tạo sync_tasks cho supjav...")
        tasks = [
            "https://supjav.com/en/page/{page}",
            "https://supjav.com/en/category/uncensored/page/{page}",
            "https://supjav.com/en/category/chinese-subtitle/page/{page}",
            "https://supjav.com/en/category/amateur/page/{page}",
            "https://supjav.com/en/category/censored/page/{page}"
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
        if page == 1:
            url = url.replace("/page/1", "")
            
        print(f"[Scraper] Syncing {url}")
        try:
            res = self.session.get(url, timeout=15)
            soup = BeautifulSoup(res.text, 'html.parser')
            videos = []
            
            total_pages = 0
            for a in soup.select('.pagination a, .nav-links a'):
                try:
                    num = int(a.text.strip())
                    if num > total_pages:
                        total_pages = num
                except:
                    pass

            items = soup.select('.post')
            if not items:
                items = soup.select('div[class*="post"]')
                
            now = int(time.time())
            for idx, item in enumerate(items):
                a_tag = item.select_one('a')
                if not a_tag: continue
                href = a_tag.get('href', '')
                
                if not href or '/category/' in href or '/page/' in href or 'supjav' not in href:
                    continue
                
                parts = href.split('/')
                vid_id = parts[-1]
                if not vid_id: continue
                
                img_tag = a_tag.select_one('img') or item.select_one('img')
                cover = ''
                if img_tag:
                    cover = img_tag.get('data-original') or img_tag.get('data-src') or img_tag.get('src') or ''
                if cover and cover.startswith('//'):
                    cover = 'https:' + cover
                elif cover and cover.startswith('/'):
                    cover = self.base_url + cover
                
                title_tag = item.select_one('h3 a') or item.select_one('.post-title a') or img_tag
                if hasattr(title_tag, 'text') and title_tag.text.strip():
                    title = title_tag.text.strip()
                elif isinstance(title_tag, dict) and title_tag.get('alt'):
                    title = title_tag.get('alt')
                else:
                    title = vid_id
                
                release_date = ""
                date_span = item.select_one('.date')
                if date_span:
                    release_date = date_span.text.strip()
                
                release_date = parse_release_date(release_date)
                
                if vid_id and cover:
                    pseudo_time = now - (page * 10000) - idx
                    added_at_dt = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(pseudo_time))
                    videos.append((vid_id, title, cover, added_at_dt, release_date))
                    
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
                if row and row[0]:
                    return row[0]
            
        url = f"{self.base_url}/en/{vid_id}"
        print(f"[Scraper] Fetching video URL for {vid_id} at {url}")
        try:
            res = self.session.get(url, timeout=15)
            m3u8_url = None
            
            def extract_m3u8(html_text):
                match = re.search(r'var\s+player_data\s*=\s*({.*?});', html_text, re.DOTALL)
                if match:
                    config_str = match.group(1)
                    config_str = re.sub(r',\s*}', '}', config_str)
                    config_str = re.sub(r',\s*]', ']', config_str)
                    try:
                        config = json.loads(config_str)
                        sources = config.get('sources', [])
                        for source in sources:
                            if 'file' in source and '.m3u8' in source['file']:
                                return source['file']
                        if sources:
                            return sources[0].get('file')
                    except:
                        pass
                
                match2 = re.search(r'source\s*:\s*["\'](https?://[^"\']+\.m3u8[^"\']*)["\']', html_text)
                if match2: return match2.group(1)
                
                eval_match = re.search(r"return p}\('(.*?)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*?)'\.split\('\|'\)", html_text)
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
                    
                    m3u8_match = re.search(r'(https?://[^"\']+\.m3u8[^"\']*)', p_str)
                    if m3u8_match: return m3u8_match.group(1)

                return None

            m3u8_url = extract_m3u8(res.text)
            
            if not m3u8_url:
                soup = BeautifulSoup(res.text, 'html.parser')
                iframe_src = None
                for iframe in soup.select('iframe'):
                    src = iframe.get('src', '')
                    if 'tv.supjav.com' in src or 'supjav' in src or 'play' in src or 'embed' in src:
                        iframe_src = src
                        break
                
                if iframe_src:
                    if iframe_src.startswith('//'): iframe_src = 'https:' + iframe_src
                    print(f"[Scraper] Fetching iframe: {iframe_src}")
                    iframe_res = self.session.get(iframe_src, timeout=15, headers={"Referer": url})
                    m3u8_url = extract_m3u8(iframe_res.text)
                    
                    if not m3u8_url:
                        m3u8_match = re.search(r'(https?://[^"\']+\.m3u8[^"\']*)', iframe_res.text)
                        if m3u8_match:
                            m3u8_url = m3u8_match.group(1)

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
            url = f"{self.base_url}/en/{vid_id}"
            try:
                res = self.session.get(url, timeout=15)
                if res.status_code != 200:
                    with self.db_lock:
                        cursor = self.db_conn.cursor()
                        cursor.execute("UPDATE javtiful_videos SET details_fetched = -1 WHERE id = ?", (vid_id,))
                        self.db_conn.commit()
                    return False
                soup = BeautifulSoup(res.text, 'html.parser')
                actress_arr, genre_arr, maker, details, release_date = [], [], "", "", ""

                for item in soup.select('.cats, .tags, .info p, .post-meta p, div[class*="info"], div[class*="meta"]'):
                    text = item.text.strip().lower()
                    label_tag = item.select_one('strong, span, b')
                    label = label_tag.text.strip().lower() if label_tag else text
                    
                    if 'cast' in label or 'actress' in label or 'star' in label:
                        actress_arr.extend([a.text.strip() for a in item.select('a') if a.text.strip()])
                    elif 'tag' in label or 'genre' in label or 'categor' in label:
                        genre_arr.extend([a.text.strip() for a in item.select('a') if a.text.strip()])
                    elif 'maker' in label or 'studio' in label:
                        maker_a = item.select_one('a')
                        if maker_a: maker = maker_a.text.strip()
                        
                actress_arr = list(dict.fromkeys(actress_arr))
                genre_arr = list(dict.fromkeys(genre_arr))

                date_match = re.search(r'(?:Published on|Release Date):\s*([^<]+)', res.text, re.IGNORECASE)
                if date_match:
                    release_date = date_match.group(1).strip()
                
                desc_div = soup.select_one('.post-content, .desc, .description')
                if desc_div:
                    details = desc_div.text.strip()

                release_date = parse_release_date(release_date)
                actress_str = ", ".join(actress_arr)
                genre_str = ", ".join(genre_arr)

                with self.db_lock:
                    cursor = self.db_conn.cursor()
                    if release_date:
                        cursor.execute('''UPDATE javtiful_videos SET actress = ?, genre = ?, maker = ?, details = ?, release_date = ?, details_fetched = 1 WHERE id = ?''', (actress_str, genre_str, maker, details, release_date, vid_id))
                    else:
                        cursor.execute('''UPDATE javtiful_videos SET actress = ?, genre = ?, maker = ?, details = ?, details_fetched = 1 WHERE id = ?''', (actress_str, genre_str, maker, details, vid_id))
                    self.db_conn.commit()
                return True
            except Exception as e:
                print(f"[Scraper] Lỗi lấy chi tiết video {vid_id}: {e}")
                with self.db_lock:
                    cursor = self.db_conn.cursor()
                    cursor.execute("UPDATE javtiful_videos SET details_fetched = -1 WHERE id = ?", (vid_id,))
                    self.db_conn.commit()
                return False