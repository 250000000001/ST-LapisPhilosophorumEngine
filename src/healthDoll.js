/**
 * Nice Health Tab-inspired anatomical body-part health model, deterministic injury reducer,
 * capacity calculator, status-text inference, and vector SVG paper-doll renderer.
 *
 * Original visual & UX inspiration: "Nice Health Tab" for RimWorld by Andromeda
 * (https://steamcommunity.com/sharedfiles/filedetails/?id=3328729902).
 * All SVG silhouettes, injury patterns, and icons here are original vector implementations.
 *
 * Pure ES module with zero DOM dependencies so it runs cleanly under Node tests.
 */

import { isEmptySentinel } from './schema.js';

export const BODY_TYPES = Object.freeze(['male', 'female', 'athletic', 'heavy']);
export const HEALTH_LAYERS = Object.freeze(['body', 'organs', 'bones', 'xray']);
export const CONDITION_KINDS = Object.freeze([
    'sharp',
    'blunt',
    'burn',
    'frost',
    'bleeding',
    'fracture',
    'infection',
    'toxin',
    'scar',
    'other',
]);
export const WHOLE_BODY_TYPES = Object.freeze([
    'disease',
    'toxin',
    'malnutrition',
    'hypothermia',
    'heatstroke',
    'exhaustion',
    'intoxication',
    'bleeding',
    'buff',
    'other',
]);

export const BODY_PARTS = Object.freeze([
    // Exterior layer (15 parts) — anatomical viewer orientation (character Right = viewer Left)
    { id: 'head', label: 'Head', layer: 'body', group: 'Head', cx: 130, cy: 48, vitalWeight: 1.5 },
    { id: 'right_eye', label: 'Right Eye', layer: 'body', group: 'Head', cx: 118, cy: 48, vitalWeight: 0.4 },
    { id: 'left_eye', label: 'Left Eye', layer: 'body', group: 'Head', cx: 142, cy: 48, vitalWeight: 0.4 },
    { id: 'neck', label: 'Neck', layer: 'body', group: 'Head', cx: 130, cy: 84, vitalWeight: 1.4 },
    { id: 'torso', label: 'Torso', layer: 'body', group: 'Torso', cx: 130, cy: 162, vitalWeight: 2.2 },
    { id: 'right_shoulder', label: 'Right Shoulder', layer: 'body', group: 'Arms', cx: 80, cy: 112, vitalWeight: 0.6 },
    { id: 'left_shoulder', label: 'Left Shoulder', layer: 'body', group: 'Arms', cx: 180, cy: 112, vitalWeight: 0.6 },
    { id: 'right_arm', label: 'Right Arm', layer: 'body', group: 'Arms', cx: 64, cy: 170, vitalWeight: 0.7 },
    { id: 'left_arm', label: 'Left Arm', layer: 'body', group: 'Arms', cx: 196, cy: 170, vitalWeight: 0.7 },
    { id: 'right_hand', label: 'Right Hand', layer: 'body', group: 'Arms', cx: 52, cy: 235, vitalWeight: 0.5 },
    { id: 'left_hand', label: 'Left Hand', layer: 'body', group: 'Arms', cx: 208, cy: 235, vitalWeight: 0.5 },
    { id: 'right_leg', label: 'Right Leg', layer: 'body', group: 'Legs', cx: 103, cy: 325, vitalWeight: 0.9 },
    { id: 'left_leg', label: 'Left Leg', layer: 'body', group: 'Legs', cx: 157, cy: 325, vitalWeight: 0.9 },
    { id: 'right_foot', label: 'Right Foot', layer: 'body', group: 'Legs', cx: 95, cy: 438, vitalWeight: 0.4 },
    { id: 'left_foot', label: 'Left Foot', layer: 'body', group: 'Legs', cx: 165, cy: 438, vitalWeight: 0.4 },

    // Organs layer (8 parts)
    { id: 'brain', label: 'Brain', layer: 'organs', group: 'Head', cx: 130, cy: 36, vitalWeight: 2.5 },
    { id: 'heart', label: 'Heart', layer: 'organs', group: 'Torso', cx: 137, cy: 136, vitalWeight: 2.4 },
    { id: 'right_lung', label: 'Right Lung', layer: 'organs', group: 'Torso', cx: 112, cy: 134, vitalWeight: 1.4 },
    { id: 'left_lung', label: 'Left Lung', layer: 'organs', group: 'Torso', cx: 148, cy: 134, vitalWeight: 1.4 },
    { id: 'stomach', label: 'Stomach', layer: 'organs', group: 'Torso', cx: 142, cy: 176, vitalWeight: 1.0 },
    { id: 'liver', label: 'Liver', layer: 'organs', group: 'Torso', cx: 114, cy: 174, vitalWeight: 1.2 },
    { id: 'right_kidney', label: 'Right Kidney', layer: 'organs', group: 'Torso', cx: 110, cy: 202, vitalWeight: 0.8 },
    { id: 'left_kidney', label: 'Left Kidney', layer: 'organs', group: 'Torso', cx: 150, cy: 202, vitalWeight: 0.8 },

    // Bones layer (4 parts)
    { id: 'skull', label: 'Skull', layer: 'bones', group: 'Head', cx: 130, cy: 46, vitalWeight: 1.6 },
    { id: 'ribcage', label: 'Ribcage', layer: 'bones', group: 'Torso', cx: 130, cy: 138, vitalWeight: 1.3 },
    { id: 'spine', label: 'Spine', layer: 'bones', group: 'Torso', cx: 130, cy: 184, vitalWeight: 1.8 },
    { id: 'pelvis', label: 'Pelvis', layer: 'bones', group: 'Torso', cx: 130, cy: 230, vitalWeight: 1.1 },
]);

export const BODY_PART_BY_ID = Object.freeze(
    Object.fromEntries(BODY_PARTS.map((p) => [p.id, p])),
);

const CONDITION_COLORS = Object.freeze({
    sharp: '#ef4444',
    blunt: '#f59e0b',
    burn: '#fb923c',
    frost: '#38bdf8',
    bleeding: '#dc2626',
    fracture: '#fde047',
    infection: '#84cc16',
    toxin: '#a855f7',
    scar: '#94a3b8',
    other: '#9ca3af',
});

const CONDITION_LABELS = Object.freeze({
    sharp: 'Sharp',
    blunt: 'Blunt',
    burn: 'Burn',
    frost: 'Frost',
    bleeding: 'Bleeding',
    fracture: 'Fracture',
    infection: 'Infection',
    toxin: 'Toxin',
    scar: 'Scar',
    other: 'Condition',
});

let svgUidSeq = 0;

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function clamp(min, max, val) {
    return Math.max(min, Math.min(max, val));
}

export function normalizeBodyType(raw) {
    const s = String(raw ?? '').trim().toLowerCase();
    if (BODY_TYPES.includes(s)) return s;
    if (/^(female|woman|girl|lady|feminine)$/.test(s)) return 'female';
    if (/^(athletic|lean|slim|fit|muscular|ranger|lithe|agile)$/.test(s)) return 'athletic';
    if (/^(heavy|fat|hulk|stout|broad|stocky|large|big|burly|brawny)$/.test(s)) return 'heavy';
    return 'male';
}

