/**
 * Native JS Tabbed LPE HUD Renderer.
 *
 * - Never mutates msg.mes.
 * - Hides <lpe_tail> / <vexa_tail> residual text inside .mes_text cleanly as fallback to regex.
 * - Renders collapsible themed card beneath each AI message from store.getStateAt(seq),
 *   showing diff badges for sections changed that turn and live worker status.
 */

import { LPE_THEMES, LPE_STYLES, PALETTE, isEmptySentinel } from './schema.js';
import { serializeInternalStates } from './parser.js';
import { getMessageStamp } from './store.js';
import { renderAtlasTab, bindAtlasSvgControls } from './atlasSvg.js';
import { bindPolyOrbitControls, observePolyViewports } from './polyCss3d.js';
import { renderAetherMatrixList } from './matrixView.js';
import { computeTurnChangeLog, renderChangeLogStrip } from './changeLog.js';
import {
    renderHealthTab,
    computeHealthMetrics,
    inferHealthFromStatusText,
    hasExplicitHealthData,
    normalizeHealthState,
} from './healthDoll.js';

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
    { id: 'health', label: 'Health', icon: 'fa-kit-medical' },
    { id: 'custom_trackers', label: 'Trackers', icon: 'fa-chart-simple' },
    { id: 'proposals', label: 'Proposals', icon: 'fa-clipboard-check' },
    { id: 'story_notes', label: 'Notes', icon: 'fa-note-sticky' },
    { id: 'notebook', label: 'Notebook', icon: 'fa-book' },
    { id: 'vent', label: 'Vent', icon: 'fa-fire' },
];

// Per-message UI view state (scoped by chatId::uid to isolate across chats)
const viewState = new Map();

function currentChatKey() {
    const cid = typeof window !== 'undefined' ? window.SillyTavern?.getContext?.()?.chatId : '';
    return String(cid || '');
}

function currentUserName() {
    const u = typeof window !== 'undefined' ? window.SillyTavern?.getContext?.()?.name1 : '';
    return String(u || '').trim();
}

