import * as THREE from 'three';
import { BASE_FOOTPRINT, BASE_GAP_FROM_CARPET, MAP_SCALE } from './config';
import type { AssetManager } from './assets';

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function rectContains(r: Rect, x: number, z: number, pad = 0): boolean {
  return x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;
}

export function rectCenter(r: Rect): THREE.Vector3 {
  return new THREE.Vector3((r.minX + r.maxX) / 2, 0, (r.minZ + r.maxZ) / 2);
}

/** Push a circle (pos, radius) out of an axis-aligned rect. True if it moved. */
export function pushCircleOutOfRect(pos: THREE.Vector3, radius: number, r: Rect): boolean {
  const cx = THREE.MathUtils.clamp(pos.x, r.minX, r.maxX);
  const cz = THREE.MathUtils.clamp(pos.z, r.minZ, r.maxZ);
  const dx = pos.x - cx;
  const dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return false;
  if (d2 > 1e-8) {
    // outside the rect but overlapping: push along the contact normal
    const d = Math.sqrt(d2);
    pos.x = cx + (dx / d) * radius;
    pos.z = cz + (dz / d) * radius;
  } else {
    // center is inside the rect: exit through the nearest face
    const exits = [
      { d: pos.x - r.minX + radius, x: r.minX - radius, z: pos.z },
      { d: r.maxX - pos.x + radius, x: r.maxX + radius, z: pos.z },
      { d: pos.z - r.minZ + radius, x: pos.x, z: r.minZ - radius },
      { d: r.maxZ - pos.z + radius, x: pos.x, z: r.maxZ + radius },
    ];
    exits.sort((a, b) => a.d - b.d);
    pos.x = exits[0].x;
    pos.z = exits[0].z;
  }
  return true;
}

export interface BaseZoneLayout {
  /** usable interior (deposits, intruder checks, slot placement) */
  rect: Rect;
  /** the whole building footprint (walk-height region) */
  footprint: Rect;
  floorY: number;
  center: THREE.Vector3;
  entrance: THREE.Vector3;   // point just inside the open front
  spawn: THREE.Vector3;      // owner idle/respawn point outside the front
  side: 1 | -1;              // +1 = +X side of the carpet, -1 = -X side
  /** solid wall slabs (xz rects) for movement collision */
  walls: Rect[];
  /** thin slab across the open front, solid while the blockade is active */
  laser: Rect;
}

export interface WorldLayout {
  mapBounds: Rect;
  carpetRect: Rect;
  carpetY: number;
  groundY: number;
  conveyorStart: THREE.Vector3;
  conveyorEnd: THREE.Vector3;
  bases: BaseZoneLayout[];
}

