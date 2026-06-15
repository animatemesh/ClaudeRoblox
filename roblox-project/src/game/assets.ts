import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BRAINROTS } from './catalog';
import { PLAYER_HEIGHT } from './config';

export interface CharacterRig {
  root: THREE.Group;          // normalized container: feet at y=0, height = PLAYER_HEIGHT
  mixerTarget: THREE.Object3D; // bind AnimationMixer here
  clips: THREE.AnimationClip[];
  bones: {
    torso?: THREE.Bone;
    head?: THREE.Bone;
    leftArm?: THREE.Bone;
    rightArm?: THREE.Bone;
    rightArmEnd?: THREE.Bone; // hand tip: bat mount point
    leftLeg?: THREE.Bone;
    rightLeg?: THREE.Bone;
  };
}

export interface BrainrotModel {
  root: THREE.Group;          // normalized container: feet at y=0, height = given target
  clips: THREE.AnimationClip[];
  mixerTarget: THREE.Object3D; // object the AnimationMixer should bind to
}

function setShadows(obj: THREE.Object3D, cast: boolean, receive: boolean) {
  obj.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.frustumCulled = false; // skinned meshes from sketchfab often have bad bounds
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (std && std.isMaterial) {
          std.side = THREE.DoubleSide;
        }
      }
    }
  });
}

/**
 * Bounding box that is correct even for skinned meshes, whose plain geometry
 * bounds ignore bone transforms (Sketchfab/FBX rigs often carry 100x scale on
 * the armature, making setFromObject wildly wrong).
 */
function computePosedBox(obj: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  const vertex = new THREE.Vector3();
  obj.traverse((c) => {
    const skinned = c as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      // Replicate the render path exactly: refresh the bone palette, then run
      // every vertex through the same skinning transform the shader applies.
      skinned.skeleton.update();
      const pos = skinned.geometry.getAttribute('position');
      tmp.makeEmpty();
      for (let i = 0; i < pos.count; i++) {
        skinned.getVertexPosition(i, vertex); // bind + bones + bindInverse
        tmp.expandByPoint(vertex);
      }
      if (!tmp.isEmpty()) {
        tmp.applyMatrix4(skinned.matrixWorld);
        box.union(tmp);
      }
    } else {
      const mesh = c as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        if (mesh.geometry.boundingBox) {
          tmp.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
          box.union(tmp);
        }
      }
    }
  });
  if (box.isEmpty()) box.setFromObject(obj);
  return box;
}

/**
 * Flattens a (possibly skinned) hierarchy into a group of plain static meshes
 * with all node and bone transforms baked into the vertices. Used for props
 * that never animate, where skinned-mesh transform quirks only cause trouble.
 */
function bakeToStatic(template: THREE.Group): THREE.Group {
  template.updateWorldMatrix(true, true);
  const out = new THREE.Group();
  const v = new THREE.Vector3();
  template.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    let geo: THREE.BufferGeometry;
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.skeleton.update();
      geo = skinned.geometry.clone();
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        skinned.getVertexPosition(i, v);
        v.applyMatrix4(skinned.matrixWorld);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      pos.needsUpdate = true;
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');
      geo.computeVertexNormals();
    } else {
      geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    }
    geo.computeBoundingBox();
    out.add(new THREE.Mesh(geo, mesh.material));
  });
  return out;
}

/**
 * Wraps an object in a pivot group, scaled so its bounding-box height equals
 * targetHeight, centered on x/z, with its feet (min y) resting at y = 0.
 *
 * The hierarchy is assembled FIRST and matrices updated before measuring, so
 * skinned meshes (whose vertices follow bone world matrices, not the mesh
 * node) are measured exactly as the renderer will draw them.
 */
function normalizeIntoPivot(obj: THREE.Object3D, targetHeight: number): THREE.Group {
  const pivot = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(obj);
  pivot.add(inner);
  pivot.updateWorldMatrix(true, true);

  const box = computePosedBox(pivot);
  const size = new THREE.Vector3();
  box.getSize(size);
  const height = Math.max(size.y, 1e-6);
  const s = targetHeight / height;

  inner.scale.setScalar(s);
  const center = new THREE.Vector3();
  box.getCenter(center);
  inner.position.set(-center.x * s, -box.min.y * s, -center.z * s);
  pivot.updateWorldMatrix(true, true);
  return pivot;
}

