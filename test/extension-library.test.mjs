import test from 'node:test';
import assert from 'node:assert/strict';

import { createLpeStateStore } from '../src/store.js';
import { createModelLibraryManager } from '../src/modelLibrary.js';
import {
    DEFAULT_EXTENSION_BASE_URL,
    DEFAULT_EXTENSION_MANIFEST_URL,
    DEFAULT_EXTENSION_REPO_URL,
    createExtensionLibraryManager,
    ensureExtensionLibrarySettings,
    formatExtensionAttributionMarkdown,
    isSafeExtensionUrl,
    listExtensionEntries,
    normalizeExtensionCategory,
    parseExtensionManifest,
    resolveExtensionManifestUrl,
    sanitizeExtensionUrl,
} from '../src/extensionLibrary.js';
import { createLpeAppPopup } from '../src/appPopup.js';

const SAMPLE_CATALOG = {
    version: 1,
    name: 'LPE Companion Extensions',
    updatedAt: '2026-11-28',
    extensions: [
        {
            id: 'temp-npcs',
            name: 'Temporary NPCs',
            version: '1.4.2',
            summary: 'Spawns lightweight temporary background NPCs and promotes them into the cast.',
            description: 'Adds a temporary filler NPC roster with promotion hooks.',
            category: 'characters',
            tags: ['npc', 'fills'],
            repoUrl: 'https://github.com/example/ST-LPE-Temporary-NPCs',
            manifestUrl: 'https://raw.githubusercontent.com/example/ST-LPE-Temporary-NPCs/main/manifest.json',
            entryUrl: 'https://raw.githubusercontent.com/example/ST-LPE-Temporary-NPCs/main/index.js',
            sizeBytes: 2_621_440,
            license: 'CC BY 4.0',
            author: 'Example Author',
            requiredHooks: ['promoteEntity'],
            compatibility: '>=1.0.0',
        },
        {
            id: 'dice-oracle',
            name: 'Dice Oracle',
            version: '0.3.0',
            summary: 'Deterministic dice rolls for checks.',
            category: 'systems',
            tags: 'dice, rng',
            sizeBytes: 1024,
            license: 'cc0',
            author: 'DiceSmith',
            requiredHooks: [],
        },
        {
            id: 'evil-scheme',
            name: 'Unsafe Entry',
            entryUrl: 'javascript:alert(1)',
            license: 'CC0',
            author: 'Mallory',
        },
        {
            id: 'evil-data',
            name: 'Data URI Entry',
            entryUrl: 'data:text/javascript,alert(1)',
            license: 'CC0',
            author: 'Mallory',
        },
        {
            id: 'evil-traversal',
            name: 'Traversal Entry',
            entryUrl: '../../etc/passwd',
            license: 'CC0',
            author: 'Mallory',
        },
        {
            id: 'evil-repo',
            name: 'Unsafe Repo',
            repoUrl: 'javascript:alert(1)',
            license: 'CC0',
            author: 'Mallory',
        },
        { id: 'temp-npcs', name: 'Duplicate', author: 'Dup', license: 'CC0' },
        { id: 'bad id!', name: 'Bad ID', author: 'Nobody', license: 'CC0' },
    ],
};

