/**
 * Hybrid Three.js WebGL Atlas Renderer + Textured CC BY 4.0 Kit Integration.
 *
 * Code (CC BY-NC 4.0): procedural geometry, wall/doorway CSG-style splitting, orbit controls, lighting.
 * Bundled 3D assets (CC BY 4.0 — see assets/models/ATTRIBUTION.md):
 *   - assets/models/psx-industrial.glb (Tomitos — PSX Industrial Pack)
 *   - assets/models/scifi-lab-props.glb (Agata Wilczek — Sci-fi lab)
 */

import * as THREE from '../lib/three/three.module.js';
import { GLTFLoader } from '../lib/three/GLTFLoader.js';
import { RoomEnvironment } from '../lib/three/RoomEnvironment.js';
import { computeBbox, parseDimMeters, parseOccupantsList } from './reducer.js';
import { inferRoomStyle, inferObjectsFromFeatures } from './atlas3d.js';
import { resolveMaterialColor, shadeHex } from './polyCss3d.js';
import { PALETTE, isEmptySentinel } from './schema.js';
import {
    parseLocalPoint3D,
    parseRoomHeight,
    clampObjectToRoom,
    buildAtlasTopology,
} from './atlasTopology.js';

const PSX_GLB_URL = new URL('../assets/models/psx-industrial.glb', import.meta.url).href;
const SCIFI_GLB_URL = new URL('../assets/models/scifi-lab-props.glb', import.meta.url).href;

/**
 * Canonical catalog mapping normalized object shapes (plus style variants) to
 * bundled GLB nodes or MIT procedural prefabs.
 */
export const WEBGL_KIT_CATALOG = Object.freeze({
    // PSX Industrial Pack (Tomitos, CC BY 4.0)
    container: { pack: 'psx', node: 'CargoContainer', preRotY: 0, author: 'Tomitos', license: 'CC BY 4.0' },
    barrel: {
        pack: 'psx',
        node: 'BarrelWine',
        styleNodes: { industrial: 'BarrelOil', scifi: 'BarrelWater', tavern: 'BarrelWine', medieval: 'BarrelWine' },
        preRotY: 0,
        author: 'Tomitos',
        license: 'CC BY 4.0',
    },
    crate: {
        pack: 'psx',
        node: 'CrateWood',
        styleNodes: { industrial: 'CrateMetal', scifi: 'CrateMetal2', street: 'CrateWood2' },
        preRotY: 0,
        author: 'Tomitos',
        license: 'CC BY 4.0',
    },
    dumpster: { pack: 'psx', node: 'Dumpster', preRotY: Math.PI / 2, author: 'Tomitos', license: 'CC BY 4.0' },
    generator: {
        pack: 'psx',
        node: 'GeneratorUnit',
        styleNodes: { cave: 'GeneratorPortable', street: 'GeneratorPortable' },
        preRotY: 0,
        author: 'Tomitos',
        license: 'CC BY 4.0',
    },
    locker: { pack: 'psx', node: 'Locker', preRotY: 0, author: 'Tomitos', license: 'CC BY 4.0' },
    pallet: { pack: 'psx', node: 'Pallet', preRotY: Math.PI / 2, author: 'Tomitos', license: 'CC BY 4.0' },
    propane: { pack: 'psx', node: 'PropaneTankSmall', preRotY: 0, author: 'Tomitos', license: 'CC BY 4.0' },
    pipes: {
        pack: 'psx',
        node: 'ConcretePipePile',
        styleNodes: { scifi: 'MetalPipe' },
        preRotY: Math.PI / 2,
        author: 'Tomitos',
        license: 'CC BY 4.0',
    },
    bin: { pack: 'psx', node: 'TrashCan', preRotY: 0, author: 'Tomitos', license: 'CC BY 4.0' },

    // Sci-fi Lab Props (Agata Wilczek, CC BY 4.0)
    vat: { pack: 'scifi', node: 'sci_vat', preRotY: 0, author: 'Agata Wilczek', license: 'CC BY 4.0' },
    console: { pack: 'scifi', node: 'sci_console', preRotY: Math.PI / 2, author: 'Agata Wilczek', license: 'CC BY 4.0' },
    cabinet: { pack: 'scifi', node: 'sci_cabinet', preRotY: Math.PI / 2, author: 'Agata Wilczek', license: 'CC BY 4.0' },
    airlock: { pack: 'scifi', node: 'sci_airlock', preRotY: 0, author: 'Agata Wilczek', license: 'CC BY 4.0' },
    screen: { pack: 'scifi', node: 'sci_screen', preRotY: Math.PI / 2, author: 'Agata Wilczek', license: 'CC BY 4.0' },
    jar: { pack: 'scifi', node: 'sci_jar', preRotY: 0, author: 'Agata Wilczek', license: 'CC BY 4.0' },
});

const DEFAULT_OBJ_SIZES = Object.freeze({
    table: [1.6, 1.0, 0.78],
    chair: [0.58, 0.58, 0.92],
    couch: [2.1, 0.9, 0.85],
    bed: [1.5, 2.1, 0.72],
    bookshelf: [1.6, 0.48, 2.25],
    desk: [1.55, 0.8, 0.78],
    hearth: [1.9, 0.9, 2.3],
    brazier: [0.75, 0.75, 1.05],
    lamp: [0.48, 0.48, 1.65],
    chest: [0.95, 0.58, 0.56],
    tree: [1.9, 1.9, 3.2],
    crystal: [1.0, 1.0, 2.1],
    ladder: [0.65, 0.25, 2.6],
    hourglass: [0.55, 0.55, 1.2],
    container: [5.2, 2.2, 2.45],
    barrel: [0.7, 0.7, 1.02],
    crate: [0.95, 0.95, 0.95],
    dumpster: [2.1, 1.3, 1.25],
    generator: [1.7, 1.15, 1.45],
    pallet: [1.3, 1.05, 0.2],
    propane: [0.48, 0.48, 1.12],
    pipes: [2.1, 0.6, 1.85],
    locker: [0.9, 0.52, 2.0],
    vat: [1.35, 1.35, 2.55],
    console: [2.1, 0.88, 1.38],
    cabinet: [1.05, 0.58, 2.05],
    airlock: [2.3, 0.65, 2.45],
    screen: [1.95, 0.24, 1.35],
    box: [1.0, 1.0, 1.0],
    cylinder: [0.9, 0.9, 1.0],
    cone: [0.9, 0.9, 1.1],
    pyramid: [1.0, 1.0, 1.0],
    sphere: [0.9, 0.9, 0.9],
    slab: [1.4, 1.2, 0.14],
    arch: [1.6, 0.55, 2.1],
    stairs: [1.35, 2.1, 1.6],
    wall: [2.4, 0.3, 2.2],
    plane: [1.8, 1.8, 0.04],
    platform: [3.2, 2.2, 0.25],
});

const packCache = new Map();

function loadGlbPack(packId, url) {
    if (packCache.has(packId)) return packCache.get(packId);
    const loader = new GLTFLoader();
    const p = new Promise((resolve) => {
        loader.load(
            url,
            (gltf) => resolve(gltf?.scene || null),
            undefined,
            () => resolve(null),
        );
    });
    packCache.set(packId, p);
    return p;
}

const STYLE_COLORS = Object.freeze({
    indoor: { floor: '#2f2924', wall: '#4a4037', trim: '#8b6f4e', accent: '#d97706' },
    outdoor: { floor: '#253528', wall: '#3e4a40', trim: '#65a30d', accent: '#84cc16', curbOnly: true },
    tower: { floor: '#2a303d', wall: '#414b5c', trim: '#64748b', accent: '#f59e0b' },
    wagon: { floor: '#3f2e21', wall: '#5c4230', trim: '#92400e', accent: '#fbbf24' },
    stone: { floor: '#2a303d', wall: '#3e4756', trim: '#64748b', accent: '#94a3b8' },
    medieval: { floor: '#382a20', wall: '#544134', trim: '#8b6f4e', accent: '#d97706' },
    tavern: { floor: '#442b1c', wall: '#5c3c27', trim: '#92400e', accent: '#f59e0b' },
    wood: { floor: '#463222', wall: '#5e432d', trim: '#85583a', accent: '#d97706' },
    scifi: { floor: '#182234', wall: '#28364f', trim: '#38bdf8', accent: '#22d3ee' },
    industrial: { floor: '#232830', wall: '#3b4252', trim: '#eab308', accent: '#f97316' },
    street: { floor: '#262930', wall: '#3f4451', trim: '#94a3b8', accent: '#f59e0b' },
    nature: { floor: '#1f3622', wall: '#2e4a31', trim: '#65a30d', accent: '#22c55e', curbOnly: true },
    cave: { floor: '#27242b', wall: '#3c3642', trim: '#78716c', accent: '#f97316' },
    water: { floor: '#133146', wall: '#1f4e6d', trim: '#38bdf8', accent: '#7dd3fc', curbOnly: true },
    luxury: { floor: '#36192b', wall: '#522540', trim: '#eab308', accent: '#f472b6' },
});

