import { ZodError } from "zod";
import { Service } from "../domain/service";
import { DynamoStore } from "./dynamo";
import { Failure } from "../domain/store";
import { S3Archive } from "./archive";
import type { Archive } from "../domain/migration";
export function makeHandler(service: Service, archive?: Archive) {
  return async (event: any) => {
    try {
      const p = await service.authorize(
        event.requestContext?.authorizer?.jwt?.claims,
      );
      const method = event.requestContext?.http?.method,
        path = event.rawPath as string;
      if (!path.startsWith("/api/v1/")) throw new Failure(404, "Not found");
      if (event.isBase64Encoded) throw new Failure(400, "JSON body required");
      if (Buffer.byteLength(event.body ?? "") > 210 * 1024)
        throw new Failure(413, "Request too large");
      const body = event.body ? JSON.parse(event.body) : undefined;
      const [resource, key, action] = path.slice("/api/v1/".length).split("/");
      const cursor = event.queryStringParameters?.cursor;
      let result: any;
      if (
        action === "legacy" &&
        key &&
        method === "GET" &&
        ["plans", "sessions"].includes(resource)
      ) {
        const item = await service.own(
          p,
          resource === "plans" ? "PLAN" : "SESSION",
          key,
        );
        if (!archive || !item.legacyRef?.startsWith(`private/${p.id}/`))
          throw new Failure(404, "Not found");
        const part = Number(event.queryStringParameters?.part ?? 0);
        if (!Number.isSafeInteger(part) || part < 0)
          throw new Failure(400, "Invalid part");
        const raw = Buffer.from(await archive.get(item.legacyRef));
        const size = 96 * 1024;
        if (part * size >= raw.length) throw new Failure(404, "Not found");
        return response(200, {
          part,
          parts: Math.ceil(raw.length / size),
          content: raw
            .subarray(part * size, (part + 1) * size)
            .toString("base64"),
        });
      }
      if (resource === "me" && !key) {
        if (method === "GET") result = p.profile;
        else if (method === "PUT")
          result = await service.updateProfile(p, body);
      } else if (resource === "exercises") {
        if (method === "GET")
          result = key
            ? await service.exercise(p, key)
            : await service.list(p, "EXERCISE", cursor);
        else if (method === "PUT" && key)
          result = await service.save(p, "EXERCISE", key, body);
      } else if (resource === "catalog" && method === "GET") {
        const page = await service.store.query("CATALOG", "EXERCISE#", cursor);
        result = {
          ...page,
          items: page.items.map(({ PK: _p, SK: _s, ...e }) => e),
        };
      } else if (resource === "plans") {
        if (method === "GET")
          result = key
            ? await service.own(p, "PLAN", key)
            : await service.list(p, "PLAN", cursor);
        else if (method === "PUT" && key)
          result = await service.save(p, "PLAN", key, body);
      } else if (resource === "sessions") {
        if (method === "GET" && !action)
          result = key
            ? await service.own(p, "SESSION", key)
            : await service.list(p, "SESSION", cursor);
        else if (
          key &&
          ((method === "PUT" && !action) ||
            (method === "POST" && ["complete", "discard"].includes(action)))
        )
          result = await service.saveSession(
            p,
            key,
            body,
            action === "complete"
              ? "complete"
              : action === "discard"
                ? "discard"
                : "save",
          );
      } else if (resource === "history" && method === "GET")
        result = await service.list(p, "HISTORY", cursor);
      else if (resource === "progress" && method === "GET" && key)
        result = await service.list(p, `PROGRESS#${key}`, cursor);
      else if (resource === "weeks" && method === "GET")
        result = await service.list(p, "WEEK", cursor);
      else if (resource === "shares") {
        if (method === "POST" && !key)
          result = await service.createShare(p, body);
        else if (method === "POST" && key === "redeem")
          result = await service.redeem(p, body?.token ?? "");
        else if (method === "POST" && key && action === "revoke")
          result = await service.revoke(p, key, body);
        else if (method === "GET" && !key) {
          const page = await service.list(p, "SHARE", cursor);
          result = {
            ...page,
            items: page.items.map(({ tokenHash: _h, ...i }) => i),
          };
        }
      }
      if (result === undefined) throw new Failure(404, "Not found");
      return response(200, result);
    } catch (e) {
      if (e instanceof Failure) return response(e.status, { error: e.message });
      if (e instanceof ZodError || e instanceof SyntaxError)
        return response(400, { error: "Invalid request" });
      // Deliberately omit request bodies, claims, tokens and exception messages.
      console.error(JSON.stringify({ event: "request_failed" }));
      return response(500, {
        error: "Request failed; retry with the same operation ID",
      });
    }
  };
}
function response(statusCode: number, value: unknown) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
    body: JSON.stringify(value),
  };
}
let runtime: ReturnType<typeof makeHandler> | undefined;
export async function handler(event: unknown) {
  runtime ??= makeHandler(
    new Service(new DynamoStore(process.env.TABLE_NAME!)),
    new S3Archive(process.env.ARCHIVE_BUCKET!),
  );
  return runtime(event);
}
