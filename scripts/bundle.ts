import { build } from "esbuild";
await build({
  entryPoints: {
    request: "api/handler.ts",
    expiry: "api/expiry.ts",
    backup: "api/backup.ts",
  },
  outdir: "dist/api",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  minify: true,
  sourcemap: false,
});
