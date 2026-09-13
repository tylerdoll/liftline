import { Service } from "../domain/service";
import { DynamoStore } from "./dynamo";
export async function handler() {
  const result = await new Service(
    new DynamoStore(process.env.TABLE_NAME!),
  ).expire();
  console.log(JSON.stringify({ event: "expiry_completed", ...result }));
  if (result.quarantined)
    throw new Error(
      "Expiry quarantined records; private administrator review required",
    );
  return result;
}
