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

//------------------------------------------------------------------------------------------

function showMsg(msg) {
	$('#txt').text(msg);
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
	$('.simg').remove();
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
	curr.dataset.vpos = $('#page').scrollTop();
	$(curr).removeClass('active');
}

function clean() {
	$('#titleList').empty();
	$('#pic').attr('src', '');
	showMsg('');
	curr = null;
	removeSimg();
	stopAutoScroll();
	currentSessionId = null;
	currentPageCount = 0;
	$('#minimapStrip').empty();
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
	$(node).addClass('active read').focus();
	showMsg(basename(src));
	removeSimg();
	$('#pic').attr('src', '');
	stopAutoScroll();

	var res = await window.api.openArchive(src);
	if (res.error) {
		showMsg(res.error);
		return;
	}
	currentSessionId = res.sessionId;
	currentPageCount = res.entries.length;
	res.entries.forEach(function (entry, i) {
		var url = 'comic://' + res.sessionId + '/' + entry.index;
		if (i === 0) {
			$('#pic').attr('src', url);
			$('#pic').off('click.gridnav').on('click.gridnav', function () {
				if (config.viewMode === 'grid') switchToStripAndScroll($('#pic')[0]);
			});
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
	$('#picList').focus();
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
	$('#titleList').empty();
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
		document.getElementById('titleList').appendChild(div);

		if (reSort !== true) {
			if (historyEntry.file === entry.path) refi = index;
		}
		else if ($('#txt').text() === entry.name) {
			refi = index;
		}
	});

	if (reSort !== true) {
		if (refi !== -1) $('#re' + refi).click();
	}
	else if (refi !== -1) {
		curr = document.getElementById('re' + refi);
		$(curr).addClass('active');
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
	$('#chapterSearch').val('');
	var res = await window.api.listDir(config.path);
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
	var list = $('#recentList');
	list.empty();
	(config.recent || []).forEach(function (p) {
		var item = document.createElement('div');
		item.className = 'recent-item';
		item.textContent = basename(p);
		item.title = p;
		item.addEventListener('click', function () {
			config.path = p;
			openPath();
		});
		list.append(item);
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
	var q = $('#chapterSearch').val().trim().toLowerCase();
	$('#titleList .ti').each(function () {
		var match = !q || $(this).text().toLowerCase().indexOf(q) !== -1;
		$(this).toggle(match);
	});
}

// sidebar / navigation --------------------------------------------------------------------

function toggleSidebar() {
	patchConfig({ sidebarCollapsed: !config.sidebarCollapsed });
	applySidebarState();
}

function applySidebarState() {
	$('#sidebar').toggleClass('expanded', !config.sidebarCollapsed);
}

function toggleSidebarHidden() {
	patchConfig({ sidebarHidden: !config.sidebarHidden });
	applySidebarHidden();
}

function applySidebarHidden() {
	$('body').toggleClass('sidebar-hidden', !!config.sidebarHidden);
}

function applySidebarPosition() {
	$('body').toggleClass('sidebar-right', config.sidebarPosition === 'right');
}

function renderSidebarPositionSwatches() {
	var wrap = $('#sidebarPositionSwatches');
	wrap.empty();
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
		wrap.append(btn);
	});
}

function myTop() {
	$('#page').scrollTop(0);
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
	$('#page').stop().animate({ scrollTop: page.scrollTop + amount }, 180);
}

// zoom -------------------------------------------------------------------------------------

function updateZoomPercentDisplay() {
	$('#zoomPercent').val(config.zoomMode === 'fit' ? 'Fit' : (Math.round(scale || 100) + '%'));
}

function setScale() {
	if (config.viewMode === 'grid') return;
	if (config.zoomMode === 'fit') {
		var containerWidth = Math.floor($('#page').width()) - 4;
		$('#pic').width(containerWidth);
		$('.simg').each(function () { $(this).width(containerWidth); });
		$('#picList').width(containerWidth);
		updateZoomPercentDisplay();
		return;
	}
	scale = (scale === undefined) ? 100 : scale;
	var w = Math.floor(origWidth * scale / 100);
	$('#pic').width(w);
	$('.simg').each(function () { $(this).width(w); });
	$('#picList').width(w);
	updateZoomPercentDisplay();
}

function leaveFitMode() {
	if (config.zoomMode === 'fit') {
		patchConfig({ zoomMode: 'manual' });
		$('#fitwidth_icon').removeClass('active');
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
	scale += (config.zoomStep || 5);
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
	$('#fitwidth_icon').toggleClass('active', next === 'fit');
	setScale();
}

function applyZoomPercentInput() {
	var raw = $('#zoomPercent').val();
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
	$('#autoscroll_icon').addClass('active');
	autoScrollLastTime = performance.now();
	autoScrollRAF = requestAnimationFrame(autoScrollStep);
}

function stopAutoScroll() {
	autoScrollActive = false;
	$('#autoscroll_icon').removeClass('active');
	if (autoScrollRAF) cancelAnimationFrame(autoScrollRAF);
	autoScrollRAF = null;
}

function autoScrollStep(now) {
	var page = document.getElementById('page');
	var dt = (now - autoScrollLastTime) / 1000;
	autoScrollLastTime = now;
	page.scrollTop += (config.autoScrollSpeed || 40) * dt;
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
	$('#headerProgress').text(pct + '%');
	$('#progressBar').css('width', pct + '%');
	updateMinimapViewport();
}

// minimap ------------------------------------------------------------------------------

function buildMinimap() {
	var strip = $('#minimapStrip');
	strip.empty();
	if (!config.showMinimap || !currentSessionId) return;
	for (var i = 0; i < currentPageCount; i++) {
		var img = document.createElement('img');
		img.src = 'comic://' + currentSessionId + '/' + i;
		strip.append(img);
	}
}

function updateMinimapViewport() {
	if (!config.showMinimap) return;
	var page = document.getElementById('page');
	var stripEl = document.getElementById('minimapStrip');
	if (!page.scrollHeight || !stripEl.offsetHeight) return;
	var ratio = stripEl.offsetHeight / page.scrollHeight;
	var top = page.scrollTop * ratio;
	var height = page.clientHeight * ratio;
	$('#minimapViewport').css({ top: top + 'px', height: height + 'px' });
}

function applyMinimapVisibility() {
	$('body').toggleClass('show-minimap', !!config.showMinimap);
	if (config.showMinimap) {
		buildMinimap();
		updateMinimapViewport();
	}
}

function applyProgressVisibility() {
	$('body').toggleClass('hide-progress', !config.showProgress);
}

// overlays: help / preferences ------------------------------------------------------------

function formatCombo(combo) {
	return (combo || '').split('+').map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1); }).join(' + ');
}

