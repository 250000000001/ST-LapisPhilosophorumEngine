/**
 * Shared Atlas Spatial Topology, Wall/Doorway Unification, Height & Prop Grounding.
 *
 * Pure ES module (zero DOM dependencies) shared across `atlasWebgl.js`,
 * `atlas3d.js`, `atlasSvg.js`, and `reducer.js` so all renderers share:
 *   - 1 unified doorway per inter-room connection (identical style/texture on both sides)
 *   - Flush corner-aligned walls & coordinated shared-wall heights
 *   - Intra-level ceiling heights (`dim.zH`) and floor elevation (`room.elev`)
 *   - Grounded/clamped 3D props (fixing worker center-Z `pos[2] = h/2` wall bugs)
 */

import { isEmptySentinel, isPlayerPersonaName } from './schema.js';

export function parseDimMeters(dimStr) {
    const m = String(dimStr || '').match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?/i);
    if (!m) return null;
    return { w: Number(m[1]), h: Number(m[2]), zH: m[3] ? Number(m[3]) : 4 };
}

export const STYLE_DOOR_PRIORITY = Object.freeze([
    'scifi',
    'industrial',
    'tower',
    'cave',
    'medieval',
    'tavern',
    'wood',
    'stone',
    'indoor',
    'wagon',
    'outdoor',
    'water',
]);

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

/**
 * Parse `[x,y]` or `[x,y,z]` local coordinates; defaults `z` to `0`.
 */
export function parseLocalPoint3D(str) {
    const s = String(str ?? '').trim();
    if (!s) return null;
    const m = s.match(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(-?\d+(?:\.\d+)?))?\s*\]/)
        || s.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(-?\d+(?:\.\d+)?))?\s*$/);
    if (!m) return null;
    const x = Number(m[1]);
    const y = Number(m[2]);
    const z = m[3] !== undefined ? Number(m[3]) : 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y, z: Number.isFinite(z) ? z : 0 };
}

/**
 * Extract room dimensions `{ w, d, h, elev }` with sane bounds.
 * `h` comes from the 3rd dimension in `room.dim` (`WxDxHm`), `elev` from `room.elev`.
 */
export function parseRoomHeight(room) {
    const dim = parseDimMeters(room?.dim);
    const w = Math.max(0.5, Number(dim?.w) || 5);
    const d = Math.max(0.5, Number(dim?.h) || 5);
    const rawH = Number(dim?.zH);
    const h = clamp(Number.isFinite(rawH) && rawH > 0 ? rawH : 4, 2.4, 12);
    const rawElev = Number(room?.elev);
    const elev = clamp(Number.isFinite(rawElev) ? rawElev : 0, -20, 20);
    return { w, d, h, elev };
}

/**
 * Ground and bound-clamp a 3D Atlas object safely inside a room's interior.
 * Fixes common LLM worker mistake of passing `pos[2] = height / 2` for floor-standing props.
 */
