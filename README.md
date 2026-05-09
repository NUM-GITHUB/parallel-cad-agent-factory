# Parallel CAD Agent Factory

Hackathon MVP for a **Computer Use** workflow: split one 3D modeling prompt into independent part-building tasks, run several Kernel browser computers in parallel, and assemble the resulting parts into one robot preview.

## Demo Idea

User prompt:

> Make a cute desktop robot with a purple head, green body, orange arms, blue wheel feet, and a small chest screen.

The system turns that into:

- `head` worker
- `body` worker
- `arms` worker
- `feet` worker
- `assembler` worker

Each worker opens its own Kernel browser and uses OS-level computer actions to drag visible CAD primitives into a workplane. The assembler then combines the worker manifests into a final robot preview.

## Run The Local UI

```bash
npm run serve
```

Open:

```text
http://127.0.0.1:8780/parallel-cad.html
```

## Run The Multi-Kernel Demo

Requires:

- Kernel CLI installed and authenticated
- A Kernel account with browser access

```bash
npm run demo -- "Make a cute desktop robot with a purple head, green body, orange arms, blue wheel feet, and a small chest screen."
```

The run writes artifacts to:

```text
.lightcone-runs/parallel-cad-kernel-<timestamp>/
```

## Included Recorded Run

The latest captured run is included under:

```text
demo-results/latest/
```

Serve it with:

```bash
npm run serve:latest
```

Open:

```text
http://127.0.0.1:8781/result.html
```

## Project Structure

```text
public/
  parallel-cad.html        Local demo control panel
  parallel-cad.css         UI styling
  parallel-cad.js          Planner/worker/assembler simulation UI

scripts/
  parallel-cad-kernel-demo.mjs
                            Real Kernel orchestration demo

demo-results/latest/
  result.html              Recorded run report
  events.jsonl             Worker event log
  screenshots/             Worker and assembler screenshots
```

## Why This Matters

Single-agent computer use is often bottlenecked by UI latency. CAD tasks are naturally decomposable: head, body, arms, legs, accessories, colors, and final alignment can be worked on independently. This demo shows the core pattern for turning one slow UI operator into a parallel agent factory.

