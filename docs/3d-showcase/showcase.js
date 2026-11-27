import * as THREE from '../../lib/three/three.module.js';
import { GLTFLoader } from '../../lib/three/GLTFLoader.js';
import { RoomEnvironment } from '../../lib/three/RoomEnvironment.js';
import { clone as cloneGltfScene } from '../../lib/three/SkeletonUtils.js';

/**
 * Complete catalog of real .glb assets from ST-LapisPhilosophorumEngine/assets/models/
 * Honoring all CC BY 4.0 and CC0 1.0 credits, shape IDs, sizes, and rotations.
 */
export const SHOWCASE_PROPS = [
  // --- ZONE 1: STUDY CORNER (Tingen Tavern West Study) ---
  {
    id: 'desk',
    name: 'Scandi Modern Office Desk PSX Style',
    zone: 'Study Corner',
    preset: 'study',
    file: 'sketchfab-f6915f34677546dd8dce914f32d892e8.glb',
    node: null,
    size: [1.8, 0.95, 0.95],
    pos: [-5.8, 0, -2.0],
    rotY: 0,
    preRotY: 0,
    faceCount: 72,
    bytes: 92696,
    author: 'adamsite',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/scandi-modern-office-desk-psx-style-f6915f34677546dd8dce914f32d892e8',
    desc: 'Low-poly writing desk anchoring the investigator study corner.',
  },
  {
    id: 'globe',
    name: 'Antique Globe',
    zone: 'Study Corner',
    preset: 'study',
    file: 'sketchfab-a30fc85dd7764b3bb45f509a38c0d000.glb',
    node: null,
    size: [0.38, 0.38, 0.48],
    pos: [-6.25, 0.95, -2.05],
    rotY: 0.4,
    preRotY: 0,
    faceCount: 2000,
    bytes: 1640620,
    author: 'thelowestanimal',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/antique-globe-a30fc85dd7764b3bb45f509a38c0d000',
    desc: 'Cartographic desktop globe positioned atop the study desk.',
  },
  {
    id: 'book_stack',
    name: 'Book Stack',
    zone: 'Study Corner',
    preset: 'study',
    file: 'sketchfab-b7fe5871c06a4fc6b9c2411a966ec91a.glb',
    node: null,
    size: [0.34, 0.25, 0.25],
    pos: [-5.75, 0.95, -1.95],
    rotY: -0.25,
    preRotY: 0,
    faceCount: 180,
    bytes: 26624,
    author: 'NxHV',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/book-stack-b7fe5871c06a4fc6b9c2411a966ec91a',
    desc: 'Stacked occult tomes and investigation ledgers on the study desk.',
  },
  {
    id: 'desk_lamp',
    name: 'simple retro Desk Lamp',
    zone: 'Study Corner',
    preset: 'study',
    file: 'sketchfab-9818614b5da1479ba43a6a1216b1688f.glb',
    node: null,
    size: [0.3, 0.32, 0.5],
    pos: [-5.25, 0.95, -2.05],
    rotY: -0.5,
    preRotY: 0,
    faceCount: 536,
    bytes: 39036,
    author: 'ribot02',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/simple-retro-desk-lamp-9818614b5da1479ba43a6a1216b1688f',
    desc: 'Focused brass task lamp illuminating the desk surface.',
  },
  {
    id: 'wall_bookshelf',
    name: 'Wooden Wall Bookshelf',
    zone: 'Study Corner',
    preset: 'study',
    file: 'sketchfab-96a804790eff41b3b2376f3608fde7df.glb',
    node: null,
    size: [1.2, 0.32, 0.55],
    pos: [-5.8, 1.55, -2.85],
    rotY: 0,
    preRotY: 0,
    faceCount: 724,
    bytes: 2009144,
    author: 'Sanzid',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/wooden-wall-bookshelf-96a804790eff41b3b2376f3608fde7df',
    desc: 'Wall-mounted timber shelf above the study desk.',
  },
  {
    id: 'armchair',
    name: 'PSX Armchair',
    zone: 'Study Corner',
    preset: 'study',
    file: 'sketchfab-a32d0264449c47caa9ba02bc1e0d9f94.glb',
    node: null,
    size: [0.92, 0.93, 0.95],
    pos: [-5.8, 0, -0.75],
    rotY: Math.PI,
    preRotY: 0,
    faceCount: 270,
    bytes: 33068,
    author: 'Tomitos',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/psx-armchair-a32d0264449c47caa9ba02bc1e0d9f94',
    desc: 'Upholstered reading armchair facing the investigator desk.',
  },
  {
    id: 'bed',
    name: 'Bed - Low Poly Medieval, CC0',
    zone: 'Study Corner',
    preset: 'study',
    file: 'sketchfab-24704040010a42ceaeffb1631ed1ae9b.glb',
    node: null,
    size: [2.2, 1.6, 0.95],
    pos: [-6.1, 0, 1.65],
    rotY: Math.PI / 2,
    preRotY: 0,
    faceCount: 1056,
    bytes: 88564,
    author: 'Avramania',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/bed-low-poly-medieval-cc0-24704040010a42ceaeffb1631ed1ae9b',
    desc: 'Low-poly timber rest bunk tucked along the southwest study alcove.',
  },

  // --- ZONE 2: HEARTH & COUNTER (Tingen Gaslit Tavern Hall) ---
  {
    id: 'wood_stove',
    name: 'Wood Stove',
    zone: 'Hearth & Counter',
    preset: 'hearth',
    file: 'sketchfab-4ca2d9183b3d4ec8aeeb56629a114090.glb',
    node: null,
    size: [0.75, 0.65, 1.35],
    pos: [0.65, 0, -2.45],
    rotY: 0,
    preRotY: 0,
    faceCount: 2086,
    bytes: 225528,
    author: 'daedaljs',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/wood-stove-4ca2d9183b3d4ec8aeeb56629a114090',
    desc: 'Cast-iron parlor stove radiating warm hearth light across the tavern.',
  },
  {
    id: 'bar_counter',
    name: 'Bar Counter',
    zone: 'Hearth & Counter',
    preset: 'hearth',
    file: 'sketchfab-bbd02f3c722b496a8cc2756f947f15ab.glb',
    node: null,
    size: [2.5, 0.68, 1.12],
    pos: [-1.55, 0, -1.95],
    rotY: 0,
    preRotY: 0,
    faceCount: 708,
    bytes: 49124,
    author: 'NFTLAB',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/bar-counter-bbd02f3c722b496a8cc2756f947f15ab',
    desc: 'Main timber service bar counter anchoring the north tavern wall.',
  },
  {
    id: 'kitchen_counter',
    name: 'Store | Kitchen counter with trays',
    zone: 'Hearth & Counter',
    preset: 'hearth',
    file: 'sketchfab-89b2524c56d347fb90c4f0306c169446.glb',
    node: null,
    size: [1.85, 0.74, 0.98],
    pos: [-3.4, 0, -2.35],
    rotY: 0,
    preRotY: Math.PI / 2,
    faceCount: 2290,
    bytes: 97792,
    author: 'SAMU',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/store-kitchen-counter-with-trays-89b2524c56d347fb90c4f0306c169446',
    desc: 'Service counter with display trays (rotated 90° about Y per Atlas convention).',
  },
  {
    id: 'display_shelf',
    name: 'Product Display Shelv',
    zone: 'Hearth & Counter',
    preset: 'hearth',
    file: 'sketchfab-3acdec6397b648e3a10068786fb45e77.glb',
    node: null,
    size: [1.0, 0.5, 1.7],
    pos: [-1.55, 0, -2.72],
    rotY: 0,
    preRotY: 0,
    faceCount: 208,
    bytes: 280244,
    author: 'isareework',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/product-display-shelv-3acdec6397b648e3a10068786fb45e77',
    desc: 'Back-bar bottle and curio display rack behind the main counter.',
  },
  {
    id: 'couch',
    name: 'Luxury sofa',
    zone: 'Hearth & Counter',
    preset: 'hearth',
    file: 'sketchfab-ad34d9ca70ec42479d4df5f9604b0c45.glb',
    node: null,
    size: [2.4, 1.05, 0.95],
    pos: [-3.1, 0, 0.85],
    rotY: 0,
    preRotY: 0,
    faceCount: 4828,
    bytes: 1517032,
    author: 'uday',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/luxury-sofa-ad34d9ca70ec42479d4df5f9604b0c45',
    desc: 'Tufted leather parlor sofa positioned in the central lounge.',
  },
  {
    id: 'table',
    name: 'Classic Wooden Table 01',
    zone: 'Hearth & Counter',
    preset: 'hearth',
    file: 'sketchfab-7ae82f2336c24b4ead6c44db7733bad0.glb',
    node: null,
    size: [2.0, 1.3, 0.9],
    pos: [-0.75, 0, 1.05],
    rotY: 0,
    preRotY: 0,
    faceCount: 188,
    bytes: 508776,
    author: 'Indika Thushara',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/classic-wooden-table-01-7ae82f2336c24b4ead6c44db7733bad0',
    desc: 'Heavy oak gathering table in front of the iron hearth.',
  },
  {
    id: 'rug',
    name: 'Rug - Low Poly Medieval, CC0',
    zone: 'Hearth & Counter',
    preset: 'hearth',
    file: 'sketchfab-3899142ec92c46059d35fc0fa1a0bd41.glb',
    node: null,
    size: [2.4, 1.7, 0.08],
    pos: [-1.85, 0.01, 0.95],
    rotY: 0,
    preRotY: 0,
    faceCount: 532,
    bytes: 43232,
    author: 'Avramania',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/rug-low-poly-medieval-cc0-3899142ec92c46059d35fc0fa1a0bd41',
    desc: 'Woven medieval floor tapestry grounding the central lounge seating.',
  },
  {
    id: 'lantern',
    name: 'Lantern - Low Poly Medieval, CC0',
    zone: 'Hearth & Counter',
    preset: 'hearth',
    file: 'sketchfab-8a3dc887ea9d48c19ad48469ba11e753.glb',
    node: null,
    size: [0.25, 0.25, 0.4],
    pos: [-0.75, 0.9, 1.05],
    rotY: 0.3,
    preRotY: 0,
    faceCount: 338,
    bytes: 41272,
    author: 'Avramania',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/lantern-low-poly-medieval-cc0-8a3dc887ea9d48c19ad48469ba11e753',
    desc: 'Tabletop oil lantern casting warm point lighting across the oak table.',
  },
  {
    id: 'chandelier',
    name: 'Ceiling chandelier',
    zone: 'Hearth & Counter',
    preset: 'hearth',
    file: 'sketchfab-63d588a565fa4ee38ce474c3394a4113.glb',
    node: null,
    size: [1.1, 1.1, 0.65],
    pos: [-1.9, 2.75, 0.1],
    rotY: 0,
    preRotY: 0,
    faceCount: 5203,
    bytes: 230020,
    author: 'Black Snow',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/ceiling-chandelier-63d588a565fa4ee38ce474c3394a4113',
    desc: 'Suspended wrought-iron chandelier crowning the main tavern hall.',
  },
  {
    id: 'wall_sconce',
    name: 'Sconce_Mesh2',
    zone: 'Hearth & Counter',
    preset: 'hearth',
    file: 'sketchfab-2a2f1c033ff04ba2a211f303bfb98e1a.glb',
    node: null,
    size: [0.3, 0.25, 0.45],
    pos: [0.05, 1.85, -2.92],
    rotY: 0,
    preRotY: 0,
    faceCount: 410,
    bytes: 31636,
    author: 'Maggatron',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/sconce-mesh2-2a2f1c033ff04ba2a211f303bfb98e1a',
    desc: 'Wall-mounted gaslight sconce flanking the hearth masonry.',
  },
  {
    id: 'barrel',
    name: 'PSX Industrial Pack — BarrelWine',
    zone: 'Hearth & Counter',
    preset: 'hearth',
    file: 'psx-industrial.glb',
    node: 'BarrelWine',
    size: [0.7, 0.7, 1.02],
    pos: [0.75, 0, -1.25],
    rotY: 0.2,
    preRotY: 0,
    faceCount: 164,
    bytes: 418200,
    author: 'Tomitos',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/psx-industrial-pack-12cb749961974f94a4063e67dafb2d76',
    desc: 'Extracted BarrelWine node from bundled psx-industrial.glb with WebP textures.',
  },
  {
    id: 'jar',
    name: 'Sci-fi lab — Specimen Jar (sci_jar)',
    zone: 'Hearth & Counter',
    preset: 'hearth',
    file: 'scifi-lab-props.glb',
    node: 'sci_jar',
    size: [0.38, 0.38, 0.56],
    pos: [-3.0, 0, -0.4],
    rotY: 0,
    preRotY: 0,
    floorBound: true,
    faceCount: 312,
    bytes: 312400,
    author: 'Agata Wilczek',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/sci-fi-lab-a676e149e343403bb5e57686f3d31da5',
    desc: 'Floor-bound sci_jar cluster from scifi-lab-props.glb, grounded flush at y = 0 with emissive glass.',
  },

  // --- ZONE 3: COBBLESTONE COURTYARD (Outdoor Connected Plaza) ---
  {
    id: 'fountain',
    name: 'TeaScroll Clubhouse - Fountain Prop',
    zone: 'Courtyard',
    preset: 'courtyard',
    file: 'sketchfab-3d333298326f4d1198c98940e5c73924.glb',
    node: null,
    size: [2.45, 2.45, 1.8],
    pos: [4.55, 0, 0.15],
    rotY: 0,
    preRotY: 0,
    faceCount: 1967,
    bytes: 433744,
    author: 'Anaïs Faure',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/teascroll-clubhouse-fountain-prop-3d333298326f4d1198c98940e5c73924',
    desc: 'Stone courtyard centerpiece adapted from legacy specular-glossiness materials.',
  },
  {
    id: 'park_bench',
    name: 'Wooden Bench',
    zone: 'Courtyard',
    preset: 'courtyard',
    file: 'sketchfab-93edf7d0e9f5443da41a5f1f83053966.glb',
    node: null,
    size: [1.8, 0.66, 0.9],
    pos: [2.75, 0, 1.85],
    rotY: 0,
    preRotY: 0,
    faceCount: 2532,
    bytes: 95140,
    author: 'Víctor Hernández',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/wooden-bench-93edf7d0e9f5443da41a5f1f83053966',
    desc: 'Slatted courtyard bench utilizing runtime KHR_materials_pbrSpecularGlossiness adaptation.',
  },
  {
    id: 'streetlamp',
    name: 'Low Poly Psx Street lamp',
    zone: 'Courtyard',
    preset: 'courtyard',
    file: 'sketchfab-81a8d1861bbd4cef8ab1aed2986bf873.glb',
    node: null,
    size: [0.65, 0.65, 3.3],
    pos: [6.45, 0, -1.95],
    rotY: -0.4,
    preRotY: 0,
    faceCount: 172,
    bytes: 193996,
    author: 'SaukrDev',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/low-poly-psx-street-lamp-81a8d1861bbd4cef8ab1aed2986bf873',
    desc: 'Tall gas streetlamp casting nocturnal light across the cobblestone plaza.',
  },
  {
    id: 'potted_plant',
    name: 'Potted Plant, Mediterranean med leaf, low poly',
    zone: 'Courtyard',
    preset: 'courtyard',
    file: 'sketchfab-bc7f26baef2a45d18dbd9a5d6d2ec565.glb',
    node: null,
    size: [0.45, 0.45, 0.75],
    pos: [2.15, 0, -1.85],
    rotY: 0.5,
    preRotY: 0,
    faceCount: 533,
    bytes: 239012,
    author: 'dudecon',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/potted-plant-mediterranean-med-leaf-low-poly-bc7f26baef2a45d18dbd9a5d6d2ec565',
    desc: 'Mediterranean foliage planter flanking the tavern doorway threshold.',
  },
  {
    id: 'signpost',
    name: 'Signpost - Low Poly Medieval, CC0',
    zone: 'Courtyard',
    preset: 'courtyard',
    file: 'sketchfab-ed4e6c6a784a4a05b6dde9597b381797.glb',
    node: null,
    size: [0.8, 0.3, 1.9],
    pos: [6.35, 0, 1.75],
    rotY: -0.65,
    preRotY: 0,
    faceCount: 192,
    bytes: 19320,
    author: 'Avramania',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    viewerUrl: 'https://sketchfab.com/3d-models/signpost-low-poly-medieval-cc0-ed4e6c6a784a4a05b6dde9597b381797',
    desc: 'Directional timber signpost pointing toward Zouteland Street.',
  },
];

