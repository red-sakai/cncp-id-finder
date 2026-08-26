"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

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
  "You can explore the apps here: ID Finder to look up Cisco IDs, or Games for fun!",
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

              // Fall forward (tip towards viewer) then drop down
              const fallP = closeP * closeP;
              inner.rotation.x = Math.PI + Math.PI * 0.7 * fallP;
              outer.position.y = -10 * fallP;
              orient.scale.y = 1 - 0.15 * fallP;
              orient.scale.x = 1 + 0.08 * fallP;

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

      {phase === "home" && !closing && (
        <div className="icisco-home">
          <Image
            src="/cncp-logo-transparent.png"
            alt="CNCP"
            width={140}
            height={98}
            className="icisco-home-logo"
          />
          <div className="icisco-apps">
            <button type="button" className="icisco-app" title="Coming soon">
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
            <button type="button" className="icisco-app" title="Coming soon">
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
    </div>
  );
}
