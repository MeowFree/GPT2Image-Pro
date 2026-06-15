"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { AppUserRole } from "@repo/shared/auth/roles";

export type CurrentSession = {
  user?: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
    role?: AppUserRole;
  };
} | null;

export function useCurrentSession(initialData?: CurrentSession) {
  const pathname = usePathname();
  const [data, setData] = useState<CurrentSession>(initialData ?? null);
  const [isPending, setIsPending] = useState(!initialData);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadSession() {
      setIsPending(true);

      try {
        const requestTag = `${Date.now().toString(36)}-${reloadToken}-${encodeURIComponent(pathname)}`;
        const response = await fetch(
          `/api/session/current?t=${requestTag}`,
          {
            cache: "no-store",
            credentials: "include",
            method: "POST",
            headers: {
              "Cache-Control": "no-store",
            },
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          setData(null);
          return;
        }

        setData((await response.json()) as CurrentSession);
      } catch {
        if (!controller.signal.aborted) {
          setData((current) => current ?? null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsPending(false);
        }
      }
    }

    loadSession();

    return () => controller.abort();
  }, [pathname, reloadToken]);

  useEffect(() => {
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") reload();
    };

    window.addEventListener("focus", reload);
    window.addEventListener("pageshow", reload);
    document.addEventListener("visibilitychange", refreshOnVisible);

    return () => {
      window.removeEventListener("focus", reload);
      window.removeEventListener("pageshow", reload);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [reload]);

  return { data, isPending, reload };
}