export const CAMERA_PRESETS = Object.freeze({
  overview: { yaw: 0.42, pitch: 0.54, dist: 16.2, tx: -0.2, ty: 1.0, tz: 0.0 },
  study: { yaw: 0.52, pitch: 0.46, dist: 6.4, tx: -5.6, ty: 1.0, tz: -1.1 },
  hearth: { yaw: -0.28, pitch: 0.48, dist: 7.4, tx: -1.3, ty: 1.1, tz: -0.7 },
  courtyard: { yaw: 0.62, pitch: 0.46, dist: 7.6, tx: 4.5, ty: 0.9, tz: 0.1 },
});

export const LIGHTING_MOODS = Object.freeze({
  gaslight: {
    bg: '#141417',
    hemiSky: '#f1be9a',
    hemiGround: '#1c1917',
    hemiInt: 0.58,
    keyColor: '#ffedd5',
    keyInt: 1.75,
    rimColor: '#9ad6cf',
    rimInt: 0.55,
    pointColor: '#ff9e44',
    pointInt: 3.2,
    exposure: 1.08,
  },
  celadon: {
    bg: '#0f1418',
    hemiSky: '#9ad6cf',
    hemiGround: '#111827',
    hemiInt: 0.68,
    keyColor: '#bae6fd',
    keyInt: 1.55,
    rimColor: '#f1be9a',
    rimInt: 0.72,
    pointColor: '#5eead4',
    pointInt: 2.8,
    exposure: 1.05,
  },
  daylight: {
    bg: '#1c2026',
    hemiSky: '#f8fafc',
    hemiGround: '#334155',
    hemiInt: 0.95,
    keyColor: '#fffbeb',
    keyInt: 2.35,
    rimColor: '#93c5fd',
    rimInt: 0.65,
    pointColor: '#fde68a',
    pointInt: 1.6,
    exposure: 1.16,
  },
});

