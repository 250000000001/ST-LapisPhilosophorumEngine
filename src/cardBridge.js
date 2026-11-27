/**
 * Sandboxed `postMessage` Host Bridge & Document Assembler for Interactive Card Screens.
 *
 * Original implementation under CC BY-NC 4.0.
 * Never exposes `window.parent`, `SillyTavern.getContext()`, `workerApiKey`, or host DOM
 * to card iframes (`sandbox="allow-scripts"` — no `allow-same-origin`, `allow-forms`, or `allow-popups`).
 * All host interactions pass through a per-iframe 128-bit token + strict `ev.source` verification +
 * rate limits + explicit allowlisted RPC methods.
 */

import { LPE_THEMES } from './schema.js';
import { computeHealthMetrics, hasExplicitHealthData, inferHealthFromStatusText } from './healthDoll.js';

const BRIDGE_CHANNEL = 'lpe-card-bridge';
const LEGACY_BRIDGE_CHANNEL = 'vexa-card-bridge';
const MAX_PAYLOAD_BYTES = 65536;
const MAX_PAYLOAD_DEPTH = 14;
const MAX_PAYLOAD_NODES = 2048;
const MIN_FRAME_HEIGHT = 60;
const MAX_FRAME_HEIGHT = 2400;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ALLOWED_METHODS = new Set([
    'resize',
    'getState',
    'getPath',
    'getVars',
    'getVar',
    'setVar',
    'patchVars',
    'toast',
    'fillInput',
    'submitInput',
]);

function inspectBridgePayload(val, state = { nodes: 0 }, depth = 0) {
    if (depth > MAX_PAYLOAD_DEPTH) {
        return { ok: false, error: `Payload exceeds depth ${MAX_PAYLOAD_DEPTH}` };
    }
    if (!val || typeof val !== 'object') {
        state.nodes++;
        if (state.nodes > MAX_PAYLOAD_NODES) return { ok: false, error: 'Payload exceeds node cap' };
        return { ok: true };
    }
    state.nodes++;
    if (state.nodes > MAX_PAYLOAD_NODES) {
        return { ok: false, error: 'Payload exceeds node cap' };
    }
    if (Array.isArray(val)) {
        for (const item of val) {
            const sub = inspectBridgePayload(item, state, depth + 1);
            if (!sub.ok) return sub;
        }
        return { ok: true };
    }
    const proto = Object.getPrototypeOf(val);
    if (proto !== null && proto !== Object.prototype) {
        return { ok: false, error: 'Unsupported object type in payload' };
    }
    for (const k of Object.getOwnPropertyNames(val)) {
        if (FORBIDDEN_KEYS.has(k)) return { ok: false, error: `Forbidden key "${k}" in payload` };
        const sub = inspectBridgePayload(val[k], state, depth + 1);
        if (!sub.ok) return sub;
    }
    return { ok: true };
}

function cloneJsonSafe(val, depth = 0) {
    if (depth > 24 || val === null || val === undefined) return val === null ? null : undefined;
    const t = typeof val;
    if (t === 'string' || t === 'boolean') return val;
    if (t === 'number') return Number.isFinite(val) ? val : null;
    if (Array.isArray(val)) return val.map((x) => cloneJsonSafe(x, depth + 1));
    if (t === 'object') {
        const out = {};
        for (const k of Object.keys(val)) {
            if (FORBIDDEN_KEYS.has(k)) continue;
            const c = cloneJsonSafe(val[k], depth + 1);
            if (c !== undefined) out[k] = c;
        }
        return out;
    }
    return undefined;
}

function readDotPathSafe(root, pathStr) {
    if (!root || typeof root !== 'object' || typeof pathStr !== 'string') return undefined;
    const segs = pathStr.trim().split('.');
    let cur = root;
    for (const seg of segs) {
        if (!seg || FORBIDDEN_KEYS.has(seg) || !cur || typeof cur !== 'object') return undefined;
        if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
        cur = cur[seg];
    }
    return cur;
}

/** Generate a cryptographically random 128-bit per-iframe nonce token. */
export function generateFrameToken() {
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        globalThis.crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    const p1 = Math.random().toString(16).slice(2).padEnd(16, '0').slice(0, 16);
    const p2 = Date.now().toString(16).padStart(16, '0').slice(0, 16);
    return p1 + p2;
}

