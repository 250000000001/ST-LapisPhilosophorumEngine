# 04 — Static Auditing & End-to-End Verification

Every converted card MUST pass both static offline checks (`audit-card.mjs` + headless `ejsEngine.js`) and an isolated live SillyTavern smoke test before release.

---

## 1. Running `scripts/audit-card.mjs`

```bash
node scripts/audit-card.mjs "<path/to/card.png_or_json>" --json --out audit.json [--no-fail]
```

- Exits **`1`** whenever `summary.blockers > 0` (unless `--no-fail` is passed for baseline telemetry).
- Inspects `tEXt` (`chara` / `ccv3`) PNG chunks, core fields, `extensions.regex_scripts`, HTML frontend blocks, and all `character_book.entries`.

### Issue Severity Definitions
- **`BLOCKER`** (must hit **`0`** before shipping):
  - Forbidden host/storage/network APIs in enabled HTML or regex blocks (`TavernHelper`, `window.parent`, `localStorage`, `sessionStorage`, `indexedDB`, `Dexie`, `triggerSlash`, `window.open`, `<form\b`).
  - External `http(s)://` `<script src>`, `<link href>`, or `@import` blocked by strict CSP.
  - Enabled HTML/regex payload exceeding `2048 KB` (`rendererMaxHtmlKb` pause threshold).
  - Unparseable `[InitVar]` / `[VexaInitVar]` JSON.
  - EJS compile/evaluation failure, forbidden global/prototype usage, or step-budget overflow in any enabled entry/field.
  - Active MVU/legacy format directives (`<UpdateVariable`, `<gametxt>`, `_.set(`, `_.add(`) conflicting with Vexa External State.
- **`WARN`** (review and clean up):
  - Orphaned large disabled lookup tables (`> 20 KB`), oversized PNG (`> 10 MB`), duplicate huge `ccv3` chunk, unresolved `{{get_card_var::...}}` keys missing from `[InitVar]`, empty core fields, overly generic English trigger words, or external `http(s)` image URLs under strict CSP.
- **`cjkCouplingCount`** (target **`0`** on EN conversions):
  - Count of CJK characters (`[\u3400-\u9FFF\uF900-\uFAFF]`) in code-coupled paths: `[InitVar]` JSON keys, `getvar`/`setvar`/`VexaCard.getVar`/`VexaCard.setVar` string arguments, `{{get_card_var::...}}`/`{{get_message_variable::...}}` paths, enabled regex `findRegex`, `<script>` blocks, and enabled WI trigger keys.

---

## 2. Headless EJS & Bridge Test Gate

Run `evaluateEjs`, `substituteVexaMacros`, `tryParseInitVarsFromEntries`, `isFrontendHtmlBlock`, and `assembleSandboxedDocument` across:
1. Healthy Turn-1 mock `card_vars` + empty Vexa state.
2. Combat/low-sanity Turn-N mock state (`health.bloodLoss >= 20`, `health.pain >= 35`, `stat_data.sanity < 40`, blessed `luck`) verifying zero uncaught errors, zero raw `<%` leaks, zero unresolved `{{get_card_var::...}}`, and exact numeric activation.

---

## 3. Isolated SillyTavern Live Smoke Test

**Never run tests against a user's live port (`8000`).** Use an isolated SillyTavern instance on a free port (e.g., `8010`) with Pure Vexa Mode (`enabled: true`, `forceActive: true`, `ejsEnabled: true`, `ejsAutoYield: false`, `rendererEnabled: true`, `rendererAutoYield: false`).

Verify 3 end-to-end checkpoints via Playwright / Chrome DevTools Protocol (`0` console errors, `0` CSP errors):
1. **Turn 0:** Greeting renders in English, `[InitVar]` auto-seeds `card_vars`, opening HTML renders in `sandbox="allow-scripts"` Blob-URL iframe, interactive confirm triggers `VexaCard.patchVars` + 1-click confirmation bar.
2. **Turn 1:** Player action fires translated World Info + evaluated EJS pool + Vexa Clerk JSON delta; main model closes with `<vexa_tail>` + `<!-- GFX_END -->`; Inline Vexa HUD updates with "Changed in this reply" diff strip; In-Turn HTML panel mounts cleanly.
3. **Turn 2:** Swipe and page reload preserve `(vexa_uid, vexa_seq)` journal state, `card_vars`, HUD, and Blob-URL panel with `0` console errors.
