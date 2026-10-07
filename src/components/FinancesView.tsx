import React, { useState } from 'react';
import {
  Plus,
  AlertTriangle,
  ShieldAlert,
  Trash2,
  CheckCircle2,
  Printer,
} from 'lucide-react';
import { FinancialTransactionRecord, DonorContactRecord } from '../types/erp';
import {
  FundSource,
  TransactionType,
  TransactionStatus,
  calculateTransactionAmounts,
  calculateLedgerSummary,
  checkNegativeBalanceGuard,
  formatAgorotToIls,
  ilsToAgorot,
  fromGregorianDate,
} from '../lib/erp-core';
import { HebrewDatePicker } from './HebrewDatePicker';

interface FinancesViewProps {
  transactions: FinancialTransactionRecord[];
  donors: DonorContactRecord[];
  canReadRegular: boolean;
  canWriteRegular: boolean;
  canReadSecondAssoc: boolean;
  canWriteSecondAssoc: boolean;
  defaultFeePercent: number;
  onSaveTransaction: (
    data: Omit<FinancialTransactionRecord, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>;
  onUpdateTransactionStatus: (tx: FinancialTransactionRecord, newStatus: TransactionStatus) => Promise<void>;
  onSoftDeleteTransaction: (id: string) => Promise<void>;
}

export const FinancesView: React.FC<FinancesViewProps> = ({
  transactions,
  donors,
  canReadRegular,
  canWriteRegular,
  canReadSecondAssoc,
  canWriteSecondAssoc,
  defaultFeePercent,
  onSaveTransaction,
  onUpdateTransactionStatus,
  onSoftDeleteTransaction,
}) => {
  const [filterSource, setFilterSource] = useState<'all' | FundSource>(
    canReadRegular && canReadSecondAssoc
      ? 'all'
      : canReadRegular
      ? 'regular'
      : 'second_association'
  );
  const [showForm, setShowForm] = useState(false);
  const [negativeGuardMode, setNegativeGuardMode] = useState<'warn' | 'block'>('warn');
  const [guardWarningText, setGuardWarningText] = useState<string | null>(null);

  const [type, setType] = useState<TransactionType>('income');
  const [fundSource, setFundSource] = useState<FundSource>(
    canWriteRegular ? 'regular' : 'second_association'
  );
  const [amountIls, setAmountIls] = useState('1000');
  const [feePercent, setFeePercent] = useState(String(defaultFeePercent));
  const [status, setStatus] = useState<TransactionStatus>('executed');
  const [category, setCategory] = useState('תרומה כללית');
  const [description, setDescription] = useState('');
  const [donorId, setDonorId] = useState('');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const visibleTransactions = transactions.filter((t) => {
    if (t.deletedAt) return false;
    if (t.fundSource === 'regular' && !canReadRegular) return false;
    if (t.fundSource === 'second_association' && !canReadSecondAssoc) return false;
    if (filterSource !== 'all' && t.fundSource !== filterSource) return false;
    return true;
  });

  const regularSummary = calculateLedgerSummary(transactions, 'regular');
  const secondAssocSummary = calculateLedgerSummary(transactions, 'second_association');
  const activeSummary = calculateLedgerSummary(visibleTransactions, filterSource);

  const previewCalc = calculateTransactionAmounts(
    ilsToAgorot(Number(amountIls) || 0),
    fundSource,
    type,
    Number(feePercent) || 0
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardWarningText(null);

    if (fundSource === 'regular' && !canWriteRegular) return;
    if (fundSource === 'second_association' && !canWriteSecondAssoc) return;

    const grossAgorot = ilsToAgorot(Number(amountIls) || 0);
    if (grossAgorot <= 0) return;

    const calc = calculateTransactionAmounts(
      grossAgorot,
      fundSource,
      type,
      Number(feePercent) || 0
    );

    // בדיקת מנגנון הגנה מפני יתרה שלילית בעת הזנת הוצאה
    if (type === 'expense' && status === 'executed') {
      const targetBalance =
        fundSource === 'regular'
          ? regularSummary.currentBalanceAgorot
          : secondAssocSummary.currentBalanceAgorot;
      const guard = checkNegativeBalanceGuard(targetBalance, calc.netAmountAgorot);
      if (guard.wouldBeNegative) {
        const fundName = fundSource === 'regular' ? 'כספים רגילים' : 'כספי העמותה השנייה';
        if (negativeGuardMode === 'block') {
          setGuardWarningText(
            `חסימת יתרה שלילית: ההוצאה בסך ${formatAgorotToIls(calc.netAmountAgorot)} תגרום לגירעון של ${formatAgorotToIls(guard.deficitAgorot)} בקופת "${fundName}". הפעולה נחסמה.`
          );
          return;
        } else {
          setGuardWarningText(
            `אזהרת יתרה שלילית: שים לב, הוצאה זו מכניסה את קופת "${fundName}" ליתרה שלילית של ${formatAgorotToIls(guard.deficitAgorot)}.`
          );
        }
      }
    }

    const donorObj = donors.find((d) => d.id === donorId);
    const hebDate = fromGregorianDate(date);

    await onSaveTransaction({
      type,
      fundSource,
      grossAmountAgorot: calc.grossAmountAgorot,
      feePercent: calc.feePercent,
      feeAmountAgorot: calc.feeAmountAgorot,
      netAmountAgorot: calc.netAmountAgorot,
      status,
      category: category.trim() || 'כללי',
      description: description.trim() || category.trim(),
      donorId: donorObj?.id,
      donorName: donorObj?.fullName,
      receiptNumber: receiptNumber.trim() || undefined,
      date,
      hebrewDateDisplay: hebDate.hebrewDisplay,
    });

    setDescription('');
    setReceiptNumber('');
    setShowForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">
            ניהול כספים כפול, תרומות והעמותה השנייה
          </h2>
          <p className="text-sm text-slate-600">
            כל הסכומים נשמרים כמספרים שלמים ב<strong>אגורות</strong>. תרומות לעמותה השנייה מחושבות בניכוי עמלה אוטומטית (ברירת מחדל {defaultFeePercent}%).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* סינון דשבורד כספים */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {canReadRegular && canReadSecondAssoc && (
              <button
                type="button"
                onClick={() => setFilterSource('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filterSource === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                שתי הקופות יחד (בהפרדה ברורה)
              </button>
            )}
            {canReadRegular && (
              <button
                type="button"
                onClick={() => setFilterSource('regular')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filterSource === 'regular' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                כספים רגילים בלבד
              </button>
            )}
            {canReadSecondAssoc && (
              <button
                type="button"
                onClick={() => setFilterSource('second_association')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filterSource === 'second_association' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                העמותה השנייה בלבד
              </button>
            )}
          </div>

          <select
            value={negativeGuardMode}
            onChange={(e) => setNegativeGuardMode(e.target.value as 'warn' | 'block')}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700"
            title="מנגנון הגנה מפני יתרה שלילית"
          >
            <option value="warn">הגנת יתרה שלילית: התראה</option>
            <option value="block">הגנת יתרה שלילית: חסימה מלאה</option>
          </select>

          {(canWriteRegular || canWriteSecondAssoc) && (
            <button
              type="button"
              onClick={() => setShowForm(!showForm)}
              className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              תנועה כספית / תרומה חדשה
            </button>
          )}
        </div>
      </div>

      {guardWarningText && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-center justify-between text-amber-900 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0" />
            <span>{guardWarningText}</span>
          </div>
          <button
            type="button"
            onClick={() => setGuardWarningText(null)}
            className="text-xs underline"
          >
            סגור
          </button>
        </div>
      )}

      {/* Dual Fund Separation Banner when viewing both */}
      {filterSource === 'all' && canReadRegular && canReadSecondAssoc && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
              <span className="text-sm font-bold text-slate-900">קופה א׳: כספים רגילים (בית חב״ד)</span>
              <span className="text-xs text-slate-500">ללא ניכוי עמלה</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-slate-500">הכנסות בפועל</div>
                <div className="font-mono tabular-nums font-bold text-emerald-700 text-sm">
                  {formatAgorotToIls(regularSummary.executedIncomeAgorot)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">הוצאות בפועל</div>
                <div className="font-mono tabular-nums font-bold text-red-600 text-sm">
                  {formatAgorotToIls(regularSummary.executedExpenseAgorot)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">יתרה נוכחית</div>
                <div className="font-mono tabular-nums font-bold text-slate-900 text-sm">
                  {formatAgorotToIls(regularSummary.currentBalanceAgorot)}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
              <span className="text-sm font-bold text-slate-900">קופה ב׳: כספי העמותה השנייה</span>
              <span className="text-xs text-amber-800 font-medium">
                סה״כ עמלות שנוכו: {formatAgorotToIls(secondAssocSummary.totalFeesDeductedAgorot)}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-slate-500">הכנסות נטו (אחרי עמלה)</div>
                <div className="font-mono tabular-nums font-bold text-emerald-700 text-sm">
                  {formatAgorotToIls(secondAssocSummary.executedIncomeAgorot)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">הוצאות בפועל</div>
                <div className="font-mono tabular-nums font-bold text-red-600 text-sm">
                  {formatAgorotToIls(secondAssocSummary.executedExpenseAgorot)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">יתרה נטו בעמותה</div>
                <div className="font-mono tabular-nums font-bold text-slate-900 text-sm">
                  {formatAgorotToIls(secondAssocSummary.currentBalanceAgorot)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4 Core Financial Metrics (Executed, To-Do/Pending, Future Estimate, Dynamic Balance) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">יתרה נוכחית בפועל (הכנסות פחות הוצאות)</div>
          <div
            className={`text-2xl font-bold font-mono tabular-nums mt-1 ${
              activeSummary.currentBalanceAgorot < 0 ? 'text-red-600' : 'text-slate-900'
            }`}
          >
            {formatAgorotToIls(activeSummary.currentBalanceAgorot)}
          </div>
          <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
            ({activeSummary.currentBalanceAgorot.toLocaleString('he-IL')} אגורות)
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">מה שצריך לעשות (התחייבויות לגבייה / לתשלום)</div>
          <div className="text-lg font-bold font-mono tabular-nums text-emerald-700 mt-1">
            לגבייה: +{formatAgorotToIls(activeSummary.pendingIncomeAgorot)}
          </div>
          <div className="text-xs font-mono tabular-nums text-red-600 mt-0.5">
            לתשלום: -{formatAgorotToIls(activeSummary.pendingExpenseAgorot)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">עתידיות (אומדן צפי הכנסות והוצאות)</div>
          <div className="text-lg font-bold font-mono tabular-nums text-slate-800 mt-1">
            צפי הכנסות: +{formatAgorotToIls(activeSummary.estimatedFutureIncomeAgorot)}
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-500 mt-0.5">
            צפי הוצאות: -{formatAgorotToIls(activeSummary.estimatedFutureExpenseAgorot)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">יתרה דינמית משוקללת (כולל התחייבויות ואומדן)</div>
          <div
            className={`text-2xl font-bold font-mono tabular-nums mt-1 ${
              activeSummary.projectedDynamicBalanceAgorot < 0 ? 'text-red-600' : 'text-blue-700'
            }`}
          >
            {formatAgorotToIls(activeSummary.projectedDynamicBalanceAgorot)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            עמלות עמותה שנייה שנוכו: {formatAgorotToIls(activeSummary.totalFeesDeductedAgorot)}
          </div>
        </div>
      </div>

      {showForm && (canWriteRegular || canWriteSecondAssoc) && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2">
            רישום הכנסה, תרומה, התחייבות או הוצאה (נשמר באגורות שלמות)
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">סוג תנועה</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as TransactionType)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="income">הכנסה / תרומה</option>
                <option value="pledge">התחייבות תורם (לגבייה)</option>
                <option value="expense">הוצאה</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">מקור כספים (קופה) *</label>
              <select
                value={fundSource}
                onChange={(e) => setFundSource(e.target.value as FundSource)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {canWriteRegular && <option value="regular">כספים רגילים</option>}
                {canWriteSecondAssoc && (
                  <option value="second_association">כספי העמותה השנייה (ניכוי עמלה)</option>
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">סכום ברוטו (בש״ח) *</label>
              <input
                type="number"
                step="0.01"
                min="1"
                required
                value={amountIls}
                onChange={(e) => setAmountIls(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                אחוז עמלה (לעמותה שנייה)
              </label>
              <input
                type="number"
                step="0.5"
                min="0"
                max="50"
                disabled={fundSource !== 'second_association' || type === 'expense'}
                value={fundSource === 'second_association' && type !== 'expense' ? feePercent : '0'}
                onChange={(e) => setFeePercent(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono tabular-nums disabled:bg-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">סטטוס ביצוע</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TransactionStatus)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="executed">בוצע בפועל</option>
                <option value="pending">ממתין לביצוע / גבייה (מה שצריך לעשות)</option>
                <option value="estimated">עתידי (אומדן תקציבי)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">שיוך לתורם (מעדכן היסטוריית CRM)</label>
              <select
                value={donorId}
                onChange={(e) => setDonorId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="">ללא שיוך לתורם ספציפי</option>
                {donors
                  .filter((d) => !d.deletedAt)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fullName} ({d.identifierMark})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">קטגוריה / סעיף</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="למשל: הוראת קבע, חגי תשרי..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">מספר קבלה / אסמכתא</label>
              <input
                type="text"
                value={receiptNumber}
                onChange={(e) => setReceiptNumber(e.target.value)}
                placeholder="למשל: REC-5012"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-semibold text-slate-700 mb-1">תיאור ופירוט</label>
              <input
                type="text"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="פירוט התרומה או ההוצאה..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <HebrewDatePicker
                label="תאריך (לוח עברי)"
                value={fromGregorianDate(date).triplet}
                onChange={(_tr, conv) => setDate(conv.gregorianIso)}
              />
            </div>
          </div>

          {/* Live Fee Calculation Preview */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between text-xs">
            <div>
              <strong>חישוב אגורות אוטומטי:</strong> סכום ברוטו:{' '}
              <span className="font-mono tabular-nums">{formatAgorotToIls(previewCalc.grossAmountAgorot)}</span> ({previewCalc.grossAmountAgorot} אג׳)
            </div>
            <div>
              ניכוי עמלה ({previewCalc.feePercent}%):{' '}
              <span className="font-mono tabular-nums text-amber-800">{formatAgorotToIls(previewCalc.feeAmountAgorot)}</span>
            </div>
            <div className="font-bold text-slate-900">
              נטו לרישום בקופה:{' '}
              <span className="font-mono tabular-nums">{formatAgorotToIls(previewCalc.netAmountAgorot)}</span> ({previewCalc.netAmountAgorot} אג׳)
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-xs font-medium text-slate-600"
            >
              ביטול
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800"
            >
              שמור תנועה כספית
            </button>
          </div>
        </form>
      )}

      {/* Transactions Ledger Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">תאריך</th>
                <th className="py-3 px-4">קופה ומקור</th>
                <th className="py-3 px-4">סוג וסטטוס</th>
                <th className="py-3 px-4">תיאור, תורם וקבלה</th>
                <th className="py-3 px-4">ברוטו</th>
                <th className="py-3 px-4">עמלה</th>
                <th className="py-3 px-4">נטו בקופה (אגורות)</th>
                <th className="py-3 px-4 text-left">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {visibleTransactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-4 whitespace-nowrap text-xs">
                    <div className="font-semibold text-slate-900">{tx.hebrewDateDisplay || tx.date}</div>
                    <div className="font-mono tabular-nums text-slate-500">{tx.date}</div>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap text-xs">
                    {tx.fundSource === 'regular' ? (
                      <span className="font-semibold text-slate-800">כספים רגילים</span>
                    ) : (
                      <span className="font-semibold text-amber-800">כספי העמותה השנייה</span>
                    )}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap text-xs">
                    <div className="font-semibold">
                      {tx.type === 'income' && <span className="text-emerald-700">הכנסה / תרומה</span>}
                      {tx.type === 'pledge' && <span className="text-blue-700">התחייבות תורם</span>}
                      {tx.type === 'expense' && <span className="text-red-600">הוצאה</span>}
                    </div>
                    <div className="text-slate-500">
                      {tx.status === 'executed' && 'בוצע בפועל'}
                      {tx.status === 'pending' && 'לביצוע / לגבייה'}
                      {tx.status === 'estimated' && 'אומדן עתידי'}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">{tx.description}</div>
                    <div className="text-xs text-slate-500">
                      {tx.category}
                      {tx.donorName ? ` · תורם: ${tx.donorName}` : ''}
                      {tx.receiptNumber ? ` · קבלה: ${tx.receiptNumber}` : ''}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                    {formatAgorotToIls(tx.grossAmountAgorot)}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-xs text-amber-800 whitespace-nowrap">
                    {tx.feeAmountAgorot > 0
                      ? `${formatAgorotToIls(tx.feeAmountAgorot)} (${tx.feePercent}%)`
                      : '—'}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums font-bold whitespace-nowrap">
                    <span className={tx.type === 'expense' ? 'text-red-600' : 'text-emerald-700'}>
                      {tx.type === 'expense' ? '-' : '+'}
                      {formatAgorotToIls(tx.netAmountAgorot)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-left whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      {tx.status !== 'executed' && (canWriteRegular || canWriteSecondAssoc) && (
                        <button
                          type="button"
                          onClick={() => onUpdateTransactionStatus(tx, 'executed')}
                          className="px-2 py-1 text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 rounded hover:bg-emerald-100 flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          אשר ביצוע
                        </button>
                      )}
                      {tx.receiptNumber && (
                        <button
                          type="button"
                          onClick={() => window.print()}
                          className="p-1.5 text-slate-600 hover:bg-slate-100 rounded"
                          title="הדפסת אישור קבלה"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                      )}
                      {(canWriteRegular || canWriteSecondAssoc) && (
                        <button
                          type="button"
                          onClick={() => onSoftDeleteTransaction(tx.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                          title="מחיקה רכה"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
