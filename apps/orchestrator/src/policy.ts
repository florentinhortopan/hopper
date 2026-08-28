import {
  DEFAULT_TALENT_CONTRACT,
  type Campaign,
  type Copy,
  type IngredientRail,
  type LibraryItem,
  type LibraryKind,
  type OpenKnob,
  type PolicyViolation,
  type TalentContract,
} from "@attatta/shared";

export function resolveTalentContract(talent: LibraryItem | undefined): TalentContract {
  if (!talent) return DEFAULT_TALENT_CONTRACT;
  if (talent.contract) return talent.contract;
  if (talent.locks) {
    return {
      ...DEFAULT_TALENT_CONTRACT,
      face_locked: talent.locks.face_locked,
      voice_locked: talent.locks.voice_locked,
      performance_locked: talent.locks.performance_locked,
    };
  }
  return DEFAULT_TALENT_CONTRACT;
}

/** Empty activeIds = legacy “all library”; hiddenIds always exclude. */
export function isIngredientActive(campaign: Campaign, ingredientId: string): boolean {
  const hidden = campaign.ingredientSet?.hiddenIds ?? [];
  if (hidden.includes(ingredientId)) return false;
  const ids = campaign.ingredientSet?.activeIds ?? [];
  if (ids.length === 0) return true;
  return ids.includes(ingredientId);
}

export function filterLibraryForCampaign(
  campaign: Campaign,
  lib: LibraryItem[],
): LibraryItem[] {
  const hidden = new Set(campaign.ingredientSet?.hiddenIds ?? []);
  const visible = hidden.size ? lib.filter((i) => !hidden.has(i.id)) : lib;
  const ids = campaign.ingredientSet?.activeIds ?? [];
  if (ids.length === 0) return visible;
  const set = new Set(ids);
  return visible.filter((i) => set.has(i.id));
}

/** Collect every ingredient id referenced by a rail (hero + allowlists). */
export function railReferencedIds(rail: IngredientRail): string[] {
  const ids = [
    rail.hero.talentTakeId,
    rail.hero.handsId,
    rail.hero.motionToken,
    rail.hero.attireId,
    rail.hero.backgroundId,
    rail.hero.themeId,
    ...(rail.hero.propIds ?? []),
    ...(rail.allowedHandsIds ?? []),
    ...(rail.allowedAttireIds ?? []),
    ...(rail.allowedBackgroundIds ?? []),
    ...(rail.allowedPropIds ?? []),
  ].filter((x): x is string => Boolean(x && String(x).trim()));
  return [...new Set(ids)];
}

/**
 * Union rail-referenced plates into campaign activeIds so pinning/allowlisting
 * on the rail implies activation (minimal kits don't fail on save).
 */
export function activateRailIngredients(
  campaign: Campaign,
  rail: IngredientRail,
  lib: LibraryItem[],
): void {
  const known = new Set(lib.map((i) => i.id));
  const prev = campaign.ingredientSet?.activeIds ?? [];
  const next = new Set(prev);
  for (const id of railReferencedIds(rail)) {
    if (!known.has(id)) continue;
    if ((campaign.ingredientSet?.hiddenIds ?? []).includes(id)) continue;
    next.add(id);
  }
  if (!campaign.ingredientSet) {
    campaign.ingredientSet = {
      activeIds: [...next],
      hiddenIds: [],
      requireReadyMedia: true,
      contractTalentId: rail.hero.talentTakeId || null,
    };
  } else {
    campaign.ingredientSet.activeIds = [...next];
  }
}

/**
 * Derive the internal rail from campaign activations.
 * Fan rule: 2+ active of a kind → open that knob + allowlist all; 1 → hero pin only.
 * Copy plates (kind=copy) replace rail.allowedCopy; otherwise keep previous / brief defaults.
 * The Rail step is dissolved — operators activate on Ingredients, build on Matrix.
 */
