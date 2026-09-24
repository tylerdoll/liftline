# Owner setup for beta and production

GitHub releases deploy application stacks on ephemeral CodeBuild runners with temporary service-role credentials. The owner must first create each project's bootstrap, GitHub App connection, delivery runner, and protected data resources. An application deployment role intentionally cannot create its own trust relationship or administer backup infrastructure.

**These commands are for the owner to run personally. Agents must not run them, log in to these projects, or inspect their resources without separate explicit permission.** The `--owner-authorized` flag is an execution guard, not a substitute for that permission. Normal GitHub releases do not use this script.

## Prepare private configuration

Use a trusted local checkout of the reviewed pipeline changes and install locked dependencies (`pnpm install --frozen-lockfile`). Confirm each project's selected Region in **AWS Settings > View all projects > Overview > Additional Info > Region**. Both must be `us-east-2`. Review the project's plan and spend status under **AWS Settings > Billing**; spend limits can pause a project. The helper checks plan type before each operation. If a service is unavailable, consult the [supported services for the new AWS experience](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html) for that plan before activating advanced capabilities or upgrading.

Create `private/stages.json` locally, replacing every placeholder. This directory is ignored by Git; never commit this file, generated assemblies, outputs, credentials, or live data.

```json
{
  "region": "us-east-2",
  "beta": { "account": "BETA_PROJECT_ID", "alertEmail": "BETA_ALERT_EMAIL" },
  "prod": { "account": "PROD_PROJECT_ID", "alertEmail": "PROD_ALERT_EMAIL" },
  "githubTrustedActorIds": ["OWNER_NUMERIC_GITHUB_ID", "GITHUB_ACTIONS_BOT_NUMERIC_ID"]
}
```

Resolve actor IDs using GitHub's `/users/<login>` API for the owner and `github-actions[bot]`; use numeric IDs, never usernames or a wildcard. The actor filter is the runner security boundary. See [deployment security](deployment.md) before allowing additional actors. The connection phases below save each project's `connectionArn` into this ignored configuration. No OIDC provider is created for beta or prod.

Use separately named owner CLI profiles. The owner signs in with `aws login --profile <owner-profile> --region us-east-2` as necessary. Never paste credentials into chat, put static AWS keys in GitHub, or point these commands at the alpha profile. The helper verifies STS identity against the selected project before changing resources and rejects CI execution. On Windows it uses the existing user-local AWS CLI installation; set `LIFTLINE_AWS_CLI` locally if your executable is elsewhere.

## Create foundations in order

Run these commands from the repository root. The profile names below are examples chosen by the owner. Each deployment prints a diff and asks for approval of security changes. Read the complete diff, particularly resource replacements, before proceeding.

```sh
node --import tsx scripts/owner-stage-setup.ts bootstrap-beta --owner-authorized --profile owner-beta
node --import tsx scripts/owner-stage-setup.ts bootstrap-prod --owner-authorized --profile owner-prod
node --import tsx scripts/owner-stage-setup.ts connection-beta --owner-authorized --profile owner-beta
node --import tsx scripts/owner-stage-setup.ts connection-prod --owner-authorized --profile owner-prod
```

Connections initially remain `PENDING`. In each project's [CodeConnections console in us-east-2](https://us-east-2.console.aws.amazon.com/codesuite/settings/connections?region=us-east-2), complete the pending connection and authorize the AWS GitHub App for **only `tylerdoll/liftline`**. This interactive authorization cannot be completed by the CLI. The foundation helper refuses to continue until the selected connection is `AVAILABLE`. If the managed project policy denies CodeConnections or CodeBuild, stop and investigate supported services; do not silently upgrade or activate advanced capabilities.

Continue only after both connections are available:

```sh
node --import tsx scripts/owner-stage-setup.ts foundation-prod --owner-authorized --profile owner-prod
node --import tsx scripts/owner-stage-setup.ts foundation-beta --owner-authorized --profile owner-beta
node --import tsx scripts/owner-stage-setup.ts recovery --owner-authorized --profile owner-beta
node --import tsx scripts/owner-stage-setup.ts replication --owner-authorized --profile owner-prod
node --import tsx scripts/owner-stage-setup.ts app-beta --owner-authorized --profile owner-beta
node --import tsx scripts/owner-stage-setup.ts app-prod --owner-authorized --profile owner-prod
node --import tsx scripts/owner-stage-setup.ts catalog-beta --owner-authorized --profile owner-beta
node --import tsx scripts/owner-stage-setup.ts catalog-prod --owner-authorized --profile owner-prod
node --import tsx scripts/owner-stage-setup.ts smoke-beta --owner-authorized --profile owner-beta
node --import tsx scripts/owner-stage-setup.ts smoke-prod --owner-authorized --profile owner-prod
```

Bootstrap creates CDK's deployment support resources. Its default CloudFormation execution role is highly privileged within that project; only the owner uses this initial path. Ordinary releases use the separate constrained application execution role. There is no cross-project bootstrap trust.

