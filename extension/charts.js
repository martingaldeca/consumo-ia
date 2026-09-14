import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';
import {paintSeries, runs, smoothSpans} from './series.js';

export const COLORS = {codex: [91, 220, 250], deepseek: [169, 146, 255]};

const AXIS_GUTTER = 44;
const AXIS_FONT = 'Sans 7';

export function cssColor(color) {
    return 'rgb(' + color.join(',') + ')';
}

function source(cr, color, opacity = 1) {
    cr.setSourceRGBA(color[0] / 255, color[1] / 255, color[2] / 255, opacity);
}

export const Meter = GObject.registerClass({GTypeName: 'ConsumoIAMeterV2'}, class Meter extends St.DrawingArea {
    _init(remaining, ideal, color) {
        super._init({style_class: 'ai-meter', x_expand: true, accessible_name: remaining + ' % restante'});
        this.connect('repaint', () => {
            const cr = this.get_context();
            const [width, height] = this.get_surface_size();
            cr.setLineWidth(height);
            cr.setLineCap(1);
            const radius = height / 2;
            source(cr, [237, 243, 252], 0.09);
            cr.moveTo(radius, radius);
            cr.lineTo(Math.max(radius, width - radius), radius);
            cr.stroke();
            const filled = Math.min(100, Math.max(0, remaining)) / 100 * width;
            if (filled > 0) {
                source(cr, color);
                cr.moveTo(radius, radius);
                cr.lineTo(Math.max(radius, filled - radius), radius);
                cr.stroke();
            }
            if (ideal !== null) {
                source(cr, [255, 255, 255], 0.95);
                cr.setLineCap(0);
                cr.setLineWidth(2);
                const x = Math.max(1, Math.min(width - 1, width * ideal / 100));
                cr.moveTo(x, 0);
                cr.lineTo(x, height);
                cr.stroke();
            }
            cr.$dispose();
        });
    }
});

