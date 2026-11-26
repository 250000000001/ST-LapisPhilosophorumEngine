#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    hasEjsTags,
    compileEjs,
    evaluateEjs,
    tryParseInitVarsFromEntries,
} from '../src/ejsEngine.js';
import { isFrontendHtmlBlock } from '../src/cardRenderer.js';
import { emptyState } from '../src/schema.js';

const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/g;
const GENERIC_EN_TRIGGERS = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was',
    'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now',
    'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she',
    'too', 'use', 'yes', 'no', 'go', 'in', 'on', 'at', 'to', 'of', 'is', 'it', 'he',
    'we', 'be', 'by', 'or', 'as', 'if', 'room', 'door', 'time', 'eyes', 'hand', 'head',
]);

function countCjk(str) {
    if (typeof str !== 'string' || !str) return 0;
    const m = str.match(CJK_RE);
    return m ? m.length : 0;
}

function parsePngCard(filePath) {
    const buf = fs.readFileSync(filePath);
    const sig = buf.subarray(0, 8).toString('hex');
    if (sig !== '89504e470d0a1a0a') {
        throw new Error(`Not a valid PNG file: ${filePath}`);
    }
    let off = 8;
    const textChunks = {};
    while (off + 8 <= buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.subarray(off + 4, off + 8).toString('ascii');
        if (type === 'tEXt') {
            const chunkData = buf.subarray(off + 8, off + 8 + len);
            const nul = chunkData.indexOf(0);
            if (nul > 0) {
                const key = chunkData.subarray(0, nul).toString('latin1');
                const val = chunkData.subarray(nul + 1).toString('latin1');
                textChunks[key] = val;
            }
        }
        off += 12 + len;
    }
    const rawB64 = textChunks.ccv3 || textChunks.chara;
    if (!rawB64) {
        throw new Error(`No chara or ccv3 tEXt chunk found in PNG: ${filePath}`);
    }
    const jsonStr = Buffer.from(rawB64, 'base64').toString('utf8');
    return {
        card: JSON.parse(jsonStr),
        fileBytes: buf.length,
        jsonBytes: Buffer.byteLength(jsonStr, 'utf8'),
        hasCharaChunk: Boolean(textChunks.chara),
        hasCcv3Chunk: Boolean(textChunks.ccv3),
        charaB64Bytes: textChunks.chara ? textChunks.chara.length : 0,
        ccv3B64Bytes: textChunks.ccv3 ? textChunks.ccv3.length : 0,
    };
}

function loadCard(inputPath) {
    const ext = path.extname(inputPath).toLowerCase();
    if (ext === '.json') {
        const raw = fs.readFileSync(inputPath, 'utf8');
        return {
            card: JSON.parse(raw),
            fileBytes: Buffer.byteLength(raw, 'utf8'),
            jsonBytes: Buffer.byteLength(raw, 'utf8'),
            hasCharaChunk: false,
            hasCcv3Chunk: false,
            charaB64Bytes: 0,
            ccv3B64Bytes: 0,
        };
    }
    return parsePngCard(inputPath);
}

function collectObjectKeysCjk(obj, prefix = '') {
    let count = 0;
    const sampleKeys = [];
    const walk = (node, curPath, depth) => {
        if (depth > 20 || !node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            node.forEach((item, idx) => walk(item, `${curPath}[${idx}]`, depth + 1));
            return;
        }
        for (const k of Object.keys(node)) {
            const c = countCjk(k);
            if (c > 0) {
                count += c;
                if (sampleKeys.length < 15) sampleKeys.push(curPath ? `${curPath}.${k}` : k);
            }
            walk(node[k], curPath ? `${curPath}.${k}` : k, depth + 1);
        }
    };
    walk(obj, prefix, 0);
    return { count, sampleKeys };
}

function readDotPath(obj, dotPath) {
    if (!obj || typeof obj !== 'object' || typeof dotPath !== 'string') return undefined;
    let cur = obj;
    for (const seg of dotPath.split('.')) {
        if (!seg || !cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, seg)) {
            return undefined;
        }
        cur = cur[seg];
    }
    return cur;
}

function hasInitVarPath(initVars, rawPath) {
    if (!initVars || typeof initVars !== 'object') return true;
    const p = String(rawPath || '').trim();
    if (!p || p.startsWith('custom_trackers.')) return true;
    if (readDotPath(initVars, p) !== undefined) return true;
    if (!p.startsWith('stat_data.') && readDotPath(initVars, `stat_data.${p}`) !== undefined) return true;
    if (p.startsWith('stat_data.') && readDotPath(initVars, p.slice('stat_data.'.length)) !== undefined) return true;
    return false;
}

