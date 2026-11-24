# Rehearsal - CraneLiftShowcase (crane only)

**Gold:** `bento` (the only complete gold example in this skill install).
Kept its one-Stage-per-picture and root-scoped CSS pattern; the scene itself was
built for this brief.

**Brief answered:** put only the crane graphic in the login pane - no header,
no title, no status pill, no card chrome. The result is the crane and its
technical grid: a tower crane rigs a 12.4 t load at Harbour Rd, hoists it,
travels the jib and sets it down at Yard B. The two site labels and the weight
on the load are part of the crane drawing and stay.

**Medium/place:** A short loop beside the sign-in form. The scene is the hero:
it keeps a top-left gutter and runs off the right and bottom of the media pane.
The page is the ground - no plate, no panel, no shadow. The pane is hidden
below 768px, so `compact` serves the 768–900px range; both designs fill the
pane's height so there is no empty band under the shot.

**Look:** Light, cool greys, standard fidelity, accent `#237ead`
(`--color-brand-600`). One stroke family for the technical schematic; no
mascot, no invented logo, no UI text. The crane was pulled up and widened after
review - the first pass left too much air above the jib and around the sides.
It now fills the pane with a small, even gutter. The drawing was then scaled
to half size at the user's request: the crane art sits centred in the same
pane (`.cl-art { transform: scale(0.5) }`), with its labels sized up in the
design so they still read on screen. The login card was then shortened again:
the media pane is 22.5rem (`--auth-split-media` min-height in `index.css`),
the two Stage design heights are 372 / 392, and the art is translated to centre
in the *visible* crop - measured margins are equal left/right and top/bottom
within 1px at 1280px and 780px. The scene keeps its taller internal height so
the crane's base is never clipped by the shorter stage. The login card is
768px wide with an even 1fr / 1fr split, so the form and media panes are the
same width; the stage is centred in its pane with flex, which keeps the
measured relative to the visible grid, all four margins are equal within 1px
at 768, 900, 1280 and 1440px.

**Story (loop ~10.5s):** rigged load at Harbour Rd → hoist → travel → lower
onto Yard B → load holds ~3s → delivered load is absorbed into the pad, the
empty hook rises and returns, a fresh load is rigged. The poster is the
delivered frame. Nothing rewinds in view: the hook's empty return is a real
crane action and the new load arrives new.

## Beats / marks
`hoist` → `transit` → `lower` → `placed` → (hold) → `return` → ready, loop.

## Captured (frames looked at, not just code)
- Wide still, `--still --gate --reduced`, 1280px: `rehearsal passed`.
- Wide loop, `--gate`, 1280px, 18 frames at 700ms: `rehearsal passed`.
- Compact still, `--still --gate --reduced`, 780px: `rehearsal passed`.
- `npm run lint` (tsc) passes.

## Gate
Last line of `film.mjs --gate` on the wide loop:
`rehearsal passed (necessary, not sufficient: references/verify.md and the
fresh eye in review.md still stand)`.

## Film lines (judged, not silent)
- `inconclusive: sampling gaps` on the film: this machine drops frames; motion
  was judged from the 700ms contact sheet. Coverage was never green here.
- `jump: cl-rope / cl-rig / cl-crate ... -192px, +190px` and `appears / vanishes
  with no entrance / exit` on the tightened loop: the larger beats cross a
  dropped 385ms sampling gap, so the detector sees a whole move in one frame.
  `--at hoist --every 50 --slow 3` shows the load gliding up frame by frame and
  the load swap fading; the gate still passes. Intentional sampling artifact.
- The status roll and its film lines (`jump: ss-roll__item`, `lopsided:
  ss-badge`) no longer apply - the status pill was removed with the header.

## Assumptions
- "Only this" means the crane illustration from the reference image; the
  weight and the two site labels belong to that illustration.

## Unresolved
- The login pane is hidden below 768px; the compact design is verified at the
  780px host width but is not reachable at phone widths on the live page.

## Not checked
- No dark-theme or blueprint variant: the host login surface is light only.
- No independent fresh-eye reviewer after the final re-film.
