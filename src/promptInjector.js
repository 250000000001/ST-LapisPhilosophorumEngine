/**
 * Non-destructive outgoing prompt transformer for Vexa State Engine.
 *
 * - Strips historical <internal_states>, <vexa_tail>, and orphaned tail GFX_END markers
 *   from chat history messages (replacing depth-based prompt regex reliance).
 * - Substitutes {{vexa_state_snapshot}} with a single clean compiled <internal_states>
 *   snapshot (optionally Smart-Scoped to active map + active/mentioned entities).
 * - Leaves static top-of-prompt system rules untouched to preserve prompt caching.
 *
 * Pure ES module with zero DOM dependencies.
 */

import { serializeInternalStates } from './parser.js';

export const SNAPSHOT_PLACEHOLDER = '{{vexa_state_snapshot}}';
export const TRACKER_PROPOSE_PLACEHOLDER = '{{vexa_tracker_propose_rule}}';
export const TRACKER_PROPOSE_LINE = 'tracker_propose: [OPTIONAL — omit this line completely unless user permanently acquires/founds a recurring multi-stat asset or system (business, estate/fief, ship, guild, army, debt ledger) whose metrics evolve across turns and cannot fit in <state:inv> or <state:tracks>. Format: Title | key1=val1, key2=val2, key3=val3 | short reason]';

/** Remove historical <internal_states> and <vexa_tail> blocks from assistant chat messages. */
export function stripStateAndTailFromMessage(content) {
    if (typeof content !== 'string' || !content) return content;
    let out = content;
    // Strip <internal_states>...</internal_states> (plus optional wrapping GFX_START/END)
    out = out.replace(/<!--[\s\u2800]*GFX_START[\s\u2800]*-->\s*<internal_states\b[^>]*>[\s\S]*?<\/internal_states\s*>\s*<!--[\s\u2800]*GFX_END[\s\u2800]*-->/gi, '');
    out = out.replace(/<internal_states\b[^>]*>[\s\S]*?<\/internal_states\s*>\s*(?:<!--[\s\u2800]*GFX_END[\s\u2800]*-->)?/gi, '');
    out = out.replace(/<internal_states\b[^>]*>[\s\S]*$/i, '');

    // Strip <vexa_tail>...</vexa_tail> (plus attached terminal GFX_END)
    out = out.replace(/<vexa_tail\b[^>]*>[\s\S]*?<\/vexa_tail\s*>\s*(?:<!--[\s\u2800]*GFX_END[\s\u2800]*-->)?/gi, '');
    out = out.replace(/<vexa_tail\b[^>]*>[\s\S]*$/i, '');

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

/** Detect whether the outgoing prompt belongs to a Vexa preset. */
export function detectVexaPresetPrompt(messages, presetName = '') {
    if (/vexa/i.test(String(presetName || ''))) return true;
    for (const msg of messages || []) {
        const txt = messageTextOf(msg);
        if (!txt) continue;
        if (txt.includes(SNAPSHOT_PLACEHOLDER)) return true;
        if (txt.includes('<internal_states_spec>') || txt.includes('<internal_atlas_spec>') || txt.includes('Antithesis -') || txt.includes('TeleWire TRP-AO')) {
            return true;
        }
    }
    return false;
}

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
} = {}) {
    if (!enabled || !Array.isArray(messages)) {
        return { active: false, strippedCount: 0, injected: false, snapshotChars: 0 };
    }
    if (!forceActive && !detectVexaPresetPrompt(messages, presetName)) {
        return { active: false, strippedCount: 0, injected: false, snapshotChars: 0 };
    }

    let strippedCount = 0;
    let placeholderFound = false;

    const snapshotXml = hasState
        ? serializeInternalStates(state, { scoped, recentText, includeVent: false })
        : '<!-- Turn 1: No prior state yet. Initial state will be captured after your reply. -->';

    // First pass: strip historical states/tails ONLY from messages that are not system template messages
    // containing SNAPSHOT_PLACEHOLDER or <internal_states_spec>.
    for (const msg of messages) {
        if (!msg || typeof msg.content !== 'string') continue;
        if (msg.content.includes(SNAPSHOT_PLACEHOLDER)) {
            placeholderFound = true;
            continue;
        }
        if (msg.content.includes('<internal_states_spec>')) {
            continue;
        }
        if (msg.role === 'assistant' || /<(?:internal_states|vexa_tail)\b/i.test(msg.content)) {
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
            if (msg.content.includes(SNAPSHOT_PLACEHOLDER)) {
                msg.content = msg.content.replaceAll(SNAPSHOT_PLACEHOLDER, snapshotXml);
                injected = true;
            }
        }
    } else if (hasState) {
        // Fallback when user runs an unmodified Vexa preset with the extension enabled:
        // rewrite any embedded <internal_states> mandate in <internal_states_spec> and inject snapshot at depth.
        for (const msg of messages) {
            if (msg && typeof msg.content === 'string' && msg.content.includes('<internal_states_spec>')) {
                msg.content = msg.content.replace(
                    /<internal_states>[\s\S]*?<\/internal_states>/i,
                    snapshotXml,
                );
                injected = true;
            }
        }
        if (!injected) {
            const insertAt = Math.max(0, messages.length - Math.max(0, injectDepth));
            messages.splice(insertAt, 0, {
                role: 'user',
                content: `[LIVE EXTERNAL WORLD STATE SNAPSHOT — READ-ONLY REFERENCE FOR THIS TURN; DO NOT COPY FORWARD FULL XML]\n${snapshotXml}`,
            });
            injected = true;
        }
    }

    for (const msg of messages) {
        if (!msg || typeof msg.content !== 'string') continue;
        if (!msg.content.includes(TRACKER_PROPOSE_PLACEHOLDER)) continue;
        if (allowTrackerProposals) {
            msg.content = msg.content.replaceAll(TRACKER_PROPOSE_PLACEHOLDER, TRACKER_PROPOSE_LINE);
        } else {
            msg.content = msg.content.replace(/[ \t]*\{\{vexa_tracker_propose_rule\}\}[ \t]*\r?\n?/g, '');
        }
    }

    return {
        active: true,
        strippedCount,
        injected,
        snapshotChars: snapshotXml.length,
    };
}
