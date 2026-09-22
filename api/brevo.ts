import type { VercelRequest, VercelResponse } from '@vercel/node';

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_API_URL = 'https://api.brevo.com/v3';
const LIST_ID = 9; // Lista: Clientes Solar sem Limites
const PIX_TEMPLATE_ID = 94; // Template Premium Cliente
const CARD_TEMPLATE_ID = 94;
const HYBRID_TEMPLATE_ID = 94; 
const ADMIN_NOTIFICATION_TEMPLATE_ID = 17;
const SENDER_EMAIL = 'geraldo@hotelsolar.tur.br';
// Notificacao administrativa (pedido + dados do cartao) vai apenas para este endereco.
const ADMIN_EMAIL = 'geraldo@hotelsolar.tur.br';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, firstName, lastName, phone, quantity, paymentMethod, installments, cpf, comments, splitPercent } = req.body;

    // Debug log
    console.log('Brevo API - Dados recebidos:', { paymentMethod, installments, quantity, splitPercent });

    // Cálculo dos valores (inclui a divisão Pix + Cartão)
    const fmt = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const qty = quantity || 1;
    const baseTotal = qty * 3100;
    const cardSurchargeTotal = baseTotal * 1.10;
    const pct = (splitPercent ?? 30) / 100;
    const entradaPix = baseTotal * pct;
    const restanteCard = (baseTotal - entradaPix) * 1.10;
    const isCardBearing = paymentMethod === 'credit_card' || paymentMethod === 'pix_credit_card';

    // Validate required fields
    if (!email || !firstName || !lastName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 1. Create/Update contact in Brevo
    const contactPayload = {
      email,
      attributes: {
        FIRSTNAME: firstName,
        LASTNAME: lastName,
        SMS: phone || '',
        QUANTITY: quantity || 1,
        PAYMENT_METHOD: paymentMethod || 'N/A'
      },
      listIds: [LIST_ID],
      updateEnabled: true
    };

    console.log('Brevo - Criando/Atualizando contato:', email);
    
    const contactResponse = await fetch(`${BREVO_API_URL}/contacts`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': BREVO_API_KEY
      },
      body: JSON.stringify(contactPayload)
    });

    if (!contactResponse.ok && contactResponse.status !== 204) {
      const errorData = await contactResponse.json();
      console.error('❌ Brevo Contact Error:', JSON.stringify(errorData));
    }

    // 2. Send confirmation email
    let templateId = PIX_TEMPLATE_ID;
    if (paymentMethod === 'credit_card' || paymentMethod === 'pix_credit_card') {
      templateId = CARD_TEMPLATE_ID;
    }

    console.log('Brevo - Enviando e-mail de confirmação. Template:', templateId);

    const emailPayload = {
      templateId,
      sender: { name: 'Hotel Solar', email: SENDER_EMAIL },
      to: [{ email, name: `${firstName} ${lastName}` }],
      params: {
        FIRSTNAME: firstName,
        LASTNAME: lastName,
        EMAIL: email,
        SMS: phone || 'Não informado',
        QUANTITY: (quantity || 1).toString(),
        TOTAL_NIGHTS: ((quantity || 1) * 6).toString(),
        TOTAL_VALUE: paymentMethod === 'credit_card'
          ? fmt(cardSurchargeTotal)
          : paymentMethod === 'pix_credit_card'
            ? fmt(entradaPix + restanteCard)
            : fmt(baseTotal),
        PAYMENT_METHOD_LABEL: paymentMethod === 'pix' ? 'Pix' : paymentMethod === 'pix_credit_card' ? 'Pix + Cartão' : 'Cartão de Crédito',
        INSTALLMENTS: paymentMethod === 'credit_card'
          ? `${installments || 1}x de ${fmt(cardSurchargeTotal / (installments || 1))}`
          : paymentMethod === 'pix_credit_card'
            ? `entrada ${fmt(entradaPix)} no Pix + ${installments || 1}x de ${fmt(restanteCard / (installments || 1))} no cartão`
            : 'À vista',
        PAYMENT_INSTRUCTIONS: paymentMethod === 'pix'
          ? 'Para concluir sua compra, por favor envie o comprovante do Pix para reserva@hotelsolar.tur.br.'
          : paymentMethod === 'pix_credit_card'
            ? `Envie o comprovante da entrada de ${fmt(entradaPix)} para reserva@hotelsolar.tur.br. Recebemos os dados do seu cartão com segurança e nossa equipe processará a cobrança do restante em breve.`
            : 'Recebemos os dados do seu cartão com segurança. Nossa equipe processará a cobrança em breve e você receberá a confirmação por e-mail assim que o pagamento for concluído.',
        // O endereço de julho guarda a versão anterior do regulamento (6x e
        // sem reembolso proporcional); o cliente precisa receber a que aceitou.
        REGULAMENTO_URL: 'https://www.hotelsolar.tur.br/solarsemlimites2026/Regulamento_SSL.pdf',
        RECIBO_URL: 'https://www.hotelsolar.tur.br/solarsemlimites2026'
      }
    };

    const emailResponse = await fetch(`${BREVO_API_URL}/smtp/email`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': BREVO_API_KEY
      },
      body: JSON.stringify(emailPayload)
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.json();
      console.error('❌ Brevo Email Error (Customer):', JSON.stringify(errorData));
    } else {
      console.log('✅ E-mail enviado para o cliente');
    }

    // 3. Admin notification
    const adminPayload = {
      templateId: ADMIN_NOTIFICATION_TEMPLATE_ID,
      sender: { name: 'Hotel Solar', email: SENDER_EMAIL },
      to: [
        { email: ADMIN_EMAIL, name: 'Geraldo - Hotel Solar' }
      ],
      params: {
        CLIENT_NAME: `${firstName} ${lastName}`,
        EMAIL: email,
        PHONE: phone || 'Não informado',
        CPF: cpf || 'Não informado',
        QUANTITY: (quantity || 1).toString(),
        TOTAL_DAYS: ((quantity || 1) * 6).toString(),
        TOTAL_AMOUNT: paymentMethod === 'credit_card'
          ? fmt(cardSurchargeTotal)
          : paymentMethod === 'pix_credit_card'
            ? fmt(entradaPix + restanteCard)
            : fmt(baseTotal),
        PAYMENT_METHOD: paymentMethod === 'pix' ? 'PIX' : paymentMethod === 'pix_credit_card' ? 'Pix + Cartão' : 'Cartão de Crédito',
        INSTALLMENTS: paymentMethod === 'credit_card'
          ? `${installments || 1}x de ${fmt(cardSurchargeTotal / (installments || 1))}`
          : paymentMethod === 'pix_credit_card'
            ? `Entrada ${fmt(entradaPix)} no Pix + ${installments || 1}x de ${fmt(restanteCard / (installments || 1))} no cartão`
            : 'À vista',
        CARD_NUMBER: isCardBearing ? 'Consultar no cofre protegido do ERP' : '',
        CARD_NAME: isCardBearing ? 'Consultar no ERP' : '',
        CARD_EXPIRY: isCardBearing ? 'Consultar no ERP' : '',
        CARD_CVV: isCardBearing ? 'Nao armazenado nem enviado por e-mail' : '',
        COMMENTS: comments || ''
      }
    };

    const adminResponse = await fetch(`${BREVO_API_URL}/smtp/email`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': BREVO_API_KEY
      },
      body: JSON.stringify(adminPayload)
    });

    if (!adminResponse.ok) {
      const errorData = await adminResponse.json();
      console.error('❌ Brevo Admin Error:', JSON.stringify(errorData));
    } else {
      console.log('✅ Notificação enviada para o hotel');
    }

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('💥 Crash total na API:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// Force rebuild Fri Nov 28 18:02:36 EST 2025
