/**
 * On-Demand 3D Model Library & Collection Manager for Lapis Philosophorum Engine (LPE).
 *
 * Pure ES module (no Three.js or jQuery dependency) managing:
 *  - Default bundled CC BY 4.0 / CC0 asset catalog (preserved intact; never evicted)
 *  - External manifest fetching & parsing from ST-LapisPhilosophorumEngineLibrary
 *  - On-demand GLB validation, IndexedDB/memory binary caching, and lightweight metadata storage
 *  - Per-card / session collection assignment & resolution with graceful fallback
 *  - CC0 / CC BY 4.0 attribution formatting & preservation
 */

import { SKETCHFAB_ASSETS } from './sketchfabAssets.js';

export const DEFAULT_LIBRARY_REPO_URL = 'https://github.com/250000000001/ST-LapisPhilosophorumEngineLibrary';
export const DEFAULT_LIBRARY_BRANCH = 'main';
export const DEFAULT_LIBRARY_BASE_URL = `https://raw.githubusercontent.com/250000000001/ST-LapisPhilosophorumEngineLibrary/${DEFAULT_LIBRARY_BRANCH}/`;
export const DEFAULT_LIBRARY_MANIFEST_URL = `${DEFAULT_LIBRARY_BASE_URL}manifest.json`;
export const DEFAULT_COLLECTION_ID = 'default';
export const MAX_EXTERNAL_GLB_BYTES = 25 * 1024 * 1024;
export const MODEL_LIBRARY_META_VERSION = 1;

export const COLLECTION_LABELS = Object.freeze({
    all: 'All Collections',
    default: 'Default Bundled',
    installed: 'Downloaded Only',
    'sci-fi': 'Sci-Fi',
    medieval: 'Medieval',
    tavern: 'Tavern',
    residential: 'Residential',
    exterior: 'Exterior',
    industrial: 'Industrial',
});

const SAFE_SHAPE_RE = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_ID_RE = /^[a-z0-9][a-z0-9_.:-]{0,79}$/i;

const LICENSE_SPECS = Object.freeze({
    cc0: {
        code: 'cc0',
        label: 'CC0 1.0',
        url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    },
    by: {
        code: 'by',
        label: 'CC BY 4.0',
        url: 'https://creativecommons.org/licenses/by/4.0/',
    },
});

// Static metadata mirror of bundled kit entries in src/atlasWebgl.js so modelLibrary.js
// stays lightweight with zero eager Three.js import.
const BUNDLED_PSX_VIEWER = 'https://sketchfab.com/3d-models/psx-industrial-pack-12cb749961974f94a4063e67dafb2d76';
const BUNDLED_PSX_UID = '12cb749961974f94a4063e67dafb2d76';
const BUNDLED_SCIFI_VIEWER = 'https://sketchfab.com/3d-models/sci-fi-lab-a676e149e343403bb5e57686f3d31da5';
const BUNDLED_SCIFI_UID = 'a676e149e343403bb5e57686f3d31da5';

const BUNDLED_KIT_ENTRIES = Object.freeze([
    { id: 'container', name: 'Cargo Container (PSX)', pack: 'psx', file: 'psx-industrial.glb', node: 'CargoContainer', preRotY: 0, size: [5.2, 2.2, 2.45], collections: ['default', 'industrial', 'exterior'] },
    { id: 'barrel', name: 'Industrial / Tavern Barrel (PSX)', pack: 'psx', file: 'psx-industrial.glb', node: 'BarrelWine', styleNodes: { industrial: 'BarrelOil', scifi: 'BarrelWater', tavern: 'BarrelWine', medieval: 'BarrelWine' }, preRotY: 0, size: [0.7, 0.7, 1.02], collections: ['default', 'industrial', 'tavern', 'medieval', 'sci-fi'] },
    { id: 'crate', name: 'Storage Crate (PSX)', pack: 'psx', file: 'psx-industrial.glb', node: 'CrateWood', styleNodes: { industrial: 'CrateMetal', scifi: 'CrateMetal2', street: 'CrateWood2' }, preRotY: 0, size: [0.95, 0.95, 0.95], collections: ['default', 'industrial', 'medieval', 'sci-fi'] },
    { id: 'dumpster', name: 'Dumpster (PSX)', pack: 'psx', file: 'psx-industrial.glb', node: 'Dumpster', preRotY: Math.PI / 2, size: [2.1, 1.3, 1.25], collections: ['default', 'industrial', 'exterior'] },
    { id: 'generator', name: 'Generator Unit (PSX)', pack: 'psx', file: 'psx-industrial.glb', node: 'GeneratorUnit', styleNodes: { cave: 'GeneratorPortable', street: 'GeneratorPortable' }, preRotY: 0, size: [1.7, 1.15, 1.45], collections: ['default', 'industrial', 'sci-fi'] },
    { id: 'locker', name: 'Steel Locker (PSX)', pack: 'psx', file: 'psx-industrial.glb', node: 'Locker', preRotY: 0, size: [0.9, 0.52, 2.0], collections: ['default', 'industrial', 'sci-fi'] },
    { id: 'pallet', name: 'Shipping Pallet (PSX)', pack: 'psx', file: 'psx-industrial.glb', node: 'Pallet', preRotY: Math.PI / 2, size: [1.3, 1.05, 0.2], collections: ['default', 'industrial'] },
    { id: 'propane', name: 'Propane Cylinder (PSX)', pack: 'psx', file: 'psx-industrial.glb', node: 'PropaneTankSmall', preRotY: 0, size: [0.48, 0.48, 1.12], collections: ['default', 'industrial'] },
    { id: 'pipes', name: 'Pipe Conduits (PSX)', pack: 'psx', file: 'psx-industrial.glb', node: 'ConcretePipePile', styleNodes: { scifi: 'MetalPipe' }, preRotY: Math.PI / 2, size: [2.1, 0.6, 1.85], collections: ['default', 'industrial', 'sci-fi'] },
    { id: 'bin', name: 'Trash Bin (PSX)', pack: 'psx', file: 'psx-industrial.glb', node: 'TrashCan', preRotY: 0, size: [0.6, 0.6, 0.9], collections: ['default', 'industrial', 'exterior'] },
    { id: 'vat', name: 'Cryo / Bio Vat (Sci-Fi Lab)', pack: 'scifi', file: 'scifi-lab-props.glb', node: 'sci_vat', preRotY: 0, size: [1.35, 1.35, 2.55], collections: ['default', 'sci-fi'] },
    { id: 'console', name: 'Lab Control Console (Sci-Fi Lab)', pack: 'scifi', file: 'scifi-lab-props.glb', node: 'sci_console', preRotY: Math.PI / 2, size: [2.1, 0.88, 1.38], collections: ['default', 'sci-fi'] },
    { id: 'cabinet', name: 'Storage Cabinet (Sci-Fi Lab)', pack: 'scifi', file: 'scifi-lab-props.glb', node: 'sci_cabinet', preRotY: Math.PI / 2, size: [1.05, 0.58, 2.05], collections: ['default', 'sci-fi'] },
    { id: 'airlock', name: 'Bulkhead Airlock (Sci-Fi Lab)', pack: 'scifi', file: 'scifi-lab-props.glb', node: 'sci_airlock', preRotY: 0, size: [2.3, 0.65, 2.45], collections: ['default', 'sci-fi'] },
    { id: 'screen', name: 'Lab Viewscreen (Sci-Fi Lab)', pack: 'scifi', file: 'scifi-lab-props.glb', node: 'sci_screen', preRotY: Math.PI / 2, size: [1.95, 0.24, 1.35], collections: ['default', 'sci-fi'] },
    { id: 'jar', name: 'Specimen Jar (Sci-Fi Lab)', pack: 'scifi', file: 'scifi-lab-props.glb', node: 'sci_jar', preRotY: 0, size: [0.45, 0.45, 0.72], collections: ['default', 'sci-fi'] },
]);

const BUNDLED_KIT_MAP = Object.freeze(
    Object.fromEntries(BUNDLED_KIT_ENTRIES.map((entry) => [
        entry.id,
        {
            pack: entry.pack,
            node: entry.node,
            ...(entry.styleNodes ? { styleNodes: entry.styleNodes } : {}),
            preRotY: entry.preRotY || 0,
            author: entry.pack === 'scifi' ? 'Agata Wilczek' : 'Tomitos',
            license: 'CC BY 4.0',
        },
    ])),
);

