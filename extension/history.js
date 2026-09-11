import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {weeklyWindow} from './model.js';

export const SAMPLE_MS = 5 * 60000;
export const RETENTION_MS = 30 * 86400000;

export function emptyHistory() {
    return {version: 1, quota: [], balances: []};
}

export function normalizeHistory(value, now = Date.now()) {
    if (!value || value.version !== 1 || !Array.isArray(value.quota) || !Array.isArray(value.balances))
        throw new Error('invalid-history');
    const recent = point => Number.isFinite(point?.time) && point.time > now - RETENTION_MS && point.time <= now;
    const quota = value.quota.filter(point => recent(point) && Number.isFinite(point.used) && point.used >= 0
        && (point.reset === null || Number.isFinite(point.reset)))
        .map(({time, used, reset}) => ({time, used, reset})).sort((a, b) => a.time - b.time).slice(-9000);
    const balances = value.balances.filter(point => recent(point) && /^[A-Z]{3}$/.test(point.currency)
        && ['total', 'paid', 'promotional'].every(key => Number.isFinite(point[key])))
        .map(({time, currency, total, paid, promotional}) => ({time, currency, total, paid, promotional}))
        .sort((a, b) => a.time - b.time).slice(-27000);
    return {version: 1, quota, balances};
}

export function recordSample(history, provider, data, time = Date.now()) {
    const sameSlot = point => point && Math.floor(point.time / SAMPLE_MS) === Math.floor(time / SAMPLE_MS);
    if (provider === 'codex') {
        const window = weeklyWindow(data);
        if (!window)
            return false;
        const last = history.quota.at(-1);
        if (sameSlot(last) && last.reset === window.resetsAt)
            return false;
        history.quota.push({time, used: window.usedPercent, reset: window.resetsAt});
    } else if (provider === 'deepseek') {
        let changed = false;
        for (const balance of data.balances) {
            const last = history.balances.findLast(point => point.currency === balance.currency);
            if (!sameSlot(last)) {
                history.balances.push({time, ...balance});
                changed = true;
            }
        }
        if (!changed)
            return false;
    } else {
        return false;
    }
    const cutoff = time - RETENTION_MS;
    history.quota = history.quota.filter(point => point.time > cutoff).slice(-9000);
    history.balances = history.balances.filter(point => point.time > cutoff).slice(-27000);
    return true;
}

export function segments(points, gapMs = 3 * SAMPLE_MS) {
    const result = [];
    for (const point of points) {
        const current = result.at(-1);
        const previous = current?.at(-1);
        if (!previous || point.time - previous.time > gapMs || point.reset !== previous.reset)
            result.push([point]);
        else
            current.push(point);
    }
    return result;
}

export class HistoryStore {
    constructor(path = GLib.build_filenamev([GLib.get_user_data_dir(), 'consumo-ia', 'history.json'])) {
        this.file = Gio.File.new_for_path(path);
        this.data = emptyHistory();
        this.error = null;
        this.ready = false;
        this._saving = null;
        this._dirty = false;
    }

    async load() {
        try {
            const info = await new Promise((resolve, reject) => {
                this.file.query_info_async('standard::size', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, (_source, result) => {
                    try { resolve(this.file.query_info_finish(result)); } catch (error) { reject(error); }
                });
            });
            if (info.get_size() > 4 * 1024 * 1024)
                throw new Error('history-too-large');
            const bytes = await new Promise((resolve, reject) => {
                this.file.load_contents_async(null, (_source, result) => {
                    try { resolve(this.file.load_contents_finish(result)[1]); } catch (error) { reject(error); }
                });
            });
            this.data = normalizeHistory(JSON.parse(new TextDecoder().decode(bytes)));
        } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                this.error = 'No se pudo recuperar el historial local.';
        }
        this.ready = true;
    }

    record(provider, state) {
        if (!this.ready || !state.data || state.error || !state.updatedAt)
            return;
        if (recordSample(this.data, provider, state.data, state.updatedAt)) {
            this._dirty = true;
            this.flush();
        }
    }

    async flush() {
        if (this._saving)
            return this._saving;
        if (!this._dirty)
            return;
        this._saving = this._write();
        try {
            await this._saving;
        } finally {
            this._saving = null;
        }
    }

    async _write() {
        try {
            if (GLib.mkdir_with_parents(this.file.get_parent().get_path(), 0o700) !== 0)
                throw new Error('history-directory');
            while (this._dirty) {
                this._dirty = false;
                const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(this.data)));
                await new Promise((resolve, reject) => {
                    this.file.replace_contents_bytes_async(bytes, null, false,
                        Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null, (_source, result) => {
                            try { this.file.replace_contents_finish(result); resolve(); } catch (error) { reject(error); }
                        });
                });
            }
            this.error = null;
        } catch (_error) {
            this._dirty = false;
            this.error = 'No se pudo guardar el historial local.';
        }
    }
}
