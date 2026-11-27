/**
 * Extension / Modular Component Library for Lapis Philosophorum Engine (LPE).
 *
 * Pure ES module (no jQuery / Three.js dependency) managing lightweight metadata for
 * optional companion sub-extensions and modular components:
 *  - Configurable extension catalog manifest URL (remote GitHub repo or local fixture)
 *  - Strict URL scheme / path-traversal validation for catalog & entry links
 *  - Browsing, install/register, enable/disable, and uninstall lifecycle
 *  - Attribution preservation (author, license, version, repo/source metadata)
 *  - Graceful offline / missing-catalog fallback using installed metadata only
 *
 * Only lightweight metadata is persisted in extensionSettings; raw source bundles are
 * never stored in settings, keeping the core LPE install lightweight.
 */

import { normalizeLicenseMeta, resolveManifestUrl } from './modelLibrary.js';

export const DEFAULT_EXTENSION_REPO_URL = 'https://github.com/250000000001/ST-LapisPhilosophorumEngineExtensions';
export const DEFAULT_EXTENSION_BRANCH = 'main';
export const DEFAULT_EXTENSION_BASE_URL = `https://raw.githubusercontent.com/250000000001/ST-LapisPhilosophorumEngineExtensions/${DEFAULT_EXTENSION_BRANCH}/`;
export const DEFAULT_EXTENSION_MANIFEST_URL = `${DEFAULT_EXTENSION_BASE_URL}manifest.json`;
export const EXTENSION_LIBRARY_META_VERSION = 1;

const SAFE_EXTENSION_ID_RE = /^[a-z0-9][a-z0-9_.:-]{0,79}$/i;
const UNSAFE_SCHEME_RE = /^(?:javascript|vbscript|data|file|chrome|chrome-extension|about):/i;
const PROTOCOL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function toFiniteNumber(val) {
    if (val === undefined || val === null || typeof val === 'boolean') return null;
    if (typeof val === 'string' && !val.trim()) return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
}

