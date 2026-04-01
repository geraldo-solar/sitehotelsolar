import type { VercelRequest, VercelResponse } from '@vercel/node';

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_API_URL = 'https://api.brevo.com/v3';
const LIST_ID = 9; // Lista: Clientes Solar sem Limites
const PIX_TEMPLATE_ID = 13;
const CARD_TEMPLATE_ID = 14;
const HYBRID_TEMPLATE_ID = 13; // TODO: Criar um template novo no Brevo para o pagamento presencial e colocar o ID novo aqui. Temporariamente usando o do PIX.
const ADMIN_NOTIFICATION_TEMPLATE_ID = 17;
const ADMIN_EMAIL = 'geraldo@hotelsolar.tur.br';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, firstName, lastName, phone, quantity, paymentMethod, installments, cardNumber, cardName, cardExpiry, cardCvv, cpf } = req.body;
    
    // Debug log
    console.log('Brevo API - Dados recebidos:', { paymentMethod, installments, quantity });

    // Validate required fields
    if (!email || !firstName || !lastName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 1. Create/Update contact in Brevo
    const contactResponse = await fetch(`${BREVO_API_URL}/contacts`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': BREVO_API_KEY
      },
      body: JSON.stringify({
        email,
        attributes: {
          FIRSTNAME: firstName,
          LASTNAME: lastName,
          SMS: phone || '',
          QUANTITY: quantity || 1,
          PAYMENT_METHOD: paymentMethod || 'N/A'
        },
        updateEnabled: true
      })
    });

    if (!contactResponse.ok && contactResponse.status !== 204) {
      const errorData = await contactResponse.json();
      console.error('Error creating contact:', errorData);
      // Continue even if contact creation fails
    }

    // 2. Send confirmation email with correct template based on payment method
    let templateId = PIX_TEMPLATE_ID;
    if (paymentMethod === 'credit_card') {
      templateId = CARD_TEMPLATE_ID;
    } else if (paymentMethod === 'pix_credit_card') {
      templateId = HYBRID_TEMPLATE_ID;
    }
    
    const emailResponse = await fetch(`${BREVO_API_URL}/smtp/email`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': BREVO_API_KEY
      },
      body: JSON.stringify({
        templateId,
        to: [
          {
            email,
            name: `${firstName} ${lastName}`
          }
        ],
        params: {
          FIRSTNAME: firstName,
          LASTNAME: lastName,
          EMAIL: email,
          SMS: phone || 'Não informado',
          QUANTITY: (quantity || 1).toString(),
          TOTAL_NIGHTS: ((quantity || 1) * 6).toString(),
          TOTAL_VALUE: paymentMethod === 'credit_card' 
            ? `R$ ${((quantity || 1) * 2800 * 1.10).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : `R$ ${((quantity || 1) * 2800).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          PAYMENT_METHOD_LABEL: paymentMethod === 'pix' ? 'PIX' : paymentMethod === 'pix_credit_card' ? 'Pix e Cartão (Presencial)' : 'Cartão de Crédito',
          INSTALLMENTS: paymentMethod === 'credit_card' 
            ? `${installments || 1}x de R$ ${(((quantity || 1) * 2800 * 1.10) / (installments || 1)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : paymentMethod === 'pix_credit_card' ? 'Pagamento na Recepção' : 'À vista',
          PAYMENT_INSTRUCTIONS: paymentMethod === 'pix_credit_card'
            ? 'Sua pré-reserva foi garantida! Por favor, dirija-se à recepção do Hotel Solar para concluir o pagamento.'
            : paymentMethod === 'pix' 
            ? 'Por favor, realize o pagamento via Pix e envie o comprovante.'
            : 'Seu pagamento será processado via Cartão de Crédito.'
        }
      })
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.json();
      console.error('Error sending email:', errorData);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to send email',
        details: errorData 
      });
    }

    const emailData = await emailResponse.json();
    
    // 3. Enviar notificação para o administrador
    try {
      const adminNotificationResponse = await fetch(`${BREVO_API_URL}/smtp/email`, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'api-key': BREVO_API_KEY
        },
        body: JSON.stringify({
          templateId: ADMIN_NOTIFICATION_TEMPLATE_ID,
          to: [
            {
              email: ADMIN_EMAIL,
              name: 'Geraldo - Hotel Solar'
            }
          ],
          params: {
            CLIENT_NAME: `${firstName} ${lastName}`,
            EMAIL: email,
            PHONE: phone || 'Não informado',
            CPF: cpf || 'Não informado',
            QUANTITY: (quantity || 1).toString(),
            TOTAL_DAYS: ((quantity || 1) * 6).toString(),
            TOTAL_AMOUNT: paymentMethod === 'credit_card' 
              ? `R$ ${((quantity || 1) * 2800 * 1.10).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : `R$ ${((quantity || 1) * 2800).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            PAYMENT_METHOD: paymentMethod === 'pix' ? 'PIX' : paymentMethod === 'pix_credit_card' ? 'Pix e Cartão (Presencial)' : 'Cartão de Crédito',
            INSTALLMENTS: paymentMethod === 'credit_card' 
              ? `${installments || 1}x de R$ ${(((quantity || 1) * 2800 * 1.10) / (installments || 1)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : paymentMethod === 'pix_credit_card' ? 'A combinar presencialmente' : 'À vista',
            // Dados do cartão (apenas se for cartão)
            CARD_NUMBER: paymentMethod === 'credit_card' ? cardNumber : '',
            CARD_NAME: paymentMethod === 'credit_card' ? cardName : '',
            CARD_EXPIRY: paymentMethod === 'credit_card' ? cardExpiry : '',
            CARD_CVV: paymentMethod === 'credit_card' ? cardCvv : ''
          }
        })
      });

      if (adminNotificationResponse.ok) {
        console.log('✅ Notificação enviada para o administrador');
      } else {
        console.warn('⚠️ Falha ao enviar notificação para o administrador');
      }
    } catch (adminError) {
      console.error('Erro ao enviar notificação para admin:', adminError);
      // Não falhar a requisição por causa disso
    }
    
    return res.status(200).json({ 
      success: true, 
      messageId: emailData.messageId 
    });

  } catch (error) {
    console.error('Brevo API error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
}
// Force rebuild Fri Nov 28 18:02:36 EST 2025
