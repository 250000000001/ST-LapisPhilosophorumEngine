/**
 * Megumin-Suite–inspired floating launcher button and glassmorphic tabbed Control Center popup
 * for Lapis Philosophorum Engine (LPE).
 *
 * Strictly namespace-isolated (`#lpe_fab_btn`, `#lpe_app_overlay`, `.lpe-*`) and uses only
 * scoped CSS custom properties so it coexists alongside Megumin Suite without collisions.
 */

import {
    LPE_THEMES,
    LPE_STYLES,
    LPE_FONTS,
    resolveLpeFont,
    PALETTE,
    cloneState,
    emptyState,
    isEmptySentinel,
    isPlayerPersonaName,
    normalizeNameKey,
    slugifyTrackerId,
} from './schema.js';
import {
    BOND_AXIS_SPEC,
    BOND_PRESETS,
    resolveBondPreset,
    extractAxesFromMatrix,
    buildMatrixStringFromAxes,
    parseCharacterBatchInput,
    parseCharacterFiles,
    extractCharacterRecord,
    buildCharacterUpsertDelta,
    buildCharacterBatchDelta,
} from './characterImport.js';
import { serializeInternalStates } from './parser.js';
import {
    computeBbox,
    parseDimMeters,
    normalizeAtlasObject,
    normalizeRoomObjects,
    approveTrackerProposal,
    dismissTrackerProposal,
} from './reducer.js';
import { renderAtlasTab, bindAtlasSvgControls } from './atlasSvg.js';
import { bindPolyOrbitControls, POLY_SHAPES, POLY_MATERIALS } from './polyCss3d.js';
import { POLY_PREFABS } from './polyAssets.js';
import { renderAetherMatrixList } from './matrixView.js';
import {
    renderHealthTab,
    bindHealthDollInteractions,
    BODY_TYPES,
    BODY_PARTS,
    BODY_PART_BY_ID,
    CONDITION_KINDS,
    WHOLE_BODY_TYPES,
    applyHealthDelta,
    computeHealthMetrics,
    normalizeHealthState,
    hasExplicitHealthData,
    inferHealthFromStatusText,
} from './healthDoll.js';
import { fetchModelsList, extractErrorMessage } from './workerClient.js';
import { DEFAULT_END_MARKER } from './retryDetector.js';
import { getChatCompletionProfiles, getActiveUserName } from './st.js';
import { evaluateEjs, shouldYieldEjs } from './ejsEngine.js';
import { shouldYieldRenderer } from './cardRenderer.js';
import {
    DEFAULT_COLLECTION_ID,
    DEFAULT_LIBRARY_MANIFEST_URL,
    createModelLibraryManager,
    formatBytesMb,
    formatCollectionLabel,
    normalizeCollectionSlug,
} from './modelLibrary.js';
import {
    DEFAULT_EXTENSION_MANIFEST_URL,
    createExtensionLibraryManager,
} from './extensionLibrary.js';

const FAB_POS_KEY = 'lpe_fab_pos';
const LEGACY_FAB_POS_KEY = 'vexa_state_engine_fab_pos';
const RAIL_STATE_KEY = 'lpe_rail_state';

export const RAIL_TABS = Object.freeze([
    {
        id: 'overview',
        title: 'Overview',
        kicker: 'World Status & Scene',
        glyph: '✦',
        icon: 'fa-compass',
        subTabs: [{ id: 'overview', label: 'Overview' }],
    },
    {
        id: 'atlas',
        title: 'Atlas',
        kicker: 'Spatial Map & Locations',
        icon: 'fa-map',
        subTabs: [
            { id: 'atlas', label: 'Atlas Map' },
            { id: 'models', label: '3D & Extensions' },
        ],
    },
    {
        id: 'health',
        title: 'Health',
        kicker: 'Anatomical Health Doll',
        icon: 'fa-kit-medical',
        subTabs: [{ id: 'health', label: 'Body & Wounds' }],
    },
    {
        id: 'trackers',
        title: 'Trackers & Vars',
        kicker: 'Custom Trackers & Scoped Card Vars',
        icon: 'fa-chart-simple',
        subTabs: [
            { id: 'trackers', label: 'Trackers' },
            { id: 'runtime', label: 'Card Vars' },
        ],
    },
    {
        id: 'narrative',
        title: 'Journal & Chekhov',
        kicker: 'Chekhov, Notebook, Cast & Bonds',
        icon: 'fa-feather-pointed',
        subTabs: [
            { id: 'narrative', label: 'Chekhov & Notes' },
            { id: 'cast', label: 'Cast' },
            { id: 'relations', label: 'Bonds' },
        ],
    },
    {
        id: 'appearance',
        title: 'Settings',
        kicker: 'LPE, Clerk, Guard & Appearance',
        icon: 'fa-sliders',
        subTabs: [
            { id: 'appearance', label: 'Appearance' },
            { id: 'models', label: '3D & Extensions' },
            { id: 'worker', label: 'Clerk' },
            { id: 'retry', label: 'Guard' },
            { id: 'runtime', label: 'Runtime' },
            { id: 'tools', label: 'Tools' },
        ],
    },
]);

export const APP_DOCK_GROUPS = Object.freeze([
    { id: 'world', title: 'World State' },
    { id: 'engine', title: 'Engine & Worker' },
]);

export const APP_TABS = Object.freeze([
    { id: 'overview', group: 'world', title: 'World & Scene', sub: 'Turn counter, environment, obstacles, and quick scene edits.', icon: 'fa-globe' },
    { id: 'atlas', group: 'world', title: 'Atlas Map', sub: 'Interactive floorplans, rooms, doorways, and occupant positions.', icon: 'fa-map' },
    { id: 'health', group: 'world', title: 'Health & Body', sub: 'Anatomical body-part condition doll, injury indicators, capacities, and medical editor (inspired by Nice Health Tab).', icon: 'fa-kit-medical' },
    { id: 'cast', group: 'world', title: 'Cast & Entities', sub: 'On-screen cast, off-screen agendas, profiles, memories, and thoughts.', icon: 'fa-users' },
    { id: 'relations', group: 'world', title: 'Aether & Bonds', sub: 'Dynamic pair matrices, emotional sluices, and filters.', icon: 'fa-heart-pulse' },
    { id: 'narrative', group: 'world', title: 'Plot & Notes', sub: 'Chekhov bullets, Notebook rules, Tracks & ARC, Inventory, and Vent.', icon: 'fa-crosshairs' },
    { id: 'trackers', group: 'world', title: 'Custom Trackers', sub: 'Main-model-proposed and custom multi-field trackers (businesses, estates, ships, ledgers).', icon: 'fa-chart-simple' },
    { id: 'worker', group: 'engine', title: 'LPE Clerk', sub: 'Secondary background API worker that tracks deltas after every reply.', icon: 'fa-robot' },
    { id: 'retry', group: 'engine', title: 'Refusal Retry', sub: 'Built-in safety refusal cleanup, GFX_END guard, and Non-Stream Continue.', icon: 'fa-shield-halved' },
    { id: 'runtime', group: 'engine', title: 'Card Runtime', sub: 'Scoped EJS templating, guarded Blob-URL renderer, sandboxed interactive bridge, and scoped card variables.', icon: 'fa-code' },
    { id: 'appearance', group: 'engine', title: 'HUD & Rules', sub: 'Visual themes, card styles, smart scoping, and deterministic engine caps.', icon: 'fa-palette' },
    { id: 'models', group: 'engine', title: '3D Model Library & Extensions', sub: 'Browse, install, enable/disable, and remove 3D model collections and modular extensions from one unified library.', icon: 'fa-cubes' },
    { id: 'tools', bottom: true, title: 'Tools & JSON', sub: 'Chat import, compiled XML snapshot preview, and raw canonical JSON.', icon: 'fa-wrench' },
]);

/** Estimate approximate token count (~4 chars/token). */
export function estimateTokenCount(text) {
    return Math.max(0, Math.round(String(text || '').length / 4));
}

/** Resolve active character or group metadata for the popup hero banner. */
export function getCharacterBannerInfo(ctx) {
    if (ctx && ctx.groupId !== undefined && ctx.groupId !== null && ctx.groupId !== '') {
        const groups = ctx.groups;
        const grp = Array.isArray(groups)
            ? groups.find((g) => String(g?.id ?? '') === String(ctx.groupId))
            : groups?.[ctx.groupId];
        return {
            name: String(grp?.name || 'Group Chat'),
            subtitle: 'GROUP CHAT',
            imageUrl: '',
        };
    }
    if (ctx && ctx.characterId !== undefined && ctx.characterId !== null && ctx.characterId !== '') {
        const ch = ctx.characters?.[ctx.characterId];
        if (ch) {
            return {
                name: String(ch.name || 'Character'),
                subtitle: 'ACTIVE CHARACTER',
                imageUrl: ch.avatar ? `/characters/${encodeURIComponent(ch.avatar)}` : '',
            };
        }
    }
    return {
        name: 'Lapis Philosophorum Engine (LPE)',
        subtitle: 'GLOBAL WORKSPACE',
        imageUrl: '',
    };
}

const HUD_TO_APP_MAP = Object.freeze({
    world: { tab: 'overview', sub: null },
    locations: { tab: 'atlas', sub: null },
    health: { tab: 'health', sub: null },
    onscreen: { tab: 'cast', sub: 'onscreen' },
    offscreen_agendas: { tab: 'cast', sub: 'offscreen' },
    entity_state: { tab: 'cast', sub: 'entities' },
    entityMem: { tab: 'cast', sub: 'memories' },
    thoughts: { tab: 'cast', sub: 'thoughts' },
    pair: { tab: 'relations', sub: 'pair' },
    dam: { tab: 'relations', sub: 'dam' },
    chekhov: { tab: 'narrative', sub: 'chekhov' },
    notebook: { tab: 'narrative', sub: 'notebook' },
    tracks: { tab: 'narrative', sub: 'tracks' },
    arc: { tab: 'narrative', sub: 'tracks' },
    inv: { tab: 'narrative', sub: 'inv' },
    custom_trackers: { tab: 'trackers', sub: null },
    story_notes: { tab: 'narrative', sub: 'inv' },
    vent: { tab: 'narrative', sub: 'vent' },
    receipt: { tab: 'narrative', sub: 'receipt' },
});

