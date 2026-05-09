import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "advanced_cat_assets");
const OBJ_PATH = path.join(OUT_DIR, "advanced_3d_cat.obj");
const MTL_PATH = path.join(OUT_DIR, "advanced_3d_cat.mtl");
const STL_PATH = path.join(OUT_DIR, "advanced_3d_cat.stl");
const NOTES_PATH = path.join(OUT_DIR, "tutorial-notes.json");
const STEPS_PATH = path.join(OUT_DIR, "step-by-step.md");
const PREVIEW_PATH = path.join(OUT_DIR, "advanced_3d_cat_preview.svg");
const REPORT_PATH = path.join(OUT_DIR, "report.html");

const SOURCE_VIDEO = "https://www.youtube.com/watch?v=gDMqKux9Bzo";
const SOURCE_TITLE = "Tinkercad Tutorial - How To Make An Advanced 3D Cat";
const SOURCE_AUTHOR = "Circuits With Angel";

const deg = (n) => (n * Math.PI) / 180;

const materials = {
  catGray: [0.55, 0.61, 0.63],
  lightGray: [0.78, 0.83, 0.84],
  innerEar: [0.37, 0.43, 0.45],
  shadowGray: [0.38, 0.43, 0.45],
  white: [0.96, 0.97, 0.95],
  black: [0.018, 0.018, 0.02],
  noseMauve: [0.47, 0.36, 0.42],
};

const tutorialSteps = [
  {
    time: "00:37",
    title: "Head",
    note: "Start with a sphere, scaled to about 28.26 x 24.96 x 24.66 mm.",
  },
  {
    time: "00:54",
    title: "Ears",
    note: "Use mirrored paraboloids for pointed ears, plus smaller hole-like inserts to hollow the ear silhouette.",
  },
  {
    time: "01:41",
    title: "Mouth and nose bridge",
    note: "Build the muzzle from overlapping spheres, then use a rounded roof/roof primitive for the bridge and nose.",
  },
  {
    time: "03:14",
    title: "Head shaping and eyes",
    note: "Use hole spheres to carve eye and cheek spaces, then add mirrored eye spheres and smaller pupils.",
  },
  {
    time: "05:09",
    title: "Body and neck",
    note: "Add a long sphere for the body, about 50 x 25 mm, tilt it slightly, then connect it with a tilted cylinder neck.",
  },
  {
    time: "06:04",
    title: "Front legs",
    note: "Use spheres for shoulders, cylinders for upper/lower leg sections, and half-sphere paws.",
  },
  {
    time: "07:13",
    title: "Back legs",
    note: "Add longer rotated spheres for back haunches and repeat the leg/paw pattern on both sides.",
  },
  {
    time: "08:06",
    title: "Tail",
    note: "Use a torus, cut it with a box in Tinkercad, and stand the remaining arc up behind the body.",
  },
];

const primitivePlan = [
  ["1", "head", "sphere/ellipsoid", "solid", "28.26 x 24.96 x 24.66 mm", "front, raised", "0, 0, 0", "main cat skull mass"],
  ["2", "left/right ears", "paraboloid plus inner shell", "solid / hole-like insert", "14.47 x 11.64 x 16.72 mm", "top sides of head", "outward and forward tilt", "mirrored after one ear is shaped"],
  ["3", "muzzle", "three overlapping spheres", "solid", "approx. 8 x 7 x 7 mm lobes", "front lower head", "0, 0, 0", "two upper lobes plus one lower lobe"],
  ["4", "nose bridge and nose", "round roof and roof wedge", "solid", "bridge 7 x 2 mm, nose 5 x 2 mm", "centered on muzzle", "nose rotated 180 deg", "tutorial roof-shape landmark"],
  ["5", "eye sockets and eyes", "hole spheres, eye spheres", "solid approximation", "eyes about 7.27 x 8.23 x 7 mm, pupils 3 x 3 x 4 mm", "front upper head", "front-facing", "large cartoon eyes from thumbnail"],
  ["6", "body", "sphere/ellipsoid", "solid", "50 x 25 mm", "behind head", "tilted 5 deg", "long horizontal mass"],
  ["7", "neck", "cylinder", "solid", "approx. 12 mm dia x 18 mm", "between head/body", "tilted 22.5 deg", "hidden connector"],
  ["8", "front legs and paws", "spheres, cylinders, half spheres", "solid", "shoulders 13 x 14 x 11 mm, legs 8 mm dia", "front underside", "10 deg leg tilt", "mirrored pair"],
  ["9", "back legs and paws", "rotated spheres, cylinders, half spheres", "solid", "haunches 20 x 12 mm", "rear underside", "slight outward rotation", "mirrored pair"],
  ["10", "tail", "torus slice", "solid", "40 mm torus, 9 mm thick in tutorial", "rear, upright", "vertical arc", "box-cut torus represented as a mesh arc"],
];

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
  const scale = transform.scale ?? [1, 1, 1];
  const scaled = [vertex[0] * scale[0], vertex[1] * scale[1], vertex[2] * scale[2]];
  const [x, y, z] = rotatePoint(scaled, transform.rotation);
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

