# CAD Agent Factory

Hackathon MVP for a **Computer Use agent factory**: one Dispatch & Assembly Agent receives a modeling request, copies the same CAD Agent template into several Kernel computers, gives each CAD Agent instance a different prompt, then assembles the returned part manifests.

## Demo Idea

User prompt:

> Make a cute desktop robot with a purple head, green body, orange arms, blue wheel feet, and a small chest screen.

The Dispatch & Assembly Agent creates prompts such as:

- CAD Agent instance 01: build only the body
- CAD Agent instance 02: build only the head
- CAD Agent instance 03: build only the arms
- CAD Agent instance 04: build only the feet
- CAD Agent instance 05: build only details/accessories

All of those workers are the **same CAD Agent**. The only thing that changes is the prompt and the Kernel computer assigned to that instance. After the CAD Agent instances return manifests/screenshots, the Dispatch & Assembly Agent runs the final assembly step.

The monitor supports two execution backends. The default **Codex backend** creates deterministic CAD action plans and executes them through Kernel mouse clicks, which makes the hackathon demo reliable. **Northstar** remains available as a selectable backend for model-computer-use comparison.

## Demo Modes

- `npm run serve`: interactive Agent Factory monitor UI. Defaults to the reliable Codex backend.
- `npm run serve:northstar`: same monitor UI, but defaulting to Northstar/Lightcone.
- `npm run demo`: deterministic Kernel baseline. Useful for a reliable recording if network/API latency is bad during judging.
- `npm run demo:northstar`: script version of the Northstar + Kernel architecture.

## Run The Agent Factory UI

Requires:

- Kernel CLI installed and authenticated
- A Kernel account with browser access
- `TZAFON_API_KEY` set in the environment or in `.env.local` only if you want the Northstar backend

```bash
npm run serve
```

Open:

```text
http://127.0.0.1:8780/parallel-cad.html
```

If port `8780` is busy, the server automatically tries the next available port and prints the exact URL.

When you submit a prompt, the local server:

- decomposes the task into part-specific prompts
- creates one Kernel browser per copied CAD Agent instance plus one Dispatch & Assembly Agent Kernel
- clears the previous project by default, then switches the dashboard to the newest run
- opens a visible MiniCAD workbench in each Kernel
- starts either the Codex backend controller or the Northstar computer-use loop for each CAD Agent instance
- runs the CAD Agent instances in parallel, then runs the Dispatch & Assembly Agent
- streams screenshots, live view URLs, agent status, action count, and last action into the monitor dashboard

Use the UI's **Agent backend** selector to switch between `Codex backend`, `Northstar`, and `Monitor only`. You can also set `MONITOR_AGENT_BACKEND=codex`, `MONITOR_AGENT_BACKEND=northstar`, or `MONITOR_AGENT_BACKEND=off`.

## Run The Baseline Multi-Kernel Demo

```bash
npm run demo -- "Make a cute desktop robot with a purple head, green body, orange arms, blue wheel feet, and a small chest screen."
```

The run writes artifacts to:

```text
.lightcone-runs/parallel-cad-kernel-<timestamp>/
```

## Project Structure

```text
public/
  parallel-cad.html        Interactive Agent Factory monitor UI
  parallel-cad.css         UI styling
  parallel-cad.js          Dashboard polling and monitor rendering

scripts/
  monitor-server.mjs       Local API that creates Kernel sessions and agent backend loops
  parallel-cad-kernel-demo.mjs
                            Deterministic Kernel baseline demo
  northstar-parallel-kernel-demo.mjs
                            Scripted Northstar + Kernel demo

demo-results/latest/
  result.html              Recorded run report
  events.jsonl             Worker event log
  screenshots/             Worker and assembly screenshots
```

## Why This Matters

Single-agent computer use is bottlenecked by UI latency. CAD tasks are naturally decomposable, so one CAD Agent template can be copied across many Kernel computers. The Dispatch & Assembly Agent only writes prompts, routes work, and assembles results; the copied CAD Agents do the screen work in parallel.
