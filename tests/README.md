# Tests

End-to-end UI checks driven by a headless Chromium (Playwright).

## Run

```bash
npm install                     # installs playwright (devDependency)
npx playwright install chromium # downloads the browser (once)
npm test
```

Each test file starts its own static server for `docs/`, so you don't
need `npm start` running. They print a ✓/✗ line per check and exit non-zero
if anything fails.

### What it covers

`tests/ui.test.mjs`:
- **Task estimate stepper** – the `−` / `+` buttons increment, decrement,
  clamp to the 1–20 range, carry the value into the created task, and reset.
- **Pomodoro cycle counter** – the dots fill as focus rounds advance and
  reset to zero when tapped (and the reset persists across a reload).
- **Tomato icon** – `icon.svg`, `icon-192.png` and `icon-512.png` are served.

`tests/update.test.mjs` (native `ApkUpdater` plugin mocked, GitHub API mocked):
- The update section is hidden in the browser/PWA and visible in the app.
- Version comparison against the `latest` release (update available /
  up to date / unknown dev build) and the download call with the release URL.
- The "install unknown apps" permission hint when installs aren't allowed.

### Notes

- If Chromium is installed somewhere non-standard, point the test at it:
  `PW_EXECUTABLE=/path/to/chrome npm test`.
