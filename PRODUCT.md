# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Members of Cisco NetConnect PUP – Manila (CNCP), mostly students, on their phones, often at or right after org events. They look up their digital member ID, collect badges from event QR codes, and spend Ciscoins.

## Product Purpose
CNCP ID Finder gives each member a digital ID card, a badge collection, and a Ciscoins wallet with a shop. Everything opens from the iCisco tablet, a 3D scene hosted by Axie, the org mascot. The Games app is a 3D casino (slots, Texas Hold'em) that gives members a fun place to spend and win Ciscoins, so the currency keeps its value and members keep coming back.

## Positioning
The badges and Ciscoins come from real CNCP events. The casino plays for that same currency, and members who only want to practice can play a simulated mode.

## Operating Context
- Mostly phone browsers, used one-handed between or after events. Desktop also works.
- The admin console (`/qr`) issues QR tokens, badges and shop items.
- Ciscoins are a ledger (`ciscoins_ledger`). Spending requires email + phone verification (`checkWallet`).

## Capabilities and Constraints
- Next.js 16 App Router, React 19, Tailwind 4, Supabase, three.js.
- The repo is public and Supabase RLS is public. Server routes use the publishable key, so nothing secret may live in a readable table.
- Casino modes: **simulated** (fake Ciscoins, client only) and **real deal** (real Ciscoins, outcomes decided on the server).
- No bet limits, house edge requirement, or daily caps in real-deal mode (confirmed).
- Animations respect `prefers-reduced-motion`.

## Brand Commitments
- Names: CNCP, iCisco, Ciscoins, Axie (purple mascot, `public/rebranding/3d-models/axie.glb`, stickers in `public/rebranding/stickers/`).
- Logos: `public/rebranding/logos/cncp-purple-logo.png`, `public/rebranding/logos/ciscoins.png`.
- App icons: `public/icons/` (id-finder, GAMES, SHOP).
- Fonts already in use: Inter (body), Inter Tight (display).

## Evidence on Hand
Real member data lives in Supabase. Nothing in the repo should invent member counts, payouts, or testimonials.

## Product Principles
1. Ciscoins are earned at real events, so anything that spends them must be fair and server-checked.
2. Phone first: every interaction works with a thumb.
3. Axie is the host. Personality comes from the mascot, not from loud UI chrome.
4. Practice is free: simulated mode never touches the ledger.
