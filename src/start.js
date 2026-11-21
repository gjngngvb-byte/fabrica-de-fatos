import { createStart, createCsrfMiddleware } from "@tanstack/react-start";
import { supabaseRequestMiddleware } from "@/lib/auth-middleware";

// Keep same-origin protection enabled when configuring global request middleware.
const csrfMiddleware = createCsrfMiddleware({
  filter: (context) => context.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, supabaseRequestMiddleware],
}));
