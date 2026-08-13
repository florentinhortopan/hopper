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
import {
  assemblySceneFrames,
  DEFAULT_ASSEMBLY_SCENES,
  type AssemblyRecipe,
  type RemotionProps,
} from "@attatta/shared";

function isStill(src: string) {
  return /\.(png|jpe?g|webp|gif)$/i.test(src);
}

function PlateVideo({ src, label, color }: { src: string; label: string; color: string }) {
  if (!src) return <PlateFallback label={label} color={color} />;
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
  if (isStill(src)) {
    return <Img src={src} style={style} />;
  }
  return <OffthreadVideo src={src} style={style} />;
}

const FPS = 30;
export const SETUP_FRAMES = 3 * FPS;
export const PUNCH_FRAMES = 4 * FPS;
export const END_FRAMES = 3 * FPS;
export const TOTAL_FRAMES = SETUP_FRAMES + PUNCH_FRAMES + END_FRAMES;

function defaultRecipe(): AssemblyRecipe {
  return {
    scenes: DEFAULT_ASSEMBLY_SCENES,
    targetDurationSeconds: null,
    copySuggestedSeconds: null,
  };
}

export function totalFramesFromRecipe(recipe?: AssemblyRecipe | null, fps = FPS): number {
  const frames = assemblySceneFrames(recipe ?? defaultRecipe(), fps);
  return Math.max(1, frames.reduce((n, s) => n + s.frames, 0));
}

export const PaidSocial9x16: React.FC<RemotionProps> = ({
  talentVideoSrc,
  handsVideoSrc,
  motionToken,
  copy,
  designTokens,
  assemblyRecipe,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scenes = assemblySceneFrames(assemblyRecipe ?? defaultRecipe(), fps);

  let cursor = 0;
  const sequenced = scenes.map((s) => {
    const from = cursor;
    cursor += s.frames;
    return { ...s, from };
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: designTokens.colors.background,
        fontFamily: designTokens.fonts.body,
        color: designTokens.colors.foreground,
      }}
    >
      {sequenced.map((s) => {
        const role = s.role;
        const isSetup = role === "setup" || (!role && s.id === "setup");
        const isPunch = role === "punchline" || s.id === "punchline";
        const isEnd = role === "endcard" || s.id === "endcard";
        const src = isPunch ? handsVideoSrc : talentVideoSrc;
        const caption = isEnd
          ? null
          : isPunch
            ? copy.punchline
            : copy.setup;
        const endOpacity = isEnd
          ? interpolate(frame, [s.from, s.from + 10], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          : 1;

        return (
          <Sequence key={s.id} from={s.from} durationInFrames={s.frames} name={s.label}>
            {isEnd ? (
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
                    alignSelf: "flex-start",
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
            ) : (
              <AbsoluteFill>
                <PlateVideo
                  src={src}
                  label={isPunch ? "Hands / Punchline" : "Talent / Setup"}
                  color={isPunch ? "#292524" : "#1c1917"}
                />
                {caption ? <CaptionBar text={caption} tokens={designTokens} /> : null}
                <BeatChip
                  label={
                    isPunch ? `Punchline · ${motionToken}` : isSetup ? "Setup" : s.label
                  }
                />
              </AbsoluteFill>
            )}
          </Sequence>
        );
      })}
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
