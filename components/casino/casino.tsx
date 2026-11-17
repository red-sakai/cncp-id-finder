"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { CasinoWorld, type Station, type TableDraw } from "./world";
import { spinWith, PAYTABLE, STRIP, TWO_COIN_PAYS, MIXED_PAYS } from "@/lib/casino/slots";
import {
  BIG_BLIND, newHand, playerMove, publicView, type HoldemState, type Move, type PublicView,
} from "@/lib/casino/holdem";
import { randomSeed } from "@/lib/casino/rng";
import { Jukebox, TRACKS, type Layer } from "./jukebox";
import { deleteSong, listSongs, saveSong, type StoredSong } from "./song-store";

type Mode = "practice" | "real";
type Wallet = { first_name: string; last_name: string; email: string; phone: string };
type SeatInfo = { stack: number; text: string; thinking: boolean };
type Toast = { id: number; amount: number; label: string; big: boolean } | null;

const PRACTICE_KEY = "cncp-casino-practice";
const PRACTICE_START = 1000;
const BETS = [1, 5, 10, 25, 50, 100, 250];
const BUY_INS = [50, 100, 250, 500, 1000];
const fmt = (n: number) => n.toLocaleString("en-US");
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);

type Song = { key: string; name: string; sub: string; custom?: StoredSong };
type JukeboxPrefs = { track: string; volume: number; tempo: number; layers: Record<Layer, boolean> };
const JUKEBOX_KEY = "cncp-casino-jukebox";
const MAX_SONGS = 12;
const MAX_SONG_BYTES = 30 * 1024 * 1024;
const BUILT_IN: Song[] = TRACKS.map((t) => ({ key: `b:${t.id}`, name: t.name, sub: t.mood }));

function readJukebox(): JukeboxPrefs {
  const fallback: JukeboxPrefs = { track: BUILT_IN[0].key, volume: 70, tempo: 100, layers: { drums: true, bass: true, keys: true } };
  try {
    const raw = JSON.parse(localStorage.getItem(JUKEBOX_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return fallback;
    return {
      track: typeof raw.track === "string" ? raw.track : fallback.track,
      volume: Number.isFinite(raw.volume) ? Math.min(100, Math.max(0, raw.volume)) : fallback.volume,
      tempo: Number.isFinite(raw.tempo) ? Math.min(130, Math.max(70, raw.tempo)) : fallback.tempo,
      layers: { ...fallback.layers, ...(raw.layers ?? {}) },
    };
  } catch {
    return fallback;
  }
}

const songList = (mine: StoredSong[]): Song[] => [
  ...BUILT_IN,
  ...mine.map((m) => ({ key: `c:${m.id}`, name: m.name, sub: "Your song", custom: m })),
];

function readPractice() {
  try {
    const raw = localStorage.getItem(PRACTICE_KEY);
    const v = Number(raw);
    return raw !== null && Number.isFinite(v) && v >= 0 ? v : PRACTICE_START;
  } catch {
    return PRACTICE_START;
  }
}

function actText(act: string, to: number) {
  switch (act) {
    case "fold": return "Folds";
    case "check": return "Checks";
    case "call": return `Calls ${fmt(to)}`;
    case "bet": return `Bets ${fmt(to)}`;
    case "raise": return `Raises to ${fmt(to)}`;
    case "allin": return `All in, ${fmt(to)}`;
    case "sb": return `Small blind ${fmt(to)}`;
    case "bb": return `Big blind ${fmt(to)}`;
    default: return "";
  }
}

// Numbers roll to their new value instead of jumping, so a win is felt.
function useCountUp(value: number, ms = 700) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const a = from.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dur = reduce || a === value ? 0 : ms;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = dur ? Math.min(1, (now - start) / dur) : 1;
      const v = Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3)));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

function Stepper({ label, values, value, onChange, disabled, format = fmt }: {
  label: string; values: number[]; value: number; onChange: (v: number) => void; disabled?: boolean; format?: (n: number) => string;
}) {
  const i = Math.max(0, values.indexOf(value));
  return (
    <div className="cas-stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Lower ${label.toLowerCase()}`} disabled={disabled || i === 0} onClick={() => onChange(values[i - 1])}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" /></svg>
      </button>
      <span className="cas-stepper-value">
        <small>{label}</small>
        <b key={value}>{format(value)}</b>
      </span>
      <button type="button" aria-label={`Raise ${label.toLowerCase()}`} disabled={disabled || i === values.length - 1} onClick={() => onChange(values[i + 1])}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12" /></svg>
      </button>
    </div>
  );
}

function Eq() {
  return <span className="cas-eq" aria-hidden="true"><i /><i /><i /></span>;
}

