import { createMiddleware } from "@tanstack/react-start";

// Forward the current access token as explicit server-function context.
// The server MUST validate it with Supabase auth.getUser before trusting it.
export const authMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error("Não foi possível ler sua sessão: " + error.message);
    const token = data.session?.access_token;
    return next({ sendContext: token ? { accessToken: token } : {} });
  })
  .server(async ({ next, context }) => {
    const { getAuthenticatedContext } = await import("@/lib/auth-context.server");
    // getAuthenticatedContext validates the client-forwarded token against Supabase.
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
