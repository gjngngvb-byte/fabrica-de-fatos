import { createClient } from "@supabase/supabase-js";
import { createMiddleware } from "@tanstack/react-start";

const getConfig = () => ({
  url: import.meta.env.VITE_SUPABASE_URL,
  key: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

// This request middleware is an explicit dependency of the function auth
// middleware, so its context is guaranteed to be available to server functions.
export const supabaseRequestMiddleware = createMiddleware({ type: "request" }).server(async ({ next, request }) => {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
  const { url, key } = getConfig();
  if (!url || !key) {
    throw new Error("Configuração do Supabase ausente no servidor.");
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
  return next({ context: { getSupabase: () => supabase, accessToken: token } });
});

async function verifyRequestContext(context) {
  const token = context?.accessToken || null;
  const supabase = typeof context?.getSupabase === "function" ? context.getSupabase() : null;
  if (!token || !supabase) {
    throw Object.assign(new Error("Faça login para continuar."), { status: 401, code: "UNAUTHORIZED" });
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw Object.assign(new Error("Sessão inválida. Entre novamente."), { status: 401, code: "UNAUTHORIZED" });
  }
  return { supabase, user: data.user, accessToken: token };
}

export const authMiddleware = createMiddleware({ type: "function" })
  .middleware([supabaseRequestMiddleware])
  .client(async ({ next }) => {
    const { data } = await (await import("@/lib/supabase")).supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  })
  .server(async ({ next, context }) => {
    const auth = await verifyRequestContext(context);
    return next({
      context: {
        getSupabase: () => auth.supabase,
        accessToken: auth.accessToken,
        user: auth.user,
      },
    });
  });

export const requireUser = createMiddleware({ type: "function" })
  .middleware([supabaseRequestMiddleware])
  .server(async ({ next, context }) => {
    const auth = await verifyRequestContext(context);
    return next({
      context: {
        getSupabase: () => auth.supabase,
        accessToken: auth.accessToken,
        user: auth.user,
      },
    });
  });

export const requireUserRoute = createMiddleware({ type: "request" })
  .middleware([supabaseRequestMiddleware])
  .server(async ({ next, context }) => {
    const auth = await verifyRequestContext(context);
    return next({ context: { user: auth.user } });
  });
