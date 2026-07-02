/**
 * End-to-end UI checks for the Pomodoro app.
 *
 * Covers the three recent additions:
 *   1. Resettable Pomodoro cycle counter (tap the dots)
 *   2. − / + stepper buttons on the task estimate field
 *   3. Tomato app icon assets are present and served
 *
 * Run it:
 *   npm install            # once, pulls in playwright (devDependency)
 *   npx playwright install chromium   # once, downloads the browser
 *   npm test
 *
 * The script starts its own static server for ./docs, so nothing else
 * needs to be running. It exits with code 0 when every check passes and
 * code 1 on the first failure.
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(__dirname, "..", "docs");
const PORT = 8123;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

/* ---------- tiny static file server for ./docs ---------- */
function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (rel === "/") rel = "/index.html";
      const file = path.join(DOCS, rel);
      if (!file.startsWith(DOCS) || !existsSync(file)) {
        res.writeHead(404).end("not found");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(500).end("error");
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

/* ---------- assertion helpers ---------- */
let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "✓" : "✗"} ${name} → got ${JSON.stringify(actual)}${ok ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!ok) failures++;
}

/* ---------- run ---------- */
const server = await startServer();
const browser = await chromium.launch({
  executablePath: process.env.PW_EXECUTABLE || undefined,
});

try {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message));

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle" });

  /* --- 2. Task estimate stepper --- */
  const est = page.locator("#task-est");
  check("estimate starts at 1", await est.inputValue(), "1");

  await page.click("#est-inc");
  await page.click("#est-inc");
  check("+ twice → 3", await est.inputValue(), "3");

  await page.click("#est-dec");
  check("− once → 2", await est.inputValue(), "2");

  for (let i = 0; i < 6; i++) await page.click("#est-dec");
  check("clamps at min (1)", await est.inputValue(), "1");

  for (let i = 0; i < 30; i++) await page.click("#est-inc");
  check("clamps at max (20)", await est.inputValue(), "20");

  // chosen estimate carries into the created task, then resets to 1
  await est.fill("3");
  await page.fill("#task-input", "Testaufgabe");
  await page.click(".add-btn");
  check("task shows 0/3", (await page.locator(".task-count").first().textContent())?.replace(/\s*🍅$/, ""), "0/3");
  check("estimate resets to 1 after add", await est.inputValue(), "1");

  /* --- 1. Resettable cycle counter --- */
  check("cycle has 4 dots (longEvery)", await page.locator("#cycle-dots span").count(), 4);

  // Skip advances the focus cycle; do it twice
  await page.click("#btn-skip");
  await page.click('.mode-tab[data-mode="focus"]');
  await page.click("#btn-skip");
  await page.click('.mode-tab[data-mode="focus"]');
  check("2 dots filled after 2 skips", await page.locator("#cycle-dots span.done").count(), 2);

  await page.click("#cycle-dots");
  check("counter resets to 0 on tap", await page.locator("#cycle-dots span.done").count(), 0);

  /* --- reset persists across reload --- */
  await page.reload({ waitUntil: "networkidle" });
  check("counter still 0 after reload", await page.locator("#cycle-dots span.done").count(), 0);

  /* --- 3. Tomato icon assets served --- */
  for (const asset of ["icon.svg", "icon-192.png", "icon-512.png"]) {
    const status = (await page.request.get(`http://localhost:${PORT}/${asset}`)).status();
    check(`${asset} is served`, status, 200);
  }

  check("no console/page errors", consoleErrors.length, 0);
  if (consoleErrors.length) console.log(consoleErrors);
} finally {
  await browser.close();
  server.close();
}

console.log(failures === 0 ? "\nAll checks passed ✅" : `\n${failures} check(s) failed ❌`);
process.exit(failures === 0 ? 0 : 1);
