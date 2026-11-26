/**
 * Canonical Vexa schema constants, color palettes, theme palettes,
 * Braille normalization, time-header / dialogue-color / tail extractors.
 *
 * Pure ES module with zero DOM dependencies so it runs directly under Node tests.
 */

export const SECTIONS = Object.freeze([
    'world',
    'onscreen',
    'offscreen_agendas',
    'locations',
    'entityMem',
    'entity_state',
    'thoughts',
    'dam',
    'pair',
    'tracks',
    'arc',
    'chekhov',
    'inv',
    'story_notes',
    'notebook',
    'vent',
]);

export const PALETTE = Object.freeze([
    { name: 'cornflower', hex: '#56B4E9' },
    { name: 'marigold', hex: '#E69F00' },
    { name: 'jade', hex: '#009E73' },
    { name: 'orchid', hex: '#CC79A7' },
    { name: 'rust', hex: '#D55E00' },
    { name: 'citrine', hex: '#F0E442' },
    { name: 'lilac', hex: '#B39DDB' },
    { name: 'seafoam', hex: '#80CBC4' },
    { name: 'peach', hex: '#FFAB91' },
    { name: 'coral', hex: '#FF6B6B' },
    { name: 'matcha', hex: '#B8E986' },
    { name: 'electric', hex: '#00E5FF' },
    { name: 'periwinkle', hex: '#8FA8FF' },
    { name: 'fuchsia', hex: '#FF8FE0' },
    { name: 'mint', hex: '#A0E7A0' },
    { name: 'blush', hex: '#FFD1FF' },
]);

export const COLOR_TO_HEX = Object.freeze(
    Object.fromEntries(PALETTE.map((c) => [c.name, c.hex])),
);

export const HEX_TO_COLOR = Object.freeze(
    Object.fromEntries(PALETTE.map((c) => [c.hex.toUpperCase(), c.name])),
);

export const VEXA_STYLES = Object.freeze([
    'Afterglow',
    'Velvet',
    'Witchlight',
    'Scrapbook',
    'Undertow',
    'Signal',
]);

