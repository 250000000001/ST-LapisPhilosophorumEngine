/**
 * SillyTavern Extensions settings drawer UI for Lapis Philosophorum Engine (LPE).
 * Never prefills API keys in source defaults; reads/writes ST extensionSettings.
 */

import { LPE_THEMES, LPE_STYLES } from './schema.js';
import { getChatCompletionProfiles } from './st.js';
import { fetchModelsList, extractErrorMessage } from './workerClient.js';
import { DEFAULT_END_MARKER } from './retryDetector.js';
import { shouldYieldEjs } from './ejsEngine.js';
import { shouldYieldRenderer } from './cardRenderer.js';

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function syncSettingsUI(s) {
    if (!s || !$('#lpe_settings_container').length) return;
    $('#lpe_enabled').prop('checked', Boolean(s.enabled));
    $('#lpe_force_active').prop('checked', Boolean(s.forceActive));
    $('#lpe_scoped').prop('checked', s.scoped !== false);
    $('#lpe_worker_transport').val(s.workerTransport || 'direct');
    $('#lpe_direct_box').toggle((s.workerTransport || 'direct') === 'direct');
    $('#lpe_profile_box').toggle((s.workerTransport || 'direct') === 'profile');
    $('#lpe_worker_url').val(s.workerBaseUrl || '');
    $('#lpe_worker_key').val(s.workerApiKey || '');
    $('#lpe_worker_model').val(s.workerModel || '');
    $('#lpe_worker_profile').val(s.workerProfileId || '');
    $('#lpe_worker_mode').val(s.workerMode || 'combined');
    $('#lpe_worker_max_tokens').val(s.workerMaxTokens || 8192);
    $('#lpe_worker_temp').val(s.workerTemperature ?? 0.25);
    $('#lpe_hud_theme').val(s.hudTheme || 'Sola');
    $('#lpe_hud_style').val(s.hudStyle || 'Afterglow');
    $('#lpe_atlas_mode').val(s.atlasViewMode || 'webgl');
    $('#lpe_body_type').val(s.defaultBodyType || 'male');
    $('#lpe_show_launcher').prop('checked', s.showLauncherButton !== false);
    $('#lpe_hud_collapsed').prop('checked', s.hudDefaultCollapsed !== false);
    $('#lpe_show_inline_changes').prop('checked', s.showInlineChanges !== false);
    $('#lpe_spatial_grounding').prop('checked', s.spatialGrounding !== false);
    $('#lpe_pin_rules').prop('checked', s.pinNotebookRules !== false);
    $('#lpe_matrix_cap').prop('checked', s.enforceMatrixStepCap !== false);
    $('#lpe_allow_tracker_proposals').prop('checked', s.allowTrackerProposals !== false);
    $('#lpe_auto_accept_trackers').prop('checked', Boolean(s.autoAcceptTrackerProposals));
    $('#lpe_auto_accept_trackers_wrap').toggle(s.allowTrackerProposals !== false);

    const r = s.retry || {};
    $('#lpe_retry_enabled').prop('checked', r.enabled !== false);
    $('#lpe_retry_options_box').toggle(r.enabled !== false);
    $('#lpe_retry_show_nsc').prop('checked', r.showNonStreamContinue !== false);
    $('#lpe_retry_require_end').prop('checked', r.requireEndMarker !== false);
    $('#lpe_retry_format_mode').val(r.formatMode || 'auto');
    $('#lpe_retry_end_marker').val(r.endMarker || DEFAULT_END_MARKER);
    $('#lpe_retry_max_incomplete').val(r.maxIncompleteRetries ?? 3);
    $('#lpe_retry_max_refusal').val(r.maxRefusalRetries ?? 0);
    $('#lpe_retry_delay').val(r.retryDelayMs ?? 300);
    $('#lpe_retry_show_toasts').prop('checked', r.showStatusToasts !== false);
    $('#lpe_retry_use_modal').prop('checked', r.useModalPopup !== false);
    $('#lpe_retry_custom_patterns').val(r.customPatterns || '');

    $('#lpe_ejs_enabled').prop('checked', s.ejsEnabled !== false);
    $('#lpe_ejs_options_box').toggle(s.ejsEnabled !== false);
    $('#lpe_ejs_eval_wi').prop('checked', s.ejsEvalWorldInfo !== false);
    $('#lpe_ejs_eval_prompts').prop('checked', s.ejsEvalPrompts !== false);
    $('#lpe_ejs_auto_yield').prop('checked', s.ejsAutoYield !== false);

    $('#lpe_renderer_enabled').prop('checked', s.rendererEnabled !== false);
    $('#lpe_renderer_options_box').toggle(s.rendererEnabled !== false);
    $('#lpe_renderer_blob').prop('checked', s.rendererUseBlobUrl !== false);
    $('#lpe_renderer_depth').val(String(s.rendererDepth ?? 2));
    $('#lpe_renderer_collapse').val(s.rendererCollapseCode || 'frontend');
    $('#lpe_renderer_skip_hljs').prop('checked', s.rendererSkipHljs !== false);
    $('#lpe_renderer_max_kb').val(String(s.rendererMaxHtmlKb ?? 2048));
    $('#lpe_renderer_allow_ext').prop('checked', Boolean(s.rendererAllowExternalResources));
    $('#lpe_renderer_auto_send').prop('checked', Boolean(s.rendererAllowAutoSend));
    $('#lpe_renderer_auto_yield').prop('checked', s.rendererAutoYield !== false);
}

