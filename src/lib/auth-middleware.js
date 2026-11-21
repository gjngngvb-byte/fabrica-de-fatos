import { createMiddleware } from "@tanstack/react-start";

// The browser forwards the Supabase access token on each server-function call.
// Authentication is resolved inside this function middleware, not through a
// request-context getter that may be absent on a later pipeline RPC.
export const authMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error("Não foi possível ler sua sessão: " + error.message);
    const token = data.session?.access_token;
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  })
  .server(async ({ next, context }) => {
    const { getAuthenticatedContext } = await import("@/lib/auth-context.server");
    const auth = await getAuthenticatedContext(context);
    return next({
      context: {
        supabase: auth.supabase,
        user: auth.user,
        accessToken: auth.accessToken,
      },
    });
  });

export const requireUser = authMiddleware;

export const requireUserRoute = createMiddleware({ type: "request" }).server(async ({ next, context }) => {
  const { getAuthenticatedContext } = await import("@/lib/auth-context.server");
  const auth = await getAuthenticatedContext(context);
  return next({ context: { user: auth.user } });
});
