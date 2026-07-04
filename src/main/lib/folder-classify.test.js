const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyDirEntries } = require('./folder-classify');

test('a subfolder containing images becomes its own chapter entry', () => {
	const items = [{ name: 'ch1', path: '/root/ch1', isDirectory: true, mtime: '2024-01-01T00:00:00.000Z' }];
	const result = classifyDirEntries('/root', 'root', items);
	assert.deepEqual(result, [{ name: 'ch1', path: '/root/ch1', type: 'directory', mtime: '2024-01-01T00:00:00.000Z' }]);
});

test('an archive file becomes an archive-type entry', () => {
	const items = [{ name: 'ch1.cbz', path: '/root/ch1.cbz', isDirectory: false, isArchive: true, isImage: false, mtime: '2024-01-01T00:00:00.000Z' }];
	const result = classifyDirEntries('/root', 'root', items);
	assert.deepEqual(result, [{ name: 'ch1.cbz', path: '/root/ch1.cbz', type: 'archive', mtime: '2024-01-01T00:00:00.000Z' }]);
});

test('a single loose image keeps its own filename as the entry name', () => {
	const items = [{ name: 'page1.png', path: '/root/page1.png', isDirectory: false, isArchive: false, isImage: true, mtime: '2024-01-01T00:00:00.000Z' }];
	const result = classifyDirEntries('/root', 'root', items);
	assert.deepEqual(result, [{ name: 'page1.png', path: '/root', type: 'directory', mtime: '2024-01-01T00:00:00.000Z' }]);
});

test('multiple loose images bundle into one chapter named after the folder', () => {
	const items = [
		{ name: 'page1.png', path: '/root/page1.png', isDirectory: false, isArchive: false, isImage: true, mtime: '2024-01-01T00:00:00.000Z' },
		{ name: 'page2.png', path: '/root/page2.png', isDirectory: false, isArchive: false, isImage: true, mtime: '2024-06-01T00:00:00.000Z' },
	];
	const result = classifyDirEntries('/root', 'root', items);
	assert.deepEqual(result, [{ name: 'root', path: '/root', type: 'directory', mtime: '2024-06-01T00:00:00.000Z' }]);
});

test('loose images, subfolders, and archives can all coexist as separate entries', () => {
	const items = [
		{ name: 'ch1', path: '/root/ch1', isDirectory: true, mtime: '2024-01-01T00:00:00.000Z' },
		{ name: 'ch2.cbz', path: '/root/ch2.cbz', isDirectory: false, isArchive: true, isImage: false, mtime: '2024-02-01T00:00:00.000Z' },
		{ name: 'stray.png', path: '/root/stray.png', isDirectory: false, isArchive: false, isImage: true, mtime: '2024-03-01T00:00:00.000Z' },
	];
	const result = classifyDirEntries('/root', 'root', items);
	assert.deepEqual(result, [
		{ name: 'ch1', path: '/root/ch1', type: 'directory', mtime: '2024-01-01T00:00:00.000Z' },
		{ name: 'ch2.cbz', path: '/root/ch2.cbz', type: 'archive', mtime: '2024-02-01T00:00:00.000Z' },
		{ name: 'stray.png', path: '/root', type: 'directory', mtime: '2024-03-01T00:00:00.000Z' },
	]);
});

test('an empty folder yields no entries', () => {
	assert.deepEqual(classifyDirEntries('/root', 'root', []), []);
});
