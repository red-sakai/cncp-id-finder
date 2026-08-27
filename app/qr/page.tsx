"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import Image from "next/image";

const BADGES = [
  {
    id: "welcome-to-cisco",
    name: "Welcome to Cisco",
    image: "/badges/welcome-to-cisco-badge.png",
  },
];

export default function QRPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [selected, setSelected] = useState(BADGES[0].id);

  const badge = BADGES.find((b) => b.id === selected) ?? BADGES[0];
  const scanUrl = `https://cncp-id-finder.vercel.app/scan?badge=${badge.id}`;

  useEffect(() => {
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
  }, [scanUrl]);

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
        <Image
          src="/cncp-logo-transparent.png"
          alt="CNCP Logo"
          width={56}
          height={39}
          className="qr-logo"
          draggable={false}
        />
        <h1 className="qr-title">Badge QR Generator</h1>
        <p className="qr-subtitle">
          Select a badge and download the QR code to print or share.
        </p>

        <div className="qr-badge-select">
          {BADGES.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`qr-badge-option ${selected === b.id ? "active" : ""}`}
              onClick={() => setSelected(b.id)}
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

        <div className="qr-preview">
          <canvas ref={canvasRef} className="qr-canvas" />
        </div>

        <p className="qr-url">{scanUrl}</p>

        <button
          type="button"
          className="qr-download"
          onClick={handleDownload}
          disabled={!qrUrl}
        >
          Download QR Code
        </button>
      </div>
    </div>
  );
}
