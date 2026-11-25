import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { S3Client, GetObjectCommand } from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:cors});
const readJson=async(r:Response)=>{try{return await r.json()}catch{return {}}};
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
  if(!video.mp4_url) return reply({error:"Finalize a renderização antes de publicar."},400);
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:already}=await admin.from("youtube_publications").select("youtube_video_id,watch_url").eq("user_id",user.id).eq("video_id",videoId).maybeSingle();
  if(already) return reply({success:true,videoId:already.youtube_video_id,watchUrl:already.watch_url||"https://youtu.be/"+already.youtube_video_id,message:"Este vídeo já foi enviado ao YouTube."});
  const {data:connection,error:connectionError}=await admin.from("youtube_connections").select("*").eq("user_id",user.id).maybeSingle();
  if(connectionError||!connection) return reply({error:"Conecte seu canal do YouTube em Ajustes."},400);
  const clientId=Deno.env.get("YOUTUBE_CLIENT_ID"),clientSecret=Deno.env.get("YOUTUBE_CLIENT_SECRET");
  if(!clientId||!clientSecret) return reply({error:"As credenciais OAuth do YouTube não estão configuradas."},503);
  let accessToken=connection.access_token;
  if(new Date(connection.access_token_expires_at).getTime()<Date.now()+5*60*1000){
   const form=new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:connection.refresh_token,grant_type:"refresh_token"});
   const refreshed=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
   const payload=await readJson(refreshed);
   if(!refreshed.ok||!payload.access_token) return reply({error:"A autorização do YouTube expirou. Reconecte seu canal em Ajustes."},401);
   accessToken=payload.access_token;
   const {error:updateError}=await admin.from("youtube_connections").update({access_token:accessToken,access_token_expires_at:new Date(Date.now()+Number(payload.expires_in||3600)*1000).toISOString(),updated_at:new Date().toISOString()}).eq("user_id",user.id);
   if(updateError) throw updateError;
  }
  let mediaUrl=String(video.mp4_url);
  if(mediaUrl.startsWith("r2://")){
   const endpoint=Deno.env.get("R2_S3_ENDPOINT"),accessKeyId=Deno.env.get("R2_ACCESS_KEY_ID"),secretAccessKey=Deno.env.get("R2_SECRET_ACCESS_KEY"),bucket=Deno.env.get("R2_BUCKET_NAME");
   if(!endpoint||!accessKeyId||!secretAccessKey||!bucket) return reply({error:"O armazenamento de vídeos não está configurado."},503);
   const key=mediaUrl.slice(5);
   if(!key.startsWith(user.id+"/")||!key.endsWith(".mp4")||key.includes("..")) return reply({error:"Referência do MP4 inválida."},403);
   const r2=new S3Client({region:"auto",endpoint,forcePathStyle:true,credentials:{accessKeyId,secretAccessKey}});
   mediaUrl=await getSignedUrl(r2,new GetObjectCommand({Bucket:bucket,Key:key,ResponseContentType:"video/mp4"}),{expiresIn:3600});
  }
  const media=await fetch(mediaUrl);
  if(!media.ok) return reply({error:"Não foi possível acessar o MP4 armazenado."},502);
  const bytes=await media.arrayBuffer();
  if(bytes.byteLength<1||bytes.byteLength>512*1024*1024) return reply({error:"O MP4 excede o limite de 512 MB desta etapa de envio."},413);
  const title=String(video.title||"Fato surpreendente").replace(/[<>]/g,"").slice(0,100);
  const description=[String(video.caption||""),(video.hashtags||[]).map((h:string)=>"#"+String(h).replace(/^#/,"")).join(" ")].filter(Boolean).join("\n\n").slice(0,5000);
  const metadata={snippet:{title,description,categoryId:"27"},status:{privacyStatus,selfDeclaredMadeForKids:false}};
  const init=await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",{method:"POST",headers:{Authorization:"Bearer "+accessToken,"Content-Type":"application/json; charset=UTF-8","X-Upload-Content-Type":"video/mp4","X-Upload-Content-Length":String(bytes.byteLength)},body:JSON.stringify(metadata)});
  if(!init.ok){const detail=await init.text().catch(()=>"");console.error("[youtube-publish] init",init.status,detail.slice(0,500));return reply({error:"O YouTube recusou a preparação do envio (HTTP "+init.status+")."},502);}
  const uploadUrl=init.headers.get("Location");
  if(!uploadUrl) return reply({error:"O YouTube não retornou o endereço de envio."},502);
  const uploaded=await fetch(uploadUrl,{method:"PUT",headers:{"Content-Type":"video/mp4","Content-Length":String(bytes.byteLength)},body:bytes});
  const result=await readJson(uploaded);
  if(!uploaded.ok||!result.id){console.error("[youtube-publish] upload",uploaded.status,result.error?.message||"no video id");return reply({error:result.error?.message||"O YouTube não concluiu o envio do vídeo."},502);}
  const watchUrl="https://youtu.be/"+result.id;
  const {error:saveError}=await admin.from("youtube_publications").insert({user_id:user.id,video_id:videoId,youtube_video_id:result.id,status:"uploaded",privacy_status:privacyStatus,watch_url:watchUrl});
  if(saveError){console.error("[youtube-publish] record",saveError.message);return reply({error:"O vídeo foi enviado, mas não foi possível registrar o resultado. Não tente publicar novamente; confira o canal."},500);}
  return reply({success:true,videoId:result.id,watchUrl,message:"Vídeo enviado ao YouTube. O processamento pode levar alguns minutos."});
 } catch(e){console.error("[youtube-publish]",e?.message||e);return reply({error:"Falha interna ao publicar no YouTube."},500);}
});