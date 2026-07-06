const RECENT_LIMIT = 10;

const ACTION_LABELS = {
	prev: '上一話',
	next: '下一話',
	top: '回到頂端',
	zoomOut: '縮小',
	zoomIn: '放大',
	zoomReset: '原始大小',
	help: '使用說明',
	openFolder: '開啟資料夾',
	darkMode: '深色模式切換',
	gridView: '格狀瀏覽切換',
	fullscreen: '全螢幕沉浸閱讀',
	preferences: '偏好設定',
	pageDown: '向下翻頁',
	pageUp: '向上翻頁',
	autoScroll: '自動捲動切換',
	toggleSidebarHidden: '側邊欄完全隱藏切換',
};

const ACCENT_PALETTE = ['#53c4c6', '#4f7df3', '#8b5cf6', '#f43f5e', '#22c55e', '#f59e0b'];
const DARK_SHADES = [['black', '近黑'], ['darkgray', '深灰'], ['gray', '中灰']];
const SIDEBAR_POSITIONS = [['left', '左'], ['right', '右']];

const ICON_FOLDER_SVG = '<svg viewBox="0 0 24 24" class="ti-icon"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>';
const ICON_ARCHIVE_SVG = '<svg viewBox="0 0 24 24" class="ti-icon"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v2a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V9"/></svg>';

const ICON_MOON_SVG = '<svg viewBox="0 0 24 24" class="icon"><path d="M20 12.8A8 8 0 1 1 11.2 4 6.4 6.4 0 0 0 20 12.8z"/></svg>';
const ICON_SUN_SVG = '<svg viewBox="0 0 24 24" class="icon"><circle cx="12" cy="12" r="3.2"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.9" y1="4.9" x2="7" y2="7"/><line x1="17" y1="17" x2="19.1" y2="19.1"/><line x1="4.9" y1="19.1" x2="7" y2="17"/><line x1="17" y1="7" x2="19.1" y2="4.9"/></svg>';

var config;
var curr = null;
var reList = null;
var scale;
var origWidth;
var boundKeys = [];
var capturingAction = null;
var currentSessionId = null;
var currentPageCount = 0;
var autoScrollActive = false;
var autoScrollRAF = null;
var autoScrollLastTime = null;
var autoScrollPosition = 0;

//------------------------------------------------------------------------------------------

function showMsg(msg) {
	document.getElementById('txt').textContent = msg;
}

function setLoading(isLoading) {
	document.getElementById('loadingOverlay').classList.toggle('hidden', !isLoading);
}

function extname(p) {
	var m = /\.[^./\\]+$/.exec(p);
	return m ? m[0].toLowerCase() : '';
}

function basename(p) {
	return p.split(/[\\/]/).pop();
}

function stripExt(name) {
	var ext = extname(name);
	return ext ? name.slice(0, -ext.length) : name;
}

function makeIconNode(html) {
	var tpl = document.createElement('template');
	tpl.innerHTML = html;
	return tpl.content.firstChild;
}

function removeSimg() {
	document.querySelectorAll('.simg').forEach(function (el) { el.remove(); });
}

// Multiple instances of the app may run at once and share config.json.
// patchConfig only ever sends the fields that actually changed (never a
// full snapshot of local state), so one instance's change can't clobber
// another instance's unrelated change when both save around the same time.
function patchConfig(partial) {
	Object.keys(partial).forEach(function (key) {
		if (key === 'keybindings' || key === 'history' || key === 'readMap') {
			config[key] = Object.assign({}, config[key], partial[key]);
		}
		else {
			config[key] = partial[key];
		}
	});
	return window.api.setConfig(partial);
}

function patchHistory(folderPath, fields) {
	var merged = Object.assign({}, config.history[folderPath], fields);
	var patch = {};
	patch[folderPath] = merged;
	return patchConfig({ history: patch });
}

function patchReadMap(folderPath, filePath) {
	var merged = Object.assign({}, config.readMap[folderPath]);
	merged[filePath] = true;
	var patch = {};
	patch[folderPath] = merged;
	return patchConfig({ readMap: patch });
}

function updateHistory(src) {
	patchHistory(config.path, { file: src });
}

function currentHistoryEntry() {
	return config.history[config.path] || {};
}

function saveCurr() {
	if (!curr) return;
	curr.dataset.vpos = document.getElementById('page').scrollTop;
	curr.classList.remove('active');
}

function clean() {
	document.getElementById('titleList').innerHTML = '';
	document.getElementById('pic').src = '';
	showMsg('');
	curr = null;
	removeSimg();
	stopAutoScroll();
	currentSessionId = null;
	currentPageCount = 0;
	document.getElementById('minimapStrip').innerHTML = '';
}

function sortList() {
	if (config.sort === 'time') {
		reList.sort(function (a, b) { return new Date(b.mtime) - new Date(a.mtime); });
	}
	else if (config.sort === 'nameu') {
		reList.sort(function (a, b) { return a.name.localeCompare(b.name); });
	}
	else if (config.sort === 'named') {
		reList.sort(function (a, b) { return b.name.localeCompare(a.name); });
	}
}

