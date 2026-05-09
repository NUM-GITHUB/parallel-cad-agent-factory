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

This follows the Lightcone + Kernel pattern: Kernel supplies the browser computer, Lightcone/Northstar decides the next computer action from screenshots, then the loop executes that action and sends back the next screenshot.

## Demo Modes

- `npm run serve`: interactive Agent Factory monitor UI. Enter a prompt, create copied CAD Agent instances, and watch screenshots/status refresh.
- `npm run demo`: deterministic Kernel baseline. Useful for a reliable recording if network/API latency is bad during judging.
- `npm run demo:northstar`: script version of the Northstar + Kernel architecture.

## Run The Agent Factory UI

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

- decomposes the task into part-specific prompts
- creates one Kernel browser per copied CAD Agent instance plus one Dispatch & Assembly Agent Kernel
- switches the dashboard to the newest run without stopping older runs
- opens a visible MiniCAD workbench in each Kernel
- starts one Northstar computer-use loop per CAD Agent instance
- runs the CAD Agent instances in parallel, then runs the Dispatch & Assembly Agent
- streams screenshots, live view URLs, agent status, action count, and last action into the monitor dashboard

Set `MONITOR_AGENT_MODE=off` to use the UI as a screenshot-only Kernel monitor without Northstar agent loops.

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
  monitor-server.mjs       Local API that creates Kernel sessions and Northstar loops
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
