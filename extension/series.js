export const GAP_MS = 15 * 60000;

export function runs(points, gapMs = GAP_MS) {
    const result = [];
    for (const [index, point] of points.entries()) {
        const current = result.at(-1);
        const previous = current && points[current.at(-1)];
        if (previous && point.time - previous.time <= gapMs && point.reset === previous.reset)
            current.push(index);
        else
            result.push([index]);
    }
    return result;
}

function tangent(nodes, slopes, index) {
    if (!index)
        return slopes[0];
    if (index === nodes.length - 1)
        return slopes.at(-1);
    const before = slopes[index - 1];
    const after = slopes[index];
    if (before * after <= 0)
        return 0;
    const widthBefore = nodes[index].x - nodes[index - 1].x;
    const widthAfter = nodes[index + 1].x - nodes[index].x;
    const first = 2 * widthAfter + widthBefore;
    const second = widthAfter + 2 * widthBefore;
    return (first + second) / (first / before + second / after);
}

export function smoothSpans(nodes) {
    if (nodes.length < 2)
        return [];
    const slopes = [];
    for (let index = 0; index < nodes.length - 1; index++) {
        const width = nodes[index + 1].x - nodes[index].x;
        slopes.push(width > 0 ? (nodes[index + 1].y - nodes[index].y) / width : 0);
    }
    const spans = [];
    for (let index = 0; index < nodes.length - 1; index++) {
        const width = nodes[index + 1].x - nodes[index].x;
        spans.push({
            c1: {x: nodes[index].x + width / 3, y: nodes[index].y + tangent(nodes, slopes, index) * width / 3},
            c2: {x: nodes[index + 1].x - width / 3, y: nodes[index + 1].y - tangent(nodes, slopes, index + 1) * width / 3},
        });
    }
    return spans;
}

export function paintSeries(cr, {nodes, groups, spans, color, left, base, plotWidth, fill = true}) {
    const paint = opacity => cr.setSourceRGBA(color[0] / 255, color[1] / 255, color[2] / 255, opacity);
    const dot = node => {
        paint(1);
        cr.arc(node.x, Math.max(3, Math.min(base - 3, node.y)), 3, 0, 2 * Math.PI);
        cr.fill();
    };
    cr.setLineCap(1);
    cr.setLineJoin(1);
    if (nodes.length < 2) {
        const node = nodes.at(0);
        if (!node)
            return;
        const level = Math.max(3, Math.min(base - 3, node.y));
        paint(0.45);
        cr.setLineWidth(1.5);
        cr.setDash([3, 4], 0);
        cr.moveTo(left, level);
        cr.lineTo(left + plotWidth, level);
        cr.stroke();
        cr.setDash([], 0);
        dot(node);
        return;
    }
    const curve = index => {
        const span = spans[index];
        cr.curveTo(span.c1.x, span.c1.y, span.c2.x, span.c2.y, nodes[index + 1].x, nodes[index + 1].y);
    };
    const trace = (from, to) => {
        cr.moveTo(nodes[from].x, nodes[from].y);
        for (let index = from; index < to; index++)
            curve(index);
    };
    if (fill) {
        for (const group of groups) {
            if (group.length < 2)
                continue;
            const last = group.at(-1);
            if (nodes[last].x - nodes[group[0]].x < 4)
                continue;
            paint(0.12);
            cr.moveTo(nodes[group[0]].x, base);
            cr.lineTo(nodes[group[0]].x, nodes[group[0]].y);
            for (let index = group[0]; index < last; index++)
                curve(index);
            cr.lineTo(nodes[last].x, base);
            cr.closePath();
            cr.fill();
        }
    }
    if (groups.length > 1) {
        paint(0.5);
        cr.setLineWidth(1.5);
        cr.setDash([3, 3], 0);
        for (let index = 1; index < groups.length; index++) {
            trace(groups[index - 1].at(-1), groups[index][0]);
            cr.stroke();
        }
        cr.setDash([], 0);
    }
    paint(1);
    cr.setLineWidth(2);
    for (const group of groups) {
        if (group.length < 2) {
            dot(nodes[group[0]]);
            continue;
        }
        trace(group[0], group.at(-1));
        cr.stroke();
    }
}
