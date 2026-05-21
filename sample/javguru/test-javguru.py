import os
import re
import sys
from bs4 import BeautifulSoup
import httpx
import uvicorn
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="JAV.GURU Engine - Multi-Movie Automation Proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

limits = httpx.Limits(max_connections=150, max_keepalive_connections=30)
timeout = httpx.Timeout(15.0, connect=5.0, read=None)
async_client = httpx.AsyncClient(limits=limits, timeout=timeout)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
}

# =====================================================================
# CORE SYSTEM: ROUTER CÀO 2 TẦNG + LOG CHI TIẾT TỪNG CASE
# =====================================================================

@app.get("/extract-and-proxy/playlist.m3u8")
async def extract_and_proxy_m3u8(guru_url: str):
    # Lấy mã phim từ URL để in log cho đẹp
    movie_code_search = re.search(r'\/([a-z0-9\-]+)\/$', guru_url)
    movie_name = movie_code_search.group(1).upper() if movie_code_search else "UNKNOWN"
    
    print(f"\n=======================================================")
    print(f"[CASE START] Bắt đầu xử lý bóc tách cho phim: {movie_name}")
    print(f"-> URL Gốc: {guru_url}")
    print(f"=======================================================")

    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
        try:
            # BƯỚC 1: CÀO TẦNG CHI TIẾT GURU
            print("[Bước 1/5] Đang truy cập trang chi tiết JAV.GURU...")
            res_page = await client.get(guru_url, headers=HEADERS)
            
            if res_page.status_code != 200:
                print(f"❌ [THẤT BẠI] Bước 1 lỗi. HTTP Status Code: {res_page.status_code}")
                raise HTTPException(status_code=res_page.status_code, detail="Lỗi truy cập trang Guru gốc")
            print("  ↳ [PASS] Đã tải xong HTML trang chi tiết.")

            # BƯỚC 2: QUÉT IFRAME PLAYER TRANG CHI TIẾT
            print("[Bước 2/5] Đang quét tìm thẻ Iframe phát phim...")
            iframe_match = re.search(r'<iframe\s+src="([^"]+)"', res_page.text) or re.search(r"iframe\s+src='([^']+)'", res_page.text)
            
            if not iframe_match:
                print("❌ [THẤT BẠI] Bước 2 lỗi. Không tìm thấy chuỗi regex khớp với thẻ <iframe> trong HTML.")
                raise HTTPException(status_code=404, detail="Không tìm thấy thẻ Iframe phát phim")
                
            iframe_url = iframe_match.group(1)
            if iframe_url.startswith("//"):
                iframe_url = "https:" + iframe_url
            print(f"  ↳ [PASS] Tìm thấy Link Iframe: {iframe_url}")

            # BƯỚC 3: CÀO TRANG NHÚNG IFRAME (GẮN REFERER)
            print("[Bước 3/5] Đang truy cập ngầm vào trang nhúng Iframe...")
            headers_iframe = HEADERS.copy()
            headers_iframe["Referer"] = guru_url # Ép Referer cha để tránh chặn chống cào
            res_iframe = await client.get(iframe_url, headers=headers_iframe)
            
            if res_iframe.status_code != 200:
                print(f"❌ [THẤT BẠI] Bước 3 lỗi. Server Iframe từ chối (HTTP {res_iframe.status_code}). Có thể bị dính Cloudflare.")
                raise HTTPException(status_code=res_iframe.status_code, detail="Lỗi truy cập vào trang nhúng iframe")
            print("  ↳ [PASS] Đã đọc được kết cấu trang nguồn Player.")

            # BƯỚC 4: LỘT TRẦN LINK M3U8 TỪ TRANG IFRAME
            print("[Bước 4/5] Đang dùng Regex trích xuất link luồng phát .m3u8 gốc...")
            stream_match = re.search(r'"file"\s*:\s*"([^"]+)"', res_iframe.text) or \
                           re.search(r"file\s*:\s*'([^']+)'", res_iframe.text) or \
                           re.search(r'src\s*:\s*"([^"]+\.m3u8[^"]*)"', res_iframe.text)
            
            if not stream_match:
                print("❌ [THẤT BẠI] Bước 4 lỗi. Không tìm thấy chuỗi '.m3u8' trong script cấu hình của Player nguồn.")
                # Gợi ý: Ghi lại mã nguồn iframe ra file để check xem họ có đổi cấu trúc sang mã hóa Base64 không
                with open("debug_iframe_source.html", "w", encoding="utf-8") as debug_file:
                    debug_file.write(res_iframe.text)
                print("  ↳ [HỖ TRỢ DEBUG] Đã xuất mã nguồn Iframe ra file 'debug_iframe_source.html' để bạn tiện phân tích mẫu script mới.")
                raise HTTPException(status_code=404, detail="Không tìm thấy link m3u8 gốc")
                
            m3u8_real_url = stream_match.group(1).replace(r"\/", "/")
            print(f"  ↳ [PASS] Trích xuất thành công Link M3u8 gốc: {m3u8_real_url}")

            # BƯỚC 5: TẢI LUỒNG TEXT M3U8 GỐC & VÁ ĐƯỜNG DẪN TƯƠNG ĐỐI
            print("[Bước 5/5] Đang nạp nội dung file m3u8 và đồng bộ hóa đường dẫn...")
            headers_m3u8 = HEADERS.copy()
            headers_m3u8["Referer"] = iframe_url
            res_m3u8 = await client.get(m3u8_real_url, headers=headers_m3u8)
            
            if res_m3u8.status_code != 200:
                print(f"❌ [THẤT BẠI] Bước 5 lỗi. Link m3u8 gốc trả về lỗi HTTP {res_m3u8.status_code}")
                raise HTTPException(status_code=res_m3u8.status_code, detail="Không thể tải ruột file m3u8")
                
            # Sửa lỗi đường dẫn tương đối (Vá link .ts rác thành link tuyệt đối chứa domain)
            m3u8_content = res_m3u8.text
            base_url = m3u8_real_url.rsplit('/', 1)[0] + '/'
            lines = m3u8_content.split("\n")
            clean_lines = []
            for line in lines:
                line_str = line.strip()
                if line_str and not line_str.startswith("#") and not line_str.startswith("http"):
                    clean_lines.append(base_url + line_str)
                else:
                    clean_lines.append(line)
            
            final_m3u8_text = "\n".join(clean_lines)
            
            print(f"✅ [CASE SUCCESS] HOÀN THÀNH BÓC TÁCH CHO PHIM: {movie_name}! Đã trả dòng m3u8 về cho Client.")
            return Response(content=final_m3u8_text, media_type="application/x-mpegURL")
            
        except Exception as e:
            print(f"💥 [CRASH] Lỗi hệ thống ngoài tầm kiểm soát: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))

@app.get("/proxy-segment")
async def proxy_segment(url: str, request: Request):
    """Proxy từng phân đoạn .ts tránh nghẽn luồng mạng"""
    async def stream_chunk_with_killswitch():
        try:
            async with async_client.stream("GET", url, headers=HEADERS) as r:
                if r.status_code != 200: return
                async for chunk in r.aiter_bytes(chunk_size=512 * 1024):
                    if await request.is_disconnected():
                        break
                    yield chunk
        except Exception: pass
    return StreamingResponse(stream_chunk_with_killswitch(), media_type="video/MP2T")

# =====================================================================
# DASHBOARD GENERATOR: TỰ ĐỘNG ĐỌC FILE DETAIL.HTML
# =====================================================================

@app.get("/", response_class=HTMLResponse)
async def get_dashboard():
    html_file_path = "detail.html"
    if not os.path.exists(html_file_path):
        return HTMLResponse(content="<h1>Lỗi: Thiếu file detail.html chung thư mục!</h1>", status_code=404)
        
    with open(html_file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f.read(), "html.parser")
        
    articles = soup.find_all("div", class_="inside-article")
    movie_list_html = ""
    
    for art in articles:
        title_element = art.find("div", class_="grid1").find("a") if art.find("div", class_="grid1") else None
        img_element = art.find("div", class_="imgg").find("img") if art.find("div", class_="imgg") else None
        
        if title_element and img_element:
            movie_title = title_element.get("title", title_element.text).strip()
            movie_url = title_element.get("href", "").strip()
            movie_img = img_element.get("src", "").strip()
            
            code_match = re.search(r'\[([A-Z0-9\-]+)\]', movie_title)
            movie_code = code_match.group(1) if code_match else "MOVIE"
            
            movie_list_html += f"""
            <div class="movie-card" onclick="playSelectedMovie(this, '{movie_url}')">
                <img src="{movie_img}" alt="thumb">
                <div class="movie-code-badge">{movie_code}</div>
                <div class="movie-title-text">{movie_code}</div>
            </div>
            """

    html_layout = f"""
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <title>JAV.GURU Advanced Logger Proxy</title>
        <link href="https://vjs.zencdn.net/8.10.0/video-js.css" rel="stylesheet" />
        <script src="https://vjs.zencdn.net/8.10.0/video.min.js"></script>
        <style>
            body {{ background-color: #0b0c10; color: #fff; font-family: sans-serif; padding: 20px; display: flex; flex-direction: column; align-items: center; }}
            .container {{ width: 100%; max-width: 950px; }}
            .video-js {{ border-radius: 8px; overflow: hidden; box-shadow: 0 0 20px rgba(255, 0, 70, 0.3); }}
            .skin-ruby .vjs-play-progress {{ background-color: #ff0046 !important; }}
            .skin-ruby .vjs-big-play-button {{ border-color: #ff0046 !important; background-color: rgba(255, 0, 70, 0.4) !important; border-radius: 50% !important; }}
            .status-log {{ color: #66fcf1; font-weight: bold; margin-bottom: 15px; display: none; text-align: center; }}
            .movie-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 15px; background: #1f2833; padding: 15px; border-radius: 8px; }}
            .movie-card {{ background: #0b0c10; border-radius: 6px; overflow: hidden; cursor: pointer; border: 1px solid #45a29e; position: relative; }}
            .movie-card img {{ width: 100%; height: 110px; object-fit: cover; }}
            .movie-code-badge {{ position: absolute; top: 5px; right: 5px; background: #ff0046; color: #fff; padding: 2px 5px; font-size: 11px; font-weight: bold; border-radius: 3px; }}
            .movie-title-text {{ padding: 8px; font-size: 12px; font-weight: bold; color: #c5a880; text-align: center; }}
            .active-card {{ border-color: #ff0046 !important; box-shadow: 0 0 12px #ff0046 !important; }}
        </style>
    </head>
    <body>
    <div class="container">
        <h2>🚀 Hệ thống Kiểm tra Luồng JAV.GURU - Bắn Log Từng Bước</h2>
        <div class="player-wrapper">
            <video id="vjs-player" class="video-js vjs-default-skin vjs-16-9 skin-ruby" controls preload="auto" width="100%"></video>
        </div>
        <div id="status" class="status-log">🔄 Đang phân tích mã nguồn tầng sâu, vui lòng kiểm tra bảng log PowerShell...</div>
        <h3>Danh Sách Phim:</h3>
        <div class="movie-grid">{movie_list_html}</div>
    </div>
    <script>
        const player = videojs('vjs-player', {{ html5: {{ hls: {{ overrideNative: true, maxMaxBufferLength: 15, backBufferLength: 0 }} }} }});
        async function playSelectedMovie(cardElement, targetGuruUrl) {{
            document.querySelectorAll('.movie-card').forEach(card => card.classList.remove('active-card'));
            cardElement.classList.add('active-card');
            document.getElementById('status').style.display = 'block';
            
            const finalProxyM3u8Url = `/extract-and-proxy/playlist.m3u8?guru_url=${{encodeURIComponent(targetGuruUrl)}}`;
            player.src({{ src: finalProxyM3u8Url, type: 'application/x-mpegURL' }});
            player.play();
            document.getElementById('status').style.display = 'none';
        }}
        window.onload = function() {{
            const firstCard = document.querySelector('.movie-card');
            if(firstCard) firstCard.click();
        }};
    </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html_layout)

if __name__ == "__main__":
    port = 8000
    if "-port" in sys.argv:
        try: port = int(sys.argv[sys.argv.index("-port") + 1])
        except Exception: pass
    uvicorn.run(app, host="0.0.0.0", port=port)