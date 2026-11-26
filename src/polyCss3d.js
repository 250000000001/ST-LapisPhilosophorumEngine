/**
 * Pure CSS 3D Polygon & Mesh Library (PolyCSS-inspired).
 *
 * Converts 3D polygon meshes and 10 geometric primitives into hardware-accelerated
 * DOM elements using CSS `matrix3d(...)` transforms inside a `preserve-3d` scene,
 * with solid-quad clip-path optimization, flat directional shading, billboard labels,
 * and pointer/wheel orbit controls.
 *
 * HTML-compiling functions are pure ES (zero DOM dependency) so Node tests run directly.
 */

import { POLY_PREFABS, prefabToPolygons } from './polyAssets.js';

export const POLY_SHAPES = Object.freeze([
    'box',
    'cylinder',
    'cone',
    'wedge',
    'stairs',
    'sphere',
    'plane',
    'arch',
    'octahedron',
    'ring',
]);

export const POLY_MATERIALS = Object.freeze({
    wood: '#9c6b43',
    dark_wood: '#5c3d28',
    stone: '#8b929e',
    dark_stone: '#4e5460',
    ice: '#89dceb',
    snow: '#dce6f2',
    water: '#3b82c4',
    iron: '#606875',
    gold: '#e6b44c',
    copper: '#c8754b',
    fire: '#f97316',
    cloth: '#a85578',
    leather: '#7c4d32',
    grass: '#5a8f54',
    pine: '#2f6644',
    earth: '#785c42',
    bone: '#d9cfb8',
    blood: '#a62639',
    magic: '#b388ff',
    glass: '#93c5fd',
});

