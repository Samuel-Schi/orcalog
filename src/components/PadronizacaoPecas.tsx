import { useState } from 'react';
import type { GrupoPadronizado, GrupoSemPadrao } from '../lib/envioOrcamento';

type Props = {
  /** Pecas trocadas automaticamente pelo padrao parecido do catalogo. */
  padronizadas: GrupoPadronizado[];
  /** Pecas sem nada parecido: vao com o nome original e geram pedido de padrao novo no envio. */
  semPadrao: GrupoSemPadrao[];
  /** Rotulo da posicao: "linha" na planilha, "item" no lancamento manual. */
  rotuloPosicao?: string;
  desabilitado?: boolean;
  onAlternar: (chave: string, desfazer: boolean) => void;
};

const VISIVEIS = 5;

const estilo = `
.pp-card { border: 1px solid #dbe4f0; background: #fff; border-radius: 12px; margin-bottom: 14px; overflow: hidden; }
.pp-cab { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 14px; border: 0; background: #f8fafc; font: inherit; text-align: left; cursor: pointer; }
.pp-cab-icone { width: 34px; height: 34px; flex: none; border-radius: 9px; background: #e8f5ec; color: #1e7b3a; display: grid; place-items: center; }
.pp-cab-icone .material-icons { font-size: 20px; }
.pp-cab-texto { flex: 1; min-width: 0; }
.pp-cab-texto strong { display: block; font-size: 0.9rem; color: #0f2356; }
.pp-cab-texto span { font-size: 0.8rem; color: #64748b; }
.pp-cab-seta { color: #64748b; transition: transform .15s; }
.pp-card.aberto .pp-cab-seta { transform: rotate(180deg); }
.pp-corpo { padding: 4px 14px 12px; display: grid; gap: 12px; }
.pp-secao h5 { margin: 8px 0 6px; font-size: 0.76rem; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; color: #64748b; }
.pp-lista { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.pp-linha { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid #eef2f7; border-radius: 9px; font-size: 0.84rem; }
.pp-nomes { flex: 1; min-width: 200px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pp-de { color: #64748b; text-decoration: line-through; text-decoration-color: #cbd5e1; }
.pp-de.mantido { text-decoration: none; color: #0f2356; font-weight: 600; }
.pp-seta { font-size: 16px; color: #94a3b8; }
.pp-para { font-weight: 700; color: #0f2356; }
.pp-pos { font-size: 0.74rem; color: #94a3b8; white-space: nowrap; }
.pp-tag { font-size: 0.72rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: #fff7e6; color: #8a5a00; white-space: nowrap; }
.pp-acao { padding: 4px 10px; border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; font: inherit; font-size: 0.78rem; font-weight: 600; color: #0f2356; cursor: pointer; white-space: nowrap; }
.pp-acao:hover:not(:disabled) { border-color: #1d4ed8; color: #1d4ed8; }
.pp-acao:disabled { opacity: .5; cursor: not-allowed; }
.pp-mais { justify-self: start; padding: 0; border: 0; background: none; font: inherit; font-size: 0.8rem; font-weight: 600; color: #1d4ed8; cursor: pointer; }
body.dark-mode .pp-card { background: #1f2937; border-color: #374151; }
body.dark-mode .pp-cab { background: #111827; }
body.dark-mode .pp-cab-texto strong, body.dark-mode .pp-para, body.dark-mode .pp-de.mantido { color: #e2e8f0; }
body.dark-mode .pp-linha { border-color: #374151; }
body.dark-mode .pp-acao { background: #111827; color: #e2e8f0; border-color: #475569; }
`;

const posicoes = (rotulo: string, linhas: number[]) =>
  `${rotulo}${linhas.length === 1 ? '' : 's'} ${linhas.slice(0, 6).join(', ')}${linhas.length > 6 ? '…' : ''}`;

/**
 * Resumo da padronizacao das pecas do lote. Nao trava o envio: o que e parecido ja foi trocado (pode desfazer)
 * e o que e desconhecido vai com o nome original (o pedido de padrao novo e registrado no envio).
 */