function findBone(root: THREE.Object3D, ...needles: string[]): THREE.Bone | undefined {
  // needles prefixed with '!' must NOT appear in the bone name
  let found: THREE.Bone | undefined;
  root.traverse((c) => {
    if (found) return;
    const b = c as THREE.Bone;
    if (!b.isBone) return;
    const name = b.name.toLowerCase();
    const ok = needles.every((n) =>
      n.startsWith('!') ? !name.includes(n.slice(1).toLowerCase()) : name.includes(n.toLowerCase())
    );
    if (ok) found = b;
  });
  return found;
}

interface Calibration {
  pivotScale: number;          // converged outer correction scale
  innerPos: THREE.Vector3;     // converged inner offset (at calibration target)
  t0: number;                  // target height used during calibration
}

export class AssetManager {
  mapScene!: THREE.Group;
  baseTemplate!: THREE.Group;
  private playerTemplate!: THREE.Group;
  private playerClips: THREE.AnimationClip[] = [];
  private batTemplate!: THREE.Group;
  private brainrotTemplates = new Map<string, { obj: THREE.Group; clips: THREE.AnimationClip[] }>();
  private calibration = new Map<string, Calibration>();

  async loadAll(onProgress: (label: string, done: number, total: number) => void): Promise<void> {
    const gltf = new GLTFLoader();
    const fbx = new FBXLoader();
    const total = 4 + BRAINROTS.length;
    let done = 0;
    const tick = (label: string) => onProgress(label, ++done, total);

    const assetBase = import.meta.env.BASE_URL + 'assets/';
    const mapP = gltf.loadAsync(assetBase + 'brainrotmap.glb').then((g) => {
      this.mapScene = g.scene as unknown as THREE.Group;
      tick('Map');
    });
    const baseP = gltf.loadAsync(assetBase + 'Base1floor.glb').then((g) => {
      this.baseTemplate = g.scene as unknown as THREE.Group;
      tick('Base building');
    });
    const playerP = gltf.loadAsync(assetBase + 'roblox_player.glb').then((g) => {
      this.playerTemplate = g.scene as unknown as THREE.Group;
      this.playerClips = g.animations ?? [];
      tick('Character');
    });
    const batP = gltf.loadAsync(assetBase + 'simple_bat.glb').then((g) => {
      // The bat is a static prop: bake its (badly bound) skinned geometry to a
      // plain mesh so ancestor scales/rotations behave normally.
      this.batTemplate = bakeToStatic(g.scene as unknown as THREE.Group);
      tick('Bat');
    });
    const brainrotPs = BRAINROTS.map((def) =>
      fbx.loadAsync(import.meta.env.BASE_URL + def.file).then((obj) => {
        this.brainrotTemplates.set(def.id, {
          obj: obj as unknown as THREE.Group,
          clips: (obj as unknown as THREE.Group).animations ?? [],
        });
        tick(def.name);
      })
    );

    await Promise.all([mapP, baseP, playerP, batP, ...brainrotPs]);
  }

  /** Fresh clone of the base building (plain static meshes). */
  makeBase(): THREE.Group {
    const cloned = this.baseTemplate.clone();
    setShadows(cloned, true, true);
    return cloned;
  }

  /**
   * Some rigs (notably Sketchfab GLB exports) only reveal their true skinned
   * proportions after the renderer has processed them, and a few even respond
   * non-linearly to ancestor scaling (double-applied bind matrices). Instead
   * of reasoning about each rig's pathology, calibrate empirically: render a
   * throwaway instance, measure it, nudge scale/offset, and repeat until the
   * rendered size and footing converge on the target. The converged transform
   * is stored and replayed onto every future instance.
   */
  calibrate(renderer: THREE.WebGLRenderer): void {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 2, 8);
    camera.lookAt(0, 1, 0);

    const probes: { key: string; pivot: THREE.Group; target: number }[] = [
      { key: 'player', pivot: this.makeCharacter().root, target: PLAYER_HEIGHT },
    ];
    for (const def of BRAINROTS) {
      probes.push({ key: def.id, pivot: this.makeBrainrot(def.id, 1.5).root, target: 1.5 });
    }
    for (const p of probes) scene.add(p.pivot);

    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    for (let iter = 0; iter < 10; iter++) {
      scene.updateWorldMatrix(true, true);
      renderer.render(scene, camera);
      for (const p of probes) {
        const box = computePosedBox(p.pivot);
        box.getSize(size);
        box.getCenter(center);
        const h = Math.max(size.y, 1e-6);
        // damped multiplicative scale step (handles linear & quadratic rigs)
        const f = Math.pow(p.target / h, 0.55);
        p.pivot.scale.multiplyScalar(THREE.MathUtils.clamp(f, 0.05, 20));
        // damped offset step toward feet-at-origin, centered on x/z
        const inner = p.pivot.children[0];
        if (inner) {
          const gain = 0.6 / Math.max(p.pivot.scale.x, 1e-6);
          inner.position.x -= center.x * gain;
          inner.position.y -= box.min.y * gain;
          inner.position.z -= center.z * gain;
        }
      }
    }

