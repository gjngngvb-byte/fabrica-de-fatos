# Fábrica de Fatos

Aplicação TanStack Start migrada do Base44 para Supabase + Vercel.

## Infraestrutura provisionada

- Supabase: projeto `euhaqqwzfsezbupsmjas` na região `sa-east-1`.
- Banco: tabelas `profiles`, `studios`, `videos`, `tiktok_connections`, `tiktok_oauth_states` e `tiktok_publications`, com RLS.
- Storage: bucket privado `assets`.
- Edge Functions: `generate-video-kit`, `render-video`, `tiktok-connect`, `tiktok-callback`, `tiktok-publish`, `claim-legacy-data`.
- Histórico antigo: 5 vídeos e 1 configuração do estúdio preservados em uma fila privada; serão copiados para o primeiro usuário que criar conta, incluindo mídias acessíveis.
- Vercel: projeto `fabrica-de-fatos`, conectado ao branch `main` do GitHub.

## Desenvolvimento

1. Copie `.env.example` para `.env.local`.
2. Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. Execute `npm install` e `npm run dev`.

## Secrets necessários no Supabase

Configure em Project Settings > Edge Functions > Secrets:

- `OPENAI_API_KEY`: geração do roteiro, imagens e narração.
- `VIDEO_PROVIDER_API_KEY` e `VIDEO_PROVIDER_BASE_URL`: provedor compatível com a API de vídeo usada pela função de renderização.
- `TIKTOK_CLIENT_KEY` e `TIKTOK_CLIENT_SECRET`: credenciais do app TikTok for Developers.
- `TIKTOK_REDIRECT_URI`: `https://euhaqqwzfsezbupsmjas.supabase.co/functions/v1/tiktok-callback`.
- `APP_URL`: URL pública do app na Vercel.

O callback informado em `TIKTOK_REDIRECT_URI` também precisa estar cadastrado exatamente no TikTok for Developers. A aplicação TikTok precisa ter aprovados os escopos `user.info.basic` e `video.publish`.

## Supabase Auth

No painel Authentication > URL Configuration, configure o Site URL e adicione a URL da Vercel, incluindo `/reset-password`, como Redirect URL. Habilite Google OAuth no Supabase se desejar login com Google.

## Observações

- Roteiro, imagens e áudio exigem `OPENAI_API_KEY`.
- Renderização MP4 exige um provedor de vídeo compatível.
- Publicação TikTok exige credenciais de desenvolvedor e aprovação de `video.publish`; conecte a conta em Ajustes.
- O envio ao TikTok está implementado como ação explícita no detalhe do vídeo. Publicação automática recorrente ainda exige agendamento/cron e credenciais aprovadas.
- A criação do projeto Supabase foi cotada em US$ 0/mês. OpenAI e provedor de vídeo podem gerar cobranças próprias.
