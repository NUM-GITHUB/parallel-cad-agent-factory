import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "cat_assets");
const OBJ_PATH = path.join(OUT_DIR, "small_3d_cat.obj");
const MTL_PATH = path.join(OUT_DIR, "small_3d_cat.mtl");
const STL_PATH = path.join(OUT_DIR, "small_3d_cat.stl");
const NOTES_PATH = path.join(OUT_DIR, "tutorial-notes.json");
const STEPS_PATH = path.join(OUT_DIR, "step-by-step.md");
const PREVIEW_PATH = path.join(OUT_DIR, "small_3d_cat_preview.svg");
const REPORT_PATH = path.join(OUT_DIR, "report.html");

const SOURCE_VIDEO = "https://www.youtube.com/watch?v=B88Jxg5LQac";
const SOURCE_TITLE = "Tinkercad Tutorial - How To Make A Small 3D Cat";
const SOURCE_AUTHOR = "Circuits With Angel";

const deg = (n) => (n * Math.PI) / 180;

const materials = {
  warmGray: [0.74, 0.74, 0.71],
  softGray: [0.88, 0.88, 0.85],
  shadowGray: [0.55, 0.55, 0.52],
  black: [0.015, 0.015, 0.018],
  nosePink: [0.88, 0.42, 0.58],
  lineBlue: [0.22, 0.30, 0.38],
};

