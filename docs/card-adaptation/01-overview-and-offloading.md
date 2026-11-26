# 01 — Overview & Offloading Architecture

`Lapis Philosophorum Engine (LPE)` separates **canonical world/scene state** (owned by LPE Clerk + LPE's deterministic JS reducers) from **card-specific RPG variables & UI screens** (`card_vars`, scoped EJS, and sandboxed Blob-URL iframes). When adapting a heavy multi-system card (especially Chinese MVU / `TavernHelper` cards), avoid duplicating state in both systems.

---

## 1. Pure LPE Mode Contract

1. **Main Story Model Output:**
   - Prose (with optional `[🕰️ ... | 🗓️ ... | 📍 ... | ...]` time header and colored dialogue tags).
   - Optional fenced `\`\`\`html` UI strip or injected card widget (rendered via `cardRenderer.js`).
   - Terminal external-state tail:
     ```xml
     <lpe_tail>
     <lpe_receipt>
     world_sim: ...
     chekhov: ...
     arc: ...
     ooc: ...
     tracker_propose: ... (optional)
     </lpe_receipt>
     <state:vent>...</state:vent>
     </lpe_tail>
     <!-- GFX_END -->
     ```
   - Never ask the main model to emit `<UpdateVariable>`, `<internal_states>`, `<gametxt>`, `<action>`, or `<wlog>` blocks—LPE strips historical `<internal_states>` / `<lpe_tail>` (and legacy `<vexa_tail>`) blocks on outgoing prompts (`promptInjector.js`) and delegates extraction to LPE Clerk (`workerPrompt.js`).

2. **Secondary Worker ("LPE Clerk") Output:**
   - Inspects the latest exchange + `<main_model_receipt>` + `<main_model_vent>` and emits a minimal JSON delta (`world`, `onscreen`, `offscreen_agendas`, `locations`, `entity_state`, `entityMem_append`, `thoughts`, `dam_delta`, `pair_delta`, `tracks`, `arc`, `chekhov_delta`, `inv`, `health_delta`, `story_notes`, `notebook_append`, `custom_trackers_patch`).

---

## 2. State Ownership: What Offloads vs. What Stays in `card_vars`

| Domain / System | Owner | Mechanism |
|---|---|---|
| Geography, rooms, 3D/2D map props, NPC positions, time/weather | **LPE Native** | `world` + `locations` (Hybrid WebGL / PolyCSS / 2D SVG Atlas) |
| Physical injuries, bleeding, pain, scars, prosthetics, diseases | **LPE Native** | `health_delta` (Anatomical Health Doll, 27 body parts; read in EJS via `getlpe('health.bloodLoss')`, `getlpe('health.pain')`, `getlpe('health.overallHp')`) |
| Weapons, armor, sealed artifacts, consumables, money | **LPE Native** (plus optional summary) | `<state:inv>` / `inv` |
| NPC appearance, locked dialogue color, episodic memory, thoughts | **LPE Native** | `entity_state`, `entityMem`, `thoughts` |
| Relationships, emotional sluices & walls | **LPE Native** | `pair` (Aether Matrix), `dam` (Aether Dam) |
| Plot threads, Chekhov bullets, story arcs, OOC notes | **LPE Native** | `tracks`, `arc`, `chekhov`, `story_notes`, `notebook` |
| Card-specific RPG progression (Pathway/Sequence, Digestion %, Spirituality, Sanity, Humanity, Luck, Sefirah choice) | **`card_vars`** (+ optional `tracker_propose`) | `[InitVar]` / `[LPEInitVar]` seeds `chat_metadata.lpe_state.cardVars`; readable via `getvar(...)`, `{{get_card_var::...}}`, and `window.LPECard` |
| Recurring multi-stat enterprises/ledgers/factions/estates | **LPE Custom Trackers** | Proposed by main model via `tracker_propose: Title \| k1=v1, k2=v2 \| reason`, patched by LPE Clerk via `custom_trackers_patch` |

> **Legacy Vexa Compatibility:** LPE automatically migrates `extensionSettings.vexa_state_engine` → `lapis_philosophorum_engine` and `chat_metadata.vexa_state` → `lpe_state` once on load, reads `(vexa_uid, vexa_seq)` stamps alongside `(lpe_uid, lpe_seq)`, and continues accepting `<vexa_tail>`, `<vexa_receipt>`, `{{vexa::...}}`, `getvexa()`, `vexa.*`, `[VexaInitVar]`, `window.VexaCard`, `vexa-card-bridge`, and `--vse-*`.

---

## 3. Clean Separation Rules

- **No Dual Bookkeeping:** Remove prose instructions telling the AI to maintain redundant JSON/YAML NPC rosters, room lists, inventory trees, or MVU `<UpdateVariable>` patches when LPE already tracks them natively.
- **Keep Domain Math Deterministic:** Pre-turn dice pools, logarithmic luck curves, low-sanity threshold whispers, and blood-loss trauma penalties belong in scoped EJS World Info entries reading `card_vars` (`getvar`) and LPE state (`getlpe`).
- **Auto-Yield Awareness:** During native LPE / Magnum Opus runs, ensure `ejsAutoYield` and `rendererAutoYield` do not unexpectedly hand execution back to legacy `ST-Prompt-Template` / `JS-Slash-Runner` when Pure LPE Mode is intended.