const PadronizacaoPecas = ({ padronizadas, semPadrao, rotuloPosicao = 'linha', desabilitado = false, onAlternar }: Props) => {
  const [aberto, setAberto] = useState(false);
  const [todasTrocadas, setTodasTrocadas] = useState(false);
  const [todasSemPadrao, setTodasSemPadrao] = useState(false);
  if (!padronizadas.length && !semPadrao.length) return null;

  const trocadas = padronizadas.filter((g) => !g.desfeita).length;
  const resumo = [
    trocadas && `${trocadas} peça${trocadas === 1 ? '' : 's'} padronizada${trocadas === 1 ? '' : 's'} automaticamente`,
    semPadrao.length && `${semPadrao.length} sem padrão (vai${semPadrao.length === 1 ? '' : 'o'} com o nome original)`
  ].filter(Boolean).join(' · ');
  const listaTrocadas = todasTrocadas ? padronizadas : padronizadas.slice(0, VISIVEIS);
  const listaSemPadrao = todasSemPadrao ? semPadrao : semPadrao.slice(0, VISIVEIS);

  return (
    <section className={`pp-card${aberto ? ' aberto' : ''}`} aria-label="Padronização das peças">
      <style>{estilo}</style>
      <button type="button" className="pp-cab" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <span className="pp-cab-icone" aria-hidden="true"><i className="material-icons">auto_fix_high</i></span>
        <span className="pp-cab-texto">
          <strong>Padronização das peças</strong>
          <span>{resumo || 'Todas as trocas foram desfeitas'}. {aberto ? 'Clique para recolher.' : 'Clique para conferir.'}</span>
        </span>
        <i className="material-icons pp-cab-seta" aria-hidden="true">expand_more</i>
      </button>

      {aberto && (
        <div className="pp-corpo">
          {padronizadas.length > 0 && (
            <div className="pp-secao">
              <h5>Trocadas pelo padrão do catálogo</h5>
              <ul className="pp-lista">
                {listaTrocadas.map((g) => (
                  <li key={g.chave} className="pp-linha">
                    <span className="pp-nomes">
                      {g.desfeita ? (
                        <><span className="pp-de mantido">{g.original}</span><span className="pp-tag">nome original mantido</span></>
                      ) : (
                        <><span className="pp-de">{g.original}</span><i className="material-icons pp-seta" aria-label="trocada por">arrow_forward</i><span className="pp-para">{g.canonico}</span></>
                      )}
                    </span>
                    <span className="pp-pos">{posicoes(rotuloPosicao, g.linhasPlanilha)}</span>
                    <button type="button" className="pp-acao" disabled={desabilitado} onClick={() => onAlternar(g.chave, !g.desfeita)}
                      aria-label={g.desfeita ? `Trocar "${g.original}" por "${g.canonico}" de novo` : `Desfazer a troca de "${g.original}"`}>
                      {g.desfeita ? 'Refazer' : 'Desfazer'}
                    </button>
                  </li>
                ))}
              </ul>
              {padronizadas.length > VISIVEIS && (
                <button type="button" className="pp-mais" onClick={() => setTodasTrocadas((t) => !t)}>
                  {todasTrocadas ? 'Mostrar menos' : `Ver todas (${padronizadas.length})`}
                </button>
              )}
            </div>
          )}

          {semPadrao.length > 0 && (
            <div className="pp-secao">
              <h5>Sem padrão no catálogo</h5>
              <ul className="pp-lista">
                {listaSemPadrao.map((g) => (
                  <li key={g.chave} className="pp-linha">
                    <span className="pp-nomes"><span className="pp-de mantido">{g.original}</span><span className="pp-tag">pedido de padrão novo no envio</span></span>
                    <span className="pp-pos">{posicoes(rotuloPosicao, g.linhasPlanilha)}</span>
                  </li>
                ))}
              </ul>
              {semPadrao.length > VISIVEIS && (
                <button type="button" className="pp-mais" onClick={() => setTodasSemPadrao((t) => !t)}>
                  {todasSemPadrao ? 'Mostrar menos' : `Ver todas (${semPadrao.length})`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default PadronizacaoPecas;
