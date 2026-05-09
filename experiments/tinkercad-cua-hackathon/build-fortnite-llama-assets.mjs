import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "llama_assets");
const OBJ_PATH = path.join(OUT_DIR, "fortnite_llama.obj");
const MTL_PATH = path.join(OUT_DIR, "fortnite_llama.mtl");
const STL_PATH = path.join(OUT_DIR, "fortnite_llama.stl");
const NOTES_PATH = path.join(OUT_DIR, "tutorial-notes.json");

const deg = (n) => (n * Math.PI) / 180;

const materials = {
  bodyPurple: [0.52, 0.23, 0.72],
  lightPurple: [0.72, 0.52, 0.88],
  deepPurple: [0.33, 0.16, 0.55],
  cyan: [0.10, 0.62, 0.86],
  blue: [0.10, 0.28, 0.78],
  green: [0.22, 0.72, 0.48],
  tan: [0.78, 0.52, 0.26],
  brown: [0.48, 0.30, 0.16],
  white: [0.94, 0.91, 0.82],
  black: [0.02, 0.02, 0.03],
  gray: [0.34, 0.34, 0.38],
  gold: [0.93, 0.68, 0.24],
};

const meshes = [];

function rotatePoint([x, y, z], rotation = {}) {
  const rx = deg(rotation.x ?? 0);
  const ry = deg(rotation.y ?? 0);
  const rz = deg(rotation.z ?? 0);

  let px = x;
  let py = y;
  let pz = z;

  let c = Math.cos(rx);
  let s = Math.sin(rx);
  [py, pz] = [py * c - pz * s, py * s + pz * c];

  c = Math.cos(ry);
  s = Math.sin(ry);
  [px, pz] = [px * c + pz * s, -px * s + pz * c];

  c = Math.cos(rz);
  s = Math.sin(rz);
  [px, py] = [px * c - py * s, px * s + py * c];

  return [px, py, pz];
}

function transformVertex(vertex, transform = {}) {
  const [x, y, z] = rotatePoint(vertex, transform.rotation);
  const [tx, ty, tz] = transform.translate ?? [0, 0, 0];
  return [x + tx, y + ty, z + tz];
}

function addMesh(name, material, vertices, faces, transform = {}) {
  meshes.push({
    name,
    material,
    vertices: vertices.map((vertex) => transformVertex(vertex, transform)),
    faces,
  });
}

function addBox(name, material, [sx, sy, sz], transform = {}) {
  const x = sx / 2;
  const y = sy / 2;
  const z = sz / 2;
  const vertices = [
    [-x, -y, -z],
    [x, -y, -z],
    [x, y, -z],
    [-x, y, -z],
    [-x, -y, z],
    [x, -y, z],
    [x, y, z],
    [-x, y, z],
  ];
  const faces = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [1, 5, 6, 2],
    [2, 6, 7, 3],
    [3, 7, 4, 0],
  ];
  addMesh(name, material, vertices, faces, transform);
}

function addFrustum(name, material, bottom, top, height, transform = {}) {
  const [bx, by] = [bottom[0] / 2, bottom[1] / 2];
  const [tx, ty] = [top[0] / 2, top[1] / 2];
  const z0 = -height / 2;
  const z1 = height / 2;
  const vertices = [
    [-bx, -by, z0],
    [bx, -by, z0],
    [bx, by, z0],
    [-bx, by, z0],
    [-tx, -ty, z1],
    [tx, -ty, z1],
    [tx, ty, z1],
    [-tx, ty, z1],
  ];
  const faces = [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [1, 5, 6, 2],
    [2, 6, 7, 3],
    [3, 7, 4, 0],
  ];
  addMesh(name, material, vertices, faces, transform);
}

function addTriPrism(name, material, width, depth, height, transform = {}) {
  const x = width / 2;
  const y = depth / 2;
  const z = height / 2;
  const vertices = [
    [-x, -y, -z],
    [x, -y, -z],
    [0, -y, z],
    [-x, y, -z],
    [x, y, -z],
    [0, y, z],
  ];
  const faces = [
    [0, 1, 2],
    [3, 5, 4],
    [0, 3, 4, 1],
    [1, 4, 5, 2],
    [2, 5, 3, 0],
  ];
  addMesh(name, material, vertices, faces, transform);
}

function addCylinder(name, material, radius, length, axis = "z", transform = {}, segments = 24) {
  const vertices = [];
  const faces = [];
  const half = length / 2;

  for (let i = 0; i < segments; i += 1) {
    const a = (2 * Math.PI * i) / segments;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    vertices.push([x, y, -half], [x, y, half]);
  }
  const bottomCenter = vertices.push([0, 0, -half]) - 1;
  const topCenter = vertices.push([0, 0, half]) - 1;

  for (let i = 0; i < segments; i += 1) {
    const j = (i + 1) % segments;
    faces.push([i * 2, j * 2, j * 2 + 1, i * 2 + 1]);
    faces.push([bottomCenter, j * 2, i * 2]);
    faces.push([topCenter, i * 2 + 1, j * 2 + 1]);
  }

  let axisRotation = {};
  if (axis === "x") axisRotation = { y: 90 };
  if (axis === "y") axisRotation = { x: 90 };

  addMesh(name, material, vertices, faces, {
    ...transform,
    rotation: {
      ...axisRotation,
      ...(transform.rotation ?? {}),
    },
  });
}

