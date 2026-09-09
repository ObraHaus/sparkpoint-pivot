"use client";

/**
 * useContent — react-query reads for the Alpha content surfaces (mirrors {@link usePortfolioView}):
 *   - useChangelog()    → the live What's-New feed (GET /content/changelog)
 *   - useAnnouncement() → the single active announcement, or null (GET /content/announcement)
 *   - useTips()         → rotating sidebar tips from the Obsidian 'tip' databank (GET /tips)
 *
 * All are GET-only through the same-origin beta-gated BFF (no bearer in the browser). When no
 * wallet is connected every hook reports offline and returns empty/null, so the widget + /changelog
 * page hide gracefully — never a crash, never a blocked exit path (non-custody law).
 */

import { useQuery } from "@tanstack/react-query";

import { useAgentClient } from "@/lib/agent/useAgent";

export interface ContentEntry {
  id: number;
  type: "changelog" | "announcement";
  title: string;
  body: string;
  tag: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  isActive: boolean;
  publishedAt: string;
  updatedAt: string;
}

export interface Tip {
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaHref: string | null;
}

interface ChangelogResponse {
  entries?: ContentEntry[];
}
interface AnnouncementResponse {
  announcement?: ContentEntry | null;
}
interface TipsResponse {
  tips?: Tip[];
}

export interface ChangelogView {
  entries: ContentEntry[];
  online: boolean;
  loading: boolean;
}

export function useChangelog(): ChangelogView {
  const { client, online, identity } = useAgentClient();
  const query = useQuery({
    queryKey: ["agent", "changelog", identity?.account, identity?.chainId],
    enabled: online,
    staleTime: 60_000,
    retry: false,
    queryFn: ({ signal }) =>
      client!.request<ChangelogResponse>("/content/changelog", { signal }),
  });
  return {
    entries: Array.isArray(query.data?.entries) ? query.data!.entries : [],
    online,
    loading: online && query.isLoading,
  };
}

export function useAnnouncement(): ContentEntry | null {
  const { client, online, identity } = useAgentClient();
  const query = useQuery({
    queryKey: ["agent", "announcement", identity?.account, identity?.chainId],
    enabled: online,
    staleTime: 60_000,
    retry: false,
    queryFn: ({ signal }) =>
      client!.request<AnnouncementResponse>("/content/announcement", { signal }),
  });
  if (!online) return null;
  const announcement = query.data?.announcement;
  return announcement && typeof announcement === "object" ? announcement : null;
}

export function useTips(): Tip[] {
  const { client, online, identity } = useAgentClient();
  const query = useQuery({
    queryKey: ["agent", "tips", identity?.account, identity?.chainId],
    enabled: online,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: ({ signal }) => client!.request<TipsResponse>("/tips", { signal }),
  });
  return Array.isArray(query.data?.tips) ? query.data!.tips : [];
}
