/**
 * LPE Atlas -> PolyCSS 3D Scene Builder.
 *
 * Converts LPE <state:locations> rooms, doorways, features/explicit 3D objects,
 * multi-floor levels, NPC pawns, and the user marker into pure CSS 3D polygons
 * and billboard labels via `./polyCss3d.js`.
 *
 * Pure ES module with zero DOM dependencies.
 */

import { PALETTE, isEmptySentinel } from './schema.js';
import { computeBbox, parseDimMeters, parseOccupantsList } from './reducer.js';
import {
    parseLocalPoint3D,
    parseRoomHeight,
    clampObjectToRoom,
    buildAtlasTopology,
    findUserActiveRoom,
    splitRoomOccupantsForPlayer,
} from './atlasTopology.js';
import {
    planePolygons,
    boxPolygons,
    cylinderPolygons,
    conePolygons,
    stairsPolygons,
    spherePolygons,
    archPolygons,
    octahedronPolygons,
    ringPolygons,
    decalPolygon,
    shapeToPolygons,
    compilePolySceneHtml,
    shadeHex,
} from './polyCss3d.js';

export const MAX_SCENE_FACES = 1800;

const ROOM_STYLE_PALETTE = Object.freeze({
    indoor: { floor: '#3e3532', wall: '#5c5350', accent: '#756862', curbOnly: false },
    outdoor: { floor: '#4f5d48', wall: '#666b63', accent: '#7d8578', curbOnly: true },
    tower: { floor: '#424756', wall: '#646b7d', accent: '#838ca0', curbOnly: false },
    cave: { floor: '#2f323b', wall: '#484d59', accent: '#5f6675', curbOnly: false },
    water: { floor: '#2b557a', wall: '#4a7091', accent: '#6290b5', curbOnly: true },
    wagon: { floor: '#5c412d', wall: '#78553a', accent: '#996d4b', curbOnly: false },
});

function escHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function colorForEntity(name, entityStates = []) {
    const low = String(name || '').trim().toLowerCase();
    const found = entityStates.find((e) => (e.name || '').trim().toLowerCase() === low);
    if (found?.fontColor) {
        const hex = String(found.fontColor).match(/#[0-9a-f]{6}/i);
        if (hex) return hex[0];
        const colName = String(found.fontColor).toLowerCase();
        const pal = PALETTE.find((p) => colName.includes(p.name));
        if (pal) return pal.hex;
    }
    return '#89b4fa';
}

function parseLocalPoint(str) {
    const m = String(str || '').match(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

function parseExitsCoords(exitsStr) {
    if (isEmptySentinel(exitsStr)) return [];
    const out = [];
    for (const part of String(exitsStr).split(/\s*\|\s*/)) {
        const m = part.match(/^([NSEW]|Up|Down|main_exit)\s*:\s*([^\s\[]+)\s*\[([^\]]+)\]/i);
        if (!m) continue;
        const coords = m[3].split(',').map((n) => Number(n.trim()));
        if (coords.length >= 2 && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
            out.push({
                dir: m[1],
                target: m[2],
                x: coords[0],
                y: coords[1],
                isMain: m[2] === 'main_exit' || m[1] === 'main_exit',
            });
        }
    }
    return out;
}

/**
 * Determine room architectural style from explicit `room.style` or room name/features.
 */
export function inferRoomStyle(room) {
    const explicit = String(room?.style || '').trim().toLowerCase();
    if (explicit && ROOM_STYLE_PALETTE[explicit]) return explicit;

    const hay = `${room?.name || ''} ${room?.features || ''}`;
    if (/lake|river|pond|sea|ocean|harbor|canal/i.test(hay)) return 'water';
    if (/wagon|carriage|cart|tent|pavilion/i.test(hay)) return 'wagon';
    if (/cave|cavern|mine|tunnel|sewer|crypt|dungeon|vault|undercroft/i.test(hay)) return 'cave';
    if (/courtyard|shingle|shore|road|camp|forest|field|street|square|alley|bridge|dock|pier|wall\b|cliff|beach|meadow|path|garden/i.test(hay)) {
        return 'outdoor';
    }
    if (/tower|solar|spire|keep|battlement|turret|rookery/i.test(hay)) return 'tower';
    return 'indoor';
}

function splitOutsideBrackets(str) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === '[') depth++;
        else if (ch === ']' && depth > 0) depth--;
        else if (depth === 0 && (ch === ',' || ch === '|' || ch === ';')) {
            const part = str.slice(start, i).trim();
            if (part) out.push(part);
            start = i + 1;
        }
    }
    const tail = str.slice(start).trim();
    if (tail) out.push(tail);
    return out;
}

/**
 * Parse room.features items carrying `[x,y]` coordinates into semantic 3D PolyCSS object specs.
 */
