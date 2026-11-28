import test from 'node:test';
import assert from 'node:assert/strict';

import {
    hasEjsTags,
    shouldYieldEjs,
    rollDice,
    compileEjs,
    evaluateEjs,
    substituteVexaMacros,
    tryParseInitVarsFromEntries,
    clearEjsCompileCache,
} from '../src/ejsEngine.js';
import { evaluatePromptMessagesEjs } from '../src/promptInjector.js';
import { emptyState } from '../src/schema.js';

function makeRng(seq) {
    let i = 0;
    return () => {
        const v = seq[i % seq.length];
        i++;
        return v;
    };
}

test('EJS core tags: scriptlets, escaped/raw output, comments, whitespace slurp, literal <%%', () => {
    clearEjsCompileCache();
    const tpl = [
        '<%# hidden comment %>',
        '  <%_ const name = "<b>Aria</b>"; -%>',
        '\nEsc=<%= name %>|Raw=<%- name %>|Lit=<%%= x %%>|Str=<% const s = "%>"; %><%- s %>',
    ].join('');
    const res = evaluateEjs(tpl);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.text, 'Esc=&lt;b&gt;Aria&lt;/b&gt;|Raw=<b>Aria</b>|Lit=<%= x %>|Str=%>');
});

test('EJS compiles cache hits cleanly', () => {
    clearEjsCompileCache();
    const tpl = 'Turn <%= turn %>: <%= 2 + 3 %>';
    const c1 = compileEjs(tpl);
    const c2 = compileEjs(tpl);
    assert.equal(c1.ok, true);
    assert.equal(c1.cached, false);
    assert.equal(c2.ok, true);
    assert.equal(c2.cached, true);
});

test('rollDice supports NdS, modifiers, keep-highest/lowest, and rejects abuse bounds', () => {
    const d100 = rollDice('1d100', makeRng([0.5]));
    assert.equal(d100.total, 51);
    assert.equal(Number(d100), 51);
    assert.equal(String(d100), '51');

    const mod = rollDice('2d6+3', makeRng([0.0, 0.99]));
    assert.deepEqual(mod.rolls, [1, 6]);
    assert.equal(mod.total, 10);

    const kh = rollDice('4d6kh3', makeRng([0.0, 0.5, 0.99, 0.2]));
    assert.equal(kh.kept.length, 3);
    assert.equal(kh.total, 1 + 4 + 6 + 2 - 1);

    const kl = rollDice('2d20kl1', makeRng([0.9, 0.1]));
    assert.equal(kl.total, 3);

    assert.throws(() => rollDice('999d6'), /bounds/i);
    assert.throws(() => rollDice('1d999999'), /bounds/i);
    assert.throws(() => rollDice('bad'), /Invalid dice/i);
});

test('EJS evaluates luck-anchor curve, getvar options, setvar writes, getvexa & derived health metrics', () => {
    const state = emptyState();
    state.world = { ct: 5, loc: 'Tingen Docks', time: '08:15 AM' };
    state.health = {
        bodyType: 'male',
        pain: 42,
        bloodLoss: 28,
        parts: {
            left_arm: {
                hp: 72,
                conditions: [{ id: 'w1', kind: 'sharp', label: 'Knife slash', severity: 28, bleeding: true, treated: false }],
            },
        },
        wholeBody: [],
    };
    state.custom_trackers = [
        { id: 'blackthorn_ledger', title: 'Blackthorn Ledger', fields: { pounds: '18', merit: '4' }, archived: false },
    ];

    const cardVars = {
        stat_data: {
            luck: 750,
            base_total: 1000,
            sanity: 60,
        },
    };

    const tpl = `<%
  const anchors = [[1,0],[300,0],[750,1],[1800,2],[4500,5],[12000,7]];
  function luckMod(luck) {
    for (let i = 1; i < anchors.length; i++) {
      if (luck <= anchors[i][0]) return anchors[i][1];
    }
    return 7;
  }
  const luck = Number(getvar('stat_data.luck', { defaults: 0 }));
  const x = luckMod(luck);
  const faces = 100 - x;
  setvar('stat_data.last_faces', faces);
%>Loc=<%= getvexa('world.loc') %>|Blood=<%= getvexa('health.bloodLoss') %>|Pain=<%= getvexa('health.pain') %>|Tracker=<%= getvexa('custom_trackers.blackthorn_ledger.fields.pounds') %>|Faces=<%= faces %>|Roll=<%= roll('1d20') %>|WI=<%- getwi('Combat Guide') %>`;

    const writes = [];
    const res = evaluateEjs(tpl, {
        state,
        cardVars,
        setCardVar: (p, v) => { writes.push([p, v]); return true; },
        wiEntries: [{ comment: 'Combat Guide', content: 'Roll <= target succeeds' }],
        charName: 'Detective',
        userName: 'Klein',
    }, {
        allowVarWrites: true,
        rng: () => 0.25,
    });

    assert.equal(res.ok, true, res.error);
    assert.equal(
        res.text,
        'Loc=Tingen Docks|Blood=28|Pain=42|Tracker=18|Faces=99|Roll=6|WI=Roll <= target succeeds',
    );
    assert.deepEqual(writes, [['stat_data.last_faces', 99]]);
});

