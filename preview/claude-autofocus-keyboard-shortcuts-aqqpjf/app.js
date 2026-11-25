"use strict";

/* ============================== Persistenz ============================== */

const store = {
  load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
    } catch { return { ...fallback }; }
  },
  loadRaw(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* voll/privat */ }
  },
};

const DEFAULT_SETTINGS = {
  focus: 25, short: 5, long: 15, longEvery: 4,
  autoStartBreaks: true, autoStartFocus: false,
  sound: "chime", volume: 70, tick: false,
  notify: true, vibrate: true,
  wakeLock: false, alwaysOn: false, theme: "auto", colorTheme: "classic",
  font: "system",
  insertAboveActive: true,
  layoutWidth: "normal", splitRatio: 0.5,
  iconColor: true,
};

let settings = store.load("pomo.settings", DEFAULT_SETTINGS);
let tasks = store.loadRaw("pomo.tasks", []);
let stats = store.load("pomo.stats", { days: {}, totalMinutes: 0 });

/* ============================== Timer-Zustand ============================== */

const MODE_LABEL = { focus: "Fokus", short: "Kurze Pause", long: "Lange Pause" };

const timer = {
  mode: "focus",       // focus | short | long
  running: false,
  endAt: null,         // Zeitstempel (ms), wenn laufend
  remainingMs: DEFAULT_SETTINGS.focus * 60000,
  cycle: 0,            // abgeschlossene Fokus-Einheiten im aktuellen Zyklus
};

function modeDurationMs(mode) {
  return settings[mode === "focus" ? "focus" : mode === "short" ? "short" : "long"] * 60000;
}

/* Pro Modus gemerkter Lauf-/Restzustand. So setzt ein Tab-Wechsel den Timer
   nicht zurück – jeder Modus behält seinen Stand, bis manuell zurückgesetzt wird. */
const modeState = {
  focus: { running: false, endAt: null, remainingMs: modeDurationMs("focus") },
  short: { running: false, endAt: null, remainingMs: modeDurationMs("short") },
  long: { running: false, endAt: null, remainingMs: modeDurationMs("long") },
};

function snapshotCurrentMode() {
  modeState[timer.mode] = {
    running: timer.running,
    endAt: timer.endAt,
    remainingMs: timer.remainingMs,
  };
}

function saveTimer() {
  snapshotCurrentMode();
  store.save("pomo.timer", { mode: timer.mode, cycle: timer.cycle, modeState });
}

// Lädt den gemerkten Zustand eines Modus in den aktiven Timer (ohne Reset).
function activateMode(mode) {
  timer.mode = mode;
  document.body.dataset.mode = mode;
  clearInterval(intervalId);
  const st = modeState[mode] || { running: false, endAt: null, remainingMs: modeDurationMs(mode) };
  if (st.running && st.endAt) {
    const left = st.endAt - Date.now();
    if (left > 0) {
      timer.running = true;
      timer.endAt = st.endAt;
      timer.remainingMs = left;
      startInterval();
      updateWakeLock();
      scheduleNativeAlarm();
      return;
    }
    // Während ein anderer Tab angezeigt wurde, ist die Einheit abgelaufen.
    timer.running = false;
    timer.endAt = null;
    timer.remainingMs = 0;
    completeSession({ silent: true });
    return;
  }
  timer.running = false;
  timer.endAt = null;
  timer.remainingMs = st.remainingMs ?? modeDurationMs(mode);
  updateWakeLock();
}

function restoreTimer() {
  const saved = store.loadRaw("pomo.timer", null);
  if (!saved) return;
  timer.cycle = saved.cycle || 0;
  if (saved.modeState) {
    for (const m of Object.keys(modeState)) {
      if (saved.modeState[m]) modeState[m] = saved.modeState[m];
    }
    activateMode(saved.mode || "focus");
    return;
  }
  // Alt-Format (vor der Pro-Modus-Speicherung).
  timer.mode = saved.mode || "focus";
  if (saved.running && saved.endAt) {
    const left = saved.endAt - Date.now();
    if (left > 0) {
      timer.running = true;
      timer.endAt = saved.endAt;
      timer.remainingMs = left;
      startInterval();
    } else {
      // Die Einheit ist abgelaufen, während die App geschlossen war.
      completeSession({ silent: true });
    }
  } else {
    timer.remainingMs = Math.min(saved.remainingMs ?? modeDurationMs(timer.mode), modeDurationMs(timer.mode));
  }
}

/* ============================== Timer-Steuerung ============================== */

let intervalId = null;
let lastTickSecond = null;

function startInterval() {
  clearInterval(intervalId);
  intervalId = setInterval(onInterval, 250);
}

function onInterval() {
  if (!timer.running) return;
  timer.remainingMs = Math.max(0, timer.endAt - Date.now());

  const sec = Math.ceil(timer.remainingMs / 1000);
  if (sec !== lastTickSecond) {
    lastTickSecond = sec;
    if (settings.tick && timer.mode === "focus" && timer.remainingMs > 0) playTick();
  }

  if (timer.remainingMs <= 0) completeSession({ silent: false });
  renderTimer();
}

// Sorgt dafür, dass immer nur ein Modus gleichzeitig läuft (ein nativer Alarm).
function pauseOtherRunningModes() {
  for (const m of Object.keys(modeState)) {
    if (m !== timer.mode && modeState[m].running) {
      const left = modeState[m].endAt ? Math.max(0, modeState[m].endAt - Date.now()) : modeState[m].remainingMs;
      modeState[m] = { running: false, endAt: null, remainingMs: left };
    }
  }
}

function startPause() {
  ensureAudio();
  if (timer.running) {
    timer.running = false;
    timer.remainingMs = Math.max(0, timer.endAt - Date.now());
    timer.endAt = null;
    clearInterval(intervalId);
    updateWakeLock();
    cancelNativeAlarm();
  } else {
    if (settings.notify) requestNotifyPermission();
    pauseOtherRunningModes();
    timer.running = true;
    timer.endAt = Date.now() + timer.remainingMs;
    startInterval();
    updateWakeLock();
    scheduleNativeAlarm();
  }
  saveTimer();
  renderTimer();
}

