import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
// The original entry point and its resources stay byte-for-byte unchanged.
const source = readFileSync(join(root, 'index.html'), 'utf8');
const result = source.replace('</head>', '<link rel="stylesheet" href="motion.css?v=3">\n</head>')
  .replace('</body>', '<script src="motion.js?v=3"></script>\n</body>');
writeFileSync(join(root, 'motion.html'), result);
console.log('Built motion.html beside untouched index.html');