// file / archive / directory handling ------------------------------------------------------

async function showImg(node) {
	saveCurr();
	curr = node;
	var src = node.dataset.url;
	updateHistory(src);
	patchReadMap(config.path, src);
	node.classList.add('active', 'read');
	node.focus();
	showMsg(basename(src));
	removeSimg();
	var pic = document.getElementById('pic');
	pic.src = '';
	stopAutoScroll();

	setLoading(true);
	var res = await window.api.openArchive(src);
	setLoading(false);
	if (res.error) {
		showMsg(res.error);
		return;
	}
	currentSessionId = res.sessionId;
	currentPageCount = res.entries.length;
	res.entries.forEach(function (entry, i) {
		var url = 'comic://' + res.sessionId + '/' + entry.index;
		if (i === 0) {
			pic.src = url;
			// reassigning onclick replaces any handler from a previous
			// showImg() call instead of stacking a new listener each time
			pic.onclick = function () {
				if (config.viewMode === 'grid') switchToStripAndScroll(pic);
			};
		}
		else {
			var img = document.createElement('img');
			img.className = 'simg';
			img.src = url;
			img.addEventListener('click', function () {
				if (config.viewMode === 'grid') switchToStripAndScroll(img);
			});
			document.getElementById('picList').appendChild(img);
		}
	});
	document.getElementById('picList').focus();
	buildMinimap();
	updateProgress();
}

function switchToStripAndScroll(el) {
	setViewMode('strip');
	el.scrollIntoView();
}

function makeReLocal(reSort) {
	sortList();
	var refi = -1;
	var historyEntry = currentHistoryEntry();
	var readSet = config.readMap[config.path] || {};
	var titleList = document.getElementById('titleList');
	titleList.innerHTML = '';
	reList.forEach(function (entry, index) {
		var div = document.createElement('div');
		div.id = 're' + index;
		div.className = 'ti';
		div.tabIndex = index + 10;
		div.dataset.url = entry.path;
		div.dataset.vpos = (historyEntry.file === entry.path) ? (historyEntry.vpos || 0) : 0;
		div.appendChild(makeIconNode(entry.type === 'archive' ? ICON_ARCHIVE_SVG : ICON_FOLDER_SVG));
		var label = document.createElement('span');
		label.className = 'ti-label';
		label.textContent = stripExt(entry.name);
		div.appendChild(label);
		if (readSet[entry.path]) {
			div.classList.add('read');
			var dot = document.createElement('span');
			dot.className = 'ti-read-dot';
			div.appendChild(dot);
		}
		div.addEventListener('click', function () { showImg(div); });
		titleList.appendChild(div);

		if (reSort !== true) {
			if (historyEntry.file === entry.path) refi = index;
		}
		else if (document.getElementById('txt').textContent === entry.name) {
			refi = index;
		}
	});

	if (reSort !== true) {
		if (refi !== -1) document.getElementById('re' + refi).click();
	}
	else if (refi !== -1) {
		curr = document.getElementById('re' + refi);
		curr.classList.add('active');
	}
}

async function chooseFile() {
	var dir = await window.api.chooseFolder();
	if (!dir) return;
	config.path = dir;
	openPath();
}

async function openPath() {
	clean();
	document.getElementById('chapterSearch').value = '';
	setLoading(true);
	var res = await window.api.listDir(config.path);
	setLoading(false);
	if (res.error) {
		showMsg(res.error);
		return;
	}
	clean();
	reList = res.entries;
	makeReLocal(false);
	addRecent(config.path);
}

//------------------------------------------------------------------------------------------

// recent folders -----------------------------------------------------------------------

function addRecent(p) {
	config.recent = (config.recent || []).filter(function (r) { return r !== p; });
	config.recent.unshift(p);
	if (config.recent.length > RECENT_LIMIT) config.recent.length = RECENT_LIMIT;
	patchConfig({ recent: config.recent, path: p });
	renderRecentList();
}

function renderRecentList() {
	var list = document.getElementById('recentList');
	list.innerHTML = '';
	(config.recent || []).forEach(function (p) {
		var item = document.createElement('div');
		item.className = 'recent-item';
		item.textContent = basename(p);
		item.title = p;
		item.addEventListener('click', function () {
			config.path = p;
			openPath();
		});
		list.appendChild(item);
	});
}

function openRecent() {
	patchConfig({ sidebarCollapsed: false, sidebarHidden: false });
	applySidebarState();
	applySidebarHidden();
	var el = document.getElementById('recentSection');
	if (el) el.scrollIntoView({ block: 'nearest' });
}

// chapter search -------------------------------------------------------------------------

function filterChapterList() {
	var q = document.getElementById('chapterSearch').value.trim().toLowerCase();
	document.querySelectorAll('#titleList .ti').forEach(function (el) {
		var match = !q || el.textContent.toLowerCase().indexOf(q) !== -1;
		el.style.display = match ? '' : 'none';
	});
}

// sidebar / navigation --------------------------------------------------------------------

function toggleSidebar() {
	patchConfig({ sidebarCollapsed: !config.sidebarCollapsed });
	applySidebarState();
}

