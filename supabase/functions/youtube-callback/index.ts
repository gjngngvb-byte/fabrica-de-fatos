import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const APP_URL=(Deno.env.get("APP_URL")||"https://fabrica-de-fatos.vercel.app").replace(/\/$/,"");
const redirectTo=(origin:string,message?:string)=>{
 const target=new URL("/configuracoes",origin);
 if(message) target.searchParams.set("integration_error",message);
 return Response.redirect(target.toString(),302);
};
Deno.serve(async(req)=>{
 const url=new URL(req.url),code=url.searchParams.get("code"),state=url.searchParams.get("state"),googleError=url.searchParams.get("error");
 if(!state) return redirectTo(APP_URL,"Autorização do YouTube incompleta.");
 try {
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const {data:oauth,error:stateError}=await admin.from("youtube_oauth_states").select("user_id,return_to").eq("state",state).gt("expires_at",new Date().toISOString()).maybeSingle();
  if(stateError||!oauth) return redirectTo(APP_URL,"Estado OAuth inválido ou expirado. Tente conectar novamente.");
  const returnTo=oauth.return_to||APP_URL;
  await admin.from("youtube_oauth_states").delete().eq("state",state);
  if(googleError) return redirectTo(returnTo,"A autorização do Google foi cancelada ou recusada.");
  if(!code) return redirectTo(returnTo,"Autorização do YouTube incompleta.");
  const clientId=Deno.env.get("YOUTUBE_CLIENT_ID"),secret=Deno.env.get("YOUTUBE_CLIENT_SECRET"),redirect=Deno.env.get("YOUTUBE_REDIRECT_URI");
  if(!clientId||!secret||!redirect) return redirectTo(returnTo,"As credenciais OAuth do YouTube não estão configuradas.");
  const form=new URLSearchParams({code,client_id:clientId,client_secret:secret,redirect_uri:redirect,grant_type:"authorization_code"});
  const tokenRes=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
  const tokenData=await tokenRes.json();
  if(!tokenRes.ok||!tokenData.access_token) { console.error("[youtube-callback] token exchange failed",tokenData.error);return redirectTo(returnTo,"O Google não concluiu a autorização. Confira o URI de redirecionamento e tente novamente.");}
  const channelRes=await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet%2Cid&mine=true",{headers:{Authorization:"Bearer "+tokenData.access_token}});
  const channelData=await channelRes.json(),channel=channelData.items?.[0];
  if(!channelRes.ok||!channel?.id) {
   console.error("[youtube-callback] channel lookup failed",channelRes.status,channelData?.error?.code,channelData?.error?.message);
   return redirectTo(returnTo,channelRes.status===403?"O Google não liberou a leitura do canal. Confira se youtube.readonly está habilitada no acesso a dados OAuth e reconecte.":"Não foi possível identificar o canal do YouTube autorizado.");
  }
  const {data:existing}=await admin.from("youtube_connections").select("refresh_token").eq("user_id",oauth.user_id).maybeSingle();
  const refreshToken=tokenData.refresh_token||existing?.refresh_token;
  if(!refreshToken) return redirectTo(returnTo,"O Google não forneceu um token de renovação. Desconecte o acesso antigo da Fábrica de Fatos na sua Conta Google e conecte novamente.");
  const {error:saveError}=await admin.from("youtube_connections").upsert({user_id:oauth.user_id,channel_id:channel.id,channel_title:channel.snippet?.title||"",access_token:tokenData.access_token,refresh_token:refreshToken,access_token_expires_at:new Date(Date.now()+Number(tokenData.expires_in||3600)*1000).toISOString(),scope:tokenData.scope||"https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",updated_at:new Date().toISOString()});
  if(saveError) {console.error("[youtube-callback] save failed",saveError.message);return redirectTo(returnTo,"Não foi possível salvar a conexão do YouTube.");}
  const successUrl=new URL("/configuracoes",returnTo);
  successUrl.searchParams.set("integration","youtube_connected");
  return Response.redirect(successUrl.toString(),302);
 } catch(e){console.error("[youtube-callback]",e?.message||e);return redirectTo(APP_URL,"Falha inesperada ao conectar o YouTube.");}
});