export function inferObjectsFromFeatures(room, box = null) {
    const featStr = String(room?.features || '');
    if (isEmptySentinel(featStr)) return [];

    const roomW = box ? (box.x2 - box.x1) : (parseDimMeters(room?.dim)?.w || 15);
    const roomD = box ? (box.y2 - box.y1) : (parseDimMeters(room?.dim)?.h || 15);
    const clampX = (x) => clamp(x, 0.6, Math.max(0.7, roomW - 0.6));
    const clampY = (y) => clamp(y, 0.6, Math.max(0.7, roomD - 0.6));

    const inferred = [];
    for (const item of splitOutsideBrackets(featStr)) {
        const pt = parseLocalPoint(item);
        if (!pt) continue;

        const cleanLabel = item.replace(/\[[^\]]+\]/g, '').trim().slice(0, 48) || 'Prop';
        const lx = clampX(pt.x);
        const ly = clampY(pt.y);
        const low = cleanLabel.toLowerCase();

        if (/hearth|fireplace/i.test(low)) {
            inferred.push({ shape: 'hearth', pos: [lx, ly, 0], size: [2.2, 0.95, 2.3], color: 'stone', label: cleanLabel });
        } else if (/fire-ring|campfire|watchfire|brazier|stove/i.test(low)) {
            inferred.push({ shape: 'brazier', pos: [lx, ly, 0], size: [1.3, 1.3, 1.3], color: 'iron', label: cleanLabel });
        } else if (/wellhead|\bwell\b/i.test(low)) {
            inferred.push({ shape: 'cylinder', pos: [lx, ly, 0], size: [1.5, 1.5, 1.1], color: 'stone', label: cleanLabel });
        } else if (/ladder/i.test(low)) {
            inferred.push({ shape: 'ladder', pos: [lx, ly, 0], size: [0.65, 0.25, 2.6], color: 'wood', label: cleanLabel });
        } else if (/stair|steps|risers|landing/i.test(low)) {
            inferred.push({ shape: 'stairs', pos: [lx, ly, 0], size: [2.0, 2.6, 2.2], color: /timber|wood|oak/i.test(low) ? 'wood' : 'stone', label: cleanLabel });
        } else if (/hourglass|sandglass/i.test(low)) {
            inferred.push({ shape: 'hourglass', pos: [lx, ly, 0], size: [0.55, 0.55, 1.2], color: 'gold', label: cleanLabel });
        } else if (/\bvat\b|biovat|cryo(?:pod|chamber)?/i.test(low)) {
            inferred.push({ shape: 'vat', pos: [lx, ly, 0], size: [1.35, 1.35, 2.6], color: 'magic', label: cleanLabel });
        } else if (/\b(console|terminal|control panel|computer)\b/i.test(low)) {
            inferred.push({ shape: 'console', pos: [lx, ly, 0], size: [2.1, 0.88, 1.38], color: 'steel', label: cleanLabel });
        } else if (/\b(holoscreen|viewscreen|monitor|screen)\b/i.test(low)) {
            inferred.push({ shape: 'screen', pos: [lx, ly, 0], size: [1.95, 0.24, 1.35], color: 'magic', label: cleanLabel });
        } else if (/airlock|bulkhead/i.test(low)) {
            inferred.push({ shape: 'airlock', pos: [lx, ly, 0], size: [2.3, 0.65, 2.45], color: 'iron', label: cleanLabel });
        } else if (/cabinet/i.test(low)) {
            inferred.push({ shape: 'cabinet', pos: [lx, ly, 0], size: [1.05, 0.58, 2.05], color: 'slate', label: cleanLabel });
        } else if (/bookshelf|bookcase|shelf|shelves|wardrobe/i.test(low)) {
            inferred.push({ shape: 'bookshelf', pos: [lx, ly, 0], size: [1.8, 0.55, 2.2], color: 'dark_wood', label: cleanLabel });
        } else if (/desk|lectern|workstation/i.test(low)) {
            inferred.push({ shape: 'desk', pos: [lx, ly, 0], size: [1.8, 0.95, 0.95], color: 'dark_wood', label: cleanLabel });
        } else if (/couch|sofa|settee|divan/i.test(low)) {
            inferred.push({ shape: 'couch', pos: [lx, ly, 0], size: [2.4, 1.05, 0.95], color: 'cloth', label: cleanLabel });
        } else if (/chair|throne|armchair|stool/i.test(low)) {
            inferred.push({ shape: 'chair', pos: [lx, ly, 0], size: [0.85, 0.85, 1.15], color: 'wood', label: cleanLabel });
        } else if (/table|bench|barricade|trestle|counter|altar/i.test(low)) {
            inferred.push({ shape: 'table', pos: [lx, ly, 0], size: [2.2, 1.2, 0.9], color: /stone|marble|slate/i.test(low) ? 'stone' : 'wood', label: cleanLabel });
        } else if (/bed|four-poster|bunk|cot/i.test(low)) {
            inferred.push({ shape: 'bed', pos: [lx, ly, 0], size: [2.2, 1.6, 0.95], color: 'cloth', label: cleanLabel });
        } else if (/wagon|cart|carriage/i.test(low)) {
            inferred.push({ shape: 'box', pos: [lx, ly, 0], size: [3.5, 2.0, 1.8], color: 'wood', label: cleanLabel });
        } else if (/cargo container|shipping container|\bcontainer\b/i.test(low)) {
            inferred.push({ shape: 'container', pos: [lx, ly, 0], size: [5.2, 2.2, 2.45], color: 'steel', label: cleanLabel });
        } else if (/dumpster/i.test(low)) {
            inferred.push({ shape: 'dumpster', pos: [lx, ly, 0], size: [2.1, 1.3, 1.25], color: 'green', label: cleanLabel });
        } else if (/generator|turbine/i.test(low)) {
            inferred.push({ shape: 'generator', pos: [lx, ly, 0], size: [1.7, 1.15, 1.45], color: 'amber', label: cleanLabel });
        } else if (/pallet/i.test(low)) {
            inferred.push({ shape: 'pallet', pos: [lx, ly, 0], size: [1.3, 1.05, 0.2], color: 'wood', label: cleanLabel });
        } else if (/propane|gas tank/i.test(low)) {
            inferred.push({ shape: 'propane', pos: [lx, ly, 0], size: [0.48, 0.48, 1.12], color: 'red', label: cleanLabel });
        } else if (/conduit|\bpipes?\b/i.test(low)) {
            inferred.push({ shape: 'pipes', pos: [lx, ly, 0], size: [2.1, 0.6, 1.85], color: 'steel', label: cleanLabel });
        } else if (/locker/i.test(low)) {
            inferred.push({ shape: 'locker', pos: [lx, ly, 0], size: [0.9, 0.52, 2.0], color: 'steel', label: cleanLabel });
        } else if (/barrel|cask|keg/i.test(low)) {
            inferred.push({ shape: 'barrel', pos: [lx, ly, 0], size: [0.7, 0.7, 1.02], color: 'wood', label: cleanLabel });
        } else if (/crate/i.test(low)) {
            inferred.push({ shape: 'crate', pos: [lx, ly, 0], size: [0.95, 0.95, 0.95], color: 'wood', label: cleanLabel });
        } else if (/tub|cauldron|pillar|column|post|spur/i.test(low)) {
            const col = /copper/i.test(low) ? 'copper'
                : /iron|cauldron/i.test(low) ? 'iron'
                    : /stone|basalt|column/i.test(low) ? 'stone'
                        : 'wood';
            inferred.push({ shape: 'cylinder', pos: [lx, ly, 0], size: [1.1, 1.1, 1.3], color: col, label: cleanLabel });
        } else if (/ice face|ice wall|glacier|weeping ice/i.test(low)) {
            inferred.push({ shape: 'box', pos: [lx, ly, 0], size: [Math.min(roomW * 0.7, 8), 1.8, 6.5], color: 'ice', label: cleanLabel });
        } else if (/gate|arch|door|tunnel/i.test(low)) {
            inferred.push({ shape: 'arch', pos: [lx, ly, 0], size: [2.0, 0.7, 2.2], color: /iron/i.test(low) ? 'iron' : 'dark_wood', label: cleanLabel });
        } else if (/\btree\b|pine|weirwood/i.test(low) && !/table|door|bed|trestle|bench|fire-ring/i.test(low)) {
            inferred.push({ shape: 'tree', pos: [lx, ly, 0], size: [2.1, 2.1, 3.4], color: 'pine', label: cleanLabel });
        } else if (/\btent\b|pavilion/i.test(low)) {
            inferred.push({ shape: 'cone', pos: [lx, ly, 0], size: [2.4, 2.4, 2.0], color: 'cloth', label: cleanLabel });
        } else if (/chest|trunk|coffer|strongbox/i.test(low)) {
            inferred.push({ shape: 'chest', pos: [lx, ly, 0], size: [1.3, 0.85, 0.85], color: 'dark_wood', label: cleanLabel });
        } else if (/cage|hoist|rail/i.test(low)) {
            inferred.push({ shape: 'box', pos: [lx, ly, 0], size: [1.4, 1.0, 1.1], color: /iron|cage|rail/i.test(low) ? 'iron' : 'dark_wood', label: cleanLabel });
        } else if (/crystal|beacon|focus/i.test(low)) {
            inferred.push({ shape: 'crystal', pos: [lx, ly, 0], size: [1.1, 1.1, 2.2], color: 'magic', label: cleanLabel });
        } else if (/lantern|lamp|torch|sconce|candelabra/i.test(low)) {
            inferred.push({ shape: 'lamp', pos: [lx, ly, 0], size: [0.7, 0.7, 1.8], color: 'gold', label: cleanLabel });
        } else if (/boulder|rock|bush|orb|globe/i.test(low)) {
            const col = /orb|globe/i.test(low) ? 'gold' : /bush/i.test(low) ? 'pine' : 'stone';
            inferred.push({ shape: 'sphere', pos: [lx, ly, 0], size: [1.1, 1.1, 1.1], color: col, label: cleanLabel });
        } else if (/grate|drain|pool|rug|carpet|blood|coracle/i.test(low)) {
            const col = /blood/i.test(low) ? 'blood' : /pool|water/i.test(low) ? 'water' : /rug|carpet/i.test(low) ? 'cloth' : 'iron';
            inferred.push({ shape: 'plane', pos: [lx, ly, 0], size: [1.8, 1.8, 0.1], color: col, label: cleanLabel });
        } else {
            inferred.push({ shape: 'box', pos: [lx, ly, 0], size: [1.1, 1.1, 0.9], color: 'stone', label: cleanLabel });
        }
    }
    return inferred.slice(0, 16);
}

