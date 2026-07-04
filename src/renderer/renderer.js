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
};

const ACCENT_PALETTE = ['#53c4c6', '#4f7df3', '#8b5cf6', '#f43f5e', '#22c55e', '#f59e0b'];

const ICON_FOLDER_SVG = '<svg viewBox="0 0 24 24" class="ti-icon"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>';
const ICON_ARCHIVE_SVG = '<svg viewBox="0 0 24 24" class="ti-icon"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v2a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V9"/></svg>';

var config;
var curr = null;
var reList = null;
var scale;
var origWidth;
var boundKeys = [];
var capturingAction = null;

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

function updateHistory(src) {
	config.history[config.path] = src;
}

function readHistory() {
	return config.history[config.path];
}

function persistConfig() {
	window.api.setConfig(config);
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
	$(node).addClass('active').focus();
	showMsg(basename(src));
	removeSimg();
	$('#pic').attr('src', '');

	var res = await window.api.openArchive(src);
	if (res.error) {
		showMsg(res.error);
		return;
	}
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
}

function switchToStripAndScroll(el) {
	setViewMode('strip');
	el.scrollIntoView();
}

function makeReLocal(reSort) {
	sortList();
	var refi = -1;
	var history = readHistory();
	$('#titleList').empty();
	reList.forEach(function (entry, index) {
		var div = document.createElement('div');
		div.id = 're' + index;
		div.className = 'ti';
		div.tabIndex = index + 10;
		div.dataset.url = entry.path;
		div.dataset.vpos = (config.lastfile === entry.path) ? (config.vpos || 0) : 0;
		div.appendChild(makeIconNode(entry.type === 'archive' ? ICON_ARCHIVE_SVG : ICON_FOLDER_SVG));
		var label = document.createElement('span');
		label.textContent = stripExt(entry.name);
		div.appendChild(label);
		div.addEventListener('click', function () { showImg(div); });
		document.getElementById('titleList').appendChild(div);

		if (reSort !== true) {
			if (config.lastfile === entry.path || history === entry.path) refi = index;
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
	persistConfig();
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
	$('#sidebar').addClass('expanded');
	config.sidebarCollapsed = false;
	persistConfig();
	var el = document.getElementById('recentSection');
	if (el) el.scrollIntoView({ block: 'nearest' });
}

// sidebar / navigation --------------------------------------------------------------------

function toggleSidebar() {
	config.sidebarCollapsed = !config.sidebarCollapsed;
	applySidebarState();
	persistConfig();
}

function applySidebarState() {
	$('#sidebar').toggleClass('expanded', !config.sidebarCollapsed);
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

function setScale() {
	if (config.viewMode === 'grid') return;
	scale = (scale === undefined) ? 100 : scale;
	var w = Math.floor(origWidth * scale / 100);
	$('#pic').width(w);
	$('.simg').each(function () { $(this).width(w); });
	$('#picList').width(w);
}

function zoomOut() {
	var step = config.zoomStep || 5;
	scale = (scale === undefined) ? 100 : scale;
	scale = ((scale - step) > 0) ? (scale - step) : step;
	setScale();
}

function zoomIn() {
	scale = (scale === undefined) ? 100 : scale;
	scale += (config.zoomStep || 5);
	setScale();
}

function zoomOrig() {
	scale = 100;
	setScale();
}

// overlays: help / preferences ------------------------------------------------------------

function formatCombo(combo) {
	return (combo || '').split('+').map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1); }).join(' + ');
}

function renderHelpHotkeys() {
	var list = $('#helpHotkeyList');
	list.empty();
	Object.keys(ACTION_LABELS).forEach(function (action) {
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
	config.accentColor = color;
	document.documentElement.style.setProperty('--accent', color);
	persistConfig();
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
	var prevText = btn.textContent;
	btn.textContent = '按下按鍵…';

	function onKey(e) {
		e.preventDefault();
		e.stopPropagation();
		if (e.key === 'Escape') { finish(); return; }
		var combo = eventToCombo(e);
		if (!combo) return;
		config.keybindings[action] = combo;
		persistConfig();
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

function openPrefs() {
	$('#prefDarkMode').prop('checked', !!config.darkMode);
	$('#prefZoomStep').val(config.zoomStep);
	$('#prefShowSidebarToolbar').prop('checked', !!config.showSidebarToolbar);
	$('#prefShowFloatingNav').prop('checked', !!config.showFloatingNav);
	renderAccentSwatches();
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
	config.darkMode = !config.darkMode;
	applyDarkMode(config.darkMode);
	persistConfig();
}

function setViewMode(mode) {
	config.viewMode = mode;
	$('#picList').toggleClass('grid-view', mode === 'grid');
	if (mode === 'strip') setScale();
	persistConfig();
}

function toggleGrid() {
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
		config.sort = this.value;
		persistConfig();
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
	$('#prev_icon').click(myPrev);
	$('#top_icon').click(myTop);
	$('#next_icon').click(myNext);
	$('#zoomout_icon').click(zoomOut);
	$('#original_icon').click(zoomOrig);
	$('#zoomin_icon').click(zoomIn);
	$('#fullscreen_icon').click(toggleFullscreen);

	$('#prefDarkMode').on('change', toggleDark);
	$('#prefZoomStep').on('change', function () {
		var v = parseInt(this.value, 10);
		if (!isFinite(v) || v < 1) v = 1;
		config.zoomStep = v;
		this.value = v;
		persistConfig();
	});
	$('#prefShowSidebarToolbar').on('change', function () {
		config.showSidebarToolbar = this.checked;
		applyToolbarVisibility();
		persistConfig();
	});
	$('#prefShowFloatingNav').on('change', function () {
		config.showFloatingNav = this.checked;
		applyToolbarVisibility();
		persistConfig();
	});
}

async function readConfig() {
	config = await window.api.getConfig();
	$('input[name=sort][value=' + config.sort + ']').prop('checked', true);
	applyDarkMode(config.darkMode);
	setViewMode(config.viewMode || 'strip');
	applySidebarState();
	applyToolbarVisibility();
	document.documentElement.style.setProperty('--accent', config.accentColor);
	applyKeybindings();
	renderRecentList();
	if (config.path) openPath();
}

function setWindow() {
	window.api.onFullscreenChange(function (isFullscreen) {
		$('body').toggleClass('immersive', isFullscreen);
	});

	window.api.onBeforeClose(function () {
		if (curr) {
			config.lastfile = curr.dataset.url;
			config.vpos = $('#page').scrollTop();
		}
		window.api.setConfig(config).then(function () { window.api.readyToClose(); });
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
	});

	bindSort();
	bindButtons();
	bindDragDrop();
	bindFloatingNavReveal();
	setWindow();
	readConfig();
});
