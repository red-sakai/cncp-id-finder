// The digital ID physically holds 3 badges; the rest live in the badge case.
export const FEATURED_SLOTS = 3;

export type FeaturedSlots = (string | null)[];

// Where a dragged badge was dropped: a card slot, the case, or the card in general.
export type BadgeDrop = number | "case" | "card";

// Saved layout wins; with none saved (or a column that doesn't exist yet) the
// card shows the first badges earned, which is what it always did.
export function resolveFeatured(saved: unknown, earned: string[]): FeaturedSlots {
  const owned = new Set(earned);
  const seen = new Set<string>();
  const source = Array.isArray(saved) ? saved : earned;
  const slots: FeaturedSlots = [];
  for (let i = 0; i < FEATURED_SLOTS; i++) {
    const id = source[i];
    if (typeof id === "string" && owned.has(id) && !seen.has(id)) {
      seen.add(id);
      slots.push(id);
    } else {
      slots.push(null);
    }
  }
  return slots;
}

// Returns the new layout, or null when the drop changes nothing / isn't allowed.
export function moveBadge(slots: FeaturedSlots, id: string, to: BadgeDrop): FeaturedSlots | null {
  const next = [...slots];
  const from = next.indexOf(id);
  if (to === "case") {
    if (from < 0) return null;
    next[from] = null;
    return next;
  }
  if (to === "card") {
    if (from >= 0) return null;
    const empty = next.indexOf(null);
    if (empty < 0) return null;
    next[empty] = id;
    return next;
  }
  if (from === to) return null;
  const displaced = next[to];
  next[to] = id;
  // Slot to slot swaps; a badge pushed off by one from the case goes back to the case.
  if (from >= 0) next[from] = displaced;
  return next;
}