test('EJS security sandbox blocks globals, prototype escapes, dynamic bracket tricks, unicode escapes, and infinite loops', () => {
    const attacks = [
        '<%= window.location %>',
        '<%= document.cookie %>',
        '<%= globalThis.SillyTavern %>',
        '<%= SillyTavern.getContext() %>',
        '<%= fetch("https://evil.example") %>',
        '<%= eval("1+1") %>',
        '<%= Function("return 1")() %>',
        '<%= ({}).constructor.constructor("return this")() %>',
        '<%= ({}).__proto__ %>',
        '<% const k = "con" + "structor"; %><%= (0)[k][k]("return 1")() %>',
        '<% const { ["con"+"structor"]: F } = (() => {}); %><%= F %>',
        '<%= win\\u0064ow %>',
        '<% class Evil {} %>',
    ];
    for (const attack of attacks) {
        const res = evaluateEjs(attack);
        assert.equal(res.ok, false, `Expected security rejection for: ${attack}\nGot output: ${res.text}`);
    }

    // Infinite loops must terminate quickly via step limit
    for (const loopTpl of [
        '<% while (true) {} %>',
        '<% for (;;) {} %>',
        '<% let n = 0; while (true) n++; %>',
        '<% do { } while (true); %>',
        '<% const big = new Array(6000).fill(1); for (const x of big) { } %>',
    ]) {
        const t0 = Date.now();
        const res = evaluateEjs(loopTpl, {}, { maxSteps: 500 });
        const dt = Date.now() - t0;
        assert.equal(res.ok, false, `Expected step-limit error for: ${loopTpl}`);
        assert.match(res.error, /step limit/i);
        assert.ok(dt < 100, `Loop took too long (${dt}ms) for: ${loopTpl}`);
    }

    // Output cap enforcement
    const capRes = evaluateEjs('<% for (let i = 0; i < 400; i++) { %><%= "ABCDEFGHIJ" %><% } %>', {}, { maxOutputChars: 1024 });
    assert.equal(capRes.ok, false);
    assert.match(capRes.error, /output exceeds cap/i);
});

test('EJS allows benign identifiers and prose text mentioning window/document/fetchCount', () => {
    const tpl = '<% const windowSeat = true; const documentary = "Rainy window"; const fetchCount = 3; %><%= windowSeat ? documentary : "" %> (<%= fetchCount %>) looking through the window';
    const res = evaluateEjs(tpl);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.text, 'Rainy window (3) looking through the window');
    const regexRes = evaluateEjs('<% const re = /[0-9]+/; %><%= re.test("abc42") ? "yes" : "no" %>');
    assert.equal(regexRes.ok, true, regexRes.error);
    assert.equal(regexRes.text, 'yes');
});

test('EJS enforces exact maxSteps < 100, blocks __vse internal access, rejects prototype fields, and rolls back staged setvar on error', () => {
    const step10Fail = evaluateEjs('<% for (let i = 0; i < 15; i++) {} %>', {}, { maxSteps: 10 });
    assert.equal(step10Fail.ok, false);
    assert.match(step10Fail.error, /step limit/i);

    const internalRes = evaluateEjs('<%= __vseSteps %>');
    assert.equal(internalRes.ok, false);

    // Non-existent tracker field named "toString" must NOT leak inherited Function
    const trState = emptyState();
    trState.custom_trackers = [{ id: 'demo', title: 'Demo', fields: {}, archived: false }];
    const protoCheck = evaluateEjs('<%= typeof getvexa("custom_trackers.demo.fields.toString") %>', { state: trState });
    assert.equal(protoCheck.ok, true);
    assert.equal(protoCheck.text, 'undefined');

    // Failed render discards staged setvar writes
    const writes = [];
    const failWrite = evaluateEjs(
        '<% setvar("stat_data.hp", 10); throw new Error("boom"); %>',
        { setCardVar: (p, v) => writes.push([p, v]) },
        { allowVarWrites: true },
    );
    assert.equal(failWrite.ok, false);
    assert.equal(writes.length, 0);

    // Direct return value is coerced to string cleanly
    const retRes = evaluateEjs('<% return 7; %>');
    assert.equal(retRes.ok, true);
    assert.equal(retRes.text, '7');
});

