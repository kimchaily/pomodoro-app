/**
 * Service-Worker-Updates: Eine neue Version muss sofort sichtbar sein – im
 * Browser/PWA und in der Android-App, wo der Worker ein APK-Update überlebt.
 *
 * Simuliert mit einem eigenen Server, der je Phase eine andere "App-Version"
 * ausliefert (Marker im <head>):
 *   A  alter Cache-first-Worker (tests/fixtures/sw-cache-first.js), Version v1
 *   B  "Update" auf den aktuellen Worker + v2 → erster Start zeigt nach dem
 *      automatischen Neuladen v2 (früher erst beim zweiten Start)
 *   C  nächstes Release (v3), Worker unverändert → sofort v3, kein Neuladen nötig
 *   D  offline → letzte Version kommt aus dem Cache
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(__dirname, "..", "docs");
const OLD_SW = path.join(__dirname, "fixtures", "sw-cache-first.js");
const PORT = 8125;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

let phase = { version: "v1", sw: OLD_SW };

const server = http.createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (rel === "/") rel = "/index.html";
    const file = rel === "/sw.js" ? phase.sw : path.join(DOCS, rel);
    if (!file.startsWith(DOCS) && file !== phase.sw) return res.writeHead(404).end();
    if (!existsSync(file)) return res.writeHead(404).end();
    let body = await readFile(file);
    if (rel === "/index.html") {
      body = body.toString().replace("</head>", `<meta name="app-version" content="${phase.version}"></head>`);
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(body);
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise((r) => server.listen(PORT, r));

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "✓" : "✗"} ${name} → got ${JSON.stringify(actual)}${ok ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!ok) failures++;
}

const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE || undefined });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10000); // ein hängender Worker soll scheitern, nicht ewig warten
  const shownVersion = async () => {
    try {
      return await page.evaluate(() => document.querySelector('meta[name="app-version"]')?.content ?? null);
    } catch {
      return null; // gerade mitten in einer Navigation
    }
  };
  // Wartet, bis die erwartete Version angezeigt wird (der Worker lädt ggf. selbst neu).
  const settledVersion = async (expected, ms = 5000) => {
    const until = Date.now() + ms;
    let v = await shownVersion();
    while (v !== expected && Date.now() < until) {
      await page.waitForTimeout(100);
      v = await shownVersion();
    }
    return v;
  };

  // A: alte App mit altem Worker installiert und aktiv.
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle" });
  check("A: old version installed and controlled by the old worker",
    await page.evaluate(() => !!navigator.serviceWorker.controller), true);
  check("A: shows v1", await shownVersion(), "v1");

  // B: Update (neue Dateien + neuer Worker) – der erste Start reicht.
  phase = { version: "v2", sw: path.join(DOCS, "sw.js") };
  await page.reload({ waitUntil: "networkidle" });
  check("B: first start after the update shows the new version", await settledVersion("v2"), "v2");
  check("B: old caches are gone",
    await page.evaluate(async () => (await caches.keys()).filter((k) => k !== "pomodoro-offline").length), 0);

  // C: nächstes Release, Worker unverändert – sofort aktuell.
  phase = { version: "v3", sw: path.join(DOCS, "sw.js") };
  await page.reload({ waitUntil: "networkidle" });
  check("C: next release is visible on the very first load", await shownVersion(), "v3");

  // D: offline – die zuletzt geladene Version kommt aus dem Cache.
  await context.setOffline(true);
  await page.reload({ waitUntil: "load" });
  check("D: offline the app still loads from the cache", await shownVersion(), "v3");
  check("D: offline the app script still runs",
    await page.evaluate(() => document.getElementById("time-display")?.textContent?.length > 0), true);
  await context.setOffline(false);
} finally {
  await browser.close();
  server.close();
}

console.log(failures === 0 ? "\nAll checks passed ✅" : `\n${failures} check(s) failed ❌`);
process.exit(failures === 0 ? 0 : 1);
