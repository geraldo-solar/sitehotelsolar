import type { VercelRequest, VercelResponse } from '@vercel/node';

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_API_URL = 'https://api.brevo.com/v3';

// IDs dos templates
const APPROVED_TEMPLATE_ID = 15;
const REJECTED_TEMPLATE_ID = 16;

// ID da lista de clientes
const CLIENT_LIST_ID = 9; // Lista: Clientes Solar sem Limites

interface NotifyStatusRequest {
  orderId: string;
  status: 'approved' | 'rejected';
  customerData: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    quantity: number;
    totalValue: string;
    totalNights: number;
  };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Apenas POST é permitido
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verificar se a API key está configurada
  if (!BREVO_API_KEY) {
    console.error('BREVO_API_KEY não configurada');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const { orderId, status, customerData }: NotifyStatusRequest = req.body;

    console.log(`📧 Enviando notificação de status: ${status} para ${customerData.email}`);

    // Selecionar template baseado no status
    const templateId = status === 'approved' ? APPROVED_TEMPLATE_ID : REJECTED_TEMPLATE_ID;
    
    // Preparar parâmetros do e-mail
    const emailParams = {
      FIRSTNAME: customerData.firstName,
      LASTNAME: customerData.lastName,
      EMAIL: customerData.email,
      SMS: customerData.phone,
      QUANTITY: customerData.quantity.toString(),
      TOTAL_VALUE: customerData.totalValue,
      TOTAL_NIGHTS: customerData.totalNights.toString(),
      REGULAMENTO_URL: 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663213718939/ehBjwuEyVsyVUsDW.pdf'
    };

    // Enviar e-mail via Brevo
    const emailResponse = await fetch(`${BREVO_API_URL}/smtp/email`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': BREVO_API_KEY
      },
      body: JSON.stringify({
        to: [
          {
            email: customerData.email,
            name: `${customerData.firstName} ${customerData.lastName}`
          }
        ],
        templateId: templateId,
        params: emailParams
      })
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.text();
      console.error('Erro ao enviar e-mail:', errorData);
      throw new Error(`Falha ao enviar e-mail: ${emailResponse.status}`);
    }

    const emailResult = await emailResponse.json();
    console.log(`✅ E-mail de ${status} enviado com sucesso!`, emailResult);

    // Se o pagamento foi aprovado, adicionar à lista de clientes
    if (status === 'approved') {
      try {
        const addToListResponse = await fetch(`${BREVO_API_URL}/contacts/${encodeURIComponent(customerData.email)}`, {
          method: 'PUT',
          headers: {
            'accept': 'application/json',
            'content-type': 'application/json',
            'api-key': BREVO_API_KEY
          },
          body: JSON.stringify({
            listIds: [CLIENT_LIST_ID]
          })
        });

        if (addToListResponse.ok || addToListResponse.status === 204) {
          console.log(`✅ Cliente adicionado à lista "Clientes Solar sem Limites"`);
        } else {
          console.warn(`⚠️ Não foi possível adicionar à lista: ${addToListResponse.status}`);
        }
      } catch (listError) {
        console.error('Erro ao adicionar à lista:', listError);
        // Não falhar a requisição por causa disso
      }
    }

    return res.status(200).json({
      success: true,
      message: `Notificação de ${status} enviada com sucesso`,
      messageId: emailResult.messageId
    });

  } catch (error) {
    console.error('Erro ao processar notificação:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    });
  }
}
