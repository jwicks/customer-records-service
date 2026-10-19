// routes.ts
// Customer records API. Ported from the legacy CGI handlers during the 2021
// migration; saveCustomer keeps the original handler's shape "for parity".

import { Router, Request, Response } from "express";
import { db } from "./db";

export const router = Router();

// GET /api/customers?q=searchTerm
router.get("/customers", (req: Request, res: Response) => {
  const q = (req.query.q as string) || "";
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db
      .prepare(
        `SELECT * FROM CUSTOMER_MASTER
         WHERE CUST_NM LIKE ? OR CO_NM LIKE ? OR EMAIL_ADDR LIKE ?
         ORDER BY CO_NM`
      )
      .all(like, like, like);
  } else {
    rows = db.prepare(`SELECT * FROM CUSTOMER_MASTER ORDER BY CO_NM`).all();
  }
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
  if (req.method === "PUT") {
    // name/company may be omitted (kept as stored) but never blanked
    for (const key of ["name", "company"]) {
      if (b[key] != null && !String(b[key]).trim()) {
        return res.status(400).json({ error: `${key} must not be empty` });
      }
    }
  }
  if (b.email && !String(b.email).includes("@")) {
    return res.status(400).json({ error: "email looks invalid" });
  }
  if (b.status && !["active", "prospect", "churned"].includes(b.status)) {
    return res.status(400).json({ error: "status must be active, prospect, or churned" });
  }

  // On PUT, omitted fields keep their stored values (merge onto existing row).
  const id = req.params.id;
  const existing: any =
    req.method === "PUT"
      ? db.prepare(`SELECT * FROM CUSTOMER_MASTER WHERE CUST_ID = ?`).get(id)
      : null;
  if (req.method === "PUT" && !existing) {
    return res.status(404).json({ error: "customer not found" });
  }
  const prev = existing || {};

  // --- map API fields to legacy columns ---
  // NOTE: legacy export job expects every column present on write (FS-1142),
  // so we always build the full record.
  const record = {
    CUST_NM: b.name ?? prev.CUST_NM ?? "",
    CO_NM: b.company ?? prev.CO_NM ?? "",
    EMAIL_ADDR: b.email ?? prev.EMAIL_ADDR ?? "",
    PHONE_NBR: b.phone ?? prev.PHONE_NBR ?? "",
    CUST_STS: b.status ?? prev.CUST_STS ?? "",
    ACCT_MGR: b.accountManager ?? prev.ACCT_MGR ?? "",
    LAST_CONTACT: b.lastContacted ?? prev.LAST_CONTACT ?? "",
  };

  // --- persistence ---
  if (req.method === "PUT") {

    db.prepare(
      `UPDATE CUSTOMER_MASTER
       SET CUST_NM = ?, CO_NM = ?, EMAIL_ADDR = ?, PHONE_NBR = ?,
           CUST_STS = ?, ACCT_MGR = ?, LAST_CONTACT = ?
       WHERE CUST_ID = ?`
    ).run(
      record.CUST_NM,
      record.CO_NM,
      record.EMAIL_ADDR,
      record.PHONE_NBR,
      record.CUST_STS,
      record.ACCT_MGR,
      record.LAST_CONTACT,
      id
    );
    const row = db.prepare(`SELECT * FROM CUSTOMER_MASTER WHERE CUST_ID = ?`).get(id);
    return res.json(toApi(row));
  }

  const info = db
    .prepare(
      `INSERT INTO CUSTOMER_MASTER
        (CUST_NM, CO_NM, EMAIL_ADDR, PHONE_NBR, CUST_STS, ACCT_MGR, LAST_CONTACT)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.CUST_NM,
      record.CO_NM,
      record.EMAIL_ADDR,
      record.PHONE_NBR,
      record.CUST_STS,
      record.ACCT_MGR,
      record.LAST_CONTACT
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
  };
}
