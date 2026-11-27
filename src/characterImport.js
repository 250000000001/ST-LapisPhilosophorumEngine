/**
 * Pure Pre-Game / Batch Character Import & Unified Character Editor helpers
 * for Lapis Philosophorum Engine (LPE).
 *
 * Zero DOM dependencies (runs directly under Node tests as well as SillyTavern browser UI).
 */

import { PALETTE, isEmptySentinel, isPlayerPersonaName, normalizeNameKey } from './schema.js';
import { parseMatrixValues } from './matrixView.js';
import { MATRIX_EMOJIS, parseOccupantsList } from './reducer.js';

export const BOND_AXIS_SPEC = Object.freeze([
    { emoji: MATRIX_EMOJIS[0], key: 'desire', label: 'Desire' },
    { emoji: MATRIX_EMOJIS[1], key: 'play', label: 'Playfulness' },
    { emoji: MATRIX_EMOJIS[2], key: 'friendship', label: 'Friendship' },
    { emoji: MATRIX_EMOJIS[3], key: 'commitment', label: 'Commitment' },
    { emoji: MATRIX_EMOJIS[4], key: 'family', label: 'Family' },
    { emoji: MATRIX_EMOJIS[5], key: 'selflessness', label: 'Selflessness' },
    { emoji: MATRIX_EMOJIS[6], key: 'hate', label: 'Hate' },
    { emoji: MATRIX_EMOJIS[7], key: 'conflict', label: 'Conflict' },
    { emoji: MATRIX_EMOJIS[8], key: 'hostility', label: 'Hostility' },
    { emoji: MATRIX_EMOJIS[9], key: 'stagnation', label: 'Stagnation' },
    { emoji: MATRIX_EMOJIS[10], key: 'indifference', label: 'Indifference' },
    { emoji: MATRIX_EMOJIS[11], key: 'envy', label: 'Envy' },
]);

function makeAxes(overrides = {}) {
    const out = {};
    for (const spec of BOND_AXIS_SPEC) {
        const n = Number(overrides[spec.key]);
        out[spec.key] = Number.isFinite(n) ? Math.max(3, Math.min(20, Math.round(n))) : 3;
    }
    return out;
}

export const BOND_PRESETS = Object.freeze({
    stranger: {
        id: 'stranger',
        label: 'Stranger',
        mode: 'mode:stranger',
        dam: 'E:s L:s Gate:dormant',
        wall: 'wall:∅',
        sluice: 'E:sealed L:sealed',
        axes: makeAxes({ indifference: 10 }),
    },
    guarded: {
        id: 'guarded',
        label: 'Guarded / Wary',
        mode: 'mode:guarded',
        dam: 'E:s L:o Gate:attentive',
        wall: 'wall:❄️',
        sluice: 'E:sealed L:open',
        axes: makeAxes({ hostility: 9, conflict: 6, commitment: 5 }),
    },
    ally: {
        id: 'ally',
        label: 'Trusted Ally',
        mode: 'mode:ally',
        dam: 'E:o L:o Gate:aware',
        wall: 'wall:∅',
        sluice: 'E:open L:open',
        axes: makeAxes({ friendship: 13, commitment: 12, play: 8, selflessness: 9 }),
    },
    close_friend: {
        id: 'close_friend',
        label: 'Close Friend',
        mode: 'mode:confidant',
        dam: 'E:o L:o Gate:open',
        wall: 'wall:∅',
        sluice: 'E:open L:open',
        axes: makeAxes({ friendship: 16, commitment: 15, play: 13, family: 11, selflessness: 14 }),
    },
    rival: {
        id: 'rival',
        label: 'Rival',
        mode: 'mode:rival',
        dam: 'E:o L:o Gate:aware',
        wall: 'wall:🥊',
        sluice: 'E:open L:open',
        axes: makeAxes({ conflict: 14, hostility: 10, envy: 11, commitment: 9, friendship: 6 }),
    },
    enemy: {
        id: 'enemy',
        label: 'Hostile / Enemy',
        mode: 'mode:hostile',
        dam: 'E:s L:s Gate:dormant',
        wall: 'wall:😠',
        sluice: 'E:sealed L:sealed',
        axes: makeAxes({ hate: 15, conflict: 16, hostility: 17, envy: 11 }),
    },
    romantic: {
        id: 'romantic',
        label: 'Romantic Spark',
        mode: 'mode:romantic',
        dam: 'E:o L:o Gate:longing',
        wall: 'wall:∅',
        sluice: 'E:open L:open',
        axes: makeAxes({ desire: 16, friendship: 14, play: 12, commitment: 13, selflessness: 12 }),
    },
    family: {
        id: 'family',
        label: 'Family / Kin',
        mode: 'mode:kin',
        dam: 'E:o L:o Gate:open',
        wall: 'wall:∅',
        sluice: 'E:open L:open',
        axes: makeAxes({ family: 17, commitment: 16, friendship: 13, selflessness: 14 }),
    },
});

export function resolveBondPreset(rawKey) {
    const k = String(rawKey || '').trim().toLowerCase();
    if (BOND_PRESETS[k]) return BOND_PRESETS[k];
    if (/close|best|confidant|companion/.test(k)) return BOND_PRESETS.close_friend;
    if (/ally|friend|trust|partner|comrade/.test(k)) return BOND_PRESETS.ally;
    if (/romant|lover|crush|flame|spouse|affection/.test(k)) return BOND_PRESETS.romantic;
    if (/fam|kin|sister|brother|sibling|parent|child|ward/.test(k)) return BOND_PRESETS.family;
    if (/rival|compet/.test(k)) return BOND_PRESETS.rival;
    if (/enem|hostil|hate|nemes|foe/.test(k)) return BOND_PRESETS.enemy;
    if (/guard|wary|suspici|cautiou|tense|cold/.test(k)) return BOND_PRESETS.guarded;
    return BOND_PRESETS.stranger;
}