export function clampObjectToRoom(obj, roomDim = null, { wallT = 0.22, insetWalls = true } = {}) {
    const base = obj && typeof obj === 'object' ? obj : {};
    const pos = Array.isArray(base.pos) ? base.pos : [1, 1, 0];
    const size = Array.isArray(base.size) ? base.size : [1.4, 1.4, 1.2];

    const roomW = roomDim && Number.isFinite(Number(roomDim.w)) && Number(roomDim.w) > 0 ? Number(roomDim.w) : 30;
    const roomD = roomDim && Number.isFinite(Number(roomDim.h)) && Number(roomDim.h) > 0 ? Number(roomDim.h) : 30;
    const roomH = roomDim && Number.isFinite(Number(roomDim.zH)) && Number(roomDim.zH) > 0 ? Number(roomDim.zH) : 4;

    let px = Number.isFinite(Number(pos[0])) ? Number(pos[0]) : 1;
    let py = Number.isFinite(Number(pos[1])) ? Number(pos[1]) : 1;
    let pz = Number.isFinite(Number(pos[2])) ? Number(pos[2]) : 0;

    let sw = Math.max(0.25, Number.isFinite(Number(size[0])) ? Number(size[0]) : 1.4);
    let sd = Math.max(0.25, Number.isFinite(Number(size[1])) ? Number(size[1]) : sw);
    let sh = Math.max(0.02, Number.isFinite(Number(size[2])) ? Number(size[2]) : 1.2);

    // Fix LLM center-Z mistake: e.g. 4m tall wall placed at pos[2]=2 inside 4m room -> rest on floor z=0
    if (pz > 0 && pz + sh > roomH + 0.05 && Math.abs(pz - sh / 2) <= 0.35) {
        pz = 0;
    }

    if (insetWalls) {
        const innerMaxW = Math.max(0.25, roomW - wallT * 2);
        const innerMaxD = Math.max(0.25, roomD - wallT * 2);
        sw = Math.min(sw, Math.max(innerMaxW, innerMaxD));
        sd = Math.min(sd, Math.max(innerMaxW, innerMaxD));
        sh = Math.min(sh, roomH);

        const rad = ((Number(base.rot) || 0) * Math.PI) / 180;
        const c = Math.abs(Math.cos(rad));
        const s = Math.abs(Math.sin(rad));
        const rotW = c * sw + s * sd;
        const rotD = s * sw + c * sd;
        if (rotW > innerMaxW || rotD > innerMaxD) {
            const scale = Math.min(
                1,
                innerMaxW / Math.max(0.01, rotW),
                innerMaxD / Math.max(0.01, rotD),
            );
            sw = Math.max(0.2, sw * scale);
            sd = Math.max(0.2, sd * scale);
        }

        const effHalfX = Math.min(innerMaxW / 2, (c * sw + s * sd) / 2);
        const effHalfY = Math.min(innerMaxD / 2, (s * sw + c * sd) / 2);

        const minX = wallT + effHalfX;
        const maxX = roomW - wallT - effHalfX;
        px = minX <= maxX ? clamp(px, minX, maxX) : roomW / 2;

        const minY = wallT + effHalfY;
        const maxY = roomD - wallT - effHalfY;
        py = minY <= maxY ? clamp(py, minY, maxY) : roomD / 2;
    } else {
        px = clamp(px, 0, roomW);
        py = clamp(py, 0, roomD);
    }

    pz = sh <= roomH ? clamp(pz, 0, Math.max(0, roomH - sh)) : 0;

    return {
        ...base,
        pos: [px, py, pz],
        size: [sw, sd, sh],
    };
}

