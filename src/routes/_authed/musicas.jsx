import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Music2, UploadCloud, RefreshCw, CheckCircle2, AlertCircle, FileText, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authed/musicas")({
  head: () => ({ meta: [{ title: "Biblioteca musical — Fábrica de Fatos" }] }),
  component: MusicLibrary,
});

const cleanName = (name) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-110);

async function musicAction(body) {
  const { data, error } = await supabase.functions.invoke("music-library", { body });
  if (error) throw new Error(data?.error || error.message || "Não foi possível acessar a biblioteca musical.");
  if (data?.error) throw new Error(data.error + (data.details ? " " + data.details : ""));
  return data;
}

function MusicLibrary() {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState([]);
  const [connection, setConnection] = useState("checking");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef(null);

  const refresh = async () => {
    setConnection("checking");
    try {
      const health = await musicAction({ action: "health" });
      if (!health?.connected) throw new Error("O bucket não confirmou a conexão.");
      const [audio, docs] = await Promise.all([
        musicAction({ action: "list", prefix: "tracks/" }),
        musicAction({ action: "list", prefix: "metadata/" }),
      ]);
      setFiles([...(audio.files || []), ...(docs.files || [])]);
      setConnection("connected");
      setError("");
    } catch (e) {
      setConnection("error");
      setError(e.message || "Falha ao verificar a conexão.");
    }
  };

  useEffect(() => { refresh(); }, []);

  const uploadOne = async (file, prefix, contentType) => {
    const key = prefix + Date.now() + "-" + cleanName(file.name);
    setProgress("Preparando " + file.name + "…");
    const signed = await musicAction({ action: "upload-url", key, contentType });
    setProgress("Enviando " + file.name + "…");
    const response = await fetch(signed.url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    });
    if (!response.ok) throw new Error("O R2 recusou o envio de " + file.name + " (HTTP " + response.status + ").");
    return key;
  };

  const classifyFiles = (list) => {
    const audio = [];
    const docs = [];
    const unsupported = [];
    for (const file of Array.from(list || [])) {
      const extension = file.name.split(".").pop().toLowerCase();
      if (file.type.startsWith("audio/") || ["mp3", "wav", "m4a", "aac", "ogg", "flac"].includes(extension)) {
        audio.push(file);
      } else if (["txt", "json", "csv"].includes(extension)) {
        docs.push(file);
      } else {
        unsupported.push(file.name);
      }
    }
    return { audio, docs, unsupported };
  };

  const addFiles = (incoming) => {
    const next = Array.from(incoming || []);
    if (!next.length) return;
    setSelectedFiles((current) => {
      const existing = new Set(current.map((file) => file.name + "|" + file.size + "|" + file.lastModified));
      return [...current, ...next.filter((file) => !existing.has(file.name + "|" + file.size + "|" + file.lastModified))];
    });
    setError("");
    setProgress("");
  };

  const handleUpload = async () => {
    setError("");
    const { audio, docs, unsupported } = classifyFiles(selectedFiles);
    if (!audio.length || !docs.length) {
      setError("Adicione pelo menos uma música e um arquivo TXT, JSON ou CSV.");
      return;
    }
    if (unsupported.length) {
      setError("Formato não reconhecido: " + unsupported.join(", ") + ". Use áudio, TXT, JSON ou CSV.");
      return;
    }
    setBusy(true);
    let completed = 0;
    try {
      for (const file of audio) {
        setProgress("Enviando música " + (completed + 1) + " de " + selectedFiles.length + ": " + file.name);
        await uploadOne(file, "tracks/", file.type || "audio/mpeg");
        completed++;
      }
      for (const file of docs) {
        const extension = file.name.split(".").pop().toLowerCase();
        const contentType = extension === "json" ? "application/json" : extension === "csv" ? "text/csv" : "text/plain";
        setProgress("Enviando informações " + (completed + 1) + " de " + selectedFiles.length + ": " + file.name);
        await uploadOne(file, "metadata/", contentType);
        completed++;
      }
      setProgress("Conferindo " + completed + " arquivos no bucket…");
      await refresh();
      toast.success(completed + " arquivos enviados e organizados.");
      setSelectedFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      setProgress("Concluído: " + completed + " arquivos enviados.");
    } catch (e) {
      const message = e.message || "Falha no envio.";
      setError(message.includes("Failed to fetch") || message.includes("CORS")
        ? "O navegador bloqueou o envio direto ao R2. Precisamos liberar o CORS do bucket para o domínio do site. Nenhuma alteração foi feita nos vídeos."
        : message);
      setProgress("");
      toast.error("Não foi possível concluir todo o lote. Os arquivos já enviados continuam salvos.");
    } finally {
      setBusy(false);
    }
  };

  const formatSize = (bytes) => bytes == null ? "" : bytes < 1024 * 1024
    ? (bytes / 1024).toFixed(1) + " KB" : (bytes / 1024 / 1024).toFixed(1) + " MB";

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8 lg:px-12 lg:py-14">
      <p className="eyebrow">Acervo de áudio</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl leading-none tracking-tight">Biblioteca musical</h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">Envie as trilhas e o arquivo que descreve cada música. Os arquivos ficam no bucket privado separado dos vídeos.</p>
        </div>
        <button type="button" onClick={refresh} disabled={connection === "checking" || busy}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-border px-4 text-xs hover:bg-secondary disabled:opacity-50">
          <RefreshCw className={"size-3.5 " + (connection === "checking" ? "animate-spin" : "")} /> Atualizar
        </button>
      </div>

      <section className="mt-8 rounded-2xl border border-border/70 bg-card/40 p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><Music2 className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Conexão com o armazenamento musical</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {connection === "checking" ? "Verificando acesso seguro…" : connection === "connected" ? "Bucket livetiktok-musicas conectado." : "Não foi possível confirmar a conexão."}
            </p>
          </div>
          {connection === "connected" ? <CheckCircle2 className="size-5 text-emerald-500" /> : connection === "error" ? <AlertCircle className="size-5 text-destructive" /> : <Loader2 className="size-5 animate-spin text-muted-foreground" />}
        </div>
        {connection === "error" && <p className="mt-3 rounded-lg bg-destructive/5 p-3 text-xs text-destructive">{error}</p>}
      </section>

      <section className="mt-6 space-y-4 rounded-2xl border border-border/70 bg-card/40 p-5">
        <div>
          <h2 className="text-sm font-semibold">Envio em lote</h2>
          <p className="mt-1 text-xs text-muted-foreground">Arraste todas as músicas e os arquivos TXT, JSON ou CSV de uma vez. A biblioteca identifica e separa cada tipo automaticamente.</p>
        </div>
        <div
          onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) addFiles(e.dataTransfer.files); }}
          onClick={() => { if (!busy) fileInput.current?.click(); }}
          className={"cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors " + (dragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/60 hover:bg-secondary/40") + (busy ? " pointer-events-none opacity-60" : "")}>
          <UploadCloud className="mx-auto size-8 text-primary" />
          <p className="mt-3 text-sm font-medium">Arraste os arquivos para cá</p>
          <p className="mt-1 text-xs text-muted-foreground">ou clique para selecionar vários arquivos</p>
          <p className="mt-2 text-[10px] text-muted-foreground">Áudio: MP3, WAV, M4A, AAC, OGG, FLAC · Informações: TXT, JSON, CSV</p>
          <input ref={fileInput} type="file" multiple accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.txt,.json,.csv"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            className="hidden" />
        </div>
        {selectedFiles.length > 0 && (() => {
          const groups = classifyFiles(selectedFiles);
          return (
            <div className="space-y-3 rounded-xl border border-border/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold">{selectedFiles.length} arquivo(s) selecionado(s)</p>
                <button type="button" onClick={() => { setSelectedFiles([]); if (fileInput.current) fileInput.current.value = ""; }}
                  disabled={busy} className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">Limpar lista</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><Music2 className="size-3.5" /> Músicas · {groups.audio.length}</p>
                  {groups.audio.map((file) => <p key={file.name + file.lastModified} className="truncate py-0.5 text-xs">{file.name}</p>)}
                  {groups.audio.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma música</p>}
                </div>
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><FileText className="size-3.5" /> Informações · {groups.docs.length}</p>
                  {groups.docs.map((file) => <p key={file.name + file.lastModified} className="truncate py-0.5 text-xs">{file.name}</p>)}
                  {groups.docs.length === 0 && <p className="text-xs text-muted-foreground">Nenhum TXT, JSON ou CSV</p>}
                </div>
              </div>
              {groups.unsupported.length > 0 && <p className="text-xs text-destructive">Formato não reconhecido: {groups.unsupported.join(", ")}</p>}
            </div>
          );
        })()}
        {error && <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p>}
        {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
        <button type="button" onClick={handleUpload} disabled={busy || connection !== "connected" || selectedFiles.length === 0}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
          {busy ? "Enviando lote…" : "Enviar e organizar arquivos"}
        </button>
        <p className="text-[10px] leading-relaxed text-muted-foreground">Sem limite de quantidade. As músicas vão para tracks/ e os arquivos de informações para metadata/. O envio usa URLs temporárias assinadas, sem expor as chaves do R2.</p>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Arquivos no bucket</h2>
          <span className="text-xs text-muted-foreground">{files.length} arquivo(s)</span>
        </div>
        <div className="divide-y divide-border/60 rounded-xl border border-border/70 bg-card/30 px-4">
          {files.length === 0 ? <p className="py-6 text-xs text-muted-foreground">Nenhum arquivo listado ainda.</p> : files.map((file) => (
            <div key={file.key} className="flex items-center justify-between gap-3 py-3">
              <span className="min-w-0 truncate text-xs text-foreground">{file.key}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{formatSize(file.size)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
