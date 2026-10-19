// db.ts
// Data layer for CUSTOMER_MASTER. Schema and column names come from the 2021
// migration off the legacy AS/400 system. DO NOT rename columns -- the nightly
// export job (see company ticket FS-1142) still reads them by name.

import Database from "better-sqlite3";
import path from "path";

// CUSTOMERS_DB_PATH lets tests use ":memory:" or a temp file.
const DB_PATH = process.env.CUSTOMERS_DB_PATH || path.join(__dirname, "..", "customers.db");

export const db = new Database(DB_PATH);

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS CUSTOMER_MASTER (
      CUST_ID      INTEGER PRIMARY KEY AUTOINCREMENT,
      CUST_NM      TEXT,
      CO_NM        TEXT,
      EMAIL_ADDR   TEXT,
      PHONE_NBR    TEXT,
      CUST_STS     TEXT,
      ACCT_MGR     TEXT,
      LAST_CONTACT TEXT
    );
  `);
}

const FIRST = ["Ana","Ben","Carla","Diego","Elena","Frank","Grace","Hassan","Iris","Jon","Kira","Liam","Mona","Nate","Olga","Paul","Quinn","Rosa","Sam","Tina","Umar","Vera","Will","Xena","Yusuf","Zoe","Adam","Bree","Cole","Dana"];
const LAST = ["Alvarez","Brooks","Chen","Dawson","Egan","Fields","Garza","Holt","Ibrahim","Jensen","Kim","Lopez","Mercer","Nolan","Ortiz","Price","Reyes","Silva","Tran","Underwood","Vance","Walsh","Xu","Young","Zimmer","Archer","Barlow","Cruz","Doyle","Ellis"];
const COMPANIES = ["Northwind Dairy","Apex Plumbing Co","Bluegrass Logistics","Cedar Ridge HVAC","Delta Print Group","Emerald Landscaping","Foxtrot Security","Gulf Coast Marine","Highline Elevators","Ironwood Cabinets","Juniper Med Supply","Keystone Paving","Lakeview Optical","Maple Grove Foods","Nimbus Cleaning","Oakfield Storage","Pinnacle Signs","Quarry Stoneworks","Redline Towing","Summit Roofing","Trailhead Outfitters","Union Electric Svc","Valley Vet Clinic","Westgate Auto Parts","Yellowpine Lumber","Zephyr Couriers","Anchor Bay Seafood","Birchwood Interiors","Copperline Welding","Dockside Freight"];
const STATUSES = ["active","active","active","prospect","churned"]; // weighted toward active
const MANAGERS = ["S. Whitfield","M. Okafor","J. Devine","R. Castellanos"];

export function seed(reset = false) {
  if (reset) db.exec(`DROP TABLE IF EXISTS CUSTOMER_MASTER;`);
  initSchema();
  const count = db.prepare(`SELECT COUNT(*) AS n FROM CUSTOMER_MASTER`).get() as { n: number };
  if (count.n > 0) return;

  const insert = db.prepare(`
    INSERT INTO CUSTOMER_MASTER (CUST_NM, CO_NM, EMAIL_ADDR, PHONE_NBR, CUST_STS, ACCT_MGR, LAST_CONTACT)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < 30; i++) {
    const name = `${FIRST[i]} ${LAST[i]}`;
    const company = COMPANIES[i];
    const email = `${FIRST[i]}.${LAST[i]}@${company.toLowerCase().replace(/[^a-z]/g, "")}.com`;
    const phone = `555-01${String(10 + i)}`;
    const status = STATUSES[i % STATUSES.length];
    const mgr = MANAGERS[i % MANAGERS.length];
    const daysAgo = (i * 13) % 180;
    const lastContact = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
    insert.run(name, company, email, phone, status, mgr, lastContact);
  }
  console.log("Seeded CUSTOMER_MASTER with 30 customers.");
}

// Allow: npm run seed:reset
if (require.main === module) {
  seed(process.argv.includes("--reset"));
  console.log("Done.");
}