export function deriveRailFromActivations(
  campaign: Campaign,
  lib: LibraryItem[],
  previous?: IngredientRail | null,
): IngredientRail {
  const active = filterLibraryForCampaign(campaign, lib);
  const of = (kind: LibraryKind) => active.filter((i) => i.kind === kind);

  const talents = of("talent");
  const hands = of("hands");
  const motions = of("motion");
  const attires = of("attire");
  const backgrounds = of("background");
  const props = of("prop");
  const themes = of("theme");
  const copies = of("copy");

  const contractId = campaign.ingredientSet?.contractTalentId;
  const talentTakeId =
    (contractId && talents.some((t) => t.id === contractId) ? contractId : null) ||
    talents[0]?.id ||
    "";

  // Visual / Comfy axes only — copy plates append at Remotion assemble, not matrix fan.
  const openKnobs: OpenKnob[] = [];
  if (hands.length > 1) openKnobs.push("hands");
  if (attires.length > 1) openKnobs.push("attire");
  if (backgrounds.length > 1) openKnobs.push("background");
  if (props.length > 1) openKnobs.push("prop");

  const copyFromPlates: Copy[] = copies
    .map((c) => c.copy)
    .filter((c): c is Copy => Boolean(c?.setup || c?.punchline || c?.cta || c?.endcard));

  const briefFallback: Copy = {
    setup: campaign.brief.prompt?.trim().slice(0, 120) || "Setup",
    punchline: campaign.brief.offer?.trim() || "Punchline",
    endcard: campaign.brief.offer?.trim() || "Offer",
    cta: campaign.brief.cta?.trim() || "Learn more",
  };

  const allowedCopy =
    copyFromPlates.length > 0
      ? copyFromPlates
      : previous?.allowedCopy?.length
        ? previous.allowedCopy
        : [briefFallback];

  return {
    hero: {
      talentTakeId,
      handsId: hands[0]?.id || "",
      motionToken: motions[0]?.id || "",
      attireId: attires[0]?.id ?? null,
      backgroundId: backgrounds[0]?.id ?? null,
      themeId: themes[0]?.id ?? null,
      propIds: props.length === 1 ? [props[0]!.id] : props.slice(0, 1).map((p) => p.id),
    },
    openKnobs,
    allowedHandsIds: hands.length > 1 ? hands.map((h) => h.id) : [],
    allowedAttireIds: attires.length > 1 ? attires.map((a) => a.id) : [],
    allowedBackgroundIds: backgrounds.length > 1 ? backgrounds.map((b) => b.id) : [],
    allowedPropIds: props.length > 1 ? props.map((p) => p.id) : [],
    allowedCopy,
  };
}

/** Drop allowlist / hero refs that are inactive so rail stays in sync with Ingredients. */
export function pruneRailToActive(
  campaign: Campaign,
  rail: IngredientRail,
  lib: LibraryItem[],
): IngredientRail {
  const known = new Set(lib.map((i) => i.id));
  const ok = (id: string | null | undefined) =>
    Boolean(id && known.has(id) && isIngredientActive(campaign, id));
  const filterIds = (ids: string[]) => ids.filter((id) => ok(id));
  const firstActive = (kind: LibraryItem["kind"]) =>
    lib.find((i) => i.kind === kind && isIngredientActive(campaign, i.id))?.id ?? null;

  const hero = { ...rail.hero };
  // Talent: prefer an active replacement. Hands/motion: clear if inactive (optional).
  if (!ok(hero.talentTakeId)) {
    hero.talentTakeId = firstActive("talent") || "";
  }
  if (!ok(hero.handsId)) {
    hero.handsId = "";
  }
  if (!ok(hero.motionToken)) {
    hero.motionToken = "";
  }
  hero.attireId = ok(hero.attireId) ? hero.attireId : null;
  hero.backgroundId = ok(hero.backgroundId) ? hero.backgroundId : null;
  hero.themeId = ok(hero.themeId) ? hero.themeId : null;
  hero.propIds = filterIds(hero.propIds ?? []);

  const allowedHandsIds = filterIds(rail.allowedHandsIds ?? []);
  const allowedAttireIds = filterIds(rail.allowedAttireIds ?? []);
  const allowedBackgroundIds = filterIds(rail.allowedBackgroundIds ?? []);
  const allowedPropIds = filterIds(rail.allowedPropIds ?? []);

  // Close optional fans that lost every active plate (don't keep a hollow open knob)
  const openKnobs = (rail.openKnobs ?? []).filter((k) => {
    if (k === "attire") {
      return Boolean(hero.attireId) || allowedAttireIds.length > 0;
    }
    if (k === "background") {
      return Boolean(hero.backgroundId) || allowedBackgroundIds.length > 0;
    }
    if (k === "prop") {
      return hero.propIds.length > 0 || allowedPropIds.length > 0;
    }
    if (k === "hands") {
      return Boolean(hero.handsId) || allowedHandsIds.length > 0;
    }
    return true;
  });

  return {
    ...rail,
    hero,
    openKnobs,
    allowedHandsIds,
    allowedAttireIds,
    allowedBackgroundIds,
    allowedPropIds,
  };
}

