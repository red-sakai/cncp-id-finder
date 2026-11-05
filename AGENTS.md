<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read `antislop.md` (core) and then the skill for the task:
- UI / visual: `skills/antislop-ui/SKILL.md`
- Copy / text: `skills/antislop-copywriting/SKILL.md`
- People / accessibility: `skills/antislop-human/SKILL.md`
- Mobile / responsive: `skills/antislop-layoutmobile/SKILL.md`
- Code comments: `skills/antislop-code/SKILL.md`
The core and these five skills live at `C:\Users\jemar\.claude\skills\`; load them with the skill tool.
Before starting, ask the user when antislop applies: during the work, or after it is done.
<!-- antislop:end -->

## Project

CNCP ID Finder: digital member IDs, badges and a Ciscoins shop for Cisco NetConnect PUP – Manila.
Next.js 16 App Router, React 19, Tailwind 4, Supabase, three.js. No test runner; `npm run lint` and `npm run build` are the checks.

### Map
- `app/page.tsx`: the ID Finder home (lookup by email, card, badges, the tablet scene).
- `app/id/[email]/page.tsx`: the public ID card. `app/scan/page.tsx`: claim a badge from a QR. `app/qr/page.tsx`: admin console (QR tokens, badges, shop).
- `app/api/*/route.ts`: one route per resource, all on the shared client in `lib/supabase.ts`.
- `components/icisco-scene.tsx`: the 3D tablet and its apps (shop, games). `components/badge-case.tsx`: the badge case and drag-and-drop. `components/axie-chest-loader.tsx`: GLB loading animation.
- `lib/badge-definitions.ts`: `useBadgeDefinitions()` with `SEED_BADGES` as the fallback. `lib/featured-badges.ts`: the 3 card slots (`resolveFeatured`, `moveBadge`). `lib/wallet-auth.ts`: `checkWallet()` (email + phone) before any Ciscoins read or spend.
- `public/`: badge art in `badges/`, models and logos in `rebranding/`.

### Rules
- **`migration/` is untracked on purpose.** It holds member PII and live QR tokens, and the repo is public. Never `git add` anything from it or un-ignore it. New SQL goes in a new file there; tell the user to run it in Supabase.
- **Env** (`.env.local`, never committed): `NEXT_SUPABASE_PUBLIC_URL`, `NEXT_SUPABASE_PUBLIC_PUBLISHABLE_KEY`, `QR_USERNAME`, `QR_PASSWORD`.
- **The API uses the publishable key and RLS is public.** Most admin routes are not protected on the server, so don't build anything that assumes they are. The exceptions check the login cookie with `isAdmin()` from `lib/admin-auth.ts`: `app/api/claims`, because it approves payouts and lists member emails, and `PATCH /api/badge-definitions`, because it disables badges.
- **QR claim rules**: one-time QRs without approval use `claimed_at`, permanent QRs track nothing, and QRs with a limit or approval keep one `qr_claims` row per person. A trigger on that table enforces `max_claims`. Declining a claim deletes its row. A disabled badge (`badge_definitions.disabled`) refuses new claims on all its QRs, but earned badges stay and waiting claims can still be approved.
- **Members** are resolved from `executives_personal_info` first, then `registration_personal_info`. Emails are trimmed and lowercased before every query.
- **Route style**: validate the body, return `NextResponse.json({ error }, { status })`, and check everything that can reject a request before writing anything. See `app/api/badges/route.ts`: a rejected claim never burns a one-time QR, and the ledger insert happens before the badge row.
- **Ciscoins** are a ledger (`ciscoins_ledger`). The balance is a sum, never a stored number. Duplicate credits are absorbed by the `23505` unique index.
- **Animations** respect `prefers-reduced-motion`. The dev PC has reduced motion on in Windows, so turn it off (or emulate `no-preference`) before judging motion.

### Verifying UI
Run `npm run dev`, then drive the page with `puppeteer-core` (a dev dependency) and Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`. Keep scripts in the scratchpad, not the repo. Check for console errors and horizontal scroll at phone width.

Recurring tasks are written up step by step in `SKILLS.md`.