function resetTimer() {
  timer.running = false;
  timer.endAt = null;
  timer.remainingMs = modeDurationMs(timer.mode);
  clearInterval(intervalId);
  updateWakeLock();
  cancelNativeAlarm();
  saveTimer();
  renderTimer();
}

// Setzt den Pomodoro-Zähler des aktuellen Zyklus zurück (Fortschritt zur
// langen Pause). Der laufende Timer und die Statistik bleiben unberührt.
function resetCycle() {
  if (timer.cycle === 0) return;
  timer.cycle = 0;
  saveTimer();
  renderTimer();
}

function switchMode(mode, { autoStart = false, preserve = false } = {}) {
  // Tab-Wechsel: aktuellen Modus sichern und Zielmodus mit seinem Stand laden.
  if (preserve) {
    snapshotCurrentMode();
    activateMode(mode);
    saveTimer();
    renderTimer();
    return;
  }
  // Programmwechsel nach Ablauf/Überspringen: Zielmodus frisch starten.
  timer.mode = mode;
  timer.running = false;
  timer.endAt = null;
  timer.remainingMs = modeDurationMs(mode);
  modeState[mode] = { running: false, endAt: null, remainingMs: timer.remainingMs };
  clearInterval(intervalId);
  document.body.dataset.mode = mode;
  if (autoStart) {
    timer.running = true;
    timer.endAt = Date.now() + timer.remainingMs;
    startInterval();
    updateWakeLock();
    scheduleNativeAlarm();
  } else {
    updateWakeLock();
    cancelNativeAlarm();
  }
  saveTimer();
  renderTimer();
}

function nextModeAfter(mode) {
  if (mode === "focus") {
    return timer.cycle % settings.longEvery === 0 ? "long" : "short";
  }
  return "focus";
}

function completeSession({ silent }) {
  const finished = timer.mode;
  timer.running = false;
  timer.endAt = null;
  clearInterval(intervalId);

  if (finished === "focus") {
    timer.cycle += 1;
    recordPomodoro(settings.focus);
    creditActiveTask();
  }

  const next = nextModeAfter(finished);
  if (finished === "long") timer.cycle = 0; // neuer Zyklus nach der langen Pause

  if (!silent) {
    playAlarm();
    if (settings.vibrate && navigator.vibrate) navigator.vibrate([300, 120, 300]);
    const msg = finished === "focus"
      ? `Pomodoro geschafft! 🍅 Jetzt: ${MODE_LABEL[next]}.`
      : `Pause vorbei – weiter geht's mit Fokus!`;
    notify("Pomodoro", msg);
  }

  const autoStart = next === "focus" ? settings.autoStartFocus : settings.autoStartBreaks;
  switchMode(next, { autoStart: !silent && autoStart });
}

function skipSession() {
  if (timer.mode === "focus") {
    // Übersprungene Fokus-Einheit zählt für die Zyklusposition,
    // aber nicht für Statistik und Aufgaben.
    timer.cycle += 1;
    switchMode(timer.cycle % settings.longEvery === 0 ? "long" : "short");
  } else {
    if (timer.mode === "long") timer.cycle = 0;
    switchMode("focus");
  }
}

/* ============================== Statistik ============================== */

function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function recordPomodoro(minutes) {
  const key = dateKey();
  const day = stats.days[key] || { count: 0, minutes: 0 };
  day.count += 1;
  day.minutes += minutes;
  stats.days[key] = day;
  stats.totalMinutes += minutes;
  store.save("pomo.stats", stats);
}

function computeStats() {
  const today = stats.days[dateKey()]?.count || 0;
  let week = 0, total = 0;
  const now = new Date();
  // Wochenstart: Montag
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  for (const [key, day] of Object.entries(stats.days)) {
    total += day.count;
    if (new Date(key + "T00:00:00") >= monday) week += day.count;
  }
  // Serie: aufeinanderfolgende Tage mit ≥1 Pomodoro, heute zählt optional
  let streak = 0;
  const cursor = new Date(now);
  if (!stats.days[dateKey(cursor)]?.count) cursor.setDate(cursor.getDate() - 1);
  while (stats.days[dateKey(cursor)]?.count > 0) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { today, week, total, streak, minutes: stats.totalMinutes };
}

function renderStats() {
  const s = computeStats();
  document.getElementById("stat-today").textContent = s.today;
  document.getElementById("stat-week").textContent = s.week;
  document.getElementById("stat-total").textContent = s.total;
  document.getElementById("stat-streak").textContent = s.streak;
  document.getElementById("stat-minutes").textContent = s.minutes;

  const chart = document.getElementById("chart");
  chart.innerHTML = "";
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  const max = Math.max(1, ...days.map((d) => stats.days[dateKey(d)]?.count || 0));
  const names = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  for (const d of days) {
    const count = stats.days[dateKey(d)]?.count || 0;
    const col = document.createElement("div");
    col.className = "bar-col";
    const val = document.createElement("span");
    val.className = "bar-val";
    val.textContent = count || "";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = `${Math.round((count / max) * 80)}%`;
    if (!count) bar.style.opacity = "0.25";
    const label = document.createElement("span");
    label.className = "bar-day";
    label.textContent = names[d.getDay()];
    col.append(val, bar, label);
    chart.append(col);
  }
}

/* ============================== Aufgaben ============================== */

function saveTasks() { store.save("pomo.tasks", tasks); }

// id der Aufgabe, deren Titel gerade inline bearbeitet wird (oder null).
let editingTaskId = null;

// Einfügeposition für die nächste Aufgabe (Pfeiltasten im Aufgabenfeld
// verschieben sie); null = noch nicht festgelegt – Feld ist leer oder gerade
// erst befüllt worden, dann gilt beim nächsten Tastendruck der Standard.
let insertIndex = null;
// Solange die Linie nicht per Pfeiltaste verschoben wurde, klebt sie an der
// aktiven Aufgabe und wandert mit, wenn eine andere ausgewählt wird.
let insertFollowsActive = true;

// Standardposition: direkt neben der aktuell ausgewählten Aufgabe (ob darüber
// oder darunter, legt die Einstellung "insertAboveActive" fest), sonst ans Ende.
function computeDefaultInsertIndex() {
  // Folgt der Auswahl – auch wenn diese (per Tastatur) auf einer erledigten Aufgabe steht.
  const i = tasks.findIndex((t) => t.active);
  if (i === -1) return tasks.length;
  return settings.insertAboveActive ? i : i + 1;
}

