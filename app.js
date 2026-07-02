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
  wakeLock: false, alwaysOn: false, theme: "auto",
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

function creditActiveTask() {
  const task = tasks.find((t) => t.active && !t.done);
  if (task) {
    task.donePomos += 1;
    saveTasks();
    renderTasks();
  }
}

function renderTasks() {
  const list = document.getElementById("task-list");
  list.innerHTML = "";
  for (const task of tasks) {
    const li = document.createElement("li");
    li.className = "task-item" + (task.active ? " active" : "") + (task.done ? " done" : "");

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "task-check";
    check.checked = task.done;
    check.addEventListener("click", (e) => {
      e.stopPropagation();
      task.done = check.checked;
      if (task.done) task.active = false;
      saveTasks();
      renderTasks();
    });

    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.title;

    const count = document.createElement("span");
    count.className = "task-count";
    count.textContent = `${task.donePomos}/${task.est} 🍅`;

    const del = document.createElement("button");
    del.className = "task-del";
    del.textContent = "🗑";
    del.title = "Löschen";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      tasks = tasks.filter((t) => t.id !== task.id);
      saveTasks();
      renderTasks();
    });

    li.append(check, title, count, del);
    li.addEventListener("click", () => {
      if (task.done) return;
      const wasActive = task.active;
      tasks.forEach((t) => (t.active = false));
      task.active = !wasActive;
      saveTasks();
      renderTasks();
    });
    list.append(li);
  }

  document.getElementById("task-empty").hidden = tasks.length > 0;
  document.getElementById("task-footer").hidden = !tasks.some((t) => t.done);

  const active = tasks.find((t) => t.active && !t.done);
  const display = document.getElementById("active-task-display");
  display.hidden = !active;
  if (active) document.getElementById("active-task-name").textContent = active.title;
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
  ["set-sound", "sound", "select"],
  ["set-volume", "volume", "number"],
  ["set-tick", "tick", "checkbox"],
  ["set-notify", "notify", "checkbox"],
  ["set-vibrate", "vibrate", "checkbox"],
  ["set-wakelock", "wakeLock", "checkbox"],
  ["set-always-on", "alwaysOn", "checkbox"],
  ["set-theme", "theme", "select"],
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

      if (key === "theme") applyTheme();
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
}

/* ============================== App-Verkabelung ============================== */

function bindUI() {
  document.getElementById("btn-start").addEventListener("click", startPause);
  document.getElementById("btn-reset").addEventListener("click", resetTimer);
  document.getElementById("btn-skip").addEventListener("click", skipSession);

  document.querySelectorAll(".mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.dataset.mode !== timer.mode) switchMode(tab.dataset.mode, { preserve: true });
    });
  });

  // Dialoge
  document.getElementById("btn-stats").addEventListener("click", () => {
    renderStats();
    document.getElementById("stats-dialog").showModal();
  });
  document.getElementById("btn-settings").addEventListener("click", () => {
    document.getElementById("settings-dialog").showModal();
  });
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

  // Aufgaben
  document.getElementById("task-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("task-input");
    const est = document.getElementById("task-est");
    const title = input.value.trim();
    if (!title) return;
    tasks.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title,
      est: Math.min(20, Math.max(1, Number(est.value) || 1)),
      done: false,
      donePomos: 0,
      active: tasks.every((t) => !t.active),
    });
    input.value = "";
    est.value = "1";
    saveTasks();
    renderTasks();
  });

  document.getElementById("btn-clear-done").addEventListener("click", () => {
    tasks = tasks.filter((t) => !t.done);
    saveTasks();
    renderTasks();
  });

  // Tastenkürzel
  document.addEventListener("keydown", (e) => {
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
    if (document.querySelector("dialog[open]")) return;
    if (e.code === "Space") { e.preventDefault(); startPause(); }
    else if (e.key === "r" || e.key === "R") resetTimer();
    else if (e.key === "s" || e.key === "S") skipSession();
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
loadSettingsUI();
bindSettings();
bindUI();
restoreTimer();
updateWakeLock();
renderTimer();
renderTasks();
