import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://localhost:5174/';
const outDir = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--window-size=1280,800', '--mute-audio'],
  defaultViewport: { width: 1280, height: 800 },
});

const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[PAGEERROR] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[REQFAIL] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'networkidle2', timeout: 90_000 });

// wait for the loading screen to disappear (assets + world build)
try {
  await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 90_000 });
  logs.push('[OK] loading screen gone');
} catch {
  logs.push('[WARN] loading screen still present after 90s');
}

// let the simulation run a bit so conveyor items spawn and bots act
await new Promise((r) => setTimeout(r, 6000));
await page.screenshot({ path: outDir + 'boot.png' });

// simulate some forward movement + a swing, then screenshot again
await page.keyboard.down('KeyW');
await new Promise((r) => setTimeout(r, 2500));
await page.keyboard.up('KeyW');
await page.screenshot({ path: outDir + 'moved.png' });

// run longer so bots buy/steal; grab a third shot
await new Promise((r) => setTimeout(r, 12000));
await page.screenshot({ path: outDir + 'late.png' });

// dump a quick game-state probe
const state = await page.evaluate(() => {
  const w = window;
  return w.__gameDebug ? w.__gameDebug() : 'no debug hook';
});
logs.push('[STATE] ' + JSON.stringify(state));

console.log(logs.join('\n'));
await browser.close();
