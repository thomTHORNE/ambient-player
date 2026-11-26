/**
 * Simple bundler to combine all JS modules into a single file
 * This allows the app to run without a server (no CORS issues)
 */

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

