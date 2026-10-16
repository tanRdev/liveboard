export type GatewaySettings = {
  technology: "load-balancer" | "api-gateway";
  rate: number;
  burst: number;
};
export const gatewayDefaults: GatewaySettings = {
  technology: "load-balancer",
  rate: 5,
  burst: 10,
};
export type GatewaySnapshot = {
  tokens: number;
  allowed: number;
  rejected: number;
};
export class GatewayLab {
  state: GatewaySnapshot = { tokens: 10, allowed: 0, rejected: 0 };
  last = 0;
  settings = { ...gatewayDefaults };
  configure(settings: GatewaySettings, now: number) {
    this.refill(now);
    if (this.settings.burst !== settings.burst)
      this.state.tokens = Math.min(settings.burst, this.state.tokens);
    this.settings = settings;
  }
  refill(now: number) {
    this.state.tokens = Math.min(
      this.settings.burst,
      this.state.tokens + ((now - this.last) * this.settings.rate) / 1000,
    );
    this.last = now;
  }
  allow(now: number) {
    this.refill(now);
    if (this.settings.technology !== "api-gateway") return true;
    if (this.state.tokens < 1) {
      this.state.rejected++;
      return false;
    }
    this.state.tokens--;
    this.state.allowed++;
    return true;
  }
}
