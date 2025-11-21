## Pewpew Live Dashboard

Pewpew is a lightweight desktop overlay and dashboard for League of Legends that surfaces high‑signal, actionable info while you play:

- Wave Management reminders (cannon waves, lane timing)
- Objective Preparation notifications (Dragon/Herald/Baron setup timers)
- Compact live dashboard (items, runes, summoners, scores, teams)
- In‑game overlay that mirrors tips as subtle toasts, click‑through by default

Built with Electron + TypeScript. Tips are driven by simple YAML rules you can edit without rebuilding.


### How it works

- Data source: Uses the Riot Live Client Data API exposed locally during live games at `http://127.0.0.1:2999`. No credentials are required; this endpoint is only available while you are in a match.
- Assets: Champion/items/spell icons are fetched from Riot Data Dragon (over HTTPS).
- Tips Engine: A small rules engine reads YAML from `data/tips/` and emits “tip” payloads (title/body/icon/severity). We currently ship Objective and Wave Management rules.
- Overlay: A transparent, always‑on‑top window renders compact toasts. It ignores mouse input so it won’t block gameplay. Works best in Windowed or Borderless modes (exclusive fullscreen can hide overlays).


### Features

- Wave Management: cannon‑wave reminders timed to lane spawning cycles
- Objective Preparation: pre‑spawn lead timers for Dragon/Herald/Baron
- Live dashboard: items, runes, summoners, team rosters, event log, insights
- Overlay: auto‑opens on game start, hotkey toggle, “Pewpew ON” indicator
- Dev‑only raw data viewer for debugging (hidden in production builds)


## Getting started (development)

Prerequisites:
- Node.js 18+ (recommended) and npm
- Windows 10/11 (overlay tested on Windows; Electron is cross‑platform but the overlay is primarily tuned for Windows behavior)

Install and run:

```bash
npm install
npm run dev    # builds TypeScript and starts Electron with dev flags
# or
npm start      # same as 'dev' but without setting APP_DEV=1 explicitly
```

When a live game is detected, the app automatically switches to the “Live Game” tab and opens the overlay. Use the “Toggle Overlay” button in the header or press Ctrl+Shift+O to show/hide the overlay.


## Building a Windows installer

We use electron‑builder to package the app.

```bash
npm run dist          # NSIS installer (.exe) → release/
npm run dist:portable # Portable single .exe → release/
```

Versioning:
- The app version comes from `package.json` "version" and is shown in the app header (e.g., v0.1.0).
- Bump with `npm version patch|minor|major` before packaging.

Artifacts are written to the `release/` folder. The portable build runs without installation; the NSIS build installs and adds Start Menu shortcuts.


## Using the overlay

- Auto‑opens when a game starts; auto‑hides when the game ends.
- “Pewpew ON” badge in the top‑right confirms the overlay is active.
- Click‑through: the overlay never captures mouse clicks.
- Best results in Windowed or Borderless modes (exclusive fullscreen can obscure overlays).

Hotkeys:
- Ctrl+Shift+O → Toggle overlay visibility


## Editing tips (YAML)

Tips live in `data/tips/`. You can add rules without rebuilding. The engine watches the directory and reloads automatically.

Example structure:

```yaml
version: 1
modules:
  - id: objectives
    rules:
      - id: dragon_prep_30
        name: Dragon in 30s
        trigger:
          type: objective_spawn
          objective: dragon
          leadSeconds: 30
        notify:
          channels:
            - type: overlay
              icon: "🐉"
              title: "Dragon in {lead}s"
              body: "Group and secure vision."
              severity: warning
```

Supported triggers today:
- `objective_spawn` with `objective: dragon|herald|baron` and `leadSeconds`
- `cannon_wave` with `leadSeconds` (during laning phase < 20:00)


## App UI overview

- Header: Title with app version; controls for polling interval; buttons for Raw Data (dev only) and Toggle Overlay.
- Live Game tab:
  - Summary cards (Game, Me, Scores)
  - Items/Runes/Summoners (left)
  - Wave Management tips (middle)
  - Objective Preparation tips (right)
  - Event log and Scoreboard below

While not in a game, a friendly “Waiting for a live game” screen is shown.


## Configuration notes

- Polling interval: Adjustable in the header (default 1000ms). The value is persisted to a small local settings file and restored on launch.
- Icons: App icons live under `assets/`. For Windows packaging, include `assets/icon.ico` (multi‑size ICO).
- Packaging includes: `dist/**` (compiled JS), `renderer/**` (HTML/CSS/TS outputs), `data/**` (tips), and `assets/**` (icons).


## Dev‑only tools

- Raw Data viewer: Accessible via “View Raw Data” in dev builds. Hidden/disabled in production builds.


## Troubleshooting

- “No data / waiting for game”: The Live Client API only appears when you are in a live match. Start a game; the overlay will auto‑open.
- Overlay doesn’t appear: Switch LoL to Windowed or Borderless mode. Exclusive fullscreen can hide overlay windows on some systems.
- Strict antivirus/windows settings may affect overlays; ensure the app is allowed to run.


## Privacy

All processing happens locally. The app reads your local Live Client Data while you are in a game and fetches static assets from Riot’s CDN. No personal data is transmitted anywhere by this app.


## License

TBD.
*** End Patch