export function normalizeBodyPartId(raw) {
    const s = String(raw ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    if (!s || isEmptySentinel(s)) return null;

    const underscored = s.replace(/\s+/g, '_');
    if (BODY_PART_BY_ID[underscored]) return underscored;

    const isLeft = /\b(?:left|l)\b/.test(s);
    const isRight = /\b(?:right|r)\b/.test(s);
    const side = isLeft && !isRight ? 'left' : 'right';

    if (/\b(?:eye|eyes|ocular|eyelid|socket)\b/.test(s)) return `${side}_eye`;
    if (/\b(?:shoulder|shoulders|clavicle|collarbone|deltoid)\b/.test(s)) return `${side}_shoulder`;
    if (/\b(?:hand|hands|wrist|wrists|palm|finger|fingers|thumb|knuckle|knuckles|fist|claw)\b/.test(s)) return `${side}_hand`;
    if (/\b(?:arm|arms|forearm|forearms|elbow|elbows|bicep|biceps|tricep|triceps)\b/.test(s)) return `${side}_arm`;
    if (/\b(?:foot|feet|ankle|ankles|heel|heels|toe|toes|sole)\b/.test(s)) return `${side}_foot`;
    if (/\b(?:leg|legs|thigh|thighs|knee|knees|kneecap|shin|shins|calf|calves|hamstring|femur)\b/.test(s)) return `${side}_leg`;
    if (/\b(?:lung|lungs|pulmonary)\b/.test(s)) return `${side}_lung`;
    if (/\b(?:kidney|kidneys|renal)\b/.test(s)) return `${side}_kidney`;

    if (/\b(?:brain|cerebral|cerebrum)\b/.test(s)) return 'brain';
    if (/\b(?:skull|cranium|cranial)\b/.test(s)) return 'skull';
    if (/\b(?:rib|ribs|ribcage)\b/.test(s)) return 'ribcage';
    if (/\b(?:spine|spinal|vertebra|vertebrae|backbone)\b/.test(s)) return 'spine';
    if (/\b(?:pelvis|pelvic)\b/.test(s)) return 'pelvis';
    if (/\b(?:heart|cardiac)\b/.test(s)) return 'heart';
    if (/\b(?:stomach|gastric)\b/.test(s)) return 'stomach';
    if (/\b(?:liver|hepatic)\b/.test(s)) return 'liver';
    if (/\b(?:neck|throat|jugular|carotid|nape)\b/.test(s)) return 'neck';
    if (/\b(?:head|brow|forehead|jaw|face|cheek|cheeks|ear|ears|nose|mouth|lip|lips|chin|temple|scalp|crown|concussion)\b/.test(s)) return 'head';
    if (/\b(?:torso|chest|abdomen|belly|back|gut|waist|flank|side|pectoral|groin|hip|hips|sternum|body)\b/.test(s)) return 'torso';

    return null;
}

export function normalizeConditionKind(raw, label = '') {
    const r = String(raw ?? '').trim().toLowerCase();
    if (CONDITION_KINDS.includes(r)) return r;
    const probe = `${r} ${String(label ?? '').toLowerCase()}`;

    if (/\bscar(?:red|ring)?\b|\bold wound\b|\bhealed\b/.test(probe)) return 'scar';
    if (/\bfractur|broken|break|crack(?:ed)?|shatter|dislocat|splinter/.test(probe)) return 'fracture';
    if (/\bburn|scald|singe|fire|flame|acid|blister|char(?:red)?|scorch|brand|steam/.test(probe)) return 'burn';
    if (/\bfrost|frostbite|chill|freez|ice\b/.test(probe)) return 'frost';
    if (/\binfect|fever|plague|flu|rot\b|sepsis|fester|gangrene/.test(probe)) return 'infection';
    if (/\btoxin|poison|venom|smoke|toxic|blight|miasma/.test(probe)) return 'toxin';
    if (/\bbleed|hemorrhag|blood loss/.test(probe)) return 'bleeding';
    if (/\bcut|slash|stab|pierce|arrow|bite|lacerat|nick|gash|slice|sword|blade|claw|scratch|puncture|sever/.test(probe)) return 'sharp';
    if (/\bbruise|crush|sprain|concussion|impact|contusion|swollen|swelling|ache|aching|sore|twist|wrench|club|mace|hammer|punch|kick|blunt/.test(probe)) return 'blunt';
    return 'other';
}

export function normalizeWholeBodyType(raw, label = '') {
    const r = String(raw ?? '').trim().toLowerCase();
    if (WHOLE_BODY_TYPES.includes(r)) return r;
    const probe = `${r} ${String(label ?? '').toLowerCase()}`;
    if (/toxin|poison|venom|smoke/.test(probe)) return 'toxin';
    if (/malnutri|starv|hunger|famish/.test(probe)) return 'malnutrition';
    if (/hypotherm|freez|frost|chill/.test(probe)) return 'hypothermia';
    if (/heatstroke|overheat|heat exhaust/.test(probe)) return 'heatstroke';
    if (/exhaust|fatigue|tired|sleep depriv/.test(probe)) return 'exhaustion';
    if (/intoxic|drunk|alcohol|inebriat|hangover/.test(probe)) return 'intoxication';
    if (/bleed|hemorrhag|blood loss/.test(probe)) return 'bleeding';
    if (/buff|blessing|rested|adrenaline|well-fed|well fed/.test(probe)) return 'buff';
    if (/disease|fever|flu|plague|sick|illness|infect/.test(probe)) return 'disease';
    return 'other';
}

export function normalizeSeverity(raw, defaultVal = 25) {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return clamp(0, 100, Math.round(raw));
    }
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s) return defaultVal;
    const num = Number(s.replace(/%$/, ''));
    if (Number.isFinite(num)) return clamp(0, 100, Math.round(num));
    if (/\b(?:critical|fatal|mortal|shattered|catastrophic)\b/.test(s)) return 90;
    if (/\b(?:severe|deep|heavy|bad|serious|major)\b/.test(s)) return 70;
    if (/\b(?:moderate|medium|painful|significant)\b/.test(s)) return 40;
    if (/\b(?:minor|light|fading|slight|tiny|nick|superficial|healed)\b/.test(s)) return 15;
    return defaultVal;
}

export function recomputePartHp(part) {
    if (!part || typeof part !== 'object') return 100;
    if (part.missing) return 0;
    const conds = Array.isArray(part.conditions) ? part.conditions : [];
    if (part.prosthetic && conds.length === 0) return 100;

    let activePenalty = 0;
    let scarSum = 0;
    for (const c of conds) {
        if (!c) continue;
        const sev = clamp(0, 100, Number(c.severity) || 0);
        if (c.scar || c.kind === 'scar') {
            scarSum += sev;
        } else {
            activePenalty += sev;
        }
    }
    const totalPenalty = activePenalty + Math.min(15, scarSum);
    return clamp(0, 100, Math.round(100 - totalPenalty));
}

function derivePainFromHealth(parts, wholeBody) {
    let raw = 0;
    for (const p of Object.values(parts || {})) {
        if (!p) continue;
        if (p.missing) raw += 25;
        for (const c of p.conditions || []) {
            if (!c || c.scar || c.kind === 'scar') continue;
            const mult = c.kind === 'burn' ? 1.25 : c.kind === 'fracture' ? 1.2 : 1.0;
            const treatFactor = c.treated ? 0.22 : 0.65;
            raw += (Number(c.severity) || 0) * treatFactor * mult;
        }
    }
    for (const wb of wholeBody || []) {
        if (!wb || wb.type === 'buff') continue;
        if (['hypothermia', 'heatstroke', 'toxin', 'disease', 'malnutrition', 'bleeding'].includes(wb.type)) {
            raw += (Number(wb.severity) || 0) * (wb.treated ? 0.10 : 0.25);
        }
    }
    return clamp(0, 100, Math.round(raw));
}

function normalizeConditionEntry(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
        const label = raw.trim();
        if (!label || isEmptySentinel(label)) return null;
        const kind = normalizeConditionKind('', label);
        const scar = kind === 'scar' || /\b(?:scar|healed)\b/i.test(label);
        return {
            kind,
            label,
            severity: scar ? 10 : normalizeSeverity(label, 25),
            bleeding: /\bbleed/i.test(label) && !scar,
            treated: /\b(?:bandaged|treated|stitched|splinted|dressed)\b/i.test(label) && !scar,
            scar,
            note: '',
        };
    }
    if (typeof raw !== 'object') return null;
    const label = String(raw.label || raw.name || raw.desc || '').trim();
    const kind = normalizeConditionKind(raw.kind, label);
    const scar = Boolean(raw.scar) || kind === 'scar';
    const finalLabel = label || CONDITION_LABELS[kind] || 'Condition';
    const severity = normalizeSeverity(raw.severity, scar ? 10 : 25);
    return {
        kind,
        label: finalLabel.slice(0, 90),
        severity,
        bleeding: scar ? false : Boolean(raw.bleeding || kind === 'bleeding'),
        treated: scar ? false : Boolean(raw.treated),
        scar,
        note: String(raw.note || '').trim().slice(0, 140),
    };
}

function normalizeWholeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const label = String(raw.label || raw.name || '').trim();
    if (!label || isEmptySentinel(label)) return null;
    return {
        type: normalizeWholeBodyType(raw.type, label),
        label: label.slice(0, 90),
        severity: normalizeSeverity(raw.severity, 25),
        treated: Boolean(raw.treated),
        note: String(raw.note || '').trim().slice(0, 140),
    };
}

