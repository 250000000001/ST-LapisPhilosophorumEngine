# ST-VexaStateEngine

External state engine, swipe-safe journaled store, secondary API worker ("Vexa Clerk"), interactive SVG Atlas map, inline editor, and native themed HUD for SillyTavern Vexa presets.

## What It Does

Vanilla Vexa emits all 16 `<internal_states>` XML sections at the end of every reply (~35 KB / ~9k–10k output tokens per turn, ~87% of total output). **Vexa State Engine** splits that workload into three layers:

1. **Lean Main Model (`<vexa_tail>` + `<!-- GFX_END -->`)**:
   - The main model outputs only `[🕰️ ...]` Time Header, story prose, Colored Dialogue, optional GFX/Props, and a compact terminal `<vexa_tail>` containing `<vexa_receipt>` (`world_sim`, `chekhov`, `arc`, `ooc`) and `<state:vent>` followed by `<!-- GFX_END -->`.
2. **Deterministic JS Engine (`src/reducer.js` + `src/store.js`)**:
   - Stored per chat & branch inside `chat_metadata.vexa_state` with swipe-safe `(vexa_uid, vexa_seq)` stamps.
   - Deterministically handles `ct++`, `<header>` syncing, prose `<color>` locking, Atlas `bbox` calculation + AABB overlap validation + atomic occupant moves, Chekhov `fired` clearing & `age+1` aging, Notebook `[R]` rule pinning & `[R]/[T]/[D]` 20-cap, and Aether Matrix `[3..20]` / `±2` clamping.
   - Includes `importFromChat()` (auto-imports on chat open or one-click button) to migrate existing vanilla Vexa chats cleanly.
3. **Post-Reply Worker API ("Vexa Clerk")**:
   - Runs automatically after the integrated Refusal Auto-Retry guard (or standalone `ST-VexaRefusalAutoRetry`) accepts the reply.
   - Supports **Direct OpenAI-Compatible Endpoints** (via SillyTavern's `ChatCompletionService.processRequest` reverse-proxy path so zero CORS issues) and **SillyTavern Connection Profiles** (`ConnectionManagerRequestService.sendRequest`, zero profile switching).
   - Emits compact JSON deltas (omitting unchanged rooms, dormant NPCs, and unchanged pairs).
4. **Integrated Refusal Auto-Retry & Non-Stream Continue (Toggleable)**:
   - Built directly into **Extensions → Vexa State Engine** (`Enable built-in Refusal Auto-Retry & End-Marker Guard`), with **Continue (No Stream)** send-bar/options controls, surgical safety-refusal cleanup, end-marker validation (`auto` / `external` / `classic` / `marker`), and custom refusal regex patterns. Standalone `ST-VexaRefusalAutoRetry` is no longer required when this toggle is enabled.
5. **Native JS Tabbed HUD, PolyCSS 3D Atlas Map & Megumin-Style Control Center**:
   - Never mutates `msg.mes`; renders a collapsible 16-tab themed card under each message with diff dots and an interactive **PolyCSS 3D CSS** Atlas map (`src/polyCss3d.js` + `src/atlas3d.js`, with a 1-click toggle to classic **2D SVG** floorplans).
   - Pure CSS `matrix3d(...)` polygon engine supports 10 3D primitives (`box`, `cylinder`, `cone`, `wedge`, `stairs`, `sphere`, `plane`, `arch`, `octahedron`, `ring`), multi-floor vertical stacking (`All Floors`), cutaway walls, pointer orbit/pan + wheel zoom, auto-inferred props from room `features`, and worker-supplied JSON `objects` / `add_objects` / `remove_objects` deltas.
   - Includes a draggable floating compass launcher (`#vse_fab_btn`) and frosted-glass **Vexa Control Center** popup (`#vse_app_overlay`) featuring character banner artwork, left glass dock (collapsible floating pill bar on mobile), live token readout, interactive 3D/2D Atlas & object builder, state inspection/editing across all tabs, worker & refusal-retry configuration, visual theme swatches, and raw snapshot/JSON tools.
6. **Main-Model-Proposed Custom Trackers (Toggleable)**:
   - When enabled, the main story model can optionally propose recurring multi-field trackers (e.g. a business, estate, ship, or debt ledger) via `tracker_propose:` inside `<vexa_receipt>`.
   - Proposals can be approved/edited/dismissed in 1 click from the HUD or Control Center (or auto-accepted via toggle). Once active, the background worker can only update values of those locked field keys — zero key drift and 0 prompt tokens when no custom trackers exist.

## Modified Preset

Generated from `/home/user/Projects/myVexapreset/ST.+.Tavo.Vexa.v1.0 (Dynamic World).json` via:

```bash
node scripts/build-preset.mjs
```

Preset output:
- `Presets/ST.+.Tavo.Vexa.v1.0 (Dynamic World - External State).json`

## Running Tests

Offline parser, reducer, store, and prompt injector tests (using the 36-turn ASOIAF chat fixture):

```bash
node --test test/parser-roundtrip.test.mjs test/reducer-store.test.mjs
```

Live OpenAI-compatible worker + preset contract tests (never commit keys):

```bash
VEXA_TEST_BASE_URL=https://linkapi.ai/v1 \
VEXA_TEST_API_KEY="sk-..." \
node --test test/live-worker.test.mjs
```

## License

Licensed under the [MIT License](LICENSE).
