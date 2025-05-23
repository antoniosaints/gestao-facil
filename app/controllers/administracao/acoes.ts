export const usuariosAcoes = (row: any) => {
    return `<div class="flex flex-nowrap items-center space-x-1">
              <button
                  onclick="visualizarProduto('${row.id}')"
                  class="text-cyan-500 px-1 py-[2px] rounded">
                  <i class="fa-solid fa-eye"></i>
              </button>
              <button
                  onclick="editarProduto('${row.id}')"
                  class="text-success px-1 py-[2px] rounded">
                  <i class="fa-solid fa-user-pen"></i>
              </button>
              <button
                  onclick="excluirProduto('${row.id}')"
                  class="text-danger px-1 py-[2px] rounded">
                  <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>`;
  };
  