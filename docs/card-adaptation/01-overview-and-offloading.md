# 01 — Overview & Offloading Architecture

`ST-VexaStateEngine` separates **canonical world/scene state** (owned by Vexa Clerk + Vexa's deterministic JS reducers) from **card-specific RPG variables & UI screens** (`card_vars`, scoped EJS, and sandboxed Blob-URL iframes). When adapting a heavy multi-system card (especially Chinese MVU / `TavernHelper` cards), avoid duplicating state in both systems.

---

## 1. Pure Vexa Mode Contract

1. **Main Story Model Output:**
   - Prose (with optional `[🕰️ ... | 🗓️ ... | 📍 ... | ...]` time header and colored dialogue tags).
   - Optional fenced `\`\`\`html` UI strip or injected card widget (rendered via `cardRenderer.js`).
   - Terminal external-state tail:
     ```xml
     <vexa_tail>
     <vexa_receipt>
     world_sim: ...
     chekhov: ...
     arc: ...
     ooc: ...
     tracker_propose: ... (optional)
     </vexa_receipt>
     <state:vent>...</state:vent>
     </vexa_tail>
     <!-- GFX_END -->
     ```
   - Never ask the main model to emit `<UpdateVariable>`, `<internal_states>`, `<gametxt>`, `<action>`, or `<wlog>` blocks—`ST-VexaStateEngine` strips historical `<internal_states>` / `<vexa_tail>` blocks on outgoing prompts (`promptInjector.js`) and delegates extraction to Vexa Clerk (`workerPrompt.js`).

2. **Secondary Worker ("Vexa Clerk") Output:**
   - Inspects the latest exchange + `<main_model_receipt>` + `<main_model_vent>` and emits a minimal JSON delta (`world`, `onscreen`, `offscreen_agendas`, `locations`, `entity_state`, `entityMem_append`, `thoughts`, `dam_delta`, `pair_delta`, `tracks`, `arc`, `chekhov_delta`, `inv`, `health_delta`, `story_notes`, `notebook_append`, `custom_trackers_patch`).

---

## 2. State Ownership: What Offloads vs. What Stays in `card_vars`

| Domain / System | Owner | Mechanism |
|---|---|---|
| Geography, rooms, 3D/2D map props, NPC positions, time/weather | **Vexa Native** | `world` + `locations` (Hybrid WebGL / PolyCSS / 2D SVG Atlas) |
| Physical injuries, bleeding, pain, scars, prosthetics, diseases | **Vexa Native** | `health_delta` (Anatomical Health Doll, 27 body parts; read in EJS via `getvexa('health.bloodLoss')`, `getvexa('health.pain')`, `getvexa('health.overallHp')`) |
| Weapons, armor, sealed artifacts, consumables, money | **Vexa Native** (plus optional summary) | `<state:inv>` / `inv` |
| NPC appearance, locked dialogue color, episodic memory, thoughts | **Vexa Native** | `entity_state`, `entityMem`, `thoughts` |
| Relationships, emotional sluices & walls | **Vexa Native** | `pair` (Aether Matrix), `dam` (Aether Dam) |
| Plot threads, Chekhov bullets, story arcs, OOC notes | **Vexa Native** | `tracks`, `arc`, `chekhov`, `story_notes`, `notebook` |
| Card-specific RPG progression (Pathway/Sequence, Digestion %, Spirituality, Sanity, Humanity, Luck, Sefirah choice) | **`card_vars`** (+ optional `tracker_propose`) | `[InitVar]` seeds `chat_metadata.vexa_state_v1.cardVars`; readable via `getvar(...)`, `{{get_card_var::...}}`, and `window.VexaCard` |
| Recurring multi-stat enterprises/ledgers/factions/estates | **Vexa Custom Trackers** | Proposed by main model via `tracker_propose: Title \| k1=v1, k2=v2 \| reason`, patched by Vexa Clerk via `custom_trackers_patch` |

---

## 3. Clean Separation Rules

- **No Dual Bookkeeping:** Remove prose instructions telling the AI to maintain redundant JSON/YAML NPC rosters, room lists, inventory trees, or MVU `<UpdateVariable>` patches when Vexa already tracks them natively.
- **Keep Domain Math Deterministic:** Pre-turn dice pools, logarithmic luck curves, low-sanity threshold whispers, and blood-loss trauma penalties belong in scoped EJS World Info entries reading `card_vars` (`getvar`) and Vexa state (`getvexa`).
- **Auto-Yield Awareness:** During native Vexa runs, ensure `ejsAutoYield` and `rendererAutoYield` do not unexpectedly hand execution back to legacy `ST-Prompt-Template` / `JS-Slash-Runner` when Pure Vexa Mode is intended.
