import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import { winIntensity, type Sfx } from "./sfx";
import type { Card } from "@/lib/casino/cards";
import { STRIP } from "@/lib/casino/slots";
import {
  blobShadowTexture, brickTexture, cardBackTexture, cardTexture, carpetTexture, dealerButtonTexture,
  feltTexture, GOLD, logoTexture, NEON, readFonts, reelStripCanvas, signTexture, VIOLET, wallTexture,
} from "./textures";

// The casino floor: one roofless room seen from above, like a lit diorama.
// Axie walks it; sitting at a station dollies the camera into that game.

export type StationId = "slots" | "poker" | "cashier" | "jukebox";
export type Station = { id: StationId; index: number; label: string; stand: THREE.Vector3 };

export type TableDraw = {
  seats: { folded: boolean; bet: number; hole: (Card | null)[] }[];
  board: Card[];
  pot: number;
  button: number;
};

type Callbacks = {
  onNear: (s: Station | null) => void;
  onReady: () => void;
};

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
type Ellipse = { x: number; z: number; rx: number; rz: number };

const BOUNDS: Box = { minX: -6.4, maxX: 6.4, minZ: -4.0, maxZ: 4.9 };
const SLOT_X = [-5.4, -4.15, -2.9, -1.65];
const SLOT_FRONT = -4.4;
const TABLE = { x: 2.6, z: -1.0, rx: 1.6, rz: 0.95, top: 0.78 };
const SPAWN = new THREE.Vector3(0, 0, 3.9);
const AXIE_RADIUS = 0.3;
const SPEED = 3.2;
const AXIE_MODEL = "/axie-3d/axie-flight.glb";

