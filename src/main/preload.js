const { contextBridge, ipcRenderer, webUtils } = require('electron');
const path = require('path');

contextBridge.exposeInMainWorld('api', {
	chooseFolder: () => ipcRenderer.invoke('dialog:choose-folder'),
	listDir: (dirPath) => ipcRenderer.invoke('fs:list-dir', dirPath),
	statPath: (p) => ipcRenderer.invoke('fs:stat', p),
	openArchive: (filePath) => ipcRenderer.invoke('archive:open', filePath),
	getConfig: () => ipcRenderer.invoke('config:get'),
	setConfig: (partial) => ipcRenderer.invoke('config:set', partial),
	resetKeybindings: () => ipcRenderer.invoke('config:reset-keybindings'),
	toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
	onFullscreenChange: (cb) => ipcRenderer.on('fullscreen-changed', (_e, val) => cb(val)),
	onBeforeClose: (cb) => ipcRenderer.on('app:before-close', cb),
	readyToClose: () => ipcRenderer.send('app:ready-to-close'),
	dirname: (p) => path.dirname(p),
	getDroppedPath: (file) => webUtils.getPathForFile(file),
	getLaunchPath: () => ipcRenderer.invoke('app:get-launch-path'),
	getVersion: () => ipcRenderer.invoke('app:get-version'),
	onOpenPathRequest: (cb) => ipcRenderer.on('open-path-request', (_e, p) => cb(p)),
});
