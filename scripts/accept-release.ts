import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
const [stage] = process.argv.slice(2);
if (!["preprod", "prod"].includes(stage)) throw new Error("Invalid stage");
const out = JSON.parse(await readFile(`release/${stage}-outputs.json`, "utf8"));
execFileSync(
  "aws",
  [
    "s3",
    "cp",
    "release/manifest.json",
    `s3://${out.AssetsBucket}/releases/current.json`,
    "--region",
    "us-west-2",
  ],
  { stdio: "inherit" },
);
