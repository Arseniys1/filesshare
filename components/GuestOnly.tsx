"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";

interface GuestOnlyProps {
  children: ReactNode;
}

export default function GuestOnly({ children }: GuestOnlyProps) {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let mounted = true;

    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { user: null })
      .then((data: { user?: unknown }) => {
        if (!mounted) return;
        if (data.user) {
          router.replace("/dashboard");
        } else {
          setCheckingSession(false);
        }
      })
      .catch(() => {
        if (mounted) setCheckingSession(false);
      });

    return () => {
      mounted = false;
    };
  }, [router]);

  if (checkingSession) {
    return <div className="flex min-h-[50vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-2 border-accent/30 border-t-accent" /></div>;
  }

  return children;
}
