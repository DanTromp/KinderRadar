import { readFile } from 'node:fs/promises';

const PLACEHOLDER_VALUES = new Set([
  'replace_with_service_role_key_locally',
  'replace_with_publishable_key_locally',
]);

export function parseEnv(contents) {
  const env = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

export function normalizeSupabaseUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SUPABASE_URL must be a valid http(s) URL. Current value: ${raw}`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`SUPABASE_URL must use http or https. Current protocol: ${url.protocol}`);
  }

  return url.href.replace(/\/$/, '');
}

export async function loadSupabaseEnv({
  envFile = new URL('../.env', import.meta.url),
  requireServiceRole = false,
  allowPublishableKey = true,
  action = 'using Supabase',
} = {}) {
  let contents;
  try {
    contents = await readFile(envFile, 'utf8');
  } catch {
    throw new Error(`Could not read Supabase env file at ${envFile}. Create .env with SUPABASE_URL and the required Supabase key.`);
  }

  const env = parseEnv(contents);
  const url = normalizeSupabaseUrl(env.SUPABASE_URL);
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY;
  const key = requireServiceRole ? serviceRole : serviceRole || (allowPublishableKey ? publishableKey : '');
  const keyName = requireServiceRole ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_PUBLISHABLE_KEY';

  if (!url || !key || PLACEHOLDER_VALUES.has(key)) {
    throw new Error(`Set SUPABASE_URL and ${keyName} in .env before ${action}.`);
  }

  return { url, key, serviceRole, publishableKey };
}

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function responseSnippet(response) {
  const text = await response.text();
  const cleaned = stripHtml(text) || text.trim();
  if (!cleaned) return '';
  return cleaned.length > 320 ? `${cleaned.slice(0, 320)}...` : cleaned;
}

function hostFor(config) {
  try {
    return new URL(config.url).host;
  } catch {
    return config.url;
  }
}

export function supabaseHeaders(key, extra = {}) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    ...extra,
  };
}

export async function supabaseFetch(config, path, options = {}, label = 'Supabase request') {
  const url = new URL(path, `${config.url}/`);
  let response;

  try {
    response = await fetch(url, options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} failed: could not reach Supabase at ${hostFor(config)}. Check network access and that SUPABASE_URL points to an active project. ${detail}`);
  }

  if (response.ok) return response;

  const snippet = await responseSnippet(response);
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  const cloudflare521 = response.status === 521 || /Cloudflare|Web server is down|Error code 521/i.test(snippet);
  if (cloudflare521) {
    throw new Error(`${label} failed: Supabase host ${hostFor(config)} returned Cloudflare 521 (web server is down). Check that the Supabase project is active/reachable and that SUPABASE_URL points to the right project. ${snippet ? `Response: ${snippet}` : ''}`.trim());
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(`${label} failed: Supabase returned ${status}. Check the Supabase key in .env and table policies. ${snippet ? `Response: ${snippet}` : ''}`.trim());
  }

  if (response.status >= 500) {
    throw new Error(`${label} failed: Supabase returned ${status}. The project or Supabase API may be temporarily unavailable. ${snippet ? `Response: ${snippet}` : ''}`.trim());
  }

  throw new Error(`${label} failed: Supabase returned ${status}. ${snippet ? `Response: ${snippet}` : 'No response body.'}`);
}
