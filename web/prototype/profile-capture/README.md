# Profile Capture Prototype

This is the Phase A Design Gate prototype (build guide §5). Standalone
HTML/CSS/JS. No backend. Mock data only.

## Run it

```bash
npx -y serve -s web/prototype/profile-capture -l 5174
```

Then open <http://localhost:5174>.

Or use the `phase-a-prototype` launch config in `.claude/launch.json`.

## Files

- `index.html` — all nine cards in DOM order. Only one is `[data-active]` at a time.
- `styles.css` — palette, card transitions, typography. Mobile-first.
- `app.js` — state, step transitions, timer, typeahead, summary.
- `airports.js` — mock IATA dataset (50 entries).

## Why it exists

The "required at first RSVP, sub-30-second, tap-driven" model is load-bearing for Phase B's
AI-drafted dashboard. If profile capture isn't fast and fun, the whole AI engine works with
thin data and the wedge weakens. This prototype proves the experience before the schema
locks.

## Acceptance criteria (build guide §5)

- Completion time end-to-end under 30 seconds for a test user
- No typing required except home airport
- Feels like a vibe quiz, not a form
- Works on mobile web

See `BUILD_QUESTIONS.md` Q8 for the open review items.
