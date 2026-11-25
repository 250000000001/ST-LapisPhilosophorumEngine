/**
 * Native JS Tabbed Vexa HUD Renderer.
 *
 * - Never mutates msg.mes.
 * - Hides <vexa_tail> residual text inside .mes_text cleanly as fallback to regex.
 * - Renders collapsible themed card beneath each AI message from store.getStateAt(seq),
 *   showing diff badges for sections changed that turn and live worker status.
 */

import { VEXA_THEMES, VEXA_STYLES, PALETTE, isEmptySentinel } from './schema.js';
import { serializeInternalStates } from './parser.js';
import { renderAtlasTab } from './atlasSvg.js';
import { bindPolyOrbitControls } from './polyCss3d.js';

export const HUD_TABS = [
    { id: 'world', label: 'World', icon: 'fa-globe' },
    { id: 'onscreen', label: 'On-Screen', icon: 'fa-users' },
    { id: 'offscreen_agendas', label: 'Off-Screen', icon: 'fa-compass' },
    { id: 'locations', label: 'Atlas Map', icon: 'fa-map' },
    { id: 'entityMem', label: 'Memories', icon: 'fa-brain' },
    { id: 'entity_state', label: 'Entities', icon: 'fa-masks-theater' },
    { id: 'thoughts', label: 'Thoughts', icon: 'fa-comment-dots' },
    { id: 'dam', label: 'Dam', icon: 'fa-water' },
    { id: 'pair', label: 'Matrix', icon: 'fa-heart-pulse' },
    { id: 'tracks', label: 'Tracks', icon: 'fa-route' },
    { id: 'arc', label: 'ARC', icon: 'fa-diagram-project' },
    { id: 'chekhov', label: 'Chekhov', icon: 'fa-crosshairs' },
    { id: 'inv', label: 'Inv', icon: 'fa-suitcase' },
    { id: 'custom_trackers', label: 'Trackers', icon: 'fa-chart-simple' },
    { id: 'story_notes', label: 'Notes', icon: 'fa-note-sticky' },
    { id: 'notebook', label: 'Notebook', icon: 'fa-book' },
    { id: 'vent', label: 'Vent', icon: 'fa-fire' },
];

// Per-message UI view state (survives re-renders without writing chat metadata)
const viewState = new Map(); // msgId -> { collapsed, tab, theme, style, mapId, level, roomId }

function getView(msgId, defaults) {
    if (!viewState.has(msgId)) {
        viewState.set(msgId, {
            collapsed: defaults.defaultCollapsed !== false,
            tab: 'world',
            theme: defaults.theme || 'Sola',
            style: defaults.style || 'Afterglow',
            mapId: null,
            level: null,
            roomId: null,
            atlasMode: null,
            allFloors: false,
            cutaway: true,
            showLabels: true,
            camera: { rotX: 56, rotZ: 32, zoom: 1, panX: 0, panY: 0 },
        });
    }
    return viewState.get(msgId);
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
    return p ? p.hex : 'var(--ist-blue)';
}

