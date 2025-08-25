// List Wave products (services) for your business to get their IDs
// GET /api/list-products

const WAVE_GRAPHQL_ENDPOINT = 'https://gql.waveapps.com/graphql/public';

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

async function waveQuery(query, variables) {
  const apiKey = process.env.WAVE_API_KEY;
  if (!apiKey) throw new Error('Missing WAVE_API_KEY');
  const resp = await fetch(WAVE_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ query, variables })
  });
  const body = await resp.json();
  if (!resp.ok || body.errors) {
    const msg = body.errors ? JSON.stringify(body.errors) : resp.statusText;
    throw new Error(`Wave GraphQL error: ${msg}`);
  }
  return body.data;
}

module.exports = async (req, res) => {
  try {
    const businessId = process.env.WAVE_BUSINESS_ID || '';
    if (!businessId) {
      return json(res, 200, { error: 'Missing WAVE_BUSINESS_ID' });
    }

    const query = `
      query Products($id: ID!) {
        business(id: $id) {
          id
          name
          products {
            edges {
              node { id name }
            }
          }
        }
      }
    `;
    const data = await waveQuery(query, { id: businessId });
    const edges = (data.business && data.business.products && data.business.products.edges) || [];
    const all = edges.map(e => e.node);
    const q = (req.query && req.query.q) ? String(req.query.q).toLowerCase() : '';
    const filtered = q ? all.filter(p => (p.name || '').toLowerCase().includes(q)) : all;
    return json(res, 200, {
      business: { id: data.business.id, name: data.business.name },
      count: filtered.length,
      products: filtered
    });
  } catch (error) {
    return json(res, 200, { error: error.message || 'Unknown error' });
  }
};


