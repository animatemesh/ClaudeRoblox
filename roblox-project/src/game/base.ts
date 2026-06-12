import * as THREE from 'three';
import type { BaseZoneLayout } from './world';
import type { BrainrotItem } from './items';
import type { Entity } from './character';
import {
  BASE_SLOT_COLS, BASE_SLOT_ROWS, BLOCKADE_COOLDOWN, BLOCKADE_DURATION,
  COLLECT_MIN_AMOUNT,
} from './config';
import { TextSprite } from './textSprite';
import { formatMoney } from './catalog';

interface Slot {
  position: THREE.Vector3;       // where the brainrot stands
  item: BrainrotItem | null;
  /** A thief is running with this slot's item; the slot stays reserved so the
   *  item can fly straight back if the thief gets hit. */
  reservedFor: BrainrotItem | null;
  pedestal: THREE.Mesh;
  /** money printed by the stored brainrot, waiting to be collected */
  accrued: number;
  button: THREE.Mesh;            // step-on collect button
  buttonPos: THREE.Vector3;
  accruedLabel: TextSprite;
}

/**
 * One player's (or bot's) home base building: a storage grid of brainrot
 * pedestals. Stored brainrots print money into their slot; the owner collects
 * by stepping on the button next to each pedestal. A blockade button raises a
 * laser wall across the open front to keep raiders out.
 */
export class HomeBase {
  readonly zone: BaseZoneLayout;
  readonly color: THREE.Color;
  owner!: Entity;
  slots: Slot[] = [];

  // blockade state
  blockadeActive = false;
  private blockadeTimer = 0;
  private blockadeCooldown = 0;
  blockadeButtonPos: THREE.Vector3;
  private blockadeButton: THREE.Mesh;
  private laserBeams: THREE.Mesh[] = [];
  private laserGroup: THREE.Group;

  private sign: TextSprite;
  private labelTimer = 0;

