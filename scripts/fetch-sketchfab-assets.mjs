import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.sketchfab.com/v3/';
const ROOT = path.resolve(import.meta.dirname, '..');
const MODELS = path.join(ROOT, 'assets', 'models');
const REGISTRY = path.join(ROOT, 'src', 'sketchfabAssets.js');
const CREDITS = path.join(MODELS, 'ATTRIBUTION.md');
const LIMIT = 15000;
const BUNDLED_UIDS = new Set(['12cb749961974f94a4063e67dafb2d76', 'a676e149e343403bb5e57686f3d31da5']);
const licenses = {
    cc0: { label: 'CC0', pattern: /^(?:CC0(?: Public Domain)?|CC0 1\.0(?: Universal)?)$/i, url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    by: { label: 'CC BY', pattern: /^(?:CC Attribution|CC BY)(?: 4\.0(?: International)?)?$/i, url: 'https://creativecommons.org/licenses/by/4.0/' },
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextApiCall = 0;

async function api(endpoint, token) {
    const url = new URL(endpoint, API);
    if (!url.href.startsWith(API)) throw new Error('Unexpected Sketchfab API URL');
    for (let attempt = 0; ; attempt++) {
        await sleep(Math.max(0, nextApiCall - Date.now()));
        nextApiCall = Date.now() + 1500;
        let response;
        try {
            response = await fetch(url, {
                headers: token ? { Authorization: `Token ${token}` } : undefined,
                redirect: 'error',
                signal: AbortSignal.timeout(30000),
            });
        } catch {
            throw new Error('Sketchfab API connection failed');
        }
        if (response.status === 429 && attempt < 4) {
            const header = response.headers.get('retry-after');
            const retryMs = header && /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
            await response.body?.cancel();
            const delay = Math.max(1500 * 2 ** attempt, retryMs || 0);
            if (delay > 120000) throw new Error('Sketchfab rate limit requires a retry in more than two minutes');
            console.error(`Sketchfab rate limited the request. Retrying in ${Math.ceil(delay / 1000)}s.`);
            nextApiCall = Math.max(nextApiCall, Date.now() + delay);
            continue;
        }
        if (!response.ok) throw new Error(`Sketchfab API returned HTTP ${response.status}`);
        return response.json().catch(() => { throw new Error('Sketchfab API returned invalid JSON'); });
    }
}

function modelMetadata(model, maxFaces) {
    const license = Object.keys(licenses).find((key) => licenses[key].pattern.test(model.license?.label));
    const { uid, name, faceCount, viewerUrl } = model;
    const author = model.user?.displayName || model.user?.username;
    const glbFaces = model.archives?.glb?.faceCount ?? faceCount;
    if (!model.isDownloadable || !license || !/^[a-f0-9]{32}$/.test(uid)
        || typeof name !== 'string' || !name.trim() || typeof author !== 'string' || !author.trim()
        || !Number.isInteger(faceCount) || faceCount < 1 || faceCount > maxFaces
        || !Number.isInteger(glbFaces) || glbFaces < 1 || glbFaces > maxFaces
        || !/^https:\/\/sketchfab\.com\/3d-models\/[a-z0-9-]+$/i.test(viewerUrl)
        || !viewerUrl.endsWith(uid)) return null;
    const licenseUrl = model.license.url?.replace(/^http:/, 'https:') || licenses[license].url;
    if (licenseUrl.replace(/\/$/, '') !== licenses[license].url.replace(/\/$/, '')) return null;
    return { uid, name, author, license, viewerUrl, faceCount, glbFaces, likes: model.likeCount ?? 0, bytes: model.archives?.glb?.size };
}

async function search(queries, { maxFaces, maxBytes, limit, pages, json }) {
    for (const q of queries) {
        const candidates = [];
        for (const license of Object.keys(licenses)) {
            const params = new URLSearchParams({
                type: 'models', q, downloadable: 'true', license,
                max_face_count: String(maxFaces), sort_by: '-likeCount',
            });
            let endpoint = `search?${params}`;
            let count = 0;
            for (let page = 0; endpoint && page < pages && count < limit; page++) {
                const data = await api(endpoint);
                for (const result of data.results) {
                    const candidate = modelMetadata(result, maxFaces);
                    if (candidate?.license !== license || BUNDLED_UIDS.has(candidate.uid)
                        || !Number.isInteger(candidate.bytes) || candidate.bytes < 1 || candidate.bytes > maxBytes) continue;
                    candidates.push(candidate);
                    if (++count === limit) break;
                }
                if (data.cursors?.next) {
                    params.set('cursor', data.cursors.next);
                    endpoint = `search?${params}`;
                } else {
                    endpoint = null;
                }
            }
        }
        if (json) {
            console.log(JSON.stringify({ query: q, candidates }));
        } else {
            console.log(q);
            console.table(candidates.map(({ uid, name, license, faceCount, likes, author }) => ({
                uid, name, license: licenses[license].label, faceCount, likes, author,
            })));
        }
    }
}

function parseEntry(entry, maxFaces) {
    if (!entry || typeof entry !== 'object') throw new Error('Every batch entry must be an object with a UID');
    const { uid, id = `sketchfab_${uid}`, size = [1, 1, 1], preRotY = 0, maxFaces: faces = maxFaces } = entry;
    if (typeof uid !== 'string' || !/^[a-f0-9]{32}$/.test(uid)) throw new Error('Invalid Sketchfab UID');
    if (typeof id !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(id) || Object.hasOwn(Object.prototype, id)) {
        throw new Error(`Invalid Atlas shape ID for ${uid}`);
    }
    if (!Array.isArray(size) || size.length !== 3 || size.some((n, i) => !Number.isFinite(n) || n < 0.25 || n > (i === 2 ? 20 : 30))) {
        throw new Error(`Invalid [width, depth, height] for ${id}`);
    }
    if (!Number.isFinite(preRotY) || !Number.isInteger(faces) || faces < 1 || faces > maxFaces) {
        throw new Error(`Invalid rotation or face limit for ${id}`);
    }
    return { uid, id, size, preRotY, maxFaces: faces };
}

function readEntries({ options, queries, maxFaces }) {
    const uid = options.get('--uid');
    const batch = options.get('--batch');
    if (queries.length || Boolean(uid) === Boolean(batch)) throw new Error('Specify exactly one of --uid or --batch');
    if (batch) {
        if (['--id', '--size', '--pre-rot-y'].some((key) => options.has(key))) {
            throw new Error('Set ID, size and rotation in the batch rows');
        }
        let entries;
        try {
            entries = JSON.parse(fs.readFileSync(batch, 'utf8'));
        } catch {
            throw new Error('Could not read the batch as JSON');
        }
        if (!Array.isArray(entries) || !entries.length) throw new Error('The batch must be a nonempty JSON array');
        return entries.map((entry) => parseEntry(entry, maxFaces));
    }
    return [parseEntry({
        uid,
        id: options.get('--id'),
        size: options.get('--size')?.split(',').map(Number),
        preRotY: options.has('--pre-rot-y') ? Number(options.get('--pre-rot-y')) : undefined,
    }, maxFaces)];
}

const registryPrefix = '// Updated by scripts/fetch-sketchfab-assets.mjs.\nexport const SKETCHFAB_ASSETS = Object.freeze(';
const registrySuffix = ');\n';

function readRegistry() {
    const source = fs.readFileSync(REGISTRY, 'utf8').replace(/\r\n/g, '\n');
    if (!source.startsWith(registryPrefix) || !source.endsWith(registrySuffix)) {
        throw new Error('Unexpected generated registry format');
    }
    return JSON.parse(source.slice(registryPrefix.length, -registrySuffix.length));
}

function verifyGlb(bytes, maxFaces) {
    if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2
        || bytes.readUInt32LE(8) !== bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a
        || bytes.readUInt32LE(12) > bytes.length - 20) throw new Error('Invalid GLB 2.0 header');
    let gltf;
    try {
        gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    } catch {
        throw new Error('GLB contains invalid JSON');
    }
    if (gltf?.asset?.version !== '2.0' || !gltf.scenes?.[gltf.scene ?? 0]?.nodes?.length) {
        throw new Error('GLB has no supported default scene');
    }
    if ([...(gltf.buffers ?? []), ...(gltf.images ?? [])].some(({ uri }) => uri && !uri.startsWith('data:'))) {
        throw new Error('GLB references external resources');
    }
    const unsupported = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'];
    if (gltf.extensionsRequired?.some((name) => unsupported.includes(name))) throw new Error('GLB requires an extra decoder');
    let faces = 0;
    for (const { primitives } of gltf.meshes ?? []) {
        for (const { mode = 4, indices, attributes } of primitives) {
            const count = gltf.accessors?.[indices ?? attributes?.POSITION]?.count;
            if (![4, 5, 6].includes(mode) || !Number.isInteger(count) || count < 3 || mode === 4 && count % 3) {
                throw new Error('GLB contains invalid or unsupported mesh geometry');
            }
            faces += mode === 4 ? count / 3 : count - 2;
        }
    }
    if (faces < 1 || faces > maxFaces) throw new Error(`GLB has ${faces} triangles (limit ${maxFaces})`);
    return faces;
}

async function downloadGlb(info, maxBytes) {
    if (!Number.isInteger(info?.size) || info.size < 1 || info.size > maxBytes
        || typeof info.url !== 'string' || !URL.canParse(info.url) || new URL(info.url).protocol !== 'https:') {
        throw new Error('No eligible GLB download metadata within the size limit');
    }
    try {
        // The signed archive URL needs no Sketchfab Authorization header.
        const response = await fetch(info.url, { signal: AbortSignal.timeout(60000), redirect: 'error' });
        if (!response.ok || !response.body) throw new Error(`Archive request failed (HTTP ${response.status})`);
        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new Error('Archive exceeds the size limit');
            }
            chunks.push(value);
        }
        return Buffer.concat(chunks, total);
    } catch {
        throw new Error('GLB transfer failed or exceeded the size limit');
    }
}

