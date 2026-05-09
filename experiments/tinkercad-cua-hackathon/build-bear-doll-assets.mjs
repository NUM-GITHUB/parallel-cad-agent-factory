import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "bear_doll_assets");
const OBJ_PATH = path.join(OUT_DIR, "bear_doll.obj");
const MTL_PATH = path.join(OUT_DIR, "bear_doll.mtl");
const ALL_STL_PATH = path.join(OUT_DIR, "bear_doll_all.stl");
const BODY_STL_PATH = path.join(OUT_DIR, "bear_doll_body.stl");
const CREAM_STL_PATH = path.join(OUT_DIR, "bear_doll_cream.stl");
const BLACK_STL_PATH = path.join(OUT_DIR, "bear_doll_black.stl");
const TEXT_STL_PATH = path.join(OUT_DIR, "bear_doll_text.stl");
const NOTES_PATH = path.join(OUT_DIR, "tutorial-notes.json");
const STEPS_PATH = path.join(OUT_DIR, "step-by-step.md");
const PREVIEW_PATH = path.join(OUT_DIR, "bear_doll_preview.svg");
const REPORT_PATH = path.join(OUT_DIR, "report.html");

const SOURCE_VIDEO = "https://www.youtube.com/watch?v=fs2h1acNG38";
const SOURCE_TITLE = "[1DAY_1CAD] BEAR DOLL (Tinkercad : Know-how / Style / Education)";
const SOURCE_AUTHOR = "1DAY_1CAD : Tinkercad 3D Design";

const deg = (n) => (n * Math.PI) / 180;

const materials = {
  bodyTan: [0.72, 0.58, 0.36],
  creamTan: [0.88, 0.76, 0.53],
  black: [0.025, 0.022, 0.018],
  textYellow: [0.94, 0.67, 0.08],
};

const tutorialSteps = [
  {
    time: "00:00",
    part: "Reference silhouette",
    primitive: "assembled primitives",
    note: "The finished model is a seated teddy-bear doll with a round head, oval body, protruding muzzle, side ears, small black eyes, arms, feet, and BEAR DOLL text.",
  },
  {
    time: "01:00",
    part: "Head and body",
    primitive: "sphere/ellipsoid",
    note: "Block the main silhouette with large rounded spheres before adding details.",
  },
  {
    time: "02:00",
    part: "Muzzle and face base",
    primitive: "flattened sphere",
    note: "Add a shallow oval muzzle on the front of the head, then keep later eye and nose landmarks aligned to it.",
  },
  {
    time: "04:30",
    part: "Eyes, nose, ears",
    primitive: "small spheres/ellipsoids",
    note: "Mirror small black eyes and a nose across the centerline; add round side ears with lighter inner pads.",
  },
  {
    time: "06:00",
    part: "Body assembly",
    primitive: "ellipsoid body plus belly patch",
    note: "Place the body under the head with a pale oval belly patch, preserving the plush doll proportions.",
  },
  {
    time: "08:30",
    part: "Arms",
    primitive: "rotated ellipsoid",
    note: "Use mirrored tapered oval arms that hang down the sides of the body.",
  },
  {
    time: "10:00",
    part: "Legs and feet",
    primitive: "rotated ellipsoid",
    note: "Use forward-facing oval feet and small sole pads so the doll reads as seated.",
  },
  {
    time: "12:00",
    part: "Final title",
    primitive: "extruded block text",
    note: "Add BEAR DOLL text as flat yellow geometry on the workplane next to the doll.",
  },
];