  constructor(zone: BaseZoneLayout, color: number, scene: THREE.Scene) {
    this.zone = zone;
    this.color = new THREE.Color(color);

    // Tinted translucent interior floor so ownership reads at a glance.
    const w = zone.rect.maxX - zone.rect.minX;
    const d = zone.rect.maxZ - zone.rect.minZ;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(zone.center.x, zone.floorY + 0.03, zone.center.z);
    scene.add(floor);

    // ---- storage grid: rows recede toward the back wall, columns span z ----
    const pedGeo = new THREE.CylinderGeometry(0.5, 0.58, 0.18, 20);
    const pedMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 });
    const btnGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.08, 20);

    // entrance is at the carpet-facing edge; back is the opposite edge
    const entranceX = zone.side === 1 ? zone.rect.minX : zone.rect.maxX;
    const backX = zone.side === 1 ? zone.rect.maxX : zone.rect.minX;
    for (let r = 0; r < BASE_SLOT_ROWS; r++) {
      for (let c = 0; c < BASE_SLOT_COLS; c++) {
        const depthFrac = 0.60 + r * 0.28; // 60% and 88% of the way to the back
        const x = entranceX + (backX - entranceX) * depthFrac;
        const fz = 0.12 + (c / Math.max(1, BASE_SLOT_COLS - 1)) * 0.76;
        const z = zone.rect.minZ + (zone.rect.maxZ - zone.rect.minZ) * fz;

        const pedestal = new THREE.Mesh(pedGeo, pedMat);
        pedestal.castShadow = true;
        pedestal.receiveShadow = true;
        pedestal.position.set(x, zone.floorY + 0.09, z);
        scene.add(pedestal);

        // collect button sits in front of the pedestal (toward the entrance)
        const bx = x - zone.side * 1.35;
        const button = new THREE.Mesh(
          btnGeo,
          new THREE.MeshStandardMaterial({
            color: 0x2a8f3c,
            emissive: 0x1f7a30,
            emissiveIntensity: 0.15,
            roughness: 0.4,
          })
        );
        button.position.set(bx, zone.floorY + 0.04, z);
        button.receiveShadow = true;
        scene.add(button);

        const accruedLabel = new TextSprite('', {
          color: '#7cfc7c',
          worldHeight: 0.3,
          fontSize: 40,
          background: 'rgba(0,0,0,0.45)',
        });
        accruedLabel.position.set(bx, zone.floorY + 0.9, z);
        accruedLabel.visible = false;
        scene.add(accruedLabel);

        this.slots.push({
          position: new THREE.Vector3(x, zone.floorY + 0.18, z),
          item: null,
          reservedFor: null,
          pedestal,
          accrued: 0,
          button,
          buttonPos: new THREE.Vector3(bx, zone.floorY, z),
          accruedLabel,
        });
      }
    }

    // ---- blockade button just inside the entrance, off to one side ----
    this.blockadeButtonPos = new THREE.Vector3(
      zone.entrance.x + zone.side * 0.8,
      zone.floorY,
      zone.rect.minZ + 1.6
    );
    this.blockadeButton = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 0.1, 20),
      new THREE.MeshStandardMaterial({
        color: 0xb03030,
        emissive: 0x801818,
        emissiveIntensity: 0.5,
        roughness: 0.4,
      })
    );
    this.blockadeButton.position.set(this.blockadeButtonPos.x, zone.floorY + 0.05, this.blockadeButtonPos.z);
    scene.add(this.blockadeButton);
    const blockadeLabel = new TextSprite('🔒 BLOCKADE', {
      color: '#ff6666',
      worldHeight: 0.3,
      fontSize: 38,
      background: 'rgba(0,0,0,0.45)',
    });
    blockadeLabel.position.set(this.blockadeButtonPos.x, zone.floorY + 1.0, this.blockadeButtonPos.z);
    scene.add(blockadeLabel);

    // ---- laser wall across the open front ----
    this.laserGroup = new THREE.Group();
    const L = zone.laser;
    const lx = (L.minX + L.maxX) / 2;
    const length = L.maxZ - L.minZ;
    const beamGeo = new THREE.CylinderGeometry(0.06, 0.06, length, 8);
    for (let i = 0; i < 5; i++) {
      const beam = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.85 })
      );
      beam.rotation.x = Math.PI / 2; // align along z
      beam.position.set(lx, zone.floorY + 0.4 + i * 0.62, (L.minZ + L.maxZ) / 2);
      this.laserGroup.add(beam);
      this.laserBeams.push(beam);
    }
    const postGeo = new THREE.CylinderGeometry(0.12, 0.16, 3.4, 10);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x222230, roughness: 0.35, metalness: 0.7 });
    for (const zEnd of [L.minZ, L.maxZ]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(lx, zone.floorY + 1.7, zEnd);
      post.castShadow = true;
      this.laserGroup.add(post);
    }
    this.laserGroup.visible = true; // posts always visible
    this.setBeamsVisible(false);
    scene.add(this.laserGroup);

    this.sign = new TextSprite('Base', { worldHeight: 1.0, fontSize: 52, background: 'rgba(0,0,0,0.4)' });
    this.sign.position.set(zone.center.x, zone.floorY + 7.0, zone.center.z);
    scene.add(this.sign);
  }

  private setBeamsVisible(v: boolean): void {
    for (const b of this.laserBeams) b.visible = v;
  }

  setOwner(owner: Entity): void {
    this.owner = owner;
    this.refreshSign();
  }

  refreshSign(): void {
    const income = this.incomePerSec();
    this.sign.setText(`${this.owner?.name ?? '???'}  •  ${formatMoney(income)}/s`);
  }

  incomePerSec(): number {
    let total = 0;
    for (const s of this.slots) if (s.item) total += s.item.rarity.incomePerSec;
    return total;
  }

  storedCount(): number {
    return this.slots.reduce((n, s) => n + (s.item ? 1 : 0), 0);
  }

  hasFreeSlot(): boolean {
    return this.slots.some((s) => !s.item && !s.reservedFor);
  }

  totalAccrued(): number {
    return this.slots.reduce((n, s) => n + s.accrued, 0);
  }

  /** Buttons currently worth stepping on (for bots and prompts). */
  pendingButtons(): { position: THREE.Vector3; amount: number }[] {
    return this.slots
      .filter((s) => s.accrued >= COLLECT_MIN_AMOUNT)
      .map((s) => ({ position: s.buttonPos, amount: s.accrued }));
  }

  /** Highest-value stored item (what raiders go for). */
  bestStoredItem(): BrainrotItem | null {
    let best: BrainrotItem | null = null;
    for (const s of this.slots) {
      if (s.item && (!best || s.item.rarity.incomePerSec > best.rarity.incomePerSec)) best = s.item;
    }
    return best;
  }

  /** Place an item into a specific slot index (or the first free one). */
  deposit(item: BrainrotItem, slotIndex = -1): boolean {
    let idx = slotIndex;
    if (idx < 0) idx = this.slots.findIndex((s) => !s.item && !s.reservedFor);
    if (idx < 0) return false;
    const slot = this.slots[idx];
    slot.item = item;
    slot.reservedFor = null;
    item.state = 'stored';
    item.storedIn = this;
    item.storedSlot = idx;
    item.carrier = null;
    item.stolenFromBase = null;
    item.stolenFromSlot = -1;
    item.root.position.copy(slot.position);
    item.root.rotation.set(0, this.zone.side === 1 ? -Math.PI / 2 : Math.PI / 2, 0); // face the entrance
    item.refreshLabel();
    this.refreshSign();
    return true;
  }

  /** A thief grabs a stored item: slot becomes reserved until resolved. */
  stealFrom(item: BrainrotItem): void {
    const idx = item.storedSlot;
    if (idx < 0 || this.slots[idx]?.item !== item) return;
    const slot = this.slots[idx];
    slot.item = null;
    slot.reservedFor = item;
    item.storedIn = null;
    item.stolenFromBase = this;
    item.stolenFromSlot = idx;
    item.storedSlot = -1;
    this.refreshSign();
  }

  /** The theft fully succeeded elsewhere (or item destroyed): free the hold. */
  releaseReservation(item: BrainrotItem): void {
    for (const s of this.slots) {
      if (s.reservedFor === item) s.reservedFor = null;
    }
  }

  /** Landing spot for an item flying back after its thief was batted. */
  reservedSlotPosition(item: BrainrotItem): THREE.Vector3 {
    for (const s of this.slots) {
      if (s.reservedFor === item) return s.position.clone();
    }
    const free = this.slots.find((s) => !s.item && !s.reservedFor);
    return free ? free.position.clone() : this.zone.center.clone().setY(this.zone.floorY + 0.3);
  }

  /** Re-seat a returned item into its reserved (or any free) slot. */
  acceptReturned(item: BrainrotItem): void {
    let idx = this.slots.findIndex((s) => s.reservedFor === item);
    if (idx < 0) idx = this.slots.findIndex((s) => !s.item && !s.reservedFor);
    if (idx < 0) idx = 0;
    this.slots[idx].reservedFor = null;
    this.deposit(item, this.slots[idx].item ? -1 : idx);
  }

  /** Collect a slot's accrued money. Returns the amount (0 if none). */
  collectSlot(slot: Slot): number {
    if (slot.accrued < COLLECT_MIN_AMOUNT) return 0;
    const amount = Math.floor(slot.accrued);
    slot.accrued -= amount;
    return amount;
  }

  /** Try to raise the laser blockade. Returns true if it activated. */
  activateBlockade(): boolean {
    if (this.blockadeActive || this.blockadeCooldown > 0) return false;
    this.blockadeActive = true;
    this.blockadeTimer = BLOCKADE_DURATION;
    this.setBeamsVisible(true);
    return true;
  }

  get blockadeReady(): boolean {
    return !this.blockadeActive && this.blockadeCooldown <= 0;
  }

  /** Seconds left, for HUD display. */
  get blockadeTimeLeft(): number {
    return this.blockadeActive ? this.blockadeTimer : 0;
  }

  /** Accrue money into slots, run blockade timers, animate FX. Returns true
   *  the frame the blockade shuts off (so the game can play a sound). */
  update(dt: number, time: number): boolean {
    for (const s of this.slots) {
      if (s.item) s.accrued += s.item.rarity.incomePerSec * dt;
    }

    // throttled accrued labels + button glow
    this.labelTimer -= dt;
    if (this.labelTimer <= 0) {
      this.labelTimer = 0.5;
      for (const s of this.slots) {
        const show = s.accrued >= COLLECT_MIN_AMOUNT;
        s.accruedLabel.visible = show;
        if (show) s.accruedLabel.setText(formatMoney(Math.floor(s.accrued)));
        const mat = s.button.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = show ? 0.7 + Math.sin(time * 5) * 0.3 : 0.15;
      }
      const bMat = this.blockadeButton.material as THREE.MeshStandardMaterial;
      bMat.emissiveIntensity = this.blockadeReady ? 0.7 + Math.sin(time * 4) * 0.3 : 0.12;
    }

    // laser pulse + timers
    let justExpired = false;
    if (this.blockadeActive) {
      this.blockadeTimer -= dt;
      const pulse = 0.65 + Math.sin(time * 12) * 0.3;
      for (const b of this.laserBeams) {
        (b.material as THREE.MeshBasicMaterial).opacity = pulse;
      }
      if (this.blockadeTimer <= 0) {
        this.blockadeActive = false;
        this.blockadeCooldown = BLOCKADE_COOLDOWN;
        this.setBeamsVisible(false);
        justExpired = true;
      }
    } else if (this.blockadeCooldown > 0) {
      this.blockadeCooldown -= dt;
    }
    return justExpired;
  }
}
