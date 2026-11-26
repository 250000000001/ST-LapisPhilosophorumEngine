/**
 * Clean-Room Scoped EJS Template Engine for Vexa State Engine.
 *
 * Original implementation under CC BY-NC 4.0.
 * Inspiration & Attribution:
 *   Dynamically evaluated EJS prompting & World Info logic inspired by ST-Prompt-Template
 *   by zonde306 (https://github.com/zonde306/ST-Prompt-Template).
 *   Zero code was copied from ST-Prompt-Template; compiled runtime, AST-free safety scanner,
 *   loop-budget instrumentation, dice roller, and Vexa state bindings are written from scratch.
 *
 * Pure ES module with zero DOM/npm dependencies so it runs identically in browser & Node tests.
 */

import { computeHealthMetrics, hasExplicitHealthData, inferHealthFromStatusText } from './healthDoll.js';

const DEFAULT_MAX_TEMPLATE_CHARS = 262144;
const DEFAULT_MAX_OUTPUT_CHARS = 262144;
const DEFAULT_MAX_LOOP_STEPS = 5000;
const COMPILE_CACHE_LIMIT = 128;

const FORBIDDEN_GLOBALS = new Set([
    'window',
    'document',
    'globalThis',
    'self',
    'top',
    'parent',
    'frames',
    'SillyTavern',
    'jQuery',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'Worker',
    'SharedWorker',
    'ServiceWorker',
    'Proxy',
    'Reflect',
    'eval',
    'Function',
    'AsyncFunction',
    'GeneratorFunction',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'cookieStore',
    'navigator',
    'location',
    'history',
    'performance',
    'process',
    'require',
    'module',
    'exports',
    'global',
    'importScripts',
    'fetch',
    'import',
    'arguments',
    'this',
    'super',
    'with',
    'debugger',
]);

const FORBIDDEN_PROTO_TOKENS = new Set([
    '__proto__',
    'constructor',
    'prototype',
    '__defineGetter__',
    '__defineSetter__',
    '__lookupGetter__',
    '__lookupSetter__',
]);

const FORBIDDEN_PROTO_REGEX = /\b(?:__proto__|constructor|prototype|__defineGetter__|__defineSetter__|__lookupGetter__|__lookupSetter__)\b/;

const JS_PREFIX_KEYWORDS = new Set([
    'return', 'case', 'throw', 'delete', 'void', 'typeof', 'await', 'yield',
    'else', 'do', 'in', 'of', 'instanceof', 'new', 'export', 'default',
    'const', 'let', 'var', 'import', 'extends', 'static',
]);

const SHADOWED_PARAMS = [
    'window', 'document', 'globalThis', 'self', 'top', 'parent', 'frames',
    'SillyTavern', 'jQuery', '$', 'XMLHttpRequest', 'WebSocket', 'EventSource',
    'Worker', 'SharedWorker', 'ServiceWorker', 'Proxy', 'Reflect',
    'Function', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator',
    'location', 'process', 'require', 'module', 'exports', 'global',
    'fetch', 'importScripts', 'setTimeout', 'setInterval', 'setImmediate',
    'queueMicrotask', 'WebAssembly',
];

const compileCache = new Map();

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function cloneJsonSafe(val, depth = 0) {
    if (depth > 24 || val === null || val === undefined) return val === null ? null : undefined;
    const t = typeof val;
    if (t === 'string' || t === 'boolean') return val;
    if (t === 'number') return Number.isFinite(val) ? val : null;
    if (Array.isArray(val)) return val.map((x) => cloneJsonSafe(x, depth + 1));
    if (t === 'object') {
        const out = {};
        for (const k of Object.keys(val)) {
            if (FORBIDDEN_PROTO_TOKENS.has(k)) continue;
            const c = cloneJsonSafe(val[k], depth + 1);
            if (c !== undefined) out[k] = c;
        }
        return out;
    }
    return undefined;
}

function deepFreeze(obj, seen = new WeakSet()) {
    if (!obj || typeof obj !== 'object' || seen.has(obj)) return obj;
    seen.add(obj);
    Object.freeze(obj);
    for (const k of Object.keys(obj)) {
        deepFreeze(obj[k], seen);
    }
    return obj;
}

function readDotPathSafe(root, pathStr) {
    if (!root || typeof root !== 'object' || typeof pathStr !== 'string') return undefined;
    const trimmed = pathStr.trim();
    if (!trimmed) return undefined;
    const segs = trimmed.split('.');
    let cur = root;
    for (const seg of segs) {
        if (!seg || FORBIDDEN_PROTO_TOKENS.has(seg) || !cur || typeof cur !== 'object') return undefined;
        if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
        cur = cur[seg];
    }
    return cur;
}

