import { z } from "zod";

export const LiveColumnIdSchema = z.enum(["magic", "hopper", "celtra"]);
export type LiveColumnId = z.infer<typeof LiveColumnIdSchema>;

export const CampaignEventTypeSchema = z.enum([
  "workspace_opened",
  "user_note",
  "user_command",
  "magic_prepare",
  "magic_generate",
  "job_update",
  "review_decision",
  "comfy_publish",
  "celtra_preview",
  "celtra_package",
  "system",
]);
export type CampaignEventType = z.infer<typeof CampaignEventTypeSchema>;

export const CampaignEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  campaignId: z.string(),
  column: LiveColumnIdSchema,
  type: CampaignEventTypeSchema,
  summary: z.string(),
  payload: z.record(z.unknown()).default({}),
});
export type CampaignEvent = z.infer<typeof CampaignEventSchema>;

export const CeltraPreviewSizeSlotSchema = z.object({
  sizeId: z.string(),
  aspect: z.string(),
  label: z.string(),
  platePath: z.string().nullable().default(null),
  ready: z.boolean().default(false),
  decision: z.enum(["pending", "approved", "rejected"]).default("pending"),
  packable: z.boolean().default(false),
  width: z.number().int().nullable().default(null),
  height: z.number().int().nullable().default(null),
});
export type CeltraPreviewSizeSlot = z.infer<typeof CeltraPreviewSizeSlotSchema>;

export const CeltraPreviewRowSchema = z.object({
  order: z.number().int().positive(),
  cellId: z.string(),
  frame: z.string(),
  /** Primary / first-ready plate (legacy thumb). */
  platePath: z.string().nullable(),
  setup: z.string().default(""),
  punchline: z.string().default(""),
  endcard: z.string().default(""),
  /** Review decision for this cell */
  decision: z.enum(["pending", "approved", "rejected"]).default("pending"),
  hasPlate: z.boolean().default(false),
  /** Included in next zip if packaged now */
  packable: z.boolean().default(false),
  /** One Celtra order row; Settings sizes live on the row (SIZE explode / native plates). */
  sizes: z.array(CeltraPreviewSizeSlotSchema).default([]),
  sizesReady: z.number().int().nonnegative().default(0),
  sizesTotal: z.number().int().nonnegative().default(0),
  warnings: z.array(z.string()).default([]),
});
export type CeltraPreviewRow = z.infer<typeof CeltraPreviewRowSchema>;

export const CeltraPreviewSchema = z.object({
  campaignId: z.string(),
  profileId: z.string(),
  rowCount: z.number().int().nonnegative(),
  approvedCount: z.number().int().nonnegative(),
  packableCount: z.number().int().nonnegative().default(0),
  /** Campaign Settings sizes — columns on each content-matrix row. */
  sizes: z
    .array(
      z.object({
        id: z.string(),
        aspect: z.string(),
        label: z.string(),
      }),
    )
    .default([]),
  sizeSlotReady: z.number().int().nonnegative().default(0),
  sizeSlotTotal: z.number().int().nonnegative().default(0),
  rows: z.array(CeltraPreviewRowSchema).default([]),
  warnings: z.array(z.string()).default([]),
  updatedAt: z.string(),
});
export type CeltraPreview = z.infer<typeof CeltraPreviewSchema>;

/** Live workspace API connection chips (column headers). */
export const LiveConnectionIdSchema = z.enum(["comfy", "hopper", "celtra"]);
export type LiveConnectionId = z.infer<typeof LiveConnectionIdSchema>;

export const LiveConnectionStateSchema = z.enum([
  "ok",
  "degraded",
  "down",
  "simulated",
]);
export type LiveConnectionState = z.infer<typeof LiveConnectionStateSchema>;

export const LiveConnectionSchema = z.object({
  id: LiveConnectionIdSchema,
  /** Short chip label */
  label: z.string(),
  state: LiveConnectionStateSchema,
  detail: z.string(),
  endpoint: z.string().default(""),
  lastCheckedAt: z.string(),
  lastSyncedAt: z.string().nullable().default(null),
  /** Extra bullets for the popup */
  notes: z.array(z.string()).default([]),
});
export type LiveConnection = z.infer<typeof LiveConnectionSchema>;

export const LiveConnectionsResponseSchema = z.object({
  connections: z.array(LiveConnectionSchema),
  checkedAt: z.string(),
});
export type LiveConnectionsResponse = z.infer<
  typeof LiveConnectionsResponseSchema
>;

export const LiveConnectionResyncResultSchema = z.object({
  connection: LiveConnectionSchema,
  message: z.string(),
});
export type LiveConnectionResyncResult = z.infer<
  typeof LiveConnectionResyncResultSchema
>;

/** Map live column → connection chip. */
export function connectionIdForColumn(
  column: LiveColumnId,
): LiveConnectionId {
  if (column === "magic") return "comfy";
  if (column === "hopper") return "hopper";
  return "celtra";
}