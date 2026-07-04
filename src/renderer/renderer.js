const ARCHIVE_EXT = ['.zip', '.cbz', '.rar', '.cbr'];
const RECENT_LIMIT = 10;

var config;
var curr = null;
var reList = null;
var scale;
var origWidth;
var nail = false;

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
	$(curr).css({ color: 'black' });
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

// file / archive handling ------------------------------------------------------------------

async function showImg(node) {
	saveCurr();
	curr = node;
	var src = node.dataset.url;
	updateHistory(src);
	$(node).css({ color: 'red' }).focus();
	showMsg(basename(src));
	removeSimg();
	$('#pic').attr('src', '');

	var ext = extname(src);
	if (ARCHIVE_EXT.includes(ext)) {
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
	}
	else {
		$('#pic').off('click.gridnav');
		$('#pic').attr('src', window.api.toFileUrl(src));
	}
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
		div.textContent = stripExt(entry.name);
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
		$(curr).css({ color: 'red' });
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

function toggleRecentList() {
	$('#recentList').toggleClass('hidden');
}

// window / navigation --------------------------------------------------------------------

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

function setLayout() {
	var w = window.innerWidth;
	var h = window.innerHeight;
	var menuw = $('#my_slider_menu').width();
	var navw = $('#my_nav').width();
	var helpw = $('#my_help').width();

	$('#page').css('height', (h - 2) + 'px');
	$('#my_slider_content').css('height', (h - 150 - 2) + 'px');
	$('#my_slider_menu').css('height', (h - 3) + 'px');
	$('#my_slider_scroll').css('height', (h - 3) + 'px');

	$('#page').css('width', (w - menuw) + 'px');
	$('#my_header').css('width', (w - menuw - 17) + 'px');
	$('#my_nav').css('left', ((w - menuw - 17 - navw) / 2 + menuw) + 'px');
	$('#my_help').css('left', ((w - menuw - 17 - helpw) / 2 + menuw) + 'px');
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
	scale = (scale === undefined) ? 100 : scale;
	scale = ((scale - 5) > 0) ? (scale - 5) : 5;
	setScale();
}

function zoomIn() {
	scale = (scale === undefined) ? 100 : scale;
	scale += 5;
	setScale();
}

function zoomOrig() {
	scale = 100;
	setScale();
}

function nailSlider() {
	nail = !nail;
	if (nail === false) $('#menu_icon').removeClass('nail');
	else {
		$('#menu_icon').addClass('nail');
		$('#my_slider_scroll').css('left', '54px');
	}
}

function showHelp() {
	var h = window.innerHeight;
	var hh = $('#my_help').height();
	$('#my_help').animate({ top: ((h - hh) / 2) + 'px' }, 200);
}

function hideHelp() {
	var hh = $('#my_help').height();
	$('#my_help').animate({ top: '-' + hh + 'px' }, 200);
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

function bindHotkey() {
	Mousetrap.bind('left', myPrev);
	Mousetrap.bind('right', myNext);
	Mousetrap.bind('home', myTop);
	Mousetrap.bind('-', zoomOut);
	Mousetrap.bind('plus', zoomIn);
	Mousetrap.bind('=', zoomOrig);
	Mousetrap.bind('enter', zoomOrig);
	Mousetrap.bind('f1', showHelp);
	Mousetrap.bind('ctrl+o', chooseFile);
	Mousetrap.bind('mod+d', toggleDark);
	Mousetrap.bind('mod+g', toggleGrid);
	Mousetrap.bind('f11', toggleFullscreen);
}

function bindSort() {
	$('input[name=sort]').change(function () {
		config.sort = this.value;
		persistConfig();
		$('#titleList').empty();
		makeReLocal(true);
	});
}

function bindAnimate() {
	var ssw = $('#my_slider_scroll').width();
	var menuw = $('#my_slider_menu').width();
	$('#my_slider_menu').mouseover(function () {
		if (nail === false && $('#my_slider_scroll').css('left') === (('-' + (ssw - menuw)) + 'px'))
			$('#my_slider_scroll').animate({ left: (menuw - 10) + 'px' }, 200);
	});
	$('#my_slider_scroll').mouseleave(function () {
		if (nail === false && $('#my_slider_scroll').css('left') === ((menuw - 10) + 'px'))
			$('#my_slider_scroll').animate({ left: (('-' + (ssw - menuw)) + 'px') }, 200);
	});
	$('#picList').mouseover(function () { $('#my_nav').fadeTo(200, 0.8); });
	$('#picList').mouseleave(function () {
		if ($('#my_nav:hover').length <= 0) $('#my_nav').fadeTo(200, 0);
	});
}

function bindButtons() {
	$('#menu_icon').click(nailSlider);
	$('#btnOpenFolder').click(chooseFile);
	$('#btnHelp').click(showHelp);
	$('#btnCloseHelp').click(hideHelp);
	$('#btnRecent').click(toggleRecentList);
	$('#btnDark').click(toggleDark);
	$('#btnGrid').click(toggleGrid);
	$('#prev_icon').click(myPrev);
	$('#top_icon').click(myTop);
	$('#next_icon').click(myNext);
	$('#zoomout_icon').click(zoomOut);
	$('#original_icon').click(zoomOrig);
	$('#zoomin_icon').click(zoomIn);
	$('#fullscreen_icon').click(toggleFullscreen);
}

async function readConfig() {
	config = await window.api.getConfig();
	$('input[name=sort][value=' + config.sort + ']').prop('checked', true);
	applyDarkMode(config.darkMode);
	setViewMode(config.viewMode || 'strip');
	renderRecentList();
	if (config.path) openPath();
}

function setWindow() {
	setLayout();
	window.addEventListener('resize', setLayout);

	window.api.onFullscreenChange(function (isFullscreen) {
		$('body').toggleClass('immersive', isFullscreen);
		setLayout();
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

	bindHotkey();
	bindAnimate();
	bindSort();
	bindButtons();
	bindDragDrop();
	setWindow();
	readConfig();
});
