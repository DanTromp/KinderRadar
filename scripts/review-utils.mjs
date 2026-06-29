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

function firstNonEmpty(...values) {
  for (const value of values) {
    const next = compact(value);
    if (next) return next;
  }
  return '';
}

export function subjectForUpdate(update) {
  const data = payload(update);
  if (data.type === 'digest_signup') {
    return `Digest signup: ${compact(data.cityName || data.citySlug, 'unknown area')}`;
  }
  if (update?.update_type === 'organizer_claim') {
    return `Organizer claim: ${compact(data.organizerName || data.organizerId, 'unknown organizer')}`;
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
    case 'organizer_claim':
      return 'Verify claimant identity, then update organizer profile fields in source data before export/build.';
    default:
      return 'Review evidence and decide whether to accept, reject, or request more detail.';
  }
}

export function reviewItem(update) {
  const data = payload(update);
  const type = compact(update?.update_type, 'unknown');
  const isDigest = data.type === 'digest_signup';
  const activityId = isDigest ? '' : compact(update?.activity_slug);
  const activityName = isDigest ? '' : compact(data.activityName);
  const organizerId = compact(data.organizerSlug || data.organizerId);
  const organizerName = compact(data.organizerName || data.organizer);
  const submitter = firstNonEmpty(update?.reporter_email, data.claimantEmail, data.reporterEmail, data.email, data.claimantName, data.reporterName, 'not provided');
  const evidence = firstNonEmpty(update?.evidence_url, data.verificationUrl, data.evidenceUrl, data.sourceUrl, 'none');
  const message = firstNonEmpty(data.message, data.notes, data.details, data.claimantRole, data.interest, 'none');
  const area = firstNonEmpty(data.town, data.cityName, data.citySlug);
  return {
    id: compact(update?.id, 'unknown'),
    type,
    status: compact(update?.status, 'unknown'),
    subject: subjectForUpdate(update),
    activityId,
    activityName,
    organizerId,
    organizerName,
    submitter,
    evidence,
    message,
    area,
    createdAt: compact(update?.created_at, 'unknown'),
    suggestedAction: suggestedAction(update),
  };
}

