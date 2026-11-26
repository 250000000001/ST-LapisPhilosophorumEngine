/**
 * Megumin-Suite–inspired floating launcher button and glassmorphic tabbed Control Center popup
 * for Vexa State Engine.
 *
 * Strictly namespace-isolated (`#vse_fab_btn`, `#vse_app_overlay`, `.vse-*`) and uses only
 * scoped CSS custom properties so it coexists alongside Megumin Suite without collisions.
 */

import {
    VEXA_THEMES,
    VEXA_STYLES,
    PALETTE,
    cloneState,
    emptyState,
    isEmptySentinel,
    slugifyTrackerId,
} from './schema.js';
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
import { getChatCompletionProfiles } from './st.js';
import { evaluateEjs, shouldYieldEjs } from './ejsEngine.js';
import { shouldYieldRenderer } from './cardRenderer.js';

const FAB_POS_KEY = 'vexa_state_engine_fab_pos';

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
    { id: 'worker', group: 'engine', title: 'Vexa Clerk', sub: 'Secondary background API worker that tracks deltas after every reply.', icon: 'fa-robot' },
    { id: 'retry', group: 'engine', title: 'Refusal Retry', sub: 'Built-in safety refusal cleanup, GFX_END guard, and Non-Stream Continue.', icon: 'fa-shield-halved' },
    { id: 'runtime', group: 'engine', title: 'Card Runtime', sub: 'Scoped EJS templating, guarded Blob-URL renderer, sandboxed interactive bridge, and scoped card variables.', icon: 'fa-code' },
    { id: 'appearance', group: 'engine', title: 'HUD & Rules', sub: 'Visual themes, card styles, smart scoping, and deterministic engine caps.', icon: 'fa-palette' },
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
        name: 'Vexa State Engine',
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
        <div ${id ? `id="${esc(id)}"` : ''} class="vse-switch-row ${on ? 'active' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}" tabindex="0">
            <div class="vse-switch-info">
                <div class="vse-switch-label">
                    ${icon ? `<i class="fa-solid ${esc(icon)}" ${color ? `style="color:${esc(color)};"` : ''}></i>` : ''}
                    <span>${label}</span>
                </div>
                ${desc ? `<div class="vse-switch-desc">${desc}</div>` : ''}
            </div>
            <div class="vse-switch"></div>
        </div>
    `;
}

function renderTiles(groupName, options, current) {
    return `
        <div class="vse-tiles" data-tile-group="${esc(groupName)}">
            ${options.map((o) => `
                <button type="button" class="vse-tile ${String(o.id) === String(current) ? 'on' : ''}" data-tile-val="${esc(o.id)}">
                    <b>${esc(o.label)}</b>
                    ${o.desc ? `<span>${esc(o.desc)}</span>` : ''}
                </button>
            `).join('')}
        </div>
    `;
}

function renderPageHeader({ title, sub, icon, badgeHtml = '' }) {
    return `
        <div class="vse-page-head">
            <div class="vse-page-head-left">
                <div class="vse-page-icon"><i class="fa-solid ${esc(icon)}"></i></div>
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
    const theme = VEXA_THEMES[themeName] || VEXA_THEMES.Sola;
    for (const [k, v] of Object.entries(theme)) {
        if (k === 'scheme') $el.css('color-scheme', v);
        else $el.css(`--ist-${k}`, v);
    }
}

/**
 * Create the Megumin-style floating launcher + tabbed Control Center modal.
 */
