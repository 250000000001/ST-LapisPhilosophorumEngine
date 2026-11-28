# 06 — Creator Guide & Adaptation Patterns

This guide turns the practical lessons of the Poaries card-making tutorial into an LPE workflow. It applies both to adapting an existing script-heavy card and to authoring a new one. The central rule is simple: **write compelling causal fiction, give changing facts one owner, and let code render and calculate what code can do more reliably than prose.**

Use it with the detailed references for [state ownership](01-overview-and-offloading.md), [EJS and `card_vars`](02-ejs-and-variables.md), [the sandboxed frontend bridge](03-frontend-and-bridge.md), [auditing and testing](04-audit-and-testing.md), and [localization](05-cn-to-en-localization.md).

## Part I — Card adaptation takeaways

### 1. Replace monolithic descriptions with layered, playable context

**Why the legacy pattern breaks:** A single description containing biography, world history, rules, current variables, output schemas, and UI instructions makes every fact compete for attention on every turn. Static lore obscures the immediate hook; old “current” values become stale; and small edits risk changing unrelated behavior.

**The LPE pattern:**

- Keep the description focused on identity, voice, motives, relationships, and the rules that are always relevant.
- Write **causal chains rather than trait inventories**: formative cause -> present strategy -> visible behavior -> conditions that change it. “She trusts no one” is less useful than explaining what taught her caution, how caution appears in conversation, and what evidence could earn trust.
- Apply the same causality to the world. Derive hazards, social customs, and vulnerabilities from physiology, history, resources, or institutions so the model can extrapolate instead of recite labels.
- Split optional lore into focused World Info entries with deliberate triggers. Keep one subject per entry and omit detail that does not affect play.
- Move changing geography, NPC state, injuries, inventory, relationships, and plot state to their native LPE owners. Keep only card-specific RPG progression in `card_vars`.
- Treat the opening as a behavioral example, not another synopsis. It should demonstrate cast, place, relationship, viewpoint, prose style, and a decision or conflict that is still unresolved.

Do not repeat LPE's canonical state as a second AI-maintained roster in the description. Use [the ownership table](01-overview-and-offloading.md#2-state-ownership-what-offloads-vs-what-stays-in-card_vars) before converting any status field.

### 2. Guard lorebook triggers instead of letting context cascade

**Why the legacy pattern breaks:** Generic words, overlapping entries, and recursive activation can inject large amounts of irrelevant lore. The model then receives contradictory rules or pays attention to a side entry instead of the scene.

**The LPE pattern:**

1. Keep always-on material short and reserve it for core identity and rules.
2. Use several natural, specific keywords or phrases for conditional entries; add secondary keys when an entry should require more than one signal.
3. Avoid generic triggers such as `the`, `day`, `room`, or `look`. `audit-card.mjs` warns about many overly broad English keys, but a clean audit does not prove that every trigger is semantically precise.
4. Prevent further recursion where a match should not activate more entries. Test nearby synonyms, unrelated scenes, and several entries that could match together.
5. Check injection position and priority as well as content. Important live rules should not be buried under reference lore.

LPE's native snapshot is separate from this problem: Smart Scoping can compact inactive Atlas maps and dormant NPCs, but it cannot repair a poorly triggered card lorebook. Trigger behavior remains an author test case.

### 3. Replace manual status arithmetic and regex databases with owned state

**Why the legacy pattern breaks:** Asking the story model to find every old value, calculate a delta, and reprint a complete status block produces arithmetic drift, missing fields, and contradictory inventory. Large capture-group regexes then turn that fragile text into an equally fragile database.

**The LPE pattern:**