// Colours above 1.0 are the only thing the bloom pass picks up.
const glow = (c: string, k: number) => new THREE.Color(c).multiplyScalar(k);
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => {
  const c = 1.35;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

type Tween = { t: number; dur: number; step: (k: number) => void; done?: () => void };

export class CasinoWorld {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  private clock = new THREE.Clock();
  private raf = 0;
  private ro: ResizeObserver;
  private tweens: Tween[] = [];
  private disposed = false;

  private axie = new THREE.Group();
  private mixers: THREE.AnimationMixer[] = [];
  private walkAction: THREE.AnimationAction | null = null;
  private model: THREE.Object3D | null = null;
  private modelBase = { y: 0, scale: 1 };
  private reactKind: "win" | "big" | "lose" | null = null;
  private reactT = 0;

  // Build-up and payoff: camera push-in, shake, marquee flashes, coins.
  private zoom = 0;
  private zoomGoal = 0;
  private shake = 0;
  private hum = 0;
  private flash = 0;
  private flashMachine = -1;
  private marquees: THREE.MeshBasicMaterial[] = [];
  private coins: { m: THREE.Mesh; v: THREE.Vector3; spin: number; life: number }[] = [];
  private coinGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.012, 18);
  private coinMat = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.3, metalness: 0.4, emissive: GOLD, emissiveIntensity: 0.45 });
  private bots: { g: THREE.Group; head: THREE.Object3D; thinking: boolean; hop: number; leds: THREE.MeshBasicMaterial[] }[] = [];
  private music: { pulse(): number; playing: boolean } | null = null;
  private jukeTubes: THREE.MeshBasicMaterial[] = [];
  private jukeDisc = new THREE.Group();
  private sfx: Sfx | null = null;
  private cashier: { root: THREE.Group; head: THREE.Group; torso: THREE.Object3D; wave: THREE.Group; greet: number } | null = null;
  private heading = Math.PI;
  private input = new THREE.Vector2();
  private keys = new Set<string>();
  private walkTarget: THREE.Vector3 | null = null;
  private walking = 0;

  private stations: Station[] = [];
  private near: Station | null = null;
  private seated: Station | null = null;
  private camFrom = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private camLook = new THREE.Vector3();
  private camBlend = 1;
  // Arrival shows the whole room; the camera moves in once Axie does.
  private overview = true;
  private hitTargets: THREE.Object3D[] = [];
  private floor!: THREE.Mesh;
  private obstacles: (Box | Ellipse)[] = [];

  private reelTex!: THREE.CanvasTexture;
  private reels: { geo: THREE.PlaneGeometry; offset: number }[][] = [];
  private levers: THREE.Group[] = [];

  private table = new THREE.Group();
  private boardMeshes: THREE.Group[] = [];
  private holeMeshes: THREE.Group[][] = [[], [], [], []];
  private chipStacks: THREE.Group[] = [];
  private dealerButton!: THREE.Mesh;
  private labelEls: (HTMLElement | null)[] = [];
  private cardGeo = new THREE.PlaneGeometry(0.2, 0.28);
  private chipGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.014, 20);
  private chipMats = [VIOLET, GOLD, NEON, "#ece8ff"].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.1 })
  );

  constructor(private mount: HTMLElement, private cb: Callbacks, private reduced: boolean) {
    readFonts();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    mount.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = "none";

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.45, 1.0));
    this.composer.addPass(new OutputPass());

    // Indigo at the top fading to the ground, so the space around the diorama is not flat black.
    const sky = document.createElement("canvas");
    sky.width = 2;
    sky.height = 256;
    const sctx = sky.getContext("2d")!;
    const grad = sctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#22185a");
    grad.addColorStop(1, "#0b0820");
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 2, 256);
    const skyTex = new THREE.CanvasTexture(sky);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = skyTex;
    this.scene.fog = new THREE.Fog("#0b0820", 22, 46);
    this.buildRoom();
    this.buildSlots();
    this.buildTable();
    this.buildCashier();
    this.buildJukebox();
    this.buildDecor();
    this.buildAxie();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(mount);
    this.resize();
    this.placeFollowCamera(true);

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.tick();
  }

  // ── Building ────────────────────────────────────────────────────────────
  private gold() {
    return new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.35, metalness: 0.3, emissive: GOLD, emissiveIntensity: 0.22 });
  }

  private std(color: string, rough = 0.5, metal = 0, extra: THREE.MeshStandardMaterialParameters = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  }

  private blob(x: number, z: number, sx: number, sz = sx) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(sx, sz),
      new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    this.scene.add(m);
    return m;
  }

  private buildRoom() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight("#b9a6ff", "#1a1142", 1.15));
    const key = new THREE.DirectionalLight("#fff1dc", 1.1);
    key.position.set(4, 10, 6);
    s.add(key);

    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(13.6, 11),
      this.std("#ffffff", 0.95, 0, { map: carpetTexture() })
    );
    this.floor.rotation.x = -Math.PI / 2;
    s.add(this.floor);

    // Gold edge where the cutaway floor ends, so the room reads as a diorama.
    const lip = new THREE.Mesh(new THREE.BoxGeometry(13.9, 0.22, 0.16), this.gold());
    lip.position.set(0, -0.08, 5.55);
    s.add(lip);
    const base = new THREE.Mesh(new THREE.BoxGeometry(13.9, 0.5, 11.3), this.std("#120b30", 0.9));
    base.position.set(0, -0.27, 0);
    s.add(base);

    const wallMat = (rx: number) => this.std("#ffffff", 0.85, 0, { map: wallTexture(rx) });
    const back = new THREE.Mesh(new THREE.BoxGeometry(13.9, 3.6, 0.3), wallMat(7));
    back.position.set(0, 1.8, -5.65);
    s.add(back);
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.6, 11), wallMat(5));
    left.position.set(-6.95, 1.8, 0);
    s.add(left);
    const right = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, 11), wallMat(5));
    right.position.set(6.95, 0.55, 0);
    s.add(right);

    const neonMat = new THREE.MeshBasicMaterial({ color: glow(NEON, 2.6) });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(13.9, 0.05, 0.05), neonMat);
    strip.position.set(0, 3.45, -5.48);
    s.add(strip);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(13.9, 0.08, 0.08), this.gold());
    trim.position.set(0, 1.0, -5.48);
    s.add(trim);

    // Wall sconces: warm pools along the back wall, so the floor is not one flat dark.
    const shadeMat = this.gold();
    const bulbMat = new THREE.MeshBasicMaterial({ color: glow("#ffd79a", 2.4) });
    for (const x of [-5.6, -1.0, 4.9]) {
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.26, 20, 1, true), shadeMat);
      shade.position.set(x, 2.55, -5.42);
      shade.rotation.x = Math.PI;
      s.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), bulbMat);
      bulb.position.set(x, 2.5, -5.4);
      s.add(bulb);
      const light = new THREE.PointLight("#ffc98a", 7, 7, 1.5);
      light.position.set(x, 2.3, -5.0);
      s.add(light);
    }

    // Stars above the open roof.
    const starGeo = new THREE.BufferGeometry();
    const pts: number[] = [];
    for (let i = 0; i < 600; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI * 0.42;
      const r = 60;
      pts.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6 + 6, r * Math.sin(ph) * Math.sin(th) - 10);
    }
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    s.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: "#d9d0ff", size: 0.22, sizeAttenuation: true, fog: false })));
  }

  private archShape(w: number, h: number) {
    const shape = new THREE.Shape();
    const r = w / 2;
    shape.moveTo(-r, 0);
    shape.lineTo(r, 0);
    shape.lineTo(r, h - r);
    shape.absarc(0, h - r, r, 0, Math.PI, false);
    shape.lineTo(-r, 0);
    return shape;
  }

  private buildSlots() {
    const { canvas, ready } = reelStripCanvas();
    this.reelTex = new THREE.CanvasTexture(canvas);
    this.reelTex.colorSpace = THREE.SRGBColorSpace;
    this.reelTex.wrapT = THREE.RepeatWrapping;
    this.reelTex.anisotropy = 4;
    ready.then(() => (this.reelTex.needsUpdate = true));
    const reelMat = new THREE.MeshBasicMaterial({ map: this.reelTex, color: "#e4defa" });
    const lacquer = this.std("#4b2fc9", 0.32, 0.25);
    const lacquerDark = this.std("#2b1a7c", 0.4, 0.2);
    const gold = this.gold();
    const ink = this.std("#0c0824", 0.6);
    const marquee = new THREE.MeshBasicMaterial({ map: signTexture("CISCOINS", NEON, 512, 160, 92), transparent: true, color: glow("#ffffff", 1.2) });

    SLOT_X.forEach((x, m) => {
      const g = new THREE.Group();
      g.position.set(x, 0, SLOT_FRONT - 0.35);
      const shape = this.archShape(0.95, 1.95);
      const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3, curveSegments: 24 }), lacquer);
      body.position.z = -0.35;
      g.add(body);
      const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false, curveSegments: 24 }), gold);
      frame.position.z = 0.38;
      frame.scale.set(1.02, 1.01, 1);
      g.add(frame);
      const panel = new THREE.Mesh(new THREE.ExtrudeGeometry(this.archShape(0.85, 1.85), { depth: 0.02, bevelEnabled: false, curveSegments: 24 }), lacquerDark);
      panel.position.set(0, 0.05, 0.4);
      g.add(panel);

      const ownMarquee = marquee.clone();
      this.marquees[m] = ownMarquee;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.225), ownMarquee);
      sign.position.set(0, 1.6, 0.43);
      g.add(sign);

      const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.5, 0.04), ink);
      bezel.position.set(0, 1.18, 0.42);
      g.add(bezel);
      const reels: { geo: THREE.PlaneGeometry; offset: number }[] = [];
      for (let j = 0; j < 3; j++) {
        const geo = new THREE.PlaneGeometry(0.22, 0.42);
        const reel = new THREE.Mesh(geo, reelMat);
        reel.position.set((j - 1) * 0.245, 1.18, 0.445);
        g.add(reel);
        const r = { geo, offset: 0 };
        reels.push(r);
        this.setReel(r, Math.floor(Math.random() * STRIP.length));
      }
      this.reels.push(reels);
      // Payline as side markers, so the pay row itself stays clean.
      for (const side of [-1, 1]) {
        const marker = new THREE.Mesh(new THREE.CircleGeometry(0.035, 3), new THREE.MeshBasicMaterial({ color: glow(NEON, 2) }));
        marker.position.set(side * 0.405, 1.18, 0.452);
        marker.rotation.z = side > 0 ? Math.PI : 0;
        g.add(marker);
      }
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(0.76, 0.46),
        new THREE.MeshPhysicalMaterial({ color: "#ffffff", transparent: true, opacity: 0.12, roughness: 0.05, clearcoat: 1 })
      );
      glass.position.set(0, 1.18, 0.455);
      g.add(glass);

      const deck = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.32), lacquerDark);
      deck.position.set(0, 0.84, 0.5);
      deck.rotation.x = 0.35;
      g.add(deck);
      for (const bx of [-0.2, 0.05, 0.28]) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16), new THREE.MeshBasicMaterial({ color: glow(bx > 0.2 ? GOLD : NEON, 2) }));
        b.position.set(bx, 0.9, 0.5);
        b.rotation.x = 0.35;
        g.add(b);
      }
      const tray = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.22), gold);
      tray.position.set(0, 0.3, 0.48);
      g.add(tray);

      const lever = new THREE.Group();
      lever.position.set(0.52, 1.0, 0.1);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.55, 12), gold);
      arm.position.y = 0.27;
      lever.add(arm);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 16), new THREE.MeshStandardMaterial({ color: NEON, roughness: 0.3, emissive: NEON, emissiveIntensity: 0.4 }));
      knob.position.y = 0.56;
      lever.add(knob);
      g.add(lever);
      this.levers.push(lever);

      this.scene.add(g);
      this.blob(x, SLOT_FRONT - 0.2, 1.5, 1.2);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(x, 1, SLOT_FRONT - 0.35);
      hit.userData.station = m;
      this.scene.add(hit);
      this.hitTargets.push(hit);
      this.stations.push({ id: "slots", index: m, label: "Slot machine", stand: new THREE.Vector3(x, 0, SLOT_FRONT + 0.75) });
    });

    this.obstacles.push({ minX: -6.1, maxX: -0.95, minZ: -5.7, maxZ: SLOT_FRONT + 0.15 });
    const wash = new THREE.PointLight(NEON, 6, 6, 1.6);
    wash.position.set(-3.5, 2.3, -3.3);
    this.scene.add(wash);
  }

  private setReel(r: { geo: THREE.PlaneGeometry; offset: number }, stopOrOffset: number, isOffset = false) {
    const n = STRIP.length;
    // Middle cell shows stop k when the window's bottom edge sits at 1 - (k + 2) / n.
    r.offset = isOffset ? stopOrOffset : 1 - (stopOrOffset + 2) / n;
    const uv = r.geo.attributes.uv as THREE.BufferAttribute;
    const lo = r.offset;
    const hi = r.offset + 3 / n;
    uv.setXY(0, 0, hi);
    uv.setXY(1, 1, hi);
    uv.setXY(2, 0, lo);
    uv.setXY(3, 1, lo);
    uv.needsUpdate = true;
  }

  private buildTable() {
    const t = this.table;
    t.position.set(TABLE.x, 0, TABLE.z);
    const wood = this.std("#3a2213", 0.55, 0.05);
    const leather = this.std("#140d2e", 0.55, 0.05);
    const top = new THREE.Mesh(new THREE.CircleGeometry(1, 64), this.std("#ffffff", 0.9, 0, { map: feltTexture(TABLE.rx / TABLE.rz) }));
    top.rotation.x = -Math.PI / 2;
    top.scale.set(TABLE.rx, TABLE.rz, 1);
    top.position.y = TABLE.top;
    t.add(top);
    const apron = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.96, 0.16, 64), wood);
    apron.scale.set(TABLE.rx + 0.08, 1, TABLE.rz + 0.08);
    apron.position.y = TABLE.top - 0.085;
    t.add(apron);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 14, 72), leather);
    rail.rotation.x = Math.PI / 2;
    rail.scale.set(TABLE.rx + 0.06, TABLE.rz + 0.06, 1.2);
    rail.position.y = TABLE.top + 0.03;
    t.add(rail);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 72), this.gold());
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(TABLE.rx - 0.04, TABLE.rz - 0.04, 1);
    ring.position.y = TABLE.top + 0.012;
    t.add(ring);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, TABLE.top - 0.1, 24), wood);
    stem.position.y = (TABLE.top - 0.1) / 2;
    t.add(stem);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.08, 32), this.gold());
    foot.position.y = 0.04;
    t.add(foot);

    // A warm pool of light the table sits in. No lamp body: it would hang in the seated view.
    const lamp = new THREE.SpotLight("#ffd79a", 14, 8, 0.75, 0.6, 1.4);
    lamp.position.set(0, 3.2, 0);
    lamp.target.position.set(0, 0, 0);
    t.add(lamp, lamp.target);

    const seats = this.seatSpots();
    seats.forEach((p, i) => {
      const stool = new THREE.Group();
      stool.position.set(p.x * 1.0, 0, p.z * 1.0);
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.24, 0.1, 24), this.std("#3b22a6", 0.5));
      seat.position.y = 0.52;
      stool.add(seat);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 10), this.gold());
      leg.position.y = 0.26;
      stool.add(leg);
      t.add(stool);
      if (i > 0) t.add(this.buildBot(i, p));
    });

    this.dealerButton = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 24), [
      this.std("#ece8ff"), new THREE.MeshStandardMaterial({ map: dealerButtonTexture() }), this.std("#ece8ff"),
    ]);
    this.dealerButton.visible = false;
    t.add(this.dealerButton);

    for (let i = 0; i < 5; i++) {
      const g = new THREE.Group();
      t.add(g);
      this.chipStacks.push(g);
    }

    this.scene.add(t);
    this.blob(TABLE.x, TABLE.z, 4.6, 3.2);
    this.obstacles.push({ x: TABLE.x, z: TABLE.z, rx: TABLE.rx + 0.6, rz: TABLE.rz + 0.6 });
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24), new THREE.MeshBasicMaterial({ visible: false }));
    hit.scale.set(TABLE.rx + 0.3, 1, TABLE.rz + 0.3);
    hit.position.set(TABLE.x, 0.5, TABLE.z);
    hit.userData.station = 100;
    this.scene.add(hit);
    this.hitTargets.push(hit);
    this.stations.push({ id: "poker", index: 0, label: "Hold'em table", stand: new THREE.Vector3(TABLE.x, 0, TABLE.z + TABLE.rz + 0.85) });
  }

  // Seat 0 faces the camera; the bots go round to its left.
  private seatSpots() {
    return [
      new THREE.Vector3(0, 0, TABLE.rz + 0.55),
      new THREE.Vector3(-TABLE.rx - 0.45, 0, 0),
      new THREE.Vector3(0, 0, -TABLE.rz - 0.55),
      new THREE.Vector3(TABLE.rx + 0.45, 0, 0),
    ];
  }

  // Each bot is its own machine: Router is a flat box with antennas and a
  // status-light row, Switch is a rack unit with a grid of port lights,
  // Firewall is a brick shield with a glowing crest.
  private led(color: string) {
    const m = new THREE.MeshBasicMaterial({ color: glow(color, 1.6) });
    m.userData.base = m.color.clone();
    return m;
  }

  private buildBot(i: number, p: THREE.Vector3) {
    const g = new THREE.Group();
    g.position.set(p.x, 0.57, p.z);
    g.lookAt(0, 0.57, 0);
    const head = new THREE.Group();
    const leds: THREE.MeshBasicMaterial[] = [];
    const shell = this.std("#ece8ff", 0.35, 0.15);
    const dark = this.std("#1d1446", 0.45, 0.2);

    if (i === 1) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.24), this.std("#2b1a7c", 0.4, 0.2));
      body.position.y = 0.2;
      g.add(body);
      head.position.y = 0.5;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.15, 0.34), shell);
      head.add(box);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.01), dark);
      strip.position.set(0, 0, 0.172);
      head.add(strip);
      for (let k = 0; k < 5; k++) {
        const m = this.led(k === 2 ? GOLD : VIOLET);
        leds.push(m);
        const dot = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), m);
        dot.position.set(-0.16 + k * 0.08, 0, 0.18);
        head.add(dot);
      }
      for (const side of [-1, 1]) {
        const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.36, 8), this.gold());
        ant.position.set(side * 0.2, 0.2, -0.08);
        ant.rotation.z = -side * 0.22;
        head.add(ant);
        const m = this.led(VIOLET);
        leds.push(m);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), m);
        tip.position.set(side * 0.24, 0.38, -0.08);
        head.add(tip);
      }
    } else if (i === 2) {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.38, 20), dark);
      body.position.y = 0.2;
      g.add(body);
      head.position.y = 0.6;
      const rack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.34, 0.3), this.std("#14102e", 0.4, 0.3));
      head.add(rack);
      for (const y of [-0.18, 0.18]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.03, 0.32), this.gold());
        rail.position.y = y;
        head.add(rail);
      }
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 4; c++) {
          const m = this.led((r + c) % 3 ? GOLD : NEON);
          leds.push(m);
          const port = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 0.04), m);
          port.position.set(-0.12 + c * 0.08, 0.08 - r * 0.08, 0.152);
          head.add(port);
        }
    } else {
      const shield = new THREE.Shape();
      shield.moveTo(-0.22, 0.42);
      shield.lineTo(0.22, 0.42);
      shield.lineTo(0.22, 0.14);
      shield.quadraticCurveTo(0.2, -0.04, 0, -0.1);
      shield.quadraticCurveTo(-0.2, -0.04, -0.22, 0.14);
      shield.lineTo(-0.22, 0.42);
      const geo = new THREE.ExtrudeGeometry(shield, { depth: 0.16, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
      geo.translate(0, 0, -0.08);
      const bricks = brickTexture();
      bricks.repeat.set(2.4, 2.4);
      const body = new THREE.Mesh(geo, this.std("#ffffff", 0.75, 0, { map: bricks }));
      body.position.y = 0.12;
      g.add(body);
      head.position.y = 0.72;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), shell);
      dome.scale.set(1, 0.8, 0.9);
      head.add(dome);
      const m = this.led(NEON);
      leds.push(m);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.02), m);
      visor.position.set(0, 0.01, 0.175);
      head.add(visor);
      const crestMat = this.led("#ff8a5c");
      leds.push(crestMat);
      for (const [x, h] of [[-0.07, 0.16], [0, 0.24], [0.07, 0.16]]) {
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.045, h, 10), crestMat);
        flame.position.set(x, 0.16 + h / 2, -0.02);
        head.add(flame);
      }
    }
    g.add(head);
    this.bots[i] = { g, head, thinking: false, hop: 0, leds };
    return g;
  }

  private axieGltf = new GLTFLoader().loadAsync(AXIE_MODEL);

  // Scale a fresh Axie to 0.95 m and stand it on y = 0.
  private fitAxie(model: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y || 1;
    model.scale.setScalar(0.95 / h);
    model.position.y = -box.min.y * (0.95 / h);
    // Skinned meshes are culled by their bind-pose bounds; mid-stride they can vanish.
    model.traverse((o) => (o.frustumCulled = false));
  }

  // An arched jukebox on the right wall: neon tubes that pulse with the kick
  // drum, a record that turns while music plays, a speaker grille below.
  private buildJukebox() {
    const g = new THREE.Group();
    g.position.set(6.4, 0, -1.8);
    g.rotation.y = -Math.PI / 2;
    const shape = this.archShape(1.1, 1.8);
    const body = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3, curveSegments: 28 }),
      this.std("#3a2213", 0.45, 0.1)
    );
    body.position.z = -0.3;
    g.add(body);
    const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false, curveSegments: 28 }), this.gold());
    frame.position.z = 0.32;
    frame.scale.set(1.02, 1.01, 1);
    g.add(frame);
    const panel = new THREE.Mesh(new THREE.ExtrudeGeometry(this.archShape(0.94, 1.7), { depth: 0.02, bevelEnabled: false, curveSegments: 28 }), this.std("#120b30", 0.5));
    panel.position.set(0, 0.04, 0.34);
    g.add(panel);

    // Three nested neon arches.
    [NEON, GOLD, VIOLET].forEach((c, k) => {
      const r = 0.42 - k * 0.07;
      const top = 1.8 - 0.55;
      const pts: THREE.Vector3[] = [new THREE.Vector3(-r, 0.62, 0)];
      for (let a = 0; a <= 24; a++) {
        const th = Math.PI - (a / 24) * Math.PI;
        pts.push(new THREE.Vector3(Math.cos(th) * r, top + Math.sin(th) * r, 0));
      }
      pts.push(new THREE.Vector3(r, 0.62, 0));
      const mat = new THREE.MeshBasicMaterial({ color: glow(c, 0.92) });
      mat.userData.base = new THREE.Color(c);
      this.jukeTubes.push(mat);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.022, 8), mat);
      tube.position.z = 0.37;
      g.add(tube);
    });

    // The record window and the record.
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.24, 40), this.std("#0b0820", 0.3));
    glass.position.set(0, 1.18, 0.365);
    g.add(glass);
    this.jukeDisc.position.set(0, 1.18, 0.372);
    const vinyl = new THREE.Mesh(new THREE.CircleGeometry(0.2, 40), this.std("#0c0a14", 0.25, 0.3));
    this.jukeDisc.add(vinyl);
    for (const r of [0.15, 0.11]) {
      const groove = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.004, 40), new THREE.MeshBasicMaterial({ color: "#3a3550" }));
      groove.position.z = 0.001;
      this.jukeDisc.add(groove);
    }
    const label = new THREE.Mesh(new THREE.CircleGeometry(0.06, 24), new THREE.MeshBasicMaterial({ color: GOLD }));
    label.position.z = 0.002;
    this.jukeDisc.add(label);
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.012), new THREE.MeshBasicMaterial({ color: "#1d1446" }));
    mark.position.set(0.025, 0, 0.003);
    this.jukeDisc.add(mark);
    g.add(this.jukeDisc);

    // Song buttons and the speaker grille.
    [NEON, GOLD, VIOLET, "#ece8ff"].forEach((c, k) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.05), new THREE.MeshBasicMaterial({ color: glow(c, 1.1) }));
      b.position.set(-0.21 + k * 0.14, 0.8, 0.37);
      g.add(b);
    });
    for (let k = 0; k < 6; k++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.025, 0.02), this.gold());
      bar.position.set(0, 0.24 + k * 0.07, 0.36);
      g.add(bar);
    }
    this.scene.add(g);
    this.blob(6.1, -1.8, 1.4, 1.8);
    this.obstacles.push({ minX: 5.95, maxX: 6.95, minZ: -2.45, maxZ: -1.15 });
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.9, 1.2), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(6.4, 0.95, -1.8);
    hit.userData.station = 300;
    this.scene.add(hit);
    this.hitTargets.push(hit);
    this.stations.push({ id: "jukebox", index: 0, label: "Jukebox", stand: new THREE.Vector3(5.3, 0, -1.8) });
    const wash = new THREE.PointLight(NEON, 4, 4, 1.6);
    wash.position.set(5.6, 1.6, -1.8);
    this.scene.add(wash);
  }

  setMusic(m: { pulse(): number; playing: boolean } | null) {
    this.music = m;
  }

  setSfx(sfx: Sfx | null) {
    this.sfx = sfx;
  }

  // A booth against the left wall: wood sides, a brass grille with a serving
  // window, shelves of chip racks and a safe behind the counter, and the
  // cashier standing at the window.
  private buildCashier() {
    const g = new THREE.Group();
    g.position.set(-6.35, 0, 0.6);
    const wood = this.std("#3a2213", 0.55, 0.05);
    const lacquer = this.std("#2b1a7c", 0.4, 0.2);
    const gold = this.gold();

    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 2.6), this.std("#1d1446", 0.7));
    floor.position.set(0, 0.03, 0);
    g.add(floor);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.5, 2.6), this.std("#24186a", 0.8));
    back.position.set(-0.62, 1.25, 0);
    g.add(back);
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshBasicMaterial({ map: logoTexture(), transparent: true }));
    logo.position.set(-0.58, 1.95, 0);
    logo.rotation.y = Math.PI / 2;
    g.add(logo);
    // The back side is a full wall; the side facing the room stops at counter
    // height, with a gold post carrying the header, so the floor sees inside.
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.55, 0.08), wood);
    wall.position.set(0, 1.275, -1.3);
    g.add(wall);
    const low = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.05, 0.08), wood);
    low.position.set(0, 0.525, 1.3);
    g.add(low);
    const lowCap = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.04, 0.12), gold);
    lowCap.position.set(0, 1.07, 1.3);
    g.add(lowCap);
    for (const z of [-1.3, 1.3]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.55, 12), gold);
      post.position.set(0.71, 1.275, z);
      g.add(post);
    }
    const header = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.42, 2.7), this.std("#1d1446", 0.4));
    header.position.set(0, 2.66, 0);
    g.add(header);
    for (const y of [2.46, 2.86]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 2.7), gold);
      line.position.set(0.75, y, 0);
      g.add(line);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.29), new THREE.MeshBasicMaterial({ map: signTexture("CASHIER", GOLD, 1024, 192, 120), transparent: true, color: glow("#ffffff", 1.1) }));
    // Angled toward the room camera so the station reads on arrival.
    sign.position.set(0.95, 2.66, 0.75);
    sign.rotation.y = Math.PI / 4;
    g.add(sign);

    // Counter, with gold inlay panels on its face.
    const counter = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.05, 2.52), lacquer);
    counter.position.set(0.5, 0.525, 0);
    g.add(counter);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.06, 2.6), gold);
    slab.position.set(0.5, 1.08, 0);
    g.add(slab);
    for (const z of [-0.8, 0, 0.8]) {
      const inlay = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.62, 0.62), this.std("#3b22a6", 0.35, 0.25));
      inlay.position.set(0.73, 0.55, z);
      g.add(inlay);
      for (const [dy, dz, w, h] of [[0.32, 0, 0.66, 0.025], [-0.32, 0, 0.66, 0.025], [0, 0.32, 0.025, 0.66], [0, -0.32, 0.025, 0.66]]) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.012, h, w), gold);
        edge.position.set(0.735, 0.55 + dy, z + dz);
        g.add(edge);
      }
    }

    // Brass grille with an arched serving window in the middle.
    for (let z = -1.2; z <= 1.21; z += 0.16) {
      if (Math.abs(z) < 0.4) continue;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.34, 8), gold);
      bar.position.set(0.62, 1.78, z);
      g.add(bar);
    }
    for (const z of [-0.36, 0.36]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.72, 10), gold);
      post.position.set(0.62, 1.47, z);
      g.add(post);
    }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.02, 8, 32, Math.PI), gold);
    arch.position.set(0.62, 1.83, 0);
    arch.rotation.y = Math.PI / 2;
    g.add(arch);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 2.5), gold);
    rail.position.set(0.62, 2.44, 0);
    g.add(rail);

    // On the counter: a service bell and a tray of chips.
    const bellBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.025, 20), this.std("#1d1446", 0.4));
    bellBase.position.set(0.55, 1.125, -0.2);
    g.add(bellBase);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), gold);
    bell.position.set(0.55, 1.137, -0.2);
    g.add(bell);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.36), this.std("#14102e", 0.5));
    tray.position.set(0.5, 1.125, 0.22);
    g.add(tray);
    for (let k = 0; k < 4; k++)
      for (let h = 0; h < 3 + (k % 2); h++) {
        const chip = new THREE.Mesh(this.chipGeo, this.chipMats[k % this.chipMats.length]);
        chip.position.set(0.5, 1.15 + h * 0.015, 0.1 + k * 0.08);
        g.add(chip);
      }

    // Behind the counter: two shelves of chip racks and a safe.
    for (const y of [1.0, 1.42]) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 1.0), wood);
      shelf.position.set(-0.45, y, -0.72);
      g.add(shelf);
      for (let k = 0; k < 6; k++) {
        const stack = new THREE.Group();
        stack.position.set(-0.45, y + 0.02, -1.12 + k * 0.16);
        for (let h = 0; h < 5 + ((k * 3 + Math.round(y * 10)) % 4); h++) {
          const chip = new THREE.Mesh(this.chipGeo, this.chipMats[(k + Math.round(y)) % this.chipMats.length]);
          chip.position.y = 0.008 + h * 0.015;
          stack.add(chip);
        }
        g.add(stack);
      }
    }
    const safe = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.5), this.std("#2a2838", 0.35, 0.6));
    safe.position.set(-0.36, 0.33, 0.82);
    g.add(safe);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 24), gold);
    dial.rotation.z = Math.PI / 2;
    dial.position.set(-0.115, 0.4, 0.82);
    g.add(dial);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.16), gold);
    handle.position.set(-0.115, 0.22, 0.82);
    g.add(handle);
    const deskLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.08, 0.12, 16, 1, true), this.std(GOLD, 0.3, 0.6, { side: THREE.DoubleSide }));
    deskLamp.position.set(-0.36, 0.74, 0.82);
    g.add(deskLamp);
    const deskBulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: glow("#ffd79a", 1.6) }));
    deskBulb.position.set(-0.36, 0.7, 0.82);
    g.add(deskBulb);
    const inside = new THREE.PointLight("#ffc98a", 1.8, 3.2, 1.6);
    inside.position.set(-0.45, 2.3, -0.5);
    g.add(inside);

    g.add(this.buildCashierPerson());
    this.scene.add(g);
    this.obstacles.push({ minX: -7.2, maxX: -5.55, minZ: -0.75, maxZ: 1.95 });
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.7, 2.7), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(-6.3, 1.35, 0.6);
    hit.userData.station = 200;
    this.scene.add(hit);
    this.hitTargets.push(hit);
    this.stations.push({ id: "cashier", index: 0, label: "Cashier", stand: new THREE.Vector3(-4.95, 0, 0.6) });
    const lamp = new THREE.PointLight(GOLD, 2.5, 5, 1.6);
    lamp.position.set(-5.0, 2.6, 1.4);
    this.scene.add(lamp);
  }

  // The cashier: a vest, a bow tie, a name tag. Breathes, follows Axie with
  // their eyes, and waves when someone steps up to the window.
  private buildCashierPerson() {
    const root = new THREE.Group();
    root.position.set(-0.12, 0, 0);
    root.rotation.y = Math.PI / 2;
    const skin = this.std("#c68a5e", 0.6);
    const hair = this.std("#1b1320", 0.7);
    const ink = new THREE.MeshBasicMaterial({ color: "#1b1320" });

    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.9, 16), this.std("#1a1430", 0.7));
    legs.position.y = 0.45;
    root.add(legs);
    const torso = new THREE.Group();
    torso.position.y = 0.92;
    const shirt = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.4, 6, 16), this.std("#cfc8e6", 0.7));
    shirt.position.y = 0.33;
    torso.add(shirt);
    const vest = new THREE.Mesh(new THREE.CapsuleGeometry(0.212, 0.3, 6, 16), this.std("#5b3fd6", 0.45, 0.1));
    vest.position.y = 0.28;
    vest.scale.z = 0.94;
    torso.add(vest);
    const bib = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.24), this.std("#cfc8e6", 0.7));
    bib.position.set(0, 0.45, 0.2);
    torso.add(bib);
    for (const side of [-1, 1]) {
      const bow = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 10), this.gold());
      bow.rotation.z = (side * Math.PI) / 2;
      bow.position.set(side * 0.035, 0.6, 0.19);
      torso.add(bow);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), this.gold());
    knot.position.set(0, 0.6, 0.2);
    torso.add(knot);
    const tag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, 0.01), this.gold());
    tag.position.set(0.1, 0.42, 0.205);
    torso.add(tag);
    root.add(torso);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 12), skin);
    neck.position.y = 1.6;
    root.add(neck);
    const head = new THREE.Group();
    head.position.y = 1.78;
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 18), skin);
    head.add(face);
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 18), hair);
    hairCap.scale.set(1.02, 0.82, 1);
    hairCap.position.set(0, 0.05, -0.04);
    head.add(hairCap);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), ink);
      eye.position.set(side * 0.06, 0.01, 0.155);
      head.add(eye);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.01, 0.01), ink);
      brow.position.set(side * 0.06, 0.06, 0.158);
      brow.rotation.z = side * -0.12;
      head.add(brow);
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), skin);
      ear.position.set(side * 0.168, 0, 0);
      head.add(ear);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 16, Math.PI), ink);
    smile.rotation.z = Math.PI;
    smile.position.set(0, -0.045, 0.152);
    head.add(smile);
    root.add(head);

    // Arms rest forward on the counter; the one on the room side waves.
    let wave = new THREE.Group();
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.25, 1.46, 0);
      arm.rotation.x = -0.7;
      const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.36, 6, 12), this.std("#cfc8e6", 0.7));
      sleeve.position.y = -0.24;
      arm.add(sleeve);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), skin);
      hand.position.y = -0.48;
      arm.add(hand);
      root.add(arm);
      if (side === -1) wave = arm;
    }
    this.cashier = { root, head, torso, wave, greet: 0 };
    return root;
  }

  private buildDecor() {
    // A light plate so the purple logo reads against the dark wall.
    const plate = new THREE.Mesh(new THREE.CircleGeometry(0.84, 64), new THREE.MeshBasicMaterial({ color: "#ece8ff" }));
    plate.position.set(TABLE.x, 2.4, -5.49);
    this.scene.add(plate);
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: logoTexture(), transparent: true }));
    logo.position.set(TABLE.x, 2.4, -5.48);
    this.scene.add(logo);
    const halo = new THREE.Mesh(new THREE.RingGeometry(0.85, 0.9, 64), new THREE.MeshBasicMaterial({ color: glow(GOLD, 1.8) }));
    halo.position.set(TABLE.x, 2.4, -5.485);
    this.scene.add(halo);

    const gold = this.gold();
    for (const [x, z] of [[-0.55, -5.2], [6.2, -5.2]]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 3.6, 24), this.std("#2b1a7c", 0.45, 0.15));
      pillar.position.set(x, 1.8, z);
      this.scene.add(pillar);
      for (const y of [0.1, 3.5]) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.16, 24), gold);
        cap.position.set(x, y, z);
        this.scene.add(cap);
      }
      this.obstacles.push({ x, z, rx: 0.4, rz: 0.4 });
    }

    const potMat = this.std("#1d1446", 0.4, 0.2);
    const leafMat = this.std("#2f6f62", 0.7);
    for (const [x, z] of [[6.2, 4.6], [6.3, -4.3], [-6.3, 4.3]]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.5, 20), potMat);
      pot.position.set(x, 0.25, z);
      this.scene.add(pot);
      for (let k = 0; k < 5; k++) {
        const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26 - k * 0.02, 0), leafMat);
        leaf.position.set(x + Math.sin(k * 2.1) * 0.16, 0.7 + k * 0.17, z + Math.cos(k * 2.1) * 0.16);
        this.scene.add(leaf);
      }
      this.blob(x, z, 1, 1);
      this.obstacles.push({ x, z, rx: 0.45, rz: 0.45 });
    }

    // Velvet rope at the entrance.
    const posts = [new THREE.Vector3(-2.1, 0, 5.05), new THREE.Vector3(-1.0, 0, 5.05), new THREE.Vector3(1.0, 0, 5.05), new THREE.Vector3(2.1, 0, 5.05)];
    for (const p of posts) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.9, 12), gold);
      post.position.set(p.x, 0.45, p.z);
      this.scene.add(post);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), gold);
      ball.position.set(p.x, 0.92, p.z);
      this.scene.add(ball);
    }
    const ropeMat = this.std("#7c2f6a", 0.6);
    for (const [a, b] of [[0, 1], [2, 3]]) {
      const pa = posts[a].clone().setY(0.82);
      const pb = posts[b].clone().setY(0.82);
      const mid = pa.clone().lerp(pb, 0.5).setY(0.6);
      const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(pa, mid, pb), 20, 0.03, 8), ropeMat);
      this.scene.add(rope);
    }

    // Lounge corner by the right wall: somewhere to look at between games.
    const velvet = this.std("#5b2a9a", 0.8);
    const sofa = new THREE.Group();
    sofa.position.set(5.9, 0, 3.1);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.42, 2.2), velvet);
    seat.position.y = 0.21;
    sofa.add(seat);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.6, 2.2), velvet);
    backrest.position.set(0.3, 0.6, 0);
    sofa.add(backrest);
    for (const z of [-1.1, 1.1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.18), velvet);
      arm.position.set(0, 0.28, z);
      sofa.add(arm);
    }
    this.scene.add(sofa);
    const coffee = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 32), this.std("#2b1a7c", 0.4, 0.2));
    coffee.position.set(5.05, 0.42, 3.1);
    this.scene.add(coffee);
    const coffeeLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.4, 12), gold);
    coffeeLeg.position.set(5.05, 0.2, 3.1);
    this.scene.add(coffeeLeg);
    this.blob(5.5, 3.1, 2.2, 3);
    // Kept clear of the table so there is a walkway to the jukebox.
    this.obstacles.push({ minX: 4.55, maxX: 6.4, minZ: 1.9, maxZ: 4.3 });
    const floorLamp = new THREE.PointLight("#ffc98a", 5, 5, 1.6);
    floorLamp.position.set(5.6, 1.8, 1.7);
    this.scene.add(floorLamp);
    const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 8), gold);
    lampPole.position.set(6.1, 0.85, 1.7);
    this.scene.add(lampPole);
    const lampShade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.24, 0.28, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: glow("#ffd79a", 0.95), side: THREE.DoubleSide })
    );
    lampShade.position.set(6.1, 1.78, 1.7);
    this.scene.add(lampShade);
  }

  private buildAxie() {
    this.axie.position.copy(SPAWN);
    this.scene.add(this.axie);
    const shadow = this.blob(0, 0, 0.9);
    this.scene.remove(shadow);
    shadow.position.set(0, 0.014, 0);
    this.axie.add(shadow);

    this.axieGltf
      .then((gltf) => {
        if (this.disposed) return;
        const model = cloneRig(gltf.scene);
        this.fitAxie(model);
        this.model = model;
        this.modelBase = { y: model.position.y, scale: model.scale.x };
        this.axie.add(model);
        const mixer = new THREE.AnimationMixer(model);
        this.mixers.push(mixer);
        const clip = gltf.animations[0];
        if (clip) {
          this.walkAction = mixer.clipAction(clip);
          this.walkAction.setEffectiveWeight(0).play();
        }
        this.cb.onReady();
      })
      .catch(() => {
        // Without the model, a simple stand-in keeps the floor playable.
        const stand = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.4, 6, 16), this.std("#ff9ec7", 0.5));
        stand.position.y = 0.45;
        this.axie.add(stand);
        this.cb.onReady();
      });
  }

  // ── Public API ──────────────────────────────────────────────────────────
  setInput(x: number, y: number) {
    this.input.set(x, y);
    if (x || y) {
      this.walkTarget = null;
      this.overview = false;
    }
  }

  walkToStation(id: StationId, index = 0) {
    const st = this.stations.find((s) => s.id === id && s.index === index);
    if (st) this.walkTarget = st.stand.clone();
  }

  sit(st: Station) {
    this.seated = st;
    this.overview = false;
    this.walkTarget = null;
    this.input.set(0, 0);
    this.axie.position.copy(st.stand);
    this.heading = st.id === "cashier" ? -Math.PI / 2 : Math.PI;
    // At a slot, Axie steps beside the cabinet and faces you, so the close-up stays clear.
    if (st.id === "jukebox") this.heading = Math.PI / 2;
    if (st.id === "cashier") {
      // Axie steps to the side of the window so the cashier is in full view.
      this.axie.position.set(st.stand.x + 0.1, 0, st.stand.z + 1.05);
      this.heading = -Math.PI / 2;
    }
    if (st.id === "cashier" && this.cashier) {
      this.cashier.greet = 1.8;
      this.sfx?.play("bell");
    }
    if (st.id === "slots") {
      this.axie.position.set(SLOT_X[st.index] + 0.8, 0, SLOT_FRONT + 0.3);
      this.heading = -0.35;
    }
    // At the table Axie would block your own cards, so the camera takes the seat.
    this.axie.visible = st.id !== "poker";
    this.startCameraMove();
  }

  stand() {
    if (!this.seated) return;
    const st = this.seated;
    this.seated = null;
    this.axie.visible = true;
    this.axie.position.copy(st.stand);
    this.startCameraMove();
  }

  // Axie's reactions are procedural: a hop for a win, a spin-hop for a big
  // one, a slump for a loss. The walk clip has no emotes.
  react(kind: "win" | "big" | "lose") {
    if (this.reduced && kind !== "lose") return;
    this.reactKind = kind;
    this.reactT = 0;
  }

  // The spin is the casino's one authored moment: lever, push-in on the
  // glass, reels landing one by one with a thud, and when the first two
  // match, a long slow third reel while the camera creeps closer.
  spinReels(machine: number, stops: [number, number, number], anticipate: boolean): Promise<void> {
    const reels = this.reels[machine];
    const lever = this.levers[machine];
    if (!reels) return Promise.resolve();
    const n = STRIP.length;
    const quick = this.reduced;
    if (lever) this.tween(quick ? 0.01 : 0.55, (k) => (lever.rotation.x = Math.sin(k * Math.PI) * 0.95));
    this.sfx?.play("lever");
    const roll = this.sfx?.roll();
    if (!quick) {
      this.zoomGoal = 1;
      this.shake = Math.max(this.shake, 0.012);
    }
    const stopAt = quick ? [0.35, 0.5, 0.65] : [1.8, 2.75, anticipate ? 5.4 : 3.7];
    return new Promise((resolve) => {
      let left = 3;
      reels.forEach((r, j) => {
        const from = r.offset;
        const target = 1 - (stops[j] + 2) / n;
        const delta = (((target - from) % 1) + 1) % 1;
        const dur = stopAt[j];
        const turns = quick ? 0 : Math.round(dur * 1.7);
        const slowTail = anticipate && j === 2 && !quick;
        if (slowTail) {
          // Once the second reel lands, the third keeps rolling and the room leans in.
          this.sfx?.riser(stopAt[1], stopAt[2] - stopAt[1]);
          this.later(stopAt[1], () => {
            this.zoomGoal = 1.22;
            this.hum = 0.016;
            this.flashMachine = machine;
            this.flash = Math.max(this.flash, 0.5);
          });
        }
        const curve = slowTail ? (k: number) => 1 - Math.pow(1 - k, 4) : easeOutBack;
        this.tween(dur, (k) => this.setReel(r, from + (turns + delta) * curve(k), true), () => {
          this.setReel(r, stops[j]);
          if (!quick) this.shake = Math.max(this.shake, j === 2 ? 0.05 : 0.03);
          this.sfx?.play("thunk");
          roll?.setActive(left - 1);
          if (left === 1) roll?.stop();
          if (j === 2) this.hum = 0;
          if (--left === 0) resolve();
        });
      });
    });
  }

  // The payoff after the reels settle: shake and flash sized to the win,
  // coins out of the tray, then the camera eases back to the cabinet.
  settleSpin(machine: number, size: "none" | "win" | "big", multiple = 1) {
    const quick = this.reduced;
    if (size !== "none") {
      this.flashMachine = machine;
      this.flash = size === "big" ? 2.4 : 1.4;
      if (!quick) {
        this.shake = size === "big" ? 0.16 : 0.07;
        this.zoomGoal = size === "big" ? 1.3 : 1.1;
        const x = SLOT_X[machine];
        this.burstCoins(new THREE.Vector3(x, 0.38, SLOT_FRONT + 0.2), size === "big" ? 46 : 18, new THREE.Vector3(0, 0, 1));
      }
      this.react(size === "big" ? "big" : "win");
      this.sfx?.win(winIntensity(multiple));
    }
    this.later(quick ? 0.01 : size === "big" ? 1.9 : 1.1, () => (this.zoomGoal = 0));
  }

  // Turn and river: the camera leans over the board while the card waits face down.
  focusBoard(on: boolean) {
    if (this.reduced) return;
    this.zoomGoal = on ? 1 : 0;
  }

  // The pot slides to whoever won it. A win of your own adds coins and a kick.
  payPot(seat: number, big: boolean, multiple = 1) {
    const g = this.chipStacks[4];
    const spot = this.seatSpots()[seat].clone().multiplyScalar(0.5);
    const from = g.position.clone();
    const to = new THREE.Vector3(spot.x - 0.88, 0, spot.z + 0.12);
    this.tween(this.reduced ? 0.01 : 0.7, (k) => g.position.lerpVectors(from, to, ease(k)), () => {
      g.clear();
      g.position.set(0, 0, 0);
    });
    if (seat === 0 && !this.reduced) {
      this.shake = big ? 0.12 : 0.05;
      this.burstCoins(new THREE.Vector3(TABLE.x, TABLE.top + 0.1, TABLE.z), big ? 34 : 14, new THREE.Vector3(0, 0, 1));
    }
    this.sfx?.play("chips");
    // Your pot sounds as big as it is, measured in big blinds.
    if (seat === 0) this.sfx?.win(winIntensity(multiple, 300));
    const bot = this.bots[seat];
    if (bot && !this.reduced) bot.hop = 1;
  }

  attachLabels(els: (HTMLElement | null)[]) {
    this.labelEls = els;
  }

  renderTable(d: TableDraw | null) {
    const t = this.table;
    if (!d) {
      for (const m of this.boardMeshes) t.remove(m);
      this.boardMeshes = [];
      this.holeMeshes.forEach((hs) => hs.forEach((m) => t.remove(m)));
      this.holeMeshes = [[], [], [], []];
      this.chipStacks.forEach((g) => g.clear());
      this.dealerButton.visible = false;
      return;
    }
    const y = TABLE.top + 0.004;
    const deckFrom = new THREE.Vector3(0, y + 0.3, -TABLE.rz + 0.2);
    const quick = this.reduced;

    // Board cards land face down, then turn over. The flop turns in a quick
    // run; the turn and the river are held a beat longer and flip slower.
    const fresh = d.board.length - this.boardMeshes.length;
    d.board.forEach((card, i) => {
      let m = this.boardMeshes[i];
      if (!m) {
        m = this.makeCard(null);
        this.boardMeshes[i] = m;
        t.add(m);
        const dest = new THREE.Vector3(-0.5 + i * 0.25, y + 0.002, -0.12);
        const k = i - (this.boardMeshes.length - fresh);
        this.deal(m, deckFrom, dest, k * 0.1);
        const flop = fresh >= 3;
        const hold = quick ? 0 : flop ? 0.55 + k * 0.2 : i === 3 ? 0.95 : 1.45;
        const flipDur = quick ? 0.01 : flop ? 0.42 : i === 3 ? 0.6 : 0.85;
        this.setCardFace(m, card, hold, flipDur, i === 4);
      } else this.setCardFace(m, card, 0, quick ? 0.01 : 0.42);
    });

    const spots = this.seatSpots();
    let reveal = 0;
    d.seats.forEach((s, i) => {
      const meshes = this.holeMeshes[i];
      const seatDir = spots[i].clone().normalize();
      const base = spots[i].clone().multiplyScalar(0.55);
      const side = new THREE.Vector3(-seatDir.z, 0, seatDir.x);
      // A showdown turns the bots' cards over one seat at a time.
      const turning = i > 0 && s.hole.some((c) => c !== null) && meshes.some((m) => !m.userData.up);
      const seatDelay = turning ? 0.35 + reveal++ * 0.5 : 0;
      s.hole.forEach((card, k) => {
        let m = meshes[k];
        // Your own cards sit large at your edge, tilted up so a phone can read them.
        const mine = i === 0;
        const dest = mine
          ? new THREE.Vector3((k - 0.5) * 0.3, y + 0.09 + k * 0.004, TABLE.rz - 0.32)
          : base.clone().addScaledVector(side, (k - 0.5) * 0.22).setY(y + 0.004 + k * 0.002);
        if (!m) {
          m = this.makeCard(card);
          meshes[k] = m;
          t.add(m);
          if (mine) {
            m.scale.setScalar(1.45);
            m.rotation.x = -Math.PI / 2 + 0.75;
            m.rotation.z = (k - 0.5) * -0.12;
          } else m.rotation.z = Math.atan2(seatDir.x, seatDir.z);
          this.deal(m, deckFrom, dest, (i + k * 4) * 0.06);
        } else this.setCardFace(m, card, seatDelay + k * 0.08, quick ? 0.01 : 0.45);
        m.visible = !s.folded;
      });

      this.fillStack(this.chipStacks[i], s.bet, spots[i].clone().multiplyScalar(0.36).setY(y));
    });
    this.fillStack(this.chipStacks[4], d.pot - d.seats.reduce((a, s) => a + s.bet, 0), new THREE.Vector3(0.88, y, -0.12));

    const b = spots[d.button].clone().multiplyScalar(0.7);
    const side = new THREE.Vector3(-b.z, 0, b.x).normalize().multiplyScalar(0.28);
    this.dealerButton.position.copy(b.add(side)).setY(y + 0.01);
    this.dealerButton.visible = true;
  }

  setThinking(seat: number | null) {
    this.bots.forEach((b, i) => {
      if (b) b.thinking = i === seat;
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats) {
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
        m.dispose();
      }
    });
    this.composer.dispose();
    this.renderer.dispose();
    el.remove();
  }

  // ── Table helpers ───────────────────────────────────────────────────────
  // A card is two planes back to back. Face-up is rotation.y = 0; face-down
  // is a half turn about the card's own long axis.
  private makeCard(card: Card | null) {
    const g = new THREE.Group();
    // Unlit and just under white: lit cards under the table lamp crossed the bloom threshold and glowed.
    const front = new THREE.Mesh(this.cardGeo, new THREE.MeshBasicMaterial({ color: "#e9e5f7", transparent: true }));
    const back = new THREE.Mesh(this.cardGeo, new THREE.MeshBasicMaterial({ color: "#e9e5f7", transparent: true, map: cardBackTexture() }));
    back.rotation.y = Math.PI;
    g.add(front, back);
    g.rotation.x = -Math.PI / 2;
    g.rotation.y = Math.PI;
    g.userData.up = false;
    this.setCardFace(g, card, 0, 0);
    return g;
  }

  private setCardFace(g: THREE.Group, card: Card | null, delay: number, dur: number, kick = false) {
    if (card === null || g.userData.up) return;
    const front = g.children[0] as THREE.Mesh;
    const mat = front.material as THREE.MeshBasicMaterial;
    mat.map = cardTexture(card);
    mat.needsUpdate = true;
    g.userData.up = true;
    if (dur <= 0.02 && delay <= 0) {
      g.rotation.y = 0;
      return;
    }
    this.later(delay, () => {
      this.sfx?.play("flip");
      const lift = g.position.y;
      this.tween(dur, (k) => {
        const e = easeInOut(k);
        g.rotation.y = Math.PI * (1 - e);
        g.position.y = lift + Math.sin(k * Math.PI) * 0.08;
      }, () => {
        g.position.y = lift;
        if (kick && !this.reduced) this.shake = Math.max(this.shake, 0.035);
      });
    });
  }

  private deal(m: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, delay: number) {
    this.sfx?.play("deal", delay);
    if (this.reduced) {
      m.position.copy(to);
      return;
    }
    const total = 0.32 + delay;
    m.position.copy(from);
    this.tween(total, (k) => {
      const kk = THREE.MathUtils.clamp((k * total - delay) / 0.32, 0, 1);
      m.position.lerpVectors(from, to, ease(kk));
      m.position.y = to.y + Math.sin(kk * Math.PI) * 0.12;
    });
  }

  private fillStack(g: THREE.Group, amount: number, at: THREE.Vector3) {
    g.clear();
    if (amount <= 0) return;
    const count = Math.min(14, Math.ceil(Math.log2(amount + 1) * 1.4));
    const columns = count > 7 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const col = k % columns;
      const chip = new THREE.Mesh(this.chipGeo, this.chipMats[(k + col) % this.chipMats.length]);
      chip.position.set(at.x + col * 0.1, at.y + 0.008 + Math.floor(k / columns) * 0.015, at.z);
      g.add(chip);
    }
  }

  // ── Loop, camera, movement ──────────────────────────────────────────────
  private tween(dur: number, step: (k: number) => void, done?: () => void) {
    this.tweens.push({ t: 0, dur: Math.max(dur, 0.001), step, done });
  }

  private later(sec: number, fn: () => void) {
    this.tween(sec, () => {}, fn);
  }

  private burstCoins(at: THREE.Vector3, count: number, forward: THREE.Vector3) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.coinGeo, this.coinMat);
      m.position.copy(at);
      m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.scene.add(m);
      const v = new THREE.Vector3((Math.random() - 0.5) * 2.2, 2.4 + Math.random() * 2.2, 0)
        .addScaledVector(forward, 0.6 + Math.random() * 1.4);
      this.coins.push({ m, v, spin: 6 + Math.random() * 10, life: 1.6 + Math.random() * 0.8 });
    }
  }

  private updateEffects(dt: number) {
    // Coins: gravity, a damped bounce on the carpet, then gone.
    this.coins = this.coins.filter((c) => {
      c.life -= dt;
      c.v.y -= 9.8 * dt;
      c.m.position.addScaledVector(c.v, dt);
      if (c.m.position.y < 0.02) {
        c.m.position.y = 0.02;
        c.v.y *= -0.35;
        c.v.x *= 0.6;
        c.v.z *= 0.6;
      }
      c.m.rotation.x += c.spin * dt;
      if (c.life > 0) return true;
      this.scene.remove(c.m);
      return false;
    });

    // Marquee: a decaying flash, flickering while the last reel crawls.
    this.flash = Math.max(0, this.flash - dt * 1.1);
    const t = this.clock.elapsedTime;
    this.marquees.forEach((mat, i) => {
      if (!mat) return;
      const on = i === this.flashMachine ? this.flash : 0;
      const pulse = on > 0 ? on * (0.55 + 0.45 * Math.sin(t * (this.hum ? 30 : 14))) : 0;
      mat.color.setScalar(1.2 + Math.min(pulse, 1) * 0.55);
    });

    // Bots: a thinking head tilt, and a hop when they take a pot.
    this.bots.forEach((b) => {
      if (!b) return;
      const think = b.thinking && !this.reduced;
      b.head.rotation.z = think ? Math.sin(t * 7) * 0.3 : b.head.rotation.z * 0.85;
      // Status lights chatter while the bot thinks, and idle in a slow breath.
      b.leds.forEach((m, k) => {
        const level = think ? (Math.sin(t * 18 + k * 2.3) > 0.2 ? 1.9 : 0.35) : 1.1 + Math.sin(t * 1.6 + k) * 0.25;
        m.color.copy(m.userData.base).multiplyScalar(level);
      });
      b.hop = Math.max(0, b.hop - dt * 1.4);
      const hop = Math.sin((1 - b.hop) * Math.PI * 2) * (b.hop > 0 ? 1 : 0);
      b.g.position.y = 0.57 + Math.max(0, hop) * 0.22 + (think ? Math.abs(Math.sin(t * 7)) * 0.03 : 0);
    });

    const c = this.cashier;
    if (c) {
      c.torso.scale.y = 1 + Math.sin(t * 2.1) * 0.012;
      // Eyes follow Axie when Axie is close; the head turns, within reason.
      const wp = new THREE.Vector3();
      c.root.getWorldPosition(wp);
      const dx = this.axie.position.x - wp.x;
      const dz = this.axie.position.z - wp.z;
      let yaw = 0;
      if (Math.hypot(dx, dz) < 6) {
        yaw = Math.atan2(dx, dz) - Math.PI / 2;
        yaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(yaw), Math.cos(yaw)), -0.9, 0.9);
      }
      c.head.rotation.y += (yaw - c.head.rotation.y) * Math.min(1, dt * 4);
      c.greet = Math.max(0, c.greet - dt);
      const waving = c.greet > 0 && !this.reduced;
      const w = c.wave;
      w.rotation.x += ((waving ? 0 : -0.7) - w.rotation.x) * Math.min(1, dt * 8);
      w.rotation.z += ((waving ? -2.5 + Math.sin(t * 12) * 0.35 : 0) - w.rotation.z) * Math.min(1, dt * 8);
    }

    const beat = this.music?.pulse() ?? 0;
    // Below the bloom threshold at rest; the kick pushes them over it.
    this.jukeTubes.forEach((m, k) => m.color.copy(m.userData.base).multiplyScalar(0.92 + beat * (0.9 - k * 0.15)));
    if (this.music?.playing && !this.reduced) this.jukeDisc.rotation.z -= dt * 3.5;

    this.zoom += (this.zoomGoal - this.zoom) * (1 - Math.exp(-dt * 2.6));
    this.shake = Math.max(this.hum, this.shake * Math.exp(-dt * 5.5));
  }

  private resize() {
    const w = this.mount.clientWidth || 1;
    const h = this.mount.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Distance that fits a w x h frame on screen, keeping clear of the bottom
  // panel when seated.
  private fitDistance(w: number, h: number) {
    const v = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(v / 2) * this.camera.aspect);
    return Math.max(h / 2 / Math.tan(v / 2), w / 2 / Math.tan(hFov / 2));
  }

  private cameraGoal(): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const st = this.seated;
    if (st?.id === "slots") {
      const x = SLOT_X[st.index];
      const d = this.fitDistance(1.15, 2.4);
      const look = new THREE.Vector3(x, 1.02, SLOT_FRONT);
      const pos = look.clone().add(new THREE.Vector3(0, 0.25, 1).normalize().multiplyScalar(d));
      // Close-up: the reel glass fills the frame above the deck.
      const closeLook = new THREE.Vector3(x, 1.05, SLOT_FRONT);
      const closePos = closeLook.clone().add(new THREE.Vector3(0, 0.12, 1).normalize().multiplyScalar(this.fitDistance(0.95, 1.5)));
      return { pos: pos.lerp(closePos, this.zoom), look: look.lerp(closeLook, this.zoom) };
    }
    if (st?.id === "poker") {
      // Phones frame the felt and let the side seats run off the edges.
      const portrait = this.camera.aspect < 1;
      const d = portrait ? this.fitDistance(3.2, 3.4) : this.fitDistance(5.6, 4.6);
      const look = new THREE.Vector3(TABLE.x, TABLE.top - (portrait ? 0.75 : 0.45), TABLE.z + 0.25);
      const pos = look.clone().add(new THREE.Vector3(0, 1.25, 1).normalize().multiplyScalar(d));
      // Leaning in over the board for the turn and the river.
      const closeLook = new THREE.Vector3(TABLE.x, TABLE.top - (portrait ? 0.35 : 0.2), TABLE.z - 0.05);
      const closePos = closeLook.clone().add(new THREE.Vector3(0, 1.5, 1).normalize().multiplyScalar(d * 0.62));
      return { pos: pos.lerp(closePos, this.zoom), look: look.lerp(closeLook, this.zoom) };
    }
    if (st?.id === "jukebox") {
      const look = new THREE.Vector3(6.3, this.camera.aspect < 1 ? 0.35 : 0.85, -1.8);
      const d = this.fitDistance(1.6, this.camera.aspect < 1 ? 3.8 : 2.6);
      return { pos: look.clone().add(new THREE.Vector3(-1, 0.28, 0.12).normalize().multiplyScalar(d)), look };
    }
    if (st?.id === "cashier") {
      const portrait = this.camera.aspect < 1;
      const look = new THREE.Vector3(-6.1, portrait ? 0.8 : 1.3, 0.6);
      const d = portrait ? this.fitDistance(2.8, 4.0) : this.fitDistance(3.9, 3.6);
      return { pos: look.clone().add(new THREE.Vector3(1, 0.45, 0.25).normalize().multiplyScalar(d)), look };
    }
    // Wide screens see the whole room as one diorama that drifts with Axie;
    // phones follow Axie, with the target kept inside the floor.
    const a = this.axie.position;
    if (this.overview) {
      const wide = this.camera.aspect > 1.1;
      const d = wide ? this.fitDistance(15.4, 10) : this.fitDistance(13.4, 10.5);
      const look = new THREE.Vector3(wide ? -0.6 : -1.0, 0, wide ? -0.2 : 0.1);
      const dir = wide ? new THREE.Vector3(0, 0.72, 0.69) : new THREE.Vector3(0, 0.9, 0.44);
      return { pos: look.clone().add(dir.normalize().multiplyScalar(d)), look };
    }
    if (this.camera.aspect > 1.1) {
      const d = this.fitDistance(13.5, 8.5);
      const look = new THREE.Vector3(a.x * 0.25, 0.4, -0.6 + (a.z + 0.5) * 0.2);
      return { pos: look.clone().add(new THREE.Vector3(0, 0.72, 0.69).normalize().multiplyScalar(d)), look };
    }
    const d = THREE.MathUtils.clamp(this.fitDistance(7.5, 6), 9, 16);
    const look = new THREE.Vector3(THREE.MathUtils.clamp(a.x, -4, 4), 0.5, THREE.MathUtils.clamp(a.z - 1.2, -2.6, 1.4));
    return { pos: look.clone().add(new THREE.Vector3(0, 0.78, 0.63).normalize().multiplyScalar(d)), look };
  }

  private placeFollowCamera(snap: boolean) {
    const g = this.cameraGoal();
    if (snap) {
      this.camera.position.copy(g.pos);
      this.camLook.copy(g.look);
    }
    this.camera.lookAt(this.camLook);
  }

  private startCameraMove() {
    this.camFrom.pos.copy(this.camera.position);
    this.camFrom.look.copy(this.camLook);
    this.camBlend = this.reduced ? 1 : 0;
  }

  private updateCamera(dt: number) {
    const g = this.cameraGoal();
    if (this.camBlend < 1) {
      this.camBlend = Math.min(1, this.camBlend + dt / 0.95);
      const k = easeInOut(this.camBlend);
      this.camera.position.lerpVectors(this.camFrom.pos, g.pos, k);
      this.camLook.lerpVectors(this.camFrom.look, g.look, k);
    } else {
      const a = this.seated ? 1 : 1 - Math.exp(-dt * 4);
      this.camera.position.lerp(g.pos, a);
      this.camLook.lerp(g.look, a);
    }
    this.camera.lookAt(this.camLook);
    if (this.shake > 0.0004) {
      const t = this.clock.elapsedTime;
      const s = this.shake;
      this.camera.position.x += Math.sin(t * 53.1) * s * 0.6;
      this.camera.position.y += Math.sin(t * 61.7 + 1.3) * s * 0.45;
      this.camera.rotation.z += Math.sin(t * 47.3 + 2.1) * s * 0.35;
    }
  }

  private blocked(x: number, z: number) {
    if (x < BOUNDS.minX || x > BOUNDS.maxX || z < BOUNDS.minZ || z > BOUNDS.maxZ) return true;
    for (const o of this.obstacles) {
      if ("rx" in o) {
        const dx = (x - o.x) / (o.rx + AXIE_RADIUS);
        const dz = (z - o.z) / (o.rz + AXIE_RADIUS);
        if (dx * dx + dz * dz < 1) return true;
      } else if (x > o.minX - AXIE_RADIUS && x < o.maxX + AXIE_RADIUS && z > o.minZ - AXIE_RADIUS && z < o.maxZ + AXIE_RADIUS) return true;
    }
    return false;
  }

  private updateAxie(dt: number) {
    if (this.seated) {
      this.walking = 0;
    } else {
      const dir = new THREE.Vector2(this.input.x, this.input.y);
      if (this.keys.has("left")) dir.x -= 1;
      if (this.keys.has("right")) dir.x += 1;
      if (this.keys.has("up")) dir.y += 1;
      if (this.keys.has("down")) dir.y -= 1;
      let mx = dir.x;
      let mz = -dir.y;
      if (this.walkTarget && !dir.lengthSq()) {
        const dx = this.walkTarget.x - this.axie.position.x;
        const dz = this.walkTarget.z - this.axie.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.08) this.walkTarget = null;
        else [mx, mz] = [dx / Math.max(dist, 0.6), dz / Math.max(dist, 0.6)];
      }
      const len = Math.hypot(mx, mz);
      if (len > 0.05) {
        const k = Math.min(1, len);
        const vx = (mx / len) * k * SPEED * dt;
        const vz = (mz / len) * k * SPEED * dt;
        const p = this.axie.position;
        if (!this.blocked(p.x + vx, p.z + vz)) p.set(p.x + vx, 0, p.z + vz);
        else if (!this.blocked(p.x + vx, p.z)) p.x += vx;
        else if (!this.blocked(p.x, p.z + vz)) p.z += vz;
        else this.walkTarget = null;
        this.heading = Math.atan2(mx, mz);
        this.walking = Math.min(1, this.walking + dt * 6);
      } else this.walking = Math.max(0, this.walking - dt * 6);
    }

    const r = this.axie.rotation;
    let diff = this.heading - r.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    r.y += diff * Math.min(1, dt * 10);
    // The walk clip blends in with speed and plays at a stride that matches it.
    if (this.walkAction) {
      this.walkAction.setEffectiveWeight(this.walking);
      this.walkAction.timeScale = 0.4 + 1.1 * this.walking;
    }
    const model = this.model;
    if (model) {
      const t = this.clock.elapsedTime;
      const base = this.modelBase;
      let y = base.y;
      let spin = 0;
      let squash = 1 + (this.reduced ? 0 : Math.sin(t * 2.4) * 0.012 * (1 - this.walking));
      if (this.reactKind) {
        this.reactT += dt;
        const dur = this.reactKind === "big" ? 1.5 : this.reactKind === "win" ? 0.8 : 1.2;
        const k = Math.min(1, this.reactT / dur);
        if (this.reactKind === "lose") squash *= 1 - Math.sin(k * Math.PI) * 0.12;
        else {
          const hops = this.reactKind === "big" ? 2 : 1;
          y += Math.abs(Math.sin(k * Math.PI * hops)) * 0.32;
          if (this.reactKind === "big") spin = ease(k) * Math.PI * 2;
        }
        if (k >= 1) this.reactKind = null;
      }
      model.position.y = y;
      model.rotation.y = spin;
      model.scale.set(base.scale / Math.sqrt(squash), base.scale * squash, base.scale / Math.sqrt(squash));
    }

    if (!this.seated) {
      let best: Station | null = null;
      let bestD = Infinity;
      for (const s of this.stations) {
        const d = s.stand.distanceTo(this.axie.position.clone().setY(0));
        const reach = s.id === "poker" ? 1.5 : 1.2;
        if (d < reach && d < bestD) [best, bestD] = [s, d];
      }
      if (best !== this.near) {
        this.near = best;
        this.cb.onNear(best);
      }
    }
  }

  private updateLabels() {
    if (!this.labelEls.length) return;
    const w = this.mount.clientWidth;
    const h = this.mount.clientHeight;
    const spots = this.seatSpots();
    this.labelEls.forEach((el, i) => {
      if (!el) return;
      // 0: your bet, 1-3: above each bot's head, 4: the pot.
      const p =
        i === 4 ? new THREE.Vector3(0.88, TABLE.top + 0.22, -0.12)
        : i === 0 ? spots[0].clone().multiplyScalar(0.36).setY(TABLE.top + 0.12)
        : spots[i].clone().setY(1.9);
      p.add(this.table.position).project(this.camera);
      const visible = this.seated?.id === "poker" && p.z < 1;
      el.style.opacity = visible ? "1" : "0";
      // Keep tags on screen when a side seat runs off the edge.
      const half = el.offsetWidth / 2 + 8;
      const x = THREE.MathUtils.clamp(((p.x + 1) / 2) * w, half, w - half);
      const y = Math.max(((1 - p.y) / 2) * h, el.offsetHeight + 72); // stay below the top bar
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    });
  }

  private tick = () => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    // Tweens started from a done() callback land in the fresh list, so chained
    // moments (hold, then flip) are not dropped.
    const active = this.tweens;
    this.tweens = [];
    const running = active.filter((tw) => {
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.step(k);
      if (k >= 1) tw.done?.();
      return k < 1;
    });
    this.tweens = running.concat(this.tweens);
    this.updateAxie(dt);
    this.updateCamera(dt);
    for (const m of this.mixers) m.update(dt);
    this.updateEffects(dt);
    this.updateLabels();
    this.composer.render();
  };

  // ── Input ───────────────────────────────────────────────────────────────
  private down: { x: number; y: number } | null = null;
  private onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
  };
  private onPointerUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || this.seated || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(this.hitTargets, false)[0];
    if (hit) {
      const code = hit.object.userData.station as number;
      const id = code === 100 ? "poker" : code === 200 ? "cashier" : code === 300 ? "jukebox" : "slots";
      const st = this.stations.find((s) => s.id === id && (id !== "slots" || s.index === code));
      if (st) {
        this.walkTarget = st.stand.clone();
        this.overview = false;
      }
      return;
    }
    const f = ray.intersectObject(this.floor, false)[0];
    if (f) this.walkTarget = new THREE.Vector3(f.point.x, 0, f.point.z);
    if (this.walkTarget) this.overview = false;
  };

  private static KEYS: Record<string, string> = {
    KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
  };
  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    const k = CasinoWorld.KEYS[e.code];
    if (!k || this.seated) return;
    this.keys.add(k);
    this.walkTarget = null;
    this.overview = false;
    if (e.code.startsWith("Arrow")) e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    const k = CasinoWorld.KEYS[e.code];
    if (k) this.keys.delete(k);
  };
  private onBlur = () => this.keys.clear();
}
