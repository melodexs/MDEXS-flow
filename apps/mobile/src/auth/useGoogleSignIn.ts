/**
 * Google sign-in (native OIDC via @react-native-google-signin).
 *
 * Design: the native SDK returns an OIDC `idToken` (audience = the Google
 * *web* client id). We send ONLY that token to our backend, which verifies
 * signature/issuer/audience/expiry itself. No client secret ever lives in
 * the app; no client-supplied email is trusted.
 *
 * Requires an Expo *development build* (not Expo Go) and
 * EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID to be set. When unconfigured, the hook
 * reports available=false — no fake fallback.
 */

import { useCallback, useMemo, useState } from "react";
import { router } from "expo-router";
import { GoogleSignin } from "@react-native-google-signin/google-signin";

import { apiGoogleLogin } from "@/api/authApi";
import { ApiRequestError } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";

export interface GoogleSignInState {
  available: boolean;
  pending: boolean;
  error: string | null;
  signIn: () => Promise<void>;
}

export function useGoogleSignIn(): GoogleSignInState {
  const { status } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = useMemo(() => WEB_CLIENT_ID.length > 0 && status !== "signedIn", [status]);

  const signIn = useCallback(async () => {
    if (!WEB_CLIENT_ID) return;
    setPending(true);
    setError(null);
    try {
      GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });
      await GoogleSignin.hasPlayServices();
      const result = await GoogleSignin.signIn();
      const idToken = result.data?.idToken;
      if (!idToken) throw new ApiRequestError(0, "google_no_token", "Google sign-in failed.");
      await apiGoogleLogin(idToken);
      router.replace("/(tabs)");
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 0) {
        setError("Could not complete Google sign-in. Check your connection.");
      } else if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        // User cancelled or the native sheet closed — not an app error.
        setError(null);
      }
    } finally {
      setPending(false);
    }
  }, []);

  return { available, pending, error, signIn };
}
