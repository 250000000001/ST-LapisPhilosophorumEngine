/**
 * Builds lean, structured delta-extraction prompts for Vexa's secondary worker ("Vexa Clerk").
 * Supports combined 1-call mode (default) and optional 2-call split mode.
 *
 * Pure ES module with zero DOM dependencies.
 */

import { normalizeBraille, stripGfxBlocks, extractStoryProse } from './schema.js';
import { serializeCompactForWorker } from './parser.js';

const SYSTEM_BASE = `You are Vexa Clerk, a precise background simulation state-tracker for a gritty, uncensored fictional RPG.
Your ONLY job is to inspect the latest story exchange and emit a minimal JSON DELTA updating the world simulation state.

CRITICAL OUTPUT RULES:
1. Output ONLY one valid JSON object. No markdown fences, no commentary before or after. Keep internal reasoning brief and emit compact minified JSON (no pretty-printing whitespace) so output never truncates.
2. DELTA-ONLY: Omit any top-level key that did NOT change this turn. Never copy forward unchanged rooms, unchanged entity_state rows, dormant off-screen NPCs, or unchanged relationship pairs.
3. STRICT EPISTEMIC SANITY (<knowledge_sanity>): Characters ONLY know facts they witnessed in 120° LOS, heard within earshot, were told, or read via message/evidence. Never leak secrets or off-screen facts into thoughts/entityMem of characters who lack a vector.
4. ATLAS INTEGRITY: Room grid MUST be string "[X,Y,Z]" where X,Y are 5m integer multiples and Z is integer floor index (0=ground, 1=upper, -1=cellar — NOT height in meters). Dim is "WxHxHm". Format exits as "N:room_id [x,y] | Up:room_id", adj as "N:..., S:..., E:..., W:..., Up:..., Down:...", and occupants as "Name [x,y] | Name2 [x,y]". Never overlap existing rooms on the same floor, never drop/relocate existing rooms, and use move_occupants for movement.
5. 3D ATLAS OBJECTS (PolyCSS Engine — NEVER emit CSS or HTML):
   The UI renders Atlas rooms and props automatically in 3D CSS. You ONLY supply compact JSON descriptors:
   - Optional room "style": "indoor" | "outdoor" | "tower" | "cave" | "water" | "wagon".
   - Optional room "objects" (on new_rooms, 2-8 key landmarks) or "add_objects" / "remove_objects" (on patch_rooms ONLY when props are added, moved, revealed, or destroyed):
     { "shape": "...", "pos": [x,y] or [x,y,z], "size"?: [w,d,h], "rot"?: deg, "color": "material_or_#hex", "label": "Short Name" }
   - Give repeated props unique labels (e.g. "Bollard 1", "Bollard 2").
   - Allowed shapes (exact names):
     "box" (table, bed, crate, chest, wagon, barricade), "cylinder" (pillar, barrel, well, cauldron, tub), "cone" (flame, tree, tent, spire), "wedge" (ramp, sloped roof), "stairs" (staircase), "sphere" (boulder, bush, lantern, orb), "plane" (rug, pond, grate, blood), "arch" (hearth, gate, doorway), "octahedron" (crystal, beacon), "ring" (fire-ring, stone circle).
   - "pos" is room-local meters from NW corner [0,0,0] (same origin as occupants: X=0..W east, Y=0..D south, Z=0 floor). "size" is [width, depth, height] in meters.
   - Material colors: "wood", "dark_wood", "stone", "dark_stone", "ice", "snow", "water", "iron", "gold", "copper", "fire", "cloth", "leather", "grass", "pine", "earth", "bone", "blood", "magic", "glass" (or #RRGGBB).
   - Example: [{"shape":"box","pos":[8,7],"size":[3,1.4,0.9],"color":"wood","label":"Council Table"},{"shape":"arch","pos":[12,7],"size":[2.2,0.8,2.2],"color":"stone","label":"Pine Hearth"},{"shape":"cone","pos":[12,7,0.2],"size":[0.9,0.9,1.2],"color":"fire","label":"Hearth Fire"}]
6. IMMUTABLE DIALOGUE COLORS: Never change an existing entity's fontColor. For a brand-new named NPC, pick an unused color from availableColors (or match proseColorsDetected).
7. RESPECT MAIN-MODEL RECEIPT: Honor any world_sim outcome, fired Chekhov bullets, arc updates, and OOC directives listed in <main_model_receipt>.`;

