// server.ts
import express from "express";
import path from "path";
import { router } from "./routes";
import { seed } from "./db";

const app = express();
app.use(express.json());
app.use("/api", router);
app.use(express.static(path.join(__dirname, "..", "public")));

// Only seed and listen when run directly (npm run dev), not when imported by tests.
if (require.main === module) {
  seed();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Customer records service running at http://localhost:${PORT}`);
  });
}

export { app };
