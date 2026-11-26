# 02 — Scoped EJS Engine & Card Variables (`card_vars`)

`src/ejsEngine.js` provides a clean-room, zero-dependency EJS runtime compiled in strict mode with AST-free safety scanning, shadowed globals, bracket-key guards, and loop-step budgeting.

---

## 1. `[InitVar]` Seeding & `card_vars` Storage

- **World Info Seed Entry:** Name the entry comment `[InitVar]` or `[VexaInitVar]` (exact comment match or inside `key`/`keys`). Its content may be raw JSON or a fenced ` ```json ... ``` ` block.
- **Normalization (`tryParseInitVarsFromEntries`):**
  - Recursively strips `$meta` schema markers and forbidden prototype keys (`__proto__`, `constructor`, `prototype`).
  - Wraps flat objects under `{ stat_data: ... }` automatically if `stat_data` is absent.
  - Stores into chat-scoped metadata (`store.seedCardVarsIfEmpty(initVars)` — max `65,536` bytes per chat in `src/store.js`).
- **Turn-0 Timing:** Seeding triggers on `CHAT_CHANGED` from the active character's embedded `character_book.entries` AND on `WORLDINFO_ENTRIES_LOADED`.

---

## 2. Available EJS Tags & Helpers

### Tags (`tokenizeEjs`)
- `<% code %>` — execute JS statements
- `<%= expr %>` — HTML-escaped output (`& < > " '`)
- `<%- expr %>` — raw output (preferred for prompt text, JSON, or HTML snippets)
- `<%# comment %>` — stripped comment
- `<%_ ... -%>` / `%>` — whitespace slurping; `<%%` / `%%>` for literal `<%` / `%>`

### Environment Bindings (`evaluateEjs`)
| Helper / Variable | Signature / Behavior |
|---|---|
| `getvar(path, fallbackOrOpts)` | Looks up `path` in `card_vars` (falls back between `stat_data.<path>` and root, then `custom_trackers.*`). Supports `{ defaults: x }` or `{ default: x }` or direct fallback scalar. |
| `setvar(path, value)` | Prompt-stage only when `allowVarWrites: true`; writes are staged and committed **only** if template evaluation succeeds. Disabled (`false`) during read-only World Info evaluation. |
| `getvexa(path, fallback)` | Reads frozen Vexa state snapshot, e.g. `getvexa('world.loc')`, `getvexa('health.bloodLoss', 0)`, `getvexa('health.pain', 0)`, `getvexa('custom_trackers.<id>.fields.<key>')`. |
| `roll(expr)` | Safe RPG dice roller: `NdS`, `NdS+K`, `NdS-K`, `NdSkhM`, `NdSklM` (`N <= 100`, `S <= 10000`). Returns `{ total, rolls, kept, modifier, expr }` with `valueOf()` / `toString()` returning `total`. |
| `chance(pct)` | Returns boolean with `pct%` probability (`<=0` false, `>=100` true). |
| `pick(arr)` | Uniformly picks a random element from `arr`. |
| `clamp(val, min, max)` | Numeric clamp helper. |
| `getwi(commentOrKey)` | Case-insensitive lookup returning another loaded World Info entry's raw content. |
| `vexa` / `state` / `vars` | Deep-frozen read-only snapshots of Vexa state and `card_vars`. Note: `health` in `vexa` includes computed `overallHp`, `pain`, `painLabel`, `bloodLoss`, `bleedingLevel`, `bleedingCount`, `totalWounds`, `untreatedCount`, `capacities`. |
| `char`, `user`, `turn` | Active character name, user persona name, and `Number(vexa.world?.ct || 0)`. |

---

## 3. Non-EJS Macro Substitution (`substituteVexaMacros`)

Evaluated after EJS in both World Info entries and outgoing non-user prompt messages:
- `{{get_card_var::path}}` — replaced with resolved `card_vars` value (`''` if missing).
- `{{vexa::path}}` — replaced with Vexa state value (`''` if missing).
- `{{get_message_variable::path}}` — replaced **only when resolved** in `card_vars` / `custom_trackers` (left untouched if owned elsewhere).
- `{{format_message_variable::path}}` — pretty-printed JSON if object/array when resolved.
- `{{roll:NdS}}` — rolled scalar replacement.

---

## 4. Hard Sandbox & Budget Limits

Templates fail closed and return raw fallback text + console warning if they violate any rule:
- **Loop & Time Budget:** `DEFAULT_MAX_LOOP_STEPS = 5000` (all `for`, `while`, `do..while`, `for..of`, `for..in` loops inject `__vseStep()`), `maxEvalMs = 200`, `DEFAULT_MAX_TEMPLATE_CHARS = 262144`, `DEFAULT_MAX_OUTPUT_CHARS = 262144`.
- **Syntax Constraints:** Braceless loops (`for (...) doSomething();`) are rejected — always wrap loop bodies in `{ ... }`. Class declarations and unicode identifier escapes (`\u0064`) are blocked.
- **Forbidden Globals:** `window`, `document`, `globalThis`, `self`, `top`, `parent`, `frames`, `SillyTavern`, `jQuery`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `Worker`, `Proxy`, `Reflect`, `eval`, `Function`, `localStorage`, `sessionStorage`, `indexedDB`, `fetch`, `process`, `require`, `module`, `exports`, etc.
- **Forbidden Prototype Tokens:** `__proto__`, `constructor`, `prototype`, `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__` (both static identifiers and dynamic bracket lookups).
- **Prompt Message Default:** `evaluatePromptMessagesEjs` skips `role === 'user'` messages by default (`skipUserMessages = true`) so user prose containing `<%` cannot execute code.
