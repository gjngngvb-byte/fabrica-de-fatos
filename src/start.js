import { createStart } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth-middleware";

export const startInstance = createStart(() => ({
  functionMiddleware: [authMiddleware],
}));
