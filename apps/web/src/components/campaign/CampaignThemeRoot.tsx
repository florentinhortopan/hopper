"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  resolveWorkspaceThemeId,
  type WorkspaceThemeId,
} from "@attatta/shared";
import { api } from "@/lib/api";

const ThemeCtx = createContext<WorkspaceThemeId>("vanilla");

export function useCampaignThemeId(): WorkspaceThemeId {
  return useContext(ThemeCtx);
}

/** Broadcast after PATCH so open campaign chrome refreshes without remount. */
export function notifyCampaignTheme(
  campaignId: string,
  themeId: WorkspaceThemeId,
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("attatta:campaign-theme", {
      detail: { campaignId, themeId },
    }),
  );
}

type Props = {
  campaignId: string;
  children: ReactNode;
};

/**
 * Loads campaign.workspaceThemeId and applies it to the document so all
 * campaign pages (and live workspace) share one client brand skin.
 */
export function CampaignThemeRoot({ campaignId, children }: Props) {
  const [themeId, setThemeId] = useState<WorkspaceThemeId>("vanilla");

  const apply = useCallback((id: WorkspaceThemeId) => {
    setThemeId(id);
    if (typeof document === "undefined") return;
    document.documentElement.dataset.campaignTheme = id;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api
      .getCampaign(campaignId)
      .then((c) => {
        if (cancelled) return;
        apply(resolveWorkspaceThemeId(c.workspaceThemeId));
      })
      .catch(() => {
        if (!cancelled) apply("vanilla");
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, apply]);

  useEffect(() => {
    function onTheme(e: Event) {
      const detail = (e as CustomEvent<{ campaignId: string; themeId: string }>)
        .detail;
      if (!detail || detail.campaignId !== campaignId) return;
      apply(resolveWorkspaceThemeId(detail.themeId));
    }
    window.addEventListener("attatta:campaign-theme", onTheme);
    return () => window.removeEventListener("attatta:campaign-theme", onTheme);
  }, [campaignId, apply]);

  useEffect(() => {
    return () => {
      if (typeof document === "undefined") return;
      delete document.documentElement.dataset.campaignTheme;
    };
  }, []);

  return <ThemeCtx.Provider value={themeId}>{children}</ThemeCtx.Provider>;
}
