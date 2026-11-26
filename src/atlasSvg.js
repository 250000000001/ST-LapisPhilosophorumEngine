/**
 * Interactive Atlas renderer for Lapis Philosophorum Engine (<state:locations>).
 * Supports both PolyCSS 3D CSS scenes (default) and 2D SVG floorplans.
 * Pure HTML/SVG generator (no jQuery required so unit tests can inspect output too).
 */

import { PALETTE, isEmptySentinel } from './schema.js';
import { computeBbox, parseOccupantsList } from './reducer.js';
import { renderAtlas3DViewport, inferObjectsFromFeatures, inferRoomStyle } from './atlas3d.js';
import { resolveMaterialColor } from './polyCss3d.js';
import { buildAtlasTopology, parseLocalPoint3D, parseRoomHeight } from './atlasTopology.js';

let svgClipSeq = 0;

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

function wrapRoomTitleLines(text, maxChars) {
    const clean = String(text || '').trim();
    if (!clean) return ['Room'];
    const cap = Math.max(4, Math.floor(maxChars));
    if (clean.length <= cap) return [clean];
    const words = clean.split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
        if (!cur) {
            cur = w;
        } else if (cur.length + 1 + w.length <= cap) {
            cur += ' ' + w;
        } else {
            lines.push(cur);
            cur = w;
            if (lines.length === 1) break;
        }
    }
    if (cur && lines.length < 2) {
        // Append remaining text when break happened early or finish line 2
        const usedWords = lines.length === 1 ? lines[0].split(/\s+/).length : 0;
        const rest = usedWords > 0 && lines.length === 1
            ? words.slice(usedWords).join(' ')
            : cur;
        lines.push(rest);
    } else if (lines.length === 2) {
        // Ensure we include tail info ellipsized
    }
    if (lines.length > 2) lines.length = 2;
    return lines.map((ln) => {
        if (ln.length <= cap) return ln;
        return `${ln.slice(0, Math.max(1, cap - 1))}…`;
    });
}

function computeSvgViewBox(baseVb, cam) {
    const zoom = clamp(Number(cam?.zoom) || 1, 0.35, 8);
    const curW = baseVb.w / zoom;
    const curH = baseVb.h / zoom;
    const maxPanX = baseVb.w * 0.9;
    const maxPanY = baseVb.h * 0.9;
    const panX = clamp(Number(cam?.panX) || 0, -maxPanX, maxPanX);
    const panY = clamp(Number(cam?.panY) || 0, -maxPanY, maxPanY);
    const cx = baseVb.x + baseVb.w / 2 + panX;
    const cy = baseVb.y + baseVb.h / 2 + panY;
    return {
        zoom,
        panX,
        panY,
        x: cx - curW / 2,
        y: cy - curH / 2,
        w: curW,
        h: curH,
    };
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
    return 'var(--ist-blue, #89b4fa)';
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
            out.push({ dir: m[1], target: m[2], x: coords[0], y: coords[1], isMain: m[2] === 'main_exit' || m[1] === 'main_exit' });
        }
    }
    return out;
}

function spreadRoomMarkers(rawPins, box, topClearance = 0) {
    if (!rawPins.length) return [];
    const minX = box.x1 + 0.85;
    const maxX = Math.max(minX, box.x2 - 0.85);
    const h = box.y2 - box.y1;
    const effClear = h >= 6.5 ? Math.max(0.85, topClearance) : 0.85;
    const minY = Math.min(Math.max(box.y1 + 0.85, box.y2 - 0.85), box.y1 + effClear);
    const maxY = Math.max(minY, box.y2 - 0.85);
    const minDist = rawPins.length > 7 ? 1.32 : 1.55;
    const placed = [];
    const golden = 2.399963229728653;

    for (let i = 0; i < rawPins.length; i++) {
        const pin = rawPins[i];
        const baseX = clamp(pin.x, minX, maxX);
        const baseY = clamp(pin.y, minY, maxY);

        const minDistToPlaced = (cx, cy) => {
            let best = Infinity;
            for (const p of placed) {
                const d = Math.hypot(cx - p.sx, cy - p.sy);
                if (d < best) best = d;
            }
            return best;
        };

        let bestX = baseX;
        let bestY = baseY;
        let bestClear = minDistToPlaced(baseX, baseY);

        if (bestClear < minDist) {
            const rings = [minDist * 0.85, minDist * 1.45, minDist * 2.05, minDist * 2.7];
            let solved = false;
            for (const r of rings) {
                for (let k = 0; k < 14; k++) {
                    const ang = (i * 0.8 + k * golden);
                    const cx = clamp(baseX + Math.cos(ang) * r, minX, maxX);
                    const cy = clamp(baseY + Math.sin(ang) * r, minY, maxY);
                    const clear = minDistToPlaced(cx, cy);
                    if (clear >= minDist) {
                        bestX = cx;
                        bestY = cy;
                        bestClear = clear;
                        solved = true;
                        break;
                    }
                    if (clear > bestClear) {
                        bestX = cx;
                        bestY = cy;
                        bestClear = clear;
                    }
                }
                if (solved) break;
            }
        }

        const out = { ...pin, sx: bestX, sy: bestY };
        placed.push(out);
    }
    return placed;
}

