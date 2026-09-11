import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {errorMessage, money} from './model.js';
import {fetchDeepSeek, readToken, storeToken} from './providers.js';

export default class ConsumoIAPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const cancellable = new Gio.Cancellable();
        let closed = false;
        let request = null;
        let timeout = 0;
        window.set_default_size(570, 690);
        const page = new Adw.PreferencesPage({title: 'Consumo IA', icon_name: 'speedometer-symbolic'});
        window.add(page);

        const providers = new Adw.PreferencesGroup({title: 'Tus proveedores', description: 'Consulta tus cuotas y saldo desde la barra superior.'});
        page.add(providers);
        for (const [id, title, subtitle] of [
            ['codex', 'Codex', 'Usa tu sesión actual de CodexBar.'],
            ['deepseek', 'DeepSeek', 'Saldo de tu cuenta de API.'],
        ]) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind('show-' + id, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            providers.add(row);
        }

        const appearance = new Adw.PreferencesGroup({title: 'Barra y actualización', description: 'Panel oscuro tipo IDE. Las estadísticas de tokens se actualizan cada 15 minutos.'});
        page.add(appearance);
        const modes = ['both', 'codex', 'deepseek', 'icon'];
        const indicator = new Adw.ComboRow({title: 'Mostrar en la barra',
            model: Gtk.StringList.new(['Codex y DeepSeek', 'Solo Codex', 'Solo DeepSeek', 'Solo icono']),
            selected: modes.indexOf(settings.get_string('indicator-mode'))});
        indicator.connect('notify::selected', () => settings.set_string('indicator-mode', modes[indicator.selected]));
        appearance.add(indicator);
        const intervals = [30, 60, 300];
        const interval = new Adw.ComboRow({title: 'Actualizar cada',
            model: Gtk.StringList.new(['30 segundos', '1 minuto', '5 minutos']),
            selected: Math.max(0, intervals.indexOf(settings.get_int('refresh-seconds')))});
        interval.connect('notify::selected', () => settings.set_int('refresh-seconds', intervals[interval.selected]));
        appearance.add(interval);

        const history = new Adw.PreferencesGroup({title: 'Actividad e historial',
            description: 'Tokens diarios de tu cuenta de Codex. Cuota y saldo registrados cada 5 minutos mientras la extensión está activa, durante 30 días. Los días de actividad se agrupan en UTC.'});
        page.add(history);

        const connection = new Adw.PreferencesGroup({title: 'Conectar DeepSeek',
            description: 'El token se guarda en el llavero de Ubuntu. Puedes usar el mismo que utilizas con Codex.'});
        page.add(connection);
        const token = new Adw.PasswordEntryRow({title: 'Token de API'});
        connection.add(token);
        const status = new Adw.ActionRow({title: 'Comprobando conexión guardada…',
            subtitle: 'Introduce el token y pulsa Guardar y comprobar.'});
        const save = new Gtk.Button({label: 'Guardar y comprobar', valign: Gtk.Align.CENTER, css_classes: ['suggested-action'], sensitive: false});
        status.add_suffix(save);
        connection.add(status);
        token.connect('notify::text', () => {
            save.sensitive = token.text.trim().length > 0 && !request;
        });
        const saveCredential = async () => {
            let value = token.text.trim();
            if (!value || request || closed)
                return;
            request = new Gio.Cancellable();
            const current = request;
            let timedOut = false;
            let stored = false;
            token.sensitive = false;
            save.sensitive = false;
            status.title = 'Comprobando token…';
            status.subtitle = 'Consultando el saldo de DeepSeek.';
            timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 25, () => {
                timeout = 0;
                timedOut = true;
                current.cancel();
                return GLib.SOURCE_REMOVE;
            });
            try {
                const data = await fetchDeepSeek(current, value);
                if (closed)
                    return;
                if (timeout) {
                    GLib.Source.remove(timeout);
                    timeout = 0;
                }
                status.title = 'Guardando en el llavero…';
                await storeToken(value, current);
                stored = true;
                settings.set_int('credential-revision', (settings.get_int('credential-revision') + 1) % 2147483647);
                if (closed)
                    return;
                token.text = '';
                status.title = 'DeepSeek conectado';
                status.subtitle = 'Saldo: ' + data.balances.map(balance => money(balance.total, balance.currency)).join(' · ');
                window.add_toast(new Adw.Toast({title: 'Token guardado en el llavero de Ubuntu'}));
            } catch (error) {
                if (!closed) {
                    status.title = stored ? 'Token guardado' : 'No se ha guardado el token';
                    status.subtitle = errorMessage(timedOut ? 'timeout' : error.code);
                }
            } finally {
                value = null;
                if (timeout)
                    GLib.Source.remove(timeout);
                timeout = 0;
                request = null;
                if (!closed) {
                    token.sensitive = true;
                    save.sensitive = token.text.trim().length > 0;
                }
            }
        };
        save.connect('clicked', saveCredential);
        token.connect('apply', saveCredential);
        readToken(cancellable).then(value => {
            if (!closed && !request) {
                status.title = value ? 'Hay un token guardado' : 'Sin token guardado';
                status.subtitle = value ? 'Para actualizarlo, introduce otro token válido.' : 'Introduce el token y pulsa Guardar y comprobar.';
            }
        }).catch(() => {
            if (!closed && !request) {
                status.title = 'Llavero no disponible';
                status.subtitle = errorMessage('keyring');
            }
        });
        window.connect('close-request', () => {
            closed = true;
            cancellable.cancel();
            request?.cancel();
            if (timeout)
                GLib.Source.remove(timeout);
            timeout = 0;
            token.text = '';
            return false;
        });
    }
}
