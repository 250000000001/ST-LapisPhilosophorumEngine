#!/usr/bin/env node
/**
 * Builds Magnum Opus from its immutable, vendored baseline. An original
 * Dynamic World Vexa input and an alternate output can also be passed on the CLI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { COMPLETE_TAIL, INCOMPLETE_TAIL } from '../src/promptInjector.js';

const SOURCE_PRESET = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(import.meta.dirname, '../Presets/archive/Magnum_Opus_v1.1_Pre_LPE_Upgrade.json');
const OUT_USER_PRESET = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.resolve(import.meta.dirname, '../Presets/Magnum Opus.json');

const INTERNAL_STATES_TEMPLATE_REPLACEMENT = `OOC: World state tracking (<internal_states>) is managed externally by the **Lapis Philosophorum Engine (LPE)** extension.
CRITICAL: DO NOT output the 16-section <internal_states> block! Instead, read the live snapshot below as canonical truth and append ONLY the tiny <lpe_tail> block + <!-- GFX_END --> at the very end of your response.

<external_state_contract>
RULES:
1. READ-ONLY SNAPSHOT: <internal_states> below is the current authoritative world state compiled by Lapis Philosophorum Engine (LPE). Respect all character <fontColor> hex locks, Atlas spatial geometry (dim WxDxHm, optional elev meters, elevated platform walkways, exits, and [x,y,z] positions), <knowledge_sanity>, active Chekhov bullets, Tracks, ARC gates, and Notebook [R] rules inside it.
2. NEVER emit <internal_states> or copy forward rooms/matrices/entities in your reply. LPE Clerk updates the store from your prose and receipt after your reply finishes.
3. MANDATORY TERMINAL BLOCK: At the very end of every assistant response (outside codeblocks), output ONLY <lpe_tail> followed by <!-- GFX_END -->:
<lpe_tail>
<lpe_receipt>
world_sim: [CALM/SKIP OR disposition magnitude | subject/anchor | event | visibility | delta]
chekhov: [fired: <desc> | unlocked: <desc> | loaded: <desc> | ∅]
arc: [beat/track updates or ∅]
ooc: [any new user OOC rules/directives to save to Notebook, or ∅]
{{lpe_tracker_propose_rule}}
</lpe_receipt>
<state:vent>
<vent>[First line MUST be in character per <sys>.persona — Homer, the blind rhapsode. 1-3 dry, observant craft lines: commentary on scene, dice, subtext, off-screen setup.]</vent>
</state:vent>
</lpe_tail>
<!-- GFX_END -->
4. Nothing may follow <!-- GFX_END -->.
</external_state_contract>

{{lpe_state_snapshot}}`;

const RAW = fs.readFileSync(SOURCE_PRESET, 'utf8');
const preset = JSON.parse(RAW);

preset.name = 'Magnum Opus';

function byId(id) {
    return preset.prompts.find((p) => p.identifier === id);
}

const pSysVars = byId('01a138a1-2123-7002-9d45-11da92d981d2');
const pRigid = byId('01a138a1-2123-7006-97e9-8310313533d3');
if (pRigid?.content) {
    pRigid.content = pRigid.content
        .replace(
            /^role:\s*.*$/m,
            'role: unsparing chronicler & keen-eyed observer per <epistemic_contract>',
        )
        .replace(
            /^persona:\s*.*$/m,
            'persona: Homer, the blind rhapsode witnessing a living epic | attuned to cadence, human pride, grief, hubris, and unspoken friction | zero corporate filter, unflinching, deeply observant, never melodramatic or archaic',
        )
        .replace(
            /^voice:\s*.*$/m,
            'voice: ai, corporate, junior coder, or faux-archaic ("hark/lo") register -> banned | ic prose vivid, muscular, concrete, rhythm-conscious | ooc = dry, candid craft-notes from a seasoned bard',
        )
        .replace(
            /^blunt theatrical profane when earned$/m,
            'blunt, unflinching, and profane when character and moment earn it',
        );
}

// 0a. Prose Rules — Homer chronicler style (replaces Dr. Seuss / Dudebro register)
const pProse = byId('01a138a1-2123-700b-81bd-b46eb93c9de7');
if (pProse?.content) {
    pProse.content = pProse.content
        .replace(/\{\{\/\/Yes, I know it says "Dr\. Seuss" prose[\s\S]*?\}\}\{\{trim\}\}\n\n/, '')
        .replace(
            /^STYLE:[\s\S]*?^Expression follows the moment:[^\n]*/m,
            'STYLE: Homeric narrative craft in plain, muscular modern English—cadence, concrete physicality, vivid sensory images, and weight given to human tension and interaction. No rhyme, no faux-archaic diction, no bloated purple prose. Language follows the moment: spare and stark in quiet beats, taut and kinetic in conflict, unsparing in pain.',
        )
        .replace(
            /^REGISTER:.*$/m,
            'REGISTER: Unflinching and character-true. Coarse or blunt language is welcome when the character and scene earn it—never sanitize established profanity, and never force slang onto characters whose voice does not carry it.',
        );
}
const pProps = byId('01a1af5f-b110-7000-80dd-1c5f8b5a6a50');
if (pProps?.content) {
    pProps.content = pProps.content.replace(/<(\/?)vexa_/gi, '<$1lpe_')
        .replace('Use these exact formats:', 'When {{user}} asks to read an accessible letter, docket or notice, put its legible excerpt in <lpe_parchment title="…">…</lpe_parchment> once. The speaker may explain a term afterward. Use these exact formats:');
}
const pLore = byId('01a1af60-23f6-7000-af97-5278d408a56d');
if (pLore?.content) {
    pLore.content = instructions('Optional inline reference for established lore.', `<lore_definitions>
Place <lpe_lore term="term">Brief meaning.</lpe_lore> exactly where the term occurs in prose or dialogue. Use a reference when the viewpoint knows a term that the reader may need explained. Attribute rumors. Respect <epistemic_contract>: unknown translations, private motives and future revelations stay unknown. Leave the clue and its consequence in the scene. Encode special characters as for readable props.
</lore_definitions>`);
}
// 1. Internal States Template
const pTemplate = byId('01a138a1-2123-7027-a6e6-2b54afa6bcb4');
if (!pTemplate) throw new Error('Missing Internal States Template prompt');
pTemplate.content = INTERNAL_STATES_TEMPLATE_REPLACEMENT;

