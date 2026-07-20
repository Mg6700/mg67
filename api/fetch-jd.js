// api/fetch-jd.js
// Fetches a job posting URL server-side (avoids browser CORS blocks) and
// strips it down to plain text so it can be dropped straight into the
// existing JD analysis flow.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'No URL provided' });
  }

  let parsed;
  try {
    parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('bad protocol');
    }
  } catch {
    return res.status(400).json({ error: 'That does not look like a valid URL' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // A normal-looking browser UA — some job boards 403 bare fetches.
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(200).json({
        error: `The site returned an error (status ${response.status}). This page may block automated access — try copy-pasting the JD text instead.`,
      });
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text')) {
      return res.status(200).json({
        error: 'That link did not return a readable page — try copy-pasting the JD text instead.',
      });
    }

    const html = await response.text();
    const text = extractReadableText(html);

    if (!text || text.length < 80) {
      return res.status(200).json({
        error:
          'Could not find enough readable text on that page (it may need a login, like LinkedIn). Please copy-paste the JD text instead.',
      });
    }

    return res.status(200).json({ text: text.slice(0, 12000) });
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return res.status(200).json({
      error: timedOut
        ? 'That page took too long to load. Try copy-pasting the JD text instead.'
        : 'Could not fetch that link — the site may block automated access. Try copy-pasting the JD text instead.',
    });
  }
}

function extractReadableText(html) {
  let s = html;

  // Drop non-content blocks entirely.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');

  // Turn block-level closings into line breaks so paragraphs don't run together.
  s = s.replace(/<\/(p|div|li|br|h[1-6]|tr|section|article)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');

  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, ' ');

  // Decode a handful of common entities.
  const entities = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&quot;': '"', '&#39;': "'", '&rsquo;': '\u2019', '&mdash;': '\u2014',
    '&ndash;': '\u2013', '&hellip;': '\u2026',
  };
  s = s.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&rsquo;|&mdash;|&ndash;|&hellip;/g, m => entities[m]);

  // Collapse whitespace.
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n\s*\n+/g, '\n\n');
  s = s.split('\n').map(line => line.trim()).filter(Boolean).join('\n');

  return s.trim();
}
