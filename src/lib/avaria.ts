// Regra unica de "este defeito exige foto": dano fisico/estetico precisa de evidencia, o resto e opcional.
// O catalogo (catalogo_qualidade, tipo DEFEITO) nao usa a palavra AVARIA: os esteticos sao
// QUEBRADO, TRINCADO, AMASSADO e ARRANHADO / RISCADO. No texto livre (Excel / Novo Orcamento)
// o posto pode escrever "avaria", "avaria estetica", "riscado", "amassada"... tudo cai aqui.
const TERMOS_ESTETICOS = /AVARIA|ESTETIC|QUEBRAD|TRINCAD|AMASSAD|ARRANHAD|RISCAD/;

const semAcento = (valor: string) => valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** true quando o defeito (ou algum dos defeitos) indica avaria estetica e portanto exige foto. */
export const exigeFotoAvaria = (defeito: string | string[] | null | undefined) =>
  (Array.isArray(defeito) ? defeito : [defeito ?? '']).some((d) => TERMOS_ESTETICOS.test(semAcento(d)));