function renderHelpHotkeys() {
	var list = $('#helpHotkeyList');
	list.empty();
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
	$('#my_help').addClass('visible');
}

function hideHelp() {
	$('#my_help').removeClass('visible');
}

function renderAccentSwatches() {
	var wrap = $('#accentSwatches');
	wrap.empty();
	ACCENT_PALETTE.forEach(function (color) {
		var sw = document.createElement('button');
		sw.type = 'button';
		sw.className = 'swatch' + (config.accentColor === color ? ' active' : '');
		sw.style.background = color;
		sw.addEventListener('click', function () { setAccent(color); renderAccentSwatches(); });
		wrap.append(sw);
	});
	var customInput = document.createElement('input');
	customInput.type = 'color';
	customInput.className = 'swatch';
	customInput.value = /^#[0-9a-f]{6}$/i.test(config.accentColor) ? config.accentColor : '#53c4c6';
	customInput.addEventListener('input', function () { setAccent(this.value); });
	wrap.append(customInput);
}

function setAccent(color) {
	document.documentElement.style.setProperty('--accent', color);
	patchConfig({ accentColor: color });
}

function renderDarkShadeSwatches() {
	var wrap = $('#darkShadeSwatches');
	wrap.empty();
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
		wrap.append(btn);
	});
}

function applyDarkShade() {
	$('body').removeClass('dark-shade-darkgray dark-shade-gray');
	if (config.darkShade === 'darkgray') $('body').addClass('dark-shade-darkgray');
	else if (config.darkShade === 'gray') $('body').addClass('dark-shade-gray');
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
	var list = $('#keybindList');
	list.empty();
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
		list.append(row);
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
	$('body').toggleClass('hide-sidebar-toolbar', !config.showSidebarToolbar);
	$('body').toggleClass('hide-floating-nav', !config.showFloatingNav);
}