export const Chart = GObject.registerClass({GTypeName: 'ConsumoIAChartV2'}, class Chart extends St.DrawingArea {
    _init({points, start, end, color, kind = 'line', maximum = null, minimum = null,
        topLabel = null, bottomLabel = null, fill = true, describe, onSelect}) {
        super._init({style_class: 'ai-chart', x_expand: true, reactive: true, can_focus: true,
            accessible_name: 'Gráfica. Usa las flechas izquierda y derecha para consultar valores.'});
        this.points = points;
        this.index = points.length - 1;
        this._start = start;
        this._end = Math.max(start + 1, end);
        this._color = color;
        this._kind = kind;
        this._topLabel = topLabel;
        this._bottomLabel = bottomLabel;
        this._fill = fill;
        this._describe = describe;
        this._onSelect = onSelect;
        const values = points.map(point => point.value);
        const low = Math.min(...values);
        const high = Math.max(...values);
        const padding = Math.max((high - low) * 0.12, Math.abs(high) * 0.03, 0.01);
        this._minimum = minimum ?? low - padding;
        this._maximum = maximum ?? high + padding;
        this.connect('repaint', () => this._draw());
        this.connect('motion-event', (_actor, event) => {
            const [ok, localX] = this.transform_stage_point(...event.get_coords());
            if (ok) {
                const {left, plotWidth} = this._geometry(this.get_width(), this.get_height());
                const time = this._start + Math.max(0, Math.min(1, (localX - left) / plotWidth)) * (this._end - this._start);
                let nearest = 0;
                for (let i = 1; i < points.length; i++) {
                    if (Math.abs(points[i].time - time) < Math.abs(points[nearest].time - time))
                        nearest = i;
                }
                this.select(nearest);
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            if (![Clutter.KEY_Left, Clutter.KEY_Right, Clutter.KEY_Home, Clutter.KEY_End].includes(key))
                return Clutter.EVENT_PROPAGATE;
            this.select(key === Clutter.KEY_Home ? 0 : key === Clutter.KEY_End ? points.length - 1 : this.index + (key === Clutter.KEY_Left ? -1 : 1));
            return Clutter.EVENT_STOP;
        });
        this.connect('key-focus-in', () => this.select(this.index));
        this.select(this.index);
    }

    _geometry(width, height) {
        const axis = this._topLabel !== null || this._bottomLabel !== null;
        const left = 8 + (axis ? AXIS_GUTTER : 0);
        const top = axis ? 16 : 9;
        const bottom = axis ? 13 : 9;
        return {left, top, plotWidth: Math.max(1, width - left - 8), plotHeight: Math.max(1, height - top - bottom)};
    }

    select(index) {
        this.index = Math.max(0, Math.min(this.points.length - 1, index));
        const point = this.points[this.index];
        if (point) {
            const description = this._describe(point);
            this.accessible_name = description + '. Flechas para consultar otros valores.';
            this._onSelect(description);
            this.queue_repaint();
        }
    }

    _draw() {
        const cr = this.get_context();
        const [surfaceWidth, surfaceHeight] = this.get_surface_size();
        const width = this.get_width();
        const scale = width > 0 ? surfaceWidth / width : 1;
        cr.save();
        cr.scale(scale, scale);
        const [logicalWidth, logicalHeight] = [surfaceWidth / scale, surfaceHeight / scale];
        const {left, top, plotWidth, plotHeight} = this._geometry(logicalWidth, logicalHeight);
        const base = top + plotHeight;
        const x = point => left + (point.time - this._start) / (this._end - this._start) * plotWidth;
        const y = point => top + plotHeight * (1 - Math.min(1, Math.max(0, (point.value - this._minimum) / (this._maximum - this._minimum || 1))));
        this._drawAxis(cr, {left, top, base});
        cr.setLineWidth(1);
        for (let i = 0; i < 3; i++) {
            source(cr, [169, 183, 204], 0.12);
            cr.moveTo(left, top + i * plotHeight / 2);
            cr.lineTo(left + plotWidth, top + i * plotHeight / 2);
            cr.stroke();
        }
        if (this._kind === 'bars') {
            const barWidth = Math.max(2, Math.min(24, plotWidth * 86400000 / (this._end - this._start) * 0.55));
            for (const [index, point] of this.points.entries()) {
                source(cr, this._color, index === this.index ? 1 : 0.65);
                const barHeight = Math.max(2, top + plotHeight - y(point));
                cr.rectangle(x(point) - barWidth / 2, top + plotHeight - barHeight, barWidth, barHeight);
                cr.fill();
            }
        } else {
            this._drawLine(cr, {left, base, plotWidth, nodes: this.points.map(point => ({x: x(point), y: y(point)}))});
        }
        const selected = this.points[this.index];
        if (selected) {
            source(cr, this._color, 0.25);
            cr.setLineWidth(1);
            cr.moveTo(x(selected), top);
            cr.lineTo(x(selected), top + plotHeight);
            cr.stroke();
            source(cr, this._color);
            cr.arc(x(selected), y(selected), 3, 0, 2 * Math.PI);
            cr.fill();
        }
        cr.restore();
        cr.$dispose();
    }

    _drawAxis(cr, {left, top, base}) {
        for (const [text, y] of [[this._topLabel, top - 12], [this._bottomLabel, base + 1]]) {
            if (!text)
                continue;
            const layout = PangoCairo.create_layout(cr);
            layout.set_font_description(Pango.FontDescription.from_string(AXIS_FONT));
            layout.set_text(text, -1);
            const [textWidth] = layout.get_pixel_size();
            source(cr, [169, 183, 204], 0.55);
            cr.moveTo(Math.max(2, left - 6 - textWidth), y);
            PangoCairo.show_layout(cr, layout);
        }
    }

    _drawLine(cr, {left, base, plotWidth, nodes}) {
        paintSeries(cr, {nodes, groups: runs(this.points), spans: smoothSpans(nodes),
            color: this._color, left, base, plotWidth, fill: this._fill});
    }
});
