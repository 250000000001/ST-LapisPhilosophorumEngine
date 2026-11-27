/**
 * Guarded Blob-URL Iframe Renderer & Performance/Code-Folding Controller
 * for Interactive Character Card Screens.
 *
 * Original implementation under CC BY-NC 4.0.
 * Inspiration & Attribution:
 *   Blob-URL frontend iframe rendering, Render Depth, code-block folding, and highlight.js bypass
 *   concepts were inspired by JS-Slash-Runner by N0VI028
 *   (https://github.com/N0VI028/JS-Slash-Runner).
 *   Zero code was copied from JS-Slash-Runner; all detection, lifecycle, performance guards,
 *   sandbox CSP assembly, and postMessage isolation are written from scratch.
 */

import {
    generateFrameToken,
    assembleSandboxedDocument,
    sanitizeStateForCard,
    resolveThemeVarsForCard,
} from './cardBridge.js';

export const MAX_CONCURRENT_IFRAMES = 6;
const DEFAULT_FRAME_HEIGHT = 240;

let installedHljsOrig = null;
let installedHljsBlockOrig = null;
let installedHljsSettingsGetter = null;

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function hashStringExact(text, suffix = '') {
    const s = String(text || '');
    let h = 2166136261;
    // Full-string FNV-1a (even 2 MB scans in < 2ms in V8, preventing partial-sample collisions)
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return `${(h >>> 0).toString(36)}:${s.length}:${suffix}`;
}

function utf8ByteLength(text) {
    const s = String(text || '');
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    return s.length * 2;
}

/** Auto-yield to official JS-Slash-Runner (`window.TavernHelper`) when installed and auto-yield is ON. */
export function shouldYieldRenderer(settings) {
    if (settings?.rendererAutoYield === false) return false;
    return typeof globalThis.window !== 'undefined' && Boolean(globalThis.window?.TavernHelper);
}

/**
 * Fast, conservative detector distinguishing full interactive frontend HTML screens
 * from LPE XML, Markdown code examples, and ordinary programming snippets.
 */
export function isFrontendHtmlBlock(codeText) {
    if (typeof codeText !== 'string') return false;
    const head = codeText.slice(0, 2048).trimStart();
    if (!head || head.length < 16) return false;

    // Never hijack LPE/legacy Vexa internal XML/tail payloads
    if (/^<(?:internal_states|(?:lpe|vexa)_tail|(?:lpe|vexa)_receipt|state:|UpdateVariable)/i.test(head)) {
        return false;
    }

    if (/^(?:<!DOCTYPE\s+html\b|<html\b)/i.test(head)) return true;
    if (/<!--\s*(?:lpe|vexa)-(?:screen|widget)\s*-->/i.test(head)) return true;
    if (/data-(?:lpe|vexa)-screen\s*=/.test(head)) return true;
    if (/<head\b[^>]*>[\s\S]*?<body\b/i.test(codeText.slice(0, 8192))) return true;

    const hasInteractiveTag = /<(?:script|style|form|canvas|button|input|select|iframe)\b/i.test(codeText);
    const hasContainerTag = /<(?:div|section|main|article|header|svg)\b/i.test(head);
    if (hasInteractiveTag && (hasContainerTag || /<style\b[^>]*>[\s\S]*<\/style>/i.test(codeText))) {
        // Avoid matching plain JS/TS code mentioning '<script>' inside strings
        if (/^\s*(?:const|let|var|function|import|export|class|def|public)\s+\w+/i.test(head)) return false;
        return true;
    }
    return false;
}

function isMessageCodeElement(el) {
    if (!el || typeof el.closest !== 'function') return false;
    return Boolean(el.closest('.mes_text pre code'));
}

/**
 * Wrap `hljs.highlightElement` / `hljs.highlightBlock` idempotently so massive frontend HTML
 * code blocks inside chat messages skip expensive syntax highlighting before rendering.
 */
