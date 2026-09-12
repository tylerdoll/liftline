# Baseline before AWS conversion

The baseline preserves the existing React UI and request/response behavior. Tests invoke actual GET/POST handlers with a disposable SQLite implementation of the D1 boundary; they do not assert generated SQL or private functions. The same suite runs against the original local route through `BASELINE_SOURCE`. Only automatic personal seed/import calls are disabled in that harness. This is deliberate: synthetic fixtures must never import private performance history.

Covered: empty dashboard contracts, plan/day/assignment roundtrip, ordering, active plan, supersets, per-side ranges, rest periods, draft replacement/reload/discard, partial sets, elapsed time, completion/history/volume, inclusive rep-range progression, weight floor, expiry idempotency and original date, zero-set expiry, invalid request envelopes. Browser tests exercise the original page and HTTP contract, including creating a plan and reloading, and visible load failure/retry.

These are characterization tests, not an assertion that existing reliability is correct. New requirements intentionally change: ownership/auth, duplicate completion, optimistic concurrency, private copy semantics, byte-size rejection instead of truncation, malformed draft quarantine, trusted timezone expiry, IndexedDB recovery, and visible save failures. Add those as AWS acceptance tests rather than locking existing defects into compatibility.

Do not call the live GET endpoint as a read-only inspection: it mutates schema, imports seed data, and finalizes drafts. Baseline tests never use the live endpoint.