export function buildMatrixStringFromAxes(axes = {}) {
    const clean = makeAxes(axes);
    return BOND_AXIS_SPEC.map((spec) => `${spec.emoji}[${clean[spec.key]},0]`).join(' ');
}

export function extractAxesFromMatrix(matrixStr = '') {
    const out = makeAxes();
    const rows = parseMatrixValues(matrixStr);
    if (!rows.length) return out;
    const keyMap = {
        desire: ['desire', 'hate'],
        play: ['play', 'conflict'],
        bond: ['friendship', 'hostility'],
        endure: ['commitment', 'stagnation'],
        belong: ['family', 'indifference'],
        give: ['selflessness', 'envy'],
    };
    for (const row of rows) {
        const pairKeys = keyMap[row.key];
        if (!pairKeys) continue;
        if (row.pos && Number.isFinite(row.pos.val)) {
            out[pairKeys[0]] = Math.max(3, Math.min(20, Math.round(row.pos.val)));
        }
        if (row.neg && Number.isFinite(row.neg.val)) {
            out[pairKeys[1]] = Math.max(3, Math.min(20, Math.round(row.neg.val)));
        }
    }
    return out;
}

function clampField(text, maxLen = 360) {
    const s = String(text ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{2,}/g, '; ')
        .replace(/\n/g, '; ')
        .trim();
    if (!s || isEmptySentinel(s)) return '';
    return s.length > maxLen ? `${s.slice(0, maxLen - 1).trimEnd()}…` : s;
}

function decodeBase64Utf8(b64) {
    const clean = String(b64 || '').replace(/\s+/g, '');
    if (!clean) return '';
    if (typeof Buffer === 'function') {
        return Buffer.from(clean, 'base64').toString('utf8');
    }
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Extract SillyTavern V2/V3 JSON metadata embedded inside PNG `tEXt` (`ccv3` / `chara`) chunks.
 */
export function extractCharaCardFromPngBytes(inputBytes) {
    let bytes = null;
    if (inputBytes instanceof Uint8Array) bytes = inputBytes;
    else if (inputBytes instanceof ArrayBuffer) bytes = new Uint8Array(inputBytes);
    else if (Array.isArray(inputBytes)) bytes = Uint8Array.from(inputBytes);
    if (!bytes || bytes.length < 24) return null;

    const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < 8; i++) {
        if (bytes[i] !== PNG_SIG[i]) return null;
    }

    let ccv3Payload = null;
    let charaPayload = null;
    let offset = 8;
    const decodeAscii = (start, end) => {
        let out = '';
        for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]);
        return out;
    };

    while (offset + 12 <= bytes.length) {
        const len = (
            ((bytes[offset] << 24) >>> 0)
            + (bytes[offset + 1] << 16)
            + (bytes[offset + 2] << 8)
            + bytes[offset + 3]
        ) >>> 0;
        const type = decodeAscii(offset + 4, offset + 8);
        const dataStart = offset + 8;
        const dataEnd = dataStart + len;
        if (dataEnd + 4 > bytes.length) break;

        if (type === 'tEXt') {
            let nulAt = -1;
            for (let i = dataStart; i < dataEnd; i++) {
                if (bytes[i] === 0) { nulAt = i; break; }
            }
            if (nulAt > dataStart) {
                const keyword = decodeAscii(dataStart, nulAt).trim().toLowerCase();
                if (keyword === 'ccv3' || keyword === 'chara') {
                    const b64 = decodeAscii(nulAt + 1, dataEnd);
                    try {
                        const parsed = JSON.parse(decodeBase64Utf8(b64));
                        if (parsed && typeof parsed === 'object') {
                            if (keyword === 'ccv3') ccv3Payload = parsed;
                            else if (!charaPayload) charaPayload = parsed;
                        }
                    } catch {
                        // Ignore malformed chunk payload
                    }
                }
            }
        } else if (type === 'IEND') {
            break;
        }
        offset = dataEnd + 4;
    }

    return ccv3Payload || charaPayload || null;
}

/**
 * Normalize a V1, V2 (`chara_card_v2`), or V3 (`chara_card_v3`) character card JSON object into a staged cast draft.
 */
export function normalizeCharacterCardV2V3(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const data = (obj.data && typeof obj.data === 'object' && obj.data.name) ? obj.data : obj;
    const name = String(data.name || '').trim();
    if (!name || isEmptySentinel(name)) return null;

    const tags = Array.isArray(data.tags) ? data.tags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 8) : [];
    const desc = String(data.description || '').replace(/\{\{char\}\}/gi, name);
    const personality = String(data.personality || '').replace(/\{\{char\}\}/gi, name);
    const scenario = String(data.scenario || '').replace(/\{\{char\}\}/gi, name);
    const mesEx = String(data.mes_example || '')
        .replace(/<START>/gi, '')
        .replace(/\{\{char\}\}/gi, name)
        .replace(/\r\n/g, '\n')
        .split('\n')
        .filter((l) => l.trim() && !/^\s*\{\{user\}\}\s*:/i.test(l))
        .slice(0, 3)
        .join(' / ');
    const priv = String(data.creator_notes || data.system_prompt || data.post_history_instructions || '')
        .replace(/\{\{char\}\}/gi, name);

    const lookText = clampField(desc, 260);
    const personaParts = [clampField(personality, 240)];
    if (tags.length) personaParts.push(`Tags: ${tags.join(', ')}`);
    const personaText = personaParts.filter(Boolean).join(' · ') || lookText;

    return {
        name,
        look: lookText,
        voice: clampField(mesEx, 220),
        persona: clampField(personaText, 320),
        private: clampField(priv, 260),
        agenda: clampField(scenario, 220),
        loc: '',
        roomId: '',
        pos: '',
        status: clampField(data.status || 'Staged pre-game cast', 160),
        presence: 'staged',
        preGameStaged: true,
        manual: true,
        pinned: true,
        bonds: [],
    };
}

