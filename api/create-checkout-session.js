// api/create-checkout-session.js
// Funzione serverless per Vercel — crea una sessione Stripe Checkout
//
// IMPORTANTE: il browser NON e' una fonte attendibile. Prezzi, quantita', zona e
// costo di spedizione che arrivano dal carrello vengono controllati qui con il
// catalogo qui sotto; la spedizione viene sempre ricalcolata sul server.

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

/* ---------------------------
   CATALOGO
   ---------------------------
   Una voce per ogni `data-name` usato nei pulsanti del sito.
   - category: 'zine' oppure 'stampa' (cambia il costo di spedizione in Italia)
   - hand:     true se con questo prodotto si puo' scegliere la consegna a mano
   - prices:   prezzi in euro accettati. Mettere il prezzo pieno E quello scontato
               finche' lo sconto e' attivo; a sconto finito togliere quello scontato.
               Qualsiasi altro prezzo viene rifiutato.

   Quando aggiungi un prodotto al sito, aggiungilo anche qui: se manca, il
   pagamento viene rifiutato. */
const CATALOG = {
  'Pony - Risograph A3':             { category: 'stampa', prices: [10, 15] },
  'Primavera 2025 - Risograph A4':   { category: 'stampa', prices: [10] },
  'Blob Blob - Risograph 10x15':     { category: 'stampa', prices: [5, 7] },

  'Capsule Monsters (VERDE)':        { category: 'zine', prices: [5, 8] },
  'Capsule Monsters (MINI ARTBOOK)': { category: 'zine', prices: [5, 8] },
  'Rosacea':                         { category: 'zine', prices: [2, 4] },
  'My Little Zine':                  { category: 'zine', prices: [1, 3] },
  'Ora della pappa':                 { category: 'zine', prices: [3, 5] },
  "E' l'ora della pappa":            { category: 'zine', prices: [3, 5] },
  'Dark Magic Bros':                 { category: 'zine', prices: [3, 5] },
  'Pixelgore':                       { category: 'zine', prices: [3, 5] },
  'Pixelporn':                       { category: 'zine', prices: [3, 5] },
  'Il posto delle vipere':           { category: 'zine', prices: [7] },
  'Nostalgia Miseria':               { category: 'zine', prices: [7] },

  'Tagliato Fuori #1':               { category: 'zine', prices: [5] },
  'Tagliato Fuori #2':               { category: 'zine', prices: [8], hand: true },
  // nomi vecchi di Tagliato Fuori #1: servono ai carrelli salvati prima del cambio nome
  'Tagliato Fuori':                  { category: 'zine', prices: [5] },
  'Tagliato Fuori Vol.I':            { category: 'zine', prices: [5] }
};

/* ---------------------------
   SPEDIZIONE (euro) — stesse tariffe di cart.js
   --------------------------- */
const SHIPPING = {
  italy_zine: 2,   // Italia, solo zine
  italy_other: 8,  // Italia, con almeno una stampa
  hand: 0,         // consegna a mano (solo se nel carrello c'e' un prodotto con hand: true)
  eu: 12,
  world: 20
};

const ZONE_LABEL = { italy: 'Italia', eu: 'Unione Europea', world: 'Resto del mondo' };
const MAX_ITEMS = 30;
const MAX_QTY = 20;

class BadRequest extends Error {}

// Immagine facoltativa: solo percorsi del sito sotto /img/
function safeImage(image) {
  if (typeof image !== 'string') return null;
  if (!/^\/img\/[A-Za-z0-9%._\/-]+$/.test(image) || image.includes('..')) return null;
  return `https://hanamipress.xyz${image}`;
}

// Controlla il carrello e lo riscrive con i dati attendibili
function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new BadRequest('Carrello vuoto');
  if (items.length > MAX_ITEMS) throw new BadRequest('Carrello troppo grande');

  return items.map(raw => {
    const entry = Object.prototype.hasOwnProperty.call(CATALOG, raw && raw.name) ? CATALOG[raw.name] : null;
    if (!entry) throw new BadRequest(`Prodotto non riconosciuto: ${String(raw && raw.name).slice(0, 60)}`);

    const price = Number(raw.price);
    if (!entry.prices.includes(price)) {
      throw new BadRequest(`Prezzo non valido per ${raw.name}`);
    }

    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      throw new BadRequest(`Quantita' non valida per ${raw.name}`);
    }

    return {
      name: raw.name,
      price,
      quantity,
      category: entry.category,
      hand: !!entry.hand,
      image: safeImage(raw.image)
    };
  });
}

// Costo di spedizione calcolato sul server (il valore del browser e' ignorato)
function computeShipping(items, zone) {
  if (zone === 'hand') {
    if (!items.some(i => i.hand)) {
      throw new BadRequest('Consegna a mano non disponibile per questo ordine');
    }
    return SHIPPING.hand;
  }
  if (zone === 'italy') {
    return items.some(i => i.category !== 'zine') ? SHIPPING.italy_other : SHIPPING.italy_zine;
  }
  if (zone === 'eu') return SHIPPING.eu;
  if (zone === 'world') return SHIPPING.world;
  throw new BadRequest('Zona di spedizione non valida');
}

module.exports = async (req, res) => {
  // CORS — permette al sito su GitHub Pages di chiamare questa funzione
  res.setHeader('Access-Control-Allow-Origin', 'https://hanamipress.xyz');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo non permesso' });
  }

  try {
    const { items: rawItems, zone } = req.body || {};

    const items = validateItems(rawItems);
    const shipping = computeShipping(items, zone);

    // Righe per Stripe: nome e prezzo vengono dal catalogo, non dal browser
    const lineItems = items.map(item => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: item.name,
          images: item.image ? [item.image] : []
        },
        unit_amount: Math.round(item.price * 100) // Stripe usa i centesimi
      },
      quantity: item.quantity
    }));

    // Aggiunge la spedizione come riga separata (la consegna a mano costa 0: nessuna riga)
    if (shipping > 0) {
      lineItems.push({
        price_data: {
          currency: 'eur',
          product_data: { name: `Spedizione (${ZONE_LABEL[zone]})` },
          unit_amount: Math.round(shipping * 100)
        },
        quantity: 1
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'paypal'],
      line_items: lineItems,
      mode: 'payment',
      // la zona scelta compare nell'ordine su Stripe (utile per riconoscere le consegne a mano)
      metadata: { zona_spedizione: zone === 'hand' ? 'Consegna a mano' : ZONE_LABEL[zone] },
      success_url: 'https://hanamipress.xyz/successo.html',
      cancel_url: 'https://hanamipress.xyz',
      shipping_address_collection: {
        allowed_countries: ['IT', 'FR', 'DE', 'ES', 'AT', 'NL', 'BE', 'PT', 'US', 'GB']
        // aggiungi/rimuovi i paesi che spedisci
      }
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    if (err instanceof BadRequest) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Errore Stripe:', err);
    return res.status(500).json({ error: 'Errore durante la creazione del checkout' });
  }
};
