import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { transformPromptMessages } from '../src/promptInjector.js';

const presetDir = path.resolve(import.meta.dirname, '../Presets');
const archive = path.join(presetDir, 'archive/Magnum_Opus_v1.1_Pre_LPE_Upgrade.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const original = read(archive);
const preset = read(path.join(presetDir, 'Magnum Opus.json'));
const named = name => preset.prompts.find(p => p.name === name);

function compile(rule) {
    const end = rule.findRegex.lastIndexOf('/');
    return new RegExp(rule.findRegex.slice(1, end), rule.findRegex.slice(end + 1));
}

// Mirror ST's assistant placement and prompt/display gating at history depth zero.
function render(text, mode = 'markdownOnly') {
    for (const rule of preset.extensions.regex_scripts) {
        if (rule.disabled || !rule.placement.includes(2) || !rule[mode] || rule.minDepth > 0) continue;
        text = text.replace(compile(rule), rule.replaceString);
    }
    return text;
}

test('immutable archive regenerates the checked-in preset and all expressions compile', () => {
    const archiveLf = fs.readFileSync(archive, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(createHash('sha256').update(archiveLf, 'utf8').digest('hex'),
        '1ef2bf2ef44d297b278dcfa41c678775345d6cf9fe7831de2b0dcb268650a15c');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lpe-preset-'));
    try {
        const output = path.join(tmp, 'generated.json');
        execFileSync(process.execPath, [path.resolve(import.meta.dirname, '../scripts/build-preset.mjs'), archive, output]);
        assert.deepEqual(read(output), preset);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    for (const p of [original, preset]) for (const r of p.extensions.regex_scripts) compile(r);
});

test('every prompt has one synchronized order entry and every picker clears its local before use', () => {
    const ids = preset.prompts.map(p => p.identifier);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(preset.prompt_order[0].order, preset.prompts.map(({ identifier, enabled }) => ({ identifier, enabled })));
    assert.ok(preset.prompts.filter(p => /^[━╒╘]/u.test(p.name)).every(p => !p.enabled));
    const init = named('DO NOT DISABLE - System Vars');
    const text = preset.prompts.map(p => p.content || '').join('\n');
    for (const [, name] of text.matchAll(/\{\{getvar::([^}:]+)}}/g)) assert.ok(init.content.includes('{{setvar::' + name + '::'), name);
    assert.equal((text.match(/\{\{lpe_state_snapshot}}/g) || []).length, 1);
    assert.equal((text.match(/\{\{lpe_tracker_propose_rule}}/g) || []).length, 1);
    const patches = preset.prompts.filter(p => p.name.startsWith('Model Patch:'));
    assert.equal(patches.length, 5);
    assert.deepEqual(patches.filter(p => p.enabled).map(p => p.name), ['Model Patch: Gemini [PICK 1: PATCH]']);
    for (const [name, enabled] of Object.entries({
        'Dynamic DND Sim': true, 'D&D Sim': false, 'Dynamic NPC Voice': true, 'NPC Voice': false,
        'Realistic Dynamic NPCs': true, 'Realistic Bold NPCs': false, 'LPE Story Review': true,
        'Lightning Review ⚡': false, 'Story Rhythm': true, 'Readable Story Writing': true, 'Prose Textures: Lite': false,
    })) assert.equal(named(name).enabled, enabled, name);
    for (const p of original.prompts.filter(p => /JB|NSFW|jailbreak|Kinktionary/i.test(p.name) && !p.name.startsWith('━'))) {
        const next = preset.prompts.find(n => n.identifier === p.identifier);
        assert.equal(next.content, p.content);
        assert.equal(next.enabled, p.name === 'Kinktionary' ? false : original.prompt_order[0].order.find(r => r.identifier === p.identifier)?.enabled ?? false);
    }
});

test('dice producers supply the exact user, spotlight and world fields consumed by mechanics', () => {
    const rolls = named('Dice Rolls').content;
    assert.match(rolls, /<dice_rolls>[\s\S]*{{getvar::d&dRolls}}[\s\S]*{{getvar::worldSimRolls}}[\s\S]*<\/dice_rolls>/);
    assert.match(rolls, /<objective_dice_pool>/);
    for (const name of ['Dynamic DND Sim', 'D&D Sim']) {
        const {content} = named(name);
        assert.match(content, /user_d20: {{roll::1d20}}/);
        assert.match(content, /npc_d20 \(spotlight order\): {{roll::1d20}}/);
        assert.doesNotMatch(content, /\.seed\[|\+\s*6\b|<diceRolls>/);
    }
    assert.doesNotMatch(named('World Sim').content, /chaosRolls|<diceRolls>/);
    assert.match(named('World Sim').content, /chaos_trigger: {{roll::1d20}}\nchaos_band: {{roll::1d20}}/);
});

test('review runs the eight stages once with optional craft compression and an external-only terminal block', () => {
    const review = named('LPE Story Review').content;
    const stages = [...review.matchAll(/^\d (\w+) \[(canon|craft)\]/gm)].map(m => m.slice(1));
    assert.deepEqual(stages, [['ASK', 'canon'], ['NOW', 'canon'], ['MECHANICS', 'canon'], ['SPINE', 'canon'],
        ['SUBTEXT', 'craft'], ['BEAT', 'craft'], ['SHAPE', 'craft'], ['ANCHORS', 'canon']]);
    assert.match(review, /{{getvar::lpe_lightning}}/);
    assert.match(review, /{{getvar::lpe_patch_gate}}/);
    assert.match(named('Lightning Review ⚡').content, /Keep every \[canon\] check/);
    assert.match(named('Internal States Template').content, /<lpe_tail>\n<lpe_receipt>[\s\S]*<state:vent>[\s\S]*<\/lpe_tail>\n<!-- GFX_END -->/);
    const baseRigid = original.prompts.find(p => p.name === 'Rigid Rules').content;
    for (const tag of ['epistemic_contract', 'knowledge_sanity']) {
        const block = new RegExp(`<${tag}>\\n[\\s\\S]*?<\\/${tag}>`);
        assert.equal(named('Rigid Rules').content.match(block)[0], baseRigid.match(block)[0]);
    }
    assert.equal(named('POV').content, original.prompts.find(p => p.name === 'POV').content);
});

test('card panel fences survive and only control fences are unwrapped before display/history filtering', () => {
    const panel = '```html\n<html><body><button>Inventory</button></body></html>\n```';
    for (const mode of ['markdownOnly', 'promptOnly']) {
        assert.equal(render(panel, mode), panel);
        for (const tag of ['lpe_tail', 'vexa_tail']) {
            const tail = '```xml\n<' + tag + '><lpe_receipt>arc: ∅</lpe_receipt></' + tag + '>\n```';
            assert.equal(render(panel + '\nStory.\n' + tail, mode).trim(), panel + '\nStory.');
        }
    }
});

test('card domain check sheets stay out of rendered prose and history while the observable consequence survives', () => {
    const sheet = '[Check Request | Inspect the seal]\n> Type: General Check\n> Target Difficulty (DC): 70\n> Dice Roll: [4]\n> [Check Result: Success]';
    for (const mode of ['markdownOnly', 'promptOnly']) {
        assert.equal(render('The latch held.\n' + sheet + '\nThe guard turned.', mode), 'The latch held.\n\nThe guard turned.');
        assert.equal(render('“Check the seal,” he said.', mode), '“Check the seal,” he said.');
    }
});

test('scoped prop repair supports legacy aliases, quotes, message rows and truncated tags', () => {
    for (const prefix of ['lpe', 'vexa']) {
        assert.match(render(`<${prefix}_parchment title='Letter'>Meet at noon.</${prefix}_parchment>`), /<b>Letter<\/b>/);
        assert.match(render(`<${prefix}_lore term='Seq 9'>Apprentice.</${prefix}_lore>`), /class="vxl-trigger">Seq 9</);
        assert.match(render(`<${prefix}_terminal title="The "Grey" Seal">Open</${prefix}_terminal>`), /The &quot;Grey&quot; Seal/);
        assert.match(render(`<${prefix}_sms title='Dock'><${prefix}_msg from='Rae' time='12:00'>Ready</${prefix}_msg></${prefix}_sms>`), /<time>12:00<\/time>/);
    }
    assert.equal(render("His title='Letter'."), "His title='Letter'.");
    assert.equal(render("Before\n<lpe_lore term='Fog'>fragment\n\nNext paragraph."), 'Before\nfragment\n\nNext paragraph.');
    assert.equal(render('Before\n<lpe_tail>\n\nNext paragraph.', 'promptOnly'), 'Before\n\n\nNext paragraph.');
});

test('thoughts fold on display and leave only the header and prose in assistant history', () => {
    const story = '[🕰️ 08:21 AM | 🗓️ Wednesday | 📍 Docks ]\nThe latch clicked.';
    for (const thought of ['<think>Private planning.</think>', '<thinking>Private planning.</thinking>',
        '<reasoning>Private planning.</reasoning>', 'Private planning.']) {
        const text = thought + '\n' + story;
        const display = render(text);
        assert.equal((display.match(/<summary>Thoughts<\/summary>/g) || []).length, 1);
        assert.ok(display.includes('Private planning.') && display.endsWith(story));
        assert.equal(render(text, 'promptOnly').trim(), story);
    }
    assert.equal(render(story), story);
    assert.equal(render('A letter arrived. [A postmark]'), 'A letter arrived. [A postmark]');
});

test('a truncated historical receipt leaves subsequent prose and user instructions intact', () => {
    const damaged = '<lpe_tail>\n<lpe_receipt>\nworld_sim: CALM\narc: ∅\n\nThe bell rang.';
    const messages = ['system', 'user', 'assistant'].map(role => ({ role, content: damaged }));
    transformPromptMessages(messages, { enabled: true, presetName: 'Magnum Opus' });
    assert.deepEqual(messages.map(m => m.content.trim()), [damaged, damaged, 'The bell rang.']);
    assert.equal(render(damaged, 'promptOnly').trim(), 'The bell rang.');
});
