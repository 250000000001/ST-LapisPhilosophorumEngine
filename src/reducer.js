/**
 * Pure worker-delta parser and deterministic JS state reducer for Vexa.
 *
 * Responsibilities:
 *  - Parse worker JSON deltas resiliently (strip <think>, code fences, fix minor trailing commas).
 *  - Deterministic turn mechanics: ct++, header sync, prose dialogue color locking,
 *    Atlas bbox calculation / 5m validation / AABB overlap check / reciprocal exits / occupant moves,
 *    Chekhov fired clearing + age increment + 20-cap, Notebook R/T/D sorting + pinning + 20-cap,
 *    EntityMem deduplication + 20-cap, Aether Matrix [3..20] + ±2 clamp, TFDY [0..4] bounds.
 */

import {
    PALETTE,
    COLOR_TO_HEX,
    normalizeBraille,
    emptyState,
    cloneState,
    isEmptySentinel,
    slugifyTrackerId,
} from './schema.js';

export const MAX_CUSTOM_TRACKERS = 6;
export const MAX_TRACKER_FIELDS = 8;

const MATRIX_EMOJIS = ['🌶️', '🎲', '🤝', '🛠️', '🏠', '🕊️', '😠', '🥊', '❄️', '🪨', '🌫️', '🐍'];

/** Strip <think>...</think> blocks, code fences, and trailing commas to extract JSON object. */
export function extractJsonCandidate(rawText) {
    if (typeof rawText !== 'string') return '';
    let s = normalizeBraille(rawText);
    s = s.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/gi, '').trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first >= 0 && last > first) {
        s = s.slice(first, last + 1);
    }
    // Remove trailing commas before } or ]
    s = s.replace(/,\s*([}\]])/g, '$1');
    return s.trim();
}

const KNOWN_DELTA_KEYS = new Set([
    'world',
    'onscreen',
    'offscreen_agendas',
    'locations',
    'entityMem_append',
    'entity_state',
    'thoughts',
    'dam_delta',
    'pair_delta',
    'tracks',
    'arc',
    'chekhov_delta',
    'inv',
    'story_notes',
    'notebook_append',
    'custom_trackers_patch',
]);

/**
 * Parse a worker response into a structured delta object.
 * Supports partial extraction if outer JSON parsing fails by probing top-level keys.
 */
export function parseWorkerDelta(rawText) {
    const candidate = extractJsonCandidate(rawText);
    if (!candidate) {
        return { ok: false, delta: null, sectionErrors: ['Empty worker response'], raw: rawText };
    }

    try {
        const parsed = JSON.parse(candidate);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { ok: false, delta: null, sectionErrors: ['Worker output is not a JSON object'], raw: rawText };
        }
        return validateDeltaObject(parsed, rawText);
    } catch (err) {
        // Fallback: try extracting individual balanced top-level JSON fields
        const partial = {};
        const errors = [`Full JSON parse failed (${err.message}); attempted partial recovery`];
        for (const key of KNOWN_DELTA_KEYS) {
            const keyRe = new RegExp(`"${key}"\\s*:\\s*([{\\[])`, 'g');
            const m = keyRe.exec(candidate);
            if (!m) continue;
            const openChar = m[1];
            const closeChar = openChar === '{' ? '}' : ']';
            const startIdx = m.index + m[0].length - 1;
            const slice = extractBalanced(candidate, startIdx, openChar, closeChar);
            if (!slice) continue;
            try {
                partial[key] = JSON.parse(slice.replace(/,\s*([}\]])/g, '$1'));
            } catch (subErr) {
                errors.push(`Section "${key}" invalid JSON: ${subErr.message}`);
            }
        }
        if (Object.keys(partial).length > 0) {
            const res = validateDeltaObject(partial, rawText);
            res.sectionErrors.push(...errors);
            return res;
        }
        return { ok: false, delta: null, sectionErrors: errors, raw: rawText };
    }
}

function extractBalanced(str, startIdx, openChar, closeChar) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = startIdx; i < str.length; i++) {
        const ch = str[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
        } else if (ch === openChar) {
            depth++;
        } else if (ch === closeChar) {
            depth--;
            if (depth === 0) return str.slice(startIdx, i + 1);
        }
    }
    return null;
}

function validateDeltaObject(obj, raw) {
    const delta = {};
    const sectionErrors = [];
    for (const [k, v] of Object.entries(obj)) {
        if (!KNOWN_DELTA_KEYS.has(k)) continue;
        if (v === null || v === undefined) continue;
        if ((k === 'onscreen' || k === 'offscreen_agendas' || k === 'thoughts' || k === 'entityMem_append' || k === 'dam_delta' || k === 'pair_delta' || k === 'notebook_append' || k === 'custom_trackers_patch') && !Array.isArray(v)) {
            // Allow object wrapper for onscreen/offscreen/entity_state if worker emitted { upsert: [...] }
            if (v && typeof v === 'object' && (Array.isArray(v.upsert) || Array.isArray(v.replace))) {
                delta[k] = v;
            } else {
                sectionErrors.push(`Expected array for "${k}"`);
            }
            continue;
        }
        delta[k] = v;
    }
    return { ok: Object.keys(delta).length > 0 || sectionErrors.length === 0, delta, sectionErrors, raw };
}

// ── Atlas Geometry Helpers ──────────────────────────────────────────────────

