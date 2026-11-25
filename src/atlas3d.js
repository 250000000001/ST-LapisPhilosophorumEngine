/**
 * Vexa Atlas -> PolyCSS 3D Scene Builder.
 *
 * Converts Vexa <state:locations> rooms, doorways, features/explicit 3D objects,
 * multi-floor levels, NPC pawns, and the user marker into pure CSS 3D polygons
 * and billboard labels via `./polyCss3d.js`.
 *
 * Pure ES module with zero DOM dependencies.
 */

import { PALETTE, isEmptySentinel } from './schema.js';
import { computeBbox, parseDimMeters, parseOccupantsList } from './reducer.js';
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
    shapeToPolygons,
    compilePolySceneHtml,
} from './polyCss3d.js';

export const MAX_SCENE_FACES = 1400;

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

function findUserActiveRoom(state, rooms) {
    const locStr = String(state?.world?.loc || '').toLowerCase();
    for (const r of rooms) {
        if (r.name && locStr.includes(r.name.toLowerCase())) return r;
        if (r.id && locStr.includes(r.id.toLowerCase())) return r;
    }
    for (const r of rooms) {
        const words = String(r.name || '').toLowerCase().split(/\s+/).filter((w) => w.length >= 5);
        if (words.length >= 2 && words.filter((w) => locStr.includes(w)).length >= 2) return r;
    }
    return null;
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
            inferred.push({ shape: 'arch', pos: [lx, ly, 0], size: [2.2, 0.9, 2.2], color: 'stone', label: cleanLabel });
            if (!/cold|doused|dead|ash/i.test(low)) {
                inferred.push({ shape: 'cone', pos: [lx, ly, 0.15], size: [0.9, 0.9, 1.3], color: 'fire', label: `${cleanLabel} Flame` });
            }
        } else if (/fire-ring|campfire|watchfire|brazier|stove/i.test(low)) {
            inferred.push({ shape: 'ring', pos: [lx, ly, 0], size: [1.5, 1.5, 0.2], color: 'dark_stone', label: cleanLabel });
            if (!/cold|doused|ash/i.test(low)) {
                inferred.push({ shape: 'cone', pos: [lx, ly, 0.1], size: [0.9, 0.9, 1.2], color: 'fire', label: `${cleanLabel} Flame` });
            }
        } else if (/wellhead|\bwell\b/i.test(low)) {
            inferred.push({ shape: 'cylinder', pos: [lx, ly, 0], size: [1.5, 1.5, 1.1], color: 'stone', label: cleanLabel });
        } else if (/stair|steps|risers|landing|ladder/i.test(low)) {
            inferred.push({ shape: 'stairs', pos: [lx, ly, 0], size: [2.0, 2.6, 2.2], color: /timber|wood|oak/i.test(low) ? 'wood' : 'stone', label: cleanLabel });
        } else if (/table|bench|desk|barricade|trestle|counter|altar/i.test(low)) {
            inferred.push({ shape: 'box', pos: [lx, ly, 0], size: [2.4, 1.2, 0.9], color: /stone|marble|slate/i.test(low) ? 'stone' : 'wood', label: cleanLabel });
        } else if (/bed|four-poster|bunk|cot/i.test(low)) {
            inferred.push({ shape: 'box', pos: [lx, ly, 0], size: [2.2, 1.7, 0.9], color: 'cloth', label: cleanLabel });
        } else if (/wagon|cart|carriage/i.test(low)) {
            inferred.push({ shape: 'box', pos: [lx, ly, 0], size: [3.5, 2.0, 1.8], color: 'wood', label: cleanLabel });
        } else if (/tub|barrel|cask|cauldron|pillar|column|post|spur/i.test(low)) {
            const col = /copper/i.test(low) ? 'copper'
                : /iron|cauldron/i.test(low) ? 'iron'
                    : /stone|basalt|column/i.test(low) ? 'stone'
                        : 'wood';
            inferred.push({ shape: 'cylinder', pos: [lx, ly, 0], size: [1.1, 1.1, 1.3], color: col, label: cleanLabel });
        } else if (/ice face|ice wall|glacier|weeping ice/i.test(low)) {
            inferred.push({ shape: 'box', pos: [lx, ly, 0], size: [Math.min(roomW * 0.7, 8), 1.8, 6.5], color: 'ice', label: cleanLabel });
        } else if (/gate|arch|door|tunnel/i.test(low)) {
            inferred.push({ shape: 'arch', pos: [lx, ly, 0], size: [2.0, 0.7, 2.2], color: /iron/i.test(low) ? 'iron' : 'dark_wood', label: cleanLabel });
        } else if (/\btree\b|pine/i.test(low) && !/table|door|bed|trestle|bench|fire-ring/i.test(low)) {
            inferred.push({ shape: 'cylinder', pos: [lx, ly, 0], size: [0.55, 0.55, 1.6], color: 'dark_wood', label: `${cleanLabel} Trunk` });
            inferred.push({ shape: 'cone', pos: [lx, ly, 1.4], size: [1.8, 1.8, 2.4], color: 'pine', label: cleanLabel });
        } else if (/\btent\b|pavilion/i.test(low)) {
            inferred.push({ shape: 'cone', pos: [lx, ly, 0], size: [2.4, 2.4, 2.0], color: 'cloth', label: cleanLabel });
        } else if (/chest|trunk|crate|cage|hoist|rail/i.test(low)) {
            inferred.push({ shape: 'box', pos: [lx, ly, 0], size: [1.4, 1.0, 1.1], color: /iron|cage|rail/i.test(low) ? 'iron' : 'dark_wood', label: cleanLabel });
        } else if (/boulder|rock|bush|lantern|orb|globe/i.test(low)) {
            const col = /lantern|orb/i.test(low) ? 'gold' : /bush/i.test(low) ? 'pine' : 'stone';
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
    const meta = { title, className: isUser ? 'vse-poly-user-pawn' : 'vse-poly-npc-pawn' };

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
        if (box) positioned.push({ room: r, box, dim: parseDimMeters(r.dim) || { w: box.x2 - box.x1, h: box.y2 - box.y1, zH: 4 } });
        else unpositioned.push(r);
    }

    const userRoom = findUserActiveRoom(state, visibleRooms) || findUserActiveRoom(state, mapRooms);
    const userLocalPos = parseLocalPoint(state?.world?.user_pos);
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
            const maxWall = Math.max(4, Math.min(8, ...onZ.map((p) => p.dim.zH || 4)));
            accZ += maxWall + 1.4;
        }
    } else {
        for (const p of positioned) zOffsetMap.set(p.box.z, 0);
    }

    // World bounds for centering & auto-scale
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (const p of positioned) {
        const zOff = zOffsetMap.get(p.box.z) ?? 0;
        const wallH = Math.min(p.dim.zH || 4, 4.2);
        minX = Math.min(minX, p.box.x1);
        minY = Math.min(minY, p.box.y1);
        minZ = Math.min(minZ, zOff);
        maxX = Math.max(maxX, p.box.x2);
        maxY = Math.max(maxY, p.box.y2);
        maxZ = Math.max(maxZ, zOff + wallH);
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
        cz: -0.06,
        w: spanX + 6,
        d: spanY + 6,
        color: '#1b1d26',
        opacity: 0.72,
        unlit: true,
        className: 'vse-poly-deck',
    }));

    for (const { room, box, dim } of positioned) {
        const w = box.x2 - box.x1;
        const d = box.y2 - box.y1;
        const cx = box.x1 + w / 2;
        const cy = box.y1 + d / 2;
        const zOff = zOffsetMap.get(box.z) ?? 0;
        const styleName = inferRoomStyle(room);
        const pal = ROOM_STYLE_PALETTE[styleName] || ROOM_STYLE_PALETTE.indoor;

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

        // 1. Room floor slab
        polygons.push(...planePolygons({
            ...roomMeta,
            cx,
            cy,
            cz: zOff,
            w,
            d,
            color: floorColor,
            opacity: roomOpacity,
            className: `vse-poly-floor ${isSelected ? 'is-selected' : ''} ${isUserHere ? 'is-user-room' : ''}`,
        }));

        // 2. Perimeter walls (full N & W back walls, low S & E cutaway walls)
        const wallThick = 0.28;
        const fullWallH = pal.curbOnly ? 0.35 : clamp(dim.zH || 4, 2.2, 3.6);
        const frontWallH = pal.curbOnly ? 0.35 : (cutaway ? 0.65 : fullWallH);

        // North wall (y = box.y1)
        polygons.push(...boxPolygons({
            ...roomMeta,
            cx,
            cy: box.y1 + wallThick / 2,
            cz: zOff,
            w,
            d: wallThick,
            h: fullWallH,
            color: wallColor,
            topColor: pal.accent,
            opacity: roomOpacity,
            skipBottom: true,
            className: 'vse-poly-wall',
        }));
        // West wall (x = box.x1)
        polygons.push(...boxPolygons({
            ...roomMeta,
            cx: box.x1 + wallThick / 2,
            cy,
            cz: zOff,
            w: wallThick,
            d,
            h: fullWallH,
            color: wallColor,
            topColor: pal.accent,
            opacity: roomOpacity,
            skipBottom: true,
            className: 'vse-poly-wall',
        }));
        // South wall (y = box.y2)
        polygons.push(...boxPolygons({
            ...roomMeta,
            cx,
            cy: box.y2 - wallThick / 2,
            cz: zOff,
            w,
            d: wallThick,
            h: frontWallH,
            color: wallColor,
            topColor: pal.accent,
            opacity: roomOpacity * 0.9,
            skipBottom: true,
            className: 'vse-poly-wall',
        }));
        // East wall (x = box.x2)
        polygons.push(...boxPolygons({
            ...roomMeta,
            cx: box.x2 - wallThick / 2,
            cy,
            cz: zOff,
            w: wallThick,
            d,
            h: frontWallH,
            color: wallColor,
            topColor: pal.accent,
            opacity: roomOpacity * 0.9,
            skipBottom: true,
            className: 'vse-poly-wall',
        }));

        // 3. Doorways / Exits along edges
        for (const ex of parseExitsCoords(room.exits)) {
            if (polygons.length > MAX_SCENE_FACES - 80) break;
            const dxEdge = Math.min(Math.abs(ex.x - box.x1), Math.abs(ex.x - box.x2));
            const dyEdge = Math.min(Math.abs(ex.y - box.y1), Math.abs(ex.y - box.y2));
            const onEastWest = dxEdge < dyEdge;
            const doorX = clamp(ex.x, box.x1 + 0.4, box.x2 - 0.4);
            const doorY = clamp(ex.y, box.y1 + 0.4, box.y2 - 0.4);
            polygons.push(...archPolygons({
                cx: doorX,
                cy: doorY,
                cz: zOff,
                w: 1.8,
                d: 0.45,
                h: 2.1,
                rotZ: onEastWest ? 90 : 0,
                color: ex.isMain ? '#a6e3a1' : '#f9e2af',
                title: `${ex.dir}: ${ex.target} [${ex.x},${ex.y}]`,
                className: 'vse-poly-door',
            }));
        }

        // 4. Room 3D objects (explicit room.objects or auto-inferred from features)
        const roomObjects = Array.isArray(room.objects) && room.objects.length > 0
            ? room.objects
            : inferObjectsFromFeatures(room, box);

        for (const obj of roomObjects) {
            if (polygons.length > MAX_SCENE_FACES - 100) break;
            objectCount++;
            polygons.push(...shapeToPolygons(
                obj,
                { x: box.x1, y: box.y1, z: zOff },
                { dataAttrs: { 'room-id': room.id }, className: 'vse-poly-prop' },
            ));
        }

        // Auto stairs indicator if Up/Down adj exists without a stairs object
        const hasStairs = roomObjects.some((o) => o.shape === 'stairs');
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
                className: 'vse-poly-prop',
            }));
        }

        // 5. Occupants as colored 3D pawns + billboard initials
        const occs = parseOccupantsList(room.occupants);
        occs.forEach((occ, idx) => {
            if (polygons.length > MAX_SCENE_FACES - 40) return;
            const pt = parseLocalPoint(occ.pos);
            const ox = pt ? clamp(box.x1 + pt.x, box.x1 + 0.7, box.x2 - 0.7) : (box.x1 + 1.6 + (idx % 3) * 2.2);
            const oy = pt ? clamp(box.y1 + pt.y, box.y1 + 0.7, box.y2 - 0.7) : (box.y2 - 1.8 - Math.floor(idx / 3) * 1.6);
            const col = colorForEntity(occ.name, state?.entity_state);
            const initials = occ.name.split(/\s+/).map((w2) => w2[0]).join('').slice(0, 2).toUpperCase();

            polygons.push(...buildPawnPolygons({
                x: ox,
                y: oy,
                z: zOff,
                color: col,
                isUser: false,
                title: `${occ.name} ${occ.pos || ''} in ${room.name}`,
            }));
            if (showLabels) {
                labels.push({
                    x: ox,
                    y: oy,
                    z: zOff + 2.15,
                    className: 'vse-poly-lbl-npc',
                    title: `${occ.name} in ${room.name}`,
                    html: `<span class="vse-poly-chip" style="--chip-col:${escHtml(col)}">${escHtml(initials)}</span>`,
                });
            }
        });

        // 6. User pawn + diamond marker
        if (isUserHere && polygons.length < MAX_SCENE_FACES - 30) {
            const ux = userLocalPos ? clamp(box.x1 + userLocalPos.x, box.x1 + 0.8, box.x2 - 0.8) : cx;
            const uy = userLocalPos ? clamp(box.y1 + userLocalPos.y, box.y1 + 0.8, box.y2 - 0.8) : cy;
            polygons.push(...buildPawnPolygons({
                x: ux,
                y: uy,
                z: zOff,
                color: '#89dceb',
                isUser: true,
                title: `YOU (${state?.world?.user_pos || 'center'})`,
            }));
            if (showLabels) {
                labels.push({
                    x: ux,
                    y: uy,
                    z: zOff + 3.2,
                    className: 'vse-poly-lbl-you',
                    title: `YOU (${state?.world?.user_pos || 'center'})`,
                    html: '<span class="vse-poly-chip you">YOU</span>',
                });
            }
        }

        // 7. Room billboard name tag
        if (showLabels) {
            const floorTag = allFloors ? ` · Z=${box.z}` : '';
            labels.push({
                x: cx,
                y: box.y1 + 0.8,
                z: zOff + fullWallH + 0.85,
                roomId: room.id,
                className: `vse-poly-lbl-room ${isSelected ? 'active' : ''}`,
                title: `${room.name || room.id} (${room.dim || ''})`,
                html: `<span class="vse-poly-room-tag">${escHtml(room.name || room.id)}${escHtml(floorTag)}</span>`,
            });
        }
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
    } = {},
) {
    const scene = buildAtlas3DScene(state, {
        selectedMapId,
        selectedLevel,
        selectedRoomId,
        allFloors,
        cutaway,
        showLabels,
    });

    if (scene.roomCount === 0) {
        return {
            html: `<div class="vse-empty">No positioned room coordinates on this floor yet.</div>`,
            scene,
        };
    }

    const overlayHtml = `
        <div class="vse-poly-controls">
            <button type="button" class="vse-poly-btn" data-poly-cam="iso" title="Isometric 3/4 view">Iso</button>
            <button type="button" class="vse-poly-btn" data-poly-cam="top" title="Top-down plan view">Top</button>
            <button type="button" class="vse-poly-btn" data-poly-cam="low" title="Low dramatic angle">Low</button>
            <button type="button" class="vse-poly-btn" data-poly-cam="zoom-in" title="Zoom in">+</button>
            <button type="button" class="vse-poly-btn" data-poly-cam="zoom-out" title="Zoom out">−</button>
            <button type="button" class="vse-poly-btn" data-poly-cam="reset" title="Reset camera">Reset</button>
            <button type="button" class="vse-poly-btn vse-poly-cutaway-btn ${cutaway ? 'on' : ''}" title="Toggle front wall cutaway">Cutaway</button>
            <button type="button" class="vse-poly-btn vse-poly-labels-btn ${showLabels ? 'on' : ''}" title="Toggle floating labels">Labels</button>
        </div>
        <div class="vse-poly-hint">
            <span>Drag: Orbit · Shift/Right-drag: Pan · Scroll: Zoom · Click room: Inspect</span>
            <span class="vse-poly-stats">${scene.roomCount} room${scene.roomCount === 1 ? '' : 's'} · ${scene.objectCount} obj · ${scene.faceCount} CSS faces</span>
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
