import React, { useState } from 'react';
import { ChartLine, Plus, Trash2, DownloadCloud, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';

export default function AvalancheLoanCalculator() {
  // --- Top-level numeric state (NaN-safe inputs handled in the inputs) ---
  const [salary, setSalary] = useState(80000);
  const [extraIncome, setExtraIncome] = useState(10000);
  const [expenses, setExpenses] = useState(40000);

  const [loans, setLoans] = useState([
    { id: 'L1', name: 'Personal loan', principal: 50000, emi: 3000, annualRate: 0.14 },
    { id: 'L2', name: 'Car loan', principal: 100000, emi: 6000, annualRate: 0.12 },
    { id: 'L3', name: 'Business loan', principal: 300000, emi: 12000, annualRate: 0.27 },
  ]);

  const [monthsLimit, setMonthsLimit] = useState(240);

  // Lumpsums accept a calendar month (YYYY-MM). We'll convert to 1-based simulation month.
  const [lumps, setLumps] = useState([]); // { id, monthIndex (1-based), amount, note, monthLabel }
  const [lumpMonthLabel, setLumpMonthLabel] = useState(''); // YYYY-MM
  const [lumpAmount, setLumpAmount] = useState('');
  const [lumpNote, setLumpNote] = useState('');

  const [schedule, setSchedule] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');

  const currency = (v) => `₹${Number(v).toLocaleString('en-IN')}`;
  const safeNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  function cloneLoans(arr) {
    return arr.map((l, i) => ({
      id: l.id || `loan_${i + 1}`,
      name: l.name || l.id || `Loan ${i + 1}`,
      principal: safeNum(l.principal),
      emi: safeNum(l.emi),
      annualRate: Number.isFinite(Number(l.annualRate)) ? Number(l.annualRate) : 0,
    }));
  }

  // helper: compute month index (1-based) from YYYY-MM relative to start (first day of current month)
  function monthIndexFromLabel(label) {
    const [y, m] = (label || '').split('-').map(Number);
    if (!y || !m) return null;
    const start = new Date();
    const startY = start.getFullYear();
    const startM = start.getMonth() + 1; // 1..12
    const idx = (y - startY) * 12 + (m - startM) + 1; // +1 to make first month = 1
    return idx; // can be 1, 2, ... or negative if before current month
  }

  function addLumpsum() {
    setError('');
    const label = lumpMonthLabel;
    const amount = Number(lumpAmount);
    const note = lumpNote?.trim();

    if (!label) {
      setError('Please pick a month (YYYY-MM).');
      return;
    }
    const idx = monthIndexFromLabel(label);
    if (idx === null || Number.isNaN(idx)) {
      setError('Invalid month format. Use the month picker.');
      return;
    }
    if (idx < 1) {
      const now = new Date();
      const minLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      setError(`Chosen month must be this month (${minLabel}) or later.`);
      return;
    }
    if (!amount || amount <= 0) {
      setError('Lumpsum amount must be a positive number.');
      return;
    }

    const id = `LP${Date.now()}`;
    setLumps([...lumps, { id, monthIndex: idx, amount, note, monthLabel: label }]);
    setLumpMonthLabel('');
    setLumpAmount('');
    setLumpNote('');
  }

  function removeLumpsum(id) {
    const lp = lumps.find((l) => l.id === id);
    const label = lp?.monthLabel || 'selected month';
    const amt = lp?.amount != null ? currency(lp.amount) : '';
    const confirmed = window.confirm(`Remove lumpsum scheduled for ${label} amount ${amt}?`);
    if (!confirmed) return;
    setLumps(lumps.filter((l) => l.id !== id));
  }

  function runAvalanche() {
    setError('');
    try {
      const payload = {
        salary: safeNum(salary),
        extraIncome: safeNum(extraIncome),
        expenses: safeNum(expenses),
        monthsLimit: safeNum(monthsLimit) || 600,
        loans: cloneLoans(loans),
        lumps: lumps.map((lp) => ({ month: lp.monthIndex, amount: safeNum(lp.amount), note: lp.note, label: lp.monthLabel })),
      };
      const { schedule, summary } = avalancheSimulator(payload);
      setSchedule(schedule);
      setSummary(summary);
    } catch (e) {
      setError(e.message || String(e));
      setSchedule(null);
      setSummary(null);
    }
  }

  // --- Simulator ---
  function avalancheSimulator(payload) {
    const working = payload.loans.map((l) => ({ ...l }));
    const baseMonthly = payload.salary + payload.extraIncome - payload.expenses; // monthly income leftover before EMIs
    if (!Number.isFinite(baseMonthly)) throw new Error('Invalid monthly incomes/expenses.');

    // Validate EMIs cover first-month interest
    for (const l of working) {
      const monthlyRate = l.annualRate / 12;
      const firstInterest = l.principal * monthlyRate;
      if (l.emi <= firstInterest - 1e-9) {
        throw new Error(`EMI for ${l.name || l.id} (${currency(l.emi)}) does not cover first-month interest (${currency(firstInterest.toFixed(2))}).`);
      }
    }

    const rows = [];
    let month = 1;
    let totalInterest = 0;
    let totalPaid = 0;
    const start = new Date();
    start.setDate(1);

    const initialOutstanding = working.reduce((s, l) => s + l.principal, 0);

    while (working.length > 0 && month <= payload.monthsLimit) {
      // Sort highest-rate-first
      working.sort((a, b) => b.annualRate - a.annualRate);

      // sum of EMIs for current working loans
      const currentEmis = working.reduce((s, l) => s + l.emi, 0);

      // surplus available after paying current EMIs
      const rawSurplusBefore = baseMonthly - currentEmis;
      const surplusBefore = rawSurplusBefore > 0 ? rawSurplusBefore : 0;

      // lumpsums scheduled for this month
      const lumpsThisMonth = (payload.lumps || []).filter((lp) => Number(lp.month) === month);
      const lumpTotalThisMonth = lumpsThisMonth.reduce((s, x) => s + Number(x.amount || 0), 0);

      // surplus available to allocate to loans this month (will be consumed and may cascade)
      let surplusRemaining = surplusBefore + lumpTotalThisMonth;

      const rowLoans = [];
      let monthInterest = 0;
      let monthPaid = 0;

      for (let i = 0; i < working.length; i++) {
        const loan = working[i];
        const monthlyRate = loan.annualRate / 12;
        const interest = loan.principal * monthlyRate;

        let payment = loan.emi;
        let extraPaid = 0;

        if (surplusRemaining > 0) {
          extraPaid = surplusRemaining;
          payment += extraPaid;
        }

        const payoffAmount = loan.principal + interest;
        if (payment >= payoffAmount - 1e-9) {
          const usedExtra = Math.max(0, payoffAmount - loan.emi);
          extraPaid = usedExtra;
          payment = payoffAmount;
          surplusRemaining = Math.max(0, surplusRemaining - usedExtra);
        } else {
          extraPaid = Math.min(extraPaid, surplusRemaining);
          surplusRemaining = 0;
        }

        const principalPaid = payment - interest;
        loan.principal = Math.max(0, loan.principal - principalPaid);

        rowLoans.push({
          id: loan.id,
          name: loan.name,
          rate: loan.annualRate,
          interest: +interest.toFixed(2),
          emi: +loan.emi.toFixed(2),
          extraPaid: +extraPaid.toFixed(2),
          principalPaid: +principalPaid.toFixed(2),
          balanceAfter: +loan.principal.toFixed(2),
        });

        monthInterest += interest;
        monthPaid += payment;
      }

      // Remove cleared loans from the working set
      for (let i = working.length - 1; i >= 0; i--) {
        if (working[i].principal <= 1e-9) working.splice(i, 1);
      }

      // total outstanding after this month's payments
      const totalOutstanding = rowLoans.reduce((s, r) => s + r.balanceAfter, 0);

      // Local YYYY-MM label to avoid UTC off-by-one
      const d = new Date(start.getFullYear(), start.getMonth() + (month - 1), 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      rows.push({
        month,
        date: ym,
        surplusBefore: +surplusBefore.toFixed(2),
        lumpsThisMonth: lumpsThisMonth.map((lp) => ({ amount: +Number(lp.amount).toFixed(2), note: lp.note || '', label: lp.label || null })),
        totalInterestThisMonth: +monthInterest.toFixed(2),
        totalPaidThisMonth: +monthPaid.toFixed(2),
        totalOutstanding: +totalOutstanding.toFixed(2),
        loans: rowLoans,
      });

      totalInterest += monthInterest;
      totalPaid += monthPaid;
      month++;
    }

    const finalOutstanding = rows.length ? rows[rows.length - 1].totalOutstanding : initialOutstanding;

    return {
      schedule: rows,
      summary: {
        totalMonths: month - 1,
        totalInterestPaid: +totalInterest.toFixed(2),
        totalPaid: +totalPaid.toFixed(2),
        totalOutstanding: +finalOutstanding.toFixed(2),
        monthsLimitReached: month > payload.monthsLimit,
      },
    };
  }

  function addLoan() {
    setLoans([
      ...loans,
      { id: `L${loans.length + 1}`, name: `Loan ${loans.length + 1}`, principal: 0, emi: 0, annualRate: 0 },
    ]);
  }
  function removeLoan(id) {
    setLoans(loans.filter((l) => l.id !== id));
  }
  function updateLoan(id, field, value) {
    setLoans(loans.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  }

  function downloadCSV() {
    if (!schedule) return;
    const lines = [];
    lines.push('month,date,surplus_before,total_interest,total_paid,total_outstanding,lumpsum_amount,lumpsum_note,loan_id,loan_name,loan_rate_pct,interest,emi,extra_paid,principal_paid,balance_after');
    schedule.forEach((r) => {
      const lumpAmount = r.lumpsThisMonth && r.lumpsThisMonth.length ? r.lumpsThisMonth.reduce((s, x) => s + x.amount, 0) : 0;
      const lumpNotes = r.lumpsThisMonth && r.lumpsThisMonth.length ? r.lumpsThisMonth.map((x) => x.note).filter(Boolean).join('; ') : '';
      r.loans.forEach((ln) => {
        lines.push([
          r.month,
          r.date,
          r.surplusBefore,
          r.totalInterestThisMonth,
          r.totalPaidThisMonth,
          r.totalOutstanding,
          lumpAmount,
          `"${lumpNotes}"`,
          ln.id,
          ln.name,
          (ln.rate * 100).toFixed(2), // export as percent
          ln.interest,
          ln.emi,
          ln.extraPaid,
          ln.principalPaid,
          ln.balanceAfter,
        ].join(','));
      });
    });
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'loan_prepayment_schedule_with_lumpsums.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const latestMonth = schedule && schedule.length ? schedule[schedule.length - 1].month : null;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6">
      <header className="mb-6 border-b pb-4">
        <h1 className="text-4xl sm:text-3xl font-bold tracking-tight text-gray-800">Loan Prepayment</h1>
        <p className="mt-1 text-md text-gray-500">Plan your debt-free journey with loan payoff calculations and one-time lumpsum payments.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <section className="bg-white p-3 sm:p-4 rounded-lg shadow-sm border">
          <h2 className="font-semibold mb-2 text-sm sm:text-base">Monthly Finances & Lumpsums</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
            <div>
              <label className="block text-xs sm:text-sm text-gray-600">Salary (take-home)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={Number.isFinite(salary) ? salary : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setSalary(v === '' ? NaN : Number(v));
                }}
                className="w-full p-2 sm:p-3 border rounded focus:ring-2 focus:ring-indigo-200 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs sm:text-sm text-gray-600">Extra income</label>
              <input
                type="number"
                min="0"
                step="1"
                value={Number.isFinite(extraIncome) ? extraIncome : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setExtraIncome(v === '' ? NaN : Number(v));
                }}
                className="w-full p-2 sm:p-3 border rounded focus:ring-2 focus:ring-indigo-200 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs sm:text-sm text-gray-600">Expenses</label>
              <input
                type="number"
                min="0"
                step="1"
                value={Number.isFinite(expenses) ? expenses : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setExpenses(v === '' ? NaN : Number(v));
                }}
                className="w-full p-2 sm:p-3 border rounded focus:ring-2 focus:ring-indigo-200 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs sm:text-sm text-gray-600">Months cap</label>
              <input
                type="number"
                min="1"
                step="1"
                value={Number.isFinite(monthsLimit) ? monthsLimit : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setMonthsLimit(v === '' ? NaN : Number(v));
                }}
                className="w-full p-2 sm:p-3 border rounded focus:ring-2 focus:ring-indigo-200 text-sm"
              />
            </div>

            <div className="sm:col-span-2 mt-2">
              <h3 className="text-sm font-medium mb-2">Schedule one-time lumpsum payment (calendar month)</h3>
              <div className="flex gap-2 items-center">
                <input
                  type="month"
                  value={lumpMonthLabel}
                  onChange={(e) => setLumpMonthLabel(e.target.value)}
                  className="w-36 p-2 border rounded text-sm"
                />
                <input
                  placeholder="Amount"
                  type="number"
                  min="1"
                  step="1"
                  value={lumpAmount}
                  onChange={(e) => setLumpAmount(e.target.value)}
                  className="w-36 p-2 border rounded text-sm"
                />
                <input
                  placeholder="Note (optional)"
                  value={lumpNote}
                  onChange={(e) => setLumpNote(e.target.value)}
                  className="flex-1 p-2 border rounded text-sm"
                />
                <button onClick={addLumpsum} className="px-3 py-2 bg-blue-600 text-white rounded text-sm inline-flex items-center gap-2">
                  <Plus size={14} /> Add
                </button>
              </div>

              {lumps.length > 0 && (
                <div className="mt-3 space-y-2">
                  {lumps.map((lp) => (
                    <div key={lp.id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                      <div className="text-sm">
                        <div>
                          <strong>{lp.monthLabel}</strong> — {currency(lp.amount)} {lp.note && <span className="text-xs text-gray-500">• {lp.note}</span>}
                        </div>
                      </div>
                      <div>
                        <button
                          onClick={() => removeLumpsum(lp.id)}
                          title="Remove lumpsum"
                          aria-label="Remove lumpsum"
                          className="p-2 rounded bg-red-50 hover:bg-red-100 text-red-600 border"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {error && <div className="col-span-2 mt-2 text-sm text-red-700 bg-red-50 p-2 rounded">{error}</div>}
          </div>
        </section>

        <section className="bg-white p-3 sm:p-4 rounded-lg shadow-sm border">
          <h2 className="font-semibold mb-2 text-sm sm:text-base">Loans</h2>
          <div className="space-y-3">
            {loans.map((l, idx) => (
              <div key={l.id} className="border rounded p-3 sm:p-2 bg-white shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="text-sm font-medium">{l.id}</div>
                        <div className="text-xs text-gray-500 hidden sm:block">{l.name}</div>
                      </div>
                      <div className="sm:hidden text-xs text-gray-500">{l.name}</div>
                    </div>

                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-6 gap-2">
                      <div className="sm:col-span-3">
                        <label className="block text-xs text-gray-600">Name</label>
                        <input value={l.name} onChange={(e) => updateLoan(l.id, 'name', e.target.value)} className="w-full p-2 border rounded text-sm" />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-xs text-gray-600">Principal</label>
                        <input
                          type="number"
                          value={Number.isFinite(l.principal) ? l.principal : ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateLoan(l.id, 'principal', v === '' ? NaN : Number(v));
                          }}
                          className="w-full p-2 border rounded text-sm"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs text-gray-600">EMI</label>
                        <input
                          type="number"
                          value={Number.isFinite(l.emi) ? l.emi : ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateLoan(l.id, 'emi', v === '' ? NaN : Number(v));
                          }}
                          className="w-full p-2 border rounded text-sm"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs text-gray-600">Rate %</label>
                        <input
                          type="number"
                          value={Number.isFinite(l.annualRate) ? (l.annualRate * 100).toFixed(2) : ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateLoan(l.id, 'annualRate', v === '' ? NaN : Number(v) / 100);
                          }}
                          className="w-full p-2 border rounded text-sm"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="ml-3 flex-shrink-0 mt-1 sm:mt-0">
                    <button
                      onClick={() => removeLoan(l.id)}
                      aria-label="Remove loan"
                      className="p-2 rounded pl-[15px] bg-red-50 hover:bg-red-100 text-red-600 border w-12 h-10"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <div>
              <button onClick={addLoan} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm">
                <Plus size={14} /> Add loan
              </button>
            </div>
          </div>
        </section>
      </div>

      <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-start">
        <div className="sm:col-span-1">
          <button
            onClick={downloadCSV}
            aria-label="Export CSV"
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded shadow text-sm"
          >
            <DownloadCloud size={16} /> Export CSV
          </button>
        </div>
        <div className="sm:col-span-1">
          <button
            onClick={runAvalanche}
            aria-label="Run simulation"
            className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-3 rounded shadow text-sm"
          >
            <ChartLine size={16} /> Run Simulation
          </button>
        </div>

        <div className="sm:col-span-2 lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {summary ? (
            <>
              <div className="p-3 bg-white rounded shadow border text-center">
                <div className="text-xs text-gray-500">Months to payoff</div>
                <div className="text-lg font-bold">{summary.totalMonths}</div>
              </div>
              <div className="p-3 bg-white rounded shadow border text-center">
                <div className="text-xs text-gray-500">Total interest</div>
                <div className="text-lg font-bold">{currency(summary.totalInterestPaid)}</div>
              </div>
              <div className="p-3 bg-white rounded shadow border text-center">
                <div className="text-xs text-gray-500">Total paid</div>
                <div className="text-lg font-bold">{currency(summary.totalPaid)}</div>
              </div>
            </>
          ) : (
            <div className="col-span-2 sm:col-span-3 p-3 bg-white rounded shadow border text-center text-gray-600">Run the simulation to see results.</div>
          )}
        </div>
      </div>

      {/* Months-limit banner */}
      {summary?.monthsLimitReached && (
        <div className="mb-4 p-3 rounded border bg-yellow-50 text-yellow-800 flex items-center gap-2">
          <AlertTriangle size={16} />
          <span className="text-sm">Months cap reached before all loans were cleared. Increase the cap to see full payoff.</span>
        </div>
      )}

      {schedule && (
        <section className="bg-white rounded shadow border p-3 sm:p-4">
          <h3 className="font-semibold mb-2 text-sm sm:text-base">Monthly schedule</h3>

          <div className="hidden md:block overflow-auto max-h-[520px]">
            <table className="w-full text-sm table-auto border-collapse">
              <thead>
                <tr className="bg-gray-50 sticky top-0">
                  <th className="p-2 border">Month</th>
                  <th className="p-2 border">Date</th>
                  <th className="p-2 border">Surplus</th>
                  <th className="p-2 border">Lumpsum</th>
                  <th className="p-2 border">Interest</th>
                  <th className="p-2 border">Paid</th>
                  <th className="p-2 border">Loan ID</th>
                  <th className="p-2 border">Loan Name</th>
                  <th className="p-2 border">Rate %</th>
                  <th className="p-2 border">Balance after</th>
                  <th className="p-2 border">Total outstanding</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((s) =>
                  s.loans.map((ln, idx) => (
                    <tr
                      key={`${s.month}-${ln.id}`}
                      className={clsx(idx === 0 ? (s.month === latestMonth ? 'bg-indigo-50 ring-2 ring-indigo-200' : 'bg-white') : 'bg-gray-50')}
                    >
                      <td className="p-2 border">
                        {s.month}
                        {s.month === latestMonth && (
                          <span className="ml-2 text-xs text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">Latest</span>
                        )}
                      </td>
                      <td className="p-2 border">{s.date}</td>
                      {idx === 0 ? (
                        <>
                          <td className="p-2 border" rowSpan={s.loans.length}>{currency(s.surplusBefore)}</td>
                          <td className="p-2 border" rowSpan={s.loans.length}>
                            {s.lumpsThisMonth && s.lumpsThisMonth.length
                              ? s.lumpsThisMonth.map((lp, i) => (
                                  <div key={i} className="text-xs text-gray-600">
                                    +{currency(lp.amount)} {lp.note && `• ${lp.note}`}
                                    {lp.label ? ` (${lp.label})` : ''}
                                  </div>
                                ))
                              : '—'}
                          </td>
                          <td className="p-2 border" rowSpan={s.loans.length}>{currency(s.totalInterestThisMonth)}</td>
                          <td className="p-2 border" rowSpan={s.loans.length}>{currency(s.totalPaidThisMonth)}</td>
                        </>
                      ) : null}
                      <td className="p-2 border">{ln.id}</td>
                      <td className="p-2 border">{ln.name}</td>
                      <td className="p-2 border">{(ln.rate * 100).toFixed(2)}%</td>
                      <td className="p-2 border">{currency(ln.balanceAfter)}</td>
                      {idx === 0 ? (
                        <td className="p-2 border text-right font-semibold" rowSpan={s.loans.length}>{currency(s.totalOutstanding)}</td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {schedule.map((s) => (
              <div key={s.month} className={clsx('border rounded p-3', s.month === latestMonth ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'bg-white')}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">
                      Month {s.month} <span className="text-xs text-gray-500">({s.date})</span>
                    </div>
                    <div className="text-xs text-gray-500">Surplus: {currency(s.surplusBefore)}</div>
                    {s.lumpsThisMonth && s.lumpsThisMonth.length ? (
                      <div className="text-xs text-gray-600">
                        Lumpsum: {s.lumpsThisMonth.map((x) => `${x.label ? `${x.label}: ` : ''}${currency(x.amount)}${x.note ? ` (${x.note})` : ''}`).join(', ')}
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Outstanding</div>
                    <div className="font-semibold">{currency(s.totalOutstanding)}</div>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {s.loans.map((ln) => (
                    <div key={ln.id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                      <div>
                        <div className="text-sm font-medium">{ln.id} — {ln.name}</div>
                        <div className="text-xs text-gray-500">Rate: {(ln.rate * 100).toFixed(2)}% • Balance: {currency(ln.balanceAfter)}</div>
                      </div>
                      <div className="text-right text-xs">
                        <div>Paid: {currency(ln.principalPaid + ln.interest)}</div>
                        <div className="text-gray-500">EMI {currency(ln.emi)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="mt-4 text-xs text-gray-500">Assumes monthly compounding and no prepayment penalties. Lumpsum payments are applied as extra surplus in the scheduled month.</footer>
    </div>
  );
}