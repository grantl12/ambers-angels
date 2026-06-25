import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const COLOR_HEX: Record<string, string> = {
  black: "#1a1a1a",
  white: "#f5f5f5",
  silver: "#a8a9ad",
  gray: "#6b7280",
  grey: "#6b7280",
  red: "#dc2626",
  blue: "#2563eb",
  navy: "#1e3a5f",
  green: "#16a34a",
  yellow: "#eab308",
  gold: "#ca8a04",
  orange: "#ea580c",
  brown: "#78350f",
  tan: "#b8860b",
  beige: "#d2b48c",
  cream: "#fffdd0",
  maroon: "#7f1d1d",
  purple: "#7c3aed",
  pink: "#ec4899",
  teal: "#0d9488",
};

const VEHICLE_EMOJI: Record<string, string> = {
  sedan: "\u{1F697}",
  car: "\u{1F697}",
  suv: "\u{1F699}",
  pickup: "\u{1F6FB}",
  truck: "\u{1F69A}",
  van: "\u{1F690}",
  minivan: "\u{1F690}",
  bus: "\u{1F68C}",
  motorcycle: "\u{1F3CD}",
  coupe: "\u{1F3CE}",
  hatchback: "\u{1F697}",
  convertible: "\u{1F697}",
  wagon: "\u{1F697}",
  jeep: "\u{1F699}",
};

function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#1a1a1a" : "#ffffff";
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const color = (searchParams.get("color") || "").toLowerCase();
  const type = (searchParams.get("type") || "vehicle").toLowerCase();
  const make = searchParams.get("make") || "";

  const bgHex = COLOR_HEX[color] || "#6b7280";
  const textColor = contrastColor(bgHex);
  const emoji = VEHICLE_EMOJI[type] || "\u{1F697}";
  const displayType = type.toUpperCase();
  const displayMake = make.toUpperCase();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: bgHex,
          padding: "20px",
        }}
      >
        <div style={{ fontSize: 80, marginBottom: 8 }}>{emoji}</div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 700,
            color: textColor,
            textAlign: "center",
            letterSpacing: "0.05em",
          }}
        >
          {color ? `${color.toUpperCase()} ` : ""}
          {displayType}
        </div>
        {displayMake && (
          <div
            style={{
              fontSize: 28,
              fontWeight: 600,
              color: textColor,
              opacity: 0.85,
              marginTop: 4,
              textAlign: "center",
            }}
          >
            {displayMake}
          </div>
        )}
        <div
          style={{
            fontSize: 14,
            color: textColor,
            opacity: 0.5,
            marginTop: 16,
            textAlign: "center",
          }}
        >
          REFERENCE IMAGE — NOT EXACT VEHICLE
        </div>
      </div>
    ),
    {
      width: 400,
      height: 300,
      emoji: "twemoji",
    }
  );
}
