/**
 * Tests für die In-App-Updateprüfung (Android).
 *
 * Der native Teil (ApkUpdater-Plugin) wird gemockt; geprüft wird die
 * komplette JS-Logik: Sichtbarkeit nur in der nativen App, Versionsvergleich
 * gegen das GitHub-Release, Download-Aufruf und der Berechtigungs-Hinweis.
 *
 * Läuft über `npm test` (siehe tests/README.md).
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(__dirname, "..", "docs");
const PORT = 8124;

const INSTALLED_SHA = "a".repeat(40);
const NEWER_SHA = "b".repeat(40);
const APK_URL = "https://github.com/kimchaily/pomodoro-app/releases/download/latest/pomodoro.apk";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

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
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(await readFile(file));
    } catch {
      res.writeHead(500).end("error");
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "✓" : "✗"} ${name} → got ${JSON.stringify(actual)}${ok ? "" : `, expected ${JSON.stringify(expected)}`}`);
  if (!ok) failures++;
}

function releaseJson(sha) {
  return {
    tag_name: "latest",
    name: "Pomodoro – Build vom 03.07.2026 07:10 UTC",
    body: `**Commit:** [\`${sha.slice(0, 7)}\`](https://github.com/kimchaily/pomodoro-app/commit/${sha}) – Testbuild`,
    assets: [{ name: "pomodoro.apk", browser_download_url: APK_URL, updated_at: "2026-07-03T07:10:02Z" }],
  };
}

/** Öffnet die App mit gemocktem nativen Kontext und gemockter GitHub-API. */
async function openApp(browser, { native, latestSha, allowInstall = true, installedVersion = true }) {
  // Service Worker blockieren: Playwright-Routen greifen nicht bei Fetches,
  // die über einen aktiven Service Worker laufen – die Mocks würden umgangen.
  const page = await browser.newPage({
    viewport: { width: 420, height: 900 },
    serviceWorkers: "block",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  if (native) {
    await page.addInitScript(({ allow }) => {
      window.__calls = [];
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          ApkUpdater: {
            canInstall: async () => ({ allowed: allow }),
            openInstallSettings: async () => { window.__calls.push("openInstallSettings"); },
            downloadAndInstall: async (opts) => { window.__calls.push("download:" + opts.url); },
            addListener: () => {},
          },
        },
      };
    }, { allow: allowInstall });
  }

  await page.route("**/version.json*", (route) => {
    if (!installedVersion) return route.fulfill({ status: 404, body: "not found" });
    route.fulfill({ json: { sha: INSTALLED_SHA, builtAt: "2026-07-01T12:00:00Z" } });
  });
  await page.route("https://api.github.com/**", (route) => {
    route.fulfill({ json: releaseJson(latestSha) });
  });

  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle" });
  await page.click("#btn-settings");
  return { page, errors };
}

const server = await startServer();
const browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE || undefined });

try {
  // 1) Im Browser/PWA (kein Capacitor): Update-Bereich bleibt verborgen.
  {
    const { page } = await openApp(browser, { native: false, latestSha: NEWER_SHA });
    check("Web: Update-Bereich verborgen", await page.locator("#update-section").isHidden(), true);
    await page.close();
  }

  // 2) Native App, neuere Version verfügbar → Update angeboten, Download startet.
  {
    const { page, errors } = await openApp(browser, { native: true, latestSha: NEWER_SHA });
    check("Nativ: Update-Bereich sichtbar", await page.locator("#update-section").isVisible(), true);
    check("Nativ: installierter Build angezeigt",
      (await page.locator("#update-installed").textContent()).startsWith(INSTALLED_SHA.slice(0, 7)), true);

    await page.click("#btn-check-update");
    await page.waitForSelector("#btn-install-update:visible");
    check("Update verfügbar gemeldet",
      (await page.locator("#update-status").textContent()).includes("Update verfügbar"), true);

    await page.click("#btn-install-update");
    await page.waitForFunction(() => window.__calls.some((c) => c.startsWith("download:")));
    const calls = await page.evaluate(() => window.__calls);
    check("Download mit Release-URL gestartet", calls.includes("download:" + APK_URL), true);
    check("keine JS-Fehler", errors.length, 0);
    await page.close();
  }

  // 3) Native App, gleicher Commit → „aktuell", kein Install-Button.
  {
    const { page } = await openApp(browser, { native: true, latestSha: INSTALLED_SHA });
    await page.click("#btn-check-update");
    await page.waitForFunction(() =>
      document.getElementById("update-status").textContent.includes("aktuell"));
    check("Gleicher Build → aktuell", true, true);
    check("Install-Button bleibt verborgen", await page.locator("#btn-install-update").isHidden(), true);
    await page.close();
  }

  // 4) Installations-Berechtigung fehlt → Einstellungen werden geöffnet.
  {
    const { page } = await openApp(browser, { native: true, latestSha: NEWER_SHA, allowInstall: false });
    await page.click("#btn-check-update");
    await page.waitForSelector("#btn-install-update:visible");
    await page.click("#btn-install-update");
    await page.waitForFunction(() => window.__calls.includes("openInstallSettings"));
    check("Berechtigungs-Einstellungen geöffnet", true, true);
    check("Hinweis auf Berechtigung",
      (await page.locator("#update-status").textContent()).includes("Unbekannte Apps"), true);
    await page.close();
  }

  // 5) Kein version.json (Dev-Build) → Prüfung bietet Download trotzdem an.
  {
    const { page } = await openApp(browser, { native: true, latestSha: NEWER_SHA, installedVersion: false });
    check("Dev-Build: Version unbekannt", await page.locator("#update-installed").textContent(), "unbekannt");
    await page.click("#btn-check-update");
    await page.waitForSelector("#btn-install-update:visible");
    check("Dev-Build: Download wird angeboten", true, true);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(failures === 0 ? "\nAlle Update-Checks bestanden ✅" : `\n${failures} Check(s) fehlgeschlagen ❌`);
process.exit(failures === 0 ? 0 : 1);
