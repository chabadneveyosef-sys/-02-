import React, { useState } from 'react';
import {
  Plus,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Trash2,
  Edit3,
  Bell,
  ChevronDown,
  ChevronUp,
  Calendar,
  MapPin,
  User,
  Wallet,
  FileText,
  CheckSquare,
  Square,
} from 'lucide-react';
import {
  AnnualActivityRecord,
  DynamicTemplateRecord,
  DynamicTemplateField,
  TaskNodeRecord,
  ReminderChannel,
} from '../types/erp';
import {
  compareHebrewDates,
  computeAnnualActivityStatus,
  fromHebrewTriplet,
  fromGregorianDate,
  formatAgorotToIls,
  ilsToAgorot,
  HebrewDateTriplet,
  getHebrewMonthName,
} from '../lib/erp-core';
import { HebrewDatePicker } from './HebrewDatePicker';

interface AnnualPlanViewProps {
  activities: AnnualActivityRecord[];
  templates: DynamicTemplateRecord[];
  tasks: TaskNodeRecord[];
  canWrite: boolean;
  defaultLocationName: string;
  defaultLat: number;
  defaultLng: number;
  onSaveActivity: (
    data: Omit<AnnualActivityRecord, 'id' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) => Promise<string>;
  onSoftDeleteActivity: (id: string) => Promise<void>;
  onToggleExecuted: (activity: AnnualActivityRecord) => Promise<void>;
  onSaveTask: (
    data: Omit<TaskNodeRecord, 'id' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) => Promise<void>;
  onToggleTaskCompleted: (task: TaskNodeRecord) => Promise<void>;
  onSoftDeleteTask: (id: string) => Promise<void>;
}

interface FormSubtaskDraft {
  id: string;
  parentLocalId: string | null;
  title: string;
  targetDate: string;
  durationDays: number;
  reminderDaysBefore: number;
  channels: ReminderChannel[];
}

const CHANNEL_LABELS: Record<ReminderChannel, string> = {
  email: 'אימייל',
  desktop: 'שולחן עבודה',
  dashboard: 'דשבורד',
  mobile: 'פלאפון',
};

