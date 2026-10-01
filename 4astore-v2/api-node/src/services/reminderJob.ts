import cron from 'node-cron';
import { prisma } from '../db';
import { sendToTopic, sendToTokens, tokensForStaff, staffOrderLink, PushMessage } from './push';

// Config (could be moved to env/settings later).
const REMINDER_AFTER_MIN = 5; // first reminder once an order is this old and still pending
const REMINDER_INTERVAL_MIN = 5; // subsequent reminders spaced by this
const MAX_REMINDERS = 3;

/** Finds pending orders that need a reminder and re-notifies staff. */
export async function runReminderSweep(): Promise<void> {
  const cutoff = new Date(Date.now() - REMINDER_AFTER_MIN * 60 * 1000);

  // Still 'Order Placed', old enough, and under the reminder cap.
  const pending = await prisma.order.findMany({
    where: {
      order_status: 'Order Placed',
      order_date: { lte: cutoff },
      reminder_count: { lt: MAX_REMINDERS },
    },
    orderBy: { order_date: 'asc' },
    take: 50,
  });

  if (pending.length === 0) return;

  const staffTokens = await tokensForStaff('orders').catch(() => []);

  for (const order of pending) {
    // Space out reminders: skip if last update was too recent.
    const lastTouch = order.updated_at?.getTime() ?? order.order_date.getTime();
    if (Date.now() - lastTouch < REMINDER_INTERVAL_MIN * 60 * 1000 && order.reminder_count > 0) continue;

    const customer = (order.customer || {}) as { name?: string; city?: string };
    const nextCount = order.reminder_count + 1;
    const msg: PushMessage = {
      title: `⏰ Pending order #${order.order_id} – ₹${order.total_amount}`,
      body: `Reminder ${nextCount}/${MAX_REMINDERS}: ${customer.name || 'A customer'}${customer.city ? ` (${customer.city})` : ''} ka order abhi confirm nahi hua.`,
      data: { type: 'order_reminder', orderId: order.order_id, link: staffOrderLink(order.order_id) },
      channelId: 'orders',
    };
    if (staffTokens.length) await sendToTokens(staffTokens, msg).catch(() => null);
    else await sendToTopic('admins', msg).catch(() => null);

    await prisma.order.update({
      where: { id: order.id },
      data: { reminder_count: nextCount },
    });
  }
}

/** Schedule the sweep every minute. Call once at startup. */
export function startReminderJob(): void {
  cron.schedule('* * * * *', () => {
    runReminderSweep().catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[reminder] sweep failed:', (e as Error).message);
    });
  });
  // eslint-disable-next-line no-console
  console.log('[reminder] job scheduled (every minute).');
}
