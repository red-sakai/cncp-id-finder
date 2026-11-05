# Skills

Step-by-step recipes for jobs that keep coming up in this repo. Read `AGENTS.md` first.

## Add a badge
1. Create it from `/qr` (or `POST /api/badge-definitions` with `name`, `description` and the image data). The id is the name slugified, so two badges can't share a name.
2. The art is stored with the definition. A file in `public/badges/` is only needed for a seed badge.
3. Only if it should still render when the definitions fetch fails, add it to `SEED_BADGES` in `lib/badge-definitions.ts`.
4. `app/scan/page.tsx` has its own `BADGE_NAMES` map for the claim screen. Add the badge there too, or move that page onto `useBadgeDefinitions()`.

## Add an API route
1. Create `app/api/<resource>/route.ts` and export `GET`/`POST`/`PATCH`/`DELETE`.
2. Import `supabase` from `@/lib/supabase`. Don't create a second client.
3. Validate every field from `request.json()` by type and length (see the `MAX_*` constants in `app/api/shop/route.ts`).
4. Anything that reads or spends Ciscoins calls `checkWallet(email, phone)` first and returns its `status`/`error` on failure.
5. Run all rejection checks before the first write. If a later write fails, undo the earlier ones (see the token rollback in `app/api/badges/route.ts`).

## Change the database
1. Write a new `migration/<name>.sql` with `IF NOT EXISTS` / `IF EXISTS` guards so it can be re-run.
2. Add the RLS policies the routes need (the existing ones are `Allow public read/insert/update/delete`).
3. Don't commit it (it's ignored). Give the user the file path and ask them to run it in the Supabase SQL editor.
4. Code that reads a new column must still work before the migration runs. `resolveFeatured()` falling back to the first earned badges is the pattern.

## Change the 3D tablet or an animation
1. The scene, its apps and their timings live in `components/icisco-scene.tsx`. Timing constants are at the top of each component file.
2. Load models through the existing `loadModel()` / `prepareAxie()` helpers so they are fetched once.
3. Every new animation gets a `prefers-reduced-motion: reduce` fallback in `app/globals.css`.
4. Check it in a real browser with reduced motion off (see "Verifying UI" in `AGENTS.md`). Freeze frames at key points with a screenshot, and test at phone width.

## Ship a change
1. `npm run lint` and `npm run build`.
2. Run `git status` and make sure nothing under `migration/` and no `.env*` file shows up.
3. Commit in the existing style: `feat: …`, `fix: …`, `chore: …`, lowercase and short.
