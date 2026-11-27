import path from 'node:path';
import { parseArgs } from 'node:util';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { loadCard } from './audit-card.mjs';
import { buildReadOnlyLpeSnapshot, compileEjs, evaluateEjs, hasEjsTags, tryParseInitVarsFromEntries } from '../src/ejsEngine.js';
import { emptyState } from '../src/schema.js';

const usage = 'Usage: node scripts/verify-ejs-headless.mjs <card.png|card.json> [--json]';
const initTag = '\\[(?:InitVar|(?:LPE|Vexa)InitVars?)\\]';
const initLabel = new RegExp('^' + initTag + '$', 'i');
const initKey = new RegExp(initTag, 'i');

function verify(input, progress) {
  const { card } = loadCard(input);
  if (!['chara_card_v2', 'chara_card_v3'].includes(card?.spec) || !card?.data || Array.isArray(card.data)) {
    throw new Error('Expected a SillyTavern V2 or V3 card.');
  }
  const { data } = card;
  const entries = Object.entries(data.character_book?.entries ?? {}).filter(([, entry]) => entry);
  const wiEntries = entries.filter(([, entry]) => entry.enabled !== false).map(([, entry]) => entry);
  const failures = [];
  for (const [key, entry] of entries) {
    const keys = entry.key ?? entry.keys ?? '';
    const label = String(entry.comment ?? '').trim();
    if ((initLabel.test(label) || initKey.test(Array.isArray(keys) ? keys.join(' ') : String(keys)))
        && !tryParseInitVarsFromEntries([entry])) {
      failures.push({ location: 'character_book.entries[' + JSON.stringify(key) + ']', error: 'Invalid InitVar seed' });
    }
  }
  const cardVars = tryParseInitVarsFromEntries(entries.map(([, entry]) => entry)) ?? {};
  const templates = [['first_mes', data.first_mes]];
  for (const field of ['alternate_greetings', 'group_only_greetings']) {
    if (Array.isArray(data[field])) {
      data[field].forEach((text, index) => templates.push([field + '[' + index + ']', text]));
    }
  }
  for (const [key, entry] of entries) {
    if (entry.enabled !== false) templates.push(['character_book.entries[' + JSON.stringify(key) + '].content', entry.content]);
  }

  const states = [0, 1, 2].map((turn) => {
    const state = emptyState();
    state.world.ct = turn;
    return buildReadOnlyLpeSnapshot(state);
  });
  let checked = 0;
  let passed = 0;
  for (const [location, template] of templates) {
    if (!hasEjsTags(template)) continue;
    checked++;
    progress(location);
    const compiled = compileEjs(template);
    if (!compiled.ok) {
      failures.push({ location, error: compiled.error });
      continue;
    }
    let ok = true;
    for (const frozenState of states) {
      const result = evaluateEjs(template, {
        frozenState, cardVars, wiEntries, charName: data.name, userName: 'Player',
      }, { rng: () => 0.5, allowVarWrites: false });
      if (!result.ok) {
        ok = false;
        failures.push({ location, turn: frozenState.world.ct, error: result.error });
      }
    }
    if (ok) passed++;
  }
  return { ok: failures.length === 0, card: data.name ?? '', checked, passed, failures };
}

function verifyInWorker(input) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: input, resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
    });
    let timer;
    function watch(location) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        worker.terminate();
        reject(new Error('EJS verification timed out at ' + location));
      }, 10000);
    }
    watch('card loading');
    worker.on('message', ({ progress, report, error }) => {
      if (progress) return watch(progress);
      clearTimeout(timer);
      if (error) reject(new Error(error));
      else resolve(report);
    });
    worker.on('error', (error) => { clearTimeout(timer); reject(error); });
    worker.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error('EJS verification worker exited with code ' + code));
    });
  });
}

if (!isMainThread) {
  try {
    const report = verify(workerData, (progress) => parentPort.postMessage({ progress }));
    parentPort.postMessage({ report });
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
} else {
  let json = process.argv.includes('--json');
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true, options: { json: { type: 'boolean' }, help: { type: 'boolean' } },
    });
    json = values.json;
    if (values.help) {
      console.log(usage);
    } else {
      if (positionals.length !== 1 || !['.png', '.json'].includes(path.extname(positionals[0]).toLowerCase())) {
        throw new Error(usage);
      }
      const report = await verifyInWorker(path.resolve(positionals[0]));
      if (json) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(report.passed + '/' + report.checked + ' EJS templates passed (turns 0–2).');
        for (const failure of report.failures) {
          const turn = failure.turn === undefined ? '' : ' (turn ' + failure.turn + ')';
          console.error(failure.location + turn + ' — ' + failure.error);
        }
      }
      if (!report.ok) process.exitCode = 1;
    }
  } catch (error) {
    if (json) console.log(JSON.stringify({ ok: false, error: error.message }));
    else console.error(error.message);
    process.exitCode = 1;
  }
}
