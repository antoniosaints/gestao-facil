import { WhatsAppConversaEventoTipo, WhatsAppConversaStatus } from "../../../generated";

// A conversa é uma thread rolante por contato: seu `status` é sobrescrito a cada transição e a
// mesma linha é reaproveitada quando o cliente volta a falar. Por isso o histórico de atendimento
// vive em WhatsAppConversaEvento (append-only) e não em datas na conversa.
//
// Esta função concentra a regra em um único lugar porque a transição acontece em três caminhos
// diferentes (assumir atendimento, atualizar conversa e webhook de mensagem recebida).

export type TransicaoAtendimento = {
  // Evento a registrar no log, ou null quando o status não mudou de fase.
  evento: WhatsAppConversaEventoTipo | null;
  // Patch da conversa. `undefined` significa "não alterar".
  filaDesde: Date | null | undefined;
  atendidaEm: Date | null | undefined;
  // Início do intervalo que o evento fecha: a espera na fila para ASSUMIDA, a duração do
  // atendimento para FINALIZADA. Viaja no evento para que o painel calcule as médias sem
  // precisar parear linhas do log.
  referenciaEm: Date | null;
};

const SEM_TRANSICAO: TransicaoAtendimento = {
  evento: null,
  filaDesde: undefined,
  atendidaEm: undefined,
  referenciaEm: null,
};

export function resolverTransicaoAtendimento(params: {
  statusAnterior: WhatsAppConversaStatus | null;
  statusNovo: WhatsAppConversaStatus;
  filaDesde: Date | null;
  atendidaEm: Date | null;
  agora: Date;
}): TransicaoAtendimento {
  const { statusAnterior, statusNovo, filaDesde, atendidaEm, agora } = params;

  // Sem mudança de fase não há evento: evita inflar o log (e reiniciar o relógio da fila) quando
  // o webhook processa várias mensagens de uma conversa que já estava na mesma fase.
  if (statusAnterior === statusNovo) return SEM_TRANSICAO;

  switch (statusNovo) {
    // Entrou na fila aguardando atendimento humano.
    case WhatsAppConversaStatus.PENDENTE:
      return {
        evento: WhatsAppConversaEventoTipo.ENFILEIRADA,
        filaDesde: agora,
        atendidaEm: null,
        referenciaEm: null,
      };
    // Alguém assumiu: sai da fila e começa a contar o tempo de atendimento. O evento fecha o
    // intervalo de espera.
    case WhatsAppConversaStatus.ABERTA:
      return {
        evento: WhatsAppConversaEventoTipo.ASSUMIDA,
        filaDesde: null,
        atendidaEm: agora,
        referenciaEm: filaDesde,
      };
    // Encerrou: o evento fecha o intervalo de atendimento.
    case WhatsAppConversaStatus.FINALIZADA:
      return {
        evento: WhatsAppConversaEventoTipo.FINALIZADA,
        filaDesde: null,
        atendidaEm: null,
        referenciaEm: atendidaEm,
      };
    default:
      return SEM_TRANSICAO;
  }
}

// Duração fechada por um evento, em ms. Devolve null quando não há referência (ex.: atendente
// iniciou a conversa e ela nunca passou por uma fila), para não contar zero e puxar a média
// para baixo. Também descarta valores negativos vindos de relógio fora de ordem.
export function calcularDuracaoMs(referenciaEm: Date | null | undefined, fim: Date): number | null {
  if (!referenciaEm) return null;
  const ms = fim.getTime() - referenciaEm.getTime();
  return ms >= 0 ? ms : null;
}

export type EventoAtendimento = {
  conversaId: number;
  tipo: WhatsAppConversaEventoTipo;
  usuarioId: number | null;
  referenciaEm: Date | null;
  createdAt: Date;
};

export type CicloStatus = "NA_FILA" | "EM_ANDAMENTO" | "FINALIZADO";

