import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const systemChromium = process.env["CHROMIUM_PATH"] ?? [
  "/usr/bin/chromium",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find(existsSync);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  workers: 1,
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
