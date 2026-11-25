/**
 * Full lossless parser and serializer for Vexa <internal_states> XML across all 16 sections,
 * plus Smart Scoping for main-model prompt injection and compact worker state projection.
 *
 * Pure ES module with zero DOM dependencies.
 */

import {
    SECTIONS,
    PALETTE,
    COLOR_TO_HEX,
    normalizeBraille,
    decodeXmlEntities,
    encodeXmlText,
    emptyState,
    cloneState,
    isEmptySentinel,
} from './schema.js';

function getSectionRaw(body, name) {
    const re = new RegExp(`<state:${name}\\b[^>]*>([\\s\\S]*?)<\\/state:${name}\\s*>`, 'i');
    const m = body.match(re);
    if (m) return m[1];
    // Tolerate a truncated closing tag up to the next <state: or </internal_states>
    const openRe = new RegExp(`<state:${name}\\b[^>]*>([\\s\\S]*?)(?=<state:|<\\/internal_states>|$)`, 'i');
    const om = body.match(openRe);
    return om ? om[1] : '';
}

function getAllBlocks(text, tagName) {
    const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}\\s*>`, 'gi');
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
        out.push(m[1]);
    }
    return out;
}

function getField(block, tagName) {
    const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}\\s*>`, 'i');
    const m = block.match(re);
    if (!m) return '';
    return decodeXmlEntities(m[1].trim());
}

function parseWorld(raw) {
    const w = emptyState().world;
    if (!raw) return w;
    const ctRaw = getField(raw, 'ct');
    const ctNum = parseInt(ctRaw, 10);
    w.ct = Number.isFinite(ctNum) ? ctNum : 0;
    for (const k of ['loc', 'time', 'date', 'weather', 'room', 'user_pos', 'entries', 'obstacles', 'audio', 'pacing']) {
        w[k] = getField(raw, k);
    }
    if (!w.pacing) w.pacing = 'FLOW';
    return w;
}

function parseOnscreen(raw) {
    if (!raw) return [];
    return getAllBlocks(raw, 'ent_on').map((blk) => ({
        name: getField(blk, 'name'),
        parrott: getField(blk, 'parrott'),
        residualMood: getField(blk, 'residualMood'),
        tfdy: getField(blk, 'tfdy'),
        salience: getField(blk, 'salience'),
        agenda: getField(blk, 'agenda'),
        why: getField(blk, 'why'),
        end: getField(blk, 'end'),
        move: getField(blk, 'move'),
    })).filter((e) => !isEmptySentinel(e.name));
}

function parseOffscreen(raw) {
    if (!raw) return [];
    return getAllBlocks(raw, 'ent_off').map((blk) => ({
        name: getField(blk, 'name'),
        loc: getField(blk, 'loc'),
        agenda: getField(blk, 'agenda'),
        why: getField(blk, 'why'),
        goal: getField(blk, 'goal'),
        end: getField(blk, 'end'),
        mood: getField(blk, 'mood'),
        tfdy: getField(blk, 'tfdy'),
        salience: getField(blk, 'salience'),
    })).filter((e) => !isEmptySentinel(e.name));
}