function addEllipsoid(name, material, radii, transform = {}, segments = 32, rings = 16) {
  const vertices = [];
  const faces = [];
  const [rx, ry, rz] = radii;

  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = (Math.PI * ring) / rings;
    const z = Math.cos(phi) * rz;
    const r = Math.sin(phi);
    for (let segment = 0; segment < segments; segment += 1) {
      const theta = (2 * Math.PI * segment) / segments;
      vertices.push([Math.cos(theta) * r * rx, Math.sin(theta) * r * ry, z]);
    }
  }

  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = ring * segments + segment;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + next;
      const d = (ring + 1) * segments + segment;
      faces.push([a, b, c, d]);
    }
  }

  addMesh(name, material, vertices, faces, transform);
}

function addHemisphere(name, material, radii, transform = {}, segments = 28, rings = 8) {
  const vertices = [];
  const faces = [];
  const [rx, ry, rz] = radii;

  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = (Math.PI / 2) * (ring / rings);
    const z = Math.cos(phi) * rz;
    const r = Math.sin(phi);
    for (let segment = 0; segment < segments; segment += 1) {
      const theta = (2 * Math.PI * segment) / segments;
      vertices.push([Math.cos(theta) * r * rx, Math.sin(theta) * r * ry, z]);
    }
  }

  const baseCenter = vertices.push([0, 0, 0]) - 1;
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = ring * segments + segment;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + next;
      const d = (ring + 1) * segments + segment;
      faces.push([a, b, c, d]);
    }
  }
  const start = rings * segments;
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    faces.push([baseCenter, start + segment, start + next]);
  }

  addMesh(name, material, vertices, faces, transform);
}

function addParaboloid(name, material, radiusX, radiusY, length, transform = {}, segments = 28, rings = 12) {
  const vertices = [];
  const faces = [];

  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    const z = length * t;
    const r = Math.sqrt(1 - t);
    for (let segment = 0; segment < segments; segment += 1) {
      const theta = (2 * Math.PI * segment) / segments;
      vertices.push([Math.cos(theta) * radiusX * r, Math.sin(theta) * radiusY * r, z]);
    }
  }

  const baseCenter = vertices.push([0, 0, 0]) - 1;
  const tipCenter = vertices.push([0, 0, length]) - 1;

  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    faces.push([baseCenter, next, segment]);
  }

  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = ring * segments + segment;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + next;
      const d = (ring + 1) * segments + segment;
      faces.push([a, b, c, d]);
    }
  }

  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    const a = rings * segments + segment;
    const b = rings * segments + next;
    faces.push([a, b, tipCenter]);
  }

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

