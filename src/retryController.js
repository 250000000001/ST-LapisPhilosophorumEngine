/**
 * Combined state machine controller for Refusal Auto-Retry & Non-Stream Continue
 * inside Vexa State Engine.
 *
 * Pure ES module with zero DOM dependencies so it can be unit-tested directly.
 */

import {
    detectRefusal,
    endsWithRequiredMarker,
    DEFAULT_END_MARKER,
    DEFAULT_FAILURE_MESSAGE,
} from './retryDetector.js';

const IGNORED_GEN_TYPES = new Set(['quiet', 'impersonate']);

export class VexaRetryController {
    /**
     * @param {object} deps
     * @param {() => object} deps.getSettings
     * @param {() => Array<object>} deps.getChat
     * @param {(msgId: number, cleanedMes: string) => Promise<void> | void} deps.applyCleanedMessage
     * @param {() => void} deps.ensureNonStreamMode
     * @param {() => void} deps.restoreStreamMode
     * @param {(hooks: { onBeforeAttempt: () => void, onFailed: () => void }) => void} deps.triggerContinueNonStream
     * @param {(hooks: { onBeforeAttempt: () => void, onFailed: () => void }) => void} deps.triggerRegenerateNonStream
     * @param {() => void} [deps.cancelPendingTrigger]
     * @param {(info: { reason: 'refusal' | 'incomplete', attempt: number, maxAttempts: number, action: 'continue' | 'regenerate', ruleId: string | null }) => void} deps.notifyRetry
     * @param {(message: string) => void} deps.showFailurePopup
     * @param {(info: { messageId: number, type: string }) => void} [deps.onReplyAccepted]
     * @param {(info: { messageId: number, reason: string, attempt: number, action: string }) => void} [deps.onReplyRetrying]
     * @param {(fn: () => void, delayMs: number) => any} deps.schedule
     * @param {(handle: any) => void} deps.cancelSchedule
     */
    constructor(deps) {
        this.deps = deps;
        this.incompleteRetries = 0;
        this.refusalRetries = 0;
        this.pendingInternalRetry = false;
        this.retryTimer = null;
        this.internalRetryResetTimer = null;
        this.currentGen = null;
    }

    resetAll() {
        this.clearTimers();
        this.incompleteRetries = 0;
        this.refusalRetries = 0;
        this.pendingInternalRetry = false;
        this.currentGen = null;
        this.deps.restoreStreamMode();
    }

    cancelPendingRetry() {
        this.clearTimers();
        this.pendingInternalRetry = false;
    }

    clearTimers() {
        if (this.retryTimer !== null) {
            this.deps.cancelSchedule(this.retryTimer);
            this.retryTimer = null;
        }
        if (this.internalRetryResetTimer !== null) {
            this.deps.cancelSchedule(this.internalRetryResetTimer);
            this.internalRetryResetTimer = null;
        }
        this.deps.cancelPendingTrigger?.();
    }

    onGenerationStarted(type, _options, dryRun) {
        const settings = this.deps.getSettings();
        if (!settings.enabled) {
            this.currentGen = null;
            return;
        }

        if (dryRun === true) return;
        if (type && IGNORED_GEN_TYPES.has(type)) {
            this.currentGen = null;
            return;
        }

        const isInternalRetry = this.pendingInternalRetry;
        if (isInternalRetry) {
            this.pendingInternalRetry = false;
            if (this.internalRetryResetTimer !== null) {
                this.deps.cancelSchedule(this.internalRetryResetTimer);
                this.internalRetryResetTimer = null;
            }
        } else {
            this.clearTimers();
            this.incompleteRetries = 0;
            this.refusalRetries = 0;
        }

        const chat = this.deps.getChat() || [];
        const lastIdx = chat.length - 1;
        const lastMsg = lastIdx >= 0 ? chat[lastIdx] : null;

        this.currentGen = {
            type: type || 'normal',
            isContinue: type === 'continue',
            preChatLength: chat.length,
            preLastMsgId: lastIdx,
            preLastMes: lastMsg && typeof lastMsg.mes === 'string' ? lastMsg.mes : '',
            preLastReasoning: lastMsg && typeof lastMsg.extra?.reasoning === 'string' ? lastMsg.extra.reasoning : '',
            preLastSwipeId: lastMsg ? lastMsg.swipe_id : undefined,
            preLastSwipesLen: Array.isArray(lastMsg?.swipes) ? lastMsg.swipes.length : 0,
            receivedMessageId: null,
            receivedType: null,
            stopped: false,
            handled: false,
        };
    }

