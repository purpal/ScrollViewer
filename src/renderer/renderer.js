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
	scrollDown: '向下捲動',
	scrollUp: '向上捲動',
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
// loadedChapters holds, in reading order, every chapter currently rendered
// in #picList (length 1 normally, up to 2 while auto-continue is bridging
// into the next chapter). activeChapterPos is which of those the reader is
// currently scrolled into, used to scope progress/minimap/history to just
// that chapter even though its images sit inside a longer merged strip.
var loadedChapters = [];
var activeChapterPos = 0;
var pendingChapterLoad = false;
// set around every scrollTop write we make ourselves to keep the reader's
// view visually stable across a chapter prepend/evict (see
// prependChapterImages/evictOldestChapterIfNeeded). Those writes fire their
// own native 'scroll' event, and letting that reenter the normal handler
// below is actively harmful, not just wasteful: landing scrollTop near 0
// right after evicting the front chapter looks identical to "the reader
// scrolled up to the top", which would immediately re-fetch and re-prepend
// the very chapter that was just evicted, thrashing between the two
// forever instead of settling.
var isCompensatingScroll = false;
// debounce handle for maybeAutoContinuePreviousChapter - see its own comment
var previousContinueDebounceTimer = null;
// getBoundingClientRect()/scrollHeight force a synchronous layout reflow.
// Reading them fresh on every single 'scroll' event (which fires on every
// animation frame during auto-scroll) forces the browser to redo layout
// ~60 times/sec even though nothing changed shape, causing occasional
// dropped frames that show up as visible jitter (more so at higher
// configured auto-scroll speeds, since each frame is already moving
// further, so any one frame's timing hiccup produces a bigger jump).
// This cache holds the same geometry, refreshed only when content shape
// actually changes (chapter append/evict, image loads/resizes, zoom).
var geometryCache = { chapterTops: [], scrollHeight: 0, clientHeight: 0 };
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
	curr.dataset.vpos = getCurrentVpos();
	curr.classList.remove('active');
}

function clean() {
	document.getElementById('titleList').innerHTML = '';
	showMsg('');
	curr = null;
	removeSimg();
	stopAutoScroll();
	currentSessionId = null;
	currentPageCount = 0;
	loadedChapters = [];
	activeChapterPos = 0;
	pendingChapterLoad = false;
	if (previousContinueDebounceTimer) {
		clearTimeout(previousContinueDebounceTimer);
		previousContinueDebounceTimer = null;
	}
	document.getElementById('minimapStrip').innerHTML = '';
	upscaleRequested.clear();
	upscaleVisible.clear();
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
	stopAutoScroll();
	loadedChapters = [];
	activeChapterPos = 0;
	pendingChapterLoad = false;

	setLoading(true);
	var res = await window.api.openArchive(src);
	setLoading(false);
	if (res.error) {
		showMsg(res.error);
		return;
	}
	appendChapterImages(node, res.sessionId, res.entries, { isManualOpen: true });
	refreshActiveChapterDisplay();
	document.getElementById('picList').focus();
	updateProgress();
}

function createPageImg(sessionId, entry) {
	var img = document.createElement('img');
	img.className = 'simg';
	img.src = 'comic://' + sessionId + '/' + entry.index;
	img.dataset.sessionId = sessionId;
	img.dataset.pageIndex = entry.index;
	img.addEventListener('click', function () {
		if (config.viewMode === 'grid') switchToStripAndScroll(img);
	});
	img.addEventListener('load', function () {
		if (upscaleVisible.has(img)) maybeUpscale(img);
	});
	upscaleObserver.observe(img);
	return img;
}

