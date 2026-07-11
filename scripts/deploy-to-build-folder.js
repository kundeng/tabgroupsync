// Mirror the built extension (dist/) into ../tabgroup_build/1.5.0 so the
// "Load unpacked" reload path stays stable across rebuilds. Runs automatically
// after `npm run build` (package.json "postbuild"). ESM (package is type:module).
import { cpSync, rmSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, '..', 'dist');
const dest = resolve(__dirname, '..', '..', 'tabgroup_build', '1.5.0');

// Safety: only ever touch a path that ends in tabgroup_build/<version>.
if (!/[/\\]tabgroup_build[/\\]\d+\.\d+\.\d+$/.test(dest)) {
  console.error('deploy: refusing to write unexpected dest:', dest);
  process.exit(1);
}
if (!existsSync(dist)) {
  console.error('deploy: dist/ not found — build first');
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
// mirror: clear dest, then copy dist
for (const f of readdirSync(dest)) rmSync(join(dest, f), { recursive: true, force: true });
cpSync(dist, dest, { recursive: true });
console.log(`deploy: build -> ${dest}`);
