import QRCode from 'qrcode';

// QR de cada item do romaneio, lido no Recebimento PA do RMS (magalog-system,
// RecebimentoQualidade/recebimentoPaApi.ts -> lerQrRomaneio). Com VITE_RMS_URL o QR é um link:
// a câmera do celular abre o Recebimento PA já com o item. Sem ela, vai o texto RAVENAS|protocolo|serial,
// que só o botão "Ler QR do romaneio" da tela entende.
const RMS_URL = String(import.meta.env.VITE_RMS_URL || '').trim().replace(/\/$/, '');

export const textoQrRomaneio = (protocolo: string, serial: string, rmsUrl = RMS_URL) => {
  if (!rmsUrl) return `RAVENAS|${protocolo}|${serial}`;
  const params = new URLSearchParams({ protocolo, serial });
  return `${rmsUrl}/recebimento-qualidade/pa?${params.toString()}`;
};

/** SVG do QR (string pronta para o HTML de impressão); '' quando o item não tem protocolo ou serial. */
export const gerarQrRomaneioSvg = async (protocolo: string, serial: string) => {
  if (!protocolo.trim() || !serial.trim()) return '';
  return QRCode.toString(textoQrRomaneio(protocolo.trim(), serial.trim()), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
};