function addCylinder(name, material, radius, length, axis = "z", transform = {}, segments = 22) {
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

function addTorusSlice(name, material, majorRadius, tubeRadius, startDeg, endDeg, transform = {}, radialSegments = 38, tubeSegments = 12) {
  const vertices = [];
  const faces = [];
  const start = deg(startDeg);
  const end = deg(endDeg);

  for (let i = 0; i <= radialSegments; i += 1) {
    const u = start + ((end - start) * i) / radialSegments;
    for (let j = 0; j < tubeSegments; j += 1) {
      const v = (2 * Math.PI * j) / tubeSegments;
      const radius = majorRadius + tubeRadius * Math.cos(v);
      vertices.push([
        Math.cos(u) * radius,
        Math.sin(u) * radius,
        tubeRadius * Math.sin(v),
      ]);
    }
  }

  for (let i = 0; i < radialSegments; i += 1) {
    for (let j = 0; j < tubeSegments; j += 1) {
      const nextJ = (j + 1) % tubeSegments;
      const a = i * tubeSegments + j;
      const b = i * tubeSegments + nextJ;
      const c = (i + 1) * tubeSegments + nextJ;
      const d = (i + 1) * tubeSegments + j;
      faces.push([a, b, c, d]);
    }
  }

  const capStart = vertices.push([Math.cos(start) * majorRadius, Math.sin(start) * majorRadius, 0]) - 1;
  const capEnd = vertices.push([Math.cos(end) * majorRadius, Math.sin(end) * majorRadius, 0]) - 1;
  for (let j = 0; j < tubeSegments; j += 1) {
    const nextJ = (j + 1) % tubeSegments;
    faces.push([capStart, nextJ, j]);
    const a = radialSegments * tubeSegments + j;
    const b = radialSegments * tubeSegments + nextJ;
    faces.push([capEnd, a, b]);
  }

  addMesh(name, material, vertices, faces, transform);
}

function addMirrorPair(prefix, addOne) {
  addOne(`${prefix}_left`, -1);
  addOne(`${prefix}_right`, 1);
}

function buildHead() {
  addEllipsoid("step_01_head_sphere_28_26x24_96x24_66", "catGray", [14.13, 12.48, 12.33], {
    translate: [0, 20.5, 58.5],
    rotation: { x: -4 },
  });

  addMirrorPair("step_02_ear_outer_paraboloid", (name, side) => {
    addParaboloid(name, "catGray", 7.24, 5.82, 16.72, {
      translate: [side * 9.8, 17.5, 67.5],
      rotation: { x: -18, y: side * 30, z: side * -22.5 },
    }, 28, 12);
    addParaboloid(`${name}_inner_hole_like_shell`, "innerEar", 4.6, 3.3, 12.2, {
      translate: [side * 9.4, 20.2, 69.2],
      rotation: { x: -18, y: side * 30, z: side * -22.5 },
    }, 24, 8);
  });

  addMirrorPair("step_03_eye_socket_cutout_hint", (name, side) => {
    addEllipsoid(name, "shadowGray", [5.4, 1.0, 4.8], {
      translate: [side * 6.7, 32.05, 61.5],
      rotation: { x: -6, y: side * 12, z: side * 4 },
    }, 24, 10);
  });

  addMirrorPair("step_04_eye_white_sphere_7_27x8_23x7", (name, side) => {
    addEllipsoid(name, "white", [3.75, 1.35, 4.1], {
      translate: [side * 6.8, 32.6, 61.15],
      rotation: { x: -2, y: side * 10, z: side * -5 },
    }, 24, 12);
    addEllipsoid(`${name}_pupil_3x3x4`, "black", [1.55, 0.55, 2.05], {
      translate: [side * 6.95, 33.65, 60.7],
      rotation: { x: -2, y: side * 10, z: side * -3 },
    }, 18, 8);
  });

  addMirrorPair("step_05_muzzle_upper_sphere", (name, side) => {
    addEllipsoid(name, "lightGray", [4.5, 2.7, 3.6], {
      translate: [side * 3.9, 32.3, 54.2],
      rotation: { x: 2, y: side * 6 },
    }, 24, 10);
  });
  addEllipsoid("step_05_muzzle_lower_sphere", "lightGray", [5.4, 3.1, 3.9], {
    translate: [0, 32.6, 50.8],
    rotation: { x: 2 },
  }, 24, 10);

  addCylinder("step_06_round_roof_nose_bridge", "lightGray", 1.35, 7.0, "x", {
    translate: [0, 33.2, 56.8],
    rotation: { x: 90 },
  }, 18);
  addTriPrism("step_07_roof_nose_rotated_180", "noseMauve", 5.2, 2.3, 2.6, {
    translate: [0, 34.35, 53.9],
    rotation: { x: 90, z: 180 },
  });

  addCylinder("step_08_mouth_line_left", "black", 0.26, 4.7, "x", {
    translate: [-2.15, 34.15, 51.2],
    rotation: { z: -24 },
  }, 8);
  addCylinder("step_08_mouth_line_right", "black", 0.26, 4.7, "x", {
    translate: [2.15, 34.15, 51.2],
    rotation: { z: 24 },
  }, 8);
}

function buildBody() {
  addEllipsoid("step_09_body_sphere_50x25_tilted_5deg", "catGray", [12.7, 25, 13.1], {
    translate: [0, -12.5, 36.2],
    rotation: { x: 5 },
  }, 34, 16);

  addCylinder("step_10_neck_cylinder_tilted_22_5deg", "catGray", 6.6, 17, "z", {
    translate: [0, 9.5, 43.1],
    rotation: { x: -34 },
  }, 24);

  addEllipsoid("step_10_chest_blend_sphere", "catGray", [11.2, 8.5, 10.5], {
    translate: [0, 5.5, 37.4],
    rotation: { x: -8 },
  }, 26, 12);
}

function buildLegs() {
  addMirrorPair("step_11_front_shoulder_sphere_13x14x11", (name, side) => {
    addEllipsoid(name, "catGray", [6.5, 7.0, 5.5], {
      translate: [side * 8.0, 3.2, 29.2],
      rotation: { x: -8, y: side * 6 },
    }, 24, 10);
    addCylinder(`${name}_upper_cylinder_8mm_tilted_10deg`, "catGray", 4.0, 19.5, "z", {
      translate: [side * 8.4, 5.0, 18.2],
      rotation: { x: side * 0 + -4, y: side * 5, z: side * 2 },
    }, 20);
    addCylinder(`${name}_lower_cylinder_mirrored_shorter`, "catGray", 3.7, 15.5, "z", {
      translate: [side * 8.8, 8.5, 10.6],
      rotation: { x: -10, y: side * -3, z: side * -2 },
    }, 20);
    addHemisphere(`${name}_half_sphere_paw_10x12x6`, "lightGray", [5.1, 6.1, 3.2], {
      translate: [side * 8.8, 10.8, 0.4],
      rotation: { x: 0, y: 0, z: side * -4 },
    }, 24, 8);
  });

  addMirrorPair("step_12_back_haunch_sphere_20x12_rotated", (name, side) => {
    addEllipsoid(name, "catGray", [6.1, 10.2, 6.5], {
      translate: [side * 9.5, -28.2, 25.3],
      rotation: { x: 7, y: side * 6, z: side * -9 },
    }, 24, 10);
    addCylinder(`${name}_rear_leg_cylinder`, "catGray", 4.2, 17.5, "z", {
      translate: [side * 10.6, -31.7, 13.7],
      rotation: { x: 8, y: side * -5, z: side * 3 },
    }, 20);
    addHemisphere(`${name}_rear_paw_half_sphere`, "lightGray", [5.8, 7.4, 3.4], {
      translate: [side * 10.4, -27.2, 0.35],
      rotation: { z: side * -8 },
    }, 24, 8);
  });
}

function buildTail() {
  addTorusSlice("step_13_tail_torus_40mm_box_cut_arc", "catGray", 13.8, 3.0, -82, 177, {
    translate: [0, -37.5, 48.0],
    rotation: { x: 90, y: -8, z: 4 },
  }, 40, 12);
  addEllipsoid("step_13_tail_base_blend", "catGray", [4.5, 4.0, 4.0], {
    translate: [0, -33.5, 37.8],
    rotation: { x: 5 },
  }, 20, 8);
}

function buildCat() {
  buildHead();
  buildBody();
  buildLegs();
  buildTail();
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
  const lines = ["mtllib advanced_3d_cat.mtl"];
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
    lines.push("Ka 0.06000 0.06000 0.06000");
    lines.push("Ks 0.12000 0.12000 0.12000");
    lines.push("Ns 22");
    lines.push("");
  }
  fs.writeFileSync(MTL_PATH, lines.join("\n"));
}

