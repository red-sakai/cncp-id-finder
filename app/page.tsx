"use client";

import Image from "next/image";
import Link from "next/link";
import Lenis from "lenis";
import { useEffect, useRef, useState, useSyncExternalStore, Suspense } from "react";
import IciscoScene from "@/components/icisco-scene";

const EXTEND_INDICES = [1, 2, 3, 5, 6, 7];
const DOT_LEVELS = [
  "small",
  "medium",
  "tall",
  "medium",
  "small",
  "medium",
  "tall",
  "medium",
  "small",
];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20250825);

const STARS = Array.from({ length: 90 }, () => ({
  left: rand() * 100,
  top: rand() * 64,
  size: 1 + rand() * 2.2,
  delay: (rand() * 6).toFixed(2),
  duration: (2.4 + rand() * 4).toFixed(2),
}));

const SHOOTING_STARS = [
  { left: "72%", top: "10%", delay: "0.8s", duration: "5s" },
  { left: "38%", top: "4%", delay: "2.2s", duration: "6s" },
  { left: "86%", top: "26%", delay: "3.4s", duration: "4.5s" },
  { left: "55%", top: "16%", delay: "4.6s", duration: "5.5s" },
  { left: "20%", top: "8%", delay: "1.5s", duration: "6.5s" },
];

const PUFFS = [
  { top: "16%", width: 190, height: 52, duration: "16s", delay: "-4s", opacity: 0.8, reverse: false },
  { top: "40%", width: 270, height: 72, duration: "22s", delay: "-9s", opacity: 0.6, reverse: true },
  { top: "6%", width: 150, height: 42, duration: "14s", delay: "-7s", opacity: 0.9, reverse: false },
  { top: "30%", width: 220, height: 60, duration: "19s", delay: "-13s", opacity: 0.7, reverse: true },
];

const BUILDINGS = Array.from({ length: 14 }, () => {
  const w = 3.5 + rand() * 5.5;
  const h = 22 + rand() * 55;
  const cols = Math.max(2, Math.round(w / 1.7));
  const rows = Math.max(3, Math.round(h / 8));
  const windows: { x: number; y: number; lit: boolean; delay: string }[] = [];
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      if (rand() < 0.62) {
        windows.push({
          x: 14 + (c * 72) / Math.max(1, cols - 1),
          y: 8 + (r * 78) / Math.max(1, rows - 1),
          lit: rand() < 0.72,
          delay: (rand() * 2.6).toFixed(2),
        });
      }
    }
  }
  return { w, h, windows };
});

function Logo() {
  return (
    <Link href="/" className="logo">
      <Image
        src="/cncp-logo.jpg"
        alt="CNCP Logo"
        className="logo-badge"
        width={36}
        height={36}
        priority
      />
      <span className="logo-text">
        Cisco NetConnect
        <span className="logo-subline">PUP - Manila</span>
      </span>
    </Link>
  );
}

function ThemeToggle({
  isNight,
  onToggle,
}: {
  isNight: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-pressed={isNight}
      aria-label={isNight ? "Switch to light mode" : "Switch to dark mode"}
      title={isNight ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span className="theme-toggle-icon" key={isNight ? "moon" : "sun"}>
        {isNight ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[18px] w-[18px]">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[18px] w-[18px]">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
          </svg>
        )}
      </span>
    </button>
  );
}

function Nav({
  isNight,
  onToggleTheme,
}: {
  isNight: boolean;
  onToggleTheme: () => void;
}) {
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) {
      return;
    }

    const onScroll = () => {
      nav.classList.toggle("scrolled", window.scrollY > 12);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <nav className="nav" ref={navRef}>
      <div className="nav-inner">
        <Logo />
        <div className="nav-links">
          <a className="nav-link" href="#platform">
            Home
          </a>
          <a className="nav-link" href="#contact">
            Contact
          </a>
        </div>
        <div className="nav-cta">
          <ThemeToggle isNight={isNight} onToggle={onToggleTheme} />
          <a className="btn btn-primary" href="#contact">
            Contact us
          </a>
        </div>
      </div>
    </nav>
  );
}

