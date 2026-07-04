// moves just-touched keys to the end (most-recently-used) and, once the
// map exceeds maxEntries, evicts from the front (least-recently-used)
function touchAndCap(map, touchedKeys, maxEntries) {
	const result = { ...map };
	for (const key of touchedKeys) {
		if (key in result) {
			const value = result[key];
			delete result[key];
			result[key] = value;
		}
	}
	const keys = Object.keys(result);
	for (const key of keys.slice(0, Math.max(0, keys.length - maxEntries))) {
		delete result[key];
	}
	return result;
}

// Multiple instances of the app may run at once and share config.json, so
// this only ever merges in the fields present in partial (never overwrites
// the whole file), with special-cased deep merges for the nested maps.
function mergeConfig(onDisk, partial, maxHistoryEntries) {
	const mergedHistory = { ...onDisk.history, ...(partial.history || {}) };
	const mergedReadMap = { ...onDisk.readMap, ...(partial.readMap || {}) };
	return {
		...onDisk,
		...partial,
		keybindings: { ...onDisk.keybindings, ...(partial.keybindings || {}) },
		history: touchAndCap(mergedHistory, Object.keys(partial.history || {}), maxHistoryEntries),
		readMap: touchAndCap(mergedReadMap, Object.keys(partial.readMap || {}), maxHistoryEntries),
	};
}

module.exports = { touchAndCap, mergeConfig };