function safeBracketKey(k) {
    if (k === null || k === undefined) return k;
    const prim = (typeof k === 'string' || typeof k === 'number' || typeof k === 'boolean')
        ? k
        : String(k);
    const s = String(prim);
    if (FORBIDDEN_PROTO_TOKENS.has(s)) {
        throw new Error(`Blocked unsafe property access: ${s}`);
    }
    return prim;
}

/** O(1) quick tag pre-check for performance on non-EJS prompts/World Info. */
export function hasEjsTags(text) {
    return typeof text === 'string' && text.includes('<%');
}

/** Auto-yield to ST-Prompt-Template (`window.EjsTemplate`) when installed and auto-yield is enabled. */
export function shouldYieldEjs(settings) {
    if (settings?.ejsAutoYield === false) return false;
    return typeof globalThis.window !== 'undefined' && Boolean(globalThis.window?.EjsTemplate);
}

/**
 * Clean-room RPG dice expression roller supporting:
 * `NdS`, `NdS+K`, `NdS-K`, `NdSkhM`, `NdSklM` (capped at N<=100, S<=10000).
 * Returns a number-coercible summary object so `<%= roll('1d100') %>` and
 * `roll('1d20') + 5` both work naturally.
 */
export function rollDice(expr, rng = Math.random) {
    const raw = String(expr ?? '1d100').trim();
    const m = raw.match(/^(\d+)?d(\d+)(?:k([hl])(\d+))?(?:\s*([+-])\s*(\d{1,6}))?$/i);
    if (!m) {
        throw new Error(`Invalid dice expression "${raw}" (expected e.g. 1d100, 2d6+3, 4d6kh3)`);
    }
    const count = m[1] ? Number(m[1]) : 1;
    const sides = Number(m[2]);
    if (count < 1 || count > 100 || sides < 1 || sides > 10000) {
        throw new Error(`Dice bounds exceeded in "${raw}" (max 100 dice, 10000 sides)`);
    }
    const keepMode = m[3] ? m[3].toLowerCase() : null;
    const keepCount = m[4] ? Math.max(1, Math.min(count, Number(m[4]))) : count;
    const modifier = m[5] && m[6] ? (m[5] === '-' ? -Number(m[6]) : Number(m[6])) : 0;

    const rand = typeof rng === 'function' ? rng : Math.random;
    const rolls = [];
    for (let i = 0; i < count; i++) {
        const r = 1 + Math.floor(rand() * sides);
        rolls.push(Math.max(1, Math.min(sides, r)));
    }
    let kept = rolls.slice();
    if (keepMode === 'h') {
        kept = rolls.slice().sort((a, b) => b - a).slice(0, keepCount);
    } else if (keepMode === 'l') {
        kept = rolls.slice().sort((a, b) => a - b).slice(0, keepCount);
    }
    const total = kept.reduce((acc, n) => acc + n, 0) + modifier;
    return {
        total,
        rolls,
        kept,
        modifier,
        expr: raw,
        valueOf() { return this.total; },
        toString() { return String(this.total); },
    };
}

/** Scan past a single string/template/comment or JS construct starting at `i` inside EJS tag body. */
function findTagClose(src, startIdx) {
    let i = startIdx;
    const len = src.length;
    let quote = null;
    let inLineComment = false;
    let inBlockComment = false;
    let tplBraceDepth = 0;

    while (i < len) {
        const ch = src[i];
        const next = src[i + 1] || '';

        if (inLineComment) {
            if (ch === '\n' || ch === '\r') inLineComment = false;
            i++;
            continue;
        }
        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i += 2;
                continue;
            }
            i++;
            continue;
        }
        if (quote) {
            if (ch === '\\') {
                i += 2;
                continue;
            }
            if (quote === '`' && ch === '$' && next === '{') {
                tplBraceDepth++;
                quote = null;
                i += 2;
                continue;
            }
            if (ch === quote) {
                quote = null;
            }
            i++;
            continue;
        }

        if (ch === '%' && (next === '>' || (next === '%' && src[i + 2] === '>'))) {
            // Check for literal %%> vs closing %>
            if (next === '%' && src[i + 2] === '>') {
                i += 3;
                continue;
            }
        }
        if ((ch === '-' || ch === '_') && next === '%' && src[i + 2] === '>') {
            return { end: i, closeLen: 3, slurpMode: ch };
        }
        if (ch === '%' && next === '>') {
            return { end: i, closeLen: 2, slurpMode: null };
        }

        if (ch === '/' && next === '/') {
            inLineComment = true;
            i += 2;
            continue;
        }
        if (ch === '/' && next === '*') {
            inBlockComment = true;
            i += 2;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            quote = ch;
            i++;
            continue;
        }
        if (ch === '}' && tplBraceDepth > 0) {
            tplBraceDepth--;
            quote = '`';
            i++;
            continue;
        }
        i++;
    }
    return null;
}