function clampInsertIndex(i) {
  return Math.max(0, Math.min(tasks.length, i));
}

// Legt eine neue Aufgabe aus dem Aufgabenfeld an der gegebenen Position an.
function addTask(index) {
  const input = document.getElementById("task-input");
  const est = document.getElementById("task-est");
  const title = input.value.trim();
  if (!title) return;
  tasks.splice(clampInsertIndex(index), 0, {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title,
    est: Math.min(20, Math.max(1, Number(est.value) || 1)),
    done: false,
    donePomos: 0,
    active: tasks.every((t) => !t.active),
  });
  input.value = "";
  est.value = "1";
  insertIndex = null;
  saveTasks();
  renderTasks();
  focusTaskInput();   // direkt weiterschreiben können
}

// ↑/↓ außerhalb der Eingabefelder: Auswahl (Pomodoro-Fokus) eine Aufgabe weiter.
// Erledigte werden nicht übersprungen, damit X sie wieder öffnen kann; an den
// Listenenden bleibt die Auswahl stehen.
function moveActiveTask(delta) {
  if (!tasks.length) return;
  const cur = tasks.findIndex((t) => t.active);
  const next = cur === -1
    ? (delta > 0 ? 0 : tasks.length - 1)
    : Math.max(0, Math.min(tasks.length - 1, cur + delta));
  if (next === cur) return;
  tasks.forEach((t) => (t.active = false));
  tasks[next].active = true;
  if (insertIndex !== null) insertFollowsActive = true;
  saveTasks();
  renderTasks();
  // Pfeiltasten scrollen die Seite nicht mehr – die Auswahl sichtbar halten.
  document.querySelector("#task-list .task-item.active")?.scrollIntoView({ block: "nearest" });
}

// Enter / F2 außerhalb der Felder: ausgewählte Aufgabe bearbeiten.
function editActiveTask() {
  const task = tasks.find((t) => t.active);
  if (!task) return;
  editingTaskId = task.id;
  renderTasks();
}

// X: Erledigt-Status der ausgewählten Aufgabe umschalten; die Auswahl bleibt stehen.
function toggleActiveTaskDone() {
  const task = tasks.find((t) => t.active);
  if (!task) return;
  task.done = !task.done;
  if (editingTaskId === task.id) editingTaskId = null;
  saveTasks();
  renderTasks();
}

function creditActiveTask() {
  const task = tasks.find((t) => t.active && !t.done);
  if (task) {
    task.donePomos += 1;
    saveTasks();
    renderTasks();
  }
}

// Reihenfolge per Zeigergeste (Maus wie Touch). Der Griff fängt den Pointer ein,
// die Liste wird beim Ziehen live umsortiert und beim Loslassen persistiert.
function bindTaskDrag(handle, li) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const list = document.getElementById("task-list");
    const pointerId = e.pointerId;
    // Fängt den Pointer ein (verhindert Scrollen bei Touch). Wird der Eintrag
    // im DOM verschoben, kann der Browser die Capture lösen – deshalb hören die
    // Move-/Up-Handler am window mit, die die Events auch dann noch erreichen.
    try { handle.setPointerCapture(pointerId); } catch { /* nicht unterstützt */ }
    li.classList.add("dragging");
    document.body.classList.add("dragging-task");

    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return;
      // Nur echte Aufgaben zählen bei der Positionsbestimmung – die
      // Einfüge-Trennlinie (falls gerade sichtbar) ist kein Sortierziel.
      const others = [...list.querySelectorAll(":scope > .task-item")].filter((el) => el !== li);
      let before = null;
      for (const el of others) {
        const rect = el.getBoundingClientRect();
        if (ev.clientY < rect.top + rect.height / 2) { before = el; break; }
      }
      if (before) {
        if (before !== li.nextSibling) list.insertBefore(li, before);
      } else {
        const lastOther = others[others.length - 1];
        if (!lastOther || li !== lastOther.nextSibling) list.appendChild(li);
      }
    };

    const finish = (ev) => {
      if (ev && ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      try { handle.releasePointerCapture(pointerId); } catch { /* schon frei */ }
      li.classList.remove("dragging");
      document.body.classList.remove("dragging-task");
      // Neue Reihenfolge aus dem DOM in das tasks-Array übernehmen.
      const order = [...list.querySelectorAll(":scope > .task-item")].map((el) => el.dataset.id);
      tasks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      saveTasks();
      renderTasks();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  });
}

let renderingTasks = false;

