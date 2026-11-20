import { Lock, Mail, UserPlus } from "lucide-react";
import { useState } from "react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { AuthError, AuthLink, GoogleButton, OrDivider, SubmitButton } from "@/components/auth/parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { safeReturnTo } from "@/lib/authReturnTo";

export function RegisterPage() {
  const returnTo = safeReturnTo();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function register(e) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (password.length < 8) { setError("Use uma senha com pelo menos 8 caracteres."); return; }
    if (password !== confirm) { setError("As senhas não coincidem."); return; }
    setBusy(true);
    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: new URL(returnTo || "/", window.location.origin).toString() },
      });
      if (authError) throw authError;

      // With email confirmation disabled, Supabase returns an active session.
      if (data?.session) {
        window.location.replace(returnTo || "/");
        return;
      }
      setSent(true);
    } catch (err) {
      const message = err?.message || "Não foi possível criar sua conta.";
      if (/security purposes|after \d+ seconds|rate limit/i.test(message)) {
        setError("Aguarde alguns segundos antes de tentar novamente. Não clique várias vezes.");
      } else if (/already registered|already been registered/i.test(message)) {
        setError("Este e-mail já possui cadastro. Entre na sua conta ou redefina a senha.");
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return <AuthLayout icon={UserPlus} title="Criar conta" subtitle="Comece a produzir seus vídeos">
    {sent ? <div className="space-y-3 text-center text-sm"><p>O cadastro foi iniciado para <strong>{email}</strong>.</p><p className="text-muted-foreground">Se a confirmação de e-mail estiver ativada, confirme a mensagem recebida para acessar o estúdio.</p><AuthLink to="/login" returnTo={returnTo}>Voltar ao login</AuthLink></div> : <>
      <GoogleButton returnTo={returnTo} onError={setError} /><OrDivider /><AuthError>{error}</AuthError>
      <form onSubmit={register} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="register-email">E-mail</Label><div className="relative"><Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="register-email" type="email" autoComplete="email" autoFocus placeholder="voce@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 pl-10" required /></div></div>
        <div className="space-y-2"><Label htmlFor="register-password">Senha</Label><div className="relative"><Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="register-password" type="password" autoComplete="new-password" placeholder="Mínimo 8 caracteres" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 pl-10" required /></div></div>
        <div className="space-y-2"><Label htmlFor="register-confirm">Confirmar senha</Label><Input id="register-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-12" required /></div>
        <SubmitButton busy={busy} busyLabel="Criando conta...">Criar conta</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">Já tem conta? <AuthLink to="/login" returnTo={returnTo}>Entrar</AuthLink></p>
    </>}
  </AuthLayout>;
}