/** Tokenize template into literal text & EJS tags. */
function tokenizeEjs(template) {
    const tokens = [];
    const len = template.length;
    let pos = 0;
    let textBuf = '';

    const flushText = () => {
        if (textBuf) {
            tokens.push({ type: 'text', value: textBuf });
            textBuf = '';
        }
    };

    while (pos < len) {
        const idx = template.indexOf('<', pos);
        if (idx < 0) {
            textBuf += template.slice(pos);
            break;
        }
        textBuf += template.slice(pos, idx);

        if (template[idx + 1] !== '%') {
            // Also unescape %%> in text
            textBuf += '<';
            pos = idx + 1;
            continue;
        }

        // Literal <%% escape
        if (template[idx + 2] === '%') {
            textBuf += '<%';
            pos = idx + 3;
            continue;
        }

        const mod = template[idx + 2] || '';
        let mode = 'exec';
        let bodyStart = idx + 2;
        let preSlurp = false;
        if (mod === '=' || mod === '-' || mod === '#') {
            mode = mod === '=' ? 'esc' : (mod === '-' ? 'raw' : 'comment');
            bodyStart = idx + 3;
        } else if (mod === '_') {
            preSlurp = true;
            bodyStart = idx + 3;
        }

        if (preSlurp) {
            textBuf = textBuf.replace(/[ \t]+$/, '');
        }
        flushText();

        const closed = findTagClose(template, bodyStart);
        if (!closed) {
            throw new Error(`Unclosed EJS tag "<%${mod}" near offset ${idx}`);
        }
        const rawCode = template.slice(bodyStart, closed.end).replace(/%%>/g, '%>');
        tokens.push({ type: mode, value: rawCode });
        pos = closed.end + closed.closeLen;

        if (closed.slurpMode === '-') {
            if (template[pos] === '\r' && template[pos + 1] === '\n') pos += 2;
            else if (template[pos] === '\n' || template[pos] === '\r') pos += 1;
        } else if (closed.slurpMode === '_') {
            while (pos < len && (template[pos] === ' ' || template[pos] === '\t')) pos++;
        }
    }

    flushText();
    // Handle escaped %%> inside literal text chunks
    for (const tok of tokens) {
        if (tok.type === 'text' && tok.value.includes('%%>')) {
            tok.value = tok.value.replace(/%%>/g, '%>');
        }
    }
    return tokens;
}

/**
 * Compile an EJS template string into a reusable callable `(env) => string` function
 * with LRU caching, strict sandbox scoping, and loop-step budgeting.
 */
export function compileEjs(template, {
    maxTemplateChars = DEFAULT_MAX_TEMPLATE_CHARS,
    maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS,
    maxSteps = DEFAULT_MAX_LOOP_STEPS,
    useCache = true,
} = {}) {
    if (typeof template !== 'string') {
        return { ok: false, error: 'Template must be a string', render: () => '' };
    }
    if (template.length > maxTemplateChars) {
        return {
            ok: false,
            error: `EJS template exceeds size cap (${template.length} > ${maxTemplateChars} chars)`,
            render: () => template,
        };
    }

    const effSteps = Math.max(1, Number(maxSteps) || DEFAULT_MAX_LOOP_STEPS);
    const effMaxOut = Math.max(64, Number(maxOutputChars) || DEFAULT_MAX_OUTPUT_CHARS);
    const cacheKey = `${effSteps}|${effMaxOut}|${template}`;
    if (useCache && compileCache.has(cacheKey)) {
        const cached = compileCache.get(cacheKey);
        compileCache.delete(cacheKey);
        compileCache.set(cacheKey, cached);
        return { ok: true, cached: true, render: cached };
    }

    try {
        const tokens = tokenizeEjs(template);
        const bodyParts = [
            '"use strict";',
            'const { vexa, state, vars, getvexa, getvar, setvar, roll, chance, pick, clamp, getwi, char, user, turn, __vseEsc, __vseKey, __vseStep, __vseAppend, __vseGetOut } = __vseEnv;',
            'return (function () {',
        ];

        for (const tok of tokens) {
            if (tok.type === 'text') {
                bodyParts.push(`__vseAppend(${JSON.stringify(tok.value)});`);
            } else if (tok.type === 'comment') {
                // Deliberately skipped
            } else if (tok.type === 'esc' || tok.type === 'raw') {
                const exprCode = compileJsForTag(tok.value.trim(), true);
                if (tok.type === 'esc') {
                    bodyParts.push(`__vseAppend(__vseEsc((${exprCode})));`);
                } else {
                    bodyParts.push(`__vseAppend((${exprCode}));`);
                }
            } else if (tok.type === 'exec') {
                const stmtCode = compileJsForTag(tok.value, false);
                bodyParts.push(stmtCode);
            }
        }
        bodyParts.push('return __vseGetOut();');
        bodyParts.push('})();');

        const compiledFn = new Function('__vseEnv', ...SHADOWED_PARAMS, bodyParts.join('\n'));
        const render = (env) => compiledFn(env);

        if (useCache) {
            if (compileCache.size >= COMPILE_CACHE_LIMIT) {
                const oldestKey = compileCache.keys().next().value;
                compileCache.delete(oldestKey);
            }
            compileCache.set(cacheKey, render);
        }
        return { ok: true, cached: false, render };
    } catch (err) {
        return { ok: false, error: err?.message || String(err), render: () => template };
    }
}

