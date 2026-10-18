/**
 * Sync queue repository: the durable pending-operation log for the future
 * cloud sync engine (Phase 9). It only RECORDS work — it never contacts
 * the backend, retries against live endpoints, or claims end-to-end sync.
 *
 * Queueing is explicit: repositories do NOT auto-queue. Future callers that
 * own entity semantics (e.g. the future progress service) decide what to
 * enqueue.
 *
 * Future sync engine contract (documented, not implemented):
 * - Consume via `listPendingOperations`, mark `processing`, then
 *   `markCompleted` or `markFailed` with a sanitized error summary.
 * - Operations should be applied idempotently on the server keyed by
 *   (entity_type, entity_id); payloads carry the new revision.
 * - Payloads must be redacted server-side secrets; never log full payloads.
 */

import type { SqlDriver } from "../driver";
import { newId, nowIso } from "../ids";
import { requireDriver } from "../driver";
import { LocalDbError } from "../errors";
import { type QueueEntry, type QueueOperation, type QueueStatus } from "../domain";

interface QueueRow extends Omit<QueueEntry, "status" | "operation_type"> {
  status: string;
  operation_type: string;
}

const SELECT = `SELECT id, entity_type, entity_id, operation_type, payload, attempt_count,
  next_attempt_at, last_attempt_at, last_error, status, created_at FROM sync_queue`;

function toDomain(row: QueueRow): QueueEntry {
  return {
    ...row,
    operation_type: row.operation_type as QueueOperation,
    status: row.status as QueueStatus,
  };
}

const QUEUE_OPERATIONS: readonly QueueOperation[] = ["create", "update", "delete"];
const QUEUE_STATUSES: readonly QueueStatus[] = ["pending", "processing", "completed", "failed"];

function asOperation(value: unknown): QueueOperation {
  const op = QUEUE_OPERATIONS.find((candidate) => candidate === value);
  if (!op) throw new LocalDbError("validation_failed", "operation_type is invalid.");
  return op;
}

function asStatus(value: unknown): QueueStatus {
  const status = QUEUE_STATUSES.find((candidate) => candidate === value);
  if (!status) throw new LocalDbError("validation_failed", "status is invalid.");
  return status;
}

/** Record a future sync operation. Works fully offline; no network involved. */
export async function enqueueOperation(
  db: SqlDriver,
  input: {
    entity_type: string;
    entity_id: string;
    operation_type: QueueOperation;
    payload?: string | null;
  }
): Promise<QueueEntry> {
  const driver = requireDriver(db);
  const operation = asOperation(input.operation_type);
  const entityType = input.entity_type.trim();
  const entityId = input.entity_id.trim();
  if (!entityType || !entityId) {
    throw new LocalDbError("validation_failed", "entity_type and entity_id are required.");
  }
  const id = newId();
  await driver.runAsync(
    `INSERT INTO sync_queue (id, entity_type, entity_id, operation_type, payload,
      attempt_count, next_attempt_at, last_attempt_at, last_error, status, created_at)
     VALUES (?,?,?,?,?,0,NULL,NULL,NULL,'pending',?)`,
    [id, entityType, entityId, operation, input.payload ?? null, nowIso()]
  );
  const row = await driver.getFirstAsync<QueueRow>(`${SELECT} WHERE id = ?`, [id]);
  if (!row) throw new LocalDbError("query_failed", "The queue entry could not be read back.");
  return toDomain(row);
}

/** Pending operations, oldest first (the order a sync engine should drain). */
export async function listPendingOperations(
  db: SqlDriver,
  limit?: number
): Promise<QueueEntry[]> {
  const cap = limit ?? 100;
  if (!Number.isInteger(cap) || cap < 1) {
    throw new LocalDbError("validation_failed", "limit must be a positive integer.");
  }
  const rows = await requireDriver(db).getAllAsync<QueueRow>(
    `${SELECT} WHERE status = 'pending' ORDER BY created_at, id LIMIT ?`,
    [cap]
  );
  return rows.map(toDomain);
}

/** Update status; moving to processing/failed records an attempt. */
export async function updateOperationStatus(
  db: SqlDriver,
  operationId: string,
  status: QueueStatus,
  options?: { errorSummary?: string; retryDelayMs?: number }
): Promise<QueueEntry> {
  const driver = requireDriver(db);
  const next = asStatus(status);
  const sets: string[] = ["status = ?"];
  const params: (string | number | null)[] = [next];
  // An attempt starts when the engine claims an operation ("processing").
  // Terminal states for that same attempt ("failed"/"completed") do not
  // count a second attempt.
  if (next === "processing") {
    sets.push("attempt_count = attempt_count + 1", "last_attempt_at = ?");
    params.push(nowIso());
  }
  if (options?.errorSummary !== undefined) {
    sets.push("last_error = ?");
    params.push(options.errorSummary.slice(0, 500));
  }
  if (next === "pending" && options?.retryDelayMs !== undefined) {
    sets.push("next_attempt_at = ?");
    params.push(new Date(Date.now() + options.retryDelayMs).toISOString());
  }
  params.push(operationId);
  const result = await driver.runAsync(
    `UPDATE sync_queue SET ${sets.join(", ")} WHERE id = ?`,
    params
  );
  if (result.rowsAffected === 0) {
    throw new LocalDbError("not_found", "That queue operation no longer exists.");
  }
  const row = await driver.getFirstAsync<QueueRow>(`${SELECT} WHERE id = ?`, [operationId]);
  if (!row) throw new LocalDbError("not_found", "That queue operation no longer exists.");
  return toDomain(row);
}

/** Remove completed entries (housekeeping only; never touches pending work). */
export async function purgeCompletedOperations(db: SqlDriver): Promise<number> {
  const result = await requireDriver(db).runAsync(
    `DELETE FROM sync_queue WHERE status = 'completed'`
  );
  return result.rowsAffected;
}