function Hero({
  isNight,
  isReady,
  onStart,
}: {
  isNight: boolean;
  isReady: boolean;
  onStart: () => void;
}) {
  const [isIntroReady, setIsIntroReady] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const heroBgRef = useRef<HTMLDivElement>(null);
  const pointerStateRef = useRef({
    targetX: 0,
    targetY: 0,
    targetScroll: 0,
    currentX: 0,
    currentY: 0,
    currentScroll: 0,
  });

  useEffect(() => {
    const heroBg = heroBgRef.current;
    if (!heroBg) {
      return;
    }

    let rafId = 0;
    const animate = () => {
      const pointer = pointerStateRef.current;
      pointer.currentX += (pointer.targetX - pointer.currentX) * 0.08;
      pointer.currentY += (pointer.targetY - pointer.currentY) * 0.08;
      pointer.currentScroll += (pointer.targetScroll - pointer.currentScroll) * 0.08;

      heroBg.style.setProperty("--parallax-x", `${pointer.currentX.toFixed(2)}px`);
      heroBg.style.setProperty("--parallax-y", `${pointer.currentY.toFixed(2)}px`);
      heroBg.style.setProperty("--parallax-scroll", `${pointer.currentScroll.toFixed(2)}px`);

      rafId = window.requestAnimationFrame(animate);
    };

    rafId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      setIsIntroReady(true);
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [isReady]);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) {
      return;
    }

    const updateScrollParallax = () => {
      const rect = hero.getBoundingClientRect();
      const viewportHeight = Math.max(window.innerHeight, 1);
      const heroCenterOffset = rect.top + rect.height / 2 - viewportHeight / 2;
      const normalizedOffset = Math.max(
        -1,
        Math.min(1, heroCenterOffset / (viewportHeight * 0.85))
      );

      pointerStateRef.current.targetScroll = normalizedOffset * -130;
    };

    updateScrollParallax();
    window.addEventListener("scroll", updateScrollParallax, { passive: true });
    window.addEventListener("resize", updateScrollParallax);

    return () => {
      window.removeEventListener("scroll", updateScrollParallax);
      window.removeEventListener("resize", updateScrollParallax);
    };
  }, []);

  const handlePointerMove: React.PointerEventHandler<HTMLElement> = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;

    pointerStateRef.current.targetX = x * 56;
    pointerStateRef.current.targetY = y * 44;
  };

  const resetPointer = () => {
    pointerStateRef.current.targetX = 0;
    pointerStateRef.current.targetY = 0;
  };

  return (
    <section
      className={`hero${isIntroReady ? " hero-intro-ready" : ""}`}
      id="platform"
      ref={heroRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
      onPointerCancel={resetPointer}
    >
      <div className="hero-bg" aria-hidden="true" ref={heroBgRef}>
        <div className={`hero-flip${isNight ? " is-night" : ""}`}>
          <div className="hero-face hero-face-day">
            <div className="sky sky-day" />
            <span className="sun" />
            <div className="cloud-parallax">
              <span className="sky-cloud" style={{ left: "6%", top: "56%", width: 260, height: 72 }} />
              <span className="sky-cloud" style={{ right: "5%", top: "66%", width: 330, height: 86 }} />
              {PUFFS.map((puff, i) => (
                <span
                  key={i}
                  className="hero-cloud-puff"
                  style={{
                    top: puff.top,
                    width: `${puff.width}px`,
                    height: `${puff.height}px`,
                    animationDirection: puff.reverse ? "reverse" : "normal",
                    ["--puff-dur" as string]: puff.duration,
                    ["--puff-delay" as string]: puff.delay,
                    ["--puff-op" as string]: puff.opacity,
                  }}
                />
              ))}
            </div>
          </div>
          <div className="hero-face hero-face-night">
            <div className="sky sky-night" />
            <span className="moon" />
            <div className="hero-stars">
              {STARS.map((star, i) => (
                <span
                  key={i}
                  className="star"
                  style={{
                    left: `${star.left}%`,
                    top: `${star.top}%`,
                    width: `${star.size}px`,
                    height: `${star.size}px`,
                    ["--tw-delay" as string]: `${star.delay}s`,
                    ["--tw-dur" as string]: `${star.duration}s`,
                  }}
                />
              ))}
              {SHOOTING_STARS.map((ss, i) => (
                <span
                  key={`ss-${i}`}
                  className="shooting-star"
                  style={{
                    left: ss.left,
                    top: ss.top,
                    ["--ss-delay" as string]: ss.delay,
                    ["--ss-dur" as string]: ss.duration,
                  }}
                />
              ))}
            </div>
          </div>
          <div className="skyline" aria-hidden="true">
            {BUILDINGS.map((b, i) => (
              <span key={i} className="building" style={{ width: `${b.w}%`, height: `${b.h}%` }}>
                {b.windows.map((win, j) => (
                  <span
                    key={j}
                    className={`window${win.lit ? " lit" : ""}`}
                    style={{
                      left: `${win.x}%`,
                      top: `${win.y}%`,
                      ["--w-delay" as string]: `${win.delay}s`,
                    }}
                  />
                ))}
              </span>
            ))}
          </div>
          <span className="hero-layer hero-bridge" />
        </div>
      </div>
      <div className="hero-content">
        <div className="hero-text">
          <h1>
            Your network <br />
            <em>starts now.</em>
          </h1>
          <p className="hero-lede">
            Say hello to the iCisco &mdash; click it to start your journey with
            Cisco NetConnect PUP &ndash; Manila, the student-led tech community
            where future IT professionals learn, connect, and grow.
          </p>
          <button type="button" className="btn btn-primary" onClick={onStart}>
            Click me to get started
          </button>
        </div>
      </div>
    </section>
  );
}

