/**
 * Flyer renderer. Composes a JSX template via Next.js's ImageResponse
 * (which wraps satori + resvg). Two output formats, one template:
 *
 *   - story: 1080 × 1920 (Instagram story)
 *   - post:  1080 × 1080 (Instagram post)
 *
 * Theme-aware: pulls the trip's `theme` and uses the same palette
 * tokens that drive the public invitation page. So a "fancy"-theme
 * trip's flyer matches its invite page, an "eclectic" one's matches,
 * etc. Single template, six visual identities.
 */

import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import type { Trip } from "@shared/types";
import { themeClass } from "@/lib/themes";
import { loadFlyerFonts } from "./fonts";

export type FlyerFormat = "story" | "post";

interface RenderArgs {
  trip: Pick<Trip, "name" | "destination" | "start_date" | "end_date" | "theme" | "cover_image_url" | "share_token">;
  plannerName: string;
  inviteUrl: string;
  format: FlyerFormat;
}

interface FlyerPalette {
  /** Background fill if there's no cover image. */
  bg: string;
  /** Foreground ink color for trip name + body text. */
  ink: string;
  /** Secondary ink (dates, hosted by, etc.). */
  inkSoft: string;
  /** Eyebrow + accent color. */
  accent: string;
  /** Background scrim color (over a cover image, behind the trip name). */
  scrim: string;
  /** Font family for the headline. */
  headlineFont: "Lora" | "Inter";
  /** Optional italic on the headline. */
  headlineItalic: boolean;
}

// Each theme gets a flyer palette that mirrors its invite-page identity.
function flyerPalette(theme: Trip["theme"]): FlyerPalette {
  switch (theme) {
    case "eclectic":
      return {
        bg: "linear-gradient(135deg, #FF6A45, #F3C96A 55%, #DFE8D2)",
        ink: "#FFFBF1",
        inkSoft: "rgba(255, 251, 241, 0.78)",
        accent: "#FFFBF1",
        scrim: "rgba(20, 14, 8, 0.36)",
        headlineFont: "Lora",
        headlineItalic: false,
      };
    case "fancy":
      return {
        bg: "linear-gradient(135deg, #F8F1E0, #ECE0BB)",
        ink: "#174F3C",
        inkSoft: "rgba(22, 48, 38, 0.7)",
        accent: "#C9A24A",
        scrim: "rgba(248, 241, 224, 0.55)",
        headlineFont: "Lora",
        headlineItalic: true,
      };
    case "literary":
      return {
        bg: "#F4ECDF",
        ink: "#163026",
        inkSoft: "rgba(22, 48, 38, 0.72)",
        accent: "rgba(22, 48, 38, 0.7)",
        scrim: "rgba(244, 236, 223, 0.6)",
        headlineFont: "Lora",
        headlineItalic: false,
      };
    case "digital":
      return {
        bg: "#1A2520",
        ink: "#7DDDB1",
        inkSoft: "rgba(125, 221, 177, 0.7)",
        accent: "#7DDDB1",
        scrim: "rgba(26, 37, 32, 0.65)",
        headlineFont: "Inter",
        headlineItalic: false,
      };
    case "elegant":
      return {
        bg: "linear-gradient(135deg, #FBF7EF, #E8D9B5)",
        ink: "#0F3F2E",
        inkSoft: "rgba(15, 63, 46, 0.68)",
        accent: "#C9A24A",
        scrim: "rgba(251, 247, 239, 0.55)",
        headlineFont: "Lora",
        headlineItalic: false,
      };
    case "classic":
    default:
      return {
        bg: "linear-gradient(135deg, #DFE8D2, #F4ECDF)",
        ink: "#0F3F2E",
        inkSoft: "rgba(15, 63, 46, 0.7)",
        accent: "#0F3F2E",
        scrim: "rgba(251, 247, 239, 0.55)",
        headlineFont: "Lora",
        headlineItalic: false,
      };
  }
}

