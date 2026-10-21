import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "veper-production-smoke-"));
const portServer = createServer();
portServer.listen(0, "127.0.0.1");
await once(portServer, "listening");
const address = portServer.address();
if (!address || typeof address === "string") throw new Error("Za dimni preizkus ni mogoče določiti vrat.");
const port = address.port;
await new Promise((resolve, reject) => portServer.close((error) => error ? reject(error) : resolve()));

const child = spawn(process.execPath, ["dist/server/main.js"], {
  cwd: process.cwd(),
  env: {
    PATH: process.env["PATH"] ?? "",
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATABASE_PATH: join(temporaryDirectory, "smoke.sqlite"),
    GEMINI_API_KEY: "",
    VEPER_DISABLE_POLLING: "1",
  },
  stdio: ["ignore", "ignore", "pipe"],
});

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });

try {
  const baseUrl = "http://127.0.0.1:" + port;
  const deadline = Date.now() + 15_000;
  let ready = false;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(baseUrl + "/api/health", { signal: AbortSignal.timeout(500) });
      ready = response.ok;
      if (ready) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(ready, true, "Produkcijski strežnik se ni odzval. " + stderr.slice(-1_000));

  const health = await fetch(baseUrl + "/api/health");
  assert.deepEqual(await health.json(), { ok: true });
  const deskResponse = await fetch(baseUrl + "/api/desk");
  assert.equal(deskResponse.status, 200);
  const desk = await deskResponse.json();
  assert.equal(desk.ai.state, "disabled");
  assert.equal(desk.stories.length, 0);
  assert.equal(desk.sources.length, 6);
  assert.ok(desk.sources.every((source) => source.state === "waiting"));

  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /lang="sl"/);
  const scriptPath = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(scriptPath, "V produkcijskem HTML manjka aplikacijska skripta.");
  const script = await fetch(new URL(scriptPath, baseUrl));
  assert.equal(script.status, 200);
  assert.ok((await script.text()).includes("Uredniški pregled"));
  console.log("Produkcijski strežnik, API, prazno stanje in statični brskalniški paket delujejo.");
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
