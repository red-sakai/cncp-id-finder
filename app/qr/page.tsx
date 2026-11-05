"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import Image from "next/image";

const SESSION_KEY = "cncp-qr-auth";

// Mirrors the server-side limits in app/api/tokens/route.ts
const MAX_CISCOINS = 100000;
const MAX_CLAIMS = 100000;
const MAX_REQUIREMENT = 200;

type Badge = {
  id: string;
  name: string;
  description: string;
  image_url: string;
  created_at: string;
};

type Token = {
  id: string;
  token: string;
  badge_id: string;
  awarded_by?: string;
  created_at: string;
  expires_at?: string | null;
  expired?: boolean;
  ciscoins?: number | null;
  single_use?: boolean;
  claimed_at?: string | null;
  max_claims?: number | null;
  requires_approval?: boolean;
  requirement?: string | null;
  claimed_count?: number;
  pending_count?: number;
};

type ClaimRequest = {
  id: string;
  token_id: string;
  email: string;
  created_at: string;
};

type ClaimRule = {
  singleUse: boolean;
  maxClaims: number | null;
  requiresApproval: boolean;
  requirement: string | null;
};

function isExpired(t: Token) {
  return !!t.expires_at && new Date(t.expires_at).getTime() <= Date.now();
}

function claimRuleNotes({ singleUse, maxClaims, requiresApproval, requirement }: ClaimRule) {
  const notes = [
    singleUse
      ? requiresApproval
        ? "One time claim only. The first person you approve uses this QR code up."
        : "One time claim only. The first person to claim it uses this QR code up."
      : maxClaims
        ? `Limited to ${maxClaims.toLocaleString("en-US")} ${maxClaims === 1 ? "person" : "people"}. Each person can claim once.`
        : "Permanently available. Anyone can scan this QR code and claim it.",
  ];
  if (requiresApproval) notes.push("You approve each claim before anything is granted.");
  if (requirement) notes.push(`Requirement: ${requirement}`);
  return notes;
}

function claimStatus(t: Token) {
  const pending = t.pending_count ?? 0;
  const waiting = pending > 0 ? `, ${pending} waiting` : "";
  if (t.single_use) {
    return t.claimed_at
      ? { label: "Used up", used: true }
      : { label: `One time claim${waiting}`, used: false };
  }
  if (t.max_claims) {
    const claimed = t.claimed_count ?? 0;
    return {
      label: `${claimed} of ${t.max_claims} claimed${waiting}`,
      used: claimed >= t.max_claims,
    };
  }
  return null;
}

type ShopItem = {
  id: string;
  name: string;
  description: string;
  image_url: string;
  price: number;
  active: boolean;
  sort_order: number;
};

type ShopPurchase = {
  email: string;
  amount: number;
  item_id: string | null;
  item_name: string;
  created_at: string;
};

type ShopDraft = { name: string; price: string; active: boolean };