function renderTasks() {
  // Schutz gegen Re-Entrancy: Wird beim Leeren der Liste ein Blur ausgelöst
  // (Bearbeiten aktiv), soll das kein zweites Rendern mittendrin anstoßen.
  if (renderingTasks) return;
  renderingTasks = true;
  try {
    const list = document.getElementById("task-list");
    list.innerHTML = "";
    let focusInput = null;

    if (insertIndex !== null && insertFollowsActive) insertIndex = computeDefaultInsertIndex();
    const showInsertMark = insertIndex !== null;
    const markAt = showInsertMark ? clampInsertIndex(insertIndex) : -1;
    const insertMark = () => {
      const mark = document.createElement("li");
      mark.className = "task-insert-indicator";
      mark.setAttribute("aria-hidden", "true");
      return mark;
    };

    tasks.forEach((task, i) => {
      if (showInsertMark && i === markAt) list.append(insertMark());

      const li = document.createElement("li");
      li.className = "task-item" + (task.active ? " active" : "") + (task.done ? " done" : "");
      li.dataset.id = task.id;

      const drag = document.createElement("button");
      drag.type = "button";
      drag.className = "task-drag";
      drag.textContent = "⠿";
      drag.title = "Zum Sortieren ziehen";
      drag.setAttribute("aria-label", "Aufgabe verschieben");
      drag.addEventListener("click", (e) => e.stopPropagation());
      bindTaskDrag(drag, li);

      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "task-check";
      check.checked = task.done;
      check.addEventListener("click", (e) => {
        e.stopPropagation();
        task.done = check.checked;
        if (task.done) task.active = false;
        if (editingTaskId === task.id) editingTaskId = null;
        saveTasks();
        renderTasks();
      });

      // Normal: Titel + Zähler. Im Bearbeiten-Modus: Titel- und Schätzungsfeld,
      // die sich wie beim Neu-Anlegen bedienen (Tab → Zahl markiert, ↑/↓, − / +).
      let titleEl, count;
      if (editingTaskId === task.id) {
        const editor = document.createElement("div");
        editor.className = "task-editor";
        editor.addEventListener("click", (e) => e.stopPropagation());

        const titleInput = document.createElement("input");
        titleInput.type = "text";
        titleInput.className = "task-edit-input";
        titleInput.maxLength = 120;
        titleInput.value = task.title;

        const stepper = document.createElement("div");
        stepper.className = "stepper";
        const estInput = document.createElement("input");
        estInput.type = "number";
        estInput.className = "task-edit-est";
        estInput.min = "1";
        estInput.max = "20";
        estInput.inputMode = "numeric";
        estInput.value = String(task.est);
        estInput.setAttribute("aria-label", "Geschätzte Pomodoros");
        const stepBtn = (label, aria, delta) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "step-btn";
          b.textContent = label;
          b.setAttribute("aria-label", aria);
          // Fokus im Feld lassen, sonst würde das Verlassen des Felds speichern.
          b.addEventListener("mousedown", (e) => e.preventDefault());
          b.addEventListener("click", () => {
            const v = Math.round(Number(estInput.value) || task.est);
            estInput.value = String(Math.min(20, Math.max(1, v + delta)));
          });
          return b;
        };
        stepper.append(stepBtn("−", "Weniger Pomodoros", -1), estInput, stepBtn("+", "Mehr Pomodoros", 1));
        editor.append(titleInput, stepper);

        const commit = () => {
          if (editingTaskId !== task.id) return;
          const v = titleInput.value.trim();
          if (v) task.title = v;
          const est = Math.round(Number(estInput.value));
          if (Number.isFinite(est) && est > 0) task.est = Math.min(20, Math.max(1, est));
          editingTaskId = null;
          saveTasks();
          renderTasks();
        };
        const cancel = () => { editingTaskId = null; renderTasks(); };
        const onKey = (e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        };
        titleInput.addEventListener("keydown", (e) => {
          if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); estInput.focus(); estInput.select(); return; }
          onKey(e);
        });
        estInput.addEventListener("keydown", (e) => {
          if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); titleInput.focus(); return; }
          onKey(e);
        });
        estInput.addEventListener("focus", () => estInput.select());
        // Gespeichert wird erst, wenn der Fokus den Bearbeiten-Bereich verlässt –
        // so schließt Tab vom Titel zur Zahl den Modus nicht vorzeitig.
        editor.addEventListener("focusout", (e) => {
          if (!editor.contains(e.relatedTarget)) commit();
        });

        titleEl = editor;
        focusInput = titleInput;
      } else {
        titleEl = document.createElement("span");
        titleEl.className = "task-title";
        titleEl.textContent = task.title;
        count = document.createElement("span");
        count.className = "task-count";
        count.textContent = `${task.donePomos}/${task.est} 🍅`;
      }

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "task-edit";
      edit.textContent = "✏️";
      edit.title = "Bearbeiten";
      edit.setAttribute("aria-label", "Aufgabe bearbeiten");
      edit.addEventListener("click", (e) => {
        e.stopPropagation();
        editingTaskId = editingTaskId === task.id ? null : task.id;
        renderTasks();
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "task-del";
      del.textContent = "🗑";
      del.title = "Löschen";
      del.setAttribute("aria-label", "Aufgabe löschen");
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        tasks = tasks.filter((t) => t.id !== task.id);
        if (editingTaskId === task.id) editingTaskId = null;
        saveTasks();
        renderTasks();
      });

      li.append(...[drag, check, titleEl, count, edit, del].filter(Boolean));
      li.addEventListener("click", () => {
        if (editingTaskId) return; // im Bearbeiten-Modus keine Auswahl umschalten
        if (task.done) return;
        const wasActive = task.active;
        tasks.forEach((t) => (t.active = false));
        task.active = !wasActive;
        saveTasks();
        // Mitten im Tippen umselektiert: Linie springt zur neuen Auswahl, und
        // der Cursor kehrt ins Feld zurück, damit Enter direkt dort einfügt.
        const composing = insertIndex !== null;
        if (composing) insertFollowsActive = true;
        renderTasks();
        if (composing) focusTaskInput();
      });
      list.append(li);
    });
    if (showInsertMark && markAt === tasks.length) list.append(insertMark());

    document.getElementById("task-empty").hidden = tasks.length > 0;
    document.getElementById("task-footer").hidden = !tasks.some((t) => t.done);

    const active = tasks.find((t) => t.active && !t.done);
    const display = document.getElementById("active-task-display");
    display.hidden = !active;
    if (active) document.getElementById("active-task-name").textContent = active.title;

    if (focusInput) { focusInput.focus(); focusInput.select(); }
  } finally {
    renderingTasks = false;
  }
}

/* ============================== Audio ============================== */

let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx?.state === "suspended") audioCtx.resume();
}

function vol() { return (settings.volume / 100) ** 2; }

function tone(freq, startDelay, duration, { type = "sine", gain = 1 } = {}) {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + startDelay;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol() * gain), t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

function playAlarm() {
  ensureAudio();
  if (!audioCtx || settings.sound === "none") return;
  switch (settings.sound) {
    case "chime":
      tone(880, 0, 0.6); tone(1108.7, 0.18, 0.6); tone(1318.5, 0.36, 0.9);
      break;
    case "bell":
      tone(660, 0, 1.4, { gain: 1 }); tone(1320, 0, 1.0, { gain: 0.4 }); tone(1980, 0, 0.6, { gain: 0.15 });
      tone(660, 0.8, 1.4, { gain: 1 }); tone(1320, 0.8, 1.0, { gain: 0.4 });
      break;
    case "digital":
      for (let i = 0; i < 4; i++) tone(1000, i * 0.22, 0.12, { type: "square", gain: 0.5 });
      break;
  }
}