function applySidebarState() {
	document.getElementById('sidebar').classList.toggle('expanded', !config.sidebarCollapsed);
}

function toggleSidebarHidden() {
	patchConfig({ sidebarHidden: !config.sidebarHidden });
	applySidebarHidden();
}

function applySidebarHidden() {
	document.body.classList.toggle('sidebar-hidden', !!config.sidebarHidden);
}

function applySidebarPosition() {
	document.body.classList.toggle('sidebar-right', config.sidebarPosition === 'right');
}

function renderSidebarPositionSwatches() {
	var wrap = document.getElementById('sidebarPositionSwatches');
	wrap.innerHTML = '';
	SIDEBAR_POSITIONS.forEach(function (pair) {
		var btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'swatch-label' + (config.sidebarPosition === pair[0] ? ' active' : '');
		btn.textContent = pair[1];
		btn.addEventListener('click', function () {
			patchConfig({ sidebarPosition: pair[0] });
			applySidebarPosition();
			renderSidebarPositionSwatches();
		});
		wrap.appendChild(btn);
	});
}

function myTop() {
	document.getElementById('page').scrollTop = 0;
}

function myNext() {
	if (!curr) return;
	var n = (config.sort === 'nameu') ? curr.nextSibling : curr.previousSibling;
	if (n) n.click();
	else alert('已經是目錄結尾');
}

function myPrev() {
	if (!curr) return;
	var p = (config.sort === 'nameu') ? curr.previousSibling : curr.nextSibling;
	if (p) p.click();
	else alert('已經是目錄開頭');
}

function pageScroll(dir) {
	var page = document.getElementById('page');
	var amount = page.clientHeight * 0.9 * dir;
	page.scrollTo({ top: page.scrollTop + amount, behavior: 'smooth' });
}

// zoom -------------------------------------------------------------------------------------

function updateZoomPercentDisplay() {
	document.getElementById('zoomPercent').value = config.zoomMode === 'fit' ? 'Fit' : (Math.round(scale || 100) + '%');
}

function clampToMaxContentWidth(w) {
	var max = config.maxContentWidth;
	return (max && max > 0) ? Math.min(w, max) : w;
}

// the highest zoom percentage that doesn't exceed the configured max
// content width, so the displayed/tracked scale matches what's actually
// rendered instead of climbing past the point where zooming in further
// stops having any visible effect
function maxScaleForContentWidth() {
	var max = config.maxContentWidth;
	if (!max || max <= 0 || !origWidth) return Infinity;
	return (max / origWidth) * 100;
}

function setScale() {
	if (config.viewMode === 'grid') return;
	var pic = document.getElementById('pic');
	var picList = document.getElementById('picList');
	if (config.zoomMode === 'fit') {
		var containerWidth = clampToMaxContentWidth(Math.floor(document.getElementById('page').clientWidth) - 4);
		pic.style.width = containerWidth + 'px';
		document.querySelectorAll('.simg').forEach(function (el) { el.style.width = containerWidth + 'px'; });
		picList.style.width = containerWidth + 'px';
		updateZoomPercentDisplay();
		return;
	}
	scale = (scale === undefined) ? 100 : scale;
	var w = clampToMaxContentWidth(Math.floor(origWidth * scale / 100));
	pic.style.width = w + 'px';
	document.querySelectorAll('.simg').forEach(function (el) { el.style.width = w + 'px'; });
	picList.style.width = w + 'px';
	updateZoomPercentDisplay();
}

function leaveFitMode() {
	if (config.zoomMode === 'fit') {
		patchConfig({ zoomMode: 'manual' });
		document.getElementById('fitwidth_icon').classList.remove('active');
	}
}

function zoomOut() {
	leaveFitMode();
	var step = config.zoomStep || 5;
	scale = (scale === undefined) ? 100 : scale;
	scale = ((scale - step) > 0) ? (scale - step) : step;
	setScale();
}

function zoomIn() {
	leaveFitMode();
	scale = (scale === undefined) ? 100 : scale;
	scale = Math.min(scale + (config.zoomStep || 5), maxScaleForContentWidth());
	setScale();
}

function zoomOrig() {
	leaveFitMode();
	scale = 100;
	setScale();
}

function toggleFitWidth() {
	var next = config.zoomMode === 'fit' ? 'manual' : 'fit';
	patchConfig({ zoomMode: next });
	document.getElementById('fitwidth_icon').classList.toggle('active', next === 'fit');
	setScale();
}

function applyZoomPercentInput() {
	var raw = document.getElementById('zoomPercent').value;
	var v = parseInt(raw, 10);
	if (isFinite(v) && v > 0) {
		leaveFitMode();
		scale = v;
		setScale();
	}
	else {
		updateZoomPercentDisplay();
	}
}

// auto-scroll --------------------------------------------------------------------------

function toggleAutoScroll() {
	if (autoScrollActive) stopAutoScroll();
	else startAutoScroll();
}

