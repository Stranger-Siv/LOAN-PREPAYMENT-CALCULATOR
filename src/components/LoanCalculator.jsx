import React, { useState } from 'react';
import { ChartLine, Plus, Trash2, DownloadCloud } from 'lucide-react';
import clsx from 'clsx';

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

  function avalancheSimulator(payload) {
    const working = payload.loans.map(l => ({ ...l }));
    let baseSurplus = payload.salary + payload.extraIncome - payload.expenses - working.reduce((s, l) => s + l.emi, 0);
    if (isNaN(baseSurplus)) baseSurplus = 0;
    if (baseSurplus < 0) baseSurplus = 0;

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

    const initialOutstanding = working.reduce((s, l) => s + l.principal, 0);

    while (working.length > 0 && month <= payload.monthsLimit) {
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
      const paidOff = working.filter(l => l.principal <= 1e-9);
      for (const p of paidOff) baseSurplus += p.emi;
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
    const csv = lines.join('');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'loan_prepayment_schedule.csv'; a.click(); URL.revokeObjectURL(url);
  }

  const latestMonth = schedule && schedule.length ? schedule[schedule.length - 1].month : null;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6">
      <header className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Loan Prepayment</h1>
        <p className="text-gray-500 mt-1 text-sm sm:text-base">Put surplus toward the highest-rate loan; freed EMIs roll into the next loan.</p>
      </header>

      {/* top panels side-by-side on md+, stacked on small */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Monthly Finances */}
        <section className="bg-white p-3 sm:p-4 rounded-lg shadow-sm border">
          <h2 className="font-semibold mb-2 text-sm sm:text-base">Monthly Finances</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
            <div>
              <label className="block text-xs sm:text-sm text-gray-600">Salary (take-home)</label>
              <input value={salary} onChange={e => setSalary(Number(e.target.value))} className="w-full p-2 sm:p-3 border rounded focus:ring-2 focus:ring-indigo-200 text-sm" />
            </div>
            <div>
              <label className="block text-xs sm:text-sm text-gray-600">Extra income</label>
              <input value={extraIncome} onChange={e => setExtraIncome(Number(e.target.value))} className="w-full p-2 sm:p-3 border rounded focus:ring-2 focus:ring-indigo-200 text-sm" />
            </div>
            <div>
              <label className="block text-xs sm:text-sm text-gray-600">Expenses</label>
              <input value={expenses} onChange={e => setExpenses(Number(e.target.value))} className="w-full p-2 sm:p-3 border rounded focus:ring-2 focus:ring-indigo-200 text-sm" />
            </div>
            <div>
              <label className="block text-xs sm:text-sm text-gray-600">Months cap</label>
              <input value={monthsLimit} onChange={e => setMonthsLimit(Number(e.target.value))} className="w-full p-2 sm:p-3 border rounded focus:ring-2 focus:ring-indigo-200 text-sm" />
            </div>
            {error && <div className="col-span-2 mt-2 text-sm text-red-700 bg-red-50 p-2 rounded">{error}</div>}
          </div>
        </section>

        {/* Loans: mobile = stacked cards; md+ = compact grid rows */}
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
                        <input value={l.name} onChange={e => updateLoan(l.id, 'name', e.target.value)} className="w-full p-2 border rounded text-sm" />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-xs text-gray-600">Principal</label>
                        <input type="number" value={l.principal} onChange={e => updateLoan(l.id, 'principal', Number(e.target.value))} className="w-full p-2 border rounded text-sm" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs text-gray-600">EMI</label>
                        <input type="number" value={l.emi} onChange={e => updateLoan(l.id, 'emi', Number(e.target.value))} className="w-full p-2 border rounded text-sm" />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs text-gray-600">Rate %</label>
                        <input type="number" value={(l.annualRate * 100).toFixed(2)} onChange={e => updateLoan(l.id, 'annualRate', Number(e.target.value) / 100)} className="w-full p-2 border rounded text-sm" />
                      </div>
                    </div>
                  </div>

                  <div className="ml-3 flex-shrink-0 mt-1 sm:mt-0">
                    <button onClick={() => removeLoan(l.id)} className="p-2 rounded bg-red-50 hover:bg-red-100 text-red-600 border w-12 h-10">
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

      {/* ACTIONS + SUMMARY: buttons stack on small, cards wrap */}
      <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-start">
        <div className="sm:col-span-1">
          <button onClick={downloadCSV} className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-3 rounded shadow text-sm">
            <DownloadCloud size={16} /> Export CSV
          </button>
        </div>
        <div className="sm:col-span-1">
          <button onClick={runAvalanche} className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-3 rounded shadow text-sm">
            <ChartLine size={16} /> Run Simulation
          </button>
        </div>

        <div className="sm:col-span-2 lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
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
              <div className="p-3 bg-white rounded shadow border text-center">
                <div className="text-xs text-gray-500">Total outstanding</div>
                <div className="text-lg font-bold">{currency(summary.totalOutstanding)}</div>
              </div>
            </>
          ) : (
            <div className="col-span-4 p-3 bg-white rounded shadow border text-center text-gray-600">Run the simulation to see results.</div>
          )}
        </div>
      </div>

      {/* SCHEDULE: table for md+, mobile cards for small */}
      {schedule && (
        <section className="bg-white rounded shadow border p-3 sm:p-4">
          <h3 className="font-semibold mb-2 text-sm sm:text-base">Monthly schedule</h3>

          {/* Desktop / tablet table */}
          <div className="hidden md:block overflow-auto max-h-[520px]">
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
                      <td className="p-2 border">{s.month}{s.month === latestMonth && <span className="ml-2 text-xs text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">Latest</span>}</td>
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

          {/* Mobile monthly cards */}
          <div className="md:hidden space-y-3">
            {schedule.map(s => (
              <div key={s.month} className={clsx('border rounded p-3', s.month === latestMonth ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'bg-white')}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Month {s.month} <span className="text-xs text-gray-500">({s.date})</span></div>
                    <div className="text-xs text-gray-500">Surplus: ₹{s.surplusBefore.toLocaleString()}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">Outstanding</div>
                    <div className="font-semibold">₹{s.totalOutstanding.toLocaleString()}</div>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {s.loans.map(ln => (
                    <div key={ln.id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                      <div>
                        <div className="text-sm font-medium">{ln.id} — {ln.name}</div>
                        <div className="text-xs text-gray-500">Rate: {(ln.rate*100).toFixed(2)}% • Balance: ₹{ln.balanceAfter.toLocaleString()}</div>
                      </div>
                      <div className="text-right text-xs">
                        <div>Paid: ₹{(ln.principalPaid + ln.interest).toLocaleString()}</div>
                        <div className="text-gray-500">EMI ₹{ln.emi.toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="mt-4 text-xs text-gray-500">Assumes monthly compounding and no prepayment penalties. This tool is a calculator, not financial advice.</footer>
    </div>
  );
}
