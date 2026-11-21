import { createClient } from "@supabase/supabase-js";
import { createMiddleware } from "@tanstack/react-start";

const getConfig = () => ({
  url: import.meta.env.VITE_SUPABASE_URL,
  key: import.meta.env.VITE_SUPABASE_ANON_KEY,
});

// Runs once at the request boundary. The browser token is forwarded by the
// function middleware below and becomes available to every protected handler.
export const supabaseRequestMiddleware = createMiddleware({ type: "request" }).server(async ({ next, request }) => {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || null;
  const { url, key } = getConfig();
  if (!url || !key) throw new Error("Configuração do Supabase ausente no servidor.");

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

// Keep token forwarding and verification in one function-middleware chain.
// Do not attach the request middleware a second time to each function.
export const authMiddleware = createMiddleware({ type: "function" })
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

export const requireUser = authMiddleware;

export const requireUserRoute = createMiddleware({ type: "request" }).server(async ({ next, context }) => {
  const auth = await verifyRequestContext(context);
  return next({ context: { user: auth.user } });
});
