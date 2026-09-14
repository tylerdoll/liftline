import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
async function files(path: string): Promise<string[]> {
  const result = [];
  for (const e of await readdir(path, { withFileTypes: true })) {
    const p = join(path, e.name);
    result.push(...(e.isDirectory() ? await files(p) : [p]));
  }
  return result;
}
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const commit =
  process.env.GITHUB_SHA ??
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const artifacts = [...(await files("dist")), ...(await files("cdk.out"))];
const hashes = Object.fromEntries(
  await Promise.all(
    artifacts
      .sort()
      .map(async (file) => [
        file.replaceAll("\\", "/"),
        sha(await readFile(file)),
      ]),
  ),
);
const manifest = {
  format: 1,
  commit,
  schema: { writes: 1, reads: [1], migration: "additive-only" },
  artifacts: hashes,
};
await mkdir("release", { recursive: true });
await writeFile("release/manifest.json", JSON.stringify(manifest, null, 2));
console.log("Immutable artifact manifest written.");