export function installHljsGuard(getSettings) {
    installedHljsSettingsGetter = getSettings;
    const hljsObj = globalThis.hljs || globalThis.window?.hljs;
    if (!hljsObj || typeof hljsObj !== 'object') return false;

    const shouldSkipHljs = (el) => {
        const s = installedHljsSettingsGetter?.();
        if (!el || !s?.enabled || !s?.rendererEnabled || s?.rendererSkipHljs === false || shouldYieldRenderer(s)) {
            return false;
        }
        if (!isMessageCodeElement(el)) return false;
        const txt = el.textContent || '';
        // Skip full highlighting cleanly on any large HTML block (>128KB) or matched frontend block
        if (txt.length > 131072 && /^\s*</.test(txt.slice(0, 64))) return true;
        return isFrontendHtmlBlock(txt);
    };

    if (typeof hljsObj.highlightElement === 'function' && !hljsObj.highlightElement.__lpeGuarded) {
        const origFn = hljsObj.highlightElement.bind(hljsObj);
        installedHljsOrig = origFn;
        const wrapped = function lpeGuardedHighlightElement(el, ...rest) {
            try {
                if (shouldSkipHljs(el)) {
                    if (el.dataset) el.dataset.lpeHljsSkipped = '1';
                    return;
                }
            } catch {
                // Fall back to default highlight on any guard error
            }
            return origFn(el, ...rest);
        };
        wrapped.__lpeGuarded = true;
        wrapped.__lpeOrig = origFn;
        hljsObj.highlightElement = wrapped;
    }

    if (typeof hljsObj.highlightBlock === 'function' && !hljsObj.highlightBlock.__lpeGuarded) {
        const origBlockFn = hljsObj.highlightBlock.bind(hljsObj);
        installedHljsBlockOrig = origBlockFn;
        const wrappedBlock = function lpeGuardedHighlightBlock(el, ...rest) {
            try {
                if (shouldSkipHljs(el)) {
                    if (el.dataset) el.dataset.lpeHljsSkipped = '1';
                    return;
                }
            } catch {
                // Fallback
            }
            return origBlockFn(el, ...rest);
        };
        wrappedBlock.__lpeGuarded = true;
        wrappedBlock.__lpeOrig = origBlockFn;
        hljsObj.highlightBlock = wrappedBlock;
    }

    return true;
}

export function uninstallHljsGuard() {
    const hljsObj = globalThis.hljs || globalThis.window?.hljs;
    if (hljsObj) {
        if (hljsObj.highlightElement?.__lpeGuarded && hljsObj.highlightElement.__lpeOrig) {
            hljsObj.highlightElement = hljsObj.highlightElement.__lpeOrig;
        } else if (installedHljsOrig && hljsObj.highlightElement?.__lpeGuarded) {
            hljsObj.highlightElement = installedHljsOrig;
        }
        if (hljsObj.highlightBlock?.__lpeGuarded && hljsObj.highlightBlock.__lpeOrig) {
            hljsObj.highlightBlock = hljsObj.highlightBlock.__lpeOrig;
        } else if (installedHljsBlockOrig && hljsObj.highlightBlock?.__lpeGuarded) {
            hljsObj.highlightBlock = installedHljsBlockOrig;
        }
    }
    installedHljsOrig = null;
    installedHljsBlockOrig = null;
    installedHljsSettingsGetter = null;
}

/**
 * Create the guarded Blob-URL Iframe Renderer for SillyTavern `#chat`.
 */
