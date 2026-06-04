// Public surface of the db package: the Drizzle schema (tables + enums). The
// runtime client + Drizzle/R2 adapters land in a later slice (1c.3); this
// package is schema + migrations only.
export * from "./schema";
