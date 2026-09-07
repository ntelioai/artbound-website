/**
 * EmulatorScenario — parse a scripted WhatsApp scenario (YAML or JSON) into the
 * message shapes the {@link WhatsappEmulator} widget renders, so a business can
 * preview a whole conversation as a static demo (screenshots, proposals) without
 * touching the live bot pipeline.
 *
 * The scenario format is the one documented in
 *   Business Development/…/fatteh-scenario.emulator.yaml
 * — a `scenario:` block with `business`, `customer`, and a `turns:` sequence.
 * Each turn is `{ from: business|customer, kind: <kind>, …fields }`, where the
 * `kind` vocabulary already mirrors the widget's message kinds 1:1.
 *
 * Two entry points:
 *   parseScenario(text)     → raw object (auto-detects YAML vs JSON, throws a
 *                             friendly Error on malformed input)
 *   scenarioToDemo(parsed)  → { business, customer, messages } where `messages`
 *                             are widget-ready message objects (isSent, kind,
 *                             id, timestamp, …).
 *
 * The YAML parser is a focused, dependency-free implementation covering exactly
 * the block-style subset this format uses: mappings, block sequences (including
 * the compact `- key: value` form), block scalars (`|`, `>`, with `-`/`+`/clip
 * chomping), single/double-quoted and plain scalars, single-line flow
 * collections, `#` comments, numbers/booleans/null. Verified against the real
 * scenario file. Not a general-purpose YAML engine — paste JSON if you hit an
 * unsupported construct.
 */

// ─────────────────────────────────────────────────────────────────────────
// YAML (block-style subset) parser
// ─────────────────────────────────────────────────────────────────────────

function indentOf(line) {
    const m = line.match(/^ */)
    return m ? m[0].length : 0
}

// Locate the `:` that separates a mapping key from its value: one followed by a
// space or end-of-line, not inside quotes or a flow collection. Returns -1 when
// the line is not a mapping entry.
function keyColonIndex(str) {
    let quote = null
    let depth = 0
    for (let i = 0; i < str.length; i++) {
        const c = str[i]
        if (quote) {
            if (c === quote) quote = null
            continue
        }
        if (c === '"' || c === "'") { quote = c; continue }
        if (c === '[' || c === '{') { depth++; continue }
        if (c === ']' || c === '}') { if (depth > 0) depth--; continue }
        if (c === '#' && i > 0 && str[i - 1] === ' ') return -1 // comment before any colon
        if (c === ':' && depth === 0) {
            const next = str[i + 1]
            if (next === undefined || next === ' ') return i
        }
    }
    return -1
}

// Strip a trailing ` # comment` from a plain (unquoted, non-flow) scalar.
function stripComment(str) {
    let quote = null
    let depth = 0
    for (let i = 0; i < str.length; i++) {
        const c = str[i]
        if (quote) { if (c === quote) quote = null; continue }
        if (c === '"' || c === "'") { quote = c; continue }
        if (c === '[' || c === '{') { depth++; continue }
        if (c === ']' || c === '}') { if (depth > 0) depth--; continue }
        if (c === '#' && depth === 0 && (i === 0 || str[i - 1] === ' ')) {
            return str.slice(0, i)
        }
    }
    return str
}