function startAutoScroll() {
	autoScrollActive = true;
	document.getElementById('autoscroll_icon').classList.add('active');
	autoScrollPosition = document.getElementById('page').scrollTop;
	autoScrollLastTime = performance.now();
	autoScrollRAF = requestAnimationFrame(autoScrollStep);
}

function stopAutoScroll() {
	autoScrollActive = false;
	document.getElementById('autoscroll_icon').classList.remove('active');
	if (autoScrollRAF) cancelAnimationFrame(autoScrollRAF);
	autoScrollRAF = null;
}

function autoScrollStep(now) {
	var page = document.getElementById('page');
	// requestAnimationFrame is throttled or fully suspended while the window
	// is backgrounded/minimized; when it resumes, "now" can be seconds past
	// autoScrollLastTime. Capping dt keeps a single frame from jumping the
	// scroll position wildly or overshooting straight into stopAutoScroll().
	var dt = Math.min((now - autoScrollLastTime) / 1000, 0.1);
	autoScrollLastTime = now;
	// scrollTop rounds to whole pixels, so accumulating in a separate float
	// avoids losing sub-pixel deltas every frame (a fixed 40px/s at 60fps is
	// only ~0.67px/frame, which would otherwise never move the scrollbar)
	autoScrollPosition += (config.autoScrollSpeed || 40) * dt;
	page.scrollTop = autoScrollPosition;
	if (page.scrollTop >= page.scrollHeight - page.clientHeight - 2) {
		stopAutoScroll();
		return;
	}
	autoScrollRAF = requestAnimationFrame(autoScrollStep);
}

// reading progress -----------------------------------------------------------------------

function updateProgress() {
	var page = document.getElementById('page');
	var max = page.scrollHeight - page.clientHeight;
	var pct = max > 0 ? Math.round((page.scrollTop / max) * 100) : 100;
	pct = Math.max(0, Math.min(100, pct));
	document.getElementById('headerProgress').textContent = pct + '%';
	document.getElementById('progressBar').style.width = pct + '%';
	updateMinimapViewport();
}

// minimap ------------------------------------------------------------------------------

function buildMinimap() {
	var strip = document.getElementById('minimapStrip');
	strip.innerHTML = '';
	if (!config.showMinimap || !currentSessionId) return;
	for (var i = 0; i < currentPageCount; i++) {
		var img = document.createElement('img');
		img.src = 'comic://' + currentSessionId + '/' + i;
		// <img> is draggable by default; without this, starting a scrub
		// drag on top of a thumbnail hijacks into a native "drag this
		// image out" operation instead of firing mousemove, which also
		// fires spurious dragenter/dragover on our own window and pops
		// open the "drop a folder/archive here" overlay
		img.draggable = false;
		strip.appendChild(img);
	}
}

// The strip's thumbnails keep their natural aspect ratio at 100% width, so
// its total height is usually far taller than the visible minimap column
// (which just clips the overflow). Squeezing it down to exactly fill the
// column's height means "where you see it in the strip" and "where a click
// jumps to" are always measured against the same scale.
function scaleMinimapStrip() {
	var minimapEl = document.getElementById('minimap');
	var stripEl = document.getElementById('minimapStrip');
	stripEl.style.transform = '';
	if (!stripEl.offsetHeight || !minimapEl.clientHeight) return;
	var scaleFactor = minimapEl.clientHeight / stripEl.offsetHeight;
	stripEl.style.transformOrigin = 'top';
	stripEl.style.transform = 'scaleY(' + scaleFactor + ')';
}

function updateMinimapViewport() {
	if (!config.showMinimap) return;
	var page = document.getElementById('page');
	var minimapEl = document.getElementById('minimap');
	if (!page.scrollHeight || !minimapEl.clientHeight) return;
	var ratio = minimapEl.clientHeight / page.scrollHeight;
	var top = page.scrollTop * ratio;
	var height = page.clientHeight * ratio;
	var viewport = document.getElementById('minimapViewport');
	viewport.style.top = top + 'px';
	viewport.style.height = height + 'px';
}

function applyMinimapVisibility() {
	document.body.classList.toggle('show-minimap', !!config.showMinimap);
	if (config.showMinimap) {
		buildMinimap();
		scaleMinimapStrip();
		updateMinimapViewport();
	}
}

function applyProgressVisibility() {
	document.body.classList.toggle('hide-progress', !config.showProgress);
}

// overlays: help / preferences ------------------------------------------------------------

var IS_MAC = /Mac|iPod|iPhone|iPad/.test(navigator.platform);

// tokens whose display name isn't just their first letter capitalized
var KEY_DISPLAY_NAMES = { plus: '+', pageup: 'PageUp', pagedown: 'PageDown' };

function formatCombo(combo) {
	// Mousetrap resolves 'mod' to Cmd on macOS and Ctrl elsewhere by itself;
	// the display needs the same platform-specific translation
	return (combo || '').split('+').map(function (p) {
		if (p === 'mod') return IS_MAC ? 'Cmd' : 'Ctrl';
		if (KEY_DISPLAY_NAMES[p]) return KEY_DISPLAY_NAMES[p];
		return p.charAt(0).toUpperCase() + p.slice(1);
	}).join(' + ');
}

