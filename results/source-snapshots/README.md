# Exact source snapshots

Each `.json.gz` filename is the `sourceHash` recorded in a simulation dataset. It contains the exact source files used for that run. Identical snapshots are stored once across batches. The mapping from historical companion filenames is in `../research-artifacts.json`.

These preserve pre-finalization source versions; the final code is tracked normally under `src/`. Use Python's gzip module or `gzip -dc` to inspect a snapshot.
