import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { HandlerEvent, HandlerContext } from '@netlify/functions';
import { createUploadHandler } from './netlify/functions/upload-foto-drive';

const readRequestBody = async (req: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf-8');
};

const createLocalSupabaseSyncPlugin = (env: Record<string, string>): Plugin => {
  const supabaseUrl = String(
    env.SUPABASE_ORCAMENTOS_URL ||
    env.SUPABASE_URL ||
    ''
  ).trim();
  const supabaseSecret = String(
    env.SUPABASE_ORCAMENTOS_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();
  const tableName = String(env.SUPABASE_ORCAMENTOS_TABLE || 'orcamentos_finalizados').trim();

  return {
    name: 'local-supabase-sync',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = req.url ? new URL(req.url, 'http://localhost') : null;
        const pathname = requestUrl?.pathname || '';

        if (pathname === '/upload_foto_drive') {
          try {
            const body = req.method === 'POST' ? await readRequestBody(req) : '';
            const result = await createUploadHandler(env)({
              httpMethod: req.method || 'GET', body, isBase64Encoded: false
            } as HandlerEvent, {} as HandlerContext);
            if (!result) throw new Error('O envio do arquivo nao retornou resposta.');
            res.statusCode = result.statusCode;
            for (const [key, value] of Object.entries(result.headers || {})) {
              if (value != null) res.setHeader(key, String(value));
            }
            res.end(result.body);
          } catch {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'Nao foi possivel enviar o arquivo.' }));
          }
          return;
        }

        // No deploy, esta rota e atendida pela Netlify Function. O Vite nao
        // interpreta os redirects do netlify.toml, entao a reproduzimos aqui
        // para que o catalogo tambem funcione com `npm run dev`.
        if (req.method === 'GET' && pathname === '/catalogo_qualidade') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');

          if (!supabaseUrl || !supabaseSecret) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Variaveis do Supabase nao configuradas no .env local.' }));
            return;
          }

          try {
            const normalizedSupabaseUrl = supabaseUrl
              .replace(/\/rest\/v1\/?$/i, '')
              .replace(/\/$/, '');
            const rows: unknown[] = [];
            const pageSize = 500;

            for (let offset = 0; ; offset += pageSize) {
              const supaUrl = new URL(`${normalizedSupabaseUrl}/rest/v1/catalogo_qualidade`);
              supaUrl.searchParams.set('select', 'id,linha,tipo,item,ativo');
              supaUrl.searchParams.set('ativo', 'eq.true');
              supaUrl.searchParams.set('order', 'id.asc');
              supaUrl.searchParams.set('limit', String(pageSize));
              supaUrl.searchParams.set('offset', String(offset));

              const response = await fetch(supaUrl.toString(), {
                headers: {
                  Accept: 'application/json',
                  apikey: supabaseSecret,
                  Authorization: `Bearer ${supabaseSecret}`
                }
              });
              if (!response.ok) {
                res.statusCode = 502;
                res.end(JSON.stringify({ error: 'Falha ao consultar o catalogo no Supabase.' }));
                return;
              }

              const page: unknown = await response.json();
              if (!Array.isArray(page)) {
                res.statusCode = 502;
                res.end(JSON.stringify({ error: 'Resposta invalida do catalogo.' }));
                return;
              }
              rows.push(...page);
              if (page.length < pageSize) break;
            }

            res.statusCode = 200;
            res.end(JSON.stringify(rows));
          } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({
              error: 'Falha ao consultar o catalogo no Vite local.',
              detail: error instanceof Error ? error.message : String(error)
            }));
          }
          return;
        }

        if (req.method === 'GET' && pathname === '/status_envios_supa') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');

          if (!supabaseUrl || !supabaseSecret) {
            res.statusCode = 500;
            res.end(JSON.stringify({
              error: 'Variaveis do Supabase nao configuradas no .env local.'
            }));
            return;
          }

          const cnpj = String(requestUrl?.searchParams.get('cnpj') || '').trim();
          if (!cnpj) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'cnpj e obrigatorio.' }));
            return;
          }

          try {
            const normalizedSupabaseUrl = supabaseUrl
              .replace(/\/rest\/v1\/?$/i, '')
              .replace(/\/$/, '');

            const supaUrl = new URL(`${normalizedSupabaseUrl}/rest/v1/${tableName}`);
            supaUrl.searchParams.set('select', 'id,oracle_item_id,protocolo,cod_gemco,cod_barras,serial,status,status_text,total_orcamento');
            supaUrl.searchParams.set('cnpj', `eq.${cnpj}`);
            supaUrl.searchParams.set('order', 'atualizado_em.desc');
            supaUrl.searchParams.set('limit', '500');

            const response = await fetch(supaUrl.toString(), {
              method: 'GET',
              headers: {
                Accept: 'application/json',
                apikey: supabaseSecret,
                Authorization: `Bearer ${supabaseSecret}`
              }
            });

            const text = await response.text();
            res.statusCode = response.status;
            res.end(text);
          } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({
              error: 'Falha ao consultar status no Vite local.',
              detail: error instanceof Error ? error.message : String(error)
            }));
          }
          return;
        }

        if (req.method === 'GET' && pathname === '/pagamentos_supa') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          if (!supabaseUrl || !supabaseSecret) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Variaveis do Supabase nao configuradas no .env local.' }));
            return;
          }
          const cnpj = String(requestUrl?.searchParams.get('cnpj') || '').replace(/\D/g, '');
          if (!cnpj) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'cnpj e obrigatorio.' }));
            return;
          }
          try {
            const base = supabaseUrl.replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
            const supaUrl = new URL(`${base}/rest/v1/${tableName}`);
            supaUrl.searchParams.set('select', 'oracle_item_id,protocolo,cod_gemco,descricao,serial,total_orcamento,status,status_text,pagamento_status,pagamento_referencia,valor_pagamento,nota_fiscal_numero,nota_fiscal_nome,nota_fiscal_drive_link,nota_fiscal_enviada_em,pagamento_solicitado_em,pagamento_validacao_status');
            supaUrl.searchParams.set('cnpj', `eq.${cnpj}`);
            supaUrl.searchParams.set('status', 'eq.10');
            supaUrl.searchParams.set('order', 'atualizado_em.desc');
            supaUrl.searchParams.set('limit', '500');
            const response = await fetch(supaUrl.toString(), { headers: { Accept: 'application/json', apikey: supabaseSecret, Authorization: `Bearer ${supabaseSecret}` } });
            res.statusCode = response.status;
            res.end(await response.text());
          } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Falha ao consultar pagamentos no Vite local.', detail: error instanceof Error ? error.message : String(error) }));
          }
          return;
        }

        if (req.method === 'POST' && pathname === '/pagamentos_supa/save') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          if (!supabaseUrl || !supabaseSecret) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Variaveis do Supabase nao configuradas no .env local.' }));
            return;
          }
          try {
            const payload = JSON.parse(await readRequestBody(req) || '{}');
            const itemId = Number(payload?.oracleItemId);
            const driveLink = String(payload?.notaFiscalDriveLink || '').trim();
            const fileName = String(payload?.notaFiscalNome || '').trim();
            const numeroNota = String(payload?.notaFiscalNumero || '').trim();
            const valorPagamento = Number(payload?.valorPagamento);
            if (!Number.isFinite(itemId) || itemId <= 0 || !driveLink || !fileName || !numeroNota || !Number.isFinite(valorPagamento) || valorPagamento < 0) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Dados da nota fiscal incompletos.' }));
              return;
            }
            const base = supabaseUrl.replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
            const supaUrl = new URL(`${base}/rest/v1/${tableName}`);
            supaUrl.searchParams.set('oracle_item_id', `eq.${itemId}`);
            const validaUrl = new URL(`${base}/rest/v1/${tableName}`);
            validaUrl.searchParams.set('select', 'total_orcamento');
            validaUrl.searchParams.set('oracle_item_id', `eq.${itemId}`);
            const valida = await fetch(validaUrl.toString(), { headers: { Accept: 'application/json', apikey: supabaseSecret, Authorization: `Bearer ${supabaseSecret}` } });
            const valoresOrcamento = await valida.json() as Array<{ total_orcamento?: number | string }>;
            const valorOrcamento = Number(valoresOrcamento[0]?.total_orcamento);
            if (!valoresOrcamento.length || !Number.isFinite(valorOrcamento) || Math.abs(valorPagamento - valorOrcamento) > 0.01) {
              res.statusCode = 422;
              res.end(JSON.stringify({ error: 'O valor informado nao confere com o valor final do orcamento.', valorOrcamento, valorInformado: valorPagamento }));
              return;
            }
            const response = await fetch(supaUrl.toString(), { method: 'PATCH', headers: { Accept: 'application/json', 'Content-Type': 'application/json', apikey: supabaseSecret, Authorization: `Bearer ${supabaseSecret}`, Prefer: 'return=representation' }, body: JSON.stringify({ pagamento_status: 'NOTA_ENVIADA', pagamento_referencia: String(payload?.pagamentoReferencia || '').trim(), nota_fiscal_nome: fileName, nota_fiscal_numero: numeroNota, nota_fiscal_drive_link: driveLink, nota_fiscal_enviada_em: new Date().toISOString(), pagamento_solicitado_em: new Date().toISOString(), valor_pagamento: valorPagamento, pagamento_validacao_status: 'VALIDADO' }) });
            res.statusCode = response.status;
            res.end(await response.text());
          } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Falha ao salvar pagamento no Vite local.', detail: error instanceof Error ? error.message : String(error) }));
          }
          return;
        }

        if (req.method === 'GET' && pathname === '/negociacoes_envios_supa') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');

          if (!supabaseUrl || !supabaseSecret) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Variaveis do Supabase nao configuradas no .env local.' }));
            return;
          }

          const cnpj = String(requestUrl?.searchParams.get('cnpj') || '').trim();
          if (!cnpj) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'cnpj e obrigatorio.' }));
            return;
          }

          try {
            const normalizedSupabaseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
            const supaUrl = new URL(`${normalizedSupabaseUrl}/rest/v1/orcamento_negociacoes`);
            supaUrl.searchParams.set('select', '*');
            supaUrl.searchParams.set('cnpj', `eq.${cnpj}`);
            supaUrl.searchParams.set('order', 'updated_at.desc');
            supaUrl.searchParams.set('limit', '200');

            const response = await fetch(supaUrl.toString(), {
              method: 'GET',
              headers: {
                Accept: 'application/json',
                apikey: supabaseSecret,
                Authorization: `Bearer ${supabaseSecret}`
              }
            });

            const text = await response.text();
            res.statusCode = response.status;
            res.end(text);
          } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({
              error: 'Falha ao consultar negociacoes no Vite local.',
              detail: error instanceof Error ? error.message : String(error)
            }));
          }
          return;
        }

        if (req.method === 'POST' && pathname === '/negociacoes_envios_supa/resposta') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');

          if (!supabaseUrl || !supabaseSecret) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Variaveis do Supabase nao configuradas no .env local.' }));
            return;
          }

          try {
            const rawBody = await readRequestBody(req);
            const payload = rawBody ? JSON.parse(rawBody) : {};
            const protocolo = String(payload?.protocolo || '').trim();
            const action = String(payload?.action || '').trim().toUpperCase();
            const valorContraproposta = Number(payload?.valorContraproposta ?? 0);
            const observacaoPosto = String(payload?.observacaoPosto || '').trim();
            const respondidoPor = String(payload?.respondidoPor || '').trim();

            if (!protocolo) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'protocolo e obrigatorio.' }));
              return;
            }

            const body =
              action === 'ACEITAR'
                ? {
                    status: 'ACEITA_POSTO',
                    acao_pendente_de: 'AT',
                    observacao_posto: observacaoPosto,
                    respondido_por: respondidoPor,
                    updated_at: new Date().toISOString()
                  }
                : action === 'RECUSAR'
                  ? {
                      status: 'RECUSADA_POSTO',
                      acao_pendente_de: 'AT',
                      observacao_posto: observacaoPosto,
                      respondido_por: respondidoPor,
                      updated_at: new Date().toISOString()
                    }
                  : {
                      status: 'CONTRAPROPOSTA_POSTO',
                      acao_pendente_de: 'AT',
                      valor_contraproposta_posto: valorContraproposta,
                      observacao_posto: observacaoPosto,
                      respondido_por: respondidoPor,
                      updated_at: new Date().toISOString()
                    };

            const normalizedSupabaseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
            const supaUrl = new URL(`${normalizedSupabaseUrl}/rest/v1/orcamento_negociacoes`);
            supaUrl.searchParams.set('protocolo', `eq.${protocolo}`);

            const response = await fetch(supaUrl.toString(), {
              method: 'PATCH',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                apikey: supabaseSecret,
                Authorization: `Bearer ${supabaseSecret}`,
                Prefer: 'return=representation'
              },
              body: JSON.stringify(body)
            });

            const text = await response.text();
            res.statusCode = response.status;
            res.end(text);
          } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({
              error: 'Falha ao responder negociacao no Vite local.',
              detail: error instanceof Error ? error.message : String(error)
            }));
          }
          return;
        }

        if (req.method !== 'POST' || pathname !== '/sync_orcamento_supabase') {
          next();
          return;
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8');

        if (!supabaseUrl || !supabaseSecret) {
          res.statusCode = 500;
          res.end(JSON.stringify({
            error: 'Variaveis do Supabase nao configuradas no .env local.'
          }));
          return;
        }

        try {
          const rawBody = await readRequestBody(req);
          const payload = rawBody ? JSON.parse(rawBody) : {};
          const itens = Array.isArray(payload?.itens) ? payload.itens : [];

          const records = itens
            .map((item: any) => {
              const oracleItemId = Number(item?.itemId ?? item?.id ?? payload?.itemId ?? payload?.id ?? 0);
              if (!Number.isFinite(oracleItemId) || oracleItemId <= 0) return null;

              return {
                oracle_item_id: oracleItemId,
                protocolo: String(payload?.protocolo ?? item?.protocolo ?? '').trim(),
                pa_usuario: String(payload?.paUsuario ?? '').trim(),
                cnpj: String(payload?.cnpj ?? '').trim(),
                razao_social: String(payload?.razaoSocial ?? '').trim(),
                unidade: String(payload?.unidade ?? '').trim(),
                email_retorno: String(payload?.emailRetorno ?? '').trim(),
                uuid: String(item?.uuid ?? '').trim(),
                cod_barras: String(item?.codBarras ?? '').trim(),
                ean: String(item?.ean ?? item?.codBarras ?? '').trim(),
                cod_gemco: String(item?.codGemco ?? '').trim(),
                descricao: String(item?.descricao ?? '').trim(),
                fornecedor: String(item?.fornecedor ?? '').trim(),
                linha: String(item?.linha ?? '').trim(),
                serial: String(item?.serial ?? '').trim(),
                defeito_encontrado: String(item?.defeitoEncontrado ?? '').trim(),
                foto_nome: String(item?.fotoNome ?? '').trim(),
                pecas_desc: String(item?.pecasDesc ?? '').trim(),
                val_pecas: Number(item?.valPecas ?? 0) || 0,
                acess_desc: String(item?.acessDesc ?? '').trim(),
                val_acess: Number(item?.valAcess ?? 0) || 0,
                val_mao_obra: Number(item?.valMaoObra ?? 0) || 0,
                val_emb: Number(item?.valEmb ?? 0) || 0,
                val_hig: Number(item?.valHig ?? 0) || 0,
                total_orcamento: Number(item?.totalOrcamento ?? 0) || 0,
                defeito_funcional: String(item?.defeitoFuncional ?? '').trim(),
                garantia: String(item?.garantia ?? '').trim(),
                tipo_orc: String(item?.tipoOrc ?? '').trim(),
                status: Number(item?.status ?? 0) || 0
              };
            })
            .filter(Boolean);

          if (records.length === 0) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Payload sem itens validos para sincronizar.' }));
            return;
          }

          const normalizedSupabaseUrl = supabaseUrl
            .replace(/\/rest\/v1\/?$/i, '')
            .replace(/\/$/, '');

          const response = await fetch(
            `${normalizedSupabaseUrl}/rest/v1/${tableName}?on_conflict=oracle_item_id`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: supabaseSecret,
                Authorization: `Bearer ${supabaseSecret}`,
                Prefer: 'resolution=merge-duplicates,return=representation'
              },
              body: JSON.stringify(records)
            }
          );

          const text = await response.text();
          res.statusCode = response.status;
          res.end(text);
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({
            error: 'Falha ao sincronizar orcamento no Vite local.',
            detail: error instanceof Error ? error.message : String(error)
          }));
        }
      });
    }
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const ORDS_BASE_URL =
    env.VITE_ORDS_BASE_URL ||
    'https://g6ddac1ab68a179-database01.adb.sa-saopaulo-1.oraclecloudapps.com/ords/admin/apis_gestao_at_1';

  return {
    plugins: [react(), createLocalSupabaseSyncPlugin(env)],
    server: {
      port: 5173,
      open: false,
      proxy: {
        '/api-check-user': {
          target: ORDS_BASE_URL,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api-check-user/, '/check_user')
        },
        '/api-bet-user-inf': {
          target: ORDS_BASE_URL,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api-bet-user-inf/, '/bet_user_inf')
        },
        '/api-get-user-inf': {
          target: ORDS_BASE_URL,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api-get-user-inf/, '/get_user_inf')
        },
        '/api-get-produto-cadastro': {
          target: ORDS_BASE_URL,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api-get-produto-cadastro/, '/get_produto_cadastro')
        },
        '/get_user_inf': {
          target: ORDS_BASE_URL,
          changeOrigin: true,
          secure: true
        },
        '/get_produto_cadastro': {
          target: ORDS_BASE_URL,
          changeOrigin: true,
          secure: true
        },
        '/consulta_cnpj': {
          target: 'https://minhareceita.org',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => {
            const url = new URL(`http://local${path}`);
            const cnpj = (url.searchParams.get('cnpj') || '').replace(/\D/g, '');
            return `/${cnpj}`;
          }
        },
        '/salvar-orcamento': {
          target: ORDS_BASE_URL,
          changeOrigin: true,
          secure: true
        },
        '/update_valores': {
          target: ORDS_BASE_URL,
          changeOrigin: true,
          secure: true
        },
        '/get_orcamentos_analise': {
          target: ORDS_BASE_URL,
          changeOrigin: true,
          secure: true
        },
        '/register_posto': {
          target: ORDS_BASE_URL,
          changeOrigin: true,
          secure: true
        },
        '/post_orcamento_final': {
          target: ORDS_BASE_URL,
          changeOrigin: true,
          secure: true
        },
        '/get_envios': {
          target: ORDS_BASE_URL,
          changeOrigin: true,
          secure: true
        }
      }
    }
  };
});
