const $ = id => document.getElementById(id);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = v => Number.isFinite(+v) ? +v : 0;
// Swedish locale formats as YYYY-MM-DD, in local time.
const today = () => new Date().toLocaleDateString('sv');

function isCurrency(code) {
    try { return typeof code === 'string' && !!new Intl.NumberFormat('en', { style: 'currency', currency: code }); }
    catch { return false; }
}

// Accepts saved data, an imported backup, or the older { name: amount } format.
function normalize(raw) {
    const rows = v => (Array.isArray(v) ? v : Object.entries(v ?? {}).map(([name, amount]) => ({ name, amount })))
        .map(r => ({ name: String(r?.name ?? ''), amount: num(r?.amount), sign: r?.sign }));
    return {
        goal: num(raw.goal) > 0 ? num(raw.goal) : 2500,
        currency: isCurrency(raw.currency) ? raw.currency : 'EUR',
        current: rows(raw.current).map(({ name, amount }) => ({ name, amount })),
        // Debts are stored as a positive amount plus a sign: 1 = they owe me, -1 = I owe them.
        debts: rows(raw.debts).map(({ name, amount, sign }) => ({ name, amount: Math.abs(amount), sign: sign === -1 || amount < 0 ? -1 : 1 })),
        history: Object.fromEntries(Object.entries(raw.history ?? {}).filter(([d, v]) => DATE.test(d) && Number.isFinite(v))),
        lastBackup: DATE.test(raw.lastBackup) ? raw.lastBackup : null,
    };
}

console.assert(normalize({ current: { Wallet: 100 }, debts: { John: -5 } }).debts[0].sign === -1, 'normalize: old format');
console.assert(JSON.stringify(normalize(normalize({ debts: [{ name: 'A', amount: 0, sign: -1 }] }))).includes('"sign":-1'), 'normalize: keeps sign of a zero debt');

let data;
try { data = normalize(JSON.parse(localStorage.getItem('data')) || {}); }
catch { data = normalize({}); }

