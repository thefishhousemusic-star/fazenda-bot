import baileysDefault, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
} from '@whiskeysockets/baileys'

const makeWASocket = baileysDefault.default || baileysDefault
import { Boom } from '@hapi/boom'
import express from 'express'
import QRCode from 'qrcode'
import pino from 'pino'
import { mkdirSync, existsSync } from 'fs'

// Evita crash por erros não tratados do Baileys
process.on('uncaughtException', err => console.error('uncaughtException:', err.message))
process.on('unhandledRejection', err => console.error('unhandledRejection:', err?.message || err))

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT            = process.env.PORT             || 3000
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL
const APPS_SCRIPT_KEY = process.env.APPS_SCRIPT_KEY  || 'fazenda2026'
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY
const AUTH_DIR        = '/tmp/baileys_auth'

if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true })

// ─── Gemini ───────────────────────────────────────────────────────────────────
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`

async function geminiGenerate(prompt) {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error?.message || res.status)
  return json.candidates[0].content.parts[0].text
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function callScript(action, data = {}) {
  try {
    const params = new URLSearchParams({
      api_key: APPS_SCRIPT_KEY,
      action,
      data: JSON.stringify(data),
      t: Date.now(),
    })
    const res = await fetch(`${APPS_SCRIPT_URL}?${params}`, { redirect: 'follow' })
    const json = await res.json()
    console.log(`📋 Script(${action}):`, JSON.stringify(json).substring(0, 120))
    return json
  } catch (e) {
    console.error(`❌ Script(${action}) erro:`, e.message)
    return { ok: false, error: e.message }
  }
}

const fmtR = v =>
  `R$ ${parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const hoje = () => new Date().toLocaleDateString('pt-BR')

// ─── AI: classifica a mensagem ────────────────────────────────────────────────
async function classificar(texto) {
  const prompt = `Você é assistente de registro financeiro de um produtor rural.
Analise a mensagem e responda APENAS com JSON válido, sem markdown, sem explicações.

Data de hoje: ${hoje()}

Ações disponíveis:
- registrar_gasto_pessoal: gastos pessoais (mercado, restaurante, farmácia, roupa, gasolina pessoal, etc)
- registrar_custo_fazenda: custos da fazenda (diesel, manutenção, ferramentas, ração, insumos, etc)
- registrar_carga: carga de carvão — sempre precisa de peso em kg e metros
- registrar_pagamento: pagamento a funcionário da fazenda (Bandinha, Nilton, Paulinho, etc)
- consultar_resumo: perguntar quanto gastou no mês
- nao_entendido: qualquer outra coisa

Formato:
{"acao":"<acao>","dados":{...}}

Campos por ação:
- registrar_gasto_pessoal: {"descricao":"","valor":0,"categoria":"Alimentação|Transporte|Saúde|Casa|Lazer|Vestuário|Outros","data":"${hoje()}"}
- registrar_custo_fazenda: {"descricao":"","valor":0,"categoria":"Combustível|Manutenção|Insumos|Ferramentas|Salários|Outros","data":"${hoje()}"}
- registrar_carga: {"peso_kg":0,"metragem_m":0,"valor_carga":null,"data":"${hoje()}"}
- registrar_pagamento: {"funcionario":"","valor":0,"data":"${hoje()}"}
- consultar_resumo: {"tipo":"pessoal|fazenda|ambos"}
- nao_entendido: {}

Mensagem: "${texto.replace(/"/g, "'").replace(/\n/g, ' ').replace(/\r/g, '')}"
`
  try {
    const txt = (await geminiGenerate(prompt))
      .trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    console.log('🤖 Gemini:', txt.substring(0, 80))
    return JSON.parse(txt)
  } catch (e) {
    console.error('❌ Gemini erro:', e.message)
    return { acao: 'nao_entendido', dados: {} }
  }
}

// ─── Processa a mensagem e retorna resposta ───────────────────────────────────
async function processar(texto) {
  const { acao, dados } = await classificar(texto)

  switch (acao) {
    case 'registrar_gasto_pessoal': {
      const r = await callScript('registrar_gasto_pessoal', {
        ...dados,
        data: dados.data || hoje(),
      })
      if (!r.ok) return `❌ Erro ao registrar: ${r.error || 'desconhecido'}`
      return (
        `✅ *Gasto pessoal registrado*\n` +
        `📝 ${dados.descricao}\n` +
        `💰 ${fmtR(dados.valor)}\n` +
        `🏷️ ${dados.categoria || 'Geral'}\n` +
        `📅 ${dados.data || hoje()}`
      )
    }

    case 'registrar_custo_fazenda': {
      const r = await callScript('registrar_custo', {
        data: dados.data || hoje(),
        categoria: dados.categoria || 'Outros',
        descricao: dados.descricao,
        valor: dados.valor,
      })
      if (!r.ok) return `❌ Erro ao registrar: ${r.error || 'desconhecido'}`
      return (
        `✅ *Custo fazenda registrado*\n` +
        `📝 ${dados.descricao}\n` +
        `💰 ${fmtR(dados.valor)}\n` +
        `🏷️ ${dados.categoria || 'Outros'}\n` +
        `📅 ${dados.data || hoje()}`
      )
    }

    case 'registrar_carga': {
      const r = await callScript('registrar_carga', {
        data_carregamento: dados.data || hoje(),
        peso_kg: dados.peso_kg,
        metragem_m: dados.metragem_m,
        valor_carga: dados.valor_carga || undefined,
      })
      if (!r.ok) return `❌ Erro ao registrar carga: ${r.error || 'desconhecido'}`
      return (
        `✅ *Carga de carvão registrada*\n` +
        `⚖️ ${dados.peso_kg} kg\n` +
        `📏 ${dados.metragem_m} metros\n` +
        `📅 ${dados.data || hoje()}` +
        (dados.valor_carga ? `\n💰 ${fmtR(dados.valor_carga)}` : '\n💰 Valor: pendente')
      )
    }

    case 'registrar_pagamento': {
      const r = await callScript('registrar_custo', {
        data: dados.data || hoje(),
        categoria: 'Salários',
        descricao: `Pagamento ${dados.funcionario}`,
        valor: dados.valor,
        responsavel: dados.funcionario,
      })
      if (!r.ok) return `❌ Erro ao registrar: ${r.error || 'desconhecido'}`
      return (
        `✅ *Pagamento registrado*\n` +
        `👤 ${dados.funcionario}\n` +
        `💰 ${fmtR(dados.valor)}\n` +
        `📅 ${dados.data || hoje()}`
      )
    }

    case 'consultar_resumo': {
      const agora = new Date()
      const mes = agora.getMonth() + 1
      const ano = agora.getFullYear()
      const nomeMes = agora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      let resp = `📊 *Resumo — ${nomeMes}*\n`

      if (dados.tipo !== 'fazenda') {
        const r = await callScript('resumo_pessoal', { mes, ano })
        resp += r.ok
          ? `\n👤 *Pessoal:* ${fmtR(r.total)} (${r.quantidade} lançamentos)`
          : '\n👤 Pessoal: erro ao consultar'
      }
      if (dados.tipo !== 'pessoal') {
        const r = await callScript('resumo_custos_fazenda', { mes, ano })
        resp += r.ok
          ? `\n🌾 *Fazenda:* ${fmtR(r.total)} (${r.quantidade} lançamentos)`
          : '\n🌾 Fazenda: erro ao consultar'
      }
      return resp
    }

    default:
      return (
        `❓ Não entendi. Exemplos do que posso fazer:\n\n` +
        `• _gastei 80 no mercado_\n` +
        `• _diesel 300 fazenda_\n` +
        `• _carga 18000kg 74m_\n` +
        `• _paguei Bandinha 800_\n` +
        `• _quanto gastei esse mês?_\n` +
        `• _resumo fazenda_\n\n` +
        `Dica: comece com _!_ para mandar mensagem sem o bot processar`
      )
  }
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────
let qrCodeData  = null
let sock        = null
let isConnected = false
let meuLid      = null
const botMsgIds = new Set()

async function conectar() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

  let version
  try {
    const r = await fetchLatestBaileysVersion()
    version = r.version
  } catch {
    version = [2, 3000, 1015901307]
  }

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    getMessage: async () => undefined,
  })

  sock.ev.on('creds.update', saveCreds)


  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrCodeData = await QRCode.toDataURL(qr)
      console.log('📱 QR gerado — acesse /qr para escanear')
    }

    if (connection === 'close') {
      isConnected = false
      const code = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output.statusCode
        : 0
      console.log(`❌ Desconectado: code=${code} msg=${lastDisconnect?.error?.message || ''}`)

      const limparAuth = code === DisconnectReason.loggedOut
        || code === DisconnectReason.badSession
        || code === 440 // connectionReplaced

      if (limparAuth) {
        console.log('🗑️ Limpando auth e gerando novo QR...')
        try {
          const { rmSync } = await import('fs')
          rmSync(AUTH_DIR, { recursive: true, force: true })
          mkdirSync(AUTH_DIR, { recursive: true })
        } catch {}
        qrCodeData = null
        setTimeout(conectar, 2000)
      } else {
        console.log('Reconectando em 5s...')
        setTimeout(conectar, 5000)
      }
    }

    if (connection === 'open') {
      isConnected = true
      qrCodeData  = null
      meuLid = sock.authState?.creds?.me?.lid || null
      console.log('✅ WhatsApp conectado como', sock.user?.id, '| lid:', meuLid)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return

    for (const msg of messages) {
      if (!sock.user) continue
      if (msg.key.remoteJid === 'status@broadcast') continue

      // Ignora mensagens antigas (mais de 60s) para não processar histórico no startup
      const msgTs = (msg.messageTimestamp || 0)
      const ageSec = Date.now() / 1000 - msgTs
      if (ageSec > 60) continue

      const meuJid = jidNormalizedUser(sock.user.id)
      const lidNorm = meuLid ? (meuLid.includes(':') ? meuLid.split(':')[0] + '@lid' : meuLid) : null

      // Loga todas mensagens não-triviais antes do filtro de JID
      const mPre = msg.message || {}
      const tipoPre = Object.keys(mPre)[0] || 'vazio'
      if (tipoPre !== 'protocolMessage' && tipoPre !== 'vazio') {
        console.log(`📩 JID=${msg.key.remoteJid} fromMe=${msg.key.fromMe} tipo=${tipoPre} (meuJid=${meuJid} lid=${lidNorm})`)
      }

      // Só responde no chat "Notas Pessoais" — precisa ser fromMe E ser o próprio JID/LID
      if (!msg.key.fromMe) continue
      const isSelf = msg.key.remoteJid === meuJid
        || (lidNorm && msg.key.remoteJid === lidNorm)
      if (!isSelf) continue

      // Ignora as próprias respostas do bot
      if (botMsgIds.has(msg.key.id)) {
        botMsgIds.delete(msg.key.id)
        continue
      }

      const m = msg.message || {}
      const texto = (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.ephemeralMessage?.message?.conversation ||
        m.ephemeralMessage?.message?.extendedTextMessage?.text ||
        m.viewOnceMessage?.message?.conversation ||
        m.documentWithCaptionMessage?.message?.documentMessage?.caption ||
        ''
      ).trim()

      console.log(`📦 tipo=${Object.keys(m)[0] || 'vazio'} texto="${texto}"`)
      if (!texto) continue
      if (texto.startsWith('!')) continue // escape: mensagens começando com ! são ignoradas

      console.log(`📨 ${texto}`)

      const destJid = msg.key.remoteJid // responde no mesmo JID que chegou
      try {
        const resposta = await processar(texto)
        const sent = await sock.sendMessage(destJid, { text: resposta })
        if (sent?.key?.id) botMsgIds.add(sent.key.id)
      } catch (err) {
        console.error('Erro processar:', err.message)
        try {
          const sent2 = await sock.sendMessage(destJid, { text: '❌ Erro interno. Tente novamente.' })
          if (sent2?.key?.id) botMsgIds.add(sent2.key.id) // evita loop
        } catch {}
      }
    }
  })
}

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express()

