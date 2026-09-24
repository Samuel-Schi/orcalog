import type { Handler } from '@netlify/functions';
import { fetchWithTimeout, handleFunctionError, jsonResponse, methodNotAllowed, proxyResponse, sanitizeQueryParams } from './_shared';

const DEFAULT_URL = 'https://g6ddac1ab68a179-database01.adb.sa-saopaulo-1.oraclecloudapps.com/ords/admin/apis_gestao_at_1/GET_COLETA_EAN_MANUAL';

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') return methodNotAllowed(['GET']);

    const params = sanitizeQueryParams(event.queryStringParameters);
    const codigoBarras = String(params.get('codigo_barra') || '').replace(/\D/g, '');
    if (codigoBarras.length < 8) return jsonResponse(400, { error: 'Informe um código de barras válido.' });

    const url = String(process.env.ORACLE_GET_PRODUTO_CODIGO_BARRAS_URL || DEFAULT_URL).trim();
    const target = new URL(url);
    target.searchParams.set('ean', codigoBarras);
    const response = await fetchWithTimeout(target.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    return proxyResponse(response);
  } catch (error) {
    return handleFunctionError(error);
  }
};
