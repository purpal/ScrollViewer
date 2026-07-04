const test = require('node:test');
const assert = require('node:assert/strict');
const { declaredSize, checkArchiveBudget, selectImageEntries } = require('./archive-utils');

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
