export type ResilienceSettings = {
  attemptTimeout: number;
  maxRetries: number;
  backoffMs: number;
  backoff: "fixed" | "exponential";
  breaker: boolean;
  failureThreshold: number;
  resetMs: number;
};
export const resilienceDefaults: ResilienceSettings = {
  attemptTimeout: 60000,
  maxRetries: 0,
  backoffMs: 100,
  backoff: "exponential",
  breaker: false,
  failureThreshold: 3,
  resetMs: 5000,
};
export type ConnectionSettings = {
  latency: number;
  failureEvery: number;
  online: boolean;
};
export const connectionDefaults: ConnectionSettings = {
  latency: 0,
  failureEvery: 0,
  online: true,
};
export type CircuitState = {
  state: "closed" | "open" | "half-open";
  failures: number;
  openUntil: number;
  probe: boolean;
  generation: number;
  attempts: number;
  retries: number;
  blocked: number;
  successes: number;
};
export class CircuitBank {
  states: Record<string, CircuitState> = {};
  get(id: string) {
    return (
      this.states[id] ??
      (this.states[id] = {
        state: "closed",
        failures: 0,
        openUntil: 0,
        probe: false,
        generation: 0,
        attempts: 0,
        retries: 0,
        blocked: 0,
        successes: 0,
      })
    );
  }
  before(
    id: string,
    settings: ResilienceSettings,
    now: number,
  ): { allowed: boolean; generation: number } {
    const state = this.get(id);
    if (!settings.breaker && state.state !== "closed") {
      state.state = "closed";
      state.probe = false;
      state.failures = 0;
      state.generation++;
    }
    if (settings.breaker && state.state === "open" && now >= state.openUntil) {
      state.state = "half-open";
      state.probe = false;
      state.generation++;
    }
    if (
      settings.breaker &&
      (state.state === "open" || (state.state === "half-open" && state.probe))
    ) {
      state.blocked++;
      return { allowed: false, generation: state.generation };
    }
    if (state.state === "half-open") state.probe = true;
    state.attempts++;
    return { allowed: true, generation: state.generation };
  }
  success(id: string, generation: number) {
    const state = this.get(id);
    state.successes++;
    if (generation !== state.generation) return;
    state.failures = 0;
    if (state.state !== "closed") state.generation++;
    state.state = "closed";
    state.probe = false;
  }
  failure(
    id: string,
    settings: ResilienceSettings,
    now: number,
    generation: number,
  ) {
    const state = this.get(id);
    if (generation !== state.generation) return;
    state.failures++;
    state.probe = false;
    if (
      settings.breaker &&
      (state.state === "half-open" ||
        state.failures >= settings.failureThreshold)
    ) {
      state.state = "open";
      state.openUntil = now + settings.resetMs;
      state.generation++;
    }
  }
  cancel(id: string, generation: number) {
    const state = this.get(id);
    if (state.state === "half-open" && generation === state.generation)
      state.probe = false;
  }
}
export function retryDelay(settings: ResilienceSettings, retry: number) {
  return Math.min(
    60000,
    settings.backoffMs *
      (settings.backoff === "exponential" ? 2 ** Math.max(0, retry - 1) : 1),
  );
}
