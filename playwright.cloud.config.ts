import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/cloud",
  workers: 1,
  retries: 0,
  timeout: 120000,
  use: { headless: true, trace: "off", screenshot: "off", video: "off" },
});
