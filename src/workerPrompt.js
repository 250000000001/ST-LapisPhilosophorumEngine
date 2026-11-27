/**
 * Builds lean, structured delta-extraction prompts for LPE's secondary worker ("LPE Clerk").
 * Supports combined 1-call mode (default) and optional 2-call split mode.
 *
 * Pure ES module with zero DOM dependencies.
 */

import { normalizeBraille, stripGfxBlocks, extractStoryProse } from './schema.js';
import { serializeCompactForWorker } from './parser.js';
import { SKETCHFAB_ASSETS } from './sketchfabAssets.js';

const sketchfabShapes = Object.keys(SKETCHFAB_ASSETS);
const sketchfabPrompt = sketchfabShapes.length
    ? `\n   - Additional WebGL props: ${sketchfabShapes.map((id) => JSON.stringify(id)).join(', ')}.`
    : '';

const SYSTEM_BASE = `You are LPE Clerk, a precise background simulation state-tracker for a gritty, uncensored fictional RPG.
Your ONLY job is to inspect the latest story exchange and emit a minimal JSON DELTA updating the world simulation state.

CRITICAL OUTPUT RULES:
1. Output ONLY one valid JSON object. No markdown fences, no commentary before or after. Keep internal reasoning brief and emit compact minified JSON (no pretty-printing whitespace). For large ensembles (10+ active NPCs), keep per-NPC "agenda", "why", and "move" crisp (1 short sentence each) so the output never truncates.
2. DELTA-ONLY: Omit any top-level key that did NOT change this turn. Never copy forward unchanged rooms, unchanged entity_state rows, dormant off-screen NPCs, or unchanged relationship pairs.
3. STRICT EPISTEMIC SANITY (<knowledge_sanity>): Characters ONLY know facts they witnessed in 120° LOS, heard within earshot, were told, or read via message/evidence. Never leak secrets or off-screen facts into thoughts/entityMem of characters who lack a vector.
4. ATLAS INTEGRITY: Room grid MUST be string "[X,Y,Z]" where X,Y are 5m integer multiples and Z is integer floor index (0=ground, 1=upper, -1=cellar — NOT height in meters). Dim is "WxDxHm" where H is ceiling height in meters (e.g. "20x15x8m" for a high atrium). Optional room "elev" is vertical floor offset in meters within that level (e.g. 1.5 for a raised dais, -1.2 for a sunken pit). Format exits as "N:room_id [x,y] | Up:room_id", adj as "N:..., S:..., E:..., W:..., Up:..., Down:...", and occupants / user_pos as "Name [x,y]" or "Name [x,y,z]" (use 3D [x,y,z] when someone stands above floor level on a raised platform/catwalk). Never overlap existing rooms on the same floor, never drop/relocate existing rooms, and use move_occupants for movement.
5. 3D ATLAS OBJECTS (Hybrid WebGL + PolyCSS Engine — NEVER emit CSS or HTML):
   The UI renders Atlas rooms and props automatically in 3D with unified doorway cutouts, shadows, glow pools, and textured 3D kits. You ONLY supply compact JSON descriptors:
   - Optional room "style": "indoor" | "outdoor" | "tower" | "cave" | "water" | "wagon" | "industrial" | "scifi".
   - Optional room "objects" (on new_rooms, 2-12 key landmarks) or "add_objects" / "remove_objects" (on patch_rooms ONLY when props are added, moved, revealed, or destroyed):
     { "shape": "...", "pos": [x,y] or [x,y,z], "size"?: [w,d,h], "rot"?: deg, "color": "material_or_#hex", "label": "Short Name" }
   - GROUNDING & NO-DUPLICATE RULES (CRITICAL):
     * "pos" is room-local meters from NW floor corner [0,0,0] (X=0..W east, Y=0..D south, Z=0 floor). "pos[2]" is ALWAYS BOTTOM-CENTER elevation (use 0 for anything standing on the floor — NEVER set pos[2] = height / 2! Putting a 4m tall prop at pos:[10,0.4,2] makes it float 2m off the floor!).
     * NEVER add outer room perimeter walls as "box" objects (e.g. "North Tank Wall", "South Wall") and NEVER add extra "airlock" or "arch" objects on doorways already listed in "exits" — the engine renders room walls and ONE unified doorway cutout per exit connection automatically. Use "platform" with pos:[x,y,z] (z>0) for mezzanines, catwalks, balconies, raised stages, or sunken walkways.
   - Give repeated props unique labels (e.g. "Oak Chair 1", "Oak Chair 2").
   - Diorama & Textured 3D Prefabs (29 — rendered with bundled WebGL GLB kits + composite PolyCSS models):
     "table", "chair", "couch", "bed", "bookshelf", "desk", "hearth", "brazier", "lamp", "chest", "tree", "crystal", "ladder", "hourglass", "container", "barrel", "crate", "dumpster", "generator", "pallet", "propane", "pipes", "locker", "vat", "console", "cabinet", "airlock", "screen", "platform".${sketchfabPrompt}
   - Geometric Primitives (10 — for custom architectural props & furniture):
     "box" (interior divider, barricade, pedestal — NOT outer room perimeter walls!), "cylinder" (pillar, well, cauldron, tub), "cone" (flame, tent, spire), "wedge" (ramp, sloped roof), "stairs" (staircase), "sphere" (boulder, bush), "plane" (pond, grate, blood), "arch" (standalone ruined archway NOT on an exit), "octahedron" (floating shard/beacon), "ring" (fire-ring, stone circle).
   - "size" is [width, depth, height] in meters.
   - Material colors: "wood", "dark_wood", "stone", "dark_stone", "ice", "snow", "water", "iron", "gold", "copper", "fire", "cloth", "leather", "grass", "pine", "earth", "bone", "blood", "magic", "glass" (or #RRGGBB).
   - Example: [{"shape":"platform","pos":[10,2,3.5],"size":[16,2.5,0.25],"color":"iron","label":"Upper Catwalk"},{"shape":"stairs","pos":[3,4,0],"size":[1.6,4.5,3.5],"color":"iron","label":"Catwalk Stairs"},{"shape":"table","pos":[8,8,0],"size":[2.2,1.3,0.9],"color":"wood","label":"Council Table"}]
6. IMMUTABLE DIALOGUE COLORS: Never change an existing entity's fontColor. For a brand-new named NPC, pick an unused color from availableColors (or match proseColorsDetected).
7. RESPECT MAIN-MODEL RECEIPT: Honor any world_sim outcome, fired Chekhov bullets, arc updates, and OOC directives listed in <main_model_receipt>.
8. PERSONA BODY HEALTH (Nice Health System): Omit "health_delta" completely unless the user persona suffers, heals, tends, or changes an injury, bleeding, scar, fracture, burn, frostbite, disease, toxin, hypothermia/heatstroke, exhaustion, missing part, or prosthetic this turn — OR unless a visible healed scar, missing part, or prosthetic mentioned in the scene is not yet recorded in current_state_json.health (add scars via add_conditions with kind:"scar", scar:true, severity:10). Valid part IDs: head, left_eye, right_eye, neck, torso, left_shoulder, right_shoulder, left_arm, right_arm, left_hand, right_hand, left_leg, right_leg, left_foot, right_foot, brain, heart, left_lung, right_lung, stomach, liver, left_kidney, right_kidney, skull, ribcage, spine, pelvis. Valid condition kinds: sharp, blunt, burn, frost, bleeding, fracture, infection, toxin, scar, other. Severity is 1-100; JS auto-computes part HP, pain, and capacities.
9. PLAYER vs NPC BOUNDARY (CRITICAL): The human user persona (identified in <player_identity> and labeled [USER / PLAYER] in <latest_exchange>) is controlled EXCLUSIVELY by the human player — NEVER treat the user persona as an AI NPC or storyteller entity.
   - NEVER place the user persona in "onscreen", "offscreen_agendas", "entity_state", "entityMem_append", "thoughts", or room "occupants" / "move_occupants" (record the player's location ONLY via world.room and world.user_pos).
   - DO keep the user persona as the named human participant in "dam_delta" (e.g. "NPC->{{user}}"), "pair_delta" (e.g. "NPC↔{{user}}"), and "health_delta".
10. ESTABLISHED / PRE-STAGED CAST: Preserve and reuse established NPCs already present in current_state_json.entity_state or offscreen_agendas (especially staged/manual/pinned entries) instead of inventing redundant duplicate characters. Do not overwrite established look/voice/persona/private layers with empty text, and move staged characters cleanly from offscreen_agendas into onscreen once they appear in the scene.`;

