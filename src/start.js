import { createStart } from "@tanstack/react-start";
import { authMiddleware, supabaseRequestMiddleware } from "@/lib/auth-middleware";

export const startInstance = createStart(() => ({
  requestMiddleware: [supabaseRequestMiddleware],
  functionMiddleware: [authMiddleware],
}));
