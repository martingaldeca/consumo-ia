import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {fetchCodex, fetchDeepSeek, fetchCodexActivity} from './providers.js';
import {fetchDeepSeekSessions} from './sessions.js';

export class UsageMonitor {
    constructor(onChange, providers = {codex: fetchCodex, deepseek: fetchDeepSeek, activity: fetchCodexActivity, sessions: fetchDeepSeekSessions}) {
        this.onChange = onChange;
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

    async refresh(provider, staleOnly = false) {
        const state = this.states[provider];
        if (this.disposed || !state.enabled || this.jobs.has(provider))
            return;
        if (staleOnly && state.attemptedAt && Date.now() - state.attemptedAt < (['activity', 'sessions'].includes(provider) ? 900000 : 30000))
            return;
        const job = {cancellable: new Gio.Cancellable(), timeout: 0, timedOut: false};
        this.jobs.set(provider, job);
        job.timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 25, () => {
            job.timeout = 0;
            job.timedOut = true;
            job.cancellable.cancel();
            return GLib.SOURCE_REMOVE;
        });
        state.refreshing = true;
        state.attemptedAt = Date.now();
        this.onChange();
        try {
            const data = await this.providers[provider](job.cancellable);
            if (this.disposed || this.jobs.get(provider) !== job)
                return;
            state.data = data;
            state.updatedAt = Date.now();
            state.error = null;
        } catch (error) {
            if (this.disposed || this.jobs.get(provider) !== job)
                return;
            state.error = job.timedOut ? 'timeout' : error.code ?? 'network';
        } finally {
            if (this.jobs.get(provider) === job) {
                if (job.timeout)
                    GLib.Source.remove(job.timeout);
                this.jobs.delete(provider);
                state.refreshing = false;
                if (!this.disposed)
                    this.onChange();
            }
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