function buildPawnPolygons({ x, y, z, color, isUser = false, title = '' }) {
    const faces = [];
    const bodyCol = color || '#89b4fa';
    const meta = { title, className: isUser ? 'lpe-poly-user-pawn' : 'lpe-poly-npc-pawn' };

    faces.push(...decalPolygon({
        cx: x,
        cy: y,
        cz: z + 0.015,
        w: 1.4,
        d: 1.4,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 75%)',
        className: 'lpe-poly-shadow',
        title,
    }));

    if (isUser) {
        faces.push(...ringPolygons({
            cx: x, cy: y, cz: z + 0.05, innerR: 0.55, outerR: 0.9, segments: 8, color: '#89dceb', ...meta,
        }));
    }
    // Torso cylinder + head sphere
    faces.push(...cylinderPolygons({
        cx: x, cy: y, cz: z + 0.05, radius: 0.42, radiusTop: 0.34, h: 1.25, segments: 6, color: bodyCol, ...meta,
    }));
    faces.push(...spherePolygons({
        cx: x, cy: y, cz: z + 1.28, radius: 0.34, latSegments: 2, lonSegments: 5, color: bodyCol, ...meta,
    }));
    if (isUser) {
        faces.push(...octahedronPolygons({
            cx: x, cy: y, cz: z + 2.25, radius: 0.34, h: 0.72, color: '#00e5ff', ...meta,
        }));
    }
    return faces;
}

