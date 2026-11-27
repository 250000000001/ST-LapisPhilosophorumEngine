import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { emptyState } from '../src/schema.js';
import { parseInternalStates, serializeInternalStates, serializeCompactForWorker } from '../src/parser.js';
import { applyDelta, parseWorkerDelta } from '../src/reducer.js';
import { buildWorkerMessages } from '../src/workerPrompt.js';
import { APP_TABS, mapHudTabToAppTab } from '../src/appPopup.js';
import { HUD_TABS } from '../src/hud.js';
import {
    BODY_TYPES,
    HEALTH_LAYERS,
    BODY_PARTS,
    normalizeBodyPartId,
    normalizeConditionKind,
    normalizeBodyType,
    normalizeSeverity,
    normalizeHealthState,
    hasExplicitHealthData,
    applyHealthDelta,
    inferHealthFromStatusText,
    computeHealthMetrics,
    renderHealthDollSvg,
    renderHealthTab,
    bindHealthDollInteractions,
} from '../src/healthDoll.js';

const CHAT_PATH = fs.existsSync('/home/user/Chat Archive/chat_a_song_of_ice_and_fire__vexa__20261125-170601.jsonl')
    ? '/home/user/Chat Archive/chat_a_song_of_ice_and_fire__vexa__20261125-170601.jsonl'
    : path.resolve(import.meta.dirname, '../../../Chat Archive/chat_a_song_of_ice_and_fire__vexa__20261125-170601.jsonl');

test('Body-part, condition-kind, body-type, and severity normalization handle synonyms cleanly', () => {
    assert.equal(BODY_PARTS.length, 27);
    assert.equal(normalizeBodyPartId('right knee'), 'right_leg');
    assert.equal(normalizeBodyPartId('brow'), 'head');
    assert.equal(normalizeBodyPartId('ribs'), 'ribcage');
    assert.equal(normalizeBodyPartId('left wrist'), 'left_hand');
    assert.equal(normalizeBodyPartId('right ankle'), 'right_foot');
    assert.equal(normalizeBodyPartId('left shoulder'), 'left_shoulder');
    assert.equal(normalizeBodyPartId('lungs'), 'right_lung');
    assert.equal(normalizeBodyPartId('completely_unknown_zone'), null);

    assert.equal(normalizeConditionKind('', 'Deep Sword Cut'), 'sharp');
    assert.equal(normalizeConditionKind('', 'Fading bruise'), 'blunt');
    assert.equal(normalizeConditionKind('', 'Wildfire Burn'), 'burn');
    assert.equal(normalizeConditionKind('', 'Frostbite'), 'frost');
    assert.equal(normalizeConditionKind('', 'Broken Rib'), 'fracture');
    assert.equal(normalizeConditionKind('', 'Nightshade Poisoning'), 'toxin');
    assert.equal(normalizeConditionKind('', 'Healed practice-yard brow nick'), 'scar');

    assert.equal(normalizeBodyType('Woman'), 'female');
    assert.equal(normalizeBodyType('ranger'), 'athletic');
    assert.equal(normalizeBodyType('hulk'), 'heavy');
    assert.equal(normalizeBodyType('invalid'), 'male');

    assert.equal(normalizeSeverity('minor'), 15);
    assert.equal(normalizeSeverity('severe'), 70);
    assert.equal(normalizeSeverity(140), 100);
});

