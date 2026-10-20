import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const systemChromium = process.env["CHROMIUM_PATH"] ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    launchOptions: { ...(systemChromium ? { executablePath: systemChromium } : {}), args: ["--no-sandbox"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev:web",
    url: "http://127.0.0.1:5173/@vite/client",
    reuseExistingServer: !process.env["CI"],
    timeout: 30_000,
  },
});
