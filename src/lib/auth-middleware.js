import { createClient } from "@supabase/supabase-js";
import { createMiddleware, createServerOnlyFn } from "@tanstack/react-start";

const getConfig = () => ({
  url: import.meta.env.VITE_SUPABASE_URL,
  key: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

// The server-only wrapper keeps request APIs and the server module out of the browser bundle.
export const getAuthenticatedContext = createServerOnlyFn(async (context = {}) => {
  const { getRequest, setResponseStatus } = await import("@tanstack/react-start/server");
  const request = getRequest();
  const token = context?.accessToken || request.headers.get("authorization")?.replace(/^Bearer\\s+/i, "") || null;
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
  return { supabase, user: data.user, accessToken: token };
});

export const authMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { data } = await (await import("@/lib/supabase")).supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  })
  .server(async ({ next, context }) => {
    const auth = await getAuthenticatedContext(context);
    return next({ context: { ...(context || {}), getSupabase: () => auth.supabase, accessToken: auth.accessToken, user: auth.user } });
  });

export const supabaseRequestMiddleware = createMiddleware({ type: "request" }).server(async ({ next, request }) => {
  const token = request.headers.get("authorization")?.replace(/^Bearer\\s+/i, "") || null;
  const { url, key } = getConfig();
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
  return next({ context: { getSupabase: () => supabase, accessToken: token } });
});

export const requireUser = createMiddleware({ type: "function" }).server(async ({ next, context }) => {
  const auth = await getAuthenticatedContext(context);
  return next({ context: { ...(context || {}), getSupabase: () => auth.supabase, accessToken: auth.accessToken, user: auth.user } });
});

export const requireUserRoute = createMiddleware({ type: "request" }).middleware([supabaseRequestMiddleware]).server(async ({ next, context }) => {
  if (!context?.accessToken) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await context.getSupabase().auth.getUser(context.accessToken);
  if (error || !data.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return next({ context: { ...context, user: data.user } });
});