function applyGridAvailability() {
	$('#btnGrid').toggle(!!config.gridViewEnabled);
	if (!config.gridViewEnabled && config.viewMode === 'grid') {
		setViewMode('strip');
	}
}

function updateStartupFolderDisplay() {
	$('input[name=startupMode][value=' + config.startupMode + ']').prop('checked', true);
	var fixed = config.startupMode === 'fixed';
	$('#startupFolderPath').text(config.startupFolder || '尚未選擇資料夾').toggleClass('disabled-text', !fixed);
	$('#btnChooseStartupFolder').prop('disabled', !fixed);
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
	$('#prefDarkMode').prop('checked', !!config.darkMode);
	$('#prefZoomStep').val(config.zoomStep);
	$('#prefAutoScrollSpeed').val(config.autoScrollSpeed);
	$('#prefMaxContentWidth').val(config.maxContentWidth);
	$('#prefShowSidebarToolbar').prop('checked', !!config.showSidebarToolbar);
	$('#prefShowFloatingNav').prop('checked', !!config.showFloatingNav);
	$('#prefGridViewEnabled').prop('checked', !!config.gridViewEnabled);
	$('#prefShowMinimap').prop('checked', !!config.showMinimap);
	$('#prefShowProgress').prop('checked', !!config.showProgress);
	renderAccentSwatches();
	renderDarkShadeSwatches();
	renderSidebarPositionSwatches();
	renderKeybindList();
	$('#prefsPanel').addClass('visible');
}

function closePrefs() {
	$('#prefsPanel').removeClass('visible');
}

async function resetKeybindings() {
	config = await window.api.resetKeybindings();
	applyKeybindings();
	renderKeybindList();
}

// dark mode / grid view / fullscreen -------------------------------------------------------

function applyDarkMode(on) {
	$('body').toggleClass('dark', !!on);
}

function toggleDark() {
	patchConfig({ darkMode: !config.darkMode });
	applyDarkMode(config.darkMode);
}

function setViewMode(mode) {
	if (mode === 'grid' && !config.gridViewEnabled) return;
	patchConfig({ viewMode: mode });
	$('#picList').toggleClass('grid-view', mode === 'grid');
	if (mode === 'strip') setScale();
}

function toggleGrid() {
	if (!config.gridViewEnabled) return;
	setViewMode(config.viewMode === 'grid' ? 'strip' : 'grid');
}

async function toggleFullscreen() {
	await window.api.toggleFullscreen();
}

// drag & drop --------------------------------------------------------------------------

async function handleDroppedFile(file) {
	var p = window.api.getDroppedPath(file);
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
		if ($('#my_help').hasClass('visible')) hideHelp();
		else if ($('#prefsPanel').hasClass('visible')) closePrefs();
	});
	boundKeys.push('esc');
}

function bindSort() {
	$('input[name=sort]').change(function () {
		patchConfig({ sort: this.value });
		$('#titleList').empty();
		makeReLocal(true);
	});
}

function bindFloatingNavReveal() {
	$('#picList').mouseover(function () { $('#floatingNav').css({ opacity: 0.9, pointerEvents: 'auto' }); });
	$('#picList').mouseleave(function () {
		if ($('#floatingNav:hover').length <= 0) $('#floatingNav').css({ opacity: 0, pointerEvents: 'none' });
	});
}

