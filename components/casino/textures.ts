import * as THREE from "three";
import { rankOf, RANKS, suitOf, type Card } from "@/lib/casino/cards";
import { STRIP, type SlotSymbol } from "@/lib/casino/slots";

// Every surface in the casino is painted here on a canvas: no image files to
// ship beyond the brand art that already lives in /public.

export const INK = "#1d1446";
export const VIOLET = "#7c5cff";
export const GOLD = "#f5b83d";
export const LAVENDER = "#ece8ff";
export const NEON = "#ff5fa8";

let displayFamily = "sans-serif";
export function readFonts() {
  const cs = getComputedStyle(document.documentElement);
  displayFamily = cs.getPropertyValue("--font-display").trim() || displayFamily;
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function tex(c: HTMLCanvasElement, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string) {
  if (!images.has(src))
    images.set(
      src,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      })
    );
  return images.get(src)!;
}

function starburst(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 ? r * 0.32 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function carpetTexture() {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = "#1a1142";
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = "rgba(124, 92, 255, 0.28)";
  ctx.lineWidth = 3;
  const hubs = [[0, 0], [512, 0], [0, 512], [512, 512], [256, 256]];
  for (const [x, y] of hubs)
    for (const r of [70, 118]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  ctx.fillStyle = GOLD;
  for (const [x, y] of hubs) starburst(ctx, x, y, 22);
  ctx.fillStyle = "rgba(236, 232, 255, 0.55)";
  for (const [x, y] of [[128, 128], [384, 128], [128, 384], [384, 384]]) starburst(ctx, x, y, 9);
  const t = tex(c, true);
  t.repeat.set(6, 5);
  return t;
}

export function wallTexture(repeatX: number) {
  const [c, ctx] = canvas(256, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#130c35");
  g.addColorStop(1, "#24186a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 512);
  ctx.strokeStyle = "rgba(245, 184, 61, 0.35)";
  ctx.lineWidth = 4;
  ctx.strokeRect(28, 300, 200, 180);
  ctx.strokeStyle = "rgba(124, 92, 255, 0.35)";
  ctx.strokeRect(28, 40, 200, 230);
  const t = tex(c, true);
  t.repeat.set(repeatX, 1);
  return t;
}

// The felt is a circle stretched into the table's oval, so the lettering is
// drawn squeezed by the same ratio to come out at its true shape.
export function feltTexture(aspect: number) {
  const [c, ctx] = canvas(1024, 1024);
  const g = ctx.createRadialGradient(512, 512, 60, 512, 512, 520);
  g.addColorStop(0, "#32248f");
  g.addColorStop(1, "#1d1446");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.strokeStyle = "rgba(245, 184, 61, 0.8)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(512, 512, 380, 0, Math.PI * 2);
  ctx.stroke();
  ctx.save();
  ctx.translate(512, 300);
  ctx.scale(1 / aspect, 1);
  ctx.fillStyle = "rgba(245, 184, 61, 0.7)";
  ctx.font = `800 58px ${displayFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("CNCP HOLD'EM", 0, 0);
  ctx.restore();
  return tex(c);
}

// Suits are drawn as paths so they look the same on every device.
function drawSuit(ctx: CanvasRenderingContext2D, suit: number, x: number, y: number, s: number) {
  ctx.beginPath();
  if (suit === 1) {
    ctx.moveTo(x, y + s * 0.45);
    ctx.bezierCurveTo(x - s * 0.9, y - s * 0.1, x - s * 0.45, y - s * 0.75, x, y - s * 0.28);
    ctx.bezierCurveTo(x + s * 0.45, y - s * 0.75, x + s * 0.9, y - s * 0.1, x, y + s * 0.45);
  } else if (suit === 2) {
    ctx.moveTo(x, y - s * 0.55);
    ctx.lineTo(x + s * 0.4, y);
    ctx.lineTo(x, y + s * 0.55);
    ctx.lineTo(x - s * 0.4, y);
  } else if (suit === 0) {
    ctx.moveTo(x, y - s * 0.55);
    ctx.bezierCurveTo(x + s * 0.9, y + s * 0.05, x + s * 0.45, y + s * 0.6, x + s * 0.06, y + s * 0.2);
    ctx.lineTo(x + s * 0.2, y + s * 0.55);
    ctx.lineTo(x - s * 0.2, y + s * 0.55);
    ctx.lineTo(x - s * 0.06, y + s * 0.2);
    ctx.bezierCurveTo(x - s * 0.45, y + s * 0.6, x - s * 0.9, y + s * 0.05, x, y - s * 0.55);
  } else {
    const r = s * 0.22;
    for (const [dx, dy] of [[0, -0.24], [-0.22, 0.08], [0.22, 0.08]]) {
      ctx.moveTo(x + dx * s + r, y + dy * s);
      ctx.arc(x + dx * s, y + dy * s, r, 0, Math.PI * 2);
    }
    ctx.moveTo(x - s * 0.08, y + s * 0.1);
    ctx.lineTo(x + s * 0.08, y + s * 0.1);
    ctx.lineTo(x + s * 0.18, y + s * 0.55);
    ctx.lineTo(x - s * 0.18, y + s * 0.55);
  }
  ctx.closePath();
  ctx.fill();
}

const cardCache = new Map<number, THREE.Texture>();
export function cardTexture(card: Card) {
  const hit = cardCache.get(card);
  if (hit) return hit;
  const [c, ctx] = canvas(256, 356);
  roundRect(ctx, 0, 0, 256, 356, 22);
  ctx.fillStyle = "#fbfaff";
  ctx.fill();
  const suit = suitOf(card);
  ctx.fillStyle = suit === 1 || suit === 2 ? "#d61f5c" : INK;
  const r = RANKS[rankOf(card)];
  ctx.font = `800 76px ${displayFamily}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(r === "T" ? "10" : r, 20, 16);
  drawSuit(ctx, suit, 48, 128, 46);
  drawSuit(ctx, suit, 150, 230, 150);
  const t = tex(c);
  cardCache.set(card, t);
  return t;
}

let backTex: THREE.Texture | null = null;
export function cardBackTexture() {
  if (backTex) return backTex;
  const [c, ctx] = canvas(256, 356);
  roundRect(ctx, 0, 0, 256, 356, 22);
  ctx.fillStyle = "#3b22a6";
  ctx.fill();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 8;
  roundRect(ctx, 16, 16, 224, 324, 14);
  ctx.stroke();
  ctx.fillStyle = "rgba(236, 232, 255, 0.18)";
  for (let y = 40; y < 330; y += 36) for (let x = 40; x < 230; x += 36) starburst(ctx, x, y, 8);
  const t = tex(c);
  backTex = t;
  loadImage("/rebranding/logos/cncp-purple-logo.png")
    .then((img) => {
      ctx.fillStyle = LAVENDER;
      ctx.beginPath();
      ctx.arc(128, 178, 62, 0, Math.PI * 2);
      ctx.fill();
      const w = 100;
      const h = (w * img.height) / img.width;
      ctx.drawImage(img, 128 - w / 2, 178 - h / 2, w, h);
      t.needsUpdate = true;
    })
    .catch(() => {});
  return t;
}

// One tall strip of every reel stop, top to bottom. A reel window shows three
// cells at a time by moving texture.offset.
export const REEL_CELL = 160;
const SYMBOL_ART: Partial<Record<SlotSymbol, string>> = {
  axie: "/rebranding/stickers/axie-flying-sticker.png",
  cncp: "/rebranding/logos/cncp-purple-logo.png",
  coin: "/rebranding/logos/ciscoins.png",
};

export function reelStripCanvas() {
  const [c, ctx] = canvas(192, REEL_CELL * STRIP.length);
  const paint = (art: Map<SlotSymbol, HTMLImageElement>) => {
    STRIP.forEach((sym, i) => {
      const y = i * REEL_CELL;
      ctx.fillStyle = i % 2 ? "#f2eeff" : "#fbfaff";
      ctx.fillRect(0, y, 192, REEL_CELL);
      const cx = 96;
      const cy = y + REEL_CELL / 2;
      const img = art.get(sym);
      if (img) {
        const s = sym === "axie" ? 136 : 108;
        const w = img.width >= img.height ? s : (s * img.width) / img.height;
        const h = img.width >= img.height ? (s * img.height) / img.width : s;
        ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
      } else if (sym === "seven") {
        ctx.font = `900 124px ${displayFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 10;
        ctx.strokeStyle = INK;
        ctx.strokeText("7", cx, cy + 6);
        ctx.fillStyle = NEON;
        ctx.fillText("7", cx, cy + 6);
      } else if (sym === "bar") {
        roundRect(ctx, 22, cy - 30, 148, 60, 12);
        ctx.fillStyle = INK;
        ctx.fill();
        ctx.fillStyle = GOLD;
        ctx.font = `800 40px ${displayFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("BAR", cx, cy + 2);
      } else if (sym === "blank") {
        // A real blank stop: the carpet's starburst, not a stray dot.
        ctx.fillStyle = "rgba(124, 92, 255, 0.28)";
        starburst(ctx, cx, cy, 30);
        ctx.fillStyle = "rgba(124, 92, 255, 0.18)";
        starburst(ctx, cx - 46, cy, 10);
        starburst(ctx, cx + 46, cy, 10);
      }
    });
  };
  paint(new Map());
  const ready = Promise.all(
    (Object.entries(SYMBOL_ART) as [SlotSymbol, string][]).map(([k, src]) => loadImage(src).then((img) => [k, img] as const))
  )
    .then((pairs) => paint(new Map(pairs)))
    .catch(() => {});
  return { canvas: c, ready };
}

export function signTexture(text: string, color: string, w = 1024, h = 256, size = 150) {
  const [c, ctx] = canvas(w, h);
  ctx.font = `800 ${size}px ${displayFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = color;
  ctx.shadowBlur = 28;
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2 + 8);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "#fff6fb";
  ctx.fillText(text, w / 2, h / 2 + 8);
  return tex(c);
}

export function logoTexture() {
  const [c, ctx] = canvas(512, 512);
  const t = tex(c);
  loadImage("/rebranding/logos/cncp-purple-logo.png")
    .then((img) => {
      const s = 440;
      const w = img.width >= img.height ? s : (s * img.width) / img.height;
      const h = img.width >= img.height ? (s * img.height) / img.width : s;
      ctx.drawImage(img, 256 - w / 2, 256 - h / 2, w, h);
      t.needsUpdate = true;
    })
    .catch(() => {});
  return t;
}

// Firewall's body: a running-bond brick wall in the casino's pinks.
export function brickTexture() {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = "#3a1030";
  ctx.fillRect(0, 0, 256, 256);
  const rows = 8;
  const h = 256 / rows;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 ? -32 : 0;
    for (let x = offset; x < 256; x += 64) {
      ctx.fillStyle = (r * 7 + x) % 3 ? "#c2335f" : "#d9497a";
      ctx.fillRect(x + 3, r * h + 3, 58, h - 6);
    }
  }
  return tex(c, true);
}

export function blobShadowTexture() {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, "rgba(4, 2, 16, 0.7)");
  g.addColorStop(1, "rgba(4, 2, 16, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return tex(c);
}

export function dealerButtonTexture() {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = LAVENDER;
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.font = `800 72px ${displayFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("D", 64, 70);
  return tex(c);
}

export function faceTexture(color: string) {
  const [c, ctx] = canvas(128, 96);
  ctx.fillStyle = "#0c0824";
  ctx.fillRect(0, 0, 128, 96);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  roundRect(ctx, 26, 28, 22, 30, 8);
  ctx.fill();
  roundRect(ctx, 80, 28, 22, 30, 8);
  ctx.fill();
  ctx.fillRect(50, 70, 28, 5);
  return tex(c);
}
