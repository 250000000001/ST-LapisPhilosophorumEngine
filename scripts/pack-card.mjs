#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/g;

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function makePngChunk(type, dataBuf) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(dataBuf.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, dataBuf])), 0);
    return Buffer.concat([lenBuf, typeBuf, dataBuf, crcBuf]);
}

function makeTextChunk(keyword, latin1Text) {
    return makePngChunk(
        'tEXt',
        Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(latin1Text, 'latin1')]),
    );
}

function repackPngLossless(srcPngPath, outPngPath, cardObj) {
    const src = fs.readFileSync(srcPngPath);
    const sig = src.subarray(0, 8);
    if (sig.toString('hex') !== '89504e470d0a1a0a') {
        throw new Error(`Invalid source PNG signature: ${srcPngPath}`);
    }

    const beforeIdat = [];
    const fromIdatToEnd = [];
    let seenIdat = false;
    let off = 8;

    while (off + 8 <= src.length) {
        const len = src.readUInt32BE(off);
        const type = src.subarray(off + 4, off + 8).toString('ascii');
        const fullChunk = src.subarray(off, off + 12 + len);

        if (type === 'IHDR') {
            beforeIdat.push(fullChunk);
        } else if (type === 'IDAT') {
            seenIdat = true;
            fromIdatToEnd.push(fullChunk);
        } else if (type === 'IEND') {
            fromIdatToEnd.push(fullChunk);
        } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
            const payload = src.subarray(off + 8, off + 8 + len);
            const nul = payload.indexOf(0);
            const key = nul > 0 ? payload.subarray(0, nul).toString('latin1') : '';
            if (key !== 'chara' && key !== 'ccv3') {
                (seenIdat ? fromIdatToEnd : beforeIdat).push(fullChunk);
            }
        } else {
            (seenIdat ? fromIdatToEnd : beforeIdat).push(fullChunk);
        }
        off += 12 + len;
    }

    const b64 = Buffer.from(JSON.stringify(cardObj), 'utf8').toString('base64');
    const charaChunk = makeTextChunk('chara', b64);
    const outBuf = Buffer.concat([sig, ...beforeIdat, charaChunk, ...fromIdatToEnd]);
    fs.mkdirSync(path.dirname(path.resolve(outPngPath)), { recursive: true });
    fs.writeFileSync(outPngPath, outBuf);
    return outBuf.length;
}

function resolveDot(obj, dotPath) {
    let cur = obj;
    for (const seg of String(dotPath || '').split('.')) {
        if (!seg || !cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, seg)) {
            return undefined;
        }
        cur = cur[seg];
    }
    return cur;
}

function parseCliArgs(argv) {
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log('Usage: node scripts/pack-card.mjs --src <input.png> --work <workDir> --out <output.png> [--book-name <name>] [--allow-cjk]');
        process.exit(0);
    }
    const opts = { src: '', work: '', out: '', bookName: '', allowCjk: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--allow-cjk') opts.allowCjk = true;
        else if (a === '--src') opts.src = argv[++i] || '';
        else if (a === '--work') opts.work = argv[++i] || '';
        else if (a === '--out') opts.out = argv[++i] || '';
        else if (a === '--book-name') opts.bookName = argv[++i] || '';
        else throw new Error(`Unknown CLI argument: ${a}`);
    }
    if (!opts.src || !opts.work || !opts.out) {
        throw new Error('Missing required arguments. Usage: node scripts/pack-card.mjs --src <input.png> --work <workDir> --out <output.png> [--book-name <name>] [--allow-cjk]');
    }
    return {
        srcPng: path.resolve(opts.src),
        workDir: path.resolve(opts.work),
        outPng: path.resolve(opts.out),
        bookName: opts.bookName.trim(),
        allowCjk: opts.allowCjk,
    };
}

