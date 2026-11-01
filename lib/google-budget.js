// One permanent hash, shared by every deployment using the same Google key.
// It must be explicitly initialized with usage already incurred this month.
export const MONTHLY_GOOGLE_LIMIT = 9000;
export const BUDGET_KEY = 'swarm-generator:google-geocoding-budget:v1';

export const RESERVE_SCRIPT = `
local month = redis.call('HGET', KEYS[1], 'month')
local used = tonumber(redis.call('HGET', KEYS[1], 'used'))
if not month or not used or used < 0 or used ~= math.floor(used) then return {-1, 0} end
if not string.match(month, '^%d%d%d%d%-%d%d$') then return {-1, 0} end
local monthNumber = tonumber(string.sub(month, 6, 7))
if monthNumber < 1 or monthNumber > 12 then return {-1, 0} end
if month > ARGV[1] then return {-1, 0} end
if month < ARGV[1] then
  month = ARGV[1]
  used = 0
  redis.call('HSET', KEYS[1], 'month', month, 'used', 0)
end
if used >= tonumber(ARGV[2]) then return {0, used} end
used = redis.call('HINCRBY', KEYS[1], 'used', 1)
return {1, used}
`;

export class GoogleBudgetError extends Error {
  constructor(code, quota = null) {
    super(code);
    this.code = code;
    this.quota = quota;
  }
}

export function billingMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit'
  }).formatToParts(now);
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
}

export async function redisCommand(command, { env = process.env, fetchImpl = fetch } = {}) {
  const endpoint = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!endpoint || !token || new URL(endpoint).protocol !== 'https:') {
    throw new Error('Budget storage is not configured');
  }
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    redirect: 'error', signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error('Budget storage request failed');
  const payload = await response.json();
  if (payload.error) throw new Error('Budget storage command failed');
  return payload.result;
}

export async function reserveGoogleRequest(options = {}) {
  const month = billingMonth(options.now);
  try {
    const result = await redisCommand([
      'EVAL', RESERVE_SCRIPT, '1', BUDGET_KEY, month, String(MONTHLY_GOOGLE_LIMIT)
    ], options);
    if (!Array.isArray(result) || result.length !== 2) throw new Error('Invalid budget');
    const [allowed, used] = result;
    if (![0, 1].includes(allowed) || !Number.isSafeInteger(used) || used < 0 ||
        (allowed === 1 && (used < 1 || used > MONTHLY_GOOGLE_LIMIT)) ||
        (allowed === 0 && used < MONTHLY_GOOGLE_LIMIT)) throw new Error('Invalid budget');
    const quota = { month, used, limit: MONTHLY_GOOGLE_LIMIT,
      remaining: Math.max(0, MONTHLY_GOOGLE_LIMIT - used), timeZone: 'America/Los_Angeles' };
    if (!allowed) throw new GoogleBudgetError('google_monthly_limit', quota);
    return quota;
  } catch (error) {
    if (error instanceof GoogleBudgetError) throw error;
    // Never fall back to a per-process/localStorage counter, or expose tokens.
    throw new GoogleBudgetError('google_budget_unavailable');
  }
}
