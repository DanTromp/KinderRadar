export const UPDATE_STATUSES = new Set(['new', 'needs_review', 'accepted', 'rejected', 'applied']);

export function compact(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || fallback;
}

export function escapeHtml(value) {
  return compact(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function payload(update) {
  return update?.payload && typeof update.payload === 'object' ? update.payload : {};
}

export function subjectForUpdate(update) {
  const data = payload(update);
  if (data.type === 'digest_signup') {
    return `Digest signup: ${compact(data.cityName || data.citySlug, 'unknown area')}`;
  }
  return compact(update?.activity_slug || data.activityName, '(missing activity name)');
}

export function townForUpdate(update) {
  const data = payload(update);
  return compact(data.town || data.cityName);
}

export function suggestedAction(update) {
  if (payload(update).type === 'digest_signup') {
    return 'Add to the digest audience list, then mark applied.';
  }
  switch (update?.update_type) {
    case 'submission':
      return 'Verify source, add activity data, then mark accepted/applied.';
    case 'update':
      return 'Compare evidence with current listing, update changed fields, then mark applied.';
    case 'closed':
      return 'Confirm closure from evidence or organizer, then set activity status to reported-closed.';
    case 'confirm':
      return 'Bump lastVerified; if organizer-confirmed, consider verifiedBy: organizer.';
    case 'claim':
      return 'Verify organizer identity before changing verifiedBy or contact details.';
    default:
      return 'Review evidence and decide whether to accept, reject, or request more detail.';
  }
}

export function describeUpdate(update) {
  const data = payload(update);
  const evidence = compact(update?.evidence_url || data.evidenceUrl || data.sourceUrl, 'none');
  const notes = compact(data.notes, 'none');
  const town = townForUpdate(update);
  const townText = town ? `, ${town}` : '';
  return [
    `[${compact(update?.update_type, 'unknown')}] ${subjectForUpdate(update)}${townText}`,
    `  id: ${compact(update?.id, 'unknown')}`,
    `  status: ${compact(update?.status, 'unknown')}`,
    `  created: ${compact(update?.created_at, 'unknown')}`,
    `  evidence: ${evidence}`,
    `  notes: ${notes}`,
    `  action: ${suggestedAction(update)}`,
  ].join('\n');
}

export function renderMarkdown(updates, { status = 'new' } = {}) {
  const lines = [
    `# My Kids Radar Review Queue`,
    '',
    `Status: \`${status}\``,
    `Updates: ${updates.length}`,
    '',
  ];

  if (updates.length === 0) {
    lines.push('No updates found.');
    return `${lines.join('\n')}\n`;
  }

  for (const update of updates) {
    const data = payload(update);
    lines.push(
      `## ${subjectForUpdate(update)}`,
      '',
      `- Type: \`${compact(update.update_type, 'unknown')}\``,
      `- Status: \`${compact(update.status, 'unknown')}\``,
      `- ID: \`${compact(update.id, 'unknown')}\``,
      `- Town: ${townForUpdate(update) || 'not provided'}`,
      `- Created: ${compact(update.created_at, 'unknown')}`,
      `- Evidence: ${compact(update.evidence_url || data.evidenceUrl || data.sourceUrl, 'none')}`,
      `- Reporter email: ${compact(update.reporter_email, 'not provided')}`,
      `- Suggested action: ${suggestedAction(update)}`,
      '',
      `Notes: ${compact(data.notes, 'none')}`,
      '',
      `Command examples:`,
      '',
      '```bash',
      `npm run supabase:update-status -- --id=${compact(update.id, '<id>')} --status=needs_review`,
      `npm run supabase:update-status -- --id=${compact(update.id, '<id>')} --status=applied`,
      '```',
      '',
    );
  }

  return `${lines.join('\n')}\n`;
}

export function renderHtml(updates, { status = 'new' } = {}) {
  const cards = updates.length
    ? updates.map((update) => {
      const data = payload(update);
      const evidence = compact(update.evidence_url || data.evidenceUrl || data.sourceUrl, 'none');
      const command = `npm run supabase:update-status -- --id=${compact(update.id, '<id>')} --status=needs_review`;
      return `      <article class="card">
        <div class="card-head">
          <span>${escapeHtml(update.update_type ?? 'unknown')}</span>
          <strong>${escapeHtml(subjectForUpdate(update))}</strong>
        </div>
        <dl>
          <dt>ID</dt><dd><code>${escapeHtml(update.id ?? 'unknown')}</code></dd>
          <dt>Status</dt><dd>${escapeHtml(update.status ?? 'unknown')}</dd>
          <dt>Town</dt><dd>${escapeHtml(townForUpdate(update) || 'not provided')}</dd>
          <dt>Created</dt><dd>${escapeHtml(update.created_at ?? 'unknown')}</dd>
          <dt>Evidence</dt><dd>${evidence.startsWith('http') ? `<a href="${escapeHtml(evidence)}">${escapeHtml(evidence)}</a>` : escapeHtml(evidence)}</dd>
          <dt>Email</dt><dd>${escapeHtml(update.reporter_email ?? 'not provided')}</dd>
        </dl>
        <p>${escapeHtml(compact(data.notes, 'No notes provided.'))}</p>
        <p class="action">${escapeHtml(suggestedAction(update))}</p>
        <code>${escapeHtml(command)}</code>
      </article>`;
    }).join('\n')
    : '      <p class="empty">No updates found.</p>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My Kids Radar Review Queue</title>
    <style>
      body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: #172033; background: #f8f2e7; }
      main { width: min(1120px, calc(100% - 2rem)); margin: 2rem auto; }
      h1 { margin-bottom: 0.2rem; }
      .meta { color: #5d6a80; margin-top: 0; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
      .card { border: 1px solid #d6dce5; border-radius: 8px; background: #fff; padding: 1rem; box-shadow: 0 12px 35px rgba(23,32,51,.08); }
      .card-head { display: grid; gap: .2rem; margin-bottom: .8rem; }
      .card-head span { color: #f05f4f; font-weight: 700; font-size: .8rem; text-transform: uppercase; }
      .card-head strong { font-size: 1.1rem; }
      dl { display: grid; grid-template-columns: max-content 1fr; gap: .35rem .7rem; }
      dt { color: #5d6a80; font-weight: 700; }
      dd { margin: 0; overflow-wrap: anywhere; }
      code { display: inline-block; max-width: 100%; overflow-wrap: anywhere; background: #eef7fb; border: 1px solid #d6dce5; border-radius: 6px; padding: .15rem .35rem; }
      .action { border-left: 3px solid #f05f4f; padding-left: .65rem; font-weight: 650; }
      .empty { border: 1px solid #d6dce5; border-radius: 8px; background: #fff; padding: 1rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>My Kids Radar Review Queue</h1>
      <p class="meta">Status: ${escapeHtml(status)} · Updates: ${updates.length}</p>
      <section class="grid">
${cards}
      </section>
    </main>
  </body>
</html>
`;
}
