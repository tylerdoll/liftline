import { DynamoStore } from "../api/dynamo";
import { builtins } from "../domain/catalog";
import { absent, type Store } from "../domain/store";
export async function seedCatalog(store: Store) {
  for (const e of builtins) {
    const SK = `EXERCISE#${e.id}`,
      old = await store.get("CATALOG", SK);
    if (old) {
      if (
        ["id", "name", "muscle", "equipment"].some(
          (k) => old[k] !== e[k as keyof typeof e],
        )
      )
        throw new Error(
          "Existing catalog differs; explicit additive version required",
        );
      continue;
    }
    await store.transact([
      {
        put: {
          PK: "CATALOG",
          SK,
          ...e,
          schemaVersion: 1,
          revision: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        condition: absent,
      },
    ]);
  }
  if (!(await store.get("SYSTEM", "TRANSFORM#catalog-v1")))
    await store.transact([
      {
        put: {
          PK: "SYSTEM",
          SK: "TRANSFORM#catalog-v1",
          status: "complete",
          schemaVersion: 1,
        },
        condition: absent,
      },
    ]);
}
if (process.argv[1]?.endsWith("catalog.ts")) {
  if (!process.argv[2]) throw new Error("Usage: catalog <table>");
  await seedCatalog(new DynamoStore(process.argv[2]));
  console.log("Catalog transform complete.");
}