test('extension catalog parsing keeps attribution metadata, normalizes schema, and rejects unsafe URLs', () => {
    assert.equal(resolveExtensionManifestUrl('').manifestUrl, DEFAULT_EXTENSION_MANIFEST_URL);
    assert.equal(resolveExtensionManifestUrl('').baseUrl, DEFAULT_EXTENSION_BASE_URL);
    assert.equal(resolveExtensionManifestUrl('').repoUrl, DEFAULT_EXTENSION_REPO_URL);
    assert.throws(() => resolveExtensionManifestUrl('../manifest.json'), /path traversal/i);
    assert.throws(() => resolveExtensionManifestUrl('javascript:alert(1)'), /unsafe/i);

    assert.equal(isSafeExtensionUrl('https://example.com/x.js'), true);
    assert.equal(isSafeExtensionUrl('fixtures/ext.json'), true);
    assert.equal(isSafeExtensionUrl('../fixtures/ext.json'), false);
    assert.equal(isSafeExtensionUrl('javascript:alert(1)'), false);
    assert.equal(isSafeExtensionUrl('data:text/javascript,1'), false);
    assert.equal(sanitizeExtensionUrl('data:text/javascript,1'), '');
    assert.equal(normalizeExtensionCategory('Ai Tools / NPCs'), 'ai-tools-npcs');

    const parsed = parseExtensionManifest(SAMPLE_CATALOG, { manifestUrl: DEFAULT_EXTENSION_MANIFEST_URL });
    assert.equal(parsed.extensions.length, 2);
    assert.equal(parsed.extensions[0].id, 'temp-npcs');
    assert.equal(parsed.extensions[0].version, '1.4.2');
    assert.equal(parsed.extensions[0].author, 'Example Author');
    assert.equal(parsed.extensions[0].license, 'CC BY 4.0');
    assert.equal(parsed.extensions[0].repoUrl, 'https://github.com/example/ST-LPE-Temporary-NPCs');
    assert.deepEqual(parsed.extensions[0].requiredHooks, ['promoteEntity']);
    assert.equal(parsed.extensions[0].compatibility, '>=1.0.0');
    assert.equal(parsed.extensions[1].license, 'CC0 1.0');
    assert.deepEqual(parsed.extensions[1].tags, ['dice', 'rng']);
    assert.ok(parsed.warnings.length >= 5);
    assert.ok(parsed.warnings.some((w) => /unsafe or invalid "entryUrl"/.test(w)));
    assert.ok(parsed.warnings.some((w) => /duplicate extension id/.test(w)));

    const fromString = parseExtensionManifest(JSON.stringify(SAMPLE_CATALOG), { manifestUrl: DEFAULT_EXTENSION_MANIFEST_URL });
    assert.equal(fromString.extensions.length, 2);
    assert.throws(() => parseExtensionManifest('{"extensions": {}}'), /array/);
    assert.throws(() => parseExtensionManifest('not json'), /Invalid extension manifest JSON/);
});

test('extension entries merge catalog and installed state with offline fallback', () => {
    const manifest = parseExtensionManifest(SAMPLE_CATALOG, { manifestUrl: DEFAULT_EXTENSION_MANIFEST_URL });
    const installed = {
        'temp-npcs': {
            id: 'temp-npcs',
            name: 'Temporary NPCs',
            version: '1.4.2',
            author: 'Example Author',
            license: 'CC BY 4.0',
            repoUrl: 'https://github.com/example/ST-LPE-Temporary-NPCs',
            enabled: true,
            installedAt: '2026-11-28T00:00:00.000Z',
            tags: ['npc'],
        },
        'offline-only': {
            id: 'offline-only',
            name: 'Offline Component',
            version: '0.1.0',
            author: 'Offline Author',
            license: 'MIT',
            enabled: false,
            tags: [],
        },
    };

    const all = listExtensionEntries({ manifest, installedExtensions: installed });
    assert.equal(all.allItems.length, 3);
    assert.equal(all.counts.installedCount, 2);
    assert.equal(all.counts.enabledCount, 1);
    assert.equal(all.counts.availableCount, 1);
    const npc = all.allItems.find((x) => x.id === 'temp-npcs');
    assert.equal(npc.status, 'enabled');
    assert.equal(npc.installed, true);
    const offline = all.allItems.find((x) => x.id === 'offline-only');
    assert.equal(offline.status, 'disabled');
    assert.equal(offline.author, 'Offline Author');

    const enabledOnly = listExtensionEntries({ manifest, installedExtensions: installed, statusFilter: 'enabled' });
    assert.deepEqual(enabledOnly.items.map((x) => x.id), ['temp-npcs']);
    const systemOnly = listExtensionEntries({ manifest, installedExtensions: installed, categoryFilter: 'systems' });
    assert.deepEqual(systemOnly.items.map((x) => x.id), ['dice-oracle']);
    const searched = listExtensionEntries({ manifest, installedExtensions: installed, searchQuery: 'dice' });
    assert.deepEqual(searched.items.map((x) => x.id), ['dice-oracle']);

    const credits = formatExtensionAttributionMarkdown(all.allItems.filter((x) => x.installed));
    assert.match(credits, /Temporary NPCs/);
    assert.match(credits, /Example Author/);
    assert.match(credits, /CC BY 4\.0/);
    assert.match(credits, /Offline Component/);
});