The initial production foundation uses `RECOVERY_READY=false`, allowing source roles and local data protection to exist before the recovery destination. Beta then creates `LiftlineRecovery` in the same selected Region. Finally `replication` synthesizes with `RECOVERY_READY=true` and updates only `LiftlineData-prod`, enabling the destination-dependent configuration. The app phases also use the recovery-ready assembly; other phases leave recovery disabled but deploy only their explicitly selected stacks. Each call uses `--exclusively`, so CDK cannot follow a dependency into the other project.

**Do not rerun `foundation-prod` after enabling replication:** the helper detects existing bucket replication and refuses to disable it. Future production data changes require a reviewed assembly with `RECOVERY_READY=true`. If a step fails, inspect its CloudFormation events as the owner, correct the problem, and resume that phase. Do not delete data stacks to restart. The app phases create initial application infrastructure, including the Cognito pools needed for smoke identity provisioning. They do not publish frontend assets; GitHub owns publication. None of these phases migrates workout records. Catalog phases populate only the common exercise catalog, idempotently.

Confirm the alert subscription emails. A subscription awaiting confirmation cannot deliver operational alerts. Creating backup resources is not proof of recoverability; the separate restore drill must still measure recovery time and reconcile restored data.

## Configure GitHub and start releases

Keep the release enablement flag off until the owner foundation steps succeed. Configure `beta` and `prod` GitHub environments for the main branch. Verify the runner outputs name `liftline-beta-release` and `liftline-prod-release`; each accepts only the exact release workflow and trusted actor IDs. Use the variable and secret names declared by the checked-in release workflows; preserve environment-specific values. The candidate build needs private project IDs and alert configuration supplied through GitHub configuration rather than source files. Candidate synthesis uses inert runner configuration because releases deploy only the application stacks; delivery changes remain owner-managed.

Beta needs **two dedicated synthetic smoke identities** for isolation and sharing tests. Production uses its separately configured smoke identity or identities as required by the checked-in smoke suite. Never give the suite the owner's normal sign-in or a real friend's workout profile. Provision test users using the owner setup tooling supplied with the pipeline, bind their Cognito subjects to enabled application profiles, and store generated passwords only in GitHub environment secrets and an appropriate private password store. A Cognito user without its application identity binding cannot access the app. Synthetic tests must keep test records separate from real user data.

`scripts/invite.ts` is the manual invitation path and sends email. Run it only for an explicitly requested recipient after the application stack exists; it is not an unattended smoke-user provisioning tool. Never publish test passwords or authentication tokens in reports or screenshots.

The owner app phases create the pools before the first GitHub release. Provision the dedicated synthetic identities in each pool, populate its environment secrets, and then enable releases. Missing identities must fail the integration gate and prevent promotion; never bypass the gate to obtain a green release. The same verified artifact must flow through beta and production; do not rebuild between stages.

After configuration, enable releases using the workflow's documented enablement flag and dispatch or push the reviewed main revision. Verify candidate checks, beta deployment, authenticated beta integration tests, production promotion, and smoke results in Actions. Inspect the workflow's rollback result if a smoke test fails. Until that actual run succeeds, the pipeline is prepared, not proven operational.

## Owner handoff checklist

- Supply private per-project alert addresses and confirm the selected Region and plan.
- Run the ordered foundation phases using owner profiles; provide only a success/failure summary, never credentials.
- Authorize both GitHub App connections and configure dedicated synthetic test secrets.
- Confirm alert email subscriptions and complete the first release through all gates.
- Decide whether to keep successfully created resources for ongoing use or remove unused resources to reduce cost. Cleanup is a separate reviewed action; these commands never destroy stacks or restore over live data.

No beta or production login by an agent is needed for this handoff. If setup fails, the owner can share redacted error text; any direct agent access requires new explicit permission.

## Synthetic credentials and release controls

The smoke phases create reserved `@example.invalid` synthetic users without sending email, bind them to dedicated test profiles, and generate permanent random passwords. They do not occupy the six human invitation slots. Rerunning a smoke phase rotates its synthetic passwords; update GitHub secrets afterward. They do not reset personal users.

Copy each name/value from ignored `private/beta-smoke-secrets.json` into **Settings > Environments > beta > Environment secrets**; repeat for prod. Beta requires `SMOKE_EMAIL`, `SMOKE_PASSWORD`, `SECOND_SMOKE_EMAIL`, and `SECOND_SMOKE_PASSWORD`. Production requires the first two only. Do not paste these passwords into chat.

GitHub configuration uses repository secrets `BETA_ACCOUNT`, `PROD_ACCOUNT`, `BETA_ALERT_EMAIL`, `PROD_ALERT_EMAIL`, and `CANDIDATE_KEY`. The previous `DEPLOY_ROLE_ARN` secrets and `LIFTLINE_OIDC_SUBJECT_PREFIX` variable are no longer used. The candidate is authenticated/encrypted before uploading to this public repository's Actions artifacts; keep the encryption key stable while a release is running.

After owner setup and smoke secrets are complete, set repository variable `LIFTLINE_RELEASE_ENABLED` to `true`, then run **Actions > Exact artifact release > Run workflow** on `main`. Beta integration failure blocks production; an application rollback restores previous aliases/frontend where a prior accepted release exists. The first release has no prior accepted application to roll back to and remains failed/unopened if its checks fail. Data is always retained.