- Let LPE Clerk report semantic changes as JSON deltas and let deterministic reducers apply them. This is the native path for Atlas rooms and props, entity state and memory, relationships, tracks, inventory, and anatomical health.
- Use `health_delta` for injuries and conditions. The Health Doll computes Overall HP, Pain, Blood Loss, and physiological capacities; do not ask the model to recalculate and reprint those gauges.
- Use `tracker_propose` for a recurring multi-field enterprise or ledger, then allow Clerk to patch only its locked fields.
- Seed card-specific values once with `[InitVar]` / `[LPEInitVar]` in chat-scoped `chat_metadata.lpe_state.cardVars`. Read them in World Info with `getvar('stat_data.resolve', 50)`, in prompts with `{{get_card_var::stat_data.resolve}}`, or in a panel with `LPECard.getVar(...)`.
- Compute deterministic checks in scoped EJS with `roll`, `chance`, and `clamp`. Read native state with `getlpe('health.bloodLoss', 0)`, `getlpe('world.loc')`, or the frozen `lpe.*` snapshot. `setvar` is staged only in contexts that explicitly allow writes; it is not a general replacement for Clerk or bridge updates.
- Persist panel-driven card changes with `LPECard.setVar` or `LPECard.patchVars`. Do not use browser storage as a parallel save system.

Regex still has a legitimate role as a **display adapter**: capture a compact model-provided result into a fixed presentation, or attach a targeted panel at `<!-- GFX_END -->`. It should not reconstruct canonical state from formatted prose. Remove active `<UpdateVariable>`, `<gametxt>`, `_.set(...)`, and `_.add(...)` directives during migration.

### 4. Stop overloading one API turn

**Why the legacy pattern breaks:** A model asked to write excellent prose, simulate every NPC, update a large schema, and generate a frontend often sacrifices one job for another. Repeating unchanged state also wastes output tokens and increases truncation risk.

**The LPE division of labor:**

1. The main model writes the story and ends with a compact `<lpe_tail>` containing `<lpe_receipt>` (`world_sim`, `chekhov`, `arc`, `ooc`, and optional `tracker_propose`), `<state:vent>`, and `<!-- GFX_END -->`.
2. **LPE Clerk** receives the latest cleaned exchange, a compact current state, limited earlier context, and the main model's receipt/vent. It emits only changed JSON fields.
3. Deterministic JavaScript applies the delta, clamps values, computes derived health, advances journal state, and renders the native HUD. The main model does not reprint full `<internal_states>` or emit legacy variable-update blocks.
4. Where useful, Clerk's optional split mode separates spatial/entity work from narrative simulation work. This is a worker configuration choice, not a reason to add another model call inside a card panel.

The result is a small output contract for the creative model and a narrow extraction contract for the worker. Keep card instructions consistent with that contract rather than introducing a second simultaneous status language.

### 5. Compact state and scope history; do not confuse this with chat summarization

**Why the legacy pattern breaks:** Raw prose plus copied status XML, chronicles, and dormant world records eventually crowds out the current scene. Old tails also invite the model to repeat stale state.

**What LPE handles:**

- Historical assistant `<internal_states>`, `<lpe_tail>`, and legacy Vexa tails are stripped from outgoing prompts. One current compiled snapshot is injected instead.
- Smart Scoping summarizes inactive Atlas maps and dormant NPCs while preserving their full records in the store; recent or named records can expand again.
- Clerk uses compact state and a limited earlier-context snippet. Its deltas omit unchanged records.
- Entity memory is deduplicated and capped at 20 entries per character. Notebook entries are capped, with rules optionally pinned. Tracks, ARC, Chekhov state, and story notes preserve structured narrative continuity across swipe-safe snapshots.

**What remains the creator's responsibility:** LPE does **not** summarize or delete the card's ordinary prose chat history. Long campaigns still need a deliberate SillyTavern chat-summary/context strategy. Do not add a parallel per-turn “small summary/large summary” machine unless the play experience needs it; first use LPE's structured notes and memories, then test raw prose context growth separately. After a swipe or branch load, verify that both the chat summary and LPE snapshot represent the selected branch.

### 6. Treat iframe viewport sizing as a feedback-loop problem