function parseRawExits(room, box, roomW, roomD, wallH) {
    const rawList = Array.isArray(room?.exits)
        ? room.exits
        : String(room?.exits || '')
            .split(/[;\n|]+/)
            .map((s) => s.trim())
            .filter((s) => s && !isEmptySentinel(s));

    if (!rawList.length) return [];

    const cx = (box.x1 + box.x2) / 2;
    const cz = (box.y1 + box.y2) / 2;
    const parsed = [];

    for (const entry of rawList) {
        const str = typeof entry === 'string'
            ? entry
            : `${entry.dir || entry.side || ''} ${entry.grid ? `[${entry.grid}]` : ''} ${entry.target || entry.label || ''}`.trim();
        if (!str || /^\s*(?:up|down)\b/i.test(str)) continue;

        const m = str.match(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*-?\d+(?:\.\d+)?)?\s*\]/);
        const low = str.toLowerCase();
        const targetMatch = str.match(/^(?:north|south|east|west|n|s|e|w|main_exit)\s*:\s*([^\s\[]+)/i);
        const target = targetMatch ? targetMatch[1].trim() : '';
        const isWide = /gate|arch|double|bay|hangar|airlock|bulkhead/i.test(low);
        const doorW = isWide ? 1.55 : 1.18;
        const doorH = Math.min(2.15, Math.max(wallH - 0.14, 1.92));

        const dirMatch = str.match(/^\s*(north|south|east|west|n|s|e|w)\b/i)
            || str.match(/\b(north|south|east|west|main_exit|main|front|entry)\b/i);
        let side = null;
        if (dirMatch) {
            const tok = dirMatch[1].toLowerCase();
            if (tok === 'n' || tok === 'north') side = 'north';
            else if (tok === 'e' || tok === 'east') side = 'east';
            else if (tok === 'w' || tok === 'west') side = 'west';
            else side = 'south';
        }

        let wx = cx;
        let wz = cz;
        if (m) {
            const gx = parseFloat(m[1]);
            const gz = parseFloat(m[2]);
            if (!side) {
                const dists = [
                    { side: 'north', d: Math.abs(gz - box.y1) },
                    { side: 'south', d: Math.abs(gz - box.y2) },
                    { side: 'west', d: Math.abs(gx - box.x1) },
                    { side: 'east', d: Math.abs(gx - box.x2) },
                ].sort((a, b) => a.d - b.d);
                side = dists[0].side;
            }
            wx = side === 'west' ? box.x1 : side === 'east' ? box.x2 : gx;
            wz = side === 'north' ? box.y1 : side === 'south' ? box.y2 : gz;
        } else {
            if (!side) side = 'south';
            wx = side === 'west' ? box.x1 : side === 'east' ? box.x2 : cx;
            wz = side === 'north' ? box.y1 : side === 'south' ? box.y2 : cz;
        }

        const wallSpan = (side === 'north' || side === 'south') ? roomW : roomD;
        const minMargin = Math.max(0.24, Math.min(0.45, wallSpan * 0.08));
        const clampedW = Math.min(Math.max(0.4, wallSpan - minMargin * 2), doorW);
        if (side === 'north' || side === 'south') {
            wx = clamp(wx, box.x1 + clampedW / 2 + minMargin, box.x2 - clampedW / 2 - minMargin);
        } else {
            wz = clamp(wz, box.y1 + clampedW / 2 + minMargin, box.y2 - clampedW / 2 - minMargin);
        }

        parsed.push({
            roomId: room.id,
            side,
            target,
            wx,
            wz,
            width: clampedW,
            height: doorH,
            label: str,
            isMain: target === 'main_exit' || /main_exit/i.test(str),
            explicitStyle: /airlock|bulkhead|blast|sci/i.test(low)
                ? 'scifi'
                : (/arch|gate|tower/i.test(low) ? 'arch' : ''),
        });
    }

    return parsed;
}

function wallLocalOffset(side, box, wx, wz) {
    const cx = (box.x1 + box.x2) / 2;
    const cz = (box.y1 + box.y2) / 2;
    return (side === 'north' || side === 'south') ? (wx - cx) : (cz - wz);
}

function pickHigherPriorityStyle(styleA, styleB) {
    const idxA = STYLE_DOOR_PRIORITY.indexOf(styleA);
    const idxB = STYLE_DOOR_PRIORITY.indexOf(styleB);
    const rA = idxA >= 0 ? idxA : 99;
    const rB = idxB >= 0 ? idxB : 99;
    return rA <= rB ? styleA : styleB;
}

/**
 * Build unified topology for a set of positioned rooms on one or more floors:
 *   - `sharedWallFlags`: map `roomId -> { north, south, east, west }` with neighbor IDs & heights
 *   - `openingsByRoom`: map `roomId -> { north:[], south:[], east:[], west:[] }` for wall cutouts
 *   - `doors`: deduplicated array of physical doorways (1 per inter-room connection + exterior doors)
 *   - `suppressedObjectsByRoom`: map `roomId -> Set<number>` of prop indices that duplicate a doorway
 */
