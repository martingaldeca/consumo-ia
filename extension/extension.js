import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {UsageMonitor} from './monitor.js';
import {HistoryStore} from './history.js';
import {Chart, Meter, COLORS, cssColor} from './charts.js';
import {age, countdown, errorMessage, indicatorWindow, money, number, pace, paceColor, percent,
    periodStart, tokenPeriod, weeklyWindow} from './model.js';

function label(text, style = '', expand = false) {
    return new St.Label({text, style_class: style, x_expand: expand, y_align: Clutter.ActorAlign.CENTER});
}

function paragraph(text, style = '') {
    const actor = label(text, style, true);
    actor.clutter_text.line_wrap = true;
    actor.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    actor.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return actor;
}

function row(left, right) {
    const box = new St.BoxLayout({style_class: 'ai-row', x_expand: true});
    left.x_expand = true;
    box.add_child(left);
    box.add_child(right);
    return box;
}

function action(text, callback, style = '') {
    const button = new St.Button({label: text, style_class: 'ai-control ' + style, can_focus: true});
    button.connect('clicked', callback);
    return button;
}

function dateLabel(time, withTime = false) {
    return new Date(time).toLocaleString('es-ES', {
        timeZone: 'UTC', day: 'numeric', month: 'short',
        ...(withTime ? {hour: '2-digit', minute: '2-digit'} : {}),
    });
}

