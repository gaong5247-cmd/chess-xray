# Reliable tournament runs (v0.5.0)

## Journal layout

A local IndexedDB database contains: event schedules, compact progress records, completed per-game result records, and a current game snapshot. A schedule with up to 50,000 pairings is stored once, not rewritten after every completed game.

Snapshots contain **opening FEN, played UCI moves, white/black remaining milliseconds, game number and timestamp**. They are written in order after completed moves and at pause, and are removed atomically with each finished game's result.

## Recovery procedure

On startup, Chess X-Ray loads the most recently started event from IndexedDB and reconstructs the position move-by-move from the saved opening FEN. Games interrupted while running are marked **paused** and do not resume automatically. Click Tournament → Resume to relaunch the assigned engines and continue from the restored FEN/clock. Closing and reopening does not deduct time while the app is closed.

If event storage is unavailable or full, a visible warning is shown. The next game is not started unless the completed game's result was successfully journaled.

## Export

Tournament → Export PGN writes finished games via the native Windows save dialog. The file includes game metadata, Result tags and EPD SetUp/FEN tags. The current unfinished game is not represented as a completed result.

## Engine session isolation

Each launched UCI process carries a unique session token through its stdout, stderr and close events. The GUI accepts events only for the currently active process of a given white/black/inspect slot; delayed output from a process killed on restart cannot update the new game's PV or deliver an incorrect bestmove.

## Caveats

- IndexedDB data is kept locally in WebView2 profile storage and can be lost when app data is cleared. PGN export is recommended for any research match.
- A local journal is not a substitute for battery/UPS protection or comprehensive GUI QA.
- On Windows crash/forced shutdown there may be an unsaved final in-flight move, in which case the latest durable checkpoint is restored.
- Tournament statistics are local estimates and are not official CCRL rating numbers.
