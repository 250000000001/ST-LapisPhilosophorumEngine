/**
 * Non-destructive outgoing prompt transformer for Lapis Philosophorum Engine (LPE).
 *
 * - Strips historical <internal_states>, <lpe_tail> (plus legacy <vexa_tail>), and orphaned tail GFX_END markers
 *   from assistant chat history messages (replacing depth-based prompt regex reliance).
 * - Substitutes {{lpe_state_snapshot}} (or legacy {{vexa_state_snapshot}}) with a single clean compiled
 *   <internal_states> snapshot (optionally Smart-Scoped to active map + active/mentioned entities).
 * - Leaves static top-of-prompt system rules untouched to preserve prompt caching.
 *
 * Pure ES module with zero DOM dependencies.
 */

import { serializeInternalStates } from './parser.js';
import {
    hasEjsTags,
    shouldYieldEjs,
    buildReadOnlyLpeSnapshot,
    evaluateEjs,
    substituteLpeMacros,
} from './ejsEngine.js';

export const SNAPSHOT_PLACEHOLDER = '{{lpe_state_snapshot}}';
export const LEGACY_SNAPSHOT_PLACEHOLDER = '{{vexa_state_snapshot}}';
export const TRACKER_PROPOSE_PLACEHOLDER = '{{lpe_tracker_propose_rule}}';
export const LEGACY_TRACKER_PROPOSE_PLACEHOLDER = '{{vexa_tracker_propose_rule}}';
export const TRACKER_PROPOSE_LINE = 'tracker_propose: [OPTIONAL — omit this line completely unless user permanently acquires/founds a recurring multi-stat asset or system (business, estate/fief, ship, guild, army, debt ledger) whose metrics evolve across turns and cannot fit in <state:inv> or <state:tracks>. Format: Title | key1=val1, key2=val2, key3=val3 | short reason]';

export const SPATIAL_GROUNDING_BLOCK = `<spatial_grounding>
READ THE ATLAS MAP (<state:locations>) AS PHYSICAL 3D SPACE:
- grid "[X,Y,Z]": X = East meters, Y = South meters, Z = floor level integer (0=ground, 1=upper, -1=sub-level).
- dim "WxDxHm": width (X), depth (Y), ceiling height (H meters). Optional elev: floor vertical offset in meters within the same level (e.g. +1.5m raised dais, -1.2m sunken pit).
- coordinates [x,y] or [x,y,z]: room-local meters from each room's NW floor corner [0,0,0] (x=0..W east, y=0..D south, z=height above room floor). Elevated platforms, catwalks, stairs, and characters on them include a 3rd z meter coordinate.
- exits & adj: treat physical doors/bulkheads, wall seams, ceiling heights, glass containment, and elevated walkways as real line-of-sight and acoustic boundaries when narrating movement, cover, combat range, and who can see/hear what.
</spatial_grounding>`;

export const ESTABLISHED_CAST_GUIDANCE_BLOCK = `<established_cast_guidance>
PRE-ESTABLISHED CAST ROSTER:
- Characters marked staged/manual/pinned inside <internal_states> are canonical established cast pre-loaded by the player for this scenario.
- Reuse their exact names, personalities, voices, bonds, and locations whenever they enter play rather than inventing duplicate or throwaway NPCs.
- Never convert the human {{user}} persona into an AI NPC entry.
</established_cast_guidance>`;

export function hasStagedOrManualCast(state) {
    if (!state || typeof state !== 'object') return false;
    return (state.entity_state || []).some((e) => Boolean(e?.preGameStaged || e?.manual || e?.pinned))
        || (state.offscreen_agendas || []).some((e) => Boolean(e?.preGameStaged || e?.manual || e?.pinned));
}

