# Tinkercad CUA Hackathon

Browser automation experiments that pair Kernel cloud browsers with Tzafon Northstar computer-use actions to operate Tinkercad and generate 3D model assets.

## Why we built this

Creating 3D models is still surprisingly manual, even when the desired object is easy to describe. A beginner can say "make a small cat" or "turn this tutorial into a printable model," but actually producing that result usually requires watching long videos, translating visual steps into CAD operations, placing shapes by hand, exporting assets, and repeating the process whenever something needs to change.

We built this project to close that gap between intent and creation. By pairing a cloud browser with a computer-use model, the system can operate Tinkercad directly: opening the editor, following UI steps, placing primitives, importing generated STL files, and documenting the output. The pain point it solves is not just speed; it makes browser-based 3D design more accessible to people who have ideas but do not yet know the CAD workflow.

For hackathon builders, educators, and makers, this means tutorials, sketches, and plain-language prompts can become reusable 3D assets faster. Instead of treating Tinkercad as a purely manual tool, this project explores what it looks like when an AI agent can collaborate inside the same visual workspace a human would use.

## What is included

- `tinkercad-builder-app.mjs` - Kernel app that logs into Tinkercad, opens the 3D editor, and hands the browser to Northstar to create a simple design.
- `tinkercad-advanced-cat-primitives.mjs` - primitive-based Tinkercad construction run for an advanced cat model.
- `tinkercad-import-bear-doll.mjs`, `tinkercad-advanced-cat-import.mjs`, and `tinkercad-fortnite-llama.mjs` - import generated STL assets into Tinkercad.
- `build-*-assets.mjs` - local asset generators for printable/exportable STL, OBJ, SVG preview, and HTML reports.
- `cat_assets/`, `advanced_cat_assets/`, `bear_doll_assets/`, and `llama_assets/` - generated 3D assets and build notes.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` with `KERNEL_API_KEY` and `TZAFON_API_KEY`. Add `TINKERCAD_EMAIL` and `TINKERCAD_PASSWORD` only for scripts that need to sign in to Tinkercad.

## Run

Deploy the Kernel app:

```bash
npx kernel deploy tinkercad-builder-app.mjs --env-file .env
npx kernel invoke tinkercad-builder build
```

Generate assets locally:

```bash
node build-small-3d-cat-assets.mjs
node build-advanced-3d-cat-assets.mjs
node build-bear-doll-assets.mjs
node build-fortnite-llama-assets.mjs
```

## Notes

Local `.env`, downloaded videos, dependency folders, and one-off browser run outputs are ignored so the repository can stay public and reproducible without publishing secrets or bulky scratch files.
