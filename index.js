/**
 * Lapis Philosophorum Engine (LPE) — Main SillyTavern Extension Entrypoint.
 *
 * Coordinates:
 *  - Swipe-safe journaled state store in chat_metadata.lpe_state (migrating legacy vexa_state)
 *  - Non-destructive prompt injection & history stripping on CHAT_COMPLETION_PROMPT_READY
 *  - Send guard on GENERATION_STARTED (waits up to 30s if worker still processing last turn)
 *  - Post-reply worker execution ("LPE Clerk") coordinated with built-in or standalone Refusal Auto-Retry
 *  - Native themed JS HUD + WebGL/PolyCSS/SVG Atlas map + Inline Editor + Settings UI
 */

import {
    extractStoryProse,
    parseTimeHeader,
    extractProseColors,
    extractLpeTail,
    stripGfxBlocks,
} from './src/schema.js';
import { parseInternalStates, serializeInternalStates } from './src/parser.js';
import { parseWorkerDelta, approveTrackerProposal, dismissTrackerProposal } from './src/reducer.js';
import {
    createLpeStateStore,
    migrateLegacyExtensionSettings,
    getMessageStamp,
} from './src/store.js';
import { buildWorkerMessages } from './src/workerPrompt.js';
import { createWorkerClient, isWorkerRefusal, extractErrorMessage } from './src/workerClient.js';
import { transformPromptMessages, evaluatePromptMessagesEjs } from './src/promptInjector.js';
import {
    hasEjsTags,
    shouldYieldEjs,
    buildReadOnlyLpeSnapshot,
    evaluateEjs,
    substituteLpeMacros,
    tryParseInitVarsFromEntries,
} from './src/ejsEngine.js';
import { createCardBridgeHost } from './src/cardBridge.js';
import { installHljsGuard, uninstallHljsGuard, createCardRenderer, shouldYieldRenderer } from './src/cardRenderer.js';
import { refreshAllHudCards, alignAllHudThemes } from './src/hud.js';
import { openStateEditorModal } from './src/editor.js';
import { injectSettingsUI, syncSettingsUI } from './src/settingsUi.js';
import { createLpeAppPopup, mapHudTabToAppTab } from './src/appPopup.js';
import { DEFAULT_END_MARKER } from './src/retryDetector.js';
import { createLpeRetryRuntime } from './src/retryRuntime.js';
import {
    getContextSafe,
    saveSettingsDebounced,
    saveMetadataDebounced,
    saveChatDebounced,
    getCurrentPresetName,
    getActiveCharacterCardHint,
} from './src/st.js';

const MODULE_NAME = 'lapis_philosophorum_engine';
const LEGACY_MODULE_NAME = 'vexa_state_engine';
const DISPLAY_TITLE = 'Lapis Philosophorum Engine (LPE)';
const LOG_PREFIX = '[LPE]';

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
    hudTheme: 'Magnum Opus',
    hudStyle: 'Afterglow',
    atlasViewMode: 'webgl',
    defaultBodyType: 'male',
    showLauncherButton: true,
    hudDefaultCollapsed: true,
    showInlineChanges: true,
    spatialGrounding: true,
    pinNotebookRules: true,
    enforceMatrixStepCap: true,
    allowTrackerProposals: true,
    autoAcceptTrackerProposals: false,
    ejsEnabled: true,
    ejsEvalWorldInfo: true,
    ejsEvalPrompts: true,
    ejsAutoYield: true,
    rendererEnabled: true,
    rendererUseBlobUrl: true,
    rendererDepth: 2,
    rendererCollapseCode: 'frontend',
    rendererSkipHljs: true,
    rendererMaxHtmlKb: 2048,
    rendererAllowExternalResources: false,
    rendererAllowAutoSend: false,
    rendererAutoYield: true,
    retry: DEFAULT_RETRY_SETTINGS,
});

function getSettings() {
    const ctx = getContextSafe();
    if (!ctx.extensionSettings) {
        return { ...DEFAULT_SETTINGS, retry: { ...DEFAULT_RETRY_SETTINGS } };
    }
    return migrateLegacyExtensionSettings(ctx.extensionSettings, DEFAULT_SETTINGS, DEFAULT_RETRY_SETTINGS, {
        moduleName: MODULE_NAME,
        legacyModuleName: LEGACY_MODULE_NAME,
    });
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
    const aiName = chat[index]?.name || 'Storyteller';
    const exchange = [...userMsgs, `${aiName}: ${extractStoryProse(replyText)}`].join('\n\n');

    const earlier = chat.slice(Math.max(0, start - 3), start)
        .filter(Boolean)
        .map((m) => `${m.name || (m.is_user ? 'User' : aiName)}: ${extractStoryProse(m.mes || '')}`)
        .join('\n\n');
    return { exchange, earlier };
}

