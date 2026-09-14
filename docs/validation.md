# Validation and launch gates

Local validation uses synthetic fixtures exclusively. The original application and its private history remain outside this repository. The baseline was committed before conversion; its behavior tests exercise the actual legacy HTTP route through a disposable SQLite database boundary. They also ran against the original private checkout with seed/import hooks disabled.

## Local evidence

The September 13, 2026 validation covers:

| Layer | Checks |
| --- | --- |
| Legacy API and backup behavior | 15 passing tests: plans, supersets, partial drafts, completion, history, progression boundaries, empty expiry, errors, backup retention |
| Unit and infrastructure contracts | 12 tests: progression parity and active-plan presentation, persistent draft recovery across failures and identity changes, DST midnight, synthesized storage/auth contracts |
| AWS SDK with Moto | 11 tests: isolation, disabled identities, replay after delay, revision races, duplicate completion, limits, expiry/quarantine, interrupted/revoked copies, lossless import with 1,600-set legacy outlier and two reruns, new-table backup restore and derived rebuild |
| Browser | Two baseline scenarios and one migrated scenario covering sign-in, plan reload, private exercise creation, failed draft save, reload, explicit recovery and completion |
| Static/build | TypeScript, ESLint, Vite/backend bundles, CDK synthesis |

The tests target observable interfaces, durable outcomes, and data contracts. Synthesized infrastructure assertions intentionally verify operational requirements such as PITR and authorization; they do not establish that AWS will accept or enforce every generated policy.

## Required before deployment or cutover

Alpha configuration is stored privately; beta and production setup remain outside the agent scope. See [alpha setup](alpha.md). Local Moto behavior does not demonstrate real IAM, Cognito JWT validation, CloudFront routing, cross-account replication/export, PITR timing, or recovery objectives. Protected environment credentials and real cloud smoke tests have not run. Keep `LIFTLINE_RELEASE_ENABLED` unset until the deployment runbook gates are complete.

Administrator bootstrap must resolve cross-account role/bucket dependencies and review/tighten create-time delivery permissions against deployed resources. Verify both positive and negative IAM behavior in preprod. Confirm GitHub main protection and environment branch restrictions, SNS subscriptions, release failure delivery, and actual backup completion before enabling promotion.

The emulator restore drill uses an on-demand backup into a new table. A real point-in-time and cross-account disaster recovery drill, including identity recreation and runtime switch, is still required to measure the five-minute RPO/two-hour RTO targets.

Malformed or oversized legacy drafts remain preserved for explicit reconciliation; storage preservation is not permission to treat them as valid new sessions. Inspect every migration quarantine and archived outlier before clearing migration mode. No live freeze, export, identity binding, invitation, migration, traffic switch, or AWS deployment has been performed.

## Alpha follow-up

The Ohio alpha assembly adds one isolation/protection test, bringing local coverage to 42 passing tests. See [alpha evidence](alpha.md#verified-alpha-setup) for live deployment checks and remaining signed-in/restore validation. Beta and production remain outside the agent access scope.
