"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import QRCode from "qrcode";

type UserData = {
  first_name: string;
  last_name: string;
  email: string;
  course_year_section: string;
  membership_type: string;
  badges: { badge_id: string; awarded_at: string }[];
  card_style: string;
};

const BADGE_INFO: Record<string, { name: string; image: string; desc: string }> = {
  "welcome-to-cisco": {
    name: "Welcome to Cisco",
    image: "/badges/welcome-to-cisco-badge.png",
    desc: "Awarded to new members who join Cisco NetConnect PUP \u2013 Manila. Welcome to the community!",
  },
};

export default function PublicIdPage() {
  const params = useParams();
  const email = decodeURIComponent(params.email as string);
  const [data, setData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cardFlipped, setCardFlipped] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [selectedBadge, setSelectedBadge] = useState<string | null>(null);
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch("/api/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        if (!res.ok) {
          setError("ID not found.");
          setLoading(false);
          return;
        }
        const userData = await res.json();
        setData(userData);
        QRCode.toDataURL(`https://cncp-id-finder.vercel.app/scan`, {
          width: 80,
          margin: 1,
          color: { dark: "#1a2a3a", light: "#ffffff" },
        }).then(setQrDataUrl);
      } catch {
        setError("Failed to load ID.");
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, [email]);

  const earnedBadges = new Set(
    (data?.badges ?? []).map((b) => b.badge_id)
  );

  const getSigPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setIsDrawing(true);
    const ctx = sigCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getSigPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    if (!isDrawing) return;
    const ctx = sigCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getSigPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#1a2a3a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  };

  const endDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setIsDrawing(false);
  };

  const clearSig = () => {
    const ctx = sigCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  };

  if (loading) {
    return (
      <div className="public-id-page">
        <p className="public-id-status">Loading ID...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="public-id-page">
        <p className="public-id-status error">{error || "ID not found."}</p>
      </div>
    );
  }

  const cardStyle = data.card_style || "white";

  return (
    <div className="public-id-page">
      <div
        className={`icisco-idcard ${cardFlipped ? "flipped" : ""} card-style-${cardStyle}`}
        onClick={() => setCardFlipped(!cardFlipped)}
      >
        {/* FRONT */}
        <div className="icisco-idcard-face icisco-idcard-front">
          <div className="icisco-idcard-top">
            <Image src="/cncp-logo-transparent.png" alt="" width={20} height={14} className="icisco-idcard-top-logo" draggable={false} />
            <span className="icisco-idcard-top-title">Member ID</span>
            <Image src="/cncp-logo-transparent.png" alt="" width={20} height={14} className="icisco-idcard-top-logo" draggable={false} />
          </div>
          <div className="icisco-idcard-body">
            <div className="icisco-idcard-avatar">
              <Image src="/cncp-logo-transparent.png" alt="CNCP" width={56} height={40} className="icisco-idcard-avatar-img" />
            </div>
            <div className="icisco-idcard-info">
              <p className="icisco-idcard-name">{data.first_name} {data.last_name}</p>
              <p className="icisco-idcard-idnum">CNCP-2026-{String(data.email.length * 7 % 10000).padStart(4, "0")}</p>
              <p className="icisco-idcard-course">{data.course_year_section}</p>
              <span className="icisco-idcard-membership">{data.membership_type}</span>
              <p className="icisco-idcard-email">{data.email}</p>
            </div>
          </div>
          <div className="icisco-idcard-badges">
            <span className="icisco-idcard-badges-title">
              Badges
              <span className="icisco-idcard-badges-help" onClick={(e) => e.stopPropagation()}>
                ?
                <span className="icisco-idcard-badges-tooltip">
                  Earn badges by scanning QR codes at CNCP events and activities.
                </span>
              </span>
            </span>
            <div className="icisco-idcard-badge-slots">
              <div
                className={`icisco-idcard-badge-slot ${earnedBadges.has("welcome-to-cisco") ? "earned" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (earnedBadges.has("welcome-to-cisco")) setSelectedBadge("welcome-to-cisco");
                }}
              >
                {earnedBadges.has("welcome-to-cisco") ? (
                  <Image src="/badges/welcome-to-cisco-badge.png" alt="Welcome to Cisco" width={36} height={36} className="icisco-idcard-badge-img" draggable={false} />
                ) : (
                  <div className="icisco-idcard-badge-icon-wrap">?</div>
                )}
              </div>
              <div className="icisco-idcard-badge-slot">
                <div className="icisco-idcard-badge-icon-wrap">?</div>
              </div>
              <div className="icisco-idcard-badge-slot">
                <div className="icisco-idcard-badge-icon-wrap">?</div>
              </div>
            </div>
          </div>
          <div className="icisco-idcard-footer">
            <span className="icisco-idcard-org-footer">Cisco NetConnect PUP &ndash; Manila</span>
            <div className="icisco-idcard-qr">
              {qrDataUrl && <img src={qrDataUrl} alt="QR Code" className="icisco-idcard-qr-img" />}
            </div>
          </div>
        </div>

        {selectedBadge && BADGE_INFO[selectedBadge] && (
          <div className="icisco-badge-modal" onClick={(e) => { e.stopPropagation(); setSelectedBadge(null); }}>
            <div className="icisco-badge-modal-card" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="icisco-badge-modal-close" onClick={() => setSelectedBadge(null)}>&times;</button>
              <Image src={BADGE_INFO[selectedBadge].image} alt={BADGE_INFO[selectedBadge].name} width={64} height={64} className="icisco-badge-modal-img" draggable={false} />
              <p className="icisco-badge-modal-name">{BADGE_INFO[selectedBadge].name}</p>
              <p className="icisco-badge-modal-desc">{BADGE_INFO[selectedBadge].desc}</p>
            </div>
          </div>
        )}

        {/* BACK */}
        <div className="icisco-idcard-face icisco-idcard-back" onClick={(e) => e.stopPropagation()}>
          <div className="icisco-idcard-back-header">
            <Image src="/cncp-logo-transparent.png" alt="CNCP" width={40} height={28} draggable={false} />
            <span className="icisco-idcard-back-org">Cisco NetConnect PUP &ndash; Manila</span>
          </div>
          <p className="icisco-idcard-back-text">
            This is an official identification card issued and recognized by <strong>Cisco NetConnect PUP &ndash; Manila</strong> for its registered members.
          </p>
          <div className="icisco-idcard-back-signatories">
            <div className="icisco-idcard-signatory">
              <Image src="/jhered-signatory.png" alt="Jhered Miguel Republica" width={160} height={50} className="icisco-idcard-sig-img" draggable={false} />
              <div className="icisco-idcard-sig-line" />
              <p className="icisco-idcard-sig-name">Jhered Miguel Republica</p>
              <p className="icisco-idcard-sig-role">Chief Executive Officer</p>
            </div>
            <div className="icisco-idcard-signatory">
              <canvas
                ref={sigCanvasRef}
                width={160}
                height={50}
                className="icisco-idcard-sig-canvas"
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={endDraw}
                onMouseLeave={endDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={endDraw}
              />
              <button type="button" className="icisco-idcard-sig-clear" onClick={(e) => { e.stopPropagation(); clearSig(); }}>Clear</button>
              <div className="icisco-idcard-sig-line" />
              <p className="icisco-idcard-sig-name">{data.first_name} {data.last_name}</p>
              <p className="icisco-idcard-sig-role">Member</p>
            </div>
          </div>
          <button type="button" className="icisco-idcard-back-flip" onClick={(e) => { e.stopPropagation(); setCardFlipped(false); }}>
            Tap to flip back
          </button>
        </div>
      </div>
    </div>
  );
}