/**
 * Parse a concise inline bond line into a normalized `{ target, mode, dam, wall, matrix, axes, sluice, filters, misc, intent }` entry.
 */
export function parseInlineBondLine(rawLine, defaultTarget = '{{user}}') {
    const clean = String(rawLine ?? '').replace(/^\s*[-*•]\s*/, '').trim();
    if (!clean || isEmptySentinel(clean)) return null;

    let target = String(defaultTarget || '{{user}}').trim() || '{{user}}';
    let body = clean;
    const colonIdx = clean.indexOf(':');
    const arrowIdx = clean.indexOf('->');
    const bidirIdx = clean.indexOf('↔');
    if (bidirIdx > 0) {
        const parts = clean.split('↔').map((x) => x.trim());
        target = parts[1] || parts[0] || target;
        body = '';
    } else if (arrowIdx > 0 && (colonIdx < 0 || arrowIdx < colonIdx)) {
        target = clean.slice(arrowIdx + 2).split(/[|:]/)[0].trim() || target;
        body = colonIdx >= 0 ? clean.slice(colonIdx + 1).trim() : '';
    } else if (colonIdx > 0 && colonIdx <= 60) {
        target = clean.slice(0, colonIdx).trim() || target;
        body = clean.slice(colonIdx + 1).trim();
    } else {
        const parenMatch = clean.match(/^([^(–—-]+?)\s*\(([^)]+)\)(?:\s*[-–—|:]\s*(.+))?$/);
        if (parenMatch) {
            target = parenMatch[1].trim();
            body = [parenMatch[2], parenMatch[3]].filter(Boolean).join(' | ');
        }
    }

    if (/^(?:you|player|pc|\{\{user\}\}|user)$/i.test(target)) {
        target = '{{user}}';
    }

    const preset = resolveBondPreset(body);
    const axes = { ...preset.axes };

    const axisAliases = {
        desire: 'desire', attraction: 'desire',
        play: 'play', playfulness: 'play', warmth: 'play',
        friend: 'friendship', friendship: 'friendship', trust: 'friendship', rapport: 'friendship', affection: 'friendship',
        commit: 'commitment', commitment: 'commitment', loyalty: 'commitment',
        family: 'family', kinship: 'family',
        selfless: 'selflessness', selflessness: 'selflessness', devotion: 'selflessness',
        hate: 'hate', hatred: 'hate', disgust: 'hate',
        conflict: 'conflict', tension: 'conflict', friction: 'conflict',
        hostility: 'hostility', distrust: 'hostility', suspicion: 'hostility',
        stagnation: 'stagnation',
        indifference: 'indifference', apathy: 'indifference',
        envy: 'envy', jealousy: 'envy', grudge: 'envy', resentment: 'envy',
    };
    const rxAxis = /\b([a-z]+)\s*(?:=|:|\s)\s*(\d{1,2})\b/gi;
    let mAxis;
    while ((mAxis = rxAxis.exec(body)) !== null) {
        const mapped = axisAliases[mAxis[1].toLowerCase()];
        if (mapped) {
            axes[mapped] = Math.max(3, Math.min(20, parseInt(mAxis[2], 10)));
        }
    }

    const modeMatch = body.match(/\bmode\s*:\s*([^\s|;,]+)/i);
    const mode = modeMatch ? `mode:${modeMatch[1].trim()}` : preset.mode;
    const intentParts = body.split(/\s*(?:\||;|—|–|\s-\s)\s*/).filter(Boolean);
    const intentRaw = intentParts.length > 1
        ? intentParts.slice(1).join(' | ')
        : (!modeMatch ? body : '');
    const cleanIntent = intentRaw.replace(/^intent\s*:\s*/i, '').trim();

    return {
        target,
        tier: preset.id,
        mode,
        dam: preset.dam,
        wall: preset.wall,
        sluice: preset.sluice,
        filters: '',
        misc: 'clash:— | T:no',
        intent: cleanIntent ? `intent:${cleanIntent}` : '',
        axes,
        matrix: buildMatrixStringFromAxes(axes),
    };
}

