# LPE Card Authoring & Legacy Migration Kit

Use Node.js 22+ and a browser. The kit uses Node built-ins, plain HTML, CSS, and JavaScript.

## Mode A · Author a new LPE card UI

1. Edit `src/panel.html`, `src/panel.css`, and `src/panel.js`. Keep the `LPE_STYLES` and `LPE_SCRIPT` HTML comments. Use `src/tokens.css` for the glass palette and `types/lpe-card.d.ts` for editor checks.
2. From the repository root, build the sample and open `templates/lpe-card-template/preview/index.html` in a browser.

   ```sh
   node templates/lpe-card-template/build.mjs
   ```

   The preview opens directly from disk. The build writes `dist/card-panel.html` and a companion script that lets the preview load the default panel under `file://`. Select any other built panel with the file picker. When serving this directory over local HTTP, use `preview/index.html?panel=../dist/scout.html` for an alternate same-origin file. Each mount starts with fresh mock data.
3. Roll the die and check `stat_data.lastRoll` in the inspector. Queue the scouting action, then use **Confirm send**. The preview keeps the draft intact and records the simulated send. The sample saves a PRNG seed in `card_vars` so its roll sequence can be reproduced.
4. Copy the contents of the generated HTML into a fenced `html` block in a greeting or regex replacement. Keep the complete document and keep **External Resources** and **Auto-send** off when checking the strict CSP and confirmation flow in LPE. Drop an origin-only marker from panels meant to render outside Turn 0.

For multiple panels, copy `src/` to a directory per panel and adjust the declaration reference in each `panel.js`.

```sh
node templates/lpe-card-template/build.mjs --entry ./card-ui/scout --out ./templates/lpe-card-template/dist/scout.html
```

The renderer injects `window.LPECard` before panel code runs. Read `health`, `locations` (atlas), `custom_trackers` (trackers), and `notebook` (journal) from its gameplay snapshot. Use explicit dotted paths for writes to `card_vars`, and `submitInput(text)` to ask the host to queue an action. With Auto-send enabled, the host sends immediately. `fillInput(text)` fills the composer. `VexaCard` is the legacy alias. [Bridge guide](../../docs/card-adaptation/03-frontend-and-bridge.md)

## Mode B · Migrate a scripted legacy card

Start from a portrait PNG with embedded V2 or V3 metadata. Extract into a new workspace, fill `migration_plan.json`, and edit the parts in place. The packer writes the edited metadata into a copy of the portrait.

```sh
node templates/lpe-card-template/migration/extract-and-partition.mjs --input "./source.png" --work-dir "./card-work" --batch-kb 35
# Lock the plan and migrate the parts before packing.
node scripts/pack-card.mjs --parts --src "./source.png" --work "./card-work" --out "./migrated.png"
node scripts/audit-card.mjs "./migrated.png"
node scripts/verify-ejs-headless.mjs "./migrated.png" --json
```

Follow the six-step playbook for EJS, World Info, frontend reintegration, and the isolated live check. [Migration workflow](migration/MIGRATION_WORKFLOW.md)

## For AI Agents

- Record every atomic variable rename in the plan and update seeds, lookups, writes, macros, and triggers together.
- Preserve entry matching flags and card metadata. Follow each UI manifest pointer back to its editable part.
- Build every panel and exercise the strict sandbox. Report the audit blocker count and EJS pass count before the isolated Turn 0–2 check.
- Use only the Test-playground SillyTavern instance on port `8010` for live checks.

## Credits & Inspiration

Separated source and build output, editor-facing declarations, and a fast preview loop draw architectural inspiration from StageDog’s template, distributed under the PolyForm Noncommercial License 1.0.0. The kit is an independent implementation. [StageDog/tavern_helper_template](https://github.com/StageDog/tavern_helper_template)

JS-Slash-Runner / TavernHelper panels often use host helpers to reach chat, variable, and script APIs. In LPE, each panel runs in an opaque-origin Blob iframe with `sandbox="allow-scripts"`. Its gameplay snapshot, card variable writes, resizing, and chat action requests go through the scoped `window.LPECard` bridge.