export default function Casino({ onExit }: { onExit: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<CasinoWorld | null>(null);
  const reduced = useRef(false);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [moved, setMoved] = useState(false);
  const [near, setNear] = useState<Station | null>(null);
  const [seated, setSeated] = useState<Station | null>(null);

  const [mode, setMode] = useState<Mode>("practice");
  const [tab, setTab] = useState<Mode>("practice");
  const [practice, setPractice] = useState(readPractice);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [realBalance, setRealBalance] = useState<number | null>(null);
  const balance = mode === "practice" ? practice : realBalance ?? 0;
  const shownBalance = useCountUp(balance);

  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((amount: number, label: string, big = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), amount, label, big });
    toastTimer.current = setTimeout(() => setToast(null), big ? 3600 : 2600);
  }, []);
  const toastAmount = useCountUp(toast?.amount ?? 0, toast?.big ? 1400 : 800);

  // ── World ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let world: CasinoWorld;
    try {
      world = new CasinoWorld(mount, { onNear: setNear, onReady: () => setReady(true) }, reduced.current);
    } catch {
      queueMicrotask(() => setFailed(true));
      return;
    }
    worldRef.current = world;
    return () => {
      world.dispose();
      worldRef.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PRACTICE_KEY, String(practice));
    } catch {}
  }, [practice]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // ── Movement ───────────────────────────────────────────────────────────
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const stickId = useRef<number | null>(null);
  const moveStick = (e: React.PointerEvent) => {
    const el = stickRef.current;
    if (!el || stickId.current !== e.pointerId) return;
    const r = el.getBoundingClientRect();
    const max = r.width / 2;
    let dx = e.clientX - (r.left + max);
    let dy = e.clientY - (r.top + max);
    const len = Math.hypot(dx, dy);
    if (len > max) [dx, dy] = [(dx / len) * max, (dy / len) * max];
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
    worldRef.current?.setInput(dx / max, -dy / max);
    if (len > 8 && !moved) setMoved(true);
  };
  const endStick = () => {
    stickId.current = null;
    if (knobRef.current) knobRef.current.style.transform = "";
    worldRef.current?.setInput(0, 0);
  };

  // ── Seating ────────────────────────────────────────────────────────────
  const [hand, setHand] = useState<"none" | "live" | "over">("none");
  const sit = useCallback((st: Station) => {
    worldRef.current?.sit(st);
    setSeated(st);
    setMoved(true);
  }, []);

  const foldRef = useRef<() => Promise<void>>(async () => {});
  const standUp = useCallback(async () => {
    if (hand === "live") await foldRef.current();
    worldRef.current?.stand();
    worldRef.current?.renderTable(null);
    setSeated(null);
    setHand("none");
    setToast(null);
  }, [hand]);

  useEffect(() => {
    // Capture phase: while seated, Escape means "stand up" and must not reach
    // the tablet's own Escape handler, which closes the whole tablet.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && seated) {
        e.preventDefault();
        e.stopPropagation();
        void standUp();
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (/^(Key[WASD]|Arrow)/.test(e.code)) setMoved(true);
      if ((e.key === "e" || e.key === "E") && !seated && near) {
        e.preventDefault();
        sit(near);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [seated, near, sit, standUp]);

  // ── Real-deal requests ─────────────────────────────────────────────────
  const post = useCallback(
    async <T,>(url: string, body: object): Promise<T> => {
      if (!wallet) throw new Error("Open your wallet at the cashier first.");
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: wallet.email, phone: wallet.phone, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (typeof data.balance === "number") setRealBalance(data.balance);
      if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
      return data as T;
    },
    [wallet]
  );

  // ── Slots ──────────────────────────────────────────────────────────────
  const [bet, setBet] = useState(5);
  const [spinning, setSpinning] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [paytable, setPaytable] = useState(false);

  const spin = useCallback(async () => {
    if (spinning || !seated || seated.id !== "slots") return;
    if (bet > balance) {
      setSlotError(`You have ${fmt(balance)}. Lower the bet${mode === "practice" ? " or refill at the cashier" : ""}.`);
      return;
    }
    setSpinning(true);
    setSlotError(null);
    setPaytable(false);
    setToast(null);
    try {
      let stops: [number, number, number];
      let win: number;
      let combo: string | null;
      let after: number | undefined;
      if (mode === "practice") {
        const r = spinWith(Math.random);
        [stops, win, combo] = [r.stops, bet * r.pays, r.combo];
        setPractice((p) => Math.max(0, p - bet));
      } else {
        setRealBalance((b) => (b === null ? b : b - bet));
        const r = await post<{ stops: [number, number, number]; win: number; combo: string | null; balance: number }>(
          "/api/casino/slots",
          { bet }
        );
        [stops, win, combo, after] = [r.stops, r.win, r.combo, r.balance];
        setRealBalance(after - win);
      }
      // The first two reels matching is what earns the long, slow third reel.
      const [a, b] = [STRIP[stops[0]], STRIP[stops[1]]];
      const anticipate = a === b && a !== "blank";
      await worldRef.current?.spinReels(seated.index, stops, anticipate);
      const size = win >= bet * 50 ? "big" : win > 0 ? "win" : "none";
      worldRef.current?.settleSpin(seated.index, size);
      if (mode === "practice") setPractice((p) => p + win);
      else setRealBalance(after!);
      if (win > 0) showToast(win, lowerFirst(combo ?? "win"), size === "big");
      else showToast(0, "No line");
    } catch (e) {
      setSlotError(e instanceof Error ? e.message : "The machine jammed. Try again.");
    } finally {
      setSpinning(false);
    }
  }, [spinning, seated, bet, balance, mode, post, showToast]);

  useEffect(() => {
    if (seated?.id !== "slots") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.code === "Space" && tag !== "BUTTON" && tag !== "INPUT") {
        e.preventDefault();
        void spin();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seated, spin]);

  // ── Hold'em ────────────────────────────────────────────────────────────
  const [buyIn, setBuyIn] = useState(250);
  const [view, setView] = useState<PublicView | null>(null);
  const [seatInfo, setSeatInfo] = useState<SeatInfo[]>([]);
  const [pokerBusy, setPokerBusy] = useState(false);
  const [pokerError, setPokerError] = useState<string | null>(null);
  const [pokerNote, setPokerNote] = useState<string | null>(null);
  const [raising, setRaising] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);
  const localHand = useRef<HoldemState | null>(null);
  const tokenRef = useRef<string | null>(null);
  const buttonRef = useRef(0);
  const drawRef = useRef<TableDraw | null>(null);
  const infoRef = useRef<SeatInfo[]>([]);
  const [tablePot, setTablePot] = useState(0);
  const shownPot = useCountUp(tablePot, 450);

  // Replays a hand's events at table speed: bots think before they act,
  // the turn and river hold face down under a leaning camera, and a
  // showdown turns the cards over seat by seat before the pot moves.
  const playEvents = useCallback(async (v: PublicView, fresh: boolean) => {
    const world = worldRef.current;
    const quick = reduced.current;
    const startStacks = v.seats.map((s, i) => s.stack - v.winnings[i] + s.committed);
    let draw: TableDraw;
    let info: SeatInfo[];
    if (fresh || !drawRef.current) {
      draw = { seats: v.seats.map((s) => ({ folded: false, bet: 0, hole: s.hole })), board: [], pot: 0, button: v.button };
      info = v.seats.map((s, i) => ({ stack: startStacks[i], text: "", thinking: false }));
      world?.renderTable(null);
      world?.focusBoard(false);
    } else {
      draw = structuredClone(drawRef.current);
      info = v.seats.map((s, i) => ({ stack: infoRef.current[i]?.stack ?? s.stack, text: infoRef.current[i]?.text ?? "", thinking: false }));
    }
    const show = () => {
      drawRef.current = draw;
      infoRef.current = info;
      world?.renderTable(draw);
      setSeatInfo(info.map((x) => ({ ...x })));
      setTablePot(draw.pot);
    };
    show();

    for (const ev of v.events) {
      if (ev.t === "act") {
        if (ev.seat !== 0 && ev.act !== "sb" && ev.act !== "bb") {
          info[ev.seat].thinking = true;
          world?.setThinking(ev.seat);
          setSeatInfo(info.map((x) => ({ ...x })));
          await wait(quick ? 60 : 700);
          world?.setThinking(null);
          info[ev.seat].thinking = false;
        }
        const seat = draw.seats[ev.seat];
        const paid = ev.to - seat.bet;
        seat.bet = ev.to;
        draw.pot += Math.max(0, paid);
        info[ev.seat].stack -= Math.max(0, paid);
        if (ev.act === "fold") seat.folded = true;
        info[ev.seat].text = actText(ev.act, ev.to);
        show();
        await wait(quick ? 40 : 280);
      } else if (ev.t === "street") {
        const late = ev.street === "turn" || ev.street === "river";
        if (late) world?.focusBoard(true);
        draw.board = ev.board;
        draw.seats.forEach((s) => (s.bet = 0));
        info.forEach((x, i) => (x.text = draw.seats[i].folded ? "Folded" : ""));
        show();
        await wait(quick ? 60 : ev.street === "flop" ? 1500 : ev.street === "turn" ? 1900 : 2700);
        if (late) world?.focusBoard(false);
      }
    }

    if (v.done) {
      const showdown = v.street === "showdown";
      draw.seats.forEach((s, i) => (s.hole = v.seats[i].hole));
      draw.seats.forEach((s) => (s.bet = 0));
      show();
      if (showdown) {
        world?.focusBoard(true);
        const turned = v.seats.filter((s, i) => i > 0 && !s.folded).length;
        await wait(quick ? 80 : 700 + turned * 500);
      }
      const wins = v.events.filter((e) => e.t === "win");
      const mine = v.winnings[0];
      for (const w of wins) if (w.t === "win") world?.payPot(w.seat, w.amount >= 200);
      info = v.seats.map((s, i) => ({ stack: s.stack, text: v.winnings[i] > 0 ? `Wins ${fmt(v.winnings[i])}` : info[i].text, thinking: false }));
      setSeatInfo(info.map((x) => ({ ...x })));
      infoRef.current = info;
      // Let the chips finish sliding to the winner before the pot reads empty.
      await wait(quick ? 20 : 750);
      draw.pot = 0;
      show();
      world?.focusBoard(false);
      const yours = wins.find((w) => w.t === "win" && w.seat === 0);
      const others = wins.filter((w) => w.t === "win" && w.seat !== 0);
      if (yours && yours.t === "win") showToast(yours.amount, yours.hand ? lowerFirst(yours.hand) : "pot taken", yours.amount >= 200);
      setPokerNote(
        others.length
          ? others.map((w) => (w.t === "win" ? `${v.seats[w.seat].name} wins ${fmt(w.amount)}${w.hand ? `, ${lowerFirst(w.hand)}` : ""}` : "")).join(". ")
          : yours ? null : "Hand over"
      );
      if (mine > v.yourCommitted) worldRef.current?.react(mine >= v.yourCommitted * 4 && mine > 200 ? "big" : "win");
    }
  }, [showToast]);

  const deal = useCallback(async () => {
    if (pokerBusy) return;
    const stack = Math.min(buyIn, balance);
    if (stack < BIG_BLIND) {
      setPokerError(`You need at least ${BIG_BLIND} to sit in${mode === "practice" ? ". Refill at the cashier" : ""}.`);
      return;
    }
    setPokerBusy(true);
    setPokerError(null);
    setPokerNote(null);
    setRaising(false);
    setToast(null);
    buttonRef.current = (buttonRef.current + 1) % 4;
    try {
      let v: PublicView;
      if (mode === "practice") {
        const st = newHand({ handId: crypto.randomUUID(), rng: randomSeed(), stack, button: buttonRef.current });
        localHand.current = st;
        v = publicView(st);
        setPractice((p) => Math.max(0, p + (st.done ? st.winnings[0] : 0) - st.seats[0].committed));
      } else {
        const r = await post<{ view: PublicView; token: string | null }>("/api/casino/poker", { op: "deal", buyIn: stack, button: buttonRef.current });
        v = r.view;
        tokenRef.current = r.token;
      }
      setView(v);
      setHand("live");
      await playEvents(v, true);
      if (v.done) setHand("over");
    } catch (e) {
      setPokerError(e instanceof Error ? e.message : "The dealer dropped the deck. Try again.");
    } finally {
      setPokerBusy(false);
    }
  }, [pokerBusy, buyIn, balance, mode, post, playEvents]);

  const act = useCallback(
    async (move: Move) => {
      if (pokerBusy || !view?.options) return;
      setPokerBusy(true);
      setPokerError(null);
      setRaising(false);
      try {
        let v: PublicView;
        if (mode === "practice") {
          const st = localHand.current!;
          const before = st.seats[0].committed;
          playerMove(st, move);
          v = publicView(st);
          setPractice((p) => Math.max(0, p + (st.done ? st.winnings[0] : 0) - (st.seats[0].committed - before)));
        } else {
          const r = await post<{ view: PublicView; token: string | null }>("/api/casino/poker", { op: "act", token: tokenRef.current, move });
          v = r.view;
          tokenRef.current = r.token;
        }
        setView(v);
        await playEvents(v, false);
        if (v.done) setHand("over");
      } catch (e) {
        setPokerError(e instanceof Error ? e.message : "That didn't go through. Try again.");
      } finally {
        setPokerBusy(false);
      }
    },
    [pokerBusy, view, mode, post, playEvents]
  );

  useEffect(() => {
    foldRef.current = async () => {
      if (view?.options) await act({ type: "fold" });
    };
  }, [view, act]);

  // ── Cashier ────────────────────────────────────────────────────────────
  const [walletEmail, setWalletEmail] = useState("");
  const [walletPhone, setWalletPhone] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  const openWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    setWalletBusy(true);
    setWalletError(null);
    try {
      const res = await fetch("/api/shop/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: walletEmail.trim(), phone: walletPhone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not open the wallet. Try again.");
      setWallet({ ...data.member, phone: walletPhone.trim() });
      setRealBalance(typeof data.member.ciscoins === "number" ? data.member.ciscoins : 0);
      setWalletPhone("");
      setMode("real");
      setTab("real");
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : "Network error. Try again.");
    } finally {
      setWalletBusy(false);
    }
  };

  const lockWallet = () => {
    setWallet(null);
    setRealBalance(null);
    setMode("practice");
    setTab("practice");
  };

  // The Real deal tab only shows the wallet form; real mode starts once the
  // wallet is open, so the balance never claims real Ciscoins it can't see.
  const switchMode = (m: Mode) => {
    if (hand === "live") return;
    setTab(m);
    if (m === "practice" || wallet) setMode(m);
  };

  // ── Jukebox ────────────────────────────────────────────────────────────
  // It starts on its own when the casino opens, on the member's last song.
  // Their own songs come from their device and stay in this browser.
  const [prefs] = useState(readJukebox);
  const jukeRef = useRef<Jukebox | null>(null);
  const urlRef = useRef<string | null>(null);
  const [trackKey, setTrackKey] = useState(prefs.track);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(prefs.volume);
  const [tempo, setTempo] = useState(prefs.tempo);
  const [layers, setLayers] = useState<Record<Layer, boolean>>(prefs.layers);
  const [mine, setMine] = useState<StoredSong[]>([]);
  const [songNote, setSongNote] = useState<string | null>(null);
  const songs = songList(mine);
  const current = songs.find((x) => x.key === trackKey) ?? songs[0];

  const playSong = useCallback(async (song: Song) => {
    const j = jukeRef.current;
    if (!j) return;
    setTrackKey(song.key);
    try {
      if (song.custom) {
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(song.custom.blob);
        await j.playFile(urlRef.current);
      } else {
        await j.play(Math.max(0, TRACKS.findIndex((t) => `b:${t.id}` === song.key)));
      }
    } catch {
      setSongNote(song.custom ? `${song.name} couldn't be played. Try another file.` : null);
    }
    setPlaying(j.audible);
  }, []);

  const nextRef = useRef<() => void>(() => {});
  useEffect(() => {
    nextRef.current = () => {
      const i = songs.findIndex((x) => x.key === current.key);
      void playSong(songs[(i + 1) % songs.length]);
    };
  });

  useEffect(() => {
    try {
      localStorage.setItem(JUKEBOX_KEY, JSON.stringify({ track: trackKey, volume, tempo, layers }));
    } catch {}
  }, [trackKey, volume, tempo, layers]);

  // Autoplay on entry. If the browser holds sound until a tap, the first
  // tap or key press anywhere in the casino lets it out.
  useEffect(() => {
    let cancelled = false;
    const j = new Jukebox();
    j.setVolume(prefs.volume / 100);
    j.setTempo(prefs.tempo / 100);
    (Object.keys(prefs.layers) as Layer[]).forEach((k) => j.setLayer(k, prefs.layers[k]));
    j.onEnded = () => nextRef.current();
    jukeRef.current = j;
    worldRef.current?.setMusic(j);
    const unlock = () => {
      void j.resume().then(() => {
        if (!cancelled) setPlaying(j.audible);
      });
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
    void (async () => {
      const stored = await listSongs();
      if (cancelled) return;
      setMine(stored);
      const all = songList(stored);
      await playSong(all.find((x) => x.key === prefs.track) ?? all[0]);
      if (!cancelled && !j.audible) {
        window.addEventListener("pointerdown", unlock, true);
        window.addEventListener("keydown", unlock, true);
      }
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      worldRef.current?.setMusic(null);
      j.dispose();
      jukeRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    };
  }, [prefs, playSong]);

  const togglePlay = () => {
    const j = jukeRef.current;
    if (!j) return;
    if (j.audible) {
      j.pause();
      setPlaying(false);
    } else void playSong(current);
  };
  const changeVolume = (v: number) => {
    setVolume(v);
    jukeRef.current?.setVolume(v / 100);
  };
  const changeTempo = (v: number) => {
    setTempo(v);
    jukeRef.current?.setTempo(v / 100);
  };
  const toggleLayer = (k: Layer) => {
    setLayers((l) => ({ ...l, [k]: !l[k] }));
    jukeRef.current?.setLayer(k, !layers[k]);
  };

  const addSongs = async (files: FileList | null) => {
    if (!files?.length) return;
    setSongNote(null);
    const added: StoredSong[] = [];
    let kept = true;
    for (const f of Array.from(files)) {
      if (mine.length + added.length >= MAX_SONGS) {
        setSongNote(`You can keep up to ${MAX_SONGS} of your own songs. Remove one to add more.`);
        break;
      }
      if (!f.type.startsWith("audio/")) {
        setSongNote(`${f.name} isn't an audio file.`);
        continue;
      }
      if (f.size > MAX_SONG_BYTES) {
        setSongNote(`${f.name} is over 30 MB.`);
        continue;
      }
      const song: StoredSong = { id: crypto.randomUUID(), name: f.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Untitled", blob: f, added: Date.now() };
      if (!(await saveSong(song))) kept = false;
      added.push(song);
    }
    if (!kept) setSongNote("This browser won't store songs, so they'll play for this visit only.");
    if (added.length) {
      setMine((m) => [...m, ...added]);
      const first = added[0];
      void playSong({ key: `c:${first.id}`, name: first.name, sub: "Your song", custom: first });
    }
  };

  // Keep the playing song in view when the list is longer than its box.
  const tracksRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tracksRef.current?.querySelector(".is-on")?.scrollIntoView({ block: "nearest", behavior: reduced.current ? "auto" : "smooth" });
  }, [trackKey, seated, mine.length]);

  const removeSong = async (song: Song) => {
    if (!song.custom) return;
    await deleteSong(song.custom.id);
    setMine((m) => m.filter((x) => x.id !== song.custom!.id));
    if (song.key === current.key) void playSong(BUILT_IN[0]);
  };

  // ── Render ─────────────────────────────────────────────────────────────
  const atSlots = seated?.id === "slots";
  const atPoker = seated?.id === "poker";
  const atCashier = seated?.id === "cashier";
  const atJukebox = seated?.id === "jukebox";
  const opts = hand === "live" && !pokerBusy ? view?.options ?? null : null;

  // The world moves the seat tags every frame; hand it the elements once they exist.
  const showTags = !!view && atPoker && hand !== "none";
  useEffect(() => {
    const root = rootRef.current;
    const tags = root ? [...root.querySelectorAll<HTMLElement>("[data-tag]")] : [];
    worldRef.current?.attachLabels(tags.sort((a, b) => Number(a.dataset.tag) - Number(b.dataset.tag)));
  }, [showTags]);

  const startRaise = () => {
    if (!opts) return;
    setRaiseTo(opts.minTo);
    setRaising(true);
  };
  const potSize = (frac: number) => {
    if (!opts || !view) return 0;
    const target = view.currentBet + Math.round((tablePot + opts.toCall) * frac);
    return Math.min(opts.maxTo, Math.max(opts.minTo, target));
  };
  const buyIns = [...BUY_INS.filter((b) => b < balance), balance].filter((b) => b >= BIG_BLIND);
  const buyInValue = buyIns.includes(buyIn) ? buyIn : buyIns[buyIns.length - 1] ?? BIG_BLIND;

  return (
    <div ref={rootRef} className="cas" data-mode={mode}>
      <div ref={mountRef} className="cas-stage" aria-label="Casino floor" role="img" onPointerUp={() => setMoved(true)} />

      {showTags &&
        [0, 1, 2, 3, 4].map((i) => (
          <div key={i} data-tag={i} className={`cas-tag${i === 4 ? " is-pot" : ""}${seatInfo[i]?.thinking ? " is-thinking" : ""}`} aria-hidden="true">
            {i === 4 ? (
              shownPot > 0 ? <span className="cas-tag-pot">{fmt(shownPot)}</span> : null
            ) : i === 0 ? null : (
              <>
                <span className="cas-tag-name">{view.seats[i].name}</span>
                <span className="cas-tag-stack">{fmt(seatInfo[i]?.stack ?? view.seats[i].stack)}</span>
                {seatInfo[i]?.thinking ? (
                  <span className="cas-tag-act cas-dots"><i /><i /><i /></span>
                ) : seatInfo[i]?.text ? (
                  <span className="cas-tag-act" key={seatInfo[i].text}>{seatInfo[i].text}</span>
                ) : null}
              </>
            )}
          </div>
        ))}

      <header className="cas-top">
        <button type="button" className="cas-icon" onClick={onExit} aria-label="Leave the casino">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <h1 className="cas-sr">Casino</h1>
        {playing && !atJukebox && (
          <button type="button" className="cas-icon cas-now" onClick={togglePlay} aria-label={`Pause ${current.name}`} title={current.name}>
            <Eq />
          </button>
        )}
        <div className="cas-balance" aria-live="polite" aria-label={`${fmt(balance)} ${mode === "practice" ? "practice coins" : "Ciscoins"}`}>
          <Image src="/rebranding/logos/ciscoins.png" alt="" width={22} height={22} className="cas-coin" />
          <span className="cas-balance-num">{mode === "real" && realBalance === null ? "..." : fmt(shownBalance)}</span>
          <span className="cas-balance-mode">{mode === "practice" ? "Practice" : "Real"}</span>
        </div>
      </header>

      {toast && (
        <div className={`cas-toast${toast.big ? " is-big" : ""}${toast.amount ? "" : " is-quiet"}`} key={toast.id} role="status">
          {toast.amount > 0 ? <b>+{fmt(toastAmount)}</b> : null}
          <span>{toast.label}</span>
        </div>
      )}

      {!ready && !failed && (
        <div className="cas-loading" role="status">
          <span className="cas-loading-bar" />
          Setting up the floor
        </div>
      )}
      {failed && (
        <div className="cas-loading is-error" role="alert">
          This device can&apos;t draw the 3D casino.
          <button type="button" className="cas-btn is-ghost" onClick={onExit}>Back to the tablet</button>
        </div>
      )}

      {ready && !seated && (
        <>
          {!moved && (
            <p className="cas-hint">
              <span className="for-touch">Drag the stick or tap the floor to walk</span>
              <span className="for-mouse">Walk with WASD or the arrow keys, or click the floor</span>
            </p>
          )}
          <div
            ref={stickRef}
            className="cas-stick"
            onPointerDown={(e) => {
              stickId.current = e.pointerId;
              e.currentTarget.setPointerCapture(e.pointerId);
              moveStick(e);
            }}
            onPointerMove={moveStick}
            onPointerUp={endStick}
            onPointerCancel={endStick}
            aria-hidden="true"
          >
            <div ref={knobRef} className="cas-stick-knob" />
          </div>
          {near && (
            <div className="cas-prompt" key={near.label}>
              <span className="cas-prompt-text">
                <strong>{near.label}</strong>
                <small>
                  {near.id === "slots" ? "3 reels, 1 line" : near.id === "poker" ? "Blinds 5/10" : near.id === "jukebox" ? (playing ? current.name : `${songs.length} songs`) : "Practice or real deal"}
                </small>
              </span>
              <button type="button" className="cas-btn is-violet" onClick={() => sit(near)}>
                {near.id === "cashier" ? "Step up" : near.id === "jukebox" ? "Open" : "Sit"}
                <kbd>E</kbd>
              </button>
            </div>
          )}
        </>
      )}

      {seated && (
        <section className="cas-deck" aria-label={seated.label} key={seated.id}>
          <button
            type="button"
            className="cas-icon cas-stand"
            onClick={() => void standUp()}
            disabled={spinning || pokerBusy}
            aria-label={hand === "live" && atPoker ? "Fold and stand up" : "Stand up"}
            title={hand === "live" && atPoker ? "Fold and stand up" : "Stand up"}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>

          {atSlots && (
            <div className="cas-pane" key={paytable ? "pay" : "bet"}>
              {paytable ? (
                <ul className="cas-paytable">
                  {PAYTABLE.map((p) => (
                    <li key={p.combo}><span>{p.combo}</span><b>{p.pays}x</b></li>
                  ))}
                  <li><span>Any two Ciscoins</span><b>{TWO_COIN_PAYS}x</b></li>
                  <li><span>Any mix of bar, seven, CNCP</span><b>{MIXED_PAYS}x</b></li>
                  <li className="is-note">Middle line, bet included. Returns 96.2% over time.</li>
                </ul>
              ) : (
                <div className="cas-row is-center">
                  <Stepper label="Bet" values={BETS} value={bet} onChange={setBet} disabled={spinning} />
                </div>
              )}
              {slotError ? (
                <p className="cas-note is-error" role="alert">{slotError}</p>
              ) : mode === "real" ? (
                <p className="cas-note">Real Ciscoins</p>
              ) : null}
              <div className="cas-row">
                <button type="button" className="cas-icon is-soft" onClick={() => setPaytable((p) => !p)} aria-expanded={paytable} aria-label={paytable ? "Back to bet" : "Paytable"}>
                  {paytable ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></svg>
                  )}
                </button>
                <button type="button" className={`cas-btn is-gold is-big${spinning ? " is-busy" : ""}`} onClick={() => void spin()} disabled={spinning || paytable}>
                  {spinning ? "Spinning" : "Spin"}
                </button>
              </div>
            </div>
          )}

          {atPoker && (
            <div className="cas-pane" key={hand === "none" ? "sit" : raising ? "raise" : hand === "over" ? "over" : "play"}>
              {hand === "none" ? (
                <>
                  <div className="cas-row is-center">
                    <Stepper label="Sit with" values={buyIns.length ? buyIns : [BIG_BLIND]} value={buyInValue} onChange={setBuyIn} />
                  </div>
                  {pokerError ? (
                    <p className="cas-note is-error" role="alert">{pokerError}</p>
                  ) : (
                    <p className="cas-note">Against Router, Switch and Firewall{mode === "real" ? ", for real Ciscoins" : ""}</p>
                  )}
                  <div className="cas-row">
                    <button type="button" className={`cas-btn is-gold is-big${pokerBusy ? " is-busy" : ""}`} onClick={() => { setBuyIn(buyInValue); void deal(); }} disabled={pokerBusy || balance < BIG_BLIND}>
                      {pokerBusy ? "Dealing" : "Deal me in"}
                    </button>
                  </div>
                </>
              ) : raising && opts ? (
                <div className="cas-raise">
                  <div className="cas-raise-head">
                    <span>{view?.currentBet === 0 ? "Bet" : "Raise to"}</span>
                    <output>{fmt(raiseTo)}</output>
                  </div>
                  <input
                    className="cas-range" type="range" min={opts.minTo} max={opts.maxTo} step={1} value={raiseTo}
                    aria-label={view?.currentBet === 0 ? "Bet amount" : "Raise to"}
                    onChange={(e) => setRaiseTo(Number(e.target.value))}
                  />
                  <div className="cas-presets">
                    <button type="button" onClick={() => setRaiseTo(opts.minTo)}>Min</button>
                    <button type="button" onClick={() => setRaiseTo(potSize(0.5))}>Half pot</button>
                    <button type="button" onClick={() => setRaiseTo(potSize(1))}>Pot</button>
                    <button type="button" onClick={() => setRaiseTo(opts.maxTo)}>All in</button>
                  </div>
                  <div className="cas-row">
                    <button type="button" className="cas-btn is-ghost" onClick={() => setRaising(false)}>Back</button>
                    <button type="button" className="cas-btn is-gold is-big" onClick={() => void act({ type: "raise", to: raiseTo })}>
                      {raiseTo >= opts.maxTo ? "All in" : view?.currentBet === 0 ? `Bet ${fmt(raiseTo)}` : `Raise to ${fmt(raiseTo)}`}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className={`cas-note${pokerError ? " is-error" : ""}`} aria-live="polite">
                    {pokerError ?? (hand === "over" ? pokerNote : opts ? (view?.yourHand ? `You have ${lowerFirst(view.yourHand)}` : "Your move") : "Waiting on the table")}
                  </p>
                  {hand === "over" ? (
                    <div className="cas-row">
                      <button type="button" className={`cas-btn is-gold is-big${pokerBusy ? " is-busy" : ""}`} onClick={() => void deal()} disabled={pokerBusy}>
                        {pokerBusy ? "Dealing" : "Next hand"}
                      </button>
                    </div>
                  ) : (
                    <div className="cas-row is-actions">
                      <button type="button" className="cas-btn is-ghost" onClick={() => void act({ type: "fold" })} disabled={!opts}>Fold</button>
                      <button type="button" className="cas-btn is-violet" onClick={() => void act(opts?.canCheck ? { type: "check" } : { type: "call" })} disabled={!opts}>
                        {opts && !opts.canCheck ? `Call ${fmt(opts.toCall)}` : "Check"}
                      </button>
                      <button type="button" className="cas-btn is-gold" onClick={startRaise} disabled={!opts?.canRaise}>
                        {opts && view && view.currentBet === 0 ? "Bet" : "Raise"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {atJukebox && (
            <div className="cas-pane" key="juke">
              <div className="cas-tracks" role="radiogroup" aria-label="Songs" ref={tracksRef}>
                {songs.map((song) => {
                  const built = TRACKS.find((t) => `b:${t.id}` === song.key);
                  const on = song.key === current.key;
                  return (
                    <div key={song.key} className={`cas-track${on ? " is-on" : ""}`}>
                      <button type="button" role="radio" aria-checked={on} onClick={() => void playSong(song)}>
                        <span>
                          <b>{song.name}</b>
                          <small>{built ? `${built.mood}, ${Math.round((built.bpm * tempo) / 100)} BPM` : song.sub}</small>
                        </span>
                        {on && playing ? <Eq /> : null}
                      </button>
                      {song.custom && (
                        <button type="button" className="cas-track-remove" onClick={() => void removeSong(song)} aria-label={`Remove ${song.name}`}>
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <label className="cas-add">
                <input
                  type="file" accept="audio/*" multiple className="cas-sr"
                  onChange={(e) => { void addSongs(e.target.files); e.target.value = ""; }}
                />
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                Add your songs
              </label>
              {songNote && <p className="cas-note is-error" role="alert">{songNote}</p>}
              <div className="cas-mix">
                <label>
                  <span>Tempo</span>
                  <input className="cas-range" type="range" min={70} max={130} step={1} value={tempo} onChange={(e) => changeTempo(Number(e.target.value))} />
                  <output>{tempo}%</output>
                </label>
                <label>
                  <span>Volume</span>
                  <input className="cas-range" type="range" min={0} max={100} step={1} value={volume} onChange={(e) => changeVolume(Number(e.target.value))} />
                  <output>{volume}</output>
                </label>
              </div>
              {current.custom ? (
                <p className="cas-note">Drums, bass and keys mix on the four built-in songs.</p>
              ) : (
                <div className="cas-layers" role="group" aria-label="Parts">
                  {(["drums", "bass", "keys"] as Layer[]).map((k) => (
                    <button key={k} type="button" aria-pressed={layers[k]} className={layers[k] ? "is-on" : ""} onClick={() => toggleLayer(k)}>
                      {k[0].toUpperCase() + k.slice(1)}
                    </button>
                  ))}
                </div>
              )}
              <div className="cas-row">
                <button type="button" className="cas-btn is-gold is-big" onClick={togglePlay}>
                  {playing ? "Pause" : "Play"}
                </button>
                <button type="button" className="cas-icon is-soft" onClick={() => nextRef.current()} aria-label="Next song">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l8 6-8 6V6zM17 6v12" /></svg>
                </button>
              </div>
            </div>
          )}

          {atCashier && (
            <div className="cas-pane" key={tab}>
              <div className="cas-modes" role="radiogroup" aria-label="Play mode">
                <button type="button" role="radio" aria-checked={tab === "practice"} className={tab === "practice" ? "is-on" : ""} onClick={() => switchMode("practice")}>
                  Practice
                </button>
                <button type="button" role="radio" aria-checked={tab === "real"} className={tab === "real" ? "is-on" : ""} onClick={() => switchMode("real")}>
                  Real deal
                </button>
              </div>
              {tab === "practice" ? (
                <>
                  <p className="cas-note">Practice coins stay on this device and never touch your Ciscoins.</p>
                  <div className="cas-row">
                    <button type="button" className="cas-btn is-ghost is-big" onClick={() => setPractice(PRACTICE_START)} disabled={practice >= PRACTICE_START}>
                      Refill to {fmt(PRACTICE_START)}
                    </button>
                  </div>
                </>
              ) : wallet ? (
                <>
                  <p className="cas-note">
                    {wallet.first_name}, every bet and win here goes on your Ciscoins ledger.
                  </p>
                  <div className="cas-row">
                    <button type="button" className="cas-btn is-ghost is-big" onClick={lockWallet}>Lock wallet</button>
                  </div>
                </>
              ) : (
                <form className="cas-wallet" onSubmit={openWallet}>
                  <p className="cas-note">Open your wallet with the email and phone number on your membership.</p>
                  <input type="email" autoComplete="email" required placeholder="Email" aria-label="Email" value={walletEmail} onChange={(e) => setWalletEmail(e.target.value)} />
                  <input type="tel" inputMode="numeric" autoComplete="tel" required placeholder="Phone, 09XXXXXXXXX" aria-label="Phone" value={walletPhone} onChange={(e) => setWalletPhone(e.target.value)} />
                  {walletError && <p className="cas-note is-error" role="alert">{walletError}</p>}
                  <button type="submit" className={`cas-btn is-gold is-big${walletBusy ? " is-busy" : ""}`} disabled={walletBusy}>
                    {walletBusy ? "Checking" : "Open wallet"}
                  </button>
                </form>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