function normalizeColorValue(rawColor) {
    const c = String(rawColor ?? '').trim();
    if (!c || isEmptySentinel(c)) return '';
    const low = c.toLowerCase();
    const hit = PALETTE.find((p) => low === p.name || low === p.hex.toLowerCase() || low.includes(p.name));
    if (hit) return `${hit.name} ${hit.hex}`;
    const hex = c.match(/#[0-9a-f]{6}/i);
    if (hex) return `${c.replace(hex[0], '').trim() || 'custom'} ${hex[0].toUpperCase()}`.trim();
    return c;
}

function normalizeRawCandidateObject(raw, { defaultPresence = 'staged' } = {}) {
    if (!raw || typeof raw !== 'object') return null;
    if ((raw.spec && /^chara_card/i.test(raw.spec)) || (raw.data && typeof raw.data === 'object' && raw.data.name)) {
        return normalizeCharacterCardV2V3(raw);
    }

    const pick = (...keys) => {
        for (const k of keys) {
            if (raw[k] !== undefined && raw[k] !== null && String(raw[k]).trim() !== '') {
                return String(raw[k]).trim();
            }
        }
        return '';
    };

    const name = pick('name', 'character', 'char', 'npc', 'title');
    if (!name || isEmptySentinel(name)) return null;

    const rawPresence = pick('presence', 'stage').toLowerCase();
    const explicitStaged = raw.preGameStaged === true || raw.staged === true || rawPresence === 'staged';
    const explicitOnscreen = rawPresence === 'onscreen' || rawPresence === 'on-screen' || rawPresence === 'active';
    const explicitOffscreen = rawPresence === 'offscreen' || rawPresence === 'off-screen';

    let presence = defaultPresence === 'offscreen' ? 'offscreen' : 'staged';
    if (explicitOnscreen) presence = 'onscreen';
    else if (explicitOffscreen) presence = 'offscreen';
    else if (explicitStaged) presence = 'staged';

    const loc = pick('loc', 'location', 'zone', 'area', 'place');
    const roomId = pick('roomId', 'room_id', 'room');
    const pos = pick('pos', 'coords', 'coordinates');
    const look = clampField(pick('look', 'appearance', 'visual', 'desc', 'description'), 360);
    const voice = clampField(pick('voice', 'demeanor', 'speech', 'tone'), 280);
    const persona = clampField(pick('persona', 'personality', 'role', 'summary', 'traits', 'bio'), 380);
    const priv = clampField(pick('private', 'secrets', 'secret', 'boundaries', 'notes', 'hidden'), 320);
    const status = clampField(pick('status', 'state', 'condition', 'health', 'stamina', 'injury', 'injuries'), 240);
    const agenda = clampField(pick('agenda', 'activity', 'action', 'doing', 'plan'), 240);
    const mood = clampField(pick('mood', 'emotion', 'parrott'), 160);
    const residualMood = clampField(pick('residualMood', 'residual'), 140);
    const why = clampField(pick('why', 'motivation', 'motive'), 200);
    const goal = clampField(pick('goal', 'objective'), 200);
    const end = clampField(pick('end'), 160);
    const move = clampField(pick('move'), 160);
    const tfdy = pick('tfdy') || 'T2 F2 D2 Y2';
    const salience = pick('salience') || 'sal:5';
    const fontColor = normalizeColorValue(pick('fontColor', 'font_color', 'color'));

    const bonds = [];
    const rawBonds = raw.bonds ?? raw.relationships ?? raw.bond ?? raw.relations;
    if (Array.isArray(rawBonds)) {
        for (const b of rawBonds) {
            if (typeof b === 'string') {
                const parsed = parseInlineBondLine(b);
                if (parsed) bonds.push(parsed);
            } else if (b && typeof b === 'object') {
                const target = String(b.target || b.with || b.name || '{{user}}').trim() || '{{user}}';
                const preset = resolveBondPreset(b.tier || b.preset || b.mode || b.dynamic || '');
                const axes = b.axes && typeof b.axes === 'object'
                    ? makeAxes({ ...preset.axes, ...b.axes })
                    : (b.matrix ? extractAxesFromMatrix(b.matrix) : { ...preset.axes });
                bonds.push({
                    target: /^(?:you|player|pc|\{\{user\}\}|user)$/i.test(target) ? '{{user}}' : target,
                    tier: preset.id,
                    mode: b.mode ? String(b.mode) : preset.mode,
                    dam: b.dam ? String(b.dam) : preset.dam,
                    wall: b.wall ? String(b.wall) : preset.wall,
                    sluice: b.sluice ? String(b.sluice) : preset.sluice,
                    filters: String(b.filters || ''),
                    misc: String(b.misc || 'clash:— | T:no'),
                    intent: String(b.intent || b.notes || b.dynamic || ''),
                    axes,
                    matrix: b.matrix ? String(b.matrix) : buildMatrixStringFromAxes(axes),
                });
            }
        }
    } else if (typeof rawBonds === 'string' && rawBonds.trim()) {
        for (const piece of rawBonds.split(/\r?\n|\s*;\s*/)) {
            const parsed = parseInlineBondLine(piece);
            if (parsed) bonds.push(parsed);
        }
    }

    return {
        name,
        fontColor,
        look,
        voice,
        persona,
        private: priv,
        status,
        mood,
        residualMood,
        agenda,
        why,
        goal,
        end,
        move,
        tfdy,
        salience,
        loc,
        roomId,
        pos,
        presence,
        preGameStaged: presence === 'staged' || raw.preGameStaged === true,
        manual: raw.manual !== false,
        pinned: raw.pinned !== false,
        bonds,
    };
}

function splitTextBlocks(rawText) {
    const text = String(rawText ?? '').replace(/\r\n/g, '\n').trim();
    if (!text) return [];

    // 1. Explicit horizontal divider lines (`---`, `===`, `***`)
    if (/^\s*(?:---+|===+|\*\*\*+)\s*$/m.test(text)) {
        return text
            .split(/^\s*(?:---+|===+|\*\*\*+)\s*$/m)
            .map((b) => b.trim())
            .filter(Boolean);
    }

    // 2. Markdown headings (`# Elena Vance` or `## Character: Elena Vance`)
    const headingLines = text.match(/^\s*#{1,4}\s+.+$/gm) || [];
    if (headingLines.length >= 2) {
        const blocks = [];
        let cur = [];
        for (const line of text.split('\n')) {
            if (/^\s*#{1,4}\s+.+$/.test(line) && cur.some((l) => l.trim())) {
                blocks.push(cur.join('\n').trim());
                cur = [line];
            } else {
                cur.push(line);
            }
        }
        if (cur.some((l) => l.trim())) blocks.push(cur.join('\n').trim());
        return blocks;
    }

    // 3. Blank-line separated blocks (each block having `Name:` or standalone paragraph characters)
    return text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
}

const TEXT_FIELD_ALIASES = new Map([
    ['name', 'name'], ['character', 'name'], ['char', 'name'], ['npc', 'name'],
    ['role', 'persona'], ['summary', 'persona'], ['personality', 'persona'], ['persona', 'persona'], ['traits', 'persona'],
    ['look', 'look'], ['appearance', 'look'], ['visual', 'look'], ['description', 'look'],
    ['voice', 'voice'], ['demeanor', 'voice'], ['speech', 'voice'], ['tone', 'voice'],
    ['private', 'private'], ['secret', 'private'], ['secrets', 'private'], ['boundaries', 'private'], ['notes', 'private'],
    ['state', 'status'], ['status', 'status'], ['condition', 'status'], ['health', 'status'], ['stamina', 'status'], ['injury', 'status'], ['injuries', 'status'],
    ['agenda', 'agenda'], ['activity', 'agenda'], ['doing', 'agenda'], ['plan', 'agenda'],
    ['mood', 'mood'], ['emotion', 'mood'], ['parrott', 'mood'],
    ['residual', 'residualMood'], ['residualmood', 'residualMood'],
    ['why', 'why'], ['motivation', 'why'], ['motive', 'why'],
    ['goal', 'goal'], ['objective', 'goal'],
    ['end', 'end'],
    ['move', 'move'],
    ['salience', 'salience'],
    ['tfdy', 'tfdy'],
    ['location', 'location'], ['loc', 'location'], ['room', 'location'], ['zone', 'location'], ['area', 'location'],
    ['pos', 'pos'], ['coords', 'pos'], ['coordinates', 'pos'],
    ['bond', 'bonds'], ['bonds', 'bonds'], ['relationship', 'bonds'], ['relationships', 'bonds'], ['relations', 'bonds'],
    ['color', 'fontColor'], ['fontcolor', 'fontColor'], ['font_color', 'fontColor'],
    ['presence', 'presence'], ['stage', 'presence'], ['staged', 'presence'],
]);

function resolveTextFieldAlias(rawHeader) {
    const compact = String(rawHeader || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '');
    if (TEXT_FIELD_ALIASES.has(compact)) return TEXT_FIELD_ALIASES.get(compact);
    for (const seg of String(rawHeader || '').split(/[\/&|,]+/)) {
        const sub = seg.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '');
        if (TEXT_FIELD_ALIASES.has(sub)) return TEXT_FIELD_ALIASES.get(sub);
    }
    return null;
}

function parseSingleTextBlock(block, opts) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
    if (!lines.length) return null;

    const obj = {};
    const bondLines = [];
    let activeKey = null;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        // Markdown heading on line 0: `# Elena Vance` or `## Name: Elena Vance`
        const hdrMatch = i === 0 ? line.match(/^#{1,4}\s+(.+)$/) : null;
        if (hdrMatch) {
            const inner = hdrMatch[1].trim();
            const innerKv = inner.match(/^([^:]{2,30}):\s*(.+)$/);
            if (innerKv && resolveTextFieldAlias(innerKv[1]) === 'name') {
                obj.name = innerKv[2].trim();
            } else {
                obj.name = inner;
            }
            activeKey = null;
            continue;
        }

        // Strip list markers + bold markdown around key (`- **Personality:** ...`)
        const isBullet = /^\s*[-*•]\s+/.test(line);
        const cleanBullet = line.replace(/^\s*[-*•]\s+/, '').trim();
        const boldKv = cleanBullet.match(/^\*\*([^*:]{1,42}):?\*\*:?\s*(.*)$/)
            || cleanBullet.match(/^([A-Za-z][A-Za-z0-9 _\/&(),()-]{0,42}):\s*(.*)$/);
        const mappedHeader = boldKv ? resolveTextFieldAlias(boldKv[1]) : null;

        if (boldKv && mappedHeader && (!isBullet || activeKey !== 'bonds' || mappedHeader)) {
            const val = boldKv[2].trim();
            activeKey = mappedHeader;
            if (mappedHeader === 'bonds') {
                if (val) bondLines.push(val);
            } else if (val) {
                obj[mappedHeader] = obj[mappedHeader] ? `${obj[mappedHeader]}; ${val}` : val;
            }
            continue;
        }

        if (activeKey === 'bonds') {
            bondLines.push(cleanBullet);
        } else if (activeKey && activeKey !== 'name' && obj[activeKey] !== undefined) {
            obj[activeKey] = `${obj[activeKey]}; ${cleanBullet}`;
        } else if (i === 0 && !obj.name && !line.includes(':')) {
            obj.name = cleanBullet;
        }
    }

    if (bondLines.length) obj.bonds = bondLines;
    return normalizeRawCandidateObject(obj, opts);
}

