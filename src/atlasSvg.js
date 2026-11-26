/**
 * Interactive Atlas renderer for Vexa (<state:locations>).
 * Supports both PolyCSS 3D CSS scenes (default) and 2D SVG floorplans.
 * Pure HTML/SVG generator (no jQuery required so unit tests can inspect output too).
 */

import { PALETTE, isEmptySentinel } from './schema.js';
import { computeBbox, parseOccupantsList } from './reducer.js';
import { renderAtlas3DViewport, inferObjectsFromFeatures } from './atlas3d.js';
import { resolveMaterialColor } from './polyCss3d.js';

function escHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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
    const userLocalPos = parseLocalPoint(state?.world?.user_pos);

    let viewportHtml = '';
    if (mode === 'webgl') {
        viewportHtml = `
            <div class="vse-webgl-viewport" data-map-id="${escHtml(activeMapId)}" data-level="${escHtml(activeFloor)}">
                <canvas class="vse-webgl-canvas"></canvas>
                <div class="vse-webgl-labels"></div>
                <div class="vse-webgl-hud-overlay">
                    <span class="vse-webgl-chip">${escHtml(currentMap.name || activeMapId || 'Atlas')} · ${allFloors ? 'All Floors' : `Z=${escHtml(activeFloor)}`} · ${visibleRooms.length} room${visibleRooms.length === 1 ? '' : 's'}</span>
                    <span class="vse-webgl-chip">Orbit: Drag · Pan: Shift+Drag · Zoom: Wheel</span>
                </div>
                <div class="vse-webgl-controls">
                    <button type="button" class="vse-webgl-btn" data-webgl-act="iso" title="Isometric view">Iso</button>
                    <button type="button" class="vse-webgl-btn" data-webgl-act="top" title="Top-down view">Top</button>
                    <button type="button" class="vse-webgl-btn" data-webgl-act="in" title="Zoom in">+</button>
                    <button type="button" class="vse-webgl-btn" data-webgl-act="out" title="Zoom out">−</button>
                    <button type="button" class="vse-webgl-btn" data-webgl-act="reset" title="Reset camera">Reset</button>
                    <button type="button" class="vse-webgl-btn vse-poly-cutaway-btn ${cutaway ? 'active' : ''}" title="Toggle cutaway walls">Cut</button>
                    <button type="button" class="vse-webgl-btn vse-poly-labels-btn ${showLabels ? 'active' : ''}" title="Toggle 3D labels">Labels</button>
                </div>
            </div>
            <div class="vse-webgl-footer-note">
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

        // 5m gridlines
        const gridLines = [];
        for (let gx = Math.floor(vx / 5) * 5; gx <= vx + vw; gx += 5) {
            gridLines.push(`<line x1="${gx}" y1="${vy}" x2="${gx}" y2="${vy + vh}" stroke="var(--ist-border)" stroke-opacity="0.22" stroke-width="0.15" />`);
        }
        for (let gy = Math.floor(vy / 5) * 5; gy <= vy + vh; gy += 5) {
            gridLines.push(`<line x1="${vx}" y1="${gy}" x2="${vx + vw}" y2="${gy}" stroke="var(--ist-border)" stroke-opacity="0.22" stroke-width="0.15" />`);
        }

        const roomRects = [];
        const doorDots = [];
        const markers = [];

        for (const { room, box } of positioned) {
            const w = box.x2 - box.x1;
            const h = box.y2 - box.y1;
            const isUserHere = userRoom && userRoom.id === room.id;
            const isSelected = selectedRoomId === room.id;
            const isLoaded = room.kind === 'load';
            const stroke = isSelected ? 'var(--ist-yellow)' : isUserHere ? 'var(--ist-blue)' : 'var(--ist-border)';
            const fill = isUserHere ? 'var(--ist-surface)' : 'var(--ist-mantle)';
            const dash = isLoaded ? 'stroke-dasharray="0.8 0.5"' : '';

            roomRects.push(`
                <g class="vse-atlas-room-g" data-room-id="${escHtml(room.id)}" style="cursor:pointer;">
                    <rect x="${box.x1}" y="${box.y1}" width="${w}" height="${h}" rx="0.6"
                          fill="${fill}" fill-opacity="${isUserHere ? '0.92' : '0.78'}"
                          stroke="${stroke}" stroke-width="${isSelected || isUserHere ? '0.45' : '0.28'}" ${dash} />
                    <text x="${box.x1 + w / 2}" y="${box.y1 + Math.min(2.6, h * 0.36)}"
                          text-anchor="middle" fill="var(--ist-title)" font-size="${Math.max(1.15, Math.min(2.1, w * 0.095))}" font-weight="600">
                        ${escHtml(room.name || room.id)}
                    </text>
                    <text x="${box.x1 + w / 2}" y="${box.y1 + Math.min(4.6, h * 0.36 + 1.8)}"
                          text-anchor="middle" fill="var(--ist-muted)" font-size="1.1">
                        ${escHtml(room.dim)}
                    </text>
                </g>
            `);

            // Exits / doorways
            for (const ex of parseExitsCoords(room.exits)) {
                doorDots.push(
                    `<circle cx="${ex.x}" cy="${ex.y}" r="${ex.isMain ? '0.85' : '0.55'}"
                             fill="${ex.isMain ? 'var(--ist-green)' : 'var(--ist-yellow)'}" stroke="var(--ist-crust)" stroke-width="0.18">
                        <title>${escHtml(`${ex.dir}: ${ex.target} [${ex.x},${ex.y}]`)}</title>
                    </circle>`,
                );
            }

            // Occupants
            const occs = parseOccupantsList(room.occupants);
            occs.forEach((occ, idx) => {
                const pt = parseLocalPoint(occ.pos);
                const ox = pt ? Math.max(box.x1 + 0.8, Math.min(box.x2 - 0.8, box.x1 + pt.x)) : (box.x1 + 2 + (idx % 3) * 2.5);
                const oy = pt ? Math.max(box.y1 + 0.8, Math.min(box.y2 - 0.8, box.y1 + pt.y)) : (box.y1 + h - 2);
                const col = colorForEntity(occ.name, state?.entity_state);
                const initials = occ.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
                markers.push(`
                    <g>
                        <circle cx="${ox}" cy="${oy}" r="0.9" fill="${col}" stroke="var(--ist-crust)" stroke-width="0.22">
                            <title>${escHtml(`${occ.name} ${occ.pos || ''} in ${room.name}`)}</title>
                        </circle>
                        <text x="${ox}" y="${oy + 0.32}" text-anchor="middle" fill="#11111b" font-size="0.72" font-weight="700">${escHtml(initials)}</text>
                    </g>
                `);
            });

            // User marker
            if (isUserHere) {
                const ux = userLocalPos ? Math.max(box.x1 + 0.8, Math.min(box.x2 - 0.8, box.x1 + userLocalPos.x)) : box.x1 + w / 2;
                const uy = userLocalPos ? Math.max(box.y1 + 0.8, Math.min(box.y2 - 0.8, box.y1 + userLocalPos.y)) : box.y1 + h / 2;
                markers.push(`
                    <g>
                        <polygon points="${ux},${uy - 1.15} ${ux + 1.0},${uy + 0.8} ${ux - 1.0},${uy + 0.8}"
                                 fill="var(--ist-cyan)" stroke="#11111b" stroke-width="0.22">
                            <title>YOU (${escHtml(state?.world?.user_pos || 'center')})</title>
                        </polygon>
                    </g>
                `);
            }
        }

        viewportHtml = `
            <div class="vse-atlas-svg-wrap">
                <svg class="vse-atlas-svg" viewBox="${vx} ${vy} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet">
                    ${gridLines.join('')}
                    ${roomRects.join('')}
                    ${doorDots.join('')}
                    ${markers.join('')}
                </svg>
                <div class="vse-atlas-legend">
                    <span><i class="vse-dot" style="background:var(--ist-cyan)"></i> You (${escHtml(state?.world?.user_pos || '?')})</span>
                    <span><i class="vse-dot" style="background:var(--ist-yellow)"></i> Doorway</span>
                    <span><i class="vse-dot" style="background:var(--ist-green)"></i> Main Exit</span>
                    <span><i class="vse-dot" style="border:1px dashed var(--ist-border);background:transparent"></i> Loaded / Unentered</span>
                </div>
            </div>
        `;
    } else {
        viewportHtml = `<div class="vse-empty">No positioned room coordinates on this floor yet.</div>`;
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
                const posStr = Array.isArray(o.pos) ? `[${o.pos[0]},${o.pos[1]}]` : '';
                return `<span class="vse-pill" style="margin:1px 3px 1px 0;"><i class="vse-dot" style="background:${escHtml(col)}"></i> [${escHtml(o.shape)}] ${escHtml(o.label)} ${escHtml(posStr)}</span>`;
            }).join('')
            : '∅';
        objectsRowHtml = `<div class="wide"><span>3D Objects (${objTag})</span><b>${objPills}</b></div>`;
    }

    const roomDetailHtml = detailRoom ? `
        <div class="vse-atlas-detail">
            <div class="vse-atlas-detail-head">
                <strong>${escHtml(detailRoom.name || detailRoom.id)}</strong>
                <span class="vse-pill">${escHtml(detailRoom.id)}</span>
                <span class="vse-pill">${escHtml(detailRoom.dim || '?')}</span>
                <span class="vse-pill">Grid ${escHtml(detailRoom.grid || '?')}</span>
                ${detailRoom.style ? `<span class="vse-pill">${escHtml(detailRoom.style)}</span>` : ''}
                ${detailRoom.kind === 'load' ? '<span class="vse-pill warn">Loaded</span>' : '<span class="vse-pill ok">Rendered</span>'}
            </div>
            <div class="vse-kv-grid">
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
        `<button type="button" class="vse-atlas-floor-btn ${z === activeFloor && !(is3dMode && allFloors) ? 'active' : ''}" data-level="${escHtml(z)}">Z=${escHtml(z)} · ${escHtml(label)}</button>`,
    ).join('');

    const allFloorsBtn = is3dMode && floors.length > 1
        ? `<button type="button" class="vse-atlas-allfloors-btn ${allFloors ? 'active' : ''}" title="Stack all floors in 3D"><i class="fa-solid fa-layer-group"></i> All Floors</button>`
        : '';

    const webglBtn = allowWebgl
        ? `<button type="button" class="vse-atlas-mode-btn ${mode === 'webgl' ? 'active' : ''}" data-atlas-mode="webgl" title="Hybrid Three.js WebGL view"><i class="fa-solid fa-cube"></i> 3D WebGL</button>`
        : `<button type="button" class="vse-atlas-mode-btn vse-atlas-open-webgl-btn" data-open-webgl="1" title="Open interactive 3D WebGL Atlas in Control Center"><i class="fa-solid fa-wand-magic-sparkles"></i> Open WebGL</button>`;

    const modeSwitcher = `
        <div class="vse-atlas-mode-seg">
            ${webglBtn}
            <button type="button" class="vse-atlas-mode-btn ${mode === '3d' ? 'active' : ''}" data-atlas-mode="3d" title="3D CSS (PolyCSS) view"><i class="fa-solid fa-cubes"></i> 3D CSS</button>
            <button type="button" class="vse-atlas-mode-btn ${mode === '2d' ? 'active' : ''}" data-atlas-mode="2d" title="2D SVG floorplan view"><i class="fa-solid fa-vector-square"></i> 2D SVG</button>
        </div>
    `;

    const roomListHtml = visibleRooms.length ? `
        <div class="vse-atlas-room-pills">
            ${visibleRooms.map((r) => `<button type="button" class="vse-atlas-room-pill ${detailRoom?.id === r.id ? 'active' : ''}" data-room-id="${escHtml(r.id)}">${escHtml(r.name || r.id)}</button>`).join('')}
        </div>
    ` : '';

    return `
        <div class="vse-atlas-container">
            <div class="vse-atlas-toolbar">
                <label>Map: <select class="vse-atlas-map-sel">${mapOptions}</select></label>
                <div class="vse-atlas-floors">${floorBtns}${allFloorsBtn}</div>
                ${modeSwitcher}
                <span class="vse-muted" style="margin-left:auto;">Main Exit: ${escHtml(currentMap.main_exit || '∅')}</span>
            </div>
            ${roomListHtml}
            ${viewportHtml}
            ${unpositioned.length ? `<div class="vse-muted" style="margin-top:6px;">Unscaled rooms: ${unpositioned.map((r) => escHtml(r.name || r.id)).join(', ')}</div>` : ''}
            ${roomDetailHtml}
        </div>
    `;
}