export function evaluateCampaignPolicy(
  campaign: Campaign,
  rail: IngredientRail,
  lib: LibraryItem[],
): PolicyViolation[] {
  const byId = new Map(lib.map((i) => [i.id, i]));
  const violations: PolicyViolation[] = [];
  const requireReady = campaign.ingredientSet?.requireReadyMedia ?? false;

  const talentId =
    campaign.ingredientSet?.contractTalentId || rail.hero.talentTakeId;
  const talent = byId.get(talentId);
  const contract = resolveTalentContract(talent);

  const checkId = (
    id: string | null | undefined,
    knob?: PolicyViolation["knob"],
    /** Ready-media gate — only for assemble-critical plates (talent, optional hands). */
    gateReady = false,
  ) => {
    if (!id) return;
    const item = byId.get(id);
    if (!item) {
      violations.push({
        code: "unknown_ingredient",
        message: `Unknown ingredient ${id}`,
        ingredientId: id,
        knob,
      });
      return;
    }
    if (!isIngredientActive(campaign, id)) {
      violations.push({
        code: "inactive",
        message: `"${item.label}" is not activated for this campaign`,
        ingredientId: id,
        kind: item.kind,
        knob,
      });
    }
    if (gateReady && requireReady) {
      if (item.status !== "ready") {
        violations.push({
          code: "not_ready",
          message: `"${item.label}" is ${item.status} — generate or upload before assemble`,
          ingredientId: id,
          kind: item.kind,
          knob,
        });
      }
      if (!item.path || item.mediaType === "none") {
        violations.push({
          code: "missing_media",
          message: `"${item.label}" has no media asset yet`,
          ingredientId: id,
          kind: item.kind,
          knob,
        });
      }
    }
  };

  // Minimal kit: talent is required. Hands / motion are optional (BG-only rails).
  if (!rail.hero.talentTakeId?.trim()) {
    violations.push({
      code: "unknown_ingredient",
      message: "Activate a talent take on Ingredients",
      knob: undefined,
    });
  }

  checkId(rail.hero.talentTakeId, undefined, true);
  checkId(rail.hero.handsId, "hands", true);
  checkId(rail.hero.motionToken, "motion", false);
  checkId(rail.hero.attireId, "attire", false);
  checkId(rail.hero.backgroundId, "background", false);
  checkId(rail.hero.themeId, undefined, false);
  for (const id of rail.hero.propIds) checkId(id, "prop", false);
  for (const id of rail.allowedHandsIds) checkId(id, "hands", true);
  for (const id of rail.allowedAttireIds) checkId(id, "attire", false);
  for (const id of rail.allowedBackgroundIds) checkId(id, "background", false);
  for (const id of rail.allowedPropIds) checkId(id, "prop", false);

  if (!contract.allow_attire) {
    if (rail.openKnobs.includes("attire") || rail.hero.attireId || rail.allowedAttireIds.length) {
      violations.push({
        code: "contract_attire",
        message: "Talent contract forbids attire / wardrobe changes",
        knob: "attire",
      });
    }
  }
  if (!contract.allow_background) {
    if (
      rail.openKnobs.includes("background") ||
      rail.hero.backgroundId ||
      rail.allowedBackgroundIds.length
    ) {
      violations.push({
        code: "contract_background",
        message: "Talent contract forbids background changes",
        knob: "background",
      });
    }
  }
  if (!contract.allow_props_on_talent) {
    if (
      rail.openKnobs.includes("prop") ||
      rail.hero.propIds.length ||
      rail.allowedPropIds.length
    ) {
      violations.push({
        code: "contract_props",
        message: "Talent contract forbids props on talent (hats, ribbons, etc.)",
        knob: "prop",
      });
    }
  }
  if (!contract.allow_hands_variants) {
    if (rail.openKnobs.includes("hands") && rail.allowedHandsIds.length > 1) {
      violations.push({
        code: "contract_hands",
        message: "Talent contract forbids hands variants beyond the hero plate",
        knob: "hands",
      });
    }
  }
  if (!contract.face_locked) {
    /* unusual — warn only if someone disabled face lock */
  } else if (talent && talent.locks && !talent.locks.face_locked) {
    violations.push({
      code: "contract_face",
      message: "Face lock must remain enabled for contracted talent",
      ingredientId: talent.id,
      kind: "talent",
    });
  }

  return violations;
}

export function allowedKindsForContract(contract: TalentContract): string[] {
  const kinds = ["talent", "hands", "motion", "theme", "copy"];
  if (contract.allow_attire) kinds.push("attire");
  if (contract.allow_background) kinds.push("background");
  if (contract.allow_props_on_talent) kinds.push("prop");
  return kinds;
}
