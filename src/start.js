import { createStart } from "@tanstack/react-start";
import { supabaseRequestMiddleware } from "@/lib/auth-middleware";

export const startInstance = createStart(() => ({
  requestMiddleware: [supabaseRequestMiddleware],
}));
