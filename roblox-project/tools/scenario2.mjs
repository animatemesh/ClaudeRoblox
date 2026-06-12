// Scripted verification for the v2 features: facing, base buildings,
// collect buttons + money burst, laser blockade, Tool swing, collisions.
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
page.on('pageerror', (e) => logs.push(`[PAGEERROR] ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle2', timeout: 90_000 });
await page.waitForFunction(() => !document.getElementById('loading'), { timeout: 90_000 });
await new Promise((r) => setTimeout(r, 4000));
const shot = (name) => page.screenshot({ path: outDir + name + '.png' });

await shot('v2_boot');

// 1. facing: walk forward (away from camera) and screenshot mid-run
await page.keyboard.down('KeyW');
await new Promise((r) => setTimeout(r, 1300));
await shot('v2_running_back');
await page.keyboard.up('KeyW');

// 2. buy an item, carry it
let r = await page.evaluate(() => {
  const g = window.__game;
  g.player.money = 100000;
  g.playerCtl.dist = 6;
  const item = g.conveyor.items[0];
  if (!item) return 'no belt item';
  g.player.position.set(item.root.position.x + 1.5, item.root.position.y, item.root.position.z);
  const bought = g.tryBuy(g.player, g.conveyor.nearestTo(g.player.position, 4));
  return bought ? 'bought' : 'buy failed';
});
logs.push('[buy] ' + r);
await new Promise((res) => setTimeout(res, 600));
await shot('v2_carrying');

// 3. teleport home -> auto deposit; wait for accrual
r = await page.evaluate(() => {
  const g = window.__game;
  const z = g.player.home.zone;
  g.player.position.set(z.center.x, z.floorY, z.center.z);
  return 'home';
});
await new Promise((res) => setTimeout(res, 1200));
r = await page.evaluate(() => {
  const g = window.__game;
  return 'stored=' + g.player.home.storedCount() + ' accruedSoFar=' + g.player.home.totalAccrued().toFixed(2);
});
logs.push('[deposit] ' + r);
await shot('v2_in_base');

// 4. let money accrue, then step on the collect button
await page.evaluate(() => {
  const g = window.__game;
  // fast-forward accrual
  for (const s of g.player.home.slots) if (s.item) s.accrued += 25;
});
r = await page.evaluate(() => {
  const g = window.__game;
  const slot = g.player.home.slots.find((s) => s.item);
  if (!slot) return 'no stored slot';
  g.player.position.set(slot.buttonPos.x, slot.buttonPos.y + 0.1, slot.buttonPos.z);
  return 'on button, accrued=' + slot.accrued.toFixed(1);
});
logs.push('[collect-step] ' + r);
await new Promise((res) => setTimeout(res, 350)); // burst mid-flight
await shot('v2_money_burst');
r = await page.evaluate(() => {
  const g = window.__game;
  return 'money=' + Math.floor(g.player.money) + ' accruedNow=' + g.player.home.totalAccrued().toFixed(2);
});
logs.push('[collected] ' + r);

// 5. blockade: step the red button, screenshot lasers, test collision
r = await page.evaluate(() => {
  const g = window.__game;
  const b = g.player.home;
  g.player.position.set(b.blockadeButtonPos.x, b.blockadeButtonPos.y + 0.1, b.blockadeButtonPos.z);
  return 'on blockade button, ready=' + b.blockadeReady;
});
logs.push('[blockade-step] ' + r);
await new Promise((res) => setTimeout(res, 400));
r = await page.evaluate(() => 'active=' + window.__game.player.home.blockadeActive);
logs.push('[blockade] ' + r);
await page.evaluate(() => { window.__game.playerCtl.dist = 12; window.__game.playerCtl.pitch = 0.5; });
await new Promise((res) => setTimeout(res, 400));
await shot('v2_lasers');

// collision test: park a bot outside the laser and force it inward
r = await page.evaluate(async () => {
  const g = window.__game;
  const home = g.player.home;
  const bot = g.entities.find((e) => !e.isPlayer);
  const L = home.zone.laser;
  const lx = (L.minX + L.maxX) / 2;
  const outsideX = home.zone.side === 1 ? lx - 2.5 : lx + 2.5;
  bot.position.set(outsideX, home.zone.floorY, (L.minZ + L.maxZ) / 2);
  bot.moveIntent.set(home.zone.side === 1 ? 1 : -1, 0); // push toward the laser
  return 'bot placed at x=' + outsideX.toFixed(1) + ', laser x=' + lx.toFixed(1) + ', side=' + home.zone.side;
});
logs.push('[laser-collision-setup] ' + r);
await new Promise((res) => setTimeout(res, 1500));
r = await page.evaluate(() => {
  const g = window.__game;
  const home = g.player.home;
  const bot = g.entities.find((e) => !e.isPlayer);
  bot.moveIntent.set(0, 0);
  const L = home.zone.laser;
  const lx = (L.minX + L.maxX) / 2;
  const crossed = home.zone.side === 1 ? bot.position.x > lx + 0.3 : bot.position.x < lx - 0.3;
  return 'bot x=' + bot.position.x.toFixed(2) + ' laser x=' + lx.toFixed(2) + ' CROSSED=' + crossed;
});
logs.push('[laser-collision] ' + r);

// wall collision test: drive a bot at a side wall from inside
r = await page.evaluate(() => {
  const g = window.__game;
  const home = g.player.home;
  const bot = g.entities.find((e) => !e.isPlayer);
  const z = home.zone;
  bot.position.set(z.center.x, z.floorY, z.center.z);
  bot.moveIntent.set(0, 1); // toward +z side wall
  return 'driving bot at side wall, footprint maxZ=' + z.footprint.maxZ.toFixed(1);
});
await new Promise((res) => setTimeout(res, 1500));
r = await page.evaluate(() => {
  const g = window.__game;
  const home = g.player.home;
  const bot = g.entities.find((e) => !e.isPlayer);
  bot.moveIntent.set(0, 0);
  const escaped = bot.position.z > home.zone.footprint.maxZ + 0.2;
  return 'bot z=' + bot.position.z.toFixed(2) + ' wallZ=' + home.zone.footprint.maxZ.toFixed(2) + ' ESCAPED=' + escaped;
});
logs.push('[wall-collision] ' + r);

// 6. Tool swing closeup
await page.evaluate(() => {
  const g = window.__game;
  g.playerCtl.dist = 4.5;
  g.playerCtl.pitch = 0.25;
  g.player.startSwing();
});
await new Promise((res) => setTimeout(res, 180));
await shot('v2_tool_swing');

// 7. long-run state dump
await new Promise((res) => setTimeout(res, 8000));
const state = await page.evaluate(() => window.__gameDebug());
logs.push('[STATE] ' + JSON.stringify(state.entities));
await shot('v2_late');

console.log(logs.join('\n'));
await browser.close();
