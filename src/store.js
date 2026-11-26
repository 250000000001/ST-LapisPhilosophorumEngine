/**
 * Swipe-safe journaled Vexa state store.
 *
 * Adapted from Megumin Suite's store design:
 *   current state = checkpoint + active journal entries, in seq order
 *
 * Every AI message and every swipe slot gets a persistent (vexa_uid, vexa_seq) stamp,
 * and every state mutation (full snapshot import, main-model tail capture, post-reply worker delta,
 * or manual UI edit) is stored as a journal entry keyed by (uid, swipe) in chat_metadata.vexa_state.
 *
 * Pure module over an injected adapter so it runs under Node tests without SillyTavern.
 */

import { emptyState, cloneState, extractStoryProse, parseTimeHeader, extractProseColors, extractVexaTail } from './schema.js';
import { parseInternalStates } from './parser.js';
import { applyDelta } from './reducer.js';

const ROOT_VERSION = 1;

function randomUid() {
    return 'v_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function currentSwipe(msg) {
    return typeof msg?.swipe_id === 'number' ? msg.swipe_id : 0;
}

function emptyRoot() {
    return {
        v: ROOT_VERSION,
        seqCounter: 1,
        entryCounter: 1,
        checkpoint: { seq: 0, state: emptyState() },
        journal: [],
        swipeOf: {},
        imported: false,
    };
}

/**
 * @param {{
 *   adapter: {
 *     getChat: () => any[],
 *     getMeta: () => object|null,
 *     saveMeta: () => void,
 *     saveChat?: () => void,
 *     applyContext?: () => object
 *   },
 *   journalDepth?: number | (() => number),
 *   rootKey?: string
 * }} opts
 */