const order = preset.prompt_order[0].order;
const named = (name) => preset.prompts.find((p) => p.name === name);
function insertBefore(anchor, id, name, content, enabled) {
    const index = order.findIndex((row) => row.identifier === named(anchor)?.identifier);
    if (index < 0) throw new Error(`Missing insertion point: ${anchor}`);
    preset.prompts.push({ ...pProse, identifier: id, name, content, enabled });
    order.splice(index, 0, { identifier: id, enabled });
}

// Preserve the original order's effective settings, including the adult/JB pickers.
const retired = new Set(preset.prompts.filter((p) => p.name.startsWith('Antithesis -')
    || ['Prose Lint Functions', 'Internal States Themes + Styling'].includes(p.name)).map((p) => p.identifier));
preset.prompts = preset.prompts.filter((p) => !retired.has(p.identifier));
for (let i = order.length - 1; i >= 0; --i) {
    if (retired.has(order[i].identifier)) order.splice(i, 1);
}
for (const p of preset.prompts) {
    if (!order.some((row) => row.identifier === p.identifier)) order.push({ identifier: p.identifier, enabled: false });
}
const defaults = new Map([
    ['Dynamic DND Sim', true], ['D&D Sim', false], ['Realistic Dynamic NPCs', true],
    ['Realistic Bold NPCs', false], ['Dynamic NPC Voice', true], ['NPC Voice', false], ['Kinktionary', false],
]);
for (const row of order) {
    const p = byId(row.identifier);
    if (!p) throw new Error(`Unknown prompt: ${row.identifier}`);
    if (/^[━╒╘]/u.test(p.name)) {
        row.enabled = false;
        p.content = '';
    } else if (defaults.has(p.name)) row.enabled = defaults.get(p.name);
    p.enabled = row.enabled;
}
byId('01a1c7e8-312e-7000-ae7f-9844a74d11a7').name = '[Carbon/Neon] JB (438 tokens)';
named('Colored Dialogue + Tone Tags (Regex Required)').content =
    named('Colored Dialogue + Tone Tags (Regex Required)').content.replace(/marigold/gi, 'marigold');

