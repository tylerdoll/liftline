import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
const manifest = JSON.parse(await readFile("release/manifest.json", "utf8"));
if (manifest.format !== 1 || manifest.schema.writes !== 1)
  throw new Error("Unsupported manifest/schema");
async function files(dir: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isSymbolicLink())
      throw new Error("Artifact symlinks are forbidden");
    result.push(...(entry.isDirectory() ? await files(path) : [path]));
  }
  return result;
}
const actual = [...(await files("dist")), ...(await files("cdk.out"))].sort();
const listed = Object.keys(manifest.artifacts).sort();
if (JSON.stringify(actual) !== JSON.stringify(listed))
  throw new Error("Artifact file set mismatch");
for (const required of [
  "dist/web/index.html",
  "dist/api/request.cjs",
  "dist/api/expiry.cjs",
  "dist/api/backup.cjs",
  "cdk.out/manifest.json",
  "cdk.out/LiftlineApp-beta.template.json",
  "cdk.out/LiftlineApp-prod.template.json",
])
  if (!listed.includes(required))
    throw new Error("Required candidate artifact missing");
for (const [path, hash] of Object.entries(manifest.artifacts)) {
  if (
    (!path.startsWith("dist/") && !path.startsWith("cdk.out/")) ||
    path.includes("..") ||
    path.includes("\\") ||
    path.includes(":")
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
