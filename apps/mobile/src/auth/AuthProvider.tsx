/**
 * Authentication state for the app.
 *
 * States:
 * - "restoring": app started; attempting session restoration.
 * - "signedIn":  a session is installed (access token in memory).
 * - "signedOut": no usable session.
 *
 * The `offline` flag marks a restored-but-unverified session (network was
 * down during restoration): the UI may show cached profile data, but cloud
 * operations will fail until connectivity returns. The backend remains the
 * authority — a locally stored token never grants anything by itself.
 *
 * Client-side guards are UX only; the API enforces authentication.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { router } from "expo-router";

import { apiLogin, apiLogout, apiRefresh, apiRegister } from "@/api/authApi";
import { ApiRequestError, configureAuthRefresh, setAccessToken } from "@/api/client";
import {
  clearAuthStorage,
  loadRefreshToken,
  loadUserSnapshot,
  saveRefreshToken,
  saveUserSnapshot,
  type AuthUserSnapshot,
} from "@/auth/tokenStore";

export type AuthStatus = "restoring" | "signedIn" | "signedOut";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUserSnapshot | null;
  offline: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Session-restore failure that was NOT an auth rejection (e.g. offline). */
  restoreNetworkIssue: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("restoring");
  const [user, setUser] = useState<AuthUserSnapshot | null>(null);
  const [offline, setOffline] = useState(false);
  const [restoreNetworkIssue, setRestoreNetworkIssue] = useState(false);

  const installSession = useCallback(
    async (session: { access_token: string; refresh_token: string; user: AuthUserSnapshot }) => {
      setAccessToken(session.access_token);
      await saveRefreshToken(session.refresh_token);
      await saveUserSnapshot(session.user);
      setUser(session.user);
      setOffline(false);
      setRestoreNetworkIssue(false);
      setStatus("signedIn");
    },
    []
  );

  // Session restoration on app start.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const storedRefresh = await loadRefreshToken();
      if (!storedRefresh) {
        setStatus("signedOut");
        return;
      }
      try {
        const session = await apiRefresh(storedRefresh);
        if (!cancelled) await installSession(session);
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 0) {
          // Network down: keep the stored session optimistically so the user
          // is not logged out by a dead connection. Cloud calls will surface
          // errors until connectivity returns; the backend stays authoritative.
          const snapshot = await loadUserSnapshot();
          if (!cancelled) {
            setUser(snapshot);
            setOffline(true);
            setRestoreNetworkIssue(true);
            setStatus("signedIn");
          }
          return;
        }
        // Genuine auth rejection (revoked/expired): clear state, sign out.
        await clearAuthStorage();
        setAccessToken(null);
        if (!cancelled) {
          setUser(null);
          setStatus("signedOut");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [installSession]);

  // Refresh hook for the API client (the client dedupes concurrent calls).
  const performRefresh = useCallback(async (): Promise<boolean> => {
    const stored = await loadRefreshToken();
    if (!stored) return false;
    try {
      const session = await apiRefresh(stored);
      setAccessToken(session.access_token);
      await saveRefreshToken(session.refresh_token);
      return true;
    } catch {
      setAccessToken(null);
      await clearAuthStorage();
      setUser(null);
      setStatus("signedOut");
      router.replace("/(auth)/welcome");
      return false;
    }
  }, []);

  useEffect(() => {
    configureAuthRefresh(performRefresh);
    return () => configureAuthRefresh(null);
  }, [performRefresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const session = await apiLogin(email, password);
      await installSession(session);
    },
    [installSession]
  );

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      const session = await apiRegister(email, password, displayName);
      await installSession(session);
    },
    [installSession]
  );

  const signOut = useCallback(async () => {
    const stored = await loadRefreshToken();
    try {
      if (stored) await apiLogout(stored);
    } finally {
      // Local state is cleared even if the network call fails.
      setAccessToken(null);
      await clearAuthStorage();
      setUser(null);
      setOffline(false);
      setStatus("signedOut");
      router.replace("/(auth)/welcome");
    }
  }, []);

  const value = useMemo(
    () => ({ status, user, offline, signIn, signUp, signOut, restoreNetworkIssue }),
    [status, user, offline, signIn, signUp, signOut, restoreNetworkIssue]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within <AuthProvider>");
  return context;
}
