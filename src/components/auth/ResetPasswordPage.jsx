import { Link } from "@tanstack/react-router";
import { AlertTriangle, Lock } from "lucide-react";
import { useState } from "react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { AuthError, SubmitButton } from "@/components/auth/parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";

export function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setError("");
    if (password.length < 8) { setError("Use pelo menos 8 caracteres."); return; }
    if (password !== confirm) { setError("As senhas não coincidem."); return; }
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) { setError(updateError.message); setBusy(false); return; }
    window.location.href = "/login";
  }
  return <AuthLayout icon={Lock} title="Nova senha" subtitle="Escolha uma senha nova">
    <AuthError>{error}</AuthError>
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="reset-password">Nova senha</Label><Input id="reset-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12" required /></div>
      <div className="space-y-2"><Label htmlFor="reset-confirm">Confirmar senha</Label><Input id="reset-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-12" required /></div>
      <SubmitButton busy={busy} busyLabel="Salvando...">Salvar senha</SubmitButton>
    </form>
    <p className="mt-5 text-center text-sm"><Link to="/login" className="text-primary hover:underline">Voltar ao login</Link></p>
  </AuthLayout>;
}
