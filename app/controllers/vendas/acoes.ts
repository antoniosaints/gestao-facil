import { Vendas } from "../../../generated";

export const VendasAcoes = (row: Vendas) => {
  return `<div class="flex flex-nowrap items-center gap-1 p-1">
            <button
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
            <button
                onclick="editarVenda('${row.id}')"
                class="text-success px-1 py-[2px] rounded">
                <i class="fa-solid fa-user-pen"></i>
            </button>
            <button
                onclick="excluirVenda('${row.id}')"
                class="text-danger px-1 py-[2px] rounded">
                <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>`;
};
