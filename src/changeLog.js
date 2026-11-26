/**
 * Per-turn Changelog diff computer & Megumin-style inline diff strip for Vexa HUD.
 * Computes structured before/after diffs between consecutive `timeline()` steps
 * across all 18 HUD sections, including Matrix emoji deltas and 3D Atlas updates.
 * Pure ES module (zero DOM dependencies; testable under Node).
 */

import { emptyState, isEmptySentinel } from './schema.js';
import { parseMatrixValues } from './matrixView.js';

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export const TAB_LABELS = Object.freeze({
    world: 'World',
    onscreen: 'On-Screen',
    offscreen_agendas: 'Off-Screen',
    locations: 'Atlas Map',
    entityMem: 'Memories',
    entity_state: 'Entities',
    thoughts: 'Thoughts',
    dam: 'Dam',
    pair: 'Matrix',
    tracks: 'Tracks',
    arc: 'ARC',
    chekhov: 'Chekhov',
    inv: 'Inv',
    health: 'Health',
    custom_trackers: 'Trackers',
    story_notes: 'Notes',
    notebook: 'Notebook',
    vent: 'Vent',
});

function normVal(v) {
    if (v === null || v === undefined) return '';
    const s = String(v).trim();
    return isEmptySentinel(s) ? '' : s;
}

function trunc(s, max = 110) {
    const clean = String(s ?? '').replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean;
    return `${clean.slice(0, Math.max(1, max - 1))}…`;
}

function mapByName(arr, keyFn) {
    const m = new Map();
    if (!Array.isArray(arr)) return m;
    for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        const k = String(keyFn(item) || '').trim();
        if (!k) continue;
        m.set(k.toLowerCase(), item);
    }
    return m;
}

function summarizeMatrixDiff(prevMatrix, nextMatrix) {
    const prevAxes = parseMatrixValues(prevMatrix);
    const nextAxes = parseMatrixValues(nextMatrix);
    if (!nextAxes.length) {
        const p = normVal(prevMatrix);
        const n = normVal(nextMatrix);
        if (p === n) return null;
        return { before: trunc(p, 70), after: trunc(n, 70) };
    }
    const shifts = [];
    for (let i = 0; i < nextAxes.length; i++) {
        const na = nextAxes[i];
        const pa = prevAxes[i];
        for (const side of ['pos', 'neg']) {
            const nTok = na?.[side];
            const pTok = pa?.[side];
            if (!nTok || !pTok) continue;
            const em = nTok.emoji || na[`${side}Emoji`] || '';
            const lbl = na[`${side}Label`] || '';
            if (nTok.val !== pTok.val) {
                shifts.push(`${em}${lbl ? ` ${lbl}` : ''} ${pTok.val}→${nTok.val}`);
            } else if ((nTok.acc ?? 0) !== (pTok.acc ?? 0)) {
                shifts.push(`${em}${lbl ? ` ${lbl}` : ''} acc ${pTok.acc}→${nTok.acc}`);
            }
        }
    }
    if (!shifts.length) return null;
    return { before: '', after: shifts.join(' · ') };
}

function summarizeTrackerVal(t) {
    if (!t || typeof t !== 'object') return '';
    const fields = t.fields && typeof t.fields === 'object'
        ? Object.entries(t.fields).map(([k, v]) => `${k}: ${v}`).join(' · ')
        : '';
    const notes = normVal(t.notes);
    const parts = [fields, notes ? `(${notes})` : ''].filter(Boolean);
    return (t.archived ? '[Archived] ' : '') + (parts.join(' ') || 'active');
}

function summarizeHealthPart(p) {
    if (!p || typeof p !== 'object') return '100%';
    if (p.missing) return 'missing (0%)';
    const conds = (p.conditions || []).map((c) => `${c.label || c.kind || 'issue'} (${c.severity ?? '?'}%)`).join(', ');
    const pros = p.prosthetic ? '[prosthetic] ' : '';
    return `${pros}${p.hp ?? 100}%${conds ? ` — ${conds}` : ''}`;
}

/**
 * Compute detailed per-field differences between `prevState` and `nextState`.
 */
