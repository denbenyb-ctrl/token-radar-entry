// Token radar, model radar-2: the snapshot goes in, a ranked board comes out.
//
// The board starts from the snapshot's watchlist — every watched protocol is ranked, no
// matter what — and then the early radar adds pre-token protocols below the watchlist floor,
// the ones this radar exists to surface. A protocol counts as pre-token when its record
// carries no market cap, no CoinGecko id and no symbol. Live-token protocols never join
// the board: they are the market's own evidence, and each category is priced from them, so
// a pre-token protocol's implied value is the market's pricing of live protocols in the
// same category, in the same snapshot.
//
// The scoring, from the snapshot's own figures only:
//
//   multiple   median(mcap_usd / tvl_usd) across the category's live-token protocols,
//              needing at least 3 of them, clamped to [0.10, 0.60]; otherwise 0.25
//   base       tvl_usd x multiple
//   growth     change_7d clamped to [-50, 80] percent
//   multiplier 1 + (growth / 100) x 0.5
//   maturity   0.65 + min(age_days, 1095) / 1095 x 0.35 (age unknown: 365 days)
//   breadth    1 + min(chains, 6) x 0.02
//   implied    max(1, round(base x multiplier x maturity x breadth))
//
// No protocol name is ever special-cased: one function scores every row, and the multiples
// are computed from the snapshot when the program runs, never written in by hand.

/** One protocol entry of the snapshot: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: a ranked board row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row, carrying board.json's farm plan verbatim. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** Everything the dashboard needs: board, live set, multiples and the model that ran. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  category_multiples: Record<string, number>;
  category_multiple_counts: Record<string, number>;
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** The headline sentence's figures: watchlist slugs, rows, early rows, live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  category_multiple_fallback: number;
  category_multiple_min: number;
  category_multiple_max: number;
  category_multiple_min_live: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25, // fallback multiple when a category has no priced peers
  growth_weight: 0.5, // how much of the 7-day move feeds the multiplier
  growth_floor: -50, // worst 7-day move counted, in percent
  growth_cap: 80, // best 7-day move counted, in percent
  maturity_floor: 0.65, // multiplier for a protocol listed yesterday
  maturity_range: 0.35, // added over three years of listing age
  maturity_days: 1095, // three years, in days
  unknown_age_days: 365, // age assumed when no listing date is known
  category_multiple_fallback: 0.25, // multiple for an unpriced category
  category_multiple_min: 0.1, // lowest multiple the market may set
  category_multiple_max: 0.6, // highest multiple the market may set
  category_multiple_min_live: 3, // live protocols needed to price a category
  breadth_per_chain: 0.02, // added per chain, up to the cap below
  breadth_max_chains: 6, // chains counted for breadth
};

/** The model's version label, the one the dashboard names. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 260;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ---------------------------------------------------------------- numbers

const MS_PER_DAY = 86_400_000;

/** A number rounded to four decimals, the precision the multiples are carried at. */
const round4dp = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `from` to `to`, never below zero; null when a date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const todayMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(todayMs) || !Number.isFinite(listedMs)) return null;
  return Math.max(0, Math.floor((todayMs - listedMs) / MS_PER_DAY));
}

/** The median of sorted numbers; for an even count, the mean of the two middle ones. */
function middleValue(sorted: number[]): number {
  const half = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[half]!;
  return (sorted[half - 1]! + sorted[half]!) / 2;
}

// ---------------------------------------------------------------- category pricing

