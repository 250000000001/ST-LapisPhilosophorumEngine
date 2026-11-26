/**
 * Aether Matrix divergent bar renderer for Lapis Philosophorum Engine (<state:pair>).
 * Preserves the original Vexa 6-pair center-origin divergent bar design
 * alongside clear plain-English explanations and per-turn delta badges.
 * Pure ES module (zero DOM dependencies; testable under Node).
 */

import { isEmptySentinel } from './schema.js';

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

export const AETHER_AXIS_PAIRS = Object.freeze([
    {
        key: 'desire',
        cls: 'lpe-axis-desire',
        negEmoji: '😠',
        negAliases: ['😠', '😡', '🤬', '😤', '👿'],
        negLabel: 'Hate',
        negDesc: 'Visceral aversion, disgust, or rejection',
        posEmoji: '🌶️',
        posAliases: ['🌶️', '🌶'],
        posLabel: 'Desire',
        posDesc: 'Attraction, tension, or magnetic pull',
    },
    {
        key: 'play',
        cls: 'lpe-axis-play',
        negEmoji: '🥊',
        negAliases: ['🥊'],
        negLabel: 'Conflict',
        negDesc: 'Friction, sparring, or active antagonism',
        posEmoji: '🎲',
        posAliases: ['🎲'],
        posLabel: 'Playfulness',
        posDesc: 'Teasing, spontaneity, or shared humor',
    },
    {
        key: 'bond',
        cls: 'lpe-axis-bond',
        negEmoji: '❄️',
        negAliases: ['❄️', '❄'],
        negLabel: 'Hostility',
        negDesc: 'Coldness, suspicion, or defensive guard',
        posEmoji: '🤝',
        posAliases: ['🤝', '💛', '🫶', '🤗', '🛡️', '🛡'],
        posLabel: 'Friendship',
        posDesc: 'Trust, camaraderie, or warm rapport',
    },
    {
        key: 'endure',
        cls: 'lpe-axis-endure',
        negEmoji: '🪨',
        negAliases: ['🪨', '🌪️', '🌪'],
        negLabel: 'Stagnation',
        negDesc: 'Inertia, stalemate, or emotional fatigue',
        posEmoji: '🛠️',
        posAliases: ['🛠️', '🛠', '⚒️'],
        posLabel: 'Commitment',
        posDesc: 'Investment, reliability, and resolve',
    },
    {
        key: 'belong',
        cls: 'lpe-axis-belong',
        negEmoji: '🌫️',
        negAliases: ['🌫️', '🌫', '⬜', '😶'],
        negLabel: 'Indifference',
        negDesc: 'Detachment, distance, or emotional apathy',
        posEmoji: '🏠',
        posAliases: ['🏠', '🏡'],
        posLabel: 'Family',
        posDesc: 'Belonging, kinship, or protective bond',
    },
    {
        key: 'give',
        cls: 'lpe-axis-give',
        negEmoji: '🐍',
        negAliases: ['🐍', '🐉', '🐲', '🐊'],
        negLabel: 'Envy',
        negDesc: 'Resentment, rivalry, or self-serving tally',
        posEmoji: '🕊️',
        posAliases: ['🕊️', '🕊', '🪽'],
        posLabel: 'Selflessness',
        posDesc: 'Generosity, sacrifice, or unguarded care',
    },
]);

function normalizeEmojiToken(tok) {
    return String(tok || '').replace(/\uFE0F/g, '').trim();
}

function matchesAliases(tok, aliases) {
    const clean = normalizeEmojiToken(tok);
    if (!clean) return false;
    return aliases.some((a) => normalizeEmojiToken(a) === clean || clean.includes(normalizeEmojiToken(a)));
}

