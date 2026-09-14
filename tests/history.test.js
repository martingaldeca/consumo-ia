import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {HistoryStore, emptyHistory, normalizeHistory, recordSample, RETENTION_MS} from '../extension/history.js';

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
const now = Date.now();
const quota = reset => ({windows: [{id: 'secondary', windowMinutes: 10080, usedPercent: 13, resetsAt: reset}]});
const balance = total => ({balances: [{currency: 'USD', total, paid: total, promotional: 0}]});
async function run() {
    await test('Una muestra por intervalo y un nuevo punto al reiniciar la cuota', () => {
        const data = emptyHistory();
        const time = Math.floor(now / 300000) * 300000;
        assert(recordSample(data, 'codex', quota(now + 86400000), time));
        assert(!recordSample(data, 'codex', quota(now + 86400000), time + 1));
        assert(recordSample(data, 'codex', quota(now + 7 * 86400000), time + 2));
        assert(data.quota.length === 2);
    });
    await test('Saldo cero, negativo y recargas se conservan sin inferir gasto', () => {
        const data = emptyHistory();
        recordSample(data, 'deepseek', balance(0), now - 600000);
        recordSample(data, 'deepseek', balance(-1), now - 300000);
        recordSample(data, 'deepseek', balance(10), now);
        assert(data.balances.map(point => point.total).join() === '0,-1,10');
    });
    await test('Retención de 30 días y rechazo de datos corruptos', () => {
        const data = emptyHistory();
        data.quota.push({time: now - RETENTION_MS - 1, used: 10, reset: now});
        data.quota.push({time: now, used: 13, reset: null, unexpected: 'discard'});
        data.quota.push({time: now, used: 'invalid', reset: null});
        const clean = normalizeHistory(data, now);
        assert(clean.quota.length === 1 && !Object.hasOwn(clean.quota[0], 'unexpected'));
    });
    await test('Escritura atómica, permisos privados y recuperación al reiniciar', async () => {
        const directory = GLib.dir_make_tmp('consumo-ia-history-test-XXXXXX');
        const path = GLib.build_filenamev([directory, 'history.json']);
        const store = new HistoryStore(path);
        try {
            await store.load();
            assert(store.ready && !store.error);
            store.record('codex', {data: quota(now + 86400000), updatedAt: now, error: null});
            store.record('deepseek', {data: balance(12.34), updatedAt: now, error: null});
            await store.flush();
            assert(!store.error);
            const mode = store.file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null).get_attribute_uint32('unix::mode');
            assert((mode & 0o777) === 0o600);
            const restored = new HistoryStore(path);
            await restored.load();
            assert(restored.data.quota.length === 1 && restored.data.balances[0].total === 12.34);
        } finally {
            if (store.file.query_exists(null))
                store.file.delete(null);
            Gio.File.new_for_path(directory).delete(null);
        }
    });
    print(passed + ' pruebas de historial correctas.');
}
run().catch(error => { failure = error; }).finally(() => loop.quit());
loop.run();
if (failure)
    throw failure;
