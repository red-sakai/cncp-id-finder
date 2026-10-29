"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import QRCode from "qrcode";
import WireZipGame from "@/components/wirezip-game";
import { useBadgeDefinitions } from "@/lib/badge-definitions";

let cachedGltf: GLTF | null = null;

function loadModel(): Promise<GLTF> {
  if (cachedGltf) return Promise.resolve(cachedGltf);
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      "/ipad_model.glb",
      (gltf) => {
        cachedGltf = gltf;
        resolve(gltf);
      },
      undefined,
      reject
    );
  });
}

const RISE_DUR = 1.1;
const ZOOM_DELAY = 1.15;
const ZOOM_DUR = 0.9;
const TOTAL = ZOOM_DELAY + ZOOM_DUR;
const CLOSE_DUR = 1.8;

type Phase = "anim" | "logo" | "peek" | "walk" | "talk" | "home";

const SHOP_PAGE_SIZE = 4;

type ShopItem = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
};

function CoinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9.25" fill="#ffca28" stroke="#b47f00" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="6" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.1" />
      <path
        d="M14.6 9a4.1 4.1 0 1 0 0 6"
        fill="none"
        stroke="#6a4b00"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

type Wallet = {
  first_name: string;
  last_name: string;
  email: string;
  ciscoins: number | null;
  // Kept in memory only: every purchase has to prove the number again.
  phone: string;
};

