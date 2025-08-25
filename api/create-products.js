// Vercel serverless function: Create Wave Products for our three packages
// Returns created product IDs so you can set them as environment variables.

const WAVE_GRAPHQL_ENDPOINT = 'https://gql.waveapps.com/graphql/public';

const PACKAGES = {
  core: { name: 'Core System Package', description: 'Core web + booking + analytics foundation', price: 5000 },
  growth: { name: 'Growth Accelerator Package', description: 'Adds learning hub, resources, community, automation', price: 7500 },
  full: { name: 'Full Ecosystem Package', description: 'Complete system with dashboard, portal, workflows, advanced analytics', price: 10000 }
};

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

async function waveQuery(query, variables) {
  const apiKey = process.env.WAVE_API_KEY;
  if (!apiKey) {
    const err = new Error('Missing WAVE_API_KEY');
    err.waveErrors = [{ message: 'Set WAVE_API_KEY in your deployment environment.' }];
    throw err;
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
    const error = new Error(`Wave GraphQL error: ${msg}`);
    error.waveErrors = body.errors || null;
    throw error;
  }
  return body.data;
}

async function createProduct({ businessId, name, description }) {
  const mutation = `
    mutation ProductCreate($input: ProductCreateInput!) {
      productCreate(input: $input) {
        didSucceed
        inputErrors { code message path }
        product { id name }
      }
    }
  `;
  // Keep input minimal; many schemas allow creating without price; line items will set unitPrice.
  const variables = {
    input: {
      businessId,
      name,
      description,
      isSold: true
    }
  };
  const data = await waveQuery(mutation, variables);
  const res = data.productCreate;
  if (!res || !res.didSucceed || !res.product) {
    const firstErr = res && res.inputErrors && res.inputErrors[0];
    const msg = firstErr ? firstErr.message : 'Unknown error creating product';
    const error = new Error(msg);
    error.waveErrors = res && res.inputErrors ? res.inputErrors : null;
    throw error;
  }
  return res.product;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return json(res, 405, { error: 'Method not allowed' });
    }

    const businessId = process.env.WAVE_BUSINESS_ID || '';
    if (!businessId) {
      return json(res, 200, {
        error: 'Missing WAVE_BUSINESS_ID',
        note: 'Set WAVE_BUSINESS_ID, then re-run to create products.'
      });
    }

    const results = {};
    const errors = {};
    for (const key of Object.keys(PACKAGES)) {
      const { name, description } = PACKAGES[key];
      try {
        const prod = await createProduct({ businessId, name, description });
        results[key] = prod;
      } catch (e) {
        errors[key] = { message: e.message, details: e.waveErrors || null };
      }
    }

    return json(res, 200, {
      didSucceed: Object.keys(errors).length === 0,
      products: results,
      errors,
      envHints: {
        WAVE_PRODUCT_ID_CORE: results.core && results.core.id,
        WAVE_PRODUCT_ID_GROWTH: results.growth && results.growth.id,
        WAVE_PRODUCT_ID_FULL: results.full && results.full.id
      }
    });
  } catch (error) {
    console.error('Create products error:', error);
    return json(res, 200, {
      error: error.message || 'Unknown error',
      errorDetails: error.waveErrors || null
    });
  }
};


