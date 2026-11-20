import { Lock, LogIn, Mail } from "lucide-react";
import { useState } from "react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { AuthError, AuthLink, GoogleButton, OrDivider, SubmitButton } from "@/components/auth/parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { safeReturnTo } from "@/lib/authReturnTo";

export function LoginPage() {
  const returnTo = safeReturnTo();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message || "Não foi possível entrar.");
      setBusy(false);
      return;
    }
    window.location.href = returnTo;
  }

  return <AuthLayout icon={LogIn} title="Bem-vindo de volta" subtitle="Entre na sua conta">
    <GoogleButton returnTo={returnTo} onError={setError} />
    <OrDivider />
    <AuthError>{error}</AuthError>
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="login-email">E-mail</Label>
        <div className="relative"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="login-email" type="email" autoComplete="email" autoFocus placeholder="voce@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 pl-10" required /></div>
      </div>
      <div className="space-y-2"><div className="flex items-center justify-between"><Label htmlFor="login-password">Senha</Label>
        <AuthLink to="/forgot-password" returnTo={returnTo} className="text-xs text-primary hover:underline">Esqueceu a senha?</AuthLink></div>
        <div className="relative"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="login-password" type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 pl-10" required /></div>
      </div>
      <SubmitButton busy={busy} busyLabel="Entrando...">Entrar</SubmitButton>
    </form>
    <p className="mt-6 text-center text-sm text-muted-foreground">Ainda não tem conta? <AuthLink to="/register" returnTo={returnTo}>Criar conta</AuthLink></p>
  </AuthLayout>;
}
