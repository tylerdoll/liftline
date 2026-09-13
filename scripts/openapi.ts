import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { exercise, plan, session, mutation } from "../contracts";
const schemas = {
  Exercise: z.toJSONSchema(exercise),
  Plan: z.toJSONSchema(plan),
  Session: z.toJSONSchema(session),
  Mutation: z.toJSONSchema(mutation),
};
const paths: Record<string, any> = {};
for (const path of [
  "/me",
  "/catalog",
  "/exercises",
  "/exercises/{id}",
  "/plans",
  "/plans/{id}",
  "/sessions",
  "/sessions/{id}",
  "/history",
  "/progress/{id}",
  "/weeks",
  "/shares",
])
  paths[`/api/v1${path}`] = {
    get: {
      security: [{ bearer: [] }],
      responses: {
        200: { description: "Owned resources or paginated items and cursor" },
        401: { description: "Unauthenticated" },
        403: { description: "Disabled or unbound identity" },
        404: { description: "Not found in caller ownership" },
      },
    },
  };
for (const [path, schema] of [
  ["/me", null],
  ["/plans/{id}", "Plan"],
  ["/exercises/{id}", "Exercise"],
  ["/sessions/{id}", "Session"],
] as const) {
  paths[`/api/v1${path}`].put = {
    security: [{ bearer: [] }],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Mutation" },
          "x-value-schema": schema,
        },
      },
    },
    responses: {
      200: { description: "Saved resource or receipt" },
      400: { description: "Invalid contract" },
      409: { description: "Revision or operation conflict" },
      413: { description: "Oversized document" },
    },
  };
}
for (const path of [
  "/sessions/{id}/complete",
  "/sessions/{id}/discard",
  "/shares",
  "/shares/redeem",
  "/shares/{id}/revoke",
])
  paths[`/api/v1${path}`] = {
    ...paths[`/api/v1${path}`],
    post: {
      security: [{ bearer: [] }],
      responses: {
        200: { description: "Durable result" },
        409: { description: "Conflict" },
        404: { description: "Unavailable" },
      },
    },
  };
for (const [path, item] of Object.entries(paths)) {
  if (path.includes("{id}"))
    item.parameters = [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
    ];
  if (item.get)
    item.get.parameters = [
      {
        name: "cursor",
        in: "query",
        required: false,
        schema: { type: "string" },
      },
    ];
}
await mkdir("contracts", { recursive: true });
await writeFile(
  "contracts/openapi.json",
  JSON.stringify(
    {
      openapi: "3.1.0",
      info: { title: "Liftline API", version: "1.0.0" },
      paths,
      components: {
        securitySchemes: {
          bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
        schemas,
      },
    },
    null,
    2,
  ),
);