export const AnnualPlanView: React.FC<AnnualPlanViewProps> = ({
  activities,
  templates,
  tasks,
  canWrite,
  defaultLocationName,
  defaultLat,
  defaultLng,
  onSaveActivity,
  onSoftDeleteActivity,
  onToggleExecuted,
  onSaveTask,
  onToggleTaskCompleted,
  onSoftDeleteTask,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<'all' | 'red' | 'green' | 'blue'>('all');
  const [monthFilter, setMonthFilter] = useState<number | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'hebrew_date' | 'budget_desc' | 'title'>('hebrew_date');
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [expandedActivityIds, setExpandedActivityIds] = useState<string[]>([]);
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
  const [inlineNotesDraft, setInlineNotesDraft] = useState('');
  const [inlineResponsibleDraft, setInlineResponsibleDraft] = useState('');
  const [inlineLocationDraft, setInlineLocationDraft] = useState('');

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('התוועדות');
  const [triplet, setTriplet] = useState<HebrewDateTriplet>({ day: 19, month: 9, year: 5787 });
  const [locationName, setLocationName] = useState(defaultLocationName);
  const [responsiblePerson, setResponsiblePerson] = useState('');
  const [budgetIls, setBudgetIls] = useState('5000');
  const [isExecuted, setIsExecuted] = useState(false);
  const [templateId, setTemplateId] = useState(templates[0]?.id || '');
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [notes, setNotes] = useState('');

  // Subtasks tree state ONLY inside the planning form (does not appear in the Annual Plan table)
  const [formSubtasks, setFormSubtasks] = useState<FormSubtaskDraft[]>([]);
  const [formSubtaskDraftTitle, setFormSubtaskDraftTitle] = useState('');
  const [formSubtaskDraftDate, setFormSubtaskDraftDate] = useState('');
  const [formSubtaskDraftParent, setFormSubtaskDraftParent] = useState<string | null>(null);

  const activeActivities = activities
    .filter((a) => !a.deletedAt)
    .sort((a, b) =>
      compareHebrewDates(
        { day: a.hebrewDay, month: a.hebrewMonth, year: a.hebrewYear },
        { day: b.hebrewDay, month: b.hebrewMonth, year: b.hebrewYear }
      )
    );

  const filteredActivities = activeActivities
    .filter((a) => {
      if (statusFilter !== 'all' && computeAnnualActivityStatus(a) !== statusFilter) {
        return false;
      }
      if (monthFilter !== 'all' && a.hebrewMonth !== monthFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          a.title.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q) ||
          (a.notes || '').toLowerCase().includes(q) ||
          (a.responsiblePerson || '').toLowerCase().includes(q) ||
          (a.locationName || '').toLowerCase().includes(q) ||
          a.hebrewDateDisplay.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'budget_desc') {
        return (b.estimatedBudgetAgorot || 0) - (a.estimatedBudgetAgorot || 0);
      }
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title, 'he');
      }
      return compareHebrewDates(
        { day: a.hebrewDay, month: a.hebrewMonth, year: a.hebrewYear },
        { day: b.hebrewDay, month: b.hebrewMonth, year: b.hebrewYear }
      );
    });

  const selectedActivity =
    activeActivities.find((a) => a.id === selectedActivityId) ||
    filteredActivities[0] ||
    null;

  const toggleExpandedActivity = (id: string) => {
    setExpandedActivityIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSaveInlineQuickEdit = async (act: AnnualActivityRecord) => {
    if (!canWrite) return;
    await onSaveActivity(
      {
        title: act.title,
        category: act.category,
        hebrewDay: act.hebrewDay,
        hebrewMonth: act.hebrewMonth,
        hebrewYear: act.hebrewYear,
        hebrewDateDisplay: act.hebrewDateDisplay,
        gregorianDate: act.gregorianDate,
        sunsetTime: act.sunsetTime,
        locationName: inlineLocationDraft.trim(),
        responsiblePerson: inlineResponsibleDraft.trim(),
        estimatedBudgetAgorot: act.estimatedBudgetAgorot,
        isExecuted: act.isExecuted,
        templateId: act.templateId,
        customFieldsJson: act.customFieldsJson,
        notes: inlineNotesDraft.trim(),
      },
      act.id
    );
    setInlineEditingId(null);
  };

  const selectedTemplate = templates.find((t) => t.id === templateId && !t.deletedAt);
  let templateFields: DynamicTemplateField[] = [];
  if (selectedTemplate?.schemaJson) {
    try {
      templateFields = JSON.parse(selectedTemplate.schemaJson);
    } catch {
      templateFields = [];
    }
  }

  const applyTemplateDefaultSubtasks = (tplId: string, baseDateIso: string) => {
    const tpl = templates.find((t) => t.id === tplId && !t.deletedAt);
    if (!tpl?.defaultTasksJson) return;
    try {
      const defaults: Array<{ title: string; durationDays: number }> = JSON.parse(tpl.defaultTasksJson);
      setFormSubtasks(
        defaults.map((d, i) => ({
          id: `local_${Date.now()}_${i}`,
          parentLocalId: null,
          title: d.title,
          targetDate: baseDateIso,
          durationDays: d.durationDays || 2,
          reminderDaysBefore: 2,
          channels: ['email', 'desktop', 'dashboard', 'mobile'],
        }))
      );
    } catch {
      // ignore
    }
  };

  const openNewForm = () => {
    setEditingId(undefined);
    setTitle('');
    setCategory('התוועדות');
    const defaultTriplet = { day: 19, month: 9, year: 5787 };
    setTriplet(defaultTriplet);
    const defaultConv = fromHebrewTriplet(defaultTriplet, defaultLat, defaultLng);
    setLocationName(defaultLocationName);
    setResponsiblePerson('');
    setBudgetIls('');
    setIsExecuted(false);
    const defaultTplId = templates[0]?.id || '';
    setTemplateId(defaultTplId);
    setCustomValues({});
    setNotes('');
    setFormSubtaskDraftTitle('');
    setFormSubtaskDraftDate(defaultConv.gregorianIso);
    setFormSubtaskDraftParent(null);
    if (defaultTplId) {
      applyTemplateDefaultSubtasks(defaultTplId, defaultConv.gregorianIso);
    } else {
      setFormSubtasks([]);
    }
    setShowForm(true);
  };

  const openEditForm = (act: AnnualActivityRecord) => {
    setEditingId(act.id);
    setTitle(act.title);
    setCategory(act.category);
    setTriplet({ day: act.hebrewDay, month: act.hebrewMonth, year: act.hebrewYear });
    setLocationName(act.locationName || '');
    setResponsiblePerson(act.responsiblePerson || '');
    setBudgetIls(act.estimatedBudgetAgorot ? String(act.estimatedBudgetAgorot / 100) : '');
    setIsExecuted(act.isExecuted);
    setTemplateId(act.templateId || '');
    try {
      setCustomValues(act.customFieldsJson ? JSON.parse(act.customFieldsJson) : {});
    } catch {
      setCustomValues({});
    }
    setNotes(act.notes || '');
    setFormSubtasks([]);
    setFormSubtaskDraftTitle('');
    setFormSubtaskDraftDate(act.gregorianDate);
    setFormSubtaskDraftParent(null);
    setShowForm(true);
  };

  const handleAddFormSubtask = (parentLocalId: string | null = null) => {
    if (!formSubtaskDraftTitle.trim()) return;
    const conv = fromHebrewTriplet(triplet, defaultLat, defaultLng);
    setFormSubtasks((prev) => [
      ...prev,
      {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        parentLocalId,
        title: formSubtaskDraftTitle.trim(),
        targetDate: formSubtaskDraftDate || conv.gregorianIso,
        durationDays: 2,
        reminderDaysBefore: 2,
        channels: ['email', 'desktop', 'dashboard', 'mobile'],
      },
    ]);
    setFormSubtaskDraftTitle('');
    setFormSubtaskDraftParent(null);
  };

  const updateFormSubtaskField = (
    id: string,
    patch: Partial<FormSubtaskDraft>
  ) => {
    setFormSubtasks((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  const toggleFormSubtaskChannel = (id: string, channel: ReminderChannel) => {
    setFormSubtasks((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const exists = item.channels.includes(channel);
        const next = exists
          ? item.channels.filter((c) => c !== channel)
          : [...item.channels, channel];
        return { ...item, channels: next };
      })
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !canWrite) return;

    const conv = fromHebrewTriplet(triplet, defaultLat, defaultLng);
    const savedActivityId = await onSaveActivity(
      {
        title: title.trim(),
        category: category.trim() || 'אירוע קהילתי',
        hebrewDay: conv.triplet.day,
        hebrewMonth: conv.triplet.month,
        hebrewYear: conv.triplet.year,
        hebrewDateDisplay: conv.hebrewDisplay,
        gregorianDate: conv.gregorianIso,
        sunsetTime: conv.sunsetTime,
        locationName: locationName.trim(),
        responsiblePerson: responsiblePerson.trim(),
        estimatedBudgetAgorot: ilsToAgorot(Number(budgetIls) || 0),
        isExecuted,
        templateId,
        customFieldsJson: JSON.stringify(customValues),
        notes: notes.trim(),
      },
      editingId
    );

    if (formSubtasks.length > 0 && savedActivityId) {
      for (const st of formSubtasks) {
        const execDate = st.targetDate || conv.gregorianIso;
        const hebDisplay = execDate ? fromGregorianDate(execDate).hebrewDisplay : conv.hebrewDisplay;
        // Calculate pre-reminder date based on reminderDaysBefore
        const execMs = new Date(`${execDate}T12:00:00`).getTime();
        const remMs = isNaN(execMs)
          ? Date.now()
          : execMs - (st.reminderDaysBefore || 0) * 86400000;
        const reminderDateIso = new Date(remMs).toISOString().slice(0, 10);

        await onSaveTask({
          title: st.title,
          parentId: savedActivityId,
          targetDate: execDate,
          hebrewDateStr: hebDisplay,
          isProject: !execDate,
          durationDays: st.durationDays,
          isCompleted: false,
          assignee: responsiblePerson.trim() || undefined,
          dependsOnIdsJson: JSON.stringify([]),
          reminderDate: reminderDateIso,
          reminderDaysBefore: st.reminderDaysBefore,
          reminderChannelsJson: JSON.stringify(st.channels),
        });
      }
    }

    setShowForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">תוכנית שנתית ולוח שנה עברי</h2>
          <p className="text-sm text-slate-600">
            התוכנית השנתית מוצגת כתקציר בשני טורים (כותרת וכפתורי עריכה בלבד), ולצידה סרגל צד קבוע להצגת הפירוט המלא של המשימה או הפעילות שנבחרה.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                statusFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              הכל ({activeActivities.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('red')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                statusFilter === 'red' ? 'bg-white text-red-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              אדום: חסרים פרטים
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('green')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                statusFilter === 'green' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ירוק: תקין ומלא
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('blue')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                statusFilter === 'blue' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              כחול: בוצע
            </button>
          </div>

          {canWrite && (
            <button
              type="button"
              onClick={openNewForm}
              className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              פעילות שנתית חדשה
            </button>
          )}
        </div>
      </div>

      {showForm && canWrite && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900">
              {editingId ? 'עריכת פעילות בתוכנית השנתית' : 'הוספת פעילות חדשה לתוכנית השנתית'}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              ביטול ✕
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">שם הפעילות / האירוע *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="למשל: התוועדות י״ט כסלו מרכזית"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">סיווג / קטגוריה</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="התוועדות">התוועדות</option>
                <option value="חגי תשרי">חגי תשרי</option>
                <option value="אירוע קהילתי">אירוע קהילתי</option>
                <option value="מבצעים וחלוקה">מבצעים וחלוקה</option>
                <option value="שיעור מיוחד">שיעור מיוחד</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <HebrewDatePicker
                value={triplet}
                onChange={(newTriplet, conv) => {
                  setTriplet(newTriplet);
                  setFormSubtaskDraftDate(conv.gregorianIso);
                }}
                lat={defaultLat}
                lng={defaultLng}
                label="תאריך עברי (יום, חודש, שנה באותיות עבריות) *"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                תבנית דינמית (JSON Schema)
              </label>
              <select
                value={templateId}
                onChange={(e) => {
                  const newTplId = e.target.value;
                  setTemplateId(newTplId);
                  if (!editingId) {
                    const conv = fromHebrewTriplet(triplet, defaultLat, defaultLng);
                    if (newTplId) {
                      applyTemplateDefaultSubtasks(newTplId, conv.gregorianIso);
                    } else {
                      setFormSubtasks([]);
                    }
                  }
                }}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="">ללא תבנית מיוחדת</option>
                {templates
                  .filter((t) => !t.deletedAt)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                אחראי פעילות (חובה לסטטוס ירוק)
              </label>
              <input
                type="text"
                value={responsiblePerson}
                onChange={(e) => setResponsiblePerson(e.target.value)}
                placeholder="שם השליח / הרכז האחראי"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                מיקום הפעילות (חובה לסטטוס ירוק)
              </label>
              <input
                type="text"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="אולם בית חב״ד / פארק השכונה"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                תקציב משוער בש״ח (חובה לסטטוס ירוק)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={budgetIls}
                onChange={(e) => setBudgetIls(e.target.value)}
                placeholder="למשל: 12000"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono tabular-nums"
              />
            </div>
          </div>

          {templateFields.length > 0 && (
            <div className="pt-3 border-t border-slate-100">
              <div className="text-xs font-bold text-slate-800 mb-2">
                שדות דינמיים מתוך &quot;{selectedTemplate?.name}&quot;:
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {templateFields.map((field) => (
                  <div key={field.key}>
                    <label className="block text-xs text-slate-600 mb-1">{field.label}</label>
                    {field.type === 'select' ? (
                      <select
                        value={String(customValues[field.key] || '')}
                        onChange={(e) =>
                          setCustomValues({ ...customValues, [field.key]: e.target.value })
                        }
                        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="">בחר...</option>
                        {field.options?.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : field.type === 'boolean' ? (
                      <label className="flex items-center gap-2 text-sm text-slate-800 mt-1.5">
                        <input
                          type="checkbox"
                          checked={Boolean(customValues[field.key])}
                          onChange={(e) =>
                            setCustomValues({ ...customValues, [field.key]: e.target.checked })
                          }
                        />
                        <span>כן / פעיל</span>
                      </label>
                    ) : (
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={String(customValues[field.key] ?? '')}
                        onChange={(e) =>
                          setCustomValues({
                            ...customValues,
                            [field.key]:
                              field.type === 'number' ? Number(e.target.value) : e.target.value,
                          })
                        }
                        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* הגדרת תתי-משימות בעת תכנון הפעילות (יועברו לעמוד התכנון והמשימות, ולא יוצגו בטבלת התוכנית השנתית) */}
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-slate-800" />
                <span className="text-xs font-bold text-slate-900">
                  גזירת משימות ותתי-משימות עם תאריך ביצוע ספציפי ותזכורות (לחיצה על + להוספה)
                </span>
              </div>
              <span className="text-[11px] text-slate-500">
                משימות אלו יופיעו בעמוד &quot;תכנון משימות ו-DAG&quot; (אינן מופיעות בטבלת התוכנית השנתית)
              </span>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
              {formSubtasks.map((st) => (
                <div key={st.id} className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900">• {st.title}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                        <span>תאריך ביצוע למשימה (לוח עברי):</span>
                        <HebrewDatePicker
                          compact
                          value={
                            st.targetDate
                              ? fromGregorianDate(st.targetDate).triplet
                              : triplet
                          }
                          onChange={(_tr, conv) =>
                            updateFormSubtaskField(st.id, { targetDate: conv.gregorianIso })
                          }
                          lat={defaultLat}
                          lng={defaultLng}
                        />
                      </div>
                      <label className="text-[11px] text-slate-600 flex items-center gap-1">
                        <span>תזכורת לפני:</span>
                        <select
                          value={st.reminderDaysBefore}
                          onChange={(e) =>
                            updateFormSubtaskField(st.id, {
                              reminderDaysBefore: Number(e.target.value),
                            })
                          }
                          className="px-1.5 py-0.5 text-xs border border-slate-300 rounded bg-white"
                        >
                          <option value={0}>ביום הביצוע</option>
                          <option value={1}>יום לפני + ביום הביצוע</option>
                          <option value={2}>יומיים לפני + ביום הביצוע</option>
                          <option value={3}>3 ימים לפני + ביום הביצוע</option>
                          <option value={7}>שבוע לפני + ביום הביצוע</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setFormSubtasks((prev) => prev.filter((x) => x.id !== st.id))
                        }
                        className="p-1 text-red-500 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                    <span className="font-semibold">ערוצי תזכורת (בתאריך ולפניו):</span>
                    {(['email', 'desktop', 'dashboard', 'mobile'] as ReminderChannel[]).map(
                      (ch) => (
                        <label key={ch} className="inline-flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={st.channels.includes(ch)}
                            onChange={() => toggleFormSubtaskChannel(st.id, ch)}
                          />
                          <span>{CHANNEL_LABELS[ch]}</span>
                        </label>
                      )
                    )}
                  </div>
                </div>
              ))}

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/80">
                <input
                  type="text"
                  value={formSubtaskDraftTitle}
                  onChange={(e) => setFormSubtaskDraftTitle(e.target.value)}
                  placeholder="שם משימה / תת-משימה חדשה..."
                  className="flex-1 min-w-[180px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                />
                <div className="flex items-center gap-1.5 text-xs text-slate-700">
                  <span>תאריך ביצוע (עברי):</span>
                  <HebrewDatePicker
                    compact
                    value={
                      formSubtaskDraftDate
                        ? fromGregorianDate(formSubtaskDraftDate).triplet
                        : triplet
                    }
                    onChange={(_tr, conv) => setFormSubtaskDraftDate(conv.gregorianIso)}
                    lat={defaultLat}
                    lng={defaultLng}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleAddFormSubtask(formSubtaskDraftParent)}
                  className="px-3 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ הוסף משימה לתכנון</span>
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">הערות ודגשים</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="הערות לביצוע..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isExecuted}
                  onChange={(e) => setIsExecuted(e.target.checked)}
                  className="w-4 h-4"
                />
                <span>סמן פעילות כ&quot;בוצע&quot; (סטטוס כחול)</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              ביטול
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800"
            >
              שמור פעילות בתוכנית השנתית
            </button>
          </div>
        </form>
      )}

      {/* סרגל חיפוש ומיון מהיר */}
      <div className="bg-white border border-slate-300/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex-1 min-w-[240px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="חיפוש מהיר בתוכנית השנתית (שם פעילות, הערות, אחראי, מיקום, חודש עברי)..."
            className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <label className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-700">מיון התוכנית:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'hebrew_date' | 'budget_desc' | 'title')}
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-medium text-slate-800"
            >
              <option value="hebrew_date">לפי סדר החודשים העבריים (תשרי ← אלול)</option>
              <option value="budget_desc">לפי גובה תקציב (מהגבוה לנמוך)</option>
              <option value="title">לפי שם הפעילות (א-ת)</option>
            </select>
          </label>
          <span className="text-slate-500 hidden sm:inline">
            התוכנית מוצגת כתקציר בשני טורים · לחץ על פעילות להצגת פירוט מלא בסרגל שבצד או לפתיחתה
          </span>
        </div>
      </div>

      {/* פריסת התוכנית השנתית: סרגל בצד (פירוט + ניווט) + תצוגת תקציר בשני טורים */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-start">
        {/* סרגל צד: ניווט ופירוט מלא של הפעילות/משימה שנבחרה (4 עמודות) */}
        <aside className="sm:col-span-4 bg-white border border-slate-300/90 rounded-xl p-4 space-y-4 sm:sticky sm:top-20 shadow-xs">
          {/* כותרת סרגל צד וסינון חודשים */}
          <div className="border-b border-slate-200 pb-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-800" />
                <span>סרגל תוכנית שנתית ופירוט משימה</span>
              </h3>
              <span className="text-[11px] font-mono text-slate-500">
                {filteredActivities.length} פעילויות
              </span>
            </div>

            {/* סינון מהיר לפי חודש עברי */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600 shrink-0">חודש עברי:</span>
              <select
                value={monthFilter}
                onChange={(e) =>
                  setMonthFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
                }
                className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 font-medium text-slate-800"
              >
                <option value="all">כל חודשי השנה (תשרי – אלול)</option>
                {[7, 8, 9, 10, 11, 12, 13, 1, 2, 3, 4, 5, 6].map((m) => (
                  <option key={m} value={m}>
                    {getHebrewMonthName(m, true)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* פירוט הפעילות/המשימה שנבחרה בסרגל הצד */}
          {selectedActivity ? (
            (() => {
              const selStatus = computeAnnualActivityStatus(selectedActivity);
              const linkedTasks = tasks.filter(
                (t) => !t.deletedAt && t.parentId === selectedActivity.id
              );
              const tpl = templates.find((t) => t.id === selectedActivity.templateId);
              let parsedCustom: Record<string, unknown> = {};
              try {
                parsedCustom = selectedActivity.customFieldsJson
                  ? JSON.parse(selectedActivity.customFieldsJson)
                  : {};
              } catch {
                parsedCustom = {};
              }

              return (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/90 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[11px] font-bold text-blue-800">
                          פירוט משימה / פעילות נבחרת:
                        </span>
                        <h4 className="text-base font-bold text-slate-900 leading-snug mt-0.5">
                          {selectedActivity.title}
                        </h4>
                      </div>
                      {canWrite && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => openEditForm(selectedActivity)}
                            className="p-1.5 text-slate-700 hover:text-slate-900 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
                            title="עריכה מלאה"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onSoftDeleteActivity(selectedActivity.id)}
                            className="p-1.5 text-red-700 hover:text-red-900 bg-white border border-slate-200 rounded-lg hover:bg-red-50"
                            title="מחיקה"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* שורת סטטוס וקטגוריה */}
                    <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
                      {selStatus === 'blue' && (
                        <span className="inline-flex items-center gap-1 font-bold text-blue-800">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>כחול · בוצע</span>
                        </span>
                      )}
                      {selStatus === 'green' && (
                        <span className="inline-flex items-center gap-1 font-bold text-emerald-800">
                          <Clock className="w-3.5 h-3.5" />
                          <span>ירוק · מוכן ומלא</span>
                        </span>
                      )}
                      {selStatus === 'red' && (
                        <span className="inline-flex items-center gap-1 font-bold text-red-700">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>אדום · חסרים פרטי חובה</span>
                        </span>
                      )}
                      <span className="text-slate-400">·</span>
                      <span className="font-semibold text-slate-700">
                        קטגוריה: {selectedActivity.category}
                      </span>
                    </div>
                  </div>

                  {/* מפרט מלא של הפעילות הנבחרת */}
                  <div className="space-y-2.5 text-xs">
                    <div className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-200/80">
                      <Calendar className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-slate-900">
                          {selectedActivity.hebrewDateDisplay}
                        </div>
                        <div className="text-slate-600 font-mono tabular-nums mt-0.5">
                          תאריך לועזי: {selectedActivity.gregorianDate} · שקיעה:{' '}
                          {selectedActivity.sunsetTime || '17:30'}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-2.5 rounded-lg border border-slate-200/80">
                        <div className="text-slate-500 flex items-center gap-1 mb-0.5">
                          <User className="w-3.5 h-3.5" />
                          <span>אחראי פעילות:</span>
                        </div>
                        <div className="font-bold text-slate-900">
                          {selectedActivity.responsiblePerson || (
                            <span className="text-red-600">טרם הוגדר אחראי</span>
                          )}
                        </div>
                      </div>

                      <div className="p-2.5 rounded-lg border border-slate-200/80">
                        <div className="text-slate-500 flex items-center gap-1 mb-0.5">
                          <Wallet className="w-3.5 h-3.5" />
                          <span>תקציב משוער:</span>
                        </div>
                        <div className="font-bold text-slate-900 font-mono tabular-nums">
                          {selectedActivity.estimatedBudgetAgorot &&
                          selectedActivity.estimatedBudgetAgorot > 0 ? (
                            formatAgorotToIls(selectedActivity.estimatedBudgetAgorot)
                          ) : (
                            <span className="text-red-600 font-sans">טרם הוגדר תקציב</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg border border-slate-200/80">
                      <div className="text-slate-500 flex items-center gap-1 mb-0.5">
                        <MapPin className="w-3.5 h-3.5" />
                        <span>מיקום מדויק:</span>
                      </div>
                      <div className="font-bold text-slate-900">
                        {selectedActivity.locationName || (
                          <span className="text-red-600">טרם הוגדר מיקום</span>
                        )}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg border border-slate-200/80">
                      <div className="text-slate-500 flex items-center gap-1 mb-0.5">
                        <FileText className="w-3.5 h-3.5" />
                        <span>הערות ודגשים לביצוע:</span>
                      </div>
                      <div className="text-slate-800 leading-relaxed">
                        {selectedActivity.notes || 'ללא הערות מיוחדות.'}
                      </div>
                    </div>

                    {tpl && Object.keys(parsedCustom).length > 0 && (
                      <div className="p-2.5 rounded-lg border border-slate-200/80 bg-slate-50/60 space-y-1">
                        <div className="font-bold text-slate-800">
                          שדות תבנית ({tpl.name}):
                        </div>
                        {Object.entries(parsedCustom).map(([k, v]) => (
                          <div key={k} className="flex items-center justify-between text-slate-700">
                            <span>{k}:</span>
                            <strong className="font-mono">{String(v)}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* משימות נגזרות של הפעילות הנבחרת */}
                  <div className="pt-2 border-t border-slate-200 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-900">
                        משימות ביצוע משויכות ({linkedTasks.length}):
                      </span>
                    </div>
                    {linkedTasks.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        אין תתי-משימות משויכות לפעילות זו. ניתן להוסיף דרך כפתור העריכה.
                      </p>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {linkedTasks.map((t) => (
                          <div
                            key={t.id}
                            className="p-2 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between gap-2 text-xs"
                          >
                            <button
                              type="button"
                              disabled={!canWrite}
                              onClick={() => onToggleTaskCompleted(t)}
                              className="flex items-center gap-2 text-right flex-1"
                            >
                              {t.isCompleted ? (
                                <CheckSquare className="w-4 h-4 text-emerald-700 shrink-0" />
                              ) : (
                                <Square className="w-4 h-4 text-slate-400 shrink-0" />
                              )}
                              <span
                                className={`font-medium ${
                                  t.isCompleted ? 'line-through text-slate-400' : 'text-slate-900'
                                }`}
                              >
                                {t.title}
                              </span>
                            </button>
                            {canWrite && (
                              <button
                                type="button"
                                onClick={() => onSoftDeleteTask(t.id)}
                                className="p-1 text-red-600 hover:bg-red-50 rounded"
                                title="מחק משימה"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* כפתורי פעולה מהירים בסרגל הצד */}
                  {canWrite && (
                    <div className="pt-2 border-t border-slate-200 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onToggleExecuted(selectedActivity)}
                        className="flex-1 py-2 px-3 text-xs font-bold border border-slate-300 rounded-lg hover:bg-slate-100 text-slate-900"
                      >
                        {selectedActivity.isExecuted ? 'בטל סימון ביצוע' : 'סמן פעילות כבוצעה'}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditForm(selectedActivity)}
                        className="flex-1 py-2 px-3 text-xs font-bold bg-slate-900 text-white rounded-lg hover:bg-slate-800"
                      >
                        עריכת פעילות
                      </button>
                    </div>
                  )}
                </div>
              );
            })()
          ) : (
            <div className="py-8 text-center text-xs text-slate-500">
              בחר פעילות או משימה מהרשימה כדי לצפות בפירוט המלא שלה כאן בסרגל הצד.
            </div>
          )}

          {/* סיכום תקציבי בתחתית הסרגל */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs font-bold text-slate-800">
            <span>סה״כ תקציב משוער בתצוגה:</span>
            <span className="font-mono tabular-nums text-sm text-slate-900">
              {formatAgorotToIls(
                filteredActivities.reduce(
                  (acc, item) => acc + (item.estimatedBudgetAgorot || 0),
                  0
                )
              )}
            </span>
          </div>
        </aside>

        {/* אזור מרכזי (8 עמודות): הצגת התוכנית השנתית בשני טורים כתקציר (רק הכותרת וכפתורי עריכה) */}
        <div className="sm:col-span-8">
          {filteredActivities.length === 0 ? (
            <div className="bg-white border border-slate-300/90 rounded-xl p-10 text-center text-slate-500 text-sm">
              לא נמצאו פעילויות בתוכנית השנתית התואמות לסינון הנוכחי.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 items-start">
              {filteredActivities.map((act) => {
                const status = computeAnnualActivityStatus(act);
                const isSelected = selectedActivity?.id === act.id;
                const isExpanded = expandedActivityIds.includes(act.id);
                const isInlineEditing = inlineEditingId === act.id;
                const linkedTasks = tasks.filter(
                  (t) => !t.deletedAt && t.parentId === act.id
                );

                return (
                  <div
                    key={act.id}
                    onClick={() => setSelectedActivityId(act.id)}
                    className={`bg-white rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-slate-900 ring-2 ring-slate-900/10 shadow-sm'
                        : 'border-slate-300/90 hover:border-slate-400'
                    }`}
                  >
                    {/* שורת תקציר בלבד: נקודת סטטוס + מלוא הכותרת + כפתורי אייקון עם הסבר צף במעבר עכבר */}
                    <div className="p-3 flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <div className="relative group/status shrink-0 mt-1.5">
                          <span
                            className={`block w-2.5 h-2.5 rounded-full ${
                              status === 'blue'
                                ? 'bg-blue-600'
                                : status === 'green'
                                ? 'bg-emerald-600'
                                : 'bg-red-600'
                            }`}
                          />
                          <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 hidden group-hover/status:block whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-md z-30">
                            {status === 'blue'
                              ? 'כחול: בוצע'
                              : status === 'green'
                              ? 'ירוק: תקין ומלא'
                              : 'אדום: חסרים שדות חובה'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedActivityId(act.id);
                          }}
                          className="text-right font-bold text-slate-900 text-sm leading-snug break-words hover:text-blue-900 flex-1"
                          title="לחץ להצגת הפירוט בסרגל הצד"
                        >
                          {act.title}
                        </button>
                      </div>

                      {/* כפתורי אייקון בלבד עם הסבר צף במעבר עכבר */}
                      <div
                        className="flex items-center gap-1 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canWrite && (
                          <>
                            <div className="relative group/btn">
                              <button
                                type="button"
                                onClick={() => openEditForm(act)}
                                className="p-1.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors flex items-center justify-center"
                                aria-label="עריכת פעילות"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/btn:block whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-md z-30">
                                עריכת פעילות
                              </span>
                            </div>

                            <div className="relative group/btn">
                              <button
                                type="button"
                                onClick={() => onSoftDeleteActivity(act.id)}
                                className="p-1.5 text-red-600 hover:text-red-800 bg-white border border-slate-200 rounded-md hover:bg-red-50 transition-colors flex items-center justify-center"
                                aria-label="מחיקת פעילות"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/btn:block whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-md z-30">
                                מחיקת פעילות
                              </span>
                            </div>
                          </>
                        )}
                        <div className="relative group/btn">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedActivityId(act.id);
                              toggleExpandedActivity(act.id);
                            }}
                            className="p-1.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors flex items-center justify-center"
                            aria-label={isExpanded ? 'סגור פירוט' : 'פתח פירוט'}
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 hidden group-hover/btn:block whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-md z-30">
                            {isExpanded ? 'סגור פירוט' : 'פתח פירוט פעילות'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* פירוט הפעילות/המשימה בעת פתיחת הכרטיס */}
                    {isExpanded && (
                      <div
                        className="px-3.5 pb-3.5 pt-2.5 border-t border-slate-200/80 bg-slate-50/70 space-y-2.5 text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-slate-500 block">תאריך עברי ולועזי:</span>
                            <strong className="text-slate-900">{act.hebrewDateDisplay}</strong>
                            <span className="block font-mono text-[11px] text-slate-600">
                              {act.gregorianDate} · שקיעה {act.sunsetTime || '17:30'}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block">קטגוריה ותקציב:</span>
                            <strong className="text-slate-900">{act.category}</strong>
                            <span className="block font-mono text-[11px] text-slate-800 font-semibold">
                              {act.estimatedBudgetAgorot && act.estimatedBudgetAgorot > 0
                                ? formatAgorotToIls(act.estimatedBudgetAgorot)
                                : 'חסר תקציב'}
                            </span>
                          </div>
                        </div>

                        {isInlineEditing ? (
                          <div className="space-y-2 pt-1">
                            <input
                              type="text"
                              value={inlineResponsibleDraft}
                              onChange={(e) => setInlineResponsibleDraft(e.target.value)}
                              placeholder="אחראי פעילות..."
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                            />
                            <input
                              type="text"
                              value={inlineLocationDraft}
                              onChange={(e) => setInlineLocationDraft(e.target.value)}
                              placeholder="מיקום הפעילות..."
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                            />
                            <input
                              type="text"
                              value={inlineNotesDraft}
                              onChange={(e) => setInlineNotesDraft(e.target.value)}
                              placeholder="הערות ודגשים..."
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleSaveInlineQuickEdit(act)}
                                className="px-3 py-1 bg-slate-900 text-white text-xs font-semibold rounded-md"
                              >
                                שמור
                              </button>
                              <button
                                type="button"
                                onClick={() => setInlineEditingId(null)}
                                className="px-2 py-1 text-xs text-slate-600"
                              >
                                ביטול
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                              <div>
                                <span className="text-slate-500">אחראי: </span>
                                <strong className="text-slate-900">
                                  {act.responsiblePerson || 'חסר אחראי'}
                                </strong>
                              </div>
                              <div>
                                <span className="text-slate-500">מיקום: </span>
                                <strong className="text-slate-900">
                                  {act.locationName || 'חסר מיקום'}
                                </strong>
                              </div>
                            </div>
                            <div className="text-slate-700 leading-relaxed">
                              <span className="text-slate-500">הערות: </span>
                              {act.notes || 'ללא הערות נוספות.'}
                            </div>
                            {linkedTasks.length > 0 && (
                              <div className="pt-1.5 border-t border-slate-200/80 space-y-1">
                                <span className="font-bold text-slate-800 block">
                                  תתי-משימות ({linkedTasks.length}):
                                </span>
                                {linkedTasks.map((t) => (
                                  <div
                                    key={t.id}
                                    className="flex items-center justify-between text-[11px] bg-white px-2 py-1 rounded border border-slate-200"
                                  >
                                    <span
                                      className={
                                        t.isCompleted
                                          ? 'line-through text-slate-400'
                                          : 'text-slate-800 font-medium'
                                      }
                                    >
                                      • {t.title}
                                    </span>
                                    <span className="font-mono text-slate-500">
                                      {t.hebrewDateStr || t.targetDate || ''}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {canWrite && (
                              <div className="pt-1 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setInlineEditingId(act.id);
                                    setInlineResponsibleDraft(act.responsiblePerson || '');
                                    setInlineLocationDraft(act.locationName || '');
                                    setInlineNotesDraft(act.notes || '');
                                  }}
                                  className="text-[11px] font-semibold text-blue-800 hover:underline"
                                >
                                  עריכה מהירה במקום
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