/**
 * Clean-room tokenizer-instrumentor pass for a single EJS tag body.
 * Separated so `for (init; cond; update)` checks every non-whitespace token reliably.
 */
function compileJsForTag(code, isExpression) {
    if (FORBIDDEN_PROTO_REGEX.test(code)) {
        const hit = code.match(FORBIDDEN_PROTO_REGEX)?.[0] || 'prototype';
        throw new Error(`Disallowed token "${hit}" inside EJS template`);
    }

    const src = code;
    const len = src.length;
    let i = 0;
    let out = '';

    let lastKind = 'sep';
    let prevIdent = '';
    const stack = [];
    let tplDepth = 0;
    let pendingLoop = null;

    const isIdentStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
    const isIdentPart = (c) => isIdentStart(c) || (c >= '0' && c <= '9');

    const noteCondToken = () => {
        const top = stack[stack.length - 1];
        if (top && top.inForCond) top.forHasCondExpr = true;
    };

    while (i < len) {
        const ch = src[i];
        const next = src[i + 1] || '';

        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            out += ch;
            i++;
            continue;
        }

        if (ch === '/' && next === '/') {
            const start = i;
            i += 2;
            while (i < len && src[i] !== '\n' && src[i] !== '\r') i++;
            out += src.slice(start, i);
            continue;
        }

        if (ch === '/' && next === '*') {
            const start = i;
            i += 2;
            while (i < len && !(src[i] === '*' && src[i + 1] === '/')) i++;
            if (i < len) i += 2;
            out += src.slice(start, i);
            continue;
        }

        // Regex literal when `/` appears after separator/keyword rather than division
        if (ch === '/' && (lastKind === 'sep' || lastKind === 'keyword')) {
            noteCondToken();
            const start = i++;
            let inCharClass = false;
            while (i < len) {
                const rc = src[i];
                if (rc === '\\') { i += 2; continue; }
                if (rc === '[' && !inCharClass) { inCharClass = true; i++; continue; }
                if (rc === ']' && inCharClass) { inCharClass = false; i++; continue; }
                if (rc === '/' && !inCharClass) {
                    i++;
                    while (i < len && ((src[i] >= 'a' && src[i] <= 'z') || (src[i] >= 'A' && src[i] <= 'Z'))) i++;
                    break;
                }
                if (rc === '\n' || rc === '\r') break;
                i++;
            }
            out += src.slice(start, i);
            lastKind = 'value_end';
            continue;
        }

        if (pendingLoop && pendingLoop.awaitingBlock && ch !== '{') {
            throw new Error('Braceless for..of / for..in loops must use { ... } blocks inside EJS templates');
        }
        if (pendingLoop && pendingLoop.kind === 'do' && ch !== '{') {
            throw new Error('Braceless do..while loops must use { ... } blocks inside EJS templates');
        }

        if (ch === "'" || ch === '"') {
            noteCondToken();
            const q = ch;
            const start = i++;
            while (i < len) {
                if (src[i] === '\\') { i += 2; continue; }
                if (src[i] === q) { i++; break; }
                i++;
            }
            out += src.slice(start, i);
            lastKind = 'value_end';
            continue;
        }

        if (ch === '`') {
            noteCondToken();
            const start = i++;
            let closed = false;
            while (i < len) {
                if (src[i] === '\\') { i += 2; continue; }
                if (src[i] === '$' && src[i + 1] === '{') {
                    tplDepth++;
                    stack.push({ ch: '${' });
                    i += 2;
                    break;
                }
                if (src[i] === '`') { i++; closed = true; break; }
                i++;
            }
            out += src.slice(start, i);
            lastKind = closed ? 'value_end' : 'sep';
            continue;
        }

        if (isIdentStart(ch) || (ch === '\\' && next === 'u')) {
            noteCondToken();
            if (ch === '\\') throw new Error('Unicode identifier escapes are not allowed inside EJS templates');
            const start = i;
            while (i < len && (isIdentPart(src[i]) || (src[i] === '\\' && src[i + 1] === 'u'))) {
                if (src[i] === '\\') throw new Error('Unicode identifier escapes are not allowed inside EJS templates');
                i++;
            }
            const ident = src.slice(start, i);
            if (ident.startsWith('__vse')) {
                throw new Error(`Reserved internal identifier "${ident}" is not allowed inside EJS templates`);
            }
            if (FORBIDDEN_PROTO_TOKENS.has(ident)) {
                throw new Error(`Disallowed token "${ident}" inside EJS template`);
            }
            if (FORBIDDEN_GLOBALS.has(ident)) {
                throw new Error(`Disallowed global or keyword "${ident}" inside EJS template`);
            }
            if (ident === 'class') throw new Error('Class declarations are not allowed inside EJS templates');
            if (ident === 'while' || ident === 'for' || ident === 'do') {
                pendingLoop = { kind: ident, expectingParen: ident !== 'do' };
            }
            out += ident;
            prevIdent = ident;
            lastKind = JS_PREFIX_KEYWORDS.has(ident) || ident === 'if' || ident === 'while' || ident === 'for' || ident === 'switch' || ident === 'catch'
                ? 'keyword'
                : 'ident';
            continue;
        }

        if (ch >= '0' && ch <= '9') {
            noteCondToken();
            const start = i;
            while (i < len && (isIdentPart(src[i]) || (src[i] === '.' && src[i + 1] >= '0' && src[i + 1] <= '9'))) i++;
            out += src.slice(start, i);
            lastKind = 'value_end';
            continue;
        }

        if (ch === '[') {
            noteCondToken();
            const top = stack[stack.length - 1];
            const isComputedObjKey = top?.ch === '{' && (lastKind === 'sep');
            const isBracketAccess = lastKind === 'ident' || lastKind === 'value_end' || lastKind === 'dot';
            const guardKey = isBracketAccess || isComputedObjKey;
            out += guardKey ? '[__vseKey(' : '[';
            stack.push({ ch: '[', guarded: guardKey });
            i++;
            lastKind = 'sep';
            continue;
        }

        if (ch === ']') {
            noteCondToken();
            const top = stack.length ? stack[stack.length - 1] : null;
            if (top && top.ch === '[') stack.pop();
            out += top?.guarded ? ')]' : ']';
            i++;
            lastKind = 'value_end';
            continue;
        }

        if (ch === '(') {
            noteCondToken();
            const frame = { ch: '(' };
            if (pendingLoop && pendingLoop.expectingParen) {
                frame.loopKind = pendingLoop.kind;
                if (pendingLoop.kind === 'for') {
                    frame.forSemicolons = 0;
                }
                pendingLoop = null;
            }
            stack.push(frame);
            out += '(';
            if (frame.loopKind === 'while') {
                out += '__vseStep(),(';
            }
            i++;
            lastKind = 'sep';
            continue;
        }

        if (ch === ';') {
            const top = stack[stack.length - 1];
            if (top && top.ch === '(' && top.loopKind === 'for') {
                if (top.forSemicolons === 0) {
                    top.forSemicolons = 1;
                    out += '; __vseStep(), (';
                    top.inForCond = true;
                    top.forHasCondExpr = false;
                    i++;
                    lastKind = 'sep';
                    continue;
                }
                if (top.forSemicolons === 1) {
                    top.forSemicolons = 2;
                    if (!top.forHasCondExpr) out += 'true';
                    out += ');';
                    top.inForCond = false;
                    i++;
                    lastKind = 'sep';
                    continue;
                }
            }
            out += ';';
            i++;
            lastKind = 'sep';
            continue;
        }

        if (ch === ')') {
            const top = stack.length ? stack[stack.length - 1] : null;
            if (top && top.ch === '(') {
                stack.pop();
                if (top.loopKind === 'while') {
                    out += ')';
                } else if (top.loopKind === 'for') {
                    if (top.inForCond) {
                        if (!top.forHasCondExpr) out += 'true';
                        out += ')';
                    } else if ((top.forSemicolons || 0) === 0) {
                        pendingLoop = { kind: 'for_iter', awaitingBlock: true };
                    }
                }
            }
            noteCondToken();
            out += ')';
            i++;
            lastKind = 'value_end';
            continue;
        }

        if (ch === '{') {
            noteCondToken();
            stack.push({ ch: '{' });
            out += '{';
            if (pendingLoop && (pendingLoop.kind === 'do' || pendingLoop.kind === 'for_iter')) {
                out += ' __vseStep(); ';
                pendingLoop = null;
            }
            i++;
            lastKind = 'sep';
            continue;
        }

        if (ch === '}') {
            const top = stack.length ? stack[stack.length - 1] : null;
            if (top && top.ch === '${' && tplDepth > 0) {
                stack.pop();
                tplDepth--;
                out += '}';
                i++;
                const resStart = i;
                let closed = false;
                while (i < len) {
                    if (src[i] === '\\') { i += 2; continue; }
                    if (src[i] === '$' && src[i + 1] === '{') {
                        tplDepth++;
                        stack.push({ ch: '${' });
                        i += 2;
                        break;
                    }
                    if (src[i] === '`') { i++; closed = true; break; }
                    i++;
                }
                out += src.slice(resStart, i);
                lastKind = closed ? 'value_end' : 'sep';
                continue;
            }
            if (top && top.ch === '{') stack.pop();
            out += '}';
            i++;
            lastKind = 'sep';
            continue;
        }

        noteCondToken();
        if (ch === '.' && prevIdent !== '...') {
            out += ch;
            i++;
            lastKind = 'dot';
            continue;
        }

        out += ch;
        i++;
        lastKind = 'sep';
    }

    if (isExpression && stack.length > 0) {
        throw new Error('Unbalanced brackets in EJS expression tag');
    }
    return out;
}

