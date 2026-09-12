# Liftline

Workout plans, set logging, supersets, draft recovery, and range-based progression.

This repository begins with a sanitized snapshot of the existing application in `baseline/`, plus interface and data-contract tests established before AWS conversion. Personal seed programs and performance history, live deployment configuration, exports, screenshots, and prior Git history are excluded. The original app remains intact outside this repository.

## Run the baseline tests

Use Node 24 and pnpm. `pnpm install`, `pnpm test`, and `pnpm test:browser` run synthetic tests only. Install the test browser once with `pnpm exec playwright install chromium`. `pnpm dev` starts a disposable local test host; it is not a production server and its data resets at restart.

To validate against an original private checkout, set `BASELINE_SOURCE` to that app directory and run `pnpm test`. The test harness disables automatic seed/import hooks only and never calls the live site.

See [baseline coverage](docs/baseline-coverage.md). Future AWS work must retain these observable behavior tests and add auth, isolation, persistence/recovery, copying, migration, and release acceptance tests using local AWS emulation before any deployment.
