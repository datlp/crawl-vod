import re
import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from playwright.async_api import async_playwright

app = FastAPI(title="Sextop1 Anti-Cloudflare Auto-Play")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Kho lưu trữ Token động (Sẽ được tự động cập nhật bởi Vệ sĩ Playwright)
CLOUD_COOKIE_STORE = {
    "cookie_string": "",
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}

async def bypass_cloudflare_and_get_token(target_url: str):
    """
    VỆ SĨ PLAYWRIGHT: Mở trình duyệt Chromium giả lập giống hệt người thật,
    vượt qua màn hình kiểm tra của Cloudflare và trích xuất Cookie tươi.
    """
    print("[Hệ thống] Đang kích hoạt chế độ vượt rào Cloudflare...")
    async with async_playwright() as p:
        # Khởi chạy trình duyệt với cấu hình dấu vân tay sạch (anti-fingerprint thô)
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=CLOUD_COOKIE_STORE["user_agent"],
            viewport={"width": 1280, "height": 720}
        )
        page = await context.new_page()
        
        try:
            # Truy cập trang chính để kích hoạt cơ chế sinh Cookie bảo mật của Cloudflare
            await page.goto(target_url, wait_until="domcontentloaded", timeout=20000)
            
            # Đợi thêm 3-4 giây phòng trường hợp dính màn hình Turnstile lật xoay
            await page.wait_for_timeout(4000)
            
            # Lấy toàn bộ cookies của phiên làm việc sạch này
            cookies = await context.cookies()
            cookie_pairs = [f"{c['name']}={c['value']}" for c in cookies]
            cookie_string = "; ".join(cookie_pairs)
            
            # Lưu trữ lại vào bộ nhớ đệm hệ thống để dùng chung cho các lượt gọi sau
            CLOUD_COOKIE_STORE["cookie_string"] = cookie_string
            print(f"[Hệ thống] Cập nhật Token Cloudflare thành công!")
            
            # Tiện tay bóc luôn mã nguồn HTML của trang bài viết hiện tại
            html_content = await page.content()
            return html_content
            
        except Exception as e:
            print(f"[Lỗi Vượt Rào] Không thể bypass qua Cloudflare: {e}")
            return None
        finally:
            await browser.close()

@app.get("/extract-by-url")
async def extract_by_url(url: str):
    """
    API TỰ ĐỘNG KHÔNG CẦN NHẬP COOKIE THỦ CÔNG
    """
    target_url = url.replace("sextop1.cool", "sextop1.buzz")
    
    # Bước 1: Cho Playwright chạy ngầm để lấy Cookie sạch và mã nguồn HTML cùng lúc
    html_text = await bypass_cloudflare_and_get_token(target_url)
    
    if not html_text:
        raise HTTPException(status_code=503, detail="Tường lửa Cloudflare chặn quá gắt, không thể lấy mã nguồn")
        
    # Bước 2: Dùng Regex trích xuất ID bài viết từ mã nguồn sạch thu được
    id_match = re.search(r'postid-(\d+)', html_text) or re.search(r'var postid\s*=\s*\'(\d+)\'', html_text)
    if not id_match:
        raise HTTPException(status_code=404, detail="Không phân tích được ID phim từ bài viết")
        
    movie_id = id_match.group(1)
    
    # Bước 3: Gọi API nội bộ bằng cách sử dụng chính Token vừa thu được thông qua httpx
    api_url = f"https://sextop1.buzz/wp-json/sextop1/player/?id={movie_id}&server=1"
    
    headers = {
        "accept": "application/json, text/javascript, */*; q=0.01",
        "referer": target_url,
        "x-requested-with": "XMLHttpRequest",
        "cookie": CLOUD_COOKIE_STORE["cookie_string"], # Bơm token tươi từ Playwright vào đây
        "user-agent": CLOUD_COOKIE_STORE["user_agent"]
    }
    
    # Sử dụng khối Async HTTPX tiêu chuẩn để fetch siêu tốc chuỗi cấu hình m3u8
    import httpx
    async with httpx.AsyncClient() as client:
        api_res = await client.get(api_url, headers=headers, timeout=10.0)
        if api_res.status_code != 200:
            # Nếu token lỗi (403), thử chạy lại bước 1 một lần nữa để làm mới token
            raise HTTPException(status_code=403, detail="Token hết hạn hoặc Cloudflare từ chối truy cập API")
            
        data_html = api_res.json().get("data", "")
        m3u8_match = re.search(r"file:\s*'([^']+index\.m3u8)'", data_html)
        
        if not m3u8_match:
            raise HTTPException(status_code=404, detail="Không trích xuất được link phát .m3u8")
            
        m3u8_url = m3u8_match.group(1).replace(r"\/", "/")
        return {"success": True, "movie_id": movie_id, "stream_url": m3u8_url}

