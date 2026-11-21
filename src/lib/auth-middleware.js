import { createMiddleware } from "@tanstack/react-start";

// The browser forwards only the token. The server validates it with Supabase.
// Keep middleware context JSON-safe: never put a Supabase client instance in it.
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
    const auth = await getAuthenticatedContext(context);
    return next({ context: { userId: auth.user.id, accessToken: auth.accessToken } });
  });

export const requireUser = authMiddleware;

export const requireUserRoute = createMiddleware({ type: "request" }).server(async ({ next, context }) => {
  const { getAuthenticatedContext } = await import("@/lib/auth-context.server");
  const auth = await getAuthenticatedContext(context);
  return next({ context: { userId: auth.user.id } });
});
