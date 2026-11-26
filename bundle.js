/**
 * Simple bundler to combine all JS modules into a single file
 * This allows the app to run without a server (no CORS issues)
 */

import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const distDir = './dist';
const outputFile = './app.js';

// Order matters - dependencies first
const files = [
  'storage.js',
  'playlist.js',
  'youtubePlayer.js',
  'shareLinks.js',
  'ui.js',
  'accent.js',
  'crt.js',
  'backdrop.js',
  'screenFx.js',
  'screen.js',
  'commands.js',
  'pairing.js',
  'remote.js',
  'qr.js',
  'devices.js',
  'layoutPref.js',
  'skin.js',
  'tabs.js',
  'skinLayout.js',
  'layout.js',
  'scale.js',
  'resize.js',
  'main.js'
];

console.log('Bundling JavaScript files...');

let bundledCode = '(function() {\n"use strict";\n\n';

// Read each file and remove import/export statements
for (const file of files) {
  const filePath = path.join(distDir, file);
  let code = fs.readFileSync(filePath, 'utf8');
  
  // Remove export statements
  code = code.replace(/^export\s+/gm, '');
  
  // Remove import statements (we're bundling everything)
  code = code.replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, '');
  code = code.replace(/^import\s+type\s+.*?from\s+['"].*?['"];?\s*$/gm, '');
  
  bundledCode += `// ===== ${file} =====\n`;
  bundledCode += code;
  bundledCode += '\n\n';
}

bundledCode += '})();';

// Write the bundled file
fs.writeFileSync(outputFile, bundledCode);

console.log(`✓ Bundled to ${outputFile}`);

// Cache-busting: GitHub Pages lets browsers cache files for 10 minutes, so a
// fresh index.html can end up next to a stale styles.css or script. Stamp each
// asset URL with a hash of its contents so every change gets a new URL.
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
const jsVersion = hash(outputFile);

let html = fs.readFileSync('./index.html', 'utf8');
// Every local stylesheet: styles.css and each skin under skins/.
const stamped = [];
html = html.replace(/href="((?:skins\/)?[\w-]+\.css)(\?v=[^"]*)?"/g, (_, file) => {
  const version = hash(`./${file}`);
  stamped.push(`${file}?v=${version}`);
  return `href="${file}?v=${version}"`;
});
// The page loads the single bundle: one file, so no module import can go stale.
html = html.replace(
  /<script( type="module")? src="(dist\/main\.js|app\.js)(\?v=[^"]*)?"><\/script>/,
  `<script src="app.js?v=${jsVersion}"></script>`
);
fs.writeFileSync('./index.html', html);

console.log(`✓ Stamped index.html: ${stamped.join(', ')}, app.js?v=${jsVersion}`);


// Version: every change to the app gets the next patch number. The build
// counts as a change when the app's files differ from the last commit; then
// the version is that commit's version plus one patch. Rebuilding the same
// change keeps the same number, and a build of an unchanged commit keeps its
// own. To start a new minor or major series, set it in package.json by hand:
// a version higher than the last commit's is kept as it is.
const APP_PATHS = ['src', 'index.html', 'styles.css', 'skins', 'assets', 'manifest.webmanifest', 'bundle.js'];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const parse = (v) => (/^(\d+)\.(\d+)\.(\d+)$/.exec(v || '') || []).slice(1).map(Number);
const newer = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
let version = pkg.version;
try {
  const committed = JSON.parse(git('show', 'HEAD:package.json')).version;
  let changed = false;
  try {
    git('diff', '--quiet', 'HEAD', '--', ...APP_PATHS);
  } catch {
    changed = true;
  }
  const base = parse(committed);
  const own = parse(pkg.version);
  const ahead = own.length > 0 && base.length > 0 && newer(own, base) > 0;
  if (base.length && changed && !ahead) version = `${base[0]}.${base[1]}.${base[2] + 1}`;
  // Behind the last commit (an older package.json): catch up.
  else if (base.length && !ahead && !changed) version = committed;
} catch {
  // No git here (a downloaded copy): keep package.json's version.
}
if (version !== pkg.version) {
  pkg.version = version;
  fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
}
const page = fs.readFileSync('./index.html', 'utf8');
const versioned = page.replace(/(<span class="app-version"[^>]*>)v[^<]*(<\/span>)/g, `$1v${version}$2`);
if (versioned !== page) fs.writeFileSync('./index.html', versioned);
console.log(`✓ Version ${version}`);
