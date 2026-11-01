"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import type { BadgeDrop } from "@/lib/featured-badges";

export type CaseBadge = { id: string; img: string; name: string };

type Drag = CaseBadge & { origin: DOMRect };

const DRAG_THRESHOLD = 6;
const GHOST = 64;
const FLY_BACK_MS = 280;

function dropAt(x: number, y: number): BadgeDrop | null {
  const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-badge-drop]");
  const value = hit?.dataset.badgeDrop;
  if (!value) return null;
  return value === "case" || value === "card" ? value : Number(value);
}

// Pointer events instead of HTML5 drag-and-drop: the iPad is a touch screen,
// and native DnD doesn't fire on touch.
export function useBadgeDrag(onDrop: (id: string, to: BadgeDrop) => boolean) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<BadgeDrop | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const posRef = useRef({ x: 0, y: 0, tilt: 0 });
  const onDropRef = useRef(onDrop);
  const draggedRef = useRef(false);
  useEffect(() => { onDropRef.current = onDrop; });

  const place = () => {
    const { x, y, tilt } = posRef.current;
    if (ghostRef.current) {
      ghostRef.current.style.transform =
        `translate(${x - GHOST / 2}px, ${y - GHOST / 2}px) rotate(${tilt}deg) scale(1.15)`;
    }
  };

  useLayoutEffect(() => { if (drag) place(); }, [drag]);

  useEffect(() => {
    if (!landed) return;
    const t = setTimeout(() => setLanded(null), 500);
    return () => clearTimeout(t);
  }, [landed]);

  const begin = (e: React.PointerEvent<HTMLElement>, badge: CaseBadge) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    let target: BadgeDrop | null = null;

    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        started = true;
        draggedRef.current = true;
        posRef.current = { x: ev.clientX, y: ev.clientY, tilt: 0 };
        setDrag({ ...badge, origin: el.getBoundingClientRect() });
      }
      ev.preventDefault();
      const dx = ev.clientX - posRef.current.x;
      // Lean into the direction of travel, settle back when still.
      const tilt = Math.max(-22, Math.min(22, posRef.current.tilt * 0.7 + dx * 1.4));
      posRef.current = { x: ev.clientX, y: ev.clientY, tilt };
      place();
      const next = dropAt(ev.clientX, ev.clientY);
      if (next !== target) {
        target = next;
        setOver(next);
      }
    };

    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!started) return;
      // The click that follows a drag must not count as a tap.
      setTimeout(() => { draggedRef.current = false; }, 0);
      setOver(null);
      const ok = ev.type === "pointerup" && target !== null && onDropRef.current(badge.id, target);
      if (ok) {
        setLanded(badge.id);
        setDrag(null);
        return;
      }
      const ghost = ghostRef.current;
      const origin = el.getBoundingClientRect();
      if (ghost) {
        ghost.classList.add("is-returning");
        ghost.style.transform = `translate(${origin.left + origin.width / 2 - GHOST / 2}px, ${
          origin.top + origin.height / 2 - GHOST / 2
        }px) rotate(0deg) scale(0.85)`;
      }
      setTimeout(() => setDrag(null), FLY_BACK_MS);
    };

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const ghost = drag
    ? createPortal(
        <div ref={ghostRef} className="icisco-badge-ghost" aria-hidden="true">
          <Image src={drag.img} alt="" width={GHOST} height={GHOST} draggable={false} />
        </div>,
        document.body
      )
    : null;

  return {
    begin,
    ghost,
    draggingId: drag?.id ?? null,
    over,
    landed,
    wasDrag: () => draggedRef.current,
  };
}

export function BadgeCount({ count }: { count: number }) {
  return (
    <span className="icisco-idcard-badge-count">
      <span className="icisco-idcard-badge-count-num" aria-hidden="true">
        {String(count).padStart(2, "0")}
      </span>
      <span aria-hidden="true">earned</span>
      <span className="icisco-shop-sr-only">{count} badges earned</span>
    </span>
  );
}

export function BadgeCase({
  open,
  badges,
  total,
  message,
  drag,
  onPick,
  onOpen,
  onClose,
}: {
  open: boolean;
  badges: CaseBadge[];
  total: number;
  message: string | null;
  drag: ReturnType<typeof useBadgeDrag>;
  onPick: (id: string) => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const tabRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    (open ? doneRef : tabRef).current?.focus({ preventScroll: true });
  }, [open]);

  return (
    <div className={`icisco-badge-case-wrap${open ? " is-open" : ""}`}>
      <button
        ref={tabRef}
        type="button"
        className="icisco-badge-case-tab"
        onClick={onOpen}
        aria-expanded={open}
        aria-controls="icisco-badge-case"
        tabIndex={open ? -1 : 0}
      >
        <span className="icisco-badge-case-tab-label">Badge case</span>
        {badges.length > 0 && <span className="icisco-badge-case-tab-num">{badges.length}</span>}
      </button>
      <div className="icisco-badge-case-drawer" inert={!open}>
      <section
        id="icisco-badge-case"
        className="icisco-badge-case"
        data-badge-drop="case"
        aria-label="Badge case"
        onKeyDown={(e) => {
          // Close just the case; without stopPropagation Escape also closes iCisco.
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {/* Lid: glass side faces you when open, the solid top shows while it swings shut. */}
        <div className="icisco-case-lid">
          <header className="icisco-case-lid-face icisco-case-lid-glass">
            <h3 className="icisco-badge-case-title">Badge case</h3>
            <p className="icisco-badge-case-sub">
              Your ID holds 3 badges. Drag or tap one to move it between your ID and the case.
            </p>
          </header>
          <div className="icisco-case-lid-face icisco-case-lid-top" aria-hidden="true" />
        </div>
        <div className="icisco-case-hinges" aria-hidden="true">
          <span />
          <span />
        </div>

        <div className={`icisco-case-base${drag.over === "case" ? " is-over" : ""}`}>
        <div className="icisco-case-velvet">
        {badges.length > 0 ? (
          <ul className="icisco-badge-case-grid">
            {badges.map((b, i) => (
              <li key={b.id} style={{ "--i": i } as React.CSSProperties}>
                <button
                  type="button"
                  className={`icisco-badge-pocket${drag.draggingId === b.id ? " is-lifted" : ""}${
                    drag.landed === b.id ? " is-landed" : ""
                  }`}
                  onPointerDown={(e) => drag.begin(e, b)}
                  onClick={() => { if (!drag.wasDrag()) onPick(b.id); }}
                  aria-label={`Put ${b.name} on your ID`}
                  title={b.name}
                >
                  <Image src={b.img} alt="" width={48} height={48} draggable={false} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="icisco-badge-case-empty">
            {total === 0
              ? "No badges yet. Scan a QR code at a CNCP event to earn your first one."
              : "Every badge you own is on your ID. Drag one here to make room."}
          </p>
        )}
        </div>
        </div>

        <p className="icisco-badge-case-msg" aria-live="polite">{message}</p>

        <button ref={doneRef} type="button" className="icisco-idfinder-btn icisco-badge-case-done" onClick={onClose}>
          Done
        </button>
      </section>
      </div>
    </div>
  );
}
