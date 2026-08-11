"use client";

import { Player } from "@remotion/player";
import { PaidSocial9x16, TOTAL_FRAMES } from "@attatta/remotion-template";
import type { RemotionProps } from "@attatta/shared";

export function PreviewPlayer({ props }: { props: RemotionProps }) {
  const width = props.width || 1080;
  const height = props.height || 1920;
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-200 bg-ink-900 shadow-lg">
      <Player
        component={PaidSocial9x16}
        inputProps={props}
        durationInFrames={TOTAL_FRAMES}
        compositionWidth={width}
        compositionHeight={height}
        fps={30}
        style={{
          width: "100%",
          aspectRatio: `${width} / ${height}`,
          maxHeight: 640,
        }}
        controls
      />
    </div>
  );
}
