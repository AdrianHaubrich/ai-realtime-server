import express from "express";
import routes from "./routes/index.js";
import { port } from "./config.js";

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[http] ${req.method} ${req.originalUrl}`);
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

app.use(routes);

app.listen(port, () => {
  console.log(`ai-realtime-server listening on http://localhost:${port}`);
});
