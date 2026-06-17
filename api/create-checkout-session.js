// api/create-checkout-session.js
// Funzione serverless per Vercel — crea una sessione Stripe Checkout

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // CORS — permette al tuo sito GitHub Pages di chiamare questa funzione
  res.setHeader('Access-Control-Allow-Origin', 'https://hanamipress.xyz'); // sostituisci '*' con il tuo dominio in produzione
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo non permesso' });
  }

  try {
    const { items, shipping, zone } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Carrello vuoto' });
    }

    // Crea le line items per Stripe a partire dai prodotti nel carrello
    const lineItems = items.map(item => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: item.name,
          images: item.image ? [`https://hanamipress.xyz${item.image}`] : []
          // sostituisci TUO-DOMINIO con il tuo dominio GitHub Pages reale
        },
        unit_amount: Math.round(item.price * 100) // Stripe usa i centesimi
      },
      quantity: item.quantity
    }));

    // Aggiunge la spedizione come riga separata
    if (shipping > 0) {
      lineItems.push({
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Spedizione (${zone === 'italy' ? 'Italia' : zone === 'eu' ? 'Unione Europea' : 'Resto del mondo'})`
          },
          unit_amount: Math.round(shipping * 100)
        },
        quantity: 1
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'paypal'],
      line_items: lineItems,
      mode: 'payment',
      success_url: 'https://hanamipress.xyz/successo.html',
      cancel_url: 'https://hanamipress.xyz',
      shipping_address_collection: {
        allowed_countries: ['IT', 'FR', 'DE', 'ES', 'AT', 'NL', 'BE', 'PT', 'US', 'GB']
        // aggiungi/rimuovi i paesi che spedisci
      }
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Errore Stripe:', err);
    return res.status(500).json({ error: 'Errore durante la creazione del checkout' });
  }
};
