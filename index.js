/**
 * Vexa State Engine — Main SillyTavern Extension Entrypoint.
 *
 * Coordinates:
 *  - Swipe-safe journaled state store in chat_metadata.vexa_state
 *  - Non-destructive prompt injection & history stripping on CHAT_COMPLETION_PROMPT_READY
 *  - Send guard on GENERATION_STARTED (waits up to 30s if worker still processing last turn)
 *  - Post-reply worker execution coordinated with ST-VexaRefusalAutoRetry
 *  - Native themed JS HUD + SVG Atlas map + Inline Editor + Settings UI
 */

import {
    extractStoryProse,
    parseTimeHeader,
    extractProseColors,
    extractVexaTail,
    stripGfxBlocks,
} from './src/schema.js';
import { parseInternalStates, serializeInternalStates } from './src/parser.js';
import { parseWorkerDelta, approveTrackerProposal, dismissTrackerProposal } from './src/reducer.js';
import { createVexaStateStore } from './src/store.js';
import { buildWorkerMessages } from './src/workerPrompt.js';
import { createWorkerClient, isWorkerRefusal, extractErrorMessage } from './src/workerClient.js';
import { transformPromptMessages } from './src/promptInjector.js';
import { refreshAllHudCards } from './src/hud.js';
import { openStateEditorModal } from './src/editor.js';
import { injectSettingsUI, syncSettingsUI } from './src/settingsUi.js';
import { createVexaAppPopup, mapHudTabToAppTab } from './src/appPopup.js';
import { DEFAULT_END_MARKER } from './src/retryDetector.js';
import { createVexaRetryRuntime } from './src/retryRuntime.js';
import {
    getContextSafe,
    saveSettingsDebounced,
    saveMetadataDebounced,
    saveChatDebounced,
    getCurrentPresetName,
    getActiveCharacterCardHint,
} from './src/st.js';

const MODULE_NAME = 'vexa_state_engine';
const DISPLAY_TITLE = 'Vexa State Engine';

const DEFAULT_RETRY_SETTINGS = Object.freeze({
    enabled: true,
    showNonStreamContinue: true,
    requireEndMarker: true,
    formatMode: 'auto',
    endMarker: DEFAULT_END_MARKER,
    maxIncompleteRetries: 3,
    maxRefusalRetries: 0,
    retryDelayMs: 300,
    showStatusToasts: true,
    useModalPopup: true,
    customPatterns: '',
});

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    forceActive: false,
    scoped: true,
    workerTransport: 'direct', // 'direct' | 'profile'
    workerBaseUrl: '',
    workerApiKey: '',
    workerModel: '',
    workerProfileId: '',
    workerMode: 'combined', // 'combined' | 'split'
    workerMaxTokens: 8192,
    workerTemperature: 0.25,
    hudTheme: 'Sola',
    hudStyle: 'Afterglow',
    atlasViewMode: 'webgl',
    defaultBodyType: 'male',
    showLauncherButton: true,
    hudDefaultCollapsed: true,
    pinNotebookRules: true,
    enforceMatrixStepCap: true,
    allowTrackerProposals: true,
    autoAcceptTrackerProposals: false,
    retry: DEFAULT_RETRY_SETTINGS,
});

function getSettings() {
    const ctx = getContextSafe();
    if (!ctx.extensionSettings) {
        return { ...DEFAULT_SETTINGS, retry: { ...DEFAULT_RETRY_SETTINGS } };
    }
    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = { ...DEFAULT_SETTINGS, retry: { ...DEFAULT_RETRY_SETTINGS } };
    }
    const stored = ctx.extensionSettings[MODULE_NAME];
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        if (k === 'retry') continue;
        if (stored[k] === undefined) stored[k] = v;
    }
    if (!stored.retry || typeof stored.retry !== 'object') {
        stored.retry = { ...DEFAULT_RETRY_SETTINGS };
    } else {
        for (const [rk, rv] of Object.entries(DEFAULT_RETRY_SETTINGS)) {
            if (stored.retry[rk] === undefined) stored.retry[rk] = rv;
        }
    }
    return stored;
}