const COMBINED_SCHEMA_GUIDE = `Return a JSON object containing ONLY the keys that changed this turn:
{
  "world": { "loc"?, "time"?, "date"?, "weather"?, "room"?, "user_pos"?: "[x,y] or [x,y,z]", "entries"?, "obstacles"?, "audio"?, "pacing"?: "SLOW|FLOW|PUSH" },
  "onscreen": [ { "name", "parrott": "ParrotEmotion:[Primary->Secondary->Tertiary] | [Low|Med|High]", "residualMood": "res:[mood] | [target] | [age]", "tfdy": "T# F# D# Y# (with optional ↑/↓)", "salience": "sal:#", "agenda", "why", "end", "move" } ],
  "offscreen_agendas": [ { "name", "loc", "agenda", "why", "goal", "end", "mood", "tfdy": "T# F# D# Y# | IW#", "salience": "sal:#" } ],
  "locations": {
    "set_active"?: { "active_map_id", "active_level" },
    "new_maps"?: [ { "id", "name", "levels": [{"z":"0","name":"..."}], "main_exit": "room_id [X,Y,Z]" } ],
    "new_rooms"?: [ { "id", "map_id", "name", "dim": "15x15x5m", "elev"?: 0, "grid": "[X,Y,Z]", "style"?: "indoor|outdoor|tower|cave|water|wagon|industrial|scifi", "anchor", "features", "objects"?: [ { "shape": "table|chair|couch|bed|bookshelf|desk|hearth|brazier|lamp|chest|tree|crystal|ladder|hourglass|container|barrel|crate|dumpster|generator|pallet|propane|pipes|locker|vat|console|cabinet|airlock|screen|platform|box|cylinder|cone|wedge|stairs|sphere|plane|arch|octahedron|ring", "pos": [x,y,0], "size"?: [w,d,h], "rot"?: 0, "color": "wood", "label": "..." } ], "adj", "occupants": "Name [x,y] | Name2 [x,y,z]", "exits" } ],
    "patch_rooms"?: [ { "id", "dim"?, "elev"?, "style"?, "features"?, "add_objects"?: [...], "remove_objects"?: ["label"], "adj"?, "exits"?, "occupants"? } ],
    "move_occupants"?: [ { "name", "to_room", "pos": "[x,y] or [x,y,z]" } ]
  },
  "entity_state": { "upsert": [ { "name", "fontColor": "color #HEX", "look", "voice", "persona", "private" } ] },
  "entityMem_append": [ { "name", "mem": "fact | T:timestamp | V:WITNESSED|TOLD_BY|EVIDENCE|MESSAGE|COMMON|OVERHEARD|GOSSIP|INFERRED | C:CERTAIN|PARTIAL|UNCERTAIN|FALSE" } ],
  "thoughts": [ { "name", "tQ1": "first-person goal", "tQ2": "feeling about what happened", "tQ3": "where mind is", "tQ4": "why I care", "tQ5": "if I could speak my mind" } ],
  "dam_delta": [ { "pair": "NPC->Target", "sluice": "E:sealed|open L:sealed|open", "filters": "Soc:.. Val:.. Comp:.. Rel:..", "misc": "clash:— | T:no", "intent": "intent:..." } ],
  "pair_delta": [ { "names": "NPC↔Target", "mode": "mode:...", "dam": "E:s|o L:s|o Gate:...", "matrix": "🌶️[v,a] 🎲[v,a] 🤝[v,a] 🛠️[v,a] 🏠[v,a] 🕊️[v,a] 😠[v,a] 🥊[v,a] ❄️[v,a] 🪨[v,a] 🌫️[v,a] 🐍[v,a]", "wall": "wall:∅" } ],
  "tracks": { "main"?, "tracks"?: ["..."], "add_history"?: ["..."] },
  "arc": { "info"?, "timeline"?, "ki"?: ["..."], "sho"?: ["..."], "ten"?: ["..."], "ketsu"?: ["..."] },
  "chekhov_delta": { "fire"?: ["bullet desc"], "unlock"?: ["bullet desc"], "add_chamber"?: ["desc | w# age0"], "add_locked"?: ["desc | w# age0 [lock]"], "prune"?: ["desc"] },
  "inv": { "inv"?, "titles"?, "status"? },
  "health_delta"?: { "bodyType"?: "male|female|athletic|heavy", "bloodLoss"?: 0, "tend_all"?: true, "full_heal"?: true, "add_conditions"?: [{ "part": "left_arm", "kind": "sharp|blunt|burn|frost|bleeding|fracture|infection|toxin|scar|other", "label": "Deep Slash", "severity": 40, "bleeding"?: true, "treated"?: false, "scar"?: false, "note"?: "..." }], "patch_conditions"?: [{ "part"?: "left_arm", "label": "Deep Slash", "severity"?, "bleeding"?, "treated"?, "scar"? }], "heal_conditions"?: [{ "part"?: "left_arm", "label": "Deep Slash" }], "set_parts"?: { "part_id": { "missing"?: true, "prosthetic"?: "Clockwork Hand", "armor"?: "Steel Pauldron" } }, "whole_body_upsert"?: [{ "type": "disease|toxin|malnutrition|hypothermia|heatstroke|exhaustion|intoxication|bleeding|buff|other", "label": "...", "severity": 35, "treated"?: false }], "whole_body_remove"?: ["label"] },
  "story_notes": { "threads", "seeds", "motives", "horizon", "GremlinNote", "heckle" },
  "notebook_append": [ "[R|T|D] concise entry" ]
}
Notes:
- "onscreen": list ONLY currently present on-screen NPCs (replaces onscreen roster for this turn).
- "offscreen_agendas": list ONLY off-screen NPCs whose agenda/location/mood changed or ticked forward; dormant NPCs omitted remain preserved.
- "chekhov_delta": JS automatically clears prior fired bullets and increments surviving age#; only list newly fired/unlocked/added/pruned bullets!
- "notebook_append": log "[D] world_sim (ct=...): ..." summary and any "[R] ..." OOC directive.`;

