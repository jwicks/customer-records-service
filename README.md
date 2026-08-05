# Customer Records Service

A slice of a fictional company's product used by the support team to look up and maintain
customer records. The data model was migrated from the legacy AS/400 system in
2021; the column names were kept for compatibility with the nightly export job.

## Run it

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Then open http://localhost:3000

The SQLite database (`customers.db`) is created and seeded with 30 customers on
first run. To reset the data at any time:

```bash
npm run seed:reset
```

## API

| Method | Path                 | Notes                              |
|--------|----------------------|------------------------------------|
| GET    | /api/customers       | List customers. Filter with `?name=`, `?company=`, `?email=`, `?status=`, or broad search using `?q=`. Sort dates with `?sort=lastContacted&order=asc|desc`. |
| GET    | /api/customers/:id   | Fetch one customer.                |
| POST   | /api/customers       | Create a customer.                 |
| PUT    | /api/customers/:id   | Update a customer.                 |

Customer fields: `id`, `name`, `company`, `email`, `phone`,
`status` (`active` | `prospect` | `churned`), `accountManager`, `lastContacted`, `note`.

## Tests

Vitest is set up (`npm test`). There are currently no tests.

## Layout

```
src/server.ts   - Express app entry point
src/routes.ts   - API routes
src/db.ts       - SQLite data layer + seed data
public/         - support team UI
tests/          - empty, vitest configured
```