function inferWebglTheme(room) {
    const baseStyle = inferRoomStyle(room);
    if (baseStyle === 'outdoor' || baseStyle === 'water') return baseStyle;
    const objShapes = Array.isArray(room?.objects) ? room.objects.map((o) => o?.shape || '').join(' ') : '';
    const blob = `${room?.style || ''} ${room?.name || ''} ${room?.features || ''} ${objShapes}`.toLowerCase();
    if (/\b(scifi|sci-fi|cryo|biovat|vat|airlock|viewscreen|console|lab|laboratory|corridor|sub-surface|containment|hive|bulkhead|reactor|sector|bunker|facility|terminal|umbrella)\b/.test(blob)) return 'scifi';
    if (/\b(industrial|cargo|warehouse|dumpster|generator|container|foundry|hangar|stairwell|shaft|freight|grating)\b/.test(blob)) return 'industrial';
    if (/\b(tavern|inn|alehouse|hearthroom)\b/.test(blob)) return 'tavern';
    if (/\b(medieval|library|archive|keep|solar|rookery|lord commander)\b/.test(blob)) return 'medieval';
    return baseStyle || 'stone';
}

function parseLocalPoint(str) {
    const m = String(str || '').match(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

function colorForEntity(name, entityStates = []) {
    const low = String(name || '').trim().toLowerCase();
    const found = (entityStates || []).find((e) => (e?.name || '').trim().toLowerCase() === low);
    if (found?.fontColor) {
        const hex = String(found.fontColor).match(/#[0-9a-f]{6}/i);
        if (hex) return hex[0];
        const colName = String(found.fontColor).toLowerCase();
        const pal = PALETTE.find((p) => colName.includes(p.name));
        if (pal?.hex) return pal.hex;
    }
    let h = 0;
    for (let i = 0; i < low.length; i++) h = (h * 31 + low.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length]?.hex || '#89b4fa';
}

function makeMat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: opts.roughness ?? 0.72,
        metalness: opts.metalness ?? 0.14,
        emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
        emissiveIntensity: opts.emissiveIntensity ?? (opts.emissive ? 1.15 : 0),
        transparent: Boolean(opts.transparent),
        opacity: opts.opacity ?? 1,
        side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    });
}

function makeFloorCheckerTexture(hexColor, roomStyle) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const base = shadeHex(hexColor, 0.94);
    const alt = shadeHex(hexColor, roomStyle === 'scifi' ? 1.12 : 1.07);
    const seam = shadeHex(hexColor, 0.62);

    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = alt;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillRect(64, 64, 64, 64);
    ctx.strokeStyle = seam;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 126, 126);
    ctx.beginPath();
    ctx.moveTo(64, 0);
    ctx.lineTo(64, 128);
    ctx.moveTo(0, 64);
    ctx.lineTo(128, 64);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

/**
 * Splits a straight wall segment `[ -wallSpan/2, +wallSpan/2 ]` around doorway openings
 * so callers can build solid full-height wall sections between openings and header lintels
 * above each doorway, leaving real floor-to-lintel holes through the wall.
 *
 * @param {number} wallSpan Total wall length along its primary axis (meters)
 * @param {number} wallHeight Total height of this wall (meters)
 * @param {Array<{center:number, width:number, height?:number}>} doorways Normalized openings along the wall
 * @returns {{ wallSegments: Array<{center:number, width:number, y0:number, height:number}>, lintels: Array<{center:number, width:number, y0:number, height:number}>, openings: Array<{center:number, left:number, right:number, width:number, height:number}> }}
 */
export function splitWallWithDoorways(wallSpan, wallHeight, doorways = []) {
    const span = Math.max(0.4, Number(wallSpan) || 4);
    const fullH = Math.max(0.4, Number(wallHeight) || 2.6);
    const half = span / 2;
    const minMargin = Math.min(0.08, span * 0.08);
    const usable = Math.max(0.08, span - minMargin * 2);

    const raw = (doorways || [])
        .map((d) => {
            const reqW = Number(d?.width) || 1.25;
            const minReq = usable >= 0.75 ? Math.max(0.75, reqW) : Math.max(0.08, reqW);
            const w = Math.min(usable, minReq);
            const rawCenter = Number.isFinite(Number(d?.center)) ? Number(d.center) : 0;
            const c = Math.max(-half + w / 2 + minMargin, Math.min(half - w / 2 - minMargin, rawCenter));
            const openH = Math.min(fullH, Math.max(0.4, Number(d?.height) || 2.12));
            return {
                ...d,
                center: c,
                left: c - w / 2,
                right: c + w / 2,
                width: w,
                height: openH,
                frameHeight: Math.max(openH, Number(d?.height) || 2.12),
            };
        })
        .sort((a, b) => a.left - b.left);

    const openings = [];
    for (const op of raw) {
        const prev = openings[openings.length - 1];
        if (prev && op.left < prev.right + 0.1) {
            prev.right = Math.max(prev.right, op.right);
            prev.width = prev.right - prev.left;
            prev.center = (prev.left + prev.right) / 2;
            prev.bottomOffset = Math.min(prev.bottomOffset || 0, Number(op.bottomOffset) || 0);
            prev.height = Math.max(prev.height, op.height);
            prev.frameHeight = Math.max(prev.frameHeight || 0, op.frameHeight || 0);
            prev._parts.push(op);
        } else {
            openings.push({ ...op, bottomOffset: Number(op.bottomOffset) || 0, _parts: [op] });
        }
    }

    const wallSegments = [];
    const lintels = [];
    let cursor = -half;

    for (const op of openings) {
        if (op.left - cursor > 0.04) {
            const w = op.left - cursor;
            wallSegments.push({
                center: cursor + w / 2,
                width: w,
                y0: 0,
                height: fullH,
            });
        }
        const cuts = new Set();
        for (const p of op._parts) {
            cuts.add(p.left);
            cuts.add(p.right);
        }
        const xs = [...cuts].sort((a, b) => a - b);
        for (let i = 0; i < xs.length - 1; i++) {
            const a = xs[i];
            const b = xs[i + 1];
            const w = b - a;
            if (w <= 0.02) continue;
            const mid = (a + b) / 2;
            let covTop = 0;
            let covBottom = Infinity;
            for (const p of op._parts) {
                if (mid >= p.left && mid <= p.right) {
                    const pBot = Math.max(0, Number(p.bottomOffset) || 0);
                    covBottom = Math.min(covBottom, pBot);
                    covTop = Math.max(covTop, pBot + p.height);
                }
            }
            const sillH = Number.isFinite(covBottom) ? Math.min(fullH, covBottom) : 0;
            const topY = Math.min(fullH, covTop || op.height);
            if (sillH > 0.05) {
                wallSegments.push({
                    center: mid,
                    width: w,
                    y0: 0,
                    height: sillH,
                });
            }
            if (fullH - topY > 0.05) {
                lintels.push({
                    center: mid,
                    width: w,
                    y0: topY,
                    height: fullH - topY,
                });
            }
        }
        delete op._parts;
        cursor = op.right;
    }

    if (half - cursor > 0.04) {
        const w = half - cursor;
        wallSegments.push({
            center: cursor + w / 2,
            width: w,
            y0: 0,
            height: fullH,
        });
    }

    return { wallSegments, lintels, openings };
}

export function parseRoomDoorways(room, box, roomW, roomD, wallH) {
    const rawList = Array.isArray(room?.exits)
        ? room.exits
        : String(room?.exits || '')
            .split(/[;\n|]+/)
            .map((s) => s.trim())
            .filter((s) => s && !isEmptySentinel(s));

    if (!rawList.length) return { north: [], south: [], east: [], west: [] };

    const cx = (box.x1 + box.x2) / 2;
    const cz = (box.y1 + box.y2) / 2;
    const byWall = { north: [], south: [], east: [], west: [] };

    for (const entry of rawList) {
        const str = typeof entry === 'string'
            ? entry
            : `${entry.dir || entry.side || ''} ${entry.grid ? `[${entry.grid}]` : ''} ${entry.target || entry.label || ''}`.trim();
        if (!str || /^\s*(?:up|down)\b/i.test(str)) continue;

        const m = str.match(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*-?\d+(?:\.\d+)?)?\s*\]/);
        const low = str.toLowerCase();
        const isWide = /gate|arch|double|bay|hangar|airlock/i.test(low);
        const doorW = isWide ? 1.55 : 1.18;
        const doorH = Math.min(2.15, Math.max(wallH - 0.12, 1.95));

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

        let offset = 0;
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
            // Note: east/west walls rotate +PI/2 around +Y, mapping +localX to -worldZ -> offset = cz - gz
            offset = (side === 'north' || side === 'south') ? (gx - cx) : (cz - gz);
        } else if (!side) {
            side = 'south';
        }

        const wallSpan = (side === 'north' || side === 'south') ? roomW : roomD;
        const clampedOffset = Math.max(
            -wallSpan / 2 + doorW / 2 + 0.12,
            Math.min(wallSpan / 2 - doorW / 2 - 0.12, offset),
        );
        byWall[side].push({
            center: clampedOffset,
            width: doorW,
            height: doorH,
            label: str,
            kind: /airlock|bulkhead|sci/i.test(low)
                ? 'scifi'
                : (/arch|gate|tower/i.test(low) ? 'arch' : 'door'),
        });
    }

    return byWall;
}