export const VEXA_THEMES = Object.freeze({
    'Sola': {
        base: '#1a1310', mantle: '#16100e', crust: '#120d0b', surface: '#2a201a',
        border: '#6a5d54', muted: '#a3948a', subtext: '#e8d6be', text: '#f0dcc4', title: '#fdf6f0',
        blue: '#f4a261', cyan: '#f3b74b', teal: '#7a8b99', green: '#9aa87a', yellow: '#f3b74b',
        orange: '#f4a261', red: '#ee6c4d', purple: '#8592e6', pink: '#f4845f', lavender: '#e9a036',
        scheme: 'dark',
    },
    'Afterglow': {
        base: '#2b2035', mantle: '#22192b', crust: '#19121f', surface: '#41304c',
        border: '#806589', muted: '#d2b7d7', subtext: '#d2b7d7', text: '#f5e7f3', title: '#f5e7f3',
        blue: '#ffbc96', cyan: '#e8a9db', teal: '#e8a9db', green: '#b9d59d', yellow: '#ebcf92',
        orange: '#ffbc96', red: '#ffa5aa', purple: '#d5b4ef', pink: '#ffbc96', lavender: '#e8a9db',
        scheme: 'dark',
    },
    'Velvet': {
        base: '#24151e', mantle: '#1d1018', crust: '#170c13', surface: '#39232f',
        border: '#795361', muted: '#cfb3c0', subtext: '#cfb3c0', text: '#f5e5ed', title: '#f5e5ed',
        blue: '#f6a6be', cyan: '#e8c681', teal: '#e8c681', green: '#b9d59d', yellow: '#ebcf92',
        orange: '#f6a6be', red: '#ffa5aa', purple: '#d5b4ef', pink: '#f6a6be', lavender: '#e8c681',
        scheme: 'dark',
    },
    'Witchlight': {
        base: '#16251e', mantle: '#101c16', crust: '#0c1510', surface: '#24392d',
        border: '#52745b', muted: '#b0c8b3', subtext: '#b0c8b3', text: '#e5efdf', title: '#e5efdf',
        blue: '#c8db85', cyan: '#e5c68a', teal: '#e5c68a', green: '#b9d59d', yellow: '#ebcf92',
        orange: '#c8db85', red: '#ffa5aa', purple: '#d5b4ef', pink: '#c8db85', lavender: '#e5c68a',
        scheme: 'dark',
    },
    'Scrapbook': {
        base: '#f7f2e8', mantle: '#ece4d4', crust: '#e2d7c2', surface: '#fffaf1',
        border: '#aa9284', muted: '#705956', subtext: '#705956', text: '#392d35', title: '#392d35',
        blue: '#923d60', cyan: '#426654', teal: '#426654', green: '#426654', yellow: '#805217',
        orange: '#923d60', red: '#a72e47', purple: '#754b85', pink: '#923d60', lavender: '#426654',
        scheme: 'light',
    },
    'Undertow': {
        base: '#102a2b', mantle: '#0b2021', crust: '#071819', surface: '#1e3c3c',
        border: '#4a7774', muted: '#afceca', subtext: '#afceca', text: '#e4f4ed', title: '#e4f4ed',
        blue: '#ffb399', cyan: '#8dd6c3', teal: '#8dd6c3', green: '#b9d59d', yellow: '#ebcf92',
        orange: '#ffb399', red: '#ffa5aa', purple: '#d5b4ef', pink: '#ffb399', lavender: '#8dd6c3',
        scheme: 'dark',
    },
    'Signal': {
        base: '#25231f', mantle: '#1b1a17', crust: '#141310', surface: '#37332b',
        border: '#80745b', muted: '#cec3a7', subtext: '#cec3a7', text: '#f4ecd9', title: '#f4ecd9',
        blue: '#ffcf79', cyan: '#b9d59d', teal: '#b9d59d', green: '#b9d59d', yellow: '#ebcf92',
        orange: '#ffcf79', red: '#ffa5aa', purple: '#d5b4ef', pink: '#ffcf79', lavender: '#b9d59d',
        scheme: 'dark',
    },
    'Catppuccin Mocha': {
        base: '#1e1e2e', mantle: '#181825', crust: '#11111b', surface: '#313244',
        border: '#585b70', muted: '#7f849c', subtext: '#a6adc8', text: '#cdd6f4', title: '#cdd6f4',
        blue: '#89b4fa', cyan: '#89dceb', teal: '#94e2d5', green: '#a6e3a1', yellow: '#f9e2af',
        orange: '#fab387', red: '#f38ba8', purple: '#cba6f7', pink: '#f5c2e7', lavender: '#b4befe',
        scheme: 'dark',
    },
    'Catppuccin Macchiato': {
        base: '#24273a', mantle: '#1e2030', crust: '#181926', surface: '#363a4f',
        border: '#5b6078', muted: '#8087a2', subtext: '#a5adcb', text: '#cad3f5', title: '#cad3f5',
        blue: '#8aadf4', cyan: '#91d7e3', teal: '#8bd5ca', green: '#a6da95', yellow: '#eed49f',
        orange: '#f5a97f', red: '#ed8796', purple: '#c6a0f6', pink: '#f5bde6', lavender: '#b7bdf8',
        scheme: 'dark',
    },
    'Catppuccin Frappé': {
        base: '#303446', mantle: '#292c3c', crust: '#232634', surface: '#414559',
        border: '#626880', muted: '#838ba7', subtext: '#a5adce', text: '#c6d0f5', title: '#c6d0f5',
        blue: '#8caaee', cyan: '#99d1db', teal: '#81c8be', green: '#a6d189', yellow: '#e5c890',
        orange: '#ef9f76', red: '#e78284', purple: '#ca9ee6', pink: '#f4b8e4', lavender: '#babbf1',
        scheme: 'dark',
    },
    'Catppuccin Latte': {
        base: '#eff1f5', mantle: '#e6e9ef', crust: '#dce0e8', surface: '#ccd0da',
        border: '#9ca0b0', muted: '#666980', subtext: '#555870', text: '#4c4f69', title: '#4c4f69',
        blue: '#1e66f5', cyan: '#04a5e5', teal: '#179299', green: '#40a02b', yellow: '#df8e1d',
        orange: '#fe640b', red: '#d20f39', purple: '#8839ef', pink: '#ea76cb', lavender: '#7287fd',
        scheme: 'light',
    },
    'Nord': {
        base: '#2e3440', mantle: '#3b4252', crust: '#2e3440', surface: '#434c5e',
        border: '#4c566a', muted: '#8c97ab', subtext: '#d8dee9', text: '#e5e9f0', title: '#eceff4',
        blue: '#81a1c1', cyan: '#88c0d0', teal: '#8fbcbb', green: '#a3be8c', yellow: '#ebcb8b',
        orange: '#d08770', red: '#bf616a', purple: '#b48ead', pink: '#b48ead', lavender: '#81a1c1',
        scheme: 'dark',
    },
    'Dracula': {
        base: '#282a36', mantle: '#21222c', crust: '#191a21', surface: '#44475a',
        border: '#6272a4', muted: '#929bc2', subtext: '#bdc1d6', text: '#f8f8f2', title: '#f8f8f2',
        blue: '#8be9fd', cyan: '#8be9fd', teal: '#8be9fd', green: '#50fa7b', yellow: '#f1fa8c',
        orange: '#ffb86c', red: '#ff5555', purple: '#bd93f9', pink: '#ff79c6', lavender: '#bd93f9',
        scheme: 'dark',
    },
    'Tokyo Night': {
        base: '#1a1b26', mantle: '#16161e', crust: '#13131a', surface: '#24283b',
        border: '#414868', muted: '#7982a9', subtext: '#9aa5ce', text: '#a9b1d6', title: '#c0caf5',
        blue: '#7aa2f7', cyan: '#7dcfff', teal: '#73daca', green: '#9ece6a', yellow: '#e0af68',
        orange: '#ff9e64', red: '#f7768e', purple: '#bb9af7', pink: '#f5a9c6', lavender: '#9aa5ce',
        scheme: 'dark',
    },
});

