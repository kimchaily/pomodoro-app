# Tests

End-to-end UI checks driven by a headless Chromium (Playwright).

## Run

```bash
npm install                     # installs playwright (devDependency)
npx playwright install chromium # downloads the browser (once)
npm test
```

`tests/ui.test.mjs` starts its own static server for `docs/`, so you don't
need `npm start` running. It prints a ✓/✗ line per check and exits non-zero
if anything fails.

### What it covers

- **Task estimate stepper** – the `−` / `+` buttons increment, decrement,
  clamp to the 1–20 range, carry the value into the created task, and reset.
- **Pomodoro cycle counter** – the dots fill as focus rounds advance and
  reset to zero when tapped (and the reset persists across a reload).
- **Tomato icon** – `icon.svg`, `icon-192.png` and `icon-512.png` are served.

### Notes

- If Chromium is installed somewhere non-standard, point the test at it:
  `PW_EXECUTABLE=/path/to/chrome npm test`.