/**
 * One multiple per category, priced from this snapshot's live-token protocols: the median of
 * market cap over TVL, clamped, and only when at least `category_multiple_min_live` live
 * protocols carry the category. Categories without a multiple fall back at scoring time.
 * Exchange tokens are left out: an exchange token prices a business, not a protocol's TVL.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { multiples: Map<string, number>; counts: Map<string, number> } {
  const samples = new Map<string, number[]>();
  for (const proto of snapshot.protocols) {
    if (proto.category === null || proto.category === 'CEX') continue;
    if (isPreToken(proto)) continue;
    if (proto.mcap_usd === null || proto.mcap_usd <= 0 || proto.tvl_usd <= 0) continue;
    const bucket = samples.get(proto.category) ?? [];
    bucket.push(proto.mcap_usd / proto.tvl_usd);
    samples.set(proto.category, bucket);
  }
  const counts = new Map<string, number>();
  for (const [category, bucket] of samples) counts.set(category, bucket.length);
  const multiples = new Map<string, number>();
  for (const [category, bucket] of samples) {
    if (bucket.length < model.category_multiple_min_live) continue;
    bucket.sort((a, b) => a - b);
    const priced = Math.min(model.category_multiple_max, Math.max(model.category_multiple_min, middleValue(bucket)));
    multiples.set(category, round4dp(priced));
  }
  return { multiples, counts };
}

/** The multiple a protocol's category carries, or the fallback when its category has none. */
export function multipleFor(proto: SnapshotProtocol, multiples: Map<string, number>, model: ModelConstants = MODEL): number {
  if (proto.category === null) return model.category_multiple_fallback;
  return multiples.get(proto.category) ?? model.category_multiple_fallback;
}