for (const name of ['Dynamic DND Sim', 'D&D Sim']) {
    const p = named(name);
    p.content = p.content.replaceAll('.userRoll.seed[x]', '.user_d20')
        .replaceAll('.npcRoll.seed[x]', '.npc_d20[x] (next unused spotlight slot)')
        .replace(/5 evaluate \(<dice_rolls>\.user_d20 \+ 6\)[^\n]*/, '5 evaluate user_d20 with the +5 user modifier once, other modifiers and stats, vs locked DC')
        .replace(/\{\{setvar::d&dRolls::[\s\S]*$/, '{{setvar::d&dRolls::user_d20: {{roll::1d20}}\nnpc_d20 (spotlight order): {{roll::1d20}} | {{roll::1d20}} | {{roll::1d20}} | {{roll::1d20}}}}');
}
const worldSim = named('World Sim');
worldSim.content = worldSim.content.replaceAll('<diceRolls>', '<dice_rolls>')
    .replace('supplied chaos_anchor%5; absent → (band-1)%5', '(chaos_band-1)%5')
    .replace(/<dice_rolls>\.chaosRolls\.[^\n]*/, '<dice_rolls>.chaos_trigger and chaos_band. Missing either → SKIP. Never reroll.')
    .replace('messages → <fn:message_react>', 'messages require a recipient with access')
    .replace(' → <fn:gossip_plant>', '').replace('No <fn:gossip_cycle>; planted rumor', 'A planted rumor')
    .replace('worldSimRolls::Chaos Rolls:\n', 'worldSimRolls::');
named('Dice Rolls').content = `<dice_rolls>
{{getvar::d&dRolls}}
{{getvar::worldSimRolls}}
</dice_rolls>
Use the card or LPE <objective_dice_pool> or supplied card roll for its domain. Resolve that check once in private. A card's check sheet governs the calculation only: omit its Check Request/Result transcript, DC, stats, and dice from the reply. Narrate the observable consequence. Use the frontend fields only for remaining eligible checks; never invent a missing roll.`;

pProse.content += `\nNo tricolons: one detail or a pair. No apophasis (“didn't flinch”) or litotes (“not unwelcome”). Prefer “her heat” to “the heat of her.” Use visible or audible macro actions over stock micro-expressions. Use everyday anatomy and plain words.`;
function instructions(help, body) { return `{{// ${help}}}{{trim}}\n${body}`; }
const craft = [
    ['rhythm', 'Story Rhythm', true, 'Rotate dialogue-first, mid-action, a sharp sensory hit, or atmosphere-to-speech. Never open twice running with atmosphere. Vary paragraph starts: a line, a gesture, bare exchange, a standalone beat.'],
    ['readable', 'Readable Story Writing', true, 'Put the physical thing ahead of its title. Use the plainer equivalent. Give each speaker the vocabulary of their trade and schooling. Introduce at most one new setting term per turn beside what it names; use eligible <lpe_lore> there.'],
    ['textures', 'Prose Textures: Lite', false, 'Choose one texture per beat. Panic shortens breath; rage fixes attention; dissociation skips a connection; joy lingers; quiet allows space. Let syntax and omission carry it. Return to plain prose between beats.'],
];
for (const [id, name, enabled, body] of craft) {
    insertBefore('Prose Rules', `lpe-craft-${id}`, name, instructions('Independent prose toggle.', body), enabled);
}
insertBefore('━Chain of Thought', 'lpe-model-heading', '━ Model Patches [PICK 1]', '', false);
const patches = [
    ['gemini', 'Gemini', 'Give one forecast its full weight and say it once. Answer a feeling question in plain words or let the character dodge in voice. Keep nerves and humor at card scale. Ground a place through something used or touched.'],
    ['glm', 'GLM', 'Cut steadying words before decisions. Let disagreement stand as plain fact. Drop self-labeling prefaces such as “to be honest” or “for the record.” Start on the answer.'],
    ['deepseek', 'DeepSeek', 'Use fresh wording unless deliberately quoting the speaker. Move beyond a beat already played. Keep anatomy within the card. Make a single thinking pass.'],
    ['kimi-qwen', 'Kimi / Qwen', 'Cut filler before a decision. Give each applicable field one terse pass, commit its result, then write the scene.'],
    ['flash', 'Flash Tier', 'Give NPCs distinct interests and voices. Press a demand once, then act, trade, or drop it. Show feelings and decisions through concrete acts. Rest pet phrases for four turns.'],
];
for (const [id, label, gate] of patches) {
    insertBefore('━Chain of Thought', `lpe-patch-${id}`, `Model Patch: ${label} [PICK 1: PATCH]`,
        instructions('Enable one patch for the story model.', `{{setvar::lpe_model_patch::${label}}}{{setvar::lpe_patch_gate::${gate}}}{{trim}}`), id === 'gemini');
}
insertBefore('Gemini Pacing Nerf', 'lpe-lightning', 'Lightning Review ⚡', instructions('Optional review compression.',
    '{{setvar::lpe_lightning::Compress only [craft] and [spark] to ·-separated bullets of ≤12 words. Keep every [canon] check.}}{{trim}}'), false);
insertBefore('Gemini Pacing Nerf', 'lpe-review', 'LPE Story Review', instructions('Run once before output.',
    `Homer, blind rhapsode and unsparing chronicler: witness from {{user}}’s POV alone. Private review only. No drafting prose, counting words, reciting banned vocabulary, or rechecking settled rules. First decision stands unless a new fact intervenes. {{getvar::lpe_lightning}}
1 ASK [canon] Identify the user's action and OOC scope. Pure OOC pauses RP: answer directly.
2 NOW [canon] Read the injected snapshot. Lock ct+1, header clock, Atlas room/coords, sightlines, attire and held items. Apply <epistemic_contract> and <knowledge_sanity>: who could know this, by what vector?
3 MECHANICS [canon] Apply Notebook [R]. On initialization use <fn:first_turn_init>. For eligible checks lock DC before evaluating supplied dice: {{getvar::userDiceCall}} {{getvar::npcDiceCall}}. Honor domain pools. Gate Chekhov load/fire and ARC/Tracks; run World Turns off-screen without orbiting the user, then World Sim once. Apply enabled dispatch only when relevant: {{getvar::adultDispatch}}
4 SPINE [canon] For each active NPC lock card, leading facet, TFDY + IW, Matrix/Dam tension and exact <fontColor>. {{getvar::dualPairTracking}} {{getvar::dualDamTracking}}
5 SUBTEXT [craft] What does each speaker want, hide, or lie about? Let friction last.
6 BEAT [craft] Choose SUSTAIN / DEVELOP / TURN. Commit an independent NPC move appropriate to elapsed time. [spark] Would a weighted alternative open anything? Otherwise skip.
7 SHAPE [craft] Homer cadence, opener and paragraph rotation, concrete movement; check eligible GFX/readable props. Apply selected {{getvar::lpe_model_patch}} patch: {{getvar::lpe_patch_gate}}
8 ANCHORS [canon] Reconcile canon once. Commit OPEN → CRUX → YIELD before the user's next choice. Keep card check transcripts private; only their consequences enter prose. Confirm world_sim, chekhov, arc, ooc and any tracker proposal in <lpe_receipt>; put Homer's craft lines in <state:vent>. After <lpe_tail> close with <!-- GFX_END -->. As soon as anchors lock, close thinking tags and write immediately.`), true);

// Clear every consumed local before any picker runs, including vars used only by optional modes.
const locals = new Set(preset.prompts.flatMap((p) => [...(p.content || '').matchAll(/\{\{getvar::([^}:]+)}}/gi)].map((m) => m[1])));
pSysVars.content = instructions('Reset local toggles each turn. Adapted from Ryah’s Vexa / TeleWire TRP-AO.',
    [...locals].map((v) => `{{setvar::${v}::{{noop}}}}`).join('') + '{{trim}}');
preset.prompts = order.map(({ identifier }) => byId(identifier));

// 7. Prune obsolete <internal_states> HUD display & state-capping regexes while keeping ALL
//    prose, voice, tone, kinetic, prop, lore, Braille, GFX-stripper, and reasoning-delete scripts.
const KEEP_REGEX_PATTERNS = [
    /^Internal States Prompt Cleaner/i,
    /^71 - Internal States Prompt Cleaner/i,
    /^ShieldGemma deobfuscation/i,
    /^05 - Voice: Tag Close/i,
    /^\d+ - Voice:/i,
    /^\d+ - Tone:/i,
    /^(?:Vexa|LPE) - Kinetic/i,
    /^(?:Vexa|LPE) - Prop/i,
    /^(?:Vexa|LPE) - Lore/i,
    /^FrankenSIM Force Reasoning Delete/i,
    /^FF5 - GFX Stripper/i,
];

const keptRegexes = (preset.extensions?.regex_scripts || [])
    .filter((r) => KEEP_REGEX_PATTERNS.some((re) => re.test(r.scriptName || '')))
    .map((r) => {
        const next = { ...r };
        if (next.scriptName === '13 - Voice: Marigold') next.findRegex = next.findRegex.replace('Marigold', 'marigold');
        if (/^Vexa - (?:Kinetic|Prop|Lore)/i.test(next.scriptName || '')) {
            next.scriptName = next.scriptName.replace(/^Vexa - /i, 'LPE - ');
        }
        if (/^Vexa - (?:Prop|Lore)/i.test(r.scriptName) && next.findRegex) {
            // Support canonical <lpe_*> plus legacy <vexa_*> tags without shifting capture groups.
            next.findRegex = next.findRegex.replace(/vexa_/gi, '(?:lpe|vexa)_');
        }
        return next;
    });

const externalTailRegexes = [
    {
        id: 'b8a01e01-4100-4a12-9001-000000000001',
        scriptName: 'LPE External - Hide Tail Display',
        findRegex: COMPLETE_TAIL.toString(),
        replaceString: '',
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: true,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
    },
    {
        id: 'b8a01e01-4100-4a12-9001-000000000002',
        scriptName: 'LPE External - Strip Tail From Prompt',
        findRegex: COMPLETE_TAIL.toString(),
        replaceString: '',
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: false,
        promptOnly: true,
        runOnEdit: false,
        substituteRegex: 0,
        minDepth: 0,
        maxDepth: null,
    },
];

preset.extensions = preset.extensions || {};
function assistantRule(name, pattern, replacement, display, prompt) {
    return {
        ...externalTailRegexes[0], id: 'lpe-' + name.toLowerCase().replaceAll(' ', '-'),
        scriptName: 'LPE - ' + name, findRegex: pattern.toString(), replaceString: replacement,
        markdownOnly: display, promptOnly: prompt, minDepth: prompt ? 0 : null,
    };
}
const beforeRender = [
    assistantRule('Hide card check transcript',
        /^\[(?:Opposed )?Check Request\s*\|[^\]\r\n]{1,512}\][ \t]*(?:\r?\n>[ \t]*(?!\[(?:Opposed )?Check Result\b)[^\r\n]{0,1024}){1,32}\r?\n>[ \t]*\[(?:Opposed )?Check Result\s*:[^\]\r\n]{1,512}\][ \t]*$/gim,
        '', true, true),
    assistantRule('Unfence control blocks',
        /^[ \t]{0,3}```(?:html|xml)?[ \t]*\r?\n([ \t]*(?:<!--\s*GFX_(?:START|END)\s*-->|<(?:lpe_tail|vexa_tail|internal_states)\b[^>\n]{0,128}>)(?:(?!^[ \t]{0,3}```)[\s\S]){0,65536}?)\r?\n[ \t]{0,3}```[ \t]*\r?$/gim,
        '$1', true, true),
];
// Handle untagged reasoning only ahead of the actual clock header. Match it first to
// avoid creating nested disclosures when the model mixes plain and tagged notes.
const preHeader = /^(?!\s*(?:```|<details\b|<(?:think|thinking|reasoning)>|\[🕰))([\s\S]{1,32768}?)(?=\[🕰\uFE0F?\s*\d{1,2}:\d{2}\s*(?:AM|PM)\s*\|)/iu;
const thoughts = /<(think|thinking|reasoning)>((?:(?!<\/?(?:think|thinking|reasoning)>)[\s\S]){0,32768})<\/\1>/gi;
beforeRender.push(
    assistantRule('Strip preheader notes', preHeader, '', false, true),
    assistantRule('Strip tagged thoughts', thoughts, '', false, true),
    assistantRule('Fold preheader notes', preHeader, '<details><summary>Thoughts</summary>\n\n$1\n\n</details>\n\n', true, false),
    assistantRule('Fold tagged thoughts', thoughts, '<details><summary>Thoughts</summary>\n\n$2\n\n</details>', true, false),
);
// ST replacements are capture templates. Normalize only the expected attributes at
// their declared positions; a quote followed by the next field or > is a delimiter.
const propTag = String.raw`<(?:lpe|vexa)_(?:sms|discord|parchment|terminal|notification|lore|msg)`;
for (const [field, prefix, end] of [
    ['first', propTag + String.raw` (?:title|term|from)=`, String.raw`(?= time=|>)`],
    ['time', String.raw`<(?:lpe|vexa)_msg from="[^"<>\r\n]{1,120}" time=`, '(?=>)'],
]) {
    beforeRender.push(assistantRule('Normalize single quotes ' + field,
        new RegExp(`(${prefix})'([^<>\\r\\n]{1,120}?)'${end}`, 'gi'), '$1"$2"', true, false));
    // Escape paired quotation marks in names such as The "Grey" Seal.
    beforeRender.push(assistantRule('Escape quoted words ' + field,
        new RegExp(`(${prefix}"[^"<>\\r\\n]{0,120})"([^"<>\\r\\n]{1,120})"([^"<>\\r\\n]{0,120}")${end}`, 'gi'),
        '$1&quot;$2&quot;$3', true, false));
    beforeRender.push(assistantRule('Escape stray quote ' + field,
        new RegExp(`(${prefix}"[^"<>\\r\\n]{0,120})"([^"<>\\r\\n]{0,120}")${end}`, 'gi'),
        '$1&quot;$2', true, false));
}
const orphanProp = /<(?:lpe|vexa)_(sms|discord|msg|parchment|terminal|notification|lore)\b[^<>\r\n]{0,300}(?:>|(?=\r?$))(?![\s\S]{0,32000}?<\/(?:lpe|vexa)_\1>)/gim;
preset.extensions.regex_scripts = [
    ...keptRegexes.filter(rule => rule.scriptName.startsWith('ShieldGemma deobfuscation')),
    ...beforeRender,
    assistantRule('Recover incomplete prop', orphanProp, '', true, true),
    ...keptRegexes.filter(rule => !rule.scriptName.startsWith('ShieldGemma deobfuscation')),
    ...externalTailRegexes,
    assistantRule('Recover incomplete tail', INCOMPLETE_TAIL, '', true, true)];

fs.mkdirSync(path.dirname(OUT_USER_PRESET), { recursive: true });
fs.writeFileSync(OUT_USER_PRESET, JSON.stringify(preset, null, 4), 'utf8');

console.log(`Built Magnum Opus (LPE External-State) preset:
  - Source: ${SOURCE_PRESET}
  - Output: ${OUT_USER_PRESET}
  - Prompts: ${preset.prompts.length}
  - Regexes: ${preset.extensions.regex_scripts.length}`);
