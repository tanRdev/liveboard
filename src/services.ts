import type { Config } from "./engine";

export type ServiceSettings = {
  mode: "data" | "handler";
  calls: "parallel" | "sequential";
  dependencyTimeout: number;
  publish: "none" | "queue" | "stream";
};
export const serviceDefaults: ServiceSettings = {
  mode: "data",
  calls: "parallel",
  dependencyTimeout: 2000,
  publish: "none",
};
export function serviceSettings(config: Config, id: string): ServiceSettings {
  return { ...serviceDefaults, ...config.serviceOverrides?.[id] };
}
