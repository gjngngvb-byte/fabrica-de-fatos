import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const APP_URL=(Deno.env.get("APP_URL")||"https://fabrica-de-fatos.vercel.app").replace(/\/$/,"");
const fail=(m:string)=>Response.redirect(APP_URL+"/configuracoes?integration_error="+encodeURIComponent(m),302);
Deno.serve(async(req)=>{
 const url=new URL(req.url),code=url.searchParams.get("code"),state=url.searchParams.get("state"),error=url.searchParams.get("error");
 if(error) return fail("A autorização do Google foi cancelada ou recusada.");
 if(!code||!state) return fail("Autorização do YouTube incompleta.");
 try {
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:oauth,error:stateError}=await admin.from("youtube_oauth_states").select("user_id").eq("state",state).gt("expires_at",new Date().toISOString()).maybeSingle();
  if(stateError||!oauth) return fail("Estado OAuth inválido ou expirado. Tente conectar novamente.");
  await admin.from("youtube_oauth_states").delete().eq("state",state);
  const clientId=Deno.env.get("YOUTUBE_CLIENT_ID"),secret=Deno.env.get("YOUTUBE_CLIENT_SECRET"),redirect=Deno.env.get("YOUTUBE_REDIRECT_URI");
  if(!clientId||!secret||!redirect) return fail("As credenciais OAuth do YouTube não estão configuradas.");
  const form=new URLSearchParams({code,client_id:clientId,client_secret:secret,redirect_uri:redirect,grant_type:"authorization_code"});
  const tokenRes=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
  const tokenData=await tokenRes.json();
  if(!tokenRes.ok||!tokenData.access_token) { console.error("[youtube-callback] token exchange failed",tokenData.error);return fail("O Google não concluiu a autorização. Confira o URI de redirecionamento e tente novamente.");}
  const channelRes=await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet%2Cid&mine=true",{headers:{Authorization:"Bearer "+tokenData.access_token}});
  const channelData=await channelRes.json(),channel=channelData.items?.[0];
  if(!channelRes.ok||!channel?.id) return fail("Não foi possível identificar o canal do YouTube autorizado.");
  const {data:existing}=await admin.from("youtube_connections").select("refresh_token").eq("user_id",oauth.user_id).maybeSingle();
  const refreshToken=tokenData.refresh_token||existing?.refresh_token;
  if(!refreshToken) return fail("O Google não forneceu um token de renovação. Desconecte o acesso antigo da Fábrica de Fatos na sua Conta Google e conecte novamente.");
  const {error:saveError}=await admin.from("youtube_connections").upsert({user_id:oauth.user_id,channel_id:channel.id,channel_title:channel.snippet?.title||"",access_token:tokenData.access_token,refresh_token:refreshToken,access_token_expires_at:new Date(Date.now()+Number(tokenData.expires_in||3600)*1000).toISOString(),scope:tokenData.scope||"https://www.googleapis.com/auth/youtube.upload",updated_at:new Date().toISOString()});
  if(saveError) {console.error("[youtube-callback] save failed",saveError.message);return fail("Não foi possível salvar a conexão do YouTube.");}
  return Response.redirect(APP_URL+"/configuracoes?integration=youtube_connected",302);
 } catch(e){console.error("[youtube-callback]",e?.message||e);return fail("Falha inesperada ao conectar o YouTube.");}
});