export function createCardRenderer({
    getSettings,
    bridgeHost,
    getStateForMesId,
    store,
    onConfirmSend,
} = {}) {
    const mounted = new Map(); // preEl -> record
    let manualLoadPres = new WeakSet();
    let forceHugePres = new WeakSet();
    let unloadedPres = new WeakMap(); // preEl -> blockHash explicitly unloaded by user
    let sourceOpenPres = new WeakSet();
    const confirmMeta = new WeakMap(); // .lpe-card-confirm-bar -> { fullText, previewShort, expanded, rec }
    let delegatedRoot = null;
    let totalRevokedUrls = 0;
    let lastScanMs = 0;

    function resolveRecForWrap(wrapEl) {
        if (!wrapEl) return null;
        const preEl = wrapEl.previousElementSibling;
        if (preEl && mounted.has(preEl)) return mounted.get(preEl);
        for (const rec of mounted.values()) {
            if (rec?.wrapEl === wrapEl) return rec;
        }
        return null;
    }

    function onChatClick(ev) {
        const target = ev?.target;
        if (!target || typeof target.closest !== 'function') return;

        const viewBtn = target.closest('.lpe-card-confirm-view');
        if (viewBtn) {
            const bar = viewBtn.closest('.lpe-card-confirm-bar');
            const meta = bar ? confirmMeta.get(bar) : null;
            if (!meta) return;
            meta.expanded = !meta.expanded;
            const codeEl = bar.querySelector('code');
            if (codeEl) codeEl.textContent = meta.expanded ? meta.fullText : meta.previewShort;
            viewBtn.textContent = meta.expanded ? 'Collapse' : 'View Full';
            return;
        }

        const sendBtn = target.closest('.lpe-card-send-confirm');
        if (sendBtn) {
            ev.stopPropagation();
            const bar = sendBtn.closest('.lpe-card-confirm-bar');
            const meta = bar ? confirmMeta.get(bar) : null;
            if (!bar || !meta) return;
            confirmMeta.delete(bar);
            bar.remove();
            onConfirmSend?.(meta.fullText, meta.rec);
            return;
        }

        const dismissBtn = target.closest('.lpe-card-confirm-dismiss');
        if (dismissBtn) {
            const bar = dismissBtn.closest('.lpe-card-confirm-bar');
            if (bar) {
                confirmMeta.delete(bar);
                bar.remove();
            }
            return;
        }

        const foldBtn = target.closest('.lpe-code-fold-toggle .lpe-mini-btn');
        if (foldBtn) {
            ev.stopPropagation();
            const toggleEl = foldBtn.closest('.lpe-code-fold-toggle');
            const preEl = toggleEl?.nextElementSibling;
            if (!preEl || preEl.tagName !== 'PRE') return;
            if (sourceOpenPres.has(preEl)) sourceOpenPres.delete(preEl);
            else sourceOpenPres.add(preEl);
            const open = sourceOpenPres.has(preEl);
            preEl.classList.toggle('lpe-code-hidden', !open);
            foldBtn.innerHTML = open
                ? '<i class="fa-solid fa-eye-slash"></i> Hide Code Block'
                : '<i class="fa-solid fa-code"></i> Show Code Block';
            return;
        }

        const loadBtn = target.closest('.lpe-card-load-btn');
        if (loadBtn) {
            ev.stopPropagation();
            const wrap = loadBtn.closest('.lpe-card-frame-wrap');
            const preEl = wrap?.previousElementSibling;
            if (!preEl || preEl.tagName !== 'PRE') return;
            unloadedPres.delete(preEl);
            manualLoadPres.add(preEl);
            if (wrap.dataset.lpeOversized === '1') forceHugePres.add(preEl);
            let currentMounted = 0;
            for (const r of mounted.values()) if (r.status === 'mounted') currentMounted++;
            if (currentMounted >= MAX_CONCURRENT_IFRAMES) {
                for (const [otherPre, otherRec] of mounted.entries()) {
                    if (otherPre !== preEl && otherRec.status === 'mounted') {
                        manualLoadPres.delete(otherPre);
                        unloadedPres.set(otherPre, otherRec.hash.split(':')[0] || '');
                        removeRecordDom(otherPre, otherRec);
                        mounted.delete(otherPre);
                        break;
                    }
                }
            }
            refreshAll();
            return;
        }

        const srcBtn = target.closest('.lpe-card-src-btn');
        if (srcBtn) {
            ev.stopPropagation();
            const wrap = srcBtn.closest('.lpe-card-frame-wrap');
            const preEl = wrap?.previousElementSibling;
            if (!preEl || preEl.tagName !== 'PRE') return;
            if (sourceOpenPres.has(preEl)) sourceOpenPres.delete(preEl);
            else sourceOpenPres.add(preEl);
            const open = sourceOpenPres.has(preEl);
            preEl.classList.toggle('lpe-code-hidden', !open);
            srcBtn.textContent = open ? 'Hide Source' : 'Source';
            return;
        }

        const unloadBtn = target.closest('.lpe-card-unload-btn');
        if (unloadBtn) {
            ev.stopPropagation();
            const wrap = unloadBtn.closest('.lpe-card-frame-wrap');
            const preEl = wrap?.previousElementSibling;
            if (!preEl || preEl.tagName !== 'PRE') return;
            const codeEl = preEl.querySelector('code') || preEl;
            const srcHash = wrap.dataset.lpeSrcHash || hashStringExact(codeEl.textContent || '');
            manualLoadPres.delete(preEl);
            forceHugePres.delete(preEl);
            unloadedPres.set(preEl, srcHash);
            refreshAll();
        }
    }

    function ensureChatDelegation(chatRoot) {
        if (!chatRoot || delegatedRoot === chatRoot) return;
        if (delegatedRoot && typeof delegatedRoot.removeEventListener === 'function') {
            delegatedRoot.removeEventListener('click', onChatClick);
        }
        delegatedRoot = chatRoot;
        if (typeof chatRoot.addEventListener === 'function') {
            chatRoot.addEventListener('click', onChatClick);
        }
    }

    function revokeRecord(rec) {
        if (!rec) return;
        if (rec.token) {
            bridgeHost?.unregister?.(rec.token);
            rec.token = null;
        }
        if (rec.blobUrl) {
            try {
                URL.revokeObjectURL(rec.blobUrl);
                totalRevokedUrls++;
            } catch {
                // Ignore
            }
            rec.blobUrl = null;
        }
        if (rec.iframe && rec.iframe.isConnected) {
            try { rec.iframe.src = 'about:blank'; } catch { /* ignore */ }
        }
        rec.iframe = null;
    }

    function removeRecordDom(preEl, rec) {
        revokeRecord(rec);
        try { preEl?.classList?.remove('lpe-code-hidden'); } catch { /* ignore */ }
        if (rec?.wrapEl && rec.wrapEl.isConnected) {
            rec.wrapEl.remove();
        }
        if (rec) rec.wrapEl = null;
    }

    function sweepDisconnected() {
        for (const [preEl, rec] of mounted.entries()) {
            if (!preEl || !preEl.isConnected) {
                removeRecordDom(preEl, rec);
                mounted.delete(preEl);
            }
        }
        // Also sweep non-frontend code-collapse toggles whose <pre> detached
        if (typeof document !== 'undefined') {
            for (const bar of document.querySelectorAll('#chat .lpe-code-fold-toggle')) {
                const next = bar.nextElementSibling;
                if (!next || next.tagName !== 'PRE' || !next.isConnected) {
                    bar.remove();
                }
            }
        }
    }

    function teardownAll() {
        for (const [preEl, rec] of mounted.entries()) {
            removeRecordDom(preEl, rec);
        }
        mounted.clear();
        manualLoadPres = new WeakSet();
        forceHugePres = new WeakSet();
        unloadedPres = new WeakMap();
        sourceOpenPres = new WeakSet();
        if (typeof document !== 'undefined') {
            for (const el of document.querySelectorAll('#chat .lpe-card-frame-wrap, #chat .lpe-code-fold-toggle')) {
                el.remove();
            }
            for (const pre of document.querySelectorAll('#chat pre.lpe-code-hidden')) {
                pre.classList.remove('lpe-code-hidden');
            }
        }
    }

    function showConfirmSendBar(token, text) {
        let targetWrap = null;
        let targetRec = null;
        for (const rec of mounted.values()) {
            if (rec.token === token && rec.wrapEl?.isConnected) {
                targetWrap = rec.wrapEl;
                targetRec = rec;
                break;
            }
        }
        if (!targetWrap && typeof document !== 'undefined') {
            const safeToken = String(token || '').replace(/[^a-zA-Z0-9_-]/g, '');
            if (safeToken) {
                targetWrap = document.querySelector(`#chat .lpe-card-frame-wrap[data-lpe-token="${safeToken}"]`);
                targetRec = resolveRecForWrap(targetWrap);
            }
        }
        if (!targetWrap) return false;

        const existing = targetWrap.querySelector('.lpe-card-confirm-bar');
        if (existing) {
            confirmMeta.delete(existing);
            existing.remove();
        }
        const fullText = String(text || '');
        const bar = document.createElement('div');
        bar.className = 'lpe-card-confirm-bar';
        const label = document.createElement('span');
        const previewShort = `${fullText.slice(0, 72)}${fullText.length > 72 ? '...' : ''}`;
        label.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Screen queued reply (${esc(fullText.length)} chars): <code>${esc(previewShort)}</code>`;
        const actions = document.createElement('div');
        actions.className = 'lpe-card-confirm-actions';
        if (fullText.length > 72) {
            const viewBtn = document.createElement('button');
            viewBtn.type = 'button';
            viewBtn.className = 'lpe-mini-btn lpe-card-confirm-view';
            viewBtn.textContent = 'View Full';
            actions.appendChild(viewBtn);
        }
        const sendBtn = document.createElement('button');
        sendBtn.type = 'button';
        sendBtn.className = 'lpe-mini-btn lpe-card-send-confirm';
        sendBtn.innerHTML = '<i class="fa-solid fa-check"></i> Send to Chat';
        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'lpe-mini-btn lpe-card-confirm-dismiss';
        dismissBtn.textContent = 'Dismiss';
        actions.appendChild(sendBtn);
        actions.appendChild(dismissBtn);
        bar.appendChild(label);
        bar.appendChild(actions);
        confirmMeta.set(bar, { fullText, previewShort, expanded: false, rec: targetRec });
        targetWrap.appendChild(bar);
        if (typeof document !== 'undefined') {
            ensureChatDelegation(document.getElementById('chat'));
        }
        return true;
    }

    function applyPlainCodeCollapse(preEl, collapseMode) {
        const shouldHidePlain = collapseMode === 'all';
        let toggleEl = preEl.previousElementSibling?.classList?.contains('lpe-code-fold-toggle')
            ? preEl.previousElementSibling
            : null;
        if (!shouldHidePlain) {
            preEl.classList.remove('lpe-code-hidden');
            if (toggleEl) toggleEl.remove();
            return;
        }
        if (!toggleEl) {
            toggleEl = document.createElement('div');
            toggleEl.className = 'lpe-code-fold-toggle';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'lpe-mini-btn';
            const open = sourceOpenPres.has(preEl);
            preEl.classList.toggle('lpe-code-hidden', !open);
            btn.innerHTML = open
                ? '<i class="fa-solid fa-eye-slash"></i> Hide Code Block'
                : '<i class="fa-solid fa-code"></i> Show Code Block';
            toggleEl.appendChild(btn);
            preEl.before(toggleEl);
        } else {
            preEl.classList.toggle('lpe-code-hidden', !sourceOpenPres.has(preEl));
        }
    }

    function buildPlaceholderWrap(preEl, { kind, title, byteLen, isOversized = false, srcHash = '', collapseSource }) {
        const wrap = document.createElement('div');
        wrap.className = 'lpe-card-frame-wrap is-placeholder';
        if (isOversized) wrap.dataset.lpeOversized = '1';
        if (srcHash) wrap.dataset.lpeSrcHash = srcHash;
        const box = document.createElement('div');
        box.className = 'lpe-card-placeholder';
        const kb = (byteLen / 1024).toFixed(1);
        const msg = kind === 'oversized'
            ? `Large interactive screen (${kb} KB) paused by performance guard`
            : `Interactive screen outside active Render Depth (${kb} KB)`;
        box.innerHTML = `
            <span class="lpe-card-ph-text"><i class="fa-solid ${kind === 'oversized' ? 'fa-shield-halved' : 'fa-layer-group'}"></i> <b>${esc(title)}</b> — ${esc(msg)}</span>
        `;
        const btns = document.createElement('span');
        btns.className = 'lpe-card-ph-btns';
        const loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.className = 'lpe-mini-btn lpe-card-load-btn';
        loadBtn.innerHTML = kind === 'oversized'
            ? '<i class="fa-solid fa-play"></i> Render Once'
            : '<i class="fa-solid fa-play"></i> Load Interactive Screen';
        btns.appendChild(loadBtn);
        if (collapseSource) {
            const srcBtn = document.createElement('button');
            srcBtn.type = 'button';
            srcBtn.className = 'lpe-mini-btn lpe-card-src-btn';
            srcBtn.textContent = sourceOpenPres.has(preEl) ? 'Hide Source' : 'Source';
            btns.appendChild(srcBtn);
        }
        box.appendChild(btns);
        wrap.appendChild(box);
        return wrap;
    }

    function extractScreenTitle(html) {
        const m = String(html || '').match(/<title\b[^>]*>([^<]{1,64})<\/title>/i);
        return m ? m[1].trim() : 'Interactive Screen';
    }

    function mountIframeForPre(preEl, codeText, { mesId, settings, collapseMode }) {
        const allowExternal = Boolean(settings.rendererAllowExternalResources);
        const useBlob = settings.rendererUseBlobUrl !== false;
        const themeName = settings.hudTheme || 'Sola';
        const blockHash = hashStringExact(codeText, `${allowExternal ? 1 : 0}:${useBlob ? 1 : 0}`);

        const existing = mounted.get(preEl);
        if (
            existing
            && existing.status === 'mounted'
            && existing.hash === blockHash
            && existing.mesId === mesId
            && (!bridgeHost?.has || bridgeHost.has(existing.token))
            && existing.wrapEl?.isConnected
            && existing.wrapEl.previousElementSibling === preEl
            && existing.iframe?.isConnected
        ) {
            // Keep live iframe completely undisturbed; only sync code-collapse state
            const shouldHideCode = collapseMode !== 'none' && !sourceOpenPres.has(preEl);
            preEl.classList.toggle('lpe-code-hidden', shouldHideCode);
            return existing;
        }
        if (existing) removeRecordDom(preEl, existing);

        const token = generateFrameToken();
        const rawState = getStateForMesId?.(mesId) ?? store?.getState?.() ?? {};
        const initialState = sanitizeStateForCard(rawState);
        const initialVars = store?.getCardVars?.() || {};
        const themeVars = resolveThemeVarsForCard(themeName);
        const title = extractScreenTitle(codeText);
        const hostOrigin = typeof globalThis.window !== 'undefined' ? (globalThis.window.location?.origin || '') : '';

        const docHtml = assembleSandboxedDocument(codeText, {
            token,
            themeVars,
            initialState,
            initialVars,
            meta: { mesId, title },
            allowExternalResources: allowExternal,
            hostOrigin,
        });

        let blobUrl = null;
        try {
            const wrap = document.createElement('div');
            wrap.className = 'lpe-card-frame-wrap';
            wrap.dataset.lpeFrameMesid = String(mesId);
            wrap.dataset.lpeToken = token;
            wrap.dataset.lpeSrcHash = hashStringExact(codeText);

            const bar = document.createElement('div');
            bar.className = 'lpe-card-frame-bar';
            bar.innerHTML = `<span class="lpe-card-frame-title"><i class="fa-solid fa-window-maximize"></i> ${esc(title)} <small class="lpe-card-sandbox-pill" title="Sandboxed iframe (${useBlob ? 'Blob URL' : 'srcdoc'}) without host access">Sandboxed · ${useBlob ? 'Blob' : 'srcdoc'}</small></span>`;

            const barBtns = document.createElement('span');
            barBtns.className = 'lpe-card-frame-actions';
            if (collapseMode !== 'none') {
                const srcBtn = document.createElement('button');
                srcBtn.type = 'button';
                srcBtn.className = 'lpe-mini-btn lpe-card-src-btn';
                srcBtn.textContent = sourceOpenPres.has(preEl) ? 'Hide Source' : 'Source';
                barBtns.appendChild(srcBtn);
            }
            const unloadBtn = document.createElement('button');
            unloadBtn.type = 'button';
            unloadBtn.className = 'lpe-mini-btn lpe-card-unload-btn';
            unloadBtn.title = 'Unload interactive iframe & free memory';
            unloadBtn.innerHTML = '<i class="fa-solid fa-power-off"></i>';
            barBtns.appendChild(unloadBtn);
            bar.appendChild(barBtns);

            const iframe = document.createElement('iframe');
            iframe.className = 'lpe-card-iframe';
            // Tightest sandbox: ONLY allow-scripts (no allow-same-origin, no allow-forms, no allow-popups)
            iframe.setAttribute('sandbox', 'allow-scripts');
            iframe.setAttribute('referrerpolicy', 'no-referrer');
            iframe.setAttribute('loading', 'lazy');
            iframe.style.height = `${DEFAULT_FRAME_HEIGHT}px`;

            if (useBlob && typeof Blob === 'function' && typeof URL?.createObjectURL === 'function') {
                try {
                    const blob = new Blob([docHtml], { type: 'text/html;charset=utf-8' });
                    blobUrl = URL.createObjectURL(blob);
                    iframe.src = blobUrl;
                } catch {
                    if (blobUrl) {
                        try { URL.revokeObjectURL(blobUrl); totalRevokedUrls++; } catch { /* ignore */ }
                    }
                    blobUrl = null;
                    iframe.srcdoc = docHtml;
                }
            } else {
                iframe.srcdoc = docHtml;
            }

            wrap.appendChild(bar);
            wrap.appendChild(iframe);
            preEl.after(wrap);

            const shouldHideCode = collapseMode !== 'none' && !sourceOpenPres.has(preEl);
            preEl.classList.toggle('lpe-code-hidden', shouldHideCode);

            const rec = {
                status: 'mounted',
                token,
                blobUrl,
                iframe,
                wrapEl: wrap,
                hash: blockHash,
                mesId,
            };
            mounted.set(preEl, rec);
            bridgeHost?.register?.({ token, iframe, mesId });
            return rec;
        } catch (err) {
            if (blobUrl) {
                try { URL.revokeObjectURL(blobUrl); totalRevokedUrls++; } catch { /* ignore */ }
            }
            bridgeHost?.unregister?.(token);
            throw err;
        }
    }

    function refreshAll() {
        const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        sweepDisconnected();

        const settings = getSettings?.() || {};
        if (!settings.enabled || !settings.rendererEnabled || shouldYieldRenderer(settings)) {
            teardownAll();
            lastScanMs = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - t0;
            return { mountedCount: 0, placeholderCount: 0, elapsedMs: lastScanMs };
        }

        const chatRoot = typeof document !== 'undefined' ? document.getElementById('chat') : null;
        if (!chatRoot) {
            return { mountedCount: 0, placeholderCount: 0, elapsedMs: 0 };
        }
        ensureChatDelegation(chatRoot);

        const depth = Math.max(0, Math.min(50, Number(settings.rendererDepth ?? 2)));
        const maxBytes = Math.max(64, Number(settings.rendererMaxHtmlKb ?? 2048)) * 1024;
        const collapseMode = ['frontend', 'all', 'none'].includes(settings.rendererCollapseCode)
            ? settings.rendererCollapseCode
            : 'frontend';

        const mesNodes = Array.from(chatRoot.querySelectorAll('.mes'));
        const activeMesSet = new Set();
        if (depth === 0) {
            for (const m of mesNodes) activeMesSet.add(m);
        } else {
            for (let i = Math.max(0, mesNodes.length - depth); i < mesNodes.length; i++) {
                activeMesSet.add(mesNodes[i]);
            }
        }

        let mountedCount = 0;
        let placeholderCount = 0;

        // Walk newest -> oldest so MAX_CONCURRENT_IFRAMES prioritizes recent floors when depth === 0
        for (let mi = mesNodes.length - 1; mi >= 0; mi--) {
            const mesEl = mesNodes[mi];
            const mesId = Number(mesEl.getAttribute('mesid'));
            const pres = mesEl.querySelectorAll('.mes_text pre');
            for (const preEl of pres) {
                const codeEl = preEl.querySelector('code') || preEl;
                const codeText = codeEl.textContent || '';
                if (!isFrontendHtmlBlock(codeText)) {
                    const prevRec = mounted.get(preEl);
                    if (prevRec) {
                        removeRecordDom(preEl, prevRec);
                        mounted.delete(preEl);
                    }
                    applyPlainCodeCollapse(preEl, collapseMode);
                    continue;
                }

                // Ensure non-frontend toggle isn't left behind on frontend <pre>
                if (preEl.previousElementSibling?.classList?.contains('lpe-code-fold-toggle')) {
                    preEl.previousElementSibling.remove();
                }

                const byteLen = utf8ByteLength(codeText);
                const srcHash = hashStringExact(codeText);
                const wasUnloaded = unloadedPres.get(preEl) === srcHash;
                const inDepth = activeMesSet.has(mesEl) || manualLoadPres.has(preEl);
                const isOversized = byteLen > maxBytes && !forceHugePres.has(preEl);
                // Hard concurrent ceiling even for manual loads so memory stays bounded
                const overConcurrentCap = mountedCount >= MAX_CONCURRENT_IFRAMES;
                const title = extractScreenTitle(codeText);

                if (isOversized || wasUnloaded || !inDepth || overConcurrentCap) {
                    const kind = isOversized ? 'oversized' : 'depth';
                    const phKey = `ph:${kind}:${srcHash}`;
                    const existing = mounted.get(preEl);
                    const shouldHide = collapseMode !== 'none' && !sourceOpenPres.has(preEl);
                    preEl.classList.toggle('lpe-code-hidden', shouldHide);

                    if (existing && existing.status === 'placeholder' && existing.hash === phKey && existing.wrapEl?.isConnected) {
                        placeholderCount++;
                        continue;
                    }
                    if (existing) removeRecordDom(preEl, existing);

                    const phWrap = buildPlaceholderWrap(preEl, {
                        kind,
                        title,
                        byteLen,
                        isOversized,
                        srcHash,
                        collapseSource: collapseMode !== 'none',
                    });
                    preEl.after(phWrap);
                    mounted.set(preEl, { status: 'placeholder', hash: phKey, wrapEl: phWrap, mesId });
                    placeholderCount++;
                    continue;
                }

                mountIframeForPre(preEl, codeText, { mesId, settings, collapseMode });
                mountedCount++;
            }
        }

        lastScanMs = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - t0;
        return { mountedCount, placeholderCount, elapsedMs: lastScanMs };
    }

    function getStats() {
        let activeIframes = 0;
        let placeholders = 0;
        for (const rec of mounted.values()) {
            if (rec.status === 'mounted' && rec.iframe) activeIframes++;
            else if (rec.status === 'placeholder') placeholders++;
        }
        return {
            activeIframes,
            placeholders,
            totalRevokedUrls,
            lastScanMs: Math.round(lastScanMs * 100) / 100,
        };
    }

    function dispose() {
        teardownAll();
        if (delegatedRoot && typeof delegatedRoot.removeEventListener === 'function') {
            delegatedRoot.removeEventListener('click', onChatClick);
        }
        delegatedRoot = null;
    }

    return {
        refreshAll,
        teardownAll,
        dispose,
        showConfirmSendBar,
        getStats,
    };
}
