import ErrorLog from '../models/ErrorLog.js';

/**
 * Server-side error capture for the admin panel's Error Monitor: everything the server writes with console.error
 * that carries an Error (or is one of our "❌ ..." messages), plus crashes the process would otherwise only print.
 */
let installed = false;
let inside = false; // recording an error must never record its own failure

const describe = (args) => {
    const err = args.find((a) => a instanceof Error);
    const text = args
        .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch (_) { return String(a); } })()))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    return { err, text };
};

export const recordServerError = (message, stack, extra = {}) => {
    if (inside) return;
    inside = true;
    Promise.resolve(ErrorLog.record({ source: 'server', message, stack, platform: 'server', ...extra }))
        .finally(() => { inside = false; });
};

export const installServerErrorMonitor = () => {
    if (installed || process.env.NODE_ENV === 'test' || process.env.ERROR_MONITOR === 'off') return;
    installed = true;
    const original = console.error.bind(console);
    console.error = (...args) => {
        original(...args);
        try {
            if (inside) return;
            const { err, text } = describe(args);
            if (!err && !(typeof args[0] === 'string' && args[0].trim().startsWith('❌'))) return;
            if (!text) return;
            recordServerError(text.slice(0, 2000), err?.stack);
        } catch (_) { }
    };
    // crashes are already written with console.error by server.js's process handlers, so they are caught above
};