/**
 * Assemble the complete 3D polygon & label scene for the active Atlas map / floor(s).
 */
export function buildAtlas3DScene(
    state,
    {
        selectedMapId = null,
        selectedLevel = null,
        selectedRoomId = null,
        allFloors = false,
        cutaway = true,
        showLabels = true,
        userName = '',
    } = {},
) {
    const loc = state?.locations || { map_index: { active_map_id: '∅', active_level: '0', maps: [] }, rooms: [] };
    const maps = loc.map_index?.maps || [];
    const allRooms = loc.rooms || [];

    const activeMapId = selectedMapId
        || (loc.map_index?.active_map_id && loc.map_index.active_map_id !== '∅' ? loc.map_index.active_map_id : maps[0]?.id)
        || allRooms[0]?.map_id
        || '';

    const currentMap = maps.find((m) => m.id === activeMapId) || { id: activeMapId, name: activeMapId || 'Unregistered Map', levels: [], main_exit: '∅' };
    const mapRooms = allRooms.filter((r) => !activeMapId || r.map_id === activeMapId || r.map_id === '∅');

    const floorSet = new Map();
    for (const lv of currentMap.levels || []) {
        floorSet.set(String(lv.z), lv.name || `Floor ${lv.z}`);
    }
    for (const r of mapRooms) {
        const box = computeBbox(r.grid, r.dim);
        const zStr = box ? String(box.z) : '0';
        if (!floorSet.has(zStr)) floorSet.set(zStr, `Floor ${zStr}`);
    }
    const floors = [...floorSet.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
    const activeFloor = selectedLevel !== null
        ? String(selectedLevel)
        : (floorSet.has(String(loc.map_index?.active_level ?? '0')) ? String(loc.map_index.active_level) : (floors[0]?.[0] ?? '0'));

    const floorRooms = mapRooms.filter((r) => {
        const box = computeBbox(r.grid, r.dim);
        return (box ? String(box.z) : '0') === activeFloor;
    });

    const visibleRooms = allFloors ? mapRooms : floorRooms;
    const positioned = [];
    const unpositioned = [];
    for (const r of visibleRooms) {
        const box = computeBbox(r.grid, r.dim);
        if (box) {
            const { h: roomH, elev } = parseRoomHeight(r);
            const styleName = inferRoomStyle(r);
            const pal = ROOM_STYLE_PALETTE[styleName] || ROOM_STYLE_PALETTE.indoor;
            const backWallH = pal.curbOnly ? 0.35 : clamp(roomH * (cutaway ? 0.68 : 1), 2.2, cutaway ? 6.2 : 10);
            const frontWallH = pal.curbOnly ? 0.35 : (cutaway ? 0.65 : backWallH);
            positioned.push({
                room: r,
                box,
                dim: { w: box.x2 - box.x1, h: box.y2 - box.y1, zH: roomH },
                roomH,
                elev,
                styleId: styleName,
                pal,
                backWallH,
                frontWallH,
            });
        } else {
            unpositioned.push(r);
        }
    }

    const userRoom = findUserActiveRoom(state, visibleRooms, userName, parseOccupantsList)
        || findUserActiveRoom(state, mapRooms, userName, parseOccupantsList);
    const userLocalPos = parseLocalPoint3D(state?.world?.user_pos);
    const detailRoom = visibleRooms.find((r) => r.id === selectedRoomId)
        || floorRooms.find((r) => r.id === selectedRoomId)
        || userRoom
        || floorRooms[0]
        || visibleRooms[0]
        || null;

    if (positioned.length === 0) {
        return {
            polygons: [],
            labels: [],
            scale: 10,
            origin: { x: 0, y: 0, z: 0 },
            roomCount: 0,
            objectCount: 0,
            faceCount: 0,
            floors,
            activeFloor,
            activeMapId,
            currentMap,
            floorRooms,
            visibleRooms,
            userRoom,
            detailRoom,
            unpositioned,
        };
    }

    // Compute vertical elevation offsets per floor when stacking allFloors
    const zOffsetMap = new Map();
    if (allFloors) {
        const sortedZs = [...new Set(positioned.map((p) => p.box.z))].sort((a, b) => a - b);
        let accZ = 0;
        for (const z of sortedZs) {
            zOffsetMap.set(z, accZ);
            const onZ = positioned.filter((p) => p.box.z === z);
            const maxWall = Math.max(4, ...onZ.map((p) => Math.max(0, p.elev) + (cutaway ? p.backWallH : p.roomH)));
            accZ += maxWall + 1.4;
        }
    } else {
        for (const p of positioned) zOffsetMap.set(p.box.z, 0);
    }
    for (const p of positioned) {
        p.baseY = (zOffsetMap.get(p.box.z) ?? 0) + p.elev;
    }

    const topology = buildAtlasTopology(positioned, { getTheme: inferRoomStyle, wallT: 0.28 });

    // World bounds for centering & auto-scale
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (const p of positioned) {
        const zOff = zOffsetMap.get(p.box.z) ?? 0;
        const topZ = zOff + p.elev + p.backWallH;
        minX = Math.min(minX, p.box.x1);
        minY = Math.min(minY, p.box.y1);
        minZ = Math.min(minZ, zOff + Math.min(0, p.elev));
        maxX = Math.max(maxX, p.box.x2);
        maxY = Math.max(maxY, p.box.y2);
        maxZ = Math.max(maxZ, topZ);
    }

    const spanX = Math.max(10, maxX - minX);
    const spanY = Math.max(10, maxY - minY);
    const maxSpan = Math.max(spanX, spanY);
    const scale = clamp(320 / maxSpan, 5, 22);
    const origin = {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        z: (minZ + maxZ) * 0.4,
    };

    const polygons = [];
    const labels = [];
    let objectCount = 0;

    // Subtle ground reference deck beneath bounds
    polygons.push(...planePolygons({
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        cz: -0.48,
        w: spanX + 8,
        d: spanY + 8,
        color: '#14161f',
        opacity: 0.72,
        unlit: true,
        className: 'lpe-poly-deck',
    }));

    function floorBackgroundFor(styleName, baseHex) {
        if (styleName === 'indoor' || styleName === 'wagon') {
            return `repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 14px), ${baseHex}`;
        }
        if (styleName === 'tower' || styleName === 'cave') {
            return `repeating-linear-gradient(0deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 16px), repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 16px), ${baseHex}`;
        }
        if (styleName === 'water') {
            return `repeating-linear-gradient(135deg, rgba(147,197,253,0.09) 0 4px, transparent 4px 14px), ${baseHex}`;
        }
        return `radial-gradient(circle at 35% 35%, rgba(255,255,255,0.04), transparent 70%), ${baseHex}`;
    }

    const entityColorMap = new Map();
    for (const e of state?.entity_state || []) {
        const key = (e?.name || '').trim().toLowerCase();
        if (key && !entityColorMap.has(key)) {
            entityColorMap.set(key, colorForEntity(e.name, state?.entity_state));
        }
    }

    for (const p of positioned) {
        const { room, box, roomH, elev, styleId: styleName, pal } = p;
        const w = box.x2 - box.x1;
        const d = box.y2 - box.y1;
        const cx = box.x1 + w / 2;
        const cy = box.y1 + d / 2;
        const zFloor = zOffsetMap.get(box.z) ?? 0;
        const zOff = zFloor + elev;

        const isUserHere = Boolean(userRoom && userRoom.id === room.id);
        const isSelected = Boolean(detailRoom && detailRoom.id === room.id);
        const isLoaded = room.kind === 'load';
        const roomOpacity = isLoaded ? 0.56 : (allFloors && zOff > 0 ? 0.86 : 0.96);

        const floorColor = isSelected ? '#4f5a75' : isUserHere ? '#3b4e6b' : pal.floor;
        const wallColor = isSelected ? '#9ab4e8' : isUserHere ? '#76a4e8' : pal.wall;
        const roomMeta = {
            dataAttrs: { 'room-id': room.id },
            title: `${room.name || room.id} (${room.dim || ''})`,
        };

        // 0. Diorama plinth shadow & solid slab skirt (tall enough for intra-level elev)
        const plinthDepth = Math.max(0.42, 0.42 + Math.max(0, elev));
        if (zFloor === 0) {
            polygons.push(...decalPolygon({
                cx: cx + 0.6,
                cy: cy + 0.6,
                cz: zFloor - 0.45,
                w: w + 1.8,
                d: d + 1.8,
                background: 'radial-gradient(closest-side, rgba(0,0,0,0.58), rgba(0,0,0,0))',
                className: 'lpe-poly-shadow',
            }));
        }
        polygons.push(...boxPolygons({
            ...roomMeta,
            cx,
            cy,
            cz: zOff - plinthDepth,
            w,
            d,
            h: plinthDepth,
            color: shadeHex(floorColor, 0.56),
            opacity: roomOpacity,
            skipTop: true,
            skipBottom: true,
            className: 'lpe-poly-plinth',
        }));

        // 1. Room floor slab with CSS style grain
        polygons.push(...planePolygons({
            ...roomMeta,
            cx,
            cy,
            cz: zOff,
            w,
            d,
            color: floorColor,
            background: floorBackgroundFor(styleName, floorColor),
            opacity: roomOpacity,
            className: `lpe-poly-floor ${isSelected ? 'is-selected' : ''} ${isUserHere ? 'is-user-room' : ''}`,
        }));

        // 2. Flush corner-aligned perimeter walls with shared-seam height coordination
        const wallThick = 0.28;
        const halfT = wallThick / 2;
        const shared = topology.sharedWallFlags.get(room.id) || {};
        const wallHeightFor = (side, defaultH) => {
            const nInfo = shared[side];
            if (!nInfo?.neighbor || pal.curbOnly) return defaultH;
            if (nInfo.neighbor.pal?.curbOnly) return p.backWallH;
            return cutaway ? Math.min(p.backWallH, nInfo.neighbor.backWallH) : p.roomH;
        };

        const hN = wallHeightFor('north', p.backWallH);
        const hS = wallHeightFor('south', p.frontWallH);
        const hW = wallHeightFor('west', p.backWallH);
        const hE = wallHeightFor('east', p.frontWallH);
        const ewLen = Math.max(0.25, d - wallThick * 2);

        // North wall (y = box.y1)
        polygons.push(...boxPolygons({
            ...roomMeta,
            cx,
            cy: box.y1 + halfT,
            cz: zOff,
            w,
            d: wallThick,
            h: hN,
            color: wallColor,
            topColor: pal.accent,
            opacity: roomOpacity,
            skipBottom: true,
            className: 'lpe-poly-wall',
        }));
        // West wall (x = box.x1, tucked between N/S corners)
        polygons.push(...boxPolygons({
            ...roomMeta,
            cx: box.x1 + halfT,
            cy,
            cz: zOff,
            w: wallThick,
            d: ewLen,
            h: hW,
            color: wallColor,
            topColor: pal.accent,
            opacity: roomOpacity,
            skipBottom: true,
            className: 'lpe-poly-wall',
        }));
        // South wall (y = box.y2)
        polygons.push(...boxPolygons({
            ...roomMeta,
            cx,
            cy: box.y2 - halfT,
            cz: zOff,
            w,
            d: wallThick,
            h: hS,
            color: wallColor,
            topColor: pal.accent,
            opacity: roomOpacity * 0.9,
            skipBottom: true,
            className: 'lpe-poly-wall',
        }));
        // East wall (x = box.x2, tucked between N/S corners)
        polygons.push(...boxPolygons({
            ...roomMeta,
            cx: box.x2 - halfT,
            cy,
            cz: zOff,
            w: wallThick,
            d: ewLen,
            h: hE,
            color: wallColor,
            topColor: pal.accent,
            opacity: roomOpacity * 0.9,
            skipBottom: true,
            className: 'lpe-poly-wall',
        }));

        // 3. Room 3D objects (grounded, clamped inside interior walls, duplicate door-props suppressed)
        const rawObjects = Array.isArray(room.objects) && room.objects.length > 0
            ? room.objects
            : inferObjectsFromFeatures(room, box);
        const supSet = topology.suppressedObjectsByRoom.get(room.id) || new Set();
        const roomDim = { w, h: d, zH: roomH };

        rawObjects.forEach((rawObj, objIdx) => {
            if (supSet.has(objIdx)) return;
            if (polygons.length > MAX_SCENE_FACES - 100) return;
            const safeObj = clampObjectToRoom(rawObj, roomDim, { wallT: wallThick, insetWalls: true });
            objectCount++;
            polygons.push(...shapeToPolygons(
                safeObj,
                { x: box.x1, y: box.y1, z: zOff },
                { dataAttrs: { 'room-id': room.id }, className: 'lpe-poly-prop' },
            ));
        });

        // Auto stairs indicator if Up/Down adj exists without a stairs object
        const hasStairs = rawObjects.some((o) => o.shape === 'stairs');
        if (!hasStairs && /\b(?:Up|Down)\s*:\s*[^∅,\s|]+/i.test(room.adj || '') && polygons.length < MAX_SCENE_FACES - 80) {
            polygons.push(...stairsPolygons({
                cx: box.x2 - 1.6,
                cy: box.y1 + 1.6,
                cz: zOff,
                w: 1.4,
                d: 2.0,
                h: 1.8,
                steps: 4,
                color: 'stone',
                title: `Stairs (${room.adj})`,
                dataAttrs: { 'room-id': room.id },
                className: 'lpe-poly-prop',
            }));
        }

        // 4. Occupants as colored 3D pawns + billboard initials (with anti-pileup spread & z elevation)
        const { npcOccs, playerOcc } = splitRoomOccupantsForPlayer(parseOccupantsList(room.occupants), userName);
        const placedPawns = [];
        const spreadLocal = (lx, ly, lz) => {
            let x = clamp(lx, wallThick + 0.45, w - wallThick - 0.45);
            let y = clamp(ly, wallThick + 0.45, d - wallThick - 0.45);
            const hits = placedPawns.filter((o) => Math.hypot(o.x - x, o.y - y) < 0.72 && Math.abs(o.z - lz) < 0.8);
            if (hits.length > 0) {
                const ang = hits.length * 2.39996;
                const rad = 0.52 + hits.length * 0.14;
                x = clamp(x + Math.cos(ang) * rad, wallThick + 0.45, w - wallThick - 0.45);
                y = clamp(y + Math.sin(ang) * rad, wallThick + 0.45, d - wallThick - 0.45);
            }
            placedPawns.push({ x, y, z: lz });
            return { wx: box.x1 + x, wy: box.y1 + y };
        };

        for (let idx = 0; idx < npcOccs.length; idx++) {
            if (polygons.length > MAX_SCENE_FACES - 40) break;
            const occ = npcOccs[idx];
            const pt = parseLocalPoint3D(occ.pos);
            const lx = pt ? pt.x : (1.6 + (idx % 3) * 2.2);
            const ly = pt ? pt.y : (d - 1.8 - Math.floor(idx / 3) * 1.6);
            const lz = pt ? clamp(pt.z, 0, Math.max(0, roomH - 0.6)) : 0;
            const { wx: ox, wy: oy } = spreadLocal(lx, ly, lz);
            const col = entityColorMap.get(String(occ.name || '').trim().toLowerCase()) || '#89b4fa';
            const initials = occ.name.split(/\s+/).map((w2) => w2[0]).join('').slice(0, 2).toUpperCase();

            polygons.push(...buildPawnPolygons({
                x: ox,
                y: oy,
                z: zOff + lz,
                color: col,
                isUser: false,
                title: `${occ.name} ${occ.pos || ''} in ${room.name}`,
            }));
            if (showLabels) {
                const elevTxt = lz > 0.2 ? ` +${Number(lz.toFixed(1))}m` : '';
                labels.push({
                    x: ox,
                    y: oy,
                    z: zOff + lz + 2.15,
                    className: 'lpe-poly-lbl-npc',
                    title: `${occ.name}${elevTxt} in ${room.name}`,
                    html: `<span class="lpe-poly-chip" style="--chip-col:${escHtml(col)}">${escHtml(initials)}${elevTxt ? `<small>${escHtml(elevTxt)}</small>` : ''}</span>`,
                });
            }
        }

        // 5. User pawn + diamond marker
        if (isUserHere && polygons.length < MAX_SCENE_FACES - 30) {
            const effUserPos = userLocalPos || parseLocalPoint3D(playerOcc?.pos);
            const uz = effUserPos ? clamp(effUserPos.z, 0, Math.max(0, roomH - 0.6)) : 0;
            const { wx: ux, wy: uy } = spreadLocal(effUserPos ? effUserPos.x : w / 2, effUserPos ? effUserPos.y : d / 2, uz);
            polygons.push(...buildPawnPolygons({
                x: ux,
                y: uy,
                z: zOff + uz,
                color: '#89dceb',
                isUser: true,
                title: `YOU (${state?.world?.user_pos || playerOcc?.pos || 'center'})`,
            }));
            if (showLabels) {
                labels.push({
                    x: ux,
                    y: uy,
                    z: zOff + uz + 3.2,
                    className: 'lpe-poly-lbl-you',
                    title: `YOU (${state?.world?.user_pos || playerOcc?.pos || 'center'})`,
                    html: uz > 0.2 ? `<span class="lpe-poly-chip you">YOU +${Number(uz.toFixed(1))}m</span>` : '<span class="lpe-poly-chip you">YOU</span>',
                });
            }
        }

        // 6. Room billboard name tag
        if (showLabels) {
            const floorTag = allFloors ? ` · Z=${box.z}` : '';
            const heightTag = roomH !== 4 ? ` · ${roomH}m` : '';
            const elevTag = elev !== 0 ? ` · ${elev > 0 ? '+' : ''}${elev}m` : '';
            labels.push({
                x: cx,
                y: box.y1 + 0.8,
                z: zOff + Math.max(hN, hW) + 0.85,
                roomId: room.id,
                className: `lpe-poly-lbl-room ${isSelected ? 'active' : ''}`,
                title: `${room.name || room.id} (${room.dim || ''})`,
                html: `<span class="lpe-poly-room-tag">${escHtml(room.name || room.id)}${escHtml(floorTag)}${escHtml(heightTag)}${escHtml(elevTag)}</span>`,
            });
        }
    }

    // 7. Single unified doorway archways (1 per inter-room connection + exterior doors)
    for (const door of topology.doors) {
        if (polygons.length > MAX_SCENE_FACES - 60) break;
        const doorColor = door.doorStyle === 'scifi'
            ? '#38bdf8'
            : door.isMain
                ? '#a6e3a1'
                : door.doorStyle === 'industrial'
                    ? '#f59e0b'
                    : '#f9e2af';
        polygons.push(...archPolygons({
            cx: door.worldX,
            cy: door.worldZ,
            cz: door.baseY,
            w: Math.max(1.5, door.width + 0.35),
            d: door.depth + 0.14,
            h: 2.1,
            rotZ: door.axis === 'ew' ? 90 : 0,
            color: doorColor,
            title: door.label,
            className: 'lpe-poly-door',
        }));
    }

    return {
        polygons,
        labels,
        scale,
        origin,
        roomCount: positioned.length,
        objectCount,
        faceCount: polygons.length,
        floors,
        activeFloor,
        activeMapId,
        currentMap,
        floorRooms,
        visibleRooms,
        userRoom,
        detailRoom,
        unpositioned,
    };
}

/**
 * Render the complete interactive PolyCSS 3D Atlas viewport HTML string.
 */
export function renderAtlas3DViewport(
    state,
    {
        selectedMapId = null,
        selectedLevel = null,
        selectedRoomId = null,
        allFloors = false,
        cutaway = true,
        showLabels = true,
        camera = null,
        userName = '',
    } = {},
) {
    const scene = buildAtlas3DScene(state, {
        selectedMapId,
        selectedLevel,
        selectedRoomId,
        allFloors,
        cutaway,
        showLabels,
        userName,
    });

    if (scene.roomCount === 0) {
        return {
            html: `<div class="lpe-empty">No positioned room coordinates on this floor yet.</div>`,
            scene,
        };
    }

    const overlayHtml = `
        <div class="lpe-poly-controls">
            <button type="button" class="lpe-poly-btn" data-poly-cam="iso" title="Isometric 3/4 view">Iso</button>
            <button type="button" class="lpe-poly-btn" data-poly-cam="top" title="Top-down plan view">Top</button>
            <button type="button" class="lpe-poly-btn" data-poly-cam="low" title="Low dramatic angle">Low</button>
            <button type="button" class="lpe-poly-btn" data-poly-cam="zoom-in" title="Zoom in">+</button>
            <button type="button" class="lpe-poly-btn" data-poly-cam="zoom-out" title="Zoom out">−</button>
            <button type="button" class="lpe-poly-btn" data-poly-cam="reset" title="Reset camera">Reset</button>
            <button type="button" class="lpe-poly-btn lpe-poly-cutaway-btn ${cutaway ? 'on' : ''}" title="Toggle front wall cutaway">Cutaway</button>
            <button type="button" class="lpe-poly-btn lpe-poly-labels-btn ${showLabels ? 'on' : ''}" title="Toggle floating labels">Labels</button>
        </div>
        <div class="lpe-poly-hint">
            <span>Drag: Orbit · Shift/Right-drag: Pan · Scroll: Zoom · Click room: Inspect</span>
            <span class="lpe-poly-stats">${scene.roomCount} room${scene.roomCount === 1 ? '' : 's'} · ${scene.objectCount} obj · ${scene.faceCount} CSS faces</span>
        </div>
    `;

    const compiled = compilePolySceneHtml({
        polygons: scene.polygons,
        labels: scene.labels,
        camera: camera || { rotX: 56, rotZ: 32, zoom: 1, panX: 0, panY: 0 },
        scale: scene.scale,
        origin: scene.origin,
        overlayHtml,
    });

    return {
        html: compiled.html,
        scene: { ...scene, compiledFaceCount: compiled.faceCount },
    };
}
