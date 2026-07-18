// Substitui as variáveis {nome} {codigo} {status} {link} {loja} no texto.
function renderTemplate(texto, vars) {
  if (!texto) return '';
  return texto.replace(/\{(\w+)\}/g, (match, chave) => {
    return vars[chave] !== undefined && vars[chave] !== null ? String(vars[chave]) : match;
  });
}

module.exports = { renderTemplate };
