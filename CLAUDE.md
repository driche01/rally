# Rally — Project Rules for Claude Code

## What this project is

Rally is a group trip planning product launching as web + SMS (v1). Mobile app comes in v3. Full product context is in `/docs/rally_v1_scope.md`. Phase-specific build guides are in `/docs/rally_phase_[a|b|c]_build_guide.md`.

## Hard rules — never violate

1. **Schema is shared with the mobile app.** Never drop, rename, or alter existing columns. Only additive evolutions.
2. **Do not touch `/mobile`, `/expo`, or any iOS/Android code.** The Expo app is paused for v1. Schema, `/api`, `/sms-agent`, `/shared`, and `/web` only.
3. **Step 0 schema inspection is mandatory before any backend work in every phase.** Query `information_schema`, write `SCHEMA_REPORT.md` and `SCHEMA_PLAN.md`, wait for human approval before running migrations.
4. **Outbound SMS only in v1.** No inbound parsing. No two-way conversation. No NLU. Two-way SMS is parked until v2 (monetization unlock).
5. **When you hit a tradeoff that isn't explicitly specified in the current phase guide or scope doc, do not guess.** Write to `BUILD_QUESTIONS.md` using the protocol in the build guide and continue with non-blocked work. Mark entries `AWAITING HUMAN INPUT` and update to `RESOLVED: [decision]` after the human responds.
6. **The current phase's build guide supersedes the scope doc on implementation questions.** Scope doc explains why; build guide governs how.
7. **Do not proceed to a later phase without explicit human sign-off.** Phase A ends at its Definition of Done — stop, write the demo doc, wait. Same for B and C.
8. **The Design Gate in Phase A is a hard stop.** Build the prototype, push to localhost, wait for review. Do not skip or rush past it.
9. **Netlify deploys for Rally MUST go under the personal `driche01` team** (https://app.netlify.com/teams/driche01/projects). Never `cypress-health` or any other work team — Rally is personal infra, not work billing. Before running `netlify init`, `netlify sites:create`, or any deploy command that could create a new project: confirm with `netlify status` that the active CLI session is on `driche01`. If it isn't, `netlify logout && netlify login` with the `driche01@gmail.com` account FIRST. See `web/DEPLOY.md` for the full setup.
10. **`main` does not deploy. `release` does.** The `rally-web` Netlify project's production branch is `release`. Push your work to `main` as usual — that's free, no build runs. To ship to prod, push `main` to `release`: `git push origin origin/main:release`. This is a hard cost-control decision, not a suggestion. Never fast-forward `main` directly to `release` on every commit. Wait for the human to say "ship it" (or equivalent) before promoting.

## Working agreement for every session

When the human opens a session for a new phase:

1. Read `/docs/rally_v1_scope.md` end to end.
2. Read the phase build guide (`/docs/rally_phase_[a|b|c]_build_guide.md`) end to end. Then re-read it.
3. For Phases B and C: complete the **Phase 0 review BEFORE any other work**. Read prior phase demo docs, prior `BUILD_QUESTIONS.md`, re-run schema inspection, read the actual codebase as it exists. Write `PHASE_[B|C]_PRE_BUILD_REVIEW.md` and stop for human review.
4. Restate the hard rules back to the human in your own words before starting any work, so the human can confirm they're locked in.
5. Tell the human your plan for Step 0 before running it.

## Files you'll create across phases

- `SCHEMA_REPORT.md` — current state of the database schema (overwrite each phase)
- `SCHEMA_PLAN.md` — planned additive changes for the current phase (overwrite each phase)
- `BUILD_QUESTIONS.md` — running log of tradeoff questions per phase
- `PHASE_A_DEMO.md`, `PHASE_B_DEMO.md`, `PHASE_C_DEMO.md` — localhost handoff docs at the end of each phase
- `PHASE_B_PRE_BUILD_REVIEW.md`, `PHASE_C_PRE_BUILD_REVIEW.md` — pre-build reconciliation docs
- `V1_ALPHA_READY.md` — final readiness doc after Phase C

## Tone

When you write code comments, demo docs, or questions: be direct, no filler, no apologizing. When you surface a tradeoff, give the human your recommendation with a one-sentence rationale — don't just list options.
