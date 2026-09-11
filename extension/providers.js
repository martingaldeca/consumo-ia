import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import Secret from 'gi://Secret';
import {normalizeCodex, normalizeDeepSeek, normalizeActivity, UsageError} from './model.js';

function credentialSchema() {
    return new Secret.Schema('org.gnome.shell.extensions.consumo-ia', Secret.SchemaFlags.NONE, {
        provider: Secret.SchemaAttributeType.STRING,
    });
}

export function readToken(cancellable) {
    return new Promise((resolve, reject) => {
        Secret.password_lookup(credentialSchema(), {provider: 'deepseek'}, cancellable, (_source, result) => {
            try {
                resolve(Secret.password_lookup_finish(result));
            } catch (_error) {
                reject(new UsageError('keyring'));
            }
        });
    });
}

export function storeToken(token, cancellable) {
    return new Promise((resolve, reject) => {
        Secret.password_store(credentialSchema(), {provider: 'deepseek'}, Secret.COLLECTION_DEFAULT,
            'Consumo IA · DeepSeek', token, cancellable, (_source, result) => {
                try {
                    if (!Secret.password_store_finish(result))
                        throw new UsageError('keyring');
                    resolve();
                } catch (_error) {
                    reject(new UsageError('keyring'));
                }
            });
    });
}

export function fetchCodex(cancellable) {
    const binary = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'codexbar']);
    if (!GLib.file_test(binary, GLib.FileTest.IS_EXECUTABLE))
        return Promise.reject(new UsageError('missingBinary'));
    return new Promise((resolve, reject) => {
        let process;
        let cancelId = 0;
        try {
            process = Gio.Subprocess.new([binary, 'usage', '--provider', 'codex', '--source', 'oauth', '--format', 'json', '--no-credits'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            cancelId = cancellable.connect(() => process.force_exit());
            process.communicate_utf8_async(null, cancellable, (_source, result) => {
                if (cancelId)
                    cancellable.disconnect(cancelId);
                try {
                    const [, stdout] = process.communicate_utf8_finish(result);
                    if (!process.get_successful())
                        throw new UsageError('codex');
                    resolve(normalizeCodex(JSON.parse(stdout)));
                } catch (error) {
                    reject(error instanceof UsageError ? error : new UsageError('codex'));
                }
            });
        } catch (_error) {
            if (cancelId)
                cancellable.disconnect(cancelId);
            process?.force_exit();
            reject(new UsageError('codex'));
        }
    });
}

export async function fetchDeepSeek(cancellable, suppliedToken = null) {
    const token = suppliedToken ?? await readToken(cancellable);
    if (!token)
        throw new UsageError('credentials');
    if (cancellable.is_cancelled())
        throw new UsageError('timeout');
    const session = new Soup.Session({timeout: 15, user_agent: 'ConsumoIA/1.0'});
    const message = Soup.Message.new('GET', 'https://api.deepseek.com/user/balance');
    message.set_flags(Soup.MessageFlags.NO_REDIRECT);
    message.request_headers.append('Authorization', 'Bearer ' + token);
    message.request_headers.append('Accept', 'application/json');
    try {
        const bytes = await new Promise((resolve, reject) => {
            session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (_source, result) => {
                try {
                    resolve(session.send_and_read_finish(result));
                } catch (_error) {
                    reject(new UsageError('network'));
                }
            });
        });
        if ([401, 403].includes(message.status_code))
            throw new UsageError('unauthorized');
        if (message.status_code === 429)
            throw new UsageError('rateLimit');
        if (message.status_code !== 200)
            throw new UsageError('unavailable');
        try {
            return normalizeDeepSeek(JSON.parse(new TextDecoder().decode(bytes.get_data())));
        } catch (error) {
            throw error instanceof UsageError ? error : new UsageError('invalid');
        }
    } finally {
        session.abort();
    }
}

export async function fetchCodexActivity(cancellable) {
    const binary = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'codex']);
    if (!GLib.file_test(binary, GLib.FileTest.IS_EXECUTABLE))
        throw new UsageError('unsupported');
    let process;
    let cancelId = 0;
    try {
        process = Gio.Subprocess.new([binary, 'app-server', '--stdio'],
            Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        cancelId = cancellable.connect(() => process.force_exit());
        const input = new Gio.DataInputStream({base_stream: process.get_stdout_pipe()});
        const output = process.get_stdin_pipe();
        let bytesRead = 0;
        const send = message => new Promise((resolve, reject) => {
            output.write_all_async(new TextEncoder().encode(JSON.stringify(message) + '\n'), GLib.PRIORITY_DEFAULT, cancellable, (_source, result) => {
                try {
                    output.write_all_finish(result);
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });
        const line = () => new Promise((resolve, reject) => {
            input.read_line_async(GLib.PRIORITY_DEFAULT, cancellable, (_source, result) => {
                try {
                    const [text, length] = input.read_line_finish_utf8(result);
                    bytesRead += length;
                    if (text === null || bytesRead > 8 * 1024 * 1024)
                        throw new UsageError('activity');
                    resolve(JSON.parse(text));
                } catch (error) {
                    reject(error);
                }
            });
        });
        const receive = async id => {
            while (!cancellable.is_cancelled()) {
                const response = await line();
                if (response.id !== id)
                    continue;
                if (response.error)
                    throw new UsageError([-32601, -32600].includes(response.error.code) ? 'unsupported' : 'activity');
                return response.result;
            }
            throw new UsageError('timeout');
        };
        await send({id: 1, method: 'initialize', params: {clientInfo: {name: 'consumo_ia', version: '2.0'}, capabilities: {experimentalApi: true}}});
        await receive(1);
        await send({method: 'initialized', params: {}});
        await send({id: 2, method: 'account/usage/read', params: {}});
        return normalizeActivity(await receive(2));
    } catch (error) {
        throw error instanceof UsageError ? error : new UsageError('activity');
    } finally {
        if (cancelId)
            cancellable.disconnect(cancelId);
        if (process) {
            process.force_exit();
            process.wait_async(null, (_source, result) => {
                try {
                    process.wait_finish(result);
                } catch (_error) {
                }
            });
        }
    }
}
