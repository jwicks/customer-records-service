import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Must be set before src/db.ts is first imported, so use an in-memory DB
// instead of the real customers.db.
process.env.DB_PATH = ":memory:";

let baseUrl: string;
let server: Server;

beforeAll(async () => {
  const { app } = await import("../src/server");
  const { seed } = await import("../src/db");
  seed(true);
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

afterAll(() => {
  server.close();
});

async function createCustomer(overrides: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}/api/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Test User",
      company: "Test Co",
      email: "test@test.com",
      phone: "555-0100",
      status: "active",
      accountManager: "S. Whitfield",
      lastContacted: "2024-01-01",
      note: "Initial customer note",
      ...overrides,
    }),
  });
  return res.json();
}

describe("PUT /api/customers/:id", () => {
  it("does not wipe fields omitted from the request body (regression: phone-only edit used to blank accountManager)", async () => {
    const created = await createCustomer();
    expect(created.accountManager).toBe("S. Whitfield");

    // Mirrors the support UI's edit form, which only sends name/company/email/phone/status.
    const res = await fetch(`${baseUrl}/api/customers/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test User",
        company: "Test Co",
        email: "test@test.com",
        phone: "555-9999",
        status: "active",
      }),
    });
    const updated = await res.json();

    expect(res.status).toBe(200);
    expect(updated.phone).toBe("555-9999");
    expect(updated.accountManager).toBe("S. Whitfield");
    expect(updated.lastContacted).toBe("2024-01-01");
    expect(updated.note).toBe("Initial customer note");
  });

  it("still allows explicitly clearing a field with an empty string", async () => {
    const created = await createCustomer();

    const res = await fetch(`${baseUrl}/api/customers/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test User",
        company: "Test Co",
        email: "test@test.com",
        phone: "555-0100",
        status: "active",
        accountManager: "",
      }),
    });
    const updated = await res.json();

    expect(res.status).toBe(200);
    expect(updated.accountManager).toBe("");
  });

  it("404s for an unknown id", async () => {
    const res = await fetch(`${baseUrl}/api/customers/999999`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "555-0000" }),
    });
    expect(res.status).toBe(404);
  });

  it("saves a customer note", async () => {
    const created = await createCustomer({ note: "Call again on Friday" });

    const res = await fetch(`${baseUrl}/api/customers/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "Customer requested an email follow-up" }),
    });
    const updated = await res.json();

    expect(res.status).toBe(200);
    expect(updated.note).toBe("Customer requested an email follow-up");
  });
});

describe("GET /api/customers?status=", () => {
  it("filters results by status", async () => {
    await createCustomer({ status: "churned", company: "Churned Co", email: "churned@test.com" });
    await createCustomer({ status: "prospect", company: "Prospect Co", email: "prospect@test.com" });

    const res = await fetch(`${baseUrl}/api/customers?status=churned`);
    const rows = await res.json();

    expect(res.status).toBe(200);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.status).toBe("churned");
  });

  it("combines status filter with the q search term", async () => {
    const res = await fetch(`${baseUrl}/api/customers?status=churned&q=Churned+Co`);
    const rows = await res.json();

    expect(res.status).toBe(200);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.status).toBe("churned");
      expect(r.company).toBe("Churned Co");
    }
  });

  it("rejects an invalid status value", async () => {
    const res = await fetch(`${baseUrl}/api/customers?status=bogus`);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/customers?company=", () => {
  it("matches on the full company name", async () => {
    await createCustomer({ company: "Filter Co", email: "filterco1@test.com" });
    await createCustomer({ company: "Filter Co", email: "filterco2@test.com" });
    await createCustomer({ company: "Other Co", email: "otherco@test.com" });

    const res = await fetch(`${baseUrl}/api/customers?company=Filter+Co`);
    const rows = await res.json();

    expect(res.status).toBe(200);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) expect(r.company).toBe("Filter Co");
  });

  it("matches on a partial, mid-string fragment of the company name", async () => {
    await createCustomer({ company: "Partialmatchville Inc", email: "partial1@test.com" });

    const res = await fetch(`${baseUrl}/api/customers?company=matchvi`);
    const rows = await res.json();

    expect(res.status).toBe(200);
    expect(rows.some((r: any) => r.company === "Partialmatchville Inc")).toBe(true);
  });

  it("matches on just the leading character of the company name", async () => {
    await createCustomer({ company: "Zylo Systems", email: "zylo@test.com" });

    const res = await fetch(`${baseUrl}/api/customers?company=Z`);
    const rows = await res.json();

    expect(res.status).toBe(200);
    expect(rows.some((r: any) => r.company === "Zylo Systems")).toBe(true);
  });

  it("composes with status and q through the same filter pipeline (AND, not separate code paths)", async () => {
    await createCustomer({ company: "Compose Co", status: "churned", email: "compose-churned@test.com" });
    await createCustomer({ company: "Compose Co", status: "active", email: "compose-active@test.com" });

    // company (partial fragment) + status: only the churned one at Compose Co
    const both = await (await fetch(`${baseUrl}/api/customers?company=ompose&status=churned`)).json();
    expect(both.length).toBe(1);
    expect(both[0].email).toBe("compose-churned@test.com");

    // company + status + q, still intersecting (AND), not OR
    const all3 = await (
      await fetch(`${baseUrl}/api/customers?company=ompose&status=churned&q=compose-churned`)
    ).json();
    expect(all3.length).toBe(1);

    // a combination that matches no single record should return nothing
    const none = await (
      await fetch(`${baseUrl}/api/customers?company=ompose&status=prospect`)
    ).json();
    expect(none.length).toBe(0);
  });

  it("returns an empty list for a company with no customers, rather than erroring", async () => {
    const res = await fetch(`${baseUrl}/api/customers?company=Nonexistent+Fragment+Xyz`);
    const rows = await res.json();
    expect(res.status).toBe(200);
    expect(rows).toEqual([]);
  });
});

describe("GET /api/customers field-specific search", () => {
  it("searches only names when the name field is selected", async () => {
    await createCustomer({ name: "Unique Person", company: "Ordinary Co", email: "ordinary@test.com" });
    await createCustomer({ name: "Ordinary Person", company: "Unique Company", email: "other@test.com" });

    const res = await fetch(`${baseUrl}/api/customers?name=Unique`);
    const rows = await res.json();

    expect(res.status).toBe(200);
    expect(rows.some((r: any) => r.name === "Unique Person")).toBe(true);
    expect(rows.some((r: any) => r.company === "Unique Company")).toBe(false);
  });

  it("searches only emails when the email field is selected", async () => {
    await createCustomer({ name: "Email Person", company: "Email Co", email: "needle@example.com" });

    const res = await fetch(`${baseUrl}/api/customers?email=needle`);
    const rows = await res.json();

    expect(res.status).toBe(200);
    expect(rows.some((r: any) => r.email === "needle@example.com")).toBe(true);
    for (const row of rows) expect(row.email).toContain("needle");
  });
});

describe("GET /api/customers last-contact sorting", () => {
  it("sorts last-contact dates in either direction", async () => {
    await createCustomer({ company: "Date Sort Fixture", email: "older-date@test.com", lastContacted: "2023-02-10" });
    await createCustomer({ company: "Date Sort Fixture", email: "newer-date@test.com", lastContacted: "2025-11-20" });

    const descending = await (
      await fetch(`${baseUrl}/api/customers?company=Date+Sort+Fixture&sort=lastContacted&order=desc`)
    ).json();
    expect(descending.map((row: any) => row.lastContacted)).toEqual(["2025-11-20", "2023-02-10"]);

    const ascending = await (
      await fetch(`${baseUrl}/api/customers?company=Date+Sort+Fixture&sort=lastContacted&order=asc`)
    ).json();
    expect(ascending.map((row: any) => row.lastContacted)).toEqual(["2023-02-10", "2025-11-20"]);
  });
});
