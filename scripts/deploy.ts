import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const [stage, mode = "deploy"] = process.argv.slice(2);
if (!["preprod", "prod"].includes(stage))
  throw new Error("Stage must be preprod or prod");
const account =
  process.env[stage === "prod" ? "PROD_ACCOUNT" : "PREPROD_ACCOUNT"];
if (
  !account ||
  !/^[0-9]{12}$/.test(account) ||
  ["111111111111", "222222222222"].includes(account)
)
  throw new Error("Real account configuration required");
const aws = (...args: string[]) =>
  execFileSync("aws", [...args, "--region", "us-east-2"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
if (JSON.parse(aws("sts", "get-caller-identity")).Account !== account)
  throw new Error("Wrong AWS account");
await mkdir("release", { recursive: true });
const stack = `LiftlineApp-${stage}`;
const outputs = () =>
  Object.fromEntries(
    JSON.parse(
      aws("cloudformation", "describe-stacks", "--stack-name", stack),
    ).Stacks[0].Outputs.map((o: any) => [o.OutputKey, o.OutputValue]),
  ) as Record<string, string>;
if (mode === "rollback") {
  const prior = JSON.parse(
    await readFile(`release/${stage}-previous.json`, "utf8"),
  );
  if (!prior)
    throw new Error(
      "No previous deployment; leave new environment unopened and investigate",
    );
  for (const name of ["ApiFunction", "ExpiryFunction"])
    aws(
      "lambda",
      "update-alias",
      "--function-name",
      prior.outputs[name],
      "--name",
      "live",
      "--function-version",
      prior.versions[name],
    );
  aws(
    "s3",
    "cp",
    `s3://${prior.outputs.AssetsBucket}/releases/${prior.commit}/index.html`,
    `s3://${prior.outputs.AssetsBucket}/index.html`,
    "--cache-control",
    "no-store",
  );
  aws(
    "cloudfront",
    "create-invalidation",
    "--distribution-id",
    prior.outputs.Distribution,
    "--paths",
    "/index.html",
    "/",
  );
  console.log(
    "Previous application aliases and index restored; canonical data retained.",
  );
} else {
  await import("./verify-manifest");
  const manifest = JSON.parse(await readFile("release/manifest.json", "utf8"));
  let previous = null;
  try {
    const out = outputs();
    let last;
    try {
      last = JSON.parse(
        aws("s3", "cp", `s3://${out.AssetsBucket}/releases/current.json`, "-"),
      );
    } catch {
      last = null;
    }
    if (last) {
      const versions = Object.fromEntries(
        ["ApiFunction", "ExpiryFunction"].map((name) => [
          name,
          JSON.parse(
            aws(
              "lambda",
              "get-alias",
              "--function-name",
              out[name],
              "--name",
              "live",
            ),
          ).FunctionVersion,
        ]),
      );
      previous = { outputs: out, versions, commit: last.commit };
    }
  } catch (e: any) {
    if (!String(e.stderr).includes("does not exist")) throw e;
  }
  await writeFile(`release/${stage}-previous.json`, JSON.stringify(previous));
  execFileSync(
    "node",
    [
      "node_modules/aws-cdk/bin/cdk",
      "deploy",
      stack,
      "--app",
      "cdk.out",
      "--exclusively",
      "--require-approval",
      "never",
    ],
    { stdio: "inherit" },
  );
  const out = outputs();
  aws(
    "s3",
    "cp",
    "dist/web",
    `s3://${out.AssetsBucket}`,
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
    `s3://${out.AssetsBucket}/releases/${manifest.commit}/index.html`,
    "--cache-control",
    "no-store",
  );
  aws(
    "s3",
    "cp",
    "release/manifest.json",
    `s3://${out.AssetsBucket}/releases/${manifest.commit}/manifest.json`,
  );
  aws(
    "s3",
    "cp",
    "dist/web/index.html",
    `s3://${out.AssetsBucket}/index.html`,
    "--cache-control",
    "no-store",
  );
  aws(
    "cloudfront",
    "create-invalidation",
    "--distribution-id",
    out.Distribution,
    "--paths",
    "/index.html",
    "/",
  );
  await writeFile(`release/${stage}-outputs.json`, JSON.stringify(out));
  console.log(
    "Exact manifest deployed; smoke verification required before acceptance.",
  );
}