function mergeCandidateObjects(prev, next) {
    const merged = { ...prev };
    for (const k of [
        'fontColor', 'look', 'voice', 'persona', 'private',
        'status', 'mood', 'residualMood', 'agenda', 'why', 'goal', 'end', 'move',
        'loc', 'roomId', 'pos',
    ]) {
        if (next[k] && !isEmptySentinel(next[k])) merged[k] = next[k];
    }
    if (next.tfdy && next.tfdy !== 'T2 F2 D2 Y2') merged.tfdy = next.tfdy;
    if (next.salience && next.salience !== 'sal:5') merged.salience = next.salience;
    if (next.presence === 'onscreen' || (next.presence === 'offscreen' && merged.presence === 'staged')) {
        merged.presence = next.presence;
    }
    merged.preGameStaged = merged.presence === 'staged';
    merged.manual = Boolean(prev.manual || next.manual);
    merged.pinned = Boolean(prev.pinned || next.pinned);

    const byTarget = new Map();
    for (const b of prev.bonds || []) byTarget.set(normalizeNameKey(b.target), b);
    for (const b of next.bonds || []) byTarget.set(normalizeNameKey(b.target), b);
    merged.bonds = [...byTarget.values()];
    return merged;
}

function findMatchingAtlasRoom(rooms = [], locHint = '', roomIdHint = '') {
    const idKey = normalizeNameKey(roomIdHint);
    const locKey = normalizeNameKey(locHint);
    if (!rooms.length) return null;
    if (idKey && idKey !== '∅') {
        const byId = rooms.find((r) => normalizeNameKey(r.id) === idKey || normalizeNameKey(r.name) === idKey);
        if (byId) return byId;
    }
    if (locKey && locKey !== '∅') {
        const byLocExact = rooms.find((r) => normalizeNameKey(r.id) === locKey || normalizeNameKey(r.name) === locKey);
        if (byLocExact) return byLocExact;
        const byLocSub = rooms.find((r) => {
            const rn = normalizeNameKey(r.name);
            return rn && (locKey.includes(rn) || rn.includes(locKey));
        });
        if (byLocSub) return byLocSub;
    }
    return null;
}

