export class UsageError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

export function errorMessage(code) {
    return {
        credentials: 'Conecta tu cuenta desde Ajustes.',
        unauthorized: 'El token no es válido o ha caducado.',
        keyring: 'No se pudo acceder al llavero de Ubuntu.',
        timeout: 'La consulta ha tardado demasiado.',
        network: 'No se pudo conectar con el proveedor.',
        rateLimit: 'Demasiadas consultas. Se volverá a intentar.',
        unavailable: 'El proveedor no está disponible ahora.',
        invalid: 'El proveedor devolvió datos incompletos.',
        codex: 'No se pudo consultar Codex. Revisa tu sesión.',
        missingBinary: 'No se encuentra CodexBar en ~/.local/bin.',
        activity: 'No se pudo consultar la actividad de Codex.',
        unsupported: 'Esta versión de Codex no ofrece estadísticas de tokens.',
    }[code] ?? 'No se pudo actualizar el consumo.';
}

export function normalizeCodex(payload) {
    const entry = Array.isArray(payload) ? payload.find(item => item?.provider === 'codex') : null;
    if (!entry || entry.error || !entry.usage)
        throw new UsageError('codex');
    const usage = entry.usage;
    const windows = [];
    function append(id, title, value) {
        if (!value)
            return;
        if (typeof value.usedPercent !== 'number' || !Number.isFinite(value.usedPercent) || value.usedPercent < 0)
            throw new UsageError('invalid');
        const minutes = Number.isFinite(value.windowMinutes) && value.windowMinutes > 0 ? value.windowMinutes : null;
        const parsedReset = typeof value.resetsAt === 'string' ? Date.parse(value.resetsAt) : NaN;
        windows.push({
            id,
            title,
            usedPercent: value.usedPercent,
            remaining: Math.max(0, 100 - value.usedPercent),
            windowMinutes: minutes,
            resetsAt: Number.isFinite(parsedReset) ? parsedReset : null,
        });
    }
    const titleFor = (window, fallback) => {
        if (window?.windowMinutes === 10080)
            return 'Semanal';
        if (window?.windowMinutes && window.windowMinutes % 60 === 0)
            return window.windowMinutes / 60 + ' horas';
        return fallback;
    };
    append('primary', titleFor(usage.primary, 'Principal'), usage.primary);
    append('secondary', titleFor(usage.secondary, 'Secundaria'), usage.secondary);
    append('tertiary', titleFor(usage.tertiary, 'Adicional'), usage.tertiary);
    return {windows: windows.filter(window => window.windowMinutes === 10080 && window.id !== 'tertiary')};
}

export function normalizeDeepSeek(payload) {
    if (typeof payload?.is_available !== 'boolean' || !Array.isArray(payload.balance_infos) || !payload.balance_infos.length)
        throw new UsageError('invalid');
    const amount = value => {
        if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))
            throw new UsageError('invalid');
        return Number(value);
    };
    const balances = payload.balance_infos.map(item => {
        if (!item || typeof item.currency !== 'string' || !/^[A-Z]{3}$/.test(item.currency))
            throw new UsageError('invalid');
        return {
            currency: item.currency,
            total: amount(item.total_balance),
            paid: amount(item.topped_up_balance),
            promotional: amount(item.granted_balance),
        };
    });
    return {available: payload.is_available, balances};
}

export function weeklyWindow(data) {
    return data?.windows.find(window => window.id === 'secondary' && window.windowMinutes === 10080)
        ?? data?.windows.find(window => window.windowMinutes === 10080 && !window.id.startsWith('extra-'))
        ?? null;
}

export function indicatorWindow(data) {
    return weeklyWindow(data);
}

export function paceColor(window, now = Date.now()) {
    const red = [251, 113, 133];
    const amber = [251, 191, 36];
    const green = [74, 222, 128];
    if (window.remaining <= 0)
        return red;
    const rhythm = pace(window, now);
    if (!rhythm)
        return [91, 220, 250];
    const delta = Math.max(-5, Math.min(5, rhythm.delta));
    const from = delta < 0 ? red : amber;
    const to = delta < 0 ? amber : green;
    const ratio = delta < 0 ? (delta + 5) / 5 : delta / 5;
    return from.map((value, i) => Math.round(value + (to[i] - value) * ratio));
}

export function validDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeActivity(payload) {
    if (!payload || typeof payload !== 'object')
        throw new UsageError('invalid');
    const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    const summary = {};
    for (const key of ['lifetimeTokens', 'peakDailyTokens', 'currentStreakDays'])
        summary[key] = count(payload.summary?.[key]);
    const days = new Map();
    for (const entry of Array.isArray(payload.dailyUsageBuckets) ? payload.dailyUsageBuckets : []) {
        if (validDay(entry?.startDate) && count(entry.tokens) !== null)
            days.set(entry.startDate, {date: entry.startDate, tokens: entry.tokens});
    }
    return {summary, daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date))};
}

export function periodStart(days, now = Date.now()) {
    const date = new Date(now);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - days + 1);
    return date.getTime();
}

export function tokenPeriod(data, days, now = Date.now()) {
    const start = new Date(periodStart(days, now)).toISOString().slice(0, 10);
    const end = new Date(now).toISOString().slice(0, 10);
    const daily = (data?.daily ?? []).filter(day => day.date >= start && day.date <= end);
    return {daily, total: daily.length ? daily.reduce((sum, day) => sum + day.tokens, 0) : null,
        observedDays: daily.length, expectedDays: days};
}

export function number(value, compact = false) {
    if (value === null || value === undefined)
        return '—';
    return new Intl.NumberFormat('es-ES', {notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0}).format(value);
}

export function pace(window, now = Date.now()) {
    if (!window?.resetsAt || !window.windowMinutes || now >= window.resetsAt)
        return null;
    const duration = window.windowMinutes * 60000;
    const idealRemaining = Math.max(0, Math.min(100, (window.resetsAt - now) * 100 / duration));
    const delta = window.remaining - idealRemaining;
    return {idealRemaining, delta, status: delta < -5 ? 'warning' : delta < 0 ? 'caution' : 'good'};
}

export function percent(value, digits = 0) {
    return new Intl.NumberFormat('es-ES', {maximumFractionDigits: digits}).format(value) + ' %';
}

export function money(value, currency, compact = false) {
    return new Intl.NumberFormat('es-ES', {
        style: 'currency', currency, currencyDisplay: compact ? 'narrowSymbol' : 'code',
        minimumFractionDigits: 2, maximumFractionDigits: Math.abs(value) > 0 && Math.abs(value) < 0.01 ? 4 : 2,
    }).format(value);
}

export function countdown(reset, now = Date.now()) {
    if (!reset)
        return 'Reinicio no disponible';
    if (reset <= now)
        return 'Pendiente de actualizar';
    const minutes = Math.ceil((reset - now) / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor(minutes % 1440 / 60);
    if (days)
        return days + ' d ' + hours + ' h';
    if (hours)
        return hours + ' h ' + minutes % 60 + ' min';
    return minutes + ' min';
}

export function age(timestamp, now = Date.now()) {
    if (!timestamp)
        return 'Sin actualizar';
    const minutes = Math.floor(Math.max(0, now - timestamp) / 60000);
    if (!minutes)
        return 'Actualizado ahora';
    if (minutes < 60)
        return 'Hace ' + minutes + ' min';
    return 'Hace ' + Math.floor(minutes / 60) + ' h';
}
