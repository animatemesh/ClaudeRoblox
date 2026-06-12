// Closeup checks: facing while running, bat in hand, Tool swing.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5175/';
const outDir = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--window-size=1280,800', '--mute-audio'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle2', timeout: 90_000 });
await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 90_000 });
await new Promise((r) => setTimeout(r, 3000));
const shot = (name) => page.screenshot({ path: outDir + name + '.png' });

// camera close behind
await page.evaluate(() => {
  const g = window.__game;
  g.playerCtl.dist = 4.5;
  g.playerCtl.pitch = 0.25;
  g.player.position.set(0, 1, -5); // on the carpet, clear view
});

// run away from the camera: we must see the BACK of the head
await page.keyboard.down('KeyW');
await new Promise((r) => setTimeout(r, 900));
await shot('v3_run_back');
await page.keyboard.up('KeyW');
await new Promise((r) => setTimeout(r, 700));
await shot('v3_idle_back');

// turn around: run toward the camera, should see the face
await page.keyboard.down('KeyS');
await new Promise((r) => setTimeout(r, 900));
await shot('v3_run_face');
await page.keyboard.up('KeyS');

// swing closeup (facing camera so the bat arc is visible)
await page.evaluate(() => window.__game.player.startSwing());
await new Promise((r) => setTimeout(r, 200));
await shot('v3_swing_mid');
await new Promise((r) => setTimeout(r, 1100));

// side view of idle bat
await page.evaluate(() => {
  const g = window.__game;
  g.player.root.rotation.y = Math.PI / 2; // profile to camera
});
await new Promise((r) => setTimeout(r, 300));
await shot('v3_profile_bat');

console.log('done');
await browser.close();