function escAttr(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function round4(n) {
    const r = Math.round(n * 10000) / 10000;
    return Object.is(r, -0) ? 0 : r;
}

function expandShortHex(hex) {
    const m = String(hex || '').match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
    if (!m) return hex;
    return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase();
}

/**
 * Resolve a hex code or semantic material keyword (e.g. "dark_wood", "fire") to `#rrggbb`.
 */
export function resolveMaterialColor(colorStr, fallback = '#8b929e') {
    const raw = String(colorStr || '').trim();
    if (!raw) return fallback;

    const hex6 = raw.match(/#([0-9a-f]{6})\b/i);
    if (hex6) return `#${hex6[1].toLowerCase()}`;

    const hex3 = raw.match(/#([0-9a-f]{3})\b/i);
    if (hex3) return expandShortHex(`#${hex3[1]}`);

    const key = raw.toLowerCase().replace(/[\s-]+/g, '_');
    if (POLY_MATERIALS[key]) return POLY_MATERIALS[key];

    for (const [mat, hex] of Object.entries(POLY_MATERIALS)) {
        if (key.includes(mat)) return hex;
    }
    return fallback;
}

/**
 * Multiply RGB channels of `#rgb` / `#rrggbb` by `factor`, clamped to `[0..255]`.
 */
export function shadeHex(hex, factor = 1) {
    let clean = String(hex || '').trim();
    if (/^#[0-9a-f]{3}$/i.test(clean)) clean = expandShortHex(clean);
    const m = clean.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return '#8b929e';
    const r = clamp(Math.round(parseInt(m[1], 16) * factor), 0, 255);
    const g = clamp(Math.round(parseInt(m[2], 16) * factor), 0, 255);
    const b = clamp(Math.round(parseInt(m[3], 16) * factor), 0, 255);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scaleVec(a, s) {
    return [a[0] * s, a[1] * s, a[2] * s];
}

function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}

function length(v) {
    return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v) {
    const l = length(v);
    if (l < 1e-8) return [0, 0, 0];
    return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Project a 3D polygon (`vertices: [[x,y,z], ...]`) into a CSS `matrix3d(...)` leaf quad.
 * Right-handed coordinates: `+X` East, `+Y` South, `+Z` Up.
 */
export function projectPolygonToCss(
    poly,
    {
        scale = 12,
        lightDir = [0.45, 0.35, 0.82],
        ambient = 0.54,
        diffuse = 0.46,
    } = {},
) {
    const verts = poly?.vertices;
    if (!Array.isArray(verts) || verts.length < 3) return null;

    const pts = verts.map((v) => [Number(v[0]) * scale, Number(v[1]) * scale, Number(v[2]) * scale]);
    const P0 = pts[0];
    const e1 = sub(pts[1], P0);
    if (length(e1) < 1e-4) return null;

    // Pick a non-collinear vertex for normal calculation
    let nRaw = null;
    for (let i = 2; i < pts.length; i++) {
        const candidate = cross(e1, sub(pts[i], P0));
        if (length(candidate) > 1e-4) {
            nRaw = candidate;
            break;
        }
    }
    if (!nRaw) return null;

    const u = normalize(e1);
    const n = normalize(nRaw);
    const v = cross(n, u); // Right-handed basis: u x v = n, det([u, v, n]) = +1

    const proj = pts.map((p) => {
        const d = sub(p, P0);
        return [dot(d, u), dot(d, v)];
    });

    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const [pu, pv] of proj) {
        if (pu < uMin) uMin = pu;
        if (pu > uMax) uMax = pu;
        if (pv < vMin) vMin = pv;
        if (pv > vMax) vMax = pv;
    }

    const width = uMax - uMin;
    const height = vMax - vMin;
    if (width < 0.25 || height < 0.25) return null;

    const origin = add(P0, add(scaleVec(u, uMin), scaleVec(v, vMin)));
    const matrix3d = `matrix3d(${[
        round4(u[0]), round4(u[1]), round4(u[2]), 0,
        round4(v[0]), round4(v[1]), round4(v[2]), 0,
        round4(n[0]), round4(n[1]), round4(n[2]), 0,
        round4(origin[0]), round4(origin[1]), round4(origin[2]), 1,
    ].join(',')})`;

    const local = proj.map(([pu, pv]) => [pu - uMin, pv - vMin]);

    // Solid-quad optimization: skip clip-path when 4 vertices cover the 4 bounding corners
    let clipPath = '';
    let isSolidQuad = false;
    if (local.length === 4) {
        const eps = 0.05;
        const cornerMask = new Set();
        let allOnCorner = true;
        for (const [lx, ly] of local) {
            const onLeft = Math.abs(lx) <= eps;
            const onRight = Math.abs(lx - width) <= eps;
            const onTop = Math.abs(ly) <= eps;
            const onBot = Math.abs(ly - height) <= eps;
            if (!((onLeft || onRight) && (onTop || onBot))) {
                allOnCorner = false;
                break;
            }
            cornerMask.add(`${onLeft ? 0 : 1},${onTop ? 0 : 1}`);
        }
        if (allOnCorner && cornerMask.size === 4) {
            isSolidQuad = true;
        }
    }

    if (!isSolidQuad) {
        const polyPts = local.map(([lx, ly]) => `${round4((lx / width) * 100)}% ${round4((ly / height) * 100)}%`);
        clipPath = `polygon(${polyPts.join(',')})`;
    }

    const lNorm = normalize(lightDir);
    const ndotl = Math.max(0, dot(n, lNorm));
    const underside = n[2] < -0.5 ? -0.12 : 0;
    const shade = clamp(ambient + diffuse * ndotl + underside, 0.32, 1.18);
    const bgColor = poly.unlit ? resolveMaterialColor(poly.color) : shadeHex(resolveMaterialColor(poly.color), shade);

    return {
        width: round4(width),
        height: round4(height),
        matrix3d,
        clipPath,
        bgColor,
        background: poly.background || '',
        borderRadius: poly.borderRadius || '',
        noBorder: Boolean(poly.noBorder),
        animGroup: poly.animGroup || '',
        opacity: poly.opacity ?? 1,
        doubleSided: Boolean(poly.doubleSided),
        normal: n,
        origin,
        u,
        v,
        className: poly.className || '',
        dataAttrs: poly.dataAttrs || null,
        title: poly.title || '',
    };
}

export function rotatePointXY(x, y, cx, cy, rotDeg = 0) {
    if (!rotDeg) return [x, y];
    const rad = (rotDeg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

function rotateVerticesXY(verts, cx, cy, rotDeg = 0) {
    if (!rotDeg) return verts;
    return verts.map(([x, y, z]) => {
        const [rx, ry] = rotatePointXY(x, y, cx, cy, rotDeg);
        return [rx, ry, z];
    });
}

function makePoly(vertices, meta = {}) {
    return {
        vertices,
        color: meta.color || 'stone',
        background: meta.background || '',
        borderRadius: meta.borderRadius || '',
        noBorder: Boolean(meta.noBorder),
        animGroup: meta.animGroup || '',
        opacity: meta.opacity ?? 1,
        doubleSided: Boolean(meta.doubleSided),
        unlit: Boolean(meta.unlit),
        className: meta.className || '',
        dataAttrs: meta.dataAttrs || null,
        title: meta.title || '',
    };
}

/**
 * Horizontal decal quad at `z = cz` for ground contact shadows, radial light pools,
 * or textured floor overlays. Never shaded or bordered.
 */
export function decalPolygon({
    cx = 0,
    cy = 0,
    cz = 0.015,
    w = 2,
    d = 2,
    rotZ = 0,
    background = '',
    color = '#000000',
    borderRadius = '',
    opacity = 1,
    className = '',
    ...meta
} = {}) {
    const hw = w / 2;
    const hd = d / 2;
    const verts = rotateVerticesXY([
        [cx - hw, cy - hd, cz],
        [cx + hw, cy - hd, cz],
        [cx + hw, cy + hd, cz],
        [cx - hw, cy + hd, cz],
    ], cx, cy, rotZ);
    return [makePoly(verts, {
        ...meta,
        color,
        background,
        borderRadius,
        opacity,
        doubleSided: true,
        unlit: true,
        noBorder: true,
        className,
    })];
}

/**
 * Horizontal quad at `z = cz`, outward normal `+Z`.
 */
export function planePolygons({
    cx = 0,
    cy = 0,
    cz = 0,
    w = 2,
    d = 2,
    rotZ = 0,
    color = 'stone',
    opacity = 1,
    doubleSided = true,
    ...meta
} = {}) {
    const hw = w / 2;
    const hd = d / 2;
    const verts = rotateVerticesXY([
        [cx - hw, cy - hd, cz],
        [cx + hw, cy - hd, cz],
        [cx + hw, cy + hd, cz],
        [cx - hw, cy + hd, cz],
    ], cx, cy, rotZ);
    return [makePoly(verts, { ...meta, color, opacity, doubleSided })];
}

/**
 * Cuboid mesh with outward-facing CCW quads.
 */
export function boxPolygons({
    cx = 0,
    cy = 0,
    cz = 0,
    w = 2,
    d = 2,
    h = 1.5,
    rotZ = 0,
    color = 'wood',
    topColor = '',
    sideColor = '',
    opacity = 1,
    skipTop = false,
    skipBottom = true,
    skipFaces = [],
    ...meta
} = {}) {
    const skip = new Set(skipFaces);
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const y0 = cy - d / 2;
    const y1 = cy + d / 2;
    const z0 = cz;
    const z1 = cz + h;
    const topC = topColor || color;
    const sideC = sideColor || color;
    const faces = [];

    if (!skipTop && !skip.has('top')) {
        faces.push(makePoly(rotateVerticesXY([
            [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
        ], cx, cy, rotZ), { ...meta, color: topC, opacity }));
    }
    if (!skipBottom && !skip.has('bottom')) {
        faces.push(makePoly(rotateVerticesXY([
            [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0],
        ], cx, cy, rotZ), { ...meta, color: sideC, opacity }));
    }
    if (!skip.has('south')) {
        faces.push(makePoly(rotateVerticesXY([
            [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0],
        ], cx, cy, rotZ), { ...meta, color: sideC, opacity }));
    }
    if (!skip.has('north')) {
        faces.push(makePoly(rotateVerticesXY([
            [x1, y0, z1], [x0, y0, z1], [x0, y0, z0], [x1, y0, z0],
        ], cx, cy, rotZ), { ...meta, color: sideC, opacity }));
    }
    if (!skip.has('east')) {
        faces.push(makePoly(rotateVerticesXY([
            [x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0],
        ], cx, cy, rotZ), { ...meta, color: sideC, opacity }));
    }
    if (!skip.has('west')) {
        faces.push(makePoly(rotateVerticesXY([
            [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0],
        ], cx, cy, rotZ), { ...meta, color: sideC, opacity }));
    }
    return faces;
}

/**
 * Faceted cylinder / frustum with outward side quads and optional top cap.
 */
export function cylinderPolygons({
    cx = 0,
    cy = 0,
    cz = 0,
    radius = 0.8,
    radiusTop = null,
    h = 2,
    segments = 8,
    rotZ = 0,
    color = 'stone',
    topColor = '',
    opacity = 1,
    capped = true,
    ...meta
} = {}) {
    const rBot = Math.max(0.05, Number(radius) || 0.8);
    const rTop = radiusTop !== null && radiusTop !== undefined ? Math.max(0.05, Number(radiusTop)) : rBot;
    const segs = Math.max(4, Math.min(20, Math.round(segments)));
    const rotRad = ((rotZ || 0) * Math.PI) / 180;
    const topRing = [];
    const botRing = [];

    for (let i = 0; i < segs; i++) {
        const ang = rotRad + (i * 2 * Math.PI) / segs;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        topRing.push([cx + rTop * cos, cy + rTop * sin, cz + h]);
        botRing.push([cx + rBot * cos, cy + rBot * sin, cz]);
    }

    const faces = [];
    for (let i = 0; i < segs; i++) {
        const next = (i + 1) % segs;
        faces.push(makePoly(
            [topRing[next], topRing[i], botRing[i], botRing[next]],
            { ...meta, color, opacity },
        ));
    }
    if (capped) {
        faces.push(makePoly(topRing, { ...meta, color: topColor || color, opacity }));
    }
    return faces;
}

/**
 * Faceted cone / pyramid meeting at `(cx, cy, cz + h)`.
 */
export function conePolygons({
    cx = 0,
    cy = 0,
    cz = 0,
    radius = 0.8,
    h = 2,
    segments = 8,
    rotZ = 0,
    color = 'fire',
    opacity = 1,
    capped = false,
    ...meta
} = {}) {
    const r = Math.max(0.05, Number(radius) || 0.8);
    const segs = Math.max(3, Math.min(20, Math.round(segments)));
    const rotRad = ((rotZ || 0) * Math.PI) / 180;
    const apex = [cx, cy, cz + h];
    const baseRing = [];

    for (let i = 0; i < segs; i++) {
        const ang = rotRad + (i * 2 * Math.PI) / segs;
        baseRing.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang), cz]);
    }

    const faces = [];
    for (let i = 0; i < segs; i++) {
        const next = (i + 1) % segs;
        faces.push(makePoly([apex, baseRing[i], baseRing[next]], { ...meta, color, opacity }));
    }
    if (capped) {
        faces.push(makePoly([...baseRing].reverse(), { ...meta, color, opacity }));
    }
    return faces;
}

/**
 * Triangular prism wedge rising from `y = cy + d/2` (`z = cz`) up to `y = cy - d/2` (`z = cz + h`).
 */
export function wedgePolygons({
    cx = 0,
    cy = 0,
    cz = 0,
    w = 2,
    d = 2,
    h = 1.5,
    rotZ = 0,
    color = 'stone',
    opacity = 1,
    ...meta
} = {}) {
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const y0 = cy - d / 2;
    const y1 = cy + d / 2;
    const z0 = cz;
    const z1 = cz + h;

    return [
        // Sloped top (+Y, +Z)
        makePoly(rotateVerticesXY([
            [x0, y0, z1], [x1, y0, z1], [x1, y1, z0], [x0, y1, z0],
        ], cx, cy, rotZ), { ...meta, color, opacity }),
        // Back wall (-Y)
        makePoly(rotateVerticesXY([
            [x1, y0, z1], [x0, y0, z1], [x0, y0, z0], [x1, y0, z0],
        ], cx, cy, rotZ), { ...meta, color, opacity }),
        // East triangle (+X)
        makePoly(rotateVerticesXY([
            [x1, y1, z0], [x1, y0, z1], [x1, y0, z0],
        ], cx, cy, rotZ), { ...meta, color, opacity }),
        // West triangle (-X)
        makePoly(rotateVerticesXY([
            [x0, y0, z1], [x0, y1, z0], [x0, y0, z0],
        ], cx, cy, rotZ), { ...meta, color, opacity }),
    ];
}

/**
 * Stepped staircase rising along `-Y` (or rotated by `rotZ` degrees).
 */
export function stairsPolygons({
    cx = 0,
    cy = 0,
    cz = 0,
    w = 2,
    d = 3,
    h = 2.4,
    steps = 4,
    rotZ = 0,
    color = 'stone',
    opacity = 1,
    ...meta
} = {}) {
    const count = Math.max(2, Math.min(8, Math.round(steps)));
    const stepD = d / count;
    const stepH = h / count;
    const faces = [];

    for (let i = 0; i < count; i++) {
        // Step 0 at front (+Y) lowest, Step count-1 at back (-Y) highest
        const localCy = cy + d / 2 - stepD * (i + 0.5);
        const curH = stepH * (i + 1);
        const [rx, ry] = rotatePointXY(cx, localCy, cx, cy, rotZ);
        faces.push(...boxPolygons({
            ...meta,
            cx: rx,
            cy: ry,
            cz,
            w,
            d: stepD,
            h: curH,
            rotZ,
            color,
            opacity,
            skipBottom: true,
        }));
    }
    return faces;
}

/**
 * Faceted sphere resting on `cz` (center at `cz + radius`).
 */
export function spherePolygons({
    cx = 0,
    cy = 0,
    cz = 0,
    radius = 0.8,
    latSegments = 3,
    lonSegments = 6,
    color = 'stone',
    opacity = 1,
    ...meta
} = {}) {
    const r = Math.max(0.1, Number(radius) || 0.8);
    const lats = Math.max(2, Math.min(8, Math.round(latSegments)));
    const lons = Math.max(4, Math.min(14, Math.round(lonSegments)));
    const centerZ = cz + r;
    const topPole = [cx, cy, centerZ + r];
    const botPole = [cx, cy, centerZ - r];

    const rings = [];
    for (let lat = 1; lat < lats; lat++) {
        const phi = (lat * Math.PI) / lats;
        const sinP = Math.sin(phi);
        const cosP = Math.cos(phi);
        const ring = [];
        for (let lon = 0; lon < lons; lon++) {
            const theta = (lon * 2 * Math.PI) / lons;
            ring.push([
                cx + r * sinP * Math.cos(theta),
                cy + r * sinP * Math.sin(theta),
                centerZ + r * cosP,
            ]);
        }
        rings.push(ring);
    }

    const faces = [];
    // Top cap triangles
    for (let lon = 0; lon < lons; lon++) {
        const next = (lon + 1) % lons;
        faces.push(makePoly([topPole, rings[0][lon], rings[0][next]], { ...meta, color, opacity }));
    }
    // Middle quad bands
    for (let row = 0; row < rings.length - 1; row++) {
        for (let lon = 0; lon < lons; lon++) {
            const next = (lon + 1) % lons;
            faces.push(makePoly(
                [rings[row][lon], rings[row + 1][lon], rings[row + 1][next], rings[row][next]],
                { ...meta, color, opacity },
            ));
        }
    }
    // Bottom cap triangles
    const lastRing = rings[rings.length - 1];
    for (let lon = 0; lon < lons; lon++) {
        const next = (lon + 1) % lons;
        faces.push(makePoly([botPole, lastRing[next], lastRing[lon]], { ...meta, color, opacity }));
    }
    return faces;
}

/**
 * Archway / gate / hearth frame built from left pillar, right pillar, and top lintel.
 */
export function archPolygons({
    cx = 0,
    cy = 0,
    cz = 0,
    w = 2,
    d = 0.6,
    h = 2.4,
    rotZ = 0,
    color = 'stone',
    opacity = 1,
    ...meta
} = {}) {
    const pillarW = Math.max(0.2, Math.min(w * 0.28, 0.55));
    const lintelH = Math.max(0.25, Math.min(h * 0.26, 0.65));
    const postH = Math.max(0.3, h - lintelH);
    const offset = w / 2 - pillarW / 2;

    const [lx, ly] = rotatePointXY(cx - offset, cy, cx, cy, rotZ);
    const [rx, ry] = rotatePointXY(cx + offset, cy, cx, cy, rotZ);

    return [
        ...boxPolygons({
            ...meta, cx: lx, cy: ly, cz, w: pillarW, d, h: postH, rotZ, color, opacity, skipTop: true, skipBottom: true,
        }),
        ...boxPolygons({
            ...meta, cx: rx, cy: ry, cz, w: pillarW, d, h: postH, rotZ, color, opacity, skipTop: true, skipBottom: true,
        }),
        ...boxPolygons({
            ...meta, cx, cy, cz: cz + postH, w, d, h: lintelH, rotZ, color, opacity, skipBottom: false,
        }),
    ];
}

/**
 * 8-sided diamond / crystal octahedron spanning `[cz .. cz + h]`.
 */
export function octahedronPolygons({
    cx = 0,
    cy = 0,
    cz = 0,
    radius = 0.7,
    h = 1.6,
    rotZ = 0,
    color = 'magic',
    opacity = 1,
    ...meta
} = {}) {
    const r = Math.max(0.1, Number(radius) || 0.7);
    const rotRad = ((rotZ || 0) * Math.PI) / 180;
    const midZ = cz + h / 2;
    const top = [cx, cy, cz + h];
    const bot = [cx, cy, cz];
    const eq = [];

    for (let i = 0; i < 4; i++) {
        const ang = rotRad + (i * Math.PI) / 2;
        eq.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang), midZ]);
    }

    const faces = [];
    for (let i = 0; i < 4; i++) {
        const next = (i + 1) % 4;
        faces.push(makePoly([top, eq[i], eq[next]], { ...meta, color, opacity }));
        faces.push(makePoly([bot, eq[next], eq[i]], { ...meta, color, opacity }));
    }
    return faces;
}

/**
 * Flat annular ring on `z = cz`, outward normal `+Z`.
 */
export function ringPolygons({
    cx = 0,
    cy = 0,
    cz = 0.04,
    innerR = 0.6,
    outerR = 1.0,
    segments = 10,
    rotZ = 0,
    color = 'stone',
    opacity = 1,
    ...meta
} = {}) {
    const rIn = Math.max(0.05, Number(innerR) || 0.6);
    const rOut = Math.max(rIn + 0.1, Number(outerR) || 1.0);
    const segs = Math.max(4, Math.min(20, Math.round(segments)));
    const rotRad = ((rotZ || 0) * Math.PI) / 180;

    const faces = [];
    for (let i = 0; i < segs; i++) {
        const a0 = rotRad + (i * 2 * Math.PI) / segs;
        const a1 = rotRad + ((i + 1) * 2 * Math.PI) / segs;
        const c0 = Math.cos(a0);
        const s0 = Math.sin(a0);
        const c1 = Math.cos(a1);
        const s1 = Math.sin(a1);
        faces.push(makePoly([
            [cx + rIn * c0, cy + rIn * s0, cz],
            [cx + rOut * c0, cy + rOut * s0, cz],
            [cx + rOut * c1, cy + rOut * s1, cz],
            [cx + rIn * c1, cy + rIn * s1, cz],
        ], { ...meta, color, opacity, doubleSided: true }));
    }
    return faces;
}

/**
 * Convert a normalized Atlas 3D object `{ shape, pos, size, rot, color, label }`
 * into world-space polygons anchored at `worldOrigin = { x, y, z }`.
 */
export function shapeToPolygons(obj, worldOrigin = { x: 0, y: 0, z: 0 }, extraMeta = {}) {
    if (!obj || typeof obj !== 'object') return [];
    const shape = String(obj.shape || 'box').toLowerCase();
    const pos = Array.isArray(obj.pos) ? obj.pos : [1, 1, 0];
    const size = Array.isArray(obj.size) ? obj.size : [1.4, 1.4, 1.2];

    const cx = (Number(worldOrigin.x) || 0) + (Number(pos[0]) || 0);
    const cy = (Number(worldOrigin.y) || 0) + (Number(pos[1]) || 0);
    const cz = (Number(worldOrigin.z) || 0) + (Number(pos[2]) || 0);
    const w = Math.max(0.25, Number(size[0]) || 1.4);
    const d = Math.max(0.25, Number(size[1]) || w);
    const h = Math.max(0.2, Number(size[2]) || 1.2);
    const rotZ = Number(obj.rot) || 0;
    const color = obj.color || 'stone';
    const meta = {
        ...extraMeta,
        title: extraMeta.title || obj.label || shape,
        color,
    };

    if (POLY_PREFABS.includes(shape)) {
        return prefabToPolygons(obj, worldOrigin, extraMeta);
    }

    switch (shape) {
        case 'plane':
            return planePolygons({ ...meta, cx, cy, cz: cz + 0.03, w, d, rotZ });
        case 'cylinder':
            return cylinderPolygons({ ...meta, cx, cy, cz, radius: Math.min(w, d) / 2, h, rotZ });
        case 'cone':
            return conePolygons({ ...meta, cx, cy, cz, radius: Math.min(w, d) / 2, h, rotZ });
        case 'wedge':
            return wedgePolygons({ ...meta, cx, cy, cz, w, d, h, rotZ });
        case 'stairs':
            return stairsPolygons({ ...meta, cx, cy, cz, w, d, h, rotZ });
        case 'sphere':
            return spherePolygons({ ...meta, cx, cy, cz, radius: Math.min(w, d, h) / 2 });
        case 'arch':
            return archPolygons({ ...meta, cx, cy, cz, w, d, h, rotZ });
        case 'octahedron':
            return octahedronPolygons({ ...meta, cx, cy, cz, radius: Math.min(w, d) / 2, h, rotZ });
        case 'ring': {
            const outerR = Math.max(0.3, Math.min(w, d) / 2);
            return ringPolygons({ ...meta, cx, cy, cz: cz + 0.04, innerR: outerR * 0.58, outerR, rotZ });
        }
        case 'box':
        default:
            return boxPolygons({ ...meta, cx, cy, cz, w, d, h, rotZ });
    }
}

/**
 * Compile world-space polygons & billboard labels into a pure CSS 3D HTML viewport.
 */
export function compilePolySceneHtml({
    polygons = [],
    labels = [],
    camera = {},
    scale = 12,
    origin = { x: 0, y: 0, z: 0 },
    overlayHtml = '',
    viewportClass = '',
} = {}) {
    const cam = {
        rotX: camera?.rotX ?? 56,
        rotZ: camera?.rotZ ?? 32,
        zoom: camera?.zoom ?? 1,
        panX: camera?.panX ?? 0,
        panY: camera?.panY ?? 0,
    };
    const ox = Number(origin?.x) || 0;
    const oy = Number(origin?.y) || 0;
    const oz = Number(origin?.z) || 0;

    const faceHtmlParts = [];
    const animGroups = new Map();
    let compiledFaceCount = 0;

    for (const poly of polygons) {
        if (!poly?.vertices?.length) continue;
        const shifted = {
            ...poly,
            vertices: poly.vertices.map(([vx, vy, vz]) => [vx - ox, vy - oy, vz - oz]),
        };
        const css = projectPolygonToCss(shifted, { scale });
        if (!css) continue;
        compiledFaceCount++;

        const styles = [
            `width:${css.width}px`,
            `height:${css.height}px`,
            `background:${css.background || css.bgColor}`,
            `transform:${css.matrix3d}`,
        ];
        if (css.clipPath) styles.push(`clip-path:${css.clipPath}`);
        if (css.borderRadius) styles.push(`border-radius:${css.borderRadius}`);
        if (css.noBorder) styles.push('border:none');
        if (css.opacity < 1) styles.push(`opacity:${round4(css.opacity)}`);
        if (css.doubleSided) styles.push('backface-visibility:visible');

        let attrStr = '';
        if (css.dataAttrs && typeof css.dataAttrs === 'object') {
            for (const [k, v] of Object.entries(css.dataAttrs)) {
                if (v !== undefined && v !== null && v !== '') {
                    attrStr += ` data-${escAttr(k)}="${escAttr(v)}"`;
                }
            }
        }
        const titleAttr = css.title ? ` title="${escAttr(css.title)}"` : '';
        const cls = css.className ? `vse-poly-face ${escAttr(css.className)}` : 'vse-poly-face';
        const faceEl = `<div class="${cls}" style="${styles.join(';')}"${attrStr}${titleAttr}></div>`;
        if (css.animGroup) {
            if (!animGroups.has(css.animGroup)) animGroups.set(css.animGroup, []);
            animGroups.get(css.animGroup).push(faceEl);
        } else {
            faceHtmlParts.push(faceEl);
        }
    }

    for (const [grp, parts] of animGroups.entries()) {
        const grpCls = grp.replace(/[^a-z0-9_-]/gi, '');
        faceHtmlParts.push(`<div class="vse-poly-anim vse-anim-${escAttr(grpCls)}">${parts.join('')}</div>`);
    }

    const labelHtmlParts = [];
    for (const lb of labels) {
        const lx = round4(((Number(lb.x) || 0) - ox) * scale);
        const ly = round4(((Number(lb.y) || 0) - oy) * scale);
        const lz = round4(((Number(lb.z) || 0) - oz) * scale);
        const cls = lb.className ? `vse-poly-label ${escAttr(lb.className)}` : 'vse-poly-label';
        const roomAttr = lb.roomId ? ` data-room-id="${escAttr(lb.roomId)}"` : '';
        const titleAttr = lb.title ? ` title="${escAttr(lb.title)}"` : '';
        const transform = `translate3d(${lx}px,${ly}px,${lz}px) rotateZ(calc(var(--vse-rz) * -1)) rotateX(calc(var(--vse-rx) * -1)) translate(-50%,-50%)`;
        labelHtmlParts.push(`<div class="${cls}" style="transform:${transform}"${roomAttr}${titleAttr}>${lb.html}</div>`);
    }

    const varStyle = [
        `--vse-rx:${round4(cam.rotX)}deg`,
        `--vse-rz:${round4(cam.rotZ)}deg`,
        `--vse-zoom:${round4(cam.zoom)}`,
        `--vse-pan-x:${round4(cam.panX)}px`,
        `--vse-pan-y:${round4(cam.panY)}px`,
    ].join(';');

    const cls = viewportClass ? `vse-poly-viewport ${escAttr(viewportClass)}` : 'vse-poly-viewport';
    const html = `
        <div class="${cls}" style="${varStyle}" data-face-count="${compiledFaceCount}">
            <div class="vse-poly-stage">
                <div class="vse-poly-camera">
                    <div class="vse-poly-scene">
                        ${faceHtmlParts.join('')}
                        ${labelHtmlParts.join('')}
                    </div>
                </div>
            </div>
            ${overlayHtml}
        </div>
    `;

    return { html, faceCount: compiledFaceCount };
}

/**
 * Attach smooth pointer orbit/pan + wheel zoom + camera preset buttons onto a mounted `.vse-poly-viewport`.
 * Mutates CSS custom properties via `requestAnimationFrame` without re-rendering DOM nodes.
 */
export function bindPolyOrbitControls(viewportEl, cameraState, { onCameraChange, onSelectRoom } = {}) {
    if (!viewportEl || typeof viewportEl.addEventListener !== 'function') return;

    const cam = cameraState || { rotX: 56, rotZ: 32, zoom: 1, panX: 0, panY: 0 };
    let rafId = 0;

    function scheduleApply() {
        if (rafId) return;
        const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
        rafId = schedule(() => {
            rafId = 0;
            viewportEl.style.setProperty('--vse-rx', `${round4(cam.rotX)}deg`);
            viewportEl.style.setProperty('--vse-rz', `${round4(cam.rotZ)}deg`);
            viewportEl.style.setProperty('--vse-zoom', `${round4(cam.zoom)}`);
            viewportEl.style.setProperty('--vse-pan-x', `${round4(cam.panX)}px`);
            viewportEl.style.setProperty('--vse-pan-y', `${round4(cam.panY)}px`);
            onCameraChange?.({ ...cam });
        });
    }

    let dragging = false;
    let panMode = false;
    let startX = 0;
    let startY = 0;
    let startRotX = cam.rotX;
    let startRotZ = cam.rotZ;
    let startPanX = cam.panX;
    let startPanY = cam.panY;
    let totalMove = 0;
    let downTarget = null;

    viewportEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    viewportEl.addEventListener('pointerdown', (e) => {
        if (e.target?.closest?.('.vse-poly-controls')) return;
        dragging = true;
        panMode = e.button === 2 || e.button === 1 || e.shiftKey;
        startX = e.clientX;
        startY = e.clientY;
        startRotX = cam.rotX;
        startRotZ = cam.rotZ;
        startPanX = cam.panX;
        startPanY = cam.panY;
        totalMove = 0;
        downTarget = e.target;
        try {
            viewportEl.setPointerCapture?.(e.pointerId);
        } catch {
            /* ignore unsupported synthetic events */
        }
    });

    viewportEl.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        totalMove = Math.max(totalMove, Math.hypot(dx, dy));
        if (panMode) {
            cam.panX = clamp(startPanX + dx, -360, 360);
            cam.panY = clamp(startPanY + dy, -360, 360);
        } else {
            cam.rotZ = startRotZ - dx * 0.45;
            cam.rotX = clamp(startRotX - dy * 0.42, 0, 82);
        }
        scheduleApply();
    });

    const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        try {
            viewportEl.releasePointerCapture?.(e.pointerId);
        } catch {
            /* ignore */
        }
        if (totalMove < 5) {
            const roomEl = (e.target || downTarget)?.closest?.('[data-room-id]');
            const roomId = roomEl?.getAttribute?.('data-room-id');
            if (roomId) onSelectRoom?.(roomId);
        }
    };

    viewportEl.addEventListener('pointerup', endDrag);
    viewportEl.addEventListener('pointercancel', endDrag);

    viewportEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.91;
        cam.zoom = clamp(cam.zoom * factor, 0.35, 2.8);
        scheduleApply();
    }, { passive: false });

    viewportEl.querySelectorAll('[data-poly-cam]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const mode = btn.getAttribute('data-poly-cam');
            if (mode === 'iso') {
                cam.rotX = 56;
                cam.rotZ = 32;
                cam.panX = 0;
                cam.panY = 0;
            } else if (mode === 'top') {
                cam.rotX = 0;
                cam.rotZ = 0;
                cam.panX = 0;
                cam.panY = 0;
            } else if (mode === 'low') {
                cam.rotX = 74;
                cam.rotZ = 28;
            } else if (mode === 'reset') {
                cam.rotX = 56;
                cam.rotZ = 32;
                cam.zoom = 1;
                cam.panX = 0;
                cam.panY = 0;
            } else if (mode === 'zoom-in') {
                cam.zoom = clamp(cam.zoom * 1.18, 0.35, 2.8);
            } else if (mode === 'zoom-out') {
                cam.zoom = clamp(cam.zoom / 1.18, 0.35, 2.8);
            }
            scheduleApply();
        });
    });
}

