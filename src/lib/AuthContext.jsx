import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { currentUrl } from "@/lib/authReturnTo";

export const authQuery = queryOptions({
  queryKey: ["auth", "me"],
  queryFn: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error && error.name !== "AuthSessionMissingError") throw error;
    return { user: data?.user ?? null, error: null };
  },
  staleTime: Infinity,
  retry: false,
});

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const { data, error, isPending } = useQuery(authQuery);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      queryClient.setQueryData(authQuery.queryKey, { user: session?.user ?? null, error: null });
    });
    return () => listener.subscription.unsubscribe();
  }, [queryClient]);

  const value = useMemo(() => ({
    user: data?.user ?? null,
    isAuthenticated: !!data?.user,
    isLoadingAuth: isPending,
    authError: error ? { type: "unknown", message: error.message ?? "Falha ao carregar sessão" } : null,
    refresh: () => queryClient.fetchQuery({ ...authQuery, staleTime: 0 }),
    logout: async () => {
      await supabase.auth.signOut();
      queryClient.setQueryData(authQuery.queryKey, { user: null, error: null });
      window.location.href = "/login";
    },
    navigateToLogin: () => {
      window.location.href = `/login?returnTo=${encodeURIComponent(currentUrl())}`;
    },
  }), [data, error, isPending, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