**Why the legacy pattern breaks:** `vh` is a viewport unit, not `vh%`. Inside an auto-sizing iframe, content expressed in `100vh` can depend on the frame height that the content itself is trying to change. Together with `ResizeObserver`, that dependency can cause runaway growth. Percentage heights with no definite containing height can also collapse or behave differently than in a standalone page.

**The LPE pattern:**

- Size panels from their content. Use normal flow, intrinsic sizing, sensible `max-width`, wrapping controls, and scrollable inner regions for genuinely bounded content.
- LPE rewrites numeric `vh` values inside `<style>` blocks to `calc(var(--lpe-vh, 600px) * fraction)` to break the auto-height feedback loop. This is a compatibility guard, not a reason to design around viewport-dependent cards.
- Automatic resize observation is pre-wired. Use `LPECard.resize(height)` only when a panel has a specific measurement need; the template demonstrates measuring content including body padding.
- Test long text, narrow mobile widths, modals, expanded sections, and error messages—not just the initial panel height.
- Every in-chat panel runs in a Blob-URL iframe with `sandbox="allow-scripts"` only. Replace host access, browser storage, forms, external resources, and automatic sends with `window.LPECard` and the confirmation flow described below.

## Part II — Practical guide for card creators

### Step 1: Define the playable promise before writing fields

Write one sentence describing what the player repeatedly does and why it is interesting. Then draft four short layers:

1. **World causality:** What material, historical, or social facts make this setting behave differently?
2. **Character causality:** What formed each important character, what do they want now, how do they pursue it, and what would change their behavior?
3. **Player relationship:** Why is the player present, what can they change, and what does the cast want from them?
4. **Rules that create decisions:** Which resources, risks, constraints, or progression mechanics alter choices? Avoid tracking values that never affect narration or options.

A useful self-check is whether each major entry contains at least one “because X, therefore Y,” supports an unscripted situation, and remains intelligible without a list of personality adjectives.

### Step 2: Write the opening as the first playable turn

Put the opening in `first_mes` and make it establish:

- who is present and their immediate relationship to the player;
- where and when the scene occurs;
- the desired prose rhythm, sensory detail, dialogue style, and viewpoint;
- a concrete situation rather than a biography dump;
- an impending conflict, meaningful choice, or emotional question left open.

End before the interesting decision is resolved. If later responses have the wrong voice, revise this example before adding more personality labels. For replayable cards, use alternate greetings or genuinely different opening templates rather than one opening with many unrelated branches. If an opening panel initializes variables, ensure every greeting has a compatible initialization path.

### Step 3: Make a state-ownership map

Create a table with `Field`, `Changes when`, `Owner`, `Read path`, and `Writer`. Use this starting point:

| Need | Preferred owner | Read / display |
|---|---|---|
| Room, map, time, weather, NPC position | LPE world / Atlas | `getlpe('world.loc')`, `LPECard.getState().locations`; native 3D/2D Atlas |
| Injury, bleeding, pain, scar, disease | LPE Health Doll via `health_delta` | `getlpe('health.overallHp')`, `lpe.health.*`, bridge health snapshot |
| Items, money, equipment | LPE inventory | Native state / HUD |
| NPC identity, mood, memory, thoughts, bonds | LPE entity / pair systems | Native state / HUD |
| Plot thread, arc, Chekhov setup, notes | LPE narrative state | Native state / HUD |
| Business, estate, faction, ship ledger | LPE Custom Tracker | `getlpe('custom_trackers...')`, bridge snapshot |
| Sanity, mana, class XP, card-specific sequence | `card_vars` | `getvar`, `lpe`-independent card macros, `LPECard.getVar` |

Track only values that change and matter. Define ranges, initial values, normal delta sizes, and transition rules in author notes or deterministic rules. Do not seed native LPE state again inside `card_vars` merely to make it visible in a panel; panels can read the sanitized LPE snapshot.