/** Replace Braille Pattern Blank (U+2800) with regular ASCII space. */
export function normalizeBraille(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/\u2800/g, ' ');
}

/** Decode common XML character entities inside parsed tag bodies. */
export function decodeXmlEntities(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'");
}

/** Encode &, <, > safely for XML output without double-escaping existing entities. */
export function encodeXmlText(text) {
    const s = String(text ?? '').trim();
    if (!s) return '';
    // Decode first so we never produce &amp;amp;
    const raw = decodeXmlEntities(s);
    return raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Strip inline <!-- GFX_START --> ... <!-- GFX_END --> HTML cards from prose. */
export function stripGfxBlocks(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/<!--[\s\u2800]*GFX_START[\s\u2800]*-->[\s\S]*?<!--[\s\u2800]*GFX_END[\s\u2800]*-->/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Strip <internal_states>, <vexa_tail>, and trailing GFX comments to leave pure story prose. */
export function extractStoryProse(text) {
    if (typeof text !== 'string') return '';
    let out = normalizeBraille(text);
    out = out.replace(/<internal_states>[\s\S]*?<\/internal_states>/gi, '');
    out = out.replace(/<vexa_tail>[\s\S]*?<\/vexa_tail>/gi, '');
    out = out.replace(/<!--\s*GFX_START\s*-->\s*<!--\s*GFX_END\s*-->/gi, '');
    out = out.replace(/<!--\s*GFX_(?:START|END)\s*-->\s*$/gi, '');
    out = stripGfxBlocks(out);
    return out.trim();
}

/**
 * Parse the top-of-reply Vexa Time Header:
 * [🕰️ HH:MM AM/PM | 🗓️ DayName, Month DD, YYYY | 📍 Location - Specific Area | [Emoji] Weather]
 */
export function parseTimeHeader(text) {
    const clean = normalizeBraille(text);
    const lines = clean.split(/\r?\n/).slice(0, 6);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('[') || !line.includes('|')) continue;
        if (!/🕰|🗓|📍|\b(?:AM|PM)\b/i.test(line)) continue;
        const inner = line.replace(/^\[/, '').replace(/\]$/, '');
        const parts = inner.split('|').map((p) => p.trim());
        const out = { raw: line, time: '', date: '', loc: '', weather: '' };
        for (const p of parts) {
            if (/^🕰️?/.test(p) || /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i.test(p)) {
                out.time = p.replace(/^🕰️?\s*/u, '').trim();
            } else if (/^🗓️?/.test(p)) {
                out.date = p.replace(/^🗓️?\s*/u, '').trim();
            } else if (/^📍/.test(p)) {
                out.loc = p.replace(/^📍\s*/u, '').trim();
            } else if (p) {
                out.weather = p.trim();
            }
        }
        if (out.time || out.date || out.loc) return out;
    }
    return null;
}

