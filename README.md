# Parallel CAD Agent Factory

Hackathon MVP for a **Computer Use** workflow: split one 3D modeling prompt into independent part-building tasks, run several Kernel browser computers in parallel, let a Northstar computer-use agent manage each Kernel, and assemble the resulting parts into one robot preview.

## Demo Idea

User prompt:

> Make a cute desktop robot with a purple head, green body, orange arms, blue wheel feet, and a small chest screen.

The system turns that into:

- `head` worker
- `body` worker
- `arms` worker
- `feet` worker
- `assembler` worker

The intended architecture is prompt-driven:

- The main agent only decomposes the user's request and writes worker prompts.
- Each worker gets its own Kernel browser computer.
- Each Kernel is controlled by its own Northstar computer-use loop.
- The assembler gets its own Kernel + Northstar loop, receives worker manifests/screenshots, and assembles the final combined preview through the UI.

That means the main agent is not hardcoding the modeling actions. It assigns work like "build the head" or "build the arms"; each Northstar worker observes its own screen and decides the UI actions for that part.

This follows the Lightcone + Kernel pattern: Kernel supplies the browser computer, Lightcone/Northstar decides the next computer action from screenshots, then the loop executes that action and sends back the next screenshot.

## Demo Modes

This repo includes two modes:

- `npm run serve`: interactive Kernel monitor UI. Enter a prompt, create the matching Kernel workers, and watch screenshots refresh every few seconds.
- `npm run demo`: deterministic Kernel baseline. Useful for a reliable recording if network/API latency is bad during judging.
- `npm run demo:northstar`: intended hackathon architecture. The main planner writes prompts, then each worker and the assembler run separate Northstar + Kernel computer-use loops.

## Run The Kernel Monitor UI

Requires:

- Kernel CLI installed and authenticated
- A Kernel account with browser access
- `TZAFON_API_KEY` set in the environment or in `.env.local`

```bash
npm run serve
```

Open:

```text
http://127.0.0.1:8780/parallel-cad.html
```

If port `8780` is busy, the server automatically tries the next available port and prints the exact URL.

When you submit a prompt, the local server:

- decomposes the task into worker prompts
- creates one Kernel browser per worker plus an assembler Kernel
- opens a visible CAD workbench in each Kernel
- starts one Northstar computer-use loop per worker Kernel
- runs the part workers in parallel, then runs the assembler worker
- captures screenshots every few seconds
- streams each Kernel's latest screenshot, live view URL, agent status, action count, and last action into the monitor dashboard

Set `MONITOR_AGENT_MODE=off` to use the UI as a screenshot-only Kernel monitor without Northstar agent loops.

## Run The Baseline Multi-Kernel Demo

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

## Run The Northstar + Kernel Demo

Requires:

- `TZAFON_API_KEY` set in the environment or in `.env.local`
- Kernel CLI installed and authenticated
- `npm install` already run

```bash
npm run demo:northstar -- "Make a cute desktop robot with a purple head, green body, orange arms, blue wheel feet, and a small chest screen."
```

The run writes artifacts to:

```text
.lightcone-runs/northstar-parallel-cad-<timestamp>/
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
  parallel-cad.html        Interactive Kernel monitor UI
  parallel-cad.css         UI styling
  parallel-cad.js          Dashboard polling and monitor rendering

scripts/
  monitor-server.mjs       Local API that creates Kernel sessions and refreshes screenshots

  parallel-cad-kernel-demo.mjs
                            Deterministic Kernel baseline demo

  northstar-parallel-kernel-demo.mjs
                            Main planner + parallel Northstar worker demo

demo-results/latest/
  result.html              Recorded run report
  events.jsonl             Worker event log
  screenshots/             Worker and assembler screenshots
```

## Why This Matters

Single-agent computer use is often bottlenecked by UI latency. CAD tasks are naturally decomposable: head, body, arms, legs, accessories, colors, and final alignment can be worked on independently. This demo shows the core pattern for turning one slow UI operator into a parallel agent factory.
