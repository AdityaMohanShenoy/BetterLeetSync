// BetterLeetSync - Bulk Sync Feature
// Fetches all solved problems and syncs them to GitHub

const LEETCODE_API = 'https://leetcode.com/graphql';

// Get user's solved problems
async function getSolvedProblems() {
  try {
    // Use the problems API to get solved status
    const response = await fetch('https://leetcode.com/api/problems/all/', {
      credentials: 'include'
    });
    
    const data = await response.json();
    
    if (!data.stat_status_pairs) {
      throw new Error('Could not fetch problems list');
    }
    
    // Filter for solved problems
    const solved = data.stat_status_pairs
      .filter(item => item.status === 'ac') // ac = accepted
      .map(item => ({
        id: item.stat.question_id,
        title: item.stat.question__title,
        titleSlug: item.stat.question__title_slug,
        timestamp: Date.now() // We don't have exact solve time from this API
      }))
      .sort((a, b) => b.id - a.id); // Sort by ID descending (most recent first)
    
    return solved;
  } catch (error) {
    console.error('Error fetching solved problems:', error);
    throw error;
  }
}


// Get problem details and last submission
async function getProblemDetails(titleSlug) {
  const query = `
    query getQuestionDetail($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionId
        title
        titleSlug
        content
        difficulty
        topicTags {
          name
        }
      }
    }
  `;

  const response = await fetch(LEETCODE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { titleSlug }
    })
  });

  const data = await response.json();
  return data.data.question;
}  'Referer': `https://leetcode.com/problems/${titleSlug}/`,
    },
    credentials: 'include',
    body: JSON.stringify({
      query,
      variables: { titleSlug }
    })
  });

  const data = await response.json();
  
  if (data.errors) {
    throw new Error(data.errors[0]?.message || 'Failed to fetch problem details');
  }
  
        limit: $limit
        questionSlug: $questionSlug
      ) {
        submissions {
          id
          statusDisplay
          lang
          timestamp
          runtime
          memory
        }
      }
    }
  `;

  try {
    const response = await fetch(LEETCODE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': `https://leetcode.com/problems/${titleSlug}/`,
      },
      credentials: 'include', // Include cookies for authentication
      body: JSON.stringify({
        query,
        variables: { titleSlug, offset: 0, limit: 20 }
      })
    });

    const data = await response.json();
    
    if (data.errors) {
      console.error('GraphQL errors:', data.errors);
      return null;
    }
    
    const submissions = data.data?.submissionList?.submissions || [];
    
    // Find first accepted submission
    const accepted = submissions.find(s => s.statusDisplay === 'Accepted');
    
    if (!accepted) {
      return null;
    }
    
    // Now get the code for this submission
    const codeResponse = await fetch(`https://leetcode.com/api/submissions/${accepted.id}/`, {
      credentials: 'include'
    });
    
    const codeData = await codeResponse.json();
    
    return {
      id: accepted.id,
      statusDisplay: accepted.statusDisplay,
      lang: codeData.lang || accepted.lang,
      timestamp: accepted.timestamp,
      code: codeData.code || ''
    };
  } catch (error) {
    console.error(`Error fetching submission for ${titleSlug}:`, error);
    return null;
  }
}

// Sync a single problem
async function syncProblem(titleSlug, updateProgress) {
  try {
    updateProgress(`Fetching ${titleSlug}...`);
    
    const [problemDetails, submission] = await Promise.all([
      getProblemDetails(titleSlug),
      getLastSubmission(titleSlug)
    ]);

    if (!submission || !submission.code) {
      throw new Error('No accepted submission found');
    }

    // Prepare sync data
    const syncData = {
      slug: problemDetails.titleSlug,
      title: problemDetails.title,
      difficulty: problemDetails.difficulty,
      topics: problemDetails.topicTags.map(t => t.name),
      description_html: problemDetails.content,
      code: submission.code,
      language: submission.lang,
      source_url: `https://leetcode.com/problems/${titleSlug}/`
    };

    // Send to backend
    const settings = await chrome.storage.sync.get(['backendUrl', 'hmacSecret']);
    const backendUrl = settings.backendUrl || 'http://localhost:3456';
    const hmacSecret = settings.hmacSecret || '';

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify(syncData);
    const signature = await generateSignature(hmacSecret, timestamp, body);

    const response = await fetch(`${backendUrl}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Timestamp': timestamp,
        'X-Signature': signature
      },
      body: body
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Sync failed');
    }

    return { success: true, title: problemDetails.title };
  } catch (error) {
    return { success: false, title: titleSlug, error: error.message };
  }
}

// Generate HMAC signature
async function generateSignature(secret, timestamp, body) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(timestamp + '.' + body);
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Main bulk sync function
async function startBulkSync(onProgress, onComplete) {
  try {
    onProgress('Fetching your solved problems...');
    
    const solvedProblems = await getSolvedProblems();
    const total = solvedProblems.length;
    
    if (total === 0) {
      onComplete({ success: true, synced: 0, failed: 0, errors: [] });
      return;
    }

    onProgress(`Found ${total} solved problems. Starting sync...`);

    const results = {
      synced: 0,
      failed: 0,
      errors: []
    };

    // Sync problems in batches to avoid rate limiting
    const batchSize = 5;
    for (let i = 0; i < solvedProblems.length; i += batchSize) {
      const batch = solvedProblems.slice(i, i + batchSize);
      
      const batchResults = await Promise.all(
        batch.map(problem => 
          syncProblem(problem.titleSlug, (msg) => {
            onProgress(`[${i + 1}/${total}] ${msg}`);
          })
        )
      );

      batchResults.forEach(result => {
        if (result.success) {
          results.synced++;
          onProgress(`✓ Synced: ${result.title}`);
        } else {
          results.failed++;
          results.errors.push({ title: result.title, error: result.error });
          onProgress(`✗ Failed: ${result.title} - ${result.error}`);
        }
      });

      // Wait between batches to avoid rate limiting
      if (i + batchSize < solvedProblems.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    onComplete(results);
  } catch (error) {
    onComplete({ success: false, error: error.message });
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { startBulkSync };
}
