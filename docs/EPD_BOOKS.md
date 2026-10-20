# EPD opening book support

Chess X-Ray tournament mode can use a `.epd` file as a random opening-position book.

## How to use

1. Open **Tournament** from the upper-left menu.
2. Select **Select .epd file** and choose the EPD text file on your Windows computer.
3. After scanning, confirm the candidate-line and playable-sample counts.
4. Choose **Random FEN from EPD** (auto-selected on successful import).
5. Leave **Reuse the same FEN in reversed-color pairing** enabled for fair matched games.
6. Pick at least two engines and start the tournament.

## Supported file contents

EPD has four FEN fields: piece placement, side to move, castling availability, en-passant square. Optional opcodes (for example `bm` and `id`) are ignored.

    rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - bm e4; id "Start";

Full six-field FEN lines in an `.epd` file also work:

    rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1

Comments beginning with `#`, `%`, or `//` are ignored. Improper ranks and invalid fields are ignored in native scanning. A second pass with `chess.js` removes illegal, checkmated, stalemated, and other terminal positions from the sampled candidates.

## Handling huge opening files

The Rust backend reads the EPD book **line-by-line** and uses a uniform reservoir sample of at most **4,096** syntactically plausible candidate records from the *entire file*. It does not load all positions into RAM, even for a multi-million-line book. The app then validates those sampled positions with chess.js. The reported playable count is specifically the number validated **in the reservoir**, not the number proven valid in the full file.

For each unique scheduled encounter the program picks a random playable FEN (cryptographic random numbers) and stores that FEN on each game record. When mirrored colors are enabled, the paired match reuses that exact starting FEN. Disabling that option permits independently chosen FENs, even across return matches. The book positions are fixed when tournament starts; `Resample` affects only **future** tournaments.

EPD start positions are passed to each UCI engine via `position fen ...`, so black-to-move or midgame positions are supported. Finished games still count only engine-played moves against the tournament's maximum ply limit. The selected file path is saved locally and reloaded on the next launch; no opening book content is uploaded.

### Limitations

- Only standard chess FENs are validated; variant-specific FENs require a separate variant engine and rules implementation.
- Invalid lines may be present in the source file; errors and rejection counts in the UI refer to the sampled candidate set.
- EPD opcodes are ignored and the default FEN halfmove and fullmove counters are `0 1` unless the line already supplies numeric values.
- A loaded book does not automatically make engine Elo results equivalent to standardized CCRL testing.

See also [`examples/demo-openings.epd`](../examples/demo-openings.epd).