function getView(viewKey, defaults) {
    if (!viewState.has(viewKey)) {
        viewState.set(viewKey, {
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
            svgCamera: { zoom: 1, panX: 0, panY: 0 },
            healthLayer: 'body',
            healthPart: null,
            receiptOpen: false,
            receiptRaw: false,
            diffOpen: false,
            diffFilter: 'all',
            diffShowAll: false,
        });
    }
    return viewState.get(viewKey);
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

/** HUD tabs visible for the current state; Proposals appears only when pending. */
export function getVisibleHudTabs(stateOrProposalCount) {
    const count = typeof stateOrProposalCount === 'number'
        ? stateOrProposalCount
        : (stateOrProposalCount?.tracker_proposals?.length || 0);
    return HUD_TABS.filter((t) => t.id !== 'proposals' || count > 0);
}

/** Pending tracker/state proposals shown only in the dedicated Proposals tab. */
export function renderProposalCards(props) {
    if (!Array.isArray(props) || !props.length) return '';
    return `<div class="lpe-stack lpe-proposal-stack">${props.map((p) => {
        const kv = Object.entries(p.fields || {}).map(([k, v]) => `<b>${esc(k)}</b>=${esc(v)}`).join(' · ');
        return `<div class="lpe-subcard lpe-proposal-card">
            <div class="lpe-subcard-head">
                <span class="lpe-pill warn">Proposed Tracker</span>
                <strong>${esc(p.title)}</strong>
                <span class="lpe-proposal-actions">
                    <button type="button" class="lpe-mini-btn lpe-hud-approve-prop" data-prop-id="${esc(p.id)}" title="Approve tracker"><i class="fa-solid fa-check"></i> Approve</button>
                    <button type="button" class="lpe-mini-btn lpe-hud-dismiss-prop" data-prop-id="${esc(p.id)}" title="Dismiss proposal"><i class="fa-solid fa-xmark"></i> Dismiss</button>
                </span>
            </div>
            <div class="lpe-line">${kv}</div>
            ${p.reason ? `<div class="lpe-line"><span>Reason:</span> ${esc(p.reason)}</div>` : ''}
        </div>`;
    }).join('')}</div>`;
}

function renderTabBody(tabId, state, view, settings, prevState = null) {
    switch (tabId) {
        case 'world': {
            const w = state.world || {};
            return `<div class="lpe-kv-grid">
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
            if (!list.length) return `<div class="lpe-empty">No on-screen NPCs recorded.</div>`;
            return `<div class="lpe-cards-grid">${list.map((e) => {
                const es = (state.entity_state || []).find((x) => x.name.toLowerCase() === e.name.toLowerCase());
                const col = hexFromFontColor(es?.fontColor);
                return `<div class="lpe-subcard">
                    <div class="lpe-subcard-head">
                        <i class="lpe-dot" style="background:${col}"></i>
                        <strong>${esc(e.name)}</strong>
                        <span class="lpe-pill">${esc(e.salience)}</span>
                        <span class="lpe-pill">${esc(e.tfdy)}</span>
                        <button type="button" class="lpe-mini-btn lpe-hud-edit-char-btn" data-char-name="${esc(e.name)}" title="Edit character State, Personality, Bonds &amp; Location"><i class="fa-solid fa-user-pen"></i></button>
                    </div>
                    ${(e.status || es?.status) ? `<div class="lpe-line"><span>State:</span> ${esc(e.status || es?.status)}</div>` : ''}
                    <div class="lpe-line"><span>Emotion:</span> ${esc(e.parrott)}</div>
                    <div class="lpe-line"><span>Residual:</span> ${esc(e.residualMood)}</div>
                    <div class="lpe-line"><span>Agenda:</span> ${esc(e.agenda)}</div>
                    <div class="lpe-line"><span>Why:</span> ${esc(e.why)}</div>
                    <div class="lpe-line"><span>End / Move:</span> ${esc(e.end)} · ${esc(e.move)}</div>
                </div>`;
            }).join('')}</div>`;
        }
        case 'offscreen_agendas': {
            const list = state.offscreen_agendas || [];
            if (!list.length) return `<div class="lpe-empty">No off-screen NPCs recorded.</div>`;
            return `<div class="lpe-cards-grid">${list.map((e) => {
                const es = (state.entity_state || []).find((x) => x.name.toLowerCase() === e.name.toLowerCase());
                const col = hexFromFontColor(es?.fontColor);
                return `<div class="lpe-subcard">
                    <div class="lpe-subcard-head">
                        <i class="lpe-dot" style="background:${col}"></i>
                        <strong>${esc(e.name)}</strong>
                        <span class="lpe-pill">${esc(e.salience)}</span>
                        <span class="lpe-pill">${esc(e.tfdy)}</span>
                        ${(e.preGameStaged || es?.preGameStaged) ? '<span class="lpe-pill warn">Staged</span>' : ''}
                        <button type="button" class="lpe-mini-btn lpe-hud-edit-char-btn" data-char-name="${esc(e.name)}" title="Edit character State, Personality, Bonds &amp; Location"><i class="fa-solid fa-user-pen"></i></button>
                    </div>
                    ${(e.status || es?.status) ? `<div class="lpe-line"><span>State:</span> ${esc(e.status || es?.status)}</div>` : ''}
                    <div class="lpe-line"><span>Location:</span> ${esc(e.loc)}</div>
                    <div class="lpe-line"><span>Mood:</span> ${esc(e.mood)}</div>
                    <div class="lpe-line"><span>Agenda:</span> ${esc(e.agenda)}</div>
                    <div class="lpe-line"><span>Goal / End:</span> ${esc(e.goal)} (${esc(e.end)})</div>
                </div>`;
            }).join('')}</div>`;
        }
        case 'locations':
            return renderAtlasTab(state, {
                selectedMapId: view.mapId,
                selectedLevel: view.level,
                selectedRoomId: view.roomId,
                viewMode: view.atlasMode || '2d',
                allFloors: view.allFloors,
                cutaway: view.cutaway,
                showLabels: view.showLabels,
                camera: view.camera,
                svgCamera: view.svgCamera,
                allowWebgl: false,
                userName: currentUserName(),
            });
        case 'entityMem': {
            const list = state.entityMem || [];
            if (!list.length) return `<div class="lpe-empty">No entity memories recorded.</div>`;
            return `<div class="lpe-stack">${list.map((em) => `
                <div class="lpe-subcard">
                    <div class="lpe-subcard-head"><strong>${esc(em.name)}</strong><span class="lpe-pill">${em.entries.length}/20</span></div>
                    <ul class="lpe-list">${em.entries.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
                </div>
            `).join('')}</div>`;
        }
        case 'entity_state': {
            const list = state.entity_state || [];
            if (!list.length) return `<div class="lpe-empty">No entity profiles recorded.</div>`;
            return `<div class="lpe-cards-grid">${list.map((es) => {
                const col = hexFromFontColor(es.fontColor);
                return `<div class="lpe-subcard">
                    <div class="lpe-subcard-head">
                        <i class="lpe-dot" style="background:${col}"></i>
                        <strong>${esc(es.name)}</strong>
                        <span class="lpe-pill" style="border-color:${col};color:${col}">${esc(es.fontColor || 'unassigned')}</span>
                        ${es.preGameStaged ? '<span class="lpe-pill warn">Staged</span>' : ''}
                        <button type="button" class="lpe-mini-btn lpe-hud-edit-char-btn" data-char-name="${esc(es.name)}" title="Edit character State, Personality, Bonds &amp; Location"><i class="fa-solid fa-user-pen"></i></button>
                    </div>
                    ${es.status ? `<div class="lpe-line"><span>State:</span> ${esc(es.status)}</div>` : ''}
                    <div class="lpe-line"><span>Look:</span> ${esc(es.look)}</div>
                    <div class="lpe-line"><span>Voice:</span> ${esc(es.voice)}</div>
                    <div class="lpe-line"><span>Persona:</span> ${esc(es.persona)}</div>
                    <div class="lpe-line"><span>Private:</span> ${esc(es.private)}</div>
                </div>`;
            }).join('')}</div>`;
        }
        case 'thoughts': {
            const list = state.thoughts || [];
            if (!list.length) return `<div class="lpe-empty">No inner thoughts captured this turn.</div>`;
            return `<div class="lpe-cards-grid">${list.map((t) => `
                <div class="lpe-subcard">
                    <div class="lpe-subcard-head"><strong>${esc(t.name)}</strong></div>
                    <div class="lpe-line"><span>Goal:</span> ${esc(t.tQ1)}</div>
                    <div class="lpe-line"><span>Feeling:</span> ${esc(t.tQ2)}</div>
                    <div class="lpe-line"><span>Mind:</span> ${esc(t.tQ3)}</div>
                    <div class="lpe-line"><span>Why:</span> ${esc(t.tQ4)}</div>
                    <div class="lpe-line"><span>Unsaid:</span> ${esc(t.tQ5)}</div>
                </div>
            `).join('')}</div>`;
        }
        case 'dam': {
            const list = state.dam || [];
            if (!list.length) return `<div class="lpe-empty">No Aether Dam records.</div>`;
            return `<div class="lpe-cards-grid">${list.map((d) => `
                <div class="lpe-subcard">
                    <div class="lpe-subcard-head"><strong>${esc(d.pair)}</strong><span class="lpe-pill">${esc(d.sluice)}</span></div>
                    <div class="lpe-line"><span>Filters:</span> ${esc(d.filters)}</div>
                    <div class="lpe-line"><span>Misc:</span> ${esc(d.misc)}</div>
                    <div class="lpe-line"><span>Intent:</span> ${esc(d.intent)}</div>
                </div>
            `).join('')}</div>`;
        }
        case 'pair': {
            return renderAetherMatrixList(state.pair || [], prevState?.pair || null, { showGuide: true });
        }
        case 'tracks': {
            const tr = state.tracks || {};
            return `<div class="lpe-stack">
                <div class="lpe-subcard"><div class="lpe-subcard-head"><strong>Main Arc Track</strong></div><div>${esc(tr.main || '∅')}</div></div>
                ${(tr.tracks || []).map((x) => `<div class="lpe-subcard"><div class="lpe-subcard-head"><strong>Track</strong></div><div>${esc(x)}</div></div>`).join('')}
                ${(tr.history || []).length ? `<div class="lpe-subcard"><div class="lpe-subcard-head"><strong>History</strong></div><ul class="lpe-list">${tr.history.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
            </div>`;
        }
        case 'arc': {
            const a = state.arc || {};
            if (isEmptySentinel(a.info) && !a.ki?.length) return `<div class="lpe-empty">ARC Engine in Ki phase (no active ARC generated yet).</div>`;
            return `<div class="lpe-stack">
                <div class="lpe-subcard"><div><span>Info:</span> ${esc(a.info)}</div><div><span>Timeline:</span> ${esc(a.timeline)}</div></div>
                ${['ki', 'sho', 'ten', 'ketsu'].map((act) => `
                    <div class="lpe-subcard">
                        <div class="lpe-subcard-head"><strong>${act.toUpperCase()}</strong></div>
                        <ul class="lpe-list">${(a[act] || ['∅']).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
                    </div>
                `).join('')}
            </div>`;
        }
        case 'chekhov': {
            const ch = state.chekhov || {};
            return `<div class="lpe-stack">
                <div class="lpe-subcard"><div class="lpe-subcard-head"><strong>Chambered</strong><span class="lpe-pill">${(ch.chamber || []).length}/20</span></div><ul class="lpe-list">${(ch.chamber || []).length ? ch.chamber.map((b) => `<li>${esc(b)}</li>`).join('') : '<li>∅</li>'}</ul></div>
                <div class="lpe-subcard"><div class="lpe-subcard-head"><strong>Locked</strong><span class="lpe-pill">${(ch.locked || []).length}/20</span></div><ul class="lpe-list">${(ch.locked || []).length ? ch.locked.map((b) => `<li>${esc(b)}</li>`).join('') : '<li>∅</li>'}</ul></div>
                <div class="lpe-subcard"><div class="lpe-subcard-head"><strong>Fired This Turn</strong></div><ul class="lpe-list">${(ch.fired || []).length ? ch.fired.map((b) => `<li>${esc(b)}</li>`).join('') : '<li>∅</li>'}</ul></div>
            </div>`;
        }
        case 'inv': {
            const inv = state.inv || {};
            return `<div class="lpe-kv-grid">
                <div class="wide"><span>Inventory</span><b>${esc(inv.inv || '∅')}</b></div>
                <div class="wide"><span>Titles & Modifiers</span><b>${esc(inv.titles || '∅')}</b></div>
                <div class="wide"><span>Status & Conditions</span><b>${esc(inv.status || '∅')}</b></div>
            </div>`;
        }
        case 'health':
            return renderHealthTab(state, {
                layer: view.healthLayer,
                selectedPart: view.healthPart,
                bodyTypeOverride: settings?.defaultBodyType,
                compact: true,
                showActions: false,
            });
        case 'custom_trackers': {
            const active = (state.custom_trackers || []).filter((t) => t && !t.archived);
            const activeHtml = active.length
                ? `<div class="lpe-cards-grid">${active.map((t) => `
                    <div class="lpe-subcard">
                        <div class="lpe-subcard-head">
                            <strong>${esc(t.title)}</strong>
                            <span class="lpe-pill">${esc(t.id)}</span>
                        </div>
                        <div class="lpe-kv-grid">
                            ${Object.entries(t.fields || {}).map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
                        </div>
                        ${t.notes ? `<div class="lpe-line" style="margin-top:5px;"><span>Notes:</span> ${esc(t.notes)}</div>` : ''}
                    </div>
                `).join('')}</div>`
                : `<div class="lpe-empty">No custom trackers active. Main model can propose trackers for recurring businesses, estates, ships, or ledgers when enabled.</div>`;
            return activeHtml;
        }
        case 'proposals': {
            const props = state.tracker_proposals || [];
            if (!props.length) return `<div class="lpe-empty">No pending proposals. Main-model tracker/state proposals appear here for review.</div>`;
            return renderProposalCards(props);
        }
        case 'story_notes': {
            const sn = state.story_notes || {};
            return `<div class="lpe-kv-grid">
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
            if (!nb.length) return `<div class="lpe-empty">Notebook is empty.</div>`;
            return `<ul class="lpe-list">${nb.map((ent) => {
                const tagMatch = ent.match(/^\s*(\[[RTD]\])\s*([\s\S]*)$/);
                if (!tagMatch) return `<li>${esc(ent)}</li>`;
                const cls = tagMatch[1] === '[R]' ? 'rule' : tagMatch[1] === '[T]' ? 'thread' : 'debug';
                return `<li><span class="lpe-nb-badge ${cls}">${esc(tagMatch[1])}</span> ${esc(tagMatch[2])}</li>`;
            }).join('')}</ul>`;
        }
        case 'vent': {
            return `<div class="lpe-stack">
                <div class="lpe-subcard"><div class="lpe-subcard-head"><strong>LPE Vent</strong></div><div class="lpe-vent-text">${esc(state.vent || '∅')}</div></div>
            </div>`;
        }
        default:
            return '';
    }
}

export function parseReceiptSummaryPills(rc) {
    if (!rc) return '';
    const pills = [];
    const ws = String(rc.world_sim || '').trim();
    if (ws && !isEmptySentinel(ws)) {
        const firstTok = ws.split('|')[0].trim();
        if (firstTok) pills.push(`<span class="lpe-pill">${esc(firstTok.slice(0, 28))}</span>`);
    }
    const ch = String(rc.chekhov || '').trim();
    if (ch && !isEmptySentinel(ch) && ch !== '∅') {
        pills.push(`<span class="lpe-pill">${esc(ch.slice(0, 32))}</span>`);
    }
    // Pending tracker/state proposals live in the dedicated Proposals tab, not here.
    return pills.join('');
}

function renderReceiptDrawer(state, view) {
    const rc = state?.lastReceipt;
    if (!rc?.raw) return '';
    const open = Boolean(view.receiptOpen);
    const pills = parseReceiptSummaryPills(rc);
    const structuredRows = [
        rc.world_sim && !isEmptySentinel(rc.world_sim) ? `<div><span>world_sim</span><b>${esc(rc.world_sim)}</b></div>` : '',
        rc.chekhov && !isEmptySentinel(rc.chekhov) ? `<div><span>chekhov</span><b>${esc(rc.chekhov)}</b></div>` : '',
        rc.arc && !isEmptySentinel(rc.arc) ? `<div><span>arc</span><b>${esc(rc.arc)}</b></div>` : '',
        rc.ooc && !isEmptySentinel(rc.ooc) ? `<div><span>ooc</span><b>${esc(rc.ooc)}</b></div>` : '',
    ].filter(Boolean).join('');

    return `
        <div class="lpe-receipt-drawer ${open ? 'is-open' : ''}">
            <button type="button" class="lpe-receipt-head-btn" title="Show or hide main-model CoT Receipt (<lpe_receipt>)">
                <span class="lpe-receipt-title"><i class="fa-solid fa-receipt"></i> CoT Receipt</span>
                <span class="lpe-receipt-pills">${pills || '<span class="lpe-muted">raw</span>'}</span>
                <i class="fa-solid fa-chevron-${open ? 'up' : 'down'} lpe-receipt-caret"></i>
            </button>
            ${open ? `
                <div class="lpe-receipt-body${(view.receiptRaw || !structuredRows) ? ' show-raw' : ''}">
                    ${structuredRows ? `<div class="lpe-kv-grid lpe-receipt-kv">${structuredRows}</div><div class="lpe-receipt-body-bar"><button type="button" class="lpe-mini-btn lpe-receipt-raw-btn" title="Toggle raw <lpe_receipt> text">${view.receiptRaw ? 'Hide Raw' : 'Raw'}</button></div>` : ''}
                    <pre class="lpe-pre">${esc(rc.raw)}</pre>
                </div>
            ` : ''}
        </div>
    `;
}

function applyThemeVars($card, themeName) {
    const theme = LPE_THEMES[themeName] || LPE_THEMES['Magnum Opus'] || LPE_THEMES.Sola;
    for (const [k, v] of Object.entries(theme)) {
        if (k === 'scheme') $card.css('color-scheme', v);
        else $card.css(`--ist-${k}`, v);
    }
}

/**
 * Hide any un-regexed <lpe_tail> or legacy <vexa_tail> text inside .mes_text surgically WITHOUT calling `.html(...)`
 * or mutating msg.mes — preserves live sandboxed card iframes, listeners, and code blocks.
 */
export function hideLpeTailInMessageEl($mesText) {
    const rootEl = $mesText && ($mesText[0] || ($mesText.nodeType ? $mesText : null));
    if (!rootEl) return;

    const SKIP_TAGS = new Set(['PRE', 'CODE', 'IFRAME', 'SCRIPT', 'STYLE', 'TEXTAREA']);
    const isProtected = (node) => {
        for (let cur = node; cur && cur !== rootEl; cur = cur.parentElement) {
            if (SKIP_TAGS.has(cur.tagName)) return true;
            if (cur.classList?.contains('lpe-card-frame-wrap') || cur.classList?.contains('lpe-code-fold-toggle')) {
                return true;
            }
        }
        return false;
    };

    // Hide semantic custom tags (<lpe_tail>, <lpe_receipt>, legacy <vexa_*>, <state:vent>) directly via class
    for (const sel of ['lpe_tail', 'lpe_receipt', 'vexa_tail', 'vexa_receipt', 'state\\:vent']) {
        try {
            for (const el of rootEl.querySelectorAll(sel)) {
                if (!isProtected(el)) el.classList.add('lpe-hidden-tail');
            }
        } catch {
            // Ignore selector edge cases
        }
    }

    // Hide sanitized plain-text tail paragraphs (<p>world_sim: ...</p> etc.)
    for (const p of rootEl.querySelectorAll('p')) {
        if (isProtected(p)) continue;
        const txt = String(p.textContent || '').replace(/\u2800/g, ' ').trim();
        if (/^(?:world_sim:|chekhov:|arc:|ooc:|tracker_propose:|<(?:lpe|vexa)_tail>|<(?:lpe|vexa)_receipt>|<state:vent>)/i.test(txt)) {
            p.classList.add('lpe-hidden-tail');
        }
    }

    // Strip escaped or unparsed <lpe_tail> / <vexa_tail> inside leaf text nodes only
    const ownerDoc = rootEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const filter = typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_TEXT : 4;
    if (ownerDoc && typeof ownerDoc.createTreeWalker === 'function') {
        const walker = ownerDoc.createTreeWalker(rootEl, filter);
        let textNode = walker.nextNode();
        while (textNode) {
            const val = textNode.nodeValue;
            if (val && /<(?:lpe|vexa)_tail\b/i.test(val) && !isProtected(textNode.parentElement)) {
                const cleaned = val
                    .replace(/<(?:lpe|vexa)_tail\b[^>]*>[\s\S]*?<\/(?:lpe|vexa)_tail\s*>\s*(?:<!--[\s\u2800]*GFX_END[\s\u2800]*-->)?/gi, '')
                    .replace(/<(?:lpe|vexa)_tail\b[^>]*>[\s\S]*$/i, '');
                if (cleaned !== val) textNode.nodeValue = cleaned;
            }
            textNode = walker.nextNode();
        }
    }
}
export const hideVexaTailInMessageEl = hideLpeTailInMessageEl;

/**
 * Refresh HUD cards for all rendered AI messages currently in #chat.
 */
function refreshSingleHudCard($mes, ctx) {
    const {
        store,
        tl,
        settings,
        workerStatus,
        onOpenEditor,
        onRetryMsg,
        onStopWorker,
        onCopyXml,
        onApproveProposal,
        onDismissProposal,
        onToggleEntryDisabled,
    } = ctx;
    const chat = ctx.chat || window.SillyTavern?.getContext?.()?.chat || [];
    const mesId = Number($mes.attr('mesid'));
    if (!Number.isFinite(mesId) || !chat[mesId]) return;
    const msg = chat[mesId];
    if (msg.is_user) return;

    const $mesText = $mes.find('.mes_text').first();
    hideLpeTailInMessageEl($mesText);

    const { uid, seq } = getMessageStamp(msg);
    const swipe = typeof msg.swipe_id === 'number' ? msg.swipe_id : 0;
    const entry = uid ? store.getEntryFor(uid, swipe) : null;
    const step = uid ? store.getStep(uid, tl) : null;
    const latestState = ctx.latestState ?? (tl.steps.length ? tl.steps[tl.steps.length - 1].state : tl.base);
    const state = typeof seq === 'number' ? store.getStateAt(seq, tl) : latestState;

    // Don't attach HUD to greeting msg 0 unless it actually has state
    if (mesId === 0 && !entry && !store.hasState()) return;

    const viewKey = `${currentChatKey()}::${uid || `m_${mesId}`}`;
    const view = getView(viewKey, {
        defaultCollapsed: settings.hudDefaultCollapsed !== false,
        theme: settings.hudTheme || 'Magnum Opus',
        style: settings.hudStyle || 'Afterglow',
    });

    const isBusyForThis = Boolean(
        workerStatus?.busy
        && ((workerStatus.activeUid && uid && workerStatus.activeUid === uid)
            || (!workerStatus.activeUid && mesId === chat.length - 1)),
    );
    const proposals = state.tracker_proposals || [];
    const proposalCount = proposals.length;
    if (view.tab === 'proposals' && !proposalCount) view.tab = 'world';
    const proposalDigest = proposals.map((p) => `${p?.id || ''}:${p?.title || p?.label || ''}`).join(',');
    const trackerCount = (state.custom_trackers || []).filter((t) => t && !t.archived).length;
    const effectiveAtlasMode = view.atlasMode || '2d';
    const effHealth = hasExplicitHealthData(state.health)
        ? normalizeHealthState({ ...state.health, bodyType: state.health?.bodyType || settings.defaultBodyType || 'male' })
        : inferHealthFromStatusText(state.inv?.status || '', settings.defaultBodyType || state.health?.bodyType || 'male');
    const hMetrics = computeHealthMetrics(effHealth);
    const hasHealthAlert = hMetrics.totalWounds > 0
        || hMetrics.bloodLoss > 0
        || hMetrics.missingCount > 0
        || (effHealth.wholeBody || []).length > 0;
    const healthPillHtml = hasHealthAlert
        ? `<button type="button" class="lpe-mini-btn lpe-health-bar-pill ${hMetrics.bleedingCount > 0 ? 'bleeding' : (hMetrics.overallHp < 80 ? 'warn' : '')}" title="Inspect Body Health Doll"><i class="fa-solid fa-heart-pulse"></i> ${hMetrics.overallHp}%${hMetrics.totalWounds ? ` · ${hMetrics.totalWounds}w` : ''}</button>`
        : '';

    const changeLog = step
        ? computeTurnChangeLog(step.prevState, step.state, { entry, warnings: step.warnings })
        : null;
    const changeLogDigest = changeLog ? JSON.stringify([changeLog.items, changeLog.warnings]) : '';
    const showInlineChanges = settings.showInlineChanges !== false;
    const diffStr = (step?.diff || []).join(',');
    const activeTabDigest = view.collapsed
        ? ''
        : JSON.stringify([
            state?.[view.tab] ?? null,
            view.tab === 'locations' ? (state?.world?.user_pos || '') : null,
            view.tab === 'health' ? (state?.inv?.status || '') : null,
            view.tab === 'pair' ? (step?.prevState?.pair || null) : null,
        ]);

    const buildStamp = (v) => [
        uid || '',
        seq ?? '',
        swipe,
        state.world?.ct ?? 0,
        state.world?.loc || '',
        state.world?.time || '',
        v.collapsed ? '1' : '0',
        v.tab,
        v.theme,
        v.style,
        v.mapId || '',
        v.level || '',
        v.roomId || '',
        effectiveAtlasMode,
        v.allFloors ? '1' : '0',
        v.cutaway ? '1' : '0',
        v.showLabels ? '1' : '0',
        v.receiptOpen ? '1' : '0',
        v.receiptRaw ? '1' : '0',
        v.diffOpen ? '1' : '0',
        v.diffFilter || 'all',
        v.diffShowAll ? '1' : '0',
        v.healthLayer || 'body',
        v.healthPart || '',
        `${hMetrics.overallHp}:${hMetrics.totalWounds}:${hMetrics.bleedingCount}:${hMetrics.bloodLoss}:${settings.defaultBodyType || 'male'}`,
        entry?.status || '',
        entry?.source || '',
        entry?.error || '',
        entry?.disabled ? '1' : '0',
        showInlineChanges ? '1' : '0',
        isBusyForThis ? (workerStatus?.runningLabel || 'busy') : 'idle',
        trackerCount,
        proposalCount,
        proposalDigest,
        changeLogDigest,
        state.lastReceipt?.raw || '',
        diffStr,
        activeTabDigest,
    ].join('|');

    const stamp = buildStamp(view);

    let $card = $mes.find('.lpe-hud-card').first();
    if ($card.length) {
        $card.data('lpeLiveCtx', { ctx, state, view, mesId, buildStamp });
        if ($card.attr('data-lpe-stamp') === stamp) return;
    }

    if (!$card.length) {
        $card = $('<div class="lpe-hud-card"></div>');
        if ($mesText.length) $mesText.after($card);
        else $mes.find('.mes_block').append($card);
        $card.data('lpeLiveCtx', { ctx, state, view, mesId, buildStamp });
    }

    const diffSet = new Set(step?.diff || []);
    const statusBadge = isBusyForThis
        ? `<span class="lpe-status busy"><i class="fa-solid fa-spinner fa-spin"></i> ${esc(workerStatus.runningLabel || 'Updating...')} <button type="button" class="lpe-mini-btn lpe-stop-btn" title="Stop worker"><i class="fa-solid fa-stop"></i></button></span>`
        : entry?.status === 'error'
            ? `<span class="lpe-status err" title="${esc(entry.error || 'Worker failed')}"><i class="fa-solid fa-triangle-exclamation"></i> Failed <button type="button" class="lpe-mini-btn lpe-retry-btn"><i class="fa-solid fa-rotate-right"></i> Retry</button></span>`
            : entry?.status === 'pending'
                ? `<span class="lpe-status busy"><i class="fa-solid fa-clock"></i> Queued</span>`
                : `<span class="lpe-status ok"><i class="fa-solid fa-circle-check"></i> ${entry?.source === 'import' ? 'Imported' : 'Synced'}</span>`;

    const themeOpts = Object.keys(LPE_THEMES).map((t) =>
        `<option value="${esc(t)}" ${t === view.theme ? 'selected' : ''}>${esc(t)}</option>`,
    ).join('');

    const tabsHtml = getVisibleHudTabs(proposalCount)
        .map((t) => {
            const isProposals = t.id === 'proposals';
            const tabCnt = changeLog?.byTab?.[t.id] || 0;
            const hasDiff = diffSet.has(t.id);
            const badge = isProposals
                ? `<span class="lpe-tab-diff-cnt lpe-proposals-count" title="${proposalCount} pending proposal${proposalCount === 1 ? '' : 's'}">${proposalCount}</span>`
                : (tabCnt > 0
                    ? `<span class="lpe-tab-diff-cnt" title="${tabCnt} change${tabCnt === 1 ? '' : 's'} this turn">${tabCnt}</span>`
                    : (hasDiff ? '<span class="lpe-diff-dot" title="Changed this turn"></span>' : ''));
            return `<button type="button" class="lpe-tab-btn ${isProposals ? 'lpe-proposals-tab' : ''} ${view.tab === t.id ? 'active' : ''}" data-tab="${t.id}">
            <i class="fa-solid ${t.icon}"></i> ${esc(t.label)}${badge}
        </button>`;
        }).join('');

    const changeHeaderBadge = entry?.disabled
        ? '<span class="lpe-pill warn" title="Changes from this reply are reverted">Reverted</span>'
        : (changeLog?.total
            ? `<span class="lpe-pill lpe-diff-hdr-pill" title="${changeLog.total} changes in this reply">Δ ${changeLog.total}</span>`
            : '');

    const diffStripHtml = showInlineChanges
        ? renderChangeLogStrip(changeLog, {
            entry,
            isOpen: view.diffOpen,
            filterMode: view.diffFilter || 'all',
            showAll: Boolean(view.diffShowAll),
            activeTab: view.tab,
            canToggle: Boolean(onToggleEntryDisabled && entry),
            canRead: Boolean(onRetryMsg),
        })
        : '';

    $card
        .attr('data-lpe-stamp', stamp)
        .attr('data-lpe-style', view.style)
        .attr('data-lpe-mesid', String(mesId));
    applyThemeVars($card, view.theme);

    $card.html(`
        <div class="lpe-hud-bar">
            <button type="button" class="lpe-toggle-btn">
                <i class="fa-solid fa-chevron-${view.collapsed ? 'right' : 'down'}"></i>
                <span class="lpe-hud-title"><span class="lpe-ornament" aria-hidden="true">✦</span> LPE State</span>
                <span class="lpe-pill">ct:${esc(state.world?.ct ?? 0)}</span>
                <span class="lpe-hud-loc">${esc(state.world?.loc || 'No location')}</span>
                <span class="lpe-hud-time">${esc(state.world?.time || '')}</span>
            </button>
            <div class="lpe-hud-actions">
                ${changeHeaderBadge}
                ${healthPillHtml}
                ${statusBadge}
                <button type="button" class="lpe-icon-btn lpe-reread-btn" title="Re-run worker on this reply"><i class="fa-solid fa-rotate"></i></button>
                <button type="button" class="lpe-icon-btn lpe-edit-btn" title="Edit LPE state"><i class="fa-solid fa-pen-to-square"></i></button>
                <button type="button" class="lpe-icon-btn lpe-copy-btn" title="Copy compiled <internal_states> XML"><i class="fa-solid fa-copy"></i></button>
            </div>
        </div>
        <div class="lpe-hud-body" style="display:${view.collapsed ? 'none' : 'block'};">
            <div class="lpe-subtoolbar">
                <label>Theme: <select class="lpe-theme-sel">${themeOpts}</select></label>
                <label>Style: <select class="lpe-style-sel">${LPE_STYLES.map((st) => `<option value="${esc(st)}" ${st === view.style ? 'selected' : ''}>${esc(st)}</option>`).join('')}</select></label>
            </div>
            ${diffStripHtml}
            <div class="lpe-tabs">${tabsHtml}</div>
            <div class="lpe-tab-panel">${view.collapsed ? '' : renderTabBody(view.tab, state, view, settings, step?.prevState || null)}</div>
        </div>
        ${renderReceiptDrawer(state, view)}
    `);

    if (!view.collapsed) {
        const tabsEl = $card.find('.lpe-tabs')[0];
        const activeBtn = tabsEl?.querySelector('.lpe-tab-btn.active');
        if (tabsEl && activeBtn && tabsEl.scrollWidth > tabsEl.clientWidth) {
            tabsEl.scrollLeft = Math.max(0, activeBtn.offsetLeft - (tabsEl.clientWidth - activeBtn.offsetWidth) / 2);
        }
    }

    if (!view.collapsed && view.tab === 'locations') {
        if (effectiveAtlasMode === '3d') {
            const vpEl = $card.find('.lpe-poly-viewport')[0];
            if (vpEl) {
                bindPolyOrbitControls(vpEl, view.camera, {
                    onSelectRoom: (roomId) => {
                        const $wrapMes = $card.closest('.mes');
                        const live = $card.data('lpeLiveCtx');
                        if (live) live.view.roomId = roomId;
                        refreshCardFromDom($card, $wrapMes);
                    },
                });
                observePolyViewports(vpEl);
            }
        } else if (effectiveAtlasMode === '2d') {
            const svgWrapEl = $card.find('.lpe-atlas-svg-wrap')[0];
            if (svgWrapEl) bindAtlasSvgControls(svgWrapEl, view.svgCamera);
        }
    }

    ensureChatHudDelegation();
}

let delegatedHudRoot = null;

function resolveLiveFromEl(el) {
    const $el = $(el);
    const $card = $el.closest('.lpe-hud-card');
    if (!$card.length) return { $el, $card, $mes: $(), live: null, mesId: NaN };
    const $mes = $card.closest('.mes');
    const live = $card.data('lpeLiveCtx') || null;
    const domMesId = Number($mes.attr('mesid'));
    const cardMesId = Number($card.attr('data-lpe-mesid'));
    const mesId = Number.isFinite(domMesId) ? domMesId : (Number.isFinite(cardMesId) ? cardMesId : live?.mesId);
    if (live && Number.isFinite(mesId)) live.mesId = mesId;
    return { $el, $card, $mes, live, mesId };
}

function refreshCardFromDom($card, $mes) {
    const live = $card?.data?.('lpeLiveCtx');
    if (!live) return;
    const freshChat = (typeof window !== 'undefined' ? window.SillyTavern?.getContext?.()?.chat : null) || live.ctx.chat;
    const freshTl = live.ctx.store.timeline();
    const freshLatest = freshTl.steps.length ? freshTl.steps[freshTl.steps.length - 1].state : freshTl.base;
    const targetMes = $mes?.length ? $mes : $card.closest('.mes');
    refreshSingleHudCard(targetMes, { ...live.ctx, chat: freshChat, tl: freshTl, latestState: freshLatest });
    observePolyViewports($card[0]);
}

export function ensureChatHudDelegation() {
    if (typeof $ !== 'function' || typeof document === 'undefined') return;
    const chatRoot = document.getElementById('chat') || document;
    if (delegatedHudRoot === chatRoot) return;
    if (delegatedHudRoot) {
        try { $(delegatedHudRoot).off('.lpeHud'); } catch { /* ignore */ }
    }
    delegatedHudRoot = chatRoot;
    const $root = $(chatRoot);

    $root.on('click.lpeHud', '.lpe-hud-card .lpe-toggle-btn', function () {
        const { $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.collapsed = !live.view.collapsed;
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-tab-btn', function () {
        const { $el, $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.tab = $el.data('tab');
        refreshCardFromDom($card, $mes);
    });
    $root.on('change.lpeHud', '.lpe-hud-card .lpe-theme-sel', function () {
        const { $el, $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.theme = $el.val();
        refreshCardFromDom($card, $mes);
    });
    $root.on('change.lpeHud', '.lpe-hud-card .lpe-style-sel', function () {
        const { $el, $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.style = $el.val();
        refreshCardFromDom($card, $mes);
    });
    $root.on('change.lpeHud', '.lpe-hud-card .lpe-atlas-map-sel', function () {
        const { $el, $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.mapId = $el.val();
        live.view.level = null;
        live.view.roomId = null;
        live.view.svgCamera = { zoom: 1, panX: 0, panY: 0 };
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-atlas-floor-btn', function () {
        const { $el, $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.level = String($el.data('level'));
        live.view.allFloors = false;
        live.view.roomId = null;
        live.view.svgCamera = { zoom: 1, panX: 0, panY: 0 };
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-atlas-allfloors-btn', function () {
        const { $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.allFloors = !live.view.allFloors;
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-atlas-mode-btn:not(.lpe-atlas-open-webgl-btn)', function () {
        const { $el, $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.atlasMode = String($el.data('atlas-mode') || '2d');
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-atlas-open-webgl-btn', function (e) {
        e.stopPropagation();
        const { live, mesId } = resolveLiveFromEl(this);
        live?.ctx?.onOpenEditor?.(mesId, 'locations');
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-poly-cutaway-btn', function (e) {
        e.stopPropagation();
        const { $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.cutaway = !live.view.cutaway;
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-poly-labels-btn', function (e) {
        e.stopPropagation();
        const { $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.showLabels = !live.view.showLabels;
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-atlas-room-g, .lpe-hud-card .lpe-atlas-room-pill', function () {
        const { $el, $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.roomId = $el.data('room-id');
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-hud-approve-prop', function (e) {
        e.stopPropagation();
        const { $el, live } = resolveLiveFromEl(this);
        live?.ctx?.onApproveProposal?.(String($el.data('prop-id') || ''));
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-hud-dismiss-prop', function (e) {
        e.stopPropagation();
        const { $el, live } = resolveLiveFromEl(this);
        live?.ctx?.onDismissProposal?.(String($el.data('prop-id') || ''));
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-doll-part', function (e) {
        e.stopPropagation();
        const { $el, $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        const pid = String($el.data('part-id') || '');
        live.view.healthPart = live.view.healthPart === pid ? null : (pid || null);
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-health-part-chip', function (e) {
        e.stopPropagation();
        const { $el, $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.healthPart = String($el.data('part-id') || '') || null;
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-health-clear-sel', function (e) {
        e.stopPropagation();
        const { $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.healthPart = null;
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-health-layer-btn, .lpe-hud-card .lpe-doll-internal-alert', function (e) {
        e.stopPropagation();
        const { $el, $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.healthLayer = String($el.data('health-layer') || $el.data('layer-jump') || 'body');
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-health-bar-pill, .lpe-hud-card .lpe-health-jump-btn', function (e) {
        e.stopPropagation();
        const { $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.collapsed = false;
        live.view.tab = 'health';
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-stop-btn', function (e) {
        e.stopPropagation();
        resolveLiveFromEl(this).live?.ctx?.onStopWorker?.();
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-retry-btn, .lpe-hud-card .lpe-reread-btn', function (e) {
        e.stopPropagation();
        const { live, mesId } = resolveLiveFromEl(this);
        live?.ctx?.onRetryMsg?.(mesId);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-edit-btn', function (e) {
        e.stopPropagation();
        const { live, mesId } = resolveLiveFromEl(this);
        live?.ctx?.onOpenEditor?.(mesId, live.view.tab);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-hud-edit-char-btn', function (e) {
        e.stopPropagation();
        const { $el, live, mesId } = resolveLiveFromEl(this);
        const charName = String($el.data('char-name') || '').trim();
        live?.ctx?.onOpenEditor?.(mesId, live.view.tab, charName || null);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-copy-btn', function (e) {
        e.stopPropagation();
        const { live } = resolveLiveFromEl(this);
        if (!live) return;
        const xml = serializeInternalStates(live.state, { scoped: false, includeVent: true });
        live.ctx?.onCopyXml?.(xml);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-receipt-head-btn', function (e) {
        e.stopPropagation();
        const { $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.receiptOpen = !live.view.receiptOpen;
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-receipt-raw-btn', function (e) {
        e.stopPropagation();
        const { $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.receiptRaw = !live.view.receiptRaw;
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-diff-head-btn', function (e) {
        e.stopPropagation();
        const { $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.diffOpen = !live.view.diffOpen;
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-diff-filter-btn', function (e) {
        e.stopPropagation();
        const { $el, $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.diffFilter = String($el.data('diff-filter') || 'all');
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-diff-more-btn', function (e) {
        e.stopPropagation();
        const { $el, $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.diffShowAll = String($el.data('diff-all')) === '1';
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-diff-jump', function (e) {
        e.stopPropagation();
        const { $el, $card, $mes, live } = resolveLiveFromEl(this);
        if (!live) return;
        live.view.collapsed = false;
        live.view.tab = String($el.data('diff-jump') || 'world');
        refreshCardFromDom($card, $mes);
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-diff-revert-btn', function (e) {
        e.stopPropagation();
        const { $el, live, mesId } = resolveLiveFromEl(this);
        live?.ctx?.onToggleEntryDisabled?.(mesId, String($el.data('diff-toggle')) === '1');
    });
    $root.on('click.lpeHud', '.lpe-hud-card .lpe-diff-read-btn', function (e) {
        e.stopPropagation();
        const { live, mesId } = resolveLiveFromEl(this);
        live?.ctx?.onRetryMsg?.(mesId);
    });
}

/**
 * Rapidly align every currently mounted HUD card (and per-message viewState)
 * to the chosen theme & style in-place without tearing down/rebuilding DOM.
 */
export function alignAllHudThemes(theme, style) {
    const nextTheme = LPE_THEMES[theme] ? theme : 'Magnum Opus';
    const nextStyle = LPE_STYLES.includes(style) ? style : 'Afterglow';
    const activePrefix = `${currentChatKey()}::`;
    for (const [k, v] of viewState.entries()) {
        if (String(k).startsWith(activePrefix)) {
            v.theme = nextTheme;
            v.style = nextStyle;
        }
    }
    let updated = 0;
    if (typeof $ === 'function') {
        $('#chat .lpe-hud-card').each(function () {
            const $card = $(this);
            const live = $card.data('lpeLiveCtx');
            if (live?.view) {
                live.view.theme = nextTheme;
                live.view.style = nextStyle;
            }
            applyThemeVars($card, nextTheme);
            $card.attr('data-lpe-style', nextStyle);
            $card.find('.lpe-theme-sel').val(nextTheme);
            $card.find('.lpe-style-sel').val(nextStyle);
            if (live?.buildStamp && live?.view) {
                $card.attr('data-lpe-stamp', live.buildStamp(live.view));
            }
            updated++;
        });
    }
    return updated;
}

export function refreshAllHudCards({ store, settings, workerStatus, onOpenEditor, onRetryMsg, onStopWorker, onCopyXml, onApproveProposal, onDismissProposal, onToggleEntryDisabled }) {
    ensureChatHudDelegation();
    if (!store || !settings.enabled) {
        $('#chat .lpe-hud-card').remove();
        return;
    }
    const chat = window.SillyTavern?.getContext?.()?.chat || [];
    const tl = store.timeline();
    const latestState = tl.steps.length ? tl.steps[tl.steps.length - 1].state : tl.base;
    const sharedCtx = {
        chat,
        tl,
        latestState,
        store,
        settings,
        workerStatus,
        onOpenEditor,
        onRetryMsg,
        onStopWorker,
        onCopyXml,
        onApproveProposal,
        onDismissProposal,
        onToggleEntryDisabled,
    };
    $('#chat .mes').each(function () {
        refreshSingleHudCard($(this), sharedCtx);
    });
    const chatRoot = typeof document !== 'undefined' ? (document.getElementById('chat') || document) : null;
    observePolyViewports(chatRoot);
}
