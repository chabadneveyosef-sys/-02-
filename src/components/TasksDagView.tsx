import React, { useState } from 'react';
import {
  Plus,
  GitBranch,
  AlertCircle,
  CheckSquare,
  Square,
  Bell,
  Trash2,
  FolderKanban,
  Mail,
  Monitor,
  LayoutDashboard,
  Smartphone,
  Calendar,
  ChevronDown,
  ChevronUp,
  Edit3,
} from 'lucide-react';
import { TaskNodeRecord, ReminderChannel } from '../types/erp';
import {
  analyzeTaskDagAndCpm,
  wouldCreateCycle,
  DagTaskInput,
  fromGregorianDate,
  computeTaskReadinessStatus,
} from '../lib/erp-core';
import { HebrewDatePicker } from './HebrewDatePicker';

interface TasksDagViewProps {
  tasks: TaskNodeRecord[];
  canWrite: boolean;
  onSaveTask: (
    data: Omit<TaskNodeRecord, 'id' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) => Promise<void>;
  onToggleTaskCompleted: (task: TaskNodeRecord) => Promise<void>;
  onSoftDeleteTask: (id: string) => Promise<void>;
}

const CHANNEL_META: Record<
  ReminderChannel,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  email: { label: 'מייל', icon: Mail },
  desktop: { label: 'שולחן העבודה', icon: Monitor },
  dashboard: { label: 'דשבורד', icon: LayoutDashboard },
  mobile: { label: 'פלאפון', icon: Smartphone },
};

const ALL_CHANNELS: ReminderChannel[] = ['email', 'desktop', 'dashboard', 'mobile'];

function parseTaskChannels(jsonStr?: string): ReminderChannel[] {
  if (!jsonStr) return ['email', 'desktop', 'dashboard', 'mobile'];
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as ReminderChannel[];
    }
  } catch {
    // ignore
  }
  return ['email', 'desktop', 'dashboard', 'mobile'];
}

function computePreReminderDate(targetDateIso?: string, daysBefore: number = 2): string | undefined {
  if (!targetDateIso) return undefined;
  const ms = new Date(`${targetDateIso}T12:00:00`).getTime();
  if (isNaN(ms)) return targetDateIso;
  return new Date(ms - daysBefore * 86400000).toISOString().slice(0, 10);
}

