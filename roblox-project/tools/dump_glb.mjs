import { readFileSync } from 'node:fs';

const file = process.argv[2];
const buf = readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));

const nodes = json.nodes || [];
const meshes = json.meshes || [];
const accessors = json.accessors || [];

// minimal mat4 helpers (column-major like glTF)
function mat4Identity() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function mat4Mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c*4+r] += a[k*4+r] * b[c*4+k];
  return o;
}
function mat4FromTRS(t, r, s) {
  const [x,y,z,w] = r;
  const x2=x+x, y2=y+y, z2=z+z;
  const xx=x*x2, xy=x*y2, xz=x*z2, yy=y*y2, yz=y*z2, zz=z*z2, wx=w*x2, wy=w*y2, wz=w*z2;
  const [sx,sy,sz] = s;
  return [
    (1-(yy+zz))*sx, (xy+wz)*sx, (xz-wy)*sx, 0,
    (xy-wz)*sy, (1-(xx+zz))*sy, (yz+wx)*sy, 0,
    (xz+wy)*sz, (yz-wx)*sz, (1-(xx+yy))*sz, 0,
    t[0], t[1], t[2], 1,
  ];
}
function nodeLocal(n) {
  if (n.matrix) return n.matrix;
  return mat4FromTRS(n.translation || [0,0,0], n.rotation || [0,0,0,1], n.scale || [1,1,1]);
}
function xform(m, v) {
  return [
    m[0]*v[0] + m[4]*v[1] + m[8]*v[2] + m[12],
    m[1]*v[0] + m[5]*v[1] + m[9]*v[2] + m[13],
    m[2]*v[0] + m[6]*v[1] + m[10]*v[2] + m[14],
  ];
}

function walk(n, depth, parentMat) {
  const world = mat4Mul(parentMat, nodeLocal(n));
  const pad = '  '.repeat(depth);
  let line = pad + (n.name || '(unnamed)');
  if (n.mesh !== undefined) {
    const prim = meshes[n.mesh].primitives[0];
    const acc = accessors[prim.attributes.POSITION];
    if (acc.min && acc.max) {
      // transform all 8 corners to world space
      const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < 8; i++) {
        const c = [
          i & 1 ? acc.max[0] : acc.min[0],
          i & 2 ? acc.max[1] : acc.min[1],
          i & 4 ? acc.max[2] : acc.min[2],
        ];
        const wc = xform(world, c);
        for (let k = 0; k < 3; k++) { mins[k] = Math.min(mins[k], wc[k]); maxs[k] = Math.max(maxs[k], wc[k]); }
      }
      line += ' WORLDbbox=[' + mins.map(v => v.toFixed(2)).join(', ') + '] .. [' + maxs.map(v => v.toFixed(2)).join(', ') + ']';
    }
  }
  console.log(line);
  for (const c of (n.children || [])) walk(nodes[c], depth + 1, world);
}

const scene = json.scenes[json.scene || 0];
for (const r of scene.nodes) walk(nodes[r], 0, mat4Identity());