function extractHtmlBlocksFromText(text) {
    if (typeof text !== 'string' || !text) return [];
    const blocks = [];
    const fencedRe = /```(?:html|plaintext)?\s*\n([\s\S]*?)```/gi;
    let m;
    while ((m = fencedRe.exec(text)) !== null) {
        if (isFrontendHtmlBlock(m[1])) blocks.push(m[1]);
    }
    if (blocks.length === 0 && isFrontendHtmlBlock(text)) {
        blocks.push(text);
    }
    return blocks;
}

export function auditCardFile(inputPath) {
    const loaded = loadCard(inputPath);
    const card = loaded.card;
    const d = card?.data && typeof card.data === 'object' ? card.data : card;
    if (!d || typeof d !== 'object') {
        throw new Error(`Invalid character card structure in ${inputPath}`);
    }

    const findings = [];
    const add = (severity, code, location, message) => {
        findings.push({ severity, code, location, message });
    };

    let cjkCouplingCount = 0;
    const bumpCjk = (n, code, location, detail) => {
        if (n > 0) {
            cjkCouplingCount += n;
            add('INFO', code, location, `${detail} (${n} CJK char(s))`);
        }
    };

    const rawEntries = d.character_book?.entries
        ? (Array.isArray(d.character_book.entries)
            ? d.character_book.entries
            : Object.values(d.character_book.entries))
        : [];
    const enabledEntries = rawEntries.filter((e) => e && e.enabled !== false);
    const disabledEntries = rawEntries.filter((e) => e && e.enabled === false);
    const regexScripts = Array.isArray(d.extensions?.regex_scripts) ? d.extensions.regex_scripts : [];

    // 1. Check PNG chunk bloat & size warnings
    if (loaded.fileBytes > 10 * 1024 * 1024) {
        add('WARN', 'OVERSIZED_PNG', 'png', `PNG size is ${(loaded.fileBytes / (1024 * 1024)).toFixed(2)} MB (> 10 MB)`);
    }
    if (loaded.hasCharaChunk && loaded.hasCcv3Chunk && loaded.ccv3B64Bytes > 50 * 1024) {
        add('WARN', 'DUPLICATE_CCV3_CHUNK', 'png.tEXt', `Both chara and ccv3 chunks exist (${(loaded.ccv3B64Bytes / 1024).toFixed(0)} KB base64 duplicated)`);
    }

    // 2. Validate [InitVar] / [VexaInitVar]
    let parsedInitVars = null;
    for (const e of rawEntries) {
        if (!e || typeof e.content !== 'string') continue;
        const label = String(e.comment || '').trim();
        const keyStr = Array.isArray(e.keys) ? e.keys.join(' ') : String(e.key || '');
        if (/^\[(?:InitVar|VexaInitVars?)\]$/i.test(label) || /\[(?:InitVar|VexaInitVars?)\]/i.test(keyStr)) {
            let raw = e.content.trim();
            const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
            if (fence) raw = fence[1].trim();
            try {
                JSON.parse(raw);
            } catch (err) {
                add('BLOCKER', 'INVALID_INITVAR_JSON', `wi[${e.id ?? e.uid ?? label}]`, `Invalid JSON in [InitVar]: ${err.message}`);
            }
        }
    }
    parsedInitVars = tryParseInitVarsFromEntries(rawEntries);
    if (parsedInitVars) {
        const keyCjk = collectObjectKeysCjk(parsedInitVars, 'InitVar');
        bumpCjk(keyCjk.count, 'CJK_INITVAR_KEYS', '[InitVar]', `CJK keys in [InitVar]: ${keyCjk.sampleKeys.join(', ')}`);
    }

    // 3. Check core fields
    for (const field of ['description', 'scenario']) {
        if (!String(d[field] || '').trim()) {
            add('WARN', 'EMPTY_CORE_FIELD', `data.${field}`, `Core field "${field}" is empty`);
        }
    }
    const coreTexts = [
        ['data.name', d.name],
        ['data.description', d.description],
        ['data.personality', d.personality],
        ['data.scenario', d.scenario],
        ['data.first_mes', d.first_mes],
        ['data.mes_example', d.mes_example],
        ['data.creator_notes', d.creator_notes],
        ['data.system_prompt', d.system_prompt],
        ['data.post_history_instructions', d.post_history_instructions],
        ...(Array.isArray(d.alternate_greetings) ? d.alternate_greetings.map((g, i) => [`data.alternate_greetings[${i}]`, g]) : []),
    ];

    const stateSample = emptyState();
    const scanCodeAndDirectives = (loc, text, { checkHtml = true, checkEjs = true, checkMvu = true, checkCjkVars = true } = {}) => {
        if (typeof text !== 'string' || !text) return;

        if (checkMvu) {
            const mvuMatches = text.match(/<UpdateVariable|<gametxt\b|_\.(?:set|add)\s*\(/gi);
            if (mvuMatches) {
                add('BLOCKER', 'CONFLICTING_MVU_DIRECTIVE', loc, `Conflicting MVU/legacy tag or helper found: ${[...new Set(mvuMatches)].join(', ')}`);
            }
        }

        if (checkCjkVars) {
            const callRe = /(?:getvar|setvar|VexaCard\.(?:getVar|setVar))\s*\(\s*(['"`])([\s\S]*?)\1/g;
            let cm;
            while ((cm = callRe.exec(text)) !== null) {
                bumpCjk(countCjk(cm[2]), 'CJK_VAR_KEY_ARG', loc, `CJK var argument "${cm[2]}"`);
            }
            const macroRe = /\{\{(?:get_card_var|get_message_variable|format_message_variable)::([^}]+)\}\}/gi;
            let mm;
            while ((mm = macroRe.exec(text)) !== null) {
                const varPath = mm[1].trim();
                bumpCjk(countCjk(varPath), 'CJK_MACRO_PATH', loc, `CJK macro path "${varPath}"`);
                if (parsedInitVars && /get_card_var/i.test(mm[0]) && !hasInitVarPath(parsedInitVars, varPath)) {
                    add('WARN', 'UNRESOLVED_CARD_VAR', loc, `Macro "${mm[0]}" path "${varPath}" not found in [InitVar]`);
                }
            }
        }

        if (checkEjs && hasEjsTags(text)) {
            const compiled = compileEjs(text);
            if (!compiled.ok) {
                add('BLOCKER', 'EJS_COMPILE_ERROR', loc, `EJS compile error: ${compiled.error}`);
            } else {
                const evalRes = evaluateEjs(text, {
                    state: stateSample,
                    cardVars: parsedInitVars || {},
                    wiEntries: rawEntries,
                    charName: d.name || 'Character',
                    userName: 'User',
                });
                if (!evalRes.ok) {
                    add('BLOCKER', 'EJS_EVAL_ERROR', loc, `EJS evaluation error: ${evalRes.error}`);
                }
            }
        }

        if (checkHtml) {
            const htmlBlocks = extractHtmlBlocksFromText(text);
            for (let bi = 0; bi < htmlBlocks.length; bi++) {
                const html = htmlBlocks[bi];
                const bLoc = htmlBlocks.length > 1 ? `${loc}#html${bi}` : loc;
                const byteLen = Buffer.byteLength(html, 'utf8');
                if (byteLen > 2048 * 1024) {
                    add('BLOCKER', 'HTML_EXCEEDS_2MB_GUARD', bLoc, `HTML block is ${(byteLen / 1024).toFixed(1)} KB (> 2048 KB Vexa guard)`);
                }
                const forbiddenApiRe = /\b(?:TavernHelper|triggerSlash|localStorage|sessionStorage|indexedDB|Dexie)\b|window\.parent\b|window\.open\s*\(|<form\b/g;
                const apiHits = [...new Set(html.match(forbiddenApiRe) || [])];
                if (apiHits.length) {
                    add('BLOCKER', 'FORBIDDEN_SANDBOX_API', bLoc, `Blocked legacy/host APIs inside HTML: ${apiHits.join(', ')}`);
                }
                const extCdnRe = /<script\b[^>]*\bsrc\s*=\s*["']https?:|<link\b[^>]*\bhref\s*=\s*["']https?:|@import\s+(?:url\()?["']?https?:/gi;
                const cdnHits = [...new Set(html.match(extCdnRe) || [])];
                if (cdnHits.length) {
                    add('BLOCKER', 'CSP_BLOCKED_CDN', bLoc, `External CDN <script>/<link>/@import blocked by strict CSP (${cdnHits.length} hit(s))`);
                }
                const extAssetUrls = [...new Set((html.match(/https?:\/\/[^\s"'<>)]+/gi) || []).filter((u) => !/^http:\/\/www\.w3\.org\/2000\/svg\b/i.test(u) && !/^https?:\/\/github\.com\b/i.test(u)))];
                if (extAssetUrls.length && !cdnHits.length) {
                    add('WARN', 'EXTERNAL_IMAGE_URL', bLoc, `${extAssetUrls.length} external HTTP(S) URL(s) inside HTML (blocked when External Resources toggle is OFF)`);
                }
                const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
                let sm;
                while ((sm = scriptRe.exec(html)) !== null) {
                    bumpCjk(countCjk(sm[1]), 'CJK_IN_SCRIPT', bLoc, 'CJK text/identifiers inside <script>');
                }
            }
        }
    };

    for (const [loc, val] of coreTexts) {
        if (typeof val !== 'string' || !val) continue;
        scanCodeAndDirectives(loc, val, { checkHtml: true, checkEjs: true, checkMvu: true, checkCjkVars: true });
    }

    // 4. Inspect regex scripts
    for (const rx of regexScripts) {
        if (!rx) continue;
        const name = rx.scriptName || rx.id || 'unnamed_regex';
        const loc = `regex[${name}]`;
        if (rx.disabled) continue;

        const findStr = String(rx.findRegex || '');
        bumpCjk(countCjk(findStr), 'CJK_REGEX_FIND', loc, `CJK characters in findRegex "${findStr}"`);

        const rep = String(rx.replaceString || '');
        const repBytes = Buffer.byteLength(rep, 'utf8');
        if (repBytes > 2048 * 1024) {
            add('BLOCKER', 'REGEX_HTML_EXCEEDS_2MB', loc, `replaceString is ${(repBytes / 1024).toFixed(1)} KB (> 2048 KB Vexa guard)`);
        }

        const isCleanupRegex = rep === '' && rx.promptOnly === true && rx.markdownOnly === true;
        scanCodeAndDirectives(loc, rep, {
            checkHtml: Boolean(rep.trim()),
            checkEjs: false,
            checkMvu: !isCleanupRegex,
            checkCjkVars: Boolean(rep.trim()),
        });
    }

    // 5. Inspect World Info entries
    for (const e of rawEntries) {
        if (!e) continue;
        const id = e.id ?? e.uid ?? '?';
        const loc = `wi[${id}:${e.comment || ''}]`;
        const content = String(e.content || '');
        const byteLen = Buffer.byteLength(content, 'utf8');

        if (e.enabled === false) {
            if (byteLen > 20 * 1024) {
                add('WARN', 'ORPHANED_LARGE_DISABLED_ENTRY', loc, `Disabled entry is ${(byteLen / 1024).toFixed(1)} KB (consider pruning if unused by TavernHelper)`);
            }
            continue;
        }

        const keys = Array.isArray(e.keys) ? e.keys : (Array.isArray(e.key) ? e.key : []);
        const secKeys = Array.isArray(e.secondary_keys) ? e.secondary_keys : (Array.isArray(e.keysecondary) ? e.keysecondary : []);
        for (const k of [...keys, ...secKeys]) {
            const ks = String(k || '').trim();
            if (!ks) continue;
            bumpCjk(countCjk(ks), 'CJK_WI_TRIGGER_KEY', loc, `CJK trigger key "${ks}"`);
            if (GENERIC_EN_TRIGGERS.has(ks.toLowerCase())) {
                add('WARN', 'GENERIC_TRIGGER_KEY', loc, `Overly generic English trigger key "${ks}" may cause false activations`);
            }
        }

        scanCodeAndDirectives(loc, content, { checkHtml: true, checkEjs: true, checkMvu: true, checkCjkVars: true });
    }

    const summary = {
        blockers: findings.filter((f) => f.severity === 'BLOCKER').length,
        warns: findings.filter((f) => f.severity === 'WARN').length,
        infos: findings.filter((f) => f.severity === 'INFO').length,
        cjkCouplingCount,
        enabledEntries: enabledEntries.length,
        disabledEntries: disabledEntries.length,
        regexCount: regexScripts.length,
    };

    return {
        file: path.resolve(inputPath),
        cardName: d.name || '',
        spec: card.spec || '',
        specVersion: card.spec_version || '',
        fileBytes: loaded.fileBytes,
        jsonBytes: loaded.jsonBytes,
        summary,
        findings,
    };
}

function main() {
    const args = process.argv.slice(2);
    if (!args.length || args.includes('--help') || args.includes('-h')) {
        console.log('Usage: node scripts/audit-card.mjs <card.png|card.json> [--json] [--out <file>] [--no-fail]');
        process.exit(0);
    }

    let cardPath = '';
    let outFile = '';
    let jsonMode = false;
    let noFail = false;

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--json') jsonMode = true;
        else if (a === '--no-fail') noFail = true;
        else if (a === '--out') {
            outFile = args[++i] || '';
            if (!outFile) throw new Error('--out requires a file path');
        } else if (!a.startsWith('-')) {
            cardPath = a;
        }
    }
    if (!cardPath) throw new Error('Missing <cardPath>');

    const report = auditCardFile(cardPath);
    if (outFile) {
        fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
        fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
    }

    if (jsonMode) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log(`Card: ${report.cardName} (${report.spec} v${report.specVersion}) | ${(report.fileBytes / 1024).toFixed(1)} KB`);
        console.log(`Summary: BLOCKER=${report.summary.blockers}, WARN=${report.summary.warns}, INFO=${report.summary.infos}, CJK_COUPLING=${report.summary.cjkCouplingCount}`);
        for (const f of report.findings) {
            console.log(`  [${f.severity}] ${f.code} @ ${f.location}: ${f.message}`);
        }
    }

    if (report.summary.blockers > 0 && !noFail) {
        process.exit(1);
    }
}

const isEntry = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntry) {
    main();
}