function createAtlasGlbLoader() {
  const loader = new GLTFLoader();
  loader.register((parser) => {
    const name = 'KHR_materials_pbrSpecularGlossiness';
    const getMaterial = (index) => parser.json.materials?.[index]?.extensions?.[name];
    return {
      name,
      getMaterialType: (index) => (getMaterial(index) ? THREE.MeshPhysicalMaterial : null),
      extendMaterialParams(index, params) {
        const legacy = getMaterial(index);
        if (!legacy) return;
        const [r, g, b, alpha] = legacy.diffuseFactor ?? [1, 1, 1, 1];
        const [sr, sg, sb] = legacy.specularFactor ?? [1, 1, 1];
        params.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
        params.opacity = alpha;
        params.metalness = 0;
        params.roughness = 1 - (legacy.glossinessFactor ?? 1);
        params.specularColor = new THREE.Color().setRGB(sr / 0.04, sg / 0.04, sb / 0.04);
        if (legacy.diffuseTexture) {
          return parser.assignTexture(params, 'map', legacy.diffuseTexture, THREE.SRGBColorSpace);
        }
      },
    };
  });
  return loader;
}

function normalizeGlbAsset(sourceNode, targetW, targetD, targetH, preRotY = 0) {
  const clone = new THREE.Group();
  clone.add(cloneGltfScene(sourceNode));
  clone.rotation.y = preRotY;
  clone.updateMatrixWorld(true);

  const rawBox = new THREE.Box3().setFromObject(clone, true);
  if (rawBox.isEmpty()) return null;
  const rawSize = rawBox.getSize(new THREE.Vector3());

  if (
    (targetW > targetD * 1.25 && rawSize.z > rawSize.x * 1.25) ||
    (targetD > targetW * 1.25 && rawSize.x > rawSize.z * 1.25)
  ) {
    clone.rotation.y += Math.PI / 2;
    clone.updateMatrixWorld(true);
    rawBox.setFromObject(clone, true).getSize(rawSize);
  }

  const rawCenter = rawBox.getCenter(new THREE.Vector3());
  clone.position.set(-rawCenter.x, -rawBox.min.y, -rawCenter.z);

  clone.traverse((ch) => {
    if (ch.isMesh) {
      ch.geometry = ch.geometry?.clone?.() || ch.geometry;
      ch.material = Array.isArray(ch.material)
        ? ch.material.map((m) => m?.clone?.() || m)
        : ch.material?.clone?.() || ch.material;
      ch.castShadow = true;
      ch.receiveShadow = true;
    }
  });

  const sx = Math.max(0.05, rawSize.x);
  const sy = Math.max(0.05, rawSize.y);
  const sz = Math.max(0.05, rawSize.z);
  const sXZ = Math.min(targetW / sx, targetD / sz);
  const sY = THREE.MathUtils.clamp(targetH / sy, sXZ * 0.7, sXZ * 1.85);

  const holder = new THREE.Group();
  holder.add(clone);
  holder.scale.set(sXZ, sY, sXZ);
  holder.updateMatrixWorld(true);
  return holder;
}

