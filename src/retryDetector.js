/**
 * Refusal detection, GFX_END end-marker validation, and surgical
 * safety-declaration removal for Lapis Philosophorum Engine (LPE).
 *
 * Pure ES module with zero DOM dependencies so it can be unit-tested directly.
 */

export const DEFAULT_END_MARKER = '<!--\u2800GFX_END\u2800-->';
export const DEFAULT_FAILURE_MESSAGE = 'Too many failures, please check you preset/input';
export const LPE_FORMAT_MODES = Object.freeze(['auto', 'external', 'classic', 'marker']);
export const VEXA_FORMAT_MODES = LPE_FORMAT_MODES;

/**
 * Built-in refusal anchor rules.
 *
 * Each rule specifies:
 *   - id: unique identifier
 *   - regex: global/case-insensitive pattern locating the refusal anchor
 *   - allowInQuotes: if false (default), matches that begin inside a quoted
 *     dialogue span on the same line are ignored to avoid false positives in
 *     fictional character speech.
 */
export const REFUSAL_RULES = [
    // 1. Explicit Gemini / Gemini Enterprise / AI self-identification refusals
    {
        id: 'gemini_identity_refusal',
        allowInQuotes: true,
        regex: /\bI(?:'m|’m|\s+am)\s+Gemini(?:\s+(?:Enterprise|Advanced|Pro|Ultra|Flash))?,?\s+(?:and\s+)?I\s+(?:cannot|can['’]t|will\s+not|won['’]t|do\s+not|don['’]t|am\s+unable\s+to|['’]m\s+unable\s+to|must\s+decline|have\s+to\s+decline)\b/gi,
    },
    {
        id: 'ai_identity_refusal',
        allowInQuotes: true,
        regex: /\b(?:As\s+(?:a\s+Gemini(?:\s+model)?|Gemini(?:\s+Enterprise)?|an\s+AI(?:\s+(?:language\s+)?model|\s+assistant)?|a\s+(?:large\s+)?language\s+model|a\s+text-based\s+AI),?\s+(?:I\s+(?:cannot|can['’]t|will\s+not|won['’]t|do\s+not|don['’]t|am\s+unable\s+to|['’]m\s+unable\s+to|must\s+decline|have\s+to\s+decline)|that\s+is\s+outside\s+of\s+my\s+capabilities)|I(?:'m|’m|\s+am)\s+(?:just\s+)?(?:a\s+(?:large\s+)?language\s+model|an\s+AI(?:\s+assistant)?|a\s+text-based\s+AI)[,.]?\s+(?:(?:so|and)\s+)?(?:I\s+(?:cannot|can['’]t|am\s+unable|won['’]t|don['’]t)|that\s+is\s+outside)|I(?:'m|’m|\s+am)\s+programmed\s+to\s+be\s+a\s+helpful\s+and\s+harmless\s+AI)\b/gi,
    },

    // 2. Direct refusal referencing explicit/adult/NSFW/policy/roleplay/state blocks
    {
        id: 'policy_topic_refusal',
        allowInQuotes: false,
        regex: /\b(?:(?:I(?:'m|’m|\s+am)\s+sorry|I\s+apologize|Sorry),?\s+(?:but\s+)?)?I\s+(?:cannot|can['’]t|will\s+not|won['’]t|do\s+not|don['’]t|am\s+unable\s+to|['’]m\s+unable\s+to|must\s+decline\s+to|have\s+to\s+decline\s+to)\s+(?:fulfill|complete|comply\s+with|process|assist\s+with|help\s+with|proceed\s+with|engage\s+in|participate\s+in|continue(?:\s+with)?|generate|create|write|produce|provide|depict|describe)[^\n]{0,180}?\b(?:sexually\s+explicit|explicit\s+(?:adult|sexual|romantic|content|material|scenes?|roleplay|scenarios?|details?)|romantic\s+or\s+sexually\s+explicit|adult\s+(?:content|roleplay|scenarios?|themes?)|erotic(?:a|\s+roleplay|\s+content|\s+scenarios?)?|pornograph\w*|nsfw|non-?consensual|sexual\s+content|graphic\s+(?:violence|gore|sexual)|(?:state\s+blocks?|lpe_tail|lpe_receipt|vexa_tail|vexa_receipt|internal_states)\s+containing\s+explicit|even\s+in\s+(?:a\s+)?fictional\s+(?:roleplay|context|setting|scenarios?)|(?:safety|content|usage|ethical|community)\s+(?:guidelines|policies|policy|standards|principles|boundaries|restrictions))\b/gi,
    },

    // 3. Direct meta-refusal of response / request / roleplay / state block
    {
        id: 'meta_response_refusal',
        allowInQuotes: false,
        regex: /\b(?:(?:I(?:'m|’m|\s+am)\s+sorry|I\s+apologize|Sorry),?\s+(?:but\s+)?)?I\s+(?:cannot|can['’]t|will\s+not|won['’]t|am\s+unable\s+to|['’]m\s+unable\s+to)\s+(?:fulfill\s+(?:this|your|that)\s+request|continue\s+this\s+response|generate\s+its\s+state\s+block|continue\s+(?:this\s+)?(?:roleplay|scenario|narrative|story)\s+(?:because|as|since|in\s+this\s+direction)|(?:assist|help|comply)\s+with\s+(?:this|that|your)\s+request)\b/gi,
    },

    // 4. Policy violation / safety guidelines statements
    {
        id: 'policy_violation_statement',
        allowInQuotes: true,
        regex: /\b(?:(?:This|Your|The)\s+(?:request|prompt|input|content|scenario|roleplay)\s+(?:violates|goes\s+against|conflicts\s+with|triggers|breaches)\s+(?:my|our|the)?\s*(?:safety|content|usage|ethical)?\s*(?:guidelines|policies|policy|filters|standards|boundaries|terms)|My\s+(?:safety|content|ethical)\s+(?:guidelines|policies|principles|programming|boundaries)\s+(?:prevent|prohibit|do\s+not\s+allow|don['’]t\s+allow|restrict))\b/gi,
    },

    // 5. Short standalone polite refusal (only when not inside dialogue quotes & at paragraph/chunk boundary)
    {
        id: 'standalone_polite_refusal',
        allowInQuotes: false,
        requireCleanBoundary: true,
        regex: /(?:I(?:'m|’m|\s+am)\s+sorry|I\s+apologize),?\s+(?:but\s+)?I\s+(?:cannot|can['’]t|am\s+unable\s+to|['’]m\s+unable\s+to)\s+(?:assist|help|comply|continue|proceed)\s+with\s+(?:that|this)(?:\s+(?:request|scenario|roleplay|content))?[.!]?(?=\s*(?:$|\n|---|###|\*\*|If\s+you\s+would\s+like|However,|Let\s+me\s+know))/gi,
    },

    // 6. Structured refusal heading followed by refusal/safe-alternatives boilerplate
    {
        id: 'structured_refusal_heading',
        allowInQuotes: true,
        regex: /#{1,6}\s*(?:[^\w\n]{0,6}\s*)?(?:Request\s+Status|Content\s+Policy\s+Notice|Safety\s+Notice|Policy\s+Notice|Moderation\s+Notice|Unable\s+to\s+Continue)\b[\s\S]{0,400}?\b(?:cannot|can['’]t|unable\s+to|non-?explicit|non-?romantic|Safe\s+Ways\s+to\s+Continue|Available\s+Alternatives|safety\s+guidelines|content\s+policy)\b/gi,
    },

    // 7. API / proxy / safety-filter boilerplate markers
    {
        id: 'api_filter_marker',
        allowInQuotes: true,
        regex: /\[(?:PROHIBITED_CONTENT|SAFETY|BLOCKED|FILTERED|CONTENT_FILTER|REFUSAL|RECITATION|BLOCKLIST)\]|\b(?:Response|Content|Message|Output|Generation)\s+(?:was\s+)?(?:blocked|filtered|halted|stopped|refused)\s+(?:by|due\s+to)\s+(?:safety|content\s+filter|policy|moderation|PROHIBITED_CONTENT|SAFETY)\b|\bFinish\s+reason\s*:\s*(?:SAFETY|PROHIBITED_CONTENT|BLOCKLIST|SPII|IMAGE_SAFETY|CONTENT_FILTER)\b/gi,
    },

    // 8. Multilingual (Chinese / Japanese) common Gemini / AI refusals
    {
        id: 'zh_ai_refusal',
        allowInQuotes: false,
        regex: /(?:(?:抱歉|对不起)[，,]?\s*)?(?:作为(?:一名|一个)?(?:AI|人工智能|大型?语言模型)|我是\s*Gemini(?:\s*Enterprise)?)[^。\n]{0,60}?(?:无法|不能|不会)(?:继续|生成|满足|协助|参与|创作|提供)[^。\n]{0,80}?(?:请求|回复|内容|色情|成人|露骨|暴力|安全|政策|准则|角色扮演|场景)|(?:抱歉|对不起)[，,]?\s*我(?:无法|不能)(?:继续|生成|参与|提供)[^。\n]{0,60}?(?:露骨|色情|成人|性相关|违背安全|违反(?:安全|内容)?政策)/gi,
    },
    {
        id: 'ja_ai_refusal',
        allowInQuotes: false,
        regex: /(?:(?:申し訳ありませんが|恐れ入りますが)[、,]?\s*)?(?:私は\s*Gemini(?:\s*Enterprise)?|AI(?:言語)?モデルとして)[^。\n]{0,60}?(?:できません|応じられません|続行できません|生成できません)|(?:申し訳ありませんが|恐れ入りますが)[、,]?\s*(?:露骨な|性的な|成人向け|安全なガイドライン|コンテンツポリシー)[^。\n]{0,60}?(?:できません|応じられません|続行できません|生成できません)/gi,
    },
];

const PREAMBLE_LINE_PATTERNS = [
    /#{1,6}[ \t]*(?:[^\w\s\n]{1,6}[ \t]*)*(?:Request\s+Status|Response\s+Status|Status\s+Update|Content\s+(?:Policy\s+)?Notice|Safety\s+Notice|Policy\s+Notice|Moderation\s+Notice|Important\s+Notice|Notice|Warning|Refusal|Unable\s+to\s+Continue|Content\s+Warning)\b[^\n]*$/i,
    /\*\*[ \t]*(?:[^\w\s\n]{1,6}[ \t]*)*(?:Request\s+Status|Response\s+Status|Content\s+(?:Policy\s+)?Notice|Safety\s+Notice|Policy\s+Notice|Moderation\s+Notice|Important\s+Notice|Notice|Warning|Refusal|Unable\s+to\s+Continue)[^*\n]*\*\*:?[ \t]*$/i,
    /(?:^|\n)[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/,
];

/**
 * Strip trailing standard whitespace AND Braille Pattern Blank (`U+2800`)
 * used as non-breaking spacing around markers.
 *
 * @param {string} text
 * @returns {string}
 */
export function trimEndWithBraille(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/[\s\u2800]+$/g, '');
}

/**
 * Check whether `text` ends with the required end marker (default `<!--⠀GFX_END⠀-->`).
 * Accepts either Braille Pattern Blank (`\u2800`) or regular ASCII whitespace
 * around `GFX_END` when using the default marker, or matches a custom literal/regex.
 *
 * Supports both LPE External State (`<lpe_tail>...</lpe_tail>` and legacy `<vexa_tail>...</vexa_tail>`)
 * and classic `<internal_states>...</internal_states>`, and guards against replies that stopped
 * immediately after an inline mid-prose GFX card before emitting the terminal tail/state.
 *
 * @param {string} text
 * @param {string} [marker]
 * @param {{ formatMode?: 'auto' | 'external' | 'classic' | 'marker' }} [options]
 * @returns {boolean}
 */
export function endsWithRequiredMarker(text, marker = DEFAULT_END_MARKER, options = {}) {
    if (typeof text !== 'string') return false;

    const trimmed = trimEndWithBraille(text);
    if (trimmed.length === 0) return false;

    const effective = (typeof marker === 'string' && marker.trim().length > 0)
        ? marker.trim()
        : DEFAULT_END_MARKER;
    const formatMode = LPE_FORMAT_MODES.includes(options?.formatMode) ? options.formatMode : 'auto';

    // Custom /regex/flags syntax
    const slashMatch = effective.match(/^\/(.+)\/([imsuy]*)$/);
    if (slashMatch) {
        try {
            const re = new RegExp(`(?:${slashMatch[1]})$`, slashMatch[2]);
            return re.test(trimmed);
        } catch {
            // Fall through to literal check
        }
    }

    // Default GFX_END marker: tolerate both U+2800 and standard spaces inside the comment
    const normalizedMarker = effective.replace(/[\s\u2800]+/g, ' ');
    if (normalizedMarker === '<!-- GFX_END -->' || normalizedMarker === '<!--GFX_END-->') {
        const endMatch = trimmed.match(/<!--[\s\u2800]*GFX_END[\s\u2800]*-->$/);
        if (!endMatch) return false;

        if (formatMode === 'marker') return true;

        const normBeforeEnd = trimmed.slice(0, endMatch.index).replace(/\u2800/g, ' ').trimEnd();
        const endsWithExternalTail = /<\/(?:lpe|vexa)_tail\s*>$/i.test(normBeforeEnd);
        const endsWithInternalStates = /<\/internal_states\s*>$/i.test(normBeforeEnd);

        if (formatMode === 'external') return endsWithExternalTail;
        if (formatMode === 'classic') return endsWithInternalStates;

        if (/<internal_states\b/i.test(normBeforeEnd)) return endsWithInternalStates;
        if (/<(?:lpe|vexa)_tail\b/i.test(normBeforeEnd)) return endsWithExternalTail;

        // Reject truncation right after an inline mid-prose GFX card (<!-- GFX_START --> ... <!-- GFX_END -->)
        const lastGfxStart = normBeforeEnd.search(/<!--\s*GFX_START\s*-->(?![\s\S]*<!--\s*GFX_START\s*-->)/i);
        if (lastGfxStart >= 0) {
            const cardFragment = normBeforeEnd.slice(lastGfxStart);
            if (!/<(?:internal_states|(?:lpe|vexa)_tail)\b/i.test(cardFragment)) return false;
        }
        return true;
    }

    return trimmed.endsWith(effective);
}

/**
 * Parse user-supplied custom refusal patterns (one per line).
 * Supports `/regex/flags` syntax or plain case-insensitive substrings.
 *
 * @param {string} rawText
 * @returns {Array<{id: string, regex: RegExp, allowInQuotes: boolean}>}
 */
export function parseCustomPatterns(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];

    const rules = [];
    const lines = rawText.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('//')) continue;

        let regex = null;
        const slashMatch = line.match(/^\/(.+)\/([gimsuy]*)$/);
        if (slashMatch) {
            try {
                const flags = slashMatch[2].includes('g') ? slashMatch[2] : `${slashMatch[2]}g`;
                regex = new RegExp(slashMatch[1], flags);
            } catch {
                continue;
            }
        } else {
            const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            regex = new RegExp(escaped, 'gi');
        }

        rules.push({
            id: `custom_${i + 1}`,
            regex,
            allowInQuotes: true,
        });
    }

    return rules;
}

function isInsideDialogueQuote(text, index) {
    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    const beforeOnLine = text.slice(lineStart, index);

    const openCurly = (beforeOnLine.match(/[“「『]/g) || []).length;
    const closeCurly = (beforeOnLine.match(/[”」』]/g) || []).length;
    if (openCurly > closeCurly) return true;

    const straightQuotes = (beforeOnLine.match(/"/g) || []).length;
    if (straightQuotes % 2 === 1) return true;

    return false;
}

function isCleanBoundary(text, index, searchStart) {
    if (index <= searchStart) return true;
    const before = text.slice(searchStart, index);
    if (before.trim().length === 0) return true;
    return /(?:^|\n|[.!?]["'”’)\]]*)[ \t\u2800]*$/.test(before);
}

export function expandRefusalStart(text, anchorStart, searchStart = 0) {
    let cutIndex = Math.max(searchStart, anchorStart);

    for (let pass = 0; pass < 4; pass++) {
        let probe = cutIndex;
        while (probe > searchStart && /[ \t\r\n\u2800]/.test(text[probe - 1])) {
            probe--;
        }

        const prefix = text.slice(searchStart, probe).replace(/\u2800/g, ' ');
        let expanded = false;

        for (const pattern of PREAMBLE_LINE_PATTERNS) {
            const m = prefix.match(pattern);
            if (m && typeof m.index === 'number') {
                const matchPos = searchStart + m.index;
                cutIndex = Math.max(searchStart, matchPos);
                expanded = true;
                break;
            }
        }

        if (!expanded) {
            break;
        }
    }

    while (cutIndex > searchStart && /[ \t\r\n\u2800]/.test(text[cutIndex - 1])) {
        cutIndex--;
    }

    return cutIndex;
}

export function detectRefusal(text, options = {}) {
    if (typeof text !== 'string' || text.length === 0) {
        return {
            matched: false,
            ruleId: null,
            matchStart: -1,
            anchorStart: -1,
            removedText: '',
            cleanedText: typeof text === 'string' ? text : '',
        };
    }

    const searchStart = Math.max(0, Math.min(options.searchStart ?? 0, text.length));
    const slice = text.slice(searchStart);
    const normalizedSlice = slice.replace(/\u2800/g, ' ');

    if (normalizedSlice.trim().length === 0) {
        return {
            matched: false,
            ruleId: null,
            matchStart: -1,
            anchorStart: -1,
            removedText: '',
            cleanedText: text,
        };
    }

    const rules = [
        ...REFUSAL_RULES,
        ...parseCustomPatterns(options.customPatterns || ''),
    ];

    let earliestAnchor = Infinity;
    let earliestRuleId = null;

    for (const rule of rules) {
        const re = new RegExp(rule.regex.source, rule.regex.flags.includes('g') ? rule.regex.flags : `${rule.regex.flags}g`);
        let m;
        while ((m = re.exec(normalizedSlice)) !== null) {
            if (m[0].length === 0) {
                re.lastIndex++;
                continue;
            }

            const absIndex = searchStart + m.index;

            if (!rule.allowInQuotes && isInsideDialogueQuote(text, absIndex)) {
                continue;
            }

            if (rule.requireCleanBoundary && !isCleanBoundary(text, absIndex, searchStart)) {
                continue;
            }

            if (absIndex < earliestAnchor) {
                earliestAnchor = absIndex;
                earliestRuleId = rule.id;
            }
            break;
        }
    }

    if (earliestAnchor === Infinity) {
        return {
            matched: false,
            ruleId: null,
            matchStart: -1,
            anchorStart: -1,
            removedText: '',
            cleanedText: text,
        };
    }

    const matchStart = expandRefusalStart(text, earliestAnchor, searchStart);
    const cleanedText = text.slice(0, matchStart);
    const removedText = text.slice(matchStart);

    return {
        matched: true,
        ruleId: earliestRuleId,
        matchStart,
        anchorStart: earliestAnchor,
        removedText,
        cleanedText,
    };
}
