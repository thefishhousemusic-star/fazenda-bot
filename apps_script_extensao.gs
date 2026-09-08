// ══════════════════════════════════════════════════════════════════════════════
// ADICIONAR ao Apps Script existente (Fazenda Capão Grande)
// Cole esses cases dentro do switch(action) do seu doGet(e)
// ══════════════════════════════════════════════════════════════════════════════

// ── NOVO: Registrar gasto pessoal ─────────────────────────────────────────────
case 'registrar_gasto_pessoal': {
  var pessoalId = PropertiesService.getScriptProperties().getProperty('PESSOAL_SHEET_ID');
  if (!pessoalId) return resp({ ok: false, error: 'PESSOAL_SHEET_ID nao configurado nas propriedades do script' });

  var ss = SpreadsheetApp.openById(pessoalId);
  var sheet = ss.getSheetByName('Gastos') || ss.getSheets()[0];

  // Cria cabeçalho se a aba estiver vazia
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Data', 'Descrição', 'Valor', 'Categoria', 'Observações']);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
  }

  sheet.appendRow([
    data.data || Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy'),
    data.descricao || '',
    parseFloat(data.valor) || 0,
    data.categoria || 'Geral',
    data.observacoes || ''
  ]);

  return resp({ ok: true });
}

// ── NOVO: Resumo gastos pessoais do mês ───────────────────────────────────────
case 'resumo_pessoal': {
  var pessoalId = PropertiesService.getScriptProperties().getProperty('PESSOAL_SHEET_ID');
  if (!pessoalId) return resp({ ok: false, error: 'PESSOAL_SHEET_ID nao configurado' });

  var ss = SpreadsheetApp.openById(pessoalId);
  var sheet = ss.getSheetByName('Gastos') || ss.getSheets()[0];
  var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues() : [];

  var mes = parseInt(data.mes) || (new Date().getMonth() + 1);
  var ano = parseInt(data.ano) || new Date().getFullYear();

  var filtradas = rows.filter(function(row) {
    if (!row[0]) return false;
    var parts = String(row[0]).split('/');
    return parts.length === 3 && parseInt(parts[1]) === mes && parseInt(parts[2]) === ano;
  });

  var total = filtradas.reduce(function(sum, row) { return sum + (parseFloat(row[2]) || 0); }, 0);
  return resp({ ok: true, total: total, quantidade: filtradas.length });
}

// ── NOVO: Resumo custos fazenda do mês ────────────────────────────────────────
case 'resumo_custos_fazenda': {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Tenta encontrar a aba de custos pelo nome
  var sheet = ss.getSheetByName('Custos') || ss.getSheetByName('custos') || ss.getSheetByName('CUSTOS');
  if (!sheet) return resp({ ok: false, error: 'Aba Custos nao encontrada' });

  var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues() : [];

  var mes = parseInt(data.mes) || (new Date().getMonth() + 1);
  var ano = parseInt(data.ano) || new Date().getFullYear();

  var filtradas = rows.filter(function(row) {
    if (!row[0]) return false;
    var parts = String(row[0]).split('/');
    return parts.length === 3 && parseInt(parts[1]) === mes && parseInt(parts[2]) === ano;
  });

  // Coluna D (índice 3) = valor
  var total = filtradas.reduce(function(sum, row) { return sum + (parseFloat(row[3]) || 0); }, 0);
  return resp({ ok: true, total: total, quantidade: filtradas.length });
}

// ══════════════════════════════════════════════════════════════════════════════
// DEPOIS de adicionar os cases acima, faça o seguinte:
//
// 1. No editor do Apps Script, clique em:
//    Projeto → Propriedades do script → Propriedades do script
//    Adicione: PESSOAL_SHEET_ID = <ID da sua planilha pessoal>
//    (o ID está na URL da planilha: docs.google.com/spreadsheets/d/<ID>/edit)
//
// 2. Reimplante o script como Web App (Execute as: Me, Who has access: Anyone)
//    e copie a nova URL se mudou
// ══════════════════════════════════════════════════════════════════════════════