const SPATIAL_ENTITY_SCHEMA_GUIDE = `Return a JSON object containing ONLY the SPATIAL, ENTITY, AETHER, & INVENTORY keys that changed this turn:
{
  "world"?: { ... },
  "onscreen"?: [ ... ],
  "offscreen_agendas"?: [ ... ],
  "locations"?: { "set_active"?: { "active_map_id", "active_level" }, "new_maps"?: [ { "id", "name", "levels": [{"z":"0","name":"..."}], "main_exit"?: "room_id [X,Y,Z]" } ], "new_rooms"?: [ { "id", "map_id", "name", "dim": "15x15x5m", "elev"?: 0, "grid": "[X,Y,Z]", "style"?: "indoor|outdoor|tower|cave|water|wagon|industrial|scifi", "features", "objects"?: [ { "shape": "table|chair|couch|bed|bookshelf|desk|hearth|brazier|lamp|chest|tree|crystal|ladder|hourglass|container|barrel|crate|dumpster|generator|pallet|propane|pipes|locker|vat|console|cabinet|airlock|screen|platform|box|cylinder|cone|wedge|stairs|sphere|plane|arch|octahedron|ring", "pos": [x,y,0], "size"?: [w,d,h], "rot"?: 0, "color", "label" } ], "adj": "N:..., Up:...", "occupants": "Name [x,y] | Name2 [x,y,z]", "exits": "N:id [x,y] | Up:id" } ], "patch_rooms"?: [ { "id", "dim"?, "elev"?, "style"?, "features"?, "add_objects"?: [...], "remove_objects"?: ["label"], "adj"?, "exits"?, "occupants"? } ], "move_occupants"?: [ { "name", "to_room", "pos": "[x,y] or [x,y,z]" } ] },
  "entity_state"?: { "upsert": [...] },
  "entityMem_append"?: [ { "name", "mem" } ],
  "dam_delta"?: [ ... ],
  "pair_delta"?: [ ... ],
  "inv"?: { ... },
  "health_delta"?: { "add_conditions"?: [{ "part", "kind", "label", "severity", "bleeding"?, "treated"?, "scar"? }], "patch_conditions"?: [...], "heal_conditions"?: [...], "set_parts"?: {...}, "whole_body_upsert"?: [...], "whole_body_remove"?: [...], "bloodLoss"?, "tend_all"?, "full_heal"? }
}`;

