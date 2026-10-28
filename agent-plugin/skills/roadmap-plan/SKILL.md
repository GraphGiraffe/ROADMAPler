---
name: roadmap-plan
description: Plan work in ROADMAPler by reading the current roadmap, finding duplicates, and creating or updating releases, tracks and cards.
---

Use roadmap-connect first if the project or access is unclear. Work only within the user's authorized scope.

1. Read the project snapshot and revision. Search for related cards before adding work; use IDs rather than titles. Follow `total`, `limit`, and `offset` to read every page needed for the decision (maximum 100 items per page).
2. Preserve the project's existing tracks, release order, statuses and unknown fields. Clarify a material scheduling ambiguity; otherwise place work in the requested release or backlog. Do not invent publication or delivery dates.
3. Break a request into reviewable cards with a concrete outcome, description and acceptance criteria. Use neutral examples. Newly planned work has status `planned`, not `done`.
4. Prefer `roadmap_card_create/update`, `roadmap_track_create/update` and `roadmap_release_create/update`. Supply the latest project `expected` revision, including between consecutive operations; use each successful result's revision for the next write. Structure positions are zero based. Card release ranges use `release` and optional `releaseEnd`; backlog cannot have a range.
5. Send only fields that change. Never read/replace the entire project for a one-card edit. Existing unknown fields must survive. On a 409, reread and reconcile with the new state; do not retry the old revision or overwrite parallel work.
6. Read back affected entities after the batch. Report what was actually saved, the release and any remaining uncertainty.

Deletion needs explicit authorization, an exact matching `confirm_delete`, and for tracks/releases an explicit `cards` strategy. Explain whether cards will be deleted or moved; specify target_track/target_release for move. A spanning card is affected as a whole. Never choose deletion simply to bypass a conflict or validation error.
