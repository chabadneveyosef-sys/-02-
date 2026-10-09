import React, { useState, useEffect } from 'react';
import {
  Bell,
  Calendar,
  CheckSquare,
  Square,
  ArrowLeft,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Edit3,
} from 'lucide-react';
import {
  AnnualActivityRecord,
  TaskNodeRecord,
  FinancialTransactionRecord,
  DonorContactRecord,
  VolunteerEntityRecord,
  ReminderChannel,
} from '../types/erp';
import {
  fromGregorianDate,
  compareHebrewDates,
  computeAnnualActivityStatus,
  calculateLedgerSummary,
  formatAgorotToIls,
} from '../lib/erp-core';

interface DashboardViewProps {
  userName: string;
  activities: AnnualActivityRecord[];
  tasks: TaskNodeRecord[];
  transactions: FinancialTransactionRecord[];
  donors: DonorContactRecord[];
  communityEntities: VolunteerEntityRecord[];
  canWriteTasks: boolean;
  onToggleTaskCompleted: (task: TaskNodeRecord) => Promise<void>;
  onNavigateTab: (
    tab: 'dashboard' | 'annual_plan' | 'tasks_dag' | 'finances' | 'crm_donors' | 'gis_map' | 'rbac_settings'
  ) => void;
}

const CHANNEL_LABELS: Record<ReminderChannel, string> = {
  email: 'מייל',
  desktop: 'שולחן עבודה',
  dashboard: 'דשבורד',
  mobile: 'פלאפון',
};

