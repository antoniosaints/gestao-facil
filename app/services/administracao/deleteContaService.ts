import { prisma } from "../../utils/prisma";

/**
 * Exclui uma conta de assinante e TODOS os dados vinculados a ela.
 *
 * A exclusao roda em uma unica transacao com FOREIGN_KEY_CHECKS desativado
 * na sessao para nao depender da ordem exata das dezenas de FKs. Todos os
 * modelos com contaId sao apagados, alem dos modelos filhos (sem contaId)
 * apagados por filtro de relacao — nada fica orfao.
 */
export async function deleteContaCompletely(contaId: number) {
  return prisma.$transaction(
    async (tx) => {
      try {
        await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=0");

        // ---- Filhos sem contaId (via relacao) ----
        await tx.subscription.deleteMany({ where: { Usuarios: { contaId } } });
        await tx.mensagensInteracoesOrdemServico.deleteMany({ where: { ordem: { contaId } } });
        await tx.itensOrdensServico.deleteMany({ where: { ordem: { contaId } } });
        await tx.cobranca.deleteMany({ where: { assinatura: { contaId } } });
        await tx.planoAssinaturaItem.deleteMany({ where: { plano: { contaId } } });
        await tx.assinaturaComodato.deleteMany({ where: { assinaturaItem: { assinatura: { contaId } } } });
        await tx.assinaturaItem.deleteMany({ where: { assinatura: { contaId } } });
        await tx.assinaturaCiclo.deleteMany({ where: { assinatura: { contaId } } });
        await tx.assinaturaHistorico.deleteMany({ where: { assinatura: { contaId } } });
        await tx.assinaturaPagarLink.deleteMany({ where: { assinaturaPagar: { contaId } } });
        await tx.itensVendas.deleteMany({ where: { venda: { contaId } } });
        await tx.pagamentoVendas.deleteMany({ where: { venda: { contaId } } });
        await tx.parcelaFinanceiro.deleteMany({ where: { lancamento: { contaId } } });
        await tx.cobrancasOnAgendamentos.deleteMany({ where: { agendamento: { Quadra: { contaId } } } });
        await tx.arenaAgendamentosPagamentos.deleteMany({ where: { agendamento: { Quadra: { contaId } } } });
        await tx.arenaAgendamentos.deleteMany({ where: { Quadra: { contaId } } });
        await tx.comandaItem.deleteMany({ where: { Comanda: { contaId } } });
        await tx.comandaPagamento.deleteMany({ where: { Comanda: { contaId } } });
        await tx.comandaOperacaoItem.deleteMany({ where: { Comanda: { contaId } } });
        await tx.comandaOperacaoPagamento.deleteMany({ where: { Comanda: { contaId } } });
        await tx.comandaOperacaoHistorico.deleteMany({ where: { Comanda: { contaId } } });

        // ---- Modelos com contaId ----
        await tx.whatsAppMensagem.deleteMany({ where: { contaId } });
        await tx.whatsAppConversa.deleteMany({ where: { contaId } });
        await tx.whatsAppContato.deleteMany({ where: { contaId } });
        await tx.whatsAppWebhookEvento.deleteMany({ where: { contaId } });
        await tx.whatsAppInstanciaPagamento.deleteMany({ where: { contaId } });
        await tx.whatsAppInstancia.deleteMany({ where: { contaId } });
        await tx.caixaMovimento.deleteMany({ where: { contaId } });
        await tx.caixaOperador.deleteMany({ where: { contaId } });
        await tx.caixaSessao.deleteMany({ where: { contaId } });
        await tx.pdvPonto.deleteMany({ where: { contaId } });
        await tx.comandaVenda.deleteMany({ where: { contaId } });
        await tx.comandaOperacao.deleteMany({ where: { contaId } });
        await tx.comandaOperacaoConfiguracao.deleteMany({ where: { contaId } });
        await tx.arenaQuadras.deleteMany({ where: { contaId } });
        await tx.notificacaoVencimentoFinanceiro.deleteMany({ where: { contaId } });
        await tx.cobrancasFinanceiras.deleteMany({ where: { contaId } });
        await tx.lancamentoFinanceiro.deleteMany({ where: { contaId } });
        await tx.contasFinanceiro.deleteMany({ where: { contaId } });
        await tx.categoriaFinanceiro.deleteMany({ where: { contaId } });
        await tx.assinaturaCliente.deleteMany({ where: { contaId } });
        await tx.assinaturaPagar.deleteMany({ where: { contaId } });
        await tx.planoAssinatura.deleteMany({ where: { contaId } });
        await tx.assinatura.deleteMany({ where: { contaId } });
        await tx.vendas.deleteMany({ where: { contaId } });
        await tx.ordensServico.deleteMany({ where: { contaId } });
        await tx.movimentacoesEstoque.deleteMany({ where: { contaId } });
        await tx.notaFiscal.deleteMany({ where: { contaId } });
        await tx.produto.deleteMany({ where: { contaId } });
        await tx.produtoBase.deleteMany({ where: { contaId } });
        await tx.produtoCategoria.deleteMany({ where: { contaId } });
        await tx.servicos.deleteMany({ where: { contaId } });
        await tx.clientesFornecedores.deleteMany({ where: { contaId } });
        await tx.meta.deleteMany({ where: { contaId } });
        await tx.moduloOnConta.deleteMany({ where: { contaId } });
        await tx.faturasContas.deleteMany({ where: { contaId } });
        await tx.parametrosConta.deleteMany({ where: { contaId } });
        await tx.usuarios.deleteMany({ where: { contaId } });

        await tx.contas.delete({ where: { id: contaId } });
      } finally {
        try {
          await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS=1");
        } catch {
          // Transacao abortada: a conexao sera descartada pelo pool.
        }
      }
    },
    { timeout: 120000 },
  );
}
