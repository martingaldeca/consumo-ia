import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {UsageError, validDay} from './model.js';

export const CACHE_VERSION = 1;
const CHUNK_SIZE = 1024 * 1024;
const MARKER = '"token_usage_record"';

export function defaultSessionsRoot(home = GLib.get_home_dir()) {
    return GLib.build_filenamev([home, '.codex-deepseek', 'sessions']);
}

function count(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function optional(value, fallback = 0) {
    return value === undefined || value === null ? fallback : count(value);
}

export function usageFromLine(line) {
    if (!line.includes(MARKER))
        return null;
    let message = null;
    try {
        message = JSON.parse(line);
    } catch (_error) {
        return null;
    }
    const usage = message?.type === 'token_usage_record' ? message.payload?.usage : null;
    const date = typeof message?.timestamp === 'string' ? message.timestamp.slice(0, 10) : null;
    if (!usage || !validDay(date) || !Number.isFinite(Date.parse(message.timestamp)))
        return null;
    const input = count(usage.input_tokens);
    const output = optional(usage.output_tokens);
    const cached = optional(usage.cached_input_tokens);
    const total = usage.total_tokens === undefined || usage.total_tokens === null
        ? (input === null ? null : input + output)
        : count(usage.total_tokens);
    if (input === null || output === null || cached === null || total === null || cached > input)
        return null;
    return {date, tokens: total, input, cached, output};
}

export function addUsage(daily, record) {
    const day = daily[record.date] ?? {date: record.date, tokens: 0, input: 0, cached: 0, output: 0};
    day.tokens += record.tokens;
    day.input += record.input;
    day.cached += record.cached;
    day.output += record.output;
    daily[record.date] = day;
    return daily;
}

export function usageSummary(daily) {
    const days = Object.values(daily).sort((a, b) => a.date.localeCompare(b.date));
    if (!days.length)
        return {summary: {lifetimeTokens: null, peakDailyTokens: null}, daily: []};
    return {
        summary: {
            lifetimeTokens: days.reduce((sum, day) => sum + day.tokens, 0),
            peakDailyTokens: days.reduce((highest, day) => Math.max(highest, day.tokens), 0),
        },
        daily: days.map(day => ({date: day.date, tokens: day.tokens})),
    };
}

export function normalizeCache(value) {
    const files = {};
    if (value?.version !== CACHE_VERSION || !value.files || typeof value.files !== 'object')
        return {version: CACHE_VERSION, files};
    for (const [path, entry] of Object.entries(value.files)) {
        if (!path.endsWith('.jsonl') || !Number.isSafeInteger(entry?.offset) || entry.offset < 0
            || !entry.daily || typeof entry.daily !== 'object')
            continue;
        const daily = {};
        for (const [date, day] of Object.entries(entry.daily)) {
            if (!validDay(date) || count(day?.tokens) === null)
                continue;
            daily[date] = {date, tokens: day.tokens, input: count(day.input) ?? 0, cached: count(day.cached) ?? 0, output: count(day.output) ?? 0};
        }
        files[path] = {offset: entry.offset, daily};
    }
    return {version: CACHE_VERSION, files};
}

function children(directory, filter) {
    const found = [];
    let enumerator = null;
    try {
        enumerator = Gio.File.new_for_path(directory).enumerate_children(filter, Gio.FileQueryInfoFlags.NONE, null);
        while (true) {
            const info = enumerator.next_file(null);
            if (!info)
                break;
            const path = GLib.build_filenamev([directory, info.get_name()]);
            if (info.get_file_type() === Gio.FileType.DIRECTORY)
                found.push(...children(path, filter));
            else
                found.push(path);
        }
    } catch (_error) {
        return found;
    } finally {
        try {
            enumerator?.close(null);
        } catch (_error) {
        }
    }
    return found;
}

function stream(file, cancellable) {
    return new Promise((resolve, reject) => {
        file.read_async(GLib.PRIORITY_DEFAULT, cancellable, (_source, result) => {
            try {
                resolve(file.read_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

function read(stream_, cancellable) {
    return new Promise((resolve, reject) => {
        stream_.read_bytes_async(CHUNK_SIZE, GLib.PRIORITY_DEFAULT, cancellable, (_source, result) => {
            try {
                resolve(stream_.read_bytes_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

export class SessionStore {
    constructor(path = GLib.build_filenamev([GLib.get_user_data_dir(), 'consumo-ia', 'sessions.json']),
        root = defaultSessionsRoot()) {
        this.file = Gio.File.new_for_path(path);
        this.root = root;
        this.data = normalizeCache(null);
    }

    async load() {
        try {
            const bytes = await new Promise((resolve, reject) => {
                this.file.load_contents_async(null, (_source, result) => {
                    try {
                        resolve(this.file.load_contents_finish(result)[1]);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            this.data = normalizeCache(JSON.parse(new TextDecoder().decode(bytes)));
        } catch (_error) {
        }
    }

    async collect(cancellable) {
        try {
            return await this._collect(cancellable);
        } catch (error) {
            if (error instanceof UsageError)
                throw error;
            if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw new UsageError('timeout');
            throw new UsageError('sessions');
        }
    }

    async _collect(cancellable) {
        const paths = children(this.root, 'standard::name,standard::type').filter(path => path.endsWith('.jsonl'));
        if (!paths.length)
            throw new UsageError('sessions');
        for (const path of paths)
            await this._tail(path, cancellable);
        const present = new Set(paths);
        for (const path of Object.keys(this.data.files)) {
            if (!present.has(path))
                delete this.data.files[path];
        }
        const summary = usageSummary(this._usage());
        await this._save();
        return summary;
    }

    async _tail(path, cancellable) {
        const file = Gio.File.new_for_path(path);
        const size = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, cancellable).get_size();
        const entry = this.data.files[path] ?? {offset: 0, daily: {}};
        if (entry.offset > size) {
            entry.offset = 0;
            entry.daily = {};
        }
        if (entry.offset === size)
            return;
        const source = await stream(file, cancellable);
        try {
            source.seek(entry.offset, GLib.SeekType.SET, cancellable);
            const decoder = new TextDecoder();
            let pending = new Uint8Array(0);
            let consumed = entry.offset;
            while (true) {
                const chunk = await read(source, cancellable);
                const length = chunk.get_size();
                if (!length)
                    break;
                consumed += length;
                const data = chunk.get_data();
                const bytes = new Uint8Array(pending.length + data.length);
                bytes.set(pending);
                bytes.set(data, pending.length);
                let start = 0;
                for (let index = 0; index < bytes.length; index++) {
                    if (bytes[index] !== 0x0a)
                        continue;
                    const record = usageFromLine(decoder.decode(bytes.subarray(start, index)));
                    if (record)
                        addUsage(entry.daily, record);
                    start = index + 1;
                }
                pending = bytes.slice(start);
            }
            entry.offset = consumed - pending.length;
            this.data.files[path] = entry;
        } finally {
            try {
                source.close(null);
            } catch (_error) {
            }
        }
    }

    _usage() {
        const daily = {};
        for (const entry of Object.values(this.data.files)) {
            for (const day of Object.values(entry.daily))
                addUsage(daily, day);
        }
        return daily;
    }

    async _save() {
        try {
            if (GLib.mkdir_with_parents(this.file.get_parent().get_path(), 0o700) !== 0)
                throw new Error('sessions-directory');
            const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(this.data)));
            await new Promise((resolve, reject) => {
                this.file.replace_contents_bytes_async(bytes, null, false,
                    Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null, (_source, result) => {
                        try {
                            this.file.replace_contents_finish(result);
                            resolve();
                        } catch (error) {
                            reject(error);
                        }
                    });
            });
        } catch (_error) {
        }
    }
}

export async function fetchDeepSeekSessions(cancellable) {
    const store = new SessionStore();
    await store.load();
    return store.collect(cancellable);
}