export type CicloAtendimento = {
  conversaId: number;
  atendenteId: number | null;
  status: CicloStatus;
  entrouFilaEm: Date | null;
  assumidoEm: Date | null;
  finalizadoEm: Date | null;
  esperaMs: number | null;
  duracaoMs: number | null;
};

/**
 * Reconstrói os ciclos de atendimento (fila -> assumido -> finalizado) a partir do log
 * append-only. A conversa é uma thread rolante por contato, então a mesma conversa acumula
 * vários ciclos ao longo do tempo — por isso caminhamos cronologicamente por conversa em vez
 * de agregar por conversa.
 *
 * Ciclos que começaram antes da janela consultada chegam aqui só com o FINALIZADA. Nesse caso
 * usamos `referenciaEm` (o início do atendimento) e deixamos a espera como null: preferimos
 * admitir que não sabemos a espera a inventar zero e sujar as médias.
 */
export function montarCiclosAtendimento(eventos: EventoAtendimento[]): CicloAtendimento[] {
  const ordenados = [...eventos].sort(
    (a, b) => a.conversaId - b.conversaId || a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const ciclos: CicloAtendimento[] = [];
  let aberto: CicloAtendimento | null = null;
  let conversaAtual: number | null = null;

  const novoCiclo = (conversaId: number): CicloAtendimento => ({
    conversaId,
    atendenteId: null,
    status: "NA_FILA",
    entrouFilaEm: null,
    assumidoEm: null,
    finalizadoEm: null,
    esperaMs: null,
    duracaoMs: null,
  });

  const fechar = () => {
    if (aberto) ciclos.push(aberto);
    aberto = null;
  };

  for (const evento of ordenados) {
    if (evento.conversaId !== conversaAtual) {
      fechar();
      conversaAtual = evento.conversaId;
    }

    switch (evento.tipo) {
      case WhatsAppConversaEventoTipo.ENFILEIRADA: {
        // Um ciclo anterior ainda aberto foi abandonado sem finalizar (o cliente voltou a
        // falar antes do encerramento): fecha do jeito que está e começa um novo.
        fechar();
        aberto = novoCiclo(evento.conversaId);
        aberto.entrouFilaEm = evento.createdAt;
        break;
      }
      case WhatsAppConversaEventoTipo.ASSUMIDA: {
        if (!aberto) {
          aberto = novoCiclo(evento.conversaId);
          // O evento carrega a entrada na fila, então o ciclo é recuperável mesmo sem o
          // ENFILEIRADA na janela.
          aberto.entrouFilaEm = evento.referenciaEm;
        }
        aberto.assumidoEm = evento.createdAt;
        aberto.atendenteId = evento.usuarioId;
        aberto.esperaMs = calcularDuracaoMs(evento.referenciaEm, evento.createdAt);
        aberto.status = "EM_ANDAMENTO";
        break;
      }
      case WhatsAppConversaEventoTipo.FINALIZADA: {
        if (!aberto) {
          aberto = novoCiclo(evento.conversaId);
          // Sem o ASSUMIDA na janela, o início do atendimento vem da referência do evento.
          aberto.assumidoEm = evento.referenciaEm;
        }
        aberto.finalizadoEm = evento.createdAt;
        aberto.duracaoMs = calcularDuracaoMs(evento.referenciaEm, evento.createdAt);
        aberto.atendenteId = aberto.atendenteId ?? evento.usuarioId;
        aberto.status = "FINALIZADO";
        fechar();
        break;
      }
    }
  }
  fechar();

  return ciclos;
}

// Média em ms ignorando os valores desconhecidos, para que ciclos sem espera/duração medida
// não entrem como zero. Devolve null quando não há nenhuma amostra.
export function mediaMs(valores: (number | null)[]): number | null {
  const amostras = valores.filter((v): v is number => v !== null);
  if (!amostras.length) return null;
  return Math.round(amostras.reduce((acc, v) => acc + v, 0) / amostras.length);
}
