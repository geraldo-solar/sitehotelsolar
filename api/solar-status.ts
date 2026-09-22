import type { VercelRequest, VercelResponse } from '@vercel/node';

// Estado do carrinho (abre/fecha por data) e contador real de pacotes, lidos
// do ERP. Passa por aqui e nao direto do navegador para o segredo de
// ingestao nunca sair do servidor - mesmo motivo do solar-erp-sync.
const ERP_URL = process.env.SOLAR_ERP_URL || 'https://erp-hotel-solar.vercel.app';
const SOLAR_INGEST_SECRET = process.env.SOLAR_INGEST_SECRET || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SOLAR_INGEST_SECRET) {
    console.error('SOLAR_INGEST_SECRET nao configurada - status do carrinho indisponivel.');
    return res.status(500).json({ success: false, error: 'Status indisponivel' });
  }

  try {
    const erpResponse = await fetch(`${ERP_URL}/api/advance-packages/status`, {
      method: 'GET',
      headers: { 'x-solar-ingest-secret': SOLAR_INGEST_SECRET },
    });

    const data = await erpResponse.json();

    if (!erpResponse.ok) {
      console.error('Erro ao consultar status no ERP:', data);
      return res.status(erpResponse.status).json({ success: false, error: data });
    }

    // Cache curto: a pagina pode ser aberta por muita gente ao mesmo tempo na
    // largada, e o numero nao precisa ser atualizado ao segundo.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(data);
  } catch (error) {
    console.error('Erro ao consultar status no ERP:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
