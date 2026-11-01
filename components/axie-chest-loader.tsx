"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Clip seconds in LoadingTreasureChest: walk in + lid opens until ~4.9,
// steady digging 4.9-6.4, card pops out and is held up until ~9.2.
const LOOP_START = 4.9;
const LOOP_END = 6.4;
const REVEAL_END = 9.2;
const SPEED = 1.3;
const LOOP_FADE = 0.3;
const LEAVE_MS = 350;
// Result is back but the model is still downloading: wait this long, then show the result anyway.
const MODEL_WAIT_MS = 8000;

type Stage = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  mixer: THREE.AnimationMixer;
  actions: [THREE.AnimationAction, THREE.AnimationAction];
};

let stagePromise: Promise<Stage> | null = null;

// One renderer for every search: a fresh WebGL context per lookup meant
// re-uploading the mesh and recompiling every shader, which froze the tablet.
export function prepareAxie(): Promise<Stage> {
  if (stagePromise) return stagePromise;
  stagePromise = (async () => {
    // Stripped copy of axie.glb with only the LoadingTreasureChest clip.
    const gltf = await new GLTFLoader().loadAsync("/rebranding/3d-models/axie-chest.glb");
    const clip = gltf.animations[0];

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2a6a, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 6, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xb9a6ff, 1.6);
    rim.position.set(-5, 3, -4);
    scene.add(rim);
    scene.add(gltf.scene);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    // Two actions of the same clip let the dig loop crossfade instead of snapping.
    const actions: Stage["actions"] = [
      mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1),
      mixer.clipAction(clip.clone()).setLoop(THREE.LoopOnce, 1),
    ];
    actions.forEach((a) => (a.clampWhenFinished = true));

    // Compile shaders and upload buffers now, before anyone is waiting on a search.
    await renderer.compileAsync(scene, camera);
    return { renderer, scene, camera, mixer, actions };
  })();
  stagePromise.catch(() => { stagePromise = null; });
  return stagePromise;
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
    let giveUp = 0;
    let stage: Stage | null = null;
    let failed = false;

    const leave = (delay = LEAVE_MS) => {
      if (!settle) return;
      const done = settle;
      settle = null;
      setLeaving(true);
      setTimeout(done, delay);
    };

    finishRef.current = (found) =>
      new Promise<void>((resolve) => {
        if (failed) return resolve();
        outcome = found ? "found" : "missing";
        settle = resolve;
        // Model still loading: keep waiting so the animation still plays, but not forever.
        if (!stage) giveUp = window.setTimeout(() => leave(0), MODEL_WAIT_MS);
      });

    const resize = () => {
      if (!stage) return;
      const { clientWidth: w, clientHeight: h } = mount;
      if (!w || !h) return;
      const { renderer, camera } = stage;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Framed for ~1.45 wide; back off on narrower stages so the walk-in stays in view.
      camera.position.set(-0.6, 3.2, 12 * Math.max(1, 1.45 / camera.aspect));
      camera.lookAt(-0.6, 1.9, 0);
    };
    const ro = new ResizeObserver(resize);

    prepareAxie()
      .then((s) => {
        if (disposed) return;
        clearTimeout(giveUp);
        stage = s;
        const { renderer, scene, camera, mixer } = s;
        let [current, spare] = s.actions;
        mixer.stopAllAction();
        current.reset().play();

        mount.appendChild(renderer.domElement);
        resize();
        ro.observe(mount);
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
        // Lookup still works without the 3D scene.
        failed = true;
        clearTimeout(giveUp);
        leave(0);
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(giveUp);
      ro.disconnect();
      finishRef.current = null;
      settle?.();
      stage?.renderer.domElement.remove();
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
