/**
 * WhatsappEmulator — ntelioUI2 chat Widget that talks to the local Node
 * emulator backend. Replaces the legacy jQuery WhatsappSimulator in
 * cartaja-website/client_modules/ntelioChatbot/lib/WhatsappEmulator.js.
 *
 * @extends Widget
 * @category Chat
 *
 * @example
 * // Single-store mode
 * import { WhatsappEmulator } from './widgets/WhatsappEmulator.js'
 * new WhatsappEmulator({
 *     // Single base URL for the Node emulator — REST, WebSocket, and media all
 *     // derive from this. https → wss automatically.
 *     wabaEmulator: 'https://emulator.ntelio.ai',
 *     companyName: 'Demo Shop',
 *     // The WABA business-account avatar shown in the chat header next to the
 *     // company name. Falls back to two-letter company initials when omitted.
 *     profilePhotoUrl: 'https://cdn.example.com/logo.png',
 *     phoneNumber: '15551234567', // wa_id sent to CommerceGenie — identifies the user
 *     profileName: 'Jane Doe',
 *     // Optional: tap-to-send conversation starters shown above the input
 *     // when the chat is empty. Strings or { label, text } objects.
 *     icebreakers: ['help', { label: 'Browse menu', text: 'menu' }]
 * }).appendTo('#app')
 *
 * @example
 * // Stores mode — renders a WhatsApp-style chats list first; tapping a row
 * // enters that store's chat. Each store carries the same shape as the
 * // single-store params above, plus a required `id`.
 * new WhatsappEmulator({
 *     wabaEmulator: 'https://emulator.ntelio.ai',
 *     stores: [
 *         {
 *             id: 'vitalite',
 *             companyName: 'Vitalite',
 *             profilePhotoUrl: 'https://cdn.example.com/vitalite.png',
 *             phoneNumber: '99001112222',
 *             phoneNumberId: '700000001',
 *             useCase: 'vitalite',
 *             icebreakers: [{ label: 'Browse menu', text: 'menu' }],
 *             commerceGenieApiUrl: 'https://api.scriptrapps.io',
 *             commerceGenieApiToken: '…',
 *             whatsappBotKey: 'whatsapp-bot'
 *         },
 *         { id: 'beirut-burgers', companyName: 'Beirut Burgers', phoneNumber: '99002223333', … }
 *     ]
 * }).appendTo('#app')
 */

// ─────────────────────────────────────────────────────────────────────────
// PROVENANCE: vendored from the WhatsAppEmulator repo
//   source of truth: /Volumes/dev/WhatsAppEmulator/widgets/WhatsappEmulator.js
// Only change vs. source is the ntelioUI2 import path below (one extra `../`
// because this copy lives in client/widgets/, not the repo's widgets/). Both
// ntelioUI2 copies are byte-identical, so the widget runs on CG's framework.
// Re-vendor (re-copy + re-apply this path fix) when the source widget changes.
// ─────────────────────────────────────────────────────────────────────────
import { Widget } from '../../client_modules/ntelioUI2/core/Widget.js'

const $ = window.jQuery || window.$

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

// Render WhatsApp markdown to safe HTML.
// Order matters: code blocks first (protect contents), then inline, then newlines.