const SKETCHFAB_COLLECTION_MAP = Object.freeze({
    couch: ['default', 'residential'],
    armchair: ['default', 'residential'],
    table: ['default', 'medieval', 'tavern', 'residential'],
    bed: ['default', 'medieval', 'residential'],
    rug: ['default', 'medieval', 'residential'],
    desk: ['default', 'residential'],
    wall_bookshelf: ['default', 'medieval', 'residential'],
    globe: ['default', 'medieval', 'residential'],
    book_stack: ['default', 'medieval', 'residential'],
    bar_counter: ['default', 'tavern', 'medieval'],
    wood_stove: ['default', 'tavern', 'medieval'],
    kitchen_counter: ['default', 'tavern', 'residential'],
    display_shelf: ['default', 'tavern', 'residential'],
    desk_lamp: ['default', 'residential'],
    chandelier: ['default', 'medieval', 'tavern'],
    lantern: ['default', 'medieval', 'tavern', 'exterior'],
    wall_sconce: ['default', 'medieval', 'tavern'],
    streetlamp: ['default', 'exterior'],
    park_bench: ['default', 'exterior'],
    potted_plant: ['default', 'residential', 'exterior'],
    fountain: ['default', 'medieval', 'exterior'],
    signpost: ['default', 'medieval', 'exterior'],
});

const packInvalidateListeners = new Set();
let activeInstalledExternalShapes = new Set();

export function onPackCacheInvalidate(listener) {
    if (typeof listener !== 'function') return () => {};
    packInvalidateListeners.add(listener);
    return () => packInvalidateListeners.delete(listener);
}

export function notifyPackCacheInvalidate(packId = null) {
    for (const listener of packInvalidateListeners) {
        try {
            listener(packId);
        } catch {
            // Isolate listener errors
        }
    }
}

export function normalizeCollectionSlug(raw) {
    const cleaned = String(raw ?? '')
        .trim()
        .toLowerCase()
        .replace(/[_/]+/g, '-')
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9:_-]+/g, '')
        .replace(/^-+|-+$/g, '');
    if (!cleaned) return '';
    if (cleaned === 'scifi' || cleaned === 'sci-fi' || cleaned === 'sci') return 'sci-fi';
    if (cleaned === 'default-bundled' || cleaned === 'bundled' || cleaned === 'default') return DEFAULT_COLLECTION_ID;
    if (cleaned === 'all-collections' || cleaned === 'all') return 'all';
    return cleaned;
}