function atomicWrite(target, data) {
    const temp = `${target}.sketchfab-tmp`;
    try {
        fs.writeFileSync(temp, data);
        fs.renameSync(temp, target);
    } finally {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
}

function appendCredit(model, file) {
    const marker = `<!-- sketchfab:${model.uid} -->`;
    const credits = fs.readFileSync(CREDITS, 'utf8');
    if (credits.includes(marker)) return;
    const escaped = (value) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\\<>`*_\[\]]/g, '\\$&');
    const { label, url } = licenses[model.license];
    atomicWrite(CREDITS, `${credits.trimEnd()}\n\n${marker}\n### \`${file}\` — ${escaped(model.name)}\n\n`
        + `- **Author:** ${escaped(model.author)}\n- **Sketchfab UID:** \`${model.uid}\`\n`
        + `- **Source:** <${model.viewerUrl}>\n- **License:** [${label} ${model.license === 'cc0' ? '1.0' : '4.0'}](${url})\n`
        + '- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.\n');
}

async function fetchAssets(settings) {
    const entries = readEntries(settings);
    const token = process.env.SKETCHFAB_API_TOKEN;
    const maxBytes = settings.maxBytes;
    const lock = path.join(MODELS, '.sketchfab-fetch.lock');
    let handle;
    try {
        handle = fs.openSync(lock, 'wx');
    } catch (error) {
        if (error.code === 'EEXIST') throw new Error('Sketchfab fetch lock already exists in assets/models');
        throw error;
    }
    try {
        const registry = readRegistry();
        const { POLY_SHAPES } = await import('../src/polyCss3d.js');
        const { WEBGL_KIT_CATALOG } = await import('../src/atlasWebgl.js');
        const requested = new Map();
        for (const entry of entries) {
            if (POLY_SHAPES.includes(entry.id) || Object.hasOwn(WEBGL_KIT_CATALOG, entry.id)
                || (registry[entry.id] && registry[entry.id].uid !== entry.uid)
                || (requested.has(entry.id) && requested.get(entry.id) !== entry.uid)) {
                throw new Error(`Atlas shape ID is already reserved: ${entry.id}`);
            }
            requested.set(entry.id, entry.uid);
        }
        for (const entry of entries) {
            try {
                await fetchEntry(entry, registry, token, maxBytes);
            } catch (error) {
                console.error(`${entry.id} (${entry.uid}): ${error.message}`);
                process.exitCode = 1;
            }
        }
    } finally {
        fs.closeSync(handle);
        fs.unlinkSync(lock);
    }
}