function buildDoorwayAssembly(opening, styleId, palette, wallT, effectiveWallH = 2.4) {
    const g = new THREE.Group();
    const w = opening.width;
    const maxAllowedH = Math.max(0.42, effectiveWallH - 0.05);
    const isLowPortal = effectiveWallH <= 1.45;
    const h = isLowPortal
        ? Math.max(0.4, effectiveWallH - 0.04)
        : Math.min(2.2, maxAllowedH, Math.max(1.82, opening.frameHeight || opening.height));
    const jambW = 0.11;
    const depth = Math.max(opening.depth || (wallT + 0.08), wallT + 0.06);
    const kind = (opening.kind === 'scifi' || styleId === 'scifi') ? 'scifi' : styleId;

    const frameMat = makeMat(
        kind === 'scifi' ? '#475569' : kind === 'industrial' ? '#d97706' : '#5c3c27',
        { roughness: kind === 'scifi' ? 0.38 : 0.72, metalness: kind === 'scifi' ? 0.65 : 0.18 },
    );
    const trimMat = makeMat(palette.trim, { roughness: 0.45, metalness: 0.45 });

    // Left & right door jambs
    const jambGeo = new THREE.BoxGeometry(jambW, h, depth);
    const leftJamb = new THREE.Mesh(jambGeo, frameMat);
    leftJamb.position.set(-w / 2 + jambW / 2, h / 2, 0);
    leftJamb.castShadow = true;
    const rightJamb = new THREE.Mesh(jambGeo, frameMat);
    rightJamb.position.set(w / 2 - jambW / 2, h / 2, 0);
    rightJamb.castShadow = true;
    g.add(leftJamb, rightJamb);

    // Threshold sill plate
    const sillGeo = new THREE.BoxGeometry(w + 0.06, 0.045, depth + 0.1);
    const sill = new THREE.Mesh(sillGeo, trimMat);
    sill.position.set(0, 0.022, 0);
    sill.receiveShadow = true;
    g.add(sill);

    if (isLowPortal) {
        return g;
    }

    const headerGeo = new THREE.BoxGeometry(w + 0.12, 0.13, depth + 0.04);
    const header = new THREE.Mesh(headerGeo, trimMat);
    header.position.set(0, h + 0.04, 0);
    header.castShadow = true;
    g.add(header);

    if (kind === 'scifi') {
        // Retracted blast doors (ajar) + cyan beacon strip
        const panelW = (w - jambW * 2) * 0.24;
        const panelGeo = new THREE.BoxGeometry(panelW, h - 0.06, depth * 0.48);
        const panelMat = makeMat('#1e293b', { roughness: 0.35, metalness: 0.7 });
        const pL = new THREE.Mesh(panelGeo, panelMat);
        pL.position.set(-w / 2 + jambW + panelW / 2, h / 2, 0);
        const pR = new THREE.Mesh(panelGeo, panelMat);
        pR.position.set(w / 2 - jambW - panelW / 2, h / 2, 0);
        const stripGeo = new THREE.BoxGeometry(w * 0.65, 0.05, depth + 0.06);
        const stripMat = makeMat('#22d3ee', { emissive: '#06b6d4', emissiveIntensity: 1.5 });
        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.set(0, h + 0.05, 0);
        g.add(pL, pR, strip);
    } else {
        // Single hinged timber/iron door centered inside jambs, swung open 42° cleanly
        const leafW = Math.max(0.55, w - jambW * 2 - 0.04);
        const pivot = new THREE.Group();
        pivot.position.set(-w / 2 + jambW, 0, 0);
        pivot.rotation.y = Math.PI * 0.24;
        const leafColor = kind === 'industrial' ? '#475569' : '#7c4a2d';
        const leafGeo = new THREE.BoxGeometry(leafW, h - 0.04, 0.07);
        const leaf = new THREE.Mesh(leafGeo, makeMat(leafColor, { roughness: 0.62, metalness: kind === 'industrial' ? 0.58 : 0.08 }));
        leaf.position.set(leafW / 2, (h - 0.04) / 2, 0);
        leaf.castShadow = true;

        const knobGeo = new THREE.SphereGeometry(0.045, 8, 8);
        const knobMat = makeMat('#fbbf24', { roughness: 0.28, metalness: 0.85 });
        const knobF = new THREE.Mesh(knobGeo, knobMat);
        knobF.position.set(leafW - 0.11, h * 0.46, 0.045);
        const knobB = new THREE.Mesh(knobGeo, knobMat);
        knobB.position.set(leafW - 0.11, h * 0.46, -0.045);
        pivot.add(leaf, knobF, knobB);
        g.add(pivot);
    }

    return g;
}

function addWallWithCutouts(parent, {
    span,
    wallH,
    wallT,
    doorways,
    posX,
    posZ,
    baseY,
    rotY,
    wallMat,
    styleId,
    palette,
    renderDoorMesh = false,
}) {
    const wallGroup = new THREE.Group();
    wallGroup.position.set(posX, baseY, posZ);
    wallGroup.rotation.y = rotY;

    const { wallSegments, lintels, openings } = splitWallWithDoorways(span, wallH, doorways);

    for (const seg of wallSegments) {
        const geo = new THREE.BoxGeometry(seg.width, seg.height, wallT);
        const mesh = new THREE.Mesh(geo, wallMat);
        mesh.position.set(seg.center, seg.y0 + seg.height / 2, 0);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        wallGroup.add(mesh);
    }

    for (const lin of lintels) {
        const geo = new THREE.BoxGeometry(lin.width, lin.height, wallT);
        const mesh = new THREE.Mesh(geo, wallMat);
        mesh.position.set(lin.center, lin.y0 + lin.height / 2, 0);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        wallGroup.add(mesh);
    }

    if (renderDoorMesh) {
        for (const op of openings) {
            const door = buildDoorwayAssembly(op, styleId, palette, wallT, wallH);
            door.position.set(op.center, 0, 0);
            wallGroup.add(door);
        }
    }

    parent.add(wallGroup);
}

/**
 * Builds original MIT-licensed procedural Three.js meshes for architectural,
 * medieval, tavern, nature, and fallback primitives.
 */