const sumOf = list => list.reduce((s, r) => s + (r.sign ?? 1) * r.amount, 0);
const money = (n, opts) => new Intl.NumberFormat(undefined, {
    style: 'currency', currency: data.currency, minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2, ...opts,
}).format(n);
const compact = n => money(n, { notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const shortDate = d => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

function save(total) {
    if (data.current.length || data.debts.length) data.history[today()] = total;
    try { localStorage.setItem('data', JSON.stringify(data)); }
    catch { toast("Couldn't save. Your browser storage may be full or blocked."); }
}

let wasReached;
function update() {
    const current = sumOf(data.current);
    const debts = sumOf(data.debts);
    const total = current + debts;
    const pct = Math.max(0, Math.min(100, total / data.goal * 100));
    const reached = total >= data.goal;

    $('current-total').textContent = money(current);
    $('debts-total').textContent = money(debts, { signDisplay: 'exceptZero' });
    $('total-amount').textContent = money(total);
    $('goal-amount').textContent = money(data.goal);
    $('bar-filled').style.width = pct + '%';
    $('bar').setAttribute('aria-valuenow', Math.floor(pct));
    $('percent').textContent = Math.floor(pct) + '%';
    $('to-go').textContent = !reached ? `${money(data.goal - total)} to go`
        : total > data.goal ? `Goal reached, ${money(total - data.goal)} over` : 'Goal reached';
    $('hero').classList.toggle('reached', reached);
    if (reached && wasReached === false) toast('You reached your goal');
    wasReached = reached;

    $('last-backup').textContent = data.lastBackup ? `Last backup: ${shortDate(data.lastBackup)}` : 'Not backed up yet';
    save(total);
    drawChart();
}

function render() {
    for (const type of ['current', 'debts']) {
        $(type + '-items').replaceChildren(...data[type].map((row, i) => makeRow(type, row, i)));
    }
    $('currency').value = data.currency;
    update();
}

function button(className, text, onclick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = text;
    b.onclick = onclick;
    return b;
}

function makeRow(type, row, i) {
    const li = document.createElement('li');
    li.className = 'row';

    const name = button('plain name', row.name, async () => {
        const newName = await ask('Rename', row.name);
        if (newName) { row.name = newName; render(); }
    });
    name.title = 'Rename';
    li.append(name);

    if (type === 'debts') {
        const sign = button('plain sign', '', () => { row.sign = -row.sign; showSign(); update(); });
        function showSign() {
            sign.textContent = row.sign > 0 ? 'owes me' : 'I owe';
            sign.classList.toggle('negative', row.sign < 0);
        }
        showSign();
        sign.setAttribute('aria-label', `${row.name}: switch between owes me and I owe`);
        li.append(sign);
    }

    const input = document.createElement('input');
    Object.assign(input, { type: 'number', inputMode: 'decimal', step: 'any', placeholder: '0', value: row.amount || '' });
    input.className = 'amount';
    input.setAttribute('aria-label', `${row.name} amount`);
    input.oninput = () => {
        row.amount = type === 'debts' ? Math.abs(num(input.value)) : num(input.value);
        update();
    };

    const del = button('plain delete', '×', () => {
        data[type].splice(i, 1);
        render();
        toast(`Removed ${row.name}`, () => { data[type].splice(i, 0, row); render(); });
    });
    del.setAttribute('aria-label', `Remove ${row.name}`);

    li.append(input, del);
    return li;
}

// One dialog for every question; resolves to the trimmed answer, or null if cancelled.
function ask(title, value = '', type = 'text', placeholder = '') {
    const dialog = $('ask');
    const input = $('ask-input');
    $('ask-title').textContent = title;
    Object.assign(input, { type, value, placeholder, inputMode: type === 'number' ? 'decimal' : 'text' });
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise(resolve => dialog.addEventListener('close',
        () => resolve(dialog.returnValue === 'ok' ? input.value.trim() : null), { once: true }));
}

async function addRow(type) {
    const name = type === 'current'
        ? await ask('Add an account', '', 'text', 'e.g. Revolut, wallet')
        : await ask('Add a debt', '', 'text', 'Who? e.g. John');
    if (!name) return;
    data[type].push(type === 'debts' ? { name, amount: 0, sign: 1 } : { name, amount: 0 });
    render();
    $(type + '-items').lastChild.querySelector('input').focus();
}

let toastTimer;
function toast(message, undo) {
    $('toast-text').textContent = message;
    $('toast-undo').hidden = !undo;
    $('toast-undo').onclick = () => { undo(); $('toast').classList.remove('show'); };
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 5000);
}

function niceCeil(v) {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    return [1, 2, 2.5, 5, 10].map(m => m * p).find(n => n >= v);
}

function drawChart() {
    const points = Object.entries(data.history).sort(([a], [b]) => a < b ? -1 : 1).map(([d, v]) => ({ t: Date.parse(d), v }));
    $('chart-empty').hidden = points.length > 1;
    $('chart-area').hidden = points.length < 2;
    if (points.length < 2) return;

    $('history-table').replaceChildren(...[...points].reverse().map(p => {
        const tr = document.createElement('tr');
        for (const text of [shortDate(p.t), money(p.v)]) tr.appendChild(document.createElement('td')).textContent = text;
        return tr;
    }));

    const svg = $('chart');
    const W = svg.clientWidth || 300, H = 180, L = 48, R = 12, T = 12, B = 24;
    const values = points.map(p => p.v);
    const top = niceCeil(Math.max(data.goal, ...values));
    const bottom = Math.min(...values) < 0 ? -niceCeil(-Math.min(...values)) : 0;
    const t0 = points[0].t, t1 = points.at(-1).t;
    const x = t => L + (t - t0) / (t1 - t0) * (W - L - R);
    const y = v => T + (top - v) / (top - bottom) * (H - T - B);
    const ticks = [...new Set([bottom, 0, top / 2, top])];
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t)},${y(p.v)}`).join('');
    const last = points.at(-1);

    // Only numbers and Intl output go into this markup, never user-typed names.
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `
        ${ticks.map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>
            <text class="tick" x="${L - 6}" y="${y(v)}">${compact(v)}</text>`).join('')}
        <line class="goal-line" x1="${L}" x2="${W - R}" y1="${y(data.goal)}" y2="${y(data.goal)}"/>
        <text class="goal-label" x="${W - R}" y="${y(data.goal) - 6}">Goal</text>
        <path class="area" d="${line}L${x(last.t)},${y(0)}L${L},${y(0)}Z"/>
        <path class="line" d="${line}"/>
        <text class="date-tick" x="${L}" y="${H - 4}">${shortDate(t0)}</text>
        <text class="date-tick end" x="${W - R}" y="${H - 4}">${shortDate(t1)}</text>
        <line class="crosshair hover" id="crosshair" y1="${T}" y2="${H - B}"/>
        <circle class="dot" cx="${x(last.t)}" cy="${y(last.v)}" r="4"/>
        <circle class="dot hover" id="hover-dot" r="4"/>`;

    const tooltip = $('tooltip');
    svg.onpointerdown = svg.onpointermove = e => {
        const px = e.clientX - svg.getBoundingClientRect().left;
        const p = points.reduce((a, b) => Math.abs(x(b.t) - px) < Math.abs(x(a.t) - px) ? b : a);
        $('crosshair').setAttribute('x1', x(p.t));
        $('crosshair').setAttribute('x2', x(p.t));
        $('hover-dot').setAttribute('cx', x(p.t));
        $('hover-dot').setAttribute('cy', y(p.v));
        tooltip.querySelector('strong').textContent = money(p.v);
        tooltip.querySelector('span').textContent = shortDate(p.t);
        tooltip.style.left = Math.min(Math.max(x(p.t), 50), W - 50) + 'px';
        tooltip.hidden = false;
        svg.classList.add('hovering');
    };
    svg.onpointerleave = svg.onpointercancel = () => { tooltip.hidden = true; svg.classList.remove('hovering'); };
}

$('add-current').onclick = () => addRow('current');
$('add-debt').onclick = () => addRow('debts');

$('goal-btn').onclick = async () => {
    const goal = num(await ask('Savings goal', data.goal, 'number'));
    if (goal > 0) { data.goal = goal; update(); }
};

$('currency').replaceChildren(...(Intl.supportedValuesOf?.('currency') ?? ['EUR', 'GBP', 'USD'])
    .map(code => new Option(code, code)));
$('currency').onchange = e => { data.currency = e.target.value; update(); };

$('export').onclick = () => {
    data.lastBackup = today();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `savings-backup-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    update();
};

$('import').onclick = () => $('import-file').click();
$('import-file').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let raw;
    try { raw = JSON.parse(await file.text()); } catch {}
    if (!raw?.current && !raw?.debts) return toast("That file isn't a savings backup.");
    if (!confirm('Replace everything in the app with this backup?')) return;
    data = normalize(raw);
    render();
    toast('Backup imported');
};

addEventListener('resize', drawChart);
navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

render();