function renderHelpHotkeys() {
	var list = document.getElementById('helpHotkeyList');
	list.innerHTML = '';
	Object.keys(ACTION_LABELS).forEach(function (action) {
		if (action === 'gridView' && !config.gridViewEnabled) return;
		var label = document.createElement('div');
		label.textContent = ACTION_LABELS[action];
		var key = document.createElement('div');
		key.textContent = formatCombo(config.keybindings[action]);
		list.append(label, key);
	});
}

function showHelp() {
	renderHelpHotkeys();
	window.api.getVersion().then(function (v) {
		document.getElementById('appVersion').textContent = 'v' + v;
	});
	document.getElementById('my_help').classList.add('visible');
}

// closing an overlay only toggles a CSS class, so a focused <input> inside
// it (e.g. a preferences field) stays focused even though it's now hidden.
// Mousetrap silently ignores shortcuts while focus sits on an input, so
// reading shortcuts would then randomly stop working depending on which
// field was last touched. Moving focus back to the reader avoids that.
function returnFocusToReader() {
	var picList = document.getElementById('picList');
	if (picList) picList.focus();
}

function hideHelp() {
	document.getElementById('my_help').classList.remove('visible');
	returnFocusToReader();
}

function renderAccentSwatches() {
	var wrap = document.getElementById('accentSwatches');
	wrap.innerHTML = '';
	ACCENT_PALETTE.forEach(function (color) {
		var sw = document.createElement('button');
		sw.type = 'button';
		sw.className = 'swatch' + (config.accentColor === color ? ' active' : '');
		sw.style.background = color;
		sw.addEventListener('click', function () { setAccent(color); renderAccentSwatches(); });
		wrap.appendChild(sw);
	});
	var customInput = document.createElement('input');
	customInput.type = 'color';
	customInput.className = 'swatch';
	customInput.value = /^#[0-9a-f]{6}$/i.test(config.accentColor) ? config.accentColor : '#53c4c6';
	customInput.addEventListener('input', function () { setAccent(this.value); });
	wrap.appendChild(customInput);
}

function setAccent(color) {
	document.documentElement.style.setProperty('--accent', color);
	patchConfig({ accentColor: color });
}

function renderDarkShadeSwatches() {
	var wrap = document.getElementById('darkShadeSwatches');
	wrap.innerHTML = '';
	DARK_SHADES.forEach(function (pair) {
		var btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'swatch-label' + (config.darkShade === pair[0] ? ' active' : '');
		btn.textContent = pair[1];
		btn.addEventListener('click', function () {
			patchConfig({ darkShade: pair[0] });
			applyDarkShade();
			renderDarkShadeSwatches();
		});
		wrap.appendChild(btn);
	});
}

function applyDarkShade() {
	document.body.classList.remove('dark-shade-darkgray', 'dark-shade-gray');
	if (config.darkShade === 'darkgray') document.body.classList.add('dark-shade-darkgray');
	else if (config.darkShade === 'gray') document.body.classList.add('dark-shade-gray');
}

function applyMaxContentWidth() {
	var w = config.maxContentWidth;
	document.documentElement.style.setProperty('--max-content-width', (w && w > 0) ? w + 'px' : 'none');
}

function eventToCombo(e) {
	var key = e.key;
	if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;
	var map = {
		' ': 'space', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
		Escape: 'esc', Enter: 'enter', Home: 'home', End: 'end', '+': 'plus',
	};
	key = map[key] || key.toLowerCase();
	var parts = [];
	if (e.ctrlKey) parts.push('ctrl');
	if (e.altKey) parts.push('alt');
	if (e.shiftKey) parts.push('shift');
	if (e.metaKey) parts.push('meta');
	parts.push(key);
	return parts.join('+');
}

function renderKeybindList() {
	var list = document.getElementById('keybindList');
	list.innerHTML = '';
	Object.keys(ACTION_LABELS).forEach(function (action) {
		var row = document.createElement('div');
		row.className = 'keybind-row';
		var label = document.createElement('span');
		label.textContent = ACTION_LABELS[action];
		var keyBtn = document.createElement('button');
		keyBtn.type = 'button';
		keyBtn.className = 'keybind-key';
		keyBtn.textContent = formatCombo(config.keybindings[action]);
		keyBtn.addEventListener('click', function () { startCapture(action, keyBtn); });
		row.appendChild(label);
		row.appendChild(keyBtn);
		list.appendChild(row);
	});
}

function startCapture(action, btn) {
	if (capturingAction) return;
	capturingAction = action;
	btn.classList.add('capturing');
	btn.textContent = '按下按鍵…';

	function onKey(e) {
		e.preventDefault();
		e.stopPropagation();
		if (e.key === 'Escape') { finish(); return; }
		var combo = eventToCombo(e);
		if (!combo) return;
		var patch = {};
		patch[action] = combo;
		patchConfig({ keybindings: patch });
		applyKeybindings();
		finish();
	}
	function finish() {
		document.removeEventListener('keydown', onKey, true);
		btn.classList.remove('capturing');
		capturingAction = null;
		renderKeybindList();
	}
	document.addEventListener('keydown', onKey, true);
}