// Also used by the preset's display/history regexes. A second opener bounds a
// damaged block. For a missing closer discard only recognizable receipt fields.
export const COMPLETE_TAIL = /<(lpe|vexa)_tail\b[^<>\r\n]{0,128}>(?:(?!<(?:lpe|vexa)_tail\b)[\s\S]){0,32768}?<\/\1_tail[\s\u2800]*>(?:[\s\u2800]*<!--[\s\u2800]*GFX_END[\s\u2800]*-->)?/gi;
export const INCOMPLETE_TAIL = /<(?:lpe|vexa)_tail\b[^<>\r\n]{0,128}(?:>|(?=\r?$))(?:[ \t]*(?:\r?\n)?[ \t]*<(?:lpe|vexa)_receipt>(?:[ \t]*(?:\r?\n)?[ \t]*(?:world_sim|chekhov|arc|ooc|tracker_propose):[^<>\r\n]{0,1024}){0,8}(?:\s*<\/(?:lpe|vexa)_receipt>)?)?/gim;

/** Remove historical <internal_states>, <lpe_tail>, and legacy <vexa_tail> blocks from assistant chat messages. */
export function stripStateAndTailFromMessage(content) {
    if (typeof content !== 'string' || !content) return content;
    let out = content;
    // Strip <internal_states>...</internal_states> (plus optional wrapping GFX_START/END)
    out = out.replace(/<!--[\s\u2800]*GFX_START[\s\u2800]*-->\s*<internal_states\b[^>]*>[\s\S]*?<\/internal_states\s*>\s*<!--[\s\u2800]*GFX_END[\s\u2800]*-->/gi, '');
    out = out.replace(/<internal_states\b[^>]*>[\s\S]*?<\/internal_states\s*>\s*(?:<!--[\s\u2800]*GFX_END[\s\u2800]*-->)?/gi, '');
    out = out.replace(/<internal_states\b[^>]*>[\s\S]*$/i, '');

    // Strip <lpe_tail> / legacy <vexa_tail> (plus attached terminal GFX_END)
    out = out.replace(COMPLETE_TAIL, '').replace(INCOMPLETE_TAIL, '');

    // Strip standalone trailing <state:vent>
    out = out.replace(/<state:vent\b[^>]*>[\s\S]*?<\/state:vent\s*>\s*(?:<!--[\s\u2800]*GFX_END[\s\u2800]*-->)?/gi, '');

    return out.replace(/\n{3,}/g, '\n\n').trimEnd();
}

function messageTextOf(msg) {
    if (!msg) return '';
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
        return msg.content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('\n');
    }
    return '';
}

function hasSnapshotPlaceholder(text) {
    return typeof text === 'string' && (text.includes(SNAPSHOT_PLACEHOLDER) || text.includes(LEGACY_SNAPSHOT_PLACEHOLDER));
}

/** Detect whether the outgoing prompt belongs to a Magnum Opus / LPE (or legacy Vexa) preset. */
export function detectLpePresetPrompt(messages, presetName = '') {
    if (/lapis\s+philosophorum|magnum\s+opus|\blpe\b|vexa/i.test(String(presetName || ''))) return true;
    for (const msg of messages || []) {
        const txt = messageTextOf(msg);
        if (!txt) continue;
        if (hasSnapshotPlaceholder(txt)) return true;
        if (txt.includes('<internal_states_spec>') || txt.includes('<internal_atlas_spec>') || txt.includes('Antithesis -') || txt.includes('TeleWire TRP-AO')) {
            return true;
        }
    }
    return false;
}
export const detectVexaPresetPrompt = detectLpePresetPrompt;

/**
 * Transform outgoing SillyTavern `chat` messages array in place (or cloned for preview).
 *
 * @param {Array<{ role: string, content: string | any[] }>} messages
 * @param {object} opts
 * @param {boolean} opts.enabled
 * @param {boolean} [opts.forceActive=false]
 * @param {string} [opts.presetName='']
 * @param {object} opts.state
 * @param {boolean} opts.hasState
 * @param {boolean} [opts.scoped=true]
 * @param {string} [opts.recentText='']
 * @param {number} [opts.injectDepth=2]
 * @returns {{ active: boolean, strippedCount: number, injected: boolean, snapshotChars: number }}
 */
