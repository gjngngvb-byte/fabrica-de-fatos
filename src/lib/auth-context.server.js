import { getRequest, setResponseStatus } from "@tanstack/react-start/server";
import { createSupabaseForToken } from "@/lib/supabase-token-client";

export { createSupabaseForToken };

export async function getAuthenticatedContext(context = {}) {
  const request = getRequest();
  const authorization = request?.headers?.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || context?.accessToken || null;
  if (!token) {
    setResponseStatus(401);
    throw Object.assign(new Error("Faça login para continuar."), { status: 401, code: "UNAUTHORIZED" });
  }
  const supabase = createSupabaseForToken(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    setResponseStatus(401);
    throw Object.assign(new Error("Sessão inválida. Entre novamente."), { status: 401, code: "UNAUTHORIZED" });
  }
  return { user: data.user, accessToken: token };
}
