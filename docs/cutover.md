# Private migration and cutover

The old app is still live and unchanged. Do not invoke its GET endpoint for read-only inspection: GET mutates schema, seeds/imports data and expires drafts. Do not run a live write freeze, private export, import, identity binding or cutover until the concrete preprod rehearsal and launch review are complete.

## Rehearsal

Use an owner-controlled export outside CI. The `private/` directory is ignored; never upload its contents, reports, screenshots or logs to GitHub. `scripts/export-d1.ts` requires an owner-authorized read-only Cloudflare D1 token in the process environment and a separately confirmed write freeze. It reads all seven tables in pages and writes the schema/count/checksum manifest with restrictive filesystem permissions. For a rehearsal, an existing consistent private backup may be used instead of freezing the live site.

Import command: `node --import tsx scripts/migrate.ts private/export.json INTERNAL_OWNER_ID ISOLATED_TABLE PRIVATE_ARCHIVE_BUCKET private/report.json`. Use a fresh isolated table for each different export. Preserve the chosen internal ID across rehearsals and final import. The tool archives every raw row, maps legacy IDs deterministically, preserves active plan and all performance records, rebuilds projections, and reruns twice. It refuses to overwrite different canonical data. Keep the profile in `migrationMode` until review is complete.

Compare all seven source table counts/checksums with the private manifest and legacy row addresses. Compare completed workout count, set count, volume, dates, relationships and active plan. Inspect every quarantine entry; malformed/unrepresentable input must remain recoverable in S3 and its original rows. Large documents must be readable through the authenticated legacy path. Do not discard seeded history or merge exercise names. Verify private archive replication and checksum retrieval in recovery.

Bind Tyler's Cognito issuer/sub explicitly to the internal owner ID after import. Verify America/Denver and the active plan. New invited friends must have empty plans/history. The migration command does not bind an identity or open the account automatically.

## Final cutover

1. Announce the maintenance window and verify a successful restore rehearsal and fresh backups. Prepare the exact old-app write-freeze change for review; account for all POST routes and background mutation paths, including GET finalization.
2. Apply the separately approved freeze. Test that old writes are rejected and record the freeze timestamp privately.
3. Run final export with `--writes-frozen`, verify the manifest, import into the final isolated target and reconcile. No new AWS user writes yet.
4. Bind the owner, select the reviewed table in runtime configuration, complete smoke tests, and explicitly clear migration mode. Invite friends only after owner verification.
5. Keep the original application read-only for 30 days, with its data and backups intact.

Before the first AWS user write, rollback may reopen the original app after verifying it still matches the final export. After AWS writes occur, never reopen stale old data: freeze both sides, export/reconcile new AWS records, and agree on the reconciliation before choosing the authoritative system. A code rollback alone does not perform that reconciliation.
