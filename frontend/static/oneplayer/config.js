window.__BACKEND_PORT__ = window.location.port || 3000;
window.__BACKEND_URL__ = window.location.origin;

// Quản lý và bảo vệ Session/Cookies không bị mất khi bất kỳ bên nào (Browser/Server) khởi động lại
(function() {
    window.getVodSessionId = function() {
        let sid = localStorage.getItem('vod_session_id');
        if (!sid) {
            const match = document.cookie.match(/(?:^|;\s*)session_id=([^;]+)/);
            if (match && match[1]) {
                sid = decodeURIComponent(match[1]);
                localStorage.setItem('vod_session_id', sid);
            }
        }
        return sid;
    };

    window.setVodSessionId = function(sid) {
        if (sid) {
            localStorage.setItem('vod_session_id', sid);
            try {
                document.cookie = `session_id=${encodeURIComponent(sid)}; path=/; max-age=315360000; SameSite=Lax`;
            } catch (e) {}
        }
    };

    // Tự động đồng bộ cookie/localStorage ban đầu
    const initialSid = window.getVodSessionId();
    if (initialSid) {
        window.setVodSessionId(initialSid);
    }

    // Wrap window.fetch toàn cục để tự động đính kèm credentials và header X-Session-ID
    const originalFetch = window.fetch;
    window.fetch = async function(resource, init = {}) {
        init = init || {};
        init.credentials = 'include';

        const sid = window.getVodSessionId();
        if (sid) {
            if (init.headers instanceof Headers) {
                if (!init.headers.has('X-Session-ID')) {
                    init.headers.set('X-Session-ID', sid);
                }
            } else if (Array.isArray(init.headers)) {
                if (!init.headers.some(([k]) => k.toLowerCase() === 'x-session-id')) {
                    init.headers.push(['X-Session-ID', sid]);
                }
            } else {
                init.headers = init.headers || {};
                let found = false;
                for (const key in init.headers) {
                    if (key.toLowerCase() === 'x-session-id') {
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    init.headers['X-Session-ID'] = sid;
                }
            }
        }

        try {
            const res = await originalFetch(resource, init);
            const respSid = res.headers ? res.headers.get('x-session-id') : null;
            if (respSid) {
                window.setVodSessionId(respSid);
            }
            return res;
        } catch (err) {
            throw err;
        }
    };
})();
