# StockMarketLoop — design tokens

Sampled from live computed styles, Aug 2026. Your site runs **two** systems. Matching the right one per surface is what makes new work read as native.

---

## A. Creator Studio (`cs-*` / `le-*`) — logged-in creator screens

`/creator-studio/*`, `/go-live/`, `/upload-video/`

No CSS custom properties — values are hardcoded in the plugin's inline `<style>` blocks. The variables below are my naming, introduced in `letters-setup.css` so a future theme change is one file.

| Role | Value |
|---|---|
| page bg | `#070c15` |
| chrome (sidebar, topbar) | `#080d17` |
| card | `#0b131f` |
| raised (buttons, inputs) | `#0d1622` |
| hover | `#152234` |
| line — chrome | `#141d2a` |
| line — card | `#182130` |
| line — control | `#1e2a3a` |
| line — button | `#223146` |
| text | `#e6edf5` |
| text-2 | `#dbe6f2` |
| nav link | `#a9b8ca` |
| muted | `#8798ac` |
| dim | `#5d7189` |
| **primary** | `#2b6cff` → hover `#1f5ce6` |
| gold | `linear-gradient(90deg, #e0a336, #c8862a)` |
| published | `#22d97a` on `rgba(34,217,122,.14)` |
| danger | text `#ff8a9b`, bg `#180f14`, border `#2a1620`, hover `#ff566e` |

**Geometry:** cards `14px`, buttons `10px`, nav `9px`, pills `999px`. Sidebar `222px`. Content grid `minmax(0,1fr) / 330px`, gap `20px`, padding `22px 26px 60px`. `.cs-btn` height `48px`; `.cs-top-btn` height `42px`.

**Font:** Inter.

---

## B. Public LoopLetter — reader-facing pages

`/loop-letters/`, `/creator-studio/loop-letters/` (marketing), and the future `/n/:handle`

These **do** use custom properties. Use them directly — don't hardcode.

```css
--bg:         #05070a;
--bg-2:       #080b11;
--panel:      rgba(255,255,255,.038);
--panel-2:    rgba(255,255,255,.058);
--line:       rgba(255,255,255,.10);
--line-2:     rgba(255,255,255,.16);
--ink:        #eef2f7;
--ink-2:      #a8b3c4;
--ink-3:      #6f7d90;
--accent:     #00ff88;
--accent-2:   #00c46a;
--accent-dim: rgba(0,255,136,.12);
--red:        #ff5c5c;
--amber:      #ffc453;
--r:          16px;
--r-lg:       22px;
--maxw:       1180px;
--shadow:     0 24px 60px rgba(0,0,0,.55);
```

**Components to reuse rather than re-invent:**

- `.eyebrow` — uppercase accent pill, `.735rem`, letter-spacing `.14em`, on `--accent-dim` with a `rgba(0,255,136,.24)` border
- `.btn` — `.92rem 1.6rem`, radius `12px`, weight `700`
- `.btn--primary` — `linear-gradient(180deg, var(--accent), var(--accent-2))`, ink `#03210f`, glow `0 8px 30px rgba(0,255,136,.28)`, lifts `2px` on hover
- `.btn--outline-light` — `--line-2` border on `rgba(255,255,255,.04)`
- `.section`, `.section--alt`, `.grid--auto`, `.chip-row`, `.note`, `.board__rail`, `.board__panel`

**Font:** Inter.

---

## The rule

**Blue is a Studio word. Green is a reader word.** A creator managing their letter sees blue; anyone reading it sees green. Keeping that split is what stops the newsletter feature from feeling bolted on.

`letters-setup.css` follows system A because it lives inside the Studio shell. The public page at `/n/:handle` should follow system B, which means loading the existing LoopLetter stylesheet rather than shipping a second copy of these values.

**Note on per-creator accent colours:** the setup wizard currently offers a six-swatch accent picker. If public pages should be uniformly `#00ff88`, drop the "Look" step from `STEPS` in `letters-setup.js` and the `accent` key from the settings payload — the wizard becomes three steps and nothing else changes.

---

## Semantic exception

Ticker chips stay green-up / red-down on both systems, independent of any accent. A red-accent publication must not make every gainer look like a loss. `--red: #ff5c5c` on the public side, `#ff8a9b` in the Studio.
