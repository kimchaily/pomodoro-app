/**
 * End-to-end UI checks for the Pomodoro app.
 *
 * Covers the recent additions:
 *   1. Resettable Pomodoro cycle counter (tap the dots)
 *   2. − / + stepper buttons on the task estimate field
 *   3. Tomato app icon assets are present and served
 *   4. Color themes (Farbschemata) incl. per-mode shades and persistence
 *   5. Font selection (Schriftart) incl. inheritance and persistence
 *   6. Responsive layout: two columns on desktop, stacked on mobile
 *   9. Task-field autofocus, space-to-start-timer, Tab to the estimate and
 *      the global keyboard shortcuts
 *  10. Insert-position picker for new tasks (arrows + Enter/Ctrl+Enter/Shift+Enter)
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

  /* --- 7. Task bearbeiten (Stift-Icon) --- */
  // Zweite Aufgabe anlegen, damit sich auch die Reihenfolge testen lässt.
  await page.fill("#task-input", "Zweite Aufgabe");
  await page.click(".add-btn");
  check("two tasks exist", await page.locator(".task-item").count(), 2);

  // Stift öffnet ein Eingabefeld; Enter übernimmt den neuen Titel.
  await page.locator(".task-item").first().locator(".task-edit").click();
  const editInput = page.locator(".task-item").first().locator(".task-edit-input");
  check("pencil opens edit field", await editInput.count(), 1);
  await editInput.fill("Testaufgabe bearbeitet");
  await editInput.press("Enter");
  check("title updates after edit",
    await page.locator(".task-item").first().locator(".task-title").textContent(),
    "Testaufgabe bearbeitet");

  /* --- 8. Drag & Drop: Reihenfolge --- */
  const handle = page.locator(".task-item").first().locator(".task-drag");
  const hb = await handle.boundingBox();
  const secondBox = await page.locator(".task-item").nth(1).boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  // Über die Mitte der zweiten Aufgabe hinaus nach unten ziehen.
  await page.mouse.move(hb.x + hb.width / 2, secondBox.y + secondBox.height / 2 + 4, { steps: 6 });
  await page.mouse.move(hb.x + hb.width / 2, secondBox.y + secondBox.height + 8, { steps: 4 });
  await page.mouse.up();
  // Mit der neuen Standard-Einfügeposition (über der aktiven Aufgabe) landet
  // "Zweite Aufgabe" beim Anlegen vor der aktiven "Testaufgabe" – der Zug
  // tauscht sie wieder dahinter, sodass vorn die unbearbeitete "Testaufgabe" steht.
  check("drag moves first task below second",
    await page.locator(".task-item").first().locator(".task-title").textContent(),
    "Testaufgabe");

  // Bearbeitung und Reihenfolge überstehen ein Neuladen.
  await page.reload({ waitUntil: "networkidle" });
  check("reorder persists after reload",
    await page.locator(".task-item").first().locator(".task-title").textContent(),
    "Testaufgabe");
  check("edited title persists after reload",
    await page.locator(".task-item").nth(1).locator(".task-title").textContent(),
    "Testaufgabe bearbeitet");

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

  /* --- 4. Farbschemata --- */
  // body animiert den Hintergrund (transition: background .3s) – auf den
  // Zielwert warten und den tatsächlichen Endwert zurückgeben.
  const settledBg = async (expected) => {
    await page.waitForFunction(
      (rgb) => getComputedStyle(document.body).backgroundColor === rgb,
      expected, { timeout: 2000 }
    ).catch(() => {});
    return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  };

  await page.click("#btn-settings");
  const colorSel = page.locator("#set-color-theme");
  check("default color theme is classic", await colorSel.inputValue(), "classic");
  check("light/dark select enabled for classic", await page.locator("#set-theme").isDisabled(), false);

  await colorSel.selectOption("honey");
  check("body carries honey theme", await page.evaluate(() => document.body.dataset.colorTheme), "honey");
  check("background turns gold (#d9a44e)", await settledBg("rgb(217, 164, 78)"), "rgb(217, 164, 78)");
  check("light/dark select disabled for color theme", await page.locator("#set-theme").isDisabled(), true);
  await page.click('.close-dialog[data-close="settings-dialog"]');

  // Farbfläche folgt dem Modus (lange Pause = dunkleres Gold)
  await page.click('.mode-tab[data-mode="long"]');
  check("long break uses darker gold (#c98f38)", await settledBg("rgb(201, 143, 56)"), "rgb(201, 143, 56)");
  await page.click('.mode-tab[data-mode="focus"]');

  // Schema übersteht ein Neuladen
  await page.reload({ waitUntil: "networkidle" });
  check("theme persists after reload", await page.evaluate(() => document.body.dataset.colorTheme), "honey");
  check("theme select restored after reload", await page.locator("#set-color-theme").inputValue(), "honey");

  /* --- 5. Schriftart --- */
  await page.click("#btn-settings");
  const fontSel = page.locator("#set-font");
  check("default font is system", await fontSel.inputValue(), "system");

  await fontSel.selectOption("mono");
  check("body carries mono font", await page.evaluate(() => document.body.dataset.font), "mono");
  check("computed font-family is monospace stack",
    (await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toLowerCase().includes("monospace"), true);
  // Buttons erben die Schrift (font-family: inherit)
  check("start button inherits mono font",
    (await page.evaluate(() => getComputedStyle(document.getElementById("btn-start")).fontFamily)).toLowerCase().includes("monospace"), true);
  await page.click('.close-dialog[data-close="settings-dialog"]');

  // Auswahl übersteht ein Neuladen
  await page.reload({ waitUntil: "networkidle" });
  check("font persists after reload", await page.evaluate(() => document.body.dataset.font), "mono");
  check("font select restored after reload", await page.locator("#set-font").inputValue(), "mono");

  /* --- 9. Autofokus & Tastenkürzel --- */
  await page.reload({ waitUntil: "networkidle" });
  const activeId = () => page.evaluate(() => document.activeElement?.id || "");
  check("task input focused on launch", await activeId(), "task-input");

  // Leertaste als erstes Zeichen startet/pausiert den Timer, statt zu tippen.
  await page.locator("#task-input").press(" ");
  check("space in empty field does not type", await page.locator("#task-input").inputValue(), "");
  check("space in empty field starts timer", await page.textContent("#btn-start"), "Pause");
  await page.locator("#task-input").press(" ");
  check("space again pauses timer", await page.textContent("#btn-start"), "Start");

  // Sobald etwas im Feld steht, ist die Leertaste ein normales Leerzeichen.
  await page.locator("#task-input").type("Tief arbeiten");
  check("space types normally after text", await page.locator("#task-input").inputValue(), "Tief arbeiten");
  check("timer untouched while typing", await page.textContent("#btn-start"), "Start");

  // Tab springt auf das Zahlenfeld und markiert den Wert – direkt überschreibbar.
  await page.locator("#task-input").press("Tab");
  check("tab moves to estimate", await activeId(), "task-est");
  // Der Wert ist markiert: Tippen ersetzt ihn, statt ihn zu ergänzen.
  // (selectionStart/-End liefern bei input[type=number] null – deshalb der
  // funktionale Test statt einer Abfrage der Markierung.)
  await page.keyboard.type("12");
  check("typing overwrites the selected estimate", await page.locator("#task-est").inputValue(), "12");

  // Pfeiltasten arbeiten weiterhin wie gewohnt.
  await page.keyboard.press("ArrowUp");
  check("arrow up still increments", await page.locator("#task-est").inputValue(), "13");
  await page.keyboard.press("ArrowDown");
  check("arrow down still decrements", await page.locator("#task-est").inputValue(), "12");

  // Enter legt die Aufgabe an; danach steht der Cursor wieder im Aufgabenfeld.
  // Standard-Einfügeposition ist über der aktiven Aufgabe → die neue Aufgabe
  // landet vorn in der Liste, nicht hinten.
  await page.keyboard.press("Enter");
  check("task added with typed estimate",
    (await page.locator(".task-count").first().textContent())?.replace(/\s*🍅$/, ""), "0/12");
  check("focus returns to task input after add", await activeId(), "task-input");
  check("task input cleared after add", await page.locator("#task-input").inputValue(), "");

  // Esc verlässt das Feld, danach greifen die globalen Kürzel wieder.
  await page.keyboard.press("Escape");
  check("escape blurs the task input", await activeId(), "");

  await page.keyboard.press("2");
  check("2 switches to short break", await page.evaluate(() => document.body.dataset.mode), "short");
  await page.keyboard.press("1");
  check("1 switches back to focus", await page.evaluate(() => document.body.dataset.mode), "focus");

  await page.keyboard.press("n");
  check("N focuses the task input", await activeId(), "task-input");
  check("N does not type into the field", await page.locator("#task-input").inputValue(), "");
  await page.keyboard.press("Escape");

  await page.keyboard.press("?");
  check("? opens the shortcut overview", await page.locator("#shortcuts-dialog").evaluate((d) => d.open), true);
  await page.keyboard.press("Escape");
  check("escape closes the shortcut overview", await page.locator("#shortcuts-dialog").evaluate((d) => d.open), false);

  await page.keyboard.press("e");
  check("E opens settings", await page.locator("#settings-dialog").evaluate((d) => d.open), true);
  await page.click('.close-dialog[data-close="settings-dialog"]');

  // Direkt von der Hauptseite erreichbar, nicht mehr nur über die Einstellungen.
  await page.click("#btn-shortcuts");
  check("topbar button opens shortcut overview", await page.locator("#shortcuts-dialog").evaluate((d) => d.open), true);
  await page.click('.close-dialog[data-close="shortcuts-dialog"]');

  await page.keyboard.press("s");
  check("S opens statistics", await page.locator("#stats-dialog").evaluate((d) => d.open), true);
  await page.click('.close-dialog[data-close="stats-dialog"]');

  await page.click('.mode-tab[data-mode="focus"]');
  const cycleDone = () => page.locator("#cycle-dots span.done").count();
  const before = await cycleDone();
  await page.keyboard.press("ArrowRight");
  check("ArrowRight skips the session", await cycleDone(), before + 1);

  /* --- 10. Einfügeposition für neue Aufgaben --- */
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const titles = () => page.locator("#task-list .task-item .task-title").allTextContents();
  const checkTitles = async (name, expected) => check(name, (await titles()).join(" | "), expected.join(" | "));
  // Liefert, welche Aufgabe vor/nach der Trennlinie steht (null = Rand der Liste).
  const indicatorNeighbors = () => page.evaluate(() => {
    const list = document.getElementById("task-list");
    const children = [...list.children];
    const idx = children.findIndex((el) => el.classList.contains("task-insert-indicator"));
    if (idx === -1) return { present: false, before: null, after: null };
    const prevItem = children.slice(0, idx).reverse().find((el) => el.classList.contains("task-item"));
    const nextItem = children.slice(idx + 1).find((el) => el.classList.contains("task-item"));
    return {
      present: true,
      before: prevItem ? prevItem.querySelector(".task-title")?.textContent : null,
      after: nextItem ? nextItem.querySelector(".task-title")?.textContent : null,
    };
  });

  // Pfeiltasten im leeren Feld: keine Trennlinie, kein Effekt.
  await page.keyboard.press("ArrowDown");
  check("no indicator while field is empty", await page.locator(".task-insert-indicator").count(), 0);

  // Erste Aufgabe: Enter ohne Modifier (Liste ist leer → landet ohnehin ganz unten).
  await page.locator("#task-input").type("Alpha");
  await page.keyboard.press("Enter");
  await checkTitles("first task added", ["Alpha"]);

  // Zweite Aufgabe bewusst ganz unten einfügen (Strg+Enter).
  await page.locator("#task-input").type("Beta");
  await page.keyboard.press("Control+Enter");
  await checkTitles("ctrl+enter appends at the bottom", ["Alpha", "Beta"]);

  // Dritte Aufgabe bewusst ganz oben einfügen (Umschalt+Enter).
  await page.locator("#task-input").type("Gamma");
  await page.keyboard.press("Shift+Enter");
  await checkTitles("shift+enter inserts at the top", ["Gamma", "Alpha", "Beta"]);

  // Alpha ist weiterhin die aktive Aufgabe → Standard ist jetzt DARÜBER (neuer Default).
  await page.locator("#task-input").type("Delta");
  let n = await indicatorNeighbors();
  check("indicator present once text is typed", n.present, true);
  check("default position sits right above the active task (before)", n.before, "Gamma");
  check("default position sits right above the active task (after)", n.after, "Alpha");

  // Rauf: ganz oben, vor Gamma.
  await page.keyboard.press("ArrowUp");
  n = await indicatorNeighbors();
  check("arrow up reaches the very top (before)", n.before, null);
  check("arrow up reaches the very top (after)", n.after, "Gamma");

  // Am oberen Rand: weiteres Rauf bleibt dort (geklemmt).
  await page.keyboard.press("ArrowUp");
  n = await indicatorNeighbors();
  check("arrow up clamps at the top", n.before, null);

  // Viermal runter: einmal zu viel, bleibt unten geklemmt (ganz unten, nach Beta).
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  n = await indicatorNeighbors();
  check("arrow down clamps at the bottom", n.after, null);
  check("arrow down clamps at the bottom (before)", n.before, "Beta");

  // Einmal rauf: zwischen Alpha und Beta – bewusst UNTER der aktiven Aufgabe,
  // zum Beweis, dass sich die Markierung frei vom Standard wegbewegen lässt.
  await page.keyboard.press("ArrowUp");
  n = await indicatorNeighbors();
  check("back to a manually chosen slot before Enter (before)", n.before, "Alpha");
  check("back to a manually chosen slot before Enter (after)", n.after, "Beta");
  await page.keyboard.press("Enter");
  await checkTitles("enter inserts at the marked position", ["Gamma", "Alpha", "Delta", "Beta"]);
  check("indicator hidden again after insert", await page.locator(".task-insert-indicator").count(), 0);

  // Frischer Standard nach dem Einfügen: wieder direkt über Alpha (jetzt an Index 1).
  await page.locator("#task-input").type("Epsilon");
  n = await indicatorNeighbors();
  check("default resets above the active task after insert (before)", n.before, "Gamma");
  check("default resets above the active task after insert (after)", n.after, "Alpha");
  // Strg+Enter überstimmt die markierte Position und hängt trotzdem ganz unten an.
  await page.keyboard.press("Control+Enter");
  await checkTitles("ctrl+enter still overrides the marked position", ["Gamma", "Alpha", "Delta", "Beta", "Epsilon"]);

  // Umschalt+Enter überstimmt die markierte Position ebenso und setzt ganz oben.
  await page.locator("#task-input").type("Zeta");
  await page.keyboard.press("Shift+Enter");
  check("shift+enter still overrides the marked position", (await titles())[0], "Zeta");

  // Der "+"-Button folgt derselben markierten Position wie Enter.
  await page.locator("#task-input").type("Eta");
  n = await indicatorNeighbors();
  await page.click(".add-btn");
  await checkTitles("the + button inserts at the same marked position", [
    "Zeta", "Gamma", "Eta", "Alpha", "Delta", "Beta", "Epsilon",
  ]);

  /* --- 11. Einstellung: Einfügeposition über/unter der aktiven Aufgabe --- */
  await page.click("#btn-settings");
  check("new default is checked (above active)", await page.locator("#set-insert-above").isChecked(), true);
  await page.locator("#set-insert-above").uncheck();
  await page.click('.close-dialog[data-close="settings-dialog"]');

  // Alpha ist unverändert aktiv (jetzt an Index 3) – mit der Einstellung aus
  // greift wieder die alte Standardposition: direkt DARUNTER.
  await page.locator("#task-input").type("Theta");
  n = await indicatorNeighbors();
  check("default follows the setting back to below the active task (before)", n.before, "Alpha");
  check("default follows the setting back to below the active task (after)", n.after, "Delta");
  await page.keyboard.press("Enter");
  await checkTitles("task lands below the active task with the setting off", [
    "Zeta", "Gamma", "Eta", "Alpha", "Theta", "Delta", "Beta", "Epsilon",
  ]);

  // Die Einstellung übersteht ein Neuladen.
  await page.reload({ waitUntil: "networkidle" });
  await page.click("#btn-settings");
  check("setting persists after reload", await page.locator("#set-insert-above").isChecked(), false);
  await page.click('.close-dialog[data-close="settings-dialog"]');

  /* --- 3. Tomato icon assets served --- */
  for (const asset of ["icon.svg", "icon-192.png", "icon-512.png"]) {
    const status = (await page.request.get(`http://localhost:${PORT}/${asset}`)).status();
    check(`${asset} is served`, status, 200);
  }

  /* --- 6. Responsive layout --- */
  await page.setViewportSize({ width: 1000, height: 860 });
  await page.waitForTimeout(150);
  {
    const t = await page.locator(".timer-card").boundingBox();
    const k = await page.locator(".tasks-card").boundingBox();
    check("desktop: tasks card sits beside timer", k.x > t.x + t.width / 2, true);
  }
  await page.setViewportSize({ width: 400, height: 860 });
  await page.waitForTimeout(150);
  {
    const t = await page.locator(".timer-card").boundingBox();
    const k = await page.locator(".tasks-card").boundingBox();
    check("mobile: tasks card stacks below timer", k.y > t.y + 50, true);
  }

  check("no console/page errors", consoleErrors.length, 0);
  if (consoleErrors.length) console.log(consoleErrors);
} finally {
  await browser.close();
  server.close();
}

console.log(failures === 0 ? "\nAll checks passed ✅" : `\n${failures} check(s) failed ❌`);
process.exit(failures === 0 ? 0 : 1);