function parseLocations(raw) {
    const out = emptyState().locations;
    if (!raw) return out;
    const mapIdxRaw = getField(raw, 'map_index') || (raw.match(/<map_index>([\s\S]*?)<\/map_index>/i)?.[1] ?? '');
    if (mapIdxRaw) {
        out.map_index.active_map_id = getField(mapIdxRaw, 'active_map_id') || '∅';
        out.map_index.active_level = getField(mapIdxRaw, 'active_level') || '0';
        out.map_index.maps = getAllBlocks(mapIdxRaw, 'map').map((mBlk) => ({
            id: getField(mBlk, 'id'),
            name: getField(mBlk, 'name'),
            levels: getAllBlocks(mBlk, 'level').map((lBlk) => ({
                z: getField(lBlk, 'z'),
                name: getField(lBlk, 'name'),
            })),
            main_exit: getField(mBlk, 'main_exit') || '∅',
        })).filter((m) => !isEmptySentinel(m.id));
    }

    const rooms = [];
    const roomRe = /<loc_(rend|load)\b[^>]*>([\s\S]*?)<\/loc_\1\s*>/gi;
    let rm;
    while ((rm = roomRe.exec(raw)) !== null) {
        const kind = rm[1].toLowerCase();
        const rBlk = rm[2];
        const id = getField(rBlk, 'id');
        if (isEmptySentinel(id)) continue;
        const rawObjects = getField(rBlk, 'objects');
        let objects = [];
        if (rawObjects && !isEmptySentinel(rawObjects)) {
            try {
                const parsed = JSON.parse(rawObjects);
                if (Array.isArray(parsed)) objects = parsed;
            } catch {
                objects = [];
            }
        }
        rooms.push({
            id,
            kind,
            map_id: getField(rBlk, 'map_id') || '∅',
            name: getField(rBlk, 'name'),
            dim: getField(rBlk, 'dim'),
            bbox: getField(rBlk, 'bbox'),
            anchor: getField(rBlk, 'anchor') || '∅',
            features: getField(rBlk, 'features') || '∅',
            adj: getField(rBlk, 'adj') || '∅',
            grid: getField(rBlk, 'grid'),
            occupants: getField(rBlk, 'occupants') || '∅',
            exits: getField(rBlk, 'exits') || '∅',
            style: getField(rBlk, 'style') || '',
            objects,
        });
    }
    out.rooms = rooms;
    return out;
}

function parseEntityMem(raw) {
    if (!raw) return [];
    const byName = new Map();
    for (const blk of getAllBlocks(raw, 'ent_mem')) {
        const name = getField(blk, 'name');
        if (isEmptySentinel(name)) continue;
        const mems = getAllBlocks(blk, 'mem').map((m) => decodeXmlEntities(m.trim())).filter((m) => !isEmptySentinel(m));
        if (!byName.has(name)) byName.set(name, []);
        const list = byName.get(name);
        for (const entry of mems) {
            if (!list.includes(entry)) list.push(entry);
        }
    }
    return [...byName.entries()].map(([name, entries]) => ({ name, entries }));
}

function parseEntityState(raw) {
    if (!raw) return [];
    return getAllBlocks(raw, 'ent_col').map((blk) => ({
        name: getField(blk, 'name'),
        fontColor: getField(blk, 'fontColor'),
        look: getField(blk, 'look'),
        voice: getField(blk, 'voice'),
        persona: getField(blk, 'persona'),
        private: getField(blk, 'private'),
    })).filter((e) => !isEmptySentinel(e.name));
}

function parseThoughts(raw) {
    if (!raw) return [];
    return getAllBlocks(raw, 'ent_think').map((blk) => ({
        name: getField(blk, 'name'),
        tQ1: getField(blk, 'tQ1'),
        tQ2: getField(blk, 'tQ2'),
        tQ3: getField(blk, 'tQ3'),
        tQ4: getField(blk, 'tQ4'),
        tQ5: getField(blk, 'tQ5'),
    })).filter((e) => !isEmptySentinel(e.name));
}

function parseDam(raw) {
    if (!raw) return [];
    return getAllBlocks(raw, 'ent_dam').map((blk) => ({
        pair: getField(blk, 'pair'),
        sluice: getField(blk, 'sluice'),
        filters: getField(blk, 'filters'),
        misc: getField(blk, 'misc'),
        intent: getField(blk, 'intent'),
    })).filter((e) => !isEmptySentinel(e.pair));
}

function parsePair(raw) {
    if (!raw) return [];
    return getAllBlocks(raw, 'pair').map((blk) => ({
        names: getField(blk, 'names'),
        mode: getField(blk, 'mode'),
        dam: getField(blk, 'dam'),
        matrix: getField(blk, 'matrix'),
        wall: getField(blk, 'wall') || 'wall:∅',
    })).filter((e) => !isEmptySentinel(e.names));
}