export function computeTurnChangeLog(prevState, nextState, { entry = null, warnings = [] } = {}) {
    const prev = prevState || emptyState();
    const next = nextState || emptyState();
    const items = [];

    const push = (tab, label, kind, before = '', after = '') => {
        const rawB = normVal(before);
        const rawA = normVal(after);
        if (kind === 'updated' && rawB === rawA) return;
        if (kind === 'added' && !rawA) return;
        if (kind === 'removed' && !rawB) return;
        const b = trunc(rawB);
        let a = trunc(rawA);
        if (kind === 'updated' && rawB !== rawA && b === a && rawA.length > 75) {
            a = `…${rawA.slice(-75)}`;
        }
        items.push({ tab, label, kind, before: b, after: a });
    };

    const diffFields = (tab, prefix, objA, objB, keys) => {
        const a = objA && typeof objA === 'object' ? objA : {};
        const b = objB && typeof objB === 'object' ? objB : {};
        for (const k of keys) {
            const va = normVal(a[k]);
            const vb = normVal(b[k]);
            if (va !== vb) {
                if (!va && vb) push(tab, `${prefix} · ${k}`, 'added', '', vb);
                else if (va && !vb) push(tab, `${prefix} · ${k}`, 'removed', va, '');
                else push(tab, `${prefix} · ${k}`, 'updated', va, vb);
            }
        }
    };

    // 1. World
    diffFields('world', 'World', prev.world, next.world, [
        'loc', 'time', 'date', 'weather', 'room', 'user_pos', 'entries', 'obstacles', 'audio', 'pacing', 'ct',
    ]);

    // 2. On-Screen
    {
        const pMap = mapByName(prev.onscreen, (x) => x.name);
        const nMap = mapByName(next.onscreen, (x) => x.name);
        for (const [k, item] of nMap) {
            const old = pMap.get(k);
            if (!old) {
                push('onscreen', `On-Screen · ${item.name}`, 'added', '', item.agenda || item.move || 'Entered scene');
            } else {
                diffFields('onscreen', item.name, old, item, ['move', 'agenda', 'parrott', 'tfdy', 'salience', 'end']);
            }
        }
        for (const [k, item] of pMap) {
            if (!nMap.has(k)) {
                push('onscreen', `On-Screen · ${item.name}`, 'removed', item.move || 'Present', '');
            }
        }
    }

    // 3. Off-Screen Agendas
    {
        const pMap = mapByName(prev.offscreen_agendas, (x) => x.name);
        const nMap = mapByName(next.offscreen_agendas, (x) => x.name);
        for (const [k, item] of nMap) {
            const old = pMap.get(k);
            if (!old) {
                push('offscreen_agendas', `Off-Screen · ${item.name}`, 'added', '', item.agenda || item.goal || item.loc || 'Active off-screen');
            } else {
                diffFields('offscreen_agendas', `Off-Screen · ${item.name}`, old, item, ['loc', 'agenda', 'goal', 'mood', 'tfdy']);
            }
        }
        for (const [k, item] of pMap) {
            if (!nMap.has(k)) {
                push('offscreen_agendas', `Off-Screen · ${item.name}`, 'removed', item.loc || 'Tracked', '');
            }
        }
    }

    // 4. Atlas / Locations
    {
        const pIdx = prev.locations?.map_index || {};
        const nIdx = next.locations?.map_index || {};
        diffFields('locations', 'Atlas Map', pIdx, nIdx, ['active_map_id', 'active_level']);
        const pRooms = mapByName(prev.locations?.rooms, (r) => r.id);
        const nRooms = mapByName(next.locations?.rooms, (r) => r.id);
        for (const [k, rm] of nRooms) {
            const old = pRooms.get(k);
            const rLabel = rm.name || rm.id;
            if (!old) {
                push('locations', `Room · ${rLabel}`, 'added', '', `${rm.dim || ''} @ ${rm.grid || ''}`.trim());
            } else {
                diffFields('locations', `Room · ${rLabel}`, old, rm, ['grid', 'dim', 'elev', 'occupants', 'exits', 'kind']);
                const pObjs = Array.isArray(old.objects) ? old.objects : [];
                const nObjs = Array.isArray(rm.objects) ? rm.objects : [];
                if (pObjs.length !== nObjs.length || JSON.stringify(pObjs) !== JSON.stringify(nObjs)) {
                    const fmtObj = (o) => `${o.label || o.shape}@${Array.isArray(o.pos) ? `[${o.pos.join(',')}]` : ''}${Array.isArray(o.size) ? `(${o.size.join('x')})` : ''}`;
                    const pLbl = pObjs.map(fmtObj).join(', ');
                    const nLbl = nObjs.map(fmtObj).join(', ');
                    push('locations', `Room · ${rLabel} objects`, pObjs.length ? 'updated' : 'added', pLbl, nLbl || `${nObjs.length} props`);
                }
            }
        }
        for (const [k, rm] of pRooms) {
            if (!nRooms.has(k)) {
                push('locations', `Room · ${rm.name || rm.id}`, 'removed', rm.dim || rm.id, '');
            }
        }
    }

    // 5. Memories
    {
        const pMap = mapByName(prev.entityMem, (x) => x.name);
        const nMap = mapByName(next.entityMem, (x) => x.name);
        for (const [k, item] of nMap) {
            const old = pMap.get(k);
            const pe = Array.isArray(old?.entries) ? old.entries : [];
            const ne = Array.isArray(item.entries) ? item.entries : [];
            const pSet = new Set(pe);
            const added = ne.filter((e) => !pSet.has(e));
            for (const line of added) {
                push('entityMem', `Memory · ${item.name}`, 'added', '', line);
            }
        }
    }

    // 6. Entity Sheets
    {
        const pMap = mapByName(prev.entity_state, (x) => x.name);
        const nMap = mapByName(next.entity_state, (x) => x.name);
        for (const [k, item] of nMap) {
            const old = pMap.get(k);
            if (!old) {
                push('entity_state', `Entity · ${item.name}`, 'added', '', item.look || item.persona || 'Profile created');
            } else {
                diffFields('entity_state', `Entity · ${item.name}`, old, item, ['look', 'voice', 'persona', 'private', 'fontColor']);
            }
        }
    }

    // 7. Thoughts
    {
        const pMap = mapByName(prev.thoughts, (x) => x.name);
        const nMap = mapByName(next.thoughts, (x) => x.name);
        for (const [k, item] of nMap) {
            const old = pMap.get(k);
            if (!old) {
                push('thoughts', `Thoughts · ${item.name}`, 'added', '', item.tQ1 || item.tQ2 || item.tQ5 || 'Recorded');
            } else {
                diffFields('thoughts', `Thoughts · ${item.name}`, old, item, ['tQ1', 'tQ2', 'tQ3', 'tQ4', 'tQ5']);
            }
        }
    }

    // 8. Aether Dam
    {
        const pMap = mapByName(prev.dam, (x) => x.pair);
        const nMap = mapByName(next.dam, (x) => x.pair);
        for (const [k, item] of nMap) {
            const old = pMap.get(k);
            if (!old) {
                push('dam', `Dam · ${item.pair}`, 'added', '', item.intent || item.sluice || 'Initialized');
            } else {
                diffFields('dam', `Dam · ${item.pair}`, old, item, ['sluice', 'filters', 'misc', 'intent']);
            }
        }
    }

    // 9. Aether Matrix
    {
        const pMap = mapByName(prev.pair, (x) => x.names);
        const nMap = mapByName(next.pair, (x) => x.names);
        for (const [k, item] of nMap) {
            const old = pMap.get(k);
            if (!old) {
                push('pair', `Matrix · ${item.names}`, 'added', '', `${item.mode || ''} ${item.dam || ''}`.trim());
            } else {
                diffFields('pair', `Matrix · ${item.names}`, old, item, ['mode', 'dam', 'wall']);
                const mDiff = summarizeMatrixDiff(old.matrix, item.matrix);
                if (mDiff) {
                    push('pair', `Matrix · ${item.names} axes`, 'updated', mDiff.before, mDiff.after);
                }
            }
        }
    }

    // 10. Tracks
    {
        if (normVal(prev.tracks?.main) !== normVal(next.tracks?.main)) {
            push('tracks', 'Tracks · Main', prev.tracks?.main ? 'updated' : 'added', prev.tracks?.main, next.tracks?.main);
        }
        const pTr = new Map((prev.tracks?.tracks || []).map((t) => [typeof t === 'string' ? t : `${t.name || t.title || ''}`, typeof t === 'string' ? t : JSON.stringify(t)]));
        for (const t of (next.tracks?.tracks || [])) {
            const key = typeof t === 'string' ? t : `${t.name || t.title || ''}`;
            const val = typeof t === 'string' ? t : JSON.stringify(t);
            const old = pTr.get(key);
            if (old === undefined) push('tracks', `Track · ${key || 'Entry'}`, 'added', '', val);
            else if (old !== val) push('tracks', `Track · ${key || 'Entry'}`, 'updated', old, val);
        }
        const pHist = new Set(prev.tracks?.history || []);
        for (const h of (next.tracks?.history || [])) {
            if (!pHist.has(h)) push('tracks', 'Tracks · History', 'added', '', h);
        }
    }

    // 11. ARC
    {
        diffFields('arc', 'ARC', prev.arc, next.arc, ['info', 'timeline']);
        for (const k of ['ki', 'sho', 'ten', 'ketsu']) {
            const pSet = new Set(prev.arc?.[k] || []);
            for (const b of (next.arc?.[k] || [])) {
                if (!pSet.has(b)) push('arc', `ARC · ${k.toUpperCase()}`, 'added', '', b);
            }
        }
    }

    // 12. Chekhov
    {
        for (const k of ['chamber', 'locked', 'fired']) {
            const pList = Array.isArray(prev.chekhov?.[k]) ? prev.chekhov[k] : [];
            const nList = Array.isArray(next.chekhov?.[k]) ? next.chekhov[k] : [];
            const stripAge = (s) => String(s || '').replace(/\s*\|\s*age\s*:\s*\d+/i, '').trim();
            const pClean = new Set(pList.map(stripAge));
            const nClean = new Set(nList.map(stripAge));
            for (const raw of nList) {
                if (!pClean.has(stripAge(raw))) push('chekhov', `Chekhov · ${k}`, 'added', '', raw);
            }
            for (const raw of pList) {
                if (!nClean.has(stripAge(raw))) push('chekhov', `Chekhov · ${k}`, 'removed', raw, '');
            }
        }
    }

    // 13. Inv
    diffFields('inv', 'Inventory', prev.inv, next.inv, ['inv', 'titles', 'status']);

    // 14. Health
    {
        const ph = prev.health || {};
        const nh = next.health || {};
        if (normVal(ph.bodyType) !== normVal(nh.bodyType)) {
            push('health', 'Health · Body Type', 'updated', ph.bodyType, nh.bodyType);
        }
        if ((ph.bloodLoss || 0) !== (nh.bloodLoss || 0)) {
            push('health', 'Health · Blood Loss', 'updated', `${ph.bloodLoss || 0}%`, `${nh.bloodLoss || 0}%`);
        }
        if ((ph.pain || 0) !== (nh.pain || 0)) {
            push('health', 'Health · Pain', 'updated', `${ph.pain || 0}%`, `${nh.pain || 0}%`);
        }
        const pWb = new Map((ph.wholeBody || []).map((w) => [`${w.type}:${w.label}`, `${w.label} (${w.severity ?? ''}%)`]));
        const nWb = new Map((nh.wholeBody || []).map((w) => [`${w.type}:${w.label}`, `${w.label} (${w.severity ?? ''}%)`]));
        for (const [k, v] of nWb) {
            const ov = pWb.get(k);
            if (!ov) push('health', 'Health · Whole Body', 'added', '', v);
            else if (ov !== v) push('health', 'Health · Whole Body', 'updated', ov, v);
        }
        for (const [k, ov] of pWb) {
            if (!nWb.has(k)) push('health', 'Health · Whole Body', 'removed', ov, '');
        }
        const pParts = ph.parts || {};
        const nParts = nh.parts || {};
        const allKeys = new Set([...Object.keys(pParts), ...Object.keys(nParts)]);
        for (const pk of allKeys) {
            const ps = summarizeHealthPart(pParts[pk]);
            const ns = summarizeHealthPart(nParts[pk]);
            if (ps !== ns) {
                push('health', `Health · ${pk}`, ps === '100%' ? 'added' : (ns === '100%' ? 'removed' : 'updated'), ps, ns);
            }
        }
    }

    // 15. Custom Trackers
    {
        const pMap = mapByName(prev.custom_trackers, (x) => x.id || x.title);
        const nMap = mapByName(next.custom_trackers, (x) => x.id || x.title);
        for (const [k, t] of nMap) {
            const old = pMap.get(k);
            const sum = summarizeTrackerVal(t);
            if (!old) push('custom_trackers', `Tracker · ${t.title || t.id}`, 'added', '', sum);
            else {
                const oldSum = summarizeTrackerVal(old);
                if (oldSum !== sum) push('custom_trackers', `Tracker · ${t.title || t.id}`, 'updated', oldSum, sum);
            }
        }
    }

    // 16. Story Notes
    diffFields('story_notes', 'Notes', prev.story_notes, next.story_notes, ['threads', 'seeds', 'motives', 'horizon', 'GremlinNote', 'heckle']);

    // 17. Notebook
    {
        const pSet = new Set(prev.notebook || []);
        const nSet = new Set(next.notebook || []);
        for (const ln of (next.notebook || [])) {
            if (!pSet.has(ln)) push('notebook', 'Notebook', 'added', '', ln);
        }
        for (const ln of (prev.notebook || [])) {
            if (!nSet.has(ln)) push('notebook', 'Notebook', 'removed', ln, '');
        }
    }

    // 18. Vent
    if (normVal(prev.vent) !== normVal(next.vent)) {
        push('vent', 'Vexa Vent', prev.vent ? 'updated' : 'added', prev.vent, next.vent);
    }

    const byTab = {};
    for (const it of items) {
        byTab[it.tab] = (byTab[it.tab] || 0) + 1;
    }

    const allWarnings = [...(warnings || []), ...(Array.isArray(entry?.warnings) ? entry.warnings : [])].filter(Boolean);

    return {
        items,
        byTab,
        total: items.length,
        warnings: [...new Set(allWarnings.map((w) => String(w)))],
    };
}

