import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const BREVO_API_URL = 'https://api.brevo.com/v3';
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'geraldo@hotelsolar.tur.br';
const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Geraldo | Hotel Solar';
const REPLY_TO_EMAIL = process.env.BREVO_REPLY_TO_EMAIL || 'reserva@hotelsolar.tur.br';
const REPLY_TO_NAME = process.env.BREVO_REPLY_TO_NAME || 'Reservas | Hotel Solar';
const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://hotelsolar.tur.br/solarsemlimitescadastro').replace(/\/$/, '');
const WHATSAPP_CHANNEL_URL = process.env.WHATSAPP_CHANNEL_URL || 'https://whatsapp.com/channel/0029Vb8iEz73gvWjJea5rt3k';

interface LeadBody {
  action?: 'capture' | 'profile';
  firstName?: string;
  phone?: string;
  email?: string;
  consent?: boolean;
  website?: string;
  leadId?: string;
  profile?: string;
  pageUrl?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  referral?: string;
  profileToken?: string;
}

function normalizeBrazilianPhone(value: unknown = '') {
  const digits = clean(value, 40).replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;
  return '';
}

function validEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function clean(value: unknown, maxLength = 180) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] || character);
}

// Sem classe de proposito: `node --experimental-strip-types` (como os testes
// rodam) nao aceita parameter property de TypeScript.
type BrevoError = Error & { brevoCode?: string; brevoStatus?: number };

function brevoError(code: string, status: number): BrevoError {
  const error: BrevoError = new Error('BREVO_REQUEST_FAILED');
  error.brevoCode = code;
  error.brevoStatus = status;
  return error;
}

// O corpo do erro do Brevo pode conter dado do contato, mas `code` é um enum
// curto do provedor ('duplicate_parameter', 'invalid_parameter'...), sem nada
// pessoal. Registrar só ele: sem isso, descobrir por que uma captação falhou
// exige ir caçar no painel, contato por contato.
async function readBrevoErrorCode(response: Response) {
  try {
    const body = await response.json();
    return typeof body?.code === 'string' ? body.code.slice(0, 60) : '';
  } catch {
    return '';
  }
}