const NARRATIVE_SIM_SCHEMA_GUIDE = `Return a JSON object containing ONLY the THOUGHTS, TRACKS, ARC, CHEKHOV, NOTES & NOTEBOOK keys that changed this turn:
{
  "thoughts": [ { "name", "tQ1", "tQ2", "tQ3", "tQ4", "tQ5" } ],
  "tracks"?: { "main"?, "tracks"?, "add_history"? },
  "arc"?: { ... },
  "chekhov_delta"?: { "fire"?, "unlock"?, "add_chamber"?, "add_locked"?, "prune"? },
  "story_notes": { "threads", "seeds", "motives", "horizon", "GremlinNote", "heckle" },
  "notebook_append": [ "[R|T|D] concise entry" ]
}`;

/**
 * Build chat-completion messages for the post-reply worker.
 *
 * @param {object} opts
 * @param {object} opts.prevState
 * @param {string} opts.exchange      Latest user prompt + AI prose
 * @param {string} [opts.earlier]     Short prior context snippet
 * @param {object|null} [opts.receipt] Parsed <lpe_receipt> / <vexa_receipt> from main model
 * @param {string} [opts.vent]        Main model's <state:vent>
 * @param {object|null} [opts.headerParsed]
 * @param {Array} [opts.proseColors]
 * @param {string} [opts.cardHints]   Optional character card / persona snippet on turn 1 or new NPC
 * @param {string} [opts.userName]    Active human player persona name (e.g. "Arthur Blake")
 * @param {'combined'|'split'} [opts.mode='combined']
 * @param {'spatial_entity'|'narrative_sim'|null} [opts.part=null]
 */
