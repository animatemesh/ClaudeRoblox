// Scripted gameplay scenario: drives the live game through buy / carry /
// deposit / steal / swing moments and screenshots each one.
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
await new Promise((r) => setTimeout(r, 5000)); // let some items spawn

const shot = async (name) => page.screenshot({ path: outDir + name + '.png' });

// 1. close-up of the player standing on the carpet next to a belt item
let r = await page.evaluate(() => {
  const g = window.__game;
  g.player.money = 100000; // test bankroll so purchases always succeed
  g.playerCtl.dist = 5;
  g.playerCtl.pitch = 0.35;
  const item = g.conveyor.items[0];
  if (!item) return 'no belt item';
  g.player.position.set(item.root.position.x + 1.5, item.root.position.y, item.root.position.z + 1);
  return 'ok near ' + item.def.name;
});
logs.push('[1 near item] ' + r);
await new Promise((res) => setTimeout(res, 800));
await shot('s1_near_item');

// 2. buy it -> carried overhead
r = await page.evaluate(() => {
  const g = window.__game;
  const item = g.conveyor.nearestTo(g.player.position, 4);
  if (!item) return 'no item in range';
  const ok = g.tryBuy(g.player, item);
  return ok ? 'bought ' + item.def.name : 'buy failed (price ' + item.rarity.price + ', money ' + g.player.money + ')';
});
logs.push('[2 buy] ' + r);
await new Promise((res) => setTimeout(res, 800));
await shot('s2_carrying');

// 3. walk home: teleport to own base edge, auto-deposit should fire
r = await page.evaluate(() => {
  const g = window.__game;
  const z = g.player.home.zone;
  g.player.position.set(z.center.x, z.floorY, z.center.z);
  return 'teleported home';
});
await new Promise((res) => setTimeout(res, 1000));
r = await page.evaluate(() => {
  const g = window.__game;
  return 'stored=' + g.player.home.storedCount() + ' carried=' + (g.player.carried?.def.name ?? 'none');
});
logs.push('[3 deposit] ' + r);
await shot('s3_deposited');

// 4. mid-swing screenshot
await page.evaluate(() => window.__game.player.startSwing());
await new Promise((res) => setTimeout(res, 140));
await shot('s4_swing');

// 5. go steal from a bot base that has something stored
r = await page.evaluate(() => {
  const g = window.__game;
  for (const base of g.bases) {
    if (base.owner === g.player) continue;
    const item = base.bestStoredItem();
    if (item) {
      g.player.position.set(item.root.position.x + 1.2, base.zone.floorY, item.root.position.z + 1.2);
      return 'at ' + base.owner.name + "'s " + item.def.name;
    }
  }
  return 'no enemy base has items yet';
});
logs.push('[5 at enemy base] ' + r);
await new Promise((res) => setTimeout(res, 600));
await shot('s5_enemy_base');

r = await page.evaluate(() => {
  const g = window.__game;
  for (const base of g.bases) {
    if (base.owner === g.player) continue;
    const item = base.bestStoredItem();
    if (item) return g.trySteal(g.player, item) ? 'stole ' + item.def.name : 'steal failed';
  }
  return 'nothing to steal';
});
logs.push('[6 steal] ' + r);
await new Promise((res) => setTimeout(res, 600));
await shot('s6_stolen_carry');

// 7. simulate getting batted: drop rules send it flying home
r = await page.evaluate(() => {
  const g = window.__game;
  const thief = g.player;
  if (!thief.carried) return 'not carrying';
  const defender = g.entities.find((e) => e !== thief);
  thief.applyHit(defender.position);
  g['dropCarried'](thief, defender);
  return 'dropped; item state now flies home';
});
logs.push('[7 batted] ' + r);
await new Promise((res) => setTimeout(res, 700));
await shot('s7_flyback');
await new Promise((res) => setTimeout(res, 2000));
r = await page.evaluate(() => {
  const g = window.__game;
  const states = [...g['items']].map((i) => i.def.name + ':' + i.state);
  return states.join(', ');
});
logs.push('[8 item states] ' + r);
await shot('s8_after_return');

console.log(logs.join('\n'));
await browser.close();
