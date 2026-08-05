// routes.ts
// Customer records API. Ported from the legacy CGI handlers during the 2021
// migration; saveCustomer keeps the original handler's shape "for parity".

import { Router, Request, Response } from "express";
import { db } from "./db";

export const router = Router();

const VALID_STATUSES = ["active", "prospect", "churned"];

// Each entry reads one query param and, if present, contributes a clause +
// bind params. GET /customers ANDs together whatever filters were supplied,
// so any subset (q alone, status alone, company alone, or all three) goes
// through the same query-building path instead of separate branches.
type Filter = {
  param: string;
  validate?: (value: string, res: Response) => boolean; // returns false if it already sent an error response
  build: (value: string) => { clause: string; params: string[] };
};

const FILTERS: Filter[] = [
  {
    param: "q",
    build: (value) => {
      const like = `%${value}%`;
      return { clause: "(CUST_NM LIKE ? OR CO_NM LIKE ? OR EMAIL_ADDR LIKE ?)", params: [like, like, like] };
    },
  },
  {
    param: "status",
    validate: (value, res) => {
      if (VALID_STATUSES.includes(value)) return true;
      res.status(400).json({ error: "status must be active, prospect, or churned" });
      return false;
    },
    build: (value) => ({ clause: "CUST_STS = ?", params: [value] }),
  },
  {
    param: "name",
    build: (value) => ({ clause: "CUST_NM LIKE ?", params: [`%${value}%`] }),
  },
  {
    // Partial match: full name, a substring, or just the leading
    // character all narrow the results via the same LIKE clause.
    param: "company",
    build: (value) => ({ clause: "CO_NM LIKE ?", params: [`%${value}%`] }),
  },
  {
    param: "email",
    build: (value) => ({ clause: "EMAIL_ADDR LIKE ?", params: [`%${value}%`] }),
  },
];

// GET /api/customers?name=ana, ?company=north, ?email=example.com,
// or combine filters (including q and status) with AND semantics.
router.get("/customers", (req: Request, res: Response) => {
  const clauses: string[] = [];
  const params: string[] = [];
  const sort = (req.query.sort as string) || "";
  const order = ((req.query.order as string) || "desc").toLowerCase();

  if (sort && sort !== "lastContacted") {
    return res.status(400).json({ error: "sort must be lastContacted" });
  }
  if (sort && !["asc", "desc"].includes(order)) {
    return res.status(400).json({ error: "order must be asc or desc" });
  }

  for (const filter of FILTERS) {
    const value = (req.query[filter.param] as string) || "";
    if (!value) continue;
    if (filter.validate && !filter.validate(value, res)) return;
    const built = filter.build(value);
    clauses.push(built.clause);
    params.push(...built.params);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const orderBy = sort === "lastContacted"
    ? `ORDER BY CASE WHEN LAST_CONTACT IS NULL OR LAST_CONTACT = '' THEN 1 ELSE 0 END, LAST_CONTACT ${order.toUpperCase()}`
    : "ORDER BY CO_NM";
  const rows = db
    .prepare(`SELECT * FROM CUSTOMER_MASTER ${where} ${orderBy}`)
    .all(...params);
  res.json(rows.map(toApi));
});

// GET /api/customers/:id
router.get("/customers/:id", (req: Request, res: Response) => {
  const row = db
    .prepare(`SELECT * FROM CUSTOMER_MASTER WHERE CUST_ID = ?`)
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: "customer not found" });
  res.json(toApi(row));
});

// POST /api/customers   (create)
// PUT  /api/customers/:id  (update)
router.post("/customers", (req, res) => saveCustomer(req, res));
router.put("/customers/:id", (req, res) => saveCustomer(req, res));

