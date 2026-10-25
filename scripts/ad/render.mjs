// Renders scripts/ad/ad.html frame by frame (1080p, 60 fps) and encodes it
// with ffmpeg, music underneath:
//   node scripts/ad/render.mjs CONFIG.json OUT.mp4 [--from S --to S] [--fps N]
// CONFIG (written by make.py) is window.AD for the page plus "music".
// Needs Playwright with Chromium (dev only) and ffmpeg.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const [cfgPath, out, ...rest] = process.argv.slice(2);
const opt = (name, def) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? Number(rest[i + 1]) : def;
};
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const fps = opt('fps', 60);
const here = dirname(fileURLToPath(import.meta.url));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript((c) => (window.AD = c), cfg);
await page.goto('file://' + join(here, 'ad.html'));
await page.evaluate(() => document.fonts.ready);
const duration = await page.evaluate(() => window.DURATION);
const from = opt('from', 0);
const to = Math.min(opt('to', duration), duration);
const frames = Math.round((to - from) * fps);

const args = ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-'];
if (cfg.music && from === 0) {
  args.push('-i', cfg.music, '-map', '0:v', '-map', '1:a', '-af', `volume=0.6,afade=t=in:d=1.5,afade=t=out:st=${to - 2.2}:d=2.2`, '-c:a', 'aac', '-b:a', '192k', '-shortest');
}
args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', out);
const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });

const t0 = Date.now();
for (let f = 0; f < frames; f++) {
  const t = from + f / fps;
  await page.evaluate((t) => window.renderAt(t), t);
  const jpg = await page.screenshot({ type: 'jpeg', quality: 96 });
  if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
  if (f % (fps * 5) === 0) process.stdout.write(`  ${t.toFixed(1)} s (${Math.round((Date.now() - t0) / 1000)} s elapsed)\n`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
console.log(`${out}: ${frames} frames in ${Math.round((Date.now() - t0) / 1000)} s`);