function formatWAText(raw) {
    let s = escapeHtml(raw)
    // ```code block```
    s = s.replace(/```([\s\S]*?)```/g, '<pre class="nui-wa-code-block"><code>$1</code></pre>')
    // `inline code`
    s = s.replace(/`([^`\n]+)`/g, '<code class="nui-wa-code">$1</code>')
    // **bold** (markdown) — handle before single-* so no stray asterisks remain
    s = s.replace(/\*\*((?!\s)[^*\n]+(?<!\s))\*\*/g, '<strong>$1</strong>')
    // *bold* (WhatsApp)
    s = s.replace(/\*((?!\s)[^*\n]+(?<!\s))\*/g, '<strong>$1</strong>')
    // _italic_
    s = s.replace(/_((?!\s)[^_\n]+(?<!\s))_/g, '<em>$1</em>')
    // ~strikethrough~
    s = s.replace(/~((?!\s)[^~\n]+(?<!\s))~/g, '<del>$1</del>')
    // newlines → <br>
    s = s.replace(/\n/g, '<br>')
    return s
}


const _currencySymbols = { USD: '$', EUR: '€', GBP: '£', AED: 'د.إ', LBP: 'ل.ل', SAR: '﷼', CAD: 'CA$', AUD: 'A$' }
function formatPrice(price, currency) {
    const sym = _currencySymbols[currency] || (currency ? currency + ' ' : '')
    const num = parseFloat(price)
    return sym + (isNaN(num) ? price : num.toFixed(2))
}

function formatTime(ts) {
    const d = new Date(ts)
    return d.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true })
}

// WhatsApp-style read receipts: single check = pending, double check = server received.
// Returns empty for incoming messages.
function statusChecksHtml(m) {
    if (!m.isSent) return ''
    const icon = m.status === 'received' ? 'fa-check-double' : 'fa-check'
    return ` <i class="fas ${icon} nui-wa-status-check"></i>`
}

// Slippy map tile coords for a given lat/lng/zoom (standard OSM formula).
function latLngToTileXY(lat, lng, zoom) {
    const n = 2 ** zoom
    const x = Math.floor((lng + 180) / 360 * n)
    const latRad = lat * Math.PI / 180
    const y = Math.floor(
        (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
    )
    return { x, y }
}

// Compact WhatsApp-style timestamp used in the chats-list rows: same-day
// shows the time, last week shows the weekday, anything older shows the date.
function formatChatTime(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    }
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
    if ((now - d) < 7 * 24 * 60 * 60 * 1000) {
        return d.toLocaleDateString([], { weekday: 'short' })
    }
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' })
}

// Single-line preview of a message for the chats-list row. Strips WA markdown
// and prefixes outgoing messages with "You:" to mirror native WhatsApp.
function previewFromMessage(m) {
    if (!m) return ''
    const prefix = m.isSent ? 'You: ' : ''
    const strip = (s) => String(s || '').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim()
    if (m.kind === 'text') return prefix + strip(m.text).slice(0, 80)
    if (m.kind === 'image') return prefix + 'Photo'
    if (m.kind === 'video') return prefix + 'Video'
    if (m.kind === 'document') return prefix + 'Document'
    if (m.kind === 'location') return prefix + 'Location'
    if (m.kind === 'cart_sent') return prefix + 'Order'
    if (m.kind === 'interactive_button' || m.kind === 'interactive_list' || m.kind === 'interactive_cta_url') {
        return strip(m.body).slice(0, 80)
    }
    if (m.kind === 'product_list') return strip(m.body || m.header || 'Products').slice(0, 80)
    if (m.kind === 'catalog_message') return strip(m.body || 'Catalog').slice(0, 80)
    if (m.kind === 'carousel') return strip(m.body || (m.cards || [])[0]?.text || '').slice(0, 80)
    if (m.kind === 'template') return strip(m.body || m.templateName || 'Template').slice(0, 80)
    if (m.kind === 'interactive_flow') return strip(m.body || m.ctaText || 'Form').slice(0, 80)
    if (m.kind === 'interactive_location_request') return strip(m.body || 'Location request').slice(0, 80)
    return strip(m.text).slice(0, 80)
}

export class WhatsappEmulator extends Widget {
    static template = `
        <div class="nui-wa-container">
            <div class="nui-wa-header">
                <button type="button" class="nui-wa-back-btn" aria-label="Back" style="display:none">
                    <i class="fas fa-arrow-left"></i>
                </button>
                <div class="nui-wa-profile-photo">{{profilePhoto}}</div>
                <div class="nui-wa-user-info">
                    <h5>{{companyName}}</h5>
                    <p><span class="nui-wa-status-dot"></span><span class="nui-wa-status-text">connecting…</span></p>
                </div>
                <div class="nui-wa-header-icons">
                    <!-- Reset-chat trashcan — sits to the left of the store icon
                         and wipes the current conversation when tapped. Coloured
                         distinctly (--nui-wa-danger, defaults to cartaja's crimson)
                         so the destructive intent reads at a glance. -->
                    <i class="fas fa-trash-can nui-wa-header-reset" role="button" aria-label="Reset chat" tabindex="0"></i>
                    <i class="fas fa-store nui-wa-header-shop"></i>
                    <!-- Phone-call icon. Defaults to a disabled visual until the
                         host opts in via callEnabled:true (feature lands in a
                         future widget release). The is-disabled class is toggled
                         in init based on the constructor flag. -->
                    <i class="fas fa-phone nui-wa-header-call" title="Not available"></i>
                </div>
            </div>
            <div class="nui-wa-messages"></div>
            <div class="nui-wa-icebreakers" style="display:none"></div>
            <div class="nui-wa-input">
                <i class="far fa-plus" title="Not available"></i>
                <textarea rows="1" placeholder="Type a message"></textarea>
                <i class="fas fa-microphone nui-wa-input-mic is-disabled" title="Not available"></i>
                <button type="button" class="nui-wa-input-send" aria-label="Send" style="display:none">
                    <svg class="nui-wa-send-svg" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path transform="translate(0,-289.0625)" d="m 25.5,304.0625 c 0,-1.11962 -1,-1.5 -1,-1.5 l -20,-8 3.60352,8.56055 L 17.5,304.0625 8.10352,305.00195 4.5,313.5625 l 20,-8 c 0,0 1,-0.38038 1,-1.5 z"/></svg>
                </button>
            </div>
            <button type="button" class="nui-wa-floating-cart" aria-label="View cart" style="display:none">
                <i class="fas fa-shopping-cart"></i>
                <span class="nui-wa-floating-cart-badge">0</span>
            </button>
            <div class="nui-wa-overlay" style="display:none"></div>
            <div class="nui-wa-chats-screen" style="display:none">
                <div class="nui-wa-chats-header">
                    <h1 class="nui-wa-chats-title">Chats</h1>
                    <div class="nui-wa-chats-header-actions">
                        <!-- Help "?" — plain icon matching the trashcan's style
                             exactly (same Font Awesome family, same size, cartaja
                             crimson via --nui-wa-danger). Hidden by default; the
                             host enables it by passing onHelp(). -->
                        <i class="fas fa-circle-question nui-wa-help-btn" role="button" aria-label="Help" tabindex="0" style="display:none"></i>
                        <!-- Camera + new-chat — permanently disabled placeholders,
                             rendered identically to the in-chat phone icon
                             (opacity 0.32 + not-allowed cursor via .is-disabled). -->
                        <i class="fas fa-camera is-disabled" aria-label="Camera" title="Not available"></i>
                        <i class="fas fa-pen-to-square is-disabled" aria-label="New chat" title="Not available"></i>
                    </div>
                </div>
                <div class="nui-wa-chats-search">
                    <i class="fas fa-search nui-wa-chats-search-icon"></i>
                    <input type="text" class="nui-wa-chats-search-input" placeholder="Ask Meta AI or Search">
                </div>
                <div class="nui-wa-chats-list"></div>
                <nav class="nui-wa-chats-tabs" aria-label="WhatsApp tabs">
                    <button type="button" class="nui-wa-chats-tab" data-tab="updates" title="Not available">
                        <span class="nui-wa-chats-tab-icon"><i class="fas fa-circle-notch"></i></span>
                        <span class="nui-wa-chats-tab-label">Updates</span>
                    </button>
                    <button type="button" class="nui-wa-chats-tab" data-tab="calls" title="Not available">
                        <span class="nui-wa-chats-tab-icon"><i class="fas fa-phone"></i></span>
                        <span class="nui-wa-chats-tab-label">Calls</span>
                    </button>
                    <button type="button" class="nui-wa-chats-tab" data-tab="communities" title="Not available">
                        <span class="nui-wa-chats-tab-icon"><i class="fas fa-people-group"></i></span>
                        <span class="nui-wa-chats-tab-label">Communities</span>
                    </button>
                    <button type="button" class="nui-wa-chats-tab is-active" data-tab="chats">
                        <span class="nui-wa-chats-tab-icon"><i class="fas fa-comment-dots"></i></span>
                        <span class="nui-wa-chats-tab-label">Chats</span>
                    </button>
                    <button type="button" class="nui-wa-chats-tab" data-tab="settings" title="Not available">
                        <span class="nui-wa-chats-tab-icon"><i class="fas fa-gear"></i></span>
                        <span class="nui-wa-chats-tab-label">Settings</span>
                    </button>
                </nav>
            </div>
        </div>
    `

    constructor(params = {}) {
        // Stores-mode: when an array of store configs is passed, render a
        // WhatsApp-style chats list first. The user picks a store to enter the
        // chat. Each store carries its own companyName, phoneNumber (session
        // id), useCase, icebreakers, and CommerceGenie routing config — the
        // same shape the single-store params take below.
        const stores = Array.isArray(params.stores) ? params.stores.filter((s) => s && s.id) : []
        const storesMode = stores.length > 0

        const companyName = params.companyName || 'CommerceGenie'
        const initials = companyName
            .split(/\s+/)
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()
        const profilePhoto = params.profilePhotoUrl
            ? `<img src="${escapeHtml(params.profilePhotoUrl)}" alt="${escapeHtml(companyName)}" />`
            : escapeHtml(initials)

        super({
            template: WhatsappEmulator.template,
            companyName: escapeHtml(companyName),
            profilePhoto,
            state: {
                messages: [],
                isTyping: false,
                connected: false,
                // `phoneNumber` is sent as the WABA `from` / `wa_id` and is what
                // CommerceGenie keys the conversation session by. When not provided
                // we synthesize a demo-only id — production use must pass a real number.
                // In stores-mode it stays empty until the user picks a store.
                phoneNumber: storesMode ? '' : (params.phoneNumber || ('demo-' + Math.random().toString(36).slice(2, 10)))
            },
            autoInit: false
        })

        this._storesMode = storesMode
        this.stores = stores
        this._activeStoreId = null
        // Optional host callback: when provided, the chats screen shows a
        // grey-circle "?" help button next to the Chats title that invokes
        // this callback on click. Pass `onHelp: fn` to enable.
        this._onHelp = typeof params.onHelp === 'function' ? params.onHelp : null
        // Label shown in the trashcan-reset tooltip. Hosts can pass a
        // localised string; defaults to "Reset chat".
        this._resetLabel = (typeof params.resetLabel === 'string' && params.resetLabel)
            ? params.resetLabel
            : 'Reset chat'
        // In-chat call feature flag. Defaults to disabled (icon renders
        // muted + not-allowed). Set callEnabled:true at instantiation time
        // when the feature ships to surface the icon at full strength.
        this._callEnabled = (params.callEnabled === true)

        this.wabaEmulator = (params.wabaEmulator || 'http://localhost:3001').replace(/\/$/, '')
        this.wsUrl = this.wabaEmulator.replace(/^http/, 'ws') + '/ws'
        this.profileName = params.profileName || 'Demo User'
        // Conversation-starter chips shown above the input on an empty chat.
        // Strings act as both label and text; objects can split them so the chip
        // label can be friendlier than the keyword that the bot actually matches.
        // No defaults — pass an array to enable, omit to disable.
        this.icebreakers = (params.icebreakers || [])
            .map((ib) => typeof ib === 'string' ? { label: ib, text: ib } : ib)
            .filter((ib) => ib && ib.text)
        // Optional WABA-routing fields. Ignored by the FakeBot loopback;
        // forwarded to the backend so a future `forward` mode can route
        // inbound webhooks to the right downstream bot by phoneNumberId.
        this.useCase = params.useCase || null
        this.phoneNumberId = params.phoneNumberId || null
        // Optional CommerceGenie connection config. When provided, forwarded to
        // the emulator server per-request so it can override its .env values.
        this.commerceGenieApiUrl = params.commerceGenieApiUrl || null
        this.commerceGenieApiToken = params.commerceGenieApiToken || null
        this.whatsappBotKey = params.whatsappBotKey || null
        // Backend transport: 'node' (default) talks to the external Node emulator
        // service via REST + WebSocket (used by cartaja-website, unchanged).
        // 'scriptr' talks to the logged-in CommerceGenie account directly — catalog
        // from the public storefront API, chat via the account's own emulator
        // handlers + a Scriptr pub/sub channel. This branch is CommerceGenie-only
        // and lives solely in this vendored copy so the source widget (cartaja)
        // is unaffected.
        this._backend = params.backend === 'scriptr' ? 'scriptr' : 'node'
        // CommerceGenie-only: static "demo" mode. Renders a scripted transcript
        // (see EmulatorScenario) as a read-only conversation — no backend, no WS,
        // no history persistence. Used by the Emulator page's scenario player so a
        // business can preview / screenshot a whole conversation before going live.
        // `demoMessages` are widget-ready message objects; `demoAutoplay` reveals
        // them one-by-one with typing indicators instead of all at once.
        this._demo = params.demo === true
        this._demoMessages = Array.isArray(params.demoMessages) ? params.demoMessages : []
        this._demoAutoplay = params.demoAutoplay === true
        // Optional initial number of visible messages for manual stepping
        // (Prev/Next). null → show the whole transcript at once.
        this._demoStart = (typeof params.demoStart === 'number') ? params.demoStart : null
        // Autoplay pacing. Both are opt-in and their defaults reproduce the
        // original cadence exactly, so callers that don't set them (the admin
        // Emulator page) are unaffected.
        //   demoPace         multiplies every delay (2 = half speed)
        //   demoDwellPerChar ms of extra pause after a message, per unit of
        //                    "read weight" (see _demoReadWeight). 0 = the old
        //                    fixed dwell, which gave a 12-product carousel the
        //                    same 350ms as a three-word reply.
        this._demoPace = (typeof params.demoPace === 'number' && params.demoPace > 0)
            ? params.demoPace : 1
        this._demoDwellPerChar = (typeof params.demoDwellPerChar === 'number' && params.demoDwellPerChar >= 0)
            ? params.demoDwellPerChar : 0
        this._demoVisible = null
        this._businessSubtitle = params.businessSubtitle || null
        this._businessVerified = params.businessVerified === true
        this._demoTimer = null
        // Autoplay transport: the remaining messages, whether the loop is live,
        // and an optional { visible, total, playing } callback fired after every
        // revealed message and when playback stops — so a host page can drive a
        // live counter and a play/pause button without polling.
        this._demoQueue = null
        // Set here rather than in init() so demoPosition() is already truthful
        // for a host page that renders its transport before the first reveal.
        this._demoPlaying = this._demo && this._demoAutoplay && this._demoMessages.length > 0
        this._onDemoUpdate = (typeof params.onDemoUpdate === 'function') ? params.onDemoUpdate : null
        this._renderedIds = new Set()
        this._cart = storesMode ? { cartItems: [], cartIndex: new Map(), catalogId: '' } : this._loadCart()
        this._ws = null
        this._reconnectTimer = null
        // Scriptr pub/sub channel reconnect (RTM idles the socket out) + the
        // per-turn "still waiting for a reply" flag that drives the synchronous
        // fallback render when the ephemeral channel misses a reply.
        this._scriptrReconnectTimer = null
        this._pendingReply = false
        // phoneNumber → { ws, timer } — old WS connections kept open briefly so
        // any in-flight bot reply can still arrive after the user switches stores.
        this._bgWs = new Map()
        // Set to true by tearDownEmulator before DOM removal so any still-running
        // async init() or in-flight WS/fetch handlers stop touching localStorage.
        this._cancelled = false

        // Resolve media against the emulator base so the chat backdrop loads when the
        // Node server is on a different origin than the static page (Cloudflare Pages
        // + AWS-hosted emulator behind a tunnel). Set synchronously, before the node
        // is appended to the DOM, so the browser never tries the bare /emulator/media
        // path against the static host.
        this.node.css(
            '--wa-bg-image',
            `url("${this.wabaEmulator}/emulator/media/cartaja-backdrop-whatsapp.png")`
        )

        // Gracefully handle broken images anywhere in the chat (catalog media that
        // 404s, expired CDN links, etc.). `error` events don't bubble, but they do
        // fire in the capture phase, so one root-level listener covers every
        // product/catalog/media <img> — swap the broken image for the same
        // box icon the no-image branches already use, instead of leaving the
        // browser's broken-image glyph + alt text.
        this.node[0].addEventListener('error', function (e) {
            const el = e.target
            if (el && el.tagName === 'IMG' && !el.dataset.waFallback) {
                el.dataset.waFallback = '1'
                const icon = document.createElement('i')
                icon.className = 'fas fa-box-open nui-wa-img-fallback'
                if (el.parentNode) el.replaceWith(icon)
            }
        }, true)

        this._ready = Promise.resolve(this.init()).then(() => { if (!this._cancelled) this.render() })
    }

    /**
     * Inject a message as if it were received from the business — used by the
     * "Preview in emulator" action in the Message editor. Pure client-side: no
     * WABA call, no pub/sub; it routes through the same _handleWsEvent dispatch
     * the live channel uses, so the bubble renders identically. Waits for the
     * widget's own init (which loads history) so the preview isn't clobbered.
     */
    previewInbound(message) {
        return (this._ready || Promise.resolve()).then(() => {
            if (this._cancelled) return
            this._handleWsEvent({ type: 'message', message: message })
        })
    }

    // ─── History persistence ──────────────────────────────────────

    _historyKey() {
        return 'cartaja-chat-history::' + this.state.phoneNumber
    }

    _loadHistory() {
        try {
            const raw = localStorage.getItem(this._historyKey())
            return raw ? JSON.parse(raw) : []
        } catch (e) { return [] }
    }

    _saveHistory(messages) {
        try {
            localStorage.setItem(this._historyKey(), JSON.stringify(messages.slice(-200)))
        } catch (e) {}
    }

    // ─── Cart persistence ─────────────────────────────────────────

    _cartKey() {
        return 'cartaja-cart::' + this.state.phoneNumber
    }

    _loadCart() {
        try {
            const raw = localStorage.getItem(this._cartKey())
            // Single shared cart. catalogId tracks the most recent catalog the cart
            // was edited from, so the floating-cart button can submit the order to
            // the right catalog when reopened outside any product-list modal.
            if (!raw) return { cartItems: [], cartIndex: new Map(), catalogId: '' }
            const parsed = JSON.parse(raw)
            return {
                cartItems: parsed.cartItems || [],
                cartIndex: new Map(parsed.cartIndex || []),
                catalogId: parsed.catalogId || ''
            }
        } catch (e) {
            return { cartItems: [], cartIndex: new Map(), catalogId: '' }
        }
    }

    _saveCart() {
        try {
            const { cartItems, cartIndex, catalogId } = this._cart
            localStorage.setItem(this._cartKey(), JSON.stringify({
                cartItems,
                cartIndex: [...cartIndex.entries()],
                catalogId
            }))
        } catch (e) {}
    }

    async init() {
        await Widget.loadCss('./whatsapp-emulator.css', import.meta.url)
        if (this._cancelled) return

        const $input = this.find('.nui-wa-input textarea')
        const $micBtn = this.find('.nui-wa-input-mic')
        const $sendBtn = this.find('.nui-wa-input-send')
        const autoResize = () => {
            const el = $input[0]
            el.style.height = 'auto'
            el.style.height = el.scrollHeight + 'px'
        }
        // Toggle the mic (idle) vs the send button (typing) based on whether
        // the textarea has content. WhatsApp's exact UX.
        const updateInputBtn = () => {
            const hasText = ($input.val() || '').trim().length > 0
            $micBtn.toggle(!hasText)
            $sendBtn.toggle(hasText)
        }
        const submitFromInput = () => {
            const text = ($input.val() || '').trim()
            if (!text) return
            $input.val('')
            autoResize()
            updateInputBtn()
            this._sendUserText(text)
        }
        $input.on('input', () => { autoResize(); updateInputBtn() })
        $input.on('keydown', (e) => {
            // Enter sends; Shift+Enter inserts a newline (default browser behavior).
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submitFromInput()
            }
        })
        $sendBtn.on('click', submitFromInput)

        const $shopBtn = this.find('.nui-wa-header-shop')
        $shopBtn.hide()
        $shopBtn.on('click', () => this._openHeaderCatalog())

        // Trashcan reset — wipes the current conversation and re-shows
        // welcome + icebreakers. Also emits 'reset' for hosts that need to
        // do extra cleanup (e.g., regenerating a session id). The
        // `data-tip` attribute drives the CSS hover tooltip.
        this.find('.nui-wa-header-reset')
            .attr('data-tip', this._resetLabel)
            .on('click', () => {
                this._clearConversation()
                this.emit('reset')
            })

        // Phone-call icon: enable/disable based on the constructor flag.
        // Disabled state is the default — the click handler is intentionally
        // not bound until the feature is live; toggling the class is enough
        // to switch the visual.
        const $call = this.find('.nui-wa-header-call')
        if (this._callEnabled) {
            $call.removeClass('is-disabled').removeAttr('title')
        } else {
            $call.addClass('is-disabled').attr('title', 'Not available')
        }

        this.find('.nui-wa-floating-cart').on('click', () => this._openFloatingCart())

        // Video bubbles ship without `controls` so nothing but the frame shows at
        // rest — WhatsApp puts a single round play button over the video, not a
        // browser control strip below it. First tap swaps in the native controls
        // (which paint ON TOP of the frame) and starts playback; the overlay
        // button retires. Delegated: message DOM is re-rendered per journey turn.
        this.find('.nui-wa-messages').on('click', '.nui-wa-video-play', (e) => {
            const $wrap = $(e.currentTarget).closest('.nui-wa-video-wrap')
            const video = $wrap.find('video.nui-wa-video')[0]
            if (!video) return
            $wrap.addClass('is-playing')
            video.controls = true
            video.play().catch(() => {})
        })

        // Back button — only meaningful in stores-mode. Returns to the chats list.
        this.find('.nui-wa-back-btn').on('click', () => this._exitToChatsList())

        if (this._demo) {
            // Static transcript: no WS, no history, no catalog fetch. Present the
            // header as a connected business chat and drop the destructive/live
            // affordances that don't make sense for a scripted preview.
            this.state.connected = true
            this.find('.nui-wa-header-reset').hide()   // reset would wipe the transcript
            this.find('.nui-wa-header-call').hide()
            if (this._businessVerified) {
                this.find('.nui-wa-user-info h5')
                    .append(' <i class="fas fa-circle-check nui-wa-verified" aria-label="Verified business"></i>')
            }
            if (this._demoAutoplay && this._demoMessages.length) {
                this._demoQueue = this._demoMessages.slice()
                this._demoPlaying = true
                this._demoStep()
            } else {
                // Stepped (Prev/Next) starts at demoStart; otherwise show all.
                const start = (this._demoStart != null) ? this._demoStart : this._demoMessages.length
                this._demoVisible = Math.max(0, Math.min(this._demoMessages.length, start))
                this.state.messages = this._demoMessages.slice(0, this._demoVisible)
            }
            return
        }

        if (this._storesMode) {
            // Stores-mode boot: show the chats list, defer WS / history / catalog
            // loading until the user picks a store.
            this._showChatsScreen()
            return
        }

        // Single-store mode: restore persisted history, refresh cart, connect WS.
        const saved = this._loadHistory()
        if (saved.length) {
            this.state.messages = saved
            // If the last message was sent by the user with no bot reply yet,
            // show the typing dots so they persist across use-case switches.
            const lastMsg = saved[saved.length - 1]
            if (lastMsg && lastMsg.isSent) {
                this._showTypingWhileWaiting()
            }
        }

        this._refreshFloatingCart()
        this._refreshShopButton()
        this._connectWs()
    }

    // Re-check the per-store catalog and show the storefront button only when
    // products exist. Extracted from init() so _enterStore() can reuse it
    // when switching between stores.
    _refreshShopButton() {
        const $shopBtn = this.find('.nui-wa-header-shop')
        $shopBtn.hide()
        this._fetchCatalogProducts()
            .then(products => {
                if (this._cancelled) return
                if (products.length > 0) $shopBtn.show()
            })
            .catch(() => {})
    }

    /**
     * Fetch the catalog products for the active store, returning a normalized
     * array of { retailer_id, name, price, currency, image_url }.
     *
     * - node mode: the external emulator's /emulator/catalog/products.
     * - scriptr mode: the account's PUBLIC storefront API directly (no emulator
     *   service), mapping product documents → the same shape. This is what shows
     *   the user's REAL catalog with valid image URLs.
     */
    async _fetchCatalogProducts() {
        if (this._backend === 'scriptr') {
            if (!this.commerceGenieApiUrl) return []
            const base = this.commerceGenieApiUrl.replace(/\/+$/, '')
            const url = base + '/ntelioMiddleware/server/public/api/app/v1/storefront?resultsPerPage=50'
            // Send the token even though the endpoint is public: in multi-tenant
            // mode the API host is api.scriptrapps.io and the bearer is what routes
            // the request to this account AND returns the CORS header. Without it
            // the call is a cross-origin 400 with no Access-Control-Allow-Origin.
            const headers = this.commerceGenieApiToken ? { Authorization: 'Bearer ' + this.commerceGenieApiToken } : {}
            const res = await fetch(url, { headers })
            if (!res.ok) return []
            const data = await res.json()
            const docs = (data && data.result && data.result.documents)
                || (data && data.response && data.response.result && data.response.result.documents)
                || []
            return docs.map(d => ({
                retailer_id: d.sku || d.key,
                name: d.name || d.title || d.sku || d.key,
                price: d.price != null ? String(d.price) : null,
                currency: d.currency || 'USD',
                image_url: d.image_url || d.imageUrl || null
            })).filter(p => p.retailer_id)
        }
        const qs = new URLSearchParams()
        if (this.commerceGenieApiToken) qs.set('token', this.commerceGenieApiToken)
        if (this.useCase) qs.set('useCase', this.useCase)
        if (this.commerceGenieApiUrl) qs.set('apiUrl', this.commerceGenieApiUrl)
        const res = await fetch(this.wabaEmulator + '/emulator/catalog/products' + (qs.toString() ? '?' + qs.toString() : ''))
        const data = await res.json()
        return data.products || []
    }

    async _openHeaderCatalog() {
        const $loader = $(`
            <div class="nui-wa-inline-loader">
                <div class="nui-wa-spinner"></div>
                <div class="nui-wa-inline-loader-label">Loading catalog…</div>
            </div>
        `).appendTo(this.node)
        try {
            const products = (await this._fetchCatalogProducts()).map(p => ({
                retailerId: p.retailer_id,
                name: p.name,
                price: p.price,
                currency: p.currency,
                image: p.image_url
            }))
            this._openProductListModal({
                catalogId: 'EMULATOR_CATALOG',
                header: 'Catalog',
                sections: [{ products }]
            })
        } catch (e) {
            console.error('[WhatsappEmulator] header catalog load failed', e)
        } finally {
            $loader.remove()
        }
    }

    render() {
        // In stores-mode, the chats list is its own screen and the chat surface
        // is only meaningful once a store is active. Skip the chat-side renders
        // until the user enters a store to avoid scrollToBottom + typing-dots
        // churn on an empty container.
        if (this._storesMode && !this._activeStoreId) {
            this._renderChatsList()
            return
        }
        if (!this._demo && this.state.phoneNumber) this._saveHistory(this.state.messages)
        this._renderStatus()
        this._renderMessages()
        this._renderTyping()
        this._renderIcebreakers()
        this._scrollToBottom()
    }

    // ─── Chats list (stores mode) ─────────────────────────────────

    // Toggle between the chats-list overlay and the chat surface. The chats
    // screen is positioned absolutely on top of the container so we don't have
    // to hide header/messages/input individually.
    _showChatsScreen() {
        this.find('.nui-wa-back-btn').hide()
        this.find('.nui-wa-floating-cart').hide()
        this._renderChatsList()
        this.find('.nui-wa-chats-screen').show()
    }

    _hideChatsScreen() {
        this.find('.nui-wa-chats-screen').hide()
        if (this._storesMode) this.find('.nui-wa-back-btn').show()
    }

    // Read a per-store history straight from localStorage so the chats list can
    // show real previews even for stores the user hasn't opened this session.
    _peekStoreHistory(phoneNumber) {
        if (!phoneNumber) return []
        try {
            const raw = localStorage.getItem('cartaja-chat-history::' + phoneNumber)
            return raw ? JSON.parse(raw) : []
        } catch (e) { return [] }
    }

    _renderChatsList() {
        const $list = this.find('.nui-wa-chats-list')
        if (!$list.length) return

        // Lazy-wire the search input + non-functional tab buttons. The chats
        // screen template is static, so this only needs to run on the first
        // render after construction.
        if (!this._chatsChromeWired) {
            this._chatsChromeWired = true
            this._chatsQuery = ''
            this.find('.nui-wa-chats-search-input').on('input', (e) => {
                this._chatsQuery = (e.target.value || '').toLowerCase().trim()
                this._renderChatsList()
            })
            // Tap on inactive tabs nudges focus back to Chats — purely visual,
            // since Updates/Calls/Communities/Settings aren't implemented.
            this.find('.nui-wa-chats-tabs').on('click', '.nui-wa-chats-tab', (e) => {
                const tab = e.currentTarget.getAttribute('data-tab')
                if (tab === 'chats') return
                this.find('.nui-wa-chats-tab').removeClass('is-active')
                this.find('.nui-wa-chats-tab[data-tab="chats"]').addClass('is-active')
            })
            // Reveal + wire the Help button only when the host provided an
            // onHelp callback. The button itself ships in the static template
            // hidden, so non-cartaja consumers don't get an unexplained "?"
            // floating next to "Chats".
            if (this._onHelp) {
                this.find('.nui-wa-help-btn').show().on('click', () => {
                    this._onHelp()
                    this.emit('help')
                })
            }
        }

        const query = this._chatsQuery || ''

        // Build rows enriched with the last persisted message so we can sort by
        // recency (most-recent-first) like real WhatsApp.
        const rows = this.stores
            .filter((store) => {
                if (!query) return true
                const name = String(store.companyName || store.id).toLowerCase()
                return name.indexOf(query) !== -1
            })
            .map((store) => {
                const history = this._peekStoreHistory(store.phoneNumber)
                const last = history.length ? history[history.length - 1] : null
                return { store, last, ts: last ? (last.timestamp || 0) : 0 }
            })
            .sort((a, b) => b.ts - a.ts)

        const emptyMsg = query
            ? `No chats match "${escapeHtml(query)}"`
            : 'No chats yet'

        const html = rows.map(({ store, last }) => {
            const name = store.companyName || store.id
            const initials = String(name)
                .split(/\s+/)
                .map((w) => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()
            const avatar = store.profilePhotoUrl
                ? `<img src="${escapeHtml(store.profilePhotoUrl)}" alt="${escapeHtml(name)}">`
                : escapeHtml(initials)
            let preview = ''
            let time = ''
            if (last) {
                preview = previewFromMessage(last)
                time = formatChatTime(last.timestamp)
            } else {
                preview = 'Tap to start chatting'
            }
            return `
                <button type="button" class="nui-wa-chat-row" data-store-id="${escapeHtml(store.id)}">
                    <div class="nui-wa-chat-row-avatar">${avatar}</div>
                    <div class="nui-wa-chat-row-content">
                        <div class="nui-wa-chat-row-top">
                            <span class="nui-wa-chat-row-name">${escapeHtml(name)}</span>
                            ${time ? `<span class="nui-wa-chat-row-time">${escapeHtml(time)}</span>` : ''}
                        </div>
                        <div class="nui-wa-chat-row-preview">${escapeHtml(preview)}</div>
                    </div>
                </button>
            `
        }).join('') || `<div class="nui-wa-chats-empty">${emptyMsg}</div>`

        $list.html(html)
        // .off() before .on() so re-renders don't stack handlers.
        $list.off('click', '.nui-wa-chat-row').on('click', '.nui-wa-chat-row', (e) => {
            const id = e.currentTarget.getAttribute('data-store-id')
            if (id) this._enterStore(id)
        })
    }

    // Swap the chat surface to a different store's identity, history, and
    // CommerceGenie routing config. Closes any in-flight WS for the previous
    // store and reconnects under the new phoneNumber so replies are routed
    // back to this widget instance.
    // Close a background WS that was kept alive for a specific phone number,
    // cancelling its timer and removing it from the map.
    _closeBgWs(phone) {
        const entry = this._bgWs.get(phone)
        if (!entry) return
        clearTimeout(entry.timer)
        try { entry.ws.close() } catch (e) {}
        this._bgWs.delete(phone)
    }

    _enterStore(storeId) {
        const store = (this.stores || []).find((s) => s.id === storeId)
        if (!store) return

        // Move the current WS to the background instead of closing it immediately.
        // The bot may still be processing the last message — keeping the socket open
        // lets the reply arrive and be saved to the correct store's history by the
        // stale guard in _connectWs. The socket closes automatically after 30s.
        // Before doing that, close any existing background socket for the same phone
        // (re-entering the same store) so the server never has duplicate registrations.
        const targetPhone = store.phoneNumber || ''
        if (targetPhone) this._closeBgWs(targetPhone)

        if (this._ws) {
            const oldWs = this._ws
            const oldPhone = this.state.phoneNumber
            this._ws = null  // make stale immediately — guards in _connectWs take over
            if (oldPhone) {
                const timer = setTimeout(() => {
                    try { oldWs.close() } catch (e) {}
                    this._bgWs.delete(oldPhone)
                }, 30000)
                this._bgWs.set(oldPhone, { ws: oldWs, timer })
            } else {
                try { oldWs.close() } catch (e) {}
            }
        }
        if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null }
        clearTimeout(this._typingTimeout)
        this._typingTimeout = null

        // Reset per-conversation state (rendered ids, typing).
        this._renderedIds = new Set()
        this.find('.nui-wa-messages').empty()
        this.state.isTyping = false
        this.state.connected = false
        // Clear messages explicitly before applying new history so any reactive
        // render in between paints empty rather than stale content.
        this.state.messages = []

        this._applyStoreConfig(store)
        this._activeStoreId = storeId

        // Now that phoneNumber is set, restore this store's history + cart.
        const saved = this._loadHistory()
        this._cart = this._loadCart()
        this._refreshFloatingCart()

        this._hideChatsScreen()
        this._refreshShopButton()

        // Set history last so the message-render pass sees a fully configured
        // widget (correct header, cart, backdrop) before drawing bubbles.
        this.state.messages = saved
        const lastMsg = saved[saved.length - 1]
        if (lastMsg && lastMsg.isSent) this._showTypingWhileWaiting()

        this._connectWs()
    }

    _exitToChatsList() {
        // Hide modal/overlay if one happens to be open before leaving the chat.
        this._closeModal()
        this._activeStoreId = null
        this._showChatsScreen()
    }

    // Update header DOM + the routing/identity instance fields from a store
    // config. Mirrors the constructor's per-field handling so single-store and
    // stores-mode share the same shape.
    _applyStoreConfig(store) {
        const companyName = store.companyName || 'CommerceGenie'
        const initials = companyName
            .split(/\s+/)
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()
        const profilePhoto = store.profilePhotoUrl
            ? `<img src="${escapeHtml(store.profilePhotoUrl)}" alt="${escapeHtml(companyName)}" />`
            : escapeHtml(initials)

        this.find('.nui-wa-header .nui-wa-profile-photo').html(profilePhoto)
        this.find('.nui-wa-header .nui-wa-user-info h5').text(companyName)

        this.icebreakers = (store.icebreakers || [])
            .map((ib) => typeof ib === 'string' ? { label: ib, text: ib } : ib)
            .filter((ib) => ib && ib.text)
        this.useCase = store.useCase || null
        this.phoneNumberId = store.phoneNumberId || null
        this.commerceGenieApiUrl = store.commerceGenieApiUrl || null
        this.commerceGenieApiToken = store.commerceGenieApiToken || null
        this.whatsappBotKey = store.whatsappBotKey || null
        if (store.profileName) this.profileName = store.profileName

        this.state.phoneNumber = store.phoneNumber
            || ('demo-' + Math.random().toString(36).slice(2, 10))
    }

    // ─── WebSocket ────────────────────────────────────────────────

    _connectWs() {
        if (this._cancelled) return
        if (this._backend === 'scriptr') return this._connectScriptrChannel()
        let ws
        try {
            ws = new WebSocket(this.wsUrl)
            this._ws = ws
        } catch (e) {
            console.error('[WhatsappEmulator] ws construction failed', e)
            this._scheduleReconnect()
            return
        }

        ws.addEventListener('open', () => {
            if (ws !== this._ws) return
            this.state.connected = true
            // Tell the server which phone number this client belongs to so it can
            // route replies only to this widget instance (not all open tabs/use-cases).
            ws.send(JSON.stringify({ type: 'register', phoneNumber: this.state.phoneNumber }))
        })
        ws.addEventListener('close', () => {
            if (ws !== this._ws) return
            this.state.connected = false
            this._scheduleReconnect()
        })
        ws.addEventListener('error', () => {
            // 'close' will fire right after — handle reconnect there.
        })
        // Capture the phone number at connect time so the stale-WS handler
        // below can save replies to the correct store's history even after
        // _enterStore() has updated this.state.phoneNumber to a different store.
        const capturedPhone = this.state.phoneNumber

        ws.addEventListener('message', (ev) => {
            let data
            try { data = JSON.parse(ev.data) } catch { return }

            if (ws !== this._ws) {
                // Stale WS — the user switched to another store before this reply
                // arrived. Don't render it in the current chat, but save it to the
                // correct store's history so it appears when the user navigates back.
                if (data.type === 'message' && capturedPhone) {
                    const msg = { ...data.message, isSent: false }
                    try {
                        const key = 'cartaja-chat-history::' + capturedPhone
                        const raw = localStorage.getItem(key)
                        const saved = raw ? JSON.parse(raw) : []
                        localStorage.setItem(key, JSON.stringify([...saved, msg].slice(-200)))
                    } catch (e) {}
                }
                return
            }

            this._handleWsEvent(data)
        })
    }

    // scriptr mode: subscribe to the account's pub/sub channel emulator-{phone}.
    // The egress handler publishes bot replies there; route them through the
    // same _handleWsEvent dispatch the node WebSocket uses.
    _connectScriptrChannel() {
        if (this._scriptrChannel || this._cancelled) return
        const channel = 'emulator'
        const wsUrl = 'wss://api.scriptrapps.io/' + this.commerceGenieApiToken
        let ws
        try { ws = new WebSocket(wsUrl) } catch (e) { console.error('[WhatsappEmulator] scriptr ws construct failed', e); return }
        this._scriptrChannel = ws

        ws.onopen = () => {
            ws.send(JSON.stringify({ method: 'Subscribe', params: { channel: channel } }))
        }
        ws.onerror = (e) => { console.error('[WhatsappEmulator] scriptr ws error', e) }
        ws.onclose = () => {
            this.state.connected = false
            if (this._scriptrChannel === ws) this._scriptrChannel = null
            // Scriptr RTM idles the socket out; without reconnecting, the widget
            // would go permanently deaf and silently drop every later bot reply.
            this._scheduleScriptrReconnect()
        }
        ws.onmessage = (ev) => {
            if (ws !== this._scriptrChannel || this._cancelled) return
            let frame
            try { frame = JSON.parse(ev.data) } catch (e) { return }
            // Subscribe handshake / control acks → just mark connected.
            if (frame && (frame.result === 'connected.' || frame.statusCode === 200 || frame.statusCode === '200' || frame.status === 'success')) {
                this.state.connected = true
            }
            // Our channel payloads are { type:'message'|'typing', ... }. Depending on
            // the RTM frame shape the published string may arrive verbatim as the
            // frame, or nested under frame.message — handle both.
            let payload = frame
            if (frame && typeof frame.message === 'string') {
                try { payload = JSON.parse(frame.message) } catch (e) { /* keep frame */ }
            }
            if (!payload || (payload.type !== 'message' && payload.type !== 'typing')) return
            // The account-wide "emulator" channel carries every session; only render
            // frames routed to this widget's simulated shopper.
            if (payload.route && payload.route !== this.state.phoneNumber) return
            this._handleWsEvent(payload)
        }
    }

    _scheduleScriptrReconnect() {
        if (this._cancelled || this._scriptrReconnectTimer) return
        this._scriptrReconnectTimer = setTimeout(() => {
            this._scriptrReconnectTimer = null
            this._connectScriptrChannel()
        }, 1500)
    }

    _scheduleReconnect() {
        if (this._cancelled || this._reconnectTimer) return
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null
            this._connectWs()
        }, 1500)
    }

    _handleWsEvent(data) {
        if (this._cancelled) return
        if (data.type === 'connected') {
            // initial hello from the server; state.connected already flipped on open
            return
        }
        if (data.type === 'typing') {
            this.state.isTyping = true
            // Only set a fallback timer when no user-initiated one is active.
            // _showTypingWhileWaiting() sets _typingTimeout and nulls it on fire,
            // so a non-null value means the 30 s hard deadline is still running.
            if (!this._typingTimeout) {
                this._typingTimeout = setTimeout(() => {
                    this._typingTimeout = null
                    this.state.isTyping = false
                }, 5000)
            }
            return
        }
        if (data.type === 'message') {
            this.state.isTyping = false
            this._pendingReply = false // a live reply arrived over pub/sub — no fallback needed
            const msg = { ...data.message, isSent: false }
            this._addMessage(msg)
            return
        }
    }

    // ─── Message state ────────────────────────────────────────────

    // Update state and flush to localStorage immediately so history survives
    // a use-case switch that happens before the deferred render fires.
    _addMessage(msg) {
        const updated = [...this.state.messages, msg]
        if (!this._demo) this._saveHistory(updated)
        this.state.messages = updated
    }

    // Demo playback: reveal the scripted transcript one message at a time.
    // Business (received) messages show a typing indicator first; customer
    // (sent) messages pop in after a short beat. Real per-turn delayMs hints are
    // deliberately ignored (a 25-minute delivery tail is useless in a live demo).
    /** Rough "how much is there to take in" score for a demo message, in
     *  character-equivalents. Plain text counts its own length; structured
     *  content (list rows, carousel cards, product/order lines, buttons) has
     *  little or no body text but takes real time to read, so each element
     *  contributes a weight. Used only for autoplay dwell. */
    _demoReadWeight(m) {
        if (!m) return 0
        let n = String(m.body || m.text || '').length
            + String(m.caption || '').length
            + String(m.header || '').length
            + String(m.footer || '').length
        const sections = Array.isArray(m.sections) ? m.sections : []
        for (const s of sections) {
            const rows = (s && (s.rows || s.products)) || []
            n += rows.length * 28
        }
        if (Array.isArray(m.cards)) n += m.cards.length * 45
        if (Array.isArray(m.product_items)) n += m.product_items.length * 24
        if (Array.isArray(m.buttons)) n += m.buttons.length * 14
        return n
    }

    /** Push the current transport state to the host page, if it asked for it. */
    _demoNotify() {
        if (this._onDemoUpdate) this._onDemoUpdate(this.demoPosition())
    }

    _demoStep() {
        if (this._cancelled || !this._demoQueue || !this._demoQueue.length) {
            this.state.isTyping = false
            if (this._demoPlaying) { this._demoPlaying = false; this._demoNotify() }
            return
        }
        const m = this._demoQueue.shift()
        const pace = this._demoPace
        const weight = this._demoReadWeight(m)
        const commit = () => {
            if (this._cancelled) return
            this.state.isTyping = false
            this._addMessage(m)
            this._demoNotify()
            // Pause after the message so there's time to actually read it.
            // With demoDwellPerChar 0 this is the original flat 500/350.
            const base = m.isSent ? 500 : 350
            const dwell = Math.min(2000, base + weight * this._demoDwellPerChar)
            this._demoTimer = setTimeout(() => this._demoStep(), dwell * pace)
        }
        if (m.isSent) {
            this._demoTimer = setTimeout(commit, 450 * pace)
        } else {
            this.state.isTyping = true
            // In length-aware mode the "typing" beat reflects the whole message
            // (a 12-card carousel should take longer to compose than a one-
            // liner). At the default it stays on body text alone, i.e. exactly
            // the original timing.
            const typingLen = this._demoDwellPerChar > 0
                ? weight : String(m.body || m.text || '').length
            this._demoTimer = setTimeout(commit, Math.min(1500, 650 + typingLen * 8) * pace)
        }
    }

    // ─── Transport (Play / Pause / Prev / Next / Skip to end) ─────────────

    /** Freeze autoplay where it stands, keeping every bubble already on screen
     *  and moving the cursor there so Prev/Next carry on from that point.
     *  Safe to call when nothing is playing. Returns { visible, total, playing }. */
    demoPause() {
        if (!this._demo) return { visible: 0, total: 0, playing: false }
        // While autoplay runs the cursor is null ("the loop owns it"), so the
        // real position is however many bubbles have been committed.
        const shown = (this.state && this.state.messages) ? this.state.messages.length : 0
        return this.demoStepTo(this._demoVisible == null ? shown : this._demoVisible)
    }

    /** Start (or resume) autoplay from the current cursor. At the end of the
     *  transcript this is a no-op — use demoStepTo(0) then demoPlay() to replay. */
    demoPlay() {
        const total = this._demoMessages.length
        if (!this._demo || !total) return this.demoPosition()
        const from = this._demoVisible == null ? total : this._demoVisible
        if (from >= total) return this.demoPosition()
        clearTimeout(this._demoTimer)
        // The message that was mid-"typing" when we paused was already shifted
        // off the old queue but never committed, so slicing from the rendered
        // count naturally replays it rather than skipping it.
        this._demoQueue = this._demoMessages.slice(from)
        this._demoVisible = null
        this._demoPlaying = true
        this._demoStep()
        return this.demoPosition()
    }

    /** Skip straight to the end of the flow — the whole transcript, no waiting. */
    demoEnd() { return this.demoStepTo(this._demoMessages.length) }

    demoIsPlaying() { return this._demoPlaying === true }

    /** Reveal exactly the first `n` messages of the demo transcript. Cancels any
     *  autoplay in progress. Returns { visible, total, playing }. */
    demoStepTo(n) {
        if (!this._demo) return { visible: 0, total: 0, playing: false }
        clearTimeout(this._demoTimer)
        this._demoQueue = null
        this._demoPlaying = false
        const total = this._demoMessages.length
        const c = Math.max(0, Math.min(total, n | 0))
        this._demoVisible = c
        // Full re-render of the visible slice (append-only rendering can't remove
        // messages, so reset and rebuild — cheap at these counts).
        this._renderedIds = new Set()
        this.find('.nui-wa-messages').empty()
        this.state.isTyping = false
        this.state.messages = this._demoMessages.slice(0, c)
        return { visible: c, total, playing: false }
    }

    demoNext() { return this.demoStepTo((this._demoVisible == null ? this._demoMessages.length : this._demoVisible) + 1) }
    demoPrev() { return this.demoStepTo((this._demoVisible == null ? this._demoMessages.length : this._demoVisible) - 1) }

    /** Current transport position, for the page's counter / button states.
     *  A null cursor means either autoplay owns the reveal (count what's on
     *  screen) or the whole transcript is showing. */
    demoPosition() {
        const total = this._demoMessages.length
        if (this._demoVisible != null) {
            return { visible: this._demoVisible, total, playing: this._demoPlaying }
        }
        const shown = (this.state && this.state.messages) ? this.state.messages.length : total
        return { visible: this._demoPlaying ? shown : total, total, playing: this._demoPlaying }
    }

    // ─── Sending ──────────────────────────────────────────────────

    _showTypingWhileWaiting() {
        clearTimeout(this._typingTimeout)
        this.state.isTyping = true
        this._typingTimeout = setTimeout(() => {
            this._typingTimeout = null
            this.state.isTyping = false
        }, 30000)
    }

    async _postSend(payload, sentMessageId) {
        if (this._backend === 'scriptr') return this._postSendScriptr(payload, sentMessageId)
        const fullPayload = {
            ...payload,
            ...(this.useCase ? { useCase: this.useCase } : {}),
            ...(this.phoneNumberId ? { phoneNumberId: this.phoneNumberId } : {}),
            ...(this.commerceGenieApiUrl ? { commerceGenieApiUrl: this.commerceGenieApiUrl } : {}),
            ...(this.commerceGenieApiToken ? { commerceGenieApiToken: this.commerceGenieApiToken } : {}),
            ...(this.whatsappBotKey ? { whatsappBotKey: this.whatsappBotKey } : {})
        }
        try {
            const res = await fetch(this.wabaEmulator + '/emulator/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fullPayload)
            })
            if (!res.ok) console.error('[WhatsappEmulator] send failed', res.status)
            else if (sentMessageId && !this._cancelled) this._markMessageReceived(sentMessageId)
        } catch (e) {
            console.error('[WhatsappEmulator] send error', e)
        }
    }

    // scriptr mode: POST the shopper message to the account's authenticated
    // emulator ingress, which drives the account's own pipeline. The reply
    // arrives asynchronously over the pub/sub channel (_connectScriptrChannel).
    async _postSendScriptr(payload, sentMessageId) {
        const base = (this.commerceGenieApiUrl || '').replace(/\/+$/, '')
        const body = {
            phoneNumber: payload.phoneNumber,
            profileName: payload.profileName,
            botKey: this.whatsappBotKey || 'whatsapp-bot',
            // Threaded to the WhatsApp send node so it can authenticate to the
            // emulator egress (which lives on Scriptr and validates bearers).
            // Same token already used for this request's Authorization header.
            senderToken: this.commerceGenieApiToken
        }
        if (payload.text != null) body.text = payload.text
        if (payload.interactiveReply) body.interactiveReply = payload.interactiveReply
        // The reply is delivered over the (ephemeral) pub/sub channel; if the socket
        // missed it, the ingress ALSO returns the reply text synchronously, which we
        // render as a fallback so a generated reply is never silently lost. Cleared
        // when a live pub/sub reply arrives (_handleWsEvent).
        this._pendingReply = true
        try {
            const res = await fetch(base + '/ntelioMiddleware/server/api/app/v1/emulator/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.commerceGenieApiToken },
                body: JSON.stringify(body)
            })
            if (!res.ok) { console.error('[WhatsappEmulator] scriptr send failed', res.status); return }
            if (sentMessageId && !this._cancelled) this._markMessageReceived(sentMessageId)
            let replyText = ''
            try { replyText = this._extractReplyText(await res.json()) } catch (e) {}
            if (replyText) {
                // Give the live pub/sub reply a beat to win the race before falling back.
                setTimeout(() => {
                    if (!this._cancelled && this._pendingReply) {
                        this._pendingReply = false
                        this._renderFallbackReply(replyText)
                    }
                }, 1200)
            }
        } catch (e) {
            console.error('[WhatsappEmulator] scriptr send error', e)
        }
    }

    // Dig the reply text out of the ingress response regardless of how deep the
    // Scriptr gateway envelope nests it. Returns '' when there's no plain-text reply.
    _extractReplyText(data) {
        let node = data
        for (let i = 0; i < 6 && node && typeof node === 'object'; i++) {
            if (typeof node.replyText === 'string') {
                const t = node.replyText.trim()
                // Guard against a non-text answer (e.g. a serialized tool payload).
                return (t && t[0] !== '{' && t[0] !== '[') ? node.replyText : ''
            }
            node = node.result || node.response || node.body
        }
        return ''
    }

    // Render a bot text bubble that the pub/sub channel failed to deliver.
    _renderFallbackReply(text) {
        if (!text || this._cancelled) return
        this.state.isTyping = false
        this._addMessage({ id: 'reply-' + Date.now(), kind: 'text', text: String(text), isSent: false, timestamp: Date.now() })
    }

    _markMessageReceived(messageId) {
        const idx = this.state.messages.findIndex((m) => m.id === messageId)
        if (idx === -1) return
        const updated = [...this.state.messages]
        updated[idx] = { ...updated[idx], status: 'received' }
        this.state.messages = updated
        this._saveHistory(updated)
        const escId = (window.CSS && CSS.escape) ? CSS.escape(messageId) : messageId
        this.find(`.nui-wa-message[data-msg-id="${escId}"] .nui-wa-status-check`)
            .removeClass('fa-check').addClass('fa-check-double')
    }

    _sendUserText(text) {
        // Bare "clear"/"reset" (no slash) stay a client-only local wipe — a quick
        // way to reset the test view so the icebreaker chips reappear. SLASH
        // commands like "/clear" are handled server-side (the pipeline rotates the
        // session so the bot ignores prior history, and works over a real WABA
        // number too), so let those flow through to the backend.
        if (/^(clear|reset)$/i.test(text.trim())) {
            this._clearConversation()
            return
        }
        const sentMsg = {
            id: 'local-' + Date.now(),
            kind: 'text',
            text,
            isSent: true,
            status: 'pending',
            timestamp: Date.now()
        }
        this._addMessage(sentMsg)
        // Demo mode has no backend: echo the typed line as a sent bubble (so a
        // presenter can improvise) but never call the pipeline or wait for a reply.
        if (this._demo) return
        this._showTypingWhileWaiting()
        this._postSend({
            text,
            phoneNumber: this.state.phoneNumber,
            profileName: this.profileName
        }, sentMsg.id)
    }

    _clearConversation() {
        try { localStorage.removeItem(this._historyKey()) } catch (e) {}
        this._renderedIds = new Set()
        this.find('.nui-wa-messages').empty()
        this.state.isTyping = false
        // Setting state.messages triggers render → icebreakers re-show.
        this.state.messages = []
    }

    _sendLocationReply({ latitude, longitude, name, address }) {
        const sentMsg = {
            id: 'local-' + Date.now(),
            kind: 'location',
            latitude, longitude, name, address,
            isSent: true,
            status: 'pending',
            timestamp: Date.now()
        }
        this._addMessage(sentMsg)
        this._showTypingWhileWaiting()
        this._postSend({
            phoneNumber: this.state.phoneNumber,
            profileName: this.profileName,
            interactiveReply: { type: 'location', latitude, longitude, name, address }
        }, sentMsg.id)
    }

    _requestGeolocation() {
        // Fallback coords used when the browser blocks / denies / can't resolve geolocation —
        // keeps demos working in headless Playwright, private-mode browsers, no-GPS laptops.
        const FALLBACK = { latitude: 37.7749, longitude: -122.4194, address: 'San Francisco, CA (demo fallback)' }
        return new Promise((resolve) => {
            if (!navigator.geolocation) return resolve(FALLBACK)
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
                () => resolve(FALLBACK),
                { timeout: 5000, maximumAge: 60000 }
            )
        })
    }

    _sendInteractiveReply({ type, id, title, description, replyContext }) {
        const sentMsg = {
            id: 'local-' + Date.now(),
            kind: 'text',
            text: title,
            replyContext,
            isSent: true,
            status: 'pending',
            timestamp: Date.now()
        }
        this._addMessage(sentMsg)
        this._showTypingWhileWaiting()
        this._postSend({
            phoneNumber: this.state.phoneNumber,
            profileName: this.profileName,
            interactiveReply: { type, id, title, description }
        }, sentMsg.id)
    }

    _sendOrderReply({ catalogId, productItems, firstThumb, cart }) {
        const itemCount = productItems.reduce((n, p) => n + (p.quantity || 0), 0)
        const total = productItems.reduce((sum, p) => sum + (p.item_price || 0) * (p.quantity || 0), 0)
        const currency = productItems[0]?.currency || 'USD'
        const summary = `Order placed: ${itemCount} item${itemCount === 1 ? '' : 's'}, ${currency} ${total.toFixed(2)}`
        const sentMsg = {
            id: 'local-' + Date.now(),
            kind: 'cart_sent',
            itemCount,
            total,
            currency,
            firstThumb: firstThumb || null,
            catalogId: catalogId || '',
            cart: cart || null,
            isSent: true,
            status: 'pending',
            timestamp: Date.now()
        }
        this._addMessage(sentMsg)
        this._showTypingWhileWaiting()
        this._postSend({
            phoneNumber: this.state.phoneNumber,
            profileName: this.profileName,
            interactiveReply: { type: 'order', catalogId, productItems, text: summary }
        }, sentMsg.id)
    }

    _sendFlowReply({ flowToken, responseJson }) {
        const sentMsg = {
            id: 'local-' + Date.now(),
            kind: 'text',
            text: 'Form submitted',
            isSent: true,
            status: 'pending',
            timestamp: Date.now()
        }
        this._addMessage(sentMsg)
        this._showTypingWhileWaiting()
        this._postSend({
            phoneNumber: this.state.phoneNumber,
            profileName: this.profileName,
            interactiveReply: { type: 'nfm_reply', flowToken, responseJson }
        }, sentMsg.id)
    }

    // ─── Rendering ────────────────────────────────────────────────

    _renderStatus() {
        const $dot = this.find('.nui-wa-status-dot')
        const $txt = this.find('.nui-wa-status-text')
        if (this.state.connected) {
            $dot.addClass('is-connected')
            $txt.text('online')
        } else {
            $dot.removeClass('is-connected')
            $txt.text('connecting…')
        }
    }

    _renderMessages() {
        const $container = this.find('.nui-wa-messages')
        // Append-only rendering: only add DOM for messages we haven't seen yet.
        // Full re-render on every state write would flicker and kill scroll position.
        for (const m of this.state.messages) {
            if (this._renderedIds.has(m.id)) continue
            this._renderedIds.add(m.id)
            const $el = $(this._messageHtml(m))
            this._wireMessageInteractions($el, m)
            $container.append($el)
        }
    }

    _renderTyping() {
        let $typing = this.find('.nui-wa-typing')
        const $container = this.find('.nui-wa-messages')
        if ($typing.length === 0) {
            $typing = $(`
                <div class="nui-wa-typing">
                    <div class="nui-wa-dots">
                        <div class="nui-wa-dot"></div>
                        <div class="nui-wa-dot"></div>
                        <div class="nui-wa-dot"></div>
                    </div>
                </div>
            `)
            $container.append($typing)
        }
        $typing.toggleClass('is-visible', !!this.state.isTyping)
        // keep typing element last so it appears under newest message
        $container.append($typing)
    }

    _scrollToBottom() {
        const node = this.find('.nui-wa-messages')[0]
        if (node) node.scrollTop = node.scrollHeight
    }

    // Render once on first empty-chat render, then hide as soon as any message
    // exists. Tapping a chip sends it as a normal user text — which adds a
    // message and triggers the next render to hide them.
    /**
     * Replace the conversation-starter chips at runtime (e.g. the host re-read
     * them from settings after the business edited them). Normalizes like the
     * constructor, then clears the cached chip DOM + its delegated handler so
     * _renderIcebreakers() rebuilds from the new list rather than reusing the
     * stale chips. Safe to call while a conversation is on screen — the chips
     * stay hidden until the next empty-chat render (e.g. the trashcan reset).
     */
    setIcebreakers(list) {
        this.icebreakers = (list || [])
            .map((ib) => typeof ib === 'string' ? { label: ib, text: ib } : ib)
            .filter((ib) => ib && ib.text)
        const $box = this.find('.nui-wa-icebreakers')
        if ($box.length) $box.off().empty()
        this._renderIcebreakers()
    }

    _renderIcebreakers() {
        const $box = this.find('.nui-wa-icebreakers')
        if (!$box.length) return
        const hasMessages = this.state.messages.length > 0
        if (hasMessages || !this.icebreakers.length) {
            $box.hide()
            return
        }
        if (!$box.children().length) {
            // Inline send-icon SVG — shared shape with the .nui-wa-input-send
            // button below the chat. Defined inline (rather than as a static
            // import) so the widget remains a single file with no asset deps.
            const sendSvg = '<svg class="nui-wa-send-svg nui-wa-icebreaker-icon" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path transform="translate(0,-289.0625)" d="m 25.5,304.0625 c 0,-1.11962 -1,-1.5 -1,-1.5 l -20,-8 3.60352,8.56055 L 17.5,304.0625 8.10352,305.00195 4.5,313.5625 l 20,-8 c 0,0 1,-0.38038 1,-1.5 z"/></svg>'
            const html = this.icebreakers.map((ib) => `
                <button type="button" class="nui-wa-icebreaker-btn" data-text="${escapeHtml(ib.text)}">
                    <span class="nui-wa-icebreaker-label">${escapeHtml(ib.label)}</span>
                    ${sendSvg}
                </button>
            `).join('')
            $box.html(html)
            $box.on('click', '.nui-wa-icebreaker-btn', (e) => {
                const text = e.currentTarget.getAttribute('data-text')
                if (text) this._sendUserText(text)
            })
        }
        $box.css('display', '')
    }

    // ─── Fullscreen modal mount (overlay inside .nui-wa-container) ───

    _openModal(html, wireFn) {
        const $overlay = this.find('.nui-wa-overlay')
        // .off() removes all delegated handlers accumulated on $overlay from previous
        // opens — without it they stack up and every click fires N times.
        // Anchor below the chat header so the WhatsApp-style header (avatar, contact
        // name, status, icons) remains visible while the catalog/cart is open.
        const headerH = this.find('.nui-wa-header').outerHeight() || 0
        $overlay.off().css('top', headerH + 'px').html(html).show()
        if (wireFn) wireFn($overlay)
    }

    _closeModal() {
        const $overlay = this.find('.nui-wa-overlay')
        $overlay.off().hide().empty().css('top', '')
    }

    // Floating cart pill — WhatsApp-style circular button shown above the input
    // whenever the shared cart has items. Reads from this._cart and is called
    // after every mutation (catalog modal qty changes, cart modal qty changes,
    // and order-placed clear).
    _refreshFloatingCart() {
        const $btn = this.find('.nui-wa-floating-cart')
        if (!$btn.length) return
        const total = this._cart.cartItems.reduce((n, e) => n + e.qty, 0)
        if (total > 0) {
            $btn.find('.nui-wa-floating-cart-badge').text(total)
            $btn.show()
        } else {
            $btn.hide()
        }
    }

    _openFloatingCart() {
        const { cartItems, catalogId } = this._cart
        if (!cartItems.some(e => e.qty > 0)) return
        this._openCartModal({
            catalogId: catalogId || '',
            cart: cartItems,
            onOrdered: () => {
                this._cart = { cartItems: [], cartIndex: new Map(), catalogId: '' }
                this._refreshFloatingCart()
            }
        })
    }

    // Multi-product message modal — sectioned vertical list with per-row "+" buttons.
    // Cart icon in the header opens the cart modal once items are added.
    _openProductListModal(m) {
        // Single shared cart across all product-list modals and the catalog header.
        const { cartItems, cartIndex } = this._cart
        // Stash catalogId so the floating cart can place orders against the
        // most recent catalog the user interacted with.
        this._cart.catalogId = m.catalogId || this._cart.catalogId || ''
        const allProducts = []  // flat list, indexed by data-product-idx

        const sectionsHtml = (m.sections || []).map((s) => {
            const rows = (s.products || []).map((p) => {
                const idx = allProducts.length
                allProducts.push(p)
                const name = p.name || p.retailerId
                const thumb = p.image
                    ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(name)}">`
                    : `<i class="fas fa-box-open"></i>`
                // stock: -1 (or absent) = untracked/unknown → no badge; 0 = out of stock; >0 = count.
                const stock = (typeof p.stock === 'number') ? p.stock : -1
                const outOfStock = stock === 0
                let stockHtml = ''
                if (outOfStock) {
                    stockHtml = `<div class="nui-wa-mpm-stock nui-wa-mpm-stock-out">Out of stock</div>`
                } else if (stock > 0) {
                    const lowStock = stock <= 5
                    stockHtml = `<div class="nui-wa-mpm-stock${lowStock ? ' nui-wa-mpm-stock-low' : ''}">${lowStock ? `Only ${stock} left` : `${stock} in stock`}</div>`
                }
                return `
                    <div class="nui-wa-mpm-row${outOfStock ? ' nui-wa-mpm-row-out' : ''}" data-product-idx="${idx}">
                        <div class="nui-wa-mpm-thumb">${thumb}</div>
                        <div class="nui-wa-mpm-info">
                            <div class="nui-wa-mpm-name">${escapeHtml(name)}</div>
                            ${p.price ? `<div class="nui-wa-mpm-price">${escapeHtml(formatPrice(p.price, p.currency))}</div>` : ''}
                            ${stockHtml}
                        </div>
                        <button type="button" class="nui-wa-mpm-add-btn" aria-label="Add"${outOfStock ? ' disabled' : ''}>
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                `
            }).join('')
            return `
                ${s.title ? `<div class="nui-wa-mpm-section-title">${escapeHtml(s.title)}</div>` : ''}
                ${rows}
            `
        }).join('')

        const headerTitle = 'Product collections'
        const html = `
            <div class="nui-wa-fs-modal nui-wa-mpm-modal">
                <div class="nui-wa-fs-header">
                    <button type="button" class="nui-wa-fs-back" aria-label="Back">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <div class="nui-wa-fs-title">
                        ${escapeHtml(headerTitle)}
                        <div class="nui-wa-fs-subtitle">${allProducts.length} item${allProducts.length === 1 ? '' : 's'}</div>
                    </div>
                    <button type="button" class="nui-wa-mpm-cart-btn" disabled aria-label="Cart">
                        <i class="fas fa-shopping-cart"></i>
                        <span class="nui-wa-mpm-cart-badge" style="display:none">0</span>
                    </button>
                </div>
                <div class="nui-wa-fs-body">
                    ${sectionsHtml || '<div class="nui-wa-mpm-empty">No products available.</div>'}
                </div>
            </div>
        `

        this._openModal(html, ($overlay) => {
            const $cartBtn = $overlay.find('.nui-wa-mpm-cart-btn')
            const $cartBadge = $overlay.find('.nui-wa-mpm-cart-badge')

            // Shared cart-state helpers: both the list "+" button and the PDP
            // (product detail page) call these so the cart stays in sync across views.
            const getQty = (productIdx) => {
                const p = allProducts[productIdx]
                const cartIdx = cartIndex.get(p.retailerId)
                return cartIdx == null ? 0 : cartItems[cartIdx].qty
            }
            const setQty = (productIdx, qty) => {
                const p = allProducts[productIdx]
                let cartIdx = cartIndex.get(p.retailerId)
                if (cartIdx == null) {
                    if (qty <= 0) return
                    cartItems.push({
                        retailerId: p.retailerId,
                        name: p.name || p.retailerId,
                        image: p.image || null,
                        price: parseFloat(p.price) || 0,
                        currency: p.currency || 'USD',
                        qty: 0
                    })
                    cartIdx = cartItems.length - 1
                    cartIndex.set(p.retailerId, cartIdx)
                }
                cartItems[cartIdx].qty = Math.max(0, qty)
                this._saveCart()
                refreshRowPill(productIdx)
                refreshCartBtn()
            }
            const bumpQty = (productIdx, delta) => setQty(productIdx, getQty(productIdx) + delta)

            const refreshRowPill = (productIdx) => {
                const $row = $overlay.find(`.nui-wa-mpm-row[data-product-idx="${productIdx}"]`)
                const qty = getQty(productIdx)
                const $pill = $row.find('.nui-wa-mpm-qty-pill')
                if (qty > 0) {
                    if ($pill.length) $pill.text(`${qty} added`)
                    else $row.find('.nui-wa-mpm-add-btn').before(`<span class="nui-wa-mpm-qty-pill">${qty} added</span>`)
                } else {
                    $pill.remove()
                }
            }

            const refreshCartBtn = () => {
                const total = cartItems.reduce((n, e) => n + e.qty, 0)
                if (total > 0) {
                    $cartBadge.text(total).show()
                    $cartBtn.prop('disabled', false)
                } else {
                    $cartBadge.hide()
                    $cartBtn.prop('disabled', true)
                }
                this._refreshFloatingCart()
            }

            // Product Detail Page — overlays the list view; back returns to the list.
            const openPdp = (productIdx) => {
                const p = allProducts[productIdx]
                const name = p.name || p.retailerId
                const heroImg = p.image
                    ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(name)}">`
                    : `<i class="fas fa-box-open"></i>`
                const priceLine = p.price
                    ? `<div class="nui-wa-pdp-price">${escapeHtml(String(p.price))} ${escapeHtml(p.currency || '')}</div>`
                    : ''
                const pdpStock = (typeof p.stock === 'number') ? p.stock : -1
                const stockLine = pdpStock === 0
                    ? `<div class="nui-wa-mpm-stock nui-wa-mpm-stock-out">Out of stock</div>`
                    : (pdpStock > 0
                        ? `<div class="nui-wa-mpm-stock${pdpStock <= 5 ? ' nui-wa-mpm-stock-low' : ''}">${pdpStock <= 5 ? `Only ${pdpStock} left` : `${pdpStock} in stock`}</div>`
                        : '')
                const descLine = p.description
                    ? `<div class="nui-wa-pdp-desc">${escapeHtml(p.description)}</div>`
                    : ''

                const renderActionFooter = () => {
                    const qty = getQty(productIdx)
                    return qty > 0
                        ? `<div class="nui-wa-pdp-stepper">
                               <button type="button" class="nui-wa-pdp-qty-btn" data-delta="-1">−</button>
                               <span class="nui-wa-pdp-qty">${qty}</span>
                               <button type="button" class="nui-wa-pdp-qty-btn" data-delta="1">+</button>
                           </div>`
                        : `<button type="button" class="nui-wa-pdp-add-btn">Add to cart</button>`
                }

                const pdpHtml = `
                    <div class="nui-wa-fs-modal nui-wa-pdp-modal">
                        <div class="nui-wa-fs-header">
                            <button type="button" class="nui-wa-pdp-back" aria-label="Back">
                                <i class="fas fa-chevron-left"></i>
                            </button>
                            <div class="nui-wa-fs-title">${escapeHtml(name)}</div>
                            <div class="nui-wa-fs-action-spacer"></div>
                        </div>
                        <div class="nui-wa-fs-body">
                            <div class="nui-wa-pdp-hero">${heroImg}</div>
                            <div class="nui-wa-pdp-meta">
                                <div class="nui-wa-pdp-name">${escapeHtml(name)}</div>
                                ${priceLine}
                                ${stockLine}
                                ${descLine}
                            </div>
                        </div>
                        <div class="nui-wa-pdp-footer">${renderActionFooter()}</div>
                    </div>
                `
                const $pdp = $(pdpHtml).addClass('nui-wa-pdp-overlay')
                $overlay.append($pdp)

                const refreshFooter = () => {
                    $pdp.find('.nui-wa-pdp-footer').html(renderActionFooter())
                }

                $pdp.find('.nui-wa-pdp-back').on('click', () => $pdp.remove())
                $pdp.on('click', '.nui-wa-pdp-add-btn', () => {
                    bumpQty(productIdx, 1)
                    refreshFooter()
                })
                $pdp.on('click', '.nui-wa-pdp-qty-btn', (e) => {
                    const delta = parseInt(e.currentTarget.getAttribute('data-delta'))
                    bumpQty(productIdx, delta)
                    refreshFooter()
                })
            }

            $overlay.find('.nui-wa-fs-back').first().on('click', () => {
                this._closeModal()
            })

            // Restore qty pills for any items already in the cart (from a previous open).
            for (const [retailerId] of cartIndex) {
                const productIdx = allProducts.findIndex(p => p.retailerId === retailerId)
                if (productIdx >= 0) refreshRowPill(productIdx)
            }
            refreshCartBtn()

            // Tap row body → PDP. The "+" button stops propagation so it just adds.
            $overlay.on('click', '.nui-wa-mpm-add-btn', (e) => {
                e.stopPropagation()
                const idx = parseInt($(e.currentTarget).closest('.nui-wa-mpm-row').attr('data-product-idx'))
                bumpQty(idx, 1)
            })
            $overlay.on('click', '.nui-wa-mpm-row', (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-product-idx'))
                openPdp(idx)
            })

            $cartBtn.on('click', () => {
                if (!cartItems.some(e => e.qty > 0)) return
                this._openCartModal({
                    catalogId: m.catalogId || '',
                    cart: cartItems,
                    onOrdered: () => {
                        this._cart = { cartItems: [], cartIndex: new Map(), catalogId: '' }
                        this._refreshFloatingCart()
                        this._saveCart()
                    }
                })
            })
        })
    }

    // Cart modal — line items with -/+ steppers, estimated total, "Place order".
    // readOnly: opened from a prior cart_sent bubble — hide steppers + Place order.
    // onOrdered: optional callback fired after the order is submitted (clears pending cart).
    _openCartModal({ catalogId, cart, readOnly = false, onOrdered = null }) {
        // readOnly (cart_sent bubble replay) uses a copy so the displayed bubble is immutable.
        // Live cart uses the original array directly so qty changes persist back to _pendingCarts.
        const items = readOnly ? cart.map(e => ({ ...e })) : cart
        const currency = items[0]?.currency || ''

        const calcTotal = () => items.reduce((s, e) => s + e.price * e.qty, 0)
        const calcCount = () => items.reduce((n, e) => n + e.qty, 0)

        const rowHtml = (e, i) => {
            const thumb = e.image
                ? `<img src="${escapeHtml(e.image)}" alt="">`
                : `<i class="fas fa-box-open"></i>`
            const stepper = readOnly
                ? `<div class="nui-wa-cart-qty-readonly">×${e.qty}</div>`
                : `<div class="nui-wa-cart-stepper">
                       <button type="button" class="nui-wa-cart-qty-btn" data-delta="-1">−</button>
                       <span class="nui-wa-cart-qty">${e.qty}</span>
                       <button type="button" class="nui-wa-cart-qty-btn" data-delta="1">+</button>
                   </div>`
            return `
                <div class="nui-wa-cart-row" data-cart-idx="${i}">
                    <div class="nui-wa-cart-thumb">${thumb}</div>
                    <div class="nui-wa-cart-info">
                        <div class="nui-wa-cart-name">${escapeHtml(e.name)}</div>
                        ${stepper}
                    </div>
                    <div class="nui-wa-cart-price">${escapeHtml(currency)} ${e.price.toFixed(2)}</div>
                </div>
            `
        }

        const html = `
            <div class="nui-wa-fs-modal nui-wa-cart-modal">
                <div class="nui-wa-fs-header">
                    <button type="button" class="nui-wa-fs-back" aria-label="Close">
                        <i class="fas fa-times"></i>
                    </button>
                    <div class="nui-wa-fs-title">
                        Your Cart
                        <div class="nui-wa-fs-subtitle"><span class="nui-wa-cart-count">${calcCount()}</span> items</div>
                    </div>
                    <div class="nui-wa-fs-action-spacer"></div>
                </div>
                <div class="nui-wa-fs-body">
                    <div class="nui-wa-cart-list">${items.map(rowHtml).join('')}</div>
                    <div class="nui-wa-cart-summary">
                        <div class="nui-wa-cart-summary-row">
                            <span>Estimated total</span>
                            <strong class="nui-wa-cart-total">${escapeHtml(currency)} ${calcTotal().toFixed(2)}</strong>
                        </div>
                        <div class="nui-wa-cart-disclaimer">
                            By continuing, you agree to share your name, profile name and phone number with the business so it can confirm your order and total, including any tax, fees and discounts.
                        </div>
                    </div>
                </div>
                ${readOnly ? '' : `
                    <div class="nui-wa-cart-footer">
                        <button type="button" class="nui-wa-cart-place-order-btn">Place order</button>
                    </div>
                `}
            </div>
        `

        this._openModal(html, ($overlay) => {
            const refresh = () => {
                $overlay.find('.nui-wa-cart-count').text(calcCount())
                $overlay.find('.nui-wa-cart-total').text(`${currency} ${calcTotal().toFixed(2)}`)
            }

            $overlay.find('.nui-wa-fs-back').on('click', () => this._closeModal())

            if (!readOnly) {
                $overlay.on('click', '.nui-wa-cart-qty-btn', (e) => {
                    const $btn = $(e.currentTarget)
                    const $row = $btn.closest('.nui-wa-cart-row')
                    const idx = parseInt($row.attr('data-cart-idx'))
                    const delta = parseInt($btn.attr('data-delta'))
                    const next = Math.max(0, items[idx].qty + delta)
                    items[idx].qty = next
                    if (next === 0) {
                        $row.remove()
                    } else {
                        $row.find('.nui-wa-cart-qty').text(next)
                    }
                    refresh()
                    this._refreshFloatingCart()
                    if (calcCount() === 0) this._closeModal()
                })

                $overlay.find('.nui-wa-cart-place-order-btn').on('click', () => {
                    const productItems = items.filter(e => e.qty > 0).map(e => ({
                        product_retailer_id: e.retailerId,
                        quantity: e.qty,
                        item_price: e.price,
                        currency: e.currency
                    }))
                    if (!productItems.length) return
                    const firstThumb = items.find(e => e.qty > 0 && e.image)?.image || null
                    const finalCart = items.filter(e => e.qty > 0)
                    this._closeModal()
                    if (onOrdered) onOrdered()
                    this._sendOrderReply({ catalogId, productItems, firstThumb, cart: finalCart })
                })
            }
        })
    }

    _messageHtml(m) {
        const side = m.isSent ? 'is-sent' : 'is-received'
        const time = formatTime(m.timestamp || Date.now())

        if (m.kind === 'text') {
            const replyCtx = m.replyContext ? `
                <div class="nui-wa-reply-context">
                    <div class="nui-wa-reply-context-text">${escapeHtml(m.replyContext)}</div>
                </div>` : ''
            return `
                <div class="nui-wa-message ${side}" data-msg-id="${escapeHtml(m.id)}">
                    ${replyCtx}
                    <div class="nui-wa-text">${formatWAText(m.text)}</div>
                    <span class="nui-wa-time">${escapeHtml(time)}${statusChecksHtml(m)}</span>
                </div>
            `
        }

        if (m.kind === 'interactive_button') {
            const buttons = (m.buttons || []).map((b) => `
                <button type="button"
                        class="nui-wa-interactive-button"
                        data-btn-id="${escapeHtml(b.id)}"
                        data-btn-title="${escapeHtml(b.title)}">
                    <i class="fas fa-reply nui-wa-btn-icon"></i>
                    ${escapeHtml(b.title)}
                </button>
            `).join('')
            return `
                <div class="nui-wa-message ${side}" data-msg-id="${escapeHtml(m.id)}" data-kind="interactive_button">
                    <div class="nui-wa-interactive">
                        ${m.header ? `<div class="nui-wa-interactive-header">${formatWAText(m.header)}</div>` : ''}
                        <div class="nui-wa-interactive-body">${formatWAText(m.body)}</div>
                        ${m.footer ? `<div class="nui-wa-interactive-footer">${formatWAText(m.footer)}</div>` : ''}
                        <div class="nui-wa-interactive-time">${escapeHtml(time)}</div>
                        <div class="nui-wa-interactive-buttons">${buttons}</div>
                    </div>
                </div>
            `
        }

        if (m.kind === 'interactive_list') {
            const sections = (m.sections || []).map((s) => {
                const rows = (s.rows || []).map((r) => `
                    <div class="nui-wa-list-row"
                         data-row-id="${escapeHtml(r.id)}"
                         data-row-title="${escapeHtml(r.title)}"
                         data-row-description="${escapeHtml(r.description || '')}">
                        <div class="nui-wa-list-row-body">
                            <div class="nui-wa-list-row-title">${escapeHtml(r.title)}</div>
                            ${r.description ? `<div class="nui-wa-list-row-description">${escapeHtml(r.description)}</div>` : ''}
                        </div>
                        <i class="fas fa-chevron-right nui-wa-list-row-arrow"></i>
                    </div>
                `).join('')
                return `
                    ${s.title ? `<div class="nui-wa-list-section-title">${escapeHtml(s.title)}</div>` : ''}
                    ${rows}
                `
            }).join('')
            return `
                <div class="nui-wa-message ${side}" data-msg-id="${escapeHtml(m.id)}" data-kind="interactive_list">
                    <div class="nui-wa-interactive">
                        ${m.header ? `<div class="nui-wa-interactive-header">${formatWAText(m.header)}</div>` : ''}
                        <div class="nui-wa-interactive-body">${formatWAText(m.body)}</div>
                        ${m.footer ? `<div class="nui-wa-interactive-footer">${formatWAText(m.footer)}</div>` : ''}
                        <div class="nui-wa-interactive-time">${escapeHtml(time)}</div>
                        <div class="nui-wa-list-toggle">
                            <i class="fas fa-list-ul nui-wa-btn-icon"></i>
                            ${escapeHtml(m.button || 'Open')}
                        </div>
                        <div class="nui-wa-list-sections">${sections}</div>
                    </div>
                </div>
            `
        }

        if (m.kind === 'location') {
            const z = 15
            const { x, y } = latLngToTileXY(m.latitude, m.longitude, z)
            // OSM tile — single tile thumbnail (centered approximately on coords).
            const tileUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
            const mapsHref = `https://www.openstreetmap.org/?mlat=${m.latitude}&mlon=${m.longitude}#map=${z}/${m.latitude}/${m.longitude}`
            return `
                <div class="nui-wa-message nui-wa-message-media ${side}" data-msg-id="${escapeHtml(m.id)}" data-kind="location">
                    <a class="nui-wa-location" href="${escapeHtml(mapsHref)}" target="_blank" rel="noopener">
                        <div class="nui-wa-location-map" style="background-image:url('${escapeHtml(tileUrl)}')">
                            <div class="nui-wa-location-pin"><i class="fas fa-map-marker-alt"></i></div>
                        </div>
                        <div class="nui-wa-location-meta">
                            ${m.name ? `<div class="nui-wa-location-name">${escapeHtml(m.name)}</div>` : ''}
                            ${m.address ? `<div class="nui-wa-location-address">${escapeHtml(m.address)}</div>` : ''}
                            <div class="nui-wa-location-hint">Open in Maps</div>
                        </div>
                    </a>
                    <span class="nui-wa-time">${escapeHtml(time)}${statusChecksHtml(m)}</span>
                </div>
            `
        }

        if (m.kind === 'image') {
            return `
                <div class="nui-wa-message nui-wa-message-media ${side}" data-msg-id="${escapeHtml(m.id)}" data-kind="image">
                    <a class="nui-wa-image-link" href="${escapeHtml(m.url)}" target="_blank" rel="noopener">
                        <img class="nui-wa-image" src="${escapeHtml(m.url)}" alt="${escapeHtml(m.caption || 'image')}" loading="lazy">
                    </a>
                    ${m.caption ? `<div class="nui-wa-image-caption">${formatWAText(m.caption)}</div>` : ''}
                    <span class="nui-wa-time">${escapeHtml(time)}${statusChecksHtml(m)}</span>
                </div>
            `
        }

        if (m.kind === 'video') {
            // preload="metadata" so opening a journey costs a few KB, not the
            // whole file — the poster carries the bubble until someone presses
            // play. playsinline keeps iOS from hijacking to a fullscreen player.
            return `
                <div class="nui-wa-message nui-wa-message-media nui-wa-message-video ${side}" data-msg-id="${escapeHtml(m.id)}" data-kind="video">
                    <div class="nui-wa-video-wrap">
                        <video class="nui-wa-video"
                               src="${escapeHtml(m.url)}"
                               ${m.poster ? `poster="${escapeHtml(m.poster)}"` : ''}
                               playsinline preload="metadata"></video>
                        <button class="nui-wa-video-play" type="button" aria-label="Play video"></button>
                    </div>
                    ${m.caption ? `<div class="nui-wa-image-caption">${formatWAText(m.caption)}</div>` : ''}
                    <span class="nui-wa-time">${escapeHtml(time)}${statusChecksHtml(m)}</span>
                </div>
            `
        }

        if (m.kind === 'document') {
            const ext = (m.filename.split('.').pop() || 'file').toUpperCase()
            return `
                <div class="nui-wa-message ${side}" data-msg-id="${escapeHtml(m.id)}" data-kind="document">
                    <a class="nui-wa-document" href="${escapeHtml(m.url)}" target="_blank" rel="noopener" download="${escapeHtml(m.filename)}">
                        <div class="nui-wa-document-icon">${escapeHtml(ext)}</div>
                        <div class="nui-wa-document-meta">
                            <div class="nui-wa-document-filename">${escapeHtml(m.filename)}</div>
                            <div class="nui-wa-document-hint">Tap to open</div>
                        </div>
                    </a>
                    ${m.caption ? `<div class="nui-wa-document-caption">${escapeHtml(m.caption)}</div>` : ''}
                    <span class="nui-wa-time">${escapeHtml(time)}${statusChecksHtml(m)}</span>
                </div>
            `
        }

        if (m.kind === 'interactive_location_request') {
            return `
                <div class="nui-wa-message ${side}" data-msg-id="${escapeHtml(m.id)}" data-kind="interactive_location_request">
                    <div class="nui-wa-interactive">
                        <div class="nui-wa-interactive-body">${formatWAText(m.body)}</div>
                        <div class="nui-wa-interactive-time">${escapeHtml(time)}</div>
                        <button type="button" class="nui-wa-cta-url-button nui-wa-send-location-btn">
                            <i class="fas fa-location-arrow"></i>
                            Send location
                        </button>
                    </div>
                </div>
            `
        }

        if (m.kind === 'product_list') {
            const productCount = (m.sections || []).reduce((n, s) => n + (s.products || []).length, 0)
            const firstProduct = (m.sections || []).flatMap(s => s.products || []).find(p => p)
            const firstImage = firstProduct?.image
            const thumbHtml = firstImage
                ? `<img class="nui-wa-mpm-bubble-thumb" src="${escapeHtml(firstImage)}" alt="">`
                : `<div class="nui-wa-mpm-bubble-thumb-placeholder"><i class="fas fa-store"></i></div>`
            return `
                <div class="nui-wa-message ${side}" data-msg-id="${escapeHtml(m.id)}" data-kind="product_list">
                    <div class="nui-wa-interactive nui-wa-interactive--mpm">
                        <div class="nui-wa-mpm-bubble-card">
                            ${thumbHtml}
                            <div class="nui-wa-mpm-bubble-meta">
                                <div class="nui-wa-mpm-bubble-title">${escapeHtml(m.header || 'Your Selection')}</div>
                                ${productCount > 0 ? `<div class="nui-wa-mpm-bubble-count">${productCount} item${productCount === 1 ? '' : 's'}</div>` : ''}
                            </div>
                        </div>
                        <div class="nui-wa-mpm-bubble-divider"></div>
                        <div class="nui-wa-interactive-body">${formatWAText(m.body)}</div>
                        <div class="nui-wa-interactive-time">${escapeHtml(time)}</div>
                        <button type="button" class="nui-wa-cta-url-button nui-wa-mpm-open-btn">
                            <i class="fas fa-shopping-bag"></i>
                            ${escapeHtml(m.button || 'View items')}
                        </button>
                    </div>
                </div>
            `
        }

        if (m.kind === 'cart_sent') {
            const thumb = m.firstThumb
                ? `<img src="${escapeHtml(m.firstThumb)}" alt="">`
                : `<div class="nui-wa-product-thumb-placeholder"><i class="fas fa-shopping-cart"></i></div>`
            const totalText = `${escapeHtml(m.currency === 'USD' ? '$' : (m.currency || ''))}${(Number(m.total) || 0).toFixed(2)}`.trim()
            return `
                <div class="nui-wa-message ${side}" data-msg-id="${escapeHtml(m.id)}" data-kind="cart_sent">
                    <div class="nui-wa-cart-bubble-header">Order via catalog</div>
                    <div class="nui-wa-cart-bubble">
                        <div class="nui-wa-cart-bubble-thumb">${thumb}</div>
                        <div class="nui-wa-cart-bubble-info">
                            <div class="nui-wa-cart-bubble-count">
                                <i class="fas fa-shopping-cart nui-wa-cart-bubble-icon"></i>
                                ${escapeHtml(String(m.itemCount))} item${m.itemCount === 1 ? '' : 's'}
                            </div>
                            <div class="nui-wa-cart-bubble-total">${totalText} (estimated total)</div>
                        </div>
                    </div>
                    <span class="nui-wa-time nui-wa-time-cart">${escapeHtml(time)}${statusChecksHtml(m)}</span>
                    <button type="button" class="nui-wa-cta-url-button nui-wa-cart-bubble-link">
                        View details
                    </button>
                </div>
            `
        }

        if (m.kind === 'catalog_message') {
            const thumb = m.thumbnailProduct
            const thumbHtml = thumb?.image_url
                ? `<div class="nui-wa-catalog-msg-hero"><img src="${escapeHtml(thumb.image_url)}" alt=""></div>`
                : ''
            return `
                <div class="nui-wa-message ${side}" data-msg-id="${escapeHtml(m.id)}" data-kind="catalog_message" data-catalog-id="${escapeHtml(m.catalogId || '')}">
                    <div class="nui-wa-interactive">
                        ${thumbHtml}
                        <div class="nui-wa-interactive-body">${formatWAText(m.body)}</div>
                        ${m.footer ? `<div class="nui-wa-interactive-footer">${formatWAText(m.footer)}</div>` : ''}
                        <div class="nui-wa-interactive-time">${escapeHtml(time)}${statusChecksHtml(m)}</div>
                        <button type="button" class="nui-wa-cta-url-button nui-wa-catalog-open-btn">
                            <i class="fas fa-store"></i>
                            View catalog
                        </button>
                    </div>
                </div>
            `
        }

        if (m.kind === 'carousel') {
            const cardsHtml = (m.cards || []).map((c, i) => {
                const img = c.image
                    ? `<img class="nui-wa-carousel-image" src="${escapeHtml(c.image)}" alt="" loading="lazy">`
                    : `<div class="nui-wa-carousel-image nui-wa-carousel-image-placeholder"><i class="fas fa-image"></i></div>`
                const buttons = (c.buttons || []).map((b, bi) => {
                    if (b.type === 'url') {
                        return `<a class="nui-wa-carousel-btn" href="${escapeHtml(b.url)}" target="_blank" rel="noopener" data-btn-kind="url">
                                    <i class="fas fa-arrow-up-right-from-square"></i>
                                    ${escapeHtml(b.text || 'Open')}
                                </a>`
                    }
                    if (b.type === 'phone_number') {
                        return `<a class="nui-wa-carousel-btn" href="tel:${escapeHtml(b.phoneNumber)}" data-btn-kind="phone">
                                    <i class="fas fa-phone"></i>
                                    ${escapeHtml(b.text || 'Call')}
                                </a>`
                    }
                    return `<button type="button" class="nui-wa-carousel-btn"
                                data-btn-kind="quick_reply"
                                data-card-idx="${i}"
                                data-btn-idx="${bi}"
                                data-btn-id="${escapeHtml(b.id || b.text || '')}"
                                data-btn-title="${escapeHtml(b.text || '')}">
                                <i class="fas fa-reply"></i>
                                ${escapeHtml(b.text || 'Reply')}
                            </button>`
                }).join('')
                return `
                    <div class="nui-wa-carousel-card" data-card-idx="${i}">
                        ${img}
                        <div class="nui-wa-carousel-body">${formatWAText(c.text || '')}</div>
                        ${buttons ? `<div class="nui-wa-carousel-buttons">${buttons}</div>` : ''}
                    </div>
                `
            }).join('')
            return `
                <div class="nui-wa-message ${side}" data-msg-id="${escapeHtml(m.id)}" data-kind="carousel">
                    ${m.body ? `<div class="nui-wa-carousel-intro">${formatWAText(m.body)}</div>` : ''}
                    <div class="nui-wa-carousel-track">${cardsHtml}</div>
                    <div class="nui-wa-carousel-meta">
                        <span class="nui-wa-time">${escapeHtml(time)}${statusChecksHtml(m)}</span>
                    </div>
                </div>
            `
        }

        if (m.kind === 'interactive_cta_url') {
            return `
                <div class="nui-wa-message ${side}" data-msg-id="${escapeHtml(m.id)}" data-kind="interactive_cta_url">
                    <div class="nui-wa-interactive">
                        ${m.header ? `<div class="nui-wa-interactive-header">${formatWAText(m.header)}</div>` : ''}
                        <div class="nui-wa-interactive-body">${formatWAText(m.body)}</div>
                        ${m.footer ? `<div class="nui-wa-interactive-footer">${formatWAText(m.footer)}</div>` : ''}
                        <div class="nui-wa-interactive-time">${escapeHtml(time)}</div>
                        <a class="nui-wa-cta-url-button" href="${escapeHtml(m.ctaUrl)}" target="_blank" rel="noopener">
                            <i class="fas fa-arrow-up-right-from-square"></i>
                            ${escapeHtml(m.ctaText || 'Open')}
                        </a>
                    </div>
                </div>
            `
        }

        if (m.kind === 'interactive_flow') {
            const screens = m.flowScreens || []
            const total = screens.length

            const _fieldHtml = (f) => {
                const name = f.id
                let input
                if (f.type === 'textarea') {
                    input = `<textarea class="nui-wa-flow-input" name="${escapeHtml(name)}" placeholder="${escapeHtml(f.label)}" rows="3"></textarea>`
                } else if (f.type === 'select') {
                    const opts = (f.options || []).map(o =>
                        `<option value="${escapeHtml(o.id)}">${escapeHtml(o.title)}</option>`
                    ).join('')
                    input = `<select class="nui-wa-flow-input nui-wa-flow-select" name="${escapeHtml(name)}"><option value="">— select —</option>${opts}</select>`
                } else if (f.type === 'radio') {
                    const radios = (f.options || []).map(o => `
                        <label class="nui-wa-flow-radio-option">
                            <input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(o.id)}">
                            <span>${escapeHtml(o.title)}</span>
                        </label>`).join('')
                    input = `<div class="nui-wa-flow-radio-group">${radios}</div>`
                } else {
                    input = `<input class="nui-wa-flow-input" type="text" name="${escapeHtml(name)}" placeholder="${escapeHtml(f.label)}">`
                }
                const questionHtml = f.question
                    ? `<div class="nui-wa-flow-question">${escapeHtml(f.question)}</div>`
                    : ''
                return `<div class="nui-wa-flow-field">
                    ${questionHtml}<label class="nui-wa-flow-label">${escapeHtml(f.label)}${f.required ? ' *' : ''}</label>
                    ${input}
                </div>`
            }

            const screensHtml = total ? screens.map((s, i) => `
                <div class="nui-wa-flow-screen${i === 0 ? ' is-active' : ''}" data-screen-index="${i}" ${i > 0 ? 'style="display:none"' : ''}>
                    ${s.title ? `<div class="nui-wa-flow-screen-title">${escapeHtml(s.title)}</div>` : ''}
                    <div class="nui-wa-flow-fields">${(s.fields || []).map(_fieldHtml).join('')}</div>
                    <div class="nui-wa-flow-screen-actions">
                        ${i < total - 1
                            ? `<button type="button" class="nui-wa-flow-next-btn">Next</button>`
                            : `<button type="submit" class="nui-wa-flow-submit-btn">Submit</button>`}
                    </div>
                </div>`).join('')
            : `<div class="nui-wa-flow-screen is-active" data-screen-index="0">
                <div class="nui-wa-flow-fields">
                    <div class="nui-wa-flow-field">
                        <label class="nui-wa-flow-label">Response</label>
                        <textarea class="nui-wa-flow-input" name="response" rows="3" placeholder="Type your response..."></textarea>
                    </div>
                </div>
                <div class="nui-wa-flow-screen-actions">
                    <button type="submit" class="nui-wa-flow-submit-btn">Submit</button>
                </div>
            </div>`

            return `
                <div class="nui-wa-message ${side}" data-msg-id="${escapeHtml(m.id)}" data-kind="interactive_flow" data-flow-token="${escapeHtml(m.flowToken || '')}">
                    <div class="nui-wa-interactive">
                        ${m.header ? `<div class="nui-wa-interactive-header">${formatWAText(m.header)}</div>` : ''}
                        <div class="nui-wa-interactive-body">${formatWAText(m.body)}</div>
                        ${m.footer ? `<div class="nui-wa-interactive-footer">${formatWAText(m.footer)}</div>` : ''}
                        <div class="nui-wa-interactive-time">${escapeHtml(time)}</div>
                        <button type="button" class="nui-wa-flow-open-btn nui-wa-cta-url-button">
                            <i class="fas fa-clipboard-list"></i>
                            ${escapeHtml(m.ctaText || 'Fill form')}
                        </button>
                        <div class="nui-wa-flow-modal" style="display:none">
                            ${total > 1 ? `<div class="nui-wa-flow-progress">Step <span class="nui-wa-flow-step">1</span> of ${total}</div>` : ''}
                            <form class="nui-wa-flow-form">${screensHtml}</form>
                        </div>
                        <div class="nui-wa-flow-submitted" style="display:none">
                            <span class="nui-wa-flow-submitted-label"><i class="fas fa-check-circle"></i> Submitted</span>
                        </div>
                    </div>
                </div>
            `
        }

        if (m.kind === 'template') {
            let headerHtml = ''
            if (m.header?.type === 'image') {
                headerHtml = `<div class="nui-wa-template-header-img"><img src="${escapeHtml(m.header.url)}" alt=""></div>`
            } else if (m.header?.type === 'text' && m.header.text) {
                headerHtml = `<div class="nui-wa-interactive-header">${formatWAText(m.header.text)}</div>`
            }
            const buttons = (m.buttons || []).map((b) => {
                if (b.type === 'url') {
                    return `<a class="nui-wa-cta-url-button" href="${escapeHtml(b.url || '#')}" target="_blank" rel="noopener">
                                <i class="fas fa-arrow-up-right-from-square"></i>
                                ${escapeHtml(b.text || 'Open')}
                            </a>`
                }
                return `<button type="button" class="nui-wa-interactive-button nui-wa-template-qr-btn"
                            data-btn-id="${escapeHtml(b.id || b.text || '')}"
                            data-btn-title="${escapeHtml(b.text || '')}">
                            <i class="fas fa-reply nui-wa-btn-icon"></i>
                            ${escapeHtml(b.text || 'Reply')}
                        </button>`
            }).join('')
            return `
                <div class="nui-wa-message ${side}" data-msg-id="${escapeHtml(m.id)}" data-kind="template">
                    <div class="nui-wa-interactive">
                        ${headerHtml}
                        <div class="nui-wa-interactive-body">${formatWAText(m.body)}</div>
                        ${m.footer ? `<div class="nui-wa-interactive-footer">${formatWAText(m.footer)}</div>` : ''}
                        <div class="nui-wa-template-meta">
                            <span class="nui-wa-time">${escapeHtml(time)}${statusChecksHtml(m)}</span>
                        </div>
                        ${buttons ? `<div class="nui-wa-interactive-buttons">${buttons}</div>` : ''}
                    </div>
                </div>
            `
        }

        return `
            <div class="nui-wa-message ${side}" data-msg-id="${escapeHtml(m.id)}">
                <div class="nui-wa-text">${escapeHtml(m.text || '[unsupported]')}</div>
                <span class="nui-wa-time">${escapeHtml(time)}${statusChecksHtml(m)}</span>
            </div>
        `
    }

    // Demo-only: mark the list row / button the scripted customer selects (by id,
    // falling back to a title match) so the choice is visually tied to its menu.
    _markDemoSelection($items, m, idAttr, titleSel) {
        if (!m.selectedId && !m.selectedTitle) return
        let $match = $()
        if (m.selectedId != null && m.selectedId !== '') {
            $match = $items.filter((_, el) => el.getAttribute(idAttr) === String(m.selectedId))
        }
        if (!$match.length && m.selectedTitle) {
            const want = String(m.selectedTitle).trim().toLowerCase()
            $match = $items.filter((_, el) => {
                const t = titleSel ? $(el).find(titleSel).text() : (el.getAttribute('data-btn-title') || el.textContent)
                return String(t).trim().toLowerCase() === want
            })
        }
        $match.first().addClass('is-selected')
    }

    _wireMessageInteractions($el, m) {
        // Demo/static transcript: the customer's replies are already scripted as
        // their own turns, so interactive controls must not fire real replies.
        // Instead, render menus OPEN and highlight the option the next turn picks,
        // so it reads as "the selection happened from this menu".
        if (this._demo) {
            if (m.kind === 'interactive_list') {
                const $toggle = $el.find('.nui-wa-list-toggle')
                const $sections = $el.find('.nui-wa-list-sections')
                $sections.addClass('is-open') // reveal the options by default
                $toggle.on('click', () => $sections.toggleClass('is-open')) // still collapsible
                this._markDemoSelection($el.find('.nui-wa-list-row'), m, 'data-row-id', '.nui-wa-list-row-title')
            } else if (m.kind === 'interactive_button') {
                this._markDemoSelection($el.find('.nui-wa-interactive-button'), m, 'data-btn-id', null)
            } else if (m.kind === 'carousel') {
                // A scripted tap on a card button highlights that card's button,
                // the same way a menu selection is tied back to its menu.
                this._markDemoSelection($el.find('.nui-wa-carousel-btn'), m, 'data-btn-id', null)
            }
            return
        }
        if (m.kind === 'catalog_message') {
            $el.find('.nui-wa-catalog-open-btn').on('click', () => this._openHeaderCatalog())
            return
        }
        if (m.kind === 'interactive_flow') {
            const $openBtn = $el.find('.nui-wa-flow-open-btn')
            const $modal = $el.find('.nui-wa-flow-modal')
            const $form = $el.find('.nui-wa-flow-form')
            const $submitted = $el.find('.nui-wa-flow-submitted')
            const $step = $el.find('.nui-wa-flow-step')
            const flowToken = $el.attr('data-flow-token') || ''

            $openBtn.on('click', () => {
                $openBtn.hide()
                $modal.show()
                $modal.find('.nui-wa-flow-input').first().focus()
            })

            // Next — advance to next screen
            $form.on('click', '.nui-wa-flow-next-btn', () => {
                const $cur = $form.find('.nui-wa-flow-screen.is-active')
                const idx = parseInt($cur.attr('data-screen-index'))
                const $next = $form.find(`.nui-wa-flow-screen[data-screen-index="${idx + 1}"]`)
                if ($next.length) {
                    $cur.hide().removeClass('is-active')
                    $next.show().addClass('is-active')
                    $step.text(idx + 2)
                    $next.find('.nui-wa-flow-input').first().focus()
                }
            })

            $form.on('submit', (e) => {
                e.preventDefault()
                const responseJson = {}
                // collect text, textarea, select (across all screens)
                $form.find('.nui-wa-flow-input').each((_, el) => {
                    const name = el.getAttribute('name')
                    if (name) responseJson[name] = $(el).val()
                })
                // collect checked radio buttons (across all screens)
                $form.find('input[type="radio"]:checked').each((_, el) => {
                    const name = el.getAttribute('name')
                    if (name) responseJson[name] = el.value
                })
                $modal.hide()
                $submitted.show()
                this._sendFlowReply({ flowToken, responseJson: JSON.stringify(responseJson) })
            })
            return
        }
        if (m.kind === 'product_list') {
            $el.find('.nui-wa-mpm-open-btn').on('click', () => {
                this._openProductListModal(m)
            })
            return
        }
        if (m.kind === 'cart_sent') {
            $el.find('.nui-wa-cart-bubble-link').on('click', () => {
                if (m.cart) this._openCartModal({ catalogId: m.catalogId || '', cart: m.cart, readOnly: true })
            })
            return
        }
        if (m.kind === 'interactive_location_request') {
            const $btn = $el.find('.nui-wa-send-location-btn')
            $btn.on('click', async () => {
                $btn.addClass('is-disabled').text('Getting location…')
                const coords = await this._requestGeolocation()
                this._sendLocationReply(coords)
            })
            return
        }
        if (m.kind === 'template') {
            $el.find('.nui-wa-template-qr-btn').on('click', (e) => {
                $el.find('.nui-wa-template-qr-btn').addClass('is-disabled').off('click')
                const id = e.currentTarget.getAttribute('data-btn-id')
                const title = e.currentTarget.getAttribute('data-btn-title')
                const replyContext = $el.find('.nui-wa-interactive-body').text().trim().substring(0, 80)
                this._sendInteractiveReply({ type: 'button_reply', id, title, replyContext })
            })
            return
        }
        if (m.kind === 'carousel') {
            $el.find('.nui-wa-carousel-btn[data-btn-kind="quick_reply"]').on('click', (e) => {
                const $btn = $(e.currentTarget)
                if ($btn.hasClass('is-disabled')) return
                // Disable all quick-reply buttons in this carousel after one is tapped,
                // mirroring how the interactive_button bubble freezes after a choice.
                $el.find('.nui-wa-carousel-btn[data-btn-kind="quick_reply"]').addClass('is-disabled')
                const id = $btn.attr('data-btn-id')
                const title = $btn.attr('data-btn-title')
                const cardIdx = parseInt($btn.attr('data-card-idx'))
                const card = (m.cards || [])[cardIdx]
                // Strip the most common WA markdown markers so the reply context shows
                // clean text — preserves the source's newline so we can pick the first line.
                const replyContext = (card?.text || '')
                    .split('\n')[0]
                    .replace(/[*_~`]/g, '')
                    .slice(0, 80)
                this._sendInteractiveReply({ type: 'button_reply', id, title, replyContext })
            })
            return
        }
        if (m.kind === 'interactive_button') {
            $el.find('.nui-wa-interactive-button').on('click', (e) => {
                const $btns = $el.find('.nui-wa-interactive-button')
                $btns.addClass('is-disabled')
                const id = e.currentTarget.getAttribute('data-btn-id')
                const title = e.currentTarget.getAttribute('data-btn-title')
                const replyContext = $el.find('.nui-wa-interactive-body').text().trim().substring(0, 80)
                this._sendInteractiveReply({ type: 'button_reply', id, title, replyContext })
            })
        } else if (m.kind === 'interactive_list') {
            const $toggle = $el.find('.nui-wa-list-toggle')
            const $sections = $el.find('.nui-wa-list-sections')
            $toggle.on('click', () => $sections.toggleClass('is-open'))
            $el.find('.nui-wa-list-row').on('click', (e) => {
                $el.find('.nui-wa-list-row').off('click')
                $toggle.addClass('is-disabled')
                const id = e.currentTarget.getAttribute('data-row-id')
                const title = e.currentTarget.getAttribute('data-row-title')
                const description = e.currentTarget.getAttribute('data-row-description')
                const replyContext = $el.find('.nui-wa-interactive-body').text().trim().substring(0, 80)
                this._sendInteractiveReply({ type: 'list_reply', id, title, description, replyContext })
            })
        }
    }

    beforeDestroy() {
        this._cancelled = true
        clearTimeout(this._reconnectTimer)
        clearTimeout(this._scriptrReconnectTimer)
        clearTimeout(this._typingTimeout)
        clearTimeout(this._demoTimer)
        this._demoPlaying = false
        if (this._ws) {
            try { this._ws.close() } catch {}
            this._ws = null
        }
        if (this._scriptrChannel) {
            try { this._scriptrChannel.close() } catch {}
            this._scriptrChannel = null
        }
    }
}