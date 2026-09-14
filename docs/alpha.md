# Alpha on AWS Projects

Alpha is an independently deployed project in `us-east-2`. Use only the `liftline-alpha` profile. Beta and production access are outside this setup's scope. The original app and private workout history remain untouched.

The existing paired environment entry point is retained for historical compatibility. Use `infra/alpha.ts` for alpha; it emits only three `*-alpha` stacks and no cross-project recovery permissions or GitHub OIDC role. The data stack retains its table and archive, enables 35-day PITR and daily backups retained for seven days, and retains weekly exports for eight weeks. These are same-project recovery copies, not protection against loss of the whole project or Region.

Create an ignored `private/alpha.json` containing `profile`, `account`, `region`, and `alertEmail`. Never commit this file or generated outputs. The setup script checks the signed-in project before every invocation and fixes its profile and Region to alpha/Ohio.

1. Run `pnpm check` with the local Moto server available.
2. Run `node --import tsx scripts/alpha-setup.ts prepare`. Review the generated resource counts and private plan. This builds and hashes the exact alpha assembly and app assets without creating AWS resources.
3. Run `node --import tsx scripts/alpha-setup.ts bootstrap`. CDK creates its asset bucket and deployment roles, with no external-project trust. The initial bootstrap execution role has administrator permissions inside alpha; use it only for administrator setup. The application stack uses its separate service execution role and permissions boundary.
4. Run `node --import tsx scripts/alpha-setup.ts deploy`. It verifies the reviewed artifact hashes, shows the infrastructure diff, deploys the three alpha stacks, uploads the UI, and seeds the common exercise catalog. It does not create app users or send invitations.
5. Run `node --import tsx scripts/alpha-setup.ts verify`, then check public HTML/runtime configuration, unauthenticated API rejection, managed login, and signed-in isolation/recovery with explicitly authorized synthetic identities.

Confirm SNS subscriptions received at the configured alert address. The $5/$10 budget notifications are not hard spending caps. Project Free Plan status and any spend limit are managed in AWS Settings. Backups, logs, and monitoring can consume credits even when no one is using the app.

Keep the initial alpha resources for subsequent testing unless the owner requests cleanup. Do not delete retained data, backups, or the CDK bootstrap stack as an automatic cleanup step. Production promotion remains disabled and is not part of this workflow.

## Verified alpha setup

The alpha stacks deployed successfully. The public frontend and Ohio runtime configuration returned successfully; missing and invalid bearer tokens returned HTTP 401. A headless browser verified the app sign-in button and the Ohio Cognito managed-login form. The live table reports PITR enabled with 35-day retention, and the initial DynamoDB export completed. All 42 local tests passed before deployment, including the alpha isolation assertion.

Real deployment exposed missing bootstrap-parameter and CloudWatch-alarm permissions in the application execution role; the scoped fixes are included. The first failed app attempt retained an empty user pool, empty asset bucket, and log groups. Their identifiers are recorded in ignored private/alpha-failed-app-resources.json for later cleanup review. The data stack was not replaced.

Authenticated multi-user browser tests and a real restore drill remain outstanding. No app invitations or live workout migration were performed. Confirm the alert subscriptions in email before relying on notifications.