/** Build a deeply frozen, safe read-only Vexa snapshot for EJS templates (never exposes settings or keys). */
export function buildReadOnlyVexaSnapshot(state, extraHealthStatus = '') {
    const src = state && typeof state === 'object' ? state : {};
    const snap = {
        world: cloneJsonSafe(src.world || {}) || {},
        onscreen: cloneJsonSafe(src.onscreen || []) || [],
        offscreen_agendas: cloneJsonSafe(src.offscreen_agendas || []) || [],
        entity_state: cloneJsonSafe(src.entity_state || []) || [],
        entityMem: cloneJsonSafe(src.entityMem || []) || [],
        thoughts: cloneJsonSafe(src.thoughts || []) || [],
        dam: cloneJsonSafe(src.dam || []) || [],
        pair: cloneJsonSafe(src.pair || []) || [],
        tracks: cloneJsonSafe(src.tracks || {}) || {},
        arc: cloneJsonSafe(src.arc || {}) || {},
        chekhov: cloneJsonSafe(src.chekhov || {}) || {},
        inv: cloneJsonSafe(src.inv || {}) || {},
        story_notes: cloneJsonSafe(src.story_notes || {}) || {},
        notebook: cloneJsonSafe(src.notebook || []) || [],
        locations: cloneJsonSafe(src.locations || {}) || {},
        custom_trackers: cloneJsonSafe(src.custom_trackers || []) || [],
        vent: typeof src.vent === 'string' ? src.vent : '∅',
    };

    const rawHealth = cloneJsonSafe(src.health || {}) || {};
    const effHealth = hasExplicitHealthData(rawHealth)
        ? rawHealth
        : inferHealthFromStatusText(src.inv?.status || extraHealthStatus || '', rawHealth.bodyType || 'male');
    const metrics = computeHealthMetrics(effHealth);
    snap.health = {
        ...rawHealth,
        overallHp: metrics.overallHp,
        pain: metrics.pain,
        painLabel: metrics.painLabel,
        bloodLoss: metrics.bloodLoss,
        bleedingLevel: metrics.bleedingLevel,
        bleedingCount: metrics.bleedingCount,
        totalWounds: metrics.totalWounds,
        untreatedCount: metrics.untreatedCount,
        missingCount: metrics.missingCount,
        prostheticCount: metrics.prostheticCount,
        capacities: cloneJsonSafe(metrics.capacities) || {},
    };

    return deepFreeze(snap);
}

