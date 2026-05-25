import os
import re
import sys
import subprocess
from bs4 import BeautifulSoup
import httpx
import uvicorn
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import HTMLResponse, StreamingResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("Đang cài đặt thư viện Playwright để lắng nghe network...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "playwright"])
    subprocess.check_call([sys.executable, "-m", "playwright", "install", "chromium"])
    from playwright.async_api import async_playwright

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

    m3u8_real_url = None
    iframe_url = None

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=HEADERS["User-Agent"]
        )
        page = await context.new_page()

        async def handle_response(response):
            nonlocal m3u8_real_url
            if m3u8_real_url:
                return
                
            url = response.url
            
            # Pattern cho các link stream: m3u8, mp4 của SB/ST, hls, token stream, index-f3...
            stream_pattern = r'\.m3u8|\.mp4(?:\?stream=1)?|/hls|token=[^\&]+&expiry=|\.urlset/.*\.txt'
            
            # Bắt trực tiếp link luồng
            if re.search(stream_pattern, url) and "blank.mp4" not in url:
                print(f"  [NETWORK INTERCEPT] Phát hiện link Stream trực tiếp từ: {url}")
                m3u8_real_url = url
                return

            # Lắng nghe các gói tin API trả về (Fallback)
            if response.request.resource_type in ["xhr", "fetch"]:
                # Bỏ qua các gói tin của hệ thống chống bot Cloudflare
                if "challenge-platform" in url or "lenge-platform" in url:
                    return

                try:
                    text = await response.text()
                    
                    # LOG CHI TIẾT CÁC GÓI API GỌI VỀ
                    content_type = response.headers.get("content-type", "unknown")
                    print(f"  [DEBUG API] Yêu cầu: {response.request.method} {url}")
                    print(f"  ↳ Định dạng trả về (Content-Type): {content_type}")
                    
                    if "application/json" in content_type or text.startswith("{") or text.startswith("["):
                        try:
                            import json
                            parsed = json.loads(text)
                            print(f"  ↳ Dữ liệu (JSON): {str(parsed)[:250]}...")
                        except:
                            print(f"  ↳ Dữ liệu (Dạng Text): {text[:250]}...")
                    else:
                        print(f"  ↳ Dữ liệu (Dạng Text): {text[:250]}...")
                            
                    text_normalized = text.replace(r'\/', '/')
                    api_pattern = r'(https?://[^\'"]+(?:\.m3u8|\.mp4|/hls|token=[^\&]+&expiry=|\.urlset/[^\'"]+\.txt)[^\'"]*)'
                    match = re.search(api_pattern, text_normalized)
                    if match and not m3u8_real_url and "blank.mp4" not in match.group(1):
                        print(f"  [NETWORK INTERCEPT] Phân tích API Response từ: {url}")
                        m3u8_real_url = match.group(1)
                        print(f"  ↳ [PASS] Bắt được Link Stream từ API: {m3u8_real_url}")
                except Exception:
                    pass

        page.on("response", handle_response)

        try:
            # BƯỚC 1: CÀO TẦNG CHI TIẾT GURU BẰNG PLAYWRIGHT
            print("[Bước 1/5] Đang mở trình duyệt Playwright và truy cập JAV.GURU...")
            await page.goto(guru_url, wait_until="domcontentloaded", timeout=30000)
            print("  ↳ [PASS] Đã tải xong trang JAV.GURU.")

            # BƯỚC 2: CLICK VÀO SERVER SB / ST NẾU CÓ
            print("[Bước 2/5] Đang quét và click chọn Server SB / ST...")
            selector = "ul#section-li li a"
            server_buttons = await page.query_selector_all(selector)
            clicked = False
            for btn in server_buttons:
                btn_text = await btn.inner_text()
                btn_href = await btn.get_attribute("href")
                if "STREAM SB" in btn_text or "STREAM ST" in btn_text:
                    print(f"  [ACTION] Đã tìm thấy DOM thông qua querySelector: '{selector}'")
                    print(f"  ↳ Text: '{btn_text.strip()}' | Href: '{btn_href}'")
                    print(f"  ↳ Tiến hành click vào thẻ này để kích hoạt luồng gọi API Video...")
                    await btn.click()
                    clicked = True
                    break
            
            if not clicked:
                print(f"  [INFO] Không tìm thấy nút STREAM SB/ST qua selector '{selector}', dùng server mặc định...")

            # BƯỚC 3: QUÉT NETWORK VÀ CHỜ YÊU CẦU API (10s)
            print("[Bước 3/5] Lắng nghe luồng mạng tìm link Stream...")
            for _ in range(20):
                if m3u8_real_url:
                    break
                await page.wait_for_timeout(500)

            if not m3u8_real_url:
                print("  [INFO] Chưa bắt được request. Đang quét tìm Iframe để đi sâu vào trong...")
                
                # Lấy tất cả SRC của iframe thành chuỗi text trước để tránh lỗi "Execution context was destroyed" khi chuyển trang
                iframe_elements = await page.query_selector_all('iframe')
                iframe_urls = []
                for el in iframe_elements:
                    try:
                        src = await el.get_attribute('src')
                        if src and "creative.mnaspm.com" not in src:
                            iframe_urls.append(src)
                    except Exception: pass
                    
                for iframe_src in iframe_urls:
                    if m3u8_real_url: break
                    
                    iframe_url = iframe_src if iframe_src.startswith('http') else 'https:' + iframe_src
                    print(f"  ↳ [PASS] Tìm thấy Iframe: {iframe_url}")
                    
                    print("[Bước 4/5] Truy cập trực tiếp vào Iframe để kích hoạt Network...")
                    try:
                        await page.goto(iframe_url, wait_until="domcontentloaded", timeout=20000)
                        
                        page_html = await page.content()
                        
                        # XỬ LÝ CLOUDFLARE CHALLENGE BÊN TRONG IFRAME
                        if "__CF$cv$params" in page_html or "challenge-platform" in page_html:
                            print(f"  [INFO] 🛡️ Iframe đang bị Cloudflare chặn! Đợi 10s để Vệ sĩ Playwright giải mã...")
                            await page.wait_for_timeout(10000)
                            page_html = await page.content() # Nạp lại mã nguồn sau khi CF tự động reload
                            
                        # Bóc mã nguồn HTML khi đi vào đúng iframe searcho
                        if "searcho/?xd=" in iframe_url:
                            print("  [DEBUG HTML] Đã load thẳng vào Iframe searcho, in mã nguồn:")
                            print("  ----------------------------------------------------")
                            print(f"{page_html[:100000]}...\n  ----------------------------------------------------")
                    except Exception as e:
                        print(f"    ↳ Lỗi load iframe: {e}")
                        continue
                    
                    # Cố gắng click vào giữa màn hình để kích hoạt nếu Player yêu cầu tương tác
                    print("  [ACTION] Click giả lập vào Player để kích hoạt Network...")
                    try:
                        await page.mouse.click(640, 360)
                        await page.wait_for_timeout(500)
                        await page.mouse.click(640, 360)
                    except Exception:
                        pass
                        
                    print("  ↳ Chờ đợi gói tin API từ Iframe...")
                    for _ in range(10):
                        if m3u8_real_url: break
                        await page.wait_for_timeout(1000)
                        
                    if not m3u8_real_url:
                        print("  ↳ Quét tìm Iframe lồng nhau (Nested Iframe)...")
                        nested_iframes = await page.query_selector_all('iframe')
                        nested_urls = []
                        for n in nested_iframes:
                            try:
                                n_src = await n.get_attribute('src')
                                if n_src and "creative.mnaspm.com" not in n_src:
                                    nested_urls.append(n_src)
                            except Exception: pass
                            
                        for n_src in nested_urls:
                            if m3u8_real_url: break
                            n_url = n_src if n_src.startswith('http') else 'https:' + n_src
                            print(f"    ↳ [PASS] Tìm thấy Nested Iframe: {n_url}")
                            try:
                                await page.goto(n_url, wait_until="domcontentloaded", timeout=20000)
                                
                                n_html = await page.content()
                                
                                # XỬ LÝ CLOUDFLARE BÊN TRONG NESTED IFRAME
                                if "__CF$cv$params" in n_html or "challenge-platform" in n_html:
                                    print(f"    [INFO] 🛡️ Nested Iframe đang bị Cloudflare chặn! Đợi 10s để giải mã...")
                                    await page.wait_for_timeout(10000)
                                    n_html = await page.content()
                                
                                # Bóc mã nguồn HTML của Nested Iframe
                                if "searcho/?xd=" in n_url:
                                    print("    [DEBUG HTML] Đã load thẳng vào Nested Iframe searcho, in mã nguồn:")
                                    print("    ----------------------------------------------------")
                                    print(f"{n_html[:1500]}...\n    ----------------------------------------------------")
                                    
                                try:
                                    await page.mouse.click(640, 360)
                                    await page.wait_for_timeout(500)
                                    await page.mouse.click(640, 360)
                                except Exception: pass
                                
                                for _ in range(10):
                                    if m3u8_real_url: break
                                    await page.wait_for_timeout(1000)
                            except Exception: pass

            if not m3u8_real_url:
                print("  [INFO] Đang dùng Fallback DOM để quét thẻ <video>...")
                try:
                    for _ in range(3):
                        if m3u8_real_url: break
                        video_tags = await page.query_selector_all('video')
                        for v in video_tags:
                            src = await v.get_attribute('src')
                            if src and src.startswith('http'):
                                print(f"  [DOM INTERCEPT] Tìm thấy thẻ <video src=...>: {src}")
                                m3u8_real_url = src
                                break
                        await page.wait_for_timeout(1000)
                except Exception:
                    pass

            if not m3u8_real_url:
                print("❌ [THẤT BẠI] Không bắt được link stream từ Network.")
                raise HTTPException(status_code=404, detail="Không bắt được link stream gốc")

        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            print(f"💥 [CRASH] Lỗi Playwright: {str(e)}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            await browser.close()

    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
        try:
            # BƯỚC 5: TẢI LUỒNG TEXT GỐC VÀ XỬ LÝ URL
            print(f"[Bước 5/5] Đang xử lý link Stream: {m3u8_real_url}")
            
            # Nếu là link MP4 hoặc token stream, ta trả về Redirect để Player tự phát
            if ".mp4" in m3u8_real_url or "token=" in m3u8_real_url:
                print(f"✅ [CASE SUCCESS] HOÀN THÀNH BÓC TÁCH CHO PHIM: {movie_name}! Trả về Redirect link.")
                return RedirectResponse(url=m3u8_real_url)
                
            headers_m3u8 = HEADERS.copy()
            if iframe_url:
                headers_m3u8["Referer"] = iframe_url
            else:
                headers_m3u8["Referer"] = guru_url
                
            res_m3u8 = await client.get(m3u8_real_url, headers=headers_m3u8)
            
            if res_m3u8.status_code != 200:
                print(f"❌ [THẤT BẠI] Bước 5 lỗi. Link stream gốc trả về lỗi HTTP {res_m3u8.status_code}")
                raise HTTPException(status_code=res_m3u8.status_code, detail="Không thể tải ruột file stream")
                
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
            
            print(f"✅ [CASE SUCCESS] HOÀN THÀNH BÓC TÁCH CHO PHIM: {movie_name}! Đã trả dòng text stream về cho Client.")
            return Response(content=final_m3u8_text, media_type="application/x-mpegURL")
            
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            print(f"💥 [CRASH] Lỗi hệ thống HTTPX: {str(e)}")
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