// saveCustomer: validation + legacy field mapping + persistence + response
// shaping, all in one place, same as the old system. "If it ain't broke."
function saveCustomer(req: Request, res: Response) {
  const b = req.body || {};

  // --- validation ---
  if (req.method === "POST") {
    if (!b.name || !b.company) {
      return res.status(400).json({ error: "name and company are required" });
    }
  }
  if (b.email && !String(b.email).includes("@")) {
    return res.status(400).json({ error: "email looks invalid" });
  }
  if (b.status && !["active", "prospect", "churned"].includes(b.status)) {
    return res.status(400).json({ error: "status must be active, prospect, or churned" });
  }

  // --- map API fields to legacy columns ---
  // NOTE: legacy export job expects every column present on write (FS-1142),
  // so we always build the full record.

  // --- persistence ---
  if (req.method === "PUT") {
    const id = req.params.id;
    const existing = db
      .prepare(`SELECT * FROM CUSTOMER_MASTER WHERE CUST_ID = ?`)
      .get(id) as any;
    if (!existing) return res.status(404).json({ error: "customer not found" });

    // Merge onto the existing row: a field the client omitted (undefined)
    // keeps its current value. Only an explicit "" clears it. Prevents
    // partial edits (e.g. phone-only) from wiping fields like accountManager.
    const record = {
      CUST_NM: b.name ?? existing.CUST_NM,
      CO_NM: b.company ?? existing.CO_NM,
      EMAIL_ADDR: b.email ?? existing.EMAIL_ADDR,
      PHONE_NBR: b.phone ?? existing.PHONE_NBR,
      CUST_STS: b.status ?? existing.CUST_STS,
      ACCT_MGR: b.accountManager ?? existing.ACCT_MGR,
      LAST_CONTACT: b.lastContacted ?? existing.LAST_CONTACT,
      NOTE: b.note ?? existing.NOTE,
    };

    db.prepare(
      `UPDATE CUSTOMER_MASTER
       SET CUST_NM = ?, CO_NM = ?, EMAIL_ADDR = ?, PHONE_NBR = ?,
           CUST_STS = ?, ACCT_MGR = ?, LAST_CONTACT = ?, NOTE = ?
       WHERE CUST_ID = ?`
    ).run(
      record.CUST_NM,
      record.CO_NM,
      record.EMAIL_ADDR,
      record.PHONE_NBR,
      record.CUST_STS,
      record.ACCT_MGR,
      record.LAST_CONTACT,
      record.NOTE,
      id
    );
    const row = db.prepare(`SELECT * FROM CUSTOMER_MASTER WHERE CUST_ID = ?`).get(id);
    return res.json(toApi(row));
  }

  // POST (create): no existing row to merge onto, so missing fields default to "".
  const record = {
    CUST_NM: b.name ?? "",
    CO_NM: b.company ?? "",
    EMAIL_ADDR: b.email ?? "",
    PHONE_NBR: b.phone ?? "",
    CUST_STS: b.status ?? "",
    ACCT_MGR: b.accountManager ?? "",
    LAST_CONTACT: b.lastContacted ?? "",
    NOTE: b.note ?? "",
  };

  const info = db
    .prepare(
      `INSERT INTO CUSTOMER_MASTER
        (CUST_NM, CO_NM, EMAIL_ADDR, PHONE_NBR, CUST_STS, ACCT_MGR, LAST_CONTACT, NOTE)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.CUST_NM,
      record.CO_NM,
      record.EMAIL_ADDR,
      record.PHONE_NBR,
      record.CUST_STS,
      record.ACCT_MGR,
      record.LAST_CONTACT,
      record.NOTE
    );
  const row = db
    .prepare(`SELECT * FROM CUSTOMER_MASTER WHERE CUST_ID = ?`)
    .get(info.lastInsertRowid);
  res.status(201).json(toApi(row));
}

// Legacy column names -> API shape
function toApi(row: any) {
  return {
    id: row.CUST_ID,
    name: row.CUST_NM,
    company: row.CO_NM,
    email: row.EMAIL_ADDR,
    phone: row.PHONE_NBR,
    status: row.CUST_STS,
    accountManager: row.ACCT_MGR,
    lastContacted: row.LAST_CONTACT,
    note: row.NOTE || "",
  };
}
