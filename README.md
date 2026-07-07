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
- **In-App-Update (Android-App)**: Einstellungen → App-Update prüft gegen das
  `latest`-GitHub-Release (Commit-Vergleich), lädt die neue APK direkt herunter
  und öffnet den System-Installer. Der CI-Build backt dafür `version.json` mit
  Commit und Build-Zeit in die APK ein.
- **Aufgaben**: Liste mit geschätzten Pomodoros, aktive Aufgabe wird
  automatisch hochgezählt
- **Statistik**: Heute / Woche / Gesamt, Tagesserie (Streak),
  7-Tage-Diagramm, Fokusminuten
- **Signale**: Benachrichtigungen, Vibration, 3 Klangthemen mit Lautstärke,
  optionales Ticken
- **Farbschemata**: Neben dem klassischen Design fünf vollflächige Themes
  (Honig, Rosé, Salbei, Ozean, Schiefer) mit weißen Elementen auf Farbfläche;
  die Farbe variiert je Modus (Fokus / kurze / lange Pause), die Statusleiste
  färbt sich passend mit
- **Schriftarten**: fünf Stile zur Auswahl (Standard, Elegant/Serif, Leicht,
  Schmal, Nerdy/Mono) – reine System-Fonts, damit die App offline bleibt und
  auf jedem Gerät ohne Download passt
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

### Signaturschlüssel & Updates

Damit die In-App-Updatefunktion funktioniert, müssen alle APKs mit **derselben
Signatur** gebaut werden – sonst lehnt Android das Update ab
(„App not installed as package conflicts with an existing package"). Der
CI-Build signiert deshalb mit einem festen Debug-Keystore, der als
**GitHub-Secret** hinterlegt ist und nie im Repo liegt.

**Einmalige Einrichtung** (Repo-Einstellungen):

1. Keystore erzeugen (Standard-Debug-Parameter, 30 Jahre gültig):
   ```bash
   keytool -genkeypair -v -keystore debug.keystore -storepass android \
     -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 \
     -validity 10950 -dname "CN=Android Debug,O=Android,C=US"
   ```
2. In Base64 umwandeln: `base64 -w0 debug.keystore`
3. Den Wert unter **Settings → Secrets and variables → Actions → New
   repository secret** als **`DEBUG_KEYSTORE_BASE64`** speichern.

Fehlt das Secret, baut der Workflow trotzdem – dann aber mit einem zufälligen
Key (mit Warnung im Log), und Updates schlagen fehl.

**Hinweis bei Signaturwechsel:** Wurde die App zuvor mit einer anderen Signatur
installiert (z. B. ältere Builds mit zufälligem CI-Key), muss sie **einmalig
deinstalliert** und neu installiert werden – dabei gehen lokale Daten
(Einstellungen, Aufgaben, Statistik) verloren. Danach laufen Updates ohne
Deinstallation.

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

**Deploy-Portal:** <https://kimchaily.github.io/pomodoro-app/preview/> listet
Produktion und alle offenen PR-Vorschauen mit Links auf – so muss kein
Branch-Name von Hand eingegeben werden. Die Seite wird bei jedem Deploy neu
erzeugt (`scripts/gen_portal.py`).

**Einmalige Einrichtung** (nach dem ersten Merge dieses Workflows nach `main`):
**Settings → Pages → Source** auf **„Deploy from a branch“**, Branch
**`gh-pages`**, Ordner **`/ (root)`** umstellen.

## Projektstruktur

```
docs/        Web-App (PWA) – wird auch als WebView-Inhalt der Android-App genutzt
android/     Generiertes Capacitor-Android-Projekt
tests/       End-to-End-UI-Tests (Playwright)
scripts/     Hilfsskripte für das Pages-Deployment (Portal, Metadaten)
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