/**
 * Scan spoken dialogue color tags (<lilac:steady>"..."</lilac:steady>) in prose.
 * Returns array of { color, hex, fontColor, contextBefore, contextAfter, dialogue }.
 */
export function extractProseColors(text) {
    const clean = normalizeBraille(text);
    const colorNames = PALETTE.map((p) => p.name).join('|');
    const re = new RegExp(`<(?:color:)?(${colorNames})(?::([a-z0-9_:-]+))?>([\\s\\S]*?)<\\/\\s*(?:color:)?\\1(?::[a-z0-9_:-]+)?\\s*>`, 'gi');
    const found = [];
    let m;
    while ((m = re.exec(clean)) !== null) {
        const color = m[1].toLowerCase();
        const hex = COLOR_TO_HEX[color];
        if (!hex) continue;
        const before = clean.slice(Math.max(0, m.index - 80), m.index).replace(/\s+/g, ' ').trim();
        const after = clean.slice(m.index + m[0].length, m.index + m[0].length + 80).replace(/\s+/g, ' ').trim();
        found.push({
            color,
            hex,
            fontColor: `${color} ${hex}`,
            dialogue: m[3].trim(),
            contextBefore: before,
            contextAfter: after,
        });
    }
    return found;
}

/**
 * Extract <vexa_tail>...</vexa_tail> (with <vexa_receipt> and <state:vent>) from a reply.
 */
export function extractVexaTail(text) {
    const clean = normalizeBraille(text);
    const tailMatch = clean.match(/<vexa_tail>([\s\S]*?)<\/vexa_tail>/i);
    const body = tailMatch ? tailMatch[1] : clean;

    const receiptMatch = body.match(/<vexa_receipt>([\s\S]*?)<\/vexa_receipt>/i);
    const ventBlockMatch = body.match(/<state:vent>([\s\S]*?)<\/state:vent>/i)
        || clean.match(/<state:vent>([\s\S]*?)<\/state:vent>/i);

    let ventText = '';
    if (ventBlockMatch) {
        const inner = ventBlockMatch[1].match(/<vent>([\s\S]*?)<\/vent>/i);
        ventText = decodeXmlEntities((inner ? inner[1] : ventBlockMatch[1]).trim());
    } else if (tailMatch) {
        const directVent = body.match(/<vent>([\s\S]*?)<\/vent>/i);
        if (directVent) ventText = decodeXmlEntities(directVent[1].trim());
    }

    const receipt = {
        raw: receiptMatch ? decodeXmlEntities(receiptMatch[1].trim()) : '',
        world_sim: '',
        chekhov: '',
        arc: '',
        ooc: '',
        tracker_proposals: [],
    };

    if (receipt.raw) {
        for (const line of receipt.raw.split(/\r?\n/)) {
            const kv = line.match(/^\s*(world_sim|chekhov|arc|ooc|tracks|tracker_propose)\s*:\s*(.*)$/i);
            if (!kv) continue;
            const rawKey = kv[1].toLowerCase();
            const val = kv[2].trim();
            if (rawKey === 'tracker_propose') {
                const parsed = parseTrackerProposalLine(val);
                if (parsed) receipt.tracker_proposals.push(parsed);
                continue;
            }
            const key = rawKey === 'tracks' ? 'arc' : rawKey;
            receipt[key] = receipt[key] ? `${receipt[key]}; ${val}` : val;
        }
    }

    const hasEndMarker = /<!--\s*GFX_END\s*-->$/.test(clean.trim());

    return {
        hasTail: Boolean(tailMatch),
        hasReceipt: Boolean(receiptMatch),
        hasVent: Boolean(ventText),
        hasEndMarker,
        receipt,
        vent: ventText,
        rawTail: tailMatch ? tailMatch[0] : '',
    };
}

