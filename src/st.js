/**
 * SillyTavern runtime shim for Lapis Philosophorum Engine (LPE).
 */

export function getContextSafe() {
    try {
        return window.SillyTavern?.getContext?.() || {};
    } catch {
        return {};
    }
}

export function saveSettingsDebounced() {
    const ctx = getContextSafe();
    ctx.saveSettingsDebounced?.();
}

export function saveMetadataDebounced() {
    const ctx = getContextSafe();
    ctx.saveMetadataDebounced?.();
}

export function saveChatDebounced() {
    const ctx = getContextSafe();
    if (typeof ctx.saveChat === 'function') {
        ctx.saveChat();
    } else {
        ctx.saveChatConditional?.();
    }
}

export function substituteParams(text) {
    const ctx = getContextSafe();
    if (typeof ctx.substituteParams === 'function') {
        try { return ctx.substituteParams(text); } catch { return text; }
    }
    return text;
}

export function getChatCompletionProfiles() {
    const ctx = getContextSafe();
    const profiles = ctx.extensionSettings?.connectionManager?.profiles;
    if (!Array.isArray(profiles)) return [];
    return profiles
        .filter((p) => p && p.mode !== 'tc')
        .map((p) => ({ id: p.id, name: p.name || p.id, mode: p.mode }));
}

export function getCurrentPresetName() {
    try {
        const sel = document.getElementById('settings_preset_openai');
        if (sel && sel.selectedIndex >= 0) {
            return sel.options[sel.selectedIndex]?.text?.trim() || '';
        }
    } catch {
        // Ignore DOM unavailable
    }
    return '';
}

export function getActiveCharacterCardHint() {
    const ctx = getContextSafe();
    const parts = [];
    try {
        const ch = ctx.characters?.[ctx.characterId];
        if (ch) {
            if (ch.name) parts.push(`Character: ${ch.name}`);
            if (ch.description) parts.push(`Description: ${String(ch.description).slice(0, 1200)}`);
            if (ch.personality) parts.push(`Personality: ${String(ch.personality).slice(0, 600)}`);
            if (ch.scenario) parts.push(`Scenario: ${String(ch.scenario).slice(0, 600)}`);
        }
        const persona = substituteParams('{{persona}}');
        if (persona && persona !== '{{persona}}' && persona.trim()) {
            parts.push(`User Persona: ${String(persona).slice(0, 600)}`);
        }
    } catch {
        // Ignore
    }
    return parts.join('\n');
}
