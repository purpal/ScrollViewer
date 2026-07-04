const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const unrar = require('node-unrar-js');

const IMAGE_EXT = ['.bmp', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
const ARCHIVE_EXT = ['.zip', '.cbz', '.rar', '.cbr'];
const SUPPORTED_EXT = [...IMAGE_EXT, ...ARCHIVE_EXT];
const IMAGE_RE = /\.(bmp|jpe?g|png|gif|webp)$/i;

const MIME_TYPES = {
	'.bmp': 'image/bmp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
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
		config = { ...DEFAULT_CONFIG, ...JSON.parse(data) };
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

async function extractZip(data) {
	const zip = await JSZip.loadAsync(data);
	const files = Object.values(zip.files)
		.filter((f) => !f.dir && IMAGE_RE.test(f.name))
		.sort((a, b) => a.name.localeCompare(b.name));
	const items = [];
	for (const f of files) {
		items.push({ name: f.name, buffer: await f.async('nodebuffer') });
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
	return names.map((name) => ({ name, buffer: Buffer.from(byName.get(name)) }));
}

function createWindow() {
	win = new BrowserWindow({
		width: 800,
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
		const names = await fs.promises.readdir(dirPath);
		const entries = [];
		for (const name of names) {
			const ext = path.extname(name).toLowerCase();
			if (!SUPPORTED_EXT.includes(ext)) continue;
			const full = path.join(dirPath, name);
			const stat = await fs.promises.stat(full);
			entries.push({ name, path: full, ext, mtime: stat.mtime.toISOString() });
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

ipcMain.handle('archive:open', async (event, filePath) => {
	try {
		const ext = path.extname(filePath).toLowerCase();
		const data = await fs.promises.readFile(filePath);
		let items;
		if (ext === '.zip' || ext === '.cbz') {
			items = await extractZip(data);
		} else if (ext === '.rar' || ext === '.cbr') {
			items = await extractRar(data);
		} else {
			return { error: 'Unsupported archive format: ' + ext };
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
	config = { ...config, ...partial };
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
		const ext = path.extname(item.name).toLowerCase();
		return new Response(item.buffer, { headers: { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' } });
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