export function createVexaAppPopup({
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
    let workerTestResult = null; // { ok, text }
    let fetchedModels = [];
    let apiKeyVisible = false;
    let fabDragBound = false;

    function isOpen() {
        const $ov = $('#vse_app_overlay');
        return Boolean($ov.length && $ov.css('display') !== 'none');
    }

    function activeState() {
        if (typeof inspectSeq === 'number') {
            return store?.getStateAt?.(inspectSeq) || cloneState(emptyState());
        }
        return store?.getState?.() || cloneState(emptyState());
    }

    function notifySettingsChanged({ retryChanged = false } = {}) {
        saveSettings?.();
        if (retryChanged) onRetryToggleChanged?.();
        onSettingsChanged?.();
        syncChrome();
    }

    function commitEditedState(nextState, msg = 'Saved state changes.') {
        store.addUserEdit(cloneState(nextState), { kind: 'snapshot' });
        inspectSeq = null;
        inspectMesId = null;
        onStateSaved?.();
        syncChrome();
        renderActiveTab();
        window.toastr?.success?.(msg, 'Vexa State Engine');
    }

    function initFabDrag() {
        const $btn = $('#vse_fab_btn');
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
            const raw = localStorage.getItem(FAB_POS_KEY);
            if (raw) savedPos = JSON.parse(raw);
        } catch {
            savedPos = null;
        }

        function applyPosition(pos) {
            $btn.css({ left: '', right: '', top: '', bottom: '' });
            const winW = $(window).width() || window.innerWidth || 1280;
            const winH = $(window).height() || window.innerHeight || 720;
            const gutter = winW <= 768 ? 12 : 20;
            const btnH = $btn.outerHeight() || 46;

            if (pos && typeof pos.topPercent === 'number') {
                const topPx = Math.max(10, Math.min(winH - btnH - 10, (pos.topPercent / 100) * winH));
                $btn.css('top', `${Math.round(topPx)}px`);
                if (pos.side === 'left') $btn.css('left', `${gutter}px`);
                else $btn.css('right', `${gutter}px`);
            } else {
                $btn.css({ top: '120px', right: `${gutter}px` });
            }
        }

        applyPosition(savedPos);
        $(window).off('resize.vse_fab').on('resize.vse_fab', () => applyPosition(savedPos));

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
            $btn.removeClass('vse-fab-transition');
            $(document).on('mousemove.vse_fab_drag touchmove.vse_fab_drag', dragMove);
            $(document).on('mouseup.vse_fab_drag touchend.vse_fab_drag', dragEnd);
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
            $(document).off('.vse_fab_drag');
            if (!hasMoved) return;

            $btn.addClass('vse-fab-transition');
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

        $btn.on('mousedown.vse_fab touchstart.vse_fab', dragStart);
        $btn.on('click.vse_fab', () => {
            if (isOpen()) close();
            else open();
        });
    }

    function buildDockHtml() {
        const topItems = APP_TABS.filter((t) => !t.group && !t.bottom);
        const bottomItems = APP_TABS.filter((t) => t.bottom);
        const dockItem = (t) => `
            <button type="button" class="vse-dock-item ${t.id === activeTab ? 'active' : ''}" data-tab="${esc(t.id)}" title="${esc(t.title)}">
                <i class="fa-solid ${esc(t.icon)}"></i>
                <span>${esc(t.title)}</span>
            </button>
        `;

        const parts = [...topItems.map(dockItem)];
        for (const g of APP_DOCK_GROUPS) {
            parts.push(`<div class="vse-dock-label"><span>${esc(g.title)}</span></div>`);
            for (const t of APP_TABS) {
                if (t.group === g.id) parts.push(dockItem(t));
            }
        }
        parts.push('<div class="vse-dock-spacer"></div>');
        parts.push('<div class="vse-dock-label vse-dock-label-util"><span>Utilities</span></div>');
        parts.push(...bottomItems.map(dockItem));
        return parts.join('');
    }

    function mount() {
        if (!$('#vse_fab_btn').length) {
            $('body').append(`
                <button type="button" id="vse_fab_btn" title="Vexa State Engine — Control Center" aria-label="Open Vexa Control Center">
                    <i class="fa-solid fa-compass"></i>
                </button>
            `);
        }

        if (!$('#vse_app_overlay').length) {
            $('body').append(`
                <div id="vse_app_overlay" role="dialog" aria-modal="true" aria-label="Vexa State Engine Control Center">
                    <div class="vse-app-window">
                        <nav class="vse-app-dock" id="vse_app_dock" aria-label="Vexa Control Center Navigation"></nav>
                        <div class="vse-app-main">
                            <header class="vse-hero" id="vse_app_hero">
                                <div class="vse-hero-bg" id="vse_hero_bg"></div>
                                <div class="vse-hero-overlay"></div>
                                <div class="vse-topbar">
                                    <div class="vse-app-actions">
                                        <div id="vse_app_tokens" class="vse-token-pill" title="Estimated state snapshot tokens">
                                            <i class="fa-solid fa-microchip"></i> ~0 tok · ct:0
                                        </div>
                                        <div id="vse_app_worker_pill" class="vse-worker-pill" style="display:none;">
                                            <i class="fa-solid fa-spinner fa-spin"></i>
                                            <span id="vse_app_worker_lbl">Working</span>
                                            <button type="button" id="vse_app_stop_btn" class="vse-mini-stop" title="Stop worker"><i class="fa-solid fa-stop"></i></button>
                                        </div>
                                        <button type="button" id="vse_app_power" class="vse-app-btn secondary" title="Toggle Vexa State Engine on/off">
                                            <i class="fa-solid fa-power-off"></i> <span>On</span>
                                        </button>
                                        <button type="button" id="vse_app_reread" class="vse-app-btn secondary" title="Re-run Vexa Clerk on latest AI reply">
                                            <i class="fa-solid fa-rotate"></i> <span>Re-read</span>
                                        </button>
                                        <button type="button" id="vse_app_close" class="vse-app-btn primary" title="Save &amp; Close">
                                            <i class="fa-solid fa-floppy-disk"></i> <span>Save &amp; Close</span>
                                        </button>
                                    </div>
                                </div>
                                <div class="vse-hero-meta">
                                    <div class="vse-hero-kicker" id="vse_hero_kicker">VEXA STATE ENGINE</div>
                                    <h2 class="vse-hero-name" id="vse_hero_name">Vexa State Engine</h2>
                                </div>
                            </header>
                            <div class="vse-app-stage" id="vse_app_stage"></div>
                        </div>
                    </div>
                </div>
            `);
        }

        const $overlay = $('#vse_app_overlay');
        $('#vse_app_dock').html(buildDockHtml());

        $overlay.off('.vseApp');
        $overlay.on('click.vseApp', (e) => {
            if (e.target === $overlay[0]) close();
        });
        $overlay.on('click.vseApp', '#vse_app_close', () => close());
        $overlay.on('click.vseApp', '#vse_app_power', () => {
            const s = getSettings();
            s.enabled = !s.enabled;
            notifySettingsChanged();
        });
        $overlay.on('click.vseApp', '#vse_app_reread', () => {
            onRereadLast?.();
            syncChrome();
        });
        $overlay.on('click.vseApp', '#vse_app_stop_btn', (e) => {
            e.stopPropagation();
            workerClient?.stopAll?.();
            syncChrome();
        });
        $overlay.on('click.vseApp', '.vse-dock-item', function () {
            const tabId = String($(this).data('tab') || 'overview');
            if (tabId !== activeTab) {
                activeTab = tabId;
                updateDockActive();
                renderActiveTab({ resetScroll: true });
            }
        });

        $(document).off('keydown.vseApp').on('keydown.vseApp', (e) => {
            if (e.key === 'Escape' && isOpen()) {
                close();
            }
        });

        initFabDrag();
        syncChrome();
    }

    function updateDockActive() {
        $('#vse_app_dock .vse-dock-item').each(function () {
            $(this).toggleClass('active', String($(this).data('tab')) === activeTab);
        });
    }

    function syncChrome() {
        const s = getSettings();
        const ws = getWorkerStatus?.() || { busy: false };
        const $fab = $('#vse_fab_btn');
        if ($fab.length) {
            $fab.toggle(s.showLauncherButton !== false);
            $fab.toggleClass('vse-fab-off', !s.enabled);
            $fab.toggleClass('vse-fab-busy', Boolean(ws.busy));
        }

        const $ov = $('#vse_app_overlay');
        if (!$ov.length) return;

        const ctx = getContextSafe?.() || {};
        const banner = getCharacterBannerInfo(ctx);
        const st = activeState();
        const ct = st?.world?.ct ?? 0;

        const $bg = $('#vse_hero_bg');
        if ($bg.length) {
            if (banner.imageUrl) {
                $bg.css('background-image', `url("${banner.imageUrl.replace(/"/g, '\\"')}")`).removeClass('vse-hero-noimg');
            } else {
                $bg.css('background-image', '').addClass('vse-hero-noimg');
            }
        }
        $('#vse_hero_kicker').text(`${banner.subtitle} · CT ${ct}`);
        $('#vse_hero_name').text(banner.name);

        const $pwr = $('#vse_app_power');
        if ($pwr.length) {
            $pwr.toggleClass('vse-power-on', Boolean(s.enabled)).toggleClass('vse-power-off', !s.enabled);
            $pwr.html(`<i class="fa-solid fa-power-off"></i> <span>${s.enabled ? 'On' : 'Off'}</span>`);
        }

        const $wp = $('#vse_app_worker_pill');
        if ($wp.length) {
            if (ws.busy) {
                $('#vse_app_worker_lbl').text(ws.runningLabel || 'Updating');
                $wp.css('display', 'inline-flex');
            } else {
                $wp.hide();
            }
        }

        const $tok = $('#vse_app_tokens');
        if ($tok.length) {
            let tok = 0;
            if (store?.hasState?.()) {
                const xml = serializeInternalStates(st, {
                    scoped: s.scoped !== false,
                    recentText: getRecentStoryText?.() || '',
                    includeVent: false,
                });
                tok = estimateTokenCount(xml);
            }
            $tok.html(`<i class="fa-solid fa-microchip"></i> ~${tok} tok · ct:${esc(ct)}`);
        }
    }

    function open({ tab = null, sub = null, seq = null, mesId = null } = {}) {
        mount();
        if (tab && APP_TABS.some((t) => t.id === tab)) {
            activeTab = tab;
        }
        if (sub && activeTab in subTabs) {
            subTabs[activeTab] = sub;
        }
        inspectSeq = typeof seq === 'number' ? seq : null;
        inspectMesId = typeof mesId === 'number' ? mesId : null;

        updateDockActive();
        syncChrome();
        $('#vse_app_overlay').css('display', 'flex');
        renderActiveTab({ resetScroll: true });
    }

    function close() {
        disposeWebgl();
        $('#vse_app_overlay').hide();
        saveSettings?.();
        syncChrome();
    }

    function refresh() {
        syncChrome();
        if (!isOpen()) return;
        const activeEl = document.activeElement;
        const $stage = $('#vse_app_stage');
        if (activeEl && $stage.length && $stage[0].contains(activeEl) && /^(INPUT|TEXTAREA|SELECT)$/i.test(activeEl.tagName)) {
            return;
        }
        renderActiveTab({ resetScroll: false });
    }

    function historyBannerHtml(state) {
        if (typeof inspectSeq !== 'number') return '';
        return `
            <div class="vse-banner warn">
                <i class="fa-solid fa-clock-rotate-left"></i>
                <span>Viewing historical snapshot at <b>ct:${esc(state.world?.ct ?? 0)}</b>${inspectMesId !== null ? ` (Message #${esc(inspectMesId)})` : ''}. Saving any edit applies forward as a user override.</span>
                <button type="button" class="vse-app-btn secondary vse-btn-sm" id="vse_pop_go_live">Switch to Live State</button>
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
            ? `<span class="vse-head-badge warm"><i class="fa-solid fa-spinner fa-spin"></i> ${esc(ws.runningLabel || 'Updating')}</span>`
            : has
                ? `<span class="vse-head-badge ok"><i class="fa-solid fa-circle-check"></i> Tracked · ct:${esc(w.ct ?? 0)}</span>`
                : `<span class="vse-head-badge"><i class="fa-solid fa-circle"></i> Turn 1 Pending</span>`;

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
            <div class="vse-stat-grid">
                ${stats.map(([k, v]) => `<div class="vse-stat-chip"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
            </div>
            <div class="vse-glass-card">
                <div class="vse-card-head">
                    <div>
                        <div class="vse-card-title">Scene &amp; World Environment</div>
                        <div class="vse-card-sub">Edit current scene metadata or click Save World Changes to record a persistent state override.</div>
                    </div>
                    <button type="button" class="vse-app-btn primary" id="vse_pop_save_world"><i class="fa-solid fa-floppy-disk"></i> Save World Changes</button>
                </div>
                <div class="vse-form-grid">
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Turn (ct)</label>
                        <input type="number" class="vse-app-input" data-pop-w="ct" value="${esc(w.ct ?? 0)}" />
                    </div>
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Pacing</label>
                        <div class="vse-seg" id="vse_pop_pacing_seg">
                            ${['SLOW', 'FLOW', 'PUSH'].map((p) => `<button type="button" class="${w.pacing === p ? 'on' : ''}" data-pacing="${p}">${p}</button>`).join('')}
                        </div>
                    </div>
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Location</label>
                        <input type="text" class="vse-app-input" data-pop-w="loc" value="${esc(w.loc)}" />
                    </div>
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Time</label>
                        <input type="text" class="vse-app-input" data-pop-w="time" value="${esc(w.time)}" />
                    </div>
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Date</label>
                        <input type="text" class="vse-app-input" data-pop-w="date" value="${esc(w.date)}" />
                    </div>
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Weather</label>
                        <input type="text" class="vse-app-input" data-pop-w="weather" value="${esc(w.weather)}" />
                    </div>
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">User Position [x,y]</label>
                        <input type="text" class="vse-app-input" data-pop-w="user_pos" value="${esc(w.user_pos)}" />
                    </div>
                    <div class="vse-field-col wide">
                        <label class="vse-field-lbl">Room Details</label>
                        <textarea class="vse-app-input" rows="2" data-pop-w="room">${esc(w.room)}</textarea>
                    </div>
                    <div class="vse-field-col wide">
                        <label class="vse-field-lbl">Entries / Exits</label>
                        <textarea class="vse-app-input" rows="2" data-pop-w="entries">${esc(w.entries)}</textarea>
                    </div>
                    <div class="vse-field-col wide">
                        <label class="vse-field-lbl">Obstacles</label>
                        <textarea class="vse-app-input" rows="2" data-pop-w="obstacles">${esc(w.obstacles)}</textarea>
                    </div>
                    <div class="vse-field-col wide">
                        <label class="vse-field-lbl">Audio / Occlusion</label>
                        <textarea class="vse-app-input" rows="2" data-pop-w="audio">${esc(w.audio)}</textarea>
                    </div>
                </div>
            </div>
        `);

        let selectedPacing = w.pacing || 'FLOW';
        $stage.find('#vse_pop_pacing_seg').on('click', 'button', function () {
            selectedPacing = String($(this).data('pacing') || 'FLOW');
            $(this).siblings().removeClass('on');
            $(this).addClass('on');
        });
        $stage.find('#vse_pop_save_world').on('click', () => {
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
            <optgroup label="Geometric Primitives (${POLY_SHAPES.length})">
                ${POLY_SHAPES.map((sh) => `<option value="${esc(sh)}">${esc(sh)}</option>`).join('')}
            </optgroup>
        `;
        const matDatalistHtml = Object.keys(POLY_MATERIALS).map((m) => `<option value="${esc(m)}">`).join('');

        $stage.html(`
            ${renderPageHeader({ ...meta, badgeHtml: `<span class="vse-head-badge ok">${mapCount} map${mapCount === 1 ? '' : 's'} · ${roomCount} room${roomCount === 1 ? '' : 's'}</span>` })}
            ${historyBannerHtml(state)}
            <div class="vse-glass-card">
                <div class="vse-atlas-mount" id="vse_pop_atlas_mount"></div>
            </div>
            <details class="vse-glass-card vse-fold-card">
                <summary class="vse-fold-summary"><i class="fa-solid fa-cubes"></i> Add / Remove 3D Object (PolyCSS)</summary>
                <div class="vse-fold-body">
                    <div class="vse-form-grid">
                        <label>Target Room
                            <select id="vse_pop_obj_room" class="vse-app-input">${roomOptsHtml}</select>
                        </label>
                        <label>Shape Primitive
                            <select id="vse_pop_obj_shape" class="vse-app-input">${shapeOptsHtml}</select>
                        </label>
                        <label>Label
                            <input id="vse_pop_obj_label" type="text" class="vse-app-input" placeholder="e.g. Oak Table" />
                        </label>
                        <label>Material / Hex Color
                            <input id="vse_pop_obj_color" type="text" list="vse_pop_mat_list" class="vse-app-input" value="wood" placeholder="wood, stone, fire, #e6b44c" />
                            <datalist id="vse_pop_mat_list">${matDatalistHtml}</datalist>
                        </label>
                        <label>Local Pos [x,y,z] (m)
                            <input id="vse_pop_obj_pos" type="text" class="vse-app-input vse-mono" value="3,3,0" placeholder="x,y,z" />
                        </label>
                        <label>Size [w,d,h] (m)
                            <input id="vse_pop_obj_size" type="text" class="vse-app-input vse-mono" value="1.8,1.2,1.0" placeholder="w,d,h" />
                        </label>
                        <label>Rotation Z (deg)
                            <input id="vse_pop_obj_rot" type="number" class="vse-app-input" value="0" step="15" />
                        </label>
                    </div>
                    <div class="vse-inline-actions" style="margin-top:8px;">
                        <span class="vse-err-text" id="vse_pop_obj_err"></span>
                        <button type="button" class="vse-app-btn primary" id="vse_pop_add_obj" ${allRooms.length ? '' : 'disabled'}><i class="fa-solid fa-plus"></i> Add 3D Object</button>
                    </div>
                    <div id="vse_pop_obj_list" style="margin-top:10px;"></div>
                </div>
            </details>
            <details class="vse-glass-card vse-fold-card">
                <summary class="vse-fold-summary"><i class="fa-solid fa-code"></i> Edit Atlas JSON (auto-recomputes room bbox)</summary>
                <div class="vse-fold-body">
                    <textarea id="vse_pop_atlas_json" class="vse-app-input vse-mono" rows="12">${esc(JSON.stringify(state.locations || emptyState().locations, null, 2))}</textarea>
                    <div class="vse-inline-actions">
                        <span class="vse-err-text" id="vse_pop_atlas_err"></span>
                        <button type="button" class="vse-app-btn primary" id="vse_pop_save_atlas"><i class="fa-solid fa-floppy-disk"></i> Save Atlas</button>
                    </div>
                </div>
            </details>
        `);

        const $mount = $stage.find('#vse_pop_atlas_mount');
        applyThemeVarsToEl($mount, settings.hudTheme || 'Sola');

        function refreshObjList(roomId) {
            const targetRoom = allRooms.find((r) => r.id === roomId);
            const objs = Array.isArray(targetRoom?.objects) ? targetRoom.objects : [];
            const $list = $stage.find('#vse_pop_obj_list');
            if (!targetRoom) {
                $list.html('');
                return;
            }
            if (!objs.length) {
                $list.html(`<div class="vse-muted">No explicit 3D objects on <b>${esc(targetRoom.name || targetRoom.id)}</b> (auto-inferred from features).</div>`);
                return;
            }
            $list.html(`
                <div class="vse-muted" style="margin-bottom:4px;">Explicit 3D objects in <b>${esc(targetRoom.name || targetRoom.id)}</b>:</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    ${objs.map((o) => `
                        <span class="vse-pill">
                            [${esc(o.shape)}] ${esc(o.label)} [${esc((o.pos || []).join(','))}]
                            <button type="button" class="vse-mini-btn vse-pop-rm-obj" data-room-id="${esc(targetRoom.id)}" data-obj-label="${esc(o.label)}" title="Remove object" style="margin-left:4px;"><i class="fa-solid fa-xmark"></i></button>
                        </span>
                    `).join('')}
                </div>
            `);
        }

        function drawAtlas() {
            disposeWebgl();
            const effectiveMode = atlasView.mode || settings.atlasViewMode || 'webgl';
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
            }));
            if (effectiveMode === 'webgl') {
                const vpEl = $mount.find('.vse-webgl-viewport')[0];
                if (vpEl) {
                    const mySeq = ++webglMountSeq;
                    import('./atlasWebgl.js').then(({ mountAtlasWebGLViewport }) => {
                        if (mySeq !== webglMountSeq || !isOpen() || activeTab !== 'atlas' || !vpEl.isConnected) return;
                        activeWebglHandle = mountAtlasWebGLViewport(vpEl, state, {
                            selectedMapId: atlasView.mapId,
                            selectedLevel: atlasView.level,
                            selectedRoomId: atlasView.roomId,
                            allFloors: atlasView.allFloors,
                            cutaway: atlasView.cutaway,
                            showLabels: atlasView.showLabels,
                            camera: atlasView.webglCamera,
                            onCameraChange: (cam) => { atlasView.webglCamera = cam; },
                            onSelectRoom: (roomId) => {
                                atlasView.roomId = roomId;
                                if ($stage.find(`#vse_pop_obj_room option[value="${roomId}"]`).length) {
                                    $stage.find('#vse_pop_obj_room').val(roomId);
                                    refreshObjList(roomId);
                                }
                                drawAtlas();
                            },
                        });
                    }).catch(() => {});
                }
            } else if (effectiveMode === '3d') {
                const vpEl = $mount.find('.vse-poly-viewport')[0];
                if (vpEl) {
                    bindPolyOrbitControls(vpEl, atlasView.camera, {
                        onSelectRoom: (roomId) => {
                            atlasView.roomId = roomId;
                            if ($stage.find(`#vse_pop_obj_room option[value="${roomId}"]`).length) {
                                $stage.find('#vse_pop_obj_room').val(roomId);
                                refreshObjList(roomId);
                            }
                            drawAtlas();
                        },
                    });
                }
            } else if (effectiveMode === '2d') {
                const svgWrapEl = $mount.find('.vse-atlas-svg-wrap')[0];
                if (svgWrapEl) bindAtlasSvgControls(svgWrapEl, atlasView.svgCamera);
            }
        }
        drawAtlas();
        refreshObjList(activeObjRoomId);

        $mount.on('change', '.vse-atlas-map-sel', function () {
            atlasView.mapId = String($(this).val() || '');
            atlasView.level = null;
            atlasView.roomId = null;
            atlasView.svgCamera = { zoom: 1, panX: 0, panY: 0 };
            atlasView.webglCamera = null;
            atlasView.webglCameraKey = null;
            drawAtlas();
        });
        $mount.on('click', '.vse-atlas-floor-btn', function () {
            atlasView.level = String($(this).data('level'));
            atlasView.allFloors = false;
            atlasView.roomId = null;
            atlasView.svgCamera = { zoom: 1, panX: 0, panY: 0 };
            drawAtlas();
        });
        $mount.on('click', '.vse-atlas-allfloors-btn', function () {
            atlasView.allFloors = !atlasView.allFloors;
            drawAtlas();
        });
        $mount.on('click', '.vse-atlas-mode-btn', function () {
            atlasView.mode = String($(this).data('atlas-mode') || 'webgl');
            drawAtlas();
        });
        $mount.on('click', '.vse-poly-cutaway-btn', function (e) {
            e.stopPropagation();
            atlasView.cutaway = !atlasView.cutaway;
            drawAtlas();
        });
        $mount.on('click', '.vse-poly-labels-btn', function (e) {
            e.stopPropagation();
            atlasView.showLabels = !atlasView.showLabels;
            drawAtlas();
        });
        $mount.on('click', '.vse-atlas-room-g, .vse-atlas-room-pill', function () {
            const rid = String($(this).data('room-id') || '');
            atlasView.roomId = rid;
            if ($stage.find(`#vse_pop_obj_room option[value="${rid}"]`).length) {
                $stage.find('#vse_pop_obj_room').val(rid);
                refreshObjList(rid);
            }
            drawAtlas();
        });

        $stage.find('#vse_pop_obj_room').on('change', function () {
            refreshObjList(String($(this).val() || ''));
        });

        $stage.find('#vse_pop_add_obj').on('click', () => {
            $('#vse_pop_obj_err').text('');
            const rid = String($stage.find('#vse_pop_obj_room').val() || '').trim();
            const draft = cloneState(state);
            const targetRoom = (draft.locations?.rooms || []).find((r) => r.id === rid);
            if (!targetRoom) {
                $('#vse_pop_obj_err').text('Select a valid target room.');
                return;
            }
            const shape = String($stage.find('#vse_pop_obj_shape').val() || 'box');
            const label = String($stage.find('#vse_pop_obj_label').val() || '').trim() || shape;
            const color = String($stage.find('#vse_pop_obj_color').val() || 'wood').trim();
            const posRaw = String($stage.find('#vse_pop_obj_pos').val() || '2,2,0');
            const sizeRaw = String($stage.find('#vse_pop_obj_size').val() || '1.8,1.2,1.0');
            const rot = Number($stage.find('#vse_pop_obj_rot').val()) || 0;

            const obj = normalizeAtlasObject({ shape, label, color, pos: posRaw, size: sizeRaw, rot }, parseDimMeters(targetRoom.dim));
            targetRoom.objects = normalizeRoomObjects([...(targetRoom.objects || []), obj], parseDimMeters(targetRoom.dim));
            atlasView.roomId = rid;
            commitEditedState(draft, `Added 3D ${obj.shape} "${obj.label}" to ${targetRoom.name || rid}.`);
        });

        $stage.on('click', '.vse-pop-rm-obj', function () {
            const rid = String($(this).data('room-id') || '');
            const lbl = String($(this).data('obj-label') || '').toLowerCase();
            const draft = cloneState(state);
            const targetRoom = (draft.locations?.rooms || []).find((r) => r.id === rid);
            if (!targetRoom || !Array.isArray(targetRoom.objects)) return;
            targetRoom.objects = targetRoom.objects.filter((o) => String(o.label || '').toLowerCase() !== lbl);
            commitEditedState(draft, `Removed 3D object "${lbl}".`);
        });

        $stage.find('#vse_pop_save_atlas').on('click', () => {
            $('#vse_pop_atlas_err').text('');
            try {
                const parsed = JSON.parse(String($stage.find('#vse_pop_atlas_json').val() || '{}'));
                for (const r of parsed.rooms || []) {
                    const box = computeBbox(r.grid, r.dim);
                    if (box) r.bbox = box.str;
                }
                const draft = cloneState(state);
                draft.locations = parsed;
                commitEditedState(draft, 'Saved Atlas layout.');
            } catch (err) {
                $('#vse_pop_atlas_err').text(`Invalid JSON: ${err.message}`);
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
            `<button type="button" class="vse-app-btn secondary vse-btn-sm ${effHealth.bodyType === bt ? 'vse-pop-bt-on' : ''}" data-body-type="${esc(bt)}">${esc(bt.charAt(0).toUpperCase() + bt.slice(1))}</button>`,
        ).join('');

        const badgeCls = metrics.bleedingCount > 0 || metrics.overallHp < 50 ? 'warm' : 'ok';
        const badgeText = `${metrics.overallHp}% HP · ${metrics.totalWounds} WOUND${metrics.totalWounds === 1 ? '' : 'S'}${metrics.bleedingCount ? ` · ${metrics.bleedingCount} BLEEDING` : ''}`;

        $stage.html(`
            ${renderPageHeader({ ...meta, badgeHtml: `<span class="vse-head-badge ${badgeCls}">${esc(badgeText)}</span>` })}
            ${historyBannerHtml(state)}
            <div class="vse-glass-card">
                <div class="vse-card-head">
                    <div class="vse-inline-actions" style="justify-content:flex-start;">
                        <span class="vse-field-lbl" style="margin:0;">Silhouette:</span>
                        ${bodyTypePills}
                    </div>
                    <div class="vse-inline-actions">
                        ${isInferred ? `<button type="button" class="vse-app-btn gold vse-btn-sm" id="vse_pop_adopt_inferred" title="Save inferred injuries into canonical health state"><i class="fa-solid fa-wand-magic-sparkles"></i> Adopt Inferred</button>` : ''}
                        <button type="button" class="vse-app-btn secondary vse-btn-sm" id="vse_pop_tend_all"><i class="fa-solid fa-bandage"></i> Tend All</button>
                        <button type="button" class="vse-app-btn vse-btn-heal vse-btn-sm" id="vse_pop_full_heal"><i class="fa-solid fa-heart"></i> Full Heal</button>
                    </div>
                </div>
                <div id="vse_pop_health_doll_wrap">
                    ${renderHealthTab(state, {
                        layer: healthView.layer,
                        selectedPart: healthView.selectedPart,
                        bodyTypeOverride: settings.defaultBodyType,
                        compact: false,
                        showActions: true,
                    })}
                </div>
            </div>

            <div class="vse-glass-card">
                <div class="vse-card-head">
                    <div>
                        <div class="vse-card-title">Add / Update Body Part Condition</div>
                        <div class="vse-card-sub">Click any part on the silhouette above to target it, or pick a part below.</div>
                    </div>
                </div>
                <div class="vse-form-grid">
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Body Part</label>
                        <select id="vse_pop_hp_part" class="vse-app-input">${partOptsHtml}</select>
                    </div>
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Condition Kind</label>
                        <select id="vse_pop_hp_kind" class="vse-app-input">${kindOptsHtml}</select>
                    </div>
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Label</label>
                        <input id="vse_pop_hp_label" type="text" class="vse-app-input" placeholder="e.g. Deep Sword Cut" />
                    </div>
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Severity (1–100%)</label>
                        <input id="vse_pop_hp_sev" type="number" min="1" max="100" step="5" class="vse-app-input" value="30" />
                    </div>
                    <div class="vse-field-col wide">
                        <label class="vse-field-lbl">Note</label>
                        <input id="vse_pop_hp_note" type="text" class="vse-app-input" placeholder="Optional cause or healing detail" />
                    </div>
                </div>
                <div class="vse-inline-actions" style="justify-content:space-between;">
                    <div class="vse-inline-actions" style="justify-content:flex-start;">
                        <label class="vse-check-inline"><input type="checkbox" id="vse_pop_hp_bleed" /> Bleeding</label>
                        <label class="vse-check-inline"><input type="checkbox" id="vse_pop_hp_treated" /> Bandaged / Treated</label>
                        <label class="vse-check-inline"><input type="checkbox" id="vse_pop_hp_scar" /> Permanent Scar</label>
                    </div>
                    <button type="button" class="vse-app-btn primary" id="vse_pop_hp_add_btn"><i class="fa-solid fa-plus"></i> Record Condition</button>
                </div>
                <hr class="vse-sep" />
                <div class="vse-form-grid">
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Prosthetic / Implant (<span id="vse_pop_hp_part_lbl">${esc(BODY_PART_BY_ID[activePartId]?.label || activePartId)}</span>)</label>
                        <input id="vse_pop_hp_prosthetic" type="text" class="vse-app-input" value="${esc(activePartRec?.prosthetic || '')}" placeholder="e.g. Clockwork Hand (blank to clear)" />
                    </div>
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Armor Cover</label>
                        <input id="vse_pop_hp_armor" type="text" class="vse-app-input" value="${esc(activePartRec?.armor || '')}" placeholder="e.g. Steel Vambrace" />
                    </div>
                </div>
                <div class="vse-inline-actions" style="justify-content:space-between;">
                    <label class="vse-check-inline"><input type="checkbox" id="vse_pop_hp_missing" ${activePartRec?.missing ? 'checked' : ''} /> Part Missing (0% HP)</label>
                    <button type="button" class="vse-app-btn secondary" id="vse_pop_hp_save_part"><i class="fa-solid fa-shield-halved"></i> Save Part Status</button>
                </div>
            </div>

            <div class="vse-glass-card">
                <div class="vse-card-title">Systemic Vitals &amp; Whole-Body Conditions</div>
                <div class="vse-form-grid">
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Blood Loss (0–100%)</label>
                        <input id="vse_pop_hp_bloodloss" type="number" min="0" max="100" step="5" class="vse-app-input" value="${esc(effHealth.bloodLoss || 0)}" />
                    </div>
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Pain Override (0–100%)</label>
                        <input id="vse_pop_hp_pain" type="number" min="0" max="100" step="5" class="vse-app-input" value="${esc(effHealth.pain || 0)}" />
                    </div>
                </div>
                <div class="vse-inline-actions" style="justify-content:flex-end;">
                    <button type="button" class="vse-app-btn secondary" id="vse_pop_hp_save_vitals"><i class="fa-solid fa-droplet"></i> Save Vitals</button>
                </div>
                <hr class="vse-sep" />
                <div class="vse-form-grid">
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Whole-Body Type</label>
                        <select id="vse_pop_wb_type" class="vse-app-input">${wbOptsHtml}</select>
                    </div>
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Condition Label</label>
                        <input id="vse_pop_wb_label" type="text" class="vse-app-input" placeholder="e.g. Swamp Fever" />
                    </div>
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Severity (1–100%)</label>
                        <input id="vse_pop_wb_sev" type="number" min="1" max="100" step="5" class="vse-app-input" value="35" />
                    </div>
                </div>
                <div class="vse-inline-actions" style="justify-content:flex-end;">
                    <button type="button" class="vse-app-btn secondary" id="vse_pop_wb_add"><i class="fa-solid fa-biohazard"></i> Add Whole-Body Condition</button>
                </div>
            </div>

            <details class="vse-glass-card vse-fold-card">
                <summary class="vse-fold-summary"><i class="fa-solid fa-code"></i> Edit Health JSON</summary>
                <div class="vse-fold-body">
                    <textarea id="vse_pop_health_json" class="vse-app-input vse-mono" rows="12">${esc(JSON.stringify(effHealth, null, 2))}</textarea>
                    <div class="vse-inline-actions">
                        <span class="vse-err-text" id="vse_pop_health_err"></span>
                        <button type="button" class="vse-app-btn primary" id="vse_pop_save_health_json"><i class="fa-solid fa-floppy-disk"></i> Save Health JSON</button>
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

        $stage.find('#vse_pop_adopt_inferred').on('click', () => {
            const draft = cloneState(state);
            draft.health = normalizeHealthState(effHealth);
            commitEditedState(draft, 'Adopted inferred injuries into canonical health state.');
        });

        $stage.find('#vse_pop_tend_all').on('click', () => {
            const draft = cloneState(state);
            draft.health = applyHealthDelta(baseHealthForEdit(true), { tend_all: true });
            commitEditedState(draft, 'Tended and bandaged all active wounds.');
        });

        $stage.find('#vse_pop_full_heal').on('click', () => {
            const draft = cloneState(state);
            draft.health = applyHealthDelta(baseHealthForEdit(false), { full_heal: true });
            commitEditedState(draft, 'Restored persona to full health.');
        });

        $stage.on('click', '.vse-doll-part', function () {
            const pid = String($(this).data('part-id') || '');
            healthView.selectedPart = healthView.selectedPart === pid ? null : (pid || null);
            renderHealthPopupTab($stage, state, settings);
        });
        $stage.on('click', '.vse-health-part-chip', function () {
            healthView.selectedPart = String($(this).data('part-id') || '') || null;
            renderHealthPopupTab($stage, state, settings);
        });
        $stage.on('click', '.vse-health-clear-sel', () => {
            healthView.selectedPart = null;
            renderHealthPopupTab($stage, state, settings);
        });
        $stage.on('click', '.vse-health-layer-btn, .vse-doll-internal-alert', function () {
            healthView.layer = String($(this).data('health-layer') || $(this).data('layer-jump') || 'body');
            renderHealthPopupTab($stage, state, settings);
        });

        $stage.find('#vse_pop_hp_part').on('change', function () {
            const pid = String($(this).val() || 'torso');
            healthView.selectedPart = pid;
            const rec = effHealth.parts?.[pid] || null;
            $stage.find('#vse_pop_hp_part_lbl').text(BODY_PART_BY_ID[pid]?.label || pid);
            $stage.find('#vse_pop_hp_prosthetic').val(rec?.prosthetic || '');
            $stage.find('#vse_pop_hp_armor').val(rec?.armor || '');
            $stage.find('#vse_pop_hp_missing').prop('checked', Boolean(rec?.missing));
        });

        $stage.on('click', '.vse-health-treat-btn', function () {
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

        $stage.on('click', '.vse-health-scar-btn', function () {
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

        $stage.on('click', '.vse-health-heal-btn', function () {
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

        $stage.on('click', '.vse-health-rm-whole', function () {
            const lbl = String($(this).data('wb-label') || '');
            const draft = cloneState(state);
            draft.health = applyHealthDelta(baseHealthForEdit(true), { whole_body_remove: [lbl] });
            commitEditedState(draft, `Removed whole-body condition "${lbl}".`);
        });

        $stage.find('#vse_pop_hp_add_btn').on('click', () => {
            const part = String($stage.find('#vse_pop_hp_part').val() || 'torso');
            const kind = String($stage.find('#vse_pop_hp_kind').val() || 'sharp');
            const label = String($stage.find('#vse_pop_hp_label').val() || '').trim()
                || `${kind.charAt(0).toUpperCase() + kind.slice(1)} Injury`;
            const severity = parseInt(String($stage.find('#vse_pop_hp_sev').val()), 10) || 25;
            const bleeding = Boolean($stage.find('#vse_pop_hp_bleed').prop('checked'));
            const treated = Boolean($stage.find('#vse_pop_hp_treated').prop('checked'));
            const scar = Boolean($stage.find('#vse_pop_hp_scar').prop('checked'));
            const note = String($stage.find('#vse_pop_hp_note').val() || '').trim();

            healthView.selectedPart = part;
            const draft = cloneState(state);
            draft.health = applyHealthDelta(baseHealthForEdit(false), {
                add_conditions: [{ part, kind, label, severity, bleeding, treated, scar, note }],
            });
            commitEditedState(draft, `Recorded "${label}" on ${BODY_PART_BY_ID[part]?.label || part}.`);
        });

        $stage.find('#vse_pop_hp_save_part').on('click', () => {
            const part = String($stage.find('#vse_pop_hp_part').val() || 'torso');
            const prosthetic = String($stage.find('#vse_pop_hp_prosthetic').val() || '').trim();
            const armor = String($stage.find('#vse_pop_hp_armor').val() || '').trim();
            const missing = Boolean($stage.find('#vse_pop_hp_missing').prop('checked'));

            healthView.selectedPart = part;
            const draft = cloneState(state);
            draft.health = applyHealthDelta(baseHealthForEdit(false), {
                set_parts: { [part]: { missing, prosthetic, armor } },
            });
            commitEditedState(draft, `Updated ${BODY_PART_BY_ID[part]?.label || part} status.`);
        });

        $stage.find('#vse_pop_hp_save_vitals').on('click', () => {
            const bloodLoss = parseInt(String($stage.find('#vse_pop_hp_bloodloss').val()), 10) || 0;
            const pain = parseInt(String($stage.find('#vse_pop_hp_pain').val()), 10) || 0;
            const draft = cloneState(state);
            draft.health = applyHealthDelta(baseHealthForEdit(false), { bloodLoss, pain });
            commitEditedState(draft, 'Saved systemic blood loss & pain.');
        });

        $stage.find('#vse_pop_wb_add').on('click', () => {
            const type = String($stage.find('#vse_pop_wb_type').val() || 'other');
            const label = String($stage.find('#vse_pop_wb_label').val() || '').trim()
                || `${type.charAt(0).toUpperCase() + type.slice(1)}`;
            const severity = parseInt(String($stage.find('#vse_pop_wb_sev').val()), 10) || 35;
            const draft = cloneState(state);
            draft.health = applyHealthDelta(baseHealthForEdit(false), {
                whole_body_upsert: [{ type, label, severity }],
            });
            commitEditedState(draft, `Added whole-body condition "${label}".`);
        });

        $stage.find('#vse_pop_save_health_json').on('click', () => {
            $('#vse_pop_health_err').text('');
            try {
                const parsed = JSON.parse(String($stage.find('#vse_pop_health_json').val() || '{}'));
                const draft = cloneState(state);
                draft.health = normalizeHealthState(parsed);
                commitEditedState(draft, 'Saved Health JSON.');
            } catch (err) {
                $('#vse_pop_health_err').text(`Invalid JSON: ${err.message}`);
            }
        });
    }

    function renderCastTab($stage, state) {
        const meta = tabMeta('cast');
        const sub = subTabs.cast || 'onscreen';
        const subList = [
            { id: 'onscreen', label: `On-Screen (${(state.onscreen || []).length})`, icon: 'fa-eye' },
            { id: 'offscreen', label: `Off-Screen (${(state.offscreen_agendas || []).length})`, icon: 'fa-compass' },
            { id: 'entities', label: `Entity Profiles (${(state.entity_state || []).length})`, icon: 'fa-masks-theater' },
            { id: 'memories', label: `Memories (${(state.entityMem || []).length})`, icon: 'fa-brain' },
            { id: 'thoughts', label: `Thoughts (${(state.thoughts || []).length})`, icon: 'fa-comment-dots' },
        ];

        const subBar = `
            <div class="vse-subtabs">
                ${subList.map((s) => `<button type="button" class="${s.id === sub ? 'on' : ''}" data-sub="${s.id}"><i class="fa-solid ${s.icon}"></i> ${esc(s.label)}</button>`).join('')}
            </div>
        `;

        let contentHtml = '';
        if (sub === 'entities') {
            const colorOptions = (selected) => {
                const selLow = String(selected || '').toLowerCase();
                return [
                    '<option value="">(Unassigned)</option>',
                    ...PALETTE.map((p) => {
                        const val = `${p.name} ${p.hex}`;
                        const isSel = selLow.includes(p.name) || selLow.includes(p.hex.toLowerCase());
                        return `<option value="${esc(val)}" ${isSel ? 'selected' : ''}>${esc(val)}</option>`;
                    }),
                ].join('');
            };
            const rows = (state.entity_state || []).map((es) => {
                const col = hexFromFontColor(es.fontColor);
                return `
                    <div class="vse-npc-card" style="border-left: 3px solid ${esc(col)};">
                        <div class="vse-npc-head">
                            <span class="vse-dot" style="background:${esc(col)};"></span>
                            <input type="text" class="vse-app-input" data-pop-es="name" value="${esc(es.name)}" placeholder="Character Name" />
                            <select class="vse-app-input" data-pop-es="fontColor">${colorOptions(es.fontColor)}</select>
                            <button type="button" class="vse-app-btn danger vse-btn-sm vse-pop-del-es" title="Remove entity"><i class="fa-solid fa-trash"></i></button>
                        </div>
                        <div class="vse-form-grid">
                            <div class="vse-field-col wide"><label class="vse-field-lbl">Appearance / Look</label><input type="text" class="vse-app-input" data-pop-es="look" value="${esc(es.look)}" /></div>
                            <div class="vse-field-col wide"><label class="vse-field-lbl">Voice &amp; Mannerisms</label><input type="text" class="vse-app-input" data-pop-es="voice" value="${esc(es.voice)}" /></div>
                            <div class="vse-field-col wide"><label class="vse-field-lbl">Public Persona</label><input type="text" class="vse-app-input" data-pop-es="persona" value="${esc(es.persona)}" /></div>
                            <div class="vse-field-col wide"><label class="vse-field-lbl">Private Layer / Secrets</label><input type="text" class="vse-app-input" data-pop-es="private" value="${esc(es.private)}" /></div>
                        </div>
                    </div>
                `;
            }).join('');
            contentHtml = `
                <div class="vse-glass-card">
                    <div class="vse-card-head">
                        <div class="vse-card-title">Entity Profiles &amp; Locked Dialogue Colors</div>
                        <div class="vse-inline-actions">
                            <button type="button" class="vse-app-btn secondary" id="vse_pop_add_es"><i class="fa-solid fa-plus"></i> Add Entity</button>
                            <button type="button" class="vse-app-btn primary" id="vse_pop_save_es"><i class="fa-solid fa-floppy-disk"></i> Save Entities</button>
                        </div>
                    </div>
                    <div class="vse-stack" id="vse_pop_es_list">${rows || '<div class="vse-muted">No entity profiles yet.</div>'}</div>
                </div>
            `;
        } else if (sub === 'onscreen' || sub === 'offscreen') {
            const arr = sub === 'onscreen' ? (state.onscreen || []) : (state.offscreen_agendas || []);
            const jsonKey = sub === 'onscreen' ? 'onscreen' : 'offscreen_agendas';
            const cardsHtml = arr.length
                ? `<div class="vse-cards-grid">${arr.map((e) => {
                    const es = (state.entity_state || []).find((x) => x.name.toLowerCase() === e.name.toLowerCase());
                    const col = hexFromFontColor(es?.fontColor);
                    return `
                        <div class="vse-glass-card vse-compact-card">
                            <div class="vse-npc-title-row">
                                <span class="vse-dot" style="background:${esc(col)};"></span>
                                <strong>${esc(e.name)}</strong>
                                <span class="vse-chip">${esc(e.salience || '')}</span>
                                <span class="vse-chip">${esc(e.tfdy || '')}</span>
                            </div>
                            ${sub === 'onscreen'
                                ? `<div class="vse-kv-line"><span>Emotion:</span> ${esc(e.parrott)}</div>
                                   <div class="vse-kv-line"><span>Residual:</span> ${esc(e.residualMood)}</div>
                                   <div class="vse-kv-line"><span>Agenda:</span> ${esc(e.agenda)}</div>
                                   <div class="vse-kv-line"><span>Why:</span> ${esc(e.why)}</div>
                                   <div class="vse-kv-line"><span>End / Move:</span> ${esc(e.end)} · ${esc(e.move)}</div>`
                                : `<div class="vse-kv-line"><span>Location:</span> ${esc(e.loc)}</div>
                                   <div class="vse-kv-line"><span>Mood:</span> ${esc(e.mood)}</div>
                                   <div class="vse-kv-line"><span>Agenda:</span> ${esc(e.agenda)}</div>
                                   <div class="vse-kv-line"><span>Goal / End:</span> ${esc(e.goal)} (${esc(e.end)})</div>`}
                        </div>
                    `;
                }).join('')}</div>`
                : `<div class="vse-glass-card vse-muted">No ${sub === 'onscreen' ? 'on-screen' : 'off-screen'} NPCs recorded.</div>`;

            contentHtml = `
                ${cardsHtml}
                <details class="vse-glass-card vse-fold-card">
                    <summary class="vse-fold-summary"><i class="fa-solid fa-code"></i> Edit ${esc(jsonKey)} JSON</summary>
                    <div class="vse-fold-body">
                        <textarea id="vse_pop_cast_json" class="vse-app-input vse-mono" rows="10">${esc(JSON.stringify(arr, null, 2))}</textarea>
                        <div class="vse-inline-actions">
                            <span class="vse-err-text" id="vse_pop_cast_err"></span>
                            <button type="button" class="vse-app-btn primary" data-save-cast-key="${esc(jsonKey)}"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
                        </div>
                    </div>
                </details>
            `;
        } else if (sub === 'memories') {
            const list = state.entityMem || [];
            contentHtml = `
                ${list.length
                    ? `<div class="vse-stack">${list.map((em) => `
                        <div class="vse-glass-card vse-compact-card">
                            <div class="vse-npc-title-row"><strong>${esc(em.name)}</strong><span class="vse-chip">${(em.entries || []).length}/20</span></div>
                            <ul class="vse-clean-list">${(em.entries || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
                        </div>
                    `).join('')}</div>`
                    : '<div class="vse-glass-card vse-muted">No entity memories recorded.</div>'}
                <details class="vse-glass-card vse-fold-card">
                    <summary class="vse-fold-summary"><i class="fa-solid fa-code"></i> Edit entityMem JSON</summary>
                    <div class="vse-fold-body">
                        <textarea id="vse_pop_cast_json" class="vse-app-input vse-mono" rows="10">${esc(JSON.stringify(list, null, 2))}</textarea>
                        <div class="vse-inline-actions">
                            <span class="vse-err-text" id="vse_pop_cast_err"></span>
                            <button type="button" class="vse-app-btn primary" data-save-cast-key="entityMem"><i class="fa-solid fa-floppy-disk"></i> Save Memories</button>
                        </div>
                    </div>
                </details>
            `;
        } else {
            const list = state.thoughts || [];
            contentHtml = `
                ${list.length
                    ? `<div class="vse-cards-grid">${list.map((t) => `
                        <div class="vse-glass-card vse-compact-card">
                            <div class="vse-npc-title-row"><strong>${esc(t.name)}</strong></div>
                            <div class="vse-kv-line"><span>Goal:</span> ${esc(t.tQ1)}</div>
                            <div class="vse-kv-line"><span>Feeling:</span> ${esc(t.tQ2)}</div>
                            <div class="vse-kv-line"><span>Mind:</span> ${esc(t.tQ3)}</div>
                            <div class="vse-kv-line"><span>Why:</span> ${esc(t.tQ4)}</div>
                            <div class="vse-kv-line"><span>Unsaid:</span> ${esc(t.tQ5)}</div>
                        </div>
                    `).join('')}</div>`
                    : '<div class="vse-glass-card vse-muted">No inner thoughts captured this turn.</div>'}
                <details class="vse-glass-card vse-fold-card">
                    <summary class="vse-fold-summary"><i class="fa-solid fa-code"></i> Edit thoughts JSON</summary>
                    <div class="vse-fold-body">
                        <textarea id="vse_pop_cast_json" class="vse-app-input vse-mono" rows="10">${esc(JSON.stringify(list, null, 2))}</textarea>
                        <div class="vse-inline-actions">
                            <span class="vse-err-text" id="vse_pop_cast_err"></span>
                            <button type="button" class="vse-app-btn primary" data-save-cast-key="thoughts"><i class="fa-solid fa-floppy-disk"></i> Save Thoughts</button>
                        </div>
                    </div>
                </details>
            `;
        }

        $stage.html(`${renderPageHeader(meta)}${historyBannerHtml(state)}${subBar}${contentHtml}`);

        $stage.find('.vse-subtabs').on('click', 'button', function () {
            subTabs.cast = String($(this).data('sub') || 'onscreen');
            renderActiveTab({ resetScroll: false });
        });

        const collectEntities = () => {
            const rows = [];
            $stage.find('#vse_pop_es_list .vse-npc-card').each(function () {
                const name = String($(this).find('[data-pop-es="name"]').val() ?? '').trim();
                if (!name) return;
                rows.push({
                    name,
                    fontColor: String($(this).find('[data-pop-es="fontColor"]').val() ?? ''),
                    look: String($(this).find('[data-pop-es="look"]').val() ?? ''),
                    voice: String($(this).find('[data-pop-es="voice"]').val() ?? ''),
                    persona: String($(this).find('[data-pop-es="persona"]').val() ?? ''),
                    private: String($(this).find('[data-pop-es="private"]').val() ?? ''),
                });
            });
            return rows;
        };

        $stage.on('click', '.vse-pop-del-es', function () {
            $(this).closest('.vse-npc-card').remove();
        });
        $stage.find('#vse_pop_add_es').on('click', () => {
            const draft = cloneState(state);
            draft.entity_state = collectEntities();
            draft.entity_state.push({ name: 'New NPC', fontColor: '', look: '', voice: '', persona: '', private: '' });
            commitEditedState(draft, 'Added new Entity profile.');
        });
        $stage.find('#vse_pop_save_es').on('click', () => {
            const draft = cloneState(state);
            draft.entity_state = collectEntities();
            commitEditedState(draft, 'Saved Entity profiles.');
        });
        $stage.find('[data-save-cast-key]').on('click', function () {
            const key = String($(this).data('save-cast-key'));
            $('#vse_pop_cast_err').text('');
            try {
                const parsed = JSON.parse(String($stage.find('#vse_pop_cast_json').val() || '[]'));
                const draft = cloneState(state);
                draft[key] = parsed;
                commitEditedState(draft, `Saved ${key}.`);
            } catch (err) {
                $('#vse_pop_cast_err').text(`Invalid JSON: ${err.message}`);
            }
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
            <div class="vse-subtabs">
                <button type="button" class="${sub === 'pair' ? 'on' : ''}" data-sub="pair"><i class="fa-solid fa-heart-pulse"></i> Aether Pairs (${(state.pair || []).length})</button>
                <button type="button" class="${sub === 'dam' ? 'on' : ''}" data-sub="dam"><i class="fa-solid fa-water"></i> Aether Dam (${(state.dam || []).length})</button>
            </div>
        `;
        const cards = sub === 'pair'
            ? `<div class="vse-matrix-theme-host">${renderAetherMatrixList(state.pair || [], prevPairList, { showGuide: true })}</div>`
            : ((state.dam || []).length
                ? `<div class="vse-cards-grid">${state.dam.map((d) => `
                    <div class="vse-glass-card vse-compact-card">
                        <div class="vse-npc-title-row"><strong>${esc(d.pair)}</strong><span class="vse-chip">${esc(d.sluice)}</span></div>
                        <div class="vse-kv-line"><span>Filters:</span> ${esc(d.filters)}</div>
                        <div class="vse-kv-line"><span>Misc:</span> ${esc(d.misc)}</div>
                        <div class="vse-kv-line"><span>Intent:</span> ${esc(d.intent)}</div>
                    </div>
                `).join('')}</div>`
                : '<div class="vse-glass-card vse-muted">No Aether Dam records.</div>');

        const editObj = sub === 'pair' ? (state.pair || []) : (state.dam || []);
        $stage.html(`
            ${renderPageHeader(meta)}
            ${historyBannerHtml(state)}
            ${subBar}
            ${cards}
            <details class="vse-glass-card vse-fold-card">
                <summary class="vse-fold-summary"><i class="fa-solid fa-code"></i> Edit ${esc(sub)} JSON</summary>
                <div class="vse-fold-body">
                    <textarea id="vse_pop_rel_json" class="vse-app-input vse-mono" rows="12">${esc(JSON.stringify(editObj, null, 2))}</textarea>
                    <div class="vse-inline-actions">
                        <span class="vse-err-text" id="vse_pop_rel_err"></span>
                        <button type="button" class="vse-app-btn primary" id="vse_pop_save_rel"><i class="fa-solid fa-floppy-disk"></i> Save Relations</button>
                    </div>
                </div>
            </details>
        `);
        if (sub === 'pair') {
            applyThemeVarsToEl($stage.find('.vse-matrix-theme-host'), getSettings().hudTheme || 'Sola');
        }

        $stage.find('.vse-subtabs').on('click', 'button', function () {
            subTabs.relations = String($(this).data('sub') || 'pair');
            renderActiveTab({ resetScroll: false });
        });
        $stage.find('#vse_pop_save_rel').on('click', () => {
            $('#vse_pop_rel_err').text('');
            try {
                const parsed = JSON.parse(String($stage.find('#vse_pop_rel_json').val() || '[]'));
                const draft = cloneState(state);
                draft[sub] = parsed;
                commitEditedState(draft, `Saved ${sub === 'pair' ? 'Aether Pairs' : 'Aether Dam'}.`);
            } catch (err) {
                $('#vse_pop_rel_err').text(`Invalid JSON: ${err.message}`);
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
            <div class="vse-subtabs">
                ${subList.map((s) => `<button type="button" class="${s.id === sub ? 'on' : ''}" data-sub="${s.id}"><i class="fa-solid ${s.icon}"></i> ${esc(s.label)}</button>`).join('')}
            </div>
        `;

        let bodyHtml = '';
        if (sub === 'chekhov') {
            const ch = state.chekhov || {};
            bodyHtml = `
                <div class="vse-glass-card">
                    <div class="vse-card-head">
                        <div class="vse-card-title">Chekhov's Gun Registry</div>
                        <button type="button" class="vse-app-btn primary" id="vse_pop_save_chekhov"><i class="fa-solid fa-floppy-disk"></i> Save Chekhov</button>
                    </div>
                    <div class="vse-form-grid">
                        <div class="vse-field-col wide"><label class="vse-field-lbl">Chambered (${(ch.chamber || []).length}/20)</label><textarea class="vse-app-input" rows="5" data-pop-ch="chamber">${esc((ch.chamber || []).join('\n'))}</textarea></div>
                        <div class="vse-field-col wide"><label class="vse-field-lbl">Locked (${(ch.locked || []).length}/20)</label><textarea class="vse-app-input" rows="5" data-pop-ch="locked">${esc((ch.locked || []).join('\n'))}</textarea></div>
                        <div class="vse-field-col wide"><label class="vse-field-lbl">Fired This Turn (${(ch.fired || []).length})</label><textarea class="vse-app-input" rows="3" data-pop-ch="fired">${esc((ch.fired || []).join('\n'))}</textarea></div>
                    </div>
                </div>
            `;
        } else if (sub === 'notebook') {
            const nb = state.notebook || [];
            const badgesPreview = nb.length
                ? `<ul class="vse-clean-list">${nb.map((ent) => {
                    const m = ent.match(/^\s*(\[[RTD]\])\s*([\s\S]*)$/);
                    if (!m) return `<li>${esc(ent)}</li>`;
                    const cls = m[1] === '[R]' ? 'rule' : m[1] === '[T]' ? 'thread' : 'debug';
                    return `<li><span class="vse-nb-badge ${cls}">${esc(m[1])}</span> ${esc(m[2])}</li>`;
                }).join('')}</ul>`
                : '<div class="vse-muted">Notebook is empty.</div>';
            bodyHtml = `
                <div class="vse-glass-card">
                    <div class="vse-card-head">
                        <div>
                            <div class="vse-card-title">Pinned Notebook (${nb.length}/20)</div>
                            <div class="vse-card-sub">Prefix entries with [R] (pinned Rule), [T] (Thread), or [D] (Debug/Sim).</div>
                        </div>
                        <button type="button" class="vse-app-btn primary" id="vse_pop_save_nb"><i class="fa-solid fa-floppy-disk"></i> Save Notebook</button>
                    </div>
                    <div class="vse-inline-actions" style="justify-content:stretch;">
                        <input type="text" id="vse_pop_new_rule" class="vse-app-input" placeholder="Quick-add [R] rule (e.g. [R] Keep prose grounded)" />
                        <button type="button" class="vse-app-btn secondary" id="vse_pop_add_rule"><i class="fa-solid fa-plus"></i> Add [R]</button>
                    </div>
                    <textarea id="vse_pop_nb_txt" class="vse-app-input" rows="9">${esc(nb.join('\n'))}</textarea>
                    ${badgesPreview}
                </div>
            `;
        } else if (sub === 'tracks') {
            const tr = state.tracks || {};
            const a = state.arc || {};
            bodyHtml = `
                <div class="vse-glass-card vse-compact-card">
                    <div class="vse-card-title">Active Tracks</div>
                    <div class="vse-kv-line"><span>Main:</span> ${esc(tr.main || '∅')}</div>
                    ${(tr.tracks || []).map((x) => `<div class="vse-kv-line"><span>Track:</span> ${esc(x)}</div>`).join('')}
                    ${(tr.history || []).length ? `<ul class="vse-clean-list">${tr.history.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
                </div>
                <div class="vse-glass-card vse-compact-card">
                    <div class="vse-card-title">ARC (Kishōtenketsu)</div>
                    ${isEmptySentinel(a.info) && !a.ki?.length
                        ? '<div class="vse-muted">ARC Engine in Ki phase (no active ARC generated yet).</div>'
                        : `<div class="vse-kv-line"><span>Info:</span> ${esc(a.info)}</div>
                           <div class="vse-kv-line"><span>Timeline:</span> ${esc(a.timeline)}</div>
                           ${['ki', 'sho', 'ten', 'ketsu'].map((act) => `<div class="vse-kv-line"><span>${act.toUpperCase()}:</span> ${(a[act] || ['∅']).map(esc).join(' · ')}</div>`).join('')}`}
                </div>
                <details class="vse-glass-card vse-fold-card">
                    <summary class="vse-fold-summary"><i class="fa-solid fa-code"></i> Edit Tracks &amp; ARC JSON</summary>
                    <div class="vse-fold-body">
                        <textarea id="vse_pop_ta_json" class="vse-app-input vse-mono" rows="12">${esc(JSON.stringify({ tracks: tr, arc: a }, null, 2))}</textarea>
                        <div class="vse-inline-actions">
                            <span class="vse-err-text" id="vse_pop_ta_err"></span>
                            <button type="button" class="vse-app-btn primary" id="vse_pop_save_ta"><i class="fa-solid fa-floppy-disk"></i> Save Tracks &amp; ARC</button>
                        </div>
                    </div>
                </details>
            `;
        } else if (sub === 'inv') {
            const inv = state.inv || {};
            const sn = state.story_notes || {};
            bodyHtml = `
                <div class="vse-glass-card">
                    <div class="vse-card-head">
                        <div class="vse-card-title">Inventory, Story Notes &amp; Vent</div>
                        <button type="button" class="vse-app-btn primary" id="vse_pop_save_inv"><i class="fa-solid fa-floppy-disk"></i> Save Inv &amp; Notes</button>
                    </div>
                    <div class="vse-form-grid">
                        <div class="vse-field-col wide"><label class="vse-field-lbl">Inventory</label><textarea class="vse-app-input" rows="2" data-pop-inv="inv">${esc(inv.inv)}</textarea></div>
                        <div class="vse-field-col wide"><label class="vse-field-lbl">Titles &amp; Modifiers</label><input type="text" class="vse-app-input" data-pop-inv="titles" value="${esc(inv.titles)}" /></div>
                        <div class="vse-field-col wide"><label class="vse-field-lbl">Status &amp; Conditions</label><textarea class="vse-app-input" rows="2" data-pop-inv="status">${esc(inv.status)}</textarea></div>
                        <div class="vse-field-col wide"><label class="vse-field-lbl">Threads</label><textarea class="vse-app-input" rows="2" data-pop-sn="threads">${esc(sn.threads)}</textarea></div>
                        <div class="vse-field-col wide"><label class="vse-field-lbl">Seeds</label><textarea class="vse-app-input" rows="2" data-pop-sn="seeds">${esc(sn.seeds)}</textarea></div>
                        <div class="vse-field-col wide"><label class="vse-field-lbl">Motives</label><textarea class="vse-app-input" rows="2" data-pop-sn="motives">${esc(sn.motives)}</textarea></div>
                        <div class="vse-field-col wide"><label class="vse-field-lbl">Horizon</label><textarea class="vse-app-input" rows="2" data-pop-sn="horizon">${esc(sn.horizon)}</textarea></div>
                        <div class="vse-field-col wide"><label class="vse-field-lbl">GremlinNote</label><textarea class="vse-app-input" rows="2" data-pop-sn="GremlinNote">${esc(sn.GremlinNote)}</textarea></div>
                        <div class="vse-field-col wide"><label class="vse-field-lbl">Heckle</label><textarea class="vse-app-input" rows="2" data-pop-sn="heckle">${esc(sn.heckle)}</textarea></div>
                        <div class="vse-field-col wide"><label class="vse-field-lbl">Vent</label><textarea class="vse-app-input" rows="2" data-pop-vent="1">${esc(state.vent)}</textarea></div>
                    </div>
                </div>
            `;
        } else if (sub === 'vent') {
            bodyHtml = `
                <div class="vse-glass-card">
                    <div class="vse-card-title">Main Model Vent (&lt;state:vent&gt;)</div>
                    <div class="vse-vent-text">${esc(state.vent || '∅')}</div>
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
                <div class="vse-glass-card">
                    <div class="vse-card-title">Last CoT Receipt (&lt;vexa_receipt&gt;)</div>
                    ${kvRows ? `<div class="vse-kv-grid vse-receipt-kv" style="margin-bottom:8px;">${kvRows}</div>` : ''}
                    ${rc?.raw ? `<pre class="vse-pre">${esc(rc.raw)}</pre>` : '<div class="vse-muted">No receipt recorded for this turn.</div>'}
                </div>
            `;
        }

        $stage.html(`${renderPageHeader(meta)}${historyBannerHtml(state)}${subBar}${bodyHtml}`);

        $stage.find('.vse-subtabs').on('click', 'button', function () {
            subTabs.narrative = String($(this).data('sub') || 'chekhov');
            renderActiveTab({ resetScroll: false });
        });
        $stage.find('#vse_pop_save_chekhov').on('click', () => {
            const draft = cloneState(state);
            for (const b of ['chamber', 'locked', 'fired']) {
                const raw = String($stage.find(`[data-pop-ch="${b}"]`).val() ?? '');
                draft.chekhov[b] = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l !== '∅');
            }
            commitEditedState(draft, 'Saved Chekhov registry.');
        });
        $stage.find('#vse_pop_add_rule').on('click', () => {
            const val = String($stage.find('#vse_pop_new_rule').val() || '').trim();
            if (!val) return;
            const formatted = /^\s*\[[RTD]\]/i.test(val) ? val : `[R] ${val}`;
            const cur = String($stage.find('#vse_pop_nb_txt').val() || '').trim();
            $stage.find('#vse_pop_nb_txt').val(cur ? `${formatted}\n${cur}` : formatted);
            $stage.find('#vse_pop_new_rule').val('');
        });
        $stage.find('#vse_pop_save_nb').on('click', () => {
            const raw = String($stage.find('#vse_pop_nb_txt').val() ?? '');
            const draft = cloneState(state);
            draft.notebook = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 20);
            commitEditedState(draft, 'Saved Notebook entries.');
        });
        $stage.find('#vse_pop_save_ta').on('click', () => {
            $('#vse_pop_ta_err').text('');
            try {
                const parsed = JSON.parse(String($stage.find('#vse_pop_ta_json').val() || '{}'));
                const draft = cloneState(state);
                if (parsed.tracks) draft.tracks = parsed.tracks;
                if (parsed.arc) draft.arc = parsed.arc;
                commitEditedState(draft, 'Saved Tracks & ARC.');
            } catch (err) {
                $('#vse_pop_ta_err').text(`Invalid JSON: ${err.message}`);
            }
        });
        $stage.find('#vse_pop_save_inv').on('click', () => {
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
                badgeHtml: `<span class="vse-head-badge ${mode === 'profile' ? 'ok' : ''}">${mode === 'direct' ? 'Direct OpenAI-Compatible' : 'ST Connection Profile'}</span>`,
            })}
            <div class="vse-glass-card">
                <div class="vse-card-title">Worker Transport</div>
                ${renderTiles('transport', [
                    { id: 'direct', label: 'Direct OpenAI-Compatible', desc: 'Uses Base URL + API Key + Model via ST reverse-proxy (zero profile switching).' },
                    { id: 'profile', label: 'ST Connection Profile', desc: 'Dispatches via SillyTavern ConnectionManagerRequestService without switching.' },
                ], mode)}
                <div class="vse-banner">
                    <i class="fa-solid fa-shield-halved"></i>
                    <span>Vexa Clerk runs without a heavy jailbreak. Use an uncensored or low-refusal fast model (e.g. <b>GLM 5.3 Flash</b> or <b>DeepSeek 4.1 Flash</b>) to avoid safety refusals on mature roleplay turns.</span>
                </div>
            </div>

            <div class="vse-glass-card" id="vse_pop_direct_card" style="display:${mode === 'direct' ? 'flex' : 'none'};">
                <div class="vse-card-title">Direct Endpoint Credentials</div>
                <div class="vse-form-grid">
                    <div class="vse-field-col wide">
                        <label class="vse-field-lbl">Base URL <small>(e.g. https://api.openai.com/v1)</small></label>
                        <input id="vse_pop_w_url" type="text" class="vse-app-input" value="${esc(settings.workerBaseUrl || '')}" placeholder="https://api.openai.com/v1" />
                    </div>
                    <div class="vse-field-col wide">
                        <label class="vse-field-lbl">API Key</label>
                        <div class="vse-inline-actions" style="justify-content:stretch;">
                            <input id="vse_pop_w_key" type="${apiKeyVisible ? 'text' : 'password'}" class="vse-app-input" autocomplete="off" value="${esc(settings.workerApiKey || '')}" placeholder="sk-..." />
                            <button id="vse_pop_w_eye" type="button" class="vse-app-btn secondary" title="Show/Hide Key"><i class="fa-solid fa-${apiKeyVisible ? 'eye-slash' : 'eye'}"></i></button>
                        </div>
                    </div>
                    <div class="vse-field-col wide">
                        <label class="vse-field-lbl">Model ID</label>
                        <div class="vse-inline-actions" style="justify-content:stretch;">
                            <input id="vse_pop_w_model" type="text" class="vse-app-input" value="${esc(settings.workerModel || '')}" placeholder="deepseek-v4.1-flash / glm-5.3-flash" />
                            <button id="vse_pop_fetch_models" type="button" class="vse-app-btn secondary"><i class="fa-solid fa-cloud-arrow-down"></i> Fetch Models</button>
                        </div>
                        <select id="vse_pop_fetched_models" class="vse-app-input" style="display:${fetchedModels.length ? 'block' : 'none'};margin-top:6px;">
                            <option value="">-- Pick fetched model (${fetchedModels.length}) --</option>
                            ${fetchedModels.map((m) => `<option value="${esc(m)}" ${m === settings.workerModel ? 'selected' : ''}>${esc(m)}</option>`).join('')}
                        </select>
                    </div>
                </div>
            </div>

            <div class="vse-glass-card" id="vse_pop_profile_card" style="display:${mode === 'profile' ? 'flex' : 'none'};">
                <div class="vse-card-title">SillyTavern Connection Profile</div>
                <div class="vse-inline-actions" style="justify-content:stretch;">
                    <select id="vse_pop_w_profile" class="vse-app-input">
                        <option value="">-- Select Chat Completion Profile --</option>
                        ${profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === settings.workerProfileId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                    </select>
                    <button id="vse_pop_refresh_profiles" type="button" class="vse-app-btn secondary"><i class="fa-solid fa-rotate"></i> Refresh</button>
                </div>
            </div>

            <div class="vse-glass-card">
                <div class="vse-card-title">Call Mode &amp; Generation Parameters</div>
                ${renderTiles('workermode', [
                    { id: 'combined', label: 'Combined (1 call / turn)', desc: 'Sends one delta-extraction request for all state sections per turn.' },
                    { id: 'split', label: 'Split (2 calls / turn)', desc: 'Splits spatial/entities and narrative/thoughts across 2 smaller calls.' },
                ], settings.workerMode || 'combined')}
                <div class="vse-form-grid">
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Max Tokens</label>
                        <input id="vse_pop_w_tokens" type="number" min="512" max="32768" step="256" class="vse-app-input" value="${esc(settings.workerMaxTokens || 8192)}" />
                    </div>
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Temperature</label>
                        <input id="vse_pop_w_temp" type="number" min="0" max="2" step="0.05" class="vse-app-input" value="${esc(settings.workerTemperature ?? 0.25)}" />
                    </div>
                </div>
                <div class="vse-inline-actions" style="justify-content:flex-start;">
                    <button id="vse_pop_test_worker" type="button" class="vse-app-btn gold"><i class="fa-solid fa-vial"></i> Test Worker Connection</button>
                </div>
                <div id="vse_pop_test_result">
                    ${workerTestResult ? `<div class="vse-banner ${workerTestResult.ok ? 'ok' : 'red'}"><i class="fa-solid ${workerTestResult.ok ? 'fa-circle-check' : 'fa-circle-xmark'}"></i><span>${esc(workerTestResult.text)}</span></div>` : ''}
                </div>
            </div>
        `);

        $stage.find('[data-tile-group="transport"]').on('click', '.vse-tile', function () {
            const val = String($(this).data('tile-val') || 'direct');
            getSettings().workerTransport = val;
            notifySettingsChanged();
            renderWorkerTab($stage, getSettings());
        });
        $stage.find('[data-tile-group="workermode"]').on('click', '.vse-tile', function () {
            const val = String($(this).data('tile-val') || 'combined');
            getSettings().workerMode = val;
            $(this).siblings().removeClass('on');
            $(this).addClass('on');
            notifySettingsChanged();
        });
        $stage.find('#vse_pop_w_url').on('input change', function () { getSettings().workerBaseUrl = String($(this).val() ?? '').trim(); notifySettingsChanged(); });
        $stage.find('#vse_pop_w_key').on('input change', function () { getSettings().workerApiKey = String($(this).val() ?? '').trim(); notifySettingsChanged(); });
        $stage.find('#vse_pop_w_eye').on('click', () => { apiKeyVisible = !apiKeyVisible; renderWorkerTab($stage, getSettings()); });
        $stage.find('#vse_pop_w_model').on('input change', function () { getSettings().workerModel = String($(this).val() ?? '').trim(); notifySettingsChanged(); });
        $stage.find('#vse_pop_fetched_models').on('change', function () {
            const v = String($(this).val() || '');
            if (v) {
                getSettings().workerModel = v;
                $stage.find('#vse_pop_w_model').val(v);
                notifySettingsChanged();
            }
        });
        $stage.find('#vse_pop_w_profile').on('change', function () { getSettings().workerProfileId = String($(this).val() ?? ''); notifySettingsChanged(); });
        $stage.find('#vse_pop_refresh_profiles').on('click', () => renderWorkerTab($stage, getSettings()));
        $stage.find('#vse_pop_w_tokens').on('change', function () { getSettings().workerMaxTokens = Math.max(256, parseInt($(this).val(), 10) || 8192); notifySettingsChanged(); });
        $stage.find('#vse_pop_w_temp').on('change', function () { getSettings().workerTemperature = Number($(this).val()) || 0.25; notifySettingsChanged(); });

        $stage.find('#vse_pop_fetch_models').on('click', async function () {
            const $btn = $(this);
            $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Fetching...');
            try {
                const sNow = getSettings();
                fetchedModels = await fetchModelsList({ baseUrl: sNow.workerBaseUrl, apiKey: sNow.workerApiKey, ctx: getContextSafe() });
                workerTestResult = { ok: true, text: `Loaded ${fetchedModels.length} models.` };
            } catch (err) {
                workerTestResult = { ok: false, text: extractErrorMessage(err) };
            } finally {
                if (isOpen() && activeTab === 'worker') renderWorkerTab($stage, getSettings());
            }
        });

        $stage.find('#vse_pop_test_worker').on('click', async function () {
            const $btn = $(this);
            $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Testing...');
            try {
                const ans = await workerClient.testConnection();
                workerTestResult = { ok: true, text: `Connected cleanly: ${ans.slice(0, 80) || 'OK'}` };
            } catch (err) {
                workerTestResult = { ok: false, text: `Connection failed: ${extractErrorMessage(err)}` };
            } finally {
                if (isOpen() && activeTab === 'worker') renderWorkerTab($stage, getSettings());
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
                badgeHtml: `<span class="vse-head-badge ${enabled ? 'ok' : ''}">${enabled ? 'ACTIVE GUARD' : 'DISABLED'}</span>`,
            })}
            <div class="vse-glass-card">
                ${renderSwitchRow({
                    id: 'vse_pop_retry_enabled',
                    icon: 'fa-shield-halved',
                    color: '#10b981',
                    label: 'Enable built-in Refusal Auto-Retry &amp; End-Marker Guard',
                    desc: 'Intercepts refusals and truncated state tails before the worker processes them. Automatically supersedes standalone ST-VexaRefusalAutoRetry when on.',
                    on: enabled,
                })}
            </div>
            <div class="vse-stack" id="vse_pop_retry_details" style="display:${enabled ? 'flex' : 'none'};">
                <div class="vse-glass-card">
                    <div class="vse-card-title">Validation Mode &amp; End Marker</div>
                    ${renderTiles('formatmode', [
                        { id: 'auto', label: 'Auto-Detect', desc: 'Checks either <vexa_tail> or <internal_states> plus trailing GFX_END.' },
                        { id: 'external', label: 'External State', desc: 'Requires <vexa_tail> closed cleanly and ending in GFX_END.' },
                        { id: 'classic', label: 'Classic XML', desc: 'Requires <internal_states> closed cleanly and ending in GFX_END.' },
                        { id: 'marker', label: 'Marker Only', desc: 'Validates only the trailing end marker.' },
                    ], r.formatMode || 'auto')}
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Required End Marker</label>
                        <input id="vse_pop_retry_marker" type="text" class="vse-app-input" value="${esc(r.endMarker || DEFAULT_END_MARKER)}" />
                    </div>
                </div>

                <div class="vse-glass-card">
                    <div class="vse-card-title">Behavior &amp; Limits</div>
                    ${renderSwitchRow({
                        id: 'vse_pop_retry_nsc',
                        icon: 'fa-forward',
                        color: '#38bdf8',
                        label: 'Show “Continue (No Stream)” Send-Bar Button &amp; Options Item',
                        desc: 'Temporarily holds streaming OFF during Continue so truncation / refusals complete cleanly.',
                        on: r.showNonStreamContinue !== false,
                    })}
                    ${renderSwitchRow({
                        id: 'vse_pop_retry_req_end',
                        icon: 'fa-flag-checkered',
                        color: '#f59e0b',
                        label: 'Require Reply to End With End Marker',
                        desc: 'Triggers non-stream regenerate when a reply truncates before closing GFX_END.',
                        on: r.requireEndMarker !== false,
                    })}
                    ${renderSwitchRow({
                        id: 'vse_pop_retry_toasts',
                        icon: 'fa-bell',
                        color: '#a855f7',
                        label: 'Show Toast Notification on Each Retry',
                        desc: 'Displays a concise status toast when regenerating a refusal or truncated reply.',
                        on: r.showStatusToasts !== false,
                    })}
                    ${renderSwitchRow({
                        id: 'vse_pop_retry_modal',
                        icon: 'fa-triangle-exclamation',
                        color: '#ef4444',
                        label: 'Show Modal Popup on Max Failures',
                        desc: 'Alerts if max consecutive incomplete or refusal retries are reached.',
                        on: r.useModalPopup !== false,
                    })}
                    <div class="vse-form-grid">
                        <div class="vse-field-col"><label class="vse-field-lbl">Max Incomplete Retries</label><input id="vse_pop_retry_max_inc" type="number" min="0" max="20" step="1" class="vse-app-input" value="${esc(r.maxIncompleteRetries ?? 3)}" /></div>
                        <div class="vse-field-col"><label class="vse-field-lbl">Max Refusal Retries (0=∞)</label><input id="vse_pop_retry_max_ref" type="number" min="0" max="50" step="1" class="vse-app-input" value="${esc(r.maxRefusalRetries ?? 0)}" /></div>
                        <div class="vse-field-col"><label class="vse-field-lbl">Retry Delay (ms)</label><input id="vse_pop_retry_delay" type="number" min="0" max="10000" step="50" class="vse-app-input" value="${esc(r.retryDelayMs ?? 300)}" /></div>
                    </div>
                </div>

                <div class="vse-glass-card">
                    <div class="vse-card-head">
                        <div>
                            <div class="vse-card-title">Custom Refusal Patterns &amp; Manual Cleanup</div>
                            <div class="vse-card-sub">One phrase or /regex/i pattern per line.</div>
                        </div>
                        <button type="button" id="vse_pop_clean_last" class="vse-app-btn secondary"><i class="fa-solid fa-broom"></i> Clean Refusal From Last Reply</button>
                    </div>
                    <textarea id="vse_pop_retry_patterns" class="vse-app-input vse-mono" rows="4" placeholder="I am Gemini Enterprise&#10;/cannot participate in .* roleplay/i">${esc(r.customPatterns || '')}</textarea>
                </div>
            </div>
        `);

        const ensureRetryCfg = () => {
            const st = getSettings();
            if (!st.retry || typeof st.retry !== 'object') st.retry = {};
            return st.retry;
        };

        $stage.find('#vse_pop_retry_enabled').on('click', () => {
            const cfg = ensureRetryCfg();
            cfg.enabled = !(cfg.enabled !== false);
            notifySettingsChanged({ retryChanged: true });
            renderRetryTab($stage, getSettings());
        });
        $stage.find('[data-tile-group="formatmode"]').on('click', '.vse-tile', function () {
            ensureRetryCfg().formatMode = String($(this).data('tile-val') || 'auto');
            $(this).siblings().removeClass('on');
            $(this).addClass('on');
            notifySettingsChanged();
        });
        $stage.find('#vse_pop_retry_marker').on('input change', function () {
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
        wireRetrySwitch('#vse_pop_retry_nsc', 'showNonStreamContinue', true);
        wireRetrySwitch('#vse_pop_retry_req_end', 'requireEndMarker');
        wireRetrySwitch('#vse_pop_retry_toasts', 'showStatusToasts');
        wireRetrySwitch('#vse_pop_retry_modal', 'useModalPopup');

        $stage.find('#vse_pop_retry_max_inc').on('input change', function () {
            const v = parseInt(String($(this).val()), 10);
            if (!Number.isNaN(v) && v >= 0 && v <= 20) { ensureRetryCfg().maxIncompleteRetries = v; notifySettingsChanged(); }
        });
        $stage.find('#vse_pop_retry_max_ref').on('input change', function () {
            const v = parseInt(String($(this).val()), 10);
            if (!Number.isNaN(v) && v >= 0 && v <= 50) { ensureRetryCfg().maxRefusalRetries = v; notifySettingsChanged(); }
        });
        $stage.find('#vse_pop_retry_delay').on('input change', function () {
            const v = parseInt(String($(this).val()), 10);
            if (!Number.isNaN(v) && v >= 0 && v <= 10000) { ensureRetryCfg().retryDelayMs = v; notifySettingsChanged(); }
        });
        $stage.find('#vse_pop_retry_patterns').on('input change', function () {
            ensureRetryCfg().customPatterns = String($(this).val() ?? '');
            notifySettingsChanged();
        });
        $stage.find('#vse_pop_clean_last').on('click', () => onCleanLastRefusal?.());
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
            ? `<div class="vse-glass-card">
                <div class="vse-card-head">
                    <div>
                        <div class="vse-card-title">Pending Main-Model Tracker Proposals (${proposals.length})</div>
                        <div class="vse-card-sub">Edit keys/values below if desired, then click Approve to lock the schema for Vexa Clerk to maintain.</div>
                    </div>
                </div>
                <div class="vse-stack">
                    ${proposals.map((p) => `
                        <div class="vse-npc-card" data-prop-card="${esc(p.id)}" style="border-left: 3px solid #f59e0b;">
                            <div class="vse-npc-head">
                                <span class="vse-chip" style="border-color:rgba(245,158,11,.5);color:#fbbf24;">Proposed · ct:${esc(p.turnCt ?? 0)}</span>
                                <input type="text" class="vse-app-input" data-prop-input="title" value="${esc(p.title)}" placeholder="Tracker Title" />
                                <button type="button" class="vse-app-btn primary vse-btn-sm vse-pop-approve-prop" data-prop-id="${esc(p.id)}"><i class="fa-solid fa-check"></i> Approve</button>
                                <button type="button" class="vse-app-btn danger vse-btn-sm vse-pop-dismiss-prop" data-prop-id="${esc(p.id)}"><i class="fa-solid fa-xmark"></i> Dismiss</button>
                            </div>
                            ${p.reason ? `<div class="vse-kv-line"><span>Reason:</span> ${esc(p.reason)}</div>` : ''}
                            <div class="vse-field-col wide">
                                <label class="vse-field-lbl">Locked Fields <small>(one <code>key=value</code> per line, max 8)</small></label>
                                <textarea class="vse-app-input vse-mono" rows="3" data-prop-input="fields">${esc(fieldsToLines(p.fields))}</textarea>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>`
            : '';

        const trackersRows = activeTrackers.map((t) => `
            <div class="vse-npc-card" data-ct-id="${esc(t.id)}">
                <div class="vse-npc-head">
                    <span class="vse-chip">${esc(t.id)}</span>
                    <input type="text" class="vse-app-input" data-ct-field="title" value="${esc(t.title)}" placeholder="Tracker Title" />
                    <button type="button" class="vse-app-btn danger vse-btn-sm vse-pop-del-ct" title="Remove tracker"><i class="fa-solid fa-trash"></i></button>
                </div>
                <div class="vse-field-col wide">
                    <label class="vse-field-lbl">Fields <small>(one <code>key=value</code> per line; Vexa Clerk updates values of these keys)</small></label>
                    <textarea class="vse-app-input vse-mono" rows="4" data-ct-field="fields">${esc(fieldsToLines(t.fields))}</textarea>
                </div>
                <div class="vse-field-col wide">
                    <label class="vse-field-lbl">Notes</label>
                    <input type="text" class="vse-app-input" data-ct-field="notes" value="${esc(t.notes || '')}" placeholder="Optional note or deadline" />
                </div>
            </div>
        `).join('');

        $stage.html(`
            ${renderPageHeader({ ...meta, badgeHtml: `<span class="vse-head-badge ${activeTrackers.length ? 'ok' : ''}">${activeTrackers.length} ACTIVE${proposals.length ? ` · ${proposals.length} PENDING` : ''}</span>` })}
            ${historyBannerHtml(state)}
            <div class="vse-glass-card">
                <div class="vse-card-title">Auto-Generate Tracker Settings</div>
                ${renderSwitchRow({
                    id: 'vse_pop_ct_allow',
                    icon: 'fa-wand-magic-sparkles',
                    color: '#f59e0b',
                    label: 'Allow Main Model to Propose Custom Trackers',
                    desc: 'Permits the story model to propose new recurring trackers (businesses, estates, ships, ledgers) via <vexa_receipt>. Off = zero prompt rule tokens.',
                    on: allowProposals,
                })}
                <div id="vse_pop_ct_auto_wrap" style="display:${allowProposals ? 'block' : 'none'};">
                    ${renderSwitchRow({
                        id: 'vse_pop_ct_auto',
                        icon: 'fa-bolt',
                        color: '#10b981',
                        label: 'Auto-Accept Proposed Trackers (Skip Manual Approval)',
                        desc: 'Automatically activates main-model proposals (up to 6 active trackers) instead of queuing them for approval.',
                        on: autoAccept,
                    })}
                </div>
            </div>
            ${proposalsHtml}
            <div class="vse-glass-card">
                <div class="vse-card-head">
                    <div>
                        <div class="vse-card-title">Active Custom Trackers (${activeTrackers.length}/6)</div>
                        <div class="vse-card-sub">Only active trackers appear in &lt;state:custom_trackers&gt; and receive updates from Vexa Clerk.</div>
                    </div>
                    <div class="vse-inline-actions">
                        <button type="button" class="vse-app-btn secondary vse-btn-sm" data-tracker-tpl="business">+ Business</button>
                        <button type="button" class="vse-app-btn secondary vse-btn-sm" data-tracker-tpl="estate">+ Estate</button>
                        <button type="button" class="vse-app-btn secondary vse-btn-sm" data-tracker-tpl="ship">+ Ship</button>
                        <button type="button" class="vse-app-btn secondary" id="vse_pop_add_ct"><i class="fa-solid fa-plus"></i> Blank</button>
                        <button type="button" class="vse-app-btn primary" id="vse_pop_save_ct"><i class="fa-solid fa-floppy-disk"></i> Save Trackers</button>
                    </div>
                </div>
                <div class="vse-stack" id="vse_pop_ct_list">
                    ${trackersRows || '<div class="vse-muted">No active custom trackers yet. Add one above or wait for the main model to propose one in play.</div>'}
                </div>
                ${dismissed.length ? `<div class="vse-inline-actions" style="justify-content:space-between;margin-top:4px;">
                    <span class="vse-card-sub">${dismissed.length} dismissed proposal ID(s) suppressed (${esc(dismissed.join(', '))})</span>
                    <button type="button" class="vse-app-btn secondary vse-btn-sm" id="vse_pop_clear_dismissed">Clear Dismissed List</button>
                </div>` : ''}
            </div>
        `);

        $stage.find('#vse_pop_ct_allow').on('click', function () {
            const s = getSettings();
            const next = !(s.allowTrackerProposals !== false);
            s.allowTrackerProposals = next;
            $(this).toggleClass('active', next).attr('aria-checked', String(next));
            $stage.find('#vse_pop_ct_auto_wrap').toggle(next);
            notifySettingsChanged();
        });
        $stage.find('#vse_pop_ct_auto').on('click', function () {
            const s = getSettings();
            const next = !Boolean(s.autoAcceptTrackerProposals);
            s.autoAcceptTrackerProposals = next;
            $(this).toggleClass('active', next).attr('aria-checked', String(next));
            notifySettingsChanged();
        });

        const collectActive = () => {
            const list = [];
            $stage.find('#vse_pop_ct_list .vse-npc-card').each(function () {
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

        $stage.find('.vse-pop-approve-prop').on('click', function () {
            const propId = String($(this).data('prop-id') || '');
            const $card = $(this).closest('.vse-npc-card');
            const title = String($card.find('[data-prop-input="title"]').val() ?? '').trim();
            const fields = linesToFields($card.find('[data-prop-input="fields"]').val());
            const nextState = approveTrackerProposal(state, propId, title ? { id: slugifyTrackerId(title), title, fields } : null);
            commitEditedState(nextState, `Approved custom tracker "${title || propId}".`);
        });
        $stage.find('.vse-pop-dismiss-prop').on('click', function () {
            const propId = String($(this).data('prop-id') || '');
            const nextState = dismissTrackerProposal(state, propId);
            commitEditedState(nextState, 'Dismissed tracker proposal.');
        });
        $stage.on('click', '.vse-pop-del-ct', function () {
            $(this).closest('.vse-npc-card').remove();
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
        $stage.find('#vse_pop_add_ct').on('click', () => addTemplate('blank'));
        $stage.find('[data-tracker-tpl]').on('click', function () { addTemplate(String($(this).data('tracker-tpl'))); });
        $stage.find('#vse_pop_save_ct').on('click', () => {
            const draft = cloneState(state);
            draft.custom_trackers = collectActive();
            commitEditedState(draft, 'Saved Custom Trackers.');
        });
        $stage.find('#vse_pop_clear_dismissed').on('click', () => {
            const draft = cloneState(state);
            draft.dismissed_proposals = [];
            commitEditedState(draft, 'Cleared dismissed proposals list.');
        });
    }

    function renderAppearanceTab($stage, settings) {
        const meta = tabMeta('appearance');
        const activeTheme = settings.hudTheme || 'Sola';
        const activeStyle = settings.hudStyle || 'Afterglow';

        const themeCards = Object.entries(VEXA_THEMES).map(([name, t]) => `
            <button type="button" class="vse-theme-card ${name === activeTheme ? 'on' : ''}" data-theme-name="${esc(name)}" data-scheme="${esc(t.scheme)}" style="background:${esc(t.base)};color:${esc(t.text)};border-color:${name === activeTheme ? '#f59e0b' : esc(t.border)};">
                <span class="vse-theme-head">
                    <span class="vse-theme-name">${esc(name)}</span>
                    ${name === activeTheme ? '<i class="fa-solid fa-check vse-theme-check" aria-hidden="true"></i>' : ''}
                </span>
                <span class="vse-theme-swatches">
                    <i style="background:${esc(t.blue)}"></i>
                    <i style="background:${esc(t.green)}"></i>
                    <i style="background:${esc(t.yellow)}"></i>
                    <i style="background:${esc(t.red)}"></i>
                </span>
            </button>
        `).join('');

        const styleTilesHtml = `
            <div class="vse-tiles vse-style-tiles" data-tile-group="hudstyle">
                ${VEXA_STYLES.map((st) => `
                    <button type="button" class="vse-tile ${st === activeStyle ? 'on' : ''}" data-tile-val="${esc(st)}">
                        <span class="vse-style-preview" data-vse-style="${esc(st)}" aria-hidden="true">
                            <span class="vse-sp-bar"><i></i></span>
                            <span class="vse-sp-lines"><i></i><i></i></span>
                        </span>
                        <span class="vse-style-tile-head">
                            <b>${esc(st)}</b>
                            ${st === activeStyle ? '<i class="fa-solid fa-check vse-theme-check" aria-hidden="true"></i>' : ''}
                        </span>
                    </button>
                `).join('')}
            </div>
        `;

        $stage.html(`
            ${renderPageHeader(meta)}
            <div class="vse-glass-card">
                <div class="vse-inline-actions" style="justify-content:space-between;margin-bottom:10px;">
                    <div class="vse-card-title" style="margin-bottom:0;">HUD Color Theme (${esc(activeTheme)})</div>
                    <button type="button" class="vse-app-btn gold vse-btn-sm" id="vse_pop_align_hud_themes" title="Apply active theme and style to every rendered HUD card in this chat without rebuilding">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Align All Chat HUDs to Current Theme
                    </button>
                </div>
                <div class="vse-theme-grid" id="vse_pop_theme_grid">${themeCards}</div>
            </div>

            <div class="vse-glass-card">
                <div class="vse-card-title">HUD Card Style</div>
                ${styleTilesHtml}
            </div>

            <div class="vse-glass-card">
                <div class="vse-card-title">Default Atlas Renderer (Control Center)</div>
                ${renderTiles('atlasmode', [
                    { id: 'webgl', label: '3D WebGL (Hybrid + Textured Kits)', desc: 'Hardware Three.js rooms with doorway cutouts + CC BY 4.0 GLB kits' },
                    { id: '3d', label: '3D CSS (PolyCSS)', desc: `Software CSS matrix3d diorama rooms & ${POLY_PREFABS.length} prefabs` },
                    { id: '2d', label: '2D SVG Floorplan', desc: 'Lightweight schematic blueprint (always used inline in chat)' },
                ], settings.atlasViewMode || 'webgl')}
            </div>

            <div class="vse-glass-card">
                <div class="vse-card-title">Default Body Silhouette (Health Doll)</div>
                ${renderTiles('bodytype', [
                    { id: 'male', label: 'Male', desc: 'Standard masculine proportions' },
                    { id: 'female', label: 'Female', desc: 'Feminine proportions' },
                    { id: 'athletic', label: 'Athletic', desc: 'Broad-shouldered lean build' },
                    { id: 'heavy', label: 'Heavy', desc: 'Stocky, burly build' },
                ], settings.defaultBodyType || 'male')}
            </div>

            <div class="vse-glass-card">
                <div class="vse-card-title">Engine &amp; UI Rules</div>
                ${renderSwitchRow({
                    id: 'vse_pop_show_launcher',
                    icon: 'fa-compass',
                    color: '#f59e0b',
                    label: 'Show Floating Launcher Button',
                    desc: 'Displays the draggable compass button for quick access to this Control Center.',
                    on: settings.showLauncherButton !== false,
                })}
                ${renderSwitchRow({
                    id: 'vse_pop_hud_collapsed',
                    icon: 'fa-compress',
                    color: '#38bdf8',
                    label: 'Collapse Per-Message HUD Cards by Default',
                    desc: 'Keeps chat clean with a compact bar under each AI message until clicked.',
                    on: settings.hudDefaultCollapsed !== false,
                })}
                ${renderSwitchRow({
                    id: 'vse_pop_show_inline_changes',
                    icon: 'fa-code-compare',
                    color: '#fbbf24',
                    label: 'Show Inline “Changed in this reply” Diff Strip',
                    desc: 'Shows compact per-turn diff breakdown with Revert/Restore and clickable section jumps inside each HUD card.',
                    on: settings.showInlineChanges !== false,
                })}
                ${renderSwitchRow({
                    id: 'vse_pop_spatial_grounding',
                    icon: 'fa-cubes',
                    color: '#38bdf8',
                    label: 'Inject &lt;spatial_grounding&gt; Guidance for Main Model',
                    desc: 'Teaches the story model how to read Atlas room dimensions, ceiling heights, floor elevation, elevated platforms, and line-of-sight.',
                    on: settings.spatialGrounding !== false,
                })}
                ${renderSwitchRow({
                    id: 'vse_pop_scoped',
                    icon: 'fa-filter',
                    color: '#10b981',
                    label: 'Smart Scoping',
                    desc: 'Summarizes inactive Atlas maps &amp; dormant NPCs in main-model prompt snapshots.',
                    on: settings.scoped !== false,
                })}
                ${renderSwitchRow({
                    id: 'vse_pop_force_active',
                    icon: 'fa-bolt',
                    color: '#a855f7',
                    label: 'Force Active on Non-Vexa Presets',
                    desc: 'Runs prompt stripping &amp; external state injection even if preset auto-detection does not match Vexa.',
                    on: Boolean(settings.forceActive),
                })}
                ${renderSwitchRow({
                    id: 'vse_pop_pin_rules',
                    icon: 'fa-thumbtack',
                    color: '#ef4444',
                    label: 'Pin [R] OOC Rules in Notebook',
                    desc: 'Prevents user [R] rules from being evicted by the 20-entry Notebook cap.',
                    on: settings.pinNotebookRules !== false,
                })}
                ${renderSwitchRow({
                    id: 'vse_pop_matrix_cap',
                    icon: 'fa-sliders',
                    color: '#ec4899',
                    label: 'Enforce ±2 Per-Turn Aether Matrix Step Cap',
                    desc: 'Clamps sudden per-turn relationship jumps in Aether Pair matrices.',
                    on: settings.enforceMatrixStepCap !== false,
                })}
                ${renderSwitchRow({
                    id: 'vse_pop_allow_proposals',
                    icon: 'fa-chart-simple',
                    color: '#f59e0b',
                    label: 'Allow Main Model to Propose Custom Trackers',
                    desc: 'Allows the story model to suggest new multi-stat trackers (businesses, estates, ships) via <vexa_receipt>.',
                    on: settings.allowTrackerProposals !== false,
                })}
                ${renderSwitchRow({
                    id: 'vse_pop_auto_accept_trackers',
                    icon: 'fa-bolt',
                    color: '#10b981',
                    label: 'Auto-Accept Proposed Trackers',
                    desc: 'Automatically activates main-model proposals instead of queuing them for manual approval.',
                    on: Boolean(settings.autoAcceptTrackerProposals),
                })}
            </div>
        `);

        $stage.find('#vse_pop_theme_grid').on('click', '.vse-theme-card', function () {
            const val = String($(this).data('theme-name') || 'Sola');
            getSettings().hudTheme = val;
            notifySettingsChanged();
            renderAppearanceTab($stage, getSettings());
        });
        $stage.find('#vse_pop_align_hud_themes').on('click', () => {
            const s = getSettings();
            onAlignHudThemes?.(s.hudTheme || 'Sola', s.hudStyle || 'Afterglow');
        });
        $stage.find('[data-tile-group="hudstyle"]').on('click', '.vse-tile', function () {
            getSettings().hudStyle = String($(this).data('tile-val') || 'Afterglow');
            notifySettingsChanged();
            renderAppearanceTab($stage, getSettings());
        });
        $stage.find('[data-tile-group="atlasmode"]').on('click', '.vse-tile', function () {
            getSettings().atlasViewMode = String($(this).data('tile-val') || 'webgl');
            atlasView.mode = null;
            $(this).siblings().removeClass('on');
            $(this).addClass('on');
            notifySettingsChanged();
        });
        $stage.find('[data-tile-group="bodytype"]').on('click', '.vse-tile', function () {
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
        wireBool('#vse_pop_show_launcher', 'showLauncherButton', true);
        wireBool('#vse_pop_hud_collapsed', 'hudDefaultCollapsed', true);
        wireBool('#vse_pop_show_inline_changes', 'showInlineChanges', true);
        wireBool('#vse_pop_spatial_grounding', 'spatialGrounding', true);
        wireBool('#vse_pop_scoped', 'scoped', true);
        wireBool('#vse_pop_force_active', 'forceActive', false);
        wireBool('#vse_pop_pin_rules', 'pinNotebookRules', true);
        wireBool('#vse_pop_matrix_cap', 'enforceMatrixStepCap', true);
        wireBool('#vse_pop_allow_proposals', 'allowTrackerProposals', true);
        wireBool('#vse_pop_auto_accept_trackers', 'autoAcceptTrackerProposals', false);
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
                badgeHtml: `<span class="vse-head-badge ${ejsOn || rendererOn ? 'ok' : ''}">${rtStats.activeIframes || 0} ACTIVE IFRAMES</span>`,
            })}
            <div class="vse-banner ${(yieldingEjs || yieldingRenderer) ? 'warm' : 'ok'}">
                <i class="fa-solid ${(yieldingEjs || yieldingRenderer) ? 'fa-handshake' : 'fa-shield-halved'}"></i>
                <span>
                    ${yieldingEjs ? '<b>EJS auto-yielding</b> to ST-Prompt-Template (window.EjsTemplate detected). ' : '<b>Scoped EJS Ready</b> (5,000-step loop cap, zero DOM/secret access). '}
                    ${yieldingRenderer ? '<b>Renderer auto-yielding</b> to JS-Slash-Runner (TavernHelper detected).' : '<b>Sandboxed Blob-URL Renderer Ready</b> (sandbox="allow-scripts", CSP-isolated, depth-throttled).'}
                </span>
            </div>

            <div class="vse-glass-card">
                <div class="vse-card-title">Scoped EJS Templating Engine</div>
                ${renderSwitchRow({
                    id: 'vse_pop_ejs_enabled',
                    icon: 'fa-terminal',
                    color: '#f59e0b',
                    label: 'Enable Scoped EJS &amp; Macro Evaluation',
                    desc: 'Evaluates &lt;% ... %&gt;, RPG dice roll(), getvar(), and getvexa() across World Info and chat prompts.',
                    on: ejsOn,
                })}
                ${renderSwitchRow({
                    id: 'vse_pop_ejs_wi',
                    icon: 'fa-book-open',
                    color: '#38bdf8',
                    label: 'Evaluate World Info &amp; Seed [InitVar]',
                    desc: 'Automatically seeds scoped card_vars from [InitVar] and evaluates EJS conditions on loaded lore entries.',
                    on: settings.ejsEvalWorldInfo !== false,
                })}
                ${renderSwitchRow({
                    id: 'vse_pop_ejs_prompts',
                    icon: 'fa-wand-magic-sparkles',
                    color: '#10b981',
                    label: 'Evaluate Outgoing Chat Prompts',
                    desc: 'Evaluates EJS and {{get_card_var::...}} / {{vexa::...}} macros cleanly before generation (non-Vexa presets included).',
                    on: settings.ejsEvalPrompts !== false,
                })}
                ${renderSwitchRow({
                    id: 'vse_pop_ejs_yield',
                    icon: 'fa-code-branch',
                    color: '#a855f7',
                    label: 'Auto-Yield to ST-Prompt-Template',
                    desc: 'Defers EJS execution to window.EjsTemplate when external ST-Prompt-Template is installed.',
                    on: settings.ejsAutoYield !== false,
                })}
                <div class="vse-field-col wide" style="margin-top:8px;">
                    <label class="vse-field-lbl">EJS Quick Evaluator (Test against live Vexa state &amp; card_vars)</label>
                    <div class="vse-inline-actions" style="justify-content:stretch;">
                        <textarea id="vse_pop_ejs_input" class="vse-app-input vse-mono" rows="2" placeholder="Roll: <%= roll('1d100') %> | Loc: <%= getvexa('world.loc', 'Unknown') %> | Luck: <%= getvar('stat_data.luck', 30) %>"><%= roll('1d100') %> · Loc: <%= getvexa('world.loc', 'Unknown') %></textarea>
                        <button type="button" class="vse-app-btn primary" id="vse_pop_ejs_run"><i class="fa-solid fa-play"></i> Run</button>
                    </div>
                    <pre id="vse_pop_ejs_out" class="vse-pre" style="margin-top:4px;min-height:28px;">Click Run to evaluate snippet...</pre>
                </div>
            </div>

            <div class="vse-glass-card">
                <div class="vse-card-head">
                    <div>
                        <div class="vse-card-title">Guarded Blob-URL Renderer &amp; Interactive Bridge</div>
                        <div class="vse-card-sub">
                            Active Iframes: <b>${rtStats.activeIframes || 0}</b> ·
                            Placeholders: <b>${rtStats.placeholders || 0}</b> ·
                            Revoked URLs: <b>${rtStats.totalRevokedUrls || 0}</b> ·
                            Scan: <b>${rtStats.lastScanMs ?? 0} ms</b> ·
                            RPCs: <b>${rtStats.totalRpcs || 0}</b> (Blocked: <b>${rtStats.blockedRpcs || 0}</b>)
                        </div>
                    </div>
                </div>
                ${renderSwitchRow({
                    id: 'vse_pop_ren_enabled',
                    icon: 'fa-window-maximize',
                    color: '#38bdf8',
                    label: 'Enable Guarded Blob-URL Iframe Renderer',
                    desc: 'Renders frontend HTML blocks inside sandbox="allow-scripts" iframes via window.VexaCard postMessage bridge.',
                    on: rendererOn,
                })}
                ${renderSwitchRow({
                    id: 'vse_pop_ren_blob',
                    icon: 'fa-link',
                    color: '#10b981',
                    label: 'Use Blob URL Rendering',
                    desc: 'Uses URL.createObjectURL(Blob) and revokes URLs on unmount/chat switch (falls back to srcdoc if off).',
                    on: settings.rendererUseBlobUrl !== false,
                })}
                <div class="vse-field-col wide" style="margin-top:6px;">
                    <label class="vse-field-lbl">Render Depth (Active floors from newest; 0 = all capped at 6)</label>
                    ${renderTiles('rendepth', [
                        { id: '1', label: '1 Floor' },
                        { id: '2', label: '2 Floors' },
                        { id: '3', label: '3 Floors' },
                        { id: '5', label: '5 Floors' },
                        { id: '0', label: 'All (Cap 6)' },
                    ], String(settings.rendererDepth ?? 2))}
                </div>
                <div class="vse-field-col wide" style="margin-top:6px;">
                    <label class="vse-field-lbl">Code Block Folding</label>
                    ${renderTiles('rencollapse', [
                        { id: 'frontend', label: 'Frontend Only', desc: 'Hide HTML blocks replaced by iframes' },
                        { id: 'all', label: 'All Blocks', desc: 'Collapse every code block in chat' },
                        { id: 'none', label: 'None', desc: 'Keep raw code visible' },
                    ], settings.rendererCollapseCode || 'frontend')}
                </div>
                <div class="vse-two-col" style="margin-top:8px;">
                    <div class="vse-field-col">
                        <label class="vse-field-lbl">Max HTML Guard (KB)</label>
                        <input id="vse_pop_ren_maxkb" type="number" min="64" max="16384" step="64" class="vse-app-input" value="${esc(settings.rendererMaxHtmlKb ?? 2048)}" />
                    </div>
                </div>
                ${renderSwitchRow({
                    id: 'vse_pop_ren_hljs',
                    icon: 'fa-gauge-high',
                    color: '#f59e0b',
                    label: 'Skip highlight.js on Frontend Screens',
                    desc: 'Prevents multi-megabyte HTML blocks from freezing syntax highlighting.',
                    on: settings.rendererSkipHljs !== false,
                })}
                ${renderSwitchRow({
                    id: 'vse_pop_ren_ext',
                    icon: 'fa-globe',
                    color: '#ef4444',
                    label: 'Allow External CDN Styles/Fonts/Scripts (https:)',
                    desc: 'Off by default for offline CSP privacy. connect-src remains blocked in all modes.',
                    on: Boolean(settings.rendererAllowExternalResources),
                })}
                ${renderSwitchRow({
                    id: 'vse_pop_ren_autosend',
                    icon: 'fa-paper-plane',
                    color: '#fbbf24',
                    label: 'Allow Screen Auto-Send Without Confirmation',
                    desc: 'When off, submitInput() stages a 1-click "Send to Chat" bar instead of submitting silently.',
                    on: Boolean(settings.rendererAllowAutoSend),
                })}
                ${renderSwitchRow({
                    id: 'vse_pop_ren_yield',
                    icon: 'fa-code-branch',
                    color: '#a855f7',
                    label: 'Auto-Yield to JS-Slash-Runner',
                    desc: 'Defers rendering to TavernHelper when external JS-Slash-Runner is active.',
                    on: settings.rendererAutoYield !== false,
                })}
            </div>

            <div class="vse-glass-card">
                <div class="vse-card-head">
                    <div>
                        <div class="vse-card-title">Scoped Card Variables (card_vars)</div>
                        <div class="vse-card-sub">Chat-isolated JSON variables seeded from [InitVar] or written via window.VexaCard (64 KB cap).</div>
                    </div>
                    <div class="vse-inline-actions">
                        <button type="button" class="vse-app-btn secondary" id="vse_pop_reset_cardvars"><i class="fa-solid fa-trash"></i> Reset Vars</button>
                        <button type="button" class="vse-app-btn primary" id="vse_pop_save_cardvars"><i class="fa-solid fa-floppy-disk"></i> Save Card Vars</button>
                    </div>
                </div>
                <textarea id="vse_pop_cardvars_json" class="vse-app-input vse-mono" rows="10">${esc(JSON.stringify(cardVars, null, 2))}</textarea>
                <span class="vse-err-text" id="vse_pop_cardvars_err"></span>
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
        wireRtBool('#vse_pop_ejs_enabled', 'ejsEnabled', true);
        wireRtBool('#vse_pop_ejs_wi', 'ejsEvalWorldInfo', true);
        wireRtBool('#vse_pop_ejs_prompts', 'ejsEvalPrompts', true);
        wireRtBool('#vse_pop_ejs_yield', 'ejsAutoYield', true);
        wireRtBool('#vse_pop_ren_enabled', 'rendererEnabled', true);
        wireRtBool('#vse_pop_ren_blob', 'rendererUseBlobUrl', true);
        wireRtBool('#vse_pop_ren_hljs', 'rendererSkipHljs', true);
        wireRtBool('#vse_pop_ren_ext', 'rendererAllowExternalResources', false);
        wireRtBool('#vse_pop_ren_autosend', 'rendererAllowAutoSend', false);
        wireRtBool('#vse_pop_ren_yield', 'rendererAutoYield', true);

        $stage.find('[data-tile-group="rendepth"]').on('click', '.vse-tile', function () {
            const val = parseInt(String($(this).data('tile-val') || '2'), 10);
            getSettings().rendererDepth = Number.isNaN(val) ? 2 : val;
            $(this).siblings().removeClass('on');
            $(this).addClass('on');
            notifySettingsChanged();
        });
        $stage.find('[data-tile-group="rencollapse"]').on('click', '.vse-tile', function () {
            getSettings().rendererCollapseCode = String($(this).data('tile-val') || 'frontend');
            $(this).siblings().removeClass('on');
            $(this).addClass('on');
            notifySettingsChanged();
        });
        $stage.find('#vse_pop_ren_maxkb').on('change', function () {
            const val = parseInt(String($(this).val()), 10);
            if (!Number.isNaN(val) && val >= 64 && val <= 16384) {
                getSettings().rendererMaxHtmlKb = val;
                notifySettingsChanged();
            }
        });

        $stage.find('#vse_pop_ejs_run').on('click', () => {
            const tpl = String($stage.find('#vse_pop_ejs_input').val() || '');
            const ctx = getContextSafe?.() || {};
            const res = evaluateEjs(tpl, {
                state,
                cardVars: store?.getCardVars?.() || {},
                charName: ctx.name2 || '',
                userName: ctx.name1 || '',
            });
            $stage.find('#vse_pop_ejs_out').text(res.ok ? res.text : `Error: ${res.error}`);
        });

        $stage.find('#vse_pop_save_cardvars').on('click', () => {
            $('#vse_pop_cardvars_err').text('');
            try {
                const parsed = JSON.parse(String($stage.find('#vse_pop_cardvars_json').val() || '{}'));
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    $('#vse_pop_cardvars_err').text('Root card_vars must be a JSON object.');
                    return;
                }
                store?.resetCardVars?.();
                const res = store?.patchCardVars?.(parsed);
                if (!res?.ok) {
                    $('#vse_pop_cardvars_err').text(res?.error || 'Failed to save card_vars.');
                    return;
                }
                onCardVarsChanged?.(store.getCardVars());
                window.toastr?.success?.('Saved scoped card_vars.', 'Vexa State Engine');
                renderRuntimeTab($stage, activeState(), getSettings());
            } catch (err) {
                $('#vse_pop_cardvars_err').text(`Invalid JSON: ${err.message}`);
            }
        });

        $stage.find('#vse_pop_reset_cardvars').on('click', () => {
            store?.resetCardVars?.();
            onCardVarsChanged?.({});
            window.toastr?.info?.('Cleared scoped card_vars for this chat.', 'Vexa State Engine');
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
            : '<!-- No Vexa state recorded in this chat yet. -->';
        const tok = estimateTokenCount(xml);

        $stage.html(`
            ${renderPageHeader(meta)}
            ${historyBannerHtml(state)}
            <div class="vse-glass-card">
                <div class="vse-card-title">Chat State Maintenance</div>
                <div class="vse-inline-actions" style="justify-content:flex-start;">
                    <button type="button" class="vse-app-btn secondary" id="vse_pop_import"><i class="fa-solid fa-file-import"></i> Import Chat States</button>
                    <button type="button" class="vse-app-btn secondary" id="vse_pop_tools_reread"><i class="fa-solid fa-rotate"></i> Re-read Last Reply</button>
                    <button type="button" class="vse-app-btn secondary" id="vse_pop_copy_xml"><i class="fa-solid fa-copy"></i> Copy Compiled XML</button>
                    <button type="button" class="vse-app-btn danger" id="vse_pop_reset_chat"><i class="fa-solid fa-trash"></i> Reset Chat State</button>
                </div>
            </div>

            <div class="vse-glass-card">
                <div class="vse-card-head">
                    <div>
                        <div class="vse-card-title">Compiled Prompt Snapshot Preview</div>
                        <div class="vse-card-sub">${esc(xml.length.toLocaleString())} chars · ~${esc(tok.toLocaleString())} tokens (${previewScoped ? 'Smart-Scoped' : 'Full Unscoped'})</div>
                    </div>
                    <div class="vse-seg" id="vse_pop_preview_seg">
                        <button type="button" class="${previewScoped ? 'on' : ''}" data-scoped="1">Scoped</button>
                        <button type="button" class="${!previewScoped ? 'on' : ''}" data-scoped="0">Full XML</button>
                    </div>
                </div>
                <pre class="vse-pre vse-xml-preview">${esc(xml)}</pre>
            </div>

            <div class="vse-glass-card">
                <div class="vse-card-head">
                    <div class="vse-card-title">Raw Canonical State JSON</div>
                    <button type="button" class="vse-app-btn primary" id="vse_pop_save_raw"><i class="fa-solid fa-floppy-disk"></i> Save Raw JSON</button>
                </div>
                <textarea id="vse_pop_raw_json" class="vse-app-input vse-mono" rows="16">${esc(JSON.stringify(state, null, 2))}</textarea>
                <span class="vse-err-text" id="vse_pop_raw_err"></span>
            </div>
        `);

        $stage.find('#vse_pop_import').on('click', () => {
            onImportChat?.();
            syncChrome();
            renderToolsTab($stage, activeState(), getSettings());
        });
        $stage.find('#vse_pop_tools_reread').on('click', () => onRereadLast?.());
        $stage.find('#vse_pop_copy_xml').on('click', async () => {
            const fullXml = serializeInternalStates(activeState(), { scoped: false, includeVent: true });
            try {
                await navigator.clipboard.writeText(fullXml);
                window.toastr?.success?.('Copied compiled <internal_states> XML.', 'Vexa State Engine');
            } catch {
                window.toastr?.info?.('Could not access clipboard.', 'Vexa State Engine');
            }
        });
        $stage.find('#vse_pop_reset_chat').on('click', async () => {
            const ctx = getContextSafe?.() || {};
            let confirmed = true;
            if (typeof ctx.callGenericPopup === 'function') {
                const res = await ctx.callGenericPopup(
                    'Reset the external Vexa state journal for this chat? (Original chat messages are not deleted.)',
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
        $stage.find('#vse_pop_preview_seg').on('click', 'button', function () {
            previewScoped = $(this).data('scoped') === 1 || $(this).data('scoped') === '1';
            renderToolsTab($stage, activeState(), getSettings());
        });
        $stage.find('#vse_pop_save_raw').on('click', () => {
            $('#vse_pop_raw_err').text('');
            try {
                const parsed = JSON.parse(String($stage.find('#vse_pop_raw_json').val() || '{}'));
                commitEditedState(parsed, 'Saved raw canonical JSON.');
            } catch (err) {
                $('#vse_pop_raw_err').text(`Invalid JSON: ${err.message}`);
            }
        });
    }

    function renderActiveTab({ resetScroll = false } = {}) {
        const $stage = $('#vse_app_stage');
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
            case 'tools':
                renderToolsTab($stage, state, settings);
                break;
            default:
                renderOverviewTab($stage, state, settings, ws);
        }

        $stage.on('click', '#vse_pop_go_live', () => {
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
        refresh,
        syncChrome,
    };
}