function buildProceduralProp(shape, colorHex, w, d, h, roomLights, worldPos) {
    const g = new THREE.Group();
    const darkWood = makeMat('#4e3422', { roughness: 0.78 });
    const stone = makeMat('#64748b', { roughness: 0.88 });
    const steel = makeMat('#475569', { roughness: 0.4, metalness: 0.65 });
    const main = makeMat(colorHex, { roughness: 0.65, metalness: shape === 'crystal' ? 0.15 : 0.1 });

    const box = (bw, bh, bd, x, y, z, mat) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
        return m;
    };

    switch (shape) {
        case 'table':
        case 'desk': {
            const topH = h * 0.12;
            const legH = h - topH;
            const legW = Math.min(0.11, w * 0.1);
            box(w, topH, d, 0, legH + topH / 2, 0, main);
            for (const sx of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    box(legW, legH, legW, sx * (w / 2 - legW), legH / 2, sz * (d / 2 - legW), darkWood);
                }
            }
            if (shape === 'desk') {
                box(w * 0.34, 0.04, d * 0.42, -w * 0.12, h + 0.02, 0, makeMat('#fef3c7', { roughness: 0.9 }));
            }
            break;
        }
        case 'chair': {
            const seatH = h * 0.48;
            const legW = Math.max(0.05, w * 0.1);
            box(w * 0.9, h * 0.08, d * 0.9, 0, seatH, 0, main);
            box(w * 0.9, h * 0.5, d * 0.12, 0, seatH + h * 0.25, -d * 0.38, main);
            for (const sx of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    box(legW, seatH, legW, sx * (w * 0.36), seatH / 2, sz * (d * 0.36), darkWood);
                }
            }
            break;
        }
        case 'couch': {
            box(w, h * 0.36, d, 0, h * 0.18, 0, darkWood);
            box(w * 0.86, h * 0.26, d * 0.78, 0, h * 0.44, d * 0.08, main);
            box(w, h * 0.72, d * 0.22, 0, h * 0.64, -d * 0.38, main);
            box(w * 0.13, h * 0.5, d * 0.9, -w * 0.435, h * 0.48, 0, main);
            box(w * 0.13, h * 0.5, d * 0.9, w * 0.435, h * 0.48, 0, main);
            break;
        }
        case 'bed': {
            box(w, h * 0.32, d, 0, h * 0.16, 0, darkWood);
            box(w, h * 0.96, d * 0.09, 0, h * 0.48, -d * 0.45, darkWood);
            box(w * 0.92, h * 0.22, d * 0.86, 0, h * 0.42, d * 0.04, makeMat('#f1f5f9', { roughness: 0.9 }));
            box(w * 0.58, h * 0.14, d * 0.2, 0, h * 0.58, -d * 0.26, makeMat('#ffffff', { roughness: 0.92 }));
            box(w * 0.94, h * 0.12, d * 0.56, 0, h * 0.55, d * 0.18, main);
            break;
        }
        case 'bookshelf': {
            box(w, h, d * 0.16, 0, h / 2, -d * 0.42, darkWood);
            box(w * 0.07, h, d, -w * 0.465, h / 2, 0, darkWood);
            box(w * 0.07, h, d, w * 0.465, h / 2, 0, darkWood);
            const bookPalette = ['#991b1b', '#1d4ed8', '#b45309', '#065f46', '#7c2d12'];
            [0.05, 0.34, 0.64, 0.94].forEach((frac, idx) => {
                box(w * 0.9, h * 0.045, d * 0.92, 0, h * frac, 0, main);
                if (idx < 3) {
                    const rowY = h * frac + h * 0.14;
                    for (let bi = -2; bi <= 2; bi++) {
                        const bh = h * (0.18 + ((idx + bi + 4) % 3) * 0.03);
                        box(w * 0.14, bh, d * 0.64, bi * (w * 0.17), rowY, d * 0.06, makeMat(bookPalette[(idx + bi + 5) % bookPalette.length]));
                    }
                }
            });
            break;
        }
        case 'hearth': {
            box(w, h, d * 0.42, 0, h / 2, -d * 0.28, stone);
            box(w * 0.22, h * 0.72, d * 0.58, -w * 0.38, h * 0.36, d * 0.18, stone);
            box(w * 0.22, h * 0.72, d * 0.58, w * 0.38, h * 0.36, d * 0.18, stone);
            box(w * 1.06, h * 0.14, d, 0, h * 0.74, 0, stone);
            box(w * 0.45, h * 0.72, d * 0.5, 0, h * 0.72, -d * 0.15, stone);
            const flame = new THREE.Mesh(
                new THREE.ConeGeometry(Math.min(w, d) * 0.24, h * 0.36, 7),
                makeMat('#fb923c', { emissive: '#f97316', emissiveIntensity: 1.9 }),
            );
            flame.position.set(0, h * 0.24, d * 0.12);
            g.add(flame);
            if (roomLights.count < roomLights.max) {
                const pl = new THREE.PointLight('#fb923c', 2.4, 9.5, 1.8);
                pl.position.set(worldPos.x, worldPos.y + h * 0.45, worldPos.z + d * 0.35);
                roomLights.parent.add(pl);
                roomLights.count++;
            }
            break;
        }
        case 'brazier': {
            const r = Math.min(w, d) * 0.46;
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.32, r * 0.55, h * 0.55, 8), steel);
            stem.position.y = h * 0.275;
            const bowl = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.38, h * 0.32, 8), steel);
            bowl.position.y = h * 0.68;
            const flame = new THREE.Mesh(
                new THREE.ConeGeometry(r * 0.62, h * 0.46, 7),
                makeMat('#fb923c', { emissive: '#ea580c', emissiveIntensity: 1.85 }),
            );
            flame.position.y = h * 0.96;
            g.add(stem, bowl, flame);
            if (roomLights.count < roomLights.max) {
                const pl = new THREE.PointLight('#f97316', 1.8, 7.5, 1.8);
                pl.position.set(worldPos.x, worldPos.y + h * 1.1, worldPos.z);
                roomLights.parent.add(pl);
                roomLights.count++;
            }
            break;
        }
        case 'lamp': {
            const r = Math.min(w, d) * 0.35;
            const post = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.55, h * 0.82, 8), steel);
            post.position.y = h * 0.41;
            const orb = new THREE.Mesh(
                new THREE.SphereGeometry(r * 0.72, 10, 10),
                makeMat('#fde68a', { emissive: '#f59e0b', emissiveIntensity: 1.8 }),
            );
            orb.position.y = h * 0.9;
            g.add(post, orb);
            break;
        }
        case 'chest': {
            box(w, h * 0.66, d, 0, h * 0.33, 0, main);
            box(w * 1.03, h * 0.28, d * 1.03, 0, h * 0.78, 0, darkWood);
            box(w * 0.16, h * 0.24, d * 0.08, 0, h * 0.64, d * 0.52, makeMat('#fbbf24', { roughness: 0.25, metalness: 0.88 }));
            break;
        }
        case 'tree': {
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.12, w * 0.19, h * 0.46, 8), darkWood);
            trunk.position.y = h * 0.23;
            trunk.castShadow = true;
            const leafMat = makeMat(colorHex || '#166534', { roughness: 0.85 });
            const c1 = new THREE.Mesh(new THREE.ConeGeometry(Math.min(w, d) * 0.48, h * 0.52, 9), leafMat);
            c1.position.y = h * 0.58;
            c1.castShadow = true;
            const c2 = new THREE.Mesh(new THREE.ConeGeometry(Math.min(w, d) * 0.34, h * 0.42, 9), leafMat);
            c2.position.y = h * 0.82;
            c2.castShadow = true;
            g.add(trunk, c1, c2);
            break;
        }
        case 'crystal': {
            const cMat = makeMat(colorHex || '#38bdf8', {
                roughness: 0.2, metalness: 0.3, emissive: colorHex || '#0ea5e9', emissiveIntensity: 1.25,
            });
            const m = new THREE.Mesh(new THREE.OctahedronGeometry(Math.min(w, d) * 0.42, 0), cMat);
            m.scale.set(1, h / Math.max(0.4, Math.min(w, d)), 1);
            m.position.y = h * 0.52;
            g.add(m);
            break;
        }
        case 'stairs': {
            const steps = 5;
            for (let i = 0; i < steps; i++) {
                const frac = (i + 1) / steps;
                box(w, h * frac, d / steps, 0, (h * frac) / 2, -d / 2 + (d / steps) * (i + 0.5), stone);
            }
            break;
        }
        case 'hourglass': {
            const frame = makeMat('#eab308', { roughness: 0.35, metalness: 0.78 });
            const sand = makeMat('#fde047', { emissive: '#ca8a04', emissiveIntensity: 0.6 });
            const r = Math.min(w, d) * 0.44;
            box(w, h * 0.1, d, 0, h * 0.05, 0, frame);
            box(w, h * 0.1, d, 0, h * 0.95, 0, frame);
            const bot = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.42, 8), sand);
            bot.position.y = h * 0.31;
            const top = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.42, 8), sand);
            top.rotation.x = Math.PI;
            top.position.y = h * 0.7;
            g.add(bot, top);
            break;
        }
        case 'ladder': {
            box(w * 0.12, h, d * 0.65, -w * 0.36, h / 2, 0, darkWood);
            box(w * 0.12, h, d * 0.65, w * 0.36, h / 2, 0, darkWood);
            for (const f of [0.2, 0.4, 0.6, 0.8]) {
                box(w * 0.66, 0.06, d * 0.55, 0, h * f, 0, main);
            }
            break;
        }
        case 'cylinder': {
            const r = Math.min(w, d) * 0.48;
            const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), main);
            m.position.y = h / 2;
            m.castShadow = true;
            m.receiveShadow = true;
            g.add(m);
            break;
        }
        case 'cone': {
            const m = new THREE.Mesh(new THREE.ConeGeometry(Math.min(w, d) * 0.48, h, 12), main);
            m.position.y = h / 2;
            m.castShadow = true;
            g.add(m);
            break;
        }
        case 'pyramid': {
            const m = new THREE.Mesh(new THREE.ConeGeometry(Math.min(w, d) * 0.56, h, 4), main);
            m.rotation.y = Math.PI / 4;
            m.position.y = h / 2;
            m.castShadow = true;
            g.add(m);
            break;
        }
        case 'sphere': {
            const m = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d, h) * 0.48, 14, 12), main);
            m.position.y = h / 2;
            m.castShadow = true;
            g.add(m);
            break;
        }
        case 'platform': {
            const slabH = Math.max(0.14, Math.min(0.32, h));
            box(w, slabH, d, 0, slabH / 2, 0, main);
            const localZ = Number(worldPos?.localZ) || 0;
            if (localZ > 0.25) {
                const legT = Math.max(0.1, Math.min(0.22, Math.min(w, d) * 0.08));
                for (const sx of [-1, 1]) {
                    for (const sz of [-1, 1]) {
                        box(legT, localZ, legT, sx * (w / 2 - legT * 0.8), -localZ / 2, sz * (d / 2 - legT * 0.8), steel);
                    }
                }
            }
            if (localZ > 0.4) {
                const railH = 0.85;
                const railT = 0.06;
                for (const sz of [-1, 1]) {
                    const rz = sz * (d / 2 - railT);
                    box(w, railT, railT, 0, slabH + railH - railT / 2, rz, steel);
                    for (const sx of [-1, 1]) {
                        box(railT, railH, railT, sx * (w / 2 - railT), slabH + railH / 2, rz, steel);
                    }
                }
            }
            break;
        }
        default: {
            box(w, h, d, 0, h / 2, 0, main);
            break;
        }
    }
    return g;
}

/**
 * Clones a normalized node from a loaded GLB pack, optionally applies orientation
 * alignment (`preRotY`), scales safely into target `(w, h, d)` keeping circular XZ ratio,
 * and seats `min.y === 0`.
 */
