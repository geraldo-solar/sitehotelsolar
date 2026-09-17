import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

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
  });

  if (!response.ok) {
    // Provider responses can contain contact data. Log status only.
    console.error(JSON.stringify({ message: 'Brevo request failed', path, status: response.status }));
    throw new Error('BREVO_REQUEST_FAILED');
  }
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

async function notifyIntegration(body: LeadBody, capturedAt: string) {
  const webhookUrl = process.env.LEAD_WEBHOOK_URL;
  if (!webhookUrl) return 'not_configured' as const;
  if (new URL(webhookUrl).protocol !== 'https:' || !process.env.LEAD_WEBHOOK_TOKEN) {
    throw new Error('LEAD_WEBHOOK_CONFIGURATION_INVALID');
  }

  const isProfileEvent = body.action === 'profile';
  const eventType = isProfileEvent ? 'profile' : 'capture';
  const eventId = `${clean(body.leadId, 100) || randomUUID()}:${eventType}`;

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.LEAD_WEBHOOK_TOKEN
        ? { authorization: `Bearer ${process.env.LEAD_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      event: isProfileEvent ? 'ssl26_lead_profiled' : 'ssl26_lead_captured',
      eventId,
      tag: 'SSL26_LEAD',
      tags: isProfileEvent ? ['SSL26_LEAD'] : ['SSL26_LEAD', 'SSL26_CAPTADO'],
      capturedAt,
      consent: {
        granted: body.consent === true,
        source: 'landing_ssl26',
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
      if (profileAttribute) {
        await brevoRequest('/contacts', {
          email,
          attributes: { [profileAttribute]: clean(body.profile, 40) },
          updateEnabled: true,
        });
      }

      const integration = await notifyIntegration({ ...body, ...receipt, consent: true }, receipt.capturedAt)
        .catch(() => 'failed' as const);
      console.log(JSON.stringify({
        level: 'info',
        message: 'SSL26 lead profile saved',
        route: '/api/capture-lead',
        action: 'profile',
        integration,
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
    const capturedAt = new Date().toISOString();
    const leadId = clean(body.leadId, 100) || randomUUID();
    const extendedAttributesEnabled = process.env.BREVO_SSL26_ATTRIBUTES_ENABLED !== 'false';
    const source = clean(body.utmSource, 100) || (clean(body.referral, 100) ? 'indicacao' : 'direto');
    const attributes: Record<string, string> = { FIRSTNAME: firstName, SMS: phone };
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
    contactPayload.listIds = [listId];

    const emailPayload = confirmationEmail(firstName);
    emailPayload.to[0].email = email;
    // Save the lead before any delivery. A secondary failure must not invite
    // resubmission of an already saved registration (and duplicate messages).
    await brevoRequest('/contacts', contactPayload);
    const [mailResult, integrationResult] = await Promise.allSettled([
      brevoRequest('/smtp/email', emailPayload),
      notifyIntegration({ ...body, action: 'capture', firstName, email, phone, leadId }, capturedAt),
    ]);
    const emailDelivery = mailResult.status === 'fulfilled' ? 'accepted' : 'failed';
    const integration = integrationResult.status === 'fulfilled' ? integrationResult.value : 'failed';
    console.log(JSON.stringify({
      level: 'info',
      message: 'SSL26 lead captured',
      route: '/api/capture-lead',
      action: 'capture',
      emailDelivery,
      integration,
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