test('substituteVexaMacros, tryParseInitVarsFromEntries, and evaluatePromptMessagesEjs work cleanly, skip user messages by default & respect auto-yield', () => {
    const entries = [
        {
            comment: '[InitVar]',
            content: '```json\n{ "$meta": { "extensible": true }, "luck": 50, "sanity": 60 }\n```',
        },
    ];
    const seeded = tryParseInitVarsFromEntries(entries);
    assert.deepEqual(seeded, { stat_data: { luck: 50, sanity: 60 } });

    // Also support V2 character_book entries using `keys` array or object-map shape
    const v2Seeded = tryParseInitVarsFromEntries({
        51: { keys: ['[InitVar]'], comment: 'Seed', content: '{ "$meta": { "extensible": true }, "luck": 30 }' },
    });
    assert.deepEqual(v2Seeded, { stat_data: { luck: 30 } });

    const state = emptyState();
    state.world = { ct: 3, loc: 'Clocktower Loft' };

    const macroText = substituteVexaMacros(
        'Luck={{get_message_variable::stat_data.luck}} KeepUnresolved={{get_message_variable::other_ext}} Loc={{vexa::world.loc}} D={{roll:1d10}}',
        { state, cardVars: seeded },
        { rng: () => 0.4 },
    );
    assert.equal(macroText, 'Luck=50 KeepUnresolved={{get_message_variable::other_ext}} Loc=Clocktower Loft D=5');

    const messages = [
        { role: 'system', content: 'At <%= getvexa("world.loc") %> | Roll=<%= roll("1d20") %>' },
        { role: 'user', content: [{ type: 'text', text: 'Literal <%= 6 * 7 %> must NOT execute' }] },
        { role: 'system', content: [{ type: 'text', text: 'Check <%= getvar("stat_data.sanity", 0) %>' }] },
    ];
    const pRes = evaluatePromptMessagesEjs(messages, {
        enabled: true,
        state,
        cardVars: seeded,
    });
    assert.equal(pRes.active, true);
    assert.equal(pRes.evaluatedCount, 2);
    assert.match(messages[0].content, /^At Clocktower Loft \| Roll=\d+$/);
    assert.equal(messages[1].content[0].text, 'Literal <%= 6 * 7 %> must NOT execute');
    assert.equal(messages[2].content[0].text, 'Check 60');

    // Auto-yield check when global window.EjsTemplate exists
    const prevWin = globalThis.window;
    try {
        globalThis.window = { EjsTemplate: {} };
        assert.equal(shouldYieldEjs({ ejsAutoYield: true }), true);
        assert.equal(shouldYieldEjs({ ejsAutoYield: false }), false);
        assert.equal(hasEjsTags('<%= 1 %>'), true);
    } finally {
        if (prevWin === undefined) delete globalThis.window;
        else globalThis.window = prevWin;
    }
});

