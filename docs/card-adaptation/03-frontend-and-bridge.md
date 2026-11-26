# 03 — Frontend Renderer & Sandboxed `VexaCard` Bridge

Interactive card screens (character creation, status HUD panels, action menus) are rendered by `src/cardRenderer.js` + `src/cardBridge.js` inside isolated Blob-URL iframes without exposing host globals, SillyTavern internals, or API keys.

---

## 1. Iframe Sandbox & Content Security Policy

- **Iframe Attributes:** `sandbox="allow-scripts"` ONLY (`allow-same-origin`, `allow-forms`, and `allow-popups` are strictly omitted).
- **Blob-URL Lifecycle & Performance Guards (`cardRenderer.js`):**
  - Default CSP (`allowExternalResources = false`):
    ```
    default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:;
    img-src data: blob:; font-src data: blob:; media-src data: blob:;
    worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none';
    connect-src 'none'; form-action 'none'; base-uri 'none';
    ```
  - **2 MB Guard (`rendererMaxHtmlKb = 2048`):** Blocks larger than 2048 KB are paused behind an explicit click-to-render guard rather than slowing down the browser. Target `< 200 KB` for crisp adapted screens.
  - **Render Depth & Concurrency (`MAX_CONCURRENT_IFRAMES = 6`):** Historical messages beyond `rendererDepth` collapse cleanly to lightweight placeholders; `hljs` highlighting is automatically bypassed (`installHljsGuard`) for matched frontend blocks.
  - **Detector (`isFrontendHtmlBlock`):** Matches `<!DOCTYPE html>`, `<html`, `<!-- vexa-screen -->`, `data-vexa-screen="..."`, `<head>...<body`, or container+interactive HTML blocks inside `.mes_text pre code` (after regex scripts run). Never hijacks `<internal_states>`, `<vexa_tail>`, `<state:*>`, or `<UpdateVariable>`.
  - **Viewport Unit Rewriting:** Any `vh` CSS values in `<style>` are rewritten to `calc(var(--vse-vh, 600px) * ...)` to stop infinite ResizeObserver growth inside auto-sizing iframes.

---

## 2. Forbidden Legacy Card Patterns (Must Migrate)

| Legacy Pattern | Why It Breaks in Vexa Sandbox | Replacement |
|---|---|---|
| `TavernHelper.*`, `getVariables()`, `setVariables()`, `triggerSlash()`, `getChatMessages()` | `TavernHelper` is unavailable inside `sandbox="allow-scripts"` (`null` origin) and yields to Pure Vexa Mode | `window.VexaCard` RPC (`getVars`, `getVar`, `setVar`, `patchVars`, `getState`, `fillInput`, `submitInput`) |
| `window.parent.*`, `top.*` | Cross-origin SecurityError (`no allow-same-origin`) | `window.VexaCard` |
| `localStorage`, `sessionStorage`, `indexedDB`, `Dexie` | Blocked by opaque origin + strict CSP; state must belong to the SillyTavern chat | Persist in scoped `card_vars` via `VexaCard.patchVars(...)` |
| `<form>`, `window.open(...)`, `fetch(...)`, `new Worker(...)` | Blocked by `form-action 'none'`, `connect-src 'none'`, `worker-src 'none'` | Pure `<button type="button">` handlers + `VexaCard` |
| `<script src="https://...">`, `<link href="https://fonts.googleapis.com/...">`, `@import url(...)` | Blocked by CSP and bloats/hangs offline/strict-CSP renders | Inline small SVGs/helpers and use system serif/sans font stacks + `--vse-*` theme CSS vars |

---

## 3. `window.VexaCard` Client API Reference

Injected automatically into `<head>` by `assembleSandboxedDocument`:

- **Read State & Variables:**
  - `VexaCard.getVars()` -> deep-cloned `card_vars` object
  - `VexaCard.getVar(path, fallback)` -> resolves dot path (`stat_data.x` or `x`)
  - `VexaCard.getState()` -> sanitized Vexa state snapshot (`world`, `onscreen`, `health`, `inv`, `custom_trackers`, `locations`, etc.; never includes API keys or extension settings)
  - `VexaCard.getPath(path, fallback)` -> safe dot lookup on cached Vexa state
  - `VexaCard.refreshState()` -> Promise refreshing state from host
- **Mutate `card_vars` & Trigger Actions:**
  - `VexaCard.setVar(path, value)` -> Promise (`__proto__`/`constructor`/`prototype` rejected, 64 KB cap)
  - `VexaCard.patchVars(patchObj)` -> Promise deep-merging `patchObj` into `card_vars`
  - `VexaCard.roll(expr)` -> local `NdS` dice roller matching `ejsEngine.js`
  - `VexaCard.toast(message, level)` -> `'info' | 'success' | 'warning' | 'error'` (rate-limited)
  - `VexaCard.fillInput(text)` -> fills SillyTavern chat box (`#send_textarea`)
  - `VexaCard.submitInput(text)` -> stages action in Vexa's **1-click confirmation bar** (preserving user composer drafts unless `rendererAllowAutoSend` is enabled)
  - `VexaCard.resize(height)` -> manual resize request (clamped `60..2400px`; automatic `ResizeObserver` is also pre-wired)
- **Reactive Subscriptions:**
  - `VexaCard.onVarsChange(fn)` / `VexaCard.onStateChange(fn)` -> returns unsubscribe function

### Injected Theme CSS Custom Properties
`--vse-bg`, `--vse-mantle`, `--vse-surface`, `--vse-border`, `--vse-text`, `--vse-subtext`, `--vse-muted`, `--vse-accent`, `--vse-green`, `--vse-red`, `--vse-yellow`, `--vse-vh`, plus `color-scheme` matching the active Vexa theme (`Sola`, `Catppuccin Latte`, etc.).