test('applyDelta and applyHealthDelta compute part HP, pain, capacities, tending, scars, prosthetics, and healing', () => {
    const base = emptyState();
    const { state: s1, diff } = applyDelta(base, {
        health_delta: {
            bodyType: 'athletic',
            bloodLoss: 25,
            add_conditions: [
                { part: 'left_arm', kind: 'sharp', label: 'Sword Slash', severity: 45, bleeding: true, note: 'Bandit duel' },
                { part: 'ribcage', kind: 'fracture', label: 'Cracked Ribs', severity: 35 },
                { part: 'left_eye', kind: 'burn', label: 'Torch Scurf', severity: 20 },
            ],
            whole_body_upsert: [
                { type: 'hypothermia', label: 'Wall Chill', severity: 30 },
            ],
        },
    });

    assert.ok(diff.includes('health'));
    assert.equal(s1.health.bodyType, 'athletic');
    assert.equal(s1.health.bloodLoss, 25);
    assert.equal(s1.health.parts.left_arm.hp, 55);
    assert.equal(s1.health.parts.ribcage.hp, 65);
    assert.equal(s1.health.parts.left_eye.hp, 80);
    assert.ok(s1.health.pain > 30);

    const m1 = computeHealthMetrics(s1.health);
    assert.equal(m1.totalWounds, 3);
    assert.equal(m1.bleedingCount, 1);
    assert.equal(m1.untreatedCount, 3);
    assert.equal(m1.internalIssues, 1);
    assert.ok(m1.capacities.manipulation < 100);
    assert.ok(m1.capacities.breathing < 100);
    assert.ok(m1.capacities.sight < 100);

    // Tend / bandage reduces pain and clears bleeding
    const { state: s2 } = applyDelta(s1, {
        health_delta: {
            tend_all: true,
            set_parts: {
                right_hand: { missing: true },
                left_foot: { prosthetic: 'Iron Boot Frame', armor: 'Greave' },
            },
        },
    });
    assert.equal(s2.health.parts.left_arm.conditions[0].treated, true);
    assert.equal(s2.health.parts.left_arm.conditions[0].bleeding, false);
    assert.ok(s2.health.pain < s1.health.pain);
    assert.equal(s2.health.parts.right_hand.hp, 0);
    assert.equal(s2.health.parts.right_hand.missing, true);
    assert.equal(s2.health.parts.left_foot.hp, 100);
    assert.equal(s2.health.parts.left_foot.prosthetic, 'Iron Boot Frame');

    // Convert slash to scar -> penalty capped at 15 -> 85% HP
    const { state: s3 } = applyDelta(s2, {
        health_delta: {
            patch_conditions: [{ part: 'left_arm', label: 'Sword Slash', scar: true }],
            heal_conditions: [{ part: 'ribcage', label: 'Cracked Ribs' }],
            whole_body_remove: ['Wall Chill'],
        },
    });
    assert.equal(s3.health.parts.left_arm.conditions[0].scar, true);
    assert.equal(s3.health.parts.left_arm.hp, 85);
    assert.equal(s3.health.parts.ribcage, undefined, 'Healthy empty part must be pruned');
    assert.equal(s3.health.wholeBody.length, 0);

    // Full heal preserves scars & prosthetics/missing while wiping active wounds
    const { state: s4 } = applyDelta(s3, {
        health_delta: { full_heal: true },
    });
    assert.equal(s4.health.bloodLoss, 0);
    assert.equal(s4.health.pain, 0);
    assert.equal(s4.health.parts.left_arm.conditions.length, 1);
    assert.equal(s4.health.parts.left_eye, undefined);
});

test('XML parser & serializer round-trip <state:health> cleanly with 0 token overhead when healthy', () => {
    const clean = emptyState();
    const cleanXml = serializeInternalStates(clean, { scoped: false, includeVent: false });
    assert.equal(cleanXml.includes('<state:health>'), false);

    const { state: injured } = applyDelta(clean, {
        health_delta: {
            bodyType: 'female',
            bloodLoss: 15,
            pain: 22,
            add_conditions: [
                { part: 'left_shoulder', kind: 'sharp', label: 'Arrow Graze', severity: 30, bleeding: true, note: 'Fletched bolt & <iron>' },
            ],
            set_parts: {
                right_eye: { missing: true },
                right_arm: { prosthetic: 'Silver Prosthesis', armor: 'Bracer' },
            },
            whole_body_upsert: [
                { type: 'toxin', label: 'Manticore Venom', severity: 45, treated: true, note: 'Antidote applied' },
            ],
        },
    });

    const xml = serializeInternalStates(injured, { scoped: false, includeVent: true });
    assert.ok(xml.includes('<state:health>'));
    assert.ok(xml.includes('<bodyType>female</bodyType>'));
    assert.ok(xml.includes('prosthetic="Silver Prosthesis"'));

    const reparsed = parseInternalStates(xml);
    assert.ok(reparsed);
    assert.deepEqual(reparsed.health, injured.health);
    assert.equal(hasExplicitHealthData(reparsed.health), true);
});