function parseTracks(raw) {
    const out = emptyState().tracks;
    if (!raw) return out;
    out.main = getField(raw, 'main');
    out.tracks = getAllBlocks(raw, 'track').map((t) => decodeXmlEntities(t.trim())).filter((t) => !isEmptySentinel(t));
    out.history = getAllBlocks(raw, 'history').map((h) => decodeXmlEntities(h.trim())).filter((h) => !isEmptySentinel(h));
    return out;
}

function parseArc(raw) {
    const out = emptyState().arc;
    if (!raw) return out;
    out.info = getField(raw, 'info') || '∅';
    out.timeline = getField(raw, 'timeline') || '∅';
    for (const act of ['ki', 'sho', 'ten', 'ketsu']) {
        const actRaw = getField(raw, act);
        if (!actRaw) continue;
        out[act] = getAllBlocks(actRaw, 'beat')
            .map((b) => decodeXmlEntities(b.trim()))
            .filter((b) => !isEmptySentinel(b));
    }
    return out;
}

function parseChekhov(raw) {
    const out = emptyState().chekhov;
    if (!raw) return out;
    for (const bucket of ['chamber', 'locked', 'fired']) {
        const bRaw = getField(raw, bucket);
        if (!bRaw) continue;
        out[bucket] = getAllBlocks(bRaw, 'bullet')
            .map((b) => decodeXmlEntities(b.trim()))
            .filter((b) => !isEmptySentinel(b));
    }
    return out;
}

function parseInv(raw) {
    const out = emptyState().inv;
    if (!raw) return out;
    out.inv = getField(raw, 'inv');
    out.titles = getField(raw, 'titles');
    out.status = getField(raw, 'status');
    return out;
}

function parseStoryNotes(raw) {
    const out = emptyState().story_notes;
    if (!raw) return out;
    for (const k of ['threads', 'seeds', 'motives', 'horizon', 'GremlinNote', 'heckle']) {
        out[k] = getField(raw, k);
    }
    return out;
}

function parseNotebook(raw) {
    if (!raw) return [];
    return getAllBlocks(raw, 'ent')
        .map((e) => decodeXmlEntities(e.trim()))
        .filter((e) => !isEmptySentinel(e));
}

function parseVent(raw) {
    if (!raw) return '';
    return getField(raw, 'vent') || decodeXmlEntities(raw.trim());
}