@app.get("/", response_class=HTMLResponse)
async def get_interface():
    """ Giao diện frontend tích hợp Auto-Bypass """
    html_content = """
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sextop1 Core Anti-Cloudflare</title>
        <link href="https://vjs.zencdn.net/8.10.0/video-js.css" rel="stylesheet" />
        <script src="https://vjs.zencdn.net/8.10.0/video.min.js"></script>
        <style>
            body { background-color: #0b0c10; color: #fff; font-family: sans-serif; padding: 20px; display: flex; flex-direction: column; align-items: center; }
            .container { width: 100%; max-width: 900px; }
            .input-box { display: flex; margin-bottom: 20px; background: #1f2833; padding: 15px; border-radius: 8px; gap: 10px; }
            .input-url { flex: 1; padding: 10px; border-radius: 5px; border: 1px solid #45a29e; background: #0b0c10; color: #fff; font-size: 14px; }
            .btn-play { background: #66fcf1; border: none; color: #0b0c10; padding: 10px 25px; font-weight: bold; border-radius: 5px; cursor: pointer; }
            .loading-text { color: #66fcf1; font-weight: bold; display: none; margin-bottom: 10px; }
            .video-js { border-radius: 8px; overflow: hidden; }
            .skin-gold .vjs-play-progress, .skin-gold .vjs-volume-level { background-color: #d4af37 !important; }
            .skin-gold .vjs-big-play-button { border-color: #d4af37 !important; background-color: rgba(212, 175, 55, 0.3) !important; }
        </style>
    </head>
    <body>
    <div class="container">
        <h2>Hệ Thống Phá Khóa Link Tự Động - Chống Chặn Cloudflare</h2>
        
        <div class="input-box">
            <input type="text" id="target-url" class="input-url" value="https://sextop1.cool/vo-bo-nha-theo-trai-de-lai-chong-song-chung-voi-me-vo-va-em-vo/">
            <button class="btn-play" id="btn-submit" onclick="triggerAutoPlay()">PHÁT VIDEO</button>
        </div>

        <div id="loading" class="loading-text">🔄 Đang chạy ngầm Playwright để giải mã Cloudflare (Mất tầm 5 giây)...</div>

        <div class="player-wrapper">
            <video id="main-player" class="video-js vjs-default-skin vjs-16-9" controls preload="auto" width="100%"></video>
        </div>
    </div>

    <script>
        const player = videojs('main-player');

        async function triggerAutoPlay() {
            const inputUrl = document.getElementById('target-url').value.trim();
            if(!inputUrl) return alert("Vui lòng nhập đường dẫn bài viết!");

            // Bật trạng thái chờ đợi giải mã
            document.getElementById('loading').style.display = 'block';
            document.getElementById('btn-submit').disabled = True;

            try {
                const res = await fetch(`/extract-by-url?url=${encodeURIComponent(inputUrl)}`);
                const data = await res.json();
                
                document.getElementById('loading').style.display = 'none';
                document.getElementById('btn-submit').disabled = false;

                if (data.success && data.stream_url) {
                    player.src({ src: data.stream_url, type: 'application/x-mpegURL' });
                    player.play();
                    document.getElementById('main-player').className = 'video-js vjs-default-skin vjs-16-9 skin-gold';
                } else {
                    alert("Lỗi bypass Cloudflare thất bại. Hãy thử nhấn lại!");
                }
            } catch (err) {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('btn-submit').disabled = false;
                console.error("Lỗi:", err);
            }
        }

        window.onload = function() {
            triggerAutoPlay();
        };
    </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)