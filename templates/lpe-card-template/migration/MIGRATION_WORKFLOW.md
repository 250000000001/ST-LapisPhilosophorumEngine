# Migrate a scripted card to LPE

Run commands from the LPE repository root. Use a working copy of the source PNG and keep the original as your portrait and metadata baseline.

## 1. Unpack and audit

```sh
node templates/lpe-card-template/migration/extract-and-partition.mjs --input "./source.png" --work-dir "./card-work" --batch-kb 35
```

Use a fresh work directory. Review `audit_before.json`, `raw_card.json`, and `parts/`. Batches keep each World Info entry intact and preserve its order. An entry larger than the target gets its own batch and emits a warning. Extraction recognizes fenced HTML and JavaScript, standalone HTML, and common embedded script and event-handler markup. Review mixed prose and legacy extension payloads for additional UI code.

## 2. Lock the migration plan

Fill `card-work/migration_plan.json` before editing any batch. Treat `detected` as a starting inventory. It captures literal lookups and macros. Inspect dynamic names and legacy configuration by hand.

- Map old variable paths to new paths with `key_map`. Check lookups, writes, initial values, macros, and embedded UI against the same map.
- Record replacements for broad World Info triggers in `wi_trigger_rules`. Preserve intended secondary keys, match modes, priorities, and constant entries.
- Keep card-specific counters in `card_vars`. Map recurring multi-field records to `tracker_propose` and subsequent tracker updates, physical changes to `health_delta`, and geography to atlas `locations`. Record the old field and new owner in `state_offload`.
- For optional localization, use `glossary` to record terminology and update prose, triggers, and UI consistently.

## 3. Migrate core fields and World Info EJS

Edit `parts/core_fields.json` and `parts/wi_batch_*.json`. Place JSON seeds in a World Info entry labelled `[InitVar]`. Use `getvar('stat_data.resolve', 50)` and `getlpe('health.overallHp', 100)`, or read from the frozen `lpe` snapshot. `setvar` stages writes only in contexts that explicitly enable them. For persisted changes, use a bridge write or an LPE state update appropriate to the field. Keep loops within the 5,000-step budget. Use context-specific World Info triggers and verify which branches activate. [EJS and variables](../../../docs/card-adaptation/02-ejs-and-variables.md)

## 4. Migrate frontend panels

For each `extracted-ui/ui_manifest.json` record, open the extracted block and its `part_file` and `part_pointer`. The `pointer` points into `raw_card.json`. Offsets are UTF-16 code units in the original string, with an exclusive end. After editing a field, locate the original block again before replacing it. For several replacements in one unedited string, apply them from highest offset to lowest.

Copy the template's `src/` for each panel and use the [bridge declarations](../types/lpe-card.d.ts) and [glass tokens](../src/tokens.css). Replace legacy variable access with `getVar`, `setVar` or `patchVars`, and chat actions with `submitInput`. Remove or disable obsolete extension scripts after migrating their behavior. Bundle and load the result in the preview file picker.

```sh
node templates/lpe-card-template/build.mjs --entry "./card-work/panel-1" --out "./card-work/panel-1.html"
```

Put bundled HTML back into the mapped part. Regex replacements belong in `regex_and_ui.json`. Greetings and World Info belong in their original core field or batch. Keep existing `html` fences, or wrap a replacement in an `html` fence when the panel must render in chat. If a block was extracted from a JavaScript fence, change its fence language to `html`. Verify any literal dollar signs and regex capture substitutions after reinsertion.

## 5. Pack and run offline gates

```sh
node scripts/pack-card.mjs --parts --src "./source.png" --work "./card-work" --out "./migrated.png"
node scripts/audit-card.mjs "./migrated.png" --out "./card-work/audit_after.json"
node scripts/verify-ejs-headless.mjs "./migrated.png" --json
```

Require zero audit BLOCKERs and a passing result for every checked template. The headless gate runs primary, alternate, and group greetings and enabled World Info EJS at mock turns 0, 1, and 2. `checked: 0` means no EJS templates were found in those fields. Run these checks on cards whose code you trust. Verify trigger activation and swipe persistence in the live check.

## 6. Check the isolated instance

Use `D:\open-terminal\workspace\Projects\Test-playground\SillyTavern` on port `8010` only. Import the packed PNG into a fresh chat with native LPE EJS and renderer enabled. Turn off EJS and renderer auto-yield, renderer External Resources, and renderer Auto-send.

- **Turn 0** · Check the greeting, initial variables, panel height, and console/CSP output.
- **Turn 1** · Queue and confirm one action. Check that LPE updates the intended state and that matching World Info activates.
- **Turn 2** · Swipe between responses and reload. Check variables, snapshots, and attached panels against the selected response and confirm that a pending action did not send by itself.

Keep the migrated PNG and verification results, then remove the temporary work directory.