/** Build the strict CSP `<meta>` policy for sandboxed interactive card frames. */
export function buildSandboxCsp({ allowExternalResources = false } = {}) {
    const policy = allowExternalResources
        ? "default-src 'none'; script-src 'unsafe-inline' blob: https:; style-src 'unsafe-inline' blob: https:; img-src data: blob: https:; font-src data: blob: https:; media-src data: blob:; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none';"
        : "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:; img-src data: blob:; font-src data: blob:; media-src data: blob:; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none';";
    return `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
}

/** Pick safe gameplay fields ONLY from LPE state (never exposes extensionSettings, keys, or prompts). */
export function sanitizeStateForCard(state) {
    const src = state && typeof state === 'object' ? state : {};
    const healthRaw = cloneJsonSafe(src.health || {}) || {};
    const effHealth = hasExplicitHealthData(healthRaw)
        ? healthRaw
        : inferHealthFromStatusText(src.inv?.status || '', healthRaw.bodyType || 'male');
    const metrics = computeHealthMetrics(effHealth);

    return {
        world: cloneJsonSafe(src.world || {}) || {},
        onscreen: cloneJsonSafe(src.onscreen || []) || [],
        offscreen_agendas: cloneJsonSafe(src.offscreen_agendas || []) || [],
        entity_state: cloneJsonSafe(src.entity_state || []) || [],
        inv: cloneJsonSafe(src.inv || {}) || {},
        health: {
            ...healthRaw,
            overallHp: metrics.overallHp,
            pain: metrics.pain,
            painLabel: metrics.painLabel,
            bloodLoss: metrics.bloodLoss,
            bleedingLevel: metrics.bleedingLevel,
            bleedingCount: metrics.bleedingCount,
            totalWounds: metrics.totalWounds,
            capacities: cloneJsonSafe(metrics.capacities) || {},
        },
        tracks: cloneJsonSafe(src.tracks || {}) || {},
        arc: cloneJsonSafe(src.arc || {}) || {},
        chekhov: cloneJsonSafe(src.chekhov || {}) || {},
        pair: cloneJsonSafe(src.pair || []) || [],
        dam: cloneJsonSafe(src.dam || []) || [],
        custom_trackers: cloneJsonSafe(src.custom_trackers || []) || [],
        notebook: cloneJsonSafe(src.notebook || []) || [],
        story_notes: cloneJsonSafe(src.story_notes || {}) || {},
        locations: cloneJsonSafe(src.locations || {}) || {},
    };
}

export function resolveThemeVarsForCard(themeName = 'Magnum Opus') {
    const t = LPE_THEMES[themeName] || LPE_THEMES['Magnum Opus'] || LPE_THEMES.Sola;
    return {
        bg: t.base,
        mantle: t.mantle,
        surface: t.surface,
        border: t.border,
        text: t.text,
        subtext: t.subtext,
        muted: t.muted,
        accent: t.blue,
        green: t.green,
        red: t.red,
        yellow: t.yellow,
        scheme: t.scheme || 'dark',
    };
}

function safeInlineJson(value) {
    return JSON.stringify(value ?? null)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/** Generate the bootstrap CSS + locked `window.LPECard` (and `window.VexaCard` alias) inside each card iframe. */
export function buildBridgeBootstrapScript({ token, themeVars, initialState, initialVars, meta, hostOrigin = '' }) {
    const vars = themeVars || resolveThemeVarsForCard('Magnum Opus');
    const cssText = `:root{color-scheme:${vars.scheme};--lpe-vh:600px;--lpe-bg:${vars.bg};--lpe-mantle:${vars.mantle};--lpe-surface:${vars.surface};--lpe-border:${vars.border};--lpe-text:${vars.text};--lpe-subtext:${vars.subtext};--lpe-muted:${vars.muted};--lpe-accent:${vars.accent};--lpe-accent-1:${vars.accent};--lpe-accent-2:${vars.yellow};--lpe-green:${vars.green};--lpe-red:${vars.red};--lpe-yellow:${vars.yellow};--vse-vh:var(--lpe-vh);--vse-bg:var(--lpe-bg);--vse-mantle:var(--lpe-mantle);--vse-surface:var(--lpe-surface);--vse-border:var(--lpe-border);--vse-text:var(--lpe-text);--vse-subtext:var(--lpe-subtext);--vse-muted:var(--lpe-muted);--vse-accent:var(--lpe-accent);--vse-green:var(--lpe-green);--vse-red:var(--lpe-red);--vse-yellow:var(--lpe-yellow);}html,body{margin:0;padding:0;overflow-x:hidden;color:var(--lpe-text);font-family:system-ui,-apple-system,Segoe UI,sans-serif;}`;
    const targetOrigin = hostOrigin && hostOrigin !== 'null' ? hostOrigin : '*';

    return `<style data-lpe-bridge-css="1">${cssText}</style><script data-lpe-bridge-js="1">(function(){
"use strict";
var TOKEN=${safeInlineJson(token)};
var CHANNEL=${safeInlineJson(BRIDGE_CHANNEL)};
var LEGACY_CHANNEL=${safeInlineJson(LEGACY_BRIDGE_CHANNEL)};
var TARGET_ORIGIN=${safeInlineJson(targetOrigin)};
var cachedState=${safeInlineJson(initialState || {})};
var cachedVars=${safeInlineJson(initialVars || {})};
var meta=${safeInlineJson(meta || {})};
var pending=new Map();
var stateListeners=new Set();
var varListeners=new Set();
var rpcSeq=1;
var lastHeight=0;
var resizeTimer=null;

function post(method,payload){
  return new Promise(function(resolve,reject){
    var id="r_"+(rpcSeq++);
    var timer=setTimeout(function(){pending.delete(id);reject(new Error("Bridge timeout: "+method));},5000);
    pending.set(id,{resolve:resolve,reject:reject,timer:timer});
    try{
      window.parent.postMessage({type:"LPE_CARD_RPC",channel:CHANNEL,token:TOKEN,id:id,method:method,payload:payload===undefined?null:payload},TARGET_ORIGIN);
    }catch(err){clearTimeout(timer);pending.delete(id);reject(err);}
  });
}

function postResize(h){
  var num=Math.max(${MIN_FRAME_HEIGHT},Math.min(${MAX_FRAME_HEIGHT},Math.ceil(Number(h)||0)));
  if(Math.abs(num-lastHeight)<2)return;
  lastHeight=num;
  try{
    window.parent.postMessage({type:"LPE_CARD_RPC",channel:CHANNEL,token:TOKEN,id:"resize",method:"resize",payload:{height:num}},TARGET_ORIGIN);
  }catch(_e){}
}

function measureAndResize(){
  if(resizeTimer)clearTimeout(resizeTimer);
  resizeTimer=setTimeout(function(){
    resizeTimer=null;
    var b=document.body,d=document.documentElement;
    var h=Math.max(b?b.scrollHeight:0,d?d.scrollHeight:0,b?b.offsetHeight:0);
    if(h>0)postResize(h);
  },80);
}

window.addEventListener("message",function(ev){
  if(!ev||ev.source!==window.parent)return;
  if(TARGET_ORIGIN!=="*"&&ev.origin!==TARGET_ORIGIN)return;
  var msg=ev.data;
  if(!msg||(msg.channel!==CHANNEL&&msg.channel!==LEGACY_CHANNEL)||msg.token!==TOKEN)return;
  if(msg.replyTo&&pending.has(msg.replyTo)){
    var p=pending.get(msg.replyTo);
    pending.delete(msg.replyTo);
    clearTimeout(p.timer);
    if(msg.ok)p.resolve(msg.result);
    else p.reject(new Error(msg.error||"Bridge error"));
    return;
  }
  if(msg.event==="state"&&msg.payload){
    cachedState=msg.payload;
    stateListeners.forEach(function(fn){try{fn(cachedState);}catch(_e){}});
  }else if(msg.event==="vars"&&msg.payload){
    cachedVars=msg.payload;
    varListeners.forEach(function(fn){try{fn(cachedVars);}catch(_e){}});
  }
});

function readDot(obj,path){
  if(!obj||typeof path!=="string")return undefined;
  var parts=path.trim().split("."),cur=obj;
  for(var i=0;i<parts.length;i++){
    var k=parts[i];
    if(!k||k==="__proto__"||k==="constructor"||k==="prototype"||!cur||typeof cur!=="object")return undefined;
    if(!Object.prototype.hasOwnProperty.call(cur,k))return undefined;
    cur=cur[k];
  }
  return cur;
}

function rollLocal(expr){
  var raw=String(expr||"1d100").trim();
  var m=raw.match(/^(\\d{1,3})?d(\\d{1,5})(?:k([hl])(\\d{1,3}))?(?:\\s*([+-])\\s*(\\d{1,5}))?$/i);
  if(!m)throw new Error("Invalid dice: "+raw);
  var cnt=Math.max(1,Math.min(100,m[1]?Number(m[1]):1));
  var sides=Math.max(1,Math.min(10000,Number(m[2])));
  var mod=(m[5]&&m[6])?(m[5]==="-"?-Number(m[6]):Number(m[6])):0;
  var rolls=[];
  for(var i=0;i<cnt;i++)rolls.push(1+Math.floor(Math.random()*sides));
  var kept=rolls.slice();
  if(m[3]){
    var k=Math.max(1,Math.min(cnt,Number(m[4]||cnt)));
    kept=rolls.slice().sort(function(a,b){return m[3].toLowerCase()==="h"?b-a:a-b;}).slice(0,k);
  }
  var total=kept.reduce(function(a,b){return a+b;},0)+mod;
  return{total:total,rolls:rolls,kept:kept,modifier:mod,expr:raw,valueOf:function(){return total;},toString:function(){return String(total);}};
}

var api={
  version:1,
  meta:Object.freeze(Object.assign({},meta)),
  getState:function(){return JSON.parse(JSON.stringify(cachedState||{}));},
  refreshState:function(){return post("getState").then(function(s){if(s)cachedState=s;return s;});},
  getPath:function(path,fallback){var v=readDot(cachedState,path);return v===undefined?fallback:v;},
  getVars:function(){return JSON.parse(JSON.stringify(cachedVars||{}));},
  getVar:function(path,fallback){
    var p=String(path||"").trim();
    var v=readDot(cachedVars,p);
    if(v===undefined&&p.indexOf("stat_data.")!==0)v=readDot(cachedVars,"stat_data."+p);
    if(v===undefined&&p.indexOf("stat_data.")===0)v=readDot(cachedVars,p.slice(10));
    return v===undefined?fallback:v;
  },
  setVar:function(path,value){
    return post("setVar",{path:String(path||""),value:value}).then(function(res){
      if(res&&res.vars)cachedVars=res.vars;
      return res;
    });
  },
  patchVars:function(patch){
    return post("patchVars",{patch:patch}).then(function(res){
      if(res&&res.vars)cachedVars=res.vars;
      return res;
    });
  },
  roll:rollLocal,
  toast:function(message,level){return post("toast",{message:String(message||""),level:String(level||"info")});},
  fillInput:function(text){return post("fillInput",{text:String(text||"")});},
  submitInput:function(text){return post("submitInput",{text:String(text||"")});},
  resize:postResize,
  onStateChange:function(fn){if(typeof fn==="function")stateListeners.add(fn);return function(){stateListeners.delete(fn);};},
  onVarsChange:function(fn){if(typeof fn==="function")varListeners.add(fn);return function(){varListeners.delete(fn);};}
};
var frozenApi=Object.freeze(api);
Object.defineProperty(window,"LPECard",{value:frozenApi,writable:false,configurable:false});
Object.defineProperty(window,"VexaCard",{value:frozenApi,writable:false,configurable:false});

if(typeof ResizeObserver==="function"){
  try{new ResizeObserver(measureAndResize).observe(document.documentElement);}catch(_e){}
}
window.addEventListener("load",measureAndResize);
if(document.readyState==="complete"||document.readyState==="interactive")measureAndResize();
else document.addEventListener("DOMContentLoaded",measureAndResize);
})();</script>`;
}

/** Rewrite fixed `100vh` inside `<style>` rules to prevent runaway iframe height expansion. */
function rewriteViewportHeightCss(html) {
    return String(html || '').replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (m, attrs, css) => {
        const nextCss = css.replace(/\b(\d+(?:\.\d+)?)vh\b/gi, (vhMatch, n) => {
            const num = Number(n);
            return Number.isFinite(num) ? `calc(var(--lpe-vh, 600px) * ${(num / 100).toFixed(3)})` : vhMatch;
        });
        return `<style${attrs}>${nextCss}</style>`;
    });
}

/**
 * Assemble a complete standalone HTML document wrapped with CSP + `LPECard` (and `VexaCard` alias) bridge bootstrap.
 * Accepts either a full HTML document (`<!DOCTYPE html>...`) or an HTML fragment (`<div>...`).
 */
export function assembleSandboxedDocument(rawHtml, {
    token,
    themeVars,
    initialState,
    initialVars,
    meta,
    allowExternalResources = false,
    hostOrigin = '',
} = {}) {
    // Strip leading HTML comments before checking for <head>/<html> so a leading comment can't spoof placement
    const strippedLead = rewriteViewportHeightCss(rawHtml).replace(/^(?:\s|<!--[\s\S]*?-->)+/, '');
    const cspMeta = buildSandboxCsp({ allowExternalResources });
    const bridgeHead = `${cspMeta}\n${buildBridgeBootstrapScript({ token, themeVars, initialState, initialVars, meta, hostOrigin })}`;

    if (/^\s*(?:<!DOCTYPE[^>]*>\s*)?<html\b[^>]*>[\s\S]*?<head\b[^>]*>/i.test(strippedLead)) {
        return strippedLead.replace(/<head\b([^>]*)>/i, `<head$1>\n${bridgeHead}`);
    }
    if (/^\s*<head\b[^>]*>/i.test(strippedLead)) {
        return strippedLead.replace(/<head\b([^>]*)>/i, `<head$1>\n${bridgeHead}`);
    }
    if (/^\s*(?:<!DOCTYPE[^>]*>\s*)?<html\b[^>]*>/i.test(strippedLead)) {
        return strippedLead.replace(/<html\b([^>]*)>/i, `<html$1>\n<head>\n${bridgeHead}\n</head>`);
    }
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
${bridgeHead}
</head>
<body>
${strippedLead}
</body>
</html>`;
}

