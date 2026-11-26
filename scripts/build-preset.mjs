#!/usr/bin/env node
/**
 * Builds the Magnum Opus external-state preset (adapted for Lapis Philosophorum Engine (LPE))
 * from Ryah's original Dynamic World Vexa preset.
 * Preserves 100% of custom prompts (Realistic Dynamic NPCs, Dynamic NPC Voice, Dynamic DND Sim),
 * top-level sampler/model settings, and all prose/dialogue/tone/kinetic/prop/lore regexes.
 */

import fs from 'node:fs';
import path from 'node:path';

const WORKSPACE_PRESET_DIR = path.resolve(import.meta.dirname, '../../myVexapreset');
const SOURCE_PRESET = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(WORKSPACE_PRESET_DIR, 'ST.+.Tavo.Vexa.v1.0 (Dynamic World).json');
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
<vent>[First line MUST be in character per <sys>.ai_persona. Commentary on scene, dice, subtext, off-screen setup. 1-3 punchy lines.]</vent>
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

// 0. Brand & tag updates across Magnum Opus prompts (preserving Ryah's upstream Vexa credit in System Vars)
const pSysVars = byId('01a138a1-2123-7002-9d45-11da92d981d2');
if (pSysVars?.content) {
    pSysVars.content += `\n{{// Magnum Opus preset edition for Lapis Philosophorum Engine (LPE); upstream Vexa v1.0 & TeleWire TRP-AO architecture by Ryah.}}{{trim}}`;
}
const pRigid = byId('01a138a1-2123-7006-97e9-8310313533d3');
if (pRigid?.content) {
    pRigid.content = pRigid.content.replace(/^persona:\s*Vexa,/m, 'persona: Magnum Opus,');
}
const pProps = byId('01a1af5f-b110-7000-80dd-1c5f8b5a6a50');
if (pProps?.content) {
    pProps.content = pProps.content.replace(/<(\/?)vexa_/gi, '<$1lpe_');
}
const pLore = byId('01a1af60-23f6-7000-af97-5278d408a56d');
if (pLore?.content) {
    pLore.content = pLore.content.replace(/<(\/?)vexa_lore\b/gi, '<$1lpe_lore');
}
const pBootMeta = byId('01a138a1-2123-7035-bc48-3003c00f10c4');
if (pBootMeta?.content) {
    pBootMeta.content = pBootMeta.content
        .replace(/\/\/\s*EXECUTION:\s*you are Vexa,/i, '// EXECUTION: you are Magnum Opus,')
        .replace(/\bWas the last Vexa message\b/i, 'Was the last Magnum Opus message');
}

// 1. Internal States Template
const pTemplate = byId('01a138a1-2123-7027-a6e6-2b54afa6bcb4');
if (!pTemplate) throw new Error('Missing Internal States Template prompt');
pTemplate.content = INTERNAL_STATES_TEMPLATE_REPLACEMENT;

// 2. Prose Lint Functions (<fn:stateLint> only)
const pLint = byId('01a1b855-924b-7000-9dd8-86ea3e1b3d5f');
if (!pLint) throw new Error('Missing Prose Lint Functions prompt');
pLint.content = pLint.content.replace(
    /<fn:stateLint>[\s\S]*?<\/fn:stateLint>/,
    `<fn:stateLint>
1. Was the <header> present last response, and will it be present at the top of this response?
2. Did I respect the live read-only <internal_states> snapshot (Atlas geometry, character <fontColor> tags, Notebook [R] rules, Chekhov/ARC gates)?
3. Am I avoiding emitting a full <internal_states> block and instead ending cleanly with <lpe_tail> (<lpe_receipt> + <state:vent>) followed by <!-- GFX_END -->?
4. Does <lpe_receipt> accurately record any world_sim result, fired/unlocked/loaded Chekhov bullets, ARC/Track updates, and new OOC rules?
⇤
</fn:stateLint>`,
);

// 3. Antithesis - Boot
const pBoot = byId('01a138a1-2123-7035-bc48-3003c00f10c4');
if (!pBoot) throw new Error('Missing Antithesis - Boot prompt');
pBoot.content = pBoot.content.replace(
    /9\.\s*STATE_CHECK:[^\n]*/,
    '9. STATE_CHECK: Read the injected <internal_states> snapshot. Which entries govern this turn? Remember: NEVER emit <internal_states>; emit only <lpe_tail> + <!-- GFX_END --> at the end.',
);

// 4. Antithesis - Router
const pRouter = byId('01a138a1-2123-7037-9ee4-b577bcac95d3');
if (!pRouter) throw new Error('Missing Antithesis - Router prompt');
pRouter.content = pRouter.content.replace(
    /AND OUTPUT INTERNAL STATES!/g,
    'AND establish starting locations/colors/seeds in prose + <lpe_receipt> so LPE Clerk initializes state!',
);