export class World {
  scene: THREE.Scene;
  layout!: WorldLayout;
  mapMeshes: THREE.Mesh[] = [];

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87c8f0);
    this.scene.fog = new THREE.Fog(0x87c8f0, 60, 160);

    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6a7f5a, 1.0);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    sun.position.set(28, 45, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45;
    sun.shadow.camera.bottom = -45;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    this.scene.add(sun.target);

    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(ambient);
  }

  build(assets: AssetManager, basesNeeded: number): void {
    const map = assets.mapScene;
    map.scale.setScalar(MAP_SCALE);
    map.updateWorldMatrix(true, true);
    map.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.mapMeshes.push(mesh);
      }
    });
    this.scene.add(map);
    map.updateWorldMatrix(true, true);

    // GLTFLoader sanitizes node names ("Map_Material.002_0" -> dots stripped),
    // so match on alphanumerics only.
    const squash = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '');
    const findMesh = (needle: string): THREE.Mesh | null => {
      const n = squash(needle);
      let found: THREE.Mesh | null = null;
      map.traverse((c) => {
        if (found) return;
        const mesh = c as THREE.Mesh;
        if (mesh.isMesh && squash(mesh.name).includes(n)) found = mesh;
      });
      return found;
    };
    const boxOf = (obj: THREE.Object3D): THREE.Box3 => new THREE.Box3().setFromObject(obj);

    const wholeBox = boxOf(map);
    const mapBounds: Rect = {
      minX: wholeBox.min.x + 1.0,
      maxX: wholeBox.max.x - 1.0,
      minZ: wholeBox.min.z + 1.0,
      maxZ: wholeBox.max.z - 1.0,
    };

    // The long thin strip down the middle of the map is the red carpet conveyor.
    const carpetMesh = findMesh('Material.002');
    const carpetBox = carpetMesh ? boxOf(carpetMesh) : new THREE.Box3(
      new THREE.Vector3(-2.4, 0, -30), new THREE.Vector3(2.4, 0.8, 30));
    const carpetRect: Rect = {
      minX: carpetBox.min.x, maxX: carpetBox.max.x,
      minZ: carpetBox.min.z, maxZ: carpetBox.max.z,
    };
    const carpetY = carpetBox.max.y;
    const carpetMidX = (carpetRect.minX + carpetRect.maxX) / 2;

    const margin = 1.5;
    const conveyorStart = new THREE.Vector3(carpetMidX, carpetY, carpetRect.minZ + margin);
    const conveyorEnd = new THREE.Vector3(carpetMidX, carpetY, carpetRect.maxZ - margin);

    const groundY = this.sampleHeight(carpetRect.maxX + 2.5, 0, 20);

    // ---- place the Base1floor buildings flanking the carpet ----
    const tplProbe = assets.makeBase();
    tplProbe.updateWorldMatrix(true, true);
    const tplBox = boxOf(tplProbe);
    const tplSize = new THREE.Vector3();
    tplBox.getSize(tplSize);
    const f = BASE_FOOTPRINT / Math.max(tplSize.x, tplSize.z);

    const bases: BaseZoneLayout[] = [];
    const perSide = Math.ceil(basesNeeded / 2);
    const zSpanMin = carpetRect.minZ + 2.0;
    const zSpanMax = carpetRect.maxZ - 2.0;
    const slotLen = (zSpanMax - zSpanMin) / perSide;
    const wallThickness = 0.9;

    for (const side of [1, -1] as const) {
      for (let i = 0; i < perSide; i++) {
        if (bases.length >= basesNeeded) break;
        const inst = assets.makeBase();
        inst.scale.setScalar(f);
        // The building's open front (name sign side) is +Z; face the carpet.
        inst.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
        const cz = zSpanMin + (i + 0.5) * slotLen;
        const cx = side * (carpetRect.maxX + BASE_GAP_FROM_CARPET + BASE_FOOTPRINT / 2);
        inst.position.set(cx, groundY - tplBox.min.y * f, cz);
        this.scene.add(inst);
        inst.updateWorldMatrix(true, true);
        inst.traverse((c) => {
          const mesh = c as THREE.Mesh;
          if (mesh.isMesh) this.mapMeshes.push(mesh);
        });

        const fb = boxOf(inst);
        const footprint: Rect = { minX: fb.min.x, maxX: fb.max.x, minZ: fb.min.z, maxZ: fb.max.z };
        const rect: Rect = {
          minX: footprint.minX + 1.0, maxX: footprint.maxX - 1.0,
          minZ: footprint.minZ + 1.0, maxZ: footprint.maxZ - 1.0,
        };
        const floorY = this.sampleHeight((fb.min.x + fb.max.x) / 2, cz, groundY + 2.5);

        // Solid walls: back + both sides. The carpet-facing front stays open.
        const walls: Rect[] = side === 1
          ? [
            { minX: footprint.maxX - wallThickness, maxX: footprint.maxX, minZ: footprint.minZ, maxZ: footprint.maxZ },
            { minX: footprint.minX, maxX: footprint.maxX, minZ: footprint.minZ, maxZ: footprint.minZ + wallThickness },
            { minX: footprint.minX, maxX: footprint.maxX, minZ: footprint.maxZ - wallThickness, maxZ: footprint.maxZ },
          ]
          : [
            { minX: footprint.minX, maxX: footprint.minX + wallThickness, minZ: footprint.minZ, maxZ: footprint.maxZ },
            { minX: footprint.minX, maxX: footprint.maxX, minZ: footprint.minZ, maxZ: footprint.minZ + wallThickness },
            { minX: footprint.minX, maxX: footprint.maxX, minZ: footprint.maxZ - wallThickness, maxZ: footprint.maxZ },
          ];

        // Laser blockade slab spans the open front.
        const laser: Rect = side === 1
          ? { minX: footprint.minX, maxX: footprint.minX + 0.5, minZ: footprint.minZ + 1.0, maxZ: footprint.maxZ - 1.0 }
          : { minX: footprint.maxX - 0.5, maxX: footprint.maxX, minZ: footprint.minZ + 1.0, maxZ: footprint.maxZ - 1.0 };

        const center = rectCenter(rect);
        center.y = floorY;
        const entranceX = side === 1 ? footprint.minX + 1.6 : footprint.maxX - 1.6;
        const entrance = new THREE.Vector3(entranceX, floorY, cz);
        const spawnX = side === 1 ? footprint.minX - 2.2 : footprint.maxX + 2.2;
        const spawn = new THREE.Vector3(spawnX, this.sampleHeight(spawnX, cz, 20), cz);

        bases.push({ rect, footprint, floorY, center, entrance, spawn, side, walls, laser });
      }
    }

    this.layout = { mapBounds, carpetRect, carpetY, groundY, conveyorStart, conveyorEnd, bases };
  }

  /** Raycast straight down onto the map + base geometry. */
  sampleHeight(x: number, z: number, fromY = 30): number {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0), 0, fromY + 40);
    const hits = ray.intersectObjects(this.mapMeshes, false);
    if (hits.length > 0) return hits[0].point.y;
    return 0;
  }

  /** Fast analytic walking height: base floors, carpet, or ground. */
  groundHeightAt(x: number, z: number): number {
    for (const b of this.layout.bases) {
      if (rectContains(b.footprint, x, z, 0.2)) return b.floorY;
    }
    if (rectContains(this.layout.carpetRect, x, z)) return this.layout.carpetY;
    return this.layout.groundY;
  }

  clampToMap(pos: THREE.Vector3): void {
    const b = this.layout.mapBounds;
    pos.x = THREE.MathUtils.clamp(pos.x, b.minX, b.maxX);
    pos.z = THREE.MathUtils.clamp(pos.z, b.minZ, b.maxZ);
  }

  /** Which base zone (index) contains this position, or -1. */
  baseIndexAt(x: number, z: number, pad = 0): number {
    for (let i = 0; i < this.layout.bases.length; i++) {
      if (rectContains(this.layout.bases[i].rect, x, z, pad)) return i;
    }
    return -1;
  }
}
