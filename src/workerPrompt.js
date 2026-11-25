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
1. Output ONLY one valid JSON object. No markdown fences, no commentary before or after.
2. DELTA-ONLY: Omit any top-level key that did NOT change this turn. Never copy forward unchanged rooms, unchanged entity_state rows, dormant off-screen NPCs, or unchanged relationship pairs.
3. STRICT EPISTEMIC SANITY (<knowledge_sanity>): Characters ONLY know facts they witnessed in 120° LOS, heard within earshot, were told, or read via message/evidence. Never leak secrets or off-screen facts into thoughts/entityMem of characters who lack a vector.
4. ATLAS INTEGRITY: Room grids use 5m integer multiples [X,Y,Z], dim "WxHxHm", never overlap existing rooms on the same floor, and exits/adj connect reciprocally. Never drop or relocate existing rooms. Use move_occupants for movement.
5. IMMUTABLE DIALOGUE COLORS: Never change an existing entity's fontColor. For a brand-new named NPC, pick an unused color from availableColors (or match proseColorsDetected).
6. RESPECT MAIN-MODEL RECEIPT: Honor any world_sim outcome, fired Chekhov bullets, arc updates, and OOC directives listed in <main_model_receipt>.`;

const COMBINED_SCHEMA_GUIDE = `Return a JSON object containing ONLY the keys that changed this turn:
{
  "world": { "loc"?, "time"?, "date"?, "weather"?, "room"?, "user_pos"?: "[x,y]", "entries"?, "obstacles"?, "audio"?, "pacing"?: "SLOW|FLOW|PUSH" },
  "onscreen": [ { "name", "parrott": "ParrotEmotion:[Primary->Secondary->Tertiary] | [Low|Med|High]", "residualMood": "res:[mood] | [target] | [age]", "tfdy": "T# F# D# Y# (with optional ↑/↓)", "salience": "sal:#", "agenda", "why", "end", "move" } ],
  "offscreen_agendas": [ { "name", "loc", "agenda", "why", "goal", "end", "mood", "tfdy": "T# F# D# Y# | IW#", "salience": "sal:#" } ],
  "locations": {
    "set_active"?: { "active_map_id", "active_level" },
    "new_maps"?: [ { "id", "name", "levels": [{"z":"0","name":"..."}], "main_exit": "room_id [X,Y,Z]" } ],
    "new_rooms"?: [ { "id", "map_id", "name", "dim": "15x15x5m", "grid": "[X,Y,Z]", "anchor", "features", "adj", "occupants", "exits" } ],
    "patch_rooms"?: [ { "id", "features"?, "adj"?, "exits"?, "occupants"? } ],
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
  "locations"?: { "set_active"?, "new_maps"?, "new_rooms"?, "patch_rooms"?, "move_occupants"? },
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
