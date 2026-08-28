"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Image from "next/image";

function ScanForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenParam = searchParams.get("token");
  const badgeParam = searchParams.get("badge");
  const awardedByParam = searchParams.get("by");

  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [alreadyEarned, setAlreadyEarned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [tokenBadge, setTokenBadge] = useState("");
  const [tokenBy, setTokenBy] = useState("");

  const BADGE_NAMES: Record<string, string> = {
    "welcome-to-cisco": "Welcome to Cisco",
    "golden-alumni": "Golden Alumni",
  };

  const badge = tokenBadge || badgeParam || "";
  const awardedBy = tokenBy || awardedByParam || "";

  useEffect(() => {
    if (!tokenParam) {
      setTokenValid(true);
      return;
    }
    let cancelled = false;
    const validate = async () => {
      try {
        const res = await fetch(`/api/tokens?token=${encodeURIComponent(tokenParam)}`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setTokenBadge(data.badgeId ?? "");
          setTokenBy(data.awardedBy ?? "");
          setTokenValid(true);
        } else if (res.status === 410) {
          setTokenValid(false);
          setError("This QR code has already been used.");
        } else {
          setTokenValid(false);
          setError("Invalid QR code.");
        }
      } catch {
        if (!cancelled) {
          setTokenValid(false);
          setError("Failed to verify QR code.");
        }
      }
    };
    validate();
    return () => { cancelled = true; };
  }, [tokenParam]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setAlreadyEarned(false);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (res.status === 404) {
        setError("Email not found. Please check and try again.");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError("Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (badge && (data.badges ?? []).some((b: { badge_id: string }) => b.badge_id === badge)) {
        setAlreadyEarned(true);
        setLoading(false);
        return;
      }
      const params = new URLSearchParams({ email: trimmed });
      if (badge) params.set("awarded", badge);
      if (awardedBy) params.set("by", awardedBy);
      if (tokenParam) params.set("token", tokenParam);
      router.push(`/?${params.toString()}`);
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  };

  if (tokenValid === false) {
    return (
      <div className="scan-page">
        <div className="scan-card">
          <Image
            src="/cncp-logo-transparent.png"
            alt="CNCP Logo"
            width={72}
            height={50}
            className="scan-logo"
            draggable={false}
          />
          <h1 className="scan-title">Cisco NetConnect PUP &ndash; Manila</h1>
          <div className="scan-already-earned">
            <p className="scan-error">{error}</p>
            <p className="scan-already-earned-text">
              This QR code is no longer valid. Please ask for a new one.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scan-page">
      <div className="scan-card">
        <Image
          src="/cncp-logo-transparent.png"
          alt="CNCP Logo"
          width={72}
          height={50}
          className="scan-logo"
          draggable={false}
        />
        <h1 className="scan-title">Cisco NetConnect PUP &ndash; Manila</h1>
        <p className="scan-subtitle">
          Enter your email to claim your badge
        </p>
        <form onSubmit={handleSubmit} className="scan-form">
          {alreadyEarned ? (
            <div className="scan-already-earned">
              <p className="scan-already-earned-text">
                This user already has the <strong>{BADGE_NAMES[badge ?? ""] ?? "this"}</strong> badge!
              </p>
              <button
                type="button"
                className="scan-button"
                onClick={() => { setAlreadyEarned(false); setEmail(""); }}
              >
                Scan another email
              </button>
            </div>
          ) : (
            <>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.email@example.com"
                className="scan-input"
                autoFocus
                disabled={loading}
              />
              {error && <p className="scan-error">{error}</p>}
              <button
                type="submit"
                className="scan-button"
                disabled={loading}
              >
                {loading ? "Verifying..." : "Continue"}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

export default function ScanPage() {
  return (
    <Suspense fallback={null}>
      <ScanForm />
    </Suspense>
  );
}
