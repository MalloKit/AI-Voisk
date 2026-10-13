import base from "./mock/admin-fixture.json";
import future from "./mock/future-fixture.json";
import type { AdminSnapshot } from "./models";

export interface AdminRepository {
  load(): Promise<AdminSnapshot>;
  acknowledgeAlert(id: string): Promise<void>;
}

// Devices/alerts are future Mock contracts, not existing API/table projections.
export class MockAdminRepository implements AdminRepository {
  private snapshot = structuredClone({
    ...base,
    ...future,
    isMock: true,
  }) as AdminSnapshot;
  constructor(private clock: () => Date = () => new Date()) {}
  async load() {
    return structuredClone(this.snapshot);
  }
  async acknowledgeAlert(id: string) {
    const alert = this.snapshot.alerts.find((a) => a.id === id);
    if (!alert) throw new Error("Unknown Mock alert");
    if (alert.status === "unconfirmed") {
      alert.status = "acknowledged";
      alert.acknowledgedAt = this.clock().toISOString();
    }
  }
}
