// Push notifications to the Android app through Firebase Cloud Messaging (FCM).
// Needs the Firebase service account in the environment, one of:
//   FIREBASE_SERVICE_ACCOUNT        the service-account JSON (as is, or base64 encoded)
//   GOOGLE_APPLICATION_CREDENTIALS  path to the service-account JSON file
// Without it nothing is sent and isPushConfigured() is false; the rest of the app works as usual.
import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

let messaging = null;
let initTried = false;

function init() {
    if (initTried) return messaging;
    initTried = true;
    try {
        const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
        let credential = null;
        if (raw) {
            const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
            const account = JSON.parse(text);
            if (account.private_key) account.private_key = account.private_key.replace(/\\n/g, '\n');
            credential = cert(account);
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            credential = applicationDefault();
        }
        if (!credential) {
            console.log('🔕 Push notifications off: FIREBASE_SERVICE_ACCOUNT is not set');
            return null;
        }
        const app = getApps().length ? getApps()[0] : initializeApp({ credential });
        messaging = getMessaging(app);
        console.log('🔔 Push notifications ready (Firebase Cloud Messaging)');
    } catch (err) {
        console.warn('⚠️ Push notifications off: could not read the Firebase service account:', err.message);
        messaging = null;
    }
    return messaging;
}

export const isPushConfigured = () => Boolean(init());

// Tokens Firebase says no longer exist (app uninstalled, data cleared): they are removed from the database
const DEAD_TOKEN_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument'
]);

/**
 * Sends one notification to many devices. Shown by Android even when the app is closed.
 * data values must be strings; "view" opens that page of the app when the notification is tapped.
 * Returns { sent, failed, deadTokens }.
 */
export async function sendPush(tokens, { title, body, data = {} }) {
    const unique = [...new Set((tokens || []).filter(Boolean))];
    const result = { sent: 0, failed: 0, deadTokens: [] };
    if (!unique.length) return result;
    const m = init();
    if (!m) {
        result.failed = unique.length;
        return result;
    }
    const stringData = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));

    // FCM takes at most 500 devices per call
    for (let i = 0; i < unique.length; i += 500) {
        const batch = unique.slice(i, i + 500);
        try {
            const res = await m.sendEachForMulticast({
                tokens: batch,
                notification: { title: String(title).slice(0, 100), body: String(body).slice(0, 500) },
                data: stringData,
                android: {
                    priority: 'high',
                    notification: {
                        channelId: 'important',
                        sound: 'default',
                        defaultVibrateTimings: true,
                        color: '#0284c7'
                    }
                }
            });
            result.sent += res.successCount;
            result.failed += res.failureCount;
            res.responses.forEach((r, idx) => {
                if (!r.success && DEAD_TOKEN_CODES.has(r.error?.code)) result.deadTokens.push(batch[idx]);
            });
        } catch (err) {
            console.warn('⚠️ Push send failed:', err.message);
            result.failed += batch.length;
        }
    }
    return result;
}
