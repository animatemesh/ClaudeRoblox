import * as THREE from 'three';
import { AssetManager } from './assets';
import { World } from './world';
import { HomeBase } from './base';
import { Conveyor } from './conveyor';
import { Entity } from './character';
import { PlayerController } from './player';
import { BotController, type BotGameApi } from './bot';
import { Hud } from './hud';
import { BrainrotItem } from './items';
import { FloatingText, MoneyBurst, type Effect } from './textSprite';
import { formatMoney } from './catalog';
import { SoundFx } from './audio';
import { pushCircleOutOfRect } from './world';
import {
  BAT_ARC_DEG, BAT_RANGE, BASE_SLOTS, BLOCKADE_BUTTON_RADIUS, BOT_SPEED,
  BOT_STARTING_MONEY, COLLECT_BUTTON_RADIUS, COLLECT_MIN_AMOUNT, ENTITY_RADIUS,
  PICKUP_RADIUS, PLAYER_SPEED, STARTING_MONEY,
} from './config';

const BOT_ROSTER = [
  { name: 'xX_Sigma_Xx', color: 0xff5a5a, hue: 40 },
  { name: 'GyattLord99', color: 0x5aa9ff, hue: 130 },
  { name: 'RizzMaster', color: 0xffd24d, hue: 200 },
  { name: 'NoobSlayer_7', color: 0xb066ff, hue: 270 },
  { name: 'SkibidiKing', color: 0x4dffa6, hue: 320 },
];

