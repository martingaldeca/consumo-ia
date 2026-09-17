import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {fetchCodex, fetchDeepSeek, fetchCodexActivity} from './providers.js';
import {fetchDeepSeekSessions} from './sessions.js';

export const REFRESH_TIMEOUT_MS = 25000;

export class UsageMonitor {
    constructor(onChange, providers = {codex: fetchCodex, deepseek: fetchDeepSeek, activity: fetchCodexActivity, sessions: fetchDeepSeekSessions},
        timeoutMs = REFRESH_TIMEOUT_MS) {
        this.onChange = onChange;
        this.logger = console.error;
        this.timeoutMs = timeoutMs;
        this.providers = providers;
        this.disposed = false;
        this.states = {};
        this.jobs = new Map();
        for (const provider of Object.keys(providers))
            this.states[provider] = {enabled: true, refreshing: false, data: null, updatedAt: null, attemptedAt: null, error: null};
    }

    setEnabled(provider, enabled) {
        this.states[provider].enabled = enabled;
        if (!enabled)
            this.cancel(provider);
    }

    cancel(provider) {
        const job = this.jobs.get(provider);
        if (!job)
            return;
        this.jobs.delete(provider);
        if (job.timeout)
            GLib.Source.remove(job.timeout);
        job.cancellable.cancel();
        this.states[provider].refreshing = false;
    }

    notify() {
        if (this.disposed || !this.onChange)
            return;
        try {
            this.onChange();
        } catch (error) {
            this.logger('Consumo IA: no se pudo repintar el panel: ' + error.message);
        }
    }

    finish(provider, job, error) {
        if (this.jobs.get(provider) !== job)
            return;
        this.jobs.delete(provider);
        if (job.timeout) {
            GLib.Source.remove(job.timeout);
            job.timeout = 0;
        }
        const state = this.states[provider];
        state.error = error;
        state.refreshing = false;
        this.notify();
    }

    async refresh(provider, staleOnly = false) {
        const state = this.states[provider];
        if (this.disposed || !state.enabled)
            return;
        const running = this.jobs.get(provider);
        if (running) {
            // Un callback perdido (por ejemplo, durante una recolección de basura del shell)
            // deja la petición pendiente para siempre. Pasado el plazo se descarta para que
            // el proveedor no quede bloqueado el resto de la sesión.
            if (Date.now() < running.deadline)
                return;
            this.finish(provider, running, 'timeout');
        }
        if (staleOnly && state.attemptedAt && Date.now() - state.attemptedAt < (['activity', 'sessions'].includes(provider) ? 900000 : 30000))
            return;
        const job = {cancellable: new Gio.Cancellable(), timeout: 0, deadline: Date.now() + this.timeoutMs, timedOut: false};
        this.jobs.set(provider, job);
        job.timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.timeoutMs, () => {
            job.timeout = 0;
            job.timedOut = true;
            job.cancellable.cancel();
            this.finish(provider, job, 'timeout');
            return GLib.SOURCE_REMOVE;
        });
        state.refreshing = true;
        state.attemptedAt = Date.now();
        this.notify();
        try {
            const data = await this.providers[provider](job.cancellable);
            if (this.disposed || this.jobs.get(provider) !== job)
                return;
            state.data = data;
            state.updatedAt = Date.now();
            this.finish(provider, job, null);
        } catch (error) {
            if (this.disposed || this.jobs.get(provider) !== job)
                return;
            this.finish(provider, job, job.timedOut ? 'timeout' : error.code ?? 'network');
        }
    }

    refreshAll(staleOnly = false) {
        return Promise.all(Object.keys(this.states).map(provider => this.refresh(provider, staleOnly)));
    }

    dispose() {
        this.disposed = true;
        for (const provider of this.jobs.keys())
            this.cancel(provider);
        this.onChange = null;
    }
}
