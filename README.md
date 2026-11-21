# csv-reader-speed-01: fast drop-in for csv-reader 1.0.0

A faster `run(input)` with output identical to csv-reader 1.0.0 on every case.
Scans with `indexOf` on chunks instead of per-character reads. ~3.3x faster
than the house baseline on the practice set.

## Run

```sh
node main.ts
```

Reads `/input/cases.json` (`MAKEFUN_INPUT_DIR`), writes `/output/answers.json` (`MAKEFUN_OUTPUT_DIR`).
