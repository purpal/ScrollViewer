const test = require('node:test');
const assert = require('node:assert/strict');
const { touchAndCap, mergeConfig } = require('./config-merge');

test('touchAndCap leaves a map under the cap untouched', () => {
	const result = touchAndCap({ a: 1, b: 2 }, [], 10);
	assert.deepEqual(result, { a: 1, b: 2 });
});

test('touchAndCap evicts the least-recently-touched keys once over the cap', () => {
	const result = touchAndCap({ a: 1, b: 2, c: 3, d: 4, e: 5 }, [], 3);
	assert.deepEqual(Object.keys(result), ['c', 'd', 'e']);
});

test('touchAndCap keeps a just-touched key alive even if it was the oldest', () => {
	const result = touchAndCap({ a: 1, b: 2, c: 3, d: 4, e: 5 }, ['a'], 3);
	assert.deepEqual(Object.keys(result), ['d', 'e', 'a']);
});

test('touchAndCap appends a brand-new key and evicts the oldest once over the cap', () => {
	const merged = { ...{ a: 1, b: 2, c: 3 }, f: 6 };
	const result = touchAndCap(merged, ['f'], 3);
	assert.deepEqual(result, { b: 2, c: 3, f: 6 });
});

test('mergeConfig only overlays fields present in partial, never wiping unrelated state', () => {
	const onDisk = { path: '/old', darkMode: false, history: {}, readMap: {}, keybindings: { prev: 'left' } };
	const result = mergeConfig(onDisk, { darkMode: true }, 300);
	assert.equal(result.path, '/old');
	assert.equal(result.darkMode, true);
	assert.deepEqual(result.keybindings, { prev: 'left' });
});

test('mergeConfig deep-merges history/readMap instead of overwriting the whole map', () => {
	const onDisk = { history: { '/folderA': { file: 'a.png', vpos: 10 } }, readMap: {} };
	const result = mergeConfig(onDisk, { history: { '/folderB': { file: 'b.png', vpos: 0 } } }, 300);
	assert.deepEqual(result.history, {
		'/folderA': { file: 'a.png', vpos: 10 },
		'/folderB': { file: 'b.png', vpos: 0 },
	});
});

test('mergeConfig caps history so it cannot grow unboundedly across many folders', () => {
	const onDisk = { history: {}, readMap: {} };
	let result = onDisk;
	for (let i = 0; i < 5; i++) {
		result = mergeConfig(result, { history: { [`/folder${i}`]: { file: 'p.png', vpos: 0 } } }, 3);
	}
	assert.equal(Object.keys(result.history).length, 3);
	assert.deepEqual(Object.keys(result.history), ['/folder2', '/folder3', '/folder4']);
});
