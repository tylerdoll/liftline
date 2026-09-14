import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/aws-browser",
  use: { baseURL: "http://127.0.0.1:4174", headless: true },
  webServer: {
    command: "node --import tsx scripts/aws-server.ts",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
  },
  workers: 1,
});