export function normalizeGlbAsset(sourceNode, targetW, targetD, targetH, preRotY = 0) {
    const clone = sourceNode.clone(true);
    clone.traverse((ch) => {
        if (ch.isMesh) {
            ch.geometry = ch.geometry?.clone?.() || ch.geometry;
            ch.material = Array.isArray(ch.material)
                ? ch.material.map((m) => m?.clone?.() || m)
                : (ch.material?.clone?.() || ch.material);
            ch.castShadow = true;
            ch.receiveShadow = true;
        }
    });

    const holder = new THREE.Group();
    clone.rotation.set(0, preRotY, 0);
    clone.updateMatrixWorld(true);

    const rawBox = new THREE.Box3().setFromObject(clone);
    const rawSize = new THREE.Vector3();
    const rawCenter = new THREE.Vector3();
    rawBox.getSize(rawSize);
    rawBox.getCenter(rawCenter);

    clone.position.set(-rawCenter.x, -rawBox.min.y, -rawCenter.z);

    // If elongated shape still runs perpendicular to target bounds after preRotY, auto-align 90deg.
    if ((targetW > targetD * 1.25 && rawSize.z > rawSize.x * 1.25)
        || (targetD > targetW * 1.25 && rawSize.x > rawSize.z * 1.25)) {
        const inner = new THREE.Group();
        inner.add(clone);
        inner.rotation.y = Math.PI / 2;
        inner.updateMatrixWorld(true);
        const rotBox = new THREE.Box3().setFromObject(inner);
        rotBox.getSize(rawSize);
        holder.add(inner);
    } else {
        holder.add(clone);
    }

    const sx = Math.max(0.05, rawSize.x);
    const sy = Math.max(0.05, rawSize.y);
    const sz = Math.max(0.05, rawSize.z);
    const sXZ = Math.min(targetW / sx, targetD / sz);
    const sY = THREE.MathUtils.clamp(targetH / sy, sXZ * 0.7, sXZ * 1.85);
    holder.scale.set(sXZ, sY, sXZ);

    return holder;
}

function resolveObjDims(obj) {
    const def = DEFAULT_OBJ_SIZES[obj?.shape] || DEFAULT_OBJ_SIZES.box;
    if (Array.isArray(obj?.size) && obj.size.length >= 2) {
        const w = Number(obj.size[0]);
        const d = Number(obj.size[1]);
        const h = Number(obj.size[2]);
        return {
            w: Math.max(0.25, Number.isFinite(w) ? w : def[0]),
            d: Math.max(0.25, Number.isFinite(d) ? d : def[1]),
            h: Math.max(0.12, Number.isFinite(h) ? h : def[2]),
        };
    }
    const dims = parseDimMeters(obj?.size);
    if (!dims) return { w: def[0], d: def[1], h: def[2] };
    return {
        w: Math.max(0.25, dims.w),
        d: Math.max(0.25, dims.h),
        h: Math.max(0.12, dims.zH ?? def[2]),
    };
}

function buildPawnGroup(colorHex, isPlayer, height = 1.65) {
    const g = new THREE.Group();
    const bodyMat = makeMat(colorHex, { roughness: 0.45, metalness: 0.18 });
    const rimMat = makeMat(isPlayer ? '#fbbf24' : '#e2e8f0', {
        roughness: 0.3,
        metalness: 0.65,
        emissive: isPlayer ? '#d97706' : '#000000',
        emissiveIntensity: isPlayer ? 0.55 : 0,
    });

    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.08, 16), rimMat);
    ring.position.y = 0.04;
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, height * 0.66, 12), bodyMat);
    torso.position.y = height * 0.37;
    torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 12), bodyMat);
    head.position.y = height * 0.82;
    head.castShadow = true;
    g.add(ring, torso, head);
    return g;
}

function disposeObjectTree(root) {
    if (!root) return;
    root.traverse((obj) => {
        if (obj.isMesh || obj.isLine || obj.isPoints) {
            obj.geometry?.dispose?.();
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const m of mats) m?.dispose?.();
        }
    });
}

/**
 * Mounts an interactive render-on-demand Three.js WebGL Atlas into `containerEl`.
 * Supports cutaway walls with real doorway cutouts, CC BY 4.0 GLB prop kits,
 * MIT procedural architecture/furniture, room click selection, orbit/pan/zoom,
 * projected labels, and deterministic teardown.
 */
