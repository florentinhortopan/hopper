import React from "react";
import { Composition } from "remotion";
import {
  PaidSocial9x16,
  TOTAL_FRAMES,
  totalFramesFromRecipe,
} from "./PaidSocial9x16";
import { DEFAULT_ASSEMBLY_RECIPE, type RemotionProps } from "@attatta/shared";

export const defaultProps: RemotionProps = {
  talentVideoSrc: "",
  handsVideoSrc: "",
  motionToken: "gesture_medium_v1",
  copy: {
    setup: "When you need a clearer signal…",
    punchline: "One tap. Right product. Right moment.",
    endcard: "Try it free this week",
    cta: "Learn more",
  },
  designTokens: {
    id: "brand_default_v3",
    label: "Brand Default v3",
    colors: {
      background: "#1c1917",
      foreground: "#fafaf9",
      accent: "#ea580c",
      muted: "#44403c",
    },
    fonts: {
      display: "Georgia, serif",
      body: "system-ui, sans-serif",
    },
    endCardLayout: {
      ctaStyle: "solid",
      logoPosition: "bottom",
    },
    socialChrome: false,
  },
  width: 1080,
  height: 1920,
  sizeId: "v_9x16_1080",
  aspect: "9:16",
  assemblyRecipe: DEFAULT_ASSEMBLY_RECIPE,
  sceneMedia: [],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="paid-social-9x16-v1"
      component={PaidSocial9x16}
      durationInFrames={TOTAL_FRAMES}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => ({
        width: props.width || 1080,
        height: props.height || 1920,
        durationInFrames: totalFramesFromRecipe(props.assemblyRecipe, 30),
      })}
    />
  );
};
