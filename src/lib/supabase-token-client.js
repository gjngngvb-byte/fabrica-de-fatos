import { createClient } from "@supabase/supabase-js";

const getConfig = () => ({
  url: import.meta.env.VITE_SUPABASE_URL,
  key: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

// Creates a request-scoped Supabase client. This module has no server-only imports
// so it can be dynamically loaded from a createServerFn handler.
export function createSupabaseForToken(token) {
  const { url, key } = getConfig();
  if (!url || !key) throw new Error("Configuração pública do Supabase ausente no servidor.");
  if (!token || typeof token !== "string") throw new Error("Token de autenticação ausente.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