export function mountAtlasWebGLViewport(containerEl, state, opts = {}) {
    if (!containerEl || typeof document === 'undefined') {
        return { dispose: () => {}, resetCamera: () => {}, zoom: () => {}, setMode: () => {}, getStats: () => ({}) };
    }

    const {
        selectedMapId = null,
        selectedLevel = null,
        selectedRoomId = null,
        allFloors = false,
        cutaway = true,
        showLabels = true,
        camera: initialCam = null,
        onSelectRoom = null,
        onCameraChange = null,
        customPackScenes = null,
    } = opts;

    const loc = state?.locations || { map_index: { active_map_id: '∅', active_level: '0', maps: [] }, rooms: [] };
    const maps = loc.map_index?.maps || state?.locations?.maps || [];
    const entities = state?.entity_state || [];
    const allRooms = loc.rooms || (Array.isArray(maps[0]?.rooms) ? maps[0].rooms : []);
    const activeMapId = selectedMapId
        || (loc.map_index?.active_map_id && loc.map_index.active_map_id !== '∅' ? loc.map_index.active_map_id : maps[0]?.id)
        || allRooms[0]?.map_id
        || '';
    const mapRooms = allRooms.filter((r) => !activeMapId || r.map_id === activeMapId || r.map_id === '∅');
    const getRoomZ = (r) => {
        const b = computeBbox(r?.coords || r?.grid, r?.dim);
        if (b && Number.isFinite(b.z)) return String(b.z);
        if (r?.level !== undefined && r?.level !== null) return String(r.level);
        return '0';
    };
    const floorZs = [...new Set(mapRooms.map(getRoomZ))].sort((a, b) => Number(a) - Number(b));
    const idxLvl = loc.map_index?.active_level && loc.map_index.active_level !== '∅'
        ? String(loc.map_index.active_level)
        : '';
    const activeLvl = selectedLevel !== null && selectedLevel !== undefined
        ? String(selectedLevel)
        : (idxLvl && (!floorZs.length || floorZs.includes(idxLvl))
            ? idxLvl
            : (floorZs[0] ?? getRoomZ(mapRooms[0] || {})));
    const visibleRooms = allFloors ? mapRooms : mapRooms.filter((r) => getRoomZ(r) === activeLvl);

    containerEl.querySelector('canvas.vse-webgl-canvas')?.remove();
    const canvas = document.createElement('canvas');
    canvas.className = 'vse-webgl-canvas';
    containerEl.prepend(canvas);
    const labelLayer = containerEl.querySelector('.vse-webgl-labels');

    let renderer = null;
    try {
        renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: Boolean(opts.preserveDrawingBuffer),
        });
    } catch {
        canvas.remove();
        containerEl.innerHTML = '<div class="vse-empty">WebGL context unavailable in this browser. Switch to 3D CSS or 2D SVG above.</div>';
        return { dispose: () => {}, resetCamera: () => {}, zoom: () => {}, setMode: () => {}, getStats: () => ({ error: 'no_webgl' }) };
    }

    let envRT = null;
    const scene = new THREE.Scene();
    const bakeEnvironment = () => {
        const pmrem = new THREE.PMREMGenerator(renderer);
        const roomEnv = new RoomEnvironment();
        try {
            const nextRT = pmrem.fromScene(roomEnv, 0.04);
            envRT?.dispose?.();
            envRT = nextRT;
            scene.environment = envRT.texture;
            scene.environmentIntensity = 0.72;
        } finally {
            roomEnv.dispose();
            pmrem.dispose();
        }
    };

    try {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.08;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        bakeEnvironment();
    } catch (err) {
        envRT?.dispose?.();
        renderer.dispose();
        canvas.remove();
        containerEl.innerHTML = '<div class="vse-empty">WebGL initialization failed. Switch to 3D CSS or 2D SVG above.</div>';
        return { dispose: () => {}, resetCamera: () => {}, zoom: () => {}, setMode: () => {}, getStats: () => ({ error: String(err?.message || err) }) };
    }

    const worldRoot = new THREE.Group();
    scene.add(worldRoot);

    const hemi = new THREE.HemisphereLight('#cbd5e1', '#1e293b', 0.62);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fff7ed', 2.05);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#60a5fa', 0.55);
    scene.add(rimLight);

    const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.25, 220);

    const roomFloorMeshes = [];
    const labelAnchors = [];
    const pendingGlbSlots = [];
    const disposableTextures = [];
    const roomLights = { parent: worldRoot, count: 0, max: 6 };

    const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
    const touchBound = (x, y, z) => {
        bounds.minX = Math.min(bounds.minX, x);
        bounds.maxX = Math.max(bounds.maxX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxY = Math.max(bounds.maxY, y);
        bounds.minZ = Math.min(bounds.minZ, z);
        bounds.maxZ = Math.max(bounds.maxZ, z);
    };

    const wallT = 0.22;
    let glbReplacedCount = 0;

    // 1. Precompute room bounds, intra-level height, and floor elevation
    const positioned = visibleRooms.map((room, roomIdx) => {
        const box = computeBbox(room.coords || room.grid, room.dim)
            || { x1: (roomIdx % 3) * 8, y1: Math.floor(roomIdx / 3) * 8, x2: (roomIdx % 3) * 8 + 7, y2: Math.floor(roomIdx / 3) * 8 + 7, z: Number(room.level || 0) };
        const { h: roomH, elev } = parseRoomHeight(room);
        const styleId = inferWebglTheme(room);
        const palette = STYLE_COLORS[styleId] || STYLE_COLORS.stone;
        const backWallH = palette.curbOnly
            ? 0.42
            : (cutaway ? Math.min(6.4, Math.max(2.35, roomH * 0.68)) : roomH);
        const frontWallH = palette.curbOnly ? 0.42 : (cutaway ? 1.05 : roomH);
        return {
            room,
            box,
            rw: Math.max(2.6, box.x2 - box.x1),
            rd: Math.max(2.6, box.y2 - box.y1),
            roomH,
            elev,
            styleId,
            palette,
            backWallH,
            frontWallH,
            floorBaseY: 0,
            baseY: elev,
        };
    });

    // Dynamic vertical stacking across floors based on actual room height + intra-level elev (safe for negative elev)
    const floorBaseMap = new Map();
    if (allFloors && positioned.length > 0) {
        const sortedZs = [...new Set(positioned.map((p) => p.box.z))].sort((a, b) => a - b);
        let accY = 0;
        for (const z of sortedZs) {
            const onZ = positioned.filter((p) => p.box.z === z);
            const minElev = Math.min(0, ...onZ.map((p) => p.elev));
            const floorOffset = accY - minElev;
            floorBaseMap.set(z, floorOffset);
            const maxTop = Math.max(3.6, ...onZ.map((p) => (p.elev - minElev) + (cutaway ? p.backWallH : p.roomH)));
            accY += maxTop + 1.4;
        }
    }
    for (const p of positioned) {
        p.floorBaseY = floorBaseMap.get(p.box.z) ?? 0;
        p.baseY = p.floorBaseY + p.elev;
    }

    const topology = buildAtlasTopology(positioned, { getTheme: inferWebglTheme, wallT });
    const roomById = new Map(positioned.map((p) => [p.room.id, p]));

    for (const p of positioned) {
        const { room, box, rw, rd, roomH, elev, styleId, palette, floorBaseY, baseY } = p;
        const cx = (box.x1 + box.x2) / 2;
        const cz = (box.y1 + box.y2) / 2;
        const levelNum = box.z;

        touchBound(box.x1, Math.min(floorBaseY, baseY), box.y1);
        touchBound(box.x2, baseY + Math.max(p.backWallH, 2.2) + 0.6, box.y2);

        const isCurrent = Boolean(room.isCurrent || room.id === selectedRoomId);
        const roomGroup = new THREE.Group();
        worldRoot.add(roomGroup);

        // Floor slab (exact [x1..x2, y1..y2] footprint so neighboring rooms never overlap)
        const floorTex = makeFloorCheckerTexture(palette.floor, styleId);
        if (floorTex) {
            floorTex.repeat.set(Math.max(1, rw / 2.2), Math.max(1, rd / 2.2));
            disposableTextures.push(floorTex);
        }
        const floorMat = new THREE.MeshStandardMaterial({
            color: floorTex ? 0xffffff : new THREE.Color(palette.floor),
            map: floorTex || null,
            roughness: styleId === 'scifi' ? 0.48 : 0.85,
            metalness: styleId === 'scifi' ? 0.35 : 0.08,
            transparent: allFloors && levelNum > 0,
            opacity: allFloors && levelNum > 0 ? 0.78 : 1,
        });
        const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.16, rd), floorMat);
        floorMesh.position.set(cx, baseY - 0.08, cz);
        floorMesh.receiveShadow = true;
        floorMesh.userData.roomId = room.id;
        roomFloorMeshes.push(floorMesh);
        roomGroup.add(floorMesh);

        // Foundation plinth when intra-level elevation > 0
        if (elev > 0.05) {
            const plinthMat = makeMat(shadeHex(palette.floor, 0.72), { roughness: 0.88, metalness: 0.1 });
            const plinthMesh = new THREE.Mesh(new THREE.BoxGeometry(rw - 0.04, elev, rd - 0.04), plinthMat);
            plinthMesh.position.set(cx, floorBaseY + elev / 2 - 0.16, cz);
            plinthMesh.castShadow = true;
            plinthMesh.receiveShadow = true;
            roomGroup.add(plinthMesh);
        }

        if (isCurrent) {
            const halo = new THREE.LineLoop(
                new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(-rw / 2 - 0.14, 0.02, -rd / 2 - 0.14),
                    new THREE.Vector3(rw / 2 + 0.14, 0.02, -rd / 2 - 0.14),
                    new THREE.Vector3(rw / 2 + 0.14, 0.02, rd / 2 + 0.14),
                    new THREE.Vector3(-rw / 2 - 0.14, 0.02, rd / 2 + 0.14),
                ]),
                new THREE.LineBasicMaterial({ color: 0xf59e0b }),
            );
            halo.position.set(cx, baseY, cz);
            roomGroup.add(halo);
        }

        // Flush corner-aligned walls with unified shared-seam height & doorway cutouts (doors mounted separately)
        const wallMat = makeMat(palette.wall, {
            roughness: styleId === 'scifi' ? 0.45 : 0.82,
            metalness: styleId === 'scifi' ? 0.38 : 0.08,
            transparent: allFloors && levelNum > 0,
            opacity: allFloors && levelNum > 0 ? 0.82 : 1,
        });
        const shared = topology.sharedWallFlags.get(room.id) || {};
        const openings = topology.openingsByRoom.get(room.id) || { north: [], south: [], east: [], west: [] };
        const wallHeightFor = (side, defaultH) => {
            const nInfo = shared[side];
            if (!nInfo?.neighbor) return defaultH;
            if (palette.curbOnly) return defaultH;
            if (nInfo.neighbor.palette?.curbOnly) return p.backWallH;
            return cutaway ? Math.min(p.backWallH, nInfo.neighbor.backWallH) : p.roomH;
        };

        const hN = wallHeightFor('north', p.backWallH);
        const hS = wallHeightFor('south', p.frontWallH);
        const hW = wallHeightFor('west', p.backWallH);
        const hE = wallHeightFor('east', p.frontWallH);
        p.wallHeights = { north: hN, south: hS, west: hW, east: hE };

        const halfT = wallT * 0.5;
        const ewSpan = Math.max(0.2, rd - wallT * 2);

        addWallWithCutouts(roomGroup, {
            span: rw, wallH: hN, wallT, doorways: openings.north,
            posX: cx, posZ: box.y1 + halfT, baseY, rotY: 0, wallMat, styleId, palette, renderDoorMesh: false,
        });
        addWallWithCutouts(roomGroup, {
            span: rw, wallH: hS, wallT, doorways: openings.south,
            posX: cx, posZ: box.y2 - halfT, baseY, rotY: 0, wallMat, styleId, palette, renderDoorMesh: false,
        });
        addWallWithCutouts(roomGroup, {
            span: ewSpan, wallH: hW, wallT, doorways: openings.west,
            posX: box.x1 + halfT, posZ: cz, baseY, rotY: Math.PI / 2, wallMat, styleId, palette, renderDoorMesh: false,
        });
        addWallWithCutouts(roomGroup, {
            span: ewSpan, wallH: hE, wallT, doorways: openings.east,
            posX: box.x2 - halfT, posZ: cz, baseY, rotY: Math.PI / 2, wallMat, styleId, palette, renderDoorMesh: false,
        });

        // Props & furniture (grounded, clamped inside interior walls, duplicate door-props suppressed)
        const rawObjs = Array.isArray(room.objects) && room.objects.length
            ? room.objects
            : inferObjectsFromFeatures(room, box);
        const supSet = topology.suppressedObjectsByRoom.get(room.id) || new Set();
        const roomDim = { w: rw, h: rd, zH: roomH };

        rawObjs.forEach((rawObj, objIdx) => {
            if (supSet.has(objIdx)) return;
            const dims = resolveObjDims(rawObj);
            const grounded = clampObjectToRoom(
                { ...rawObj, size: [dims.w, dims.d, dims.h] },
                roomDim,
                { wallT, insetWalls: true },
            );
            const [lx, ly, lz] = grounded.pos;
            const [cw, cd, ch] = grounded.size;
            const gx = box.x1 + lx;
            const gz = box.y1 + ly;
            const objY = baseY + lz;
            const yaw = -((Number(rawObj.rot) || 0) * Math.PI) / 180;
            const colHex = resolveMaterialColor(rawObj.color, palette.accent);

            const slot = new THREE.Group();
            slot.position.set(gx, objY, gz);
            slot.rotation.y = yaw;
            roomGroup.add(slot);

            const proc = buildProceduralProp(
                rawObj.shape || 'box',
                colHex,
                cw,
                cd,
                ch,
                roomLights,
                { x: gx, y: objY, z: gz, localZ: lz },
            );
            slot.add(proc);

            const kit = WEBGL_KIT_CATALOG[rawObj.shape];
            if (kit) {
                const nodeName = kit.styleNodes?.[styleId] || kit.node;
                pendingGlbSlots.push({ slot, kit, nodeName, dims: { w: cw, d: cd, h: ch }, proc });
            }
        });

        // Occupants + Player Pawn (supports 3D [x,y,z] elevation above floor)
        const occs = parseOccupantsList(room.occupants);
        let renderedUserPawn = false;
        const placedPawns = [];
        const spreadPos = (lx, ly, lz) => {
            let x = Math.max(wallT + 0.45, Math.min(rw - wallT - 0.45, lx));
            let y = Math.max(wallT + 0.45, Math.min(rd - wallT - 0.45, ly));
            const conflicts = placedPawns.filter((o) => Math.hypot(o.x - x, o.y - y) < 0.72 && Math.abs(o.z - lz) < 0.8);
            if (conflicts.length > 0) {
                const ang = conflicts.length * 2.39996;
                const rad = 0.48 + conflicts.length * 0.12;
                x = Math.max(wallT + 0.45, Math.min(rw - wallT - 0.45, x + Math.cos(ang) * rad));
                y = Math.max(wallT + 0.45, Math.min(rd - wallT - 0.45, y + Math.sin(ang) * rad));
            }
            placedPawns.push({ x, y, z: lz });
            return { x: box.x1 + x, z: box.y1 + y };
        };

        occs.forEach((occ, idx) => {
            const isPlayer = /^(you|player|pc)$/i.test(occ.name);
            if (isPlayer) renderedUserPawn = true;
            const pt = parseLocalPoint3D(occ.pos);
            const angle = idx * 2.1;
            const localX = pt ? pt.x : (rw / 2 + Math.cos(angle) * Math.min(rw * 0.28, 1.3));
            const localY = pt ? pt.y : (rd / 2 + Math.sin(angle) * Math.min(rd * 0.28, 1.3));
            const localZ = pt ? Math.max(0, Math.min(roomH - 0.6, pt.z)) : 0;
            const worldPt = spreadPos(localX, localY, localZ);
            const col = isPlayer ? '#f59e0b' : colorForEntity(occ.name, entities);
            const pawn = buildPawnGroup(col, isPlayer, isPlayer ? 1.72 : 1.62);
            pawn.position.set(worldPt.x, baseY + localZ, worldPt.z);
            roomGroup.add(pawn);

            if (localZ > 0.25) {
                const pin = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.05, 0.05, localZ, 6),
                    makeMat(col, { transparent: true, opacity: 0.42 }),
                );
                pin.position.set(worldPt.x, baseY + localZ / 2, worldPt.z);
                roomGroup.add(pin);
            }

            labelAnchors.push({
                text: localZ > 0.2 ? `${occ.name} (+${Number(localZ.toFixed(1))}m)` : occ.name,
                kind: isPlayer ? 'player' : 'pawn',
                worldPos: new THREE.Vector3(worldPt.x, baseY + localZ + 1.92, worldPt.z),
            });
        });

        const isUserRoom = !renderedUserPawn && (
            room.isCurrent
            || (state?.world?.room && String(room.id || '').toLowerCase() === String(state.world.room).toLowerCase())
            || (state?.world?.room && String(room.name || '').toLowerCase() === String(state.world.room).toLowerCase())
            || (state?.world?.loc && String(room.name || '') && String(state.world.loc).toLowerCase().includes(String(room.name).toLowerCase()))
        );
        if (isUserRoom) {
            const upt = parseLocalPoint3D(state?.world?.user_pos);
            const localZ = upt ? Math.max(0, Math.min(roomH - 0.6, upt.z)) : 0;
            const worldPt = spreadPos(upt ? upt.x : rw / 2, upt ? upt.y : rd / 2, localZ);
            const pawn = buildPawnGroup('#f59e0b', true, 1.72);
            pawn.position.set(worldPt.x, baseY + localZ, worldPt.z);
            roomGroup.add(pawn);
            labelAnchors.push({
                text: localZ > 0.2 ? `YOU (+${Number(localZ.toFixed(1))}m)` : 'YOU',
                kind: 'player',
                worldPos: new THREE.Vector3(worldPt.x, baseY + localZ + 1.96, worldPt.z),
            });
        }

        const heightTag = roomH !== 4 ? ` · ${roomH}m` : '';
        const elevTag = elev !== 0 ? ` · ${elev > 0 ? '+' : ''}${elev}m` : '';
        labelAnchors.push({
            text: `${room.name || room.id}${allFloors ? ` (L${levelNum})` : ''}${heightTag}${elevTag}`,
            kind: 'room',
            worldPos: new THREE.Vector3(cx, baseY + Math.max(hN, hW) + 0.45, box.y1 + 0.35),
        });
    }

    // 2. Render ONE unified doorway assembly per connection (shared inter-room + exterior)
    for (const door of topology.doors) {
        const roomA = roomById.get(door.roomA);
        const roomB = door.roomB ? roomById.get(door.roomB) : null;
        const doorPalette = STYLE_COLORS[door.doorStyle] || roomA?.palette || STYLE_COLORS.stone;
        const hSideA = door.sideA && roomA?.wallHeights?.[door.sideA] != null ? roomA.wallHeights[door.sideA] : 2.4;
        const hSideB = door.sideB && roomB?.wallHeights?.[door.sideB] != null ? roomB.wallHeights[door.sideB] : 9;
        const wallMinH = roomA ? Math.min(hSideA, hSideB) : 2.4;
        const doorMesh = buildDoorwayAssembly(door, door.doorStyle, doorPalette, wallT, wallMinH);
        doorMesh.position.set(door.worldX, door.baseY, door.worldZ);
        doorMesh.rotation.y = door.rotY;
        worldRoot.add(doorMesh);
    }

    if (!Number.isFinite(bounds.minX)) {
        bounds.minX = -4; bounds.maxX = 4; bounds.minY = 0; bounds.maxY = 3; bounds.minZ = -4; bounds.maxZ = 4;
    }

    const spanX = Math.max(4, bounds.maxX - bounds.minX);
    const spanY = Math.max(2.5, bounds.maxY - bounds.minY);
    const spanZ = Math.max(4, bounds.maxZ - bounds.minZ);
    const sceneCenter = new THREE.Vector3(
        (bounds.minX + bounds.maxX) / 2,
        bounds.minY + spanY * 0.28,
        (bounds.minZ + bounds.maxZ) / 2,
    );
    const sceneRadius = Math.max(5.5, Math.hypot(spanX, spanY, spanZ) * 0.56);

    const viewAspect = Math.max(1.2, (containerEl.clientWidth || 850) / Math.max(280, containerEl.clientHeight || 465));
    const defaultYaw = spanX > spanZ * 1.75 ? 0.24 : 0.44;
    const defaultPitch = 0.56;
    const projSpanW = spanX * Math.cos(defaultYaw) + spanZ * Math.sin(defaultYaw);
    const projSpanH = (spanX * Math.sin(defaultYaw) + spanZ * Math.cos(defaultYaw)) * Math.sin(defaultPitch) + spanY * Math.cos(defaultPitch);
    const tanHalfY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanHalfX = tanHalfY * viewAspect;
    const defaultDist = Math.max(
        7.5,
        Math.max((projSpanW * 0.62) / tanHalfX, (projSpanH * 0.68) / tanHalfY),
    );

    keyLight.position.set(sceneCenter.x + sceneRadius * 0.9, sceneCenter.y + sceneRadius * 1.65, sceneCenter.z + sceneRadius * 1.15);
    keyLight.target.position.copy(sceneCenter);
    keyLight.shadow.camera.left = -sceneRadius * 1.3;
    keyLight.shadow.camera.right = sceneRadius * 1.3;
    keyLight.shadow.camera.top = sceneRadius * 1.3;
    keyLight.shadow.camera.bottom = -sceneRadius * 1.3;
    keyLight.shadow.camera.far = sceneRadius * 5;
    keyLight.shadow.camera.updateProjectionMatrix();
    scene.add(keyLight.target);
    rimLight.position.set(sceneCenter.x - sceneRadius, sceneCenter.y + sceneRadius * 0.8, sceneCenter.z - sceneRadius);

    // Subtle spatial ground grid beneath atlas
    const gridHelper = new THREE.GridHelper(Math.ceil(sceneRadius * 2.8), Math.ceil(sceneRadius * 1.4), 0x334155, 0x1e293b);
    gridHelper.position.set(sceneCenter.x, bounds.minY - 0.17, sceneCenter.z);
    scene.add(gridHelper);

    // Orbit camera state (Three.js spherical angles)
    const camState = {
        yaw: initialCam?.yaw ?? defaultYaw,
        pitch: initialCam?.pitch ?? defaultPitch,
        dist: initialCam?.dist ?? defaultDist,
        tx: sceneCenter.x,
        ty: sceneCenter.y,
        tz: sceneCenter.z,
    };

    let disposed = false;
    let rafId = null;
    let frameCount = 0;

    function syncCameraTransform() {
        const p = Math.max(0.18, Math.min(Math.PI / 2 - 0.04, camState.pitch));
        const d = Math.max(3.5, Math.min(sceneRadius * 4.5, camState.dist));
        const horiz = d * Math.cos(p);
        camera.position.set(
            camState.tx + horiz * Math.sin(camState.yaw),
            camState.ty + d * Math.sin(p),
            camState.tz + horiz * Math.cos(camState.yaw),
        );
        camera.lookAt(camState.tx, camState.ty, camState.tz);
        onCameraChange?.({ yaw: camState.yaw, pitch: camState.pitch, dist: camState.dist });
    }

    function updateProjectedLabels() {
        if (!labelLayer) return;
        if (!showLabels) {
            labelLayer.innerHTML = '';
            return;
        }
        const width = canvas.clientWidth || 640;
        const height = canvas.clientHeight || 400;
        const proj = new THREE.Vector3();

        if (labelLayer.childElementCount !== labelAnchors.length) {
            labelLayer.innerHTML = labelAnchors.map((a) => `<span class="vse-webgl-label ${a.kind === 'room' ? 'is-room' : a.kind === 'player' ? 'is-player' : ''}"></span>`).join('');
        }

        const els = labelLayer.children;
        const placedBoxes = [];
        for (let i = 0; i < labelAnchors.length; i++) {
            const a = labelAnchors[i];
            const el = els[i];
            if (!el) continue;
            if (el.textContent !== a.text) el.textContent = a.text;
            proj.copy(a.worldPos).project(camera);
            if (proj.z > 1 || proj.z < -1) {
                el.style.display = 'none';
                continue;
            }
            let sx = (proj.x * 0.5 + 0.5) * width;
            let sy = (-proj.y * 0.5 + 0.5) * height;
            if (sx < -60 || sx > width + 60 || sy < -30 || sy > height + 30) {
                el.style.display = 'none';
                continue;
            }
            const approxW = Math.min(148, a.text.length * 6.1 + 14);
            const approxH = 18;
            const overlapsAny = (cx, cy) => placedBoxes.some((b) =>
                Math.abs(cx - b.x) < (approxW + b.w) * 0.48 && Math.abs(cy - b.y) < approxH,
            );
            if (overlapsAny(sx, sy)) {
                let bestX = sx;
                let bestY = sy;
                let placed = false;
                const seedAng = placedBoxes.length * 0.85;
                for (const rad of [24, 42, 62, 84, 108]) {
                    for (let k = 0; k < 12; k++) {
                        const ang = seedAng + k * 2.399963;
                        const cx = Math.max(approxW / 2 + 8, Math.min(width - approxW / 2 - 8, sx + Math.cos(ang) * rad * 1.45));
                        const cy = Math.max(38, Math.min(height - 10, sy + Math.sin(ang) * rad * 0.68));
                        if (!overlapsAny(cx, cy)) {
                            bestX = cx;
                            bestY = cy;
                            placed = true;
                            break;
                        }
                    }
                    if (placed) break;
                }
                if (placed) {
                    sx = bestX;
                    sy = bestY;
                } else {
                    for (const box2d of placedBoxes) {
                        if (Math.abs(sx - box2d.x) < (approxW + box2d.w) * 0.48 && Math.abs(sy - box2d.y) < approxH) {
                            sy = box2d.y - approxH - 2;
                        }
                    }
                }
            }
            sy = Math.max(38, Math.min(height - 10, sy));
            placedBoxes.push({ x: sx, y: sy, w: approxW });
            el.style.display = '';
            el.style.left = `${sx.toFixed(1)}px`;
            el.style.top = `${sy.toFixed(1)}px`;
        }
    }

    function renderNow() {
        if (disposed) return;
        rafId = null;
        const w = Math.max(1, containerEl.clientWidth || 640);
        const h = Math.max(1, containerEl.clientHeight || 410);
        if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
        syncCameraTransform();
        renderer.render(scene, camera);
        frameCount++;
        updateProjectedLabels();
    }

    function requestRender() {
        if (disposed || rafId !== null) return;
        if (typeof requestAnimationFrame === 'function') {
            rafId = requestAnimationFrame(renderNow);
        } else {
            renderNow();
        }
    }

    // Populate GLB props asynchronously without blocking first paint
    const applyPacks = (packs) => {
        if (disposed) return;
        let changed = 0;
        for (const item of pendingGlbSlots) {
            const packScene = packs[item.kit.pack];
            if (!packScene) continue;
            const srcNode = packScene.getObjectByName(item.nodeName);
            if (!srcNode) continue;
            const mesh = normalizeGlbAsset(srcNode, item.dims.w, item.dims.d, item.dims.h, item.kit.preRotY || 0);
            item.slot.remove(item.proc);
            disposeObjectTree(item.proc);
            item.slot.add(mesh);
            changed++;
        }
        glbReplacedCount += changed;
        containerEl.dataset.webglGlbLoaded = String(glbReplacedCount);
        if (changed > 0) requestRender();
    };

    if (customPackScenes) {
        applyPacks(customPackScenes);
    } else if (pendingGlbSlots.length > 0) {
        const needed = new Set(pendingGlbSlots.map((p) => p.kit.pack));
        const loads = {};
        if (needed.has('psx')) loads.psx = loadGlbPack('psx', PSX_GLB_URL);
        if (needed.has('scifi')) loads.scifi = loadGlbPack('scifi', SCIFI_GLB_URL);
        Promise.all([loads.psx || null, loads.scifi || null])
            .then(([psx, scifi]) => applyPacks({ psx, scifi }))
            .catch(() => {});
    }

    // Orbit, pan, wheel zoom & room pick interaction
    let dragMode = null;
    let dragMoved = false;
    let lastX = 0;
    let lastY = 0;
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();

    const onPointerDown = (e) => {
        if (e.target?.closest?.('.vse-webgl-controls, .vse-webgl-hud-overlay')) return;
        dragMode = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
        dragMoved = false;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e) => {
        if (!dragMode) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        if (Math.hypot(dx, dy) > 3) dragMoved = true;
        lastX = e.clientX;
        lastY = e.clientY;

        if (dragMode === 'orbit') {
            camState.yaw -= dx * 0.008;
            camState.pitch = Math.max(0.18, Math.min(Math.PI / 2 - 0.05, camState.pitch + dy * 0.006));
        } else {
            const panScale = camState.dist * 0.0014;
            const cosY = Math.cos(camState.yaw);
            const sinY = Math.sin(camState.yaw);
            camState.tx -= (dx * cosY + dy * sinY) * panScale;
            camState.tz -= (-dx * sinY + dy * cosY) * panScale;
        }
        requestRender();
    };

    const onPointerUp = (e) => {
        if (!dragMode) return;
        const wasClick = !dragMoved && e.button === 0;
        dragMode = null;
        canvas.releasePointerCapture?.(e.pointerId);
        if (wasClick && typeof onSelectRoom === 'function') {
            const rect = canvas.getBoundingClientRect();
            pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(pointerNdc, camera);
            const hits = raycaster.intersectObjects(roomFloorMeshes, false);
            const hitRoomId = hits[0]?.object?.userData?.roomId;
            if (hitRoomId) onSelectRoom(hitRoomId);
        }
    };

    const onWheel = (e) => {
        e.preventDefault();
        camState.dist = Math.max(4, Math.min(sceneRadius * 4, camState.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
        requestRender();
    };

    const onContextMenu = (e) => e.preventDefault();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);

    let resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(() => requestRender());
        resizeObserver.observe(containerEl);
    }

    const syncCamModeButtons = (mode) => {
        containerEl.querySelector('[data-webgl-act="iso"]')?.classList.toggle('active', mode === 'iso');
        containerEl.querySelector('[data-webgl-act="top"]')?.classList.toggle('active', mode === 'top');
    };

    const resetCamera = () => {
        camState.yaw = defaultYaw;
        camState.pitch = defaultPitch;
        camState.dist = defaultDist;
        camState.tx = sceneCenter.x;
        camState.ty = sceneCenter.y;
        camState.tz = sceneCenter.z;
        syncCamModeButtons('iso');
        requestRender();
    };

    const setMode = (preset) => {
        if (preset === 'top') {
            camState.yaw = 0;
            camState.pitch = Math.PI / 2 - 0.08;
            syncCamModeButtons('top');
        } else {
            camState.yaw = defaultYaw;
            camState.pitch = defaultPitch;
            syncCamModeButtons('iso');
        }
        requestRender();
    };

    const zoom = (factor) => {
        camState.dist = Math.max(4, Math.min(sceneRadius * 4, camState.dist * factor));
        requestRender();
    };

    const onToolbarClick = (e) => {
        const btn = e.target?.closest?.('[data-webgl-act]');
        if (!btn) return;
        e.stopPropagation();
        const act = btn.getAttribute('data-webgl-act');
        if (act === 'reset') resetCamera();
        else if (act === 'top') setMode('top');
        else if (act === 'iso') setMode('iso');
        else if (act === 'in') zoom(0.84);
        else if (act === 'out') zoom(1.18);
    };
    containerEl.addEventListener('click', onToolbarClick);

    const onContextRestored = () => {
        if (disposed) return;
        try {
            bakeEnvironment();
            requestRender();
        } catch { /* ignore */ }
    };
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (rafId !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        resizeObserver?.disconnect();
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('contextmenu', onContextMenu);
        canvas.removeEventListener('webglcontextrestored', onContextRestored);
        containerEl.removeEventListener('click', onToolbarClick);

        disposeObjectTree(scene);
        for (const tex of disposableTextures) tex.dispose?.();
        envRT?.dispose?.();
        renderer.dispose();
        renderer.forceContextLoss?.();
        canvas.remove();
    };

    try {
        renderNow();
    } catch (err) {
        dispose();
        containerEl.innerHTML = '<div class="vse-empty">WebGL render error. Switch to 3D CSS or 2D SVG above.</div>';
        return { dispose: () => {}, resetCamera: () => {}, zoom: () => {}, setMode: () => {}, getStats: () => ({ error: String(err?.message || err) }) };
    }

    return {
        scene,
        camera,
        renderer,
        renderNow,
        requestRender,
        resetCamera,
        setMode,
        zoom,
        getStats: () => ({
            rooms: visibleRooms.length,
            props: pendingGlbSlots.length,
            glbPropsLoaded: glbReplacedCount,
            labels: labelAnchors.length,
            framesRendered: frameCount,
            lights: roomLights.count,
        }),
        dispose,
    };
}