function findUserActiveRoom(state, roomsOnFloor) {
    const locStr = String(state?.world?.loc || '').toLowerCase();
    for (const r of roomsOnFloor) {
        if (r.name && locStr.includes(r.name.toLowerCase())) return r;
        if (r.id && locStr.includes(r.id.toLowerCase())) return r;
    }
    // Partial word match fallback
    for (const r of roomsOnFloor) {
        const words = String(r.name || '').toLowerCase().split(/\s+/).filter((w) => w.length >= 5);
        if (words.length >= 2 && words.filter((w) => locStr.includes(w)).length >= 2) return r;
    }
    return null;
}

/**
 * Render the interactive Atlas tab HTML (map selector, floor tabs, 3D CSS or 2D SVG map, room cards).
 */
export function renderAtlasTab(
    state,
    {
        selectedMapId = null,
        selectedLevel = null,
        selectedRoomId = null,
        viewMode = '3d',
        allFloors = false,
        cutaway = true,
        showLabels = true,
        camera = null,
        svgCamera = null,
        allowWebgl = false,
    } = {},
) {
    const mode = (viewMode === 'webgl' && allowWebgl)
        ? 'webgl'
        : (viewMode === '2d' ? '2d' : (viewMode === 'webgl' ? '3d' : '3d'));
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
    const is3dMode = mode === '3d' || mode === 'webgl';
    const visibleRooms = is3dMode && allFloors ? mapRooms : floorRooms;

    const positioned = [];
    const unpositioned = [];
    for (const r of floorRooms) {
        const box = computeBbox(r.grid, r.dim);
        if (box) positioned.push({ room: r, box });
        else unpositioned.push(r);
    }

    const userRoom = findUserActiveRoom(state, visibleRooms);
    const userLocalPos = parseLocalPoint3D(state?.world?.user_pos);

    let viewportHtml = '';
    if (mode === 'webgl') {
        viewportHtml = `
            <div class="lpe-webgl-viewport" data-map-id="${escHtml(activeMapId)}" data-level="${escHtml(activeFloor)}">
                <canvas class="lpe-webgl-canvas"></canvas>
                <div class="lpe-webgl-labels"></div>
                <div class="lpe-webgl-hud-overlay">
                    <span class="lpe-webgl-chip">${escHtml(currentMap.name || activeMapId || 'Atlas')} · ${allFloors ? 'All Floors' : `Z=${escHtml(activeFloor)}`} · ${visibleRooms.length} room${visibleRooms.length === 1 ? '' : 's'}</span>
                    <span class="lpe-webgl-chip">Orbit: Drag · Pan: Shift+Drag · Zoom: Wheel</span>
                </div>
                <div class="lpe-webgl-controls">
                    <button type="button" class="lpe-webgl-btn active" data-webgl-act="iso" title="Isometric view">Iso</button>
                    <button type="button" class="lpe-webgl-btn" data-webgl-act="top" title="Top-down view">Top</button>
                    <button type="button" class="lpe-webgl-btn" data-webgl-act="in" title="Zoom in">+</button>
                    <button type="button" class="lpe-webgl-btn" data-webgl-act="out" title="Zoom out">−</button>
                    <button type="button" class="lpe-webgl-btn" data-webgl-act="reset" title="Reset camera">Reset</button>
                    <button type="button" class="lpe-webgl-btn lpe-poly-cutaway-btn ${cutaway ? 'active' : ''}" title="Toggle cutaway walls">Cut</button>
                    <button type="button" class="lpe-webgl-btn lpe-poly-labels-btn ${showLabels ? 'active' : ''}" title="Toggle 3D labels">Labels</button>
                </div>
            </div>
            <div class="lpe-webgl-footer-note">
                <span>Hybrid Three.js WebGL Engine + Doorway Cutouts</span>
                <span>Textured kits: PSX Industrial Pack (Tomitos) &amp; Sci-fi lab (Agata Wilczek) — CC BY 4.0</span>
            </div>
        `;
    } else if (mode === '3d') {
        viewportHtml = renderAtlas3DViewport(state, {
            selectedMapId,
            selectedLevel,
            selectedRoomId,
            allFloors,
            cutaway,
            showLabels,
            camera,
        }).html;
    } else if (positioned.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of positioned) {
            minX = Math.min(minX, p.box.x1);
            minY = Math.min(minY, p.box.y1);
            maxX = Math.max(maxX, p.box.x2);
            maxY = Math.max(maxY, p.box.y2);
        }
        const pad = 5;
        const vx = minX - pad;
        const vy = minY - pad;
        const vw = Math.max(20, (maxX - minX) + pad * 2);
        const vh = Math.max(20, (maxY - minY) + pad * 2);

        // 5m gridlines (padded for zoom-out panning)
        const gridLines = [];
        const gxStart = Math.floor((vx - vw * 0.6) / 5) * 5;
        const gxEnd = vx + vw * 1.6;
        const gyStart = Math.floor((vy - vh * 0.6) / 5) * 5;
        const gyEnd = vy + vh * 1.6;
        for (let gx = gxStart; gx <= gxEnd; gx += 5) {
            gridLines.push(`<line x1="${gx}" y1="${gyStart}" x2="${gx}" y2="${gyEnd}" stroke="var(--ist-border)" stroke-opacity="0.22" stroke-width="0.15" />`);
        }
        for (let gy = gyStart; gy <= gyEnd; gy += 5) {
            gridLines.push(`<line x1="${gxStart}" y1="${gy}" x2="${gxEnd}" y2="${gy}" stroke="var(--ist-border)" stroke-opacity="0.22" stroke-width="0.15" />`);
        }

        const defsHtml = [];
        const roomRects = [];
        const roomLabels = [];
        const propOutlines = [];
        const doorDots = [];
        const markers = [];
        const roomClearMap = new Map();

        const topoInput = positioned.map((p) => {
            const { h: rh, elev: re } = parseRoomHeight(p.room);
            return { ...p, roomH: rh, baseY: re, styleId: inferRoomStyle(p.room) };
        });
        const topology = buildAtlasTopology(topoInput, { getTheme: inferRoomStyle, wallT: 0.22 });

        const rawDoorsSeen = new Set();
        for (const d of topology.doors) {
            const k = `${Math.round(d.worldX * 2)},${Math.round(d.worldZ * 2)}`;
            if (rawDoorsSeen.has(k)) continue;
            rawDoorsSeen.add(k);
            const tip = d.roomB ? `${d.roomA} <-> ${d.roomB}` : (d.label || `${d.roomA} (${d.axis})`);
            doorDots.push(
                `<circle cx="${d.worldX}" cy="${d.worldZ}" r="${d.isMain ? '0.82' : '0.52'}"
                         fill="${d.isMain ? 'var(--ist-green)' : 'var(--ist-yellow)'}" stroke="var(--ist-crust)" stroke-width="0.18">
                    <title>${escHtml(tip)}</title>
                </circle>`,
            );
        }

        for (const { room, box } of positioned) {
            const w = box.x2 - box.x1;
            const h = box.y2 - box.y1;
            const isUserHere = userRoom && userRoom.id === room.id;
            const isSelected = selectedRoomId === room.id;
            const isLoaded = room.kind === 'load';
            const stroke = isSelected ? 'var(--ist-yellow)' : isUserHere ? 'var(--ist-blue)' : 'var(--ist-border)';
            const fill = isUserHere ? 'var(--ist-surface)' : 'var(--ist-mantle)';
            const dash = isLoaded ? 'stroke-dasharray="0.8 0.5"' : '';
            const safeClipId = `lpe-rc-${++svgClipSeq}-${String(room.id || 'rm').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
            const { h: roomH, elev } = parseRoomHeight(room);

            defsHtml.push(
                `<clipPath id="${safeClipId}"><rect x="${box.x1 + 0.35}" y="${box.y1 + 0.35}" width="${Math.max(0.5, w - 0.7)}" height="${Math.max(0.5, h - 0.7)}" rx="0.4" /></clipPath>`,
            );

            const titleFont = Math.max(0.76, Math.min(1.55, w * 0.068, h * 0.14));
            const subFont = Math.max(0.66, Math.min(1.02, titleFont * 0.72));
            const maxChars = Math.max(5, Math.floor((w - 1.1) / (titleFont * 0.56)));
            const titleLines = wrapRoomTitleLines(room.name || room.id, maxChars);
            const titleStartY = box.y1 + Math.min(titleLines.length > 1 ? 1.85 : 2.2, h * 0.24) + titleFont * 0.32;
            const lineStep = titleFont * 1.12;
            const dimBase = room.dim || `${w}x${h}x${roomH}m`;
            const elevTag = elev ? ` · ${elev > 0 ? '+' : ''}${elev}m` : '';
            const subY = titleStartY + (titleLines.length - 1) * lineStep + subFont * 1.25;
            const titleTspans = titleLines.map((ln, idx) =>
                `<tspan x="${box.x1 + w / 2}" dy="${idx === 0 ? 0 : lineStep}">${escHtml(ln)}</tspan>`,
            ).join('');
            const pillTop = box.y1 + 0.4;
            const pillH = Math.min(h * 0.42, (subY - box.y1) + subFont * 0.55);
            const pillW = Math.max(2, w - 0.8);
            roomClearMap.set(room.id, pillTop - box.y1 + pillH + 0.75);

            roomRects.push(`
                <g class="lpe-atlas-room-g" data-room-id="${escHtml(room.id)}" style="cursor:pointer;">
                    <title>${escHtml(`${room.name || room.id} (${dimBase}${elevTag})`)}</title>
                    <rect x="${box.x1}" y="${box.y1}" width="${w}" height="${h}" rx="0.6"
                          fill="${fill}" fill-opacity="${isUserHere ? '0.92' : '0.78'}"
                          stroke="${stroke}" stroke-width="${isSelected || isUserHere ? '0.45' : '0.28'}" ${dash} />
                </g>
            `);
            roomLabels.push(`
                <g class="lpe-atlas-room-title" clip-path="url(#${safeClipId})" pointer-events="none">
                    <rect x="${box.x1 + 0.4}" y="${pillTop.toFixed(2)}" width="${pillW.toFixed(2)}" height="${pillH.toFixed(2)}" rx="0.4"
                          fill="var(--ist-crust)" fill-opacity="0.78" />
                    <text x="${box.x1 + w / 2}" y="${titleStartY}"
                          text-anchor="middle" fill="var(--ist-title)" font-size="${titleFont.toFixed(2)}" font-weight="600">
                        ${titleTspans}
                    </text>
                    <text x="${box.x1 + w / 2}" y="${subY.toFixed(2)}"
                          text-anchor="middle" fill="var(--ist-muted)" font-size="${subFont.toFixed(2)}">
                        ${escHtml(`${dimBase}${elevTag}`)}
                    </text>
                </g>
            `);

            // Elevated platform footprints & props
            const explicitObjs = Array.isArray(room.objects) ? room.objects : [];
            for (const obj of explicitObjs) {
                const sh = String(obj?.shape || '').toLowerCase();
                if (sh !== 'platform') continue;
                const ow = Math.min(Math.max(0.6, Number(obj.size?.[0]) || 3), Math.max(0.6, w - 0.5));
                const od = Math.min(Math.max(0.6, Number(obj.size?.[1]) || 2), Math.max(0.6, h - 0.5));
                const ox = clamp(box.x1 + (Number(obj.pos?.[0]) || w / 2), box.x1 + ow / 2 + 0.25, box.x2 - ow / 2 - 0.25);
                const oy = clamp(box.y1 + (Number(obj.pos?.[1]) || h / 2), box.y1 + od / 2 + 0.25, box.y2 - od / 2 - 0.25);
                const oz = Number(obj.pos?.[2]) || 0;
                const topZ = Math.round((oz + (Number(obj.size?.[2]) || 0.25)) * 10) / 10;
                propOutlines.push(`
                    <rect x="${(ox - ow / 2).toFixed(2)}" y="${(oy - od / 2).toFixed(2)}" width="${ow.toFixed(2)}" height="${od.toFixed(2)}" rx="0.25"
                          fill="var(--ist-accent, #89b4fa)" fill-opacity="0.16"
                          stroke="var(--ist-accent, #89b4fa)" stroke-width="0.16" stroke-dasharray="0.45 0.3">
                        <title>${escHtml(`${obj.label || 'Platform'} [↑${topZ}m]`)}</title>
                    </rect>
                `);
            }

            // Up/Down stairwell indicators (horizontal doorways come unified from topology.doors)
            for (const ex of parseExitsCoords(room.exits)) {
                if (/^(?:up|down)$/i.test(ex.dir)) {
                    const ux = clamp(ex.x, box.x1 + 0.8, box.x2 - 0.8);
                    const uy = clamp(ex.y, box.y1 + 0.8, box.y2 - 0.8);
                    const isUp = /^up$/i.test(ex.dir);
                    doorDots.push(`
                        <g pointer-events="all">
                            <rect x="${ux - 0.55}" y="${uy - 0.55}" width="1.1" height="1.1" rx="0.22"
                                  fill="var(--ist-surface)" stroke="var(--ist-mauve, #cba6f7)" stroke-width="0.18">
                                <title>${escHtml(`${ex.dir}: ${ex.target} [${ex.x},${ex.y}]`)}</title>
                            </rect>
                            <text x="${ux}" y="${uy + 0.28}" text-anchor="middle" fill="var(--ist-mauve, #cba6f7)" font-size="0.68" font-weight="700">${isUp ? '▲' : '▼'}</text>
                        </g>
                    `);
                }
            }

            // Collect & de-overlap Occupants + User marker
            const rawPins = [];
            const occs = parseOccupantsList(room.occupants);
            occs.forEach((occ, idx) => {
                const pt = parseLocalPoint3D(occ.pos);
                const px = pt ? box.x1 + pt.x : (box.x1 + 2 + (idx % 3) * 2.5);
                const py = pt ? box.y1 + pt.y : (box.y1 + h - 2);
                const pz = pt ? pt.z : 0;
                rawPins.push({
                    kind: 'occ',
                    x: px,
                    y: py,
                    z: pz,
                    col: colorForEntity(occ.name, state?.entity_state),
                    initials: occ.name.split(/\s+/).map((w2) => w2[0]).join('').slice(0, 2).toUpperCase(),
                    title: `${occ.name} ${occ.pos || ''} in ${room.name}${pz > 0.2 ? ` (↑${Math.round(pz * 10) / 10}m)` : ''}`,
                });
            });

            if (isUserHere) {
                const ux = userLocalPos ? box.x1 + userLocalPos.x : box.x1 + w / 2;
                const uy = userLocalPos ? box.y1 + userLocalPos.y : box.y1 + h / 2;
                const uz = userLocalPos ? userLocalPos.z : 0;
                rawPins.push({
                    kind: 'user',
                    x: ux,
                    y: uy,
                    z: uz,
                    title: `YOU (${state?.world?.user_pos || 'center'})${uz > 0.2 ? ` ↑${Math.round(uz * 10) / 10}m` : ''}`,
                });
            }

            const spreadPins = spreadRoomMarkers(rawPins, box, roomClearMap.get(room.id) || 0);
            for (const p of spreadPins) {
                const elevBadge = p.z > 0.2
                    ? `<text x="${(p.sx + 0.85).toFixed(2)}" y="${(p.sy - 0.55).toFixed(2)}" fill="var(--ist-cyan, #89dceb)" font-size="0.56" font-weight="700">↑${Math.round(p.z * 10) / 10}</text>`
                    : '';
                if (p.kind === 'user') {
                    markers.push(`
                        <g pointer-events="all">
                            <polygon points="${p.sx.toFixed(2)},${(p.sy - 1.05).toFixed(2)} ${(p.sx + 0.92).toFixed(2)},${(p.sy + 0.72).toFixed(2)} ${(p.sx - 0.92).toFixed(2)},${(p.sy + 0.72).toFixed(2)}"
                                     fill="var(--ist-cyan)" stroke="#11111b" stroke-width="0.22">
                                <title>${escHtml(p.title)}</title>
                            </polygon>
                            ${elevBadge}
                        </g>
                    `);
                } else {
                    markers.push(`
                        <g pointer-events="all">
                            <circle cx="${p.sx.toFixed(2)}" cy="${p.sy.toFixed(2)}" r="0.82" fill="${p.col}" stroke="var(--ist-crust)" stroke-width="0.2">
                                <title>${escHtml(p.title)}</title>
                            </circle>
                            <text x="${p.sx.toFixed(2)}" y="${(p.sy + 0.28).toFixed(2)}" text-anchor="middle" fill="#11111b" font-size="0.66" font-weight="700">${escHtml(p.initials)}</text>
                            ${elevBadge}
                        </g>
                    `);
                }
            }
        }

        const baseVb = { x: vx, y: vy, w: vw, h: vh };
        const curVb = computeSvgViewBox(baseVb, svgCamera);

        viewportHtml = `
            <div class="lpe-atlas-svg-wrap">
                <div class="lpe-atlas-svg-stage">
                    <svg class="lpe-atlas-svg" data-base-vb="${vx} ${vy} ${vw} ${vh}" viewBox="${curVb.x.toFixed(3)} ${curVb.y.toFixed(3)} ${curVb.w.toFixed(3)} ${curVb.h.toFixed(3)}" preserveAspectRatio="xMidYMid meet">
                        <defs>${defsHtml.join('')}</defs>
                        ${gridLines.join('')}
                        ${roomRects.join('')}
                        ${propOutlines.join('')}
                        ${doorDots.join('')}
                        ${markers.join('')}
                        ${roomLabels.join('')}
                    </svg>
                    <div class="lpe-svg-controls">
                        <button type="button" class="lpe-svg-btn" data-svg-act="in" title="Zoom in">+</button>
                        <span class="lpe-svg-zoom-lbl">${Math.round(curVb.zoom * 100)}%</span>
                        <button type="button" class="lpe-svg-btn" data-svg-act="out" title="Zoom out">−</button>
                        <button type="button" class="lpe-svg-btn" data-svg-act="reset" title="Reset camera">Reset</button>
                    </div>
                    <div class="lpe-svg-hint">Wheel: Zoom · Drag: Pan · Click room: Inspect</div>
                </div>
                <div class="lpe-atlas-legend">
                    <span><i class="lpe-dot" style="background:var(--ist-cyan)"></i> You (${escHtml(state?.world?.user_pos || '?')})</span>
                    <span><i class="lpe-dot" style="background:var(--ist-yellow)"></i> Doorway</span>
                    <span><i class="lpe-dot" style="background:var(--ist-green)"></i> Main Exit</span>
                    <span><i class="lpe-dot" style="border:1px dashed var(--ist-border);background:transparent"></i> Loaded / Unentered</span>
                </div>
            </div>
        `;
    } else {
        viewportHtml = `<div class="lpe-empty">No positioned room coordinates on this floor yet.</div>`;
    }

    const detailRoom = visibleRooms.find((r) => r.id === selectedRoomId) || floorRooms.find((r) => r.id === selectedRoomId) || userRoom || floorRooms[0] || visibleRooms[0] || null;
    let objectsRowHtml = '';
    if (detailRoom) {
        const explicitObjs = Array.isArray(detailRoom.objects) ? detailRoom.objects : [];
        const shownObjs = explicitObjs.length > 0
            ? explicitObjs
            : inferObjectsFromFeatures(detailRoom, computeBbox(detailRoom.grid, detailRoom.dim));
        const objTag = explicitObjs.length > 0 ? 'explicit' : 'auto-inferred';
        const objPills = shownObjs.length
            ? shownObjs.map((o) => {
                const col = resolveMaterialColor(o.color);
                const posStr = Array.isArray(o.pos)
                    ? `[${o.pos[0]},${o.pos[1]}${Number(o.pos[2]) ? `,${o.pos[2]}` : ''}]`
                    : '';
                return `<span class="lpe-pill" style="margin:1px 3px 1px 0;"><i class="lpe-dot" style="background:${escHtml(col)}"></i> [${escHtml(o.shape)}] ${escHtml(o.label)} ${escHtml(posStr)}</span>`;
            }).join('')
            : '∅';
        objectsRowHtml = `<div class="wide"><span>3D Objects (${objTag})</span><b>${objPills}</b></div>`;
    }

    const detailHeight = detailRoom ? parseRoomHeight(detailRoom) : null;
    const roomDetailHtml = detailRoom ? `
        <div class="lpe-atlas-detail">
            <div class="lpe-atlas-detail-head">
                <strong>${escHtml(detailRoom.name || detailRoom.id)}</strong>
                <span class="lpe-pill">${escHtml(detailRoom.id)}</span>
                <span class="lpe-pill">${escHtml(detailRoom.dim || '?')}</span>
                <span class="lpe-pill">Grid ${escHtml(detailRoom.grid || '?')}</span>
                ${detailHeight?.elev ? `<span class="lpe-pill">Elev ${detailHeight.elev > 0 ? '+' : ''}${detailHeight.elev}m</span>` : ''}
                ${detailRoom.style ? `<span class="lpe-pill">${escHtml(detailRoom.style)}</span>` : ''}
                ${detailRoom.kind === 'load' ? '<span class="lpe-pill warn">Loaded</span>' : '<span class="lpe-pill ok">Rendered</span>'}
            </div>
            <div class="lpe-kv-grid">
                <div><span>Features</span><b>${escHtml(detailRoom.features || '∅')}</b></div>
                <div><span>Occupants</span><b>${escHtml(detailRoom.occupants || '∅')}</b></div>
                <div><span>Exits</span><b>${escHtml(detailRoom.exits || '∅')}</b></div>
                <div><span>Adjacent</span><b>${escHtml(detailRoom.adj || '∅')}</b></div>
                ${objectsRowHtml}
            </div>
        </div>
    ` : '';

    const mapOptions = (maps.length ? maps : [{ id: activeMapId || 'default', name: activeMapId || 'Current Map' }]).map((m) =>
        `<option value="${escHtml(m.id)}" ${m.id === activeMapId ? 'selected' : ''}>${escHtml(m.name || m.id)}${m.id === loc.map_index?.active_map_id ? ' ★' : ''}</option>`,
    ).join('');

    const floorBtns = floors.map(([z, label]) =>
        `<button type="button" class="lpe-atlas-floor-btn ${z === activeFloor && !(is3dMode && allFloors) ? 'active' : ''}" data-level="${escHtml(z)}">Z=${escHtml(z)} · ${escHtml(label)}</button>`,
    ).join('');

    const allFloorsBtn = is3dMode && floors.length > 1
        ? `<button type="button" class="lpe-atlas-allfloors-btn ${allFloors ? 'active' : ''}" title="Stack all floors in 3D"><i class="fa-solid fa-layer-group"></i> All Floors</button>`
        : '';

    const webglBtn = allowWebgl
        ? `<button type="button" class="lpe-atlas-mode-btn ${mode === 'webgl' ? 'active' : ''}" data-atlas-mode="webgl" title="Hybrid Three.js WebGL view"><i class="fa-solid fa-cube"></i> 3D WebGL</button>`
        : `<button type="button" class="lpe-atlas-mode-btn lpe-atlas-open-webgl-btn" data-open-webgl="1" title="Open interactive 3D WebGL Atlas in Control Center"><i class="fa-solid fa-wand-magic-sparkles"></i> Open WebGL</button>`;

    const modeSwitcher = `
        <div class="lpe-atlas-mode-seg">
            ${webglBtn}
            <button type="button" class="lpe-atlas-mode-btn ${mode === '3d' ? 'active' : ''}" data-atlas-mode="3d" title="3D CSS (PolyCSS) view"><i class="fa-solid fa-cubes"></i> 3D CSS</button>
            <button type="button" class="lpe-atlas-mode-btn ${mode === '2d' ? 'active' : ''}" data-atlas-mode="2d" title="2D SVG floorplan view"><i class="fa-solid fa-vector-square"></i> 2D SVG</button>
        </div>
    `;

    const roomListHtml = visibleRooms.length ? `
        <div class="lpe-atlas-room-pills">
            ${visibleRooms.map((r) => `<button type="button" class="lpe-atlas-room-pill ${detailRoom?.id === r.id ? 'active' : ''}" data-room-id="${escHtml(r.id)}">${escHtml(r.name || r.id)}</button>`).join('')}
        </div>
    ` : '';

    return `
        <div class="lpe-atlas-container">
            <div class="lpe-atlas-toolbar">
                <label>Map: <select class="lpe-atlas-map-sel">${mapOptions}</select></label>
                <div class="lpe-atlas-floors">${floorBtns}${allFloorsBtn}</div>
                ${modeSwitcher}
                <span class="lpe-muted" style="margin-left:auto;">Main Exit: ${escHtml(currentMap.main_exit || '∅')}</span>
            </div>
            ${roomListHtml}
            ${viewportHtml}
            ${unpositioned.length ? `<div class="lpe-muted" style="margin-top:6px;">Unscaled rooms: ${unpositioned.map((r) => escHtml(r.name || r.id)).join(', ')}</div>` : ''}
            ${roomDetailHtml}
        </div>
    `;
}

/**
 * Attach zoom/pan controls to a rendered 2D SVG Atlas viewport without breaking
 * room click inspection (`< 5px` pointer movement still triggers click).
 */
export function bindAtlasSvgControls(wrapEl, svgCamState = { zoom: 1, panX: 0, panY: 0 }, { onCameraChange } = {}) {
    if (!wrapEl) return;
    const stage = wrapEl.classList?.contains('lpe-atlas-svg-stage')
        ? wrapEl
        : wrapEl.querySelector?.('.lpe-atlas-svg-stage');
    if (!stage) return;
    const svg = stage.querySelector('.lpe-atlas-svg');
    if (!svg) return;
    if (stage.dataset.lpeSvgBound === '1') return;
    stage.dataset.lpeSvgBound = '1';

    const rawVb = String(svg.getAttribute('data-base-vb') || svg.getAttribute('viewBox') || '0 0 20 20')
        .trim()
        .split(/\s+/)
        .map(Number);
    const baseVb = rawVb.length >= 4 && rawVb.every(Number.isFinite)
        ? { x: rawVb[0], y: rawVb[1], w: Math.max(1, rawVb[2]), h: Math.max(1, rawVb[3]) }
        : { x: 0, y: 0, w: 20, h: 20 };

    const cam = svgCamState && typeof svgCamState === 'object'
        ? svgCamState
        : { zoom: 1, panX: 0, panY: 0 };
    if (!Number.isFinite(cam.zoom)) cam.zoom = 1;
    if (!Number.isFinite(cam.panX)) cam.panX = 0;
    if (!Number.isFinite(cam.panY)) cam.panY = 0;

    const zoomLbl = stage.querySelector('.lpe-svg-zoom-lbl');
    let suppressClickUntil = 0;

    const apply = (emit = false) => {
        const vb = computeSvgViewBox(baseVb, cam);
        cam.zoom = vb.zoom;
        cam.panX = vb.panX;
        cam.panY = vb.panY;
        svg.setAttribute('viewBox', `${vb.x.toFixed(3)} ${vb.y.toFixed(3)} ${vb.w.toFixed(3)} ${vb.h.toFixed(3)}`);
        if (zoomLbl) zoomLbl.textContent = `${Math.round(cam.zoom * 100)}%`;
        if (emit && typeof onCameraChange === 'function') {
            onCameraChange({ zoom: cam.zoom, panX: cam.panX, panY: cam.panY });
        }
    };

    stage.querySelectorAll('.lpe-svg-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const act = btn.dataset.svgAct;
            if (act === 'in') cam.zoom *= 1.28;
            else if (act === 'out') cam.zoom /= 1.28;
            else if (act === 'reset') {
                cam.zoom = 1;
                cam.panX = 0;
                cam.panY = 0;
            }
            apply(true);
        });
    });

    svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
        const oldVb = computeSvgViewBox(baseVb, cam);
        const rect = svg.getBoundingClientRect();
        let nextPanX = cam.panX;
        let nextPanY = cam.panY;
        if (rect.width > 0 && rect.height > 0) {
            const nx = (e.clientX - rect.left) / rect.width;
            const ny = (e.clientY - rect.top) / rect.height;
            const worldX = oldVb.x + nx * oldVb.w;
            const worldY = oldVb.y + ny * oldVb.h;
            const newZoom = clamp(cam.zoom * factor, 0.35, 8);
            const newW = baseVb.w / newZoom;
            const newH = baseVb.h / newZoom;
            const newX = worldX - nx * newW;
            const newY = worldY - ny * newH;
            nextPanX = (newX + newW / 2) - (baseVb.x + baseVb.w / 2);
            nextPanY = (newY + newH / 2) - (baseVb.y + baseVb.h / 2);
            cam.zoom = newZoom;
            cam.panX = nextPanX;
            cam.panY = nextPanY;
        } else {
            cam.zoom *= factor;
        }
        apply(true);
    }, { passive: false });

    let dragging = false;
    let didPan = false;
    let startX = 0;
    let startY = 0;
    let startPanX = 0;
    let startPanY = 0;
    let startVb = null;

    const endDrag = () => {
        if (!dragging) return;
        dragging = false;
        window.removeEventListener('pointerup', endDrag);
        window.removeEventListener('pointercancel', endDrag);
        stage.classList.remove('is-panning');
        if (didPan) {
            suppressClickUntil = Date.now() + 180;
            apply(true);
        }
        didPan = false;
    };

    svg.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
        dragging = true;
        didPan = false;
        startX = e.clientX;
        startY = e.clientY;
        startPanX = cam.panX;
        startPanY = cam.panY;
        startVb = computeSvgViewBox(baseVb, cam);
        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);
    });

    svg.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dxPx = e.clientX - startX;
        const dyPx = e.clientY - startY;
        if (!didPan && Math.hypot(dxPx, dyPx) < 5) return;
        didPan = true;
        stage.classList.add('is-panning');
        const rect = svg.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            // preserveAspectRatio="xMidYMid meet" uniform scale
            const pxPerUnit = Math.min(rect.width / startVb.w, rect.height / startVb.h) || 1;
            cam.panX = startPanX - dxPx / pxPerUnit;
            cam.panY = startPanY - dyPx / pxPerUnit;
            apply(false);
        }
    });

    svg.addEventListener('click', (e) => {
        if (Date.now() < suppressClickUntil) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    svg.addEventListener('dblclick', (e) => {
        if (e.target.closest?.('.lpe-svg-controls')) return;
        cam.zoom = 1;
        cam.panX = 0;
        cam.panY = 0;
        apply(true);
    });

    apply(false);
}
