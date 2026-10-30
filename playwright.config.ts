import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
export default defineConfig({
  testDir: "scripts/browser", workers: 1, timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:18771", headless: true,
    launchOptions: { ...(existsSync(edge) ? { executablePath: edge } : {}), args: ["--no-proxy-server"] },
  },
  outputDir: "tmp/playwright-results",
  webServer: {
    command: "node scripts/serve.mjs",
    url: "http://127.0.0.1:18771", reuseExistingServer: false, timeout: 10000,
  },
});