export function transformPromptMessages(messages, {
    enabled = true,
    forceActive = false,
    presetName = '',
    state,
    hasState = false,
    scoped = true,
    recentText = '',
    injectDepth = 2,
    allowTrackerProposals = true,
    spatialGrounding = true,
} = {}) {
    if (!enabled || !Array.isArray(messages)) {
        return { active: false, strippedCount: 0, injected: false, snapshotChars: 0 };
    }
    if (!forceActive && !detectLpePresetPrompt(messages, presetName)) {
        return { active: false, strippedCount: 0, injected: false, snapshotChars: 0 };
    }

    let strippedCount = 0;
    let placeholderFound = false;

    const snapshotXml = hasState
        ? serializeInternalStates(state, { scoped, recentText, includeVent: false })
        : '<!-- Turn 1: No prior state yet. Initial state will be captured after your reply. -->';
    const payloadParts = [];
    if (hasState && spatialGrounding) payloadParts.push(SPATIAL_GROUNDING_BLOCK);
    if (hasState && hasStagedOrManualCast(state)) payloadParts.push(ESTABLISHED_CAST_GUIDANCE_BLOCK);
    payloadParts.push(snapshotXml);
    const injectedPayload = payloadParts.join('\n\n');

    // First pass: strip historical states/tails strictly from assistant messages so
    // system/user instructions and World Info referencing <internal_states>, <lpe_tail>, or <vexa_tail> are never truncated.
    for (const msg of messages) {
        if (!msg || typeof msg.content !== 'string') continue;
        if (hasSnapshotPlaceholder(msg.content)) {
            placeholderFound = true;
            continue;
        }
        if (msg.content.includes('<internal_states_spec>')) {
            continue;
        }
        if (msg.role === 'assistant') {
            const cleaned = stripStateAndTailFromMessage(msg.content);
            if (cleaned !== msg.content) {
                msg.content = cleaned;
                strippedCount++;
            }
        }
    }

    // Second pass: replace placeholder OR fallback-inject at depth
    let injected = false;
    if (placeholderFound) {
        for (const msg of messages) {
            if (!msg || typeof msg.content !== 'string') continue;
            if (hasSnapshotPlaceholder(msg.content)) {
                msg.content = msg.content
                    .replaceAll(SNAPSHOT_PLACEHOLDER, injectedPayload)
                    .replaceAll(LEGACY_SNAPSHOT_PLACEHOLDER, injectedPayload);
                injected = true;
            }
        }
    } else if (hasState) {
        // Fallback when user runs an unmodified Magnum Opus / Vexa preset with the extension enabled:
        // rewrite any embedded <internal_states> mandate in <internal_states_spec> and inject snapshot at depth.
        for (const msg of messages) {
            if (msg && typeof msg.content === 'string' && msg.content.includes('<internal_states_spec>')) {
                msg.content = msg.content.replace(
                    /<internal_states>[\s\S]*?<\/internal_states>/i,
                    injectedPayload,
                );
                injected = true;
            }
        }
        if (!injected) {
            const insertAt = Math.max(0, messages.length - Math.max(0, injectDepth));
            messages.splice(insertAt, 0, {
                role: 'user',
                content: `[LIVE EXTERNAL WORLD STATE SNAPSHOT — READ-ONLY REFERENCE FOR THIS TURN; DO NOT COPY FORWARD FULL XML]\n${injectedPayload}`,
            });
            injected = true;
        }
    }

    for (const msg of messages) {
        if (!msg || typeof msg.content !== 'string') continue;
        if (!msg.content.includes(TRACKER_PROPOSE_PLACEHOLDER) && !msg.content.includes(LEGACY_TRACKER_PROPOSE_PLACEHOLDER)) continue;
        if (allowTrackerProposals) {
            msg.content = msg.content
                .replaceAll(TRACKER_PROPOSE_PLACEHOLDER, TRACKER_PROPOSE_LINE)
                .replaceAll(LEGACY_TRACKER_PROPOSE_PLACEHOLDER, TRACKER_PROPOSE_LINE);
        } else {
            msg.content = msg.content.replace(/[ \t]*\{\{(?:lpe|vexa)_tracker_propose_rule\}\}[ \t]*\r?\n?/g, '');
        }
    }

    return {
        active: true,
        strippedCount,
        injected,
        snapshotChars: snapshotXml.length,
    };
}

