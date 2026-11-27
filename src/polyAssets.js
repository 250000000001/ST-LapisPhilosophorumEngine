/**
 * Composite 3D CSS Diorama Asset & Furniture Prefab Library.
 *
 * Inspired by Layoutit's css.graphics asset packaging and BhaskarAcharjee's 3D-Room
 * diorama lighting/shadow aesthetics; implemented cleanly from scratch on top of
 * `./polyCss3d.js` primitives (`matrix3d`, contact shadows, radial light pools,
 * and CSS Z-bob/flicker animations).
 *
 * Pure ES module with zero DOM dependencies.
 */

import {
    rotatePointXY,
    boxPolygons,
    cylinderPolygons,
    conePolygons,
    spherePolygons,
    archPolygons,
    octahedronPolygons,
    ringPolygons,
    decalPolygon,
    resolveMaterialColor,
    shadeHex,
} from './polyCss3d.js';
import { SKETCHFAB_ASSETS } from './sketchfabAssets.js';

const sketchfabIds = Object.keys(SKETCHFAB_ASSETS);

export const POLY_PREFABS = Object.freeze([...new Set([
    'table',
    'chair',
    'couch',
    'bed',
    'bookshelf',
    'desk',
    'hearth',
    'brazier',
    'lamp',
    'chest',
    'tree',
    'crystal',
    'ladder',
    'hourglass',
    'container',
    'barrel',
    'crate',
    'dumpster',
    'generator',
    'pallet',
    'propane',
    'pipes',
    'locker',
    'vat',
    'console',
    'cabinet',
    'airlock',
    'screen',
    'platform',
    ...sketchfabIds,
])]);

export const PREFAB_DEFAULT_SIZES = Object.freeze({
    table: [2.0, 1.3, 0.9],
    chair: [0.85, 0.85, 1.15],
    couch: [2.4, 1.05, 0.95],
    bed: [2.2, 1.6, 0.95],
    bookshelf: [1.8, 0.55, 2.2],
    desk: [1.8, 0.95, 0.95],
    hearth: [2.2, 0.95, 2.3],
    brazier: [1.2, 1.2, 1.3],
    lamp: [0.7, 0.7, 1.9],
    chest: [1.3, 0.85, 0.85],
    tree: [2.2, 2.2, 3.6],
    crystal: [1.1, 1.1, 2.2],
    ladder: [0.65, 0.25, 2.8],
    hourglass: [0.55, 0.55, 1.2],
    container: [6.0, 2.5, 2.6],
    barrel: [0.7, 0.7, 1.05],
    crate: [1.0, 1.0, 1.0],
    dumpster: [2.2, 1.4, 1.3],
    generator: [1.8, 1.2, 1.5],
    pallet: [1.3, 1.1, 0.2],
    propane: [0.48, 0.48, 1.15],
    pipes: [2.2, 0.6, 2.0],
    locker: [0.9, 0.55, 2.0],
    vat: [1.35, 1.35, 2.7],
    console: [2.2, 0.9, 1.4],
    cabinet: [1.1, 0.6, 2.1],
    airlock: [2.4, 0.65, 2.7],
    screen: [2.0, 0.22, 1.4],
    platform: [3.2, 2.2, 0.25],
    ...Object.fromEntries(sketchfabIds.map((id) => [id, SKETCHFAB_ASSETS[id].size])),
});

function contactShadow(cx, cy, cz, w, d, rotZ, meta) {
    return decalPolygon({
        cx,
        cy,
        cz: cz + 0.015,
        w: w * 1.18,
        d: d * 1.18,
        rotZ,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0.22) 55%, rgba(0,0,0,0) 76%)',
        className: `${meta.className || ''} lpe-poly-shadow`.trim(),
        dataAttrs: meta.dataAttrs,
        title: meta.title,
    });
}