function makeCheckerTexture(hexA, hexB, seamHex, repeatX, repeatY) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = hexA;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = hexB;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillRect(64, 64, 64, 64);
  ctx.strokeStyle = seamHex;
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 64, 64);
  ctx.strokeRect(64, 64, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  return tex;
}

function buildArchitecture(worldRoot) {
  const archGroup = new THREE.Group();
  archGroup.name = 'AtlasArchitecture';

  // 1. Tingen Gaslit Tavern Floor (-7.2 to +1.6 in X, -3.1 to +3.1 in Z => 8.8m x 6.2m)
  const tavernTex = makeCheckerTexture('#3d291a', '#473020', '#291b11', 9, 6);
  const tavernFloor = new THREE.Mesh(
    new THREE.BoxGeometry(8.8, 0.24, 6.2),
    new THREE.MeshStandardMaterial({ map: tavernTex, roughness: 0.78, metalness: 0.08 })
  );
  tavernFloor.position.set(-2.8, -0.12, 0);
  tavernFloor.receiveShadow = true;
  archGroup.add(tavernFloor);

  // 2. Cobblestone Courtyard Floor (+1.6 to +7.6 in X, -3.1 to +3.1 in Z => 6.0m x 6.2m)
  const courtTex = makeCheckerTexture('#27362b', '#2f4033', '#1a241d', 6, 6);
  const courtFloor = new THREE.Mesh(
    new THREE.BoxGeometry(6.0, 0.24, 6.2),
    new THREE.MeshStandardMaterial({ map: courtTex, roughness: 0.85, metalness: 0.06 })
  );
  courtFloor.position.set(4.6, -0.12, 0);
  courtFloor.receiveShadow = true;
  archGroup.add(courtFloor);

  const wallMat = new THREE.MeshStandardMaterial({ color: '#583b28', roughness: 0.74, metalness: 0.1 });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#8f6239', roughness: 0.55, metalness: 0.2 });
  const curbMat = new THREE.MeshStandardMaterial({ color: '#3b4a3f', roughness: 0.8, metalness: 0.1 });

  const cutoffWalls = [];
  const addWall = (w, h, d, x, y, z, mat, isCutawayTarget = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    if (isCutawayTarget) {
      m.userData.fullH = h;
      cutoffWalls.push(m);
    }
    archGroup.add(m);
    return m;
  };

  // Back North Wall (Tavern) & West Study Wall
  addWall(8.8, 2.8, 0.22, -2.8, 1.4, -3.1, wallMat, true);
  addWall(0.22, 2.8, 6.2, -7.2, 1.4, 0, wallMat, true);

  // Study interior partial partition divider
  addWall(0.18, 2.2, 2.4, -4.4, 1.1, -1.9, wallMat, true);

  // Front South Low Cutaway Wall (Tavern)
  addWall(8.8, 0.65, 0.22, -2.8, 0.325, 3.1, wallMat, false);

  // Shared East Wall between Tavern & Courtyard with Physical Doorway Cutout (splitWallWithDoorways)
  addWall(0.22, 2.4, 2.25, 1.6, 1.2, -1.975, wallMat, true);
  addWall(0.22, 2.4, 2.25, 1.6, 1.2, 1.975, wallMat, true);
  // Doorway lintel & jambs
  addWall(0.28, 0.22, 1.7, 1.6, 2.28, 0, trimMat, true);
  addWall(0.28, 2.2, 0.14, 1.6, 1.1, -0.82, trimMat, true);
  addWall(0.28, 2.2, 0.14, 1.6, 1.1, 0.82, trimMat, true);

  // Courtyard low stone perimeter curbs
  addWall(6.0, 0.42, 0.2, 4.6, 0.21, -3.1, curbMat, false);
  addWall(6.0, 0.42, 0.2, 4.6, 0.21, 3.1, curbMat, false);
  addWall(0.2, 0.42, 6.2, 7.6, 0.21, 0, curbMat, false);

  // Investigator Pawn ("YOU · Klein Moretti")
  const pawn = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.42, 0.07, 20),
    new THREE.MeshStandardMaterial({ color: '#f1be9a', emissive: '#d97706', emissiveIntensity: 0.5, metalness: 0.6, roughness: 0.3 })
  );
  ring.position.y = 0.035;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.27, 1.1, 14),
    new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.4, metalness: 0.2 })
  );
  body.position.y = 0.62;
  body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 16, 14),
    new THREE.MeshStandardMaterial({ color: '#fbbf24', roughness: 0.35, metalness: 0.2 })
  );
  head.position.y = 1.38;
  head.castShadow = true;
  pawn.add(ring, body, head);
  pawn.position.set(-2.0, 0, -0.35);
  archGroup.add(pawn);

  worldRoot.add(archGroup);
  return { cutoffWalls };
}

