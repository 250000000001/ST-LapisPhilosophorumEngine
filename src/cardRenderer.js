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
 * from Vexa XML, Markdown code examples, and ordinary programming snippets.
 */
export function isFrontendHtmlBlock(codeText) {
    if (typeof codeText !== 'string') return false;
    const head = codeText.slice(0, 2048).trimStart();
    if (!head || head.length < 16) return false;

    // Never hijack Vexa internal XML/tail payloads
    if (/^<(?:internal_states|vexa_tail|vexa_receipt|state:|UpdateVariable)/i.test(head)) {
        return false;
    }

    if (/^(?:<!DOCTYPE\s+html\b|<html\b)/i.test(head)) return true;
    if (/<!--\s*vexa-(?:screen|widget)\s*-->/i.test(head)) return true;
    if (/data-vexa-screen\s*=/.test(head)) return true;
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

    if (typeof hljsObj.highlightElement === 'function' && !hljsObj.highlightElement.__vseGuarded) {
        const origFn = hljsObj.highlightElement.bind(hljsObj);
        installedHljsOrig = origFn;
        const wrapped = function vexaGuardedHighlightElement(el, ...rest) {
            try {
                if (shouldSkipHljs(el)) {
                    if (el.dataset) el.dataset.vseHljsSkipped = '1';
                    return;
                }
            } catch {
                // Fall back to default highlight on any guard error
            }
            return origFn(el, ...rest);
        };
        wrapped.__vseGuarded = true;
        wrapped.__vseOrig = origFn;
        hljsObj.highlightElement = wrapped;
    }

    if (typeof hljsObj.highlightBlock === 'function' && !hljsObj.highlightBlock.__vseGuarded) {
        const origBlockFn = hljsObj.highlightBlock.bind(hljsObj);
        installedHljsBlockOrig = origBlockFn;
        const wrappedBlock = function vexaGuardedHighlightBlock(el, ...rest) {
            try {
                if (shouldSkipHljs(el)) {
                    if (el.dataset) el.dataset.vseHljsSkipped = '1';
                    return;
                }
            } catch {
                // Fallback
            }
            return origBlockFn(el, ...rest);
        };
        wrappedBlock.__vseGuarded = true;
        wrappedBlock.__vseOrig = origBlockFn;
        hljsObj.highlightBlock = wrappedBlock;
    }

    return true;
}

