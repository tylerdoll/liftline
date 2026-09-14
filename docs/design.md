# AWS migration design

The original live application and its Git repository are untouched. `baseline/` is a sanitized snapshot, committed before conversion at `990adc8`. It retains the actual React UI, D1 route, schema and backup code. Personal plan/performance seed programs and old SQL migrations were excluded from public history. Their data must be preserved by private export/import, including records that originated as seeds.

## Runtime and ownership

Vite/React runs from private S3 through CloudFront. `/api/v1/*` uses the same hostname, CloudFront caching disabled, HTTP API JWT authorization, and Lambda. Cognito Essentials provides managed authorization-code login with PKCE and self-signup disabled. The gateway requires issuer, client audience, expiry and the `openid` scope; the Lambda resolves issuer/sub to a stable internal ID and checks the enabled profile on every request. Mutation transactions also check the identity binding and enabled profile. Browser owner IDs never choose a partition. Missing auth is 401, unbound/disabled users 403, and resources outside the caller's partition 404. OAuth tokens remain in memory; a short-lived PKCE verifier/state is in sessionStorage. Reauthentication after reload recovers the current owner's IndexedDB drafts.

Users begin with the shared immutable catalog and empty plans/history. Invites are administrator-only CLI operations, limited to six internal IDs including the owner. Custom exercises are user-owned. The old progression rule is retained: all completed sets within the inclusive configured range increase the greatest last weight by 5 lb; any set outside it decreases by 5 lb, floored at zero. Copies never enter performance history.

## Storage contracts

A DynamoDB Standard on-demand table per environment uses `PK`/`SK`. Application access is GetItem and bounded key Query with validated cursors; no scans. `USER#id` owns PROFILE, PLAN, EXERCISE, SESSION, HISTORY, PROGRESS, WEEK, OP and COPY records. CATALOG owns built-ins; IDENTITY binds issuer/sub; SHARE uses a SHA-256 token hash. Sparse Expiry GSI entries contain canonical draft keys and expiry milliseconds. Schema version, revision and timestamps travel with canonical records. OP receipts do not expire with DynamoDB's ten-minute transaction token window.

New documents are capped at 200 KiB, sessions at 30 distinct exercises and 100 sets. Inputs are validated without truncation. Expected revision and a stable operation UUID protect writes. Reusing a UUID with changed input conflicts. Completion replaces the canonical draft and writes compact history/per-exercise projections and a weekly counter in one transaction (at most 35 records including guards/receipt for a 30-exercise session). Completed/discarded snapshots remain canonical. Projection rebuild tooling runs on isolated restored/imported data.

The server captures timezone and the next local midnight when the draft is first saved. Temporal handles DST. The five-minute worker rereads each canonical GSI candidate before conditionally finalizing; stale index entries are harmless. Empty expired sessions are retained. Malformed drafts become quarantined records. Late edits receive 409 and require explicit recovery. IndexedDB writes precede the 700 ms network debounce; serialized retries preserve operation IDs across offline/reload/auth failure. Web Locks coordinate tabs. Recovery can retry, download local content, or explicitly create a new draft without changing closed history.

## Private sharing

The browser generates 32 random bytes. The token stays in the URL fragment and POST bodies; only its hash persists on the server. Shares are immutable, expire after seven days, and can be revoked for future redemptions. Copy IDs and all custom exercise/day/plan IDs are deterministic per recipient and share. Staging batches are invisible until a conditional COPY completion marker exists. Revocation/expiry is checked again when that marker is written. A workout copies into a reusable plan template, never a completed session.

## Migration and recovery

Owner-only frozen export includes all seven tables, schema, timestamp, counts and SHA-256 checksums. Every raw row gets a durable legacy address and an S3 copy. IDs derive from owner/table/legacy ID, never names. Existing exercises remain distinct owner exercises unless an explicit reviewed mapping is added. Large canonical documents have an authenticated chunked legacy read path. Malformed drafts remain losslessly quarantined. Repeated imports into the same isolated target must be identical; changed exports require a fresh target, preventing accidental overwrite of new training records.

PITR is 35 days. AWS Backup takes daily snapshots retained seven days. Weekly full DynamoDB exports go to the other account's encrypted/versioned bucket for eight weeks. The private archive replicates to that account too; current archive objects remain retained because legacy canonical records can reference them. Only backup writers and recovery administrators should access that bucket; app and ordinary CI roles have no recovery bucket grants. Export completion/overdue status is monitored separately from starting a job. Logs contain event codes/counts, never requests/tokens/payloads; retention is prod 30 days and preprod seven days.

## Release safety

The build produces frontend/Lambda artifacts and CDK assembly hashes. CI runs contract, SDK emulator, migration, restore, browser, type, lint, build, synth and security checks before a candidate can deploy. Preprod and prod consume the same candidate; they never rebuild it. Runtime Cognito configuration is environment-specific. Production depends on successful preprod smoke, with serialized releases. Previous Lambda versions, aliases and index files support app rollback; canonical data is retained and schema changes must be additive. Delivery, data and recovery stacks are administrator bootstrap operations, separate from normal app releases.

`LIFTLINE_RELEASE_ENABLED` is deliberately unset. No AWS resources have been deployed. Local emulation does not certify IAM, actual Cognito login, CloudFront behavior, PITR timing or cross-account replication. Those remain launch gates in the runbooks.