For chat persistence, put a JSON object in a World Info entry named `[InitVar]` or `[LPEInitVar]`, normally under `stat_data`. Seeding fills an empty chat's variables; it is not a per-turn reset. Keep the seed and every lookup/write path synchronized.

### Step 4: Assign prose, deltas, and deterministic rules to different jobs

- **Main model:** narration, dialogue, dramatic choices, and the terminal LPE receipt.
- **LPE Clerk:** semantic state changes after the reply, as minimal JSON deltas.
- **Reducers / native UI:** calculations, canonical persistence, diffs, Atlas, Health Doll, inventory, trackers, and journal.
- **Scoped EJS:** card-specific prompt-time logic such as dice pools, thresholds, and conditional rule text.
- **Panel JavaScript:** local presentation and explicit user interactions, with persistent card changes sent through `LPECard.patchVars`.

Do not require the main model to emit `<UpdateVariable>`, full `<internal_states>`, Atlas HTML/CSS, or Health Doll arithmetic. Keep EJS within its safety and loop budgets, wrap loop bodies in braces, and remember that browser globals and network APIs are unavailable in prompt EJS.

### Step 5: Choose the least expensive UI architecture

| Architecture | Choose it when | Constraints |
|---|---|---|
| Plain story + native LPE HUD | Atlas, Health Doll, inventory, trackers, and state diffs already express the game | Least card code; no custom interaction required |
| Sandboxed LPE card panel | The card needs origin setup, compact controls, a special HUD, or clickable actions | Use `window.LPECard`; no host globals, storage, forms, network, or external CDN by default |
| Standalone web frontend | The product must be independent of SillyTavern and needs a wholly custom shell | You must rebuild prompting, persistence, branching, security, and state integration; `LPECard` is not magically available |

A frontend should improve readability, choices, pacing, or immersion—not merely decorate the story. Avoid rebuilding the native Atlas or Health Doll inside a panel when linking the player to LPE's existing UI is enough. If several panels coexist, scope DOM queries to each panel instead of relying on global IDs across documents, and unsubscribe reactive listeners when tearing down custom mounts.

For an in-chat panel, keep the document self-contained, use `--lpe-*` theme variables, use `<button type="button">`, and prefer well under the renderer's 2 MB pause threshold. `LPECard.submitInput(text)` stages a one-click confirmation by default; `fillInput(text)` only fills the composer. Leave Auto-send off during verification.

### Step 6: Use Creator Studio for design review, then the kit for implementation

**ST-LPE-Creator-Studio** is the design-entry and optional AI-review workflow:

1. Open **Card Making** and enter a title plus custom notes containing the premise, causal constraints, tone, and non-negotiable mechanics.
2. Select only relevant components: World & premise, Characters, Rules & mechanics, Opening scene, Interactive UI, and Status tracker.
3. Submit the card request. The request is saved before any review request is made.
4. Choose **Skip Review**, or select review focuses such as character depth, mechanics, opening playability, or UI readability and explicitly **Queue AI Review**. Review uses the connected SillyTavern generation API.

Creator Studio produces and reviews a card request/draft; it is not a deterministic PNG packer, migration runner, or proof that generated code is sandbox-safe. Turn the reviewed design into concrete fields and code with **LPE's** `templates/lpe-card-template/`, then run the gates below. Keep the two projects' roles separate.

### Step 7A: Build a new panel with the LPE authoring kit

From the LPE repository root, using Node.js 22+:

```sh
node templates/lpe-card-template/build.mjs
```

1. Edit `templates/lpe-card-template/src/panel.html`, `panel.css`, and `panel.js`. Preserve the `LPE_STYLES` and `LPE_SCRIPT` markers.
2. Use `src/tokens.css` and `types/lpe-card.d.ts`. Read state through the bridge, subscribe to changes, and write explicit `card_vars` paths.
3. Open `templates/lpe-card-template/preview/index.html` and exercise every interaction with mock data. Check variable changes, queued actions, confirmation behavior, resizing, and narrow layouts.
4. Copy the built `dist/card-panel.html` into a fenced `html` block in the greeting or a targeted regex replacement. Keep the complete document and the appropriate LPE screen marker.

