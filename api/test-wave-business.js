// Test script to get your correct WaveApps Business ID
// Run this once to find your business ID, then update your environment variables

const WAVE_GRAPHQL_ENDPOINT = 'https://gql.waveapps.com/graphql/public';

async function waveQuery(query, variables = {}) {
  const apiKey = process.env.WAVE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing WAVE_API_KEY');
  }
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

async function getBusinesses() {
  const query = `
    query {
      businesses {
        edges {
          node {
            id
            name
            isClassicAccounting
            isClassicInvoicing
          }
        }
      }
    }
  `;
  const data = await waveQuery(query);
  return data.businesses.edges.map(edge => edge.node);
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

module.exports = async (req, res) => {
  try {
    const businesses = await getBusinesses();
    console.log('Available businesses:', businesses);
    return json(res, 200, { businesses });
  } catch (error) {
    console.error('Error getting businesses:', error);
    return json(res, 500, { error: error.message });
  }
};