function playTick() {
  if (!audioCtx) return;
  tone(2000, 0, 0.03, { type: "triangle", gain: 0.12 });
}

/* ============================== Nativer Alarm (Android-App) ==============================
   In der Capacitor-App wird das Ende der laufenden Einheit als exakte lokale
   Benachrichtigung beim System vorgemerkt (AlarmManager). So klingelt der Timer
   auch, wenn die App im Hintergrund, der Bildschirm aus oder die App geschlossen ist. */

const NATIVE_ALARM_ID = 42;
let nativePermissionAsked = false;

function nativeNotifications() {
  const cap = window.Capacitor;
  return cap?.isNativePlatform?.() ? cap.Plugins?.LocalNotifications : null;
}

async function ensureNativePermission(plugin) {
  try {
    const status = await plugin.checkPermissions();
    if (status.display !== "granted" && !nativePermissionAsked) {
      nativePermissionAsked = true;
      await plugin.requestPermissions();
    }
  } catch { /* Plugin nicht verfügbar */ }
}

async function scheduleNativeAlarm() {
  const plugin = nativeNotifications();
  if (!plugin || !timer.running || !timer.endAt) return;
  await ensureNativePermission(plugin);
  const finished = timer.mode;
  const next = finished === "focus"
    ? ((timer.cycle + 1) % settings.longEvery === 0 ? "long" : "short")
    : "focus";
  const body = finished === "focus"
    ? `Pomodoro geschafft! 🍅 Jetzt: ${MODE_LABEL[next]}.`
    : "Pause vorbei – weiter geht's mit Fokus!";
  try {
    await plugin.schedule({
      notifications: [{
        id: NATIVE_ALARM_ID,
        title: "Pomodoro",
        body,
        schedule: { at: new Date(timer.endAt), allowWhileIdle: true },
      }],
    });
  } catch { /* z. B. Berechtigung verweigert */ }
}

async function cancelNativeAlarm() {
  const plugin = nativeNotifications();
  if (!plugin) return;
  try { await plugin.cancel({ notifications: [{ id: NATIVE_ALARM_ID }] }); } catch { /* ignorieren */ }
}

/* ============================== In-App-Update (Android-App) ==============================
   Vergleicht den in die APK eingebackenen Build-Commit (version.json, vom CI
   erzeugt) mit dem Commit des "latest"-GitHub-Releases. Bei einer neueren
   Version lädt der native ApkUpdater die APK und öffnet den System-Installer. */

const UPDATE_RELEASE_API = "https://api.github.com/repos/kimchaily/pomodoro-app/releases/tags/latest";

function apkUpdater() {
  const cap = window.Capacitor;
  return cap?.isNativePlatform?.() ? cap.Plugins?.ApkUpdater : null;
}

let installedBuild = null;   // { sha, builtAt } oder null (z. B. lokaler Dev-Build)
let availableUpdate = null;  // { sha, url, name }

async function loadInstalledBuild() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchLatestRelease() {
  const res = await fetch(UPDATE_RELEASE_API, {
    headers: { Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub API antwortet mit ${res.status}`);
  const rel = await res.json();
  const apk = (rel.assets || []).find((a) => a.name === "pomodoro.apk");
  // Der Release-Body wird vom CI erzeugt und enthält den Commit-Link.
  const sha = /\/commit\/([0-9a-f]{40})/.exec(rel.body || "")?.[1] || null;
  return { sha, url: apk?.browser_download_url || null, name: rel.name || "" };
}

function fmtBuild(build) {
  if (!build?.sha) return "unbekannt";
  const short = build.sha.slice(0, 7);
  if (!build.builtAt) return short;
  const d = new Date(build.builtAt);
  return `${short} vom ${d.toLocaleDateString("de-DE")} ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}

function setUpdateStatus(text) {
  document.getElementById("update-status").textContent = text;
}

async function checkForUpdate() {
  const installBtn = document.getElementById("btn-install-update");
  installBtn.hidden = true;
  availableUpdate = null;
  setUpdateStatus("Prüfe …");
  try {
    const latest = await fetchLatestRelease();
    if (!latest.url) {
      setUpdateStatus("Kein APK-Release gefunden.");
      return;
    }
    if (latest.sha && installedBuild?.sha && latest.sha === installedBuild.sha) {
      setUpdateStatus("✓ App ist aktuell.");
      return;
    }
    availableUpdate = latest;
    setUpdateStatus(installedBuild?.sha
      ? `Update verfügbar: ${latest.name || latest.sha?.slice(0, 7) || "neuer Build"}`
      : "Installierte Version unbekannt – neuester Build kann geladen werden.");
    installBtn.hidden = false;
  } catch (e) {
    setUpdateStatus(`Prüfung fehlgeschlagen: ${e.message}`);
  }
}

async function installUpdate() {
  const updater = apkUpdater();
  if (!updater || !availableUpdate?.url) return;
  const installBtn = document.getElementById("btn-install-update");
  try {
    const { allowed } = await updater.canInstall();
    if (!allowed) {
      setUpdateStatus("Bitte „Unbekannte Apps installieren“ für Pomodoro erlauben und danach erneut tippen.");
      await updater.openInstallSettings();
      return;
    }
    installBtn.disabled = true;
    setUpdateStatus("Download läuft – der Installer öffnet sich gleich …");
    await updater.downloadAndInstall({ url: availableUpdate.url });
  } catch (e) {
    installBtn.disabled = false;
    setUpdateStatus(`Update fehlgeschlagen: ${e.message || e}`);
  }
}

async function initUpdateUI() {
  const updater = apkUpdater();
  if (!updater) return; // Im Browser/PWA aktualisiert der Service Worker die App.
  document.getElementById("update-section").hidden = false;

  installedBuild = await loadInstalledBuild();
  document.getElementById("update-installed").textContent = fmtBuild(installedBuild);

  document.getElementById("btn-check-update").addEventListener("click", checkForUpdate);
  document.getElementById("btn-install-update").addEventListener("click", installUpdate);

  updater.addListener?.("installStarted", () => {
    setUpdateStatus("Installer geöffnet – Installation dort bestätigen.");
    document.getElementById("btn-install-update").disabled = false;
  });
  updater.addListener?.("downloadFailed", (e) => {
    setUpdateStatus(`Download fehlgeschlagen: ${e?.message || "unbekannter Fehler"}`);
    document.getElementById("btn-install-update").disabled = false;
  });
}

/* ============================== Benachrichtigungen ============================== */

function requestNotifyPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

async function notify(title, body) {
  // In der Android-App übernimmt der vorgemerkte native Alarm die Benachrichtigung.
  if (nativeNotifications()) return;
  if (!settings.notify || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      reg.showNotification(title, { body, icon: "icon-192.png", badge: "icon-192.png", tag: "pomodoro" });
      return;
    }
  } catch { /* Fallback unten */ }
  try { new Notification(title, { body, icon: "icon-192.png" }); } catch { /* nicht unterstützt */ }
}

/* ============================== Wake Lock ============================== */

let wakeLockSentinel = null;

// "Display immer an" hält den Bildschirm dauerhaft wach, "Bildschirm wachhalten"
// nur, solange der Timer läuft.
function shouldKeepAwake() {
  return settings.alwaysOn || (settings.wakeLock && timer.running);
}

async function acquireWakeLock() {
  if (!("wakeLock" in navigator) || wakeLockSentinel) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
    wakeLockSentinel.addEventListener?.("release", () => { wakeLockSentinel = null; });
  } catch { /* abgelehnt */ }
}

function releaseWakeLock() {
  wakeLockSentinel?.release().catch(() => {});
  wakeLockSentinel = null;
}

function updateWakeLock() {
  if (shouldKeepAwake()) acquireWakeLock();
  else releaseWakeLock();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (timer.running) onInterval(); // sofort aufholen statt auf das Intervall zu warten
    // Das System gibt den Wake Lock beim Verstecken frei – hier neu anfordern.
    updateWakeLock();
  }
});

