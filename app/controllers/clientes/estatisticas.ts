import { Request, Response } from "express";
import { ResponseHandler } from "../../utils/response";
import { handleError } from "../../utils/handleError";
import { prisma } from "../../utils/prisma";
import { getCustomRequest } from "../../helpers/getCustomRequest";

export const getClienteStats = async (req: Request, res: Response): Promise<any> => {
    try {
        const { id } = req.params;
        const customData = getCustomRequest(req).customData;
        const clienteId = Number(id);
        const contaId = customData.contaId;

        // Verificar se cliente existe
        const cliente = await prisma.clientesFornecedores.findUnique({
            where: { id: clienteId, contaId: contaId },
            select: { id: true, nome: true, tipo: true }
        });

        if (!cliente) {
            return ResponseHandler(res, "Cliente não encontrado", null, 404);
        }

        const isFornecedor = cliente.tipo === 'FORNECEDOR';

        // 1. Vendas (Se Cliente)
        let totalVendas = 0;
        let qtdVendas = 0;
        let lucroEstimado = 0;

        if (!isFornecedor) {
            const vendas = await prisma.vendas.findMany({
                where: {
                    clienteId: clienteId,
                    contaId: contaId,
                    status: { in: ['FINALIZADO', 'FATURADO'] } // Ajustar conforme enum real
                },
                include: {
                    MovimentacoesEstoque: true // Para calcular custo
                }
            });

            qtdVendas = vendas.length;
            
            for (const venda of vendas) {
                const valorVenda = Number(venda.valor) - Number(venda.desconto || 0);
                totalVendas += valorVenda;

                // Custo: Soma do custo das movimentações de saída vinculadas
                // Assumindo que MovimentacoesEstoque.custo é unitário * quantidade ou total? 
                // Geralmente custo é unitário. Vamos verificar schema: custo Decimal(10,2).
                // Se for custo unitário: custo * quantidade.
                const custoVenda = venda.MovimentacoesEstoque
                    .filter(m => m.tipo === 'SAIDA')
                    .reduce((acc, curr) => acc + (Number(curr.custo) * curr.quantidade), 0);
                
                lucroEstimado += (valorVenda - custoVenda);
            }
        }

        // 2. Compras (Se Fornecedor)
        let totalCompras = 0;
        let qtdCompras = 0;

        if (isFornecedor) {
            // Compras podem ser Vendas onde ele é fornecedor? 
            // OU Movimentações de Entrada onde ele é o "clienteFornecedor"
            // O sistema parece usar MovimentacoesEstoque com clienteFornecedor para entradas de nota.
            
            const movimentacoesEntrada = await prisma.movimentacoesEstoque.findMany({
                where: {
                    contaId: contaId,
                    clienteFornecedor: clienteId,
                    tipo: 'ENTRADA'
                }
            });

            qtdCompras = movimentacoesEntrada.length;
            totalCompras = movimentacoesEntrada.reduce((acc, curr) => acc + (Number(curr.custo) * curr.quantidade), 0);
        }

        // 3. Ordens de Serviço
        const ordensServico = await prisma.ordensServico.findMany({
            where: {
                clienteId: clienteId,
                contaId: contaId,
                status: { in: ['FATURADA', 'APROVADA'] } // Ajustar status
            },
            include: {
                ItensOrdensServico: true
            }
        });

        const qtdOS = ordensServico.length;
        // Calcular valor total das OS (itens seriam a fonte de valor, ou a OS tem valor total?)
        // Schema não tem valor total na OS, apenas nos Itens.
        const totalOS = ordensServico.reduce((acc, os) => {
             const totalItens = os.ItensOrdensServico.reduce((sum, item) => sum + (Number(item.valor) * item.quantidade), 0);
             return acc + totalItens - Number(os.desconto || 0);
        }, 0);

        // 4. Financeiro
        // Receitas (Recebido)
        const lancamentosReceita = await prisma.lancamentoFinanceiro.findMany({
            where: {
                clienteId: clienteId,
                contaId: contaId,
                tipo: 'RECEITA',
                status: 'PAGO'
            }
        });
        const totalRecebido = lancamentosReceita.reduce((acc, l) => acc + Number(l.valorTotal), 0);

        // Despesas (Pago ao fornecedor)
        const lancamentosDespesa = await prisma.lancamentoFinanceiro.findMany({
             where: {
                clienteId: clienteId,
                contaId: contaId,
                tipo: 'DESPESA',
                status: 'PAGO'
            }
        });
        const totalPago = lancamentosDespesa.reduce((acc, l) => acc + Number(l.valorTotal), 0);

        // Pendente (A Receber ou A Pagar)
        const lancamentosPendente = await prisma.lancamentoFinanceiro.findMany({
            where: {
                clienteId: clienteId,
                contaId: contaId,
                status: { in: ['PENDENTE', 'ATRASADO', 'PARCIAL'] }
            }
        });
        
        const totalPendenteReceber = lancamentosPendente
            .filter(l => l.tipo === 'RECEITA')
            .reduce((acc, l) => acc + Number(l.valorTotal), 0);
            
        const totalPendentePagar = lancamentosPendente
            .filter(l => l.tipo === 'DESPESA')
            .reduce((acc, l) => acc + Number(l.valorTotal), 0);


        return ResponseHandler(res, "Estatísticas recuperadas com sucesso", {
            cliente,
            vendas: {
                total: totalVendas,
                quantidade: qtdVendas,
                lucroEstimado: lucroEstimado.toFixed(2)
            },
            compras: { // Para fornecedores
                total: totalCompras,
                quantidade: qtdCompras
            },
            os: {
                total: totalOS,
                quantidade: qtdOS
            },
            financeiro: {
                recebido: totalRecebido,
                pago: totalPago,
                pendenteReceber: totalPendenteReceber,
                pendentePagar: totalPendentePagar
            }
        });

    } catch (err: any) {
        handleError(res, err);
    }
}
