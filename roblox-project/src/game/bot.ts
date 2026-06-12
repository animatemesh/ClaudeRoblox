import * as THREE from 'three';
import type { Entity } from './character';
import type { BrainrotItem } from './items';
import type { HomeBase } from './base';
import type { Conveyor } from './conveyor';
import type { World } from './world';
import { rectContains } from './world';
import {
  BOT_ATTACK_RANGE, BOT_CHASE_LEASH, BOT_COLLECT_THRESHOLD, BOT_DEFEND_RADIUS,
  BOT_THINK_INTERVAL, PICKUP_RADIUS,
} from './config';

/** Surface the bot AI needs from the Game without importing it (no cycles). */
export interface BotGameApi {
  world: World;
  conveyor: Conveyor;
  entities: Entity[];
  /** Attempt to buy an item off the conveyor. True on success. */
  tryBuy(buyer: Entity, item: BrainrotItem): boolean;
  /** Attempt to steal a stored item out of an enemy base. True on success. */
  trySteal(thief: Entity, item: BrainrotItem): boolean;
}

type BotState = 'decide' | 'harvest' | 'raid' | 'return' | 'defend' | 'wander' | 'collect';

/**
 * Player-mimicking AI: harvests the central conveyor, raids unguarded rival
 * bases for high-tier brainrots, sprints stolen goods home, and defends its
 * own base with the bat.
 */
export class BotController {
  readonly entity: Entity;
  private api: BotGameApi;
  private state: BotState = 'decide';
  private thinkTimer = Math.random() * BOT_THINK_INTERVAL;
  private waypoint: THREE.Vector3 | null = null;
  private targetItem: BrainrotItem | null = null;
  private targetEntity: Entity | null = null;
  private wanderTimer = 0;
  private stuckTimer = 0;
  private lastPos = new THREE.Vector3();
  /** personality: 0 = belt camper, 1 = hardened thief */
  private aggression: number;

  constructor(entity: Entity, api: BotGameApi) {
    this.entity = entity;
    this.api = api;
    this.aggression = 0.3 + Math.random() * 0.55;
    this.lastPos.copy(entity.position);
  }

  get home(): HomeBase {
    return this.entity.home;
  }

