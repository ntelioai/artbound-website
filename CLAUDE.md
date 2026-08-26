# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This repository holds the **web assets and public-facing web presence** for **Artbound** — an AI-native, digital-first, global art auction infrastructure for art galleries. Scope includes the landing page, home page, marketing site, and associated brand assets.

Strategic planning, rollout plans, and platform specifications for Artbound live in a separate repository at `/Volumes/dev/Business/Products/ArtBound`. Refer there for product context; keep this repository focused on the web surface.

## Repository Structure

- [assets/](assets/) — brand and marketing assets
  - [assets/images/](assets/images/) — logos and image assets
    - `ArtBound logo.pxd` — Pixelmator source file for the logo (do not edit without the source tool; export PNGs from here)
    - `ArtBound-logo-colorful.png` — exported colorful logo, primary mark for web use
- [.claude/skills/pptx/](.claude/skills/pptx/) — presentation tooling (shared with sibling repos)

## Product Context (Summary)

Artbound operates as an auction infrastructure partner for art galleries. The public-facing web presence should communicate:

- **AI-native, WhatsApp-first** conversational auction mechanics
- **Gallery-centric positioning** — galleries retain curatorial authority, collector relationships, and data ownership; Artbound provides infrastructure
- **Discretion** — private, invitation-only auctions, not a public marketplace
- **Differentiation from** third-party marketplaces (Artsy, 1stDibs) — galleries avoid over-reliance on those channels
- **Target audience** — primary-market galleries and high-net-worth collectors across North America, Europe, and the Middle East

Avoid positioning Artbound as a consumer marketplace or a replacement for gallery relationships. The tone is discreet, infrastructure-oriented, and gallery-first.

## Writing & Design Guidelines

1. **Gallery-first language** — the gallery is the relationship holder; Artbound is the infrastructure partner
2. **Discretion over spectacle** — avoid loud marketplace framing; lean into private, invitation-only cues
3. **Conversational, real-time** — highlight WhatsApp and AI-driven dialogue as the auction surface
4. **Restraint with the logo** — use `ArtBound-logo-colorful.png` as the primary mark; do not recolor or distort
5. **Global, multi-region audience** — copy should read well for North American, European, and Middle Eastern collectors

## Common Tasks

- Build and iterate on the landing page and home page
- Add or update marketing pages (about, for-galleries, for-collectors, contact)
- Integrate brand assets from [assets/images/](assets/images/)
- Maintain responsive, accessible, production-quality web UI

## Deployment

The site is a **Cloudflare Worker** named `artbound-website` in the **`Rabih@ntelio.ai`** account
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
