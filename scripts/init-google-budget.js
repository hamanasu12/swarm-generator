import { redisCommand, billingMonth, BUDGET_KEY } from '../lib/google-budget.js';

// Run once, while all Google callers are paused, after checking Cloud usage.
const [month, rawUsed, option] = process.argv.slice(2);
const used = Number(rawUsed);
const currentMonth = billingMonth();
const [year, number] = currentMonth.split('-').map(Number);
const nextMonth = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
// Seeding next month deliberately blocks requests until that month begins.
const validMonth = month === currentMonth || (option === '--allow-next-month' && month === nextMonth);
if (!validMonth || !/^\d+$/.test(rawUsed || '') || !Number.isSafeInteger(used)) {
  throw new Error('Usage: node scripts/init-google-budget.js YYYY-MM VERIFIED_USED_COUNT [--allow-next-month] (Pacific time)');
}
const result = await redisCommand(['EVAL', `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'month', ARGV[1], 'used', ARGV[2])
return 1
`, '1', BUDGET_KEY, month, String(used)]);
if (result !== 1) throw new Error('Counter already exists; refusing to reset usage');
console.log(`Initialized Google budget for ${month} with ${used} requests already used.`);