  update(dt: number): void {
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = BOT_THINK_INTERVAL * (0.8 + Math.random() * 0.4);
      this.think();
    }
    this.act(dt);
    this.detectStuck(dt);
  }

  // ------------------------------------------------------------------ brain

  private think(): void {
    const me = this.entity;

    // Carrying anything? Nothing matters more than getting it home.
    if (me.carried) {
      this.state = 'return';
      this.waypoint = this.home.zone.center.clone();
      return;
    }

    // Defend: anyone in/near my base who isn't me, or anyone running off
    // with something stolen from MY base.
    const intruder = this.findIntruder();
    if (intruder) {
      this.state = 'defend';
      this.targetEntity = intruder;
      return;
    }

    // Cash sitting on my pedestals? Go step the collect buttons.
    if (this.home.totalAccrued() >= BOT_COLLECT_THRESHOLD) {
      this.state = 'collect';
      return;
    }

    // If mid-task and the task is still valid, stay on it.
    if (this.state === 'harvest' && this.targetItem && this.targetItem.state === 'conveyor'
      && me.money >= this.targetItem.rarity.price) return;
    if (this.state === 'raid' && this.targetItem && this.targetItem.state === 'stored'
      && this.targetItem.storedIn && this.targetItem.storedIn !== this.home) return;

    // Choose new work: compare best conveyor buy vs best raid target.
    const buy = this.bestConveyorTarget();
    const raid = this.bestRaidTarget();

    const buyScore = buy ? buy.rarity.incomePerSec * (1 - this.aggression * 0.45) : -1;
    const raidScore = raid ? raid.rarity.incomePerSec * (0.55 + this.aggression) : -1;

    if (raid && this.home.hasFreeSlot() && raidScore >= buyScore && raidScore > 0) {
      this.state = 'raid';
      this.targetItem = raid;
      this.targetEntity = null;
      return;
    }
    if (buy && this.home.hasFreeSlot()) {
      this.state = 'harvest';
      this.targetItem = buy;
      this.targetEntity = null;
      return;
    }

    // Nothing worthwhile: loiter near the conveyor like a real player.
    this.state = 'wander';
    if (this.wanderTimer <= 0) this.pickWanderPoint();
  }

  private findIntruder(): Entity | null {
    const zone = this.home.zone;
    const baseCenter = zone.center;
    let best: Entity | null = null;
    let bestScore = -Infinity;
    for (const other of this.api.entities) {
      if (other === this.entity) continue;
      const carryingMine = other.carried?.stolenFromBase === this.home;
      const inMyBase = rectContains(zone.rect, other.position.x, other.position.z, 1.5);
      const nearMyBase = other.position.distanceTo(baseCenter) < BOT_DEFEND_RADIUS + 6;
      if (carryingMine && other.position.distanceTo(baseCenter) < BOT_CHASE_LEASH) {
        const score = 100 - other.position.distanceTo(this.entity.position);
        if (score > bestScore) { bestScore = score; best = other; }
      } else if (inMyBase && (this.home.storedCount() > 0 || nearMyBase)) {
        const score = 50 - other.position.distanceTo(this.entity.position);
        if (score > bestScore) { bestScore = score; best = other; }
      }
    }
    return best;
  }

  private bestConveyorTarget(): BrainrotItem | null {
    const me = this.entity;
    let best: BrainrotItem | null = null;
    let bestScore = -Infinity;
    for (const item of this.api.conveyor.items) {
      if (item.state !== 'conveyor') continue;
      if (item.rarity.price > me.money) continue;
      const dist = item.root.position.distanceTo(me.position);
      const score = item.rarity.incomePerSec * 3 - dist * 0.25;
      if (score > bestScore) { bestScore = score; best = item; }
    }
    return best;
  }

  private bestRaidTarget(): BrainrotItem | null {
    const me = this.entity;
    let best: BrainrotItem | null = null;
    let bestScore = -Infinity;
    for (const other of this.api.entities) {
      if (other === me) continue;
      const base = other.home;
      if (!base) continue;
      if (base.blockadeActive) continue; // lasers up: not worth the trip
      const item = base.bestStoredItem();
      if (!item) continue;
      // "Unguarded" check: how far is the owner (and other defenders) from home?
      const ownerDist = other.position.distanceTo(base.zone.center);
      const guarded = ownerDist < BOT_DEFEND_RADIUS;
      const myDist = base.zone.center.distanceTo(me.position);
      let score = item.rarity.incomePerSec * (guarded ? 0.25 : 1.4) - myDist * 0.15;
      if (other.isStunned) score += 25; // owner is on the floor: prime time
      if (score > bestScore) { bestScore = score; best = item; }
    }
    return best;
  }

  private pickWanderPoint(): void {
    const L = this.api.world.layout;
    const z = THREE.MathUtils.lerp(L.carpetRect.minZ + 3, L.carpetRect.maxZ - 3, Math.random());
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = (L.carpetRect.maxX + 1.5) * side * (0.6 + Math.random() * 0.6);
    this.waypoint = new THREE.Vector3(x, 0, z);
    this.wanderTimer = 2.5 + Math.random() * 3;
  }

  // ----------------------------------------------------------------- action

  private act(dt: number): void {
    const me = this.entity;
    switch (this.state) {
      case 'harvest': {
        const item = this.targetItem;
        if (!item || item.state !== 'conveyor') {
          this.state = 'decide';
          me.moveIntent.set(0, 0);
          return;
        }
        // Lead the moving item slightly so the bot intercepts instead of chasing.
        const lead = item.root.position.clone();
        lead.z += 1.2;
        this.steerTo(lead);
        if (me.position.distanceTo(item.root.position) < PICKUP_RADIUS) {
          if (this.api.tryBuy(me, item)) {
            this.state = 'return';
            this.waypoint = this.home.zone.center.clone();
          } else {
            this.targetItem = null;
            this.state = 'decide';
          }
        }
        break;
      }

      case 'raid': {
        const item = this.targetItem;
        if (!item || item.state !== 'stored' || !item.storedIn || item.storedIn === this.home) {
          this.state = 'decide';
          me.moveIntent.set(0, 0);
          return;
        }
        const targetBase = item.storedIn;
        if (targetBase.blockadeActive) {
          // lasers went up mid-raid: bail and find something else to do
          this.targetItem = null;
          this.state = 'decide';
          me.moveIntent.set(0, 0);
          return;
        }
        const itemPos = item.root.position;
        const inTargetBase = rectContains(targetBase.zone.rect, me.position.x, me.position.z, 1.0);
        if (!inTargetBase) {
          // route through the entrance so the approach looks deliberate
          const entry = targetBase.zone.entrance.clone();
          if (Math.abs(me.position.z - entry.z) > 3.5 && !inTargetBase) {
            this.steerTo(new THREE.Vector3(entry.x + (targetBase.zone.side === 1 ? -2.5 : 2.5), 0, entry.z));
          } else {
            this.steerTo(entry);
          }
        } else {
          this.steerTo(itemPos);
        }
        if (me.position.distanceTo(itemPos) < PICKUP_RADIUS) {
          if (this.api.trySteal(me, item)) {
            this.state = 'return';
            this.waypoint = this.home.zone.center.clone();
          } else {
            this.targetItem = null;
            this.state = 'decide';
          }
        }
        // Defender swinging at us nearby? Swing back.
        this.opportunisticSwing();
        break;
      }

      case 'return': {
        if (!me.carried) {
          // delivered (game auto-deposits) or we got smacked and lost it
          this.state = 'decide';
          me.moveIntent.set(0, 0);
          return;
        }
        this.waypoint = this.home.zone.center.clone();
        this.steerTo(this.waypoint);
        // fight through interceptors
        this.opportunisticSwing();
        break;
      }

      case 'defend': {
        const target = this.targetEntity;
        if (!target) {
          this.state = 'decide';
          return;
        }
        const targetGone =
          target.position.distanceTo(this.home.zone.center) > BOT_CHASE_LEASH &&
          target.carried?.stolenFromBase !== this.home;
        const stillThreat =
          target.carried?.stolenFromBase === this.home ||
          rectContains(this.home.zone.rect, target.position.x, target.position.z, 2.5);
        if (targetGone || (!stillThreat && me.position.distanceTo(target.position) > 6)) {
          this.targetEntity = null;
          this.state = 'decide';
          return;
        }
        // Threat approaching but not yet inside, blockade ready, and I'm home?
        // Slam the button first — lasers beat bat swings.
        const targetInside = rectContains(this.home.zone.rect, target.position.x, target.position.z, 2.0);
        const meInside = rectContains(this.home.zone.footprint, me.position.x, me.position.z, 0.5);
        if (this.home.blockadeReady && meInside && !targetInside &&
          target.carried?.stolenFromBase !== this.home) {
          this.steerTo(this.home.blockadeButtonPos);
          break; // stepping on the button is handled by the game's proximity check
        }
        this.steerTo(target.position);
        if (me.position.distanceTo(target.position) < BOT_ATTACK_RANGE) {
          const dir = target.position.clone().sub(me.position);
          me.faceToward(Math.atan2(dir.x, dir.z));
          me.startSwing();
        }
        break;
      }

      case 'collect': {
        const pending = this.home.pendingButtons();
        if (pending.length === 0) {
          this.state = 'decide';
          me.moveIntent.set(0, 0);
          return;
        }
        // nearest pending button; the game collects when we stand on it
        let nearest = pending[0];
        let nearestD = Infinity;
        for (const p of pending) {
          const d = p.position.distanceTo(me.position);
          if (d < nearestD) { nearestD = d; nearest = p; }
        }
        this.steerTo(nearest.position);
        break;
      }

      case 'wander': {
        this.wanderTimer -= dt;
        if (!this.waypoint || this.wanderTimer <= 0) this.pickWanderPoint();
        this.steerTo(this.waypoint!);
        if (me.position.distanceTo(this.waypoint!) < 1.5) {
          me.moveIntent.set(0, 0);
        }
        // belt camper: spot a deal while loitering
        const deal = this.api.conveyor.nearestTo(me.position, PICKUP_RADIUS);
        if (deal && deal.rarity.price <= me.money && this.home.hasFreeSlot()) {
          if (this.api.tryBuy(me, deal)) {
            this.state = 'return';
          }
        }
        break;
      }

      case 'decide':
      default:
        me.moveIntent.set(0, 0);
        this.thinkTimer = 0; // decide right away next frame
        break;
    }
  }

  /** Swing at any hostile within reach (thieves, interceptors, defenders). */
  private opportunisticSwing(): void {
    const me = this.entity;
    for (const other of this.api.entities) {
      if (other === me) continue;
      const d = me.position.distanceTo(other.position);
      if (d > BOT_ATTACK_RANGE) continue;
      const isThreat =
        other.carried?.stolenFromBase === this.home ||
        other.isSwinging ||
        (me.carried !== null && d < BOT_ATTACK_RANGE * 0.8);
      if (isThreat) {
        const dir = other.position.clone().sub(me.position);
        me.faceToward(Math.atan2(dir.x, dir.z));
        me.startSwing();
        break;
      }
    }
  }

  private steerTo(target: THREE.Vector3): void {
    const me = this.entity;
    const dx = target.x - me.position.x;
    const dz = target.z - me.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.35) {
      me.moveIntent.set(0, 0);
      return;
    }
    me.moveIntent.set(dx / dist, dz / dist);
  }

  private detectStuck(dt: number): void {
    const me = this.entity;
    const moved = me.position.distanceTo(this.lastPos);
    if (me.moveIntent.lengthSq() > 0.01 && moved < 0.5 * dt * me.speed * 0.5) {
      this.stuckTimer += dt;
    } else {
      this.stuckTimer = 0;
    }
    this.lastPos.copy(me.position);
    if (this.stuckTimer > 1.6) {
      // shove sideways and rethink
      this.stuckTimer = 0;
      me.position.x += (Math.random() - 0.5) * 2;
      me.position.z += (Math.random() - 0.5) * 2;
      this.thinkTimer = 0;
      if (this.state === 'wander') this.pickWanderPoint();
    }
  }
}