/**
 * Evaluate EJS (`<% ... %>`) and LPE/Card macros (`{{get_card_var::...}}`, `{{lpe::...}}`, legacy `{{vexa::...}}`)
 * across outgoing chat messages non-destructively (works even on non-LPE presets).
 * Auto-yields cleanly when `ST-Prompt-Template` (`window.EjsTemplate`) is active.
 */
export function evaluatePromptMessagesEjs(messages, {
    enabled = true,
    autoYield = true,
    allowChatRoles = false,
    maxChunkChars = 262144,
    maxTotalChars = 1048576,
    state = null,
    cardVars = {},
    setCardVar = null,
    wiEntries = [],
    charName = '',
    userName = '',
    allowVarWrites = false,
} = {}) {
    if (!enabled || !Array.isArray(messages) || shouldYieldEjs({ ejsAutoYield: autoYield })) {
        return { active: false, evaluatedCount: 0, macroCount: 0, errors: [], elapsedMs: 0 };
    }

    const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    let frozenState = null;
    const ensureFrozen = () => {
        if (!frozenState) frozenState = buildReadOnlyLpeSnapshot(state);
        return frozenState;
    };

    let evaluatedCount = 0;
    let macroCount = 0;
    let totalOutputChars = 0;
    const errors = [];

    const processChunk = (raw) => {
        if (typeof raw !== 'string' || (!hasEjsTags(raw) && !raw.includes('{{'))) {
            return raw;
        }
        let next = raw;
        if (hasEjsTags(next)) {
            const res = evaluateEjs(next, {
                frozenState: ensureFrozen(),
                state,
                cardVars,
                setCardVar,
                wiEntries,
                charName,
                userName,
            }, { allowVarWrites, maxOutputChars: maxChunkChars });
            if (res.ok) {
                const candidate = String(res.text ?? '');
                if (candidate.length <= maxChunkChars && totalOutputChars + candidate.length <= maxTotalChars) {
                    if (candidate !== next) {
                        next = candidate;
                        evaluatedCount++;
                    }
                } else {
                    errors.push('Prompt EJS output exceeded aggregate size cap');
                }
            } else if (res.error) {
                errors.push(res.error);
            }
        }
        if (typeof next === 'string' && next.includes('{{')) {
            const sub = substituteLpeMacros(next, {
                frozenState: ensureFrozen(),
                state,
                cardVars,
            });
            if (sub !== next && sub.length <= maxChunkChars && totalOutputChars + sub.length <= maxTotalChars) {
                next = sub;
                macroCount++;
            }
        }
        totalOutputChars += String(next || '').length;
        return next;
    };

    for (const msg of messages) {
        if (!msg) continue;
        // Skip user & assistant conversation messages by default so chat history cannot execute as EJS
        const role = String(msg.role || 'system').toLowerCase();
        if (!allowChatRoles && role !== 'system' && msg.lpeAllowEjs !== true && msg.vseAllowEjs !== true) {
            continue;
        }
        if (typeof msg.content === 'string') {
            msg.content = processChunk(msg.content);
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part && part.type === 'text' && typeof part.text === 'string') {
                    part.text = processChunk(part.text);
                }
            }
        }
    }

    const elapsedMs = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - t0;
    return { active: true, evaluatedCount, macroCount, errors, elapsedMs };
}
