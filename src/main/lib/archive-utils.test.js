const test = require('node:test');
const assert = require('node:assert/strict');
const { declaredSize, checkArchiveBudget, checkEntryRatios, selectImageEntries } = require('./archive-utils');

test('declaredSize passes through a normal finite size', () => {
	assert.equal(declaredSize(1024), 1024);
});

test('declaredSize treats missing/undefined size as unbounded', () => {
	assert.equal(declaredSize(undefined), Infinity);
});

test('declaredSize treats a negative size (e.g. 32-bit overflow) as unbounded', () => {
	assert.equal(declaredSize(-2147483648), Infinity);
});

test('declaredSize treats NaN as unbounded', () => {
	assert.equal(declaredSize(NaN), Infinity);
});

test('checkArchiveBudget allows an archive within both limits', () => {
	assert.doesNotThrow(() => checkArchiveBudget(5, 5000, { maxEntries: 2000, maxTotalSize: 1024 * 1024 * 1024 }));
});

test('checkArchiveBudget rejects too many entries', () => {
	assert.throws(() => checkArchiveBudget(3000, 100, { maxEntries: 2000, maxTotalSize: 1024 * 1024 * 1024 }), /too many entries/);
});

test('checkArchiveBudget rejects an oversized decompressed total', () => {
	assert.throws(
		() => checkArchiveBudget(5, 2 * 1024 * 1024 * 1024, { maxEntries: 2000, maxTotalSize: 1024 * 1024 * 1024 }),
		/too large when decompressed/
	);
});

test('checkArchiveBudget rejects Infinity (a zip-bomb entry with an unbounded declared size)', () => {
	assert.throws(() => checkArchiveBudget(5, Infinity, { maxEntries: 2000, maxTotalSize: 1024 * 1024 * 1024 }), /too large when decompressed/);
});

test('checkEntryRatios allows entries within the ratio limit', () => {
	const entries = [{ name: 'a.jpg', compressed: 900, uncompressed: 1000 }];
	assert.doesNotThrow(() => checkEntryRatios(entries, {
		compressedSizeOf: (e) => e.compressed,
		uncompressedSizeOf: (e) => e.uncompressed,
		nameOf: (e) => e.name,
	}, 100));
});

test('checkEntryRatios rejects an entry with an extreme compression ratio (a bomb signature)', () => {
	const entries = [{ name: 'bomb.png', compressed: 100, uncompressed: 100 * 1024 * 1024 }];
	assert.throws(() => checkEntryRatios(entries, {
		compressedSizeOf: (e) => e.compressed,
		uncompressedSizeOf: (e) => e.uncompressed,
		nameOf: (e) => e.name,
	}, 100), /suspicious compression ratio/);
});

test('checkEntryRatios rejects a near-zero compressed size feeding real output', () => {
	const entries = [{ name: 'bomb.png', compressed: 0, uncompressed: 1024 }];
	assert.throws(() => checkEntryRatios(entries, {
		compressedSizeOf: (e) => e.compressed,
		uncompressedSizeOf: (e) => e.uncompressed,
		nameOf: (e) => e.name,
	}, 100), /suspicious compression ratio/);
});

test('checkEntryRatios ignores empty entries (nothing to expand into)', () => {
	const entries = [{ name: 'empty.txt', compressed: 0, uncompressed: 0 }];
	assert.doesNotThrow(() => checkEntryRatios(entries, {
		compressedSizeOf: (e) => e.compressed,
		uncompressedSizeOf: (e) => e.uncompressed,
		nameOf: (e) => e.name,
	}, 100));
});

test('selectImageEntries filters out directories and non-image files, then sorts by name', () => {
	const entries = [
		{ name: 'b.png', dir: false },
		{ name: 'a.jpg', dir: false },
		{ name: 'notes.txt', dir: false },
		{ name: 'sub', dir: true },
	];
	const result = selectImageEntries(entries, { isDir: (e) => e.dir, nameOf: (e) => e.name });
	assert.deepEqual(result.map((e) => e.name), ['a.jpg', 'b.png']);
});
