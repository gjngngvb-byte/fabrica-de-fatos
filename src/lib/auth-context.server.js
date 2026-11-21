import { createClient } from "@supabase/supabase-js";
import { getRequest, setResponseStatus } from "@tanstack/react-start/server";

const getConfig = () => ({
  url: import.meta.env.VITE_SUPABASE_URL,
  key: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

export async function getAuthenticatedContext(context = {}) {
  const request = getRequest();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || context?.accessToken || null;
  if (!token) {
    setResponseStatus(401);
    throw Object.assign(new Error("Faça login para continuar."), { status: 401, code: "UNAUTHORIZED" });
  }
  const { url, key } = getConfig();
  const supabase = typeof context?.getSupabase === "function" ? context.getSupabase() : createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    setResponseStatus(401);
    throw Object.assign(new Error("Sessão inválida. Entre novamente."), { status: 401, code: "UNAUTHORIZED" });
  }
  return { supabase, user: data.user };
}
