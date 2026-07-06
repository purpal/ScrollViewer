const test = require('node:test');
const assert = require('node:assert/strict');
const { cacheKeyFor, extensionForMime, planEviction } = require('./upscale-cache');

test('cacheKeyFor is deterministic and content-addressed', () => {
	const a = Buffer.from('hello world');
	const b = Buffer.from('hello world');
	const c = Buffer.from('different content');
	assert.equal(cacheKeyFor(a), cacheKeyFor(b));
	assert.notEqual(cacheKeyFor(a), cacheKeyFor(c));
});

test('cacheKeyFor returns a fixed-length hex string', () => {
	const key = cacheKeyFor(Buffer.from('x'));
	assert.equal(key.length, 32);
	assert.match(key, /^[0-9a-f]+$/);
});

test('extensionForMime maps supported formats', () => {
	assert.equal(extensionForMime('image/png'), '.png');
	assert.equal(extensionForMime('image/jpeg'), '.jpg');
	assert.equal(extensionForMime('image/webp'), '.webp');
});

test('extensionForMime rejects formats waifu2x cannot read', () => {
	assert.equal(extensionForMime('image/bmp'), null);
	assert.equal(extensionForMime('image/gif'), null);
});

test('planEviction keeps everything when under budget', () => {
	const files = [
		{ path: 'a', size: 100, mtimeMs: 1 },
		{ path: 'b', size: 100, mtimeMs: 2 },
	];
	assert.deepEqual(planEviction(files, 1000), []);
});

test('planEviction deletes oldest-first until under budget', () => {
	const files = [
		{ path: 'a', size: 100, mtimeMs: 3 },
		{ path: 'b', size: 100, mtimeMs: 1 },
		{ path: 'c', size: 100, mtimeMs: 2 },
	];
	// budget only fits one file (100 bytes); must delete the two oldest (b, c)
	const deleted = planEviction(files, 100);
	assert.deepEqual(deleted.map((f) => f.path), ['b', 'c']);
});

test('planEviction deletes everything if even the newest alone exceeds budget', () => {
	const files = [{ path: 'a', size: 500, mtimeMs: 1 }];
	assert.deepEqual(planEviction(files, 100).map((f) => f.path), ['a']);
});
