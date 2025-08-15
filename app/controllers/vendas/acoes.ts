import { Vendas } from "../../../generated";

export const VendasAcoes = (row: Vendas) => {
  return `<div class="flex flex-nowrap items-center gap-1 p-1">
            <button
                type="button"
                title="Visualizar venda"
                onclick="visualizarVenda('${row.id}')"
                class="text-cyan-500 px-1 py-[2px] rounded">
                <i class="fa-solid fa-eye"></i>
            </button>
            <button
                type="button"
                title="Gerar Cupom não fiscal"
                onclick="gerarCupomPorVendaId('${row.id}')"
                class="text-orange-500 px-1 py-[2px] rounded">
                <i class="fa-solid fa-file-pdf"></i>
            </button>
            ${
              row.faturado
                ? `
                    <button
                        type="button"
                        title="Estornar venda"
                        onclick="estornarVenda('${row.id}')"
                        class="text-yellow-500 px-1 py-[2px] rounded">
                        <i class="fa-solid fa-undo"></i>
                    </button>
                    `
                : `
                    <button
                        type="button"
                        title="Efetivar venda"
                        onclick="efetivarVenda('${row.id}')"
                        class="text-success px-1 py-[2px] rounded">
                        <i class="fa-solid fa-circle-check"></i>
                    </button>
                    <button
                        type="button"
                        title="Editar venda"
                        onclick="loadPage('vendas/formulario?id=${row.id}')"
                        class="text-blue-500 px-1 py-[2px] rounded">
                        <i class="fa-solid fa-user-pen"></i>
                    </button>
                    <button
                        type="button"
                        title="Excluir venda"
                        onclick="excluirVenda('${row.id}')"
                        class="text-danger px-1 py-[2px] rounded">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                `
            }
            </div>`;
};