async function brevoRequest(path: string, payload: unknown) {
  const response = await fetch(`${BREVO_API_URL}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': BREVO_API_KEY,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
    cache: 'no-store',
  });

  if (!response.ok) {
    // Provider responses can contain contact data. Log status and code only.
    const code = await readBrevoErrorCode(response);
    console.error(JSON.stringify({ message: 'Brevo request failed', path, status: response.status, code }));
    throw brevoError(code, response.status);
  }
}

// O Brevo recusa o mesmo telefone em dois contatos, e isso acontece de verdade:
// casal que usa um número só, quem já se cadastrou antes com outro e-mail, quem
// digita o número do cônjuge. Antes, o cadastro inteiro morria aí — sem guia,
// sem ManyChat, sem Meta — e a tela ainda dizia "tente novamente em instantes",
// que nunca funcionaria, porque o telefone continua sendo de outro contato.
//
// O telefone segue indo para o ManyChat pelo webhook, que é onde o WhatsApp
// importa. O que se perde é o campo SMS no Brevo, não o lead.
async function saveContact(payload: Record<string, unknown>) {
  try {
    await brevoRequest('/contacts', payload);
    return 'saved' as const;
  } catch (error) {
    if ((error as BrevoError)?.brevoCode !== 'duplicate_parameter') throw error;
    const attributes = { ...(payload.attributes as Record<string, string> | undefined) };
    delete attributes.SMS;
    await brevoRequest('/contacts', { ...payload, attributes });
    return 'saved_without_phone' as const;
  }
}

// Aviso de que um cadastro não chegou ao ManyChat.
//
// Essa é a única falha do fluxo que é invisível para todo mundo: o lead fica
// salvo no Brevo, a pessoa vê sucesso na tela, e ninguém descobre que ela não
// entrou na automação do WhatsApp — que é o canal principal da campanha.
// Falha de e-mail, em comparação, a própria pessoa vê na tela.
//
// Vale um aviso a cada 30 minutos, não um por lead. Numa queda do ManyChat com
// a campanha rodando seriam dezenas de e-mails, e alerta que chega às dezenas
// deixa de ser lido justamente quando importa. O aviso diz onde achar todos os
// afetados em vez de tentar listá-los.
//
// O contador vive na memória da instância. A Vercel reaproveita instâncias
// quentes, então isso agrupa a maioria dos casos, mas instâncias paralelas
// podem mandar um aviso cada. É teto aproximado, não exato — e errar para mais
// avisos é melhor que errar para silêncio.
const ALERT_THROTTLE_MS = 30 * 60 * 1000;
let lastIntegrationAlertAt = 0;

// Só para teste. A janela vive em memória de módulo, então sem zerar entre um
// caso e outro o teste seguinte herdaria o silêncio do anterior e passaria a
// verificar o limite em vez do que ele se propõe a verificar.
export function resetIntegrationAlertThrottle() {
  lastIntegrationAlertAt = 0;
}

async function alertIntegrationFailure(requestId: string | undefined) {
  const recipient = clean(process.env.OPS_ALERT_EMAIL, 180) || SENDER_EMAIL;
  if (!validEmail(recipient)) return 'not_configured' as const;

  const now = Date.now();
  if (now - lastIntegrationAlertAt < ALERT_THROTTLE_MS) return 'throttled' as const;
  lastIntegrationAlertAt = now;

  const when = new Date(now).toLocaleString('pt-BR', { timeZone: 'America/Belem' });
  try {
    // Sem nome, e-mail ou telefone do lead: o aviso diz onde procurar, e quem
    // procura já tem acesso legítimo aos dados.
    await brevoRequest('/smtp/email', {
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [{ email: recipient }],
      subject: '[SSL26] Cadastro não chegou ao ManyChat',
      textContent: [
        `Um cadastro foi salvo no Brevo mas não chegou ao ManyChat, em ${when} (horário de Belém).`,
        '',
        'O que isso significa: o lead não se perdeu, está no Brevo. Mas não entrou',
        'na automação do WhatsApp, e ninguém vai falar com ele até alguém agir.',
        '',
        'O que conferir: se o ManyChat está no ar e se LEAD_WEBHOOK_URL e',
        'LEAD_WEBHOOK_TOKEN continuam válidos.',
        '',
        'Como achar todos os afetados: nos logs da Vercel do projeto sitehotelsolar,',
        'procurar por "integration":"failed" na rota /api/capture-lead. Cada linha',
        'tem o requestId do cadastro correspondente.',
        '',
        `Referência deste: ${clean(requestId, 200) || 'sem requestId'}`,
        '',
        'Outros cadastros podem ter falhado sem gerar novo aviso: há um limite de um',
        'aviso a cada 30 minutos para o alerta não virar enxurrada durante uma queda.',
      ].join('\n'),
    });
    return 'sent' as const;
  } catch {
    // Zerar o contador: se o próprio aviso falhou, a próxima captação tenta de
    // novo em vez de ficar 30 minutos em silêncio achando que avisou.
    lastIntegrationAlertAt = 0;
    return 'failed' as const;
  }
}

// Read only this submitted identity, never the whole contact database. Preserve
// withdrawal even when a previously registered person requests the guide again.
async function readContactState(email: string, phone: string) {
  const exclusionAttributes = ['SSL26_OPT_OUT', 'SSL26_QA', 'SSL26_ATENDIMENTO_PAUSA', 'SSL26_COMPRADOR'];
  const response = await fetch(`${BREVO_API_URL}/contacts/${encodeURIComponent(email)}`, {
    method: 'GET', headers: { accept: 'application/json', 'api-key': BREVO_API_KEY },
    signal: AbortSignal.timeout(8000), redirect: 'error', cache: 'no-store',
  });
  if (response.status === 404) return { suppressed: false, phoneMismatch: false };
  if (!response.ok) throw new Error('BREVO_STATE_UNAVAILABLE');
  const contact = await response.json();
  if (!contact || typeof contact.email !== 'string' || contact.email.toLowerCase() !== email
    || !contact.attributes || typeof contact.attributes !== 'object' || Array.isArray(contact.attributes)
    || exclusionAttributes.some(name => contact.attributes[name] !== undefined && typeof contact.attributes[name] !== 'boolean')
    || (contact.emailBlacklisted !== undefined && typeof contact.emailBlacklisted !== 'boolean')) throw new Error('BREVO_IDENTITY_REQUIRES_REVIEW');

  // Telefone diferente do guardado: pode ser a mesma pessoa com número novo, ou
  // alguém digitando o e-mail de outra. A decisão de supressão continua valendo
  // — ela é pelo e-mail, e o e-mail bateu. O que não se faz é sobrescrever o
  // telefone guardado.
  //
  // Antes isso derrubava o cadastro inteiro com "tente novamente em instantes",
  // que nunca funcionaria: quem trocou de número ficava travado para sempre, sem
  // ter como adivinhar que precisava digitar o telefone antigo.
  const phoneMismatch = Boolean(contact.attributes.SMS)
    && normalizeBrazilianPhone(contact.attributes.SMS) !== phone;

  // Existing mirrored holds block recapture; absence is NOT proof that the ERP
  // has no hold. Central pre-send eligibility remains a release prerequisite.
  const suppressed = exclusionAttributes.some(name => contact.attributes[name] === true)
    || contact.emailBlacklisted === true;

  return { suppressed, phoneMismatch };
}

type CaptureReceipt = { email: string; phone: string; firstName: string; leadId: string; capturedAt: string; expiresAt: number };

function signReceipt(payload: string) {
  return createHmac('sha256', BREVO_API_KEY).update(`ssl26-profile-v1:${payload}`).digest('base64url');
}

function createProfileToken(receipt: CaptureReceipt) {
  const payload = Buffer.from(JSON.stringify(receipt)).toString('base64url');
  return `${payload}.${signReceipt(payload)}`;
}

function readProfileToken(value: unknown): CaptureReceipt | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expected = Buffer.from(signReceipt(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const receipt = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as CaptureReceipt;
    if (!validEmail(receipt.email) || !Number.isFinite(receipt.expiresAt) || receipt.expiresAt <= Date.now()) return null;
    return receipt;
  } catch {
    return null;
  }
}

// Conversions API da Meta.
//
// O Pixel do navegador perde uma fatia relevante dos eventos: bloqueador de
// anúncio, ITP do Safari/iOS e aba fechada antes do disparo. O servidor já tem
// o lead validado na mão, então manda o mesmo evento por fora do navegador.
//
// Mora neste arquivo, e não num módulo próprio, porque nenhuma função de api/
// importa arquivo vizinho hoje — e foi um import que a Vercel não conseguiu
// resolver que derrubou as compras em produção antes. Separar não paga esse
// risco a 35 dias da mídia paga.

const META_GRAPH_URL = 'https://graph.facebook.com';
// "Hotel Solar - Site", do portfólio Hotel Solar Salinópolis. Tem de ser o
// MESMO de metaPixel.ts: IDs diferentes nos dois lados desligam a
// deduplicação sem erro visível.
const META_PIXEL_ID_PADRAO = '743518114034395';

type MetaCapiResult = 'accepted' | 'failed' | 'not_configured' | 'skipped';

function sha256Hex(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// A Meta exige normalizar antes de gerar o hash. Se o formato variar, o hash
// muda e o lead deixa de casar com a pessoa do outro lado.
function hashedEmail(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized ? sha256Hex(normalized) : '';
}

function hashedPhone(value: string) {
  // E.164 sem o '+': +5591988887777 vira 5591988887777.
  const digits = value.replace(/\D/g, '');
  return digits ? sha256Hex(digits) : '';
}

function hashedName(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized ? sha256Hex(normalized) : '';
}

function readCookie(cookieHeader: string, name: string) {
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

// O fbclid pode chegar na query ou depois do '#': a página usa rota por hash
// (#/lista-vip) e o anúncio cola o parâmetro no fim da URL que for usada.
function readFbclid(pageUrl: string) {
  try {
    const url = new URL(pageUrl);
    const fromQuery = url.searchParams.get('fbclid');
    if (fromQuery) return fromQuery;
    const marker = url.hash.indexOf('?');
    if (marker === -1) return '';
    return new URLSearchParams(url.hash.slice(marker + 1)).get('fbclid') || '';
  } catch {
    return '';
  }
}

interface MetaLead {
  eventId: string;
  firstName: string;
  email: string;
  phone: string;
  pageUrl: string;
  source: string;
  cookieHeader: string;
  clientIp: string;
  userAgent: string;
  eventTimeMs: number;
}

async function notifyMeta(lead: MetaLead): Promise<MetaCapiResult> {
  const pixelId = clean(process.env.META_PIXEL_ID, 40) || META_PIXEL_ID_PADRAO;
  // O token é o único valor que falta configurar: sem ele, nada é enviado.
  const token = process.env.META_CAPI_TOKEN || '';
  if (!token) return 'not_configured';

  const apiVersion = clean(process.env.META_API_VERSION, 10) || 'v21.0';
  const testEventCode = clean(process.env.META_TEST_EVENT_CODE, 40);

  const fbclid = readFbclid(lead.pageUrl);
  const fbc = readCookie(lead.cookieHeader, '_fbc')
    || (fbclid ? `fb.1.${lead.eventTimeMs}.${fbclid}` : '');
  const fbp = readCookie(lead.cookieHeader, '_fbp');

  const userData: Record<string, unknown> = { country: [sha256Hex('br')] };
  const email = hashedEmail(lead.email);
  const phone = hashedPhone(lead.phone);
  const firstName = hashedName(lead.firstName);
  if (email) userData.em = [email];
  if (phone) userData.ph = [phone];
  if (firstName) userData.fn = [firstName];
  // fbp/fbc e IP não são hasheados: a Meta os recebe em claro por definição.
  if (fbp) userData.fbp = fbp;
  if (fbc) userData.fbc = fbc;
  if (lead.clientIp) userData.client_ip_address = lead.clientIp;
  if (lead.userAgent) userData.client_user_agent = lead.userAgent;

  const response = await fetch(`${META_GRAPH_URL}/${apiVersion}/${pixelId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // O token vai no corpo, nunca na query: URL entra em log de servidor.
    body: JSON.stringify({
      access_token: token,
      ...(testEventCode ? { test_event_code: testEventCode } : {}),
      data: [
        {
          event_name: 'Lead',
          event_time: Math.floor(lead.eventTimeMs / 1000),
          // Mesmo id que o navegador manda em fbq(..., { eventID }). Sem isso a
          // Meta contaria o lead duas vezes e o CPL apareceria pela metade —
          // erro que só apareceria depois da mídia paga já ter rodado.
          event_id: lead.eventId,
          action_source: 'website',
          ...(lead.pageUrl ? { event_source_url: lead.pageUrl } : {}),
          user_data: userData,
          custom_data: { content_name: 'ssl26_novembro_2026', content_category: lead.source },
        },
      ],
    }),
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });

  if (!response.ok) {
    // Só o status: o corpo de erro da Meta devolve trecho do que foi enviado.
    console.error(JSON.stringify({
      level: 'error',
      message: 'Meta CAPI rejected event',
      status: response.status,
    }));
    return 'failed';
  }
  return 'accepted';
}

