# Deployment runbook

## Current prerequisites

Current setup uses an isolated alpha AWS Project in `us-east-2`; see [alpha setup](alpha.md). Beta and production access are not authorized for the agent. The following paired-environment runbook is retained for future owner-managed setup. Keep release enablement off until all launch gates are complete. Use two separate projects in `us-east-2`; the preprod account also contains the isolated recovery bucket, inaccessible to the preprod application and normal delivery role. Creating accounts, accepting terms, billing setup and real deployment are separate user actions.

1. Create accounts, secure administrator access, and confirm billing/free-tier eligibility. Set real `PREPROD_ACCOUNT`, `PROD_ACCOUNT`, and `ALERT_EMAIL` locally and as repository variables. Confirm SNS subscriptions. Budget alerts are notifications, not spending caps.
2. As administrator, bootstrap CDK in both accounts. Review the synthesized Delivery, Data and Recovery stacks. Create production backup/replication roles before the recovery bucket policy references them; if deploying in phases, bootstrap those roles first, then recovery, then replication. Do not use the normal delivery role for these stacks.
3. Install the GitHub OIDC provider and delivery stack in each account. If an OIDC provider already exists, import it rather than creating a duplicate. Set the `DEPLOY_ROLE_ARN` variable separately in the `preprod` and `prod` GitHub environments. Restrict each environment to the protected `main` branch. AWS trust binds the repository and environment; GitHub's environment branch rule supplies the ref restriction. Do not enable releases without both controls.
4. Protect `main`: require PRs, CODEOWNERS approval for infra/workflows, the `local-validation` status check, no force pushes/deletion, and enforcement for administrators. Public PRs get read-only contents permission and no AWS credentials. There is no privileged `pull_request_target` workflow.
5. Review IAM through AWS policy simulation and real negative tests. In particular, the app execution boundary must prevent deleting production tables/backups; ordinary CI/app roles must fail to read the recovery bucket. Tighten generated service permissions to the actual deployed resource ARNs after bootstrap where create-time APIs require broader resources. Verify CDK asset publication with the dedicated execution role; do not replace it with an administrator policy to make a deployment pass.
6. Deploy preprod app using the reviewed assembly, then seed only the catalog. Create two dedicated synthetic identities for preprod and one for prod, bind them with the administrator invite tooling, and configure protected environment smoke credentials. Test user credentials are never real user credentials or public artifacts. Cognito managed-login selectors and IAM must be validated in real preprod.
7. Complete real preprod API/browser integration: forged IDs, disabled users, private/custom visibility, concurrency, copy independence/revocation, expiry and recovery. Run the restore drill and cross-account archive/weekly-export reconciliation. Record measured RPO and RTO privately. A successful emulator run does not waive these gates.
8. Only after the launch review set `LIFTLINE_RELEASE_ENABLED=true`. Main then builds one candidate and promotes its exact hashes through preprod to prod. No later build occurs in deployment jobs. Manually bootstrap data/identity/schema changes first if needed; only additive transforms may accompany a release.

## Local commands

Node 24, Python 3.12 and pnpm are required. Install with `pnpm install` and `python -m pip install -r requirements-test.txt`; start `python scripts/local-aws.py` in a separate terminal. Run `pnpm exec playwright install chromium`, then `pnpm check`. `pnpm dev` hosts the unchanged baseline on port 4173. `pnpm dev:aws` hosts the migrated UI with synthetic auth and Moto on port 4174. These test hosts are not production servers and are excluded from runtime bundles.

`pnpm build && pnpm synth && pnpm manifest` produces the candidate. `node --import tsx scripts/verify-manifest.ts` checks all frontend, backend and assembly hashes. Only the release workflow should invoke `scripts/deploy.ts`. The script verifies the actual STS account and rejects placeholder accounts.

## Rollback

A failed smoke run restores prior Lambda aliases and the prior versioned index. Existing hashed assets and Lambda versions remain available. No table or backup is deleted. On a first deployment with no previous version, leave the environment unopened and investigate. Infrastructure rollback and schema compatibility require review; app rollback is not permission to reverse a data migration. After any rollback, run smoke again and reconcile release metadata before the next promotion.

GitHub release failure notifications should reach the administrator through repository Actions notifications; before launch, verify SNS/API/expiry/backup alerts and configure a release-failure email path in the chosen account. Do not assume that a workflow failure itself guarantees an email delivery.
