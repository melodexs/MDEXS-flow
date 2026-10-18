/**
 * Local database errors.
 *
 * Codes are stable, machine-readable values; messages are safe to show in
 * logs/UI and never include SQL parameters, connection strings, or
 * serialized payloads.
 */
export type LocalDbErrorCode =
  | "not_initialized"
  | "validation_failed"
  | "referenced_item"
  | "not_found"
  | "migration_failed"
  | "query_failed";

export class LocalDbError extends Error {
  readonly code: LocalDbErrorCode;

  constructor(code: LocalDbErrorCode, message: string) {
    super(message);
    this.name = "LocalDbError";
    this.code = code;
  }
}