// Renders one chapter's pages into #picList and records it in
// loadedChapters. isManualOpen distinguishes a user-initiated chapter open
// (recompute origWidth from this chapter's own first page, and restore its
// remembered scroll position once that page loads) from an auto-continued
// append (seamlessly extend the strip using the already-established zoom
// basis, with no scroll jump).
function appendChapterImages(node, sessionId, entries, opts) {
	var picList = document.getElementById('picList');
	var firstImgEl = null;
	entries.forEach(function (entry, i) {
		var img = createPageImg(sessionId, entry);
		if (i === 0) firstImgEl = img;
		picList.appendChild(img);
	});
	loadedChapters.push({ titleNode: node, sessionId: sessionId, pageCount: entries.length, firstImgEl: firstImgEl });
	refreshGeometryCache();
	if (opts.isManualOpen) {
		firstImgEl.addEventListener('load', function () {
			origWidth = firstImgEl.naturalWidth;
			setScale();
			document.getElementById('page').scrollTop = node.dataset.vpos;
			updateProgress();
		}, { once: true });
	}
	else {
		setScale();
	}
	return firstImgEl;
}

// mirrors appendChapterImages for auto-continuing to the PREVIOUS chapter
// when the reader scrolls up past the top of the currently loaded strip:
// inserts pages before the current first page instead of after the last.
// Unlike evictOldestChapterIfNeeded below, this can't lean on Chromium's
// scroll anchoring alone: anchoring only compensates scrollTop for changes
// above an existing in-viewport anchor node, and empirically does not
// engage at all when scrollTop is already at/near 0 (the browser instead
// treats "pinned to the very top" as a state to keep, the same way it keeps
// "pinned to the bottom" for chat-style feeds) - exactly the position this
// trigger always fires from. So each new page's own 'load' handler nudges
// scrollTop by exactly that page's rendered height once it appears (each
// page contributes an independent, isolated height jump from 0 to its
// natural size, so summing these compensates for the whole chapter
// regardless of load order), keeping the reader's view pinned to the same
// content instead of jumping onto the newly prepended pages.
function prependChapterImages(node, sessionId, entries) {
	var page = document.getElementById('page');
	var picList = document.getElementById('picList');
	var referenceEl = loadedChapters.length ? loadedChapters[0].firstImgEl : null;
	var firstImgEl = null;
	entries.forEach(function (entry, i) {
		var img = createPageImg(sessionId, entry);
		img.addEventListener('load', function () {
			// this scrollTop write's resulting 'scroll' event isn't
			// necessarily dispatched synchronously, so the
			// isCompensatingScroll guard has to stay up past this task -
			// see the flag's own comment for why re-entering the normal
			// handler here is actively harmful, not just redundant. Refresh
			// geometryCache and progress/minimap explicitly since that
			// normal handling is being skipped.
			isCompensatingScroll = true;
			page.scrollTop += img.getBoundingClientRect().height;
			refreshGeometryCache();
			updateProgress();
			requestAnimationFrame(function () { isCompensatingScroll = false; });
		});
		if (i === 0) firstImgEl = img;
		picList.insertBefore(img, referenceEl);
	});
	loadedChapters.unshift({ titleNode: node, sessionId: sessionId, pageCount: entries.length, firstImgEl: firstImgEl });
	activeChapterPos += 1; // the chapter the reader was viewing just shifted from index 0 to index 1
	refreshGeometryCache();
	setScale();
}

// pixel offset of an element within #page's scrollable content, independent
// of margins/positioning quirks (unlike offsetTop, which needs a positioned
// ancestor to mean the same thing)
function getOffsetWithinPage(el) {
	var page = document.getElementById('page');
	return el.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop;
}

// recomputes geometryCache. Call this whenever content shape actually
// changes (chapter append/evict, picList resize as images load in or zoom
// changes) — never from the scroll/rAF hot path itself.
function refreshGeometryCache() {
	var page = document.getElementById('page');
	geometryCache.clientHeight = page.clientHeight;
	geometryCache.scrollHeight = page.scrollHeight;
	geometryCache.chapterTops = loadedChapters.map(function (c) { return getOffsetWithinPage(c.firstImgEl); });
}

// the [top, top+height) span that chapter `pos` occupies within the merged
// strip, so progress/minimap/scrubbing can be scoped to just that chapter
function chapterBounds(pos) {
	var top = geometryCache.chapterTops[pos];
	var bottom = (pos + 1 < geometryCache.chapterTops.length) ? geometryCache.chapterTops[pos + 1] : geometryCache.scrollHeight;
	return { top: top, height: bottom - top };
}