export const TasksDagView: React.FC<TasksDagViewProps> = ({
  tasks,
  canWrite,
  onSaveTask,
  onToggleTaskCompleted,
  onSoftDeleteTask,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | undefined>(undefined);
  const [taskDisplayMode, setTaskDisplayMode] = useState<'two_columns' | 'table'>('two_columns');
  const [taskSideFilter, setTaskSideFilter] = useState<string>('all'); // 'all' | 'open' | 'completed' | 'critical' | rootTaskId
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<string[]>([]);
  const [anchorStartDate, setAnchorStartDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [cycleError, setCycleError] = useState<string | null>(null);
  const [notificationFeedback, setNotificationFeedback] = useState<string | null>(null);

  // New root task / project form state
  const [title, setTitle] = useState('');
  const [parentId, setParentId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [strategicGoal, setStrategicGoal] = useState('');
  const [successCriteria, setSuccessCriteria] = useState('');
  const [durationDays, setDurationDays] = useState('3');
  const [assignee, setAssignee] = useState('');
  const [selectedDeps, setSelectedDeps] = useState<string[]>([]);
  const [reminderDaysBefore, setReminderDaysBefore] = useState(2);
  const [reminderEmail, setReminderEmail] = useState('chabadneveyosef@gmail.com');
  const [selectedChannels, setSelectedChannels] = useState<ReminderChannel[]>([
    'email',
    'desktop',
    'dashboard',
    'mobile',
  ]);

  // Inline '+' subtask creation state inside the hierarchical tree
  const [addingSubtaskUnderId, setAddingSubtaskUnderId] = useState<string | null>(null);
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [subtaskTargetDate, setSubtaskTargetDate] = useState('');
  const [subtaskDurationDays, setSubtaskDurationDays] = useState('2');
  const [subtaskAssignee, setSubtaskAssignee] = useState('');
  const [subtaskDaysBefore, setSubtaskDaysBefore] = useState(2);
  const [subtaskChannels, setSubtaskChannels] = useState<ReminderChannel[]>([
    'email',
    'desktop',
    'dashboard',
    'mobile',
  ]);

  const activeTasks = tasks.filter((t) => !t.deletedAt);
  const taskIdsSet = new Set(activeTasks.map((t) => t.id));

  // Root tasks are tasks that have no parentId, or whose parentId is an AnnualActivity (not another task in activeTasks)
  const rootTasks = activeTasks.filter((t) => !t.parentId || !taskIdsSet.has(t.parentId));
  const selectedTask =
    activeTasks.find((t) => t.id === selectedTaskId) || rootTasks[0] || activeTasks[0] || null;

  const toggleExpandedTask = (id: string) => {
    setExpandedTaskIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // הכנת קלט לניתוח DAG ו-CPM
  const dagInputs: DagTaskInput[] = activeTasks.map((t) => {
    let deps: string[] = [];
    try {
      deps = JSON.parse(t.dependsOnIdsJson || '[]');
    } catch {
      deps = [];
    }
    return {
      id: t.id,
      title: t.title,
      durationDays: t.durationDays,
      dependsOnIds: deps,
      isCompleted: t.isCompleted,
    };
  });

  const cpmResult = analyzeTaskDagAndCpm(dagInputs, anchorStartDate);

  const handleToggleDependency = (depId: string) => {
    setCycleError(null);
    if (selectedDeps.includes(depId)) {
      setSelectedDeps(selectedDeps.filter((id) => id !== depId));
      return;
    }
    setSelectedDeps([...selectedDeps, depId]);
  };

  const handleUpdateTaskExecutionDateAndReminders = async (
    task: TaskNodeRecord,
    newTargetDate: string,
    newDaysBefore?: number,
    newChannels?: ReminderChannel[]
  ) => {
    if (!canWrite) return;
    const daysBefore =
      newDaysBefore !== undefined ? newDaysBefore : task.reminderDaysBefore ?? 2;
    const channels = newChannels || parseTaskChannels(task.reminderChannelsJson);
    const autoIsProject = !newTargetDate || newTargetDate.trim() === '';
    const hebStr = newTargetDate
      ? fromGregorianDate(newTargetDate).hebrewDisplay
      : 'פרויקט מתמשך (ללא תאריך יעד)';
    const preRemDate = computePreReminderDate(newTargetDate || undefined, daysBefore);

    await onSaveTask(
      {
        title: task.title,
        parentId: task.parentId,
        targetDate: newTargetDate || undefined,
        hebrewDateStr: hebStr,
        isProject: autoIsProject,
        strategicGoal: task.strategicGoal,
        successCriteria: task.successCriteria,
        durationDays: task.durationDays,
        isCompleted: task.isCompleted,
        assignee: task.assignee,
        dependsOnIdsJson: task.dependsOnIdsJson,
        reminderDate: preRemDate,
        reminderEmail: task.reminderEmail || 'chabadneveyosef@gmail.com',
        reminderDaysBefore: daysBefore,
        reminderChannelsJson: JSON.stringify(channels),
      },
      task.id
    );
  };

  const handleAddDependencyToExisting = async (task: TaskNodeRecord, newDepId: string) => {
    if (!canWrite || !newDepId) return;
    setCycleError(null);

    if (wouldCreateCycle(dagInputs, task.id, newDepId)) {
      setCycleError(
        `הגנת מערכת (DFS): לא ניתן להוסיף תלות זו למשימה "${task.title}" מכיוון שהיא יוצרת מעגל תלויות אינסופי (Cycle)!`
      );
      return;
    }

    let currentDeps: string[] = [];
    try {
      currentDeps = JSON.parse(task.dependsOnIdsJson || '[]');
    } catch {
      currentDeps = [];
    }
    if (currentDeps.includes(newDepId)) return;

    await onSaveTask(
      {
        title: task.title,
        parentId: task.parentId,
        targetDate: task.targetDate,
        hebrewDateStr: task.hebrewDateStr,
        isProject: task.isProject,
        strategicGoal: task.strategicGoal,
        successCriteria: task.successCriteria,
        durationDays: task.durationDays,
        isCompleted: task.isCompleted,
        assignee: task.assignee,
        dependsOnIdsJson: JSON.stringify([...currentDeps, newDepId]),
        reminderDate: task.reminderDate,
        reminderEmail: task.reminderEmail,
        reminderDaysBefore: task.reminderDaysBefore,
        reminderChannelsJson: task.reminderChannelsJson,
      },
      task.id
    );
  };

  const handleTriggerDesktopAndMobileTestReminder = async (task: TaskNodeRecord) => {
    const channels = parseTaskChannels(task.reminderChannelsJson);
    const channelNames = channels.map((c) => CHANNEL_META[c].label).join(', ');
    if (
      (channels.includes('desktop') || channels.includes('mobile')) &&
      typeof window !== 'undefined' &&
      'Notification' in window
    ) {
      try {
        if (Notification.permission === 'granted') {
          new Notification(`תזכורת משימה: ${task.title}`, {
            body: `תאריך ביצוע: ${task.targetDate || 'קרוב'} (${task.hebrewDateStr || ''})`,
          });
        } else if (Notification.permission !== 'denied') {
          const perm = await Notification.requestPermission();
          if (perm === 'granted') {
            new Notification(`תזכורת משימה: ${task.title}`, {
              body: `תאריך ביצוע: ${task.targetDate || 'קרוב'} (${task.hebrewDateStr || ''})`,
            });
          }
        }
      } catch {
        // Ignore notification permission restrictions in iframe
      }
    }
    setNotificationFeedback(
      `תזכורת למשימה "${task.title}" מתוזמנת לתאריך הביצוע (${
        task.targetDate || 'טרם הוגדר'
      }) ו-${task.reminderDaysBefore ?? 2} ימים לפניו (${
        task.reminderDate || 'אוטומטי'
      }) בערוצים: ${channelNames}.`
    );
  };

  const openNewTaskForm = () => {
    setEditingTaskId(undefined);
    setTitle('');
    setParentId('');
    setTargetDate('');
    setStrategicGoal('');
    setSuccessCriteria('');
    setDurationDays('3');
    setAssignee('');
    setSelectedDeps([]);
    setReminderDaysBefore(2);
    setReminderEmail('chabadneveyosef@gmail.com');
    setSelectedChannels(['email', 'desktop', 'dashboard', 'mobile']);
    setShowForm(true);
  };

  const openEditTaskForm = (task: TaskNodeRecord) => {
    setEditingTaskId(task.id);
    setTitle(task.title);
    setParentId(task.parentId || '');
    setTargetDate(task.targetDate || '');
    setStrategicGoal(task.strategicGoal || '');
    setSuccessCriteria(task.successCriteria || '');
    setDurationDays(String(task.durationDays || 3));
    setAssignee(task.assignee || '');
    try {
      setSelectedDeps(JSON.parse(task.dependsOnIdsJson || '[]'));
    } catch {
      setSelectedDeps([]);
    }
    setReminderDaysBefore(task.reminderDaysBefore ?? 2);
    setReminderEmail(task.reminderEmail || 'chabadneveyosef@gmail.com');
    setSelectedChannels(parseTaskChannels(task.reminderChannelsJson));
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !canWrite) return;

    if (!editingTaskId) {
      // שלב א׳: הוספת כותרת בלבד (סטטוס אדום — להשלמה בלחיצה על כפתור העריכה)
      await onSaveTask({
        title: title.trim(),
        parentId: undefined,
        targetDate: undefined,
        hebrewDateStr: 'טרם הוגדר תאריך (לחץ עריכה להשלמה)',
        isProject: true,
        strategicGoal: '',
        successCriteria: '',
        durationDays: 1,
        isCompleted: false,
        assignee: '',
        dependsOnIdsJson: JSON.stringify([]),
        reminderDate: undefined,
        reminderEmail: 'chabadneveyosef@gmail.com',
        reminderDaysBefore: 2,
        reminderChannelsJson: JSON.stringify(['email', 'desktop', 'dashboard', 'mobile']),
      });
    } else {
      // שלב ב׳: שמירת עריכה מלאה (תאריך, תתי-משימות ופרטים שהופכים את המשימה לירוקה)
      const existing = activeTasks.find((t) => t.id === editingTaskId);
      const autoIsProject = !targetDate || targetDate.trim() === '';
      const hebStr = targetDate
        ? fromGregorianDate(targetDate).hebrewDisplay
        : 'פרויקט מתמשך (ללא תאריך יעד)';
      const preReminder = computePreReminderDate(targetDate || undefined, reminderDaysBefore);

      await onSaveTask(
        {
          title: title.trim(),
          parentId: parentId || undefined,
          targetDate: targetDate || undefined,
          hebrewDateStr: hebStr,
          isProject: autoIsProject,
          strategicGoal: strategicGoal.trim(),
          successCriteria: successCriteria.trim(),
          durationDays: Math.max(1, Number(durationDays) || 1),
          isCompleted: existing ? existing.isCompleted : false,
          assignee: assignee.trim(),
          dependsOnIdsJson: JSON.stringify(selectedDeps),
          reminderDate: preReminder,
          reminderEmail: reminderEmail.trim() || undefined,
          reminderDaysBefore,
          reminderChannelsJson: JSON.stringify(selectedChannels),
        },
        editingTaskId
      );
    }

    setTitle('');
    setTargetDate('');
    setStrategicGoal('');
    setSuccessCriteria('');
    setSelectedDeps([]);
    setEditingTaskId(undefined);
    setShowForm(false);
  };

  const handleOpenAddSubtask = (parentTask: TaskNodeRecord) => {
    setAddingSubtaskUnderId(parentTask.id);
    setSubtaskTitle('');
    setSubtaskTargetDate(parentTask.targetDate || new Date().toISOString().slice(0, 10));
    setSubtaskDurationDays('2');
    setSubtaskAssignee(parentTask.assignee || '');
    setSubtaskDaysBefore(2);
    setSubtaskChannels(['email', 'desktop', 'dashboard', 'mobile']);
  };

  const handleConfirmAddSubtask = async (e: React.FormEvent, parentTask: TaskNodeRecord) => {
    e.preventDefault();
    if (!subtaskTitle.trim() || !canWrite) return;

    const autoIsProject = !subtaskTargetDate || subtaskTargetDate.trim() === '';
    const hebStr = subtaskTargetDate
      ? fromGregorianDate(subtaskTargetDate).hebrewDisplay
      : 'פרויקט מתמשך (ללא תאריך יעד)';
    const preReminder = computePreReminderDate(
      subtaskTargetDate || undefined,
      subtaskDaysBefore
    );

    await onSaveTask({
      title: subtaskTitle.trim(),
      parentId: parentTask.id,
      targetDate: subtaskTargetDate || undefined,
      hebrewDateStr: hebStr,
      isProject: autoIsProject,
      durationDays: Math.max(1, Number(subtaskDurationDays) || 1),
      isCompleted: false,
      assignee: subtaskAssignee.trim() || undefined,
      dependsOnIdsJson: JSON.stringify([]),
      reminderDate: preReminder,
      reminderEmail: parentTask.reminderEmail || 'chabadneveyosef@gmail.com',
      reminderDaysBefore: subtaskDaysBefore,
      reminderChannelsJson: JSON.stringify(subtaskChannels),
    });

    setAddingSubtaskUnderId(null);
    setSubtaskTitle('');
  };

  // רינדור רקורסיבי של עץ המשימות ותתי-המשימות בעמוד התכנון
  const renderTaskTreeRows = (task: TaskNodeRecord, depth: number = 0): React.ReactNode => {
    const children = activeTasks.filter((t) => t.parentId === task.id);
    const sched = cpmResult.schedules[task.id];
    const channels = parseTaskChannels(task.reminderChannelsJson);
    const daysBefore = task.reminderDaysBefore ?? 2;

    let deps: string[] = [];
    try {
      deps = JSON.parse(task.dependsOnIdsJson || '[]');
    } catch {
      deps = [];
    }

    return (
      <React.Fragment key={task.id}>
        <tr className={`hover:bg-slate-50/90 transition-colors ${depth > 0 ? 'bg-slate-50/40' : ''}`}>
          {/* 1. סימון ביצוע */}
          <td className="py-3.5 px-4 align-top col-compact">
            <button
              type="button"
              disabled={!canWrite}
              onClick={() => onToggleTaskCompleted(task)}
              className="text-slate-700 hover:text-slate-900 mt-0.5"
              title={task.isCompleted ? 'סמן כלא בוצע' : 'סמן משימה כבוצעה'}
            >
              {task.isCompleted ? (
                <CheckSquare className="w-5 h-5 text-emerald-700" />
              ) : (
                <Square className="w-5 h-5 text-slate-500" />
              )}
            </button>
          </td>

          {/* 2. עץ משימות ותתי-משימות עם כפתור + להוספת תת-משימה (תא רחב קבוע לטקסט מפורט) */}
          <td className="py-3.5 px-5 align-top col-text-wide">
            <div
              style={{ marginRight: `${depth * 22}px` }}
              className={`${depth > 0 ? 'pr-3 border-r-2 border-slate-400/70' : ''}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                {depth > 0 && <span className="text-slate-500 font-bold">↳</span>}
                {task.isProject && (
                  <FolderKanban className="w-4 h-4 text-amber-700 shrink-0" />
                )}
                <span
                  className={`font-bold text-slate-900 text-base leading-snug ${
                    task.isCompleted ? 'line-through text-slate-400' : ''
                  }`}
                >
                  {task.title}
                </span>

                {canWrite && (
                  <button
                    type="button"
                    onClick={() => handleOpenAddSubtask(task)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors"
                    title="הוסף תת-משימה נוספת מתחת למשימה זו (+)"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>תת-משימה</span>
                  </button>
                )}
              </div>

              {task.assignee && (
                <div className="text-xs text-slate-600 font-medium mt-1">אחראי ביצוע: {task.assignee}</div>
              )}
              {task.strategicGoal && (
                <div className="text-xs text-slate-700 mt-1 leading-relaxed">
                  <strong>מטרה ומהות:</strong> {task.strategicGoal}
                </div>
              )}
              {task.successCriteria && (
                <div className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                  <strong>מבחן הצלחה:</strong> {task.successCriteria}
                </div>
              )}
            </div>
          </td>

          {/* 3. תאריך ביצוע למשימה הספציפית (לוח שנה עברי נפתח) + תזכורות */}
          <td className="py-3.5 px-4 align-top text-xs min-w-[310px]">
            <div className="space-y-2 bg-slate-50 border border-slate-200 rounded-lg p-2.5 min-w-[280px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="font-bold text-slate-800 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-600" />
                  <span>תאריך ביצוע (עברי):</span>
                </label>
                <HebrewDatePicker
                  compact
                  disabled={!canWrite}
                  allowClear
                  clearLabel="ללא תאריך (פרויקט)"
                  value={
                    task.targetDate
                      ? fromGregorianDate(task.targetDate).triplet
                      : null
                  }
                  onChange={(_tr, conv) =>
                    handleUpdateTaskExecutionDateAndReminders(task, conv.gregorianIso)
                  }
                  onClear={() => handleUpdateTaskExecutionDateAndReminders(task, '')}
                />
              </div>

              {task.targetDate ? (
                <div className="text-[11px] text-slate-600 flex items-center justify-between">
                  <span>תאריך עברי: <strong>{task.hebrewDateStr}</strong></span>
                  <span className="text-emerald-700 font-semibold">תזכורת פעילה</span>
                </div>
              ) : (
                <div className="text-[11px] text-amber-800 font-semibold">
                  ללא תאריך ביצוע (מוגדר כפרויקט — בחר תאריך בלוח העברי להפעלת תזכורות)
                </div>
              )}

              {/* הגדרת תזכורת בתאריך הביצוע ולפניו + ערוצי שליחה */}
              <div className="pt-1.5 border-t border-slate-200/80 space-y-1.5">
                <div className="flex items-center justify-between gap-1 text-[11px]">
                  <span className="text-slate-600 font-semibold flex items-center gap-1">
                    <Bell className="w-3 h-3 text-amber-600" />
                    תזכורות בתאריך ולפניו:
                  </span>
                  <select
                    disabled={!canWrite}
                    value={daysBefore}
                    onChange={(e) =>
                      handleUpdateTaskExecutionDateAndReminders(
                        task,
                        task.targetDate || '',
                        Number(e.target.value),
                        channels
                      )
                    }
                    className="px-1.5 py-0.5 text-[11px] border border-slate-300 rounded bg-white text-slate-800"
                  >
                    <option value={0}>ביום הביצוע בלבד</option>
                    <option value={1}>יום לפני + ביום הביצוע</option>
                    <option value={2}>יומיים לפני + ביום הביצוע</option>
                    <option value={3}>3 ימים לפני + ביום הביצוע</option>
                    <option value={7}>שבוע לפני + ביום הביצוע</option>
                  </select>
                </div>

                {/* 4 ערוצי התזכורת: מייל, שולחן העבודה, דשבורד, פלאפון */}
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {ALL_CHANNELS.map((ch) => {
                    const active = channels.includes(ch);
                    const Icon = CHANNEL_META[ch].icon;
                    return (
                      <button
                        key={ch}
                        type="button"
                        disabled={!canWrite}
                        onClick={() => {
                          const next = active
                            ? channels.filter((c) => c !== ch)
                            : [...channels, ch];
                          handleUpdateTaskExecutionDateAndReminders(
                            task,
                            task.targetDate || '',
                            daysBefore,
                            next
                          );
                        }}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 border transition-colors ${
                          active
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                        }`}
                        title={`שליחת תזכורת ב${CHANNEL_META[ch].label} בתאריך הביצוע ולפניו`}
                      >
                        <Icon className="w-3 h-3" />
                        <span>{CHANNEL_META[ch].label}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => handleTriggerDesktopAndMobileTestReminder(task)}
                    className="text-[11px] text-blue-700 hover:underline mr-auto"
                    title="בדוק תזכורת כעת"
                  >
                    בדוק תזכורת
                  </button>
                </div>
              </div>
            </div>
          </td>

          {/* 4. משך בימים */}
          <td className="py-3 px-4 align-top font-mono tabular-nums text-xs">
            {task.durationDays} ימים
          </td>

          {/* 5. תלויות (DAG) */}
          <td className="py-3 px-4 align-top text-xs">
            <div className="space-y-1">
              {deps.length === 0 ? (
                <span className="text-slate-400">ללא תלויות קודמות</span>
              ) : (
                deps.map((dId) => {
                  const depTask = activeTasks.find((x) => x.id === dId);
                  return (
                    <div key={dId} className="text-slate-700">
                      • תלוי ב: {depTask?.title || dId.slice(0, 6)}
                    </div>
                  );
                })
              )}
              {canWrite && (
                <select
                  value=""
                  onChange={(e) => handleAddDependencyToExisting(task, e.target.value)}
                  className="mt-1 block w-full text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-slate-50"
                >
                  <option value="">+ הוסף תלות (נבדק ב-DFS)...</option>
                  {activeTasks
                    .filter((other) => other.id !== task.id && !deps.includes(other.id))
                    .map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.title}
                      </option>
                    ))}
                </select>
              )}
            </div>
          </td>

          {/* 6. המלצת התחלה ו-CPM */}
          <td className="py-3 px-4 align-top text-xs whitespace-nowrap">
            {sched ? (
              <div>
                <div className="font-mono tabular-nums font-semibold text-slate-900">
                  התחלה מומלצת: {sched.recommendedStartDate}
                </div>
                <div className="text-slate-500 font-mono tabular-nums">
                  יום {sched.earliestStart} עד {sched.earliestFinish} · מרווח: {sched.slack} ימים
                </div>
                {sched.isCritical && (
                  <div className="text-amber-800 font-bold mt-0.5">
                    ★ צומת במסלול הקריטי (CPM)
                  </div>
                )}
              </div>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </td>

          {/* 7. פעולות (+ הוספת תת-משימה ומחיקה רכה) */}
          <td className="py-3 px-4 align-top text-left whitespace-nowrap">
            {canWrite && (
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleOpenAddSubtask(task)}
                  className="px-2 py-1 text-xs font-bold bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-900 rounded transition-colors flex items-center gap-1"
                  title="הוסף תת-משימה (+)"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>תת-משימה</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSoftDeleteTask(task.id)}
                  className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                  title="מחיקה רכה"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </td>
        </tr>

        {/* שורת הוספת תת-משימה (+) מתחת למשימה הנוכחית בעץ */}
        {addingSubtaskUnderId === task.id && canWrite && (
          <tr className="bg-amber-50/60">
            <td colSpan={7} className="px-6 py-3 border-t border-amber-200">
              <form
                onSubmit={(e) => handleConfirmAddSubtask(e, task)}
                className="flex flex-wrap items-center gap-3"
                style={{ marginRight: `${(depth + 1) * 20}px` }}
              >
                <span className="text-xs font-bold text-slate-900 flex items-center gap-1">
                  <Plus className="w-4 h-4 text-amber-700" />
                  הוספת תת-משימה תחת &quot;{task.title}&quot;:
                </span>
                <input
                  type="text"
                  required
                  autoFocus
                  value={subtaskTitle}
                  onChange={(e) => setSubtaskTitle(e.target.value)}
                  placeholder="שם תת-המשימה..."
                  className="flex-1 min-w-[180px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                />
                <div className="flex items-center gap-1.5 text-xs text-slate-800 font-semibold">
                  <span>תאריך ביצוע (לוח עברי):</span>
                  <HebrewDatePicker
                    compact
                    allowClear
                    clearLabel="ללא תאריך (פרויקט)"
                    value={
                      subtaskTargetDate
                        ? fromGregorianDate(subtaskTargetDate).triplet
                        : null
                    }
                    onChange={(_tr, conv) => setSubtaskTargetDate(conv.gregorianIso)}
                    onClear={() => setSubtaskTargetDate('')}
                  />
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-700">
                  <span>תזכורת לפני:</span>
                  <select
                    value={subtaskDaysBefore}
                    onChange={(e) => setSubtaskDaysBefore(Number(e.target.value))}
                    className="px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value={0}>ביום הביצוע</option>
                    <option value={1}>יום לפני + ביום הביצוע</option>
                    <option value={2}>יומיים לפני + ביום הביצוע</option>
                    <option value={3}>3 ימים לפני + ביום הביצוע</option>
                    <option value={7}>שבוע לפני + ביום הביצוע</option>
                  </select>
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-700">
                  <span>אחראי:</span>
                  <input
                    type="text"
                    value={subtaskAssignee}
                    onChange={(e) => setSubtaskAssignee(e.target.value)}
                    placeholder="שם אחראי..."
                    className="w-28 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-700">
                  <span>ימים:</span>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={subtaskDurationDays}
                    onChange={(e) => setSubtaskDurationDays(e.target.value)}
                    className="w-16 px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white font-mono"
                  />
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-700 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                  <span className="font-bold">תזכורת ב:</span>
                  {ALL_CHANNELS.map((ch) => (
                    <label key={ch} className="inline-flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={subtaskChannels.includes(ch)}
                        onChange={() =>
                          setSubtaskChannels((prev) =>
                            prev.includes(ch) ? prev.filter((x) => x !== ch) : [...prev, ch]
                          )
                        }
                      />
                      <span>{CHANNEL_META[ch].label}</span>
                    </label>
                  ))}
                </div>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800"
                >
                  שמור תת-משימה +
                </button>
                <button
                  type="button"
                  onClick={() => setAddingSubtaskUnderId(null)}
                  className="px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                >
                  ביטול
                </button>
              </form>
            </td>
          </tr>
        )}

        {/* רינדור רקורסיבי של כל תתי-המשימות מתחת למשימה זו */}
        {children.map((child) => renderTaskTreeRows(child, depth + 1))}
      </React.Fragment>
    );
  };

  // חישוב משימות עם תזכורות קרובות או פעילות לדשבורד התזכורות בראש עמוד התכנון
  const upcomingReminders = activeTasks.filter((t) => !t.isCompleted && t.targetDate);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">
            תכנון משימות, עץ תתי-משימות (+), תאריכי ביצוע ותזכורות רב-ערוציות
          </h2>
          <p className="text-sm text-slate-600">
            עץ היררכי של פרויקטים ותתי-משימות (אינו מופיע בטבלת התוכנית השנתית). לצד כל משימה מוגדר <strong>תאריך ביצוע ספציפי</strong> שמפעיל תזכורות בתאריך הביצוע ולפניו במייל, בשולחן העבודה, בדשבורד ובפלאפון.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-600 bg-white border border-slate-200 px-3 py-1 rounded-lg">
            <span>תאריך עוגן לחישוב התחלה (CPM בלוח עברי):</span>
            <HebrewDatePicker
              compact
              value={fromGregorianDate(anchorStartDate).triplet}
              onChange={(_tr, conv) => setAnchorStartDate(conv.gregorianIso)}
            />
          </div>

          {canWrite && (
            <button
              type="button"
              onClick={openNewTaskForm}
              className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              משימה / פרויקט ראשי חדש
            </button>
          )}
        </div>
      </div>

      {cycleError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between text-red-800 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <span>{cycleError}</span>
          </div>
          <button
            type="button"
            onClick={() => setCycleError(null)}
            className="text-xs underline"
          >
            סגור
          </button>
        </div>
      )}

      {notificationFeedback && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between text-blue-900 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <Bell className="w-5 h-5 text-blue-700 shrink-0" />
            <span>{notificationFeedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotificationFeedback(null)}
            className="text-xs underline"
          >
            סגור
          </button>
        </div>
      )}

      {/* מרכז תזכורות פעיל בדשבורד התכנון (מייל / שולחן העבודה / דשבורד / פלאפון) */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Bell className="w-4 h-4 text-amber-600" />
            <span>לוח תזכורות אוטומטי למשימות (בתאריך הביצוע ולפניו — מייל, שולחן עבודה, דשבורד ופלאפון)</span>
          </div>
          <span className="text-xs text-slate-500">
            {upcomingReminders.length} משימות מתוזמנות עם תאריך ביצוע פעיל
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {upcomingReminders.slice(0, 3).map((remTask) => {
            const chs = parseTaskChannels(remTask.reminderChannelsJson);
            return (
              <div
                key={remTask.id}
                className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1"
              >
                <div className="font-bold text-slate-900 truncate">{remTask.title}</div>
                <div className="text-slate-700">
                  תאריך ביצוע: <strong className="font-mono">{remTask.targetDate}</strong> ({remTask.hebrewDateStr})
                </div>
                <div className="text-slate-500">
                  תזכורת מקדימה: <span className="font-mono">{remTask.reminderDate || 'יומיים לפני'}</span> ({remTask.reminderDaysBefore ?? 2} ימים לפני)
                </div>
                <div className="flex flex-wrap items-center gap-1 pt-1">
                  {chs.map((c) => (
                    <span
                      key={c}
                      className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-semibold text-slate-700"
                    >
                      {CHANNEL_META[c].label}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CPM Summary Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">משך פרויקט כולל במסלול הקריטי (CPM)</div>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
            {cpmResult.totalDurationDays} ימי עבודה
          </div>
          <div className="text-xs text-slate-500 mt-1">
            כולל {activeTasks.length} משימות ותתי-משימות פעילות בעץ
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">משימות במסלול הקריטי (אפס מרווח עיכוב / Slack=0)</div>
          <div className="text-sm font-bold text-amber-800 mt-1">
            {cpmResult.criticalPathIds.length > 0
              ? cpmResult.criticalPathIds
                  .map((id) => cpmResult.schedules[id]?.title)
                  .filter(Boolean)
                  .join(' ← ')
              : 'אין משימות קריטיות פעילות'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">תקינות גרף תלויות (DAG / DFS)</div>
          <div className="text-sm font-bold text-emerald-700 mt-1 flex items-center gap-1.5">
            <GitBranch className="w-4 h-4" />
            <span>גרף נקי ממעגלים · ממוין טופולוגית ({cpmResult.topologicalOrder.length} צמתים)</span>
          </div>
        </div>
      </div>

      {showForm && canWrite && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-xs"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {editingTaskId
                  ? 'שלב ב׳: עריכת משימה / פרויקט — הוספת תאריך, תתי-משימות ופרטים כדי להפוך לירוקה'
                  : 'שלב א׳: הוספת משימה או פרויקט חדש (כותרת בלבד)'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {editingTaskId
                  ? 'הגדר תאריך ביצוע, תתי-משימות, אחראי או תלויות כדי שהמשימה תהפוך מאדומה לירוקה.'
                  : 'בהוספת משימה מוסיפים תחילה רק את הכותרת (המשימה תופיע כ"אדומה"). לאחר מכן ניתן ללחוץ על כפתור העריכה בכרטיס כדי להוסיף תתי-משימות, תאריך ועוד — כדי שתהפוך לירוקה.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditingTaskId(undefined);
              }}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              ביטול ✕
            </button>
          </div>

          {!editingTaskId ? (
            /* מצב הוספה ראשונית: כותרת בלבד */
            <div className="flex flex-wrap items-end gap-3 pt-1">
              <div className="flex-1 min-w-[260px]">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  כותרת המשימה / הפרויקט *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="הקלד רק את כותרת המשימה או הפרויקט..."
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>הוסף כותרת משימה (אדום — להשלמה בעריכה)</span>
                </button>
              </div>
            </div>
          ) : (
            /* מצב עריכת משימה: הוספת תאריך, תתי-משימות ופרטים כדי להפוך לירוקה */
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">כותרת המשימה / הפרויקט *</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="למשל: הפקת חוברת לימוד או סגירת אולם"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <HebrewDatePicker
                    allowClear
                    clearLabel="ללא תאריך (פרויקט מתמשך)"
                    label="תאריך ביצוע למשימה הספציפית (לוח עברי — הופך את המשימה לירוקה)"
                    value={targetDate ? fromGregorianDate(targetDate).triplet : null}
                    onChange={(_tr, conv) => setTargetDate(conv.gregorianIso)}
                    onClear={() => setTargetDate('')}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">שיוך למשימת אב / פרויקט (עץ משימות)</label>
                  <select
                    value={parentId}
                    onChange={(e) => setParentId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">ללא משימת אב (רמה ראשית בעץ)</option>
                    {activeTasks
                      .filter((p) => p.id !== editingTaskId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">משך ביצוע בימים (ל-CPM) *</label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={durationDays}
                    onChange={(e) => setDurationDays(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">אחראי ביצוע</label>
                  <input
                    type="text"
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                    placeholder="שם השליח / המתנדב"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">מהות ומטרה אסטרטגית</label>
                  <input
                    type="text"
                    value={strategicGoal}
                    onChange={(e) => setStrategicGoal(e.target.value)}
                    placeholder="למשל: חיזוק הקשר האישי עם תושבי השכונה..."
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">מבחן הצלחה כמותי/ברור</label>
                  <input
                    type="text"
                    value={successCriteria}
                    onChange={(e) => setSuccessCriteria(e.target.value)}
                    placeholder="למשל: 150 משתתפים רשומים"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    תלויות קודמות (משימות שחייבות להסתיים לפני תחילת משימה זו):
                  </label>
                  <div className="max-h-28 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                    {activeTasks
                      .filter((t) => t.id !== editingTaskId)
                      .map((t) => (
                        <label key={t.id} className="flex items-center gap-2 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            checked={selectedDeps.includes(t.id)}
                            onChange={() => handleToggleDependency(t.id)}
                          />
                          <span>{t.title} ({t.durationDays} ימים)</span>
                        </label>
                      ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    הגדרות תזכורת בתאריך הביצוע ולפניו (במייל / שולחן העבודה / דשבורד / פלאפון)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={reminderDaysBefore}
                      onChange={(e) => setReminderDaysBefore(Number(e.target.value))}
                      className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      <option value={0}>ביום הביצוע בלבד</option>
                      <option value={1}>יום לפני + ביום הביצוע</option>
                      <option value={2}>יומיים לפני + ביום הביצוע</option>
                      <option value={3}>3 ימים לפני + ביום הביצוע</option>
                      <option value={7}>שבוע לפני + ביום הביצוע</option>
                    </select>
                    <input
                      type="email"
                      value={reminderEmail}
                      onChange={(e) => setReminderEmail(e.target.value)}
                      placeholder="אימייל לתזכורת..."
                      className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-slate-700">
                    {ALL_CHANNELS.map((ch) => (
                      <label key={ch} className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedChannels.includes(ch)}
                          onChange={() =>
                            setSelectedChannels((prev) =>
                              prev.includes(ch) ? prev.filter((x) => x !== ch) : [...prev, ch]
                            )
                          }
                        />
                        <span>{CHANNEL_META[ch].label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingTaskId(undefined);
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-600"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-700 text-white text-xs font-semibold rounded-lg hover:bg-emerald-800"
                >
                  שמור פרטים ותאריך (הפוך לירוק)
                </button>
              </div>
            </>
          )}
        </form>
      )}

      {/* פריסת תכנון משימות: סרגל ניווט בצד + סידור משימות בשני טורים כדי שהשורה לא תהיה רחבה מידי */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-start">
        {/* סרגל ניווט בצד למשימות ופרויקטים (4 עמודות) */}
        <aside className="sm:col-span-4 lg:col-span-3 bg-white border border-slate-300/90 rounded-xl p-4 space-y-4 sm:sticky sm:top-20">
          <div className="border-b border-slate-200 pb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <FolderKanban className="w-4 h-4 text-blue-800" />
              <span>סרגל ניווט משימות ופרויקטים</span>
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              סינון מהיר ומעבר בין פרויקטים כדי לשמור על שורות ממוקדות ונוחות לקריאה.
            </p>
          </div>

          {/* מתג תצוגת 2 טורים / טבלה */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setTaskDisplayMode('two_columns')}
              className={`flex-1 py-1.5 px-2 text-xs font-bold rounded-md transition-colors ${
                taskDisplayMode === 'two_columns'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              תצוגת שני טורים
            </button>
            <button
              type="button"
              onClick={() => setTaskDisplayMode('table')}
              className={`flex-1 py-1.5 px-2 text-xs font-bold rounded-md transition-colors ${
                taskDisplayMode === 'table'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              תצוגת טבלה
            </button>
          </div>

          {/* פירוט משימה שנבחרה בסרגל הצד */}
          {selectedTask && (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/90 space-y-2.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[11px] font-bold text-blue-800 block">
                    פירוט משימה שנבחרה:
                  </span>
                  <h4 className="text-sm font-bold text-slate-900 leading-snug mt-0.5">
                    {selectedTask.title}
                  </h4>
                </div>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => onToggleTaskCompleted(selectedTask)}
                    className="p-1 text-slate-700 hover:text-slate-900"
                    title={selectedTask.isCompleted ? 'סמן כלא בוצע' : 'סמן משימה כבוצעה'}
                  >
                    {selectedTask.isCompleted ? (
                      <CheckSquare className="w-4 h-4 text-emerald-700" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-500" />
                    )}
                  </button>
                )}
              </div>

              <div className="space-y-1.5 pt-1 border-t border-slate-200/80 text-slate-700">
                <div>
                  <span className="text-slate-500">תאריך יעד: </span>
                  <strong className="text-slate-900">
                    {selectedTask.hebrewDateStr || selectedTask.targetDate || 'פרויקט מתמשך'}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">אחראי: </span>
                  <strong className="text-slate-900">
                    {selectedTask.assignee || 'טרם הוגדר'}
                  </strong>{' '}
                  · משך: <strong>{selectedTask.durationDays} ימים</strong>
                </div>
                {selectedTask.strategicGoal && (
                  <div>
                    <span className="text-slate-500">מטרה אסטרטגית: </span>
                    <span className="text-slate-900">{selectedTask.strategicGoal}</span>
                  </div>
                )}
                {selectedTask.successCriteria && (
                  <div>
                    <span className="text-slate-500">מבחן הצלחה: </span>
                    <span className="text-slate-900">{selectedTask.successCriteria}</span>
                  </div>
                )}
                {cpmResult.schedules[selectedTask.id] && (
                  <div className="font-mono text-[11px] text-slate-600 pt-1">
                    התחלה מומלצת: {cpmResult.schedules[selectedTask.id].recommendedStartDate}
                    {cpmResult.schedules[selectedTask.id].isCritical ? ' · ★ במסלול קריטי' : ''}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <div className="text-[11px] font-bold text-slate-500 px-2 pb-1">סינון לפי מצב:</div>
            {[
              { id: 'all', label: 'כל המשימות והפרויקטים', count: rootTasks.length },
              {
                id: 'open',
                label: 'משימות פתוחות לביצוע',
                count: activeTasks.filter((t) => !t.isCompleted).length,
              },
              {
                id: 'critical',
                label: 'במסלול הקריטי (CPM)',
                count: cpmResult.criticalPathIds.length,
              },
              {
                id: 'completed',
                label: 'משימות שהושלמו',
                count: activeTasks.filter((t) => t.isCompleted).length,
              },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTaskSideFilter(item.id)}
                className={`w-full text-right px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors ${
                  taskSideFilter === item.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span>{item.label}</span>
                <span
                  className={`font-mono text-[11px] ${
                    taskSideFilter === item.id ? 'text-blue-200' : 'text-slate-500'
                  }`}
                >
                  {item.count}
                </span>
              </button>
            ))}
          </div>

          {rootTasks.length > 0 && (
            <div className="pt-3 border-t border-slate-200 space-y-1">
              <div className="text-[11px] font-bold text-slate-500 px-2 pb-1">
                ניווט מהיר לפי פרויקט / משימת אב:
              </div>
              <div className="max-h-72 overflow-y-auto space-y-1">
                {rootTasks.map((rt) => {
                  const subCount = activeTasks.filter((t) => t.parentId === rt.id).length;
                  return (
                    <button
                      key={rt.id}
                      type="button"
                      onClick={() => setTaskSideFilter(rt.id)}
                      className={`w-full text-right px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-between gap-2 transition-colors ${
                        taskSideFilter === rt.id
                          ? 'bg-slate-900 text-white font-bold'
                          : 'text-slate-800 hover:bg-slate-100'
                      }`}
                    >
                      <span className="truncate">{rt.title}</span>
                      <span
                        className={`shrink-0 text-[11px] font-mono ${
                          taskSideFilter === rt.id ? 'text-amber-300' : 'text-slate-500'
                        }`}
                      >
                        {subCount > 0 ? `+${subCount}` : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {canWrite && (
            <div className="pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={openNewTaskForm}
                className="w-full py-2 px-3 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>הוסף פרויקט / משימה חדשה</span>
              </button>
            </div>
          )}
        </aside>

        {/* אזור תוכן המשימות המרכזי (8-9 עמודות) */}
        <div className="sm:col-span-8 lg:col-span-9 space-y-4">
          {activeTasks.length === 0 ? (
            <div className="bg-white border border-slate-300/90 rounded-xl p-10 text-center space-y-3">
              <div className="text-base font-bold text-slate-900">
                טרם הוזנו משימות או פרויקטים במערכת
              </div>
              <p className="text-xs text-slate-600 max-w-md mx-auto">
                לחץ על &quot;משימה / פרויקט ראשי חדש&quot; כדי ליצור את עץ המשימות ותתי-המשימות עם תאריכי ביצוע בלוח העברי ותזכורות אוטומטיות.
              </p>
              {canWrite && (
                <button
                  type="button"
                  onClick={openNewTaskForm}
                  className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>צור משימה ראשונה</span>
                </button>
              )}
            </div>
          ) : taskDisplayMode === 'two_columns' ? (
            /* סידור המשימות בשני טורים מאוזנים — כל שורת משימה קומפקטית (רק כותרת וכפתורי עריכה) */
            <div className="grid grid-cols-2 gap-3.5 items-start">
              {rootTasks
                .filter((rt) => {
                  if (taskSideFilter === 'all') return true;
                  if (taskSideFilter === 'open') {
                    const hasOpenChild = activeTasks.some(
                      (c) => c.parentId === rt.id && !c.isCompleted
                    );
                    return !rt.isCompleted || hasOpenChild;
                  }
                  if (taskSideFilter === 'completed') {
                    const hasCompletedChild = activeTasks.some(
                      (c) => c.parentId === rt.id && c.isCompleted
                    );
                    return rt.isCompleted || hasCompletedChild;
                  }
                  if (taskSideFilter === 'critical') {
                    const isRootCrit = cpmResult.criticalPathIds.includes(rt.id);
                    const hasCritChild = activeTasks.some(
                      (c) => c.parentId === rt.id && cpmResult.criticalPathIds.includes(c.id)
                    );
                    return isRootCrit || hasCritChild;
                  }
                  return rt.id === taskSideFilter;
                })
                .map((rootTask) => {
                  const renderCompactTreeNode = (
                    node: TaskNodeRecord,
                    depth: number = 0
                  ): React.ReactNode => {
                    const children = activeTasks.filter((t) => t.parentId === node.id);
                    const nodeStatus = computeTaskReadinessStatus(node, children.length);
                    const sched = cpmResult.schedules[node.id];
                    const channels = parseTaskChannels(node.reminderChannelsJson);
                    const daysBefore = node.reminderDaysBefore ?? 2;
                    const isTaskSelected = selectedTask?.id === node.id;
                    const isTaskExpanded = expandedTaskIds.includes(node.id);

                    let deps: string[] = [];
                    try {
                      deps = JSON.parse(node.dependsOnIdsJson || '[]');
                    } catch {
                      deps = [];
                    }

                    return (
                      <div
                        key={node.id}
                        className={`${
                          depth > 0
                            ? 'mt-2.5 mr-4 pr-3 border-r-2 border-blue-300/80 space-y-2'
                            : 'space-y-2.5'
                        }`}
                      >
                        <div
                          onClick={() => setSelectedTaskId(node.id)}
                          className={`p-3 rounded-xl border transition-all cursor-pointer ${
                            isTaskSelected
                              ? 'bg-white border-slate-900 ring-2 ring-slate-900/10 shadow-xs'
                              : depth === 0
                              ? 'bg-white border-slate-300/90 hover:border-slate-400'
                              : 'bg-slate-50/90 border-slate-200/90 hover:border-slate-300'
                          }`}
                        >
                          {/* שורת תקציר בלבד: סימון ביצוע + מלוא הכותרת + כפתורי אייקון עם הסבר צף במעבר עכבר */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0 flex-1">
                              <div className="relative group/chk shrink-0 mt-0.5">
                                <button
                                  type="button"
                                  disabled={!canWrite}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleTaskCompleted(node);
                                  }}
                                  className="text-slate-700 hover:text-slate-900 flex items-center justify-center"
                                  aria-label={node.isCompleted ? 'סמן כלא בוצע' : 'סמן משימה כבוצעה'}
                                >
                                  {node.isCompleted ? (
                                    <CheckSquare className="w-4 h-4 text-emerald-700" />
                                  ) : (
                                    <Square className="w-4 h-4 text-slate-500" />
                                  )}
                                </button>
                                <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 hidden group-hover/chk:block whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-md z-30">
                                  {node.isCompleted ? 'סמן כלא בוצע' : 'סמן משימה כבוצעה'}
                                </span>
                              </div>
                              {/* נקודת סטטוס (אדום = כותרת בלבד, ירוק = הוגדרו תאריך/תתי-משימות בעריכה, כחול = הושלם) */}
                              <div className="relative group/status shrink-0 mt-1.5">
                                <span
                                  className={`block w-2.5 h-2.5 rounded-full ${
                                    nodeStatus === 'blue'
                                      ? 'bg-blue-600'
                                      : nodeStatus === 'green'
                                      ? 'bg-emerald-600'
                                      : 'bg-red-600'
                                  }`}
                                />
                                <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 hidden group-hover/status:block whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-md z-30">
                                  {nodeStatus === 'blue'
                                    ? 'כחול: הושלם'
                                    : nodeStatus === 'green'
                                    ? 'ירוק: מוכן (הוגדר תאריך או תתי-משימות)'
                                    : 'אדום: כותרת בלבד — לחץ על עריכה להוספת תאריך ותתי-משימות'}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTaskId(node.id);
                                  toggleExpandedTask(node.id);
                                }}
                                className="flex items-start gap-1.5 text-right min-w-0 flex-1"
                              >
                                {depth > 0 && (
                                  <span className="text-blue-700 font-bold text-xs shrink-0 mt-0.5">↳</span>
                                )}
                                {node.isProject && (
                                  <FolderKanban className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                                )}
                                <span
                                  className={`font-bold text-slate-900 text-sm leading-snug break-words ${
                                    node.isCompleted ? 'line-through text-slate-400' : ''
                                  }`}
                                >
                                  {node.title}
                                </span>
                              </button>
                            </div>

                            <div
                              className="flex items-center gap-1 shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {canWrite && (
                                <>
                                  <div className="relative group/btn">
                                    <button
                                      type="button"
                                      onClick={() => openEditTaskForm(node)}
                                      className="p-1.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors flex items-center justify-center"
                                      aria-label="עריכת משימה (הוספת תאריך, תתי-משימות ופרטים)"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/btn:block whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-md z-30">
                                      עריכת משימה (הוספת תאריך ופרטים לירוק)
                                    </span>
                                  </div>

                                  <div className="relative group/btn">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenAddSubtask(node)}
                                      className="p-1.5 bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors flex items-center justify-center"
                                      aria-label="הוסף תת-משימה"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/btn:block whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-md z-30">
                                      הוסף תת-משימה
                                    </span>
                                  </div>

                                  <div className="relative group/btn">
                                    <button
                                      type="button"
                                      onClick={() => onSoftDeleteTask(node.id)}
                                      className="p-1.5 text-red-600 hover:bg-red-50 border border-slate-200 bg-white rounded-md transition-colors flex items-center justify-center"
                                      aria-label="מחיקת משימה"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover/btn:block whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-md z-30">
                                      מחיקת משימה
                                    </span>
                                  </div>
                                </>
                              )}
                              <div className="relative group/btn">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedTaskId(node.id);
                                    toggleExpandedTask(node.id);
                                  }}
                                  className="p-1.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors flex items-center justify-center"
                                  aria-label={isTaskExpanded ? 'סגור פירוט משימה' : 'פתח פירוט משימה'}
                                >
                                  {isTaskExpanded ? (
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 hidden group-hover/btn:block whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-md z-30">
                                  {isTaskExpanded ? 'סגור פירוט משימה' : 'פתח פירוט משימה'}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* פירוט המשימה מופיע רק בפתיחת המשימה (או בסרגל הצד) */}
                          {isTaskExpanded && (
                            <div
                              className="mt-3 pt-2.5 border-t border-slate-200/80 space-y-2 text-xs"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {node.assignee && (
                                <div className="text-slate-600">
                                  אחראי: <strong>{node.assignee}</strong> · משך: {node.durationDays} ימים
                                </div>
                              )}
                              {node.strategicGoal && (
                                <div className="text-slate-700 leading-relaxed">
                                  <strong>מטרה:</strong> {node.strategicGoal}
                                </div>
                              )}
                              {node.successCriteria && (
                                <div className="text-slate-600 leading-relaxed">
                                  <strong>מבחן הצלחה:</strong> {node.successCriteria}
                                </div>
                              )}

                              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                <span className="font-bold text-slate-800 flex items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5 text-blue-800" />
                                  <span>תאריך ביצוע (עברי):</span>
                                </span>
                                <HebrewDatePicker
                                  compact
                                  disabled={!canWrite}
                                  allowClear
                                  clearLabel="ללא תאריך (פרויקט)"
                                  value={
                                    node.targetDate
                                      ? fromGregorianDate(node.targetDate).triplet
                                      : null
                                  }
                                  onChange={(_tr, conv) =>
                                    handleUpdateTaskExecutionDateAndReminders(
                                      node,
                                      conv.gregorianIso
                                    )
                                  }
                                  onClear={() =>
                                    handleUpdateTaskExecutionDateAndReminders(node, '')
                                  }
                                />
                              </div>

                              {/* ערוצי תזכורת ומועד שליחה */}
                              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                <div className="flex items-center gap-1 text-[11px]">
                                  <Bell className="w-3 h-3 text-amber-600" />
                                  <select
                                    disabled={!canWrite}
                                    value={daysBefore}
                                    onChange={(e) =>
                                      handleUpdateTaskExecutionDateAndReminders(
                                        node,
                                        node.targetDate || '',
                                        Number(e.target.value),
                                        channels
                                      )
                                    }
                                    className="px-1.5 py-0.5 text-[11px] border border-slate-300 rounded bg-white text-slate-800"
                                  >
                                    <option value={0}>תזכורת ביום הביצוע</option>
                                    <option value={1}>יום לפני + ביום הביצוע</option>
                                    <option value={2}>יומיים לפני + ביום הביצוע</option>
                                    <option value={3}>3 ימים לפני + ביום הביצוע</option>
                                    <option value={7}>שבוע לפני + ביום הביצוע</option>
                                  </select>
                                </div>

                                <div className="flex flex-wrap items-center gap-1">
                                  {ALL_CHANNELS.map((ch) => {
                                    const active = channels.includes(ch);
                                    const Icon = CHANNEL_META[ch].icon;
                                    return (
                                      <button
                                        key={ch}
                                        type="button"
                                        disabled={!canWrite}
                                        onClick={() => {
                                          const next = active
                                            ? channels.filter((c) => c !== ch)
                                            : [...channels, ch];
                                          handleUpdateTaskExecutionDateAndReminders(
                                            node,
                                            node.targetDate || '',
                                            daysBefore,
                                            next
                                          );
                                        }}
                                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 border transition-colors ${
                                          active
                                            ? 'bg-slate-900 text-white border-slate-900'
                                            : 'bg-white text-slate-500 border-slate-200'
                                        }`}
                                      >
                                        <Icon className="w-2.5 h-2.5" />
                                        <span>{CHANNEL_META[ch].label}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* CPM & Dependencies compact footer */}
                              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-600">
                                <div>
                                  {sched && (
                                    <span className="font-mono">
                                      התחלה מומלצת: {sched.recommendedStartDate}
                                      {sched.isCritical ? ' · ★ קריטי (CPM)' : ''}
                                    </span>
                                  )}
                                </div>
                                {deps.length > 0 && (
                                  <span>
                                    תלוי ב-{deps.length} משימות קודמות
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* טופס הוספת תת-משימה (+) מתחת לצומת הנוכחי */}
                          {addingSubtaskUnderId === node.id && canWrite && (
                            <form
                              onSubmit={(e) => handleConfirmAddSubtask(e, node)}
                              className="mt-3 pt-3 border-t border-amber-300 bg-amber-50/70 p-3 rounded-lg space-y-2.5"
                            >
                              <div className="text-xs font-bold text-slate-900 flex items-center justify-between">
                                <span>+ הוספת תת-משימה תחת &quot;{node.title}&quot;</span>
                                <button
                                  type="button"
                                  onClick={() => setAddingSubtaskUnderId(null)}
                                  className="text-slate-500 hover:text-slate-800"
                                >
                                  ✕
                                </button>
                              </div>
                              <input
                                type="text"
                                required
                                autoFocus
                                value={subtaskTitle}
                                onChange={(e) => setSubtaskTitle(e.target.value)}
                                placeholder="שם תת-המשימה..."
                                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                              />
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <HebrewDatePicker
                                  compact
                                  allowClear
                                  clearLabel="ללא תאריך (פרויקט)"
                                  value={
                                    subtaskTargetDate
                                      ? fromGregorianDate(subtaskTargetDate).triplet
                                      : null
                                  }
                                  onChange={(_tr, conv) => setSubtaskTargetDate(conv.gregorianIso)}
                                  onClear={() => setSubtaskTargetDate('')}
                                />
                                <input
                                  type="text"
                                  value={subtaskAssignee}
                                  onChange={(e) => setSubtaskAssignee(e.target.value)}
                                  placeholder="אחראי..."
                                  className="w-28 px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                                />
                                <button
                                  type="submit"
                                  className="px-3 py-1 bg-slate-900 text-white text-xs font-semibold rounded-lg"
                                >
                                  שמור +
                                </button>
                              </div>
                            </form>
                          )}
                        </div>

                        {/* תתי-משימות רקורסיביות */}
                        {children.map((child) => renderCompactTreeNode(child, depth + 1))}
                      </div>
                    );
                  };

                  return (
                    <div key={rootTask.id} className="space-y-2">
                      {renderCompactTreeNode(rootTask, 0)}
                    </div>
                  );
                })}
            </div>
          ) : (
            /* תצוגת טבלה מלאה */
            <div className="bg-white border border-slate-300/90 rounded-xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto max-h-[720px]">
                <table className="erp-table text-right">
                  <thead>
                    <tr className="text-xs font-semibold text-slate-700">
                      <th className="py-3.5 px-4 col-compact">ביצוע</th>
                      <th className="py-3.5 px-5 col-text-wide">עץ משימות ותתי-משימות (+ להוספה, מטרה ומבחן הצלחה)</th>
                      <th className="py-3.5 px-4 min-w-[310px]">תאריך ביצוע למשימה ותזכורות (מייל/מחשב/דשבורד/נייד)</th>
                      <th className="py-3.5 px-4 col-compact">משך (ימים)</th>
                      <th className="py-3.5 px-4 col-text-medium">תלויות קודמות (DAG)</th>
                      <th className="py-3.5 px-4 col-compact">המלצת התחלה ו-CPM</th>
                      <th className="py-3.5 px-4 text-left col-compact">פעולות</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/80 text-sm">
                    {rootTasks.map((rootTask) => renderTaskTreeRows(rootTask, 0))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
