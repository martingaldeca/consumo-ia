import GLib from 'gi://GLib';

let passed = 0;
function assert(value) {
    if (!value)
        throw new Error('Assertion failed');
}
function test(name, run) {
    run();
    passed++;
    print('✓ ' + name);
}

const temporaryDirectory = GLib.dir_make_tmp('consumo-ia-codexbar-test-XXXXXX');
const helper = GLib.build_filenamev([temporaryDirectory, 'codexbar-waybar']);
const cache = GLib.build_filenamev([temporaryDirectory, 'usage.json']);
const adapter = GLib.build_filenamev([GLib.get_current_dir(), 'tools', 'codexbar-cli']);
const resetAt = Math.floor(Date.now() / 1000) + 86400;

try {
    GLib.file_set_contents(helper, '#!/bin/sh\nexit 0\n');
    GLib.spawn_sync(null, ['chmod', '755', helper], null, GLib.SpawnFlags.SEARCH_PATH, null);
    GLib.file_set_contents(cache, JSON.stringify({rate_limit: {
        primary_window: {used_percent: 12, limit_window_seconds: 604800, reset_at: resetAt},
        secondary_window: null,
    }}));

    test('CodexBar CLI transforma la ventana semanal de Waybar al contrato de Consumo IA', () => {
        const [ok, stdout, stderr, status] = GLib.spawn_sync(null, [
            '/usr/bin/env',
            'CODEXBAR_WAYBAR_BINARY=' + helper,
            'CODEXBAR_CACHE_FILE=' + cache,
            '/bin/bash', adapter,
            'usage', '--provider', 'codex', '--source', 'oauth', '--format', 'json', '--no-credits',
        ], null, GLib.SpawnFlags.SEARCH_PATH, null);
        assert(ok);
        GLib.spawn_check_wait_status(status);
        const output = new TextDecoder().decode(stdout);
        const errors = new TextDecoder().decode(stderr);
        assert(errors.length === 0);
        const payload = JSON.parse(output);
        const window = payload[0].usage.primary;
        assert(payload.length === 1 && payload[0].provider === 'codex');
        assert(window.usedPercent === 12 && window.windowMinutes === 10080);
        assert(Date.parse(window.resetsAt) === resetAt * 1000);
    });

    test('El adaptador conserva una instalación de CodexBar que ya ofrece la CLI nativa', () => {
        const native = GLib.build_filenamev([temporaryDirectory, 'native-codexbar']);
        GLib.file_set_contents(native, '#!/bin/sh\nif [ "$2" = "--help" ]; then echo "Usage: codexbar usage"; else echo native-cli; fi\n');
        GLib.spawn_sync(null, ['chmod', '755', native], null, GLib.SpawnFlags.SEARCH_PATH, null);
        const [ok, stdout, stderr, status] = GLib.spawn_sync(null, [
            '/usr/bin/env',
            'CODEXBAR_WAYBAR_BINARY=' + native,
            'CODEXBAR_CACHE_FILE=' + cache,
            '/bin/bash', adapter,
            'usage', '--provider', 'codex', '--source', 'oauth', '--format', 'json', '--no-credits',
        ], null, GLib.SpawnFlags.SEARCH_PATH, null);
        assert(ok);
        GLib.spawn_check_wait_status(status);
        assert(new TextDecoder().decode(stdout).trim() === 'native-cli');
        assert(new TextDecoder().decode(stderr).length === 0);
        GLib.unlink(native);
    });
} finally {
    GLib.unlink(helper);
    GLib.unlink(cache);
    GLib.rmdir(temporaryDirectory);
}

print(passed + ' pruebas de adaptador CodexBar correctas.');
