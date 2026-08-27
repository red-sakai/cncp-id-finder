"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import QRCode from "qrcode";

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
  const [walkFrame, setWalkFrame] = useState<"left" | "right">("left");

  // ID Finder app state
  const [activeApp, setActiveApp] = useState<null | "id-finder" | "games">(
    null
  );
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
    badges: { badge_id: string; awarded_at: string }[];
  } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [cardFlipped, setCardFlipped] = useState(false);
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [earnedBadges, setEarnedBadges] = useState<Set<string>>(new Set());
  const [showCongrats, setShowCongrats] = useState(false);

  const handleLookup = useCallback(async () => {
    const email = emailInput.trim();
    if (!email) return;
    setLookupLoading(true);
    setLookupError(null);
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
        QRCode.toDataURL(
          `https://cncp-id-finder.vercel.app/scan`,
          {
            width: 80,
            margin: 1,
            color: { dark: "#1a2a3a", light: "#ffffff" },
          }
        ).then(setQrDataUrl);
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

  const clearSig = () => {
    const ctx = sigCanvasRef.current?.getContext("2d");
    if (!ctx || !sigCanvasRef.current) return;
    ctx.clearRect(0, 0, sigCanvasRef.current.width, sigCanvasRef.current.height);
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

  // Walk cycle: alternate left/right frames, stop before walk ends
  useEffect(() => {
    if (phase !== "walk") return;
    let count = 0;
    const interval = setInterval(() => {
      count++;
      if (count >= 5) {
        clearInterval(interval);
        return;
      }
      setWalkFrame((f) => (f === "left" ? "right" : "left"));
    }, 350);
    return () => clearInterval(interval);
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
    if (awarded && email && awardedRef.current !== awarded) {
      awardedRef.current = awarded;
      setActiveApp("id-finder");
      setEmailInput(email);
      const doAward = async () => {
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
          QRCode.toDataURL(
            `https://cncp-id-finder.vercel.app/scan`,
            {
              width: 80,
              margin: 1,
              color: { dark: "#1a2a3a", light: "#ffffff" },
            }
          ).then(setQrDataUrl);
          if (!badges.has(awarded)) {
            await fetch("/api/badges", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, badgeId: awarded }),
            });
            setEarnedBadges((prev) => new Set([...prev, awarded]));
            setShowCongrats(true);
            setTimeout(() => setShowCongrats(false), 4000);
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
    ? "/axolotl-confused.png"
    : isWalk
      ? walkFrame === "left"
        ? "/walking-axolotl-left.png"
        : "/walking-axolotl-right.png"
      : "/waving-axolotl.png";

  return (
    <div className={`icisco-overlay${closing ? " is-closing" : ""}`} role="presentation">
      <div ref={mountRef} className="icisco-canvas" />
      <div ref={shadeRef} className="icisco-shade" />
      {!ready && phase === "anim" && (
        <div className="icisco-loading">Loading iCisco\u2026</div>
      )}

      {(phase === "logo" || showAxolotl) && !closing && (
        <div className="icisco-logo-wrap">
          <Image
            src="/cncp-logo-transparent.png"
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
            src="/cncp-logo-transparent.png"
            alt="CNCP"
            width={140}
            height={98}
            className="icisco-home-logo"
          />
          <div className="icisco-apps">
            <button
              type="button"
              className="icisco-app"
              onClick={() => setActiveApp("id-finder")}
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
          </div>
        </div>
      )}

      {activeApp === "id-finder" && !closing && (
        <div className="icisco-app-screen">
          <div className="icisco-app-bar">
            <button
              type="button"
              className="icisco-app-back"
              onClick={() => {
                setActiveApp(null);
                setLookupResult(null);
                setLookupError(null);
                setEmailInput("");
                setIdFinderPhase("prompt");
                setQrDataUrl("");
              }}
              aria-label="Back to home"
            >
              &#9664;
            </button>
            <span className="icisco-app-title">ID Finder</span>
          </div>

          {showCongrats && (
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
                <Image
                  src="/badges/welcome-to-cisco-badge.png"
                  alt="Welcome to Cisco Badge"
                  width={80}
                  height={80}
                  className="icisco-congrats-badge"
                  draggable={false}
                />
                <p className="icisco-congrats-title">Congratulations!</p>
                <p className="icisco-congrats-text">
                  You earned the Welcome to Cisco badge!
                </p>
              </div>
            </div>
          )}

          <div className="icisco-idfinder-body">
            {/* Decorative logo */}
            <Image
              src="/cncp-logo-transparent.png"
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
                    ? "/axolotl-confused.png"
                    : "/waving-axolotl.png"
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

            {/* ID Card */}
            {lookupResult && (
              <div
                className={`icisco-idcard ${cardFlipped ? "flipped" : ""}`}
                onClick={() => setCardFlipped(!cardFlipped)}
              >
                {/* FRONT */}
                <div className="icisco-idcard-face icisco-idcard-front">
                  <div className="icisco-idcard-top">
                    <Image
                      src="/cncp-logo-transparent.png"
                      alt=""
                      width={20}
                      height={14}
                      className="icisco-idcard-top-logo"
                      draggable={false}
                    />
                    <span className="icisco-idcard-top-title">Member ID</span>
                    <Image
                      src="/cncp-logo-transparent.png"
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
                        src="/cncp-logo-transparent.png"
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
                    <span className="icisco-idcard-badges-title">Badges</span>
                    <div className="icisco-idcard-badge-slots">
                      <div className="icisco-idcard-badge-slot">
                        {earnedBadges.has("welcome-to-cisco") ? (
                          <Image
                            src="/badges/welcome-to-cisco-badge.png"
                            alt="Welcome to Cisco"
                            width={36}
                            height={36}
                            className="icisco-idcard-badge-img"
                            draggable={false}
                          />
                        ) : (
                          <div className="icisco-idcard-badge-icon-wrap">?</div>
                        )}
                      </div>
                      <div className="icisco-idcard-badge-slot">
                        <div className="icisco-idcard-badge-icon-wrap">?</div>
                      </div>
                      <div className="icisco-idcard-badge-slot">
                        <div className="icisco-idcard-badge-icon-wrap">?</div>
                      </div>
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
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* BACK */}
                <div className="icisco-idcard-face icisco-idcard-back">
                  <div className="icisco-idcard-back-header">
                    <Image
                      src="/cncp-logo-transparent.png"
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
                }}
              >
                Look up another
              </button>
            )}
          </div>
        </div>
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
          <div className="icisco-idfinder-body">
            <p className="icisco-idfinder-hint">
              Games coming soon! Stay tuned.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
