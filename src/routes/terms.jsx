import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Termos de Serviço — Fábrica de Fatos" },
      { name: "description", content: "Termos de uso da plataforma Fábrica de Fatos." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Fábrica de Fatos</Link>
        <p className="eyebrow mt-10">Informações legais</p>
        <h1 className="mt-3 font-display text-4xl tracking-tight sm:text-5xl">Termos de Serviço</h1>
        <p className="mt-3 text-sm text-muted-foreground">Última atualização: 21 de novembro de 2026</p>

        <div className="mt-10 space-y-8 text-sm leading-7 text-muted-foreground">
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">1. Sobre a plataforma</h2>
            <p>A Fábrica de Fatos é uma plataforma web que auxilia na criação de vídeos curtos, incluindo geração de temas, roteiros, imagens, narrações, legendas e montagem de arquivos de vídeo. Algumas funções podem permitir a conexão com uma conta TikTok e o envio de vídeos para essa plataforma, conforme disponibilidade e aprovação das permissões exigidas pelo TikTok.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">2. Aceitação e conta</h2>
            <p>Ao acessar ou utilizar a Fábrica de Fatos, você concorda com estes Termos e com nossa <Link to="/privacy" className="text-foreground underline underline-offset-4">Política de Privacidade</Link>. Você é responsável por manter a segurança de suas credenciais e pelas atividades realizadas em sua conta. Forneça informações corretas e mantenha o acesso à sua conta protegido.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">3. Uso permitido</h2>
            <p>Você concorda em utilizar a plataforma de forma lícita e respeitando os direitos de terceiros. Não utilize o serviço para criar ou distribuir conteúdo ilegal, enganoso, abusivo, discriminatório, que viole direitos autorais, marcas, privacidade ou as regras das plataformas de destino. Você deve ter os direitos e autorizações necessários para todo material que enviar ou publicar.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">4. Conteúdo gerado e responsabilidade</h2>
            <p>Os textos, imagens, narrações, legendas e vídeos podem ser produzidos com auxílio de sistemas automatizados e inteligência artificial. Esses resultados podem conter erros, imprecisões ou elementos semelhantes a materiais existentes. Revise o conteúdo antes de utilizá-lo ou publicá-lo. Você é responsável por verificar sua exatidão, adequação, direitos de uso e conformidade com as regras do TikTok e de outras plataformas.</p>
            <p className="mt-2">Você mantém a responsabilidade pelo conteúdo que fornece, gera, baixa ou publica. A disponibilização de ferramentas de publicação não garante aprovação, alcance, monetização ou permanência de qualquer conteúdo no TikTok.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">5. Integração com o TikTok</h2>
            <p>A conexão com o TikTok depende da autorização do usuário, das permissões concedidas e das análises e regras do próprio TikTok. O uso da integração também está sujeito aos termos e políticas do TikTok. Você pode deixar de utilizar a integração e revogar as autorizações concedidas nas configurações da sua conta TikTok. A Fábrica de Fatos não é afiliada, patrocinada ou endossada pelo TikTok.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">6. Disponibilidade e alterações</h2>
            <p>A plataforma pode ser atualizada, modificada, suspensa ou descontinuada, total ou parcialmente. Recursos automatizados dependem de serviços de terceiros e podem sofrer limites, indisponibilidade ou alterações. Não garantimos funcionamento ininterrupto nem que todo processamento será concluído sem falhas.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">7. Propriedade intelectual</h2>
            <p>A marca, a interface e os elementos próprios da Fábrica de Fatos são protegidos pelas leis aplicáveis. Estes Termos não transferem a você direitos sobre a plataforma. Quanto aos materiais inseridos por você e aos resultados gerados, seu uso deve respeitar os direitos de terceiros, as condições dos serviços de inteligência artificial utilizados e a legislação aplicável.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">8. Limitação de responsabilidade</h2>
            <p>Na máxima extensão permitida pela legislação aplicável, a Fábrica de Fatos não se responsabiliza por decisões tomadas com base em conteúdo gerado automaticamente, por remoções ou restrições aplicadas por plataformas de terceiros, nem por interrupções causadas por serviços externos. Nada nestes Termos exclui responsabilidades que não possam ser afastadas por lei.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">9. Privacidade e contato</h2>
            <p>O tratamento de dados pessoais é explicado na <Link to="/privacy" className="text-foreground underline underline-offset-4">Política de Privacidade</Link>. Para dúvidas sobre estes Termos, suporte ou solicitações relacionadas à conta, escreva para <a className="text-foreground underline underline-offset-4" href="mailto:gjngngvb@gmail.com">gjngngvb@gmail.com</a>.</p>
          </section>
          <section>
            <h2 className="mb-2 text-lg font-semibold text-foreground">10. Alterações destes Termos</h2>
            <p>Podemos atualizar estes Termos para refletir mudanças na plataforma ou na legislação. A versão vigente será publicada nesta página com a data de atualização. O uso continuado após a publicação das alterações representa ciência dos novos Termos, sem prejuízo dos direitos garantidos pela legislação aplicável.</p>
          </section>
        </div>
        <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
          <Link to="/privacy" className="underline underline-offset-4">Política de Privacidade</Link>
          <span className="mx-2">·</span>
          <a href="mailto:gjngngvb@gmail.com" className="underline underline-offset-4">Contato</a>
        </footer>
      </article>
    </main>
  );
}
