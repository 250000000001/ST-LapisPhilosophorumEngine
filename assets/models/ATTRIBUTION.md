# 3D Model Assets Attribution

The industrial and sci-fi prop packs are licensed under **Creative Commons Attribution 4.0 International (CC BY 4.0)**. Standalone imports carry the license listed in their individual credits.

Note the **license boundary** in this repository:
- All original JavaScript, HTML, CSS, and procedural geometry code in `ST-LapisPhilosophorumEngine` (including `src/atlasWebgl.js`, `src/atlasTopology.js`, `src/polyCss3d.js`, and `src/polyAssets.js`) is licensed under **[Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](../../LICENSE)** (with `lib/three/` separately Copyright 2010–2026 Three.js Authors under the **MIT License**).

---

## Bundled Model Packs

### 1. `psx-industrial.glb` — **PSX Industrial Pack**
- **Title:** PSX Industrial Pack
- **Author:** **Tomitos** (`https://sketchfab.com/Tomitos_`)
- **Source:** https://sketchfab.com/3d-models/psx-industrial-pack-12cb749961974f94a4063e67dafb2d76
- **License:** [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
- **Changes Made:** Extracted individual industrial prop meshes from the source `industrial.fbx` (omitting the combined showcase diorama), baked rest transforms, centered bottom pivots to `(0, 0, 0)`, normalized prop bounds, converted embedded `512×512` `T_Industrial` / `T_Industrial2` diffuse textures to optimized WebP (`EXT_texture_webp`), and exported into a single binary glTF 2.0 container (`psx-industrial.glb`). No endorsement by the original creator is implied.

### 2. `scifi-lab-props.glb` — **Sci-fi lab**
- **Title:** Sci-fi lab
- **Author:** **Agata Wilczek** (`https://sketchfab.com/a_wilczek`)
- **Source:** https://sketchfab.com/3d-models/sci-fi-lab-a676e149e343403bb5e57686f3d31da5
- **License:** [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
- **Changes Made:** Isolated 8 modular interior prop clusters (`sci_vat`, `sci_console`, `sci_table`, `sci_jar`, `sci_cabinet`, `sci_airlock`, `sci_screen`, `sci_pipe`) from `enviro_lab.obj` (omitting outer architectural wall/ceiling shells), simplified geometry via UV-preserving vertex clustering to reduce triangle density for browser WebGL, configured translucent glass/emissive materials (replacing the transparent vat glass albedo with glowing cyan tint + source emissive map), converted/downscaled textures to `256×256`–`384×384` WebP (`EXT_texture_webp` + `KHR_materials_emissive_strength`), normalized pivots, and packed into `scifi-lab-props.glb`. No endorsement by the original creator is implied.

---

## Optional Local Custom Models (`assets/models/custom/`)

You can optionally drop your own local `.glb` prop overrides (for example, `medieval_bookshelf.glb` or `bookshelf.glb` normalized with its bottom center at `(0, 0, 0)`) into `assets/models/custom/`. That directory is excluded via `.gitignore` so personal or Sketchfab Standard-licensed assets remain strictly local and are never redistributed in the repository.

## Standalone Sketchfab Models

Atlas adapts the bench and fountain's legacy specular-glossiness materials at load time. The kitchen counter is rotated 90° about Y to align with the Atlas footprint.

<!-- sketchfab:ad34d9ca70ec42479d4df5f9604b0c45 -->
### `sketchfab-ad34d9ca70ec42479d4df5f9604b0c45.glb` — Luxury sofa

- **Author:** uday
- **Sketchfab UID:** `ad34d9ca70ec42479d4df5f9604b0c45`
- **Source:** <https://sketchfab.com/3d-models/luxury-sofa-ad34d9ca70ec42479d4df5f9604b0c45>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:a32d0264449c47caa9ba02bc1e0d9f94 -->
### `sketchfab-a32d0264449c47caa9ba02bc1e0d9f94.glb` — PSX Armchair

- **Author:** Tomitos
- **Sketchfab UID:** `a32d0264449c47caa9ba02bc1e0d9f94`
- **Source:** <https://sketchfab.com/3d-models/psx-armchair-a32d0264449c47caa9ba02bc1e0d9f94>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:7ae82f2336c24b4ead6c44db7733bad0 -->
### `sketchfab-7ae82f2336c24b4ead6c44db7733bad0.glb` — Classic  Wooden  Table 01

- **Author:** Indika Thushara
- **Sketchfab UID:** `7ae82f2336c24b4ead6c44db7733bad0`
- **Source:** <https://sketchfab.com/3d-models/classic-wooden-table-01-7ae82f2336c24b4ead6c44db7733bad0>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:24704040010a42ceaeffb1631ed1ae9b -->
### `sketchfab-24704040010a42ceaeffb1631ed1ae9b.glb` — Bed - Low Poly Medieval, CC0

- **Author:** Avramania
- **Sketchfab UID:** `24704040010a42ceaeffb1631ed1ae9b`
- **Source:** <https://sketchfab.com/3d-models/bed-low-poly-medieval-cc0-24704040010a42ceaeffb1631ed1ae9b>
- **License:** [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:3899142ec92c46059d35fc0fa1a0bd41 -->
### `sketchfab-3899142ec92c46059d35fc0fa1a0bd41.glb` — Rug - Low Poly Medieval, CC0

- **Author:** Avramania
- **Sketchfab UID:** `3899142ec92c46059d35fc0fa1a0bd41`
- **Source:** <https://sketchfab.com/3d-models/rug-low-poly-medieval-cc0-3899142ec92c46059d35fc0fa1a0bd41>
- **License:** [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:f6915f34677546dd8dce914f32d892e8 -->
### `sketchfab-f6915f34677546dd8dce914f32d892e8.glb` — Scandi Modern Office Desk PSX Style

- **Author:** adamsite
- **Sketchfab UID:** `f6915f34677546dd8dce914f32d892e8`
- **Source:** <https://sketchfab.com/3d-models/scandi-modern-office-desk-psx-style-f6915f34677546dd8dce914f32d892e8>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:96a804790eff41b3b2376f3608fde7df -->
### `sketchfab-96a804790eff41b3b2376f3608fde7df.glb` — Wooden Wall Bookshelf

- **Author:** Sanzid
- **Sketchfab UID:** `96a804790eff41b3b2376f3608fde7df`
- **Source:** <https://sketchfab.com/3d-models/wooden-wall-bookshelf-96a804790eff41b3b2376f3608fde7df>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:a30fc85dd7764b3bb45f509a38c0d000 -->
### `sketchfab-a30fc85dd7764b3bb45f509a38c0d000.glb` — Antique Globe

- **Author:** thelowestanimal
- **Sketchfab UID:** `a30fc85dd7764b3bb45f509a38c0d000`
- **Source:** <https://sketchfab.com/3d-models/antique-globe-a30fc85dd7764b3bb45f509a38c0d000>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:b7fe5871c06a4fc6b9c2411a966ec91a -->
### `sketchfab-b7fe5871c06a4fc6b9c2411a966ec91a.glb` — Book Stack

- **Author:** NxHV
- **Sketchfab UID:** `b7fe5871c06a4fc6b9c2411a966ec91a`
- **Source:** <https://sketchfab.com/3d-models/book-stack-b7fe5871c06a4fc6b9c2411a966ec91a>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:bbd02f3c722b496a8cc2756f947f15ab -->
### `sketchfab-bbd02f3c722b496a8cc2756f947f15ab.glb` — Bar Counter

- **Author:** NFTLAB
- **Sketchfab UID:** `bbd02f3c722b496a8cc2756f947f15ab`
- **Source:** <https://sketchfab.com/3d-models/bar-counter-bbd02f3c722b496a8cc2756f947f15ab>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:4ca2d9183b3d4ec8aeeb56629a114090 -->
### `sketchfab-4ca2d9183b3d4ec8aeeb56629a114090.glb` — Wood Stove

- **Author:** daedaljs
- **Sketchfab UID:** `4ca2d9183b3d4ec8aeeb56629a114090`
- **Source:** <https://sketchfab.com/3d-models/wood-stove-4ca2d9183b3d4ec8aeeb56629a114090>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:89b2524c56d347fb90c4f0306c169446 -->
### `sketchfab-89b2524c56d347fb90c4f0306c169446.glb` — Store | Kitchen counter with trays

- **Author:** SAMU
- **Sketchfab UID:** `89b2524c56d347fb90c4f0306c169446`
- **Source:** <https://sketchfab.com/3d-models/store-kitchen-counter-with-trays-89b2524c56d347fb90c4f0306c169446>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:3acdec6397b648e3a10068786fb45e77 -->
### `sketchfab-3acdec6397b648e3a10068786fb45e77.glb` — Product Display Shelv

- **Author:** isareework
- **Sketchfab UID:** `3acdec6397b648e3a10068786fb45e77`
- **Source:** <https://sketchfab.com/3d-models/product-display-shelv-3acdec6397b648e3a10068786fb45e77>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:9818614b5da1479ba43a6a1216b1688f -->
### `sketchfab-9818614b5da1479ba43a6a1216b1688f.glb` — simple retro Desk Lamp

- **Author:** ribot02
- **Sketchfab UID:** `9818614b5da1479ba43a6a1216b1688f`
- **Source:** <https://sketchfab.com/3d-models/simple-retro-desk-lamp-9818614b5da1479ba43a6a1216b1688f>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:63d588a565fa4ee38ce474c3394a4113 -->
### `sketchfab-63d588a565fa4ee38ce474c3394a4113.glb` — Ceiling chandelier

- **Author:** Black Snow
- **Sketchfab UID:** `63d588a565fa4ee38ce474c3394a4113`
- **Source:** <https://sketchfab.com/3d-models/ceiling-chandelier-63d588a565fa4ee38ce474c3394a4113>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:8a3dc887ea9d48c19ad48469ba11e753 -->
### `sketchfab-8a3dc887ea9d48c19ad48469ba11e753.glb` — Lantern - Low Poly Medieval, CC0

- **Author:** Avramania
- **Sketchfab UID:** `8a3dc887ea9d48c19ad48469ba11e753`
- **Source:** <https://sketchfab.com/3d-models/lantern-low-poly-medieval-cc0-8a3dc887ea9d48c19ad48469ba11e753>
- **License:** [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:2a2f1c033ff04ba2a211f303bfb98e1a -->
### `sketchfab-2a2f1c033ff04ba2a211f303bfb98e1a.glb` — Sconce\_Mesh2

- **Author:** Maggatron
- **Sketchfab UID:** `2a2f1c033ff04ba2a211f303bfb98e1a`
- **Source:** <https://sketchfab.com/3d-models/sconce-mesh2-2a2f1c033ff04ba2a211f303bfb98e1a>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:81a8d1861bbd4cef8ab1aed2986bf873 -->
### `sketchfab-81a8d1861bbd4cef8ab1aed2986bf873.glb` — Low Poly Psx Street lamp

- **Author:** SaukrDev
- **Sketchfab UID:** `81a8d1861bbd4cef8ab1aed2986bf873`
- **Source:** <https://sketchfab.com/3d-models/low-poly-psx-street-lamp-81a8d1861bbd4cef8ab1aed2986bf873>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:93edf7d0e9f5443da41a5f1f83053966 -->
### `sketchfab-93edf7d0e9f5443da41a5f1f83053966.glb` — Wooden Bench

- **Author:** Víctor Hernández
- **Sketchfab UID:** `93edf7d0e9f5443da41a5f1f83053966`
- **Source:** <https://sketchfab.com/3d-models/wooden-bench-93edf7d0e9f5443da41a5f1f83053966>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:bc7f26baef2a45d18dbd9a5d6d2ec565 -->
### `sketchfab-bc7f26baef2a45d18dbd9a5d6d2ec565.glb` — Potted Plant, Mediterranean med leaf, low poly

- **Author:** dudecon
- **Sketchfab UID:** `bc7f26baef2a45d18dbd9a5d6d2ec565`
- **Source:** <https://sketchfab.com/3d-models/potted-plant-mediterranean-med-leaf-low-poly-bc7f26baef2a45d18dbd9a5d6d2ec565>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:3d333298326f4d1198c98940e5c73924 -->
### `sketchfab-3d333298326f4d1198c98940e5c73924.glb` — TeaScroll Clubhouse - Fountain Prop

- **Author:** Anaïs Faure
- **Sketchfab UID:** `3d333298326f4d1198c98940e5c73924`
- **Source:** <https://sketchfab.com/3d-models/teascroll-clubhouse-fountain-prop-3d333298326f4d1198c98940e5c73924>
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.

<!-- sketchfab:ed4e6c6a784a4a05b6dde9597b381797 -->
### `sketchfab-ed4e6c6a784a4a05b6dde9597b381797.glb` — Signpost - Low Poly Medieval, CC0

- **Author:** Avramania
- **Sketchfab UID:** `ed4e6c6a784a4a05b6dde9597b381797`
- **Source:** <https://sketchfab.com/3d-models/signpost-low-poly-medieval-cc0-ed4e6c6a784a4a05b6dde9597b381797>
- **License:** [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- **Changes:** Atlas centers the bottom pivot, orients the scene, and scales it at render time.