function writeStl() {
  const lines = ["solid advanced_3d_cat_tinkercad_tutorial"];
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
  lines.push("endsolid advanced_3d_cat_tinkercad_tutorial");
  fs.writeFileSync(STL_PATH, `${lines.join("\n")}\n`);
}

function getBounds() {
  const points = meshes.flatMap((mesh) => mesh.vertices);
  const mins = [Infinity, Infinity, Infinity];
  const maxes = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let i = 0; i < 3; i += 1) {
      mins[i] = Math.min(mins[i], point[i]);
      maxes[i] = Math.max(maxes[i], point[i]);
    }
  }
  return {
    min: mins.map(fmt),
    max: maxes.map(fmt),
    size: maxes.map((n, i) => fmt(n - mins[i])),
  };
}

function colorToCss(rgb, shade = 1) {
  const values = rgb.map((v) => Math.round(Math.min(1, Math.max(0, v * shade)) * 255));
  return `rgb(${values.join(",")})`;
}

function writePreviewSvg() {
  const triangles = [];
  const yaw = deg(34);
  const pitch = deg(19);
  const light = [-0.35, -0.45, 0.82];
  const lightLen = Math.hypot(...light);
  const lightNorm = light.map((n) => n / lightLen);

  const projectRaw = ([x, y, z]) => {
    const px = x * Math.cos(yaw) - y * Math.sin(yaw);
    const py = x * Math.sin(yaw) + y * Math.cos(yaw);
    const pz = z;
    const ppy = py * Math.cos(pitch) - pz * Math.sin(pitch);
    const ppz = py * Math.sin(pitch) + pz * Math.cos(pitch);
    return [px, -ppy, ppz];
  };

  for (const mesh of meshes) {
    for (const face of mesh.faces) {
      for (const tri of triangulateFace(face)) {
        const vertices = tri.map((i) => mesh.vertices[i]);
        const normal = normalOf(...vertices);
        const shade = 0.60 + Math.max(0, normal[0] * lightNorm[0] + normal[1] * lightNorm[1] + normal[2] * lightNorm[2]) * 0.42;
        const projected = vertices.map(projectRaw);
        triangles.push({
          projected,
          depth: projected.reduce((sum, point) => sum + point[2], 0) / 3,
          fill: colorToCss(materials[mesh.material], shade),
        });
      }
    }
  }

  const all = triangles.flatMap((tri) => tri.projected);
  const minX = Math.min(...all.map((p) => p[0]));
  const maxX = Math.max(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const width = 980;
  const height = 640;
  const padding = 58;
  const scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxY - minY));
  const toSvg = ([x, y]) => [
    (x - minX) * scale + padding,
    (y - minY) * scale + padding,
  ];

  const polygons = triangles
    .sort((a, b) => a.depth - b.depth)
    .map((tri) => {
      const points = tri.projected.map((point) => toSvg(point).map(fmt).join(",")).join(" ");
      return `<polygon points="${points}" fill="${tri.fill}" stroke="rgba(30,34,40,0.18)" stroke-width="0.38"/>`;
    });

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Advanced 3D cat preview">`,
    `<rect width="100%" height="100%" fill="#f7f8fa"/>`,
    `<g>${polygons.join("\n")}</g>`,
    `<text x="28" y="${height - 26}" font-family="Arial, sans-serif" font-size="18" fill="#4d5562">Advanced 3D Cat - primitive tutorial mesh preview</text>`,
    `</svg>`,
  ].join("\n");

  fs.writeFileSync(PREVIEW_PATH, `${svg}\n`);
}