function encodeXmlAttr(text) {
    return encodeXmlText(text).replace(/"/g, '&quot;');
}

function parseAttr(attrStr, attrName) {
    const m = String(attrStr || '').match(new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
    return m ? decodeXmlEntities((m[1] ?? m[2] ?? '').trim()) : '';
}

function parseCustomTrackers(raw) {
    if (!raw) return [];
    const out = [];
    const trRe = /<tracker\b([^>]*)>([\s\S]*?)<\/tracker\s*>/gi;
    let tm;
    while ((tm = trRe.exec(raw)) !== null) {
        const attrs = tm[1];
        const body = tm[2];
        const id = parseAttr(attrs, 'id');
        const title = parseAttr(attrs, 'title') || id;
        if (isEmptySentinel(title)) continue;
        const fields = {};
        const fRe = /<field\b([^>]*)>([\s\S]*?)<\/field\s*>/gi;
        let fm;
        while ((fm = fRe.exec(body)) !== null) {
            const fname = parseAttr(fm[1], 'name');
            if (!fname) continue;
            fields[fname] = decodeXmlEntities(fm[2].trim());
        }
        const notes = getField(body, 'notes');
        out.push({
            id: id || title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tracker',
            title,
            fields,
            notes,
            archived: false,
        });
    }
    return out;
}

/**
 * Parse a full <internal_states>...</internal_states> block from text.
 * Returns null if no <internal_states> block is present.
 */
export function parseInternalStates(rawText) {
    if (typeof rawText !== 'string' || !rawText) return null;
    const clean = normalizeBraille(rawText);
    const match = clean.match(/<internal_states\b[^>]*>([\s\S]*?)<\/internal_states\s*>/i)
        || clean.match(/<internal_states\b[^>]*>([\s\S]*)$/i);
    if (!match) return null;

    const body = match[1];
    // Require at least world or entity_state or locations to call it a valid state block
    if (!/<state:(world|locations|entity_state|onscreen)\b/i.test(body)) return null;

    const state = emptyState();
    state.world = parseWorld(getSectionRaw(body, 'world'));
    state.onscreen = parseOnscreen(getSectionRaw(body, 'onscreen'));
    state.offscreen_agendas = parseOffscreen(getSectionRaw(body, 'offscreen_agendas'));
    state.locations = parseLocations(getSectionRaw(body, 'locations'));
    state.entityMem = parseEntityMem(getSectionRaw(body, 'entityMem'));
    state.entity_state = parseEntityState(getSectionRaw(body, 'entity_state'));
    state.thoughts = parseThoughts(getSectionRaw(body, 'thoughts'));
    state.dam = parseDam(getSectionRaw(body, 'dam'));
    state.pair = parsePair(getSectionRaw(body, 'pair'));
    state.tracks = parseTracks(getSectionRaw(body, 'tracks'));
    state.arc = parseArc(getSectionRaw(body, 'arc'));
    state.chekhov = parseChekhov(getSectionRaw(body, 'chekhov'));
    state.inv = parseInv(getSectionRaw(body, 'inv'));
    state.story_notes = parseStoryNotes(getSectionRaw(body, 'story_notes'));
    state.notebook = parseNotebook(getSectionRaw(body, 'notebook'));
    state.custom_trackers = parseCustomTrackers(getSectionRaw(body, 'custom_trackers'));
    state.vent = parseVent(getSectionRaw(body, 'vent'));
    return state;
}

/** Parse numeric salience from strings like "sal:8" or "8". */
export function parseSalienceNumber(val) {
    const m = String(val ?? '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 5;
}

/** Determine which entities and maps are in active scope for prompt injection. */
export function computeScope(state, recentText = '') {
    const recentLower = normalizeBraille(String(recentText || '')).toLowerCase();
    const activeMapId = String(state?.locations?.map_index?.active_map_id || '').trim();
    const activeMaps = new Set();
    if (activeMapId && activeMapId !== '∅') activeMaps.add(activeMapId);

    const STOP_LOC_WORDS = new Set(['main', 'room', 'hall', 'tower', 'floor', 'ground', 'level', 'camp', 'shore', 'island', 'north', 'south', 'east', 'west', 'upper', 'lower', 'outer', 'inner']);
    const matchesAnyTerm = (str) => {
        if (!str || !recentLower) return false;
        const low = str.toLowerCase();
        if (recentLower.includes(low)) return true;
        const tokens = low.split(/[^a-z0-9]+/).filter((t) => t.length >= 5 && !STOP_LOC_WORDS.has(t));
        return tokens.some((t) => recentLower.includes(t));
    };

    for (const m of state?.locations?.map_index?.maps || []) {
        if (!m?.id) continue;
        if (matchesAnyTerm(m.id) || matchesAnyTerm(m.name)) {
            activeMaps.add(m.id);
        }
    }
    for (const r of state?.locations?.rooms || []) {
        if (!r?.map_id) continue;
        if (
            matchesAnyTerm(r.id)
            || matchesAnyTerm(r.name)
            || (r.occupants && !isEmptySentinel(r.occupants))
        ) {
            activeMaps.add(r.map_id);
        }
    }

    const activeEntities = new Set();
    for (const e of state?.onscreen || []) if (e.name) activeEntities.add(e.name.toLowerCase());
    for (const t of state?.thoughts || []) if (t.name) activeEntities.add(t.name.toLowerCase());
    for (const e of state?.offscreen_agendas || []) {
        if (!e.name) continue;
        const sal = parseSalienceNumber(e.salience);
        const isDormant = /\bDormant\b/i.test(e.loc || '');
        if ((!isDormant && sal > 2) || (recentLower && recentLower.includes(e.name.toLowerCase()))) {
            activeEntities.add(e.name.toLowerCase());
        }
    }
    for (const es of state?.entity_state || []) {
        if (es.name && recentLower.includes(es.name.toLowerCase())) {
            activeEntities.add(es.name.toLowerCase());
        }
    }
    // Always keep anyone present in any onscreen/offscreen/entity_state if activeEntities is empty
    return { activeMaps, activeEntities };
}

function entityMatchesPair(pairStr, activeEntities) {
    if (!pairStr) return false;
    const parts = String(pairStr).split(/→|↔/).map((s) => s.trim().toLowerCase());
    // Include pair if at least one non-user character in it is active (or both sides active)
    return parts.some((p) => activeEntities.has(p));
}

/**
 * Serialize canonical state back into Vexa's 16-section <internal_states> XML.
 * When `scoped` is true, inactive maps & dormant off-map NPCs not referenced recently
 * are collapsed to compact summary stubs while preserving full identity/color anchors.
 */
export function serializeInternalStates(state, { scoped = false, recentText = '', includeVent = false } = {}) {
    const s = state || emptyState();
    const { activeMaps, activeEntities } = scoped
        ? computeScope(s, recentText)
        : { activeMaps: null, activeEntities: null };

    const lines = ['<internal_states>'];

    // 1. world
    const w = s.world || {};
    lines.push('<state:world>');
    lines.push(`  <ct>${encodeXmlText(w.ct ?? 0)}</ct>`);
    for (const k of ['loc', 'time', 'date', 'weather', 'room', 'user_pos', 'entries', 'obstacles', 'audio', 'pacing']) {
        lines.push(`  <${k}>${encodeXmlText(w[k])}</${k}>`);
    }
    lines.push('</state:world>', '');

    // 2. onscreen
    lines.push('<state:onscreen>');
    for (const e of s.onscreen || []) {
        lines.push('  <ent_on>');
        for (const k of ['name', 'parrott', 'residualMood', 'tfdy', 'salience', 'agenda', 'why', 'end', 'move']) {
            lines.push(`    <${k}>${encodeXmlText(e[k])}</${k}>`);
        }
        lines.push('  </ent_on>');
    }
    lines.push('</state:onscreen>', '');

    // 3. offscreen_agendas
    lines.push('<state:offscreen_agendas>');
    const omittedOffscreen = [];
    for (const e of s.offscreen_agendas || []) {
        if (scoped && !activeEntities.has((e.name || '').toLowerCase())) {
            omittedOffscreen.push(`${e.name} @ ${e.loc || 'elsewhere'}`);
            continue;
        }
        lines.push('  <ent_off>');
        for (const k of ['name', 'loc', 'agenda', 'why', 'goal', 'end', 'mood', 'tfdy', 'salience']) {
            lines.push(`    <${k}>${encodeXmlText(e[k])}</${k}>`);
        }
        lines.push('  </ent_off>');
    }
    if (omittedOffscreen.length) {
        lines.push(`  <!-- Dormant off-map NPCs (full records preserved in store; name them to expand): ${omittedOffscreen.join(' | ')} -->`);
    }
    lines.push('</state:offscreen_agendas>', '');

    // 4. locations
    const loc = s.locations || { map_index: { active_map_id: '∅', active_level: '0', maps: [] }, rooms: [] };
    lines.push('<state:locations>');
    lines.push('  <map_index>');
    lines.push(`    <active_map_id>${encodeXmlText(loc.map_index?.active_map_id)}</active_map_id>`);
    lines.push(`    <active_level>${encodeXmlText(loc.map_index?.active_level ?? '0')}</active_level>`);
    for (const m of loc.map_index?.maps || []) {
        lines.push('    <map>');
        lines.push(`      <id>${encodeXmlText(m.id)}</id>`);
        lines.push(`      <name>${encodeXmlText(m.name)}</name>`);
        for (const lv of m.levels || []) {
            lines.push(`      <level><z>${encodeXmlText(lv.z)}</z><name>${encodeXmlText(lv.name)}</name></level>`);
        }
        lines.push(`      <main_exit>${encodeXmlText(m.main_exit)}</main_exit>`);
        lines.push('    </map>');
    }
    lines.push('  </map_index>');

    const omittedByMap = new Map();
    for (const r of loc.rooms || []) {
        if (scoped && activeMaps.size > 0 && !activeMaps.has(r.map_id)) {
            if (!omittedByMap.has(r.map_id)) omittedByMap.set(r.map_id, []);
            omittedByMap.get(r.map_id).push(r.id);
            continue;
        }
        const tag = r.kind === 'load' ? 'loc_load' : 'loc_rend';
        lines.push(`  <${tag}>`);
        for (const k of ['id', 'map_id', 'name', 'dim', 'bbox', 'anchor', 'features', 'adj', 'grid', 'occupants', 'exits']) {
            lines.push(`    <${k}>${encodeXmlText(r[k])}</${k}>`);
        }
        if (r.style && !isEmptySentinel(r.style)) {
            lines.push(`    <style>${encodeXmlText(r.style)}</style>`);
        }
        if (Array.isArray(r.objects) && r.objects.length > 0) {
            lines.push(`    <objects>${encodeXmlText(JSON.stringify(r.objects))}</objects>`);
        }
        lines.push(`  </${tag}>`);
    }
    for (const [mid, roomIds] of omittedByMap.entries()) {
        lines.push(`  <!-- Inactive map "${mid}" preserved in store (${roomIds.length} rooms: ${roomIds.join(', ')}) -->`);
    }
    lines.push('</state:locations>', '');

    // 5. entityMem
    lines.push('<state:entityMem>');
    for (const em of s.entityMem || []) {
        if (scoped && !activeEntities.has((em.name || '').toLowerCase())) continue;
        lines.push('  <ent_mem>');
        lines.push(`    <name>${encodeXmlText(em.name)}</name>`);
        for (const mem of (em.entries || []).slice(-20)) {
            lines.push(`    <mem>${encodeXmlText(mem)}</mem>`);
        }
        lines.push('  </ent_mem>');
    }
    lines.push('</state:entityMem>', '');

    // 6. entity_state
    lines.push('<state:entity_state>');
    const dormantColors = [];
    for (const es of s.entity_state || []) {
        if (scoped && !activeEntities.has((es.name || '').toLowerCase())) {
            dormantColors.push(`${es.name}: ${es.fontColor || 'unassigned'}`);
            continue;
        }
        lines.push('  <ent_col>');
        for (const k of ['name', 'fontColor', 'look', 'voice', 'persona', 'private']) {
            lines.push(`    <${k}>${encodeXmlText(es[k])}</${k}>`);
        }
        lines.push('  </ent_col>');
    }
    if (dormantColors.length) {
        lines.push(`  <!-- Locked colors for dormant NPCs (preserved in store): ${dormantColors.join(' | ')} -->`);
    }
    lines.push('</state:entity_state>', '');

    // 7. thoughts
    lines.push('<state:thoughts>');
    for (const th of s.thoughts || []) {
        lines.push('  <ent_think>');
        for (const k of ['name', 'tQ1', 'tQ2', 'tQ3', 'tQ4', 'tQ5']) {
            lines.push(`    <${k}>${encodeXmlText(th[k])}</${k}>`);
        }
        lines.push('  </ent_think>');
    }
    lines.push('</state:thoughts>', '');

    // 8. dam
    lines.push('<state:dam>');
    for (const d of s.dam || []) {
        if (scoped && !entityMatchesPair(d.pair, activeEntities)) continue;
        lines.push('  <ent_dam>');
        for (const k of ['pair', 'sluice', 'filters', 'misc', 'intent']) {
            lines.push(`    <${k}>${encodeXmlText(d[k])}</${k}>`);
        }
        lines.push('  </ent_dam>');
    }
    lines.push('</state:dam>', '');

    // 9. pair
    lines.push('<state:pair>');
    for (const p of s.pair || []) {
        if (scoped && !entityMatchesPair(p.names, activeEntities)) continue;
        lines.push('  <pair>');
        for (const k of ['names', 'mode', 'dam', 'matrix', 'wall']) {
            lines.push(`    <${k}>${encodeXmlText(p[k])}</${k}>`);
        }
        lines.push('  </pair>');
    }
    lines.push('</state:pair>', '');

    // 10. tracks
    const tr = s.tracks || {};
    lines.push('<state:tracks>');
    lines.push(`  <main>${encodeXmlText(tr.main)}</main>`);
    for (const t of tr.tracks || []) lines.push(`  <track>${encodeXmlText(t)}</track>`);
    for (const h of tr.history || []) lines.push(`  <history>${encodeXmlText(h)}</history>`);
    lines.push('</state:tracks>', '');

    // 11. arc
    const arc = s.arc || {};
    lines.push('<state:arc>');
    lines.push(`  <info>${encodeXmlText(arc.info)}</info>`);
    lines.push(`  <timeline>${encodeXmlText(arc.timeline)}</timeline>`);
    for (const act of ['ki', 'sho', 'ten', 'ketsu']) {
        lines.push(`  <${act}>`);
        const beats = arc[act] || [];
        if (beats.length) {
            for (const b of beats) lines.push(`    <beat>${encodeXmlText(b)}</beat>`);
        } else {
            lines.push('    <beat>∅</beat>');
        }
        lines.push(`  </${act}>`);
    }
    lines.push('</state:arc>', '');

    // 12. chekhov
    const ch = s.chekhov || {};
    lines.push('<state:chekhov>');
    for (const bucket of ['chamber', 'locked', 'fired']) {
        lines.push(`  <${bucket}>`);
        const bullets = ch[bucket] || [];
        if (bullets.length) {
            for (const b of bullets.slice(0, 20)) lines.push(`    <bullet>${encodeXmlText(b)}</bullet>`);
        } else {
            lines.push('    <bullet>∅</bullet>');
        }
        lines.push(`  </${bucket}>`);
    }
    lines.push('</state:chekhov>', '');

    // 13. inv
    const inv = s.inv || {};
    lines.push('<state:inv>');
    for (const k of ['inv', 'titles', 'status']) {
        lines.push(`  <${k}>${encodeXmlText(inv[k])}</${k}>`);
    }
    lines.push('</state:inv>', '');

    // 14. story_notes
    const sn = s.story_notes || {};
    lines.push('<state:story_notes>');
    for (const k of ['threads', 'seeds', 'motives', 'horizon', 'GremlinNote', 'heckle']) {
        lines.push(`  <${k}>${encodeXmlText(sn[k])}</${k}>`);
    }
    lines.push('</state:story_notes>', '');

    // 15. notebook
    lines.push('<state:notebook>');
    for (const ent of (s.notebook || []).slice(0, 20)) {
        lines.push(`  <ent>${encodeXmlText(ent)}</ent>`);
    }
    lines.push('</state:notebook>');

    // 15b. custom_trackers (emitted only when active trackers exist -> 0 token overhead otherwise)
    const activeTrackers = (s.custom_trackers || []).filter((t) => t && !t.archived && t.title);
    if (activeTrackers.length > 0) {
        lines.push('', '<state:custom_trackers>');
        for (const t of activeTrackers) {
            lines.push(`  <tracker id="${encodeXmlAttr(t.id)}" title="${encodeXmlAttr(t.title)}">`);
            for (const [fk, fv] of Object.entries(t.fields || {})) {
                lines.push(`    <field name="${encodeXmlAttr(fk)}">${encodeXmlText(fv)}</field>`);
            }
            if (t.notes && !isEmptySentinel(t.notes)) {
                lines.push(`    <notes>${encodeXmlText(t.notes)}</notes>`);
            }
            lines.push('  </tracker>');
        }
        lines.push('</state:custom_trackers>');
    }

    // 16. vent
    if (includeVent) {
        lines.push('', '<state:vent>');
        lines.push(`  <vent>${encodeXmlText(s.vent)}</vent>`);
        lines.push('</state:vent>');
    } else {
        lines.push('', '<state:vent><vent></vent></state:vent>');
    }

    lines.push('</internal_states>');
    return lines.join('\n');
}

/**
 * Compact JSON projection of canonical state for the secondary worker prompt.
 * Preserves all active IDs, coordinates, locked fontColors, and active/inactive summaries
 * so the worker emits accurate minimal deltas without paying 35KB context cost.
 */
export function serializeCompactForWorker(state) {
    const s = cloneState(state);
    const usedColors = [];
    for (const es of s.entity_state || []) {
        const m = String(es.fontColor || '').toLowerCase().match(new RegExp(`\\b(${PALETTE.map((p) => p.name).join('|')})\\b`));
        if (m && !usedColors.includes(m[1])) usedColors.push(m[1]);
    }
    const availableColors = PALETTE.filter((p) => !usedColors.includes(p.name)).map((p) => `${p.name} ${p.hex}`);

    const activeMapId = s.locations?.map_index?.active_map_id || '∅';
    const activeRooms = (s.locations?.rooms || [])
        .filter((r) => !activeMapId || activeMapId === '∅' || r.map_id === activeMapId)
        .map((r) => {
            const copy = { ...r };
            if (!copy.style) delete copy.style;
            if (!Array.isArray(copy.objects) || copy.objects.length === 0) delete copy.objects;
            return copy;
        });
    const otherRooms = (s.locations?.rooms || [])
        .filter((r) => activeMapId && activeMapId !== '∅' && r.map_id !== activeMapId)
        .map((r) => ({ id: r.id, map_id: r.map_id, name: r.name, occupants: r.occupants }));

    return {
        world: s.world,
        onscreen: s.onscreen,
        offscreen_agendas: s.offscreen_agendas,
        locations: {
            map_index: s.locations.map_index,
            active_rooms: activeRooms,
            inactive_room_stubs: otherRooms,
        },
        entityMem: (s.entityMem || []).map((em) => ({
            name: em.name,
            count: em.entries.length,
            recent: em.entries.slice(-5),
        })),
        entity_state: (s.entity_state || []).map((es) => ({
            name: es.name,
            fontColor: es.fontColor,
            persona: es.persona,
            private: es.private,
            hasLookAndVoice: Boolean(es.look && es.voice),
        })),
        thoughts_prev: (s.thoughts || []).map((t) => ({ name: t.name, tQ1: t.tQ1 })),
        dam: s.dam,
        pair: s.pair,
        tracks: s.tracks,
        arc: s.arc,
        chekhov: s.chekhov,
        inv: s.inv,
        story_notes: s.story_notes,
        notebook: s.notebook,
        ...(s.custom_trackers?.some((t) => t && !t.archived)
            ? {
                custom_trackers: s.custom_trackers
                    .filter((t) => t && !t.archived)
                    .map((t) => ({ id: t.id, title: t.title, fields: t.fields || {}, notes: t.notes || '' })),
            }
            : {}),
        availableColors,
    };
}

/** Validate a state object has all expected top-level sections. */
export function validateStateShape(state) {
    if (!state || typeof state !== 'object') return false;
    return SECTIONS.every((k) => k in state);
}
