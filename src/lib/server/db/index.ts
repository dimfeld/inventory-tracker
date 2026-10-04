import type { Database } from "bun:sqlite";
import { DATABASE_PATH } from "$app/env/private";
import { openDatabase } from "./connection";

let db: Database | undefined;

/** The app's shared database connection, opened on first use. */
export function getDb(): Database {
  db ??= openDatabase(DATABASE_PATH);
  return db;
}
