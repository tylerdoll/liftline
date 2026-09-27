import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// This entry point is for the project owner, never an agent or GitHub release job.
const [phase, ...args] = process.argv.slice(2);
const phases: Record<string, { stage: "beta" | "prod"; stacks?: string[] }> = {
  "bootstrap-beta": { stage: "beta" },
  "bootstrap-prod": { stage: "prod" },
  "connection-beta": { stage: "beta" },
  "connection-prod": { stage: "prod" },
  "foundation-prod": {
    stage: "prod",
    stacks: ["LiftlineDelivery-prod", "LiftlineData-prod"],
  },
  "foundation-beta": {
    stage: "beta",
    stacks: ["LiftlineDelivery-beta", "LiftlineData-beta"],
  },
  recovery: { stage: "beta", stacks: ["LiftlineRecovery"] },
  replication: { stage: "prod", stacks: ["LiftlineData-prod"] },
  "app-beta": { stage: "beta", stacks: ["LiftlineApp-beta"] },
  "app-prod": { stage: "prod", stacks: ["LiftlineApp-prod"] },
  "catalog-beta": { stage: "beta" },
  "catalog-prod": { stage: "prod" },
  "smoke-beta": { stage: "beta" },
  "smoke-prod": { stage: "prod" },
};
const selected = phases[phase];
if (
  !selected ||
  args.length !== 3 ||
  args[0] !== "--owner-authorized" ||
  args[1] !== "--profile" ||
  !args[2]
) {
  throw new Error(
    `Owner-only usage: owner-stage-setup.ts <${Object.keys(phases).join("|")}> --owner-authorized --profile <owner-profile>`,
  );
}
if (process.env.CI || process.env.GITHUB_ACTIONS)
  throw new Error("Owner setup cannot run in CI");
const profile = args[2];
if (profile === "liftline-alpha")
  throw new Error("Alpha profile cannot provision beta or prod");
type Config = {
  region: string;
  beta: { account: string; alertEmail?: string; connectionArn?: string };
  prod: { account: string; alertEmail?: string; connectionArn?: string };
  alertEmail?: string;
  githubTrustedActorIds: string[];
};
const config: Config = JSON.parse(
  await readFile("private/stages.json", "utf8"),
);
if (config.region !== "us-east-2")
  throw new Error("Selected Region must be us-east-2");
for (const stage of ["beta", "prod"] as const) {
  const project = config[stage];
  if (
    !project ||
    !/^\d{12}$/.test(project.account) ||
    /^(\d)\1{11}$/.test(project.account)
  )
    throw new Error(`Real ${stage} project ID required`);
  const email = project.alertEmail ?? config.alertEmail ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith(".invalid"))
    throw new Error(`Real ${stage} alert email required`);
  if (
    project.connectionArn &&
    !new RegExp(
      `^arn:aws:codeconnections:us-east-2:${project.account}:connection/[a-f0-9-]{36}$`,
    ).test(project.connectionArn)
  )
    throw new Error(`Invalid ${stage} CodeConnections ARN`);
}
if (config.beta.account === config.prod.account)
  throw new Error("Beta and prod must be separate projects");
if (
  !Array.isArray(config.githubTrustedActorIds) ||
  !config.githubTrustedActorIds.length ||
  config.githubTrustedActorIds.some((id) => !/^[1-9]\d*$/.test(id))
)
  throw new Error("Explicit trusted GitHub numeric actor IDs required");
const env: NodeJS.ProcessEnv = {
  ...process.env,
  AWS_PROFILE: profile,
  AWS_REGION: config.region,
  AWS_DEFAULT_REGION: config.region,
  AWS_PAGER: "",
  BETA_ACCOUNT: config.beta.account,
  PROD_ACCOUNT: config.prod.account,
  BETA_ALERT_EMAIL: config.beta.alertEmail ?? config.alertEmail,
  PROD_ALERT_EMAIL: config.prod.alertEmail ?? config.alertEmail,
  GITHUB_TRUSTED_ACTOR_IDS: config.githubTrustedActorIds.join(","),
  BETA_CONNECTION_ARN: config.beta.connectionArn,
  PROD_CONNECTION_ARN: config.prod.connectionArn,
  RECOVERY_READY:
    phase === "replication" || phase.startsWith("app-") ? "true" : "false",
};
// Prevent inherited temporary credentials and local emulator endpoints overriding the explicit profile.
for (const key of Object.keys(env)) {
  if (
    [
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_SECURITY_TOKEN",
      "AWS_WEB_IDENTITY_TOKEN_FILE",
      "AWS_ROLE_ARN",
      "AWS_ROLE_SESSION_NAME",
      "AWS_DEFAULT_PROFILE",
      "DYNAMODB_ENDPOINT",
      "S3_ENDPOINT",
    ].includes(key) ||
    key.startsWith("AWS_ENDPOINT_URL")
  )
    delete env[key];
}
env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS = "true";
const awsPath =
  process.env.LIFTLINE_AWS_CLI ??
  (process.platform === "win32"
    ? join(process.env.LOCALAPPDATA!, "Programs/Amazon/AWSCLIV2/aws.exe")
    : "aws");
const aws = (...argv: string[]) =>
  execFileSync(
    awsPath,
    [
      ...argv,
      "--profile",
      profile,
      "--region",
      config.region,
      "--no-cli-pager",
      "--output",
      "json",
    ],
    { env, encoding: "utf8" },
  );
