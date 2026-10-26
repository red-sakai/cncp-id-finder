"use client";

import { useEffect, useState } from "react";

export type BadgeDisplay = { name: string; img: string; desc: string };

// Badge details come from /api/badge-definitions, fetched on mount. This static
// copy of the two seed badges only takes over when that fetch fails, so cards
// still render instead of showing blank names.
export const SEED_BADGES: Record<string, BadgeDisplay> = {
  "welcome-to-cisco": {
    name: "Welcome to Cisco",
    img: "/badges/welcome-to-cisco-badge.png",
    desc: "Awarded to new members who join Cisco NetConnect PUP \u2013 Manila. Welcome to the community!",
  },
  "golden-alumni": {
    name: "Golden Alumni",
    img: "/badges/golden-alumni-badge.png",
    desc: "Awarded to distinguished alumni of Cisco NetConnect PUP \u2013 Manila for their continued excellence and contributions.",
  },
};

/**
 * Resolves a badge id to its name, image and description.
 *
 * `ready` is false until the definitions have loaded; use it before rendering
 * anything that would otherwise show a guessed badge name.
 */
export function useBadgeDefinitions() {
  const [defs, setDefs] = useState<Record<string, BadgeDisplay> | null>(null);

  useEffect(() => {
    fetch("/api/badge-definitions")
      .then((r) => r.json())
      .then((d: { badges?: { id?: string; name?: string; description?: string | null; image_url?: string | null }[] }) => {
        const map: Record<string, BadgeDisplay> = {};
        for (const b of d.badges ?? []) {
          if (!b.id || !b.name || !b.image_url) continue;
          map[b.id] = { name: b.name, img: b.image_url, desc: b.description ?? "" };
        }
        setDefs(map);
      })
      // An empty map means the fetch failed or returned nothing, which falls
      // back to SEED_BADGES rather than blank cards.
      .catch(() => setDefs({}));
  }, []);

  return {
    ready: defs !== null,
    badgeFor: (id: string) => defs?.[id] ?? SEED_BADGES[id],
  };
}
