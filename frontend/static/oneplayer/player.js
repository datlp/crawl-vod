class VODPlayer {
    constructor(options = {}) {
        this.container = document.getElementById(options.containerId || 'video-container');
        this.stageLayer = document.getElementById('video-stage-layer') || this.container;
        this.video = document.getElementById(options.videoId || 'player');
        this.playBtnCenter = document.getElementById(options.playBtnId || 'play-btn');
        this.btnPlayToggle = document.getElementById(options.btnPlayToggleId || 'btn-play-toggle');
        this.btnPrev = document.getElementById(options.btnPrevId || 'btn-prev');
        this.btnNext = document.getElementById(options.btnNextId || 'btn-next');
        this.btnFullscreen = document.getElementById(options.btnFullscreenId || 'btn-fullscreen');
        this.btnLike = document.getElementById(options.btnLikeId || 'btn-like');
        this.likeCountText = document.getElementById(options.likeCountId || 'like-count');
        this.musicDisc = document.getElementById(options.musicDiscId || 'music-disc');
        this.hud = document.getElementById(options.hudId || 'seek-hud');
        this.seekbar = document.getElementById(options.seekbarId || 'seekbar');
        this.seekFill = document.getElementById(options.seekFillId || 'seek-fill');
        this.seekBuffer = document.getElementById(options.seekBufferId || 'seek-buffer');
        this.currTimeText = document.getElementById(options.currTimeId || 'curr-time');
        this.durTimeText = document.getElementById(options.durTimeId || 'dur-time');
        this.heartContainer = document.getElementById('heart-particle-container');
        this.btnSpeed = document.getElementById(options.btnSpeedId || 'btn-speed');
        this.speedLabel = document.getElementById(options.speedLabelId || 'speed-label');
        this.btnQuality = document.getElementById('btn-quality');
        this.qualityLabel = document.getElementById('quality-label');
        this.qualityMenuModal = document.getElementById('quality-menu-modal');
        this.qualityMenuList = document.getElementById('quality-menu-list');

        // Scrubber Thumbnail & Time Bubble
        this.seekPreviewBubble = document.getElementById('seek-preview-bubble');
        this.seekPreviewTime = document.getElementById('seek-preview-time');

        // Quality Menu
        this.currentQualityHeight = null;
        this.btnGestureGuide = document.getElementById('btn-gesture-guide');
        this.gestureGuideModal = document.getElementById('gesture-guide-modal');
        this.btnCloseGestureGuide = document.getElementById('btn-close-gesture-guide');
        this.btnReportError = document.getElementById(options.btnReportErrorId || 'btn-report-error');

        // Stream Source Elements (GDrive / Surrit)
        this.btnStreamSource = document.getElementById('btn-stream-source');
        this.sourceLabel = document.getElementById('source-label');
        this.sourceIcon = document.getElementById('source-icon');
        this.sourceSwapBadge = document.getElementById('source-swap-badge');
        this.streamSourceDrawerModal = document.getElementById('stream-source-drawer-modal');
        this.streamSourceOptionsContainer = document.getElementById('stream-source-drawer-options');
        this.btnCloseStreamSourceDrawer = document.getElementById('btn-close-stream-source-drawer');
        this.streamSourceDrawerSub = document.getElementById('stream-source-drawer-sub');
        this.sources = [];
        this.activeSourceIndex = 0;
        const isGDriveDefault = !!(window.__IS_GDRIVE_ONLY__ || (window.location.port === '3001') || (window.location.port === '3005'));
        this.preferredStreamSource = localStorage.getItem('vod_preferred_stream_source') || (isGDriveDefault ? 'gdrive' : 'cdn');

        this.btnSettings = document.getElementById(options.btnSettingsId || 'btn-player-settings');
        this.settingsModal = document.getElementById('settings-drawer-modal');
        this.btnCloseSettings = document.getElementById('btn-close-settings-drawer');

        // GDrive Drawer Elements
        this.gdriveDrawerModal = document.getElementById('gdrive-drawer-modal');
        this.btnCloseGDriveDrawer = document.getElementById('btn-close-gdrive-drawer');
        this.btnCancelGDriveDrawer = document.getElementById('btn-cancel-gdrive-drawer');
        this.btnConfirmDeleteGDrive = document.getElementById('btn-confirm-delete-gdrive');

        // Theme Mode ('normal' | 'black')
        this.themeMode = localStorage.getItem('vod_theme_mode') || 'normal';
        // Fit Mode ('contain' | 'cover')
        this.fitMode = localStorage.getItem('vod_fit_mode') || 'contain';

        // Gesture Settings
        const defaultGestures = {
            singleTapToggle: true,
            doubleTapSeek: true,
            pressHoldSpeed: true,
            upperSwipeExplorer: true,
            upperSwipeFullscreen: true,
            lowerSwipeSeek: true,
            lowerSwipeNextPrev: true
        };
        let savedGestures = null;
        try {
            savedGestures = JSON.parse(localStorage.getItem('vod_gesture_settings'));
        } catch (e) {}
        this.gestureSettings = Object.assign({}, defaultGestures, savedGestures || {});

        this.loadingOverlay = document.getElementById('video-loading-overlay');
        this.loadingCoverBg = document.getElementById('video-loading-cover-bg');
        this.loadingCover = document.getElementById('video-loading-cover');
        this.loadingTitle = document.getElementById('video-loading-title');
        this.loadingStatus = document.getElementById('video-loading-status');
        this.seekingSpinner = document.getElementById('yt-seeking-spinner');
        this.seekingSpinnerTimeout = null;
        this.currentCoverSrc = '';

        // Live Feed Backdrop Preview Elements
        this.feedPreview = document.getElementById('video-feed-preview');
        this.feedPreviewBg = document.getElementById('feed-preview-cover-bg');
        this.feedPreviewCover = document.getElementById('feed-preview-cover');
        this.feedPreviewTitle = document.getElementById('feed-preview-title');
        this.feedPreviewCode = document.getElementById('feed-preview-code');
        this.adjacentFeedData = { next: null, prev: null };
        this.nextStreamPreloadTimeout = null;
        this.nextStreamAbortController = null;
        this.lastPreloadedStreamUrl = null;

        // 3s Cover Preview & Recommendation State
        this.btnDislike = document.getElementById(options.btnDislikeId || 'btn-dislike');
        this.countdownWrapper = document.getElementById('video-countdown-wrapper');
        this.countdownCircle = document.getElementById('video-countdown-circle');
        this.countdownNum = document.getElementById('video-countdown-num');
        this.countdownHint = document.getElementById('video-countdown-hint');
        this.spinnerBox = document.getElementById('video-loading-spinner-box');

        this.isCoverPreviewing = false;
        this.coverCountdownAnimFrame = null;
        this.coverCountdownTimer = null;
        this.pendingPlaybackArgs = null;
        this.pendingSkips = {};
        this.currentVideoConfirmedView = false;
        this.currentVideoPlaybackSeconds = 0;
        this.lastWatchTimeReportSec = 0;

        const savedSec = parseInt(localStorage.getItem('vod_doubletap_seconds'), 10);
        this.doubleTapSeekSeconds = (!isNaN(savedSec) && savedSec > 0) ? savedSec : 30;

        this.speeds = [1, 2, 4];
        this.currentSpeedIndex = 0;
        this.isHoldingTap = false;

        this.hlsPlayer = null;
        this.seekAbortController = null;
        this.seekDebounceTimeout = null;
        this.isSwiping = false;
        this.isDraggingSeekbar = false;
        this.hasMovedGesture = false;
        this.startX = 0;
        this.startY = 0;
        this.startTime = 0;
        this.targetTime = 0;
        this.swipeSensitivityPx = options.swipeSensitivity || 450;
        this.streamUrl = options.streamUrl || '/playlist.m3u8';
        this.backendHost = options.backendHost || '';
        this.currentVideoPath = '';
        this.currentVideoName = '';
        this.currentVideoTitle = '';
        this.isLiked = false;
        this.likeCount = 12400;
        this.isInQueue = false;
        this.hasGDrive = false;

        this.onToggleQueue = options.onToggleQueue || null;
        this.onSwipeUpperExplorer = options.onSwipeUpperExplorer || null;
        this.onSwipeRightToLeft = options.onSwipeRightToLeft || null;
        this.onSwipeLeftToRight = options.onSwipeLeftToRight || null;
        this.onNext = options.onNext || null;
        this.onPrev = options.onPrev || null;
        this.isUpperSwipe = false;
        this.swipeDirection = null; // 'horizontal' | 'vertical' | null

        // Top-right rotate landscape button (TikTok style)
        this.btnRotateLandscape = document.getElementById('btn-rotate-landscape');
        this.isLandscapeRotated = false;
        this.isVideoLandscape = false;

        // Double Tap Ripple Seek Overlays
        this.tapRippleLeft = document.getElementById('tap-ripple-left');
        this.tapRippleRight = document.getElementById('tap-ripple-right');
        this.tapTextLeft = document.getElementById('tap-text-left');
        this.tapTextRight = document.getElementById('tap-text-right');

        // Pinch-to-zoom (2 ngón tay) State
        this.zoomScale = 1;
        this.zoomTranslateX = 0;
        this.zoomTranslateY = 0;
        this.isPinching = false;
        this.pinchStartDistance = 0;
        this.pinchStartScale = 1;
        this.pinchStartMidX = 0;
        this.pinchStartMidY = 0;
        this.pinchStartTranslateX = 0;
        this.pinchStartTranslateY = 0;

        // Double tap & Single tap detection
        this.lastTapTime = 0;
        this.init();
    }

    triggerHaptic(pattern = 15) {
        if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
            try {
                window.navigator.vibrate(pattern);
            } catch (e) {}
        }
    }


    toggleSpeed(targetSpeed = null) {
        if (targetSpeed !== null) {
            const idx = this.speeds.indexOf(targetSpeed);
            if (idx !== -1) {
                this.currentSpeedIndex = idx;
            }
        } else {
            this.currentSpeedIndex = (this.currentSpeedIndex + 1) % this.speeds.length;
        }
        const speed = this.speeds[this.currentSpeedIndex];
        this.video.playbackRate = speed;
        if (this.speedLabel) {
            this.speedLabel.innerText = `${speed}x`;
        }
        if (this.btnSpeed) {
            if (speed > 1) {
                this.btnSpeed.classList.add('active-speed');
            } else {
                this.btnSpeed.classList.remove('active-speed');
            }
        }
        this.flashHUD(`⚡ ${speed}x`);
    }

    triggerTapRipple(side, text, iconName) {
        // Đã tắt hiển thị sóng/thông báo khi cử chỉ chạm
        return;
    }

    applyTheme(mode) {
        this.themeMode = mode === 'black' ? 'black' : 'normal';
        try {
            localStorage.setItem('vod_theme_mode', this.themeMode);
        } catch (e) {}

        if (this.themeMode === 'black') {
            document.body.classList.add('theme-black');
        } else {
            document.body.classList.remove('theme-black');
        }

        const blackToggle = document.getElementById('setting-toggle-blackmode');
        if (blackToggle) {
            blackToggle.checked = (this.themeMode === 'black');
        }
    }

    applyFitMode(mode) {
        this.fitMode = mode === 'cover' ? 'cover' : 'contain';
        try {
            localStorage.setItem('vod_fit_mode', this.fitMode);
        } catch (e) {}

        if (this.video) {
            if (this.fitMode === 'cover') {
                this.video.classList.add('fit-cover');
            } else {
                this.video.classList.remove('fit-cover');
            }
        }

        const fitToggle = document.getElementById('setting-toggle-fitmode');
        if (fitToggle) {
            fitToggle.checked = (this.fitMode === 'cover');
        }
    }

    updateGestureSetting(key, value) {
        this.gestureSettings[key] = !!value;
        try {
            localStorage.setItem('vod_gesture_settings', JSON.stringify(this.gestureSettings));
        } catch (e) {}
    }

    init() {
        this.applyTheme(this.themeMode);
        this.applyFitMode(this.fitMode);
        this.bindEvents();
        this.bindSettingsEvents();
    }

    openQualityMenu() {
        if (!this.qualityMenuModal) return;
        this.renderQualityMenu();
        this.qualityMenuModal.classList.remove('hidden');
    }

    closeQualityMenu() {
        if (this.qualityMenuModal) {
            this.qualityMenuModal.classList.add('hidden');
        }
    }

    renderQualityMenu() {
        if (!this.qualityMenuList) return;
        if (!this.hlsPlayer || !this.hlsPlayer.levels || this.hlsPlayer.levels.length === 0) {
            this.qualityMenuList.innerHTML = `
                <div class="quality-option-item active" style="justify-content: center; cursor: default;">
                    <span>Tự động (Mặc định)</span>
                </div>
            `;
            return;
        }

        const levels = this.hlsPlayer.levels;
        const currentLevel = this.hlsPlayer.currentLevel; // -1: Auto
        const autoLevel = this.hlsPlayer.autoLevelEnabled;

        let html = `
            <div class="quality-option-item ${autoLevel || currentLevel === -1 ? 'active' : ''}" data-level="-1">
                <span>Tự động (Auto)</span>
                <span class="quality-badge">${this.currentQualityHeight ? `${this.currentQualityHeight}p` : 'Mặc định'}</span>
            </div>
        `;

        // Render sorted levels (highest first)
        const indexedLevels = levels.map((lvl, idx) => ({ ...lvl, index: idx }));
        indexedLevels.sort((a, b) => (b.height || 0) - (a.height || 0));

        indexedLevels.forEach(lvl => {
            const h = lvl.height || 0;
            const label = h > 0 ? `${h}p` : `Chất lượng ${lvl.index + 1}`;
            const isHd = h >= 720;
            const isFhd = h >= 1080;
            const badge = isFhd ? 'Full HD' : (isHd ? 'HD' : 'SD');
            const isSelected = (!autoLevel && currentLevel === lvl.index);

            html += `
                <div class="quality-option-item ${isSelected ? 'active' : ''}" data-level="${lvl.index}">
                    <span>${label}</span>
                    <span class="quality-badge">${badge}</span>
                </div>
            `;
        });

        this.qualityMenuList.innerHTML = html;

        this.qualityMenuList.querySelectorAll('.quality-option-item').forEach(item => {
            item.onclick = (e) => {
                e.stopPropagation();
                const levelIdx = parseInt(item.getAttribute('data-level'), 10);
                this.selectQualityLevel(levelIdx);
                this.closeQualityMenu();
            };
        });
    }

    selectQualityLevel(levelIdx) {
        if (!this.hlsPlayer) return;
        if (levelIdx === -1) {
            this.hlsPlayer.currentLevel = -1; // Auto
            if (this.qualityLabel) this.qualityLabel.innerText = 'Auto';
            if (window.showToast) window.showToast('Đã chuyển sang chất lượng Tự động (Auto)', 'info', 1800);
        } else {
            this.hlsPlayer.currentLevel = levelIdx;
            const levelObj = this.hlsPlayer.levels[levelIdx];
            const h = levelObj ? levelObj.height : null;
            if (h) {
                this.currentQualityHeight = h;
                if (this.qualityLabel) this.qualityLabel.innerText = `${h}p`;
                if (window.showToast) window.showToast(`Đã chọn chất lượng ${h}p`, 'success', 1800);
            }
        }
        this.updateQualityButtonUI();
    }

    updateQualityButtonUI() {
        if (!this.qualityLabel) return;
        if (this.hlsPlayer && this.hlsPlayer.levels && this.hlsPlayer.levels.length > 0) {
            if (this.hlsPlayer.currentLevel === -1) {
                const autoLvl = this.hlsPlayer.levels[this.hlsPlayer.loadLevel >= 0 ? this.hlsPlayer.loadLevel : 0];
                const h = autoLvl ? autoLvl.height : 1080;
                this.qualityLabel.innerText = h ? `${h}p` : 'Auto';
            } else {
                const lvl = this.hlsPlayer.levels[this.hlsPlayer.currentLevel];
                if (lvl && lvl.height) {
                    this.qualityLabel.innerText = `${lvl.height}p`;
                }
            }
        }
    }

    initHLS(startTime = 0) {
        const urlLower = (this.streamUrl || '').toLowerCase();
        const isTs = urlLower.endsWith('.ts') || urlLower.includes('.ts?') || urlLower.includes('.ts&') || urlLower.includes('.ts%3f') ||
                     urlLower.endsWith('.datts') || urlLower.includes('.datts?') || urlLower.includes('.datts&') || urlLower.includes('.datts%3f');
        const isM3u8 = urlLower.endsWith('.m3u8') || urlLower.includes('.m3u8?') ||
                       urlLower.endsWith('.datm3u8') || urlLower.includes('.datm3u8?');
        const isHls = isTs || isM3u8;

        if (this.hlsPlayer) {
            try {
                this.hlsPlayer.destroy();
            } catch (e) {}
            this.hlsPlayer = null;
        }

        if (isHls && typeof Hls !== 'undefined' && Hls.isSupported()) {
            this.hlsPlayer = new Hls({
                maxBufferLength: 20,               // Nâng lên 20s: đệm an toàn 2-3 GOPs, chống giật/bể hình khi GDrive TTFB jitter
                maxMaxBufferLength: 40,           // Tối đa 40s khi mạng rảnh và phát ổn định
                maxBufferSize: 32 * 1024 * 1024,   // 32MB RAM buffer nhẹ và mượt cho cả mobile
                backBufferLength: 900,             // Giới hạn SourceBuffer lùi tối đa 15 phút, dọn dẹp data cũ tránh tràn heap
                maxBufferHole: 0.5,                // Xử lý gap cực nhạy khi seek
                highBufferWatchdogPeriod: 2,       // Kiểm tra buffer mỗi 2s
                enableWorker: true,
                lowLatencyMode: false,
                startFragPrefetch: true,          // Bật Prefetch fragment kế tiếp (đã an toàn nhờ Hard Abort khi seek)
                appendErrorMaxRetry: 5,            // Retry khi append buffer bị ngắt
                fragLoadingMaxRetry: 10,           // Thử lại 10 lần nếu rclone/gdrive nháy kết nối
                fragLoadingRetryDelay: 300,        // Giảm delay retry xuống 300ms cho phản hồi cực nhanh
                fragLoadingTimeOut: 30000,         // Timeout 30s cho fragment lớn
                manifestLoadingMaxRetry: 5,
                levelLoadingMaxRetry: 5
            });
            this.hlsPlayer.loadSource(this.streamUrl);
            this.hlsPlayer.attachMedia(this.video);

            this.hlsPlayer.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                console.log('[OnePlayer] Manifest Parsed successfully');
                if (startTime > 0 && this.video) {
                    try {
                        this.video.currentTime = startTime;
                        console.log(`[OnePlayer] Smart Auto-Skip: jumped to ${startTime}s (avoiding black/intro frame)`);
                        if (window.showToast && startTime >= 5) {
                            window.showToast(`⏩ Tự động bỏ qua ${Math.round(startTime)}s mở đầu`, 'info', 2500);
                        }
                    } catch (e) {
                        console.debug('Seek to startTime error:', e);
                    }
                }
                // Tự động chọn level chất lượng cao nhất (1080p -> 720p -> thấp hơn)
                if (this.hlsPlayer.levels && this.hlsPlayer.levels.length > 0) {
                    let highestLevelIdx = 0;
                    let maxHeight = 0;
                    this.hlsPlayer.levels.forEach((level, idx) => {
                        const h = level.height || 0;
                        if (h > maxHeight) {
                            maxHeight = h;
                            highestLevelIdx = idx;
                        }
                    });
                    this.hlsPlayer.currentLevel = highestLevelIdx;
                    this.currentQualityHeight = maxHeight;
                    if (this.qualityLabel) {
                        this.qualityLabel.innerText = maxHeight ? `${maxHeight}p` : 'HD';
                    }
                    console.log(`[OnePlayer] Selected highest quality: ${maxHeight}p (level index ${highestLevelIdx})`);
                }
                if (this.video && this.video.paused) {
                    const playPromise = this.video.play();
                    if (playPromise !== undefined) {
                        playPromise.catch(() => {
                            // Trình duyệt chặn autoplay có tiếng -> Mute để phát tự động mượt mà
                            this.video.muted = true;
                            this.video.play().catch(e => console.debug('[OnePlayer] Autoplay blocked:', e));
                        });
                    }
                }
            });

            this.hlsPlayer.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
                const lvl = this.hlsPlayer.levels[data.level];
                if (lvl && lvl.height) {
                    this.currentQualityHeight = lvl.height;
                    if (this.qualityLabel && this.hlsPlayer.currentLevel !== -1) {
                        this.qualityLabel.innerText = `${lvl.height}p`;
                    }
                }
            });

            this.hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
                const responseCode = (data.response && (data.response.code || data.response.status)) || (data.networkDetails && data.networkDetails.status);
                if (responseCode === 404 || responseCode === 403 || responseCode === 500) {
                    this.markCurrentVideoError(`HTTP error ${responseCode}`, responseCode);
                    this.showUpdatingMessage(`Link stream video đã hết hạn hoặc bị lỗi (${responseCode}). Đã đánh dấu để crawler cào lại!`);
                    if (this.hlsPlayer) this.hlsPlayer.destroy();
                    return;
                }
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.log('[OnePlayer] Network error, recovering...');
                            if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
                                this.markCurrentVideoError(`Manifest load error: ${data.details}`, 404);
                                this.showUpdatingMessage('Không thể tải luồng video, đã đánh dấu để crawler cào lại link mới');
                                if (this.hlsPlayer) this.hlsPlayer.destroy();
                            } else {
                                this.hlsPlayer.startLoad();
                            }
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.log('[OnePlayer] Media error, recovering...');
                            this.hlsPlayer.recoverMediaError();
                            break;
                        default:
                            this.markCurrentVideoError(`Fatal HLS error: ${data.details || data.type}`, 500);
                            this.showUpdatingMessage('Video gặp sự cố phát, đã đánh dấu để crawler cào lại');
                            if (this.hlsPlayer) this.hlsPlayer.destroy();
                            break;
                    }
                }
            });
        } else {
            this.video.src = this.streamUrl;
            const onLoadedData = () => {
                this.hideLoading();
                this.video.removeEventListener('loadeddata', onLoadedData);
            };
            this.video.addEventListener('loadeddata', onLoadedData);
            setTimeout(() => this.hideLoading(), 1500);
        }
    }

    recordViewHistory() {
        let code = this.currentVideoName || this.currentVideoPath;
        if (!code && this.streamUrl) {
            const m = this.streamUrl.match(/\/hls\/([^\/]+)\//i);
            if (m) code = m[1];
        }
        if (!code) return;
        code = code.trim().toUpperCase();

        try {
            const base = this.backendHost || '';
            const headers = { 'Content-Type': 'application/json' };
            const token = localStorage.getItem('jwt_token');
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            let guestId = localStorage.getItem('rphang_guest_id');
            if (!guestId) {
                guestId = 'guest_' + Math.random().toString(36).substring(2, 12);
                try { localStorage.setItem('rphang_guest_id', guestId); } catch(e) {}
            }
            headers['X-Guest-ID'] = guestId;

            const payload = {
                code: code,
                media_id: code,
                path: this.currentVideoPath || code,
                title: this.currentVideoTitle || code,
                name: this.currentVideoName || code,
                progress_sec: this.video ? (this.video.currentTime || 0) : 0,
                duration_sec: this.video ? (this.video.duration || 0) : 0
            };
            fetch(`${base}/api/history/view`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload),
                credentials: 'include'
            }).catch(() => {});
        } catch (e) {}
    }

    async markCurrentVideoError(reason = 'Stream playback error', httpCode = 404) {
        let code = this.currentVideoName || this.currentVideoPath;
        if (!code && this.streamUrl) {
            const m = this.streamUrl.match(/\/hls\/([^\/]+)\//i);
            if (m) code = m[1];
        }
        if (!code) return;
        code = code.trim().toUpperCase();

        try {
            const base = this.backendHost || '';
            const res = await fetch(`${base}/api/video/${encodeURIComponent(code)}/mark_error`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: reason, http_code: httpCode })
            });
            const data = await res.json();
            if (data.success) {
                console.warn(`[OnePlayer] ⚠️ Đã đánh dấu lỗi video ${code} thành công:`, reason);
                const toastMsg = `⚠️ Video ${code} bị lỗi link stream. Đã đánh dấu để crawler cào lại link mới!`;
                if (window.showToast) {
                    window.showToast(toastMsg, 'warning');
                }
                window.dispatchEvent(new CustomEvent('missav:video-marked-error', {
                    detail: { code: code, reason: reason, httpCode: httpCode }
                }));
            }
        } catch (err) {
            console.error('[OnePlayer] Lỗi khi gọi mark_error:', err);
        }
    }

    showUpdatingMessage(msg = 'video đang update, vui lòng đợi') {
        this.showLoading({
            title: this.currentVideoTitle || 'Thông báo',
            status: `⚠️ ${msg}`
        });
        if (window.showToast) {
            window.showToast(msg, 'warning');
        }
    }

    showSeekingSpinner() {
        if (this.seekingSpinner) {
            if (this.seekingSpinnerTimeout) return;
            this.seekingSpinnerTimeout = setTimeout(() => {
                if (this.seekingSpinner) {
                    this.seekingSpinner.classList.remove('hidden');
                }
                this.seekingSpinnerTimeout = null;
            }, 250);
        }
    }

    hideSeekingSpinner() {
        if (this.seekingSpinnerTimeout) {
            clearTimeout(this.seekingSpinnerTimeout);
            this.seekingSpinnerTimeout = null;
        }
        if (this.seekingSpinner) {
            this.seekingSpinner.classList.add('hidden');
        }
    }

    showLoading(opts = {}) {
        this.hideSeekingSpinner();

        // 1. Giữ nguyên hoặc nạp ngay ảnh Cover mới mà không bao giờ chớp nền đen
        const targetSrc = (opts.coverSrc && typeof opts.coverSrc === 'string' && opts.coverSrc.trim()) ? opts.coverSrc.trim() : (this.currentCoverSrc || '');
        if (targetSrc) {
            this.currentCoverSrc = targetSrc;
            if (this.video) {
                this.video.poster = targetSrc;
            }

            const applyCoverSrc = () => {
                if (this.loadingCoverBg && this.loadingCoverBg.src !== targetSrc) {
                    this.loadingCoverBg.src = targetSrc;
                }
                if (this.loadingCoverBg) this.loadingCoverBg.classList.add('loaded');

                if (this.loadingCover && this.loadingCover.src !== targetSrc) {
                    this.loadingCover.src = targetSrc;
                }
                if (this.loadingCover) this.loadingCover.classList.add('loaded');
            };

            // Nếu ảnh đã có trong cache bộ nhớ trình duyệt hoặc là URL giống ảnh đang hiển thị
            const preImg = new Image();
            preImg.onload = () => {
                if (this.currentCoverSrc === targetSrc) {
                    applyCoverSrc();
                }
            };
            preImg.src = targetSrc;
            if (preImg.complete) {
                applyCoverSrc();
            }
        }

        if (this.loadingOverlay) {
            this.loadingOverlay.classList.remove('hidden');
        }
    }

    hideLoading() {
        if (this.loadingFallbackTimeout) {
            clearTimeout(this.loadingFallbackTimeout);
            this.loadingFallbackTimeout = null;
        }
        if (this.loadingOverlay) {
            this.loadingOverlay.classList.add('hidden');
            this.loadingOverlay.classList.remove('preview-mode');
        }
    }

    sendInteraction(action, extraData = {}) {
        const code = extraData.code || this.currentVideoName || this.currentVideoPath;
        if (!code) return;
        const codeClean = code.trim().toUpperCase();
        const payload = {
            code: codeClean,
            action: action,
            watch_time_sec: extraData.watch_time_sec || 0
        };
        fetch(`${this.backendHost}/api/user/interaction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            credentials: 'include'
        }).catch(err => console.debug('[OnePlayer] Interaction report error:', err));
    }

    startCoverPreview() {
        this.cancelCoverCountdown();
        this.isCoverPreviewing = false;
        // Bỏ chế độ chờ xem cover 3 giây -> Phát video luôn
        if (this.pendingPlaybackArgs) {
            const args = this.pendingPlaybackArgs;
            this.pendingPlaybackArgs = null;
            this.executeLoadStream(args.url, args.opts);
        }
    }

    startCoverCountdown() {
        this.startCoverPreview();
    }

    cancelCoverCountdown() {
        if (this.coverCountdownAnimFrame) {
            cancelAnimationFrame(this.coverCountdownAnimFrame);
            this.coverCountdownAnimFrame = null;
        }
        if (this.coverCountdownTimer) {
            clearTimeout(this.coverCountdownTimer);
            this.coverCountdownTimer = null;
        }
        this.isCoverPreviewing = false;
        if (this.loadingOverlay) {
            this.loadingOverlay.classList.remove('preview-mode');
        }
        if (this.countdownWrapper) this.countdownWrapper.classList.add('hidden');
        if (this.countdownHint) this.countdownHint.classList.add('hidden');
        if (this.spinnerBox) this.spinnerBox.classList.remove('hidden');
    }

    confirmPlayFromPreview() {
        if (!this.isCoverPreviewing && !this.pendingPlaybackArgs) return;
        this.cancelCoverCountdown();

        const curCode = this.currentVideoName || this.currentVideoPath;
        if (curCode) {
            this.currentVideoConfirmedView = true;
            this.sendInteraction('view', { code: curCode });
        }

        if (this.pendingPlaybackArgs) {
            const args = this.pendingPlaybackArgs;
            this.pendingPlaybackArgs = null;
            this.executeLoadStream(args.url, args.opts);
        }
    }

    handleDislike() {
        const code = this.currentVideoName || this.currentVideoPath;
        if (!code) {
            if (window.showToast) window.showToast('Không xác định được mã video', 'warning');
            return;
        }
        this.cancelCoverCountdown();
        this.sendInteraction('dislike', { code: code });
        if (window.showToast) {
            window.showToast(`Đã ẩn [${code}] khỏi danh sách gợi ý!`, 'info', 2200);
        }
        if (this.onNext) {
            this.onNext();
        }
    }

    setAdjacentFeedData(data) {
        this.adjacentFeedData = data || { next: null, prev: null };
        // Pre-cache ảnh Cover của Next/Prev video vào RAM trình duyệt ngay lập tức
        if (data && data.next && data.next.coverUrl) {
            const imgNext = new Image(); imgNext.src = data.next.coverUrl;
        }
        if (data && data.prev && data.prev.coverUrl) {
            const imgPrev = new Image(); imgPrev.src = data.prev.coverUrl;
        }
        // Nếu video hiện tại đang phát mượt > 1.2s, kích hoạt preload Range 1MB của next video
        if (this.video && !this.video.paused && this.video.currentTime > 1.2) {
            this.scheduleNextStreamPreload();
        }
    }

    scheduleNextStreamPreload() {
        this.cancelNextStreamPreload();
        this.nextStreamPreloadTimeout = setTimeout(() => {
            this.executeNextStreamPreload();
        }, 1500);
    }

    cancelNextStreamPreload() {
        if (this.nextStreamPreloadTimeout) {
            clearTimeout(this.nextStreamPreloadTimeout);
            this.nextStreamPreloadTimeout = null;
        }
        if (this.nextStreamAbortController) {
            try { this.nextStreamAbortController.abort(); } catch (e) {}
            this.nextStreamAbortController = null;
        }
    }

    executeNextStreamPreload() {
        const nextInfo = this.adjacentFeedData ? this.adjacentFeedData.next : null;
        if (!nextInfo || !nextInfo.streamUrl) return;

        const targetUrl = nextInfo.streamUrl;
        // Chỉ nạp trước nếu là GDrive stream nội bộ (tránh gọi cross-origin CDN gây lỗi CORS trên browser)
        const isInternalGdrive = targetUrl.includes('/api/gdrive/');
        if (!isInternalGdrive) return;

        if (this.lastPreloadedStreamUrl === targetUrl) return;
        this.lastPreloadedStreamUrl = targetUrl;

        this.nextStreamAbortController = new AbortController();
        const signal = this.nextStreamAbortController.signal;

        // Kéo đúng Range 1MB đầu tiên (bytes 0-1048575) để kích hoạt RAM Cache trên server và nạp moov/keyframes đầu
        fetch(targetUrl, {
            method: 'GET',
            headers: { 'Range': 'bytes=0-1048575' },
            signal: signal,
            credentials: 'include'
        }).then(res => {
            if (res.status === 206 || res.status === 200) {
                console.log(`[OnePlayer] ⚡ Preloaded 1MB Range head for Next Video [${nextInfo.code || ''}]`);
            }
        }).catch(err => {
            if (err.name !== 'AbortError') {
                console.debug('[OnePlayer] Next stream preload error:', err);
            }
        });
    }

    updateFeedPreview(direction) {
        if (!this.feedPreview) return;
        if (this.activeFeedDirection === direction) return; // Tối ưu: Tránh gán lại DOM .src 60 lần/giây gây giật lag
        this.activeFeedDirection = direction;

        const info = direction === 'next' ? (this.adjacentFeedData ? this.adjacentFeedData.next : null) : (this.adjacentFeedData ? this.adjacentFeedData.prev : null);
        if (info && (info.coverUrl || info.title || info.code)) {
            const targetCover = info.coverUrl || '';
            if (this.feedPreviewBg && this.feedPreviewBg.src !== targetCover) this.feedPreviewBg.src = targetCover;
            if (this.feedPreviewCover && this.feedPreviewCover.src !== targetCover) this.feedPreviewCover.src = targetCover;
            if (this.feedPreviewTitle) this.feedPreviewTitle.innerText = info.title || info.code || '';
            if (this.feedPreviewCode) this.feedPreviewCode.innerText = (info.code || '').toUpperCase();
            this.feedPreview.classList.remove('hidden');
        }
    }

    hideFeedPreview() {
        this.activeFeedDirection = null;
        if (this.feedPreview) {
            this.feedPreview.classList.add('hidden');
        }
    }

    loadStream(newUrl, opts = {}) {
        const prevCode = this.currentVideoName || this.currentVideoPath;
        const newCode = (opts.code || opts.name || opts.title || this.currentVideoName || '').trim().toUpperCase();

        // 1. Debounced Skip tracking: Nếu video trước bị chuyển đi khi chưa xác nhận xem hoặc xem < 3 giây
        if (prevCode && prevCode !== newCode) {
            if (!this.currentVideoConfirmedView || this.currentVideoPlaybackSeconds < 3) {
                const scheduledCode = prevCode;
                if (this.pendingSkips[scheduledCode]) {
                    clearTimeout(this.pendingSkips[scheduledCode].timeoutId);
                }
                this.pendingSkips[scheduledCode] = {
                    timeoutId: setTimeout(() => {
                        this.sendInteraction('skip', { code: scheduledCode });
                        delete this.pendingSkips[scheduledCode];
                    }, 4000),
                    timestamp: Date.now()
                };
            }
        }

        // 2. Undo Skip: Nếu người dùng quay lại (Prev) đúng video vừa skip trong vòng 4s
        if (newCode && this.pendingSkips[newCode]) {
            clearTimeout(this.pendingSkips[newCode].timeoutId);
            delete this.pendingSkips[newCode];
            this.sendInteraction('undo_skip', { code: newCode });
            if (window.showToast) {
                window.showToast(`Đã quay lại xem [${newCode}]`, 'success', 1500);
            }
        }

        this.currentVideoConfirmedView = false;
        this.currentVideoPlaybackSeconds = 0;
        this.lastWatchTimeReportSec = 0;
        this.hasMovedGesture = false;
        this.isSwiping = false;
        this.lastTapTime = 0;
        this.cancelNextStreamPreload();
        this.lastPreloadedStreamUrl = null;

        // Dừng và dập tắt kết nối video cũ ngay lập tức khi vuốt sang video mới
        if (this.video) {
            this.video.pause();
            this.video.removeAttribute('src');
            try { this.video.load(); } catch (e) {}
        }
        if (this.hlsPlayer) {
            this.hlsPlayer.destroy();
            this.hlsPlayer = null;
        }
        if (this.seekFill) this.seekFill.style.width = '0%';
        if (this.currTimeText) this.currTimeText.innerText = '00:00';

        if (newUrl) {
            this.streamUrl = newUrl;
        }
        if (opts.coverSrc) {
            this.currentCoverSrc = opts.coverSrc;
        }

        this.showLoading({
            title: opts.title || this.currentVideoTitle || this.currentVideoName || 'Đang nạp video...',
            coverSrc: opts.coverSrc || this.currentCoverSrc || '',
            status: opts.status || 'Sẵn sàng phát video'
        });

        // Debounce thông minh 220ms khi vuốt liên tục:
        // Nếu người dùng lướt nhanh qua các video do thấy cover không hay => Dập ngay, không tải video
        if (this.loadStreamDebounceTimeout) {
            clearTimeout(this.loadStreamDebounceTimeout);
            this.loadStreamDebounceTimeout = null;
        }

        const debounceDelay = (opts.immediate || opts.startTime > 0) ? 0 : 220;
        if (debounceDelay === 0) {
            this.executeLoadStream(newUrl, { ...opts, autoplay: opts.autoplay !== false });
        } else {
            this.loadStreamDebounceTimeout = setTimeout(() => {
                this.loadStreamDebounceTimeout = null;
                this.executeLoadStream(newUrl, { ...opts, autoplay: opts.autoplay !== false });
            }, debounceDelay);
        }
    }

    executeLoadStream(newUrl, opts = {}) {
        this.cancelCoverCountdown();
        if (newUrl) {
            this.streamUrl = newUrl;
        }
        const targetCover = (opts.coverSrc && typeof opts.coverSrc === 'string' && opts.coverSrc.trim()) ? opts.coverSrc.trim() : (this.currentCoverSrc || '');
        if (targetCover) {
            this.currentCoverSrc = targetCover;
        }
        this.showLoading({
            title: opts.title || this.currentVideoTitle || this.currentVideoName || 'Đang nạp video...',
            coverSrc: targetCover,
            status: opts.status || 'Đang nạp file m3u8 stream...'
        });
        if (this.video) {
            this.video.pause();
            if (targetCover) {
                this.video.poster = targetCover;
            }
            this.video.removeAttribute('src');
            this.video.load();
        }
        if (this.hlsPlayer) {
            try {
                this.hlsPlayer.destroy();
            } catch (e) {}
            this.hlsPlayer = null;
        }
        if (this.seekFill) this.seekFill.style.width = '0%';
        if (this.currTimeText) this.currTimeText.innerText = '00:00';

        // Fallback tự động ẩn loading overlay sau 6s phòng trường hợp trình duyệt không bắn canplay
        clearTimeout(this.loadingFallbackTimeout);
        this.loadingFallbackTimeout = setTimeout(() => {
            this.hideLoading();
        }, 6000);

        const startTime = opts.startTime || 0;
        this.initHLS(startTime);

        if (opts.autoplay !== false) {
            this.video.play().catch(e => console.log('[OnePlayer] Auto-play after load error:', e));
        }
    }

    setSources(sources = [], preferredId = null) {
        this.sources = Array.isArray(sources) ? sources : [];
        if (this.sources.length === 0) {
            this.activeSourceIndex = 0;
            if (this.btnStreamSource) this.btnStreamSource.style.display = 'none';
            return;
        }

        const isGDriveMode = !!(window.__IS_GDRIVE_ONLY__ || (window.location.port === '3001') || (window.location.port === '3005'));
        const defaultSourceId = isGDriveMode ? 'gdrive' : 'cdn';
        const targetId = preferredId || defaultSourceId;
        let idx = this.sources.findIndex(s => s.id === targetId);
        if (idx === -1) {
            if (isGDriveMode) {
                idx = this.sources.findIndex(s => s.id === 'gdrive' || s.type === 'gdrive');
            } else {
                idx = this.sources.findIndex(s => s.id === 'cdn' || s.type !== 'gdrive');
            }
            if (idx === -1) idx = 0;
        }
        this.activeSourceIndex = idx;
        if (this.sources[idx]) {
            this.preferredStreamSource = this.sources[idx].id;
        }

        this.updateSourceButtonUI();
    }

    updateSourceButtonUI() {
        if (!this.btnStreamSource) return;
        if (!this.sources || this.sources.length === 0) {
            this.btnStreamSource.style.display = 'none';
            return;
        }

        this.btnStreamSource.style.display = 'inline-flex';
        const currentSrc = this.sources[this.activeSourceIndex] || this.sources[0];
        const canSwap = this.sources.length > 1;

        if (this.sourceLabel) {
            this.sourceLabel.innerText = currentSrc.label || 'Nguồn';
        }
        if (this.sourceIcon) {
            this.sourceIcon.innerText = currentSrc.icon || (currentSrc.id === 'gdrive' ? 'cloud_done' : 'bolt');
        }

        this.btnStreamSource.classList.remove('source-gdrive', 'source-surrit', 'source-leak', 'source-eng', 'source-sub', 'can-swap');
        if (currentSrc.id === 'gdrive' || currentSrc.type === 'gdrive') {
            this.btnStreamSource.classList.add('source-gdrive');
        } else if (currentSrc.type === 'uncensored_leak') {
            this.btnStreamSource.classList.add('source-leak');
        } else if (currentSrc.type === 'english_sub') {
            this.btnStreamSource.classList.add('source-eng');
        } else if (currentSrc.type === 'chinese_sub') {
            this.btnStreamSource.classList.add('source-sub');
        } else {
            this.btnStreamSource.classList.add('source-surrit');
        }

        if (canSwap) {
            this.btnStreamSource.classList.add('can-swap');
            if (this.sourceSwapBadge) this.sourceSwapBadge.style.display = 'inline-block';
            const nextIdx = (this.activeSourceIndex + 1) % this.sources.length;
            const nextSrc = this.sources[nextIdx];
            this.btnStreamSource.title = `Nguồn hiện tại: ${currentSrc.label} (${currentSrc.desc || ''})\nBấm để chuyển sang: ${nextSrc.label} (${nextSrc.desc || ''})`;
        } else {
            if (this.sourceSwapBadge) this.sourceSwapBadge.style.display = 'none';
            this.btnStreamSource.title = `Nguồn hiện tại: ${currentSrc.label} (${currentSrc.desc || ''})`;
        }
    }

    openStreamSourceDrawer() {
        if (!this.streamSourceDrawerModal) return;
        if (window.explorerApp && typeof window.explorerApp.closeAllDrawers === 'function') {
            window.explorerApp.closeAllDrawers('streamSource');
        }

        this.renderStreamSourceDrawer();
        this.streamSourceDrawerModal.classList.remove('hidden');
    }

    closeStreamSourceDrawer() {
        if (this.streamSourceDrawerModal) {
            this.streamSourceDrawerModal.classList.add('hidden');
        }
    }

    renderStreamSourceDrawer() {
        if (!this.streamSourceOptionsContainer) return;
        if (this.streamSourceDrawerSub) {
            const videoCode = this.currentVideoName || this.currentVideoPath || '';
            this.streamSourceDrawerSub.innerText = videoCode ? `Mã video: ${videoCode}` : 'Chuyển luồng phát & Đặt làm ưu tiên';
        }

        if (!this.sources || this.sources.length === 0) {
            this.streamSourceOptionsContainer.innerHTML = `
                <div class="stream-source-card-item active" style="cursor: default; justify-content: center;">
                    <div class="stream-source-card-left" style="justify-content: center;">
                        <span class="stream-source-card-title">Chỉ có 1 nguồn phát mặc định</span>
                    </div>
                </div>
            `;
            return;
        }

        let html = '';
        this.sources.forEach((src, idx) => {
            const isActive = (idx === this.activeSourceIndex);
            let iconClass = 'surrit';
            let tagClass = 'tag-surrit';

            if (src.type === 'gdrive' || src.id === 'gdrive') {
                iconClass = 'gdrive';
                tagClass = 'tag-gdrive';
            } else if (src.type === 'uncensored_leak') {
                iconClass = 'leak';
                tagClass = 'tag-leak';
            } else if (src.type === 'english_sub') {
                iconClass = 'eng';
                tagClass = 'tag-eng';
            } else if (src.type === 'chinese_sub') {
                iconClass = 'sub';
                tagClass = 'tag-sub';
            }

            const iconName = src.icon || (src.id === 'gdrive' ? 'cloud_done' : (src.type === 'uncensored_leak' ? 'local_fire_department' : (src.type === 'english_sub' ? 'subtitles' : 'bolt')));
            const tagText = src.tag || (src.id === 'gdrive' ? 'GDRIVE' : (src.type === 'uncensored_leak' ? 'LEAK' : (src.type === 'english_sub' ? 'ENG' : 'CDN')));
            const descText = src.desc || (src.id === 'gdrive' ? 'Google Drive (Gốc)' : 'MissAV CDN Stream');

            html += `
                <div class="stream-source-card-item ${isActive ? 'active' : ''}" data-source-index="${idx}">
                    <div class="stream-source-card-left">
                        <div class="stream-source-card-icon-box ${iconClass}">
                            <span class="material-symbols-outlined">${iconName}</span>
                        </div>
                        <div class="stream-source-card-info">
                            <div class="stream-source-card-title-row">
                                <span class="stream-source-card-title">${src.label || 'Nguồn'}</span>
                                <span class="stream-source-card-tag ${tagClass}">${tagText}</span>
                            </div>
                            <span class="stream-source-card-desc">${descText}</span>
                        </div>
                    </div>
                    <div class="stream-source-card-right">
                        <span class="stream-source-status-badge">ĐANG PHÁT</span>
                        <span class="material-symbols-outlined stream-source-check-icon">check_circle</span>
                    </div>
                </div>
            `;
        });

        this.streamSourceOptionsContainer.innerHTML = html;

        this.streamSourceOptionsContainer.querySelectorAll('.stream-source-card-item').forEach(item => {
            item.onclick = (e) => {
                e.stopPropagation();
                const targetIdx = parseInt(item.getAttribute('data-source-index'), 10);
                if (!isNaN(targetIdx)) {
                    if (targetIdx !== this.activeSourceIndex) {
                        this.switchStreamSource(targetIdx);
                    }
                    this.closeStreamSourceDrawer();
                }
            };
        });
    }

    switchStreamSource(targetIndex = null) {
        if (!this.sources || this.sources.length === 0) return;

        const nextIdx = targetIndex !== null ? targetIndex : (this.activeSourceIndex + 1) % this.sources.length;
        this.activeSourceIndex = nextIdx;
        const newSrc = this.sources[this.activeSourceIndex];
        if (newSrc && newSrc.id) {
            this.preferredStreamSource = newSrc.id;
            try {
                localStorage.setItem('vod_preferred_stream_source', newSrc.id);
                if (newSrc.type === 'uncensored_leak') {
                    localStorage.setItem('vod_preferred_variant_priority', 'leak');
                } else if (newSrc.type === 'english_sub') {
                    localStorage.setItem('vod_preferred_variant_priority', 'english');
                } else if (newSrc.type === 'chinese_sub') {
                    localStorage.setItem('vod_preferred_variant_priority', 'chinese');
                } else if (newSrc.type === 'standard') {
                    localStorage.setItem('vod_preferred_variant_priority', 'standard');
                } else if (newSrc.type === 'gdrive') {
                    localStorage.setItem('vod_preferred_stream_source', 'gdrive');
                }
            } catch (e) {}
        }
        this.updateSourceButtonUI();

        const curTime = (this.video && !isNaN(this.video.currentTime)) ? this.video.currentTime : 0;
        const isPaused = this.video ? this.video.paused : false;

        // Nếu đang trong chế độ preview countdown 3s
        if (this.isCoverPreviewing) {
            this.streamUrl = newSrc.url;
            this.pendingPlaybackArgs = {
                url: newSrc.url,
                opts: {
                    title: this.currentVideoTitle || this.currentVideoName,
                    coverSrc: this.currentCoverSrc,
                    status: `Sẵn sàng phát từ nguồn ${newSrc.label} (${newSrc.desc || ''})`,
                    startTime: 0,
                    autoplay: true,
                    preview: false,
                    previewCover: false
                }
            };
            this.showLoading({
                title: this.currentVideoTitle || this.currentVideoName || 'Đang nạp video...',
                coverSrc: this.currentCoverSrc || '',
                status: `Đã chọn nguồn: ${newSrc.label} (${newSrc.desc || ''})`
            });
        } else {
            // Chuyển nguồn tức thì và tiếp tục phát theo trạng thái hiện tại (giữ timestamp curTime)
            this.loadStream(newSrc.url, {
                title: this.currentVideoTitle || this.currentVideoName,
                coverSrc: this.currentCoverSrc,
                status: `Đang chuyển nguồn sang ${newSrc.label} (${newSrc.desc || ''})...`,
                startTime: curTime,
                autoplay: !isPaused,
                preview: false,
                previewCover: false
            });
        }

        if (window.showToast) {
            window.showToast(`📡 Đã chuyển sang ${newSrc.label} & đặt làm nguồn ưu tiên`, 'success', 2500);
        }
    }

    requestInstantSeekChunk(targetTime) {
        if (!this.video || !this.streamUrl) return;
        const urlLower = (this.streamUrl || '').toLowerCase();
        // Kiểm tra nếu là stream GDrive nội bộ
        const isInternalGdrive = urlLower.includes('/api/gdrive/');
        if (!isInternalGdrive) return;

        // Nếu có abort controller của lần seek trước, abort để tránh chồng chéo luồng mạng
        if (this.instantSeekAbortController) {
            try { this.instantSeekAbortController.abort(); } catch (e) {}
        }
        this.instantSeekAbortController = new AbortController();

        // Chuẩn hóa stream endpoint để gọi stream range 4MB với ?t=<targetTime>
        let streamEndpoint = this.streamUrl;
        if (streamEndpoint.includes('/api/gdrive/hls/')) {
            const m = streamEndpoint.match(/\/api\/gdrive\/hls\/([^?#.]+)/i);
            const code = m ? m[1] : (this.currentVideoName || this.currentVideoPath || '');
            streamEndpoint = `/api/gdrive/stream/${encodeURIComponent(code)}.ts`;
        }

        // Gửi 1 thread Range request 4MB với query param ?t=<targetTime> để server map ngay byte offset từ keyframes .idx
        const targetFetchUrl = streamEndpoint + (streamEndpoint.includes('?') ? '&' : '?') + `t=${Math.max(0, targetTime).toFixed(2)}`;
        fetch(targetFetchUrl, {
            method: 'GET',
            headers: { 'Range': 'bytes=0-4194303' },
            signal: this.instantSeekAbortController.signal,
            credentials: 'include'
        }).then(res => {
            if (res.status === 206 || res.status === 200) {
                console.log(`[OnePlayer] ⚡ Instant 1-Thread 4MB Seek chunk primed at ${targetTime.toFixed(1)}s (X-Cache: ${res.headers.get('X-Cache') || 'STREAM'})`);
            }
        }).catch(err => {
            if (err.name !== 'AbortError') {
                console.debug('[OnePlayer] Instant seek priming notice:', err);
            }
        });
    }

    debouncedSeek(targetTime) {
        clearTimeout(this.seekDebounceTimeout);
        this.seekDebounceTimeout = setTimeout(() => {
            if (this.video && !isNaN(targetTime) && isFinite(targetTime)) {
                this.requestInstantSeekChunk(targetTime);
                this.video.currentTime = targetTime;
            }
        }, 40);
    }

    togglePlay() {
        if (this.isCoverPreviewing) {
            this.confirmPlayFromPreview();
            return;
        }
        if (this.video.paused) {
            this.video.play().catch(e => console.log('[OnePlayer] Play error:', e));
        } else {
            this.video.pause();
        }
    }

    toggleControls() {
        if (this.container) {
            this.container.classList.toggle('controls-hidden');
        }
    }

    setVideoPathAndFavorite(path, favorited, name, title, inQueue = false, hasGDrive = false) {
        this.currentVideoPath = path || '';
        this.currentVideoName = name || '';
        this.currentVideoTitle = title || name || '';
        this.isLiked = !!favorited;
        this.isInQueue = !!inQueue;
        this.hasGDrive = !!hasGDrive;

        this.updateQueueButtonUI();
    }

    setQueueState(inQueue, hasGDrive = null) {
        this.isInQueue = !!inQueue;
        if (hasGDrive !== null) {
            this.hasGDrive = !!hasGDrive;
        }
        this.updateQueueButtonUI();
    }

    updateQueueButtonUI() {
        if (!this.btnLike) return;
        const iconSpan = this.btnLike.querySelector('.material-symbols-outlined');
        this.btnLike.classList.remove('in-queue', 'has-gdrive', 'liked');

        if (this.hasGDrive) {
            this.btnLike.classList.add('has-gdrive');
            this.btnLike.setAttribute('title', 'Đã có trên Google Drive (Bấm để xem chi tiết / xóa)');
            if (iconSpan) iconSpan.innerText = 'cloud_done';
            if (this.likeCountText) this.likeCountText.innerText = 'Drive';
        } else if (this.isInQueue) {
            this.btnLike.classList.add('in-queue');
            this.btnLike.setAttribute('title', 'Đang trong hàng đợi tải (Bấm để hủy khỏi queue)');
            if (iconSpan) iconSpan.innerText = 'hourglass_top';
            if (this.likeCountText) this.likeCountText.innerText = 'Đang đợi';
        } else {
            this.btnLike.setAttribute('title', 'Thêm vào Hàng đợi Tải Google Drive (Double tap để thêm)');
            if (iconSpan) iconSpan.innerText = 'cloud_upload';
            if (this.likeCountText) this.likeCountText.innerText = '+ Drive';
        }
    }

    formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    openGDriveDrawer(code) {
        let videoCode = (code || this.currentVideoName || this.currentVideoPath || '').trim().toUpperCase();
        if (!videoCode && this.streamUrl) {
            const m = this.streamUrl.match(/\/hls\/([^\/]+)\//i);
            if (m) videoCode = m[1].toUpperCase();
        }
        if (!videoCode) {
            if (window.showToast) window.showToast('Không xác định được mã video!', 'error');
            return;
        }

        if (window.explorerApp && typeof window.explorerApp.closeAllDrawers === 'function') {
            window.explorerApp.closeAllDrawers('gdrive');
        }

        const modal = document.getElementById('gdrive-drawer-modal');
        if (!modal) return;

        // Reset UI with known info
        const elCode = document.getElementById('gdrive-drawer-code');
        const elTitle = document.getElementById('gdrive-drawer-title');
        const elAccountName = document.getElementById('gdrive-drawer-account-name');
        const elSize = document.getElementById('gdrive-drawer-size');
        const elFileId = document.getElementById('gdrive-drawer-fileid');
        const elPath = document.getElementById('gdrive-drawer-path');
        const elPromptCode = document.getElementById('gdrive-prompt-code');
        const elPromptAccount = document.getElementById('gdrive-prompt-account');
        const btnDelete = document.getElementById('btn-confirm-delete-gdrive');
        const txtDelete = document.getElementById('gdrive-delete-btn-text');

        if (elCode) elCode.innerText = videoCode;
        if (elTitle) elTitle.innerText = this.currentVideoTitle || videoCode;
        if (elPromptCode) elPromptCode.innerText = videoCode;
        if (elAccountName) elAccountName.innerText = 'Đang tải thông tin tài khoản...';
        if (elPromptAccount) elPromptAccount.innerText = 'Đang kiểm tra...';
        if (elSize) elSize.innerText = 'Đang tải...';
        if (elFileId) elFileId.innerText = '---';
        if (elPath) elPath.innerText = '---';
        if (btnDelete) {
            btnDelete.disabled = false;
            btnDelete.dataset.code = videoCode;
            btnDelete.dataset.account = '';
        }
        if (txtDelete) txtDelete.innerText = 'Xóa khỏi Google Drive';

        modal.classList.remove('hidden');

        // Fetch detail
        fetch(`${this.backendHost}/api/video/${encodeURIComponent(videoCode)}`)
            .then(res => res.json())
            .then(async (data) => {
                let v = (data.success && data.video) ? data.video : {};
                let gs = v.gdriveSource || null;

                // Fallback to direct GDrive source endpoint if not present
                if (!gs || !gs.gdriveFileId) {
                    try {
                        const gres = await fetch(`${this.backendHost}/api/gdrive/${encodeURIComponent(videoCode)}`);
                        const gdata = await gres.json();
                        if (gdata.success && gdata.source) {
                            gs = gdata.source;
                        }
                    } catch (e) {
                        console.debug('Direct gdrive source fetch error:', e);
                    }
                }

                gs = gs || {};
                const driveName = gs.driveName || gs.drive || 'Google Drive';
                const sizeVal = gs.fileSize || v.fileSize || 0;
                const sizeStr = sizeVal ? this.formatBytes(sizeVal) : 'N/A';

                if (elTitle && (v.title || videoCode)) elTitle.innerText = v.title || videoCode;
                if (elAccountName) elAccountName.innerText = driveName;
                if (elPromptAccount) elPromptAccount.innerText = driveName;
                if (elSize) elSize.innerText = sizeStr;
                if (elFileId) elFileId.innerText = gs.gdriveFileId || 'N/A';
                if (elPath) elPath.innerText = gs.folderPath || (gs.filename ? `/${gs.filename}` : 'N/A');
                if (btnDelete) {
                    btnDelete.dataset.drive = gs.drive || '';
                    btnDelete.dataset.account = driveName;
                }
            })
            .catch(err => {
                console.error('Lỗi khi tải thông tin GDrive:', err);
                if (elAccountName) elAccountName.innerText = 'Google Drive';
                if (elPromptAccount) elPromptAccount.innerText = 'Google Drive';
            });
    }

    closeGDriveDrawer() {
        const modal = document.getElementById('gdrive-drawer-modal');
        if (modal) modal.classList.add('hidden');
    }

    async confirmDeleteGDriveVideo(code) {
        const targetCode = (code || '').trim().toUpperCase();
        if (!targetCode) return;

        const btnDelete = document.getElementById('btn-confirm-delete-gdrive');
        const txtDelete = document.getElementById('gdrive-delete-btn-text');
        const accountName = btnDelete ? (btnDelete.dataset.account || 'Google Drive') : 'Google Drive';

        if (btnDelete) btnDelete.disabled = true;
        if (txtDelete) txtDelete.innerText = 'Đang xóa khỏi Drive...';

        try {
            const resp = await fetch(`${this.backendHost}/api/gdrive/${encodeURIComponent(targetCode)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await resp.json();

            if (data.success) {
                this.closeGDriveDrawer();
                if (targetCode === (this.currentVideoName || '').trim().toUpperCase()) {
                    this.hasGDrive = false;
                    this.isInQueue = false;
                    this.updateQueueButtonUI();
                }
                if (window.showToast) {
                    window.showToast(`🗑️ Đã xóa ${targetCode} khỏi tài khoản ${accountName}!`, 'success', 3500);
                }
                // Đồng bộ toàn hệ thống
                window.dispatchEvent(new CustomEvent('missav:gdrive-deleted', {
                    detail: { code: targetCode, account: accountName }
                }));
                window.dispatchEvent(new CustomEvent('missav:queue-updated', {
                    detail: { code: targetCode, inQueue: false, hasGDrive: false }
                }));
                if (window.explorerApp && typeof window.explorerApp.handleGDriveDeleted === 'function') {
                    window.explorerApp.handleGDriveDeleted(targetCode);
                }
            } else {
                if (window.showToast) {
                    window.showToast(data.error || 'Lỗi khi xóa video khỏi Google Drive', 'error');
                }
                if (btnDelete) btnDelete.disabled = false;
                if (txtDelete) txtDelete.innerText = 'Xóa khỏi Google Drive';
            }
        } catch (err) {
            console.error('Lỗi khi gọi API xóa GDrive:', err);
            if (window.showToast) {
                window.showToast('Lỗi kết nối khi xóa file khỏi Google Drive!', 'error');
            }
            if (btnDelete) btnDelete.disabled = false;
            if (txtDelete) txtDelete.innerText = 'Xóa khỏi Google Drive';
        }
    }

    toggleUploadQueue(forceAdd = false) {
        let code = (this.currentVideoName || this.currentVideoPath || '').trim().toUpperCase();
        if (!code && this.streamUrl) {
            const m = this.streamUrl.match(/\/hls\/([^\/]+)\//i);
            if (m) code = m[1].toUpperCase();
        }
        if (!code && window.explorerInstance && window.explorerInstance.currentPlayingFilename) {
            code = window.explorerInstance.currentPlayingFilename.trim().toUpperCase();
        }
        const mCode = code.match(/([A-Z0-9]+-[0-9]+)/i);
        if (mCode) {
            code = mCode[1].toUpperCase();
        }
        if (!code) {
            if (window.showToast) window.showToast('Không xác định được mã video!', 'error');
            return;
        }

        if (this.hasGDrive) {
            this.openGDriveDrawer(code);
            return;
        }

        const isAdding = forceAdd ? true : !this.isInQueue;

        const url = `${this.backendHost}/api/queue`;
        const method = isAdding ? 'POST' : 'DELETE';
        const body = JSON.stringify({ code: code });

        fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: body,
            credentials: 'include'
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                this.isInQueue = isAdding;
                this.updateQueueButtonUI();
                const msg = isAdding
                    ? `Đã thêm ${code} vào hàng đợi tải (:5052/codes ⏳ Chưa Upload GDrive)`
                    : `Đã xóa ${code} khỏi hàng đợi tải`;
                this.flashHUD(isAdding ? `📥 Đã thêm ${code} vào hàng đợi` : `🗑️ Đã xóa ${code}`);
                if (window.showToast) {
                    window.showToast(msg, 'success');
                }
                // Phát event đồng bộ toàn app
                window.dispatchEvent(new CustomEvent('missav:queue-updated', {
                    detail: { code: code, inQueue: isAdding }
                }));
                if (this.onToggleQueue) {
                    this.onToggleQueue(code, isAdding);
                }
            } else {
                if (window.showToast) {
                    window.showToast(data.error || data.message || 'Lỗi xử lý hàng đợi', 'error');
                }
            }
        })
        .catch(err => {
            console.error('Lỗi khi gọi queue API:', err);
            if (window.showToast) {
                window.showToast('Lỗi kết nối khi cập nhật hàng đợi tải!', 'error');
            }
        });
    }

    spawnUploadParticle(x, y) {
        if (!this.heartContainer) return;
        const rect = this.container.getBoundingClientRect();
        const posX = x - rect.left;
        const posY = y - rect.top;

        let code = (this.currentVideoName || this.currentVideoPath || '').trim().toUpperCase();
        if (!code && this.streamUrl) {
            const m = this.streamUrl.match(/\/hls\/([^\/]+)\//i);
            if (m) code = m[1].toUpperCase();
        }

        // Nếu đã có trên Google Drive -> Hiển thị icon GDrive và mở thông tin
        if (this.hasGDrive) {
            const iconEl = document.createElement('div');
            iconEl.className = 'floating-info-icon';
            iconEl.innerHTML = '<span class="material-symbols-outlined">cloud_done</span>';
            iconEl.style.left = `${posX}px`;
            iconEl.style.top = `${posY}px`;
            this.heartContainer.appendChild(iconEl);
            setTimeout(() => iconEl.remove(), 900);
            if (window.showToast) {
                window.showToast(`Phim [${code || 'này'}] đã có sẵn trên Google Drive!`, 'info');
            }
            return;
        }

        // Nếu đã trong hàng đợi tải -> Thông báo rõ
        if (this.isInQueue) {
            const iconEl = document.createElement('div');
            iconEl.className = 'floating-info-icon';
            iconEl.innerHTML = '<span class="material-symbols-outlined">hourglass_top</span>';
            iconEl.style.left = `${posX}px`;
            iconEl.style.top = `${posY}px`;
            this.heartContainer.appendChild(iconEl);
            setTimeout(() => iconEl.remove(), 900);
            if (window.showToast) {
                window.showToast(`Phim [${code || 'này'}] đã nằm trong hàng đợi tải upload!`, 'info');
            }
            return;
        }

        // Chưa có -> Tạo hạt particle mây tải bay lên và thêm vào hàng đợi
        const iconEl = document.createElement('div');
        iconEl.className = 'floating-upload-icon';
        iconEl.innerHTML = '<span class="material-symbols-outlined">cloud_upload</span>';
        iconEl.style.left = `${posX}px`;
        iconEl.style.top = `${posY}px`;

        this.heartContainer.appendChild(iconEl);

        setTimeout(() => {
            iconEl.remove();
        }, 900);

        this.toggleUploadQueue(true);
    }

    spawnRemoveParticle(x, y) {
        if (!this.heartContainer) return;
        const rect = this.container.getBoundingClientRect();
        const posX = x - rect.left;
        const posY = y - rect.top;

        let code = (this.currentVideoName || this.currentVideoPath || '').trim().toUpperCase();
        if (!code && this.streamUrl) {
            const m = this.streamUrl.match(/\/hls\/([^\/]+)\//i);
            if (m) code = m[1].toUpperCase();
        }
        if (!code) return;

        // Trường hợp 1: Video ĐÃ CÓ trên Google Drive -> Mở Drawer xác nhận/quản lý xóa
        if (this.hasGDrive) {
            const iconEl = document.createElement('div');
            iconEl.className = 'floating-info-icon';
            iconEl.innerHTML = '<span class="material-symbols-outlined">cloud_done</span>';
            iconEl.style.left = `${posX}px`;
            iconEl.style.top = `${posY}px`;
            this.heartContainer.appendChild(iconEl);
            setTimeout(() => iconEl.remove(), 900);

            this.flashHUD(`☁️ Đang mở quản lý Google Drive [${code}]...`);
            this.openGDriveDrawer(code);
            return;
        }

        // Trường hợp 2: Video đang nằm trong hàng đợi tải -> Xóa khỏi hàng đợi tải
        if (this.isInQueue) {
            const iconEl = document.createElement('div');
            iconEl.className = 'floating-delete-icon';
            iconEl.innerHTML = '<span class="material-symbols-outlined">delete_forever</span>';
            iconEl.style.left = `${posX}px`;
            iconEl.style.top = `${posY}px`;
            this.heartContainer.appendChild(iconEl);
            setTimeout(() => iconEl.remove(), 900);

            this.toggleUploadQueue(false);
            return;
        }

        // Trường hợp 3: Chưa có GDrive và cũng không trong queue
        const iconEl = document.createElement('div');
        iconEl.className = 'floating-info-icon';
        iconEl.innerHTML = '<span class="material-symbols-outlined">info</span>';
        iconEl.style.left = `${posX}px`;
        iconEl.style.top = `${posY}px`;
        this.heartContainer.appendChild(iconEl);
        setTimeout(() => iconEl.remove(), 900);

        this.flashHUD(`ℹ️ ${code} chưa nằm trong hàng đợi tải`);
    }

    async toggleFullscreen() {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            try {
                if (this.container.requestFullscreen) {
                    await this.container.requestFullscreen();
                } else if (this.container.webkitRequestFullscreen) {
                    await this.container.webkitRequestFullscreen();
                }
                // Giữ nguyên hướng màn hình hiện tại (không ép landscape vì đa số là video dọc)
            } catch (err) {
                console.log('[OnePlayer] Fullscreen request failed:', err);
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
            if (window.screen && window.screen.orientation && window.screen.orientation.unlock) {
                try { window.screen.orientation.unlock(); } catch (e) { }
            }
        }
        this.updateFullscreenUI();
    }

    toggleRotateLandscape() {
        this.isLandscapeRotated = !this.isLandscapeRotated;

        // Thử xoay thiết bị qua Screen Orientation API nếu được hỗ trợ
        if (this.isLandscapeRotated) {
            if (window.screen && window.screen.orientation && window.screen.orientation.lock) {
                window.screen.orientation.lock('landscape').catch(() => {});
            }
        } else {
            if (window.screen && window.screen.orientation && window.screen.orientation.unlock) {
                try { window.screen.orientation.unlock(); } catch (e) {}
            }
        }

        // Toggle CSS class trên container để xoay video 90 độ
        if (this.container) {
            if (this.isLandscapeRotated) {
                this.container.classList.add('video-rotated-90');
            } else {
                this.container.classList.remove('video-rotated-90');
            }
        }

        if (this.btnRotateLandscape) {
            if (this.isLandscapeRotated) {
                this.btnRotateLandscape.classList.add('active');
                this.btnRotateLandscape.title = 'Quay về hướng dọc';
            } else {
                this.btnRotateLandscape.classList.remove('active');
                this.btnRotateLandscape.title = 'Xoay ngang màn hình (TikTok Style)';
            }
        }

        this.applyVideoTransform();
    }

    applyVideoTransform() {
        if (!this.video) return;
        if (this.container && this.container.classList.contains('video-rotated-90')) {
            // Đang ở chế độ xoay 90 độ CSS
            if (this.zoomScale > 1) {
                this.video.style.transform = `translate(-50%, -50%) rotate(90deg) translate(${this.zoomTranslateY}px, ${-this.zoomTranslateX}px) scale(${this.zoomScale})`;
            } else {
                this.video.style.transform = 'translate(-50%, -50%) rotate(90deg)';
            }
        } else {
            // Chế độ bình thường
            if (this.zoomScale > 1) {
                this.video.style.transform = `translate(${this.zoomTranslateX}px, ${this.zoomTranslateY}px) scale(${this.zoomScale})`;
            } else {
                this.video.style.transform = '';
            }
        }
    }

    triggerTapRipple(side = 'right', seconds = 30) {
        const rippleEl = side === 'left' ? this.tapRippleLeft : this.tapRippleRight;
        const textEl = side === 'left' ? this.tapTextLeft : this.tapTextRight;
        if (!rippleEl) return;

        if (textEl) {
            textEl.innerText = `${Math.abs(seconds)}s`;
        }

        rippleEl.classList.remove('active');
        void rippleEl.offsetWidth; // trigger reflow to restart css animation
        rippleEl.classList.add('active');

        clearTimeout(rippleEl._rippleTimer);
        rippleEl._rippleTimer = setTimeout(() => {
            rippleEl.classList.remove('active');
        }, 550);
    }

    resetZoom(smooth = true) {
        this.zoomScale = 1;
        this.zoomTranslateX = 0;
        this.zoomTranslateY = 0;
        if (!this.video) return;
        if (smooth) {
            this.video.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1)';
            this.applyVideoTransform();
            setTimeout(() => {
                if (this.video) this.video.style.transition = '';
            }, 260);
        } else {
            this.video.style.transition = '';
            this.applyVideoTransform();
        }
    }

    showSeekHUD(targetSec) {
        if (!this.hud) return;
        const targetFormatted = this.formatTime(targetSec);
        const durFormatted = (this.video && this.video.duration) ? this.formatTime(this.video.duration) : '00:00';
        this.hud.innerText = `${targetFormatted} / ${durFormatted}`;
        this.hud.style.display = 'block';

        clearTimeout(this.hudTimeout);
        this.hudTimeout = setTimeout(() => {
            if (this.hud) this.hud.style.display = 'none';
        }, 1200);
    }

    /**
     * Fast Seek Engine with Request Cancellation:
     * - Hủy ngay request Range HTTP / Fetch dở dang của lần seek trước bằng AbortController
     * - Gọi hls.stopLoad() để ngắt ngay lập tức phân đoạn fragment cũ đang nạp dở
     * - Gọi hls.startLoad(targetSec) để nạp duy nhất fragment mới tại điểm seek
     * - Triệt tiêu hoàn toàn nghẽn hàng chục request tồn đọng khi tua liên tục
     */
    performFastSeek(targetSec) {
        if (!this.video || !this.video.duration || isNaN(targetSec)) return;
        const clampedTime = Math.max(0, Math.min(this.video.duration, targetSec));

        // 1. Hủy bỏ ngay lập tức Fetch/Range request đang chờ của lần seek trước
        if (this.seekAbortController) {
            try {
                this.seekAbortController.abort();
            } catch (e) {}
        }
        this.seekAbortController = new AbortController();

        // 2. Ngắt ngay request phân đoạn HLS cũ đang tải dở dang và dồn băng thông cho điểm seek mới
        if (this.hlsPlayer) {
            try {
                this.hlsPlayer.stopLoad();
            } catch (e) {}
        }

        // 3. Cập nhật vị trí currentTime của video
        try {
            if (typeof this.video.fastSeek === 'function') {
                this.video.fastSeek(clampedTime);
            } else {
                this.video.currentTime = clampedTime;
            }
        } catch (e) {
            this.video.currentTime = clampedTime;
        }

        // 4. Kích hoạt nạp lại Hls.js tại đúng điểm clampedTime
        if (this.hlsPlayer) {
            try {
                this.hlsPlayer.startLoad(clampedTime);
            } catch (e) {}
        }

        this.showSeekingSpinner();
        this.showSeekHUD(clampedTime);
    }

    /**
     * Debounced Seek Scrubbing Engine:
     * Trong lúc người dùng đang vuốt hoặc kéo seekbar, hoãn gửi request nạp video (chỉ cập nhật UI).
     * Khi người dùng dừng kéo quá 150ms hoặc thả tay, lập tức hủy các request cũ và nạp điểm mới.
     */
    debouncedSeek(targetSec, delay = 250) {
        clearTimeout(this.seekDebounceTimeout);
        this.seekDebounceTimeout = setTimeout(() => {
            this.performFastSeek(targetSec);
        }, delay);
    }

    seekRelative(seconds) {
        if (this.video && this.video.duration) {
            const newTime = Math.max(0, Math.min(this.video.duration, this.video.currentTime + seconds));
            this.performFastSeek(newTime);
        }
    }

    adjustVolume(delta) {
        let newVol = Math.max(0, Math.min(1, this.video.volume + delta));
        this.video.volume = newVol;
        this.video.muted = (newVol === 0);
        const pct = Math.round(newVol * 100);
        const icon = newVol === 0 ? '🔇' : (newVol > 0.5 ? '🔊' : '🔉');
        this.flashHUD(`${icon} ${pct}%`);
    }

    toggleMute() {
        this.video.muted = !this.video.muted;
        const icon = this.video.muted ? '🔇 Muted' : '🔊 Unmuted';
        this.flashHUD(icon);
    }

    flashHUD(message) {
        // Đã tắt toàn bộ thông báo HUD hiển thị trên màn hình
        return;
    }

    formatTime(s) {
        if (isNaN(s) || s < 0) return '00:00';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        if (h > 0) {
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
        }
        return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    }

    updatePlayStateUI() {
        const isPaused = this.video.paused;
        if (this.playBtnCenter) {
            this.playBtnCenter.style.opacity = isPaused ? '1' : '0';
            this.playBtnCenter.style.transform = isPaused ? 'translate(-50%, -50%) scale(1)' : 'translate(-50%, -50%) scale(1.5)';
        }
        if (this.btnPlayToggle) {
            this.btnPlayToggle.innerHTML = `<span class="material-symbols-outlined">${isPaused ? 'play_arrow' : 'pause'}</span>`;
        }
        if (this.musicDisc) {
            if (isPaused) {
                this.musicDisc.classList.remove('spin-animation');
            } else {
                this.musicDisc.classList.add('spin-animation');
            }
        }
    }

    updateFullscreenUI() {
        const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
        if (this.btnFullscreen) {
            this.btnFullscreen.innerHTML = `<span class="material-symbols-outlined">${isFS ? 'fullscreen_exit' : 'fullscreen'}</span>`;
        }
    }

    updateBufferProgress() {
        if (this.video.buffered.length > 0 && this.video.duration && this.seekBuffer) {
            const bufferedEnd = this.video.buffered.end(this.video.buffered.length - 1);
            const pct = (bufferedEnd / this.video.duration) * 100;
            this.seekBuffer.style.width = pct + '%';
        }
    }

    handleSeekbarScrub(e) {
        if (!this.seekbar || !this.video.duration) return;
        const rect = this.seekbar.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const targetSec = pct * this.video.duration;

        if (this.seekFill) this.seekFill.style.width = (pct * 100) + '%';
        if (this.currTimeText) this.currTimeText.innerText = this.formatTime(targetSec);

        // Hiển thị HUDở top center khi tua
        if (this.hud && (this.isDraggingSeekbar || this.isSwiping)) {
            const targetFormatted = this.formatTime(targetSec);
            const durFormatted = (this.video && this.video.duration) ? this.formatTime(this.video.duration) : '00:00';
            this.hud.innerText = `${targetFormatted} / ${durFormatted}`;
            this.hud.style.display = 'block';
        }

        return targetSec;
    }

    bindEvents() {
        // Chống hiện Context Menu (Menu chuột phải / Giữ đè màn hình) trên mọi trình duyệt
        if (this.container) {
            this.container.addEventListener('contextmenu', (e) => e.preventDefault());
        }
        if (this.video) {
            this.video.addEventListener('contextmenu', (e) => e.preventDefault());
        }

        // Press & Hold Gesture (Giữ nửa trái: Tua lùi x2 liên tục | Giữ nửa phải: Tua tới 2x liên tục)
        let holdTimeout = null;
        let holdRewindInterval = null;

        const startHold = (clientX) => {
            const rect = this.container.getBoundingClientRect();
            const clickX = clientX - rect.left;
            const isLeftHalf = clickX < rect.width / 2;

            holdTimeout = setTimeout(() => {
                this.isHoldingTap = true;
                if (isLeftHalf) {
                    this.flashHUD('⏪ Tua lùi x2 (Đang giữ)');
                    this.triggerTapRipple('left', 'x2', 'fast_rewind');
                    holdRewindInterval = setInterval(() => {
                        this.video.currentTime = Math.max(0, this.video.currentTime - 1.5);
                    }, 250);
                } else {
                    this.video.playbackRate = 2;
                    this.flashHUD('⚡ 2x Speed (Đang giữ)');
                    this.triggerTapRipple('right', 'x2', 'fast_forward');
                }
            }, 350);
        };

        const stopHold = () => {
            clearTimeout(holdTimeout);
            if (holdRewindInterval) {
                clearInterval(holdRewindInterval);
                holdRewindInterval = null;
            }
            if (this.isHoldingTap) {
                this.video.playbackRate = this.speeds[this.currentSpeedIndex];
                this.flashHUD(`⚡ ${this.speeds[this.currentSpeedIndex]}x`);
            }
        };

        this.container.addEventListener('pointerdown', (e) => {
            if (this.isCoverPreviewing) return; // Do not start hold timer during cover preview
            if (!this.gestureSettings.pressHoldSpeed) return;
            if (e.target.closest(
                '#right-bottom-icons, .oneplayer-bottom-info, .oneplayer-progress-wrapper, ' +
                '#bottom-app-drawer, .action-btn, button, input, select, textarea, label, a, ' +
                '#explorer-modal, #search-drawer-modal, #source-drawer-modal, #user-drawer-modal, ' +
                '#settings-drawer-modal, #gdrive-drawer-modal, #source-menu-modal, #sources-tools-modal, .modal, .drawer'
            )) return;
            startHold(e.clientX);
        });

        this.container.addEventListener('pointerup', stopHold);
        this.container.addEventListener('pointercancel', stopHold);

        // Tap & Double Tap Handler (Chống conflict giữa 1-tap show/hide controls và 2-tap seek 30s)
        this.container.addEventListener('click', (e) => {
            // Khi đang trong chế độ xem trước Cover: Chạm 1 lần để phát ngay
            if (this.isCoverPreviewing && !this.isSwiping) {
                if (e.target.closest('#btn-dislike, #btn-prev, #btn-next, #btn-menu, .action-btn, .drawer, .modal, .bottom-tag, .title-keyword-highlight, #video-context-chips, .context-chip')) {
                    return;
                }
                e.stopPropagation();
                this.confirmPlayFromPreview();
                return;
            }

            // Nếu người dùng vừa thực hiện cử chỉ vuốt (swipe), rê seekbar hoặc đang giữ long press
            if (this.hasMovedGesture || this.isDraggingSeekbar) {
                this.hasMovedGesture = false;
                return;
            }
            if (this.isHoldingTap) {
                this.isHoldingTap = false;
                return;
            }

            // Hủy qua nếu click vào nút điều khiển, drawer, modal, seekbar...
            if (e.target.closest(
                '#right-bottom-icons, .oneplayer-bottom-info, .oneplayer-progress-wrapper, ' +
                '#bottom-app-drawer, .action-btn, button, input, select, textarea, label, a, ' +
                '#explorer-modal, #search-drawer-modal, #source-drawer-modal, #user-drawer-modal, ' +
                '#settings-drawer-modal, #gdrive-drawer-modal, #source-menu-modal, #sources-tools-modal, .modal, .drawer'
            )) {
                return;
            }

            const currentTime = new Date().getTime();
            const tapLength = currentTime - (this.lastTapTime || 0);

            if (tapLength < 300 && tapLength > 0) {
                // DOUBLE TAP (Chạm 2 lần liên tiếp < 300ms)
                if (this.tapTimeout) {
                    clearTimeout(this.tapTimeout);
                    this.tapTimeout = null;
                }

                // Nếu đang zoom, double tap sẽ reset zoom về lại 1x ngay lập tức
                if (this.zoomScale > 1.05) {
                    this.resetZoom(true);
                    this.lastTapTime = 0;
                    return;
                }

                if (this.gestureSettings.doubleTapSeek) {
                    const rect = this.container.getBoundingClientRect();
                    const containerWidth = rect.width || 1;
                    const clickX = e.clientX - rect.left;
                    const ratio = clickX / containerWidth;

                    const isCDNOnly = !!(window.__IS_GDRIVE_ONLY__ === false && document.body.classList.contains('mode-cdn-only'));
                    const seekDelta = (this.doubleTapSeekSeconds || 30);

                    if (ratio < 0.30) {
                        // 1. Double tap 30% CẠNH TRÁI: Tua lùi 30s + Hiện hiệu ứng Ripple Tua
                        this.seekRelative(-seekDelta);
                        this.triggerTapRipple('left', seekDelta);
                    } else if (ratio > 0.70) {
                        // 2. Double tap 30% CẠNH PHẢI: Tua tới 30s + Hiện hiệu ứng Ripple Tua
                        this.seekRelative(seekDelta);
                        this.triggerTapRipple('right', seekDelta);
                    } else {
                        // 3. Double tap 40% Ở GIỮA (Center Zone): Thêm vào hàng đợi Upload Queue
                        if (!isCDNOnly) {
                            this.spawnUploadParticle(e.clientX, e.clientY);
                        } else {
                            // Chế độ mode-cdn-only thuần
                            this.seekRelative(seekDelta);
                            this.triggerTapRipple('right', seekDelta);
                        }
                    }
                }
                // RESET lastTapTime về 0 để tap lần tiếp theo không bị tính nhầm thành double-tap
                this.lastTapTime = 0;
            } else {
                // SINGLE TAP (1 chạm) -> Đặt timeout 300ms, nếu không có tap 2 tới thì mới toggle controls
                this.lastTapTime = currentTime;
                if (this.tapTimeout) {
                    clearTimeout(this.tapTimeout);
                }
                this.tapTimeout = setTimeout(() => {
                    this.tapTimeout = null;
                    if (this.gestureSettings.singleTapToggle) {
                        this.toggleControls();
                    }
                }, 300);
            }
        });

        // Lắng nghe Keyboard Shortcuts
        window.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
            switch (e.code) {
                case 'Space':
                case 'KeyK':
                    e.preventDefault();
                    this.togglePlay();
                    break;
                case 'ArrowLeft':
                case 'KeyJ':
                    e.preventDefault();
                    this.seekRelative(-(this.doubleTapSeekSeconds || 30));
                    break;
                case 'ArrowRight':
                case 'KeyL':
                    e.preventDefault();
                    this.seekRelative(this.doubleTapSeekSeconds || 30);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.adjustVolume(0.1);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.adjustVolume(-0.1);
                    break;
                case 'KeyF':
                    e.preventDefault();
                    this.toggleFullscreen();
                    break;
                case 'KeyM':
                    e.preventDefault();
                    this.toggleMute();
                    break;
            }
        });

        // Fullscreen Change Event
        document.addEventListener('fullscreenchange', () => {
            this.hideSeekingSpinner();
            if (!document.fullscreenElement && window.screen && window.screen.orientation && window.screen.orientation.unlock) {
                try { window.screen.orientation.unlock(); } catch (e) { }
            }
            this.updateFullscreenUI();
        });

        // Action Buttons
        if (this.btnPlayToggle) this.btnPlayToggle.onclick = () => this.togglePlay();
        if (this.btnQuality) {
            this.btnQuality.onclick = (e) => {
                e.stopPropagation();
                this.openQualityMenu();
            };
        }
        if (this.btnCloseQualityMenu) {
            this.btnCloseQualityMenu.onclick = (e) => {
                e.stopPropagation();
                this.closeQualityMenu();
            };
        }
        if (this.qualityMenuModal) {
            this.qualityMenuModal.onclick = (e) => {
                if (e.target === this.qualityMenuModal) {
                    this.closeQualityMenu();
                }
            };
        }
        if (this.btnSpeed) {
            this.btnSpeed.onclick = (e) => {
                e.stopPropagation();
                this.toggleSpeed();
            };
        }
        if (this.btnLike) this.btnLike.onclick = () => this.toggleUploadQueue();
        if (this.btnDislike) {
            this.btnDislike.onclick = (e) => {
                e.stopPropagation();
                this.handleDislike();
            };
        }
        const triggerPlayPreview = (e) => {
            if (this.isCoverPreviewing && !this.isSwiping) {
                if (e) e.stopPropagation();
                this.confirmPlayFromPreview();
            }
        };

        if (this.loadingOverlay) {
            this.loadingOverlay.onclick = triggerPlayPreview;
        }
        if (this.countdownWrapper) {
            this.countdownWrapper.onclick = triggerPlayPreview;
        }
        if (this.btnPrev) {
            this.btnPrev.onclick = () => {
                if (this.onPrev) {
                    this.onPrev();
                } else {
                    this.seekRelative(-10);
                }
            };
        }
        if (this.btnNext) {
            this.btnNext.onclick = () => {
                if (this.onNext) {
                    this.onNext();
                } else {
                    this.seekRelative(10);
                }
            };
        }
        if (this.btnFullscreen) this.btnFullscreen.onclick = () => this.toggleFullscreen();

        // Report dead stream / broken video error
        if (this.btnReportError) {
            this.btnReportError.addEventListener('click', (e) => {
                e.stopPropagation();
                const code = this.currentVideoName || this.currentVideoPath;
                if (!code) {
                    if (window.showToast) window.showToast('Không xác định được mã video', 'warning');
                    return;
                }
                if (confirm(`Bạn muốn báo lỗi link video [${code}] để crawler cào lại link mới?`)) {
                    this.markCurrentVideoError('Người dùng báo cáo link video bị lỗi', 404);
                    this.showUpdatingMessage('Đã báo lỗi link video, đang chờ crawler cào lại link mới!');
                }
            });
        }


        // Rotate Landscape Button (TikTok style)
        if (this.btnRotateLandscape) {
            this.btnRotateLandscape.onclick = (e) => {
                e.stopPropagation();
                this.toggleRotateLandscape();
            };
        }

        // Gesture Guide Modal Listeners (Show / Hide)
        if (this.btnGestureGuide) {
            this.btnGestureGuide.onclick = (e) => {
                e.stopPropagation();
                if (this.gestureGuideModal) {
                    const willOpen = this.gestureGuideModal.classList.contains('hidden');
                    if (willOpen && window.explorerApp && typeof window.explorerApp.closeAllDrawers === 'function') {
                        window.explorerApp.closeAllDrawers('gesture');
                    }
                    this.gestureGuideModal.classList.toggle('hidden');
                }
            };
        }
        if (this.btnCloseGestureGuide) {
            this.btnCloseGestureGuide.onclick = () => {
                if (this.gestureGuideModal) {
                    this.gestureGuideModal.classList.add('hidden');
                }
            };
        }
        if (this.gestureGuideModal) {
            this.gestureGuideModal.onclick = (e) => {
                if (e.target === this.gestureGuideModal) {
                    this.gestureGuideModal.classList.add('hidden');
                }
            };
        }

        // Video State Listeners
        this.video.addEventListener('loadedmetadata', () => {
            const w = this.video.videoWidth || 0;
            const h = this.video.videoHeight || 0;
            this.isVideoLandscape = (w > 0 && h > 0 && w > h);

            // Hiện nút xoay ngang TikTok nếu là video ngang, ngược lại ẩn
            if (this.btnRotateLandscape) {
                if (this.isVideoLandscape) {
                    this.btnRotateLandscape.classList.remove('hidden');
                } else {
                    this.btnRotateLandscape.classList.add('hidden');
                }
            }

            // Reset zoom & transform khi chuyển video mới
            this.resetZoom(false);
            if (this.isLandscapeRotated) {
                this.toggleRotateLandscape();
            }
        });

        this.video.onplay = () => {
            this.video.playbackRate = this.speeds[this.currentSpeedIndex];
            this.updatePlayStateUI();
            this.recordViewHistory();
        };
        this.video.onpause = () => {
            this.updatePlayStateUI();
            this.cancelNextStreamPreload();
        };
        this.video.onprogress = () => this.updateBufferProgress();
        this.video.addEventListener('canplay', () => {
            this.hideLoading();
            this.hideSeekingSpinner();
        });
        this.video.addEventListener('playing', () => {
            this.hideLoading();
            this.hideSeekingSpinner();
            this.recordViewHistory();
            this.scheduleNextStreamPreload();
        });
        this.video.addEventListener('seeking', () => this.showSeekingSpinner());
        this.video.addEventListener('waiting', () => this.showSeekingSpinner());
        this.video.addEventListener('stalled', () => this.showSeekingSpinner());
        this.video.addEventListener('seeked', () => this.hideSeekingSpinner());
        this.video.addEventListener('error', (e) => {
            // Bỏ qua lỗi giả lập khi video bị removeAttribute('src'), src rỗng, hoặc Hls.js đang dùng MediaSource blob:
            const currentSrc = this.video.currentSrc || this.video.getAttribute('src') || '';
            if (!currentSrc || currentSrc === window.location.href || currentSrc.startsWith('blob:') || this.hlsPlayer) {
                return;
            }
            const err = this.video.error;
            const errCode = err ? err.code : 'UNKNOWN';
            const errMsg = err ? err.message : '';
            console.warn('[OnePlayer] Video element error event:', { code: errCode, message: errMsg, src: currentSrc });
            this.markCurrentVideoError(`HTML5 Video element error (Code ${errCode})`, 500);
            this.showUpdatingMessage('Video gặp lỗi phát, đã đánh dấu để crawler cào lại link mới');
            this.hideSeekingSpinner();
        });

        // Time updates & 30s interval watch time tracking
        this.video.ontimeupdate = () => {
            if (!this.isSwiping && !this.isDraggingSeekbar && this.video.duration) {
                const pct = (this.video.currentTime / this.video.duration) * 100;
                if (this.seekFill) this.seekFill.style.width = pct + '%';
                if (this.currTimeText) this.currTimeText.innerText = this.formatTime(this.video.currentTime);
            }
            if (this.video.duration && this.durTimeText) {
                this.durTimeText.innerText = this.formatTime(this.video.duration);
            }
            this.updateBufferProgress();

            if (!this.video.paused && this.video.currentTime > 0) {
                this.currentVideoPlaybackSeconds = this.video.currentTime;
                if (this.currentVideoPlaybackSeconds - this.lastWatchTimeReportSec >= 30) {
                    this.lastWatchTimeReportSec = this.currentVideoPlaybackSeconds;
                    const curCode = this.currentVideoName || this.currentVideoPath;
                    if (curCode) {
                        this.sendInteraction('watch_time', { code: curCode, watch_time_sec: 30 });
                    }
                }
            }
        };

        // Touch & Mouse Swipe Gestures:
        const handleSwipeStart = (clientX, clientY, target) => {
            const isAnyDrawerOrMenuOpen = !!document.querySelector(
                '#explorer-modal:not(.hidden), #search-drawer-modal:not(.hidden), ' +
                '#source-drawer-modal:not(.hidden), #user-drawer-modal:not(.hidden), ' +
                '#settings-drawer-modal:not(.hidden), #gdrive-drawer-modal:not(.hidden), ' +
                '#source-menu-modal:not(.hidden), #sources-tools-modal:not(.hidden), ' +
                '.explorer-overlay:not(.hidden), .search-drawer-overlay:not(.hidden), ' +
                '.source-menu-overlay:not(.hidden), .modal:not(.hidden), .drawer:not(.hidden)'
            );

            const isInsideDrawerOrMenu = !!(target && target.closest && target.closest(
                '#seekbar, .action-btn, button, input, select, textarea, label, a, ' +
                '#explorer-modal, #search-drawer-modal, #source-drawer-modal, #user-drawer-modal, ' +
                '#settings-drawer-modal, #gdrive-drawer-modal, #source-menu-modal, #sources-tools-modal, #bottom-app-drawer, ' +
                '.explorer-overlay, .search-drawer-overlay, .source-menu-overlay, ' +
                '.explorer-drawer, .search-drawer, .source-menu-drawer, .bottom-app-drawer, .gdrive-drawer, ' +
                '.modal, .drawer, .menu, .source-menu-container'
            ));

            if (!isAnyDrawerOrMenuOpen && !isInsideDrawerOrMenu) {
                this.isSwiping = true;
                this.hasMovedGesture = false;
                this.swipeDirection = null;
                this.startX = clientX;
                this.startY = clientY;
                this.startTime = this.video ? (this.video.currentTime || 0) : 0;
                this.targetTime = this.startTime;

                const rect = this.container.getBoundingClientRect();
                const relativeY = this.startY - rect.top;
                this.isUpperSwipe = (relativeY < rect.height / 2);
                return true;
            }
            return false;
        };

        const handleSwipeMove = (clientX, clientY) => {
            if (!this.isSwiping) return;
            const deltaX = clientX - this.startX;
            const deltaY = clientY - this.startY;
            const absX = Math.abs(deltaX);
            const absY = Math.abs(deltaY);

            if (absX > 18 || absY > 18) {
                this.hasMovedGesture = true;
                stopHold();
            }

            if (!this.swipeDirection && (absX > 15 || absY > 15)) {
                if (absX > absY * 1.2) {
                    this.swipeDirection = 'horizontal';
                } else {
                    this.swipeDirection = 'vertical';
                }
            }

            if (this.isUpperSwipe) {
                if (this.hud) this.hud.style.display = 'none';
            } else {
                if (this.gestureSettings.lowerSwipeSeek && this.swipeDirection === 'horizontal' && this.video && this.video.duration) {
                    const rect = this.container.getBoundingClientRect();
                    const containerWidth = rect.width || 300;
                    const deltaRatio = deltaX / containerWidth;
                    const duration = this.video.duration;
                    
                    let newTargetTime = this.startTime + (deltaRatio * duration * 1.5);
                    this.targetTime = Math.max(0, Math.min(duration, newTargetTime));

                    if (this.seekFill) {
                        this.seekFill.style.width = ((this.targetTime / duration) * 100) + '%';
                    }
                    if (this.currTimeText) {
                        this.currTimeText.innerText = this.formatTime(this.targetTime);
                    }
                    if (this.hud) {
                        const targetFormatted = this.formatTime(this.targetTime);
                        const durFormatted = this.formatTime(duration);
                        this.hud.innerText = `⏩ ${targetFormatted} / ${durFormatted}`;
                        this.hud.style.display = 'block';
                    }
                    this.debouncedSeek(this.targetTime);
                } else if (this.gestureSettings.lowerSwipeNextPrev && this.swipeDirection === 'vertical') {
                    // Continuous TikTok/Shorts Feed Cuộn Drag (Trượt theo ngón tay 1:1 - Chỉ trượt Video và Cover)
                    this.isFeedDragging = true;
                    const targetLayer = this.stageLayer || this.container;
                    if (targetLayer) {
                        targetLayer.classList.add('is-feed-dragging');
                        targetLayer.style.transition = 'none';
                        targetLayer.style.transform = `translateY(${deltaY}px)`;
                        const maxH = window.innerHeight || 800;
                        const opacityRatio = Math.max(0.65, 1 - (Math.abs(deltaY) / (maxH * 1.2)));
                        targetLayer.style.opacity = opacityRatio;
                    }
                    if (deltaY < 0) {
                        this.updateFeedPreview('next');
                    } else if (deltaY > 0) {
                        this.updateFeedPreview('prev');
                    }
                    if (this.hud) this.hud.style.display = 'none';
                } else if (this.hud) {
                    this.hud.style.display = 'none';
                }
            }
        };

        const handleSwipeEnd = (clientX, clientY) => {
            if (!this.isSwiping && !this.isFeedDragging) return;
            const endX = clientX !== undefined ? clientX : this.startX;
            const endY = clientY !== undefined ? clientY : this.startY;
            const deltaX = endX - this.startX;
            const deltaY = endY - this.startY;
            const absX = Math.abs(deltaX);
            const absY = Math.abs(deltaY);

            this.isSwiping = false;
            clearTimeout(this.seekDebounceTimeout);
            if (this.hud) this.hud.style.display = 'none';

            if (this.isFeedDragging) {
                this.isFeedDragging = false;
                const threshold = Math.min(75, (window.innerHeight || 600) * 0.12);
                const targetLayer = this.stageLayer || this.container;
                if (targetLayer) {
                    targetLayer.classList.remove('is-feed-dragging');
                }

                if (absY > threshold && this.gestureSettings.lowerSwipeNextPrev) {
                    if (this.isSwitchingVideoFeed) return;
                    this.isSwitchingVideoFeed = true;
                    this.triggerHaptic(25);
                    setTimeout(() => { this.isSwitchingVideoFeed = false; }, 400);

                    const isNext = deltaY < 0;
                    const targetY = isNext ? '-100%' : '100%';
                    if (targetLayer) {
                        targetLayer.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1), opacity 0.22s ease';
                        targetLayer.style.transform = `translateY(${targetY})`;
                        targetLayer.style.opacity = '0';
                    }
                    setTimeout(() => {
                        if (targetLayer) {
                            targetLayer.style.transition = 'none';
                            targetLayer.style.transform = 'translateY(0)';
                            targetLayer.style.opacity = '1';
                        }
                        this.hideFeedPreview();
                        if (isNext) {
                            if (this.onNext) this.onNext();
                        } else {
                            if (this.onPrev) this.onPrev();
                        }
                    }, 220);
                } else {
                    // Bounce back animation về vị trí ban đầu
                    if (targetLayer) {
                        targetLayer.style.transition = 'transform 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.28s ease';
                        targetLayer.style.transform = 'translateY(0)';
                        targetLayer.style.opacity = '1';
                        setTimeout(() => {
                            if (targetLayer) {
                                targetLayer.style.transition = 'none';
                            }
                            this.hideFeedPreview();
                        }, 280);
                    }
                }
                this.swipeDirection = null;
                setTimeout(() => {
                    this.hasMovedGesture = false;
                }, 80);
                return;
            }

            if (this.isUpperSwipe) {
                // 1/2 MÀN HÌNH TRÊN
                if (this.swipeDirection === 'horizontal' && absX > 35) {
                    if (deltaX < 0) {
                        // Vuốt từ PHẢI qua TRÁI -> Mở Explorer
                        if (this.gestureSettings.upperSwipeExplorer) {
                            if (this.onSwipeRightToLeft) {
                                this.onSwipeRightToLeft();
                            } else if (this.onSwipeUpperExplorer) {
                                this.onSwipeUpperExplorer();
                            }
                        }
                    }
                    // Bỏ vuốt từ Trái qua Phải (deltaX > 0)
                } else if (this.swipeDirection === 'vertical' && absY > 25) {
                    // Vuốt Lên/Xuống -> Toàn màn hình
                    if (this.gestureSettings.upperSwipeFullscreen) {
                        const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
                        if (deltaY < 0 && !isFS) {
                            this.toggleFullscreen();
                        } else if (deltaY > 0 && isFS) {
                            this.toggleFullscreen();
                        }
                    }
                }
            } else {
                // 1/2 MÀN HÌNH DƯỚI
                if (this.swipeDirection === 'horizontal' && absX > 15) {
                    // Tua video (chỉ khi lowerSwipeSeek được bật)
                    if (this.gestureSettings.lowerSwipeSeek && this.video && !isNaN(this.targetTime) && isFinite(this.targetTime)) {
                        clearTimeout(this.seekDebounceTimeout);
                        this.performFastSeek(this.targetTime);
                    }
                }
            }

            this.swipeDirection = null;
            setTimeout(() => {
                this.hasMovedGesture = false;
            }, 80);
        };

        // Pinch-to-zoom (2 ngón tay) Helpers
        const getTouchDistance = (t1, t2) => {
            const dx = t1.clientX - t2.clientX;
            const dy = t1.clientY - t2.clientY;
            return Math.hypot(dx, dy);
        };

        const getTouchMidpoint = (t1, t2) => {
            return {
                x: (t1.clientX + t2.clientX) / 2,
                y: (t1.clientY + t2.clientY) / 2
            };
        };

        // Touch Listeners
        this.container.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                // Kích hoạt cử chỉ 2 ngón tay Pinch-to-Zoom
                this.isPinching = true;
                this.isSwiping = false;
                this.isFeedDragging = false;
                stopHold();

                if (this.hud) this.hud.style.display = 'none';
                this.hideFeedPreview();

                this.pinchStartDistance = getTouchDistance(e.touches[0], e.touches[1]);
                this.pinchStartScale = this.zoomScale;
                const mid = getTouchMidpoint(e.touches[0], e.touches[1]);
                this.pinchStartMidX = mid.x;
                this.pinchStartMidY = mid.y;
                this.pinchStartTranslateX = this.zoomTranslateX;
                this.pinchStartTranslateY = this.zoomTranslateY;
                if (this.video) this.video.style.transition = 'none';
                return;
            }

            if (e.touches.length === 1) {
                if (this.zoomScale > 1.05) {
                    // Khi đang zoom phóng to, 1 ngón tay dùng để pan (kéo di chuyển khung hình video)
                    this.isPanningZoom = true;
                    this.panStartX = e.touches[0].clientX;
                    this.panStartY = e.touches[0].clientY;
                    this.panInitialTranslateX = this.zoomTranslateX;
                    this.panInitialTranslateY = this.zoomTranslateY;
                    stopHold();
                    return;
                }
                handleSwipeStart(e.touches[0].clientX, e.touches[0].clientY, e.target);
            }
        }, { passive: false });

        this.container.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2 && this.isPinching) {
                if (e.cancelable) e.preventDefault();
                const currentDist = getTouchDistance(e.touches[0], e.touches[1]);
                if (this.pinchStartDistance > 0) {
                    const scaleFactor = currentDist / this.pinchStartDistance;
                    let targetScale = this.pinchStartScale * scaleFactor;
                    // Giới hạn zoom từ 1x đến 3.5x
                    this.zoomScale = Math.max(1, Math.min(3.5, targetScale));

                    const mid = getTouchMidpoint(e.touches[0], e.touches[1]);
                    const deltaMidX = mid.x - this.pinchStartMidX;
                    const deltaMidY = mid.y - this.pinchStartMidY;

                    const maxTranslate = (this.zoomScale - 1) * (window.innerWidth || 400) * 0.5;
                    this.zoomTranslateX = Math.max(-maxTranslate, Math.min(maxTranslate, this.pinchStartTranslateX + deltaMidX));
                    this.zoomTranslateY = Math.max(-maxTranslate, Math.min(maxTranslate, this.pinchStartTranslateY + deltaMidY));

                    this.applyVideoTransform();
                }
                return;
            }

            if (e.touches.length === 1 && this.isPanningZoom && this.zoomScale > 1.05) {
                if (e.cancelable) e.preventDefault();
                const deltaX = e.touches[0].clientX - this.panStartX;
                const deltaY = e.touches[0].clientY - this.panStartY;
                const maxTranslate = (this.zoomScale - 1) * (window.innerWidth || 400) * 0.5;
                this.zoomTranslateX = Math.max(-maxTranslate, Math.min(maxTranslate, this.panInitialTranslateX + deltaX));
                this.zoomTranslateY = Math.max(-maxTranslate, Math.min(maxTranslate, this.panInitialTranslateY + deltaY));
                this.applyVideoTransform();
                return;
            }

            if (e.touches.length === 1 && !this.isPinching && !this.isPanningZoom) {
                handleSwipeMove(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: false });

        this.container.addEventListener('touchend', (e) => {
            if (this.isPinching) {
                if (e.touches.length < 2) {
                    this.isPinching = false;
                    // Nếu thu nhỏ về gần 1x (<= 1.08x), tự động snap mượt về 1x
                    if (this.zoomScale <= 1.08) {
                        this.resetZoom(true);
                    }
                }
                return;
            }

            if (this.isPanningZoom) {
                if (e.touches.length === 0) {
                    this.isPanningZoom = false;
                }
                return;
            }

            const endX = e.changedTouches && e.changedTouches.length > 0 ? e.changedTouches[0].clientX : undefined;
            const endY = e.changedTouches && e.changedTouches.length > 0 ? e.changedTouches[0].clientY : undefined;
            handleSwipeEnd(endX, endY);
        });

        // Mouse Drag Listeners (Unified desktop support)
        let isMouseDownSwipe = false;
        this.container.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                if (handleSwipeStart(e.clientX, e.clientY, e.target)) {
                    isMouseDownSwipe = true;
                }
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (isMouseDownSwipe) {
                handleSwipeMove(e.clientX, e.clientY);
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (isMouseDownSwipe) {
                isMouseDownSwipe = false;
                handleSwipeEnd(e.clientX, e.clientY);
            }
        });

        // Helper for automated testing
        this.triggerUpperSwipeExplorer = () => {
            if (this.gestureSettings.upperSwipeExplorer) {
                if (this.onSwipeUpperExplorer) this.onSwipeUpperExplorer();
                else if (this.onSwipeRightToLeft) this.onSwipeRightToLeft();
                else if (this.onSwipeLeftToRight) this.onSwipeLeftToRight();
            }
        };

        this.triggerLowerSwipeSeek = (secondsDelta) => {
            if (this.video && this.video.duration) {
                const newT = Math.max(0, Math.min(this.video.duration, (this.video.currentTime || 0) + secondsDelta));
                this.video.currentTime = newT;
                if (this.currTimeText) this.currTimeText.innerText = this.formatTime(newT);
            }
        };

        // Seekbar Click & Mouse/Touch Scrubbing (With Preview Bubble & Haptic)
        if (this.seekbar) {
            const updateBubble = (clientX) => {
                if (!this.seekPreviewBubble || !this.video.duration) return;
                const rect = this.seekbar.getBoundingClientRect();
                const clampedX = Math.max(0, Math.min(rect.width, clientX - rect.left));
                const pct = clampedX / rect.width;
                const targetSec = pct * this.video.duration;
                if (this.seekPreviewTime) {
                    this.seekPreviewTime.innerText = this.formatTime(targetSec);
                }
                this.seekPreviewBubble.style.left = `${clampedX}px`;
                this.seekPreviewBubble.classList.remove('hidden');
            };

            const hideBubble = () => {
                if (this.seekPreviewBubble) {
                    this.seekPreviewBubble.classList.add('hidden');
                }
            };

            let scrubTargetSec = 0;

            const startScrub = (e) => {
                this.isDraggingSeekbar = true;
                this.hasMovedGesture = true;
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                updateBubble(clientX);
                this.triggerHaptic(10);
                const targetSec = this.handleSeekbarScrub(e);
                if (targetSec !== undefined && this.video.duration) {
                    scrubTargetSec = targetSec;
                    this.debouncedSeek(targetSec, 200);
                }
            };

            const moveScrub = (e) => {
                if (this.isDraggingSeekbar) {
                    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                    updateBubble(clientX);
                    const targetSec = this.handleSeekbarScrub(e);
                    if (targetSec !== undefined && this.video.duration) {
                        scrubTargetSec = targetSec;
                        this.debouncedSeek(targetSec, 200);
                    }
                }
            };

            const stopScrub = () => {
                if (this.isDraggingSeekbar) {
                    this.isDraggingSeekbar = false;
                    hideBubble();
                    this.triggerHaptic(15);
                    clearTimeout(this.seekDebounceTimeout);
                    if (this.hud) this.hud.style.display = 'none';
                    if (this.video && this.video.duration && !isNaN(scrubTargetSec)) {
                        this.performFastSeek(scrubTargetSec);
                    }
                    if (this.video.paused) this.video.play().catch(() => { });
                }
            };

            this.seekbar.addEventListener('mousedown', startScrub);
            window.addEventListener('mousemove', moveScrub);
            window.addEventListener('mouseup', stopScrub);

            this.seekbar.addEventListener('touchstart', startScrub, { passive: true });
            window.addEventListener('touchmove', moveScrub, { passive: true });
            window.addEventListener('touchend', stopScrub);

            // Hover preview on desktop
            this.seekbar.addEventListener('mousemove', (e) => {
                if (!this.isDraggingSeekbar) {
                    updateBubble(e.clientX);
                }
            });
            this.seekbar.addEventListener('mouseleave', () => {
                if (!this.isDraggingSeekbar) {
                    hideBubble();
                }
            });
        }
    }

    bindSettingsEvents() {
        if (this.btnSettings) {
            this.btnSettings.onclick = (e) => {
                e.stopPropagation();
                if (this.settingsModal) {
                    const willOpen = this.settingsModal.classList.contains('hidden');
                    if (willOpen && window.explorerApp && typeof window.explorerApp.closeAllDrawers === 'function') {
                        window.explorerApp.closeAllDrawers('settings');
                    }
                    this.settingsModal.classList.toggle('hidden');
                }
            };
        }

        if (this.btnCloseSettings) {
            this.btnCloseSettings.onclick = () => {
                if (this.settingsModal) {
                    this.settingsModal.classList.add('hidden');
                }
            };
        }

        if (this.settingsModal) {
            this.settingsModal.onclick = (e) => {
                if (e.target === this.settingsModal) {
                    this.settingsModal.classList.add('hidden');
                }
            };
        }

        const blackToggle = document.getElementById('setting-toggle-blackmode');
        if (blackToggle) {
            blackToggle.checked = (this.themeMode === 'black');
            blackToggle.onchange = (e) => {
                this.applyTheme(e.target.checked ? 'black' : 'normal');
                if (window.showToast) {
                    window.showToast(e.target.checked ? 'Đã bật Chế độ Nền Đen Tuyền (Black Mode)' : 'Đã về Chế độ Thường (Normal Mode)', 'info');
                }
            };
        }

        const fitToggle = document.getElementById('setting-toggle-fitmode');
        if (fitToggle) {
            fitToggle.checked = (this.fitMode === 'cover');
            fitToggle.onchange = (e) => {
                this.applyFitMode(e.target.checked ? 'cover' : 'contain');
                if (window.showToast) {
                    window.showToast(e.target.checked ? 'Đã bật Phóng to Full màn hình (Fill Screen)' : 'Đã chuyển về Tỉ lệ gốc (Fit Screen)', 'info');
                }
            };
        }

        const toggleMap = {
            'setting-toggle-singletap': 'singleTapToggle',
            'setting-toggle-doubletap': 'doubleTapSeek',
            'setting-toggle-presshold': 'pressHoldSpeed',
            'setting-toggle-upperswipe-explorer': 'upperSwipeExplorer',
            'setting-toggle-upperswipe-fullscreen': 'upperSwipeFullscreen',
            'setting-toggle-lowerswipe-seek': 'lowerSwipeSeek',
            'setting-toggle-lowerswipe-nextprev': 'lowerSwipeNextPrev'
        };

        Object.keys(toggleMap).forEach(elemId => {
            const key = toggleMap[elemId];
            const el = document.getElementById(elemId);
            if (el) {
                el.checked = !!this.gestureSettings[key];
                el.onchange = (e) => {
                    this.updateGestureSetting(key, e.target.checked);
                    if (window.showToast) {
                        window.showToast(e.target.checked ? 'Đã bật cử chỉ' : 'Đã tắt cử chỉ', 'info', 1800);
                    }
                };
            }
        });

        const doubleTapSecSelect = document.getElementById('setting-select-doubletap-seconds');
        const doubleTapDesc = document.getElementById('setting-desc-doubletap');
        if (doubleTapDesc) {
            doubleTapDesc.innerText = `Tua video ±${this.doubleTapSeekSeconds} giây (Trái: -${this.doubleTapSeekSeconds}s, Phải: +${this.doubleTapSeekSeconds}s)`;
        }
        if (doubleTapSecSelect) {
            doubleTapSecSelect.value = String(this.doubleTapSeekSeconds);
            doubleTapSecSelect.onchange = (e) => {
                const val = parseInt(e.target.value, 10) || 30;
                this.doubleTapSeekSeconds = val;
                try {
                    localStorage.setItem('vod_doubletap_seconds', String(val));
                } catch (err) {}
                if (doubleTapDesc) {
                    doubleTapDesc.innerText = `Tua video ±${val} giây (Trái: -${val}s, Phải: +${val}s)`;
                }
                if (window.showToast) {
                    window.showToast(`Thời gian tua chạm đúp: ${val} giây`, 'info', 1800);
                }
            };
        }

        if (this.btnStreamSource) {
            this.btnStreamSource.onclick = (e) => {
                e.stopPropagation();
                this.openStreamSourceDrawer();
            };
        }

        this.bindStreamSourceDrawerEvents();
        this.bindGDriveEvents();
    }

    bindStreamSourceDrawerEvents() {
        if (this.btnCloseStreamSourceDrawer) {
            this.btnCloseStreamSourceDrawer.onclick = (e) => {
                e.stopPropagation();
                this.closeStreamSourceDrawer();
            };
        }
        if (this.streamSourceDrawerModal) {
            this.streamSourceDrawerModal.onclick = (e) => {
                if (e.target === this.streamSourceDrawerModal) {
                    this.closeStreamSourceDrawer();
                }
            };
        }
    }

    bindGDriveEvents() {
        if (this.btnCloseGDriveDrawer) {
            this.btnCloseGDriveDrawer.onclick = (e) => {
                e.stopPropagation();
                this.closeGDriveDrawer();
            };
        }
        if (this.btnCancelGDriveDrawer) {
            this.btnCancelGDriveDrawer.onclick = (e) => {
                e.stopPropagation();
                this.closeGDriveDrawer();
            };
        }
        if (this.gdriveDrawerModal) {
            this.gdriveDrawerModal.onclick = (e) => {
                if (e.target === this.gdriveDrawerModal) {
                    this.closeGDriveDrawer();
                }
            };
        }
        if (this.btnConfirmDeleteGDrive) {
            this.btnConfirmDeleteGDrive.onclick = (e) => {
                e.stopPropagation();
                const code = this.btnConfirmDeleteGDrive.dataset.code || this.currentVideoName || this.currentVideoPath;
                this.confirmDeleteGDriveVideo(code);
            };
        }
    }

    destroy() {
        clearTimeout(this.hudTimeout);
        clearTimeout(this.tapTimeout);
        clearTimeout(this.seekDebounceTimeout);
        if (this.seekAbortController) {
            try { this.seekAbortController.abort(); } catch (e) {}
            this.seekAbortController = null;
        }
        this.cancelNextStreamPreload();
        if (this.hlsPlayer) {
            this.hlsPlayer.destroy();
        }
    }
}
