const promptInput = document.querySelector("#prompt");
const runButton = document.querySelector("#runButton");
const resetButton = document.querySelector("#resetButton");
const planList = document.querySelector("#planList");
const workerGrid = document.querySelector("#workerGrid");
const manifestEl = document.querySelector("#manifest");
const plannerStatus = document.querySelector("#plannerStatus");
const workerStatus = document.querySelector("#workerStatus");
const assemblyStatus = document.querySelector("#assemblyStatus");
const speedup = document.querySelector("#speedup");
const robot = document.querySelector("#robot");

const workerSpecs = [
  {
    id: "head",
    title: "Head worker",
    shapeClass: "shape-head",
    summary: "Builds the purple head, eyes, and antenna anchor.",
    manifest: { part: "head", kernel: "worker-head", size: [104, 74, 34], anchor: [0, 0, 150], color: "purple" },
  },
  {
    id: "body",
    title: "Body worker",
    shapeClass: "shape-body",
    summary: "Builds the green body and cyan status screen.",
    manifest: { part: "body", kernel: "worker-body", size: [136, 112, 42], anchor: [0, 0, 84], color: "green" },
  },
  {
    id: "arms",
    title: "Arm worker",
    shapeClass: "shape-arms",
    summary: "Builds mirrored orange arms with matching scale.",
    manifest: { part: "arms", kernel: "worker-arms", size: [210, 22, 22], anchor: [0, 0, 118], color: "orange" },
  },
  {
    id: "feet",
    title: "Feet worker",
    shapeClass: "shape-feet",
    summary: "Builds blue wheel-like feet and alignment anchors.",
    manifest: { part: "feet", kernel: "worker-feet", size: [150, 32, 32], anchor: [0, 0, 18], color: "blue" },
  },
];

function reset() {
  planList.innerHTML = "";
  workerGrid.innerHTML = "";
  robot.classList.remove("assembled");
  manifestEl.textContent = "{}";
  setStatus(plannerStatus, "idle", "idle");
  setStatus(workerStatus, "idle", "idle");
  setStatus(assemblyStatus, "idle", "idle");
  speedup.textContent = "waiting";
  runButton.disabled = false;
}

function setStatus(el, state, text) {
  el.className = `status ${state}`;
  el.textContent = text;
}

function renderWorkers() {
  workerGrid.innerHTML = workerSpecs
    .map(
      (worker) => `<article class="worker-card" id="worker-${worker.id}">
        <div class="worker-top">
          <h3>${worker.title}</h3>
          <span class="worker-time">queued</span>
        </div>
        <div class="worker-stage">
          <div class="worker-shape ${worker.shapeClass}"></div>
        </div>
        <p class="worker-log">${worker.summary}</p>
      </article>`,
    )
    .join("");
}

function makePlan(prompt) {
  const normalized = prompt.trim() || "Make a desktop robot.";
  return [
    ["Parse", `Understand request: "${normalized.slice(0, 92)}${normalized.length > 92 ? "..." : ""}"`],
    ["Decompose", "Split robot into independently buildable head, body, arms, and feet."],
    ["Parallelize", "Launch one Kernel per part so each computer-use worker manipulates its own CAD workspace."],
    ["Contract", "Each worker returns a part STL/design URL plus size and anchor metadata."],
    ["Assemble", "A final Kernel imports the parts, aligns anchors, groups the design, and captures QA screenshots."],
  ];
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runDemo() {
  runButton.disabled = true;
  renderWorkers();
  setStatus(plannerStatus, "running", "planning");
  setStatus(workerStatus, "idle", "queued");
  setStatus(assemblyStatus, "idle", "waiting");
  speedup.textContent = "planning";
  robot.classList.remove("assembled");
  manifestEl.textContent = "{}";
  planList.innerHTML = "";

  for (const [label, detail] of makePlan(promptInput.value)) {
    await wait(260);
    const item = document.createElement("li");
    item.innerHTML = `<strong>${label}:</strong> ${detail}`;
    planList.append(item);
  }

  setStatus(plannerStatus, "done", "planned");
  setStatus(workerStatus, "running", "building");
  speedup.textContent = "4.0x theoretical";

  await Promise.all(workerSpecs.map((worker, index) => runWorker(worker, index)));

  setStatus(workerStatus, "done", "parts ready");
  setStatus(assemblyStatus, "running", "assembling");
  manifestEl.textContent = JSON.stringify(
    {
      prompt: promptInput.value,
      strategy: "parallel-kernel-computer-use",
      parts: workerSpecs.map((worker) => worker.manifest),
      assembler: {
        kernel: "assembler",
        action: "align anchors, group, screenshot, export",
      },
    },
    null,
    2,
  );

  await wait(650);
  robot.classList.add("assembled");
  setStatus(assemblyStatus, "done", "assembled");
  speedup.textContent = "demo run complete";
  runButton.disabled = false;
}

async function runWorker(worker, index) {
  const card = document.querySelector(`#worker-${worker.id}`);
  const time = card.querySelector(".worker-time");
  const log = card.querySelector(".worker-log");
  await wait(420 + index * 120);
  card.classList.add("active");
  time.textContent = "Kernel boot";
  log.textContent = "Opening CAD workspace in a dedicated Kernel browser.";
  await wait(580 + index * 160);
  time.textContent = "Computer use";
  log.textContent = "Dragging primitives, setting color, and recording checkpoints.";
  await wait(820 + index * 130);
  card.classList.remove("active");
  card.classList.add("finished");
  time.textContent = "done";
  log.textContent = `${worker.summary} Manifest returned with size and anchor metadata.`;
}

runButton.addEventListener("click", runDemo);
resetButton.addEventListener("click", reset);

reset();