export function normalizeHealthState(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const bodyType = normalizeBodyType(src.bodyType);
    const bloodLoss = clamp(0, 100, Math.round(Number(src.bloodLoss) || 0));

    const wbMap = new Map();
    for (const item of Array.isArray(src.wholeBody) ? src.wholeBody : []) {
        const norm = normalizeWholeEntry(item);
        if (!norm) continue;
        wbMap.set(norm.label.toLowerCase(), norm);
    }
    const wholeBody = [...wbMap.values()];

    const parts = {};
    const rawParts = src.parts && typeof src.parts === 'object' ? src.parts : {};
    for (const [rawId, rawPart] of Object.entries(rawParts)) {
        const partId = normalizeBodyPartId(rawId);
        if (!partId || !rawPart || typeof rawPart !== 'object') continue;
        const condMap = new Map();
        for (const c of Array.isArray(rawPart.conditions) ? rawPart.conditions : []) {
            const nc = normalizeConditionEntry(c);
            if (!nc) continue;
            condMap.set(nc.label.toLowerCase(), nc);
        }
        const conditions = [...condMap.values()];
        const missing = Boolean(rawPart.missing);
        const prosthetic = rawPart.prosthetic && !isEmptySentinel(rawPart.prosthetic)
            ? String(rawPart.prosthetic).trim().slice(0, 80)
            : '';
        const armor = rawPart.armor && !isEmptySentinel(rawPart.armor)
            ? String(rawPart.armor).trim().slice(0, 80)
            : '';
        if (conditions.length === 0 && !missing && !prosthetic && !armor) {
            continue; // Prune empty/healthy parts
        }
        const entry = {
            missing,
            prosthetic,
            armor,
            conditions,
            hp: 100,
        };
        entry.hp = recomputePartHp(entry);
        parts[partId] = entry;
    }

    const hasExplicitPain = src.pain !== undefined && src.pain !== null && src.pain !== '';
    const pain = hasExplicitPain
        ? clamp(0, 100, Math.round(Number(src.pain) || 0))
        : derivePainFromHealth(parts, wholeBody);

    return {
        bodyType,
        bloodLoss,
        pain,
        wholeBody,
        parts,
    };
}

export function hasExplicitHealthData(health) {
    if (!health || typeof health !== 'object') return false;
    if (Object.keys(health.parts || {}).length > 0) return true;
    if (Array.isArray(health.wholeBody) && health.wholeBody.length > 0) return true;
    if ((Number(health.bloodLoss) || 0) > 0) return true;
    if ((Number(health.pain) || 0) > 0) return true;
    if (health.bodyType && health.bodyType !== 'male') return true;
    return false;
}

/**
 * Deterministically apply a health_delta (or full replacement snapshot fields) onto prevHealth.
 */
export function applyHealthDelta(prevHealth, delta = {}) {
    const base = normalizeHealthState(prevHealth);
    if (!delta || typeof delta !== 'object') return base;

    const next = {
        bodyType: delta.bodyType !== undefined ? normalizeBodyType(delta.bodyType) : base.bodyType,
        bloodLoss: delta.bloodLoss !== undefined ? clamp(0, 100, Math.round(Number(delta.bloodLoss) || 0)) : base.bloodLoss,
        pain: base.pain,
        wholeBody: base.wholeBody.map((w) => ({ ...w })),
        parts: Object.fromEntries(
            Object.entries(base.parts).map(([k, p]) => [
                k,
                { ...p, conditions: (p.conditions || []).map((c) => ({ ...c })) },
            ]),
        ),
    };

    const ensurePart = (partId) => {
        if (!next.parts[partId]) {
            next.parts[partId] = { missing: false, prosthetic: '', armor: '', conditions: [], hp: 100 };
        }
        return next.parts[partId];
    };

    if (delta.full_heal === true) {
        next.bloodLoss = 0;
        next.pain = 0;
        next.wholeBody = [];
        for (const [pid, p] of Object.entries(next.parts)) {
            p.conditions = (p.conditions || []).filter((c) => c.scar);
            if (p.conditions.length === 0 && !p.missing && !p.prosthetic && !p.armor) {
                delete next.parts[pid];
            }
        }
    }

    if (delta.tend_all === true) {
        for (const p of Object.values(next.parts)) {
            for (const c of p.conditions || []) {
                if (!c.scar) {
                    c.treated = true;
                    c.bleeding = false;
                }
            }
        }
        for (const wb of next.wholeBody) {
            if (wb.type !== 'buff') wb.treated = true;
        }
    }

    // Direct parts replacement (if provided as full snapshot)
    if (delta.parts && typeof delta.parts === 'object' && !Array.isArray(delta.parts)) {
        next.parts = normalizeHealthState({ bodyType: next.bodyType, parts: delta.parts }).parts;
    }
    if (Array.isArray(delta.wholeBody)) {
        next.wholeBody = normalizeHealthState({ wholeBody: delta.wholeBody }).wholeBody;
    }

    // set_parts (map or array)
    if (delta.set_parts) {
        const entries = Array.isArray(delta.set_parts)
            ? delta.set_parts.map((x) => [x?.part || x?.id, x])
            : Object.entries(delta.set_parts);
        for (const [rawId, spec] of entries) {
            const pid = normalizeBodyPartId(rawId);
            if (!pid || !spec || typeof spec !== 'object') continue;
            const p = ensurePart(pid);
            if (spec.missing !== undefined) p.missing = Boolean(spec.missing);
            if (spec.prosthetic !== undefined) p.prosthetic = isEmptySentinel(spec.prosthetic) ? '' : String(spec.prosthetic || '').trim();
            if (spec.armor !== undefined) p.armor = isEmptySentinel(spec.armor) ? '' : String(spec.armor || '').trim();
            if (Array.isArray(spec.conditions)) {
                p.conditions = spec.conditions.map(normalizeConditionEntry).filter(Boolean);
            }
        }
    }

    // add_conditions (array or single object)
    const adds = Array.isArray(delta.add_conditions)
        ? delta.add_conditions
        : (delta.add_conditions && typeof delta.add_conditions === 'object' ? [delta.add_conditions] : []);
    for (const item of adds) {
        if (!item || typeof item !== 'object') continue;
        const pid = normalizeBodyPartId(item.part || item.partId || item.body_part) || (item.part ? 'torso' : null);
        if (!pid) continue;
        const nc = normalizeConditionEntry(item);
        if (!nc) continue;
        const p = ensurePart(pid);
        const key = nc.label.toLowerCase();
        const existingIdx = p.conditions.findIndex((c) => c.label.toLowerCase() === key);
        if (existingIdx >= 0) p.conditions[existingIdx] = nc;
        else p.conditions.push(nc);
    }

    // patch_conditions
    for (const patch of Array.isArray(delta.patch_conditions) ? delta.patch_conditions : []) {
        if (!patch || typeof patch !== 'object') continue;
        const pid = patch.part ? normalizeBodyPartId(patch.part) : null;
        const needle = String(patch.label || patch.target || '').trim().toLowerCase();
        const targetIds = pid ? [pid] : Object.keys(next.parts);
        for (const tid of targetIds) {
            const p = next.parts[tid];
            if (!p) continue;
            const nextConds = [];
            for (const c of p.conditions || []) {
                const match = !needle || c.label.toLowerCase().includes(needle) || needle.includes(c.label.toLowerCase());
                if (!match) {
                    nextConds.push(c);
                    continue;
                }
                const updated = { ...c };
                if (patch.kind !== undefined) updated.kind = normalizeConditionKind(patch.kind, updated.label);
                if (patch.severity !== undefined) updated.severity = normalizeSeverity(patch.severity, updated.severity);
                if (patch.bleeding !== undefined) updated.bleeding = Boolean(patch.bleeding);
                if (patch.treated !== undefined) updated.treated = Boolean(patch.treated);
                if (patch.scar !== undefined) {
                    updated.scar = Boolean(patch.scar);
                    if (updated.scar) {
                        updated.bleeding = false;
                        updated.treated = false;
                    }
                }
                if (patch.note !== undefined) updated.note = String(patch.note || '').trim();
                if (patch.new_label) updated.label = String(patch.new_label).trim();
                if (updated.severity > 0 || updated.scar) {
                    nextConds.push(updated);
                }
            }
            p.conditions = nextConds;
        }
    }

    // heal_conditions
    for (const rm of Array.isArray(delta.heal_conditions) ? delta.heal_conditions : []) {
        const pid = typeof rm === 'object' && rm?.part ? normalizeBodyPartId(rm.part) : null;
        const needle = String(typeof rm === 'string' ? rm : (rm?.label || '')).trim().toLowerCase();
        const targetIds = pid ? [pid] : Object.keys(next.parts);
        for (const tid of targetIds) {
            const p = next.parts[tid];
            if (!p) continue;
            if (!needle) {
                p.conditions = [];
            } else {
                p.conditions = (p.conditions || []).filter((c) => {
                    const cl = c.label.toLowerCase();
                    return !(cl === needle || cl.includes(needle) || needle.includes(cl));
                });
            }
        }
    }

    // whole_body_upsert / whole_body_remove
    for (const wb of Array.isArray(delta.whole_body_upsert) ? delta.whole_body_upsert : []) {
        const norm = normalizeWholeEntry(wb);
        if (!norm) continue;
        const idx = next.wholeBody.findIndex((x) => x.label.toLowerCase() === norm.label.toLowerCase());
        if (idx >= 0) next.wholeBody[idx] = norm;
        else next.wholeBody.push(norm);
    }
    for (const rm of Array.isArray(delta.whole_body_remove) ? delta.whole_body_remove : []) {
        const needle = String(typeof rm === 'string' ? rm : (rm?.label || '')).trim().toLowerCase();
        if (!needle) continue;
        next.wholeBody = next.wholeBody.filter((x) => {
            const xl = x.label.toLowerCase();
            return !(xl === needle || xl.includes(needle));
        });
    }

    // Recompute part HPs, prune healthy empty parts, and compute pain unless explicitly specified
    for (const [pid, p] of Object.entries(next.parts)) {
        if ((p.conditions || []).length === 0 && !p.missing && !p.prosthetic && !p.armor) {
            delete next.parts[pid];
        } else {
            p.hp = recomputePartHp(p);
        }
    }

    if (delta.pain !== undefined && delta.pain !== null && delta.pain !== '') {
        next.pain = clamp(0, 100, Math.round(Number(delta.pain) || 0));
    } else if (!delta.full_heal) {
        next.pain = derivePainFromHealth(next.parts, next.wholeBody);
    }

    return next;
}