export function buildAtlasTopology(positionedRooms = [], { getTheme = () => 'indoor', wallT = 0.22 } = {}) {
    const sharedWallFlags = new Map();
    const openingsByRoom = new Map();
    const suppressedObjectsByRoom = new Map();
    const seams = [];

    const byRoomId = new Map();
    for (const item of positionedRooms) {
        const rid = item?.room?.id;
        if (!rid) continue;
        byRoomId.set(rid, item);
        sharedWallFlags.set(rid, { north: null, south: null, east: null, west: null });
        openingsByRoom.set(rid, { north: [], south: [], east: [], west: [] });
        suppressedObjectsByRoom.set(rid, new Set());
    }

    // 1. Detect adjacent touching wall seams on the same floor
    for (let i = 0; i < positionedRooms.length; i++) {
        for (let j = i + 1; j < positionedRooms.length; j++) {
            const A = positionedRooms[i];
            const B = positionedRooms[j];
            if (!A?.room?.id || !B?.room?.id || A.box.z !== B.box.z) continue;

            const overlapY = Math.min(A.box.y2, B.box.y2) - Math.max(A.box.y1, B.box.y1);
            const overlapX = Math.min(A.box.x2, B.box.x2) - Math.max(A.box.x1, B.box.x1);

            if (Math.abs(A.box.x2 - B.box.x1) < 0.05 && overlapY > 0.4) {
                sharedWallFlags.get(A.room.id).east = { neighbor: B, seamCoord: A.box.x2 };
                sharedWallFlags.get(B.room.id).west = { neighbor: A, seamCoord: A.box.x2 };
                seams.push({
                    a: A,
                    b: B,
                    aSide: 'east',
                    bSide: 'west',
                    axis: 'ew',
                    seamCoord: A.box.x2,
                    minAlong: Math.max(A.box.y1, B.box.y1),
                    maxAlong: Math.min(A.box.y2, B.box.y2),
                });
            } else if (Math.abs(B.box.x2 - A.box.x1) < 0.05 && overlapY > 0.4) {
                sharedWallFlags.get(B.room.id).east = { neighbor: A, seamCoord: B.box.x2 };
                sharedWallFlags.get(A.room.id).west = { neighbor: B, seamCoord: B.box.x2 };
                seams.push({
                    a: B,
                    b: A,
                    aSide: 'east',
                    bSide: 'west',
                    axis: 'ew',
                    seamCoord: B.box.x2,
                    minAlong: Math.max(A.box.y1, B.box.y1),
                    maxAlong: Math.min(A.box.y2, B.box.y2),
                });
            }

            if (Math.abs(A.box.y2 - B.box.y1) < 0.05 && overlapX > 0.4) {
                sharedWallFlags.get(A.room.id).south = { neighbor: B, seamCoord: A.box.y2 };
                sharedWallFlags.get(B.room.id).north = { neighbor: A, seamCoord: A.box.y2 };
                seams.push({
                    a: A,
                    b: B,
                    aSide: 'south',
                    bSide: 'north',
                    axis: 'ns',
                    seamCoord: A.box.y2,
                    minAlong: Math.max(A.box.x1, B.box.x1),
                    maxAlong: Math.min(A.box.x2, B.box.x2),
                });
            } else if (Math.abs(B.box.y2 - A.box.y1) < 0.05 && overlapX > 0.4) {
                sharedWallFlags.get(B.room.id).south = { neighbor: A, seamCoord: B.box.y2 };
                sharedWallFlags.get(A.room.id).north = { neighbor: B, seamCoord: B.box.y2 };
                seams.push({
                    a: B,
                    b: A,
                    aSide: 'south',
                    bSide: 'north',
                    axis: 'ns',
                    seamCoord: B.box.y2,
                    minAlong: Math.max(A.box.x1, B.box.x1),
                    maxAlong: Math.min(A.box.x2, B.box.x2),
                });
            }
        }
    }

    // 2. Parse raw exits per room
    const allExits = [];
    for (const item of positionedRooms) {
        const rw = item.box.x2 - item.box.x1;
        const rd = item.box.y2 - item.box.y1;
        const wallH = item.roomH || parseRoomHeight(item.room).h;
        const list = parseRawExits(item.room, item.box, rw, rd, wallH);
        for (const ex of list) {
            allExits.push({ ...ex, item, used: false });
        }
    }

    // 3. Deduplicate reciprocal/touching inter-room doors into 1 physical door
    const doors = [];
    const findSeamBetween = (id1, side1, id2) => seams.find((s) =>
        (s.a.room.id === id1 && s.aSide === side1 && s.b.room.id === id2)
        || (s.b.room.id === id1 && s.bSide === side1 && s.a.room.id === id2),
    );

    const resolveDoorStyle = (ex1, ex2, theme1, theme2) => {
        if (ex1?.explicitStyle === 'scifi' || ex2?.explicitStyle === 'scifi') return 'scifi';
        const chosen = theme2 ? pickHigherPriorityStyle(theme1, theme2) : theme1;
        return chosen || 'indoor';
    };

    const addOpeningToRoom = (item, side, wx, wz, width, height, label, doorStyle, bottomOffset = 0) => {
        const map = openingsByRoom.get(item.room.id);
        if (!map) return;
        const center = wallLocalOffset(side, item.box, wx, wz);
        map[side].push({
            center,
            width,
            height,
            bottomOffset: Math.max(0, Number(bottomOffset) || 0),
            label,
            kind: doorStyle === 'scifi' ? 'scifi' : 'door',
        });
    };

    const findSeamForExit = (ex, candidateNeighborId = null) => {
        const exAlong = (ex.side === 'east' || ex.side === 'west') ? ex.wz : ex.wx;
        const matching = seams.filter((s) => {
            const isSideA = s.a.room.id === ex.roomId && s.aSide === ex.side
                && (!candidateNeighborId || s.b.room.id === candidateNeighborId);
            const isSideB = s.b.room.id === ex.roomId && s.bSide === ex.side
                && (!candidateNeighborId || s.a.room.id === candidateNeighborId);
            return isSideA || isSideB;
        });
        if (!matching.length) return null;
        return matching.find((s) => exAlong >= s.minAlong - 0.6 && exAlong <= s.maxAlong + 0.6)
            || matching[0];
    };

    for (let i = 0; i < allExits.length; i++) {
        const ex = allExits[i];
        if (ex.used) continue;

        const themeA = ex.item.styleId || getTheme(ex.item.room) || 'indoor';
        const seamAtExit = findSeamForExit(ex, ex.target && byRoomId.has(ex.target) ? ex.target : null)
            || findSeamForExit(ex, null);
        const touchingOnSide = seamAtExit
            ? (seamAtExit.a.room.id === ex.roomId ? seamAtExit.b : seamAtExit.a)
            : sharedWallFlags.get(ex.roomId)?.[ex.side]?.neighbor || null;
        const neighborItem = byRoomId.get(ex.target) || touchingOnSide || null;

        let match = null;
        if (neighborItem && neighborItem.box.z === ex.item.box.z) {
            const oppSide = ex.side === 'east' ? 'west'
                : ex.side === 'west' ? 'east'
                : ex.side === 'north' ? 'south' : 'north';
            const sharesSeam = Boolean(findSeamBetween(ex.roomId, ex.side, neighborItem.room.id));

            // Only merge reciprocal exits if rooms actually touch at a seam or exit coords coincide
            match = allExits.find((other) => {
                if (other === ex || other.used || other.roomId !== neighborItem.room.id) return false;
                if (other.side !== oppSide) return false;
                const dist = Math.hypot(other.wx - ex.wx, other.wz - ex.wz);
                if (dist <= 1.2) return true;
                if (sharesSeam && other.target === ex.roomId) return true;
                return false;
            });
        }

        if (match) {
            ex.used = true;
            match.used = true;
            const seam = findSeamBetween(ex.roomId, ex.side, match.roomId);
            const wx = seam?.axis === 'ew' ? seam.seamCoord : (ex.wx + match.wx) / 2;
            const wz = seam?.axis === 'ns' ? seam.seamCoord : (ex.wz + match.wz) / 2;
            const width = Math.max(ex.width, match.width);
            const height = Math.min(ex.height, match.height);
            const themeB = match.item.styleId || getTheme(match.item.room) || 'indoor';
            const doorStyle = resolveDoorStyle(ex, match, themeA, themeB);
            const baseYA = ex.item.baseY ?? 0;
            const baseYB = match.item.baseY ?? 0;
            const doorBaseY = Math.max(baseYA, baseYB);

            addOpeningToRoom(ex.item, ex.side, wx, wz, width, height, ex.label, doorStyle, doorBaseY - baseYA);
            addOpeningToRoom(match.item, match.side, wx, wz, width, height, match.label, doorStyle, doorBaseY - baseYB);

            doors.push({
                id: `${ex.roomId}<->${match.roomId}@${Math.round(wx)},${Math.round(wz)}`,
                roomA: ex.item.room.id,
                roomB: match.item.room.id,
                sideA: ex.side,
                sideB: match.side,
                isShared: true,
                axis: (ex.side === 'east' || ex.side === 'west') ? 'ew' : 'ns',
                rotY: (ex.side === 'east' || ex.side === 'west') ? Math.PI / 2 : 0,
                worldX: wx,
                worldZ: wz,
                baseY: doorBaseY,
                width,
                height,
                depth: wallT * 2 + 0.08,
                doorStyle,
                isMain: ex.isMain || match.isMain,
                label: ex.label,
            });
        } else {
            ex.used = true;
            // Even if only one room declared the exit, still cut an opening in the right touching neighbor
            const seam = findSeamForExit(ex, null);
            const touching = seam
                ? (seam.a.room.id === ex.roomId ? seam.b : seam.a)
                : sharedWallFlags.get(ex.roomId)?.[ex.side]?.neighbor;
            const touchesNeighbor = Boolean(touching && touching.box.z === ex.item.box.z);
            const themeB = touchesNeighbor ? (touching.styleId || getTheme(touching.room) || 'indoor') : null;
            const doorStyle = resolveDoorStyle(ex, null, themeA, themeB);

            const wx = ex.wx;
            const wz = ex.wz;
            const oppSide = ex.side === 'east' ? 'west'
                : ex.side === 'west' ? 'east'
                : ex.side === 'north' ? 'south' : 'north';

            const baseYA = ex.item.baseY ?? 0;
            const baseYB = touchesNeighbor ? (touching.baseY ?? 0) : baseYA;
            const doorBaseY = Math.max(baseYA, baseYB);

            addOpeningToRoom(ex.item, ex.side, wx, wz, ex.width, ex.height, ex.label, doorStyle, doorBaseY - baseYA);
            if (touchesNeighbor) {
                addOpeningToRoom(touching, oppSide, wx, wz, ex.width, ex.height, ex.label, doorStyle, doorBaseY - baseYB);
            }

            const insetSign = (ex.side === 'north' || ex.side === 'west') ? 1 : -1;
            const halfT = wallT * 0.5;
            const doorX = touchesNeighbor
                ? wx
                : ((ex.side === 'west' || ex.side === 'east') ? wx + insetSign * halfT : wx);
            const doorZ = touchesNeighbor
                ? wz
                : ((ex.side === 'north' || ex.side === 'south') ? wz + insetSign * halfT : wz);

            doors.push({
                id: `${ex.roomId}:${ex.side}@${Math.round(wx)},${Math.round(wz)}`,
                roomA: ex.item.room.id,
                roomB: touchesNeighbor ? touching.room.id : null,
                sideA: ex.side,
                sideB: touchesNeighbor ? oppSide : null,
                isShared: touchesNeighbor,
                axis: (ex.side === 'east' || ex.side === 'west') ? 'ew' : 'ns',
                rotY: (ex.side === 'east' || ex.side === 'west') ? Math.PI / 2 : 0,
                worldX: doorX,
                worldZ: doorZ,
                baseY: doorBaseY,
                width: ex.width,
                height: ex.height,
                depth: touchesNeighbor ? (wallT * 2 + 0.08) : (wallT + 0.08),
                doorStyle,
                isMain: ex.isMain,
                label: ex.label,
            });
        }
    }

    // 4. Suppress duplicate door-like props (`airlock`, `arch`) sitting right on top of a doorway
    for (const item of positionedRooms) {
        const objs = Array.isArray(item.room?.objects) ? item.room.objects : [];
        if (!objs.length) continue;
        const supSet = suppressedObjectsByRoom.get(item.room.id);
        const roomDoors = doors.filter((d) => d.roomA === item.room.id || d.roomB === item.room.id);
        if (!roomDoors.length) continue;

        objs.forEach((obj, idx) => {
            const sh = String(obj?.shape || '').toLowerCase();
            if (sh !== 'airlock' && sh !== 'arch') return;
            const pos = Array.isArray(obj.pos) ? obj.pos : null;
            if (!pos) return;
            const wx = item.box.x1 + (Number(pos[0]) || 0);
            const wz = item.box.y1 + (Number(pos[1]) || 0);
            const near = roomDoors.find((d) => Math.hypot(d.worldX - wx, d.worldZ - wz) <= 1.6);
            if (near) {
                supSet.add(idx);
                if (sh === 'airlock') near.doorStyle = 'scifi';
            }
        });
    }

    return {
        seams,
        sharedWallFlags,
        openingsByRoom,
        doors,
        suppressedObjectsByRoom,
    };
}

