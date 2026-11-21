// Daily plan reminders sent as push notifications (only to users who have the app with notifications on).
// Each reminder goes out once: 3 days, 1 day and 0 days before a time plan ends, the day after it ended,
// and when a print pack runs low or runs out. Safe to run as often as you like.
import Push from '../models/Push.js';
import Subscription from '../models/Subscription.js';
import { isPushConfigured } from '../utils/push.js';

const LOW_PRINTS = 10;

export function reminderFor(quota) {
    if (quota.planType === 'time' && quota.expiresAt) {
        const end = String(quota.expiresAt).slice(0, 10);
        const d = Number(quota.daysRemaining);
        const plan = quota.activePlanName || 'plan';
        if (d === 3) return { key: `plan_expiry:${end}:3`, title: 'Your plan ends in 3 days', body: `Your ${plan} ends on ${end}. Recharge now to keep billing without a break.` };
        if (d === 1) return { key: `plan_expiry:${end}:1`, title: 'Last day tomorrow', body: `Your ${plan} ends tomorrow. Recharge today to avoid any interruption.` };
        if (d === 0) return { key: `plan_expiry:${end}:0`, title: 'Your plan ends today', body: `Your ${plan} ends today. Recharge now to keep printing bills.` };
        if (d < 0 && d >= -2) return { key: `plan_expired:${end}`, title: 'Your plan has ended', body: `Your ${plan} has ended. Recharge to continue billing with Slipzen.` };
        return null;
    }
    // print packs (the free starter prints included once a plan has been bought or the reward claimed)
    if (quota.isFreeTier && !quota.onboardingRewardClaimed) return null;
    const left = Number(quota.printsRemaining);
    const total = Number(quota.totalPrints || 0);
    if (left <= 0) return { key: `no_prints:${total}`, title: 'You have no prints left', body: 'Recharge now so you can keep printing bills for your customers.' };
    if (left <= LOW_PRINTS) return { key: `low_prints:${total}`, title: `Only ${left} prints left`, body: 'Your prints are running low. Recharge soon to avoid a break in billing.' };
    return null;
}

export async function runPlanReminders() {
    if (!isPushConfigured()) return { checked: 0, sent: 0, skipped: 'push not configured' };
    const rows = await Push.allTokens();
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    let sent = 0;
    for (const userId of userIds) {
        try {
            const quota = await Subscription.getQuotaByUserId(userId);
            const r = reminderFor(quota);
            if (!r) continue;
            if (!(await Push.markOnce(userId, r.key))) continue;
            const res = await Push.sendToUser(userId, { title: r.title, body: r.body, data: { kind: 'plan_reminder', view: 'pricing' } });
            sent += res.sent;
        } catch (err) {
            console.warn('⚠️ Plan reminder failed for a user:', err.message);
        }
    }
    return { checked: userIds.length, sent };
}

/** On a normal server (not Vercel): check a minute after start and then every 6 hours */
export function startPlanReminderTimer() {
    const run = () => runPlanReminders()
        .then((r) => { if (r.sent) console.log(`🔔 Plan reminders sent: ${r.sent}`); })
        .catch((err) => console.warn('⚠️ Plan reminders:', err.message));
    setTimeout(run, 60 * 1000).unref?.();
    setInterval(run, 6 * 60 * 60 * 1000).unref?.();
}
