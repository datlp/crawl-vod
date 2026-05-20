import sqlite3
import time
import os
import datetime
import re

def parse_release_date(date_str):
    if not date_str:
        return ""
    date_str = date_str.strip().lower()
    now = datetime.datetime.now()
    
    # Nếu là dạng thời lượng (VD: 01:55:31 hoặc 55:31) thì trả về rỗng (null)
    if re.match(r'^\d{1,2}:\d{2}:\d{2}$', date_str) or re.match(r'^\d{1,2}:\d{2}$', date_str):
        return ""

    # Format chuẩn: YYYY-MM-DD HH:MM:SS
    if re.match(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$', date_str):
        return date_str
        
    # YYYY-MM-DD -> YYYY-MM-DD 00:00:00
    if re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
        return f"{date_str} 00:00:00"
        
    # x days ago, x months ago... hoặc x ngày trước, x tháng trước...
    match_en = re.match(r'^(\d+)\s+(year|month|week|day|hour|minute|second)s?\s+ago$', date_str)
    match_vi = re.match(r'^(\d+)\s+(năm|tháng|tuần|ngày|giờ|phút|giây)\s+trước$', date_str)
    
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
        
    # YY-MM-DD (VD: 24-05-12) -> YYYY-MM-DD 00:00:00
    if re.match(r'^\d{2}-\d{2}-\d{2}$', date_str):
        parts = date_str.split('-')
        year = int(parts[0])
        if year < 100: year += 2000
        return f"{year}-{parts[1]}-{parts[2]} 00:00:00"

    return date_str

def convert_added_at(db_path):
    if not os.path.exists(db_path):
        print(f"Không tìm thấy database tại: {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print("Đang chuyển đổi added_at trong bảng javtiful_videos...")
    cursor.execute("SELECT id, added_at FROM javtiful_videos WHERE typeof(added_at) = 'integer'")
    rows = cursor.fetchall()
    for row_id, added_at in rows:
        dt_str = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(added_at))
        cursor.execute("UPDATE javtiful_videos SET added_at = ? WHERE id = ?", (dt_str, row_id))
    print(f"Đã cập nhật {len(rows)} bản ghi added_at trong javtiful_videos.")
    
    try:
        print("Đang chuyển đổi release_date trong bảng movies...")
        cursor.execute("SELECT dvd, release_date FROM movies WHERE release_date IS NOT NULL AND release_date != ''")
        rows = cursor.fetchall()
        count_rd = 0
        for dvd, release_date in rows:
            new_rd = parse_release_date(release_date)
            if new_rd != release_date:
                cursor.execute("UPDATE movies SET release_date = ? WHERE dvd = ?", (new_rd, dvd))
                count_rd += 1
        print(f"Đã cập nhật {count_rd} bản ghi release_date trong movies.")
    except Exception as e:
        print(f"Bỏ qua chuyển đổi release_date trong movies: {e}")
    
    print("Đang chuyển đổi added_at trong bảng favorites...")
    cursor.execute("SELECT username, video_id, added_at FROM favorites WHERE typeof(added_at) = 'integer'")
    rows = cursor.fetchall()
    for username, video_id, added_at in rows:
        dt_str = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(added_at))
        cursor.execute("UPDATE favorites SET added_at = ? WHERE username = ? AND video_id = ?", (dt_str, username, video_id))
    print(f"Đã cập nhật {len(rows)} bản ghi added_at trong favorites.")
    
    conn.commit()
    conn.close()
    print("Chuyển đổi hoàn tất!")

if __name__ == "__main__":
    # Đảm bảo đường dẫn trỏ đúng vào file database
    convert_added_at("D:\database\javtiful-player3.db")