/**
 * Non-destructive heuristic preview from legacy <state:inv><status> text when
 * `state.health` has no explicit records yet.
 */
export function inferHealthFromStatusText(statusText, bodyType = 'male') {
    const base = { bodyType: normalizeBodyType(bodyType), bloodLoss: 0, pain: 0, wholeBody: [], parts: {}, inferred: false };
    const clean = String(statusText || '').trim();
    if (!clean || isEmptySentinel(clean)) return base;

    const injuryWordRe = /\b(bruise[ds]?|cut|slash(?:ed)?|stab(?:bed)?|gash(?:ed)?|wound(?:ed)?|nick(?:ed)?|scratch(?:ed)?|lacerat(?:ion|ed)|bleed(?:ing)?|burn(?:ed|t|s)?|scald(?:ed)?|blister(?:ed)?|frostbite|fractur(?:ed|e)?|broken|sprain(?:ed)?|dislocat(?:ed)?|scar(?:red|s)?|bite|bitten|concuss(?:ion|ed)|swollen|swelling|ache|aching|sore|numb)\b/i;

    const clauses = clean.split(/[;,.]+/).map((c) => c.trim()).filter(Boolean);
    const delta = { add_conditions: [], whole_body_upsert: [] };
    let matched = false;

    for (const clause of clauses) {
        const low = clause.toLowerCase();
        if (/\b(?:healthy|unharmed|uninjured|warm,\s*well-fed)\b/i.test(low)) continue;

        if (injuryWordRe.test(low)) {
            const isHealed = /\b(?:healed|old)\b/i.test(low);
            const isFading = /\b(?:fading|minor|light|slight|small|nick)\b/i.test(low);
            const isSevere = /\b(?:severe|deep|heavy|bad|critical|broken|fractur|shatter)\b/i.test(low);
            let pid = normalizeBodyPartId(low);
            if (!pid && /\bconcuss/i.test(low)) pid = 'head';
            if (!pid && /\b(?:bleeding|wound(?:ed)?|slashed|stabbed)\b/i.test(low)) pid = 'torso';
            if (pid) {
                const kind = isHealed ? 'scar' : normalizeConditionKind('', low);
                const sev = isHealed ? 8 : isFading ? 15 : isSevere ? 65 : 30;
                delta.add_conditions.push({
                    part: pid,
                    kind,
                    label: clause.slice(0, 72),
                    severity: sev,
                    bleeding: /\bbleed/i.test(low) && !isHealed,
                    treated: /\b(?:bandaged|wrapped|splinted|treated|stitched)\b/i.test(low) && !isHealed,
                    scar: isHealed || kind === 'scar',
                });
                matched = true;
            }
        }

        if (/\b(?:poison(?:ed|ing)?|venom(?:ed)?|toxic)\b/i.test(low)) {
            delta.whole_body_upsert.push({ type: 'toxin', label: clause.slice(0, 60), severity: 35 });
            matched = true;
        } else if (/\b(?:fever|infected|infection|plague|sick)\b/i.test(low)) {
            delta.whole_body_upsert.push({ type: 'disease', label: clause.slice(0, 60), severity: 35 });
            matched = true;
        } else if (/\b(?:hypothermi(?:a|c)|freezing)\b/i.test(low)) {
            delta.whole_body_upsert.push({ type: 'hypothermia', label: clause.slice(0, 60), severity: 35 });
            matched = true;
        } else if (/\b(?:heatstroke|overheated)\b/i.test(low)) {
            delta.whole_body_upsert.push({ type: 'heatstroke', label: clause.slice(0, 60), severity: 35 });
            matched = true;
        } else if (/\b(?:exhaust(?:ed|ion)|fatigued)\b/i.test(low)) {
            delta.whole_body_upsert.push({ type: 'exhaustion', label: clause.slice(0, 60), severity: 30 });
            matched = true;
        } else if (/\b(?:malnourish(?:ed|ment)|starving)\b/i.test(low)) {
            delta.whole_body_upsert.push({ type: 'malnutrition', label: clause.slice(0, 60), severity: 35 });
            matched = true;
        } else if (/\b(?:intoxicat(?:ed|ion)|drunk)\b/i.test(low)) {
            delta.whole_body_upsert.push({ type: 'intoxication', label: clause.slice(0, 60), severity: 25 });
            matched = true;
        }
    }

    if (!matched) return base;
    const inferredState = applyHealthDelta(base, delta);
    inferredState.inferred = true;
    return inferredState;
}

/** Compute overall HP, vital labels, wound counts, and 7 RimWorld-style physiological capacities. */
export function computeHealthMetrics(health) {
    const h = normalizeHealthState(health);
    const parts = h.parts || {};
    const hpOf = (id) => (parts[id] ? Number(parts[id].hp) : 100);

    let weightedSum = 0;
    let totalWeight = 0;
    let totalWounds = 0;
    let bleedingCount = 0;
    let untreatedCount = 0;
    let scarCount = 0;
    let missingCount = 0;
    let prostheticCount = 0;
    let internalIssues = 0;

    for (const bp of BODY_PARTS) {
        const rec = parts[bp.id];
        const hp = rec ? Number(rec.hp) : 100;
        weightedSum += hp * bp.vitalWeight;
        totalWeight += bp.vitalWeight;
        if (!rec) continue;
        if (rec.missing) missingCount++;
        if (rec.prosthetic) prostheticCount++;
        const conds = rec.conditions || [];
        for (const c of conds) {
            if (c.scar) {
                scarCount++;
            } else {
                totalWounds++;
                if (c.bleeding) bleedingCount++;
                if (!c.treated) untreatedCount++;
            }
        }
        if ((bp.layer === 'organs' || bp.layer === 'bones') && (conds.length > 0 || rec.missing || rec.prosthetic)) {
            internalIssues++;
        }
    }

    const overallHp = totalWeight > 0 ? clamp(0, 100, Math.round(weightedSum / totalWeight)) : 100;
    const pain = clamp(0, 100, Number(h.pain) || 0);
    const bloodLoss = clamp(0, 100, Number(h.bloodLoss) || 0);

    const painLabel = pain >= 75 ? 'Shock'
        : pain >= 45 ? 'Severe'
        : pain >= 20 ? 'Medium'
        : pain > 0 ? 'Minor'
        : 'None';

    const bleedingLevel = (bloodLoss >= 60 || bleedingCount >= 4) ? 'Critical'
        : (bloodLoss >= 35 || bleedingCount >= 2) ? 'Heavy'
        : bloodLoss >= 15 ? 'Moderate'
        : bleedingCount > 0 ? 'Active Bleed'
        : bloodLoss > 0 ? 'Light'
        : 'None';

    let wbGlobalPen = 0;
    let wbBreathPen = 0;
    let wbMovePen = 0;
    let wbMetabPen = 0;
    for (const wb of h.wholeBody || []) {
        if (!wb || wb.type === 'buff') continue;
        const sev = Number(wb.severity) || 0;
        if (['hypothermia', 'heatstroke', 'intoxication', 'exhaustion'].includes(wb.type)) {
            wbGlobalPen += sev * 0.3;
        }
        if (wb.type === 'hypothermia' || wb.type === 'toxin') wbBreathPen += sev * 0.25;
        if (wb.type === 'exhaustion' || wb.type === 'hypothermia') wbMovePen += sev * 0.25;
        if (['malnutrition', 'toxin', 'disease'].includes(wb.type)) wbMetabPen += sev * 0.35;
    }

    const sight = clamp(0, 100, Math.round((hpOf('left_eye') + hpOf('right_eye')) / 2));
    const breathing = clamp(0, 100, Math.round(
        ((hpOf('left_lung') + hpOf('right_lung')) / 2) * 0.7
        + (hpOf('ribcage') * 0.15)
        + (hpOf('neck') * 0.15)
        - wbBreathPen,
    ));
    const bloodPumping = clamp(0, 100, Math.round(hpOf('heart') * 0.8 + hpOf('torso') * 0.2 - bloodLoss * 0.65));
    const moving = clamp(0, 100, Math.round(
        ((hpOf('left_leg') + hpOf('right_leg')) * 0.28
        + (hpOf('left_foot') + hpOf('right_foot')) * 0.12
        + hpOf('spine') * 0.12
        + hpOf('pelvis') * 0.08)
        - pain * 0.22
        - wbMovePen,
    ));
    const manipulation = clamp(0, 100, Math.round(
        ((hpOf('left_hand') + hpOf('right_hand')) * 0.24
        + (hpOf('left_arm') + hpOf('right_arm')) * 0.16
        + (hpOf('left_shoulder') + hpOf('right_shoulder')) * 0.10)
        - pain * 0.18,
    ));
    const metabolism = clamp(0, 100, Math.round(
        (hpOf('stomach') * 0.3 + hpOf('liver') * 0.35 + (hpOf('left_kidney') + hpOf('right_kidney')) * 0.175)
        - wbMetabPen,
    ));
    const consciousness = clamp(0, 100, Math.round(
        Math.min(
            hpOf('brain'),
            100 - pain * 0.4 - bloodLoss * 0.5 - wbGlobalPen,
            Math.max(0, bloodPumping + 25),
            Math.max(0, breathing + 25),
        ),
    ));

    return {
        overallHp,
        pain,
        painLabel,
        bloodLoss,
        bleedingLevel,
        totalWounds,
        bleedingCount,
        untreatedCount,
        scarCount,
        missingCount,
        prostheticCount,
        internalIssues,
        capacities: {
            consciousness,
            moving,
            manipulation,
            breathing,
            bloodPumping,
            sight,
            metabolism,
        },
    };
}