/* ============================== Rendering ============================== */

const RING_CIRCUMFERENCE = 2 * Math.PI * 138;
let lastRenderedMode = null;

function formatTime(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function renderTimer() {
  const text = formatTime(timer.remainingMs);
  document.getElementById("time-display").textContent = text;
  document.title = timer.running ? `${text} – ${MODE_LABEL[timer.mode]}` : "Pomodoro";

  const label = document.getElementById("session-label");
  label.textContent = timer.running
    ? (timer.mode === "focus" ? `Fokus – Runde ${ (timer.cycle % settings.longEvery) + 1 }` : MODE_LABEL[timer.mode])
    : `Bereit für ${MODE_LABEL[timer.mode]}`;

  const total = modeDurationMs(timer.mode);
  const progress = total > 0 ? timer.remainingMs / total : 0;
  document.getElementById("ring-progress").style.strokeDashoffset =
    String(RING_CIRCUMFERENCE * (1 - progress));

  document.getElementById("btn-start").textContent = timer.running ? "Pause" : "Start";

  document.querySelectorAll(".mode-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.mode === timer.mode);
  });
  document.body.dataset.mode = timer.mode;
  if (lastRenderedMode !== timer.mode) {
    lastRenderedMode = timer.mode;
    updateMetaThemeColor(); // Hintergrundfarbe hängt vom Modus ab
  }

  const dots = document.getElementById("cycle-dots");
  if (dots.childElementCount !== settings.longEvery) {
    dots.innerHTML = "";
    for (let i = 0; i < settings.longEvery; i++) dots.append(document.createElement("span"));
  }
  const doneInCycle = timer.cycle % settings.longEvery || (timer.cycle > 0 && timer.mode === "long" ? settings.longEvery : 0);
  [...dots.children].forEach((dot, i) => dot.classList.toggle("done", i < doneInCycle));
}

/* ============================== Einstellungen (UI) ============================== */

const settingBindings = [
  ["set-focus", "focus", "number"],
  ["set-short", "short", "number"],
  ["set-long", "long", "number"],
  ["set-long-every", "longEvery", "number"],
  ["set-auto-breaks", "autoStartBreaks", "checkbox"],
  ["set-auto-focus", "autoStartFocus", "checkbox"],
  ["set-insert-above", "insertAboveActive", "checkbox"],
  ["set-sound", "sound", "select"],
  ["set-volume", "volume", "number"],
  ["set-tick", "tick", "checkbox"],
  ["set-notify", "notify", "checkbox"],
  ["set-vibrate", "vibrate", "checkbox"],
  ["set-wakelock", "wakeLock", "checkbox"],
  ["set-always-on", "alwaysOn", "checkbox"],
  ["set-icon-color", "iconColor", "checkbox"],
  ["set-theme", "theme", "select"],
  ["set-color-theme", "colorTheme", "select"],
  ["set-font", "font", "select"],
];

function loadSettingsUI() {
  for (const [id, key, kind] of settingBindings) {
    const el = document.getElementById(id);
    if (kind === "checkbox") el.checked = settings[key];
    else el.value = settings[key];
  }
}

function bindSettings() {
  for (const [id, key, kind] of settingBindings) {
    const el = document.getElementById(id);
    el.addEventListener("change", () => {
      if (kind === "checkbox") settings[key] = el.checked;
      else if (kind === "number") {
        const min = Number(el.min), max = Number(el.max);
        let v = Number(el.value);
        if (!Number.isFinite(v)) v = settings[key];
        v = Math.min(max, Math.max(min, Math.round(v)));
        el.value = v;
        settings[key] = v;
      } else settings[key] = el.value;

      store.save("pomo.settings", settings);

      if (key === "theme" || key === "colorTheme" || key === "iconColor") applyTheme();
      if (key === "font") applyFont();
      if (key === "notify" && settings.notify) requestNotifyPermission();
      if (key === "wakeLock" || key === "alwaysOn") updateWakeLock();
      // Geänderte Dauer auf den passenden, nicht laufenden Modus übertragen.
      if (key === "focus" || key === "short" || key === "long") {
        if (key === timer.mode && !timer.running) {
          timer.remainingMs = modeDurationMs(timer.mode);
        } else if (key !== timer.mode && !modeState[key].running) {
          modeState[key] = { running: false, endAt: null, remainingMs: modeDurationMs(key) };
        }
        saveTimer();
      }
      renderTimer();
    });
  }

  document.getElementById("btn-test-sound").addEventListener("click", () => {
    ensureAudio();
    playAlarm();
  });
}

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  document.body.dataset.colorTheme = settings.colorTheme;
  document.body.dataset.icons = settings.iconColor ? "color" : "mono";
  // Hell/Dunkel greift nur im klassischen Design – bei Farbschemata deaktivieren.
  document.getElementById("set-theme").disabled = settings.colorTheme !== "classic";
  updateMetaThemeColor();
}