function writeNotes() {
  const bounds = getBounds();
  const notes = {
    sourceVideo: SOURCE_VIDEO,
    sourceTitle: SOURCE_TITLE,
    sourceAuthor: SOURCE_AUTHOR,
    outputFiles: {
      obj: OBJ_PATH,
      mtl: MTL_PATH,
      stl: STL_PATH,
      preview: PREVIEW_PATH,
      report: REPORT_PATH,
    },
    tutorialSteps,
    primitivePlan,
    boundsMillimeters: bounds,
    meshCount: meshes.length,
    vertexCount: meshes.reduce((sum, mesh) => sum + mesh.vertices.length, 0),
    faceCount: meshes.reduce((sum, mesh) => sum + mesh.faces.length, 0),
  };
  fs.writeFileSync(NOTES_PATH, `${JSON.stringify(notes, null, 2)}\n`);
}

function writeStepsMarkdown() {
  const lines = [
    "# Advanced 3D Cat Tinkercad Primitive Plan",
    "",
    `Source: ${SOURCE_TITLE} (${SOURCE_VIDEO})`,
    "",
    "| Stage | Part | Primitive | Solid/Hole | Dimensions | Position | Rotation | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...primitivePlan.map((row) => `| ${row.join(" | ")} |`),
    "",
    "Build order:",
    "",
    "1. Block out the head sphere and mirrored ears.",
    "2. Add muzzle lobes, nose bridge, nose, and mouth landmarks.",
    "3. Add the eye socket hints, white eyes, and dark pupils.",
    "4. Add the long tilted body and hidden cylinder neck.",
    "5. Add mirrored front legs, back legs, and half-sphere paws.",
    "6. Add the upright torus-slice tail.",
  ];
  fs.writeFileSync(STEPS_PATH, `${lines.join("\n")}\n`);
}