    onMessageReceived(messageId, type) {
        if (!this.currentGen) return;
        if (typeof messageId === 'number' && messageId >= 0) {
            this.currentGen.receivedMessageId = messageId;
            this.currentGen.receivedType = type || this.currentGen.type;
        }
    }

    onGenerationStopped() {
        if (this.currentGen) {
            this.currentGen.stopped = true;
        }
        this.clearTimers();
        this.incompleteRetries = 0;
        this.refusalRetries = 0;
        this.pendingInternalRetry = false;
        this.deps.restoreStreamMode();
    }

    onChatChanged() {
        this.resetAll();
    }

    async onGenerationEnded() {
        const settings = this.deps.getSettings();
        const gen = this.currentGen;
        if (!settings.enabled || !gen || gen.handled) return;
        gen.handled = true;

        if (gen.stopped) {
            this.incompleteRetries = 0;
            this.refusalRetries = 0;
            this.deps.restoreStreamMode();
            return;
        }

        const chat = this.deps.getChat() || [];
        const targetId = this.resolveTargetMessageId(gen, chat);
        if (targetId === null) {
            this.deps.restoreStreamMode();
            return;
        }

        const msg = chat[targetId];
        if (!msg || msg.is_user || msg.is_system) {
            this.deps.restoreStreamMode();
            return;
        }

        const currentText = typeof msg.mes === 'string' ? msg.mes : '';
        const searchStart = this.computeSearchStart(gen, targetId, currentText);
        const endMarker = settings.endMarker || DEFAULT_END_MARKER;
        const requireEndMarker = settings.requireEndMarker !== false;

        // 1. Check for safety refusal
        const detection = detectRefusal(currentText, {
            searchStart,
            customPatterns: settings.customPatterns,
        });

        if (detection.matched) {
            const cleanedText = detection.cleanedText;
            if (cleanedText !== currentText) {
                await this.deps.applyCleanedMessage(targetId, cleanedText);
            }

            if (requireEndMarker && endsWithRequiredMarker(cleanedText, endMarker, { formatMode: settings.formatMode })) {
                this.incompleteRetries = 0;
                this.refusalRetries = 0;
                this.deps.restoreStreamMode();
                this.deps.onReplyAccepted?.({ messageId: targetId, type: gen.type });
                return;
            }

            const maxRefusalRetries = Number.isFinite(Number(settings.maxRefusalRetries))
                ? Math.max(0, Number(settings.maxRefusalRetries))
                : 0;

            this.refusalRetries += 1;

            if (maxRefusalRetries > 0 && this.refusalRetries > maxRefusalRetries) {
                this.incompleteRetries = 0;
                this.refusalRetries = 0;
                this.clearTimers();
                this.deps.restoreStreamMode();
                this.deps.showFailurePopup(DEFAULT_FAILURE_MESSAGE);
                return;
            }

            const nextAction = cleanedText.replace(/[\s\u2800]+/g, '').length > 0
                ? 'continue'
                : 'regenerate';

            this.deps.onReplyRetrying?.({
                messageId: targetId,
                reason: 'refusal',
                attempt: this.refusalRetries,
                action: nextAction,
            });
            this.scheduleNonStreamRetry({
                reason: 'refusal',
                attempt: this.refusalRetries,
                maxAttempts: maxRefusalRetries,
                action: nextAction,
                ruleId: detection.ruleId,
                delayMs: settings.retryDelayMs,
                showToast: settings.showStatusToasts,
            });
            return;
        }

        // 2. Verify end marker
        const hasEndMarker = !requireEndMarker || endsWithRequiredMarker(currentText, endMarker, { formatMode: settings.formatMode });
        if (hasEndMarker && currentText.replace(/[\s\u2800]+/g, '').length > 0) {
            this.incompleteRetries = 0;
            this.refusalRetries = 0;
            this.deps.restoreStreamMode();
            this.deps.onReplyAccepted?.({ messageId: targetId, type: gen.type });
            return;
        }

        // 3. Missing end marker -> non-stream retry up to maxIncompleteRetries
        const maxIncompleteRetries = Number.isFinite(Number(settings.maxIncompleteRetries))
            ? Math.max(0, Number(settings.maxIncompleteRetries))
            : 3;

        this.incompleteRetries += 1;

        if (this.incompleteRetries > maxIncompleteRetries) {
            this.incompleteRetries = 0;
            this.refusalRetries = 0;
            this.clearTimers();
            this.deps.restoreStreamMode();
            this.deps.showFailurePopup(DEFAULT_FAILURE_MESSAGE);
            return;
        }

        const nextAction = (gen.isContinue && currentText.replace(/[\s\u2800]+/g, '').length > 0)
            ? 'continue'
            : 'regenerate';

        this.deps.onReplyRetrying?.({
            messageId: targetId,
            reason: 'incomplete',
            attempt: this.incompleteRetries,
            action: nextAction,
        });
        this.scheduleNonStreamRetry({
            reason: 'incomplete',
            attempt: this.incompleteRetries,
            maxAttempts: maxIncompleteRetries,
            action: nextAction,
            ruleId: null,
            delayMs: settings.retryDelayMs,
            showToast: settings.showStatusToasts,
        });
    }

