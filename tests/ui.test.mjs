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
 *  11-12. Insert-above/below setting; the line follows re-selection
 *  13. Content-width toggle, draggable column splitter, themed icons
 *  14. Keyboard list navigation (↑/↓ select, X done, Enter/F2 edit)
 *  15. Editing a task's estimate
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

  /* --- 12. Trennlinie wandert beim Umselektieren mit --- */
  // Einstellung steht noch auf "darunter"; Alpha ist aktiv.
  const taskRow = (title) => page.locator(".task-item").filter({
    has: page.locator(".task-title", { hasText: new RegExp(`^${title}$`) }),
  });
  await page.locator("#task-input").type("Iota");
  n = await indicatorNeighbors();
  check("line starts below the active task (before)", n.before, "Alpha");

  await taskRow("Beta").locator(".task-title").click();
  n = await indicatorNeighbors();
  check("line follows when another task is selected (before)", n.before, "Beta");
  check("line follows when another task is selected (after)", n.after, "Epsilon");
  check("focus returns to the task input after reselecting", await activeId(), "task-input");
  check("typed text survives reselecting", await page.locator("#task-input").inputValue(), "Iota");

  // Manuell verschoben, dann erneut umselektiert: die Auswahl gewinnt wieder.
  await page.keyboard.press("ArrowUp");
  n = await indicatorNeighbors();
  check("arrow still moves the line manually", n.after, "Beta");
  await taskRow("Gamma").locator(".task-title").click();
  n = await indicatorNeighbors();
  check("reselecting after a manual move snaps to the new selection (before)", n.before, "Gamma");
  check("reselecting after a manual move snaps to the new selection (after)", n.after, "Eta");
  await page.keyboard.press("Enter");
  await checkTitles("enter inserts next to the newly selected task", [
    "Zeta", "Gamma", "Iota", "Eta", "Alpha", "Theta", "Delta", "Beta", "Epsilon",
  ]);

  /* --- 13. Inhaltsbreite & ziehbarer Spaltentrenner (Desktop) --- */
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(150);
  const widthOf = (sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().width);
  const bodyWidth = () => page.evaluate(() => document.body.dataset.width);

  check("width button visible on desktop", await page.locator("#btn-width").isVisible(), true);
  check("split handle visible on desktop", await page.locator("#split-handle").isVisible(), true);

  const normalW = await widthOf("main");
  check("default width is normal", await bodyWidth(), "normal");
  await page.click("#btn-width");
  const wideW = await widthOf("main");
  check("width button → wide", await bodyWidth(), "wide");
  check("wide is wider than normal", wideW > normalW + 200, true);
  await page.click("#btn-width");
  check("width button → full", await bodyWidth(), "full");
  check("full spans the whole viewport", Math.round(await widthOf("main")), 1600);

  await page.reload({ waitUntil: "networkidle" });
  check("width persists after reload", await bodyWidth(), "full");
  await page.click("#btn-width");
  check("width button cycles back to normal", await bodyWidth(), "normal");

  await page.keyboard.press("Escape"); // Aufgabenfeld verlassen, damit W global greift
  await page.keyboard.press("w");
  check("W cycles the width", await bodyWidth(), "wide");
  await page.keyboard.press("w");
  await page.keyboard.press("w");
  check("W wraps around to normal", await bodyWidth(), "normal");

  // Ausgangslage: beide Spalten gleich breit.
  const timerW0 = await widthOf(".timer-card");
  const tasksW0 = await widthOf(".tasks-card");
  check("columns start equal", Math.abs(timerW0 - tasksW0) < 2, true);

  // Trenner 150px nach links ziehen.
  const hbox = await page.locator("#split-handle").boundingBox();
  const hx = hbox.x + hbox.width / 2, hy = hbox.y + 60;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(hx - 150, hy, { steps: 8 });
  await page.mouse.up();
  const timerW1 = await widthOf(".timer-card");
  const tasksW1 = await widthOf(".tasks-card");
  check("dragging left narrows the timer column by ~150px", Math.abs(timerW0 - 150 - timerW1) < 3, true);
  check("dragging left widens the task column by ~150px", Math.abs(tasksW0 + 150 - tasksW1) < 3, true);

  await page.reload({ waitUntil: "networkidle" });
  check("split persists after reload", Math.abs((await widthOf(".timer-card")) - timerW1) < 2, true);

  // Ganz nach links: auf das Minimum geklemmt, Spalte bleibt benutzbar.
  const hbox2 = await page.locator("#split-handle").boundingBox();
  await page.mouse.move(hbox2.x + hbox2.width / 2, hbox2.y + 60);
  await page.mouse.down();
  await page.mouse.move(5, hbox2.y + 60, { steps: 8 });
  await page.mouse.up();
  check("split clamps to a sensible minimum", (await widthOf(".timer-card")) >= 259, true);
  check("split ratio clamped to 25%",
    await page.evaluate(() => JSON.parse(localStorage.getItem("pomo.settings")).splitRatio), 0.25);

  // Tastatur auf dem Trenner: → verschiebt, ohne "Überspringen" auszulösen.
  await page.locator("#split-handle").focus();
  await page.keyboard.press("ArrowRight");
  check("arrow right on the handle moves the split",
    await page.evaluate(() => JSON.parse(localStorage.getItem("pomo.settings")).splitRatio), 0.27);
  check("arrow right on the handle does not skip the session",
    await page.evaluate(() => document.body.dataset.mode), "focus");

  // Doppelklick setzt auf 50/50 zurück.
  await page.locator("#split-handle").dblclick({ position: { x: 20, y: 60 } });
  check("double-click resets to 50/50",
    Math.abs((await widthOf(".timer-card")) - (await widthOf(".tasks-card"))) < 2, true);

  // Symbole folgen dem Theme: standardmäßig in der Akzentfarbe (wechselt mit
  // dem Modus), per Einstellung einfarbig in der Textfarbe.
  const iconColor = (id) => page.locator(`#${id} svg`).evaluate((el) => getComputedStyle(el).color);
  check("all topbar icons are SVG", await page.locator(".topbar-actions .icon-btn:not(:has(svg))").count(), 0);
  check("icons use the accent color by default", await iconColor("btn-settings"), "rgb(226, 85, 85)");
  check("…on every topbar icon", await iconColor("btn-stats"), "rgb(226, 85, 85)");
  await page.keyboard.press("2");
  check("colored icons follow the mode (short break = green)", await iconColor("btn-shortcuts"), "rgb(61, 153, 112)");
  await page.keyboard.press("1");

  await page.click("#btn-settings");
  check("colored icons setting is on by default", await page.locator("#set-icon-color").isChecked(), true);
  await page.locator("#set-icon-color").uncheck();
  await page.click('.close-dialog[data-close="settings-dialog"]');
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  check("monochrome settings icon is light in dark mode", await iconColor("btn-settings"), "rgb(236, 236, 236)");
  check("shortcuts icon is light in dark mode", await iconColor("btn-shortcuts"), "rgb(236, 236, 236)");
  check("width icon is light in dark mode", await iconColor("btn-width"), "rgb(236, 236, 236)");
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  check("shortcuts icon is dark in light mode", await iconColor("btn-shortcuts"), "rgb(43, 43, 43)");
  check("width icon is dark in light mode", await iconColor("btn-width"), "rgb(43, 43, 43)");
  await page.evaluate(() => { document.documentElement.dataset.theme = "auto"; });

  // Mobil: kein Breitenschalter, kein Trenner.
  await page.setViewportSize({ width: 420, height: 900 });
  await page.waitForTimeout(150);
  check("width button hidden on mobile", await page.locator("#btn-width").isVisible(), false);
  check("split handle hidden on mobile", await page.locator("#split-handle").isVisible(), false);

  /* --- 14. Aufgabenliste per Tastatur: ↑/↓ auswählen, X erledigt, Enter/F2 bearbeiten --- */
  const activeTitle = () => page.evaluate(() =>
    document.querySelector("#task-list .task-item.active .task-title")?.textContent ?? null);
  const isDone = (title) => taskRow(title).evaluate((el) => el.classList.contains("done"));
  await page.evaluate(() => document.activeElement?.blur());

  check("start: Gamma is selected", await activeTitle(), "Gamma");
  await page.keyboard.press("ArrowDown");
  check("↓ selects the task below", await activeTitle(), "Iota");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  check("↑ selects the task above", await activeTitle(), "Zeta");
  await page.keyboard.press("ArrowUp");
  check("↑ stops at the top", await activeTitle(), "Zeta");

  await page.keyboard.press("x");
  check("X marks the selected task done", await isDone("Zeta"), true);
  check("selection stays on the task after X", await activeTitle(), "Zeta");
  check("no current task shown while a done task is selected",
    await page.locator("#active-task-display").isHidden(), true);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  check("done tasks are not skipped", await activeTitle(), "Zeta");
  await page.keyboard.press("x");
  check("X reopens the task", await isDone("Zeta"), false);
  check("current task shown again", await page.locator("#active-task-name").textContent(), "Zeta");

  // Nach einem Klick auf eine Checkbox greifen die Pfeile weiterhin.
  await taskRow("Beta").locator(".task-check").click();
  check("checkbox click marks Beta done", await isDone("Beta"), true);
  await page.keyboard.press("ArrowDown");
  check("↓ works after clicking a checkbox", await activeTitle(), "Gamma");

  await page.keyboard.press("Enter");
  check("Enter opens the selected task for editing",
    await page.locator(".task-item.active .task-edit-input").count(), 1);
  check("title field gets the focus",
    await page.evaluate(() => document.activeElement?.classList.contains("task-edit-input")), true);
  await page.keyboard.press("Escape");
  check("Esc leaves edit mode", await page.locator(".task-edit-input").count(), 0);
  await page.keyboard.press("ArrowDown");
  check("arrows work right after editing", await activeTitle(), "Iota");
  await page.keyboard.press("F2");
  check("F2 opens editing too", await page.locator(".task-item.active .task-edit-input").count(), 1);
  await page.keyboard.press("Escape");

  // Enter auf einem fokussierten Button löst weiterhin den Button aus.
  await page.locator("#btn-start").focus();
  await page.keyboard.press("Enter");
  check("Enter on a focused button keeps its own action", await page.textContent("#btn-start"), "Pause");
  check("…and does not open editing", await page.locator(".task-edit-input").count(), 0);
  await page.keyboard.press("Enter");
  check("Enter on the button pauses again", await page.textContent("#btn-start"), "Start");

  // Text im Feld stehen lassen und Feld verlassen: die Linie folgt der Pfeil-Auswahl.
  await page.locator("#task-input").fill("Kappa");
  await page.keyboard.press("Escape");
  n = await indicatorNeighbors();
  check("line sits next to the selection (Iota)", n.before, "Iota");
  await page.keyboard.press("ArrowUp");
  n = await indicatorNeighbors();
  check("line follows the arrow selection", n.before, "Gamma");
  await page.locator("#task-input").fill("");
  await page.keyboard.press("Escape");

  /* --- 15. Schätzung beim Bearbeiten ändern --- */
  const countOf = async (title) => (await taskRow(title).locator(".task-count").textContent()).replace(/\s*🍅$/, "");
  const editRow = page.locator(".task-item").filter({ has: page.locator(".task-editor") });
  const editEst = editRow.locator(".task-edit-est");
  const focusedClass = () => page.evaluate(() => document.activeElement?.className ?? "");

  await taskRow("Alpha").locator(".task-edit").click();
  check("edit mode shows the estimate", await editEst.inputValue(), "1");
  await page.keyboard.press("Tab");
  check("Tab jumps from the title to the estimate", await focusedClass(), "task-edit-est");
  check("still in edit mode after Tab", await page.locator(".task-editor").count(), 1);
  await page.keyboard.type("4");
  check("typing overwrites the selected estimate", await editEst.inputValue(), "4");
  await page.keyboard.press("ArrowUp");
  check("↑ increments the estimate", await editEst.inputValue(), "5");
  await page.keyboard.press("Enter");
  check("Enter saves the new estimate", await countOf("Alpha"), "0/5");

  await taskRow("Alpha").locator(".task-edit").click();
  await page.keyboard.press("Tab");
  await page.keyboard.type("9");
  await editRow.locator(".step-btn").last().click();
  check("+ button increments while editing", await editEst.inputValue(), "10");
  check("+ button keeps edit mode open", await page.locator(".task-editor").count(), 1);
  await page.keyboard.press("Escape");
  check("Esc discards the estimate change", await countOf("Alpha"), "0/5");

  await taskRow("Alpha").locator(".task-edit").click();
  await page.keyboard.press("Tab");
  await page.keyboard.type("3");
  await page.click(".tasks-card h2");
  check("clicking outside saves", await countOf("Alpha"), "0/3");

  await taskRow("Alpha").locator(".task-edit").click();
  await page.keyboard.press("Tab");
  await page.keyboard.type("50");
  await page.keyboard.press("Shift+Tab");
  check("Shift+Tab goes back to the title", await focusedClass(), "task-edit-input");
  await editRow.locator(".task-edit-input").fill("Alpha 2");
  await page.keyboard.press("Enter");
  check("title and estimate saved together, estimate clamped to 20", await countOf("Alpha 2"), "0/20");

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