function addMirroredPair(prefix, addOne) {
  addOne(`${prefix}_left`, -1);
  addOne(`${prefix}_right`, 1);
}

function buildLlama() {
  addBox("tutorial_body_42x97x35", "bodyPurple", [42, 97, 35], {
    translate: [0, 0, 38],
  });

  addBox("body_top_highlight", "lightPurple", [32, 84, 5], {
    translate: [0, 1, 58],
  });

  addFrustum("lower_tapered_neck", "lightPurple", [38, 24], [30, 18], 24, {
    translate: [0, 38, 69],
    rotation: { x: -9 },
  });
  addFrustum("middle_tapered_neck", "bodyPurple", [30, 18], [22, 15], 25, {
    translate: [0, 47, 86],
    rotation: { x: -18 },
  });
  addFrustum("upper_tapered_neck", "deepPurple", [22, 15], [16, 12], 21, {
    translate: [0, 54, 101],
    rotation: { x: 8 },
  });
  addFrustum("forward_head_transition", "lightPurple", [18, 12], [14, 10], 18, {
    translate: [0, 63, 100],
    rotation: { x: 28 },
  });

  addBox("head_cube_30x13", "lightPurple", [24, 30, 13], {
    translate: [0, 78, 90],
    rotation: { x: -13 },
  });
  addBox("snout_lower_jaw", "bodyPurple", [18, 18, 7], {
    translate: [0, 94, 82],
    rotation: { x: -16 },
  });
  addTriPrism("upper_mouth_triangular_prism", "bodyPurple", 18, 15, 8, {
    translate: [0, 96, 88],
    rotation: { x: -16, z: 180 },
  });
  addBox("white_teeth_bar", "white", [14, 12, 3], {
    translate: [0, 101, 78],
    rotation: { x: -16 },
  });
  addTriPrism("lower_jaw_tip", "bodyPurple", 15, 14, 5, {
    translate: [0, 101, 75],
    rotation: { x: -16 },
  });

  addMirroredPair("eye_white", (name, side) => {
    addCylinder(name, "white", 4.2, 1.6, "x", {
      translate: [side * 12.5, 84, 93],
      rotation: { x: -13 },
    });
  });
  addMirroredPair("eye_pupil", (name, side) => {
    addCylinder(name, "black", 2.1, 1.9, "x", {
      translate: [side * 13.4, 84.3, 93],
      rotation: { x: -13 },
    });
  });

  addMirroredPair("upright_ear", (name, side) => {
    addTriPrism(name, "deepPurple", 8, 10, 22, {
      translate: [side * 8, 63, 108],
      rotation: { x: 12, z: side * 9 },
    });
  });
  addMirroredPair("ear_inner", (name, side) => {
    addTriPrism(name, "cyan", 4.5, 8, 13, {
      translate: [side * 8.2, 64, 110],
      rotation: { x: 12, z: side * 9 },
    });
  });

  addMirroredPair("front_leg", (name, side) => {
    addFrustum(name, "cyan", [9, 12], [5, 6], 34, {
      translate: [side * 14, 31, 14],
      rotation: { x: side * 0 },
    });
    addBox(`${name}_hoof`, "deepPurple", [12, 10, 5], {
      translate: [side * 14, 33, 1.5],
      rotation: { x: 0 },
    });
  });
  addMirroredPair("rear_leg", (name, side) => {
    addFrustum(name, "blue", [10, 13], [5, 6], 33, {
      translate: [side * 14, -33, 14],
      rotation: { x: 0 },
    });
    addBox(`${name}_hoof`, "deepPurple", [12, 10, 5], {
      translate: [side * 14, -34, 1.5],
    });
  });

  addBox("side_saddle_chest", "brown", [7, 34, 25], {
    translate: [-25, 4, 47],
  });
  addBox("side_saddle_lid", "tan", [8, 38, 5], {
    translate: [-26, 4, 62],
  });
  addBox("side_saddle_panel", "gold", [2.5, 18, 14], {
    translate: [-30.8, 7, 48],
  });
  addBox("gray_lock_body", "gray", [3, 8, 8], {
    translate: [-33, 7, 47],
  });
  addCylinder("gray_lock_loop", "gray", 3.5, 2.5, "x", {
    translate: [-33.3, 7, 53.5],
  }, 18);

  addBox("tail_stem", "deepPurple", [14, 18, 8], {
    translate: [0, -58, 56],
    rotation: { x: 18 },
  });
  addTriPrism("tail_plume_1", "cyan", 17, 8, 17, {
    translate: [0, -67, 63],
    rotation: { x: 32 },
  });
  addTriPrism("tail_plume_2", "blue", 14, 7, 14, {
    translate: [0, -74, 69],
    rotation: { x: 42, z: 180 },
  });
  addTriPrism("tail_plume_3", "green", 12, 7, 12, {
    translate: [0, -80, 65],
    rotation: { x: -8 },
  });

  const maneColors = ["cyan", "green", "blue", "bodyPurple", "lightPurple"];
  for (let i = 0; i < 16; i += 1) {
    const y = -39 + i * 7.2;
    const z = y < 35 ? 62 : 68 + (y - 35) * 0.75;
    addTriPrism(`top_feather_${String(i + 1).padStart(2, "0")}`, maneColors[i % maneColors.length], 10, 5, 9, {
      translate: [0, y, z],
      rotation: { x: y > 35 ? -18 : 0, z: i % 2 ? 180 : 0 },
    });
  }

  for (let i = 0; i < 11; i += 1) {
    const y = -33 + i * 8;
    const material = maneColors[(i + 2) % maneColors.length];
    addMirroredPair(`side_fringe_${String(i + 1).padStart(2, "0")}`, (name, side) => {
      addTriPrism(name, material, 7, 4, 9, {
        translate: [side * 24.5, y, 53],
        rotation: { y: side * 90, z: i % 2 ? 180 : 0 },
      });
    });
  }
}

