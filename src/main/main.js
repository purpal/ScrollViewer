const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const JSZip = require('jszip');
const unrar = require('node-unrar-js');
const UTIF = require('utif2');

const TIFF_EXT = ['.tif', '.tiff'];
const IMAGE_EXT = ['.bmp', '.jpg', '.jpeg', '.png', '.gif', '.webp', ...TIFF_EXT];
const ARCHIVE_EXT = ['.zip', '.cbz', '.rar', '.cbr'];
const SUPPORTED_EXT = [...IMAGE_EXT, ...ARCHIVE_EXT];
const IMAGE_RE = /\.(bmp|jpe?g|png|gif|webp|tiff?)$/i;

const MIME_TYPES = {
	'.bmp': 'image/bmp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
};

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
};

const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');
const DEFAULT_CONFIG = {
	path: '',
	sort: 'nameu',
	vpos: 0,
	lastfile: '',
	history: {},
	recent: [],
	darkMode: false,
	viewMode: 'strip',
	zoomStep: 5,
	keybindings: { ...DEFAULT_KEYBINDINGS },
	showSidebarToolbar: true,
	showFloatingNav: true,
	accentColor: '#53c4c6',
	sidebarCollapsed: true,
};

let config = { ...DEFAULT_CONFIG };
let win;
let allowClose = false;

let archiveCounter = 0;
const archiveCache = new Map();

protocol.registerSchemesAsPrivileged([
	{ scheme: 'comic', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

function loadConfig() {
	try {
		const data = fs.readFileSync(CONFIG_PATH(), 'utf-8');
		const loaded = JSON.parse(data);
		config = {
			...DEFAULT_CONFIG,
			...loaded,
			keybindings: { ...DEFAULT_KEYBINDINGS, ...(loaded.keybindings || {}) },
		};
	} catch (err) {
		config = { ...DEFAULT_CONFIG };
	}
}

function saveConfig() {
	return fs.promises.writeFile(CONFIG_PATH(), JSON.stringify(config, null, 2));
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

// ---- reading pages: from a zip/cbz, a rar/cbr, or a plain directory of loose images ----

async function extractZip(data) {
	const zip = await JSZip.loadAsync(data);
	const files = Object.values(zip.files)
		.filter((f) => !f.dir && IMAGE_RE.test(f.name))
		.sort((a, b) => a.name.localeCompare(b.name));
	const items = [];
	for (const f of files) {
		items.push(toDisplayItem(f.name, await f.async('nodebuffer')));
	}
	return items;
}

async function extractRar(data) {
	const extractor = await unrar.createExtractorFromData({ data: toArrayBuffer(data) });
	const headers = [...extractor.getFileList().fileHeaders]
		.filter((h) => !h.flags.directory && IMAGE_RE.test(h.name))
		.sort((a, b) => a.name.localeCompare(b.name));
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
}

ipcMain.on('app:ready-to-close', () => {
	allowClose = true;
	win.close();
});

ipcMain.handle('dialog:choose-folder', async () => {
	const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
	if (result.canceled || result.filePaths.length === 0) return null;
	return result.filePaths[0];
});

ipcMain.handle('fs:list-dir', async (event, dirPath) => {
	try {
		const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true });
		const entries = [];
		const looseImages = [];

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
				entries.push({ name: d.name, path: full, type: 'directory', mtime: stat.mtime.toISOString() });
				continue;
			}
			const ext = path.extname(d.name).toLowerCase();
			if (ARCHIVE_EXT.includes(ext)) {
				const stat = await fs.promises.stat(full);
				entries.push({ name: d.name, path: full, type: 'archive', mtime: stat.mtime.toISOString() });
			} else if (IMAGE_EXT.includes(ext)) {
				looseImages.push({ name: d.name, path: full });
			}
		}

		if (looseImages.length > 0) {
			const stats = await Promise.all(looseImages.map((f) => fs.promises.stat(f.path)));
			const mtime = new Date(Math.max(...stats.map((s) => s.mtime.getTime()))).toISOString();
			const name = looseImages.length === 1 ? looseImages[0].name : path.basename(dirPath);
			entries.push({ name, path: dirPath, type: 'directory', mtime });
		}

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
		archiveCache.clear();
		// prefixed with a letter so the WHATWG URL parser doesn't coerce a
		// purely-numeric host into IPv4 dotted notation (e.g. "1" -> "0.0.0.1")
		const sessionId = 's' + (++archiveCounter);
		archiveCache.set(sessionId, items);
		return { sessionId, entries: items.map((it, index) => ({ index, name: it.name })) };
	} catch (err) {
		return { error: err.message };
	}
});

ipcMain.handle('config:get', () => config);
ipcMain.handle('config:set', async (event, partial) => {
	config = {
		...config,
		...partial,
		keybindings: { ...config.keybindings, ...(partial.keybindings || {}) },
	};
	await saveConfig();
	return config;
});
ipcMain.handle('config:reset-keybindings', async () => {
	config = { ...config, keybindings: { ...DEFAULT_KEYBINDINGS } };
	await saveConfig();
	return config;
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
		const index = Number(url.pathname.replace(/^\//, ''));
		const items = archiveCache.get(sessionId);
		if (!items || !items[index]) {
			return new Response(null, { status: 404 });
		}
		const item = items[index];
		return new Response(item.buffer, { headers: { 'content-type': item.mime } });
	});

	loadConfig();
	createWindow();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
