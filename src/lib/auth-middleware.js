import { createClient } from "@supabase/supabase-js";
import { createMiddleware } from "@tanstack/react-start";
import { getAuthenticatedContext as resolveAuthenticatedContext } from "@/lib/auth-context.server";

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
  .server(async ({ next, context }) => {
    const auth = await resolveAuthenticatedContext(context);
    return next({ context: { ...(context || {}), getSupabase: () => auth.supabase, accessToken: auth.accessToken, user: auth.user } });
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
  const auth = await getAuthenticatedContext(context);
  return next({ context: { ...(context || {}), getSupabase: () => auth.supabase, accessToken: auth.accessToken, user: auth.user } });
});

export const requireUserRoute = createMiddleware({ type: "request" }).middleware([supabaseRequestMiddleware]).server(async ({ next, context }) => {
  if (!context?.accessToken) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await context.getSupabase().auth.getUser(context.accessToken);
  if (error || !data.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return next({ context: { ...context, user: data.user } });
});