async function fetchEntry(entry, registry, token, maxBytes) {
    const { uid, id, preRotY, size, maxFaces } = entry;
    if (BUNDLED_UIDS.has(uid)) {
        console.log(`Skipped ${uid} (already bundled)`);
        return;
    }
    const existing = Object.values(registry).find((record) => record.uid === uid);
    if (existing && fs.existsSync(path.join(MODELS, existing.file))) {
        console.log(`Skipped ${uid} (already registered as ${existing.id})`);
        return;
    }
    if (!token) throw new Error('Set SKETCHFAB_API_TOKEN before fetching');
    if (existing && id !== existing.id) throw new Error(`Restore the missing file using the registered ID ${existing.id}`);
    const model = modelMetadata(await api(`models/${uid}`), maxFaces);
    if (model?.uid !== uid) throw new Error('Model metadata does not satisfy the download, license or geometry requirements');
    if (model.bytes !== undefined && model.bytes > maxBytes) throw new Error('GLB exceeds the size limit');
    const file = `sketchfab-${uid}.glb`;
    const target = path.join(MODELS, file);
    let bytes;
    if (fs.existsSync(target)) {
        if (fs.statSync(target).size > maxBytes) throw new Error('Existing GLB exceeds the size limit');
        bytes = fs.readFileSync(target);
    } else {
        const { glb } = await api(`models/${uid}/download`, token);
        bytes = await downloadGlb(glb, maxBytes);
    }
    const faceCount = verifyGlb(bytes, maxFaces);
    const record = {
        id, uid, pack: `sketchfab-${uid}`, file, size, preRotY, faceCount, bytes: bytes.length,
        name: model.name, author: model.author, license: model.license, viewerUrl: model.viewerUrl,
    };
    if (!fs.existsSync(target)) atomicWrite(target, bytes);
    appendCredit(model, file);
    const updated = { ...registry, [id]: record };
    atomicWrite(REGISTRY, `${registryPrefix}${JSON.stringify(updated, null, 4)}${registrySuffix}`);
    Object.assign(registry, updated);
    console.log(`Registered ${id} (${bytes.length} bytes, ${faceCount} triangles)`);
}

