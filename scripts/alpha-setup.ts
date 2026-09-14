import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const mode = process.argv[2] ?? "prepare";
if (!["prepare", "bootstrap", "deploy", "verify"].includes(mode))
  throw new Error("Unknown alpha setup mode");
const config = JSON.parse(await readFile("private/alpha.json", "utf8"));
if (
  config.profile !== "liftline-alpha" ||
  config.region !== "us-east-2" ||
  !/^\d{12}$/.test(config.account) ||
  /^(\d)\1{11}$/.test(config.account)
)
  throw new Error("Real alpha project configuration required");
if (
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.alertEmail) ||
  config.alertEmail.endsWith(".invalid")
)
  throw new Error("Real alert email required");
const env = {
  ...process.env,
  AWS_PROFILE: config.profile,
  AWS_REGION: config.region,
  AWS_DEFAULT_REGION: config.region,
  ALPHA_ACCOUNT: config.account,
  ALERT_EMAIL: config.alertEmail,
  AWS_PAGER: "",
};
const awsPath =
  process.platform === "win32"
    ? join(process.env.LOCALAPPDATA!, "Programs/Amazon/AWSCLIV2/aws.exe")
    : "aws";
const aws = (...args: string[]) =>
  execFileSync(
    awsPath,
    [
      ...args,
      "--profile",
      config.profile,
      "--region",
      config.region,
      "--no-cli-pager",
    ],
    { env, encoding: "utf8" },
  );
if (JSON.parse(aws("sts", "get-caller-identity")).Account !== config.account)
  throw new Error("Wrong project: refusing alpha setup");
const node = (...args: string[]) =>
  execFileSync(process.execPath, args, { env, stdio: "inherit" });
const cdk = (...args: string[]) =>
  node("node_modules/aws-cdk/bin/cdk", ...args, "--profile", config.profile);
async function hashes() {
  const result: Record<string, string> = {};
  async function visit(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else
        result[path] = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
    }
  }
  for (const dir of ["dist/api", "dist/web", "cdk.out/alpha"]) await visit(dir);
  return result;
}
async function assembly() {
  const m = JSON.parse(await readFile("cdk.out/alpha/manifest.json", "utf8"));
  const stacks = Object.entries(m.artifacts).filter(
    ([, a]: any) => a.type === "aws:cloudformation:stack",
  );
  if (
    stacks.length !== 3 ||
    stacks.some(
      ([name, a]: any) =>
        ![
          "LiftlineData-alpha",
          "LiftlineDelivery-alpha",
          "LiftlineApp-alpha",
        ].includes(name) ||
        a.environment !== `aws://${config.account}/us-east-2`,
    )
  )
    throw new Error("Assembly is not confined to alpha");
  return stacks;
}
if (mode === "prepare") {
  node("node_modules/vite/bin/vite.js", "build");
  node("--import", "tsx", "scripts/bundle.ts");
  node("--import", "tsx", "infra/alpha.ts");
  const stacks = await assembly();
  const summary = [];
  for (const [name, a] of stacks as [string, any][]) {
    const t = JSON.parse(
      await readFile(`cdk.out/alpha/${a.properties.templateFile}`, "utf8"),
    );
    const counts: Record<string, number> = {};
    for (const r of Object.values(t.Resources) as any[])
      counts[r.Type] = (counts[r.Type] ?? 0) + 1;
    summary.push({ stack: name, resources: counts });
  }
  await writeFile(
    "private/alpha-plan.json",
    JSON.stringify(
      {
        account: config.account,
        region: config.region,
        hashes: await hashes(),
        summary,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(summary, null, 2));
  console.log("Prepared alpha only. No AWS resources created.");
} else if (mode === "bootstrap") {
  cdk(
    "bootstrap",
    `aws://${config.account}/us-east-2`,
    "--termination-protection",
  );
} else if (mode === "deploy") {
  await assembly();
  const plan = JSON.parse(await readFile("private/alpha-plan.json", "utf8"));
  if (plan.account !== config.account || plan.region !== config.region)
    throw new Error("Plan targets a different project");
  const current = await hashes();
  if (
    Object.keys(current).length !== Object.keys(plan.hashes).length ||
    Object.entries(current).some(([p, h]) => plan.hashes[p] !== h)
  )
    throw new Error("Prepared artifacts changed; prepare and review again");
  cdk("diff", "--app", "cdk.out/alpha", "--no-change-set");
  cdk(
    "deploy",
    "--app",
    "cdk.out/alpha",
    "--all",
    "--require-approval",
    "never",
    "--outputs-file",
    "private/alpha-outputs.json",
  );
  const outputs = JSON.parse(
    await readFile("private/alpha-outputs.json", "utf8"),
  )["LiftlineApp-alpha"];
  aws(
    "s3",
    "cp",
    "dist/web",
    `s3://${outputs.AssetsBucket}`,
    "--recursive",
    "--exclude",
    "index.html",
    "--cache-control",
    "public,max-age=31536000,immutable",
  );
  aws(
    "s3",
    "cp",
    "dist/web/index.html",
    `s3://${outputs.AssetsBucket}/index.html`,
    "--cache-control",
    "no-store",
  );
  aws(
    "cloudfront",
    "create-invalidation",
    "--distribution-id",
    outputs.Distribution,
    "--paths",
    "/index.html",
    "/",
  );
  node("--import", "tsx", "scripts/catalog.ts", "liftline-alpha");
  console.log(
    "Alpha deployed with common catalog only. No application invitations sent.",
  );
  console.log(outputs.Url);
} else {
  for (const name of [
    "CDKToolkit",
    "LiftlineDelivery-alpha",
    "LiftlineData-alpha",
    "LiftlineApp-alpha",
  ]) {
    console.log(
      aws(
        "cloudformation",
        "describe-stacks",
        "--stack-name",
        name,
        "--query",
        "Stacks[0].[StackName,StackStatus]",
        "--output",
        "json",
      ),
    );
  }
}