function getCurrentVpos() {
	var page = document.getElementById('page');
	if (!loadedChapters.length) return page.scrollTop;
	return Math.max(0, page.scrollTop - chapterBounds(activeChapterPos).top);
}

function computeActiveChapterPos() {
	var page = document.getElementById('page');
	for (var i = geometryCache.chapterTops.length - 1; i >= 0; i--) {
		if (geometryCache.chapterTops[i] <= page.scrollTop + 1) return i;
	}
	return 0;
}

// syncs currentSessionId/currentPageCount (and therefore the minimap) to
// whichever chapter the reader is actually scrolled into
function refreshActiveChapterDisplay() {
	var chapter = loadedChapters[activeChapterPos];
	if (!chapter) return;
	currentSessionId = chapter.sessionId;
	currentPageCount = chapter.pageCount;
	buildMinimap();
	scaleMinimapStrip();
	updateMinimapViewport();
}

// called whenever scrolling carries the reader across a chapter boundary
// inside the merged strip: hands off "active chapter" bookkeeping (history,
// read-marking, sidebar highlight, minimap) from the outgoing chapter to
// the incoming one
function setActiveChapterPos(pos) {
	if (pos === activeChapterPos || !loadedChapters[pos]) return;
	var oldChapter = loadedChapters[activeChapterPos];
	if (oldChapter && oldChapter.titleNode) {
		oldChapter.titleNode.dataset.vpos = getCurrentVpos();
		oldChapter.titleNode.classList.remove('active');
	}
	activeChapterPos = pos;
	var chapter = loadedChapters[pos];
	curr = chapter.titleNode;
	curr.classList.add('active', 'read');
	showMsg(basename(curr.dataset.url));
	updateHistory(curr.dataset.url);
	patchReadMap(config.path, curr.dataset.url);
	refreshActiveChapterDisplay();
	evictOldestChapterIfNeeded();
	evictNewestChapterIfNeeded();
}

function hasMoreChapterToContinue() {
	if (!config.autoContinueChapter || !loadedChapters.length) return false;
	if (pendingChapterLoad) return true;
	var last = loadedChapters[loadedChapters.length - 1];
	var nextNode = (config.sort === 'nameu') ? last.titleNode.nextSibling : last.titleNode.previousSibling;
	return !!nextNode;
}

function maybeAutoContinueChapter() {
	if (!config.autoContinueChapter || config.viewMode !== 'strip' || pendingChapterLoad || !loadedChapters.length) return;
	var page = document.getElementById('page');
	var nearBottom = page.scrollTop >= geometryCache.scrollHeight - geometryCache.clientHeight - 200;
	if (!nearBottom) return;
	var last = loadedChapters[loadedChapters.length - 1];
	var nextNode = (config.sort === 'nameu') ? last.titleNode.nextSibling : last.titleNode.previousSibling;
	if (!nextNode) return;
	appendNextChapter(nextNode);
}

async function appendNextChapter(node) {
	pendingChapterLoad = true;
	var res = await window.api.openArchive(node.dataset.url);
	if (res.error) {
		pendingChapterLoad = false;
		return;
	}
	appendChapterImages(node, res.sessionId, res.entries, {});
	evictOldestChapterIfNeeded();
	pendingChapterLoad = false;
}

// Being "near the top" isn't on its own a reliable signal that the reader
// wants the previous chapter: evictOldestChapterIfNeeded's compensation
// (deliberately) leaves the reader exactly at the top of whatever chapter
// they just forward-continued into, which reads identically. Debouncing
// distinguishes the two: a reader still actually reading backward stays
// near the top for a beat, while a reader who just crossed forward keeps
// moving away from it on their very next scroll tick, well within this
// window - confirmed empirically, since without this debounce a forward
// crossing would immediately re-fetch and re-prepend the chapter that was
// just evicted, thrashing between the two chapters instead of settling.
function maybeAutoContinuePreviousChapter() {
	if (!config.autoContinueChapter || config.viewMode !== 'strip' || pendingChapterLoad || !loadedChapters.length) return;
	var page = document.getElementById('page');
	var nearTop = page.scrollTop <= 200;
	if (!nearTop) {
		if (previousContinueDebounceTimer) {
			clearTimeout(previousContinueDebounceTimer);
			previousContinueDebounceTimer = null;
		}
		return;
	}
	if (previousContinueDebounceTimer) return; // already waiting to confirm this is sustained
	previousContinueDebounceTimer = setTimeout(function () {
		previousContinueDebounceTimer = null;
		if (pendingChapterLoad || !loadedChapters.length || document.getElementById('page').scrollTop > 200) return;
		var first = loadedChapters[0];
		var prevNode = (config.sort === 'nameu') ? first.titleNode.previousSibling : first.titleNode.nextSibling;
		if (!prevNode) return;
		prependPreviousChapter(prevNode);
	}, 250);
}

