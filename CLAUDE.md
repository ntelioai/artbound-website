# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This repository holds the **web assets and public-facing web presence** for **Artbound** — an AI-native, digital-first, global art auction infrastructure for art galleries. Scope includes the landing page, home page, marketing site, and associated brand assets.

Strategic planning, rollout plans, and platform specifications for Artbound live in a separate repository at `/Volumes/dev/Business/Products/ArtBound`. Refer there for product context; keep this repository focused on the web surface.

## Repository Structure

- [assets/](assets/) — brand and marketing assets
  - [assets/images/](assets/images/) — logos and image assets
    - `artbound-logo.svg` — **primary mark for web use**: the bowler-hat figure over the brass `ARTBOUND` wordmark, cropped to the artwork. Size it by `height` (aspect ≈ 0.86:1), never by `width`.
    - `artbound-mark.svg` — figure only, no wordmark. For favicons, avatars, and any place too small for the wordmark.
    - `favicon.png` — 512×512 export of `artbound-mark.svg`
    - `ArtBound logo.pxd` — Pixelmator source file for the logo (do not edit without the source tool; export from here)
    - `ArtBound-logo-colorful.png` — the previous multicolour wordmark. Retired; kept for reference only.
    - `source/artbound-logo.svg` — unmodified Pixelmator export (carries hidden alternate colourways); the two SVGs above are derived from its visible group
- [assets/demos/artbound/](assets/demos/artbound/) — the lot film and its poster, played inside the hero phone
- [emulator/](emulator/) — the WhatsApp emulator, vendored from `cartaja-website` (see below)
- [client_modules/ntelioUI2/](client_modules/ntelioUI2/) — the three ntelioUI2 files the emulator widget needs. Real files, not symlinks: `wrangler deploy` serves the repo directly and cannot follow a link
- [journeys/](journeys/) — scripted conversations (`*.emulator.yaml`) plus the chat avatar
- [js/artbound-emulator.js](js/artbound-emulator.js) — mounts the hero phone
- [.claude/skills/pptx/](.claude/skills/pptx/) — presentation tooling (shared with sibling repos)

## The hero phone (WhatsApp emulator)

The landing page hero plays a scripted ArtBound auction inside the **real emulator
widget** — the same `WhatsappEmulator` and scenario parser behind Cartaja's demo
gallery (`cartaja-website/demos/_artbound.html`), cut down to one journey and a
Play/Restart transport.

**Vendored from `/Volumes/dev/cartaja-website`.** The import paths inside the
widget are relative and self-loading (`WhatsappEmulator.js` → `whatsapp-emulator.css`,
`Widget.js` → `../css/core/loading.css`), so **the directory layout must be kept
exactly as it is**: `emulator/widgets/`, `emulator/lib/`, `client_modules/ntelioUI2/`.
Re-copy from Cartaja rather than editing these files in place.

**Runtime deps**, loaded from CDN in `index.html`: jQuery (the ntelioUI2 `Widget`
base throws without it) and Font Awesome (the widget renders `fas fa-*` glyphs).
No Bootstrap — the emulator does not use it.

**The journey is data.** `journeys/artbound-live-pipeline.emulator.yaml` is a
verbatim copy of Cartaja's, and every business line in it is a string the shipped
pipeline actually sends. Re-sync it when the pipeline wording changes; do not
invent copy for it.

- **The chat backdrop is self-hosted** at `emulator/media/`. The widget derives it
  from its `wabaEmulator` host, which the page sets to `window.location.origin` —
  never point production at Cartaja's emulator host. The **filename is fixed by the
  widget** (`cartaja-backdrop-whatsapp.png`), but the image is ArtBound's: Cartaja's
  centred watermark was patched out and the ArtBound mark composited in its place.
  Re-copying that file from Cartaja would put their logo in our hero.
- **The heads fall at the hammer.** Reaching the last message rains Magritte marks
  down the screen — the cart transition from `cartaja.com/the-story.html`, in
  ArtBound's mark, in its own colours. It falls for 10s and then tapers; leaving
  that last message early (Replay, or a step back) tapers it there instead.
  Skipped entirely under `prefers-reduced-motion`.
  - Heads are **turned, not squashed**: a plain horizontal scale reads as a
    flattened picture because both edges keep the same height. Each pose is a real
    perspective projection built from vertical slices (`z = x·sin(yaw)`,
    `s = D/(D+z)`), giving a trapezoid with a taller near edge. Poses are
    pre-rendered into sprites — slicing per head per frame would be thousands of
    draw calls a frame — and fixed per head; a head that turns while falling stops
    reading as a head.
  - **Size is the depth cue.** Heads draw smallest-first so near ones overlap far
    ones, and alpha scales with size, so the small ones wash out toward the
    wallpaper. Size, speed, stacking and contrast all agree about what is near.