/**
 * Deduplicate parsed import candidates, resolve Atlas room placement, tag existing collisions,
 * and flag/exclude collisions with the human `{{user}}` persona.
 */
export function prepareImportPreview(rawCandidates = [], {
    existingState = null,
    userName = '',
    defaultPresence = 'staged',
    defaultRoomId = '',
} = {}) {
    const warnings = [];
    const deduped = new Map();

    for (const raw of rawCandidates) {
        if (!raw || !raw.name) continue;
        const key = normalizeNameKey(raw.name);
        if (!key) continue;
        if (deduped.has(key)) {
            deduped.set(key, mergeCandidateObjects(deduped.get(key), raw));
        } else {
            deduped.set(key, { ...raw, bonds: [...(raw.bonds || [])] });
        }
    }

    const rooms = existingState?.locations?.rooms || [];
    const existingNames = new Set([
        ...(existingState?.entity_state || []).map((e) => normalizeNameKey(e?.name)),
        ...(existingState?.onscreen || []).map((e) => normalizeNameKey(e?.name)),
        ...(existingState?.offscreen_agendas || []).map((e) => normalizeNameKey(e?.name)),
    ].filter(Boolean));
    const currentRoomHint = normalizeNameKey(existingState?.world?.room || '');
    const currentLocHint = normalizeNameKey(existingState?.world?.loc || '');

    const candidates = [];
    for (const [key, item] of deduped.entries()) {
        const matchedUser = isPlayerPersonaName(item.name, userName);
        if (matchedUser) {
            warnings.push(`Excluded "${item.name}" because it matches the active human player persona (${userName || 'user'}).`);
        }

        const matchedRoom = findMatchingAtlasRoom(rooms, item.loc, item.roomId || defaultRoomId);
        let roomId = matchedRoom ? matchedRoom.id : '';
        let presence = item.presence || (defaultPresence === 'offscreen' ? 'offscreen' : 'staged');

        if (!matchedRoom && defaultRoomId && !isEmptySentinel(defaultRoomId)) {
            const fallbackRoom = rooms.find((r) => r.id === defaultRoomId);
            if (fallbackRoom) roomId = fallbackRoom.id;
        }

        if (presence === 'staged' && roomId) {
            const rNameKey = normalizeNameKey(matchedRoom?.name || '');
            const rIdKey = normalizeNameKey(roomId);
            const inCurrentRoom = Boolean(
                (currentRoomHint && (currentRoomHint === rIdKey || currentRoomHint === rNameKey))
                || (currentLocHint && rNameKey && currentLocHint.includes(rNameKey)),
            );
            presence = inCurrentRoom ? 'onscreen' : 'offscreen';
        }
        if (presence === 'staged') {
            roomId = '';
        }

        const collision = matchedUser
            ? 'user'
            : (existingNames.has(key) ? 'existing' : 'new');

        candidates.push({
            ...item,
            roomId,
            loc: item.loc || (matchedRoom?.name || (presence === 'staged' ? 'Staged (Pre-Game)' : '')),
            presence,
            preGameStaged: presence === 'staged',
            manual: true,
            pinned: true,
            collision,
            collisionLabel: matchedUser
                ? 'Matches {{user}} (Excluded)'
                : collision === 'existing'
                    ? 'Merges Existing NPC'
                    : 'New Cast',
            selected: !matchedUser,
        });
    }

    return { candidates, warnings };
}

/**
 * Parse raw JSON or multi-character structured text/markdown into a preview list before commit.
 */
