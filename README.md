# 🍅 Pomodoro Fokus-Timer

Pomodoro-App als **PWA** (im Browser installierbar) und als **Android-App**
(Capacitor) mit echtem Hintergrund-Alarm – ganz ohne App-Store.

## Features

- **Timer**: Fokus / kurze Pause / lange Pause, Dauern frei einstellbar,
  lange Pause nach N Pomodoros, Auto-Start, Überspringen, Fortschrittsring,
  Zyklus-Punkte
- **Hintergrund-Alarm (Android-App)**: Das Ende der Einheit wird als exakter
  System-Alarm vorgemerkt – klingelt auch bei ausgeschaltetem Bildschirm oder
  geschlossener App
- **Aufgaben**: Liste mit geschätzten Pomodoros, aktive Aufgabe wird
  automatisch hochgezählt
- **Statistik**: Heute / Woche / Gesamt, Tagesserie (Streak),
  7-Tage-Diagramm, Fokusminuten
- **Signale**: Benachrichtigungen, Vibration, 3 Klangthemen mit Lautstärke,
  optionales Ticken
- **Komfort**: Bildschirm-Wachhalten (während des Timers) oder „Display immer
  an", Hell/Dunkel/Auto-Design, Tastenkürzel (Leertaste/R/S). Ein Tab-Wechsel
  setzt den laufenden Timer nicht zurück – das geschieht nur über die
  Zurücksetzen-Taste.
- **Offline**: Alle Daten bleiben lokal auf dem Gerät

## Android-APK bekommen

Bei jedem Push auf `main` baut GitHub Actions automatisch eine Debug-APK und
hängt sie an das Release **„latest“** an:

1. Auf dem Smartphone die **Releases**-Seite dieses Repos öffnen.
2. `pomodoro.apk` herunterladen und antippen.
3. Installation aus unbekannter Quelle einmalig erlauben – fertig.

Beim ersten Start fragt die App nach der Benachrichtigungs-Berechtigung;
diese wird für den Hintergrund-Alarm benötigt.

## Als PWA nutzen (Alternative ohne APK)

Die PWA wird automatisch auf GitHub Pages veröffentlicht
(<https://kimchaily.github.io/pomodoro-app/>). Pages-URL in Chrome öffnen →
Menü (⋮) → **„App installieren“**.

Hinweis: Als PWA klingelt der Alarm nur zuverlässig, solange die App im
Vordergrund läuft – für Hintergrund-Alarme die Android-APK verwenden.

### Deployment & PR-Vorschau

Der Workflow `.github/workflows/pages.yml` veröffentlicht alles in den Branch
`gh-pages`, damit Produktion und PR-Vorschauen nebeneinander liegen:

| Auslöser | URL |
| --- | --- |
| Push auf `main` | `…/pomodoro-app/` (Produktion) |
| Offener Pull Request | `…/pomodoro-app/preview/<branch>/` (Vorschau) |
| PR geschlossen/gemergt | Vorschau wird automatisch entfernt |

Bei jedem PR postet der Workflow den Vorschau-Link als Kommentar. So lässt sich
jeder Branch live testen, bevor er nach `main` gemergt wird.

**Einmalige Einrichtung** (nach dem ersten Merge dieses Workflows nach `main`):
**Settings → Pages → Source** auf **„Deploy from a branch“**, Branch
**`gh-pages`**, Ordner **`/ (root)`** umstellen.

## Projektstruktur

```
docs/        Web-App (PWA) – wird auch als WebView-Inhalt der Android-App genutzt
android/     Generiertes Capacitor-Android-Projekt
tests/       End-to-End-UI-Tests (Playwright)
.github/     CI-Workflows: APK-Build und GitHub-Pages-Deployment
```

## Lokal entwickeln

```bash
npm install          # Abhängigkeiten (Capacitor)
npm start            # Web-App unter http://localhost:8080
npx cap sync android # Web-Assets ins Android-Projekt kopieren
```

Für einen lokalen APK-Build werden Android SDK + Java 21 benötigt
(`cd android && ./gradlew assembleDebug`).
