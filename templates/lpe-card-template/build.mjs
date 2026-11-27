import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assembleSandboxedDocument, sanitizeStateForCard } from '../../src/cardBridge.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const defaultOut = path.join(root, 'dist', 'card-panel.html');
const token = '__LPE_PREVIEW_FRAME_TOKEN__';

const forbidden = [
  ['legacy or host API', /\b(?:TavernHelper|localStorage)\b|\b(?:window\s*\.\s*(?:parent|open)|document\s*\.\s*cookie)\b/i],
  ['form element', /<form\b/i],
  ['script source or link element', /<script\b[^>]*\bsrc\s*=|<link\b/i],
  ['CSS import', /@import\b/i],
  ['remote asset URL', /(?:https?:\/\/|(?:src|href)\s*=\s*["']?\/\/|url\(\s*["']?\/\/)/i],
];

try {
  const { values } = parseArgs({ options: { entry: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log('Usage: node build.mjs [--entry <dir>] [--out <file>]');
  } else {
    const entry = values.entry ? path.resolve(values.entry) : path.join(root, 'src');
    const out = values.out ? path.resolve(values.out) : defaultOut;
    const read = (name) => readFileSync(path.join(entry, name), 'utf8');
    const css = read('tokens.css') + '\n' + read('panel.css');
    const js = read('panel.js');
    if (/<\/style\b/i.test(css) || /<\/script\b/i.test(js)) {
      throw new Error('Inline source contains its own closing HTML tag. Escape the closing tag in source text.');
    }
    let html = read('panel.html');
    for (const [marker, content] of [['<!-- LPE_STYLES -->', '<style>' + css + '</style>'], ['<!-- LPE_SCRIPT -->', '<script>' + js + '</script>']]) {
      if (html.split(marker).length !== 2) throw new Error('Expected exactly one ' + marker + ' in panel.html');
      html = html.replace(marker, () => content);
    }
    const bytes = Buffer.byteLength(html);
    const violations = forbidden.filter(([, pattern]) => pattern.test(html)).map(([label]) => label);
    if (bytes > 2048 * 1024) violations.push('HTML exceeds the 2 MiB LPE guard');
    if (violations.length) throw new Error(violations.join('\n'));
    if (bytes > 250 * 1024) console.warn('Panel exceeds 250 KiB.');
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, html);

    // A classic script can load alongside file:// previews, where fetch is blocked.
    if (out === defaultOut) {
      const state = sanitizeStateForCard({});
      const vars = { stat_data: { resolve: 50, rollSeed: 1 } };
      const shell = assembleSandboxedDocument('', {
        token, initialState: state, initialVars: vars,
        meta: { mesId: 0, title: 'Local preview' },
      });
      // Extract the real renderer's CSP and bridge bootstrap.
      const head = shell.match(/<head>([\s\S]*?)<\/head>/i)[1];
      writeFileSync(path.join(path.dirname(out), 'preview-data.js'),
        'globalThis.LPEPreviewData = ' + JSON.stringify({ html, head, vars, state }) + ';\n');
    }
    console.log(out + ' (' + bytes + ' bytes, 0 static guard violations)');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
