import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { RemotionProps } from "@attatta/shared";

function isStill(src: string) {
  return /\.(png|jpe?g|webp|gif)$/i.test(src);
}

function PlateVideo({ src, label, color }: { src: string; label: string; color: string }) {
  if (!src) return <PlateFallback label={label} color={color} />;
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
  if (isStill(src)) {
    return <Img src={src} style={style} />;
  }
  // OffthreadVideo for all video plates (http + relative). Remotion <Video>
  // requires seekable Range responses and was hanging delayRender on /files.
  return <OffthreadVideo src={src} style={style} />;
}

const FPS = 30;
export const SETUP_FRAMES = 3 * FPS;
export const PUNCH_FRAMES = 4 * FPS;
export const END_FRAMES = 3 * FPS;
export const TOTAL_FRAMES = SETUP_FRAMES + PUNCH_FRAMES + END_FRAMES;

export const PaidSocial9x16: React.FC<RemotionProps> = ({
  talentVideoSrc,
  handsVideoSrc,
  motionToken,
  copy,
  designTokens,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const endStart = SETUP_FRAMES + PUNCH_FRAMES;
  const endOpacity = interpolate(frame, [endStart, endStart + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: designTokens.colors.background,
        fontFamily: designTokens.fonts.body,
        color: designTokens.colors.foreground,
      }}
    >
      <Sequence from={0} durationInFrames={SETUP_FRAMES} name="Setup">
        <AbsoluteFill>
          <PlateVideo src={talentVideoSrc} label="Talent / Setup" color="#1c1917" />
          <CaptionBar text={copy.setup} tokens={designTokens} />
          <BeatChip label="Setup" />
        </AbsoluteFill>
      </Sequence>

      <Sequence from={SETUP_FRAMES} durationInFrames={PUNCH_FRAMES} name="Punchline">
        <AbsoluteFill>
          <PlateVideo src={handsVideoSrc} label="Hands / Punchline" color="#292524" />
          <CaptionBar text={copy.punchline} tokens={designTokens} />
          <BeatChip label={`Punchline · ${motionToken}`} />
        </AbsoluteFill>
      </Sequence>

      <Sequence from={endStart} durationInFrames={END_FRAMES} name="EndCard">
        <AbsoluteFill
          style={{
            opacity: endOpacity,
            background: `linear-gradient(160deg, ${designTokens.colors.background} 0%, ${designTokens.colors.muted} 100%)`,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            padding: 64,
            gap: 28,
          }}
        >
          <div
            style={{
              fontFamily: designTokens.fonts.display,
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              maxWidth: "90%",
            }}
          >
            {copy.endcard}
          </div>
          <div
            style={{
              alignSelf: designTokens.endCardLayout.ctaStyle === "solid" ? "flex-start" : "flex-start",
              background:
                designTokens.endCardLayout.ctaStyle === "solid"
                  ? designTokens.colors.accent
                  : "transparent",
              color:
                designTokens.endCardLayout.ctaStyle === "solid"
                  ? designTokens.colors.background
                  : designTokens.colors.accent,
              border: `2px solid ${designTokens.colors.accent}`,
              padding: "18px 36px",
              borderRadius: 8,
              fontSize: 28,
              fontWeight: 600,
            }}
          >
            {copy.cta}
          </div>
          {designTokens.socialChrome ? (
            <div style={{ position: "absolute", top: 40, right: 40, opacity: 0.5, fontSize: 18 }}>
              IG · frame
            </div>
          ) : null}
          <div style={{ fontSize: 16, opacity: 0.55 }}>{fps}fps · paid_social_9x16_v1</div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

function CaptionBar({
  text,
  tokens,
}: {
  text: string;
  tokens: RemotionProps["designTokens"];
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 40,
        right: 40,
        bottom: 80,
        padding: "20px 24px",
        background: "rgba(0,0,0,0.55)",
        borderRadius: 12,
        fontSize: 36,
        fontWeight: 600,
        fontFamily: tokens.fonts.display,
        lineHeight: 1.25,
      }}
    >
      {text}
    </div>
  );
}

function BeatChip({ label }: { label: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 40,
        left: 40,
        padding: "8px 14px",
        borderRadius: 999,
        background: "rgba(0,0,0,0.45)",
        fontSize: 18,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </div>
  );
}

function PlateFallback({ label, color }: { label: string; color: string }) {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
        fontSize: 42,
        opacity: 0.85,
      }}
    >
      {label}
    </AbsoluteFill>
  );
}