async function prependPreviousChapter(node) {
	pendingChapterLoad = true;
	var res = await window.api.openArchive(node.dataset.url);
	if (res.error) {
		pendingChapterLoad = false;
		return;
	}
	prependChapterImages(node, res.sessionId, res.entries);
	evictNewestChapterIfNeeded();
	pendingChapterLoad = false;
}

// keeps at most 2 chapters' worth of pages in the DOM: once a 3rd chapter
// gets appended, drop the oldest one's images. This used to rely on
// Chromium's scroll anchoring to keep the view stable, on the assumption
// that it already compensates scrollTop for content removed above the
// viewport - true in principle, but the browser also enforces
// scrollTop <= scrollHeight-clientHeight at all times, and removing a large
// chapter (tens of full-height pages) can shrink the document below the
// reader's pre-removal scrollTop mid-loop, auto-clamping it *before* any
// compensation runs. Computing a delta off that already-clamped value and
// subtracting it again double-compensates, driving scrollTop to 0 - exactly
// the large visible jump this was reported as. So this captures the
// reader's real scrollTop *before* touching the DOM at all, and sets the
// compensated value explicitly off that captured number rather than
// adjusting whatever scrollTop happens to read afterward.
//
// The guard against evicting a still-being-viewed chapter also checks
// *live* geometry (a fresh, forced getBoundingClientRect() read via
// getOffsetWithinPage) rather than trusting activeChapterPos: that field is
// derived from geometryCache, which is deliberately not kept
// frame-perfectly fresh during scrolling (see its own comment) to avoid
// forcing a reflow on every scroll event, so during fast scrolling a
// still-loading chapter can make it briefly flip activeChapterPos to the
// next chapter before the reader has truly scrolled past it.
function evictOldestChapterIfNeeded() {
	if (loadedChapters.length <= 2) return;
	var page = document.getElementById('page');
	var oldest = loadedChapters[0];
	var newFirst = loadedChapters[1].firstImgEl;
	var topBefore = getOffsetWithinPage(newFirst);
	var scrollTopBeforeRemoval = page.scrollTop;
	if (scrollTopBeforeRemoval < topBefore) return; // reader hasn't actually reached the next chapter yet
	loadedChapters.shift();
	var el = oldest.firstImgEl;
	while (el && el !== newFirst) {
		var toRemove = el;
		el = el.nextSibling;
		toRemove.remove();
	}
	var topAfter = getOffsetWithinPage(newFirst);
	isCompensatingScroll = true;
	page.scrollTop = scrollTopBeforeRemoval - (topBefore - topAfter);
	requestAnimationFrame(function () { isCompensatingScroll = false; });
	activeChapterPos = Math.max(0, activeChapterPos - 1);
	refreshGeometryCache();
}

