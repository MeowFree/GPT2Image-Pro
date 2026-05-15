"use client";

import { useEffect, useState } from "react";

type CurrentSession = {
  user?: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
  };
} | null;

export function useCurrentSession() {
  const [data, setData] = useState<CurrentSession>(null);
  const [isPending, setIsPending] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function loadSession() {
      try {
        const response = await fetch(
          `/api/session/current?t=${Date.now().toString(36)}`,
          {
            cache: "no-store",
            credentials: "include",
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
      } catch (error) {
        if (!controller.signal.aborted) {
          setData(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsPending(false);
        }
      }
    }

    loadSession();

    return () => controller.abort();
  }, []);

  return { data, isPending };
}