function resolveTrackerLookup(vexaSnap, pathStr) {
    if (!pathStr || typeof pathStr !== 'string') return undefined;
    const trimmed = pathStr.trim();
    if (!trimmed.startsWith('custom_trackers.')) return undefined;
    const parts = trimmed.split('.');
    if (parts.length < 3) return undefined;
    const trackerId = parts[1];
    const tracker = (vexaSnap.custom_trackers || []).find(
        (t) => t && !t.archived && String(t.id || '').toLowerCase() === trackerId.toLowerCase(),
    );
    if (!tracker) return undefined;
    if (parts[2] === 'fields' && parts.length === 4) {
        return tracker.fields && !FORBIDDEN_PROTO_TOKENS.has(parts[3]) && Object.prototype.hasOwnProperty.call(tracker.fields, parts[3])
            ? tracker.fields[parts[3]]
            : undefined;
    }
    if (parts.length === 3 && tracker.fields && Object.prototype.hasOwnProperty.call(tracker.fields, parts[2])) {
        return tracker.fields[parts[2]];
    }
    return readDotPathSafe(tracker, parts.slice(2).join('.'));
}

function resolveCardVarValue(varsObj, vexaSnap, pathStr, fallback) {
    const s = String(pathStr || '').trim();
    if (!s || FORBIDDEN_PROTO_REGEX.test(s)) return fallback;

    let hit = readDotPathSafe(varsObj, s);
    if (hit === undefined && !s.startsWith('stat_data.')) {
        hit = readDotPathSafe(varsObj, `stat_data.${s}`);
    }
    if (hit === undefined && s.startsWith('stat_data.')) {
        hit = readDotPathSafe(varsObj, s.slice('stat_data.'.length));
    }
    if (hit === undefined && vexaSnap) {
        hit = resolveTrackerLookup(vexaSnap, s);
    }
    return hit === undefined ? fallback : hit;
}