const COMBINED_SCHEMA_GUIDE = `Return a JSON object containing ONLY the keys that changed this turn:
{
  "world": { "loc"?, "time"?, "date"?, "weather"?, "room"?, "user_pos"?: "[x,y]", "entries"?, "obstacles"?, "audio"?, "pacing"?: "SLOW|FLOW|PUSH" },
  "onscreen": [ { "name", "parrott": "ParrotEmotion:[Primary->Secondary->Tertiary] | [Low|Med|High]", "residualMood": "res:[mood] | [target] | [age]", "tfdy": "T# F# D# Y# (with optional ↑/↓)", "salience": "sal:#", "agenda", "why", "end", "move" } ],
  "offscreen_agendas": [ { "name", "loc", "agenda", "why", "goal", "end", "mood", "tfdy": "T# F# D# Y# | IW#", "salience": "sal:#" } ],
  "locations": {
    "set_active"?: { "active_map_id", "active_level" },
    "new_maps"?: [ { "id", "name", "levels": [{"z":"0","name":"..."}], "main_exit": "room_id [X,Y,Z]" } ],
    "new_rooms"?: [ { "id", "map_id", "name", "dim": "15x15x5m", "grid": "[X,Y,Z]", "style"?: "indoor|outdoor|tower|cave|water|wagon", "anchor", "features", "objects"?: [ { "shape": "box|cylinder|cone|wedge|stairs|sphere|plane|arch|octahedron|ring", "pos": [x,y,0], "size"?: [w,d,h], "rot"?: 0, "color": "wood", "label": "..." } ], "adj", "occupants", "exits" } ],
    "patch_rooms"?: [ { "id", "style"?, "features"?, "add_objects"?: [...], "remove_objects"?: ["label"], "adj"?, "exits"?, "occupants"? } ],
    "move_occupants"?: [ { "name", "to_room", "pos": "[x,y]" } ]
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
  "locations"?: { "set_active"?: { "active_map_id", "active_level" }, "new_maps"?: [ { "id", "name", "levels": [{"z":"0","name":"..."}], "main_exit"?: "room_id [X,Y,Z]" } ], "new_rooms"?: [ { "id", "map_id", "name", "dim": "15x15x5m", "grid": "[X,Y,Z]", "style"?: "indoor|outdoor|tower|cave|water|wagon", "features", "objects"?: [ { "shape", "pos": [x,y,0], "size"?: [w,d,h], "rot"?: 0, "color", "label" } ], "adj": "N:..., Up:...", "occupants": "Name [x,y] | ...", "exits": "N:id [x,y] | Up:id" } ], "patch_rooms"?: [ { "id", "style"?, "features"?, "add_objects"?, "remove_objects"?, "adj"?, "exits"?, "occupants"? } ], "move_occupants"?: [ { "name", "to_room", "pos": "[x,y]" } ] },
  "entity_state"?: { "upsert": [...] },
  "entityMem_append"?: [ { "name", "mem" } ],
  "dam_delta"?: [ ... ],
  "pair_delta"?: [ ... ],
  "inv"?: { ... }
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
 * @param {object|null} [opts.receipt] Parsed <vexa_receipt> from main model
 * @param {string} [opts.vent]        Main model's <state:vent>
 * @param {object|null} [opts.headerParsed]
 * @param {Array} [opts.proseColors]
 * @param {string} [opts.cardHints]   Optional character card / persona snippet on turn 1 or new NPC
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
    mode = 'combined',
    part = null,
}) {
    const compactState = serializeCompactForWorker(prevState);
    const cleanExchange = extractStoryProse(stripGfxBlocks(normalizeBraille(exchange || '')));
    const cleanEarlier = earlier ? extractStoryProse(stripGfxBlocks(normalizeBraille(earlier))) : '';

    const preFacts = {
        next_ct: Number(prevState?.world?.ct || 0) + 1,
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

    return [
        { role: 'system', content: SYSTEM_BASE },
        { role: 'user', content: userSections.join('\n\n') },
    ];
}