    scheduleNonStreamRetry({ reason, attempt, maxAttempts, action, ruleId, delayMs, showToast }) {
        if (showToast) {
            this.deps.notifyRetry({ reason, attempt, maxAttempts, action, ruleId });
        }

        const delay = Math.max(0, Number(delayMs) || 300);

        this.clearTimers();
        this.retryTimer = this.deps.schedule(() => {
            this.retryTimer = null;

            const hooks = {
                onBeforeAttempt: () => {
                    this.pendingInternalRetry = true;
                    if (this.internalRetryResetTimer !== null) {
                        this.deps.cancelSchedule(this.internalRetryResetTimer);
                    }
                    this.internalRetryResetTimer = this.deps.schedule(() => {
                        this.internalRetryResetTimer = null;
                        this.pendingInternalRetry = false;
                        this.incompleteRetries = 0;
                        this.refusalRetries = 0;
                        this.deps.restoreStreamMode();
                    }, 20000);
                },
                onFailed: () => {
                    this.resetAll();
                },
            };

            if (action === 'continue') {
                this.deps.triggerContinueNonStream(hooks);
            } else {
                this.deps.triggerRegenerateNonStream(hooks);
            }
        }, delay);
    }

    resolveTargetMessageId(gen, chat) {
        if (typeof gen.receivedMessageId === 'number' && gen.receivedMessageId < chat.length) {
            return gen.receivedMessageId;
        }

        const lastIdx = chat.length - 1;
        if (lastIdx < 0) return null;

        const lastMsg = chat[lastIdx];
        if (!lastMsg || lastMsg.is_user || lastMsg.is_system) return null;

        const chatGrew = chat.length > gen.preChatLength;
        const sameLast = lastIdx === gen.preLastMsgId;
        const lastMesChanged = sameLast && (lastMsg.mes ?? '') !== gen.preLastMes;
        const lastReasoningChanged = sameLast && (lastMsg.extra?.reasoning ?? '') !== gen.preLastReasoning;
        const lastSwipeChanged = sameLast && (
            lastMsg.swipe_id !== gen.preLastSwipeId ||
            (Array.isArray(lastMsg.swipes) ? lastMsg.swipes.length : 0) !== gen.preLastSwipesLen
        );
        const isRegenOrSwipeOnAiMsg = sameLast && (gen.type === 'regenerate' || gen.type === 'swipe');

        if (chatGrew || lastMesChanged || lastReasoningChanged || lastSwipeChanged || isRegenOrSwipeOnAiMsg) {
            return lastIdx;
        }

        return null;
    }

    computeSearchStart(gen, targetId, currentText) {
        if (gen.isContinue && targetId === gen.preLastMsgId && gen.preLastMes.length > 0) {
            if (currentText.startsWith(gen.preLastMes)) {
                return gen.preLastMes.length;
            }
            const trimmedPre = gen.preLastMes.replace(/[\s\u2800]+$/g, '');
            if (trimmedPre.length > 0 && currentText.startsWith(trimmedPre)) {
                return trimmedPre.length;
            }
        }
        return 0;
    }
}
