# TreeDraft (Web)

TreeDraft is a lightweight, dependency-free web app for building and analyzing decision trees (decision / chance / terminal), with annotations (pen), sticky notes, and export to cropped PNG/PDF.

## Quick start

- **Run locally**: open `index.html` in a browser (no build step; static files).
- **Optional (recommended)**: run a tiny local server to avoid any browser “file://” quirks.

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Features

- **Decision trees**: decision / chance / terminal nodes with rollback values
- **Probabilities**: auto-balancing probabilities (optional)
- **Investment / cost**: per-node `Inv:` value (supports negatives)
- **Annotate**: pen (black/red), eraser (pen only), sticky notes
- **Export**: cropped PNG and PDF (via print view)
- **Undo/redo**: covers edits, moves, probabilities, pen strokes, notes
- **Copy/paste**: copy selected subtree and paste into another node

## Core concepts

- **Decision node**: chooses the best child (max rollback).
- **Chance node**: uses probability-weighted rollback.
- **Terminal node**: leaf payoff (this is where you enter the payoff).

## Usage

### Editing the tree

- **Select node**: click a node.
- **Add children**: use `+ Decision`, `+ Chance`, `+ Terminal` (adds to the currently selected node).
- **Delete**: deletes the currently selected item (node / note / pen stroke).
- **Convert node type**: `To Decision`, `To Chance`.
- **Edit numbers**: click a number (terminal value / probability %) to edit, press **Enter** to apply.

### Moving / reconnecting branches

- **Pan**: hold **Space** + drag (or drag empty canvas).
- **Zoom**: scroll wheel.
- **Box select**: **Shift + drag** on empty canvas.
- **Multi-select**: Ctrl+click nodes (toggle).
- **Select subtree**: Alt+click a node.
- **Reconnect / re-parent**: drag a node or a branch line and drop onto another node.
- **Context menu**: right-click a node.

### Probabilities

- Probabilities are shown on **outgoing branches from Chance nodes**.
- **Input formats**:
  - `0.2` (decimal)
  - `20` (assumed 20%)
  - `20%` (explicit percent)
- **Auto probabilities ON**:
  - Editing a branch marks it as “touched”.
  - Remaining (untouched) branches auto-balance to sum to 100%.
  - With 2 branches: the non-edited branch becomes the balancer (editing either one makes the other balance).
- **Auto probabilities OFF**:
  - You can input any numeric probability values; TreeDraft does not normalize siblings.

### Payoffs (terminal nodes)

- Terminal nodes show **`enter payoff`** until you edit the payoff.
- Click the terminal value to type a payoff (press **Enter** to apply).

### Decision investment / cost

- Decision nodes support an **investment/cost** value (`Inv:`), including negative values.
- Rollback includes that value:
  - Decision: \( Inv + max(children) \)
  - Chance: \( Inv + \sum p_i \cdot child_i \)
  - Terminal: \( payoff + Inv \)

### Tools: Select / Pen / Eraser / Note

- **Select (hand)**: normal editing and moving.
- **Pen**:
  - Draw freehand annotations.
  - Toggle pen color (black/red) with the small color dot.
- **Eraser**:
  - Erases **pen drawings only**.
  - Works like a thick eraser stroke (partial erase; drawings can split into pieces).
- **Note**:
  - Click to place a sticky note; after placing, TreeDraft auto-switches back to Select.
  - Click note to type.
  - Drag to move; bottom-right handle to resize.

## Keyboard shortcuts

- **Undo**: Ctrl+Z
- **Redo**: Ctrl+Y
- **Delete selection**: Delete / Backspace
- **Copy subtree**: Ctrl+C
- **Paste subtree**: Ctrl+V

## Export (cropped)

- **Image**: exports a cropped PNG of:
  - decision tree (nodes + links + labels + numbers)
  - pen drawings
  - sticky notes
- **PDF**: opens a print view of the same cropped export (use your browser’s “Save as PDF”).

If PDF export is blocked, allow popups for the page and try again.

## Deployment (Render)

This project is a static site (no build step). A `render.yaml` Blueprint is included for one-click deployment.

1. Push the repo to GitHub.
2. Go to [render.com](https://render.com) -> **New -> Blueprint**.
3. Connect the `artem-potlog/TreeDraft` repository.
4. Render detects `render.yaml` automatically and creates a **Static Site** service.
5. Click **Apply** -- the site is live in ~1 minute.

To add a custom domain (e.g. `treedraft.com`):
- In the Render dashboard open the service -> **Settings -> Custom Domains**.
- Add `treedraft.com` and `www.treedraft.com`.
- Update your Namecheap DNS: replace the old `A`/`CNAME` records with the values Render shows (typically a `CNAME` pointing to `<service>.onrender.com`).
## Privacy

TreeDraft runs fully in the browser. It does not require a backend server.

## Project structure

- `index.html`: UI layout
- `style.css`: styling
- `script.js`: logic (tree model, rendering, interaction, export)

## Author

Artem Potlog — `https://www.linkedin.com/in/artem-potlog`

## License

MIT License. See `LICENSE`.