const SOCIALS = [
  {
    label: "Email",
    href: "mailto:pupcisconetconmain@gmail.com",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </svg>
    ),
  },
  {
    label: "Facebook",
    href: "#contact",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
      </svg>
    ),
  },
  {
    label: "GitHub",
    href: "#contact",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
        <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
        <path d="M9 18c-4.51 2-5-2-7-2" />
      </svg>
    ),
  },
];

function Footer() {
  return (
    <footer className="footer" id="contact">
      <div className="footer-inner">
        <div className="footer-brand">
          <Logo />
          <p>
            A student-led tech community empowering future network and IT professionals
            through hands-on learning, mentorship, and industry connections.
          </p>
          <div className="footer-socials">
            {SOCIALS.map((social) => (
              <a key={social.label} href={social.href} aria-label={social.label}>
                {social.icon}
              </a>
            ))}
          </div>
        </div>

        <div className="footer-col">
          <h3>Community</h3>
          <ul>
            <li>
              <Link href="/">Home</Link>
            </li>
            <li>
              <a href="https://www.netacad.com" target="_blank" rel="noreferrer">
                Cisco Networking Academy
              </a>
            </li>
            <li>
              <a href="https://www.cisco.com" target="_blank" rel="noreferrer">
                Cisco.com
              </a>
            </li>
          </ul>
        </div>

        <div className="footer-col">
          <h3>Contact</h3>
          <ul>
            <li>
              <a href="mailto:pupcisconetconmain@gmail.com">pupcisconetconmain@gmail.com</a>
            </li>
            <li>
              <span>PUP Manila Main Campus</span>
            </li>
            <li>
              <span>Anonas St, Sta. Mesa, Manila</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="footer-legal">
        <span>&copy; {new Date().getFullYear()} Cisco NetConnect PUP - Manila. All rights reserved.</span>
        <div className="footer-legal-links">
          <a href="#contact">Privacy Notice</a>
          <a href="#contact">Terms of Use</a>
        </div>
      </div>
    </footer>
  );
}

const THEME_KEY = "cncp-theme";

function subscribeTheme(onChange: () => void) {
  window.addEventListener("cncp-theme-change", onChange);
  return () => window.removeEventListener("cncp-theme-change", onChange);
}