export default class ConsumoIA extends Extension {
    enable() {
        this._alive = true;
        this._tab = 'summary';
        this._days = 7;
        this._charts = {};
        this._recorded = {};
        this._settings = this.getSettings();
        this._history = new HistoryStore();
        this._button = new PanelMenu.Button(0.5, 'Consumo IA');
        const panel = new St.BoxLayout({style_class: 'ai-panel', y_align: Clutter.ActorAlign.CENTER});
        panel.add_child(new St.Icon({icon_name: 'speedometer-symbolic', style_class: 'system-status-icon ai-panel-icon'}));
        this._panelLabel = label('…');
        panel.add_child(this._panelLabel);
        this._button.add_child(panel);
        this._button.menu.actor.add_style_class_name('ai-menu-v2');
        this._buildMenu();
        this._monitor = new UsageMonitor(() => {
            for (const provider of ['codex', 'deepseek']) {
                const state = this._monitor.states[provider];
                if (state.updatedAt && state.updatedAt !== this._recorded[provider]) {
                    this._history.record(provider, state);
                    this._recorded[provider] = state.updatedAt;
                }
            }
            this._render();
        });
        this._settingsSignal = this._settings.connect('changed', (_settings, key) => {
            if (key === 'executor-backup')
                return;
            this._configure();
            if (key === 'credential-revision')
                this._monitor.cancel('deepseek');
            this._render();
            this._monitor.refreshAll(key !== 'credential-revision');
        });
        this._button.menu.connect('open-state-changed', (_menu, open) => {
            if (this._clock) {
                GLib.Source.remove(this._clock);
                this._clock = 0;
            }
            if (open) {
                this._tab = 'summary';
                this._resize();
                this._render();
                this._monitor.refreshAll(true);
                this._clock = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
                    this._render();
                    return GLib.SOURCE_CONTINUE;
                });
            }
        });
        this._monitorSignal = Main.layoutManager.connect('monitors-changed', () => this._resize());
        Main.panel.addToStatusArea(this.uuid, this._button, 2, 'right');
        this._configure();
        this._resize();
        this._render();
        this._history.load().then(() => {
            if (this._alive) {
                this._render();
                this._monitor.refreshAll();
            }
        });
    }

    _buildMenu() {
        const menu = this._button.menu;
        const header = new St.BoxLayout({style_class: 'ai-header', x_expand: true});
        const heading = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'ai-heading'});
        heading.add_child(label('CONSUMO / IA', 'ai-title'));
        this._updated = label('Conectando…', 'ai-muted ai-small');
        heading.add_child(this._updated);
        header.add_child(heading);
        this._refreshButton = new St.Button({style_class: 'ai-icon-button', can_focus: true,
            accessible_name: 'Actualizar consumo', child: new St.Icon({icon_name: 'view-refresh-symbolic', icon_size: 17})});
        this._refreshButton.connect('clicked', () => this._monitor.refreshAll());
        header.add_child(this._refreshButton);
        menu.box.add_child(header);
        const tabs = new St.BoxLayout({style_class: 'ai-tabs', x_expand: true});
        this._tabs = {};
        for (const [id, text] of [['summary', 'Resumen'], ['activity', 'Actividad']]) {
            const button = action(text, () => {
                this._tab = id;
                this._render();
                this._scroll.vscroll.adjustment.value = 0;
            }, 'ai-tab');
            button.x_expand = true;
            tabs.add_child(button);
            this._tabs[id] = button;
        }
        menu.box.add_child(tabs);
        this._periodRow = new St.BoxLayout({style_class: 'ai-period-row'});
        this._periodRow.add_child(label('PERÍODO', 'ai-muted ai-eyebrow', true));
        this._periodButtons = {};
        for (const [days, text] of [[1, 'Hoy'], [7, '7 días'], [30, '30 días']]) {
            const button = action(text, () => {
                this._days = days;
                this._render();
            }, 'ai-period');
            this._periodRow.add_child(button);
            this._periodButtons[days] = button;
        }
        menu.box.add_child(this._periodRow);
        this._scroll = new St.ScrollView({style_class: 'ai-scroll', hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC, overlay_scrollbars: true, x_expand: true});
        this._body = new St.BoxLayout({vertical: true, style_class: 'ai-body', x_expand: true});
        this._scroll.set_child(this._body);
        menu.box.add_child(this._scroll);
        this._connectDeepSeek = new PopupMenu.PopupImageMenuItem('Conectar DeepSeek…', 'dialog-password-symbolic');
        this._connectDeepSeek.connect('activate', () => this.openPreferences());
        menu.addMenuItem(this._connectDeepSeek);
        this._dashboard = new PopupMenu.PopupImageMenuItem('Abrir panel de DeepSeek', 'external-link-symbolic');
        this._dashboard.connect('activate', () => {
            Gio.AppInfo.launch_default_for_uri_async('https://platform.deepseek.com/usage',
                global.create_app_launch_context(0, -1), null, (_source, result) => {
                    try {
                        Gio.AppInfo.launch_default_for_uri_finish(result);
                    } catch (_error) {
                        Main.notify('Consumo IA', 'No se pudo abrir el navegador.');
                    }
                });
        });
        menu.addMenuItem(this._dashboard);
        const preferences = new PopupMenu.PopupImageMenuItem('Ajustes', 'emblem-system-symbolic');
        preferences.connect('activate', () => this.openPreferences());
        menu.addMenuItem(preferences);
    }

    _configure() {
        for (const provider of ['codex', 'deepseek'])
            this._monitor.setEnabled(provider, this._settings.get_boolean('show-' + provider));
        this._monitor.setEnabled('activity', this._settings.get_boolean('show-codex'));
        if (this._timer)
            GLib.Source.remove(this._timer);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._settings.get_int('refresh-seconds'), () => {
            this._monitor.refresh('codex');
            this._monitor.refresh('deepseek');
            this._monitor.refresh('activity', true);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _resize() {
        const monitor = Main.layoutManager.findMonitorForActor(this._button) ?? Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const width = Math.max(220, Math.min(440, monitor.width / scale - 40));
        const maxHeight = Math.max(100, monitor.height / scale - 290);
        this._button.menu.box.set_style('width: ' + width + 'px;');
        this._scroll.set_style('max-height: ' + maxHeight + 'px;');
    }

    _card(title, badge, provider) {
        const card = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'ai-card ai-card-' + provider});
        card.add_child(row(label(title, 'ai-provider ai-' + provider), label(badge, 'ai-badge')));
        this._body.add_child(card);
        return card;
    }

    _stateNote(card, state) {
        if (state.error)
            card.add_child(paragraph(errorMessage(state.error), 'ai-warning ai-small'));
        if (state.updatedAt)
            card.add_child(label((state.error ? 'Último dato · ' : '') + age(state.updatedAt), 'ai-muted ai-tiny'));
        else if (!state.error)
            card.add_child(label('Consultando…', 'ai-muted'));
    }

    _render() {
        if (!this._alive)
            return;
        const {codex, deepseek, activity} = this._monitor.states;
        const mode = this._settings.get_string('indicator-mode');
        const parts = [];
        if (codex.enabled && ['both', 'codex'].includes(mode)) {
            const window = indicatorWindow(codex.data);
            parts.push('C ' + (window ? percent(window.remaining) : '—') + (codex.error ? ' !' : ''));
        }
        if (deepseek.enabled && ['both', 'deepseek'].includes(mode)) {
            const balance = deepseek.data?.balances[0];
            parts.push('D ' + (balance ? money(balance.total, balance.currency, true) : '—') + (deepseek.error && deepseek.error !== 'credentials' ? ' !' : ''));
        }
        this._panelLabel.text = parts.join('  ·  ');
        this._panelLabel.visible = parts.length > 0;
        this._button.accessible_name = 'Consumo IA. ' + parts.join('. ').replace(/^C /, 'Codex ').replace(/D /, 'DeepSeek ');
        const states = Object.values(this._monitor.states).filter(state => state.enabled);
        const busy = states.some(state => state.refreshing);
        const timestamps = [codex, deepseek].filter(state => state.enabled).map(state => state.updatedAt).filter(Boolean);
        this._updated.text = busy ? 'Sincronizando…' : timestamps.length ? age(Math.min(...timestamps)) : 'Tus modelos, de un vistazo';
        this._refreshButton.reactive = !busy && states.length > 0;
        this._refreshButton.opacity = busy ? 110 : 255;
        this._connectDeepSeek.visible = deepseek.enabled && ['credentials', 'unauthorized', 'keyring'].includes(deepseek.error);
        this._dashboard.visible = deepseek.enabled && this._tab === 'activity';
        this._periodRow.visible = this._tab === 'activity';
        for (const [id, button] of Object.entries(this._tabs))
            button.set_style_class_name('ai-control ai-tab' + (id === this._tab ? ' ai-selected' : ''));
        for (const [days, button] of Object.entries(this._periodButtons))
            button.set_style_class_name('ai-control ai-period' + (Number(days) === this._days ? ' ai-selected' : ''));
        const focused = Object.entries(this._charts).find(([, chart]) => global.stage.key_focus === chart);
        const selection = focused ? [focused[0], focused[1].index] : null;
        const scrollPosition = this._scroll.vscroll.adjustment.value;
        this._charts = {};
        this._body.destroy_all_children();
        if (!codex.enabled && !deepseek.enabled)
            this._body.add_child(paragraph('Activa un proveedor en Ajustes.', 'ai-muted'));
        if (this._tab === 'summary') {
            if (codex.enabled)
                this._renderCodex(codex, activity);
            if (deepseek.enabled)
                this._renderDeepSeek(deepseek);
        } else {
            if (codex.enabled) {
                this._renderTokens(activity);
                this._renderQuotaHistory();
            }
            if (deepseek.enabled)
                this._renderBalanceHistory(deepseek);
            if (this._history.error)
                this._body.add_child(paragraph(this._history.error, 'ai-warning ai-small'));
        }
        this._scroll.vscroll.adjustment.value = scrollPosition;
        if (selection && this._charts[selection[0]]) {
            this._charts[selection[0]].select(selection[1]);
            this._charts[selection[0]].grab_key_focus();
        }
    }

    _renderCodex(state, activity) {
        const card = this._card('Codex', 'SEMANAL', 'codex');
        const window = weeklyWindow(state.data);
        if (window) {
            const rhythm = pace(window);
            const color = paceColor(window);
            const value = label(percent(window.remaining, 1), 'ai-hero ai-mono');
            value.set_style('color: ' + cssColor(color) + ';');
            card.add_child(row(value, label('restante', 'ai-muted')));
            card.add_child(new Meter(window.remaining, rhythm?.idealRemaining ?? null, color));
            const resetLabel = (window.resetsAt && window.resetsAt > Date.now() ? 'Reinicia en ' : '') + countdown(window.resetsAt);
            card.add_child(row(label(percent(window.usedPercent, 1) + ' utilizado', 'ai-small'),
                label(resetLabel, 'ai-muted ai-small')));
            if (rhythm) {
                const delta = new Intl.NumberFormat('es-ES', {maximumFractionDigits: 1, signDisplay: 'always'}).format(rhythm.delta);
                const status = label(delta + ' pp', 'ai-mono ai-small');
                status.set_style('color: ' + cssColor(color) + ';');
                card.add_child(row(label('Ritmo ideal · ' + percent(rhythm.idealRemaining, 1) + ' restante', 'ai-muted ai-small'), status));
            }
            const today = tokenPeriod(activity.data, 1);
            if (today.total !== null)
                card.add_child(row(label('Tokens hoy · UTC', 'ai-muted ai-small'), label(number(today.total, true), 'ai-codex ai-mono')));
        } else if (state.data) {
            card.add_child(paragraph('Cuota semanal no disponible.', 'ai-muted'));
        }
        this._stateNote(card, state);
    }

    _renderDeepSeek(state) {
        const card = this._card('DeepSeek', 'API', 'deepseek');
        for (const balance of state.data?.balances ?? []) {
            card.add_child(row(label(money(balance.total, balance.currency), 'ai-hero ai-mono ai-deepseek'), label('saldo', 'ai-muted')));
            const details = new St.BoxLayout({style_class: 'ai-stats', x_expand: true});
            for (const [title, value] of [['Pagado', balance.paid], ['Promocional', balance.promotional]]) {
                const stat = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'ai-stat'});
                stat.add_child(label(title, 'ai-muted ai-small'));
                stat.add_child(label(money(value, balance.currency), 'ai-mono ai-small'));
                details.add_child(stat);
            }
            card.add_child(details);
        }
        if (state.data && !state.data.available)
            card.add_child(paragraph('Saldo no disponible para llamadas.', 'ai-warning ai-small'));
        this._stateNote(card, state);
    }

    _addChart(card, id, options) {
        if (!options.points.length) {
            card.add_child(paragraph('Todavía no hay datos para este período.', 'ai-muted ai-small'));
            return;
        }
        const detail = label('', 'ai-mono ai-chart-detail ai-small');
        const chart = new Chart({...options, onSelect: text => { detail.text = text; }});
        this._charts[id] = chart;
        card.add_child(chart);
        card.add_child(row(label(dateLabel(options.start), 'ai-muted ai-tiny'), label(dateLabel(options.end - 1), 'ai-muted ai-tiny')));
        card.add_child(detail);
    }

    _renderTokens(state) {
        const card = this._card('Tokens de Codex', 'ACTIVIDAD', 'codex');
        if (state.data) {
            const period = tokenPeriod(state.data, this._days);
            card.add_child(row(label(number(period.total, true), 'ai-hero ai-mono ai-codex'), label('tokens del período', 'ai-muted ai-small')));
            if (period.observedDays < period.expectedDays)
                card.add_child(label(period.observedDays + ' de ' + period.expectedDays + ' días con datos', 'ai-muted ai-small'));
            const start = periodStart(this._days);
            const end = periodStart(1) + 86400000;
            this._addChart(card, 'tokens', {
                points: period.daily.map(day => ({time: Date.parse(day.date + 'T12:00:00Z'), value: day.tokens})),
                start, end, color: COLORS.codex, kind: 'bars', minimum: 0,
                describe: point => dateLabel(point.time) + ' · ' + number(point.value) + ' tokens',
            });
            card.add_child(row(label('Total acumulado', 'ai-muted ai-small'), label(number(state.data.summary.lifetimeTokens, true), 'ai-mono ai-small')));
            card.add_child(row(label('Pico diario', 'ai-muted ai-small'), label(number(state.data.summary.peakDailyTokens, true), 'ai-mono ai-small')));
            card.add_child(label('Días agrupados en UTC', 'ai-muted ai-tiny'));
        }
        this._stateNote(card, state);
    }

    _renderQuotaHistory() {
        const card = this._card('Evolución de cuota', 'CODEX', 'codex');
        const start = periodStart(this._days);
        const points = this._history.data.quota.filter(point => point.time >= start)
            .map(point => ({...point, value: point.used}));
        this._addChart(card, 'quota', {points, start, end: Date.now(), color: COLORS.codex, minimum: 0, maximum: 100,
            describe: point => dateLabel(point.time, true) + ' UTC · ' + percent(point.value, 1) + ' usado'});
        card.add_child(paragraph('Cada trazo corresponde a un ciclo semanal. Los huecos indican períodos sin observaciones.', 'ai-muted ai-tiny'));
    }

    _renderBalanceHistory(state) {
        const start = periodStart(this._days);
        const samples = this._history.data.balances.filter(point => point.time >= start);
        const currencies = [...new Set([...(state.data?.balances.map(balance => balance.currency) ?? []), ...samples.map(point => point.currency)])];
        for (const currency of currencies.length ? currencies : ['USD']) {
            const card = this._card('Evolución de saldo', 'DEEPSEEK · ' + currency, 'deepseek');
            const points = samples.filter(point => point.currency === currency).map(point => ({...point, value: point.total}));
            this._addChart(card, 'balance-' + currency, {points, start, end: Date.now(), color: COLORS.deepseek,
                describe: point => dateLabel(point.time, true) + ' UTC · ' + money(point.value, currency)});
            card.add_child(paragraph('Registrado desde esta actualización. Las variaciones pueden incluir consumo y recargas.', 'ai-muted ai-tiny'));
            this._stateNote(card, state);
        }
    }

    disable() {
        this._alive = false;
        this._monitor?.dispose();
        this._history?.flush();
        for (const key of ['_timer', '_clock']) {
            if (this[key])
                GLib.Source.remove(this[key]);
            this[key] = 0;
        }
        if (this._monitorSignal)
            Main.layoutManager.disconnect(this._monitorSignal);
        this._monitorSignal = 0;
        if (this._settingsSignal)
            this._settings.disconnect(this._settingsSignal);
        this._settingsSignal = 0;
        this._button?.destroy();
        for (const key of ['_button', '_monitor', '_history', '_settings', '_charts', '_body', '_tabs',
            '_periodButtons', '_periodRow', '_panelLabel', '_updated', '_scroll', '_refreshButton', '_dashboard', '_connectDeepSeek'])
            this[key] = null;
    }
}
