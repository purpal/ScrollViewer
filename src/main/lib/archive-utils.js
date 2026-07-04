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

// selects only image entries from a zip/rar entry list and sorts by name;
// isDir/nameOf abstract over jszip's ZipObject vs node-unrar-js's FileHeader shapes
function selectImageEntries(entries, { isDir, nameOf }) {
	return entries
		.filter((e) => !isDir(e) && IMAGE_RE.test(nameOf(e)))
		.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}

module.exports = { declaredSize, checkArchiveBudget, selectImageEntries };