- **Never let dev-account placeholders reach the page.** The source record for this
  journey carried a person's name as the sale title; a lot must only ever be
  labelled with its own work and sale.
- The widget applies its demo options inside an **async `init()`**, so driving the
  transport from outside immediately after construction gets overwritten. Pass
  `demoAutoplay` through the constructor instead — see the note in
  [js/artbound-emulator.js](js/artbound-emulator.js).

## Product Context (Summary)

Artbound operates as an auction infrastructure partner for art galleries. The public-facing web presence should communicate:

- **AI-native, WhatsApp-first** conversational auction mechanics
- **Gallery-centric positioning** — galleries retain curatorial authority, collector relationships, and data ownership; Artbound provides infrastructure
- **Discretion** — private, invitation-only auctions, not a public marketplace
- **Differentiation from** third-party marketplaces — galleries avoid over-reliance on those channels. Never name a competitor on the site; state the distinction in terms of what ArtBound is not (a channel, a feed, a marketplace)
- **Target audience** — primary-market galleries and high-net-worth collectors across North America, Europe, and the Middle East

Avoid positioning Artbound as a consumer marketplace or a replacement for gallery relationships. The tone is discreet, infrastructure-oriented, and gallery-first.

## Writing & Design Guidelines

1. **Gallery-first language** — the gallery is the relationship holder; Artbound is the infrastructure partner
2. **Discretion over spectacle** — avoid loud marketplace framing; lean into private, invitation-only cues
3. **Conversational, real-time** — highlight WhatsApp and AI-driven dialogue as the auction surface
4. **Restraint with the logo** — use `artbound-logo.svg` as the primary mark; do not recolor or distort. Its ink `#1c1c1c` and brass `#ae8e5b` are the brand pair — keep it on paper (`--paper`) or another quiet ground
5. **Global, multi-region audience** — copy should read well for North American, European, and Middle Eastern collectors

## Common Tasks

- Build and iterate on the landing page and home page
- Add or update marketing pages (about, for-galleries, for-collectors, contact)
- Integrate brand assets from [assets/images/](assets/images/)
- Maintain responsive, accessible, production-quality web UI

## Deployment

The site is a **Cloudflare Worker** named `artbound-www` in the **`Rabih@ntelio.ai`** account
(`78a22864ee639785fe86b6257a771450`). It serves `artbound.art` and `www.artbound.art`.

Do not confuse it with the Pages project `artbound` in the same account — that is the auction
*application* (`auction.artbound.art`), built from the separate `ntelioai/artbound` repo.

### Auto-deploy

Pushes to `main` deploy automatically via **Cloudflare Workers Builds** (native Git integration,
configured in the dashboard — no API token is stored in GitHub).

- Build command: *(none)*
- Deploy command: `npx wrangler deploy`
- Install: `npm ci` — `wrangler` is pinned in `package.json` / `package-lock.json`

To deploy by hand (needs `wrangler login`; the account must be selected because the token sees
several):

```
CLOUDFLARE_ACCOUNT_ID=78a22864ee639785fe86b6257a771450 npx wrangler deploy
```

### Static assets — important

`wrangler.jsonc` sets `assets.directory` to the **repository root**, so every file in the repo is a
candidate for public serving. [.assetsignore](.assetsignore) is the only thing keeping private files
off the web. **Any new tooling, config, or build artifact added to the root must be added there too**
— otherwise it is published at `https://artbound.art/<path>`.

Verify after a change:

```
curl -o /dev/null -w '%{http_code}\n' https://artbound.art/package.json   # expect 404
```

Note: `npx wrangler dev` reload-loops on this repo — it watches the assets directory (the root) and
its own `.wrangler/` cache writes inside it retrigger the build. Preview with any static file server
instead.

## Notes

- No build system or framework is set up yet — when introducing one, prefer a minimal, modern stack appropriate for a marketing site
- The `.pxd` logo source requires Pixelmator; export updated PNGs rather than editing in-place
- For strategic/product questions not answered here, see `/Volumes/dev/Business/Products/ArtBound/CLAUDE.md`
