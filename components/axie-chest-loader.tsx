"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

// Clip seconds in LoadingTreasureChest: walk in + lid opens until ~4.9,
// steady digging 4.9-6.4, card pops out and is held up until ~9.2.
const LOOP_START = 4.9;
const LOOP_END = 6.4;
const REVEAL_END = 9.2;
const SPEED = 1.3;
const LOOP_FADE = 0.3;
const LEAVE_MS = 350;

let axiePromise: Promise<GLTF> | null = null;

export function loadAxie(): Promise<GLTF> {
  if (!axiePromise) {
    axiePromise = new GLTFLoader().loadAsync("/rebranding/3d-models/axie.glb");
    axiePromise.catch(() => { axiePromise = null; });
  }
  return axiePromise;
}

export type ChestFinish = (found: boolean) => Promise<void>;

export default function AxieChestLoader({
  finishRef,
}: {
  finishRef: MutableRefObject<ChestFinish | null>;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let raf = 0;
    let outcome: "found" | "missing" | null = null;
    let settle: (() => void) | null = null;
    let started = false;

    const leave = () => {
      if (!settle) return;
      const done = settle;
      settle = null;
      setLeaving(true);
      setTimeout(done, LEAVE_MS);
    };

    finishRef.current = (found) =>
      new Promise<void>((resolve) => {
        // Model never arrived: don't hold the result hostage to an animation.
        if (!started) return resolve();
        outcome = found ? "found" : "missing";
        settle = resolve;
      });

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2a6a, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 6, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xb9a6ff, 1.6);
    rim.position.set(-5, 3, -4);
    scene.add(rim);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Framed for ~1.45 wide; back off on narrower stages so the walk-in stays in view.
      camera.position.set(-0.6, 3.2, 12 * Math.max(1, 1.45 / camera.aspect));
      camera.lookAt(-0.6, 1.9, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let model: THREE.Object3D | null = null;

    loadAxie()
      .then((gltf) => {
        if (disposed) return;
        const clip = gltf.animations.find((a) => a.name === "LoadingTreasureChest");
        if (!clip) return;
        model = gltf.scene;
        scene.add(model);

        const mixer = new THREE.AnimationMixer(model);
        let current = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
        current.clampWhenFinished = true;
        current.play();
        // A second action of the same clip lets the dig loop crossfade instead of snapping.
        let spare = mixer.clipAction(clip.clone()).setLoop(THREE.LoopOnce, 1);
        spare.clampWhenFinished = true;

        started = true;
        setReady(true);

        const clock = new THREE.Clock();
        const tick = () => {
          raf = requestAnimationFrame(tick);
          mixer.update(clock.getDelta() * SPEED);
          const t = current.time;
          if (outcome === "missing" && t >= LOOP_START) leave();
          else if (outcome === "found" && t >= REVEAL_END) leave();
          else if (outcome !== "found" && t >= LOOP_END) {
            spare.reset().play();
            spare.time = LOOP_START;
            current.crossFadeTo(spare, LOOP_FADE, false);
            [current, spare] = [spare, current];
          }
          renderer.render(scene, camera);
        };
        tick();
      })
      .catch(() => {
        // Lookup still works without the 3D scene; the caption stays up.
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      finishRef.current = null;
      settle?.();
      if (model) scene.remove(model);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [finishRef]);

  return (
    <div className={`icisco-chest-loader${leaving ? " is-leaving" : ""}`} role="status">
      <div ref={mountRef} className={`icisco-chest-stage${ready ? " is-ready" : ""}`} />
      <p className="icisco-chest-caption">
        Axie is digging through the chest for your ID
        <span className="icisco-chest-dots" aria-hidden="true" />
      </p>
    </div>
  );
}