// ── Vector Silhouette & Anatomy Geometry (viewBox 0 0 260 480) ────────────────

function getBodyPaths(bodyType) {
    const bt = normalizeBodyType(bodyType);
    const torsoPaths = {
        male: 'M86,100 Q130,93 174,100 L166,184 Q165,212 166,248 L134,254 L130,242 L126,254 L94,248 Q95,212 94,184 Z',
        female: 'M92,102 Q130,96 168,102 L156,162 Q151,182 168,216 L165,250 L134,255 L130,244 L126,255 L95,250 L92,216 Q109,182 104,162 Z',
        athletic: 'M80,98 Q130,90 180,98 L162,174 Q158,206 162,248 L134,254 L130,242 L126,254 L98,248 Q102,206 98,174 Z',
        heavy: 'M78,100 Q130,91 182,100 Q190,165 182,232 L172,254 L135,258 L130,245 L125,258 L88,254 Q70,165 78,100 Z',
    };
    const shRx = bt === 'heavy' ? 22 : bt === 'athletic' ? 20 : bt === 'female' ? 14 : 18;
    const armRx = bt === 'heavy' ? 15 : bt === 'female' ? 9.5 : 12;
    const legW = bt === 'heavy' ? 25 : bt === 'female' ? 19 : 21;
    const neckW = bt === 'heavy' ? 30 : bt === 'female' ? 20 : 24;

    const headR = bt === 'female' ? 25 : 27;
    const headShape = `<ellipse cx="130" cy="48" rx="${headR}" ry="31" />`;
    const neckShape = `<rect x="${130 - neckW / 2}" y="72" width="${neckW}" height="32" rx="7" />`;

    const torsoShape = `<path d="${torsoPaths[bt]}" />`;
    const rShoulderShape = `<ellipse cx="80" cy="112" rx="${shRx}" ry="16" transform="rotate(-14 80 112)" />`;
    const lShoulderShape = `<ellipse cx="180" cy="112" rx="${shRx}" ry="16" transform="rotate(14 180 112)" />`;

    const rArmShape = `<rect x="${64 - armRx}" y="122" width="${armRx * 2}" height="96" rx="${armRx}" transform="rotate(7 64 170)" />`;
    const lArmShape = `<rect x="${196 - armRx}" y="122" width="${armRx * 2}" height="96" rx="${armRx}" transform="rotate(-7 196 170)" />`;

    const rHandShape = `<ellipse cx="52" cy="236" rx="11" ry="18" transform="rotate(6 52 236)" />`;
    const lHandShape = `<ellipse cx="208" cy="236" rx="11" ry="18" transform="rotate(-6 208 236)" />`;

    const rLegShape = `<path d="M90,248 L124,250 L114,422 L92,422 Q86,336 ${103 - legW} ,285 Z" />`;
    const lLegShape = `<path d="M136,250 L170,248 Q${157 + legW},285 168,422 L146,422 Z" />`;

    const rFootShape = `<path d="M90,420 L114,420 L114,442 Q96,448 76,444 Q74,433 90,420 Z" />`;
    const lFootShape = `<path d="M146,420 L170,420 Q186,433 184,444 Q164,448 146,442 Z" />`;

    const rEyeShape = `<ellipse cx="118" cy="47" rx="6" ry="3.8" />`;
    const lEyeShape = `<ellipse cx="142" cy="47" rx="6" ry="3.8" />`;

    return {
        head: headShape,
        neck: neckShape,
        torso: torsoShape,
        right_shoulder: rShoulderShape,
        left_shoulder: lShoulderShape,
        right_arm: rArmShape,
        left_arm: lArmShape,
        right_hand: rHandShape,
        left_hand: lHandShape,
        right_leg: rLegShape,
        left_leg: lLegShape,
        right_foot: rFootShape,
        left_foot: lFootShape,
        right_eye: rEyeShape,
        left_eye: lEyeShape,
    };
}

const ORGAN_SHAPES = Object.freeze({
    brain: '<path d="M112,38 Q112,21 130,21 Q148,21 148,38 Q147,50 130,50 Q113,50 112,38 Z" />',
    right_lung: '<path d="M124,108 Q103,110 98,136 Q96,158 118,158 Q125,156 125,134 Z" />',
    left_lung: '<path d="M136,108 Q157,110 162,136 Q164,158 142,158 Q135,156 135,134 Z" />',
    heart: '<path d="M131,128 Q138,120 144,128 Q149,138 138,150 Q125,142 131,128 Z" />',
    liver: '<path d="M100,164 Q122,160 130,170 Q124,186 102,184 Q96,174 100,164 Z" />',
    stomach: '<path d="M134,164 Q154,162 156,178 Q154,192 136,188 Q128,176 134,164 Z" />',
    right_kidney: '<ellipse cx="110" cy="202" rx="8" ry="12" transform="rotate(-10 110 202)" />',
    left_kidney: '<ellipse cx="150" cy="202" rx="8" ry="12" transform="rotate(10 150 202)" />',
});

const BONE_SHAPES = Object.freeze({
    skull: '<path d="M109,42 Q109,20 130,20 Q151,20 151,42 Q151,58 140,66 L140,74 L120,74 L120,66 Q109,58 109,42 Z" />',
    spine: '<rect x="125" y="78" width="10" height="148" rx="4" />',
    ribcage: '<path d="M102,110 Q130,104 158,110 L154,166 Q130,160 106,166 Z M105,124 L155,124 M106,138 L154,138 M107,152 L153,152" />',
    pelvis: '<path d="M98,218 Q130,226 162,218 L158,246 Q130,238 102,246 Z" />',
});

