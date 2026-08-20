"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export interface AuthUser {
  email: string;
  role: "user" | "admin";
  avatarSeed: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleAvatarUpdate = (event: Event) => {
      const updatedUser = (event as CustomEvent<AuthUser>).detail;
      if (updatedUser) setUser(updatedUser);
    };

    window.addEventListener("user-avatar-updated", handleAvatarUpdate);
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((data: { user: AuthUser | null }) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));

    return () =>
      window.removeEventListener("user-avatar-updated", handleAvatarUpdate);
  }, []);

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-[var(--background)]"
        role="status"
        aria-label="Loading"
      >
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent/20 border-t-accent" />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
