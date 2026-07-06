// Downloads the prebuilt waifu2x-ncnn-vulkan binary (github.com/nihui/waifu2x-ncnn-vulkan)
// for the current platform into resources/waifu2x/<platform>/, so electron-builder's
// extraResources config has something to bundle. Not run automatically by `npm install` -
// invoked explicitly by CI (or by hand) before `npm run dist`, since the binaries are
// tens of MB and this is a build-time concern, not a dev-dependency.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { buffer: streamToBuffer } = require('node:stream/consumers');
const yauzl = require('yauzl');

const RELEASE_TAG = '20250915';
const RELEASE_BASE = `https://github.com/nihui/waifu2x-ncnn-vulkan/releases/download/${RELEASE_TAG}`;

const PLATFORMS = {
	win: { asset: `waifu2x-ncnn-vulkan-${RELEASE_TAG}-windows.zip`, exe: 'waifu2x-ncnn-vulkan.exe' },
	mac: { asset: `waifu2x-ncnn-vulkan-${RELEASE_TAG}-macos.zip`, exe: 'waifu2x-ncnn-vulkan' },
	linux: { asset: `waifu2x-ncnn-vulkan-${RELEASE_TAG}-linux.zip`, exe: 'waifu2x-ncnn-vulkan' },
};

function download(url, destPath) {
	return new Promise((resolve, reject) => {
		const file = fs.createWriteStream(destPath);
		https.get(url, (res) => {
			if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				file.close();
				fs.unlinkSync(destPath);
				download(res.headers.location, destPath).then(resolve, reject);
				return;
			}
			if (res.statusCode !== 200) {
				file.close();
				reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`));
				return;
			}
			res.pipe(file);
			file.on('finish', () => file.close(resolve));
		}).on('error', reject);
	});
}

// the release zip wraps everything in a single top-level directory (e.g.
// waifu2x-ncnn-vulkan-20250915-linux/); strip that prefix so files land
// directly in destDir
function stripTopLevelDir(entryName) {
	var idx = entryName.indexOf('/');
	return idx === -1 ? entryName : entryName.slice(idx + 1);
}

async function extractZip(zipPath, destDir) {
	const zipfile = await yauzl.openPromise(zipPath, { lazyEntries: true });
	try {
		for await (const entry of zipfile.eachEntry()) {
			const relPath = stripTopLevelDir(entry.fileName);
			if (!relPath) continue;
			const outPath = path.join(destDir, relPath);
			if (entry.fileName.endsWith('/')) {
				fs.mkdirSync(outPath, { recursive: true });
				continue;
			}
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			const stream = await zipfile.openReadStreamPromise(entry);
			fs.writeFileSync(outPath, await streamToBuffer(stream));
		}
	} finally {
		zipfile.close();
	}
}

async function fetchPlatform(platformKey) {
	const { asset, exe } = PLATFORMS[platformKey];
	const destDir = path.join(__dirname, '..', 'resources', 'waifu2x', platformKey);
	fs.mkdirSync(destDir, { recursive: true });

	const url = `${RELEASE_BASE}/${asset}`;
	const zipPath = path.join(destDir, asset);
	console.log(`Downloading ${url}`);
	await download(url, zipPath);

	await extractZip(zipPath, destDir);
	fs.unlinkSync(zipPath);

	if (platformKey !== 'win') {
		fs.chmodSync(path.join(destDir, exe), 0o755);
	}
	console.log(`Ready: resources/waifu2x/${platformKey}/${exe}`);
}

async function main() {
	const target = process.argv[2] || process.platform;
	const platformKey = target === 'win32' ? 'win' : target === 'darwin' ? 'mac' : target;
	if (!PLATFORMS[platformKey]) {
		console.error(`Unknown platform "${target}"; expected one of: win, mac, linux (or win32/darwin/linux)`);
		process.exit(1);
	}
	await fetchPlatform(platformKey);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