function saveSettings() {
    saveSettingsDebounced();
}

function hashText(s) {
    const t = String(s || '');
    let h = 5381;
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + ':' + t.length;
}

function recentStoryText(chat, count = 3) {
    const parts = [];
    for (let i = (chat?.length || 0) - 1; i >= 0 && parts.length < count; i--) {
        const m = chat[i];
        if (!m) continue;
        parts.push(extractStoryProse(String(m.mes || '')));
    }
    return parts.join('\n');
}

function buildExchangeAndEarlier(chat, index, replyText) {
    let start = index;
    while (start - 1 >= 0 && chat[start - 1] && chat[start - 1].is_user) start--;
    const userMsgs = chat.slice(start, index).filter((m) => m && m.is_user)
        .map((m) => `${m.name || 'User'}: ${extractStoryProse(m.mes || '')}`);
    const aiName = chat[index]?.name || 'Vexa';
    const exchange = [...userMsgs, `${aiName}: ${extractStoryProse(replyText)}`].join('\n\n');

    const earlier = chat.slice(Math.max(0, start - 3), start)
        .filter(Boolean)
        .map((m) => `${m.name || (m.is_user ? 'User' : aiName)}: ${extractStoryProse(m.mes || '')}`)
        .join('\n\n');
    return { exchange, earlier };
}

function showSendWaitingBanner(onStop) {
    $('#vse_wait_banner').remove();
    const $form = $('#send_form');
    if (!$form.length) return false;
    const $banner = $(`
        <div id="vse_wait_banner">
            <span><i class="fa-solid fa-spinner fa-spin"></i> Vexa Clerk is finishing last turn's state update...</span>
            <button type="button" class="menu_button" id="vse_wait_stop_btn">Skip &amp; Send Now</button>
        </div>
    `);
    $banner.find('#vse_wait_stop_btn').on('click', () => onStop?.());
    $form.prepend($banner);
    return true;
}

function hideSendWaitingBanner() {
    $('#vse_wait_banner').remove();
}

