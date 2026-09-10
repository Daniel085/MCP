#!/usr/bin/env node
/**
 * A tiny in-memory stand-in for the upstream Items API. Used by the smoke test
 * and for trying the server locally without real credentials.
 *
 *   GET  /items?q=&limit=&offset=   -> { items, total, offset, limit }
 *   GET  /items/:id                 -> item | 404
 *   POST /items { name, description } -> 201 item | 422
 *
 * Send Authorization: Bearer bad-key to get a 401, useful for error-path demos.
 */
import express from "express";
import { seedItems, type FakeItem } from "./fake-data.js";

export function createFakeApi() {
  const app = express();
  app.use(express.json());
  const items: FakeItem[] = seedItems();

  app.use((req, res, next) => {
    if (req.headers.authorization === "Bearer bad-key") {
      res.status(401).json({ error: { message: "invalid api key" } });
      return;
    }
    next();
  });

  app.get("/items", (req, res) => {
    const q = String(req.query.q ?? "").toLowerCase();
    const limit = Math.min(Number(req.query.limit ?? 10), 100);
    const offset = Number(req.query.offset ?? 0);
    const matched = q
      ? items.filter((i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))
      : items;
    res.json({ items: matched.slice(offset, offset + limit), total: matched.length, offset, limit });
  });

  app.get("/items/:id", (req, res) => {
    const item = items.find((i) => i.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: { message: `item ${req.params.id} does not exist` } });
      return;
    }
    res.json(item);
  });

  app.post("/items", (req, res) => {
    const { name, description } = (req.body ?? {}) as { name?: string; description?: string };
    if (!name || typeof name !== "string") {
      res.status(422).json({ error: { message: "name is required" } });
      return;
    }
    const item: FakeItem = {
      id: `itm_${items.length + 1}`,
      name,
      description: description ?? "",
      createdAt: new Date().toISOString(),
    };
    items.push(item);
    res.status(201).json(item);
  });

  return app;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const port = Number(process.env.FAKE_API_PORT ?? 4010);
  createFakeApi().listen(port, "127.0.0.1", () => {
    process.stderr.write(`fake items api listening on http://127.0.0.1:${port}\n`);
  });
}
