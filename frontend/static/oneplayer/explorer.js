window.showToast = function(message, type = 'info', duration = 3500) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;

    let iconName = 'info';
    if (type === 'success') iconName = 'check_circle';
    else if (type === 'warning') iconName = 'warning';
    else if (type === 'error') iconName = 'error';

    toast.innerHTML = `
        <span class="material-symbols-outlined toast-icon">${iconName}</span>
        <div class="toast-message">${message}</div>
        <button class="toast-close-btn" title="Đóng">
            <span class="material-symbols-outlined" style="font-size: 16px;">close</span>
        </button>
    `;

    const closeBtn = toast.querySelector('.toast-close-btn');
    const removeToast = () => {
        toast.classList.remove('toast-show');
        toast.classList.add('toast-hide');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    };

    closeBtn.addEventListener('click', removeToast);
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('toast-show');
    });

    if (duration > 0) {
        setTimeout(removeToast, duration);
    }
};

window.showConfirm = function(message, onConfirm, title = 'Xác nhận hành động') {
    let modal = document.getElementById('confirm-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'confirm-modal';
        modal.className = 'confirm-modal-overlay hidden';
        modal.innerHTML = `
            <div class="confirm-modal-box">
                <div class="confirm-modal-header">
                    <span class="material-symbols-outlined confirm-icon">help_outline</span>
                    <span id="confirm-modal-title" class="confirm-modal-title">Xác nhận</span>
                </div>
                <div id="confirm-modal-message" class="confirm-modal-message"></div>
                <div class="confirm-modal-actions">
                    <button id="btn-confirm-cancel" class="btn-confirm-cancel">Hủy</button>
                    <button id="btn-confirm-ok" class="btn-confirm-ok">Xác nhận</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const titleEl = modal.querySelector('#confirm-modal-title');
    const msgEl = modal.querySelector('#confirm-modal-message');
    const btnCancel = modal.querySelector('#btn-confirm-cancel');
    const btnOk = modal.querySelector('#btn-confirm-ok');

    if (titleEl) titleEl.innerText = title;
    if (msgEl) msgEl.innerText = message;

    modal.classList.remove('hidden');

    const handleCancel = () => {
        modal.classList.add('hidden');
        btnCancel.removeEventListener('click', handleCancel);
        btnOk.removeEventListener('click', handleOk);
    };

    const handleOk = () => {
        modal.classList.add('hidden');
        btnCancel.removeEventListener('click', handleCancel);
        btnOk.removeEventListener('click', handleOk);
        if (onConfirm) onConfirm();
    };

    btnCancel.addEventListener('click', handleCancel);
    btnOk.addEventListener('click', handleOk);
};

window.formatRelativeReleaseDate = function(dateStr) {
    if (!dateStr) return '';
    let date;
    let year, month, day;
    const str = String(dateStr).trim();

    const matchYMD = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(str);
    const matchMDY = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(str);

    if (matchYMD) {
        year = parseInt(matchYMD[1], 10);
        month = parseInt(matchYMD[2], 10);
        day = parseInt(matchYMD[3], 10);
        date = new Date(year, month - 1, day);
    } else if (matchMDY) {
        let v1 = parseInt(matchMDY[1], 10);
        let v2 = parseInt(matchMDY[2], 10);
        year = parseInt(matchMDY[3], 10);
        if (v1 > 12 && v2 <= 12) {
            day = v1;
            month = v2;
        } else {
            month = v1;
            day = v2;
        }
        date = new Date(year, month - 1, day);
    } else {
        date = new Date(str);
        if (!isNaN(date.getTime())) {
            year = date.getFullYear();
            month = date.getMonth() + 1;
            day = date.getDate();
        }
    }

    if (!year || !month || !day || isNaN(date.getTime())) return dateStr;

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

class VODExplorer {
    constructor(options = {}) {
        this.backendHost = options.backendHost || '';
        this.onVideoSelect = options.onVideoSelect || (() => {});

        this.currentPath = 'all';
        this.parentPath = null;
        this.activeTab = 'videos'; // 'videos' | 'folders' | 'sources'
        this.sortKey = 'release_date'; // 'release_date' | 'name' | 'size'
        this.sortAsc = false;         // Default: mới nhất xếp lên đầu (Descending)
        this.filterHasCover = true;   // Default: ưu tiên lọc các video có cover & play tốt
        this.filterNoCover = false;   // Lọc video chưa có cover image
        this.filterNoIdx = false;     // Lọc video chưa có file idx
        this.filterUnviewed = false;  // Lọc video chưa xem
        this.filterActress = '';      // Lọc theo Diễn viên (Actress)
        this.filterGenre = '';        // Lọc theo Thể loại (Genre)
        this.filterStudio = '';       // Lọc theo Hãng / Studio (Maker/Studio)
        this.viewMode = 'grid';       // Cố định chế độ Card (Grid)
        this.currentPlayingFilename = options.currentPlayingFilename || '';

        // Direct Video List Mode (NextDJAV GDrive Library - Không dùng box/thread)
        this.currentViewLevel = 'videos'; // Default to 'videos' list view
        this.currentContext = {
            boxId: null,
            boxName: null,
            threadId: null,
            threadName: null,
            mediaId: null
        };
        this.tierThreads = [];
        this.tierBoxes = [];

        // Server-Side Pagination & Pull-to-Paginate State
        const savedPageSize = parseInt(localStorage.getItem('missav_page_size'), 10);
        this.pageSize = (savedPageSize === 12 || savedPageSize === 24 || savedPageSize === 36 || savedPageSize === 48 || savedPageSize === 60) ? savedPageSize : 12;
        this.currentPage = 1;
        this.totalPages = 1;
        this.loadedStartOffset = 0;
        this.loadedEndOffset = 0;
        this.totalVideos = 0;
        this.isLoadingPage = false;
        this.isLoadingTop = false;
        this.isLoadingBottom = false;

        this.pageCache = {};
        this.pagePreloadPromises = {};

        this.folders = [];
        this.videos = [];
        this.sources = [];
        this.searchQuery = '';
        this.searchDebounceTimer = null;

        this.initDOM();
        this.bindEvents();

        const initialHash = (window.location.hash || '').replace(/^#\/?/, '').trim();
        if (initialHash === 'library' || initialHash === 'explorer' || initialHash === 'all') {
            this.fetchDirectory();
        }

        window.addEventListener('hashchange', () => this.handleRoute());
        this.handleRoute();
    }

    getCoverUrl(item) {
        if (!item) return '';
        if (item.cover_url) return item.cover_url;
        if (item.coverUrl) return item.coverUrl;
        if (item.poster_url) return item.poster_url;
        const code = item.code || item.id || (item.name ? (item.name.match(/([A-Za-z0-9]+-[0-9]+)/) || [])[1] : '') || '';
        if (code) {
            return `${this.backendHost}/api/poster/${encodeURIComponent(code)}`;
        }
        return '';
    }

    renderSkeleton(count = 8) {
        if (!this.listContainer) return;
        let html = '';
        for (let i = 0; i < count; i++) {
            html += `
                <div class="skeleton-card">
                    <div class="skeleton-box skeleton-cover cover-skeleton"></div>
                    <div class="skeleton-box skeleton-title"></div>
                    <div class="skeleton-box skeleton-sub"></div>
                </div>
            `;
        }
        this.listContainer.innerHTML = html;
    }

    initDOM() {
        this.modalEl = document.getElementById('explorer-modal');
        this.drawerHeaderIcon = document.getElementById('explorer-header-icon');
        this.drawerHeaderTitle = document.getElementById('explorer-header-title');
        this.btnExplorerBack = document.getElementById('btn-explorer-back');
        this.explorerBreadcrumb = document.getElementById('explorer-breadcrumb');
        this.btnOpen = document.getElementById('btn-explorer');
        this.btnOpenActresses = document.getElementById('btn-actresses');
        this.btnOpenStudios = document.getElementById('btn-studios');
        this.btnClose = document.getElementById('btn-close-explorer');
        this.btnBack = document.getElementById('btn-path-back');
        this.pathDisplay = document.getElementById('explorer-curr-path');

        // Source Drawer Elements
        this.sourceDrawerModal = document.getElementById('source-drawer-modal');
        this.btnOpenSources = document.getElementById('btn-sources');
        this.btnCloseSourceDrawer = document.getElementById('btn-close-source-drawer');

        this.tabVideos = document.getElementById('tab-videos');
        this.tabFolders = document.getElementById('tab-folders');
        this.tabSources = document.getElementById('tab-sources');
        this.badgeVideos = document.getElementById('badge-videos');
        this.badgeFolders = document.getElementById('badge-folders');
        this.badgeSources = document.getElementById('badge-sources');

        this.sortBar = document.getElementById('explorer-sort-bar');
        this.btnSortRelease = document.getElementById('sort-by-release');
        this.btnSortName = document.getElementById('sort-by-name');
        this.btnSortSize = document.getElementById('sort-by-size');
        this.btnSortViews = document.getElementById('sort-by-views');
        this.btnFilterHasCover = document.getElementById('filter-has-cover');
        this.btnFilterUnviewed = document.getElementById('filter-unviewed');
        this.btnFilterNoCover = document.getElementById('filter-no-cover');
        this.btnFilterNoIdx = document.getElementById('filter-no-idx');
        this.iconSortRelease = document.getElementById('sort-release-icon');
        this.iconSortName = document.getElementById('sort-name-icon');
        this.iconSortSize = document.getElementById('sort-size-icon');
        this.iconSortViews = document.getElementById('sort-views-icon');

        this.btnToggleView = document.getElementById('btn-toggle-view');
        this.iconViewMode = document.getElementById('view-mode-icon');
        this.btnToggleSearch = document.getElementById('btn-toggle-search');
        this.btnBottomSearch = document.getElementById('btn-bottom-search');
        this.searchWrapper = document.getElementById('search-wrapper');
        this.inputSearchVideo = document.getElementById('input-search-video');
        this.btnClearSearch = document.getElementById('btn-clear-search');

        this.selectExplorerCols = document.getElementById('select-explorer-cols');

        this.listContainer = document.getElementById('explorer-list');
        this.initObservers();
        this.initPaginationSwipe();

        // Categories Drawer Modal Elements
        this.categoriesModal = document.getElementById('categories-drawer-modal');
        this.categoriesHeaderIcon = document.getElementById('categories-header-icon');
        this.categoriesHeaderTitle = document.getElementById('categories-header-title');
        this.selectCategoriesCols = document.getElementById('select-categories-cols');
        this.btnToggleCategoriesFullscreen = document.getElementById('btn-toggle-categories-fullscreen');
        this.iconCategoriesFullscreen = document.getElementById('icon-categories-fullscreen');
        this.btnToggleCategoriesSearch = document.getElementById('btn-toggle-categories-search');
        this.btnCloseCategories = document.getElementById('btn-close-categories');
        this.categoriesSearchWrapper = document.getElementById('categories-search-wrapper');
        this.inputSearchCategories = document.getElementById('input-search-categories');
        this.btnClearCategoriesSearch = document.getElementById('btn-clear-categories-search');

        this.categoryTabActresses = document.getElementById('category-tab-actresses');
        this.categoryTabGenres = document.getElementById('category-tab-genres');
        this.categoryTabStudios = document.getElementById('category-tab-studios');

        this.categoriesSortBar = document.getElementById('categories-sort-bar');
        this.btnCategoriesSortRelease = document.getElementById('categories-sort-by-release');
        this.btnCategoriesSortName = document.getElementById('categories-sort-by-name');
        this.btnCategoriesSortViews = document.getElementById('categories-sort-by-views');
        this.btnCategoriesFilterNoCover = document.getElementById('categories-filter-no-cover');
        this.iconCategoriesSortRelease = document.getElementById('categories-sort-release-icon');
        this.iconCategoriesSortName = document.getElementById('categories-sort-name-icon');
        this.iconCategoriesSortViews = document.getElementById('categories-sort-views-icon');

        this.categoriesListContainer = document.getElementById('categories-list');
        this.activeCategoryTab = 'genres'; // 'genres' (Boxes in RPHang)
        this.categoriesSearchQuery = '';
        this.categoriesSearchDebounceTimer = null;

        // Sources Panel Elements
        this.sourcesPanel = document.getElementById('sources-panel');
        this.inputSourcePath = document.getElementById('input-source-path');
        this.btnAddSource = document.getElementById('btn-add-source');
        this.sourcesStatusMsg = document.getElementById('sources-status-msg');
        this.sourcesListContainer = document.getElementById('sources-list');
        
        this.btnAddRcloneSource = document.getElementById('btn-add-rclone-source');
        this.inputRcloneConf = document.getElementById('input-rclone-conf');
        this.rcloneSelectorBox = document.getElementById('rclone-selector-box');
        this.selectRcloneRemote = document.getElementById('select-rclone-remote');
        this.selectRcloneFolder = document.getElementById('select-rclone-folder');
        this.btnConfirmRclone = document.getElementById('btn-confirm-rclone');

        this.btnExportSources = document.getElementById('btn-export-sources');
        this.inputImportSources = document.getElementById('input-import-sources');

        // Bottom Drawer Menu cho Quản lý Nguồn (Tools)
        this.btnSourcesToolsMenu = document.getElementById('btn-sources-tools-menu');
        this.sourcesToolsModal = document.getElementById('sources-tools-modal');
        this.btnCloseSourcesToolsMenu = document.getElementById('btn-close-sources-tools-menu');
        this.btnRescanAllSources = document.getElementById('btn-rescan-all-sources');
        this.btnRescanAllUpdate = document.getElementById('btn-rescan-all-update');

        // Bottom Drawer Menu for Sources Item
        this.sourceMenuModal = document.getElementById('source-menu-modal');
        this.btnCloseSourceMenu = document.getElementById('btn-close-source-menu');
        this.sourceMenuTitle = document.getElementById('source-menu-title');
        this.sourceActionExplore = document.getElementById('source-action-explore');
        this.sourceActionUpdate = document.getElementById('source-action-update');
        this.sourceActionRescan = document.getElementById('source-action-rescan');
        this.sourceActionDelete = document.getElementById('source-action-delete');
        this.activeSourceForMenu = null;

        // User Account and History Drawer Modal elements
        this.userDrawerModal = document.getElementById('user-drawer-modal');
        this.btnOpenUser = document.getElementById('btn-user');
        this.btnCloseUserDrawer = document.getElementById('btn-close-user-drawer');
        this.btnToggleUserAccount = document.getElementById('btn-toggle-user-account');
        this.userAccountSection = document.getElementById('user-account-section');
        this.authFormsContainer = document.getElementById('auth-forms-container');
        this.authProfileContainer = document.getElementById('auth-profile-container');

        // New OTP / Password Tabs & Views
        this.authTabOtp = document.getElementById('auth-tab-otp');
        this.authTabPassword = document.getElementById('auth-tab-password');
        this.authViewOtp = document.getElementById('auth-view-otp');
        this.authViewPassword = document.getElementById('auth-view-password');

        this.otpStepEmail = document.getElementById('otp-step-email');
        this.otpStepVerify = document.getElementById('otp-step-verify');
        this.authOtpEmailInput = document.getElementById('auth-otp-email');
        this.btnAuthSendOtp = document.getElementById('btn-auth-send-otp');

        this.authOtpTargetEmail = document.getElementById('auth-otp-target-email');
        this.authOtpCodeInput = document.getElementById('auth-otp-code');
        this.authOtpNewPassword = document.getElementById('auth-otp-new-password');
        this.btnAuthVerifyOtp = document.getElementById('btn-auth-verify-otp');
        this.btnAuthReenterEmail = document.getElementById('btn-auth-reenter-email');
        this.btnAuthResendOtp = document.getElementById('btn-auth-resend-otp');

        this.authPassEmailInput = document.getElementById('auth-pass-email');
        this.authPassValueInput = document.getElementById('auth-pass-value');
        this.btnAuthPassSubmit = document.getElementById('btn-auth-pass-submit');

        this.btnAuthLogout = document.getElementById('btn-auth-logout');
        this.userEmailDisplay = document.getElementById('user-email-display');

        // History active tab
        this.activeHistoryTab = 'view'; // 'view' | 'search' | 'favorite'
        this.authMode = 'otp';          // 'otp' | 'password'

        // History tab buttons
        this.tabHistoryView = document.getElementById('tab-history-view');
        this.tabHistorySearch = document.getElementById('tab-history-search');
        this.tabHistoryFavorite = document.getElementById('tab-history-favorite');

        // History panels
        this.panelHistoryView = document.getElementById('panel-history-view');
        this.panelHistorySearch = document.getElementById('panel-history-search');
        this.panelHistoryFavorite = document.getElementById('panel-history-favorite');

        // History list containers
        this.historyViewList = document.getElementById('history-view-list');
        this.historySearchList = document.getElementById('history-search-list');
        this.historyFavoriteList = document.getElementById('history-favorite-list');

        // Clear history buttons
        this.btnClearViewHistory = document.getElementById('btn-clear-view-history');
        this.btnClearSearchHistory = document.getElementById('btn-clear-search-history');

        // Search Drawer Modal Elements
        this.searchDrawerModal = document.getElementById('search-drawer-modal');
        this.btnCloseSearchDrawer = document.getElementById('btn-close-search-drawer');
        this.inputSearchDrawer = document.getElementById('input-search-drawer');
        this.btnClearSearchDrawer = document.getElementById('btn-clear-search-drawer');

        this.searchSuggestionsSection = document.getElementById('search-suggestions-section');
        this.searchSuggestionsContainer = document.getElementById('search-suggestions-container');
        this.searchHistorySection = document.getElementById('search-history-section');
        this.searchWordsList = document.getElementById('search-words-list');
        this.searchResultsSection = document.getElementById('search-results-section');
        this.searchResultsList = document.getElementById('search-results-list');
        this.btnClearSearchWords = document.getElementById('btn-clear-search-words');

        // Page Jump Drawer Modal Elements
        this.pageJumpModal = document.getElementById('page-jump-drawer-modal');
        this.btnClosePageJumpDrawer = document.getElementById('btn-close-page-jump-drawer');
        this.pageJumpInput = document.getElementById('page-jump-input');
        this.btnPageJumpGo = document.getElementById('btn-page-jump-go');
        this.pageJumpGrid = document.getElementById('page-jump-grid');
        this.pageJumpCurrentBadge = document.getElementById('page-jump-current-badge');
        this.pageJumpTotalText = document.getElementById('page-jump-total-text');

        this.searchDrawerQuery = '';
        this.searchDrawerDebounceTimer = null;

        // Explorer Scrollable Category Tabs Elements
        this.explorerTabDropdownWrapper = document.querySelector('.explorer-tab-dropdown-wrapper');
        this.explorerTabAll = document.getElementById('explorer-tab-all');
        this.explorerTabAllLabel = document.getElementById('explorer-tab-all-label');
        this.explorerTabPopular = document.getElementById('explorer-tab-popular');
        this.explorerTabForYou = document.getElementById('explorer-tab-foryou');
        this.explorerTabGDrive = document.getElementById('explorer-tab-gdrive');
        this.sourcesDropdownMenu = document.getElementById('sources-dropdown-menu');
        this.sourcesDropdownList = document.getElementById('sources-dropdown-list');
        this.btnSelectAllSources = document.getElementById('btn-select-all-sources');
        this.selectedSourceIds = []; // empty = all sources
        this.explorerTabQueue = document.getElementById('explorer-tab-queue');
        this.activeExplorerCategory = 'all'; // 'all' | 'popular' | 'foryou' | 'gdrive' | 'queue'

        if (window.__IS_GDRIVE_ONLY__ || window.location.port === '3001') {
            if (this.explorerTabAllLabel) this.explorerTabAllLabel.innerText = 'Kho Google Drive';
            if (this.explorerTabQueue) this.explorerTabQueue.style.display = 'none';
        }

        // Entity State & Pagination / Sorting
        this.entityState = {
            actresses: { sortKey: 'total_videos', sortAsc: false, currentPage: 1, pageSize: 48, total: 0, totalPages: 1, items: [], inDetailView: false },
            genres: { sortKey: 'total_videos', sortAsc: false, currentPage: 1, pageSize: 48, total: 0, totalPages: 1, items: [], inDetailView: false },
            studios: { sortKey: 'total_videos', sortAsc: false, currentPage: 1, pageSize: 48, total: 0, totalPages: 1, items: [], inDetailView: false }
        };

        this.entityDetailState = {
            type: 'actresses',
            name: '',
            sortKey: 'release_date',
            sortAsc: false,
            filterNoCover: false,
            currentPage: 1,
            pageSize: 48,
            total: 0,
            totalPages: 1,
            videos: []
        };

        this.initLayoutSettings();
        this.updateViewModeUI();
    }

    initLayoutSettings() {
        // 1. Tải setting Fullscreen từ LocalStorage
        this.isFullscreen = localStorage.getItem('explorer_fullscreen') === 'true';
        this.applyFullscreenUI();

        // 2. Tải setting Số cột từ LocalStorage (mặc định: 1 cột với mobile <768px, 2 cột với tablet/desktop)
        const isMobileScreen = window.innerWidth < 768;
        const defaultCols = isMobileScreen ? 1 : 2;
        const savedCols = parseInt(localStorage.getItem('explorer_grid_cols'), 10);
        this.gridCols = (savedCols >= 1 && savedCols <= 6) ? savedCols : defaultCols;
        if (this.selectExplorerCols) {
            this.selectExplorerCols.value = String(this.gridCols);
        }
        if (this.selectCategoriesCols) {
            this.selectCategoriesCols.value = String(this.gridCols);
        }
        this.applyGridColsUI();
    }

    applyFullscreenUI() {
        const drawer = this.modalEl ? this.modalEl.querySelector('.explorer-drawer') : null;
        if (drawer) {
            if (this.isFullscreen) {
                drawer.classList.add('fullscreen-mode');
            } else {
                drawer.classList.remove('fullscreen-mode');
            }
        }
        const categoriesDrawer = this.categoriesModal ? this.categoriesModal.querySelector('.explorer-drawer') : null;
        if (categoriesDrawer) {
            if (this.isFullscreen) {
                categoriesDrawer.classList.add('fullscreen-mode');
            } else {
                categoriesDrawer.classList.remove('fullscreen-mode');
            }
        }
        if (this.iconCategoriesFullscreen) {
            this.iconCategoriesFullscreen.innerText = this.isFullscreen ? 'fullscreen_exit' : 'fullscreen';
        }
        if (this.btnToggleCategoriesFullscreen) {
            this.btnToggleCategoriesFullscreen.title = this.isFullscreen ? 'Thu nhỏ bảng Categories' : 'Toàn màn hình Categories';
        }
        if (this.btnToggleCategoriesFullscreen) {
            this.btnToggleCategoriesFullscreen.title = this.isFullscreen ? 'Thu nhỏ bảng Categories' : 'Toàn màn hình Categories';
        }
    }

    toggleFullscreen() {
        this.isFullscreen = !this.isFullscreen;
        localStorage.setItem('explorer_fullscreen', String(this.isFullscreen));
        this.applyFullscreenUI();
    }

    applyGridColsUI() {
        if (!this.gridCols) this.gridCols = 2;
        document.documentElement.style.setProperty('--explorer-grid-cols', this.gridCols);
        if (this.iconFullscreen) {
            this.iconFullscreen.innerText = this.gridCols > 1 ? 'view_list' : 'grid_view';
        }

        // Áp dụng class cols-X vào listContainer nếu đang ở grid-mode
        if (this.listContainer && this.listContainer.classList.contains('grid-mode')) {
            for (let i = 1; i <= 6; i++) {
                this.listContainer.classList.remove(`cols-${i}`);
            }
            this.listContainer.classList.add(`cols-${this.gridCols}`);
        }

        // Áp dụng class cols-X vào categoriesListContainer nếu có
        if (this.categoriesListContainer) {
            for (let i = 1; i <= 6; i++) {
                this.categoriesListContainer.classList.remove(`cols-${i}`);
            }
            this.categoriesListContainer.classList.add(`cols-${this.gridCols}`);
        }

        // Áp dụng class cols-X vào tất cả các entity detail grids
        document.querySelectorAll('.entity-detail-videos-grid').forEach(el => {
            for (let i = 1; i <= 6; i++) {
                el.classList.remove(`cols-${i}`);
            }
            el.classList.add(`cols-${this.gridCols}`);
        });
    }

    setGridCols(cols) {
        cols = parseInt(cols, 10);
        if (cols >= 1 && cols <= 6) {
            this.gridCols = cols;
            localStorage.setItem('explorer_grid_cols', String(this.gridCols));
            if (this.selectExplorerCols) this.selectExplorerCols.value = String(cols);
            if (this.selectCategoriesCols) this.selectCategoriesCols.value = String(cols);
            this.applyGridColsUI();
        }
    }

    bindEvents() {
        const libraryTabsWrapper = document.getElementById('library-scrollable-tabs');
        if (libraryTabsWrapper) {
            libraryTabsWrapper.addEventListener('click', (e) => {
                const btn = e.target.closest('.explorer-tab-btn');
                if (!btn) return;
                
                libraryTabsWrapper.querySelectorAll('.explorer-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                this.activeLibraryTab = btn.getAttribute('data-library-tab');
                this.currentPage = 1;
                this.fetchDirectory(this.currentPath);
            });
        }

        if (this.btnExplorerBack) {
            this.btnExplorerBack.addEventListener('click', (e) => {
                e.stopPropagation();
                this.navigateHierarchyBack();
            });
        }

        if (this.explorerBreadcrumb) {
            this.explorerBreadcrumb.addEventListener('click', (e) => {
                const target = e.target.closest('[data-action]');
                if (!target) return;
                const action = target.getAttribute('data-action');
                if (action === 'go-boxes') {
                    this.openBoxes({ direction: 'left' });
                } else if (action === 'go-threads') {
                    this.openBoxThreads(this.currentContext.boxId, { direction: 'left' });
                }
            });
        }

        if (this.selectExplorerCols) {
            this.selectExplorerCols.addEventListener('change', (e) => {
                e.stopPropagation();
                this.setGridCols(e.target.value);
            });
        }

        if (this.selectCategoriesCols) {
            this.selectCategoriesCols.addEventListener('change', (e) => {
                e.stopPropagation();
                this.setGridCols(e.target.value);
            });
        }

        if (this.btnToggleCategoriesFullscreen) {
            this.btnToggleCategoriesFullscreen.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleFullscreen();
            });
        }

        if (this.btnToggleCategoriesSearch) {
            this.btnToggleCategoriesSearch.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.categoriesSearchWrapper) {
                    this.categoriesSearchWrapper.classList.toggle('active');
                    if (this.categoriesSearchWrapper.classList.contains('active') && this.inputSearchCategories) {
                        this.inputSearchCategories.focus();
                    }
                }
            });
        }

        if (this.btnCloseCategories) {
            this.btnCloseCategories.addEventListener('click', () => this.closeCategoriesDrawer());
        }

        if (this.categoriesModal) {
            this.categoriesModal.addEventListener('click', (e) => {
                if (e.target === this.categoriesModal) {
                    this.closeCategoriesDrawer();
                }
            });
        }

        if (this.categoryTabActresses) {
            this.categoryTabActresses.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setActiveCategoryTab('actresses');
            });
        }

        if (this.categoryTabGenres) {
            this.categoryTabGenres.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setActiveCategoryTab('genres');
            });
        }

        if (this.categoryTabStudios) {
            this.categoryTabStudios.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setActiveCategoryTab('studios');
            });
        }

        if (this.btnCategoriesSortRelease) {
            this.btnCategoriesSortRelease.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleCategoryTabSortChange('release_date');
            });
        }

        if (this.btnCategoriesSortName) {
            this.btnCategoriesSortName.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleCategoryTabSortChange('name');
            });
        }

        if (this.btnCategoriesSortViews) {
            this.btnCategoriesSortViews.addEventListener('click', (e) => {
                e.stopPropagation();
                this.handleCategoryTabSortChange('total_videos');
            });
        }

        if (this.btnCategoriesFilterNoCover) {
            this.btnCategoriesFilterNoCover.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.entityDetailState && this.entityState[this.activeCategoryTab]?.inDetailView) {
                    this.entityDetailState.filterNoCover = !this.entityDetailState.filterNoCover;
                    this.updateCategoriesSortUI();
                    this.fetchAndRenderEntityDetail(this.entityDetailState.type, this.entityDetailState.name, this.categoriesListContainer, true);
                }
            });
        }

        if (this.inputSearchCategories) {
            this.inputSearchCategories.addEventListener('input', (e) => {
                const rawVal = e.target.value;
                const val = rawVal.trim();
                if (this.btnClearCategoriesSearch) {
                    if (rawVal.length > 0) {
                        this.btnClearCategoriesSearch.classList.remove('hidden');
                    } else {
                        this.btnClearCategoriesSearch.classList.add('hidden');
                    }
                }
                clearTimeout(this.categoriesSearchDebounceTimer);
                this.categoriesSearchDebounceTimer = setTimeout(() => {
                    this.categoriesSearchQuery = val;
                    if (this.entityState[this.activeCategoryTab] && this.entityState[this.activeCategoryTab].inDetailView) {
                        this.fetchAndRenderEntityDetail(this.activeCategoryTab, this.entityDetailState.name, this.categoriesListContainer, true);
                    } else {
                        this.fetchAndRenderExplorerEntities(this.activeCategoryTab, val, this.categoriesListContainer, true);
                    }
                }, 300);
            });
        }

        if (this.btnClearCategoriesSearch) {
            this.btnClearCategoriesSearch.addEventListener('click', () => {
                if (this.inputSearchCategories) this.inputSearchCategories.value = '';
                this.btnClearCategoriesSearch.classList.add('hidden');
                this.categoriesSearchQuery = '';
                if (this.entityState[this.activeCategoryTab] && this.entityState[this.activeCategoryTab].inDetailView) {
                    this.fetchAndRenderEntityDetail(this.activeCategoryTab, this.entityDetailState.name, this.categoriesListContainer, true);
                } else {
                    this.fetchAndRenderExplorerEntities(this.activeCategoryTab, '', this.categoriesListContainer, true);
                }
                if (this.inputSearchCategories) this.inputSearchCategories.focus();
            });
        }

        if (this.btnOpen) {
            this.btnOpen.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openContextualDrawer();
            });
        }

        if (this.btnOpenActresses) {
            this.btnOpenActresses.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openActressesDrawer();
            });
        }


        if (this.btnOpenStudios) {
            this.btnOpenStudios.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openStudiosDrawer();
            });
        }

        if (this.btnClose) {
            this.btnClose.addEventListener('click', () => this.close());
        }

        if (this.btnOpenSources) {
            this.btnOpenSources.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openSources();
            });
        }

        if (this.btnCloseSourceDrawer) {
            this.btnCloseSourceDrawer.addEventListener('click', () => this.closeSources());
        }

        if (this.sourceDrawerModal) {
            this.sourceDrawerModal.addEventListener('click', (e) => {
                if (e.target === this.sourceDrawerModal) {
                    this.closeSources();
                }
            });
        }

        if (this.modalEl) {
            this.modalEl.addEventListener('click', (e) => {
                if (e.target === this.modalEl) {
                    this.close();
                }
            });
        }

        // Lắng nghe sự kiện đánh dấu lỗi video từ Player để cập nhật UI ngay lập tức
        window.addEventListener('missav:video-marked-error', (e) => {
            const { code } = e.detail || {};
            if (!code) return;
            const targetCards = document.querySelectorAll(`[data-code="${code}"]`);
            targetCards.forEach(card => {
                card.classList.add('broken-card');
                const bottomBadges = card.querySelector('.grid-card-badges-bottom');
                if (bottomBadges && !bottomBadges.querySelector('.badge-broken-status')) {
                    const b = document.createElement('span');
                    b.className = 'badge-broken-status';
                    b.title = 'Video bị lỗi stream, đang chờ crawler cào lại link mới';
                    b.innerText = '⚠️ Lỗi link';
                    bottomBadges.appendChild(b);
                }
            });
        });

        if (this.btnSourcesToolsMenu) {
            this.btnSourcesToolsMenu.addEventListener('click', () => {
                this.closeAllDrawers('sourceTools');
                if (this.sourcesToolsModal) {
                    this.sourcesToolsModal.classList.remove('hidden');
                }
            });
        }

        if (this.btnCloseSourcesToolsMenu) {
            this.btnCloseSourcesToolsMenu.addEventListener('click', () => {
                if (this.sourcesToolsModal) {
                    this.sourcesToolsModal.classList.add('hidden');
                }
            });
        }

        if (this.sourcesToolsModal) {
            this.sourcesToolsModal.addEventListener('click', (e) => {
                if (e.target === this.sourcesToolsModal) {
                    this.sourcesToolsModal.classList.add('hidden');
                }
            });
        }

        if (this.btnRescanAllSources) {
            this.btnRescanAllSources.addEventListener('click', () => {
                if (this.sourcesToolsModal) this.sourcesToolsModal.classList.add('hidden');
                this.handleRescanAllSources('full');
            });
        }

        if (this.btnRescanAllUpdate) {
            this.btnRescanAllUpdate.addEventListener('click', () => {
                if (this.sourcesToolsModal) this.sourcesToolsModal.classList.add('hidden');
                this.handleRescanAllSources('update');
            });
        }

        if (this.btnExportSources) {
            this.btnExportSources.addEventListener('click', () => {
                if (this.sourcesToolsModal) this.sourcesToolsModal.classList.add('hidden');
                this.handleExportSources();
            });
        }

        if (this.inputImportSources) {
            this.inputImportSources.addEventListener('change', (e) => {
                if (this.sourcesToolsModal) this.sourcesToolsModal.classList.add('hidden');
                this.handleImportSources(e);
            });
        }

        if (this.btnCloseSourceMenu) {
            this.btnCloseSourceMenu.addEventListener('click', () => this.closeSourceMenu());
        }

        if (this.sourceMenuModal) {
            this.sourceMenuModal.addEventListener('click', (e) => {
                if (e.target === this.sourceMenuModal) {
                    this.closeSourceMenu();
                }
            });
        }

        if (this.sourceActionExplore) {
            this.sourceActionExplore.addEventListener('click', () => {
                if (this.activeSourceForMenu) {
                    const src = this.activeSourceForMenu;
                    this.closeSourceMenu();
                    this.closeSources();
                    this.selectedSourceIds = [src.id];
                    this.currentPath = 'all';
                    this.open();
                    this.setActiveExplorerCategory('all');
                    this.updateSourcesDropdownUI();
                    this.fetchDirectory('all');
                }
            });
        }

        if (this.sourceActionUpdate) {
            this.sourceActionUpdate.addEventListener('click', () => {
                if (this.activeSourceForMenu) {
                    const src = this.activeSourceForMenu;
                    this.closeSourceMenu();
                    this.handleRescanSource(src.id, src.path, 'update');
                }
            });
        }

        if (this.sourceActionRescan) {
            this.sourceActionRescan.addEventListener('click', () => {
                if (this.activeSourceForMenu) {
                    const src = this.activeSourceForMenu;
                    this.closeSourceMenu();
                    this.handleRescanSource(src.id, src.path, 'full');
                }
            });
        }

        if (this.sourceActionDelete) {
            this.sourceActionDelete.addEventListener('click', () => {
                if (this.activeSourceForMenu) {
                    const src = this.activeSourceForMenu;
                    this.closeSourceMenu();
                    this.handleDeleteSource(src.id, src.path);
                }
            });
        }

        if (this.btnBack) {
            this.btnBack.addEventListener('click', () => {
                if (this.parentPath) {
                    this.fetchDirectory(this.parentPath);
                }
            });
        }

        if (this.tabVideos) {
            this.tabVideos.addEventListener('click', () => {
                this.setActiveTab('videos');
            });
        }

        if (this.tabFolders) {
            this.tabFolders.addEventListener('click', () => {
                this.setActiveTab('folders');
            });
        }

        if (this.tabSources) {
            this.tabSources.addEventListener('click', () => {
                this.setActiveTab('sources');
            });
        }

        if (this.btnSortRelease) {
            this.btnSortRelease.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.activeExplorerCategory === 'all') {
                    this.handleSortChange('release_date');
                } else {
                    this.handleEntitySortChange(this.activeExplorerCategory, 'release_date', this.listContainer);
                }
            });
        }

        if (this.btnSortName) {
            this.btnSortName.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.activeExplorerCategory === 'all') {
                    this.handleSortChange('name');
                } else {
                    this.handleEntitySortChange(this.activeExplorerCategory, 'name', this.listContainer);
                }
            });
        }

        if (this.btnSortSize) {
            this.btnSortSize.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.activeExplorerCategory === 'all') {
                    this.handleSortChange('size');
                }
            });
        }

        if (this.btnSortViews) {
            this.btnSortViews.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.activeExplorerCategory === 'all') {
                    this.handleSortChange('views');
                } else {
                    this.handleEntitySortChange(this.activeExplorerCategory, 'total_videos', this.listContainer);
                }
            });
        }

        if (this.btnFilterHasCover) {
            this.btnFilterHasCover.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.activeExplorerCategory === 'all') {
                    this.clearPageCache();
                    this.filterHasCover = !this.filterHasCover;
                    this.btnFilterHasCover.classList.toggle('active', this.filterHasCover);
                    this.fetchDirectory(this.currentPath);
                }
            });
        }

        if (this.btnFilterUnviewed) {
            this.btnFilterUnviewed.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.activeExplorerCategory === 'all') {
                    this.clearPageCache();
                    this.filterUnviewed = !this.filterUnviewed;
                    this.btnFilterUnviewed.classList.toggle('active', this.filterUnviewed);
                    this.fetchDirectory(this.currentPath);
                }
            });
        }

        if (this.btnFilterNoCover) {
            this.btnFilterNoCover.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.activeExplorerCategory === 'all') {
                    this.clearPageCache();
                    this.filterNoCover = !this.filterNoCover;
                    this.btnFilterNoCover.classList.toggle('active', this.filterNoCover);
                    this.fetchDirectory(this.currentPath);
                } else if (this.entityDetailState && this.entityState[this.activeExplorerCategory]?.inDetailView) {
                    this.entityDetailState.filterNoCover = !this.entityDetailState.filterNoCover;
                    this.updateSortUI();
                    this.fetchAndRenderEntityDetail(this.entityDetailState.type, this.entityDetailState.name, this.listContainer, true);
                }
            });
        }

        if (this.btnFilterNoIdx) {
            this.btnFilterNoIdx.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.activeExplorerCategory === 'all') {
                    this.clearPageCache();
                    this.filterNoIdx = !this.filterNoIdx;
                    this.btnFilterNoIdx.classList.toggle('active', this.filterNoIdx);
                    this.fetchDirectory(this.currentPath);
                }
            });
        }

        if (this.inputSearchVideo) {
            this.inputSearchVideo.addEventListener('input', (e) => {
                const rawVal = e.target.value;
                const val = rawVal.trim();
                if (this.btnClearSearch) {
                    if (rawVal.length > 0) {
                        this.btnClearSearch.classList.remove('hidden');
                    } else {
                        this.btnClearSearch.classList.add('hidden');
                    }
                }
                clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => {
                    this.searchInExplorer(val);
                }, 300);
            });

            this.inputSearchVideo.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    clearTimeout(this.searchDebounceTimer);
                    this.searchInExplorer(this.inputSearchVideo.value.trim());
                }
            });
        }

        if (this.btnClearSearch) {
            this.btnClearSearch.addEventListener('click', () => {
                if (this.inputSearchVideo) this.inputSearchVideo.value = '';
                this.btnClearSearch.classList.add('hidden');
                this.searchQuery = '';
                this.fetchDirectory(this.currentPath);
                this.fetchCategoryCounts('');
                if (this.inputSearchVideo) this.inputSearchVideo.focus();
            });
        }

        if (this.btnToggleSearch) {
            this.btnToggleSearch.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openSearchDrawer();
            });
        }

        if (this.btnBottomSearch) {
            this.btnBottomSearch.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openSearchDrawer();
            });
        }

        // Bind Search Drawer Modal Events
        if (this.btnCloseSearchDrawer) {
            this.btnCloseSearchDrawer.addEventListener('click', () => this.closeSearchDrawer());
        }

        if (this.searchDrawerModal) {
            this.searchDrawerModal.addEventListener('click', (e) => {
                if (e.target === this.searchDrawerModal) {
                    this.closeSearchDrawer();
                }
            });
        }

        if (this.inputSearchDrawer) {
            this.inputSearchDrawer.addEventListener('input', (e) => {
                const rawVal = e.target.value;
                const val = rawVal.trim();
                if (this.btnClearSearchDrawer) {
                    if (rawVal.length > 0) {
                        this.btnClearSearchDrawer.classList.remove('hidden');
                    } else {
                        this.btnClearSearchDrawer.classList.add('hidden');
                    }
                }
                clearTimeout(this.searchDrawerDebounceTimer);
                this.searchDrawerDebounceTimer = setTimeout(() => {
                    this.searchDrawerQuery = val;
                    if (val) {
                        this.fetchSearchDrawerResults(val);
                    } else {
                        this.renderSearchDrawerDefault();
                    }
                }, 300);
            });

            this.inputSearchDrawer.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = this.inputSearchDrawer.value.trim();
                    if (val) {
                        this.searchInExplorer(val);
                    }
                }
            });
        }

        // Tự động ẩn bàn phím khi vuốt xem danh sách lịch sử/gợi ý
        const searchDrawerBody = document.querySelector('.search-drawer-body');
        if (searchDrawerBody && this.inputSearchDrawer) {
            const hideKeyboard = () => {
                if (document.activeElement === this.inputSearchDrawer) {
                    this.inputSearchDrawer.blur();
                }
            };
            searchDrawerBody.addEventListener('scroll', hideKeyboard, { passive: true });
            searchDrawerBody.addEventListener('touchmove', hideKeyboard, { passive: true });
        }

        if (this.btnClearSearchDrawer) {
            this.btnClearSearchDrawer.addEventListener('click', () => {
                if (this.inputSearchDrawer) this.inputSearchDrawer.value = '';
                this.btnClearSearchDrawer.classList.add('hidden');
                this.searchDrawerQuery = '';
                this.renderSearchDrawerDefault();
                if (this.inputSearchDrawer) this.inputSearchDrawer.focus();
            });
        }

        if (this.btnClearSearchWords) {
            this.btnClearSearchWords.onclick = () => this.clearSearchHistory();
        }

        // Explorer Scrollable Category Tabs Clicks (Video tabs)
        if (this.explorerTabAll) {
            this.explorerTabAll.addEventListener('click', (e) => {
                e.stopPropagation();
                this.currentPath = 'all';
                this.setActiveExplorerCategory('all');
            });
        }
        if (this.explorerTabPopular) {
            this.explorerTabPopular.addEventListener('click', (e) => {
                e.stopPropagation();
                this.currentPath = 'all';
                this.setActiveExplorerCategory('popular');
            });
        }
        if (this.explorerTabForYou) {
            this.explorerTabForYou.addEventListener('click', (e) => {
                e.stopPropagation();
                this.currentPath = 'all';
                this.setActiveExplorerCategory('foryou');
            });
        }
        if (this.explorerTabGDrive) {
            this.explorerTabGDrive.onclick = () => {
                this.currentPath = 'all';
                this.setActiveExplorerCategory('gdrive');
            };
        }
        if (this.explorerTabQueue) {
            this.explorerTabQueue.onclick = () => {
                this.setActiveExplorerCategory('queue');
            };
        }

        if (this.btnSelectAllSources) {
            this.btnSelectAllSources.addEventListener('click', (e) => {
                e.stopPropagation();
                const totalSrcCount = (this.sources && this.sources.length) || 0;
                if (this.selectedSourceIds.length === totalSrcCount || this.selectedSourceIds.length === 0) {
                    this.selectedSourceIds = [];
                } else {
                    this.selectedSourceIds = this.sources.map(s => s.id);
                }
                this.updateSourcesDropdownUI();
                this.fetchDirectory(this.currentPath);
            });
        }

        document.addEventListener('click', (e) => {
            if (this.sourcesDropdownMenu && !this.sourcesDropdownMenu.classList.contains('hidden')) {
                if (!e.target.closest('.explorer-tab-dropdown-wrapper')) {
                    this.closeSourcesDropdown();
                }
            }
        });

        if (this.listContainer) {
            // 3-Tier Hierarchy Horizontal Swipe (Boxes <-> Threads <-> Videos) - Thay thế cơ chế chuyển tab cũ
            let tabSwipeStartX = 0;
            let tabSwipeStartY = 0;
            let isTabSwiping = false;

            this.listContainer.addEventListener('touchstart', (e) => {
                if (e.touches && e.touches.length === 1) {
                    tabSwipeStartX = e.touches[0].clientX;
                    tabSwipeStartY = e.touches[0].clientY;
                    isTabSwiping = true;
                }
            }, { passive: true });

            this.listContainer.addEventListener('touchend', (e) => {
                if (!isTabSwiping) return;
                isTabSwiping = false;
                if (!e.changedTouches || e.changedTouches.length === 0) return;

                const endX = e.changedTouches[0].clientX;
                const endY = e.changedTouches[0].clientY;
                const deltaX = endX - tabSwipeStartX;
                const deltaY = endY - tabSwipeStartY;
                const absX = Math.abs(deltaX);
                const absY = Math.abs(deltaY);

                // Ngưỡng phát hiện vuốt ngang (> 50px và góc ngang trội hơn dọc 1.25 lần)
                if (absX > 50 && absX > absY * 1.25) {
                    if (deltaX > 0) {
                        // Vuốt từ TRÁI qua PHẢI -> Lùi cấp (Videos -> Threads -> Boxes)
                        if (!this.switchLibraryTab('left-to-right')) {
                            this.triggerHierarchySwipe('left-to-right');
                        }
                    } else if (deltaX < 0) {
                        // Vuốt từ PHẢI qua TRÁI -> Tiến cấp (Boxes -> Threads -> Videos)
                        if (!this.switchLibraryTab('right-to-left')) {
                            this.triggerHierarchySwipe('right-to-left');
                        }
                    }
                }
            }, { passive: true });
        }

        if (this.categoriesListContainer) {
            // Smooth Horizontal Swipe between Categories Tabs ['actresses', 'genres', 'studios']
            let catSwipeStartX = 0;
            let catSwipeStartY = 0;
            let isCatSwiping = false;
            let catSwipeTargetScrollEl = null;
            let catSwipeStartScrollLeft = 0;
            const catTabOrder = ['actresses', 'genres', 'studios'];

            this.categoriesListContainer.addEventListener('touchstart', (e) => {
                if (e.touches && e.touches.length === 1) {
                    catSwipeStartX = e.touches[0].clientX;
                    catSwipeStartY = e.touches[0].clientY;
                    isCatSwiping = true;

                    const touchTarget = e.target;
                    const scrollContainer = touchTarget ? touchTarget.closest('.entity-videos-scroll') : null;
                    if (scrollContainer && scrollContainer.scrollWidth > scrollContainer.clientWidth + 5) {
                        catSwipeTargetScrollEl = scrollContainer;
                        catSwipeStartScrollLeft = scrollContainer.scrollLeft;
                    } else {
                        catSwipeTargetScrollEl = null;
                        catSwipeStartScrollLeft = 0;
                    }
                }
            }, { passive: true });

            this.categoriesListContainer.addEventListener('touchend', (e) => {
                if (!isCatSwiping) return;
                isCatSwiping = false;
                if (!e.changedTouches || e.changedTouches.length === 0) return;

                const endX = e.changedTouches[0].clientX;
                const endY = e.changedTouches[0].clientY;
                const deltaX = endX - catSwipeStartX;
                const deltaY = endY - catSwipeStartY;
                const absX = Math.abs(deltaX);
                const absY = Math.abs(deltaY);

                if (catSwipeTargetScrollEl) {
                    const scrollEl = catSwipeTargetScrollEl;
                    const maxScrollLeft = scrollEl.scrollWidth - scrollEl.clientWidth;
                    catSwipeTargetScrollEl = null;

                    if (deltaX < 0) {
                        const wasAtEnd = catSwipeStartScrollLeft >= maxScrollLeft - 8;
                        const isAtEnd = scrollEl.scrollLeft >= maxScrollLeft - 8;
                        if (!wasAtEnd || !isAtEnd) return;
                    } else if (deltaX > 0) {
                        const wasAtStart = catSwipeStartScrollLeft <= 8;
                        const isAtStart = scrollEl.scrollLeft <= 8;
                        if (!wasAtStart || !isAtStart) return;
                    }
                }

                if (absX > 60 && absX > absY * 1.5) {
                    const currentIdx = catTabOrder.indexOf(this.activeCategoryTab);
                    if (currentIdx !== -1) {
                        if (deltaX < 0 && currentIdx < catTabOrder.length - 1) {
                            const nextTab = catTabOrder[currentIdx + 1];
                            this.categoriesListContainer.classList.remove('swiping-left', 'swiping-right');
                            void this.categoriesListContainer.offsetWidth;
                            this.categoriesListContainer.classList.add('swiping-left');
                            this.setActiveCategoryTab(nextTab);
                            setTimeout(() => {
                                if (this.categoriesListContainer) this.categoriesListContainer.classList.remove('swiping-left');
                            }, 250);
                        } else if (deltaX > 0 && currentIdx > 0) {
                            const prevTab = catTabOrder[currentIdx - 1];
                            this.categoriesListContainer.classList.remove('swiping-left', 'swiping-right');
                            void this.categoriesListContainer.offsetWidth;
                            this.categoriesListContainer.classList.add('swiping-right');
                            this.setActiveCategoryTab(prevTab);
                            setTimeout(() => {
                                if (this.categoriesListContainer) this.categoriesListContainer.classList.remove('swiping-right');
                            }, 250);
                        }
                    }
                }
            }, { passive: true });
        }

        if (this.btnAddSource) {
            this.btnAddSource.addEventListener('click', () => {
                this.handleAddSource();
            });
        }
        
        if (this.btnAddRcloneSource) {
            this.btnAddRcloneSource.addEventListener('click', () => {
                if (this.inputRcloneConf) {
                    this.inputRcloneConf.click();
                }
            });
        }
        
        if (this.inputRcloneConf) {
            this.inputRcloneConf.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                const formData = new FormData();
                formData.append('file', file);
                
                window.showToast('Đang tải lên file rclone config...', 'info', 0);
                
                fetch(`${this.backendHost}/api/rclone/upload_conf`, {
                    method: 'POST',
                    body: formData
                })
                .then(res => res.json())
                .then(res => {
                    const toast = document.getElementById('toast-container');
                    if (toast) toast.innerHTML = '';
                    
                    if (res.success) {
                        window.showToast('Upload file cấu hình thành công!', 'success');
                        this.toggleRclonePanel(true); // force fetch
                    } else {
                        window.showToast('Lỗi upload: ' + res.message, 'error');
                    }
                })
                .catch(err => {
                    window.showToast('Lỗi mạng: ' + err.message, 'error');
                });
                
                // clear input
                e.target.value = '';
            });
        }
        
        if (this.selectRcloneRemote) {
            this.selectRcloneRemote.addEventListener('change', () => {
                this.loadRcloneFolders();
            });
        }
        
        if (this.btnConfirmRclone) {
            this.btnConfirmRclone.addEventListener('click', () => {
                this.handleAddRcloneSource();
            });
        }



        // Bind User account drawer events
        if (this.btnOpenUser) {
            this.btnOpenUser.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openUserDrawer();
            });
        }

        if (this.btnCloseUserDrawer) {
            this.btnCloseUserDrawer.addEventListener('click', () => {
                this.closeUserDrawer();
            });
        }

        if (this.btnToggleUserAccount) {
            this.btnToggleUserAccount.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.userAccountSection) {
                    this.userAccountSection.classList.toggle('hidden');
                }
            });
        }

        if (this.userDrawerModal) {
            this.userDrawerModal.addEventListener('click', (e) => {
                if (e.target === this.userDrawerModal) {
                    this.closeUserDrawer();
                }
            });
        }

        if (this.authTabOtp) {
            this.authTabOtp.addEventListener('click', () => this.switchAuthTab('otp'));
        }

        if (this.authTabPassword) {
            this.authTabPassword.addEventListener('click', () => this.switchAuthTab('password'));
        }

        if (this.btnAuthSendOtp) {
            this.btnAuthSendOtp.addEventListener('click', () => this.handleSendOtp());
        }

        if (this.btnAuthVerifyOtp) {
            this.btnAuthVerifyOtp.addEventListener('click', () => this.handleVerifyOtp());
        }

        if (this.btnAuthResendOtp) {
            this.btnAuthResendOtp.addEventListener('click', () => this.handleSendOtp(true));
        }

        if (this.btnAuthReenterEmail) {
            this.btnAuthReenterEmail.addEventListener('click', () => {
                if (this.otpStepEmail) this.otpStepEmail.classList.remove('hidden');
                if (this.otpStepVerify) this.otpStepVerify.classList.add('hidden');
            });
        }

        if (this.btnAuthPassSubmit) {
            this.btnAuthPassSubmit.addEventListener('click', () => this.handlePasswordLogin());
        }

        if (this.btnAuthLogout) {
            this.btnAuthLogout.addEventListener('click', () => this.handleAuthLogout());
        }

        if (this.tabHistoryView) {
            this.tabHistoryView.addEventListener('click', () => this.switchHistoryTab('view'));
        }

        if (this.tabHistorySearch) {
            this.tabHistorySearch.addEventListener('click', () => this.switchHistoryTab('search'));
        }

        if (this.tabHistoryFavorite) {
            this.tabHistoryFavorite.addEventListener('click', () => this.switchHistoryTab('favorite'));
        }

        if (this.btnClearViewHistory) {
            this.btnClearViewHistory.addEventListener('click', () => this.clearViewHistory());
        }

        if (this.btnClearSearchHistory) {
            this.btnClearSearchHistory.addEventListener('click', () => this.clearSearchHistory());
        }

        // Page Jump Drawer Events
        if (this.btnClosePageJumpDrawer) {
            this.btnClosePageJumpDrawer.addEventListener('click', () => this.closePageJumpModal());
        }

        if (this.pageJumpModal) {
            this.pageJumpModal.addEventListener('click', (e) => {
                if (e.target === this.pageJumpModal) {
                    this.closePageJumpModal();
                }
            });
        }

        if (this.btnPageJumpGo) {
            this.btnPageJumpGo.addEventListener('click', () => this.handlePageJumpInputSubmit());
        }

        if (this.pageJumpInput) {
            this.pageJumpInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.handlePageJumpInputSubmit();
                }
            });
        }

        const stepBtns = document.querySelectorAll('.page-jump-step-btn');
        stepBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const step = btn.getAttribute('data-step');
                this.handlePageJumpStep(step);
            });
        });

        this.bindSwipeDownToCloseAllDrawers();
    }

    bindSwipeDownToCloseAllDrawers() {
        const drawerMappings = [
            {
                modalId: 'explorer-modal',
                cardSelector: '.explorer-drawer',
                closeBtnId: 'btn-close-explorer'
            },
            {
                modalId: 'categories-drawer-modal',
                cardSelector: '.explorer-drawer',
                closeBtnId: 'btn-close-categories'
            },
            {
                modalId: 'source-drawer-modal',
                cardSelector: '.explorer-drawer',
                closeBtnId: 'btn-close-source-drawer'
            },
            {
                modalId: 'user-drawer-modal',
                cardSelector: '.explorer-drawer',
                closeBtnId: 'btn-close-user-drawer'
            },
            {
                modalId: 'search-drawer-modal',
                cardSelector: '.search-drawer',
                closeBtnId: 'btn-close-search-drawer'
            },
            {
                modalId: 'source-menu-modal',
                cardSelector: '.source-menu-drawer',
                closeBtnId: 'btn-close-source-menu'
            },
            {
                modalId: 'sources-tools-modal',
                cardSelector: '.source-menu-drawer',
                closeBtnId: 'btn-close-sources-tools-menu'
            },
            {
                modalId: 'gesture-guide-modal',
                cardSelector: '.gesture-guide-card',
                closeBtnId: 'btn-close-gesture-guide'
            },
            {
                modalId: 'settings-drawer-modal',
                cardSelector: '.settings-drawer',
                closeBtnId: 'btn-close-settings-drawer'
            },
            {
                modalId: 'gdrive-drawer-modal',
                cardSelector: '.gdrive-drawer',
                closeBtnId: 'btn-close-gdrive-drawer'
            },
            {
                modalId: 'stream-source-drawer-modal',
                cardSelector: '.source-menu-drawer',
                closeBtnId: 'btn-close-stream-source-drawer'
            },
            {
                modalId: 'page-jump-drawer-modal',
                cardSelector: '.page-jump-drawer',
                closeBtnId: 'btn-close-page-jump-drawer'
            }
        ];

        drawerMappings.forEach(mapping => {
            const modalEl = document.getElementById(mapping.modalId);
            if (!modalEl) return;
            const cardEl = modalEl.querySelector(mapping.cardSelector);
            const closeBtn = document.getElementById(mapping.closeBtnId);
            if (!cardEl || !closeBtn) return;

            let startY = 0;
            let startX = 0;
            let isDragging = false;
            let hasScrollConflict = false;

            cardEl.addEventListener('touchstart', (e) => {
                if (e.touches.length !== 1) return;
                
                // Reset state
                startY = e.touches[0].clientY;
                startX = e.touches[0].clientX;
                isDragging = false;
            }, { passive: true });

            cardEl.addEventListener('touchmove', (e) => {
                if (e.touches.length !== 1) return;

                const currentY = e.touches[0].clientY;
                const currentX = e.touches[0].clientX;
                const deltaY = currentY - startY;
                const absDeltaY = Math.abs(deltaY);
                const absDeltaX = Math.abs(currentX - startX);

                // Check if user is inside a horizontal list (tabs, sort bar, entity video scroll row)
                let isInsideHorizontalScroll = false;
                let hCheck = e.target;
                while (hCheck && hCheck !== cardEl) {
                    if (hCheck.classList && (hCheck.classList.contains('explorer-scrollable-tabs') || hCheck.classList.contains('entity-videos-scroll') || hCheck.classList.contains('explorer-sort-bar'))) {
                        isInsideHorizontalScroll = true;
                        break;
                    }
                    hCheck = hCheck.parentElement;
                }

                // If user is inside a horizontal scroller and gesture is predominantly horizontal (cuộn ngang video/tags)
                if (isInsideHorizontalScroll && absDeltaX > absDeltaY) {
                    // Let native horizontal scroll proceed smoothly, don't drag drawer
                    if (isDragging) {
                        isDragging = false;
                        cardEl.style.transform = '';
                        modalEl.style.backgroundColor = '';
                    }
                    return;
                }

                // Dynamically check vertical scroll conflict: if any scrollable parent of e.target inside cardEl is scrolled down
                let current = e.target;
                let currentScrollTop = 0;
                while (current && current !== cardEl) {
                    const style = window.getComputedStyle(current);
                    const overflowY = style.overflowY;
                    if (overflowY === 'auto' || overflowY === 'scroll') {
                        currentScrollTop = current.scrollTop;
                        if (currentScrollTop > 0) {
                            break;
                        }
                    }
                    current = current.parentElement;
                }

                // If scroll position is not at the top (đang xem ở giữa danh sách dọc), let the list scroll naturally and don't drag drawer down
                if (currentScrollTop > 0) {
                    if (isDragging) {
                        isDragging = false;
                        cardEl.style.transform = '';
                        modalEl.style.backgroundColor = '';
                    }
                    return;
                }

                // If user is touching inside explorer-list and we can pull-to-prev page (currentPage > 1), don't dismiss drawer
                if (mapping.modalId === 'explorer-modal' && this.listContainer && this.listContainer.contains(e.target)) {
                    if (this.currentPage > 1 && deltaY > 0) {
                        if (isDragging) {
                            isDragging = false;
                            cardEl.style.transform = '';
                            modalEl.style.backgroundColor = '';
                        }
                        return;
                    }
                }

                // Start dragging drawer to dismiss if movement is mostly downwards and > 10px
                if (!isDragging) {
                    if (deltaY > 10 && deltaY > absDeltaX * 1.2) {
                        isDragging = true;
                        cardEl.style.transition = 'none';
                    }
                }

                if (isDragging) {
                    if (deltaY > 0) {
                        cardEl.style.transform = `translateY(${deltaY}px)`;
                        
                        // Slowly fade out background overlay (simulate dragging feel)
                        const opacity = Math.max(0, 1 - (deltaY / 300));
                        modalEl.style.backgroundColor = `rgba(0, 0, 0, ${opacity * 0.55})`;
                    } else {
                        // Prevent dragging upwards beyond normal position
                        cardEl.style.transform = 'translateY(0px)';
                        isDragging = false;
                    }
                    
                    // Prevent page/container scrolling while actively dragging the drawer
                    if (e.cancelable) {
                        e.preventDefault();
                    }
                }
            }, { passive: false });

            cardEl.addEventListener('touchend', (e) => {
                const endX = e.changedTouches && e.changedTouches.length > 0 ? e.changedTouches[0].clientX : startX;
                const endY = e.changedTouches && e.changedTouches.length > 0 ? e.changedTouches[0].clientY : startY;
                const deltaX = endX - startX;
                const deltaY = endY - startY;
                const absDeltaX = Math.abs(deltaX);
                const absDeltaY = Math.abs(deltaY);

                // Swipe horizontal in explorer modal (absDeltaX > 50 and absDeltaX > absDeltaY * 1.25)
                if (mapping.modalId === 'explorer-modal' && absDeltaX > 50 && absDeltaX > absDeltaY * 1.25) {
                    if (deltaX > 0) {
                        this.triggerHierarchySwipe('left-to-right');
                        return;
                    } else if (deltaX < 0) {
                        this.triggerHierarchySwipe('right-to-left');
                        return;
                    }
                }

                if (!isDragging) return;
                isDragging = false;

                // Reset styles
                cardEl.style.transition = '';
                cardEl.style.transform = '';
                modalEl.style.backgroundColor = '';

                // If dragged down past threshold (e.g. 120px), trigger close button
                if (deltaY > 120) {
                    closeBtn.click();
                }
            }, { passive: true });
        });
    }

    initObservers() {
        if (typeof IntersectionObserver === 'undefined') return;
        if (this.topObserver) this.topObserver.disconnect();
        if (this.bottomObserver) this.bottomObserver.disconnect();
    }

    initPaginationSwipe() {
        if (!this.listContainer) return;
        
        let wheelTimeout;
        let accumDeltaY = 0;
        
        // Handle desktop wheel
        this.listContainer.addEventListener('wheel', (e) => {
            if (this.isLoading || this.currentViewLevel !== 'videos' || this.activeTab !== 'videos') return;
            const atTop = this.listContainer.scrollTop <= 1;
            const atBottom = Math.ceil(this.listContainer.scrollTop + this.listContainer.clientHeight) >= this.listContainer.scrollHeight - 2;
            
            if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) {
                accumDeltaY += e.deltaY;
                
                clearTimeout(wheelTimeout);
                wheelTimeout = setTimeout(() => {
                    if (accumDeltaY > 150 && this.currentPage < this.totalPages) {
                        this.goToPage(this.currentPage + 1, { autoScroll: true });
                    } else if (accumDeltaY < -150 && this.currentPage > 1) {
                        this.goToPage(this.currentPage - 1, { autoScroll: true });
                    }
                    accumDeltaY = 0;
                }, 150);
            } else {
                accumDeltaY = 0;
            }
        }, { passive: true });

        // Handle mobile touch
        let touchStartY = 0;
        let touchCurrentY = 0;
        let isAtBoundaryOnStart = false;
        
        this.listContainer.addEventListener('touchstart', (e) => {
            if (e.touches.length > 0) {
                touchStartY = e.touches[0].clientY;
                touchCurrentY = touchStartY;
                const atTop = this.listContainer.scrollTop <= 1;
                const atBottom = Math.ceil(this.listContainer.scrollTop + this.listContainer.clientHeight) >= this.listContainer.scrollHeight - 2;
                isAtBoundaryOnStart = atTop || atBottom;
            }
        }, { passive: true });
        
        this.listContainer.addEventListener('touchmove', (e) => {
            if (e.touches.length > 0) touchCurrentY = e.touches[0].clientY;
        }, { passive: true });

        this.listContainer.addEventListener('touchend', (e) => {
            if (this.isLoading || this.currentViewLevel !== 'videos' || this.activeTab !== 'videos') return;
            if (touchStartY === 0 || touchCurrentY === 0 || !isAtBoundaryOnStart) return;
            
            const deltaY = touchStartY - touchCurrentY; // Positive = swiping up (scrolling list down)
            const atTop = this.listContainer.scrollTop <= 1;
            const atBottom = Math.ceil(this.listContainer.scrollTop + this.listContainer.clientHeight) >= this.listContainer.scrollHeight - 2;

            if (atBottom && deltaY > 60 && this.currentPage < this.totalPages) {
                this.goToPage(this.currentPage + 1, { autoScroll: true });
            } else if (atTop && deltaY < -60 && this.currentPage > 1) {
                this.goToPage(this.currentPage - 1, { autoScroll: true });
            }
            touchStartY = 0;
            touchCurrentY = 0;
        }, { passive: true });
    }

    /* ==========================================================================
       PAGE NAVIGATION & PULL-TO-PAGINATE ENGINE
       ========================================================================== */
    clearPageCache() {
        this.pageCache = {};
        if (this.pagePreloadPromises) this.pagePreloadPromises = {};
    }

    preloadPage(pageNum) {
        if (!this.pageCache) this.pageCache = {};
        pageNum = parseInt(pageNum, 10);
        if (isNaN(pageNum) || pageNum < 1 || (this.totalPages > 0 && pageNum > this.totalPages)) {
            return Promise.resolve(null);
        }
        if (this.pageCache[pageNum] && this.pageCache[pageNum].length > 0) {
            return Promise.resolve(this.pageCache[pageNum]);
        }
        if (this.pagePreloadPromises && this.pagePreloadPromises[pageNum]) {
            return this.pagePreloadPromises[pageNum];
        }
        if (!this.pagePreloadPromises) this.pagePreloadPromises = {};

        const offset = (pageNum - 1) * this.pageSize;
        const params = new URLSearchParams();
        if (this.currentPath && this.currentPath !== 'all') params.append('path', this.currentPath);
        params.append('sort_by', this.sortKey);
        params.append('sort_asc', this.sortAsc);
        params.append('limit', this.pageSize);
        params.append('offset', offset);
        params.append('page', pageNum);
        if (this.searchQuery) params.append('q', this.searchQuery);
        const hasEntityFilter = !!(this.filterActress || this.filterGenre || this.filterStudio);
        const shouldApplyCoverFilter = this.activeExplorerCategory === 'all' && !hasEntityFilter;
        if (this.filterHasCover && shouldApplyCoverFilter) params.append('filter_has_cover', 'true');
        if (this.filterNoCover) params.append('filter_no_cover', 'true');
        if (this.filterNoIdx) params.append('filter_no_idx', 'true');
        if (this.filterUnviewed) params.append('filter_unviewed', 'true');
        if (this.activeExplorerCategory === 'queue') params.append('filter', 'in_queue');
        if (this.activeExplorerCategory === 'gdrive') params.append('filter', 'has_gdrive');
        if (this.filterActress) params.append('actresses', this.filterActress);
        if (this.filterGenre) params.append('genres', this.filterGenre);
        if (this.filterStudio) params.append('studios', this.filterStudio);

        if (this.activeExplorerCategory === 'popular') {
            params.set('sort_by', 'popular');
            params.set('sort_asc', 'false');
        } else if (this.activeExplorerCategory === 'foryou') {
            params.set('sort_by', 'random');
        }
        let url = `${this.backendHost}/api/videos?${params.toString()}`;

        this.pagePreloadPromises[pageNum] = fetch(url, { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                if (data && data.success && Array.isArray(data.videos)) {
                    this.pageCache[pageNum] = data.videos;
                    if (data.totalPages) this.totalPages = data.totalPages;
                    if (data.total) this.totalVideos = data.total;
                    return data.videos;
                }
                return null;
            })
            .catch(() => null)
            .finally(() => {
                if (this.pagePreloadPromises) delete this.pagePreloadPromises[pageNum];
            });

        return this.pagePreloadPromises[pageNum];
    }

    goToPage(pageNum, options = {}) {
        pageNum = parseInt(pageNum, 10);
        if (isNaN(pageNum) || pageNum < 1) pageNum = 1;
        if (this.totalPages > 0 && pageNum > this.totalPages) pageNum = this.totalPages;

        if (this.currentPage === pageNum && !options.force) {
            return;
        }

        this.currentPage = pageNum;
        if (this.listContainer) {
            this.listContainer.scrollTop = 0;
        }
        
        this.updatePageInHash(pageNum);

        // Nếu trang đã có trong pageCache, render ngay tức thì 0ms latency
        if (this.pageCache && this.pageCache[pageNum] && this.pageCache[pageNum].length > 0) {
            this.videos = this.pageCache[pageNum];
            this.loadedStartOffset = (pageNum - 1) * this.pageSize;
            this.loadedEndOffset = this.loadedStartOffset + this.videos.length;
            this.renderList();
            if (options.autoScroll) {
                setTimeout(() => this.scrollToPlayingVideo(), 50);
            }
            return;
        }

        this.fetchDirectory(this.currentPath, { page: this.currentPage, autoScroll: !!options.autoScroll });
    }

    changePageSize(newSize) {
        newSize = parseInt(newSize, 10);
        if (![12, 24, 36, 48, 60].includes(newSize)) newSize = 48;
        this.pageSize = newSize;
        localStorage.setItem('missav_page_size', String(newSize));
        this.currentPage = 1;
        this.fetchDirectory(this.currentPath, { page: 1, autoScroll: false });
    }

    closePageJumpModal() {
        if (this.pageJumpModal) {
            this.pageJumpModal.classList.add('hidden');
        }
        // Phục hồi lại modal cha nếu trước đó đã mở từ modal đó
        if (this.pageJumpParentDrawer === 'explorer' && this.modalEl) {
            this.modalEl.classList.remove('hidden');
        } else if (this.pageJumpParentDrawer === 'categories' && this.categoriesModal) {
            this.categoriesModal.classList.remove('hidden');
        }
    }

    handlePageJumpInputSubmit() {
        if (!this.pageJumpInput) return;
        const ctx = this.activePageJumpContext || {
            currentPage: this.currentPage,
            totalPages: this.totalPages,
            onJump: (p) => this.goToPage(p)
        };
        const totalPages = Math.max(1, ctx.totalPages || 1);
        const val = parseInt(this.pageJumpInput.value.trim(), 10);
        if (!isNaN(val) && val >= 1 && val <= totalPages) {
            this.closePageJumpModal();
            if (typeof ctx.onJump === 'function') {
                ctx.onJump(val);
            }
        } else {
            window.showToast?.(`Vui lòng nhập trang hợp lệ từ 1 đến ${totalPages}!`, 'warning');
            this.pageJumpInput.focus();
        }
    }

    handlePageJumpStep(step) {
        const ctx = this.activePageJumpContext || {
            currentPage: this.currentPage,
            totalPages: this.totalPages,
            onJump: (p) => this.goToPage(p)
        };
        const currentPage = Math.max(1, ctx.currentPage || 1);
        const totalPages = Math.max(1, ctx.totalPages || 1);
        let targetPage = currentPage;
        if (step === 'first') {
            targetPage = 1;
        } else if (step === 'last') {
            targetPage = totalPages;
        } else if (step === '-10') {
            targetPage = Math.max(1, currentPage - 10);
        } else if (step === '-5') {
            targetPage = Math.max(1, currentPage - 5);
        } else if (step === '-3') {
            targetPage = Math.max(1, currentPage - 3);
        } else if (step === '+3') {
            targetPage = Math.min(totalPages, currentPage + 3);
        } else if (step === '+5') {
            targetPage = Math.min(totalPages, currentPage + 5);
        } else if (step === '+10') {
            targetPage = Math.min(totalPages, currentPage + 10);
        }

        this.closePageJumpModal();
        if (typeof ctx.onJump === 'function') {
            ctx.onJump(targetPage);
        }
    }

    openPageJumpModal(options = null) {
        if (!this.pageJumpModal) return;

        // Lưu lại drawer cha đang mở trước khi mở pageJump modal
        if (this.modalEl && !this.modalEl.classList.contains('hidden')) {
            this.pageJumpParentDrawer = 'explorer';
        } else if (this.categoriesModal && !this.categoriesModal.classList.contains('hidden')) {
            this.pageJumpParentDrawer = 'categories';
        } else {
            this.pageJumpParentDrawer = null;
        }

        // Đóng các drawer khác ngoại trừ modal cha và pageJump
        this.closeAllDrawers('pageJump');

        const ctx = options || {
            currentPage: this.currentPage,
            totalPages: this.totalPages,
            totalItems: this.totalVideos,
            unitLabel: 'video',
            onJump: (p) => this.goToPage(p)
        };
        this.activePageJumpContext = ctx;

        const currentPage = Math.max(1, ctx.currentPage || 1);
        const totalPages = Math.max(1, ctx.totalPages || 1);
        const totalItems = ctx.totalItems !== undefined ? ctx.totalItems : this.totalVideos;
        const unitLabel = ctx.unitLabel || 'video';

        // Update Header & Badge Information
        if (this.pageJumpCurrentBadge) {
            this.pageJumpCurrentBadge.textContent = `Trang ${currentPage} / ${totalPages}`;
        }
        if (this.pageJumpTotalText) {
            this.pageJumpTotalText.textContent = `Tổng: ${totalItems.toLocaleString('vi-VN')} ${unitLabel}`;
        }
        if (this.pageJumpInput) {
            this.pageJumpInput.value = currentPage;
            this.pageJumpInput.max = totalPages;
        }

        // Render Page Grid Buttons
        if (this.pageJumpGrid) {
            this.pageJumpGrid.innerHTML = '';
            const frag = document.createDocumentFragment();
            let activeCell = null;

            for (let p = 1; p <= totalPages; p++) {
                const cell = document.createElement('button');
                cell.className = 'page-jump-cell';
                if (p === currentPage) {
                    cell.classList.add('active');
                    activeCell = cell;
                }
                cell.textContent = String(p);
                cell.title = `Chuyển đến trang ${p}`;
                cell.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.closePageJumpModal();
                    if (typeof ctx.onJump === 'function') {
                        ctx.onJump(p);
                    }
                });
                frag.appendChild(cell);
            }
            this.pageJumpGrid.appendChild(frag);

            // Open Modal
            this.pageJumpModal.classList.remove('hidden');

            // Auto-focus & smooth scroll to current active page
            requestAnimationFrame(() => {
                if (activeCell) {
                    activeCell.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
                }
            });
        } else {
            this.pageJumpModal.classList.remove('hidden');
        }
    }

    createPaginationBar(options = {}) {
        const isTop = (typeof options === 'string' ? options === 'top' : options.position === 'top');
        const opts = (typeof options === 'object' && options !== null) ? options : {};
        const currentPage = Math.max(1, opts.currentPage || this.currentPage || 1);
        const totalPages = Math.max(1, opts.totalPages || this.totalPages || 1);
        const totalItems = opts.totalItems !== undefined ? opts.totalItems : this.totalVideos;
        const pageSize = opts.pageSize || this.pageSize || 12;
        const pageSizeOptions = opts.pageSizeOptions || [12, 24, 36, 48, 60];
        const unitLabel = opts.unitLabel || 'video';
        const onPageChange = opts.onPageChange || ((p) => this.goToPage(p));
        const onPageSizeChange = opts.onPageSizeChange || ((s) => this.changePageSize(s));

        const bar = document.createElement('div');
        bar.className = `explorer-pagination-bar ${isTop ? 'top-bar' : 'bottom-bar'}`;

        const isFirstDisabled = currentPage <= 1;
        const isLastDisabled = currentPage >= totalPages;

        const navGroup = document.createElement('div');
        navGroup.className = 'pagination-nav-group';

        // First Page button
        const btnFirst = document.createElement('button');
        btnFirst.className = 'pagination-btn btn-first-page';
        btnFirst.disabled = isFirstDisabled;
        btnFirst.title = 'Về trang đầu';
        btnFirst.innerHTML = `<span class="material-symbols-outlined">first_page</span>`;
        btnFirst.addEventListener('click', (e) => {
            e.stopPropagation();
            onPageChange(1);
        });

        // Prev Page button
        const btnPrev = document.createElement('button');
        btnPrev.className = 'pagination-btn btn-prev-page';
        btnPrev.disabled = isFirstDisabled;
        btnPrev.title = 'Trang trước';
        btnPrev.innerHTML = `<span class="material-symbols-outlined">chevron_left</span><span>Trước</span>`;
        btnPrev.addEventListener('click', (e) => {
            e.stopPropagation();
            onPageChange(currentPage - 1);
        });

        // Current Page Indicator / Jump button
        const btnCurrent = document.createElement('button');
        btnCurrent.className = 'pagination-info-btn';
        btnCurrent.title = 'Bấm để mở danh sách trang nhảy đến';
        btnCurrent.innerHTML = `<span>Trang <strong>${currentPage}</strong> / ${totalPages}</span><span class="material-symbols-outlined page-jump-icon">grid_view</span>`;
        btnCurrent.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openPageJumpModal({
                currentPage,
                totalPages,
                totalItems,
                unitLabel,
                onJump: (p) => onPageChange(p)
            });
        });

        // Next Page button
        const btnNext = document.createElement('button');
        btnNext.className = 'pagination-btn btn-next-page';
        btnNext.disabled = isLastDisabled;
        btnNext.title = 'Trang kế tiếp';
        btnNext.innerHTML = `<span>Sau</span><span class="material-symbols-outlined">chevron_right</span>`;
        btnNext.addEventListener('click', (e) => {
            e.stopPropagation();
            onPageChange(currentPage + 1);
        });

        // Last Page button
        const btnLast = document.createElement('button');
        btnLast.className = 'pagination-btn btn-last-page';
        btnLast.disabled = isLastDisabled;
        btnLast.title = 'Đến trang cuối';
        btnLast.innerHTML = `<span class="material-symbols-outlined">last_page</span>`;
        btnLast.addEventListener('click', (e) => {
            e.stopPropagation();
            onPageChange(totalPages);
        });

        navGroup.appendChild(btnFirst);
        navGroup.appendChild(btnPrev);
        navGroup.appendChild(btnCurrent);
        navGroup.appendChild(btnNext);
        navGroup.appendChild(btnLast);

        bar.appendChild(navGroup);
        return bar;
    }


    getGroupedVideoItems() {
        const rawVideos = [...this.videos];
        const map = new Map();
        rawVideos.forEach(v => {
            if (!v) return;
            const displayName = v.title || v.name || v.code || 'Video';
            const uniqueKey = v.code ? v.code.trim().toUpperCase() : (v.path || v.full_path || displayName).toLowerCase();
            if (!map.has(uniqueKey)) {
                map.set(uniqueKey, {
                    name: displayName,
                    size: v.size,
                    size_formatted: v.size_formatted,
                    mtime: v.mtime,
                    code: v.code || '',
                    title: v.title || '',
                    description: v.description || '',
                    release_date: v.release_date || '',
                    actress: v.actress || '',
                    genres: v.genres || '',
                    series: v.series || '',
                    maker: v.maker || '',
                    label: v.label || '',
                    cover_url: v.cover_url || '',
                    cover_base64: v.cover_base64 || '',
                    sources: [v],
                    selectedSourceIndex: 0
                });
            } else {
                map.get(uniqueKey).sources.push(v);
            }
        });
        const items = Array.from(map.values());
        items.forEach(item => {
            if (this.currentPlayingFilename) {
                const foundIdx = item.sources.findIndex(s => 
                    s.name === this.currentPlayingFilename || 
                    s.name.toLowerCase() === this.currentPlayingFilename.toLowerCase()
                );
                if (foundIdx !== -1) {
                    item.selectedSourceIndex = foundIdx;
                }
            }
        });
        return items;
    }


    setCurrentPlayingFilename(filename) {
        this.currentPlayingFilename = filename || '';
        this.isAutoWindowSet = false;
        this.hasFocusedPlaying = false;
        if (!this.modalEl.classList.contains('hidden') && this.activeTab === 'videos' && this.currentViewLevel === 'videos') {
            this.renderList();
        }
    }

    closeAllDrawers(except = null) {
        if (except !== 'explorer' && !(except === 'pageJump' && this.pageJumpParentDrawer === 'explorer') && this.modalEl && !this.modalEl.classList.contains('hidden')) {
            this.modalEl.classList.add('hidden');
        }
        if (except !== 'categories' && !(except === 'pageJump' && this.pageJumpParentDrawer === 'categories') && this.categoriesModal && !this.categoriesModal.classList.contains('hidden')) {
            this.categoriesModal.classList.add('hidden');
        }
        if (except !== 'search' && this.searchDrawerModal && !this.searchDrawerModal.classList.contains('hidden')) {
            this.searchDrawerModal.classList.add('hidden');
        }
        if (except !== 'sources' && this.sourceDrawerModal && !this.sourceDrawerModal.classList.contains('hidden')) {
            this.sourceDrawerModal.classList.add('hidden');
        }
        if (except !== 'user' && this.userDrawerModal && !this.userDrawerModal.classList.contains('hidden')) {
            this.userDrawerModal.classList.add('hidden');
        }
        if (except !== 'sourceTools' && this.sourcesToolsModal && !this.sourcesToolsModal.classList.contains('hidden')) {
            this.sourcesToolsModal.classList.add('hidden');
        }
        if (except !== 'sourceItem' && this.sourceMenuModal && !this.sourceMenuModal.classList.contains('hidden')) {
            this.sourceMenuModal.classList.add('hidden');
        }
        const gestureModal = document.getElementById('gesture-guide-modal');
        if (except !== 'gesture' && gestureModal && !gestureModal.classList.contains('hidden')) {
            gestureModal.classList.add('hidden');
        }
        const settingsModal = document.getElementById('settings-drawer-modal');
        if (except !== 'settings' && settingsModal && !settingsModal.classList.contains('hidden')) {
            settingsModal.classList.add('hidden');
        }
        const gdriveModal = document.getElementById('gdrive-drawer-modal');
        if (except !== 'gdrive' && gdriveModal && !gdriveModal.classList.contains('hidden')) {
            gdriveModal.classList.add('hidden');
        }
        const streamSourceModal = document.getElementById('stream-source-drawer-modal');
        if (except !== 'streamSource' && streamSourceModal && !streamSourceModal.classList.contains('hidden')) {
            streamSourceModal.classList.add('hidden');
        }
        if (except !== 'pageJump' && this.pageJumpModal && !this.pageJumpModal.classList.contains('hidden')) {
            this.pageJumpModal.classList.add('hidden');
        }
    }

    checkAndClearRouteIfAllClosed() {
        const anyOpen = !!document.querySelector(
            '#explorer-modal:not(.hidden), #categories-drawer-modal:not(.hidden), #search-drawer-modal:not(.hidden), ' +
            '#source-drawer-modal:not(.hidden), #user-drawer-modal:not(.hidden), #settings-drawer-modal:not(.hidden), #gdrive-drawer-modal:not(.hidden), #stream-source-drawer-modal:not(.hidden)'
        );
        if (!anyOpen) {
            if (this.currentPlayingFilename) {
                const code = String(this.currentPlayingFilename).trim().toUpperCase();
                if (code && window.location.pathname !== `/${code}`) {
                    window.history.replaceState(null, '', `/${code}`);
                }
            }
            if (window.location.hash) {
                window.history.replaceState(null, '', window.location.pathname);
            }
        }
    }

    openCategoriesDrawer(tab = 'genres', query = '', entityName = '') {
        this.closeAllDrawers('categories');
        if (this.categoriesModal) {
            this.categoriesModal.classList.remove('hidden');
            if (this.inputSearchCategories) {
                this.inputSearchCategories.value = query || '';
            }
            if (this.categoriesSearchWrapper) {
                if (query) {
                    this.categoriesSearchWrapper.classList.add('active');
                } else {
                    this.categoriesSearchWrapper.classList.remove('active');
                }
            }
            if (this.btnClearCategoriesSearch) {
                if (query) {
                    this.btnClearCategoriesSearch.classList.remove('hidden');
                } else {
                    this.btnClearCategoriesSearch.classList.add('hidden');
                }
            }
            this.setActiveCategoryTab(tab, query, entityName);
            this.fetchCategoryCounts();
        }
    }

    closeCategoriesDrawer() {
        if (this.categoriesModal) {
            this.categoriesModal.classList.add('hidden');
        }
        this.checkAndClearRouteIfAllClosed();
    }

    setActiveCategoryTab(tab, query = '', entityName = '') {
        this.activeCategoryTab = tab || 'genres';

        if (this.categoriesHeaderTitle && this.categoriesHeaderIcon) {
            if (this.activeCategoryTab === 'genres') {
                this.categoriesHeaderIcon.innerText = 'category';
                this.categoriesHeaderTitle.innerText = 'Chuyên mục (Boxes)';
            } else if (this.activeCategoryTab === 'actresses') {
                this.categoriesHeaderIcon.innerText = 'person_search';
                this.categoriesHeaderTitle.innerText = 'Diễn viên';
            } else if (this.activeCategoryTab === 'studios') {
                this.categoriesHeaderIcon.innerText = 'video_camera_front';
                this.categoriesHeaderTitle.innerText = 'Studios';
            }
        }

        [
            { el: this.categoryTabActresses, name: 'actresses' },
            { el: this.categoryTabGenres, name: 'genres' },
            { el: this.categoryTabStudios, name: 'studios' }
        ].forEach(item => {
            if (item.el) {
                item.el.classList.toggle('active', item.name === this.activeCategoryTab);
                if (item.name === this.activeCategoryTab) {
                    try {
                        item.el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                    } catch (e) {}
                }
            }
        });

        this.updateCategoriesSortUI();

        if (entityName) {
            this.fetchAndRenderEntityDetail(this.activeCategoryTab, entityName, this.categoriesListContainer, true);
        } else {
            const q = query !== '' ? query : (this.categoriesSearchQuery || '');
            this.fetchAndRenderExplorerEntities(this.activeCategoryTab, q, this.categoriesListContainer, true);
            if (q) {
                this.updateRoute(this.activeCategoryTab, '', { q: q });
            } else {
                this.updateRoute(this.activeCategoryTab);
            }
        }
    }

    handleCategoryTabSortChange(key) {
        const cat = this.activeCategoryTab;
        const state = this.entityState[cat] || (this.entityState[cat] = { sortKey: 'total_videos', sortAsc: false, currentPage: 1, pageSize: 48, total: 0, totalPages: 1, items: [], inDetailView: false });

        if (state.inDetailView && this.entityDetailState && this.entityDetailState.name) {
            const detailSortKey = key === 'total_videos' ? 'size' : key;
            this.handleEntityDetailSortChange(detailSortKey, this.categoriesListContainer);
            return;
        }

        if (state.sortKey === key) {
            state.sortAsc = !state.sortAsc;
        } else {
            state.sortKey = key;
            state.sortAsc = (key === 'name');
        }

        this.updateCategoriesSortUI();
        this.fetchAndRenderExplorerEntities(cat, this.categoriesSearchQuery || null, this.categoriesListContainer, true);
    }

    updateCategoriesSortUI() {
        const cat = this.activeCategoryTab;
        const state = this.entityState[cat] || (this.entityState[cat] = { sortKey: 'total_videos', sortAsc: false, currentPage: 1, pageSize: 48, total: 0, totalPages: 1, items: [], inDetailView: false });

        if (state.inDetailView && this.entityDetailState) {
            const dState = this.entityDetailState;
            if (this.btnCategoriesSortRelease) this.btnCategoriesSortRelease.classList.toggle('active', dState.sortKey === 'release_date');
            if (this.btnCategoriesSortName) this.btnCategoriesSortName.classList.toggle('active', dState.sortKey === 'name');
            if (this.btnCategoriesSortViews) {
                this.btnCategoriesSortViews.classList.toggle('active', dState.sortKey === 'size');
                const spanLabel = this.btnCategoriesSortViews.querySelector('span:not(.material-symbols-outlined)');
                if (spanLabel) spanLabel.innerText = 'Kích thước';
            }

            if (this.iconCategoriesSortRelease) this.iconCategoriesSortRelease.innerText = dState.sortKey === 'release_date' ? (dState.sortAsc ? 'arrow_upward' : 'arrow_downward') : 'swap_vert';
            if (this.iconCategoriesSortName) this.iconCategoriesSortName.innerText = dState.sortKey === 'name' ? (dState.sortAsc ? 'arrow_upward' : 'arrow_downward') : 'swap_vert';
            if (this.iconCategoriesSortViews) this.iconCategoriesSortViews.innerText = dState.sortKey === 'size' ? (dState.sortAsc ? 'arrow_upward' : 'arrow_downward') : 'swap_vert';

            if (this.btnCategoriesFilterNoCover) {
                this.btnCategoriesFilterNoCover.style.display = '';
                this.btnCategoriesFilterNoCover.classList.toggle('active', !!dState.filterNoCover);
            }
        } else {
            if (this.btnCategoriesSortRelease) this.btnCategoriesSortRelease.classList.toggle('active', state.sortKey === 'release_date');
            if (this.btnCategoriesSortName) this.btnCategoriesSortName.classList.toggle('active', state.sortKey === 'name');
            if (this.btnCategoriesSortViews) {
                this.btnCategoriesSortViews.classList.toggle('active', state.sortKey === 'total_videos');
                const spanLabel = this.btnCategoriesSortViews.querySelector('span:not(.material-symbols-outlined)');
                if (spanLabel) spanLabel.innerText = 'Số lượng';
            }

            if (this.iconCategoriesSortRelease) this.iconCategoriesSortRelease.innerText = state.sortKey === 'release_date' ? (state.sortAsc ? 'arrow_upward' : 'arrow_downward') : 'swap_vert';
            if (this.iconCategoriesSortName) this.iconCategoriesSortName.innerText = state.sortKey === 'name' ? (state.sortAsc ? 'arrow_upward' : 'arrow_downward') : 'swap_vert';
            if (this.iconCategoriesSortViews) this.iconCategoriesSortViews.innerText = state.sortKey === 'total_videos' ? (state.sortAsc ? 'arrow_upward' : 'arrow_downward') : 'swap_vert';

            if (this.btnCategoriesFilterNoCover) {
                this.btnCategoriesFilterNoCover.style.display = 'none';
                this.btnCategoriesFilterNoCover.classList.remove('active');
            }
        }
    }

    setActiveExplorerCategory(tab) {
        this.clearPageCache();
        this.activeExplorerCategory = tab || 'all';

        // Update tab buttons active classes for Library
        [
            { el: this.explorerTabAll, name: 'all' },
            { el: this.explorerTabPopular, name: 'popular' },
            { el: this.explorerTabForYou, name: 'foryou' },
            { el: this.explorerTabGDrive, name: 'gdrive' },
            { el: this.explorerTabQueue, name: 'queue' }
        ].forEach(item => {
            if (item.el) {
                item.el.classList.toggle('active', item.name === this.activeExplorerCategory);
                if (item.name === this.activeExplorerCategory) {
                    try {
                        item.el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                    } catch (e) {}
                }
            }
        });

        this.updateSortUI();
        this.updateActiveFiltersBar();
        const targetPath = (this.currentPath && this.currentPath !== 'E:\\Backups') ? this.currentPath : 'all';
        this.currentPath = targetPath;
        this.fetchDirectory(targetPath, { aroundFilename: this.currentPlayingFilename, autoScroll: true });

        // Explorer hoạt động như modal/drawer nổi trong OnePlayer, không can thiệp URL hash
    }

    openActressesDrawer(query = '', entityName = '') {
        if (entityName) {
            this.closeCategoriesDrawer();
            this.filterActress = entityName;
            this.filterGenre = '';
            this.filterStudio = '';
            this.searchQuery = query || '';
            if (this.inputSearchVideo) this.inputSearchVideo.value = this.searchQuery;
            this.currentPage = 1;
            this.open();
            this.updateActiveFiltersBar();
            this.fetchDirectory(this.currentPath);
            return;
        }
        this.openCategoriesDrawer('actresses', query);
    }

    closeActressesDrawer() {
        this.closeCategoriesDrawer();
    }

    openGenresDrawer(query = '', entityName = '') {
        if (entityName) {
            this.closeCategoriesDrawer();
            this.filterGenre = entityName;
            this.filterActress = '';
            this.filterStudio = '';
            this.searchQuery = query || '';
            if (this.inputSearchVideo) this.inputSearchVideo.value = this.searchQuery;
            this.currentPage = 1;
            this.open();
            this.updateActiveFiltersBar();
            this.fetchDirectory(this.currentPath);
            return;
        }
        this.openCategoriesDrawer('genres', query);
    }

    closeGenresDrawer() {
        this.closeCategoriesDrawer();
    }

    openStudiosDrawer(query = '', entityName = '') {
        if (entityName) {
            this.closeCategoriesDrawer();
            this.filterStudio = entityName;
            this.filterActress = '';
            this.filterGenre = '';
            this.searchQuery = query || '';
            if (this.inputSearchVideo) this.inputSearchVideo.value = this.searchQuery;
            this.currentPage = 1;
            this.open();
            this.updateActiveFiltersBar();
            this.fetchDirectory(this.currentPath);
            return;
        }
        this.openCategoriesDrawer('studios', query);
    }

    setCurrentContext(ctx = {}) {
        if (!this.currentContext) {
            this.currentContext = { boxId: null, boxName: null, threadId: null, threadName: null, mediaId: null };
        }
        if (ctx.boxId !== undefined) this.currentContext.boxId = ctx.boxId ? String(ctx.boxId) : null;
        if (ctx.boxName !== undefined) this.currentContext.boxName = ctx.boxName || null;
        if (ctx.threadId !== undefined) this.currentContext.threadId = ctx.threadId ? String(ctx.threadId) : null;
        if (ctx.threadName !== undefined) this.currentContext.threadName = ctx.threadName || null;
        if (ctx.videoCount !== undefined) this.currentContext.videoCount = Number(ctx.videoCount) || 0;
        if (ctx.mediaId !== undefined) {
            this.currentContext.mediaId = ctx.mediaId ? String(ctx.mediaId) : null;
            this.currentPlayingFilename = ctx.mediaId ? String(ctx.mediaId) : '';
        }
        this.updateBreadcrumbUI();
    }

    updateBreadcrumbUI() {
        if (!this.explorerBreadcrumb) return;
        const boxName = this.currentContext.boxName || (this.currentContext.boxId ? `Box #${this.currentContext.boxId}` : '');
        const threadName = this.currentContext.threadName || (this.currentContext.threadId ? `Thread #${this.currentContext.threadId}` : '');

        if (this.currentViewLevel === 'boxes') {
            if (this.drawerHeaderTitle) this.drawerHeaderTitle.innerText = 'Chuyên mục (Boxes)';
            if (this.btnExplorerBack) this.btnExplorerBack.classList.add('hidden');
            this.explorerBreadcrumb.innerHTML = `
                <span class="breadcrumb-current">Boxes</span>
            `;
        } else if (this.currentViewLevel === 'threads') {
            if (this.drawerHeaderTitle) this.drawerHeaderTitle.innerText = boxName || 'Danh sách Threads';
            if (this.btnExplorerBack) this.btnExplorerBack.classList.remove('hidden');
            this.explorerBreadcrumb.innerHTML = `
                <span class="breadcrumb-item" data-action="go-boxes">Boxes</span>
                <span class="breadcrumb-sep">></span>
                <span class="breadcrumb-current">${this.escapeHtml(boxName || 'Threads')}</span>
            `;
        } else {
            // 'videos'
            if (!this.currentContext.boxId && !this.currentContext.threadId) {
                if (this.drawerHeaderTitle) this.drawerHeaderTitle.innerText = 'Danh sách Video (Google Drive)';
                if (this.btnExplorerBack) this.btnExplorerBack.classList.add('hidden');
                this.explorerBreadcrumb.innerHTML = `<span class="breadcrumb-current">Tất cả Video</span>`;
            } else {
                if (this.drawerHeaderTitle) this.drawerHeaderTitle.innerText = threadName || 'Danh sách Video';
                if (this.btnExplorerBack) this.btnExplorerBack.classList.remove('hidden');
                this.explorerBreadcrumb.innerHTML = `
                    <span class="breadcrumb-item" data-action="go-boxes">Boxes</span>
                    <span class="breadcrumb-sep">></span>
                    <span class="breadcrumb-item" data-action="go-threads">${this.escapeHtml(boxName || 'Box')}</span>
                    <span class="breadcrumb-sep">></span>
                    <span class="breadcrumb-current">${this.escapeHtml(threadName || 'Videos')}</span>
                `;
            }
        }

        // Bind click navigation on breadcrumb items
        const itemBoxes = this.explorerBreadcrumb.querySelector('[data-action="go-boxes"]');
        if (itemBoxes) {
            itemBoxes.style.cursor = 'pointer';
            itemBoxes.addEventListener('click', () => this.openBoxes({ direction: 'left' }));
        }
        const itemThreads = this.explorerBreadcrumb.querySelector('[data-action="go-threads"]');
        if (itemThreads) {
            itemThreads.style.cursor = 'pointer';
            itemThreads.addEventListener('click', () => {
                if (this.currentContext && this.currentContext.boxId) {
                    this.openBoxThreads(this.currentContext.boxId, { direction: 'left' });
                } else {
                    this.openBoxes({ direction: 'left' });
                }
            });
        }
    }

    switchLibraryTab(direction) {
        const libraryTabsWrapper = document.getElementById('library-tabs-wrapper');
        if (!libraryTabsWrapper || libraryTabsWrapper.offsetParent === null) return false;
        
        const tabs = Array.from(libraryTabsWrapper.querySelectorAll('.explorer-tab-btn'));
        if (tabs.length === 0) return false;
        
        const activeIdx = tabs.findIndex(t => t.classList.contains('active'));
        if (activeIdx === -1) return false;
        
        let targetIdx = activeIdx;
        if (direction === 'left-to-right') {
            targetIdx = activeIdx - 1;
        } else {
            targetIdx = activeIdx + 1;
        }
        
        if (targetIdx >= 0 && targetIdx < tabs.length) {
            tabs[targetIdx].click();
            return true;
        }
        return false;
    }

    triggerHierarchySwipe(direction) {
        const now = Date.now();
        if (this.lastHierarchySwipeTime && now - this.lastHierarchySwipeTime < 350) return;
        this.lastHierarchySwipeTime = now;

        if (direction === 'left-to-right' || direction === 'back') {
            // Lùi cấp: Videos -> Threads -> Boxes
            if (this.currentViewLevel === 'videos') {
                this.openBoxThreads(this.currentContext.boxId, { direction: 'left' });
            } else if (this.currentViewLevel === 'threads') {
                this.openBoxes({ direction: 'left' });
            }
        } else if (direction === 'right-to-left' || direction === 'forward') {
            // Tiến cấp: Boxes -> Threads -> Videos
            if (this.currentViewLevel === 'boxes' && this.currentContext.boxId) {
                this.openBoxThreads(this.currentContext.boxId, { direction: 'right' });
            } else if (this.currentViewLevel === 'threads' && this.currentContext.threadId) {
                this.openThreadVideos(this.currentContext.threadId, { direction: 'right' });
            }
        }
    }

    navigateHierarchyBack() {
        if (this.currentViewLevel === 'videos') {
            this.openBoxThreads(this.currentContext.boxId, { direction: 'left' });
        } else if (this.currentViewLevel === 'threads') {
            this.openBoxes({ direction: 'left' });
        }
    }

    async openThreadVideos(threadId, options = {}) {
        const shouldUpdateRoute = options.updateRoute !== false;
        this.currentViewLevel = 'videos';
        if (threadId) {
            this.currentContext.threadId = String(threadId);
            if (shouldUpdateRoute) this.updateHierarchyRoute();
        }
        this.updateBreadcrumbUI();
        this.renderSkeleton(6);

        const animClass = options.direction === 'left' ? 'anim-slide-left' : 'anim-slide-right';
        if (this.listContainer) {
            this.listContainer.classList.remove('anim-slide-left', 'anim-slide-right');
            void this.listContainer.offsetWidth;
            this.listContainer.classList.add(animClass);
        }

        try {
            const url = `${this.backendHost}/api/videos?thread_id=${encodeURIComponent(threadId || '')}&limit=60`;
            const res = await fetch(url, { credentials: 'include' });
            const data = await res.json();
            const videos = (data && data.videos) || [];
            this.videos = videos;
            this.totalVideos = data && data.total !== undefined ? data.total : videos.length;
            this.totalPages = data && data.totalPages !== undefined ? data.totalPages : Math.ceil(this.totalVideos / 60);

            // Sync context if available from video
            if (videos.length > 0) {
                const first = videos[0];
                if (!this.currentContext.boxId && first.box_id) this.currentContext.boxId = first.box_id;
                if (!this.currentContext.boxName && first.box_name) this.currentContext.boxName = first.box_name;
                if (!this.currentContext.threadName && first.thread_name) this.currentContext.threadName = first.thread_name;
                this.updateBreadcrumbUI();
            }

            this.renderVideos(videos);

            // Auto-scroll to currently playing video
            const targetCode = (this.currentContext.mediaId || this.currentPlayingFilename || '').trim().toUpperCase();
            if (targetCode && this.listContainer) {
                setTimeout(() => {
                    const card = this.listContainer.querySelector(`[data-code="${targetCode}"]`);
                    if (card) {
                        card.classList.add('playing-now');
                        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    }
                }, 80);
            }
        } catch (e) {
            console.error('[OnePlayer] Error loading thread videos:', e);
            if (this.listContainer) {
                this.listContainer.innerHTML = `<div class="empty-state" style="padding: 40px; text-align: center; color: #94a3b8;">Không tải được danh sách video của thread này.</div>`;
            }
        }
    }

    async openBoxThreads(boxId, options = {}) {
        const shouldUpdateRoute = options.updateRoute !== false;
        const page = options.page || 1;
        this.currentViewLevel = 'threads';
        if (boxId) {
            this.currentContext.boxId = String(boxId);
            if (shouldUpdateRoute) this.updateHierarchyRoute();
        }
        this.updateBreadcrumbUI();
        this.renderSkeleton(6);

        const animClass = options.direction === 'left' ? 'anim-slide-left' : 'anim-slide-right';
        if (this.listContainer) {
            this.listContainer.classList.remove('anim-slide-left', 'anim-slide-right');
            void this.listContainer.offsetWidth;
            this.listContainer.classList.add(animClass);
        }

        try {
            const currentTid = this.currentContext.threadId || '';
            let url = `${this.backendHost}/api/threads?limit=48&page=${page}`;
            if (boxId) url += `&box_id=${encodeURIComponent(boxId)}`;
            if (currentTid && !options.page) url += `&around_thread_id=${encodeURIComponent(currentTid)}`;

            const res = await fetch(url, { credentials: 'include' });
            const data = await res.json();
            const threads = (data && data.threads) || [];
            this.tierThreads = threads;
            this.threadsTotal = data && data.total !== undefined ? data.total : threads.length;
            this.threadsCurrentPage = data && data.page ? data.page : page;
            this.threadsTotalPages = data && data.total_pages ? data.total_pages : 1;

            if (data.box && data.box.name) {
                this.currentContext.boxName = data.box.name;
                this.updateBreadcrumbUI();
            }

            this.renderThreads(threads, {
                total: this.threadsTotal,
                page: this.threadsCurrentPage,
                totalPages: this.threadsTotalPages
            });

            // Focus and scroll to active thread
            if (currentTid && this.listContainer) {
                setTimeout(() => {
                    const card = this.listContainer.querySelector(`[data-thread-id="${currentTid}"]`);
                    if (card) {
                        card.classList.add('is-current-playing');
                        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    }
                }, 80);
            }
        } catch (e) {
            console.error('[OnePlayer] Error loading box threads:', e);
            if (this.listContainer) {
                this.listContainer.innerHTML = `<div class="empty-state" style="padding: 40px; text-align: center; color: #94a3b8;">Không tải được danh sách thread.</div>`;
            }
        }
    }

    async openBoxes(options = {}) {
        const shouldUpdateRoute = options.updateRoute !== false;
        this.currentViewLevel = 'boxes';
        if (shouldUpdateRoute) this.updateHierarchyRoute();
        this.updateBreadcrumbUI();
        this.renderSkeleton(6);

        const animClass = options.direction === 'left' ? 'anim-slide-left' : 'anim-slide-right';
        if (this.listContainer) {
            this.listContainer.classList.remove('anim-slide-left', 'anim-slide-right');
            void this.listContainer.offsetWidth;
            this.listContainer.classList.add(animClass);
        }

        try {
            const url = `${this.backendHost}/api/boxes`;
            const res = await fetch(url, { credentials: 'include' });
            const data = await res.json();
            const boxes = (data && data.boxes) || [];
            this.tierBoxes = boxes;

            let targetPage = 1;
            const currentBid = this.currentContext.boxId || '';
            if (currentBid) {
                const idx = boxes.findIndex(b => String(b.id) === String(currentBid));
                if (idx !== -1) {
                    targetPage = Math.floor(idx / 12) + 1;
                }
            }
            this.renderBoxes(boxes, targetPage);

            // Focus and scroll to active box
            if (currentBid && this.listContainer) {
                setTimeout(() => {
                    const card = this.listContainer.querySelector(`[data-box-id="${currentBid}"]`);
                    if (card) {
                        card.classList.add('is-current-box');
                        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    }
                }, 80);
            }
        } catch (e) {
            console.error('[OnePlayer] Error loading boxes:', e);
            if (this.listContainer) {
                this.listContainer.innerHTML = `<div class="empty-state" style="padding: 40px; text-align: center; color: #94a3b8;">Không tải được danh sách chuyên mục (boxes).</div>`;
            }
        }
    }

    renderVideos(videos) {
        if (!this.listContainer) return;
        this.videos = Array.isArray(videos) ? videos : [];
        if (this.videos.length === 0) {
            this.listContainer.innerHTML = `<div class="empty-state" style="padding: 40px; text-align: center; color: #94a3b8;"><span class="material-symbols-outlined" style="font-size: 40px; display: block; margin-bottom: 8px;">movie_off</span>Thread này chưa có video sẵn sàng.</div>`;
            return;
        }
        this.activeTab = 'videos';
        this.renderList();
    }

    renderThreads(threads, pagination = {}) {
        if (!this.listContainer) return;
        this.listContainer.className = 'explorer-list-container list-mode threads-view';
        if (!threads || threads.length === 0) {
            this.listContainer.innerHTML = `<div class="empty-state" style="padding: 40px; text-align: center; color: #94a3b8;">Chuyên mục này chưa có thread nào.</div>`;
            return;
        }

        this.listContainer.innerHTML = '';
        const currentTid = this.currentContext.threadId ? String(this.currentContext.threadId) : '';

        threads.forEach(t => {
            const isPlaying = currentTid && String(t.id) === currentTid;
            const card = document.createElement('div');
            card.className = `explorer-thread-card ${isPlaying ? 'is-current-playing' : ''}`;
            card.setAttribute('data-thread-id', t.id);

            const posterSrc = t.poster_url || (t.first_media_id ? `${this.backendHost}/api/poster/${encodeURIComponent(t.first_media_id)}` : '');
            const imgHtml = posterSrc
                ? `<img src="${posterSrc}" class="thread-thumb-img" alt="${this.escapeHtml(t.name)}" loading="lazy" />`
                : `<div class="grid-card-thumb-placeholder" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #0f172a;"><span class="material-symbols-outlined" style="font-size: 32px; color: #64748b;">movie</span></div>`;

            const videoCount = t.video_count || t.total_media || 1;
            const isAutoPlay = videoCount <= 20;

            card.innerHTML = `
                <div class="thread-thumb-wrapper">
                    ${imgHtml}
                    <div class="thread-badge-video-count ${isAutoPlay ? 'is-quick-play' : ''}">
                        <span class="material-symbols-outlined" style="font-size: 13px;">${isAutoPlay ? 'play_arrow' : 'video_library'}</span>
                        ${videoCount} video ${isAutoPlay ? '• Phát ngay' : ''}
                    </div>
                    ${isPlaying ? `<div class="thread-playing-badge"><span class="material-symbols-outlined" style="font-size: 12px;">play_circle</span> Đang xem</div>` : ''}
                </div>
                <div class="thread-info">
                    <div class="thread-title" title="${this.escapeHtml(t.name)}">${this.escapeHtml(t.name)}</div>
                    <div class="thread-meta-row">
                        <span class="thread-box-tag">${this.escapeHtml(t.box_name || 'Chung')}</span>
                        <div class="thread-actions-wrap">
                            <span>${t.updated_at ? t.updated_at.slice(0, 10) : ''}</span>
                            <button class="btn-thread-open-videos" title="Xem danh sách video của thread này" data-action="open-video-list">
                                <span class="material-symbols-outlined">list</span>
                                <span>Ds Video</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;

            // Xử lý khi bấm trực tiếp vào nút "Ds Video" trên Card
            const btnOpenVideos = card.querySelector('[data-action="open-video-list"]');
            if (btnOpenVideos) {
                btnOpenVideos.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.setCurrentContext({
                        threadId: t.id,
                        threadName: t.name,
                        boxId: t.box_id || this.currentContext.boxId,
                        boxName: t.box_name || this.currentContext.boxName,
                        videoCount: videoCount
                    });
                    this.openThreadVideos(t.id, { direction: 'right' });
                });
            }

            card.addEventListener('click', async () => {
                this.setCurrentContext({
                    threadId: t.id,
                    threadName: t.name,
                    boxId: t.box_id || this.currentContext.boxId,
                    boxName: t.box_name || this.currentContext.boxName,
                    videoCount: videoCount
                });

                // Nếu thread có <= 20 video (hoặc video_count <= 20), đóng Drawer và phát ngay video đầu tiên
                if (videoCount > 0 && videoCount <= 20) {
                    try {
                        this.close();
                        if (window.playerInstance && window.playerInstance.showLoading) {
                            const posterSrc = t.poster_url || (t.first_media_id ? `${this.backendHost}/api/poster/${encodeURIComponent(t.first_media_id)}` : '');
                            window.playerInstance.showLoading({
                                title: t.name || 'Đang mở thread...',
                                coverSrc: posterSrc,
                                status: 'Đang tải video đầu tiên...'
                            });
                        }
                        const url = `${this.backendHost}/api/videos?thread_id=${encodeURIComponent(t.id)}&limit=60`;
                        const res = await fetch(url, { credentials: 'include' });
                        const data = await res.json();
                        const videos = (data && data.videos) || [];
                        if (videos.length > 0) {
                            this.videos = videos;
                            this.totalVideos = data && data.total !== undefined ? data.total : videos.length;
                            this.totalPages = 1;
                            const firstVid = videos[0];
                            firstVid.thread_id = t.id;
                            firstVid.thread_name = t.name;
                            firstVid.box_id = t.box_id || this.currentContext.boxId;
                            firstVid.box_name = t.box_name || this.currentContext.boxName;
                            firstVid.video_count = videoCount;
                            this.selectVideo(firstVid);
                            return;
                        }
                    } catch (err) {
                        console.debug('[OnePlayer] Error auto-playing first video of thread:', err);
                    }
                }

                // Nếu thread > 20 video hoặc fetch không thành công -> Mở Drawer xem danh sách video
                this.openThreadVideos(t.id, { direction: 'right' });
            });

            this.listContainer.appendChild(card);
        });

        // Chỉ hiển thị pagination bar ở threads list khi số lượng > 12 (hoặc total > 12)
        const totalThreads = pagination.total !== undefined ? pagination.total : threads.length;
        if (totalThreads > 12) {
            const bottomBar = this.createPaginationBar({
                position: 'bottom',
                currentPage: pagination.page || 1,
                totalPages: pagination.totalPages || 1,
                totalItems: totalThreads,
                pageSize: 48,
                unitLabel: 'thread',
                onPageChange: (p) => {
                    this.openBoxThreads(this.currentContext.boxId, { page: p, autoScroll: false });
                }
            });
            this.listContainer.appendChild(bottomBar);
        }
    }

    renderBoxes(boxes, page = 1) {
        if (!this.listContainer) return;
        this.listContainer.className = 'explorer-list-container list-mode boxes-view';
        if (!boxes || boxes.length === 0) {
            this.listContainer.innerHTML = `<div class="empty-state" style="padding: 40px; text-align: center; color: #94a3b8;">Không có chuyên mục nào.</div>`;
            return;
        }

        const pageSize = 12;
        const totalPages = Math.max(1, Math.ceil(boxes.length / pageSize));
        const currentPage = Math.min(Math.max(1, page), totalPages);
        this.boxesCurrentPage = currentPage;
        this.boxesTotalPages = totalPages;

        const startIndex = (currentPage - 1) * pageSize;
        const pageBoxes = boxes.slice(startIndex, startIndex + pageSize);

        this.listContainer.innerHTML = '';
        const currentBid = this.currentContext.boxId ? String(this.currentContext.boxId) : '';

        pageBoxes.forEach(b => {
            const isCurrent = currentBid && String(b.id) === currentBid;
            const card = document.createElement('div');
            card.className = `explorer-box-card ${isCurrent ? 'is-current-box' : ''}`;
            card.setAttribute('data-box-id', b.id);

            card.innerHTML = `
                <div>
                    <div class="box-card-header">
                        <span class="material-symbols-outlined box-card-icon">folder_special</span>
                        <div class="box-card-name">${this.escapeHtml(b.name)}</div>
                    </div>
                </div>
                <div class="box-card-footer">
                    <span class="box-stat-pill">📁 ${b.video_thread_count || b.thread_count || 0} threads</span>
                    ${isCurrent ? `<span class="box-current-badge">Hiện tại</span>` : ''}
                </div>
            `;

            card.addEventListener('click', () => {
                this.setCurrentContext({
                    boxId: b.id,
                    boxName: b.name
                });
                this.openBoxThreads(b.id, { direction: 'right' });
            });

            this.listContainer.appendChild(card);
        });

        // Chỉ hiển thị pagination bar ở boxes list khi số lượng > 12
        if (boxes.length > 12) {
            const bottomBar = this.createPaginationBar({
                position: 'bottom',
                currentPage: currentPage,
                totalPages: totalPages,
                totalItems: boxes.length,
                pageSize: pageSize,
                unitLabel: 'chuyên mục',
                onPageChange: (p) => {
                    this.renderBoxes(boxes, p);
                    if (this.listContainer) {
                        this.listContainer.scrollTop = 0;
                    }
                }
            });
            this.listContainer.appendChild(bottomBar);
        }
    }

    openContextualDrawer() {
        this.currentViewLevel = 'videos';
        this.activeTab = 'videos';
        if (this.drawerHeaderTitle) this.drawerHeaderTitle.innerText = 'Danh sách Video (Google Drive)';
        if (this.btnExplorerBack) this.btnExplorerBack.classList.add('hidden');
        if (this.explorerBreadcrumb) {
            this.explorerBreadcrumb.innerHTML = '<span class="breadcrumb-current">Tất cả Video</span>';
        }
        this.open();
        if (!this.videos || this.videos.length === 0) {
            this.fetchDirectory('all', { page: this.currentPage || 1, autoScroll: true });
        } else {
            this.renderList();
        }
    }

    open() {
        this.closeAllDrawers('explorer');
        if (this.modalEl) {
            this.modalEl.classList.remove('hidden');
            this.isAutoWindowSet = false;
            this.hasFocusedPlaying = false;

            if (this.inputSearchVideo) {
                this.inputSearchVideo.value = this.searchQuery || '';
            }
            if (this.searchWrapper) {
                if (this.searchQuery) {
                    this.searchWrapper.classList.add('active');
                } else {
                    this.searchWrapper.classList.remove('active');
                }
            }
            if (this.btnClearSearch) {
                if (this.searchQuery) {
                    this.btnClearSearch.classList.remove('hidden');
                } else {
                    this.btnClearSearch.classList.add('hidden');
                }
            }

            this.updateActiveFiltersBar();
            this.updateSortUI();

            const targetCode = (this.currentPlayingFilename || '').trim().toUpperCase();
            const hasPlayingInDOM = targetCode && this.listContainer && this.listContainer.querySelector(
                `.explorer-grid-card[data-code="${targetCode}"], .explorer-item[data-code="${targetCode}"], .entity-video-card[data-code="${targetCode}"]`
            );

            const isAllGrid = (
                (this.activeExplorerCategory === 'all' || this.activeExplorerCategory === 'gdrive' || this.activeExplorerCategory === 'queue') &&
                this.videos &&
                this.videos.length > 0 &&
                this.listContainer &&
                this.listContainer.querySelector('.explorer-grid-card, .explorer-item')
            );

            if (this.currentViewLevel === 'videos' || (!this.currentContext.boxId && !this.currentContext.threadId)) {
                this.currentViewLevel = 'videos';
                this.activeTab = 'videos';
                if (this.drawerHeaderTitle) this.drawerHeaderTitle.innerText = 'Danh sách Video (Google Drive)';
                if (this.btnExplorerBack) this.btnExplorerBack.classList.add('hidden');
                if (this.explorerBreadcrumb) {
                    this.explorerBreadcrumb.innerHTML = '<span class="breadcrumb-current">Tất cả Video</span>';
                }
                if (!this.videos || this.videos.length === 0) {
                    this.fetchDirectory('all', { aroundFilename: targetCode, autoScroll: true });
                } else if (hasPlayingInDOM) {
                    requestAnimationFrame(() => {
                        setTimeout(() => {
                            this.scrollToPlayingVideo(true);
                        }, 50);
                    });
                } else if (targetCode) {
                    // Video đang phát nằm ở trang khác, tự động fetch aroundFilename để nạp đúng page và focus
                    this.fetchDirectory('all', { aroundFilename: targetCode, autoScroll: true });
                } else {
                    this.renderList();
                }
            } else if (this.currentViewLevel === 'threads' && this.currentContext && this.currentContext.boxId) {
                this.updateBreadcrumbUI();
                if (!this.tierThreads || this.tierThreads.length === 0) {
                    this.openBoxThreads(this.currentContext.boxId);
                }
            } else if (this.currentContext && this.currentContext.threadId) {
                this.openThreadVideos(this.currentContext.threadId, { autoScroll: true });
            } else if (this.currentContext && this.currentContext.boxId) {
                this.openBoxThreads(this.currentContext.boxId);
            } else {
                this.fetchDirectory('all', { page: this.currentPage || 1, autoScroll: true });
            }

            // Explorer mở dạng modal nổi, không can thiệp vào URL hash để giữ nguyên video context hiện tại
            this.fetchCategoryCounts();
        }
    }

    formatEstCount(num) {
        if (!num || isNaN(num) || num <= 0) return '0';
        const n = Number(num);
        if (n >= 1000000) {
            return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
        }
        if (n >= 1000) {
            return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        }
        return String(n);
    }

    async fetchCategoryCounts(queryOverride = null) {
        try {
            const q = queryOverride !== null ? queryOverride : (this.searchQuery || '');
            const url = `${this.backendHost}/api/categories/stats${q ? `?q=${encodeURIComponent(q)}` : ''}`;
            const res = await fetch(url, { credentials: 'include' });
            const data = await res.json();
            if (data.success && data.counts) {
                const c = data.counts;
                const setBadge = (id, val) => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.textContent = this.formatEstCount(val);
                        el.title = `${Number(val || 0).toLocaleString()} mục`;
                    }
                };
                setBadge('tab-badge-all', c.all);
                setBadge('tab-badge-gdrive', c.gdrive);
                setBadge('tab-badge-queue', c.queue);
                setBadge('category-badge-actresses', c.actresses);
                setBadge('category-badge-genres', c.genres);
                setBadge('category-badge-studios', c.studios);
            }
        } catch (e) {
            console.debug('Error fetching category counts:', e);
        }
    }

    close() {
        if (this.modalEl) {
            this.modalEl.classList.add('hidden');
        }
        this.checkAndClearRouteIfAllClosed();
    }

    getAdminUrl(target = 'sources') {
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = window.location.port;
        const clean = String(target || '').replace(/^[#/]+/, '');
        if (port === '5053') {
            return `${protocol}//${hostname}:5052/#${clean}`;
        }
        return `/admin#${clean}`;
    }

    openSources() {
        const adminUrl = this.getAdminUrl('sources');
        window.open(adminUrl, '_blank');
    }

    closeSources() {
        if (this.sourceDrawerModal) {
            this.sourceDrawerModal.classList.add('hidden');
        }
        this.checkAndClearRouteIfAllClosed();
    }

    setActiveTab(tab) {
        this.activeTab = tab;
        this.renderedStartIdx = 0;
        this.renderedEndIdx = 10;
        this.isAutoWindowSet = false;
        this.hasFocusedPlaying = false;

        [this.tabVideos, this.tabFolders].forEach(t => t && t.classList.remove('active'));

        if (tab === 'videos') {
            if (this.tabVideos) this.tabVideos.classList.add('active');
            if (this.sortBar) this.sortBar.style.display = 'flex';
            if (this.listContainer) {
                this.listContainer.classList.remove('hidden');
                this.listContainer.style.display = '';
            }
            this.fetchDirectory(this.currentPath, { aroundFilename: this.currentPlayingFilename, autoScroll: true });
        } else if (tab === 'folders') {
            if (this.tabFolders) this.tabFolders.classList.add('active');
            if (this.sortBar) this.sortBar.style.display = 'flex';
            if (this.listContainer) {
                this.listContainer.classList.remove('hidden');
                this.listContainer.style.display = '';
            }
            this.renderList();
        }
    }

    toggleViewMode() {
        this.viewMode = this.viewMode === 'grid' ? 'list' : 'grid';
        try {
            localStorage.setItem('vod_view_mode', this.viewMode);
        } catch (e) {}
        this.updateViewModeUI();
        this.renderList();
    }

    updateViewModeUI() {
        if (this.btnToggleView) {
            this.btnToggleView.title = this.viewMode === 'grid' ? 'Chuyển sang chế độ ListView' : 'Chuyển sang chế độ GridView';
        }
        if (this.iconViewMode) {
            this.iconViewMode.innerText = this.viewMode === 'grid' ? 'view_list' : 'grid_view';
        }
    }

    handleSortChange(key) {
        this.clearPageCache();
        if (this.sortKey === key) {
            this.sortAsc = !this.sortAsc;
        } else {
            this.sortKey = key;
            this.sortAsc = (key === 'release_date' || key === 'views') ? false : true;
        }
        this.updateSortUI();
        this.fetchDirectory(this.currentPath);
    }

    updateSortUI() {
        if (this.btnSortRelease) {
            if (this.sortKey === 'release_date') {
                this.btnSortRelease.classList.add('active');
                if (this.iconSortRelease) this.iconSortRelease.innerText = this.sortAsc ? 'arrow_upward' : 'arrow_downward';
            } else {
                this.btnSortRelease.classList.remove('active');
                if (this.iconSortRelease) this.iconSortRelease.innerText = 'swap_vert';
            }
        }

        if (this.btnSortName) {
            if (this.sortKey === 'name') {
                this.btnSortName.classList.add('active');
                if (this.iconSortName) this.iconSortName.innerText = this.sortAsc ? 'arrow_upward' : 'arrow_downward';
            } else {
                this.btnSortName.classList.remove('active');
                if (this.iconSortName) this.iconSortName.innerText = 'swap_vert';
            }
        }

        if (this.btnSortSize) {
            if (this.sortKey === 'size') {
                this.btnSortSize.classList.add('active');
                if (this.iconSortSize) this.iconSortSize.innerText = this.sortAsc ? 'arrow_upward' : 'arrow_downward';
            } else {
                this.btnSortSize.classList.remove('active');
                if (this.iconSortSize) this.iconSortSize.innerText = 'swap_vert';
            }
        }

        if (this.btnSortViews) {
            if (this.sortKey === 'views') {
                this.btnSortViews.classList.add('active');
                if (this.iconSortViews) this.iconSortViews.innerText = this.sortAsc ? 'arrow_upward' : 'arrow_downward';
            } else {
                this.btnSortViews.classList.remove('active');
                if (this.iconSortViews) this.iconSortViews.innerText = 'swap_vert';
            }
        }
    }

    toggleSourcesDropdown() {
        if (!this.sourcesDropdownMenu) return;
        const isHidden = this.sourcesDropdownMenu.classList.contains('hidden');
        if (isHidden) {
            this.openSourcesDropdown();
        } else {
            this.closeSourcesDropdown();
        }
    }

    openSourcesDropdown() {
        if (!this.sourcesDropdownMenu) return;
        this.sourcesDropdownMenu.classList.remove('hidden');
        if (this.explorerTabDropdownWrapper) {
            this.explorerTabDropdownWrapper.classList.add('open');
        }
        if (!this.sources || this.sources.length === 0) {
            fetch(`${this.backendHost}/api/sources`, { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    this.sources = data.sources || [];
                    this.renderSourcesDropdown();
                })
                .catch(err => {
                    console.error('Lỗi fetch sources dropdown:', err);
                });
        } else {
            this.renderSourcesDropdown();
        }
    }

    closeSourcesDropdown() {
        if (this.sourcesDropdownMenu) {
            this.sourcesDropdownMenu.classList.add('hidden');
        }
        if (this.explorerTabDropdownWrapper) {
            this.explorerTabDropdownWrapper.classList.remove('open');
        }
    }

    renderSourcesDropdown() {
        if (!this.sourcesDropdownList) return;
        if (!this.sources || this.sources.length === 0) {
            this.sourcesDropdownList.innerHTML = `
                <div class="explorer-empty" style="padding: 12px 0;">
                    <span style="font-size: 11.5px; color: rgba(255,255,255,0.5);">Chưa có nguồn dữ liệu nào</span>
                </div>
            `;
            return;
        }

        this.sourcesDropdownList.innerHTML = '';
        this.sources.forEach(src => {
            const isAll = (this.selectedSourceIds.length === 0) || (this.sources.length > 0 && this.selectedSourceIds.length === this.sources.length);
            const isChecked = isAll || this.selectedSourceIds.includes(src.id);
            const isOffline = src.status === 'offline';
            const displayTitle = src.name || this.formatSourceDisplayPath(src.path) || src.drive || 'Nguồn dữ liệu';

            const itemLabel = document.createElement('label');
            itemLabel.className = `source-dropdown-item ${isChecked ? 'checked' : ''}`;
            itemLabel.dataset.sourceId = src.id;

            itemLabel.innerHTML = `
                <input type="checkbox" class="source-dropdown-checkbox" value="${src.id}" ${isChecked ? 'checked' : ''} />
                <div class="source-dropdown-item-text">
                    <div class="source-dropdown-item-title" title="${this.escapeHtml(src.path || src.name)}">${this.escapeHtml(displayTitle)}</div>
                    <div class="source-dropdown-item-count">${src.video_count || 0} video</div>
                </div>
                <span class="source-status-dot ${isOffline ? 'offline' : 'online'}" title="${isOffline ? 'Offline' : 'Online'}"></span>
            `;

            const checkbox = itemLabel.querySelector('.source-dropdown-checkbox');
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    e.stopPropagation();
                    const sId = parseInt(checkbox.value, 10);
                    // Nếu đang ở trạng thái 'Tất cả' (mảng rỗng hoặc đầy đủ) và vừa uncheck 1 source
                    if (this.selectedSourceIds.length === 0 || this.selectedSourceIds.length === this.sources.length) {
                        if (!checkbox.checked) {
                            this.selectedSourceIds = this.sources.map(s => s.id).filter(id => id !== sId);
                        }
                    } else {
                        if (checkbox.checked) {
                            if (!this.selectedSourceIds.includes(sId)) {
                                this.selectedSourceIds.push(sId);
                            }
                        } else {
                            this.selectedSourceIds = this.selectedSourceIds.filter(id => id !== sId);
                        }
                    }

                    this.updateSourcesDropdownUI();
                    this.currentPath = 'all';
                    this.fetchDirectory(this.currentPath);
                });
            }

            this.sourcesDropdownList.appendChild(itemLabel);
        });

        this.updateSourcesDropdownUI();
    }

    updateSourcesDropdownUI() {
        const totalSrcCount = (this.sources && this.sources.length) || 0;
        const isAll = (this.selectedSourceIds.length === 0) || (totalSrcCount > 0 && this.selectedSourceIds.length === totalSrcCount);

        if (this.explorerTabAllLabel) {
            if (isAll) {
                this.explorerTabAllLabel.textContent = 'Tất cả nguồn';
            } else if (this.selectedSourceIds.length === 1) {
                const singleSrc = this.sources.find(s => s.id === this.selectedSourceIds[0]);
                const title = singleSrc ? (singleSrc.name || this.formatSourceDisplayPath(singleSrc.path) || singleSrc.drive || '1 nguồn') : '1 nguồn';
                this.explorerTabAllLabel.textContent = title;
            } else {
                this.explorerTabAllLabel.textContent = `${this.selectedSourceIds.length} nguồn`;
            }
        }

        if (this.btnSelectAllSources) {
            this.btnSelectAllSources.textContent = isAll ? 'Bỏ chọn tất cả' : 'Chọn tất cả';
        }

        if (this.sourcesDropdownList) {
            const items = this.sourcesDropdownList.querySelectorAll('.source-dropdown-item');
            items.forEach(item => {
                const sId = parseInt(item.dataset.sourceId, 10);
                const isChecked = isAll || this.selectedSourceIds.includes(sId);
                const cb = item.querySelector('.source-dropdown-checkbox');
                if (cb) cb.checked = isChecked;
                item.classList.toggle('checked', isChecked);
            });
        }
    }

    fetchDirectory(pathStr, options = {}) {
        if (typeof pathStr === 'undefined' || pathStr === null || pathStr === 'E:\\Backups') {
            pathStr = (this.currentPath && this.currentPath !== 'E:\\Backups') ? this.currentPath : 'all';
        }
        this.updateActiveFiltersBar();

        const aroundFilename = options.aroundFilename || (options.autoScroll ? this.currentPlayingFilename : null);

        let isJumpingToAroundFile = false;
        if (options.page) {
            this.currentPage = Math.max(1, parseInt(options.page, 10) || 1);
        } else if (this.initialPageFromRoute) {
            this.currentPage = this.initialPageFromRoute;
            this.initialPageFromRoute = null; // consume it
        } else if (!options.keepPage && !aroundFilename) {
            this.currentPage = 1;
        } else if (aroundFilename) {
            isJumpingToAroundFile = true;
        }

        const offset = (this.currentPage - 1) * this.pageSize;
        this.loadedStartOffset = offset;
        this.loadedEndOffset = offset;
        this.videos = [];
        this.isLoadingPage = true;
        if (this.currentViewLevel !== 'boxes' && this.currentViewLevel !== 'threads') {
            this.renderSkeleton(6);
        }

        const params = new URLSearchParams();
        if (pathStr && pathStr !== 'all') params.append('path', pathStr);
        if (this.selectedSourceIds && this.selectedSourceIds.length > 0 && (this.sources.length === 0 || this.selectedSourceIds.length < this.sources.length)) {
            const selectedDrives = this.selectedSourceIds.map(id => {
                const s = this.sources.find(src => src.id === id);
                return s ? (s.drive || s.path) : id;
            }).filter(Boolean);
            if (selectedDrives.length > 0) {
                params.append('sources', selectedDrives.join(','));
            }
        }
        params.append('sort_by', this.sortKey);
        params.append('sort_asc', this.sortAsc);
        params.append('limit', this.pageSize);
        params.append('offset', offset);
        params.append('page', this.currentPage);
        if (this.searchQuery) params.append('q', this.searchQuery);
        const hasEntityFilter = !!(this.filterActress || this.filterGenre || this.filterStudio);
        const shouldApplyCoverFilter = this.activeExplorerCategory === 'all' && !hasEntityFilter;
        if (this.filterHasCover && shouldApplyCoverFilter) params.append('filter_has_cover', 'true');
        if (this.filterNoCover) params.append('filter_no_cover', 'true');
        if (this.filterNoIdx) params.append('filter_no_idx', 'true');
        if (this.filterUnviewed) params.append('filter_unviewed', 'true');
        if (this.activeExplorerCategory === 'queue') params.append('filter', 'in_queue');
        if (this.activeExplorerCategory === 'gdrive') params.append('filter', 'has_gdrive');
        if (this.filterActress) params.append('actresses', this.filterActress);
        if (this.filterGenre) params.append('genres', this.filterGenre);
        if (this.filterStudio) params.append('studios', this.filterStudio);

        if (aroundFilename && isJumpingToAroundFile) {
            params.append('around_filename', aroundFilename);
        }

        if (this.activeLibraryTab && this.activeLibraryTab !== 'all') {
            params.append('tab', this.activeLibraryTab);
        }


        if (this.activeExplorerCategory === 'popular') {
            params.set('sort_by', 'popular');
            params.set('sort_asc', 'false');
        } else if (this.activeExplorerCategory === 'foryou') {
            params.set('sort_by', 'random');
        }
        let url = `${this.backendHost}/api/videos?${params.toString()}`;
        fetch(url, { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                this.currentPath = (data.current_path && data.current_path !== 'Tất cả các Nguồn (All Sources)') ? data.current_path : (pathStr || 'all');
                this.parentPath = data.parent_path || null;
                this.folders = data.folders || [];
                this.videos = data.videos || [];
                this.totalVideos = data.total || 0;
                this.totalPages = data.totalPages || Math.ceil(this.totalVideos / Math.max(1, this.pageSize)) || 1;
                if (data.page !== undefined && data.page !== null) {
                    this.currentPage = Math.max(1, parseInt(data.page, 10) || 1);
                }
                this.loadedStartOffset = (data.offset !== undefined) ? data.offset : offset;
                this.loadedEndOffset = this.loadedStartOffset + this.videos.length;

                if (!this.pageCache) this.pageCache = {};
                this.pageCache[this.currentPage] = this.videos;

                // Cập nhật adjacentContext nếu video đang phát nằm trong danh sách vừa nạp
                const curPlaying = (this.currentPlayingFilename || '').trim().toUpperCase();
                if (curPlaying && this.videos.length > 0) {
                    const idx = this.videos.findIndex(v => ((v.code || v.name || '').toUpperCase() === curPlaying));
                    if (idx !== -1) {
                        const total = this.videos.length;
                        this.adjacentContext = {
                            currentCode: curPlaying,
                            prevVideo: idx > 0 ? this.videos[idx - 1] : (this.currentPage > 1 && this.pageCache && this.pageCache[this.currentPage - 1] ? this.pageCache[this.currentPage - 1][this.pageCache[this.currentPage - 1].length - 1] : null),
                            nextVideo: idx < total - 1 ? this.videos[idx + 1] : (this.currentPage < this.totalPages && this.pageCache && this.pageCache[this.currentPage + 1] ? this.pageCache[this.currentPage + 1][0] : null),
                            timestamp: Date.now()
                        };
                        if (idx >= total - 2 && this.currentPage < this.totalPages) {
                            this.preloadPage(this.currentPage + 1);
                        }
                        if (idx <= 1 && this.currentPage > 1) {
                            this.preloadPage(this.currentPage - 1);
                        }
                    }
                }

                if (this.pathDisplay) {
                    if (this.currentPath === 'all' || !this.currentPath) {
                        this.pathDisplay.innerText = 'Tất cả nguồn';
                    } else {
                        this.pathDisplay.innerText = this.formatSourceDisplayPath(this.currentPath);
                    }
                }

                if (this.btnBack) {
                    this.btnBack.disabled = !this.parentPath;
                    this.btnBack.style.opacity = this.parentPath ? '1' : '0.4';
                }

                if (this.badgeVideos) this.badgeVideos.innerText = this.totalVideos;
                if (this.badgeFolders) this.badgeFolders.innerText = this.folders.length;

                if (this.currentViewLevel !== 'boxes' && this.currentViewLevel !== 'threads') {
                    this.renderList();

                    if (options.autoScroll || aroundFilename) {
                        setTimeout(() => {
                            this.scrollToPlayingVideo();
                        }, 120);
                    }
                }
            })
            .catch(err => {
                console.error('Lỗi fetch explorer API:', err);
                this.listContainer.innerHTML = `
                    <div class="explorer-empty">
                        <span class="material-symbols-outlined">error</span>
                        <span>Không thể đọc thư mục này!</span>
                    </div>
                `;
            })
            .finally(() => {
                this.isLoadingPage = false;
            });
    }

    scrollToPlayingVideo(smooth = true) {
        if (!this.listContainer) return false;
        const targetCode = (this.currentPlayingFilename || '').trim().toUpperCase();
        if (!targetCode) return false;

        let playingCard = this.listContainer.querySelector(
            `.explorer-grid-card[data-code="${targetCode}"], .explorer-item[data-code="${targetCode}"], .entity-video-card[data-code="${targetCode}"]`
        );

        if (!playingCard) {
            const allCards = this.listContainer.querySelectorAll('.explorer-grid-card, .explorer-item, .entity-video-card');
            for (const c of allCards) {
                const codeAttr = (c.getAttribute('data-code') || '').toUpperCase();
                const pathAttr = (c.getAttribute('data-path') || '').toUpperCase();
                if (codeAttr === targetCode || pathAttr.includes(targetCode)) {
                    playingCard = c;
                    break;
                }
            }
        }

        if (!playingCard) {
            playingCard = this.listContainer.querySelector('.explorer-grid-card.playing-now, .explorer-item.playing-now, .entity-video-card.playing-now');
        }

        if (playingCard) {
            this.listContainer.querySelectorAll('.playing-now').forEach(el => {
                if (el !== playingCard) el.classList.remove('playing-now');
            });
            playingCard.classList.add('playing-now');

            // Trigger eye-catching focus pulse
            playingCard.classList.remove('focus-pulse');
            void playingCard.offsetWidth;
            playingCard.classList.add('focus-pulse');

            playingCard.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
            return true;
        }
        return false;
    }

    fetchSources() {
        if (!this.sourcesListContainer) return;
        this.sourcesListContainer.innerHTML = `
            <div class="explorer-loading">
                <span class="material-symbols-outlined spin">sync</span>
                <span>Đang nạp nguồn dữ liệu...</span>
            </div>
        `;

        fetch(`${this.backendHost}/api/sources`, { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                this.sources = data.sources || [];
                if (this.badgeSources) this.badgeSources.innerText = this.sources.length;
                this.updateSourcesDropdownUI();
                this.renderSourcesList();
            })
            .catch(err => {
                console.error('Lỗi fetch sources API:', err);
                this.sourcesListContainer.innerHTML = `<div class="explorer-empty"><span>Không thể đọc danh sách Sources!</span></div>`;
            });
    }

    formatSourceDisplayPath(pathStr) {
        if (!pathStr) return '';
        if (pathStr.startsWith('http://') || pathStr.startsWith('https://')) {
            try {
                let cleanUrl = pathStr.replace(/(@)https?:\/\//i, '$1');
                const parsed = new URL(cleanUrl);
                let hostname = parsed.hostname;
                let hostLabel = hostname.split('.')[0] || hostname;

                let pathSegments = parsed.pathname.split('/').filter(Boolean);
                let pathLabel = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : '';

                if (hostLabel && pathLabel) {
                    return `${hostLabel} / ${pathLabel}`;
                } else if (hostLabel) {
                    return hostLabel;
                } else if (pathLabel) {
                    return pathLabel;
                }
            } catch (e) {}
        }
        return pathStr;
    }

    openSourceMenu(src) {
        this.closeAllDrawers('sourceItem');
        this.activeSourceForMenu = src;
        if (this.sourceMenuTitle) {
            this.sourceMenuTitle.innerText = src.name || this.formatSourceDisplayPath(src.path) || src.drive || 'Nguồn dữ liệu';
        }
        if (this.sourceMenuModal) {
            this.sourceMenuModal.classList.remove('hidden');
        }
    }

    closeSourceMenu() {
        this.activeSourceForMenu = null;
        if (this.sourceMenuModal) {
            this.sourceMenuModal.classList.add('hidden');
        }
    }

    renderSourcesList() {
        if (!this.sourcesListContainer) return;

        if (this.sources.length === 0) {
            this.sourcesListContainer.innerHTML = `
                <div class="explorer-empty">
                    <span class="material-symbols-outlined">dataset</span>
                    <span>Chưa có nguồn dữ liệu nào. Nhập đường dẫn và bấm "+ Thêm & Quét".</span>
                </div>
            `;
            return;
        }

        this.sourcesListContainer.innerHTML = '';
        this.sources.forEach(src => {
            const card = document.createElement('div');
            card.className = 'source-card list-item';
            card.dataset.sourceId = src.id;

            const isOffline = src.status === 'offline';
            const statusBadge = isOffline
                ? `<span class="source-badge offline" title="Nguồn mất kết nối / ping 1s timeout 3 lần">🔴 Offline</span>`
                : `<span class="source-badge online">🟢 Online</span>`;

            const displayName = src.name || this.formatSourceDisplayPath(src.path) || src.drive || 'Nguồn dữ liệu';
            const displaySub = src.drive ? `Drive: ${src.drive}` : this.formatSourceDisplayPath(src.path);

            card.innerHTML = `
                <div class="source-card-main">
                    <span class="material-symbols-outlined source-icon">cloud</span>
                    <div class="source-card-text">
                        <div class="source-card-title" title="${this.escapeHtml(src.path || src.name)}">${this.escapeHtml(displayName)}</div>
                        <div class="source-card-stats">
                            ${statusBadge}
                            <span class="source-badge">📁 ${src.folder_count} Thư mục</span>
                            <span class="source-badge">🎬 ${src.video_count} Video</span>
                        </div>
                        <div id="source-status-${src.id}" class="source-item-status-msg hidden"></div>
                    </div>
                </div>
                <button class="source-card-menu-btn" title="Tùy chọn">
                    <span class="material-symbols-outlined">more_vert</span>
                </button>
            `;

            const menuBtn = card.querySelector('.source-card-menu-btn');
            if (menuBtn) {
                menuBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.openSourceMenu(src);
                });
            }

            card.addEventListener('click', (e) => {
                if (e.target.closest('.source-card-menu-btn')) return;
                this.closeSources();
                this.selectedSourceIds = [src.id];
                this.currentPath = 'all';
                this.open();
                this.setActiveExplorerCategory('all');
                this.updateSourcesDropdownUI();
                this.fetchDirectory('all');
            });

            this.sourcesListContainer.appendChild(card);
        });
    }

    handleAddSource() {
        const pathVal = this.inputSourcePath ? this.inputSourcePath.value.trim() : '';
        if (!pathVal) {
            window.showToast('Vui lòng nhập đường dẫn thư mục!', 'warning');
            return;
        }

        const existingSrc = this.sources.find(s => s.path.toLowerCase() === pathVal.toLowerCase());
        const targetSourceId = existingSrc ? existingSrc.id : null;

        this.showSourcesStatus('⏳ Đang quét đệ quy các thư mục con và lưu vào SQLite DB...', targetSourceId);
        fetch(`${this.backendHost}/api/sources/add?path=${encodeURIComponent(pathVal)}`, { credentials: 'include' })
            .then(res => res.json())
            .then(res => {
                if (res.success) {
                    this.showSourcesStatus(`✅ ${res.message} (${res.data.folder_count} folders, ${res.data.video_count} videos)`, targetSourceId);
                    window.showToast(res.message, 'success');
                    this.fetchSources();
                } else {
                    this.showSourcesStatus(`❌ Lỗi: ${res.message}`, targetSourceId);
                    window.showToast(`Lỗi: ${res.message}`, 'error');
                }
            })
            .catch(err => {
                this.showSourcesStatus('❌ Lỗi kết nối server!', targetSourceId);
                window.showToast('Lỗi kết nối server!', 'error');
            });
    }

    toggleRclonePanel(force = false) {
        if (this.rcloneSelectorBox.classList.contains('hidden') || force) {
            this.rcloneSelectorBox.classList.remove('hidden');
            // Fetch remotes
            fetch(`${this.backendHost}/api/rclone/remotes`)
                .then(res => res.json())
                .then(res => {
                    if (res.success && res.data) {
                        this.selectRcloneRemote.innerHTML = '<option value="">Chọn Google Drive Remote...</option>';
                        res.data.forEach(remote => {
                            const opt = document.createElement('option');
                            opt.value = remote;
                            opt.textContent = remote;
                            this.selectRcloneRemote.appendChild(opt);
                        });
                    }
                });
        } else {
            this.rcloneSelectorBox.classList.add('hidden');
        }
    }

    loadRcloneFolders() {
        const remote = this.selectRcloneRemote.value;
        if (!remote) {
            this.selectRcloneFolder.innerHTML = '<option value="">Chọn Thư mục...</option>';
            return;
        }
        this.selectRcloneFolder.innerHTML = '<option value="">⏳ Đang tải thư mục...</option>';
        fetch(`${this.backendHost}/api/rclone/folders?remote=${encodeURIComponent(remote)}`)
            .then(res => res.json())
            .then(res => {
                if (res.success && res.data) {
                    this.selectRcloneFolder.innerHTML = '<option value="">Chọn Thư mục...</option>';
                    res.data.forEach(folder => {
                        const opt = document.createElement('option');
                        opt.value = folder;
                        opt.textContent = folder;
                        this.selectRcloneFolder.appendChild(opt);
                    });
                } else {
                    this.selectRcloneFolder.innerHTML = '<option value="">Lỗi tải thư mục</option>';
                    window.showToast('Lỗi: ' + res.message, 'error');
                }
            });
    }

    handleAddRcloneSource() {
        const remote = this.selectRcloneRemote.value;
        const folder = this.selectRcloneFolder.value;
        if (!remote || !folder) {
            window.showToast('Vui lòng chọn remote và thư mục!', 'warning');
            return;
        }

        this.showSourcesStatus('⏳ Đang kết nối rclone và quét đệ quy...', null);
        fetch(`${this.backendHost}/api/sources/add?path=${encodeURIComponent(folder)}&is_rclone=true&remote=${encodeURIComponent(remote)}`, { credentials: 'include' })
            .then(res => res.json())
            .then(res => {
                if (res.success) {
                    this.showSourcesStatus(`✅ ${res.message} (${res.data.folder_count} folders, ${res.data.video_count} videos)`, null);
                    window.showToast(res.message, 'success');
                    this.fetchSources();
                    this.rcloneSelectorBox.classList.add('hidden');
                } else {
                    this.showSourcesStatus(`❌ Lỗi: ${res.message}`, null);
                    window.showToast(`Lỗi: ${res.message}`, 'error');
                }
            })
            .catch(err => {
                this.showSourcesStatus('❌ Lỗi kết nối server!', null);
                window.showToast('Lỗi kết nối server!', 'error');
            });
    }

    handleRescanSource(sourceId, pathStr, mode = 'update') {
        const isFull = mode === 'full';
        const loadingMsg = isFull ? `⏳ Đang quét lại toàn bộ...` : `⏳ Đang quét cập nhật thay đổi...`;
        this.showSourcesStatus(loadingMsg, sourceId);
        fetch(`${this.backendHost}/api/sources/rescan?id=${sourceId}&mode=${mode}`, { credentials: 'include' })
            .then(res => res.json())
            .then(res => {
                if (res.success) {
                    const infoMsg = res.message || (isFull ? `Đã quét lại toàn bộ thành công!` : `Đã cập nhật thay đổi thành công!`);
                    this.showSourcesStatus(`✅ ${infoMsg}`, sourceId);
                    window.showToast(infoMsg, 'success');
                    setTimeout(() => {
                        this.fetchSources();
                    }, 1000);
                } else {
                    this.showSourcesStatus(`❌ Lỗi: ${res.message}`, sourceId);
                    window.showToast(`Lỗi: ${res.message}`, 'error');
                }
            })
            .catch(err => {
                this.showSourcesStatus('❌ Lỗi kết nối server!', sourceId);
                window.showToast('Lỗi kết nối server!', 'error');
            });
    }

    handleDeleteSource(sourceId, pathStr) {
        window.showConfirm(`Bạn có chắc muốn xóa nguồn "${pathStr}" khỏi SQLite DB không?`, () => {
            this.showSourcesStatus(`⏳ Đang xóa...`, sourceId);
            fetch(`${this.backendHost}/api/sources/delete?id=${sourceId}`, { credentials: 'include' })
                .then(res => res.json())
                .then(res => {
                    if (res.success) {
                        this.showSourcesStatus('✅ Đã xóa nguồn thành công', sourceId);
                        window.showToast('Đã xóa nguồn thành công', 'success');
                        this.fetchSources();
                    } else {
                        this.showSourcesStatus(`❌ Lỗi: ${res.message}`, sourceId);
                        window.showToast(`Lỗi: ${res.message}`, 'error');
                    }
                });
        }, 'Xóa nguồn dữ liệu');
    }

    showSourcesStatus(msg, sourceId = null) {
        if (sourceId !== null && sourceId !== undefined) {
            const itemStatus = document.getElementById(`source-status-${sourceId}`);
            if (itemStatus) {
                itemStatus.innerText = msg;
                itemStatus.classList.remove('hidden');
            }
        }
        if (this.sourcesStatusMsg) {
            this.sourcesStatusMsg.innerText = msg;
            this.sourcesStatusMsg.classList.remove('hidden');
        }
    }

    handleExportSources() {
        fetch(`${this.backendHost}/api/sources`, { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                const sourcesData = data.sources || [];
                const jsonStr = JSON.stringify(sourcesData, null, 2);
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `vod_sources_${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            })
            .catch(err => {
                window.showToast('Lỗi xuất dữ liệu JSON: ' + err.message, 'error');
            });
    }

    handleImportSources(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const parsed = JSON.parse(evt.target.result);
                fetch(`${this.backendHost}/api/sources/import`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(parsed),
                    credentials: 'include'
                })
                    .then(res => res.json())
                    .then(res => {
                        if (res.success) {
                            window.showToast(res.message, 'success');
                            this.fetchSources();
                        } else {
                            window.showToast('Lỗi nhập dữ liệu: ' + res.message, 'error');
                        }
                    })
                    .catch(err => {
                        window.showToast('Lỗi kết nối server khi nhập JSON: ' + err.message, 'error');
                    });
            } catch (err) {
                window.showToast('File JSON không hợp lệ: ' + err.message, 'error');
            }
            e.target.value = '';
        };
        reader.readAsText(file);
    }

    handleRescanAllSources(mode = 'update') {
        const isFull = mode === 'full';
        const loadingMsg = isFull ? '⏳ Đang quét lại toàn bộ tất cả nguồn...' : '⏳ Đang quét cập nhật thay đổi tất cả nguồn...';
        this.sources.forEach(src => {
            this.showSourcesStatus(loadingMsg, src.id);
        });

        fetch(`${this.backendHost}/api/sources/rescan_all?mode=${mode}`, { credentials: 'include' })
            .then(res => res.json())
            .then(res => {
                if (res.success) {
                    this.fetchSources();
                    window.showToast(res.message || 'Quét thành công!', 'success');
                } else {
                    window.showToast('Lỗi quét: ' + res.message, 'error');
                }
            })
            .catch(err => {
                window.showToast('Lỗi kết nối server khi quét: ' + err.message, 'error');
            });
    }

    renderList() {
        if (this.activeTab === 'sources') return;
        let items = this.activeTab === 'videos' ? this.getGroupedVideoItems() : [...this.folders];

        if (this.badgeVideos && this.activeTab === 'videos') {
            this.badgeVideos.innerText = this.totalVideos || items.length;
        }

        const isGrid = true;
        if (this.listContainer) {
            this.listContainer.className = `explorer-list-container grid-mode cols-${this.gridCols || 2}`;
        }

        if (items.length === 0) {
            const emptyMsg = this.searchQuery 
                ? `Không tìm thấy video nào chứa "${this.escapeHtml(this.searchQuery)}"` 
                : (this.activeTab === 'videos' ? 'Không tìm thấy video nào trong thư mục' : 'Không có thư mục con nào');
            this.listContainer.innerHTML = `
                <div class="explorer-empty">
                    <span class="material-symbols-outlined">search_off</span>
                    <span>${emptyMsg}</span>
                </div>
            `;
            return;
        }

        if (this.topObserver) this.topObserver.disconnect();
        if (this.bottomObserver) this.bottomObserver.disconnect();

        this.listContainer.innerHTML = '';
        let playingRow = null;

        this.updateActiveFiltersBar();

        items.forEach(item => {
            if (!item) return;
            if (this.activeTab === 'folders') {
                const row = document.createElement('div');
                row.className = 'explorer-item';
                row.innerHTML = `
                    <div class="item-left">
                        <span class="material-symbols-outlined item-icon folder-icon">folder</span>
                        <div class="item-details">
                            <span class="item-name">${this.escapeHtml(item.name)}</span>
                            <span class="item-sub">Thư mục</span>
                        </div>
                    </div>
                    <span class="material-symbols-outlined item-arrow">chevron_right</span>
                `;
                row.addEventListener('click', () => {
                    this.fetchDirectory(item.path);
                });
                this.listContainer.appendChild(row);
            } else {
                const sources = item.sources || [];
                const activeSourceIndex = item.selectedSourceIndex || 0;
                const activeSource = sources[activeSourceIndex] || sources[0] || item;
                const itemCode = (item.code || item.name || '').toUpperCase();
                const curPlaying = (this.currentPlayingFilename || '').toUpperCase();
                const isPlaying = curPlaying && (itemCode === curPlaying || String(item.name || '').toUpperCase() === curPlaying);
                const hasMultipleSources = sources.length > 1;

                const vidId = activeSource.id || item.id;
                const vidPath = activeSource.path || item.path || activeSource.full_path;
                const coverSrc = this.getCoverUrl(activeSource || item);
                const codeBadge = item.code ? `<span class="meta-code-badge">${this.escapeHtml(item.code)}</span>` : '';
                const formattedDate = item.release_date ? window.formatRelativeReleaseDate(item.release_date) : '';
                const dateBadge = formattedDate ? `<span class="meta-date-badge">📅 ${this.escapeHtml(formattedDate)}</span>` : '';
                const displayTitle = this.escapeHtml(item.title || item.name || 'Video');
                const boxName = (Array.isArray(item.genres) && item.genres[0]) || (typeof item.genres === 'string' ? item.genres : '') || item.studio || item.maker || (typeof item.actress === 'string' ? item.actress : '') || '';
                const actressText = boxName ? `<span class="meta-actress clickable-tag" data-genre="${this.escapeHtml(boxName)}" title="Bấm để lọc theo chuyên mục ${this.escapeHtml(boxName)}">📁 ${this.escapeHtml(boxName)}</span>` : '';
                const sizeFormatted = activeSource.size_formatted || item.size_formatted || '';

                const isBroken = !!(item.hasError || item.has_error);
                const brokenBadge = isBroken ? `<span class="badge-broken-status" title="Video bị lỗi stream, đang chờ crawler cào lại link mới">⚠️ Lỗi link</span>` : '';

                // GridView Layout Card
                const card = document.createElement('div');
                card.className = `explorer-grid-card ${isPlaying ? 'playing-now' : ''} ${isBroken ? 'broken-card' : ''}`;
                card.setAttribute('data-code', itemCode);
                if (isPlaying) playingRow = card;

                const imgHtml = coverSrc 
                    ? `<img src="${coverSrc}" class="grid-card-thumb" alt="${displayTitle}" loading="lazy" decoding="async" onload="this.closest('.grid-card-cover-wrapper')?.classList.remove('cover-skeleton'); this.classList.add('loaded');" onerror="this.closest('.grid-card-cover-wrapper')?.classList.remove('cover-skeleton'); this.closest('.grid-card-cover-wrapper')?.classList.add('no-cover-fallback');" />`
                    : `<div class="grid-card-thumb-placeholder"><span class="material-symbols-outlined grid-placeholder-icon">${isPlaying ? 'graphic_eq' : 'movie'}</span></div>`;

                const sourceTagHtml = hasMultipleSources 
                    ? `<button class="btn-source-secondary grid-source-btn" title="Bấm để chuyển Nguồn phụ">
                            <span class="material-symbols-outlined" style="font-size:11px;">swap_calls</span>
                            ${activeSourceIndex + 1}/${item.sources.length}
                       </button>`
                    : '';

                const actressName = item.actress || (Array.isArray(item.actresses) ? item.actresses.join(', ') : '');
                const studioName = item.studio || item.maker || '';
                const actressHtml = actressName ? `<span class="meta-actress" title="Diễn viên: ${this.escapeHtml(actressName)}">👤 ${this.escapeHtml(actressName)}</span>` : '';
                const studioHtml = studioName ? `<span class="meta-studio" title="Studio: ${this.escapeHtml(studioName)}">🏢 ${this.escapeHtml(studioName)}</span>` : '';

                // Render GDrive / Queue Status Badge
                let gdriveBadgeHtml = '';
                const hasGDrive = !!(item.hasGDrive || item.has_gdrive);
                const inQueue = !!(item.inDownloadQueue || item.in_download_queue || item.in_queue);

                if (hasGDrive) {
                    gdriveBadgeHtml = `<span class="badge-gdrive-status has-gdrive" title="Đã có trên Google Drive"><span class="material-symbols-outlined" style="font-size:11px;">cloud_done</span> DRIVE</span>`;
                } else if (inQueue) {
                    gdriveBadgeHtml = `<button class="badge-gdrive-status in-queue btn-queue-action" data-code="${itemCode}" data-action="remove-queue" title="Đang trong hàng đợi tải (Bấm để hủy)"><span class="material-symbols-outlined" style="font-size:11px;">hourglass_top</span> Đang đợi</button>`;
                } else {
                    gdriveBadgeHtml = `<button class="badge-gdrive-status btn-add-queue btn-queue-action" data-code="${itemCode}" data-action="add-queue" title="Bấm để thêm vào Hàng đợi tải Google Drive"><span class="material-symbols-outlined" style="font-size:11px;">add_to_photos</span> + Drive</button>`;
                }

                card.innerHTML = `
                    <div class="grid-card-cover-wrapper ${coverSrc ? 'cover-skeleton' : ''}">
                        ${imgHtml}
                        <div class="grid-card-badges-top">
                            ${codeBadge}
                            ${gdriveBadgeHtml}
                        </div>
                        <div class="grid-card-badges-bottom">
                            ${dateBadge}
                            ${brokenBadge}
                        </div>
                        ${isPlaying ? '<span class="now-playing-tag grid-playing-tag">ĐANG PHÁT</span>' : ''}
                        <button class="grid-play-overlay-btn" title="${isPlaying ? 'Đang phát video này' : 'Phát video này'}">
                            <span class="material-symbols-outlined">${isPlaying ? 'volume_up' : 'play_arrow'}</span>
                        </button>
                    </div>
                    <div class="grid-card-info">
                        <div class="grid-card-title" title="${displayTitle}">${displayTitle}</div>
                        <div class="grid-card-submeta" style="display:flex; flex-direction:column; gap:2px; font-size:11px; color:#94a3b8; margin: 3px 0;">
                            ${actressHtml}
                            ${studioHtml}
                        </div>
                        <div class="grid-card-footer">
                            <span class="grid-card-size">${sizeFormatted}</span>
                            ${sourceTagHtml}
                        </div>
                    </div>
                `;

                card.addEventListener('click', (e) => {
                    const queueBtn = e.target.closest('.btn-queue-action');
                    if (queueBtn) {
                        e.stopPropagation();
                        const action = queueBtn.getAttribute('data-action');
                        const isAdding = action === 'add-queue';
                        this.toggleDownloadQueue(itemCode, isAdding, queueBtn, item);
                        return;
                    }
                    const genreTag = e.target.closest('[data-genre]');
                    if (genreTag) {
                        e.stopPropagation();
                        this.setFiltersAndRoute({ genres: genreTag.getAttribute('data-genre') }, false);
                        return;
                    }
                    const actTag = e.target.closest('[data-actress]');
                    if (actTag) {
                        e.stopPropagation();
                        this.setFiltersAndRoute({ actresses: actTag.getAttribute('data-actress') }, false);
                        return;
                    }
                    if (e.target.closest('.btn-source-secondary')) {
                        e.stopPropagation();
                        item.selectedSourceIndex = (activeSourceIndex + 1) % (sources.length || 1);
                        const nextSource = sources[item.selectedSourceIndex] || activeSource;
                        this.selectVideo(nextSource);
                        return;
                    }
                    this.selectVideo(activeSource);
                });
                this.listContainer.appendChild(card);
            }
        });

        // Render Bottom Pagination Bar (Chỉ hiển thị khi số lượng video > 12, dưới 12 không hiển thị)
        const videoCount = this.totalVideos !== undefined && this.totalVideos > 0 ? this.totalVideos : items.length;
        if (this.activeTab === 'videos' && videoCount > 12) {
            const bottomBar = this.createPaginationBar('bottom');
            this.listContainer.appendChild(bottomBar);
        }
    }

    selectVideo(videoItem, opts = {}) {
        if (!videoItem) return;
        const autoClose = opts.autoClose !== undefined ? opts.autoClose : true;
        const shouldUpdateRoute = opts.updateRoute !== undefined ? opts.updateRoute : true;

        const code = (videoItem.code || videoItem.name || '').toUpperCase();
        const coverSrc = this.getCoverUrl(videoItem);
        const title = videoItem.title || videoItem.name || code;
        const streamUrl = videoItem.stream_url || videoItem.video_url || `${this.backendHost}/api/hls/${encodeURIComponent(code)}/playlist.m3u8`;

        if (shouldUpdateRoute) {
            this.updateRoute('watch', '', {
                v: code,
                q: this.searchQuery,
                filter: this.activeExplorerCategory !== 'all' ? this.activeExplorerCategory : undefined,
                actresses: this.filterActress,
                genres: this.filterGenre,
                studios: this.filterStudio,
                sort_by: this.sortKey,
                sort_asc: this.sortAsc
            });
        }

        this.currentPlayingFilename = code;
        
        // Cache lại video trước và sau trong playlist/grid hiện tại của Explorer (ngăn wrap-around sai hướng)
        if (Array.isArray(this.videos) && this.videos.length > 0) {
            const idx = this.videos.findIndex(v => ((v.code || v.name || '').toUpperCase() === code));
            if (idx !== -1) {
                const total = this.videos.length;
                this.adjacentContext = {
                    currentCode: code,
                    prevVideo: idx > 0 ? this.videos[idx - 1] : (this.currentPage > 1 && this.pageCache && this.pageCache[this.currentPage - 1] ? this.pageCache[this.currentPage - 1][this.pageCache[this.currentPage - 1].length - 1] : null),
                    nextVideo: idx < total - 1 ? this.videos[idx + 1] : (this.currentPage < this.totalPages && this.pageCache && this.pageCache[this.currentPage + 1] ? this.pageCache[this.currentPage + 1][0] : null),
                    timestamp: Date.now()
                };
                if (idx >= total - 2 && this.currentPage < this.totalPages) {
                    this.preloadPage(this.currentPage + 1);
                }
                if (idx <= 1 && this.currentPage > 1) {
                    this.preloadPage(this.currentPage - 1);
                }
            }
        }

        // Tự động Nạp trước (Preload) thông tin & ảnh Cover của Next/Prev video cho Live Feed Preview
        this.preloadAdjacentFeedData(code);

        this.updateContextChips();
        if (autoClose) {
            this.close();
        }

        if (this.onVideoSelect) {
            this.onVideoSelect({
                ...videoItem,
                code: code,
                title: title,
                release_date: videoItem.release_date || videoItem.releaseDate || '',
                coverUrl: coverSrc,
                cover_url: coverSrc,
                m3u8Url: streamUrl,
                actress: videoItem.actress || '',
                actresses: videoItem.actresses || (videoItem.actress ? [videoItem.actress] : []),
                genre: videoItem.genre || '',
                genres: videoItem.genres || (videoItem.genre ? videoItem.genre.split(',').map(s => s.trim()).filter(Boolean) : []),
                studio: videoItem.maker || videoItem.studio || '',
                maker: videoItem.maker || videoItem.studio || '',
                inDownloadQueue: !!(videoItem.inDownloadQueue || videoItem.in_download_queue || videoItem.in_queue),
                hasGDrive: !!(videoItem.hasGDrive || videoItem.has_gdrive)
            });
        }
    }

    buildContextualAdjacentParams(code, direction) {
        const params = new URLSearchParams();
        params.append('code', code || '');
        params.append('direction', direction);
        if (this.searchQuery) params.append('search', this.searchQuery);
        if (this.searchQuery) params.append('q', this.searchQuery);
        if (this.filterActress) params.append('actress', this.filterActress);
        if (this.filterGenre) params.append('genre', this.filterGenre);
        if (this.filterStudio) params.append('studio', this.filterStudio);
        if (this.sortKey) params.append('sort_by', this.sortKey);
        params.append('sort_asc', this.sortAsc ? 'true' : 'false');
        const hasEntityFilter = !!(this.filterActress || this.filterGenre || this.filterStudio);
        const shouldApplyCoverFilter = this.activeExplorerCategory === 'all' && !hasEntityFilter;
        if (this.filterHasCover && shouldApplyCoverFilter) params.append('filter_has_cover', 'true');
        if (this.filterNoCover) params.append('filter_no_cover', 'true');
        if (this.filterUnviewed) {
            params.append('filter_unviewed', 'true');
        }
        if (this.activeExplorerCategory && this.activeExplorerCategory !== 'all') {
            const cat = this.activeExplorerCategory === 'queue' ? 'in_queue' : (this.activeExplorerCategory === 'gdrive' ? 'has_gdrive' : this.activeExplorerCategory);
            params.append('filter', cat);
            params.append('filter_type', cat);
        }
        if (this.currentContext) {
            if (this.currentContext.boxId) params.append('box_id', this.currentContext.boxId);
            if (this.currentContext.threadId) params.append('thread_id', this.currentContext.threadId);
        }
        return params;
    }

    updateContextChips() {
        const container = document.getElementById('video-context-chips');
        if (!container) return;

        const chips = [];

        // 1. Category filter (GDrive / Queue)
        if (this.activeExplorerCategory === 'gdrive' || this.activeExplorerCategory === 'has_gdrive') {
            chips.push({
                type: 'gdrive',
                val: 'gdrive',
                cssClass: 'chip-gdrive',
                icon: 'cloud_done',
                label: 'GDrive',
                onDelete: () => {
                    this.activeExplorerCategory = 'all';
                    this.refreshCurrentWatchContext();
                }
            });
        } else if (this.activeExplorerCategory === 'queue' || this.activeExplorerCategory === 'in_queue') {
            chips.push({
                type: 'queue',
                val: 'queue',
                cssClass: 'chip-queue',
                icon: 'hourglass_top',
                label: 'Hàng đợi',
                onDelete: () => {
                    this.activeExplorerCategory = 'all';
                    this.refreshCurrentWatchContext();
                }
            });
        }

        // 2. Search Query
        if (this.searchQuery) {
            const qDisplay = this.searchQuery.length > 18 ? this.searchQuery.slice(0, 16) + '...' : this.searchQuery;
            chips.push({
                type: 'search',
                val: this.searchQuery,
                cssClass: 'chip-search',
                icon: 'search',
                label: `"${qDisplay}"`,
                title: `Tìm kiếm: ${this.searchQuery}`,
                onDelete: () => {
                    this.searchQuery = '';
                    if (this.inputSearchVideo) this.inputSearchVideo.value = '';
                    if (this.btnClearSearch) this.btnClearSearch.classList.add('hidden');
                    if (this.searchWrapper) this.searchWrapper.classList.remove('active');
                    this.refreshCurrentWatchContext();
                }
            });
        }

        // 3. Actresses Filter
        if (this.filterActress) {
            const actList = this.filterActress.split(',').map(s => s.trim()).filter(Boolean);
            actList.forEach(act => {
                const actDisplay = act.length > 18 ? act.slice(0, 16) + '...' : act;
                const isFlash = this.lastToggledFilter && this.lastToggledFilter.type === 'actress' && this.lastToggledFilter.value.toLowerCase() === act.toLowerCase();
                chips.push({
                    type: 'actress',
                    val: act,
                    cssClass: `chip-actress ${isFlash ? 'chip-flash-pulse' : ''}`,
                    icon: 'person',
                    label: actDisplay,
                    title: `Diễn viên: ${act}`,
                    onDelete: () => {
                        this.removeFilterItem('actresses', act);
                    }
                });
            });
        }

        // 4. Genres Filter
        if (this.filterGenre) {
            const genList = this.filterGenre.split(',').map(s => s.trim()).filter(Boolean);
            genList.forEach(gen => {
                const genDisplay = gen.length > 18 ? gen.slice(0, 16) + '...' : gen;
                const isFlash = this.lastToggledFilter && this.lastToggledFilter.type === 'genre' && this.lastToggledFilter.value.toLowerCase() === gen.toLowerCase();
                chips.push({
                    type: 'genre',
                    val: gen,
                    cssClass: `chip-genre ${isFlash ? 'chip-flash-pulse' : ''}`,
                    icon: 'category',
                    label: genDisplay,
                    title: `Thể loại: ${gen}`,
                    onDelete: () => {
                        this.removeFilterItem('genres', gen);
                    }
                });
            });
        }

        // 5. Studios Filter
        if (this.filterStudio) {
            const stuList = this.filterStudio.split(',').map(s => s.trim()).filter(Boolean);
            stuList.forEach(stu => {
                const stuDisplay = stu.length > 18 ? stu.slice(0, 16) + '...' : stu;
                const isFlash = this.lastToggledFilter && this.lastToggledFilter.type === 'studio' && this.lastToggledFilter.value.toLowerCase() === stu.toLowerCase();
                chips.push({
                    type: 'studio',
                    val: stu,
                    cssClass: `chip-studio ${isFlash ? 'chip-flash-pulse' : ''}`,
                    icon: 'movie',
                    label: stuDisplay,
                    title: `Studio: ${stu}`,
                    onDelete: () => {
                        this.removeFilterItem('studios', stu);
                    }
                });
            });
        }

        this.lastToggledFilter = null;

        if (chips.length === 0) {
            container.innerHTML = '';
            container.classList.remove('has-chips');
            return;
        }

        let chipsHtml = chips.map(chip => `
            <div class="context-chip ${chip.cssClass || ''}" data-type="${chip.type}" ${chip.title ? `title="${this.escapeHtml(chip.title)}"` : ''}>
                <span class="material-symbols-outlined context-chip-icon">${chip.icon}</span>
                <span class="context-chip-text">${this.escapeHtml(chip.label)}</span>
                <button type="button" class="context-chip-delete" title="Bỏ lọc">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
        `).join('');

        if (chips.length >= 2) {
            chipsHtml += `
                <button type="button" class="context-chip-clear-all" id="btn-clear-all-chips" title="Xóa tất cả ${chips.length} bộ lọc ngữ cảnh">
                    <span class="material-symbols-outlined">delete_sweep</span>
                    <span>Xoá tất cả</span>
                </button>
            `;
        }

        container.innerHTML = chipsHtml;
        container.classList.add('has-chips');

        // Gán sự kiện xoá từng chip
        container.querySelectorAll('.context-chip').forEach((chipEl, idx) => {
            const btnDel = chipEl.querySelector('.context-chip-delete');
            if (btnDel && chips[idx] && chips[idx].onDelete) {
                btnDel.onclick = (e) => {
                    e.stopPropagation();
                    chips[idx].onDelete();
                };
            }
        });

        // Gán sự kiện xoá tất cả chips
        const btnClearAll = container.querySelector('#btn-clear-all-chips');
        if (btnClearAll) {
            btnClearAll.onclick = (e) => {
                e.stopPropagation();
                this.clearAllContextFilters();
            };
        }
    }

    clearAllContextFilters() {
        this.activeExplorerCategory = 'all';
        this.searchQuery = '';
        this.filterActress = '';
        this.filterGenre = '';
        this.filterStudio = '';
        this.lastToggledFilter = null;
        if (this.inputSearchVideo) this.inputSearchVideo.value = '';
        if (this.btnClearSearch) this.btnClearSearch.classList.add('hidden');
        if (this.searchWrapper) this.searchWrapper.classList.remove('active');
        this.refreshCurrentWatchContext();
        if (window.updateBottomTagsActiveState) {
            window.updateBottomTagsActiveState();
        }
    }

    refreshCurrentWatchContext() {
        this.updateContextChips();
        this.fetchDirectory(this.currentPath || 'all');
    }

    toggleFilter(type, value) {
        if (!value) return;
        const valClean = value.trim();
        if (!valClean) return;

        let isNowActive = false;
        const normalizedType = type.startsWith('act') ? 'actress' : (type.startsWith('gen') ? 'genre' : 'studio');

        if (type === 'actresses' || type === 'actress') {
            const list = this.filterActress ? this.filterActress.split(',').map(s => s.trim()).filter(Boolean) : [];
            const idx = list.findIndex(x => x.toLowerCase() === valClean.toLowerCase());
            if (idx >= 0) {
                list.splice(idx, 1);
                isNowActive = false;
            } else {
                list.push(valClean);
                isNowActive = true;
            }
            this.filterActress = list.join(',');
        } else if (type === 'genres' || type === 'genre') {
            const list = this.filterGenre ? this.filterGenre.split(',').map(s => s.trim()).filter(Boolean) : [];
            const idx = list.findIndex(x => x.toLowerCase() === valClean.toLowerCase());
            if (idx >= 0) {
                list.splice(idx, 1);
                isNowActive = false;
            } else {
                list.push(valClean);
                isNowActive = true;
            }
            this.filterGenre = list.join(',');
        } else if (type === 'studios' || type === 'studio') {
            const list = this.filterStudio ? this.filterStudio.split(',').map(s => s.trim()).filter(Boolean) : [];
            const idx = list.findIndex(x => x.toLowerCase() === valClean.toLowerCase());
            if (idx >= 0) {
                list.splice(idx, 1);
                isNowActive = false;
            } else {
                list.push(valClean);
                isNowActive = true;
            }
            this.filterStudio = list.join(',');
        }

        if (isNowActive) {
            this.lastToggledFilter = { type: normalizedType, value: valClean };
        } else {
            this.lastToggledFilter = null;
        }

        this.refreshCurrentWatchContext();
        if (window.updateBottomTagsActiveState) {
            window.updateBottomTagsActiveState();
        }
    }

    removeFilterItem(type, value) {
        if (!value) return;
        const valClean = value.trim().toLowerCase();
        if (type === 'actresses' || type === 'actress') {
            const list = this.filterActress ? this.filterActress.split(',').map(s => s.trim()).filter(Boolean) : [];
            this.filterActress = list.filter(x => x.toLowerCase() !== valClean).join(',');
        } else if (type === 'genres' || type === 'genre') {
            const list = this.filterGenre ? this.filterGenre.split(',').map(s => s.trim()).filter(Boolean) : [];
            this.filterGenre = list.filter(x => x.toLowerCase() !== valClean).join(',');
        } else if (type === 'studios' || type === 'studio') {
            const list = this.filterStudio ? this.filterStudio.split(',').map(s => s.trim()).filter(Boolean) : [];
            this.filterStudio = list.filter(x => x.toLowerCase() !== valClean).join(',');
        }
        this.lastToggledFilter = null;
        this.refreshCurrentWatchContext();
        if (window.updateBottomTagsActiveState) {
            window.updateBottomTagsActiveState();
        }
    }

    isFilterActive(type, value) {
        if (!value) return false;
        const valClean = value.trim().toLowerCase();
        let list = [];
        if (type === 'actresses' || type === 'actress') {
            list = this.filterActress ? this.filterActress.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
        } else if (type === 'genres' || type === 'genre') {
            list = this.filterGenre ? this.filterGenre.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
        } else if (type === 'studios' || type === 'studio') {
            list = this.filterStudio ? this.filterStudio.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
        }
        return list.includes(valClean);
    }

    preloadAdjacentFeedData(code) {
        if (!code) return;
        const cleanCode = code.trim().toUpperCase();
        if (this.lastPreloadedCode === cleanCode) return;
        this.lastPreloadedCode = cleanCode;

        let nextItem = null;
        let prevItem = null;

        if (this.adjacentContext && this.adjacentContext.currentCode === cleanCode) {
            nextItem = this.adjacentContext.nextVideo;
            prevItem = this.adjacentContext.prevVideo;
        } else if (Array.isArray(this.videos) && this.videos.length > 0) {
            const idx = this.videos.findIndex(v => ((v.code || v.name || '').toUpperCase() === cleanCode));
            if (idx !== -1) {
                const total = this.videos.length;
                prevItem = idx > 0 ? this.videos[idx - 1] : null;
                nextItem = idx < total - 1 ? this.videos[idx + 1] : null;
            }
        }

        const buildFeedObj = (item) => {
            if (!item) return null;
            const itemCode = (item.code || item.name || '').toUpperCase();
            let streamUrl = item.stream_url || item.video_url || '';
            const isGDrive = !!(window.__IS_GDRIVE_ONLY__ || (window.location.port === '3001') || (window.location.port === '3005') || item.is_gdrive || item.hasGDrive || item.gdrive_video_id);
            if (!streamUrl && itemCode) {
                if (isGDrive) {
                    streamUrl = `${this.backendHost}/api/gdrive/hls/${encodeURIComponent(itemCode)}.m3u8`;
                } else {
                    streamUrl = `${this.backendHost}/api/hls/${encodeURIComponent(itemCode)}/playlist.m3u8`;
                }
            }
            return {
                code: itemCode,
                title: item.title || itemCode,
                coverUrl: this.getCoverUrl(item),
                streamUrl: streamUrl,
                stream_url: streamUrl,
                is_gdrive: isGDrive
            };
        };

        const feedData = {
            next: buildFeedObj(nextItem),
            prev: buildFeedObj(prevItem)
        };

        if (window.playerInstance && window.playerInstance.setAdjacentFeedData) {
            window.playerInstance.setAdjacentFeedData(feedData);
        }

        // Tự động kiểm tra trang kế nếu đang ở cuối trang và trang trước nếu đang ở đầu trang
        if (!feedData.next && this.currentPage < this.totalPages) {
            if (this.pageCache && this.pageCache[this.currentPage + 1] && this.pageCache[this.currentPage + 1].length > 0) {
                feedData.next = buildFeedObj(this.pageCache[this.currentPage + 1][0]);
                if (window.playerInstance && window.playerInstance.setAdjacentFeedData) {
                    window.playerInstance.setAdjacentFeedData(feedData);
                }
            } else {
                this.preloadPage(this.currentPage + 1).then(nextVids => {
                    if (nextVids && nextVids.length > 0 && (this.currentPlayingFilename || '').toUpperCase() === cleanCode) {
                        if (this.adjacentContext && this.adjacentContext.currentCode === cleanCode && !this.adjacentContext.nextVideo) {
                            this.adjacentContext.nextVideo = nextVids[0];
                        }
                        const feedObj = buildFeedObj(nextVids[0]);
                        if (feedObj && window.playerInstance && window.playerInstance.setAdjacentFeedData) {
                            feedData.next = feedObj;
                            window.playerInstance.setAdjacentFeedData(feedData);
                        }
                    }
                });
            }
        }
        if (!feedData.prev && this.currentPage > 1) {
            if (this.pageCache && this.pageCache[this.currentPage - 1] && this.pageCache[this.currentPage - 1].length > 0) {
                const pVids = this.pageCache[this.currentPage - 1];
                feedData.prev = buildFeedObj(pVids[pVids.length - 1]);
                if (window.playerInstance && window.playerInstance.setAdjacentFeedData) {
                    window.playerInstance.setAdjacentFeedData(feedData);
                }
            } else {
                this.preloadPage(this.currentPage - 1).then(prevVids => {
                    if (prevVids && prevVids.length > 0 && (this.currentPlayingFilename || '').toUpperCase() === cleanCode) {
                        if (this.adjacentContext && this.adjacentContext.currentCode === cleanCode && !this.adjacentContext.prevVideo) {
                            this.adjacentContext.prevVideo = prevVids[prevVids.length - 1];
                        }
                        const feedObj = buildFeedObj(prevVids[prevVids.length - 1]);
                        if (feedObj && window.playerInstance && window.playerInstance.setAdjacentFeedData) {
                            feedData.prev = feedObj;
                            window.playerInstance.setAdjacentFeedData(feedData);
                        }
                    }
                });
            }
        }

        // Nếu chưa có Next hoặc Prev từ client cache, fetch ngầm từ API missav/adjacent_video lọc chuẩn ngữ cảnh hiện tại
        if (!feedData.next || !feedData.prev) {
            ['next', 'prev'].forEach(dir => {
                if (!feedData[dir]) {
                    const params = this.buildContextualAdjacentParams(cleanCode, dir);
                    fetch(`${this.backendHost}/api/adjacent_video?${params.toString()}`, { credentials: 'include' })
                        .then(res => res.json())
                        .then(res => {
                            const vid = res.video || res.next_video || res.prev_video;
                            if (res.success && vid) {
                                feedData[dir] = buildFeedObj(vid);
                                if (window.playerInstance && window.playerInstance.setAdjacentFeedData) {
                                    window.playerInstance.setAdjacentFeedData(feedData);
                                }
                            }
                        })
                        .catch(() => {});
                }
            });
        }
    }

    setCurrentPlayingFilename(filename) {
        if (!filename) return;
        const parts = filename.split(/[/\\]/);
        this.currentPlayingFilename = parts[parts.length - 1].trim().toUpperCase();
    }

    playNextVideo() {
        this.playAdjacentVideo('next');
    }

    playPrevVideo() {
        this.playAdjacentVideo('prev');
    }

    playAdjacentVideo(direction = 'next') {
        let rawTarget = (this.currentPlayingFilename || '').trim();
        if (!rawTarget && window.playerInstance && (window.playerInstance.currentVideoName || window.playerInstance.currentVideoPath)) {
            rawTarget = (window.playerInstance.currentVideoName || window.playerInstance.currentVideoPath).trim();
        }
        if (!rawTarget && window.location.hash) {
            const rawHash = (window.location.hash || '').replace(/^#\/?/, '');
            const [, qPart] = rawHash.split('?');
            if (qPart) {
                const sp = new URLSearchParams(qPart);
                if (sp.has('v')) rawTarget = sp.get('v') || '';
            }
        }
        const m = rawTarget.match(/([A-Za-z0-9]+-[0-9]+)/);
        const targetCode = m ? m[1].toUpperCase() : rawTarget.toUpperCase();
        if (targetCode && !this.currentPlayingFilename) {
            this.currentPlayingFilename = targetCode;
        }

        // 1. Kiểm tra nếu có cached adjacent video từ ngữ cảnh trình duyệt (Phát NGAY LẬP TỨC 0ms latency)
        let targetCachedVideo = null;
        if (this.adjacentContext && this.adjacentContext.currentCode === targetCode) {
            targetCachedVideo = direction === 'next' ? this.adjacentContext.nextVideo : this.adjacentContext.prevVideo;
        }

        // 2. Nếu chưa có từ adjacentContext, tìm vị trí trong this.videos
        let needPageCrossing = false;
        let crossingTargetPage = null;
        let crossingPlayIndex = null;

        if (!targetCachedVideo && Array.isArray(this.videos) && this.videos.length > 0) {
            const idx = this.videos.findIndex(v => ((v.code || v.name || '').toUpperCase() === targetCode));
            if (idx !== -1) {
                const total = this.videos.length;
                if (direction === 'next') {
                    if (idx < total - 1) {
                        targetCachedVideo = this.videos[idx + 1];
                    } else if (this.currentPage < this.totalPages) {
                        needPageCrossing = true;
                        crossingTargetPage = this.currentPage + 1;
                        crossingPlayIndex = 0;
                    }
                } else { // prev
                    if (idx > 0) {
                        targetCachedVideo = this.videos[idx - 1];
                    } else if (this.currentPage > 1) {
                        needPageCrossing = true;
                        crossingTargetPage = this.currentPage - 1;
                        crossingPlayIndex = -1; // last item
                    }
                }
            }
        }

        // 3. Nếu tìm thấy video trong cùng trang hoặc đã gán từ adjacentContext:
        if (targetCachedVideo) {
            // Kiểm tra xem targetCachedVideo có thuộc trang kế tiếp / trước đó không để đồng bộ currentPage
            if (Array.isArray(this.videos) && this.videos.length > 0) {
                const isTargetInCurrentList = this.videos.some(v => ((v.code || v.name || '').toUpperCase() === (targetCachedVideo.code || targetCachedVideo.name || '').toUpperCase()));
                if (!isTargetInCurrentList) {
                    if (direction === 'next' && this.currentPage < this.totalPages && this.pageCache && this.pageCache[this.currentPage + 1]) {
                        this.currentPage = this.currentPage + 1;
                        this.videos = this.pageCache[this.currentPage];
                        this.renderList();
                    } else if (direction === 'prev' && this.currentPage > 1 && this.pageCache && this.pageCache[this.currentPage - 1]) {
                        this.currentPage = this.currentPage - 1;
                        this.videos = this.pageCache[this.currentPage];
                        this.renderList();
                    }
                }
            }
            this.selectVideo(targetCachedVideo);
            return;
        }

        // 4. Nếu chạm ngưỡng biên trang (đầu trang hoặc cuối trang) -> Chuyển trang liền mạch
        if (needPageCrossing && crossingTargetPage) {
            // Nếu trang kế tiếp đã được nạp sẵn vào pageCache
            if (this.pageCache && this.pageCache[crossingTargetPage] && this.pageCache[crossingTargetPage].length > 0) {
                const pageVids = this.pageCache[crossingTargetPage];
                this.currentPage = crossingTargetPage;
                this.videos = pageVids;
                this.renderList();
                const vidToPlay = crossingPlayIndex === -1 ? pageVids[pageVids.length - 1] : pageVids[crossingPlayIndex || 0];
                if (vidToPlay) {
                    this.selectVideo(vidToPlay);
                    // Tiếp tục preload trang tiếp theo
                    if (direction === 'next' && this.currentPage < this.totalPages) {
                        this.preloadPage(this.currentPage + 1);
                    } else if (direction === 'prev' && this.currentPage > 1) {
                        this.preloadPage(this.currentPage - 1);
                    }
                    return;
                }
            }

            // Nếu trang chưa có trong cache, hiển thị loading giữ nguyên cover và tải trang
            const preloadedFeed = (window.playerInstance && window.playerInstance.adjacentFeedData) ? window.playerInstance.adjacentFeedData[direction] : null;
            const persistentCover = (preloadedFeed && (preloadedFeed.coverUrl || preloadedFeed.cover_url)) || (window.playerInstance ? window.playerInstance.currentCoverSrc : '');
            if (window.playerInstance && window.playerInstance.showLoading) {
                window.playerInstance.showLoading({
                    title: (preloadedFeed && (preloadedFeed.title || preloadedFeed.code)) || (direction === 'next' ? `Đang chuyển sang Trang ${crossingTargetPage}...` : `Đang quay lại Trang ${crossingTargetPage}...`),
                    coverSrc: persistentCover,
                    status: `Đang tải danh sách Trang ${crossingTargetPage}...`
                });
            }

            this.preloadPage(crossingTargetPage).then(pageVids => {
                if (pageVids && pageVids.length > 0) {
                    this.currentPage = crossingTargetPage;
                    this.videos = pageVids;
                    this.renderList();
                    const vidToPlay = crossingPlayIndex === -1 ? pageVids[pageVids.length - 1] : pageVids[crossingPlayIndex || 0];
                    if (vidToPlay) {
                        this.selectVideo(vidToPlay);
                        if (direction === 'next' && this.currentPage < this.totalPages) {
                            this.preloadPage(this.currentPage + 1);
                        } else if (direction === 'prev' && this.currentPage > 1) {
                            this.preloadPage(this.currentPage - 1);
                        }
                    }
                } else {
                    this.fallbackAdjacentFetch(targetCode, direction);
                }
            }).catch(() => {
                this.fallbackAdjacentFetch(targetCode, direction);
            });
            return;
        }

        // 5. Fallback fetch API missav/adjacent_video nếu không xác định được vị trí client
        this.fallbackAdjacentFetch(targetCode, direction);
    }

    fallbackAdjacentFetch(targetCode, direction) {
        const preloadedFeed = (window.playerInstance && window.playerInstance.adjacentFeedData) ? window.playerInstance.adjacentFeedData[direction] : null;
        const persistentCover = (preloadedFeed && (preloadedFeed.coverUrl || preloadedFeed.cover_url)) || (window.playerInstance ? window.playerInstance.currentCoverSrc : '');
        if (window.playerInstance && window.playerInstance.showLoading) {
            window.playerInstance.showLoading({
                title: (preloadedFeed && (preloadedFeed.title || preloadedFeed.code)) || (direction === 'next' ? 'Đang nạp video tiếp theo...' : 'Đang nạp video trước đó...'),
                coverSrc: persistentCover,
                status: 'Đang tìm kiếm thông tin video...'
            });
        }

        const params = this.buildContextualAdjacentParams(targetCode, direction);

        if (this.adjacentFetchController) {
            try { this.adjacentFetchController.abort(); } catch (e) {}
        }
        this.adjacentFetchController = new AbortController();
        const signal = this.adjacentFetchController.signal;

        const url = `${this.backendHost}/api/adjacent_video?${params.toString()}`;
        fetch(url, { credentials: 'include', signal: signal })
            .then(res => res.json())
            .then(async res => {
                const targetVid = res.video || res.next_video || res.prev_video;
                if (res.success && targetVid) {
                    const newThreadId = targetVid.thread_id ? String(targetVid.thread_id) : '';
                    const oldThreadId = this.currentContext?.threadId ? String(this.currentContext.threadId) : '';
                    if (newThreadId && newThreadId !== oldThreadId) {
                        this.setCurrentContext({
                            threadId: newThreadId,
                            threadName: targetVid.thread_name || this.currentContext?.threadName || '',
                            boxId: targetVid.box_id || this.currentContext?.boxId || '',
                            boxName: targetVid.box_name || this.currentContext?.boxName || ''
                        });
                        try {
                            const vUrl = `${this.backendHost}/api/videos?thread_id=${encodeURIComponent(newThreadId)}&limit=60`;
                            const vRes = await fetch(vUrl, { credentials: 'include' });
                            const vData = await vRes.json();
                            if (vData && Array.isArray(vData.videos) && vData.videos.length > 0) {
                                this.videos = vData.videos;
                                this.totalVideos = vData.total !== undefined ? vData.total : vData.videos.length;
                                this.totalPages = vData.totalPages !== undefined ? vData.totalPages : 1;
                                this.currentPage = 1;
                            }
                        } catch (e) {
                            console.debug('[OnePlayer] Error refreshing videos for new thread:', e);
                        }
                    }
                    this.selectVideo(targetVid);
                } else if (res.message || res.error) {
                    if (window.showToast) window.showToast(res.message || res.error, 'warning');
                }
            })
            .catch(err => {
                if (err.name === 'AbortError') return;
                console.error('Lỗi API missav adjacent_video:', err);
            });
    }

    toggleDownloadQueue(code, isAdding = true, buttonEl = null, item = null) {
        if (!code) return;
        const codeClean = code.trim().toUpperCase();
        const url = `${this.backendHost}/api/queue`;
        const method = isAdding ? 'POST' : 'DELETE';
        const body = JSON.stringify({ code: codeClean });

        fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: body,
            credentials: 'include'
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                window.showToast(data.message || (isAdding ? `Đã thêm ${codeClean} vào hàng đợi tải (:5052/codes ⏳ Chưa Upload GDrive)` : `Đã xóa ${codeClean} khỏi hàng đợi`), 'success');
                if (item) {
                    item.inDownloadQueue = isAdding;
                }
                if (buttonEl) {
                    if (isAdding) {
                        buttonEl.className = 'badge-gdrive-status in-queue btn-queue-action in-queue';
                        buttonEl.setAttribute('data-action', 'remove-queue');
                        buttonEl.setAttribute('title', 'Đang trong hàng đợi tải (Bấm để hủy)');
                        buttonEl.innerHTML = `<span class="material-symbols-outlined">hourglass_top</span> Đang đợi tải`;
                    } else {
                        buttonEl.className = 'badge-gdrive-status btn-add-queue btn-queue-action';
                        buttonEl.setAttribute('data-action', 'add-queue');
                        buttonEl.setAttribute('title', 'Chưa có trên Google Drive - Bấm để thêm vào Hàng đợi Tải');
                        buttonEl.innerHTML = `<span class="material-symbols-outlined">add_to_photos</span> + Tải GDrive`;
                    }
                }
                if (window.playerInstance && (window.playerInstance.currentVideoName || window.playerInstance.currentVideoPath || '').toUpperCase() === codeClean) {
                    window.playerInstance.setQueueState(isAdding);
                }
                window.dispatchEvent(new CustomEvent('missav:queue-updated', {
                    detail: { code: codeClean, inQueue: isAdding }
                }));
            } else {
                window.showToast(data.error || 'Có lỗi xảy ra', 'error');
            }
        })
        .catch(err => {
            console.error('Lỗi toggleDownloadQueue:', err);
            window.showToast('Không thể kết nối đến Backend', 'error');
        });
    }

    handleGDriveDeleted(code) {
        const codeClean = (code || '').trim().toUpperCase();
        if (!codeClean) return;

        if (Array.isArray(this.currentVideos)) {
            this.currentVideos.forEach(item => {
                if ((item.code || item.name || '').toUpperCase() === codeClean) {
                    item.hasGDrive = false;
                    item.has_gdrive = false;
                    item.inDownloadQueue = false;
                    item.in_queue = false;
                }
            });
            this.renderVideoGrid();
        }
    }

    getAuthHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };
        const token = (this.currentUser && this.currentUser.token) || localStorage.getItem('jwt_token') || '';
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        let guestId = localStorage.getItem('rphang_guest_id');
        if (!guestId) {
            guestId = 'guest_' + Math.random().toString(36).substring(2, 12);
            try { localStorage.setItem('rphang_guest_id', guestId); } catch(e) {}
        }
        headers['X-Guest-ID'] = guestId;
        return headers;
    }

    checkUserAuth() {
        fetch(`${this.backendHost}/api/auth/me`, {
            headers: this.getAuthHeaders(),
            credentials: 'include'
        })
        .then(res => res.json())
        .then(data => {
            if (data.success && data.user) {
                this.currentUser = data.user;
                if (data.token) {
                    try { localStorage.setItem('jwt_token', data.token); } catch(e) {}
                }
                if (data.authenticated && !data.user.is_anonymous) {
                    this.showProfile(data.user.email || data.user.gmail, data.user.id, false);
                } else {
                    this.showProfile(data.user.email || data.user.gmail || `Khách (${data.user.id.slice(0, 8)})`, data.user.id, true);
                }
            } else {
                this.showAuthForm();
            }
        })
        .catch(err => {
            console.error('Error checking auth:', err);
            this.showAuthForm();
        });
    }

    showProfile(gmail, userId = '', isAnonymous = false) {
        if (this.authFormsContainer) this.authFormsContainer.classList.add('hidden');
        if (this.authProfileContainer) this.authProfileContainer.classList.remove('hidden');
        const token = (this.currentUser && this.currentUser.token) || localStorage.getItem('jwt_token') || '';
        const tokenShort = token ? `${token.slice(0, 16)}...${token.slice(-12)}` : 'Chưa có Token';
        if (this.userEmailDisplay) {
            this.userEmailDisplay.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 6px; width: 100%;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-weight: 600; font-size: 14px; color: #fff;">${this.escapeHtml(gmail)}</span>
                        ${isAnonymous ? '<span style="color:#ff9800; font-size:10px; font-weight:700; background:rgba(255,152,0,0.2); padding:2px 8px; border-radius:12px; border:1px solid rgba(255,152,0,0.4);">GUEST JWT</span>' : '<span style="color:#00e676; font-size:10px; font-weight:700; background:rgba(0,230,118,0.2); padding:2px 8px; border-radius:12px; border:1px solid rgba(0,230,118,0.4);">MEMBER JWT (FOREVER)</span>'}
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: rgba(255,255,255,0.45); font-family: monospace;">
                        <span>UID: ${this.escapeHtml(userId || '')}</span>
                    </div>
                    ${token ? `
                    <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); margin-top: 2px;">
                        <span style="font-size: 10px; color: rgba(255,255,255,0.6); font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;" title="${token}">JWT: ${tokenShort}</span>
                        <button id="btn-copy-jwt" style="background:none; border:none; color: #fe2c55; cursor:pointer; font-size:10px; font-weight:600; padding:2px 4px; display:flex; align-items:center; gap:2px;" title="Sao chép toàn bộ JWT Token">
                            <span class="material-symbols-outlined" style="font-size:13px;">content_copy</span> Copy
                        </button>
                    </div>` : ''}
                </div>
            `;
            const btnCopy = this.userEmailDisplay.querySelector('#btn-copy-jwt');
            if (btnCopy && token) {
                btnCopy.onclick = (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(token).then(() => {
                        window.showToast('Đã sao chép JWT Token vĩnh viễn vào clipboard!', 'success');
                    }).catch(() => {
                        window.showToast('Không thể sao chép Token', 'error');
                    });
                };
            }
        }
        if (this.btnToggleUserAccount) {
            this.btnToggleUserAccount.classList.add('active');
            this.btnToggleUserAccount.title = isAnonymous ? `Khách (${userId.slice(0, 8)})` : `Tài khoản (${gmail})`;
        }
    }

    showAuthForm() {
        if (this.authFormsContainer) this.authFormsContainer.classList.remove('hidden');
        if (this.authProfileContainer) this.authProfileContainer.classList.add('hidden');
        if (this.btnToggleUserAccount) {
            this.btnToggleUserAccount.classList.remove('active');
            this.btnToggleUserAccount.title = 'Đăng nhập / Đăng ký';
        }
    }

    openUserDrawer() {
        this.closeAllDrawers('user');
        if (this.userDrawerModal) {
            this.userDrawerModal.classList.remove('hidden');
            this.checkUserAuth();
            this.loadActiveHistoryTab();
        }
        this.updateRoute('profile');
    }

    closeUserDrawer() {
        if (this.userDrawerModal) {
            this.userDrawerModal.classList.add('hidden');
        }
        this.checkAndClearRouteIfAllClosed();
    }

    switchAuthTab(mode) {
        // mode: 'otp' | 'password'
        this.authMode = mode;
        if (mode === 'otp') {
            if (this.authTabOtp) this.authTabOtp.classList.add('active');
            if (this.authTabPassword) this.authTabPassword.classList.remove('active');
            if (this.authViewOtp) this.authViewOtp.classList.remove('hidden');
            if (this.authViewPassword) this.authViewPassword.classList.add('hidden');
        } else {
            if (this.authTabOtp) this.authTabOtp.classList.remove('active');
            if (this.authTabPassword) this.authTabPassword.classList.add('active');
            if (this.authViewOtp) this.authViewOtp.classList.add('hidden');
            if (this.authViewPassword) this.authViewPassword.classList.remove('hidden');
        }
    }

    handleSendOtp(isResend = false) {
        const email = this.authOtpEmailInput ? this.authOtpEmailInput.value.trim().toLowerCase() : '';
        if (!email || !email.includes('@')) {
            window.showToast('Vui lòng nhập địa chỉ email hợp lệ!', 'warning');
            return;
        }

        if (this.btnAuthSendOtp) {
            this.btnAuthSendOtp.disabled = true;
            this.btnAuthSendOtp.innerText = 'Đang gửi mã...';
        }

        fetch(`${this.backendHost}/api/auth/send-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        })
        .then(res => res.json())
        .then(data => {
            if (this.btnAuthSendOtp) {
                this.btnAuthSendOtp.disabled = false;
                this.btnAuthSendOtp.innerText = 'Gửi mã xác thực OTP';
            }
            if (data.success) {
                window.showToast(data.message || 'Đã gửi mã OTP!', 'success');
                if (this.authOtpTargetEmail) this.authOtpTargetEmail.innerText = email;
                if (this.otpStepEmail) this.otpStepEmail.classList.add('hidden');
                if (this.otpStepVerify) this.otpStepVerify.classList.remove('hidden');
                if (this.authOtpCodeInput) {
                    this.authOtpCodeInput.value = '';
                    this.authOtpCodeInput.focus();
                }
            } else {
                window.showToast(data.error || 'Không thể gửi mã OTP!', 'error');
            }
        })
        .catch(err => {
            if (this.btnAuthSendOtp) {
                this.btnAuthSendOtp.disabled = false;
                this.btnAuthSendOtp.innerText = 'Gửi mã xác thực OTP';
            }
            console.error('Send OTP error:', err);
            window.showToast('Lỗi kết nối máy chủ!', 'error');
        });
    }

    handleVerifyOtp() {
        const email = this.authOtpEmailInput ? this.authOtpEmailInput.value.trim().toLowerCase() : '';
        const otp = this.authOtpCodeInput ? this.authOtpCodeInput.value.trim() : '';
        const password = this.authOtpNewPassword ? this.authOtpNewPassword.value.trim() : '';

        if (!email || !otp) {
            window.showToast('Vui lòng nhập đầy đủ email và mã OTP!', 'warning');
            return;
        }

        if (this.btnAuthVerifyOtp) {
            this.btnAuthVerifyOtp.disabled = true;
            this.btnAuthVerifyOtp.innerText = 'Đang xác thực...';
        }

        fetch(`${this.backendHost}/api/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp, password })
        })
        .then(res => res.json())
        .then(data => {
            if (this.btnAuthVerifyOtp) {
                this.btnAuthVerifyOtp.disabled = false;
                this.btnAuthVerifyOtp.innerText = 'Xác thực & Đăng nhập';
            }
            if (data.success) {
                window.showToast(data.message || 'Đăng nhập thành công!', 'success');
                if (data.token) {
                    try { localStorage.setItem('jwt_token', data.token); } catch(e) {}
                }
                this.currentUser = data.user;
                this.checkUserAuth();
                this.loadActiveHistoryTab();
            } else {
                window.showToast(data.error || 'Mã OTP không chính xác!', 'error');
            }
        })
        .catch(err => {
            if (this.btnAuthVerifyOtp) {
                this.btnAuthVerifyOtp.disabled = false;
                this.btnAuthVerifyOtp.innerText = 'Xác thực & Đăng nhập';
            }
            console.error('Verify OTP error:', err);
            window.showToast('Lỗi kết nối máy chủ!', 'error');
        });
    }

    handlePasswordLogin() {
        const email = this.authPassEmailInput ? this.authPassEmailInput.value.trim().toLowerCase() : '';
        const password = this.authPassValueInput ? this.authPassValueInput.value : '';

        if (!email || !password) {
            window.showToast('Vui lòng nhập Email và Mật khẩu!', 'warning');
            return;
        }

        fetch(`${this.backendHost}/api/auth/login-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                window.showToast(data.message || 'Đăng nhập thành công!', 'success');
                if (data.token) {
                    try { localStorage.setItem('jwt_token', data.token); } catch(e) {}
                }
                this.currentUser = data.user;
                this.checkUserAuth();
                this.loadActiveHistoryTab();
            } else {
                window.showToast(data.error || 'Email hoặc mật khẩu không chính xác!', 'error');
            }
        })
        .catch(err => {
            console.error('Password login error:', err);
            window.showToast('Lỗi kết nối máy chủ!', 'error');
        });
    }

    handleAuthLogout() {
        window.showConfirm('Bạn có chắc chắn muốn đăng xuất tài khoản không?', () => {
            try { localStorage.removeItem('jwt_token'); } catch(e) {}
            this.currentUser = null;
            fetch(`${this.backendHost}/api/auth/logout`, {
                method: 'POST',
                headers: this.getAuthHeaders()
            })
            .then(res => res.json())
            .then(data => {
                window.showToast(data.message || 'Đã đăng xuất', 'success');
                this.checkUserAuth();
                this.loadActiveHistoryTab();
            })
            .catch(() => {
                this.checkUserAuth();
                this.loadActiveHistoryTab();
            });
        }, 'Đăng xuất');
    }

    switchHistoryTab(tabName) {
        // tabName: 'view' | 'search' | 'favorite'
        this.activeHistoryTab = tabName;

        const tabs = [this.tabHistoryView, this.tabHistorySearch, this.tabHistoryFavorite];
        const panels = [this.panelHistoryView, this.panelHistorySearch, this.panelHistoryFavorite];

        tabs.forEach(t => t && t.classList.remove('active'));
        panels.forEach(p => p && p.classList.add('hidden'));

        if (tabName === 'view') {
            if (this.tabHistoryView) this.tabHistoryView.classList.add('active');
            if (this.panelHistoryView) this.panelHistoryView.classList.remove('hidden');
        } else if (tabName === 'search') {
            if (this.tabHistorySearch) this.tabHistorySearch.classList.add('active');
            if (this.panelHistorySearch) this.panelHistorySearch.classList.remove('hidden');
        } else if (tabName === 'favorite') {
            if (this.tabHistoryFavorite) this.tabHistoryFavorite.classList.add('active');
            if (this.panelHistoryFavorite) this.panelHistoryFavorite.classList.remove('hidden');
        }

        this.loadActiveHistoryTab();
    }

    loadActiveHistoryTab() {
        if (this.activeHistoryTab === 'view') {
            this.fetchViewHistory();
        } else if (this.activeHistoryTab === 'search') {
            this.fetchSearchHistory();
        } else if (this.activeHistoryTab === 'favorite') {
            this.fetchFavorites();
        }
    }

    fetchViewHistory() {
        if (!this.historyViewList) return;
        this.historyViewList.innerHTML = '<div style="padding:20px;text-align:center;color:#888;">Đang tải...</div>';

        fetch(`${this.backendHost}/api/history/view`, {
            headers: this.getAuthHeaders(),
            credentials: 'include'
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    this.renderHistoryList(this.historyViewList, data.history, 'view');
                } else {
                    this.historyViewList.innerHTML = `<div class="history-empty-state"><span class="material-symbols-outlined">error</span><span>Lỗi: ${data.message || 'Không thể tải lịch sử'}</span></div>`;
                }
            })
            .catch(err => {
                console.error('Error fetching view history:', err);
                this.historyViewList.innerHTML = '<div class="history-empty-state"><span class="material-symbols-outlined">wifi_off</span><span>Lỗi kết nối máy chủ</span></div>';
            });
    }

    fetchSearchHistory() {
        if (!this.historySearchList) return;
        this.historySearchList.innerHTML = '<div style="padding:20px;text-align:center;color:#888;">Đang tải...</div>';

        fetch(`${this.backendHost}/api/history/search`, {
            headers: this.getAuthHeaders(),
            credentials: 'include'
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    this.renderHistoryList(this.historySearchList, data.history, 'search');
                } else {
                    this.historySearchList.innerHTML = `<div class="history-empty-state"><span class="material-symbols-outlined">error</span><span>Lỗi: ${data.message || 'Không thể tải lịch sử'}</span></div>`;
                }
            })
            .catch(err => {
                console.error('Error fetching search history:', err);
                this.historySearchList.innerHTML = '<div class="history-empty-state"><span class="material-symbols-outlined">wifi_off</span><span>Lỗi kết nối máy chủ</span></div>';
            });
    }

    fetchFavorites() {
        if (!this.historyFavoriteList) return;
        this.historyFavoriteList.innerHTML = '<div style="padding:20px;text-align:center;color:#888;">Đang tải...</div>';

        fetch(`${this.backendHost}/api/history/favorites`, {
            headers: this.getAuthHeaders(),
            credentials: 'include'
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    this.renderHistoryList(this.historyFavoriteList, data.favorites, 'favorite');
                } else {
                    this.historyFavoriteList.innerHTML = `<div class="history-empty-state"><span class="material-symbols-outlined">error</span><span>Lỗi: ${data.message || 'Không thể tải yêu thích'}</span></div>`;
                }
            })
            .catch(err => {
                console.error('Error fetching favorites:', err);
                this.historyFavoriteList.innerHTML = '<div class="history-empty-state"><span class="material-symbols-outlined">wifi_off</span><span>Lỗi kết nối máy chủ</span></div>';
            });
    }

    renderHistoryList(container, items, type) {
        if (!items || items.length === 0) {
            let icon = 'history';
            let msg = 'Chưa có lịch sử';
            if (type === 'search') {
                icon = 'search_off';
                msg = 'Chưa tìm kiếm từ khóa nào';
            } else if (type === 'favorite') {
                icon = 'heart_broken';
                msg = 'Danh sách yêu thích trống';
            }
            container.innerHTML = `
                <div class="history-empty-state">
                    <span class="material-symbols-outlined">${icon}</span>
                    <span>${msg}</span>
                </div>
            `;
            return;
        }

        let html = '';
        items.forEach(item => {
            if (type === 'search') {
                html += `
                    <div class="history-item-card" data-query="${encodeURIComponent(item.query)}">
                        <span class="material-symbols-outlined history-item-icon">search</span>
                        <div class="history-item-details">
                            <span class="history-item-title">${this.escapeHtml(item.query)}</span>
                            <span class="history-item-subtitle">${item.searched_at}</span>
                        </div>
                    </div>
                `;
            } else {
                const icon = type === 'favorite' ? 'favorite' : 'play_circle';
                html += `
                    <div class="history-item-card" data-path="${encodeURIComponent(item.path)}">
                        <span class="material-symbols-outlined history-item-icon">${icon}</span>
                        <div class="history-item-details">
                            <span class="history-item-title">${this.escapeHtml(item.title || item.name)}</span>
                            <span class="history-item-subtitle">${this.escapeHtml(item.path)}</span>
                        </div>
                    </div>
                `;
            }
        });

        container.innerHTML = html;

        // Bind clicks on cards
        container.querySelectorAll('.history-item-card').forEach(card => {
            card.onclick = () => {
                if (type === 'search') {
                    const query = decodeURIComponent(card.getAttribute('data-query'));
                    if (this.inputSearchVideo) {
                        if (this.searchWrapper) this.searchWrapper.classList.add('active');
                        this.inputSearchVideo.value = query;
                        this.searchQuery = query;
                        this.closeUserDrawer();
                        this.open();
                        this.setActiveTab('videos');
                        this.fetchDirectory(this.currentPath);
                    }
                } else {
                    const path = decodeURIComponent(card.getAttribute('data-path'));
                    this.onVideoSelect(path);
                    this.closeUserDrawer();
                }
            };
        });
    }

    clearViewHistory() {
        window.showConfirm('Bạn có chắc chắn muốn xoá toàn bộ lịch sử xem video không?', () => {
            fetch(`${this.backendHost}/api/history/view/clear`, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    window.showToast(data.message, 'success');
                    this.fetchViewHistory();
                } else {
                    window.showToast(data.message, 'error');
                }
            })
            .catch(err => {
                console.error('Clear view history error:', err);
                window.showToast('Lỗi kết nối máy chủ!', 'error');
            });
        }, 'Xoá lịch sử xem');
    }

    clearSearchHistory() {
        window.showConfirm('Bạn có chắc chắn muốn xoá toàn bộ lịch sử tìm kiếm không?', () => {
            fetch(`${this.backendHost}/api/history/search/clear`, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    window.showToast(data.message, 'success');
                    this.fetchSearchHistory();
                    if (this.activeSearchTab === 'words') {
                        this.fetchSearchDrawerData();
                    }
                } else {
                    window.showToast(data.message, 'error');
                }
            })
            .catch(err => {
                console.error('Clear search history error:', err);
                window.showToast('Lỗi kết nối máy chủ!', 'error');
            });
        }, 'Xoá lịch sử tìm kiếm');
    }

    toggleFilter(type, value) {
        if (!value) return;
        const valClean = value.trim();
        if (!valClean) return;

        let isNowActive = false;
        const normalizedType = type.startsWith('act') ? 'actress' : (type.startsWith('gen') ? 'genre' : 'studio');

        if (type === 'actresses' || type === 'actress') {
            const list = this.filterActress ? this.filterActress.split(',').map(s => s.trim()).filter(Boolean) : [];
            const idx = list.findIndex(x => x.toLowerCase() === valClean.toLowerCase());
            if (idx >= 0) {
                list.splice(idx, 1);
                isNowActive = false;
            } else {
                list.push(valClean);
                isNowActive = true;
            }
            this.filterActress = list.join(',');
        } else if (type === 'genres' || type === 'genre') {
            const list = this.filterGenre ? this.filterGenre.split(',').map(s => s.trim()).filter(Boolean) : [];
            const idx = list.findIndex(x => x.toLowerCase() === valClean.toLowerCase());
            if (idx >= 0) {
                list.splice(idx, 1);
                isNowActive = false;
            } else {
                list.push(valClean);
                isNowActive = true;
            }
            this.filterGenre = list.join(',');
        } else if (type === 'studios' || type === 'studio') {
            const list = this.filterStudio ? this.filterStudio.split(',').map(s => s.trim()).filter(Boolean) : [];
            const idx = list.findIndex(x => x.toLowerCase() === valClean.toLowerCase());
            if (idx >= 0) {
                list.splice(idx, 1);
                isNowActive = false;
            } else {
                list.push(valClean);
                isNowActive = true;
            }
            this.filterStudio = list.join(',');
        }

        if (isNowActive) {
            this.lastToggledFilter = { type: normalizedType, value: valClean };
        } else {
            this.lastToggledFilter = null;
        }

        this.refreshCurrentWatchContext();
        if (window.updateBottomTagsActiveState) {
            window.updateBottomTagsActiveState();
        }
    }

    removeFilterItem(type, value) {
        if (!value) return;
        const valClean = value.trim().toLowerCase();
        if (type === 'actresses' || type === 'actress') {
            const list = this.filterActress ? this.filterActress.split(',').map(s => s.trim()).filter(Boolean) : [];
            this.filterActress = list.filter(x => x.toLowerCase() !== valClean).join(',');
        } else if (type === 'genres' || type === 'genre') {
            const list = this.filterGenre ? this.filterGenre.split(',').map(s => s.trim()).filter(Boolean) : [];
            this.filterGenre = list.filter(x => x.toLowerCase() !== valClean).join(',');
        } else if (type === 'studios' || type === 'studio') {
            const list = this.filterStudio ? this.filterStudio.split(',').map(s => s.trim()).filter(Boolean) : [];
            this.filterStudio = list.filter(x => x.toLowerCase() !== valClean).join(',');
        }
        this.lastToggledFilter = null;
        this.refreshCurrentWatchContext();
        if (window.updateBottomTagsActiveState) {
            window.updateBottomTagsActiveState();
        }
    }

    isFilterActive(type, value) {
        if (!value) return false;
        const valClean = value.trim().toLowerCase();
        let list = [];
        if (type === 'actresses' || type === 'actress') {
            list = this.filterActress ? this.filterActress.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
        } else if (type === 'genres' || type === 'genre') {
            list = this.filterGenre ? this.filterGenre.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
        } else if (type === 'studios' || type === 'studio') {
            list = this.filterStudio ? this.filterStudio.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
        }
        return list.includes(valClean);
    }

    setFiltersAndRoute(filters = {}, autoOpen = false) {
        if (filters.actresses !== undefined) this.filterActress = filters.actresses;
        if (filters.genres !== undefined) this.filterGenre = filters.genres;
        if (filters.studios !== undefined) this.filterStudio = filters.studios;
        if (filters.sort_by !== undefined) this.sortKey = filters.sort_by;

        const extra = {};
        if (this.currentPlayingFilename) extra.v = this.currentPlayingFilename;
        if (this.filterActress) extra.actresses = this.filterActress;
        if (this.filterGenre) extra.genres = this.filterGenre;
        if (this.filterStudio) extra.studios = this.filterStudio;
        if (this.sortKey) extra.sort_by = this.sortKey;

        this.updateActiveFiltersBar();
        this.updateRoute('watch', '', extra);
        this.fetchDirectory(this.currentPath);

        if (window.updateBottomTagsActiveState) {
            window.updateBottomTagsActiveState();
        }

        if (autoOpen) {
            this.open();
        } else {
            this.closeAllDrawers();
        }
    }

    updateActiveFiltersBar() {
        this.updateContextChips();
    }

    updateContextChips() {
        const container = document.getElementById('video-context-chips');
        if (!container) return;

        const chips = [];

        // 1. Category filter (GDrive / Queue)
        if (this.activeExplorerCategory === 'gdrive' || this.activeExplorerCategory === 'has_gdrive') {
            chips.push({
                type: 'gdrive',
                val: 'gdrive',
                cssClass: 'chip-gdrive',
                icon: 'cloud_done',
                label: 'GDrive',
                onDelete: () => {
                    this.activeExplorerCategory = 'all';
                    this.refreshCurrentWatchContext();
                }
            });
        } else if (this.activeExplorerCategory === 'queue' || this.activeExplorerCategory === 'in_queue') {
            chips.push({
                type: 'queue',
                val: 'queue',
                cssClass: 'chip-queue',
                icon: 'hourglass_top',
                label: 'Hàng đợi',
                onDelete: () => {
                    this.activeExplorerCategory = 'all';
                    this.refreshCurrentWatchContext();
                }
            });
        }

        // 2. Search Query
        if (this.searchQuery) {
            const qDisplay = this.searchQuery.length > 18 ? this.searchQuery.slice(0, 16) + '...' : this.searchQuery;
            chips.push({
                type: 'search',
                val: this.searchQuery,
                cssClass: 'chip-search',
                icon: 'search',
                label: `"${qDisplay}"`,
                title: `Tìm kiếm: ${this.searchQuery}`,
                onDelete: () => {
                    this.searchQuery = '';
                    if (this.inputSearchVideo) this.inputSearchVideo.value = '';
                    if (this.btnClearSearch) this.btnClearSearch.classList.add('hidden');
                    if (this.searchWrapper) this.searchWrapper.classList.remove('active');
                    this.refreshCurrentWatchContext();
                }
            });
        }

        // 3. Actresses Filter (Hỗ trợ nhiều diễn viên đồng thời)
        if (this.filterActress) {
            const actList = this.filterActress.split(',').map(s => s.trim()).filter(Boolean);
            actList.forEach(act => {
                const actDisplay = act.length > 18 ? act.slice(0, 16) + '...' : act;
                const isFlash = this.lastToggledFilter && this.lastToggledFilter.type === 'actress' && this.lastToggledFilter.value.toLowerCase() === act.toLowerCase();
                chips.push({
                    type: 'actress',
                    val: act,
                    cssClass: `chip-actress ${isFlash ? 'chip-flash-pulse' : ''}`,
                    icon: 'person',
                    label: actDisplay,
                    title: `Diễn viên: ${act}`,
                    onDelete: () => {
                        this.removeFilterItem('actresses', act);
                    }
                });
            });
        }

        // 4. Genres Filter (Hỗ trợ nhiều thể loại đồng thời)
        if (this.filterGenre) {
            const genList = this.filterGenre.split(',').map(s => s.trim()).filter(Boolean);
            genList.forEach(gen => {
                const genDisplay = gen.length > 18 ? gen.slice(0, 16) + '...' : gen;
                const isFlash = this.lastToggledFilter && this.lastToggledFilter.type === 'genre' && this.lastToggledFilter.value.toLowerCase() === gen.toLowerCase();
                chips.push({
                    type: 'genre',
                    val: gen,
                    cssClass: `chip-genre ${isFlash ? 'chip-flash-pulse' : ''}`,
                    icon: 'category',
                    label: genDisplay,
                    title: `Thể loại: ${gen}`,
                    onDelete: () => {
                        this.removeFilterItem('genres', gen);
                    }
                });
            });
        }

        // 5. Studios Filter (Hỗ trợ nhiều studio đồng thời)
        if (this.filterStudio) {
            const stuList = this.filterStudio.split(',').map(s => s.trim()).filter(Boolean);
            stuList.forEach(stu => {
                const stuDisplay = stu.length > 18 ? stu.slice(0, 16) + '...' : stu;
                const isFlash = this.lastToggledFilter && this.lastToggledFilter.type === 'studio' && this.lastToggledFilter.value.toLowerCase() === stu.toLowerCase();
                chips.push({
                    type: 'studio',
                    val: stu,
                    cssClass: `chip-studio ${isFlash ? 'chip-flash-pulse' : ''}`,
                    icon: 'movie',
                    label: stuDisplay,
                    title: `Studio: ${stu}`,
                    onDelete: () => {
                        this.removeFilterItem('studios', stu);
                    }
                });
            });
        }

        // Xóa cờ flash sau khi đã render
        this.lastToggledFilter = null;

        if (chips.length === 0) {
            container.innerHTML = '';
            container.classList.remove('has-chips');
            return;
        }

        let chipsHtml = chips.map(chip => `
            <div class="context-chip ${chip.cssClass || ''}" data-type="${chip.type}" ${chip.title ? `title="${this.escapeHtml(chip.title)}"` : ''}>
                <span class="material-symbols-outlined context-chip-icon">${chip.icon}</span>
                <span class="context-chip-text">${this.escapeHtml(chip.label)}</span>
                <button type="button" class="context-chip-delete" title="Bỏ lọc">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
        `).join('');

        if (chips.length >= 2) {
            chipsHtml += `
                <button type="button" class="context-chip-clear-all" id="btn-clear-all-chips" title="Xóa tất cả ${chips.length} bộ lọc ngữ cảnh">
                    <span class="material-symbols-outlined">delete_sweep</span>
                    <span>Xoá tất cả</span>
                </button>
            `;
        }

        container.innerHTML = chipsHtml;
        container.classList.add('has-chips');

        // Gán sự kiện xoá từng chip
        container.querySelectorAll('.context-chip').forEach((chipEl, idx) => {
            const btnDel = chipEl.querySelector('.context-chip-delete');
            if (btnDel && chips[idx] && chips[idx].onDelete) {
                btnDel.onclick = (e) => {
                    e.stopPropagation();
                    chips[idx].onDelete();
                };
            }
        });

        // Gán sự kiện xoá tất cả chips (khi có từ 3 chip trở lên)
        const btnClearAll = container.querySelector('#btn-clear-all-chips');
        if (btnClearAll) {
            btnClearAll.onclick = (e) => {
                e.stopPropagation();
                this.clearAllContextFilters();
            };
        }
    }

    clearAllContextFilters() {
        this.activeExplorerCategory = 'all';
        this.searchQuery = '';
        this.filterActress = '';
        this.filterGenre = '';
        this.filterStudio = '';
        this.lastToggledFilter = null;
        if (this.inputSearchVideo) this.inputSearchVideo.value = '';
        if (this.btnClearSearch) this.btnClearSearch.classList.add('hidden');
        if (this.searchWrapper) this.searchWrapper.classList.remove('active');
        if (this.inputSearchDrawer) this.inputSearchDrawer.value = '';
        if (this.btnClearSearchDrawer) this.btnClearSearchDrawer.classList.add('hidden');
        this.refreshCurrentWatchContext();
        if (window.updateBottomTagsActiveState) {
            window.updateBottomTagsActiveState();
        }
    }

    refreshCurrentWatchContext() {
        const extra = {};
        if (this.currentPlayingFilename) extra.v = this.currentPlayingFilename;
        if (this.searchQuery) extra.q = this.searchQuery;
        if (this.activeExplorerCategory && this.activeExplorerCategory !== 'all') extra.filter = this.activeExplorerCategory;
        if (this.filterActress) extra.actresses = this.filterActress;
        if (this.filterGenre) extra.genres = this.filterGenre;
        if (this.filterStudio) extra.studios = this.filterStudio;
        if (this.sortKey) extra.sort_by = this.sortKey;
        if (this.sortAsc) extra.sort_asc = 'true';

        this.updateRoute('watch', '', extra);
        this.updateContextChips();
        this.fetchDirectory(this.currentPath);
    }

    selectVideoByPathOrId(vStr, force = false, opts = {}) {
        if (!vStr) return;
        const decodeV = decodeURIComponent(vStr);
        const vFilename = decodeV.split(/[/\\]/).pop().toUpperCase();
        const currentClean = (this.currentPlayingFilename || '').trim().toUpperCase();
        const playerCurrent = (window.playerInstance && (window.playerInstance.currentVideoName || window.playerInstance.currentVideoPath) || '').trim().toUpperCase();

        if (!force && currentClean && playerCurrent && (currentClean === vFilename || playerCurrent === vFilename)) {
            return;
        }
        const url = `${this.backendHost}/api/video/${encodeURIComponent(vFilename)}`;
        
        fetch(url, { credentials: 'include' })
            .then(res => res.json())
            .then(res => {
                if (res.success && res.video) {
                    this.selectVideo(res.video, opts);
                }
            })
            .catch(err => console.error('Lỗi selectVideoByPathOrId:', err));
    }

    // --- Routing & SearchDrawer Logic ---
    updateHierarchyRoute() {
        // OnePlayer tập trung vào phát & tìm kiếm như Reel/TikTok; Explorer chạy thuần internal state không can thiệp URL hash
        return;
    }

    updateRoute(route, param = '', extraParams = {}) {
        // TikTok / Reels clean routing: No hashtags used in URL.
        // If a video code is being watched, sync the clean pathname /:code
        if (route === 'watch' && extraParams && extraParams.v) {
            const vCode = String(extraParams.v).trim().toUpperCase();
            if (vCode && window.location.pathname !== `/${vCode}`) {
                window.history.replaceState(null, '', `/${vCode}`);
            }
        }
        if (window.location.hash) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    }

    updatePageInHash(pageNum) {
        // No-op in clean URL mode
    }

    handleRoute() {
        if (this.ignoreNextHashChange) {
            this.ignoreNextHashChange = false;
            return;
        }
        try {
            const rawHash = (window.location.hash || '').replace(/^#\/?/, '');
            if (!rawHash) {
                this.closeAllDrawers();
                return;
            }

            const [pathPart, queryPart] = rawHash.split('?');
            const pathSegments = pathPart.split('/');
            const route = pathSegments[0].toLowerCase();
            let param = pathSegments[1] ? decodeURIComponent(pathSegments.slice(1).join('/')) : '';

            let qParam = '';
            if (queryPart) {
                const searchParams = new URLSearchParams(queryPart);
                if (searchParams.has('q')) {
                    qParam = searchParams.get('q') || '';
                }
            }

            const searchKey = qParam || param;

            if (route === 'search') {
                if (searchKey) {
                    this.openSearchDrawer(searchKey);
                } else {
                    this.openSearchDrawer();
                }
            } else if (route === 'watch') {
                const searchParams = new URLSearchParams(queryPart || '');
                const vParam = searchParams.get('v') || param || '';
                const qSearchParam = searchParams.get('q') || searchParams.get('search') || '';
                const pageParam = searchParams.get('page');
                if (pageParam) {
                    this.initialPageFromRoute = parseInt(pageParam, 10) || 1;
                }
                const filterCategoryParam = searchParams.get('filter') || searchParams.get('filter_type') || '';
                const actressParam = searchParams.get('actresses') || searchParams.get('actress') || '';
                const genreParam = searchParams.get('genres') || searchParams.get('genre') || '';
                const studioParam = searchParams.get('studios') || searchParams.get('studio') || searchParams.get('maker') || '';
                const sortByParam = searchParams.get('sort_by') || searchParams.get('sort') || '';
                const sortAscParam = searchParams.get('sort_asc');

                this.searchQuery = qSearchParam;
                if (this.inputSearchVideo) this.inputSearchVideo.value = qSearchParam;
                if (this.btnClearSearch) {
                    if (qSearchParam) this.btnClearSearch.classList.remove('hidden');
                    else this.btnClearSearch.classList.add('hidden');
                }
                if (filterCategoryParam) this.activeExplorerCategory = filterCategoryParam;
                this.filterActress = actressParam;
                this.filterGenre = genreParam;
                this.filterStudio = studioParam;
                if (sortByParam) this.sortKey = sortByParam;
                if (sortAscParam !== null) this.sortAsc = (sortAscParam === 'true');

                this.updateContextChips();
                this.fetchDirectory(this.currentPath);

                if (vParam) {
                    this.selectVideoByPathOrId(vParam);
                } else {
                    this.open();
                }
            } else if (route === 'queue' || route === 'pending_upload') {
                this.setActiveExplorerCategory('queue');
                if (searchKey) {
                    this.searchInExplorer(searchKey);
                } else {
                    this.open();
                }
            } else if (route === 'gdrive' || route === 'has_gdrive') {
                this.setActiveExplorerCategory('gdrive');
                if (searchKey) {
                    this.searchInExplorer(searchKey);
                } else {
                    this.open();
                }
            } else if (route === 'library' || route === 'explorer' || route === 'all') {
                const searchParams = new URLSearchParams(queryPart || '');
                const filterCategoryParam = searchParams.get('filter') || searchParams.get('filter_type') || '';
                const sortByParam = searchParams.get('sort_by') || searchParams.get('sort') || '';
                const sortAscParam = searchParams.get('sort_asc');
                const vParam = searchParams.get('v') || searchParams.get('code') || searchParams.get('around_filename') || '';
                const actressParam = searchParams.get('actresses') || searchParams.get('actress') || '';
                const genreParam = searchParams.get('genres') || searchParams.get('genre') || '';
                const studioParam = searchParams.get('studios') || searchParams.get('studio') || searchParams.get('maker') || '';
                const qSearchParam = searchParams.get('q') || searchParams.get('search') || '';
                const pageParam = searchParams.get('page');
                const boxIdParam = searchParams.get('box_id');
                const threadIdParam = searchParams.get('thread_id');

                if (pageParam) {
                    this.initialPageFromRoute = parseInt(pageParam, 10) || 1;
                }

                if (filterCategoryParam) {
                    this.activeExplorerCategory = filterCategoryParam;
                }
                if (sortByParam) {
                    this.sortKey = sortByParam;
                }
                if (sortAscParam !== null && sortAscParam !== undefined && sortAscParam !== '') {
                    this.sortAsc = (sortAscParam === 'true' || sortAscParam === '1' || sortAscParam === 'asc');
                }
                if (actressParam) this.filterActress = actressParam;
                if (genreParam) this.filterGenre = genreParam;
                if (studioParam) this.filterStudio = studioParam;
                if (qSearchParam) this.searchQuery = qSearchParam;
                if (vParam) {
                    this.setCurrentPlayingFilename(vParam);
                    this.selectVideoByPathOrId(vParam, true, { autoClose: false, updateRoute: false });
                }

                this.updateContextChips();
                this.updateSortUI();
                if (this.inputSearchVideo) this.inputSearchVideo.value = this.searchQuery || '';
                if (this.searchWrapper) {
                    if (this.searchQuery) this.searchWrapper.classList.add('active');
                    else this.searchWrapper.classList.remove('active');
                }
                if (this.btnClearSearch) {
                    if (this.searchQuery) this.btnClearSearch.classList.remove('hidden');
                    else this.btnClearSearch.classList.add('hidden');
                }

                if (searchKey && !actressParam && !genreParam && !studioParam && !searchParams.has('q')) {
                    this.searchInExplorer(searchKey);
                } else {
                    if (threadIdParam) {
                        this.setCurrentContext({ boxId: boxIdParam, threadId: threadIdParam });
                        this.openThreadVideos(threadIdParam, { autoScroll: true, updateRoute: false });
                    } else if (boxIdParam) {
                        this.setCurrentContext({ boxId: boxIdParam });
                        this.openBoxThreads(boxIdParam, { updateRoute: false });
                    } else if (this.currentContext && this.currentContext.threadId && !boxIdParam && !threadIdParam && !window.location.hash.includes('box_id') && !window.location.hash.includes('thread_id')) {
                        // Fallback logic kept for safety
                        this.openThreadVideos(this.currentContext.threadId, { autoScroll: true, updateRoute: false });
                    } else if (this.currentContext && this.currentContext.boxId && !boxIdParam && !threadIdParam && !window.location.hash.includes('box_id')) {
                        // Fallback logic kept for safety
                        this.openBoxThreads(this.currentContext.boxId, { updateRoute: false });
                    } else {
                        this.openBoxes({ updateRoute: false });
                    }
                    this.open();
                }
            } else if (route === 'profile' || route === 'user' || route === 'account') {
                this.openUserDrawer();
                if (this.userAccountSection) {
                    this.userAccountSection.classList.remove('hidden');
                }
            } else if (route === 'sources' || route === 'source') {
                this.open();
            } else if (route === 'actress' || route === 'actresses') {
                this.closeSearchDrawer();
                this.openCategoriesDrawer('actresses', qParam || '', param || '');
            } else if (route === 'studio' || route === 'studios') {
                this.closeSearchDrawer();
                this.openCategoriesDrawer('studios', qParam || '', param || '');
            }
        } catch (err) {
            console.error('Error handling route:', err);
        }
    }

    searchInExplorer(searchKey) {
        if (!searchKey) return;
        this.clearPageCache();
        this.closeSearchDrawer();
        if (this.inputSearchVideo) {
            this.inputSearchVideo.value = searchKey;
        }
        if (this.searchWrapper) {
            this.searchWrapper.classList.add('active');
        }
        if (this.btnClearSearch) {
            this.btnClearSearch.classList.remove('hidden');
        }
        this.searchQuery = searchKey;

        // Lưu từ khóa vào lịch sử tìm kiếm người dùng
        try {
            fetch(`${this.backendHost}/api/history/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: searchKey }),
                credentials: 'include'
            }).catch(() => {});
        } catch (e) {}

        this.open();
        this.fetchCategoryCounts(searchKey);
        this.setActiveExplorerCategory('all');
        this.updateRoute('search', '', { q: searchKey });
    }

    openSearchDrawer(query = null) {
        this.closeAllDrawers('search');
        if (this.searchDrawerModal) {
            this.searchDrawerModal.classList.remove('hidden');
            if (query !== null) {
                this.searchDrawerQuery = query;
                if (this.inputSearchDrawer) this.inputSearchDrawer.value = query;
            }
            if (this.btnClearSearchDrawer) {
                if (this.inputSearchDrawer && this.inputSearchDrawer.value.length > 0) {
                    this.btnClearSearchDrawer.classList.remove('hidden');
                } else {
                    this.btnClearSearchDrawer.classList.add('hidden');
                }
            }
            if (this.inputSearchDrawer) {
                setTimeout(() => {
                    this.inputSearchDrawer.focus();
                    this.inputSearchDrawer.select();
                }, 50);
            }
            if (this.inputSearchDrawer && this.inputSearchDrawer.value.trim()) {
                this.fetchSearchDrawerResults(this.inputSearchDrawer.value.trim());
            } else {
                this.renderSearchDrawerDefault();
            }
            this.updateRoute('search');
        }
    }

    getTokenVariants(token) {
        token = String(token || '').trim();
        if (!token) return [];
        const variants = new Set();
        const tokenLower = token.toLowerCase();
        variants.add(tokenLower);

        // 1. Hyphen / Space / Underscore
        if (tokenLower.includes('-') || tokenLower.includes('_') || tokenLower.includes(' ')) {
            variants.add(tokenLower.replace(/-/g, ' '));
            variants.add(tokenLower.replace(/-/g, ''));
            variants.add(tokenLower.replace(/_/g, ' '));
            variants.add(tokenLower.replace(/_/g, ''));
            variants.add(tokenLower.replace(/\s+/g, '-'));
            variants.add(tokenLower.replace(/\s+/g, ''));
        }

        // 2. Studio / Code prefix + numbering (e.g. ebwh122 <-> ebwh-122 <-> ebwh-092)
        const m = tokenLower.match(/^([a-z]+?)[-_ ]*([0-9]+)$/);
        if (m) {
            const pref = m[1];
            const num = m[2];
            const prefVariants = new Set([pref]);
            for (let i = 0; i < pref.length - 1; i++) {
                const sw = pref.split('');
                const tmp = sw[i];
                sw[i] = sw[i+1];
                sw[i+1] = tmp;
                prefVariants.add(sw.join(''));
            }

            for (const p of prefVariants) {
                variants.add(`${p}-${num}`);
                variants.add(`${p} ${num}`);
                variants.add(`${p}${num}`);
                try {
                    const numInt = String(parseInt(num, 10));
                    variants.add(`${p}-${numInt}`);
                    variants.add(`${p}-${numInt.padStart(3, '0')}`);
                    variants.add(`${p} ${numInt}`);
                    variants.add(`${p} ${numInt.padStart(3, '0')}`);
                    variants.add(`${p}${numInt}`);
                    variants.add(`${p}${numInt.padStart(3, '0')}`);
                } catch (e) {}
            }
        }

        // 3. Adjacent character transposition typos (e.g. ewbh -> ebwh)
        if (tokenLower.length >= 3) {
            for (let i = 0; i < tokenLower.length - 1; i++) {
                const sw = tokenLower.split('');
                const tmp = sw[i];
                sw[i] = sw[i+1];
                sw[i+1] = tmp;
                variants.add(sw.join(''));
            }
        }

        // 4. Double consonant & deduplicate letters (e.g. rokka <-> roka <-> rikka <-> rika)
        const dedup = tokenLower.replace(/([a-z])\1+/g, '$1');
        variants.add(dedup);
        for (let i = 0; i < tokenLower.length; i++) {
            const ch = tokenLower[i];
            if (!'aeiou'.includes(ch)) {
                variants.add(tokenLower.slice(0, i) + ch + tokenLower.slice(i));
            }
        }

        // 5. Vowel substitution variations (e.g. rika <-> roka <-> rikka <-> rokka)
        const vowels = 'aeiouy';
        for (let i = 0; i < tokenLower.length; i++) {
            if (vowels.includes(tokenLower[i])) {
                for (let v of vowels) {
                    if (v !== tokenLower[i]) {
                        const varStr = tokenLower.slice(0, i) + v + tokenLower.slice(i + 1);
                        variants.add(varStr);
                        variants.add(varStr.replace(/([a-z])\1+/g, '$1'));
                        for (let j = 0; j < varStr.length; j++) {
                            if (!vowels.includes(varStr[j])) {
                                variants.add(varStr.slice(0, j) + varStr[j] + varStr.slice(j));
                            }
                        }
                    }
                }
            }
        }

        // 6. Single character deletion for typo tolerance
        if (tokenLower.length >= 5) {
            for (let i = 0; i < tokenLower.length; i++) {
                variants.add(tokenLower.slice(0, i) + tokenLower.slice(i + 1));
            }
        }

        // 7. Stemming & typo variations
        if (/^[a-z]+$/.test(tokenLower) && tokenLower.length >= 4) {
            const suffixes = ['treatment', 'treating', 'treated', 'treats', 'ment', 'tion', 'ness', 'able', 'ing', 'ed', 'es', 's'];
            for (const suf of suffixes) {
                if (tokenLower.endsWith(suf) && tokenLower.length - suf.length >= 3) {
                    variants.add(tokenLower.slice(0, tokenLower.length - suf.length));
                }
            }
            if (tokenLower.length >= 5) {
                variants.add(tokenLower.slice(0, -1));
            }
        }

        return Array.from(variants);
    }

    matchQuerySearch(text, rawQuery) {
        if (!rawQuery || !rawQuery.trim()) return true;
        if (!text) return false;
        const textLower = text.toLowerCase();
        // Tách theo dấu phẩy hoặc gạch chéo thành các nhóm OR
        const orChunks = rawQuery.replace(/\//g, ',').split(',').map(c => c.trim()).filter(Boolean);
        if (!orChunks.length) return true;

        for (const chunk of orChunks) {
            // Trong mỗi nhóm OR, các từ cách nhau bởi khoảng trắng là AND
            const andTokens = chunk.split(/\s+/).map(t => t.trim().toLowerCase()).filter(Boolean);
            if (andTokens.length > 0) {
                const allTokensMatch = andTokens.every(t => {
                    const variants = this.getTokenVariants(t);
                    return variants.some(v => textLower.includes(v));
                });
                if (allTokensMatch) return true;
            }
        }
        return false;
    }

    closeSearchDrawer() {
        if (this.searchDrawerModal) {
            this.searchDrawerModal.classList.add('hidden');
        }
        this.checkAndClearRouteIfAllClosed();
    }

    async renderSearchDrawerDefault() {
        if (this.searchResultsSection) this.searchResultsSection.classList.add('hidden');
        if (this.searchSuggestionsSection) this.searchSuggestionsSection.classList.remove('hidden');
        if (this.searchHistorySection) this.searchHistorySection.classList.remove('hidden');

        // Fetch recent 3 viewed videos to generate suggestions
        try {
            const resView = await fetch(`${this.backendHost}/api/history/view?limit=3`, { credentials: 'include' });
            const dataView = await resView.json();
            this.cachedRecentVideos = (dataView.success && dataView.history) ? dataView.history : [];
            this.renderSearchSuggestions(this.cachedRecentVideos);
        } catch (err) {
            console.error('Error rendering search suggestions:', err);
        }

        // Fetch search history keywords
        try {
            const resSearch = await fetch(`${this.backendHost}/api/history/search?limit=30`, { credentials: 'include' });
            const dataSearch = await resSearch.json();
            this.cachedHistoryWords = (dataSearch.success && dataSearch.history) ? dataSearch.history : [];
            this.renderSearchWords(this.cachedHistoryWords);
        } catch (err) {
            console.error('Error rendering search history words:', err);
        }
    }

    renderSearchSuggestions(recentVideos, query = '') {
        if (!this.searchSuggestionsContainer) return;
        
        const qClean = (query || '').trim();
        const actresses = new Set();
        const genres = new Set();
        const studios = new Set();

        (recentVideos || []).forEach(v => {
            if (v.actress) {
                v.actress.replace(/\//g, ',').split(',').forEach(a => {
                    const clean = a.trim();
                    if (clean && (!qClean || this.matchQuerySearch(clean, qClean))) actresses.add(clean);
                });
            }
            if (v.genres) {
                v.genres.replace(/\//g, ',').split(',').forEach(g => {
                    const clean = g.trim();
                    if (clean && (!qClean || this.matchQuerySearch(clean, qClean))) genres.add(clean);
                });
            }
            const studioVal = v.maker || v.studio;
            if (studioVal) {
                studioVal.replace(/\//g, ',').split(',').forEach(m => {
                    const clean = m.trim();
                    if (clean && (!qClean || this.matchQuerySearch(clean, qClean))) studios.add(clean);
                });
            }
        });

        let html = '';

        // Nhóm 1: Diễn viên
        if (actresses.size > 0) {
            let chipsHtml = '';
            let count = 0;
            actresses.forEach(act => {
                if (count >= 8) return;
                const actEsc = this.escapeHtml(act);
                chipsHtml += `
                    <div class="suggestion-chip actress-chip" data-type="actress" data-query="${encodeURIComponent(act)}">
                        <span class="material-symbols-outlined">person</span>
                        <span>${actEsc}</span>
                    </div>
                `;
                count++;
            });
            html += `
                <div class="suggestion-group">
                    <div class="suggestion-group-title actress-group">
                        <span class="material-symbols-outlined">person</span>
                        <span>Diễn viên (${Math.min(actresses.size, 8)})</span>
                    </div>
                    <div class="suggestion-group-chips">
                        ${chipsHtml}
                    </div>
                </div>
            `;
        }

        // Nhóm 2: Thể loại
        if (genres.size > 0) {
            let chipsHtml = '';
            let count = 0;
            genres.forEach(g => {
                if (count >= 8) return;
                const gEsc = this.escapeHtml(g);
                chipsHtml += `
                    <div class="suggestion-chip genre-chip" data-type="genre" data-query="${encodeURIComponent(g)}">
                        <span class="material-symbols-outlined">category</span>
                        <span>${gEsc}</span>
                    </div>
                `;
                count++;
            });
            html += `
                <div class="suggestion-group">
                    <div class="suggestion-group-title genre-group">
                        <span class="material-symbols-outlined">category</span>
                        <span>Thể loại (${Math.min(genres.size, 8)})</span>
                    </div>
                    <div class="suggestion-group-chips">
                        ${chipsHtml}
                    </div>
                </div>
            `;
        }

        // Nhóm 3: Studio / Hãng sản xuất
        if (studios.size > 0) {
            let chipsHtml = '';
            let count = 0;
            studios.forEach(m => {
                if (count >= 6) return;
                const mEsc = this.escapeHtml(m);
                chipsHtml += `
                    <div class="suggestion-chip studio-chip" data-type="studio" data-query="${encodeURIComponent(m)}">
                        <span class="material-symbols-outlined">movie</span>
                        <span>${mEsc}</span>
                    </div>
                `;
                count++;
            });
            html += `
                <div class="suggestion-group">
                    <div class="suggestion-group-title studio-group">
                        <span class="material-symbols-outlined">movie</span>
                        <span>Hãng / Studio (${Math.min(studios.size, 6)})</span>
                    </div>
                    <div class="suggestion-group-chips">
                        ${chipsHtml}
                    </div>
                </div>
            `;
        }

        if (!html) {
            html = `
                <div class="history-empty-state" style="padding: 10px 0;">
                    <span class="material-symbols-outlined">${qClean ? 'search_off' : 'lightbulb_outline'}</span>
                    <span>${qClean ? 'Không có gợi ý diễn viên, thể loại hay hãng phim phù hợp' : 'Chưa có gợi ý. Hãy xem một số video để nhận gợi ý!'}</span>
                </div>
            `;
        }

        this.searchSuggestionsContainer.innerHTML = html;

        this.searchSuggestionsContainer.querySelectorAll('.suggestion-chip').forEach(chip => {
            chip.onclick = () => {
                const q = decodeURIComponent(chip.getAttribute('data-query') || '');
                const type = chip.getAttribute('data-type');
                if (type === 'actress') {
                    this.closeSearchDrawer();
                    this.setFiltersAndRoute({ actresses: q, genres: '', studios: '' }, true);
                } else if (type === 'genre') {
                    this.closeSearchDrawer();
                    this.setFiltersAndRoute({ genres: q, actresses: '', studios: '' }, true);
                } else if (type === 'studio') {
                    this.closeSearchDrawer();
                    this.setFiltersAndRoute({ studios: q, actresses: '', genres: '' }, true);
                } else {
                    this.closeSearchDrawer();
                    this.open();
                    if (this.searchQuery) {
                        this.searchQuery = '';
                        if (this.inputSearchVideo) this.inputSearchVideo.value = '';
                        if (this.btnClearSearch) this.btnClearSearch.classList.add('hidden');
                        if (this.searchWrapper) this.searchWrapper.classList.remove('active');
                    }
                    this.searchInExplorer(q);
                }
            };
        });
    }

    renderSearchWords(list, query = '') {
        if (!this.searchWordsList) return;
        const qClean = (query || '').trim();
        const filteredList = (list || []).filter(item => {
            if (!item || !item.query) return false;
            if (!qClean) return true;
            return this.matchQuerySearch(item.query, qClean);
        });

        if (!filteredList || filteredList.length === 0) {
            this.searchWordsList.innerHTML = `
                <div class="history-empty-state" style="padding: 10px 0;">
                    <span class="material-symbols-outlined">search_off</span>
                    <span>${qClean ? 'Không có lịch sử tìm kiếm phù hợp' : 'Chưa có từ khóa tìm kiếm nào'}</span>
                </div>
            `;
            return;
        }

        let html = '';
        // Deduplicate chips from frontend as well
        const seenQueries = new Map();
        filteredList.forEach(item => {
            if (!item || !item.query) return;
            const qKey = item.query.trim().toLowerCase();
            if (seenQueries.has(qKey)) {
                const existing = seenQueries.get(qKey);
                existing.count = (existing.count || 1) + (item.count || 1);
            } else {
                seenQueries.set(qKey, { ...item, count: item.count || 1 });
            }
        });

        let count = 0;
        seenQueries.forEach(item => {
            if (qClean && count >= 10) return;
            const queryEsc = this.escapeHtml(item.query);
            const countBadge = (item.count && item.count > 1) ? `<span class="chip-count-badge">${item.count}</span>` : '';
            html += `
                <div class="word-chip" data-query="${encodeURIComponent(item.query)}">
                    <span class="material-symbols-outlined">schedule</span>
                    <span>${queryEsc}</span>
                    ${countBadge}
                </div>
            `;
            count++;
        });
        this.searchWordsList.innerHTML = html;

        this.searchWordsList.querySelectorAll('.word-chip').forEach(chip => {
            chip.onclick = () => {
                const q = decodeURIComponent(chip.getAttribute('data-query'));
                this.searchInExplorer(q);
            };
        });
    }

    async fetchSearchDrawerResults(query) {
        const qClean = (query || '').trim();
        if (!qClean) {
            this.renderSearchDrawerDefault();
            return;
        }

        // Luôn giữ hiển thị các khối Suggestions và History
        if (this.searchResultsSection) this.searchResultsSection.classList.add('hidden');
        if (this.searchSuggestionsSection) this.searchSuggestionsSection.classList.remove('hidden');
        if (this.searchHistorySection) this.searchHistorySection.classList.remove('hidden');

        // Lọc ngay lịch sử tìm kiếm theo query
        this.renderSearchWords(this.cachedHistoryWords || [], qClean);

        // Fetch gợi ý live từ Backend (giới hạn 10 kết quả tổng hợp phân vào các khối)
        try {
            const res = await fetch(`${this.backendHost}/api/search/suggest_words?q=${encodeURIComponent(qClean)}&limit=10`, { credentials: 'include' });
            const data = await res.json();
            const words = data.words || [];

            this.renderGroupedSearchSuggestions(words, qClean);
        } catch (err) {
            console.error('Error fetching search drawer results:', err);
            // Fallback lọc từ cache video xem gần nhất
            this.renderSearchSuggestions(this.cachedRecentVideos || [], qClean);
        }
    }

    renderGroupedSearchSuggestions(words, query = '') {
        if (!this.searchSuggestionsContainer) return;

        // Phân loại 10 kết quả thành các nhóm khối: Diễn viên, Thể loại, Hãng / Studio, Từ khóa / Mã phim
        const actresses = [];
        const genres = [];
        const studios = [];
        const generalWords = [];

        (words || []).forEach(item => {
            const word = (item.word || '').trim();
            if (!word) return;
            const type = item.type || 'general';
            if (type === 'actress') {
                if (!actresses.includes(word)) actresses.push(word);
            } else if (type === 'genre') {
                if (!genres.includes(word)) genres.push(word);
            } else if (type === 'studio') {
                if (!studios.includes(word)) studios.push(word);
            } else {
                if (!generalWords.includes(word)) generalWords.push(word);
            }
        });

        // Bổ sung thêm từ cache recent videos nếu chưa đủ
        if (this.cachedRecentVideos && this.cachedRecentVideos.length > 0) {
            this.cachedRecentVideos.forEach(v => {
                if (v.actress) {
                    v.actress.replace(/\//g, ',').split(',').forEach(a => {
                        const clean = a.trim();
                        if (clean && this.matchQuerySearch(clean, query) && !actresses.includes(clean)) {
                            actresses.push(clean);
                        }
                    });
                }
                if (v.genres) {
                    v.genres.replace(/\//g, ',').split(',').forEach(g => {
                        const clean = g.trim();
                        if (clean && this.matchQuerySearch(clean, query) && !genres.includes(clean)) {
                            genres.push(clean);
                        }
                    });
                }
                const studioVal = v.maker || v.studio;
                if (studioVal) {
                    studioVal.replace(/\//g, ',').split(',').forEach(m => {
                        const clean = m.trim();
                        if (clean && this.matchQuerySearch(clean, query) && !studios.includes(clean)) {
                            studios.push(clean);
                        }
                    });
                }
            });
        }

        let html = '';

        // 1. Khối Diễn viên
        if (actresses.length > 0) {
            let chipsHtml = '';
            actresses.slice(0, 8).forEach(act => {
                const actEsc = this.escapeHtml(act);
                chipsHtml += `
                    <div class="suggestion-chip actress-chip" data-type="actress" data-query="${encodeURIComponent(act)}">
                        <span class="material-symbols-outlined">person</span>
                        <span>${actEsc}</span>
                    </div>
                `;
            });
            html += `
                <div class="suggestion-group">
                    <div class="suggestion-group-title actress-group">
                        <span class="material-symbols-outlined">person</span>
                        <span>Diễn viên (${Math.min(actresses.length, 8)})</span>
                    </div>
                    <div class="suggestion-group-chips">
                        ${chipsHtml}
                    </div>
                </div>
            `;
        }

        // 2. Khối Thể loại
        if (genres.length > 0) {
            let chipsHtml = '';
            genres.slice(0, 8).forEach(g => {
                const gEsc = this.escapeHtml(g);
                chipsHtml += `
                    <div class="suggestion-chip genre-chip" data-type="genre" data-query="${encodeURIComponent(g)}">
                        <span class="material-symbols-outlined">category</span>
                        <span>${gEsc}</span>
                    </div>
                `;
            });
            html += `
                <div class="suggestion-group">
                    <div class="suggestion-group-title genre-group">
                        <span class="material-symbols-outlined">category</span>
                        <span>Thể loại (${Math.min(genres.length, 8)})</span>
                    </div>
                    <div class="suggestion-group-chips">
                        ${chipsHtml}
                    </div>
                </div>
            `;
        }

        // 3. Khối Studio
        if (studios.length > 0) {
            let chipsHtml = '';
            studios.slice(0, 6).forEach(m => {
                const mEsc = this.escapeHtml(m);
                chipsHtml += `
                    <div class="suggestion-chip studio-chip" data-type="studio" data-query="${encodeURIComponent(m)}">
                        <span class="material-symbols-outlined">movie</span>
                        <span>${mEsc}</span>
                    </div>
                `;
            });
            html += `
                <div class="suggestion-group">
                    <div class="suggestion-group-title studio-group">
                        <span class="material-symbols-outlined">movie</span>
                        <span>Hãng / Studio (${Math.min(studios.length, 6)})</span>
                    </div>
                    <div class="suggestion-group-chips">
                        ${chipsHtml}
                    </div>
                </div>
            `;
        }

        // 4. Khối Từ khóa / Mã phim gợi ý trực tiếp
        if (generalWords.length > 0) {
            let chipsHtml = '';
            generalWords.slice(0, 8).forEach(w => {
                const wEsc = this.escapeHtml(w);
                chipsHtml += `
                    <div class="suggestion-chip word-suggestion-chip" data-type="general" data-query="${encodeURIComponent(w)}">
                        <span class="material-symbols-outlined">search</span>
                        <span>${wEsc}</span>
                    </div>
                `;
            });
            html += `
                <div class="suggestion-group">
                    <div class="suggestion-group-title" style="color: #ff9f43;">
                        <span class="material-symbols-outlined">travel_explore</span>
                        <span>Từ khóa / Mã phim (${Math.min(generalWords.length, 8)})</span>
                    </div>
                    <div class="suggestion-group-chips">
                        ${chipsHtml}
                    </div>
                </div>
            `;
        }

        if (!html) {
            html = `
                <div class="history-empty-state" style="padding: 10px 0;">
                    <span class="material-symbols-outlined">search_off</span>
                    <span>Không tìm thấy gợi ý phù hợp với "${this.escapeHtml(query)}"</span>
                </div>
            `;
        }

        this.searchSuggestionsContainer.innerHTML = html;

        this.searchSuggestionsContainer.querySelectorAll('.suggestion-chip').forEach(chip => {
            chip.onclick = () => {
                const q = decodeURIComponent(chip.getAttribute('data-query') || '');
                const type = chip.getAttribute('data-type');
                if (type === 'actress') {
                    this.closeSearchDrawer();
                    this.setFiltersAndRoute({ actresses: q, genres: '', studios: '' }, true);
                } else if (type === 'genre') {
                    this.closeSearchDrawer();
                    this.setFiltersAndRoute({ genres: q, actresses: '', studios: '' }, true);
                } else if (type === 'studio') {
                    this.closeSearchDrawer();
                    this.setFiltersAndRoute({ studios: q, actresses: '', genres: '' }, true);
                } else {
                    this.closeSearchDrawer();
                    this.open();
                    if (this.searchQuery) {
                        this.searchQuery = '';
                        if (this.inputSearchVideo) this.inputSearchVideo.value = '';
                        if (this.btnClearSearch) this.btnClearSearch.classList.add('hidden');
                        if (this.searchWrapper) this.searchWrapper.classList.remove('active');
                    }
                    this.searchInExplorer(q);
                }
            };
        });
    }

    async playVideoByPath(path) {
        if (!path) return;
        try {
            const parts = path.split(/[/\\]/);
            const code = parts[parts.length - 1].trim().toUpperCase();
            if (code) {
                this.currentPlayingFilename = code;
            }

            this.updateRoute('watch', '', {
                v: code,
                actresses: this.filterActress,
                genres: this.filterGenre,
                studios: this.filterStudio,
                sort_by: this.sortKey,
                sort_asc: this.sortAsc
            });

            this.closeSearchDrawer();
            this.closeAllDrawers();

            // Direct MissAV selectVideo with m3u8 stream
            this.selectVideo({
                code: code,
                name: code,
                title: code,
                cover_url: `${this.backendHost}/api/cover/${encodeURIComponent(code)}`,
                m3u8Url: `${this.backendHost}/api/hls/${encodeURIComponent(code)}/playlist.m3u8`,
                actress: this.filterActress,
                genres: this.filterGenre
            });
        } catch (err) {
            console.error('Error playing video by path:', err);
        }
    }

    updateDrawerActiveFiltersBar(type, container) {
        // Đã bỏ thanh active filters bar trong categories drawer theo yêu cầu
        return;
    }

    async fetchAndRenderExplorerEntities(type, searchQueryOverride = null, targetContainer = null, resetPagination = true, targetPage = null) {
        const container = targetContainer || this.listContainer;
        if (!container) return;

        const state = this.entityState[type] || (this.entityState[type] = { sortKey: 'total_videos', sortAsc: false, currentPage: 1, pageSize: 48, total: 0, totalPages: 1, items: [], inDetailView: false });
        state.inDetailView = false;
        this.updateCategoriesSortUI();

        if (targetPage !== null && targetPage !== undefined) {
            state.currentPage = Math.max(1, parseInt(targetPage, 10) || 1);
        } else if (resetPagination) {
            state.currentPage = 1;
        }

        const offset = (state.currentPage - 1) * state.pageSize;
        state.items = [];
        container.scrollTop = 0;

        let skeletonHtml = '<div class="entities-list-items" style="padding: 6px 4px; width: 100%; box-sizing: border-box;">';
        for (let i = 0; i < 4; i++) {
            skeletonHtml += `
                <div class="entity-group-card">
                    <div class="entity-group-header">
                        <div class="entity-title-box">
                            <span class="skeleton-box" style="width: 24px; height: 24px; border-radius: 50%;"></span>
                            <span class="skeleton-box" style="width: 140px; height: 18px; border-radius: 6px;"></span>
                        </div>
                        <span class="skeleton-box" style="width: 90px; height: 20px; border-radius: 12px;"></span>
                    </div>
                    <div class="entity-videos-scroll">
                        ${Array(4).fill(0).map(() => `
                            <div class="entity-video-card">
                                <div class="entity-video-thumb cover-skeleton" style="height: 140px;"></div>
                                <div class="entity-video-info">
                                    <div class="skeleton-box" style="width: 90%; height: 14px; margin-top: 4px; border-radius: 4px;"></div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        skeletonHtml += '</div>';
        container.innerHTML = skeletonHtml;

        const inputEl = type === 'actresses' ? this.inputSearchActresses : (type === 'genres' ? this.inputSearchGenres : this.inputSearchStudios);
        const queryVal = searchQueryOverride !== null ? searchQueryOverride : (inputEl ? inputEl.value : '');
        const q = encodeURIComponent(queryVal);
        let endpoint = `/api/entities/${type}?q=${q}&sort_by=${state.sortKey}&sort_asc=${state.sortAsc}&limit=${state.pageSize}&offset=${offset}`;
        let iconName = type === 'actresses' ? 'person' : (type === 'genres' ? 'category' : 'video_camera_front');
        let typeLabel = type === 'actresses' ? 'Diễn viên' : (type === 'genres' ? 'Thể loại' : 'Studio / Hãng sản xuất');

        // Reset Top Header Left (#categories-header-title) for normal category list
        if (this.categoriesHeaderTitle && this.categoriesHeaderIcon) {
            this.categoriesHeaderIcon.innerText = iconName;
            this.categoriesHeaderTitle.innerText = typeLabel;
        }

        try {
            const res = await fetch(`${this.backendHost}${endpoint}`, { credentials: 'include' });
            const data = await res.json();
            const list = data[type] || data.items || [];
            state.total = data.total || list.length;
            state.totalPages = data.totalPages || Math.ceil(state.total / Math.max(1, state.pageSize)) || 1;
            state.items = list;

            if (!list || list.length === 0) {
                container.innerHTML = `
                    <div class="history-empty-state">
                        <span class="material-symbols-outlined">search_off</span>
                        <span>Không tìm thấy ${typeLabel} phù hợp</span>
                    </div>
                `;
                return;
            }

            let html = '<div class="entities-list-items" style="padding: 6px 4px; width: 100%; box-sizing: border-box;">';
            list.forEach(group => {
                html += this.renderEntityGroupCardHtml(type, group, iconName);
            });
            html += '</div>';

            container.innerHTML = html;
            this.bindEntityCardEvents(type, container);

            // Append Bottom Pagination Bar
            const paginationBar = this.createPaginationBar({
                position: 'bottom',
                currentPage: state.currentPage,
                totalPages: state.totalPages,
                totalItems: state.total,
                pageSize: state.pageSize,
                pageSizeOptions: [12, 24, 36, 48, 60],
                unitLabel: typeLabel,
                onPageChange: (newPage) => {
                    this.fetchAndRenderExplorerEntities(type, searchQueryOverride, container, false, newPage);
                },
                onPageSizeChange: (newSize) => {
                    state.pageSize = newSize;
                    this.fetchAndRenderExplorerEntities(type, searchQueryOverride, container, true, 1);
                }
            });
            container.appendChild(paginationBar);
        } catch (err) {
            console.error(`Error fetching explorer entities for ${type}:`, err);
            container.innerHTML = `
                <div class="history-empty-state">
                    <span class="material-symbols-outlined">error</span>
                    <span>Lỗi kết nối khi tải danh sách ${typeLabel}</span>
                </div>
            `;
        }
    }

    async fetchAndRenderEntityDetail(type, entityName, targetContainer = null, resetPagination = true, targetPage = null) {
        const container = targetContainer || this.listContainer;
        if (!container || !entityName) return;

        if (this.entityState[type]) this.entityState[type].inDetailView = true;

        const dState = this.entityDetailState;
        if (dState.name !== entityName || dState.type !== type) {
            dState.type = type;
            dState.name = entityName;
            dState.sortKey = 'release_date';
            dState.sortAsc = false;
            dState.filterNoCover = false;
            dState.currentPage = 1;
            dState.pageSize = 48;
            dState.total = 0;
            dState.totalPages = 1;
            dState.videos = [];
        }

        if (targetPage !== null && targetPage !== undefined) {
            dState.currentPage = Math.max(1, parseInt(targetPage, 10) || 1);
        } else if (resetPagination) {
            dState.currentPage = 1;
        }

        container.scrollTop = 0;

        let iconName = type === 'genres' ? 'category' : (type === 'studios' ? 'video_camera_front' : 'person');
        let typeLabel = type === 'genres' ? 'Thể loại' : (type === 'studios' ? 'Studio / Hãng' : 'Diễn viên');
        const nameEsc = this.escapeHtml(entityName);

        this.updateRoute(type, entityName);

        // Update Top Header Left (#categories-header-title)
        if (this.categoriesHeaderTitle && this.categoriesHeaderIcon) {
            this.categoriesHeaderIcon.innerText = iconName;
            this.categoriesHeaderTitle.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                    <button class="header-detail-back" id="btn-header-entity-back" title="Quay lại danh sách ${typeLabel}">
                        <span class="material-symbols-outlined">arrow_back</span>
                    </button>
                    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px;">${nameEsc}</span>
                    <span class="entity-count-badge" id="entity-detail-total-badge">...</span>
                </div>
            `;

            const btnHeaderBack = document.getElementById('btn-header-entity-back');
            if (btnHeaderBack) {
                btnHeaderBack.onclick = (e) => {
                    e.stopPropagation();
                    const returnEntityName = entityName;
                    if (this.entityState[type]) this.entityState[type].inDetailView = false;
                    this.fetchAndRenderExplorerEntities(type, null, container).then(() => {
                        if (returnEntityName) {
                            setTimeout(() => {
                                const targetCard = container.querySelector(`.entity-group-card[data-name="${returnEntityName}"]`);
                                if (targetCard) {
                                    targetCard.classList.remove('focus-pulse');
                                    void targetCard.offsetWidth;
                                    targetCard.classList.add('focus-pulse');
                                    targetCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
                                }
                            }, 80);
                        }
                    });
                    this.updateRoute(type);
                };
            }
        }

        this.updateCategoriesSortUI();

        container.innerHTML = `
            <div class="entity-detail-list-wrapper">
                <div class="entity-detail-videos-grid" style="padding: 6px 4px; width: 100%; box-sizing: border-box;">
                    ${Array(6).fill(0).map(() => `
                        <div class="skeleton-card">
                            <div class="skeleton-box skeleton-cover cover-skeleton" style="height: 140px; border-radius: 8px;"></div>
                            <div class="skeleton-box skeleton-title" style="width: 85%; height: 16px; margin: 8px 0 4px; border-radius: 4px;"></div>
                            <div class="skeleton-box skeleton-sub" style="width: 50%; height: 12px; border-radius: 4px;"></div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        try {
            const offset = (dState.currentPage - 1) * dState.pageSize;
            const url = `${this.backendHost}/api/entities/detail?type=${encodeURIComponent(type)}&name=${encodeURIComponent(entityName)}&sort_by=${dState.sortKey}&sort_asc=${dState.sortAsc}&filter_no_cover=${dState.filterNoCover}&limit=${dState.pageSize}&offset=${offset}`;
            const res = await fetch(url, { credentials: 'include' });
            const data = await res.json();
            const videos = data.videos || [];
            dState.total = data.total || videos.length;
            dState.totalPages = data.totalPages || Math.ceil(dState.total / Math.max(1, dState.pageSize)) || 1;
            dState.videos = videos;

            const totalBadge = document.getElementById('entity-detail-total-badge') || container.querySelector('#entity-detail-total-badge');
            if (totalBadge) totalBadge.innerText = `${dState.total.toLocaleString('vi-VN')} videos`;

            const gridWrapper = container.querySelector('.entity-detail-list-wrapper');
            if (!videos || videos.length === 0) {
                if (gridWrapper) {
                    gridWrapper.innerHTML = `
                        <div class="history-empty-state">
                            <span class="material-symbols-outlined">movie_off</span>
                            <span>Không tìm thấy video nào phù hợp của ${nameEsc}</span>
                        </div>
                    `;
                }
                return;
            }

            let html = '<div class="entity-detail-videos-grid" style="padding: 6px 4px; width: 100%; box-sizing: border-box;">';
            videos.forEach(v => {
                html += this.renderEntityVideoCardHtml(v);
            });
            html += '</div>';

            if (gridWrapper) {
                gridWrapper.innerHTML = html;
            }

            this.bindEntityVideoCardClickEvents(type, entityName, container);

            // Append Bottom Pagination Bar
            const paginationBar = this.createPaginationBar({
                position: 'bottom',
                currentPage: dState.currentPage,
                totalPages: dState.totalPages,
                totalItems: dState.total,
                pageSize: dState.pageSize,
                pageSizeOptions: [12, 24, 36, 48, 60],
                unitLabel: 'video',
                onPageChange: (newPage) => {
                    this.fetchAndRenderEntityDetail(type, entityName, container, false, newPage);
                },
                onPageSizeChange: (newSize) => {
                    dState.pageSize = newSize;
                    this.fetchAndRenderEntityDetail(type, entityName, container, true, 1);
                }
            });
            container.appendChild(paginationBar);
        } catch (err) {
            console.error(`Error fetching entity detail for ${type} [${entityName}]:`, err);
        }
    }

    handleEntityDetailSortChange(sortKey, container) {
        const dState = this.entityDetailState;
        if (dState.sortKey === sortKey) {
            dState.sortAsc = !dState.sortAsc;
        } else {
            dState.sortKey = sortKey;
            dState.sortAsc = (sortKey === 'name');
        }
        this.fetchAndRenderEntityDetail(dState.type, dState.name, container, true);
    }

    renderEntityGroupCardHtml(type, group, iconName) {
        const nameEsc = this.escapeHtml(group.name);
        const totalCount = group.total_videos || (group.videos ? group.videos.length : 0);

        let html = `
            <div class="entity-group-card">
                <div class="entity-group-header clickable-entity-header" data-name="${nameEsc}" data-type="${type}">
                    <div class="entity-title-box">
                        <span class="material-symbols-outlined entity-title-icon">${iconName}</span>
                        <span class="entity-name">${nameEsc}</span>
                    </div>
                    <span class="entity-count-badge clickable-badge">Xem tất cả ${totalCount} videos →</span>
                </div>
                <div class="entity-videos-scroll">
        `;

        (group.videos || []).forEach(v => {
            html += this.renderEntityVideoCardHtml(v);
        });

        html += `
                </div>
            </div>
        `;
        return html;
    }

    renderEntityVideoCardHtml(v) {
        const titleEsc = this.escapeHtml(v.title || v.name);
        const code = (v.code || (v.name ? (v.name.match(/([A-Za-z0-9]+-[0-9]+)/) || [])[1] : '') || '').trim().toUpperCase();
        const codeEsc = this.escapeHtml(code);
        const dateEsc = v.release_date ? window.formatRelativeReleaseDate(v.release_date) : '';
        const codeBadge = codeEsc ? `<span class="meta-code-badge">${codeEsc}</span>` : '';
        const dateBadge = dateEsc ? `<span class="meta-date-badge">📅 ${this.escapeHtml(dateEsc)}</span>` : '';
        const adminCodesUrl = `${window.location.protocol}//${window.location.hostname}:5052/codes?search=${encodeURIComponent(code || '')}`;

        const videoPath = v.full_path || v.path || code || '';
        const coverSrc = v.cover_url || (code ? `${this.backendHost}/api/cover/${encodeURIComponent(code)}` : this.getCoverUrl(v));
        const curPlaying = (this.currentPlayingFilename || '').trim().toUpperCase();
        const isPlaying = curPlaying && (code === curPlaying || String(v.name || '').toUpperCase() === curPlaying);

        return `
            <div class="entity-video-card ${isPlaying ? 'playing-now' : ''}" data-code="${codeEsc}" data-path="${encodeURIComponent(videoPath)}">
                <div class="entity-video-thumb cover-skeleton">
                    <img src="${coverSrc}" class="entity-video-img" alt="${titleEsc}" loading="lazy" decoding="async" onload="this.parentElement.classList.remove('cover-skeleton'); this.classList.add('loaded');" onerror="this.parentElement.classList.remove('cover-skeleton'); this.parentElement.classList.add('no-cover');" />
                    <div class="grid-card-badges-top">
                        ${codeBadge}
                        ${codeEsc ? `<a href="${adminCodesUrl}" target="_blank" class="btn-open-admin-codes" title="Xem trên Admin Quản lý Codes (:5052/codes)" onclick="event.stopPropagation();"><span class="material-symbols-outlined">open_in_new</span></a>` : ''}
                    </div>
                    <div class="grid-card-badges-bottom">
                        ${dateBadge}
                    </div>
                    ${isPlaying ? '<span class="now-playing-tag grid-playing-tag">ĐANG PHÁT</span>' : ''}
                    <button class="grid-play-overlay-btn" title="${isPlaying ? 'Đang phát video này' : 'Phát video này'}">
                        <span class="material-symbols-outlined">${isPlaying ? 'volume_up' : 'play_arrow'}</span>
                    </button>
                    <span class="material-symbols-outlined fallback-icon">movie</span>
                </div>
                <div class="entity-video-info">
                    <span class="entity-video-title" title="${titleEsc}">${titleEsc}</span>
                </div>
            </div>
        `;
    }

    bindEntityCardEvents(type, container) {
        container.querySelectorAll('.clickable-entity-header').forEach(header => {
            header.onclick = (e) => {
                e.stopPropagation();
                const eName = header.getAttribute('data-name');
                const eType = header.getAttribute('data-type');
                this.fetchAndRenderEntityDetail(eType, eName, container);
            };
        });

        container.querySelectorAll('.entity-video-card').forEach(card => {
            card.onclick = (e) => {
                e.stopPropagation();
                const path = decodeURIComponent(card.getAttribute('data-path'));
                const cardCode = (card.getAttribute('data-code') || path.split(/[/\\]/).pop()).trim().toUpperCase();
                if (cardCode) {
                    this.currentPlayingFilename = cardCode;
                }
                const groupCard = card.closest('.entity-group-card');
                const groupHeader = groupCard ? groupCard.querySelector('.clickable-entity-header') : null;
                if (groupHeader) {
                    const eName = groupHeader.getAttribute('data-name');
                    const eType = groupHeader.getAttribute('data-type');
                    if (eType === 'actresses') {
                        this.filterActress = eName;
                        this.filterGenre = '';
                        this.filterStudio = '';
                    } else if (eType === 'genres') {
                        this.filterGenre = eName;
                        this.filterActress = '';
                        this.filterStudio = '';
                    } else if (eType === 'studios') {
                        this.filterStudio = eName;
                        this.filterActress = '';
                        this.filterGenre = '';
                    }
                    this.sortKey = 'release_date';
                    this.sortAsc = false;
                }
                this.playVideoByPath(path);
            };
        });
    }

    bindEntityVideoCardClickEvents(type, entityName, container) {
        container.querySelectorAll('.entity-detail-videos-grid .entity-video-card').forEach(card => {
            card.onclick = (e) => {
                e.stopPropagation();
                const path = decodeURIComponent(card.getAttribute('data-path'));
                const cardCode = (card.getAttribute('data-code') || path.split(/[/\\]/).pop()).trim().toUpperCase();
                if (cardCode) {
                    this.currentPlayingFilename = cardCode;
                }
                if (type === 'actresses') {
                    this.filterActress = entityName;
                    this.filterGenre = '';
                    this.filterStudio = '';
                } else if (type === 'genres') {
                    this.filterGenre = entityName;
                    this.filterActress = '';
                    this.filterStudio = '';
                } else if (type === 'studios') {
                    this.filterStudio = entityName;
                    this.filterActress = '';
                    this.filterGenre = '';
                }
                if (this.entityDetailState && this.entityDetailState.name === entityName && this.entityDetailState.type === type) {
                    this.sortKey = this.entityDetailState.sortKey || 'release_date';
                    this.sortAsc = !!this.entityDetailState.sortAsc;
                    this.filterNoCover = !!this.entityDetailState.filterNoCover;
                } else {
                    this.sortKey = 'release_date';
                    this.sortAsc = false;
                }
                this.playVideoByPath(path);
            };
        });
    }

    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        if (Array.isArray(str)) str = str.join(', ');
        return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
}