function renderTabBody(tabId, state, view, settings) {
    switch (tabId) {
        case 'world': {
            const w = state.world || {};
            return `<div class="vse-kv-grid">
                <div><span>Turn (ct)</span><b>${esc(w.ct)}</b></div>
                <div><span>Time / Date</span><b>${esc(w.time)} · ${esc(w.date)}</b></div>
                <div><span>Location</span><b>${esc(w.loc)}</b></div>
                <div><span>Weather</span><b>${esc(w.weather)}</b></div>
                <div><span>Pacing</span><b>${esc(w.pacing)}</b></div>
                <div><span>User Pos</span><b>${esc(w.user_pos)}</b></div>
                <div class="wide"><span>Room</span><b>${esc(w.room)}</b></div>
                <div class="wide"><span>Entries</span><b>${esc(w.entries)}</b></div>
                <div class="wide"><span>Obstacles</span><b>${esc(w.obstacles)}</b></div>
                <div class="wide"><span>Audio / Occlusion</span><b>${esc(w.audio)}</b></div>
            </div>`;
        }
        case 'onscreen': {
            const list = state.onscreen || [];
            if (!list.length) return `<div class="vse-empty">No on-screen NPCs recorded.</div>`;
            return `<div class="vse-cards-grid">${list.map((e) => {
                const es = (state.entity_state || []).find((x) => x.name.toLowerCase() === e.name.toLowerCase());
                const col = hexFromFontColor(es?.fontColor);
                return `<div class="vse-subcard">
                    <div class="vse-subcard-head">
                        <i class="vse-dot" style="background:${col}"></i>
                        <strong>${esc(e.name)}</strong>
                        <span class="vse-pill">${esc(e.salience)}</span>
                        <span class="vse-pill">${esc(e.tfdy)}</span>
                    </div>
                    <div class="vse-line"><span>Emotion:</span> ${esc(e.parrott)}</div>
                    <div class="vse-line"><span>Residual:</span> ${esc(e.residualMood)}</div>
                    <div class="vse-line"><span>Agenda:</span> ${esc(e.agenda)}</div>
                    <div class="vse-line"><span>Why:</span> ${esc(e.why)}</div>
                    <div class="vse-line"><span>End / Move:</span> ${esc(e.end)} · ${esc(e.move)}</div>
                </div>`;
            }).join('')}</div>`;
        }
        case 'offscreen_agendas': {
            const list = state.offscreen_agendas || [];
            if (!list.length) return `<div class="vse-empty">No off-screen NPCs recorded.</div>`;
            return `<div class="vse-cards-grid">${list.map((e) => {
                const es = (state.entity_state || []).find((x) => x.name.toLowerCase() === e.name.toLowerCase());
                const col = hexFromFontColor(es?.fontColor);
                return `<div class="vse-subcard">
                    <div class="vse-subcard-head">
                        <i class="vse-dot" style="background:${col}"></i>
                        <strong>${esc(e.name)}</strong>
                        <span class="vse-pill">${esc(e.salience)}</span>
                        <span class="vse-pill">${esc(e.tfdy)}</span>
                    </div>
                    <div class="vse-line"><span>Location:</span> ${esc(e.loc)}</div>
                    <div class="vse-line"><span>Mood:</span> ${esc(e.mood)}</div>
                    <div class="vse-line"><span>Agenda:</span> ${esc(e.agenda)}</div>
                    <div class="vse-line"><span>Goal / End:</span> ${esc(e.goal)} (${esc(e.end)})</div>
                </div>`;
            }).join('')}</div>`;
        }
        case 'locations':
            return renderAtlasTab(state, {
                selectedMapId: view.mapId,
                selectedLevel: view.level,
                selectedRoomId: view.roomId,
                viewMode: view.atlasMode || settings?.atlasViewMode || '3d',
                allFloors: view.allFloors,
                cutaway: view.cutaway,
                showLabels: view.showLabels,
                camera: view.camera,
            });
        case 'entityMem': {
            const list = state.entityMem || [];
            if (!list.length) return `<div class="vse-empty">No entity memories recorded.</div>`;
            return `<div class="vse-stack">${list.map((em) => `
                <div class="vse-subcard">
                    <div class="vse-subcard-head"><strong>${esc(em.name)}</strong><span class="vse-pill">${em.entries.length}/20</span></div>
                    <ul class="vse-list">${em.entries.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
                </div>
            `).join('')}</div>`;
        }
        case 'entity_state': {
            const list = state.entity_state || [];
            if (!list.length) return `<div class="vse-empty">No entity profiles recorded.</div>`;
            return `<div class="vse-cards-grid">${list.map((es) => {
                const col = hexFromFontColor(es.fontColor);
                return `<div class="vse-subcard">
                    <div class="vse-subcard-head">
                        <i class="vse-dot" style="background:${col}"></i>
                        <strong>${esc(es.name)}</strong>
                        <span class="vse-pill" style="border-color:${col};color:${col}">${esc(es.fontColor || 'unassigned')}</span>
                    </div>
                    <div class="vse-line"><span>Look:</span> ${esc(es.look)}</div>
                    <div class="vse-line"><span>Voice:</span> ${esc(es.voice)}</div>
                    <div class="vse-line"><span>Persona:</span> ${esc(es.persona)}</div>
                    <div class="vse-line"><span>Private:</span> ${esc(es.private)}</div>
                </div>`;
            }).join('')}</div>`;
        }
        case 'thoughts': {
            const list = state.thoughts || [];
            if (!list.length) return `<div class="vse-empty">No inner thoughts captured this turn.</div>`;
            return `<div class="vse-cards-grid">${list.map((t) => `
                <div class="vse-subcard">
                    <div class="vse-subcard-head"><strong>${esc(t.name)}</strong></div>
                    <div class="vse-line"><span>Goal:</span> ${esc(t.tQ1)}</div>
                    <div class="vse-line"><span>Feeling:</span> ${esc(t.tQ2)}</div>
                    <div class="vse-line"><span>Mind:</span> ${esc(t.tQ3)}</div>
                    <div class="vse-line"><span>Why:</span> ${esc(t.tQ4)}</div>
                    <div class="vse-line"><span>Unsaid:</span> ${esc(t.tQ5)}</div>
                </div>
            `).join('')}</div>`;
        }
        case 'dam': {
            const list = state.dam || [];
            if (!list.length) return `<div class="vse-empty">No Aether Dam records.</div>`;
            return `<div class="vse-cards-grid">${list.map((d) => `
                <div class="vse-subcard">
                    <div class="vse-subcard-head"><strong>${esc(d.pair)}</strong><span class="vse-pill">${esc(d.sluice)}</span></div>
                    <div class="vse-line"><span>Filters:</span> ${esc(d.filters)}</div>
                    <div class="vse-line"><span>Misc:</span> ${esc(d.misc)}</div>
                    <div class="vse-line"><span>Intent:</span> ${esc(d.intent)}</div>
                </div>
            `).join('')}</div>`;
        }
        case 'pair': {
            const list = state.pair || [];
            if (!list.length) return `<div class="vse-empty">No Aether Pair matrices.</div>`;
            return `<div class="vse-stack">${list.map((p) => `
                <div class="vse-subcard">
                    <div class="vse-subcard-head">
                        <strong>${esc(p.names)}</strong>
                        <span class="vse-pill">${esc(p.mode)}</span>
                        <span class="vse-pill">${esc(p.dam)}</span>
                        <span class="vse-pill">${esc(p.wall)}</span>
                    </div>
                    <div class="vse-matrix">${esc(p.matrix)}</div>
                </div>
            `).join('')}</div>`;
        }
        case 'tracks': {
            const tr = state.tracks || {};
            return `<div class="vse-stack">
                <div class="vse-subcard"><div class="vse-subcard-head"><strong>Main Arc Track</strong></div><div>${esc(tr.main || '∅')}</div></div>
                ${(tr.tracks || []).map((x) => `<div class="vse-subcard"><div class="vse-subcard-head"><strong>Track</strong></div><div>${esc(x)}</div></div>`).join('')}
                ${(tr.history || []).length ? `<div class="vse-subcard"><div class="vse-subcard-head"><strong>History</strong></div><ul class="vse-list">${tr.history.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
            </div>`;
        }
        case 'arc': {
            const a = state.arc || {};
            if (isEmptySentinel(a.info) && !a.ki?.length) return `<div class="vse-empty">ARC Engine in Ki phase (no active ARC generated yet).</div>`;
            return `<div class="vse-stack">
                <div class="vse-subcard"><div><span>Info:</span> ${esc(a.info)}</div><div><span>Timeline:</span> ${esc(a.timeline)}</div></div>
                ${['ki', 'sho', 'ten', 'ketsu'].map((act) => `
                    <div class="vse-subcard">
                        <div class="vse-subcard-head"><strong>${act.toUpperCase()}</strong></div>
                        <ul class="vse-list">${(a[act] || ['∅']).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
                    </div>
                `).join('')}
            </div>`;
        }
        case 'chekhov': {
            const ch = state.chekhov || {};
            return `<div class="vse-stack">
                <div class="vse-subcard"><div class="vse-subcard-head"><strong>Chambered</strong><span class="vse-pill">${(ch.chamber || []).length}/20</span></div><ul class="vse-list">${(ch.chamber || []).length ? ch.chamber.map((b) => `<li>${esc(b)}</li>`).join('') : '<li>∅</li>'}</ul></div>
                <div class="vse-subcard"><div class="vse-subcard-head"><strong>Locked</strong><span class="vse-pill">${(ch.locked || []).length}/20</span></div><ul class="vse-list">${(ch.locked || []).length ? ch.locked.map((b) => `<li>${esc(b)}</li>`).join('') : '<li>∅</li>'}</ul></div>
                <div class="vse-subcard"><div class="vse-subcard-head"><strong>Fired This Turn</strong></div><ul class="vse-list">${(ch.fired || []).length ? ch.fired.map((b) => `<li>${esc(b)}</li>`).join('') : '<li>∅</li>'}</ul></div>
            </div>`;
        }
        case 'inv': {
            const inv = state.inv || {};
            return `<div class="vse-kv-grid">
                <div class="wide"><span>Inventory</span><b>${esc(inv.inv || '∅')}</b></div>
                <div class="wide"><span>Titles & Modifiers</span><b>${esc(inv.titles || '∅')}</b></div>
                <div class="wide"><span>Status & Conditions</span><b>${esc(inv.status || '∅')}</b></div>
            </div>`;
        }
        case 'custom_trackers': {
            const props = state.tracker_proposals || [];
            const active = (state.custom_trackers || []).filter((t) => t && !t.archived);
            const propsHtml = props.length
                ? `<div class="vse-stack" style="margin-bottom:8px;">${props.map((p) => {
                    const kv = Object.entries(p.fields || {}).map(([k, v]) => `<b>${esc(k)}</b>=${esc(v)}`).join(' · ');
                    return `<div class="vse-subcard" style="border-color:var(--ist-yellow);">
                        <div class="vse-subcard-head">
                            <span class="vse-pill warn">Proposed Tracker</span>
                            <strong>${esc(p.title)}</strong>
                            <span style="margin-left:auto;display:inline-flex;gap:4px;">
                                <button type="button" class="vse-mini-btn vse-hud-approve-prop" data-prop-id="${esc(p.id)}" title="Approve tracker"><i class="fa-solid fa-check"></i> Approve</button>
                                <button type="button" class="vse-mini-btn vse-hud-dismiss-prop" data-prop-id="${esc(p.id)}" title="Dismiss proposal"><i class="fa-solid fa-xmark"></i> Dismiss</button>
                            </span>
                        </div>
                        <div class="vse-line">${kv}</div>
                        ${p.reason ? `<div class="vse-line"><span>Reason:</span> ${esc(p.reason)}</div>` : ''}
                    </div>`;
                }).join('')}</div>`
                : '';
            const activeHtml = active.length
                ? `<div class="vse-cards-grid">${active.map((t) => `
                    <div class="vse-subcard">
                        <div class="vse-subcard-head">
                            <strong>${esc(t.title)}</strong>
                            <span class="vse-pill">${esc(t.id)}</span>
                        </div>
                        <div class="vse-kv-grid">
                            ${Object.entries(t.fields || {}).map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
                        </div>
                        ${t.notes ? `<div class="vse-line" style="margin-top:5px;"><span>Notes:</span> ${esc(t.notes)}</div>` : ''}
                    </div>
                `).join('')}</div>`
                : (props.length ? '' : `<div class="vse-empty">No custom trackers active. Main model can propose trackers for recurring businesses, estates, ships, or ledgers when enabled.</div>`);
            return `${propsHtml}${activeHtml}`;
        }
        case 'story_notes': {
            const sn = state.story_notes || {};
            return `<div class="vse-kv-grid">
                <div class="wide"><span>Threads</span><b>${esc(sn.threads)}</b></div>
                <div class="wide"><span>Seeds</span><b>${esc(sn.seeds)}</b></div>
                <div class="wide"><span>Motives</span><b>${esc(sn.motives)}</b></div>
                <div class="wide"><span>Horizon</span><b>${esc(sn.horizon)}</b></div>
                <div class="wide"><span>Gremlin Note</span><b>${esc(sn.GremlinNote)}</b></div>
                <div class="wide"><span>Heckle</span><b>${esc(sn.heckle)}</b></div>
            </div>`;
        }
        case 'notebook': {
            const nb = state.notebook || [];
            if (!nb.length) return `<div class="vse-empty">Notebook is empty.</div>`;
            return `<ul class="vse-list">${nb.map((ent) => {
                const tagMatch = ent.match(/^\s*(\[[RTD]\])\s*([\s\S]*)$/);
                if (!tagMatch) return `<li>${esc(ent)}</li>`;
                const cls = tagMatch[1] === '[R]' ? 'rule' : tagMatch[1] === '[T]' ? 'thread' : 'debug';
                return `<li><span class="vse-nb-badge ${cls}">${esc(tagMatch[1])}</span> ${esc(tagMatch[2])}</li>`;
            }).join('')}</ul>`;
        }
        case 'vent': {
            const rc = state.lastReceipt;
            return `<div class="vse-stack">
                <div class="vse-subcard"><div class="vse-subcard-head"><strong>Vexa Vent</strong></div><div class="vse-vent-text">${esc(state.vent || '∅')}</div></div>
                ${rc?.raw ? `<div class="vse-subcard"><div class="vse-subcard-head"><strong>CoT Receipt</strong></div><pre class="vse-pre">${esc(rc.raw)}</pre></div>` : ''}
            </div>`;
        }
        default:
            return '';
    }
}

function applyThemeVars($card, themeName) {
    const theme = VEXA_THEMES[themeName] || VEXA_THEMES.Sola;
    for (const [k, v] of Object.entries(theme)) {
        if (k === 'scheme') $card.css('color-scheme', v);
        else $card.css(`--ist-${k}`, v);
    }
}

/** Hide any un-regexed <vexa_tail> text inside .mes_text cleanly without touching msg.mes. */
export function hideVexaTailInMessageEl($mesText) {
    if (!$mesText || !$mesText.length) return;
    // If ST sanitizer stripped <vexa_tail> tag names into plain text paragraphs, hide trailing text nodes matching world_sim:/vent markers
    const html = $mesText.html();
    if (!html) return;
    if (/&lt;vexa_tail&gt;|<vexa_tail\b/i.test(html)) {
        const cleaned = html.replace(/(?:&lt;|<)vexa_tail(?:&gt;|>)[\s\S]*?(?:&lt;|<)\/vexa_tail(?:&gt;|>)/gi, '');
        if (cleaned !== html) $mesText.html(cleaned);
    }
    // Also hide sanitized loose <vexa_receipt> / <state:vent> plain paragraphs at bottom
    $mesText.find('p').each(function () {
        const txt = $(this).text().replace(/\u2800/g, ' ').trim();
        if (/^(?:world_sim:|chekhov:|arc:|ooc:|tracker_propose:|<vexa_tail>|<vexa_receipt>|<state:vent>)/i.test(txt)) {
            $(this).addClass('vse-hidden-tail');
        }
    });
}

/**
 * Refresh HUD cards for all rendered AI messages currently in #chat.
 */
export function refreshAllHudCards({ store, settings, workerStatus, onOpenEditor, onRetryMsg, onStopWorker, onCopyXml, onApproveProposal, onDismissProposal }) {
    if (!store || !settings.enabled) {
        $('#chat .vse-hud-card').remove();
        return;
    }
    const chat = window.SillyTavern?.getContext?.()?.chat || [];
    $('#chat .mes').each(function () {
        const $mes = $(this);
        const mesId = Number($mes.attr('mesid'));
        if (!Number.isFinite(mesId) || !chat[mesId]) return;
        const msg = chat[mesId];
        if (msg.is_user) return;

        const $mesText = $mes.find('.mes_text').first();
        hideVexaTailInMessageEl($mesText);

        const uid = msg.extra?.vexa_uid;
        const seq = msg.extra?.vexa_seq;
        const swipe = typeof msg.swipe_id === 'number' ? msg.swipe_id : 0;
        const entry = uid ? store.getEntryFor(uid, swipe) : null;
        const step = uid ? store.getStep(uid) : null;
        const state = typeof seq === 'number' ? store.getStateAt(seq) : store.getState();

        // Don't attach HUD to greeting msg 0 unless it actually has state
        if (mesId === 0 && !entry && !store.hasState()) return;

        const view = getView(mesId, {
            defaultCollapsed: settings.hudDefaultCollapsed !== false,
            theme: settings.hudTheme || 'Sola',
            style: settings.hudStyle || 'Afterglow',
        });

        const isBusyForThis = Boolean(
            workerStatus?.busy
            && ((workerStatus.activeUid && uid && workerStatus.activeUid === uid)
                || (!workerStatus.activeUid && mesId === chat.length - 1)),
        );
        const proposalCount = (state.tracker_proposals || []).length;
        const trackerCount = (state.custom_trackers || []).filter((t) => t && !t.archived).length;
        const effectiveAtlasMode = view.atlasMode || settings.atlasViewMode || '3d';
        const stamp = [
            store.version,
            swipe,
            view.collapsed ? '1' : '0',
            view.tab,
            view.theme,
            view.style,
            view.mapId || '',
            view.level || '',
            view.roomId || '',
            effectiveAtlasMode,
            view.allFloors ? '1' : '0',
            view.cutaway ? '1' : '0',
            view.showLabels ? '1' : '0',
            entry?.status || '',
            isBusyForThis ? 'busy' : 'idle',
            trackerCount,
            proposalCount,
        ].join('|');

        let $card = $mes.find('.vse-hud-card').first();
        if ($card.length && $card.attr('data-vse-stamp') === stamp) return;

        if (!$card.length) {
            $card = $('<div class="vse-hud-card"></div>');
            if ($mesText.length) $mesText.after($card);
            else $mes.find('.mes_block').append($card);
        }

        const diffSet = new Set(step?.diff || []);
        const statusBadge = isBusyForThis
            ? `<span class="vse-status busy"><i class="fa-solid fa-spinner fa-spin"></i> ${esc(workerStatus.runningLabel || 'Updating...')} <button type="button" class="vse-mini-btn vse-stop-btn" title="Stop worker"><i class="fa-solid fa-stop"></i></button></span>`
            : entry?.status === 'error'
                ? `<span class="vse-status err" title="${esc(entry.error || 'Worker failed')}"><i class="fa-solid fa-triangle-exclamation"></i> Failed <button type="button" class="vse-mini-btn vse-retry-btn"><i class="fa-solid fa-rotate-right"></i> Retry</button></span>`
                : entry?.status === 'pending'
                    ? `<span class="vse-status busy"><i class="fa-solid fa-clock"></i> Queued</span>`
                    : `<span class="vse-status ok"><i class="fa-solid fa-circle-check"></i> ${entry?.source === 'import' ? 'Imported' : 'Synced'}</span>`;

        const themeOpts = Object.keys(VEXA_THEMES).map((t) =>
            `<option value="${esc(t)}" ${t === view.theme ? 'selected' : ''}>${esc(t)}</option>`,
        ).join('');

        const tabsHtml = HUD_TABS.map((t) => {
            const hasDiff = diffSet.has(t.id);
            return `<button type="button" class="vse-tab-btn ${view.tab === t.id ? 'active' : ''}" data-tab="${t.id}">
                <i class="fa-solid ${t.icon}"></i> ${esc(t.label)}${hasDiff ? '<span class="vse-diff-dot" title="Changed this turn"></span>' : ''}
            </button>`;
        }).join('');

        $card
            .attr('data-vse-stamp', stamp)
            .attr('data-vse-style', view.style)
            .attr('data-vse-mesid', String(mesId));
        applyThemeVars($card, view.theme);

        $card.html(`
            <div class="vse-hud-bar">
                <button type="button" class="vse-toggle-btn">
                    <i class="fa-solid fa-chevron-${view.collapsed ? 'right' : 'down'}"></i>
                    <span class="vse-hud-title">Vexa State</span>
                    <span class="vse-pill">ct:${esc(state.world?.ct ?? 0)}</span>
                    <span class="vse-hud-loc">${esc(state.world?.loc || 'No location')}</span>
                    <span class="vse-hud-time">${esc(state.world?.time || '')}</span>
                    ${proposalCount ? `<span class="vse-pill warn" title="Pending custom tracker proposal"><i class="fa-solid fa-sparkles"></i> ${proposalCount} Proposal</span>` : ''}
                </button>
                <div class="vse-hud-actions">
                    ${statusBadge}
                    <button type="button" class="vse-icon-btn vse-reread-btn" title="Re-run worker on this reply"><i class="fa-solid fa-rotate"></i></button>
                    <button type="button" class="vse-icon-btn vse-edit-btn" title="Edit Vexa state"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button type="button" class="vse-icon-btn vse-copy-btn" title="Copy compiled <internal_states> XML"><i class="fa-solid fa-copy"></i></button>
                </div>
            </div>
            <div class="vse-hud-body" style="display:${view.collapsed ? 'none' : 'block'};">
                <div class="vse-subtoolbar">
                    <label>Theme: <select class="vse-theme-sel">${themeOpts}</select></label>
                    <label>Style: <select class="vse-style-sel">${VEXA_STYLES.map((st) => `<option value="${esc(st)}" ${st === view.style ? 'selected' : ''}>${esc(st)}</option>`).join('')}</select></label>
                </div>
                <div class="vse-tabs">${tabsHtml}</div>
                <div class="vse-tab-panel">${view.collapsed ? '' : renderTabBody(view.tab, state, view, settings)}</div>
            </div>
        `);

        if (!view.collapsed && view.tab === 'locations' && effectiveAtlasMode === '3d') {
            const vpEl = $card.find('.vse-poly-viewport')[0];
            if (vpEl) {
                bindPolyOrbitControls(vpEl, view.camera, {
                    onSelectRoom: (roomId) => {
                        view.roomId = roomId;
                        refreshAllHudCards({ store, settings, workerStatus, onOpenEditor, onRetryMsg, onStopWorker, onCopyXml, onApproveProposal, onDismissProposal });
                    },
                });
            }
        }

        // Wire card controls cleanly via scoped delegation
        $card.off('click change');
        $card.on('click', '.vse-toggle-btn', () => {
            view.collapsed = !view.collapsed;
            refreshAllHudCards({ store, settings, workerStatus, onOpenEditor, onRetryMsg, onStopWorker, onCopyXml, onApproveProposal, onDismissProposal });
        });
        $card.on('click', '.vse-tab-btn', function () {
            view.tab = $(this).data('tab');
            refreshAllHudCards({ store, settings, workerStatus, onOpenEditor, onRetryMsg, onStopWorker, onCopyXml, onApproveProposal, onDismissProposal });
        });
        $card.on('change', '.vse-theme-sel', function () {
            view.theme = $(this).val();
            refreshAllHudCards({ store, settings, workerStatus, onOpenEditor, onRetryMsg, onStopWorker, onCopyXml, onApproveProposal, onDismissProposal });
        });
        $card.on('change', '.vse-style-sel', function () {
            view.style = $(this).val();
            refreshAllHudCards({ store, settings, workerStatus, onOpenEditor, onRetryMsg, onStopWorker, onCopyXml, onApproveProposal, onDismissProposal });
        });
        $card.on('change', '.vse-atlas-map-sel', function () {
            view.mapId = $(this).val();
            view.level = null;
            view.roomId = null;
            refreshAllHudCards({ store, settings, workerStatus, onOpenEditor, onRetryMsg, onStopWorker, onCopyXml, onApproveProposal, onDismissProposal });
        });
        $card.on('click', '.vse-atlas-floor-btn', function () {
            view.level = String($(this).data('level'));
            view.allFloors = false;
            view.roomId = null;
            refreshAllHudCards({ store, settings, workerStatus, onOpenEditor, onRetryMsg, onStopWorker, onCopyXml, onApproveProposal, onDismissProposal });
        });
        $card.on('click', '.vse-atlas-allfloors-btn', function () {
            view.allFloors = !view.allFloors;
            refreshAllHudCards({ store, settings, workerStatus, onOpenEditor, onRetryMsg, onStopWorker, onCopyXml, onApproveProposal, onDismissProposal });
        });
        $card.on('click', '.vse-atlas-mode-btn', function () {
            view.atlasMode = String($(this).data('atlas-mode') || '3d');
            refreshAllHudCards({ store, settings, workerStatus, onOpenEditor, onRetryMsg, onStopWorker, onCopyXml, onApproveProposal, onDismissProposal });
        });
        $card.on('click', '.vse-poly-cutaway-btn', function (e) {
            e.stopPropagation();
            view.cutaway = !view.cutaway;
            refreshAllHudCards({ store, settings, workerStatus, onOpenEditor, onRetryMsg, onStopWorker, onCopyXml, onApproveProposal, onDismissProposal });
        });
        $card.on('click', '.vse-poly-labels-btn', function (e) {
            e.stopPropagation();
            view.showLabels = !view.showLabels;
            refreshAllHudCards({ store, settings, workerStatus, onOpenEditor, onRetryMsg, onStopWorker, onCopyXml, onApproveProposal, onDismissProposal });
        });
        $card.on('click', '.vse-atlas-room-g, .vse-atlas-room-pill', function () {
            view.roomId = $(this).data('room-id');
            refreshAllHudCards({ store, settings, workerStatus, onOpenEditor, onRetryMsg, onStopWorker, onCopyXml, onApproveProposal, onDismissProposal });
        });
        $card.on('click', '.vse-hud-approve-prop', function (e) {
            e.stopPropagation();
            onApproveProposal?.(String($(this).data('prop-id') || ''));
        });
        $card.on('click', '.vse-hud-dismiss-prop', function (e) {
            e.stopPropagation();
            onDismissProposal?.(String($(this).data('prop-id') || ''));
        });
        $card.on('click', '.vse-stop-btn', (e) => { e.stopPropagation(); onStopWorker?.(); });
        $card.on('click', '.vse-retry-btn, .vse-reread-btn', (e) => { e.stopPropagation(); onRetryMsg?.(mesId); });
        $card.on('click', '.vse-edit-btn', (e) => { e.stopPropagation(); onOpenEditor?.(mesId, view.tab); });
        $card.on('click', '.vse-copy-btn', (e) => {
            e.stopPropagation();
            const xml = serializeInternalStates(state, { scoped: false, includeVent: true });
            onCopyXml?.(xml);
        });
    });
}
