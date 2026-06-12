# Steal a Brainrot — 3D Browser Clone

A fully playable Three.js clone of the viral "Steal a Brainrot" genre, running
entirely in the browser against the asset pack in `public/assets/`.

## Run it

```bash
npm install
npm run dev        # then open the printed localhost URL and click the canvas
```

`npm run build` produces a static production build in `dist/`.

## How to play

| Input | Action |
| --- | --- |
| Click canvas | Lock the pointer / start playing |
| `W A S D` / arrows | Run (camera-relative) |
| Mouse | Orbit the third-person camera |
| Mouse wheel | Zoom |
| `Space` | Jump |
| Left click / `F` | Swing your bat |
| `E` | Buy from the conveyor / steal from a base / grab dropped loot |

## The loop

- **The red carpet conveyor** runs down the middle of the map. Random animated
  Brainrots (six characters across six rarity tiers, Common → Secret) spawn at
  one end and ride it to the other. Walk up and press `E` to buy one.
- **Your base** is one of six buildings flanking the carpet (8 pedestals each,
  solid walls, open front). Walk a carried Brainrot inside and it auto-stores.
- **Collecting**: stored Brainrots print money into their slot. Step on the
  green button in front of a pedestal to collect it — cue coin sounds and a
  parabolic burst of `$` signs.
- **The blockade**: step on the red button inside your base to raise a laser
  wall across the entrance for a few seconds. Raiders physically cannot cross
  it (and bots know to lock down when you approach).
- **Stealing**: walk into a rival base, press `E` next to a stored Brainrot,
  and sprint it home. It only becomes yours when it lands in your grid.
- **The return rule**: everyone carries a bat (the rig's own `Tool` animation
  drives the swing). If a carrier gets hit, they drop the goods — and a stolen
  Brainrot flies straight back to its original pedestal automatically.
- **Bots**: five AI rivals play exactly like players — they camp the belt,
  raid whoever looks unguarded, sprint stolen loot home, collect their
  earnings, raise their blockades, and defend their own base with extreme
  prejudice. The leaderboard tracks everyone's cash.

## Code map

| File | Responsibility |
| --- | --- |
| `src/game/game.ts` | Orchestrator: rules (buy/steal/drop/deposit), combat resolution, main loop |
| `src/game/world.ts` | Map loading, zone detection from geometry, walk heights |
| `src/game/assets.ts` | GLB/FBX loading, render-true scale calibration, cloning |
| `src/game/conveyor.ts` | Belt spawning and movement |
| `src/game/items.ts` | Brainrot world items incl. the fly-home return flight |
| `src/game/base.ts` | Storage grids, money printing, theft reservations |
| `src/game/character.ts` | Shared player/bot body: movement, procedural animation, bat swings |
| `src/game/player.ts` | Input + third-person camera (with occlusion handling) |
| `src/game/bot.ts` | Bot FSM: harvest / raid / return / defend / wander |
| `src/game/hud.ts`, `textSprite.ts` | DOM HUD and in-world billboard labels |
| `tools/verify.mjs`, `tools/scenario.mjs` | Headless Chrome smoke tests / scripted gameplay screenshots |

## Notes

- Assets are served from `public/assets/` so loaders use the exact
  `/assets/<file>` paths.
- Several Sketchfab rigs misreport their skinned bounds before the first
  render; `AssetManager.calibrate()` renders throwaway instances at startup
  and converges scale/offset corrections empirically, and the bat is baked to
  a static mesh since its bind matrices double-apply ancestor transforms.
