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
        <div className="qr-login-card">
          <div className="qr-login-logo-wrap">
            <Image
              src="/cncp-logo-transparent.png"
              alt="CNCP Logo"
              width={64}
              height={45}
              className="qr-logo"
              draggable={false}
            />
          </div>
          <h1 className="qr-title">Badge QR Generator</h1>
          <p className="qr-subtitle">Log in to access the QR generator.</p>
          <form onSubmit={handleLogin} className="qr-login-form">
            <div className="qr-input-group">
              <label className="qr-input-label">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                className="qr-input"
                autoFocus
                disabled={loginLoading}
              />
            </div>
            <div className="qr-input-group">
              <label className="qr-input-label">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="qr-input"
                disabled={loginLoading}
              />
            </div>
            {loginError && <p className="qr-error">{loginError}</p>}
            <button
              type="submit"
              className="qr-btn qr-btn-primary qr-btn-full"
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
  const [tokens, setTokens] = useState<{ id: string; token: string; badge_id: string; awarded_by?: string; created_at: string }[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; badge_id: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const badge = BADGES.find((b) => b.id === selected) ?? BADGES[0];
  const byParam = awardedBy.trim();
  const scanUrl = token
    ? `https://cncp-id-finder.vercel.app/scan?token=${token}`
    : "";

  const fetchTokens = async () => {
    setTokensLoading(true);
    try {
      const res = await fetch("/api/tokens");
      if (res.ok) {
        const data = await res.json();
        setTokens(data.tokens ?? []);
      }
    } catch {
      // ignore
    } finally {
      setTokensLoading(false);
    }
  };

  useEffect(() => {
    fetchTokens();
  }, []);

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
        fetchTokens();
      }
    } catch {
      // ignore
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      if (res.ok) {
        setTokens((prev) => prev.filter((t) => t.id !== deleteTarget.id));
        setDeleteTarget(null);
      }
    } catch {
      // ignore
    } finally {
      setDeleting(false);
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
      <div className="qr-admin-layout">
        <header className="qr-admin-header">
          <div className="qr-admin-header-left">
            <Image
              src="/cncp-logo-transparent.png"
              alt="CNCP Logo"
              width={32}
              height={22}
              draggable={false}
            />
            <span className="qr-admin-header-title">QR Admin</span>
          </div>
          <button type="button" className="qr-btn qr-btn-ghost" onClick={onLogout}>
            Log out
          </button>
        </header>

        <div className="qr-admin-body">
          <div className="qr-admin-main">
            <div className="qr-section">
              <h2 className="qr-section-title">Generate QR Code</h2>
              <p className="qr-section-desc">Select a badge and enter the awardee name to generate a scannable QR code.</p>

              <div className="qr-badge-select">
                {BADGES.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={`qr-badge-option ${selected === b.id ? "active" : ""}`}
                    onClick={() => { setSelected(b.id); handleReset(); }}
                    disabled={generating}
                  >
                    <Image src={b.image} alt={b.name} width={48} height={48} draggable={false} />
                    <span className="qr-badge-option-name">{b.name}</span>
                  </button>
                ))}
              </div>

              <div className="qr-field">
                <label className="qr-field-label" htmlFor="awarded-by">Awarded by</label>
                <input
                  id="awarded-by"
                  type="text"
                  value={awardedBy}
                  onChange={(e) => setAwardedBy(e.target.value)}
                  placeholder="Your name"
                  className="qr-input"
                  disabled={generating || confirmed}
                />
              </div>

              {!confirmed ? (
                <button
                  type="button"
                  className="qr-btn qr-btn-primary qr-btn-full"
                  onClick={handleConfirm}
                  disabled={generating}
                >
                  {generating ? (
                    <span className="qr-btn-loading">
                      <span className="qr-spinner" />
                      Generating...
                    </span>
                  ) : (
                    "Generate QR Code"
                  )}
                </button>
              ) : (
                <div className="qr-result">
                  <div className="qr-preview">
                    <canvas ref={canvasRef} className="qr-canvas" />
                  </div>
                  <p className="qr-url">{scanUrl}</p>
                  <p className="qr-single-use">Each person who scans this QR code gets their own badge.</p>
                  <div className="qr-actions">
                    <button type="button" className="qr-btn qr-btn-primary" onClick={handleDownload} disabled={!qrUrl}>
                      Download QR
                    </button>
                    <button type="button" className="qr-btn qr-btn-secondary" onClick={handleReset}>
                      Generate New
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <aside className="qr-admin-sidebar">
            <div className="qr-section">
              <div className="qr-section-header">
                <h2 className="qr-section-title">Created QR Codes</h2>
                <span className="qr-badge-count">{tokens.length}</span>
              </div>
              <p className="qr-section-desc">Manage existing badge QR codes.</p>

              {tokensLoading ? (
                <div className="qr-empty-state">
                  <span className="qr-spinner" />
                </div>
              ) : tokens.length === 0 ? (
                <div className="qr-empty-state">
                  <p className="qr-empty-text">No QR codes created yet.</p>
                </div>
              ) : (
                <div className="qr-tokens-list">
                  {tokens.map((t) => {
                    const b = BADGES.find((badge) => badge.id === t.badge_id);
                    return (
                      <div key={t.id} className="qr-token-row">
                        <div className="qr-token-info">
                          <Image src={b?.image ?? ""} alt="" width={28} height={28} className="qr-token-icon" draggable={false} />
                          <div className="qr-token-details">
                            <span className="qr-token-name">{b?.name ?? t.badge_id}</span>
                            <span className="qr-token-meta">
                              {t.awarded_by ? `by ${t.awarded_by}` : "No awardee"}
                              <span className="qr-token-dot">&#183;</span>
                              {new Date(t.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="qr-token-delete-btn"
                          onClick={() => setDeleteTarget({ id: t.id, badge_id: t.badge_id })}
                          title="Delete QR code"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      {deleteTarget && (
        <div className="qr-confirm-overlay" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="qr-confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="qr-confirm-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p className="qr-confirm-title">Delete QR Code?</p>
            <p className="qr-confirm-desc">
              The <strong>{BADGES.find((b) => b.id === deleteTarget.badge_id)?.name ?? deleteTarget.badge_id}</strong> badge token will be permanently removed. This action cannot be undone.
            </p>
            <div className="qr-confirm-actions">
              <button type="button" className="qr-btn qr-btn-ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </button>
              <button type="button" className="qr-btn qr-btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