function partStatusStyle(rec) {
    if (!rec) {
        return { fill: '#1f2534', stroke: '#4b5563', opacity: 1, statusClass: 'healthy' };
    }
    if (rec.missing) {
        return { fill: 'rgba(15, 23, 42, 0.25)', stroke: '#ef4444', opacity: 0.75, statusClass: 'missing' };
    }
    if (rec.prosthetic && (!rec.conditions || rec.conditions.length === 0)) {
        return { fill: '#1f4e5f', stroke: '#38bdf8', opacity: 1, statusClass: 'prosthetic' };
    }
    const hp = Number(rec.hp ?? 100);
    if (hp < 20) return { fill: '#7f1d1d', stroke: '#ff3b5c', opacity: 1, statusClass: 'critical' };
    if (hp < 50) return { fill: '#991b1b', stroke: '#f87171', opacity: 1, statusClass: 'severe' };
    if (hp < 80) return { fill: '#9a3412', stroke: '#fb923c', opacity: 1, statusClass: 'moderate' };
    if (hp < 100) return { fill: '#854d0e', stroke: '#facc15', opacity: 1, statusClass: 'minor' };
    return { fill: '#1f2534', stroke: '#4b5563', opacity: 1, statusClass: 'healthy' };
}

function renderMiniBadgeGlyph(rec, cx, cy) {
    if (!rec) return '';
    const conds = rec.conditions || [];
    const hasBleed = conds.some((c) => c.bleeding);
    const hasTreated = conds.some((c) => c.treated);
    const hasFracture = conds.some((c) => c.kind === 'fracture');
    const hasBurn = conds.some((c) => c.kind === 'burn');
    const hasFrost = conds.some((c) => c.kind === 'frost');
    const hasSharp = conds.some((c) => c.kind === 'sharp');
    const hasInf = conds.some((c) => c.kind === 'infection');
    const hasTox = conds.some((c) => c.kind === 'toxin');
    const hasBlunt = conds.some((c) => c.kind === 'blunt');

    const badges = [];
    if (rec.missing) {
        badges.push(`
            <circle cx="${cx}" cy="${cy}" r="8" fill="#181116" stroke="#ef4444" stroke-width="1.5" />
            <path d="M${cx - 3.8},${cy - 3.8} L${cx + 3.8},${cy + 3.8} M${cx + 3.8},${cy - 3.8} L${cx - 3.8},${cy + 3.8}" stroke="#fca5a5" stroke-width="1.8" stroke-linecap="round" />
        `);
    } else if (rec.prosthetic) {
        badges.push(`
            <circle cx="${cx}" cy="${cy}" r="7" fill="#0d222e" stroke="#38bdf8" stroke-width="1.4" />
            <polygon points="${cx},${cy - 4} ${cx + 4},${cy} ${cx},${cy + 4} ${cx - 4},${cy}" fill="#7dd3fc" />
        `);
    }

    if (hasBleed) {
        const bx = rec.missing || rec.prosthetic ? cx + 9 : cx;
        badges.push(`
            <g class="vse-doll-bleed-badge">
                <circle cx="${bx}" cy="${cy}" r="7" fill="#2a0a0d" stroke="#ef4444" stroke-width="1.2" />
                <path d="M${bx},${cy - 4.5} C${bx + 3.5},${cy - 0.5} ${bx + 3.5},${cy + 4} ${bx},${cy + 4} C${bx - 3.5},${cy + 4} ${bx - 3.5},${cy - 0.5} ${bx},${cy - 4.5} Z" fill="#ef4444" />
            </g>
        `);
    } else if (hasFracture) {
        badges.push(`
            <circle cx="${cx}" cy="${cy}" r="7" fill="#292108" stroke="#fde047" stroke-width="1.2" />
            <path d="M${cx - 3},${cy - 4} L${cx + 1},${cy - 0.5} L${cx - 1.5},${cy + 1} L${cx + 3},${cy + 4}" fill="none" stroke="#fde047" stroke-width="1.5" stroke-linecap="round" />
        `);
    } else if (hasBurn) {
        badges.push(`
            <circle cx="${cx}" cy="${cy}" r="7" fill="#2a1506" stroke="#fb923c" stroke-width="1.2" />
            <path d="M${cx},${cy - 4.5} Q${cx + 4},${cy} ${cx},${cy + 4.2} Q${cx - 4},${cy} ${cx},${cy - 4.5} Z" fill="#fb923c" />
        `);
    } else if (hasFrost) {
        badges.push(`
            <circle cx="${cx}" cy="${cy}" r="7" fill="#0b2230" stroke="#38bdf8" stroke-width="1.2" />
            <path d="M${cx},${cy - 4} L${cx},${cy + 4} M${cx - 4},${cy} L${cx + 4},${cy}" stroke="#7dd3fc" stroke-width="1.5" />
        `);
    } else if (hasInf || hasTox) {
        const col = hasInf ? '#84cc16' : '#c084fc';
        badges.push(`
            <circle cx="${cx}" cy="${cy}" r="7" fill="#171424" stroke="${col}" stroke-width="1.2" />
            <circle cx="${cx}" cy="${cy}" r="3" fill="${col}" />
        `);
    } else if (hasSharp) {
        badges.push(`
            <circle cx="${cx}" cy="${cy}" r="7" fill="#260c0f" stroke="#f87171" stroke-width="1.2" />
            <path d="M${cx - 3.5},${cy + 3.5} L${cx + 3.5},${cy - 3.5}" stroke="#fca5a5" stroke-width="1.8" stroke-linecap="round" />
        `);
    } else if (hasBlunt) {
        badges.push(`
            <circle cx="${cx}" cy="${cy}" r="7" fill="#271907" stroke="#f59e0b" stroke-width="1.2" />
            <circle cx="${cx}" cy="${cy}" r="3.2" fill="#fbbf24" />
        `);
    }

    if (hasTreated) {
        const tx = badges.length > 0 ? cx + 10 : cx;
        const ty = badges.length > 0 ? cy - 8 : cy;
        badges.push(`
            <circle cx="${tx}" cy="${ty}" r="6" fill="#0d261a" stroke="#4ade80" stroke-width="1.1" />
            <path d="M${tx},${ty - 3} L${tx},${ty + 3} M${tx - 3},${ty} L${tx + 3},${ty}" stroke="#86efac" stroke-width="1.5" />
        `);
    }

    return badges.join('');
}

/**
 * Render an interactive SVG paper-doll inspired by Nice Health Tab.
 */
