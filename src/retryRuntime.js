/**
 * SillyTavern DOM, non-stream toggle, trigger cascade, and UI runtime for
 * the integrated Refusal Auto-Retry & Non-Stream Continue module.
 */

import {
    detectRefusal,
    endsWithRequiredMarker,
    DEFAULT_END_MARKER,
} from './retryDetector.js';
import { VexaRetryController } from './retryController.js';

const LOG_PREFIX = '[VexaStateEngine:Retry]';
const DISPLAY_TITLE = 'Vexa State Engine';

const SEND_BAR_BTN_ID = 'non_stream_continue_btn';
const OPTION_ITEM_ID = 'option_continue_no_stream';

const STREAM_CHECKBOX_BY_API = {
    openai: '#stream_toggle',
    textgenerationwebui: '#streaming_textgenerationwebui',
    kobold: '#streaming_kobold',
    novel: '#streaming_nai',
};

function escapeHtml(text) {
    return $('<div>').text(String(text ?? '')).html();
}

export function createVexaRetryRuntime({
    getEngineSettings,
    getContextSafe,
    onReplyAccepted = () => {},
    onReplyRetrying = () => {},
}) {
    let scriptModulePromise = null;
    let cachedScriptModule = null;

    let heldStreamBox = null;
    let heldWasStreaming = false;
    let manualNscInFlight = false;

    let generationStartCounter = 0;
    let activeTriggerToken = 0;
    let activeTriggerTimer = null;

    function getEffectiveRetrySettings() {
        const eng = getEngineSettings() || {};
        const r = eng.retry || {};
        return {
            ...r,
            enabled: Boolean(eng.enabled && r.enabled !== false),
        };
    }

    function loadScriptModule() {
        if (cachedScriptModule) return Promise.resolve(cachedScriptModule);
        if (!scriptModulePromise) {
            scriptModulePromise = (async () => {
                for (const relPath of ['../../../../../script.js', '../../../../script.js', '../../../script.js']) {
                    try {
                        const mod = await import(relPath);
                        if (mod) {
                            cachedScriptModule = mod;
                            return mod;
                        }
                    } catch {
                        // Try next fallback path
                    }
                }
                return null;
            })();
        }
        return scriptModulePromise;
    }

    function isSillyTavernBusy() {
        const ctx = getContextSafe();
        if (cachedScriptModule && typeof cachedScriptModule.is_send_press === 'boolean') {
            if (cachedScriptModule.is_send_press) return true;
        } else {
            const $sendBut = $('#send_but');
            if ($sendBut.length && $sendBut.hasClass('displayNone')) return true;
        }
        if (ctx.streamingProcessor) return true;
        if ($('#mes_stop').is(':visible')) return true;
        return false;
    }

    function getActiveStreamCheckbox() {
        const ctx = getContextSafe();
        const api = ctx.mainApi ?? ctx.main_api;
        const mappedSelector = STREAM_CHECKBOX_BY_API[api];

        if (mappedSelector) {
            const $el = $(mappedSelector);
            if ($el.length) return $el;
        }

        for (const selector of Object.values(STREAM_CHECKBOX_BY_API)) {
            const $el = $(selector);
            if ($el.length && $el.prop('checked')) return $el;
        }

        return $();
    }

    function setNscBusy(busy) {
        $(`#${SEND_BAR_BTN_ID}, #${OPTION_ITEM_ID}`).toggleClass('nsc-busy', busy);
    }

    function ensureNonStreamMode() {
        const $box = getActiveStreamCheckbox();
        if (!$box.length) return;

        if (!heldStreamBox && $box.prop('checked')) {
            heldStreamBox = $box;
            heldWasStreaming = true;
        }

        if ($box.prop('checked')) {
            $box.prop('checked', false).trigger('change');
        }
    }

    function restoreStreamMode() {
        if (heldWasStreaming && heldStreamBox && heldStreamBox.length) {
            if (!heldStreamBox.prop('checked')) {
                heldStreamBox.prop('checked', true).trigger('change');
            }
        }
        heldStreamBox = null;
        heldWasStreaming = false;
    }

    async function resolveUpdateMessageBlock() {
        const ctx = getContextSafe();
        if (typeof ctx.updateMessageBlock === 'function') {
            return ctx.updateMessageBlock;
        }
        const mod = await loadScriptModule();
        if (typeof mod?.updateMessageBlock === 'function') {
            return mod.updateMessageBlock;
        }
        return null;
    }

    async function applyCleanedMessage(msgId, cleanedMes) {
        const ctx = getContextSafe();
        const chat = ctx.chat;
        if (!Array.isArray(chat) || !chat[msgId]) return;

        const msg = chat[msgId];
        msg.mes = cleanedMes;

        if (
            Array.isArray(msg.swipes) &&
            typeof msg.swipe_id === 'number' &&
            msg.swipe_id >= 0 &&
            msg.swipe_id < msg.swipes.length
        ) {
            msg.swipes[msg.swipe_id] = cleanedMes;
        }

        if (msg.extra && typeof msg.extra.display_text === 'string') {
            delete msg.extra.display_text;
        }

        if (cleanedMes.replace(/[\s\u2800]+/g, '').length === 0 && msg.extra && typeof msg.extra.reasoning === 'string') {
            delete msg.extra.reasoning;
        }

        const updateFn = await resolveUpdateMessageBlock();
        if (typeof updateFn === 'function') {
            updateFn(msgId, msg);
        } else {
            const $mesText = $(`#chat .mes[mesid="${msgId}"] .mes_text`);
            if ($mesText.length) {
                if (typeof ctx.messageFormatting === 'function') {
                    $mesText.html(
                        ctx.messageFormatting(
                            cleanedMes,
                            msg.name,
                            Boolean(msg.is_system),
                            Boolean(msg.is_user),
                            msgId,
                        ),
                    );
                } else {
                    $mesText.text(cleanedMes);
                }
            }
        }

        if (typeof ctx.saveChat === 'function') {
            try {
                await ctx.saveChat();
            } catch (err) {
                console.warn(`${LOG_PREFIX} saveChat failed:`, err);
            }
        }
    }

    function cancelPendingTrigger() {
        activeTriggerToken += 1;
        if (activeTriggerTimer !== null) {
            clearTimeout(activeTriggerTimer);
            activeTriggerTimer = null;
        }
    }

    function scheduleTriggerStep(fn, delayMs) {
        if (activeTriggerTimer !== null) {
            clearTimeout(activeTriggerTimer);
        }
        activeTriggerTimer = setTimeout(() => {
            activeTriggerTimer = null;
            fn();
        }, delayMs);
    }

    function triggerGenerationWithFallback(action, hooks = {}) {
        cancelPendingTrigger();
        const token = activeTriggerToken;
        const waitStart = Date.now();
        const maxIdleWaitMs = 15000;

        const waitForIdle = () => {
            if (token !== activeTriggerToken) return;

            if (isSillyTavernBusy()) {
                if (Date.now() - waitStart >= maxIdleWaitMs) {
                    console.warn(`${LOG_PREFIX} Timed out waiting for SillyTavern to become idle before ${action}.`);
                    hooks.onFailed?.();
                    return;
                }
                scheduleTriggerStep(waitForIdle, 150);
                return;
            }

            scheduleTriggerStep(() => {
                if (token !== activeTriggerToken) return;
                if (isSillyTavernBusy()) {
                    waitForIdle();
                    return;
                }
                runStrategies();
            }, 150);
        };

        const runStrategies = async () => {
            if (token !== activeTriggerToken) return;

            await loadScriptModule();
            if (token !== activeTriggerToken) return;

            const ctx = getContextSafe();
            const slashExec = typeof ctx.executeSlashCommandsWithOptions === 'function'
                ? (cmd) => ctx.executeSlashCommandsWithOptions(cmd)
                : (typeof ctx.executeSlashCommands === 'function'
                    ? (cmd) => ctx.executeSlashCommands(cmd)
                    : null);

            const directGen = typeof ctx.generate === 'function'
                ? ctx.generate
                : (typeof cachedScriptModule?.Generate === 'function' ? cachedScriptModule.Generate : null);

            const strategies = action === 'continue'
                ? [
                    {
                        name: '#option_continue',
                        run: () => {
                            const $btn = $('#option_continue');
                            if (!$btn.length) return false;
                            $btn.trigger('click');
                            return true;
                        },
                    },
                    {
                        name: 'slash /continue',
                        run: () => {
                            if (!slashExec) return false;
                            Promise.resolve(slashExec('/continue')).catch((e) => console.warn(`${LOG_PREFIX} /continue failed:`, e));
                            return true;
                        },
                    },
                    {
                        name: 'Generate(continue)',
                        run: () => {
                            if (!directGen) return false;
                            Promise.resolve(directGen('continue')).catch((e) => console.warn(`${LOG_PREFIX} Generate(continue) failed:`, e));
                            return true;
                        },
                    },
                ]
                : [
                    {
                        name: '#option_regenerate',
                        run: () => {
                            const $btn = $('#option_regenerate');
                            if (!$btn.length) return false;
                            $btn.trigger('click');
                            return true;
                        },
                    },
                    {
                        name: 'slash /regenerate',
                        run: () => {
                            if (!slashExec) return false;
                            Promise.resolve(slashExec('/regenerate')).catch((e) => console.warn(`${LOG_PREFIX} /regenerate failed:`, e));
                            return true;
                        },
                    },
                    {
                        name: 'Generate(regenerate)',
                        run: () => {
                            if (!directGen || ctx.groupId) return false;
                            Promise.resolve(directGen('regenerate')).catch((e) => console.warn(`${LOG_PREFIX} Generate(regenerate) failed:`, e));
                            return true;
                        },
                    },
                    {
                        name: '.last_mes .swipe_right',
                        run: () => {
                            const $swipe = $('.last_mes .swipe_right').first();
                            if (!$swipe.length) return false;
                            $swipe.trigger('click');
                            return true;
                        },
                    },
                ];

            const tryIndex = (idx) => {
                if (token !== activeTriggerToken) return;

                if (idx >= strategies.length) {
                    console.warn(`${LOG_PREFIX} All ${action} trigger strategies failed to start a generation.`);
                    window.toastr?.error?.(
                        `Auto-${action} could not start a new generation. Check DevTools console (${LOG_PREFIX}) for details.`,
                        DISPLAY_TITLE,
                    );
                    hooks.onFailed?.();
                    return;
                }

                const strat = strategies[idx];
                const startCountBefore = generationStartCounter;

                ensureNonStreamMode();
                hooks.onBeforeAttempt?.();

                let invoked = false;
                try {
                    invoked = Boolean(strat.run());
                } catch (err) {
                    console.warn(`${LOG_PREFIX} Strategy "${strat.name}" threw:`, err);
                }

                if (!invoked) {
                    tryIndex(idx + 1);
                    return;
                }

                scheduleTriggerStep(() => {
                    if (token !== activeTriggerToken) return;
                    if (generationStartCounter > startCountBefore || isSillyTavernBusy()) {
                        return;
                    }
                    tryIndex(idx + 1);
                }, 700);
            };

            tryIndex(0);
        };

        waitForIdle();
    }

    function showFailurePopup(message) {
        const settings = getEffectiveRetrySettings();
        const ctx = getContextSafe();

        if (settings.useModalPopup !== false && typeof ctx.callGenericPopup === 'function') {
            const textType = ctx.POPUP_TYPE?.TEXT ?? 1;
            ctx.callGenericPopup(
                `<div class="vse-rar-popup-message">${escapeHtml(message)}</div>`,
                textType,
                '',
                { okButton: 'OK' },
            );
            return;
        }

        if (window.toastr?.error) {
            window.toastr.error(escapeHtml(message), DISPLAY_TITLE, {
                timeOut: 0,
                extendedTimeOut: 0,
                closeButton: true,
            });
            return;
        }

        window.alert(message);
    }

    function notifyRetry({ reason, attempt, maxAttempts, action }) {
        const verb = action === 'continue' ? 'continuing (No Stream)' : 'regenerating (No Stream)';
        const countLabel = maxAttempts > 0 ? `${attempt}/${maxAttempts}` : `#${attempt}`;
        const endMarkerText = getEffectiveRetrySettings().endMarker || DEFAULT_END_MARKER;
        const why = reason === 'refusal'
            ? 'Safety refusal detected — deleted refusal'
            : `Reply missing ${endMarkerText}`;

        window.toastr?.warning?.(
            escapeHtml(`${why}; ${verb} (${countLabel})...`),
            DISPLAY_TITLE,
            { timeOut: 3000 },
        );
    }

    const controller = new VexaRetryController({
        getSettings: getEffectiveRetrySettings,
        getChat: () => getContextSafe().chat || [],
        applyCleanedMessage,
        ensureNonStreamMode,
        restoreStreamMode,
        triggerContinueNonStream: (hooks) => triggerGenerationWithFallback('continue', hooks),
        triggerRegenerateNonStream: (hooks) => triggerGenerationWithFallback('regenerate', hooks),
        cancelPendingTrigger,
        notifyRetry,
        showFailurePopup,
        onReplyAccepted: (detail) => {
            window.dispatchEvent(new CustomEvent('vexa:reply-accepted', { detail }));
            onReplyAccepted(detail);
        },
        onReplyRetrying: (detail) => {
            window.dispatchEvent(new CustomEvent('vexa:reply-retrying', { detail }));
            onReplyRetrying(detail);
        },
        schedule: (fn, delayMs) => setTimeout(fn, delayMs),
        cancelSchedule: (handle) => clearTimeout(handle),
    });

    function runNonStreamContinue(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (manualNscInFlight) return;

        if (isSillyTavernBusy()) {
            window.toastr?.warning?.('A generation is already in progress.', DISPLAY_TITLE);
            return;
        }

        const $continueBtn = $('#option_continue');
        if (!$continueBtn.length) {
            window.toastr?.error?.('Could not find #option_continue.', DISPLAY_TITLE);
            return;
        }

        const { eventSource, event_types } = getContextSafe();
        if (!eventSource || !event_types) {
            window.toastr?.error?.('SillyTavern event system is not available.', DISPLAY_TITLE);
            return;
        }

        controller.cancelPendingRetry();

        manualNscInFlight = true;
        setNscBusy(true);
        ensureNonStreamMode();

        let generationStarted = false;
        let fallbackTimer = null;

        const onStarted = () => {
            generationStarted = true;
        };

        const cleanup = () => {
            if (!manualNscInFlight) return;
            manualNscInFlight = false;
            setNscBusy(false);

            if (fallbackTimer !== null) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }
            eventSource.removeListener(event_types.GENERATION_STARTED, onStarted);
            eventSource.removeListener(event_types.GENERATION_ENDED, cleanup);
            eventSource.removeListener(event_types.GENERATION_STOPPED, cleanup);

            if (!getEffectiveRetrySettings().enabled) {
                restoreStreamMode();
            }
        };

        eventSource.on(event_types.GENERATION_STARTED, onStarted);
        eventSource.on(event_types.GENERATION_ENDED, cleanup);
        eventSource.on(event_types.GENERATION_STOPPED, cleanup);

        fallbackTimer = setTimeout(() => {
            if (!generationStarted && !isSillyTavernBusy()) {
                cleanup();
                restoreStreamMode();
            }
        }, 2000);

        $continueBtn.trigger('click');
    }

    function syncButtons() {
        const eff = getEffectiveRetrySettings();
        const show = eff.enabled && eff.showNonStreamContinue !== false;

        if (!show) {
            $(`#${SEND_BAR_BTN_ID}[data-vse-nsc="1"]`).remove();
            $(`#${OPTION_ITEM_ID}[data-vse-nsc="1"]`).remove();
            return;
        }

        if (!$(`#${SEND_BAR_BTN_ID}`).length) {
            const $btn = $('<div>', {
                id: SEND_BAR_BTN_ID,
                class: 'fa-solid fa-forward interactable',
                title: 'Continue (Streaming Off)',
                tabindex: 0,
                role: 'button',
                'aria-label': 'Continue without streaming',
                'data-vse-nsc': '1',
            })
                .on('click', runNonStreamContinue)
                .on('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        runNonStreamContinue(e);
                    }
                });

            if ($('#rightSendForm').length) {
                $('#rightSendForm').prepend($btn);
            } else if ($('#leftSendForm').length) {
                $('#leftSendForm').append($btn);
            }
        }

        if (!$(`#${OPTION_ITEM_ID}`).length) {
            const $orig = $('#option_continue');
            if ($orig.length) {
                const $item = $orig.clone(false);
                $item
                    .attr('id', OPTION_ITEM_ID)
                    .attr('data-vse-nsc', '1')
                    .attr('title', 'Uncheck Streaming, run Continue, then re-check Streaming')
                    .removeAttr('data-i18n');

                const $icon = $item.find('i').first();
                if ($icon.length) $icon.attr('class', 'fa-lg fa-solid fa-forward');

                const $label = $item.find('span').first();
                if ($label.length) $label.removeAttr('data-i18n').text('Continue (No Stream)');
                else $item.append($('<span>').text('Continue (No Stream)'));

                $item.on('click', runNonStreamContinue);
                $orig.after($item);
            }
        }
    }

    async function cleanLastMessageManually() {
        const ctx = getContextSafe();
        const chat = ctx.chat;
        if (!Array.isArray(chat) || chat.length === 0) {
            window.toastr?.info?.('No chat messages to clean.', DISPLAY_TITLE);
            return;
        }

        let targetId = -1;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i] && !chat[i].is_user && !chat[i].is_system) {
                targetId = i;
                break;
            }
        }

        if (targetId < 0) {
            window.toastr?.info?.('No assistant message found.', DISPLAY_TITLE);
            return;
        }

        const settings = getEffectiveRetrySettings();
        const text = chat[targetId].mes ?? '';
        const result = detectRefusal(text, {
            searchStart: 0,
            customPatterns: settings.customPatterns,
        });

        if (!result.matched) {
            const hasEnd = endsWithRequiredMarker(text, settings.endMarker, { formatMode: settings.formatMode });
            window.toastr?.info?.(
                hasEnd
                    ? 'No refusal detected and reply ends with GFX_END.'
                    : 'No refusal detected, though reply does not end with GFX_END.',
                DISPLAY_TITLE,
            );
            return;
        }

        await applyCleanedMessage(targetId, result.cleanedText);
        window.toastr?.success?.(
            `Removed safety declaration (${result.removedText.length} chars, rule: ${result.ruleId}).`,
            DISPLAY_TITLE,
        );
    }

    // Preload script.js namespace early
    loadScriptModule();

    return {
        controller,
        syncButtons,
        cleanLastMessageManually,
        isEnabled: () => getEffectiveRetrySettings().enabled,
        isRetryPending: () => Boolean(controller.retryTimer || controller.pendingInternalRetry),
        resetAll: () => controller.resetAll(),
        onGenerationStarted: (type, options, dryRun) => {
            if (dryRun !== true) generationStartCounter += 1;
            controller.onGenerationStarted(type, options, dryRun);
        },
        onMessageReceived: (messageId, type) => controller.onMessageReceived(messageId, type),
        onGenerationEnded: () => controller.onGenerationEnded(),
        onGenerationStopped: () => controller.onGenerationStopped(),
        onChatChanged: () => controller.onChatChanged(),
    };
}
