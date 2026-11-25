import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { S3Client, GetObjectCommand } from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:cors});
const json=async(r:Response)=>{try{return await r.json()}catch{return {}}};
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 try {
  const auth=req.headers.get("Authorization")||"",token=auth.replace(/^Bearer\s+/i,"");
  if(!token) return reply({error:"Faça login novamente."},401);
  const userClient=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
  const {data:{user},error:authError}=await userClient.auth.getUser(token);
  if(authError||!user) return reply({error:"Sessão inválida."},401);
  const {videoId,privacyStatus="private"}=await req.json().catch(()=>({}));
  if(!["public","private","unlisted"].includes(privacyStatus)) return reply({error:"Escolha uma visibilidade válida para o YouTube."},400);
  if(typeof videoId!=="string") return reply({error:"Vídeo não identificado."},400);
  const {data:video,error:videoError}=await userClient.from("videos").select("*").eq("id",videoId).eq("created_by",user.id).single();
  if(videoError||!video) return reply({error:"Vídeo não encontrado."},404);
  if(!video.mp4_url) return reply({error:"Finalize a renderização antes de aprovar."},400);
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const [{data:yt},{data:tt}] = await Promise.all([
    admin.from("youtube_connections").select("user_id").eq("user_id",user.id).maybeSingle(),
    admin.from("tiktok_connections").select("user_id").eq("user_id",user.id).maybeSingle()
  ]);
  const platforms:{platform:string,status:string,message?:string,url?:string}[]=[];
  if(!yt&&!tt) return reply({error:"Conecte pelo menos uma plataforma em Ajustes antes de aprovar o vídeo."},400);
  const invoke=async(name:string)=>{
   const r=await fetch(Deno.env.get("SUPABASE_URL")!+"/functions/v1/"+name,{method:"POST",headers:{Authorization:auth,apikey:Deno.env.get("SUPABASE_ANON_KEY")!,"Content-Type":"application/json"},body:JSON.stringify({videoId,privacyStatus})});
   const payload=await json(r);
   return {ok:r.ok&&payload.success!==false&&!payload.error,payload};
  };
  const jobs:Promise<{platform:string,status:string,message?:string,url?:string}>[]=[];
  if(yt) jobs.push((async()=>{
   const existing=await admin.from("youtube_publications").select("youtube_video_id,watch_url").eq("user_id",user.id).eq("video_id",videoId).maybeSingle();
   if(existing.data) return {platform:"youtube",status:"success",url:existing.data.watch_url||"https://youtu.be/"+existing.data.youtube_video_id,message:"Este vídeo já foi enviado ao YouTube."};
   const result=await invoke("youtube-publish");
   return result.ok?{platform:"youtube",status:"success",url:result.payload.watchUrl,message:result.payload.message}:{platform:"youtube",status:"failed",message:result.payload.error||"Falha ao publicar no YouTube."};
  })());
  if(tt) jobs.push((async()=>{
   const existing=await admin.from("tiktok_publications").select("publish_id,status,share_url").eq("user_id",user.id).eq("video_id",videoId).maybeSingle();
   if(existing.data) return {platform:"tiktok",status:"success",url:existing.data.share_url||undefined,message:"Este vídeo já foi enviado ao TikTok e está em processamento."};
   const result=await invoke("tiktok-publish");
   return result.ok?{platform:"tiktok",status:"success",message:result.payload.message||"Enviado ao TikTok."}:{platform:"tiktok",status:"failed",message:result.payload.error||"Falha ao publicar no TikTok."};
  })());
  platforms.push(...await Promise.all(jobs));
  const allOk=platforms.every(p=>p.status==="success");
  return reply({success:allOk,partial:!allOk,platforms,message:allOk?"Vídeo aprovado e enviado para todas as plataformas conectadas.":"Algumas plataformas não concluíram a publicação. As que deram certo não serão enviadas novamente."});
 } catch(e){console.error("[publish-approved]",e?.message||e);return reply({error:"Não foi possível concluir a aprovação e publicação."},500);}
});