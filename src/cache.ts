export type CacheSettings = {
  technology: "generic" | "redis" | "memcached";
  online: boolean;
  maxmemory: number;
  policy:
    | "allkeys-lru"
    | "allkeys-lfu"
    | "volatile-lru"
    | "volatile-ttl"
    | "noeviction";
  maxItemBytes: number;
};
export const cacheDefaults: CacheSettings = {
  technology: "generic",
  online: true,
  maxmemory: 4096,
  policy: "allkeys-lru",
  maxItemBytes: 1024,
};
export type CacheEntry = {
  key: string;
  value: unknown;
  expires: number;
  used: number;
  created: number;
  frequency?: number;
};
export type CacheState = {
  entries: CacheEntry[];
  hits: number;
  misses: number;
};
export function valueText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
export function entryBytes(entry: Pick<CacheEntry, "key" | "value">): number {
  return new TextEncoder().encode(entry.key + valueText(entry.value))
    .byteLength;
}
export function memoryUsed(entries: CacheEntry[]): number {
  return entries.reduce((bytes, entry) => bytes + entryBytes(entry), 0);
}
export function readCache(
  state: CacheState,
  key: string,
  now: number,
): CacheEntry | undefined {
  const entry = state.entries.find(
    (entry) => entry.key === key && entry.expires > now,
  );
  if (entry) {
    state.hits++;
    entry.used = now;
    entry.frequency = (entry.frequency ?? 0) + 1;
  } else state.misses++;
  return entry;
}
export function writeCache(
  state: CacheState,
  key: string,
  value: unknown,
  ttlMs: number,
  now: number,
  settings: CacheSettings,
  capacity: number,
  eviction: "LRU" | "FIFO",
): { error?: string; evicted: string[] } {
  if (!settings.online) return { error: "Cache unavailable", evicted: [] };
  const entry: CacheEntry = {
    key,
    value,
    expires: ttlMs === 0 ? Infinity : now + ttlMs,
    used: now,
    created: now,
    frequency: 1,
  };
  const size = entryBytes(entry);
  if (
    settings.technology === "memcached" &&
    new TextEncoder().encode(valueText(value)).byteLength >
      settings.maxItemBytes
  )
    return { error: "SERVER_ERROR object too large for cache", evicted: [] };
  const proposed = state.entries.filter(
    (entry) => entry.key !== key && entry.expires > now,
  );
  const evicted: string[] = [];
  const over = () =>
    settings.technology === "generic"
      ? proposed.length >= capacity
      : memoryUsed(proposed) + size > settings.maxmemory;
  const policy = settings.technology === "generic" ? eviction : settings.policy;
  while (over()) {
    if (policy === "noeviction")
      return {
        error: "OOM command not allowed when used memory > maxmemory",
        evicted: [],
      };
    const eligible = proposed.filter(
      (entry) =>
        !String(policy).startsWith("volatile-") ||
        Number.isFinite(entry.expires),
    );
    const order = (a: CacheEntry, b: CacheEntry) => {
      if (policy === "FIFO") return a.created - b.created;
      if (policy === "allkeys-lfu")
        return (a.frequency ?? 0) - (b.frequency ?? 0) || a.used - b.used;
      if (policy === "volatile-ttl") return a.expires - b.expires;
      return a.used - b.used;
    };
    const oldest = eligible.sort(order)[0];
    if (!oldest)
      return { error: "OOM no eligible keys can be evicted", evicted: [] };
    proposed.splice(proposed.indexOf(oldest), 1);
    evicted.push(oldest.key);
  }
  state.entries = [...proposed, entry];
  return { evicted };
}
function tokens(command: string): string[] {
  const values: string[] = [];
  let word = "",
    quote = "",
    escaped = false,
    started = false;
  for (const char of command.trim()) {
    if (escaped) {
      word += char;
      escaped = false;
      started = true;
      continue;
    }
    if (char === "\\" && quote === '"') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      else word += char;
      started = true;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        values.push(word);
        word = "";
        started = false;
      }
    } else {
      word += char;
      started = true;
    }
  }
  if (quote || escaped) throw new Error("ERR unbalanced quotes");
  if (started) values.push(word);
  return values;
}
export function redisCommand(
  state: CacheState,
  command: string,
  now: number,
  settings: CacheSettings,
  capacity: number,
  eviction: "LRU" | "FIFO",
): string {
  if (command.length > 4096) return "ERR command exceeds 4096 characters";
  if (!settings.online) return "ERR Redis is offline";
  state.entries = state.entries.filter((entry) => entry.expires > now);
  try {
    const [raw, ...args] = tokens(command);
    const verb = raw?.toUpperCase();
    const count = (n: number) => {
      if (args.length !== n) throw new Error("ERR wrong number of arguments");
    };
    const integer = (text: string) => {
      if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(Number(text)))
        throw new Error("ERR value is not an integer or out of range");
      return Number(text);
    };
    if (verb === "PING") {
      count(0);
      return "PONG";
    }
    if (verb === "GET") {
      count(1);
      const entry = readCache(state, args[0], now);
      return entry ? valueText(entry.value) : "(nil)";
    }
    if (verb === "DEL") {
      if (!args.length) throw new Error("ERR wrong number of arguments");
      let removed = 0;
      for (const key of new Set(args)) {
        const before = state.entries.length;
        state.entries = state.entries.filter((entry) => entry.key !== key);
        removed += before - state.entries.length;
      }
      return `(integer) ${removed}`;
    }
    if (verb === "TTL" || verb === "PTTL") {
      count(1);
      const entry = state.entries.find((e) => e.key === args[0]);
      return `(integer) ${!entry ? -2 : !Number.isFinite(entry.expires) ? -1 : verb === "TTL" ? Math.floor((entry.expires - now + 500) / 1000) : entry.expires - now}`;
    }
    if (verb === "EXPIRE" || verb === "PEXPIRE") {
      count(2);
      const ttl = integer(args[1]);
      const entry = state.entries.find((e) => e.key === args[0]);
      if (!entry) return "(integer) 0";
      entry.expires = now + ttl * (verb === "EXPIRE" ? 1000 : 1);
      state.entries = state.entries.filter((e) => e.expires > now);
      return "(integer) 1";
    }
    if (verb === "INCR") {
      count(1);
      const existing = state.entries.find((e) => e.key === args[0]);
      const value = existing ? integer(valueText(existing.value)) : 0;
      if (!Number.isSafeInteger(value + 1))
        throw new Error("ERR increment would overflow");
      const result = writeCache(
        state,
        args[0],
        String(value + 1),
        existing && Number.isFinite(existing.expires)
          ? existing.expires - now
          : 0,
        now,
        settings,
        capacity,
        eviction,
      );
      return result.error ?? `(integer) ${value + 1}`;
    }
    if (verb === "SET") {
      if (args.length < 2) throw new Error("ERR wrong number of arguments");
      let ttl = 0;
      let condition = "";
      let expiry = false;
      for (let i = 2; i < args.length; i++) {
        const option = args[i].toUpperCase();
        if (option === "EX" || option === "PX") {
          if (expiry || !args[i + 1]) throw new Error("ERR syntax error");
          expiry = true;
          ttl = integer(args[++i]) * (option === "EX" ? 1000 : 1);
          if (ttl <= 0 || !Number.isSafeInteger(ttl))
            throw new Error("ERR invalid expire time in SET");
        } else if ((option === "NX" || option === "XX") && !condition)
          condition = option;
        else throw new Error("ERR syntax error");
      }
      const exists = state.entries.some((e) => e.key === args[0]);
      if ((condition === "NX" && exists) || (condition === "XX" && !exists))
        return "(nil)";
      const result = writeCache(
        state,
        args[0],
        args[1],
        ttl,
        now,
        settings,
        capacity,
        eviction,
      );
      return result.error ?? "OK";
    }
    throw new Error(
      "ERR supported commands: PING, GET, SET, DEL, EXPIRE, PEXPIRE, TTL, PTTL, INCR",
    );
  } catch (error) {
    return error instanceof Error ? error.message : "ERR invalid command";
  }
}