test('stored catalog and installed links are sanitized before rendering', () => {
    const manifest = {
        extensions: [{
            id: 'tampered',
            name: 'Tampered Entry',
            author: 'Tester',
            license: 'CC0',
            repoUrl: 'javascript:alert(1)',
            entryUrl: 'data:text/javascript,alert(1)',
            manifestUrl: '../../escape.json',
        }],
    };
    const catalog = listExtensionEntries({
        manifest,
        installedExtensions: {
            offline: {
                id: 'offline',
                name: 'Offline Tampered',
                author: 'Tester',
                license: 'CC0',
                repoUrl: 'vbscript:msgbox(1)',
                enabled: true,
            },
        },
    });
    const tampered = catalog.allItems.find((x) => x.id === 'tampered');
    assert.equal(tampered.repoUrl, '');
    assert.equal(tampered.entryUrl, '');
    assert.equal(tampered.manifestUrl, '');
    const offline = catalog.allItems.find((x) => x.id === 'offline');
    assert.equal(offline.repoUrl, '');

    const tamperedSettings = { extensionLibrary: { manifestUrl: 'javascript:alert(1)', installed: {} } };
    assert.equal(ensureExtensionLibrarySettings(tamperedSettings).manifestUrl, DEFAULT_EXTENSION_MANIFEST_URL);
});

test('extension manager installs, toggles, removes, and survives an unreachable catalog', async () => {
    const settings = {};
    let saves = 0;
    const mgr = createExtensionLibraryManager({
        getSettings: () => settings,
        saveSettings: () => { saves++; },
        fetchImpl: async () => { throw new Error('network down'); },
    });

    const before = mgr.getCatalog({ categoryFilter: 'all', statusFilter: 'all' });
    assert.equal(before.counts.total, 0);
    await assert.rejects(() => mgr.refreshCatalog(), /network down/);

    const entry = parseExtensionManifest(SAMPLE_CATALOG).extensions[0];
    const installed = mgr.installExtension(entry);
    assert.equal(installed.ok, true);
    assert.equal(installed.item.version, '1.4.2');
    assert.equal(installed.item.author, 'Example Author');
    assert.equal(installed.item.license, 'CC BY 4.0');
    assert.equal(installed.item.repoUrl, 'https://github.com/example/ST-LPE-Temporary-NPCs');
    assert.equal(installed.item.enabled, true);
    assert.ok(settings.extensionLibrary.installed['temp-npcs']);

    // Offline catalog still exposes installed metadata safely.
    const offlineCatalog = mgr.getCatalog({ categoryFilter: 'all', statusFilter: 'all' });
    assert.equal(offlineCatalog.counts.installedCount, 1);
    assert.equal(offlineCatalog.items[0].status, 'enabled');

    assert.equal(mgr.setExtensionEnabled('temp-npcs', false).item.enabled, false);
    assert.equal(mgr.getCatalog({ categoryFilter: 'all', statusFilter: 'all' }).items[0].status, 'disabled');
    assert.equal(mgr.setExtensionEnabled('temp-npcs', true).ok, true);
    assert.equal(mgr.setExtensionEnabled('missing', true).ok, false);

    assert.deepEqual(mgr.removeExtension('temp-npcs'), { ok: true, existed: true });
    assert.equal(settings.extensionLibrary.installed['temp-npcs'], undefined);
    assert.equal(mgr.removeExtension('temp-npcs').existed, false);
    assert.ok(saves >= 4);

    const frozen = { extensionLibrary: Object.freeze({ manifestUrl: '', installed: Object.freeze({}) }) };
    const thawed = ensureExtensionLibrarySettings(frozen);
    assert.equal(thawed.manifestUrl, DEFAULT_EXTENSION_MANIFEST_URL);
    assert.deepEqual(thawed.installed, {});
});

