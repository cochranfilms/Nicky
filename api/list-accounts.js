// List Wave accounts for your business (to find Income account IDs)
// GET /api/list-accounts

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
      query Accounts($id: ID!) {
        business(id: $id) {
          id
          name
          accounts {
            edges {
              node {
                id
                name
                type
                subtype
              }
            }
          }
        }
      }
    `;
    const data = await waveQuery(query, { id: businessId });
    const accounts = (data.business && data.business.accounts && data.business.accounts.edges) || [];
    return json(res, 200, {
      business: { id: data.business.id, name: data.business.name },
      count: accounts.length,
      accounts: accounts.map(e => e.node)
    });
  } catch (error) {
    return json(res, 200, { error: error.message || 'Unknown error' });
  }
};