export function packCard({ srcPng, workDir, outPng, bookName = '', allowCjk = false }) {
    const outDir = path.join(workDir, 'out');
    const packedJsonPath = path.join(workDir, 'packed_card.json');

    const rawCard = JSON.parse(fs.readFileSync(path.join(workDir, 'raw_card.json'), 'utf8'));
    const glossary = JSON.parse(fs.readFileSync(path.join(workDir, 'glossary_and_keymap.json'), 'utf8'));
    const coreOut = JSON.parse(fs.readFileSync(path.join(outDir, 'core_fields.json'), 'utf8'));
    const uiOut = JSON.parse(fs.readFileSync(path.join(outDir, 'regex_and_ui.json'), 'utf8'));

    const batchFiles = fs.readdirSync(outDir)
        .filter((f) => /^wi_batch_\d+\.json$/.test(f))
        .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    if (batchFiles.length === 0) {
        throw new Error(`No out/wi_batch_*.json files found in ${outDir}`);
    }

    const rawEntries = Array.isArray(rawCard.data?.character_book?.entries)
        ? rawCard.data.character_book.entries
        : Object.values(rawCard.data?.character_book?.entries || {});
    const rawById = new Map(rawEntries.map((e) => [e.id, e]));

    const translatedEntries = [];
    for (const bf of batchFiles) {
        const bJson = JSON.parse(fs.readFileSync(path.join(outDir, bf), 'utf8'));
        for (const tEntry of bJson.entries || []) {
            const orig = rawById.get(tEntry.id) || {};
            translatedEntries.push({
                ...orig,
                id: tEntry.id,
                keys: Array.isArray(tEntry.keys) ? tEntry.keys : (orig.keys || []),
                secondary_keys: Array.isArray(tEntry.secondary_keys) ? tEntry.secondary_keys : (orig.secondary_keys || []),
                comment: typeof tEntry.comment === 'string' ? tEntry.comment : (orig.comment || ''),
                content: typeof tEntry.content === 'string' ? tEntry.content : (orig.content || ''),
                constant: tEntry.constant !== undefined ? Boolean(tEntry.constant) : Boolean(orig.constant),
                enabled: tEntry.enabled !== undefined ? Boolean(tEntry.enabled) : (orig.enabled !== false),
            });
        }
    }

    const coreData = coreOut.data || coreOut;
    let firstMes = String(coreData.first_mes || '');
    const openingHtml = String(uiOut.opening_html || '').trim();
    if (openingHtml) {
        const fencedOpening = '```html\n' + openingHtml + '\n```';
        if (/<opening>[\s\S]*?<\/opening>/i.test(firstMes)) {
            firstMes = firstMes.replace(/<opening>[\s\S]*?<\/opening>/i, fencedOpening);
        } else if (!firstMes.includes('data-vexa-screen="origin"') && !firstMes.includes('<!DOCTYPE html')) {
            firstMes = `${firstMes.trim()}\n\n${fencedOpening}`;
        }
    }

    const characterBookName = bookName
        || coreData.extensions_other?.world
        || rawCard.data?.character_book?.name
        || (coreData.name ? `${coreData.name} Lorebook` : 'Character Lorebook');

    const packedCard = {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: coreData.name,
            description: coreData.description || '',
            personality: coreData.personality || '',
            scenario: coreData.scenario || '',
            first_mes: firstMes,
            mes_example: coreData.mes_example || '',
            creator_notes: coreData.creator_notes || '',
            system_prompt: coreData.system_prompt || '',
            post_history_instructions: coreData.post_history_instructions || '',
            alternate_greetings: Array.isArray(coreData.alternate_greetings) ? coreData.alternate_greetings : [],
            tags: Array.isArray(coreData.tags) ? coreData.tags : [],
            creator: coreData.creator || rawCard.data?.creator || '',
            character_version: coreData.character_version || '1.0-vexa-en',
            extensions: {
                talkativeness: coreData.extensions_other?.talkativeness ?? rawCard.data?.extensions?.talkativeness ?? '0.5',
                fav: Boolean(coreData.extensions_other?.fav ?? rawCard.data?.extensions?.fav),
                world: characterBookName,
                depth_prompt: coreData.extensions_other?.depth_prompt || rawCard.data?.extensions?.depth_prompt || { prompt: '', depth: 4, role: 'system' },
                regex_scripts: Array.isArray(uiOut.regex_scripts) ? uiOut.regex_scripts : [],
                tavern_helper: { scripts: [], variables: {} },
            },
            character_book: {
                name: characterBookName,
                entries: translatedEntries,
            },
        },
    };

    const errors = [];
    const oldCnKeys = Object.keys(glossary.atomic_keymap || {});
    const allowedEnValues = new Set(Object.values(glossary.atomic_keymap || {}));

    const initEntry = translatedEntries.find(
        (e) => /^\[(?:InitVar|VexaInitVars?)\]$/i.test(String(e.comment || '').trim())
            || (e.keys || []).some((k) => /\[(?:InitVar|VexaInitVars?)\]/i.test(String(k))),
    );
    let initObj = null;
    if (initEntry) {
        try {
            let raw = initEntry.content.trim();
            const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
            if (fence) raw = fence[1].trim();
            initObj = JSON.parse(raw);
            if (!initObj || typeof initObj !== 'object' || Array.isArray(initObj)) {
                errors.push('[InitVar] must parse to a JSON object');
            }
        } catch (err) {
            errors.push(`[InitVar] invalid JSON: ${err.message}`);
        }
    }

    const initWrapped = initObj?.stat_data ? initObj : { stat_data: initObj || {} };

    const cjkHits = [];
    const scanString = (loc, str) => {
        if (typeof str !== 'string' || !str) return;
        const mCjk = str.match(CJK_RE);
        if (mCjk) {
            const idx = str.search(CJK_RE);
            const snippet = str.slice(Math.max(0, idx - 24), Math.min(str.length, idx + 40)).replace(/\s+/g, ' ');
            cjkHits.push({ loc, count: mCjk.length, snippet });
        }

        for (const vm of str.matchAll(/(?:getvar|setvar|VexaCard\.(?:getVar|setVar))\s*\(\s*(['"`])([^'"`]+)\1/g)) {
            const varPath = vm[2].trim();
            if (oldCnKeys.some((ck) => varPath.includes(ck))) {
                errors.push(`Orphaned CN key in var call @ ${loc}: "${varPath}"`);
            }
            if (!varPath.startsWith('custom_trackers.') && initObj) {
                const leaf = varPath.replace(/^stat_data\./, '');
                if (resolveDot(initWrapped, varPath) === undefined
                    && resolveDot(initWrapped.stat_data, leaf) === undefined
                    && !allowedEnValues.has(leaf.split('.')[0])) {
                    errors.push(`Unseeded var path "${varPath}" in call @ ${loc}`);
                }
            }
        }

        for (const mm of str.matchAll(/\{\{(?:get_card_var|get_message_variable|format_message_variable)::([^}]+)\}\}/gi)) {
            const varPath = mm[1].trim();
            if (oldCnKeys.some((ck) => varPath.includes(ck))) {
                errors.push(`Orphaned CN key in macro @ ${loc}: "${varPath}"`);
            }
            if (!varPath.startsWith('custom_trackers.') && initObj) {
                const leaf = varPath.replace(/^(?:stat_data_for_ai|stat_data)\./, '');
                if (resolveDot(initWrapped.stat_data, leaf) === undefined && !allowedEnValues.has(leaf.split('.')[0])) {
                    errors.push(`Unseeded macro path "${varPath}" @ ${loc}`);
                }
            }
        }
    };

    const dOut = packedCard.data;
    for (const f of ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions']) {
        scanString(`data.${f}`, dOut[f]);
    }
    if (openingHtml && Buffer.byteLength(openingHtml, 'utf8') > 2048 * 1024) {
        errors.push(`opening_html exceeds 2048 KB (${Buffer.byteLength(openingHtml, 'utf8')} bytes)`);
    }
    for (const rx of dOut.extensions.regex_scripts) {
        scanString(`regex[${rx.scriptName}].findRegex`, rx.findRegex);
        scanString(`regex[${rx.scriptName}].replaceString`, rx.replaceString);
        if (Buffer.byteLength(rx.replaceString || '', 'utf8') > 2048 * 1024) {
            errors.push(`regex[${rx.scriptName}] replaceString exceeds 2048 KB`);
        }
    }
    for (const e of translatedEntries) {
        scanString(`wi[${e.id}].comment`, e.comment);
        (e.keys || []).forEach((k, i) => scanString(`wi[${e.id}].keys[${i}]`, k));
        (e.secondary_keys || []).forEach((k, i) => scanString(`wi[${e.id}].secKeys[${i}]`, k));
        scanString(`wi[${e.id}].content`, e.content);
    }

    if (cjkHits.length && !allowCjk) {
        for (const h of cjkHits.slice(0, 30)) {
            errors.push(`Residual CJK (${h.count} char(s)) @ ${h.loc}: "${h.snippet}"`);
        }
        if (cjkHits.length > 30) {
            errors.push(`...plus ${cjkHits.length - 30} more CJK hit(s)`);
        }
    }

    fs.writeFileSync(packedJsonPath, JSON.stringify(packedCard, null, 2), 'utf8');

    if (errors.length > 0) {
        const failSummary = { ok: false, errorCount: errors.length, cjkHitCount: cjkHits.length, errors };
        throw Object.assign(new Error(`Card pack integrity failed (${errors.length} error(s))`), { failSummary });
    }

    const outPngBytes = repackPngLossless(srcPng, outPng, packedCard);
    return {
        ok: true,
        outputPng: outPng,
        outputPngBytes: outPngBytes,
        outputJsonBytes: Buffer.byteLength(JSON.stringify(packedCard), 'utf8'),
        bookName: characterBookName,
        wiEntryCount: translatedEntries.length,
        regexCount: dOut.extensions.regex_scripts.length,
        openingHtmlBytes: Buffer.byteLength(openingHtml, 'utf8'),
        cjkHitCount: cjkHits.length,
    };
}

const isEntry = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntry) {
    try {
        const opts = parseCliArgs(process.argv.slice(2));
        const res = packCard(opts);
        console.log(JSON.stringify(res, null, 2));
    } catch (err) {
        if (err.failSummary) {
            console.error(JSON.stringify(err.failSummary, null, 2));
        } else {
            console.error(err.message || err);
        }
        process.exit(1);
    }
}
