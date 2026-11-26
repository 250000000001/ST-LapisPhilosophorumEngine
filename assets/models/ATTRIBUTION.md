# 3D Model Assets Attribution (CC BY 4.0)

The bundled `.glb` 3D prop packs inside this directory (`assets/models/`) are licensed under **Creative Commons Attribution 4.0 International (CC BY 4.0)**.

Note the **license boundary** in this repository:
- All JavaScript, HTML, CSS, and procedural geometry code in `ST-VexaStateEngine` (including `src/atlasWebgl.js`, `src/polyCss3d.js`, and `src/polyAssets.js`) is licensed under the **[MIT License](../../LICENSE)** (with `lib/three/` separately Copyright 2010–2026 Three.js Authors, MIT License).
- Only the binary 3D model packs below are licensed under **CC BY 4.0**.

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
