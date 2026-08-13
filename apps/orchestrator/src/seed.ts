import "./loadEnv.js";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PATHS, REPO_ROOT } from "./config.js";
import {
  DEFAULT_BRAND_TOKEN_ID,
  DEFAULT_BRAND_TOKENS,
} from "./defaultTokens.js";
import { ensureDataDirs, saveCampaign } from "./store.js";
import {
  resolveOutputSizes,
  type Campaign,
  type Copy,
  type LibraryItem,
  META_RECOMMENDED_SIZE_IDS,
} from "@attatta/shared";

function makeClip(out: string, color: string, label: string, seconds = 4) {
  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=1080x1920:d=${seconds}`,
    "-vf",
    `drawtext=text='${label}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    out,
  ];
  const res = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`ffmpeg failed for ${out}`);
  }
}

function makeStill(out: string, color: string, label: string) {
  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=1024x1024:d=1`,
    "-vf",
    `drawtext=text='${label}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=(h-text_h)/2`,
    "-frames:v",
    "1",
    out,
  ];
  const res = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`ffmpeg still failed for ${out}`);
  }
}

async function main() {
  await ensureDataDirs();
  await mkdir(path.join(PATHS.library, "gen"), { recursive: true });

  await writeFile(
    path.join(PATHS.tokens, `${DEFAULT_BRAND_TOKEN_ID}.json`),
    JSON.stringify(DEFAULT_BRAND_TOKENS, null, 2),
  );

  const talentFile = "libraries/default/talent/ted_front_offer_03.mp4";
  const handsFiles = [
    "libraries/default/hands/hands_phone_swipe_a.mp4",
    "libraries/default/hands/hands_phone_tap_b.mp4",
    "libraries/default/hands/hands_phone_hold_c.mp4",
  ];

  makeClip(path.join(PATHS.data, talentFile), "0x1d4ed8", "TED TAKE 03", 4);
  makeClip(path.join(PATHS.data, handsFiles[0]), "0x15803d", "HANDS SWIPE A", 4);
  makeClip(path.join(PATHS.data, handsFiles[1]), "0x0f766e", "HANDS TAP B", 4);
  makeClip(path.join(PATHS.data, handsFiles[2]), "0x7c2d12", "HANDS HOLD C", 4);

  makeStill(path.join(PATHS.attire, "attire_casual_hoodie.png"), "0x334155", "HOODIE");
  makeStill(path.join(PATHS.background, "bg_soft_daylight_desk.png"), "0x78716c", "DESK BG");
  makeStill(path.join(PATHS.prop, "prop_hat_red.png"), "0xb91c1c", "HAT");
  makeStill(path.join(PATHS.prop, "prop_ribbon_gold.png"), "0xca8a04", "RIBBON");

  const talent: LibraryItem[] = [
    {
      id: "ted_front_offer_03",
      kind: "talent",
      label: "Ted · front · offer line 03",
      path: talentFile,
      tags: ["front", "offer", "flat-light"],
      promptHint: "male spokesperson Ted, front-facing, natural flat light, offer delivery",
      negativeHint: "different identity, face morph",
      mediaType: "video",
      status: "ready",
      sourceMode: "upload",
      sourceTalentId: null,
      locks: {
        face_locked: true,
        voice_locked: true,
        performance_locked: true,
      },
      contract: {
        face_locked: true,
        voice_locked: true,
        performance_locked: true,
        allow_attire: true,
        allow_background: true,
        allow_props_on_talent: true,
        allow_hands_variants: true,
        notes: "Demo contract — wardrobe/BG/props allowed; face/voice/performance locked.",
      },
    },
  ];

  const hands: LibraryItem[] = [
    {
      id: "hands_phone_swipe_a",
      kind: "hands",
      label: "Hands · phone swipe A",
      path: handsFiles[0],
      tags: ["phone", "swipe"],
      promptHint: "hands presenting smartphone, smooth swipe gesture",
      negativeHint: "",
      mediaType: "video",
      status: "ready",
      sourceMode: "upload",
      sourceTalentId: null,
    },
    {
      id: "hands_phone_tap_b",
      kind: "hands",
      label: "Hands · phone tap B",
      path: handsFiles[1],
      tags: ["phone", "tap"],
      promptHint: "hands tapping smartphone screen",
      negativeHint: "",
      mediaType: "video",
      status: "ready",
      sourceMode: "upload",
      sourceTalentId: null,
    },
    {
      id: "hands_phone_hold_c",
      kind: "hands",
      label: "Hands · phone hold C",
      path: handsFiles[2],
      tags: ["phone", "hold"],
      promptHint: "hands holding smartphone toward camera",
      negativeHint: "",
      mediaType: "video",
      status: "ready",
      sourceMode: "upload",
      sourceTalentId: null,
    },
  ];

  const motion: LibraryItem[] = [
    {
      id: "gesture_medium_v1",
      kind: "motion",
      label: "Gesture medium v1",
      path: "libraries/default/motion/gesture_medium_v1.json",
      tags: ["medium"],
      promptHint: "medium energy gesture, natural pacing",
      negativeHint: "",
      mediaType: "json",
      status: "ready",
      sourceMode: "upload",
      sourceTalentId: null,
    },
    {
      id: "gesture_punchy_v1",
      kind: "motion",
      label: "Gesture punchy v1",
      path: "libraries/default/motion/gesture_punchy_v1.json",
      tags: ["punchy"],
      promptHint: "punchy energetic gesture",
      negativeHint: "",
      mediaType: "json",
      status: "ready",
      sourceMode: "upload",
      sourceTalentId: null,
    },
  ];

  const attire: LibraryItem[] = [
    {
      id: "attire_casual_hoodie",
      kind: "attire",
      label: "Casual hoodie",
      path: "libraries/default/attire/attire_casual_hoodie.png",
      tags: ["hoodie", "casual"],
      promptHint: "soft charcoal hoodie, casual wardrobe",
      negativeHint: "formal suit",
      mediaType: "image",
      status: "ready",
      sourceMode: "upload",
      sourceTalentId: "ted_front_offer_03",
    },
    {
      id: "attire_blazer_navy_draft",
      kind: "attire",
      label: "Navy blazer (prompt-only)",
      path: "",
      tags: ["blazer", "formal"],
      promptHint: "navy blazer over white tee, business casual",
      negativeHint: "hoodie",
      mediaType: "none",
      status: "draft",
      sourceMode: "prompt_only",
      sourceTalentId: "ted_front_offer_03",
    },
  ];

  const background: LibraryItem[] = [
    {
      id: "bg_soft_daylight_desk",
      kind: "background",
      label: "Soft daylight desk",
      path: "libraries/default/background/bg_soft_daylight_desk.png",
      tags: ["desk", "daylight"],
      promptHint: "soft daylight home office desk, shallow depth of field",
      negativeHint: "busy crowd, neon club",
      mediaType: "image",
      status: "ready",
      sourceMode: "upload",
      sourceTalentId: "ted_front_offer_03",
    },
  ];

  const props: LibraryItem[] = [
    {
      id: "prop_hat_red",
      kind: "prop",
      label: "Red hat",
      path: "libraries/default/prop/prop_hat_red.png",
      tags: ["hat", "accessory"],
      promptHint: "bright red baseball cap accessory",
      negativeHint: "",
      mediaType: "image",
      status: "ready",
      sourceMode: "upload",
      sourceTalentId: "ted_front_offer_03",
    },
    {
      id: "prop_ribbon_gold",
      kind: "prop",
      label: "Gold ribbon",
      path: "libraries/default/prop/prop_ribbon_gold.png",
      tags: ["ribbon", "promo"],
      promptHint: "gold promo ribbon accent",
      negativeHint: "",
      mediaType: "image",
      status: "ready",
      sourceMode: "upload",
      sourceTalentId: "ted_front_offer_03",
    },
  ];

  await writeFile(
    path.join(PATHS.motion, "gesture_medium_v1.json"),
    JSON.stringify({ id: "gesture_medium_v1", intensity: 0.5 }, null, 2),
  );
  await writeFile(
    path.join(PATHS.motion, "gesture_punchy_v1.json"),
    JSON.stringify({ id: "gesture_punchy_v1", intensity: 0.85 }, null, 2),
  );
  await writeFile(path.join(PATHS.talent, "index.json"), JSON.stringify(talent, null, 2));
  await writeFile(path.join(PATHS.hands, "index.json"), JSON.stringify(hands, null, 2));
  await writeFile(path.join(PATHS.motion, "index.json"), JSON.stringify(motion, null, 2));
  await writeFile(path.join(PATHS.attire, "index.json"), JSON.stringify(attire, null, 2));
  await writeFile(path.join(PATHS.background, "index.json"), JSON.stringify(background, null, 2));
  await writeFile(path.join(PATHS.prop, "index.json"), JSON.stringify(props, null, 2));
  await writeFile(path.join(PATHS.theme, "index.json"), JSON.stringify([], null, 2));

  const copies: Copy[] = [
    {
      setup: "Tired of guessing which plan fits?",
      punchline: "See the right option in one swipe.",
      endcard: "Start free this week",
      cta: "Learn more",
    },
    {
      setup: "Your phone already knows your routine.",
      punchline: "We just make the next step obvious.",
      endcard: "Get the offer",
      cta: "Shop now",
    },
    {
      setup: "Small moment. Big clarity.",
      punchline: "Hands-on demo, zero fluff.",
      endcard: "Try it today",
      cta: "Get started",
    },
  ];

  const copyPlates: LibraryItem[] = copies.map((copy, i) => ({
    id: `copy_line_${i + 1}`,
    kind: "copy",
    label: `Copy line ${i + 1}`,
    path: `libraries/default/copy/copy_line_${i + 1}.json`,
    tags: ["copy", "demo"],
    promptHint: copy.setup,
    negativeHint: "",
    mediaType: "json",
    status: "ready",
    sourceMode: "upload",
    sourceTalentId: null,
    copy,
  }));
  await mkdir(PATHS.copy, { recursive: true });
  for (const plate of copyPlates) {
    await writeFile(
      path.join(PATHS.data, plate.path),
      JSON.stringify({ id: plate.id, label: plate.label, copy: plate.copy }, null, 2),
    );
  }
  await writeFile(path.join(PATHS.copy, "index.json"), JSON.stringify(copyPlates, null, 2));

  const outputSizes = resolveOutputSizes([...META_RECOMMENDED_SIZE_IDS]);
  const cells = [];
  let n = 1;
  for (const h of hands) {
    for (const copy of copies) {
      cells.push({
        cellId: `demo_${String(n).padStart(3, "0")}`,
        talentTakeId: "ted_front_offer_03",
        handsId: h.id,
        motionToken: "gesture_medium_v1",
        attireId: "attire_casual_hoodie",
        backgroundId: "bg_soft_daylight_desk",
        themeId: null,
        propIds: ["prop_hat_red"],
        copy,
        designTokenPackId: DEFAULT_BRAND_TOKEN_ID,
        needsGen: false,
        previewOk: false,
        outputPath: null,
        previewPath: null,
        genOmitIds: [],
        promptOverride: null,
        negativeOverride: null,
        sizeAssets: outputSizes.map((s) => ({
          sizeId: s.id,
          width: s.width,
          height: s.height,
          aspect: s.aspect,
          previewPath: null,
          outputPath: null,
          genPath: null,
          promptHash: null,
          status: "pending" as const,
          error: null,
        })),
        status: "draft" as const,
        error: null,
      });
      n += 1;
    }
  }

  const now = new Date().toISOString();
  const campaign: Campaign = {
    id: "demo_spring",
    name: "Demo Spring Hopper",
    templateId: "paid_social_9x16_v1",
    modelProfileId: process.env.COMFY_MODEL_PROFILE || "sd15",
    brief: {
      prompt:
        "Vertical paid social: Ted sets up the pain, hands show the phone moment, end card lands the offer.",
      audience: "Performance-curious mobile shoppers",
      offer: "Free trial week",
      cta: "Learn more",
      mustSay: ["free this week"],
      mustNot: ["guaranteed results"],
    },
    assemblyRecipe: {
      scenes: [
        { id: "setup", label: "Setup", role: "setup", durationSeconds: 3 },
        { id: "punchline", label: "Punchline", role: "punchline", durationSeconds: 4 },
        { id: "endcard", label: "End card", role: "endcard", durationSeconds: 3 },
      ],
      targetDurationSeconds: 10,
      copySuggestedSeconds: null,
    },
    designTokenPackId: DEFAULT_BRAND_TOKEN_ID,
    rail: {
      hero: {
        talentTakeId: "ted_front_offer_03",
        handsId: "hands_phone_swipe_a",
        motionToken: "gesture_medium_v1",
        attireId: "attire_casual_hoodie",
        backgroundId: "bg_soft_daylight_desk",
        themeId: null,
        propIds: ["prop_hat_red"],
      },
      openKnobs: ["hands", "copy"],
      allowedHandsIds: hands.map((h) => h.id),
      allowedAttireIds: ["attire_casual_hoodie"],
      allowedBackgroundIds: ["bg_soft_daylight_desk"],
      allowedPropIds: ["prop_hat_red", "prop_ribbon_gold"],
      allowedCopy: copies,
    },
    matrix: { cells, cap: 20, retired: [] },
    ingredientSet: {
      activeIds: [
        ...talent.map((t) => t.id),
        ...hands.map((h) => h.id),
        ...motion.map((m) => m.id),
        "attire_casual_hoodie",
        "bg_soft_daylight_desk",
        "prop_hat_red",
        "prop_ribbon_gold",
        ...copyPlates.map((c) => c.id),
        // draft blazer exists in library but deactivated for this campaign
      ],
      requireReadyMedia: false,
      contractTalentId: "ted_front_offer_03",
    },
    outputSizes,
    libraryId: "default",
    archived: false,
    createdAt: now,
    updatedAt: now,
  };

  await saveCampaign(campaign);

  console.log(
    "Seeded library (talent/hands/motion/attire/background/prop/copy), tokens, demo_spring",
  );
  console.log(`Repo root: ${REPO_ROOT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
