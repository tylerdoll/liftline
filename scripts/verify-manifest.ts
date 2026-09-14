import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const manifest = JSON.parse(await readFile("release/manifest.json", "utf8"));
if (manifest.format !== 1 || manifest.schema.writes !== 1)
  throw new Error("Unsupported manifest/schema");
for (const [path, hash] of Object.entries(manifest.artifacts)) {
  if (
    (!path.startsWith("dist/") && !path.startsWith("cdk.out/")) ||
    path.includes("..")
  )
    throw new Error("Invalid artifact path");
  if (
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex") !== hash
  )
    throw new Error(`Artifact hash mismatch: ${path}`);
}
if (process.env.GITHUB_SHA && manifest.commit !== process.env.GITHUB_SHA)
  throw new Error("Commit mismatch");
console.log("All artifact hashes match.");
