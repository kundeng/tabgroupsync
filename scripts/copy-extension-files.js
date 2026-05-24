import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const files = [
  ['manifest.json', 'manifest.json'],
  ['src/popup.html', 'popup.html'],
  ['public/icons/icon16.png', 'icons/icon16.png'],
  ['public/icons/icon48.png', 'icons/icon48.png'],
  ['public/icons/icon128.png', 'icons/icon128.png'],
  ['public/welcome.html', 'welcome.html'],
  ['public/opener.html', 'opener.html'],
  ['public/privacy-policy.html', 'privacy-policy.html'],
];

// Create dist directory if it doesn't exist
const distDir = resolve(projectRoot, 'dist');
if (!existsSync(distDir)) {
  mkdirSync(distDir);
}

// Create icons directory
const iconsDir = resolve(distDir, 'icons');
if (!existsSync(iconsDir)) {
  mkdirSync(iconsDir);
}

// Copy each file
files.forEach(([src, dest]) => {
  try {
    copyFileSync(
      resolve(projectRoot, src),
      resolve(distDir, dest)
    );
    console.log(`Copied ${src} to dist/${dest}`);
  } catch (err) {
    console.error(`Error copying ${src}:`, err);
  }
});