export function renderHealthDollSvg(health, { layer = 'body', selectedPart = null, compact = false } = {}) {
    const h = normalizeHealthState(health);
    const activeLayer = HEALTH_LAYERS.includes(layer) ? layer : 'body';
    const uid = `nh${++svgUidSeq}`;
    const bodyShapes = getBodyPaths(h.bodyType);
    const metrics = computeHealthMetrics(h);

    const defs = `
        <defs>
            <pattern id="vse-pat-bandage-${uid}" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
                <rect width="12" height="12" fill="rgba(241,245,249,0.12)" />
                <line x1="0" y1="3" x2="12" y2="3" stroke="rgba(248,250,252,0.72)" stroke-width="3.2" />
                <line x1="0" y1="9" x2="12" y2="9" stroke="rgba(203,213,225,0.45)" stroke-width="2" />
            </pattern>
            <pattern id="vse-pat-scar-${uid}" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
                <line x1="2" y1="7" x2="12" y2="7" stroke="rgba(226,232,240,0.68)" stroke-width="1.6" stroke-linecap="round" />
                <line x1="6" y1="3" x2="8" y2="11" stroke="rgba(203,213,225,0.45)" stroke-width="1.1" />
            </pattern>
            <pattern id="vse-pat-sharp-${uid}" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(-42)">
                <line x1="1" y1="6" x2="11" y2="6" stroke="rgba(252,165,165,0.8)" stroke-width="1.8" stroke-linecap="round" />
            </pattern>
            <pattern id="vse-pat-burn-${uid}" width="10" height="10" patternUnits="userSpaceOnUse">
                <circle cx="3" cy="3" r="1.7" fill="rgba(253,186,116,0.55)" />
                <circle cx="8" cy="8" r="1.4" fill="rgba(251,146,60,0.45)" />
            </pattern>
            <pattern id="vse-pat-frost-${uid}" width="12" height="12" patternUnits="userSpaceOnUse">
                <path d="M6,1 L6,11 M1,6 L11,6" stroke="rgba(186,230,253,0.55)" stroke-width="1.1" />
            </pattern>
            <pattern id="vse-pat-prosthetic-${uid}" width="8" height="8" patternUnits="userSpaceOnUse">
                <path d="M0,4 L8,4 M4,0 L4,8" stroke="rgba(125,211,252,0.34)" stroke-width="0.9" />
            </pattern>
        </defs>
    `;

    const renderPartGroup = (bp, shapeMarkup, { ghostOnly = false } = {}) => {
        const rec = h.parts[bp.id] || null;
        const st = partStatusStyle(rec);
        const isSel = selectedPart === bp.id;
        const conds = rec?.conditions || [];
        const condSummary = conds.length ? ` — ${conds.map((c) => `${c.label} (${c.severity}%)`).join(', ')}` : '';
        const title = `${bp.label}: ${rec?.missing ? 'Missing' : `${rec ? rec.hp : 100}% HP`}${rec?.prosthetic ? ` [${rec.prosthetic}]` : ''}${condSummary}`;

        if (ghostOnly) {
            return `<g class="vse-doll-ghost">${shapeMarkup}</g>`;
        }

        const clipId = `vse-clip-${bp.id}-${uid}`;
        const overlays = [];
        if (rec?.prosthetic && !rec.missing) {
            overlays.push(`<rect x="0" y="0" width="260" height="480" fill="url(#vse-pat-prosthetic-${uid})" clip-path="url(#${clipId})" />`);
        }
        if (conds.some((c) => c.scar || c.kind === 'scar')) {
            overlays.push(`<rect x="0" y="0" width="260" height="480" fill="url(#vse-pat-scar-${uid})" clip-path="url(#${clipId})" />`);
        }
        if (conds.some((c) => (c.kind === 'sharp' || c.kind === 'bleeding') && !c.scar)) {
            overlays.push(`<rect x="0" y="0" width="260" height="480" fill="url(#vse-pat-sharp-${uid})" clip-path="url(#${clipId})" />`);
        }
        if (conds.some((c) => c.kind === 'burn' && !c.scar)) {
            overlays.push(`<rect x="0" y="0" width="260" height="480" fill="url(#vse-pat-burn-${uid})" clip-path="url(#${clipId})" />`);
        }
        if (conds.some((c) => c.kind === 'frost' && !c.scar)) {
            overlays.push(`<rect x="0" y="0" width="260" height="480" fill="url(#vse-pat-frost-${uid})" clip-path="url(#${clipId})" />`);
        }
        if (conds.some((c) => c.treated && !c.scar)) {
            overlays.push(`<rect x="0" y="0" width="260" height="480" fill="url(#vse-pat-bandage-${uid})" clip-path="url(#${clipId})" />`);
        }

        const dashAttr = rec?.missing ? 'stroke-dasharray="4 3"' : '';
        const classes = [
            'vse-doll-part',
            `is-${st.statusClass}`,
            isSel ? 'is-selected' : '',
            conds.some((c) => c.bleeding) ? 'is-bleeding' : '',
        ].filter(Boolean).join(' ');

        return `
            <g class="${classes}" data-part-id="${esc(bp.id)}" tabindex="0">
                <title>${esc(title)}</title>
                <clipPath id="${clipId}">${shapeMarkup}</clipPath>
                <g fill="${st.fill}" stroke="${isSel ? '#facc15' : st.stroke}" stroke-width="${isSel ? '2.4' : '1.4'}" opacity="${st.opacity}" ${dashAttr}>
                    ${shapeMarkup}
                </g>
                ${overlays.join('')}
                ${renderMiniBadgeGlyph(rec, bp.cx, bp.cy)}
            </g>
        `;
    };

    const exteriorParts = BODY_PARTS.filter((bp) => bp.layer === 'body');
    const organParts = BODY_PARTS.filter((bp) => bp.layer === 'organs');
    const boneParts = BODY_PARTS.filter((bp) => bp.layer === 'bones');

    // Render body silhouette either interactively ('body') or as translucent background ('organs'/'bones'/'xray')
    const exteriorOrder = [
        'right_shoulder', 'left_shoulder', 'right_arm', 'left_arm',
        'right_hand', 'left_hand', 'right_leg', 'left_leg',
        'right_foot', 'left_foot', 'neck', 'torso', 'head', 'right_eye', 'left_eye',
    ];
    const exteriorMarkup = exteriorOrder.map((id) => {
        const bp = BODY_PART_BY_ID[id];
        return renderPartGroup(bp, bodyShapes[id] || '', { ghostOnly: activeLayer !== 'body' });
    }).join('');

    const bonesMarkup = (activeLayer === 'bones' || activeLayer === 'xray')
        ? boneParts.map((bp) => renderPartGroup(bp, BONE_SHAPES[bp.id] || '')).join('')
        : '';

    const organsMarkup = (activeLayer === 'organs' || activeLayer === 'xray')
        ? organParts.map((bp) => renderPartGroup(bp, ORGAN_SHAPES[bp.id] || '')).join('')
        : '';

    // Internal injury indicator on 'body' layer if organs or bones are damaged
    const internalAlertBadge = (activeLayer === 'body' && metrics.internalIssues > 0)
        ? `<g class="vse-doll-internal-alert" data-layer-jump="xray" style="cursor:pointer;">
            <title>${metrics.internalIssues} internal organ/bone condition(s) — switch to Organs/Bones/X-Ray</title>
            <circle cx="130" cy="144" r="10" fill="rgba(220,38,38,0.86)" stroke="#fecaca" stroke-width="1.4" />
            <path d="M130,139 L130,149 M125,144 L135,144" stroke="#ffffff" stroke-width="2" stroke-linecap="round" />
        </g>`
        : '';

    const cls = compact ? 'vse-doll-svg compact' : 'vse-doll-svg';
    return `
        <svg class="${cls}" viewBox="0 0 260 468" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Persona Body Health Doll">
            ${defs}
            <g opacity="0.16" stroke="currentColor" stroke-width="0.6">
                <line x1="130" y1="8" x2="130" y2="460" stroke-dasharray="3 4" />
                <line x1="16" y1="100" x2="244" y2="100" stroke-dasharray="2 5" />
                <line x1="16" y1="248" x2="244" y2="248" stroke-dasharray="2 5" />
            </g>
            ${exteriorMarkup}
            ${bonesMarkup}
            ${organsMarkup}
            ${internalAlertBadge}
        </svg>
    `;
}

function barColorClass(pct, { invert = false } = {}) {
    const val = invert ? (100 - pct) : pct;
    if (val >= 80) return 'ok';
    if (val >= 50) return 'mid';
    if (val >= 25) return 'warn';
    return 'crit';
}

function renderConditionRow(partId, cond, idx, { showActions = false } = {}) {
    const color = CONDITION_COLORS[cond.kind] || CONDITION_COLORS.other;
    const partLabel = BODY_PART_BY_ID[partId]?.label || partId;
    const badges = [
        `<span class="vse-health-kind-pill" style="border-color:${color};color:${color};">${esc(CONDITION_LABELS[cond.kind] || cond.kind)}</span>`,
        cond.scar ? `<span class="vse-pill">Scar</span>` : '',
        cond.bleeding ? `<span class="vse-pill vse-pill-bleed">Bleeding</span>` : '',
        cond.treated ? `<span class="vse-pill ok">Bandaged</span>` : '',
        `<span class="vse-pill">${esc(cond.severity)}%</span>`,
    ].filter(Boolean).join('');

    const actions = showActions
        ? `<div class="vse-health-cond-actions">
            ${!cond.treated && !cond.scar ? `<button type="button" class="vse-mini-btn vse-health-treat-btn" data-part-id="${esc(partId)}" data-cond-idx="${idx}" title="Bandage / Treat"><i class="fa-solid fa-bandage"></i> Treat</button>` : ''}
            ${!cond.scar ? `<button type="button" class="vse-mini-btn vse-health-scar-btn" data-part-id="${esc(partId)}" data-cond-idx="${idx}" title="Convert to permanent scar"><i class="fa-solid fa-bolt-lightning"></i> Scar</button>` : ''}
            <button type="button" class="vse-mini-btn vse-health-heal-btn" data-part-id="${esc(partId)}" data-cond-idx="${idx}" title="Remove / Heal condition"><i class="fa-solid fa-check"></i> Heal</button>
        </div>`
        : '';

    return `
        <div class="vse-health-cond-card" style="border-left:3px solid ${color};">
            <div class="vse-health-cond-head">
                <button type="button" class="vse-health-part-chip" data-part-id="${esc(partId)}">${esc(partLabel)}</button>
                <strong>${esc(cond.label)}</strong>
                ${badges}
            </div>
            ${cond.note ? `<div class="vse-line">${esc(cond.note)}</div>` : ''}
            ${actions}
        </div>
    `;
}

/**
 * Render the complete 2-column Nice Health Tab panel (SVG doll + gauges + capacities + conditions).
 */
