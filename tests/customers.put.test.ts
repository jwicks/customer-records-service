import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";

let base: string;
let server: Server;
let dbm: typeof import("../src/db");

const full = {
  name: "Ana Alvarez",
  company: "Northwind Dairy",
  email: "ana@northwind.com",
  phone: "555-0100",
  status: "active",
  accountManager: "S. Whitfield",
  lastContacted: "2026-01-02",
};

beforeAll(async () => {
  process.env.CUSTOMERS_DB_PATH = ":memory:";
  dbm = await import("../src/db");
  const { app } = await import("../src/server");
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/customers`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  dbm.seed(true);
  dbm.db.prepare(`DELETE FROM CUSTOMER_MASTER`).run();
  dbm.db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'CUSTOMER_MASTER'`).run();
  dbm.db
    .prepare(
      `INSERT INTO CUSTOMER_MASTER (CUST_NM, CO_NM, EMAIL_ADDR, PHONE_NBR, CUST_STS, ACCT_MGR, LAST_CONTACT)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run("Ana Alvarez", "Northwind Dairy", "ana@northwind.com", "555-0100", "active", "S. Whitfield", "2026-01-02");
});

const put = (id: number, body: object) =>
  fetch(`${base}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("PUT /api/customers/:id", () => {
  it("keeps accountManager and lastContacted when the UI payload omits them", async () => {
    const res = await put(1, { name: "Ana B", company: "Northwind Dairy", email: "ana@northwind.com", phone: "555-0199", status: "prospect" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...full, id: 1, name: "Ana B", phone: "555-0199", status: "prospect" });
  });

  it("keeps name and company when omitted", async () => {
    const res = await put(1, { phone: "555-0123" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...full, id: 1, phone: "555-0123" });
  });

  it("rejects empty name or company", async () => {
    expect((await put(1, { name: "" })).status).toBe(400);
    expect((await put(1, { company: "  " })).status).toBe(400);
    const row: any = dbm.db.prepare(`SELECT * FROM CUSTOMER_MASTER WHERE CUST_ID = 1`).get();
    expect(row.CUST_NM).toBe("Ana Alvarez");
    expect(row.CO_NM).toBe("Northwind Dairy");
  });

  it("returns 404 for a missing customer", async () => {
    expect((await put(999, { name: "x" })).status).toBe(404);
  });

  it("leaves no column null after a write", async () => {
    await put(1, { phone: "555-0123" });
    const row: any = dbm.db.prepare(`SELECT * FROM CUSTOMER_MASTER WHERE CUST_ID = 1`).get();
    expect(Object.values(row).every((v) => v !== null)).toBe(true);
  });
});

describe("POST /api/customers", () => {
  it("still requires name and company and fills every column", async () => {
    const headers = { "Content-Type": "application/json" };
    const bad = await fetch(base, { method: "POST", headers, body: JSON.stringify({ name: "Only" }) });
    expect(bad.status).toBe(400);
    const ok = await fetch(base, { method: "POST", headers, body: JSON.stringify({ name: "N", company: "C" }) });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ name: "N", company: "C", email: "", accountManager: "", lastContacted: "" });
  });
});
