// Vercel serverless function: Create WaveApps invoice for selected package
// Uses environment variables for credentials/config.
// Returns a paymentUrl when available, otherwise a safe fallback demo link.

const WAVE_GRAPHQL_ENDPOINT = 'https://gql.waveapps.com/graphql/public';

// Package catalog with canonical pricing (server-authoritative)
const PACKAGE_CATALOG = {
  core: { name: 'Core System Package', price: 5000 },
  growth: { name: 'Growth Accelerator Package', price: 7500 },
  full: { name: 'Full Ecosystem Package', price: 10000 }
};

/**
 * Helper: standard JSON response
 */
function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

/**
 * Helper: call Wave GraphQL
 */
async function waveQuery(query, variables) {
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
    const err = new Error(`Wave GraphQL error: ${msg}`);
    err.waveErrors = body.errors || null;
    throw err;
  }
  return body.data;
}

/**
 * Create or ensure a Wave customer exists. Returns customerId.
 * This implementation creates a new customer each time to avoid lookup complexity.
 */
async function createCustomer({ businessId, clientName, clientEmail }) {
  const mutation = `
    mutation CreateCustomer($input: CustomerCreateInput!) {
      customerCreate(input: $input) {
        didSucceed
        inputErrors { code message }
        customer { id }
      }
    }
  `;
  const variables = {
    input: {
      businessId,
      name: clientName,
      firstName: clientName,
      lastName: 'Client',
      email: clientEmail
    }
  };
  const data = await waveQuery(mutation, variables);
  const res = data.customerCreate;
  if (!res || !res.didSucceed || !res.customer) {
    const firstErr = res && res.inputErrors && res.inputErrors[0];
    throw new Error(`Create customer failed: ${firstErr ? firstErr.message : 'Unknown error'}`);
  }
  return res.customer.id;
}

/**
 * Create an invoice for the 50% deposit on the selected package.
 * Returns invoice id and (if available) a public URL.
 */
async function createInvoice({ businessId, customerId, currency, packageKey, contractId }) {
  const pkg = PACKAGE_CATALOG[packageKey];
  if (!pkg) {
    throw new Error('Unknown package key');
  }
  const deposit = Math.round(pkg.price * 0.5 * 100) / 100; // cents-safe

  // Provide explicit dates; some Wave accounts require these
  const today = new Date();
  const invoiceDate = today.toISOString().slice(0, 10); // YYYY-MM-DD
  const dueDate = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // +14 days

  // Wave requires a productId for each line item; prefer per-package envs
  const productIdMap = {
    core: process.env.WAVE_PRODUCT_ID_CORE,
    growth: process.env.WAVE_PRODUCT_ID_GROWTH,
    full: process.env.WAVE_PRODUCT_ID_FULL
  };
  const productId = productIdMap[packageKey] || process.env.WAVE_PRODUCT_ID || '';
  if (!productId) {
    const err = new Error('Missing WAVE_PRODUCT_ID');
    err.waveErrors = [{ message: 'Set WAVE_PRODUCT_ID_<PACKAGE> (CORE/GROWTH/FULL) or WAVE_PRODUCT_ID to a valid Product ID in your Wave business.' }];
    throw err;
  }

  const mutation = `
    mutation InvoiceCreate($input: InvoiceCreateInput!) {
      invoiceCreate(input: $input) {
        didSucceed
        inputErrors { code message }
        invoice { id status viewUrl }
      }
    }
  `;

  // Note: Wave expects unitPrice as Money input; depending on schema versions you may need minor tweaks.
  const variables = {
    input: {
      businessId,
      customerId,
      currency,
      status: 'DRAFT',
      invoiceDate,
      dueDate,
      memo: `Contract ${contractId} • ${pkg.name} – Initial 50% deposit`,
      items: [
        {
          productId,
          description: `${pkg.name} — Initial Deposit (50%)`,
          // unitPrice expects Decimal (string), not Money object
          unitPrice: String(deposit),
          quantity: 1
        }
      ]
    }
  };

  const data = await waveQuery(mutation, variables);
  const res = data.invoiceCreate;
  if (!res || !res.didSucceed || !res.invoice) {
    const firstErr = res && res.inputErrors && res.inputErrors[0];
    throw new Error(`Create invoice failed: ${firstErr ? firstErr.message : 'Unknown error'}`);
  }

  return {
    invoiceId: res.invoice.id,
    // prefer viewUrl when available (some schemas do not expose publicUrl)
    viewUrl: res.invoice.viewUrl || null
  };
}