function bindButtons() {
	$('#btnToggleSidebar').click(toggleSidebar);
	$('#btnOpenFolder').click(chooseFile);
	$('#btnHelp').click(showHelp);
	$('#btnCloseHelp').click(hideHelp);
	$('#my_help').on('mousedown', function (e) { if (e.target === this) hideHelp(); });
	$('#btnRecent').click(openRecent);
	$('#btnDark').click(toggleDark);
	$('#btnGrid').click(toggleGrid);
	$('#btnSettings').click(openPrefs);
	$('#btnClosePrefs').click(closePrefs);
	$('#prefsPanel').on('mousedown', function (e) { if (e.target === this) closePrefs(); });
	$('#btnResetKeybindings').click(resetKeybindings);
	$('#btnChooseStartupFolder').click(chooseStartupFolder);
	$('input[name=startupMode]').change(function () { setStartupMode(this.value); });
	$('#prev_icon').click(myPrev);
	$('#top_icon').click(myTop);
	$('#next_icon').click(myNext);
	$('#zoomout_icon').click(zoomOut);
	$('#original_icon').click(zoomOrig);
	$('#zoomin_icon').click(zoomIn);
	$('#fitwidth_icon').click(toggleFitWidth);
	$('#autoscroll_icon').click(toggleAutoScroll);
	$('#fullscreen_icon').click(toggleFullscreen);
	$('#zoomPercent').on('focus', function () { this.select(); });
	$('#zoomPercent').on('keydown', function (e) { if (e.key === 'Enter') this.blur(); });
	$('#zoomPercent').on('blur', applyZoomPercentInput);
	$('#chapterSearch').on('input', filterChapterList);
	$('#page').on('wheel', function () { if (autoScrollActive) stopAutoScroll(); });
	$('#minimap').on('click', function (e) {
		var rect = this.getBoundingClientRect();
		var fraction = (e.clientY - rect.top) / rect.height;
		var page = document.getElementById('page');
		page.scrollTop = fraction * (page.scrollHeight - page.clientHeight);
	});

	$('#prefDarkMode').on('change', toggleDark);
	$('#prefZoomStep').on('change', function () {
		var v = parseInt(this.value, 10);
		if (!isFinite(v) || v < 1) v = 1;
		this.value = v;
		patchConfig({ zoomStep: v });
	});
	$('#prefAutoScrollSpeed').on('change', function () {
		var v = parseInt(this.value, 10);
		if (!isFinite(v) || v < 5) v = 5;
		this.value = v;
		patchConfig({ autoScrollSpeed: v });
	});
	$('#prefMaxContentWidth').on('change', function () {
		var v = parseInt(this.value, 10);
		if (!isFinite(v) || v < 0) v = 0;
		this.value = v;
		patchConfig({ maxContentWidth: v });
		applyMaxContentWidth();
	});
	$('#prefShowSidebarToolbar').on('change', function () {
		patchConfig({ showSidebarToolbar: this.checked });
		applyToolbarVisibility();
	});
	$('#prefShowFloatingNav').on('change', function () {
		patchConfig({ showFloatingNav: this.checked });
		applyToolbarVisibility();
	});
	$('#prefGridViewEnabled').on('change', function () {
		patchConfig({ gridViewEnabled: this.checked });
		applyGridAvailability();
	});
	$('#prefShowMinimap').on('change', function () {
		patchConfig({ showMinimap: this.checked });
		applyMinimapVisibility();
	});
	$('#prefShowProgress').on('change', function () {
		patchConfig({ showProgress: this.checked });
		applyProgressVisibility();
	});
}

async function readConfig() {
	config = await window.api.getConfig();
	$('input[name=sort][value=' + config.sort + ']').prop('checked', true);
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
	$('#fitwidth_icon').toggleClass('active', config.zoomMode === 'fit');
	document.documentElement.style.setProperty('--accent', config.accentColor);
	applyKeybindings();
	renderRecentList();
	if (config.startupMode === 'fixed' && config.startupFolder) {
		config.path = config.startupFolder;
		openPath();
	}
	else if (config.path) {
		openPath();
	}
}

function setWindow() {
	window.api.onFullscreenChange(function (isFullscreen) {
		$('body').toggleClass('immersive', isFullscreen);
	});

	window.api.onBeforeClose(function () {
		stopAutoScroll();
		if (curr) {
			patchHistory(config.path, { file: curr.dataset.url, vpos: $('#page').scrollTop() })
				.then(function () { window.api.readyToClose(); });
		}
		else {
			window.api.readyToClose();
		}
	});
}

$(document).ready(function () {
	$('#pic').on('load', function () {
		if (curr) {
			$('#picList').focus();
			$('#page').scrollTop(curr.dataset.vpos);
		}
		origWidth = $('#pic').prop('naturalWidth');
		setScale();
		updateProgress();
	});

	$('#page').on('scroll', updateProgress);

	// scrollHeight keeps growing as each subsequent strip image finishes
	// loading (only the first #pic fires a 'load' we listen to), so a
	// one-shot recompute goes stale; watch the actual content size instead.
	var picListResizeObserver = new ResizeObserver(function () { updateProgress(); });
	picListResizeObserver.observe(document.getElementById('picList'));

	bindSort();
	bindButtons();
	bindDragDrop();
	bindFloatingNavReveal();
	setWindow();
	readConfig();
});