export function createVexaStateStore({ adapter, journalDepth = 200, rootKey = 'vexa_state' }) {
    let version = 0;
    let memo = null; // { key, timeline }
    let entryMemo = null; // { journal, version, len, map }

    function buildEntryMap(r) {
        const map = new Map();
        for (const e of r.journal) {
            if (!e || !e.uid || e.source === 'user') continue;
            const k = `${e.uid}\0${e.swipe}`;
            if (!map.has(k)) map.set(k, e);
        }
        return map;
    }

    function root() {
        const meta = adapter.getMeta();
        if (!meta) return null;
        const r = meta[rootKey];
        if (!r || typeof r !== 'object' || r.v !== ROOT_VERSION) {
            meta[rootKey] = emptyRoot();
        } else {
            const d = emptyRoot();
            for (const k of Object.keys(d)) if (r[k] === undefined) r[k] = d[k];
            if (!Array.isArray(r.journal)) r.journal = [];
            if (!r.checkpoint || typeof r.checkpoint !== 'object') r.checkpoint = { seq: 0, state: emptyState() };
        }
        return meta[rootKey];
    }

    function changed({ chat = false } = {}) {
        version++;
        memo = null;
        adapter.saveMeta();
        if (chat && adapter.saveChat) adapter.saveChat();
    }

    function chat() {
        return adapter.getChat() || [];
    }

    function stamp(msg) {
        const r = root();
        if (!msg || !r) return null;
        if (!msg.extra || typeof msg.extra !== 'object') msg.extra = {};
        let dirty = false;
        let { vexa_uid: uid, vexa_seq: seq } = msg.extra;
        if (!uid || typeof seq !== 'number') {
            uid = randomUid();
            seq = r.seqCounter++;
            dirty = true;
        }
        if (msg.extra.vexa_uid !== uid || msg.extra.vexa_seq !== seq) {
            msg.extra.vexa_uid = uid;
            msg.extra.vexa_seq = seq;
            dirty = true;
        }
        if (Array.isArray(msg.swipe_info)) {
            for (const info of msg.swipe_info) {
                if (!info || typeof info !== 'object') continue;
                if (!info.extra || typeof info.extra !== 'object') info.extra = {};
                if (info.extra.vexa_uid !== uid || info.extra.vexa_seq !== seq) {
                    info.extra.vexa_uid = uid;
                    info.extra.vexa_seq = seq;
                    dirty = true;
                }
            }
        }
        return { uid, seq, dirty };
    }

    function stampAll() {
        let dirty = false;
        for (const msg of chat()) {
            if (!msg || msg.is_user) continue;
            const s = stamp(msg);
            if (s && s.dirty) dirty = true;
        }
        if (dirty) changed({ chat: true });
        return dirty;
    }

    function presentMessages() {
        const map = new Map();
        chat().forEach((msg, index) => {
            const uid = msg?.extra?.vexa_uid;
            if (uid) map.set(uid, { index, msg, seq: msg.extra.vexa_seq, swipe: currentSwipe(msg) });
        });
        return map;
    }

    function sortJournal(r) {
        r.journal.sort((a, b) => (a.seq - b.seq) || (a.n - b.n));
    }

    function activeEntries() {
        const r = root();
        if (!r) return [];
        const present = presentMessages();
        return r.journal.filter((e) => {
            if (e.disabled) return false;
            if (e.source === 'user' || e.orphan) return true;
            const p = present.get(e.uid);
            return Boolean(p) && p.swipe === e.swipe;
        });
    }

    function applyEntry(state, entry) {
        if (entry.kind === 'snapshot' && entry.snapshot) {
            const snap = cloneState(entry.snapshot);
            const diff = Object.keys(snap);
            return { state: snap, diff, warnings: [] };
        }
        const ctx = {
            ...(adapter.applyContext ? adapter.applyContext() : {}),
            ...(entry.ctx || {}),
        };
        return applyDelta(state, entry.delta || {}, ctx);
    }

    function swipeSignature() {
        let sig = '';
        for (const msg of chat()) {
            const uid = msg?.extra?.vexa_uid;
            if (uid) sig += uid + ':' + currentSwipe(msg) + ',';
        }
        return sig;
    }

    function timeline() {
        const r = root();
        if (!r) return { base: emptyState(), baseSeq: 0, steps: [], stepByUid: new Map() };
        const extra = adapter.applyContext ? adapter.applyContext() : {};
        const key = version + '|' + swipeSignature() + '|' + JSON.stringify(extra);
        if (memo && memo.root === r && memo.key === key) return memo.timeline;

        const base = cloneState(r.checkpoint.state || emptyState());
        let state = base;
        const steps = [];
        const stepByUid = new Map();
        for (const e of activeEntries()) {
            const res = applyEntry(state, e);
            state = res.state;
            const step = { seq: e.seq, entry: e, state, diff: res.diff, warnings: res.warnings };
            steps.push(step);
            if (e.uid && e.source !== 'user' && !stepByUid.has(e.uid)) {
                stepByUid.set(e.uid, step);
            }
        }
        const tl = { base, baseSeq: r.checkpoint.seq, steps, stepByUid };
        memo = { root: r, key, timeline: tl };
        return tl;
    }

    function getState() {
        const tl = timeline();
        return tl.steps.length ? tl.steps[tl.steps.length - 1].state : tl.base;
    }

    function getStateAt(seq, tlOpt = null) {
        const tl = tlOpt || timeline();
        const steps = tl.steps;
        let lo = 0;
        let hi = steps.length - 1;
        let hit = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            if (steps[mid].seq <= seq) {
                hit = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return hit >= 0 ? steps[hit].state : tl.base;
    }

    function getStep(uid, tlOpt = null) {
        if (!uid) return null;
        const tl = tlOpt || timeline();
        return tl.stepByUid?.get(uid) || null;
    }

    function getEntryFor(uid, swipe) {
        const r = root();
        if (!r || !uid) return null;
        if (!entryMemo || entryMemo.root !== r || entryMemo.journal !== r.journal || entryMemo.version !== version || entryMemo.len !== r.journal.length) {
            entryMemo = { root: r, journal: r.journal, version, len: r.journal.length, map: buildEntryMap(r) };
        }
        return entryMemo.map.get(`${uid}\0${swipe}`) || null;
    }

    function hasState() {
        const r = root();
        if (!r) return false;
        if (r.checkpoint.seq > 0) return true;
        return timeline().steps.some((s) => !s.entry.missing);
    }

    function recordEntry(index, { kind = 'delta', snapshot = null, delta = {}, ctx = {}, source = 'worker', swipe: forSwipe, raw = null, status = 'synced', error = null } = {}) {
        const r = root();
        const msg = chat()[index];
        if (!r || !msg || msg.is_user) return null;
        const s = stamp(msg);
        if (!s || s.seq <= r.checkpoint.seq) return null;

        const swipe = typeof forSwipe === 'number' ? forSwipe : currentSwipe(msg);
        if (swipe === currentSwipe(msg)) r.swipeOf[s.uid] = swipe;

        const at = r.journal.findIndex((e) => e.uid === s.uid && e.swipe === swipe && e.source !== 'user');
        const entry = {
            id: `ve${r.entryCounter++}`,
            n: r.entryCounter,
            uid: s.uid,
            swipe,
            seq: s.seq,
            source,
            kind,
            ...(kind === 'snapshot' && snapshot ? { snapshot: cloneState(snapshot) } : { delta }),
            ctx,
            ...(typeof raw === 'string' ? { raw } : {}),
            status,
            error,
            missing: status !== 'synced' && kind === 'delta' && Object.keys(delta || {}).length === 0,
            orphan: false,
            disabled: at >= 0 ? r.journal[at].disabled : false,
        };
        if (at >= 0) r.journal[at] = entry;
        else r.journal.push(entry);

        sortJournal(r);
        compact(r);
        changed({ chat: s.dirty });
        return entry;
    }

    function recordSnapshot(index, snapshot, opts = {}) {
        return recordEntry(index, { ...opts, kind: 'snapshot', snapshot, status: 'synced' });
    }

    function recordDelta(index, delta, opts = {}) {
        return recordEntry(index, { ...opts, kind: 'delta', delta, status: opts.status || 'synced' });
    }

    function compact(r) {
        const seqs = [...new Set(r.journal.filter((e) => e.source !== 'user').map((e) => e.seq))].sort((a, b) => a - b);
        const depth = Math.max(1, Number(typeof journalDepth === 'function' ? journalDepth() : journalDepth) || 200);
        if (seqs.length <= depth) return false;
        const cutSeq = seqs[seqs.length - depth - 1];
        const present = presentMessages();
        let state = cloneState(r.checkpoint.state || emptyState());
        for (const e of r.journal) {
            if (e.seq > cutSeq || e.disabled) continue;
            const p = present.get(e.uid);
            const active = e.source === 'user' || e.orphan || (p && p.swipe === e.swipe);
            if (!active) continue;
            state = applyEntry(state, e).state;
        }
        r.checkpoint.state = state;
        r.checkpoint.seq = cutSeq;
        r.journal = r.journal.filter((e) => e.seq > cutSeq);
        return true;
    }

    function reconcile() {
        const r = root();
        if (!r) return { orphaned: [], dropped: [] };
        const present = presentMessages();
        let maxSeq = r.checkpoint.seq;
        let dirty = false;
        for (const [uid, p] of present) {
            if (typeof p.seq === 'number' && p.seq > maxSeq) maxSeq = p.seq;
            if (r.swipeOf[uid] !== p.swipe) {
                r.swipeOf[uid] = p.swipe;
                dirty = true;
            }
        }
        const orphaned = [];
        const dropped = [];
        const keep = [];
        for (const e of r.journal) {
            if (e.source === 'user' || e.orphan || present.has(e.uid)) {
                keep.push(e);
                continue;
            }
            const shownSwipe = r.swipeOf[e.uid];
            const wasShowing = shownSwipe === undefined || shownSwipe === e.swipe;
            if (e.seq < maxSeq && wasShowing) {
                e.orphan = true;
                orphaned.push(e);
                keep.push(e);
            } else {
                dropped.push(e);
            }
        }
        if (orphaned.length || dropped.length) {
            r.journal = keep;
            for (const e of [...orphaned, ...dropped]) delete r.swipeOf[e.uid];
            dirty = true;
        }
        if (dirty) changed();
        return { orphaned, dropped };
    }

    function onSwiped(index) {
        reconcile();
        const r = root();
        const msg = chat()[index];
        if (!r || !msg || msg.is_user) return false;
        const swipe = currentSwipe(msg);
        const text = Array.isArray(msg.swipes) ? msg.swipes[swipe] : msg.mes;
        if (typeof text !== 'string') return false;
        const s = stamp(msg);
        if (!s) return false;
        const has = r.journal.some((e) => e.uid === s.uid && e.swipe === swipe && e.source !== 'user');
        if (has) return true;
        // If this swipe contains a legacy <internal_states>, record it deterministically
        const snap = parseInternalStates(text);
        if (snap) {
            recordSnapshot(index, snap, { source: 'import', swipe });
            return true;
        }
        return true;
    }

    function onSwipeDeleted(messageIndex, swipeId) {
        const r = root();
        const msg = chat()[messageIndex];
        const uid = msg?.extra?.vexa_uid;
        if (!r || !uid) return false;
        const before = r.journal.length;
        r.journal = r.journal.filter((e) => !(e.uid === uid && e.swipe === swipeId));
        let shifted = false;
        for (const e of r.journal) {
            if (e.uid === uid && e.swipe > swipeId) {
                e.swipe--;
                shifted = true;
            }
        }
        r.swipeOf[uid] = currentSwipe(msg);
        if (r.journal.length !== before || shifted) changed();
        return true;
    }

    function addUserEdit(deltaOrSnapshot, { kind = 'delta', targetSeq = null } = {}) {
        const r = root();
        if (!r) return null;
        const entry = {
            id: `ve${r.entryCounter++}`,
            n: r.entryCounter,
            uid: null,
            swipe: 0,
            seq: targetSeq !== null ? targetSeq : r.seqCounter++,
            source: 'user',
            kind,
            ...(kind === 'snapshot' ? { snapshot: cloneState(deltaOrSnapshot) } : { delta: deltaOrSnapshot }),
            ctx: { isTurnAdvance: false },
            status: 'synced',
            missing: false,
            orphan: false,
            disabled: false,
        };
        r.journal.push(entry);
        sortJournal(r);
        changed();
        return entry;
    }

    function setDisabled(entryId, disabled) {
        const r = root();
        const e = r && r.journal.find((x) => x.id === entryId);
        if (!e) return false;
        e.disabled = Boolean(disabled);
        changed();
        return true;
    }

    function removeUserEntry(entryId) {
        const r = root();
        if (!r) return false;
        const idx = r.journal.findIndex((x) => x.id === entryId && x.source === 'user');
        if (idx < 0) return false;
        r.journal.splice(idx, 1);
        changed();
        return true;
    }

    function reset() {
        const meta = adapter.getMeta();
        if (!meta) return;
        meta[rootKey] = emptyRoot();
        changed();
    }

    /**
     * One-time import from an existing vanilla Vexa chat containing <internal_states> blocks.
     * Imports each AI message with <internal_states> as a swipe-keyed snapshot so swipes and
     * history browsing work immediately at turn N+1!
     */
    function importFromChat({ force = false } = {}) {
        const r = root();
        if (!r) return 0;
        if (r.imported && !force) return 0;
        if (force) {
            r.checkpoint = { seq: 0, state: emptyState() };
            r.journal = r.journal.filter((e) => e.source === 'user');
        }
        stampAll();
        const msgs = chat();
        let importedCount = 0;
        for (let i = 0; i < msgs.length; i++) {
            const m = msgs[i];
            // SillyTavern uses is_system=true for /hide messages as well, so check is_user only when importing history
            if (!m || m.is_user) continue;
            const swipes = Array.isArray(m.swipes) && m.swipes.length ? m.swipes : [String(m.mes || '')];
            const activeSwipe = currentSwipe(m);
            for (let sw = 0; sw < swipes.length; sw++) {
                const rawText = String(sw === activeSwipe ? (m.mes || swipes[sw] || '') : (swipes[sw] || ''));
                const snap = parseInternalStates(rawText);
                if (snap) {
                    recordSnapshot(i, snap, { source: 'import', swipe: sw });
                    importedCount++;
                } else {
                    const tail = extractVexaTail(rawText);
                    if (tail.hasTail) {
                        const prose = extractStoryProse(rawText);
                        recordDelta(i, {}, {
                            source: 'import',
                            swipe: sw,
                            ctx: {
                                isTurnAdvance: true,
                                headerParsed: parseTimeHeader(prose),
                                proseColors: extractProseColors(prose),
                                vent: tail.vent,
                                receipt: tail.receipt,
                            },
                        });
                        importedCount++;
                    }
                }
            }
        }
        r.imported = true;
        changed();
        return importedCount;
    }

    return {
        root,
        stamp,
        stampAll,
        recordSnapshot,
        recordDelta,
        onSwiped,
        onSwipeDeleted,
        reconcile,
        timeline,
        getState,
        getStateAt,
        getStep,
        getEntryFor,
        hasState,
        addUserEdit,
        setDisabled,
        removeUserEntry,
        reset,
        importFromChat,
        get version() { return version; },
    };
}