async function notifyIntegration(body: LeadBody, capturedAt: string) {
  const webhookUrl = process.env.LEAD_WEBHOOK_URL;
  if (!webhookUrl) return 'not_configured' as const;
  if (new URL(webhookUrl).protocol !== 'https:' || !process.env.LEAD_WEBHOOK_TOKEN) {
    throw new Error('LEAD_WEBHOOK_CONFIGURATION_INVALID');
  }

  const isProfileEvent = body.action === 'profile';
  const eventType = isProfileEvent ? 'profile' : 'capture';
  const eventId = `${clean(body.leadId, 100) || randomUUID()}:${eventType}${isProfileEvent ? `:${randomUUID()}` : ''}`;

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.LEAD_WEBHOOK_TOKEN
        ? { authorization: `Bearer ${process.env.LEAD_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      schemaVersion: 1,
      event: isProfileEvent ? 'ssl26_lead_profiled' : 'ssl26_lead_captured',
      eventId,
      tag: 'SSL26_LEAD',
      tags: isProfileEvent ? ['SSL26_LEAD'] : ['SSL26_LEAD', 'SSL26_CAPTADO'],
      capturedAt,
      occurredAt: new Date().toISOString(),
      consent: {
        granted: body.consent === true,
        source: 'landing_ssl26',
        version: 'ssl26_landing_2026_09_v1',
        text: 'Concordo em receber o guia e comunicações do Hotel Solar por e-mail e WhatsApp. Posso cancelar quando quiser.',
      },
      lead: {
        firstName: clean(body.firstName, 80),
        email: clean(body.email, 180).toLowerCase(),
        phone: normalizeBrazilianPhone(body.phone),
        profile: clean(body.profile, 40),
      },
      tracking: {
        pageUrl: clean(body.pageUrl, 500),
        utmSource: clean(body.utmSource, 100),
        utmMedium: clean(body.utmMedium, 100),
        utmCampaign: clean(body.utmCampaign, 100),
        utmContent: clean(body.utmContent, 100),
        utmTerm: clean(body.utmTerm, 100),
        referral: clean(body.referral, 100),
      },
    }),
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  });

  if (!response.ok) {
    throw new Error('LEAD_WEBHOOK_FAILED');
  }
  const acknowledgement = await response.json().catch(() => null);
  if (acknowledgement?.success !== true || acknowledgement?.persisted !== true) {
    throw new Error('LEAD_WEBHOOK_NOT_PERSISTED');
  }
  return 'accepted' as const;
}

export function confirmationEmail(firstName: string) {
  const guideUrl = `${PUBLIC_SITE_URL}/guia-salinas-em-familia.pdf`;
  const safeName = escapeHtml(firstName);
  return {
    sender: { name: SENDER_NAME, email: SENDER_EMAIL },
    replyTo: { name: REPLY_TO_NAME, email: REPLY_TO_EMAIL },
    to: [{ email: '', name: firstName }],
    subject: `${firstName}, seu Guia Salinas em Família chegou`,
    textContent: `Olá, ${firstName}! Seu Guia Salinas em Família: ${guideUrl}\nCanal VIP: ${WHATSAPP_CHANNEL_URL}\nVisita guiada: 24 de novembro de 2026, às 19h (horário de Belém).\nVocê recebeu esta mensagem porque solicitou o guia do Hotel Solar.`,
    htmlContent: `
      <!doctype html>
      <html lang="pt-BR">
        <body style="margin:0;background:#f5f1e7;font-family:Arial,sans-serif;color:#173a35">
          <div style="max-width:620px;margin:0 auto;padding:32px 20px">
            <div style="background:#0b3d2e;border-radius:20px 20px 0 0;padding:32px;color:#fff">
              <div style="font-size:12px;letter-spacing:2px;color:#e1c084;font-weight:bold">HOTEL SOLAR · SALINÓPOLIS</div>
              <h1 style="font-size:30px;line-height:1.2;margin:14px 0 8px">Seu guia já está disponível</h1>
              <p style="margin:0;color:#dbe8e4;line-height:1.6">Um roteiro para imaginar Salinas com mais tranquilidade e tempo em família.</p>
            </div>
            <div style="background:#fff;padding:32px;border-radius:0 0 20px 20px">
              <p style="font-size:17px;line-height:1.7;margin-top:0">Olá, ${safeName}!</p>
              <p style="font-size:16px;line-height:1.7;color:#52625e">Preparamos sugestões de praias, passeios e cuidados práticos para ajudar no planejamento da sua viagem.</p>
              <p style="margin:28px 0">
                <a href="${guideUrl}" style="display:inline-block;background:#0f5c45;color:#fff;text-decoration:none;font-weight:bold;padding:15px 24px;border-radius:10px">Baixar o Guia Salinas em Família</a>
              </p>
              <div style="border:1px solid #d9e4df;background:#f4f8f6;padding:20px;margin:24px 0;border-radius:12px">
                <strong style="font-size:17px">Acompanhe pelo Canal VIP do WhatsApp</strong>
                <p style="font-size:15px;line-height:1.6;color:#52625e;margin:8px 0 16px">Receba os lembretes do encontro e as novidades do lançamento sem participar de grupos.</p>
                <a href="${WHATSAPP_CHANNEL_URL}" style="display:inline-block;border:2px solid #0f5c45;color:#0f5c45;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:10px">Entrar no Canal VIP</a>
              </div>
              <div style="border-left:4px solid #d6ad5b;background:#f7f4eb;padding:16px 18px;margin-top:26px">
                <strong>Reserve na agenda: 24 de novembro, às 19h.</strong>
                <p style="margin:6px 0 0;line-height:1.6;color:#52625e">Você receberá o convite para conhecer o Hotel Solar ao vivo e descobrir o que estamos preparando.</p>
              </div>
              <p style="font-size:13px;line-height:1.6;color:#74817d;margin-top:28px">Você recebeu esta mensagem porque solicitou o guia na página do Hotel Solar.</p>
            </div>
          </div>
        </body>
      </html>`,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now();
  const requestIdHeader = req.headers['x-vercel-id'];
  const requestId = Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  res.setHeader('Cache-Control', 'no-store');

  if (!BREVO_API_KEY) {
    console.error('BREVO_API_KEY is not configured');
    return res.status(503).json({ error: 'Cadastro temporariamente indisponível.' });
  }

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Dados de cadastro inválidos.' });
  }
  const body = req.body as LeadBody;
  if (body.website) return res.status(200).json({ success: true });
  if (body.action && body.action !== 'capture' && body.action !== 'profile') {
    return res.status(400).json({ error: 'Ação inválida.' });
  }

  try {
    if (body.action === 'profile') {
      const receipt = readProfileToken(body.profileToken);
      if (!receipt || (body.email && clean(body.email).toLowerCase() !== receipt.email)) {
        return res.status(403).json({ error: 'Não foi possível confirmar este cadastro. O guia continua disponível.' });
      }
      const email = receipt.email;
      const allowedProfiles = ['ja_hospedou', 'conhece', 'nao_conhece'];
      if (!validEmail(email) || !allowedProfiles.includes(clean(body.profile, 40))) {
        return res.status(400).json({ error: 'Dados de perfil inválidos.' });
      }

      const profileAttribute = clean(process.env.BREVO_PROFILE_ATTRIBUTE || 'SSL26_PROFILE', 50);
      // A captura não grava nada no Brevo de quem pediu para sair. A etapa de
      // perfil precisa da mesma regra, senão vira a porta dos fundos: o mesmo
      // contato entraria por aqui. Sem certeza do estado, não grava — a resposta
      // ainda segue para o ManyChat, que é o destino que importa.
      let profileStorage = 'skipped';
      if (profileAttribute) {
        let profileSuppressed = true;
        try { profileSuppressed = (await readContactState(email, receipt.phone)).suppressed; }
        catch { profileSuppressed = true; }
        if (!profileSuppressed) {
          await brevoRequest('/contacts', {
            email,
            attributes: { [profileAttribute]: clean(body.profile, 40) },
            updateEnabled: true,
          });
          profileStorage = 'saved';
        }
      }

      const integration = await notifyIntegration({ ...body, ...receipt, consent: true }, receipt.capturedAt)
        .catch(() => 'failed' as const);
      console.log(JSON.stringify({
        level: 'info',
        message: 'SSL26 lead profile saved',
        route: '/api/capture-lead',
        action: 'profile',
        integration,
        profileStorage,
        requestId,
        durationMs: Date.now() - startedAt,
      }));
      return res.status(200).json({ success: true, integration });
    }

    const firstName = clean(body.firstName, 80);
    const email = clean(body.email).toLowerCase();
    const phone = normalizeBrazilianPhone(body.phone);

    if (firstName.length < 2 || !validEmail(email) || !phone || body.consent !== true) {
      return res.status(400).json({ error: 'Revise nome, WhatsApp, e-mail e consentimento.' });
    }

    // Lista criada em 16/09/2026 pelo instalador SSL26. A variável permite
    // substituir o ID sem novo deploy caso a estrutura seja migrada no Brevo.
    const listId = Number(process.env.BREVO_LEADS_LIST_ID || 24);
    if (!Number.isInteger(listId) || listId <= 0) {
      return res.status(503).json({ error: 'Cadastro temporariamente indisponível.' });
    }
    const contactState = await readContactState(email, phone);
    const suppressed = contactState.suppressed;
    const capturedAt = new Date().toISOString();
    const leadId = clean(body.leadId, 100) || randomUUID();
    const extendedAttributesEnabled = process.env.BREVO_SSL26_ATTRIBUTES_ENABLED !== 'false';
    const source = clean(body.utmSource, 100) || (clean(body.referral, 100) ? 'indicacao' : 'direto');
    const attributes: Record<string, string> = {};
    // Identidade só é gravada quando o telefone confere com o que já está
    // guardado. Havendo divergência, o contato necessariamente já existe e já
    // tem nome — e um cadastro que não bate com o registro não sobrescreve nome
    // nem telefone de ninguém. A atribuição de campanha abaixo ainda é gravada,
    // e o número novo segue para o ManyChat pelo webhook, que é onde o WhatsApp
    // importa; o que fica desatualizado é o campo SMS no Brevo.
    if (!contactState.phoneMismatch) {
      attributes.FIRSTNAME = firstName;
      attributes.SMS = phone;
    }
    if (extendedAttributesEnabled) {
      attributes.SSL26_SOURCE = source;
      attributes.SSL26_CAMPAIGN = clean(body.utmCampaign, 100);
      attributes.SSL26_REFERRAL = clean(body.referral, 100);
      attributes.SSL26_CONSENT_AT = capturedAt;
    }
    const contactPayload: Record<string, unknown> = {
      email,
      attributes,
      updateEnabled: true,
    };
    if (!suppressed) contactPayload.listIds = [listId];

    const emailPayload = confirmationEmail(firstName);
    emailPayload.to[0].email = email;
    // Save the lead before any delivery. A secondary failure must not invite
    // resubmission of an already saved registration (and duplicate messages).
    // A new form submission is not permission to reset an earlier withdrawal.
    // Skip all Brevo writes for suppressed contacts, including consent overwrite.
    let contactStorage: string = 'skipped';
    if (!suppressed) {
      contactStorage = await saveContact(contactPayload);
      // Distinguir no log as duas razões de o telefone não ter sido gravado:
      // conflito recusado pelo Brevo, ou divergência que decidimos não sobrescrever.
      if (contactState.phoneMismatch && contactStorage === 'saved') contactStorage = 'saved_phone_mismatch';
    }
    // Re-read after the upsert to catch a withdrawal arriving during capture.
    // The campaign audience must ALSO exclude SSL26_OPT_OUT=true, even if a
    // concurrent capture temporarily restores list membership.
    let emailSuppressed = suppressed;
    let suppressionCheckFailed = false;
    if (!suppressed) {
      try { emailSuppressed = (await readContactState(email, phone)).suppressed; }
      catch { suppressionCheckFailed = true; }
    }
    const [mailResult, integrationResult, metaResult] = await Promise.allSettled([
      emailSuppressed || suppressionCheckFailed ? Promise.resolve() : brevoRequest('/smtp/email', emailPayload),
      notifyIntegration({ ...body, action: 'capture', firstName, email, phone, leadId }, capturedAt),
      // Quem pediu para sair não é enviado à Meta: consentimento retirado vale
      // para medição também, não só para mensagem.
      //
      // O mesmo vale quando não deu para reconfirmar o estado no Brevo. Se a
      // dúvida basta para segurar um e-mail que a pessoa pediu, basta para não
      // mandar os dados dela a uma plataforma de anúncio.
      emailSuppressed || suppressionCheckFailed
        ? Promise.resolve('skipped' as const)
        : notifyMeta({
            eventId: leadId,
            firstName,
            email,
            phone,
            pageUrl: clean(body.pageUrl, 500),
            source,
            cookieHeader: String(req.headers.cookie || ''),
            clientIp: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
              || String(req.headers['x-real-ip'] || '').trim(),
            userAgent: String(req.headers['user-agent'] || ''),
            eventTimeMs: Date.now(),
          }),
    ]);
    const emailDelivery = emailSuppressed ? 'suppressed' : suppressionCheckFailed || mailResult.status === 'rejected' ? 'failed' : 'accepted';
    const integration = integrationResult.status === 'fulfilled' ? integrationResult.value : 'failed';
    const metaCapi = metaResult.status === 'fulfilled' ? metaResult.value : 'failed';
    // O aviso nunca derruba a captação: o cadastro já está salvo, e falhar em
    // avisar sobre um problema não pode virar um segundo problema.
    const integrationAlert = integration === 'failed'
      ? await alertIntegrationFailure(requestId).catch(() => 'failed' as const)
      : 'not_needed';
    console.log(JSON.stringify({
      level: 'info',
      message: 'SSL26 lead captured',
      route: '/api/capture-lead',
      action: 'capture',
      emailDelivery,
      integration,
      integrationAlert,
      metaCapi,
      contactStorage,
      requestId,
      durationMs: Date.now() - startedAt,
    }));
    return res.status(200).json({
      success: true,
      emailDelivery,
      integration,
      profileToken: createProfileToken({ email, phone, firstName, leadId, capturedAt, expiresAt: Date.now() + 60 * 60 * 1000 }),
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'SSL26 lead capture failed',
      route: '/api/capture-lead',
      requestId,
      error: 'PROVIDER_UNAVAILABLE',
      durationMs: Date.now() - startedAt,
    }));
    return res.status(502).json({ error: 'Não conseguimos concluir agora. Tente novamente em instantes.' });
  }
}