function applyToolbarVisibility() {
	document.body.classList.toggle('hide-sidebar-toolbar', !config.showSidebarToolbar);
	document.body.classList.toggle('hide-floating-nav', !config.showFloatingNav);
}

function applyGridAvailability() {
	document.getElementById('btnGrid').style.display = config.gridViewEnabled ? '' : 'none';
	if (!config.gridViewEnabled && config.viewMode === 'grid') {
		setViewMode('strip');
	}
}

function updateStartupFolderDisplay() {
	var radio = document.querySelector('input[name="startupMode"][value="' + config.startupMode + '"]');
	if (radio) radio.checked = true;
	var fixed = config.startupMode === 'fixed';
	var pathEl = document.getElementById('startupFolderPath');
	pathEl.textContent = config.startupFolder || '尚未選擇資料夾';
	pathEl.classList.toggle('disabled-text', !fixed);
	document.getElementById('btnChooseStartupFolder').disabled = !fixed;
}

async function chooseStartupFolder() {
	var dir = await window.api.chooseFolder();
	if (!dir) return;
	patchConfig({ startupFolder: dir });
	updateStartupFolderDisplay();
}

function setStartupMode(mode) {
	patchConfig({ startupMode: mode });
	updateStartupFolderDisplay();
}

function openPrefs() {
	updateStartupFolderDisplay();
	document.getElementById('prefDarkMode').checked = !!config.darkMode;
	document.getElementById('prefZoomStep').value = config.zoomStep;
	document.getElementById('prefAutoScrollSpeed').value = config.autoScrollSpeed;
	document.getElementById('prefMaxContentWidth').value = config.maxContentWidth;
	document.getElementById('prefShowSidebarToolbar').checked = !!config.showSidebarToolbar;
	document.getElementById('prefShowFloatingNav').checked = !!config.showFloatingNav;
	document.getElementById('prefGridViewEnabled').checked = !!config.gridViewEnabled;
	document.getElementById('prefShowMinimap').checked = !!config.showMinimap;
	document.getElementById('prefShowProgress').checked = !!config.showProgress;
	renderAccentSwatches();
	renderDarkShadeSwatches();
	renderSidebarPositionSwatches();
	renderKeybindList();
	document.getElementById('prefsPanel').classList.add('visible');
}

function closePrefs() {
	document.getElementById('prefsPanel').classList.remove('visible');
	returnFocusToReader();
}

async function resetKeybindings() {
	config = await window.api.resetKeybindings();
	applyKeybindings();
	renderKeybindList();
}

// dark mode / grid view / fullscreen -------------------------------------------------------

function applyDarkMode(on) {
	document.body.classList.toggle('dark', !!on);
	document.getElementById('btnDark').innerHTML = on ? ICON_SUN_SVG : ICON_MOON_SVG;
}

function toggleDark() {
	patchConfig({ darkMode: !config.darkMode });
	applyDarkMode(config.darkMode);
}

function setViewMode(mode) {
	if (mode === 'grid' && !config.gridViewEnabled) return;
	patchConfig({ viewMode: mode });
	document.getElementById('picList').classList.toggle('grid-view', mode === 'grid');
	if (mode === 'strip') setScale();
}

function toggleGrid() {
	if (!config.gridViewEnabled) return;
	setViewMode(config.viewMode === 'grid' ? 'strip' : 'grid');
}

async function toggleFullscreen() {
	await window.api.toggleFullscreen();
}

// opening an external path: drag & drop, "open with", double-clicked file ------------------

async function openExternalPath(p) {
	var stat = await window.api.statPath(p);
	if (stat.error) {
		showMsg(stat.error);
		return;
	}
	if (stat.isDirectory) {
		config.path = p;
	}
	else {
		config.path = window.api.dirname(p);
	}
	await openPath();
	if (!stat.isDirectory) {
		var target = reList.find(function (e) { return e.path === p; });
		if (target) {
			var idx = reList.indexOf(target);
			var node = document.getElementById('re' + idx);
			if (node) node.click();
		}
	}
}

async function handleDroppedFile(file) {
	await openExternalPath(window.api.getDroppedPath(file));
}

function bindDragDrop() {
	var overlay = document.getElementById('dropOverlay');
	var dragCounter = 0;
	window.addEventListener('dragover', function (e) { e.preventDefault(); });
	window.addEventListener('dragenter', function (e) {
		e.preventDefault();
		dragCounter++;
		overlay.classList.add('active');
	});
	window.addEventListener('dragleave', function (e) {
		e.preventDefault();
		dragCounter--;
		if (dragCounter <= 0) overlay.classList.remove('active');
	});
	window.addEventListener('drop', function (e) {
		e.preventDefault();
		dragCounter = 0;
		overlay.classList.remove('active');
		if (e.dataTransfer.files.length > 0) {
			handleDroppedFile(e.dataTransfer.files[0]);
		}
	});
}

// hotkeys / bindings ---------------------------------------------------------------------

