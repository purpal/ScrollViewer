const TIFF_EXT = ['.tif', '.tiff'];
const IMAGE_EXT = ['.bmp', '.jpg', '.jpeg', '.png', '.gif', '.webp', ...TIFF_EXT];
const ARCHIVE_EXT = ['.zip', '.cbz', '.rar', '.cbr'];
const SUPPORTED_EXT = [...IMAGE_EXT, ...ARCHIVE_EXT];
const IMAGE_RE = /\.(bmp|jpe?g|png|gif|webp|tiff?)$/i;

const MIME_TYPES = {
	'.bmp': 'image/bmp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
};

module.exports = { TIFF_EXT, IMAGE_EXT, ARCHIVE_EXT, SUPPORTED_EXT, IMAGE_RE, MIME_TYPES };
