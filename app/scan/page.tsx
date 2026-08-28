"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Image from "next/image";

function ScanForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const badge = searchParams.get("badge");
  const awardedBy = searchParams.get("by");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
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
      const params = new URLSearchParams({ email: trimmed });
      if (badge) params.set("awarded", badge);
      if (awardedBy) params.set("by", awardedBy);
      router.push(`/?${params.toString()}`);
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  };

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