const usage = `Usage:
  node scripts/fetch-sketchfab-assets.mjs --dry-run <query> [<query> ...] [--max-face-count 15000] [--max-mb 3] [--limit 5] [--pages 2] [--json]
  node scripts/fetch-sketchfab-assets.mjs --fetch --uid <uid> [--id <shape>] [--size <width,depth,height>] [--pre-rot-y <radians>] [--max-mb 3] [--max-face-count 15000]
  node scripts/fetch-sketchfab-assets.mjs --fetch --batch <json-file> [--max-mb 3] [--max-face-count 15000]

--search is an alias for --dry-run. Both are metadata-only and try CC0 before CC BY.
A batch is a JSON array of { "uid", "id"?, "size"?: [w,d,h], "preRotY"?, "maxFaces"? }.
Sizes use meters in Atlas order. UID-only entries use a sketchfab_<uid> shape and a 1m footprint.
`;

function parseArgs(args) {
    const flags = new Set(['--search', '--dry-run', '--fetch', '--json']);
    const values = new Set(['--uid', '--id', '--size', '--pre-rot-y', '--max-face-count', '--max-mb', '--limit', '--pages', '--batch']);
    const options = new Map();
    const queries = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg.startsWith('--')) {
            queries.push(arg);
            continue;
        }
        if (options.has(arg)) throw new Error(`Duplicate option ${arg}`);
        if (flags.has(arg)) options.set(arg, true);
        else if (values.has(arg) && args[i + 1] && !args[i + 1].startsWith('--')) options.set(arg, args[++i]);
        else throw new Error(`Invalid option or missing value for ${arg}`);
    }
    const fetchMode = options.has('--fetch');
    if (fetchMode === (options.has('--search') || options.has('--dry-run'))) throw new Error('Specify one mode');
    const allowed = fetchMode
        ? ['--fetch', '--uid', '--id', '--size', '--pre-rot-y', '--batch']
        : ['--search', '--dry-run', '--limit', '--pages', '--json'];
    allowed.push('--max-face-count', '--max-mb');
    if ([...options.keys()].some((key) => !allowed.includes(key))) throw new Error('Option does not apply to this mode');
    const number = (key, fallback, ceiling) => {
        const value = Number(options.get(key) ?? fallback);
        if (!Number.isInteger(value) || value < 1 || value > ceiling) throw new Error(`Invalid ${key}`);
        return value;
    };
    const maxBytes = Math.floor(Number(options.get('--max-mb') ?? 3) * 1000000);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid --max-mb');
    return {
        options, queries, fetchMode, maxBytes,
        maxFaces: number('--max-face-count', LIMIT, LIMIT),
        limit: number('--limit', 5, 100), pages: number('--pages', 2, 20), json: options.has('--json'),
    };
}

async function main() {
    const args = process.argv.slice(2);
    if (!args.length || args.length === 1 && args[0] === '--help') {
        console.log(usage);
        return;
    }
    const settings = parseArgs(args);
    if (settings.fetchMode) {
        await fetchAssets(settings);
    } else {
        if (!settings.queries.length || settings.queries.some((q) => !q.trim())) throw new Error('Provide at least one search query');
        await search(settings.queries, settings);
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
