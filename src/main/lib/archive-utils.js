const { IMAGE_RE } = require('./file-types');

// a declared size that's missing, non-finite, or negative (e.g. an
// uncompressedSize field that overflowed 32-bit signed parsing around the
// 2GB mark) is treated as unbounded rather than trusted or silently zeroed
function declaredSize(raw) {
	if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return Infinity;
	return raw;
}

function checkArchiveBudget(entryCount, totalUncompressedSize, limits) {
	const { maxEntries, maxTotalSize } = limits;
	if (entryCount > maxEntries) {
		throw new Error(`Archive has too many entries (${entryCount} > ${maxEntries})`);
	}
	if (totalUncompressedSize > maxTotalSize) {
		const mb = Number.isFinite(totalUncompressedSize) ? Math.round(totalUncompressedSize / (1024 * 1024)) : 'unknown';
		throw new Error(`Archive is too large when decompressed (${mb}MB > ${Math.round(maxTotalSize / (1024 * 1024))}MB)`);
	}
}

// a classic decompression bomb hides an extreme compression ratio in one
// entry (the canonical 42.zip turns ~40KB into ~4.5PB); real image data is
// already its own compressed format, so even a very flat/simple page rarely
// deflates past a few dozen-to-one. Checking this from declared metadata
// alone (central directory / archive header, no I/O) catches a bomb entry
// before any decompression work is attempted, independent of the total-size
// budget below - a single oversized entry among otherwise-small ones would
// still pass an aggregate check until it was actually decompressed.
function checkEntryRatios(entries, { compressedSizeOf, uncompressedSizeOf, nameOf }, maxRatio) {
	for (const entry of entries) {
		const compressed = declaredSize(compressedSizeOf(entry));
		const uncompressed = declaredSize(uncompressedSizeOf(entry));
		if (uncompressed <= 0) continue; // nothing to expand into, not a bomb risk
		// a near-zero compressed size feeding real output is itself the
		// signature of an extreme-ratio bomb entry, regardless of the exact ratio
		const ratio = compressed <= 0 ? Infinity : uncompressed / compressed;
		if (ratio > maxRatio) {
			throw new Error(`Archive entry "${nameOf(entry)}" has a suspicious compression ratio (${Number.isFinite(ratio) ? Math.round(ratio) : 'unbounded'}:1)`);
		}
	}
}

// selects only image entries from a zip/rar entry list and sorts by name;
// isDir/nameOf abstract over jszip's ZipObject vs node-unrar-js's FileHeader shapes
function selectImageEntries(entries, { isDir, nameOf }) {
	return entries
		.filter((e) => !isDir(e) && IMAGE_RE.test(nameOf(e)))
		.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}

module.exports = { declaredSize, checkArchiveBudget, checkEntryRatios, selectImageEntries };
