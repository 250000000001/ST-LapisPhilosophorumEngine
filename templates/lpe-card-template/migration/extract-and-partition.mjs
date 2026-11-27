import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadCard } from '../../../scripts/audit-card.mjs';
import { tryParseInitVarsFromEntries } from '../../../src/ejsEngine.js';

const auditScript = fileURLToPath(new URL('../../../scripts/audit-card.mjs', import.meta.url));
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const pointer = (segments) => '/' + segments.map((s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
const greetings = ['first_mes', 'alternate_greetings', 'group_only_greetings'];
const varCalls = /(?:\b(?:getvar|setvar|(?:LPECard|VexaCard)\.(?:getVar|setVar)|(?:TavernHelper\.)?getVariable|(?:TavernHelper\.)?setVariable)\s*\(\s*(['"`])([^'"`]+)\1|\{\{(?:get_card_var|get_message_variable|format_message_variable)::([^}]+)\}\})/gi;

function* strings(value, segments) {
  if (typeof value === 'string') {
    yield [segments, value];
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) yield* strings(child, [...segments, key]);
  }
}

function leafPaths(value, prefix = []) {
  if (value === undefined) return [];
  if (value && typeof value === 'object' && Object.keys(value).length) {
    return Object.entries(value).flatMap(([key, child]) => leafPaths(child, [...prefix, key]));
  }
  return prefix.length ? [prefix.join('.')] : [];
}

function* uiBlocks(source) {
  // Consume complete fences before scanning for unfenced documents and embedded tags.
  const outer = /(^[ \t]*)(`{3,}|~{3,})([^\r\n]*)\r?\n([\s\S]*?)^[ \t]*\2[ \t]*(?=\r?$)|<!doctype\s+html\b[^>]*>[\s\S]*?<\/html\s*>|<html\b[^>]*>[\s\S]*?<\/html\s*>|<script\b[^>]*>[\s\S]*?<\/script\s*>|<[a-z][\w:-]*\b[^>]*\bon[a-z]+\s*=[^>]*>/gim;
  const startsWithMarkup = /^(?:<!doctype\s+html\b|<[a-z][\w:-]*(?:\s|\/?>))/i;
  const trimmed = source.trim();
  const matches = [...source.matchAll(outer)];
  // A raw HTML replacement or fragment can include markup surrounding its scripts.
  if (startsWithMarkup.test(trimmed) && trimmed.endsWith('>') && !matches.some((match) => match[2])) {
    const start = source.indexOf(trimmed);
    yield { start, end: start + trimmed.length, code: trimmed, kind: 'html', fenced: false };
    return;
  }
  for (const match of matches) {
    const offset = match.index;
    if (match[2]) {
      const language = match[3].trim().split(/\s+/)[0].toLowerCase();
      const code = match[4];
      const kind = /^(?:js|javascript|ts|typescript|jsx|tsx|mjs)$/.test(language) ? 'js'
        : /^(?:html|htm)$/.test(language) || startsWithMarkup.test(code.trimStart()) ? 'html' : '';
      const start = offset + match[0].indexOf('\n') + 1;
      if (kind) yield { start, end: start + code.length, code, kind, fenced: true };
    } else {
      yield { start: offset, end: offset + match[0].length, code: match[0], kind: 'html', fenced: false };
    }
  }
}

function writeBatches(entries, isArray, target, write) {
  let rows = [];
  let keys = [];
  let bytes = isArray ? 20 : 39;
  let count = 0;
  const locations = new Map();
  function flush() {
    write('parts/wi_batch_' + (++count) + '.json', isArray ? { entries: rows } : { entries: rows, entry_keys: keys });
    rows = [];
    keys = [];
    bytes = isArray ? 20 : 39;
  }
  for (const [key, entry] of entries) {
    const size = Buffer.byteLength(JSON.stringify(entry, null, 2).replace(/^/gm, '    ')) + 2
      + (isArray ? 0 : Buffer.byteLength(JSON.stringify(key)) + 6);
    if (rows.length && bytes + size > target) flush();
    if (bytes + size > target) console.warn('World Info entry ' + key + ' exceeds the batch target by itself.');
    locations.set(key, { file: 'parts/wi_batch_' + (count + 1) + '.json', index: rows.length });
    rows.push(entry);
    keys.push(key);
    bytes += size;
  }
  if (rows.length || count === 0) flush();
  return { count, locations };
}

function extract(input, work, target) {
  const { card } = loadCard(input);
  if (!['chara_card_v2', 'chara_card_v3'].includes(card?.spec) || !card?.data || Array.isArray(card.data)) {
    throw new Error('Expected a SillyTavern V2 or V3 card.');
  }
  // A fresh directory prevents stale batches and protects edited migration files.
  mkdirSync(path.dirname(work), { recursive: true });
  mkdirSync(work);
  mkdirSync(path.join(work, 'parts'));
  mkdirSync(path.join(work, 'extracted-ui'));
  const write = (rel, value) => writeFileSync(path.join(work, rel), json(value));
  const audit = spawnSync(process.execPath, [auditScript, input, '--json', '--no-fail', '--out', path.join(work, 'audit_before.json')], {
    stdio: ['ignore', 'ignore', 'inherit'], timeout: 60000, windowsHide: true,
  });
  if (audit.status !== 0) throw audit.error ?? new Error('audit-card.mjs failed (' + audit.status + ')');

  write('raw_card.json', card);
  const core = structuredClone(card);
  const rawEntries = card.data.character_book?.entries;
  const entries = Object.entries(rawEntries ?? {});
  if (core.data.character_book) delete core.data.character_book.entries;
  const regex = card.data.extensions?.regex_scripts;
  if (core.data.extensions) delete core.data.extensions.regex_scripts;
  write('parts/core_fields.json', core);
  write('parts/regex_and_ui.json', regex === undefined ? {} : { regex_scripts: regex });
  const batches = writeBatches(entries, !rawEntries || Array.isArray(rawEntries), target, write);

  const manifest = [];
  function collect(segments, value, partFile, partSegments) {
    for (const [location, source] of strings(value, segments)) {
      const suffix = location.slice(segments.length);
      if (segments.at(-1) === 'regex_scripts' && !['replaceString', 'replacement'].includes(suffix.at(-1))) continue;
      for (const { code, ...span } of uiBlocks(source)) {
        const file = 'block-' + String(manifest.length + 1).padStart(3, '0') + '.' + span.kind;
        writeFileSync(path.join(work, 'extracted-ui', file), code);
        manifest.push({ file, pointer: pointer(location), part_file: partFile, part_pointer: pointer([...partSegments, ...suffix]), ...span });
      }
    }
  }
  for (const key of greetings) collect(['data', key], card.data[key], 'parts/core_fields.json', ['data', key]);
  collect(['data', 'extensions', 'regex_scripts'], regex, 'parts/regex_and_ui.json', ['regex_scripts']);
  for (const [key, entry] of entries) {
    const { file, index } = batches.locations.get(key);
    collect(['data', 'character_book', 'entries', key, 'content'], entry?.content, file, ['entries', index, 'content']);
  }
  write('extracted-ui/ui_manifest.json', { offset_units: 'UTF-16 code units, end exclusive', blocks: manifest });

  const plan = JSON.parse(readFileSync(new URL('./migration_plan.template.json', import.meta.url), 'utf8'));
  const vars = new Set();
  for (const [, source] of strings(card.data, [])) {
    for (const match of source.matchAll(varCalls)) vars.add((match[2] ?? match[3]).trim());
  }
  const seeds = tryParseInitVarsFromEntries(rawEntries);
  plan.detected.init_var_keys = leafPaths(seeds ?? undefined).sort();
  plan.detected.variable_identifiers = [...vars].sort();
  plan.detected.regex_anchors = Object.entries(regex ?? {}).flatMap(([key, script]) =>
    typeof script?.findRegex === 'string'
      ? [{ pointer: pointer(['data', 'extensions', 'regex_scripts', key, 'findRegex']), pattern: script.findRegex }]
      : []);
  write('migration_plan.json', plan);
  console.log('Extracted ' + entries.length + ' World Info entries into ' + batches.count + ' batches and ' + manifest.length + ' UI blocks in ' + work);
}

try {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, 'work-dir': { type: 'string' }, 'batch-kb': { type: 'string', default: '35' }, help: { type: 'boolean' },
  } });
  const usage = 'Usage: node extract-and-partition.mjs --input <card.png> --work-dir <new-dir> [--batch-kb 35]';
  const target = Math.floor(Number(values['batch-kb']) * 1024);
  if (values.help) console.log(usage);
  else if (!values.input || path.extname(values.input).toLowerCase() !== '.png' || !values['work-dir']
      || !Number.isSafeInteger(target) || target < 1) throw new Error(usage);
  else extract(path.resolve(values.input), path.resolve(values['work-dir']), target);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