export function describeUpdate(update) {
  const item = reviewItem(update);
  const townText = item.area ? `, ${item.area}` : '';
  return [
    `[${item.type}] ${item.subject}${townText}`,
    `  id: ${item.id}`,
    `  status: ${item.status}`,
    `  created: ${item.createdAt}`,
    `  evidence: ${item.evidence}`,
    `  notes: ${item.message}`,
    `  action: ${item.suggestedAction}`,
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
      `- Evidence: ${compact(update.evidence_url || data.verificationUrl || data.evidenceUrl || data.sourceUrl, 'none')}`,
      `- Reporter email: ${compact(update.reporter_email, 'not provided')}`,
      data.organizerName || data.organizerId ? `- Organizer: ${compact(data.organizerName || data.organizerId)}` : '',
      data.claimantName || data.claimantRole ? `- Claimant: ${compact(data.claimantName)}${data.claimantRole ? ` (${compact(data.claimantRole)})` : ''}` : '',
      `- Suggested action: ${suggestedAction(update)}`,
      '',
      `Notes: ${compact(data.message || data.notes, 'none')}`,
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
      const evidence = compact(update.evidence_url || data.verificationUrl || data.evidenceUrl || data.sourceUrl, 'none');
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
        <p>${escapeHtml(compact(data.message || data.notes, 'No notes provided.'))}</p>
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

function statusCommand(id, status) {
  return `npm run supabase:update-status -- --id=${compact(id, '<id>')} --status=${status}`;
}

function commandButtons(id) {
  return ['needs_review', 'applied', 'rejected']
    .map((status) => `<button type="button" data-copy-command="${escapeHtml(statusCommand(id, status))}">${escapeHtml(status.replace('_', ' '))}</button>`)
    .join(' ');
}

export function renderAdminHtml(updates, { status = 'all' } = {}) {
  const items = updates.map(reviewItem);
  const statuses = [...new Set(items.map((item) => item.status))].sort();
  const types = [...new Set(items.map((item) => item.type))].sort();
  const statusOptions = ['all', ...statuses]
    .map((value) => `<option value="${escapeHtml(value)}"${value === status ? ' selected' : ''}>${escapeHtml(value)}</option>`)
    .join('');
  const typeOptions = ['all', ...types]
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join('');

  const cards = items.length
    ? items.map((item) => {
      const evidence = item.evidence.startsWith('http')
        ? `<a href="${escapeHtml(item.evidence)}" rel="noopener noreferrer">${escapeHtml(item.evidence)}</a>`
        : escapeHtml(item.evidence);
      return `        <article class="review-card" data-status="${escapeHtml(item.status)}" data-type="${escapeHtml(item.type)}">
          <header>
            <span>${escapeHtml(item.type)}</span>
            <strong>${escapeHtml(item.subject)}</strong>
            <small>${escapeHtml(item.status)} · ${escapeHtml(item.createdAt)}</small>
          </header>
          <dl>
            <dt>ID</dt><dd><code>${escapeHtml(item.id)}</code></dd>
            <dt>Activity</dt><dd>${escapeHtml(item.activityName || item.activityId || 'not provided')}</dd>
            <dt>Activity ID</dt><dd>${escapeHtml(item.activityId || 'not provided')}</dd>
            <dt>Organizer</dt><dd>${escapeHtml(item.organizerName || item.organizerId || 'not provided')}</dd>
            <dt>Submitter</dt><dd>${escapeHtml(item.submitter)}</dd>
            <dt>Area</dt><dd>${escapeHtml(item.area || 'not provided')}</dd>
            <dt>Evidence</dt><dd>${evidence}</dd>
            <dt>Message</dt><dd>${escapeHtml(item.message)}</dd>
          </dl>
          <p class="action">${escapeHtml(item.suggestedAction)}</p>
          <div class="commands">
            <span>Status commands:</span>
            ${commandButtons(item.id)}
          </div>
        </article>`;
    }).join('\n')
    : '        <p class="empty" data-empty>Nothing is waiting in this review queue.</p>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>My Kids Radar Admin Review</title>
    <style>
      :root { color-scheme: light; --ink: #172033; --muted: #5d6a80; --line: #d6dce5; --paper: #fff; --wash: #f7f9fb; --accent: #f05f4f; }
      body { margin: 0; font: 15px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--wash); }
      main { width: min(1180px, calc(100% - 2rem)); margin: 2rem auto; display: grid; gap: 1rem; }
      h1 { margin: 0; font-size: clamp(1.8rem, 3vw, 2.6rem); }
      p { margin: 0; }
      .muted { color: var(--muted); }
      .toolbar, .notice, .empty { border: 1px solid var(--line); border-radius: 8px; background: var(--paper); padding: 1rem; }
      .toolbar { display: flex; flex-wrap: wrap; gap: .75rem; align-items: end; }
      label { display: grid; gap: .25rem; font-weight: 700; color: var(--muted); }
      select { min-width: 12rem; border: 1px solid var(--line); border-radius: 6px; padding: .45rem .55rem; background: #fff; color: var(--ink); }
      .review-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem; }
      .review-card { border: 1px solid var(--line); border-radius: 8px; background: var(--paper); padding: 1rem; display: grid; gap: .85rem; box-shadow: 0 12px 30px rgba(23,32,51,.06); }
      .review-card[hidden] { display: none; }
      .review-card header { display: grid; gap: .15rem; }
      .review-card header span { color: var(--accent); text-transform: uppercase; font-weight: 800; font-size: .78rem; }
      .review-card header strong { font-size: 1.08rem; }
      .review-card header small { color: var(--muted); }
      dl { display: grid; grid-template-columns: 7.5rem minmax(0, 1fr); gap: .35rem .75rem; margin: 0; }
      dt { color: var(--muted); font-weight: 800; }
      dd { margin: 0; overflow-wrap: anywhere; }
      code { border: 1px solid var(--line); border-radius: 6px; background: #eef7fb; padding: .12rem .3rem; }
      .action { border-left: 3px solid var(--accent); padding-left: .65rem; font-weight: 650; }
      .commands { display: flex; flex-wrap: wrap; gap: .45rem; align-items: center; }
      .commands span { color: var(--muted); font-weight: 800; }
      button { border: 1px solid var(--line); border-radius: 6px; background: #fff; padding: .4rem .55rem; cursor: pointer; }
      button:hover { border-color: var(--accent); }
      [data-copy-status] { min-height: 1.4rem; color: var(--muted); }
    </style>
  </head>
  <body>
    <main>
      <header>
        <p class="muted">Internal review</p>
        <h1>Public activity submissions</h1>
        <p class="muted">Generated locally with the service-role key. This static file contains review data but no Supabase secrets.</p>
      </header>
      <section class="notice">
        <strong>Read-only by design.</strong>
        Browser status updates need a secure admin endpoint or Supabase Auth/RLS policy. Until then, use the copied CLI commands from this page.
      </section>
      <section class="toolbar" aria-label="Review filters">
        <label>Status
          <select data-filter-status>${statusOptions}</select>
        </label>
        <label>Type
          <select data-filter-type>${typeOptions}</select>
        </label>
        <p data-copy-status aria-live="polite"></p>
      </section>
      <section class="review-grid" data-review-grid>
${cards}
      </section>
    </main>
    <script>
      const statusFilter = document.querySelector('[data-filter-status]');
      const typeFilter = document.querySelector('[data-filter-type]');
      const cards = Array.from(document.querySelectorAll('.review-card'));
      const copyStatus = document.querySelector('[data-copy-status]');
      function applyFilters() {
        const status = statusFilter.value;
        const type = typeFilter.value;
        for (const card of cards) {
          const visible = (status === 'all' || card.dataset.status === status)
            && (type === 'all' || card.dataset.type === type);
          card.hidden = !visible;
        }
      }
      statusFilter.addEventListener('change', applyFilters);
      typeFilter.addEventListener('change', applyFilters);
      document.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-copy-command]');
        if (!button) return;
        const command = button.dataset.copyCommand;
        try {
          await navigator.clipboard.writeText(command);
          copyStatus.textContent = 'Command copied.';
        } catch {
          copyStatus.textContent = command;
        }
      });
      applyFilters();
    </script>
  </body>
</html>
`;
}