export function formatCollectionLabel(slug, manifestCollections = []) {
    const key = normalizeCollectionSlug(slug) || String(slug || '').trim().toLowerCase();
    if (!key) return 'Default Bundled';
    if (Array.isArray(manifestCollections)) {
        const hit = manifestCollections.find((c) => normalizeCollectionSlug(c?.id) === key);
        if (hit?.name) return String(hit.name);
    }
    if (COLLECTION_LABELS[key]) return COLLECTION_LABELS[key];
    return key
        .split(/[-_:]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

export function formatBytesMb(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '—';
    const mb = n / (1024 * 1024);
    if (mb >= 0.1) return `${mb.toFixed(2)} MB`;
    const kb = n / 1024;
    return `${kb.toFixed(1)} KB`;
}

export function normalizeLicenseMeta(rawLicense, rawUrl = '') {
    const text = String(rawLicense ?? '').trim();
    const low = text.toLowerCase();
    const safeUrl = sanitizeSafeHttpUrl(rawUrl);

    if (low === 'cc0' || /^cc0(?:\s*1\.0)?(?:\s+universal|\s+public\s+domain)?$/i.test(text)) {
        return {
            code: 'cc0',
            label: LICENSE_SPECS.cc0.label,
            url: safeUrl || LICENSE_SPECS.cc0.url,
        };
    }
    if (low === 'by' || /^cc[-\s]*(?:by|attribution)(?:[-\s]*4\.0)?(?:\s+international)?$/i.test(text)) {
        return {
            code: 'by',
            label: LICENSE_SPECS.by.label,
            url: safeUrl || LICENSE_SPECS.by.url,
        };
    }
    return {
        code: low || 'custom',
        label: text || 'Unknown',
        url: safeUrl,
    };
}

function toFiniteNumber(val) {
    if (val === undefined || val === null || typeof val === 'boolean') return null;
    if (typeof val === 'string' && !val.trim()) return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
}

function sanitizeSafeHttpUrl(raw) {
    const str = String(raw ?? '').trim();
    if (!str) return '';
    if (/^(?:javascript|vbscript):/i.test(str)) return '';
    if (/^https?:\/\//i.test(str)) {
        try {
            const u = new URL(str);
            return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '';
        } catch {
            return '';
        }
    }
    return '';
}

function sanitizeShapeId(rawShape, fallbackId = '') {
    const candidate = String(rawShape || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (SAFE_SHAPE_RE.test(candidate) && !Object.hasOwn(Object.prototype, candidate)) {
        return candidate;
    }
    const idNorm = String(fallbackId || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (SAFE_SHAPE_RE.test(idNorm) && !Object.hasOwn(Object.prototype, idNorm)) {
        return idNorm;
    }
    return '';
}

function normalizeModelId(rawId) {
    const clean = String(rawId ?? '').trim();
    if (!SAFE_ID_RE.test(clean) || Object.hasOwn(Object.prototype, clean)) return '';
    return clean;
}

function parseOptionalSize(rawSize) {
    if (!Array.isArray(rawSize) || rawSize.length < 2) return null;
    const w = toFiniteNumber(rawSize[0]);
    const d = toFiniteNumber(rawSize[1]);
    const h = toFiniteNumber(rawSize[2] !== undefined ? rawSize[2] : rawSize[1]);
    if (w === null || d === null || h === null) return null;
    if (![w, d, h].every((n) => n >= 0.1 && n <= 40)) return null;
    return [w, d, h];
}

function parseOptionalScale(rawScale) {
    if (rawScale === undefined || rawScale === null || rawScale === '') return null;
    const single = toFiniteNumber(rawScale);
    if (typeof rawScale === 'number' && single !== null) {
        if (single <= 0) return null;
        const c = Math.max(0.1, Math.min(4, single));
        return [c, c, c];
    }
    if (Array.isArray(rawScale) && rawScale.length >= 3) {
        const nums = rawScale.slice(0, 3).map((n) => toFiniteNumber(n));
        if (nums.every((n) => n !== null && n > 0)) {
            return nums.map((n) => Math.max(0.1, Math.min(4, n)));
        }
    }
    return null;
}

function parseOptionalRotation3(rawRot) {
    if (!Array.isArray(rawRot) || rawRot.length < 3) return null;
    const nums = rawRot.slice(0, 3).map((n) => toFiniteNumber(n));
    if (nums.every((n) => n !== null)) return nums;
    return null;
}

function normalizeGroundMode(rawMode) {
    const m = String(rawMode ?? '').trim().toLowerCase();
    if (m === 'center' || m === 'middle') return 'center';
    if (m === 'top' || m === 'ceiling') return 'top';
    return 'bottom';
}

function normalizeCollectionsList(rawCols, rawTags) {
    const set = new Set();
    const pushItem = (val) => {
        if (Array.isArray(val)) {
            for (const x of val) pushItem(x);
            return;
        }
        if (typeof val === 'string') {
            for (const part of val.split(/[,|;]+/)) {
                const slug = normalizeCollectionSlug(part);
                if (slug && slug !== 'all' && slug !== 'installed') set.add(slug);
            }
        }
    };
    pushItem(rawCols);
    pushItem(rawTags);
    return [...set];
}

/**
 * Resolve an input manifest/repo URL into canonical `{ manifestUrl, baseUrl, repoUrl }`.
 * Supports GitHub repository URLs, `/tree/<branch>` URLs, `/blob/<branch>/manifest.json`,
 * directory URLs ending in `/`, direct `.json` URLs, and relative test/local paths.
 */
export function resolveManifestUrl(inputUrl = '') {
    const raw = String(inputUrl ?? '').trim();
    if (!raw) {
        return {
            manifestUrl: DEFAULT_LIBRARY_MANIFEST_URL,
            baseUrl: DEFAULT_LIBRARY_BASE_URL,
            repoUrl: DEFAULT_LIBRARY_REPO_URL,
        };
    }
    if (/^[\\/]{2}/.test(raw) || /^(?:javascript|vbscript|data):/i.test(raw)) {
        throw new Error('Unsafe manifest URL scheme is not allowed.');
    }

    // Relative path or root-relative fixture URL
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
        const clean = raw.replace(/\\/g, '/');
        const pathOnly = clean.split(/[?#]/)[0];
        if (pathOnly.split('/').some((seg) => seg === '..')) {
            throw new Error('Unsafe relative manifest path traversal is not allowed.');
        }
        if (clean.endsWith('/')) {
            return { manifestUrl: `${clean}manifest.json`, baseUrl: clean, repoUrl: DEFAULT_LIBRARY_REPO_URL };
        }
        if (/\.json(?:[?#].*)?$/i.test(clean)) {
            const idx = pathOnly.lastIndexOf('/');
            return {
                manifestUrl: clean,
                baseUrl: idx >= 0 ? pathOnly.slice(0, idx + 1) : './',
                repoUrl: DEFAULT_LIBRARY_REPO_URL,
            };
        }
        const suffix = clean.slice(pathOnly.length);
        const dirClean = `${pathOnly.replace(/\/+$/, '')}/`;
        return {
            manifestUrl: `${dirClean}manifest.json${suffix}`,
            baseUrl: dirClean,
            repoUrl: DEFAULT_LIBRARY_REPO_URL,
        };
    }

    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error(`Invalid manifest URL: "${raw}"`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error(`Unsupported manifest URL protocol: "${parsed.protocol}"`);
    }

    if (parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com') {
        const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
        if (parts.length >= 2) {
            const owner = parts[0];
            const repo = parts[1].replace(/\.git$/i, '');
            let branch = DEFAULT_LIBRARY_BRANCH;
            let restPath = 'manifest.json';
            if ((parts[2] === 'blob' || parts[2] === 'raw' || parts[2] === 'tree') && parts[3]) {
                branch = parts[3];
                const sub = parts.slice(4).join('/');
                if (parts[2] === 'tree') {
                    restPath = sub ? `${sub.replace(/\/+$/, '')}/manifest.json` : 'manifest.json';
                } else {
                    restPath = sub || 'manifest.json';
                }
            }
            const manifestUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${restPath}`;
            const slashIdx = manifestUrl.lastIndexOf('/');
            return {
                manifestUrl,
                baseUrl: manifestUrl.slice(0, slashIdx + 1),
                repoUrl: `https://github.com/${owner}/${repo}`,
            };
        }
    }

    const suffix = parsed.search || '';
    if (parsed.pathname.endsWith('/')) {
        const dirBase = `${parsed.origin}${parsed.pathname}`;
        return {
            manifestUrl: `${dirBase}manifest.json${suffix}`,
            baseUrl: dirBase,
            repoUrl: dirBase,
        };
    }
    if (/\.json$/i.test(parsed.pathname)) {
        const slashIdx = parsed.pathname.lastIndexOf('/');
        const baseDir = slashIdx >= 0 ? parsed.pathname.slice(0, slashIdx + 1) : '/';
        return {
            manifestUrl: `${parsed.origin}${parsed.pathname}${suffix}`,
            baseUrl: `${parsed.origin}${baseDir}`,
            repoUrl: `${parsed.origin}${baseDir}`,
        };
    }
    const basePath = `${parsed.pathname.replace(/\/+$/, '')}/`;
    return {
        manifestUrl: `${parsed.origin}${basePath}manifest.json${suffix}`,
        baseUrl: `${parsed.origin}${basePath}`,
        repoUrl: `${parsed.origin}${parsed.pathname}`,
    };
}

/**
 * Resolve a model `fileurl` against a manifest `baseUrl`.
 * Rejects dangerous URI schemes (`javascript:`, `vbscript:`) and path traversal.
 */
export function resolveAssetUrl(fileUrl, baseUrl = DEFAULT_LIBRARY_BASE_URL) {
    const raw = String(fileUrl ?? '').trim();
    if (!raw) return '';
    if (/^[\\/]{2}/.test(raw) || /^(?:javascript|vbscript):/i.test(raw)) return '';
    if (/^data:/i.test(raw)) {
        return /^data:model\/gltf-binary(?:;base64)?,/i.test(raw) ? raw : '';
    }
    if (/^(?:https?|blob):/i.test(raw)) {
        try {
            const u = new URL(raw);
            return (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'blob:') ? u.href : '';
        } catch {
            return '';
        }
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return '';

    const cleanRel = raw
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/^(?:\.\/)+/, '');
    if (!cleanRel || cleanRel.split('/').some((seg) => seg === '..')) return '';

    const base = String(baseUrl ?? DEFAULT_LIBRARY_BASE_URL).trim() || DEFAULT_LIBRARY_BASE_URL;
    if (/^https?:\/\//i.test(base)) {
        try {
            const normalizedBase = base.endsWith('/') ? base : `${base}/`;
            const resolved = new URL(cleanRel, normalizedBase);
            return (resolved.protocol === 'https:' || resolved.protocol === 'http:') ? resolved.href : '';
        } catch {
            return '';
        }
    }
    const cleanBase = base.replace(/\\/g, '/');
    const prefix = cleanBase.endsWith('/') ? cleanBase : `${cleanBase}/`;
    return `${prefix}${cleanRel}`;
}

/**
 * Return immutable metadata records representing all currently bundled 3D assets
 * (`psx-industrial.glb`, `scifi-lab-props.glb`, and all `SKETCHFAB_ASSETS`).
 */
export function getBundledLibraryItems() {
    const kitItems = BUNDLED_KIT_ENTRIES.map((entry) => {
        const isScifi = entry.pack === 'scifi';
        const lic = normalizeLicenseMeta('by');
        return {
            id: entry.id,
            shape: entry.id,
            name: entry.name,
            collections: [...entry.collections],
            tags: entry.collections.filter((c) => c !== DEFAULT_COLLECTION_ID),
            pack: entry.pack,
            file: entry.file,
            node: entry.node,
            styleNodes: entry.styleNodes ? { ...entry.styleNodes } : null,
            size: [...entry.size],
            preRotY: entry.preRotY || 0,
            faceCount: null,
            sizeBytes: null,
            license: lic.label,
            licenseCode: lic.code,
            licenseUrl: lic.url,
            author: isScifi ? 'Agata Wilczek' : 'Tomitos',
            uid: isScifi ? BUNDLED_SCIFI_UID : BUNDLED_PSX_UID,
            viewerUrl: isScifi ? BUNDLED_SCIFI_VIEWER : BUNDLED_PSX_VIEWER,
            bundled: true,
            installed: true,
            source: 'bundled',
        };
    });

    const sketchfabItems = Object.values(SKETCHFAB_ASSETS).map((item) => {
        const lic = normalizeLicenseMeta(item.license);
        const cols = SKETCHFAB_COLLECTION_MAP[item.id] || [DEFAULT_COLLECTION_ID];
        return {
            id: item.id,
            shape: item.id,
            name: item.name,
            collections: [...cols],
            tags: cols.filter((c) => c !== DEFAULT_COLLECTION_ID),
            pack: item.pack,
            file: item.file,
            node: null,
            styleNodes: null,
            size: [...item.size],
            preRotY: item.preRotY || 0,
            faceCount: item.faceCount || null,
            sizeBytes: Number.isFinite(item.bytes) ? item.bytes : null,
            license: lic.label,
            licenseCode: lic.code,
            licenseUrl: lic.url,
            author: item.author,
            uid: item.uid,
            viewerUrl: item.viewerUrl,
            bundled: true,
            installed: true,
            source: 'bundled',
        };
    });

    return [...kitItems, ...sketchfabItems];
}

/**
 * Parse and validate an external library manifest (`ST-LapisPhilosophorumEngineLibrary`).
 */
export function parseLibraryManifest(rawJson, { manifestUrl = DEFAULT_LIBRARY_MANIFEST_URL, baseUrl = '' } = {}) {
    let data = rawJson;
    if (typeof rawJson === 'string') {
        try {
            data = JSON.parse(rawJson);
        } catch (err) {
            throw new Error(`Invalid library manifest JSON: ${err.message}`);
        }
    }
    if (!data || (typeof data !== 'object' && !Array.isArray(data))) {
        throw new Error('Library manifest must be a JSON object or array of model entries.');
    }

    const derived = resolveManifestUrl(manifestUrl || DEFAULT_LIBRARY_MANIFEST_URL);
    const manifestBaseCandidate = typeof data.baseUrl === 'string' && data.baseUrl.trim() ? data.baseUrl.trim() : '';
    let effectiveBaseUrl = baseUrl || derived.baseUrl;
    if (manifestBaseCandidate) {
        const normalizedCand = manifestBaseCandidate.endsWith('/') ? manifestBaseCandidate : `${manifestBaseCandidate}/`;
        effectiveBaseUrl = resolveAssetUrl(normalizedCand, effectiveBaseUrl) || effectiveBaseUrl;
    }

    const collectionsMeta = [];
    const seenCols = new Set();
    const addColMeta = (idRaw, metaObj = {}) => {
        const id = normalizeCollectionSlug(idRaw);
        if (!id || id === 'all' || id === 'installed' || seenCols.has(id)) return;
        seenCols.add(id);
        collectionsMeta.push({
            id,
            name: String(metaObj?.name || metaObj?.label || formatCollectionLabel(id)).trim(),
            description: String(metaObj?.description || '').trim(),
        });
    };

    if (Array.isArray(data.collections)) {
        for (const c of data.collections) {
            if (typeof c === 'string') addColMeta(c);
            else if (c && typeof c === 'object') addColMeta(c.id || c.slug || c.name, c);
        }
    } else if (data.collections && typeof data.collections === 'object') {
        for (const [k, v] of Object.entries(data.collections)) {
            if (v && typeof v === 'object') addColMeta(k, v);
            else addColMeta(k, { name: String(v || k) });
        }
    }

    const rawModels = Array.isArray(data)
        ? data
        : (Array.isArray(data.models) ? data.models : (Array.isArray(data.items) ? data.items : null));
    if (!rawModels) {
        throw new Error('Library manifest must contain a "models" (or "items") array.');
    }

    const models = [];
    const warnings = [];
    const seenIds = new Set();

    for (let i = 0; i < rawModels.length; i++) {
        const entry = rawModels[i];
        if (!entry || typeof entry !== 'object') {
            warnings.push(`Skipped non-object model entry at index ${i}.`);
            continue;
        }
        const id = normalizeModelId(entry.id ?? entry.modelId);
        if (!id) {
            warnings.push(`Skipped model at index ${i}: invalid or missing "id".`);
            continue;
        }
        if (seenIds.has(id)) {
            warnings.push(`Skipped duplicate model id "${id}".`);
            continue;
        }

        const shape = sanitizeShapeId(entry.shape ?? entry.targetShape, id);
        if (!shape) {
            warnings.push(`Skipped model "${id}": invalid target shape.`);
            continue;
        }

        const name = String(entry.name || '').trim();
        if (!name) {
            warnings.push(`Skipped model "${id}": missing display "name".`);
            continue;
        }

        const rawFileUrl = entry.fileurl ?? entry.fileUrl ?? entry.file_url ?? entry.url ?? entry.file ?? entry.path ?? '';
        const fileurl = resolveAssetUrl(rawFileUrl, effectiveBaseUrl);
        if (!fileurl) {
            warnings.push(`Skipped model "${id}": invalid or unsafe "fileurl".`);
            continue;
        }

        const author = String(entry.author ?? entry.creator ?? '').trim();
        if (!author) {
            warnings.push(`Skipped model "${id}": missing attribution "author".`);
            continue;
        }

        const license = normalizeLicenseMeta(entry.license ?? entry.licenseCode, entry.licenseUrl);
        if (!entry.license && !entry.licenseCode) {
            warnings.push(`Skipped model "${id}": missing "license" (e.g. CC0 or CC BY 4.0).`);
            continue;
        }

        const collections = normalizeCollectionsList(entry.collections ?? entry.collection, entry.tags);
        for (const col of collections) addColMeta(col);

        const sizeBytesRaw = toFiniteNumber(entry.sizeBytes ?? entry.bytes ?? entry.size_bytes);
        const sizeBytes = sizeBytesRaw !== null && sizeBytesRaw >= 0
            ? Math.round(sizeBytesRaw)
            : null;
        const faceCountRaw = toFiniteNumber(entry.faceCount ?? entry.faces ?? entry.triangles);
        const faceCount = faceCountRaw !== null && faceCountRaw > 0
            ? Math.round(faceCountRaw)
            : null;

        const preRotYRaw = toFiniteNumber(entry.preRotY);
        const rotYDegRaw = toFiniteNumber(entry.rotYDeg);
        const rotationYDegRaw = toFiniteNumber(entry.rotationYDeg);
        let preRotY = 0;
        if (preRotYRaw !== null) preRotY = preRotYRaw;
        else if (rotYDegRaw !== null) preRotY = (rotYDegRaw * Math.PI) / 180;
        else if (rotationYDegRaw !== null) preRotY = (rotationYDegRaw * Math.PI) / 180;

        const viewerUrl = sanitizeSafeHttpUrl(entry.viewerUrl ?? entry.viewer_url ?? entry.sourceUrl ?? entry.source);
        const uid = String(entry.uid || id).trim();
        const groundOffsetNum = toFiniteNumber(entry.groundOffset ?? entry.offsetY);

        seenIds.add(id);
        models.push({
            id,
            shape,
            name,
            description: String(entry.description || '').trim(),
            collections,
            tags: normalizeCollectionsList([], entry.tags),
            fileurl,
            sizeBytes,
            faceCount,
            license: license.label,
            licenseCode: license.code,
            licenseUrl: license.url,
            author,
            uid,
            viewerUrl,
            size: parseOptionalSize(entry.size),
            scale: parseOptionalScale(entry.scale),
            preRotY,
            rotation: parseOptionalRotation3(entry.rotation),
            groundOffset: groundOffsetNum !== null ? Math.max(-10, Math.min(10, groundOffsetNum)) : 0,
            groundMode: normalizeGroundMode(entry.groundMode ?? entry.grounding),
            node: typeof entry.node === 'string' && entry.node.trim() ? entry.node.trim() : null,
            styleNodes: entry.styleNodes && typeof entry.styleNodes === 'object' ? { ...entry.styleNodes } : null,
            sha256: typeof entry.sha256 === 'string' ? entry.sha256.trim().toLowerCase() : '',
            bundled: false,
            source: 'external',
        });
    }

    return {
        version: toFiniteNumber(data.version) ?? MODEL_LIBRARY_META_VERSION,
        name: String(data.name || 'LPE External 3D Model Library').trim(),
        updatedAt: String(data.updatedAt || '').trim(),
        manifestUrl: derived.manifestUrl,
        baseUrl: effectiveBaseUrl,
        collections: collectionsMeta,
        models,
        warnings,
    };
}

function toUint8View(bufferOrView) {
    if (!bufferOrView) return null;
    if (bufferOrView instanceof Uint8Array) return bufferOrView;
    if (bufferOrView instanceof ArrayBuffer) return new Uint8Array(bufferOrView);
    if (ArrayBuffer.isView(bufferOrView)) {
        return new Uint8Array(bufferOrView.buffer, bufferOrView.byteOffset, bufferOrView.byteLength);
    }
    return null;
}

/**
 * Validate binary glTF 2.0 (.glb) container magic, version, length, and JSON chunk header.
 */
export function validateGlbHeader(bufferOrView, maxBytes = MAX_EXTERNAL_GLB_BYTES) {
    const view = toUint8View(bufferOrView);
    if (!view || view.byteLength < 20) {
        return { ok: false, error: 'GLB payload is empty or shorter than 20-byte header.' };
    }
    if (view.byteLength > maxBytes) {
        return { ok: false, error: `GLB payload exceeds max limit (${formatBytesMb(maxBytes)}).` };
    }
    const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
    if (dv.getUint32(0, true) !== 0x46546c67) {
        return { ok: false, error: 'Invalid GLB magic header (expected binary glTF 2.0).' };
    }
    if (dv.getUint32(4, true) !== 2) {
        return { ok: false, error: 'Unsupported glTF binary version (expected v2).' };
    }
    const declaredLen = dv.getUint32(8, true);
    if (declaredLen !== view.byteLength) {
        return { ok: false, error: `Truncated GLB length (expected ${declaredLen}, got ${view.byteLength}).` };
    }
    const jsonChunkLen = dv.getUint32(12, true);
    const jsonChunkType = dv.getUint32(16, true);
    if (jsonChunkType !== 0x4e4f534a || jsonChunkLen > view.byteLength - 20) {
        return { ok: false, error: 'Corrupt GLB JSON chunk header.' };
    }
    return { ok: true, bytes: view.byteLength };
}

/** Ensure `settings.modelLibrary` exists cleanly with all required fields. */
export function ensureModelLibrarySettings(settings) {
    if (!settings || typeof settings !== 'object') {
        return {
            manifestUrl: DEFAULT_LIBRARY_MANIFEST_URL,
            defaultCollection: DEFAULT_COLLECTION_ID,
            cardCollections: {},
            installed: {},
            cachedManifest: null,
        };
    }
    if (!settings.modelLibrary || typeof settings.modelLibrary !== 'object' || Object.isFrozen(settings.modelLibrary)) {
        const src = settings.modelLibrary && typeof settings.modelLibrary === 'object' ? settings.modelLibrary : {};
        settings.modelLibrary = {
            manifestUrl: typeof src.manifestUrl === 'string' && src.manifestUrl.trim() ? src.manifestUrl.trim() : DEFAULT_LIBRARY_MANIFEST_URL,
            defaultCollection: normalizeCollectionSlug(src.defaultCollection) || DEFAULT_COLLECTION_ID,
            cardCollections: src.cardCollections && typeof src.cardCollections === 'object' && !Array.isArray(src.cardCollections)
                ? { ...src.cardCollections }
                : {},
            installed: src.installed && typeof src.installed === 'object' && !Array.isArray(src.installed)
                ? JSON.parse(JSON.stringify(src.installed))
                : {},
            cachedManifest: src.cachedManifest && typeof src.cachedManifest === 'object'
                ? JSON.parse(JSON.stringify(src.cachedManifest))
                : null,
        };
    }
    const ml = settings.modelLibrary;
    if (typeof ml.manifestUrl !== 'string' || !ml.manifestUrl.trim()) {
        ml.manifestUrl = DEFAULT_LIBRARY_MANIFEST_URL;
    }
    if (!ml.defaultCollection || typeof ml.defaultCollection !== 'string') {
        ml.defaultCollection = DEFAULT_COLLECTION_ID;
    }
    if (!ml.cardCollections || typeof ml.cardCollections !== 'object' || Array.isArray(ml.cardCollections) || Object.isFrozen(ml.cardCollections)) {
        ml.cardCollections = {};
    }
    if (!ml.installed || typeof ml.installed !== 'object' || Array.isArray(ml.installed) || Object.isFrozen(ml.installed)) {
        ml.installed = {};
    }
    return ml;
}

/** Resolve a stable per-card / group / chat key and display label from SillyTavern context. */
export function resolveCardKey(ctx) {
    if (!ctx || typeof ctx !== 'object') {
        return { key: '', label: 'Global Workspace', kind: 'global' };
    }
    if (ctx.groupId !== undefined && ctx.groupId !== null && ctx.groupId !== '') {
        const groups = ctx.groups;
        const grp = Array.isArray(groups)
            ? groups.find((g) => String(g?.id ?? '') === String(ctx.groupId))
            : groups?.[ctx.groupId];
        return {
            key: `group:${String(ctx.groupId)}`,
            label: String(grp?.name || `Group ${ctx.groupId}`),
            kind: 'group',
        };
    }
    if (ctx.characterId !== undefined && ctx.characterId !== null && ctx.characterId !== '') {
        const ch = ctx.characters?.[ctx.characterId];
        const rawIdent = String(ch?.avatar || ch?.name || ctx.characterId).trim();
        return {
            key: `card:${rawIdent.toLowerCase()}`,
            label: String(ch?.name || `Character #${ctx.characterId}`),
            kind: 'card',
        };
    }
    if (ctx.chatId) {
        return {
            key: `chat:${String(ctx.chatId)}`,
            label: String(ctx.chatId),
            kind: 'chat',
        };
    }
    return { key: '', label: 'Global Workspace', kind: 'global' };
}

/**
 * Resolve active collection slug with precedence:
 * per-chat/session override -> per-card setting -> global default collection -> 'default'.
 */
export function resolveActiveCollection({ settings = null, cardKey = '', sessionCollection = '' } = {}) {
    const sess = normalizeCollectionSlug(sessionCollection);
    if (sess && sess !== 'installed') return sess;

    const ml = settings?.modelLibrary;
    if (cardKey && ml?.cardCollections && typeof ml.cardCollections[cardKey] === 'string') {
        const cardCol = normalizeCollectionSlug(ml.cardCollections[cardKey]);
        if (cardCol && cardCol !== 'installed') return cardCol;
    }

    const defCol = normalizeCollectionSlug(ml?.defaultCollection);
    if (defCol && defCol !== 'installed') return defCol;
    return DEFAULT_COLLECTION_ID;
}

export function syncInstalledExternalShapes(installedModels = {}) {
    const next = new Set();
    if (installedModels && typeof installedModels === 'object') {
        for (const rec of Object.values(installedModels)) {
            if (!rec || typeof rec !== 'object') continue;
            const sh = sanitizeShapeId(rec.shape, rec.id);
            if (sh) next.add(sh);
            const idAsShape = sanitizeShapeId(rec.id, rec.id);
            if (idAsShape) next.add(idAsShape);
        }
    }
    activeInstalledExternalShapes = next;
    return [...next];
}

export function isInstalledExternalShape(shape) {
    const s = String(shape ?? '').trim().toLowerCase();
    return Boolean(s && activeInstalledExternalShapes.has(s));
}

export function getInstalledExternalShapeList() {
    return [...activeInstalledExternalShapes].sort();
}

/** Return sorted custom shape IDs currently resolvable for a given card/collection scope. */
export function getResolvableExternalShapes({
    activeCollection = DEFAULT_COLLECTION_ID,
    defaultCollection = DEFAULT_COLLECTION_ID,
    installedModels = {},
} = {}) {
    const actCol = normalizeCollectionSlug(activeCollection) || DEFAULT_COLLECTION_ID;
    const defCol = normalizeCollectionSlug(defaultCollection) || DEFAULT_COLLECTION_ID;
    if (actCol === DEFAULT_COLLECTION_ID) return [];
    const installedList = installedModels && typeof installedModels === 'object'
        ? Object.values(installedModels).filter(Boolean)
        : [];
    const set = new Set();
    for (const item of installedList) {
        const matchesActive = actCol === 'all' || itemMatchesCollection(item, actCol);
        const matchesDefault = defCol !== DEFAULT_COLLECTION_ID && defCol !== actCol && itemMatchesCollection(item, defCol);
        if (!matchesActive && !matchesDefault) continue;
        const sh = sanitizeShapeId(item.shape, item.id);
        if (sh) set.add(sh);
    }
    return [...set].sort();
}

function itemMatchesCollection(item, collectionSlug) {
    const target = normalizeCollectionSlug(collectionSlug);
    if (!target || target === 'all') return true;
    const cols = Array.isArray(item?.collections) ? item.collections : [];
    const tags = Array.isArray(item?.tags) ? item.tags : [];
    return cols.some((c) => normalizeCollectionSlug(c) === target)
        || tags.some((t) => normalizeCollectionSlug(t) === target);
}

function scoreExternalCandidate(item, normalizedShape, roomStyle) {
    let score = 0;
    if (String(item.id || '').toLowerCase() === normalizedShape) score += 10;
    if (String(item.shape || '').toLowerCase() === normalizedShape) score += 5;
    if (roomStyle && itemMatchesCollection(item, roomStyle)) score += 3;
    return score;
}

function pickBestExternalMatch(candidates, normalizedShape, collectionSlug, roomStyle) {
    const matches = candidates
        .filter((item) => {
            if (!item || typeof item !== 'object') return false;
            const idLow = String(item.id || '').toLowerCase();
            const shapeLow = String(item.shape || '').toLowerCase();
            if (idLow !== normalizedShape && shapeLow !== normalizedShape) return false;
            return collectionSlug === 'all' || itemMatchesCollection(item, collectionSlug);
        })
        .sort((a, b) => scoreExternalCandidate(b, normalizedShape, roomStyle) - scoreExternalCandidate(a, normalizedShape, roomStyle));
    return matches[0] || null;
}

/**
 * Resolve the GLB/kit asset descriptor for a scene prop `shape`:
 *   1. Downloaded external model matching `shape` inside `activeCollection`
 *      (unless `activeCollection === 'default'`, which preserves bundled defaults first)
 *   2. Downloaded external model matching `shape` inside `defaultCollection` fallback (if non-default)
 *   3. Bundled `WEBGL_KIT_CATALOG` or `SKETCHFAB_ASSETS` default
 *   4. `null` (render using built-in procedural geometry)
 */
export function resolveModelForShape(
    shape,
    {
        activeCollection = DEFAULT_COLLECTION_ID,
        defaultCollection = DEFAULT_COLLECTION_ID,
        installedModels = {},
        roomStyle = '',
        bundledKitCatalog = BUNDLED_KIT_MAP,
        sketchfabAssets = SKETCHFAB_ASSETS,
    } = {},
) {
    const normShape = String(shape ?? '').trim().toLowerCase();
    if (!normShape) return null;

    const actCol = normalizeCollectionSlug(activeCollection) || DEFAULT_COLLECTION_ID;
    const defCol = normalizeCollectionSlug(defaultCollection) || DEFAULT_COLLECTION_ID;
    const styleNorm = normalizeCollectionSlug(roomStyle);
    const installedList = installedModels && typeof installedModels === 'object'
        ? Object.values(installedModels).filter(Boolean)
        : [];

    if (actCol !== DEFAULT_COLLECTION_ID && installedList.length > 0) {
        const hit = pickBestExternalMatch(installedList, normShape, actCol, styleNorm);
        if (hit) {
            return {
                source: 'external',
                id: hit.id,
                shape: hit.shape || normShape,
                pack: `ext:${hit.id}`,
                node: hit.node || null,
                styleNodes: hit.styleNodes || null,
                preRotY: Number(hit.preRotY) || 0,
                rotation: hit.rotation || null,
                scale: hit.scale || null,
                groundOffset: Number(hit.groundOffset) || 0,
                groundMode: hit.groundMode || 'bottom',
                size: hit.size || null,
                name: hit.name,
                author: hit.author,
                uid: hit.uid || hit.id,
                license: hit.license,
                licenseUrl: hit.licenseUrl || '',
                viewerUrl: hit.viewerUrl || '',
            };
        }
    }

    if (actCol !== DEFAULT_COLLECTION_ID && defCol !== DEFAULT_COLLECTION_ID && defCol !== actCol && installedList.length > 0) {
        const fallbackHit = pickBestExternalMatch(installedList, normShape, defCol, styleNorm);
        if (fallbackHit) {
            return {
                source: 'external',
                id: fallbackHit.id,
                shape: fallbackHit.shape || normShape,
                pack: `ext:${fallbackHit.id}`,
                node: fallbackHit.node || null,
                styleNodes: fallbackHit.styleNodes || null,
                preRotY: Number(fallbackHit.preRotY) || 0,
                rotation: fallbackHit.rotation || null,
                scale: fallbackHit.scale || null,
                groundOffset: Number(fallbackHit.groundOffset) || 0,
                groundMode: fallbackHit.groundMode || 'bottom',
                size: fallbackHit.size || null,
                name: fallbackHit.name,
                author: fallbackHit.author,
                uid: fallbackHit.uid || fallbackHit.id,
                license: fallbackHit.license,
                licenseUrl: fallbackHit.licenseUrl || '',
                viewerUrl: fallbackHit.viewerUrl || '',
            };
        }
    }

    const kit = bundledKitCatalog?.[normShape] || sketchfabAssets?.[normShape];
    if (kit) {
        return {
            ...kit,
            id: kit.id || normShape,
            shape: normShape,
            source: 'bundled',
        };
    }
    return null;
}

/** Merge bundled, remote manifest, and installed records into a filterable catalog view. */
export function listCatalogEntries({
    manifest = null,
    installedModels = {},
    bundledItems = getBundledLibraryItems(),
    collectionFilter = 'all',
    statusFilter = 'all',
    searchQuery = '',
} = {}) {
    const installedMap = installedModels && typeof installedModels === 'object' ? installedModels : {};
    const remoteList = Array.isArray(manifest?.models) ? manifest.models : [];

    const byKey = new Map();

    // 1. Add bundled defaults first (always preserved)
    for (const b of bundledItems) {
        byKey.set(`bundled:${b.id}`, {
            ...b,
            bundled: true,
            installed: true,
            status: 'bundled',
        });
    }

    // 2. Add/merge remote external models
    for (const m of remoteList) {
        const inst = installedMap[m.id];
        const merged = {
            ...m,
            ...(inst ? {
                installedAt: inst.installedAt,
                sizeBytes: inst.sizeBytes ?? m.sizeBytes,
            } : {}),
            bundled: false,
            installed: Boolean(inst),
            status: inst ? 'installed' : 'available',
            source: 'external',
        };
        byKey.set(`ext:${m.id}`, merged);
    }

    // 3. Include any installed external models even if manifest was edited or offline
    for (const inst of Object.values(installedMap)) {
        if (!inst || typeof inst !== 'object' || !inst.id) continue;
        const key = `ext:${inst.id}`;
        if (!byKey.has(key)) {
            byKey.set(key, {
                ...inst,
                collections: Array.isArray(inst.collections) ? inst.collections : [],
                tags: Array.isArray(inst.tags) ? inst.tags : [],
                bundled: false,
                installed: true,
                status: 'installed',
                source: 'external',
            });
        }
    }

    const allItems = [...byKey.values()];
    const collectionCounts = new Map();
    const bumpCol = (slug) => {
        const norm = normalizeCollectionSlug(slug);
        if (!norm || norm === 'all' || norm === 'installed') return;
        collectionCounts.set(norm, (collectionCounts.get(norm) || 0) + 1);
    };
    for (const item of allItems) {
        const seenItemCols = new Set();
        for (const c of [...(item.collections || []), ...(item.tags || [])]) {
            const norm = normalizeCollectionSlug(c);
            if (norm && !seenItemCols.has(norm)) {
                seenItemCols.add(norm);
                bumpCol(norm);
            }
        }
    }
    for (const metaCol of (manifest?.collections || [])) {
        const norm = normalizeCollectionSlug(metaCol?.id);
        if (norm && !collectionCounts.has(norm)) collectionCounts.set(norm, 0);
    }

    const normColFilter = normalizeCollectionSlug(collectionFilter) || 'all';
    const normStatusFilter = String(statusFilter || 'all').trim().toLowerCase();
    const q = String(searchQuery || '').trim().toLowerCase();

    const filtered = allItems.filter((item) => {
        if (normColFilter === 'installed') {
            if (item.bundled || !item.installed) return false;
        } else if (normColFilter !== 'all') {
            if (!itemMatchesCollection(item, normColFilter)) return false;
        }
        if (normStatusFilter !== 'all' && item.status !== normStatusFilter) {
            return false;
        }
        if (q) {
            const hay = `${item.name} ${item.id} ${item.shape} ${item.author} ${item.license} ${(item.collections || []).join(' ')} ${(item.tags || []).join(' ')}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    const bundledCount = allItems.filter((x) => x.bundled).length;
    const installedCount = allItems.filter((x) => !x.bundled && x.installed).length;
    const availableCount = allItems.filter((x) => !x.bundled && !x.installed).length;
    const installedBytes = allItems
        .filter((x) => !x.bundled && x.installed && Number.isFinite(x.sizeBytes))
        .reduce((sum, x) => sum + x.sizeBytes, 0);

    const collections = [...collectionCounts.entries()]
        .map(([id, count]) => ({
            id,
            label: formatCollectionLabel(id, manifest?.collections),
            count,
        }))
        .sort((a, b) => {
            if (a.id === DEFAULT_COLLECTION_ID) return -1;
            if (b.id === DEFAULT_COLLECTION_ID) return 1;
            return a.label.localeCompare(b.label);
        });

    return {
        items: filtered,
        allItems,
        collections,
        counts: {
            total: allItems.length,
            filtered: filtered.length,
            bundledCount,
            installedCount,
            availableCount,
            installedBytes,
        },
    };
}

/** Build CC0 / CC BY 4.0 Markdown attribution summary without dropping creator metadata. */
export function formatAttributionMarkdown(items = []) {
    const unique = new Map();
    for (const item of items || []) {
        if (!item || !item.name || !item.author) continue;
        const key = `${item.uid || item.id}|${item.viewerUrl || ''}`;
        if (!unique.has(key)) unique.set(key, item);
    }
    if (unique.size === 0) return 'No model attributions recorded.';
    return [...unique.values()]
        .map((item) => {
            const lic = item.license || 'CC BY 4.0';
            const uidStr = item.uid ? ` (UID: \`${item.uid}\`)` : '';
            const srcStr = item.viewerUrl ? ` — ${item.viewerUrl}` : '';
            const scopeTag = item.bundled ? 'Bundled' : 'Downloaded';
            return `- **${item.name}** by **${item.author}**${uidStr} [${lic}] (${scopeTag})${srcStr}`;
        })
        .join('\n');
}

/** Pure in-memory binary GLB cache for Node unit tests or IndexedDB-less environments. */
export function createMemoryModelBinaryStore() {
    const map = new Map();
    return {
        async get(id) {
            return map.get(id) ?? null;
        },
        async set(id, bytes) {
            const view = toUint8View(bytes);
            if (!view) throw new Error('Invalid GLB binary payload');
            const copy = new Uint8Array(view.byteLength);
            copy.set(view);
            map.set(id, copy.buffer);
        },
        async delete(id) {
            map.delete(id);
        },
        async clear() {
            map.clear();
        },
        async keys() {
            return [...map.keys()];
        },
    };
}

/** IndexedDB binary GLB cache (browser) with safe failure on unavailable browser storage. */
export function createIndexedDbModelBinaryStore({
    dbName = 'lpe_model_library_v1',
    storeName = 'glb_blobs',
    allowMemoryFallback = (typeof window === 'undefined'),
} = {}) {
    if (typeof indexedDB === 'undefined') {
        if (allowMemoryFallback) return createMemoryModelBinaryStore();
        return {
            async get() { return null; },
            async set() { throw new Error('Browser IndexedDB is unavailable; cannot store 3D models offline.'); },
            async delete() {},
            async clear() {},
            async keys() { return []; },
        };
    }

    let dbPromise = null;
    const openDb = () => {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            try {
                const req = indexedDB.open(dbName, 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(storeName)) {
                        db.createObjectStore(storeName);
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
            } catch (err) {
                reject(err);
            }
        });
        return dbPromise;
    };

    const withStore = async (mode, fn) => {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const st = tx.objectStore(storeName);
            const res = fn(st);
            tx.oncomplete = () => resolve(res?.result ?? res);
            tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
        });
    };

    return {
        async get(id) {
            try {
                const idbRes = await withStore('readonly', (st) => st.get(id));
                return idbRes ?? null;
            } catch {
                return null;
            }
        },
        async set(id, bytes) {
            const view = toUint8View(bytes);
            if (!view) throw new Error('Invalid GLB binary payload');
            const copy = new Uint8Array(view.byteLength);
            copy.set(view);
            await withStore('readwrite', (st) => st.put(copy.buffer, id));
        },
        async delete(id) {
            try {
                await withStore('readwrite', (st) => st.delete(id));
            } catch {
                // Ignore delete error if IndexedDB is unavailable
            }
        },
        async clear() {
            try {
                await withStore('readwrite', (st) => st.clear());
            } catch {
                // Ignore clear error if IndexedDB is unavailable
            }
        },
        async keys() {
            try {
                const idbKeys = await withStore('readonly', (st) => st.getAllKeys());
                return Array.isArray(idbKeys) ? idbKeys : [];
            } catch {
                return [];
            }
        },
    };
}

function sanitizeInstalledMetadataRecord(item, actualBytes) {
    const lic = normalizeLicenseMeta(item.licenseCode || item.license, item.licenseUrl);
    return {
        id: item.id,
        shape: sanitizeShapeId(item.shape, item.id) || item.id,
        name: item.name,
        author: item.author,
        uid: item.uid || item.id,
        license: lic.label,
        licenseCode: lic.code,
        licenseUrl: lic.url,
        viewerUrl: item.viewerUrl || '',
        collections: Array.isArray(item.collections) ? [...item.collections] : [],
        tags: Array.isArray(item.tags) ? [...item.tags] : [],
        fileurl: item.fileurl || '',
        sizeBytes: Number.isFinite(actualBytes) ? actualBytes : (item.sizeBytes ?? null),
        faceCount: item.faceCount ?? null,
        size: item.size ? [...item.size] : null,
        scale: item.scale ? [...item.scale] : null,
        preRotY: Number(item.preRotY) || 0,
        rotation: item.rotation ? [...item.rotation] : null,
        groundOffset: Number(item.groundOffset) || 0,
        groundMode: normalizeGroundMode(item.groundMode),
        node: item.node || null,
        styleNodes: item.styleNodes ? { ...item.styleNodes } : null,
        installedAt: new Date().toISOString(),
        source: 'external',
    };
}

async function fetchWithByteLimit(fetchFn, url, maxBytes, timeoutMs = 45000) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const res = await fetchFn(url, controller ? { signal: controller.signal } : {});
        if (!res?.ok) {
            throw new Error(`HTTP ${res?.status || 'ERR'} fetching ${url}`);
        }
        if (res.body && typeof res.body.getReader === 'function') {
            const reader = res.body.getReader();
            const chunks = [];
            let total = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.byteLength;
                if (total > maxBytes) {
                    await reader.cancel?.();
                    throw new Error(`Downloaded asset exceeds max budget (${formatBytesMb(maxBytes)}).`);
                }
                chunks.push(value);
            }
            const out = new Uint8Array(total);
            let offset = 0;
            for (const c of chunks) {
                out.set(c, offset);
                offset += c.byteLength;
            }
            return out.buffer;
        }
        const ab = await res.arrayBuffer();
        if (ab.byteLength > maxBytes) {
            throw new Error(`Downloaded asset exceeds max budget (${formatBytesMb(maxBytes)}).`);
        }
        return ab;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Create the runtime 3D Model Library & Collection Manager wired to extensionSettings,
 * chat state store (optional per-chat/session collection), and IndexedDB/memory cache.
 */
export function createModelLibraryManager({
    getSettings = () => ({}),
    saveSettings = () => {},
    getContextSafe = () => ({}),
    store = null,
    binaryStore = null,
    fetchImpl = null,
    onChanged = null,
} = {}) {
    const binStore = binaryStore || createIndexedDbModelBinaryStore();
    const getFetch = () => fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);

    function config() {
        const ml = ensureModelLibrarySettings(getSettings());
        syncInstalledExternalShapes(ml.installed);
        return ml;
    }

    function commitChange(invalidatePackId = null) {
        const ml = config();
        syncInstalledExternalShapes(ml.installed);
        if (invalidatePackId !== false) notifyPackCacheInvalidate(invalidatePackId);
        saveSettings?.();
        onChanged?.();
    }

    function getActiveCardInfo() {
        return resolveCardKey(getContextSafe?.() || {});
    }

    function getEffectiveCollection() {
        const settings = getSettings();
        const card = getActiveCardInfo();
        const sessionCol = store?.getModelCollection?.() || '';
        const cardCol = card.key ? (settings?.modelLibrary?.cardCollections?.[card.key] || '') : '';
        const defCol = settings?.modelLibrary?.defaultCollection || DEFAULT_COLLECTION_ID;
        const effective = resolveActiveCollection({
            settings,
            cardKey: card.key,
            sessionCollection: sessionCol,
        });
        return {
            effective,
            cardKey: card.key,
            cardLabel: card.label,
            cardKind: card.kind,
            cardCollection: normalizeCollectionSlug(cardCol),
            sessionCollection: normalizeCollectionSlug(sessionCol),
            defaultCollection: normalizeCollectionSlug(defCol) || DEFAULT_COLLECTION_ID,
            inherited: !sessionCol && !cardCol,
        };
    }

    function setManifestUrl(url) {
        const ml = config();
        const resolved = resolveManifestUrl(url);
        ml.manifestUrl = String(url || '').trim() || resolved.manifestUrl;
        commitChange(false);
        return resolved;
    }

    function resetManifestUrl() {
        const ml = config();
        ml.manifestUrl = DEFAULT_LIBRARY_MANIFEST_URL;
        commitChange(false);
        return resolveManifestUrl(ml.manifestUrl);
    }

    function setDefaultCollection(collectionSlug) {
        const ml = config();
        const norm = normalizeCollectionSlug(collectionSlug) || DEFAULT_COLLECTION_ID;
        ml.defaultCollection = norm === 'installed' ? DEFAULT_COLLECTION_ID : norm;
        commitChange(false);
        return ml.defaultCollection;
    }

    function setCardCollection(collectionSlug, explicitCardKey = null) {
        const ml = config();
        const targetKey = explicitCardKey !== null ? String(explicitCardKey || '') : getActiveCardInfo().key;
        const clean = String(collectionSlug ?? '').trim();
        if (!targetKey) {
            return setDefaultCollection(clean || DEFAULT_COLLECTION_ID);
        }
        if (!clean || clean === '__inherit__') {
            delete ml.cardCollections[targetKey];
        } else {
            const norm = normalizeCollectionSlug(clean);
            if (!norm || norm === 'installed') delete ml.cardCollections[targetKey];
            else ml.cardCollections[targetKey] = norm;
        }
        commitChange(false);
        return ml.cardCollections[targetKey] || '';
    }

    function setSessionCollection(collectionSlug) {
        if (!store?.setModelCollection) return '';
        const clean = String(collectionSlug ?? '').trim();
        const val = !clean || clean === '__inherit__' ? '' : normalizeCollectionSlug(clean);
        store.setModelCollection(val);
        commitChange(false);
        return val;
    }

    async function refreshCatalog({ manifestUrl = null } = {}) {
        const ml = config();
        const resolved = resolveManifestUrl(manifestUrl ?? ml.manifestUrl);
        if (manifestUrl !== null) {
            ml.manifestUrl = String(manifestUrl || '').trim() || resolved.manifestUrl;
        }
        const fetchFn = getFetch();
        if (!fetchFn) {
            throw new Error('HTTP fetch API is unavailable in this environment.');
        }
        const res = await fetchFn(resolved.manifestUrl, {
            headers: { Accept: 'application/json' },
        });
        if (!res?.ok) {
            throw new Error(`Could not load library manifest (HTTP ${res?.status || 'ERR'}).`);
        }
        const text = await res.text();
        const parsed = parseLibraryManifest(text, {
            manifestUrl: resolved.manifestUrl,
            baseUrl: resolved.baseUrl,
        });
        ml.cachedManifest = parsed;
        commitChange(false);
        return parsed;
    }

    function getCatalog(filterOpts = {}) {
        const ml = config();
        return listCatalogEntries({
            manifest: ml.cachedManifest,
            installedModels: ml.installed,
            ...filterOpts,
        });
    }

    async function installModel(modelOrId) {
        const ml = config();
        const id = typeof modelOrId === 'string' ? modelOrId : modelOrId?.id;
        const catalog = getCatalog({ collectionFilter: 'all', statusFilter: 'all' });
        const item = typeof modelOrId === 'object' && modelOrId?.fileurl
            ? modelOrId
            : (catalog.allItems.find((x) => !x.bundled && x.id === id)
                || catalog.allItems.find((x) => x.id === id));

        if (!item) {
            throw new Error(`Model "${id || 'unknown'}" was not found in the library catalog.`);
        }
        if (item.bundled) {
            return { ok: true, alreadyBundled: true, item };
        }
        const fetchFn = getFetch();
        if (!fetchFn) {
            throw new Error('HTTP fetch API is unavailable to download GLB model.');
        }

        const buf = await fetchWithByteLimit(fetchFn, item.fileurl, MAX_EXTERNAL_GLB_BYTES);
        const valid = validateGlbHeader(buf);
        if (!valid.ok) {
            throw new Error(`Invalid GLB file for "${item.name}": ${valid.error}`);
        }

        await binStore.set(item.id, buf);
        const record = sanitizeInstalledMetadataRecord(item, valid.bytes);
        ml.installed[item.id] = record;
        commitChange(`ext:${item.id}`);
        return { ok: true, item: record };
    }

    async function installCollection(collectionSlug, { modelIds = null } = {}) {
        const norm = normalizeCollectionSlug(collectionSlug);
        if (!norm || norm === 'all' || norm === DEFAULT_COLLECTION_ID) {
            return { installed: [], failed: [] };
        }
        const idSet = Array.isArray(modelIds) ? new Set(modelIds) : null;
        const { items } = getCatalog({ collectionFilter: norm, statusFilter: 'available' });
        const installed = [];
        const failed = [];
        for (const item of items) {
            if (item.bundled) continue;
            if (idSet && !idSet.has(item.id)) continue;
            try {
                const res = await installModel(item);
                if (res.ok && !res.alreadyBundled) installed.push(res.item);
            } catch (err) {
                failed.push({ id: item.id, name: item.name, error: String(err?.message || err) });
            }
        }
        return { installed, failed };
    }

    async function removeModel(modelId) {
        const ml = config();
        if (ml.installed[modelId]) {
            delete ml.installed[modelId];
            await binStore.delete(modelId);
            commitChange(`ext:${modelId}`);
            return { ok: true, existed: true };
        }
        const bundled = getBundledLibraryItems().some((b) => b.id === modelId);
        if (bundled) {
            return { ok: false, reason: 'bundled', error: 'Bundled default assets are protected and cannot be removed.' };
        }
        await binStore.delete(modelId);
        return { ok: true, existed: false };
    }

    async function removeCollection(collectionSlug, { modelIds = null } = {}) {
        const norm = normalizeCollectionSlug(collectionSlug);
        if (!norm || norm === DEFAULT_COLLECTION_ID) return { removed: [] };
        const idSet = Array.isArray(modelIds) ? new Set(modelIds) : null;
        const ml = config();
        const toRemove = Object.values(ml.installed)
            .filter((item) => item && itemMatchesCollection(item, norm) && (!idSet || idSet.has(item.id)))
            .map((item) => item.id);
        for (const id of toRemove) {
            delete ml.installed[id];
            await binStore.delete(id);
        }
        commitChange(null);
        return { removed: toRemove };
    }

    async function clearCachedModels() {
        const ml = config();
        const removedCount = Object.keys(ml.installed).length;
        ml.installed = {};
        await binStore.clear();
        commitChange(null);
        return { removedCount };
    }

    async function loadExternalModelBuffer(modelId) {
        const ml = config();
        if (!modelId || !ml.installed?.[modelId]) return null;
        const buf = await binStore.get(modelId);
        if (!buf) {
            // Reconcile orphaned metadata when cached binary storage was evicted/cleared
            delete ml.installed[modelId];
            commitChange(false);
            return null;
        }
        return buf;
    }

    function getActiveCustomShapes() {
        const ml = config();
        const eff = getEffectiveCollection();
        return getResolvableExternalShapes({
            activeCollection: eff.effective,
            defaultCollection: ml.defaultCollection,
            installedModels: ml.installed,
        });
    }

    function resolveProp(shape, { roomStyle = '' } = {}) {
        const ml = config();
        const eff = getEffectiveCollection();
        return resolveModelForShape(shape, {
            activeCollection: eff.effective,
            defaultCollection: ml.defaultCollection,
            installedModels: ml.installed,
            roomStyle,
        });
    }

    function getAttributionCredits({ includeBundled = true, includeExternal = true } = {}) {
        const ml = config();
        const items = [];
        if (includeBundled) items.push(...getBundledLibraryItems());
        if (includeExternal) items.push(...Object.values(ml.installed || {}));
        return formatAttributionMarkdown(items);
    }

    function getStats() {
        const ml = config();
        const cat = getCatalog({ collectionFilter: 'all', statusFilter: 'all' });
        return {
            manifestUrl: ml.manifestUrl,
            activeCollection: getEffectiveCollection(),
            ...cat.counts,
        };
    }

    return {
        getConfig: config,
        setManifestUrl,
        resetManifestUrl,
        getActiveCardInfo,
        getEffectiveCollection,
        setDefaultCollection,
        setCardCollection,
        setSessionCollection,
        getCatalog,
        refreshCatalog,
        installModel,
        installCollection,
        removeModel,
        removeCollection,
        clearCachedModels,
        loadExternalModelBuffer,
        resolveProp,
        getActiveCustomShapes,
        getAttributionCredits,
        getStats,
    };
}