export function parseCharacterBatchInput(rawText, opts = {}) {
    const trimmed = String(rawText ?? '').trim();
    if (!trimmed) return { candidates: [], warnings: ['Paste JSON or structured character blocks first.'] };

    let parsedJson = null;
    const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
    const jsonCandidate = fence ? fence[1].trim() : trimmed;
    if (jsonCandidate.startsWith('{') || jsonCandidate.startsWith('[')) {
        try {
            parsedJson = JSON.parse(jsonCandidate.replace(/,\s*([}\]])/g, '$1'));
        } catch {
            parsedJson = null;
        }
    }

    const rawList = [];
    if (parsedJson !== null) {
        const items = Array.isArray(parsedJson)
            ? parsedJson
            : (
                parsedJson.characters
                || parsedJson.cast
                || parsedJson.npcs
                || parsedJson.entities
                || parsedJson.roster
                || parsedJson.members
                || [parsedJson]
            );
        for (const item of Array.isArray(items) ? items : [items]) {
            const norm = normalizeRawCandidateObject(item, opts);
            if (norm) rawList.push(norm);
        }
    } else {
        for (const block of splitTextBlocks(trimmed)) {
            const norm = parseSingleTextBlock(block, opts);
            if (norm) rawList.push(norm);
        }
    }

    const res = prepareImportPreview(rawList, opts);
    if (!res.candidates.length && !res.warnings.length) {
        res.warnings.push('No valid character blocks detected. Include at least a "Name:" line or JSON array of objects.');
    }
    return res;
}

/**
 * Parse uploaded `.png` (V2/V3 embedded chara card), `.json`, `.txt`, or `.md` character files.
 */
export function parseCharacterFiles(fileEntries = [], opts = {}) {
    const warnings = [];
    const rawList = [];

    for (const f of fileEntries || []) {
        const fname = String(f?.name || 'file');
        const low = fname.toLowerCase();
        if (low.endsWith('.png') || f?.bytes) {
            const cardObj = extractCharaCardFromPngBytes(f.bytes);
            const norm = normalizeCharacterCardV2V3(cardObj);
            if (norm) rawList.push(norm);
            else warnings.push(`No V2/V3 character card metadata found in "${fname}".`);
            continue;
        }
        if (typeof f?.text === 'string') {
            const sub = parseCharacterBatchInput(f.text, opts);
            rawList.push(...sub.candidates);
            if (sub.candidates.length === 0 && sub.warnings.length) {
                warnings.push(`${fname}: ${sub.warnings[0]}`);
            }
        }
    }

    const res = prepareImportPreview(rawList, opts);
    return {
        candidates: res.candidates,
        warnings: [...warnings, ...res.warnings],
    };
}

/**
 * Extract one unified editable character draft across entity_state, onscreen/offscreen_agendas,
 * Atlas room occupancy, pair, and dam records.
 */
export function extractCharacterRecord(state, charName, { userName = '' } = {}) {
    const s = state || {};
    const key = normalizeNameKey(charName);
    const es = (s.entity_state || []).find((x) => normalizeNameKey(x?.name) === key) || null;
    const on = (s.onscreen || []).find((x) => normalizeNameKey(x?.name) === key) || null;
    const off = (s.offscreen_agendas || []).find((x) => normalizeNameKey(x?.name) === key) || null;

    let roomId = '';
    let pos = '';
    for (const r of s.locations?.rooms || []) {
        const occ = parseOccupantsList(r?.occupants).find((o) => normalizeNameKey(o.name) === key);
        if (occ) {
            roomId = r.id;
            pos = occ.pos || '';
            break;
        }
    }

    const stagedFlag = Boolean(es?.preGameStaged || off?.preGameStaged);
    let presence = 'staged';
    if (on) presence = 'onscreen';
    else if (off) presence = (stagedFlag && !roomId) ? 'staged' : 'offscreen';
    else if (roomId) presence = 'offscreen';

    const bonds = [];
    const seenTargets = new Set();
    const resolveTargetDisplay = (rawTarget) => {
        if (userName && normalizeNameKey(rawTarget) === normalizeNameKey(userName)) {
            return userName;
        }
        return String(rawTarget || '').trim();
    };

    for (const p of s.pair || []) {
        const sides = String(p?.names || '').split('↔').map((x) => x.trim()).filter(Boolean);
        if (sides.length !== 2) continue;
        let other = null;
        if (normalizeNameKey(sides[0]) === key) other = sides[1];
        else if (normalizeNameKey(sides[1]) === key) other = sides[0];
        if (!other) continue;

        const targetDisplay = resolveTargetDisplay(other);
        const tKey = normalizeNameKey(targetDisplay);
        if (seenTargets.has(tKey)) continue;
        seenTargets.add(tKey);

        const damRec = (s.dam || []).find((d) => {
            const parts = String(d?.pair || '').split('->').map((x) => x.trim());
            return parts.length === 2
                && normalizeNameKey(parts[0]) === key
                && (normalizeNameKey(parts[1]) === tKey || (userName && normalizeNameKey(parts[1]) === '{{user}}' && tKey === normalizeNameKey(userName)));
        });

        bonds.push({
            target: targetDisplay,
            mode: p.mode || 'mode:stranger',
            dam: p.dam || 'E:s L:s Gate:dormant',
            wall: p.wall || 'wall:∅',
            matrix: p.matrix || buildMatrixStringFromAxes(),
            axes: extractAxesFromMatrix(p.matrix || ''),
            sluice: damRec?.sluice || 'E:sealed L:sealed',
            filters: damRec?.filters || '',
            misc: damRec?.misc || 'clash:— | T:no',
            intent: damRec?.intent || '',
        });
    }

    const resolvedName = es?.name || on?.name || off?.name || String(charName || '').trim();
    return {
        prevName: resolvedName,
        name: resolvedName,
        fontColor: es?.fontColor || '',
        look: es?.look || '',
        voice: es?.voice || '',
        persona: es?.persona || '',
        private: es?.private || '',
        presence,
        status: on?.status || off?.status || es?.status || '',
        mood: on?.parrott || off?.mood || '',
        residualMood: on?.residualMood || '',
        agenda: on?.agenda || off?.agenda || '',
        why: on?.why || off?.why || '',
        goal: off?.goal || '',
        end: on?.end || off?.end || '',
        move: on?.move || '',
        tfdy: on?.tfdy || off?.tfdy || 'T2 F2 D2 Y2',
        salience: on?.salience || off?.salience || 'sal:5',
        loc: off?.loc || '',
        roomId,
        pos,
        preGameStaged: presence === 'staged' || stagedFlag,
        manual: es ? es.manual !== false : true,
        pinned: es ? Boolean(es.pinned) : true,
        bonds,
    };
}

