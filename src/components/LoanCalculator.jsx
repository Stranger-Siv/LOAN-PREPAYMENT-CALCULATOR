import React, { useState } from 'react';
import { ChartLine, Plus, Trash2, DownloadCloud } from 'lucide-react';
import clsx from 'clsx';

// AvalancheLoanCalculator.jsx
// Updated: Adds Total outstanding to summary cards.

export default function AvalancheLoanCalculator() {
  const [salary, setSalary] = useState(80000);
  const [extraIncome, setExtraIncome] = useState(10000);
  const [expenses, setExpenses] = useState(40000);

  const [loans, setLoans] = useState([
    { id: 'L1', name: 'Personal loan', principal: 50000, emi: 3000, annualRate: 0.14 },
    { id: 'L2', name: 'Car loan', principal: 100000, emi: 6000, annualRate: 0.12 },
    { id: 'L3', name: 'Business loan', principal: 300000, emi: 12000, annualRate: 0.27 }
  ]);

  const [monthsLimit, setMonthsLimit] = useState(240);
  const [schedule, setSchedule] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');

  const currency = (v) => `₹${Number(v).toLocaleString('en-IN')}`;

  function cloneLoans(arr) {
    return arr.map((l, i) => ({
      id: l.id || `loan_${i+1}`,
      name: l.name || l.id || `Loan ${i+1}`,
      principal: Number(l.principal),
      emi: Number(l.emi),
      annualRate: Number(l.annualRate)
    }));
  }

  function runAvalanche() {
    setError('');
    try {
      const payload = {
        salary: Number(salary) || 0,
        extraIncome: Number(extraIncome) || 0,
        expenses: Number(expenses) || 0,
        monthsLimit: Number(monthsLimit) || 600,
        loans: cloneLoans(loans)
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

  // Avalanche simulator (surplus -> highest-rate loan; freed EMIs roll into surplus)
  function avalancheSimulator(payload) {
    const working = payload.loans.map(l => ({ ...l }));
    let baseSurplus = payload.salary + payload.extraIncome - payload.expenses - working.reduce((s, l) => s + l.emi, 0);
    if (isNaN(baseSurplus)) baseSurplus = 0;
    if (baseSurplus < 0) baseSurplus = 0;

    // safety: EMI >= first-month interest
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
    const start = new Date(); start.setDate(1);

    // initial outstanding (sum of principals) — used if simulation ends immediately
    const initialOutstanding = working.reduce((s, l) => s + l.principal, 0);

    while (working.length > 0 && month <= payload.monthsLimit) {
      // highest-rate-first
      working.sort((a, b) => b.annualRate - a.annualRate);
      let surplus = baseSurplus;
      const rowLoans = [];
      let monthInterest = 0;
      let monthPaid = 0;

      for (let i = 0; i < working.length; i++) {
        const loan = working[i];
        const rMonthly = loan.annualRate / 12;
        const interest = loan.principal * rMonthly;
        let payment = loan.emi;
        let extraPaid = 0;
        if (i === 0 && surplus > 0) {
          extraPaid = surplus;
          payment += extraPaid;
        }
        const payoffAmount = loan.principal + interest;
        if (payment >= payoffAmount - 1e-9) {
          payment = payoffAmount;
          extraPaid = Math.max(0, payment - loan.emi);
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
          balanceAfter: +loan.principal.toFixed(2)
        });

        monthInterest += interest;
        monthPaid += payment;
      }

      const totalOutstanding = rowLoans.reduce((s, r) => s + r.balanceAfter, 0);

      // freed EMIs added to baseSurplus for subsequent months
      const paidOff = working.filter(l => l.principal <= 1e-9);
      for (const p of paidOff) baseSurplus += p.emi;
      // remove cleared loans
      for (let i = working.length - 1; i >= 0; i--) if (working[i].principal <= 1e-9) working.splice(i, 1);

      const date = new Date(start.getFullYear(), start.getMonth() + (month - 1), 1);
      rows.push({
        month,
        date: date.toISOString().slice(0, 7),
        surplusBefore: +(baseSurplus - paidOff.reduce((s, p) => s + p.emi, 0)).toFixed(2),
        totalInterestThisMonth: +monthInterest.toFixed(2),
        totalPaidThisMonth: +monthPaid.toFixed(2),
        totalOutstanding: +totalOutstanding.toFixed(2),
        loans: rowLoans
      });

      totalInterest += monthInterest;
      totalPaid += monthPaid;
      month++;
    }

    // determine final outstanding: if we have schedule rows use last row's totalOutstanding, otherwise initialOutstanding
    const finalOutstanding = rows.length ? rows[rows.length - 1].totalOutstanding : initialOutstanding;

    return {
      schedule: rows,
      summary: {
        totalMonths: month - 1,
        totalInterestPaid: +totalInterest.toFixed(2),
        totalPaid: +totalPaid.toFixed(2),
        totalOutstanding: +finalOutstanding.toFixed(2),
        monthsLimitReached: month > payload.monthsLimit
      }
    };
  }

  // UI helpers
  function addLoan() { setLoans([...loans, { id: `L${loans.length + 1}`, name: `Loan ${loans.length + 1}`, principal: 0, emi: 0, annualRate: 0 }]); }
  function removeLoan(id) { setLoans(loans.filter(l => l.id !== id)); }
  function updateLoan(id, field, value) { setLoans(loans.map(l => l.id === id ? { ...l, [field]: value } : l)); }

  function downloadCSV() {
    if (!schedule) return;
    const lines = [];
    lines.push('month,date,surplus_before,total_interest,total_paid,total_outstanding,loan_id,loan_name,loan_rate,interest,emi,extra_paid,principal_paid,balance_after');
    schedule.forEach(r => {
      r.loans.forEach(ln => {
        lines.push([
          r.month,
          r.date,
          r.surplusBefore,
          r.totalInterestThisMonth,
          r.totalPaidThisMonth,
          r.totalOutstanding,
          ln.id,
          ln.name,
          ln.rate,
          ln.interest,
          ln.emi,
          ln.extraPaid,
          ln.principalPaid,
          ln.balanceAfter
        ].join(','));
      });
    });
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'avalanche_schedule.csv'; a.click(); URL.revokeObjectURL(url);
  }

  // compute latest month for highlighting
  const latestMonth = schedule && schedule.length ? schedule[schedule.length - 1].month : null;

  return (
    <div className="max-w-7xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight">Avalanche Loan Prepayment</h1>
        <p className="text-gray-500 mt-1">Put surplus toward the highest-rate loan; freed EMIs roll into the next loan.</p>
      </header>

      {/* TOP: Monthly Finances (left) + Loans (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Monthly Finances */}
        <section className="bg-white p-4 rounded-lg shadow-sm border">
          <h2 className="font-semibold mb-3">Monthly Finances</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600">Salary (take-home)</label>
              <input value={salary} onChange={e => setSalary(Number(e.target.value))} className="w-full p-2 border rounded focus:ring-2 focus:ring-indigo-200" />
            </div>
            <div>
              <label className="block text-sm text-gray-600">Extra income</label>
              <input value={extraIncome} onChange={e => setExtraIncome(Number(e.target.value))} className="w-full p-2 border rounded focus:ring-2 focus:ring-indigo-200" />
            </div>
            <div>
              <label className="block text-sm text-gray-600">Expenses</label>
              <input value={expenses} onChange={e => setExpenses(Number(e.target.value))} className="w-full p-2 border rounded focus:ring-2 focus:ring-indigo-200" />
            </div>
            <div>
              <label className="block text-sm text-gray-600">Months cap</label>
              <input value={monthsLimit} onChange={e => setMonthsLimit(Number(e.target.value))} className="w-full p-2 border rounded focus:ring-2 focus:ring-indigo-200" />
            </div>
            {error && <div className="col-span-2 mt-2 text-sm text-red-700 bg-red-50 p-2 rounded">{error}</div>}
          </div>
        </section>

        {/* Loans */}
        <section className="bg-white p-4 rounded-lg shadow-sm border">
          <h2 className="font-semibold mb-3">Loans</h2>
          <div className="space-y-3">
            {loans.map((l) => (
              <div key={l.id} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-1">
                  <label className="text-sm text-gray-600">ID</label>
                  <input className="p-2 border rounded w-full" value={l.id} onChange={e => updateLoan(l.id, 'id', e.target.value)} />
                </div>
                <div className="col-span-3">
                  <label className="text-sm text-gray-600">Name</label>
                  <input className="p-2 border rounded w-full" value={l.name} onChange={e => updateLoan(l.id, 'name', e.target.value)} />
                </div>
                <div className="col-span-3">
                  <label className="text-sm text-gray-600">Principal</label>
                  <input type="number" className="p-2 border rounded w-full" value={l.principal} onChange={e => updateLoan(l.id, 'principal', Number(e.target.value))} />
                </div>
                <div className="col-span-2">
                  <label className="text-sm text-gray-600">EMI</label>
                  <input type="number" className="p-2 border rounded w-full" value={l.emi} onChange={e => updateLoan(l.id, 'emi', Number(e.target.value))} />
                </div>
                <div className="col-span-2">
                  <label className="text-sm text-gray-600">Rate %</label>
                  <input type="number" className="p-2 border rounded w-full" value={(l.annualRate * 100).toFixed(2)} onChange={e => updateLoan(l.id, 'annualRate', Number(e.target.value) / 100)} />
                </div>
                <div className="col-span-1 text-right">
                  <button title="Remove" onClick={() => removeLoan(l.id)} className="p-2 rounded bg-red-50 hover:bg-red-100 text-red-600 border">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            <div className="pt-2">
              <button onClick={addLoan} className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded">
                <Plus size={14} /> Add loan
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* ACTIONS + SUMMARY */}
      <div className="mb-6 grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
        <div className="lg:col-span-1 flex gap-3">
          <button title="Download CSV" onClick={downloadCSV} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow">
            <DownloadCloud size={16} /> Export CSV
          </button>
          <button onClick={runAvalanche} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded shadow">
            <ChartLine size={16} /> Run Simulation
          </button>
        </div>

        <div className="lg:col-span-3 grid grid-cols-3 gap-4">
          {summary ? (
            <>
              <div className="p-4 bg-white rounded shadow border">
                <div className="text-sm text-gray-500">Months to payoff</div>
                <div className="text-2xl font-bold">{summary.totalMonths}</div>
              </div>
              <div className="p-4 bg-white rounded shadow border">
                <div className="text-sm text-gray-500">Total interest</div>
                <div className="text-2xl font-bold">{currency(summary.totalInterestPaid)}</div>
              </div>
              <div className="p-4 bg-white rounded shadow border">
                <div className="text-sm text-gray-500">Total paid</div>
                <div className="text-2xl font-bold">{currency(summary.totalPaid)}</div>
              </div>
              
            </>
          ) : (
            <div className="col-span-4 p-4 bg-white rounded shadow border text-center text-gray-600">Run the simulation to see results.</div>
          )}
        </div>
      </div>

      {/* SCHEDULE */}
      {schedule && (
        <section className="bg-white rounded shadow border p-4">
          <h3 className="font-semibold mb-2">Monthly schedule</h3>
          <div className="overflow-auto max-h-[520px]">
            <table className="w-full text-sm table-auto border-collapse">
              <thead>
                <tr className="bg-gray-50 sticky top-0">
                  <th className="p-2 border">Month</th>
                  <th className="p-2 border">Date</th>
                  <th className="p-2 border">Surplus</th>
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
                {schedule.map(s => (
                  s.loans.map((ln, idx) => (
                    <tr key={`${s.month}-${ln.id}`} className={clsx(
                      idx === 0 ? (s.month === latestMonth ? 'bg-indigo-50 ring-2 ring-indigo-200' : 'bg-white') : 'bg-gray-50'
                    )}>
                      <td className="p-2 border">
                        {s.month}
                        {s.month === latestMonth && <span className="ml-2 text-xs text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">Latest</span>}
                      </td>
                      <td className="p-2 border">{s.date}</td>
                      {idx === 0 ? (
                        <>
                          <td className="p-2 border" rowSpan={s.loans.length}>₹{s.surplusBefore.toLocaleString()}</td>
                          <td className="p-2 border" rowSpan={s.loans.length}>₹{s.totalInterestThisMonth.toFixed(2)}</td>
                          <td className="p-2 border" rowSpan={s.loans.length}>₹{s.totalPaidThisMonth.toFixed(2)}</td>
                        </>
                      ) : null}
                      <td className="p-2 border">{ln.id}</td>
                      <td className="p-2 border">{ln.name}</td>
                      <td className="p-2 border">{(ln.rate * 100).toFixed(2)}%</td>
                      <td className="p-2 border">{currency(ln.balanceAfter)}</td>
                      {idx === 0 ? (
                        <td className="p-2 border text-right font-semibold" rowSpan={s.loans.length}>₹{s.totalOutstanding.toLocaleString()}</td>
                      ) : null}
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer className="mt-6 text-xs text-gray-500">Assumes monthly compounding and no prepayment penalties. This tool is a calculator, not financial advice.</footer>
    </div>
  );
}