test('unified Control Center tab renders 3D models and extensions, switches modes, and manages extension lifecycle', async (t) => {
    const storage = new Map();
    const doc = { documentElement: { style: { props: {}, setProperty(k, v) { this.props[k] = v; } } } };
    const view = { innerWidth: 1440, innerHeight: 900 };
    let elements;

    function createEl(sel) {
        const classes = new Set();
        const handlers = new Map();
        const attrs = {};
        const props = { disabled: false, checked: false };
        const style = { display: sel === '#lpe_app_overlay' ? 'none' : '' };
        let htmlVal = '';
        let txtVal = '';
        let curVal = '';
        const node = {
            focus() {},
            contains: () => false,
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 40, height: 40 }),
        };
        const api = {
            0: node,
            length: 1,
            html(v) {
                if (v === undefined) return htmlVal;
                htmlVal = String(v);
                for (const [, id] of htmlVal.matchAll(/\bid="([^"]+)"/g)) {
                    if (!elements.has('#' + id)) elements.set('#' + id, createEl('#' + id));
                }
                for (const m of htmlVal.matchAll(/<input\b[^>]*\bid="([^"]+)"[^>]*\bvalue="([^"]*)"/gi)) {
                    elements.get('#' + m[1])?.val(m[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
                }
                return this;
            },
            text(v) { if (v === undefined) return txtVal; txtVal = String(v); return this; },
            val(v) { if (arguments.length === 0) return curVal; curVal = String(v ?? ''); return this; },
            css(k, v) { if (typeof k === 'string' && arguments.length === 1) return style[k]; Object.assign(style, typeof k === 'string' ? { [k]: v } : k); return this; },
            on(evt, tSel, fn) {
                for (const ev of evt.split(' ')) handlers.set(typeof tSel === 'string' ? tSel : ev, fn ?? tSel);
                return this;
            },
            off() { handlers.clear(); return this; },
            fire(key, data) { assert.ok(handlers.has(key), `Expected handler "${key}"`); return handlers.get(key)(data); },
            prop(k, v) { if (arguments.length === 1) return props[k]; props[k] = v; return this; },
            attr(k, v) { if (typeof k === 'string' && arguments.length === 1) return attrs[k]; Object.assign(attrs, typeof k === 'string' ? { [k]: v } : k); return this; },
            toggleClass(c, f) { f ? classes.add(c) : classes.delete(c); return this; },
            addClass(c) { classes.add(c); return this; },
            removeClass(c) { classes.delete(c); return this; },
            hasClass(c) { return classes.has(c); },
            find(q) { return elements.get(q) ?? emptySel; },
            each() { return this; },
            hide() { style.display = 'none'; return this; },
            show() { style.display = ''; return this; },
            empty() { htmlVal = ''; return this; },
            toggle() { return this; },
            scrollTop() { return this; },
            width() { return view.innerWidth; },
            height() { return view.innerHeight; },
            outerHeight() { return 44; },
        };
        api.append = api.html;
        return api;
    }

    const emptySel = { length: 0, each() {}, on() { return this; }, val() { return ''; }, prop() { return false; } };
    elements = new Map(['body', doc, view].map((k) => [k, createEl(k)]));
    const globals = {
        $: (s) => elements.get(s) ?? emptySel,
        window: view,
        document: doc,
        localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    };
    for (const [k, v] of Object.entries(globals)) {
        const prev = Object.getOwnPropertyDescriptor(globalThis, k);
        Object.defineProperty(globalThis, k, { configurable: true, value: v });
        t.after(() => {
            if (prev) Object.defineProperty(globalThis, k, prev);
            else delete globalThis[k];
        });
    }

    const settings = { enabled: true, readingFont: 'lora', hudTheme: 'Magnum Opus' };
    const ctxObj = {
        characterId: 0,
        characters: [{ name: 'Lady Isolde', avatar: 'isolde.png' }],
        chatId: 'c1',
        chat: [],
        chatMetadata: {},
    };
    const store = createLpeStateStore({
        adapter: { getChat: () => ctxObj.chat, getMeta: () => ctxObj.chatMetadata, saveMeta: () => {} },
    });
    const extMgr = createExtensionLibraryManager({
        getSettings: () => settings,
        saveSettings: () => {},
        fetchImpl: async (url) => {
            if (url.includes('manifest.json')) {
                return { ok: true, status: 200, text: async () => JSON.stringify(SAMPLE_CATALOG) };
            }
            return { ok: false, status: 404 };
        },
    });
    const modelMgr = createModelLibraryManager({
        getSettings: () => settings,
        saveSettings: () => {},
        getContextSafe: () => ctxObj,
        store,
    });

    const popup = createLpeAppPopup({
        store,
        getSettings: () => settings,
        saveSettings: () => {},
        getContextSafe: () => ctxObj,
        modelLibraryManager: modelMgr,
        extensionLibraryManager: extMgr,
    });
    popup.mount({ restoreDrawer: false });
    popup.open({ tab: 'models' });
    const stage = elements.get('#lpe_app_stage');

    // Unified tab by default shows both 3D model and extension sections.
    assert.match(stage.html(), /3D Model Library &amp; Extensions/);
    assert.match(stage.html(), /Browse Models &amp; Collections/);
    assert.match(stage.html(), /Browse Extensions &amp; Modular Components/);
    assert.match(stage.html(), /data-lib-mode="all"[^>]*class="lpe-lib-mode-pill active"|class="lpe-lib-mode-pill active" data-lib-mode="all"/);

    // Switch to extensions-only mode, then refresh the extension catalog.
    stage.fire('.lpe-lib-mode-pill', { currentTarget: { dataset: { libMode: 'extensions' } } });
    assert.doesNotMatch(stage.html(), /Browse Models &amp; Collections/);
    assert.match(stage.html(), /Browse Extensions &amp; Modular Components/);
    await stage.fire('#lpe_ext_refresh_btn');
    assert.match(stage.html(), /Temporary NPCs/);
    assert.match(stage.html(), /Example Author/);
    assert.match(stage.html(), /CC BY 4\.0/);
    assert.match(stage.html(), /2\.50 MB/);

    // Install / disable / re-enable / remove through the unified UI.
    stage.fire('.lpe-ext-install-btn', { currentTarget: { dataset: { extId: 'temp-npcs' } } });
    assert.ok(settings.extensionLibrary.installed['temp-npcs']);
    assert.equal(settings.extensionLibrary.installed['temp-npcs'].author, 'Example Author');
    assert.equal(settings.extensionLibrary.installed['temp-npcs'].version, '1.4.2');
    assert.match(stage.html(), /Enabled/);

    stage.fire('.lpe-ext-toggle-btn', { currentTarget: { dataset: { extId: 'temp-npcs', extEnable: '0' } } });
    assert.equal(settings.extensionLibrary.installed['temp-npcs'].enabled, false);
    assert.match(stage.html(), /Disabled/);

    stage.fire('.lpe-ext-toggle-btn', { currentTarget: { dataset: { extId: 'temp-npcs', extEnable: '1' } } });
    assert.equal(settings.extensionLibrary.installed['temp-npcs'].enabled, true);

    stage.fire('.lpe-ext-remove-btn', { currentTarget: { dataset: { extId: 'temp-npcs' } } });
    assert.equal(settings.extensionLibrary.installed['temp-npcs'], undefined);

    // Switch back to 3D-only mode and confirm the model collection UI is intact.
    stage.fire('.lpe-lib-mode-pill', { currentTarget: { dataset: { libMode: '3d' } } });
    assert.match(stage.html(), /Browse Models &amp; Collections/);
    assert.doesNotMatch(stage.html(), /Browse Extensions &amp; Modular Components/);
    assert.match(stage.html(), /CC BY 4\.0/);
    assert.match(stage.html(), /Core Default/);
});