/**
 * Render Megumin-style inline "Changed in this reply" strip above the HUD tabs.
 */
export function renderChangeLogStrip(
    changeLog,
    {
        entry = null,
        isOpen = false,
        filterMode = 'all',
        showAll = false,
        activeTab = 'world',
        canToggle = true,
        canRead = true,
    } = {},
) {
    const items = Array.isArray(changeLog?.items) ? changeLog.items : [];
    const byTab = changeLog?.byTab || {};
    const warnings = Array.isArray(changeLog?.warnings) ? changeLog.warnings : [];
    const total = items.length;
    const disabled = Boolean(entry?.disabled);
    const pending = entry?.status === 'pending';
    const hasErr = entry?.status === 'error';
    const missing = !entry || entry.missing || entry.status === 'unread';

    let stateCls = '';
    if (disabled) stateCls = ' is-off';
    else if (pending || missing || (total === 0 && !hasErr)) stateCls = ' is-quiet';

    let titleHtml = '';
    if (pending) {
        titleHtml = `<i class="fa-solid fa-spinner fa-spin"></i> Clerk is reading this reply…`;
    } else if (hasErr) {
        titleHtml = `<i class="fa-solid fa-triangle-exclamation"></i> Clerk read error <span class="vse-diff-count warn">${esc(trunc(entry?.error || 'Failed', 60))}</span>`;
    } else if (disabled) {
        titleHtml = `<i class="fa-solid fa-ban"></i> Reverted this reply's changes${total > 0 ? ` <span class="vse-diff-count">${total} hidden</span>` : ''}`;
    } else if (missing) {
        titleHtml = `<i class="fa-regular fa-circle-question"></i> Not read by Vexa Clerk yet`;
    } else if (total === 0 && warnings.length === 0) {
        titleHtml = `<i class="fa-solid fa-code-compare"></i> No state changes recorded in this reply`;
    } else {
        titleHtml = `<i class="fa-solid fa-code-compare"></i> Changed in this reply <span class="vse-diff-count">${total}</span>`;
    }

    const actionsHtml = `
        <span class="vse-diff-actions">
            ${canToggle && entry && !pending && !missing ? `
                <button type="button" class="vse-diff-btn vse-diff-revert-btn" data-diff-toggle="${disabled ? '0' : '1'}"
                        title="${disabled ? "Restore this reply's state changes" : "Revert this reply's changes back to the previous turn"}">
                    <i class="fa-solid ${disabled ? 'fa-rotate-left' : 'fa-clock-rotate-left'}"></i> ${disabled ? 'Restore' : 'Revert'}
                </button>
            ` : ''}
            ${canRead ? `
                <button type="button" class="vse-diff-btn vse-diff-read-btn" title="${missing ? 'Have Vexa Clerk read this reply now' : 'Have Vexa Clerk re-read this reply'}">
                    <i class="fa-solid fa-book-open-reader"></i> ${missing ? 'Read now' : 'Read again'}
                </button>
            ` : ''}
        </span>
    `;

    const foldable = !pending && (total > 0 || warnings.length > 0);
    let bodyHtml = '';
    if (foldable && isOpen) {
        const filtered = filterMode === 'tab'
            ? items.filter((it) => it.tab === activeTab)
            : items;
        const limit = showAll ? filtered.length : 10;
        const shown = filtered.slice(0, limit);
        const hiddenCount = Math.max(0, filtered.length - shown.length);

        const jumpPills = Object.entries(byTab)
            .sort((a, b) => b[1] - a[1])
            .map(([tab, cnt]) => `
                <button type="button" class="vse-diff-jump ${tab === activeTab ? 'active' : ''}" data-diff-jump="${esc(tab)}" title="Jump to ${esc(TAB_LABELS[tab] || tab)} tab">
                    ${esc(TAB_LABELS[tab] || tab)} <span>${cnt}</span>
                </button>
            `).join('');

        const filterBar = `
            <div class="vse-diff-filterbar">
                <button type="button" class="vse-diff-btn vse-diff-filter-btn ${filterMode !== 'tab' ? 'active' : ''}" data-diff-filter="all">All (${total})</button>
                <button type="button" class="vse-diff-btn vse-diff-filter-btn ${filterMode === 'tab' ? 'active' : ''}" data-diff-filter="tab">This tab (${byTab[activeTab] || 0})</button>
                <span class="vse-diff-jumps">${jumpPills}</span>
            </div>
        `;

        const rowsHtml = shown.length
            ? shown.map((it) => {
                let valHtml = '';
                if (it.kind === 'added') {
                    valHtml = `<span class="vse-diff-tag add">+</span><span class="vse-diff-after">${esc(it.after)}</span>`;
                } else if (it.kind === 'removed') {
                    valHtml = `<span class="vse-diff-tag rem">−</span><span class="vse-diff-before">${esc(it.before)}</span>`;
                } else {
                    valHtml = `${it.before ? `<span class="vse-diff-before">${esc(it.before)}</span>` : ''}<span class="vse-diff-to">${it.before ? '<i class="fa-solid fa-arrow-right vse-diff-arrow"></i>' : ''}<span class="vse-diff-after">${esc(it.after)}</span></span>`;
                }
                return `
                    <div class="vse-diff-row">
                        <button type="button" class="vse-diff-field" data-diff-jump="${esc(it.tab)}" title="Open ${esc(TAB_LABELS[it.tab] || it.tab)} tab">${esc(it.label)}</button>
                        <span class="vse-diff-vals">${valHtml}</span>
                    </div>
                `;
            }).join('')
            : `<div class="vse-diff-empty">No changes on the <b>${esc(TAB_LABELS[activeTab] || activeTab)}</b> tab in this reply.</div>`;

        const moreHtml = hiddenCount > 0
            ? `<button type="button" class="vse-diff-more-btn" data-diff-all="1">+${hiddenCount} more — Show all</button>`
            : (showAll && filtered.length > 10
                ? `<button type="button" class="vse-diff-more-btn" data-diff-all="0">Show fewer</button>`
                : '');

        const warnHtml = warnings.length ? `
            <details class="vse-diff-warn">
                <summary><i class="fa-solid fa-triangle-exclamation"></i> Reducer notes (${warnings.length})</summary>
                ${warnings.map((w) => `<div class="vse-diff-issue">${esc(w)}</div>`).join('')}
            </details>
        ` : '';

        bodyHtml = `<div class="vse-diff-body">${filterBar}${rowsHtml}${moreHtml}${warnHtml}</div>`;
    }

    return `
        <div class="vse-diff-strip${stateCls}${foldable ? ' is-foldable' : ''}${isOpen && foldable ? ' is-open' : ''}">
            <div class="vse-diff-head">
                <button type="button" class="vse-diff-head-btn" ${foldable ? '' : 'disabled'}>
                    <span class="vse-diff-title">${titleHtml}</span>
                    ${foldable ? `<i class="fa-solid fa-chevron-${isOpen ? 'up' : 'down'} vse-diff-caret"></i>` : ''}
                </button>
                ${actionsHtml}
            </div>
            ${bodyHtml}
        </div>
    `;
}
