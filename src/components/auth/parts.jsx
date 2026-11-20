import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { returnToSearch } from "@/lib/authReturnTo";

export function AuthError({ children }) {
  if (!children) return null;
  return <div role="alert" className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{children}</div>;
}

export function SubmitButton({ busy, busyLabel, children, ...props }) {
  return <Button type="submit" className="h-12 w-full font-medium" disabled={busy} {...props}>
    {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{busyLabel}</> : children}
  </Button>;
}

export function GoogleButton({ returnTo, onError }) {
  const signIn = async () => {
    const redirectTo = new URL(returnTo || "/", window.location.origin).toString();
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) throw error;
  };
  return <Button type="button" variant="outline" className="mb-6 h-12 w-full text-sm font-medium"
    onClick={() => signIn().catch((err) => onError(err.message || "Não foi possível entrar com Google"))}>
    Continuar com Google
  </Button>;
}

export function OrDivider() {
  return <div className="relative mb-6"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
    <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-3 text-muted-foreground">ou</span></div></div>;
}

export function AuthLink({ to, returnTo, className = "font-medium text-primary hover:underline", children }) {
  return <Link to={to} search={returnToSearch(returnTo)} className={className}>{children}</Link>;
}
