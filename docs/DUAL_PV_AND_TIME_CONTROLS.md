# Chess X-Ray v0.4.0 — Engine search and dual PV boards

## Tournament controls

Under Tournament, type an exact total game count (1 to 50,000). Pairings cycle fairly across the registered engines; optional reversed colors create two-leg pairs with matched FEN from the EPD book.

Three UCI search modes are implemented:

| Mode | Setting | UCI command | Ends |
| --- | --- | --- | --- |
| Clock + increment | Initial minutes, Fischer increment seconds | `go wtime ... btime ... winc ... binc ...` | Automatic / clock expiry |
| Fixed per move | Milliseconds per move | `go movetime N` | Automatic |
| Infinite (untimed) | Depth 0, nodes 0 | `go infinite` | Manual `Stop & Play bestmove` |
| Infinite (untimed) | Depth and/or nodes >0 | `go depth N nodes M` | Automatic on first reached cap |

UCI `infinite` itself **does not** obey finite caps: the two forms must be distinguished. Both are displayed as Infinite/untimed mode in the UI. The manual-stop button explicitly sends UCI `stop` and waits for `bestmove`.

### Real chess clocks

In clock mode, each player receives initial time at the start of the game. The GUI sends **both remaining times and both increments** on every move, deducts elapsed wall time from the active clock, detects flag falls, and adds the Fischer increment after a completed legal move. Pausing preserves remaining time; resuming restarts engines from the same position and remaining clocks. Clocks are shown during the match.

## White + Black PV boards

The PV column permanently shows separate White PV and Black PV sections at the same time. They have full 8×8 boards (not zoomed screenshots), independent 160–760px size sliders and corner-resize handles, clickable candidate move sequences, and step-by-step PV navigation. The Configure menu saves each board's size separately. The Wide dual-board view gives both boards substantially more room.

In Analysis, both white and black UCI engine processes analyze the **same** FEN concurrently. In a match, each side retains its most recently emitted PV, correctly associated with the FEN being searched. A past PV never masquerades as an evaluation of the next position.

## Caveat

Tests cover UCI command construction, exact game-count scheduling, color-paired FENs, and time increment arithmetic. Tests and installer builds cannot replace interactive tournament QA with many real engines.
