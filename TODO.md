# TODO

Observations found during development that are out of scope for the current task.

## Storage / Architecture

- `sessionTurnCounts` Map in `pipeline.js:6` is unbounded — negligible memory (~50 KB for 1,249 sessions) but grows indefinitely. Capping risks turn_index correctness; consider computing from DB instead.
- No persistence regression tests — no test closes and reopens a DB to verify data survives restart.
- `getDbSizeBytes()` in `database.js` only stats the main `.db` file — underreports with WAL mode (doesn't count `-wal`/`-shm` sidecar files).

## Operations

- Log file (`cli/index.js:79`) grows unbounded — no rotation or size limit.
- `cli/index.js:186` comment references "sql.js _persist() mid-write" — stale after better-sqlite3 migration.