test('inferHealthFromStatusText accurately previews real ASOIAF chat statuses without false positives', () => {
    const lines = fs.readFileSync(CHAT_PATH, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const aiMsgs = lines.filter((r) => 'mes' in r && !r.is_user && /<internal_states>/i.test(r.mes));

    const st1 = parseInternalStates(aiMsgs[0].mes);
    const inf1 = inferHealthFromStatusText(st1.inv.status);
    assert.equal(inf1.inferred, true);
    assert.ok(inf1.parts.head?.conditions.some((c) => c.scar && /brow nick/i.test(c.label)));

    const st11 = parseInternalStates(aiMsgs[10].mes);
    const inf11 = inferHealthFromStatusText(st11.inv.status);
    assert.equal(inf11.inferred, true);
    assert.ok(inf11.parts.right_leg?.conditions.some((c) => c.kind === 'blunt' && /right knee/i.test(c.label)));

    const st36 = parseInternalStates(aiMsgs[35].mes);
    const inf36 = inferHealthFromStatusText(st36.inv.status);
    assert.equal(inf36.inferred, false);
    assert.equal(Object.keys(inf36.parts).length, 0);
});

test('renderHealthDollSvg and renderHealthTab render all 4 silhouettes, 4 layers, overlays, and safe HTML', () => {
    const { state } = applyDelta(emptyState(), {
        health_delta: {
            bloodLoss: 30,
            add_conditions: [
                { part: 'left_arm', kind: 'sharp', label: 'Cut', severity: 35, bleeding: true, note: '<script>alert(1)</script>' },
                { part: 'right_arm', kind: 'burn', label: 'Scald', severity: 25, treated: true },
                { part: 'head', kind: 'scar', label: 'Old Scar', severity: 10, scar: true },
                { part: 'torso', kind: 'frost', label: 'Frostbite', severity: 20 },
                { part: 'ribcage', kind: 'fracture', label: 'Cracked Rib', severity: 40 },
            ],
            set_parts: {
                right_hand: { missing: true },
                left_leg: { prosthetic: 'Steel Leg' },
            },
            whole_body_upsert: [{ type: 'disease', label: 'Chills', severity: 25 }],
        },
    });

    for (const bt of BODY_TYPES) {
        const h = normalizeHealthState({ ...state.health, bodyType: bt });
        for (const layer of HEALTH_LAYERS) {
            const svg = renderHealthDollSvg(h, { layer, selectedPart: 'left_arm' });
            assert.ok(svg.includes('<svg class="lpe-doll-svg"'), `SVG missing for ${bt}/${layer}`);
            assert.ok(svg.includes('lpe-pat-bandage-'), 'Bandage pattern expected');
            assert.ok(svg.includes('lpe-pat-scar-'), 'Scar pattern expected');
            assert.ok(svg.includes('lpe-pat-sharp-'), 'Sharp pattern expected');
            assert.ok(svg.includes('lpe-pat-burn-'), 'Burn pattern expected');
            assert.ok(svg.includes('lpe-pat-frost-'), 'Frost pattern expected');
            assert.ok(svg.includes('lpe-pat-prosthetic-'), 'Prosthetic pattern expected');
            if (layer === 'body') {
                assert.ok(svg.includes('lpe-doll-internal-alert'), 'Body layer should surface internal alert for ribcage');
            }
        }
    }

    // Two consecutive SVG renders must use distinct pattern/clip IDs so multi-card chat DOM never collides
    const svgA = renderHealthDollSvg(state.health);
    const svgB = renderHealthDollSvg(state.health);
    const idA = svgA.match(/id="lpe-pat-bandage-([^"]+)"/)?.[1];
    const idB = svgB.match(/id="lpe-pat-bandage-([^"]+)"/)?.[1];
    assert.ok(idA && idB && idA !== idB);

    const html = renderHealthTab(state, { layer: 'xray', selectedPart: 'left_arm', showActions: true });
    assert.ok(html.includes('Overall HP'));
    assert.ok(html.includes('Consciousness'));
    assert.ok(html.includes('lpe-health-treat-btn'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.equal(html.includes('<script>'), false);

    // HUD & Popup registration checks
    assert.ok(HUD_TABS.some((t) => t.id === 'health'));
    assert.ok(APP_TABS.some((t) => t.id === 'health'));
    assert.deepEqual(mapHudTabToAppTab('health'), { tab: 'health', sub: null });
});

test('persistent health-doll delegation switches parts directly and survives re-renders', () => {
    const listeners = [];
    const host = {
        dataset: {},
        contains: () => true,
        addEventListener(type, handler) {
            assert.equal(type, 'click');
            listeners.push(handler);
        },
    };
    let selectedPart = null;
    let layer = 'body';
    let bodyPartSelect = 'torso';
    let inspecting = 'Conditions (0 active · 0 scars)';
    let renderCount = 0;

    const renderSelection = () => {
        renderCount++;
        bodyPartSelect = selectedPart || 'torso';
        inspecting = selectedPart
            ? `Inspecting: ${BODY_PARTS.find((part) => part.id === selectedPart).label}`
            : 'Conditions (0 active · 0 scars)';
    };
    assert.equal(bindHealthDollInteractions(host, {
        getSelectedPart: () => selectedPart,
        onSelectPart: (partId) => {
            selectedPart = partId;
            renderSelection();
        },
        onLayerChange: (nextLayer) => {
            layer = nextLayer;
            renderSelection();
        },
    }), true);
    assert.equal(bindHealthDollInteractions(host), false, 'Repeated renders must not add duplicate listeners');
    assert.equal(listeners.length, 1);
    assert.equal(host.dataset.lpeHealthDelegated, 'true');

    const click = (selector, element = {}) => {
        listeners[0]({
            target: { closest: (query) => (query === selector ? element : null) },
            preventDefault() {},
        });
    };
    const clickPart = (partId) => click('[data-part]', {
        getAttribute: (name) => (name === 'data-part' ? partId : null),
    });

    clickPart('head');
    assert.equal(selectedPart, 'head', 'Part A should select');
    assert.equal(bodyPartSelect, 'head');
    assert.equal(inspecting, 'Inspecting: Head');

    clickPart('torso');
    assert.equal(selectedPart, 'torso', 'Part B should replace Part A instead of clearing');
    assert.equal(bodyPartSelect, 'torso');
    assert.equal(inspecting, 'Inspecting: Torso');

    click('.lpe-health-clear-sel');
    assert.equal(selectedPart, null, 'Show All should clear the selection');
    assert.equal(inspecting, 'Conditions (0 active · 0 scars)');

    clickPart('right_leg');
    assert.equal(selectedPart, 'right_leg', 'Part C should select after Show All without reopening');
    assert.equal(bodyPartSelect, 'right_leg');
    assert.equal(inspecting, 'Inspecting: Right Leg');

    clickPart('right_leg');
    assert.equal(selectedPart, null, 'Clicking the selected part again should clear it');
    clickPart('left_arm');
    click('.lpe-doll-svg');
    assert.equal(selectedPart, null, 'Blank SVG background should clear without intercepting parts');

    clickPart('head');
    click('.lpe-health-layer-btn, .lpe-doll-internal-alert', {
        getAttribute: (name) => (name === 'data-health-layer' ? 'bones' : null),
    });
    assert.equal(layer, 'bones');
    clickPart('skull');
    assert.equal(selectedPart, 'skull', 'Layer re-renders should preserve live part clicks');
    assert.ok(renderCount >= 8, 'Each interaction should exercise the re-render path');
});

test('workerPrompt documents health_delta and parseWorkerDelta accepts health_delta cleanly', () => {
    const s0 = emptyState();
    for (const modeOpts of [
        { mode: 'combined', part: null },
        { mode: 'split', part: 'spatial_entity' },
    ]) {
        const msgs = buildWorkerMessages({
            prevState: s0,
            exchange: 'Ormund took a sword slash across his left arm.',
            ...modeOpts,
        });
        const full = `${msgs[0].content}\n${msgs[1].content}`;
        assert.ok(full.includes('health_delta'));
        assert.ok(full.includes('ribcage'));
    }

    const parsed = parseWorkerDelta(JSON.stringify({
        health_delta: {
            bloodLoss: 15,
            add_conditions: [{ part: 'left_arm', kind: 'sharp', label: 'Sword Cut', severity: 30, bleeding: true }],
        },
    }));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.delta.health_delta.bloodLoss, 15);
    assert.equal(serializeCompactForWorker(s0).health.healthy, true);
});