// mirrors evictOldestChapterIfNeeded for the backward-continue direction:
// once a 3rd chapter loads in from prepending, drop the newest (bottom-most,
// forward-most) one once the reader isn't actually viewing it (checked
// against live geometry for the same staleness reason as above). Since it's
// the last chapter in DOM order, its own pages already run to the end of
// #picList and it sits entirely below the viewport at this point, so
// removing it needs no scrollTop compensation the way the front-end
// eviction above does.
function evictNewestChapterIfNeeded() {
	if (loadedChapters.length <= 2) return;
	var page = document.getElementById('page');
	var newest = loadedChapters[loadedChapters.length - 1];
	var newestTop = getOffsetWithinPage(newest.firstImgEl);
	if (page.scrollTop >= newestTop) return; // reader has actually scrolled into this chapter
	loadedChapters.pop();
	var el = newest.firstImgEl;
	while (el) {
		var toRemove = el;
		el = el.nextSibling;
		toRemove.remove();
	}
	refreshGeometryCache();
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

// dir is -1 (up) or +1 (down). mode is 'pixel' or 'percent'; 'percent' is a
// percentage of the active chapter's own length (falling back to the whole
// merged strip before any chapter has loaded), not the viewport - so the
// same percentage always covers the same fraction of "this chapter"
// regardless of window size.
function scrollByConfiguredAmount(dir, mode, pixels, percent) {
	var page = document.getElementById('page');
	var amount;
	if (mode === 'percent') {
		var chapterHeight = loadedChapters.length ? chapterBounds(activeChapterPos).height : geometryCache.scrollHeight;
		amount = chapterHeight * (percent / 100) * dir;
	}
	else {
		amount = pixels * dir;
	}
	page.scrollTo({ top: page.scrollTop + amount, behavior: 'smooth' });
}

function pageScroll(dir) {
	scrollByConfiguredAmount(dir, config.pageScrollMode, config.pageScrollPixels, config.pageScrollPercent);
}

function arrowScroll(dir) {
	scrollByConfiguredAmount(dir, config.arrowScrollMode, config.arrowScrollPixels, config.arrowScrollPercent);
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
	var picList = document.getElementById('picList');
	if (config.zoomMode === 'fit') {
		var containerWidth = clampToMaxContentWidth(Math.floor(document.getElementById('page').clientWidth) - 4);
		document.querySelectorAll('.simg').forEach(function (el) { el.style.width = containerWidth + 'px'; });
		picList.style.width = containerWidth + 'px';
		updateZoomPercentDisplay();
		recheckVisibleUpscaleCandidates();
		return;
	}
	scale = (scale === undefined) ? 100 : scale;
	var w = clampToMaxContentWidth(Math.floor(origWidth * scale / 100));
	document.querySelectorAll('.simg').forEach(function (el) { el.style.width = w + 'px'; });
	picList.style.width = w + 'px';
	updateZoomPercentDisplay();
	recheckVisibleUpscaleCandidates();
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
	// clamp the tracked position to the currently known max instead of
	// letting it run past it: if a next chapter is still loading in, this
	// parks the scroll at the bottom without overshooting, then resumes
	// smoothly (no jump) once the new content extends scrollHeight.
	// Uses the cached geometry rather than live scrollHeight/clientHeight
	// reads, since those force a synchronous layout reflow on every single
	// call — doing that on every animation frame is what caused the jitter.
	var max = Math.max(0, geometryCache.scrollHeight - geometryCache.clientHeight);
	autoScrollPosition = Math.min(autoScrollPosition, max);
	page.scrollTop = autoScrollPosition;
	if (autoScrollPosition >= max - 2 && !hasMoreChapterToContinue()) {
		stopAutoScroll();
		return;
	}
	autoScrollRAF = requestAnimationFrame(autoScrollStep);
}

// reading progress -----------------------------------------------------------------------

// progress/minimap are scoped to whichever chapter the reader is currently
// scrolled into, not the whole merged strip, so "50%"/the minimap viewport
// always describe position within a single chapter even when the next one
// has already been bridged in underneath it
function updateProgress() {
	var page = document.getElementById('page');
	if (loadedChapters.length) {
		var newActive = computeActiveChapterPos();
		if (newActive !== activeChapterPos) setActiveChapterPos(newActive);
	}
	var bounds = loadedChapters.length ? chapterBounds(activeChapterPos) : null;
	var localTop = bounds ? Math.max(0, page.scrollTop - bounds.top) : page.scrollTop;
	var localMax = bounds ? (bounds.height - geometryCache.clientHeight) : (page.scrollHeight - page.clientHeight);
	var pct = localMax > 0 ? Math.round((localTop / localMax) * 100) : 100;
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
	var bounds = loadedChapters.length ? chapterBounds(activeChapterPos) : { top: 0, height: page.scrollHeight };
	if (!bounds.height || !minimapEl.clientHeight) return;
	var ratio = minimapEl.clientHeight / bounds.height;
	var localTop = Math.max(0, page.scrollTop - bounds.top);
	var top = localTop * ratio;
	var height = geometryCache.clientHeight * ratio;
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

// AI upscale --------------------------------------------------------------------------

// upscaling is genuinely useful once a page is stretched well past its own
// resolution (that's exactly when it starts looking soft/blocky); below
// that ratio the original is already sharp enough and enhancing would just
// burn CPU/GPU for no visible gain
var UPSCALE_TRIGGER_RATIO = 1.5;
var upscalerAvailable = false;
var upscaleRequested = new Set(); // sessionId/index keys already requested, so re-entering the viewport doesn't re-request
var upscaleVisible = new Set(); // images currently intersecting the viewport, rechecked on zoom change too

function upscaleKeyFor(img) {
	return img.dataset.sessionId + '/' + img.dataset.pageIndex;
}

function maybeUpscale(img) {
	if (!config.aiUpscaleEnabled || !upscalerAvailable) return;
	if (!img.naturalWidth) return; // hasn't loaded yet; its own 'load' handler below will recheck
	var displayedWidth = img.getBoundingClientRect().width;
	if (displayedWidth < img.naturalWidth * UPSCALE_TRIGGER_RATIO) return;
	var key = upscaleKeyFor(img);
	if (upscaleRequested.has(key)) return;
	upscaleRequested.add(key);
	window.api.requestUpscale({ sessionId: img.dataset.sessionId, index: Number(img.dataset.pageIndex) }).then(function (res) {
		if (res && res.success) {
			img.src = 'comic://' + img.dataset.sessionId + '/' + img.dataset.pageIndex + '/upscaled';
		}
		else {
			upscaleRequested.delete(key); // transient failure (e.g. busy queue timeout) - allow retrying later
		}
	});
}

function recheckVisibleUpscaleCandidates() {
	upscaleVisible.forEach(maybeUpscale);
}

// reflects binary availability in the preferences panel: the checkbox is
// disabled (with an explanatory note) rather than silently unresponsive
// when this build has no bundled waifu2x binary for the current platform
function applyUpscaleAvailability() {
	var checkbox = document.getElementById('prefAiUpscaleEnabled');
	var note = document.getElementById('aiUpscaleNote');
	checkbox.disabled = !upscalerAvailable;
	if (!upscalerAvailable) {
		note.textContent = '此版本未內建本地 AI 增強元件，暫無法使用此功能。';
		note.classList.remove('warn');
	}
	else {
		note.textContent = '使用本地 AI（waifu2x）於捲動時在背景自動加強放大檢視的低解析度頁面，並快取結果。處理過程會使用較多 CPU／GPU 資源，若裝置效能較弱，可能感覺到些微延遲或風扇聲增大。';
		note.classList.add('warn');
	}
}

var upscaleObserver = new IntersectionObserver(function (entries) {
	entries.forEach(function (entry) {
		if (entry.isIntersecting) upscaleVisible.add(entry.target);
		else upscaleVisible.delete(entry.target);
	});
	recheckVisibleUpscaleCandidates();
}, { root: document.getElementById('page'), rootMargin: '200px 0px' });

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
	document.getElementById('prefAutoContinueChapter').checked = !!config.autoContinueChapter;
	document.getElementById('prefShowMinimap').checked = !!config.showMinimap;
	document.getElementById('prefShowProgress').checked = !!config.showProgress;
	document.getElementById('prefAiUpscaleEnabled').checked = !!config.aiUpscaleEnabled;
	applyUpscaleAvailability();
	var arrowModeRadio = document.querySelector('input[name="arrowScrollMode"][value="' + config.arrowScrollMode + '"]');
	if (arrowModeRadio) arrowModeRadio.checked = true;
	document.getElementById('prefArrowScrollPixels').value = config.arrowScrollPixels;
	document.getElementById('prefArrowScrollPercent').value = config.arrowScrollPercent;
	var pageModeRadio = document.querySelector('input[name="pageScrollMode"][value="' + config.pageScrollMode + '"]');
	if (pageModeRadio) pageModeRadio.checked = true;
	document.getElementById('prefPageScrollPixels').value = config.pageScrollPixels;
	document.getElementById('prefPageScrollPercent').value = config.pageScrollPercent;
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
		scrollDown: function () { arrowScroll(1); }, scrollUp: function () { arrowScroll(-1); },
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
	var bounds = loadedChapters.length ? chapterBounds(activeChapterPos) : { top: 0, height: page.scrollHeight };
	page.scrollTop = bounds.top + fraction * Math.max(0, bounds.height - page.clientHeight);
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
	document.getElementById('prefAutoContinueChapter').addEventListener('change', function () {
		patchConfig({ autoContinueChapter: this.checked });
	});
	document.getElementById('prefShowMinimap').addEventListener('change', function () {
		patchConfig({ showMinimap: this.checked });
		applyMinimapVisibility();
	});
	document.getElementById('prefShowProgress').addEventListener('change', function () {
		patchConfig({ showProgress: this.checked });
		applyProgressVisibility();
	});
	document.getElementById('prefAiUpscaleEnabled').addEventListener('change', function () {
		patchConfig({ aiUpscaleEnabled: this.checked });
		if (this.checked) recheckVisibleUpscaleCandidates();
	});
	document.querySelectorAll('input[name="arrowScrollMode"]').forEach(function (el) {
		el.addEventListener('change', function () { patchConfig({ arrowScrollMode: this.value }); });
	});
	document.getElementById('prefArrowScrollPixels').addEventListener('change', function () {
		var v = parseInt(this.value, 10);
		if (!isFinite(v) || v < 1) v = 1;
		this.value = v;
		patchConfig({ arrowScrollPixels: v });
	});
	document.getElementById('prefArrowScrollPercent').addEventListener('change', function () {
		var v = parseInt(this.value, 10);
		if (!isFinite(v) || v < 1) v = 1;
		if (v > 100) v = 100;
		this.value = v;
		patchConfig({ arrowScrollPercent: v });
	});
	document.querySelectorAll('input[name="pageScrollMode"]').forEach(function (el) {
		el.addEventListener('change', function () { patchConfig({ pageScrollMode: this.value }); });
	});
	document.getElementById('prefPageScrollPixels').addEventListener('change', function () {
		var v = parseInt(this.value, 10);
		if (!isFinite(v) || v < 1) v = 1;
		this.value = v;
		patchConfig({ pageScrollPixels: v });
	});
	document.getElementById('prefPageScrollPercent').addEventListener('change', function () {
		var v = parseInt(this.value, 10);
		if (!isFinite(v) || v < 1) v = 1;
		if (v > 100) v = 100;
		this.value = v;
		patchConfig({ pageScrollPercent: v });
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

	window.api.isUpscalerAvailable().then(function (available) {
		upscalerAvailable = available;
		applyUpscaleAvailability();
	});

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
			patchHistory(config.path, { file: curr.dataset.url, vpos: getCurrentVpos() })
				.then(function () { window.api.readyToClose(); });
		}
		else {
			window.api.readyToClose();
		}
	});
}

// script is loaded at the end of <body>, after all markup above, so the DOM
// is already parsed and every element referenced here already exists
document.getElementById('page').addEventListener('scroll', function () {
	if (isCompensatingScroll) return;
	updateProgress();
	// only checked on genuine scroll (user or auto-scroll), never from the
	// ResizeObserver-driven recomputes below: while a chapter's images are
	// still loading in, scrollHeight can transiently be no taller than the
	// viewport, which would otherwise look like a false "already at the
	// bottom" before the reader has scrolled at all
	maybeAutoContinueChapter();
	maybeAutoContinuePreviousChapter();
});

// scrollHeight keeps growing as each subsequent strip image finishes
// loading (only the first page of each chapter fires a 'load' we listen
// to), so a one-shot recompute goes stale; watch the actual content size
// instead.
var picListResizeObserver = new ResizeObserver(function () { refreshGeometryCache(); updateProgress(); });
picListResizeObserver.observe(document.getElementById('picList'));
// #page's own box (not just picList's content) can change independently on
// window resize, which geometryCache.clientHeight needs to track too
picListResizeObserver.observe(document.getElementById('page'));

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
