/**
 * Simple bundler to combine all JS modules into a single file
 * This allows the app to run without a server (no CORS issues)
 */

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
console.log('✓ You can now open index.html directly in your browser!');

