const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { cacheKeyFor, extensionForMime, planEviction } = require('./upscale-cache');

// waifu2x-ncnn-vulkan is bundled as a platform-specific extraResource (see
// package.json's build.win/mac/linux.extraResources and
// scripts/fetch-waifu2x.js) rather than checked into git, since the
// prebuilt releases are tens of MB each x3 platforms. A fresh checkout
// without that fetch step just has empty resources/waifu2x/<platform>/
// directories, so binaryPath() legitimately may not exist — callers must
// treat that as "feature unavailable", not a crash.
function platformDir() {
	if (process.platform === 'win32') return 'win';
	if (process.platform === 'darwin') return 'mac';
	return 'linux';
}

function resourcesBase(appIsPackaged, resourcesPath) {
	return appIsPackaged
		? path.join(resourcesPath, 'waifu2x')
		: path.join(__dirname, '..', '..', '..', 'resources', 'waifu2x');
}

function binaryDir(appIsPackaged, resourcesPath) {
	return path.join(resourcesBase(appIsPackaged, resourcesPath), platformDir());
}

function binaryPath(appIsPackaged, resourcesPath) {
	const exe = process.platform === 'win32' ? 'waifu2x-ncnn-vulkan.exe' : 'waifu2x-ncnn-vulkan';
	return path.join(binaryDir(appIsPackaged, resourcesPath), exe);
}

function isUpscalerAvailable(appIsPackaged, resourcesPath) {
	return fs.existsSync(binaryPath(appIsPackaged, resourcesPath));
}

const MAX_UPSCALE_CACHE_BYTES = 1024 * 1024 * 1024; // 1GB of cached enhanced pages

async function enforceUpscaleCacheBudget(cacheDir) {
	let names;
	try {
		names = await fs.promises.readdir(cacheDir);
	} catch (err) {
		return;
	}
	const files = (await Promise.all(names.map(async (name) => {
		const p = path.join(cacheDir, name);
		try {
			const stat = await fs.promises.stat(p);
			return { path: p, size: stat.size, mtimeMs: stat.mtimeMs };
		} catch (err) {
			return null;
		}
	}))).filter(Boolean);
	const toDelete = planEviction(files, MAX_UPSCALE_CACHE_BYTES);
	await Promise.all(toDelete.map((f) => fs.promises.unlink(f.path).catch(() => {})));
}

function runWaifu2x(exePath, modelsDir, inputPath, outputPath) {
	return new Promise((resolve, reject) => {
		const args = ['-i', inputPath, '-o', outputPath, '-s', '2', '-n', '0', '-m', modelsDir];
		execFile(exePath, args, { timeout: 60000 }, (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

// Returns the upscaled image bytes (PNG) for `buffer`, using a disk cache
// keyed by content hash so the same page is never processed twice, even
// across app restarts or after the in-memory archive cache evicts it.
async function upscaleImage(buffer, mime, opts) {
	const { appIsPackaged, resourcesPath, cacheDir } = opts;
	const exePath = binaryPath(appIsPackaged, resourcesPath);
	if (!fs.existsSync(exePath)) {
		throw new Error('AI upscaler is not installed in this build');
	}
	const ext = extensionForMime(mime);
	if (!ext) {
		throw new Error('Unsupported image format for AI upscaling: ' + mime);
	}

	const key = cacheKeyFor(buffer);
	const cachePath = path.join(cacheDir, key + '.png');
	try {
		const cached = await fs.promises.readFile(cachePath);
		const now = new Date();
		fs.promises.utimes(cachePath, now, now).catch(() => {}); // LRU: mark as recently used
		return cached;
	} catch (err) {
		// not cached yet, fall through to actually run the upscaler
	}

	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sv2-upscale-'));
	try {
		const inputPath = path.join(tmpDir, 'in' + ext);
		const outputPath = path.join(tmpDir, 'out.png');
		await fs.promises.writeFile(inputPath, buffer);
		await runWaifu2x(exePath, path.join(binaryDir(appIsPackaged, resourcesPath), 'models-cunet'), inputPath, outputPath);
		const result = await fs.promises.readFile(outputPath);
		await fs.promises.mkdir(cacheDir, { recursive: true });
		await fs.promises.writeFile(cachePath, result);
		enforceUpscaleCacheBudget(cacheDir).catch(() => {}); // fire-and-forget housekeeping
		return result;
	} finally {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	}
}

module.exports = { isUpscalerAvailable, upscaleImage, binaryPath, binaryDir, enforceUpscaleCacheBudget, MAX_UPSCALE_CACHE_BYTES };