function applyKeybindings() {
	boundKeys.forEach(function (k) { Mousetrap.unbind(k); });
	boundKeys = [];
	var actions = {
		prev: myPrev, next: myNext, top: myTop,
		zoomOut: zoomOut, zoomIn: zoomIn, zoomReset: zoomOrig,
		help: showHelp, openFolder: chooseFile, darkMode: toggleDark,
		gridView: toggleGrid, fullscreen: toggleFullscreen, preferences: openPrefs,
		pageDown: function () { pageScroll(1); }, pageUp: function () { pageScroll(-1); },
		autoScroll: toggleAutoScroll, toggleSidebarHidden: toggleSidebarHidden,
	};
	Object.keys(actions).forEach(function (action) {
		var combo = config.keybindings[action];
		if (!combo) return;
		Mousetrap.bind(combo, function (e) { e.preventDefault(); actions[action](); });
		boundKeys.push(combo);
	});
	Mousetrap.bind('enter', zoomOrig);
	boundKeys.push('enter');
	Mousetrap.bind('esc', function () {
		if (document.getElementById('my_help').classList.contains('visible')) hideHelp();
		else if (document.getElementById('prefsPanel').classList.contains('visible')) closePrefs();
	});
	boundKeys.push('esc');
}

function bindSort() {
	document.querySelectorAll('input[name="sort"]').forEach(function (el) {
		el.addEventListener('change', function () {
			patchConfig({ sort: this.value });
			document.getElementById('titleList').innerHTML = '';
			makeReLocal(true);
		});
	});
}

function jumpToMinimapFraction(clientY) {
	var rect = document.getElementById('minimap').getBoundingClientRect();
	var fraction = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
	var page = document.getElementById('page');
	page.scrollTop = fraction * (page.scrollHeight - page.clientHeight);
}

function bindMinimapScrub() {
	var minimap = document.getElementById('minimap');
	var dragging = false;
	minimap.addEventListener('mousedown', function (e) {
		dragging = true;
		jumpToMinimapFraction(e.clientY);
	});
	// listen on window (not just the minimap) so dragging past its edges,
	// which is normal mouse movement while scrubbing, still tracks
	window.addEventListener('mousemove', function (e) {
		if (!dragging) return;
		jumpToMinimapFraction(e.clientY);
	});
	window.addEventListener('mouseup', function () {
		dragging = false;
	});
}

function bindFloatingNavReveal() {
	// class toggle rather than jQuery's .css({opacity: ...}): jQuery 1.7.2's
	// legacy opacity cssHook misfires under modern Chromium (sets a stray
	// "zoom: 1" IE hasLayout hack but never actually applies the opacity)
	var picList = document.getElementById('picList');
	var floatingNav = document.getElementById('floatingNav');
	picList.addEventListener('mouseover', function () { floatingNav.classList.add('visible'); });
	picList.addEventListener('mouseleave', function () {
		if (!floatingNav.matches(':hover')) floatingNav.classList.remove('visible');
	});
}

function bindButtons() {
	document.getElementById('btnToggleSidebar').addEventListener('click', toggleSidebar);
	document.getElementById('btnOpenFolder').addEventListener('click', chooseFile);
	document.getElementById('btnHelp').addEventListener('click', showHelp);
	document.getElementById('btnCloseHelp').addEventListener('click', hideHelp);
	document.getElementById('my_help').addEventListener('mousedown', function (e) { if (e.target === this) hideHelp(); });
	document.getElementById('btnRecent').addEventListener('click', openRecent);
	document.getElementById('btnDark').addEventListener('click', toggleDark);
	document.getElementById('btnGrid').addEventListener('click', toggleGrid);
	document.getElementById('btnSettings').addEventListener('click', openPrefs);
	document.getElementById('btnClosePrefs').addEventListener('click', closePrefs);
	document.getElementById('prefsPanel').addEventListener('mousedown', function (e) { if (e.target === this) closePrefs(); });
	document.getElementById('btnResetKeybindings').addEventListener('click', resetKeybindings);
	document.getElementById('btnChooseStartupFolder').addEventListener('click', chooseStartupFolder);
	document.querySelectorAll('input[name="startupMode"]').forEach(function (el) {
		el.addEventListener('change', function () { setStartupMode(this.value); });
	});
	document.getElementById('prev_icon').addEventListener('click', myPrev);
	document.getElementById('top_icon').addEventListener('click', myTop);
	document.getElementById('next_icon').addEventListener('click', myNext);
	document.getElementById('zoomout_icon').addEventListener('click', zoomOut);
	document.getElementById('original_icon').addEventListener('click', zoomOrig);
	document.getElementById('zoomin_icon').addEventListener('click', zoomIn);
	document.getElementById('fitwidth_icon').addEventListener('click', toggleFitWidth);
	document.getElementById('autoscroll_icon').addEventListener('click', toggleAutoScroll);
	document.getElementById('fullscreen_icon').addEventListener('click', toggleFullscreen);
	document.getElementById('zoomPercent').addEventListener('focus', function () { this.select(); });
	document.getElementById('zoomPercent').addEventListener('keydown', function (e) { if (e.key === 'Enter') this.blur(); });
	document.getElementById('zoomPercent').addEventListener('blur', applyZoomPercentInput);
	document.getElementById('chapterSearch').addEventListener('input', filterChapterList);
	document.getElementById('page').addEventListener('wheel', function () { if (autoScrollActive) stopAutoScroll(); });

	document.getElementById('prefDarkMode').addEventListener('change', toggleDark);
	document.getElementById('prefZoomStep').addEventListener('change', function () {
		var v = parseInt(this.value, 10);
		if (!isFinite(v) || v < 1) v = 1;
		this.value = v;
		patchConfig({ zoomStep: v });
	});
	document.getElementById('prefAutoScrollSpeed').addEventListener('change', function () {
		var v = parseInt(this.value, 10);
		if (!isFinite(v) || v < 5) v = 5;
		this.value = v;
		patchConfig({ autoScrollSpeed: v });
	});
	document.getElementById('prefMaxContentWidth').addEventListener('change', function () {
		var v = parseInt(this.value, 10);
		if (!isFinite(v) || v < 0) v = 0;
		this.value = v;
		patchConfig({ maxContentWidth: v });
		applyMaxContentWidth();
	});
	document.getElementById('prefShowSidebarToolbar').addEventListener('change', function () {
		patchConfig({ showSidebarToolbar: this.checked });
		applyToolbarVisibility();
	});
	document.getElementById('prefShowFloatingNav').addEventListener('change', function () {
		patchConfig({ showFloatingNav: this.checked });
		applyToolbarVisibility();
	});
	document.getElementById('prefGridViewEnabled').addEventListener('change', function () {
		patchConfig({ gridViewEnabled: this.checked });
		applyGridAvailability();
	});
	document.getElementById('prefShowMinimap').addEventListener('change', function () {
		patchConfig({ showMinimap: this.checked });
		applyMinimapVisibility();
	});
	document.getElementById('prefShowProgress').addEventListener('change', function () {
		patchConfig({ showProgress: this.checked });
		applyProgressVisibility();
	});
}

