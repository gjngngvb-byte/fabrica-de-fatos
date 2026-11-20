import { ArrowLeft, Mail } from "lucide-react";
import { useState } from "react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { AuthLink, SubmitButton } from "@/components/auth/parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { safeReturnTo } from "@/lib/authReturnTo";

export function ForgotPasswordPage() {
  const returnTo = safeReturnTo();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: new URL("/reset-password", window.location.origin).toString() });
    setBusy(false); setSent(true);
  }
  return <AuthLayout icon={Mail} title="Redefinir senha" subtitle="Enviaremos um link para seu e-mail">
    {sent ? <p className="text-center text-sm">Se houver uma conta com esse e-mail, você receberá um link em instantes.</p> :
      <form onSubmit={submit} className="space-y-4"><div className="space-y-2"><Label htmlFor="forgot-email">E-mail</Label><Input id="forgot-email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="h-12" required /></div><SubmitButton busy={busy} busyLabel="Enviando...">Enviar link</SubmitButton></form>}
    <p className="mt-6 text-center text-sm text-muted-foreground"><AuthLink to="/login" returnTo={returnTo}><ArrowLeft className="mr-1 inline h-3 w-3" />Voltar ao login</AuthLink></p>
  </AuthLayout>;
}