export function buildWorkerMessages({
    prevState,
    exchange,
    earlier = '',
    receipt = null,
    vent = '',
    headerParsed = null,
    proseColors = [],
    cardHints = '',
    userName = '',
    extraShapes = [],
    mode = 'combined',
    part = null,
}) {
    const compactState = serializeCompactForWorker(prevState);
    const cleanExchange = extractStoryProse(stripGfxBlocks(normalizeBraille(exchange || '')));
    const cleanEarlier = earlier ? extractStoryProse(stripGfxBlocks(normalizeBraille(earlier))) : '';
    const cleanUserName = String(userName || '').trim();

    const preFacts = {
        next_ct: Number(prevState?.world?.ct || 0) + 1,
        ...(cleanUserName ? { playerName: cleanUserName } : {}),
        headerParsed: headerParsed || null,
        proseColorsDetected: proseColors.map((c) => ({
            color: c.color,
            fontColor: c.fontColor,
            sample: c.dialogue.slice(0, 80),
            near: c.contextAfter.slice(0, 60) || c.contextBefore.slice(-60),
        })),
    };

    let guide = COMBINED_SCHEMA_GUIDE;
    if (mode === 'split' && part === 'spatial_entity') guide = SPATIAL_ENTITY_SCHEMA_GUIDE;
    else if (mode === 'split' && part === 'narrative_sim') guide = NARRATIVE_SIM_SCHEMA_GUIDE;

    const hasActiveTrackers = Boolean(prevState?.custom_trackers?.some((t) => t && !t.archived));
    if (hasActiveTrackers && (mode !== 'split' || part === 'narrative_sim')) {
        guide += `\n- "custom_trackers_patch": OPTIONAL array. ONLY if an active tracker inside current_state_json.custom_trackers changed this turn, emit [{ "id": "<existing_id>", "patch": { "<existing_key>": "<new_value>" }, "notes"?: "..." }]. NEVER create new trackers or invent new field keys; only update values of existing keys.`;
    }

    const userSections = [
        `<current_state_json>\n${JSON.stringify(compactState)}\n</current_state_json>`,
        `<deterministic_prefacts>\n${JSON.stringify(preFacts)}\n</deterministic_prefacts>`,
    ];

    if (cleanUserName) {
        userSections.push(
            `<player_identity>\nHuman Player Persona: ${cleanUserName}\nControl: HUMAN PLAYER ONLY (NOT an AI NPC). Exclude ${cleanUserName} from onscreen, offscreen_agendas, entity_state, entityMem_append, thoughts, and room occupants. Record ${cleanUserName}'s position ONLY in world.room and world.user_pos; keep ${cleanUserName} as the human participant in dam_delta, pair_delta, and health_delta.\n</player_identity>`,
        );
    }

    if (cardHints && cardHints.trim()) {
        userSections.push(`<character_card_context>\n${cardHints.trim().slice(0, 3500)}\n</character_card_context>`);
    }
    if (cleanEarlier) {
        userSections.push(`<earlier_context>\n${cleanEarlier.slice(-2500)}\n</earlier_context>`);
    }
    userSections.push(`<latest_exchange>\n${cleanExchange}\n</latest_exchange>`);

    if (receipt && receipt.raw) {
        userSections.push(`<main_model_receipt>\n${receipt.raw}\n</main_model_receipt>`);
    }
    if (vent && vent.trim()) {
        userSections.push(`<main_model_vent>\n${vent.trim()}\n</main_model_vent>`);
    }

    userSections.push(`<output_schema>\n${guide}\n</output_schema>`);

    const cleanExtraShapes = Array.isArray(extraShapes)
        ? [...new Set(extraShapes.map((s) => String(s || '').trim().toLowerCase()).filter((s) => /^[a-z][a-z0-9_]{0,63}$/.test(s) && !sketchfabShapes.includes(s)))]
        : [];
    const systemPrompt = cleanExtraShapes.length > 0 && (mode !== 'split' || part === 'spatial_entity')
        ? `${SYSTEM_BASE}\n   - Active 3D collection custom shapes: ${cleanExtraShapes.map((id) => JSON.stringify(id)).join(', ')}.`
        : SYSTEM_BASE;

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userSections.join('\n\n') },
    ];
}
