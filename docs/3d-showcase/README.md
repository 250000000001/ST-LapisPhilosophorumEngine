# LPE Interactive 3D Showcase (Magnum Opus Glass)

A self-contained Three.js walkthrough of the **Tingen Quarter** diorama built from the real `.glb` assets in [`assets/models/`](../../assets/models/). It pairs the **Magnum Opus Glass** HUD (`#1D1D20` frosted obsidian, `#9AD6CF` celadon + `#F1BE9A` gilded peach accents, `✦` headers, `tabular-nums` telemetry, vertical rail + slide-out drawer) with four smooth camera presets (Overview, Study Corner, Hearth / Counter, Courtyard), three lighting moods (Gaslight Warm, Celadon Night, Daylight), click-to-inspect prop selection, and a full CC BY 4.0 / CC0 attribution drawer + modal.

The scene loads `24` normalized props across three connected zones (8.8 m tavern + 6.0 m cobblestone courtyard sharing a physical doorway cutout) using the same bottom-pivot grounding, footprint fitting, and `KHR_materials_pbrSpecularGlossiness` adaptation as [`src/atlasWebgl.js`](../../src/atlasWebgl.js).

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell, HUD, rail, drawer, and attribution modal |
| `style.css` | Magnum Opus Glass design tokens and responsive layout |
| `showcase.js` | Three.js scene, GLB loading, camera/lighting controls, raycasting |

Assets and the vendored Three.js runtime are referenced from the repository root:

- Three.js modules: `../../lib/three/`
- GLB models: `../../assets/models/`

No files are duplicated and no external CDNs are used.

## Local Preview

Serve from the **repository root** so the `../../assets/models/` and `../../lib/three/` paths resolve (never use port `8000`):

```bash
cd ST-LapisPhilosophorumEngine
python -m http.server 8099
# open http://localhost:8099/docs/3d-showcase/
```

Any static server works; just keep the repository root as the document root.

## GitHub Pages Setup

1. Push the repository to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose branch **`main`** and folder **`/ (root)`**, then **Save**.
5. After the first deploy, the showcase is available at:

   **https://250000000001.github.io/ST-LapisPhilosophorumEngine/docs/3d-showcase/**

> Path note: assets are resolved relative to the page (`../../assets/models/`), so the showcase must be served from the repository root as shown above. Serving GitHub Pages from `/docs` instead would break the `../../assets` paths.

## WordPress `<iframe>` Embed

Paste this into a **Custom HTML** / `wp:html` block (the host page must allow iframes):

```html
<iframe
  src="https://250000000001.github.io/ST-LapisPhilosophorumEngine/docs/3d-showcase/"
  title="LPE Interactive 3D Showcase"
  loading="lazy"
  allow="fullscreen"
  style="width:100%;aspect-ratio:16/10;min-height:520px;border-radius:16px;border:1px solid rgba(154,214,207,0.28);background:#1D1D20;display:block;"
></iframe>
```

Fallback direct link: [Open the 3D showcase full-screen](https://250000000001.github.io/ST-LapisPhilosophorumEngine/docs/3d-showcase/).

## Credits

All 24 props are credited in the in-scene **Attributions** drawer/modal and in [`assets/models/ATTRIBUTION.md`](../../assets/models/ATTRIBUTION.md). Model licenses are **CC BY 4.0** or **CC0 1.0**; the LPE engine and UI are **CC BY-NC 4.0**; Three.js is **MIT**.