export function parseGridCoords(gridStr) {
    const m = String(gridStr || '').match(/\[\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/);
    if (!m) return null;
    return { x: parseInt(m[1], 10), y: parseInt(m[2], 10), z: parseInt(m[3], 10) };
}

export function parseDimMeters(dimStr) {
    const m = String(dimStr || '').match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?/i);
    if (!m) return null;
    return { w: Number(m[1]), h: Number(m[2]), zH: m[3] ? Number(m[3]) : 4 };
}

export function computeBbox(gridStr, dimStr) {
    const g = parseGridCoords(gridStr);
    const d = parseDimMeters(dimStr);
    if (!g || !d) return null;
    return {
        x1: g.x,
        y1: g.y,
        x2: g.x + d.w,
        y2: g.y + d.h,
        z: g.z,
        str: `[${g.x},${g.y},${g.x + d.w},${g.y + d.h}]`,
    };
}

function aabbOverlaps(a, b) {
    return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

/** Parse occupant strings like "Jon Snow [15,21] | Bramm [16,22]" into [{ name, pos }]. */
export function parseOccupantsList(occStr) {
    if (isEmptySentinel(occStr)) return [];
    return String(occStr)
        .split(/\s*\|\s*|\s*,\s*(?=[^,\]]+\[)/)
        .map((item) => item.trim())
        .filter((item) => item && item !== '∅')
        .map((item) => {
            const m = item.match(/^(.+?)\s*(\[[^\]]+\])$/);
            return m ? { name: m[1].trim(), pos: m[2].trim() } : { name: item, pos: '' };
        });
}

export function formatOccupantsList(list) {
    if (!list || !list.length) return '∅';
    return list.map((o) => (o.pos ? `${o.name} ${o.pos}` : o.name)).join(' | ');
}

/** Clamp Matrix [v, a] values into [3..20] and optionally enforce ±2 turn step vs previous matrix. */
export function clampMatrixString(nextMatrix, prevMatrix = '', enforceStepCap = true) {
    if (!nextMatrix || isEmptySentinel(nextMatrix)) return nextMatrix;
    const parseValues = (str) => {
        const map = new Map();
        for (const emoji of MATRIX_EMOJIS) {
            const esc = emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const m = String(str).match(new RegExp(`${esc}\\s*\\[\\s*(-?\\d+)\\s*,\\s*(-?\\d+)\\s*\\]`));
            if (m) map.set(emoji, [parseInt(m[1], 10), parseInt(m[2], 10)]);
        }
        return map;
    };
    const nextMap = parseValues(nextMatrix);
    if (nextMap.size === 0) return nextMatrix;
    const prevMap = prevMatrix ? parseValues(prevMatrix) : new Map();

    return MATRIX_EMOJIS.map((emoji) => {
        const pair = nextMap.get(emoji) || prevMap.get(emoji) || [3, 0];
        let [v, a] = pair;
        if (enforceStepCap && prevMap.has(emoji)) {
            const prevV = prevMap.get(emoji)[0];
            if (v - prevV > 2) v = prevV + 2;
            if (prevV - v > 2) v = prevV - 2;
        }
        v = Math.max(3, Math.min(20, v));
        return `${emoji}[${v},${a}]`;
    }).join(' ');
}

export function clampTfdyString(tfdyStr) {
    if (!tfdyStr || isEmptySentinel(tfdyStr)) return tfdyStr;
    return String(tfdyStr).replace(/\b([TFDY]|IW)\s*(-?\d+)([↑↓]?)/g, (_, key, num, arrow) => {
        const clamped = Math.max(0, Math.min(4, parseInt(num, 10)));
        return `${key}${clamped}${arrow}`;
    });
}

/** Increment Chekhov age# by 1, preserve locked conditions, clear prior fired bullets. */
function ageBullet(bulletStr) {
    if (/\bage(\d+)\b/i.test(bulletStr)) {
        return bulletStr.replace(/\bage(\d+)\b/gi, (_, n) => `age${parseInt(n, 10) + 1}`);
    }
    return `${bulletStr} age1`;
}

function bulletTextKey(bulletStr) {
    return String(bulletStr || '').split('|')[0].trim().toLowerCase();
}

function sortAndCapNotebook(entries, { pinRules = true, cap = 20 } = {}) {
    const deduped = [];
    const seen = new Set();
    for (const raw of entries) {
        const s = String(raw || '').trim();
        if (isEmptySentinel(s)) continue;
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(s);
    }
    if (pinRules) {
        const rules = deduped.filter((e) => /^\s*\[R\]/i.test(e));
        const others = deduped.filter((e) => !/^\s*\[R\]/i.test(e));
        const room = Math.max(0, cap - rules.length);
        return [...rules.slice(0, cap), ...others.slice(0, room)];
    }
    return deduped.slice(0, cap);
}

function normalizeColorName(colorStr) {
    const s = String(colorStr || '').toLowerCase();
    for (const p of PALETTE) {
        if (s.includes(p.name)) return `${p.name} ${p.hex}`;
    }
    return String(colorStr || '').trim();
}

function findNextUnusedColor(entityStates) {
    const used = new Set();
    for (const es of entityStates) {
        const lower = String(es.fontColor || '').toLowerCase();
        for (const p of PALETTE) {
            if (lower.includes(p.name) || lower.includes(p.hex.toLowerCase())) used.add(p.name);
        }
    }
    const free = PALETTE.find((p) => !used.has(p.name));
    return free ? `${free.name} ${free.hex}` : '';
}

function upsertByName(list, item, matchFn) {
    const idx = list.findIndex(matchFn);
    if (idx >= 0) {
        list[idx] = { ...list[idx], ...item };
    } else {
        list.push(item);
    }
}

