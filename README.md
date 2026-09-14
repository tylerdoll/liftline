# Liftline

Workout plans, set logging, supersets, draft recovery, and range-based progression.

This repository begins with a sanitized snapshot of the existing application in `baseline/`, plus interface and data-contract tests established before AWS conversion. Personal seed programs and performance history, live deployment configuration, exports, screenshots, and prior Git history are excluded. The original app remains intact outside this repository.

## Run the baseline tests

Use Node 24 and pnpm. `pnpm install`, `pnpm test`, and `pnpm test:browser` run synthetic tests only. Install the test browser once with `pnpm exec playwright install chromium`. `pnpm dev` starts a disposable local test host; it is not a production server and its data resets at restart.

To validate against an original private checkout, set `BASELINE_SOURCE` to that app directory and run `pnpm test`. The test harness disables automatic seed/import hooks only and never calls the live site.

The sanitized baseline was published on `main` before AWS conversion (commit `990adc8`). The AWS migration is developed separately for review.

## AWS migration

The migrated React interface uses a versioned API, Cognito sign-in, private per-user DynamoDB records, durable operation receipts, and IndexedDB draft recovery. CDK defines separate preprod/prod accounts, private S3/CloudFront hosting, backup retention, and guarded release promotion. Migration tooling preserves all seven legacy tables and archives oversized records without truncation.

Run `pnpm install`, install Python dependencies with `python -m pip install -r requirements-test.txt`, and start `python scripts/local-aws.py` in another terminal. After `pnpm exec playwright install chromium`, run `pnpm check` for contract, emulator, browser, build, and infrastructure checks. `pnpm dev:aws` opens the local AWS test host with synthetic authentication; it is not a deployable authentication service.

Alpha uses the isolated AWS Projects setup described below. No live workout data has been exported or migrated. Beta/production release enablement stays off until real Cognito/IAM checks, backup recovery, and cutover review are complete.

See [validation evidence and limitations](docs/validation.md), [baseline coverage](docs/baseline-coverage.md), [architecture](docs/design.md), [deployment](docs/deployment.md), [private cutover](docs/cutover.md), and [recovery](docs/recovery.md).

For the isolated AWS Projects development environment in Ohio, use [alpha setup](docs/alpha.md). Alpha has its own assembly and credentials; it does not deploy beta or production.