function getThemeSnapshot() {
  return window.localStorage.getItem(THEME_KEY) === "night";
}

function getThemeServerSnapshot() {
  return false;
}

function useTheme() {
  const isNight = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeServerSnapshot
  );

  const toggleTheme = () => {
    const next = !(window.localStorage.getItem(THEME_KEY) === "night");
    window.localStorage.setItem(THEME_KEY, next ? "night" : "day");
    window.dispatchEvent(new Event("cncp-theme-change"));
  };

  return [isNight, toggleTheme] as const;
}

export default function Home() {
  const [isLoading, setIsLoading] = useState(true);
  const [isNight, toggleTheme] = useTheme();
  const [iciscoActive, setIciscoActive] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [extendedIndices, setExtendedIndices] = useState<number[]>([]);

  const handleStart = () => setIciscoActive(true);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isNight);
    document.documentElement.style.colorScheme = isNight ? "dark" : "light";
  }, [isNight]);

  useEffect(() => {
    const lenis = new Lenis({
      lerp: 0.08,
      smoothWheel: true,
    });

    const handleAnchorClick = (event: Event) => {
      const target = event.currentTarget as HTMLAnchorElement | null;
      const href = target?.getAttribute("href");

      if (!href || !href.startsWith("#")) {
        return;
      }

      const section = document.querySelector<HTMLElement>(href);
      if (!section) {
        return;
      }

      event.preventDefault();
      lenis.scrollTo(section, { offset: -80 });
    };

    const anchors = Array.from(document.querySelectorAll('a[href^="#"]'));
    anchors.forEach((anchor) => anchor.addEventListener("click", handleAnchorClick));

    let rafId = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = window.requestAnimationFrame(raf);
    };

    rafId = window.requestAnimationFrame(raf);

    return () => {
      anchors.forEach((anchor) => anchor.removeEventListener("click", handleAnchorClick));
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      lenis.destroy();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsLoading(false);
    }, 2500);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!isLoading) {
      return;
    }

    const interval = window.setInterval(() => {
      setActiveIndex((prev) => {
        const next = prev + 1;

        if (EXTEND_INDICES.includes(next)) {
          setExtendedIndices((current) =>
            current.includes(next) ? current : [...current, next]
          );
        }

        if (next >= 9) {
          setExtendedIndices([]);
          return 0;
        }

        return next;
      });
    }, 140);

    return () => {
      window.clearInterval(interval);
    };
  }, [isLoading]);

  return (
    <>
      <div
        className={`loader${isLoading ? "" : " hidden"}`}
        aria-hidden={!isLoading}
        role="status"
        aria-live="polite"
      >
        <div className="loader-mark" role="img" aria-label="Cisco-style loading mark">
          {Array.from({ length: 9 }).map((_, index) => (
            <span
              key={index}
              className={`loader-dot${activeIndex === index ? " is-active" : ""}`}
              data-extend={EXTEND_INDICES.includes(index) ? "true" : "false"}
              data-extended={extendedIndices.includes(index) ? "true" : "false"}
              data-level={DOT_LEVELS[index]}
            />
          ))}
        </div>
      </div>

      <main className={`landing${isLoading ? " is-loading" : ""}`}>
        <Nav isNight={isNight} onToggleTheme={toggleTheme} />
        <div className="shell">
          <Hero isNight={isNight} isReady={!isLoading} onStart={handleStart} />
        </div>
        <Footer />
        {!iciscoActive && (
          <button
            type="button"
            className="icisco-badge"
            onClick={handleStart}
            title="iCisco"
            aria-label="iCisco"
          >
            <span className="icisco-wave">
              <Image src="/icisco.png" alt="iCisco" width={110} height={110} className="icisco-img" />
            </span>
          </button>
        )}
        {iciscoActive && (
          <Suspense fallback={null}>
            <IciscoScene onDismiss={() => setIciscoActive(false)} />
          </Suspense>
        )}
      </main>
    </>
  );
}