const POLY_VIEWPORT_OBSERVERS = new WeakMap();
const DEFAULT_SCROLL_ROOT_KEY = Object.freeze({ defaultRoot: true });

/**
 * Pause off-screen `.vse-poly-viewport` CSS animations using IntersectionObserver
 * so long chats with multiple inline 3D cards don't burn idle compositor frames.
 */
export function observePolyViewports(root = typeof document !== 'undefined' ? document : null, opts = {}) {
    if (typeof IntersectionObserver !== 'function' || !root || typeof root.querySelectorAll !== 'function') {
        return () => {};
    }
    const scrollRoot = opts.root || null;
    const key = scrollRoot || DEFAULT_SCROLL_ROOT_KEY;
    let entry = POLY_VIEWPORT_OBSERVERS.get(key);
    if (!entry) {
        const io = new IntersectionObserver((entries) => {
            for (const item of entries) {
                if (!item.target?.classList) continue;
                item.target.classList.toggle('is-offscreen', !item.isIntersecting);
            }
        }, {
            root: scrollRoot,
            rootMargin: opts.rootMargin || '120px',
            threshold: 0,
        });
        entry = { io, observed: new WeakSet() };
        POLY_VIEWPORT_OBSERVERS.set(key, entry);
    }

    const targets = [];
    if (typeof root.matches === 'function' && root.matches('.vse-poly-viewport')) {
        targets.push(root);
    }
    for (const el of root.querySelectorAll('.vse-poly-viewport')) {
        targets.push(el);
    }

    const added = [];
    for (const el of targets) {
        if (entry.observed.has(el)) continue;
        entry.observed.add(el);
        entry.io.observe(el);
        added.push(el);
    }

    return () => {
        for (const el of added) {
            entry.io.unobserve(el);
            entry.observed.delete(el);
        }
    };
}