/**
 * Create the host-side `postMessage` coordinator managing all mounted sandboxed card iframes.
 */
export function createCardBridgeHost({
    getSettings,
    getStateForMessage,
    store,
    onFillInput,
    onSubmitInput,
    onToast,
    onVarsUpdated,
    onResizeFrame,
} = {}) {
    const frames = new Map(); // token -> { token, iframe, mesId, seq, onResize, rpcTimestamps, lastToastAt, lastSubmitAt }
    const stats = { totalRpcs: 0, blockedRpcs: 0 };

    function replyToFrame(entry, replyTo, ok, result = null, error = null, channel = BRIDGE_CHANNEL) {
        try {
            if (!entry?.iframe?.contentWindow) return;
            entry.iframe.contentWindow.postMessage({
                type: 'LPE_CARD_REPLY',
                channel,
                token: entry.token,
                replyTo,
                ok,
                result,
                error,
            }, '*');
        } catch {
            // Ignore postMessage delivery failure on detaching iframe
        }
    }

    function allowRateLimit(entry, method) {
        const now = Date.now();
        if (method === 'resize') {
            entry.resizeTimestamps = (entry.resizeTimestamps || []).filter((t) => now - t < 1000);
            if (entry.resizeTimestamps.length >= 25) return false;
            entry.resizeTimestamps.push(now);
            return true;
        }
        entry.rpcTimestamps = (entry.rpcTimestamps || []).filter((t) => now - t < 1000);
        if (entry.rpcTimestamps.length >= 40) return false;
        entry.rpcTimestamps.push(now);

        if (method === 'toast') {
            if (entry.lastToastAt && now - entry.lastToastAt < 1500) return false;
            entry.lastToastAt = now;
        }
        if (method === 'submitInput') {
            if (entry.lastSubmitAt && now - entry.lastSubmitAt < 300) return false;
            entry.lastSubmitAt = now;
        }
        return true;
    }

    function onMessage(ev) {
        const msg = ev?.data;
        const msgChannel = msg && typeof msg === 'object' ? msg.channel : '';
        if (!msg || typeof msg !== 'object' || (msgChannel !== BRIDGE_CHANNEL && msgChannel !== LEGACY_BRIDGE_CHANNEL)) return;
        if (msg.replyTo || msg.event) return;

        const token = typeof msg.token === 'string' ? msg.token : '';
        const entry = token ? frames.get(token) : null;
        if (!entry || !entry.iframe || entry.iframe.isConnected === false) {
            stats.blockedRpcs++;
            return;
        }
        if (!ev.source || ev.source !== entry.iframe.contentWindow) {
            stats.blockedRpcs++;
            return;
        }

        const settings = getSettings?.();
        if (settings && (settings.enabled === false || settings.rendererEnabled === false)) {
            stats.blockedRpcs++;
            return;
        }

        const method = typeof msg.method === 'string' ? msg.method : '';
        const replyId = typeof msg.id === 'string' && msg.id.length <= 64 ? msg.id : '';

        if (!ALLOWED_METHODS.has(method)) {
            stats.blockedRpcs++;
            if (replyId) replyToFrame(entry, replyId, false, null, `Disallowed bridge method: ${method}`, msgChannel);
            return;
        }
        if (!allowRateLimit(entry, method)) {
            stats.blockedRpcs++;
            if (replyId && method !== 'resize') replyToFrame(entry, replyId, false, null, 'Rate limit exceeded', msgChannel);
            return;
        }

        if (msg.payload !== undefined && msg.payload !== null) {
            const pChk = inspectBridgePayload(msg.payload);
            if (!pChk.ok) {
                stats.blockedRpcs++;
                if (replyId) replyToFrame(entry, replyId, false, null, pChk.error || 'Unsafe payload', msgChannel);
                return;
            }
            let payloadBytes = 0;
            try {
                const json = JSON.stringify(msg.payload);
                payloadBytes = typeof TextEncoder !== 'undefined'
                    ? new TextEncoder().encode(json).length
                    : json.length * 2;
            } catch {
                stats.blockedRpcs++;
                if (replyId) replyToFrame(entry, replyId, false, null, 'Unserializable payload', msgChannel);
                return;
            }
            if (payloadBytes > MAX_PAYLOAD_BYTES) {
                stats.blockedRpcs++;
                if (replyId) replyToFrame(entry, replyId, false, null, 'Payload exceeds 64 KB cap', msgChannel);
                return;
            }
        }

        stats.totalRpcs++;

        switch (method) {
            case 'resize': {
                const rawH = Number(msg.payload?.height);
                if (!Number.isFinite(rawH)) return;
                const clamped = Math.max(MIN_FRAME_HEIGHT, Math.min(MAX_FRAME_HEIGHT, Math.ceil(rawH)));
                if (entry.iframe?.style) {
                    entry.iframe.style.height = `${clamped}px`;
                }
                entry.onResize?.(clamped);
                onResizeFrame?.(entry, clamped);
                return;
            }
            case 'getState': {
                const rawState = getStateForMessage?.(entry.mesId) ?? store?.getState?.() ?? {};
                replyToFrame(entry, replyId, true, sanitizeStateForCard(rawState), null, msgChannel);
                return;
            }
            case 'getPath': {
                const path = String(msg.payload?.path || '');
                const rawState = getStateForMessage?.(entry.mesId) ?? store?.getState?.() ?? {};
                const clean = sanitizeStateForCard(rawState);
                replyToFrame(entry, replyId, true, readDotPathSafe(clean, path) ?? null, null, msgChannel);
                return;
            }
            case 'getVars': {
                replyToFrame(entry, replyId, true, store?.getCardVars?.() || {}, null, msgChannel);
                return;
            }
            case 'getVar': {
                const path = String(msg.payload?.path || '');
                replyToFrame(entry, replyId, true, store?.getCardVar?.(path, null) ?? null, null, msgChannel);
                return;
            }
            case 'setVar': {
                if (!store?.setCardVar) {
                    replyToFrame(entry, replyId, false, null, 'Card variable store unavailable', msgChannel);
                    return;
                }
                const path = String(msg.payload?.path || '');
                const res = store.setCardVar(path, msg.payload?.value);
                if (!res?.ok) {
                    stats.blockedRpcs++;
                    replyToFrame(entry, replyId, false, null, res?.error || 'Failed to set variable', msgChannel);
                    return;
                }
                const latestVars = store.getCardVars();
                broadcastVars(latestVars);
                onVarsUpdated?.(latestVars, entry);
                replyToFrame(entry, replyId, true, { ok: true, vars: latestVars }, null, msgChannel);
                return;
            }
            case 'patchVars': {
                if (!store?.patchCardVars) {
                    replyToFrame(entry, replyId, false, null, 'Card variable store unavailable', msgChannel);
                    return;
                }
                const res = store.patchCardVars(msg.payload?.patch);
                if (!res?.ok) {
                    stats.blockedRpcs++;
                    replyToFrame(entry, replyId, false, null, res?.error || 'Failed to patch variables', msgChannel);
                    return;
                }
                const latestVars = store.getCardVars();
                broadcastVars(latestVars);
                onVarsUpdated?.(latestVars, entry);
                replyToFrame(entry, replyId, true, { ok: true, vars: latestVars }, null, msgChannel);
                return;
            }
            case 'toast': {
                const text = String(msg.payload?.message || '').slice(0, 300);
                const level = ['info', 'success', 'warning', 'error'].includes(msg.payload?.level) ? msg.payload.level : 'info';
                onToast?.(text, level, entry);
                replyToFrame(entry, replyId, true, { ok: true }, null, msgChannel);
                return;
            }
            case 'fillInput': {
                const text = String(msg.payload?.text || '').slice(0, 16000);
                onFillInput?.(text, entry);
                replyToFrame(entry, replyId, true, { ok: true }, null, msgChannel);
                return;
            }
            case 'submitInput': {
                const text = String(msg.payload?.text || '').slice(0, 16000);
                const allowAuto = Boolean(getSettings?.()?.rendererAllowAutoSend);
                const handled = onSubmitInput?.(text, entry, { autoSend: allowAuto });
                if (handled === false) {
                    entry.lastSubmitAt = 0;
                    replyToFrame(entry, replyId, false, null, 'Failed to stage or send input', msgChannel);
                    return;
                }
                replyToFrame(entry, replyId, true, { ok: true, autoSend: allowAuto }, null, msgChannel);
                return;
            }
            default: {
                stats.blockedRpcs++;
                if (replyId) replyToFrame(entry, replyId, false, null, `Disallowed bridge method: ${method}`, msgChannel);
            }
        }
    }

    if (typeof globalThis.window?.addEventListener === 'function') {
        globalThis.window.addEventListener('message', onMessage);
    }

    function register(entry) {
        if (!entry?.token || !entry?.iframe) return;
        frames.set(entry.token, {
            ...entry,
            rpcTimestamps: [],
            resizeTimestamps: [],
            lastToastAt: 0,
            lastSubmitAt: 0,
        });
    }

    function has(token) {
        return Boolean(token && frames.has(token));
    }

    function unregister(token) {
        if (token) frames.delete(token);
    }

    function unregisterAll() {
        frames.clear();
    }

    function broadcastState(state) {
        const clean = sanitizeStateForCard(state);
        for (const [token, entry] of frames.entries()) {
            if (!entry.iframe || entry.iframe.isConnected === false) {
                frames.delete(token);
                continue;
            }
            try {
                entry.iframe.contentWindow?.postMessage({
                    type: 'LPE_CARD_EVENT',
                    channel: BRIDGE_CHANNEL,
                    token,
                    event: 'state',
                    payload: clean,
                }, '*');
            } catch {
                // Ignore
            }
        }
    }

    function broadcastVars(vars) {
        const clean = cloneJsonSafe(vars || {}) || {};
        for (const [token, entry] of frames.entries()) {
            if (!entry.iframe || entry.iframe.isConnected === false) {
                frames.delete(token);
                continue;
            }
            try {
                entry.iframe.contentWindow?.postMessage({
                    type: 'LPE_CARD_EVENT',
                    channel: BRIDGE_CHANNEL,
                    token,
                    event: 'vars',
                    payload: clean,
                }, '*');
            } catch {
                // Ignore
            }
        }
    }

    function getStats() {
        return {
            activeFrames: frames.size,
            totalRpcs: stats.totalRpcs,
            blockedRpcs: stats.blockedRpcs,
        };
    }

    function destroy() {
        unregisterAll();
        if (typeof globalThis.window?.removeEventListener === 'function') {
            globalThis.window.removeEventListener('message', onMessage);
        }
    }

    return {
        register,
        has,
        unregister,
        unregisterAll,
        broadcastState,
        broadcastVars,
        getStats,
        destroy,
        handleMessage: onMessage,
    };
}