/** Reject dangerous URI schemes, protocol-relative URLs, and `..` path traversal. */
export function isSafeExtensionUrl(raw, { allowRelative = true } = {}) {
    const str = String(raw ?? '').trim();
    if (!str) return false;
    if (/^[\\/]{2}/.test(str)) return false;
    if (UNSAFE_SCHEME_RE.test(str)) return false;
    if (!PROTOCOL_RE.test(str)) {
        if (!allowRelative) return false;
        const pathOnly = str.replace(/\\/g, '/').split(/[?#]/)[0];
        return !pathOnly.split('/').some((seg) => seg === '..');
    }
    try {
        const u = new URL(str);
        return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
        return false;
    }
}

/** Normalize a URL to a canonical safe form, or return '' when unsafe/invalid. */
export function sanitizeExtensionUrl(raw, { allowRelative = true } = {}) {
    const str = String(raw ?? '').trim();
    if (!str || !isSafeExtensionUrl(str, { allowRelative })) return '';
    if (!PROTOCOL_RE.test(str)) return str;
    try {
        return new URL(str).href;
    } catch {
        return '';
    }
}

/** Resolve an extension catalog manifest/repo URL into `{ manifestUrl, baseUrl, repoUrl }`. */
export function resolveExtensionManifestUrl(inputUrl = '') {
    const raw = String(inputUrl ?? '').trim();
    if (!raw) {
        return {
            manifestUrl: DEFAULT_EXTENSION_MANIFEST_URL,
            baseUrl: DEFAULT_EXTENSION_BASE_URL,
            repoUrl: DEFAULT_EXTENSION_REPO_URL,
        };
    }
    const resolved = resolveManifestUrl(raw);
    if (!resolved.repoUrl || resolved.repoUrl === 'https://github.com/250000000001/ST-LapisPhilosophorumEngineLibrary') {
        return { ...resolved, repoUrl: DEFAULT_EXTENSION_REPO_URL };
    }
    return resolved;
}

export function normalizeExtensionId(rawId) {
    const clean = String(rawId ?? '').trim();
    if (!SAFE_EXTENSION_ID_RE.test(clean) || Object.hasOwn(Object.prototype, clean)) return '';
    return clean;
}

export function normalizeExtensionCategory(raw) {
    const clean = String(raw ?? '')
        .trim()
        .toLowerCase()
        .replace(/[_/\s]+/g, '-')
        .replace(/[^a-z0-9:_-]+/g, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
    return clean || 'general';
}

export function normalizeExtensionVersion(raw) {
    const clean = String(raw ?? '').trim();
    return clean || '0.0.0';
}

export function normalizeExtensionTags(rawTags) {
    const set = new Set();
    const push = (val) => {
        if (Array.isArray(val)) {
            for (const x of val) push(x);
            return;
        }
        if (typeof val === 'string') {
            for (const part of val.split(/[,|;]+/)) {
                const tag = normalizeExtensionCategory(part);
                if (tag && tag !== 'general') set.add(tag);
            }
        }
    };
    push(rawTags);
    return [...set];
}

export function normalizeExtensionHooks(rawHooks) {
    const set = new Set();
    const push = (val) => {
        if (Array.isArray(val)) {
            for (const x of val) push(x);
            return;
        }
        if (typeof val === 'string') {
            for (const part of val.split(/[,|;]+/)) {
                const hook = String(part).trim().replace(/[^a-zA-Z0-9_.:-]+/g, '');
                if (hook) set.add(hook);
            }
        }
    };
    push(rawHooks);
    return [...set];
}

export function normalizeExtensionCompatibility(rawCompat) {
    if (rawCompat === undefined || rawCompat === null) return '';
    if (typeof rawCompat === 'string') return rawCompat.trim();
    if (typeof rawCompat === 'object') {
        const min = rawCompat.min ? String(rawCompat.min).trim() : '';
        const max = rawCompat.max ? String(rawCompat.max).trim() : '';
        if (min && max) return `${min} - ${max}`;
        return min || max || '';
    }
    return '';
}

export function normalizeExtensionLicense(rawLicense, rawUrl = '') {
    return normalizeLicenseMeta(rawLicense, rawUrl);
}

/** Parse the extension catalog manifest, validating IDs, attribution, and all URLs. */
export function parseExtensionManifest(rawJson, {
    manifestUrl = DEFAULT_EXTENSION_MANIFEST_URL,
    baseUrl = '',
} = {}) {
    let data = rawJson;
    if (typeof rawJson === 'string') {
        try {
            data = JSON.parse(rawJson);
        } catch (err) {
            throw new Error(`Invalid extension manifest JSON: ${err.message}`);
        }
    }
    if (!data || (typeof data !== 'object' && !Array.isArray(data))) {
        throw new Error('Extension manifest must be a JSON object or array of extension entries.');
    }

    const derived = resolveExtensionManifestUrl(manifestUrl || DEFAULT_EXTENSION_MANIFEST_URL);
    const effectiveBaseUrl = baseUrl || derived.baseUrl;
    const rawList = Array.isArray(data)
        ? data
        : (Array.isArray(data.extensions) ? data.extensions
            : (Array.isArray(data.items) ? data.items
                : (Array.isArray(data.components) ? data.components : null)));
    if (!rawList) {
        throw new Error('Extension manifest must contain an "extensions", "items", or "components" array.');
    }

    const extensions = [];
    const warnings = [];
    const seenIds = new Set();

    for (let i = 0; i < rawList.length; i++) {
        const entry = rawList[i];
        if (!entry || typeof entry !== 'object') {
            warnings.push(`Skipped non-object extension entry at index ${i}.`);
            continue;
        }
        const id = normalizeExtensionId(entry.id ?? entry.extensionId ?? entry.slug);
        if (!id) {
            warnings.push(`Skipped extension at index ${i}: invalid or missing "id".`);
            continue;
        }
        if (seenIds.has(id)) {
            warnings.push(`Skipped duplicate extension id "${id}".`);
            continue;
        }
        const name = String(entry.name || entry.title || '').trim();
        if (!name) {
            warnings.push(`Skipped extension "${id}": missing display "name".`);
            continue;
        }

        const rawRepo = entry.repoUrl ?? entry.repo ?? entry.homepage ?? '';
        const rawManifest = entry.manifestUrl ?? entry.catalogUrl ?? '';
        const rawEntry = entry.entryUrl ?? entry.entry ?? entry.sourceUrl ?? '';
        const repoUrl = rawRepo ? sanitizeExtensionUrl(rawRepo, { allowRelative: false }) : '';
        if (rawRepo && !repoUrl) {
            warnings.push(`Skipped extension "${id}": unsafe or invalid "repoUrl".`);
            continue;
        }
        let manifestUrlField = '';
        if (rawManifest) {
            manifestUrlField = sanitizeExtensionUrl(rawManifest, { allowRelative: true });
            if (!manifestUrlField) {
                warnings.push(`Skipped extension "${id}": unsafe or invalid "manifestUrl".`);
                continue;
            }
        }
        let entryUrl = '';
        if (rawEntry) {
            entryUrl = sanitizeExtensionUrl(rawEntry, { allowRelative: true });
            if (!entryUrl) {
                warnings.push(`Skipped extension "${id}": unsafe or invalid "entryUrl".`);
                continue;
            }
        }

        const author = String(entry.author ?? entry.creator ?? '').trim();
        if (!author) warnings.push(`Extension "${id}" is missing attribution "author".`);
        const license = normalizeExtensionLicense(entry.license ?? entry.licenseCode, entry.licenseUrl);
        const summary = String(entry.summary ?? entry.description ?? entry.desc ?? '').trim();
        const description = String(entry.description ?? entry.summary ?? '').trim();
        const category = normalizeExtensionCategory(entry.category ?? entry.type ?? 'general');
        const tags = normalizeExtensionTags(entry.tags ?? entry.keywords);
        const sizeRaw = toFiniteNumber(entry.sizeBytes ?? entry.bytes ?? entry.size_bytes);
        const sizeBytes = sizeRaw !== null && sizeRaw >= 0 ? Math.round(sizeRaw) : null;
        const requiredHooks = normalizeExtensionHooks(entry.requiredHooks ?? entry.hooks ?? entry.requires);
        const compatibility = normalizeExtensionCompatibility(entry.compatibility ?? entry.requiresLpe);

        seenIds.add(id);
        extensions.push({
            id,
            name,
            version: normalizeExtensionVersion(entry.version),
            summary,
            description,
            category,
            tags,
            repoUrl,
            manifestUrl: manifestUrlField,
            entryUrl,
            sizeBytes,
            license: license.label,
            licenseCode: license.code,
            licenseUrl: license.url,
            author,
            requiredHooks,
            compatibility,
            homepage: sanitizeExtensionUrl(entry.homepage ?? '', { allowRelative: false }),
            source: 'catalog',
        });
    }

    return {
        version: toFiniteNumber(data.version) ?? EXTENSION_LIBRARY_META_VERSION,
        name: String(data.name || 'LPE Extension & Modular Component Library').trim(),
        updatedAt: String(data.updatedAt || '').trim(),
        manifestUrl: derived.manifestUrl,
        baseUrl: effectiveBaseUrl,
        extensions,
        warnings,
    };
}

/** Build a lightweight installed record preserving all attribution & source metadata. */
export function sanitizeInstalledExtensionRecord(entry, { enabled = true } = {}) {
    const license = normalizeExtensionLicense(entry.licenseCode || entry.license, entry.licenseUrl);
    return {
        id: entry.id,
        name: entry.name,
        version: normalizeExtensionVersion(entry.version),
        summary: String(entry.summary || '').trim(),
        description: String(entry.description || entry.summary || '').trim(),
        category: normalizeExtensionCategory(entry.category),
        tags: normalizeExtensionTags(entry.tags),
        repoUrl: sanitizeExtensionUrl(entry.repoUrl, { allowRelative: false }),
        manifestUrl: sanitizeExtensionUrl(entry.manifestUrl, { allowRelative: true }),
        entryUrl: sanitizeExtensionUrl(entry.entryUrl, { allowRelative: true }),
        sizeBytes: Number.isFinite(entry.sizeBytes) ? entry.sizeBytes : null,
        license: license.label,
        licenseCode: license.code,
        licenseUrl: license.url,
        author: String(entry.author || '').trim(),
        requiredHooks: normalizeExtensionHooks(entry.requiredHooks),
        compatibility: normalizeExtensionCompatibility(entry.compatibility),
        homepage: sanitizeExtensionUrl(entry.homepage, { allowRelative: false }),
        installedAt: new Date().toISOString(),
        enabled: Boolean(enabled),
        source: 'installed',
    };
}

/** Ensure `settings.extensionLibrary` exists with safe defaults. */
export function ensureExtensionLibrarySettings(settings) {
    if (!settings || typeof settings !== 'object') {
        return {
            manifestUrl: DEFAULT_EXTENSION_MANIFEST_URL,
            cachedManifest: null,
            installed: {},
        };
    }
    if (!settings.extensionLibrary
        || typeof settings.extensionLibrary !== 'object'
        || Object.isFrozen(settings.extensionLibrary)) {
        const src = settings.extensionLibrary && typeof settings.extensionLibrary === 'object' ? settings.extensionLibrary : {};
        settings.extensionLibrary = {
            manifestUrl: typeof src.manifestUrl === 'string' && src.manifestUrl.trim()
                ? src.manifestUrl.trim()
                : DEFAULT_EXTENSION_MANIFEST_URL,
            cachedManifest: src.cachedManifest && typeof src.cachedManifest === 'object'
                ? JSON.parse(JSON.stringify(src.cachedManifest))
                : null,
            installed: src.installed && typeof src.installed === 'object' && !Array.isArray(src.installed)
                ? JSON.parse(JSON.stringify(src.installed))
                : {},
        };
    }
    const el = settings.extensionLibrary;
    if (typeof el.manifestUrl !== 'string' || !el.manifestUrl.trim() || !isSafeExtensionUrl(el.manifestUrl)) {
        el.manifestUrl = DEFAULT_EXTENSION_MANIFEST_URL;
    }
    if (!el.installed || typeof el.installed !== 'object' || Array.isArray(el.installed) || Object.isFrozen(el.installed)) {
        el.installed = {};
    }
    return el;
}

function sanitizeExtensionLinkFields(item) {
    return {
        ...item,
        repoUrl: sanitizeExtensionUrl(item.repoUrl, { allowRelative: false }),
        manifestUrl: sanitizeExtensionUrl(item.manifestUrl, { allowRelative: true }),
        entryUrl: sanitizeExtensionUrl(item.entryUrl, { allowRelative: true }),
        homepage: sanitizeExtensionUrl(item.homepage, { allowRelative: false }),
    };
}

/** Merge catalog and installed extension metadata into a filterable view. */
export function listExtensionEntries({
    manifest = null,
    installedExtensions = {},
    categoryFilter = 'all',
    statusFilter = 'all',
    searchQuery = '',
} = {}) {
    const installedMap = installedExtensions && typeof installedExtensions === 'object' ? installedExtensions : {};
    const catalogList = Array.isArray(manifest?.extensions) ? manifest.extensions : [];
    const byKey = new Map();

    for (const ext of catalogList) {
        const inst = installedMap[ext.id];
        const enabled = Boolean(inst?.enabled);
        byKey.set(ext.id, sanitizeExtensionLinkFields({
            ...ext,
            installed: Boolean(inst),
            enabled: Boolean(inst) && enabled,
            installedAt: inst?.installedAt || null,
            sizeBytes: inst?.sizeBytes ?? ext.sizeBytes,
            license: inst?.license || ext.license,
            licenseCode: inst?.licenseCode || ext.licenseCode,
            licenseUrl: inst?.licenseUrl || ext.licenseUrl,
            author: inst?.author || ext.author,
            status: inst ? (enabled ? 'enabled' : 'disabled') : 'available',
        }));
    }

    for (const inst of Object.values(installedMap)) {
        if (!inst || typeof inst !== 'object' || !inst.id || byKey.has(inst.id)) continue;
        byKey.set(inst.id, sanitizeExtensionLinkFields({
            ...inst,
            tags: Array.isArray(inst.tags) ? [...inst.tags] : [],
            requiredHooks: Array.isArray(inst.requiredHooks) ? [...inst.requiredHooks] : [],
            installed: true,
            enabled: Boolean(inst.enabled),
            status: inst.enabled ? 'enabled' : 'disabled',
        }));
    }

    const allItems = [...byKey.values()];
    const categoryCounts = new Map();
    for (const item of allItems) {
        const seen = new Set();
        for (const raw of [item.category, ...(item.tags || [])]) {
            const cat = normalizeExtensionCategory(raw);
            if (!cat || seen.has(cat)) continue;
            seen.add(cat);
            categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
        }
    }

    const normCategory = normalizeExtensionCategory(categoryFilter);
    const normStatus = String(statusFilter || 'all').trim().toLowerCase();
    const q = String(searchQuery || '').trim().toLowerCase();

    const filtered = allItems.filter((item) => {
        if (normCategory !== 'all') {
            if (normCategory === 'installed') {
                if (!item.installed) return false;
            } else if (normCategory === 'enabled') {
                if (!item.enabled) return false;
            } else {
                const cats = [item.category, ...(item.tags || [])].map((c) => normalizeExtensionCategory(c));
                if (!cats.includes(normCategory)) return false;
            }
        }
        if (normStatus !== 'all') {
            if (normStatus === 'installed') {
                if (!item.installed) return false;
            } else if (normStatus === 'available') {
                if (item.installed) return false;
            } else if (item.status !== normStatus) {
                return false;
            }
        }
        if (q) {
            const hay = `${item.name} ${item.id} ${item.summary} ${item.description} ${item.author} ${item.license} ${item.category} ${(item.tags || []).join(' ')} ${(item.requiredHooks || []).join(' ')}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    const counts = {
        total: allItems.length,
        filtered: filtered.length,
        installedCount: allItems.filter((x) => x.installed).length,
        enabledCount: allItems.filter((x) => x.enabled).length,
        availableCount: allItems.filter((x) => !x.installed).length,
        installedBytes: allItems
            .filter((x) => x.installed && Number.isFinite(x.sizeBytes))
            .reduce((sum, x) => sum + x.sizeBytes, 0),
    };

    const categories = [...categoryCounts.entries()]
        .map(([id, count]) => ({ id, label: id.split(/[-_:]+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' '), count }))
        .sort((a, b) => a.label.localeCompare(b.label));

    return { items: filtered, allItems, categories, counts };
}

/** Build Markdown attribution credits for installed extensions/components. */
export function formatExtensionAttributionMarkdown(items = []) {
    const unique = new Map();
    for (const item of items || []) {
        if (!item || !item.name || !item.id) continue;
        if (!unique.has(item.id)) unique.set(item.id, item);
    }
    if (unique.size === 0) return 'No extension attributions recorded.';
    return [...unique.values()].map((item) => {
        const lic = item.license || 'Unknown license';
        const ver = item.version ? ` v${item.version}` : '';
        const author = item.author ? ` by **${item.author}**` : '';
        const repo = item.repoUrl ? ` — ${item.repoUrl}` : '';
        const state = item.enabled ? 'Enabled' : 'Disabled';
        return `- **${item.name}**${ver}${author} [${lic}] (${state})${repo}`;
    }).join('\n');
}

/** Runtime manager wired to extensionSettings with graceful offline fallback. */
export function createExtensionLibraryManager({
    getSettings = () => ({}),
    saveSettings = () => {},
    fetchImpl = null,
    onChanged = null,
} = {}) {
    const getFetch = () => fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);

    function config() {
        return ensureExtensionLibrarySettings(getSettings());
    }

    function commitChange() {
        saveSettings?.();
        onChanged?.();
    }

    function setManifestUrl(url) {
        const el = config();
        const resolved = resolveExtensionManifestUrl(url);
        el.manifestUrl = String(url || '').trim() || resolved.manifestUrl;
        commitChange();
        return resolved;
    }

    function resetManifestUrl() {
        const el = config();
        el.manifestUrl = DEFAULT_EXTENSION_MANIFEST_URL;
        commitChange();
        return resolveExtensionManifestUrl(el.manifestUrl);
    }

    async function refreshCatalog({ manifestUrl = null } = {}) {
        const el = config();
        const resolved = resolveExtensionManifestUrl(manifestUrl ?? el.manifestUrl);
        if (manifestUrl !== null) {
            el.manifestUrl = String(manifestUrl || '').trim() || resolved.manifestUrl;
        }
        const fetchFn = getFetch();
        if (!fetchFn) {
            throw new Error('HTTP fetch API is unavailable in this environment.');
        }
        const res = await fetchFn(resolved.manifestUrl, { headers: { Accept: 'application/json' } });
        if (!res?.ok) {
            throw new Error(`Could not load extension manifest (HTTP ${res?.status || 'ERR'}).`);
        }
        const text = await res.text();
        const parsed = parseExtensionManifest(text, {
            manifestUrl: resolved.manifestUrl,
            baseUrl: resolved.baseUrl,
        });
        el.cachedManifest = parsed;
        commitChange();
        return parsed;
    }

    function getCatalog(filterOpts = {}) {
        const el = config();
        return listExtensionEntries({
            manifest: el.cachedManifest,
            installedExtensions: el.installed,
            ...filterOpts,
        });
    }

    function installExtension(entryOrId) {
        const el = config();
        const id = typeof entryOrId === 'string' ? entryOrId : entryOrId?.id;
        const catalog = getCatalog({ categoryFilter: 'all', statusFilter: 'all' });
        const entry = typeof entryOrId === 'object' && entryOrId?.id
            ? entryOrId
            : catalog.allItems.find((x) => x.id === id);
        if (!entry) {
            throw new Error(`Extension "${id || 'unknown'}" was not found in the extension catalog.`);
        }
        if (entry.installed && el.installed[entry.id]) {
            el.installed[entry.id].enabled = true;
            commitChange();
            return { ok: true, alreadyInstalled: true, item: el.installed[entry.id] };
        }
        const record = sanitizeInstalledExtensionRecord(entry, { enabled: true });
        el.installed[entry.id] = record;
        commitChange();
        return { ok: true, item: record };
    }

    function setExtensionEnabled(id, enabled) {
        const el = config();
        if (!id || !el.installed[id]) {
            return { ok: false, reason: 'not-installed' };
        }
        el.installed[id].enabled = Boolean(enabled);
        commitChange();
        return { ok: true, item: el.installed[id] };
    }

    function removeExtension(id) {
        const el = config();
        if (!id || !el.installed[id]) {
            return { ok: true, existed: false };
        }
        delete el.installed[id];
        commitChange();
        return { ok: true, existed: true };
    }

    function clearInstalledExtensions() {
        const el = config();
        const removedCount = Object.keys(el.installed).length;
        el.installed = {};
        commitChange();
        return { removedCount };
    }

    function getInstalledExtension(id) {
        const el = config();
        return id ? (el.installed[id] || null) : null;
    }

    function getAttributionCredits() {
        const el = config();
        return formatExtensionAttributionMarkdown(Object.values(el.installed || {}));
    }

    function getStats() {
        const el = config();
        const cat = getCatalog({ categoryFilter: 'all', statusFilter: 'all' });
        return {
            manifestUrl: el.manifestUrl,
            ...cat.counts,
        };
    }

    return {
        getConfig: config,
        setManifestUrl,
        resetManifestUrl,
        refreshCatalog,
        getCatalog,
        installExtension,
        setExtensionEnabled,
        removeExtension,
        clearInstalledExtensions,
        getInstalledExtension,
        getAttributionCredits,
        getStats,
    };
}