export class Game implements BotGameApi {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  world: World;
  assets: AssetManager;
  hud: Hud;
  conveyor!: Conveyor;
  entities: Entity[] = [];
  bases: HomeBase[] = [];
  player!: Entity;
  private playerCtl!: PlayerController;
  private bots: BotController[] = [];
  private items = new Set<BrainrotItem>();
  private groundItems: BrainrotItem[] = [];
  private effects: Effect[] = [];
  private clock = new THREE.Clock();
  private elapsed = 0;
  private hudTimer = 0;
  private audio = new SoundFx();
  private wasSwinging = new Map<number, boolean>();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, 18, 30);

    this.world = new World();
    this.assets = new AssetManager();
    this.hud = new Hud('#app-hud');

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  async start(): Promise<void> {
    await this.assets.loadAll((label, done, total) => this.hud.setLoading(label, done, total));
    this.assets.calibrate(this.renderer);

    const totalEntities = 1 + BOT_ROSTER.length;
    this.world.build(this.assets, totalEntities);
    const layout = this.world.layout;

    // ---- bases & entities ----
    // Player takes the first base on the +X side; bots fill the rest.
    const playerBase = new HomeBase(layout.bases[0], 0x33ff66, this.world.scene);
    this.bases.push(playerBase);
    this.player = new Entity({
      name: 'You',
      isPlayer: true,
      assets: this.assets,
      world: this.world,
      speed: PLAYER_SPEED,
      money: STARTING_MONEY,
      color: 0x33ff66,
    });
    playerBase.setOwner(this.player);
    this.player.home = playerBase;
    this.player.position.copy(layout.bases[0].spawn);
    this.world.scene.add(this.player.root);
    this.entities.push(this.player);

    for (let i = 0; i < BOT_ROSTER.length; i++) {
      const def = BOT_ROSTER[i];
      const zone = layout.bases[i + 1];
      const base = new HomeBase(zone, def.color, this.world.scene);
      this.bases.push(base);
      const bot = new Entity({
        name: def.name,
        isPlayer: false,
        assets: this.assets,
        world: this.world,
        speed: BOT_SPEED * (0.92 + Math.random() * 0.16),
        money: BOT_STARTING_MONEY,
        color: def.color,
        hueShift: def.hue,
      });
      base.setOwner(bot);
      bot.home = base;
      bot.position.copy(zone.spawn);
      this.world.scene.add(bot.root);
      this.entities.push(bot);
      this.bots.push(new BotController(bot, this));
    }

    // ---- conveyor ----
    this.conveyor = new Conveyor(this.assets, this.world.scene, layout);
    this.conveyor.onSpawn = (item) => {
      this.items.add(item);
      if (item.rarity.incomePerSec >= 35) {
        this.hud.notify(`✨ ${item.rarity.label} ${item.def.name} just hit the conveyor!`, item.rarity.color);
      }
    };
    this.conveyor.onDespawn = (item) => this.items.delete(item);

    // ---- controls ----
    this.playerCtl = new PlayerController(this.player, this.camera, this.renderer.domElement);
    this.playerCtl.occluders = this.world.mapMeshes;

    this.hud.hideLoading();
    this.hud.notify('Buy brainrots off the red carpet (E), store them in your base, and STEAL from everyone else!', '#ffd24d');

    this.clock.start();
    this.renderer.setAnimationLoop(() => this.tick());

    // headless-testing probe
    (window as unknown as Record<string, unknown>).__game = this;
    (window as unknown as Record<string, unknown>).__gameDebug = () => ({
      entities: this.entities.map((e) => ({
        name: e.name,
        money: Math.floor(e.money),
        pos: e.position.toArray().map((v) => +v.toFixed(1)),
        carrying: e.carried?.def.name ?? null,
        stolen: !!e.carried?.stolenFromBase,
        stored: e.home.storedCount(),
        incomePerSec: e.home.incomePerSec(),
      })),
      beltItems: this.conveyor.items.length,
      groundItems: this.groundItems.length,
      totalItems: this.items.size,
      items: [...this.items].map((i) => ({
        name: i.def.name,
        rarity: i.rarity.id,
        state: i.state,
        pos: i.root.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(1)),
        carrier: i.carrier?.name ?? null,
        storedIn: i.storedIn?.owner.name ?? null,
      })),
      layout: {
        carpet: this.world.layout.carpetRect,
        bases: this.world.layout.bases.map((b) => b.rect),
      },
    });
  }

  // ============================================================== game rules

  /** Purchase an item off the conveyor (player & bots). */
  tryBuy(buyer: Entity, item: BrainrotItem): boolean {
    if (item.state !== 'conveyor' || buyer.carried) return false;
    if (buyer.money < item.rarity.price) return false;
    buyer.money -= item.rarity.price;
    this.conveyor.take(item);
    this.world.scene.remove(item.root);
    buyer.pickUp(item);
    if (buyer.isPlayer) {
      this.hud.notify(`Bought ${item.def.name} for ${formatMoney(item.rarity.price)} — take it home!`, item.rarity.color);
    } else if (item.rarity.incomePerSec >= 35) {
      this.hud.notify(`${buyer.name} bought the ${item.rarity.label} ${item.def.name}!`, item.rarity.color);
    }
    return true;
  }

  /** Steal a stored item out of someone else's base (player & bots). */
  trySteal(thief: Entity, item: BrainrotItem): boolean {
    if (item.state !== 'stored' || thief.carried) return false;
    const base = item.storedIn;
    if (!base || base.owner === thief) return false;
    base.stealFrom(item);
    this.world.scene.remove(item.root);
    thief.pickUp(item);
    const victim = base.owner;
    if (victim.isPlayer) this.audio.alarm();
    this.hud.notify(
      thief.isPlayer
        ? `🦹 You grabbed ${victim.name}'s ${item.def.name}! RUN!`
        : `🚨 ${thief.name} is stealing ${victim.isPlayer ? 'YOUR' : victim.name + "'s"} ${item.def.name}!`,
      item.rarity.color
    );
    return true;
  }

  /** Free pickup of an item lying on the ground (dropped, never stolen). */
  private tryPickupGround(who: Entity, item: BrainrotItem): boolean {
    if (item.state !== 'ground' || who.carried) return false;
    const i = this.groundItems.indexOf(item);
    if (i >= 0) this.groundItems.splice(i, 1);
    this.world.scene.remove(item.root);
    who.pickUp(item);
    return true;
  }

  /** Drop rules when a carrier gets batted. */
  private dropCarried(victim: Entity, attacker: Entity): void {
    const item = victim.releaseCarried();
    if (!item) return;
    this.world.scene.add(item.root);

    if (item.stolenFromBase) {
      // THE RETURN RULE: stolen goods fly straight back to their home slot.
      const home = item.stolenFromBase;
      const target = home.reservedSlotPosition(item);
      item.startReturnFlight(target, () => {
        home.acceptReturned(item);
        this.hud.notify(`🏠 ${item.def.name} returned home to ${home.owner.name}!`, item.rarity.color);
      });
      this.hud.notify(
        attacker.isPlayer
          ? `💥 You batted ${victim.name} — the ${item.def.name} is flying home!`
          : `💥 ${attacker.name} batted ${victim.name} and saved the ${item.def.name}!`,
        '#ff8c4d'
      );
    } else {
      // A belt purchase just spills onto the floor, free for anyone.
      item.state = 'ground';
      const pos = victim.position.clone();
      pos.x += (Math.random() - 0.5) * 1.6;
      pos.z += (Math.random() - 0.5) * 1.6;
      pos.y = this.world.groundHeightAt(pos.x, pos.z);
      item.root.position.copy(pos);
      item.refreshLabel();
      this.groundItems.push(item);
      this.hud.notify(`💥 ${victim.name} dropped a ${item.def.name}!`, '#ff8c4d');
    }
  }

  /** Auto-deposit: walking into your own base with a carried brainrot stores it. */
  private handleDeposits(): void {
    for (const e of this.entities) {
      const item = e.carried;
      if (!item) continue;
      const zone = e.home.zone;
      if (e.position.x < zone.rect.minX - 0.5 || e.position.x > zone.rect.maxX + 0.5) continue;
      if (e.position.z < zone.rect.minZ - 0.5 || e.position.z > zone.rect.maxZ + 0.5) continue;
      if (!e.home.hasFreeSlot()) continue;

      const stolenFrom = item.stolenFromBase;
      if (stolenFrom) stolenFrom.releaseReservation(item);
      e.releaseCarried();
      this.world.scene.add(item.root);
      e.home.deposit(item);
      this.audio.deposit(e.position.distanceTo(this.player.position));
      if (e.isPlayer) {
        this.hud.notify(`🏦 ${item.def.name} stored! +${formatMoney(item.rarity.incomePerSec)}/s — step its button to collect`, item.rarity.color);
      } else if (stolenFrom?.owner.isPlayer) {
        this.hud.notify(`😡 ${e.name} got away with YOUR ${item.def.name}!`, '#ff5a5a');
      }
    }
  }

  /** Solid base walls (+ active laser blockades) push characters out. */
  private resolveWorldCollisions(): void {
    for (const e of this.entities) {
      for (const base of this.bases) {
        for (const wall of base.zone.walls) {
          pushCircleOutOfRect(e.position, ENTITY_RADIUS, wall);
        }
        if (base.blockadeActive && base.owner !== e) {
          pushCircleOutOfRect(e.position, ENTITY_RADIUS, base.zone.laser);
        }
      }
    }
  }

  /** Step-on buttons: collect a slot's printed money / raise the blockade. */
  private handleButtons(): void {
    for (const base of this.bases) {
      const owner = base.owner;
      if (!owner) continue;

      // collect buttons (owner only)
      for (const slot of base.slots) {
        if (slot.accrued < COLLECT_MIN_AMOUNT) continue;
        const dx = owner.position.x - slot.buttonPos.x;
        const dz = owner.position.z - slot.buttonPos.z;
        if (dx * dx + dz * dz > COLLECT_BUTTON_RADIUS * COLLECT_BUTTON_RADIUS) continue;
        const amount = base.collectSlot(slot);
        if (amount <= 0) continue;
        owner.money += amount;
        const at = slot.position.clone();
        at.y += 0.6;
        this.effects.push(new MoneyBurst(at, this.world.scene));
        this.effects.push(new FloatingText(`+${formatMoney(amount)}`, '#7CFC7C', at, this.world.scene, 0.7));
        this.audio.coins(owner.position.distanceTo(this.player.position));
      }

      // blockade button (owner only)
      if (base.blockadeReady) {
        const dx = owner.position.x - base.blockadeButtonPos.x;
        const dz = owner.position.z - base.blockadeButtonPos.z;
        if (dx * dx + dz * dz <= BLOCKADE_BUTTON_RADIUS * BLOCKADE_BUTTON_RADIUS) {
          if (base.activateBlockade()) {
            this.audio.laserOn(owner.position.distanceTo(this.player.position));
            if (owner.isPlayer) {
              this.hud.notify('🔒 Blockade up! Lasers are guarding your entrance.', '#ff6666');
            } else if (base.zone.center.distanceTo(this.player.position) < 25) {
              this.hud.notify(`🔒 ${owner.name} locked their base down!`, '#ff8a8a');
            }
          }
        }
      }
    }
  }

  /** Bat impact resolution for every swinging entity. */
  private handleCombat(): void {
    const arcCos = Math.cos(THREE.MathUtils.degToRad(BAT_ARC_DEG / 2));
    for (const attacker of this.entities) {
      if (!attacker.consumeSwingImpact()) continue;
      const facing = attacker.facingDirection();
      for (const victim of this.entities) {
        if (victim === attacker) continue;
        const to = victim.position.clone().sub(attacker.position);
        to.y = 0;
        const dist = to.length();
        if (dist > BAT_RANGE) continue;
        if (dist > 0.01 && to.clone().normalize().dot(facing) < arcCos) continue;
        victim.applyHit(attacker.position);
        this.audio.hit(victim.position.distanceTo(this.player.position));
        if (victim.carried) this.dropCarried(victim, attacker);
      }
    }
  }

  /** Keep characters from standing inside each other. */
  private separateEntities(): void {
    const minDist = ENTITY_RADIUS * 2;
    for (let i = 0; i < this.entities.length; i++) {
      for (let j = i + 1; j < this.entities.length; j++) {
        const a = this.entities[i];
        const b = this.entities[j];
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.0001 && d < minDist) {
          const push = (minDist - d) / 2;
          const nx = dx / d;
          const nz = dz / d;
          a.position.x -= nx * push;
          a.position.z -= nz * push;
          b.position.x += nx * push;
          b.position.z += nz * push;
        }
      }
    }
  }

  /** Bots hoover up free dropped loot they walk past. */
  private botsGrabGroundLoot(): void {
    for (const bot of this.entities) {
      if (bot.isPlayer || bot.carried) continue;
      for (const item of this.groundItems) {
        if (item.state !== 'ground') continue;
        if (bot.position.distanceTo(item.root.position) < PICKUP_RADIUS * 0.8) {
          this.tryPickupGround(bot, item);
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------- player intent

  private interactTarget(): { kind: 'buy' | 'steal' | 'grab'; item: BrainrotItem; label: string } | null {
    if (this.player.carried) return null;
    const p = this.player.position;

    const beltItem = this.conveyor.nearestTo(p, PICKUP_RADIUS);
    if (beltItem) {
      const afford = this.player.money >= beltItem.rarity.price;
      return {
        kind: 'buy',
        item: beltItem,
        label: afford
          ? `[E] Buy ${beltItem.def.name} — ${formatMoney(beltItem.rarity.price)}`
          : `Need ${formatMoney(beltItem.rarity.price)} for ${beltItem.def.name}`,
      };
    }

    for (const item of this.groundItems) {
      if (item.state === 'ground' && item.root.position.distanceTo(p) < PICKUP_RADIUS) {
        return { kind: 'grab', item, label: `[E] Grab ${item.def.name} (free!)` };
      }
    }

    for (const base of this.bases) {
      if (base.owner === this.player) continue;
      for (const slot of base.slots) {
        if (slot.item && slot.position.distanceTo(p) < PICKUP_RADIUS) {
          return {
            kind: 'steal',
            item: slot.item,
            label: `[E] STEAL ${base.owner.name}'s ${slot.item.def.name} (${formatMoney(slot.item.rarity.incomePerSec)}/s)`,
          };
        }
      }
    }
    return null;
  }

  // ==================================================================== loop

  private tick(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    // controllers
    this.playerCtl.update(dt);
    if (this.playerCtl.consumeSwing()) this.player.startSwing();
    const wantsInteract = this.playerCtl.consumeInteract();

    for (const bot of this.bots) bot.update(dt);

    // physics & animation
    for (const e of this.entities) e.update(dt);
    this.separateEntities();
    this.resolveWorldCollisions();

    // swing whooshes (any entity that just started a swing)
    for (const e of this.entities) {
      const was = this.wasSwinging.get(e.id) ?? false;
      if (e.isSwinging && !was) {
        this.audio.swing(e.position.distanceTo(this.player.position));
      }
      this.wasSwinging.set(e.id, e.isSwinging);
    }

    // world systems
    this.elapsed += dt;
    this.conveyor.update(dt);
    for (const item of this.items) item.update(dt);
    for (const base of this.bases) {
      const expired = base.update(dt, this.elapsed);
      if (expired) {
        this.audio.laserOff(base.zone.center.distanceTo(this.player.position));
      }
    }

    // rules
    this.handleCombat();
    this.handleDeposits();
    this.handleButtons();
    this.botsGrabGroundLoot();

    // player interaction
    const target = this.interactTarget();
    if (wantsInteract && target) {
      if (target.kind === 'buy') this.tryBuy(this.player, target.item);
      else if (target.kind === 'steal') this.trySteal(this.player, target.item);
      else this.tryPickupGround(this.player, target.item);
    }

    // effects
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (!this.effects[i].update(dt)) this.effects.splice(i, 1);
    }

    // HUD (throttled)
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.2;
      const home = this.player.home;
      this.hud.setMoney(this.player.money, home.incomePerSec(), home.storedCount(), BASE_SLOTS);
      this.hud.setBlockade(
        home.blockadeActive ? 'active' : (home.blockadeReady ? 'ready' : 'cooldown'),
        home.blockadeTimeLeft
      );
      this.hud.updateLeaderboard(this.entities);
      this.hud.setPointerLocked(this.playerCtl.pointerLocked);
      this.hud.setPrompt(this.player.carried
        ? null
        : (target ? target.label : null));
      const carried = this.player.carried;
      this.hud.setCarry(
        carried
          ? (carried.stolenFromBase
            ? `🚨 Carrying STOLEN ${carried.def.name} — get home before you're batted!`
            : `📦 Carrying ${carried.def.name} — walk into your base to store it`)
          : null,
        !!carried?.stolenFromBase
      );
      for (const e of this.entities) {
        e.setNameplateSuffix(e.carried ? '📦' : (e.isStunned ? '💫' : ''));
      }
    }

    this.renderer.render(this.world.scene, this.camera);
  }
}