// ---------------------------------------------------------------- scoring

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  proto: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  categoryMultiple: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, proto.listed_at);
  const raw = numOr(proto.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageInModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageInModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + Math.min(proto.chains.length, model.breadth_max_chains) * model.breadth_per_chain;
  const base = proto.tvl_usd * categoryMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(proto: SnapshotProtocol): boolean {
  return proto.mcap_usd === null && proto.gecko_id === null && proto.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(proto: SnapshotProtocol): boolean {
  return isPreToken(proto) && proto.category !== 'CEX' && !VERSION_SUFFIX.test(proto.name);
}

/** The snapshot's protocols keyed by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((proto) => [proto.slug, proto]));
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = indexBySlug(snapshot.protocols);
  const { multiples } = categoryMultiples(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor, so every slug on it is taken. A slug the snapshot no longer
  // carries cannot be ranked, but the board never gambles its coverage on a record that
  // fails to turn up: the gate's coverage row is checked against the watchlist as given.
  for (const slug of snapshot.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) chosen.set(slug, found);
  }
  // The early radar adds pre-token protocols below the watchlist floor, by TVL, capped at
  // EARLY_ROWS. A protocol already chosen stays chosen; the early set never replaces a
  // watchlist row.
  const early = snapshot.protocols
    .filter((proto) => !chosen.has(proto.slug) && isRankable(proto) && proto.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const proto of early) chosen.set(proto.slug, proto);

  const scored = [...chosen.values()].map((proto) => {
    const categoryMultiple = multipleFor(proto, multiples, model);
    const { implied, growthPct, growthMult, maturityMult, breadthMult, age } = impliedValue(proto, snapshot.as_of, model, categoryMultiple);
    return { proto, implied, categoryMultiple, growthPct, growthMult, maturityMult, breadthMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.proto.slug < b.proto.slug ? -1 : a.proto.slug > b.proto.slug ? 1 : 0));
  return scored.map((entry, position) => ({
    rank: position + 1,
    slug: entry.proto.slug,
    name: entry.proto.name,
    category: entry.proto.category,
    chains: entry.proto.chains,
    tvl_usd: entry.proto.tvl_usd,
    change_7d: entry.proto.change_7d,
    mcap_usd: entry.proto.mcap_usd,
    listed_at: entry.proto.listed_at,
    gecko_id: entry.proto.gecko_id,
    symbol: entry.proto.symbol,
    token_status: 'pre-token',
    age_days: entry.age,
    implied_value_usd: entry.implied,
    model: {
      base_multiple: entry.categoryMultiple,
      category_multiple: entry.categoryMultiple,
      growth_pct: entry.growthPct,
      growth_multiplier: round4dp(entry.growthMult),
      maturity_multiplier: round4dp(entry.maturityMult),
      breadth_multiplier: round4dp(entry.breadthMult),
      age_days: entry.age,
    },
    farm_steps: farmSteps(entry.proto, entry.age).map(stepText),
  }));
}

// ---------------------------------------------------------------- farm plans

/** One step as a single string: its action, then its cost and time, within 20..600 characters. */
export function stepText(step: FarmStep): string {
  let line = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (line.length > 600) line = `${line.slice(0, 596)}...`;
  if (line.length < 20) line = `${line} Hold the position and check the protocol's own page.`;
  return line;
}

/** The first chain a protocol names, or a neutral phrase. */
function firstChain(proto: SnapshotProtocol): string {
  return proto.chains.length > 0 ? proto.chains[0]! : 'its main chain';
}

/** Gas wording by the first chain: the main chain's fees run higher than a rollup's or a fast chain's. */
function gasRates(chain: string): { first: string; setup: string; weekly: string } {
  if (chain.toLowerCase().includes('ethereum')) {
    return { first: '$4-$12 of gas for the first transaction', setup: '$6-$15 of gas', weekly: '$3-$8 of gas a week' };
  }
  return { first: 'under $1 of gas for the first transaction', setup: '$1-$3 of gas', weekly: 'under $1 of gas a week' };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function stakeSize(proto: SnapshotProtocol): number {
  if (proto.tvl_usd >= 5_000_000_000) return 250;
  if (proto.tvl_usd >= 1_000_000_000) return 150;
  if (proto.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdWindow(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in words a farmer can follow. */
function primaryAction(proto: SnapshotProtocol, amount: number, chain: string): string {
  const cat = (proto.category ?? '').toLowerCase();
  const label = proto.name;
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) return `Supply $${amount} of USDC to ${label} on ${chain} and keep the position open.`;
  if (cat.includes('dex') || cat.includes('yield') || cat.includes('leveraged farm')) return `Provide $${amount} of liquidity to ${label}'s main pool on ${chain} and keep the position open.`;
  if (cat.includes('bridge')) return `Bridge $${amount} of USDC to ${chain} through ${label} and use the bridged funds in its app.`;
  if (cat.includes('staking') || cat.includes('restak')) return `Stake $${amount} of the chain's staking asset through ${label} and keep the receipt.`;
  if (cat.includes('perpetual') || cat.includes('derivative') || cat.includes('options')) return `Deposit $${amount} of USDC as margin on ${label} and open one small hedge.`;
  if (cat.includes('prediction')) return `Fund $${amount} and place one market position on ${label}.`;
  if (cat.includes('curator') || cat.includes('allocator') || cat.includes('index')) return `Deposit $${amount} into a ${label} vault on ${chain} and keep the shares.`;
  if (cat.includes('stable')) return `Mint or deposit $${amount} of the stable asset through ${label} on ${chain}.`;
  if (cat.includes('rwa')) return `Mint $${amount} of the protocol's yield asset on ${chain} and hold it.`;
  if (cat.includes('insurance')) return `Buy $${amount} of cover from ${label} on ${chain} and keep the policy.`;
  return `Deposit $${amount} of USDC into ${label} on ${chain} and keep the position open.`;
}

/** The category's second, different action: a farm plan that shows both sides of the protocol. */
function followUpAction(proto: SnapshotProtocol): string {
  const cat = (proto.category ?? '').toLowerCase();
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) return "Borrow a small amount against the supply and repay it within the week, so the position shows both sides of the market.";
  if (cat.includes('dex') || cat.includes('yield') || cat.includes('leveraged farm')) return "Swap a small amount through the pool and add the proceeds back, so the wallet shows both providing and trading.";
  if (cat.includes('bridge')) return "Bridge a second, smaller amount on a different day and use it in the destination app.";
  if (cat.includes('staking') || cat.includes('restak')) return "Restake or compound the first reward once it lands, and keep the new receipt.";
  if (cat.includes('perpetual') || cat.includes('derivative') || cat.includes('options')) return "Close the hedge and open a fresh one at a smaller size, so the account shows repeated margin use.";
  if (cat.includes('prediction')) return "Place a second position on a different market, at a smaller size.";
  return "Repeat the qualifying action once more on a different day, with a smaller amount.";
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age, seven-day change), never from a
 * hand-written list of names. The dashboard shows these exact strings from data.js.
 */
export function farmSteps(proto: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(proto);
  const gas = gasRates(chain);
  const amount = stakeSize(proto);
  const hold = holdWindow(age);
  const primary = primaryAction(proto, amount, chain);
  const dipping = proto.change_7d !== null && proto.change_7d < -10;
  const holdLine = dipping
    ? `Hold the position for at least ${hold} days, but re-check the protocol's TVL weekly: it fell ${Math.abs(proto.change_7d!)}% in seven days, so add no new capital until the trend steadies.`
    : `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`;
  const step = (text: string, cost: string, time: string): FarmStep => ({ text, cost, time });
  return [
    step("Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.", gas.first, "5 minutes"),
    step(primary, `$${amount} of capital and about ${gas.setup}`, "15 minutes to set up"),
    step(followUpAction(proto), `about ${gas.weekly}`, "10 minutes a week"),
    step(holdLine, `the $${amount} stays in the position`, `${hold} days`),
    step("Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Never connect a wallet that holds other funds to a claim page.", "no fee to check, and never pay to claim", "10 minutes"),
    step("Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.", "nothing but the log", "5 minutes"),
  ];
}

// ---------------------------------------------------------------- live set and dashboard data

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((proto) => !isPreToken(proto) && proto.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((proto) => ({
      slug: proto.slug,
      name: proto.name,
      category: proto.category,
      chains: proto.chains,
      tvl_usd: proto.tvl_usd,
      mcap_usd: proto.mcap_usd,
      change_7d: proto.change_7d,
      mcap_tvl_ratio: proto.mcap_usd !== null && proto.tvl_usd > 0 ? round4dp(proto.mcap_usd / proto.tvl_usd) : null,
    }));
}

/** A board row's form for data.js, with the farm plan board.json carries, verbatim. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { multiples, counts } = categoryMultiples(snapshot, model);
  const early = board.filter((row) => !snapshot.watchlist.includes(row.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    category_multiples: Object.fromEntries(multiples),
    category_multiple_counts: Object.fromEntries(counts),
    watchlist: snapshot.watchlist,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- parsing and checks

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new SnapshotError('snapshot.json is not a JSON object');
  const doc = parsed as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof doc.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((entry) => typeof entry !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = doc.protocols.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new SnapshotError(`snapshot.json's protocol ${index} is not an object`);
    const rec = item as Record<string, unknown>;
    if (typeof rec.slug !== 'string' || typeof rec.name !== 'string' || typeof rec.tvl_usd !== 'number' || !Number.isFinite(rec.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${index} lacks a slug, a name or a TVL`);
    }
    return {
      slug: rec.slug,
      name: rec.name,
      category: typeof rec.category === 'string' ? rec.category : null,
      chains: Array.isArray(rec.chains) ? rec.chains.filter((entry): entry is string => typeof entry === 'string') : [],
      tvl_usd: rec.tvl_usd,
      change_7d: typeof rec.change_7d === 'number' && Number.isFinite(rec.change_7d) ? rec.change_7d : null,
      mcap_usd: typeof rec.mcap_usd === 'number' && Number.isFinite(rec.mcap_usd) ? rec.mcap_usd : null,
      listed_at: typeof rec.listed_at === 'string' ? rec.listed_at : null,
      gecko_id: typeof rec.gecko_id === 'string' ? rec.gecko_id : null,
      symbol: typeof rec.symbol === 'string' ? rec.symbol : null,
    };
  });
  return {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: doc.floor_usd,
    protocols,
    watchlist: doc.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((row) => row.slug));
  const missing = snapshot.watchlist.filter((slug) => !slugs.has(slug));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((row) => row.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const row of board) {
    const steps = row.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${row.slug} has ${steps.length} farm steps`;
    for (const step of steps) if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `${row.slug} has implied value ${row.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
