type RomaneioPrintItem = {
  protocolo: string;
  cnpj?: string;
  razaoSocial?: string;
  unidade?: string;
  emailRetorno?: string;
  codBarras: string;
  codGemco: string;
  descricao: string;
  fornecedor: string;
  linha: string;
  serial: string;
  criadoEm?: string;
  totalOrcamento?: number;
  valPecas?: number;
  valAcess?: number;
  valMaoObra?: number;
  valEmb?: number;
  valHig?: number;
  defeitoEncontrado?: string;
  pecasDesc?: string;
  acessDesc?: string;
};

const formatMoney = (value?: number) =>
  value != null ? value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-';

const escapeHtml = (value?: string) =>
  String(value || '-')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const splitDescricao = (value?: string, prefix?: string) =>
  String(value || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index) => !(prefix && index === 0 && part.toLowerCase() === prefix.toLowerCase()));

const formatLista = (value?: string, prefix?: string) => {
  const items = splitDescricao(value, prefix);
  return items.length > 0 ? items.join(', ') : '-';
};

const formatComposicao = (item: RomaneioPrintItem) => {
  const partes: string[] = [];
  const pecas = formatLista(item.pecasDesc, 'pe');
  const acessorios = formatLista(item.acessDesc, 'ac');

  if (pecas !== '-') partes.push(`Pecas: ${pecas}`);
  if (acessorios !== '-') partes.push(`Acessorios: ${acessorios}`);
  if (Number(item.valMaoObra || 0) > 0) partes.push(`Mao de obra: ${formatMoney(item.valMaoObra)}`);
  if (Number(item.valEmb || 0) > 0) partes.push(`Embalagem: ${formatMoney(item.valEmb)}`);
  if (Number(item.valHig || 0) > 0) partes.push(`Higienizacao: ${formatMoney(item.valHig)}`);

  return partes.length > 0 ? partes.join(' | ') : '-';
};

export const buildRomaneioPrintDocument = (input: {
  protocolo: string;
  criadoEm?: string;
  totalLote: number;
  items: RomaneioPrintItem[];
}) => {
  const first = input.items[0];
  const rows = input.items
    .map((item, index) => {
      return `
        <tr>
          <td>
            <strong>${String(index + 1).padStart(2, '0')} - ${escapeHtml(item.descricao)}</strong>
            <div>${escapeHtml(item.fornecedor)}</div>
            <div>Linha: ${escapeHtml(item.linha)}</div>
          </td>
          <td>
            <div><strong>Cod. Barras:</strong> ${escapeHtml(item.codBarras)}</div>
            <div><strong>GEMCO:</strong> ${escapeHtml(item.codGemco)}</div>
            <div><strong>Serial:</strong> ${escapeHtml(item.serial)}</div>
          </td>
          <td>${escapeHtml(item.defeitoEncontrado || '-')}</td>
          <td>${escapeHtml(formatComposicao(item))}</td>
          <td class="col-total">${escapeHtml(formatMoney(item.totalOrcamento))}</td>
        </tr>
      `;
    })
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Romaneio ${escapeHtml(input.protocolo)}</title>
    <style>
      @page { size: A4 portrait; margin: 8mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #111827;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 11px;
        background: #fff;
      }
      .sheet {
        width: 100%;
        border: 1px solid #374151;
        padding: 18px 18px 16px;
      }
      .top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        border-bottom: 1px solid #374151;
        padding-bottom: 10px;
      }
      .title {
        font-size: 28px;
        letter-spacing: 0.04em;
      }
      .subtitle {
        margin-top: 4px;
        font-size: 11px;
        color: #4b5563;
      }
      .doc-number {
        text-align: right;
      }
      .doc-number .label {
        font-size: 12px;
        text-transform: uppercase;
      }
      .doc-number .value {
        font-size: 26px;
      }
      .box {
        border: 1px solid #64748b;
        margin-top: 12px;
      }
      .box-title {
        padding: 6px 8px;
        border-bottom: 1px solid #94a3b8;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .box-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 16px;
        padding: 10px 8px;
      }
      .box-grid div {
        display: grid;
        gap: 3px;
      }
      .field-label {
        color: #4b5563;
        text-transform: uppercase;
        font-size: 10px;
        letter-spacing: 0.05em;
      }
      .summary-strip {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        border: 1px solid #64748b;
        margin-top: 12px;
      }
      .summary-strip div {
        padding: 8px;
        border-right: 1px solid #94a3b8;
        display: grid;
        gap: 3px;
      }
      .summary-strip div:last-child { border-right: none; }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        margin-top: 12px;
      }
      th, td {
        border: 1px solid #94a3b8;
        padding: 7px 8px;
        vertical-align: top;
        line-height: 1.35;
        word-break: break-word;
      }
      th {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-weight: 700;
      }
      td strong { color: #111827; }
      .col-total {
        width: 90px;
        text-align: right;
        font-weight: 700;
      }
      tfoot td {
        font-weight: 700;
      }
      .obs {
        margin-top: 12px;
      }
      .obs-box {
        border: 1px solid #94a3b8;
        height: 92px;
        margin-top: 6px;
      }
      .signatures {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
        margin-top: 18px;
        padding-top: 10px;
        border-top: 1px dashed #94a3b8;
      }
      .signature {
        min-height: 54px;
        border-top: 1px solid #94a3b8;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        padding-top: 8px;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div class="top">
        <div>
          <div class="title">ROMANEIO</div>
          <div class="subtitle">Controle de itens em devolucao do lote</div>
        </div>
        <div class="doc-number">
          <div class="label">Nº</div>
          <div class="value">${escapeHtml(input.protocolo)}</div>
        </div>
      </div>

      <div class="box">
        <div class="box-title">Destinatario</div>
        <div class="box-grid">
          <div><span class="field-label">Razao social</span><strong>${escapeHtml(first?.razaoSocial || 'Magazine Luiza S.A')}</strong></div>
          <div><span class="field-label">CNPJ</span><strong>${escapeHtml(first?.cnpj)}</strong></div>
          <div><span class="field-label">Unidade</span><strong>${escapeHtml(first?.unidade)}</strong></div>
          <div><span class="field-label">E-mail retorno</span><strong>${escapeHtml(first?.emailRetorno)}</strong></div>
        </div>
      </div>

      <div class="summary-strip">
        <div><span class="field-label">Emissao</span><strong>${escapeHtml(input.criadoEm)}</strong></div>
        <div><span class="field-label">Quantidade de itens</span><strong>${escapeHtml(String(input.items.length))}</strong></div>
        <div><span class="field-label">Total do lote</span><strong>${escapeHtml(formatMoney(input.totalLote))}</strong></div>
        <div><span class="field-label">Documento</span><strong>Devolucao</strong></div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Identificacao</th>
            <th>Defeito / Motivo</th>
            <th>Composicao</th>
            <th>Valor</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="4">Total geral do lote</td>
            <td class="col-total">${escapeHtml(formatMoney(input.totalLote))}</td>
          </tr>
        </tfoot>
      </table>

      <div class="obs">
        <div class="box-title" style="border: 1px solid #94a3b8; border-bottom: none;">Observacao</div>
        <div class="obs-box"></div>
      </div>

      <div class="signatures">
        <div class="signature">Recebemos da empresa</div>
        <div class="signature">Data do recebimento</div>
        <div class="signature">Assinatura do recebedor</div>
        <div class="signature">Nº do romaneio</div>
      </div>
    </div>
  </body>
</html>`;
};
