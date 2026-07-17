const { app, BrowserWindow, ipcMain, dialog, protocol, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { buffer: streamToBuffer } = require('node:stream/consumers');
const yauzl = require('yauzl');
const unrar = require('node-unrar-js');
const UTIF = require('utif2');

const { TIFF_EXT, IMAGE_EXT, ARCHIVE_EXT, IMAGE_RE, MIME_TYPES } = require('./lib/file-types');
const { declaredSize, checkArchiveBudget, checkEntryRatios, selectImageEntries } = require('./lib/archive-utils');
const { mergeConfig } = require('./lib/config-merge');
const { classifyDirEntries } = require('./lib/folder-classify');
const { isUpscalerAvailable, upscaleImage } = require('./lib/upscaler');

const DEFAULT_KEYBINDINGS = {
	prev: 'left',
	next: 'right',
	top: 'home',
	zoomOut: '-',
	zoomIn: 'plus',
	zoomReset: '=',
	help: 'f1',
	openFolder: 'mod+o',
	darkMode: 'mod+d',
	gridView: 'mod+g',
	fullscreen: 'f11',
	preferences: 'mod+,',
	pageDown: 'pagedown',
	pageUp: 'pageup',
	scrollDown: 'down',
	scrollUp: 'up',
	autoScroll: 'space',
	toggleSidebarHidden: 'mod+b',
};

// history/readMap are keyed by folder path and grow by one entry per folder
// ever visited; cap them so years of use can't bloat config.json forever
const MAX_HISTORY_ENTRIES = 300;

const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');
// history is keyed by folder path -> { file, vpos }, so it composes safely
// across concurrently running instances browsing different folders.
// readMap is keyed by folder path -> { [filePath]: true }, same reasoning.
const DEFAULT_CONFIG = {
	path: '',
	startupMode: 'lastUsed',
	startupFolder: '',
	sort: 'nameu',
	history: {},
	readMap: {},
	recent: [],
	darkMode: false,
	darkShade: 'black',
	viewMode: 'strip',
	gridViewEnabled: false,
	zoomStep: 5,
	zoomMode: 'manual',
	autoScrollSpeed: 40,
	maxContentWidth: 0,
	showMinimap: false,
	showProgress: true,
	autoContinueChapter: false,
	aiUpscaleEnabled: false,
	arrowScrollMode: 'pixel',
	arrowScrollPixels: 100,
	arrowScrollPercent: 5,
	pageScrollMode: 'pixel',
	pageScrollPixels: 800,
	pageScrollPercent: 20,
	keybindings: { ...DEFAULT_KEYBINDINGS },
	showSidebarToolbar: true,
	showFloatingNav: true,
	accentColor: '#53c4c6',
	sidebarCollapsed: true,
	sidebarHidden: false,
	sidebarPosition: 'left',
};

let config = { ...DEFAULT_CONFIG };
let win;
let allowClose = false;

const MAX_CACHED_ARCHIVES = 4;
let archiveCounter = 0;
const archiveCache = new Map();

protocol.registerSchemesAsPrivileged([
	{ scheme: 'comic', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

// Support "open with ScrollViewer2" / double-clicking a comic file or
// folder: a path passed as a launch argument (Windows/Linux) or via
// macOS's open-file event (which can fire before or after the window
// exists) gets picked up and opened automatically.
let pendingLaunchPath = null;

function isExistingPath(p) {
	try {
		return typeof p === 'string' && p.length > 0 && fs.existsSync(p);
	} catch (err) {
		return false;
	}
}

function getArgvLaunchPath(argv) {
	const args = app.isPackaged ? argv.slice(1) : argv.slice(2);
	for (const arg of args) {
		if (arg.startsWith('-')) continue;
		if (isExistingPath(arg)) return path.resolve(arg);
	}
	return null;
}

pendingLaunchPath = getArgvLaunchPath(process.argv);

app.on('open-file', (event, filePath) => {
	event.preventDefault();
	if (win && !win.isDestroyed()) {
		win.webContents.send('open-path-request', filePath);
	}
	else {
		pendingLaunchPath = filePath;
	}
});

// Multiple instances of the app can run at once and share the same config
// file. Reading it fresh right before every merge means one instance's
// change (e.g. dark mode) survives another instance's unrelated change
// (e.g. zoom step) instead of being blindly clobbered by a stale snapshot.
function readConfigFromDisk() {
	try {
		const data = fs.readFileSync(CONFIG_PATH(), 'utf-8');
		const loaded = JSON.parse(data);
		return {
			...DEFAULT_CONFIG,
			...loaded,
			keybindings: { ...DEFAULT_KEYBINDINGS, ...(loaded.keybindings || {}) },
			history: { ...(loaded.history || {}) },
			readMap: { ...(loaded.readMap || {}) },
		};
	} catch (err) {
		return { ...DEFAULT_CONFIG };
	}
}

// Renaming the app (package.json "name") changes Electron's userData
// directory, since it's derived from app.name. Without this, everyone's
// existing preferences/history would silently reset to defaults the first
// time they run the renamed build.
function migrateOldUserData() {
	try {
		const newPath = CONFIG_PATH();
		if (fs.existsSync(newPath)) return;
		const oldPath = path.join(path.dirname(path.dirname(newPath)), 'scrollviewer', 'config.json');
		if (fs.existsSync(oldPath)) {
			fs.mkdirSync(path.dirname(newPath), { recursive: true });
			fs.copyFileSync(oldPath, newPath);
		}
	} catch (err) {
		// best effort; falling back to a fresh config is acceptable
	}
}

function loadConfig() {
	migrateOldUserData();
	config = readConfigFromDisk();
}

function saveConfig() {
	return fs.promises.writeFile(CONFIG_PATH(), JSON.stringify(config, null, 2));
}

// config:set/reset-keybindings each read-modify-write the same file. Without
// serializing them, two calls fired close together (e.g. toggling several
// preferences quickly) race: both open+truncate the file, then both write
// their own full buffer, and whichever write is shorter leaves the longer
// write's tail bytes behind, corrupting the JSON. Every future launch then
// fails to parse it and silently falls back to defaults, losing not just
// the just-changed preference but all preferences and reading history.
// Chaining every mutation onto the same promise keeps them fully sequential.
let configWriteQueue = Promise.resolve();

function queueConfigMutation(mutate) {
	configWriteQueue = configWriteQueue.catch(() => {}).then(async () => {
		const onDisk = readConfigFromDisk();
		config = mutate(onDisk);
		await saveConfig();
		return config;
	});
	return configWriteQueue;
}

function toArrayBuffer(buffer) {
	return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

// ---- minimal PNG encoder, used to transcode decoded TIFF pixels for display ----

function crc32(buf) {
	const table = crc32.table || (crc32.table = (() => {
		const t = [];
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
			t[n] = c;
		}
		return t;
	})());
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
	const typeBuf = Buffer.from(type, 'ascii');
	const lenBuf = Buffer.alloc(4);
	lenBuf.writeUInt32BE(data.length, 0);
	const crcBuf = Buffer.alloc(4);
	crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
	return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePngRGBA(width, height, rgba) {
	const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // color type RGBA
	const rowSize = 1 + width * 4;
	const raw = Buffer.alloc(rowSize * height);
	for (let y = 0; y < height; y++) {
		raw[y * rowSize] = 0;
		rgba.copy(raw, y * rowSize + 1, y * width * 4, (y + 1) * width * 4);
	}
	const idat = zlib.deflateSync(raw);
	return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

function tiffToPng(buffer) {
	const ifds = UTIF.decode(buffer);
	UTIF.decodeImage(buffer, ifds[0]);
	const rgba = Buffer.from(UTIF.toRGBA8(ifds[0]));
	return encodePngRGBA(ifds[0].width, ifds[0].height, rgba);
}

// browsers can't render TIFF natively, so transcode it to PNG on the way out
function toDisplayItem(name, buffer) {
	const ext = path.extname(name).toLowerCase();
	if (TIFF_EXT.includes(ext)) {
		try {
			return { name, buffer: tiffToPng(buffer), mime: 'image/png' };
		} catch (err) {
			return { name, buffer, mime: 'application/octet-stream' };
		}
	}
	return { name, buffer, mime: MIME_TYPES[ext] || 'application/octet-stream' };
}

// guards against zip/rar bombs: a small archive file that expands to an
// enormous amount of data. The total-decompressed-size and per-entry
// compression-ratio checks below are what actually correlate with resource
// cost; maxEntries is deliberately generous - a legitimate large chapter can
// have thousands of image entries and pose no risk, so it exists only as a
// sanity net against an archive with an absurd number of near-empty entries,
// where merely enumerating the central directory/header list would itself
// become slow.
const MAX_ARCHIVE_FILE_SIZE = 500 * 1024 * 1024; // 500MB on disk
const ARCHIVE_BUDGET = {
	maxEntries: 20000,
	maxTotalSize: 1024 * 1024 * 1024, // 1GB decompressed
	maxRatio: 100, // compressed:uncompressed ratio beyond which a single entry is treated as a bomb
};

// ---- reading pages: from a zip/cbz, a rar/cbr, or a plain directory of loose images ----

async function extractZip(data) {
	const zipfile = await yauzl.fromBufferPromise(data, { validateEntrySizes: true });
	try {
		const entries = [];
		for await (const entry of zipfile.eachEntry()) {
			entries.push(entry);
		}
		const files = selectImageEntries(entries, { isDir: (e) => e.fileName.endsWith('/'), nameOf: (e) => e.fileName });
		// central-directory metadata already gives compressed/uncompressed sizes
		// without having to decompress, so bombs can be rejected before doing
		// real work
		checkEntryRatios(files, { compressedSizeOf: (e) => e.compressedSize, uncompressedSizeOf: (e) => e.uncompressedSize, nameOf: (e) => e.fileName }, ARCHIVE_BUDGET.maxRatio);
		const totalSize = files.reduce((sum, e) => sum + declaredSize(e.uncompressedSize), 0);
		checkArchiveBudget(files.length, totalSize, ARCHIVE_BUDGET);
		const items = [];
		for (const entry of files) {
			const stream = await zipfile.openReadStreamPromise(entry);
			items.push(toDisplayItem(entry.fileName, await streamToBuffer(stream)));
		}
		return items;
	} finally {
		zipfile.close();
	}
}

async function extractRar(data) {
	const extractor = await unrar.createExtractorFromData({ data: toArrayBuffer(data) });
	const headers = selectImageEntries([...extractor.getFileList().fileHeaders], {
		isDir: (h) => h.flags.directory,
		nameOf: (h) => h.name,
	});
	checkEntryRatios(headers, { compressedSizeOf: (h) => h.packSize, uncompressedSizeOf: (h) => h.unpSize, nameOf: (h) => h.name }, ARCHIVE_BUDGET.maxRatio);
	const totalSize = headers.reduce((sum, h) => sum + declaredSize(h.unpSize), 0);
	checkArchiveBudget(headers.length, totalSize, ARCHIVE_BUDGET);
	const names = headers.map((h) => h.name);
	const extracted = extractor.extract({ files: names });
	const byName = new Map();
	for (const f of extracted.files) {
		byName.set(f.fileHeader.name, f.extraction);
	}
	return names.map((name) => toDisplayItem(name, Buffer.from(byName.get(name))));
}

async function readDirImages(dirPath) {
	const names = await fs.promises.readdir(dirPath);
	const imageNames = names
		.filter((n) => IMAGE_RE.test(n))
		.sort((a, b) => a.localeCompare(b));
	const items = [];
	for (const name of imageNames) {
		const buffer = await fs.promises.readFile(path.join(dirPath, name));
		items.push(toDisplayItem(name, buffer));
	}
	return items;
}

function createWindow() {
	win = new BrowserWindow({
		width: 900,
		height: 950,
		title: 'ScrollViewer2',
		icon: path.join(__dirname, '..', '..', 'img', 'icon.png'),
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});

	win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

	win.on('enter-full-screen', () => win.webContents.send('fullscreen-changed', true));
	win.on('leave-full-screen', () => win.webContents.send('fullscreen-changed', false));

	win.on('close', (e) => {
		if (allowClose) return;
		e.preventDefault();
		win.webContents.send('app:before-close');
	});

	// the app menu is intentionally minimal (see buildAppMenu), so DevTools
	// needs its own way in for troubleshooting
	win.webContents.on('before-input-event', (event, input) => {
		if (input.type === 'keyDown' && input.key === 'F12') {
			win.webContents.toggleDevTools();
		}
	});
}

// Electron's default menu (Reload/Force Reload/Toggle DevTools/View/Window...)
// is developer-facing clutter for a shipped app, so drop it entirely. Note
// this also drops native Cut/Copy/Paste menu roles, which macOS otherwise
// relies on to make those shortcuts work in text inputs.
function buildAppMenu() {
	// no menu bar at all on Windows/Linux; macOS still needs its app menu
	// (the one with the app name, Quit, etc.) since the OS always shows one
	const isMac = process.platform === 'darwin';
	const template = isMac ? [{ role: 'appMenu' }] : [];
	return Menu.buildFromTemplate(template);
}

ipcMain.on('app:ready-to-close', () => {
	allowClose = true;
	win.close();
});

ipcMain.handle('app:get-launch-path', () => {
	const p = pendingLaunchPath;
	pendingLaunchPath = null;
	return p;
});

ipcMain.handle('dialog:choose-folder', async () => {
	const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
	if (result.canceled || result.filePaths.length === 0) return null;
	return result.filePaths[0];
});

ipcMain.handle('fs:list-dir', async (event, dirPath) => {
	try {
		const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true });
		const items = [];

		for (const d of dirents) {
			const full = path.join(dirPath, d.name);
			if (d.isDirectory()) {
				let children;
				try {
					children = await fs.promises.readdir(full);
				} catch (err) {
					continue;
				}
				if (!children.some((n) => IMAGE_RE.test(n))) continue;
				const stat = await fs.promises.stat(full);
				items.push({ name: d.name, path: full, isDirectory: true, mtime: stat.mtime.toISOString() });
				continue;
			}
			const ext = path.extname(d.name).toLowerCase();
			if (!ARCHIVE_EXT.includes(ext) && !IMAGE_EXT.includes(ext)) continue;
			const stat = await fs.promises.stat(full);
			items.push({
				name: d.name,
				path: full,
				isDirectory: false,
				isArchive: ARCHIVE_EXT.includes(ext),
				isImage: IMAGE_EXT.includes(ext),
				mtime: stat.mtime.toISOString(),
			});
		}

		const entries = classifyDirEntries(dirPath, path.basename(dirPath), items);
		return { entries };
	} catch (err) {
		return { error: err.message };
	}
});

ipcMain.handle('fs:stat', async (event, p) => {
	try {
		const stat = await fs.promises.stat(p);
		return { isDirectory: stat.isDirectory() };
	} catch (err) {
		return { error: err.message };
	}
});

ipcMain.handle('archive:open', async (event, targetPath) => {
	try {
		const stat = await fs.promises.stat(targetPath);
		let items;
		if (stat.isDirectory()) {
			items = await readDirImages(targetPath);
		} else {
			if (stat.size > MAX_ARCHIVE_FILE_SIZE) {
				const mb = Math.round(stat.size / (1024 * 1024));
				return { error: `Archive file is too large (${mb}MB > ${MAX_ARCHIVE_FILE_SIZE / (1024 * 1024)}MB)` };
			}
			const ext = path.extname(targetPath).toLowerCase();
			const data = await fs.promises.readFile(targetPath);
			if (ext === '.zip' || ext === '.cbz') {
				items = await extractZip(data);
			} else if (ext === '.rar' || ext === '.cbr') {
				items = await extractRar(data);
			} else {
				return { error: 'Unsupported archive format: ' + ext };
			}
		}
		// prefixed with a letter so the WHATWG URL parser doesn't coerce a
		// purely-numeric host into IPv4 dotted notation (e.g. "1" -> "0.0.0.1")
		const sessionId = 's' + (++archiveCounter);
		archiveCache.set(sessionId, items);
		while (archiveCache.size > MAX_CACHED_ARCHIVES) {
			archiveCache.delete(archiveCache.keys().next().value);
		}
		return { sessionId, entries: items.map((it, index) => ({ index, name: it.name })) };
	} catch (err) {
		return { error: err.message };
	}
});

ipcMain.handle('config:get', () => config);
ipcMain.handle('config:set', (event, partial) => {
	return queueConfigMutation((onDisk) => mergeConfig(onDisk, partial, MAX_HISTORY_ENTRIES));
});
ipcMain.handle('config:reset-keybindings', () => {
	return queueConfigMutation((onDisk) => ({ ...onDisk, keybindings: { ...DEFAULT_KEYBINDINGS } }));
});

ipcMain.handle('app:get-version', () => app.getVersion());

// AI upscaling runs one page at a time: waifu2x-ncnn-vulkan is CPU/GPU
// heavy, and letting several requests race while the reader scrolls fast
// would thrash the machine instead of just taking a bit longer per page.
let upscaleQueue = Promise.resolve();

ipcMain.handle('upscale:available', () => isUpscalerAvailable(app.isPackaged, process.resourcesPath));

ipcMain.handle('upscale:request', (event, { sessionId, index }) => {
	const items = archiveCache.get(sessionId);
	const item = items && items[index];
	if (!item) return Promise.resolve({ error: 'page not found' });
	const job = upscaleQueue.then(async () => {
		const result = await upscaleImage(item.buffer, item.mime, {
			appIsPackaged: app.isPackaged,
			resourcesPath: process.resourcesPath,
			cacheDir: path.join(app.getPath('userData'), 'upscale-cache'),
		});
		item.upscaledBuffer = result;
		return { success: true };
	});
	upscaleQueue = job.catch(() => {});
	return job.catch((err) => ({ error: err.message }));
});

ipcMain.handle('window:toggle-fullscreen', () => {
	const next = !win.isFullScreen();
	win.setFullScreen(next);
	return next;
});

app.whenReady().then(() => {
	protocol.handle('comic', (request) => {
		const url = new URL(request.url);
		const sessionId = url.hostname;
		const parts = url.pathname.replace(/^\//, '').split('/');
		const index = Number(parts[0]);
		const wantUpscaled = parts[1] === 'upscaled';
		const items = archiveCache.get(sessionId);
		if (!items || !items[index]) {
			return new Response(null, { status: 404 });
		}
		const item = items[index];
		if (wantUpscaled) {
			if (!item.upscaledBuffer) return new Response(null, { status: 404 });
			return new Response(item.upscaledBuffer, { headers: { 'content-type': 'image/png' } });
		}
		return new Response(item.buffer, { headers: { 'content-type': item.mime } });
	});

	Menu.setApplicationMenu(buildAppMenu());
	loadConfig();
	createWindow();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