/** Map any of the 16 HUD card tab IDs to { tab, sub } inside the Control Center popup. */
export function mapHudTabToAppTab(hudTabId) {
    return HUD_TO_APP_MAP[hudTabId] || { tab: 'overview', sub: null };
}

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function hexFromFontColor(fc) {
    const m = String(fc || '').match(/#[0-9a-f]{6}/i);
    if (m) return m[0];
    const low = String(fc || '').toLowerCase();
    const p = PALETTE.find((x) => low.includes(x.name));
    return p ? p.hex : '#f4a261';
}

function renderSwitchRow({ id = '', icon = '', color = '', label, desc, on }) {
    return `
        <div ${id ? `id="${esc(id)}"` : ''} class="lpe-switch-row ${on ? 'active' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}" tabindex="0">
            <div class="lpe-switch-info">
                <div class="lpe-switch-label">
                    ${icon ? `<i class="fa-solid ${esc(icon)}" ${color ? `style="color:${esc(color)};"` : ''}></i>` : ''}
                    <span>${label}</span>
                </div>
                ${desc ? `<div class="lpe-switch-desc">${desc}</div>` : ''}
            </div>
            <div class="lpe-switch"></div>
        </div>
    `;
}

function renderTiles(groupName, options, current) {
    return `
        <div class="lpe-tiles" data-tile-group="${esc(groupName)}">
            ${options.map((o) => `
                <button type="button" class="lpe-tile ${String(o.id) === String(current) ? 'on' : ''}" data-tile-val="${esc(o.id)}">
                    <b>${esc(o.label)}</b>
                    ${o.desc ? `<span>${esc(o.desc)}</span>` : ''}
                </button>
            `).join('')}
        </div>
    `;
}

function renderPageHeader({ title, sub, icon, badgeHtml = '' }) {
    return `
        <div class="lpe-page-head">
            <div class="lpe-page-head-left">
                <div class="lpe-page-icon"><i class="fa-solid ${esc(icon)}"></i></div>
                <div>
                    <h2>${esc(title)}</h2>
                    <p>${esc(sub)}</p>
                </div>
            </div>
            ${badgeHtml}
        </div>
    `;
}

function applyThemeVarsToEl($el, themeName) {
    const theme = LPE_THEMES[themeName] || LPE_THEMES['Magnum Opus'] || LPE_THEMES.Sola;
    for (const [k, v] of Object.entries(theme)) {
        if (k === 'scheme') $el.css('color-scheme', v);
        else $el.css(`--ist-${k}`, v);
    }
}

/**
 * Create the Megumin-style floating launcher + tabbed Control Center modal.
 */
export function createLpeAppPopup({
    store,
    getSettings,
    saveSettings,
    getContextSafe,
    workerClient,
    getWorkerStatus = () => ({ busy: false, runningLabel: null, waiting: 0 }),
    getRecentStoryText = () => '',
    onImportChat,
    onRereadLast,
    onResetChat,
    onCleanLastRefusal,
    onRetryToggleChanged,
    onAlignHudThemes,
    onSettingsChanged,
    onStateSaved,
    getRuntimeStats = () => ({}),
    onCardVarsChanged,
    modelLibraryManager = null,
    extensionLibraryManager = null,
}) {
    let activeTab = 'overview';
    const subTabs = {
        cast: 'onscreen',
        relations: 'pair',
        narrative: 'chekhov',
    };
    const atlasView = {
        mapId: null,
        level: null,
        roomId: null,
        mode: null,
        allFloors: false,
        cutaway: true,
        showLabels: true,
        camera: { rotX: 56, rotZ: 32, zoom: 1, panX: 0, panY: 0 },
        svgCamera: { zoom: 1, panX: 0, panY: 0 },
        webglCamera: null,
        webglCameraKey: null,
    };
    let activeWebglHandle = null;
    let webglMountSeq = 0;

    function disposeWebgl() {
        webglMountSeq++;
        if (activeWebglHandle) {
            try { activeWebglHandle.dispose(); } catch { /* ignore */ }
            activeWebglHandle = null;
        }
    }
    const healthView = {
        layer: 'body',
        selectedPart: null,
    };
    let previewScoped = true;
    let inspectSeq = null;
    let inspectMesId = null;
    let castMode = 'list'; // 'list' | 'import' | 'edit'
    let editingCharName = null;
    let editorDraft = null;
    let editorRemovedBondTargets = [];
    let importState = {
        rawText: '',
        defaultPresence: 'staged',
        defaultRoomId: '',
        candidates: [],
        warnings: [],
    };
    let workerTestResult = null; // { ok, text }
    let fetchedModels = [];
    let apiKeyVisible = false;
    let fabDragBound = false;
    let railDrawerRestoredOnce = false;
    let fallbackLibMgr = null;
    let fallbackExtMgr = null;
    const modelLibraryUi = {
        mode: 'all',
        collectionFilter: 'all',
        statusFilter: 'all',
        searchQuery: '',
        draftManifestUrl: null,
        busyModelIds: new Set(),
        busyCollection: null,
        refreshing: false,
        statusMessage: '',
        statusError: '',
    };
    const extensionLibraryUi = {
        categoryFilter: 'all',
        statusFilter: 'all',
        searchQuery: '',
        draftManifestUrl: null,
        busyIds: new Set(),
        refreshing: false,
        statusMessage: '',
        statusError: '',
    };

    function libMgr() {
        if (modelLibraryManager) return modelLibraryManager;
        if (!fallbackLibMgr) {
            fallbackLibMgr = createModelLibraryManager({
                getSettings,
                saveSettings,
                getContextSafe,
                store,
            });
        }
        return fallbackLibMgr;
    }

    function extMgr() {
        if (extensionLibraryManager) return extensionLibraryManager;
        if (!fallbackExtMgr) {
            fallbackExtMgr = createExtensionLibraryManager({
                getSettings,
                saveSettings,
            });
        }
        return fallbackExtMgr;
    }

    function applyReadingFontVars() {
        if (typeof document === 'undefined' || !document.documentElement?.style?.setProperty) return;
        const font = resolveLpeFont(getSettings?.()?.readingFont);
        document.documentElement.style.setProperty('--lpe-reading-font', font.stack);
        document.documentElement.style.setProperty('--lpe-reading-line-height', font.lineHeight);
    }

    function buildFontSelectHtml(id, extraClass = '') {
        const cur = resolveLpeFont(getSettings?.()?.readingFont).id;
        const opts = LPE_FONTS.map((f) => `<option value="${esc(f.id)}" ${f.id === cur ? 'selected' : ''}>${esc(f.label)}</option>`).join('');
        return `<select id="${esc(id)}" class="lpe-font-quick-sel ${extraClass}" title="Reading &amp; Prose Font" aria-label="Reading and Prose Font">${opts}</select>`;
    }

    function loadRailState() {
        const defaults = {
            railCollapsed: false,
            topBarCollapsed: false,
            drawerOpen: false,
            activeRailTab: 'overview',
            drawerSubTabs: {},
            railDock: { side: 'right', top: null },
        };
        try {
            const raw = localStorage.getItem(RAIL_STATE_KEY);
            if (!raw) return defaults;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return defaults;
            const validRailIds = new Set(RAIL_TABS.map((t) => t.id));
            const railCollapsed = parsed.railCollapsed === true;
            return {
                railCollapsed,
                topBarCollapsed: parsed.topBarCollapsed === true,
                drawerOpen: !railCollapsed && Boolean(parsed.drawerOpen),
                activeRailTab: validRailIds.has(parsed.activeRailTab) ? parsed.activeRailTab : 'overview',
                drawerSubTabs: parsed.drawerSubTabs && typeof parsed.drawerSubTabs === 'object' ? parsed.drawerSubTabs : {},
                railDock: {
                    side: parsed.railDock?.side === 'left' ? 'left' : 'right',
                    top: Number.isFinite(parsed.railDock?.top) ? Math.max(0, parsed.railDock.top) : null,
                },
            };
        } catch {
            return defaults;
        }
    }

    const railState = loadRailState();

    function saveRailState() {
        try {
            localStorage.setItem(RAIL_STATE_KEY, JSON.stringify(railState));
        } catch { /* ignore */ }
    }

    function setRailDock(side, top) {
        railState.railDock = { side, top };
        saveRailState();
        syncRailDock();
    }

    function syncRailDock() {
        const { side, top } = railState.railDock;
        $('body').toggleClass('lpe-rail-docked-left', side === 'left')
            .css('--lpe-rail-top', top === null ? '' : `${top}px`);
    }

    function bindRailDrag($handle, $target, { tail = false } = {}) {
        const handle = $handle[0];
        const target = $target[0];
        let drag = null;
        let snapAnimation;
        let suppressClick = false;

        function move(event) {
            if (!drag || drag.id !== event.pointerId) return;
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            if (!drag.moved) {
                if (Math.hypot(dx, dy) < 5) return;
                snapAnimation?.cancel();
                drag.moved = true;
            }

            const { width, height } = target.getBoundingClientRect();
            const left = Math.max(0, Math.min(window.innerWidth - width, drag.left + dx));
            const top = Math.max(0, Math.min(window.innerHeight - height, drag.top + dy));
            $target.addClass('lpe-rail-dragging')
                .css({ '--lpe-rail-drag-x': `${left}px`, '--lpe-rail-drag-y': `${top}px` });
        }

        function finish(event) {
            if (!drag || drag.id !== event.pointerId) return;
            if (event.type === 'pointerup') move(event);
            const { id, moved, tailOffset } = drag;
            drag = null;
            if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
            if (!moved) return;
            suppressClick = true;

            const from = target.getBoundingClientRect();
            $target.removeClass('lpe-rail-dragging')
                .css({ '--lpe-rail-drag-x': '', '--lpe-rail-drag-y': '' });
            if (!from.width || !from.height) return;

            const side = from.left + from.width / 2 < window.innerWidth / 2 ? 'left' : 'right';
            setRailDock(side, Math.max(0, Math.round(from.top - tailOffset)));

            if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
                const to = target.getBoundingClientRect();
                snapAnimation = target.animate?.([
                    { translate: `${from.left - to.left}px ${from.top - to.top}px` },
                    { translate: '0 0' },
                ], { duration: 220, easing: 'ease-out' });
            }
        }

        $handle.off('.lpeRailDrag')
            .on('pointerdown.lpeRailDrag', (e) => {
                const event = e.originalEvent ?? e;
                if (drag || event.button !== 0 || event.isPrimary === false) return;
                suppressClick = false;
                if (tail && !railState.railCollapsed) return;
                const { left, top } = target.getBoundingClientRect();
                const tailOffset = 0;
                handle.setPointerCapture(event.pointerId);
                drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left, top, tailOffset, moved: false };
            })
            .on('pointermove.lpeRailDrag', (e) => move(e.originalEvent ?? e))
            .on('pointerup.lpeRailDrag pointercancel.lpeRailDrag lostpointercapture.lpeRailDrag', (e) => finish(e.originalEvent ?? e))
            .on('click.lpeRailDrag', (e) => {
                const keyboard = (e?.originalEvent ?? e)?.detail === 0;
                if (suppressClick && !keyboard) {
                    suppressClick = false;
                    return;
                }
                if (tail) setRailCollapsed(!railState.railCollapsed);
                else if (keyboard) setRailDock('right', null);
            });

        if (!tail) $handle.on('dblclick.lpeRailDrag', () => setRailDock('right', null));
    }

    function getRailTabDef(railTabId = railState.activeRailTab) {
        return RAIL_TABS.find((t) => t.id === railTabId) || RAIL_TABS[0];
    }

    function resolveRailSubAppTab(railTabId = railState.activeRailTab) {
        const def = getRailTabDef(railTabId);
        const savedSub = railState.drawerSubTabs?.[def.id];
        if (savedSub && def.subTabs.some((s) => s.id === savedSub)) return savedSub;
        return def.subTabs[0]?.id || 'overview';
    }

    function findRailTabForAppTab(appTabId) {
        const exact = RAIL_TABS.find((r) => r.id === appTabId);
        if (exact) return exact.id;
        const parent = RAIL_TABS.find((r) => r.subTabs.some((s) => s.id === appTabId));
        return parent ? parent.id : 'overview';
    }

    function isOpen() {
        const $ov = $('#lpe_app_overlay');
        return Boolean($ov.length && $ov.css('display') !== 'none');
    }

    function isDrawerOpen() {
        const $dr = $('#lpe_drawer');
        return Boolean($dr.length && $dr.hasClass('is-open'));
    }

    function isAnyUiOpen() {
        return isOpen() || isDrawerOpen();
    }

    function activeState() {
        if (typeof inspectSeq === 'number') {
            return store?.getStateAt?.(inspectSeq) || cloneState(emptyState());
        }
        return store?.getState?.() || cloneState(emptyState());
    }

    function notifySettingsChanged({ retryChanged = false } = {}) {
        applyReadingFontVars();
        saveSettings?.();
        if (retryChanged) onRetryToggleChanged?.();
        onSettingsChanged?.();
        syncChrome();
    }

    function activeUserName() {
        return String(getContextSafe?.()?.name1 || getActiveUserName() || '').trim();
    }

    function commitEditedState(nextState, msg = 'Saved state changes.') {
        store.addUserEdit(cloneState(nextState), { kind: 'snapshot' });
        inspectSeq = null;
        inspectMesId = null;
        onStateSaved?.();
        syncChrome();
        renderActiveTab();
        window.toastr?.success?.(msg, 'Lapis Philosophorum Engine (LPE)');
    }

    function commitDeltaEdit(delta, msg = 'Saved character changes.') {
        if (!delta || !Object.keys(delta).length) return false;
        store.addUserEdit(cloneState(delta), { kind: 'delta', ctx: { userName: activeUserName() } });
        inspectSeq = null;
        inspectMesId = null;
        onStateSaved?.();
        syncChrome();
        renderActiveTab();
        window.toastr?.success?.(msg, 'Lapis Philosophorum Engine (LPE)');
        return true;
    }

    function initFabDrag() {
        const $btn = $('#lpe_fab_btn');
        if (!$btn.length || fabDragBound) return;
        fabDragBound = true;

        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let initialLeft = 0;
        let initialTop = 0;
        let hasMoved = false;
        let savedPos = null;

        try {
            const raw = localStorage.getItem(FAB_POS_KEY) ?? localStorage.getItem(LEGACY_FAB_POS_KEY);
            if (raw) savedPos = JSON.parse(raw);
        } catch {
            savedPos = null;
        }

        function applyPosition(pos) {
            $btn.css({ left: '', right: '', top: '', bottom: '' });
            const winW = $(window).width() || window.innerWidth || 1280;
            const winH = $(window).height() || window.innerHeight || 720;
            const gutter = winW < 1000 ? 12 : 18;
            const btnH = $btn.outerHeight() || 46;

            if (pos && typeof pos.topPercent === 'number') {
                const topPx = Math.max(10, Math.min(winH - btnH - 10, (pos.topPercent / 100) * winH));
                $btn.css('top', `${Math.round(topPx)}px`);
                if (pos.side === 'left') $btn.css('left', `${gutter}px`);
                else $btn.css('right', `${gutter}px`);
            } else if (winW < 1000) {
                const topPx = Math.max(56, winH - btnH - 86);
                $btn.css({ top: `${Math.round(topPx)}px`, right: `${gutter}px`, bottom: 'auto' });
            } else {
                $btn.css({ top: '76px', right: `${gutter}px` });
            }
        }

        applyPosition(savedPos);
        $(window).off('resize.lpe_fab').on('resize.lpe_fab', () => {
            applyPosition(savedPos);
            syncChrome();
        });

        function dragStart(e) {
            if (e.type === 'mousedown' && e.which !== 1) return;
            const ev = e.originalEvent?.touches ? e.originalEvent.touches[0] : e;
            startX = ev.clientX;
            startY = ev.clientY;
            const rect = $btn[0].getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            hasMoved = false;
            isDragging = true;
            $btn.removeClass('lpe-fab-transition');
            $(document).on('mousemove.lpe_fab_drag touchmove.lpe_fab_drag', dragMove);
            $(document).on('mouseup.lpe_fab_drag touchend.lpe_fab_drag', dragEnd);
            if (e.type === 'mousedown') e.preventDefault();
        }

        function dragMove(e) {
            if (!isDragging) return;
            const ev = e.originalEvent?.touches ? e.originalEvent.touches[0] : e;
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasMoved = true;
            if (hasMoved && e.cancelable) e.preventDefault();

            const winW = $(window).width() || window.innerWidth || 1280;
            const winH = $(window).height() || window.innerHeight || 720;
            const btnW = $btn.outerWidth() || 46;
            const btnH = $btn.outerHeight() || 46;
            const newLeft = Math.max(0, Math.min(winW - btnW, initialLeft + dx));
            const newTop = Math.max(10, Math.min(winH - btnH - 10, initialTop + dy));
            $btn.css({ left: `${newLeft}px`, right: 'auto', top: `${newTop}px` });
        }

        function dragEnd() {
            if (!isDragging) return;
            isDragging = false;
            $(document).off('.lpe_fab_drag');
            if (!hasMoved) return;

            $btn.addClass('lpe-fab-transition');
            const winW = $(window).width() || window.innerWidth || 1280;
            const winH = $(window).height() || window.innerHeight || 720;
            const gutter = winW <= 768 ? 12 : 20;
            const rect = $btn[0].getBoundingClientRect();
            const side = (rect.left + rect.width / 2) < (winW / 2) ? 'left' : 'right';
            if (side === 'left') $btn.css({ left: `${gutter}px`, right: 'auto' });
            else $btn.css({ left: 'auto', right: `${gutter}px` });

            savedPos = { side, topPercent: (rect.top / winH) * 100 };
            try { localStorage.setItem(FAB_POS_KEY, JSON.stringify(savedPos)); } catch { /* ignore */ }

            $btn.one('click', (clickEv) => {
                clickEv.stopImmediatePropagation();
                clickEv.preventDefault();
            });
        }

        $btn.on('mousedown.lpe_fab touchstart.lpe_fab', dragStart);
        $btn.on('click.lpe_fab', () => {
            if (isOpen()) {
                close();
                return;
            }
            toggleDrawer();
        });
    }

    function buildRailHtml() {
        const itemsHtml = RAIL_TABS.map((t) => {
            const isAct = t.id === railState.activeRailTab;
            const iconHtml = t.glyph
                ? `<span class="lpe-rail-glyph lpe-ornament" aria-hidden="true">${esc(t.glyph)}</span>`
                : `<i class="fa-solid ${esc(t.icon)}" aria-hidden="true"></i>`;
            const extraBadge = t.id === 'health'
                ? '<span id="lpe_rail_health_dot" class="lpe-rail-alert-dot" style="display:none;"></span>'
                : '';
            return `
                <button type="button" class="lpe-rail-item ${isAct ? 'active' : ''}" data-rail-tab="${esc(t.id)}" title="${esc(t.title)} — ${esc(t.kicker)}" aria-label="${esc(t.title)}">
                    ${iconHtml}
                    <span class="lpe-rail-tip">${esc(t.title)}</span>
                    ${extraBadge}
                </button>
            `;
        }).join('');

        return `
            <button type="button" id="lpe_rail_drag_handle" class="lpe-rail-grip" title="Drag rail · double-click to reset" aria-label="Move LPE rail. Enter resets its position.">
                <i class="fa-solid fa-grip-lines" aria-hidden="true"></i>
            </button>
            <nav class="lpe-rail-nav" aria-label="LPE Quick Rail Navigation">${itemsHtml}</nav>
            <div class="lpe-rail-spacer"></div>
            <div class="lpe-rail-footer">
                <span id="lpe_rail_status_dot" class="lpe-rail-status-dot" title="Engine idle"></span>
                <button type="button" id="lpe_rail_modal_btn" class="lpe-rail-btn" title="Open Full LPE Control Center" aria-label="Open Full LPE Control Center">
                    <i class="fa-solid fa-expand" aria-hidden="true"></i>
                </button>
            </div>
            <button type="button" id="lpe_rail_collapse_btn" class="lpe-rail-collapse-btn" title="Collapse LPE side rail" aria-label="Collapse LPE side rail">
                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
            </button>
        `;
    }

    function buildDrawerHeaderMeta() {
        const def = getRailTabDef(railState.activeRailTab);
        $('#lpe_drawer_title').text(def.title);
        const $subWrap = $('#lpe_drawer_subpills');
        if (def.subTabs.length > 1) {
            const curSub = resolveRailSubAppTab(def.id);
            $subWrap.html(def.subTabs.map((s) => `
                <button type="button" class="lpe-drawer-subpill ${s.id === curSub ? 'active' : ''}" data-drawer-sub="${esc(s.id)}">${esc(s.label)}</button>
            `).join('')).show();
        } else {
            $subWrap.empty().hide();
        }
        const $mobWrap = $('#lpe_drawer_mobile_tabs');
        $mobWrap.html(RAIL_TABS.map((t) => {
            const isAct = t.id === railState.activeRailTab;
            return `<button type="button" class="lpe-drawer-mobtab ${isAct ? 'active' : ''}" data-rail-tab="${esc(t.id)}" title="${esc(t.title)}">
                ${t.glyph ? `<span class="lpe-ornament">${esc(t.glyph)}</span>` : `<i class="fa-solid ${esc(t.icon)}"></i>`}
                <span>${esc(t.title.split(' ')[0])}</span>
            </button>`;
        }).join(''));
    }

    function openDrawer(railTabId = railState.activeRailTab, { persist = true } = {}) {
        if (!$('#lpe_rail').length || !$('#lpe_drawer').length) {
            mount({ restoreDrawer: false });
        }
        const def = getRailTabDef(railTabId);
        railState.activeRailTab = def.id;
        railState.drawerOpen = true;
        railState.railCollapsed = false;
        activeTab = resolveRailSubAppTab(def.id);
        if (persist) saveRailState();

        if (isOpen()) {
            disposeWebgl();
            $('#lpe_app_stage').off('click change input').empty();
            $('#lpe_app_overlay').hide();
        }

        buildDrawerHeaderMeta();
        $('#lpe_drawer').addClass('is-open').attr('aria-hidden', 'false');
        syncChrome();
        renderActiveTab({ resetScroll: true });
    }

    function closeDrawer({ persist = true } = {}) {
        const $dr = $('#lpe_drawer');
        if (!$dr.length) return;
        disposeWebgl();
        $dr.removeClass('is-open').attr('aria-hidden', 'true');
        $('#lpe_drawer_stage').off('click change input').empty();
        railState.drawerOpen = false;
        if (persist) saveRailState();
        syncChrome();
    }

    function setRailCollapsed(collapsed) {
        railState.railCollapsed = collapsed;
        if (collapsed && isDrawerOpen()) {
            closeDrawer({ persist: false });
        } else {
            syncChrome();
        }
        saveRailState();
        const winW = typeof window !== 'undefined' ? (window.innerWidth || 1280) : 1280;
        if (collapsed) {
            if ($('#lpe_rail_expand_btn').prop('hidden')) {
                $('#lpe_fab_btn')[0]?.focus({ preventScroll: true });
            }
        } else if (winW >= 1000) {
            $('#lpe_rail_collapse_btn')[0]?.focus({ preventScroll: true });
        } else {
            $('#lpe_fab_btn')[0]?.focus({ preventScroll: true });
        }
    }

    function toggleDrawer(railTabId = null) {
        if (railTabId && isDrawerOpen() && railState.activeRailTab === railTabId) {
            closeDrawer();
            return;
        }
        if (!railTabId && isDrawerOpen()) {
            closeDrawer();
            return;
        }
        openDrawer(railTabId || railState.activeRailTab);
    }

    function buildDockHtml() {
        const topItems = APP_TABS.filter((t) => !t.group && !t.bottom);
        const bottomItems = APP_TABS.filter((t) => t.bottom);
        const dockItem = (t) => `
            <button type="button" class="lpe-dock-item ${t.id === activeTab ? 'active' : ''}" data-tab="${esc(t.id)}" title="${esc(t.title)}">
                <i class="fa-solid ${esc(t.icon)}"></i>
                <span>${esc(t.title)}</span>
            </button>
        `;

        const parts = [...topItems.map(dockItem)];
        for (const g of APP_DOCK_GROUPS) {
            parts.push(`<div class="lpe-dock-label"><span>${esc(g.title)}</span></div>`);
            for (const t of APP_TABS) {
                if (t.group === g.id) parts.push(dockItem(t));
            }
        }
        parts.push('<div class="lpe-dock-spacer"></div>');
        parts.push('<div class="lpe-dock-label lpe-dock-label-util"><span>Utilities</span></div>');
        parts.push(...bottomItems.map(dockItem));
        return parts.join('');
    }

    function mount({ restoreDrawer = true } = {}) {
        if (!$('#lpe_chrome_controls').length) {
            $('body').append(`
                <div id="lpe_chrome_controls">
                    <button type="button" id="lpe_topbar_toggle" class="lpe-tail" aria-controls="top-bar top-settings-holder" aria-expanded="true" aria-label="Collapse SillyTavern top bar" hidden>
                        <i class="lpe-tail-icon fa-solid fa-chevron-up" aria-hidden="true"></i>
                        <span id="lpe_topbar_tail_label" class="lpe-tail-label" aria-hidden="true">Hide top bar</span>
                    </button>
                    <button type="button" id="lpe_rail_expand_btn" class="lpe-tail" aria-controls="lpe_rail lpe_drawer lpe_fab_btn" aria-expanded="true" aria-label="Collapse LPE side rail" hidden>
                        <i class="lpe-tail-icon fa-solid fa-chevron-right" aria-hidden="true"></i>
                        <span id="lpe_rail_tail_label" class="lpe-tail-label" aria-hidden="true">Hide LPE rail</span>
                    </button>
                </div>
            `);
        }
        if (!$('#lpe_fab_btn').length) {
            $('body').append(`
                <button type="button" id="lpe_fab_btn" title="Lapis Philosophorum Engine (LPE) — Toggle Inspector" aria-label="Toggle LPE Inspector">
                    <span class="lpe-fab-glyph lpe-ornament" aria-hidden="true">✦</span>
                </button>
            `);
        }

        if (!$('#lpe_rail').length) {
            $('body').append(`
                <aside id="lpe_rail" class="lpe-rail" aria-label="LPE Quick Rail"></aside>
            `);
        }

        if (!$('#lpe_drawer').length) {
            $('body').append(`
                <section id="lpe_drawer" class="lpe-drawer" aria-label="LPE Frosted Inspector Drawer" aria-hidden="true">
                    <header class="lpe-drawer-head">
                        <div class="lpe-drawer-title-wrap">
                            <span class="lpe-ornament lpe-drawer-star" aria-hidden="true">✦</span>
                            <h3 id="lpe_drawer_title">Overview</h3>
                            <span id="lpe_drawer_ct_pill" class="lpe-pill lpe-tabular">ct:0</span>
                        </div>
                        <div class="lpe-drawer-head-actions">
                            <button type="button" id="lpe_drawer_expand" class="lpe-mini-btn lpe-drawer-hdr-btn" title="Expand into Full Control Center"><i class="fa-solid fa-expand"></i><span> Full</span></button>
                            <button type="button" id="lpe_drawer_close" class="lpe-mini-btn lpe-drawer-hdr-btn" title="Close Drawer" aria-label="Close Drawer"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    </header>
                    <div id="lpe_drawer_mobile_tabs" class="lpe-drawer-mobile-tabs" aria-label="Mobile Rail Tabs"></div>
                    <div id="lpe_drawer_subpills" class="lpe-drawer-subpills" style="display:none;"></div>
                    <div id="lpe_drawer_stage" class="lpe-drawer-stage"></div>
                </section>
            `);
        }

        if (!$('#lpe_app_overlay').length) {
            $('body').append(`
                <div id="lpe_app_overlay" role="dialog" aria-modal="true" aria-label="Lapis Philosophorum Engine Control Center">
                    <div class="lpe-app-window">
                        <nav class="lpe-app-dock" id="lpe_app_dock" aria-label="LPE Control Center Navigation"></nav>
                        <div class="lpe-app-main">
                            <header class="lpe-hero" id="lpe_app_hero">
                                <div class="lpe-hero-bg" id="lpe_hero_bg"></div>
                                <div class="lpe-hero-overlay"></div>
                                <div class="lpe-topbar">
                                    <div class="lpe-app-actions">
                                        <div id="lpe_app_tokens" class="lpe-token-pill" title="Estimated state snapshot tokens">
                                            <i class="fa-solid fa-microchip"></i> ~0 tok · ct:0
                                        </div>
                                        <div id="lpe_app_worker_pill" class="lpe-worker-pill" style="display:none;">
                                            <i class="fa-solid fa-spinner fa-spin"></i>
                                            <span id="lpe_app_worker_lbl">Working</span>
                                            <button type="button" id="lpe_app_stop_btn" class="lpe-mini-stop" title="Stop worker"><i class="fa-solid fa-stop"></i></button>
                                        </div>
                                        <button type="button" id="lpe_app_power" class="lpe-app-btn secondary" title="Toggle Lapis Philosophorum Engine on/off">
                                            <i class="fa-solid fa-power-off"></i> <span>On</span>
                                        </button>
                                        <button type="button" id="lpe_app_reread" class="lpe-app-btn secondary" title="Re-run LPE Clerk on latest AI reply">
                                            <i class="fa-solid fa-rotate"></i> <span>Re-read</span>
                                        </button>
                                        <button type="button" id="lpe_app_close" class="lpe-app-btn primary" title="Save &amp; Close">
                                            <i class="fa-solid fa-floppy-disk"></i> <span>Save &amp; Close</span>
                                        </button>
                                    </div>
                                </div>
                                <div class="lpe-hero-meta">
                                    <div class="lpe-hero-kicker" id="lpe_hero_kicker">LAPIS PHILOSOPHORUM ENGINE</div>
                                    <h2 class="lpe-hero-name" id="lpe_hero_name">Lapis Philosophorum Engine (LPE)</h2>
                                </div>
                            </header>
                            <div class="lpe-app-stage" id="lpe_app_stage"></div>
                        </div>
                    </div>
                </div>
            `);
        }

        const $overlay = $('#lpe_app_overlay');
        $('#lpe_app_dock').html(buildDockHtml());
        const $rail = $('#lpe_rail');
        $rail.html(buildRailHtml());
        const $drawer = $('#lpe_drawer');
        buildDrawerHeaderMeta();

        $('#lpe_topbar_toggle').off('.lpeChrome').on('click.lpeChrome', () => {
            railState.topBarCollapsed = !railState.topBarCollapsed;
            saveRailState();
            syncChrome();
        });
        const $railTail = $('#lpe_rail_expand_btn');
        bindRailDrag($railTail, $railTail, { tail: true });
        bindRailDrag($('#lpe_rail_drag_handle'), $rail);
        $rail.off('.lpeRail');
        $rail.on('click.lpeRail', '#lpe_rail_collapse_btn', () => {
            setRailCollapsed(true);
        });
        $rail.on('click.lpeRail', '.lpe-rail-item', function () {
            const tabId = String($(this).data('rail-tab') || 'overview');
            toggleDrawer(tabId);
        });
        $rail.on('click.lpeRail', '#lpe_rail_modal_btn', () => {
            open({ tab: resolveRailSubAppTab(railState.activeRailTab) });
        });

        $drawer.off('.lpeDrawer');
        $drawer.on('change.lpeDrawer', '#lpe_drawer_font_sel', function (e) {
            const rawVal = e?.target?.value ?? ($(this).length && typeof $(this).val === 'function' ? $(this).val() : $('#lpe_drawer_font_sel').val());
            getSettings().readingFont = resolveLpeFont(rawVal).id;
            notifySettingsChanged();
            if (activeTab === 'appearance') renderActiveTab({ resetScroll: false });
        });
        $drawer.on('click.lpeDrawer', '#lpe_drawer_close', () => closeDrawer());
        $drawer.on('click.lpeDrawer', '#lpe_drawer_expand', () => {
            const appTab = resolveRailSubAppTab(railState.activeRailTab);
            closeDrawer({ persist: false });
            open({ tab: appTab });
        });
        $drawer.on('click.lpeDrawer', '.lpe-drawer-subpill', function () {
            const subId = String($(this).data('drawer-sub') || 'overview');
            railState.drawerSubTabs[railState.activeRailTab] = subId;
            activeTab = subId;
            saveRailState();
            buildDrawerHeaderMeta();
            renderActiveTab({ resetScroll: true });
        });
        $drawer.on('click.lpeDrawer', '.lpe-drawer-mobtab', function () {
            const tabId = String($(this).data('rail-tab') || 'overview');
            openDrawer(tabId);
        });

        $overlay.off('.lpeApp');
        $overlay.on('change.lpeApp', '#lpe_app_font_sel', function (e) {
            const rawVal = e?.target?.value ?? ($(this).length && typeof $(this).val === 'function' ? $(this).val() : $('#lpe_app_font_sel').val());
            getSettings().readingFont = resolveLpeFont(rawVal).id;
            notifySettingsChanged();
            if (activeTab === 'appearance') renderActiveTab({ resetScroll: false });
        });
        $overlay.on('click.lpeApp', (e) => {
            if (e.target === $overlay[0]) close();
        });
        $overlay.on('click.lpeApp', '#lpe_app_close', () => close());
        $overlay.on('click.lpeApp', '#lpe_app_power', () => {
            const s = getSettings();
            s.enabled = !s.enabled;
            notifySettingsChanged();
        });
        $overlay.on('click.lpeApp', '#lpe_app_reread', () => {
            onRereadLast?.();
            syncChrome();
        });
        $overlay.on('click.lpeApp', '#lpe_app_stop_btn', (e) => {
            e.stopPropagation();
            workerClient?.stopAll?.();
            syncChrome();
        });
        $overlay.on('click.lpeApp', '.lpe-dock-item', function () {
            const tabId = String($(this).data('tab') || 'overview');
            if (tabId !== activeTab) {
                activeTab = tabId;
                updateDockActive();
                renderActiveTab({ resetScroll: true });
            }
        });

        $(document).off('keydown.lpeApp').on('keydown.lpeApp', (e) => {
            if (e.key === 'Escape') {
                if (isOpen()) close();
                else if (isDrawerOpen()) closeDrawer();
            }
        });

        initFabDrag();
        syncChrome();
        if (restoreDrawer && !railDrawerRestoredOnce) {
            railDrawerRestoredOnce = true;
            if (railState.drawerOpen && getSettings().showLauncherButton !== false) {
                openDrawer(railState.activeRailTab, { persist: false });
            }
        }
    }

    function updateDockActive() {
        $('#lpe_app_dock .lpe-dock-item').each(function () {
            $(this).toggleClass('active', String($(this).data('tab')) === activeTab);
        });
    }

    function syncChrome() {
        const s = getSettings();
        applyReadingFontVars();
        const activeFontId = resolveLpeFont(s?.readingFont).id;
        for (const selId of ['#lpe_drawer_font_sel', '#lpe_app_font_sel']) {
            const $sel = $(selId);
            if ($sel.length && typeof $sel.val === 'function') $sel.val(activeFontId);
        }
        const ws = getWorkerStatus?.() || { busy: false };
        const showLauncher = s.showLauncherButton !== false;
        const winW = typeof window !== 'undefined' ? (window.innerWidth || 1280) : 1280;
        const isDesktop = winW >= 1000;
        const { railCollapsed, topBarCollapsed } = railState;
        const railVisible = showLauncher && isDesktop && !railCollapsed;
        const drawerOpen = isDrawerOpen();

        const $topbarToggle = $('#lpe_topbar_toggle');
        const topbarLabel = topBarCollapsed ? 'Restore SillyTavern top bar' : 'Collapse SillyTavern top bar';
        $topbarToggle.prop('hidden', !showLauncher && !topBarCollapsed)
            .attr({ 'aria-expanded': String(!topBarCollapsed), 'aria-label': topbarLabel });
        $('#lpe_topbar_tail_label').text(topBarCollapsed ? 'Show top bar' : 'Hide top bar');

        const railLabel = railCollapsed ? (isDesktop ? 'Restore LPE side rail' : 'Restore LPE launcher') : 'Collapse LPE side rail';
        $('#lpe_rail_expand_btn').prop('hidden', !showLauncher || !railCollapsed)
            .attr({ 'aria-expanded': String(!railCollapsed), 'aria-label': railLabel });
        $('#lpe_rail_tail_label').text(railCollapsed ? (isDesktop ? 'Show LPE rail' : 'Show LPE launcher') : 'Hide LPE rail');
        $('#lpe_rail_collapse_btn').prop('hidden', !showLauncher || !isDesktop || railCollapsed)
            .attr('aria-label', 'Collapse LPE side rail');

        $('body')
            .toggleClass('lpe-topbar-collapsed', Boolean($topbarToggle.length && topBarCollapsed))
            .toggleClass('lpe-rail-collapsed', railCollapsed)
            .toggleClass('lpe-drawer-open', showLauncher && isDesktop && !railCollapsed && drawerOpen);
        syncRailDock();

        const $fab = $('#lpe_fab_btn');
        if ($fab.length) {
            $fab.css('display', showLauncher && !railCollapsed ? '' : 'none');
            $fab.toggleClass('lpe-fab-hidden-by-rail', railVisible);
            $fab.toggleClass('lpe-fab-off', !s.enabled);
            $fab.toggleClass('lpe-fab-busy', Boolean(ws.busy));
            $fab.toggleClass('is-drawer-open', drawerOpen);
        }

        const st = activeState();
        const ct = st?.world?.ct ?? 0;

        let tok = 0;
        if (store?.hasState?.()) {
            const xml = serializeInternalStates(st, {
                scoped: s.scoped !== false,
                recentText: getRecentStoryText?.() || '',
                includeVent: false,
            });
            tok = estimateTokenCount(xml);
        }

        const $rail = $('#lpe_rail');
        if ($rail.length) {
            $rail.prop('hidden', !railVisible);
            $rail.toggleClass('is-off', !s.enabled);
            $rail.toggleClass('is-busy', Boolean(ws.busy));
            $rail.find('.lpe-rail-item').each(function () {
                const tid = String($(this).data('rail-tab') || '');
                $(this).toggleClass('active', tid === railState.activeRailTab && drawerOpen);
            });
            const effH = hasExplicitHealthData(st?.health)
                ? normalizeHealthState({ ...st.health, bodyType: st.health?.bodyType || s.defaultBodyType || 'male' })
                : inferHealthFromStatusText(st?.inv?.status || '', s.defaultBodyType || 'male');
            const hm = computeHealthMetrics(effH);
            const hasAlert = hm.totalWounds > 0 || hm.bloodLoss > 0 || hm.missingCount > 0;
            $('#lpe_rail_health_dot').toggle(hasAlert).toggleClass('bleeding', hm.bleedingCount > 0);
            const $dot = $('#lpe_rail_status_dot');
            $dot.toggleClass('busy', Boolean(ws.busy)).toggleClass('off', !s.enabled).toggleClass('ok', Boolean(s.enabled && !ws.busy));
            $dot.attr('title', ws.busy ? `${ws.runningLabel || 'LPE Clerk working'} · ct:${ct}` : (!s.enabled ? 'LPE Disabled' : `Synced · ~${tok} tok · ct:${ct}`));
        }

        const $drawer = $('#lpe_drawer');
        if ($drawer.length) {
            $('#lpe_drawer_ct_pill').html(`<span class="lpe-tabular">~${tok} tok · ct:${esc(ct)}</span>`);
            if (!showLauncher && drawerOpen) closeDrawer({ persist: false });
        }

        const $ov = $('#lpe_app_overlay');
        if (!$ov.length) return;

        const ctx = getContextSafe?.() || {};
        const banner = getCharacterBannerInfo(ctx);

        const $bg = $('#lpe_hero_bg');
        if ($bg.length) {
            if (banner.imageUrl) {
                $bg.css('background-image', `url("${banner.imageUrl.replace(/"/g, '\\"')}")`).removeClass('lpe-hero-noimg');
            } else {
                $bg.css('background-image', '').addClass('lpe-hero-noimg');
            }
        }
        $('#lpe_hero_kicker').text(`${banner.subtitle} · CT ${ct}`);
        $('#lpe_hero_name').text(banner.name);

        const $pwr = $('#lpe_app_power');
        if ($pwr.length) {
            $pwr.toggleClass('lpe-power-on', Boolean(s.enabled)).toggleClass('lpe-power-off', !s.enabled);
            $pwr.html(`<i class="fa-solid fa-power-off"></i> <span>${s.enabled ? 'On' : 'Off'}</span>`);
        }

        const $wp = $('#lpe_app_worker_pill');
        if ($wp.length) {
            if (ws.busy) {
                $('#lpe_app_worker_lbl').text(ws.runningLabel || 'Updating');
                $wp.css('display', 'inline-flex');
            } else {
                $wp.hide();
            }
        }

        const $tok = $('#lpe_app_tokens');
        if ($tok.length) {
            $tok.html(`<i class="fa-solid fa-microchip"></i> <span class="lpe-tabular">~${tok} tok · ct:${esc(ct)}</span>`);
        }
    }

    function open({ tab = null, sub = null, seq = null, mesId = null, charName = null, castMode: nextCastMode = null } = {}) {
        if (!$('#lpe_app_overlay').length) {
            mount({ restoreDrawer: false });
        }
        closeDrawer({ persist: false });
        if (tab && APP_TABS.some((t) => t.id === tab)) {
            activeTab = tab;
            railState.activeRailTab = findRailTabForAppTab(tab);
        }
        if (sub && activeTab in subTabs) {
            subTabs[activeTab] = sub;
        }
        if (typeof charName === 'string' && charName.trim()) {
            activeTab = 'cast';
            railState.activeRailTab = findRailTabForAppTab('cast');
            subTabs.cast = 'entities';
            castMode = 'edit';
            editingCharName = charName.trim();
            editorDraft = null;
            editorRemovedBondTargets = [];
        } else if (nextCastMode === 'import' || nextCastMode === 'edit' || nextCastMode === 'list') {
            if (nextCastMode !== 'list') {
                activeTab = 'cast';
                railState.activeRailTab = findRailTabForAppTab('cast');
            }
            castMode = nextCastMode;
            if (nextCastMode === 'edit') {
                editingCharName = '';
                editorDraft = null;
                editorRemovedBondTargets = [];
            }
        }
        inspectSeq = typeof seq === 'number' ? seq : null;
        inspectMesId = typeof mesId === 'number' ? mesId : null;

        updateDockActive();
        syncChrome();
        $('#lpe_app_overlay').css('display', 'flex');
        renderActiveTab({ resetScroll: true });
    }

    function close() {
        disposeWebgl();
        $('#lpe_app_stage').off('click change input').empty();
        $('#lpe_app_overlay').hide();
        saveSettings?.();
        syncChrome();
    }

    function refresh() {
        syncChrome();
        if (!isOpen() && !isDrawerOpen()) return;
        const activeEl = document.activeElement;
        const $stage = isOpen() ? $('#lpe_app_stage') : $('#lpe_drawer_stage');
        if (activeEl && $stage.length && $stage[0].contains(activeEl) && /^(INPUT|TEXTAREA|SELECT)$/i.test(activeEl.tagName)) {
            return;
        }
        renderActiveTab({ resetScroll: false });
    }

    function historyBannerHtml(state) {
        if (typeof inspectSeq !== 'number') return '';
        return `
            <div class="lpe-banner warn">
                <i class="fa-solid fa-clock-rotate-left"></i>
                <span>Viewing historical snapshot at <b>ct:${esc(state.world?.ct ?? 0)}</b>${inspectMesId !== null ? ` (Message #${esc(inspectMesId)})` : ''}. Saving any edit applies forward as a user override.</span>
                <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_pop_go_live">Switch to Live State</button>
            </div>
        `;
    }

    function tabMeta(id) {
        return APP_TABS.find((t) => t.id === id) || APP_TABS[0];
    }

    function renderOverviewTab($stage, state, settings, ws) {
        const meta = tabMeta('overview');
        const w = state.world || {};
        const has = store?.hasState?.();
        const badge = ws.busy
            ? `<span class="lpe-head-badge warm"><i class="fa-solid fa-spinner fa-spin"></i> ${esc(ws.runningLabel || 'Updating')}</span>`
            : has
                ? `<span class="lpe-head-badge ok"><i class="fa-solid fa-circle-check"></i> Tracked · ct:${esc(w.ct ?? 0)}</span>`
                : `<span class="lpe-head-badge"><i class="fa-solid fa-circle"></i> Turn 1 Pending</span>`;

        const ovHealth = hasExplicitHealthData(state.health)
            ? normalizeHealthState({ ...state.health, bodyType: state.health?.bodyType || settings.defaultBodyType || 'male' })
            : inferHealthFromStatusText(state.inv?.status || '', settings.defaultBodyType || state.health?.bodyType || 'male');
        const ovHealthMetrics = computeHealthMetrics(ovHealth);

        const stats = [
            ['Turn (ct)', w.ct ?? 0],
            ['Health', `${ovHealthMetrics.overallHp}%${ovHealthMetrics.totalWounds ? ` (${ovHealthMetrics.totalWounds}w)` : ''}`],
            ['On-Screen', (state.onscreen || []).length],
            ['Off-Screen', (state.offscreen_agendas || []).length],
            ['Atlas Rooms', (state.locations?.rooms || []).length],
            ['Entities', (state.entity_state || []).length],
            ['Chekhov', `${(state.chekhov?.chamber || []).length}/${(state.chekhov?.locked || []).length}`],
            ['Notebook', (state.notebook || []).length],
            ['Custom Trackers', `${(state.custom_trackers || []).filter((t) => t && !t.archived).length}${(state.tracker_proposals || []).length ? ` (+${state.tracker_proposals.length})` : ''}`],
        ];

        $stage.html(`
            ${renderPageHeader({ ...meta, badgeHtml: badge })}
            ${historyBannerHtml(state)}
            <div class="lpe-stat-grid">
                ${stats.map(([k, v]) => `<div class="lpe-stat-chip"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
            </div>
            <div class="lpe-glass-card lpe-pregame-callout">
                <div class="lpe-card-head">
                    <div>
                        <div class="lpe-card-title"><span class="lpe-ornament" aria-hidden="true">✦</span> Pre-Game Cast &amp; Roster Setup</div>
                        <div class="lpe-card-sub">Stage an established cast, bonds, and locations before Turn 1 — or tune any character anytime to prevent AI name slop.</div>
                    </div>
                    <div class="lpe-inline-actions">
                        <button type="button" class="lpe-app-btn secondary" id="lpe_pop_overview_batch_import"><i class="fa-solid fa-file-import"></i> Batch Import Cast</button>
                        <button type="button" class="lpe-app-btn secondary" id="lpe_pop_overview_open_cast"><i class="fa-solid fa-masks-theater"></i> Manage Cast</button>
                    </div>
                </div>
            </div>
            <div class="lpe-glass-card">
                <div class="lpe-card-head">
                    <div>
                        <div class="lpe-card-title">Scene &amp; World Environment</div>
                        <div class="lpe-card-sub">Edit current scene metadata or click Save World Changes to record a persistent state override.</div>
                    </div>
                    <button type="button" class="lpe-app-btn primary" id="lpe_pop_save_world"><i class="fa-solid fa-floppy-disk"></i> Save World Changes</button>
                </div>
                <div class="lpe-form-grid">
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Turn (ct)</label>
                        <input type="number" class="lpe-app-input" data-pop-w="ct" value="${esc(w.ct ?? 0)}" />
                    </div>
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Pacing</label>
                        <div class="lpe-seg" id="lpe_pop_pacing_seg">
                            ${['SLOW', 'FLOW', 'PUSH'].map((p) => `<button type="button" class="${w.pacing === p ? 'on' : ''}" data-pacing="${p}">${p}</button>`).join('')}
                        </div>
                    </div>
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Location</label>
                        <input type="text" class="lpe-app-input" data-pop-w="loc" value="${esc(w.loc)}" />
                    </div>
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Time</label>
                        <input type="text" class="lpe-app-input" data-pop-w="time" value="${esc(w.time)}" />
                    </div>
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Date</label>
                        <input type="text" class="lpe-app-input" data-pop-w="date" value="${esc(w.date)}" />
                    </div>
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Weather</label>
                        <input type="text" class="lpe-app-input" data-pop-w="weather" value="${esc(w.weather)}" />
                    </div>
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">User Position [x,y]</label>
                        <input type="text" class="lpe-app-input" data-pop-w="user_pos" value="${esc(w.user_pos)}" />
                    </div>
                    <div class="lpe-field-col wide">
                        <label class="lpe-field-lbl">Room Details</label>
                        <textarea class="lpe-app-input" rows="2" data-pop-w="room">${esc(w.room)}</textarea>
                    </div>
                    <div class="lpe-field-col wide">
                        <label class="lpe-field-lbl">Entries / Exits</label>
                        <textarea class="lpe-app-input" rows="2" data-pop-w="entries">${esc(w.entries)}</textarea>
                    </div>
                    <div class="lpe-field-col wide">
                        <label class="lpe-field-lbl">Obstacles</label>
                        <textarea class="lpe-app-input" rows="2" data-pop-w="obstacles">${esc(w.obstacles)}</textarea>
                    </div>
                    <div class="lpe-field-col wide">
                        <label class="lpe-field-lbl">Audio / Occlusion</label>
                        <textarea class="lpe-app-input" rows="2" data-pop-w="audio">${esc(w.audio)}</textarea>
                    </div>
                </div>
            </div>
        `);

        let selectedPacing = w.pacing || 'FLOW';
        $stage.find('#lpe_pop_pacing_seg').on('click', 'button', function () {
            selectedPacing = String($(this).data('pacing') || 'FLOW');
            $(this).siblings().removeClass('on');
            $(this).addClass('on');
        });
        $stage.on('click', '#lpe_pop_overview_batch_import', () => {
            activeTab = 'cast';
            castMode = 'import';
            updateDockActive();
            renderActiveTab({ resetScroll: true });
        });
        $stage.on('click', '#lpe_pop_overview_open_cast', () => {
            activeTab = 'cast';
            castMode = 'list';
            updateDockActive();
            renderActiveTab({ resetScroll: true });
        });
        $stage.find('#lpe_pop_save_world').on('click', () => {
            const draft = cloneState(state);
            draft.world.ct = parseInt($stage.find('[data-pop-w="ct"]').val(), 10) || 0;
            draft.world.pacing = selectedPacing;
            for (const k of ['loc', 'time', 'date', 'weather', 'user_pos', 'room', 'entries', 'obstacles', 'audio']) {
                draft.world[k] = String($stage.find(`[data-pop-w="${k}"]`).val() ?? '');
            }
            commitEditedState(draft, 'Saved World State changes.');
        });
    }

    function renderAtlasPopupTab($stage, state, settings) {
        const meta = tabMeta('atlas');
        const mgr = libMgr();
        const mlCfg = mgr.getConfig();
        const colInfo = mgr.getEffectiveCollection();
        const activeCollectionLabel = formatCollectionLabel(colInfo.effective, mlCfg.cachedManifest?.collections);
        const installedExternalShapes = mgr.getActiveCustomShapes()
            .filter((sh) => !POLY_PREFABS.includes(sh) && !POLY_SHAPES.includes(sh));
        const installedForCollection = mgr.getCatalog({
            collectionFilter: colInfo.effective === 'default' ? 'all' : colInfo.effective,
            statusFilter: 'installed',
        }).items.filter((it) => !it.bundled);
        const externalCreditSummary = colInfo.effective !== 'default' && installedForCollection.length
            ? installedForCollection.slice(0, 3).map((it) => `${it.name} (${it.author} · ${it.license})`).join('; ')
                + (installedForCollection.length > 3 ? ` +${installedForCollection.length - 3} more` : '')
            : '';

        const allRooms = state.locations?.rooms || [];
        const roomCount = allRooms.length;
        const mapCount = state.locations?.map_index?.maps?.length || 0;
        const activeObjRoomId = (atlasView.roomId && allRooms.some((r) => r.id === atlasView.roomId))
            ? atlasView.roomId
            : (allRooms[0]?.id || '');

        const roomOptsHtml = allRooms.length
            ? allRooms.map((r) => `<option value="${esc(r.id)}" ${r.id === activeObjRoomId ? 'selected' : ''}>${esc(r.name || r.id)} (${esc(r.id)})</option>`).join('')
            : '<option value="">-- No rooms yet --</option>';
        const shapeOptsHtml = `
            <optgroup label="Diorama &amp; Textured 3D Prefabs (${POLY_PREFABS.length})">
                ${POLY_PREFABS.map((sh) => `<option value="${esc(sh)}">${esc(sh)}</option>`).join('')}
            </optgroup>
            ${installedExternalShapes.length ? `
                <optgroup label="Installed External Models (${installedExternalShapes.length})">
                    ${installedExternalShapes.map((sh) => `<option value="${esc(sh)}">${esc(sh)}</option>`).join('')}
                </optgroup>
            ` : ''}
            <optgroup label="Geometric Primitives (${POLY_SHAPES.length})">
                ${POLY_SHAPES.map((sh) => `<option value="${esc(sh)}">${esc(sh)}</option>`).join('')}
            </optgroup>
        `;
        const matDatalistHtml = Object.keys(POLY_MATERIALS).map((m) => `<option value="${esc(m)}">`).join('');

        $stage.html(`
            ${renderPageHeader({
                ...meta,
                badgeHtml: `
                    <div class="lpe-inline-actions" style="gap:6px;">
                        <span class="lpe-head-badge ok lpe-tabular">${mapCount} map${mapCount === 1 ? '' : 's'} · ${roomCount} room${roomCount === 1 ? '' : 's'}</span>
                        <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_pop_open_models_btn" title="Browse 3D Model Library &amp; change collection for this card">
                            <i class="fa-solid fa-cubes"></i> ${esc(activeCollectionLabel)}
                        </button>
                    </div>
                `,
            })}
            ${historyBannerHtml(state)}
            <div class="lpe-glass-card">
                <div class="lpe-atlas-mount" id="lpe_pop_atlas_mount"></div>
            </div>
            <details class="lpe-glass-card lpe-fold-card">
                <summary class="lpe-fold-summary"><i class="fa-solid fa-cubes"></i> Add / Remove 3D Object (PolyCSS)</summary>
                <div class="lpe-fold-body">
                    <div class="lpe-form-grid">
                        <label>Target Room
                            <select id="lpe_pop_obj_room" class="lpe-app-input">${roomOptsHtml}</select>
                        </label>
                        <label>Shape Primitive
                            <select id="lpe_pop_obj_shape" class="lpe-app-input">${shapeOptsHtml}</select>
                        </label>
                        <label>Label
                            <input id="lpe_pop_obj_label" type="text" class="lpe-app-input" placeholder="e.g. Oak Table" />
                        </label>
                        <label>Material / Hex Color
                            <input id="lpe_pop_obj_color" type="text" list="lpe_pop_mat_list" class="lpe-app-input" value="wood" placeholder="wood, stone, fire, #e6b44c" />
                            <datalist id="lpe_pop_mat_list">${matDatalistHtml}</datalist>
                        </label>
                        <label>Local Pos [x,y,z] (m)
                            <input id="lpe_pop_obj_pos" type="text" class="lpe-app-input lpe-mono" value="3,3,0" placeholder="x,y,z" />
                        </label>
                        <label>Size [w,d,h] (m)
                            <input id="lpe_pop_obj_size" type="text" class="lpe-app-input lpe-mono" value="1.8,1.2,1.0" placeholder="w,d,h" />
                        </label>
                        <label>Rotation Z (deg)
                            <input id="lpe_pop_obj_rot" type="number" class="lpe-app-input" value="0" step="15" />
                        </label>
                    </div>
                    <div class="lpe-inline-actions" style="margin-top:8px;">
                        <span class="lpe-err-text" id="lpe_pop_obj_err"></span>
                        <button type="button" class="lpe-app-btn primary" id="lpe_pop_add_obj" ${allRooms.length ? '' : 'disabled'}><i class="fa-solid fa-plus"></i> Add 3D Object</button>
                    </div>
                    <div id="lpe_pop_obj_list" style="margin-top:10px;"></div>
                </div>
            </details>
            <details class="lpe-glass-card lpe-fold-card">
                <summary class="lpe-fold-summary"><i class="fa-solid fa-code"></i> Edit Atlas JSON (auto-recomputes room bbox)</summary>
                <div class="lpe-fold-body">
                    <textarea id="lpe_pop_atlas_json" class="lpe-app-input lpe-mono" rows="12">${esc(JSON.stringify(state.locations || emptyState().locations, null, 2))}</textarea>
                    <div class="lpe-inline-actions">
                        <span class="lpe-err-text" id="lpe_pop_atlas_err"></span>
                        <button type="button" class="lpe-app-btn primary" id="lpe_pop_save_atlas"><i class="fa-solid fa-floppy-disk"></i> Save Atlas</button>
                    </div>
                </div>
            </details>
        `);

        const $mount = $stage.find('#lpe_pop_atlas_mount');
        applyThemeVarsToEl($mount, settings.hudTheme || 'Magnum Opus');

        function refreshObjList(roomId) {
            const targetRoom = allRooms.find((r) => r.id === roomId);
            const objs = Array.isArray(targetRoom?.objects) ? targetRoom.objects : [];
            const $list = $stage.find('#lpe_pop_obj_list');
            if (!targetRoom) {
                $list.html('');
                return;
            }
            if (!objs.length) {
                $list.html(`<div class="lpe-muted">No explicit 3D objects on <b>${esc(targetRoom.name || targetRoom.id)}</b> (auto-inferred from features).</div>`);
                return;
            }
            $list.html(`
                <div class="lpe-muted" style="margin-bottom:4px;">Explicit 3D objects in <b>${esc(targetRoom.name || targetRoom.id)}</b>:</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    ${objs.map((o) => `
                        <span class="lpe-pill">
                            [${esc(o.shape)}] ${esc(o.label)} [${esc((o.pos || []).join(','))}]
                            <button type="button" class="lpe-mini-btn lpe-pop-rm-obj" data-room-id="${esc(targetRoom.id)}" data-obj-label="${esc(o.label)}" title="Remove object" style="margin-left:4px;"><i class="fa-solid fa-xmark"></i></button>
                        </span>
                    `).join('')}
                </div>
            `);
        }

        function drawAtlas() {
            disposeWebgl();
            const effectiveMode = atlasView.mode || settings.atlasViewMode || 'webgl';
            const activeUserName = String(getContextSafe?.()?.name1 || getActiveUserName() || '').trim();
            const camKey = `${atlasView.mapId || state?.locations?.map_index?.active_map_id || ''}|${atlasView.allFloors ? 'all' : (atlasView.level ?? state?.locations?.map_index?.active_level ?? '0')}`;
            if (atlasView.webglCameraKey !== camKey) {
                atlasView.webglCamera = null;
                atlasView.webglCameraKey = camKey;
            }
            $mount.html(renderAtlasTab(state, {
                selectedMapId: atlasView.mapId,
                selectedLevel: atlasView.level,
                selectedRoomId: atlasView.roomId,
                viewMode: effectiveMode,
                allFloors: atlasView.allFloors,
                cutaway: atlasView.cutaway,
                showLabels: atlasView.showLabels,
                camera: atlasView.camera,
                svgCamera: atlasView.svgCamera,
                allowWebgl: true,
                fullScreen: isOpen(),
                userName: activeUserName,
                activeCollectionLabel,
                externalCreditSummary,
            }));
            if (effectiveMode === 'webgl') {
                const vpEl = $mount.find('.lpe-webgl-viewport')[0];
                if (vpEl) {
                    const mySeq = ++webglMountSeq;
                    import('./atlasWebgl.js').then(({ mountAtlasWebGLViewport }) => {
                        if (mySeq !== webglMountSeq || !isAnyUiOpen() || activeTab !== 'atlas' || !vpEl.isConnected) return;
                        activeWebglHandle = mountAtlasWebGLViewport(vpEl, state, {
                            selectedMapId: atlasView.mapId,
                            selectedLevel: atlasView.level,
                            selectedRoomId: atlasView.roomId,
                            allFloors: atlasView.allFloors,
                            cutaway: atlasView.cutaway,
                            showLabels: atlasView.showLabels,
                            camera: atlasView.webglCamera,
                            userName: activeUserName,
                            modelLibrary: mgr,
                            onCameraChange: (cam) => { atlasView.webglCamera = cam; },
                            onSelectRoom: (roomId) => {
                                atlasView.roomId = roomId;
                                if ($stage.find(`#lpe_pop_obj_room option[value="${roomId}"]`).length) {
                                    $stage.find('#lpe_pop_obj_room').val(roomId);
                                    refreshObjList(roomId);
                                }
                                drawAtlas();
                            },
                        });
                    }).catch(() => {});
                }
            } else if (effectiveMode === '3d') {
                const vpEl = $mount.find('.lpe-poly-viewport')[0];
                if (vpEl) {
                    bindPolyOrbitControls(vpEl, atlasView.camera, {
                        onSelectRoom: (roomId) => {
                            atlasView.roomId = roomId;
                            if ($stage.find(`#lpe_pop_obj_room option[value="${roomId}"]`).length) {
                                $stage.find('#lpe_pop_obj_room').val(roomId);
                                refreshObjList(roomId);
                            }
                            drawAtlas();
                        },
                    });
                }
            } else if (effectiveMode === '2d') {
                const svgWrapEl = $mount.find('.lpe-atlas-svg-wrap')[0];
                if (svgWrapEl) bindAtlasSvgControls(svgWrapEl, atlasView.svgCamera);
            }
        }
        drawAtlas();
        refreshObjList(activeObjRoomId);

        $mount.on('change', '.lpe-atlas-map-sel', function () {
            atlasView.mapId = String($(this).val() || '');
            atlasView.level = null;
            atlasView.roomId = null;
            atlasView.svgCamera = { zoom: 1, panX: 0, panY: 0 };
            atlasView.webglCamera = null;
            atlasView.webglCameraKey = null;
            drawAtlas();
        });
        $mount.on('click', '.lpe-atlas-floor-btn', function () {
            atlasView.level = String($(this).data('level'));
            atlasView.allFloors = false;
            atlasView.roomId = null;
            atlasView.svgCamera = { zoom: 1, panX: 0, panY: 0 };
            drawAtlas();
        });
        $mount.on('click', '.lpe-atlas-allfloors-btn', function () {
            atlasView.allFloors = !atlasView.allFloors;
            drawAtlas();
        });
        $mount.on('click', '.lpe-atlas-mode-btn', function () {
            atlasView.mode = String($(this).data('atlas-mode') || 'webgl');
            drawAtlas();
        });
        $mount.on('click', '.lpe-poly-cutaway-btn', function (e) {
            e.stopPropagation();
            atlasView.cutaway = !atlasView.cutaway;
            drawAtlas();
        });
        $mount.on('click', '.lpe-poly-labels-btn', function (e) {
            e.stopPropagation();
            atlasView.showLabels = !atlasView.showLabels;
            drawAtlas();
        });
        $mount.on('click', '.lpe-atlas-room-g, .lpe-atlas-room-pill', function () {
            const rid = String($(this).data('room-id') || '');
            atlasView.roomId = rid;
            if ($stage.find(`#lpe_pop_obj_room option[value="${rid}"]`).length) {
                $stage.find('#lpe_pop_obj_room').val(rid);
                refreshObjList(rid);
            }
            drawAtlas();
        });

        $stage.find('#lpe_pop_obj_room').on('change', function () {
            refreshObjList(String($(this).val() || ''));
        });

        $stage.on('click', '#lpe_pop_open_models_btn', () => {
            activeTab = 'models';
            railState.activeRailTab = findRailTabForAppTab('models');
            updateDockActive();
            if (isDrawerOpen()) {
                railState.drawerSubTabs[railState.activeRailTab] = 'models';
                buildDrawerHeaderMeta();
            }
            renderActiveTab({ resetScroll: true });
        });

        $stage.find('#lpe_pop_add_obj').on('click', () => {
            $('#lpe_pop_obj_err').text('');
            const rid = String($stage.find('#lpe_pop_obj_room').val() || '').trim();
            const draft = cloneState(state);
            const targetRoom = (draft.locations?.rooms || []).find((r) => r.id === rid);
            if (!targetRoom) {
                $('#lpe_pop_obj_err').text('Select a valid target room.');
                return;
            }
            const shape = String($stage.find('#lpe_pop_obj_shape').val() || 'box');
            const label = String($stage.find('#lpe_pop_obj_label').val() || '').trim() || shape;
            const color = String($stage.find('#lpe_pop_obj_color').val() || 'wood').trim();
            const posRaw = String($stage.find('#lpe_pop_obj_pos').val() || '2,2,0');
            const sizeRaw = String($stage.find('#lpe_pop_obj_size').val() || '1.8,1.2,1.0');
            const rot = Number($stage.find('#lpe_pop_obj_rot').val()) || 0;

            const obj = normalizeAtlasObject({ shape, label, color, pos: posRaw, size: sizeRaw, rot }, parseDimMeters(targetRoom.dim));
            targetRoom.objects = normalizeRoomObjects([...(targetRoom.objects || []), obj], parseDimMeters(targetRoom.dim));
            atlasView.roomId = rid;
            commitEditedState(draft, `Added 3D ${obj.shape} "${obj.label}" to ${targetRoom.name || rid}.`);
        });

        $stage.on('click', '.lpe-pop-rm-obj', function () {
            const rid = String($(this).data('room-id') || '');
            const lbl = String($(this).data('obj-label') || '').toLowerCase();
            const draft = cloneState(state);
            const targetRoom = (draft.locations?.rooms || []).find((r) => r.id === rid);
            if (!targetRoom || !Array.isArray(targetRoom.objects)) return;
            targetRoom.objects = targetRoom.objects.filter((o) => String(o.label || '').toLowerCase() !== lbl);
            commitEditedState(draft, `Removed 3D object "${lbl}".`);
        });

        $stage.find('#lpe_pop_save_atlas').on('click', () => {
            $('#lpe_pop_atlas_err').text('');
            try {
                const parsed = JSON.parse(String($stage.find('#lpe_pop_atlas_json').val() || '{}'));
                for (const r of parsed.rooms || []) {
                    const box = computeBbox(r.grid, r.dim);
                    if (box) r.bbox = box.str;
                }
                const draft = cloneState(state);
                draft.locations = parsed;
                commitEditedState(draft, 'Saved Atlas layout.');
            } catch (err) {
                $('#lpe_pop_atlas_err').text(`Invalid JSON: ${err.message}`);
            }
        });
    }

    function renderHealthPopupTab($stage, state, settings) {
        const meta = tabMeta('health');
        const explicit = hasExplicitHealthData(state.health);
        const effHealth = explicit
            ? normalizeHealthState({
                ...state.health,
                bodyType: state.health?.bodyType || settings.defaultBodyType || 'male',
            })
            : inferHealthFromStatusText(state.inv?.status || '', settings.defaultBodyType || state.health?.bodyType || 'male');
        const isInferred = !explicit && Boolean(effHealth.inferred);
        const metrics = computeHealthMetrics(effHealth);

        const activePartId = (healthView.selectedPart && BODY_PART_BY_ID[healthView.selectedPart])
            ? healthView.selectedPart
            : 'torso';
        const activePartRec = effHealth.parts?.[activePartId] || null;

        const partOptsHtml = BODY_PARTS.map((bp) =>
            `<option value="${esc(bp.id)}" ${bp.id === activePartId ? 'selected' : ''}>${esc(bp.label)} (${esc(bp.layer)})</option>`,
        ).join('');
        const kindOptsHtml = CONDITION_KINDS.map((k) =>
            `<option value="${esc(k)}">${esc(k.charAt(0).toUpperCase() + k.slice(1))}</option>`,
        ).join('');
        const wbOptsHtml = WHOLE_BODY_TYPES.map((t) =>
            `<option value="${esc(t)}">${esc(t.charAt(0).toUpperCase() + t.slice(1))}</option>`,
        ).join('');
        const bodyTypePills = BODY_TYPES.map((bt) =>
            `<button type="button" class="lpe-app-btn secondary lpe-btn-sm ${effHealth.bodyType === bt ? 'lpe-pop-bt-on' : ''}" data-body-type="${esc(bt)}">${esc(bt.charAt(0).toUpperCase() + bt.slice(1))}</button>`,
        ).join('');

        const badgeCls = metrics.bleedingCount > 0 || metrics.overallHp < 50 ? 'warm' : 'ok';
        const badgeText = `${metrics.overallHp}% HP · ${metrics.totalWounds} WOUND${metrics.totalWounds === 1 ? '' : 'S'}${metrics.bleedingCount ? ` · ${metrics.bleedingCount} BLEEDING` : ''}`;

        $stage.html(`
            ${renderPageHeader({ ...meta, badgeHtml: `<span class="lpe-head-badge ${badgeCls}">${esc(badgeText)}</span>` })}
            ${historyBannerHtml(state)}
            <div class="lpe-glass-card">
                <div class="lpe-card-head">
                    <div class="lpe-inline-actions" style="justify-content:flex-start;">
                        <span class="lpe-field-lbl" style="margin:0;">Silhouette:</span>
                        ${bodyTypePills}
                    </div>
                    <div class="lpe-inline-actions">
                        ${isInferred ? `<button type="button" class="lpe-app-btn gold lpe-btn-sm" id="lpe_pop_adopt_inferred" title="Save inferred injuries into canonical health state"><i class="fa-solid fa-wand-magic-sparkles"></i> Adopt Inferred</button>` : ''}
                        <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_pop_tend_all"><i class="fa-solid fa-bandage"></i> Tend All</button>
                        <button type="button" class="lpe-app-btn lpe-btn-heal lpe-btn-sm" id="lpe_pop_full_heal"><i class="fa-solid fa-heart"></i> Full Heal</button>
                    </div>
                </div>
                <div id="lpe_pop_health_doll_wrap">
                    ${renderHealthTab(state, {
                        layer: healthView.layer,
                        selectedPart: healthView.selectedPart,
                        bodyTypeOverride: settings.defaultBodyType,
                        compact: false,
                        showActions: true,
                    })}
                </div>
            </div>

            <div class="lpe-glass-card">
                <div class="lpe-card-head">
                    <div>
                        <div class="lpe-card-title">Add / Update Body Part Condition</div>
                        <div class="lpe-card-sub">Click any part on the silhouette above to target it, or pick a part below.</div>
                    </div>
                </div>
                <div class="lpe-form-grid">
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Body Part</label>
                        <select id="lpe_pop_hp_part" class="lpe-app-input">${partOptsHtml}</select>
                    </div>
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Condition Kind</label>
                        <select id="lpe_pop_hp_kind" class="lpe-app-input">${kindOptsHtml}</select>
                    </div>
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Label</label>
                        <input id="lpe_pop_hp_label" type="text" class="lpe-app-input" placeholder="e.g. Deep Sword Cut" />
                    </div>
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Severity (1–100%)</label>
                        <input id="lpe_pop_hp_sev" type="number" min="1" max="100" step="5" class="lpe-app-input" value="30" />
                    </div>
                    <div class="lpe-field-col wide">
                        <label class="lpe-field-lbl">Note</label>
                        <input id="lpe_pop_hp_note" type="text" class="lpe-app-input" placeholder="Optional cause or healing detail" />
                    </div>
                </div>
                <div class="lpe-inline-actions" style="justify-content:space-between;">
                    <div class="lpe-inline-actions" style="justify-content:flex-start;">
                        <label class="lpe-check-inline"><input type="checkbox" id="lpe_pop_hp_bleed" /> Bleeding</label>
                        <label class="lpe-check-inline"><input type="checkbox" id="lpe_pop_hp_treated" /> Bandaged / Treated</label>
                        <label class="lpe-check-inline"><input type="checkbox" id="lpe_pop_hp_scar" /> Permanent Scar</label>
                    </div>
                    <button type="button" class="lpe-app-btn primary" id="lpe_pop_hp_add_btn"><i class="fa-solid fa-plus"></i> Record Condition</button>
                </div>
                <hr class="lpe-sep" />
                <div class="lpe-form-grid">
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Prosthetic / Implant (<span id="lpe_pop_hp_part_lbl">${esc(BODY_PART_BY_ID[activePartId]?.label || activePartId)}</span>)</label>
                        <input id="lpe_pop_hp_prosthetic" type="text" class="lpe-app-input" value="${esc(activePartRec?.prosthetic || '')}" placeholder="e.g. Clockwork Hand (blank to clear)" />
                    </div>
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Armor Cover</label>
                        <input id="lpe_pop_hp_armor" type="text" class="lpe-app-input" value="${esc(activePartRec?.armor || '')}" placeholder="e.g. Steel Vambrace" />
                    </div>
                </div>
                <div class="lpe-inline-actions" style="justify-content:space-between;">
                    <label class="lpe-check-inline"><input type="checkbox" id="lpe_pop_hp_missing" ${activePartRec?.missing ? 'checked' : ''} /> Part Missing (0% HP)</label>
                    <button type="button" class="lpe-app-btn secondary" id="lpe_pop_hp_save_part"><i class="fa-solid fa-shield-halved"></i> Save Part Status</button>
                </div>
            </div>

            <div class="lpe-glass-card">
                <div class="lpe-card-title">Systemic Vitals &amp; Whole-Body Conditions</div>
                <div class="lpe-form-grid">
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Blood Loss (0–100%)</label>
                        <input id="lpe_pop_hp_bloodloss" type="number" min="0" max="100" step="5" class="lpe-app-input" value="${esc(effHealth.bloodLoss || 0)}" />
                    </div>
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Pain Override (0–100%)</label>
                        <input id="lpe_pop_hp_pain" type="number" min="0" max="100" step="5" class="lpe-app-input" value="${esc(effHealth.pain || 0)}" />
                    </div>
                </div>
                <div class="lpe-inline-actions" style="justify-content:flex-end;">
                    <button type="button" class="lpe-app-btn secondary" id="lpe_pop_hp_save_vitals"><i class="fa-solid fa-droplet"></i> Save Vitals</button>
                </div>
                <hr class="lpe-sep" />
                <div class="lpe-form-grid">
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Whole-Body Type</label>
                        <select id="lpe_pop_wb_type" class="lpe-app-input">${wbOptsHtml}</select>
                    </div>
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Condition Label</label>
                        <input id="lpe_pop_wb_label" type="text" class="lpe-app-input" placeholder="e.g. Swamp Fever" />
                    </div>
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Severity (1–100%)</label>
                        <input id="lpe_pop_wb_sev" type="number" min="1" max="100" step="5" class="lpe-app-input" value="35" />
                    </div>
                </div>
                <div class="lpe-inline-actions" style="justify-content:flex-end;">
                    <button type="button" class="lpe-app-btn secondary" id="lpe_pop_wb_add"><i class="fa-solid fa-biohazard"></i> Add Whole-Body Condition</button>
                </div>
            </div>

            <details class="lpe-glass-card lpe-fold-card">
                <summary class="lpe-fold-summary"><i class="fa-solid fa-code"></i> Edit Health JSON</summary>
                <div class="lpe-fold-body">
                    <textarea id="lpe_pop_health_json" class="lpe-app-input lpe-mono" rows="12">${esc(JSON.stringify(effHealth, null, 2))}</textarea>
                    <div class="lpe-inline-actions">
                        <span class="lpe-err-text" id="lpe_pop_health_err"></span>
                        <button type="button" class="lpe-app-btn primary" id="lpe_pop_save_health_json"><i class="fa-solid fa-floppy-disk"></i> Save Health JSON</button>
                    </div>
                </div>
            </details>
        `);

        const baseHealthForEdit = (useEff = false) => {
            if (useEff && isInferred) return normalizeHealthState(effHealth);
            return normalizeHealthState(state.health);
        };

        $stage.find('[data-body-type]').on('click', function () {
            const bt = String($(this).data('body-type') || 'male');
            const draft = cloneState(state);
            draft.health = applyHealthDelta(baseHealthForEdit(false), { bodyType: bt });
            commitEditedState(draft, `Body silhouette set to ${bt}.`);
        });

        $stage.find('#lpe_pop_adopt_inferred').on('click', () => {
            const draft = cloneState(state);
            draft.health = normalizeHealthState(effHealth);
            commitEditedState(draft, 'Adopted inferred injuries into canonical health state.');
        });

        $stage.find('#lpe_pop_tend_all').on('click', () => {
            const draft = cloneState(state);
            draft.health = applyHealthDelta(baseHealthForEdit(true), { tend_all: true });
            commitEditedState(draft, 'Tended and bandaged all active wounds.');
        });

        $stage.find('#lpe_pop_full_heal').on('click', () => {
            const draft = cloneState(state);
            draft.health = applyHealthDelta(baseHealthForEdit(false), { full_heal: true });
            commitEditedState(draft, 'Restored persona to full health.');
        });

        const syncHealthSelection = () => {
            const currentState = activeState();
            const currentSettings = getSettings();
            const currentExplicit = hasExplicitHealthData(currentState.health);
            const currentHealth = currentExplicit
                ? normalizeHealthState({
                    ...currentState.health,
                    bodyType: currentState.health?.bodyType || currentSettings.defaultBodyType || 'male',
                })
                : inferHealthFromStatusText(currentState.inv?.status || '', currentSettings.defaultBodyType || currentState.health?.bodyType || 'male');
            const partId = (healthView.selectedPart && BODY_PART_BY_ID[healthView.selectedPart])
                ? healthView.selectedPart
                : 'torso';
            const rec = currentHealth.parts?.[partId] || null;

            $stage.find('#lpe_pop_health_doll_wrap').html(renderHealthTab(currentState, {
                layer: healthView.layer,
                selectedPart: healthView.selectedPart,
                bodyTypeOverride: currentSettings.defaultBodyType,
                compact: false,
                showActions: true,
            }));
            $stage.find('#lpe_pop_hp_part').val(partId);
            $stage.find('#lpe_pop_hp_part_lbl').text(BODY_PART_BY_ID[partId]?.label || partId);
            $stage.find('#lpe_pop_hp_prosthetic').val(rec?.prosthetic || '');
            $stage.find('#lpe_pop_hp_armor').val(rec?.armor || '');
            $stage.find('#lpe_pop_hp_missing').prop('checked', Boolean(rec?.missing));
        };

        bindHealthDollInteractions($stage[0], {
            getSelectedPart: () => healthView.selectedPart,
            onSelectPart: (partId) => {
                healthView.selectedPart = partId;
                syncHealthSelection();
            },
            onLayerChange: (layer) => {
                healthView.layer = layer;
                syncHealthSelection();
            },
        });

        $stage.find('#lpe_pop_hp_part').on('change', function () {
            const pid = String($(this).val() || 'torso');
            healthView.selectedPart = pid;
            const rec = effHealth.parts?.[pid] || null;
            $stage.find('#lpe_pop_hp_part_lbl').text(BODY_PART_BY_ID[pid]?.label || pid);
            $stage.find('#lpe_pop_hp_prosthetic').val(rec?.prosthetic || '');
            $stage.find('#lpe_pop_hp_armor').val(rec?.armor || '');
            $stage.find('#lpe_pop_hp_missing').prop('checked', Boolean(rec?.missing));
        });

        $stage.on('click', '.lpe-health-treat-btn', function () {
            const pid = String($(this).data('part-id') || '');
            const idx = Number($(this).data('cond-idx'));
            const cur = baseHealthForEdit(true);
            const cond = cur.parts?.[pid]?.conditions?.[idx];
            if (!cond) return;
            const draft = cloneState(state);
            draft.health = applyHealthDelta(cur, {
                patch_conditions: [{ part: pid, label: cond.label, treated: true, bleeding: false }],
            });
            commitEditedState(draft, `Bandaged "${cond.label}" on ${BODY_PART_BY_ID[pid]?.label || pid}.`);
        });

        $stage.on('click', '.lpe-health-scar-btn', function () {
            const pid = String($(this).data('part-id') || '');
            const idx = Number($(this).data('cond-idx'));
            const cur = baseHealthForEdit(true);
            const cond = cur.parts?.[pid]?.conditions?.[idx];
            if (!cond) return;
            const draft = cloneState(state);
            draft.health = applyHealthDelta(cur, {
                patch_conditions: [{ part: pid, label: cond.label, scar: true, treated: false, bleeding: false, severity: Math.min(15, cond.severity || 10) }],
            });
            commitEditedState(draft, `Marked "${cond.label}" as a permanent scar.`);
        });

        $stage.on('click', '.lpe-health-heal-btn', function () {
            const pid = String($(this).data('part-id') || '');
            const idx = Number($(this).data('cond-idx'));
            const cur = baseHealthForEdit(true);
            const cond = cur.parts?.[pid]?.conditions?.[idx];
            if (!cond) return;
            const draft = cloneState(state);
            draft.health = applyHealthDelta(cur, {
                heal_conditions: [{ part: pid, label: cond.label }],
            });
            commitEditedState(draft, `Healed "${cond.label}" on ${BODY_PART_BY_ID[pid]?.label || pid}.`);
        });

        $stage.on('click', '.lpe-health-rm-whole', function () {
            const lbl = String($(this).data('wb-label') || '');
            const draft = cloneState(state);
            draft.health = applyHealthDelta(baseHealthForEdit(true), { whole_body_remove: [lbl] });
            commitEditedState(draft, `Removed whole-body condition "${lbl}".`);
        });

        $stage.find('#lpe_pop_hp_add_btn').on('click', () => {
            const part = String($stage.find('#lpe_pop_hp_part').val() || 'torso');
            const kind = String($stage.find('#lpe_pop_hp_kind').val() || 'sharp');
            const label = String($stage.find('#lpe_pop_hp_label').val() || '').trim()
                || `${kind.charAt(0).toUpperCase() + kind.slice(1)} Injury`;
            const severity = parseInt(String($stage.find('#lpe_pop_hp_sev').val()), 10) || 25;
            const bleeding = Boolean($stage.find('#lpe_pop_hp_bleed').prop('checked'));
            const treated = Boolean($stage.find('#lpe_pop_hp_treated').prop('checked'));
            const scar = Boolean($stage.find('#lpe_pop_hp_scar').prop('checked'));
            const note = String($stage.find('#lpe_pop_hp_note').val() || '').trim();

            healthView.selectedPart = part;
            const draft = cloneState(state);
            draft.health = applyHealthDelta(baseHealthForEdit(false), {
                add_conditions: [{ part, kind, label, severity, bleeding, treated, scar, note }],
            });
            commitEditedState(draft, `Recorded "${label}" on ${BODY_PART_BY_ID[part]?.label || part}.`);
        });

        $stage.find('#lpe_pop_hp_save_part').on('click', () => {
            const part = String($stage.find('#lpe_pop_hp_part').val() || 'torso');
            const prosthetic = String($stage.find('#lpe_pop_hp_prosthetic').val() || '').trim();
            const armor = String($stage.find('#lpe_pop_hp_armor').val() || '').trim();
            const missing = Boolean($stage.find('#lpe_pop_hp_missing').prop('checked'));

            healthView.selectedPart = part;
            const draft = cloneState(state);
            draft.health = applyHealthDelta(baseHealthForEdit(false), {
                set_parts: { [part]: { missing, prosthetic, armor } },
            });
            commitEditedState(draft, `Updated ${BODY_PART_BY_ID[part]?.label || part} status.`);
        });

        $stage.find('#lpe_pop_hp_save_vitals').on('click', () => {
            const bloodLoss = parseInt(String($stage.find('#lpe_pop_hp_bloodloss').val()), 10) || 0;
            const pain = parseInt(String($stage.find('#lpe_pop_hp_pain').val()), 10) || 0;
            const draft = cloneState(state);
            draft.health = applyHealthDelta(baseHealthForEdit(false), { bloodLoss, pain });
            commitEditedState(draft, 'Saved systemic blood loss & pain.');
        });

        $stage.find('#lpe_pop_wb_add').on('click', () => {
            const type = String($stage.find('#lpe_pop_wb_type').val() || 'other');
            const label = String($stage.find('#lpe_pop_wb_label').val() || '').trim()
                || `${type.charAt(0).toUpperCase() + type.slice(1)}`;
            const severity = parseInt(String($stage.find('#lpe_pop_wb_sev').val()), 10) || 35;
            const draft = cloneState(state);
            draft.health = applyHealthDelta(baseHealthForEdit(false), {
                whole_body_upsert: [{ type, label, severity }],
            });
            commitEditedState(draft, `Added whole-body condition "${label}".`);
        });

        $stage.find('#lpe_pop_save_health_json').on('click', () => {
            $('#lpe_pop_health_err').text('');
            try {
                const parsed = JSON.parse(String($stage.find('#lpe_pop_health_json').val() || '{}'));
                const draft = cloneState(state);
                draft.health = normalizeHealthState(parsed);
                commitEditedState(draft, 'Saved Health JSON.');
            } catch (err) {
                $('#lpe_pop_health_err').text(`Invalid JSON: ${err.message}`);
            }
        });
    }

    function renderCastTab($stage, state) {
        const meta = tabMeta('cast');
        const userName = activeUserName();
        const rooms = state.locations?.rooms || [];

        const toolbarHtml = `
            <div class="lpe-cast-toolbar">
                <div class="lpe-inline-actions">
                    <button type="button" class="lpe-app-btn ${castMode === 'list' ? 'primary' : 'secondary'} lpe-btn-sm" id="lpe_pop_back_cast_list"><i class="fa-solid fa-users"></i> Cast Roster</button>
                    <button type="button" class="lpe-app-btn ${castMode === 'import' ? 'primary' : 'secondary'} lpe-btn-sm" id="lpe_pop_open_batch_import"><i class="fa-solid fa-file-import"></i> Batch Import Characters</button>
                    <button type="button" class="lpe-app-btn ${castMode === 'edit' && !editingCharName ? 'primary' : 'secondary'} lpe-btn-sm" id="lpe_pop_new_character"><i class="fa-solid fa-user-plus"></i> New Character</button>
                </div>
            </div>
        `;

        if (castMode === 'import') {
            renderBatchImportView($stage, state, meta, toolbarHtml, userName, rooms);
            return;
        }
        if (castMode === 'edit') {
            renderCharacterEditorView($stage, state, meta, toolbarHtml, userName, rooms);
            return;
        }

        const sub = subTabs.cast || 'onscreen';
        const subList = [
            { id: 'onscreen', label: `On-Screen (${(state.onscreen || []).length})`, icon: 'fa-eye' },
            { id: 'offscreen', label: `Off-Screen / Staged (${(state.offscreen_agendas || []).length})`, icon: 'fa-compass' },
            { id: 'entities', label: `Entity Profiles (${(state.entity_state || []).length})`, icon: 'fa-masks-theater' },
            { id: 'memories', label: `Memories (${(state.entityMem || []).length})`, icon: 'fa-brain' },
            { id: 'thoughts', label: `Thoughts (${(state.thoughts || []).length})`, icon: 'fa-comment-dots' },
        ];

        const subBar = `
            <div class="lpe-subtabs">
                ${subList.map((s) => `<button type="button" class="${s.id === sub ? 'on' : ''}" data-sub="${s.id}"><i class="fa-solid ${s.icon}"></i> ${esc(s.label)}</button>`).join('')}
            </div>
        `;

        const colorOptions = (selected) => {
            const selLow = String(selected || '').toLowerCase();
            return [
                '<option value="">(Auto-assign)</option>',
                ...PALETTE.map((p) => {
                    const val = `${p.name} ${p.hex}`;
                    const isSel = selLow.includes(p.name) || selLow.includes(p.hex.toLowerCase());
                    return `<option value="${esc(val)}" ${isSel ? 'selected' : ''}>${esc(val)}</option>`;
                }),
            ].join('');
        };

        let contentHtml = '';
        if (sub === 'entities') {
            const rows = (state.entity_state || []).map((es) => {
                const col = hexFromFontColor(es.fontColor);
                return `
                    <div class="lpe-npc-card" style="border-left: 3px solid ${esc(col)};">
                        <div class="lpe-npc-head">
                            <span class="lpe-dot" style="background:${esc(col)};"></span>
                            <input type="text" class="lpe-app-input" data-pop-es="name" value="${esc(es.name)}" placeholder="Character Name" />
                            <select class="lpe-app-input" data-pop-es="fontColor">${colorOptions(es.fontColor)}</select>
                            ${es.preGameStaged ? '<span class="lpe-chip lpe-badge-staged">Staged</span>' : ''}
                            ${es.pinned ? '<span class="lpe-chip">Pinned</span>' : ''}
                            <button type="button" class="lpe-mini-btn lpe-pop-edit-char" data-edit-char="${esc(es.name)}" title="Open full State / Personality / Bonds / Location editor"><i class="fa-solid fa-user-pen"></i> Edit</button>
                            <button type="button" class="lpe-app-btn danger lpe-btn-sm lpe-pop-del-es" title="Remove entity"><i class="fa-solid fa-trash"></i></button>
                        </div>
                        <div class="lpe-form-grid">
                            ${es.status ? `<div class="lpe-field-col wide"><label class="lpe-field-lbl">Status / Condition</label><input type="text" class="lpe-app-input" data-pop-es="status" value="${esc(es.status)}" /></div>` : ''}
                            <div class="lpe-field-col wide"><label class="lpe-field-lbl">Appearance / Look</label><input type="text" class="lpe-app-input" data-pop-es="look" value="${esc(es.look)}" /></div>
                            <div class="lpe-field-col wide"><label class="lpe-field-lbl">Voice &amp; Mannerisms</label><input type="text" class="lpe-app-input" data-pop-es="voice" value="${esc(es.voice)}" /></div>
                            <div class="lpe-field-col wide"><label class="lpe-field-lbl">Public Persona</label><input type="text" class="lpe-app-input" data-pop-es="persona" value="${esc(es.persona)}" /></div>
                            <div class="lpe-field-col wide"><label class="lpe-field-lbl">Private Layer / Secrets</label><input type="text" class="lpe-app-input" data-pop-es="private" value="${esc(es.private)}" /></div>
                        </div>
                    </div>
                `;
            }).join('');
            contentHtml = `
                <div class="lpe-glass-card">
                    <div class="lpe-card-head">
                        <div class="lpe-card-title">Entity Profiles &amp; Locked Dialogue Colors</div>
                        <div class="lpe-inline-actions">
                            <button type="button" class="lpe-app-btn secondary" id="lpe_pop_add_es"><i class="fa-solid fa-plus"></i> Add Entity</button>
                            <button type="button" class="lpe-app-btn primary" id="lpe_pop_save_es"><i class="fa-solid fa-floppy-disk"></i> Save Entities</button>
                        </div>
                    </div>
                    <div class="lpe-stack" id="lpe_pop_es_list">${rows || '<div class="lpe-muted">No entity profiles yet. Use Batch Import Characters or New Character to stage your cast before play begins.</div>'}</div>
                </div>
            `;
        } else if (sub === 'onscreen' || sub === 'offscreen') {
            const arr = sub === 'onscreen' ? (state.onscreen || []) : (state.offscreen_agendas || []);
            const jsonKey = sub === 'onscreen' ? 'onscreen' : 'offscreen_agendas';
            const cardsHtml = arr.length
                ? `<div class="lpe-cards-grid">${arr.map((e) => {
                    const es = (state.entity_state || []).find((x) => normalizeNameKey(x.name) === normalizeNameKey(e.name));
                    const col = hexFromFontColor(es?.fontColor);
                    const effStatus = e.status || es?.status || '';
                    return `
                        <div class="lpe-glass-card lpe-compact-card">
                            <div class="lpe-npc-title-row">
                                <span class="lpe-dot" style="background:${esc(col)};"></span>
                                <strong>${esc(e.name)}</strong>
                                <span class="lpe-chip">${esc(e.salience || '')}</span>
                                <span class="lpe-chip">${esc(e.tfdy || '')}</span>
                                ${(e.preGameStaged || es?.preGameStaged) ? '<span class="lpe-chip lpe-badge-staged">Staged</span>' : ''}
                                <button type="button" class="lpe-mini-btn lpe-pop-edit-char" data-edit-char="${esc(e.name)}" title="Edit State, Personality, Bonds &amp; Location"><i class="fa-solid fa-user-pen"></i> Edit</button>
                            </div>
                            ${effStatus ? `<div class="lpe-kv-line"><span>State:</span> ${esc(effStatus)}</div>` : ''}
                            ${sub === 'onscreen'
                                ? `<div class="lpe-kv-line"><span>Emotion:</span> ${esc(e.parrott)}</div>
                                   <div class="lpe-kv-line"><span>Residual:</span> ${esc(e.residualMood)}</div>
                                   <div class="lpe-kv-line"><span>Agenda:</span> ${esc(e.agenda)}</div>
                                   <div class="lpe-kv-line"><span>Why:</span> ${esc(e.why)}</div>
                                   <div class="lpe-kv-line"><span>End / Move:</span> ${esc(e.end)} · ${esc(e.move)}</div>`
                                : `<div class="lpe-kv-line"><span>Location:</span> ${esc(e.loc)}</div>
                                   <div class="lpe-kv-line"><span>Mood:</span> ${esc(e.mood)}</div>
                                   <div class="lpe-kv-line"><span>Agenda:</span> ${esc(e.agenda)}</div>
                                   <div class="lpe-kv-line"><span>Goal / End:</span> ${esc(e.goal)} (${esc(e.end)})</div>`}
                        </div>
                    `;
                }).join('')}</div>`
                : `<div class="lpe-glass-card lpe-muted">No ${sub === 'onscreen' ? 'on-screen' : 'off-screen / staged'} NPCs recorded.</div>`;

            contentHtml = `
                ${cardsHtml}
                <details class="lpe-glass-card lpe-fold-card">
                    <summary class="lpe-fold-summary"><i class="fa-solid fa-code"></i> Edit ${esc(jsonKey)} JSON</summary>
                    <div class="lpe-fold-body">
                        <textarea id="lpe_pop_cast_json" class="lpe-app-input lpe-mono" rows="10">${esc(JSON.stringify(arr, null, 2))}</textarea>
                        <div class="lpe-inline-actions">
                            <span class="lpe-err-text" id="lpe_pop_cast_err"></span>
                            <button type="button" class="lpe-app-btn primary" data-save-cast-key="${esc(jsonKey)}"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
                        </div>
                    </div>
                </details>
            `;
        } else if (sub === 'memories') {
            const list = state.entityMem || [];
            contentHtml = `
                ${list.length
                    ? `<div class="lpe-stack">${list.map((em) => `
                        <div class="lpe-glass-card lpe-compact-card">
                            <div class="lpe-npc-title-row"><strong>${esc(em.name)}</strong><span class="lpe-chip">${(em.entries || []).length}/20</span></div>
                            <ul class="lpe-clean-list">${(em.entries || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
                        </div>
                    `).join('')}</div>`
                    : '<div class="lpe-glass-card lpe-muted">No entity memories recorded.</div>'}
                <details class="lpe-glass-card lpe-fold-card">
                    <summary class="lpe-fold-summary"><i class="fa-solid fa-code"></i> Edit entityMem JSON</summary>
                    <div class="lpe-fold-body">
                        <textarea id="lpe_pop_cast_json" class="lpe-app-input lpe-mono" rows="10">${esc(JSON.stringify(list, null, 2))}</textarea>
                        <div class="lpe-inline-actions">
                            <span class="lpe-err-text" id="lpe_pop_cast_err"></span>
                            <button type="button" class="lpe-app-btn primary" data-save-cast-key="entityMem"><i class="fa-solid fa-floppy-disk"></i> Save Memories</button>
                        </div>
                    </div>
                </details>
            `;
        } else {
            const list = state.thoughts || [];
            contentHtml = `
                ${list.length
                    ? `<div class="lpe-cards-grid">${list.map((t) => `
                        <div class="lpe-glass-card lpe-compact-card">
                            <div class="lpe-npc-title-row"><strong>${esc(t.name)}</strong></div>
                            <div class="lpe-kv-line"><span>Goal:</span> ${esc(t.tQ1)}</div>
                            <div class="lpe-kv-line"><span>Feeling:</span> ${esc(t.tQ2)}</div>
                            <div class="lpe-kv-line"><span>Mind:</span> ${esc(t.tQ3)}</div>
                            <div class="lpe-kv-line"><span>Why:</span> ${esc(t.tQ4)}</div>
                            <div class="lpe-kv-line"><span>Unsaid:</span> ${esc(t.tQ5)}</div>
                        </div>
                    `).join('')}</div>`
                    : '<div class="lpe-glass-card lpe-muted">No inner thoughts captured this turn.</div>'}
                <details class="lpe-glass-card lpe-fold-card">
                    <summary class="lpe-fold-summary"><i class="fa-solid fa-code"></i> Edit thoughts JSON</summary>
                    <div class="lpe-fold-body">
                        <textarea id="lpe_pop_cast_json" class="lpe-app-input lpe-mono" rows="10">${esc(JSON.stringify(list, null, 2))}</textarea>
                        <div class="lpe-inline-actions">
                            <span class="lpe-err-text" id="lpe_pop_cast_err"></span>
                            <button type="button" class="lpe-app-btn primary" data-save-cast-key="thoughts"><i class="fa-solid fa-floppy-disk"></i> Save Thoughts</button>
                        </div>
                    </div>
                </details>
            `;
        }

        $stage.html(`${renderPageHeader(meta)}${historyBannerHtml(state)}${toolbarHtml}${subBar}${contentHtml}`);

        wireCastToolbar($stage);

        $stage.find('.lpe-subtabs').on('click', 'button', function () {
            subTabs.cast = String($(this).data('sub') || 'onscreen');
            renderActiveTab({ resetScroll: false });
        });
        $stage.on('click', '.lpe-pop-edit-char', function () {
            const cname = String($(this).data('edit-char') || '').trim();
            if (!cname) return;
            editingCharName = cname;
            editorDraft = null;
            editorRemovedBondTargets = [];
            castMode = 'edit';
            renderActiveTab({ resetScroll: true });
        });

        const collectEntities = () => {
            const rows = [];
            $stage.find('#lpe_pop_es_list .lpe-npc-card').each(function () {
                const name = String($(this).find('[data-pop-es="name"]').val() ?? '').trim();
                if (!name) return;
                const prevEs = (state.entity_state || []).find((x) => normalizeNameKey(x.name) === normalizeNameKey(name));
                const nextStatus = $(this).find('[data-pop-es="status"]').length
                    ? String($(this).find('[data-pop-es="status"]').val() ?? '').trim()
                    : (prevEs?.status || '');
                rows.push({
                    ...(prevEs || {}),
                    name,
                    fontColor: String($(this).find('[data-pop-es="fontColor"]').val() ?? ''),
                    look: String($(this).find('[data-pop-es="look"]').val() ?? ''),
                    voice: String($(this).find('[data-pop-es="voice"]').val() ?? ''),
                    persona: String($(this).find('[data-pop-es="persona"]').val() ?? ''),
                    private: String($(this).find('[data-pop-es="private"]').val() ?? ''),
                    ...(nextStatus ? { status: nextStatus } : {}),
                });
            });
            return rows;
        };

        $stage.on('click', '.lpe-pop-del-es', function () {
            $(this).closest('.lpe-npc-card').remove();
        });
        $stage.find('#lpe_pop_add_es').on('click', () => {
            const draft = cloneState(state);
            draft.entity_state = collectEntities();
            draft.entity_state.push({ name: 'New NPC', fontColor: '', look: '', voice: '', persona: '', private: '' });
            commitEditedState(draft, 'Added new Entity profile.');
        });
        $stage.find('#lpe_pop_save_es').on('click', () => {
            const draft = cloneState(state);
            draft.entity_state = collectEntities();
            commitEditedState(draft, 'Saved Entity profiles.');
        });
        $stage.find('[data-save-cast-key]').on('click', function () {
            const key = String($(this).data('save-cast-key'));
            $('#lpe_pop_cast_err').text('');
            try {
                const parsed = JSON.parse(String($stage.find('#lpe_pop_cast_json').val() || '[]'));
                const draft = cloneState(state);
                draft[key] = parsed;
                commitEditedState(draft, `Saved ${key}.`);
            } catch (err) {
                $('#lpe_pop_cast_err').text(`Invalid JSON: ${err.message}`);
            }
        });
    }

    function wireCastToolbar($stage) {
        $stage.on('click', '#lpe_pop_back_cast_list', () => {
            castMode = 'list';
            renderActiveTab({ resetScroll: true });
        });
        $stage.on('click', '#lpe_pop_open_batch_import', () => {
            castMode = 'import';
            renderActiveTab({ resetScroll: true });
        });
        $stage.on('click', '#lpe_pop_new_character', () => {
            editingCharName = '';
            editorDraft = null;
            editorRemovedBondTargets = [];
            castMode = 'edit';
            renderActiveTab({ resetScroll: true });
        });
    }

    function renderBatchImportView($stage, state, meta, toolbarHtml, userName, rooms) {
        const roomOptionsHtml = [
            '<option value="">(None / Off-screen staged)</option>',
            ...rooms.map((r) => `<option value="${esc(r.id)}" ${r.id === importState.defaultRoomId ? 'selected' : ''}>${esc(r.name || r.id)} (${esc(r.id)})</option>`),
        ].join('');

        const selectedCount = importState.candidates.filter((c) => c.selected && c.collision !== 'user').length;
        const warningsHtml = importState.warnings.length
            ? `<div class="lpe-banner warn" id="lpe_batch_warnings"><i class="fa-solid fa-triangle-exclamation"></i><span>${importState.warnings.map(esc).join(' · ')}</span></div>`
            : '';

        const previewHtml = importState.candidates.length
            ? `
                <div class="lpe-glass-card">
                    <div class="lpe-card-head">
                        <div>
                            <div class="lpe-card-title">Import Preview (${selectedCount}/${importState.candidates.length} selected)</div>
                            <div class="lpe-card-sub">Verify names, {{user}} exclusions, placement, and bonds before committing.</div>
                        </div>
                        <div class="lpe-inline-actions">
                            <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_batch_select_all">Select Eligible</button>
                            <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_batch_select_none">Clear</button>
                            <button type="button" class="lpe-app-btn primary" id="lpe_batch_commit_btn" ${selectedCount === 0 ? 'disabled' : ''}>
                                <i class="fa-solid fa-check"></i> Commit ${selectedCount} Character${selectedCount === 1 ? '' : 's'}
                            </button>
                        </div>
                    </div>
                    <div class="lpe-stack" id="lpe_batch_preview_list">
                        ${importState.candidates.map((c, idx) => {
                            const isUserBlocked = c.collision === 'user';
                            const badgeCls = isUserBlocked
                                ? 'lpe-badge-user-skip'
                                : c.collision === 'existing'
                                    ? 'lpe-badge-merge'
                                    : 'lpe-badge-staged';
                            const bondsText = (c.bonds || []).length
                                ? c.bonds.map((b) => `${b.target} (${b.mode.replace(/^mode:/, '')})`).join(', ')
                                : 'None';
                            return `
                                <div class="lpe-batch-row ${isUserBlocked ? 'is-blocked' : ''}" data-batch-idx="${idx}">
                                    <div class="lpe-batch-row-top">
                                        <label class="lpe-batch-check-wrap">
                                            <input type="checkbox" class="lpe-batch-chk" data-idx="${idx}" ${c.selected && !isUserBlocked ? 'checked' : ''} ${isUserBlocked ? 'disabled' : ''} />
                                            <strong>${esc(c.name)}</strong>
                                        </label>
                                        <span class="lpe-chip ${badgeCls}">${esc(c.collisionLabel)}</span>
                                        <select class="lpe-app-input lpe-batch-row-presence" data-idx="${idx}" ${isUserBlocked ? 'disabled' : ''}>
                                            <option value="staged" ${c.presence === 'staged' ? 'selected' : ''}>Staged (Off-screen)</option>
                                            <option value="offscreen" ${c.presence === 'offscreen' ? 'selected' : ''}>Off-Screen Active</option>
                                            <option value="onscreen" ${c.presence === 'onscreen' ? 'selected' : ''}>On-Screen Now</option>
                                        </select>
                                        ${rooms.length ? `
                                            <select class="lpe-app-input lpe-batch-row-room" data-idx="${idx}" ${(isUserBlocked || c.presence === 'staged') ? 'disabled' : ''}>
                                                <option value="">(No Atlas room)</option>
                                                ${rooms.map((r) => `<option value="${esc(r.id)}" ${r.id === c.roomId ? 'selected' : ''}>${esc(r.name || r.id)}</option>`).join('')}
                                            </select>
                                        ` : ''}
                                    </div>
                                    <div class="lpe-batch-row-meta">
                                        ${c.persona ? `<div><span>Personality:</span> ${esc(c.persona)}</div>` : ''}
                                        ${c.status || c.agenda ? `<div><span>State / Agenda:</span> ${esc([c.status, c.agenda].filter(Boolean).join(' · '))}</div>` : ''}
                                        <div><span>Location:</span> ${esc(c.roomId || c.loc || 'Staged')}</div>
                                        <div><span>Bonds:</span> ${esc(bondsText)}</div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `
            : '';

        $stage.html(`
            ${renderPageHeader(meta)}
            ${historyBannerHtml(state)}
            ${toolbarHtml}
            <div class="lpe-glass-card">
                <div class="lpe-card-head">
                    <div>
                        <div class="lpe-card-title">Batch Import Characters (Pre-Game / Scenario Setup)</div>
                        <div class="lpe-card-sub">Paste JSON arrays/objects, <code>---</code> or heading-delimited character sheets, or select V2/V3 <code>.png</code> / <code>.json</code> character cards.${userName ? ` Active player <b>${esc(userName)}</b> is protected from NPC duplication.` : ''}</div>
                    </div>
                    <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_batch_load_example"><i class="fa-solid fa-wand-magic-sparkles"></i> Load Template</button>
                </div>
                <div class="lpe-form-grid">
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Default Placement</label>
                        <select id="lpe_batch_default_presence" class="lpe-app-input">
                            <option value="staged" ${importState.defaultPresence === 'staged' ? 'selected' : ''}>Staged / Off-Screen (Recommended Pre-Game)</option>
                            <option value="offscreen" ${importState.defaultPresence === 'offscreen' ? 'selected' : ''}>Off-Screen Active</option>
                        </select>
                    </div>
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Default Atlas Room (Optional)</label>
                        <select id="lpe_batch_default_room" class="lpe-app-input">${roomOptionsHtml}</select>
                    </div>
                    <div class="lpe-field-col wide">
                        <label class="lpe-field-lbl">Import V2/V3 Character Cards (.png, .json, .txt, .md)</label>
                        <input type="file" id="lpe_batch_import_files" class="lpe-app-input" multiple accept=".png,.json,.txt,.md" />
                    </div>
                    <div class="lpe-field-col wide">
                        <label class="lpe-field-lbl">Multi-Character Text / Markdown / JSON</label>
                        <textarea id="lpe_batch_import_input" class="lpe-app-input lpe-mono" rows="9" placeholder="Name: Sera Vane&#10;Personality: Sharp-tongued fixer with dry humor&#10;State: Alert, nursing bruised ribs | Agenda: Watching the docks&#10;Location: Harbor Pier 4&#10;Bonds: {{user}}: guarded | owes him one favor&#10;---&#10;Name: Inspector Hale&#10;...">${esc(importState.rawText)}</textarea>
                    </div>
                </div>
                <div class="lpe-inline-actions" style="margin-top:10px;">
                    <button type="button" class="lpe-app-btn primary" id="lpe_batch_parse_btn"><i class="fa-solid fa-magnifying-glass"></i> Parse &amp; Preview</button>
                    <button type="button" class="lpe-app-btn secondary" id="lpe_batch_clear_btn">Clear Input</button>
                </div>
            </div>
            ${warningsHtml}
            ${previewHtml}
        `);

        wireCastToolbar($stage);

        const syncBatchHeaderInputs = () => {
            const $ta = $stage.find('#lpe_batch_import_input');
            if ($ta.length && typeof $ta.val === 'function') importState.rawText = String($ta.val() ?? '');
            const $dp = $stage.find('#lpe_batch_default_presence');
            if ($dp.length && typeof $dp.val === 'function') importState.defaultPresence = String($dp.val() || 'staged');
            const $dr = $stage.find('#lpe_batch_default_room');
            if ($dr.length && typeof $dr.val === 'function') importState.defaultRoomId = String($dr.val() || '');
        };

        $stage.on('click', '#lpe_batch_load_example', () => {
            importState.rawText = [
                'Name: Sera Vane',
                'Role / Personality: Cynical dockside information broker; calm under pressure, loyal only when paid',
                'Voice: Low, clipped sentences with wry understatement',
                'Look: Charcoal wool greatcoat, silver scar above left eyebrow',
                'State: Rested, wary | Agenda: Waiting near the freight gate',
                'Location: Harbor Pier 4',
                'Bonds: {{user}}: guarded, friendship 9, hostility 6 | uneasy past truce',
                '---',
                'Name: Captain Hale',
                'Personality: Methodical precinct veteran; dry, uncompromising sense of duty',
                'State: On patrol, fatigued',
                'Location: Precinct Briefing Room',
                'Bonds: {{user}}: rival | suspects his alibi',
            ].join('\n');
            const parsed = parseCharacterBatchInput(importState.rawText, {
                existingState: state,
                userName,
                defaultPresence: importState.defaultPresence,
                defaultRoomId: importState.defaultRoomId,
            });
            importState.candidates = parsed.candidates;
            importState.warnings = parsed.warnings;
            renderActiveTab({ resetScroll: false });
        });

        $stage.on('click', '#lpe_batch_parse_btn', () => {
            syncBatchHeaderInputs();
            const parsed = parseCharacterBatchInput(importState.rawText, {
                existingState: state,
                userName,
                defaultPresence: importState.defaultPresence,
                defaultRoomId: importState.defaultRoomId,
            });
            importState.candidates = parsed.candidates;
            importState.warnings = parsed.warnings;
            renderActiveTab({ resetScroll: false });
        });

        $stage.on('click', '#lpe_batch_clear_btn', () => {
            importState = {
                rawText: '',
                defaultPresence: 'staged',
                defaultRoomId: '',
                candidates: [],
                warnings: [],
            };
            renderActiveTab({ resetScroll: false });
        });

        $stage.on('change', '#lpe_batch_import_files', async function (e) {
            const files = Array.from(e?.target?.files || this?.files || []);
            if (!files.length) return;
            syncBatchHeaderInputs();
            const loaded = [];
            for (const f of files) {
                const low = String(f.name || '').toLowerCase();
                if (low.endsWith('.png') && typeof f.arrayBuffer === 'function') {
                    loaded.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
                } else if (typeof f.text === 'function') {
                    loaded.push({ name: f.name, text: await f.text() });
                }
            }
            const parsed = parseCharacterFiles(loaded, {
                existingState: state,
                userName,
                defaultPresence: importState.defaultPresence,
                defaultRoomId: importState.defaultRoomId,
            });
            importState.candidates = parsed.candidates;
            importState.warnings = parsed.warnings;
            renderActiveTab({ resetScroll: false });
        });

        $stage.on('change', '.lpe-batch-chk', function () {
            const idx = Number($(this).data('idx'));
            const cand = importState.candidates[idx];
            if (!cand || cand.collision === 'user') return;
            cand.selected = Boolean($(this).prop('checked'));
            renderActiveTab({ resetScroll: false });
        });
        $stage.on('change', '.lpe-batch-row-presence', function () {
            const idx = Number($(this).data('idx'));
            const cand = importState.candidates[idx];
            if (!cand || cand.collision === 'user') return;
            cand.presence = String($(this).val() || 'staged');
            cand.preGameStaged = cand.presence === 'staged';
            if (cand.presence === 'staged') cand.roomId = '';
            renderActiveTab({ resetScroll: false });
        });
        $stage.on('change', '.lpe-batch-row-room', function () {
            const idx = Number($(this).data('idx'));
            const cand = importState.candidates[idx];
            if (!cand) return;
            cand.roomId = String($(this).val() || '');
        });
        $stage.on('click', '#lpe_batch_select_all', () => {
            for (const c of importState.candidates) if (c.collision !== 'user') c.selected = true;
            renderActiveTab({ resetScroll: false });
        });
        $stage.on('click', '#lpe_batch_select_none', () => {
            for (const c of importState.candidates) c.selected = false;
            renderActiveTab({ resetScroll: false });
        });
        $stage.on('click', '#lpe_batch_commit_btn', () => {
            const eligible = importState.candidates.filter((c) => c.selected && c.collision !== 'user');
            if (!eligible.length) return;
            const delta = buildCharacterBatchDelta(eligible, { userName });
            importState = { rawText: '', defaultPresence: 'staged', defaultRoomId: '', candidates: [], warnings: [] };
            castMode = 'list';
            subTabs.cast = 'entities';
            commitDeltaEdit(delta, `Imported ${eligible.length} character${eligible.length === 1 ? '' : 's'} into cast roster.`);
        });
    }

    function renderCharacterEditorView($stage, state, meta, toolbarHtml, userName, rooms) {
        if (!editorDraft) {
            editorDraft = editingCharName
                ? extractCharacterRecord(state, editingCharName, { userName })
                : {
                    prevName: '',
                    name: '',
                    fontColor: '',
                    look: '',
                    voice: '',
                    persona: '',
                    private: '',
                    presence: 'staged',
                    status: '',
                    mood: '',
                    residualMood: '',
                    agenda: '',
                    why: '',
                    goal: '',
                    end: '',
                    move: '',
                    tfdy: 'T2 F2 D2 Y2',
                    salience: 'sal:5',
                    loc: '',
                    roomId: '',
                    pos: '',
                    preGameStaged: true,
                    manual: true,
                    pinned: true,
                    bonds: [],
                };
        }
        const d = editorDraft;
        const isExisting = Boolean(editingCharName);
        const userLabel = userName || '{{user}}';
        const selfKey = normalizeNameKey(d.name || editingCharName);

        const knownTargets = [
            userLabel,
            ...[
                ...(state.entity_state || []).map((x) => x.name),
                ...(state.onscreen || []).map((x) => x.name),
                ...(state.offscreen_agendas || []).map((x) => x.name),
            ].filter((n) => n && normalizeNameKey(n) !== selfKey && !isPlayerPersonaName(n, userName)),
        ].filter((v, i, a) => v && a.findIndex((x) => normalizeNameKey(x) === normalizeNameKey(v)) === i);

        const colorOptions = (() => {
            const selLow = String(d.fontColor || '').toLowerCase();
            return [
                '<option value="">(Auto-assign palette color)</option>',
                ...PALETTE.map((p) => {
                    const val = `${p.name} ${p.hex}`;
                    const isSel = selLow.includes(p.name) || selLow.includes(p.hex.toLowerCase());
                    return `<option value="${esc(val)}" ${isSel ? 'selected' : ''}>${esc(val)}</option>`;
                }),
            ].join('');
        })();

        const axisPairRows = [
            ['Desire', 'desire', 'Hate', 'hate'],
            ['Playful', 'play', 'Conflict', 'conflict'],
            ['Friend', 'friendship', 'Hostile', 'hostility'],
            ['Commit', 'commitment', 'Stagnant', 'stagnation'],
            ['Kinship', 'family', 'Indiff.', 'indifference'],
            ['Selfless', 'selflessness', 'Envy', 'envy'],
        ];

        const bondsHtml = (d.bonds || []).length
            ? d.bonds.map((b, bIdx) => {
                const axes = b.axes || extractAxesFromMatrix(b.matrix || '');
                return `
                    <div class="lpe-bond-card" data-bond-idx="${bIdx}">
                        <div class="lpe-bond-top">
                            <input type="text" class="lpe-app-input lpe-bond-target" list="lpe_bond_target_list" value="${esc(b.target)}" placeholder="Target (${esc(userLabel)} or NPC)" />
                            <select class="lpe-app-input lpe-bond-preset">
                                <option value="">Apply Preset…</option>
                                ${Object.values(BOND_PRESETS).map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')}
                            </select>
                            <button type="button" class="lpe-app-btn danger lpe-btn-sm lpe-bond-remove" data-bond-idx="${bIdx}" title="Remove bond"><i class="fa-solid fa-trash"></i></button>
                        </div>
                        <div class="lpe-form-grid">
                            <div class="lpe-field-col"><label class="lpe-field-lbl">Mode Tag</label><input type="text" class="lpe-app-input lpe-bond-mode" value="${esc(b.mode)}" /></div>
                            <div class="lpe-field-col"><label class="lpe-field-lbl">Dam / Gate</label><input type="text" class="lpe-app-input lpe-bond-dam" value="${esc(b.dam)}" /></div>
                            <div class="lpe-field-col"><label class="lpe-field-lbl">Sluice (E/L)</label><input type="text" class="lpe-app-input lpe-bond-sluice" value="${esc(b.sluice)}" /></div>
                            <div class="lpe-field-col"><label class="lpe-field-lbl">Permission Wall</label><input type="text" class="lpe-app-input lpe-bond-wall" value="${esc(b.wall)}" /></div>
                            <div class="lpe-field-col wide"><label class="lpe-field-lbl">Dynamics / Grudge / Intent Note</label><input type="text" class="lpe-app-input lpe-bond-intent" value="${esc(b.intent)}" placeholder="intent:..." /></div>
                        </div>
                        <div class="lpe-axis-mini-grid">
                            ${axisPairRows.map(([pLbl, pKey, nLbl, nKey]) => `
                                <div class="lpe-axis-mini-pair">
                                    <label>${esc(pLbl)} <input type="number" min="3" max="20" class="lpe-app-input lpe-axis-num" data-bond-axis="${esc(pKey)}" value="${esc(axes[pKey] ?? 3)}" /></label>
                                    <label>${esc(nLbl)} <input type="number" min="3" max="20" class="lpe-app-input lpe-axis-num" data-bond-axis="${esc(nKey)}" value="${esc(axes[nKey] ?? 3)}" /></label>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }).join('')
            : '<div class="lpe-muted">No bonds configured yet. Click "+ Bond with User" to define their relationship before play starts.</div>';

        $stage.html(`
            ${renderPageHeader(meta)}
            ${historyBannerHtml(state)}
            ${toolbarHtml}
            <datalist id="lpe_bond_target_list">${knownTargets.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
            <div class="lpe-char-editor">
                <div class="lpe-glass-card">
                    <div class="lpe-card-head">
                        <div>
                            <div class="lpe-card-title">${isExisting ? `Editing Character: ${esc(editingCharName)}` : 'Create Staged Character'}</div>
                            <div class="lpe-card-sub">Edit state, personality, bonds, and Atlas/off-screen location directly in the store.</div>
                        </div>
                        <div class="lpe-inline-actions">
                            <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_char_cancel_btn">Back</button>
                            ${isExisting ? `<button type="button" class="lpe-app-btn danger lpe-btn-sm" id="lpe_char_delete_btn"><i class="fa-solid fa-trash"></i> Delete</button>` : ''}
                            <button type="button" class="lpe-app-btn primary" id="lpe_char_save_btn"><i class="fa-solid fa-floppy-disk"></i> Save Character</button>
                        </div>
                    </div>
                    <div id="lpe_char_err" class="lpe-err-text"></div>
                </div>

                <div class="lpe-glass-card">
                    <div class="lpe-card-title">1. State &amp; Presence</div>
                    <div class="lpe-form-grid">
                        <div class="lpe-field-col"><label class="lpe-field-lbl">Name</label><input type="text" id="lpe_char_name" class="lpe-app-input" value="${esc(d.name)}" placeholder="Character Name" /></div>
                        <div class="lpe-field-col">
                            <label class="lpe-field-lbl">Stage / Presence</label>
                            <select id="lpe_char_presence" class="lpe-app-input">
                                <option value="staged" ${d.presence === 'staged' ? 'selected' : ''}>Staged (Pre-Game Off-Screen)</option>
                                <option value="offscreen" ${d.presence === 'offscreen' ? 'selected' : ''}>Off-Screen Active</option>
                                <option value="onscreen" ${d.presence === 'onscreen' ? 'selected' : ''}>On-Screen in Scene</option>
                            </select>
                        </div>
                        <div class="lpe-field-col"><label class="lpe-field-lbl">Status / Health / Condition</label><input type="text" id="lpe_char_status" class="lpe-app-input" value="${esc(d.status)}" placeholder="Healthy, guarded, bruised ribs..." /></div>
                        <div class="lpe-field-col"><label class="lpe-field-lbl">Mood / Emotion</label><input type="text" id="lpe_char_mood" class="lpe-app-input" value="${esc(d.mood)}" placeholder="Calm, suspicious..." /></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Current Activity / Agenda</label><input type="text" id="lpe_char_agenda" class="lpe-app-input" value="${esc(d.agenda)}" placeholder="What they are currently doing or planning..." /></div>
                        <div class="lpe-field-col"><label class="lpe-field-lbl">Motivation (Why)</label><input type="text" id="lpe_char_why" class="lpe-app-input" value="${esc(d.why)}" /></div>
                        <div class="lpe-field-col"><label class="lpe-field-lbl">Goal (Off-screen)</label><input type="text" id="lpe_char_goal" class="lpe-app-input" value="${esc(d.goal)}" /></div>
                        <div class="lpe-field-col"><label class="lpe-field-lbl">End / Move</label><input type="text" id="lpe_char_end" class="lpe-app-input" value="${esc(d.end)}" /></div>
                        <div class="lpe-field-col"><label class="lpe-field-lbl">Salience / TFDY</label>
                            <div class="lpe-inline-actions" style="flex-wrap:nowrap;">
                                <input type="text" id="lpe_char_salience" class="lpe-app-input" value="${esc(d.salience)}" placeholder="sal:5" />
                                <input type="text" id="lpe_char_tfdy" class="lpe-app-input" value="${esc(d.tfdy)}" placeholder="T2 F2 D2 Y2" />
                            </div>
                        </div>
                        <div class="lpe-field-col wide">
                            <div class="lpe-inline-actions">
                                <label class="lpe-batch-check-wrap"><input type="checkbox" id="lpe_char_pinned" ${d.pinned !== false ? 'checked' : ''} /> <span>Pin against Smart-Scoping pruning</span></label>
                                <label class="lpe-batch-check-wrap"><input type="checkbox" id="lpe_char_manual" ${d.manual !== false ? 'checked' : ''} /> <span>Protect profile details during worker turns</span></label>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="lpe-glass-card">
                    <div class="lpe-card-title">2. Personality, Voice &amp; Boundaries</div>
                    <div class="lpe-form-grid">
                        <div class="lpe-field-col"><label class="lpe-field-lbl">Dialogue Color</label><select id="lpe_char_color" class="lpe-app-input">${colorOptions}</select></div>
                        <div class="lpe-field-col"><label class="lpe-field-lbl">Residual / Move Cue</label><input type="text" id="lpe_char_move" class="lpe-app-input" value="${esc(d.move || d.residualMood)}" /></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Personality Summary / Public Persona</label><textarea id="lpe_char_persona" class="lpe-app-input" rows="2">${esc(d.persona)}</textarea></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Voice &amp; Demeanor Notes</label><input type="text" id="lpe_char_voice" class="lpe-app-input" value="${esc(d.voice)}" /></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Appearance / Look</label><input type="text" id="lpe_char_look" class="lpe-app-input" value="${esc(d.look)}" /></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Key Traits, Boundaries &amp; Private Secrets</label><textarea id="lpe_char_private" class="lpe-app-input" rows="2">${esc(d.private)}</textarea></div>
                    </div>
                </div>

                <div class="lpe-glass-card">
                    <div class="lpe-card-head">
                        <div>
                            <div class="lpe-card-title">3. Bonds (${esc(userLabel)} &amp; Cast)</div>
                            <div class="lpe-card-sub">Synced with LPE Aether Pairs &amp; Dam channels.</div>
                        </div>
                        <div class="lpe-inline-actions">
                            <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_char_add_user_bond"><i class="fa-solid fa-heart-pulse"></i> + Bond with ${esc(userLabel)}</button>
                            <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_char_add_bond"><i class="fa-solid fa-plus"></i> + Add Bond</button>
                        </div>
                    </div>
                    <div class="lpe-stack" id="lpe_char_bonds_list">${bondsHtml}</div>
                </div>

                <div class="lpe-glass-card">
                    <div class="lpe-card-title">4. Location &amp; Atlas Placement</div>
                    <div class="lpe-form-grid">
                        <div class="lpe-field-col">
                            <label class="lpe-field-lbl">Atlas Room</label>
                            <select id="lpe_char_room" class="lpe-app-input" ${d.presence === 'staged' ? 'disabled' : ''}>
                                <option value="">(None / Off-screen zone only)</option>
                                ${rooms.map((r) => `<option value="${esc(r.id)}" ${r.id === d.roomId ? 'selected' : ''}>${esc(r.name || r.id)} (${esc(r.id)})</option>`).join('')}
                            </select>
                        </div>
                        <div class="lpe-field-col"><label class="lpe-field-lbl">Local Coords [x,y] or [x,y,z]</label><input type="text" id="lpe_char_pos" class="lpe-app-input lpe-mono" value="${esc(d.pos)}" placeholder="[3,4]" ${d.presence === 'staged' ? 'disabled' : ''} /></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Zone / Off-screen Location Label</label><input type="text" id="lpe_char_loc" class="lpe-app-input" value="${esc(d.loc)}" placeholder="Staged (Pre-Game), Harbor Pier 4..." /></div>
                    </div>
                </div>
            </div>
        `);

        wireCastToolbar($stage);

        const syncEditorDraftFromDom = () => {
            const readStr = (id, fallback) => {
                const $el = $stage.find(id);
                return $el.length && typeof $el.val === 'function' ? String($el.val() ?? '') : String(fallback ?? '');
            };
            d.name = readStr('#lpe_char_name', d.name).trim();
            d.presence = readStr('#lpe_char_presence', d.presence) || 'staged';
            d.preGameStaged = d.presence === 'staged';
            const $pin = $stage.find('#lpe_char_pinned');
            if ($pin.length && typeof $pin.prop === 'function') d.pinned = Boolean($pin.prop('checked'));
            const $man = $stage.find('#lpe_char_manual');
            if ($man.length && typeof $man.prop === 'function') d.manual = Boolean($man.prop('checked'));
            d.status = readStr('#lpe_char_status', d.status).trim();
            d.mood = readStr('#lpe_char_mood', d.mood).trim();
            d.agenda = readStr('#lpe_char_agenda', d.agenda).trim();
            d.why = readStr('#lpe_char_why', d.why).trim();
            d.goal = readStr('#lpe_char_goal', d.goal).trim();
            d.end = readStr('#lpe_char_end', d.end).trim();
            d.salience = readStr('#lpe_char_salience', d.salience).trim() || 'sal:5';
            d.tfdy = readStr('#lpe_char_tfdy', d.tfdy).trim() || 'T2 F2 D2 Y2';
            d.fontColor = readStr('#lpe_char_color', d.fontColor).trim();
            d.move = readStr('#lpe_char_move', d.move).trim();
            d.persona = readStr('#lpe_char_persona', d.persona).trim();
            d.voice = readStr('#lpe_char_voice', d.voice).trim();
            d.look = readStr('#lpe_char_look', d.look).trim();
            d.private = readStr('#lpe_char_private', d.private).trim();
            d.roomId = d.presence === 'staged' ? '' : readStr('#lpe_char_room', d.roomId).trim();
            d.pos = d.presence === 'staged' ? '' : readStr('#lpe_char_pos', d.pos).trim();
            d.loc = readStr('#lpe_char_loc', d.loc).trim();

            if (typeof $stage.find('#lpe_char_bonds_list .lpe-bond-card').each === 'function') {
                const rebuilt = [];
                $stage.find('#lpe_char_bonds_list .lpe-bond-card').each(function () {
                    const $row = $(this);
                    const target = String($row.find('.lpe-bond-target').val() ?? '').trim();
                    if (!target) return;
                    const axes = {};
                    $row.find('[data-bond-axis]').each(function () {
                        const k = String($(this).data('bond-axis'));
                        const n = parseInt($(this).val(), 10);
                        axes[k] = Number.isFinite(n) ? Math.max(3, Math.min(20, n)) : 3;
                    });
                    rebuilt.push({
                        target,
                        mode: String($row.find('.lpe-bond-mode').val() ?? 'mode:stranger').trim(),
                        dam: String($row.find('.lpe-bond-dam').val() ?? 'E:s L:s Gate:dormant').trim(),
                        sluice: String($row.find('.lpe-bond-sluice').val() ?? 'E:sealed L:sealed').trim(),
                        wall: String($row.find('.lpe-bond-wall').val() ?? 'wall:∅').trim(),
                        intent: String($row.find('.lpe-bond-intent').val() ?? '').trim(),
                        axes,
                        matrix: buildMatrixStringFromAxes(axes),
                    });
                });
                if ($stage.find('#lpe_char_bonds_list .lpe-bond-card').length > 0) {
                    d.bonds = rebuilt;
                }
            }
        };

        $stage.on('change', '#lpe_char_presence', () => {
            syncEditorDraftFromDom();
            renderActiveTab({ resetScroll: false });
        });
        $stage.on('click', '#lpe_char_add_user_bond, #lpe_char_add_bond', function () {
            syncEditorDraftFromDom();
            const isUserBtn = this?.id === 'lpe_char_add_user_bond';
            const preset = BOND_PRESETS.ally;
            const target = isUserBtn ? userLabel : '';
            if (isUserBtn && d.bonds.some((b) => isPlayerPersonaName(b.target, userName) || normalizeNameKey(b.target) === normalizeNameKey(userLabel))) {
                return;
            }
            d.bonds.push({
                target,
                mode: preset.mode,
                dam: preset.dam,
                wall: preset.wall,
                sluice: preset.sluice,
                intent: '',
                axes: { ...preset.axes },
                matrix: buildMatrixStringFromAxes(preset.axes),
            });
            renderActiveTab({ resetScroll: false });
        });
        $stage.on('change', '.lpe-bond-preset', function () {
            const presetKey = String($(this).val() || '');
            if (!presetKey) return;
            syncEditorDraftFromDom();
            const $card = $(this).closest('.lpe-bond-card');
            const idx = Number($card.data('bond-idx'));
            const preset = resolveBondPreset(presetKey);
            if (d.bonds[idx]) {
                d.bonds[idx] = {
                    ...d.bonds[idx],
                    mode: preset.mode,
                    dam: preset.dam,
                    wall: preset.wall,
                    sluice: preset.sluice,
                    axes: { ...preset.axes },
                    matrix: buildMatrixStringFromAxes(preset.axes),
                };
            }
            renderActiveTab({ resetScroll: false });
        });
        $stage.on('click', '.lpe-bond-remove', function () {
            syncEditorDraftFromDom();
            const idx = Number($(this).data('bond-idx'));
            const removed = d.bonds.splice(idx, 1)[0];
            if (removed?.target) editorRemovedBondTargets.push(removed.target);
            renderActiveTab({ resetScroll: false });
        });
        $stage.on('click', '#lpe_char_cancel_btn', () => {
            castMode = 'list';
            editorDraft = null;
            editingCharName = null;
            renderActiveTab({ resetScroll: true });
        });
        $stage.on('click', '#lpe_char_delete_btn', () => {
            if (!editingCharName) return;
            const rm = editingCharName;
            castMode = 'list';
            editorDraft = null;
            editingCharName = null;
            commitDeltaEdit({ character_remove: [rm] }, `Removed "${rm}" from cast.`);
        });
        $stage.on('click', '#lpe_char_save_btn', () => {
            syncEditorDraftFromDom();
            if (!d.name) {
                $('#lpe_char_err').text('Character name is required.');
                return;
            }
            if (isPlayerPersonaName(d.name, userName)) {
                $('#lpe_char_err').text(`"${d.name}" matches the active human player persona (${userLabel}) and cannot be saved as an NPC.`);
                return;
            }
            const delta = buildCharacterUpsertDelta(d, {
                prevName: editingCharName || '',
                userName,
                removedBondTargets: editorRemovedBondTargets,
            });
            const savedName = d.name;
            castMode = 'list';
            subTabs.cast = 'entities';
            editorDraft = null;
            editingCharName = null;
            editorRemovedBondTargets = [];
            commitDeltaEdit(delta, `Saved character "${savedName}".`);
        });
    }

    function renderRelationsTab($stage, state) {
        const meta = tabMeta('relations');
        const sub = subTabs.relations || 'pair';
        const tl = store?.timeline?.();
        let prevPairList = null;
        if (tl?.steps?.length) {
            const targetStep = typeof inspectSeq === 'number'
                ? tl.steps.find((st) => st.seq === inspectSeq)
                : tl.steps[tl.steps.length - 1];
            prevPairList = targetStep?.prevState?.pair || null;
        }
        const subBar = `
            <div class="lpe-subtabs">
                <button type="button" class="${sub === 'pair' ? 'on' : ''}" data-sub="pair"><i class="fa-solid fa-heart-pulse"></i> Aether Pairs (${(state.pair || []).length})</button>
                <button type="button" class="${sub === 'dam' ? 'on' : ''}" data-sub="dam"><i class="fa-solid fa-water"></i> Aether Dam (${(state.dam || []).length})</button>
            </div>
        `;
        const cards = sub === 'pair'
            ? `<div class="lpe-matrix-theme-host">${renderAetherMatrixList(state.pair || [], prevPairList, { showGuide: true })}</div>`
            : ((state.dam || []).length
                ? `<div class="lpe-cards-grid">${state.dam.map((d) => `
                    <div class="lpe-glass-card lpe-compact-card">
                        <div class="lpe-npc-title-row"><strong>${esc(d.pair)}</strong><span class="lpe-chip">${esc(d.sluice)}</span></div>
                        <div class="lpe-kv-line"><span>Filters:</span> ${esc(d.filters)}</div>
                        <div class="lpe-kv-line"><span>Misc:</span> ${esc(d.misc)}</div>
                        <div class="lpe-kv-line"><span>Intent:</span> ${esc(d.intent)}</div>
                    </div>
                `).join('')}</div>`
                : '<div class="lpe-glass-card lpe-muted">No Aether Dam records.</div>');

        const editObj = sub === 'pair' ? (state.pair || []) : (state.dam || []);
        $stage.html(`
            ${renderPageHeader(meta)}
            ${historyBannerHtml(state)}
            ${subBar}
            ${cards}
            <details class="lpe-glass-card lpe-fold-card">
                <summary class="lpe-fold-summary"><i class="fa-solid fa-code"></i> Edit ${esc(sub)} JSON</summary>
                <div class="lpe-fold-body">
                    <textarea id="lpe_pop_rel_json" class="lpe-app-input lpe-mono" rows="12">${esc(JSON.stringify(editObj, null, 2))}</textarea>
                    <div class="lpe-inline-actions">
                        <span class="lpe-err-text" id="lpe_pop_rel_err"></span>
                        <button type="button" class="lpe-app-btn primary" id="lpe_pop_save_rel"><i class="fa-solid fa-floppy-disk"></i> Save Relations</button>
                    </div>
                </div>
            </details>
        `);
        if (sub === 'pair') {
            applyThemeVarsToEl($stage.find('.lpe-matrix-theme-host'), getSettings().hudTheme || 'Magnum Opus');
        }

        $stage.find('.lpe-subtabs').on('click', 'button', function () {
            subTabs.relations = String($(this).data('sub') || 'pair');
            renderActiveTab({ resetScroll: false });
        });
        $stage.find('#lpe_pop_save_rel').on('click', () => {
            $('#lpe_pop_rel_err').text('');
            try {
                const parsed = JSON.parse(String($stage.find('#lpe_pop_rel_json').val() || '[]'));
                const draft = cloneState(state);
                draft[sub] = parsed;
                commitEditedState(draft, `Saved ${sub === 'pair' ? 'Aether Pairs' : 'Aether Dam'}.`);
            } catch (err) {
                $('#lpe_pop_rel_err').text(`Invalid JSON: ${err.message}`);
            }
        });
    }

    function renderNarrativeTab($stage, state) {
        const meta = tabMeta('narrative');
        const sub = subTabs.narrative || 'chekhov';
        const subList = [
            { id: 'chekhov', label: 'Chekhov', icon: 'fa-crosshairs' },
            { id: 'notebook', label: 'Notebook', icon: 'fa-book' },
            { id: 'tracks', label: 'Tracks & ARC', icon: 'fa-route' },
            { id: 'inv', label: 'Inv & Notes', icon: 'fa-suitcase' },
            { id: 'vent', label: 'Vent', icon: 'fa-fire' },
            { id: 'receipt', label: 'CoT Receipt', icon: 'fa-receipt' },
        ];
        const subBar = `
            <div class="lpe-subtabs">
                ${subList.map((s) => `<button type="button" class="${s.id === sub ? 'on' : ''}" data-sub="${s.id}"><i class="fa-solid ${s.icon}"></i> ${esc(s.label)}</button>`).join('')}
            </div>
        `;

        let bodyHtml = '';
        if (sub === 'chekhov') {
            const ch = state.chekhov || {};
            bodyHtml = `
                <div class="lpe-glass-card">
                    <div class="lpe-card-head">
                        <div class="lpe-card-title">Chekhov's Gun Registry</div>
                        <button type="button" class="lpe-app-btn primary" id="lpe_pop_save_chekhov"><i class="fa-solid fa-floppy-disk"></i> Save Chekhov</button>
                    </div>
                    <div class="lpe-form-grid">
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Chambered (${(ch.chamber || []).length}/20)</label><textarea class="lpe-app-input" rows="5" data-pop-ch="chamber">${esc((ch.chamber || []).join('\n'))}</textarea></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Locked (${(ch.locked || []).length}/20)</label><textarea class="lpe-app-input" rows="5" data-pop-ch="locked">${esc((ch.locked || []).join('\n'))}</textarea></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Fired This Turn (${(ch.fired || []).length})</label><textarea class="lpe-app-input" rows="3" data-pop-ch="fired">${esc((ch.fired || []).join('\n'))}</textarea></div>
                    </div>
                </div>
            `;
        } else if (sub === 'notebook') {
            const nb = state.notebook || [];
            const badgesPreview = nb.length
                ? `<ul class="lpe-clean-list">${nb.map((ent) => {
                    const m = ent.match(/^\s*(\[[RTD]\])\s*([\s\S]*)$/);
                    if (!m) return `<li>${esc(ent)}</li>`;
                    const cls = m[1] === '[R]' ? 'rule' : m[1] === '[T]' ? 'thread' : 'debug';
                    return `<li><span class="lpe-nb-badge ${cls}">${esc(m[1])}</span> ${esc(m[2])}</li>`;
                }).join('')}</ul>`
                : '<div class="lpe-muted">Notebook is empty.</div>';
            bodyHtml = `
                <div class="lpe-glass-card">
                    <div class="lpe-card-head">
                        <div>
                            <div class="lpe-card-title">Pinned Notebook (${nb.length}/20)</div>
                            <div class="lpe-card-sub">Prefix entries with [R] (pinned Rule), [T] (Thread), or [D] (Debug/Sim).</div>
                        </div>
                        <button type="button" class="lpe-app-btn primary" id="lpe_pop_save_nb"><i class="fa-solid fa-floppy-disk"></i> Save Notebook</button>
                    </div>
                    <div class="lpe-inline-actions" style="justify-content:stretch;">
                        <input type="text" id="lpe_pop_new_rule" class="lpe-app-input" placeholder="Quick-add [R] rule (e.g. [R] Keep prose grounded)" />
                        <button type="button" class="lpe-app-btn secondary" id="lpe_pop_add_rule"><i class="fa-solid fa-plus"></i> Add [R]</button>
                    </div>
                    <textarea id="lpe_pop_nb_txt" class="lpe-app-input" rows="9">${esc(nb.join('\n'))}</textarea>
                    ${badgesPreview}
                </div>
            `;
        } else if (sub === 'tracks') {
            const tr = state.tracks || {};
            const a = state.arc || {};
            bodyHtml = `
                <div class="lpe-glass-card lpe-compact-card">
                    <div class="lpe-card-title">Active Tracks</div>
                    <div class="lpe-kv-line"><span>Main:</span> ${esc(tr.main || '∅')}</div>
                    ${(tr.tracks || []).map((x) => `<div class="lpe-kv-line"><span>Track:</span> ${esc(x)}</div>`).join('')}
                    ${(tr.history || []).length ? `<ul class="lpe-clean-list">${tr.history.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
                </div>
                <div class="lpe-glass-card lpe-compact-card">
                    <div class="lpe-card-title">ARC (Kishōtenketsu)</div>
                    ${isEmptySentinel(a.info) && !a.ki?.length
                        ? '<div class="lpe-muted">ARC Engine in Ki phase (no active ARC generated yet).</div>'
                        : `<div class="lpe-kv-line"><span>Info:</span> ${esc(a.info)}</div>
                           <div class="lpe-kv-line"><span>Timeline:</span> ${esc(a.timeline)}</div>
                           ${['ki', 'sho', 'ten', 'ketsu'].map((act) => `<div class="lpe-kv-line"><span>${act.toUpperCase()}:</span> ${(a[act] || ['∅']).map(esc).join(' · ')}</div>`).join('')}`}
                </div>
                <details class="lpe-glass-card lpe-fold-card">
                    <summary class="lpe-fold-summary"><i class="fa-solid fa-code"></i> Edit Tracks &amp; ARC JSON</summary>
                    <div class="lpe-fold-body">
                        <textarea id="lpe_pop_ta_json" class="lpe-app-input lpe-mono" rows="12">${esc(JSON.stringify({ tracks: tr, arc: a }, null, 2))}</textarea>
                        <div class="lpe-inline-actions">
                            <span class="lpe-err-text" id="lpe_pop_ta_err"></span>
                            <button type="button" class="lpe-app-btn primary" id="lpe_pop_save_ta"><i class="fa-solid fa-floppy-disk"></i> Save Tracks &amp; ARC</button>
                        </div>
                    </div>
                </details>
            `;
        } else if (sub === 'inv') {
            const inv = state.inv || {};
            const sn = state.story_notes || {};
            bodyHtml = `
                <div class="lpe-glass-card">
                    <div class="lpe-card-head">
                        <div class="lpe-card-title">Inventory, Story Notes &amp; Vent</div>
                        <button type="button" class="lpe-app-btn primary" id="lpe_pop_save_inv"><i class="fa-solid fa-floppy-disk"></i> Save Inv &amp; Notes</button>
                    </div>
                    <div class="lpe-form-grid">
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Inventory</label><textarea class="lpe-app-input" rows="2" data-pop-inv="inv">${esc(inv.inv)}</textarea></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Titles &amp; Modifiers</label><input type="text" class="lpe-app-input" data-pop-inv="titles" value="${esc(inv.titles)}" /></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Status &amp; Conditions</label><textarea class="lpe-app-input" rows="2" data-pop-inv="status">${esc(inv.status)}</textarea></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Threads</label><textarea class="lpe-app-input" rows="2" data-pop-sn="threads">${esc(sn.threads)}</textarea></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Seeds</label><textarea class="lpe-app-input" rows="2" data-pop-sn="seeds">${esc(sn.seeds)}</textarea></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Motives</label><textarea class="lpe-app-input" rows="2" data-pop-sn="motives">${esc(sn.motives)}</textarea></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Horizon</label><textarea class="lpe-app-input" rows="2" data-pop-sn="horizon">${esc(sn.horizon)}</textarea></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">GremlinNote</label><textarea class="lpe-app-input" rows="2" data-pop-sn="GremlinNote">${esc(sn.GremlinNote)}</textarea></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Heckle</label><textarea class="lpe-app-input" rows="2" data-pop-sn="heckle">${esc(sn.heckle)}</textarea></div>
                        <div class="lpe-field-col wide"><label class="lpe-field-lbl">Vent</label><textarea class="lpe-app-input" rows="2" data-pop-vent="1">${esc(state.vent)}</textarea></div>
                    </div>
                </div>
            `;
        } else if (sub === 'vent') {
            bodyHtml = `
                <div class="lpe-glass-card">
                    <div class="lpe-card-title">Main Model Vent (&lt;state:vent&gt;)</div>
                    <div class="lpe-vent-text">${esc(state.vent || '∅')}</div>
                </div>
            `;
        } else {
            const rc = state.lastReceipt;
            const kvRows = rc ? [
                rc.world_sim && !isEmptySentinel(rc.world_sim) ? `<div><span>world_sim</span><b>${esc(rc.world_sim)}</b></div>` : '',
                rc.chekhov && !isEmptySentinel(rc.chekhov) ? `<div><span>chekhov</span><b>${esc(rc.chekhov)}</b></div>` : '',
                rc.arc && !isEmptySentinel(rc.arc) ? `<div><span>arc</span><b>${esc(rc.arc)}</b></div>` : '',
                rc.ooc && !isEmptySentinel(rc.ooc) ? `<div><span>ooc</span><b>${esc(rc.ooc)}</b></div>` : '',
            ].filter(Boolean).join('') : '';
            bodyHtml = `
                <div class="lpe-glass-card">
                    <div class="lpe-card-title">Last CoT Receipt (&lt;lpe_receipt&gt;)</div>
                    ${kvRows ? `<div class="lpe-kv-grid lpe-receipt-kv" style="margin-bottom:8px;">${kvRows}</div>` : ''}
                    ${rc?.raw ? `<pre class="lpe-pre">${esc(rc.raw)}</pre>` : '<div class="lpe-muted">No receipt recorded for this turn.</div>'}
                </div>
            `;
        }

        $stage.html(`${renderPageHeader(meta)}${historyBannerHtml(state)}${subBar}${bodyHtml}`);

        $stage.find('.lpe-subtabs').on('click', 'button', function () {
            subTabs.narrative = String($(this).data('sub') || 'chekhov');
            renderActiveTab({ resetScroll: false });
        });
        $stage.find('#lpe_pop_save_chekhov').on('click', () => {
            const draft = cloneState(state);
            for (const b of ['chamber', 'locked', 'fired']) {
                const raw = String($stage.find(`[data-pop-ch="${b}"]`).val() ?? '');
                draft.chekhov[b] = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l !== '∅');
            }
            commitEditedState(draft, 'Saved Chekhov registry.');
        });
        $stage.find('#lpe_pop_add_rule').on('click', () => {
            const val = String($stage.find('#lpe_pop_new_rule').val() || '').trim();
            if (!val) return;
            const formatted = /^\s*\[[RTD]\]/i.test(val) ? val : `[R] ${val}`;
            const cur = String($stage.find('#lpe_pop_nb_txt').val() || '').trim();
            $stage.find('#lpe_pop_nb_txt').val(cur ? `${formatted}\n${cur}` : formatted);
            $stage.find('#lpe_pop_new_rule').val('');
        });
        $stage.find('#lpe_pop_save_nb').on('click', () => {
            const raw = String($stage.find('#lpe_pop_nb_txt').val() ?? '');
            const draft = cloneState(state);
            draft.notebook = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 20);
            commitEditedState(draft, 'Saved Notebook entries.');
        });
        $stage.find('#lpe_pop_save_ta').on('click', () => {
            $('#lpe_pop_ta_err').text('');
            try {
                const parsed = JSON.parse(String($stage.find('#lpe_pop_ta_json').val() || '{}'));
                const draft = cloneState(state);
                if (parsed.tracks) draft.tracks = parsed.tracks;
                if (parsed.arc) draft.arc = parsed.arc;
                commitEditedState(draft, 'Saved Tracks & ARC.');
            } catch (err) {
                $('#lpe_pop_ta_err').text(`Invalid JSON: ${err.message}`);
            }
        });
        $stage.find('#lpe_pop_save_inv').on('click', () => {
            const draft = cloneState(state);
            for (const k of ['inv', 'titles', 'status']) {
                draft.inv[k] = String($stage.find(`[data-pop-inv="${k}"]`).val() ?? '');
            }
            for (const k of ['threads', 'seeds', 'motives', 'horizon', 'GremlinNote', 'heckle']) {
                draft.story_notes[k] = String($stage.find(`[data-pop-sn="${k}"]`).val() ?? '');
            }
            draft.vent = String($stage.find('[data-pop-vent]').val() ?? '');
            commitEditedState(draft, 'Saved Inventory & Story Notes.');
        });
    }

    function renderWorkerTab($stage, settings) {
        const meta = tabMeta('worker');
        const profiles = getChatCompletionProfiles();
        const mode = settings.workerTransport || 'direct';

        $stage.html(`
            ${renderPageHeader({
                ...meta,
                badgeHtml: `<span class="lpe-head-badge ${mode === 'profile' ? 'ok' : ''}">${mode === 'direct' ? 'Direct OpenAI-Compatible' : 'ST Connection Profile'}</span>`,
            })}
            <div class="lpe-glass-card">
                <div class="lpe-card-title">Worker Transport</div>
                ${renderTiles('transport', [
                    { id: 'direct', label: 'Direct OpenAI-Compatible', desc: 'Uses Base URL + API Key + Model via ST reverse-proxy (zero profile switching).' },
                    { id: 'profile', label: 'ST Connection Profile', desc: 'Dispatches via SillyTavern ConnectionManagerRequestService without switching.' },
                ], mode)}
                <div class="lpe-banner">
                    <i class="fa-solid fa-shield-halved"></i>
                    <span>LPE Clerk runs without a heavy jailbreak. Use an uncensored or low-refusal fast model (e.g. <b>GLM 5.3 Flash</b> or <b>DeepSeek 4.1 Flash</b>) to avoid safety refusals on mature roleplay turns.</span>
                </div>
            </div>

            <div class="lpe-glass-card" id="lpe_pop_direct_card" style="display:${mode === 'direct' ? 'flex' : 'none'};">
                <div class="lpe-card-title">Direct Endpoint Credentials</div>
                <div class="lpe-form-grid">
                    <div class="lpe-field-col wide">
                        <label class="lpe-field-lbl">Base URL <small>(e.g. https://api.openai.com/v1)</small></label>
                        <input id="lpe_pop_w_url" type="text" class="lpe-app-input" value="${esc(settings.workerBaseUrl || '')}" placeholder="https://api.openai.com/v1" />
                    </div>
                    <div class="lpe-field-col wide">
                        <label class="lpe-field-lbl">API Key</label>
                        <div class="lpe-inline-actions" style="justify-content:stretch;">
                            <input id="lpe_pop_w_key" type="${apiKeyVisible ? 'text' : 'password'}" class="lpe-app-input" autocomplete="off" value="${esc(settings.workerApiKey || '')}" placeholder="sk-..." />
                            <button id="lpe_pop_w_eye" type="button" class="lpe-app-btn secondary" title="Show/Hide Key"><i class="fa-solid fa-${apiKeyVisible ? 'eye-slash' : 'eye'}"></i></button>
                        </div>
                    </div>
                    <div class="lpe-field-col wide">
                        <label class="lpe-field-lbl">Model ID</label>
                        <div class="lpe-inline-actions" style="justify-content:stretch;">
                            <input id="lpe_pop_w_model" type="text" class="lpe-app-input" value="${esc(settings.workerModel || '')}" placeholder="deepseek-v4.1-flash / glm-5.3-flash" />
                            <button id="lpe_pop_fetch_models" type="button" class="lpe-app-btn secondary"><i class="fa-solid fa-cloud-arrow-down"></i> Fetch Models</button>
                        </div>
                        <select id="lpe_pop_fetched_models" class="lpe-app-input" style="display:${fetchedModels.length ? 'block' : 'none'};margin-top:6px;">
                            <option value="">-- Pick fetched model (${fetchedModels.length}) --</option>
                            ${fetchedModels.map((m) => `<option value="${esc(m)}" ${m === settings.workerModel ? 'selected' : ''}>${esc(m)}</option>`).join('')}
                        </select>
                    </div>
                </div>
            </div>

            <div class="lpe-glass-card" id="lpe_pop_profile_card" style="display:${mode === 'profile' ? 'flex' : 'none'};">
                <div class="lpe-card-title">SillyTavern Connection Profile</div>
                <div class="lpe-inline-actions" style="justify-content:stretch;">
                    <select id="lpe_pop_w_profile" class="lpe-app-input">
                        <option value="">-- Select Chat Completion Profile --</option>
                        ${profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === settings.workerProfileId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                    </select>
                    <button id="lpe_pop_refresh_profiles" type="button" class="lpe-app-btn secondary"><i class="fa-solid fa-rotate"></i> Refresh</button>
                </div>
            </div>

            <div class="lpe-glass-card">
                <div class="lpe-card-title">Call Mode &amp; Generation Parameters</div>
                ${renderTiles('workermode', [
                    { id: 'combined', label: 'Combined (1 call / turn)', desc: 'Sends one delta-extraction request for all state sections per turn.' },
                    { id: 'split', label: 'Split (2 calls / turn)', desc: 'Splits spatial/entities and narrative/thoughts across 2 smaller calls.' },
                ], settings.workerMode || 'combined')}
                <div class="lpe-form-grid">
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Max Tokens</label>
                        <input id="lpe_pop_w_tokens" type="number" min="512" max="32768" step="256" class="lpe-app-input" value="${esc(settings.workerMaxTokens || 8192)}" />
                    </div>
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Temperature</label>
                        <input id="lpe_pop_w_temp" type="number" min="0" max="2" step="0.05" class="lpe-app-input" value="${esc(settings.workerTemperature ?? 0.25)}" />
                    </div>
                </div>
                <div class="lpe-inline-actions" style="justify-content:flex-start;">
                    <button id="lpe_pop_test_worker" type="button" class="lpe-app-btn gold"><i class="fa-solid fa-vial"></i> Test Worker Connection</button>
                </div>
                <div id="lpe_pop_test_result">
                    ${workerTestResult ? `<div class="lpe-banner ${workerTestResult.ok ? 'ok' : 'red'}"><i class="fa-solid ${workerTestResult.ok ? 'fa-circle-check' : 'fa-circle-xmark'}"></i><span>${esc(workerTestResult.text)}</span></div>` : ''}
                </div>
            </div>
        `);

        $stage.find('[data-tile-group="transport"]').on('click', '.lpe-tile', function () {
            const val = String($(this).data('tile-val') || 'direct');
            getSettings().workerTransport = val;
            notifySettingsChanged();
            renderWorkerTab($stage, getSettings());
        });
        $stage.find('[data-tile-group="workermode"]').on('click', '.lpe-tile', function () {
            const val = String($(this).data('tile-val') || 'combined');
            getSettings().workerMode = val;
            $(this).siblings().removeClass('on');
            $(this).addClass('on');
            notifySettingsChanged();
        });
        $stage.find('#lpe_pop_w_url').on('input change', function () { getSettings().workerBaseUrl = String($(this).val() ?? '').trim(); notifySettingsChanged(); });
        $stage.find('#lpe_pop_w_key').on('input change', function () { getSettings().workerApiKey = String($(this).val() ?? '').trim(); notifySettingsChanged(); });
        $stage.find('#lpe_pop_w_eye').on('click', () => { apiKeyVisible = !apiKeyVisible; renderWorkerTab($stage, getSettings()); });
        $stage.find('#lpe_pop_w_model').on('input change', function () { getSettings().workerModel = String($(this).val() ?? '').trim(); notifySettingsChanged(); });
        $stage.find('#lpe_pop_fetched_models').on('change', function () {
            const v = String($(this).val() || '');
            if (v) {
                getSettings().workerModel = v;
                $stage.find('#lpe_pop_w_model').val(v);
                notifySettingsChanged();
            }
        });
        $stage.find('#lpe_pop_w_profile').on('change', function () { getSettings().workerProfileId = String($(this).val() ?? ''); notifySettingsChanged(); });
        $stage.find('#lpe_pop_refresh_profiles').on('click', () => renderWorkerTab($stage, getSettings()));
        $stage.find('#lpe_pop_w_tokens').on('change', function () { getSettings().workerMaxTokens = Math.max(256, parseInt($(this).val(), 10) || 8192); notifySettingsChanged(); });
        $stage.find('#lpe_pop_w_temp').on('change', function () { getSettings().workerTemperature = Number($(this).val()) || 0.25; notifySettingsChanged(); });

        $stage.find('#lpe_pop_fetch_models').on('click', async function () {
            const $btn = $(this);
            $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Fetching...');
            try {
                const sNow = getSettings();
                fetchedModels = await fetchModelsList({ baseUrl: sNow.workerBaseUrl, apiKey: sNow.workerApiKey, ctx: getContextSafe() });
                workerTestResult = { ok: true, text: `Loaded ${fetchedModels.length} models.` };
            } catch (err) {
                workerTestResult = { ok: false, text: extractErrorMessage(err) };
            } finally {
                if (isAnyUiOpen() && activeTab === 'worker') renderWorkerTab($stage, getSettings());
            }
        });

        $stage.find('#lpe_pop_test_worker').on('click', async function () {
            const $btn = $(this);
            $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Testing...');
            try {
                const ans = await workerClient.testConnection();
                workerTestResult = { ok: true, text: `Connected cleanly: ${ans.slice(0, 80) || 'OK'}` };
            } catch (err) {
                workerTestResult = { ok: false, text: `Connection failed: ${extractErrorMessage(err)}` };
            } finally {
                if (isAnyUiOpen() && activeTab === 'worker') renderWorkerTab($stage, getSettings());
            }
        });
    }

    function renderRetryTab($stage, settings) {
        const meta = tabMeta('retry');
        const r = settings.retry || {};
        const enabled = r.enabled !== false;

        $stage.html(`
            ${renderPageHeader({
                ...meta,
                badgeHtml: `<span class="lpe-head-badge ${enabled ? 'ok' : ''}">${enabled ? 'ACTIVE GUARD' : 'DISABLED'}</span>`,
            })}
            <div class="lpe-glass-card">
                ${renderSwitchRow({
                    id: 'lpe_pop_retry_enabled',
                    icon: 'fa-shield-halved',
                    color: '#10b981',
                    label: 'Enable built-in Refusal Auto-Retry &amp; End-Marker Guard',
                    desc: 'Intercepts refusals and truncated state tails before the worker processes them. Automatically supersedes standalone ST-VexaRefusalAutoRetry when on.',
                    on: enabled,
                })}
            </div>
            <div class="lpe-stack" id="lpe_pop_retry_details" style="display:${enabled ? 'flex' : 'none'};">
                <div class="lpe-glass-card">
                    <div class="lpe-card-title">Validation Mode &amp; End Marker</div>
                    ${renderTiles('formatmode', [
                        { id: 'auto', label: 'Auto-Detect', desc: 'Checks either <lpe_tail> (or legacy <vexa_tail>) or <internal_states> plus trailing GFX_END.' },
                        { id: 'external', label: 'External State', desc: 'Requires <lpe_tail> (or legacy <vexa_tail>) closed cleanly and ending in GFX_END.' },
                        { id: 'classic', label: 'Classic XML', desc: 'Requires <internal_states> closed cleanly and ending in GFX_END.' },
                        { id: 'marker', label: 'Marker Only', desc: 'Validates only the trailing end marker.' },
                    ], r.formatMode || 'auto')}
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Required End Marker</label>
                        <input id="lpe_pop_retry_marker" type="text" class="lpe-app-input" value="${esc(r.endMarker || DEFAULT_END_MARKER)}" />
                    </div>
                </div>

                <div class="lpe-glass-card">
                    <div class="lpe-card-title">Behavior &amp; Limits</div>
                    ${renderSwitchRow({
                        id: 'lpe_pop_retry_nsc',
                        icon: 'fa-forward',
                        color: '#38bdf8',
                        label: 'Show “Continue (No Stream)” Send-Bar Button &amp; Options Item',
                        desc: 'Temporarily holds streaming OFF during Continue so truncation / refusals complete cleanly.',
                        on: r.showNonStreamContinue !== false,
                    })}
                    ${renderSwitchRow({
                        id: 'lpe_pop_retry_req_end',
                        icon: 'fa-flag-checkered',
                        color: '#f59e0b',
                        label: 'Require Reply to End With End Marker',
                        desc: 'Triggers non-stream regenerate when a reply truncates before closing GFX_END.',
                        on: r.requireEndMarker !== false,
                    })}
                    ${renderSwitchRow({
                        id: 'lpe_pop_retry_toasts',
                        icon: 'fa-bell',
                        color: '#a855f7',
                        label: 'Show Toast Notification on Each Retry',
                        desc: 'Displays a concise status toast when regenerating a refusal or truncated reply.',
                        on: r.showStatusToasts !== false,
                    })}
                    ${renderSwitchRow({
                        id: 'lpe_pop_retry_modal',
                        icon: 'fa-triangle-exclamation',
                        color: '#ef4444',
                        label: 'Show Modal Popup on Max Failures',
                        desc: 'Alerts if max consecutive incomplete or refusal retries are reached.',
                        on: r.useModalPopup !== false,
                    })}
                    <div class="lpe-form-grid">
                        <div class="lpe-field-col"><label class="lpe-field-lbl">Max Incomplete Retries</label><input id="lpe_pop_retry_max_inc" type="number" min="0" max="20" step="1" class="lpe-app-input" value="${esc(r.maxIncompleteRetries ?? 3)}" /></div>
                        <div class="lpe-field-col"><label class="lpe-field-lbl">Max Refusal Retries (0=∞)</label><input id="lpe_pop_retry_max_ref" type="number" min="0" max="50" step="1" class="lpe-app-input" value="${esc(r.maxRefusalRetries ?? 0)}" /></div>
                        <div class="lpe-field-col"><label class="lpe-field-lbl">Retry Delay (ms)</label><input id="lpe_pop_retry_delay" type="number" min="0" max="10000" step="50" class="lpe-app-input" value="${esc(r.retryDelayMs ?? 300)}" /></div>
                    </div>
                </div>

                <div class="lpe-glass-card">
                    <div class="lpe-card-head">
                        <div>
                            <div class="lpe-card-title">Custom Refusal Patterns &amp; Manual Cleanup</div>
                            <div class="lpe-card-sub">One phrase or /regex/i pattern per line.</div>
                        </div>
                        <button type="button" id="lpe_pop_clean_last" class="lpe-app-btn secondary"><i class="fa-solid fa-broom"></i> Clean Refusal From Last Reply</button>
                    </div>
                    <textarea id="lpe_pop_retry_patterns" class="lpe-app-input lpe-mono" rows="4" placeholder="I am Gemini Enterprise&#10;/cannot participate in .* roleplay/i">${esc(r.customPatterns || '')}</textarea>
                </div>
            </div>
        `);

        const ensureRetryCfg = () => {
            const st = getSettings();
            if (!st.retry || typeof st.retry !== 'object') st.retry = {};
            return st.retry;
        };

        $stage.find('#lpe_pop_retry_enabled').on('click', () => {
            const cfg = ensureRetryCfg();
            cfg.enabled = !(cfg.enabled !== false);
            notifySettingsChanged({ retryChanged: true });
            renderRetryTab($stage, getSettings());
        });
        $stage.find('[data-tile-group="formatmode"]').on('click', '.lpe-tile', function () {
            ensureRetryCfg().formatMode = String($(this).data('tile-val') || 'auto');
            $(this).siblings().removeClass('on');
            $(this).addClass('on');
            notifySettingsChanged();
        });
        $stage.find('#lpe_pop_retry_marker').on('input change', function () {
            ensureRetryCfg().endMarker = String($(this).val() ?? '') || DEFAULT_END_MARKER;
            notifySettingsChanged();
        });
        const wireRetrySwitch = (sel, key, triggerRetrySync = false) => {
            $stage.find(sel).on('click', function () {
                const cfg = ensureRetryCfg();
                const next = !(cfg[key] !== false);
                cfg[key] = next;
                $(this).toggleClass('active', next).attr('aria-checked', String(next));
                notifySettingsChanged({ retryChanged: triggerRetrySync });
            });
        };
        wireRetrySwitch('#lpe_pop_retry_nsc', 'showNonStreamContinue', true);
        wireRetrySwitch('#lpe_pop_retry_req_end', 'requireEndMarker');
        wireRetrySwitch('#lpe_pop_retry_toasts', 'showStatusToasts');
        wireRetrySwitch('#lpe_pop_retry_modal', 'useModalPopup');

        $stage.find('#lpe_pop_retry_max_inc').on('input change', function () {
            const v = parseInt(String($(this).val()), 10);
            if (!Number.isNaN(v) && v >= 0 && v <= 20) { ensureRetryCfg().maxIncompleteRetries = v; notifySettingsChanged(); }
        });
        $stage.find('#lpe_pop_retry_max_ref').on('input change', function () {
            const v = parseInt(String($(this).val()), 10);
            if (!Number.isNaN(v) && v >= 0 && v <= 50) { ensureRetryCfg().maxRefusalRetries = v; notifySettingsChanged(); }
        });
        $stage.find('#lpe_pop_retry_delay').on('input change', function () {
            const v = parseInt(String($(this).val()), 10);
            if (!Number.isNaN(v) && v >= 0 && v <= 10000) { ensureRetryCfg().retryDelayMs = v; notifySettingsChanged(); }
        });
        $stage.find('#lpe_pop_retry_patterns').on('input change', function () {
            ensureRetryCfg().customPatterns = String($(this).val() ?? '');
            notifySettingsChanged();
        });
        $stage.find('#lpe_pop_clean_last').on('click', () => onCleanLastRefusal?.());
    }

    function fieldsToLines(fields) {
        return Object.entries(fields || {}).map(([k, v]) => `${k}=${v}`).join('\n');
    }

    function linesToFields(text) {
        const out = {};
        let count = 0;
        for (const rawLine of String(text || '').split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line) continue;
            const m = line.match(/^([^=:]+?)\s*[=:]\s*(.*)$/);
            if (!m) continue;
            const key = m[1].trim();
            if (!key) continue;
            if (!(key in out)) {
                if (count >= 8) break;
                count++;
            }
            out[key] = m[2].trim();
        }
        return out;
    }

    function renderCustomTrackersTab($stage, state, settings) {
        const meta = tabMeta('trackers');
        const allowProposals = settings.allowTrackerProposals !== false;
        const autoAccept = Boolean(settings.autoAcceptTrackerProposals);
        const proposals = state.tracker_proposals || [];
        const activeTrackers = (state.custom_trackers || []).filter((t) => t && !t.archived);
        const dismissed = state.dismissed_proposals || [];

        const proposalsHtml = proposals.length
            ? `<div class="lpe-glass-card">
                <div class="lpe-card-head">
                    <div>
                        <div class="lpe-card-title">Pending Main-Model Tracker Proposals (${proposals.length})</div>
                        <div class="lpe-card-sub">Edit keys/values below if desired, then click Approve to lock the schema for LPE Clerk to maintain.</div>
                    </div>
                </div>
                <div class="lpe-stack">
                    ${proposals.map((p) => `
                        <div class="lpe-npc-card" data-prop-card="${esc(p.id)}" style="border-left: 3px solid #f59e0b;">
                            <div class="lpe-npc-head">
                                <span class="lpe-chip" style="border-color:rgba(245,158,11,.5);color:#fbbf24;">Proposed · ct:${esc(p.turnCt ?? 0)}</span>
                                <input type="text" class="lpe-app-input" data-prop-input="title" value="${esc(p.title)}" placeholder="Tracker Title" />
                                <button type="button" class="lpe-app-btn primary lpe-btn-sm lpe-pop-approve-prop" data-prop-id="${esc(p.id)}"><i class="fa-solid fa-check"></i> Approve</button>
                                <button type="button" class="lpe-app-btn danger lpe-btn-sm lpe-pop-dismiss-prop" data-prop-id="${esc(p.id)}"><i class="fa-solid fa-xmark"></i> Dismiss</button>
                            </div>
                            ${p.reason ? `<div class="lpe-kv-line"><span>Reason:</span> ${esc(p.reason)}</div>` : ''}
                            <div class="lpe-field-col wide">
                                <label class="lpe-field-lbl">Locked Fields <small>(one <code>key=value</code> per line, max 8)</small></label>
                                <textarea class="lpe-app-input lpe-mono" rows="3" data-prop-input="fields">${esc(fieldsToLines(p.fields))}</textarea>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>`
            : '';

        const trackersRows = activeTrackers.map((t) => `
            <div class="lpe-npc-card" data-ct-id="${esc(t.id)}">
                <div class="lpe-npc-head">
                    <span class="lpe-chip">${esc(t.id)}</span>
                    <input type="text" class="lpe-app-input" data-ct-field="title" value="${esc(t.title)}" placeholder="Tracker Title" />
                    <button type="button" class="lpe-app-btn danger lpe-btn-sm lpe-pop-del-ct" title="Remove tracker"><i class="fa-solid fa-trash"></i></button>
                </div>
                <div class="lpe-field-col wide">
                    <label class="lpe-field-lbl">Fields <small>(one <code>key=value</code> per line; LPE Clerk updates values of these keys)</small></label>
                    <textarea class="lpe-app-input lpe-mono" rows="4" data-ct-field="fields">${esc(fieldsToLines(t.fields))}</textarea>
                </div>
                <div class="lpe-field-col wide">
                    <label class="lpe-field-lbl">Notes</label>
                    <input type="text" class="lpe-app-input" data-ct-field="notes" value="${esc(t.notes || '')}" placeholder="Optional note or deadline" />
                </div>
            </div>
        `).join('');

        $stage.html(`
            ${renderPageHeader({ ...meta, badgeHtml: `<span class="lpe-head-badge ${activeTrackers.length ? 'ok' : ''}">${activeTrackers.length} ACTIVE${proposals.length ? ` · ${proposals.length} PENDING` : ''}</span>` })}
            ${historyBannerHtml(state)}
            <div class="lpe-glass-card">
                <div class="lpe-card-title">Auto-Generate Tracker Settings</div>
                ${renderSwitchRow({
                    id: 'lpe_pop_ct_allow',
                    icon: 'fa-wand-magic-sparkles',
                    color: '#f59e0b',
                    label: 'Allow Main Model to Propose Custom Trackers',
                    desc: 'Permits the story model to propose new recurring trackers (businesses, estates, ships, ledgers) via <lpe_receipt>. Off = zero prompt rule tokens.',
                    on: allowProposals,
                })}
                <div id="lpe_pop_ct_auto_wrap" style="display:${allowProposals ? 'block' : 'none'};">
                    ${renderSwitchRow({
                        id: 'lpe_pop_ct_auto',
                        icon: 'fa-bolt',
                        color: '#10b981',
                        label: 'Auto-Accept Proposed Trackers (Skip Manual Approval)',
                        desc: 'Automatically activates main-model proposals (up to 6 active trackers) instead of queuing them for approval.',
                        on: autoAccept,
                    })}
                </div>
            </div>
            ${proposalsHtml}
            <div class="lpe-glass-card">
                <div class="lpe-card-head">
                    <div>
                        <div class="lpe-card-title">Active Custom Trackers (${activeTrackers.length}/6)</div>
                        <div class="lpe-card-sub">Only active trackers appear in &lt;state:custom_trackers&gt; and receive updates from LPE Clerk.</div>
                    </div>
                    <div class="lpe-inline-actions">
                        <button type="button" class="lpe-app-btn secondary lpe-btn-sm" data-tracker-tpl="business">+ Business</button>
                        <button type="button" class="lpe-app-btn secondary lpe-btn-sm" data-tracker-tpl="estate">+ Estate</button>
                        <button type="button" class="lpe-app-btn secondary lpe-btn-sm" data-tracker-tpl="ship">+ Ship</button>
                        <button type="button" class="lpe-app-btn secondary" id="lpe_pop_add_ct"><i class="fa-solid fa-plus"></i> Blank</button>
                        <button type="button" class="lpe-app-btn primary" id="lpe_pop_save_ct"><i class="fa-solid fa-floppy-disk"></i> Save Trackers</button>
                    </div>
                </div>
                <div class="lpe-stack" id="lpe_pop_ct_list">
                    ${trackersRows || '<div class="lpe-muted">No active custom trackers yet. Add one above or wait for the main model to propose one in play.</div>'}
                </div>
                ${dismissed.length ? `<div class="lpe-inline-actions" style="justify-content:space-between;margin-top:4px;">
                    <span class="lpe-card-sub">${dismissed.length} dismissed proposal ID(s) suppressed (${esc(dismissed.join(', '))})</span>
                    <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_pop_clear_dismissed">Clear Dismissed List</button>
                </div>` : ''}
            </div>
        `);

        $stage.find('#lpe_pop_ct_allow').on('click', function () {
            const s = getSettings();
            const next = !(s.allowTrackerProposals !== false);
            s.allowTrackerProposals = next;
            $(this).toggleClass('active', next).attr('aria-checked', String(next));
            $stage.find('#lpe_pop_ct_auto_wrap').toggle(next);
            notifySettingsChanged();
        });
        $stage.find('#lpe_pop_ct_auto').on('click', function () {
            const s = getSettings();
            const next = !Boolean(s.autoAcceptTrackerProposals);
            s.autoAcceptTrackerProposals = next;
            $(this).toggleClass('active', next).attr('aria-checked', String(next));
            notifySettingsChanged();
        });

        const collectActive = () => {
            const list = [];
            $stage.find('#lpe_pop_ct_list .lpe-npc-card').each(function () {
                const title = String($(this).find('[data-ct-field="title"]').val() ?? '').trim();
                if (!title) return;
                const oldId = String($(this).data('ct-id') || '');
                list.push({
                    id: slugifyTrackerId(oldId || title),
                    title,
                    fields: linesToFields($(this).find('[data-ct-field="fields"]').val()),
                    notes: String($(this).find('[data-ct-field="notes"]').val() ?? '').trim(),
                    archived: false,
                });
            });
            return list;
        };

        $stage.find('.lpe-pop-approve-prop').on('click', function () {
            const propId = String($(this).data('prop-id') || '');
            const $card = $(this).closest('.lpe-npc-card');
            const title = String($card.find('[data-prop-input="title"]').val() ?? '').trim();
            const fields = linesToFields($card.find('[data-prop-input="fields"]').val());
            const nextState = approveTrackerProposal(state, propId, title ? { id: slugifyTrackerId(title), title, fields } : null);
            commitEditedState(nextState, `Approved custom tracker "${title || propId}".`);
        });
        $stage.find('.lpe-pop-dismiss-prop').on('click', function () {
            const propId = String($(this).data('prop-id') || '');
            const nextState = dismissTrackerProposal(state, propId);
            commitEditedState(nextState, 'Dismissed tracker proposal.');
        });
        $stage.on('click', '.lpe-pop-del-ct', function () {
            $(this).closest('.lpe-npc-card').remove();
        });

        const TEMPLATES = {
            business: { title: 'New Business', fields: { stores: '1', employees: '2', monthly_profit: '0', upkeep: '0', inventory: 'Basic stock' }, notes: '' },
            estate: { title: 'New Estate / Fief', fields: { treasury: '0', garrison: '10', morale: 'Steady', tax_rate: 'Standard', projects: 'None' }, notes: '' },
            ship: { title: 'Vessel & Crew', fields: { hull: '100%', crew: '12', supplies_days: '14', cargo: 'Empty', morale: 'Steady' }, notes: '' },
            blank: { title: 'Custom Tracker', fields: { stat_1: '0', stat_2: '0' }, notes: '' },
        };
        const addTemplate = (tplKey) => {
            const draft = cloneState(state);
            draft.custom_trackers = collectActive();
            const tpl = TEMPLATES[tplKey] || TEMPLATES.blank;
            const baseId = slugifyTrackerId(tpl.title);
            let id = baseId;
            let suffix = 2;
            while (draft.custom_trackers.some((x) => x.id === id)) id = `${baseId}_${suffix++}`;
            draft.custom_trackers.push({ id, title: tpl.title, fields: { ...tpl.fields }, notes: tpl.notes, archived: false });
            commitEditedState(draft, `Added ${tpl.title} tracker.`);
        };
        $stage.find('#lpe_pop_add_ct').on('click', () => addTemplate('blank'));
        $stage.find('[data-tracker-tpl]').on('click', function () { addTemplate(String($(this).data('tracker-tpl'))); });
        $stage.find('#lpe_pop_save_ct').on('click', () => {
            const draft = cloneState(state);
            draft.custom_trackers = collectActive();
            commitEditedState(draft, 'Saved Custom Trackers.');
        });
        $stage.find('#lpe_pop_clear_dismissed').on('click', () => {
            const draft = cloneState(state);
            draft.dismissed_proposals = [];
            commitEditedState(draft, 'Cleared dismissed proposals list.');
        });
    }

    function renderAppearanceTab($stage, settings) {
        const meta = tabMeta('appearance');
        const activeTheme = settings.hudTheme || 'Magnum Opus';
        const activeStyle = settings.hudStyle || 'Afterglow';
        const fontSelectId = isOpen() ? 'lpe_app_font_sel' : 'lpe_drawer_font_sel';

        const themeCards = Object.entries(LPE_THEMES).map(([name, t]) => `
            <button type="button" class="lpe-theme-card ${name === activeTheme ? 'on' : ''}" data-theme-name="${esc(name)}" data-scheme="${esc(t.scheme)}" style="background:${esc(t.base)};color:${esc(t.text)};border-color:${name === activeTheme ? '#f59e0b' : esc(t.border)};">
                <span class="lpe-theme-head">
                    <span class="lpe-theme-name">${esc(name)}</span>
                    ${name === activeTheme ? '<i class="fa-solid fa-check lpe-theme-check" aria-hidden="true"></i>' : ''}
                </span>
                <span class="lpe-theme-swatches">
                    <i style="background:${esc(t.blue)}"></i>
                    <i style="background:${esc(t.green)}"></i>
                    <i style="background:${esc(t.yellow)}"></i>
                    <i style="background:${esc(t.red)}"></i>
                </span>
            </button>
        `).join('');

        const styleTilesHtml = `
            <div class="lpe-tiles lpe-style-tiles" data-tile-group="hudstyle">
                ${LPE_STYLES.map((st) => `
                    <button type="button" class="lpe-tile ${st === activeStyle ? 'on' : ''}" data-tile-val="${esc(st)}">
                        <span class="lpe-style-preview" data-lpe-style="${esc(st)}" aria-hidden="true">
                            <span class="lpe-sp-bar"><i></i></span>
                            <span class="lpe-sp-lines"><i></i><i></i></span>
                        </span>
                        <span class="lpe-style-tile-head">
                            <b>${esc(st)}</b>
                            ${st === activeStyle ? '<i class="fa-solid fa-check lpe-theme-check" aria-hidden="true"></i>' : ''}
                        </span>
                    </button>
                `).join('')}
            </div>
        `;

        $stage.html(`
            ${renderPageHeader(meta)}
            <div class="lpe-glass-card">
                <div class="lpe-card-title">Reading &amp; Prose Font (${esc(resolveLpeFont(settings.readingFont).label)})</div>
                <div class="lpe-font-inline-row">
                    <label class="lpe-field-lbl" for="${fontSelectId}">Reading &amp; Prose Font</label>
                    ${buildFontSelectHtml(fontSelectId, 'lpe-app-input lpe-font-inline-sel')}
                </div>
                ${renderTiles('readingfont', LPE_FONTS.map((f) => ({ id: f.id, label: f.label, desc: f.desc })), resolveLpeFont(settings.readingFont).id)}
            </div>

            <div class="lpe-glass-card">
                <div class="lpe-inline-actions" style="justify-content:space-between;margin-bottom:10px;">
                    <div class="lpe-card-title" style="margin-bottom:0;">HUD Color Theme (${esc(activeTheme)})</div>
                    <button type="button" class="lpe-app-btn gold lpe-btn-sm" id="lpe_pop_align_hud_themes" title="Apply active theme and style to every rendered HUD card in this chat without rebuilding">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Align All Chat HUDs to Current Theme
                    </button>
                </div>
                <div class="lpe-theme-grid" id="lpe_pop_theme_grid">${themeCards}</div>
            </div>

            <div class="lpe-glass-card">
                <div class="lpe-card-title">HUD Card Style</div>
                ${styleTilesHtml}
            </div>

            <div class="lpe-glass-card">
                <div class="lpe-card-title">Default Atlas Renderer (Control Center)</div>
                ${renderTiles('atlasmode', [
                    { id: 'webgl', label: '3D WebGL (Hybrid + Textured Kits)', desc: 'Hardware Three.js rooms with doorway cutouts + CC BY 4.0 GLB kits' },
                    { id: '3d', label: '3D CSS (PolyCSS)', desc: `Software CSS matrix3d diorama rooms & ${POLY_PREFABS.length} prefabs` },
                    { id: '2d', label: '2D SVG Floorplan', desc: 'Lightweight schematic blueprint (always used inline in chat)' },
                ], settings.atlasViewMode || 'webgl')}
            </div>

            <div class="lpe-glass-card">
                <div class="lpe-card-title">Default Body Silhouette (Health Doll)</div>
                ${renderTiles('bodytype', [
                    { id: 'male', label: 'Male', desc: 'Standard masculine proportions' },
                    { id: 'female', label: 'Female', desc: 'Feminine proportions' },
                    { id: 'athletic', label: 'Athletic', desc: 'Broad-shouldered lean build' },
                    { id: 'heavy', label: 'Heavy', desc: 'Stocky, burly build' },
                ], settings.defaultBodyType || 'male')}
            </div>

            <div class="lpe-glass-card">
                <div class="lpe-card-title">Engine &amp; UI Rules</div>
                ${renderSwitchRow({
                    id: 'lpe_pop_show_launcher',
                    icon: 'fa-compass',
                    color: '#f59e0b',
                    label: 'Show Floating Launcher Button',
                    desc: 'Displays the draggable compass button for quick access to this Control Center.',
                    on: settings.showLauncherButton !== false,
                })}
                ${renderSwitchRow({
                    id: 'lpe_pop_hud_collapsed',
                    icon: 'fa-compress',
                    color: '#38bdf8',
                    label: 'Collapse Per-Message HUD Cards by Default',
                    desc: 'Keeps chat clean with a compact bar under each AI message until clicked.',
                    on: settings.hudDefaultCollapsed !== false,
                })}
                ${renderSwitchRow({
                    id: 'lpe_pop_show_inline_changes',
                    icon: 'fa-code-compare',
                    color: '#fbbf24',
                    label: 'Show Inline “Changed in this reply” Diff Strip',
                    desc: 'Shows compact per-turn diff breakdown with Revert/Restore and clickable section jumps inside each HUD card.',
                    on: settings.showInlineChanges !== false,
                })}
                ${renderSwitchRow({
                    id: 'lpe_pop_spatial_grounding',
                    icon: 'fa-cubes',
                    color: '#38bdf8',
                    label: 'Inject &lt;spatial_grounding&gt; Guidance for Main Model',
                    desc: 'Teaches the story model how to read Atlas room dimensions, ceiling heights, floor elevation, elevated platforms, and line-of-sight.',
                    on: settings.spatialGrounding !== false,
                })}
                ${renderSwitchRow({
                    id: 'lpe_pop_scoped',
                    icon: 'fa-filter',
                    color: '#10b981',
                    label: 'Smart Scoping',
                    desc: 'Summarizes inactive Atlas maps &amp; dormant NPCs in main-model prompt snapshots.',
                    on: settings.scoped !== false,
                })}
                ${renderSwitchRow({
                    id: 'lpe_pop_force_active',
                    icon: 'fa-bolt',
                    color: '#a855f7',
                    label: 'Force Active on Non-LPE / Magnum Opus Presets',
                    desc: 'Runs prompt stripping &amp; external state injection even if preset auto-detection does not match Magnum Opus, LPE, or legacy Vexa.',
                    on: Boolean(settings.forceActive),
                })}
                ${renderSwitchRow({
                    id: 'lpe_pop_pin_rules',
                    icon: 'fa-thumbtack',
                    color: '#ef4444',
                    label: 'Pin [R] OOC Rules in Notebook',
                    desc: 'Prevents user [R] rules from being evicted by the 20-entry Notebook cap.',
                    on: settings.pinNotebookRules !== false,
                })}
                ${renderSwitchRow({
                    id: 'lpe_pop_matrix_cap',
                    icon: 'fa-sliders',
                    color: '#ec4899',
                    label: 'Enforce ±2 Per-Turn Aether Matrix Step Cap',
                    desc: 'Clamps sudden per-turn relationship jumps in Aether Pair matrices.',
                    on: settings.enforceMatrixStepCap !== false,
                })}
                ${renderSwitchRow({
                    id: 'lpe_pop_allow_proposals',
                    icon: 'fa-chart-simple',
                    color: '#f59e0b',
                    label: 'Allow Main Model to Propose Custom Trackers',
                    desc: 'Allows the story model to suggest new multi-stat trackers (businesses, estates, ships) via <lpe_receipt>.',
                    on: settings.allowTrackerProposals !== false,
                })}
                ${renderSwitchRow({
                    id: 'lpe_pop_auto_accept_trackers',
                    icon: 'fa-bolt',
                    color: '#10b981',
                    label: 'Auto-Accept Proposed Trackers',
                    desc: 'Automatically activates main-model proposals instead of queuing them for manual approval.',
                    on: Boolean(settings.autoAcceptTrackerProposals),
                })}
            </div>
        `);

        $stage.find('[data-tile-group="readingfont"]').on('click', '.lpe-tile', function () {
            getSettings().readingFont = resolveLpeFont($(this).data('tile-val')).id;
            notifySettingsChanged();
            renderAppearanceTab($stage, getSettings());
        });
        $stage.find('#lpe_pop_theme_grid').on('click', '.lpe-theme-card', function () {
            const val = String($(this).data('theme-name') || 'Magnum Opus');
            getSettings().hudTheme = val;
            notifySettingsChanged();
            renderAppearanceTab($stage, getSettings());
        });
        $stage.find('#lpe_pop_align_hud_themes').on('click', () => {
            const s = getSettings();
            onAlignHudThemes?.(s.hudTheme || 'Magnum Opus', s.hudStyle || 'Afterglow');
        });
        $stage.find('[data-tile-group="hudstyle"]').on('click', '.lpe-tile', function () {
            getSettings().hudStyle = String($(this).data('tile-val') || 'Afterglow');
            notifySettingsChanged();
            renderAppearanceTab($stage, getSettings());
        });
        $stage.find('[data-tile-group="atlasmode"]').on('click', '.lpe-tile', function () {
            getSettings().atlasViewMode = String($(this).data('tile-val') || 'webgl');
            atlasView.mode = null;
            $(this).siblings().removeClass('on');
            $(this).addClass('on');
            notifySettingsChanged();
        });
        $stage.find('[data-tile-group="bodytype"]').on('click', '.lpe-tile', function () {
            getSettings().defaultBodyType = String($(this).data('tile-val') || 'male');
            $(this).siblings().removeClass('on');
            $(this).addClass('on');
            notifySettingsChanged();
        });

        const wireBool = (sel, key, defaultTrue = true) => {
            $stage.find(sel).on('click', function () {
                const s = getSettings();
                const cur = defaultTrue ? (s[key] !== false) : Boolean(s[key]);
                const next = !cur;
                s[key] = next;
                $(this).toggleClass('active', next).attr('aria-checked', String(next));
                notifySettingsChanged();
            });
        };
        wireBool('#lpe_pop_show_launcher', 'showLauncherButton', true);
        wireBool('#lpe_pop_hud_collapsed', 'hudDefaultCollapsed', true);
        wireBool('#lpe_pop_show_inline_changes', 'showInlineChanges', true);
        wireBool('#lpe_pop_spatial_grounding', 'spatialGrounding', true);
        wireBool('#lpe_pop_scoped', 'scoped', true);
        wireBool('#lpe_pop_force_active', 'forceActive', false);
        wireBool('#lpe_pop_pin_rules', 'pinNotebookRules', true);
        wireBool('#lpe_pop_matrix_cap', 'enforceMatrixStepCap', true);
        wireBool('#lpe_pop_allow_proposals', 'allowTrackerProposals', true);
        wireBool('#lpe_pop_auto_accept_trackers', 'autoAcceptTrackerProposals', false);
    }

    function renderRuntimeTab($stage, state, settings) {
        const meta = tabMeta('runtime');
        const rtStats = getRuntimeStats?.() || {};
        const cardVars = store?.getCardVars?.() || {};
        const yieldingEjs = shouldYieldEjs(settings);
        const yieldingRenderer = shouldYieldRenderer(settings);
        const ejsOn = settings.ejsEnabled !== false;
        const rendererOn = settings.rendererEnabled !== false;

        $stage.html(`
            ${renderPageHeader({
                ...meta,
                badgeHtml: `<span class="lpe-head-badge ${ejsOn || rendererOn ? 'ok' : ''}">${rtStats.activeIframes || 0} ACTIVE IFRAMES</span>`,
            })}
            <div class="lpe-banner ${(yieldingEjs || yieldingRenderer) ? 'warm' : 'ok'}">
                <i class="fa-solid ${(yieldingEjs || yieldingRenderer) ? 'fa-handshake' : 'fa-shield-halved'}"></i>
                <span>
                    ${yieldingEjs ? '<b>EJS auto-yielding</b> to ST-Prompt-Template (window.EjsTemplate detected). ' : '<b>Scoped EJS Ready</b> (5,000-step loop cap, zero DOM/secret access). '}
                    ${yieldingRenderer ? '<b>Renderer auto-yielding</b> to JS-Slash-Runner (TavernHelper detected).' : '<b>Sandboxed Blob-URL Renderer Ready</b> (sandbox="allow-scripts", CSP-isolated, depth-throttled).'}
                </span>
            </div>

            <div class="lpe-glass-card">
                <div class="lpe-card-title">Scoped EJS Templating Engine</div>
                ${renderSwitchRow({
                    id: 'lpe_pop_ejs_enabled',
                    icon: 'fa-terminal',
                    color: '#f59e0b',
                    label: 'Enable Scoped EJS &amp; Macro Evaluation',
                    desc: 'Evaluates &lt;% ... %&gt;, RPG dice roll(), getvar(), and getlpe() across World Info and chat prompts.',
                    on: ejsOn,
                })}
                ${renderSwitchRow({
                    id: 'lpe_pop_ejs_wi',
                    icon: 'fa-book-open',
                    color: '#38bdf8',
                    label: 'Evaluate World Info &amp; Seed [InitVar]',
                    desc: 'Automatically seeds scoped card_vars from [InitVar] and evaluates EJS conditions on loaded lore entries.',
                    on: settings.ejsEvalWorldInfo !== false,
                })}
                ${renderSwitchRow({
                    id: 'lpe_pop_ejs_prompts',
                    icon: 'fa-wand-magic-sparkles',
                    color: '#10b981',
                    label: 'Evaluate Outgoing Chat Prompts',
                    desc: 'Evaluates EJS and {{get_card_var::...}} / {{lpe::...}} macros cleanly before generation (non-LPE presets included).',
                    on: settings.ejsEvalPrompts !== false,
                })}
                ${renderSwitchRow({
                    id: 'lpe_pop_ejs_yield',
                    icon: 'fa-code-branch',
                    color: '#a855f7',
                    label: 'Auto-Yield to ST-Prompt-Template',
                    desc: 'Defers EJS execution to window.EjsTemplate when external ST-Prompt-Template is installed.',
                    on: settings.ejsAutoYield !== false,
                })}
                <div class="lpe-field-col wide" style="margin-top:8px;">
                    <label class="lpe-field-lbl">EJS Quick Evaluator (Test against live LPE state &amp; card_vars)</label>
                    <div class="lpe-inline-actions" style="justify-content:stretch;">
                        <textarea id="lpe_pop_ejs_input" class="lpe-app-input lpe-mono" rows="2" placeholder="Roll: <%= roll('1d100') %> | Loc: <%= getlpe('world.loc', 'Unknown') %> | Luck: <%= getvar('stat_data.luck', 30) %>"><%= roll('1d100') %> · Loc: <%= getlpe('world.loc', 'Unknown') %></textarea>
                        <button type="button" class="lpe-app-btn primary" id="lpe_pop_ejs_run"><i class="fa-solid fa-play"></i> Run</button>
                    </div>
                    <pre id="lpe_pop_ejs_out" class="lpe-pre" style="margin-top:4px;min-height:28px;">Click Run to evaluate snippet...</pre>
                </div>
            </div>

            <div class="lpe-glass-card">
                <div class="lpe-card-head">
                    <div>
                        <div class="lpe-card-title">Guarded Blob-URL Renderer &amp; Interactive Bridge</div>
                        <div class="lpe-card-sub">
                            Active Iframes: <b>${rtStats.activeIframes || 0}</b> ·
                            Placeholders: <b>${rtStats.placeholders || 0}</b> ·
                            Revoked URLs: <b>${rtStats.totalRevokedUrls || 0}</b> ·
                            Scan: <b>${rtStats.lastScanMs ?? 0} ms</b> ·
                            RPCs: <b>${rtStats.totalRpcs || 0}</b> (Blocked: <b>${rtStats.blockedRpcs || 0}</b>)
                        </div>
                    </div>
                </div>
                ${renderSwitchRow({
                    id: 'lpe_pop_ren_enabled',
                    icon: 'fa-window-maximize',
                    color: '#38bdf8',
                    label: 'Enable Guarded Blob-URL Iframe Renderer',
                    desc: 'Renders frontend HTML blocks inside sandbox="allow-scripts" iframes via window.LPECard postMessage bridge.',
                    on: rendererOn,
                })}
                ${renderSwitchRow({
                    id: 'lpe_pop_ren_blob',
                    icon: 'fa-link',
                    color: '#10b981',
                    label: 'Use Blob URL Rendering',
                    desc: 'Uses URL.createObjectURL(Blob) and revokes URLs on unmount/chat switch (falls back to srcdoc if off).',
                    on: settings.rendererUseBlobUrl !== false,
                })}
                <div class="lpe-field-col wide" style="margin-top:6px;">
                    <label class="lpe-field-lbl">Render Depth (Active floors from newest; 0 = all capped at 6)</label>
                    ${renderTiles('rendepth', [
                        { id: '1', label: '1 Floor' },
                        { id: '2', label: '2 Floors' },
                        { id: '3', label: '3 Floors' },
                        { id: '5', label: '5 Floors' },
                        { id: '0', label: 'All (Cap 6)' },
                    ], String(settings.rendererDepth ?? 2))}
                </div>
                <div class="lpe-field-col wide" style="margin-top:6px;">
                    <label class="lpe-field-lbl">Code Block Folding</label>
                    ${renderTiles('rencollapse', [
                        { id: 'frontend', label: 'Frontend Only', desc: 'Hide HTML blocks replaced by iframes' },
                        { id: 'all', label: 'All Blocks', desc: 'Collapse every code block in chat' },
                        { id: 'none', label: 'None', desc: 'Keep raw code visible' },
                    ], settings.rendererCollapseCode || 'frontend')}
                </div>
                <div class="lpe-two-col" style="margin-top:8px;">
                    <div class="lpe-field-col">
                        <label class="lpe-field-lbl">Max HTML Guard (KB)</label>
                        <input id="lpe_pop_ren_maxkb" type="number" min="64" max="16384" step="64" class="lpe-app-input" value="${esc(settings.rendererMaxHtmlKb ?? 2048)}" />
                    </div>
                </div>
                ${renderSwitchRow({
                    id: 'lpe_pop_ren_hljs',
                    icon: 'fa-gauge-high',
                    color: '#f59e0b',
                    label: 'Skip highlight.js on Frontend Screens',
                    desc: 'Prevents multi-megabyte HTML blocks from freezing syntax highlighting.',
                    on: settings.rendererSkipHljs !== false,
                })}
                ${renderSwitchRow({
                    id: 'lpe_pop_ren_ext',
                    icon: 'fa-globe',
                    color: '#ef4444',
                    label: 'Allow External CDN Styles/Fonts/Scripts (https:)',
                    desc: 'Off by default for offline CSP privacy. connect-src remains blocked in all modes.',
                    on: Boolean(settings.rendererAllowExternalResources),
                })}
                ${renderSwitchRow({
                    id: 'lpe_pop_ren_autosend',
                    icon: 'fa-paper-plane',
                    color: '#fbbf24',
                    label: 'Allow Screen Auto-Send Without Confirmation',
                    desc: 'When off, submitInput() stages a 1-click "Send to Chat" bar instead of submitting silently.',
                    on: Boolean(settings.rendererAllowAutoSend),
                })}
                ${renderSwitchRow({
                    id: 'lpe_pop_ren_yield',
                    icon: 'fa-code-branch',
                    color: '#a855f7',
                    label: 'Auto-Yield to JS-Slash-Runner',
                    desc: 'Defers rendering to TavernHelper when external JS-Slash-Runner is active.',
                    on: settings.rendererAutoYield !== false,
                })}
            </div>

            <div class="lpe-glass-card">
                <div class="lpe-card-head">
                    <div>
                        <div class="lpe-card-title">Scoped Card Variables (card_vars)</div>
                        <div class="lpe-card-sub">Chat-isolated JSON variables seeded from [InitVar] or written via window.LPECard (64 KB cap).</div>
                    </div>
                    <div class="lpe-inline-actions">
                        <button type="button" class="lpe-app-btn secondary" id="lpe_pop_reset_cardvars"><i class="fa-solid fa-trash"></i> Reset Vars</button>
                        <button type="button" class="lpe-app-btn primary" id="lpe_pop_save_cardvars"><i class="fa-solid fa-floppy-disk"></i> Save Card Vars</button>
                    </div>
                </div>
                <textarea id="lpe_pop_cardvars_json" class="lpe-app-input lpe-mono" rows="10">${esc(JSON.stringify(cardVars, null, 2))}</textarea>
                <span class="lpe-err-text" id="lpe_pop_cardvars_err"></span>
            </div>
        `);

        const wireRtBool = (sel, key, defTrue = true) => {
            $stage.find(sel).on('click', function () {
                const s = getSettings();
                const cur = defTrue ? (s[key] !== false) : Boolean(s[key]);
                const next = !cur;
                s[key] = next;
                $(this).toggleClass('active', next).attr('aria-checked', String(next));
                notifySettingsChanged();
            });
        };
        wireRtBool('#lpe_pop_ejs_enabled', 'ejsEnabled', true);
        wireRtBool('#lpe_pop_ejs_wi', 'ejsEvalWorldInfo', true);
        wireRtBool('#lpe_pop_ejs_prompts', 'ejsEvalPrompts', true);
        wireRtBool('#lpe_pop_ejs_yield', 'ejsAutoYield', true);
        wireRtBool('#lpe_pop_ren_enabled', 'rendererEnabled', true);
        wireRtBool('#lpe_pop_ren_blob', 'rendererUseBlobUrl', true);
        wireRtBool('#lpe_pop_ren_hljs', 'rendererSkipHljs', true);
        wireRtBool('#lpe_pop_ren_ext', 'rendererAllowExternalResources', false);
        wireRtBool('#lpe_pop_ren_autosend', 'rendererAllowAutoSend', false);
        wireRtBool('#lpe_pop_ren_yield', 'rendererAutoYield', true);

        $stage.find('[data-tile-group="rendepth"]').on('click', '.lpe-tile', function () {
            const val = parseInt(String($(this).data('tile-val') || '2'), 10);
            getSettings().rendererDepth = Number.isNaN(val) ? 2 : val;
            $(this).siblings().removeClass('on');
            $(this).addClass('on');
            notifySettingsChanged();
        });
        $stage.find('[data-tile-group="rencollapse"]').on('click', '.lpe-tile', function () {
            getSettings().rendererCollapseCode = String($(this).data('tile-val') || 'frontend');
            $(this).siblings().removeClass('on');
            $(this).addClass('on');
            notifySettingsChanged();
        });
        $stage.find('#lpe_pop_ren_maxkb').on('change', function () {
            const val = parseInt(String($(this).val()), 10);
            if (!Number.isNaN(val) && val >= 64 && val <= 16384) {
                getSettings().rendererMaxHtmlKb = val;
                notifySettingsChanged();
            }
        });

        $stage.find('#lpe_pop_ejs_run').on('click', () => {
            const tpl = String($stage.find('#lpe_pop_ejs_input').val() || '');
            const ctx = getContextSafe?.() || {};
            const res = evaluateEjs(tpl, {
                state,
                cardVars: store?.getCardVars?.() || {},
                charName: ctx.name2 || '',
                userName: ctx.name1 || '',
            });
            $stage.find('#lpe_pop_ejs_out').text(res.ok ? res.text : `Error: ${res.error}`);
        });

        $stage.find('#lpe_pop_save_cardvars').on('click', () => {
            $('#lpe_pop_cardvars_err').text('');
            try {
                const parsed = JSON.parse(String($stage.find('#lpe_pop_cardvars_json').val() || '{}'));
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    $('#lpe_pop_cardvars_err').text('Root card_vars must be a JSON object.');
                    return;
                }
                store?.resetCardVars?.();
                const res = store?.patchCardVars?.(parsed);
                if (!res?.ok) {
                    $('#lpe_pop_cardvars_err').text(res?.error || 'Failed to save card_vars.');
                    return;
                }
                onCardVarsChanged?.(store.getCardVars());
                window.toastr?.success?.('Saved scoped card_vars.', 'Lapis Philosophorum Engine (LPE)');
                renderRuntimeTab($stage, activeState(), getSettings());
            } catch (err) {
                $('#lpe_pop_cardvars_err').text(`Invalid JSON: ${err.message}`);
            }
        });

        $stage.find('#lpe_pop_reset_cardvars').on('click', () => {
            store?.resetCardVars?.();
            onCardVarsChanged?.({});
            window.toastr?.info?.('Cleared scoped card_vars for this chat.', 'Lapis Philosophorum Engine (LPE)');
            renderRuntimeTab($stage, activeState(), getSettings());
        });
    }

    function renderToolsTab($stage, state, settings) {
        const meta = tabMeta('tools');
        const xml = store?.hasState?.()
            ? serializeInternalStates(state, {
                scoped: previewScoped,
                recentText: getRecentStoryText?.() || '',
                includeVent: false,
            })
            : '<!-- No LPE state recorded in this chat yet. -->';
        const tok = estimateTokenCount(xml);

        $stage.html(`
            ${renderPageHeader(meta)}
            ${historyBannerHtml(state)}
            <div class="lpe-glass-card">
                <div class="lpe-card-title">Chat State Maintenance</div>
                <div class="lpe-inline-actions" style="justify-content:flex-start;">
                    <button type="button" class="lpe-app-btn secondary" id="lpe_pop_import"><i class="fa-solid fa-file-import"></i> Import Chat States</button>
                    <button type="button" class="lpe-app-btn secondary" id="lpe_pop_tools_reread"><i class="fa-solid fa-rotate"></i> Re-read Last Reply</button>
                    <button type="button" class="lpe-app-btn secondary" id="lpe_pop_copy_xml"><i class="fa-solid fa-copy"></i> Copy Compiled XML</button>
                    <button type="button" class="lpe-app-btn danger" id="lpe_pop_reset_chat"><i class="fa-solid fa-trash"></i> Reset Chat State</button>
                </div>
            </div>

            <div class="lpe-glass-card">
                <div class="lpe-card-head">
                    <div>
                        <div class="lpe-card-title">Compiled Prompt Snapshot Preview</div>
                        <div class="lpe-card-sub">${esc(xml.length.toLocaleString())} chars · ~${esc(tok.toLocaleString())} tokens (${previewScoped ? 'Smart-Scoped' : 'Full Unscoped'})</div>
                    </div>
                    <div class="lpe-seg" id="lpe_pop_preview_seg">
                        <button type="button" class="${previewScoped ? 'on' : ''}" data-scoped="1">Scoped</button>
                        <button type="button" class="${!previewScoped ? 'on' : ''}" data-scoped="0">Full XML</button>
                    </div>
                </div>
                <pre class="lpe-pre lpe-xml-preview">${esc(xml)}</pre>
            </div>

            <div class="lpe-glass-card">
                <div class="lpe-card-head">
                    <div class="lpe-card-title">Raw Canonical State JSON</div>
                    <button type="button" class="lpe-app-btn primary" id="lpe_pop_save_raw"><i class="fa-solid fa-floppy-disk"></i> Save Raw JSON</button>
                </div>
                <textarea id="lpe_pop_raw_json" class="lpe-app-input lpe-mono" rows="16">${esc(JSON.stringify(state, null, 2))}</textarea>
                <span class="lpe-err-text" id="lpe_pop_raw_err"></span>
            </div>
        `);

        $stage.find('#lpe_pop_import').on('click', () => {
            onImportChat?.();
            syncChrome();
            renderToolsTab($stage, activeState(), getSettings());
        });
        $stage.find('#lpe_pop_tools_reread').on('click', () => onRereadLast?.());
        $stage.find('#lpe_pop_copy_xml').on('click', async () => {
            const fullXml = serializeInternalStates(activeState(), { scoped: false, includeVent: true });
            try {
                await navigator.clipboard.writeText(fullXml);
                window.toastr?.success?.('Copied compiled <internal_states> XML.', 'Lapis Philosophorum Engine (LPE)');
            } catch {
                window.toastr?.info?.('Could not access clipboard.', 'Lapis Philosophorum Engine (LPE)');
            }
        });
        $stage.find('#lpe_pop_reset_chat').on('click', async () => {
            const ctx = getContextSafe?.() || {};
            let confirmed = true;
            if (typeof ctx.callGenericPopup === 'function') {
                const res = await ctx.callGenericPopup(
                    'Reset the external LPE state journal for this chat? (Original chat messages are not deleted.)',
                    ctx.POPUP_TYPE?.CONFIRM ?? 2,
                    'Reset Chat State',
                );
                confirmed = Boolean(res);
            }
            if (!confirmed) return;
            inspectSeq = null;
            inspectMesId = null;
            onResetChat?.();
            syncChrome();
            renderToolsTab($stage, activeState(), getSettings());
        });
        $stage.find('#lpe_pop_preview_seg').on('click', 'button', function () {
            previewScoped = $(this).data('scoped') === 1 || $(this).data('scoped') === '1';
            renderToolsTab($stage, activeState(), getSettings());
        });
        $stage.find('#lpe_pop_save_raw').on('click', () => {
            $('#lpe_pop_raw_err').text('');
            try {
                const parsed = JSON.parse(String($stage.find('#lpe_pop_raw_json').val() || '{}'));
                commitEditedState(parsed, 'Saved raw canonical JSON.');
            } catch (err) {
                $('#lpe_pop_raw_err').text(`Invalid JSON: ${err.message}`);
            }
        });
    }

    function renderModelLibraryTab($stage, _state, _settings) {
        const meta = tabMeta('models');
        const mgr = libMgr();
        const cfg = mgr.getConfig();
        const effCol = mgr.getEffectiveCollection();
        const allCatalog = mgr.getCatalog({ collectionFilter: 'all', statusFilter: 'all' });
        const filteredCatalog = mgr.getCatalog({
            collectionFilter: modelLibraryUi.collectionFilter,
            statusFilter: modelLibraryUi.statusFilter,
            searchQuery: modelLibraryUi.searchQuery,
        });
        const emgr = extMgr();
        const extCfg = emgr.getConfig();
        const extAllCatalog = emgr.getCatalog({ categoryFilter: 'all', statusFilter: 'all' });
        const extFilteredCatalog = emgr.getCatalog({
            categoryFilter: extensionLibraryUi.categoryFilter,
            statusFilter: extensionLibraryUi.statusFilter,
            searchQuery: extensionLibraryUi.searchQuery,
        });
        const extensionBadgeSummary = `${extAllCatalog.counts.installedCount} Installed · ${extAllCatalog.counts.enabledCount} Enabled${extAllCatalog.counts.installedBytes > 0 ? ` · ${formatBytesMb(extAllCatalog.counts.installedBytes)}` : ''}`;
        const manifestCols = cfg.cachedManifest?.collections || [];
        const collectionChoices = [
            DEFAULT_COLLECTION_ID,
            'sci-fi',
            'medieval',
            'tavern',
            'residential',
            'exterior',
            'industrial',
            ...allCatalog.collections.map((c) => c.id),
        ];
        const uniqueChoiceIds = [...new Set(collectionChoices.map((c) => normalizeCollectionSlug(c)).filter((c) => c && c !== 'all' && c !== 'installed'))];

        const badgeSummary = `${allCatalog.counts.bundledCount} Bundled · ${allCatalog.counts.installedCount} Downloaded${allCatalog.counts.installedBytes > 0 ? ` · ${formatBytesMb(allCatalog.counts.installedBytes)}` : ''}`;
        const effLabel = formatCollectionLabel(effCol.effective, manifestCols);

        const buildCollectionPillsHtml = (cat) => {
            const pills = [
                `<button type="button" class="lpe-mlib-pill ${modelLibraryUi.collectionFilter === 'all' ? 'active' : ''}" data-mlib-col="all">All <span class="lpe-tabular">${cat.counts.total}</span></button>`,
                `<button type="button" class="lpe-mlib-pill ${modelLibraryUi.collectionFilter === 'installed' ? 'active' : ''}" data-mlib-col="installed">Downloaded <span class="lpe-tabular">${cat.counts.installedCount}</span></button>`,
                ...cat.collections.map((c) => `<button type="button" class="lpe-mlib-pill ${modelLibraryUi.collectionFilter === c.id ? 'active' : ''}" data-mlib-col="${esc(c.id)}">${esc(c.label)} <span class="lpe-tabular">${c.count}</span></button>`),
            ];
            return pills.join('');
        };

        let currentPackAvailIds = [];
        let currentPackInstIds = [];

        const buildModelCardsHtml = (cat) => {
            const activeCol = normalizeCollectionSlug(modelLibraryUi.collectionFilter);
            const colRemoteItems = activeCol && activeCol !== 'all' && activeCol !== 'installed' && activeCol !== DEFAULT_COLLECTION_ID
                ? cat.items.filter((x) => !x.bundled)
                : [];
            currentPackAvailIds = colRemoteItems.filter((x) => !x.installed).map((x) => x.id);
            currentPackInstIds = colRemoteItems.filter((x) => x.installed).map((x) => x.id);

            const bulkBarHtml = activeCol && activeCol !== 'all' && activeCol !== 'installed'
                ? `
                    <div class="lpe-mlib-bulk-bar">
                        <span>Collection: <b>${esc(formatCollectionLabel(activeCol, manifestCols))}</b></span>
                        <div class="lpe-inline-actions" style="gap:6px;">
                            <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_mlib_assign_col_btn" data-mlib-assign="${esc(activeCol)}">
                                <i class="fa-solid fa-check-double"></i> Use for ${esc(effCol.cardKey ? effCol.cardLabel : 'Global Default')}
                            </button>
                            ${currentPackAvailIds.length > 0 ? `
                                <button type="button" class="lpe-app-btn primary lpe-btn-sm" id="lpe_mlib_install_col_btn" data-mlib-install-col="${esc(activeCol)}" ${modelLibraryUi.busyCollection === activeCol ? 'disabled' : ''}>
                                    <i class="fa-solid ${modelLibraryUi.busyCollection === activeCol ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'}"></i> Download Pack (${currentPackAvailIds.length})
                                </button>
                            ` : ''}
                            ${currentPackInstIds.length > 0 ? `
                                <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_mlib_remove_col_btn" data-mlib-remove-col="${esc(activeCol)}">
                                    <i class="fa-solid fa-trash-can"></i> Remove Pack (${currentPackInstIds.length})
                                </button>
                            ` : ''}
                        </div>
                    </div>
                `
                : '';

            if (!cat.items.length) {
                return `${bulkBarHtml}<div class="lpe-empty">No 3D models match the current filter. Try &ldquo;Refresh Catalog&rdquo; or clear the search filter.</div>`;
            }

            const cardsHtml = cat.items.map((item) => {
                const isBusy = modelLibraryUi.busyModelIds.has(item.id);
                const statusBadge = item.bundled
                    ? '<span class="lpe-pill ok"><i class="fa-solid fa-box-archive"></i> Bundled</span>'
                    : item.installed
                        ? '<span class="lpe-pill lpe-badge-staged"><i class="fa-solid fa-circle-check"></i> Installed</span>'
                        : '<span class="lpe-pill"><i class="fa-solid fa-cloud"></i> Available</span>';
                const sizeText = item.sizeBytes ? formatBytesMb(item.sizeBytes) : (item.bundled ? 'Bundled Pack' : 'Unknown');
                const faceText = Number.isFinite(item.faceCount) ? `${item.faceCount.toLocaleString('en-US')} tris` : '';
                const tagsHtml = [...new Set([...(item.collections || []), ...(item.tags || [])])]
                    .map((t) => `<span class="lpe-pill">${esc(formatCollectionLabel(t, manifestCols))}</span>`)
                    .join('');
                const viewerHtml = item.viewerUrl
                    ? `<a class="lpe-mlib-link" href="${esc(item.viewerUrl)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-arrow-up-right-from-square"></i> Source</a>`
                    : '';
                const actionHtml = item.bundled
                    ? '<span class="lpe-pill ok"><i class="fa-solid fa-lock"></i> Core Default</span>'
                    : item.installed
                        ? `<button type="button" class="lpe-app-btn secondary lpe-btn-sm lpe-mlib-remove-btn" data-model-id="${esc(item.id)}" ${isBusy ? 'disabled' : ''}><i class="fa-solid fa-trash-can"></i> Remove</button>`
                        : `<button type="button" class="lpe-app-btn primary lpe-btn-sm lpe-mlib-install-btn" data-model-id="${esc(item.id)}" ${isBusy ? 'disabled' : ''}><i class="fa-solid ${isBusy ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'}"></i> ${isBusy ? 'Downloading...' : 'Download GLB'}</button>`;

                return `
                    <article class="lpe-mlib-card ${item.installed ? 'is-installed' : 'is-available'} ${item.bundled ? 'is-bundled' : ''}" data-model-id="${esc(item.id)}">
                        <div class="lpe-mlib-card-head">
                            <div class="lpe-mlib-title-wrap">
                                <strong>${esc(item.name)}</strong>
                                <span class="lpe-pill lpe-mono">shape:${esc(item.shape || item.id)}</span>
                            </div>
                            ${statusBadge}
                        </div>
                        ${item.description ? `<p class="lpe-mlib-desc">${esc(item.description)}</p>` : ''}
                        <div class="lpe-mlib-metrics lpe-tabular">
                            <span><i class="fa-solid fa-hard-drive"></i> ${esc(sizeText)}</span>
                            ${faceText ? `<span><i class="fa-solid fa-shapes"></i> ${esc(faceText)}</span>` : ''}
                            <span class="lpe-pill lpe-badge-merge">${esc(item.license || 'CC BY 4.0')}</span>
                        </div>
                        <div class="lpe-mlib-tags">${tagsHtml}</div>
                        <div class="lpe-mlib-attrib">
                            <span>Author: <b>${esc(item.author || 'Unknown')}</b> · UID: <code>${esc(item.uid || item.id)}</code></span>
                            ${viewerHtml}
                        </div>
                        <div class="lpe-mlib-actions">
                            ${actionHtml}
                        </div>
                    </article>
                `;
            }).join('');

            return `${bulkBarHtml}<div class="lpe-mlib-grid">${cardsHtml}</div>`;
        };

        const buildExtensionPillsHtml = (cat) => {
            const pills = [
                `<button type="button" class="lpe-ext-pill ${extensionLibraryUi.categoryFilter === 'all' ? 'active' : ''}" data-ext-cat="all">All <span class="lpe-tabular">${cat.counts.total}</span></button>`,
                `<button type="button" class="lpe-ext-pill ${extensionLibraryUi.categoryFilter === 'installed' ? 'active' : ''}" data-ext-cat="installed">Installed <span class="lpe-tabular">${cat.counts.installedCount}</span></button>`,
                ...cat.categories.map((c) => `<button type="button" class="lpe-ext-pill ${extensionLibraryUi.categoryFilter === c.id ? 'active' : ''}" data-ext-cat="${esc(c.id)}">${esc(c.label)} <span class="lpe-tabular">${c.count}</span></button>`),
            ];
            return pills.join('');
        };

        const buildExtensionCardsHtml = (cat) => {
            if (!cat.items.length) {
                return '<div class="lpe-empty">No extensions match the current filter. Try &ldquo;Refresh Catalog&rdquo; or clear the search filter.</div>';
            }
            return `<div class="lpe-ext-grid">${cat.items.map((item) => {
                const isBusy = extensionLibraryUi.busyIds.has(item.id);
                const statusBadge = item.status === 'enabled'
                    ? '<span class="lpe-pill ok"><i class="fa-solid fa-toggle-on"></i> Enabled</span>'
                    : item.status === 'disabled'
                        ? '<span class="lpe-pill"><i class="fa-solid fa-toggle-off"></i> Disabled</span>'
                        : '<span class="lpe-pill"><i class="fa-solid fa-cloud"></i> Available</span>';
                const sizeText = Number.isFinite(item.sizeBytes) ? formatBytesMb(item.sizeBytes) : 'Lightweight';
                const tagsHtml = [...new Set([item.category, ...(item.tags || [])].filter(Boolean))]
                    .map((t) => `<span class="lpe-pill">${esc(t)}</span>`)
                    .join('');
                const hooksText = (item.requiredHooks || []).length
                    ? `<div class="lpe-ext-hooks lpe-mono">Hooks: ${esc(item.requiredHooks.join(', '))}</div>`
                    : '';
                const repoHtml = item.repoUrl
                    ? `<a class="lpe-mlib-link" href="${esc(item.repoUrl)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-arrow-up-right-from-square"></i> Repo</a>`
                    : '';
                const copyRepoHtml = item.repoUrl
                    ? `<button type="button" class="lpe-app-btn secondary lpe-btn-sm lpe-ext-copy-repo-btn" data-ext-id="${esc(item.id)}" data-ext-repo="${esc(item.repoUrl)}" title="Copy this Git URL for SillyTavern's Install Extension menu"><i class="fa-regular fa-copy"></i> Copy Git URL</button>`
                    : '';
                const actionHtml = item.installed
                    ? `
                        <button type="button" class="lpe-app-btn secondary lpe-btn-sm lpe-ext-toggle-btn" data-ext-id="${esc(item.id)}" data-ext-enable="${item.enabled ? '0' : '1'}">
                            <i class="fa-solid ${item.enabled ? 'fa-toggle-off' : 'fa-toggle-on'}"></i> ${item.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button type="button" class="lpe-app-btn secondary lpe-btn-sm lpe-ext-remove-btn" data-ext-id="${esc(item.id)}">
                            <i class="fa-solid fa-trash-can"></i> Remove
                        </button>
                        ${copyRepoHtml}
                    `
                    : `<button type="button" class="lpe-app-btn primary lpe-btn-sm lpe-ext-install-btn" data-ext-id="${esc(item.id)}" ${isBusy ? 'disabled' : ''}><i class="fa-solid ${isBusy ? 'fa-spinner fa-spin' : 'fa-puzzle-piece'}"></i> ${isBusy ? 'Installing...' : 'Install'}</button>${copyRepoHtml}`;

                return `
                    <article class="lpe-ext-card ${item.installed ? 'is-installed' : 'is-available'} ${item.enabled ? 'is-enabled' : ''}" data-ext-id="${esc(item.id)}">
                        <div class="lpe-mlib-card-head">
                            <div class="lpe-mlib-title-wrap">
                                <strong>${esc(item.name)}</strong>
                                <span class="lpe-pill lpe-mono">v${esc(item.version || '0.0.0')}</span>
                            </div>
                            ${statusBadge}
                        </div>
                        ${item.summary || item.description ? `<p class="lpe-mlib-desc">${esc(item.summary || item.description)}</p>` : ''}
                        <div class="lpe-mlib-metrics lpe-tabular">
                            <span><i class="fa-solid fa-hard-drive"></i> ${esc(sizeText)}</span>
                            <span><i class="fa-solid fa-layer-group"></i> ${esc(item.category || 'general')}</span>
                            <span class="lpe-pill">${esc(item.license || 'Unknown license')}</span>
                        </div>
                        <div class="lpe-mlib-tags">${tagsHtml}</div>
                        ${hooksText}
                        <div class="lpe-mlib-attrib">
                            <span>Author: <b>${esc(item.author || 'Unknown')}</b>${item.compatibility ? ` · LPE ${esc(item.compatibility)}` : ''}</span>
                            ${repoHtml}
                        </div>
                        <div class="lpe-mlib-actions">${actionHtml}</div>
                    </article>
                `;
            }).join('')}</div>`;
        };

        const modePillsHtml = `
            <div class="lpe-lib-mode-pills" id="lpe_lib_mode_pills">
                <button type="button" class="lpe-lib-mode-pill ${modelLibraryUi.mode === 'all' ? 'active' : ''}" data-lib-mode="all"><span class="lpe-ornament" aria-hidden="true">✦</span> All <span class="lpe-tabular">${allCatalog.counts.total + extAllCatalog.counts.total}</span></button>
                <button type="button" class="lpe-lib-mode-pill ${modelLibraryUi.mode === '3d' ? 'active' : ''}" data-lib-mode="3d"><i class="fa-solid fa-cubes"></i> 3D Models <span class="lpe-tabular">${allCatalog.counts.total}</span></button>
                <button type="button" class="lpe-lib-mode-pill ${modelLibraryUi.mode === 'extensions' ? 'active' : ''}" data-lib-mode="extensions"><i class="fa-solid fa-puzzle-piece"></i> Extensions <span class="lpe-tabular">${extAllCatalog.counts.total}</span></button>
            </div>
        `;

        $stage.html(`
            ${renderPageHeader({
                title: meta.title,
                sub: meta.sub,
                icon: meta.icon,
                badgeHtml: `<span class="lpe-head-badge ok lpe-tabular"><span class="lpe-ornament" aria-hidden="true">✦</span> ${esc(badgeSummary)}</span>`,
            })}

            <div class="lpe-glass-card lpe-lib-mode-card">
                <div class="lpe-card-title"><span class="lpe-ornament" aria-hidden="true">✦</span> Unified Library &mdash; 3D Models &amp; Modular Extensions</div>
                ${modePillsHtml}
                <div class="lpe-lib-mode-summary lpe-muted">
                    <span>3D: ${esc(badgeSummary)}</span>
                    <span>Extensions: ${esc(extensionBadgeSummary)}</span>
                </div>
            </div>

            ${modelLibraryUi.mode !== 'extensions' ? `
            <div class="lpe-glass-card lpe-mlib-assign-card">
                <div class="lpe-card-title"><span class="lpe-ornament" aria-hidden="true">✦</span> Card &amp; Global 3D Collection Assignment</div>
                <div class="lpe-mlib-assign-summary">
                    <span>Active Context: <b>${esc(effCol.cardLabel)}</b></span>
                    <span class="lpe-pill lpe-badge-staged">Effective: ${esc(effLabel)}</span>
                </div>
                <div class="lpe-form-grid">
                    <label>${effCol.cardKey ? `Collection for "${esc(effCol.cardLabel)}"` : 'Active Card / Session Collection'}
                        <select id="lpe_mlib_card_collection" class="lpe-app-input">
                            ${effCol.cardKey ? `<option value="__inherit__" ${!effCol.cardCollection ? 'selected' : ''}>Inherit Global Default (${esc(formatCollectionLabel(effCol.defaultCollection, manifestCols))})</option>` : ''}
                            ${uniqueChoiceIds.map((id) => `<option value="${esc(id)}" ${(effCol.cardKey ? effCol.cardCollection : effCol.defaultCollection) === id ? 'selected' : ''}>${esc(formatCollectionLabel(id, manifestCols))}</option>`).join('')}
                        </select>
                    </label>
                    <label>Global Default Collection Fallback
                        <select id="lpe_mlib_default_collection" class="lpe-app-input">
                            ${uniqueChoiceIds.map((id) => `<option value="${esc(id)}" ${effCol.defaultCollection === id ? 'selected' : ''}>${esc(formatCollectionLabel(id, manifestCols))}</option>`).join('')}
                        </select>
                    </label>
                </div>
                <div class="lpe-muted" style="margin-top:6px;">
                    Missing or undownloaded external props fall back cleanly to the bundled default GLB library and procedural 3D geometry.
                </div>
            </div>

            <div class="lpe-glass-card">
                <div class="lpe-card-title"><i class="fa-solid fa-cloud-arrow-down"></i> External Library Repository (ST-LapisPhilosophorumEngineLibrary)</div>
                <div class="lpe-mlib-url-row">
                    <input id="lpe_mlib_manifest_url" type="text" class="lpe-app-input lpe-mono" value="${esc(modelLibraryUi.draftManifestUrl !== null ? modelLibraryUi.draftManifestUrl : (cfg.manifestUrl || DEFAULT_LIBRARY_MANIFEST_URL))}" placeholder="${esc(DEFAULT_LIBRARY_MANIFEST_URL)}" />
                    <button type="button" class="lpe-app-btn primary lpe-btn-sm" id="lpe_mlib_refresh_btn" ${modelLibraryUi.refreshing ? 'disabled' : ''}>
                        <i class="fa-solid ${modelLibraryUi.refreshing ? 'fa-spinner fa-spin' : 'fa-rotate'}"></i> ${modelLibraryUi.refreshing ? 'Loading...' : 'Refresh Catalog'}
                    </button>
                    <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_mlib_reset_url_btn" title="Restore default ST-LapisPhilosophorumEngineLibrary GitHub manifest URL">Default URL</button>
                    <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_mlib_clear_cache_btn" ${allCatalog.counts.installedCount === 0 ? 'disabled' : ''}>
                        <i class="fa-solid fa-broom"></i> Clear Downloaded (${allCatalog.counts.installedCount})
                    </button>
                </div>
                <div id="lpe_mlib_status" class="lpe-mlib-status ${modelLibraryUi.statusError ? 'is-error' : ''}">
                    ${modelLibraryUi.statusError
                        ? esc(modelLibraryUi.statusError)
                        : modelLibraryUi.statusMessage
                            ? esc(modelLibraryUi.statusMessage)
                            : esc(cfg.cachedManifest
                                ? `Catalog loaded: ${cfg.cachedManifest.models?.length || 0} remote model(s) ready${cfg.cachedManifest.updatedAt ? ` · Updated ${cfg.cachedManifest.updatedAt}` : ''}.`
                                : 'Bundled defaults active. Click “Refresh Catalog” to browse downloadable external packs.')}
                </div>
            </div>

            <div class="lpe-glass-card">
                <div class="lpe-card-title"><i class="fa-solid fa-cubes-stacked"></i> Browse Models &amp; Collections</div>
                <div class="lpe-mlib-filter-pills" id="lpe_mlib_filter_pills">${buildCollectionPillsHtml(allCatalog)}</div>
                <div class="lpe-mlib-toolbar">
                    <input id="lpe_mlib_search" type="search" class="lpe-app-input" value="${esc(modelLibraryUi.searchQuery)}" placeholder="Search by model name, shape ID, author, tag, or license..." />
                    <select id="lpe_mlib_status_filter" class="lpe-app-input">
                        <option value="all" ${modelLibraryUi.statusFilter === 'all' ? 'selected' : ''}>All Statuses</option>
                        <option value="available" ${modelLibraryUi.statusFilter === 'available' ? 'selected' : ''}>Available (Remote)</option>
                        <option value="installed" ${modelLibraryUi.statusFilter === 'installed' ? 'selected' : ''}>Downloaded</option>
                        <option value="bundled" ${modelLibraryUi.statusFilter === 'bundled' ? 'selected' : ''}>Bundled Default</option>
                    </select>
                </div>
                <div id="lpe_mlib_browser_body">${buildModelCardsHtml(filteredCatalog)}</div>
            </div>

            <details class="lpe-glass-card lpe-fold-card">
                <summary class="lpe-fold-summary"><i class="fa-solid fa-scale-balanced"></i> CC0 &amp; CC BY 4.0 Attribution Records</summary>
                <div class="lpe-fold-body">
                    <div class="lpe-inline-actions" style="justify-content:flex-end;margin-bottom:6px;">
                        <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_mlib_copy_credits_btn"><i class="fa-regular fa-copy"></i> Copy Credits</button>
                    </div>
                    <pre id="lpe_mlib_credits_pre" class="lpe-app-pre">${esc(mgr.getAttributionCredits())}</pre>
                </div>
            </details>
            ` : ''}

            ${modelLibraryUi.mode !== '3d' ? `
            <div class="lpe-glass-card">
                <div class="lpe-card-title"><i class="fa-solid fa-puzzle-piece"></i> Extension / Modular Component Repository</div>
                <div class="lpe-mlib-url-row">
                    <input id="lpe_ext_manifest_url" type="text" class="lpe-app-input lpe-mono" value="${esc(extensionLibraryUi.draftManifestUrl !== null ? extensionLibraryUi.draftManifestUrl : (extCfg.manifestUrl || DEFAULT_EXTENSION_MANIFEST_URL))}" placeholder="${esc(DEFAULT_EXTENSION_MANIFEST_URL)}" />
                    <button type="button" class="lpe-app-btn primary lpe-btn-sm" id="lpe_ext_refresh_btn" ${extensionLibraryUi.refreshing ? 'disabled' : ''}>
                        <i class="fa-solid ${extensionLibraryUi.refreshing ? 'fa-spinner fa-spin' : 'fa-rotate'}"></i> ${extensionLibraryUi.refreshing ? 'Loading...' : 'Refresh Catalog'}
                    </button>
                    <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_ext_reset_url_btn" title="Restore default extension catalog manifest URL">Default URL</button>
                    <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_ext_clear_cache_btn" ${extAllCatalog.counts.installedCount === 0 ? 'disabled' : ''}>
                        <i class="fa-solid fa-broom"></i> Clear Installed (${extAllCatalog.counts.installedCount})
                    </button>
                </div>
                <div id="lpe_ext_status" class="lpe-mlib-status ${extensionLibraryUi.statusError ? 'is-error' : ''}">
                    ${extensionLibraryUi.statusError
                        ? esc(extensionLibraryUi.statusError)
                        : extensionLibraryUi.statusMessage
                            ? esc(extensionLibraryUi.statusMessage)
                            : esc(extCfg.cachedManifest?.fallback
                                ? `Bundled catalog entries shown (${extCfg.cachedManifest.fallbackReason || 'remote catalog unavailable'}): ${extCfg.cachedManifest.extensions?.length || 0} official companion extension(s). Refresh to retry the online catalog.`
                                : extCfg.cachedManifest
                                    ? `Catalog loaded: ${extCfg.cachedManifest.extensions?.length || 0} extension(s) ready${extCfg.cachedManifest.updatedAt ? ` · Updated ${extCfg.cachedManifest.updatedAt}` : ''}.`
                                    : 'Bundled companion catalog shown for offline-first browsing. Refresh Catalog to check for the latest online entries.')}
                </div>
            </div>

            <div class="lpe-glass-card">
                <div class="lpe-card-title"><i class="fa-solid fa-puzzle-piece"></i> Browse Extensions &amp; Modular Components</div>
                <div class="lpe-ext-filter-pills" id="lpe_ext_filter_pills">${buildExtensionPillsHtml(extAllCatalog)}</div>
                <div class="lpe-mlib-toolbar">
                    <input id="lpe_ext_search" type="search" class="lpe-app-input" value="${esc(extensionLibraryUi.searchQuery)}" placeholder="Search by extension name, id, author, category, hook, or license..." />
                    <select id="lpe_ext_status_filter" class="lpe-app-input">
                        <option value="all" ${extensionLibraryUi.statusFilter === 'all' ? 'selected' : ''}>All Statuses</option>
                        <option value="available" ${extensionLibraryUi.statusFilter === 'available' ? 'selected' : ''}>Available (Not Installed)</option>
                        <option value="installed" ${extensionLibraryUi.statusFilter === 'installed' ? 'selected' : ''}>Installed</option>
                        <option value="enabled" ${extensionLibraryUi.statusFilter === 'enabled' ? 'selected' : ''}>Enabled</option>
                        <option value="disabled" ${extensionLibraryUi.statusFilter === 'disabled' ? 'selected' : ''}>Disabled</option>
                    </select>
                </div>
                <div id="lpe_ext_browser_body">${buildExtensionCardsHtml(extFilteredCatalog)}</div>
            </div>

            <details class="lpe-glass-card lpe-fold-card">
                <summary class="lpe-fold-summary"><i class="fa-solid fa-scale-balanced"></i> Extension Author, License &amp; Source Records</summary>
                <div class="lpe-fold-body">
                    <div class="lpe-inline-actions" style="justify-content:flex-end;margin-bottom:6px;">
                        <button type="button" class="lpe-app-btn secondary lpe-btn-sm" id="lpe_ext_copy_credits_btn"><i class="fa-regular fa-copy"></i> Copy Credits</button>
                    </div>
                    <pre id="lpe_ext_credits_pre" class="lpe-app-pre">${esc(emgr.getAttributionCredits())}</pre>
                </div>
            </details>
            ` : ''}
        `);

        const refreshBrowserOnly = () => {
            if (activeTab !== 'models' || !isAnyUiOpen()) return;
            const catFiltered = mgr.getCatalog({
                collectionFilter: modelLibraryUi.collectionFilter,
                statusFilter: modelLibraryUi.statusFilter,
                searchQuery: modelLibraryUi.searchQuery,
            });
            const catAll = mgr.getCatalog({ collectionFilter: 'all', statusFilter: 'all' });
            $stage.find('#lpe_mlib_filter_pills').html(buildCollectionPillsHtml(catAll));
            $stage.find('#lpe_mlib_browser_body').html(buildModelCardsHtml(catFiltered));
        };

        const refreshExtensionBrowserOnly = () => {
            if (activeTab !== 'models' || !isAnyUiOpen()) return;
            const catFiltered = emgr.getCatalog({
                categoryFilter: extensionLibraryUi.categoryFilter,
                statusFilter: extensionLibraryUi.statusFilter,
                searchQuery: extensionLibraryUi.searchQuery,
            });
            const catAll = emgr.getCatalog({ categoryFilter: 'all', statusFilter: 'all' });
            $stage.find('#lpe_ext_filter_pills').html(buildExtensionPillsHtml(catAll));
            $stage.find('#lpe_ext_browser_body').html(buildExtensionCardsHtml(catFiltered));
        };

        const rerenderLibraryIfActive = () => {
            if (activeTab === 'models' && isAnyUiOpen()) {
                renderActiveTab({ resetScroll: false });
            }
        };

        $stage.on('change', '#lpe_mlib_card_collection', function (e) {
            const val = String(e?.target?.value ?? $(this).val() ?? '__inherit__');
            mgr.setCardCollection(val);
            modelLibraryUi.statusError = '';
            modelLibraryUi.statusMessage = val === '__inherit__'
                ? 'Active card now inherits global default 3D collection.'
                : `Assigned "${formatCollectionLabel(val, manifestCols)}" to ${effCol.cardLabel}.`;
            rerenderLibraryIfActive();
        });

        $stage.on('change', '#lpe_mlib_default_collection', function (e) {
            const val = String(e?.target?.value ?? $(this).val() ?? DEFAULT_COLLECTION_ID);
            mgr.setDefaultCollection(val);
            modelLibraryUi.statusError = '';
            modelLibraryUi.statusMessage = `Global default collection set to "${formatCollectionLabel(val, manifestCols)}".`;
            rerenderLibraryIfActive();
        });

        $stage.on('input', '#lpe_mlib_manifest_url', (e) => {
            modelLibraryUi.draftManifestUrl = String(e?.target?.value ?? $('#lpe_mlib_manifest_url').val() ?? '');
        });

        $stage.on('click', '#lpe_mlib_refresh_btn', async () => {
            const url = String($stage.find('#lpe_mlib_manifest_url').val() || '').trim();
            modelLibraryUi.draftManifestUrl = url;
            modelLibraryUi.refreshing = true;
            modelLibraryUi.statusError = '';
            modelLibraryUi.statusMessage = 'Fetching external library catalog...';
            rerenderLibraryIfActive();
            try {
                const parsed = await mgr.refreshCatalog({ manifestUrl: url });
                modelLibraryUi.draftManifestUrl = null;
                const warnSuffix = parsed.warnings?.length ? ` (${parsed.warnings.length} skipped)` : '';
                modelLibraryUi.statusMessage = `Loaded ${parsed.models.length} external model(s) from ${parsed.name}${warnSuffix}.`;
            } catch (err) {
                modelLibraryUi.statusError = String(err?.message || err);
            } finally {
                modelLibraryUi.refreshing = false;
                rerenderLibraryIfActive();
            }
        });

        $stage.on('click', '#lpe_mlib_reset_url_btn', () => {
            modelLibraryUi.draftManifestUrl = null;
            mgr.resetManifestUrl();
            modelLibraryUi.statusError = '';
            modelLibraryUi.statusMessage = 'Restored default ST-LapisPhilosophorumEngineLibrary URL.';
            rerenderLibraryIfActive();
        });

        $stage.on('click', '#lpe_mlib_clear_cache_btn', async () => {
            const res = await mgr.clearCachedModels();
            modelLibraryUi.statusError = '';
            modelLibraryUi.statusMessage = `Cleared ${res.removedCount} downloaded external model(s). Bundled defaults preserved.`;
            rerenderLibraryIfActive();
        });

        $stage.on('click', '.lpe-mlib-pill', function (e) {
            const col = String(e?.currentTarget?.dataset?.mlibCol ?? $(this).data('mlib-col') ?? 'all');
            modelLibraryUi.collectionFilter = col;
            refreshBrowserOnly();
        });

        $stage.on('input', '#lpe_mlib_search', function (e) {
            modelLibraryUi.searchQuery = String(e?.target?.value ?? $(this).val() ?? '');
            refreshBrowserOnly();
        });

        $stage.on('change', '#lpe_mlib_status_filter', function (e) {
            modelLibraryUi.statusFilter = String(e?.target?.value ?? $(this).val() ?? 'all');
            refreshBrowserOnly();
        });

        $stage.on('click', '#lpe_mlib_assign_col_btn', function (e) {
            const col = String(e?.currentTarget?.dataset?.mlibAssign ?? $(this).data('mlib-assign') ?? modelLibraryUi.collectionFilter);
            if (!col || col === 'all' || col === 'installed') return;
            mgr.setCardCollection(col);
            modelLibraryUi.statusError = '';
            modelLibraryUi.statusMessage = `Assigned "${formatCollectionLabel(col, manifestCols)}" to ${effCol.cardLabel}.`;
            rerenderLibraryIfActive();
        });

        $stage.on('click', '.lpe-mlib-install-btn', async function (e) {
            const id = String(e?.currentTarget?.dataset?.modelId ?? $(this).data('model-id') ?? '');
            if (!id) return;
            modelLibraryUi.busyModelIds.add(id);
            modelLibraryUi.statusError = '';
            modelLibraryUi.statusMessage = `Downloading "${id}"...`;
            rerenderLibraryIfActive();
            try {
                const res = await mgr.installModel(id);
                modelLibraryUi.statusMessage = `Downloaded "${res.item?.name || id}" (${res.item?.license || 'CC BY 4.0'}).`;
            } catch (err) {
                modelLibraryUi.statusError = String(err?.message || err);
            } finally {
                modelLibraryUi.busyModelIds.delete(id);
                rerenderLibraryIfActive();
            }
        });

        $stage.on('click', '.lpe-mlib-remove-btn', async function (e) {
            const id = String(e?.currentTarget?.dataset?.modelId ?? $(this).data('model-id') ?? '');
            if (!id) return;
            const res = await mgr.removeModel(id);
            if (res.ok) {
                modelLibraryUi.statusError = '';
                modelLibraryUi.statusMessage = `Removed cached external model "${id}".`;
            } else {
                modelLibraryUi.statusError = res.error || `Could not remove "${id}".`;
            }
            rerenderLibraryIfActive();
        });

        $stage.on('click', '#lpe_mlib_install_col_btn', async function (e) {
            const col = String(e?.currentTarget?.dataset?.mlibInstallCol ?? $(this).data('mlib-install-col') ?? '');
            if (!col) return;
            const targetIds = [...currentPackAvailIds];
            modelLibraryUi.busyCollection = col;
            modelLibraryUi.statusError = '';
            modelLibraryUi.statusMessage = `Downloading ${targetIds.length} model(s) from "${formatCollectionLabel(col, manifestCols)}"...`;
            rerenderLibraryIfActive();
            try {
                const res = await mgr.installCollection(col, { modelIds: targetIds });
                if (res.failed.length) {
                    modelLibraryUi.statusError = `Downloaded ${res.installed.length}; ${res.failed.length} failed (${res.failed[0].error}).`;
                } else {
                    modelLibraryUi.statusMessage = `Downloaded ${res.installed.length} model(s) for "${formatCollectionLabel(col, manifestCols)}".`;
                }
            } finally {
                modelLibraryUi.busyCollection = null;
                rerenderLibraryIfActive();
            }
        });

        $stage.on('click', '#lpe_mlib_remove_col_btn', async function (e) {
            const col = String(e?.currentTarget?.dataset?.mlibRemoveCol ?? $(this).data('mlib-remove-col') ?? '');
            if (!col) return;
            const targetIds = [...currentPackInstIds];
            const res = await mgr.removeCollection(col, { modelIds: targetIds });
            modelLibraryUi.statusError = '';
            modelLibraryUi.statusMessage = `Removed ${res.removed.length} cached model(s) from "${formatCollectionLabel(col, manifestCols)}".`;
            rerenderLibraryIfActive();
        });

        $stage.on('click', '#lpe_mlib_copy_credits_btn', async () => {
            try {
                await navigator.clipboard?.writeText?.(mgr.getAttributionCredits());
                modelLibraryUi.statusError = '';
                modelLibraryUi.statusMessage = 'Copied model attribution credits to clipboard.';
                rerenderLibraryIfActive();
            } catch {
                modelLibraryUi.statusError = 'Clipboard unavailable.';
                rerenderLibraryIfActive();
            }
        });

        $stage.on('click', '.lpe-lib-mode-pill', function (e) {
            const mode = String(e?.currentTarget?.dataset?.libMode ?? $(this).data('lib-mode') ?? 'all');
            modelLibraryUi.mode = ['all', '3d', 'extensions'].includes(mode) ? mode : 'all';
            rerenderLibraryIfActive();
        });

        $stage.on('input', '#lpe_ext_manifest_url', (e) => {
            extensionLibraryUi.draftManifestUrl = String(e?.target?.value ?? $('#lpe_ext_manifest_url').val() ?? '');
        });

        $stage.on('click', '#lpe_ext_refresh_btn', async () => {
            const url = String($stage.find('#lpe_ext_manifest_url').val() || '').trim();
            extensionLibraryUi.draftManifestUrl = url;
            extensionLibraryUi.refreshing = true;
            extensionLibraryUi.statusError = '';
            extensionLibraryUi.statusMessage = 'Fetching extension catalog...';
            rerenderLibraryIfActive();
            try {
                const parsed = await emgr.refreshCatalog({ manifestUrl: url });
                extensionLibraryUi.draftManifestUrl = null;
                const warnSuffix = parsed.warnings?.length ? ` (${parsed.warnings.length} warning(s))` : '';
                extensionLibraryUi.statusMessage = parsed.fallback
                    ? `Bundled catalog entries shown (${parsed.fallbackReason || 'remote catalog unavailable'}): ${parsed.extensions.length} official companion extension(s)${warnSuffix}.`
                    : `Loaded ${parsed.extensions.length} extension(s) from ${parsed.name}${warnSuffix}.`;
            } catch (err) {
                extensionLibraryUi.statusError = String(err?.message || err);
            } finally {
                extensionLibraryUi.refreshing = false;
                rerenderLibraryIfActive();
            }
        });

        $stage.on('click', '#lpe_ext_reset_url_btn', () => {
            extensionLibraryUi.draftManifestUrl = null;
            emgr.resetManifestUrl();
            extensionLibraryUi.statusError = '';
            extensionLibraryUi.statusMessage = 'Restored default extension catalog URL.';
            rerenderLibraryIfActive();
        });

        $stage.on('click', '#lpe_ext_clear_cache_btn', () => {
            const res = emgr.clearInstalledExtensions();
            extensionLibraryUi.statusError = '';
            extensionLibraryUi.statusMessage = `Cleared ${res.removedCount} installed extension(s).`;
            rerenderLibraryIfActive();
        });

        $stage.on('click', '.lpe-ext-pill', function (e) {
            const cat = String(e?.currentTarget?.dataset?.extCat ?? $(this).data('ext-cat') ?? 'all');
            extensionLibraryUi.categoryFilter = cat;
            refreshExtensionBrowserOnly();
        });

        $stage.on('input', '#lpe_ext_search', function (e) {
            extensionLibraryUi.searchQuery = String(e?.target?.value ?? $(this).val() ?? '');
            refreshExtensionBrowserOnly();
        });

        $stage.on('change', '#lpe_ext_status_filter', function (e) {
            extensionLibraryUi.statusFilter = String(e?.target?.value ?? $(this).val() ?? 'all');
            refreshExtensionBrowserOnly();
        });

        $stage.on('click', '.lpe-ext-install-btn', function (e) {
            const id = String(e?.currentTarget?.dataset?.extId ?? $(this).data('ext-id') ?? '');
            if (!id) return;
            extensionLibraryUi.busyIds.add(id);
            extensionLibraryUi.statusError = '';
            extensionLibraryUi.statusMessage = `Installing extension "${id}"...`;
            rerenderLibraryIfActive();
            try {
                const res = emgr.installExtension(id);
                extensionLibraryUi.statusMessage = `Installed "${res.item?.name || id}" (${res.item?.license || 'Unknown license'}).`;
            } catch (err) {
                extensionLibraryUi.statusError = String(err?.message || err);
            } finally {
                extensionLibraryUi.busyIds.delete(id);
                rerenderLibraryIfActive();
            }
        });

        $stage.on('click', '.lpe-ext-toggle-btn', function (e) {
            const id = String(e?.currentTarget?.dataset?.extId ?? $(this).data('ext-id') ?? '');
            const enable = String(e?.currentTarget?.dataset?.extEnable ?? $(this).data('ext-enable') ?? '1') === '1';
            if (!id) return;
            const res = emgr.setExtensionEnabled(id, enable);
            if (res.ok) {
                extensionLibraryUi.statusError = '';
                extensionLibraryUi.statusMessage = `${enable ? 'Enabled' : 'Disabled'} extension "${res.item?.name || id}".`;
            } else {
                extensionLibraryUi.statusError = `Extension "${id}" is not installed.`;
            }
            rerenderLibraryIfActive();
        });

        $stage.on('click', '.lpe-ext-remove-btn', function (e) {
            const id = String(e?.currentTarget?.dataset?.extId ?? $(this).data('ext-id') ?? '');
            if (!id) return;
            const res = emgr.removeExtension(id);
            extensionLibraryUi.statusError = '';
            extensionLibraryUi.statusMessage = res.existed
                ? `Removed extension "${id}".`
                : `Extension "${id}" was not installed.`;
            rerenderLibraryIfActive();
        });

        $stage.on('click', '.lpe-ext-copy-repo-btn', async function (e) {
            const url = String(e?.currentTarget?.dataset?.extRepo ?? $(this).data('ext-repo') ?? '').trim();
            if (!url) return;
            try {
                await navigator.clipboard?.writeText?.(url);
                extensionLibraryUi.statusError = '';
                extensionLibraryUi.statusMessage = `Copied Git URL: ${url}. Paste it into SillyTavern's Install Extension menu.`;
            } catch {
                extensionLibraryUi.statusError = 'Clipboard unavailable. Copy the repo link manually.';
            }
            rerenderLibraryIfActive();
        });

        $stage.on('click', '#lpe_ext_copy_credits_btn', async () => {
            try {
                await navigator.clipboard?.writeText?.(emgr.getAttributionCredits());
                extensionLibraryUi.statusError = '';
                extensionLibraryUi.statusMessage = 'Copied extension attribution credits to clipboard.';
                rerenderLibraryIfActive();
            } catch {
                extensionLibraryUi.statusError = 'Clipboard unavailable.';
                rerenderLibraryIfActive();
            }
        });
    }

    function renderActiveTab({ resetScroll = false } = {}) {
        const $stage = isOpen()
            ? $('#lpe_app_stage')
            : (isDrawerOpen() ? $('#lpe_drawer_stage') : $());
        if (!$stage.length) return;
        const savedTop = resetScroll ? 0 : ($stage.scrollTop() || 0);
        const state = activeState();
        const settings = getSettings();
        const ws = getWorkerStatus?.() || { busy: false };

        $stage.off('click change input');
        if (activeTab !== 'atlas') disposeWebgl();

        switch (activeTab) {
            case 'overview':
                renderOverviewTab($stage, state, settings, ws);
                break;
            case 'atlas':
                renderAtlasPopupTab($stage, state, settings);
                break;
            case 'health':
                renderHealthPopupTab($stage, state, settings);
                break;
            case 'cast':
                renderCastTab($stage, state);
                break;
            case 'relations':
                renderRelationsTab($stage, state);
                break;
            case 'narrative':
                renderNarrativeTab($stage, state);
                break;
            case 'trackers':
                renderCustomTrackersTab($stage, state, settings);
                break;
            case 'worker':
                renderWorkerTab($stage, settings);
                break;
            case 'retry':
                renderRetryTab($stage, settings);
                break;
            case 'runtime':
                renderRuntimeTab($stage, state, settings);
                break;
            case 'appearance':
                renderAppearanceTab($stage, settings);
                break;
            case 'models':
                renderModelLibraryTab($stage, state, settings);
                break;
            case 'tools':
                renderToolsTab($stage, state, settings);
                break;
            default:
                renderOverviewTab($stage, state, settings, ws);
        }

        $stage.on('click', '#lpe_pop_go_live', () => {
            inspectSeq = null;
            inspectMesId = null;
            syncChrome();
            renderActiveTab({ resetScroll: false });
        });

        $stage.scrollTop(savedTop);
    }

    return {
        mount,
        open,
        close,
        isOpen,
        openDrawer,
        closeDrawer,
        toggleDrawer,
        isDrawerOpen,
        refresh,
        syncChrome,
    };
}

/** Legacy alias kept for external callers importing `createVexaAppPopup`. */
export const createVexaAppPopup = createLpeAppPopup;
