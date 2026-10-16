export type DatabaseSettings = {
  technology: "generic" | "postgresql" | "mongodb" | "dynamodb";
  readFrom: "primary" | "replica";
  indexed: boolean;
  replicationMs: number;
  readCapacity: number;
};
export const databaseDefaults: DatabaseSettings = {
  technology: "generic",
  readFrom: "primary",
  indexed: true,
  replicationMs: 3000,
  readCapacity: 10,
};
export type UserRecord = { id: string; name: string; email: string };
export type DatabaseSnapshot = {
  primary: Record<string, UserRecord>;
  replica: Record<string, UserRecord>;
  pending: { id: string; value: UserRecord; due: number }[];
  reply: string;
  examined: number;
  units: number;
  throttled: number;
  writes: number;
  reads: number;
};
export const emptyDatabase = (): DatabaseSnapshot => ({
  primary: {},
  replica: {},
  pending: [],
  reply: "",
  examined: 0,
  units: 0,
  throttled: 0,
  writes: 0,
  reads: 0,
});
export class DatabaseLab {
  state = emptyDatabase();
  settings = { ...databaseDefaults };
  seed = "";
  used = 0;
  window = 0;
  configure(settings: DatabaseSettings, records: Record<string, UserRecord>) {
    this.settings = settings;
    const seed = JSON.stringify(records);
    if (seed !== this.seed) {
      this.seed = seed;
      this.state.primary = structuredClone(records);
      this.state.replica = structuredClone(records);
      this.state.pending = [];
    }
  }
  write(value: UserRecord, now: number, online: boolean) {
    if (!online) {
      this.state.reply = "Write failed · database offline";
      return;
    }
    this.state.primary[value.id] = structuredClone(value);
    this.state.pending.push({
      id: value.id,
      value: structuredClone(value),
      due: now + this.settings.replicationMs,
    });
    this.state.writes++;
    this.state.reply = `Committed users/${value.id} · replica catches up in ${this.settings.replicationMs} ms`;
    this.step(now);
  }
  nextTime() {
    return Math.min(...this.state.pending.map((change) => change.due));
  }
  step(now: number) {
    const ready = this.state.pending
      .filter((change) => change.due <= now)
      .sort((a, b) => a.due - b.due);
    for (const change of ready) this.state.replica[change.id] = change.value;
    this.state.pending = this.state.pending.filter(
      (change) => change.due > now,
    );
  }
  read(
    id: string,
    now: number,
  ): { value?: UserRecord; error?: string; examined: number; units: number } {
    this.step(now);
    this.state.reads++;
    const replica = this.settings.readFrom === "replica";
    const records = replica ? this.state.replica : this.state.primary;
    const examined =
      this.settings.technology === "dynamodb" || this.settings.indexed
        ? Number(!!records[id])
        : Object.keys(records).length;
    const units =
      this.settings.technology === "dynamodb" ? (replica ? 0.5 : 1) : 0;
    if (Math.floor(now / 1000) !== this.window) {
      this.window = Math.floor(now / 1000);
      this.used = 0;
    }
    if (units && this.used + units > this.settings.readCapacity) {
      this.state.throttled++;
      this.state.reply =
        "ProvisionedThroughputExceeded · read capacity exhausted";
      return { error: this.state.reply, examined: 0, units: 0 };
    }
    this.used += units;
    this.state.units += units;
    this.state.examined += examined;
    const value = records[id];
    this.state.reply = `${replica ? "Replica" : "Primary"} read · ${examined} records examined${units ? ` · ${units} read units` : ""}`;
    return {
      value: value ? structuredClone(value) : undefined,
      examined,
      units,
    };
  }
  delay(base: number) {
    return (
      base +
      (this.settings.technology !== "dynamodb" && !this.settings.indexed
        ? Object.keys(this.state.primary).length * 20
        : 0)
    );
  }
}
