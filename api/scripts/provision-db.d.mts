export interface ProvisionResult {
  status: "created" | "ensured" | "skipped";
  role?: string;
  reason?: string;
}

export function provisionAppRole(databaseUrl: string, directUrl: string): Promise<ProvisionResult>;