function parseYaml(text) {
    // Tabs aren't valid YAML indentation; normalise leading tabs to spaces so a
    // stray copy-paste tab doesn't hard-fail the parse.
    const raw = String(text).replace(/\r\n?/g, '\n').split('\n')
        .map((l) => l.replace(/^\t+/, (t) => '  '.repeat(t.length)))
    let idx = 0

    // Advance idx past blank + comment lines; return the next meaningful line
    // (without consuming it) or null at EOF.
    function peek() {
        while (idx < raw.length) {
            const l = raw[idx]
            if (l.trim() === '' || /^\s*#/.test(l)) { idx++; continue }
            return l
        }
        return null
    }

    function parseNode(minIndent) {
        const l = peek()
        if (l === null) return null
        const ind = indentOf(l)
        if (ind < minIndent) return null
        const body = l.slice(ind)
        if (body === '-' || body.startsWith('- ')) return parseSequence(ind)
        if (keyColonIndex(body) !== -1) return parseMapping(ind)
        // Bare scalar node (e.g. a plain sequence item value).
        idx++
        return parseScalar(body)
    }

    function parseSequence(ind) {
        const items = []
        while (true) {
            const l = peek()
            if (l === null) break
            const curInd = indentOf(l)
            if (curInd !== ind) break
            const body = l.slice(curInd)
            if (body !== '-' && !body.startsWith('- ')) break

            if (body === '-') {
                // Value lives on the following, more-indented lines.
                idx++
                items.push(parseNode(ind + 1))
                continue
            }
            // Compact form: blank out the dash and re-parse the line as the start
            // of this item's block at the content column. This transparently
            // handles `- key: value` (+ sibling keys) and nested sequences.
            const after = body.slice(1) // drop '-'
            const lead = after.match(/^ */)[0].length
            const contentCol = ind + 1 + lead
            raw[idx] = raw[idx].slice(0, ind) + ' ' + raw[idx].slice(ind + 1)
            items.push(parseNode(contentCol))
        }
        return items
    }

    function parseMapping(ind) {
        const obj = {}
        while (true) {
            const l = peek()
            if (l === null) break
            const curInd = indentOf(l)
            if (curInd !== ind) break
            const body = l.slice(curInd)
            const ci = keyColonIndex(body)
            if (ci === -1) break // not a mapping entry at this level

            let key = body.slice(0, ci).trim()
            key = unquote(key)
            const rest = body.slice(ci + 1).trim()
            idx++ // consume the key line

            if (rest === '' ) {
                obj[key] = parseNode(ind + 1)
            } else if (/^[|>][-+]?\d*\s*$/.test(rest)) {
                obj[key] = parseBlockScalar(rest, ind)
            } else {
                obj[key] = parseScalar(rest)
            }
        }
        return obj
    }

    // Block scalar: `|` literal / `>` folded, with `-` strip, `+` keep, or clip
    // (default) chomping. `parentIndent` is the indent of the owning key line;
    // content is any following line more indented than the key (blank lines
    // included as content).
    function parseBlockScalar(indicator, parentIndent) {
        const folded = indicator[0] === '>'
        const chomp = indicator.indexOf('-') !== -1 ? 'strip'
            : indicator.indexOf('+') !== -1 ? 'keep' : 'clip'

        const collected = []
        while (idx < raw.length) {
            const l = raw[idx]
            if (l.trim() === '') { collected.push(''); idx++; continue }
            if (indentOf(l) > parentIndent) { collected.push(l); idx++; continue }
            break
        }
        // Drop trailing blank lines beyond the content (they only matter for
        // chomping, handled below).
        while (collected.length && collected[collected.length - 1] === '') collected.pop()
        if (!collected.length) return ''

        const blockIndent = Math.min(
            ...collected.filter((s) => s !== '').map((s) => indentOf(s))
        )
        const lines = collected.map((s) => (s === '' ? '' : s.slice(blockIndent)))

        let out
        if (folded) {
            out = ''
            for (let i = 0; i < lines.length; i++) {
                const cur = lines[i]
                if (i === 0) { out = cur; continue }
                if (cur === '') out += '\n'
                else if (lines[i - 1] === '') out += cur
                else out += ' ' + cur
            }
        } else {
            out = lines.join('\n')
        }

        if (chomp === 'strip') out = out.replace(/\n+$/, '')
        else if (chomp === 'clip') out = out.replace(/\n+$/, '') + '\n'
        // 'keep' leaves trailing newlines as-is.
        return out
    }

    function parseScalar(str) {
        const s = str.trim()
        if (s === '') return null
        const first = s[0]
        if (first === '"' || first === "'") return unquote(s)
        if (first === '[' || first === '{') return parseFlow(s)
        const plain = stripComment(s).trim()
        if (plain === '' || plain === '~' || plain === 'null' || plain === 'Null' || plain === 'NULL') return null
        if (plain === 'true' || plain === 'True' || plain === 'TRUE') return true
        if (plain === 'false' || plain === 'False' || plain === 'FALSE') return false
        if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(plain)) return Number(plain)
        return plain
    }

    // ── flow collections (single line): [a, b], {k: v, …} ──
    function parseFlow(str) {
        const res = parseFlowValue(str, 0)
        return res.value
    }
    function parseFlowValue(s, i) {
        i = skipWs(s, i)
        if (s[i] === '[') return parseFlowSeq(s, i)
        if (s[i] === '{') return parseFlowMap(s, i)
        return parseFlowScalar(s, i)
    }
    function parseFlowSeq(s, i) {
        const arr = []
        i++ // [
        i = skipWs(s, i)
        if (s[i] === ']') return { value: arr, i: i + 1 }
        while (i < s.length) {
            const r = parseFlowValue(s, i); arr.push(r.value); i = skipWs(s, r.i)
            if (s[i] === ',') { i = skipWs(s, i + 1); continue }
            if (s[i] === ']') { i++; break }
            break
        }
        return { value: arr, i }
    }
    function parseFlowMap(s, i) {
        const obj = {}
        i++ // {
        i = skipWs(s, i)
        if (s[i] === '}') return { value: obj, i: i + 1 }
        while (i < s.length) {
            const k = parseFlowScalar(s, i); i = skipWs(s, k.i)
            let key = k.value
            if (s[i] === ':') i = skipWs(s, i + 1)
            const v = parseFlowValue(s, i); i = skipWs(s, v.i)
            obj[String(key)] = v.value
            if (s[i] === ',') { i = skipWs(s, i + 1); continue }
            if (s[i] === '}') { i++; break }
            break
        }
        return { value: obj, i }
    }
    function parseFlowScalar(s, i) {
        i = skipWs(s, i)
        if (s[i] === '"' || s[i] === "'") {
            const q = s[i]; let j = i + 1; let buf = ''
            while (j < s.length) {
                if (q === '"' && s[j] === '\\') { buf += unescapeDouble(s[j + 1]); j += 2; continue }
                if (s[j] === q) { j++; break }
                buf += s[j]; j++
            }
            return { value: buf, i: j }
        }
        let j = i
        while (j < s.length && ',]}:'.indexOf(s[j]) === -1) j++
        const tok = s.slice(i, j).trim()
        return { value: parseScalar(tok), i: j }
    }
    function skipWs(s, i) { while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++; return i }

    function unescapeDouble(c) {
        switch (c) {
            case 'n': return '\n'
            case 't': return '\t'
            case 'r': return '\r'
            case '"': return '"'
            case '\\': return '\\'
            case '/': return '/'
            case '0': return '\0'
            default: return c || ''
        }
    }

    function unquote(s) {
        s = s.trim()
        if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
            return s.slice(1, -1).replace(/\\(.)/g, (_, c) => unescapeDouble(c))
        }
        if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
            return s.slice(1, -1).replace(/''/g, "'")
        }
        return s
    }

    const result = parseNode(0)
    return result === null ? {} : result
}

