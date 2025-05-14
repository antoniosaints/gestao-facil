export const VendasAcoes = (row: any) => {
  return `<div class="flex flex-nowrap items-center space-x-1">
            <button
                onclick="visualizarProduto('${row.id}')"
                class="text-cyan-500 px-1 py-[2px] rounded">
                <i class="fa-solid fa-eye"></i>
            </button>
            <button
                onclick="abrirModalReporProdutos('${row.id}')"
                class="text-info px-1 py-[2px] rounded">
                <i class="fa-solid fa-boxes-packing"></i>
            </button>
            <button
                onclick="editarProduto('${row.id}')"
                class="text-success px-1 py-[2px] rounded">
                <i class="fa-solid fa-user-pen"></i>
            </button>
            <button
                onclick="abrirModalRelatorioProdutoReposicao('${row.id}')"
                class="text-primary px-1 py-[2px] rounded">
                <i class="fa-solid fa-file-pdf"></i>
            </button>
            <button
                onclick="excluirProduto('${row.id}')"
                class="text-danger px-1 py-[2px] rounded">
                <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>`;
};
