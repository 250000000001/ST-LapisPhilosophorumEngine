/**
 * SillyTavern Extensions settings drawer UI for Vexa State Engine.
 * Never prefills API keys in source defaults; reads/writes ST extensionSettings.
 */

import { VEXA_THEMES, VEXA_STYLES } from './schema.js';
import { getChatCompletionProfiles } from './st.js';
import { fetchModelsList, extractErrorMessage } from './workerClient.js';
import { DEFAULT_END_MARKER } from './retryDetector.js';

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function syncSettingsUI(s) {
    if (!s || !$('#vse_settings_container').length) return;
    $('#vse_enabled').prop('checked', Boolean(s.enabled));
    $('#vse_force_active').prop('checked', Boolean(s.forceActive));
    $('#vse_scoped').prop('checked', s.scoped !== false);
    $('#vse_worker_transport').val(s.workerTransport || 'direct');
    $('#vse_direct_box').toggle((s.workerTransport || 'direct') === 'direct');
    $('#vse_profile_box').toggle((s.workerTransport || 'direct') === 'profile');
    $('#vse_worker_url').val(s.workerBaseUrl || '');
    $('#vse_worker_key').val(s.workerApiKey || '');
    $('#vse_worker_model').val(s.workerModel || '');
    $('#vse_worker_profile').val(s.workerProfileId || '');
    $('#vse_worker_mode').val(s.workerMode || 'combined');
    $('#vse_worker_max_tokens').val(s.workerMaxTokens || 8192);
    $('#vse_worker_temp').val(s.workerTemperature ?? 0.25);
    $('#vse_hud_theme').val(s.hudTheme || 'Sola');
    $('#vse_hud_style').val(s.hudStyle || 'Afterglow');
    $('#vse_atlas_mode').val(s.atlasViewMode || '3d');
    $('#vse_body_type').val(s.defaultBodyType || 'male');
    $('#vse_show_launcher').prop('checked', s.showLauncherButton !== false);
    $('#vse_hud_collapsed').prop('checked', s.hudDefaultCollapsed !== false);
    $('#vse_pin_rules').prop('checked', s.pinNotebookRules !== false);
    $('#vse_matrix_cap').prop('checked', s.enforceMatrixStepCap !== false);
    $('#vse_allow_tracker_proposals').prop('checked', s.allowTrackerProposals !== false);
    $('#vse_auto_accept_trackers').prop('checked', Boolean(s.autoAcceptTrackerProposals));
    $('#vse_auto_accept_trackers_wrap').toggle(s.allowTrackerProposals !== false);

    const r = s.retry || {};
    $('#vse_retry_enabled').prop('checked', r.enabled !== false);
    $('#vse_retry_options_box').toggle(r.enabled !== false);
    $('#vse_retry_show_nsc').prop('checked', r.showNonStreamContinue !== false);
    $('#vse_retry_require_end').prop('checked', r.requireEndMarker !== false);
    $('#vse_retry_format_mode').val(r.formatMode || 'auto');
    $('#vse_retry_end_marker').val(r.endMarker || DEFAULT_END_MARKER);
    $('#vse_retry_max_incomplete').val(r.maxIncompleteRetries ?? 3);
    $('#vse_retry_max_refusal').val(r.maxRefusalRetries ?? 0);
    $('#vse_retry_delay').val(r.retryDelayMs ?? 300);
    $('#vse_retry_show_toasts').prop('checked', r.showStatusToasts !== false);
    $('#vse_retry_use_modal').prop('checked', r.useModalPopup !== false);
    $('#vse_retry_custom_patterns').val(r.customPatterns || '');
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
    onSettingsChanged,
}) {
    if ($('#vse_settings_container').length) return;
    const $container = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    if (!$container.length) return;

    const s = getSettings();
    const profiles = getChatCompletionProfiles();

    const html = `
        <div id="vse_settings_container" class="vse-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Vexa State Engine (External Worker)</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="vse-btn-wrap" style="margin-bottom:8px;">
                        <button id="vse_open_popup_btn" type="button" class="menu_button" style="width:100%;font-weight:600;">
                            <i class="fa-solid fa-window-maximize"></i> Open Vexa Control Center
                        </button>
                    </div>

                    <label class="checkbox_label" for="vse_enabled">
                        <input id="vse_enabled" type="checkbox" />
                        <span>Enable Vexa State Engine</span>
                    </label>
                    <label class="checkbox_label" for="vse_force_active">
                        <input id="vse_force_active" type="checkbox" />
                        <span>Force active even if preset is not auto-detected as Vexa</span>
                    </label>
                    <label class="checkbox_label" for="vse_scoped">
                        <input id="vse_scoped" type="checkbox" />
                        <span>Smart Scoping (summarize inactive Atlas maps &amp; dormant NPCs in prompt)</span>
                    </label>

                    <hr class="vse-sep" />
                    <div class="vse-sec-title"><i class="fa-solid fa-robot"></i> Secondary Worker API ("Vexa Clerk")</div>

                    <div class="vse-field">
                        <label for="vse_worker_transport">Worker Transport Mode</label>
                        <select id="vse_worker_transport" class="text_pole">
                            <option value="direct">Direct OpenAI-Compatible Endpoint (Base URL + Key + Model)</option>
                            <option value="profile">SillyTavern Connection Profile (Zero-Switch)</option>
                        </select>
                    </div>

                    <div id="vse_direct_box">
                        <div class="vse-field">
                            <label for="vse_worker_url">Base URL (e.g. <code>https://api.openai.com/v1</code>)</label>
                            <input id="vse_worker_url" type="text" class="text_pole" placeholder="https://api.openai.com/v1" />
                        </div>
                        <div class="vse-field">
                            <label for="vse_worker_key">API Key</label>
                            <input id="vse_worker_key" type="password" class="text_pole" autocomplete="off" placeholder="sk-..." />
                        </div>
                        <div class="vse-field">
                            <label for="vse_worker_model">Model ID</label>
                            <div class="vse-inline-row">
                                <input id="vse_worker_model" type="text" class="text_pole" placeholder="deepseek-v4.1-flash / glm-5.3-flash" />
                                <button id="vse_fetch_models_btn" type="button" class="menu_button" title="Fetch models from endpoint"><i class="fa-solid fa-cloud-arrow-down"></i> Fetch</button>
                            </div>
                            <select id="vse_fetched_models" class="text_pole" style="display:none;margin-top:4px;"></select>
                        </div>
                    </div>

                    <div id="vse_profile_box" style="display:none;">
                        <div class="vse-field">
                            <label for="vse_worker_profile">Connection Profile</label>
                            <div class="vse-inline-row">
                                <select id="vse_worker_profile" class="text_pole">
                                    <option value="">-- Select Chat Completion Profile --</option>
                                    ${profiles.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
                                </select>
                                <button id="vse_refresh_profiles_btn" type="button" class="menu_button"><i class="fa-solid fa-rotate"></i></button>
                            </div>
                        </div>
                    </div>

                    <div class="vse-two-col">
                        <div class="vse-field">
                            <label for="vse_worker_mode">Worker Call Mode</label>
                            <select id="vse_worker_mode" class="text_pole">
                                <option value="combined">Combined (1 call / turn)</option>
                                <option value="split">Split (2 calls / turn)</option>
                            </select>
                        </div>
                        <div class="vse-field">
                            <label for="vse_worker_max_tokens">Max Tokens</label>
                            <input id="vse_worker_max_tokens" type="number" min="512" max="32768" step="256" class="text_pole" />
                        </div>
                        <div class="vse-field">
                            <label for="vse_worker_temp">Temperature</label>
                            <input id="vse_worker_temp" type="number" min="0" max="2" step="0.05" class="text_pole" />
                        </div>
                    </div>

                    <div class="vse-inline-row" style="margin-top:6px;">
                        <button id="vse_test_worker_btn" type="button" class="menu_button"><i class="fa-solid fa-vial"></i> Test Worker Connection</button>
                        <span id="vse_test_status" class="vse-muted"></span>
                    </div>

                    <hr class="vse-sep" />
                    <div class="vse-sec-title"><i class="fa-solid fa-palette"></i> Native HUD &amp; Reducer</div>

                    <div class="vse-two-col">
                        <div class="vse-field">
                            <label for="vse_hud_theme">HUD Theme</label>
                            <select id="vse_hud_theme" class="text_pole">
                                ${Object.keys(VEXA_THEMES).map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
                            </select>
                        </div>
                        <div class="vse-field">
                            <label for="vse_hud_style">HUD Style</label>
                            <select id="vse_hud_style" class="text_pole">
                                ${VEXA_STYLES.map((st) => `<option value="${esc(st)}">${esc(st)}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="vse-two-col">
                        <div class="vse-field">
                            <label for="vse_atlas_mode">Default Atlas Renderer</label>
                            <select id="vse_atlas_mode" class="text_pole">
                                <option value="3d">3D CSS (PolyCSS)</option>
                                <option value="2d">2D SVG Floorplan</option>
                            </select>
                        </div>
                        <div class="vse-field">
                            <label for="vse_body_type">Default Body Silhouette</label>
                            <select id="vse_body_type" class="text_pole">
                                <option value="male">Male</option>
                                <option value="female">Female</option>
                                <option value="athletic">Athletic</option>
                                <option value="heavy">Heavy</option>
                            </select>
                        </div>
                    </div>
                    <label class="checkbox_label" for="vse_show_launcher">
                        <input id="vse_show_launcher" type="checkbox" />
                        <span>Show floating launcher button</span>
                    </label>
                    <label class="checkbox_label" for="vse_hud_collapsed">
                        <input id="vse_hud_collapsed" type="checkbox" />
                        <span>Collapse HUD cards by default</span>
                    </label>
                    <label class="checkbox_label" for="vse_pin_rules">
                        <input id="vse_pin_rules" type="checkbox" />
                        <span>Pin <code>[R]</code> OOC rules in Notebook (never evicted at 20-entry cap)</span>
                    </label>
                    <label class="checkbox_label" for="vse_matrix_cap">
                        <input id="vse_matrix_cap" type="checkbox" />
                        <span>Enforce ±2 per-turn Aether Matrix step cap</span>
                    </label>
                    <label class="checkbox_label" for="vse_allow_tracker_proposals">
                        <input id="vse_allow_tracker_proposals" type="checkbox" />
                        <span>Allow main model to propose custom trackers</span>
                    </label>
                    <label id="vse_auto_accept_trackers_wrap" class="checkbox_label" for="vse_auto_accept_trackers" style="padding-left:18px;">
                        <input id="vse_auto_accept_trackers" type="checkbox" />
                        <span>Auto-accept proposed trackers (skip manual approval)</span>
                    </label>

                    <hr class="vse-sep" />
                    <div class="vse-sec-title"><i class="fa-solid fa-shield-halved"></i> Refusal Auto-Retry &amp; Non-Stream Continue</div>
                    <label class="checkbox_label" for="vse_retry_enabled">
                        <input id="vse_retry_enabled" type="checkbox" />
                        <span>Enable built-in Refusal Auto-Retry &amp; End-Marker Guard</span>
                    </label>
                    <div id="vse_retry_options_box" class="vse-retry-box">
                        <label class="checkbox_label" for="vse_retry_show_nsc">
                            <input id="vse_retry_show_nsc" type="checkbox" />
                            <span>Show “Continue (No Stream)” send-bar button &amp; Options item</span>
                        </label>
                        <label class="checkbox_label" for="vse_retry_require_end">
                            <input id="vse_retry_require_end" type="checkbox" />
                            <span>Require reply to end with end marker (Non-Stream retry)</span>
                        </label>
                        <div class="vse-field">
                            <label for="vse_retry_format_mode">End-marker validation mode</label>
                            <select id="vse_retry_format_mode" class="text_pole">
                                <option value="auto">Auto-detect (&lt;vexa_tail&gt; or &lt;internal_states&gt; + GFX_END)</option>
                                <option value="external">External State (&lt;vexa_tail&gt; + GFX_END required)</option>
                                <option value="classic">Classic (&lt;internal_states&gt; + GFX_END required)</option>
                                <option value="marker">Marker Only (trailing GFX_END / custom marker)</option>
                            </select>
                        </div>
                        <div class="vse-field">
                            <label for="vse_retry_end_marker">Required end marker</label>
                            <input id="vse_retry_end_marker" type="text" class="text_pole" />
                        </div>
                        <div class="vse-two-col">
                            <div class="vse-field">
                                <label for="vse_retry_max_incomplete">Max incomplete retries</label>
                                <input id="vse_retry_max_incomplete" type="number" min="0" max="20" step="1" class="text_pole" />
                            </div>
                            <div class="vse-field">
                                <label for="vse_retry_max_refusal">Max refusal retries (0=unlimited)</label>
                                <input id="vse_retry_max_refusal" type="number" min="0" max="50" step="1" class="text_pole" />
                            </div>
                            <div class="vse-field">
                                <label for="vse_retry_delay">Retry delay (ms)</label>
                                <input id="vse_retry_delay" type="number" min="0" max="10000" step="50" class="text_pole" />
                            </div>
                        </div>
                        <label class="checkbox_label" for="vse_retry_show_toasts">
                            <input id="vse_retry_show_toasts" type="checkbox" />
                            <span>Show toast notification on each retry</span>
                        </label>
                        <label class="checkbox_label" for="vse_retry_use_modal">
                            <input id="vse_retry_use_modal" type="checkbox" />
                            <span>Show modal popup on max failures</span>
                        </label>
                        <div class="vse-field">
                            <label for="vse_retry_custom_patterns">Custom refusal patterns <small>(plain text or <code>/regex/i</code>, one per line)</small></label>
                            <textarea id="vse_retry_custom_patterns" class="text_pole textarea_compact" rows="3" placeholder="I am Gemini Enterprise&#10;/cannot participate in .* roleplay/i"></textarea>
                        </div>
                        <div class="vse-btn-wrap">
                            <button id="vse_retry_clean_last_btn" type="button" class="menu_button"><i class="fa-solid fa-broom"></i> Clean Refusal From Last Reply</button>
                        </div>
                    </div>

                    <hr class="vse-sep" />
                    <div class="vse-sec-title"><i class="fa-solid fa-wrench"></i> Chat Tools</div>
                    <div class="vse-btn-wrap">
                        <button id="vse_import_chat_btn" type="button" class="menu_button"><i class="fa-solid fa-file-import"></i> Import Chat States</button>
                        <button id="vse_open_editor_btn" type="button" class="menu_button"><i class="fa-solid fa-pen-to-square"></i> Edit State</button>
                        <button id="vse_preview_prompt_btn" type="button" class="menu_button"><i class="fa-solid fa-eye"></i> Preview Snapshot</button>
                        <button id="vse_reread_last_btn" type="button" class="menu_button"><i class="fa-solid fa-rotate"></i> Re-read Last</button>
                        <button id="vse_reset_chat_btn" type="button" class="menu_button"><i class="fa-solid fa-trash"></i> Reset Chat State</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $container.append(html);

    function syncTransportVisibility() {
        const mode = $('#vse_worker_transport').val();
        $('#vse_direct_box').toggle(mode === 'direct');
        $('#vse_profile_box').toggle(mode === 'profile');
    }

    $('#vse_enabled').prop('checked', Boolean(s.enabled));
    $('#vse_force_active').prop('checked', Boolean(s.forceActive));
    $('#vse_scoped').prop('checked', s.scoped !== false);
    $('#vse_worker_transport').val(s.workerTransport || 'direct');
    $('#vse_worker_url').val(s.workerBaseUrl || '');
    $('#vse_worker_key').val(s.workerApiKey || '');
    $('#vse_worker_model').val(s.workerModel || '');
    $('#vse_worker_profile').val(s.workerProfileId || '');
    $('#vse_worker_mode').val(s.workerMode || 'combined');
    $('#vse_worker_max_tokens').val(s.workerMaxTokens || 8192);
    $('#vse_worker_temp').val(s.workerTemperature ?? 0.25);
    $('#vse_hud_theme').val(s.hudTheme || 'Sola');
    $('#vse_hud_style').val(s.hudStyle || 'Afterglow');
    $('#vse_atlas_mode').val(s.atlasViewMode || '3d');
    $('#vse_body_type').val(s.defaultBodyType || 'male');
    $('#vse_show_launcher').prop('checked', s.showLauncherButton !== false);
    $('#vse_hud_collapsed').prop('checked', s.hudDefaultCollapsed !== false);
    $('#vse_pin_rules').prop('checked', s.pinNotebookRules !== false);
    $('#vse_matrix_cap').prop('checked', s.enforceMatrixStepCap !== false);
    $('#vse_allow_tracker_proposals').prop('checked', s.allowTrackerProposals !== false);
    $('#vse_auto_accept_trackers').prop('checked', Boolean(s.autoAcceptTrackerProposals));
    $('#vse_auto_accept_trackers_wrap').toggle(s.allowTrackerProposals !== false);
    syncTransportVisibility();

    const r = s.retry || {};
    function syncRetryVisibility() {
        $('#vse_retry_options_box').toggle($('#vse_retry_enabled').prop('checked'));
    }
    $('#vse_retry_enabled').prop('checked', r.enabled !== false);
    $('#vse_retry_show_nsc').prop('checked', r.showNonStreamContinue !== false);
    $('#vse_retry_require_end').prop('checked', r.requireEndMarker !== false);
    $('#vse_retry_format_mode').val(r.formatMode || 'auto');
    $('#vse_retry_end_marker').val(r.endMarker || DEFAULT_END_MARKER);
    $('#vse_retry_max_incomplete').val(r.maxIncompleteRetries ?? 3);
    $('#vse_retry_max_refusal').val(r.maxRefusalRetries ?? 0);
    $('#vse_retry_delay').val(r.retryDelayMs ?? 300);
    $('#vse_retry_show_toasts').prop('checked', r.showStatusToasts !== false);
    $('#vse_retry_use_modal').prop('checked', r.useModalPopup !== false);
    $('#vse_retry_custom_patterns').val(r.customPatterns || '');
    syncRetryVisibility();

    $('#vse_enabled').on('change', function () { getSettings().enabled = $(this).prop('checked'); saveSettings(); onSettingsChanged?.(); });
    $('#vse_force_active').on('change', function () { getSettings().forceActive = $(this).prop('checked'); saveSettings(); onSettingsChanged?.(); });
    $('#vse_scoped').on('change', function () { getSettings().scoped = $(this).prop('checked'); saveSettings(); onSettingsChanged?.(); });
    $('#vse_worker_transport').on('change', function () { getSettings().workerTransport = $(this).val(); syncTransportVisibility(); saveSettings(); onSettingsChanged?.(); });
    $('#vse_worker_url').on('input change', function () { getSettings().workerBaseUrl = String($(this).val() ?? '').trim(); saveSettings(); onSettingsChanged?.(); });
    $('#vse_worker_key').on('input change', function () { getSettings().workerApiKey = String($(this).val() ?? '').trim(); saveSettings(); onSettingsChanged?.(); });
    $('#vse_worker_model').on('input change', function () { getSettings().workerModel = String($(this).val() ?? '').trim(); saveSettings(); onSettingsChanged?.(); });
    $('#vse_worker_profile').on('change', function () { getSettings().workerProfileId = String($(this).val() ?? ''); saveSettings(); onSettingsChanged?.(); });
    $('#vse_worker_mode').on('change', function () { getSettings().workerMode = $(this).val(); saveSettings(); onSettingsChanged?.(); });
    $('#vse_worker_max_tokens').on('change', function () { getSettings().workerMaxTokens = Math.max(256, parseInt($(this).val(), 10) || 8192); saveSettings(); onSettingsChanged?.(); });
    $('#vse_worker_temp').on('change', function () { getSettings().workerTemperature = Number($(this).val()) || 0.25; saveSettings(); onSettingsChanged?.(); });
    $('#vse_hud_theme').on('change', function () { getSettings().hudTheme = $(this).val(); saveSettings(); onSettingsChanged?.(); });
    $('#vse_hud_style').on('change', function () { getSettings().hudStyle = $(this).val(); saveSettings(); onSettingsChanged?.(); });
    $('#vse_atlas_mode').on('change', function () { getSettings().atlasViewMode = $(this).val(); saveSettings(); onSettingsChanged?.(); });
    $('#vse_body_type').on('change', function () { getSettings().defaultBodyType = $(this).val(); saveSettings(); onSettingsChanged?.(); });
    $('#vse_show_launcher').on('change', function () { getSettings().showLauncherButton = $(this).prop('checked'); saveSettings(); onSettingsChanged?.(); });
    $('#vse_hud_collapsed').on('change', function () { getSettings().hudDefaultCollapsed = $(this).prop('checked'); saveSettings(); onSettingsChanged?.(); });
    $('#vse_open_popup_btn').on('click', () => onOpenPopup?.());
    $('#vse_pin_rules').on('change', function () { getSettings().pinNotebookRules = $(this).prop('checked'); saveSettings(); onSettingsChanged?.(); });
    $('#vse_matrix_cap').on('change', function () { getSettings().enforceMatrixStepCap = $(this).prop('checked'); saveSettings(); onSettingsChanged?.(); });
    $('#vse_allow_tracker_proposals').on('change', function () {
        const allow = Boolean($(this).prop('checked'));
        getSettings().allowTrackerProposals = allow;
        $('#vse_auto_accept_trackers_wrap').toggle(allow);
        saveSettings();
        onSettingsChanged?.();
    });
    $('#vse_auto_accept_trackers').on('change', function () {
        getSettings().autoAcceptTrackerProposals = Boolean($(this).prop('checked'));
        saveSettings();
        onSettingsChanged?.();
    });

    const retryCfg = () => {
        const st = getSettings();
        if (!st.retry || typeof st.retry !== 'object') st.retry = {};
        return st.retry;
    };
    $('#vse_retry_enabled').on('change', function () {
        retryCfg().enabled = Boolean($(this).prop('checked'));
        syncRetryVisibility();
        saveSettings();
        onRetryToggleChanged?.();
    });
    $('#vse_retry_show_nsc').on('change', function () {
        retryCfg().showNonStreamContinue = Boolean($(this).prop('checked'));
        saveSettings();
        onRetryToggleChanged?.();
    });
    $('#vse_retry_require_end').on('change', function () {
        retryCfg().requireEndMarker = Boolean($(this).prop('checked'));
        saveSettings();
        onSettingsChanged?.();
    });
    $('#vse_retry_format_mode').on('change', function () {
        retryCfg().formatMode = String($(this).val() || 'auto');
        saveSettings();
        onSettingsChanged?.();
    });
    $('#vse_retry_end_marker').on('input change', function () {
        retryCfg().endMarker = String($(this).val() ?? '') || DEFAULT_END_MARKER;
        saveSettings();
        onSettingsChanged?.();
    });
    $('#vse_retry_max_incomplete').on('input change', function () {
        const parsed = parseInt(String($(this).val()), 10);
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 20) {
            retryCfg().maxIncompleteRetries = parsed;
            saveSettings();
            onSettingsChanged?.();
        }
    });
    $('#vse_retry_max_refusal').on('input change', function () {
        const parsed = parseInt(String($(this).val()), 10);
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 50) {
            retryCfg().maxRefusalRetries = parsed;
            saveSettings();
            onSettingsChanged?.();
        }
    });
    $('#vse_retry_delay').on('input change', function () {
        const parsed = parseInt(String($(this).val()), 10);
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 10000) {
            retryCfg().retryDelayMs = parsed;
            saveSettings();
            onSettingsChanged?.();
        }
    });
    $('#vse_retry_show_toasts').on('change', function () {
        retryCfg().showStatusToasts = Boolean($(this).prop('checked'));
        saveSettings();
        onSettingsChanged?.();
    });
    $('#vse_retry_use_modal').on('change', function () {
        retryCfg().useModalPopup = Boolean($(this).prop('checked'));
        saveSettings();
        onSettingsChanged?.();
    });
    $('#vse_retry_custom_patterns').on('input change', function () {
        retryCfg().customPatterns = String($(this).val() ?? '');
        saveSettings();
        onSettingsChanged?.();
    });
    $('#vse_retry_clean_last_btn').on('click', () => onCleanLastRefusal?.());

    $('#vse_refresh_profiles_btn').on('click', () => {
        const list = getChatCompletionProfiles();
        const cur = getSettings().workerProfileId || '';
        $('#vse_worker_profile').html(`<option value="">-- Select Chat Completion Profile --</option>${list.map((p) => `<option value="${esc(p.id)}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`);
    });

    $('#vse_fetch_models_btn').on('click', async function () {
        const $btn = $(this);
        $btn.prop('disabled', true);
        $('#vse_test_status').text('Fetching models...');
        try {
            const st = getSettings();
            const list = await fetchModelsList({ baseUrl: st.workerBaseUrl, apiKey: st.workerApiKey, ctx: getContextSafe() });
            const $sel = $('#vse_fetched_models');
            $sel.html(`<option value="">-- Pick fetched model (${list.length}) --</option>${list.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}`).show();
            $('#vse_test_status').text(`Loaded ${list.length} models.`);
        } catch (err) {
            $('#vse_test_status').text(extractErrorMessage(err));
        } finally {
            $btn.prop('disabled', false);
        }
    });

    $('#vse_fetched_models').on('change', function () {
        const val = $(this).val();
        if (val) {
            $('#vse_worker_model').val(val).trigger('change');
        }
    });

    $('#vse_test_worker_btn').on('click', async function () {
        const $btn = $(this);
        $btn.prop('disabled', true);
        $('#vse_test_status').text('Testing...');
        try {
            const ans = await workerClient.testConnection();
            $('#vse_test_status').html(`<span style="color:#a6e3a1;">OK: ${esc(ans.slice(0, 60))}</span>`);
        } catch (err) {
            $('#vse_test_status').html(`<span style="color:#f38ba8;">Fail: ${esc(extractErrorMessage(err))}</span>`);
        } finally {
            $btn.prop('disabled', false);
        }
    });

    $('#vse_import_chat_btn').on('click', () => onImportChat?.());
    $('#vse_open_editor_btn').on('click', () => onOpenEditor?.());
    $('#vse_preview_prompt_btn').on('click', () => onPreviewPrompt?.());
    $('#vse_reread_last_btn').on('click', () => onRereadLast?.());
    $('#vse_reset_chat_btn').on('click', () => onResetChat?.());
}
