// Bulk Sync - Injected into LeetCode page
(async function() {
  'use strict';

  // Prevent multiple injections
  if (window.__betterLeetSyncBulkRunning) {
    alert('Bulk sync is already running!');
    return;
  }
  window.__betterLeetSyncBulkRunning = true;

  const LEETCODE_API = 'https://leetcode.com/graphql';

  // Create floating UI
  function createUI() {
    const container = document.createElement('div');
    container.id = 'bls-bulk-sync-ui';
    container.innerHTML = `
      <style>
        #bls-bulk-sync-ui {
          position: fixed;
          bottom: 20px;
          right: 20px;
          width: 400px;
          max-height: 500px;
          background: #1a1a1a;
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: white;
          overflow: hidden;
        }
        #bls-header {
          background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
          padding: 15px 20px;
          border-bottom: 2px solid #FFA116;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        #bls-header h3 {
          margin: 0;
          color: #FFA116;
          font-size: 16px;
        }
        #bls-close {
          background: none;
          border: none;
          color: #999;
          font-size: 20px;
          cursor: pointer;
        }
        #bls-close:hover { color: #fff; }
        #bls-content {
          padding: 15px 20px;
          max-height: 400px;
          overflow-y: auto;
        }
        #bls-progress {
          margin-bottom: 15px;
        }
        #bls-progress-bar {
          width: 100%;
          height: 6px;
          background: #333;
          border-radius: 3px;
          overflow: hidden;
          margin-bottom: 10px;
        }
        #bls-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #FFA116, #FFB84D);
          width: 0%;
          transition: width 0.3s ease;
        }
        #bls-status {
          color: #FFA116;
          font-size: 13px;
          font-weight: 500;
        }
        #bls-log {
          background: #0d0d0d;
          border-radius: 6px;
          padding: 10px;
          font-family: monospace;
          font-size: 11px;
          max-height: 250px;
          overflow-y: auto;
        }
        .bls-log-entry { margin: 4px 0; line-height: 1.4; }
        .bls-success { color: #00b8a3; }
        .bls-error { color: #ef4743; }
        .bls-info { color: #ccc; }
        #bls-summary {
          margin-top: 15px;
          padding: 15px;
          background: rgba(0, 184, 163, 0.1);
          border-radius: 8px;
          border: 1px solid #00b8a3;
          display: none;
        }
        #bls-summary h4 { color: #00b8a3; margin: 0 0 10px 0; }
        .bls-stats { display: flex; gap: 20px; }
        .bls-stat { text-align: center; }
        .bls-stat-value { font-size: 24px; font-weight: 700; color: #FFA116; }
        .bls-stat-label { font-size: 11px; color: #999; text-transform: uppercase; }
      </style>
      <div id="bls-header">
        <h3>BetterLeetSync - Bulk Sync</h3>
        <button id="bls-close">&times;</button>
      </div>
      <div id="bls-content">
        <div id="bls-progress">
          <div id="bls-progress-bar"><div id="bls-progress-fill"></div></div>
          <div id="bls-status">Initializing...</div>
        </div>
        <div id="bls-log"></div>
        <div id="bls-summary">
          <h4>Sync Complete!</h4>
          <div class="bls-stats">
            <div class="bls-stat">
              <div class="bls-stat-value" id="bls-synced">0</div>
              <div class="bls-stat-label">Synced</div>
            </div>
            <div class="bls-stat">
              <div class="bls-stat-value" id="bls-failed">0</div>
              <div class="bls-stat-label">Failed</div>
            </div>
            <div class="bls-stat">
              <div class="bls-stat-value" id="bls-total">0</div>
              <div class="bls-stat-label">Total</div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    document.getElementById('bls-close').addEventListener('click', () => {
      container.remove();
      window.__betterLeetSyncBulkRunning = false;
    });

    return {
      updateProgress: (percent, text) => {
        document.getElementById('bls-progress-fill').style.width = `${percent}%`;
        document.getElementById('bls-status').textContent = text;
      },
      addLog: (message, type = 'info') => {
        const log = document.getElementById('bls-log');
        const entry = document.createElement('div');
        entry.className = `bls-log-entry bls-${type}`;
        entry.textContent = message;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
      },
      showSummary: (synced, failed) => {
        document.getElementById('bls-synced').textContent = synced;
        document.getElementById('bls-failed').textContent = failed;
        document.getElementById('bls-total').textContent = synced + failed;
        document.getElementById('bls-summary').style.display = 'block';
      }
    };
  }

  // Generate HMAC signature
  async function generateSignature(secret, timestamp, body) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(timestamp + '.' + body);
    
    const key = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', key, messageData);
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Get solved problems
  async function getSolvedProblems() {
    const response = await fetch('https://leetcode.com/api/problems/all/', {
      credentials: 'include'
    });
    const data = await response.json();
    
    if (!data.stat_status_pairs) {
      throw new Error('Could not fetch problems. Make sure you are logged in.');
    }
    
    return data.stat_status_pairs
      .filter(item => item.status === 'ac')
      .map(item => ({
        id: item.stat.question_id,
        title: item.stat.question__title,
        titleSlug: item.stat.question__title_slug
      }))
      .sort((a, b) => a.id - b.id);
  }

  // Get problem details
  async function getProblemDetails(titleSlug) {
    const query = `
      query getQuestionDetail($titleSlug: String!) {
        question(titleSlug: $titleSlug) {
          questionId
          title
          titleSlug
          content
          difficulty
          topicTags { name }
        }
      }
    `;

    const response = await fetch(LEETCODE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ query, variables: { titleSlug } })
    });

    const data = await response.json();
    return data.data?.question;
  }

  // Get last accepted submission
  async function getLastSubmission(titleSlug) {
    try {
      // Use the submissions API directly
      const response = await fetch(`https://leetcode.com/api/submissions/?offset=0&limit=20&lastkey=&question_slug=${titleSlug}`, {
        credentials: 'include'
      });

      if (!response.ok) {
        console.error(`Submissions API failed for ${titleSlug}:`, response.status);
        return null;
      }

      const data = await response.json();
      const submissions = data.submissions_dump || [];
      
      console.log(`Found ${submissions.length} submissions for ${titleSlug}`);
      
      // Find first accepted submission
      const accepted = submissions.find(s => s.status_display === 'Accepted');
      
      if (!accepted) {
        console.log(`No accepted submission found for ${titleSlug}`);
        return null;
      }

      console.log('Accepted submission:', accepted);

      // The submissions list doesn't include full code - need to fetch submission details
      // The submission ID is in the 'id' field
      if (!accepted.id) {
        console.log('No submission ID found');
        return null;
      }

      // Fetch the full submission details with code
      const detailResponse = await fetch(`https://leetcode.com/submissions/detail/${accepted.id}/`, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!detailResponse.ok) {
        // Try alternative: use the code from accepted if it exists
        if (accepted.code) {
          return { lang: accepted.lang, code: accepted.code };
        }
        console.error(`Submission detail fetch failed for ${accepted.id}:`, detailResponse.status);
        return null;
      }

      // Check if response is JSON
      const contentType = detailResponse.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const detailData = await detailResponse.json();
        return { 
          lang: detailData.lang || accepted.lang, 
          code: detailData.code 
        };
      }

      // If HTML returned, try to extract code from accepted object or page
      // Some submissions include code directly
      if (accepted.code) {
        return { lang: accepted.lang, code: accepted.code };
      }

      // Parse HTML to extract code
      const html = await detailResponse.text();
      const codeMatch = html.match(/submissionCode:\s*'([^']+)'/);
      if (codeMatch) {
        const code = codeMatch[1]
          .replace(/\\u[\dA-Fa-f]{4}/g, m => String.fromCharCode(parseInt(m.slice(2), 16)))
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\'/g, "'")
          .replace(/\\\\/g, '\\');
        return { lang: accepted.lang, code };
      }

      console.log('Could not extract code from submission detail');
      return null;
    } catch (error) {
      console.error(`Error fetching submission for ${titleSlug}:`, error);
      return null;
    }
  }

  // Sync single problem
  async function syncProblem(titleSlug, settings, ui) {
    ui.addLog(`  Fetching details for ${titleSlug}...`, 'info');
    
    const details = await getProblemDetails(titleSlug);
    if (!details) throw new Error('Could not fetch problem details');
    
    ui.addLog(`  Fetching submission for ${titleSlug}...`, 'info');
    
    const submission = await getLastSubmission(titleSlug);
    if (!submission || !submission.code) {
      throw new Error('No accepted submission with code found');
    }
    
    ui.addLog(`  Found code (${submission.code.length} chars), syncing...`, 'info');

    const syncData = {
      slug: details.titleSlug,
      title: details.title,
      difficulty: details.difficulty,
      topics: details.topicTags.map(t => t.name),
      description_html: details.content,
      code: submission.code,
      language: submission.lang,
      source_url: `https://leetcode.com/problems/${titleSlug}/`
    };

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify(syncData);
    const signature = await generateSignature(settings.hmacSecret, timestamp, body);

    const response = await fetch(`${settings.backendUrl}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Timestamp': timestamp,
        'X-Signature': signature
      },
      body
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Sync failed');
    }

    return details.title;
  }

  // Main function
  async function main() {
    const ui = createUI();
    
    try {
      // Get settings from extension storage
      const settings = await new Promise(resolve => {
        chrome.storage.sync.get({
          backendUrl: 'http://localhost:3456',
          hmacSecret: ''
        }, resolve);
      });

      if (!settings.hmacSecret) {
        throw new Error('HMAC secret not configured. Please set it in extension options.');
      }

      ui.addLog('Fetching solved problems...', 'info');
      const problems = await getSolvedProblems();
      
      if (problems.length === 0) {
        ui.addLog('No solved problems found.', 'info');
        ui.showSummary(0, 0);
        return;
      }

      ui.addLog(`Found ${problems.length} solved problems`, 'info');
      ui.updateProgress(0, `Starting sync of ${problems.length} problems...`);

      let synced = 0, failed = 0;

      for (let i = 0; i < problems.length; i++) {
        const problem = problems[i];
        const progress = Math.round((i / problems.length) * 100);
        ui.updateProgress(progress, `[${i + 1}/${problems.length}] Processing ${problem.titleSlug}...`);

        try {
          const title = await syncProblem(problem.titleSlug, settings, ui);
          synced++;
          ui.addLog(`✓ ${title}`, 'success');
        } catch (error) {
          failed++;
          ui.addLog(`✗ ${problem.title}: ${error.message}`, 'error');
        }

        // Rate limiting
        if (i < problems.length - 1) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      ui.updateProgress(100, 'Complete!');
      ui.showSummary(synced, failed);
      ui.addLog(`\nBulk sync finished! Synced: ${synced}, Failed: ${failed}`, synced > 0 ? 'success' : 'info');

    } catch (error) {
      ui.addLog(`Error: ${error.message}`, 'error');
    } finally {
      window.__betterLeetSyncBulkRunning = false;
    }
  }

  main();
})();