export function uninstallHljsGuard() {
    const hljsObj = globalThis.hljs || globalThis.window?.hljs;
    if (hljsObj) {
        if (hljsObj.highlightElement?.__vseGuarded && hljsObj.highlightElement.__vseOrig) {
            hljsObj.highlightElement = hljsObj.highlightElement.__vseOrig;
        } else if (installedHljsOrig && hljsObj.highlightElement?.__vseGuarded) {
            hljsObj.highlightElement = installedHljsOrig;
        }
        if (hljsObj.highlightBlock?.__vseGuarded && hljsObj.highlightBlock.__vseOrig) {
            hljsObj.highlightBlock = hljsObj.highlightBlock.__vseOrig;
        } else if (installedHljsBlockOrig && hljsObj.highlightBlock?.__vseGuarded) {
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
    const manualLoadPres = new WeakSet();
    const forceHugePres = new WeakSet();
    const unloadedPres = new WeakMap(); // preEl -> blockHash explicitly unloaded by user
    const sourceOpenPres = new WeakSet();
    let totalRevokedUrls = 0;
    let lastScanMs = 0;

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
        try { preEl?.classList?.remove('vse-code-hidden'); } catch { /* ignore */ }
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
            for (const bar of document.querySelectorAll('#chat .vse-code-fold-toggle')) {
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
        if (typeof document !== 'undefined') {
            for (const el of document.querySelectorAll('#chat .vse-card-frame-wrap, #chat .vse-code-fold-toggle')) {
                el.remove();
            }
            for (const pre of document.querySelectorAll('#chat pre.vse-code-hidden')) {
                pre.classList.remove('vse-code-hidden');
            }
        }
    }

    function showConfirmSendBar(token, text) {
        for (const rec of mounted.values()) {
            if (rec.token !== token || !rec.wrapEl) continue;
            const existing = rec.wrapEl.querySelector('.vse-card-confirm-bar');
            if (existing) existing.remove();
            const fullText = String(text || '');
            const bar = document.createElement('div');
            bar.className = 'vse-card-confirm-bar';
            const label = document.createElement('span');
            const previewShort = `${fullText.slice(0, 72)}${fullText.length > 72 ? '...' : ''}`;
            label.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Screen queued reply (${esc(fullText.length)} chars): <code>${esc(previewShort)}</code>`;
            let expanded = false;
            const actions = document.createElement('div');
            actions.className = 'vse-card-confirm-actions';
            if (fullText.length > 72) {
                const viewBtn = document.createElement('button');
                viewBtn.type = 'button';
                viewBtn.className = 'vse-mini-btn';
                viewBtn.textContent = 'View Full';
                viewBtn.addEventListener('click', () => {
                    expanded = !expanded;
                    const codeEl = label.querySelector('code');
                    if (codeEl) codeEl.textContent = expanded ? fullText : previewShort;
                    viewBtn.textContent = expanded ? 'Collapse' : 'View Full';
                });
                actions.appendChild(viewBtn);
            }
            const sendBtn = document.createElement('button');
            sendBtn.type = 'button';
            sendBtn.className = 'vse-mini-btn vse-card-send-confirm';
            sendBtn.innerHTML = '<i class="fa-solid fa-check"></i> Send to Chat';
            sendBtn.addEventListener('click', () => {
                bar.remove();
                onConfirmSend?.(fullText, rec);
            });
            const dismissBtn = document.createElement('button');
            dismissBtn.type = 'button';
            dismissBtn.className = 'vse-mini-btn';
            dismissBtn.textContent = 'Dismiss';
            dismissBtn.addEventListener('click', () => bar.remove());
            actions.appendChild(sendBtn);
            actions.appendChild(dismissBtn);
            bar.appendChild(label);
            bar.appendChild(actions);
            rec.wrapEl.appendChild(bar);
            return true;
        }
        return false;
    }

    function applyPlainCodeCollapse(preEl, collapseMode) {
        const shouldHidePlain = collapseMode === 'all';
        let toggleEl = preEl.previousElementSibling?.classList?.contains('vse-code-fold-toggle')
            ? preEl.previousElementSibling
            : null;
        if (!shouldHidePlain) {
            preEl.classList.remove('vse-code-hidden');
            if (toggleEl) toggleEl.remove();
            return;
        }
        if (!toggleEl) {
            toggleEl = document.createElement('div');
            toggleEl.className = 'vse-code-fold-toggle';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'vse-mini-btn';
            const updateBtn = () => {
                const open = sourceOpenPres.has(preEl);
                preEl.classList.toggle('vse-code-hidden', !open);
                btn.innerHTML = open
                    ? '<i class="fa-solid fa-eye-slash"></i> Hide Code Block'
                    : '<i class="fa-solid fa-code"></i> Show Code Block';
            };
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (sourceOpenPres.has(preEl)) sourceOpenPres.delete(preEl);
                else sourceOpenPres.add(preEl);
                updateBtn();
            });
            toggleEl.appendChild(btn);
            preEl.before(toggleEl);
            updateBtn();
        } else {
            preEl.classList.toggle('vse-code-hidden', !sourceOpenPres.has(preEl));
        }
    }

    function buildPlaceholderWrap(preEl, { kind, title, byteLen, onActivate, collapseSource }) {
        const wrap = document.createElement('div');
        wrap.className = 'vse-card-frame-wrap is-placeholder';
        const box = document.createElement('div');
        box.className = 'vse-card-placeholder';
        const kb = (byteLen / 1024).toFixed(1);
        const msg = kind === 'oversized'
            ? `Large interactive screen (${kb} KB) paused by performance guard`
            : `Interactive screen outside active Render Depth (${kb} KB)`;
        box.innerHTML = `
            <span class="vse-card-ph-text"><i class="fa-solid ${kind === 'oversized' ? 'fa-shield-halved' : 'fa-layer-group'}"></i> <b>${esc(title)}</b> — ${esc(msg)}</span>
        `;
        const btns = document.createElement('span');
        btns.className = 'vse-card-ph-btns';
        const loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.className = 'vse-mini-btn vse-card-load-btn';
        loadBtn.innerHTML = kind === 'oversized'
            ? '<i class="fa-solid fa-play"></i> Render Once'
            : '<i class="fa-solid fa-play"></i> Load Interactive Screen';
        loadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onActivate();
        });
        btns.appendChild(loadBtn);
        if (collapseSource) {
            const srcBtn = document.createElement('button');
            srcBtn.type = 'button';
            srcBtn.className = 'vse-mini-btn vse-card-src-btn';
            srcBtn.textContent = sourceOpenPres.has(preEl) ? 'Hide Source' : 'Source';
            srcBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (sourceOpenPres.has(preEl)) sourceOpenPres.delete(preEl);
                else sourceOpenPres.add(preEl);
                preEl.classList.toggle('vse-code-hidden', !sourceOpenPres.has(preEl));
                srcBtn.textContent = sourceOpenPres.has(preEl) ? 'Hide Source' : 'Source';
            });
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
            && existing.wrapEl?.isConnected
            && existing.wrapEl.previousElementSibling === preEl
            && existing.iframe?.isConnected
        ) {
            // Keep live iframe completely undisturbed; only sync code-collapse state
            const shouldHideCode = collapseMode !== 'none' && !sourceOpenPres.has(preEl);
            preEl.classList.toggle('vse-code-hidden', shouldHideCode);
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
            wrap.className = 'vse-card-frame-wrap';
            wrap.dataset.vseFrameMesid = String(mesId);

            const bar = document.createElement('div');
            bar.className = 'vse-card-frame-bar';
            bar.innerHTML = `<span class="vse-card-frame-title"><i class="fa-solid fa-window-maximize"></i> ${esc(title)} <small class="vse-card-sandbox-pill" title="Sandboxed iframe (${useBlob ? 'Blob URL' : 'srcdoc'}) without host access">Sandboxed · ${useBlob ? 'Blob' : 'srcdoc'}</small></span>`;

            const barBtns = document.createElement('span');
            barBtns.className = 'vse-card-frame-actions';
            if (collapseMode !== 'none') {
                const srcBtn = document.createElement('button');
                srcBtn.type = 'button';
                srcBtn.className = 'vse-mini-btn vse-card-src-btn';
                srcBtn.textContent = sourceOpenPres.has(preEl) ? 'Hide Source' : 'Source';
                srcBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (sourceOpenPres.has(preEl)) sourceOpenPres.delete(preEl);
                    else sourceOpenPres.add(preEl);
                    preEl.classList.toggle('vse-code-hidden', !sourceOpenPres.has(preEl));
                    srcBtn.textContent = sourceOpenPres.has(preEl) ? 'Hide Source' : 'Source';
                });
                barBtns.appendChild(srcBtn);
            }
            const unloadBtn = document.createElement('button');
            unloadBtn.type = 'button';
            unloadBtn.className = 'vse-mini-btn';
            unloadBtn.title = 'Unload interactive iframe & free memory';
            unloadBtn.innerHTML = '<i class="fa-solid fa-power-off"></i>';
            unloadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                manualLoadPres.delete(preEl);
                forceHugePres.delete(preEl);
                unloadedPres.set(preEl, hashStringExact(codeText));
                refreshAll();
            });
            barBtns.appendChild(unloadBtn);
            bar.appendChild(barBtns);

            const iframe = document.createElement('iframe');
            iframe.className = 'vse-card-iframe';
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
            preEl.classList.toggle('vse-code-hidden', shouldHideCode);

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
                if (preEl.previousElementSibling?.classList?.contains('vse-code-fold-toggle')) {
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
                    preEl.classList.toggle('vse-code-hidden', shouldHide);

                    if (existing && existing.status === 'placeholder' && existing.hash === phKey && existing.wrapEl?.isConnected) {
                        placeholderCount++;
                        continue;
                    }
                    if (existing) removeRecordDom(preEl, existing);

                    const phWrap = buildPlaceholderWrap(preEl, {
                        kind,
                        title,
                        byteLen,
                        collapseSource: collapseMode !== 'none',
                        onActivate: () => {
                            unloadedPres.delete(preEl);
                            manualLoadPres.add(preEl);
                            if (isOversized) forceHugePres.add(preEl);
                            // If at concurrent ceiling, automatically demote an auto-loaded frame so cap holds
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
                        },
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

    return {
        refreshAll,
        teardownAll,
        showConfirmSendBar,
        getStats,
    };
}