function showSendWaitingBanner(onStop) {
    $('#lpe_wait_banner').remove();
    const $form = $('#send_form');
    if (!$form.length) return false;
    const $banner = $(`
        <div id="lpe_wait_banner">
            <span><i class="fa-solid fa-spinner fa-spin"></i> LPE Clerk is finishing last turn's state update...</span>
            <button type="button" class="menu_button" id="lpe_wait_stop_btn">Skip &amp; Send Now</button>
        </div>
    `);
    $banner.find('#lpe_wait_stop_btn').on('click', () => onStop?.());
    $form.prepend($banner);
    return true;
}

function hideSendWaitingBanner() {
    $('#lpe_wait_banner').remove();
}

jQuery(() => {
    const ctx0 = getContextSafe();
    const { eventSource, event_types } = ctx0;
    if (!eventSource || !event_types) {
        console.error(`${LOG_PREFIX} SillyTavern eventSource unavailable.`);
        return;
    }

    const store = createLpeStateStore({
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
    let rendererTimer = null;
    let chatEpoch = 0;
    let lastWiEntries = [];
    let appPopup = null;

    function fillChatComposer(text) {
        const ta = document.getElementById('send_textarea');
        if (!ta) return false;
        ta.value = String(text || '');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.focus?.();
        return true;
    }

    function clickChatSend() {
        const btn = document.getElementById('send_but');
        if (!btn) return false;
        btn.click();
        return true;
    }

    const getStateForMesId = (mesId) => {
        const chat = getContextSafe().chat || [];
        const msg = Number.isFinite(mesId) ? chat[mesId] : null;
        const { seq } = getMessageStamp(msg);
        return typeof seq === 'number' ? store.getStateAt(seq) : store.getState();
    };

    const cardBridgeHost = createCardBridgeHost({
        getSettings,
        getStateForMessage: getStateForMesId,
        store,
        onFillInput: (text) => {
            fillChatComposer(text);
        },
        onSubmitInput: (text, entry, { autoSend } = {}) => {
            if (autoSend) {
                fillChatComposer(text);
                clickChatSend();
            } else {
                // Stage inside confirmation bar WITHOUT overwriting user's in-progress composer draft
                cardRenderer?.showConfirmSendBar?.(entry.token, text);
            }
        },
        onToast: (text, level) => {
            const fn = window.toastr?.[level] || window.toastr?.info;
            fn?.(text, DISPLAY_TITLE);
        },
        onVarsUpdated: () => {
            appPopup?.refresh?.();
        },
    });

    const cardRenderer = createCardRenderer({
        getSettings,
        bridgeHost: cardBridgeHost,
        getStateForMesId,
        store,
        onConfirmSend: (text) => {
            fillChatComposer(text);
            clickChatSend();
        },
    });

    installHljsGuard(getSettings);

    function scheduleRendererRefresh(delay = 80, epoch = chatEpoch) {
        if (rendererTimer) clearTimeout(rendererTimer);
        rendererTimer = setTimeout(() => {
            rendererTimer = null;
            if (epoch !== chatEpoch) return;
            cardRenderer.refreshAll();
        }, delay);
    }

    function cancelScheduledRefreshes() {
        if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
        if (rendererTimer) { clearTimeout(rendererTimer); rendererTimer = null; }
    }

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
                    const { seq } = getMessageStamp(msg);
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
                onToggleEntryDisabled: (mesId, nextDisabled) => {
                    const msg = (getContextSafe().chat || [])[mesId];
                    const { uid } = getMessageStamp(msg);
                    const swipe = typeof msg?.swipe_id === 'number' ? msg.swipe_id : 0;
                    const entry = uid ? store.getEntryFor(uid, swipe) : null;
                    if (!entry?.id) return;
                    store.setDisabled(entry.id, nextDisabled);
                    window.toastr?.info?.(
                        nextDisabled ? 'Reverted this reply’s state changes.' : 'Restored this reply’s state changes.',
                        DISPLAY_TITLE,
                    );
                    scheduleHudRefresh(10);
                },
            });
            cardBridgeHost.broadcastState(store.getState());
            scheduleRendererRefresh(15);
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
        const tail = extractLpeTail(replyText);

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
        const at = chatNow.findIndex((m) => getMessageStamp(m).uid === st.uid);
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
    const retryRuntime = createLpeRetryRuntime({
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

    const retryGuard = {
        version: 3,
        source: 'engine',
        isEnabled: () => retryRuntime.isEnabled(),
        isRetryPending: () => retryRuntime.isRetryPending(),
    };
    window.__lpeRetryGuard = retryGuard;
    window.__vexaRetryGuard = retryGuard;

    // Coordinate with standalone Refusal Auto-Retry events when built-in retry is OFF
    const onExternalRetrying = () => {
        if (retryRuntime.isEnabled()) return;
        cancelPendingAccept();
        lastReceivedInfo = null;
    };
    const onExternalAccepted = (ev) => {
        if (retryRuntime.isEnabled()) return;
        cancelPendingAccept();
        const detail = ev?.detail || {};
        const idx = typeof detail.messageId === 'number' ? detail.messageId : lastReceivedInfo?.messageId;
        const type = detail.type || lastReceivedInfo?.type;
        lastReceivedInfo = null;
        processReply(idx, type);
    };
    window.addEventListener('lpe:reply-retrying', onExternalRetrying);
    window.addEventListener('vexa:reply-retrying', onExternalRetrying);
    window.addEventListener('lpe:reply-accepted', onExternalAccepted);
    window.addEventListener('vexa:reply-accepted', onExternalAccepted);

    // Prompt injection + scoped EJS / card macro evaluation on outgoing story request
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
            spatialGrounding: settings.spatialGrounding !== false,
        });
        if (res.active) {
            console.debug(`${LOG_PREFIX} Prompt prepared: stripped=${res.strippedCount}, injected=${res.injected}, chars=${res.snapshotChars}`);
        }
        if (settings.ejsEnabled !== false && settings.ejsEvalPrompts !== false) {
            const ejsRes = evaluatePromptMessagesEjs(data.chat, {
                enabled: true,
                autoYield: settings.ejsAutoYield !== false,
                state: store.getState(),
                cardVars: store.getCardVars(),
                setCardVar: (path, val) => {
                    const wr = store.setCardVar(path, val);
                    if (wr?.ok) cardBridgeHost.broadcastVars(store.getCardVars());
                    return Boolean(wr?.ok);
                },
                wiEntries: lastWiEntries,
                charName: ctx.name2 || '',
                userName: ctx.name1 || '',
            });
            if (ejsRes.errors?.length) {
                console.warn(`${LOG_PREFIX} Prompt EJS warning:`, ejsRes.errors);
            }
        }
    });

    if (event_types.WORLDINFO_ENTRIES_LOADED) {
        eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, (payload) => {
            const settings = getSettings();
            if (!settings.enabled || !payload || typeof payload !== 'object') return;
            const buckets = [
                payload.globalLore,
                payload.characterLore,
                payload.chatLore,
                payload.personaLore,
            ];
            const allEntries = buckets.flatMap((b) => (Array.isArray(b) ? b : []));
            lastWiEntries = allEntries.map((e) => ({
                comment: e?.comment || '',
                key: e?.key || '',
                content: e?.content || '',
            }));

            const initVars = tryParseInitVarsFromEntries(allEntries);
            if (initVars && store.seedCardVarsIfEmpty(initVars)) {
                cardBridgeHost.broadcastVars(store.getCardVars());
            }

            if (settings.ejsEnabled === false || settings.ejsEvalWorldInfo === false || shouldYieldEjs(settings)) {
                return;
            }
            const ctx = getContextSafe();
            const curState = store.getState();
            const frozenState = buildReadOnlyLpeSnapshot(curState);
            const cardVars = store.getCardVars();

            for (const entry of allEntries) {
                if (!entry || typeof entry.content !== 'string') continue;
                let text = entry.content;
                if (hasEjsTags(text)) {
                    const res = evaluateEjs(text, {
                        frozenState,
                        state: curState,
                        cardVars,
                        wiEntries: lastWiEntries,
                        charName: ctx.name2 || '',
                        userName: ctx.name1 || '',
                    });
                    if (res.ok) text = res.text;
                    else console.warn(`${LOG_PREFIX} WI EJS error in "${entry.comment || entry.uid}": ${res.error}`);
                }
                if (text.includes('{{')) {
                    text = substituteLpeMacros(text, { frozenState, state: curState, cardVars });
                }
                entry.content = text;
            }
        });
    }

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
        const guard = window.__lpeRetryGuard || window.__vexaRetryGuard;
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
        window.toastr?.info?.('Chat external LPE state reset.', DISPLAY_TITLE);
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
        const cur = getSettings();
        if (!cur.enabled || !cur.rendererEnabled || shouldYieldRenderer(cur)) {
            cardRenderer.teardownAll();
            cardBridgeHost.unregisterAll();
        }
        if (!cur.enabled) lastWiEntries = [];
        appPopup?.syncChrome?.();
        scheduleHudRefresh(20);
        scheduleRendererRefresh(25);
    }

    function handleAlignHudThemes(theme, style) {
        const s = getSettings();
        const count = alignAllHudThemes(theme || s.hudTheme || 'Sola', style || s.hudStyle || 'Afterglow');
        window.toastr?.success?.(
            `Aligned ${count} HUD card${count === 1 ? '' : 's'} to ${theme || s.hudTheme || 'Sola'} / ${style || s.hudStyle || 'Afterglow'}.`,
            DISPLAY_TITLE,
        );
        return count;
    }

    appPopup = createLpeAppPopup({
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
        onAlignHudThemes: handleAlignHudThemes,
        onSettingsChanged: handleSettingsChanged,
        onStateSaved: () => scheduleHudRefresh(10),
        getRuntimeStats: () => ({
            ...cardRenderer.getStats(),
            ...cardBridgeHost.getStats(),
        }),
        onCardVarsChanged: (nextVars) => {
            cardBridgeHost.broadcastVars(nextVars);
        },
    });

    function seedEmbeddedCharacterInitVars() {
        const ctxNow = getContextSafe();
        if (!ctxNow?.chatId) return false;
        const chId = Number(ctxNow.characterId);
        const activeChar = Number.isFinite(chId) && Array.isArray(ctxNow.characters) ? ctxNow.characters[chId] : null;
        const embeddedEntries = activeChar?.data?.character_book?.entries;
        if (!embeddedEntries) return false;
        const initVars = tryParseInitVarsFromEntries(embeddedEntries);
        if (!initVars || !store.seedCardVarsIfEmpty(initVars)) return false;
        cardBridgeHost.broadcastVars(store.getCardVars());
        return true;
    }

    eventSource.on(event_types.CHAT_CHANGED, () => {
        const myEpoch = ++chatEpoch;
        cancelPendingAccept();
        cancelScheduledRefreshes();
        lastReceivedInfo = null;
        lastWiEntries = [];
        cardRenderer.teardownAll();
        cardBridgeHost.unregisterAll();
        retryRuntime.onChatChanged();
        const chatAtEvent = getContextSafe().chatId;
        workerClient.stopForOtherChats(chatAtEvent);
        appPopup?.syncChrome?.();
        setTimeout(() => {
            if (myEpoch !== chatEpoch || getContextSafe().chatId !== chatAtEvent) return;
            store.reconcile();
            seedEmbeddedCharacterInitVars();
            // Auto-import once when opening an existing classic chat containing <internal_states>
            const chat = getContextSafe().chat || [];
            if (!store.hasState() && chat.some((m) => /<internal_states>/i.test(String(m?.mes || '')))) {
                const n = store.importFromChat();
                if (n > 0) window.toastr?.info?.(`Imported ${n} existing state turn(s) into LPE external store.`, DISPLAY_TITLE);
            }
            appPopup?.refresh?.();
            scheduleHudRefresh(60);
            scheduleRendererRefresh(80, myEpoch);
        }, 250);
    });

    for (const evt of [
        event_types.CHARACTER_MESSAGE_RENDERED,
        event_types.USER_MESSAGE_RENDERED,
        event_types.MESSAGE_UPDATED,
        event_types.MORE_MESSAGES_LOADED,
    ]) {
        if (evt) eventSource.on(evt, () => {
            seedEmbeddedCharacterInitVars();
            scheduleHudRefresh(90);
            scheduleRendererRefresh(95);
        });
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
                    console.log(`${LOG_PREFIX} Snapshot Preview (${xml.length} chars):\n`, xml);
                    window.toastr?.info?.(`Snapshot length: ${xml.length} chars (~${Math.round(xml.length / 4)} tokens). See console.`, DISPLAY_TITLE);
                }
            },
            onRereadLast: handleRereadLast,
            onResetChat: handleResetChat,
            onCleanLastRefusal: () => retryRuntime.cleanLastMessageManually(),
            onRetryToggleChanged: handleRetryToggleChanged,
            onAlignHudThemes: handleAlignHudThemes,
            onSettingsChanged: handleSettingsChanged,
        });
        syncSettingsUI(getSettings());
    }

    wireUi();
    if (event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, () => {
            installHljsGuard(getSettings);
            wireUi();
            scheduleHudRefresh(150);
            scheduleRendererRefresh(180);
        });
    }

    const disposeAll = () => {
        cancelPendingAccept();
        cancelScheduledRefreshes();
        cardRenderer.teardownAll();
        cardBridgeHost.destroy();
        uninstallHljsGuard();
    };
    window.__lpeDispose = disposeAll;
    window.__vexaStateEngineDispose = disposeAll;
});
