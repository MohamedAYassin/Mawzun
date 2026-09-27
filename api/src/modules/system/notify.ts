// Shared notification helper for sync events (system module).
//
// Company-wide notification (userId null) with an anti-spam action key, same
// pattern as the low-stock alerts in inventory/movementWithAlerts.ts but for
// the SYSTEM category. Best-effort by contract: callers already swallow
// errors — a notification failure must never fail the sync flow it reports.

import { NotificationCategory } from "../../generated/prisma/client.js";
import type { Db } from "../../config/database.js";

export interface SyncNotificationInput {
  /** Anti-spam key, e.g. "sync-error:<storeId>:<errorType>". One unread row
   *  with the same action suppresses duplicates. */
  action: string;
  title: string;
  message: string;
  /** Where the reader lands, e.g. /dashboard/sync-errors */
  link?: string;
}

export async function notifyCompany(
  tx: Db,
  companyId: string,
  input: SyncNotificationInput
): Promise<void> {
  const existing = await tx.notification.findFirst({
    where: {
      companyId,
      userId: null,
      category: NotificationCategory.SYSTEM,
      isRead: false,
      action: input.action,
    },
    select: { id: true },
  });
  if (existing) return;

  await tx.notification.create({
    data: {
      companyId,
      userId: null,
      title: input.title,
      message: input.message,
      category: NotificationCategory.SYSTEM,
      link: input.link ?? null,
      action: input.action,
    },
  });
}