export function injectSettingsUI({
    getSettings,
    saveSettings,
    getContextSafe,
    workerClient,
    onOpenPopup,
    onImportChat,
    onOpenEditor,
    onPreviewPrompt,
    onRereadLast,
    onResetChat,
    onCleanLastRefusal,
    onRetryToggleChanged,
    onAlignHudThemes,
    onSettingsChanged,
}) {
    if ($('#lpe_settings_container').length) return;
    const $container = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    if (!$container.length) return;

    const s = getSettings();
    const profiles = getChatCompletionProfiles();

    const html = `
        <div id="lpe_settings_container" class="lpe-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Lapis Philosophorum Engine (LPE)</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="lpe-btn-wrap" style="margin-bottom:8px;">
                        <button id="lpe_open_popup_btn" type="button" class="menu_button" style="width:100%;font-weight:600;">
                            <i class="fa-solid fa-window-maximize"></i> Open LPE Control Center
                        </button>
                    </div>

                    <label class="checkbox_label" for="lpe_enabled">
                        <input id="lpe_enabled" type="checkbox" />
                        <span>Enable Lapis Philosophorum Engine (LPE)</span>
                    </label>
                    <label class="checkbox_label" for="lpe_force_active">
                        <input id="lpe_force_active" type="checkbox" />
                        <span>Force active even if preset is not auto-detected as Magnum Opus / LPE</span>
                    </label>
                    <label class="checkbox_label" for="lpe_scoped">
                        <input id="lpe_scoped" type="checkbox" />
                        <span>Smart Scoping (summarize inactive Atlas maps &amp; dormant NPCs in prompt)</span>
                    </label>

                    <hr class="lpe-sep" />
                    <div class="lpe-sec-title"><i class="fa-solid fa-robot"></i> Secondary Worker API ("LPE Clerk")</div>

                    <div class="lpe-field">
                        <label for="lpe_worker_transport">Worker Transport Mode</label>
                        <select id="lpe_worker_transport" class="text_pole">
                            <option value="direct">Direct OpenAI-Compatible Endpoint (Base URL + Key + Model)</option>
                            <option value="profile">SillyTavern Connection Profile (Zero-Switch)</option>
                        </select>
                    </div>

                    <div id="lpe_direct_box">
                        <div class="lpe-field">
                            <label for="lpe_worker_url">Base URL (e.g. <code>https://api.openai.com/v1</code>)</label>
                            <input id="lpe_worker_url" type="text" class="text_pole" placeholder="https://api.openai.com/v1" />
                        </div>
                        <div class="lpe-field">
                            <label for="lpe_worker_key">API Key</label>
                            <input id="lpe_worker_key" type="password" class="text_pole" autocomplete="off" placeholder="sk-..." />
                        </div>
                        <div class="lpe-field">
                            <label for="lpe_worker_model">Model ID</label>
                            <div class="lpe-inline-row">
                                <input id="lpe_worker_model" type="text" class="text_pole" placeholder="deepseek-v4.1-flash / glm-5.3-flash" />
                                <button id="lpe_fetch_models_btn" type="button" class="menu_button" title="Fetch models from endpoint"><i class="fa-solid fa-cloud-arrow-down"></i> Fetch</button>
                            </div>
                            <select id="lpe_fetched_models" class="text_pole" style="display:none;margin-top:4px;"></select>
                        </div>
                    </div>

                    <div id="lpe_profile_box" style="display:none;">
                        <div class="lpe-field">
                            <label for="lpe_worker_profile">Connection Profile</label>
                            <div class="lpe-inline-row">
                                <select id="lpe_worker_profile" class="text_pole">
                                    <option value="">-- Select Chat Completion Profile --</option>
                                    ${profiles.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
                                </select>
                                <button id="lpe_refresh_profiles_btn" type="button" class="menu_button"><i class="fa-solid fa-rotate"></i></button>
                            </div>
                        </div>
                    </div>

                    <div class="lpe-two-col">
                        <div class="lpe-field">
                            <label for="lpe_worker_mode">Worker Call Mode</label>
                            <select id="lpe_worker_mode" class="text_pole">
                                <option value="combined">Combined (1 call / turn)</option>
                                <option value="split">Split (2 calls / turn)</option>
                            </select>
                        </div>
                        <div class="lpe-field">
                            <label for="lpe_worker_max_tokens">Max Tokens</label>
                            <input id="lpe_worker_max_tokens" type="number" min="512" max="32768" step="256" class="text_pole" />
                        </div>
                        <div class="lpe-field">
                            <label for="lpe_worker_temp">Temperature</label>
                            <input id="lpe_worker_temp" type="number" min="0" max="2" step="0.05" class="text_pole" />
                        </div>
                    </div>

                    <div class="lpe-inline-row" style="margin-top:6px;">
                        <button id="lpe_test_worker_btn" type="button" class="menu_button"><i class="fa-solid fa-vial"></i> Test Worker Connection</button>
                        <span id="lpe_test_status" class="lpe-muted"></span>
                    </div>

                    <hr class="lpe-sep" />
                    <div class="lpe-sec-title"><i class="fa-solid fa-palette"></i> Native HUD &amp; Reducer</div>

                    <div class="lpe-two-col">
                        <div class="lpe-field">
                            <label for="lpe_hud_theme">HUD Theme</label>
                            <select id="lpe_hud_theme" class="text_pole">
                                ${Object.keys(LPE_THEMES).map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
                            </select>
                        </div>
                        <div class="lpe-field">
                            <label for="lpe_hud_style">HUD Style</label>
                            <select id="lpe_hud_style" class="text_pole">
                                ${LPE_STYLES.map((st) => `<option value="${esc(st)}">${esc(st)}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="lpe-two-col">
                        <div class="lpe-field">
                            <label for="lpe_atlas_mode">Default Atlas Renderer</label>
                            <select id="lpe_atlas_mode" class="text_pole">
                                <option value="webgl">3D WebGL (Hybrid + Textured Kits)</option>
                                <option value="3d">3D CSS (PolyCSS)</option>
                                <option value="2d">2D SVG Floorplan</option>
                            </select>
                        </div>
                        <div class="lpe-field">
                            <label for="lpe_body_type">Default Body Silhouette</label>
                            <select id="lpe_body_type" class="text_pole">
                                <option value="male">Male</option>
                                <option value="female">Female</option>
                                <option value="athletic">Athletic</option>
                                <option value="heavy">Heavy</option>
                            </select>
                        </div>
                    </div>
                    <label class="checkbox_label" for="lpe_show_launcher">
                        <input id="lpe_show_launcher" type="checkbox" />
                        <span>Show floating launcher button</span>
                    </label>
                    <label class="checkbox_label" for="lpe_hud_collapsed">
                        <input id="lpe_hud_collapsed" type="checkbox" />
                        <span>Collapse HUD cards by default</span>
                    </label>
                    <label class="checkbox_label" for="lpe_show_inline_changes">
                        <input id="lpe_show_inline_changes" type="checkbox" />
                        <span>Show inline &ldquo;Changed in this reply&rdquo; diff strip</span>
                    </label>
                    <label class="checkbox_label" for="lpe_spatial_grounding">
                        <input id="lpe_spatial_grounding" type="checkbox" />
                        <span>Inject <code>&lt;spatial_grounding&gt;</code> room &amp; elevation guide for main model</span>
                    </label>
                    <div class="lpe-btn-row" style="margin:6px 0;">
                        <button type="button" id="lpe_align_hud_themes_btn" class="menu_button" title="Apply active HUD theme and style across all rendered chat HUD cards in-place">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> Align All Chat HUDs to Current Theme
                        </button>
                    </div>
                    <label class="checkbox_label" for="lpe_pin_rules">
                        <input id="lpe_pin_rules" type="checkbox" />
                        <span>Pin <code>[R]</code> OOC rules in Notebook (never evicted at 20-entry cap)</span>
                    </label>
                    <label class="checkbox_label" for="lpe_matrix_cap">
                        <input id="lpe_matrix_cap" type="checkbox" />
                        <span>Enforce ±2 per-turn Aether Matrix step cap</span>
                    </label>
                    <label class="checkbox_label" for="lpe_allow_tracker_proposals">
                        <input id="lpe_allow_tracker_proposals" type="checkbox" />
                        <span>Allow main model to propose custom trackers</span>
                    </label>
                    <label id="lpe_auto_accept_trackers_wrap" class="checkbox_label" for="lpe_auto_accept_trackers" style="padding-left:18px;">
                        <input id="lpe_auto_accept_trackers" type="checkbox" />
                        <span>Auto-accept proposed trackers (skip manual approval)</span>
                    </label>

                    <hr class="lpe-sep" />
                    <div class="lpe-sec-title"><i class="fa-solid fa-shield-halved"></i> Refusal Auto-Retry &amp; Non-Stream Continue</div>
                    <label class="checkbox_label" for="lpe_retry_enabled">
                        <input id="lpe_retry_enabled" type="checkbox" />
                        <span>Enable built-in Refusal Auto-Retry &amp; End-Marker Guard</span>
                    </label>
                    <div id="lpe_retry_options_box" class="lpe-retry-box">
                        <label class="checkbox_label" for="lpe_retry_show_nsc">
                            <input id="lpe_retry_show_nsc" type="checkbox" />
                            <span>Show “Continue (No Stream)” send-bar button &amp; Options item</span>
                        </label>
                        <label class="checkbox_label" for="lpe_retry_require_end">
                            <input id="lpe_retry_require_end" type="checkbox" />
                            <span>Require reply to end with end marker (Non-Stream retry)</span>
                        </label>
                        <div class="lpe-field">
                            <label for="lpe_retry_format_mode">End-marker validation mode</label>
                            <select id="lpe_retry_format_mode" class="text_pole">
                                <option value="auto">Auto-detect (&lt;lpe_tail&gt;/&lt;vexa_tail&gt; or &lt;internal_states&gt; + GFX_END)</option>
                                <option value="external">External State (&lt;lpe_tail&gt;/&lt;vexa_tail&gt; + GFX_END required)</option>
                                <option value="classic">Classic (&lt;internal_states&gt; + GFX_END required)</option>
                                <option value="marker">Marker Only (trailing GFX_END / custom marker)</option>
                            </select>
                        </div>
                        <div class="lpe-field">
                            <label for="lpe_retry_end_marker">Required end marker</label>
                            <input id="lpe_retry_end_marker" type="text" class="text_pole" />
                        </div>
                        <div class="lpe-two-col">
                            <div class="lpe-field">
                                <label for="lpe_retry_max_incomplete">Max incomplete retries</label>
                                <input id="lpe_retry_max_incomplete" type="number" min="0" max="20" step="1" class="text_pole" />
                            </div>
                            <div class="lpe-field">
                                <label for="lpe_retry_max_refusal">Max refusal retries (0=unlimited)</label>
                                <input id="lpe_retry_max_refusal" type="number" min="0" max="50" step="1" class="text_pole" />
                            </div>
                            <div class="lpe-field">
                                <label for="lpe_retry_delay">Retry delay (ms)</label>
                                <input id="lpe_retry_delay" type="number" min="0" max="10000" step="50" class="text_pole" />
                            </div>
                        </div>
                        <label class="checkbox_label" for="lpe_retry_show_toasts">
                            <input id="lpe_retry_show_toasts" type="checkbox" />
                            <span>Show toast notification on each retry</span>
                        </label>
                        <label class="checkbox_label" for="lpe_retry_use_modal">
                            <input id="lpe_retry_use_modal" type="checkbox" />
                            <span>Show modal popup on max failures</span>
                        </label>
                        <div class="lpe-field">
                            <label for="lpe_retry_custom_patterns">Custom refusal patterns <small>(plain text or <code>/regex/i</code>, one per line)</small></label>
                            <textarea id="lpe_retry_custom_patterns" class="text_pole textarea_compact" rows="3" placeholder="I am Gemini Enterprise&#10;/cannot participate in .* roleplay/i"></textarea>
                        </div>
                        <div class="lpe-btn-wrap">
                            <button id="lpe_retry_clean_last_btn" type="button" class="menu_button"><i class="fa-solid fa-broom"></i> Clean Refusal From Last Reply</button>
                        </div>
                    </div>

                    <hr class="lpe-sep" />
                    <div class="lpe-sec-title"><i class="fa-solid fa-code"></i> Card Runtime (EJS &amp; Sandboxed Renderer)</div>
                    <label class="checkbox_label" for="lpe_ejs_enabled">
                        <input id="lpe_ejs_enabled" type="checkbox" />
                        <span>Enable clean-room scoped EJS &amp; macros in World Info / prompts</span>
                    </label>
                    <div id="lpe_ejs_options_box" class="lpe-retry-box">
                        <label class="checkbox_label" for="lpe_ejs_eval_wi">
                            <input id="lpe_ejs_eval_wi" type="checkbox" />
                            <span>Evaluate EJS &amp; <code>[InitVar]</code> during World Info loading</span>
                        </label>
                        <label class="checkbox_label" for="lpe_ejs_eval_prompts">
                            <input id="lpe_ejs_eval_prompts" type="checkbox" />
                            <span>Evaluate EJS &amp; card macros on outgoing chat prompts</span>
                        </label>
                        <label class="checkbox_label" for="lpe_ejs_auto_yield">
                            <input id="lpe_ejs_auto_yield" type="checkbox" />
                            <span>Auto-yield EJS to ST-Prompt-Template when installed ${shouldYieldEjs({ ejsAutoYield: true }) ? '(active — yielding)' : ''}</span>
                        </label>
                    </div>

                    <label class="checkbox_label" for="lpe_renderer_enabled" style="margin-top:6px;">
                        <input id="lpe_renderer_enabled" type="checkbox" />
                        <span>Enable Guarded Blob-URL Iframe Renderer for card HTML blocks</span>
                    </label>
                    <div id="lpe_renderer_options_box" class="lpe-retry-box">
                        <label class="checkbox_label" for="lpe_renderer_blob">
                            <input id="lpe_renderer_blob" type="checkbox" />
                            <span>Use Blob URL iframe loading (fall back to srcdoc when off)</span>
                        </label>
                        <div class="lpe-two-col">
                            <div class="lpe-field">
                                <label for="lpe_renderer_depth">Render Depth (floors; 0=all, cap 6)</label>
                                <input id="lpe_renderer_depth" type="number" min="0" max="50" step="1" class="text_pole" />
                            </div>
                            <div class="lpe-field">
                                <label for="lpe_renderer_max_kb">Max HTML KB guard</label>
                                <input id="lpe_renderer_max_kb" type="number" min="64" max="16384" step="64" class="text_pole" />
                            </div>
                        </div>
                        <div class="lpe-field">
                            <label for="lpe_renderer_collapse">Code Block Folding</label>
                            <select id="lpe_renderer_collapse" class="text_pole">
                                <option value="frontend">Frontend screens only</option>
                                <option value="all">All code blocks in chat</option>
                                <option value="none">Do not collapse code blocks</option>
                            </select>
                        </div>
                        <label class="checkbox_label" for="lpe_renderer_skip_hljs">
                            <input id="lpe_renderer_skip_hljs" type="checkbox" />
                            <span>Skip highlight.js on rendered HTML code blocks (faster scroll/load)</span>
                        </label>
                        <label class="checkbox_label" for="lpe_renderer_allow_ext">
                            <input id="lpe_renderer_allow_ext" type="checkbox" />
                            <span>Allow external CDN fonts/styles (keep offline CSP off for stricter privacy)</span>
                        </label>
                        <label class="checkbox_label" for="lpe_renderer_auto_send">
                            <input id="lpe_renderer_auto_send" type="checkbox" />
                            <span>Allow card scripts to auto-send replies without confirmation bar</span>
                        </label>
                        <label class="checkbox_label" for="lpe_renderer_auto_yield">
                            <input id="lpe_renderer_auto_yield" type="checkbox" />
                            <span>Auto-yield renderer to JS-Slash-Runner when installed ${shouldYieldRenderer({ rendererAutoYield: true }) ? '(active — yielding)' : ''}</span>
                        </label>
                    </div>

                    <hr class="lpe-sep" />
                    <div class="lpe-sec-title"><i class="fa-solid fa-wrench"></i> Chat Tools</div>
                    <div class="lpe-btn-wrap">
                        <button id="lpe_import_chat_btn" type="button" class="menu_button"><i class="fa-solid fa-file-import"></i> Import Chat States</button>
                        <button id="lpe_open_editor_btn" type="button" class="menu_button"><i class="fa-solid fa-pen-to-square"></i> Edit State</button>
                        <button id="lpe_preview_prompt_btn" type="button" class="menu_button"><i class="fa-solid fa-eye"></i> Preview Snapshot</button>
                        <button id="lpe_reread_last_btn" type="button" class="menu_button"><i class="fa-solid fa-rotate"></i> Re-read Last</button>
                        <button id="lpe_reset_chat_btn" type="button" class="menu_button"><i class="fa-solid fa-trash"></i> Reset Chat State</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $container.append(html);

    function syncTransportVisibility() {
        const mode = $('#lpe_worker_transport').val();
        $('#lpe_direct_box').toggle(mode === 'direct');
        $('#lpe_profile_box').toggle(mode === 'profile');
    }

    $('#lpe_enabled').prop('checked', Boolean(s.enabled));
    $('#lpe_force_active').prop('checked', Boolean(s.forceActive));
    $('#lpe_scoped').prop('checked', s.scoped !== false);
    $('#lpe_worker_transport').val(s.workerTransport || 'direct');
    $('#lpe_worker_url').val(s.workerBaseUrl || '');
    $('#lpe_worker_key').val(s.workerApiKey || '');
    $('#lpe_worker_model').val(s.workerModel || '');
    $('#lpe_worker_profile').val(s.workerProfileId || '');
    $('#lpe_worker_mode').val(s.workerMode || 'combined');
    $('#lpe_worker_max_tokens').val(s.workerMaxTokens || 8192);
    $('#lpe_worker_temp').val(s.workerTemperature ?? 0.25);
    $('#lpe_hud_theme').val(s.hudTheme || 'Sola');
    $('#lpe_hud_style').val(s.hudStyle || 'Afterglow');
    $('#lpe_atlas_mode').val(s.atlasViewMode || 'webgl');
    $('#lpe_body_type').val(s.defaultBodyType || 'male');
    $('#lpe_show_launcher').prop('checked', s.showLauncherButton !== false);
    $('#lpe_hud_collapsed').prop('checked', s.hudDefaultCollapsed !== false);
    $('#lpe_show_inline_changes').prop('checked', s.showInlineChanges !== false);
    $('#lpe_spatial_grounding').prop('checked', s.spatialGrounding !== false);
    $('#lpe_pin_rules').prop('checked', s.pinNotebookRules !== false);
    $('#lpe_matrix_cap').prop('checked', s.enforceMatrixStepCap !== false);
    $('#lpe_allow_tracker_proposals').prop('checked', s.allowTrackerProposals !== false);
    $('#lpe_auto_accept_trackers').prop('checked', Boolean(s.autoAcceptTrackerProposals));
    $('#lpe_auto_accept_trackers_wrap').toggle(s.allowTrackerProposals !== false);
    syncTransportVisibility();

    const r = s.retry || {};
    function syncRetryVisibility() {
        $('#lpe_retry_options_box').toggle($('#lpe_retry_enabled').prop('checked'));
    }
    $('#lpe_retry_enabled').prop('checked', r.enabled !== false);
    $('#lpe_retry_show_nsc').prop('checked', r.showNonStreamContinue !== false);
    $('#lpe_retry_require_end').prop('checked', r.requireEndMarker !== false);
    $('#lpe_retry_format_mode').val(r.formatMode || 'auto');
    $('#lpe_retry_end_marker').val(r.endMarker || DEFAULT_END_MARKER);
    $('#lpe_retry_max_incomplete').val(r.maxIncompleteRetries ?? 3);
    $('#lpe_retry_max_refusal').val(r.maxRefusalRetries ?? 0);
    $('#lpe_retry_delay').val(r.retryDelayMs ?? 300);
    $('#lpe_retry_show_toasts').prop('checked', r.showStatusToasts !== false);
    $('#lpe_retry_use_modal').prop('checked', r.useModalPopup !== false);
    $('#lpe_retry_custom_patterns').val(r.customPatterns || '');
    syncRetryVisibility();

    $('#lpe_enabled').on('change', function () { getSettings().enabled = $(this).prop('checked'); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_force_active').on('change', function () { getSettings().forceActive = $(this).prop('checked'); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_scoped').on('change', function () { getSettings().scoped = $(this).prop('checked'); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_worker_transport').on('change', function () { getSettings().workerTransport = $(this).val(); syncTransportVisibility(); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_worker_url').on('input change', function () { getSettings().workerBaseUrl = String($(this).val() ?? '').trim(); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_worker_key').on('input change', function () { getSettings().workerApiKey = String($(this).val() ?? '').trim(); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_worker_model').on('input change', function () { getSettings().workerModel = String($(this).val() ?? '').trim(); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_worker_profile').on('change', function () { getSettings().workerProfileId = String($(this).val() ?? ''); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_worker_mode').on('change', function () { getSettings().workerMode = $(this).val(); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_worker_max_tokens').on('change', function () { getSettings().workerMaxTokens = Math.max(256, parseInt($(this).val(), 10) || 8192); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_worker_temp').on('change', function () { getSettings().workerTemperature = Number($(this).val()) || 0.25; saveSettings(); onSettingsChanged?.(); });
    $('#lpe_hud_theme').on('change', function () { getSettings().hudTheme = $(this).val(); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_hud_style').on('change', function () { getSettings().hudStyle = $(this).val(); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_atlas_mode').on('change', function () { getSettings().atlasViewMode = $(this).val(); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_body_type').on('change', function () { getSettings().defaultBodyType = $(this).val(); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_show_launcher').on('change', function () { getSettings().showLauncherButton = $(this).prop('checked'); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_hud_collapsed').on('change', function () { getSettings().hudDefaultCollapsed = $(this).prop('checked'); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_show_inline_changes').on('change', function () { getSettings().showInlineChanges = $(this).prop('checked'); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_spatial_grounding').on('change', function () { getSettings().spatialGrounding = $(this).prop('checked'); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_align_hud_themes_btn').on('click', () => {
        const cur = getSettings();
        onAlignHudThemes?.(cur.hudTheme || 'Sola', cur.hudStyle || 'Afterglow');
    });
    $('#lpe_open_popup_btn').on('click', () => onOpenPopup?.());
    $('#lpe_pin_rules').on('change', function () { getSettings().pinNotebookRules = $(this).prop('checked'); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_matrix_cap').on('change', function () { getSettings().enforceMatrixStepCap = $(this).prop('checked'); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_allow_tracker_proposals').on('change', function () {
        const allow = Boolean($(this).prop('checked'));
        getSettings().allowTrackerProposals = allow;
        $('#lpe_auto_accept_trackers_wrap').toggle(allow);
        saveSettings();
        onSettingsChanged?.();
    });
    $('#lpe_auto_accept_trackers').on('change', function () {
        getSettings().autoAcceptTrackerProposals = Boolean($(this).prop('checked'));
        saveSettings();
        onSettingsChanged?.();
    });

    const retryCfg = () => {
        const st = getSettings();
        if (!st.retry || typeof st.retry !== 'object') st.retry = {};
        return st.retry;
    };
    $('#lpe_retry_enabled').on('change', function () {
        retryCfg().enabled = Boolean($(this).prop('checked'));
        syncRetryVisibility();
        saveSettings();
        onRetryToggleChanged?.();
    });
    $('#lpe_retry_show_nsc').on('change', function () {
        retryCfg().showNonStreamContinue = Boolean($(this).prop('checked'));
        saveSettings();
        onRetryToggleChanged?.();
    });
    $('#lpe_retry_require_end').on('change', function () {
        retryCfg().requireEndMarker = Boolean($(this).prop('checked'));
        saveSettings();
        onSettingsChanged?.();
    });
    $('#lpe_retry_format_mode').on('change', function () {
        retryCfg().formatMode = String($(this).val() || 'auto');
        saveSettings();
        onSettingsChanged?.();
    });
    $('#lpe_retry_end_marker').on('input change', function () {
        retryCfg().endMarker = String($(this).val() ?? '') || DEFAULT_END_MARKER;
        saveSettings();
        onSettingsChanged?.();
    });
    $('#lpe_retry_max_incomplete').on('input change', function () {
        const parsed = parseInt(String($(this).val()), 10);
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 20) {
            retryCfg().maxIncompleteRetries = parsed;
            saveSettings();
            onSettingsChanged?.();
        }
    });
    $('#lpe_retry_max_refusal').on('input change', function () {
        const parsed = parseInt(String($(this).val()), 10);
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 50) {
            retryCfg().maxRefusalRetries = parsed;
            saveSettings();
            onSettingsChanged?.();
        }
    });
    $('#lpe_retry_delay').on('input change', function () {
        const parsed = parseInt(String($(this).val()), 10);
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 10000) {
            retryCfg().retryDelayMs = parsed;
            saveSettings();
            onSettingsChanged?.();
        }
    });
    $('#lpe_retry_show_toasts').on('change', function () {
        retryCfg().showStatusToasts = Boolean($(this).prop('checked'));
        saveSettings();
        onSettingsChanged?.();
    });
    $('#lpe_retry_use_modal').on('change', function () {
        retryCfg().useModalPopup = Boolean($(this).prop('checked'));
        saveSettings();
        onSettingsChanged?.();
    });
    $('#lpe_retry_custom_patterns').on('input change', function () {
        retryCfg().customPatterns = String($(this).val() ?? '');
        saveSettings();
        onSettingsChanged?.();
    });
    $('#lpe_retry_clean_last_btn').on('click', () => onCleanLastRefusal?.());

    const syncRuntimeVisibility = () => {
        $('#lpe_ejs_options_box').toggle($('#lpe_ejs_enabled').prop('checked'));
        $('#lpe_renderer_options_box').toggle($('#lpe_renderer_enabled').prop('checked'));
    };
    syncRuntimeVisibility();

    $('#lpe_ejs_enabled').on('change', function () { getSettings().ejsEnabled = Boolean($(this).prop('checked')); syncRuntimeVisibility(); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_ejs_eval_wi').on('change', function () { getSettings().ejsEvalWorldInfo = Boolean($(this).prop('checked')); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_ejs_eval_prompts').on('change', function () { getSettings().ejsEvalPrompts = Boolean($(this).prop('checked')); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_ejs_auto_yield').on('change', function () { getSettings().ejsAutoYield = Boolean($(this).prop('checked')); saveSettings(); onSettingsChanged?.(); });

    $('#lpe_renderer_enabled').on('change', function () { getSettings().rendererEnabled = Boolean($(this).prop('checked')); syncRuntimeVisibility(); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_renderer_blob').on('change', function () { getSettings().rendererUseBlobUrl = Boolean($(this).prop('checked')); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_renderer_depth').on('input change', function () {
        const parsed = parseInt(String($(this).val()), 10);
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 50) {
            getSettings().rendererDepth = parsed;
            saveSettings();
            onSettingsChanged?.();
        }
    });
    $('#lpe_renderer_max_kb').on('input change', function () {
        const parsed = parseInt(String($(this).val()), 10);
        if (!Number.isNaN(parsed) && parsed >= 64 && parsed <= 16384) {
            getSettings().rendererMaxHtmlKb = parsed;
            saveSettings();
            onSettingsChanged?.();
        }
    });
    $('#lpe_renderer_collapse').on('change', function () { getSettings().rendererCollapseCode = String($(this).val() || 'frontend'); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_renderer_skip_hljs').on('change', function () { getSettings().rendererSkipHljs = Boolean($(this).prop('checked')); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_renderer_allow_ext').on('change', function () { getSettings().rendererAllowExternalResources = Boolean($(this).prop('checked')); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_renderer_auto_send').on('change', function () { getSettings().rendererAllowAutoSend = Boolean($(this).prop('checked')); saveSettings(); onSettingsChanged?.(); });
    $('#lpe_renderer_auto_yield').on('change', function () { getSettings().rendererAutoYield = Boolean($(this).prop('checked')); saveSettings(); onSettingsChanged?.(); });

    $('#lpe_refresh_profiles_btn').on('click', () => {
        const list = getChatCompletionProfiles();
        const cur = getSettings().workerProfileId || '';
        $('#lpe_worker_profile').html(`<option value="">-- Select Chat Completion Profile --</option>${list.map((p) => `<option value="${esc(p.id)}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`);
    });

    $('#lpe_fetch_models_btn').on('click', async function () {
        const $btn = $(this);
        $btn.prop('disabled', true);
        $('#lpe_test_status').text('Fetching models...');
        try {
            const st = getSettings();
            const list = await fetchModelsList({ baseUrl: st.workerBaseUrl, apiKey: st.workerApiKey, ctx: getContextSafe() });
            const $sel = $('#lpe_fetched_models');
            $sel.html(`<option value="">-- Pick fetched model (${list.length}) --</option>${list.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}`).show();
            $('#lpe_test_status').text(`Loaded ${list.length} models.`);
        } catch (err) {
            $('#lpe_test_status').text(extractErrorMessage(err));
        } finally {
            $btn.prop('disabled', false);
        }
    });

    $('#lpe_fetched_models').on('change', function () {
        const val = $(this).val();
        if (val) {
            $('#lpe_worker_model').val(val).trigger('change');
        }
    });

    $('#lpe_test_worker_btn').on('click', async function () {
        const $btn = $(this);
        $btn.prop('disabled', true);
        $('#lpe_test_status').text('Testing...');
        try {
            const ans = await workerClient.testConnection();
            $('#lpe_test_status').html(`<span style="color:#a6e3a1;">OK: ${esc(ans.slice(0, 60))}</span>`);
        } catch (err) {
            $('#lpe_test_status').html(`<span style="color:#f38ba8;">Fail: ${esc(extractErrorMessage(err))}</span>`);
        } finally {
            $btn.prop('disabled', false);
        }
    });

    $('#lpe_import_chat_btn').on('click', () => onImportChat?.());
    $('#lpe_open_editor_btn').on('click', () => onOpenEditor?.());
    $('#lpe_preview_prompt_btn').on('click', () => onPreviewPrompt?.());
    $('#lpe_reread_last_btn').on('click', () => onRereadLast?.());
    $('#lpe_reset_chat_btn').on('click', () => onResetChat?.());
}