function writeReportHtml() {
  const preview = fs.readFileSync(PREVIEW_PATH, "utf8");
  const rows = primitivePlan
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Advanced 3D Cat Build Report</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #243042; background: #f4f6f8; }
    main { max-width: 1040px; margin: 0 auto; padding: 28px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { line-height: 1.45; }
    .preview { background: white; border: 1px solid #d7dde5; padding: 14px; }
    table { border-collapse: collapse; width: 100%; background: white; font-size: 13px; margin-top: 18px; }
    th, td { border: 1px solid #d7dde5; padding: 7px 8px; vertical-align: top; }
    th { background: #e9eef4; text-align: left; }
    code { background: #e9eef4; padding: 2px 4px; border-radius: 3px; }
  </style>
</head>
<body>
<main>
  <h1>Advanced 3D Cat</h1>
  <p>Primitive mesh reconstruction of <em>${SOURCE_TITLE}</em> by ${SOURCE_AUTHOR}. It follows the tutorial's Tinkercad logic: head sphere, mirrored paraboloid ears, overlapping muzzle spheres, roof nose, eye landmarks, tilted body, cylinder legs, half-sphere paws, and torus-slice tail.</p>
  <div class="preview">${preview}</div>
  <p>Generated files: <code>${path.basename(OBJ_PATH)}</code>, <code>${path.basename(MTL_PATH)}</code>, <code>${path.basename(STL_PATH)}</code>.</p>
  <table>
    <thead><tr><th>Stage</th><th>Part</th><th>Primitive</th><th>Solid/Hole</th><th>Dimensions</th><th>Position</th><th>Rotation</th><th>Notes</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</main>
</body>
</html>`;
  fs.writeFileSync(REPORT_PATH, html);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
buildCat();
writeMtl();
writeObj();
writeStl();
writePreviewSvg();
writeNotes();
writeStepsMarkdown();
writeReportHtml();

console.log(JSON.stringify({
  outDir: OUT_DIR,
  obj: OBJ_PATH,
  mtl: MTL_PATH,
  stl: STL_PATH,
  report: REPORT_PATH,
  bounds: getBounds(),
  meshes: meshes.length,
}, null, 2));