function parseAccValue(raw) {
    const clean = String(raw ?? '0').replace(/−/g, '-').trim();
    if (clean === '+') return 1;
    if (clean === '-') return -1;
    const n = parseInt(clean, 10);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Parse `<matrix>` string into 6 divergent axis-pair objects.
 * Supports both canonical emoji keys (`🤝`, `😠`, `🌫️`, `🐍`) and visual variants
 * seen in older prompts by falling back to the standard 12-slot order `[pos0..5, neg0..5]`.
 */
export function parseMatrixValues(matrixStr) {
    const raw = String(matrixStr ?? '').trim();
    if (!raw || isEmptySentinel(raw)) return [];

    const rx = /([^\s\[]+?)\s*\[\s*([+-]?\d+)\s*,\s*([+−-]?\d+|[+−-])\s*\]/gu;
    const tokens = [];
    let m;
    while ((m = rx.exec(raw)) !== null) {
        tokens.push({
            emoji: m[1].trim(),
            val: clamp(parseInt(m[2], 10) || 0, 0, 20),
            acc: parseAccValue(m[3]),
        });
    }
    if (!tokens.length) return [];

    const result = AETHER_AXIS_PAIRS.map((pair) => ({
        ...pair,
        neg: null,
        pos: null,
    }));

    const used = new Set();
    // Pass 1: exact emoji / alias match
    for (let t = 0; t < tokens.length; t++) {
        const tok = tokens[t];
        for (const row of result) {
            if (!row.pos && matchesAliases(tok.emoji, row.posAliases)) {
                row.pos = { ...tok, emoji: row.posEmoji, rawEmoji: tok.emoji };
                used.add(t);
                break;
            }
            if (!row.neg && matchesAliases(tok.emoji, row.negAliases)) {
                row.neg = { ...tok, emoji: row.negEmoji, rawEmoji: tok.emoji };
                used.add(t);
                break;
            }
        }
    }

    // Pass 2: positional fallback for unmapped emoji variants in 12-axis lists
    if (tokens.length >= 12) {
        for (let i = 0; i < 6; i++) {
            if (!result[i].pos && !used.has(i)) {
                const tok = tokens[i];
                result[i].pos = { ...tok, emoji: result[i].posEmoji, rawEmoji: tok.emoji };
                used.add(i);
            }
            if (!result[i].neg && !used.has(i + 6)) {
                const tok = tokens[i + 6];
                result[i].neg = { ...tok, emoji: result[i].negEmoji, rawEmoji: tok.emoji };
                used.add(i + 6);
            }
        }
    }

    return result;
}

export function parseDamFlags(damStr) {
    const s = String(damStr || '').trim();
    if (!s || isEmptySentinel(s)) return { e: '', l: '', gate: '' };
    const em = s.match(/\bE\s*:\s*\[?([a-z]+)\]?/i);
    const lm = s.match(/\bL\s*:\s*\[?([a-z]+)\]?/i);
    const gm = s.match(/\bGate\s*:\s*\[?([a-z-]+)\]?/i);
    const expandChan = (c) => {
        if (!c) return '';
        const low = c.toLowerCase();
        if (low === 'o') return 'open';
        if (low === 's') return 'sealed';
        return low;
    };
    return {
        e: expandChan(em?.[1] || ''),
        l: expandChan(lm?.[1] || ''),
        gate: gm?.[1] ? gm[1].toLowerCase() : '',
    };
}

function checkAxisWallConflict(pair, wallStr) {
    const w = String(wallStr || '').trim();
    if (!w || isEmptySentinel(w) || /^wall\s*:\s*(?:∅|none|clear)$/i.test(w)) return false;
    const allEmojis = [...pair.posAliases, ...pair.negAliases].map(normalizeEmojiToken);
    const normWall = normalizeEmojiToken(w);
    return allEmojis.some((e) => e && normWall.includes(e));
}

function cleanPairMeta(val, prefixRx) {
    const s = String(val || '').replace(prefixRx, '').trim();
    return s && !isEmptySentinel(s) ? s : '';
}

function fmtAcc(acc) {
    const n = Number(acc) || 0;
    return n > 0 ? `+${n}` : String(n);
}

function fmtDeltaBadge(curr, prev) {
    if (prev == null || curr == null) return '';
    const d = curr - prev;
    if (!d) return '';
    const cls = d > 0 ? 'up' : 'down';
    return `<span class="lpe-axis-delta ${cls}" title="Change since previous reply">${d > 0 ? `+${d}` : d}</span>`;
}

/**
 * Render the Aether Matrix cards HTML.
 * @param {Array} pairs current `state.pair` array
 * @param {Array|null} prevPairs previous turn's `state.pair` array for per-axis Δ badges
 * @param {{ showGuide?: boolean }} opts
 */
export function renderAetherMatrixList(pairs = [], prevPairs = null, { showGuide = true } = {}) {
    const list = Array.isArray(pairs) ? pairs : [];
    if (!list.length) return `<div class="lpe-empty">No Aether Pair matrices.</div>`;

    const prevByNames = new Map();
    if (Array.isArray(prevPairs)) {
        for (const pr of prevPairs) {
            const key = String(pr?.names || '').trim().toLowerCase();
            if (key) prevByNames.set(key, parseMatrixValues(pr.matrix));
        }
    }

    const guideHtml = showGuide ? `
        <details class="lpe-matrix-guide">
            <summary><i class="fa-solid fa-circle-info"></i> How to read the Aether Matrix &amp; Channels</summary>
            <div class="lpe-matrix-guide-body">
                <div><b>Divergent Bars (0–20):</b> Negative friction pulls <em>left</em> from center; positive pull grows <em>right</em>. Both poles coexist rather than canceling out (±2/turn cap; axes start ≥3).</div>
                <div><b>acc (Drift):</b> Cumulative push/decay pressure building toward a shift. Positive <code>+</code> builds charge; negative <code>−</code> decays it.</div>
                <div><b>E / L Channels:</b> <b>E</b> = emotional expression (behavior/tone), <b>L</b> = logical expression (spoken words). Values: <code>open</code> (flows) or <code>sealed</code> (suppressed).</div>
                <div><b>Gate &amp; Wall:</b> Feeling gate progresses <code>dormant → attentive → aware → longing → open</code> from earned events. A dashed yellow <b>Wall</b> flags mirrors locked in permission conflict.</div>
            </div>
        </details>
    ` : '';

    const cards = list.map((p) => {
        const modeVal = cleanPairMeta(p.mode, /^mode\s*:\s*/i) || '∅';
        const wallVal = cleanPairMeta(p.wall, /^wall\s*:\s*/i);
        const damFlags = parseDamFlags(p.dam);
        const axes = parseMatrixValues(p.matrix);
        const prevAxes = prevByNames.get(String(p.names || '').trim().toLowerCase()) || null;

        const damChips = (damFlags.e || damFlags.l || damFlags.gate)
            ? `
                ${damFlags.e ? `<span class="lpe-pill lpe-bond-chip" title="Emotional expression channel (behavior/affect): ${esc(damFlags.e)}">E: ${esc(damFlags.e)}</span>` : ''}
                ${damFlags.l ? `<span class="lpe-pill lpe-bond-chip" title="Logical expression channel (verbal candor): ${esc(damFlags.l)}">L: ${esc(damFlags.l)}</span>` : ''}
                ${damFlags.gate ? `<span class="lpe-pill lpe-bond-chip gate" title="Feeling Gate stage (dormant → attentive → aware → longing → open)">Gate: ${esc(damFlags.gate)}</span>` : ''}
            `
            : `<span class="lpe-pill lpe-bond-chip">${esc(p.dam || '∅')}</span>`;

        const hasValidAxes = axes.some((a) => a.pos || a.neg);
        let bodyHtml = '';
        if (hasValidAxes) {
            const rows = axes.map((ax, idx) => {
                const negVal = ax.neg?.val ?? 0;
                const posVal = ax.pos?.val ?? 0;
                const negAcc = ax.neg?.acc ?? 0;
                const posAcc = ax.pos?.acc ?? 0;
                const negPct = Math.min(50, Math.max(0, negVal * 2.5));
                const posPct = Math.min(50, Math.max(0, posVal * 2.5));
                const prevRow = prevAxes?.[idx] || null;
                const negDelta = (ax.neg?.val != null && prevRow?.neg?.val != null)
                    ? fmtDeltaBadge(negVal, prevRow.neg.val)
                    : '';
                const posDelta = (ax.pos?.val != null && prevRow?.pos?.val != null)
                    ? fmtDeltaBadge(posVal, prevRow.pos.val)
                    : '';
                const isWalled = checkAxisWallConflict(ax, wallVal);
                return `
                    <div class="lpe-axis-bar ${ax.cls}${isWalled ? ' is-walled' : ''}" data-axis="${esc(ax.posEmoji)}-${esc(ax.negEmoji)}">
                        <div class="lpe-axis-labels">
                            <span class="lpe-axis-side neg" title="${esc(ax.negDesc)}">
                                <span class="lpe-axis-name">${esc(ax.negEmoji)} ${esc(ax.negLabel)}</span>
                                <b>${negVal}</b>
                                ${negDelta}
                                <small class="${negAcc === 0 ? 'lpe-acc-zero' : 'lpe-acc-live'}">acc ${esc(fmtAcc(negAcc))}</small>
                            </span>
                            <span class="lpe-axis-side pos" title="${esc(ax.posDesc)}">
                                <small class="${posAcc === 0 ? 'lpe-acc-zero' : 'lpe-acc-live'}">acc ${esc(fmtAcc(posAcc))}</small>
                                ${posDelta}
                                <b>${posVal}</b>
                                <span class="lpe-axis-name">${esc(ax.posLabel)} ${esc(ax.posEmoji)}</span>
                            </span>
                        </div>
                        <div class="lpe-axis-track">
                            <span class="lpe-axis-fill neg" style="width:${negPct.toFixed(1)}%;"></span>
                            <span class="lpe-axis-fill pos" style="width:${posPct.toFixed(1)}%;"></span>
                        </div>
                    </div>
                `;
            }).join('');
            bodyHtml = `<div class="lpe-axis-stack">${rows}</div>`;
        } else {
            bodyHtml = `<div class="lpe-matrix">${esc(p.matrix || '∅')}</div>`;
        }

        const wallFooter = wallVal
            ? `<div class="lpe-bond-wall"><i class="fa-solid fa-triangle-exclamation"></i> Permission conflict wall: <b>${esc(wallVal)}</b></div>`
            : `<div class="lpe-bond-wall is-clear">Wall: clear (no active axis permission conflict)</div>`;

        return `
            <div class="lpe-subcard lpe-bond-card">
                <div class="lpe-subcard-head lpe-bond-head">
                    <strong>${esc(p.names)}</strong>
                    <span class="lpe-pill" title="Current interpersonal scene mode">${esc(modeVal)}</span>
                    ${damChips}
                    ${wallVal ? `<span class="lpe-pill warn" title="Conflicting axes routed through wall">wall: ${esc(wallVal)}</span>` : ''}
                </div>
                ${bodyHtml}
                ${wallFooter}
            </div>
        `;
    }).join('');

    return `<div class="lpe-stack">${guideHtml}${cards}</div>`;
}