For multiple panels, use separate source directories and explicit output files as shown in the [authoring kit README](../../templates/lpe-card-template/README.md).

### Step 7B: Adapt an existing card with the migration workflow

Work on a copy of the source PNG and keep the original unchanged. From the LPE repository root:

```sh
node templates/lpe-card-template/migration/extract-and-partition.mjs --input "./source.png" --work-dir "./card-work" --batch-kb 35
```

1. Review `raw_card.json`, the initial audit, core fields, World Info batches, regexes, and the UI manifest.
2. Lock `migration_plan.json` before editing. Map variable keys atomically, broad triggers, state owners, and optional localization terms.
3. Move native domains to LPE, retain card-specific values in `card_vars`, and convert prompt logic to scoped EJS.
4. Rebuild each extracted frontend against `LPECard`, then put it back at its manifest-mapped source field. Remove obsolete extension scripts rather than leaving two systems active.
5. Pack and audit:

```sh
node scripts/pack-card.mjs --parts --src "./source.png" --work "./card-work" --out "./migrated.png"
node scripts/audit-card.mjs "./migrated.png" --out "./card-work/audit_after.json"
node scripts/verify-ejs-headless.mjs "./migrated.png" --json
```

Follow the complete [migration workflow](../../templates/lpe-card-template/migration/MIGRATION_WORKFLOW.md), especially pointer and replacement-order rules.

### Step 8: Pass offline and isolated live gates

Run only on card code you trust. The static audit must report **0 BLOCKERs**. Review warnings rather than assuming they are harmless: they cover unresolved variables, generic triggers, oversized payloads, and other release risks. The audit is not a substitute for semantic trigger tests.

The headless validator compiles primary, alternate, and group greetings plus enabled World Info EJS and evaluates each at mock turns 0, 1, and 2 with deterministic RNG and read-only variable writes. Require `ok: true` and `passed === checked`. `checked: 0` means no applicable EJS was found; it is not evidence that UI JavaScript or non-EJS rules work. Neither offline gate proves Clerk output, real lorebook activation, iframe interaction, or swipe persistence.

For a live check, use **only** `D:\open-terminal\workspace\Projects\Test-playground\SillyTavern` on port **8010**. Never use port 8000. Start that isolated copy with:

```sh
node server.js --port 8010 --browserLaunchEnabled false --listen false
```

Enable native LPE, EJS, and the renderer; disable EJS/renderer auto-yield, renderer External Resources, and renderer Auto-send for the strict check. In a fresh chat verify:

1. **Turn 0:** greeting and opening panel render; variables seed once; panel actions persist intended values and queue rather than auto-send; height is stable; console and CSP errors are 0.
2. **Turn 1:** submit an action; intended World Info activates; main output closes with `<lpe_tail>` and `<!-- GFX_END -->`; Clerk updates the intended native state and HUD; no duplicate status language appears.
3. **Turn 2 and long-chat checks:** swipe and reload preserve the selected `(lpe_uid, lpe_seq)` snapshot, `card_vars`, and panel behavior. Revisit an old location/NPC to test Smart Scoping, and check that ordinary prose history still has an appropriate summary/context strategy.
4. **Responsive and failure cases:** test narrow mobile layout, expanded content, empty/missing values, invalid input, and a failed worker response without losing the story or duplicating state.

Use temporary verification files only under the isolated playground's `_tmp/`, keep credentials out of logs and the repository, stop every spawned test process, restore modified test data, and remove `_tmp/` afterward. Finally run LPE's repository regression suite:

```sh
node --test test/*.test.mjs
```

A card is ready only when its offline gates, isolated Turn 0–2 behavior, and the regression suite all pass.
