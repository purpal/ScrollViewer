const crypto = require('crypto');

// Content-addressed: identical page bytes (even across different archives/
// sessions, or the same page reopened after the archive cache evicted it)
// share one cache entry, keyed by hash rather than session/index.
function cacheKeyFor(buffer) {
	return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 32);
}

// only formats waifu2x-ncnn-vulkan actually accepts as input
const UPSCALE_SUPPORTED_MIME = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

function extensionForMime(mime) {
	return UPSCALE_SUPPORTED_MIME[mime] || null;
}

// decides which cache files to evict (oldest access time first) to bring
// total size back under the budget, without touching the filesystem itself
// (caller does the actual unlink) so this stays cheaply unit-testable
function planEviction(files, maxTotalBytes) {
	const sorted = [...files].sort((a, b) => a.mtimeMs - b.mtimeMs);
	let total = sorted.reduce((sum, f) => sum + f.size, 0);
	const toDelete = [];
	for (const f of sorted) {
		if (total <= maxTotalBytes) break;
		toDelete.push(f);
		total -= f.size;
	}
	return toDelete;
}

module.exports = { cacheKeyFor, extensionForMime, UPSCALE_SUPPORTED_MIME, planEviction };
