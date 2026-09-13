// Test host only. This file is never bundled into Lambda or the SPA.
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { awsFixture } from "../tests/support/aws";
import { makeHandler } from "../api/handler";
const fixture = await awsFixture();
fixture.setNow(Date.now());
const handler = makeHandler(fixture.service);
const server = await createServer({
  configFile: false,
  optimizeDeps: { entries: ["index.html"] },
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
    watch: { ignored: ["**/.local-python/**", "**/cdk.out/**"] },
  },
  plugins: [
    react(),
    {
      name: "local-aws",
      configureServer(s) {
        s.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url!, "http://127.0.0.1:4174");
          const json = (v: unknown, status = 200) => {
            res.statusCode = status;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(v));
          };
          if (url.pathname === "/runtime-config.json")
            return json({
              clientId: "synthetic-client",
              cognitoDomain: "http://127.0.0.1:4174",
              issuer: "test",
              redirectUri: "http://127.0.0.1:4174/",
              scope: "openid",
            });
          if (url.pathname === "/oauth2/authorize") {
            res.statusCode = 302;
            res.setHeader(
              "location",
              `/?code=synthetic&state=${encodeURIComponent(url.searchParams.get("state")!)}`,
            );
            return res.end();
          }
          if (url.pathname === "/oauth2/token")
            return json({ access_token: "synthetic-alice", expires_in: 3600 });
          if (url.pathname.startsWith("/api/")) {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            const token = req.headers.authorization;
            const result = await handler({
              rawPath: url.pathname,
              body: Buffer.concat(chunks).toString(),
              queryStringParameters: Object.fromEntries(url.searchParams),
              requestContext: {
                http: { method: req.method },
                authorizer: {
                  jwt: {
                    claims:
                      token === "Bearer synthetic-alice"
                        ? { iss: "test", sub: "alice" }
                        : undefined,
                  },
                },
              },
            });
            res.statusCode = result.statusCode;
            for (const [k, v] of Object.entries(result.headers))
              res.setHeader(k, v);
            return res.end(result.body);
          }
          next();
        });
      },
    },
  ],
});
await server.listen();
console.log("Synthetic AWS test host: http://127.0.0.1:4174");