/**
 * Separate NPC occupants from any accidental human-player entry in room.occupants.
 */
export function splitRoomOccupantsForPlayer(occs = [], userName = '') {
    const npcOccs = [];
    let playerOcc = null;
    for (const occ of occs || []) {
        if (!occ?.name) continue;
        if (isPlayerPersonaName(occ.name, userName)) {
            if (!playerOcc || (occ.pos && !playerOcc.pos)) playerOcc = occ;
        } else {
            npcOccs.push(occ);
        }
    }
    return { npcOccs, playerOcc };
}

/**
 * Resolve the room currently occupied by the human player from world.room, world.loc, or fallback occupant entries.
 */
export function findUserActiveRoom(state, rooms = [], userName = '', parseOccupants = null) {
    const roomField = String(state?.world?.room || '').trim().toLowerCase();
    if (roomField && roomField !== '∅') {
        const byRoom = rooms.find((r) =>
            String(r?.id || '').toLowerCase() === roomField
            || String(r?.name || '').toLowerCase() === roomField,
        );
        if (byRoom) return byRoom;
    }
    const locStr = String(state?.world?.loc || '').toLowerCase();
    for (const r of rooms) {
        if (r?.name && locStr.includes(r.name.toLowerCase())) return r;
        if (r?.id && locStr.includes(r.id.toLowerCase())) return r;
    }
    for (const r of rooms) {
        const words = String(r?.name || '').toLowerCase().split(/\s+/).filter((w) => w.length >= 5);
        if (words.length >= 2 && words.filter((w) => locStr.includes(w)).length >= 2) return r;
    }
    if (typeof parseOccupants === 'function') {
        for (const r of rooms) {
            const occs = parseOccupants(r?.occupants);
            if (occs.some((o) => isPlayerPersonaName(o.name, userName))) return r;
        }
    }
    return null;
}