async function readConfig() {
	config = await window.api.getConfig();
	var sortRadio = document.querySelector('input[name="sort"][value="' + config.sort + '"]');
	if (sortRadio) sortRadio.checked = true;
	applyDarkMode(config.darkMode);
	applyDarkShade();
	applyGridAvailability();
	setViewMode(config.viewMode === 'grid' && config.gridViewEnabled ? 'grid' : 'strip');
	applySidebarState();
	applySidebarHidden();
	applySidebarPosition();
	applyToolbarVisibility();
	applyMaxContentWidth();
	applyMinimapVisibility();
	applyProgressVisibility();
	document.getElementById('fitwidth_icon').classList.toggle('active', config.zoomMode === 'fit');
	document.documentElement.style.setProperty('--accent', config.accentColor);
	applyKeybindings();
	renderRecentList();

	var launchPath = await window.api.getLaunchPath();
	if (launchPath) {
		openExternalPath(launchPath);
	}
	else if (config.startupMode === 'fixed' && config.startupFolder) {
		config.path = config.startupFolder;
		openPath();
	}
	else if (config.path) {
		openPath();
	}
}

function setWindow() {
	window.api.onFullscreenChange(function (isFullscreen) {
		document.body.classList.toggle('immersive', isFullscreen);
	});

	window.api.onOpenPathRequest(function (p) { openExternalPath(p); });

	window.api.onBeforeClose(function () {
		stopAutoScroll();
		if (curr) {
			patchHistory(config.path, { file: curr.dataset.url, vpos: document.getElementById('page').scrollTop })
				.then(function () { window.api.readyToClose(); });
		}
		else {
			window.api.readyToClose();
		}
	});
}

// script is loaded at the end of <body>, after all markup above, so the DOM
// is already parsed and every element referenced here already exists
document.getElementById('pic').addEventListener('load', function () {
	var pic = document.getElementById('pic');
	if (curr) {
		document.getElementById('picList').focus();
		document.getElementById('page').scrollTop = curr.dataset.vpos;
	}
	origWidth = pic.naturalWidth;
	setScale();
	updateProgress();
});

document.getElementById('page').addEventListener('scroll', updateProgress);

// scrollHeight keeps growing as each subsequent strip image finishes
// loading (only the first #pic fires a 'load' we listen to), so a
// one-shot recompute goes stale; watch the actual content size instead.
var picListResizeObserver = new ResizeObserver(function () { updateProgress(); });
picListResizeObserver.observe(document.getElementById('picList'));

// re-derive the minimap strip's fit-to-column scale whenever its natural
// height changes (thumbnails loading in) or the column itself resizes
// (window resize)
var minimapResizeObserver = new ResizeObserver(function () {
	scaleMinimapStrip();
	updateMinimapViewport();
});
minimapResizeObserver.observe(document.getElementById('minimap'));
minimapResizeObserver.observe(document.getElementById('minimapStrip'));

bindSort();
bindButtons();
bindDragDrop();
bindMinimapScrub();
bindFloatingNavReveal();
setWindow();
readConfig();
