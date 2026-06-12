import * as THREE from 'three';
import type { AssetManager } from './assets';
import type { WorldLayout } from './world';
import { BrainrotItem } from './items';
import { rollBrainrot, rollRarity } from './catalog';
import { CONVEYOR_MAX_ITEMS, CONVEYOR_SPAWN_INTERVAL, CONVEYOR_SPEED } from './config';

/**
 * The central red-carpet conveyor: continually spawns random brainrots at the
 * start of the carpet and marches them down its length. Anyone can walk up
 * and buy them off the belt before they reach the end and despawn.
 */
export class Conveyor {
  items: BrainrotItem[] = [];
  private spawnTimer = 1.0; // first spawn comes quickly
  private assets: AssetManager;
  private scene: THREE.Scene;
  private layout: WorldLayout;
  private direction: THREE.Vector3;
  private beltLength: number;
  onSpawn: ((item: BrainrotItem) => void) | null = null;
  onDespawn: ((item: BrainrotItem) => void) | null = null;

  constructor(assets: AssetManager, scene: THREE.Scene, layout: WorldLayout) {
    this.assets = assets;
    this.scene = scene;
    this.layout = layout;
    this.direction = layout.conveyorEnd.clone().sub(layout.conveyorStart).normalize();
    this.beltLength = layout.conveyorEnd.distanceTo(layout.conveyorStart);
  }

  update(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.items.length < CONVEYOR_MAX_ITEMS) {
      this.spawnOne();
      this.spawnTimer = CONVEYOR_SPAWN_INTERVAL * (0.75 + Math.random() * 0.5);
    }

    const step = this.direction.clone().multiplyScalar(CONVEYOR_SPEED * dt);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (item.state !== 'conveyor') {
        // Someone bought/grabbed it: no longer the belt's problem.
        this.items.splice(i, 1);
        continue;
      }
      item.root.position.add(step);
      const traveled = item.root.position.clone().sub(this.layout.conveyorStart).dot(this.direction);
      if (traveled >= this.beltLength) {
        this.items.splice(i, 1);
        this.onDespawn?.(item);
        item.dispose();
      }
    }
  }

  private spawnOne(): void {
    const def = rollBrainrot();
    const rarity = rollRarity();
    const item = new BrainrotItem(this.assets, def, rarity);
    item.state = 'conveyor';
    item.root.position.copy(this.layout.conveyorStart);
    // face down the belt
    item.root.lookAt(this.layout.conveyorEnd.clone().setY(this.layout.conveyorStart.y));
    this.scene.add(item.root);
    item.refreshLabel();
    this.items.push(item);
    this.onSpawn?.(item);
  }

  /** Claim an item off the belt (buyer pays elsewhere). */
  take(item: BrainrotItem): void {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
  }

  /** Nearest purchasable item to a world position, within maxDist. */
  nearestTo(pos: THREE.Vector3, maxDist: number): BrainrotItem | null {
    let best: BrainrotItem | null = null;
    let bestD = maxDist;
    for (const item of this.items) {
      const d = item.root.position.distanceTo(pos);
      if (d < bestD) {
        bestD = d;
        best = item;
      }
    }
    return best;
  }
}