/**
 * Pure deterministic reducer applying a delta (from worker, main-model tail, or user edit)
 * onto `prevState`.
 *
 * @param {object} prevState
 * @param {object} delta
 * @param {{
 *   isTurnAdvance?: boolean,
 *   headerParsed?: object|null,
 *   proseColors?: Array<{color:string, hex:string, fontColor:string, contextBefore:string, contextAfter:string}>,
 *   vent?: string,
 *   receipt?: object|null,
 *   pinNotebookRules?: boolean,
 *   enforceMatrixStepCap?: boolean,
 *   clearFiredOnTurn?: boolean
 * }} [ctx]
 * @returns {{ state: object, diff: string[], warnings: string[] }}
 */
function capFieldsObject(rawFields, maxFields = MAX_TRACKER_FIELDS) {
    const out = {};
    if (!rawFields || typeof rawFields !== 'object') return out;
    let count = 0;
    for (const [k, v] of Object.entries(rawFields)) {
        const key = String(k || '').trim();
        if (!key) continue;
        if (!(key in out)) {
            if (count >= maxFields) break;
            count++;
        }
        out[key] = String(v ?? '').trim();
    }
    return out;
}

/**
 * Approve a pending main-model custom tracker proposal into `state.custom_trackers`.
 */
export function approveTrackerProposal(state, proposalId, overrides = null) {
    const next = cloneState(state || emptyState());
    if (!Array.isArray(next.custom_trackers)) next.custom_trackers = [];
    if (!Array.isArray(next.tracker_proposals)) next.tracker_proposals = [];
    if (!Array.isArray(next.dismissed_proposals)) next.dismissed_proposals = [];

    const needle = String(proposalId || '').trim().toLowerCase();
    const idx = next.tracker_proposals.findIndex((p) => String(p.id || '').trim().toLowerCase() === needle);
    const proposal = idx >= 0 ? next.tracker_proposals.splice(idx, 1)[0] : null;
    const src = overrides || proposal;
    if (!src || isEmptySentinel(src.title)) return next;

    const id = slugifyTrackerId(src.id || src.title);
    const tracker = {
        id,
        title: String(src.title).trim(),
        fields: capFieldsObject(src.fields),
        notes: String(overrides?.notes ?? proposal?.reason ?? src.notes ?? '').trim(),
        archived: false,
    };
    upsertByName(next.custom_trackers, tracker, (t) => String(t.id || '').toLowerCase() === id.toLowerCase());
    next.dismissed_proposals = next.dismissed_proposals.filter((d) => String(d).toLowerCase() !== id.toLowerCase());
    return next;
}

/**
 * Dismiss a pending proposal and remember its ID so the engine does not re-nag.
 */
export function dismissTrackerProposal(state, proposalId) {
    const next = cloneState(state || emptyState());
    if (!Array.isArray(next.tracker_proposals)) next.tracker_proposals = [];
    if (!Array.isArray(next.dismissed_proposals)) next.dismissed_proposals = [];

    const needle = String(proposalId || '').trim().toLowerCase();
    if (!needle) return next;
    next.tracker_proposals = next.tracker_proposals.filter((p) => String(p.id || '').trim().toLowerCase() !== needle);
    if (!next.dismissed_proposals.some((d) => String(d).toLowerCase() === needle)) {
        next.dismissed_proposals.push(needle);
    }
    return next;
}

