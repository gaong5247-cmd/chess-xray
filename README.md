# Chess X-Ray

**Chess X-Ray** is an independent Windows chess engine analysis and match viewer, built with **Tauri 2 + Rust + React + TypeScript**.

The initial release combines a tournament-broadcast dashboard, UCI MultiPV analysis, principal-variation preview boards, configurable move arrows, an engine-vs-engine match controller, analysis timelines, and a local Elo leaderboard anchored to Stockfish 19 at **3650 on CCRL 40/15 (4 CPU, 2026-10-16)**.

> Rating note: the 3650 value is an external reference point, not proof that local games reproduce CCRL testing conditions. Local estimates are labeled separately.

## Building

Install Node.js LTS, Rust, Microsoft C++ Build Tools, and WebView2 on Windows. Then:

```powershell
npm install
npm run prepare:engine
npm run desktop:dev
```

To package an installer: `npm run desktop:build`. Windows GitHub Actions builds a release automatically when the project is pushed to the default branch.

Bundled Stockfish is downloaded from the **official Stockfish 19 GitHub release** as part of the build. Stockfish is GPLv3; the installer includes upstream license text. Lichess Cburnett pieces are GPLv2+ and credited in `THIRD_PARTY_NOTICES.md`.

Development will live in this repository, not in the existing Stockless engine source repository.