export function renderHealthTab(state, {
    layer = 'body',
    selectedPart = null,
    bodyTypeOverride = null,
    compact = false,
    showActions = false,
} = {}) {
    const rawHealth = state?.health;
    const explicit = hasExplicitHealthData(rawHealth);
    const effective = explicit
        ? normalizeHealthState({
            ...rawHealth,
            bodyType: rawHealth?.bodyType || bodyTypeOverride || 'male',
        })
        : inferHealthFromStatusText(state?.inv?.status || '', bodyTypeOverride || rawHealth?.bodyType || 'male');

    const isInferred = !explicit && Boolean(effective.inferred);
    const metrics = computeHealthMetrics(effective);
    const activeLayer = HEALTH_LAYERS.includes(layer) ? layer : 'body';

    const layerButtons = [
        { id: 'body', label: 'Body', icon: 'fa-person' },
        { id: 'organs', label: 'Organs', icon: 'fa-heart-pulse' },
        { id: 'bones', label: 'Bones', icon: 'fa-bone' },
        { id: 'xray', label: 'X-Ray', icon: 'fa-x-ray' },
    ].map((l) => `
        <button type="button" class="vse-health-layer-btn ${l.id === activeLayer ? 'active' : ''}" data-health-layer="${l.id}">
            <i class="fa-solid ${l.icon}"></i> ${l.label}
        </button>
    `).join('');

    const dollSvg = renderHealthDollSvg(effective, { layer: activeLayer, selectedPart, compact });

    const capItems = [
        ['Consciousness', metrics.capacities.consciousness],
        ['Moving', metrics.capacities.moving],
        ['Manipulation', metrics.capacities.manipulation],
        ['Breathing', metrics.capacities.breathing],
        ['Blood Pumping', metrics.capacities.bloodPumping],
        ['Sight', metrics.capacities.sight],
        ['Metabolism', metrics.capacities.metabolism],
    ];

    const selectedInfo = selectedPart && BODY_PART_BY_ID[selectedPart]
        ? { part: BODY_PART_BY_ID[selectedPart], rec: effective.parts[selectedPart] || null }
        : null;

    const partRows = [];
    if (selectedInfo) {
        const { part, rec } = selectedInfo;
        const hp = rec ? rec.hp : 100;
        const condCards = (rec?.conditions || []).length
            ? rec.conditions.map((c, idx) => renderConditionRow(part.id, c, idx, { showActions })).join('')
            : `<div class="vse-empty">${rec?.missing ? 'Body part is missing.' : rec?.prosthetic ? `Replaced with ${esc(rec.prosthetic)}.` : 'No injuries or conditions on this body part.'}</div>`;
        partRows.push(`
            <div class="vse-health-selected-head">
                <strong>${esc(part.label)}</strong>
                <span class="vse-pill ${barColorClass(hp)}">${rec?.missing ? 'Missing (0%)' : `${hp}% HP`}</span>
                ${rec?.prosthetic ? `<span class="vse-pill">${esc(rec.prosthetic)}</span>` : ''}
                ${rec?.armor ? `<span class="vse-pill"><i class="fa-solid fa-shield"></i> ${esc(rec.armor)}</span>` : ''}
                <button type="button" class="vse-mini-btn vse-health-clear-sel" style="margin-left:auto;">Show All</button>
            </div>
            <div class="vse-stack">${condCards}</div>
        `);
    } else {
        const allCards = [];
        for (const bp of BODY_PARTS) {
            const rec = effective.parts[bp.id];
            if (!rec) continue;
            if (rec.missing) {
                allCards.push(`
                    <div class="vse-health-cond-card" style="border-left:3px solid #ef4444;">
                        <div class="vse-health-cond-head">
                            <button type="button" class="vse-health-part-chip" data-part-id="${esc(bp.id)}">${esc(bp.label)}</button>
                            <strong>Missing Body Part</strong>
                            <span class="vse-pill vse-pill-bleed">0% HP</span>
                        </div>
                    </div>
                `);
            } else if (rec.prosthetic && (!rec.conditions || rec.conditions.length === 0)) {
                allCards.push(`
                    <div class="vse-health-cond-card" style="border-left:3px solid #38bdf8;">
                        <div class="vse-health-cond-head">
                            <button type="button" class="vse-health-part-chip" data-part-id="${esc(bp.id)}">${esc(bp.label)}</button>
                            <strong>${esc(rec.prosthetic)}</strong>
                            <span class="vse-pill ok">Prosthetic · ${rec.hp}%</span>
                        </div>
                    </div>
                `);
            }
            (rec.conditions || []).forEach((c, idx) => {
                allCards.push(renderConditionRow(bp.id, c, idx, { showActions }));
            });
        }
        if (allCards.length) {
            partRows.push(`<div class="vse-stack">${allCards.join('')}</div>`);
        } else {
            partRows.push('<div class="vse-empty">All body parts healthy (100% HP). Click any part on the silhouette to inspect or record a condition.</div>');
        }
    }

    const wholeHtml = (effective.wholeBody || []).length
        ? `<div class="vse-health-whole-row">${effective.wholeBody.map((wb) => `
            <span class="vse-health-whole-pill type-${esc(wb.type)}" title="${esc(wb.note || wb.label)}">
                <b>${esc(wb.label)}</b> · ${esc(wb.severity)}%${wb.treated ? ' (treated)' : ''}
                ${showActions ? `<button type="button" class="vse-mini-btn vse-health-rm-whole" data-wb-label="${esc(wb.label)}" title="Remove"><i class="fa-solid fa-xmark"></i></button>` : ''}
            </span>
        `).join('')}</div>`
        : '';

    const statusLine = state?.inv?.status && !isEmptySentinel(state.inv.status)
        ? `<div class="vse-health-status-note"><span>Scene Status:</span> ${esc(state.inv.status)}</div>`
        : '';

    return `
        <div class="vse-health-layout">
            <div class="vse-health-doll-col">
                <div class="vse-health-toolbar">
                    <div class="vse-health-layers">${layerButtons}</div>
                    ${isInferred ? '<span class="vse-pill warn" title="Preview parsed from inv.status">Inferred</span>' : ''}
                </div>
                <div class="vse-health-doll-stage">
                    ${dollSvg}
                </div>
                <div class="vse-health-legend">
                    <span><i style="background:#facc15;"></i> Minor</span>
                    <span><i style="background:#fb923c;"></i> Moderate</span>
                    <span><i style="background:#ef4444;"></i> Severe / Bleed</span>
                    <span><i style="background:#e2e8f0;"></i> Bandaged</span>
                    <span><i style="background:#38bdf8;"></i> Frost / Bionics</span>
                </div>
            </div>
            <div class="vse-health-info-col">
                <div class="vse-health-vitals">
                    <div class="vse-vital-box">
                        <div class="vse-vital-top"><span>Overall HP</span><b>${metrics.overallHp}%</b></div>
                        <div class="vse-bar"><i class="vse-bar-fill ${barColorClass(metrics.overallHp)}" style="width:${metrics.overallHp}%"></i></div>
                    </div>
                    <div class="vse-vital-box">
                        <div class="vse-vital-top"><span>Pain</span><b>${esc(metrics.painLabel)} (${metrics.pain}%)</b></div>
                        <div class="vse-bar"><i class="vse-bar-fill ${barColorClass(metrics.pain, { invert: true })}" style="width:${metrics.pain}%"></i></div>
                    </div>
                    <div class="vse-vital-box">
                        <div class="vse-vital-top"><span>Blood Loss</span><b>${esc(metrics.bleedingLevel)} (${metrics.bloodLoss}%)</b></div>
                        <div class="vse-bar"><i class="vse-bar-fill ${barColorClass(metrics.bloodLoss, { invert: true })}" style="width:${metrics.bloodLoss}%"></i></div>
                    </div>
                </div>
                <div class="vse-health-caps">
                    ${capItems.map(([lbl, val]) => `
                        <div class="vse-cap-row">
                            <span>${esc(lbl)}</span>
                            <div class="vse-bar thin"><i class="vse-bar-fill ${barColorClass(val)}" style="width:${val}%"></i></div>
                            <b>${val}%</b>
                        </div>
                    `).join('')}
                </div>
                ${wholeHtml}
                <div class="vse-health-conds-wrap">
                    <div class="vse-health-conds-title">
                        <span>${selectedInfo ? `Inspecting: ${esc(selectedInfo.part.label)}` : `Conditions (${metrics.totalWounds} active · ${metrics.scarCount} scar${metrics.scarCount === 1 ? '' : 's'})`}</span>
                        ${metrics.internalIssues > 0 && activeLayer === 'body' ? `<button type="button" class="vse-mini-btn vse-health-layer-btn" data-health-layer="xray">${metrics.internalIssues} Internal</button>` : ''}
                    </div>
                    ${partRows.join('')}
                </div>
                ${statusLine}
            </div>
        </div>
    `;
}
