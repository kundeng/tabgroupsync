import { createCanvas } from 'canvas';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const scale = size / 128; // Base design is 128x128

  // Clear canvas
  ctx.clearRect(0, 0, size, size);

  // Background circle
  ctx.fillStyle = '#E8F0FE';
  ctx.beginPath();
  ctx.arc(size/2, size/2, size/2 * 0.9, 0, Math.PI * 2);
  ctx.fill();

  // Tab Group (left side)
  const tabWidth = 30 * scale;
  const tabHeight = 20 * scale;
  const tabX = 20 * scale;
  const tabY = 40 * scale;
  const tabRadius = 4 * scale;

  // Draw tabs
  ctx.fillStyle = '#1a73e8';
  roundedRect(ctx, tabX, tabY, tabWidth, tabHeight, tabRadius);
  ctx.fillStyle = '#1557b0';
  roundedRect(ctx, tabX, tabY + (12 * scale), tabWidth, tabHeight, tabRadius);
  ctx.fillStyle = '#1a73e8';
  roundedRect(ctx, tabX, tabY + (24 * scale), tabWidth, tabHeight, tabRadius);

  // Sync arrows
  ctx.strokeStyle = '#5f6368';
  ctx.lineWidth = 3 * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Right arrow
  ctx.beginPath();
  ctx.moveTo(54 * scale, 54 * scale);
  ctx.lineTo(66 * scale, 62 * scale);
  ctx.lineTo(54 * scale, 70 * scale);
  ctx.stroke();

  // Left arrow
  ctx.beginPath();
  ctx.moveTo(74 * scale, 54 * scale);
  ctx.lineTo(62 * scale, 62 * scale);
  ctx.lineTo(74 * scale, 70 * scale);
  ctx.stroke();

  // Bookmark
  ctx.fillStyle = '#5f6368';
  ctx.beginPath();
  ctx.moveTo(78 * scale, 40 * scale);
  ctx.lineTo(78 * scale, 84 * scale);
  ctx.lineTo(93 * scale, 74 * scale);
  ctx.lineTo(108 * scale, 84 * scale);
  ctx.lineTo(108 * scale, 40 * scale);
  ctx.closePath();
  ctx.fill();

  return canvas;
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
}

// Ensure the icons directory exists
const iconsDir = join(__dirname, '../public/icons');
await fs.mkdir(iconsDir, { recursive: true });

// Generate icons for each size
for (const size of [16, 48, 128]) {
  const canvas = drawIcon(size);
  const buffer = canvas.toBuffer('image/png');
  await fs.writeFile(join(iconsDir, `icon${size}.png`), buffer);
  console.log(`Generated ${size}x${size} icon`);
}