function initShowcase() {
  const containerEl = document.getElementById('lpe_canvas_wrap');
  const labelLayer = document.getElementById('lpe_labels_layer');
  const appEl = document.getElementById('lpe_showcase_app');

  const canvas = document.createElement('canvas');
  canvas.className = 'lpe-webgl-canvas';
  containerEl.prepend(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#141417');

  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envRT = pmrem.fromScene(roomEnv, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.68;
  roomEnv.dispose();
  pmrem.dispose();

  const worldRoot = new THREE.Group();
  scene.add(worldRoot);

  // Spatial Ground Grid
  const grid = new THREE.GridHelper(24, 24, 0x3b4252, 0x1f242d);
  grid.position.set(0, -0.24, 0);
  scene.add(grid);

  // Lighting Rig
  const hemiLight = new THREE.HemisphereLight('#f1be9a', '#1c1917', 0.58);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight('#ffedd5', 1.75);
  keyLight.position.set(9, 14, 10);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -10;
  keyLight.shadow.camera.right = 10;
  keyLight.shadow.camera.top = 10;
  keyLight.shadow.camera.bottom = -10;
  keyLight.shadow.bias = -0.0005;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight('#9ad6cf', 0.55);
  rimLight.position.set(-10, 8, -9);
  scene.add(rimLight);

  const hearthLight = new THREE.PointLight('#ff9e44', 3.2, 8.5, 1.6);
  hearthLight.position.set(0.3, 1.3, -1.8);
  scene.add(hearthLight);

  const studyLight = new THREE.PointLight('#f1be9a', 2.2, 6.5, 1.6);
  studyLight.position.set(-5.3, 1.6, -1.8);
  scene.add(studyLight);

  const courtLight = new THREE.PointLight('#9ad6cf', 2.4, 8.0, 1.5);
  courtLight.position.set(5.6, 2.6, -1.2);
  scene.add(courtLight);

  const { cutoffWalls } = buildArchitecture(worldRoot);

  // Selection & Hover Ring Beacon
  const selectionBeacon = new THREE.Group();
  const outerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.64, 36),
    new THREE.MeshBasicMaterial({ color: '#f1be9a', side: THREE.DoubleSide })
  );
  outerRing.rotation.x = -Math.PI / 2;
  const innerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.38, 0.43, 36),
    new THREE.MeshBasicMaterial({ color: '#9ad6cf', side: THREE.DoubleSide })
  );
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = 0.005;
  selectionBeacon.add(outerRing, innerRing);
  selectionBeacon.position.y = 0.02;
  selectionBeacon.visible = false;
  worldRoot.add(selectionBeacon);

  const hoverRing = new THREE.Mesh(
    new THREE.RingGeometry(0.46, 0.52, 32),
    new THREE.MeshBasicMaterial({ color: '#9ad6cf', side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
  );
  hoverRing.rotation.x = -Math.PI / 2;
  hoverRing.position.y = 0.018;
  hoverRing.visible = false;
  worldRoot.add(hoverRing);

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.25, 120);
  const camState = { ...CAMERA_PRESETS.overview };
  const camTarget = { ...CAMERA_PRESETS.overview };
  let isAnimatingCam = false;
  let showLabels = true;
  let isCutaway = true;
  let selectedPropId = 'globe';
  let hoveredPropId = null;

  // Exposed verification state
  const state = {
    totalProps: SHOWCASE_PROPS.length,
    loadedCount: 0,
    failedCount: 0,
    totalTriangles: 0,
    framesRendered: 0,
    activePreset: 'overview',
    activeMood: 'gaslight',
    selectedPropId: 'globe',
  };
  window.__LPE_SHOWCASE_STATE__ = state;

  const propAnchors = new Map();
  const pickableMeshes = [];

  const labelAnchors = [
    { id: 'room_tavern', text: 'TINGEN GASLIT TAVERN · 3.6M', kind: 'room', worldPos: new THREE.Vector3(-2.6, 3.05, -2.9) },
    { id: 'room_courtyard', text: 'COBBLESTONE COURTYARD · Z=0', kind: 'room', worldPos: new THREE.Vector3(4.6, 1.35, -2.9) },
    { id: 'pawn_you', text: 'YOU · KLEIN MORETTI', kind: 'prop', worldPos: new THREE.Vector3(-2.0, 1.85, -0.35) },
  ];

  // Load GLB packs & models
  const loader = createAtlasGlbLoader();
  const glbCache = new Map();
  const loadGlb = (file) => {
    if (!glbCache.has(file)) {
      glbCache.set(
        file,
        loader.loadAsync(`../../assets/models/${file}`).then((g) => g?.scene || null)
      );
    }
    return glbCache.get(file);
  };

  const statGlbEl = document.getElementById('stat_glb_count');
  const statTriEl = document.getElementById('stat_tri_count');
  const statCamEl = document.getElementById('stat_cam_coords');

  Promise.all(
    SHOWCASE_PROPS.map(async (prop) => {
      try {
        const packScene = await loadGlb(prop.file);
        if (!packScene) throw new Error(`Empty GLB scene: ${prop.file}`);
        const srcNode = prop.node ? packScene.getObjectByName(prop.node) || packScene : packScene;
        const holder = normalizeGlbAsset(srcNode, prop.size[0], prop.size[1], prop.size[2], prop.preRotY || 0);
        if (!holder) throw new Error(`Bounds empty: ${prop.id}`);

        const anchor = new THREE.Group();
        anchor.position.set(prop.pos[0], prop.pos[1], prop.pos[2]);
        anchor.rotation.y = prop.rotY || 0;
        anchor.userData.propId = prop.id;
        anchor.add(holder);
        worldRoot.add(anchor);
        if (prop.floorBound) {
          anchor.updateMatrixWorld(true);
          const groundedBox = new THREE.Box3().setFromObject(anchor, true);
          if (!groundedBox.isEmpty() && Math.abs(groundedBox.min.y) > 1e-4) {
            anchor.position.y -= groundedBox.min.y;
            anchor.updateMatrixWorld(true);
          }
        }

        let triCount = 0;
        holder.traverse((obj) => {
          if (obj.isMesh) {
            obj.userData.propId = prop.id;
            pickableMeshes.push(obj);
            const geom = obj.geometry;
            if (geom?.index) triCount += Math.round(geom.index.count / 3);
            else if (geom?.attributes?.position) triCount += Math.round(geom.attributes.position.count / 3);
          }
        });

        propAnchors.set(prop.id, { prop, anchor, holder, triCount });
        labelAnchors.push({
          id: `prop_${prop.id}`,
          propId: prop.id,
          text: prop.name.replace(/\s*-\s*Low Poly.*$/i, ''),
          kind: 'prop',
          worldPos: new THREE.Vector3(prop.pos[0], prop.pos[1] + prop.size[2] + 0.24, prop.pos[2]),
        });

        state.loadedCount++;
        state.totalTriangles += triCount || prop.faceCount;
        statGlbEl.textContent = `${state.loadedCount} / ${state.totalProps}`;
        statTriEl.textContent = state.totalTriangles.toLocaleString('en-US');
      } catch (err) {
        console.error('Failed to load GLB prop:', prop.id, err);
        state.failedCount++;
      }
    })
  ).then(() => {
    selectProp(selectedPropId, false);
    const floorChecks = {};
    const worldBox = new THREE.Box3();
    const otherBox = new THREE.Box3();
    const archGroup = worldRoot.getObjectByName('AtlasArchitecture');
    for (const [id, entry] of propAnchors) {
      if (!entry.prop.floorBound) continue;
      entry.anchor.updateMatrixWorld(true);
      worldBox.setFromObject(entry.anchor, true);
      const minY = Number(worldBox.min.y.toFixed(4));
      const overlaps = [];
      for (const [otherId, otherEntry] of propAnchors) {
        if (otherId === id) continue;
        otherEntry.anchor.updateMatrixWorld(true);
        otherBox.setFromObject(otherEntry.anchor, true);
        if (worldBox.intersectsBox(otherBox)) overlaps.push(`prop:${otherId}`);
      }
      if (archGroup) {
        archGroup.traverse((obj) => {
          if (!obj.isMesh) return;
          otherBox.setFromObject(obj, true);
          if (otherBox.max.y <= 0.02) return;
          if (worldBox.intersectsBox(otherBox)) overlaps.push(`arch:${obj.name || obj.uuid.slice(0, 6)}`);
        });
      }
      floorChecks[id] = { minY, onFloor: Math.abs(minY) <= 0.01, overlaps };
    }
    state.floorBoundProps = floorChecks;
    requestRender();
  });

  function syncCamera() {
    const p = Math.max(0.18, Math.min(Math.PI / 2 - 0.05, camState.pitch));
    const d = Math.max(2.5, Math.min(34, camState.dist));
    const horiz = d * Math.cos(p);
    camera.position.set(
      camState.tx + horiz * Math.sin(camState.yaw),
      camState.ty + d * Math.sin(p),
      camState.tz + horiz * Math.cos(camState.yaw)
    );
    camera.lookAt(camState.tx, camState.ty, camState.tz);
    statCamEl.textContent = `${camState.yaw.toFixed(2)} rad · ${camState.dist.toFixed(1)}m`;
  }

  function updateLabels() {
    if (!showLabels) {
      labelLayer.innerHTML = '';
      return;
    }
    const visibleAnchors = labelAnchors.filter(
      (a) => a.kind === 'room' || a.id === 'pawn_you' || a.propId === selectedPropId || a.propId === hoveredPropId
    );
    if (labelLayer.childElementCount !== visibleAnchors.length) {
      labelLayer.innerHTML = visibleAnchors
        .map(
          (a) =>
            `<span class="lpe-webgl-label ${a.kind === 'room' ? 'is-room' : ''} ${
              a.propId && a.propId === selectedPropId ? 'is-selected' : ''
            }"></span>`
        )
        .join('');
    }
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 500;
    const proj = new THREE.Vector3();
    for (let i = 0; i < visibleAnchors.length; i++) {
      const a = visibleAnchors[i];
      const el = labelLayer.children[i];
      if (!el) continue;
      el.textContent = a.text;
      el.className = `lpe-webgl-label ${a.kind === 'room' ? 'is-room' : ''} ${
        a.propId && a.propId === selectedPropId ? 'is-selected' : ''
      }`;
      proj.copy(a.worldPos).project(camera);
      if (proj.z > 1 || proj.z < -1) {
        el.style.display = 'none';
        continue;
      }
      const sx = (proj.x * 0.5 + 0.5) * w;
      const sy = (-proj.y * 0.5 + 0.5) * h;
      el.style.display = '';
      el.style.left = `${sx.toFixed(1)}px`;
      el.style.top = `${sy.toFixed(1)}px`;
    }
  }

  let rafId = null;
  function renderNow() {
    rafId = null;
    const w = Math.max(1, containerEl.clientWidth || 800);
    const h = Math.max(1, containerEl.clientHeight || 500);
    if (
      canvas.width !== Math.round(w * renderer.getPixelRatio()) ||
      canvas.height !== Math.round(h * renderer.getPixelRatio())
    ) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    if (isAnimatingCam) {
      const lerp = 0.18;
      camState.yaw += (camTarget.yaw - camState.yaw) * lerp;
      camState.pitch += (camTarget.pitch - camState.pitch) * lerp;
      camState.dist += (camTarget.dist - camState.dist) * lerp;
      camState.tx += (camTarget.tx - camState.tx) * lerp;
      camState.ty += (camTarget.ty - camState.ty) * lerp;
      camState.tz += (camTarget.tz - camState.tz) * lerp;
      const delta =
        Math.abs(camTarget.yaw - camState.yaw) +
        Math.abs(camTarget.pitch - camState.pitch) +
        Math.abs(camTarget.dist - camState.dist) +
        Math.abs(camTarget.tx - camState.tx) +
        Math.abs(camTarget.tz - camState.tz);
      if (delta < 0.015) {
        Object.assign(camState, camTarget);
        isAnimatingCam = false;
      } else {
        requestRender();
      }
    }

    syncCamera();
    renderer.render(scene, camera);
    state.framesRendered++;
    updateLabels();
  }

  function requestRender() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(renderNow);
  }

  function animateToCamera(target) {
    Object.assign(camTarget, target);
    isAnimatingCam = true;
    requestRender();
  }

  function setCameraPreset(presetId) {
    const preset = CAMERA_PRESETS[presetId];
    if (!preset) return;
    state.activePreset = presetId;
    document.querySelectorAll('[data-cam-preset]').forEach((btn) => {
      if (btn.classList.contains('lpe-pill')) {
        btn.classList.toggle('is-active', btn.dataset.camPreset === presetId);
      }
    });
    animateToCamera(preset);
  }

  function setLightingMood(moodId) {
    const m = LIGHTING_MOODS[moodId];
    if (!m) return;
    state.activeMood = moodId;
    appEl.dataset.lighting = moodId;
    scene.background.set(m.bg);
    hemiLight.color.set(m.hemiSky);
    hemiLight.groundColor.set(m.hemiGround);
    hemiLight.intensity = m.hemiInt;
    keyLight.color.set(m.keyColor);
    keyLight.intensity = m.keyInt;
    rimLight.color.set(m.rimColor);
    rimLight.intensity = m.rimInt;
    hearthLight.color.set(m.pointColor);
    hearthLight.intensity = m.pointInt;
    renderer.toneMappingExposure = m.exposure;
    document.querySelectorAll('[data-light-mood]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.lightMood === moodId);
    });
    requestRender();
  }

  function selectProp(propId, focusCamera = false) {
    const item = SHOWCASE_PROPS.find((p) => p.id === propId);
    if (!item) return;
    selectedPropId = item.id;
    state.selectedPropId = item.id;

    // Position floor beacon
    const rScale = Math.max(0.45, Math.hypot(item.size[0], item.size[1]) * 0.58);
    selectionBeacon.position.set(item.pos[0], 0.015, item.pos[2]);
    selectionBeacon.scale.set(rScale, 1, rScale);
    selectionBeacon.visible = true;

    // Update Inspector UI
    document.getElementById('insp_zone_badge').textContent = item.zone;
    document.getElementById('insp_license_badge').textContent = item.license;
    document.getElementById('insp_name').textContent = item.name;
    document.getElementById('insp_desc').textContent = item.desc;
    document.getElementById('insp_shape_id').innerHTML = `<code>${item.id}${item.node ? ` (${item.node})` : ''}</code>`;
    document.getElementById('insp_dims').textContent = `${item.size[0].toFixed(2)} × ${item.size[1].toFixed(2)} × ${item.size[2].toFixed(2)} m`;
    document.getElementById('insp_coords').textContent = `[${item.pos[0].toFixed(2)}, ${item.pos[1].toFixed(2)}, ${item.pos[2].toFixed(2)}]`;
    document.getElementById('insp_geom').textContent = `${item.faceCount.toLocaleString('en-US')} faces · ${Math.round(item.bytes / 1024).toLocaleString('en-US')} KB`;
    document.getElementById('insp_author').textContent = `${item.author} · ${item.license}`;
    document.getElementById('insp_file').innerHTML = `<code>${item.file}</code>`;
    document.getElementById('insp_source_url').href = item.viewerUrl;

    document.querySelectorAll('.lpe-catalog-item').forEach((el) => {
      el.classList.toggle('is-selected', el.dataset.propId === item.id);
    });

    if (focusCamera) {
      animateToCamera({
        yaw: item.zone === 'Courtyard' ? 0.58 : item.zone === 'Study Corner' ? 0.48 : -0.25,
        pitch: 0.44,
        dist: Math.max(3.6, Math.max(...item.size) * 2.6),
        tx: item.pos[0],
        ty: item.pos[1] + item.size[2] * 0.45,
        tz: item.pos[2],
      });
    }
    requestRender();
  }

  // Render Catalog & Credits Lists
  const catalogListEl = document.getElementById('catalog_list');
  function renderCatalog(zoneFilter = 'all') {
    const items = SHOWCASE_PROPS.filter((p) => zoneFilter === 'all' || p.zone === zoneFilter);
    catalogListEl.innerHTML = items
      .map(
        (p) => `
      <button type="button" class="lpe-catalog-item ${p.id === selectedPropId ? 'is-selected' : ''}" data-prop-id="${p.id}">
        <div>
          <span class="lpe-catalog-item-title">${p.name}</span>
          <span class="lpe-catalog-item-sub">${p.zone} · <code>${p.id}</code> · by ${p.author}</span>
        </div>
        <span class="lpe-badge ${p.license.startsWith('CC0') ? 'lpe-badge-celadon' : 'lpe-badge-peach'}">${p.license}</span>
      </button>`
      )
      .join('');
    catalogListEl.querySelectorAll('.lpe-catalog-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectProp(btn.dataset.propId, true);
        switchDrawerTab('inspector');
      });
    });
  }
  renderCatalog('all');

  const creditsHtml = SHOWCASE_PROPS.map(
    (p) => `
    <div class="lpe-credit-card">
      <div><strong>${p.name}</strong> (<code>${p.id}</code>)</div>
      <div>Author: <strong>${p.author}</strong> · License: <a href="${p.licenseUrl}" target="_blank" rel="noopener noreferrer">${p.license}</a></div>
      <div>File: <code>${p.file}</code> · <a href="${p.viewerUrl}" target="_blank" rel="noopener noreferrer">Sketchfab Source ↗</a></div>
    </div>`
  ).join('');
  document.getElementById('drawer_credits_list').innerHTML = creditsHtml;
  document.getElementById('modal_credits_grid').innerHTML = creditsHtml;

  // Pointer Orbit / Pan / Raycast Selection
  let dragMode = null;
  let dragMoved = false;
  let lastX = 0;
  let lastY = 0;
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const hintEl = document.getElementById('hover_hint_text');

  function pickPropAtEvent(e) {
    const rect = canvas.getBoundingClientRect();
    pointerNdc.x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointerNdc.y = -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(pickableMeshes, false);
    return hits[0]?.object?.userData?.propId || null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    isAnimatingCam = false;
    dragMode = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
    dragMoved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragMode) {
      const hitId = pickPropAtEvent(e);
      if (hitId !== hoveredPropId) {
        hoveredPropId = hitId;
        if (hitId) {
          const item = SHOWCASE_PROPS.find((p) => p.id === hitId);
          const rScale = Math.max(0.45, Math.hypot(item.size[0], item.size[1]) * 0.56);
          hoverRing.position.set(item.pos[0], 0.018, item.pos[2]);
          hoverRing.scale.set(rScale, 1, rScale);
          hoverRing.visible = true;
          canvas.style.cursor = 'pointer';
          hintEl.textContent = `✦ ${item.name} (${item.id}) — Click to inspect`;
        } else {
          hoverRing.visible = false;
          canvas.style.cursor = 'grab';
          hintEl.textContent = 'Click any 3D prop to inspect · Drag to orbit · Shift+Drag to pan · Wheel to zoom';
        }
        requestRender();
      }
      return;
    }

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.hypot(dx, dy) > 3) dragMoved = true;
    lastX = e.clientX;
    lastY = e.clientY;

    if (dragMode === 'orbit') {
      camState.yaw -= dx * 0.0075;
      camState.pitch = Math.max(0.18, Math.min(Math.PI / 2 - 0.05, camState.pitch + dy * 0.006));
    } else {
      const panScale = camState.dist * 0.0014;
      const cosY = Math.cos(camState.yaw);
      const sinY = Math.sin(camState.yaw);
      camState.tx -= (dx * cosY + dy * sinY) * panScale;
      camState.tz -= (-dx * sinY + dy * cosY) * panScale;
    }
    requestRender();
  });

  const endPointer = (e) => {
    if (!dragMode) return;
    const wasClick = !dragMoved && e.button === 0;
    dragMode = null;
    canvas.releasePointerCapture?.(e.pointerId);
    if (wasClick) {
      const hitId = pickPropAtEvent(e);
      if (hitId) {
        selectProp(hitId, false);
        openDrawer();
        switchDrawerTab('inspector');
      }
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      isAnimatingCam = false;
      camState.dist = Math.max(2.6, Math.min(30, camState.dist * (e.deltaY > 0 ? 1.09 : 0.91)));
      requestRender();
    },
    { passive: false }
  );
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // UI Event Listeners
  document.querySelectorAll('[data-cam-preset]').forEach((btn) => {
    btn.addEventListener('click', () => setCameraPreset(btn.dataset.camPreset));
  });

  document.querySelectorAll('[data-light-mood]').forEach((btn) => {
    btn.addEventListener('click', () => setLightingMood(btn.dataset.lightMood));
  });

  document.getElementById('btn_focus_prop').addEventListener('click', () => {
    selectProp(selectedPropId, true);
  });

  document.getElementById('btn_toggle_labels').addEventListener('click', (e) => {
    showLabels = !showLabels;
    e.currentTarget.classList.toggle('is-active', showLabels);
    requestRender();
  });

  document.getElementById('btn_toggle_cutaway').addEventListener('click', (e) => {
    isCutaway = !isCutaway;
    e.currentTarget.classList.toggle('is-active', isCutaway);
    cutoffWalls.forEach((w) => {
      const targetH = isCutaway ? w.userData.fullH : 3.6;
      w.scale.y = targetH / w.userData.fullH;
      w.position.y = targetH / 2;
    });
    requestRender();
  });

  document.getElementById('btn_reset_view').addEventListener('click', () => {
    setCameraPreset('overview');
  });

  // Drawer & Rail Controls
  const drawerEl = document.getElementById('lpe_drawer');
  const railToggleBtn = document.getElementById('btn_rail_toggle');

  function openDrawer() {
    drawerEl.classList.remove('is-collapsed');
    railToggleBtn.setAttribute('aria-expanded', 'true');
    requestRender();
  }

  function toggleDrawer() {
    const collapsed = drawerEl.classList.toggle('is-collapsed');
    railToggleBtn.setAttribute('aria-expanded', String(!collapsed));
    setTimeout(requestRender, 230);
  }

  function switchDrawerTab(tabId) {
    document.querySelectorAll('[data-drawer-tab]').forEach((b) => {
      const active = b.dataset.drawerTab === tabId;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-rail-tab]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.railTab === tabId);
    });
    document.getElementById('tab_inspector').classList.toggle('is-hidden', tabId !== 'inspector');
    document.getElementById('tab_catalog').classList.toggle('is-hidden', tabId !== 'catalog');
    document.getElementById('tab_credits').classList.toggle('is-hidden', tabId !== 'credits');
  }

  document.querySelectorAll('[data-drawer-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchDrawerTab(btn.dataset.drawerTab));
  });

  document.querySelectorAll('[data-rail-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openDrawer();
      switchDrawerTab(btn.dataset.railTab);
    });
  });

  document.getElementById('btn_close_drawer').addEventListener('click', toggleDrawer);
  railToggleBtn.addEventListener('click', toggleDrawer);

  document.querySelectorAll('[data-zone-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-zone-filter]').forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      renderCatalog(chip.dataset.zoneFilter);
    });
  });

  // Credits Modal
  const modalEl = document.getElementById('credits_modal');
  document.getElementById('btn_open_credits').addEventListener('click', () => {
    modalEl.classList.remove('is-hidden');
  });
  document.getElementById('btn_close_modal').addEventListener('click', () => {
    modalEl.classList.add('is-hidden');
  });
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) modalEl.classList.add('is-hidden');
  });

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => requestRender()).observe(containerEl);
  }
  window.addEventListener('resize', requestRender);

  renderNow();
}

initShowcase();