function getRealTimeHebrewGreeting(now: Date): {
  timeGreeting: string;
  contextSubtitle: string;
} {
  const dayOfWeek = now.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
  const hour = now.getHours();

  let baseGreeting = 'שלום';
  if (hour >= 5 && hour < 12) {
    baseGreeting = 'בוקר טוב';
  } else if (hour >= 12 && hour < 17) {
    baseGreeting = 'צהריים טובים';
  } else if (hour >= 17 && hour < 21) {
    baseGreeting = 'ערב טוב';
  } else {
    baseGreeting = 'לילה טוב';
  }

  // Contextual Jewish weekly rhythm
  if (dayOfWeek === 6 && hour >= 18) {
    return {
      timeGreeting: `שבוע טוב ו${baseGreeting}`,
      contextSubtitle: 'מוצאי שבת קודש — פתיחת שבוע מבורך של שליחות ופעילות',
    };
  }
  if (dayOfWeek === 0 && hour < 13) {
    return {
      timeGreeting: `שבוע טוב ו${baseGreeting}`,
      contextSubtitle: 'יום ראשון בשבוע — התנעת משימות השבוע הקרוב',
    };
  }
  if (dayOfWeek === 5 && hour >= 11) {
    return {
      timeGreeting: `הכנה לשבת שלום ו${baseGreeting}`,
      contextSubtitle: 'ערב שבת קודש — סיכום פעילות השבוע והיערכות לשבת',
    };
  }
  if (dayOfWeek === 6) {
    return {
      timeGreeting: 'שבת שלום ומבורך',
      contextSubtitle: 'מנוחת שבת קודש והתוועדות קהילתית',
    };
  }

  return {
    timeGreeting: baseGreeting,
    contextSubtitle: 'מרכז הבקרה והתזכורות היומי של בית חב״ד',
  };
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  userName,
  activities,
  tasks,
  transactions,
  donors,
  communityEntities,
  canWriteTasks,
  onToggleTaskCompleted,
  onNavigateTab,
}) => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const greeting = getRealTimeHebrewGreeting(now);
  const todayHebrew = fromGregorianDate(now);
  const timeFormatted = now.toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // 1. משימות ותזכורות קרובות לביצוע
  const activeTasks = tasks.filter((t) => !t.deletedAt);
  const pendingTasksWithDates = activeTasks
    .filter((t) => !t.isCompleted && t.targetDate)
    .sort((a, b) => (a.targetDate || '').localeCompare(b.targetDate || ''));

  const completedTasksCount = activeTasks.filter((t) => t.isCompleted).length;

  // 2. נתונים עיקריים מהמערכת
  const activeActivities = activities
    .filter((a) => !a.deletedAt)
    .sort((a, b) =>
      compareHebrewDates(
        { day: a.hebrewDay, month: a.hebrewMonth, year: a.hebrewYear },
        { day: b.hebrewDay, month: b.hebrewMonth, year: b.hebrewYear }
      )
    );

  const activeDonors = donors.filter((d) => !d.deletedAt);
  const activeEntities = communityEntities.filter((e) => !e.deletedAt);
  const regularFinanceSummary = calculateLedgerSummary(transactions, 'regular');
  const secondAssocSummary = calculateLedgerSummary(transactions, 'second_association');

  return (
    <div className="space-y-8">
      {/* בלוק ברכה מותאם לזמן אמת + תאריך עברי ושקיעה */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 md:p-8 flex flex-wrap items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{todayHebrew.hebrewDisplay}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{todayHebrew.gregorianIso}</span>
            <span aria-hidden="true">·</span>
            <span>שעה נוכחית: <strong className="font-mono tabular-nums text-slate-800">{timeFormatted}</strong></span>
            <span aria-hidden="true">·</span>
            <span>שקיעה היום: <strong className="font-mono tabular-nums text-amber-700">{todayHebrew.sunsetTime}</strong></span>
          </div>

          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight">
            {greeting.timeGreeting} — ברוך הבא, {userName}
          </h1>

          <p className="text-sm text-slate-600">
            {greeting.contextSubtitle}. להלן תזכורות המשימות הקרובות לביצוע, נתוני המערכת העיקריים ותקציר התוכנית השנתית.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => onNavigateTab('tasks_dag')}
            className="px-4 py-2.5 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <span>לתכנון משימות ועץ תתי-משימות</span>
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('annual_plan')}
            className="px-4 py-2.5 bg-white text-slate-800 border border-slate-300 text-xs font-semibold rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            לתוכנית השנתית המלאה
          </button>
        </div>
      </section>

      {/* שורת נתונים עיקריים מהמערכת */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={() => onNavigateTab('annual_plan')}
          className="bg-white border border-slate-200 rounded-xl p-5 cursor-pointer hover:border-slate-400 transition-colors space-y-1"
        >
          <div className="text-xs text-slate-500">פעילויות בתוכנית השנתית</div>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {activeActivities.length}
          </div>
          <div className="text-xs text-slate-600">
            {activeActivities.filter((a) => computeAnnualActivityStatus(a) === 'blue').length} בוצעו ·{' '}
            {activeActivities.filter((a) => computeAnnualActivityStatus(a) === 'green').length} מוכנות
          </div>
        </div>

        <div
          onClick={() => onNavigateTab('tasks_dag')}
          className="bg-white border border-slate-200 rounded-xl p-5 cursor-pointer hover:border-slate-400 transition-colors space-y-1"
        >
          <div className="text-xs text-slate-500">משימות ותתי-משימות בתכנון</div>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {activeTasks.length - completedTasksCount} פתוחות
          </div>
          <div className="text-xs text-slate-600">
            מתוך {activeTasks.length} משימות ({completedTasksCount} הושלמו)
          </div>
        </div>

        <div
          onClick={() => onNavigateTab('finances')}
          className="bg-white border border-slate-200 rounded-xl p-5 cursor-pointer hover:border-slate-400 transition-colors space-y-1"
        >
          <div className="text-xs text-slate-500">יתרה דינמית (כספים רגילים + עמותה שנייה)</div>
          <div className="text-2xl font-bold text-emerald-700 font-mono tabular-nums">
            {formatAgorotToIls(
              regularFinanceSummary.currentBalanceAgorot +
                secondAssocSummary.currentBalanceAgorot
            )}
          </div>
          <div className="text-xs text-slate-600 font-mono tabular-nums">
            רגיל: {formatAgorotToIls(regularFinanceSummary.currentBalanceAgorot)} · עמותה ב׳:{' '}
            {formatAgorotToIls(secondAssocSummary.currentBalanceAgorot)}
          </div>
        </div>

        <div
          onClick={() => onNavigateTab('crm_donors')}
          className="bg-white border border-slate-200 rounded-xl p-5 cursor-pointer hover:border-slate-400 transition-colors space-y-1"
        >
          <div className="text-xs text-slate-500">תורמים, אנשי קשר ומתנדבים</div>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {activeDonors.length} אנשי קשר
          </div>
          <div className="text-xs text-slate-600">
            + {activeEntities.length} מתנדבים, שיעורים קבועים ומוקדים במפה
          </div>
        </div>
      </section>

      {/* תוכן מרכזי בשתי עמודות: 1. תזכורות משימות קרובות לביצוע  2. תקציר התוכנית השנתית וקישור */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* תזכורות על המשימות הקרובות לביצוע (7 עמודות) */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-amber-600 shrink-0" />
              <h2 className="text-lg font-bold text-slate-900">
                תזכורות על המשימות הקרובות לביצוע
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('tasks_dag')}
              className="text-xs font-semibold text-slate-700 hover:text-slate-900 flex items-center gap-1"
            >
              <span>לכל המשימות ועץ התכנון</span>
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          </div>

          {pendingTasksWithDates.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              כל המשימות המתוזמנות הושלמו או שטרם הוגדרו משימות עם תאריך ביצוע.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {pendingTasksWithDates.slice(0, 6).map((task) => {
                let channels: ReminderChannel[] = ['email', 'desktop', 'dashboard', 'mobile'];
                try {
                  if (task.reminderChannelsJson) {
                    const parsed = JSON.parse(task.reminderChannelsJson);
                    if (Array.isArray(parsed) && parsed.length > 0) channels = parsed;
                  }
                } catch {
                  // ignore
                }
                const hebDisplay =
                  task.hebrewDateStr ||
                  (task.targetDate ? fromGregorianDate(task.targetDate).hebrewDisplay : '');

                return (
                  <div
                    key={task.id}
                    className="py-3.5 first:pt-1 last:pb-1 flex flex-wrap items-start justify-between gap-3"
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        disabled={!canWriteTasks}
                        onClick={() => onToggleTaskCompleted(task)}
                        className="mt-0.5 text-slate-400 hover:text-emerald-600 transition-colors"
                        title="סמן משימה כבוצעה"
                      >
                        {task.isCompleted ? (
                          <CheckSquare className="w-5 h-5 text-emerald-600" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                      </button>

                      <div className="space-y-1">
                        <div className="font-bold text-slate-900 text-sm">{task.title}</div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                          <span>
                            תאריך ביצוע: <strong>{hebDisplay}</strong>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{task.targetDate}</span>
                          {task.assignee && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>אחראי: {task.assignee}</span>
                            </>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          תזכורות פעילות ({task.reminderDaysBefore ?? 2} ימים לפני וביום הביצוע):{' '}
                          {channels.map((c) => CHANNEL_LABELS[c]).join(' · ')}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onNavigateTab('tasks_dag')}
                      className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                    >
                      פתח משימה
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* תקציר מהתוכנית השנתית וקישור ישיר (5 עמודות) — מוצג בשני טורים כתקציר */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-slate-800 shrink-0" />
              <h2 className="text-lg font-bold text-slate-900">תקציר מהתוכנית השנתית (שני טורים)</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('annual_plan')}
              className="text-xs font-semibold text-blue-700 hover:text-blue-900 flex items-center gap-1"
            >
              <span>לעמוד התוכנית השנתית</span>
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {activeActivities.slice(0, 8).map((act) => {
              const status = computeAnnualActivityStatus(act);
              return (
                <div
                  key={act.id}
                  onClick={() => onNavigateTab('annual_plan')}
                  className="p-2.5 border border-slate-200 hover:border-slate-400 rounded-xl cursor-pointer bg-slate-50/50 hover:bg-white transition-all flex items-start justify-between gap-2"
                >
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${
                        status === 'blue'
                          ? 'bg-blue-600'
                          : status === 'green'
                          ? 'bg-emerald-600'
                          : 'bg-red-600'
                      }`}
                    />
                    <span className="font-bold text-slate-900 text-xs leading-snug break-words">
                      {act.title}
                    </span>
                  </div>

                  <div className="relative group/btn shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateTab('annual_plan');
                      }}
                      className="p-1.5 bg-white border border-slate-200 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors flex items-center justify-center"
                      aria-label="עריכה ופירוט"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 hidden group-hover/btn:block whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-md z-30">
                      עריכה ופירוט בתוכנית השנתית
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => onNavigateTab('annual_plan')}
              className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              <span>צפה בתוכנית השנתית המלאה ובסרגל הפירוט</span>
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
