"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import Image from "next/image";

const SESSION_KEY = "cncp-qr-auth";
const BADGES = [
  {
    id: "welcome-to-cisco",
    name: "Welcome to Cisco",
    image: "/badges/welcome-to-cisco-badge.png",
  },
  {
    id: "golden-alumni",
    name: "Golden Alumni",
    image: "/badges/golden-alumni-badge.png",
  },
];

function getInitialAuth() {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(SESSION_KEY) === "ok";
}

export default function QRPage() {
  const [authenticated, setAuthenticated] = useState(getInitialAuth);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        sessionStorage.setItem(SESSION_KEY, "ok");
        setAuthenticated(true);
      } else {
        setLoginError("Invalid username or password.");
      }
    } catch {
      setLoginError("Network error. Please try again.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setAuthenticated(false);
    setUsername("");
    setPassword("");
  };

  if (!authenticated) {
    return (
      <div className="qr-page">
        <div className="qr-card">
          <Image
            src="/cncp-logo-transparent.png"
            alt="CNCP Logo"
            width={56}
            height={39}
            className="qr-logo"
            draggable={false}
          />
          <h1 className="qr-title">Badge QR Generator</h1>
          <p className="qr-subtitle">Log in to access the QR generator.</p>
          <form onSubmit={handleLogin} className="scan-form">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className="scan-input"
              autoFocus
              disabled={loginLoading}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="scan-input"
              disabled={loginLoading}
            />
            {loginError && <p className="scan-error">{loginError}</p>}
            <button
              type="submit"
              className="scan-button"
              disabled={loginLoading}
            >
              {loginLoading ? "Logging in..." : "Log in"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <QRGenerator onLogout={handleLogout} />;
}

function QRGenerator({ onLogout }: { onLogout: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [selected, setSelected] = useState(BADGES[0].id);
  const [awardedBy, setAwardedBy] = useState("");
  const [token, setToken] = useState("");
  const [generating, setGenerating] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const badge = BADGES.find((b) => b.id === selected) ?? BADGES[0];
  const byParam = awardedBy.trim();
  const scanUrl = token
    ? `https://cncp-id-finder.vercel.app/scan?token=${token}`
    : "";

  const handleConfirm = async () => {
    setGenerating(true);
    setToken("");
    setConfirmed(false);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          badgeId: badge.id,
          awardedBy: byParam || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        setConfirmed(true);
      }
    } catch {
      // ignore
    } finally {
      setGenerating(false);
    }
  };

  const handleReset = () => {
    setToken("");
    setConfirmed(false);
    setQrUrl("");
  };

  useEffect(() => {
    if (!token) return;
    QRCode.toCanvas(canvasRef.current, scanUrl, {
      width: 256,
      margin: 2,
      color: { dark: "#1a2a3a", light: "#ffffff" },
    });
    QRCode.toDataURL(scanUrl, {
      width: 256,
      margin: 2,
      color: { dark: "#1a2a3a", light: "#ffffff" },
    }).then(setQrUrl);
  }, [scanUrl, token]);

  const handleDownload = () => {
    if (!qrUrl) return;
    const link = document.createElement("a");
    link.download = `cncp-${badge.id}-qr.png`;
    link.href = qrUrl;
    link.click();
  };

  return (
    <div className="qr-page">
      <div className="qr-card">
        <div className="qr-top-bar">
          <Image
            src="/cncp-logo-transparent.png"
            alt="CNCP Logo"
            width={40}
            height={28}
            draggable={false}
          />
          <button
            type="button"
            className="qr-logout"
            onClick={onLogout}
          >
            Log out
          </button>
        </div>
        <h1 className="qr-title">Badge QR Generator</h1>
        <p className="qr-subtitle">
          Select a badge, enter the awardee name, and confirm to generate.
        </p>

        <div className="qr-badge-select">
          {BADGES.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`qr-badge-option ${selected === b.id ? "active" : ""}`}
              onClick={() => { setSelected(b.id); handleReset(); }}
              disabled={generating}
            >
              <Image
                src={b.image}
                alt={b.name}
                width={40}
                height={40}
                draggable={false}
              />
              <span>{b.name}</span>
            </button>
          ))}
        </div>

        <div className="qr-awarded-by">
          <label className="qr-awarded-label" htmlFor="awarded-by">
            Awarded by
          </label>
          <input
            id="awarded-by"
            type="text"
            value={awardedBy}
            onChange={(e) => setAwardedBy(e.target.value)}
            placeholder="Your name"
            className="scan-input"
            disabled={generating || confirmed}
          />
        </div>

        {!confirmed ? (
          <button
            type="button"
            className="qr-download"
            onClick={handleConfirm}
            disabled={generating}
          >
            {generating ? "Generating..." : "Confirm & Generate QR"}
          </button>
        ) : (
          <>
            <div className="qr-preview">
              <canvas ref={canvasRef} className="qr-canvas" />
            </div>

            <p className="qr-url">{scanUrl}</p>

            <p className="qr-single-use">This QR code is ready to use. Each person who scans it gets their own badge.</p>

            <div className="qr-actions">
              <button
                type="button"
                className="qr-download"
                onClick={handleDownload}
                disabled={!qrUrl}
              >
                Download QR Code
              </button>
              <button
                type="button"
                className="qr-download qr-download-secondary"
                onClick={handleReset}
              >
                Generate New QR
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