// 5. Antithesis - Helper Functions (<fn:anchors>)
const pHelpers = byId('01a138a1-2123-7038-8207-f5c2fc795f6d');
if (!pHelpers) throw new Error('Missing Antithesis - Helper Functions prompt');
pHelpers.content = pHelpers.content.replace(
    /Prose ENDS here,\s*<internal_states>\s*comes after\./g,
    'Prose ENDS here, <lpe_tail> + <!-- GFX_END --> come after.',
);

// 6. Antithesis - Tail/Output
const pTail = byId('01a138a1-2123-703a-a835-3fbb29fd60db');
if (!pTail) throw new Error('Missing Antithesis - Tail/Output prompt');
pTail.content = pTail.content
    .replace(
        /always include <internal_states>\./g,
        'always include <lpe_tail> + <!-- GFX_END --> (NEVER full <internal_states>).',
    )
    .replace(
        /16\.\s*Name exactly 2 changes you will be making to <internal_states>[^\n]*/,
        '16. Confirm what <lpe_receipt> updates (world_sim, chekhov, arc, ooc) and <state:vent> lines you will emit inside <lpe_tail> (do NOT output <internal_states>).',
    )
    .replace(
        /THEN Apply all internal states per <internal_states> at end of response\./g,
        'THEN end with <lpe_tail> (<lpe_receipt> + <state:vent>) and <!-- GFX_END -->. DO NOT output <internal_states>.',
    )
    .replace(
        /\[SYSTEM: Not including <internal_states>[^\]]*\]/g,
        '[SYSTEM: Not including <lpe_tail> followed by <!-- GFX_END --> at the end of the response is a CRITICAL FAILURE. Never emit full <internal_states>.]',
    );

// 7. Prune obsolete <internal_states> HUD display & state-capping regexes while keeping ALL
//    prose, voice, tone, kinetic, prop, lore, Braille, GFX-stripper, and reasoning-delete scripts.
const KEEP_REGEX_PATTERNS = [
    /^Internal States Prompt Cleaner/i,
    /^71 - Internal States Prompt Cleaner/i,
    /^ShieldGemma deobfuscation/i,
    /^05 - Voice: Tag Close/i,
    /^\d+ - Voice:/i,
    /^\d+ - Tone:/i,
    /^Vexa - Kinetic/i,
    /^Vexa - Prop/i,
    /^Vexa - Lore/i,
    /^FrankenSIM Force Reasoning Delete/i,
    /^FF5 - GFX Stripper/i,
    /^Old Codeblock Cleaner/i,
];

const keptRegexes = (preset.extensions?.regex_scripts || [])
    .filter((r) => KEEP_REGEX_PATTERNS.some((re) => re.test(r.scriptName || '')))
    .map((r) => {
        const next = { ...r };
        if (/^Vexa - (?:Kinetic|Prop|Lore)/i.test(next.scriptName || '')) {
            next.scriptName = next.scriptName.replace(/^Vexa - /i, 'LPE - ');
        }
        if (/^LPE - (?:Prop|Lore)/i.test(next.scriptName || '') && next.findRegex) {
            // Support canonical <lpe_*> plus legacy <vexa_*> tags without shifting capture groups.
            next.findRegex = next.findRegex.replace(/vexa_/gi, '(?:lpe|vexa)_');
        }
        return next;
    });

const externalTailRegexes = [
    {
        id: 'b8a01e01-4100-4a12-9001-000000000001',
        scriptName: 'LPE External - Hide Tail Display',
        findRegex: '/<(?:lpe|vexa)_tail\\b[^>]*>[\\s\\S]*?<\\/(?:lpe|vexa)_tail[\\s\\u2800]*>(?:[\\s\\u2800]*<!--[\\s\\u2800]*GFX_END[\\s\\u2800]*-->)?/gi',
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
        findRegex: '/<(?:lpe|vexa)_tail\\b[^>]*>[\\s\\S]*?<\\/(?:lpe|vexa)_tail[\\s\\u2800]*>(?:[\\s\\u2800]*<!--[\\s\\u2800]*GFX_END[\\s\\u2800]*-->)?/gi',
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
preset.extensions.regex_scripts = [...keptRegexes, ...externalTailRegexes];

fs.mkdirSync(path.dirname(OUT_USER_PRESET), { recursive: true });
fs.writeFileSync(OUT_USER_PRESET, JSON.stringify(preset, null, 4), 'utf8');

console.log(`Built Magnum Opus (LPE External-State) preset:
  - Source: ${SOURCE_PRESET}
  - Output: ${OUT_USER_PRESET}
  - Prompts: ${preset.prompts.length} (Dynamic World prompts preserved)
  - Regexes: ${preset.extensions.regex_scripts.length} (kept ${keptRegexes.length} prose/voice/tone/prop/lore/deobf + added 2 tail scripts)`);
