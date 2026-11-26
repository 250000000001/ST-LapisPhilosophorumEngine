# 05 — CN → EN Localization & Key Migration Workflow

Translating script-heavy Chinese SillyTavern cards requires **atomic key synchronization** across three coupled layers: `[InitVar]` JSON, World Info EJS/macros, and frontend HTML/regex scripts.

---

## 1. Glossary Lock & Atomic Key Map First

Before translating any batch in parallel:
1. **Lock Canonical Setting Terms:** Build a single `glossary_and_keymap.json` with standardized official English translations for every faction, sequence, pathway, realm/location, currency, and recurring lore term so split subagents never invent conflicting spellings.
2. **Define Every `old_cn_key` -> `new_en_key` Up Front:**
   - Map every top-level and nested key used inside `[InitVar]`, `getvar(...)`, `setvar(...)`, `{{get_card_var::...}}`, `{{get_message_variable::...}}`, and `LPECard.getVar/setVar` (or legacy `VexaCard.*`) to clean `snake_case` English keys (e.g., `运气` -> `luck`, `理智` -> `sanity`, `当前理智` -> `current_sanity`, `基准总值` -> `base_total`).
   - Verify no key contains CJK characters or collides with `__proto__` / `constructor` / `prototype`.

---

## 2. Lorebook Partitioning & Cleanup

- **Keep Enabled Lore + Playable Disabled Rules/DLC:** Translate all active lore/rule entries, `[InitVar]`, and meaningful optional toggle entries (difficulty/combat/DLC packs).
- **Prune Orphaned `TavernHelper` Data Tables:** Large disabled JSON catalogs (tens or hundreds of KB of portrait URLs, pet dictionaries, or spell tables queried solely via `TavernHelper.getLorebookEntries` + `regex_scripts`) serve no purpose in Pure LPE Mode and bloat card PNG size; prune them explicitly while keeping LPE/World Info clean.
- **Trigger Keyword Hygiene (`keys` / `secondary_keys`):**
  - Translate Chinese trigger words into accurate English nouns/proper names/phrases.
  - **Never** leave single generic stopwords (`the`, `and`, `for`, `man`, `day`, `yes`, `no`, `see`, `go`) that false-trigger on every turn.
- **Format Directive Migration:**
  - Strip `<UpdateVariable>` / `_.set(...)` / `<gametxt>` / `<action>` / `<wlog>` instructions from active rules/variable summaries.
  - Point active variable templates at `{{get_card_var::stat_data.*}}` (card RPG stats) and LPE's compiled `<internal_states>` (`{{lpe::world.loc}}`, `{{lpe::health.overallHp}}`, Atlas, Health Doll, Inventory, Custom Trackers).

---

## 3. UI & PNG Packaging Hygiene

- **Embed Opening Screen Directly in `first_mes` + In-Turn Panel via Clean Regex:** Placing the self-contained Opening Setup ` ```html ` block directly inside `first_mes` (under `< 60 KB`, using `--lpe-*` variables + `window.LPECard`) guarantees Turn-0 interactive setup works cleanly without fragile multi-MB regex scripts. Use a targeted markdown-only regex anchored on `<!-- GFX_END -->` (`$&`) for optional in-turn status/action strips.
- **Lossless V2 Repack:** Copy `IHDR`, `IDAT`, and ancillary image chunks verbatim from the source PNG and replace `chara` (without duplicating a multi-MB `ccv3` copy) so portrait pixels stay untouched while total PNG size drops dramatically.
- **Zero CJK Verification:** Assert `cjkCouplingCount === 0` (and ideally `0` residual CJK characters anywhere in enabled card text) via `scripts/audit-card.mjs` before live testing.
