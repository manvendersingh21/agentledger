# AgentLedger visual redesign — brief (reference: https://legencymedia.com/)

Goal: AgentLedger should look like the Legency Media site: a confident, editorial, light-first B2B aesthetic.
Keep every feature, data flow, API call and realtime behaviour exactly as it is — this is a visual redesign only.
Do NOT copy Legency's text, logo or client logos; borrow the visual language only.

## Visual language
- Canvas: light grey `#EFEFEF`; content on pure white cards `#FFFFFF` with 1px `#E4E4E4` borders, radius 6px (cards) / 4px (buttons). Lots of air.
- Accent: electric blue `#0000FF` (hover `#0000CC`), soft accent `#C8C8FF`, wash `#EEEEFF`.
- Ink: near-black `#0A0A0A`; secondary text `#5C5C5C`; tertiary `#8A8A8A`.
- Inverse surface: black cards `#050505` with white text (used for stat blocks / hero side-cards / the "blocked" moments).
- Status colors (restrained, flat pills, uppercase, letter-spaced, 11px): blocked `#E5002B` on `#FFE9EC`; waiting `#B25E00` on `#FFF2DE`; approved `#0000FF` on `#EEEEFF`; executed `#007A3D` on `#E3F7EC`; duplicate `#5B2EE5` on `#EFE9FF`; neutral `#5C5C5C` on `#F2F2F2`.
- Typography: display = `Inter Tight` (next/font/google) weight 600–700, tracking `-0.045em`, line-height 0.95, very large (hero 72–112px desktop, page titles 44–56px). Body = `Inter` 15–16px. Mono = `JetBrains Mono` for IDs, hashes, amounts, payloads. Accent words inside headlines are blue (e.g. "Give agents **authority** without giving them **control**." with the bold words blue).
- Floating pill header: white rounded bar (radius 8px, border) containing the wordmark (small pixel-cluster mark in blue + "AgentLedger") and a "Menu"/nav; on the right a separate solid blue CTA button + a square white arrow button (↘ icon) as a pair.
- Buttons: primary = solid blue, white text, 48px tall, paired with a square arrow tile; secondary = white with border; destructive = black. Hover: subtle darken + arrow nudges.
- Signature graphic: a dithered pixel globe/planet in blue tones (canvas or SVG of squares on a sphere with a ring), slowly rotating, used in the landing hero (right side) and dashboard overview header (smaller). Respect prefers-reduced-motion.
- Scatter-letter headline: section headings whose letters drift in from scattered positions on scroll into view (IntersectionObserver + CSS transforms), used sparingly (landing sections, overview).
- Small blue eyebrow labels above section titles ("Authorization", "Approvals", "Audit").
- Logo-strip style rows (used for merchants/agents): grayscale names in a 4-column grid.
- Data density inside the dashboard stays high but calm: tables on white cards, generous row height, mono numerals.

## Shared tokens (exact names — every agent uses these)
`app/globals.css` defines CSS vars and Tailwind v4 `@theme` colors:
`--color-canvas, --color-surface, --color-line, --color-ink, --color-ink-2, --color-ink-3, --color-accent, --color-accent-hover, --color-accent-soft, --color-accent-wash, --color-inverse, --color-blocked, --color-blocked-bg, --color-waiting, --color-waiting-bg, --color-approved, --color-approved-bg, --color-executed, --color-executed-bg, --color-duplicate, --color-duplicate-bg`
→ Tailwind classes like `bg-canvas`, `bg-surface`, `border-line`, `text-ink`, `text-ink-2`, `bg-accent`, `text-accent`, `bg-inverse`, `text-blocked`, `bg-blocked-bg` …
Fonts as CSS vars `--font-display`, `--font-sans`, `--font-mono` → classes `font-display`, `font-sans`, `font-mono`.
The old dark theme is retired: remove `className="dark"` usage; light-first. (Dark mode not required.)

## Shared brand components (owned by the design-system agent; others import them)
- `components/brand/pixel-globe.tsx` — `<PixelGlobe size={number} className? />` client canvas.
- `components/brand/scatter-heading.tsx` — `<ScatterHeading as="h2" text="..." accentWords={["..."]} className? />`.
- `components/brand/arrow-button.tsx` — `<ArrowButton href? onClick? variant="primary"|"secondary" disabled? type?>Label</ArrowButton>` renders the blue button + square arrow tile pair (Link when href).
- `components/brand/eyebrow.tsx` — `<Eyebrow>Label</Eyebrow>` small blue label.
- `components/brand/wordmark.tsx` — pixel-cluster mark + "AgentLedger".
- `components/ui/*` keep their existing exported names and props (Button, Card*, Badge, Input, Label, Switch, Checkbox, Separator, Skeleton, Table*, CodeBlock) — restyled only, APIs backward compatible. `components/status-badge.tsx` keeps StatusBadge/DecisionBadge APIs.
Page agents must NOT edit `app/globals.css`, `app/layout.tsx`, `components/ui/*`, `components/brand/*`, `components/status-badge.tsx`; if those don't exist yet when you start, write against the names above — they will exist.