function glowPool(cx, cy, cz, radius, rgbaInner, rgbaMid, meta) {
    return decalPolygon({
        cx,
        cy,
        cz: cz + 0.025,
        w: radius * 2,
        d: radius * 2,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${rgbaInner} 0%, ${rgbaMid} 48%, rgba(0,0,0,0) 76%)`,
        className: `${meta.className || ''} lpe-poly-glow`.trim(),
        dataAttrs: meta.dataAttrs,
        title: meta.title,
    });
}

function subBox(cx, cy, cz, lx, ly, lz, w, d, h, rotZ, opts) {
    const [rx, ry] = rotatePointXY(cx + lx, cy + ly, cx, cy, rotZ);
    return boxPolygons({
        ...opts,
        cx: rx,
        cy: ry,
        cz: cz + lz,
        w,
        d,
        h,
        rotZ,
    });
}

function fourLegs(cx, cy, cz, w, d, legH, legThick, rotZ, color, meta) {
    const ox = Math.max(0.1, w / 2 - legThick * 0.75);
    const oy = Math.max(0.1, d / 2 - legThick * 0.75);
    const faces = [];
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        faces.push(...subBox(cx, cy, cz, sx * ox, sy * oy, 0, legThick, legThick, legH, rotZ, {
            ...meta,
            color,
            skipTop: true,
            skipBottom: true,
        }));
    }
    return faces;
}

function buildTable({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const mat = color || 'wood';
    const baseHex = resolveMaterialColor(mat, '#9c6b43');
    const topT = Math.max(0.08, Math.min(0.18, h * 0.18));
    const legH = Math.max(0.2, h - topT);
    const legT = Math.max(0.08, Math.min(0.16, Math.min(w, d) * 0.11));

    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...fourLegs(cx, cy, cz, w, d, legH, legT, rotZ, shadeHex(baseHex, 0.8), meta),
        ...boxPolygons({
            ...meta,
            cx,
            cy,
            cz: cz + legH,
            w,
            d,
            h: topT,
            rotZ,
            color: baseHex,
            topColor: shadeHex(baseHex, 1.08),
            skipBottom: false,
        }),
    ];
}

function buildChair({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const mat = color || 'wood';
    const baseHex = resolveMaterialColor(mat, '#9c6b43');
    const seatZ = h * 0.43;
    const seatT = Math.max(0.07, h * 0.09);
    const legT = Math.max(0.06, Math.min(0.11, Math.min(w, d) * 0.12));
    const backD = Math.max(0.08, d * 0.16);
    const backH = Math.max(0.25, h - seatZ - seatT);

    const faces = [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...fourLegs(cx, cy, cz, w * 0.9, d * 0.9, seatZ, legT, rotZ, shadeHex(baseHex, 0.78), meta),
        ...boxPolygons({
            ...meta,
            cx,
            cy,
            cz: cz + seatZ,
            w,
            d,
            h: seatT,
            rotZ,
            color: baseHex,
            topColor: shadeHex(baseHex, 1.08),
            skipBottom: false,
        }),
        ...subBox(cx, cy, cz, 0, -d / 2 + backD / 2, seatZ + seatT, w, backD, backH, rotZ, {
            ...meta,
            color: shadeHex(baseHex, 0.92),
            skipBottom: true,
        }),
    ];

    if (w >= 0.85) {
        const armW = Math.max(0.07, w * 0.12);
        const armH = Math.max(0.14, backH * 0.42);
        for (const sx of [-1, 1]) {
            faces.push(...subBox(cx, cy, cz, sx * (w / 2 - armW / 2), d * 0.05, seatZ + seatT, armW, d * 0.82, armH, rotZ, {
                ...meta,
                color: shadeHex(baseHex, 0.86),
                skipBottom: true,
            }));
        }
    }
    return faces;
}

function buildCouch({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const mat = color || 'cloth';
    const fabric = resolveMaterialColor(mat, '#a85578');
    const frameH = h * 0.22;
    const armW = Math.max(0.16, Math.min(0.32, w * 0.13));
    const backD = Math.max(0.16, d * 0.22);
    const seatW = Math.max(0.4, w - armW * 2);
    const seatD = Math.max(0.3, d - backD);
    const seatH = h * 0.28;

    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...boxPolygons({
            ...meta, cx, cy, cz, w, d, h: frameH, rotZ, color: 'dark_wood', skipBottom: true,
        }),
        // Plush seat deck
        ...subBox(cx, cy, cz, 0, backD * 0.42, frameH, seatW, seatD, seatH, rotZ, {
            ...meta, color: fabric, topColor: shadeHex(fabric, 1.1), skipBottom: true,
        }),
        // Tall backrest
        ...subBox(cx, cy, cz, 0, -d / 2 + backD / 2, frameH, w, backD, h - frameH, rotZ, {
            ...meta, color: shadeHex(fabric, 0.88), skipBottom: true,
        }),
        // Left and right armrests
        ...subBox(cx, cy, cz, -w / 2 + armW / 2, backD * 0.35, frameH, armW, seatD, seatH + h * 0.18, rotZ, {
            ...meta, color: shadeHex(fabric, 0.92), skipBottom: true,
        }),
        ...subBox(cx, cy, cz, w / 2 - armW / 2, backD * 0.35, frameH, armW, seatD, seatH + h * 0.18, rotZ, {
            ...meta, color: shadeHex(fabric, 0.92), skipBottom: true,
        }),
    ];
}

function buildBed({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const blanket = resolveMaterialColor(color || 'cloth', '#a85578');
    const frameH = h * 0.3;
    const mattH = h * 0.22;
    const headD = Math.max(0.12, d * 0.1);
    const mattZ = frameH;
    const topZ = mattZ + mattH;

    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        // Wooden frame
        ...boxPolygons({
            ...meta, cx, cy, cz, w, d, h: frameH, rotZ, color: 'dark_wood', skipBottom: true,
        }),
        // Headboard at North edge
        ...subBox(cx, cy, cz, 0, -d / 2 + headD / 2, frameH, w, headD, h - frameH, rotZ, {
            ...meta, color: 'dark_wood', skipBottom: true,
        }),
        // Linen mattress
        ...subBox(cx, cy, cz, 0, headD * 0.3, mattZ, w * 0.9, d - headD * 1.4, mattH, rotZ, {
            ...meta, color: '#e5e7eb', topColor: '#f8fafc', skipBottom: true,
        }),
        // Pillow
        ...subBox(cx, cy, cz, 0, -d * 0.24, topZ, w * 0.56, d * 0.2, h * 0.13, rotZ, {
            ...meta, color: '#ffffff', skipBottom: true,
        }),
        // Folded blanket
        ...subBox(cx, cy, cz, 0, d * 0.16, topZ, w * 0.92, d * 0.54, h * 0.08, rotZ, {
            ...meta, color: blanket, topColor: shadeHex(blanket, 1.08), skipBottom: true,
        }),
    ];
}

function buildBookshelf({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const wood = resolveMaterialColor(color || 'dark_wood', '#5c3d28');
    const sideT = Math.max(0.07, w * 0.06);
    const backD = Math.max(0.06, d * 0.14);
    const shelfT = Math.max(0.05, h * 0.04);
    const innerW = Math.max(0.3, w - sideT * 2);
    const innerD = Math.max(0.2, d - backD);

    const faces = [
        ...contactShadow(cx, cy, cz, w, d * 1.3, rotZ, meta),
        // Back panel
        ...subBox(cx, cy, cz, 0, -d / 2 + backD / 2, 0, w, backD, h, rotZ, {
            ...meta, color: shadeHex(wood, 0.72), skipBottom: true,
        }),
        // Left & right side walls
        ...subBox(cx, cy, cz, -w / 2 + sideT / 2, backD * 0.3, 0, sideT, innerD, h, rotZ, {
            ...meta, color: wood, skipBottom: true,
        }),
        ...subBox(cx, cy, cz, w / 2 - sideT / 2, backD * 0.3, 0, sideT, innerD, h, rotZ, {
            ...meta, color: wood, skipBottom: true,
        }),
    ];

    // Bottom, mid, upper, and top shelves
    for (const frac of [0.02, 0.36, 0.68, 0.96]) {
        faces.push(...subBox(cx, cy, cz, 0, backD * 0.25, h * frac, innerW, innerD, shelfT, rotZ, {
            ...meta, color: shadeHex(wood, 1.1), skipBottom: true,
        }));
    }

    // Staggered colored book blocks on two middle shelves
    const bookColors = ['#b91c1c', '#1d4ed8', '#b45309', '#047857'];
    for (let row = 0; row < 2; row++) {
        const shelfZ = h * (row === 0 ? 0.36 : 0.68) + shelfT;
        const bkH = h * 0.22;
        faces.push(...subBox(cx, cy, cz, -innerW * 0.22, backD * 0.2, shelfZ, innerW * 0.38, innerD * 0.75, bkH, rotZ, {
            ...meta, color: bookColors[row * 2], skipBottom: true,
        }));
        faces.push(...subBox(cx, cy, cz, innerW * 0.22, backD * 0.2, shelfZ, innerW * 0.34, innerD * 0.75, bkH * 0.86, rotZ, {
            ...meta, color: bookColors[row * 2 + 1], skipBottom: true,
        }));
    }
    return faces;
}

function buildDesk({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const wood = resolveMaterialColor(color || 'dark_wood', '#5c3d28');
    const pedW = Math.max(0.22, w * 0.24);
    const topT = Math.max(0.08, h * 0.13);
    const bodyH = Math.max(0.25, h - topT);

    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        // Left & right drawer pedestals
        ...subBox(cx, cy, cz, -w / 2 + pedW / 2, 0, 0, pedW, d * 0.9, bodyH, rotZ, {
            ...meta, color: shadeHex(wood, 0.85), skipBottom: true,
        }),
        ...subBox(cx, cy, cz, w / 2 - pedW / 2, 0, 0, pedW, d * 0.9, bodyH, rotZ, {
            ...meta, color: shadeHex(wood, 0.85), skipBottom: true,
        }),
        // Desktop surface
        ...boxPolygons({
            ...meta, cx, cy, cz: cz + bodyH, w, d, h: topT, rotZ, color: wood, topColor: shadeHex(wood, 1.15), skipBottom: false,
        }),
        // Open folio / glowing slate prop on desktop
        ...subBox(cx, cy, cz, -w * 0.1, d * 0.05, h, Math.min(0.55, w * 0.34), Math.min(0.4, d * 0.45), 0.06, rotZ, {
            ...meta,
            color: (color === 'glass' || color === 'magic') ? '#60a5fa' : '#fef3c7',
            unlit: color === 'glass' || color === 'magic',
            className: `${meta.className || ''} ${(color === 'glass' || color === 'magic') ? 'lpe-poly-emissive' : ''}`.trim(),
            skipBottom: true,
        }),
    ];
}

function buildHearth({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const stoneCol = (!color || color === 'fire') ? 'stone' : color;
    return [
        ...glowPool(cx, cy + d * 0.35, cz, Math.max(w, d) * 1.15, 'rgba(251,146,60,0.46)', 'rgba(249,115,22,0.16)', meta),
        ...archPolygons({
            ...meta, cx, cy, cz, w, d, h, rotZ, color: stoneCol,
        }),
        // Soot firebox backplate
        ...subBox(cx, cy, cz, 0, -d * 0.25, 0, w * 0.68, d * 0.2, h * 0.72, rotZ, {
            ...meta, color: 'dark_stone', skipBottom: true,
        }),
        // Glowing ember bed
        ...subBox(cx, cy, cz, 0, d * 0.04, 0.02, w * 0.46, d * 0.45, 0.16, rotZ, {
            ...meta, color: '#ea580c', unlit: true, skipBottom: true,
        }),
        // Flickering hearth flame
        ...conePolygons({
            ...meta,
            cx,
            cy,
            cz: cz + 0.16,
            radius: Math.min(w, d) * 0.3,
            h: Math.min(1.3, h * 0.48),
            segments: 6,
            rotZ,
            color: 'fire',
            unlit: true,
            className: `${meta.className || ''} lpe-poly-flicker`.trim(),
        }),
    ];
}

function buildBrazier({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const r = Math.min(w, d) / 2;
    const metal = (!color || color === 'fire') ? 'iron' : color;
    const stemH = h * 0.42;
    const bowlH = h * 0.3;

    return [
        ...glowPool(cx, cy, cz, r * 2.2, 'rgba(251,146,60,0.48)', 'rgba(234,88,12,0.16)', meta),
        ...cylinderPolygons({
            ...meta, cx, cy, cz, radius: r * 0.56, radiusTop: r * 0.32, h: stemH, segments: 6, rotZ, color: 'dark_stone', capped: false,
        }),
        ...cylinderPolygons({
            ...meta, cx, cy, cz: cz + stemH, radius: r * 0.34, radiusTop: r * 0.95, h: bowlH, segments: 6, rotZ, color: metal, topColor: '#b91c1c', capped: true,
        }),
        ...conePolygons({
            ...meta,
            cx,
            cy,
            cz: cz + stemH + bowlH * 0.85,
            radius: r * 0.62,
            h: h * 0.46,
            segments: 6,
            rotZ,
            color: 'fire',
            unlit: true,
            className: `${meta.className || ''} lpe-poly-flicker`.trim(),
        }),
    ];
}

function buildLamp({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const r = Math.min(w, d) / 2;
    const glowHex = (!color || color === 'iron' || color === 'dark_wood') ? '#fde68a' : resolveMaterialColor(color, '#fde68a');
    const baseH = 0.14;
    const poleH = Math.max(0.4, h * 0.72);
    const bulbR = Math.max(0.18, Math.min(0.36, r * 0.7));

    return [
        ...glowPool(cx, cy, cz, Math.max(1.2, r * 3.4), 'rgba(253,224,71,0.36)', 'rgba(251,191,36,0.12)', meta),
        ...cylinderPolygons({
            ...meta, cx, cy, cz, radius: r * 0.65, radiusTop: r * 0.48, h: baseH, segments: 6, rotZ, color: 'dark_stone',
        }),
        ...cylinderPolygons({
            ...meta, cx, cy, cz: cz + baseH, radius: 0.08, radiusTop: 0.07, h: poleH, segments: 5, rotZ, color: 'iron', capped: false,
        }),
        ...spherePolygons({
            ...meta,
            cx,
            cy,
            cz: cz + baseH + poleH - bulbR * 0.2,
            radius: bulbR,
            latSegments: 3,
            lonSegments: 6,
            color: glowHex,
            unlit: true,
            className: `${meta.className || ''} lpe-poly-emissive`.trim(),
        }),
    ];
}

function buildChest({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const wood = resolveMaterialColor(color || 'dark_wood', '#5c3d28');
    const bodyH = h * 0.64;
    const lidH = h * 0.34;

    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...boxPolygons({
            ...meta, cx, cy, cz, w, d, h: bodyH, rotZ, color: wood, skipTop: true, skipBottom: true,
        }),
        ...boxPolygons({
            ...meta, cx, cy, cz: cz + bodyH, w: w * 1.04, d: d * 1.04, h: lidH, rotZ, color: shadeHex(wood, 1.15), topColor: shadeHex(wood, 1.24), skipBottom: false,
        }),
        // Front iron/brass lock clasp
        ...subBox(cx, cy, cz, 0, d * 0.52, bodyH * 0.72, Math.max(0.14, w * 0.16), 0.09, Math.max(0.16, h * 0.28), rotZ, {
            ...meta, color: 'gold', skipBottom: true,
        }),
    ];
}

function buildTree({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const r = Math.min(w, d) / 2;
    const leafCol = (!color || color === 'wood' || color === 'dark_wood')
        ? '#2f6644'
        : resolveMaterialColor(color, '#2f6644');
    const trunkH = h * 0.38;

    return [
        ...contactShadow(cx, cy, cz, w * 1.05, d * 1.05, rotZ, meta),
        ...cylinderPolygons({
            ...meta, cx, cy, cz, radius: r * 0.2, radiusTop: r * 0.14, h: trunkH, segments: 6, rotZ, color: 'dark_wood', capped: false,
        }),
        ...conePolygons({
            ...meta, cx, cy, cz: cz + trunkH * 0.85, radius: r * 0.88, h: h * 0.42, segments: 7, rotZ, color: leafCol, capped: true,
        }),
        ...conePolygons({
            ...meta, cx, cy, cz: cz + h * 0.56, radius: r * 0.62, h: h * 0.44, segments: 7, rotZ: rotZ + 22, color: shadeHex(leafCol, 1.15), capped: true,
        }),
    ];
}

function buildCrystal({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const r = Math.min(w, d) / 2;
    const cHex = resolveMaterialColor(color || 'magic', '#b388ff');
    const plinthH = h * 0.32;

    return [
        ...glowPool(cx, cy, cz, r * 2.4, 'rgba(179,136,255,0.42)', 'rgba(139,92,246,0.14)', meta),
        ...boxPolygons({
            ...meta, cx, cy, cz, w: w * 0.78, d: d * 0.78, h: plinthH, rotZ, color: 'dark_stone', topColor: 'stone', skipBottom: true,
        }),
        ...ringPolygons({
            ...meta, cx, cy, cz: cz + plinthH + 0.03, innerR: r * 0.48, outerR: r * 0.82, segments: 8, rotZ, color: cHex, unlit: true,
        }),
        ...octahedronPolygons({
            ...meta,
            cx,
            cy,
            cz: cz + plinthH + 0.16,
            radius: r * 0.44,
            h: h * 0.58,
            rotZ,
            color: cHex,
            unlit: true,
            animGroup: 'float',
            className: `${meta.className || ''} lpe-poly-emissive`.trim(),
        }),
    ];
}

function buildLadder({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const rail = resolveMaterialColor(color || 'wood', '#8b5a2b');
    const railW = Math.max(0.06, w * 0.14);
    const rungH = Math.max(0.05, h * 0.035);
    const faces = [
        ...contactShadow(cx, cy, cz, w, Math.max(d, 0.45), rotZ, meta),
        ...subBox(cx, cy, cz, -w * 0.36, 0, 0, railW, Math.max(0.08, d * 0.6), h, rotZ, {
            ...meta, color: rail, skipBottom: true,
        }),
        ...subBox(cx, cy, cz, w * 0.36, 0, 0, railW, Math.max(0.08, d * 0.6), h, rotZ, {
            ...meta, color: rail, skipBottom: true,
        }),
    ];
    for (const frac of [0.18, 0.38, 0.58, 0.78]) {
        faces.push(...subBox(cx, cy, cz, 0, 0, h * frac, w * 0.62, Math.max(0.06, d * 0.5), rungH, rotZ, {
            ...meta, color: shadeHex(rail, 1.12), skipBottom: true,
        }));
    }
    return faces;
}

function buildHourglass({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const frame = resolveMaterialColor(color || 'gold', '#eab308');
    const baseH = h * 0.1;
    const bulbH = h * 0.34;
    const r = Math.min(w, d) * 0.45;
    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...subBox(cx, cy, cz, 0, 0, 0, w, d, baseH, rotZ, { ...meta, color: frame, skipBottom: true }),
        ...subBox(cx, cy, cz, 0, 0, h - baseH, w, d, baseH, rotZ, { ...meta, color: frame, skipBottom: true }),
        ...cylinderPolygons({ ...meta, cx, cy, cz: cz + baseH, radius: r * 0.85, radiusTop: r * 0.25, h: bulbH, segments: 6, rotZ, color: 'glass', capped: true }),
        ...cylinderPolygons({ ...meta, cx, cy, cz: cz + baseH + bulbH * 1.15, radius: r * 0.25, radiusTop: r * 0.85, h: bulbH, segments: 6, rotZ, color: '#fef08a', capped: true }),
    ];
}

function buildContainer({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const steel = resolveMaterialColor(color || 'steel', '#475569');
    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...boxPolygons({ ...meta, cx, cy, cz, w, d, h, rotZ, color: steel, topColor: shadeHex(steel, 1.08), skipBottom: true }),
        ...subBox(cx, cy, cz, -w * 0.28, 0, 0.04, w * 0.08, d * 1.03, h * 0.92, rotZ, { ...meta, color: shadeHex(steel, 0.84), skipBottom: true }),
        ...subBox(cx, cy, cz, 0, 0, 0.04, w * 0.08, d * 1.03, h * 0.92, rotZ, { ...meta, color: shadeHex(steel, 0.84), skipBottom: true }),
        ...subBox(cx, cy, cz, w * 0.28, 0, 0.04, w * 0.08, d * 1.03, h * 0.92, rotZ, { ...meta, color: shadeHex(steel, 0.84), skipBottom: true }),
    ];
}

function buildBarrel({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const body = resolveMaterialColor(color || 'wood', '#92400e');
    const r = Math.min(w, d) * 0.48;
    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...cylinderPolygons({ ...meta, cx, cy, cz, radius: r, radiusTop: r * 0.95, h, segments: 8, rotZ, color: body, topColor: shadeHex(body, 1.12), capped: true }),
        ...cylinderPolygons({ ...meta, cx, cy, cz: cz + h * 0.22, radius: r * 1.04, radiusTop: r * 1.04, h: h * 0.08, segments: 8, rotZ, color: 'iron', capped: false }),
        ...cylinderPolygons({ ...meta, cx, cy, cz: cz + h * 0.72, radius: r * 1.04, radiusTop: r * 1.04, h: h * 0.08, segments: 8, rotZ, color: 'iron', capped: false }),
    ];
}

function buildCrate({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const wood = resolveMaterialColor(color || 'wood', '#a16207');
    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...boxPolygons({ ...meta, cx, cy, cz, w: w * 0.92, d: d * 0.92, h: h * 0.94, rotZ, color: wood, topColor: shadeHex(wood, 1.1), skipBottom: true }),
        ...subBox(cx, cy, cz, 0, 0, 0, w, d, h * 0.14, rotZ, { ...meta, color: shadeHex(wood, 0.78), skipBottom: true }),
        ...subBox(cx, cy, cz, 0, 0, h * 0.84, w, d, h * 0.14, rotZ, { ...meta, color: shadeHex(wood, 0.85), skipBottom: true }),
    ];
}

function buildDumpster({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const bin = resolveMaterialColor(color || 'green', '#15803d');
    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...boxPolygons({ ...meta, cx, cy, cz, w, d, h: h * 0.78, rotZ, color: bin, topColor: '#1e293b', skipBottom: true }),
        ...subBox(cx, cy, cz, 0, 0, h * 0.78, w * 1.02, d * 1.02, h * 0.14, rotZ, { ...meta, color: '#0f172a', skipBottom: true }),
    ];
}

function buildGenerator({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const body = resolveMaterialColor(color || 'amber', '#d97706');
    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...boxPolygons({ ...meta, cx, cy, cz, w, d, h: h * 0.14, rotZ, color: 'iron', skipBottom: true }),
        ...subBox(cx, cy, cz, -w * 0.1, 0, h * 0.14, w * 0.72, d * 0.86, h * 0.76, rotZ, { ...meta, color: body, skipBottom: true }),
        ...subBox(cx, cy, cz, w * 0.35, 0, h * 0.14, w * 0.2, d * 0.75, h * 0.62, rotZ, { ...meta, color: 'steel', skipBottom: true }),
    ];
}

function buildPallet({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const wood = resolveMaterialColor(color || 'wood', '#b45309');
    const deckH = h * 0.35;
    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...subBox(cx, cy, cz, -w * 0.36, 0, 0, w * 0.14, d, h * 0.65, rotZ, { ...meta, color: shadeHex(wood, 0.75), skipBottom: true }),
        ...subBox(cx, cy, cz, w * 0.36, 0, 0, w * 0.14, d, h * 0.65, rotZ, { ...meta, color: shadeHex(wood, 0.75), skipBottom: true }),
        ...subBox(cx, cy, cz, 0, 0, h * 0.65, w, d * 0.92, deckH, rotZ, { ...meta, color: wood, skipBottom: true }),
    ];
}

function buildPropane({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const col = resolveMaterialColor(color || 'red', '#dc2626');
    const r = Math.min(w, d) * 0.48;
    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...cylinderPolygons({ ...meta, cx, cy, cz, radius: r, radiusTop: r * 0.92, h: h * 0.78, segments: 8, rotZ, color: col, capped: true }),
        ...cylinderPolygons({ ...meta, cx, cy, cz: cz + h * 0.78, radius: r * 0.35, radiusTop: r * 0.5, h: h * 0.2, segments: 6, rotZ, color: 'brass', capped: true }),
    ];
}

function buildPipes({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const steel = resolveMaterialColor(color || 'steel', '#64748b');
    const r = Math.min(d, 0.26) * 0.55;
    return [
        ...contactShadow(cx, cy, cz, w, Math.max(d, 0.5), rotZ, meta),
        ...cylinderPolygons({ ...meta, cx: cx - w * 0.28, cy, cz, radius: r, radiusTop: r, h, segments: 6, rotZ, color: steel, capped: true }),
        ...cylinderPolygons({ ...meta, cx: cx + w * 0.28, cy, cz, radius: r, radiusTop: r, h, segments: 6, rotZ, color: shadeHex(steel, 0.85), capped: true }),
        ...subBox(cx, cy, cz, 0, 0, h * 0.62, w * 0.86, d * 0.6, Math.max(0.14, r * 1.4), rotZ, { ...meta, color: 'brass', skipBottom: true }),
    ];
}

function buildLocker({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const steel = resolveMaterialColor(color || 'steel', '#475569');
    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...boxPolygons({ ...meta, cx, cy, cz, w, d, h, rotZ, color: steel, topColor: shadeHex(steel, 1.1), skipBottom: true }),
        ...subBox(cx, cy, cz, -w * 0.22, d * 0.45, h * 0.08, w * 0.4, d * 0.1, h * 0.84, rotZ, { ...meta, color: shadeHex(steel, 1.12), skipBottom: true }),
        ...subBox(cx, cy, cz, w * 0.22, d * 0.45, h * 0.08, w * 0.4, d * 0.1, h * 0.84, rotZ, { ...meta, color: shadeHex(steel, 1.12), skipBottom: true }),
    ];
}

function buildVat({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const r = Math.min(w, d) * 0.48;
    const glow = resolveMaterialColor(color || 'magic', '#22d3ee');
    return [
        ...glowPool(cx, cy, cz, r * 2.3, 'rgba(34,211,238,0.42)', 'rgba(14,165,233,0.12)', meta),
        ...cylinderPolygons({ ...meta, cx, cy, cz, radius: r, radiusTop: r * 0.96, h: h * 0.16, segments: 8, rotZ, color: 'iron', capped: true }),
        ...cylinderPolygons({ ...meta, cx, cy, cz: cz + h * 0.16, radius: r * 0.82, radiusTop: r * 0.82, h: h * 0.68, segments: 8, rotZ, color: glow, unlit: true, className: `${meta.className || ''} lpe-poly-emissive`.trim(), capped: true }),
        ...cylinderPolygons({ ...meta, cx, cy, cz: cz + h * 0.84, radius: r * 0.98, radiusTop: r * 0.86, h: h * 0.16, segments: 8, rotZ, color: 'steel', capped: true }),
    ];
}

function buildConsole({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const frame = resolveMaterialColor(color || 'steel', '#334155');
    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...boxPolygons({ ...meta, cx, cy, cz, w, d, h: h * 0.56, rotZ, color: frame, topColor: shadeHex(frame, 1.12), skipBottom: true }),
        ...subBox(cx, cy, cz, 0, -d * 0.16, h * 0.56, w * 0.86, d * 0.22, h * 0.42, rotZ, {
            ...meta, color: '#38bdf8', unlit: true, className: `${meta.className || ''} lpe-poly-emissive`.trim(), skipBottom: true,
        }),
    ];
}

function buildCabinet({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const shell = resolveMaterialColor(color || 'slate', '#64748b');
    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...boxPolygons({ ...meta, cx, cy, cz, w, d, h, rotZ, color: shell, topColor: shadeHex(shell, 1.08), skipBottom: true }),
        ...subBox(cx, cy, cz, 0, d * 0.45, h * 0.48, w * 0.82, d * 0.08, h * 0.42, rotZ, {
            ...meta, color: 'glass', unlit: true, skipBottom: true,
        }),
    ];
}

function buildAirlock({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const steel = resolveMaterialColor(color || 'iron', '#334155');
    const pillarW = Math.max(0.24, w * 0.2);
    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...subBox(cx, cy, cz, -w / 2 + pillarW / 2, 0, 0, pillarW, d, h, rotZ, { ...meta, color: steel, skipBottom: true }),
        ...subBox(cx, cy, cz, w / 2 - pillarW / 2, 0, 0, pillarW, d, h, rotZ, { ...meta, color: steel, skipBottom: true }),
        ...subBox(cx, cy, cz, 0, 0, h * 0.82, w, d, h * 0.18, rotZ, { ...meta, color: shadeHex(steel, 1.16), skipBottom: true }),
        ...subBox(cx, cy, cz, 0, 0, 0, w - pillarW * 2, d * 0.42, h * 0.82, rotZ, { ...meta, color: '#0ea5e9', unlit: true, skipBottom: true }),
    ];
}

function buildScreen({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    const trim = resolveMaterialColor(color || 'steel', '#1e293b');
    return [
        ...glowPool(cx, cy, cz, Math.max(w, 1.2), 'rgba(56,189,248,0.34)', 'rgba(14,165,233,0.08)', meta),
        ...subBox(cx, cy, cz, 0, 0, 0, w * 0.4, Math.max(0.32, d), h * 0.16, rotZ, { ...meta, color: trim, skipBottom: true }),
        ...subBox(cx, cy, cz, 0, 0, h * 0.16, w, Math.max(0.14, d), h * 0.84, rotZ, {
            ...meta, color: '#38bdf8', unlit: true, className: `${meta.className || ''} lpe-poly-emissive`.trim(), skipBottom: true,
        }),
    ];
}

function buildPlatform({ cx, cy, cz, localZ = 0, w, d, h, rotZ, color, meta }) {
    const deck = resolveMaterialColor(color || 'iron', '#64748b');
    const slabH = Math.max(0.16, Math.min(0.35, h));
    const railH = 0.85;
    const faces = [];

    if (localZ > 0.25) {
        const legT = Math.max(0.1, Math.min(0.22, Math.min(w, d) * 0.08));
        faces.push(...fourLegs(cx, cy, cz - localZ, w * 0.92, d * 0.92, localZ, legT, rotZ, shadeHex(deck, 0.68), meta));
        faces.push(...contactShadow(cx, cy, cz - localZ, w * 0.95, d * 0.95, rotZ, meta));
    } else {
        faces.push(...contactShadow(cx, cy, cz, w, d, rotZ, meta));
    }

    // Elevated deck slab
    faces.push(...boxPolygons({
        ...meta,
        cx,
        cy,
        cz,
        w,
        d,
        h: slabH,
        rotZ,
        color: deck,
        topColor: shadeHex(deck, 1.15),
        skipBottom: false,
    }));

    // Subtle guardrails along long side edges when platform is raised
    if (localZ > 0.4) {
        const railT = 0.07;
        for (const sy of [-1, 1]) {
            const ry = sy * (d / 2 - railT);
            faces.push(...subBox(cx, cy, cz + slabH, 0, ry, railH - 0.08, w, railT, 0.08, rotZ, {
                ...meta, color: shadeHex(deck, 1.25), skipBottom: true,
            }));
            for (const sx of [-1, 1]) {
                faces.push(...subBox(cx, cy, cz + slabH, sx * (w / 2 - railT), ry, 0, railT, railT, railH - 0.08, rotZ, {
                    ...meta, color: shadeHex(deck, 0.85), skipBottom: true,
                }));
            }
        }
    }

    return faces;
}

const PREFAB_BUILDERS = Object.freeze({
    rug: (props) => buildSketchfabFallback({ ...props, h: Math.min(props.h, 0.05), color: props.color || 'cloth' }),
    globe: ({ cx, cy, cz, w, d, h, color, meta }) =>
        spherePolygons({ ...meta, cx, cy, cz, radius: Math.min(w, d, h) / 2, color: color || 'stone' }),
    table: buildTable,
    chair: buildChair,
    couch: buildCouch,
    bed: buildBed,
    bookshelf: buildBookshelf,
    desk: buildDesk,
    hearth: buildHearth,
    brazier: buildBrazier,
    lamp: buildLamp,
    chest: buildChest,
    tree: buildTree,
    crystal: buildCrystal,
    ladder: buildLadder,
    hourglass: buildHourglass,
    container: buildContainer,
    barrel: buildBarrel,
    crate: buildCrate,
    dumpster: buildDumpster,
    generator: buildGenerator,
    pallet: buildPallet,
    propane: buildPropane,
    pipes: buildPipes,
    locker: buildLocker,
    vat: buildVat,
    console: buildConsole,
    cabinet: buildCabinet,
    airlock: buildAirlock,
    screen: buildScreen,
    platform: buildPlatform,
});

function buildSketchfabFallback({ cx, cy, cz, w, d, h, rotZ, color, meta }) {
    return [
        ...contactShadow(cx, cy, cz, w, d, rotZ, meta),
        ...boxPolygons({ ...meta, cx, cy, cz, w, d, h, rotZ, color: color || 'wood', skipBottom: false }),
    ];
}

/**
 * Compile any composite diorama prefab object `{ shape, pos, size, rot, color, label }`
 * into world-space polygons anchored at `worldOrigin = { x, y, z }`.
 */
export function prefabToPolygons(obj, worldOrigin = { x: 0, y: 0, z: 0 }, extraMeta = {}) {
    if (!obj || typeof obj !== 'object') return [];
    const shape = String(obj.shape || '').toLowerCase();
    const builder = PREFAB_BUILDERS[shape] || (Object.hasOwn(SKETCHFAB_ASSETS, shape) ? buildSketchfabFallback : null);
    if (!builder) return [];

    const defSize = PREFAB_DEFAULT_SIZES[shape] || [1.6, 1.2, 1.2];
    const pos = Array.isArray(obj.pos) ? obj.pos : [1, 1, 0];
    const size = Array.isArray(obj.size) ? obj.size : defSize;

    const localZ = Number(pos[2]) || 0;
    const cx = (Number(worldOrigin.x) || 0) + (Number(pos[0]) || 0);
    const cy = (Number(worldOrigin.y) || 0) + (Number(pos[1]) || 0);
    const cz = (Number(worldOrigin.z) || 0) + localZ;
    const w = Math.max(0.35, Number(size[0]) || defSize[0]);
    const d = Math.max(0.35, Number(size[1]) || defSize[1]);
    const h = Math.max(0.25, Number(size[2]) || defSize[2]);
    const rotZ = Number(obj.rot) || 0;
    const color = obj.color || '';
    const meta = {
        ...extraMeta,
        title: extraMeta.title || obj.label || shape,
    };

    return builder({ cx, cy, cz, localZ, w, d, h, rotZ, color, meta });
}
