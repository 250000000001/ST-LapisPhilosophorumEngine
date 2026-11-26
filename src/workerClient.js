/**
 * Secondary API Worker Client for Lapis Philosophorum Engine ("LPE Clerk").
 *
 * Supports:
 *  - Direct OpenAI-compatible API (baseUrl + apiKey + model) via ST's ChatCompletionService
 *    reverse_proxy path (zero CORS inside SillyTavern) or direct fetch (Node tests / fallback).
 *  - SillyTavern Connection Profile via ConnectionManagerRequestService.sendRequest (zero profile switching).
 *  - Serialized promise queue, AbortController stop handling, chat-switch cancellation,
 *    and send-guard pending promise so next user send waits up to 30s cleanly.
 */

import { normalizeBraille } from './schema.js';

const REFUSAL_PATTERNS = [
    /\bI(?:'m| am)\s+(?:sorry,?\s+but\s+)?(?:Gemini|an AI|a language model)[^\n]{0,80}\b(?:cannot|can't|unable|won't)\b/i,
    /\b(?:violates|against)\s+(?:my|our)?\s*(?:safety|content|usage)\s*(?:guidelines|policy|policies)\b/i,
    /\[(?:PROHIBITED_CONTENT|SAFETY|BLOCKED|CONTENT_FILTER|REFUSAL)\]/i,
    /^\s*#{1,4}\s*(?:Request Status|Safety Notice|Content Policy Notice)\b/i,
];

export function normalizeBaseUrl(url) {
    let s = String(url || '').trim();
    if (!s) return '';
    s = s.replace(/\/+$/, '');
    s = s.replace(/\/chat\/completions$/i, '');
    s = s.replace(/\/+$/, '');
    return s;
}

export function stripWorkerMetaTags(text) {
    return String(text || '').replace(/<ds_safety\b[^>]*>[\s\S]*?(?:<\/ds_safety\s*>|$)/gi, '');
}

export function isWorkerRefusal(text) {
    const clean = normalizeBraille(stripWorkerMetaTags(text)).trim();
    if (!clean) return false;
    return REFUSAL_PATTERNS.some((re) => re.test(clean));
}

export function extractErrorMessage(err) {
    let cur = err;
    for (let i = 0; i < 4 && cur && cur.cause; i++) cur = cur.cause;
    const msg = String((cur && cur.message) || cur || '').trim();
    return msg || String((err && err.message) || err || 'Unknown worker error').trim();
}

/**
 * Direct OpenAI-compatible fetch helper (used by Node live tests and standalone fallback).
 */
export async function fetchOpenAICompatible({ baseUrl, apiKey, model, messages, maxTokens = 8192, temperature = 0.25, signal = null, timeoutMs = 90000, fetchImpl = globalThis.fetch }) {
    const base = normalizeBaseUrl(baseUrl);
    if (!base) throw new Error('Worker Base URL is empty.');
    if (!model) throw new Error('Worker Model is not set.');
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    let timeoutId = null;
    let effectiveSignal = signal;
    if (!effectiveSignal && timeoutMs > 0 && typeof AbortController !== 'undefined') {
        const ctrl = new AbortController();
        timeoutId = setTimeout(() => ctrl.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
        effectiveSignal = ctrl.signal;
    }

    let resp;
    try {
        resp = await fetchImpl(`${base}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model,
                messages,
                max_tokens: maxTokens,
                temperature,
                stream: false,
            }),
            signal: effectiveSignal,
        });
    } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
    }

    const bodyText = await resp.text();
    let json = null;
    try { json = JSON.parse(bodyText); } catch { /* handled below */ }

    if (!resp.ok || json?.error) {
        const msg = json?.error?.message || bodyText.slice(0, 300) || `HTTP ${resp.status}`;
        throw new Error(`OpenAI-compatible error (${resp.status}): ${msg}`);
    }

    const choice = json?.choices?.[0];
    const rawContent = choice?.message?.content ?? choice?.text ?? '';
    const content = typeof rawContent === 'string' ? stripWorkerMetaTags(rawContent) : '';
    const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? '';
    return {
        content,
        reasoning: typeof reasoning === 'string' ? reasoning : '',
        finishReason: String(choice?.finish_reason || ''),
        usage: json?.usage || null,
        raw: json,
    };
}

/**
 * Fetch available model IDs from an OpenAI-compatible endpoint.
 * Uses ST's /api/backends/chat-completions/status proxy inside SillyTavern to avoid CORS,
 * falling back to direct GET /models.
 */
export async function fetchModelsList({ baseUrl, apiKey, ctx = null, fetchImpl = globalThis.fetch }) {
    const base = normalizeBaseUrl(baseUrl);
    if (!base) throw new Error('Base URL is required to fetch models.');

    if (ctx && typeof ctx.getRequestHeaders === 'function') {
        try {
            const resp = await fetchImpl('/api/backends/chat-completions/status', {
                method: 'POST',
                headers: ctx.getRequestHeaders(),
                body: JSON.stringify({
                    chat_completion_source: 'openai',
                    reverse_proxy: base,
                    proxy_password: apiKey || '',
                }),
            });
            if (resp.ok) {
                const data = await resp.json();
                const list = Array.isArray(data?.data) ? data.data.map((m) => m.id || m.name).filter(Boolean) : [];
                if (list.length) return list.sort();
            }
        } catch {
            // Fall through to direct fetch
        }
    }

    const headers = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const resp = await fetchImpl(`${base}/models`, { method: 'GET', headers });
    if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`Failed to fetch models (${resp.status}): ${txt.slice(0, 200)}`);
    }
    const data = await resp.json();
    const list = Array.isArray(data?.data) ? data.data.map((m) => m.id || m.name).filter(Boolean) : [];
    return list.sort();
}

/**
 * Create the queued, abortable LPE Clerk worker client.
 */
export function createWorkerClient({ getSettings, getContextSafe, onStatusChange = () => {}, fetchImpl = globalThis.fetch }) {
    let queue = Promise.resolve();
    const liveJobs = new Set();
    let activeJob = null;
    let pendingCount = 0;
    let pendingDone = null;
    let resolvePending = null;

    function holdSend() {
        if (pendingCount++ === 0) {
            pendingDone = new Promise((res) => { resolvePending = res; });
        }
    }

    function releaseSend() {
        if (--pendingCount > 0) return;
        pendingCount = 0;
        pendingDone = null;
        if (resolvePending) resolvePending();
        resolvePending = null;
    }

    function publishStatus(override = null) {
        const waiting = [...liveJobs].filter((j) => j !== activeJob && !j.controller.signal.aborted).length;
        onStatusChange(override || {
            busy: Boolean(activeJob) || waiting > 0,
            runningLabel: activeJob ? activeJob.label : null,
            activeUid: activeJob ? activeJob.uid : null,
            waiting,
        });
    }

    async function sendOnce(messages, signal, opts = {}) {
        const settings = getSettings();
        const maxTokens = Number(opts.maxTokens || settings.workerMaxTokens || 8192);
        const temperature = Number.isFinite(Number(opts.temperature ?? settings.workerTemperature))
            ? Number(opts.temperature ?? settings.workerTemperature)
            : 0.25;

        const ctx = getContextSafe();
        const mode = settings.workerTransport || 'direct';

        if (mode === 'profile') {
            const profileId = settings.workerProfileId;
            if (!profileId) throw new Error('No SillyTavern Connection Profile selected.');
            if (typeof ctx?.ConnectionManagerRequestService?.sendRequest !== 'function') {
                throw new Error('SillyTavern ConnectionManagerRequestService is unavailable.');
            }
            const res = await ctx.ConnectionManagerRequestService.sendRequest(
                profileId,
                messages,
                maxTokens,
                { stream: false, extractData: true, includePreset: false, signal },
                { temperature },
            );
            if (typeof res === 'function') {
                let last = null;
                for await (const chunk of res()) last = chunk;
                return { content: last ? stripWorkerMetaTags(last.text) : '', reasoning: '' };
            }
            return { content: stripWorkerMetaTags(res?.content), reasoning: String(res?.reasoning || '') };
        }

        const baseUrl = normalizeBaseUrl(settings.workerBaseUrl);
        const apiKey = String(settings.workerApiKey || '').trim();
        const model = String(settings.workerModel || '').trim();
        if (!baseUrl) throw new Error('OpenAI-compatible Base URL is not configured.');
        if (!model) throw new Error('Worker Model is not configured.');

        // Route via ST backend ChatCompletionService.processRequest inside ST to bypass browser CORS
        if (typeof ctx?.ChatCompletionService?.processRequest === 'function') {
            const res = await ctx.ChatCompletionService.processRequest({
                stream: false,
                messages,
                max_tokens: maxTokens,
                temperature,
                model,
                chat_completion_source: 'openai',
                reverse_proxy: baseUrl,
                proxy_password: apiKey,
            }, {}, true, signal);
            return {
                content: stripWorkerMetaTags(res?.content),
                reasoning: String(res?.reasoning || ''),
            };
        }

        return await fetchOpenAICompatible({ baseUrl, apiKey, model, messages, maxTokens, temperature, signal, fetchImpl });
    }

    function enqueue({ label = 'Updating state', chatId = null, uid = null, blocksSend = true } = {}, taskFn) {
        const entry = { label, chatId, uid, controller: new AbortController(), blocksSend };
        liveJobs.add(entry);
        if (blocksSend) holdSend();
        publishStatus();

        const run = queue.then(async () => {
            if (entry.controller.signal.aborted) return { aborted: true, content: '' };
            activeJob = entry;
            publishStatus();
            try {
                return await taskFn({
                    signal: entry.controller.signal,
                    send: (msgs, opts) => sendOnce(msgs, entry.controller.signal, opts),
                });
            } finally {
                if (activeJob === entry) activeJob = null;
                liveJobs.delete(entry);
                if (blocksSend) releaseSend();
                publishStatus();
            }
        });
        queue = run.catch(() => {});
        return run;
    }

    function stopAll() {
        let count = 0;
        for (const e of liveJobs) {
            if (!e.controller.signal.aborted) {
                e.controller.abort();
                count++;
            }
        }
        publishStatus();
        return count;
    }

    function stopForOtherChats(currentChatId) {
        let count = 0;
        for (const e of liveJobs) {
            if (e.chatId && e.chatId !== currentChatId && !e.controller.signal.aborted) {
                e.controller.abort();
                count++;
            }
        }
        publishStatus();
        return count;
    }

    async function testConnection() {
        const ctrl = new AbortController();
        const res = await sendOnce(
            [{ role: 'user', content: 'Reply with the single word: OK' }],
            ctrl.signal,
            { maxTokens: 32, temperature: 0 },
        );
        return String(res?.content || '').trim();
    }

    return {
        enqueue,
        stopAll,
        stopForOtherChats,
        testConnection,
        getPendingPromise: () => pendingDone,
        isBusy: () => Boolean(activeJob) || liveJobs.size > 0,
    };
}