/**
 * Evaluate an EJS template against frozen Vexa state + scoped card variables.
 * Never throws; returns `{ ok, text, error?, elapsedMs }`.
 */
export function evaluateEjs(template, context = {}, opts = {}) {
    const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    if (!hasEjsTags(template)) {
        return { ok: true, text: String(template ?? ''), elapsedMs: 0 };
    }

    const compiled = compileEjs(template, opts);
    if (!compiled.ok) {
        const elapsed = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - t0;
        return { ok: false, text: template, error: compiled.error, elapsedMs: elapsed };
    }

    const vexaSnap = context.frozenState || buildReadOnlyVexaSnapshot(context.state);
    const varsObj = deepFreeze(cloneJsonSafe(context.cardVars || {}) || {});
    const wiMap = new Map();
    if (Array.isArray(context.wiEntries)) {
        for (const e of context.wiEntries) {
            if (!e) continue;
            const label = String(e.comment || e.key || '').trim();
            if (label) wiMap.set(label.toLowerCase(), String(e.content || ''));
        }
    }

    const getvexa = (path, fallback = undefined) => {
        if (typeof path !== 'string') return fallback;
        if (path.startsWith('custom_trackers.')) {
            const tr = resolveTrackerLookup(vexaSnap, path);
            if (tr !== undefined) return tr;
        }
        const v = readDotPathSafe(vexaSnap, path);
        return v === undefined ? fallback : v;
    };

    const getvar = (path, fallbackOrOpts = undefined) => {
        const hasOptsObj = fallbackOrOpts !== null
            && typeof fallbackOrOpts === 'object'
            && !Array.isArray(fallbackOrOpts)
            && ('defaults' in fallbackOrOpts || 'default' in fallbackOrOpts || 'scope' in fallbackOrOpts);
        const fallback = hasOptsObj
            ? (fallbackOrOpts.defaults !== undefined ? fallbackOrOpts.defaults : fallbackOrOpts.default)
            : fallbackOrOpts;
        return resolveCardVarValue(varsObj, vexaSnap, path, fallback);
    };

    const stagedWrites = [];
    const setvar = (path, value) => {
        if (opts.allowVarWrites !== true || typeof context.setCardVar !== 'function') {
            return false;
        }
        stagedWrites.push([path, value]);
        return true;
    };

    const maxSteps = Math.max(1, Number(opts.maxSteps) || DEFAULT_MAX_LOOP_STEPS);
    const maxOut = Math.max(64, Number(opts.maxOutputChars) || DEFAULT_MAX_OUTPUT_CHARS);
    const maxEvalMs = Math.max(25, Number(opts.maxEvalMs) || 200);
    const deadlineMs = Date.now() + maxEvalMs;
    let stepCount = 0;
    let outBuf = '';

    const __vseStep = () => {
        stepCount++;
        if (stepCount > maxSteps) {
            throw new Error(`EJS loop step limit exceeded (${maxSteps})`);
        }
        if ((stepCount & 63) === 0 && Date.now() > deadlineMs) {
            throw new Error(`EJS execution deadline exceeded (${maxEvalMs}ms)`);
        }
        return true;
    };
    const __vseAppend = (v) => {
        if (v === null || v === undefined) return;
        const s = String(v);
        if (outBuf.length + s.length > maxOut) {
            throw new Error(`EJS output exceeds cap (${maxOut} chars)`);
        }
        outBuf += s;
    };
    const __vseGetOut = () => outBuf;

    const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    const roll = (expr) => rollDice(expr, rng);
    const chance = (pct) => {
        const n = Number(pct);
        if (!Number.isFinite(n)) return false;
        if (n <= 0) return false;
        if (n >= 100) return true;
        return rng() * 100 < n;
    };
    const pick = (arr) => {
        if (!Array.isArray(arr) || !arr.length) return undefined;
        return arr[Math.floor(rng() * arr.length)];
    };
    const clamp = (val, min, max) => Math.max(Number(min), Math.min(Number(max), Number(val)));
    const getwi = (name) => wiMap.get(String(name || '').trim().toLowerCase()) ?? '';

    const env = Object.freeze({
        vexa: vexaSnap,
        state: vexaSnap,
        vars: varsObj,
        getvexa,
        getvar,
        setvar,
        roll,
        chance,
        pick,
        clamp,
        getwi,
        char: String(context.charName || ''),
        user: String(context.userName || ''),
        turn: Number(vexaSnap.world?.ct || 0),
        __vseEsc: escapeHtml,
        __vseKey: safeBracketKey,
        __vseStep,
        __vseAppend,
        __vseGetOut,
    });

    try {
        const rawOut = compiled.render(env);
        const text = typeof rawOut === 'string' ? rawOut : (rawOut === undefined ? outBuf : String(rawOut));
        if (text.length > maxOut) {
            throw new Error(`EJS output exceeds cap (${maxOut} chars)`);
        }
        // Commit staged writes only after template evaluation completely succeeds
        for (const [wPath, wVal] of stagedWrites) {
            context.setCardVar(wPath, wVal);
        }
        const elapsed = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - t0;
        return { ok: true, text, elapsedMs: elapsed };
    } catch (err) {
        const elapsed = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - t0;
        return { ok: false, text: template, error: err?.message || String(err), elapsedMs: elapsed };
    }
}

