# Chess X-Ray 0.2

Windows desktop chess engine observatory built with Rust + Tauri 2 + React.

## Main application menus (top-left)

- **Configure**: individually adjustable main board size, PV panel width, PV preview board size and PV font size. Layout is saved locally. Board-first mode makes the chessboard the primary center-column element. Drag the grip beside the PV panel to resize it directly.
- **Engines**: add UCI Windows EXE engines to a persistent library, rename entries, inspect actual UCI options, edit spin/check/combo/string option values, assign an engine as white or black.
- **Tournament**: select multiple registered entrants, set tournament cycles, reversed-color legs, thinking time per move, and maximum ply count. Automatically run a round-robin series and see live schedule, tournament points, results and locally estimated Elo. Pause preserves the current FEN so the same game can be resumed with fresh engine processes.

## Analysis and board

- Official, bundled Stockfish 19 x86-64 universal (GPLv3), fetched from the official upstream release during Windows builds.
- MultiPV, interactive miniature chessboards after each candidate variation, SAN, legal FEN load, PGN copy, move-arrow overlay (including Hikaru mode), flip board, move input.
- UCI depth, search nodes, NPS, hash occupancy, optional WDL, configurable graph types, local rankings, and a variation-prefix search tree.
- Optional Stockless X-Ray instrumentation is documented in docs/INSTRUMENTATION.md. Missing TT hit rate and NNUE metrics are explicitly UNAVAILABLE rather than guessed.

## Ratings

The reference is Stockfish 19 at CCRL 40/15, 4 CPU, 3650 Elo dated 2026-10-16. This is an external anchor, not an equivalent local benchmark. All other Elo values are provisional, locally estimated and distinct from official CCRL ratings.

## Installation

Download Windows EXE or MSI from https://github.com/gaong5247-cmd/chess-xray/releases/latest

## Build

Requires Node.js 22+, Rust stable, Microsoft C++ Build Tools, WebView2.

    npm install
    npm run desktop:dev
    npm run desktop:build

Windows GitHub Actions builds NSIS and MSI and publishes a release when the main branch updates.

License: GPL-3.0-or-later. Lichess Cburnett chess pieces GPL-2.0-or-later. Third-party notices are in THIRD_PARTY_NOTICES.md. Not affiliated with Stockfish, Lichess, TCEC, CCC or CCRL.

## Opening books (.epd)

In **Tournament** choose **Select .epd file**, then **Random FEN from EPD** to start every game from a random sampled position. Return games with swapped colors use the same FEN by default; this can be toggled off. The app streams multi-million-line books into a bounded 4,096-position reservoir and checks selected sample candidates with chess.js, with no file upload.

Detailed usage: [EPD opening books](docs/EPD_BOOKS.md) · [Demo positions](examples/demo-openings.epd).

## v0.4.0: Dual PV board explorer and flexible tournament controls

- White PV and Black PV now remain visible together, with real independently sized chessboards, per-board 160–760px sliders, draggable corner resize handles, PV move stepping, and a wide two-board view.
- Analysis launches both assigned UCI engines on the current position. During tournaments, each side's displayed PV is tied to the FEN it actually analyzed.
- Tournament total game count is directly editable (1 to 50,000). Mirrored games alternate colors with matching EPD starting positions.
- Three search modes: **Clock + Fischer increment**, **Fixed think time per move**, and **Infinite/untimed**. Untimed mode supports optional maximum depth, maximum nodes, or both. With neither cap, a manual **Stop & Play bestmove** button controls each move.
- Real clock mode uses UCI wtime/btime/winc/binc, displays both remaining clocks, deducts elapsed time, handles flag falls, and preserves clock time on pause/resume.

See [dual PV and tournament search mode documentation](docs/DUAL_PV_AND_TIME_CONTROLS.md).

## v0.5.0: Autosave, recovery and PGN export

Chess X-Ray journals a tournament's **schedule once**, then saves **completed game results and the in-progress move list/remaining clocks** separately in local IndexedDB storage. This avoids rewriting tens of thousands of pairings every move.

- Reopen the app after an interrupted tournament: the latest event restores in **PAUSED** state with its current chess position and remaining Fischer clocks. Select **Tournament → Resume current game** to restart the UCI engines.
- **Tournament → Export PGN** opens a native file-save dialog and writes every completed game, with White/Black/Result headers and FEN/SetUp tags for EPD starts.
- Rapid engine restarts are now guarded by per-process UCI session IDs; output or exit notifications from an earlier engine instance are discarded.
- Unexpected engine exit during a running tournament pauses the event instead of letting its clock run indefinitely.
- The test suite includes IndexedDB persistence/recovery, PGN formatting, time controls, EPD parsing and paired opening selection.

Autosave remains **local to the Tauri app data/webview profile**. Removing app data or resetting the Windows profile can remove these records, so export PGN for long-term archives. Recovery is best-effort for the most recent journaled game; newly added persistence cannot recover old pre-v0.5 games that were never saved.
