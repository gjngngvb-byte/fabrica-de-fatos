import { createClient } from "@supabase/supabase-js";
import { createMiddleware } from "@tanstack/react-start";
import { getRequest, setResponseStatus } from "@tanstack/react-start/server";

const getConfig = () => ({
  url: import.meta.env.VITE_SUPABASE_URL,
  key: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

export const authMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { data } = await (await import("@/lib/supabase")).supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  })
  .server(async ({ next }) => {
    const request = getRequest();
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
    const { url, key } = getConfig();
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    });
    return next({ context: { getSupabase: () => supabase, accessToken: token } });
  });

export const supabaseRequestMiddleware = createMiddleware({ type: "request" }).server(async ({ next, request }) => {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  const { url, key } = getConfig();
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
  return next({ context: { getSupabase: () => supabase, accessToken: token } });
});

export const requireUser = createMiddleware({ type: "function" }).server(async ({ next, context }) => {
  if (!context.accessToken) {
    setResponseStatus(401);
    throw Object.assign(new Error("Faça login para continuar."), { status: 401, code: "UNAUTHORIZED" });
  }
  const { data, error } = await context.getSupabase().auth.getUser(context.accessToken);
  if (error || !data.user) {
    setResponseStatus(401);
    throw Object.assign(new Error("Sessão inválida. Entre novamente."), { status: 401, code: "UNAUTHORIZED" });
  }
  return next({ context: { user: data.user } });
});

export const requireUserRoute = createMiddleware({ type: "request" }).server(async ({ next, context }) => {
  if (!context.accessToken) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await context.getSupabase().auth.getUser(context.accessToken);
  if (error || !data.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return next({ context: { user: data.user } });
});