/**
 * Parse scenario text. Auto-detects JSON (`{`/`[` first char) vs YAML.
 * @throws {Error} with a human-readable message on malformed input.
 */
export function parseScenario(text) {
    const trimmed = String(text || '').trim()
    if (!trimmed) throw new Error('Scenario is empty — paste or upload a scenario first.')
    if (trimmed[0] === '{' || trimmed[0] === '[') {
        try { return JSON.parse(trimmed) }
        catch (e) { throw new Error('Invalid JSON: ' + e.message) }
    }
    try {
        return parseYaml(trimmed)
    } catch (e) {
        throw new Error('Could not parse scenario: ' + (e && e.message ? e.message : e))
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Scenario → widget messages
// ─────────────────────────────────────────────────────────────────────────

function pick(obj, ...keys) {
    for (const k of keys) {
        if (obj && obj[k] != null && obj[k] !== '') return obj[k]
    }
    return undefined
}

// Normalise a product-ish object (product_list rows, order items) to the shape
// the widget's product/cart rendering expects.
function normProduct(p) {
    return {
        retailerId: pick(p, 'retailerId', 'retailer_id', 'sku', 'id', 'product_retailer_id'),
        name: pick(p, 'name', 'title'),
        price: pick(p, 'price', 'item_price'),
        currency: pick(p, 'currency') || 'USD',
        image: pick(p, 'image', 'image_url', 'imageUrl') || null,
        stock: typeof p.stock === 'number' ? p.stock : undefined,
        description: pick(p, 'description', 'desc') || undefined
    }
}

function normSections(sections, mapper) {
    return (Array.isArray(sections) ? sections : []).map((s) => ({
        title: pick(s, 'title') || '',
        [mapper === 'products' ? 'products' : 'rows']:
            (mapper === 'products'
                ? (s.products || []).map(normProduct)
                : (s.rows || []).map((r) => ({
                    id: pick(r, 'id'),
                    title: pick(r, 'title') || '',
                    description: pick(r, 'description', 'desc') || ''
                })))
    }))
}

/**
 * Clamp a source message down to the quoted preview WhatsApp shows above a
 * tap reply: first line, WA markdown markers stripped, 80 chars — matching
 * what the widget derives from the DOM on a live tap.
 * @param {string} text
 * @returns {string}
 */
function replyPreview(text) {
    return String(text || '')
        .split('\n')[0]
        .replace(/[*_~`]/g, '')
        .trim()
        .slice(0, 80)
}

/**
 * Find the earlier business turn that offered `replyId`, so a scripted tap can
 * quote it. Searches backwards (nearest owner wins) across the three places a
 * tappable id can live: `buttons` (interactive_button/template), `sections[].rows`
 * (interactive_list) and `cards[].buttons` (carousel).
 * @param {object[]} turns
 * @param {number} replyIndex  index of the customer's reply turn
 * @param {string} replyId
 * @returns {{index:number, context:string}|null}
 */
function findReplySource(turns, replyIndex, replyId) {
    if (!replyId) return null
    for (let i = replyIndex - 1; i >= 0; i--) {
        const t = turns[i]
        if (!t || typeof t !== 'object') continue

        const buttons = Array.isArray(t.buttons) ? t.buttons : []
        if (buttons.some((b) => b && pick(b, 'id') === replyId)) {
            return { index: i, context: replyPreview(pick(t, 'body', 'text')) }
        }

        const sections = Array.isArray(t.sections) ? t.sections : []
        for (const s of sections) {
            if ((s?.rows || []).some((r) => r && pick(r, 'id') === replyId)) {
                return { index: i, context: replyPreview(pick(t, 'body', 'text')) }
            }
        }

        // Carousel taps quote the *card*, not the carousel intro.
        const cards = Array.isArray(t.cards) ? t.cards : []
        for (const c of cards) {
            if ((c?.buttons || []).some((b) => b && pick(b, 'id') === replyId)) {
                return { index: i, context: replyPreview(c.text) }
            }
        }
    }
    return null
}

/**
 * Convert one scenario turn into a widget message object.
 * @param {object} turn
 * @param {number} i     turn index (drives stable id + timestamp)
 * @param {number} baseTime  epoch ms for turn 0
 * @returns {object|null} widget message, or null for an unknown/empty turn
 */
function turnToMessage(turn, i, baseTime) {
    if (!turn || typeof turn !== 'object') return null
    const from = String(pick(turn, 'from', 'sender') || 'business').toLowerCase()
    const isSent = from === 'customer' || from === 'user' || from === 'me'
    const kind = String(pick(turn, 'kind', 'type') || 'text').toLowerCase()

    const base = {
        id: 'demo-' + i,
        isSent,
        status: isSent ? 'received' : undefined, // sent → double grey tick, for realism
        timestamp: baseTime + i * 60000,
        // Playback hints (ignored by instant render).
        _playTyping: turn.typing === true,
        _playDelay: typeof turn.delayMs === 'number' ? turn.delayMs : null
    }

    switch (kind) {
        case 'text':
            return { ...base, kind: 'text', text: String(pick(turn, 'text', 'body') || '') }

        case 'interactive_button':
        case 'button':
            return {
                ...base, kind: 'interactive_button',
                header: pick(turn, 'header'),
                body: String(pick(turn, 'body', 'text') || ''),
                footer: pick(turn, 'footer'),
                buttons: (turn.buttons || []).map((b) => ({
                    id: pick(b, 'id') || pick(b, 'title'),
                    title: pick(b, 'title', 'text') || ''
                }))
            }

        case 'interactive_list':
        case 'list':
            return {
                ...base, kind: 'interactive_list',
                header: pick(turn, 'header'),
                body: String(pick(turn, 'body', 'text') || ''),
                footer: pick(turn, 'footer'),
                button: pick(turn, 'button') || 'Open',
                sections: normSections(turn.sections, 'rows')
            }

        case 'interactive_location_request':
        case 'location_request':
            return {
                ...base, kind: 'interactive_location_request',
                body: String(pick(turn, 'body', 'text') || 'Please share your location')
            }

        case 'location':
            return {
                ...base, kind: 'location',
                latitude: Number(pick(turn, 'latitude', 'lat')),
                longitude: Number(pick(turn, 'longitude', 'lng', 'lon')),
                name: pick(turn, 'name'),
                address: pick(turn, 'address')
            }

        // Quick-reply / list selection coming FROM the customer renders as a
        // plain sent bubble showing the chosen title (as WhatsApp does).
        case 'button_reply':
        case 'list_reply':
        case 'reply': {
            const r = turn.reply || turn
            return { ...base, kind: 'text', isSent: true, status: 'received',
                text: String(pick(r, 'title', 'text', 'id') || '') }
        }

        case 'image':
            return { ...base, kind: 'image', url: pick(turn, 'url', 'image', 'image_url'), caption: pick(turn, 'caption') }

        case 'video':
            return {
                ...base, kind: 'video',
                url: pick(turn, 'url', 'video', 'video_url', 'src'),
                // A still to show before the file loads. Without one the bubble
                // is a black rectangle until the user presses play, and poster
                // captures of the journey grab that black rectangle.
                poster: pick(turn, 'poster', 'thumbnail', 'thumb'),
                caption: pick(turn, 'caption')
            }

        case 'document':
            return {
                ...base, kind: 'document',
                url: pick(turn, 'url'),
                filename: pick(turn, 'filename', 'name') || 'document.pdf',
                caption: pick(turn, 'caption')
            }

        case 'product_list':
            return {
                ...base, kind: 'product_list',
                header: pick(turn, 'header'),
                body: String(pick(turn, 'body', 'text') || ''),
                button: pick(turn, 'button') || 'View items',
                sections: normSections(turn.sections, 'products')
            }

        case 'catalog_message':
        case 'catalog': {
            const thumb = turn.thumbnailProduct || turn.thumbnail || null
            return {
                ...base, kind: 'catalog_message',
                body: String(pick(turn, 'body', 'text') || ''),
                footer: pick(turn, 'footer'),
                catalogId: pick(turn, 'catalogId', 'catalog_id') || '',
                thumbnailProduct: thumb ? { image_url: pick(thumb, 'image_url', 'image', 'imageUrl') } : undefined
            }
        }

        case 'order': {
            const items = (turn.product_items || turn.productItems || turn.items || []).map((p) => ({
                retailerId: pick(p, 'product_retailer_id', 'retailerId', 'sku', 'id'),
                name: pick(p, 'name', 'title') || pick(p, 'product_retailer_id', 'sku') || 'Item',
                image: pick(p, 'image', 'image_url') || null,
                price: Number(pick(p, 'item_price', 'price') || 0),
                currency: pick(p, 'currency') || 'USD',
                qty: Number(pick(p, 'quantity', 'qty') || 1)
            }))
            const itemCount = items.reduce((n, e) => n + e.qty, 0)
            const total = items.reduce((s, e) => s + e.price * e.qty, 0)
            return {
                ...base, kind: 'cart_sent', isSent: true, status: 'received',
                itemCount, total,
                currency: items[0] ? items[0].currency : 'USD',
                firstThumb: (items.find((e) => e.image) || {}).image || null,
                catalogId: pick(turn, 'catalogId', 'catalog_id') || '',
                cart: items
            }
        }

        case 'template':
        case 'carousel': {
            // A `cards` array → carousel; otherwise a single template bubble.
            if (Array.isArray(turn.cards) && turn.cards.length) {
                return {
                    ...base, kind: 'carousel',
                    body: pick(turn, 'body'),
                    cards: turn.cards.map((c) => ({
                        image: pick(c, 'image', 'image_url') || null,
                        text: String(pick(c, 'text', 'body') || ''),
                        buttons: (c.buttons || []).map((b) => ({
                            type: pick(b, 'type') || 'quick_reply',
                            id: pick(b, 'id') || pick(b, 'text'),
                            text: pick(b, 'text', 'title') || '',
                            url: pick(b, 'url'),
                            phoneNumber: pick(b, 'phoneNumber', 'phone_number')
                        }))
                    }))
                }
            }
            const hdr = turn.header
            return {
                ...base, kind: 'template',
                header: hdr && typeof hdr === 'object' ? hdr
                    : (hdr ? { type: 'text', text: String(hdr) } : undefined),
                body: String(pick(turn, 'body', 'text') || ''),
                footer: pick(turn, 'footer'),
                buttons: (turn.buttons || []).map((b) => ({
                    type: pick(b, 'type') || 'quick_reply',
                    id: pick(b, 'id') || pick(b, 'text'),
                    text: pick(b, 'text', 'title') || '',
                    url: pick(b, 'url')
                }))
            }
        }

        case 'interactive_flow':
        case 'flow':
            return {
                ...base, kind: 'interactive_flow',
                header: pick(turn, 'header'),
                body: String(pick(turn, 'body', 'text') || ''),
                footer: pick(turn, 'footer'),
                ctaText: pick(turn, 'ctaText', 'cta') || 'Fill form',
                flowToken: pick(turn, 'flowToken') || '',
                flowScreens: turn.flowScreens || turn.screens || []
            }

        default:
            // Unknown kind → best-effort text so nothing is silently dropped.
            return { ...base, kind: 'text', text: String(pick(turn, 'text', 'body') || ('[' + kind + ']')) }
    }
}

/**
 * Convert a parsed scenario into everything the demo needs.
 * @param {object} parsed  output of {@link parseScenario}
 * @returns {{business:object, customer:object, messages:object[]}}
 * @throws {Error} when no turns are found.
 */
export function scenarioToDemo(parsed) {
    const s = (parsed && parsed.scenario) ? parsed.scenario : (parsed || {})
    const turns = s.turns || parsed.turns || []
    if (!Array.isArray(turns) || !turns.length) {
        throw new Error('No `turns` found in the scenario.')
    }

    const b = s.business || parsed.business || {}
    const business = {
        displayName: pick(b, 'displayName', 'name', 'companyName'),
        subtitle: pick(b, 'subtitle', 'tagline'),
        verified: b.verified === true,
        profilePhotoUrl: pick(b, 'displayIcon', 'profilePhotoUrl', 'avatar', 'logo', 'image') || null
    }
    const customer = s.customer || parsed.customer || {}

    const kindOf = (t) => String(pick(t || {}, 'kind', 'type') || '').toLowerCase()
    const isReplyKind = (k) => k === 'list_reply' || k === 'button_reply' || k === 'reply'
    const isMenuKind = (k) => k === 'interactive_list' || k === 'list' || k === 'interactive_button' || k === 'button' || k === 'carousel'

    // Tapping a button/row quotes the message that offered it — WhatsApp shows the
    // source above the reply bubble, and the widget does the same for a live tap.
    // Resolve each scripted reply back to its source so demos match real chats.
    const replySourceByIndex = {}
    turns.forEach((t, i) => {
        if (!t || typeof t !== 'object' || !isReplyKind(kindOf(t))) return
        const src = findReplySource(turns, i, pick(t.reply || t, 'id'))
        if (src) replySourceByIndex[i] = src
    })

    // Link each interactive list/button to the customer turn that selects from it
    // — so the demo can render the menu open with the chosen option highlighted
    // ("selection happened here"), even though real WhatsApp collapses the list
    // after tapping. The tap is usually the next turn, but not always (a carousel
    // can sit between the menu and the tap), so prefer the id-resolved owner.
    const selectionByIndex = {}
    turns.forEach((t, i) => {
        if (!t || typeof t !== 'object' || !isReplyKind(kindOf(t))) return
        const ownerIdx = replySourceByIndex[i] ? replySourceByIndex[i].index : i - 1
        const owner = turns[ownerIdx]
        if (!owner || typeof owner !== 'object' || !isMenuKind(kindOf(owner))) return
        const r = t.reply || t
        selectionByIndex[ownerIdx] = { id: pick(r, 'id'), title: pick(r, 'title', 'text') }
    })

    // Anchor timestamps so the last turn lands near "now" and earlier turns show
    // an ascending time progression.
    const baseTime = Date.now() - turns.length * 60000
    const messages = turns
        .map((t, i) => {
            const m = turnToMessage(t, i, baseTime)
            if (m && selectionByIndex[i]) {
                m.selectedId = selectionByIndex[i].id
                m.selectedTitle = selectionByIndex[i].title
            }
            if (m && replySourceByIndex[i]) m.replyContext = replySourceByIndex[i].context
            return m
        })
        .filter(Boolean)

    return { business, customer, messages }
}