const identity = JSON.parse(aws("sts", "get-caller-identity"));
if (identity.Account !== config[selected.stage].account)
  throw new Error(`Wrong project for ${selected.stage}; no changes made`);
const plan = JSON.parse(aws("freetier", "get-account-plan-state"));
if (!["FREE", "PAID"].includes(plan.accountPlanType))
  throw new Error(
    "Could not verify project plan; inspect AWS Settings before continuing",
  );
console.log(
  `Owner-authorized ${phase}; selected Region ${config.region}; plan ${plan.accountPlanType}.`,
);
const node = (...argv: string[]) =>
  execFileSync(process.execPath, argv, { env, stdio: "inherit" });
const cdk = (...argv: string[]) =>
  node("node_modules/aws-cdk/bin/cdk", ...argv, "--profile", profile);
if (phase === "foundation-prod") {
  const existing = JSON.parse(aws("cloudformation", "list-stacks"));
  if (
    existing.StackSummaries.some(
      (stack: { StackName: string; StackStatus: string }) =>
        stack.StackName === "LiftlineData-prod" &&
        stack.StackStatus !== "DELETE_COMPLETE",
    )
  ) {
    const deployed = JSON.parse(
      aws(
        "cloudformation",
        "get-template",
        "--stack-name",
        "LiftlineData-prod",
        "--template-stage",
        "Original",
      ),
    );
    const template =
      typeof deployed.TemplateBody === "string"
        ? JSON.parse(deployed.TemplateBody)
        : deployed.TemplateBody;
    if (
      Object.values(template.Resources).some(
        (resource: any) =>
          resource.Type === "AWS::S3::Bucket" &&
          resource.Properties?.ReplicationConfiguration,
      )
    ) {
      throw new Error(
        "Production replication already exists; refusing the initial foundation phase because it would disable protection. Use a reviewed recovery-ready update instead.",
      );
    }
  }
}
await mkdir("private", { recursive: true });
if (phase.startsWith("connection-")) {
  const name = `liftline-${selected.stage}-github`;
  const matches = JSON.parse(
    aws("codeconnections", "list-connections"),
  ).Connections.filter(
    (connection: { ConnectionName: string }) =>
      connection.ConnectionName === name,
  );
  if (matches.length > 1)
    throw new Error("Multiple matching connections; resolve manually");
  const arn =
    config[selected.stage].connectionArn ??
    matches[0]?.ConnectionArn ??
    JSON.parse(
      aws(
        "codeconnections",
        "create-connection",
        "--provider-type",
        "GitHub",
        "--connection-name",
        name,
      ),
    ).ConnectionArn;
  const connection = JSON.parse(
    aws("codeconnections", "get-connection", "--connection-arn", arn),
  ).Connection;
  if (
    connection.ProviderType !== "GitHub" ||
    connection.OwnerAccountId !== identity.Account
  )
    throw new Error("Connection owner/provider mismatch");
  config[selected.stage].connectionArn = arn;
  await writeFile(
    "private/stages.json",
    JSON.stringify(config, null, 2) + "\n",
  );
  console.log(
    `GitHub connection: ${connection.ConnectionStatus}. Complete a pending connection in the us-east-2 CodeConnections console, granting only this repository.`,
  );
} else if (phase.startsWith("bootstrap-")) {
  cdk(
    "bootstrap",
    `aws://${identity.Account}/${config.region}`,
    "--termination-protection",
  );
} else if (phase.startsWith("catalog-")) {
  node("--import", "tsx", "scripts/catalog.ts", `liftline-${selected.stage}`);
} else if (phase.startsWith("smoke-")) {
  env.LIFTLINE_OWNER_SETUP = selected.stage;
  node("--import", "tsx", "scripts/owner-smoke-users.ts");
} else {
  if (phase.startsWith("foundation-")) {
    const arn = config[selected.stage].connectionArn;
    if (!arn)
      throw new Error(
        "Run the connection phase and authorize its GitHub App first",
      );
    const connection = JSON.parse(
      aws("codeconnections", "get-connection", "--connection-arn", arn),
    ).Connection;
    if (connection.ConnectionStatus !== "AVAILABLE")
      throw new Error(
        "GitHub connection is not AVAILABLE; finish authorization in the AWS console",
      );
  }
  node("node_modules/vite/bin/vite.js", "build");
  node("--import", "tsx", "scripts/bundle.ts");
  node("--import", "tsx", "infra/app.ts");
  const manifest = JSON.parse(await readFile("cdk.out/manifest.json", "utf8"));
  for (const name of selected.stacks!) {
    const artifact = manifest.artifacts[name];
    if (
      artifact?.type !== "aws:cloudformation:stack" ||
      artifact.environment !== `aws://${identity.Account}/${config.region}`
    )
      throw new Error(`Assembly target mismatch for ${name}`);
  }
  // Explicit stack selection and --exclusively forbid following dependencies into another project.
  cdk(
    "diff",
    ...selected.stacks!,
    "--app",
    "cdk.out",
    "--exclusively",
    "--no-change-set",
  );
  cdk(
    "deploy",
    ...selected.stacks!,
    "--app",
    "cdk.out",
    "--exclusively",
    "--require-approval",
    "any-change",
    "--outputs-file",
    `private/owner-${phase}-outputs.json`,
  );
}
console.log(
  "Owner phase complete. Keep outputs private. No application invitations were sent.",
);
