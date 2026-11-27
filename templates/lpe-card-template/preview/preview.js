(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const frame = $('panel');
  const data = globalThis.LPEPreviewData;
  if (!data) {
    $('notice').textContent = 'Build the default panel to initialize the preview.';
    return;
  }

  let token;
  let url;
  let vars;
  let pending;
  const messages = [];
  const channel = 'lpe-card-bridge';
  const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

  // Read the exact snapshot embedded in the real bootstrap.
  const state = data.state;
  function pathParts(path) {
    const parts = String(path ?? '').trim().split('.');
    if (parts.some((part) => !part || forbidden.has(part))) throw new Error('Invalid variable path');
    return parts;
  }
  function read(root, parts) {
    for (const part of parts) root = root && typeof root === 'object' && Object.hasOwn(root, part) ? root[part] : undefined;
    return root;
  }
  function merge(target, patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (forbidden.has(key)) throw new Error('Unsafe patch key');
      target[key] = plain(value) ? merge(plain(target[key]) ? target[key] : {}, value) : value;
    }
    return target;
  }
  function log(message) {
    messages.push(JSON.stringify(message));
    if (messages.length > 100) messages.shift();
    $('messages').textContent = messages.join('\n');
  }
  function send(message, replyChannel = channel) {
    frame.contentWindow.postMessage({ ...message, channel: replyChannel, token }, '*');
    log(message);
  }
  function showVars() {
    $('vars').textContent = JSON.stringify(vars, null, 2);
  }
  function clearAction() {
    pending = '';
    $('pending').textContent = '';
    $('confirmation').hidden = true;
  }
  $('cancel').onclick = clearAction;
  $('send').onclick = () => {
    $('sent').textContent = 'Sent: ' + pending;
    clearAction();
  };

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!token || event.source !== frame.contentWindow || event.origin !== 'null'
        || msg?.token !== token || msg.type !== 'LPE_CARD_RPC'
        || ![channel, 'vexa-card-bridge'].includes(msg.channel)) return;
    const { id: replyTo, method, payload } = msg;
    log({ type: msg.type, id: replyTo, method, payload });
    let result = { ok: true };
    try {
      switch (method) {
        case 'resize':
          if (Number.isFinite(payload?.height)) frame.style.height = Math.max(60, Math.min(2400, Math.ceil(payload.height))) + 'px';
          return;
        case 'getState': result = state; break;
        case 'getPath': result = read(state, pathParts(payload?.path)) ?? null; break;
        case 'getVars': result = vars; break;
        case 'getVar': {
          const parts = pathParts(payload?.path);
          const alias = parts[0] === 'stat_data' ? parts.slice(1) : ['stat_data', ...parts];
          const value = read(vars, parts);
          result = (value === undefined && alias.length ? read(vars, alias) : value) ?? null;
          break;
        }
        case 'setVar':
        case 'patchVars': {
          const draft = structuredClone(vars);
          if (method === 'patchVars') {
            if (!plain(payload?.patch)) throw new Error('Expected a variable patch object');
            merge(draft, payload.patch);
          } else {
            const parts = pathParts(payload.path);
            let target = draft;
            for (const part of parts.slice(0, -1)) {
              if (!Object.hasOwn(target, part) || !plain(target[part])) target[part] = {};
              target = target[part];
            }
            if (payload.value === undefined) throw new Error('Expected a variable value');
            target[parts.at(-1)] = payload.value;
          }
          vars = draft;
          showVars();
          send({ type: 'LPE_CARD_EVENT', event: 'vars', payload: vars });
          result = { ok: true, vars };
          break;
        }
        case 'toast': $('notice').textContent = String(payload?.message ?? '').slice(0, 300); break;
        case 'fillInput': $('composer').value = String(payload?.text ?? '').slice(0, 16000); break;
        case 'submitInput':
          pending = String(payload?.text ?? '').slice(0, 16000);
          $('pending').textContent = pending;
          $('confirmation').hidden = false;
          result = { ok: true, autoSend: false };
          break;
        default: throw new Error('Disallowed bridge method: ' + method);
      }
      send({ type: 'LPE_CARD_REPLY', replyTo, ok: true, result, error: null }, msg.channel);
    } catch (error) {
      send({ type: 'LPE_CARD_REPLY', replyTo, ok: false, result: null, error: error.message }, msg.channel);
    }
  });

  function mount(html) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    vars = structuredClone(data.vars);
    showVars();
    clearAction();
    $('sent').textContent = '';
    messages.length = 0;
    $('messages').textContent = '';
    frame.style.height = '240px';

    // Mirror the renderer's head placement and viewport-unit normalization.
    const code = html.replace(/^(?:\s|<!--[\s\S]*?-->)+/, '')
      .replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_, attrs, css) =>
        '<style' + attrs + '>' + css.replace(/\b(\d+(?:\.\d+)?)vh\b/gi,
          (match, value) => 'calc(var(--lpe-vh, 600px) * ' + (Number(value) / 100).toFixed(3) + ')') + '</style>');
    const head = data.head.replace('__LPE_PREVIEW_FRAME_TOKEN__', token);
    const htmlOpen = /^(?:<!doctype[^>]*>\s*)?<html\b[^>]*>/i;
    let doc;
    if (/^(?:(?:<!doctype[^>]*>\s*)?<html\b[^>]*>[\s\S]*?)?<head\b[^>]*>/i.test(code)) {
      doc = code.replace(/<head\b[^>]*>/i, (tag) => tag + head);
    } else if (htmlOpen.test(code)) {
      doc = code.replace(htmlOpen, (tag) => tag + '<head>' + head + '</head>');
    } else {
      doc = '<!doctype html><html><head>' + head + '</head><body>' + code + '</body></html>';
    }
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(new Blob([doc], { type: 'text/html;charset=utf-8' }));
    frame.src = url;
  }

  let selection = 0;
  $('panel-file').addEventListener('change', async ({ target }) => {
    if (!target.files.length) return;
    const request = ++selection;
    try {
      const html = await target.files[0].text();
      if (request !== selection) return;
      mount(html);
      $('notice').textContent = '';
    } catch (error) {
      $('notice').textContent = error.message;
    }
  });

  mount(data.html);
  const requested = new URLSearchParams(location.search).get('panel');
  if (requested) {
    (async () => {
      try {
        const source = new URL(requested, location.href);
        if (location.protocol === 'file:') throw new Error('Choose the alternate panel with the file picker.');
        if (source.origin !== location.origin) throw new Error('Choose a panel on the preview server.');
        const response = await fetch(source, { redirect: 'error' });
        if (!response.ok) throw new Error('Could not load panel (' + response.status + ').');
        const html = await response.text();
        if (!selection) mount(html);
      } catch (error) {
        if (!selection) $('notice').textContent = error.message;
      }
    })();
  }
})();