export async function renderFlyer(args: RenderArgs): Promise<Uint8Array> {
  const { trip, plannerName, inviteUrl, format } = args;
  const palette = flyerPalette(trip.theme);
  const dims = format === "story" ? { w: 1080, h: 1920 } : { w: 1080, h: 1080 };

  // QR code as a base64 PNG data URL — satori can render <img src="data:..." />.
  const qr = await QRCode.toDataURL(inviteUrl, {
    margin: 0,
    width: 360,
    color: {
      dark: palette.ink,
      light: "#FFFFFF00", // transparent BG; we draw a card under it
    },
  });

  const fonts = await loadFlyerFonts();

  const hasCover = !!trip.cover_image_url;
  const dateText = formatDateRange(trip.start_date, trip.end_date);
  const themeLabel = themeClass(trip.theme).label;

  const bgIsGradient = palette.bg.startsWith("linear-gradient");
  const rootBg = hasCover
    ? { backgroundImage: `url(${trip.cover_image_url})`, backgroundColor: "#FBF7EF" }
    : bgIsGradient
      ? { backgroundImage: palette.bg, backgroundColor: "#FBF7EF" }
      : { backgroundColor: palette.bg };

  const response = new ImageResponse(
    (
      <div
        style={{
          width: dims.w,
          height: dims.h,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          fontFamily: "Inter",
          color: palette.ink,
          ...rootBg,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* Scrim — only over cover photo, gives the headline contrast */}
        {hasCover && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: palette.scrim,
              display: "flex",
            }}
          />
        )}

        {/* Content layer */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            padding: format === "story" ? "120px 80px 120px" : "80px 70px",
            flex: 1,
            justifyContent: "space-between",
          }}
        >
          {/* Eyebrow */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <span
              style={{
                fontFamily: "Inter",
                fontSize: format === "story" ? 22 : 18,
                letterSpacing: 8,
                fontWeight: 700,
                color: hasCover ? "#FFFBF1" : palette.accent,
                textTransform: "uppercase",
              }}
            >
              You&apos;re invited · {themeLabel}
            </span>

            {/* Trip name */}
            <span
              style={{
                fontFamily: palette.headlineFont,
                fontSize: format === "story"
                  ? trip.name.length > 18 ? 110 : 140
                  : trip.name.length > 18 ? 86 : 112,
                fontWeight: 700,
                lineHeight: 1.02,
                color: hasCover ? "#FFFBF1" : palette.ink,
                fontStyle: palette.headlineItalic ? "italic" : "normal",
                letterSpacing: "-0.02em",
                marginTop: format === "story" ? 8 : 4,
              }}
            >
              {trip.name}
            </span>

            {/* Destination + Dates */}
            {trip.destination && (
              <span
                style={{
                  fontFamily: "Inter",
                  fontSize: format === "story" ? 40 : 32,
                  fontWeight: 600,
                  color: hasCover ? "#FFFBF1" : palette.ink,
                  marginTop: format === "story" ? 24 : 12,
                }}
              >
                {trip.destination}
              </span>
            )}
            {dateText && (
              <span
                style={{
                  fontFamily: "Inter",
                  fontSize: format === "story" ? 32 : 26,
                  color: hasCover ? "rgba(255,251,241,0.85)" : palette.inkSoft,
                  fontWeight: 400,
                }}
              >
                {dateText}
              </span>
            )}
          </div>

          {/* Footer: hosted by + QR */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 32,
              marginTop: 48,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: dims.w - 360 - 200 }}>
              <span
                style={{
                  fontFamily: "Inter",
                  fontSize: format === "story" ? 22 : 18,
                  letterSpacing: 8,
                  fontWeight: 700,
                  color: hasCover ? "rgba(255,251,241,0.85)" : palette.inkSoft,
                  textTransform: "uppercase",
                }}
              >
                Hosted by
              </span>
              <span
                style={{
                  fontFamily: palette.headlineFont,
                  fontSize: format === "story" ? 56 : 44,
                  fontWeight: 700,
                  color: hasCover ? "#FFFBF1" : palette.ink,
                  fontStyle: palette.headlineItalic ? "italic" : "normal",
                  lineHeight: 1.05,
                }}
              >
                {plannerName}
              </span>
              <span
                style={{
                  fontFamily: "Inter",
                  fontSize: format === "story" ? 22 : 18,
                  color: hasCover ? "rgba(255,251,241,0.7)" : palette.inkSoft,
                  marginTop: 18,
                  fontWeight: 400,
                }}
              >
                RSVP · {hostnameOf(inviteUrl)}
              </span>
            </div>

            {/* QR card */}
            <div
              style={{
                display: "flex",
                width: format === "story" ? 320 : 260,
                height: format === "story" ? 320 : 260,
                background: "#FFFBF1",
                borderRadius: 24,
                padding: 24,
                alignItems: "center",
                justifyContent: "center",
                boxShadow: hasCover ? "0 12px 36px rgba(0,0,0,0.25)" : "none",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} width={format === "story" ? 272 : 212} height={format === "story" ? 272 : 212} alt="" />
            </div>
          </div>

          {/* Rally wordmark */}
          <div
            style={{
              position: "absolute",
              top: format === "story" ? 56 : 40,
              right: format === "story" ? 80 : 70,
              fontFamily: "Inter",
              fontSize: format === "story" ? 22 : 18,
              fontWeight: 700,
              letterSpacing: 8,
              textTransform: "uppercase",
              color: hasCover ? "#FFFBF1" : palette.accent,
              display: "flex",
            }}
          >
            Rally
          </div>
        </div>
      </div>
    ),
    {
      width: dims.w,
      height: dims.h,
      fonts,
    },
  );

  const buf = await response.arrayBuffer();
  return new Uint8Array(buf);
}

// ─── Helpers ────────────────────────────────────────────────────

function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  const fmt = (s: string) =>
    new Date(s + "T00:00:00").toLocaleDateString("en-US", {
      month: "long", day: "numeric",
    });
  if (start && end) {
    const startY = new Date(start + "T00:00:00").getFullYear();
    return `${fmt(start)} → ${fmt(end)}, ${startY}`;
  }
  if (start) return `From ${fmt(start)}`;
  if (end)   return `Until ${fmt(end)}`;
  return "";
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}