function triangulateFace(face) {
  if (face.length === 3) return [face];
  const triangles = [];
  for (let i = 1; i < face.length - 1; i += 1) {
    triangles.push([face[0], face[i], face[i + 1]]);
  }
  return triangles;
}

function normalOf(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function fmt(n) {
  return Number(n.toFixed(5)).toString();
}

function writeObj() {
  const lines = ["mtllib fortnite_llama.mtl"];
  let indexOffset = 1;

  for (const mesh of meshes) {
    lines.push("", `o ${mesh.name}`, `usemtl ${mesh.material}`);
    for (const vertex of mesh.vertices) {
      lines.push(`v ${vertex.map(fmt).join(" ")}`);
    }
    for (const face of mesh.faces) {
      lines.push(`f ${face.map((i) => i + indexOffset).join(" ")}`);
    }
    indexOffset += mesh.vertices.length;
  }

  fs.writeFileSync(OBJ_PATH, `${lines.join("\n")}\n`);
}

function writeMtl() {
  const lines = [];
  for (const [name, rgb] of Object.entries(materials)) {
    lines.push(`newmtl ${name}`);
    lines.push(`Kd ${rgb.map(fmt).join(" ")}`);
    lines.push("Ka 0.05000 0.05000 0.05000");
    lines.push("Ks 0.10000 0.10000 0.10000");
    lines.push("Ns 25");
    lines.push("");
  }
  fs.writeFileSync(MTL_PATH, lines.join("\n"));
}

function writeStl() {
  const lines = ["solid fortnite_llama_tinkercad"];
  for (const mesh of meshes) {
    for (const face of mesh.faces) {
      for (const tri of triangulateFace(face)) {
        const [a, b, c] = tri.map((i) => mesh.vertices[i]);
        const normal = normalOf(a, b, c);
        lines.push(`  facet normal ${normal.map(fmt).join(" ")}`);
        lines.push("    outer loop");
        lines.push(`      vertex ${a.map(fmt).join(" ")}`);
        lines.push(`      vertex ${b.map(fmt).join(" ")}`);
        lines.push(`      vertex ${c.map(fmt).join(" ")}`);
        lines.push("    endloop");
        lines.push("  endfacet");
      }
    }
  }
  lines.push("endsolid fortnite_llama_tinkercad");
  fs.writeFileSync(STL_PATH, `${lines.join("\n")}\n`);
}

function writeNotes() {
  const notes = {
    sourceVideo: "https://www.youtube.com/watch?v=eDXcDN2tYOE&list=PLKOHL5rWQofF8pjNuyqSFCseO0WWG9Pez",
    sourceTitle: "How to Make the FortNite Llama in Tinkercad PART 1 of 3",
    relatedParts: [
      "How To Make The Fortnite Llama in Tinkercad PART 2 of 3",
      "How To Make The Fortnite Llama in Tinkercad PART 3 of 3",
    ],
    modeledFrom: [
      "Part 1 body dimensions: 42 x 97 x 35, raised body, purple color.",
      "Part 1 tapered neck/head method: repeated pyramids/frustums and triangular prism jaw pieces.",
      "Part 1/2 ears, eyes, mouth, teeth, and lower jaw.",
      "Part 2 legs, saddle/lid, and lock.",
      "Part 3 repeated feather/fringe details around the body and neck.",
    ],
    generatedFiles: {
      obj: OBJ_PATH,
      mtl: MTL_PATH,
      stl: STL_PATH,
    },
    meshCount: meshes.length,
  };
  fs.writeFileSync(NOTES_PATH, `${JSON.stringify(notes, null, 2)}\n`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
buildLlama();
writeMtl();
writeObj();
writeStl();
writeNotes();

console.log(`Wrote ${meshes.length} meshes`);
console.log(OBJ_PATH);
console.log(MTL_PATH);
console.log(STL_PATH);