test('tryParseInitVarsFromEntries supports prefixed [InitVar] notes and a bounded JSON/YAML fallback', () => {
    const parse = (comment, content) => tryParseInitVarsFromEntries([{ comment, content }]);

    // Exact JSON still works.
    assert.deepEqual(parse('[InitVar]', '{"a":1}'), { stat_data: { a: 1 } });
    // Prefixed label + note is treated as InitVar.
    assert.deepEqual(parse('[InitVar]请勿打开', '{"a":2}'), { stat_data: { a: 2 } });
    // Keys array with a prefixed tag also matches.
    assert.deepEqual(
        tryParseInitVarsFromEntries([{ comment: 'Seed', keys: ['[InitVar]notes'], content: '{"a":3}' }]),
        { stat_data: { a: 3 } },
    );
    // Unrelated identifier is NOT matched.
    assert.equal(parse('[InitVarFoo]', '{"a":4}'), null);

    // YAML: nested maps, block list, scalars, and comments preserved inside quotes.
    const yamlText = [
        '# top comment',
        'world:',
        '  day: 1',
        '  flags:',
        '    - 生存',
        '    - "a # not comment"',
        '  alive: true',
        '  gone: ~',
        '  nothing: ∅',
        '  ratio: 0.5',
        'cols:',
        '- x',
        '- 2',
        'quoted: "line # keep"',
    ].join('\n');
    assert.deepEqual(parse('[InitVar]请勿打开', yamlText), {
        stat_data: {
            world: { day: 1, flags: ['生存', 'a # not comment'], alive: true, gone: null, nothing: null, ratio: 0.5 },
            cols: ['x', 2],
            quoted: 'line # keep',
        },
    });

    // Fenced YAML with a top-level stat_data is preserved as-is.
    assert.deepEqual(parse('[InitVar]', '```yaml\nstat_data:\n  hp: 100\n```'), { stat_data: { hp: 100 } });
    // Top-level card_vars is unwrapped into stat_data.
    assert.deepEqual(parse('[InitVar]note', 'card_vars:\n  luck: 7'), { stat_data: { luck: 7 } });
    // Existing stat_data is preserved and metadata is removed recursively.
    assert.deepEqual(parse('[InitVar]', 'stat_data:\n  $meta:\n    extensible: true\n  nested:\n    $meta: {x: 1}\n    ok: 2'), {
        stat_data: { nested: { ok: 2 } },
    });
    // Sequence of mapping items.
    assert.deepEqual(parse('[InitVar]', 'items:\n  - name: a\n    n: 1\n  - name: b\n    n: 2'), {
        stat_data: { items: [{ name: 'a', n: 1 }, { name: 'b', n: 2 }] },
    });

    // Malformed content fails safe without throwing, then the next valid entry is used.
    assert.equal(parse('[InitVar]', '[unterminated'), null);
    assert.equal(parse('[InitVar]', 'a: 1\n\tb: 2'), null);
    assert.deepEqual(
        tryParseInitVarsFromEntries([
            { comment: '[InitVar]broken', content: '{oops' },
            { comment: '[LPEInitVar]', content: '{"ok":1}' },
        ]),
        { stat_data: { ok: 1 } },
    );
});

test('YAML fallback edge cases: unquoted colons, inline comments, flow spacing, extra dash spacing, malformed safety', () => {
    const parse = (content) => tryParseInitVarsFromEntries([{ comment: '[InitVar]edge', content }]);

    // Unquoted colons inside values must stay intact.
    const colonYaml = [
        'url: http://example.com/a#b',
        'time: 12:30',
        'winpath: C:\\Temp\\x',
        'sentence: He said: hello',
    ].join('\n');
    assert.deepEqual(parse(colonYaml), {
        stat_data: {
            url: 'http://example.com/a#b',
            time: '12:30',
            winpath: 'C:\\Temp\\x',
            sentence: 'He said: hello',
        },
    });

    // Inline comments strip only when outside quotes (and after whitespace).
    const commentYaml = [
        'a: value # trailing comment',
        'b: "hash # kept"',
        "c: 'hash # kept'",
        'd: x#kept',
    ].join('\n');
    assert.deepEqual(parse(commentYaml), {
        stat_data: { a: 'value', b: 'hash # kept', c: 'hash # kept', d: 'x#kept' },
    });

    // Flow collections: no space after `:`, nested values, and commas inside strings.
    assert.deepEqual(parse('flow: {a:1, b:2, c: {d:3}}'), {
        stat_data: { flow: { a: 1, b: 2, c: { d: 3 } } },
    });
    assert.deepEqual(parse('arr: [1, {x:3}, "a,b"]'), {
        stat_data: { arr: [1, { x: 3 }, 'a,b'] },
    });

    // Mapping items with extra spaces after `-` align their sibling keys.
    assert.deepEqual(parse('items:\n  -   name: a\n      n: 1'), {
        stat_data: { items: [{ name: 'a', n: 1 }] },
    });

    // Malformed YAML fails safe (no throw, no seed) instead of returning a partial tree.
    assert.equal(parse('a: [1, 2'), null);
    assert.equal(parse('a: {b: 1'), null);
    assert.equal(parse('a: [1, 2]]'), null);
    assert.equal(parse('a: 1\n  stray: 2'), null);
    // Unterminated quotes are malformed in block and flow collections, not literal seed text.
    assert.equal(parse('a: "unterminated'), null);
    assert.equal(parse("a: 'unterminated"), null);
    assert.equal(parse('a: ["unterminated]'), null);
    assert.equal(parse('a: {b: "unterminated}'), null);
    assert.equal(parse('a: {"unterminated: 1}'), null);

    // Seeded YAML is usable through the EJS runtime.
    const seeded = parse('world:\n  day: 1');
    const evaled = evaluateEjs('<%= getvar("stat_data.world.day", 0) %>', { cardVars: seeded });
    assert.equal(evaled.ok, true);
    assert.equal(evaled.text, '1');
});