app.get('/health', (_req, res) => {
  res.json({ ok: true, connected: isConnected, qrPending: !!qrCodeData })
})

app.get('/reset', async (_req, res) => {
  try {
    if (sock) { sock.end(); sock = null }
    isConnected = false
    qrCodeData = null
    const { rmSync } = await import('fs')
    rmSync(AUTH_DIR, { recursive: true, force: true })
    mkdirSync(AUTH_DIR, { recursive: true })
    setTimeout(conectar, 1000)
    res.send('<html><body style="font-family:sans-serif;padding:40px;background:#111;color:#fff"><h2>🔄 Resetando... acesse <a href="/qr" style="color:#60a5fa">/qr</a> em 10 segundos</h2></body></html>')
  } catch (e) {
    res.send('Erro: ' + e.message)
  }
})

app.get('/qr', (_req, res) => {
  if (!qrCodeData) {
    return res.send(`
      <html><head><meta http-equiv="refresh" content="10"></head>
      <body style="font-family:sans-serif;padding:40px;background:#111;color:#fff;text-align:center">
        <h2>${isConnected ? '✅ Bot conectado e funcionando!' : '⏳ Gerando QR code... aguarde 10 segundos'}</h2>
      </body></html>
    `)
  }
  res.send(`
    <html><head><meta http-equiv="refresh" content="30"></head>
    <body style="display:flex;flex-direction:column;align-items:center;font-family:sans-serif;padding:40px;background:#111;color:#fff">
      <h2>📱 Escaneie com o WhatsApp</h2>
      <p style="color:#9ca3af">WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
      <img src="${qrCodeData}" style="border-radius:16px;margin:20px 0;max-width:300px" />
      <p style="color:#6b7280;font-size:12px">Página atualiza automaticamente em 30s</p>
    </body></html>
  `)
})

app.listen(PORT, () => console.log(`🚀 Servidor na porta ${PORT}`))
conectar()
