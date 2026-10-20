# Chess X-Ray opt-in instrumentation

Standard UCI provides real MultiPV, depth, selective depth, centipawn
and mate scores, WDL when available, time, nodes, nps, hashfull
(occupied TT permille), and tablebase hits. It does NOT standardize
TT probe/hit counts, beta cutoff counts, null move cutoffs, LMR
reductions, complete search trees or NNUE feature attributions.

X-Ray accepts one optional JSON telemetry message per iteration:

    info string xray {"ttProbes":810264,"ttHits":433172,"betaCutoffs":37215,"nullMoveCuts":19342,"lmrReductions":111024}

The viewer displays a TT hit rate only if BOTH ttHits and ttProbes are
reported. It computes (ttHits / ttProbes) * 100. Never treat UCI hashfull
as a TT-hit rate. Optional nnue is a JSON object with numeric values:

    info string xray {"nnue":{"value":0.22,"complexity":0.03}}

These are ENGINE-DEFINED values, NOT independently verified attribution.

Counter meanings:
- ttProbes: transposition table probes since start of search
- ttHits: successful TT probes since start of search
- betaCutoffs: beta cuts during alpha-beta search
- nullMoveCuts: cuts caused by null move pruning
- lmrReductions: late move search reductions

Instrumentation must be opt-in, batched at the end of a depth iteration
and gathered via thread-local counters to avoid introducing significant
contention on the hot search path. Benchmark node speed and playing
strength before and after any engine instrumentation.

### Tree distinction

Chess X-Ray visualizes a PV trie constructed from **actually emitted**
principal variations. It is not the complete alpha-beta search tree.
For true per-node search tracing an engine must separately emit bounded,
sampled parent/child events with score and pruning metadata. Do not
claim complete tree visibility from standard UCI.

### Elo caveat

Stockfish 19 = 3650 is an external CCRL 40/15, 4CPU reference value
dated 2026-10-16. Local results use K=32 provisional Elo changes and
are NOT official CCRL ratings. Meaningful strength testing requires
controlled hardware, time control, openings, equal engine settings,
adequate game pairs and uncertainty estimates.
