import { useId, useMemo, useState } from 'react';
import { normalizarNome, type CatalogoPadrao, type ItemPadrao } from '../lib/pecaPadrao';
import type { GrupoSemPadrao } from '../lib/envioOrcamento';

type Props = {
  grupos: GrupoSemPadrao[];
  catalogo: CatalogoPadrao;
  /** Rotulo da posicao: "linha" na planilha, "item" no lancamento manual. */
  rotuloPosicao?: string;
  desabilitado?: boolean;
  onEscolher: (grupo: GrupoSemPadrao, padrao: ItemPadrao) => Promise<void>;
  onSolicitar: (grupo: GrupoSemPadrao, nomeSugerido: string) => Promise<void>;
};

const estilo = `
.pp-card { border: 1px solid #f3c96b; background: #fffbeb; border-radius: 10px; padding: 14px; display: grid; gap: 10px; margin-bottom: 14px; }
.pp-card h4 { margin: 0; display: flex; align-items: center; gap: 6px; color: #7c4a03; font-size: 0.95rem; }
.pp-card > p { margin: 0; font-size: 0.82rem; color: #7c4a03; }
.pp-lista { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.pp-item { background: #fff; border: 1px solid #f1e3bf; border-radius: 8px; padding: 10px 12px; display: grid; gap: 8px; }
.pp-topo { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; }
.pp-original { font-weight: 700; color: #0f2356; }
.pp-meta { font-size: 0.78rem; color: #64748b; }
.pp-acoes { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.pp-acoes input { min-width: 220px; flex: 1; padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.85rem; }
.pp-acoes button { padding: 7px 12px; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; font-weight: 600; font-size: 0.82rem; cursor: pointer; color: #0f2356; white-space: nowrap; }
.pp-acoes button.pp-principal { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
.pp-acoes button:disabled { opacity: 0.5; cursor: not-allowed; }
.pp-erro { font-size: 0.8rem; color: #8a1c24; }
body.dark-mode .pp-card { background: #2a2212; border-color: #6b5420; }
body.dark-mode .pp-item { background: #1f2937; border-color: #374151; }
body.dark-mode .pp-original { color: #e2e8f0; }
`;

/** Pecas sem padrao: o posto escolhe um padrao existente ou pede um novo. Sem isso o envio fica travado. */
const PadronizacaoPecas = ({ grupos, catalogo, rotuloPosicao = 'linha', desabilitado = false, onEscolher, onSolicitar }: Props) => {
  const listaId = useId();
  const [texto, setTexto] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});
  const pecas = useMemo(() => catalogo.lista.filter((p) => p.tipo === 'PECA'), [catalogo]);

  if (!grupos.length) return null;

  // Padroes da linha do produto primeiro; se a linha nao tiver nenhum, mostra todos.
  const opcoes = (grupo: GrupoSemPadrao) => {
    const linhas = grupo.linhasProduto.map(normalizarNome);
    const daLinha = linhas.length ? pecas.filter((p) => linhas.some((l) => catalogo.linhasPorCodigo.get(p.codigo)?.has(l))) : [];
    return Array.from(new Set((daLinha.length ? daLinha : pecas).map((p) => p.nomeCanonico))).sort();
  };
  const executar = async (grupo: GrupoSemPadrao, acao: () => Promise<void>) => {
    setSalvando(grupo.chave);
    setErros((e) => ({ ...e, [grupo.chave]: '' }));
    try { await acao(); } catch (error) {
      setErros((e) => ({ ...e, [grupo.chave]: error instanceof Error ? error.message : 'Não foi possível salvar. Tente de novo.' }));
    } finally { setSalvando(''); }
  };
  const escolher = (grupo: GrupoSemPadrao, nome: string) => {
    const padrao = catalogo.porNome.get(normalizarNome(nome));
    if (!padrao) { setErros((e) => ({ ...e, [grupo.chave]: `"${nome}" não é um padrão do catálogo. Escolha da lista.` })); return; }
    void executar(grupo, () => onEscolher(grupo, padrao));
  };

  return (
    <section className="pp-card" aria-label="Padronização das peças">
      <style>{estilo}</style>
      <h4><i className="material-icons" aria-hidden="true">rule</i>Padronização das peças: {grupos.length} descrição(ões) sem padrão</h4>
      <p>O lote só é enviado com a nomenclatura oficial. Para cada descrição, escolha o padrão correspondente ou solicite um novo. A escolha vale para todos os produtos do lote e fica registrada para os próximos recebimentos.</p>
      <ul className="pp-lista">
        {grupos.map((grupo) => {
          const ocupado = desabilitado || salvando === grupo.chave;
          const valor = texto[grupo.chave] ?? '';
          return (
            <li key={grupo.chave} className="pp-item">
              <div className="pp-topo">
                <span className="pp-original">“{grupo.original}”</span>
                <span className="pp-meta">
                  {rotuloPosicao}{grupo.linhasPlanilha.length === 1 ? '' : 's'} {grupo.linhasPlanilha.join(', ')}
                  {grupo.linhasProduto.length > 0 && ` · linha do produto: ${grupo.linhasProduto.join(', ')}`}
                </span>
              </div>
              <div className="pp-acoes">
                {grupo.sugestao && (
                  <button type="button" className="pp-principal" disabled={ocupado} onClick={() => escolher(grupo, grupo.sugestao || '')}>
                    Usar “{grupo.sugestao}”
                  </button>
                )}
                <input list={`${listaId}-${grupo.chave}`} value={valor} disabled={ocupado} placeholder="Buscar padrão do catálogo"
                  aria-label={`Padrão para ${grupo.original}`} onChange={(e) => setTexto((t) => ({ ...t, [grupo.chave]: e.target.value }))} />
                <datalist id={`${listaId}-${grupo.chave}`}>{opcoes(grupo).map((nome) => <option key={nome} value={nome} />)}</datalist>
                <button type="button" disabled={ocupado || !valor.trim()} onClick={() => escolher(grupo, valor)}>Usar este padrão</button>
                <button type="button" disabled={ocupado} title="Pede ao AT o cadastro de um padrão novo; a peça vai com a descrição original até a aprovação."
                  onClick={() => void executar(grupo, () => onSolicitar(grupo, valor.trim() && !catalogo.porNome.has(normalizarNome(valor)) ? valor.trim() : grupo.original))}>
                  {salvando === grupo.chave ? 'Salvando…' : 'Solicitar novo padrão'}
                </button>
              </div>
              {erros[grupo.chave] && <div className="pp-erro" role="alert">{erros[grupo.chave]}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default PadronizacaoPecas;
