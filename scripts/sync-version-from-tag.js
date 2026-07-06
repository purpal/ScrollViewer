// Run by CI right before building a tagged/released version, so a release
// can be cut just by pushing/publishing a `vX.Y.Z` tag without also having
// to remember a separate package.json edit beforehand.
const fs = require('fs');
const path = require('path');

const ref = process.env.GITHUB_REF_NAME || '';
const version = ref.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+/.test(version)) {
	console.error(`GITHUB_REF_NAME "${ref}" doesn't look like a version tag; leaving package.json untouched`);
	process.exit(1);
}

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t') + '\n');
console.log(`package.json version set to ${version}`);