const tutorialSteps = [
  {
    time: "00:28",
    title: "Body",
    note: "Add a sphere, scale it to 35 mm wide, 42 mm long, and 20 mm tall.",
  },
  {
    time: "00:41",
    title: "Eyes",
    note: "Add a 4 mm eye, raise it 10 mm, move it to the front, then copy, paste, and mirror it.",
  },
  {
    time: "00:58",
    title: "Front legs",
    note: "Use a paraboloid, rotate it 112.5 degrees, scale it to 8 mm wide, 18.95 mm long, and 7.95 mm tall, then mirror the pair.",
  },
  {
    time: "01:33",
    title: "Back legs",
    note: "Use another paraboloid, rotate it 135 degrees, scale it to 10.02 mm wide, 17.77 mm long, and 12 mm tall, angle it 22.5 degrees, then mirror it.",
  },
  {
    time: "02:14",
    title: "Ears",
    note: "Use paraboloids scaled to 7 mm wide, 10 mm long, and 8 mm tall, then rotate and mirror them above the eyes.",
  },
  {
    time: "02:38",
    title: "Tail",
    note: "Use a donut slice, rotate it 90 degrees and 22.5 degrees, then place it at the back of the body.",
  },
  {
    time: "02:59",
    title: "Nose",
    note: "Use a roof shape scaled to 1 mm wide, 5 mm long, and 1 mm tall, rotate it 90 degrees, and place it between the eyes.",
  },
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
    const phi = Math.PI * ring / rings;
    const z = Math.cos(phi) * rz;
    const r = Math.sin(phi);
    for (let segment = 0; segment < segments; segment += 1) {
      const theta = 2 * Math.PI * segment / segments;
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

function addParaboloid(name, material, radiusX, radiusY, length, transform = {}, segments = 32, rings = 12) {
  const vertices = [];
  const faces = [];

  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    const z = length * t;
    const r = Math.sqrt(1 - t);
    for (let segment = 0; segment < segments; segment += 1) {
      const theta = 2 * Math.PI * segment / segments;
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

function addTorusSlice(name, material, majorRadius, tubeRadius, startDeg, endDeg, transform = {}, radialSegments = 36, tubeSegments = 12) {
  const vertices = [];
  const faces = [];
  const start = deg(startDeg);
  const end = deg(endDeg);

  for (let i = 0; i <= radialSegments; i += 1) {
    const u = start + (end - start) * i / radialSegments;
    const centerX = Math.cos(u) * majorRadius;
    const centerY = Math.sin(u) * majorRadius;
    for (let j = 0; j < tubeSegments; j += 1) {
      const v = 2 * Math.PI * j / tubeSegments;
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

function addLeg(name, side, front) {
  if (front) {
    addParaboloid(`${name}_paraboloid_112_5deg`, "warmGray", 4, 3.975, 18.95, {
      translate: [side * 8.5, 12.5, 16],
      rotation: { x: -147, y: side * 7, z: side * 8 },
    });
    return;
  }

  addParaboloid(`${name}_paraboloid_135deg_22_5deg`, "warmGray", 5.01, 6, 17.77, {
    translate: [side * 10, -13.8, 13.5],
    rotation: { x: 133, y: side * -8, z: side * -6 },
  });
}

function addMirrorPair(prefix, addOne) {
  addOne(`${prefix}_left`, -1);
  addOne(`${prefix}_right`, 1);
}

function buildCat() {
  addEllipsoid("step_01_body_sphere_scaled_35x42x20", "warmGray", [17.5, 21, 10], {
    translate: [0, 0, 16],
  });

  addMirrorPair("step_02_eye_4mm", (name, side) => {
    addEllipsoid(name, "black", [2, 2, 2], {
      translate: [side * 6.7, 18.9, 18.6],
      scale: [1, 0.72, 1],
    }, 20, 10);
  });

  addMirrorPair("step_03_front_leg", (name, side) => addLeg(name, side, true));
  addMirrorPair("step_04_back_leg", (name, side) => addLeg(name, side, false));

  addMirrorPair("step_05_ear_paraboloid_7x10x8", (name, side) => {
    addParaboloid(name, "softGray", 3.5, 5, 8, {
      translate: [side * 8.2, 7.6, 22.5],
      rotation: { x: -12, y: side * 13, z: side * -22.5 },
    }, 28, 10);
    addCylinder(`${name}_crease`, "lineBlue", 0.28, 7.5, "z", {
      translate: [side * 7.4, 8.2, 26],
      rotation: { x: -20, y: side * 18, z: side * -22.5 },
    }, 8);
  });

  addTorusSlice("step_06_tail_donut_slice_rotated_90_and_22_5", "warmGray", 7.5, 1.6, -20, 205, {
    translate: [0, -20.5, 18.8],
    rotation: { x: 87, y: 22.5, z: 8 },
  });

  addTriPrism("step_07_nose_roof_1x5x1_rotated_90", "nosePink", 5, 1, 1.2, {
    translate: [0, 20.75, 15.9],
    rotation: { x: 90, y: 0, z: 180 },
  });

  addCylinder("thumbnail_mouth_left_curve", "lineBlue", 0.24, 4.8, "x", {
    translate: [-2.4, 20.4, 14.9],
    rotation: { z: -21 },
  }, 8);
  addCylinder("thumbnail_mouth_right_curve", "lineBlue", 0.24, 4.8, "x", {
    translate: [2.4, 20.4, 14.9],
    rotation: { z: 21 },
  }, 8);
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
  const lines = ["mtllib small_3d_cat.mtl"];
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
    lines.push("Ks 0.08000 0.08000 0.08000");
    lines.push("Ns 18");
    lines.push("");
  }
  fs.writeFileSync(MTL_PATH, lines.join("\n"));
}

function writeStl() {
  const lines = ["solid small_3d_cat_tinkercad_tutorial"];
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
  lines.push("endsolid small_3d_cat_tinkercad_tutorial");
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
  const yaw = deg(38);
  const pitch = deg(23);
  const light = [-0.35, -0.45, 0.82];
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
        const shade = 0.62 + Math.max(0, normal[0] * lightNorm[0] + normal[1] * lightNorm[1] + normal[2] * lightNorm[2]) * 0.38;
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
  const width = 880;
  const height = 560;
  const padding = 54;
  const scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxY - minY));
  const toSvg = ([x, y]) => [
    (x - minX) * scale + padding,
    (y - minY) * scale + padding,
  ];

  const polygons = triangles
    .sort((a, b) => a.depth - b.depth)
    .map((tri) => {
      const points = tri.projected.map((point) => toSvg(point).map(fmt).join(",")).join(" ");
      return `<polygon points="${points}" fill="${tri.fill}" stroke="rgba(30,34,40,0.24)" stroke-width="0.45"/>`;
    });

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Small 3D cat preview">`,
    `<rect width="100%" height="100%" fill="#f7f8fa"/>`,
    `<g>${polygons.join("\n")}</g>`,
    `<text x="24" y="${height - 24}" font-family="Arial, sans-serif" font-size="16" fill="#4d5562">Small 3D Cat - tutorial mesh preview</text>`,
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
    modeledFrom: tutorialSteps.map((step) => `${step.time} ${step.title}: ${step.note}`),
    generatedFiles: {
      obj: OBJ_PATH,
      mtl: MTL_PATH,
      stl: STL_PATH,
      preview: PREVIEW_PATH,
      report: REPORT_PATH,
    },
    meshCount: meshes.length,
    boundsMillimeters: bounds,
  };
  fs.writeFileSync(NOTES_PATH, `${JSON.stringify(notes, null, 2)}\n`);
}

function writeSteps() {
  const lines = [
    `# ${SOURCE_TITLE}`,
    "",
    `Source: ${SOURCE_VIDEO}`,
    `Author: ${SOURCE_AUTHOR}`,
    "",
    "This model follows the tutorial in timestamp order, translating each Tinkercad primitive into a local mesh.",
    "",
    ...tutorialSteps.flatMap((step, index) => [
      `## Step ${index + 1}: ${step.title} (${step.time})`,
      "",
      step.note,
      "",
    ]),
    "## Output",
    "",
    `- OBJ with materials: ${OBJ_PATH}`,
    `- STL for printing: ${STL_PATH}`,
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
        <td>${step.title}</td>
        <td>${step.note}</td>
      </tr>`).join("");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Small 3D Cat Model</title>
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
      max-width: 1040px;
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
      max-width: 880px;
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
    <h1>Small 3D Cat Model</h1>
    <p>Built from <a href="${SOURCE_VIDEO}">${SOURCE_TITLE}</a> by ${SOURCE_AUTHOR}. The OBJ keeps the light gray, black eye, and pink nose materials; the STL is plain geometry for slicers.</p>
    <img src="./small_3d_cat_preview.svg" alt="Small 3D cat preview">
    <table>
      <thead>
        <tr><th>Step</th><th>Time</th><th>Part</th><th>Build action</th></tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>
    <p style="margin-top: 22px;">Files: <code>small_3d_cat.obj</code>, <code>small_3d_cat.mtl</code>, <code>small_3d_cat.stl</code></p>
  </main>
</body>
</html>`;

  fs.writeFileSync(REPORT_PATH, `${html}\n`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
buildCat();
writeMtl();
writeObj();
writeStl();
writePreviewSvg();
writeNotes();
writeSteps();
writeReport();

const bounds = getBounds();
console.log(`Wrote ${meshes.length} meshes`);
console.log(`Bounds (mm): ${bounds.size.join(" x ")}`);
console.log(OBJ_PATH);
console.log(MTL_PATH);
console.log(STL_PATH);
console.log(PREVIEW_PATH);
