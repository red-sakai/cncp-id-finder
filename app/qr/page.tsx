"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import Image from "next/image";

const SESSION_KEY = "cncp-qr-auth";

const DEFAULT_BADGES: Badge[] = [
  {
    id: "welcome-to-cisco",
    name: "Welcome to Cisco",
    description: "Awarded to new members who join Cisco NetConnect PUP.",
    image_url: "/badges/welcome-to-cisco-badge.png",
    created_at: "",
  },
  {
    id: "golden-alumni",
    name: "Golden Alumni",
    description: "Awarded to distinguished alumni for their continued excellence.",
    image_url: "/badges/golden-alumni-badge.png",
    created_at: "",
  },
];

type Badge = {
  id: string;
  name: string;
  description: string;
  image_url: string;
  created_at: string;
};

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [badgesLoading, setBadgesLoading] = useState(true);
  const [qrUrl, setQrUrl] = useState("");
  const [selected, setSelected] = useState("");
  const [awardedBy, setAwardedBy] = useState("");
  const [token, setToken] = useState("");
  const [generating, setGenerating] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [tokens, setTokens] = useState<{ id: string; token: string; badge_id: string; awarded_by?: string; created_at: string }[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; badge_id: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Badge creation state
  const [showCreateBadge, setShowCreateBadge] = useState(false);
  const [newBadgeName, setNewBadgeName] = useState("");
  const [newBadgeDesc, setNewBadgeDesc] = useState("");
  const [newBadgeImage, setNewBadgeImage] = useState<string | null>(null);
  const [newBadgeImagePreview, setNewBadgeImagePreview] = useState<string | null>(null);
  const [badgeCreating, setBadgeCreating] = useState(false);
  const [badgeError, setBadgeError] = useState("");

  const badge = badges.find((b) => b.id === selected) ?? badges[0];
  const byParam = awardedBy.trim();
  const scanUrl = token
    ? `https://cncp-id-finder.vercel.app/scan?token=${token}`
    : "";

  const fetchBadges = async () => {
    setBadgesLoading(true);
    try {
      const res = await fetch("/api/badge-definitions");
      if (res.ok) {
        const data = await res.json();
        const custom = (data.badges ?? []) as Badge[];
        const merged = [...custom, ...DEFAULT_BADGES];
        setBadges(merged);
        if (merged.length > 0 && !selected) {
          setSelected(merged[0].id);
        }
      }
    } catch {
      // ignore
    } finally {
      setBadgesLoading(false);
    }
  };

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
    fetchBadges();
    fetchTokens();
  }, []);

  const handleBadgeImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBadgeError("");

    // Validate PNG
    if (file.type !== "image/png") {
      setBadgeError("Only PNG images are allowed.");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new window.Image();
      img.onload = () => {
        // Validate 1:1 aspect ratio
        if (img.width !== img.height) {
          setBadgeError(`Image must be 1:1 ratio. Yours is ${img.width}x${img.height}.`);
          e.target.value = "";
          return;
        }
        setNewBadgeImage(ev.target?.result as string);
        setNewBadgeImagePreview(ev.target?.result as string);
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleCreateBadge = async () => {
    setBadgeError("");
    if (!newBadgeName.trim()) {
      setBadgeError("Badge name is required.");
      return;
    }
    if (!newBadgeDesc.trim()) {
      setBadgeError("Badge description is required.");
      return;
    }
    if (!newBadgeImage) {
      setBadgeError("Badge image is required.");
      return;
    }

    setBadgeCreating(true);
    try {
      const res = await fetch("/api/badge-definitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newBadgeName.trim(),
          description: newBadgeDesc.trim(),
          imageData: newBadgeImage,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await fetchBadges();
        setSelected(data.id);
        setShowCreateBadge(false);
        setNewBadgeName("");
        setNewBadgeDesc("");
        setNewBadgeImage(null);
        setNewBadgeImagePreview(null);
      } else {
        const body = await res.json().catch(() => ({}));
        setBadgeError(body.error || "Failed to create badge.");
      }
    } catch {
      setBadgeError("Network error. Please try again.");
    } finally {
      setBadgeCreating(false);
    }
  };

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
    link.download = `cncp-${badge?.id ?? "badge"}-qr.png`;
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
            {/* QR Generator Section */}
            <div className="qr-section">
              <h2 className="qr-section-title">Generate QR Code</h2>
              <p className="qr-section-desc">Select a badge and enter the awardee name to generate a scannable QR code.</p>

              {badgesLoading ? (
                <div className="qr-empty-state">
                  <span className="qr-spinner" />
                </div>
              ) : (
                <div className="qr-badge-select">
                  {badges.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      className={`qr-badge-option ${selected === b.id ? "active" : ""}`}
                      onClick={() => { setSelected(b.id); handleReset(); }}
                      disabled={generating}
                    >
                      <Image src={b.image_url} alt={b.name} width={48} height={48} draggable={false} />
                      <span className="qr-badge-option-name">{b.name}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="qr-badge-option qr-badge-add"
                    onClick={() => setShowCreateBadge(true)}
                    disabled={generating}
                  >
                    <div className="qr-badge-add-icon">+</div>
                    <span className="qr-badge-option-name">Add Badge</span>
                  </button>
                </div>
              )}

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
                  disabled={generating || badges.length === 0}
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
            {/* Created QR Codes */}
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
                    const b = badges.find((badge) => badge.id === t.badge_id);
                    return (
                      <div key={t.id} className="qr-token-row">
                        <div className="qr-token-info">
                          {b?.image_url ? (
                            <Image src={b.image_url} alt="" width={28} height={28} className="qr-token-icon" draggable={false} />
                          ) : (
                            <div className="qr-token-icon qr-token-icon-placeholder" />
                          )}
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

      {/* Create Badge Modal */}
      {showCreateBadge && (
        <div className="qr-confirm-overlay" onClick={() => !badgeCreating && setShowCreateBadge(false)}>
          <div className="qr-confirm-box" onClick={(e) => e.stopPropagation()}>
            <p className="qr-confirm-title">Add New Badge</p>
            <p className="qr-confirm-desc">Create a new badge with an icon, name, and description.</p>

            <div className="qr-create-badge-form">
              <div className="qr-field">
                <label className="qr-field-label">Badge Icon</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png"
                  onChange={handleBadgeImageUpload}
                  className="qr-file-input"
                  disabled={badgeCreating}
                />
                {newBadgeImagePreview ? (
                  <div className="qr-badge-preview">
                    <Image src={newBadgeImagePreview} alt="Badge preview" width={64} height={64} draggable={false} />
                    <button
                      type="button"
                      className="qr-badge-preview-remove"
                      onClick={() => { setNewBadgeImage(null); setNewBadgeImagePreview(null); }}
                      disabled={badgeCreating}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="qr-btn qr-btn-secondary qr-btn-full"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={badgeCreating}
                  >
                    Choose PNG (1:1 ratio)
                  </button>
                )}
              </div>

              <div className="qr-field">
                <label className="qr-field-label" htmlFor="badge-name">Badge Name</label>
                <input
                  id="badge-name"
                  type="text"
                  value={newBadgeName}
                  onChange={(e) => setNewBadgeName(e.target.value)}
                  placeholder="e.g. Top Performer"
                  className="qr-input"
                  disabled={badgeCreating}
                />
              </div>

              <div className="qr-field">
                <label className="qr-field-label" htmlFor="badge-desc">Description</label>
                <textarea
                  id="badge-desc"
                  value={newBadgeDesc}
                  onChange={(e) => setNewBadgeDesc(e.target.value)}
                  placeholder="What is this badge for?"
                  className="qr-input qr-textarea"
                  rows={3}
                  disabled={badgeCreating}
                />
              </div>

              {badgeError && <p className="qr-error">{badgeError}</p>}
            </div>

            <div className="qr-confirm-actions">
              <button type="button" className="qr-btn qr-btn-ghost" onClick={() => setShowCreateBadge(false)} disabled={badgeCreating}>
                Cancel
              </button>
              <button type="button" className="qr-btn qr-btn-primary" onClick={handleCreateBadge} disabled={badgeCreating}>
                {badgeCreating ? (
                  <span className="qr-btn-loading">
                    <span className="qr-spinner" />
                    Creating...
                  </span>
                ) : (
                  "Create Badge"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete QR Confirmation Modal */}
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
              The <strong>{badges.find((b) => b.id === deleteTarget.badge_id)?.name ?? deleteTarget.badge_id}</strong> badge token will be permanently removed. This action cannot be undone.
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