/** Empty persona health state (Nice Health Tab model). */
export function emptyHealth(bodyType = 'male') {
    return {
        bodyType: bodyType || 'male',
        bloodLoss: 0,
        pain: 0,
        wholeBody: [],
        parts: {},
    };
}

/** Empty canonical Vexa state matching all 16 sections. */
export function emptyState() {
    return {
        world: {
            ct: 0,
            loc: '',
            time: '',
            date: '',
            weather: '',
            room: '',
            user_pos: '',
            entries: '',
            obstacles: '',
            audio: '',
            pacing: 'FLOW',
        },
        onscreen: [],
        offscreen_agendas: [],
        locations: {
            map_index: {
                active_map_id: '∅',
                active_level: '0',
                maps: [],
            },
            rooms: [],
        },
        entityMem: [],
        entity_state: [],
        thoughts: [],
        dam: [],
        pair: [],
        tracks: {
            main: '',
            tracks: [],
            history: [],
        },
        arc: {
            info: '∅',
            timeline: '∅',
            ki: [],
            sho: [],
            ten: [],
            ketsu: [],
        },
        chekhov: {
            chamber: [],
            locked: [],
            fired: [],
        },
        inv: {
            inv: '',
            titles: '',
            status: '',
        },
        story_notes: {
            threads: '',
            seeds: '',
            motives: '',
            horizon: '',
            GremlinNote: '',
            heckle: '',
        },
        notebook: [],
        custom_trackers: [],
        tracker_proposals: [],
        dismissed_proposals: [],
        health: emptyHealth(),
        vent: '',
        lastReceipt: null,
    };
}

export function slugifyTrackerId(title) {
    const slug = String(title ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
    return slug || 'tracker';
}

export function parseTrackerProposalLine(rawLine) {
    if (isEmptySentinel(rawLine)) return null;
    const parts = normalizeBraille(String(rawLine)).split('|').map((p) => p.trim());
    const title = parts[0] || '';
    if (isEmptySentinel(title)) return null;

    const rawFields = parts[1] || '';
    const fields = {};
    let count = 0;
    for (const pair of rawFields.split(/\s*[,;]\s*/)) {
        if (!pair) continue;
        const m = pair.match(/^([^=:]+?)\s*[=:]\s*(.+)$/);
        if (!m) continue;
        const k = m[1].trim();
        const v = m[2].trim();
        if (!k || !v || isEmptySentinel(k)) continue;
        if (!(k in fields)) {
            if (count >= 8) break;
            count++;
        }
        fields[k] = v;
    }
    if (Object.keys(fields).length === 0) return null;

    const reason = parts.slice(2).join(' | ').trim();
    return {
        id: slugifyTrackerId(title),
        title,
        fields,
        reason: isEmptySentinel(reason) ? '' : reason,
    };
}

export function cloneState(state) {
    return JSON.parse(JSON.stringify(state || emptyState()));
}

export function isEmptySentinel(val) {
    const s = String(val ?? '').trim();
    return !s || s === '∅' || /^none$/i.test(s);
}
