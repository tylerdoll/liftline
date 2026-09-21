import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";

// The public repository's artifacts must not expose project IDs or alert emails
// embedded in the CDK assembly. GCM authenticates the entire archive.
const mode = process.argv[2];
const key = Buffer.from(process.env.CANDIDATE_KEY ?? "", "hex");
if (
  key.length !== 32 ||
  !/^[a-f0-9]{64}$/i.test(process.env.CANDIDATE_KEY ?? "")
)
  throw new Error("CANDIDATE_KEY must be a 32-byte hex secret");
if (mode === "pack") {
  execFileSync("tar", [
    "-cf",
    "candidate.tar",
    "dist",
    "cdk.out",
    "release/manifest.json",
  ]);
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const ciphertext = Buffer.concat([
      cipher.update(await readFile("candidate.tar")),
      cipher.final(),
    ]);
    await writeFile(
      "candidate.enc",
      Buffer.concat([
        Buffer.from("LLC1"),
        nonce,
        cipher.getAuthTag(),
        ciphertext,
      ]),
    );
  } finally {
    await rm("candidate.tar", { force: true });
  }
} else if (mode === "unpack") {
  const bytes = await readFile("candidate.enc");
  if (bytes.subarray(0, 4).toString() !== "LLC1")
    throw new Error("Invalid candidate archive");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(4, 16));
  decipher.setAuthTag(bytes.subarray(16, 32));
  const plaintext = Buffer.concat([
    decipher.update(bytes.subarray(32)),
    decipher.final(),
  ]);
  await writeFile("candidate.tar", plaintext);
  try {
    execFileSync("tar", ["-xf", "candidate.tar"]);
  } finally {
    await rm("candidate.tar", { force: true });
  }
} else throw new Error("Usage: candidate-archive pack|unpack");
