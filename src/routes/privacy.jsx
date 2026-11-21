import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — Fábrica de Fatos" },
      { name: "description", content: "Saiba como a Fábrica de Fatos trata seus dados pessoais." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Fábrica de Fatos</Link>
        <p className="eyebrow mt-10">Informações legais</p>
        <h1 className="mt-3 font-display text-4xl tracking-tight sm:text-5xl">Política de Privacidade</h1>
        <p className="mt-3 text-sm text-muted-foreground">Última atualização: 21 de novembro de 2026</p>

        <div className="mt-10 space-y-8 text-sm leading-7 text-muted-foreground">
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">1. Quem somos</h2>
            <p>Esta Política explica como a Fábrica de Fatos trata dados pessoais quando você utiliza nossa plataforma web de criação de vídeos. Para dúvidas ou solicitações de privacidade, entre em contato pelo e-mail <a className="text-foreground underline underline-offset-4" href="mailto:gjngngvb@gmail.com">gjngngvb@gmail.com</a>.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">2. Dados que podemos tratar</h2>
            <ul className="list-disc space-y-2 pl-5">
              <li><strong className="text-foreground">Dados da conta:</strong> endereço de e-mail, identificador de usuário e informações básicas necessárias para autenticação e funcionamento da conta.</li>
              <li><strong className="text-foreground">Dados e conteúdos fornecidos:</strong> temas, instruções, roteiros, preferências de criação e outros materiais que você inserir na plataforma.</li>
              <li><strong className="text-foreground">Conteúdo produzido:</strong> imagens, narrações, legendas, vídeos e informações técnicas relacionadas aos trabalhos gerados e armazenados.</li>
              <li><strong className="text-foreground">Dados da conexão TikTok:</strong> quando você autoriza a integração, podemos receber identificadores e informações básicas do perfil, além de tokens de acesso e renovação necessários para manter a conexão e executar ações autorizadas, como iniciar uma publicação.</li>
              <li><strong className="text-foreground">Dados técnicos:</strong> informações de sessão, registros de operação, erros e dados técnicos necessários para proteger, manter e diagnosticar o serviço.</li>
            </ul>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">3. Como utilizamos os dados</h2>
            <p>Utilizamos os dados para criar e administrar sua conta, executar suas solicitações de geração de conteúdo, armazenar e disponibilizar seus projetos, conectar sua conta TikTok quando solicitado, realizar ações de publicação autorizadas, prestar suporte, proteger a plataforma e corrigir falhas. Não utilizamos os tokens do TikTok para finalidades diferentes da manutenção da conexão e das ações autorizadas pelo usuário.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">4. Serviços de terceiros</h2>
            <p>Para operar a plataforma, dados estritamente necessários podem ser processados por fornecedores de infraestrutura e funcionalidades, incluindo Supabase (autenticação, banco de dados e armazenamento), Vercel (hospedagem), OpenRouter (processamento de solicitações de texto por modelos de IA), Cloudflare (geração de imagens) e serviços de síntese de voz. Se você conectar o TikTok, dados também serão transmitidos ao TikTok para autenticação e execução das funções solicitadas. Esses fornecedores tratam dados conforme seus próprios termos e políticas.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">5. Compartilhamento</h2>
            <p>Não vendemos seus dados pessoais. O compartilhamento ocorre quando necessário para fornecer as funções solicitadas, operar a infraestrutura, cumprir obrigações legais, proteger direitos e segurança ou responder a solicitações válidas de autoridades. Quando você solicita uma publicação, o conteúdo e os dados necessários são enviados ao TikTok conforme as permissões concedidas.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">6. Armazenamento e segurança</h2>
            <p>Os dados são armazenados em serviços de infraestrutura utilizados pela plataforma e protegidos por medidas técnicas e organizacionais destinadas a evitar acesso não autorizado, perda ou uso indevido. Tokens de integração são mantidos para viabilizar a conexão autorizada. Nenhum método de transmissão ou armazenamento é completamente infalível, por isso não podemos garantir segurança absoluta.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">7. Retenção e exclusão</h2>
            <p>Mantemos os dados enquanto forem necessários para fornecer o serviço, manter sua conta, cumprir obrigações legais ou resolver questões pendentes. Você pode solicitar acesso, correção ou exclusão de dados pessoais pelo e-mail <a className="text-foreground underline underline-offset-4" href="mailto:gjngngvb@gmail.com">gjngngvb@gmail.com</a>. Analisaremos e atenderemos solicitações conforme a legislação aplicável. A exclusão de dados pode impedir o funcionamento de recursos associados à conta.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">8. Desconexão do TikTok</h2>
            <p>Você pode interromper a integração revogando o acesso da Fábrica de Fatos nas configurações de segurança ou aplicativos autorizados da sua conta TikTok. Também pode solicitar ajuda pelo nosso e-mail de contato. A revogação impede novas operações que dependam daquela autorização, mas não exclui automaticamente conteúdos que já tenham sido publicados no TikTok.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">9. Transferências internacionais</h2>
            <p>Como utilizamos fornecedores de tecnologia que podem operar em diferentes países, seus dados poderão ser processados fora do Brasil, observadas as salvaguardas e exigências previstas na legislação aplicável.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">10. Seus direitos</h2>
            <p>Nos termos da legislação de proteção de dados aplicável, incluindo a LGPD quando pertinente, você pode solicitar confirmação do tratamento, acesso, correção, anonimização, bloqueio, eliminação, portabilidade quando aplicável, informações sobre compartilhamento e revisão de decisões automatizadas nos casos previstos em lei. Para exercer seus direitos, escreva para <a className="text-foreground underline underline-offset-4" href="mailto:gjngngvb@gmail.com">gjngngvb@gmail.com</a>.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">11. Alterações desta Política</h2>
            <p>Esta Política pode ser atualizada para refletir mudanças no serviço ou nas práticas de tratamento de dados. A versão vigente ficará disponível nesta página com sua data de atualização.</p>
          </section>
        </div>
        <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
          <Link to="/terms" className="underline underline-offset-4">Termos de Serviço</Link>
          <span className="mx-2">·</span>
          <a href="mailto:gjngngvb@gmail.com" className="underline underline-offset-4">Contato</a>
        </footer>
      </article>
    </main>
  );
}
