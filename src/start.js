import { createStart, createCsrfMiddleware } from "@tanstack/react-start";

// Server functions are same-origin RPC endpoints. Keep CSRF protection enabled.
// Supabase authentication is handled by authMiddleware on each function call.
const csrfMiddleware = createCsrfMiddleware({
  filter: (context) => context.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
}));