export function applyDelta(prevState, delta = {}, ctx = {}) {
    const base = cloneState(prevState || emptyState());
    const next = cloneState(base);
    if (!Array.isArray(next.custom_trackers)) next.custom_trackers = [];
    if (!Array.isArray(next.tracker_proposals)) next.tracker_proposals = [];
    if (!Array.isArray(next.dismissed_proposals)) next.dismissed_proposals = [];
    const warnings = [];
    const changedSections = new Set();

    const {
        isTurnAdvance = true,
        headerParsed = null,
        proseColors = [],
        vent,
        receipt = null,
        pinNotebookRules = true,
        enforceMatrixStepCap = true,
        clearFiredOnTurn = true,
        allowTrackerProposals = true,
        autoAcceptTrackerProposals = false,
    } = ctx;

    // 1. World & Deterministic Header / ct++
    if (isTurnAdvance) {
        next.world.ct = Number(base.world?.ct || 0) + 1;
        changedSections.add('world');
    }
    if (headerParsed) {
        if (headerParsed.time) next.world.time = headerParsed.time;
        if (headerParsed.date) next.world.date = headerParsed.date;
        if (headerParsed.loc) next.world.loc = headerParsed.loc;
        if (headerParsed.weather) next.world.weather = headerParsed.weather;
        changedSections.add('world');
    }
    if (delta.world && typeof delta.world === 'object') {
        for (const [k, v] of Object.entries(delta.world)) {
            if (v !== undefined && v !== null && k !== 'ct') {
                next.world[k] = k === 'ct' ? Number(v) : String(v);
            } else if (k === 'ct' && !isTurnAdvance && Number.isFinite(Number(v))) {
                next.world.ct = Number(v);
            }
        }
        changedSections.add('world');
    }

    // 2. Onscreen NPCs
    if (delta.onscreen !== undefined) {
        const list = Array.isArray(delta.onscreen)
            ? delta.onscreen
            : Array.isArray(delta.onscreen?.replace) ? delta.onscreen.replace : null;
        if (list) {
            next.onscreen = list
                .filter((e) => e && !isEmptySentinel(e.name))
                .map((e) => ({
                    name: String(e.name).trim(),
                    parrott: String(e.parrott || ''),
                    residualMood: String(e.residualMood || ''),
                    tfdy: clampTfdyString(String(e.tfdy || '')),
                    salience: String(e.salience || 'sal:5'),
                    agenda: String(e.agenda || ''),
                    why: String(e.why || ''),
                    end: String(e.end || ''),
                    move: String(e.move || ''),
                }));
            changedSections.add('onscreen');
        } else if (delta.onscreen && typeof delta.onscreen === 'object') {
            if (Array.isArray(delta.onscreen.remove)) {
                const rm = new Set(delta.onscreen.remove.map((n) => String(n).toLowerCase()));
                next.onscreen = next.onscreen.filter((e) => !rm.has(e.name.toLowerCase()));
                changedSections.add('onscreen');
            }
            if (Array.isArray(delta.onscreen.upsert)) {
                for (const item of delta.onscreen.upsert) {
                    if (!item?.name) continue;
                    const normalized = { ...item, tfdy: clampTfdyString(item.tfdy || '') };
                    upsertByName(next.onscreen, normalized, (x) => x.name.toLowerCase() === item.name.toLowerCase());
                }
                changedSections.add('onscreen');
            }
        }
    }

    // 3. Offscreen Agendas
    if (delta.offscreen_agendas !== undefined) {
        if (Array.isArray(delta.offscreen_agendas)) {
            // Merge by name so dormant offscreen NPCs not mentioned in delta are preserved!
            const updatedByName = new Map();
            for (const e of next.offscreen_agendas) updatedByName.set(e.name.toLowerCase(), e);
            for (const item of delta.offscreen_agendas) {
                if (!item || isEmptySentinel(item.name)) continue;
                const cleanItem = {
                    name: String(item.name).trim(),
                    loc: String(item.loc || ''),
                    agenda: String(item.agenda || ''),
                    why: String(item.why || ''),
                    goal: String(item.goal || ''),
                    end: String(item.end || ''),
                    mood: String(item.mood || ''),
                    tfdy: clampTfdyString(String(item.tfdy || '')),
                    salience: String(item.salience || 'sal:5'),
                };
                updatedByName.set(cleanItem.name.toLowerCase(), cleanItem);
            }
            // If someone moved onscreen, remove from offscreen
            const onscreenNames = new Set(next.onscreen.map((e) => e.name.toLowerCase()));
            next.offscreen_agendas = [...updatedByName.values()].filter((e) => !onscreenNames.has(e.name.toLowerCase()));
            changedSections.add('offscreen_agendas');
        } else if (delta.offscreen_agendas && typeof delta.offscreen_agendas === 'object') {
            if (Array.isArray(delta.offscreen_agendas.replace)) {
                next.offscreen_agendas = delta.offscreen_agendas.replace;
            }
            if (Array.isArray(delta.offscreen_agendas.remove)) {
                const rm = new Set(delta.offscreen_agendas.remove.map((n) => String(n).toLowerCase()));
                next.offscreen_agendas = next.offscreen_agendas.filter((e) => !rm.has(e.name.toLowerCase()));
            }
            if (Array.isArray(delta.offscreen_agendas.upsert)) {
                for (const item of delta.offscreen_agendas.upsert) {
                    if (!item?.name) continue;
                    const normalized = { ...item, tfdy: clampTfdyString(item.tfdy || '') };
                    upsertByName(next.offscreen_agendas, normalized, (x) => x.name.toLowerCase() === item.name.toLowerCase());
                }
            }
            changedSections.add('offscreen_agendas');
        }
    } else if (changedSections.has('onscreen')) {
        // Keep offscreen_agendas cleanly disjoint from onscreen
        const onscreenNames = new Set(next.onscreen.map((e) => e.name.toLowerCase()));
        const filtered = next.offscreen_agendas.filter((e) => !onscreenNames.has(e.name.toLowerCase()));
        if (filtered.length !== next.offscreen_agendas.length) {
            next.offscreen_agendas = filtered;
            changedSections.add('offscreen_agendas');
        }
    }

    // 4. Locations (Atlas)
    if (delta.locations && typeof delta.locations === 'object') {
        const dl = delta.locations;
        if (dl.set_active && typeof dl.set_active === 'object') {
            if (dl.set_active.active_map_id !== undefined) next.locations.map_index.active_map_id = String(dl.set_active.active_map_id);
            if (dl.set_active.active_level !== undefined) next.locations.map_index.active_level = String(dl.set_active.active_level);
        }
        if (dl.active_map_id !== undefined) next.locations.map_index.active_map_id = String(dl.active_map_id);
        if (dl.active_level !== undefined) next.locations.map_index.active_level = String(dl.active_level);

        const mapsToUpsert = [...(dl.new_maps || []), ...(dl.upsert_maps || []), ...(dl.maps || [])];
        for (const m of mapsToUpsert) {
            if (!m?.id) continue;
            upsertByName(next.locations.map_index.maps, {
                id: String(m.id).trim(),
                name: String(m.name || m.id),
                levels: Array.isArray(m.levels) ? m.levels.map((l) => ({ z: String(l.z ?? 0), name: String(l.name || '') })) : [{ z: '0', name: 'Ground Floor' }],
                main_exit: String(m.main_exit || '∅'),
            }, (x) => x.id === m.id);
        }

        const roomsToUpsert = [...(dl.new_rooms || []), ...(dl.upsert_rooms || []), ...(dl.patch_rooms || []), ...(dl.rooms || [])];
        for (const r of roomsToUpsert) {
            if (!r?.id) continue;
            const existingIdx = next.locations.rooms.findIndex((x) => x.id === r.id);
            const merged = existingIdx >= 0
                ? { ...next.locations.rooms[existingIdx], ...r }
                : {
                    id: String(r.id).trim(),
                    kind: r.kind || 'rend',
                    map_id: String(r.map_id || next.locations.map_index.active_map_id || '∅'),
                    name: String(r.name || r.id),
                    dim: String(r.dim || ''),
                    bbox: String(r.bbox || ''),
                    anchor: String(r.anchor || '∅'),
                    features: String(r.features || '∅'),
                    adj: String(r.adj || '∅'),
                    grid: String(r.grid || ''),
                    occupants: String(r.occupants || '∅'),
                    exits: String(r.exits || '∅'),
                };
            // Deterministic bbox derivation from grid + dim
            const derived = computeBbox(merged.grid, merged.dim);
            if (derived) {
                merged.bbox = derived.str;
            }
            if (existingIdx >= 0) next.locations.rooms[existingIdx] = merged;
            else next.locations.rooms.push(merged);
        }

        // Reciprocal Atlas <adj> & <exits> mirroring for newly added/patched rooms
        const OPPOSITE_DIR = { n: 'S', s: 'N', e: 'W', w: 'E', up: 'Down', down: 'Up' };
        const CANON_DIR = { n: 'N', s: 'S', e: 'E', w: 'W', up: 'Up', down: 'Down' };
        const upsertAdj = (adjStr, dirLabel, targetId) => {
            const slots = new Map([['N', '∅'], ['S', '∅'], ['E', '∅'], ['W', '∅'], ['Up', '∅'], ['Down', '∅']]);
            if (!isEmptySentinel(adjStr)) {
                for (const part of String(adjStr).split(/\s*[,|]\s*/)) {
                    const m = part.match(/^(N|S|E|W|Up|Down)\s*:\s*(.+)$/i);
                    if (m) slots.set(CANON_DIR[m[1].toLowerCase()], m[2].trim() || '∅');
                }
            }
            const cur = slots.get(dirLabel);
            if (!cur || cur === '∅') {
                slots.set(dirLabel, targetId);
            }
            return [...slots.entries()].map(([k, v]) => `${k}:${v}`).join(', ');
        };
        const appendExitIfMissing = (exitsStr, oppDir, sourceId, coordsStr) => {
            const list = isEmptySentinel(exitsStr)
                ? []
                : String(exitsStr).split(/\s*\|\s*/).map((s) => s.trim()).filter((s) => s && s !== '∅');
            const already = list.some((ex) => new RegExp(`:(?:\\s*)${sourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$|\\[)`, 'i').test(ex));
            if (!already) {
                list.push(`${oppDir}:${sourceId}${coordsStr ? ` ${coordsStr}` : ''}`);
            }
            return list.length ? list.join(' | ') : '∅';
        };
        for (const r of roomsToUpsert) {
            if (!r?.id) continue;
            const src = next.locations.rooms.find((x) => x.id === r.id);
            if (!src) continue;
            if (!isEmptySentinel(src.adj)) {
                for (const part of String(src.adj).split(/\s*[,|]\s*/)) {
                    const m = part.match(/^(N|S|E|W|Up|Down)\s*:\s*([^\s,|]+)/i);
                    if (!m || isEmptySentinel(m[2])) continue;
                    const opp = OPPOSITE_DIR[m[1].toLowerCase()];
                    const target = next.locations.rooms.find((x) => x.id === m[2].trim());
                    if (target && opp) target.adj = upsertAdj(target.adj, opp, src.id);
                }
            }
            if (!isEmptySentinel(src.exits)) {
                for (const part of String(src.exits).split(/\s*\|\s*/)) {
                    const m = part.match(/^(N|S|E|W|Up|Down)\s*:\s*([^\s\[]+)(?:\s*(\[[^\]]+\]))?/i);
                    if (!m || isEmptySentinel(m[2]) || m[2] === 'main_exit') continue;
                    const opp = OPPOSITE_DIR[m[1].toLowerCase()];
                    const target = next.locations.rooms.find((x) => x.id === m[2].trim());
                    if (target && opp) target.exits = appendExitIfMissing(target.exits, opp, src.id, m[3] || '');
                }
            }
        }

        // Atomic occupant moves: { name, to_room, pos }
        for (const mv of dl.move_occupants || []) {
            if (!mv?.name || !mv?.to_room) continue;
            const targetNameLower = String(mv.name).trim().toLowerCase();
            for (const room of next.locations.rooms) {
                const occs = parseOccupantsList(room.occupants);
                const filtered = occs.filter((o) => o.name.toLowerCase() !== targetNameLower);
                if (filtered.length !== occs.length) room.occupants = formatOccupantsList(filtered);
            }
            const dest = next.locations.rooms.find((r) => r.id === mv.to_room);
            if (dest) {
                const occs = parseOccupantsList(dest.occupants);
                occs.push({ name: String(mv.name).trim(), pos: mv.pos ? String(mv.pos).trim() : '' });
                dest.occupants = formatOccupantsList(occs);
            } else {
                warnings.push(`Atlas move_occupants target room "${mv.to_room}" not found`);
            }
        }

        // Validate AABB overlaps per map+floor
        const byFloor = new Map();
        for (const r of next.locations.rooms) {
            const box = computeBbox(r.grid, r.dim);
            if (!box) continue;
            const key = `${r.map_id}:${box.z}`;
            if (!byFloor.has(key)) byFloor.set(key, []);
            byFloor.get(key).push({ id: r.id, box });
        }
        for (const [floorKey, list] of byFloor.entries()) {
            for (let i = 0; i < list.length; i++) {
                for (let j = i + 1; j < list.length; j++) {
                    if (aabbOverlaps(list[i].box, list[j].box)) {
                        warnings.push(`Atlas AABB overlap on ${floorKey}: ${list[i].id} overlaps ${list[j].id}`);
                    }
                }
            }
        }
        changedSections.add('locations');
    }

    // 5. Entity State (upsert + deterministic prose dialogue color lock)
    if (delta.entity_state) {
        const list = Array.isArray(delta.entity_state)
            ? delta.entity_state
            : Array.isArray(delta.entity_state?.upsert) ? delta.entity_state.upsert
            : Array.isArray(delta.entity_state?.replace) ? delta.entity_state.replace : [];
        if (Array.isArray(delta.entity_state?.replace)) {
            next.entity_state = [];
        }
        for (const item of list) {
            if (!item || isEmptySentinel(item.name)) continue;
            const existing = next.entity_state.find((x) => x.name.toLowerCase() === item.name.toLowerCase());
            // Immutable fontColor rule: preserve already-locked hex if established!
            let fontColor = existing?.fontColor && !isEmptySentinel(existing.fontColor)
                ? existing.fontColor
                : normalizeColorName(item.fontColor || '');
            if (!fontColor) {
                fontColor = findNextUnusedColor(next.entity_state);
            }
            upsertByName(next.entity_state, {
                name: String(item.name).trim(),
                fontColor,
                look: String(item.look ?? existing?.look ?? ''),
                voice: String(item.voice ?? existing?.voice ?? ''),
                persona: String(item.persona ?? existing?.persona ?? ''),
                private: String(item.private ?? existing?.private ?? ''),
            }, (x) => x.name.toLowerCase() === item.name.toLowerCase());
        }
        changedSections.add('entity_state');
    }

    // Deterministic color audit from prose dialogue tags: if a known entity has no fontColor yet
    // and appears right next to a colored tag in prose, lock it.
    if (proseColors.length > 0) {
        for (const es of next.entity_state) {
            if (!isEmptySentinel(es.fontColor)) continue;
            const firstName = es.name.split(/\s+/)[0].toLowerCase();
            const fullName = es.name.toLowerCase();
            const hit = proseColors.find((pc) =>
                pc.contextAfter.toLowerCase().includes(fullName)
                || pc.contextBefore.toLowerCase().includes(fullName)
                || pc.contextAfter.toLowerCase().includes(firstName)
                || pc.contextBefore.toLowerCase().includes(firstName),
            );
            if (hit) {
                es.fontColor = hit.fontColor;
                changedSections.add('entity_state');
            }
        }
    }

    // 6. Entity Memory (append + dedupe + cap 20 per character)
    if (Array.isArray(delta.entityMem_append)) {
        for (const item of delta.entityMem_append) {
            if (!item?.name) continue;
            const memLines = Array.isArray(item.entries)
                ? item.entries
                : item.mem ? [item.mem] : [];
            if (!memLines.length) continue;
            let rec = next.entityMem.find((x) => x.name.toLowerCase() === String(item.name).trim().toLowerCase());
            if (!rec) {
                rec = { name: String(item.name).trim(), entries: [] };
                next.entityMem.push(rec);
            }
            for (const line of memLines) {
                const s = String(line || '').trim();
                if (!isEmptySentinel(s) && !rec.entries.includes(s)) {
                    rec.entries.push(s);
                }
            }
            if (rec.entries.length > 20) rec.entries = rec.entries.slice(-20);
        }
        changedSections.add('entityMem');
    }

    // 7. Thoughts
    if (delta.thoughts !== undefined) {
        const list = Array.isArray(delta.thoughts)
            ? delta.thoughts
            : Array.isArray(delta.thoughts?.replace) ? delta.thoughts.replace : null;
        if (list) {
            next.thoughts = list.filter((t) => t && !isEmptySentinel(t.name)).slice(0, 8);
            changedSections.add('thoughts');
        }
    }

    // 8. Dam (upsert by directional pair)
    if (Array.isArray(delta.dam_delta)) {
        for (const d of delta.dam_delta) {
            if (!d?.pair) continue;
            upsertByName(next.dam, {
                pair: String(d.pair).trim(),
                sluice: String(d.sluice || ''),
                filters: String(d.filters || ''),
                misc: String(d.misc || 'clash:— | T:no'),
                intent: String(d.intent || ''),
            }, (x) => x.pair.toLowerCase() === String(d.pair).trim().toLowerCase());
        }
        changedSections.add('dam');
    }

    // 9. Pair (upsert by unordered or exact pair + matrix clamp)
    if (Array.isArray(delta.pair_delta)) {
        const normPair = (s) => String(s || '').split('↔').map((x) => x.trim().toLowerCase()).sort().join('↔');
        for (const p of delta.pair_delta) {
            if (!p?.names) continue;
            const pKey = normPair(p.names);
            const prevRec = base.pair.find((x) => normPair(x.names) === pKey);
            const clampedMatrix = clampMatrixString(p.matrix || prevRec?.matrix || '', prevRec?.matrix || '', enforceMatrixStepCap);
            upsertByName(next.pair, {
                names: String(p.names).trim(),
                mode: String(p.mode ?? prevRec?.mode ?? 'mode:stranger'),
                dam: String(p.dam ?? prevRec?.dam ?? 'E:s L:s Gate:dormant'),
                matrix: clampedMatrix,
                wall: String(p.wall ?? prevRec?.wall ?? 'wall:∅'),
            }, (x) => normPair(x.names) === pKey);
        }
        changedSections.add('pair');
    }

    // 10. Tracks
    if (delta.tracks && typeof delta.tracks === 'object') {
        if (delta.tracks.main !== undefined) next.tracks.main = String(delta.tracks.main);
        if (Array.isArray(delta.tracks.tracks)) next.tracks.tracks = delta.tracks.tracks.map(String);
        if (Array.isArray(delta.tracks.history)) next.tracks.history = delta.tracks.history.map(String);
        if (Array.isArray(delta.tracks.add_history)) {
            for (const h of delta.tracks.add_history) {
                if (!next.tracks.history.includes(String(h))) next.tracks.history.unshift(String(h));
            }
        }
        changedSections.add('tracks');
    }

    // 11. ARC
    if (delta.arc && typeof delta.arc === 'object') {
        if (delta.arc.info !== undefined) next.arc.info = String(delta.arc.info);
        if (delta.arc.timeline !== undefined) next.arc.timeline = String(delta.arc.timeline);
        for (const act of ['ki', 'sho', 'ten', 'ketsu']) {
            if (Array.isArray(delta.arc[act])) next.arc[act] = delta.arc[act].map(String);
        }
        changedSections.add('arc');
    }

    // 12. Chekhov (deterministic clear prior fired, age surviving chamber/locked, apply delta, cap 20)
    if (isTurnAdvance) {
        if (clearFiredOnTurn && next.chekhov.fired.length > 0) {
            next.chekhov.fired = [];
            changedSections.add('chekhov');
        }
        if (next.chekhov.chamber.length > 0) {
            next.chekhov.chamber = next.chekhov.chamber.map(ageBullet);
            changedSections.add('chekhov');
        }
        if (next.chekhov.locked.length > 0) {
            next.chekhov.locked = next.chekhov.locked.map(ageBullet);
            changedSections.add('chekhov');
        }
    }
    if (delta.chekhov_delta && typeof delta.chekhov_delta === 'object') {
        const cd = delta.chekhov_delta;
        const removeMatch = (arr, needles) => {
            if (!Array.isArray(needles) || !needles.length) return arr;
            const nLower = needles.map((n) => bulletTextKey(n));
            return arr.filter((b) => {
                const bk = bulletTextKey(b);
                return !nLower.some((nl) => bk.includes(nl) || nl.includes(bk));
            });
        };
        if (Array.isArray(cd.prune)) {
            next.chekhov.chamber = removeMatch(next.chekhov.chamber, cd.prune);
            next.chekhov.locked = removeMatch(next.chekhov.locked, cd.prune);
        }
        if (Array.isArray(cd.unlock)) {
            for (const u of cd.unlock) {
                const uk = bulletTextKey(u);
                const idx = next.chekhov.locked.findIndex((b) => bulletTextKey(b).includes(uk) || uk.includes(bulletTextKey(b)));
                const item = idx >= 0 ? next.chekhov.locked.splice(idx, 1)[0].replace(/\s*\[[^\]]+\]\s*$/, '') : String(u);
                next.chekhov.chamber.push(item);
            }
        }
        if (Array.isArray(cd.fire)) {
            for (const f of cd.fire) {
                const fk = bulletTextKey(f);
                next.chekhov.chamber = next.chekhov.chamber.filter((b) => !(bulletTextKey(b).includes(fk) || fk.includes(bulletTextKey(b))));
                next.chekhov.locked = next.chekhov.locked.filter((b) => !(bulletTextKey(b).includes(fk) || fk.includes(bulletTextKey(b))));
                next.chekhov.fired.push(String(f));
            }
        }
        if (Array.isArray(cd.add_chamber)) {
            for (const b of cd.add_chamber) {
                const s = String(b).trim();
                if (!isEmptySentinel(s) && !next.chekhov.chamber.some((x) => bulletTextKey(x) === bulletTextKey(s))) {
                    next.chekhov.chamber.push(/\bage\d+/i.test(s) ? s : `${s} | w2 age0`);
                }
            }
        }
        if (Array.isArray(cd.add_locked)) {
            for (const b of cd.add_locked) {
                const s = String(b).trim();
                if (!isEmptySentinel(s) && !next.chekhov.locked.some((x) => bulletTextKey(x) === bulletTextKey(s))) {
                    next.chekhov.locked.push(/\bage\d+/i.test(s) ? s : `${s} | w2 age0`);
                }
            }
        }
        next.chekhov.chamber = next.chekhov.chamber.slice(0, 20);
        next.chekhov.locked = next.chekhov.locked.slice(0, 20);
        next.chekhov.fired = next.chekhov.fired.slice(0, 20);
        changedSections.add('chekhov');
    }

    // 13. Inv
    if (delta.inv && typeof delta.inv === 'object') {
        for (const k of ['inv', 'titles', 'status']) {
            if (delta.inv[k] !== undefined) next.inv[k] = String(delta.inv[k]);
        }
        changedSections.add('inv');
    }

    // 14. Story Notes
    if (delta.story_notes && typeof delta.story_notes === 'object') {
        for (const k of ['threads', 'seeds', 'motives', 'horizon', 'GremlinNote', 'heckle']) {
            if (delta.story_notes[k] !== undefined) next.story_notes[k] = String(delta.story_notes[k]);
        }
        changedSections.add('story_notes');
    }

    // 15. Notebook (prepend newest entries, pin [R], cap 20)
    if (Array.isArray(delta.notebook_append) && delta.notebook_append.length > 0) {
        next.notebook = sortAndCapNotebook(
            [...delta.notebook_append.map(String), ...next.notebook],
            { pinRules: pinNotebookRules, cap: 20 },
        );
        changedSections.add('notebook');
    } else if (receipt?.ooc && !isEmptySentinel(receipt.ooc)) {
        const oocLine = /^\s*\[R\]/i.test(receipt.ooc) ? receipt.ooc : `[R] OOC: ${receipt.ooc}`;
        next.notebook = sortAndCapNotebook([oocLine, ...next.notebook], { pinRules: pinNotebookRules, cap: 20 });
        changedSections.add('notebook');
    }

    // 15b. Custom Trackers (worker patches ONLY on existing locked field keys + main-model proposals)
    if (Array.isArray(delta.custom_trackers_patch) && delta.custom_trackers_patch.length > 0) {
        let patchedAny = false;
        for (const item of delta.custom_trackers_patch) {
            if (!item || typeof item !== 'object') continue;
            const idNeedle = String(item.id || '').trim().toLowerCase();
            const titleNeedle = String(item.title || '').trim().toLowerCase();
            const tracker = next.custom_trackers.find((t) =>
                t && !t.archived && (
                    (idNeedle && String(t.id || '').toLowerCase() === idNeedle)
                    || (titleNeedle && String(t.title || '').toLowerCase() === titleNeedle)
                ),
            );
            if (!tracker) continue;

            const canonKeyByLower = new Map();
            if (tracker.fields && typeof tracker.fields === 'object') {
                for (const k of Object.keys(tracker.fields)) {
                    canonKeyByLower.set(k.toLowerCase(), k);
                }
            }
            if (item.patch && typeof item.patch === 'object') {
                for (const [pk, pv] of Object.entries(item.patch)) {
                    const canon = canonKeyByLower.get(String(pk || '').trim().toLowerCase());
                    if (!canon) continue; // Locked field keys: never let worker invent new keys
                    tracker.fields[canon] = String(pv ?? '').trim();
                    patchedAny = true;
                }
            }
            if (typeof item.notes === 'string' && item.notes.trim() && !isEmptySentinel(item.notes)) {
                tracker.notes = item.notes.trim();
                patchedAny = true;
            }
        }
        if (patchedAny) changedSections.add('custom_trackers');
    }

    if (allowTrackerProposals !== false && Array.isArray(receipt?.tracker_proposals) && receipt.tracker_proposals.length > 0) {
        const dismissedIds = new Set(next.dismissed_proposals.map((d) => String(d).toLowerCase()));
        const existingIds = new Set(next.custom_trackers.map((t) => String(t.id || '').toLowerCase()));
        const existingTitles = new Set(next.custom_trackers.map((t) => String(t.title || '').toLowerCase()));
        const pendingIds = new Set(next.tracker_proposals.map((p) => String(p.id || '').toLowerCase()));
        const pendingTitles = new Set(next.tracker_proposals.map((p) => String(p.title || '').toLowerCase()));

        for (const p of receipt.tracker_proposals) {
            if (!p || isEmptySentinel(p.title)) continue;
            const id = slugifyTrackerId(p.id || p.title);
            const titleLow = String(p.title).trim().toLowerCase();
            if (
                dismissedIds.has(id.toLowerCase())
                || existingIds.has(id.toLowerCase())
                || existingTitles.has(titleLow)
                || pendingIds.has(id.toLowerCase())
                || pendingTitles.has(titleLow)
            ) {
                continue;
            }
            const fields = capFieldsObject(p.fields);
            if (Object.keys(fields).length === 0) continue;

            if (autoAcceptTrackerProposals === true) {
                const activeCount = next.custom_trackers.filter((t) => t && !t.archived).length;
                if (activeCount < MAX_CUSTOM_TRACKERS) {
                    next.custom_trackers.push({
                        id,
                        title: String(p.title).trim(),
                        fields,
                        notes: String(p.reason || '').trim(),
                        archived: false,
                    });
                    existingIds.add(id.toLowerCase());
                    existingTitles.add(titleLow);
                    changedSections.add('custom_trackers');
                } else {
                    warnings.push(`Max custom trackers (${MAX_CUSTOM_TRACKERS}) reached; queued proposal "${p.title}" instead.`);
                    if (next.tracker_proposals.length < 5) {
                        next.tracker_proposals.push({ id, title: String(p.title).trim(), fields, reason: String(p.reason || '').trim(), turnCt: next.world?.ct || 0 });
                        pendingIds.add(id.toLowerCase());
                        pendingTitles.add(titleLow);
                        changedSections.add('custom_trackers');
                    }
                }
            } else if (next.tracker_proposals.length < 5) {
                next.tracker_proposals.push({
                    id,
                    title: String(p.title).trim(),
                    fields,
                    reason: String(p.reason || '').trim(),
                    turnCt: next.world?.ct || 0,
                });
                pendingIds.add(id.toLowerCase());
                pendingTitles.add(titleLow);
                changedSections.add('custom_trackers');
            }
        }
    }

    // 16. Vent & Receipt (always straight from main model)
    if (typeof vent === 'string' && vent.trim()) {
        next.vent = vent.trim();
        changedSections.add('vent');
    }
    if (receipt && receipt.raw) {
        next.lastReceipt = receipt;
    }

    return {
        state: next,
        diff: [...changedSections],
        warnings,
    };
}