// Try to send the invoice to generate a public URL if needed
async function sendInvoice({ invoiceId }) {
  const mutation = `
    mutation InvoiceSend($input: InvoiceSendInput!) {
      invoiceSend(input: $input) {
        didSucceed
        inputErrors { code message }
        invoice { id viewUrl }
      }
    }
  `;
  const variables = { input: { invoiceId } };
  const data = await waveQuery(mutation, variables);
  const res = data.invoiceSend;
  if (!res || !res.didSucceed || !res.invoice) {
    const firstErr = res && res.inputErrors && res.inputErrors[0];
    throw new Error(`Send invoice failed: ${firstErr ? firstErr.message : 'Unknown error'}`);
  }
  return res.invoice.viewUrl || null;
}

// Approve a draft invoice so it becomes visible to the customer
async function approveInvoice({ invoiceId }) {
  const mutation = `
    mutation InvoiceApprove($input: InvoiceApproveInput!) {
      invoiceApprove(input: $input) {
        didSucceed
        inputErrors { code message }
        invoice { id status }
      }
    }
  `;
  const variables = { input: { invoiceId } };
  const data = await waveQuery(mutation, variables);
  const res = data.invoiceApprove;
  if (!res || !res.didSucceed || !res.invoice) {
    const firstErr = res && res.inputErrors && res.inputErrors[0];
    throw new Error(`Approve invoice failed: ${firstErr ? firstErr.message : 'Unknown error'}`);
  }
  return res.invoice.status;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return json(res, 405, { error: 'Method not allowed' });
    }

    const { contractData, invoice } = req.body || {};
    if (!contractData || !invoice || !invoice.packageKey) {
      return json(res, 400, { error: 'Missing contractData or invoice.packageKey' });
    }

    // Env configuration
    const apiKey = process.env.WAVE_API_KEY || '';
    const businessId = process.env.WAVE_BUSINESS_ID || '';
    const currency = process.env.WAVE_CURRENCY || 'USD';

    // If not configured, return a safe demo link so the UI still works
    if (!apiKey || !businessId) {
      return json(res, 200, {
        mode: 'demo',
        paymentUrl: 'https://link.waveapps.com/payment-demo',
        note: 'WaveApps environment variables not set. Returning demo link.'
      });
    }

    // Create customer, then invoice
    const customerId = await createCustomer({
      businessId,
      clientName: contractData.clientName,
      clientEmail: contractData.clientEmail
    });

    const { invoiceId, viewUrl } = await createInvoice({
      businessId,
      customerId,
      currency,
      packageKey: invoice.packageKey,
      contractId: contractData.contractId
    });

    // Always try to approve and send so status is not Draft, regardless of viewUrl presence
    let paymentUrl = viewUrl || null;
    try {
      await approveInvoice({ invoiceId });
    } catch (e) {
      // non-fatal; continue
    }
    try {
      const sentUrl = await sendInvoice({ invoiceId });
      if (sentUrl) paymentUrl = sentUrl;
    } catch (e) {
      // non-fatal; keep existing paymentUrl (may be viewUrl)
    }

    // Best effort return of a link the client can use
    return json(res, 200, {
      mode: 'live',
      invoiceId,
      paymentUrl: paymentUrl || null
    });
  } catch (error) {
    console.error('Wave invoice error:', error);
    // Fall back to demo link so UX continues
    return json(res, 200, {
      mode: 'fallback',
      paymentUrl: 'https://link.waveapps.com/payment-demo',
      error: error.message || 'Unknown error',
      errorDetails: error.waveErrors || null
    });
  }
};