// Mirrors the server limits in app/api/shop/route.ts
const MAX_SHOP_PRICE = 100000;

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
    fetch("/api/auth/login", { method: "DELETE" }).catch(() => {});
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
              src="/rebranding/logos/cncp-purple-logo.png"
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
  const [expiryDate, setExpiryDate] = useState("");
  const [noExpiry, setNoExpiry] = useState(true);
  const [attachCiscoins, setAttachCiscoins] = useState(false);
  const [ciscoinsAmount, setCiscoinsAmount] = useState("");
  const [claimMode, setClaimMode] = useState<"" | "once" | "limited" | "always">("");
  const [claimLimit, setClaimLimit] = useState("");
  const [requireApproval, setRequireApproval] = useState(false);
  const [requirement, setRequirement] = useState("");
  const [grantedCiscoins, setGrantedCiscoins] = useState<number | null>(null);
  const [grantedRule, setGrantedRule] = useState<ClaimRule | null>(null);
  const [token, setToken] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; badge_id: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Claims waiting for an admin
  const [claims, setClaims] = useState<ClaimRequest[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [claimsError, setClaimsError] = useState("");
  const [claimBusyId, setClaimBusyId] = useState<string | null>(null);
  const [claimRowError, setClaimRowError] = useState<{ id: string; text: string } | null>(null);

  // Badge creation state
  const [showCreateBadge, setShowCreateBadge] = useState(false);
  const [newBadgeName, setNewBadgeName] = useState("");
  const [newBadgeDesc, setNewBadgeDesc] = useState("");
  const [newBadgeImage, setNewBadgeImage] = useState<string | null>(null);
  const [newBadgeImagePreview, setNewBadgeImagePreview] = useState<string | null>(null);
  const [badgeCreating, setBadgeCreating] = useState(false);
  const [badgeError, setBadgeError] = useState("");

  // Shop: prices are edited here so the migration never has to change
  const [shopItems, setShopItems] = useState<ShopItem[]>([]);
  const [shopLoading, setShopLoading] = useState(true);
  const [shopSavingId, setShopSavingId] = useState<string | null>(null);
  const [shopDrafts, setShopDrafts] = useState<Record<string, ShopDraft>>({});
  const [shopStatus, setShopStatus] = useState<
    { id: string; kind: "error" | "ok"; text: string } | null
  >(null);
  const [purchases, setPurchases] = useState<ShopPurchase[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(true);

  const badge = badges.find((b) => b.id === selected) ?? badges[0];
  const byParam = awardedBy.trim();
  const viewed = tokens.find((t) => t.id === viewingId) ?? null;
  const scanUrl = token
    ? `https://cncp-id-finder.vercel.app/scan?token=${token}`
    : "";

  const fetchBadges = async () => {
    setBadgesLoading(true);
    try {
      const res = await fetch("/api/badge-definitions");
      if (res.ok) {
        const data = await res.json();
        const fromDb = (data.badges ?? []) as Badge[];
        setBadges(fromDb);
        if (fromDb.length > 0 && !selected) {
          setSelected(fromDb[0].id);
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
        setTokens(
          ((data.tokens ?? []) as Token[]).map((t) => ({ ...t, expired: isExpired(t) }))
        );
      }
    } catch {
      // ignore
    } finally {
      setTokensLoading(false);
    }
  };

  const normalizeShopItem = (raw: Partial<ShopItem> & { id: string }): ShopItem => ({
    id: raw.id,
    name: raw.name ?? "",
    description: raw.description ?? "",
    image_url: raw.image_url ?? "",
    price: typeof raw.price === "number" ? raw.price : 0,
    active: !!raw.active,
    sort_order: typeof raw.sort_order === "number" ? raw.sort_order : 0,
  });

  const fetchShop = async () => {
    setShopLoading(true);
    try {
      const res = await fetch("/api/shop?all=1");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setShopItems(
          ((data.items ?? []) as (Partial<ShopItem> & { id: string })[]).map(normalizeShopItem)
        );
        setShopStatus(null);
      } else {
        setShopStatus({ id: "", kind: "error", text: data.error ?? "Could not load the shop items." });
      }
    } catch {
      setShopStatus({ id: "", kind: "error", text: "Could not load the shop items." });
    } finally {
      setShopLoading(false);
    }
  };

  const fetchPurchases = async () => {
    setPurchasesLoading(true);
    try {
      const res = await fetch("/api/shop/purchases");
      const data = await res.json().catch(() => ({}));
      setPurchases(res.ok ? ((data.purchases ?? []) as ShopPurchase[]) : []);
    } catch {
      setPurchases([]);
    } finally {
      setPurchasesLoading(false);
    }
  };

  const fetchClaims = async () => {
    setClaimsLoading(true);
    setClaimRowError(null);
    try {
      const res = await fetch("/api/claims");
      // A session from before the login cookie existed: logging in again sets it.
      if (res.status === 401) {
        onLogout();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setClaims((data.claims ?? []) as ClaimRequest[]);
        setClaimsError("");
      } else {
        setClaimsError(data.error ?? "Could not load the claim requests. Try Refresh.");
      }
    } catch {
      setClaimsError("Could not load the claim requests. Check your connection, then try Refresh.");
    } finally {
      setClaimsLoading(false);
    }
  };

  const decideClaim = async (claim: ClaimRequest, action: "approve" | "decline") => {
    setClaimBusyId(claim.id);
    setClaimRowError(null);
    try {
      const res = await fetch("/api/claims", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: claim.id, action }),
      });
      if (res.status === 401) {
        onLogout();
        return;
      }
      if (res.ok) {
        setClaims((prev) => prev.filter((c) => c.id !== claim.id));
        fetchTokens();
      } else {
        const body = await res.json().catch(() => ({}));
        setClaimRowError({ id: claim.id, text: body.error ?? "Could not save this decision. Try again." });
      }
    } catch {
      setClaimRowError({ id: claim.id, text: "Network error. Nothing was changed." });
    } finally {
      setClaimBusyId(null);
    }
  };

  useEffect(() => {
    fetchBadges();
    fetchTokens();
    fetchClaims();
    fetchShop();
    fetchPurchases();
  }, []);

  const shopDraftOf = (item: ShopItem): ShopDraft =>
    shopDrafts[item.id] ?? {
      name: item.name,
      price: String(item.price),
      active: item.active,
    };

  const setShopDraft = (item: ShopItem, patch: Partial<ShopDraft>) => {
    setShopStatus(null);
    setShopDrafts((prev) => ({ ...prev, [item.id]: { ...shopDraftOf(item), ...patch } }));
  };

  const saveShopItem = async (item: ShopItem) => {
    const draft = shopDraftOf(item);
    const name = draft.name.trim();
    const price = Number(draft.price);

    if (!name) {
      setShopStatus({ id: item.id, kind: "error", text: "Item name is required." });
      return;
    }
    if (!Number.isInteger(price) || price < 1 || price > MAX_SHOP_PRICE) {
      setShopStatus({
        id: item.id,
        kind: "error",
        text: `Enter a whole number of Ciscoins between 1 and ${MAX_SHOP_PRICE.toLocaleString("en-US")}.`,
      });
      return;
    }

    setShopSavingId(item.id);
    setShopStatus(null);
    try {
      const res = await fetch("/api/shop", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, name, price, active: draft.active }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setShopItems((prev) =>
          prev.map((i) => (i.id === item.id ? normalizeShopItem(data.item) : i))
        );
        setShopDrafts((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        setShopStatus({ id: item.id, kind: "ok", text: "Saved. The tablet shows this price now." });
      } else {
        setShopStatus({
          id: item.id,
          kind: "error",
          text: data.error ?? "Could not save this item.",
        });
      }
    } catch {
      setShopStatus({ id: item.id, kind: "error", text: "Network error. Nothing was changed." });
    } finally {
      setShopSavingId(null);
    }
  };

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
    let expiresAt: string | null = null;
    if (!noExpiry) {
      if (!expiryDate) {
        setGenError("Select an expiry date, or check Never expires.");
        return;
      }
      const parsed = new Date(`${expiryDate}T23:59:59`);
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        setGenError("Expiry date must be in the future.");
        return;
      }
      expiresAt = parsed.toISOString();
    }

    let ciscoins: number | null = null;
    if (attachCiscoins) {
      const ciscoinsParsed = Number(ciscoinsAmount);
      if (
        !ciscoinsAmount.trim() ||
        !Number.isInteger(ciscoinsParsed) ||
        ciscoinsParsed < 1 ||
        ciscoinsParsed > MAX_CISCOINS
      ) {
        setGenError(
          `Enter a whole number of Ciscoins between 1 and ${MAX_CISCOINS.toLocaleString("en-US")}.`
        );
        return;
      }
      ciscoins = ciscoinsParsed;
    }

    let singleUse = false;
    let maxClaims: number | null = null;
    if (attachCiscoins) {
      if (!claimMode) {
        setGenError("Choose who can claim this QR: one person, a limited number, or anyone.");
        return;
      }
      singleUse = claimMode === "once";
      if (claimMode === "limited") {
        const limitParsed = Number(claimLimit);
        if (
          !claimLimit.trim() ||
          !Number.isInteger(limitParsed) ||
          limitParsed < 1 ||
          limitParsed > MAX_CLAIMS
        ) {
          setGenError(
            `Enter how many people can claim, from 1 to ${MAX_CLAIMS.toLocaleString("en-US")}.`
          );
          return;
        }
        maxClaims = limitParsed;
      }
    }
    const requiresApproval = requireApproval && (claimMode === "once" || claimMode === "limited");

    setGenerating(true);
    setViewingId(null);
    setToken("");
    setConfirmed(false);
    setGrantedCiscoins(null);
    setGrantedRule(null);
    setGenError("");
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          badgeId: badge.id,
          awardedBy: byParam || undefined,
          expiresAt,
          ciscoins,
          singleUse,
          maxClaims,
          requiresApproval,
          requirement: requiresApproval ? requirement.trim() : null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        setGrantedCiscoins(data.ciscoins ?? null);
        setGrantedRule({
          singleUse: !!data.singleUse,
          maxClaims: data.maxClaims ?? null,
          requiresApproval: !!data.requiresApproval,
          requirement: data.requirement ?? null,
        });
        setConfirmed(true);
        fetchTokens();
      } else {
        const body = await res.json().catch(() => ({}));
        setGenError(body.error || "Could not create the QR code. Please try again.");
      }
    } catch {
      setGenError("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/tokens", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      if (res.ok) {
        setTokens((prev) => prev.filter((t) => t.id !== deleteTarget.id));
        setClaims((prev) => prev.filter((c) => c.token_id !== deleteTarget.id));
        if (viewingId === deleteTarget.id) {
          handleReset();
        }
        setDeleteTarget(null);
      } else {
        const body = await res.json().catch(() => ({}));
        setDeleteError(body.error || "Failed to delete the QR code. Please try again.");
      }
    } catch {
      setDeleteError("Network error. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  const handleReset = () => {
    setToken("");
    setConfirmed(false);
    setQrUrl("");
    setViewingId(null);
    setGrantedCiscoins(null);
    setGrantedRule(null);
    setGenError("");
  };

  const handleViewToken = (t: Token) => {
    setViewingId(t.id);
    setSelected(t.badge_id);
    setToken(t.token);
    setGrantedCiscoins(t.ciscoins ?? null);
    setGrantedRule({
      singleUse: !!t.single_use,
      maxClaims: t.max_claims ?? null,
      requiresApproval: !!t.requires_approval,
      requirement: t.requirement ?? null,
    });
    setQrUrl("");
    setConfirmed(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!badgeCreating) setShowCreateBadge(false);
      if (!deleting) setDeleteTarget(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [badgeCreating, deleting]);

  useEffect(() => {
    if (!token) return;
    QRCode.toCanvas(canvasRef.current, scanUrl, {
      width: 256,
      margin: 2,
      color: { dark: "#1d1240", light: "#ffffff" },
    });
    QRCode.toDataURL(scanUrl, {
      width: 256,
      margin: 2,
      color: { dark: "#1d1240", light: "#ffffff" },
    }).then(setQrUrl);
  }, [scanUrl, token]);

  const handleDownload = () => {
    if (!qrUrl) return;
    const link = document.createElement("a");
    const badgeId = viewed?.badge_id ?? badge?.id ?? "badge";
    link.download = `cncp-${badgeId}-qr.png`;
    link.href = qrUrl;
    link.click();
  };

  return (
    <div className="qr-page">
      <div className="qr-admin-layout">
        <header className="qr-admin-header">
          <div className="qr-admin-header-left">
            <Image
              src="/rebranding/logos/cncp-purple-logo.png"
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
            {/* Claims waiting for an admin: first on the page, members may be standing there */}
            <div className="qr-section">
              <div className="qr-section-header">
                <h2 className="qr-section-title">Claim Requests</h2>
                <span className="qr-badge-count">{claims.length}</span>
                <button
                  type="button"
                  className="qr-btn qr-btn-ghost qr-section-header-action"
                  onClick={fetchClaims}
                  disabled={claimsLoading}
                >
                  Refresh
                </button>
              </div>
              <p className="qr-section-desc">
                Approving grants the badge and Ciscoins right away. Declining frees the
                slot, and the member can scan again.
              </p>

              {claimsLoading && claims.length === 0 ? (
                <div className="qr-empty-state">
                  <span className="qr-spinner" />
                </div>
              ) : claimsError ? (
                <p className="qr-error">{claimsError}</p>
              ) : claims.length === 0 ? (
                <p className="qr-empty-text">
                  Nobody is waiting. Scans of QR codes that need approval show up here.
                </p>
              ) : (
                <div className="qr-claim-requests">
                  {claims.map((c) => {
                    const t = tokens.find((tok) => tok.id === c.token_id);
                    const busy = claimBusyId === c.id;
                    return (
                      <div key={c.id} className="qr-claim-request">
                        <div className="qr-claim-request-info">
                          <p className="qr-claim-request-email">{c.email}</p>
                          <p className="qr-claim-request-meta">
                            {badges.find((b) => b.id === t?.badge_id)?.name ?? t?.badge_id ?? "QR code"}
                            {t?.ciscoins ? (
                              <>
                                <span className="qr-token-dot">&#183;</span>
                                <span className="qr-token-ciscoins">
                                  +{t.ciscoins.toLocaleString("en-US")} Ciscoins
                                </span>
                              </>
                            ) : null}
                            <span className="qr-token-dot">&#183;</span>
                            {new Date(c.created_at).toLocaleString()}
                          </p>
                          {t?.requirement ? (
                            <p className="qr-claim-request-task">Requirement: {t.requirement}</p>
                          ) : null}
                        </div>
                        <div className="qr-claim-request-actions">
                          <button
                            type="button"
                            className="qr-btn qr-btn-primary"
                            onClick={() => decideClaim(c, "approve")}
                            disabled={claimBusyId !== null}
                          >
                            {busy ? "Saving..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            className="qr-btn qr-btn-secondary"
                            onClick={() => decideClaim(c, "decline")}
                            disabled={claimBusyId !== null}
                          >
                            Decline
                          </button>
                        </div>
                        {claimRowError?.id === c.id ? (
                          <p className="qr-error qr-claim-request-error">{claimRowError.text}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* QR Generator Section */}
            <div className="qr-section">
              <h2 className="qr-section-title">
                {viewingId ? "View QR Code" : "Generate QR Code"}
              </h2>
              <p className="qr-section-desc">
                {viewingId
                  ? "This QR code was generated earlier. Download it or go back to generate a new one."
                  : "Select a badge and enter the awardee name to generate a scannable QR code."}
              </p>

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
                      aria-pressed={selected === b.id}
                      title={b.name}
                    >
                      <Image src={b.image_url} alt="" width={64} height={64} draggable={false} />
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

              <div className="qr-field">
                <label className="qr-field-label" htmlFor="qr-expiry">Expiry date</label>
                <div className="qr-expiry-row">
                  <input
                    id="qr-expiry"
                    type="date"
                    value={expiryDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="qr-input"
                    disabled={generating || confirmed || noExpiry}
                  />
                  <label className="qr-expiry-never">
                    <input
                      type="checkbox"
                      checked={noExpiry}
                      onChange={(e) => setNoExpiry(e.target.checked)}
                      disabled={generating || confirmed}
                    />
                    Never expires
                  </label>
                </div>
              </div>

              <div className="qr-field">
                <label className="qr-field-label" htmlFor="qr-ciscoins">Ciscoins reward</label>
                <div className="qr-expiry-row">
                  <input
                    id="qr-ciscoins"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_CISCOINS}
                    step={1}
                    value={ciscoinsAmount}
                    onChange={(e) => setCiscoinsAmount(e.target.value)}
                    placeholder="How many?"
                    className="qr-input"
                    disabled={generating || confirmed || !attachCiscoins}
                  />
                  <label className="qr-expiry-never">
                    <input
                      type="checkbox"
                      checked={attachCiscoins}
                      onChange={(e) => {
                        setAttachCiscoins(e.target.checked);
                        if (!e.target.checked) setClaimMode("");
                      }}
                      disabled={generating || confirmed}
                    />
                    Attach to this badge
                  </label>
                </div>
                <p className="qr-field-hint">
                  {attachCiscoins
                    ? "Anyone claiming this badge receives the amount above."
                    : "This badge does not award any Ciscoins."}
                </p>
              </div>

              {attachCiscoins && (
                <fieldset className="qr-claim-mode">
                  <legend className="qr-field-label">Who can claim it</legend>
                  <label
                    className={`qr-claim-option ${claimMode === "once" ? "active" : ""}`}
                  >
                    <input
                      type="radio"
                      name="qr-claim-mode"
                      value="once"
                      checked={claimMode === "once"}
                      onChange={() => setClaimMode("once")}
                      disabled={generating || confirmed}
                    />
                    <span className="qr-claim-option-text">
                      <span className="qr-claim-option-title">One time claim only</span>
                      <span className="qr-claim-option-desc">
                        The first person to claim it gets the badge and the Ciscoins. After
                        that this QR code stops working.
                      </span>
                    </span>
                  </label>
                  <label
                    className={`qr-claim-option ${claimMode === "limited" ? "active" : ""}`}
                  >
                    <input
                      type="radio"
                      name="qr-claim-mode"
                      value="limited"
                      checked={claimMode === "limited"}
                      onChange={() => setClaimMode("limited")}
                      disabled={generating || confirmed}
                    />
                    <span className="qr-claim-option-text">
                      <span className="qr-claim-option-title">Limited number of people</span>
                      <span className="qr-claim-option-desc">
                        You set how many people can claim it. Each person can claim once, and
                        the QR code stops working when the limit is reached.
                      </span>
                    </span>
                  </label>
                  {claimMode === "limited" && (
                    <div className="qr-claim-suboption">
                      <label className="qr-field-label" htmlFor="qr-claim-limit">
                        How many people?
                      </label>
                      <input
                        id="qr-claim-limit"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={MAX_CLAIMS}
                        step={1}
                        value={claimLimit}
                        onChange={(e) => setClaimLimit(e.target.value)}
                        placeholder="Number of people"
                        className="qr-input"
                        disabled={generating || confirmed}
                      />
                    </div>
                  )}
                  <label
                    className={`qr-claim-option ${claimMode === "always" ? "active" : ""}`}
                  >
                    <input
                      type="radio"
                      name="qr-claim-mode"
                      value="always"
                      checked={claimMode === "always"}
                      onChange={() => setClaimMode("always")}
                      disabled={generating || confirmed}
                    />
                    <span className="qr-claim-option-text">
                      <span className="qr-claim-option-title">Permanently available</span>
                      <span className="qr-claim-option-desc">
                        Anyone can claim it, today and later. Each person gets the badge and
                        the Ciscoins once.
                      </span>
                    </span>
                  </label>
                </fieldset>
              )}

              {attachCiscoins && (claimMode === "once" || claimMode === "limited") && (
                <div className="qr-claim-mode">
                  <label className={`qr-claim-option ${requireApproval ? "active" : ""}`}>
                    <input
                      type="checkbox"
                      checked={requireApproval}
                      onChange={(e) => setRequireApproval(e.target.checked)}
                      disabled={generating || confirmed}
                    />
                    <span className="qr-claim-option-text">
                      <span className="qr-claim-option-title">I approve each claim first</span>
                      <span className="qr-claim-option-desc">
                        Scanning sends you a request. The member gets the badge and Ciscoins
                        only after you approve it in Claim Requests.
                      </span>
                    </span>
                  </label>
                  {requireApproval && (
                    <div className="qr-claim-suboption">
                      <label className="qr-field-label" htmlFor="qr-requirement">
                        What must they do first? (optional)
                      </label>
                      <input
                        id="qr-requirement"
                        type="text"
                        maxLength={MAX_REQUIREMENT}
                        value={requirement}
                        onChange={(e) => setRequirement(e.target.value)}
                        placeholder="e.g. Attend the general assembly"
                        className="qr-input"
                        disabled={generating || confirmed}
                      />
                      <p className="qr-field-hint">Members see this when they scan.</p>
                    </div>
                  )}
                </div>
              )}

              {genError && <p className="qr-error">{genError}</p>}

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
                  <p className="qr-single-use">
                    {viewed
                      ? [
                          badges.find((b) => b.id === viewed.badge_id)?.name ?? viewed.badge_id,
                          viewed.awarded_by ? `by ${viewed.awarded_by}` : "No awardee",
                          new Date(viewed.created_at).toLocaleDateString(),
                          viewed.expires_at
                            ? viewed.expired
                              ? "Expired"
                              : `Expires ${new Date(viewed.expires_at).toLocaleDateString()}`
                            : "Never expires",
                          claimStatus(viewed)?.label,
                        ].filter(Boolean).join(" · ")
                      : "Each person who scans this QR code gets their own badge."}
                  </p>
                  {grantedCiscoins !== null && (
                    <p className="qr-ciscoins-grant">
                      Grants {grantedCiscoins.toLocaleString("en-US")} Ciscoins when someone claims
                      this badge
                    </p>
                  )}
                  {grantedCiscoins !== null && grantedRule && (
                    <div className="qr-claim-mode-note">
                      {claimRuleNotes(grantedRule).map((note) => (
                        <p key={note}>{note}</p>
                      ))}
                    </div>
                  )}
                  <div className="qr-actions">
                    <button type="button" className="qr-btn qr-btn-primary" onClick={handleDownload} disabled={!qrUrl}>
                      Download QR
                    </button>
                    <button type="button" className="qr-btn qr-btn-secondary" onClick={handleReset}>
                      {viewed ? "Back to Generator" : "Generate New"}
                    </button>
                  </div>
                </div>
              )}
            </div>
            {/* Shop items — prices are edited here, not in a migration */}
            <div className="qr-section">
              <div className="qr-section-header">
                <h2 className="qr-section-title">Shop Items</h2>
                <span className="qr-badge-count">{shopItems.length}</span>
              </div>
              <p className="qr-section-desc">
                What members pay on the Shop app. Saving changes the tablet price
                right away.
              </p>

              {shopLoading ? (
                <div className="qr-empty-state">
                  <span className="qr-spinner" />
                </div>
              ) : shopItems.length === 0 ? (
                <div className="qr-empty-state">
                  <p className="qr-empty-text">No shop items yet.</p>
                </div>
              ) : (
                <div className="qr-shop-list">
                  {shopItems.map((item) => {
                    const draft = shopDraftOf(item);
                    const saving = shopSavingId === item.id;
                    const status = shopStatus?.id === item.id ? shopStatus : null;
                    const dirty =
                      draft.name.trim() !== item.name ||
                      draft.price !== String(item.price) ||
                      draft.active !== item.active;
                    return (
                      <div key={item.id} className="qr-shop-row">
                        <div className="qr-shop-fields">
                          <div className="qr-field qr-shop-field-name">
                            <label className="qr-field-label" htmlFor={`shop-name-${item.id}`}>
                              Item
                            </label>
                            <input
                              id={`shop-name-${item.id}`}
                              className="qr-input"
                              type="text"
                              maxLength={60}
                              value={draft.name}
                              onChange={(e) => setShopDraft(item, { name: e.target.value })}
                              disabled={saving}
                            />
                          </div>
                          <div className="qr-field qr-shop-field-price">
                            <label className="qr-field-label" htmlFor={`shop-price-${item.id}`}>
                              Price (Ciscoins)
                            </label>
                            <input
                              id={`shop-price-${item.id}`}
                              className="qr-input"
                              type="number"
                              min={1}
                              max={MAX_SHOP_PRICE}
                              step={1}
                              value={draft.price}
                              onChange={(e) => setShopDraft(item, { price: e.target.value })}
                              disabled={saving}
                            />
                          </div>
                          <label className="qr-shop-active">
                            <input
                              type="checkbox"
                              checked={draft.active}
                              onChange={(e) => setShopDraft(item, { active: e.target.checked })}
                              disabled={saving}
                            />
                            <span>For sale</span>
                          </label>
                          <button
                            type="button"
                            className="qr-btn qr-btn-primary"
                            onClick={() => saveShopItem(item)}
                            disabled={saving || !dirty}
                          >
                            {saving ? "Saving..." : "Save"}
                          </button>
                        </div>
                        {status ? (
                          <p
                            className={
                              status.kind === "error" ? "qr-error" : "qr-shop-saved"
                            }
                          >
                            {status.text}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
              {shopStatus && shopStatus.id === "" ? (
                <p className="qr-error">{shopStatus.text}</p>
              ) : null}
            </div>

            {/* Purchase log */}
            <div className="qr-section">
              <div className="qr-section-header">
                <h2 className="qr-section-title">Shop Purchases</h2>
                <span className="qr-badge-count">{purchases.length}</span>
              </div>
              <p className="qr-section-desc">
                Every Ciscoins spent in the Shop, newest first.
              </p>

              {purchasesLoading ? (
                <div className="qr-empty-state">
                  <span className="qr-spinner" />
                </div>
              ) : purchases.length === 0 ? (
                <div className="qr-empty-state">
                  <p className="qr-empty-text">Nothing has been bought yet.</p>
                </div>
              ) : (
                <div className="qr-shop-log">
                  {purchases.map((p, index) => (
                    <div
                      className="qr-shop-log-row"
                      key={`${p.created_at}-${p.email}-${index}`}
                    >
                      <span className="qr-shop-log-item">
                        {shopItems.find((i) => i.id === p.item_id)?.name || p.item_name}
                      </span>
                      <span className="qr-shop-log-email">{p.email}</span>
                      <span className="qr-shop-log-amount">
                        {p.amount.toLocaleString("en-US")} Ciscoins
                      </span>
                      <span className="qr-shop-log-time">
                        {new Date(p.created_at).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="qr-btn qr-btn-ghost"
                onClick={fetchPurchases}
                disabled={purchasesLoading}
              >
                Refresh
              </button>
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
                    const expired = !!t.expired;
                    const status = claimStatus(t);
                    return (
                      <div key={t.id} className={`qr-token-row ${viewingId === t.id ? "active" : ""}`}>
                        <button
                          type="button"
                          className="qr-token-info"
                          onClick={() => handleViewToken(t)}
                          title="View QR code"
                        >
                          {b?.image_url ? (
                            <Image src={b.image_url} alt="" width={28} height={28} className="qr-token-icon" draggable={false} />
                          ) : (
                            <span className="qr-token-icon qr-token-icon-placeholder" />
                          )}
                          <span className="qr-token-details">
                            <span className="qr-token-name">{b?.name ?? t.badge_id}</span>
                            <span className="qr-token-meta">
                              {t.awarded_by ? `by ${t.awarded_by}` : "No awardee"}
                              <span className="qr-token-dot">&#183;</span>
                              {new Date(t.created_at).toLocaleDateString()}
                              <span className="qr-token-dot">&#183;</span>
                              <span className={expired ? "qr-token-expired" : ""}>
                                {expired
                                  ? "Expired"
                                  : t.expires_at
                                    ? `Exp. ${new Date(t.expires_at).toLocaleDateString()}`
                                    : "Never expires"}
                              </span>
                              {t.ciscoins ? (
                                <>
                                  <span className="qr-token-dot">&#183;</span>
                                  <span className="qr-token-ciscoins">
                                    +{t.ciscoins.toLocaleString("en-US")} Ciscoins
                                  </span>
                                </>
                              ) : null}
                              {status ? (
                                <>
                                  <span className="qr-token-dot">&#183;</span>
                                  <span className={`qr-token-claim ${status.used ? "used" : ""}`}>
                                    {status.label}
                                  </span>
                                </>
                              ) : null}
                              {t.requires_approval ? (
                                <>
                                  <span className="qr-token-dot">&#183;</span>
                                  <span className="qr-token-claim">Needs approval</span>
                                </>
                              ) : null}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="qr-token-delete-btn"
                          onClick={() => { setDeleteError(""); setDeleteTarget({ id: t.id, badge_id: t.badge_id }); }}
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
              {claims.some((c) => c.token_id === deleteTarget.id)
                ? " Claims still waiting on this QR code are removed too."
                : ""}
            </p>
            {deleteError && <p className="qr-error">{deleteError}</p>}
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