    for (const p of probes) {
      const inner = p.pivot.children[0];
      this.calibration.set(p.key, {
        pivotScale: p.pivot.scale.x,
        innerPos: inner ? inner.position.clone() : new THREE.Vector3(),
        t0: p.target,
      });
      scene.remove(p.pivot);
    }
  }

  /** Replay the converged calibration transform onto a fresh instance. */
  private applyCalibration(pivot: THREE.Group, key: string, target: number): void {
    const cal = this.calibration.get(key);
    if (!cal) return;
    const ratio = target / cal.t0;
    // normalizeIntoPivot's own measurement already scales with the target;
    // pivotScale is the target-independent residual correction.
    pivot.scale.setScalar(cal.pivotScale);
    const inner = pivot.children[0];
    if (inner) {
      // the converged offset was found at t0 and scales linearly with target
      inner.position.copy(cal.innerPos).multiplyScalar(ratio);
    }
    pivot.updateWorldMatrix(true, true);
  }

  /** Fresh normalized character clone with discoverable R6 bones. */
  makeCharacter(tint?: number): CharacterRig {
    const cloned = skeletonClone(this.playerTemplate) as THREE.Group;
    setShadows(cloned, true, false);
    if (tint !== undefined) {
      // Shift material hues so each bot is visually distinguishable.
      const shift = ((tint % 360) + 360) % 360 / 360;
      cloned.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh) return;
        const recolor = (m: THREE.Material): THREE.Material => {
          const copy = m.clone() as THREE.MeshStandardMaterial;
          if (copy.color) copy.color.offsetHSL(shift, 0, 0);
          return copy;
        };
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(recolor)
          : recolor(mesh.material);
      });
    }
    const root = normalizeIntoPivot(cloned, PLAYER_HEIGHT);
    this.applyCalibration(root, 'player', PLAYER_HEIGHT);
    const bones: CharacterRig['bones'] = {
      torso: findBone(cloned, 'torso'),
      head: findBone(cloned, 'head'),
      leftArm: findBone(cloned, 'left', 'arm', '!end'),
      rightArm: findBone(cloned, 'right', 'arm', '!end'),
      rightArmEnd: findBone(cloned, 'right', 'arm', 'end'),
      leftLeg: findBone(cloned, 'left', 'leg', '!end'),
      rightLeg: findBone(cloned, 'right', 'leg', '!end'),
    };
    return { root, bones, mixerTarget: cloned, clips: this.playerClips };
  }

  /** Fresh normalized bat clone; long axis aligned to +Y. */
  makeBat(): THREE.Group {
    const cloned = this.batTemplate.clone(); // static meshes: plain clone is fine
    setShadows(cloned, true, false);
    cloned.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    box.getSize(size);

    // Rotate the longest axis onto +Y inside an alignment group, and chunk up
    // the cross-section: the raw model is a near-invisible thin stick.
    const align = new THREE.Group();
    align.add(cloned);
    if (size.x >= size.y && size.x >= size.z) {
      align.rotation.z = Math.PI / 2; // x -> y
      cloned.scale.set(1, 2.4, 2.4);
    } else if (size.z >= size.y && size.z >= size.x) {
      align.rotation.x = -Math.PI / 2; // z -> y
      cloned.scale.set(2.4, 2.4, 1);
    } else {
      cloned.scale.set(2.4, 1, 2.4);
    }
    return normalizeIntoPivot(align, 1.3);
  }

  /** Fresh brainrot clone of the given catalog id at the given world height. */
  makeBrainrot(defId: string, targetHeight: number): BrainrotModel {
    const tpl = this.brainrotTemplates.get(defId);
    if (!tpl) throw new Error('Unknown brainrot id: ' + defId);
    const cloned = skeletonClone(tpl.obj) as THREE.Group;
    setShadows(cloned, true, false);
    const root = normalizeIntoPivot(cloned, targetHeight);
    this.applyCalibration(root, defId, targetHeight);
    return { root, clips: tpl.clips, mixerTarget: cloned };
  }
}
