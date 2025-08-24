// Vercel serverless function: Upload signed contract PDF to GitHub /contracts
// Requires env vars: GITHUB_TOKEN, GITHUB_REPO (owner/repo), GITHUB_BRANCH (default: main)

/**
 * JSON response helper
 */
function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

async function putFileToGitHub(path, base64Content, message) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token || !repo) {
    throw new Error('Missing GITHUB_TOKEN or GITHUB_REPO');
  }

  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const body = {
    message: message || `Add ${path}`,
    content: base64Content,
    branch
  };

  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json'
    },
    body: JSON.stringify(body)
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data && data.message ? data.message : 'GitHub upload failed');
  }

  const downloadUrl = data && data.content && data.content.download_url
    ? data.content.download_url
    : `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;

  return { sha: data.content && data.content.sha, downloadUrl };
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return json(res, 405, { error: 'Method not allowed' });
    }

    const { filename, content, contractData } = req.body || {};
    if (!filename || !content) {
      return json(res, 400, { error: 'Missing filename or content' });
    }

    const safeFile = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `contracts/${safeFile}`;
    const message = `chore(contracts): add signed contract ${contractData && contractData.contractId ? contractData.contractId : ''}`.trim();

    const result = await putFileToGitHub(path, content, message);
    return json(res, 200, { downloadUrl: result.downloadUrl, sha: result.sha });
  } catch (err) {
    console.error('Upload contract error:', err);
    return json(res, 500, { error: err.message || 'Upload failed' });
  }
};