function applyFont() {
  document.body.dataset.font = settings.font;
}

/* Inhaltsbreite & geteilte Ansicht (nur im zweispaltigen Desktop-Layout sichtbar). */
const LAYOUT_WIDTHS = ["normal", "wide", "full"];
const WIDTH_LABEL = { normal: "Standard", wide: "Breit", full: "Volle Breite" };
// Keine Spalte schmaler als ein Viertel – zusätzlich sichert das CSS 260px Minimum.
const SPLIT_MIN = 0.25, SPLIT_MAX = 0.75;

function clampSplit(r) {
  const v = Number(r);
  return Number.isFinite(v) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v)) : 0.5;
}

function applyLayout() {
  const width = LAYOUT_WIDTHS.includes(settings.layoutWidth) ? settings.layoutWidth : "normal";
  document.body.dataset.width = width;
  const btn = document.getElementById("btn-width");
  btn.title = `Inhaltsbreite: ${WIDTH_LABEL[width]} (W)`;
  btn.setAttribute("aria-label", `Inhaltsbreite: ${WIDTH_LABEL[width]} – umschalten`);

  // Als fr-Werte mit Summe 100, damit die Spalten den Platz immer ganz füllen.
  const r = clampSplit(settings.splitRatio);
  const main = document.querySelector("main");
  main.style.setProperty("--split-left", `${(r * 100).toFixed(2)}fr`);
  main.style.setProperty("--split-right", `${((1 - r) * 100).toFixed(2)}fr`);
  document.getElementById("split-handle").setAttribute("aria-valuenow", String(Math.round(r * 100)));
}

function cycleLayoutWidth() {
  const i = LAYOUT_WIDTHS.indexOf(settings.layoutWidth);
  settings.layoutWidth = LAYOUT_WIDTHS[(i + 1) % LAYOUT_WIDTHS.length];
  store.save("pomo.settings", settings);
  applyLayout();
}

function setSplitRatio(r, { persist = true } = {}) {
  settings.splitRatio = clampSplit(r);
  if (persist) store.save("pomo.settings", settings);
  applyLayout();
}

// Mittellinie per Maus/Touch ziehen; fokussiert auch per ← / → verschiebbar.
function bindSplitHandle() {
  const handle = document.getElementById("split-handle");
  const main = document.querySelector("main");

  handle.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const pointerId = e.pointerId;
    try { handle.setPointerCapture(pointerId); } catch { /* nicht unterstützt */ }
    handle.classList.add("dragging");
    document.body.classList.add("resizing-split");

    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return;
      const rect = main.getBoundingClientRect();
      const cs = getComputedStyle(main);
      const contentLeft = rect.left + parseFloat(cs.paddingLeft);
      const contentWidth = rect.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const handleWidth = handle.getBoundingClientRect().width;
      const avail = contentWidth - handleWidth;
      if (avail <= 0) return;
      setSplitRatio((ev.clientX - contentLeft - handleWidth / 2) / avail, { persist: false });
    };
    const finish = (ev) => {
      if (ev && ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      try { handle.releasePointerCapture(pointerId); } catch { /* schon frei */ }
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing-split");
      store.save("pomo.settings", settings);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  });

  handle.addEventListener("dblclick", () => setSplitRatio(0.5));

  handle.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: -0.02, ArrowRight: 0.02 }[e.key];
    if (step === undefined) return;
    // Sonst würde der globale Kürzel-Handler → als "Überspringen" werten.
    e.preventDefault();
    e.stopPropagation();
    setSplitRatio(clampSplit(settings.splitRatio) + step);
  });
}

// Browser-/Statusleiste an die aktuelle Hintergrundfarbe angleichen.
function updateMetaThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.body).backgroundColor;
}

/* ============================== App-Verkabelung ============================== */

// Setzt den Cursor ins Aufgabenfeld ("Woran arbeitest du?").
function focusTaskInput({ select = false } = {}) {
  const input = document.getElementById("task-input");
  if (!input || document.querySelector("dialog[open]")) return;
  input.focus();
  if (select) input.select();
}

// Beim App-Start ins Aufgabenfeld springen – aber nur mit echter Tastatur.
// Auf Touch-Geräten würde sonst direkt die Bildschirmtastatur hochklappen und
// den Timer verdecken.
function focusTaskInputOnLaunch() {
  const hasKeyboard = !window.matchMedia || window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (hasKeyboard) focusTaskInput();
}

function openDialog(id) {
  const dlg = document.getElementById(id);
  if (!dlg || dlg.open) return;
  if (id === "stats-dialog") renderStats();
  dlg.showModal();
}

