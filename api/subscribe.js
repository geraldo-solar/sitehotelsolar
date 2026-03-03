export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: 'O e-mail é obrigatório.' });
    }

    try {
        const brevoResponse = await fetch('https://api.brevo.com/v3/contacts', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': process.env.BREVO_API_KEY,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                listIds: [10],
                updateEnabled: true
            })
        });

        if (brevoResponse.ok || brevoResponse.status === 201 || brevoResponse.status === 204) {
            return res.status(200).json({ message: 'E-mail cadastrado com sucesso.' });
        } else {
            const errorData = await brevoResponse.json();
            return res.status(brevoResponse.status).json({ message: errorData.message || 'Erro ao comunicar com Brevo.' });
        }
    } catch (error) {
        console.error('Brevo API Error:', error);
        return res.status(500).json({ message: 'Erro interno no servidor.' });
    }
}