type PurchaseState = {
  item: ShopItem;
  phase: "confirm" | "paying" | "success" | "error";
  balance: number | null;
  shortBy: number;
  error: string | null;
  requestId: string;
  duplicate: boolean;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const DIALOGUE_LINES = [
  "Welcome to iCisco! I'm Axie, your guide!",
  "This is the iCisco iPad \u2014 your gateway to everything Cisco NetConnect!",
  "Tap ID Finder and enter your email to look up your CNCP member info. There's also Games for fun!",
  "Tap anywhere or press Escape to leave anytime. Ready to explore?",
];

export default function IciscoScene({ onDismiss }: { onDismiss: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; });
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("anim");
  const [closing, setClosing] = useState(false);
  const [dialogueStep, setDialogueStep] = useState(0);
  const [bubbleText, setBubbleText] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  // ID Finder app state
  const [activeApp, setActiveApp] = useState<
    null | "id-finder" | "games" | "shop"
  >(null);
  const [idFinderPhase, setIdFinderPhase] = useState<
    "prompt" | "found" | "not-found"
  >("prompt");
  const [emailInput, setEmailInput] = useState("");
  const [lookupResult, setLookupResult] = useState<{
    first_name: string;
    last_name: string;
    email: string;
    course_year_section: string;
    membership_type: string;
    badges: { badge_id: string; awarded_at: string; awarded_by?: string }[];
    ciscoins: number | null;
    card_style: string;
    is_public: boolean;
  } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [cardFlipped, setCardFlipped] = useState(false);
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [earnedBadges, setEarnedBadges] = useState<Set<string>>(new Set());
  const [badgeMeta, setBadgeMeta] = useState<Record<string, { awarded_by?: string; awarded_at?: string }>>({});
  const [showCongrats, setShowCongrats] = useState(false);
  const [awardError, setAwardError] = useState(false);
  const [awardErrorMsg, setAwardErrorMsg] = useState<string | null>(null);
  const [awardedCiscoins, setAwardedCiscoins] = useState(0);
  const [congratsBadge, setCongratsBadge] = useState<string>("welcome-to-cisco");
  const [selectedBadge, setSelectedBadge] = useState<string | null>(null);
  const [zoomedBadgeImg, setZoomedBadgeImg] = useState<{ src: string; alt: string } | null>(null);
  const [zoomedQrImg, setZoomedQrImg] = useState<string | null>(null);
  const [publicIds, setPublicIds] = useState<{
    first_name: string;
    last_name: string;
    email: string;
    course_year_section: string;
    membership_type: string;
    card_style: string;
    badges: string[];
  }[]>([]);
  const [publicIdsLoading, setPublicIdsLoading] = useState(false);
  const [viewingPublicId, setViewingPublicId] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [publicToggleLoading, setPublicToggleLoading] = useState(false);
  const [publicToggleError, setPublicToggleError] = useState<string | null>(null);
  const [savedSignatureUrl, setSavedSignatureUrl] = useState<string | null>(null);
  // The congrats card waits for badgeDefsReady so it never flashes a guessed
  // badge name while the definitions are still loading.
  const { ready: badgeDefsReady, badgeFor } = useBadgeDefinitions();

  // Shop app state: the wallet stays locked until the email AND the phone
  // number on file both match, so a borrowed email can't spend anyone's coins.
  const [shopItems, setShopItems] = useState<ShopItem[]>([]);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopError, setShopError] = useState<string | null>(null);
  const [shopPage, setShopPage] = useState(0);
  const [purchase, setPurchase] = useState<PurchaseState | null>(null);
  const [purchaseClosing, setPurchaseClosing] = useState(false);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [walletEmail, setWalletEmail] = useState("");
  const [walletPhone, setWalletPhone] = useState("");
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  // Guest cards send people back to the sign-in slip, so the email field is
  // the target rather than a second copy of the form.
  const shopEmailRef = useRef<HTMLInputElement>(null);
  const purchaseReturnFocusRef = useRef<HTMLElement | null>(null);
  const purchasePrimaryRef = useRef<HTMLButtonElement>(null);
  const purchaseDialogRef = useRef<HTMLDivElement>(null);
  const purchaseExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const clearPurchaseExit = useCallback(() => {
    if (purchaseExitTimerRef.current !== null) {
      clearTimeout(purchaseExitTimerRef.current);
      purchaseExitTimerRef.current = null;
    }
    setPurchaseClosing(false);
  }, []);

  useEffect(
    () => () => {
      if (purchaseExitTimerRef.current !== null) {
        clearTimeout(purchaseExitTimerRef.current);
      }
    },
    []
  );

  const loadShop = useCallback(() => {
    setShopLoading(true);
    setShopError(null);
    fetch("/api/shop")
      .then((r) => {
        if (!r.ok) throw new Error("Request failed");
        return r.json();
      })
      .then((d) => setShopItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => {
        setShopItems([]);
        setShopError("Check the connection, then try again.");
      })
      .finally(() => setShopLoading(false));
  }, []);

  const openShop = useCallback(() => {
    clearPurchaseExit();
    setActiveApp("shop");
    setPurchase(null);
    setShopPage(0);
    loadShop();
  }, [clearPurchaseExit, loadShop]);

  // The tablet is shared, so leaving the shop locks the wallet behind it.
  const lockWallet = useCallback(() => {
    clearPurchaseExit();
    setWallet(null);
    setWalletError(null);
    setWalletPhone("");
    setPurchase(null);
  }, [clearPurchaseExit]);

  const openWallet = useCallback(async () => {
    const email = walletEmail.trim();
    const phone = walletPhone.trim();
    if (!email || !/^09\d{9}$/.test(phone)) {
      setWalletError(
        "Enter the email address and an 11-digit phone number starting with 09."
      );
      return;
    }
    setWalletLoading(true);
    setWalletError(null);
    try {
      const res = await fetch("/api/shop/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, phone }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        setWallet({ ...(body.member as Omit<Wallet, "phone">), phone });
        setWalletEmail("");
        setWalletPhone("");
        clearPurchaseExit();
        setPurchase(null);
      } else {
        setWalletError(
          typeof body.error === "string" && body.error
            ? body.error
            : "Could not open the wallet. Please try again."
        );
      }
    } catch {
      setWalletError("Network error. Please try again.");
    } finally {
      setWalletLoading(false);
    }
  }, [walletEmail, walletPhone, clearPurchaseExit]);

  const closePurchase = useCallback(() => {
    if (!purchase || purchase.phase === "paying" || purchaseClosing) return;
    setPurchaseClosing(true);
    purchaseExitTimerRef.current = setTimeout(() => {
      purchaseExitTimerRef.current = null;
      setPurchase(null);
      setPurchaseClosing(false);
    }, 190);
  }, [purchase, purchaseClosing]);

  useEffect(() => {
    if (!purchase) {
      const trigger = purchaseReturnFocusRef.current;
      purchaseReturnFocusRef.current = null;
      trigger?.focus();
      return;
    }
    const timer = setTimeout(() => {
      if (purchase.phase === "paying") {
        purchaseDialogRef.current?.focus();
        return;
      }
      purchasePrimaryRef.current?.focus();
    }, 30);
    return () => clearTimeout(timer);
  }, [purchase]);

  useEffect(() => {
    if (!purchase) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closePurchase();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = purchaseDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [purchase, closePurchase]);

  const startPurchase = useCallback(
    (item: ShopItem, trigger: HTMLElement | null) => {
      if (!wallet) return;
      clearPurchaseExit();
      purchaseReturnFocusRef.current = trigger;
      const balance =
        typeof wallet.ciscoins === "number" ? wallet.ciscoins : null;
      const shortBy =
        balance !== null ? Math.max(item.price - balance, 0) : 0;
      setPurchase({
        item,
        phase: shortBy > 0 ? "error" : "confirm",
        balance,
        shortBy,
        error:
          shortBy > 0
            ? `Not enough Ciscoins. You need ${shortBy.toLocaleString(
                "en-US"
              )} more.`
            : null,
        requestId: crypto.randomUUID(),
        duplicate: false,
      });
    },
    [wallet, clearPurchaseExit]
  );

  const runPurchase = useCallback(
    async (current: PurchaseState, walletSnapshot: Wallet) => {
      setPurchase({ ...current, phase: "paying", error: null });
      const startedAt = Date.now();
      try {
        const res = await fetch("/api/shop/purchase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: walletSnapshot.email,
            phone: walletSnapshot.phone,
            itemId: current.item.id,
            requestId: current.requestId,
          }),
        });
        const body = await res.json().catch(() => ({}));
        const remaining = 900 - (Date.now() - startedAt);
        if (remaining > 0) await wait(remaining);

        if (res.ok && body.ok) {
          const balance =
            typeof body.balance === "number"
              ? body.balance
              : Math.max((current.balance ?? 0) - current.item.price, 0);
          setWallet((prev) => (prev ? { ...prev, ciscoins: balance } : prev));
          setPurchase({
            ...current,
            phase: "success",
            balance,
            shortBy: 0,
            error: null,
            duplicate: body.duplicate === true,
          });
          return;
        }

        const balance =
          typeof body.balance === "number" ? body.balance : current.balance;
        if (typeof body.balance === "number") {
          setWallet((prev) =>
            prev ? { ...prev, ciscoins: body.balance } : prev
          );
        }
        const shortBy =
          balance !== null
            ? Math.max(current.item.price - balance, 0)
            : 0;
        setPurchase({
          ...current,
          phase: "error",
          balance,
          shortBy,
          error:
            typeof body.error === "string" && body.error
              ? body.error
              : "Purchase could not be completed. Please try again.",
        });
      } catch {
        const remaining = 900 - (Date.now() - startedAt);
        if (remaining > 0) await wait(remaining);
        setPurchase({
          ...current,
          phase: "error",
          error: "Network error. Please try again.",
        });
      }
    },
    []
  );

  const confirmPurchase = useCallback(() => {
    if (!purchase || purchase.phase !== "confirm" || !wallet) return;
    void runPurchase(purchase, wallet);
  }, [purchase, wallet, runPurchase]);

  const retryPurchase = useCallback(() => {
    if (
      !purchase ||
      purchase.phase !== "error" ||
      !wallet ||
      purchase.shortBy > 0
    ) {
      return;
    }
    void runPurchase(purchase, wallet);
  }, [purchase, wallet, runPurchase]);

  const handleLookup = useCallback(async () => {
    const email = emailInput.trim();
    if (!email) return;
    setLookupLoading(true);
    setLookupError(null);
    setPublicToggleError(null);
    setLookupResult(null);
    setIdFinderPhase("prompt");
    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setIdFinderPhase("not-found");
        setLookupError(
          res.status === 404
            ? "No account found with that email."
            : body.error || "Something went wrong."
        );
      } else {
        const data = await res.json();
        setLookupResult(data);
        setIdFinderPhase("found");
        const badges = new Set<string>(
          (data.badges ?? []).map((b: { badge_id: string }) => b.badge_id)
        );
        setEarnedBadges(badges);
        const meta: Record<string, { awarded_by?: string }> = {};
        (data.badges ?? []).forEach((b: { badge_id: string; awarded_by?: string }) => {
          if (b.awarded_by) meta[b.badge_id] = { awarded_by: b.awarded_by };
        });
        setBadgeMeta(meta);
        setIsPublic(data.is_public ?? false);
        loadSavedSignature(data.email);
        QRCode.toDataURL(
          `https://cncp-id-finder.vercel.app/scan`,
          {
            width: 80,
            margin: 1,
            color: { dark: "#1a2a3a", light: "#ffffff" },
          }
        ).then(setQrDataUrl);
        setPublicIdsLoading(true);
        fetch("/api/public-ids")
          .then((r) => r.json())
          .then((d) => setPublicIds(d.ids ?? []))
          .finally(() => setPublicIdsLoading(false));
      }
    } catch {
      setLookupError("Network error. Please try again.");
      setIdFinderPhase("not-found");
    } finally {
      setLookupLoading(false);
    }
  }, [emailInput]);

  // Signature pad functions
  const getSigPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setIsDrawing(true);
    const ctx = sigCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getSigPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    if (!isDrawing) return;
    const ctx = sigCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getSigPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#1a2a3a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  };

  const endDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setIsDrawing(false);
  };

  const clearSig = async () => {
    const ctx = sigCanvasRef.current?.getContext("2d");
    if (!ctx || !sigCanvasRef.current) return;
    ctx.clearRect(0, 0, sigCanvasRef.current.width, sigCanvasRef.current.height);
    setSavedSignatureUrl(null);
    if (lookupResult?.email) {
      try {
        await fetch(`/api/signature?email=${encodeURIComponent(lookupResult.email)}`, { method: "DELETE" });
      } catch {
        // ignore
      }
    }
  };

  const [sigSaving, setSigSaving] = useState(false);

  const saveSignature = async () => {
    const canvas = sigCanvasRef.current;
    if (!canvas || !lookupResult?.email) return;
    setSigSaving(true);
    try {
      const imageData = canvas.toDataURL("image/png");
      const res = await fetch("/api/signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: lookupResult.email, imageData }),
      });
      if (res.ok) {
        const { signatureUrl } = await res.json();
        setSavedSignatureUrl(signatureUrl);
      }
    } catch {
      // ignore
    } finally {
      setSigSaving(false);
    }
  };

  const loadSavedSignature = async (email: string) => {
    try {
      const res = await fetch(`/api/signature?email=${encodeURIComponent(email)}`);
      if (res.ok) {
        const { signatureUrl } = await res.json();
        if (signatureUrl) {
          setSavedSignatureUrl(signatureUrl);
          const canvas = sigCanvasRef.current;
          if (canvas) {
            const ctx = canvas.getContext("2d");
            if (ctx) {
              const img = new window.Image();
              img.onload = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              };
              img.src = signatureUrl;
            }
          }
        }
      }
    } catch {
      // ignore
    }
  };

  // Use a ref so the Three.js loop can read it without re-running effects
  const closingRef = useRef(false);

  const startClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
  }, []);

  const typeText = useCallback((text: string, onDone: () => void) => {
    setIsTyping(true);
    setBubbleText("");
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setBubbleText(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(interval);
        setIsTyping(false);
        onDone();
      }
    }, 18);
    return () => clearInterval(interval);
  }, []);

  const advanceDialogue = useCallback(() => {
    setTimeout(() => {
      const nextStep = dialogueStep + 1;
      if (nextStep >= DIALOGUE_LINES.length) {
        setPhase("home");
        return;
      }
      setDialogueStep(nextStep);
    }, 200);
  }, [dialogueStep]);

  // Typewriter for current dialogue line
  useEffect(() => {
    if (phase !== "talk") return;
    const line = DIALOGUE_LINES[dialogueStep];
    if (!line) return;

    const timer = setTimeout(() => {
      typeText(line, () => {});
    }, 300);

    return () => clearTimeout(timer);
  }, [phase, dialogueStep, typeText]);

  // Logo shows for 2.5s, then axolotl peeks
  useEffect(() => {
    if (phase !== "logo") return;
    const timer = setTimeout(() => setPhase("peek"), 2500);
    return () => clearTimeout(timer);
  }, [phase]);

  // Peek shows for 2.5s, then walk
  useEffect(() => {
    if (phase !== "peek") return;
    const timer = setTimeout(() => setPhase("walk"), 2800);
    return () => clearTimeout(timer);
  }, [phase]);

  // Walk phase lasts 2.4s then transition to talk
  useEffect(() => {
    if (phase !== "walk") return;
    const timer = setTimeout(() => setPhase("talk"), 2400);
    return () => clearTimeout(timer);
  }, [phase]);

  // After closing starts, call onDismiss once animation finishes
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => {
      onDismissRef.current();
    }, CLOSE_DUR * 1000 + 200);
    return () => clearTimeout(timer);
  }, [closing]);

  // Main Three.js scene
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let raf = 0;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      40,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    camera.position.set(0, 0, 8);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4a6a, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(4, 6, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9adfff, 1.4);
    rim.position.set(-5, 2, -4);
    scene.add(rim);

    const outer = new THREE.Group();
    const orient = new THREE.Group();
    const inner = new THREE.Group();
    orient.add(inner);
    outer.add(orient);
    scene.add(outer);

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onResize);

    loadModel()
      .then((gltf) => {
        if (disposed) return;

        const model = gltf.scene.clone(true);

        model.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh && mesh.name === "Object_4") {
            mesh.visible = false;
          }
        });

        const tex = new THREE.TextureLoader().load("/gray_logo_transparent.png");
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.repeat.set(0.338, -0.196);
        tex.offset.set(0.331, 0.598);

        const decal = new THREE.Mesh(
          new THREE.PlaneGeometry(2.4, 1.39),
          new THREE.MeshStandardMaterial({
            map: tex,
            transparent: true,
            alphaTest: 0.05,
            depthWrite: false,
            roughness: 0.4,
            metalness: 0.1,
            emissive: new THREE.Color(0x1a5276),
            emissiveIntensity: 0.35,
          })
        );
        decal.rotation.x = -Math.PI / 2;
        decal.rotation.z = Math.PI / 2;
        decal.renderOrder = 2;
        decal.position.set(0.029, 1.956, 0.052);
        model.add(decal);

        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const s = 5.5 / Math.max(size.x, size.y, size.z);
        model.scale.setScalar(s);
        model.position.sub(center.multiplyScalar(s));
        inner.add(model);

        inner.rotation.x = Math.PI / 2;
        orient.rotation.z = Math.PI / 2;
        outer.position.y = -7.5;
        setReady(true);

        // --- Opening animation ---
        const openStart = performance.now();
        const openTick = () => {
          if (disposed || closingRef.current) return;
          const elapsed = (performance.now() - openStart) / 1000;

          const riseP = Math.min(1, elapsed / RISE_DUR);
          const riseE = 1 - Math.pow(1 - riseP, 3);
          outer.position.y = -7.5 + 7.5 * riseE;
          outer.rotation.y = Math.PI * 4 * riseE;

          const zoomP = Math.min(1, Math.max(0, (elapsed - ZOOM_DELAY) / ZOOM_DUR));
          const zoomE = Math.pow(zoomP, 2.2);
          outer.scale.setScalar(1 + 1.3 * zoomE);
          outer.position.z = 2.6 * zoomE;
          inner.rotation.x = Math.PI / 2 + Math.PI * zoomE;

          if (shadeRef.current) {
            const shadeP = Math.min(
              1,
              Math.max(0, (elapsed - (TOTAL - 0.35)) / 0.35)
            );
            shadeRef.current.style.opacity = String(shadeP);
          }

          if (elapsed >= TOTAL) {
            setPhase((p) => (p === "anim" ? "logo" : p));
          }

          renderer.render(scene, camera);
          if (elapsed < TOTAL + 0.1) {
            raf = requestAnimationFrame(openTick);
          }
        };
        raf = requestAnimationFrame(openTick);

        // --- Closing animation ---
        const closeCheck = setInterval(() => {
          if (closingRef.current && !disposed) {
            clearInterval(closeCheck);
            const closeStart = performance.now();
            const closeTick = () => {
              if (disposed) return;
              const closeElapsed = (performance.now() - closeStart) / 1000;
              const closeP = Math.min(1, closeElapsed / CLOSE_DUR);

              // Fall backward like a domino, then drop down
              const fallP = closeP * closeP;
              inner.rotation.x = Math.PI * 1.5 + Math.PI * 0.55 * fallP;
              outer.position.y = -10 * fallP;

              // Fade shade out
              if (shadeRef.current) {
                shadeRef.current.style.opacity = String(
                  Math.max(0, 1 - closeP * 1.2)
                );
              }

              renderer.render(scene, camera);
              if (closeP < 1) {
                raf = requestAnimationFrame(closeTick);
              }
            };
            raf = requestAnimationFrame(closeTick);
          }
        }, 16);

        return () => clearInterval(closeCheck);
      })
      .catch(() => {
        if (!disposed) onDismissRef.current();
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    if (phase === "anim" || closing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") startClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, closing, startClose]);

  const searchParams = useSearchParams();
  const awardedRef = useRef<string | null>(null);

  useEffect(() => {
    const awarded = searchParams.get("awarded");
    const email = searchParams.get("email");
    const by = searchParams.get("by");
    if (awarded && email && awardedRef.current !== awarded) {
      awardedRef.current = awarded;
      const scanToken = sessionStorage.getItem("cncp-scan-token");
      sessionStorage.removeItem("cncp-scan-token");
      setActiveApp("id-finder");
      setEmailInput(email);
      const doAward = async () => {
        let validBy: string | undefined;
        if (by) {
          try {
            const awarderRes = await fetch(`/api/awarders?name=${encodeURIComponent(by)}`);
            if (awarderRes.ok) {
              const awarderData = await awarderRes.json();
              if (awarderData.valid) validBy = by;
            }
          } catch {
            // ignore validation errors, treat as invalid
          }
        }
        const res = await fetch("/api/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (res.ok) {
          const data = await res.json();
          setLookupResult(data);
          setIdFinderPhase("found");
          const badges = new Set<string>(
            (data.badges ?? []).map((b: { badge_id: string }) => b.badge_id)
          );
          setEarnedBadges(badges);
          const meta: Record<string, { awarded_by?: string }> = {};
          (data.badges ?? []).forEach((b: { badge_id: string; awarded_by?: string }) => {
            if (b.awarded_by) meta[b.badge_id] = { awarded_by: b.awarded_by };
          });
          if (validBy && awarded) {
            meta[awarded] = { awarded_by: validBy };
          }
          setBadgeMeta(meta);
          QRCode.toDataURL(
            `https://cncp-id-finder.vercel.app/scan`,
            {
              width: 80,
              margin: 1,
              color: { dark: "#1a2a3a", light: "#ffffff" },
            }
          ).then(setQrDataUrl);
          if (!badges.has(awarded)) {
            const awardRes = await fetch("/api/badges", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email,
                badgeId: awarded,
                awardedBy: validBy,
                token: scanToken,
              }),
            });
            if (awardRes.ok) {
              const awardBody = await awardRes.json().catch(() => ({}));
              const credited =
                typeof awardBody.ciscoins === "number" ? awardBody.ciscoins : 0;
              setAwardedCiscoins(credited);
              if (credited > 0) {
                setLookupResult((prev) =>
                  prev
                    ? { ...prev, ciscoins: (prev.ciscoins ?? 0) + credited }
                    : prev
                );
              }
              setEarnedBadges((prev) => new Set([...prev, awarded]));
              setCongratsBadge(awarded);
              setShowCongrats(true);
              setTimeout(() => setShowCongrats(false), 4000);
            } else {
              const awardBody = await awardRes.json().catch(() => ({}));
              setAwardErrorMsg(
                typeof awardBody.error === "string" && awardBody.error ? awardBody.error : null
              );
              setAwardError(true);
              setTimeout(() => setAwardError(false), 6000);
            }
          }
        }
      };
      doAward();
      window.history.replaceState({}, "", "/");
    }
  }, [searchParams]);

  const showAxolotl = phase === "peek" || phase === "walk" || phase === "talk";
  const isPeek = phase === "peek";
  const isWalk = phase === "walk";
  const isTalk = phase === "talk";

  const axolotlSrc = isPeek
    ? "/rebranding/stickers/axie-thinking-sticker.png"
    : isWalk
      ? "/rebranding/stickers/axie-flying-sticker.png"
      : "/rebranding/stickers/axie-flying-sticker1.png";

  const purchaseImage =
    purchase?.item.image_url?.startsWith("/") === true
      ? purchase.item.image_url
      : null;
  const purchaseCanRetry =
    purchase?.phase === "error" &&
    purchase.shortBy === 0 &&
    !/no longer available|does not exist/i.test(purchase.error ?? "");

  useEffect(() => {
    if (activeApp) {
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    } else {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    }
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    };
  }, [activeApp]);

  const shopPageCount = Math.max(
    1,
    Math.ceil(shopItems.length / SHOP_PAGE_SIZE)
  );
  const currentShopPage = Math.min(shopPage, shopPageCount - 1);
  const shopPageItems = shopItems.slice(
    currentShopPage * SHOP_PAGE_SIZE,
    currentShopPage * SHOP_PAGE_SIZE + SHOP_PAGE_SIZE
  );
  const shopPageStart =
    shopItems.length === 0
      ? 0
      : currentShopPage * SHOP_PAGE_SIZE + 1;
  const shopPageEnd = Math.min(
    shopItems.length,
    (currentShopPage + 1) * SHOP_PAGE_SIZE
  );

  return (
    <div
      className={`icisco-overlay${closing ? " is-closing" : ""}`}
      role="presentation"
      data-lenis-prevent
    >
      <div ref={mountRef} className="icisco-canvas" />
      <div ref={shadeRef} className="icisco-shade" />

      {!closing && !activeApp && (
        <button
          type="button"
          className="icisco-close-btn"
          onClick={startClose}
          aria-label="Close iCisco"
        >
          &times;
        </button>
      )}

      {!ready && phase === "anim" && (
        <div className="icisco-loading">Loading iCisco…</div>
      )}

      {phase !== "home" && !closing && (
        <button
          type="button"
          className="icisco-skip-btn"
          onClick={() => setPhase("home")}
        >
          Skip &#9654;
        </button>
      )}

      {(phase === "logo" || showAxolotl) && !closing && (
        <div className="icisco-logo-wrap">
          <Image
            src="/rebranding/logos/cncp-purple-logo.png"
            alt="CNCP"
            width={330}
            height={231}
            priority
            draggable={false}
            className="icisco-logo-img"
          />
        </div>
      )}

      {isPeek && !closing && (
        <div className="icisco-peek-bubble">
          <p className="icisco-peek-text">Huh? You&apos;re new around here.</p>
        </div>
      )}

      {showAxolotl && !closing && (
        <div
          className={[
            "icisco-axolotl",
            isPeek ? "peeking" : "",
            isWalk ? "walking" : "",
            isTalk ? "arrived" : "",
          ].join(" ")}
        >
          <Image
            src={axolotlSrc}
            alt="Axie the Axolotl"
            width={160}
            height={160}
            priority
            draggable={false}
            className="icisco-axolotl-img"
          />
        </div>
      )}

      {isTalk && !closing && (
        <div className="icisco-bubble">
          <p className="icisco-bubble-text">
            {bubbleText}
            {isTyping && <span className="icisco-cursor">|</span>}
          </p>
          {!isTyping && (
            <button
              type="button"
              className="icisco-bubble-advance"
              onClick={advanceDialogue}
              aria-label="Continue"
            >
              {dialogueStep < DIALOGUE_LINES.length - 1 ? "\u25B6" : "\u2713"}
            </button>
          )}
        </div>
      )}

      {phase === "home" && !closing && !activeApp && (
        <div className="icisco-home">
          <Image
            src="/rebranding/logos/cncp-purple-logo.png"
            alt="CNCP"
            width={140}
            height={98}
            className="icisco-home-logo"
          />
          <div className="icisco-apps">
            <button
              type="button"
              className="icisco-app"
              onClick={() => {
                setActiveApp("id-finder");
                if (publicIds.length === 0 && !publicIdsLoading) {
                  setPublicIdsLoading(true);
                  fetch("/api/public-ids")
                    .then((r) => r.json())
                    .then((d) => { setPublicIds(d.ids ?? []); setPublicIdsLoading(false); })
                    .catch(() => setPublicIdsLoading(false));
                }
              }}
            >
              <span className="icisco-app-icon">
                <Image
                  src="/id-finder-icon.png"
                  alt="ID Finder"
                  width={108}
                  height={108}
                  className="icisco-app-img"
                />
              </span>
              <span className="icisco-app-label">ID Finder</span>
            </button>
            <button
              type="button"
              className="icisco-app"
              onClick={() => setActiveApp("games")}
            >
              <span className="icisco-app-icon">
                <Image
                  src="/games-app-icon.jpg"
                  alt="Games"
                  width={108}
                  height={108}
                  className="icisco-app-img"
                />
              </span>
              <span className="icisco-app-label">Games</span>
            </button>
            <button
              type="button"
              className="icisco-app"
              onClick={openShop}
            >
              <span className="icisco-app-icon icisco-app-tile" aria-hidden="true">
                <span className="icisco-app-glyph">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4.5 8h15l-1.1 10.1a2 2 0 0 1-2 1.9H7.6a2 2 0 0 1-2-1.9L4.5 8Z" />
                    <path d="M8.6 10V6.7a3.4 3.4 0 0 1 6.8 0V10" />
                  </svg>
                </span>
              </span>
              <span className="icisco-app-label">Shop</span>
            </button>
          </div>
          <Image src="/rebranding/stickers/axie-flying-sticker.png" alt="" width={100} height={88} className="icisco-sticker" draggable={false} style={{ top: "8%", right: "6%", opacity: 0.8, transform: "rotate(-10deg)", animation: "stickerFloat1 4s ease-in-out infinite" }} />
          <Image src="/rebranding/stickers/axie-sleeping-sticker.png" alt="" width={110} height={96} className="icisco-sticker" draggable={false} style={{ bottom: "15%", left: "4%", opacity: 0.75, transform: "rotate(5deg)", animation: "stickerFloat2 3.5s ease-in-out infinite 0.3s" }} />
          <Image src="/rebranding/stickers/axie-thinking-sticker.png" alt="" width={92} height={80} className="icisco-sticker" draggable={false} style={{ bottom: "10%", right: "8%", opacity: 0.8, transform: "rotate(-5deg)", animation: "stickerFloat3 4.5s ease-in-out infinite 0.5s" }} />
          <Image src="/rebranding/stickers/axie-tired-sticker.png" alt="" width={86} height={75} className="icisco-sticker" draggable={false} style={{ top: "18%", left: "5%", opacity: 0.8, transform: "rotate(8deg)", animation: "stickerFloat2 5s ease-in-out infinite 1s" }} />
          <Image src="/rebranding/stickers/axie-flying-sticker1.png" alt="" width={50} height={44} className="icisco-sticker" draggable={false} style={{ bottom: "32%", left: "18%", opacity: 0.45, transform: "rotate(15deg)", animation: "stickerFloat3 5.5s ease-in-out infinite 0.7s" }} />
          <Image src="/rebranding/stickers/axie-sleeping-sticker1.png" alt="" width={62} height={54} className="icisco-sticker" draggable={false} style={{ top: "35%", right: "10%", opacity: 0.4, transform: "rotate(-8deg)", animation: "stickerFloat1 4.5s ease-in-out infinite 1.2s" }} />
          <Image src="/rebranding/stickers/axie-thinking-sticker.png" alt="" width={46} height={40} className="icisco-sticker" draggable={false} style={{ top: "12%", left: "32%", opacity: 0.45, transform: "rotate(12deg)", animation: "stickerFloat2 5s ease-in-out infinite 1.8s" }} />
          <Image src="/rebranding/stickers/axie-tired-sticker.png" alt="" width={44} height={38} className="icisco-sticker" draggable={false} style={{ bottom: "28%", right: "28%", opacity: 0.4, transform: "rotate(-12deg)", animation: "stickerFloat3 4s ease-in-out infinite 0.4s" }} />
          <Image src="/rebranding/stickers/axie-flying-sticker.png" alt="" width={70} height={61} className="icisco-sticker" draggable={false} style={{ top: "55%", left: "8%", opacity: 0.5, transform: "rotate(-18deg)", animation: "stickerFloat1 6s ease-in-out infinite 0.9s" }} />
          <Image src="/rebranding/stickers/axie-thinking-sticker.png" alt="" width={40} height={35} className="icisco-sticker" draggable={false} style={{ top: "45%", right: "5%", opacity: 0.35, transform: "rotate(20deg)", animation: "stickerFloat2 5.5s ease-in-out infinite 2s" }} />
        </div>
      )}

      {activeApp === "id-finder" && !closing && (
        <div className="icisco-app-screen">
          <div className="icisco-app-bar">
            <button
              type="button"
              className="icisco-app-back"
              onClick={() => {
                // Keep the looked-up member alive: the Shop spends on whoever
                // is currently looked up, and "Look up another" is the reset.
                setActiveApp(null);
                setLookupError(null);
              }}
              aria-label="Back to home"
            >
              &#9664;
            </button>
            <span className="icisco-app-title">ID Finder</span>
          </div>

          {showCongrats && badgeDefsReady && (() => {
            const info = badgeFor(congratsBadge);
            const awardedByName = badgeMeta[congratsBadge]?.awarded_by;
            return (
              <div className="icisco-congrats-overlay">
                <div className="icisco-congrats-card">
                  <div className="icisco-confetti" />
                  <div className="icisco-confetti" />
                  <div className="icisco-confetti" />
                  <div className="icisco-confetti" />
                  <div className="icisco-confetti" />
                  <div className="icisco-confetti" />
                  <div className="icisco-confetti" />
                  <div className="icisco-confetti" />
                  {info && (
                    <Image
                      src={info.img}
                      alt={`${info.name} Badge`}
                      width={80}
                      height={80}
                      className="icisco-congrats-badge"
                      draggable={false}
                    />
                  )}
                  <p className="icisco-congrats-title">Congratulations!</p>
                  <p className="icisco-congrats-text">
                    {info ? (
                      <>
                        You earned the {info.name} badge!
                      </>
                    ) : (
                      <>You earned a new badge!</>
                    )}
                  </p>
                  {awardedCiscoins > 0 && (
                    <p className="icisco-congrats-ciscoins">
                      +{awardedCiscoins.toLocaleString("en-US")} Ciscoins
                    </p>
                  )}
                  {awardedByName && (
                    <p className="icisco-congrats-awarded-by">
                      Awarded by {awardedByName}
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="icisco-idfinder-body">
            {viewingPublicId ? (
              <div className="icisco-publicid-view">
                <div className={`icisco-idcard card-style-${publicIds.find((i) => i.email === viewingPublicId)?.card_style || "white"}`} style={{ maxWidth: "100%", cursor: "default" }}>
                  {(() => {
                    const person = publicIds.find((i) => i.email === viewingPublicId);
                    if (!person) return <p className="icisco-idfinder-hint">ID not found.</p>;
                    const personBadges = new Set(person.badges);
                    return (
                      <>
                        <div className="icisco-idcard-face icisco-idcard-front">
                          <div className="icisco-idcard-top">
                            <Image src="/rebranding/logos/cncp-purple-logo.png" alt="" width={20} height={14} className="icisco-idcard-top-logo" draggable={false} />
                            <span className="icisco-idcard-top-title">Member ID</span>
                            <Image src="/rebranding/logos/cncp-purple-logo.png" alt="" width={20} height={14} className="icisco-idcard-top-logo" draggable={false} />
                          </div>
                          <div className="icisco-idcard-body">
                            <div className="icisco-idcard-avatar">
                              <Image src="/rebranding/logos/cncp-purple-logo.png" alt="CNCP" width={56} height={40} className="icisco-idcard-avatar-img" />
                            </div>
                            <div className="icisco-idcard-info">
                              <p className="icisco-idcard-name">{person.first_name} {person.last_name}</p>
                              <p className="icisco-idcard-idnum">CNCP-2026-{String(person.email.length * 7 % 10000).padStart(4, "0")}</p>
                              <p className="icisco-idcard-course">{person.course_year_section}</p>
                              <span className="icisco-idcard-membership">{person.membership_type}</span>
                              <p className="icisco-idcard-email">{person.email}</p>
                            </div>
                          </div>
                          <div className="icisco-idcard-badges">
                            <span className="icisco-idcard-badges-title">Badges</span>
                            <div className="icisco-idcard-badge-slots">
                              {(() => {
                                const totalSlots = 3;
                                const slots: ({ id: string; img: string; name: string } | null)[] = [];
                                for (const id of personBadges) {
                                  const info = badgeFor(id);
                                  if (info) slots.push({ id, img: info.img, name: info.name });
                                }
                                while (slots.length < totalSlots) slots.push(null);
                                return slots.map((slot, i) => (
                                  <div
                                    key={slot ? slot.id : `empty-${i}`}
                                    className={`icisco-idcard-badge-slot ${slot ? "earned" : ""}`}
                                  >
                                    {slot ? (
                                      <Image
                                        src={slot.img}
                                        alt={slot.name}
                                        width={36}
                                        height={36}
                                        className="icisco-idcard-badge-img"
                                        draggable={false}
                                      />
                                    ) : (
                                      <div className="icisco-idcard-badge-icon-wrap">?</div>
                                    )}
                                  </div>
                                ));
                              })()}
                            </div>
                          </div>
                          <div className="icisco-idcard-footer">
                            <span className="icisco-idcard-org-footer">Cisco NetConnect PUP &ndash; Manila</span>
                          </div>
                        </div>
                        <div className="icisco-idcard-face icisco-idcard-back">
                          <div className="icisco-idcard-back-header">
                            <Image src="/rebranding/logos/cncp-purple-logo.png" alt="CNCP" width={40} height={28} draggable={false} />
                            <span className="icisco-idcard-back-org">Cisco NetConnect PUP &ndash; Manila</span>
                          </div>
                          <p className="icisco-idcard-back-text">
                            This is an official identification card issued and recognized by <strong>Cisco NetConnect PUP &ndash; Manila</strong> for its registered members.
                          </p>
                          <div className="icisco-idcard-back-signatories">
                            <div className="icisco-idcard-signatory">
                              <Image src="/jhered-signatory.png" alt="Jhered Miguel Republica" width={160} height={50} className="icisco-idcard-sig-img" draggable={false} />
                              <div className="icisco-idcard-sig-line" />
                              <p className="icisco-idcard-sig-name">Jhered Miguel Republica</p>
                              <p className="icisco-idcard-sig-role">Chief Executive Officer</p>
                            </div>
                            <div className="icisco-idcard-signatory">
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#f8f9fa", border: "1px dashed #d0dbe4", borderRadius: "4px", width: "100%", height: "50px" }}>
                                <span style={{ color: "#90a4ae", fontSize: "0.65rem" }}>Signature</span>
                              </div>
                              <div className="icisco-idcard-sig-line" />
                              <p className="icisco-idcard-sig-name">{person.first_name} {person.last_name}</p>
                              <p className="icisco-idcard-sig-role">Member</p>
                            </div>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
                <button
                  type="button"
                  className="icisco-idfinder-btn"
                  style={{ marginTop: "0.5rem" }}
                  onClick={() => setViewingPublicId(null)}
                >
                  &#9664; Back to list
                </button>
              </div>
            ) : (
              <>
                {/* Decorative logo */}
            <Image
              src="/rebranding/logos/cncp-purple-logo.png"
              alt=""
              width={80}
              height={56}
              className="icisco-idfinder-deco-logo"
              aria-hidden
            />

            {/* Axie character */}
            <div className="icisco-idfinder-axie">
              <div className="icisco-idfinder-axie-ring" />
              <Image
                src={
                  idFinderPhase === "not-found"
                    ? "/rebranding/stickers/axie-tired-sticker.png"
                    : idFinderPhase === "found"
                      ? "/rebranding/stickers/axie-flying-sticker1.png"
                      : "/rebranding/stickers/axie-thinking-sticker.png"
                }
                alt="Axie"
                width={90}
                height={90}
                className={`icisco-idfinder-axie-img ${idFinderPhase === "found" ? "bounce" : ""}`}
              />
              <div className="icisco-idfinder-bubble">
                {idFinderPhase === "found"
                  ? "Found you! Here's your CNCP member card!"
                  : idFinderPhase === "not-found"
                    ? "Hmm, I couldn't find that email. Try again!"
                    : "Hey! Enter your email below and I'll pull up your CNCP member card!"}
              </div>
            </div>

            {/* Form state */}
            {!lookupResult && (
              <form
                className="icisco-idfinder-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleLookup();
                }}
              >
                <p className="icisco-idfinder-label">
                  Enter your email to find your CNCP member ID
                </p>
                <div className="icisco-idfinder-input-wrap">
                  <span className="icisco-idfinder-input-icon">&#9993;</span>
                  <input
                    type="email"
                    className={`icisco-idfinder-input ${lookupError ? "shake" : ""}`}
                    placeholder="you@example.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  className="icisco-idfinder-btn"
                  disabled={lookupLoading || !emailInput.trim()}
                >
                  {lookupLoading ? "Searching\u2026" : "Find My ID"}
                </button>
              </form>
            )}

            {/* Ciscoins balance */}
            {lookupResult && typeof lookupResult.ciscoins === "number" && (
              <div className="icisco-balance-chip">
                <span className="icisco-balance-amount">
                  {lookupResult.ciscoins.toLocaleString("en-US")}
                </span>
                <span className="icisco-balance-label">Ciscoins balance</span>
              </div>
            )}

            {/* ID Card */}
            {lookupResult && (
              <div
                className={`icisco-idcard ${cardFlipped ? "flipped" : ""} card-style-${lookupResult.card_style || "white"}`}
                onClick={() => setCardFlipped(!cardFlipped)}
              >
              <div className="icisco-idcard-inner">
                {/* FRONT */}
                <div className="icisco-idcard-face icisco-idcard-front">
                  <div className="icisco-idcard-top">
                    <Image
                      src="/rebranding/logos/cncp-purple-logo.png"
                      alt=""
                      width={20}
                      height={14}
                      className="icisco-idcard-top-logo"
                      draggable={false}
                    />
                    <span className="icisco-idcard-top-title">Member ID</span>
                    <Image
                      src="/rebranding/logos/cncp-purple-logo.png"
                      alt=""
                      width={20}
                      height={14}
                      className="icisco-idcard-top-logo"
                      draggable={false}
                    />
                  </div>
                  <div className="icisco-idcard-body">
                    <div className="icisco-idcard-avatar">
                      <Image
                        src="/rebranding/logos/cncp-purple-logo.png"
                        alt="CNCP"
                        width={56}
                        height={40}
                        className="icisco-idcard-avatar-img"
                      />
                    </div>
                    <div className="icisco-idcard-info">
                      <p className="icisco-idcard-name">
                        {lookupResult.first_name} {lookupResult.last_name}
                      </p>
                      <p className="icisco-idcard-idnum">
                        CNCP-2026-
                        {String(
                          lookupResult.email.length * 7 % 10000
                        ).padStart(4, "0")}
                      </p>
                      <p className="icisco-idcard-course">
                        {lookupResult.course_year_section}
                      </p>
                      <span className="icisco-idcard-membership">
                        {lookupResult.membership_type}
                      </span>
                      <p className="icisco-idcard-email">
                        {lookupResult.email}
                      </p>
                    </div>
                  </div>
                  <div className="icisco-idcard-badges">
                    <span className="icisco-idcard-badges-title">
                      Badges
                      <span className="icisco-idcard-badges-help" onClick={(e) => e.stopPropagation()}>
                        ?
                        <span className="icisco-idcard-badges-tooltip">
                          Earn badges by scanning QR codes at CNCP events and activities.
                        </span>
                      </span>
                    </span>
                    <div className="icisco-idcard-badge-slots">
                      {(() => {
                        const totalSlots = 3;
                        const earned = Array.from(earnedBadges)
                          .map((id) => ({ id, at: badgeMeta[id]?.awarded_at ?? "" }))
                          .sort((a, b) => a.at.localeCompare(b.at));
                        const slots: ({ id: string; img: string; name: string } | null)[] = [];
                        for (const e of earned) {
                          const info = badgeFor(e.id);
                          if (info) slots.push({ id: e.id, img: info.img, name: info.name });
                        }
                        while (slots.length < totalSlots) slots.push(null);
                        return slots.map((slot, i) => (
                          <div
                            key={slot ? slot.id : `empty-${i}`}
                            className={`icisco-idcard-badge-slot ${slot ? "earned" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (slot) setSelectedBadge(slot.id);
                            }}
                          >
                            {slot ? (
                              <Image
                                src={slot.img}
                                alt={slot.name}
                                width={36}
                                height={36}
                                className="icisco-idcard-badge-img"
                                draggable={false}
                              />
                            ) : (
                              <div className="icisco-idcard-badge-icon-wrap">?</div>
                            )}
                          </div>
                        ));
          })()}

          {awardError && (
            <div className="icisco-congrats-overlay">
              <div className="icisco-congrats-card icisco-award-error-card">
                <p className="icisco-congrats-title">Claim not saved</p>
                <p className="icisco-congrats-text">
                  {awardErrorMsg ?? "We couldn't record your badge. Please try scanning again."}
                </p>
              </div>
            </div>
          )}
                    </div>
                  </div>
                  <div className="icisco-idcard-footer">
                    <span className="icisco-idcard-org-footer">
                      Cisco NetConnect PUP &ndash; Manila
                    </span>
                    <div className="icisco-idcard-qr">
                      {qrDataUrl && (
                        <img
                          src={qrDataUrl}
                          alt="QR Code"
                          className="icisco-idcard-qr-img"
                          onClick={(e) => { e.stopPropagation(); setZoomedQrImg(qrDataUrl); }}
                          style={{ cursor: "zoom-in" }}
                        />
                      )}
                    </div>
                  </div>
                </div>

                {selectedBadge && (() => {
                  const info = badgeFor(selectedBadge);
                  if (!info) return null;
                  const meta = badgeMeta[selectedBadge];
                  return createPortal(
                    <div className="icisco-badge-modal" onClick={(e) => { e.stopPropagation(); setSelectedBadge(null); }}>
                      <div className="icisco-badge-modal-card" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="icisco-badge-modal-close"
                          onClick={() => setSelectedBadge(null)}
                        >
                          &times;
                        </button>
                        <Image
                          src={info.img}
                          alt={info.name}
                          width={64}
                          height={64}
                          className="icisco-badge-modal-img"
                          draggable={false}
                          onClick={() => setZoomedBadgeImg({ src: info.img, alt: info.name })}
                          style={{ cursor: "zoom-in" }}
                        />
                        <p className="icisco-badge-modal-name">{info.name}</p>
                        <p className="icisco-badge-modal-desc">
                          {info.desc}
                        </p>
                        {meta?.awarded_by && (
                          <p className="icisco-badge-modal-awarded-by">
                            Awarded by {meta.awarded_by}
                          </p>
                        )}
                      </div>
                    </div>,
                    document.body
                  );
                })()}

                {zoomedBadgeImg && createPortal(
                  <div className="icisco-badge-zoom-overlay" onClick={(e) => { e.stopPropagation(); setZoomedBadgeImg(null); }}>
                    <Image
                      src={zoomedBadgeImg.src}
                      alt={zoomedBadgeImg.alt}
                      width={256}
                      height={256}
                      className="icisco-badge-zoom-img"
                      draggable={false}
                    />
                  </div>,
                  document.body
                )}

                {zoomedQrImg && createPortal(
                  <div className="icisco-badge-zoom-overlay" onClick={(e) => { e.stopPropagation(); setZoomedQrImg(null); }}>
                    <img
                      src={zoomedQrImg}
                      alt="QR Code"
                      className="icisco-badge-zoom-img"
                      draggable={false}
                    />
                  </div>,
                  document.body
                )}

                {/* BACK */}
                <div className="icisco-idcard-face icisco-idcard-back">
                  <div className="icisco-idcard-back-header">
                    <Image
                      src="/rebranding/logos/cncp-purple-logo.png"
                      alt="CNCP"
                      width={40}
                      height={28}
                      draggable={false}
                    />
                    <span className="icisco-idcard-back-org">
                      Cisco NetConnect PUP &ndash; Manila
                    </span>
                  </div>
                  <p className="icisco-idcard-back-text">
                    This is an official identification card issued and recognized
                    by <strong>Cisco NetConnect PUP &ndash; Manila</strong> for
                    its registered members.
                  </p>
                  <div className="icisco-idcard-back-signatories">
                    <div className="icisco-idcard-signatory" onClick={(e) => e.stopPropagation()}>
                      <Image
                        src="/jhered-signatory.png"
                        alt="Jhered Miguel Republica"
                        width={160}
                        height={50}
                        className="icisco-idcard-sig-img"
                        draggable={false}
                      />
                      <div className="icisco-idcard-sig-line" />
                      <p className="icisco-idcard-sig-name">
                        Jhered Miguel Republica
                      </p>
                      <p className="icisco-idcard-sig-role">
                        Chief Executive Officer
                      </p>
                    </div>
                    <div className="icisco-idcard-signatory" onClick={(e) => e.stopPropagation()}>
                      <canvas
                        ref={sigCanvasRef}
                        width={160}
                        height={50}
                        className="icisco-idcard-sig-canvas"
                        onMouseDown={startDraw}
                        onMouseMove={draw}
                        onMouseUp={endDraw}
                        onMouseLeave={endDraw}
                        onTouchStart={startDraw}
                        onTouchMove={draw}
                        onTouchEnd={endDraw}
                      />
                      <div className="icisco-idcard-sig-actions">
                        <button
                          type="button"
                          className="icisco-idcard-sig-clear"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearSig();
                          }}
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          className={`icisco-idcard-sig-save ${savedSignatureUrl ? "saved" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            saveSignature();
                          }}
                          disabled={sigSaving}
                        >
                          {sigSaving ? "Saving..." : savedSignatureUrl ? "Saved" : "Save"}
                        </button>
                      </div>
                      <div className="icisco-idcard-sig-line" />
                      <p className="icisco-idcard-sig-name">
                        {lookupResult.first_name} {lookupResult.last_name}
                      </p>
                      <p className="icisco-idcard-sig-role">Member</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icisco-idcard-back-flip"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCardFlipped(false);
                    }}
                  >
                    Tap to flip back
                  </button>
                </div>
              </div>
              </div>
            )}

            {lookupError && !lookupResult && (
              <p className="icisco-idfinder-error">{lookupError}</p>
            )}

            {lookupResult && (
              <button
                type="button"
                className="icisco-idfinder-btn icisco-id-card-again"
                onClick={() => {
                  setLookupResult(null);
                  setEmailInput("");
                  setIdFinderPhase("prompt");
                  setQrDataUrl("");
                  setViewingPublicId(null);
                }}
              >
                Look up another
              </button>
            )}

            {lookupResult && !viewingPublicId && (
              <>
                <div className="icisco-public-toggle">
                  <span className="icisco-public-toggle-label">Show my ID publicly</span>
                  <button
                    type="button"
                    className={`icisco-toggle-switch ${isPublic ? "on" : ""}`}
                    disabled={publicToggleLoading}
                    onClick={async () => {
                      const newVal = !isPublic;
                      setPublicToggleLoading(true);
                      setPublicToggleError(null);
                      try {
                        const res = await fetch("/api/digital-id", {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ email: lookupResult.email, is_public: newVal }),
                        });
                        if (res.ok) {
                          setIsPublic(newVal);
                          fetch("/api/public-ids")
                            .then((r) => r.json())
                            .then((d) => setPublicIds(d.ids ?? []))
                            .catch(() => {});
                        } else {
                          const body = await res.json().catch(() => ({}));
                          setPublicToggleError(body.error || "Couldn't update visibility. Please try again.");
                        }
                      } catch {
                        setPublicToggleError("Network error. Please try again.");
                      } finally {
                        setPublicToggleLoading(false);
                      }
                    }}
                  >
                    <span className="icisco-toggle-knob" />
                  </button>
                </div>
                {publicToggleError && (
                  <p className="icisco-idfinder-error">{publicToggleError}</p>
                )}
              </>
            )}

            {!viewingPublicId && (
              <div className="icisco-public-ids-section">
                <p className="icisco-public-ids-header">Public IDs</p>
                {publicIdsLoading ? (
                  <p className="icisco-idfinder-hint" style={{ fontSize: "0.7rem" }}>Loading...</p>
                ) : publicIds.length === 0 ? (
                  <p className="icisco-idfinder-hint" style={{ fontSize: "0.7rem" }}>No public IDs available yet.</p>
                ) : (
                  <div className="icisco-public-ids-grid">
                    {publicIds.map((person) => (
                      <button
                        key={person.email}
                        type="button"
                        className={`icisco-public-id-card card-style-${person.card_style || "white"}`}
                        onClick={() => setViewingPublicId(person.email)}
                      >
                        <div className="icisco-public-id-avatar">
                          <Image src="/rebranding/logos/cncp-purple-logo.png" alt="CNCP" width={32} height={22} draggable={false} />
                        </div>
                        <p className="icisco-public-id-name">{person.first_name} {person.last_name}</p>
                        <p className="icisco-public-id-type">{person.membership_type}</p>
                        <div className="icisco-public-id-badges">
                          {(person.badges ?? []).map((b) => {
                            const info = badgeFor(b);
                            return info ? (
                              <Image key={b} src={info.img} alt={info.name} width={18} height={18} draggable={false} />
                            ) : null;
                          })}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            </>
            )}
          </div>
          <Image src="/rebranding/stickers/axie-flying-sticker.png" alt="" width={70} height={61} className="icisco-sticker" draggable={false} style={{ top: "6%", right: "4%", opacity: 0.65, transform: "rotate(-8deg)", animation: "stickerFloat1 5s ease-in-out infinite 0.2s" }} />
          <Image src="/rebranding/stickers/axie-sleeping-sticker.png" alt="" width={86} height={75} className="icisco-sticker" draggable={false} style={{ bottom: "6%", left: "3%", opacity: 0.6, transform: "rotate(4deg)", animation: "stickerFloat2 4s ease-in-out infinite 0.5s" }} />
          <Image src="/rebranding/stickers/axie-thinking-sticker.png" alt="" width={63} height={55} className="icisco-sticker" draggable={false} style={{ bottom: "20%", right: "4%", opacity: 0.65, transform: "rotate(-6deg)", animation: "stickerFloat3 4.5s ease-in-out infinite 0.8s" }} />
          <Image src="/rebranding/stickers/axie-tired-sticker.png" alt="" width={57} height={50} className="icisco-sticker" draggable={false} style={{ top: "15%", left: "3%", opacity: 0.6, transform: "rotate(6deg)", animation: "stickerFloat2 5s ease-in-out infinite 1s" }} />
          <Image src="/rebranding/stickers/axie-flying-sticker1.png" alt="" width={35} height={31} className="icisco-sticker" draggable={false} style={{ bottom: "35%", left: "12%", opacity: 0.35, transform: "rotate(18deg)", animation: "stickerFloat1 5.5s ease-in-out infinite 1.5s" }} />
          <Image src="/rebranding/stickers/axie-sleeping-sticker1.png" alt="" width={52} height={46} className="icisco-sticker" draggable={false} style={{ top: "30%", right: "7%", opacity: 0.3, transform: "rotate(-10deg)", animation: "stickerFloat3 4.5s ease-in-out infinite 0.3s" }} />
          <Image src="/rebranding/stickers/axie-thinking-sticker.png" alt="" width={32} height={28} className="icisco-sticker" draggable={false} style={{ top: "8%", left: "35%", opacity: 0.35, transform: "rotate(14deg)", animation: "stickerFloat2 6s ease-in-out infinite 2s" }} />
          <Image src="/rebranding/stickers/axie-tired-sticker.png" alt="" width={30} height={26} className="icisco-sticker" draggable={false} style={{ bottom: "30%", right: "32%", opacity: 0.3, transform: "rotate(-15deg)", animation: "stickerFloat3 4s ease-in-out infinite 0.6s" }} />
          <Image src="/rebranding/stickers/axie-flying-sticker.png" alt="" width={47} height={41} className="icisco-sticker" draggable={false} style={{ top: "55%", left: "6%", opacity: 0.4, transform: "rotate(-20deg)", animation: "stickerFloat1 5s ease-in-out infinite 1.8s" }} />
          <Image src="/rebranding/stickers/axie-thinking-sticker.png" alt="" width={26} height={23} className="icisco-sticker" draggable={false} style={{ top: "42%", right: "4%", opacity: 0.3, transform: "rotate(22deg)", animation: "stickerFloat2 6.5s ease-in-out infinite 2.5s" }} />
        </div>
      )}

      {activeApp === "shop" && !closing && (
        <div className="icisco-app-screen">
          <div className="icisco-app-bar">
            <button
              type="button"
              className="icisco-app-back"
              onClick={() => {
                setActiveApp(null);
                lockWallet();
              }}
              aria-label="Back to home"
            >
              &#9664;
            </button>
            <span className="icisco-app-title">Shop</span>
          </div>

          <div className="icisco-shop">
            <div className="icisco-shop-inner">
              <header className="icisco-shop-hero">
                <div className="icisco-shop-sign" aria-hidden="true">
                  <span className="icisco-shop-sign-chain is-left" />
                  <span className="icisco-shop-sign-chain is-right" />
                  <span className="icisco-shop-sign-board">
                    <span className="icisco-shop-sign-kicker">
                      Ciscoins Store
                    </span>
                    <span className="icisco-shop-sign-title">The Shop</span>
                  </span>
                </div>
                {wallet ? (
                  <div className="icisco-shop-wallet">
                    <div
                      className="icisco-shop-wallet-member"
                      title={wallet.email}
                    >
                      <span className="icisco-shop-wallet-kicker">
                        Signed in
                      </span>
                      <span className="icisco-shop-wallet-name">
                        {wallet.first_name} {wallet.last_name}
                      </span>
                    </div>
                    <div className="icisco-shop-wallet-balance">
                      <CoinIcon className="icisco-shop-coin" />
                      {typeof wallet.ciscoins === "number" ? (
                        <>
                          <span className="icisco-shop-wallet-amount">
                            {wallet.ciscoins.toLocaleString("en-US")}
                          </span>
                          <span className="icisco-shop-sr-only">
                            Ciscoins
                          </span>
                        </>
                      ) : (
                        <span className="icisco-shop-wallet-amount is-unknown">
                          Unavailable
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="icisco-shop-wallet-lock"
                      onClick={lockWallet}
                    >
                      Lock wallet
                    </button>
                  </div>
                ) : (
                  <p className="icisco-shop-wallet is-locked">
                    <CoinIcon className="icisco-shop-coin" />
                    <span>Wallet locked</span>
                  </p>
                )}
              </header>

              {!wallet && (
                <section
                  className="icisco-counter"
                  aria-labelledby="shop-signin-title"
                >
                  <div className="icisco-counter-head">
                    <Image
                      src="/rebranding/logos/cncp-purple-logo.png"
                      alt=""
                      width={44}
                      height={31}
                      className="icisco-counter-logo"
                      draggable={false}
                    />
                    <div>
                      <p className="icisco-counter-store">Ciscoins Store</p>
                      <p className="icisco-counter-sub">
                        Cisco NetConnect PUP - Manila
                      </p>
                    </div>
                  </div>
                  <div className="icisco-counter-body">
                    <div className="icisco-counter-copy">
                      <h1
                        className="icisco-counter-title"
                        id="shop-signin-title"
                      >
                        Sign in to buy
                      </h1>
                      <p className="icisco-counter-text">
                        Enter the email and phone number on your CNCP ID. Both
                        have to match before we show your Ciscoins.
                      </p>
                    </div>
                    <form
                      className="icisco-shop-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        openWallet();
                      }}
                    >
                      <div className="icisco-counter-fields">
                        <div className="icisco-shop-field">
                          <label
                            className="icisco-shop-label"
                            htmlFor="shop-wallet-email"
                          >
                            Email
                          </label>
                          <input
                            ref={shopEmailRef}
                            id="shop-wallet-email"
                            className="icisco-shop-input"
                            type="email"
                            name="email"
                            inputMode="email"
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            required
                            placeholder="you@example.com"
                            value={walletEmail}
                            disabled={walletLoading}
                            onChange={(e) => {
                              setWalletEmail(e.target.value);
                              setWalletError(null);
                            }}
                          />
                        </div>
                        <div className="icisco-shop-field">
                          <label
                            className="icisco-shop-label"
                            htmlFor="shop-wallet-phone"
                          >
                            Phone
                          </label>
                          <input
                            id="shop-wallet-phone"
                            className="icisco-shop-input"
                            type="tel"
                            name="phone"
                            inputMode="numeric"
                            autoComplete="off"
                            maxLength={11}
                            pattern="09[0-9]{9}"
                            title="11 digits, starting with 09"
                            required
                            placeholder="09XX XXX XXXX"
                            value={walletPhone}
                            disabled={walletLoading}
                            aria-describedby="shop-wallet-phone-hint"
                            onChange={(e) => {
                              setWalletPhone(
                                e.target.value.replace(/\D/g, "").slice(0, 11)
                              );
                              setWalletError(null);
                            }}
                          />
                          <p
                            className="icisco-shop-field-hint"
                            id="shop-wallet-phone-hint"
                          >
                            11 digits, starting with 09.
                          </p>
                        </div>
                      </div>
                      {walletError && (
                        <p className="icisco-shop-msg error" role="alert">
                          {walletError}
                        </p>
                      )}
                      <div className="icisco-counter-actions">
                        <button
                          type="submit"
                          className="icisco-shop-cta"
                          disabled={walletLoading}
                        >
                          {walletLoading ? "Checking…" : "Open wallet"}
                        </button>
                        <button
                          type="button"
                          className="icisco-shop-link"
                          onClick={() => setActiveApp("id-finder")}
                        >
                          No CNCP ID? Find it
                        </button>
                      </div>
                    </form>
                  </div>
                </section>
              )}

              <section
                className="icisco-shop-case"
                aria-labelledby="shop-shelf-title"
              >
                <div className="icisco-shop-mascot" aria-hidden="true">
                  <Image
                    src="/axie-peeking.png"
                    alt=""
                    width={200}
                    height={200}
                    draggable={false}
                  />
                </div>
                <span className="icisco-shop-bolt is-tl" aria-hidden="true" />
                <span className="icisco-shop-bolt is-tr" aria-hidden="true" />
                <span className="icisco-shop-bolt is-bl" aria-hidden="true" />
                <span className="icisco-shop-bolt is-br" aria-hidden="true" />

                <div className="icisco-shop-case-head">
                  <div>
                    <h2
                      className="icisco-shop-case-title"
                      id="shop-shelf-title"
                    >
                      On the shelf
                    </h2>
                    <p className="icisco-shop-case-sub">
                      Buy here, then claim it at CEA 317.
                    </p>
                  </div>
                  {!shopLoading && !shopError && shopItems.length > 0 && (
                    <span className="icisco-shop-count">
                      {shopItems.length}{" "}
                      {shopItems.length === 1 ? "item" : "items"}
                    </span>
                  )}
                </div>

                {shopLoading ? (
                  <>
                    <p className="icisco-shop-hint" role="status">
                      Loading the shelf…
                    </p>
                    <div className="icisco-shop-rack" aria-hidden="true">
                      {Array.from({ length: SHOP_PAGE_SIZE }).map(
                        (_, index) => (
                          <div
                            className="icisco-shop-slot is-skeleton"
                            key={index}
                          >
                            <div className="icisco-shop-slot-box">
                              <div className="icisco-shop-slot-media" />
                              <div className="icisco-shop-slot-body">
                                <span className="icisco-shop-skeleton-line is-wide" />
                                <span className="icisco-shop-skeleton-line" />
                                <span className="icisco-shop-skeleton-line is-short" />
                              </div>
                            </div>
                            <div className="icisco-shop-slot-plate">
                              <span className="icisco-shop-skeleton-line is-price" />
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </>
                ) : shopError ? (
                  <div className="icisco-shop-state is-error" role="alert">
                    <span
                      className="icisco-shop-state-icon"
                      aria-hidden="true"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7.5v5.5" />
                        <path d="M12 16.4h.01" />
                      </svg>
                    </span>
                    <p className="icisco-shop-state-title">
                      The shelf did not load.
                    </p>
                    <p className="icisco-shop-state-text">{shopError}</p>
                    <button
                      type="button"
                      className="icisco-shop-state-action"
                      onClick={loadShop}
                    >
                      Try again
                    </button>
                  </div>
                ) : shopItems.length === 0 ? (
                  <div className="icisco-shop-state">
                    <span
                      className="icisco-shop-state-icon"
                      aria-hidden="true"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M4.5 8h15l-1.1 10.1a2 2 0 0 1-2 1.9H7.6a2 2 0 0 1-2-1.9L4.5 8Z" />
                        <path d="M8.6 10V6.7a3.4 3.4 0 0 1 6.8 0V10" />
                      </svg>
                    </span>
                    <p className="icisco-shop-state-title">
                      The shelf is empty.
                    </p>
                    <p className="icisco-shop-state-text">
                      Booth admins stock it before each event. Check back soon,
                      or ask at the table.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="icisco-shop-rack">
                      {shopPageItems.map((item) => {
                        const balance = wallet?.ciscoins;
                        const balanceKnown = typeof balance === "number";
                        const affordable =
                          typeof balance === "number" && balance >= item.price;
                        const shortBy =
                          typeof balance === "number"
                            ? Math.max(item.price - balance, 0)
                            : 0;
                        const localImage =
                          item.image_url && item.image_url.startsWith("/")
                            ? item.image_url
                            : null;
                        return (
                          <article
                            className={`icisco-shop-slot ${
                              !wallet
                                ? "is-guest"
                                : !affordable
                                  ? "is-short"
                                  : ""
                            }`}
                            key={item.id}
                          >
                            <div className="icisco-shop-slot-box">
                              <div className="icisco-shop-slot-media">
                                {localImage ? (
                                  <Image
                                    src={localImage}
                                    alt={item.name}
                                    fill
                                    sizes="(max-width: 52rem) 50vw, 16rem"
                                    className="icisco-shop-slot-img"
                                    draggable={false}
                                  />
                                ) : (
                                  <div
                                    className="icisco-shop-slot-placeholder"
                                    aria-hidden="true"
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.4"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <path d="M4.5 8h15l-1.1 10.1a2 2 0 0 1-2 1.9H7.6a2 2 0 0 1-2-1.9L4.5 8Z" />
                                      <path d="M8.6 10V6.7a3.4 3.4 0 0 1 6.8 0V10" />
                                    </svg>
                                    <span>Photo coming soon</span>
                                  </div>
                                )}
                              </div>
                              <div className="icisco-shop-slot-body">
                                <h3 className="icisco-shop-slot-name">
                                  {item.name}
                                </h3>
                                {item.description && (
                                  <p className="icisco-shop-slot-desc">
                                    {item.description}
                                  </p>
                                )}
                                {!wallet ? (
                                  <button
                                    type="button"
                                    className="icisco-shop-slot-action"
                                    onClick={() => {
                                      shopEmailRef.current?.focus();
                                      shopEmailRef.current?.scrollIntoView({
                                        block: "center",
                                        behavior: "smooth",
                                      });
                                    }}
                                  >
                                    Sign in
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="icisco-shop-slot-action"
                                    disabled={!balanceKnown}
                                    onClick={(event) =>
                                      startPurchase(item, event.currentTarget)
                                    }
                                  >
                                    {!balanceKnown
                                      ? "Balance unavailable"
                                      : affordable
                                        ? "Buy"
                                        : `Need ${shortBy.toLocaleString(
                                            "en-US"
                                          )} more`}
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="icisco-shop-slot-plate">
                              <span className="icisco-shop-slot-price">
                                <CoinIcon className="icisco-shop-coin" />
                                <span className="icisco-shop-slot-amount">
                                  {item.price.toLocaleString("en-US")}
                                </span>
                                <span className="icisco-shop-sr-only">
                                  Ciscoins
                                </span>
                              </span>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                    <p className="icisco-shop-sr-only" role="status">
                      Showing items {shopPageStart} to {shopPageEnd} of{" "}
                      {shopItems.length}.
                    </p>
                    <div className="icisco-shop-case-nav">
                      <button
                        type="button"
                        className="icisco-shop-case-arrow is-prev"
                        aria-label="Previous shelf page"
                        disabled={currentShopPage === 0}
                        onClick={() =>
                          setShopPage(Math.max(0, currentShopPage - 1))
                        }
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M14.5 5.5 8 12l6.5 6.5" />
                        </svg>
                      </button>
                      <div
                        className="icisco-shop-dots"
                        role="group"
                        aria-label="Shelf pages"
                      >
                        {shopPageCount > 1 ? (
                          Array.from({ length: shopPageCount }).map(
                            (_, index) => (
                              <button
                                key={index}
                                type="button"
                                className={`icisco-shop-dot${
                                  index === currentShopPage ? " is-active" : ""
                                }`}
                                aria-label={`Shelf page ${index + 1}`}
                                aria-current={
                                  index === currentShopPage
                                    ? "page"
                                    : undefined
                                }
                                onClick={() => setShopPage(index)}
                              />
                            )
                          )
                        ) : (
                          <span
                            className="icisco-shop-dot is-active"
                            aria-hidden="true"
                          />
                        )}
                      </div>
                      <button
                        type="button"
                        className="icisco-shop-case-arrow is-next"
                        aria-label="Next shelf page"
                        disabled={currentShopPage >= shopPageCount - 1}
                        onClick={() =>
                          setShopPage(
                            Math.min(shopPageCount - 1, currentShopPage + 1)
                          )
                        }
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M9.5 5.5 16 12l-6.5 6.5" />
                        </svg>
                      </button>
                    </div>
                  </>
                )}
              </section>

              <p className="icisco-shop-footnote">
                If you ordered, wait for the email confirmation and claim it at
                CEA 317.
              </p>
            </div>
          </div>
        </div>
      )}

      {purchase &&
        createPortal(
          <div
            data-lenis-prevent
            className={`icisco-purchase-overlay${
              purchaseClosing ? " is-closing" : ""
            }${
              purchase.phase === "error"
                ? " is-error"
                : purchase.phase === "success"
                  ? " is-success"
                  : ""
            }`}
            onClick={closePurchase}
          >
            <div
              ref={purchaseDialogRef}
              className="icisco-purchase-card"
              data-phase={purchase.phase}
              role="dialog"
              aria-modal="true"
              aria-labelledby="purchase-title"
              aria-describedby="purchase-desc"
              aria-busy={purchase.phase === "paying"}
              tabIndex={-1}
              onClick={(event) => event.stopPropagation()}
            >
              {purchase.phase !== "paying" && (
                <button
                  type="button"
                  className="icisco-purchase-close"
                  onClick={closePurchase}
                  aria-label="Close purchase dialog"
                >
                  &times;
                </button>
              )}

              <div className="icisco-purchase-hero">
                {purchase.phase === "success" || purchase.phase === "error" ? (
                  <span
                    className={`icisco-purchase-result ${
                      purchase.phase === "success" ? "is-success" : "is-error"
                    }`}
                    aria-hidden="true"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {purchase.phase === "success" ? (
                        <path d="M20 6 9 17l-5-5" />
                      ) : (
                        <>
                          <path d="M18 6 6 18" />
                          <path d="M6 6l12 12" />
                        </>
                      )}
                    </svg>
                  </span>
                ) : (
                  <div className="icisco-purchase-stage" aria-hidden="true">
                    <div className="icisco-purchase-item">
                      {purchaseImage ? (
                        <Image
                          src={purchaseImage}
                          alt=""
                          fill
                          sizes="96px"
                          className="icisco-purchase-item-img"
                          draggable={false}
                        />
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M4.5 8h15l-1.1 10.1a2 2 0 0 1-2 1.9H7.6a2 2 0 0 1-2-1.9L4.5 8Z" />
                          <path d="M8.6 10V6.7a3.4 3.4 0 0 1 6.8 0V10" />
                        </svg>
                      )}
                    </div>
                    {purchase.phase === "paying" && (
                      <>
                        <span className="icisco-purchase-coin coin-a">C</span>
                        <span className="icisco-purchase-coin coin-b">C</span>
                        <span className="icisco-purchase-coin coin-c">C</span>
                      </>
                    )}
                  </div>
                )}

                <p
                  key={`kicker-${purchase.phase}`}
                  className="icisco-purchase-kicker"
                >
                  {purchase.phase === "confirm"
                    ? "Confirm purchase"
                    : purchase.phase === "paying"
                      ? "At the counter"
                      : purchase.phase === "success"
                        ? "Purchase complete"
                        : "Purchase failed"}
                </p>
                <h2
                  key={`title-${purchase.phase}`}
                  className="icisco-purchase-title"
                  id="purchase-title"
                >
                  {purchase.item.name}
                </h2>
                <p
                  key={`desc-${purchase.phase}`}
                  className="icisco-purchase-desc"
                  id="purchase-desc"
                  aria-live={
                    purchase.phase === "error" ? "assertive" : "polite"
                  }
                >
                  {purchase.phase === "confirm"
                    ? "Swap Ciscoins for this item. Pick it up at CEA 317 after the confirmation email."
                    : purchase.phase === "paying"
                      ? "Checking your balance and handing it over…"
                      : purchase.phase === "success"
                        ? purchase.duplicate
                          ? "That purchase was already recorded. You were not charged twice."
                          : "You're all set. Pick it up at CEA 317 and keep the confirmation email."
                        : purchase.shortBy > 0
                          ? `${purchase.error} Earn more Ciscoins at upcoming events, then come back.`
                          : purchase.error}
                </p>
              </div>

              <div className="icisco-purchase-summary">
                <div className="icisco-purchase-row">
                  <span>Price</span>
                  <span>
                    {purchase.item.price.toLocaleString("en-US")} Ciscoins
                  </span>
                </div>
                {purchase.balance !== null && (
                  <div className="icisco-purchase-row">
                    <span>
                      {purchase.phase === "success"
                        ? "New balance"
                        : "Balance"}
                    </span>
                    <span>
                      {purchase.balance.toLocaleString("en-US")} Ciscoins
                    </span>
                  </div>
                )}
                {purchase.phase === "confirm" &&
                  purchase.balance !== null && (
                    <div className="icisco-purchase-row is-emphasis">
                      <span>After purchase</span>
                      <span>
                        {Math.max(
                          purchase.balance - purchase.item.price,
                          0
                        ).toLocaleString("en-US")}{" "}
                        Ciscoins
                      </span>
                    </div>
                  )}
                {purchase.phase === "error" && purchase.shortBy > 0 && (
                  <div className="icisco-purchase-row is-short">
                    <span>Short by</span>
                    <span>
                      {purchase.shortBy.toLocaleString("en-US")} Ciscoins
                    </span>
                  </div>
                )}
              </div>

              {purchase.phase === "paying" && (
                <div className="icisco-purchase-progress" aria-hidden="true">
                  <span />
                </div>
              )}

              <div className="icisco-purchase-actions">
                {purchase.phase === "confirm" && (
                  <>
                    <button
                      type="button"
                      className="icisco-purchase-btn is-secondary"
                      onClick={closePurchase}
                    >
                      Not now
                    </button>
                    <button
                      type="button"
                      className="icisco-purchase-btn is-primary"
                      onClick={confirmPurchase}
                      ref={purchasePrimaryRef}
                    >
                      Buy for {purchase.item.price.toLocaleString("en-US")}{" "}
                      Ciscoins
                    </button>
                  </>
                )}

                {purchase.phase === "paying" && (
                  <button
                    type="button"
                    className="icisco-purchase-btn is-primary"
                    disabled
                  >
                    <span
                      className="icisco-purchase-spinner"
                      aria-hidden="true"
                    />
                    Paying…
                  </button>
                )}

                {purchase.phase === "success" && (
                  <button
                    type="button"
                    className="icisco-purchase-btn is-primary"
                    onClick={closePurchase}
                    ref={purchasePrimaryRef}
                  >
                    Done
                  </button>
                )}

                {purchase.phase === "error" && (
                  <>
                    {purchaseCanRetry && (
                      <button
                        type="button"
                        className="icisco-purchase-btn is-primary"
                        onClick={retryPurchase}
                        ref={purchasePrimaryRef}
                      >
                        Try again
                      </button>
                    )}
                    <button
                      type="button"
                      className={`icisco-purchase-btn ${
                        purchaseCanRetry ? "is-secondary" : "is-primary"
                      }`}
                      onClick={closePurchase}
                      ref={purchaseCanRetry ? undefined : purchasePrimaryRef}
                    >
                      {purchase.shortBy > 0 ? "Back to shelf" : "Close"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {activeApp === "games" && !closing && (
        <div className="icisco-app-screen">
          <div className="icisco-app-bar">
            <button
              type="button"
              className="icisco-app-back"
              onClick={() => setActiveApp(null)}
              aria-label="Back to home"
            >
              &#9664;
            </button>
            <span className="icisco-app-title">Games</span>
          </div>
          <div className="icisco-idfinder-body" style={{ overflow: "hidden", padding: "0.4rem", justifyContent: "center" }}>
            <WireZipGame />
          </div>
        </div>
      )}
    </div>
  );
}