function bindUI() {
  document.getElementById("btn-start").addEventListener("click", startPause);
  document.getElementById("btn-reset").addEventListener("click", resetTimer);
  document.getElementById("btn-skip").addEventListener("click", skipSession);
  document.getElementById("cycle-dots").addEventListener("click", resetCycle);

  document.querySelectorAll(".mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.dataset.mode !== timer.mode) switchMode(tab.dataset.mode, { preserve: true });
    });
  });

  // Dialoge
  document.getElementById("btn-stats").addEventListener("click", () => openDialog("stats-dialog"));
  document.getElementById("btn-shortcuts").addEventListener("click", () => openDialog("shortcuts-dialog"));
  document.getElementById("btn-width").addEventListener("click", cycleLayoutWidth);
  bindSplitHandle();
  document.getElementById("btn-settings").addEventListener("click", () => openDialog("settings-dialog"));
  document.querySelectorAll(".close-dialog").forEach((btn) => {
    btn.addEventListener("click", () => document.getElementById(btn.dataset.close).close());
  });
  document.querySelectorAll("dialog").forEach((dlg) => {
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  });

  document.getElementById("btn-reset-stats").addEventListener("click", () => {
    if (confirm("Gesamte Statistik wirklich löschen?")) {
      stats = { days: {}, totalMinutes: 0 };
      store.save("pomo.stats", stats);
      renderStats();
    }
  });

  // Aufgaben – Schätzung per − / + oder direkter Eingabe anpassen
  const est = document.getElementById("task-est");
  const taskInput = document.getElementById("task-input");
  const stepEst = (delta) => {
    const min = Number(est.min), max = Number(est.max);
    const current = Math.round(Number(est.value) || min);
    est.value = Math.min(max, Math.max(min, current + delta));
  };
  document.getElementById("est-dec").addEventListener("click", () => stepEst(-1));
  document.getElementById("est-inc").addEventListener("click", () => stepEst(1));

  // Im Aufgabenfeld: eine Leertaste ganz am Anfang startet/pausiert den Timer,
  // statt ein führendes Leerzeichen zu tippen. Alles Weitere landet normal im Feld.
  taskInput.addEventListener("keydown", (e) => {
    if (e.key === " " && !e.ctrlKey && !e.metaKey && !e.altKey
        && taskInput.selectionStart === 0 && taskInput.selectionEnd === 0) {
      e.preventDefault();
      startPause();
      return;
    }
    // Tab springt direkt auf die Pomodoro-Schätzung – Wert markiert, damit er
    // sich sofort überschreiben lässt (Pfeiltasten funktionieren dort weiterhin).
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      est.focus();
      est.select();
      return;
    }
    // Sobald etwas im Feld steht: Pfeil rauf/runter verschiebt die
    // Einfügeposition der neuen Aufgabe (als Trennlinie sichtbar).
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && taskInput.value.trim() !== "") {
      e.preventDefault();
      if (insertIndex === null) insertIndex = computeDefaultInsertIndex();
      insertFollowsActive = false;
      insertIndex = clampInsertIndex(insertIndex + (e.key === "ArrowDown" ? 1 : -1));
      renderTasks();
      return;
    }
    // Enter fügt an der markierten Position ein; Strg+Enter immer zuunterst
    // (wie bisher), Umschalt+Enter immer zuoberst.
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) addTask(tasks.length);
      else if (e.shiftKey) addTask(0);
      else addTask(insertIndex ?? computeDefaultInsertIndex());
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); taskInput.blur(); }
  });

  // Einfügeposition initialisieren, sobald das Feld beschrieben wird, und
  // wieder zurücksetzen, wenn es leer gemacht wird (Trennlinie verschwindet).
  taskInput.addEventListener("input", () => {
    if (taskInput.value.trim() === "") {
      if (insertIndex !== null) { insertIndex = null; renderTasks(); }
      return;
    }
    if (insertIndex === null) {
      insertFollowsActive = true;
      insertIndex = computeDefaultInsertIndex();
      renderTasks();
    }
  });

  est.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); focusTaskInput(); return; }
    if (e.key === "Escape") { e.preventDefault(); est.blur(); }
  });
  // Klick/Fokus auf das Zahlenfeld markiert den Wert ebenfalls.
  est.addEventListener("focus", () => est.select());

  // "+"-Button: fügt an derselben Position ein, die gerade als Trennlinie
  // markiert ist (Enter im Feld selbst wird oben separat behandelt).
  document.getElementById("task-form").addEventListener("submit", (e) => {
    e.preventDefault();
    addTask(insertIndex ?? computeDefaultInsertIndex());
  });

  document.getElementById("btn-clear-done").addEventListener("click", () => {
    tasks = tasks.filter((t) => !t.done);
    saveTasks();
    renderTasks();
  });

  // Tastenkürzel (global – greifen nur außerhalb von Eingabefeldern)
  const MODE_KEYS = { "1": "focus", "2": "short", "3": "long" };

  document.addEventListener("keydown", (e) => {
    const target = e.target;
    // In Text-/Zahlenfeldern gehören die Tasten dem Feld. Eine fokussierte
    // Checkbox dagegen blockiert die Kürzel nicht – nur ihre Leertaste bleibt nativ.
    const isTextEntry = target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement
      || target?.isContentEditable
      || (target instanceof HTMLInputElement && target.type !== "checkbox");
    if (isTextEntry) return;
    if (target instanceof HTMLInputElement && e.code === "Space") return;
    // Browser-/System-Kürzel (Strg+R, Cmd+S …) nicht kapern.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector("dialog[open]")) return;

    const key = e.key.toLowerCase();
    if (e.code === "Space") { e.preventDefault(); startPause(); return; }
    if (MODE_KEYS[e.key]) {
      e.preventDefault();
      if (MODE_KEYS[e.key] !== timer.mode) switchMode(MODE_KEYS[e.key], { preserve: true });
      return;
    }
    if (e.key === "ArrowRight") { e.preventDefault(); skipSession(); return; }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      moveActiveTask(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    // Enter gehört einem fokussierten Button (der damit ausgelöst wird); F2 immer.
    if ((e.key === "Enter" && !(target instanceof HTMLButtonElement)) || e.key === "F2") {
      e.preventDefault();
      editActiveTask();
      return;
    }
    switch (key) {
      case "x": e.preventDefault(); toggleActiveTaskDone(); break;
      case "r": e.preventDefault(); resetTimer(); break;
      case "c": e.preventDefault(); resetCycle(); break;
      case "n": e.preventDefault(); focusTaskInput({ select: true }); break;
      case "s": e.preventDefault(); openDialog("stats-dialog"); break;
      case "e": e.preventDefault(); openDialog("settings-dialog"); break;
      case "w": e.preventDefault(); cycleLayoutWidth(); break;
      case "?": e.preventDefault(); openDialog("shortcuts-dialog"); break;
    }
  });
}

/* ============================== PWA-Installation ============================== */

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById("btn-install").hidden = false;
});

document.getElementById("btn-install").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById("btn-install").hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

/* ============================== Start ============================== */

applyTheme();
applyFont();
applyLayout();
loadSettingsUI();
bindSettings();
bindUI();
restoreTimer();
updateWakeLock();
renderTimer();
renderTasks();
initUpdateUI();
focusTaskInputOnLaunch();
