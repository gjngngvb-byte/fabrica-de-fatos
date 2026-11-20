import { useEffect } from "react";
export function MfaPage() {
  useEffect(() => { window.location.replace("/login"); }, []);
  return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Redirecionando para o login…</main>;
}
