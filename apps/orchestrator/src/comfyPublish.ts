import { nanoid } from "nanoid";
import {
  DEFAULT_LIBRARY_ID,
  LibraryKindSchema,
  type LibraryItem,
  type LibraryKind,
} from "@attatta/shared";
import {
  createLibraryIngredient,
  patchLibraryItem,
  replaceLibraryMedia,
} from "./library.js";
import { deriveRailFromActivations } from "./policy.js";
import { getCampaign, listLibrary, saveCampaign } from "./store.js";

export type ComfyPublishEvent = {
  id: string;
  at: string;
  item: LibraryItem;
  libraryId: string;
  campaignId: string | null;
  activated: boolean;
  replacedId: string | null;
  label: string;
  kind: LibraryKind;
};

const RECENT_CAP = 40;
const recent: ComfyPublishEvent[] = [];

export function listRecentComfyPublishes(opts?: {
  since?: string | null;
  libraryId?: string | null;
  campaignId?: string | null;
  limit?: number;
}): ComfyPublishEvent[] {
  const sinceMs = opts?.since ? Date.parse(opts.since) : NaN;
  const lim = Math.min(Math.max(opts?.limit ?? 20, 1), RECENT_CAP);
  return recent
    .filter((e) => {
      if (opts?.libraryId && e.libraryId !== opts.libraryId) return false;
      if (opts?.campaignId && e.campaignId !== opts.campaignId) return false;
      if (Number.isFinite(sinceMs) && Date.parse(e.at) <= sinceMs) return false;
      return true;
    })
    .slice(0, lim);
}

function pushRecent(event: ComfyPublishEvent) {
  recent.unshift(event);
  if (recent.length > RECENT_CAP) recent.length = RECENT_CAP;
}

export function assertComfyPublishAuth(key: string | undefined | null): void {
  const expected = process.env.ATTATTA_COMFY_PUBLISH_KEY?.trim();
  if (!expected) {
    // Local/dev: open publish (set ATTATTA_COMFY_PUBLISH_KEY in shared envs)
    return;
  }
  if (!key || key.trim() !== expected) {
    throw new Error("Invalid or missing X-Attatta-Publish-Key");
  }
}

export async function activateIngredientOnCampaign(
  campaignId: string,
  itemId: string,
): Promise<void> {
  const campaign = await getCampaign(campaignId);
  const libraryId = campaign.libraryId || DEFAULT_LIBRARY_ID;
  const prev = campaign.ingredientSet ?? {
    activeIds: [],
    hiddenIds: [],
    requireReadyMedia: true,
    contractTalentId: null,
  };
  const hiddenIds = (prev.hiddenIds ?? []).filter((id) => id !== itemId);
  let activeIds = [...(prev.activeIds ?? [])];
  if (activeIds.length === 0) {
    // Legacy “all visible”: materialize current pack minus hidden, plus new id
    const lib = await listLibrary(undefined, libraryId, { includeArchived: true });
    activeIds = lib
      .filter((i) => !hiddenIds.includes(i.id))
      .map((i) => i.id);
    if (!activeIds.includes(itemId)) activeIds.push(itemId);
  } else if (!activeIds.includes(itemId)) {
    activeIds.push(itemId);
  }
  campaign.ingredientSet = {
    ...prev,
    activeIds,
    hiddenIds,
  };
  const lib = await listLibrary(undefined, libraryId);
  campaign.rail = deriveRailFromActivations(campaign, lib, campaign.rail);
  await saveCampaign(campaign);
}

export type ComfyPublishInput = {
  kind: string;
  label: string;
  libraryId?: string | null;
  campaignId?: string | null;
  replacesId?: string | null;
  activate?: boolean;
  tags?: string[];
  promptHint?: string;
  filename: string;
  buffer: Buffer;
};

export async function publishComfyIngredient(
  input: ComfyPublishInput,
): Promise<ComfyPublishEvent> {
  const kindParsed = LibraryKindSchema.safeParse(input.kind);
  if (!kindParsed.success) {
    throw new Error(`Invalid kind: ${input.kind}`);
  }
  const kind = kindParsed.data;
  if (kind === "copy" || kind === "motion") {
    throw new Error(
      "Publish media plates only (talent/hands/attire/background/prop/theme) — not copy/motion metadata",
    );
  }
  const label = input.label.trim();
  if (!label) throw new Error("label required");
  if (!input.buffer?.length) throw new Error("file required");

  const libraryId = (input.libraryId || DEFAULT_LIBRARY_ID).trim() || DEFAULT_LIBRARY_ID;
  const tags = [
    "comfy-publish",
    "designer",
    ...(input.tags || []).map((t) => t.trim()).filter(Boolean),
  ];
  const replacesId = input.replacesId?.trim() || null;

  let item: LibraryItem;
  if (replacesId) {
    item = await replaceLibraryMedia(
      replacesId,
      input.filename,
      input.buffer,
      libraryId,
    );
    item = await patchLibraryItem(
      replacesId,
      {
        label,
        tags: [...new Set([...(item.tags || []), ...tags])],
        promptHint: input.promptHint?.trim() || item.promptHint || label,
        archived: false,
      },
      libraryId,
    );
  } else {
    item = await createLibraryIngredient({
      kind,
      label,
      tags,
      promptHint: input.promptHint?.trim() || label,
      filename: input.filename,
      buffer: input.buffer,
      libraryId,
      allowNoMedia: false,
    });
  }

  const campaignId = input.campaignId?.trim() || null;
  let activated = false;
  if (campaignId && input.activate !== false) {
    await activateIngredientOnCampaign(campaignId, item.id);
    activated = true;
  }

  const event: ComfyPublishEvent = {
    id: nanoid(10),
    at: new Date().toISOString(),
    item,
    libraryId,
    campaignId,
    activated,
    replacedId: replacesId,
    label: item.label,
    kind: item.kind,
  };
  pushRecent(event);
  if (campaignId) {
    void import("./campaignEvents.js").then(({ emitCampaignEvent }) => {
      emitCampaignEvent({
        campaignId,
        column: "magic",
        type: "comfy_publish",
        summary: `Comfy publish · ${item.kind} “${item.label}”${activated ? " (activated)" : ""}`,
        payload: {
          itemId: item.id,
          kind: item.kind,
          label: item.label,
          activated,
        },
      });
    });
  }
  return event;
}