function formatMacroScalar(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
}

/**
 * Lightweight non-EJS macro expansion for `{{get_card_var::path}}`, `{{vexa::path}}`,
 * read-only `{{get_message_variable::path}}` (only replaced when resolved),
 * `{{format_message_variable::path}}`, and `{{roll:NdS}}` fallback.
 */
export function substituteVexaMacros(text, context = {}, { rng = Math.random } = {}) {
    if (typeof text !== 'string' || !text.includes('{{')) return text;
    const vexaSnap = context.frozenState || buildReadOnlyVexaSnapshot(context.state);
    const varsObj = context.cardVars && typeof context.cardVars === 'object' ? context.cardVars : {};

    let out = text.replace(/\{\{(get_card_var|get_message_variable|format_message_variable|vexa)::([^}]+)\}\}/gi, (full, fnName, rawPath) => {
        const fn = fnName.toLowerCase();
        const path = String(rawPath || '').trim();
        if (!path || FORBIDDEN_PROTO_REGEX.test(path)) return full;

        if (fn === 'vexa') {
            let val = readDotPathSafe(vexaSnap, path);
            if (val === undefined && path.startsWith('custom_trackers.')) {
                val = resolveTrackerLookup(vexaSnap, path);
            }
            return val === undefined ? '' : formatMacroScalar(val);
        }

        const val = resolveCardVarValue(varsObj, vexaSnap, path, undefined);
        if (fn === 'get_card_var') {
            return val === undefined ? '' : formatMacroScalar(val);
        }
        // Only overwrite `get_message_variable` / `format_message_variable` when our store resolves it
        if (val === undefined) return full;
        if (fn === 'format_message_variable' && typeof val === 'object') {
            return JSON.stringify(val, null, 2);
        }
        return formatMacroScalar(val);
    });

    out = out.replace(/\{\{roll:(\d{1,3}d\d{1,5}(?:[+-]\d{1,5})?)\}\}/gi, (full, expr) => {
        try {
            return String(rollDice(expr, rng).total);
        } catch {
            return full;
        }
    });

    return out;
}

function stripMetaKeysDeep(val, depth = 0) {
    if (depth > 20 || val === null || val === undefined) return val;
    if (Array.isArray(val)) return val.map((x) => stripMetaKeysDeep(x, depth + 1));
    if (typeof val === 'object') {
        const out = {};
        for (const k of Object.keys(val)) {
            if (k === '$meta' || FORBIDDEN_PROTO_TOKENS.has(k)) continue;
            out[k] = stripMetaKeysDeep(val[k], depth + 1);
        }
        return out;
    }
    return val;
}

/**
 * Scan World Info entries for `[InitVar]` or `[VexaInitVar]` JSON variable seeds.
 * Cleans `$meta` schema markers and wraps flat roots under `{ stat_data }` when absent
 * so `getvar('stat_data.x')` and `getvar('x')` both resolve cleanly.
 */
export function tryParseInitVarsFromEntries(entries) {
    const list = Array.isArray(entries)
        ? entries
        : (entries && typeof entries === 'object' ? Object.values(entries) : null);
    if (!list) return null;
    for (const e of list) {
        if (!e || typeof e.content !== 'string') continue;
        const label = String(e.comment || '').trim();
        const rawKey = e.key ?? e.keys;
        const keyStr = Array.isArray(rawKey) ? rawKey.join(' ') : String(rawKey || '');
        const isInit = /^\[(?:InitVar|VexaInitVars?)\]$/i.test(label)
            || /\[(?:InitVar|VexaInitVars?)\]/i.test(keyStr);
        if (!isInit) continue;

        let raw = e.content.trim();
        const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fence) raw = fence[1].trim();
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
            const cleaned = stripMetaKeysDeep(parsed);
            if (cleaned.stat_data && typeof cleaned.stat_data === 'object') {
                return cleaned;
            }
            return { stat_data: cleaned };
        } catch {
            // Skip invalid JSON InitVar entry
        }
    }
    return null;
}

export function clearEjsCompileCache() {
    compileCache.clear();
}