jQuery(() => {
    const ctx0 = getContextSafe();
    const { eventSource, event_types } = ctx0;
    if (!eventSource || !event_types) {
        console.error(`[${DISPLAY_TITLE}] SillyTavern eventSource unavailable.`);
        return;
    }

    const store = createVexaStateStore({
        adapter: {
            getChat: () => getContextSafe().chat || [],
            getMeta: () => {
                const c = getContextSafe();
                if (!c || !c.chatId) return null;
                return c.chatMetadata || null;
            },
            saveMeta: saveMetadataDebounced,
            saveChat: saveChatDebounced,
            applyContext: () => {
                const st = getSettings();
                return {
                    pinNotebookRules: st.pinNotebookRules !== false,
                    enforceMatrixStepCap: st.enforceMatrixStepCap !== false,
                };
            },
        },
    });

    let workerStatus = { busy: false, runningLabel: null, waiting: 0 };
    let refreshTimer = null;
    let appPopup = null;

    function scheduleHudRefresh(delay = 60) {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            refreshAllHudCards({
                store,
                settings: getSettings(),
                workerStatus,
                onOpenEditor: (mesId, hudTab) => {
                    const msg = (getContextSafe().chat || [])[mesId];
                    const seq = msg?.extra?.vexa_seq;
                    if (appPopup) {
                        const target = mapHudTabToAppTab(hudTab);
                        appPopup.open({ tab: target.tab, sub: target.sub, seq, mesId });
                    } else {
                        openStateEditorModal({ store, seq, onSaved: () => scheduleHudRefresh(10) });
                    }
                },
                onRetryMsg: (mesId) => processReply(mesId, 'manual-reread', { force: true }),
                onStopWorker: () => workerClient.stopAll(),
                onCopyXml: async (xml) => {
                    try {
                        await navigator.clipboard.writeText(xml);
                        window.toastr?.success?.('Copied compiled <internal_states> XML.', DISPLAY_TITLE);
                    } catch {
                        window.toastr?.info?.('Could not access clipboard.', DISPLAY_TITLE);
                    }
                },
                onApproveProposal: (propId) => {
                    if (!propId) return;
                    const nextState = approveTrackerProposal(store.getState(), propId);
                    store.addUserEdit(nextState, { kind: 'snapshot' });
                    window.toastr?.success?.(`Approved custom tracker "${propId}".`, DISPLAY_TITLE);
                    scheduleHudRefresh(10);
                },
                onDismissProposal: (propId) => {
                    if (!propId) return;
                    const nextState = dismissTrackerProposal(store.getState(), propId);
                    store.addUserEdit(nextState, { kind: 'snapshot' });
                    window.toastr?.info?.(`Dismissed tracker proposal "${propId}".`, DISPLAY_TITLE);
                    scheduleHudRefresh(10);
                },
            });
            appPopup?.refresh?.();
        }, delay);
    }

    const workerClient = createWorkerClient({
        getSettings,
        getContextSafe,
        onStatusChange: (st) => {
            workerStatus = st;
            appPopup?.syncChrome?.();
            scheduleHudRefresh(30);
        },
    });

    function mergeDeltas(a = {}, b = {}) {
        return { ...a, ...b };
    }

    async function runWorkerExtractionForMessage(index, { force = false } = {}) {
        const settings = getSettings();
        if (!settings.enabled) return;

        const ctx = getContextSafe();
        const chat = ctx.chat || [];
        const msg = chat[index];
        if (!msg || msg.is_user) return;

        const st = store.stamp(msg);
        if (!st) return;
        if (st.dirty) saveChatDebounced();

        const swipe = typeof msg.swipe_id === 'number' ? msg.swipe_id : 0;
        const replyText = Array.isArray(msg.swipes) && typeof msg.swipes[swipe] === 'string'
            ? msg.swipes[swipe]
            : String(msg.mes || '');

        if (!replyText.trim()) return;

        // If the reply itself already has a full <internal_states>, record snapshot cleanly with 0 worker cost
        const inlineSnap = parseInternalStates(replyText);
        if (inlineSnap) {
            store.recordSnapshot(index, inlineSnap, { source: 'inline', swipe });
            scheduleHudRefresh(20);
            return;
        }

        const existing = store.getEntryFor(st.uid, swipe);
        if (!force && existing && existing.status === 'synced') return;

        const chatId = ctx.chatId;
        const textHash = hashText(replyText);
        const prose = extractStoryProse(replyText);
        const headerParsed = parseTimeHeader(prose);
        const proseColors = extractProseColors(prose);
        const tail = extractVexaTail(replyText);

        const trackerCtx = {
            allowTrackerProposals: settings.allowTrackerProposals !== false,
            autoAcceptTrackerProposals: Boolean(settings.autoAcceptTrackerProposals),
        };

        // Immediately record deterministic pre-facts + main-model vent/receipt so HUD updates instantaneously
        store.recordDelta(index, {}, {
            source: 'tail',
            swipe,
            status: 'pending',
            ctx: {
                isTurnAdvance: true,
                headerParsed,
                proseColors,
                vent: tail.vent,
                receipt: tail.receipt,
                ...trackerCtx,
            },
        });
        scheduleHudRefresh(10);

        const jobRes = await workerClient.enqueue(
            { label: `Reading turn`, chatId, uid: st.uid, blocksSend: true },
            async ({ signal, send }) => {
                // Rebuild prevState when our queued turn actually runs
                const prevState = store.getStateAt(st.seq - 0.5);
                const { exchange, earlier } = buildExchangeAndEarlier(getContextSafe().chat || [], index, replyText);
                const isFirstTurn = Number(prevState?.world?.ct || 0) === 0;
                const cardHints = isFirstTurn ? getActiveCharacterCardHint() : '';

                if (settings.workerMode === 'split') {
                    const msgs1 = buildWorkerMessages({
                        prevState, exchange, earlier, receipt: tail.receipt, vent: tail.vent,
                        headerParsed, proseColors, cardHints, mode: 'split', part: 'spatial_entity',
                    });
                    const msgs2 = buildWorkerMessages({
                        prevState, exchange, earlier, receipt: tail.receipt, vent: tail.vent,
                        headerParsed, proseColors, cardHints, mode: 'split', part: 'narrative_sim',
                    });
                    const r1 = await send(msgs1);
                    if (signal.aborted) return { aborted: true };
                    const r2 = await send(msgs2);
                    if (signal.aborted) return { aborted: true };
                    return { split: [r1.content, r2.content], meta: [r1, r2] };
                }

                const msgs = buildWorkerMessages({
                    prevState, exchange, earlier, receipt: tail.receipt, vent: tail.vent,
                    headerParsed, proseColors, cardHints, mode: 'combined',
                });
                const res = await send(msgs);
                return { combined: res.content, meta: [res] };
            },
        ).catch((err) => ({ error: extractErrorMessage(err) }));

        // Verify message/swipe/chat wasn't swapped or deleted while worker ran
        const ctxNow = getContextSafe();
        const chatNow = ctxNow.chat || [];
        const at = chatNow.findIndex((m) => m?.extra?.vexa_uid === st.uid);
        const msgNow = at >= 0 ? chatNow[at] : null;
        const textNow = msgNow
            ? (Array.isArray(msgNow.swipes) && typeof msgNow.swipes[swipe] === 'string' ? msgNow.swipes[swipe] : String(msgNow.mes || ''))
            : '';

        if (ctxNow.chatId !== chatId || at < 0 || hashText(textNow) !== textHash) {
            return;
        }

        if (jobRes?.aborted) return;

        if (jobRes?.error) {
            store.recordDelta(at, {}, {
                source: 'worker',
                swipe,
                status: 'error',
                error: jobRes.error,
                ctx: { isTurnAdvance: true, headerParsed, proseColors, vent: tail.vent, receipt: tail.receipt, ...trackerCtx },
            });
            window.toastr?.warning?.(`Worker failed: ${jobRes.error}`, DISPLAY_TITLE);
            scheduleHudRefresh(20);
            return;
        }

        const rawAnswers = jobRes.split ? jobRes.split : [jobRes.combined || ''];
        for (let i = 0; i < rawAnswers.length; i++) {
            const ans = rawAnswers[i];
            if (!String(ans || '').trim() || isWorkerRefusal(ans)) {
                const meta = jobRes.meta?.[i];
                const exhaustedThinking = !String(ans || '').trim()
                    && (meta?.finishReason === 'length' || Boolean(meta?.reasoning));
                const msgErr = isWorkerRefusal(ans)
                    ? 'Worker model refused the story content (switch to a permissive model).'
                    : exhaustedThinking
                        ? 'Worker exhausted max_tokens while thinking; increase Worker Max Tokens.'
                        : 'Worker returned an empty response.';
                store.recordDelta(at, {}, {
                    source: 'worker',
                    swipe,
                    status: 'error',
                    error: msgErr,
                    raw: ans,
                    ctx: { isTurnAdvance: true, headerParsed, proseColors, vent: tail.vent, receipt: tail.receipt, ...trackerCtx },
                });
                window.toastr?.warning?.(msgErr, DISPLAY_TITLE);
                scheduleHudRefresh(20);
                return;
            }
        }

        let mergedDelta = {};
        const errors = [];
        for (const ans of rawAnswers) {
            const parsed = parseWorkerDelta(ans);
            if (parsed.delta) mergedDelta = mergeDeltas(mergedDelta, parsed.delta);
            if (parsed.sectionErrors?.length) errors.push(...parsed.sectionErrors);
        }

        const hasData = Object.keys(mergedDelta).length > 0;
        store.recordDelta(at, mergedDelta, {
            source: 'worker',
            swipe,
            status: hasData ? 'synced' : 'error',
            error: hasData ? (errors.length ? errors.join('; ') : null) : (errors.join('; ') || 'No valid JSON delta parsed'),
            raw: rawAnswers.join('\n---\n'),
            ctx: { isTurnAdvance: true, headerParsed, proseColors, vent: tail.vent, receipt: tail.receipt, ...trackerCtx },
        });
        scheduleHudRefresh(20);
    }

    // Track last received message so GENERATION_ENDED + RetryGuard coordinate cleanly
    let lastReceivedInfo = null;
    let pendingAcceptTimer = null;

    function cancelPendingAccept() {
        if (pendingAcceptTimer) {
            clearTimeout(pendingAcceptTimer);
            pendingAcceptTimer = null;
        }
    }

    async function processReply(index, type, { force = false } = {}) {
        const settings = getSettings();
        if (!settings.enabled) return;
        if (type === 'quiet' || type === 'impersonate') return;
        const chat = getContextSafe().chat || [];
        const target = typeof index === 'number' && index >= 0 ? index : chat.length - 1;
        if (target < 0 || !chat[target] || chat[target].is_user) return;
        await runWorkerExtractionForMessage(target, { force });
    }

    // Integrated Refusal Auto-Retry & Non-Stream Continue runtime
    const retryRuntime = createVexaRetryRuntime({
        getEngineSettings: getSettings,
        getContextSafe,
        onReplyAccepted: ({ messageId, type }) => {
            cancelPendingAccept();
            lastReceivedInfo = null;
            processReply(messageId, type);
        },
        onReplyRetrying: () => {
            cancelPendingAccept();
            lastReceivedInfo = null;
        },
    });

    window.__vexaRetryGuard = {
        version: 3,
        source: 'engine',
        isEnabled: () => retryRuntime.isEnabled(),
        isRetryPending: () => retryRuntime.isRetryPending(),
    };

    // Coordinate with standalone ST-VexaRefusalAutoRetry events when built-in retry is OFF
    window.addEventListener('vexa:reply-retrying', () => {
        if (retryRuntime.isEnabled()) return;
        cancelPendingAccept();
        lastReceivedInfo = null;
    });

    window.addEventListener('vexa:reply-accepted', (ev) => {
        if (retryRuntime.isEnabled()) return;
        cancelPendingAccept();
        const detail = ev?.detail || {};
        const idx = typeof detail.messageId === 'number' ? detail.messageId : lastReceivedInfo?.messageId;
        const type = detail.type || lastReceivedInfo?.type;
        lastReceivedInfo = null;
        processReply(idx, type);
    });

    // Prompt injection on outgoing story request
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (data) => {
        const settings = getSettings();
        if (!settings.enabled || !data || !Array.isArray(data.chat)) return;
        const ctx = getContextSafe();
        const res = transformPromptMessages(data.chat, {
            enabled: settings.enabled,
            forceActive: settings.forceActive,
            presetName: getCurrentPresetName(),
            state: store.getState(),
            hasState: store.hasState(),
            scoped: settings.scoped !== false,
            recentText: recentStoryText(ctx.chat || []),
            allowTrackerProposals: settings.allowTrackerProposals !== false,
        });
        if (res.active) {
            console.debug(`[${DISPLAY_TITLE}] Prompt prepared: stripped=${res.strippedCount}, injected=${res.injected}, chars=${res.snapshotChars}`);
        }
    });

    // Send guard (wait up to 30s if worker still reading last turn) + retry lifecycle
    eventSource.on(event_types.GENERATION_STARTED, async (genType, params, dryRun) => {
        if (!dryRun && genType !== 'quiet') {
            cancelPendingAccept();
            const pending = workerClient.getPendingPromise();
            if (pending) {
                showSendWaitingBanner(() => workerClient.stopAll());
                try {
                    await Promise.race([
                        pending,
                        new Promise((resolve) => setTimeout(resolve, 30000)),
                    ]);
                } finally {
                    hideSendWaitingBanner();
                }
            }
        }
        retryRuntime.onGenerationStarted(genType, params, dryRun);
    });

    eventSource.on(event_types.MESSAGE_RECEIVED, (messageId, type) => {
        lastReceivedInfo = { messageId, type };
        retryRuntime.onMessageReceived(messageId, type);
    });

    eventSource.on(event_types.GENERATION_ENDED, async () => {
        if (retryRuntime.isEnabled()) {
            await retryRuntime.onGenerationEnded();
            return;
        }
        if (!lastReceivedInfo) return;
        const captured = lastReceivedInfo;
        const guard = window.__vexaRetryGuard;
        if (guard && guard.source !== 'engine' && guard.isEnabled?.()) {
            cancelPendingAccept();
            pendingAcceptTimer = setTimeout(() => {
                pendingAcceptTimer = null;
                if (!guard.isRetryPending?.()) {
                    lastReceivedInfo = null;
                    processReply(captured.messageId, captured.type);
                }
            }, 500);
            return;
        }
        lastReceivedInfo = null;
        processReply(captured.messageId, captured.type);
    });

    if (event_types.GENERATION_STOPPED) {
        eventSource.on(event_types.GENERATION_STOPPED, () => {
            cancelPendingAccept();
            lastReceivedInfo = null;
            retryRuntime.onGenerationStopped();
        });
    }

    // Store lifecycle & swipe/edit/delete sync
    eventSource.on(event_types.MESSAGE_SWIPED, (mesId) => {
        store.onSwiped(mesId);
        scheduleHudRefresh(50);
    });
    if (event_types.MESSAGE_SWIPE_DELETED) {
        eventSource.on(event_types.MESSAGE_SWIPE_DELETED, (data) => {
            if (data && typeof data.messageId === 'number') {
                store.onSwipeDeleted(data.messageId, data.swipeId);
            }
            scheduleHudRefresh(50);
        });
    }
    eventSource.on(event_types.MESSAGE_DELETED, () => {
        store.reconcile();
        scheduleHudRefresh(50);
    });
    eventSource.on(event_types.MESSAGE_EDITED, () => {
        store.reconcile();
        scheduleHudRefresh(50);
    });

    function handleImportChat() {
        const n = store.importFromChat({ force: true });
        window.toastr?.success?.(`Imported ${n} state turn(s) from current chat.`, DISPLAY_TITLE);
        scheduleHudRefresh(20);
    }

    function handleRereadLast() {
        const chat = getContextSafe().chat || [];
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i] && !chat[i].is_user) {
                processReply(i, 'manual-reread', { force: true });
                return;
            }
        }
        window.toastr?.info?.('No AI message found to re-read.', DISPLAY_TITLE);
    }

    function handleResetChat() {
        store.reset();
        window.toastr?.info?.('Chat external Vexa state reset.', DISPLAY_TITLE);
        scheduleHudRefresh(20);
    }

    function handleRetryToggleChanged() {
        if (!retryRuntime.isEnabled()) retryRuntime.resetAll();
        retryRuntime.syncButtons();
        syncSettingsUI(getSettings());
        appPopup?.syncChrome?.();
    }

    function handleSettingsChanged() {
        if (!retryRuntime.isEnabled()) retryRuntime.resetAll();
        retryRuntime.syncButtons();
        syncSettingsUI(getSettings());
        appPopup?.syncChrome?.();
        scheduleHudRefresh(20);
    }

    appPopup = createVexaAppPopup({
        store,
        getSettings,
        saveSettings,
        getContextSafe,
        workerClient,
        getWorkerStatus: () => workerStatus,
        getRecentStoryText: () => recentStoryText(getContextSafe().chat || []),
        onImportChat: handleImportChat,
        onRereadLast: handleRereadLast,
        onResetChat: handleResetChat,
        onCleanLastRefusal: () => retryRuntime.cleanLastMessageManually(),
        onRetryToggleChanged: handleRetryToggleChanged,
        onSettingsChanged: handleSettingsChanged,
        onStateSaved: () => scheduleHudRefresh(10),
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        cancelPendingAccept();
        lastReceivedInfo = null;
        retryRuntime.onChatChanged();
        const chatAtEvent = getContextSafe().chatId;
        workerClient.stopForOtherChats(chatAtEvent);
        appPopup?.syncChrome?.();
        setTimeout(() => {
            if (getContextSafe().chatId !== chatAtEvent) return;
            store.reconcile();
            // Auto-import once when opening an existing vanilla Vexa chat
            const chat = getContextSafe().chat || [];
            if (!store.hasState() && chat.some((m) => /<internal_states>/i.test(String(m?.mes || '')))) {
                const n = store.importFromChat();
                if (n > 0) window.toastr?.info?.(`Imported ${n} existing Vexa state turn(s) into external store.`, DISPLAY_TITLE);
            }
            appPopup?.refresh?.();
            scheduleHudRefresh(60);
        }, 250);
    });

    for (const evt of [event_types.CHARACTER_MESSAGE_RENDERED, event_types.MESSAGE_UPDATED, event_types.MORE_MESSAGES_LOADED]) {
        if (evt) eventSource.on(evt, () => scheduleHudRefresh(90));
    }

    function wireUi() {
        retryRuntime.syncButtons();
        appPopup?.mount?.();
        injectSettingsUI({
            getSettings,
            saveSettings,
            getContextSafe,
            workerClient,
            onOpenPopup: () => appPopup?.open?.(),
            onImportChat: handleImportChat,
            onOpenEditor: () => {
                if (appPopup) {
                    appPopup.open({ tab: 'overview' });
                } else {
                    openStateEditorModal({ store, onSaved: () => scheduleHudRefresh(10) });
                }
            },
            onPreviewPrompt: () => {
                if (appPopup) {
                    appPopup.open({ tab: 'tools' });
                    return;
                }
                const ctx = getContextSafe();
                const xml = serializeInternalStates(store.getState(), {
                    scoped: getSettings().scoped !== false,
                    recentText: recentStoryText(ctx.chat || []),
                    includeVent: false,
                });
                const textType = ctx.POPUP_TYPE?.TEXT ?? 1;
                if (typeof ctx.callGenericPopup === 'function') {
                    ctx.callGenericPopup(`<textarea class="text_pole" rows="20" style="width:100%;font-family:monospace;font-size:12px;" readonly>${xml.replace(/</g, '&lt;')}</textarea>`, textType, 'Compiled State Snapshot Preview', { wide: true, large: true });
                } else {
                    console.log(`[${DISPLAY_TITLE}] Snapshot Preview (${xml.length} chars):\n`, xml);
                    window.toastr?.info?.(`Snapshot length: ${xml.length} chars (~${Math.round(xml.length / 4)} tokens). See console.`, DISPLAY_TITLE);
                }
            },
            onRereadLast: handleRereadLast,
            onResetChat: handleResetChat,
            onCleanLastRefusal: () => retryRuntime.cleanLastMessageManually(),
            onRetryToggleChanged: handleRetryToggleChanged,
            onSettingsChanged: handleSettingsChanged,
        });
        syncSettingsUI(getSettings());
    }

    wireUi();
    if (event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, () => {
            wireUi();
            scheduleHudRefresh(150);
        });
    }
});
