// Turns pre-gathered facts about a folder's direct children into the
// chapter list shown in the sidebar: subfolders containing images and
// standalone archive files each become one entry, and any loose images
// sitting directly in the folder are bundled into a single entry so they
// read as one chapter instead of a wall of individual files.
//
// items: array of either
//   { name, path, isDirectory: true, mtime }  (subfolder confirmed to contain images)
//   { name, path, isDirectory: false, isArchive, isImage, mtime }
function classifyDirEntries(dirPath, dirName, items) {
	const entries = [];
	const looseImages = [];

	for (const item of items) {
		if (item.isDirectory) {
			entries.push({ name: item.name, path: item.path, type: 'directory', mtime: item.mtime });
			continue;
		}
		if (item.isArchive) {
			entries.push({ name: item.name, path: item.path, type: 'archive', mtime: item.mtime });
		} else if (item.isImage) {
			looseImages.push(item);
		}
	}

	if (looseImages.length > 0) {
		const mtime = new Date(Math.max(...looseImages.map((f) => new Date(f.mtime).getTime()))).toISOString();
		const name = looseImages.length === 1 ? looseImages[0].name : dirName;
		entries.push({ name, path: dirPath, type: 'directory', mtime });
	}

	return entries;
}

module.exports = { classifyDirEntries };
