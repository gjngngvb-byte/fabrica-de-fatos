import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:cors});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 try {
  const auth=req.headers.get("Authorization")||"", token=auth.replace(/^Bearer\s+/i,"");
  if(!token) return reply({error:"Faça login novamente."},401);
  const client=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
  const {data:{user},error}=await client.auth.getUser(token);
  if(error||!user) return reply({error:"Sessão inválida."},401);
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body=await req.json().catch(()=>({}));
  if(body.action==="status"){
   const {data,error}=await admin.from("youtube_connections").select("channel_id,channel_title,created_at").eq("user_id",user.id).maybeSingle();
   if(error) throw error;
   return reply({connected:!!data,account:data||null});
  }
  const clientId=Deno.env.get("YOUTUBE_CLIENT_ID"), redirect=Deno.env.get("YOUTUBE_REDIRECT_URI");
  if(!clientId||!Deno.env.get("YOUTUBE_CLIENT_SECRET")||!redirect) return reply({error:"As credenciais OAuth do YouTube não estão configuradas no Supabase."},503);
  const state=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,"0")).join("");
  const {error:insertError}=await admin.from("youtube_oauth_states").insert({state,user_id:user.id,expires_at:new Date(Date.now()+10*60*1000).toISOString()});
  if(insertError) throw insertError;
  const params=new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:"code",scope:"https://www.googleapis.com/auth/youtube.upload",access_type:"offline",prompt:"consent",include_granted_scopes:"true",state});
  return reply({url:"https://accounts.google.com/o/oauth2/v2/auth?"+params.toString()});
 } catch(e){console.error("[youtube-connect]",e?.message||e);return reply({error:"Não foi possível iniciar a conexão do YouTube."},500);}
});