const buildPlan = [
  ["1", "Body", "sphere/ellipsoid", "solid", "46 x 36 x 54 mm", "0, 0, 31", "0,0,0", "Large seated plush body"],
  ["2", "Head", "sphere/ellipsoid", "solid", "42 x 39 x 42 mm", "0, -6, 66", "0,0,0", "Round head sitting into body"],
  ["3", "Muzzle", "flattened sphere", "solid", "21 x 8 x 14 mm", "0, -25, 62", "0,0,0", "Pale protruding mouth area"],
  ["4", "Ears", "sphere/ellipsoid pair", "solid", "15 x 9 x 15 mm", "+/-17, -6, 84", "0,0,+/-10", "Mirrored rounded ears"],
  ["5", "Eyes and nose", "small ellipsoids", "solid", "3-7 mm landmarks", "front face", "0,0,0", "Black mirrored landmarks"],
  ["6", "Arms", "rotated ellipsoid pair", "solid", "13 x 16 x 36 mm", "+/-27, -2, 37", "0,0,+/-18", "Drooping plush arms"],
  ["7", "Feet and pads", "ellipsoid pairs", "solid", "16 x 29 x 12 mm", "+/-13, -18, 12", "0,0,+/-8", "Seated forward feet"],
  ["8", "Title", "extruded block text", "solid", "flat 2.5 mm letters", "-84, 20, 0", "0,0,0", "BEAR DOLL workplane label"],
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

function addCylinder(name, material, radius, length, axis = "z", transform = {}, segments = 18) {
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

function addBox(name, material, size, transform = {}) {
  const [width, depth, height] = size;
  const x = width / 2;
  const y = depth / 2;
  const z = height / 2;
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

function addMirrorPair(prefix, addOne) {
  addOne(`${prefix}_left`, -1);
  addOne(`${prefix}_right`, 1);
}

const blockFont = {
  B: ["1110", "1001", "1001", "1110", "1001", "1001", "1110"],
  E: ["1111", "1000", "1000", "1110", "1000", "1000", "1111"],
  A: ["0110", "1001", "1001", "1111", "1001", "1001", "1001"],
  R: ["1110", "1001", "1001", "1110", "1010", "1001", "1001"],
  D: ["1110", "1001", "1001", "1001", "1001", "1001", "1110"],
  O: ["0110", "1001", "1001", "1001", "1001", "1001", "0110"],
  L: ["1000", "1000", "1000", "1000", "1000", "1000", "1111"],
};

function addBlockWord(word, originX, originY, namePrefix) {
  const cell = 3.6;
  const gap = 0.45;
  const letterGap = 2.2;
  const depth = 2.5;
  let x = originX;

  for (const letter of word) {
    const pattern = blockFont[letter];
    for (let row = 0; row < pattern.length; row += 1) {
      for (let col = 0; col < pattern[row].length; col += 1) {
        if (pattern[row][col] !== "1") continue;
        addBox(`${namePrefix}_${letter}_${row}_${col}`, "textYellow", [cell - gap, cell - gap, depth], {
          translate: [
            x + col * cell + cell / 2,
            originY - row * cell - cell / 2,
            depth / 2,
          ],
        });
      }
    }
    x += pattern[0].length * cell + letterGap;
  }
}

function buildBearDoll() {
  addEllipsoid("step_01_body_large_ellipsoid", "bodyTan", [23, 18, 27], {
    translate: [0, 1, 31],
  });

  addEllipsoid("step_01_head_round_sphere", "bodyTan", [21.5, 19.5, 21], {
    translate: [0, -5, 66],
  });

  addEllipsoid("step_02_muzzle_flattened_sphere", "creamTan", [10.5, 4.6, 7.2], {
    translate: [0, -22.3, 62.2],
    rotation: { x: -4 },
  }, 28, 12);

  addEllipsoid("step_05_belly_patch_flattened_sphere", "creamTan", [12.5, 3.2, 16.5], {
    translate: [0, -17.4, 33.6],
    rotation: { x: 2 },
  }, 28, 12);

  addMirrorPair("step_04_ear_outer_sphere", (name, side) => {
    addEllipsoid(name, "bodyTan", [7.8, 5.2, 8.5], {
      translate: [side * 17.2, -5.8, 84.3],
      rotation: { x: 4, y: side * -12, z: side * 10 },
    }, 24, 12);
    addEllipsoid(`${name}_inner_pad`, "creamTan", [5.3, 2.1, 5.8], {
      translate: [side * 17.2, -10.0, 83.7],
      rotation: { x: 4, y: side * -12, z: side * 10 },
    }, 18, 10);
  });

  addMirrorPair("step_04_eye_black_sphere", (name, side) => {
    addEllipsoid(name, "black", [2.1, 1.25, 3.0], {
      translate: [side * 8.1, -22.6, 70.6],
      rotation: { x: -6, y: side * 5 },
    }, 18, 10);
  });

  addEllipsoid("step_04_nose_black_oval", "black", [3.9, 1.45, 3.0], {
    translate: [0, -26.5, 63.6],
    rotation: { x: -3 },
  }, 20, 10);

  addCylinder("step_04_mouth_left_short_curve", "black", 0.42, 6.0, "x", {
    translate: [-2.7, -26.2, 58.8],
    rotation: { x: -3, z: -18 },
  }, 8);
  addCylinder("step_04_mouth_right_short_curve", "black", 0.42, 6.0, "x", {
    translate: [2.7, -26.2, 58.8],
    rotation: { x: -3, z: 18 },
  }, 8);

  addMirrorPair("step_06_arm_drooping_ellipsoid", (name, side) => {
    addEllipsoid(name, "bodyTan", [6.7, 7.5, 19.5], {
      translate: [side * 25.2, -2.2, 37.5],
      rotation: { x: -6, y: side * 2, z: side * 16 },
    }, 28, 12);
  });

  addMirrorPair("step_07_foot_forward_ellipsoid", (name, side) => {
    addEllipsoid(name, "bodyTan", [8.3, 15.5, 6.5], {
      translate: [side * 12.8, -14.8, 12.3],
      rotation: { x: 3, y: side * -8, z: side * 6 },
    }, 28, 12);
    addEllipsoid(`${name}_sole_pad`, "creamTan", [5.0, 9.2, 2.0], {
      translate: [side * 12.8, -24.0, 12.4],
      rotation: { x: 9, y: side * -8, z: side * 6 },
    }, 18, 8);
  });

  addMirrorPair("step_07_side_leg_round_hip", (name, side) => {
    addEllipsoid(name, "bodyTan", [8.0, 7.5, 11.5], {
      translate: [side * 15.7, -7.0, 24.0],
      rotation: { x: -8, y: side * -6, z: side * 9 },
    }, 22, 10);
  });

  for (const [index, z] of [42.0, 34.7, 27.4].entries()) {
    addEllipsoid(`step_10_belly_button_${index + 1}`, "black", [1.2, 0.75, 1.2], {
      translate: [0, -20.9, z],
    }, 12, 8);
  }

  addBlockWord("BEAR", -90, 24, "step_08_text_bear");
  addBlockWord("DOLL", -90, -7, "step_08_text_doll");
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
  const lines = ["mtllib bear_doll.mtl"];
  let indexOffset = 1;

  for (const mesh of meshes) {
    lines.push("", `o ${mesh.name}`, `usemtl ${mesh.material}`);
    for (const vertex of mesh.vertices) lines.push(`v ${vertex.map(fmt).join(" ")}`);
    for (const face of mesh.faces) lines.push(`f ${face.map((i) => i + indexOffset).join(" ")}`);
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
    lines.push("Ns 22");
    lines.push("");
  }
  fs.writeFileSync(MTL_PATH, lines.join("\n"));
}

function writeStl(filePath, selectedMaterials, solidName) {
  const selected = selectedMaterials ? new Set(selectedMaterials) : null;
  const lines = [`solid ${solidName}`];
  for (const mesh of meshes) {
    if (selected && !selected.has(mesh.material)) continue;
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
  lines.push(`endsolid ${solidName}`);
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function getBounds(filterMaterials = null) {
  const selected = filterMaterials ? new Set(filterMaterials) : null;
  const points = meshes
    .filter((mesh) => !selected || selected.has(mesh.material))
    .flatMap((mesh) => mesh.vertices);
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
  const yaw = deg(4);
  const pitch = deg(24);
  const light = [-0.4, -0.42, 0.82];
  const lightLen = Math.hypot(...light);
  const lightNorm = light.map((n) => n / lightLen);

  const projectRaw = ([x, y, z]) => {
    let px = x * Math.cos(yaw) - y * Math.sin(yaw);
    let py = x * Math.sin(yaw) + y * Math.cos(yaw);
    let pz = z;
    const ppy = py * Math.cos(pitch) - pz * Math.sin(pitch);
    const ppz = py * Math.sin(pitch) + pz * Math.cos(pitch);
    return [px, -ppy, ppz];
  };

  for (const mesh of meshes) {
    for (const face of mesh.faces) {
      for (const tri of triangulateFace(face)) {
        const vertices = tri.map((i) => mesh.vertices[i]);
        const normal = normalOf(...vertices);
        const brightness = Math.max(0, normal[0] * lightNorm[0] + normal[1] * lightNorm[1] + normal[2] * lightNorm[2]);
        const shade = 0.62 + brightness * 0.38;
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
  const width = 960;
  const height = 620;
  const padding = 132;
  const scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxY - minY));
  const toSvg = ([x, y]) => [
    (x - minX) * scale + padding,
    (y - minY) * scale + padding,
  ];

  const polygons = triangles
    .sort((a, b) => a.depth - b.depth)
    .map((tri) => {
      const points = tri.projected.map((point) => toSvg(point).map(fmt).join(",")).join(" ");
      return `<polygon points="${points}" fill="${tri.fill}" stroke="rgba(39,31,20,0.24)" stroke-width="0.42"/>`;
    });

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Bear Doll tutorial model preview">`,
    `<rect width="100%" height="100%" fill="#f7f8fa"/>`,
    `<g>${polygons.join("\n")}</g>`,
    `<text x="24" y="${height - 24}" font-family="Arial, sans-serif" font-size="16" fill="#4d5562">Bear Doll - tutorial primitive mesh preview</text>`,
    `</svg>`,
  ].join("\n");

  fs.writeFileSync(PREVIEW_PATH, `${svg}\n`);
}

function writeNotes() {
  const notes = {
    sourceVideo: SOURCE_VIDEO,
    sourceTitle: SOURCE_TITLE,
    sourceAuthor: SOURCE_AUTHOR,
    buildPlan: buildPlan.map(([stage, part, primitive, solidHole, dimensions, position, rotation, notes]) => ({
      stage,
      part,
      primitive,
      solidHole,
      dimensions,
      position,
      rotation,
      notes,
    })),
    modeledFrom: tutorialSteps.map((step) => `${step.time} ${step.part}: ${step.note}`),
    generatedFiles: {
      obj: OBJ_PATH,
      mtl: MTL_PATH,
      stlAll: ALL_STL_PATH,
      stlBody: BODY_STL_PATH,
      stlCream: CREAM_STL_PATH,
      stlBlack: BLACK_STL_PATH,
      stlText: TEXT_STL_PATH,
      preview: PREVIEW_PATH,
      report: REPORT_PATH,
    },
    meshCount: meshes.length,
    boundsMillimeters: {
      all: getBounds(),
      body: getBounds(["bodyTan"]),
      cream: getBounds(["creamTan"]),
      black: getBounds(["black"]),
      text: getBounds(["textYellow"]),
    },
  };
  fs.writeFileSync(NOTES_PATH, `${JSON.stringify(notes, null, 2)}\n`);
}

function writeSteps() {
  const table = [
    "| Stage | Part | Primitive | Solid/Hole | Dimensions | Position | Rotation | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...buildPlan.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");

  const lines = [
    `# ${SOURCE_TITLE}`,
    "",
    `Source: ${SOURCE_VIDEO}`,
    `Author: ${SOURCE_AUTHOR}`,
    "",
    "This build follows the tutorial as a Tinkercad-style primitive assembly: large rounded masses first, mirrored appendages second, face landmarks third, and flat title text last.",
    "",
    "## Primitive Plan",
    "",
    table,
    "",
    "## Tutorial Stages",
    "",
    ...tutorialSteps.flatMap((step, index) => [
      `### Step ${index + 1}: ${step.part} (${step.time})`,
      "",
      `Primitive: ${step.primitive}`,
      "",
      step.note,
      "",
    ]),
    "## Output",
    "",
    `- OBJ with materials: ${OBJ_PATH}`,
    `- STL for all geometry: ${ALL_STL_PATH}`,
    `- Separate color STLs: ${BODY_STL_PATH}, ${CREAM_STL_PATH}, ${BLACK_STL_PATH}, ${TEXT_STL_PATH}`,
    `- Preview: ${PREVIEW_PATH}`,
    "",
  ];
  fs.writeFileSync(STEPS_PATH, `${lines.join("\n")}`);
}

function writeReport() {
  const rows = tutorialSteps.map((step, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${step.time}</td>
        <td>${step.part}</td>
        <td>${step.primitive}</td>
        <td>${step.note}</td>
      </tr>`).join("");

  const planRows = buildPlan.map((row) => `
      <tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bear Doll Model</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #1f2933;
      background: #f6f7f9;
    }
    body {
      margin: 0;
      padding: 32px;
    }
    main {
      max-width: 1080px;
      margin: 0 auto;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 28px;
      letter-spacing: 0;
    }
    p {
      margin: 0 0 22px;
      color: #4b5563;
      line-height: 1.5;
    }
    img {
      display: block;
      width: 100%;
      max-width: 960px;
      border: 1px solid #d7dce3;
      background: white;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 28px;
      background: white;
      border: 1px solid #d7dce3;
    }
    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid #e5e8ee;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th {
      color: #374151;
      background: #eef1f5;
    }
    code {
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <main>
    <h1>Bear Doll Model</h1>
    <p>Built from <a href="${SOURCE_VIDEO}">${SOURCE_TITLE}</a> by ${SOURCE_AUTHOR}. The OBJ preserves the tan, cream, black, and yellow materials; the separate STLs are intended for importing as colorable Tinkercad objects.</p>
    <img src="./bear_doll_preview.svg" alt="Bear Doll preview">
    <table>
      <thead>
        <tr><th>Stage</th><th>Part</th><th>Primitive</th><th>Solid/Hole</th><th>Dimensions</th><th>Position</th><th>Rotation</th><th>Notes</th></tr>
      </thead>
      <tbody>${planRows}
      </tbody>
    </table>
    <table>
      <thead>
        <tr><th>Step</th><th>Time</th><th>Part</th><th>Primitive</th><th>Build action</th></tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>
    <p style="margin-top: 22px;">Files: <code>bear_doll.obj</code>, <code>bear_doll.mtl</code>, <code>bear_doll_all.stl</code>, and separate color STLs.</p>
  </main>
</body>
</html>`;

  fs.writeFileSync(REPORT_PATH, `${html}\n`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
buildBearDoll();
writeMtl();
writeObj();
writeStl(ALL_STL_PATH, null, "bear_doll_all");
writeStl(BODY_STL_PATH, ["bodyTan"], "bear_doll_body");
writeStl(CREAM_STL_PATH, ["creamTan"], "bear_doll_cream");
writeStl(BLACK_STL_PATH, ["black"], "bear_doll_black");
writeStl(TEXT_STL_PATH, ["textYellow"], "bear_doll_text");
writePreviewSvg();
writeNotes();
writeSteps();
writeReport();

const bounds = getBounds();
console.log(`Wrote ${meshes.length} meshes`);
console.log(`Bounds (mm): ${bounds.size.join(" x ")}`);
console.log(OBJ_PATH);
console.log(MTL_PATH);
console.log(ALL_STL_PATH);
console.log(PREVIEW_PATH);
