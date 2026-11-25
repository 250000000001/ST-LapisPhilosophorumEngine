/**
 * Interactive Modal State Editor for Vexa State Engine.
 * Allows editing any of the 16 state sections (plus Raw JSON) and saving as a
 * persistent user edit entry in the journaled state store.
 */

import { PALETTE, cloneState, emptyState } from './schema.js';
import { computeBbox, parseOccupantsList, formatOccupantsList } from './reducer.js';

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const EDITOR_TABS = [
    { id: 'world', label: 'World' },
    { id: 'entity_state', label: 'Entities' },
    { id: 'onscreen', label: 'On-Screen' },
    { id: 'offscreen_agendas', label: 'Off-Screen' },
    { id: 'locations', label: 'Atlas' },
    { id: 'notebook', label: 'Notebook' },
    { id: 'chekhov', label: 'Chekhov' },
    { id: 'inv', label: 'Inv & Notes' },
    { id: 'pair_dam', label: 'Pair & Dam' },
    { id: 'tracks_arc', label: 'Tracks & ARC' },
    { id: 'raw', label: 'Raw JSON' },
];

export function openStateEditorModal({ store, seq = null, onSaved = () => {} }) {
    $('#vse_editor_overlay').remove();

    const baseState = typeof seq === 'number' ? store.getStateAt(seq) : store.getState();
    let draft = cloneState(baseState || emptyState());
    let activeTab = 'world';

    const $overlay = $(`
        <div id="vse_editor_overlay" class="vse-modal-overlay">
            <div class="vse-modal">
                <div class="vse-modal-header">
                    <h3><i class="fa-solid fa-pen-to-square"></i> Vexa State Editor <small>(ct: <span id="vse_ed_ct">${esc(draft.world?.ct ?? 0)}</span>)</small></h3>
                    <button type="button" class="vse-icon-btn vse-ed-close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="vse-modal-tabs">
                    ${EDITOR_TABS.map((t) => `<button type="button" class="vse-ed-tab ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}
                </div>
                <div class="vse-modal-body" id="vse_ed_body"></div>
                <div class="vse-modal-footer">
                    <span class="vse-muted" id="vse_ed_err" style="color:#f38ba8;"></span>
                    <button type="button" class="menu_button vse-ed-close">Cancel</button>
                    <button type="button" class="menu_button vse-btn-primary" id="vse_ed_save"><i class="fa-solid fa-floppy-disk"></i> Save Edit</button>
                </div>
            </div>
        </div>
    `);

    $('body').append($overlay);

    function collectCurrentTab() {
        const $b = $overlay.find('#vse_ed_body');
        $('#vse_ed_err').text('');
        try {
            if (activeTab === 'world') {
                draft.world.ct = parseInt($b.find('[data-w="ct"]').val(), 10) || 0;
                for (const k of ['loc', 'time', 'date', 'weather', 'room', 'user_pos', 'entries', 'obstacles', 'audio', 'pacing']) {
                    draft.world[k] = String($b.find(`[data-w="${k}"]`).val() ?? '');
                }
                $overlay.find('#vse_ed_ct').text(draft.world.ct);
            } else if (activeTab === 'inv') {
                for (const k of ['inv', 'titles', 'status']) {
                    draft.inv[k] = String($b.find(`[data-inv="${k}"]`).val() ?? '');
                }
                for (const k of ['threads', 'seeds', 'motives', 'horizon', 'GremlinNote', 'heckle']) {
                    draft.story_notes[k] = String($b.find(`[data-sn="${k}"]`).val() ?? '');
                }
                draft.vent = String($b.find('[data-vent]').val() ?? '');
            } else if (activeTab === 'notebook') {
                const raw = String($b.find('#vse_ed_notebook_txt').val() ?? '');
                draft.notebook = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 20);
            } else if (activeTab === 'chekhov') {
                for (const b of ['chamber', 'locked', 'fired']) {
                    const txt = String($b.find(`[data-chekhov="${b}"]`).val() ?? '');
                    draft.chekhov[b] = txt.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l !== '∅');
                }
            } else if (activeTab === 'entity_state') {
                const rows = [];
                $b.find('.vse-ed-es-row').each(function () {
                    const name = String($(this).find('[data-es="name"]').val() ?? '').trim();
                    if (!name) return;
                    rows.push({
                        name,
                        fontColor: String($(this).find('[data-es="fontColor"]').val() ?? ''),
                        look: String($(this).find('[data-es="look"]').val() ?? ''),
                        voice: String($(this).find('[data-es="voice"]').val() ?? ''),
                        persona: String($(this).find('[data-es="persona"]').val() ?? ''),
                        private: String($(this).find('[data-es="private"]').val() ?? ''),
                    });
                });
                draft.entity_state = rows;
            } else if (activeTab === 'onscreen') {
                draft.onscreen = JSON.parse(String($b.find('#vse_ed_json_sec').val() || '[]'));
            } else if (activeTab === 'offscreen_agendas') {
                draft.offscreen_agendas = JSON.parse(String($b.find('#vse_ed_json_sec').val() || '[]'));
            } else if (activeTab === 'locations') {
                const parsed = JSON.parse(String($b.find('#vse_ed_json_sec').val() || '{}'));
                for (const r of parsed.rooms || []) {
                    const box = computeBbox(r.grid, r.dim);
                    if (box) r.bbox = box.str;
                }
                draft.locations = parsed;
            } else if (activeTab === 'pair_dam') {
                const parsed = JSON.parse(String($b.find('#vse_ed_json_sec').val() || '{}'));
                if (Array.isArray(parsed.pair)) draft.pair = parsed.pair;
                if (Array.isArray(parsed.dam)) draft.dam = parsed.dam;
            } else if (activeTab === 'tracks_arc') {
                const parsed = JSON.parse(String($b.find('#vse_ed_json_sec').val() || '{}'));
                if (parsed.tracks) draft.tracks = parsed.tracks;
                if (parsed.arc) draft.arc = parsed.arc;
            } else if (activeTab === 'raw') {
                draft = JSON.parse(String($b.find('#vse_ed_json_sec').val() || '{}'));
            }
            return true;
        } catch (err) {
            $('#vse_ed_err').text(`Invalid syntax: ${err.message}`);
            return false;
        }
    }

    function renderTab() {
        const $b = $overlay.find('#vse_ed_body');
        if (activeTab === 'world') {
            const w = draft.world || {};
            $b.html(`<div class="vse-ed-grid">
                <label>ct <input type="number" class="text_pole" data-w="ct" value="${esc(w.ct)}"></label>
                <label>Pacing <select class="text_pole" data-w="pacing">
                    ${['SLOW', 'FLOW', 'PUSH'].map((p) => `<option value="${p}" ${w.pacing === p ? 'selected' : ''}>${p}</option>`).join('')}
                </select></label>
                <label>Location <input type="text" class="text_pole" data-w="loc" value="${esc(w.loc)}"></label>
                <label>Time <input type="text" class="text_pole" data-w="time" value="${esc(w.time)}"></label>
                <label>Date <input type="text" class="text_pole" data-w="date" value="${esc(w.date)}"></label>
                <label>Weather <input type="text" class="text_pole" data-w="weather" value="${esc(w.weather)}"></label>
                <label>User Pos <input type="text" class="text_pole" data-w="user_pos" value="${esc(w.user_pos)}"></label>
                <label class="wide">Room <textarea class="text_pole" rows="2" data-w="room">${esc(w.room)}</textarea></label>
                <label class="wide">Entries <textarea class="text_pole" rows="2" data-w="entries">${esc(w.entries)}</textarea></label>
                <label class="wide">Obstacles <textarea class="text_pole" rows="2" data-w="obstacles">${esc(w.obstacles)}</textarea></label>
                <label class="wide">Audio <textarea class="text_pole" rows="2" data-w="audio">${esc(w.audio)}</textarea></label>
            </div>`);
        } else if (activeTab === 'inv') {
            $b.html(`<div class="vse-ed-grid">
                <label class="wide">Inventory <textarea class="text_pole" rows="2" data-inv="inv">${esc(draft.inv?.inv)}</textarea></label>
                <label class="wide">Titles <input type="text" class="text_pole" data-inv="titles" value="${esc(draft.inv?.titles)}"></label>
                <label class="wide">Status <textarea class="text_pole" rows="2" data-inv="status">${esc(draft.inv?.status)}</textarea></label>
                <label class="wide">Threads <textarea class="text_pole" rows="2" data-sn="threads">${esc(draft.story_notes?.threads)}</textarea></label>
                <label class="wide">Seeds <textarea class="text_pole" rows="2" data-sn="seeds">${esc(draft.story_notes?.seeds)}</textarea></label>
                <label class="wide">Motives <textarea class="text_pole" rows="2" data-sn="motives">${esc(draft.story_notes?.motives)}</textarea></label>
                <label class="wide">Horizon <textarea class="text_pole" rows="2" data-sn="horizon">${esc(draft.story_notes?.horizon)}</textarea></label>
                <label class="wide">GremlinNote <textarea class="text_pole" rows="2" data-sn="GremlinNote">${esc(draft.story_notes?.GremlinNote)}</textarea></label>
                <label class="wide">Heckle <textarea class="text_pole" rows="2" data-sn="heckle">${esc(draft.story_notes?.heckle)}</textarea></label>
                <label class="wide">Vent <textarea class="text_pole" rows="2" data-vent="1">${esc(draft.vent)}</textarea></label>
            </div>`);
        } else if (activeTab === 'notebook') {
            $b.html(`
                <div class="vse-ed-inline-add">
                    <input type="text" id="vse_ed_new_rule" class="text_pole" placeholder="Quick-add [R] rule (e.g. [R] Keep responses punchy)">
                    <button type="button" class="menu_button" id="vse_ed_add_rule_btn">Add [R]</button>
                </div>
                <label class="wide">One entry per line (newest at top, max 20; [R] rules pinned):
                    <textarea id="vse_ed_notebook_txt" class="text_pole" rows="12">${esc((draft.notebook || []).join('\n'))}</textarea>
                </label>
            `);
            $b.find('#vse_ed_add_rule_btn').on('click', () => {
                const val = String($b.find('#vse_ed_new_rule').val() || '').trim();
                if (!val) return;
                const formatted = /^\s*\[[RTD]\]/i.test(val) ? val : `[R] ${val}`;
                const cur = String($b.find('#vse_ed_notebook_txt').val() || '').trim();
                $b.find('#vse_ed_notebook_txt').val(cur ? `${formatted}\n${cur}` : formatted);
                $b.find('#vse_ed_new_rule').val('');
            });
        } else if (activeTab === 'chekhov') {
            $b.html(`<div class="vse-ed-grid">
                <label class="wide">Chamber (one bullet per line)<textarea class="text_pole" rows="5" data-chekhov="chamber">${esc((draft.chekhov?.chamber || []).join('\n'))}</textarea></label>
                <label class="wide">Locked (one bullet per line)<textarea class="text_pole" rows="5" data-chekhov="locked">${esc((draft.chekhov?.locked || []).join('\n'))}</textarea></label>
                <label class="wide">Fired (one bullet per line)<textarea class="text_pole" rows="3" data-chekhov="fired">${esc((draft.chekhov?.fired || []).join('\n'))}</textarea></label>
            </div>`);
        } else if (activeTab === 'entity_state') {
            const colorOptions = (selected) => {
                const selLow = String(selected || '').toLowerCase();
                return ['<option value="">(Unassigned)</option>', ...PALETTE.map((p) => {
                    const val = `${p.name} ${p.hex}`;
                    const isSel = selLow.includes(p.name) || selLow.includes(p.hex.toLowerCase());
                    return `<option value="${esc(val)}" ${isSel ? 'selected' : ''}>${esc(val)}</option>`;
                })].join('');
            };
            const rowsHtml = (draft.entity_state || []).map((es, idx) => `
                <div class="vse-ed-es-row" data-idx="${idx}">
                    <div class="vse-ed-es-top">
                        <input type="text" class="text_pole" data-es="name" value="${esc(es.name)}" placeholder="Name">
                        <select class="text_pole" data-es="fontColor">${colorOptions(es.fontColor)}</select>
                        <button type="button" class="menu_button vse-ed-del-es" title="Delete NPC"><i class="fa-solid fa-trash"></i></button>
                    </div>
                    <input type="text" class="text_pole" data-es="look" value="${esc(es.look)}" placeholder="Look">
                    <input type="text" class="text_pole" data-es="voice" value="${esc(es.voice)}" placeholder="Voice">
                    <input type="text" class="text_pole" data-es="persona" value="${esc(es.persona)}" placeholder="Persona">
                    <input type="text" class="text_pole" data-es="private" value="${esc(es.private)}" placeholder="Private">
                </div>
            `).join('');
            $b.html(`
                <div style="margin-bottom:8px;"><button type="button" class="menu_button" id="vse_ed_add_es"><i class="fa-solid fa-plus"></i> Add Entity</button></div>
                <div id="vse_ed_es_list">${rowsHtml}</div>
            `);
            $b.on('click', '.vse-ed-del-es', function () {
                $(this).closest('.vse-ed-es-row').remove();
            });
            $b.find('#vse_ed_add_es').on('click', () => {
                collectCurrentTab();
                draft.entity_state.push({ name: 'New NPC', fontColor: '', look: '', voice: '', persona: '', private: '' });
                renderTab();
            });
        } else {
            let obj = draft;
            let hint = 'Full canonical JSON';
            if (activeTab === 'onscreen') { obj = draft.onscreen; hint = 'On-screen NPCs array'; }
            else if (activeTab === 'offscreen_agendas') { obj = draft.offscreen_agendas; hint = 'Off-screen agendas array'; }
            else if (activeTab === 'locations') { obj = draft.locations; hint = 'Atlas map_index & rooms (bbox auto-recomputed on save)'; }
            else if (activeTab === 'pair_dam') { obj = { pair: draft.pair, dam: draft.dam }; hint = 'Aether Pair & Dam arrays'; }
            else if (activeTab === 'tracks_arc') { obj = { tracks: draft.tracks, arc: draft.arc }; hint = 'Tracks & ARC objects'; }
            $b.html(`
                <div class="vse-muted" style="margin-bottom:6px;">${esc(hint)}</div>
                <textarea id="vse_ed_json_sec" class="text_pole vse-code-area" rows="18">${esc(JSON.stringify(obj, null, 2))}</textarea>
            `);
        }
    }

    renderTab();

    $overlay.on('click', '.vse-ed-tab', function () {
        if (!collectCurrentTab()) return;
        activeTab = $(this).data('tab');
        $overlay.find('.vse-ed-tab').removeClass('active');
        $(this).addClass('active');
        renderTab();
    });

    $overlay.on('click', '.vse-ed-close', () => $overlay.remove());
    $overlay.find('#vse_ed_save').on('click', () => {
        if (!collectCurrentTab()) return;
        store.addUserEdit(draft, { kind: 'snapshot' });
        $overlay.remove();
        onSaved();
    });
}
