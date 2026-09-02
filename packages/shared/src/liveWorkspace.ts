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

export const CeltraPreviewRowSchema = z.object({
  order: z.number().int().positive(),
  cellId: z.string(),
  frame: z.string(),
  platePath: z.string().nullable(),
  setup: z.string().default(""),
  punchline: z.string().default(""),
  endcard: z.string().default(""),
  /** Review decision for this cell */
  decision: z.enum(["pending", "approved", "rejected"]).default("pending"),
  hasPlate: z.boolean().default(false),
  /** Included in next zip if packaged now */
  packable: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
});
export type CeltraPreviewRow = z.infer<typeof CeltraPreviewRowSchema>;

export const CeltraPreviewSchema = z.object({
  campaignId: z.string(),
  profileId: z.string(),
  rowCount: z.number().int().nonnegative(),
  approvedCount: z.number().int().nonnegative(),
  packableCount: z.number().int().nonnegative().default(0),
  rows: z.array(CeltraPreviewRowSchema).default([]),
  warnings: z.array(z.string()).default([]),
  updatedAt: z.string(),
});
export type CeltraPreview = z.infer<typeof CeltraPreviewSchema>;