function normalizeBondForCommit(b, { charName, userName = '' } = {}) {
    const rawTarget = String(b?.target || '').trim();
    if (!rawTarget) return null;
    const isUserTarget = /^(?:you|player|pc|\{\{user\}\}|user)$/i.test(rawTarget)
        || isPlayerPersonaName(rawTarget, userName);
    const target = isUserTarget ? (String(userName || '').trim() || '{{user}}') : rawTarget;
    if (normalizeNameKey(target) === normalizeNameKey(charName)) return null;

    const axes = b.axes && typeof b.axes === 'object'
        ? makeAxes(b.axes)
        : extractAxesFromMatrix(b.matrix || '');
    const matrix = buildMatrixStringFromAxes(axes);

    return {
        target,
        mode: String(b.mode || 'mode:stranger').trim() || 'mode:stranger',
        dam: String(b.dam || 'E:s L:s Gate:dormant').trim() || 'E:s L:s Gate:dormant',
        wall: String(b.wall || 'wall:∅').trim() || 'wall:∅',
        matrix,
        sluice: String(b.sluice || 'E:sealed L:sealed').trim(),
        filters: String(b.filters || '').trim(),
        misc: String(b.misc || 'clash:— | T:no').trim(),
        intent: String(b.intent || '').trim(),
    };
}

/**
 * Convert a single edited character draft into a reducer delta `{ character_batch_upsert: [...] }`.
 */
export function buildCharacterUpsertDelta(draft, { prevName = '', userName = '', removedBondTargets = [] } = {}) {
    const name = String(draft?.name || '').trim();
    if (!name || isPlayerPersonaName(name, userName)) return {};

    const presence = ['onscreen', 'offscreen', 'staged'].includes(draft?.presence)
        ? draft.presence
        : 'staged';
    const bonds = [];
    for (const b of draft?.bonds || []) {
        const clean = normalizeBondForCommit(b, { charName: name, userName });
        if (clean) bonds.push(clean);
    }

    const removed = (removedBondTargets || [])
        .map((t) => {
            const raw = String(t || '').trim();
            if (/^(?:you|player|pc|\{\{user\}\}|user)$/i.test(raw) || isPlayerPersonaName(raw, userName)) {
                return String(userName || '').trim() || '{{user}}';
            }
            return raw;
        })
        .filter(Boolean);

    return {
        character_batch_upsert: [
            {
                ...(prevName && String(prevName).trim() !== name ? { prevName: String(prevName).trim() } : {}),
                name,
                fontColor: String(draft?.fontColor || '').trim(),
                look: String(draft?.look || '').trim(),
                voice: String(draft?.voice || '').trim(),
                persona: String(draft?.persona || '').trim(),
                private: String(draft?.private || '').trim(),
                presence,
                status: String(draft?.status || '').trim(),
                mood: String(draft?.mood || '').trim(),
                residualMood: String(draft?.residualMood || '').trim(),
                agenda: String(draft?.agenda || '').trim(),
                why: String(draft?.why || '').trim(),
                goal: String(draft?.goal || '').trim(),
                end: String(draft?.end || '').trim(),
                move: String(draft?.move || '').trim(),
                tfdy: String(draft?.tfdy || 'T2 F2 D2 Y2').trim(),
                salience: String(draft?.salience || 'sal:5').trim(),
                loc: String(draft?.loc || '').trim(),
                roomId: presence === 'staged' ? '' : String(draft?.roomId || '').trim(),
                pos: presence === 'staged' ? '' : String(draft?.pos || '').trim(),
                preGameStaged: presence === 'staged',
                manual: draft?.manual !== false,
                pinned: Boolean(draft?.pinned ?? true),
                bonds,
                ...(removed.length ? { removedBondTargets: removed } : {}),
            },
        ],
    };
}

/**
 * Convert multiple checked import candidates into a single reducer delta `{ character_batch_upsert: [...] }`.
 */
export function buildCharacterBatchDelta(candidates = [], { userName = '' } = {}) {
    const entries = [];
    for (const c of candidates || []) {
        if (c?.selected === false) continue;
        const sub = buildCharacterUpsertDelta(c, { userName });
        if (Array.isArray(sub.character_batch_upsert)) {
            entries.push(...sub.character_batch_upsert);
        }
    }
    return entries.length ? { character_batch_upsert: entries } : {};
}
