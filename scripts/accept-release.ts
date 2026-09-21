import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
const [stage] = process.argv.slice(2);
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REF !== "refs/heads/main"
)
  throw new Error("Release acceptance is GitHub-only");
if (!["beta", "prod"].includes(stage)) throw new Error("Invalid stage");
const out = JSON.parse(await readFile(`release/${stage}-outputs.json`, "utf8"));
execFileSync(
  "aws",
  [
    "s3",
    "cp",
    "release/manifest.json",
    `s3://${out.AssetsBucket}/releases/current.json`,
    "--region",
    "us-east-2",
  ],
  { stdio: "inherit" },
);
