import { z } from "zod";

/**
 * Live workspace chrome themes (campaign-scoped).
 * Distinct from ingredient `themeId` and Remotion `designTokenPackId`.
 */
export const WorkspaceThemeIdSchema = z.enum(["vanilla", "att"]);
export type WorkspaceThemeId = z.infer<typeof WorkspaceThemeIdSchema>;

export const DEFAULT_WORKSPACE_THEME_ID: WorkspaceThemeId = "vanilla";

export type WorkspaceThemeDef = {
  id: WorkspaceThemeId;
  label: string;
  description: string;
  /** Suggested Remotion / end-card pack when this UI theme is active. */
  designTokenPackId: string;
  /** Swatch chips for the switcher UI */
  swatches: [string, string, string];
};

export const WORKSPACE_THEMES: Record<WorkspaceThemeId, WorkspaceThemeDef> = {
  vanilla: {
    id: "vanilla",
    label: "Vanilla",
    description: "Parchment & ink — ATTATTA house style",
    designTokenPackId: "brand_default_v3",
    swatches: ["#f3efe6", "#1a1a1a", "#d45d40"],
  },
  att: {
    id: "att",
    label: "AT&T",
    description: "AT&T Blue · New Orange — corporate clean",
    designTokenPackId: "brand_att_v1",
    swatches: ["#E8F1F6", "#067AB4", "#FF7200"],
  },
};

export const WORKSPACE_THEME_LIST: WorkspaceThemeDef[] = [
  WORKSPACE_THEMES.vanilla,
  WORKSPACE_THEMES.att,
];

export function resolveWorkspaceThemeId(
  raw: string | null | undefined,
): WorkspaceThemeId {
  const parsed = WorkspaceThemeIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_WORKSPACE_THEME_ID;
}

export function getWorkspaceTheme(
  id: string | null | undefined,
): WorkspaceThemeDef {
  return WORKSPACE_THEMES[resolveWorkspaceThemeId(id)];
}
