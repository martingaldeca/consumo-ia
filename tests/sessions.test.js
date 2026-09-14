import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {addUsage, normalizeCache, SessionStore, usageFromLine, usageSummary} from '../extension/sessions.js';

const loop = new GLib.MainLoop(null, false);
let failure = null;
let passed = 0;
function assert(value) {
    if (!value)
        throw new Error('Assertion failed');
}
async function test(name, run) {
    await run();
    passed++;
    print('✓ ' + name);
}
const record = (date, usage, extra = '') =>
    JSON.stringify({timestamp: date + 'T10:00:00.000Z', type: 'token_usage_record', payload: {usage, ...extra}});
const usage = {input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, total_tokens: 120};

function removeTree(path) {
    const file = Gio.File.new_for_path(path);
    let enumerator = null;
    try {
        enumerator = file.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        while (true) {
            const info = enumerator.next_file(null);
            if (!info)
                break;
            const child = GLib.build_filenamev([path, info.get_name()]);
            if (info.get_file_type() === Gio.FileType.DIRECTORY)
                removeTree(child);
            else
                Gio.File.new_for_path(child).delete(null);
        }
    } finally {
        try {
            enumerator?.close(null);
        } catch (_error) {
        }
    }
    file.delete(null);
}

async function run() {
    await test('Solo se leen los registros de uso con campos válidos', () => {
        assert(usageFromLine(record('2026-09-13', usage)).tokens === 120);
        assert(usageFromLine(record('2026-09-13', {...usage, total_tokens: undefined}))?.tokens === 120);
        assert(usageFromLine('{"timestamp":"2026-09-13T10:00:00.000Z","type":"response_item","payload":{}}') === null);
        assert(usageFromLine(record('2026-09-13', {...usage, output_tokens: -1, total_tokens: 'muchos'})) === null);
        assert(usageFromLine(record('2026-09-13', {...usage, cached_input_tokens: 500})) === null);
        assert(usageFromLine(record('2026-13-40', usage)) === null);
        assert(usageFromLine('{roto') === null);
    });
    await test('Los días se agregan y el resumen publica acumulado y pico', () => {
        const daily = {};
        addUsage(daily, usageFromLine(record('2026-09-13', usage)));
        addUsage(daily, usageFromLine(record('2026-09-13', {...usage, total_tokens: 80, output_tokens: 0, input_tokens: 80, cached_input_tokens: 0})));
        addUsage(daily, usageFromLine(record('2026-09-12', usage)));
        const result = usageSummary(daily);
        assert(result.daily.length === 2 && result.daily[0].date === '2026-09-12');
        assert(result.daily[1].tokens === 200 && result.summary.lifetimeTokens === 320);
        assert(result.summary.peakDailyTokens === 200);
        assert(usageSummary({}).summary.lifetimeTokens === null);
    });
    await test('El caché corrupto se descarta y el válido se conserva', () => {
        const clean = normalizeCache({version: 1, files: {
            '/tmp/a.jsonl': {offset: 10, daily: {'2026-09-13': {date: '2026-09-13', tokens: 5, input: 5, cached: 0, output: 0}}},
            '/tmp/b.txt': {offset: 3, daily: {}},
            '/tmp/c.jsonl': {offset: -2, daily: {}},
        }});
        assert(Object.keys(clean.files).length === 1 && clean.files['/tmp/a.jsonl'].offset === 10);
        assert(Object.keys(normalizeCache({version: 9, files: {}}).files).length === 0);
        assert(Object.keys(normalizeCache(null).files).length === 0);
    });
    await test('El escaneo es incremental y no cuenta dos veces al crecer el fichero', async () => {
        const directory = GLib.dir_make_tmp('consumo-ia-sessions-test-XXXXXX');
        const root = GLib.build_filenamev([directory, 'sessions', '2026', '09', '13']);
        const cache = GLib.build_filenamev([directory, 'sessions.json']);
        GLib.mkdir_with_parents(root, 0o700);
        const log = GLib.build_filenamev([root, 'rollout-test.jsonl']);
        const append = text => {
            const stream = Gio.File.new_for_path(log).append_to(Gio.FileCreateFlags.NONE, null);
            stream.write_all(new TextEncoder().encode(text), null);
            stream.close(null);
        };
        try {
            append(record('2026-09-13', usage) + '\n');
            const first = new SessionStore(cache, GLib.build_filenamev([directory, 'sessions']));
            await first.load();
            const initial = await first.collect(null);
            assert(initial.summary.lifetimeTokens === 120 && initial.daily[0].date === '2026-09-13');

            append(record('2026-09-13', usage) + '\n');
            const second = new SessionStore(cache, GLib.build_filenamev([directory, 'sessions']));
            await second.load();
            const grown = await second.collect(null);
            assert(grown.summary.lifetimeTokens === 240);

            const third = new SessionStore(cache, GLib.build_filenamev([directory, 'sessions']));
            await third.load();
            const stable = await third.collect(null);
            assert(stable.summary.lifetimeTokens === 240);
        } finally {
            removeTree(directory);
        }
    });
    await test('Una línea a medias se relee sin perder registros', async () => {
        const directory = GLib.dir_make_tmp('consumo-ia-sessions-partial-XXXXXX');
        const root = GLib.build_filenamev([directory, 'sessions']);
        GLib.mkdir_with_parents(root, 0o700);
        const log = GLib.build_filenamev([root, 'rollout-partial.jsonl']);
        const append = text => {
            const stream = Gio.File.new_for_path(log).append_to(Gio.FileCreateFlags.NONE, null);
            stream.write_all(new TextEncoder().encode(text), null);
            stream.close(null);
        };
        try {
            const line = record('2026-09-13', usage);
            append(line.slice(0, 30));
            const store = new SessionStore(GLib.build_filenamev([directory, 'cache.json']), root);
            await store.load();
            assert((await store.collect(null)).summary.lifetimeTokens === null);
            append(line.slice(30) + '\n');
            const resumed = new SessionStore(GLib.build_filenamev([directory, 'cache.json']), root);
            await resumed.load();
            assert((await resumed.collect(null)).summary.lifetimeTokens === 120);
        } finally {
            removeTree(directory);
        }
    });
    await test('Sin sesiones se informa como error recuperable', async () => {
        const directory = GLib.dir_make_tmp('consumo-ia-sessions-empty-XXXXXX');
        try {
            const store = new SessionStore(GLib.build_filenamev([directory, 'cache.json']), GLib.build_filenamev([directory, 'sessions']));
            await store.load();
            let code = null;
            try {
                await store.collect(null);
            } catch (error) {
                code = error.code;
            }
            assert(code === 'sessions');
        } finally {
            removeTree(directory);
        }
    });
    print(passed + ' pruebas de sesiones correctas.');
}
run().catch(error => { failure = error; }).finally(() => loop.quit());
loop.run();
if (failure)
    throw failure;
