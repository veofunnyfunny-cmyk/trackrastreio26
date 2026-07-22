// Jornada de rastreio automática.
//
// O rastreio "anda sozinho" conforme os dias passam desde a criação do pedido.
// Cada etapa tem um `dias` (quantos dias após a venda ela acontece), um status
// e uma descrição. A página de rastreio mostra as etapas que já "aconteceram".
//
// É uma jornada fictícia (padrão ~10 dias). Quando você integrar o rastreio
// real da transportadora, troca isto pelos eventos reais.

const ORIGEM = 'São Paulo/SP';

const STAGES = [
  { dias: 0,  status: 'Pedido confirmado',   desc: 'Recebemos seu pedido e ele já está sendo preparado.' },
  { dias: 1,  status: 'Em preparação',       desc: 'Seu pedido está sendo separado e embalado no nosso centro de distribuição.' },
  { dias: 2,  status: 'Pedido postado',      desc: `Seu pedido saiu de ${ORIGEM} com destino a {destino}.` },
  { dias: 4,  status: 'Em trânsito',         desc: 'Seu pedido está a caminho.' },
  { dias: 6,  status: 'Em trânsito',         desc: 'Seu pedido passou pelo centro de triagem e segue para a sua região.' },
  { dias: 8,  status: 'Em trânsito',         desc: 'Seu pedido chegou à unidade de distribuição mais próxima de você.' },
  { dias: 9,  status: 'Saiu para entrega',   desc: 'Seu pedido saiu para entrega e chega em breve.' },
  { dias: 10, status: 'Entregue',            desc: 'Seu pedido foi entregue. Obrigado pela compra! 💙' },
];

const DIA_MS = 24 * 60 * 60 * 1000;

function destinoTexto(t) {
  if (t.customer_city) return `${t.customer_city}${t.customer_state ? '/' + t.customer_state : ''}`;
  if (t.customer_cep) return `CEP ${t.customer_cep}`;
  return 'seu endereço';
}

function parseCreated(t) {
  // created_at vem como 'YYYY-MM-DD HH:MM:SS' em UTC.
  const iso = String(t.created_at || '').replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? new Date() : d;
}

function render(desc, t) {
  return desc.replace('{destino}', destinoTexto(t));
}

function fmtData(d) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function fmtDataCurta(d) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Monta a linha do tempo do rastreio.
// `overrideDias` (opcional) força um número de dias decorridos — usado só no
// preview de teste (?dia=N), pra você ver a página em qualquer ponto da jornada.
function timeline(t, overrideDias) {
  const created = parseCreated(t);
  const dias = (overrideDias !== undefined && overrideDias !== null && overrideDias !== '' && !isNaN(overrideDias))
    ? Number(overrideDias)
    : (Date.now() - created.getTime()) / DIA_MS;

  let passadas = STAGES.filter((s) => s.dias <= dias);
  if (passadas.length === 0) passadas = [STAGES[0]];

  const eventos = passadas.map((s) => {
    const data = new Date(created.getTime() + s.dias * DIA_MS);
    return { status: s.status, description: render(s.desc, t), when: fmtData(data) };
  });

  const atual = eventos[eventos.length - 1];
  const entregue = passadas.some((s) => s.status === 'Entregue');
  const ultima = STAGES[STAGES.length - 1];
  const previsao = fmtDataCurta(new Date(created.getTime() + ultima.dias * DIA_MS));

  return {
    statusAtual: atual.status,
    eventos: eventos.reverse(), // mais recente no topo
    entregue,
    previsao,
  };
}

// Só o status atual (para listas no painel).
function statusAtual(t) {
  return timeline(t).statusAtual;
}

// Índice da etapa atual (0 = primeira). Usado pelos avisos automáticos.
function etapaAtualIndex(t, overrideDias) {
  const created = parseCreated(t);
  const dias = (overrideDias !== undefined && overrideDias !== null && overrideDias !== '' && !isNaN(overrideDias))
    ? Number(overrideDias)
    : (Date.now() - created.getTime()) / DIA_MS;
  let idx = 0;
  for (let i = 0; i < STAGES.length; i++) if (STAGES[i].dias <= dias) idx = i;
  return idx;
}

// Dados de uma etapa (status + descrição já com {destino} preenchido).
function etapa(t, i) {
  const s = STAGES[i] || STAGES[0];
  return { status: s.status, detalhe: render(s.desc, t) };
}

module.exports = { STAGES, timeline, statusAtual, destinoTexto, etapaAtualIndex, etapa };
