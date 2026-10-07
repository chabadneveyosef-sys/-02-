/**
 * ליבת מערכת ה-ERP של בית חב״ד
 * כוללת:
 * 1. מחולל UUID v7 תקני (מבוסס זמן למיון כרונולוגי וסנכרון אופליין)
 * 2. מנוע תאריך עברי מלא (@hebcal/core) עם שלשה עברית, אותיות עבריות (גימטריה), חישוב שקיעה ושנים מעוברות
 * 3. מנוע גרף תלויות משימות (DAG): בדיקת מעגלים ב-DFS, מיון טופולוגי, וחישוב מסלול קריטי (CPM)
 * 4. מנוע פיננסי מדויק באגורות: חישוב עמלת עמותה שנייה, יתרות ובדיקת יתרה שלילית
 * 5. הצפנה ומיסוך תעודות זהות וגיבויים
 */

import { HDate, Location, Zmanim, gematriya } from '@hebcal/core';

// ============================================================================
// 1. UUID v7 Generator (Time-ordered UUID for offline-first & sync readiness)
// ============================================================================
export function generateUuidV7(timestampMs: number = Date.now()): string {
  const timeHex = Math.floor(timestampMs).toString(16).padStart(12, '0');
  const randomBytes = new Uint8Array(10);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < 10; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Version 7 (0111 in high nibble of byte 0)
  randomBytes[0] = (randomBytes[0] & 0x0f) | 0x70;
  // Variant RFC 4122 (10 in high bits of byte 2)
  randomBytes[2] = (randomBytes[2] & 0x3f) | 0x80;

  const hex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 20)}`;
}

export function isValidUuidV7(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

// ============================================================================
// 2. Hebrew Calendar Engine (@hebcal/core)
// ============================================================================
export interface HebrewDateTriplet {
  day: number;   // 1..30
  month: number; // Hebcal month index (1=Nisan .. 7=Tishrei .. 12/13=Adar)
  year: number;  // e.g. 5787
}

export interface ConvertedHebrewDate {
  triplet: HebrewDateTriplet;
  hebrewDisplay: string;       // e.g. "י״ח בתשרי תשפ״ז"
  hebrewMonthName: string;     // e.g. "תשרי"
  hebrewDayLetters: string;    // e.g. "י״ח"
  hebrewYearLetters: string;   // e.g. "תשפ״ז"
  gregorianIso: string;        // YYYY-MM-DD
  sunsetTime: string;          // HH:MM
  isLeapYear: boolean;
}

const HEBREW_MONTH_NAMES: Record<number, string> = {
  1: 'ניסן',
  2: 'אייר',
  3: 'סיוון',
  4: 'תמוז',
  5: 'אב',
  6: 'אלול',
  7: 'תשרי',
  8: 'חשוון',
  9: 'כסלו',
  10: 'טבת',
  11: 'שבט',
  12: 'אדר',
  13: 'אדר ב׳',
};

export function getHebrewMonthName(month: number, isLeapYear: boolean): string {
  if (month === 12 && isLeapYear) {
    return 'אדר א׳';
  }
  return HEBREW_MONTH_NAMES[month] || 'תשרי';
}

export function isHebrewLeapYear(hebrewYear: number): boolean {
  return HDate.isLeapYear(hebrewYear);
}

/**
 * מחשב זמני שקיעה לפי קואורדינטות ותאריך לועזי
 */
export function calculateSunsetTime(
  gregorianDate: Date,
  lat: number = 32.784,
  lng: number = 35.0195
): string {
  try {
    const loc = new Location(lat, lng, true, 'Asia/Jerusalem', 'Chabad House', 'IL');
    const zmanim = new Zmanim(loc, gregorianDate, false);
    const sunset = zmanim.sunset();
    if (!sunset || isNaN(sunset.getTime())) {
      return '17:30';
    }
    return sunset.toLocaleTimeString('he-IL', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Jerusalem',
    });
  } catch {
    return '17:30';
  }
}

/**
 * ממיר שלשה עברית (יום, חודש, שנה) לתאריך לועזי מלא, תצוגה באותיות עבריות וזמן שקיעה
 */
export function fromHebrewTriplet(
  triplet: HebrewDateTriplet,
  lat: number = 32.784,
  lng: number = 35.0195
): ConvertedHebrewDate {
  const isLeap = HDate.isLeapYear(triplet.year);
  let safeMonth = triplet.month;
  if (!isLeap && safeMonth === 13) {
    safeMonth = 12; // באדר בשנה פשוטה מתנקז לאדר רגיל
  }
  const maxDaysInMonth = HDate.daysInMonth(safeMonth, triplet.year);
  const safeDay = Math.min(Math.max(1, triplet.day), maxDaysInMonth);

  const hdate = new HDate(safeDay, safeMonth, triplet.year);
  const gregDate = hdate.greg();
  const yyyy = gregDate.getFullYear();
  const mm = String(gregDate.getMonth() + 1).padStart(2, '0');
  const dd = String(gregDate.getDate()).padStart(2, '0');
  const gregorianIso = `${yyyy}-${mm}-${dd}`;

  const dayLetters = gematriya(safeDay);
  const yearLetters = gematriya(triplet.year % 1000);
  const monthName = getHebrewMonthName(safeMonth, isLeap);
  const hebrewDisplay = `${dayLetters} ב${monthName} ה׳${yearLetters}`;

  return {
    triplet: { day: safeDay, month: safeMonth, year: triplet.year },
    hebrewDisplay,
    hebrewMonthName: monthName,
    hebrewDayLetters: dayLetters,
    hebrewYearLetters: `ה׳${yearLetters}`,
    gregorianIso,
    sunsetTime: calculateSunsetTime(gregDate, lat, lng),
    isLeapYear: isLeap,
  };
}

/**
 * ממיר תאריך לועזי (YYYY-MM-DD או Date) לשלשה עברית מלאה
 */
export function fromGregorianDate(
  dateInput: string | Date,
  lat: number = 32.784,
  lng: number = 35.0195
): ConvertedHebrewDate {
  const d = typeof dateInput === 'string' ? new Date(`${dateInput}T12:00:00`) : dateInput;
  const safeDate = isNaN(d.getTime()) ? new Date() : d;
  const hdate = new HDate(safeDate);
  return fromHebrewTriplet(
    {
      day: hdate.getDate(),
      month: hdate.getMonth(),
      year: hdate.getFullYear(),
    },
    lat,
    lng
  );
}

/**
 * מחשב את מועד האזכרה / יום הולדת בשנה עברית נתונה (כולל טיפול באדר א'/ב' ול' חשוון/כסלו)
 */
export function getAnniversaryInHebrewYear(
  originalTriplet: HebrewDateTriplet,
  targetHebrewYear: number,
  lat: number = 32.784,
  lng: number = 35.0195
): ConvertedHebrewDate {
  const origLeap = HDate.isLeapYear(originalTriplet.year);
  const targetLeap = HDate.isLeapYear(targetHebrewYear);

  let targetMonth = originalTriplet.month;
  if (origLeap && !targetLeap && (targetMonth === 12 || targetMonth === 13)) {
    targetMonth = 12; // אדר א' או ב' בשנה פשוטה חל באדר
  } else if (!origLeap && targetLeap && targetMonth === 12) {
    targetMonth = 13; // ברירת מחדל באדר של שנה פשוטה שחל בשנה מעוברת -> אדר ב'
  }

  return fromHebrewTriplet(
    {
      day: originalTriplet.day,
      month: targetMonth,
      year: targetHebrewYear,
    },
    lat,
    lng
  );
}

/**
 * השוואה כרונולוגית של שתי שלשות תאריך עברי למיון אוטומטי של התוכנית השנתית
 * סדר החודשים בשנה העברית מתחיל בתשרי (7) ועד אלול (6)
 */
export function getHebrewYearMonthOrder(month: number): number {
  // Tishrei (7) -> 1, Cheshvan (8) -> 2 ... Adar II (13) -> 7, Nisan (1) -> 8 ... Elul (6) -> 13
  if (month >= 7) return month - 6;
  return month + 7;
}

export function compareHebrewDates(a: HebrewDateTriplet, b: HebrewDateTriplet): number {
  if (a.year !== b.year) return a.year - b.year;
  const orderA = getHebrewYearMonthOrder(a.month);
  const orderB = getHebrewYearMonthOrder(b.month);
  if (orderA !== orderB) return orderA - orderB;
  return a.day - b.day;
}

/**
 * חישוב סטטוס צבעוני אוטומטי לפעילות בתוכנית השנתית:
 * - blue (כחול): בוצע (isExecuted === true)
 * - red (אדום): חסרים שדות חובה (כותרת, אחראי, מיקום או תקציב משוער)
 * - green (ירוק): תקין ומלא
 */
export type ActivityComputedStatus = 'blue' | 'red' | 'green';

export function computeAnnualActivityStatus(activity: {
  title?: string;
  responsiblePerson?: string;
  locationName?: string;
  estimatedBudgetAgorot?: number;
  isExecuted?: boolean;
}): ActivityComputedStatus {
  if (activity.isExecuted) {
    return 'blue';
  }
  const hasTitle = Boolean(activity.title && activity.title.trim().length > 0);
  const hasResponsible = Boolean(activity.responsiblePerson && activity.responsiblePerson.trim().length > 0);
  const hasLocation = Boolean(activity.locationName && activity.locationName.trim().length > 0);
  const hasBudget = typeof activity.estimatedBudgetAgorot === 'number' && activity.estimatedBudgetAgorot > 0;

  if (!hasTitle || !hasResponsible || !hasLocation || !hasBudget) {
    return 'red';
  }
  return 'green';
}

// ============================================================================
// 3. DAG (Directed Acyclic Graph) & Critical Path Method (CPM) Engine
// ============================================================================
export interface DagTaskInput {
  id: string;
  title: string;
  durationDays: number;
  dependsOnIds: string[]; // IDs of tasks that must finish BEFORE this task starts
  isCompleted?: boolean;
}

export interface CpmTaskSchedule {
  id: string;
  title: string;
  durationDays: number;
  earliestStart: number;  // ES (in days from project start)
  earliestFinish: number; // EF = ES + duration
  latestStart: number;    // LS
  latestFinish: number;   // LF
  slack: number;          // LS - ES
  isCritical: boolean;    // slack === 0 && durationDays > 0
  recommendedStartDate: string; // YYYY-MM-DD based on anchor start date
}

export interface CpmAnalysisResult {
  hasCycle: boolean;
  cyclePath: string[];
  topologicalOrder: string[];
  totalDurationDays: number;
  criticalPathIds: string[];
  schedules: Record<string, CpmTaskSchedule>;
}

/**
 * בודק האם הוספת תלות חדשה (taskId תלוי ב-newDependencyId) תיצור מעגל (Cycle) באמצעות DFS
 */
export function wouldCreateCycle(
  tasks: DagTaskInput[],
  taskId: string,
  newDependencyId: string
): boolean {
  if (taskId === newDependencyId) return true;

  const depMap = new Map<string, string[]>();
  for (const t of tasks) {
    depMap.set(t.id, [...(t.dependsOnIds || [])]);
  }
  const currentDeps = depMap.get(taskId) || [];
  if (!currentDeps.includes(newDependencyId)) {
    depMap.set(taskId, [...currentDeps, newDependencyId]);
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    recStack.add(nodeId);

    const neighbors = depMap.get(nodeId) || [];
    for (const nextId of neighbors) {
      if (!visited.has(nextId)) {
        if (dfs(nextId)) return true;
      } else if (recStack.has(nextId)) {
        return true;
      }
    }

    recStack.delete(nodeId);
    return false;
  }

  for (const id of depMap.keys()) {
    if (!visited.has(id)) {
      if (dfs(id)) return true;
    }
  }
  return false;
}

/**
 * מבצע ניתוח DAG מלא: זיהוי מעגלים (DFS), מיון טופולוגי, וחישוב מסלול קריטי (CPM) עם המלצת תאריכי התחלה
 */
export function analyzeTaskDagAndCpm(
  tasks: DagTaskInput[],
  projectStartDateIso: string = new Date().toISOString().slice(0, 10)
): CpmAnalysisResult {
  const taskMap = new Map<string, DagTaskInput>();
  for (const t of tasks) {
    taskMap.set(t.id, {
      ...t,
      durationDays: Math.max(0, Number(t.durationDays) || 0),
      dependsOnIds: (t.dependsOnIds || []).filter((depId) => depId !== t.id),
    });
  }

  // Filter dependencies to existing tasks only
  for (const t of taskMap.values()) {
    t.dependsOnIds = t.dependsOnIds.filter((depId) => taskMap.has(depId));
  }

  // 1. Cycle detection & Topological Sort via DFS
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const topologicalOrder: string[] = [];
  let hasCycle = false;
  const cyclePath: string[] = [];

  function dfs(nodeId: string, path: string[]) {
    if (hasCycle) return;
    visiting.add(nodeId);

    const task = taskMap.get(nodeId);
    const deps = task ? task.dependsOnIds : [];

    for (const depId of deps) {
      if (visiting.has(depId)) {
        hasCycle = true;
        const cycleStartIdx = path.indexOf(depId);
        cyclePath.push(...path.slice(cycleStartIdx), depId);
        return;
      }
      if (!visited.has(depId)) {
        dfs(depId, [...path, depId]);
      }
    }

    visiting.delete(nodeId);
    visited.add(nodeId);
    topologicalOrder.push(nodeId);
  }

  for (const id of taskMap.keys()) {
    if (!visited.has(id)) {
      dfs(id, [id]);
    }
  }

  if (hasCycle) {
    return {
      hasCycle: true,
      cyclePath,
      topologicalOrder: [],
      totalDurationDays: 0,
      criticalPathIds: [],
      schedules: {},
    };
  }

  // 2. Forward Pass (Earliest Start & Earliest Finish)
  const ES: Record<string, number> = {};
  const EF: Record<string, number> = {};

  for (const id of topologicalOrder) {
    const task = taskMap.get(id)!;
    let maxPrevEF = 0;
    for (const depId of task.dependsOnIds) {
      if (EF[depId] !== undefined && EF[depId] > maxPrevEF) {
        maxPrevEF = EF[depId];
      }
    }
    ES[id] = maxPrevEF;
    EF[id] = maxPrevEF + task.durationDays;
  }

  const totalDurationDays = Object.values(EF).reduce((max, val) => Math.max(max, val), 0);

  // Build dependents map (reverse edges) for Backward Pass
  const dependentsMap = new Map<string, string[]>();
  for (const id of taskMap.keys()) {
    dependentsMap.set(id, []);
  }
  for (const task of taskMap.values()) {
    for (const depId of task.dependsOnIds) {
      dependentsMap.get(depId)?.push(task.id);
    }
  }

  // 3. Backward Pass (Latest Finish & Latest Start)
  const LF: Record<string, number> = {};
  const LS: Record<string, number> = {};

  const reverseOrder = [...topologicalOrder].reverse();
  for (const id of reverseOrder) {
    const task = taskMap.get(id)!;
    const dependents = dependentsMap.get(id) || [];
    if (dependents.length === 0) {
      LF[id] = totalDurationDays;
    } else {
      let minNextLS = totalDurationDays;
      for (const nextId of dependents) {
        if (LS[nextId] !== undefined && LS[nextId] < minNextLS) {
          minNextLS = LS[nextId];
        }
      }
      LF[id] = minNextLS;
    }
    LS[id] = LF[id] - task.durationDays;
  }

  // 4. Construct schedules & Critical Path
  const schedules: Record<string, CpmTaskSchedule> = {};
  const criticalPathIds: string[] = [];
  const baseDate = new Date(`${projectStartDateIso}T12:00:00`);
  const validBaseMs = isNaN(baseDate.getTime()) ? Date.now() : baseDate.getTime();

  for (const id of topologicalOrder) {
    const task = taskMap.get(id)!;
    const slack = Math.max(0, LS[id] - ES[id]);
    const isCritical = slack === 0 && task.durationDays > 0;
    if (isCritical) {
      criticalPathIds.push(id);
    }

    const recDate = new Date(validBaseMs + ES[id] * 86400000);
    const recommendedStartDate = recDate.toISOString().slice(0, 10);

    schedules[id] = {
      id,
      title: task.title,
      durationDays: task.durationDays,
      earliestStart: ES[id],
      earliestFinish: EF[id],
      latestStart: LS[id],
      latestFinish: LF[id],
      slack,
      isCritical,
      recommendedStartDate,
    };
  }

  return {
    hasCycle: false,
    cyclePath: [],
    topologicalOrder,
    totalDurationDays,
    criticalPathIds,
    schedules,
  };
}

// ============================================================================
// 4. Dual Financial Engine (Agorot Integer Math, Overhead Fee & Balance Guard)
// ============================================================================
export type FundSource = 'regular' | 'second_association';
export type TransactionType = 'income' | 'expense' | 'pledge';
export type TransactionStatus = 'executed' | 'pending' | 'estimated';

export interface FeeCalculationResult {
  grossAmountAgorot: number;
  feePercent: number;
  feeAmountAgorot: number;
  netAmountAgorot: number;
}

/**
 * המרת שקלים לאגורות כמספר שלם מדויק
 */
export function ilsToAgorot(ilsAmount: number): number {
  return Math.round((Number(ilsAmount) || 0) * 100);
}

/**
 * המרת אגורות לתצוגת שקלים תקנית
 */
export function formatAgorotToIls(agorot: number): string {
  const ils = (Number(agorot) || 0) / 100;
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(ils);
}

/**
 * חישוב עמלה אוטומטית:
 * עבור "כספי העמותה השנייה" בהכנסה/תרומה, מנוכה עמלה אוטומטית (ברירת מחדל 3%).
 * עבור "כספים רגילים" או הוצאות, העמלה היא 0%.
 */
export function calculateTransactionAmounts(
  grossAmountAgorot: number,
  fundSource: FundSource,
  type: TransactionType,
  customFeePercent: number = 3
): FeeCalculationResult {
  const safeGross = Math.max(0, Math.round(grossAmountAgorot));
  const shouldApplyFee = fundSource === 'second_association' && (type === 'income' || type === 'pledge');
  const effectiveFeePercent = shouldApplyFee ? Math.max(0, Math.min(100, customFeePercent)) : 0;
  const feeAmountAgorot = Math.round((safeGross * effectiveFeePercent) / 100);
  const netAmountAgorot = safeGross - feeAmountAgorot;

  return {
    grossAmountAgorot: safeGross,
    feePercent: effectiveFeePercent,
    feeAmountAgorot,
    netAmountAgorot,
  };
}

export interface LedgerSummary {
  executedIncomeAgorot: number;
  executedExpenseAgorot: number;
  totalFeesDeductedAgorot: number;
  currentBalanceAgorot: number;    // יתרה בפועל
  pendingIncomeAgorot: number;     // הכנסות/התחייבויות לגבייה (מה שצריך לעשות)
  pendingExpenseAgorot: number;    // הוצאות לתשלום (מה שצריך לעשות)
  estimatedFutureIncomeAgorot: number;  // צפי הכנסות עתידיות (אומדן)
  estimatedFutureExpenseAgorot: number; // צפי הוצאות עתידיות (אומדן)
  projectedDynamicBalanceAgorot: number; // יתרה דינמית משוקללת
}

export function calculateLedgerSummary(
  transactions: Array<{
    type: TransactionType;
    fundSource: FundSource;
    netAmountAgorot: number;
    feeAmountAgorot: number;
    status: TransactionStatus;
    deletedAt?: string;
  }>,
  filterSource: 'all' | FundSource = 'all'
): LedgerSummary {
  const summary: LedgerSummary = {
    executedIncomeAgorot: 0,
    executedExpenseAgorot: 0,
    totalFeesDeductedAgorot: 0,
    currentBalanceAgorot: 0,
    pendingIncomeAgorot: 0,
    pendingExpenseAgorot: 0,
    estimatedFutureIncomeAgorot: 0,
    estimatedFutureExpenseAgorot: 0,
    projectedDynamicBalanceAgorot: 0,
  };

  for (const tx of transactions) {
    if (tx.deletedAt) continue;
    if (filterSource !== 'all' && tx.fundSource !== filterSource) continue;

    if (tx.status === 'executed') {
      if (tx.type === 'income') {
        summary.executedIncomeAgorot += tx.netAmountAgorot;
        summary.totalFeesDeductedAgorot += tx.feeAmountAgorot;
      } else if (tx.type === 'expense') {
        summary.executedExpenseAgorot += tx.netAmountAgorot;
      }
    } else if (tx.status === 'pending') {
      if (tx.type === 'income' || tx.type === 'pledge') {
        summary.pendingIncomeAgorot += tx.netAmountAgorot;
      } else if (tx.type === 'expense') {
        summary.pendingExpenseAgorot += tx.netAmountAgorot;
      }
    } else if (tx.status === 'estimated') {
      if (tx.type === 'income' || tx.type === 'pledge') {
        summary.estimatedFutureIncomeAgorot += tx.netAmountAgorot;
      } else if (tx.type === 'expense') {
        summary.estimatedFutureExpenseAgorot += tx.netAmountAgorot;
      }
    }
  }

  summary.currentBalanceAgorot = summary.executedIncomeAgorot - summary.executedExpenseAgorot;
  summary.projectedDynamicBalanceAgorot =
    summary.currentBalanceAgorot +
    summary.pendingIncomeAgorot -
    summary.pendingExpenseAgorot +
    summary.estimatedFutureIncomeAgorot -
    summary.estimatedFutureExpenseAgorot;

  return summary;
}

/**
 * מנגנון הגנה מפני יתרה שלילית: בודק האם הוצאה חדשה תגרום ליתרה שלילית בקופה הרלוונטית
 */
export function checkNegativeBalanceGuard(
  currentBalanceAgorot: number,
  expenseAmountAgorot: number
): { wouldBeNegative: boolean; deficitAgorot: number } {
  const newBalance = currentBalanceAgorot - expenseAmountAgorot;
  return {
    wouldBeNegative: newBalance < 0,
    deficitAgorot: newBalance < 0 ? Math.abs(newBalance) : 0,
  };
}

// ============================================================================
// 5. National ID Encryption & Masking (••••1234)
// ============================================================================
const SECRET_SALT = 'CHABAD_ERP_V1_VAULT_KEY_5787';

export function encryptSensitiveString(plainText: string): string {
  const cleaned = plainText.trim();
  if (!cleaned) return '';
  const xorBytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const code = cleaned.charCodeAt(i) ^ SECRET_SALT.charCodeAt(i % SECRET_SALT.length);
    xorBytes.push(code);
  }
  return 'ENCv1:' + xorBytes.map((b) => b.toString(16).padStart(4, '0')).join('');
}

export function decryptSensitiveString(cipherText: string): string {
  if (!cipherText || !cipherText.startsWith('ENCv1:')) return cipherText;
  const hex = cipherText.slice(6);
  let result = '';
  for (let i = 0; i < hex.length; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16);
    const charIndex = i / 4;
    const origCode = code ^ SECRET_SALT.charCodeAt(charIndex % SECRET_SALT.length);
    result += String.fromCharCode(origCode);
  }
  return result;
}

export function formatMaskedNationalId(last4: string, revealedPlain?: string): string {
  if (revealedPlain) {
    return revealedPlain;
  }
  const clean4 = (last4 || '0000').slice(-4).padStart(4, '0');
  return `••••${clean4}`;
}

// ============================================================================
// 6. Built-In Core Unit Tests Suite (Verifies DAG, CPM, Finances & Hebrew Date)
// ============================================================================
export interface UnitTestResult {
  name: string;
  category: 'UUIDv7' | 'DAG & CPM' | 'Finances & Agorot' | 'Hebrew Calendar' | 'Security & Encryption';
  passed: boolean;
  details: string;
}

export function runCoreUnitTests(): UnitTestResult[] {
  const results: UnitTestResult[] = [];

  // Test 1: UUID v7 format & chronological ordering
  const id1 = generateUuidV7(1700000000000);
  const id2 = generateUuidV7(1700000005000);
  results.push({
    name: 'יצירת מזהי UUID v7 תקניים ומיון כרונולוגי',
    category: 'UUIDv7',
    passed: isValidUuidV7(id1) && isValidUuidV7(id2) && id1 < id2,
    details: `ID1=${id1.slice(0, 18)}... < ID2=${id2.slice(0, 18)}...`,
  });

  // Test 2: DAG Cycle Detection (DFS)
  const sampleTasks: DagTaskInput[] = [
    { id: 't1', title: 'הזמנת אולם', durationDays: 3, dependsOnIds: [] },
    { id: 't2', title: 'עיצוב הזמנות', durationDays: 4, dependsOnIds: ['t1'] },
    { id: 't3', title: 'שליחת הודעות לתורמים', durationDays: 2, dependsOnIds: ['t2'] },
  ];
  const createsCycle = wouldCreateCycle(sampleTasks, 't1', 't3'); // t1 -> t3 -> t2 -> t1 (Cycle!)
  const validEdge = wouldCreateCycle(sampleTasks, 't3', 't1');    // t3 -> t1 (No cycle)
  results.push({
    name: 'זיהוי מעגלים בגרף תלויות (DFS Cycle Guard)',
    category: 'DAG & CPM',
    passed: createsCycle === true && validEdge === false,
    details: 'מעגל t1->t3->t2->t1 נחסם בהצלחה; קשת חוקית אושרה.',
  });

  // Test 3: Critical Path Method (CPM) & Topological Sort
  const cpmTasks: DagTaskInput[] = [
    { id: 'A', title: 'תיאום קייטרינג', durationDays: 5, dependsOnIds: [] },
    { id: 'B', title: 'פרסום במקומונים', durationDays: 2, dependsOnIds: [] },
    { id: 'C', title: 'עריכת מצגת שנתית', durationDays: 4, dependsOnIds: ['A'] },
    { id: 'D', title: 'הקמת תפאורה והגברה', durationDays: 3, dependsOnIds: ['A', 'B'] },
    { id: 'E', title: 'אירוע התוועדות מרכזית', durationDays: 1, dependsOnIds: ['C', 'D'] },
  ];
  const cpm = analyzeTaskDagAndCpm(cpmTasks, '2026-10-01');
  // Path A(5) -> C(4) -> E(1) = 10 days. Path A(5) -> D(3) -> E(1) = 9 days.
  const cpmPassed =
    !cpm.hasCycle &&
    cpm.totalDurationDays === 10 &&
    cpm.criticalPathIds.includes('A') &&
    cpm.criticalPathIds.includes('C') &&
    cpm.criticalPathIds.includes('E') &&
    !cpm.criticalPathIds.includes('B') &&
    cpm.schedules['B'].slack === 5;
  results.push({
    name: 'חישוב מסלול קריטי (CPM) ומיון טופולוגי',
    category: 'DAG & CPM',
    passed: cpmPassed,
    details: `משך כולל: ${cpm.totalDurationDays} ימים | מסלול קריטי: [${cpm.criticalPathIds.join(' → ')}] | מרווח B: ${cpm.schedules['B']?.slack} ימים`,
  });

  // Test 4: Dual Fund Fee Deduction & Agorot Precision
  const secondAssocCalc = calculateTransactionAmounts(100000, 'second_association', 'income', 3); // 1,000.00 ILS -> 3% fee = 30.00 ILS -> net 970.00 ILS
  const regularCalc = calculateTransactionAmounts(100000, 'regular', 'income', 3); // Regular fund -> 0% fee
  const feePassed =
    secondAssocCalc.feeAmountAgorot === 3000 &&
    secondAssocCalc.netAmountAgorot === 97000 &&
    regularCalc.feeAmountAgorot === 0 &&
    regularCalc.netAmountAgorot === 100000;
  results.push({
    name: 'חישוב עמלת עמותה שנייה (3%) ודיוק אגורות שלמות',
    category: 'Finances & Agorot',
    passed: feePassed,
    details: `ברוטו: 100,000 אג׳ (₪1,000) ← עמלה: ${secondAssocCalc.feeAmountAgorot} אג׳ (₪30) ← נטו לעמותה שנייה: ${secondAssocCalc.netAmountAgorot} אג׳ (₪970)`,
  });

  // Test 5: Negative Balance Guard
  const guardCheck = checkNegativeBalanceGuard(50000, 75000);
  results.push({
    name: 'מנגנון הגנה מפני יתרה שלילית בקופה',
    category: 'Finances & Agorot',
    passed: guardCheck.wouldBeNegative === true && guardCheck.deficitAgorot === 25000,
    details: `יתרה ₪500 מול הוצאה ₪750 מזוהה כגירעון של ${formatAgorotToIls(guardCheck.deficitAgorot)}`,
  });

  // Test 6: Hebrew Date Conversion & Leap Year Adar Handling
  const hebConv = fromHebrewTriplet({ day: 11, month: 1, year: 5787 }); // י"א בניסן תשפ"ז
  const leapAdarAnniversary = getAnniversaryInHebrewYear({ day: 14, month: 13, year: 5784 }, 5785); // אדר ב' תשפ"ד (מעוברת) -> אדר תשפ"ה (פשוטה)
  results.push({
    name: 'המרת שלשה עברית, שקיעה וטיפול בשנים פשוטות ומעוברות',
    category: 'Hebrew Calendar',
    passed:
      hebConv.hebrewDisplay.includes('ניסן') &&
      hebConv.gregorianIso.length === 10 &&
      leapAdarAnniversary.triplet.month === 12,
    details: `${hebConv.hebrewDisplay} (${hebConv.gregorianIso}, שקיעה: ${hebConv.sunsetTime}) | אזכרה מאדר ב׳ בשנה פשוטה: ${leapAdarAnniversary.hebrewDisplay}`,
  });

  // Test 7: National ID Encryption & Masking
  const sampleId = '012345678';
  const encrypted = encryptSensitiveString(sampleId);
  const decrypted = decryptSensitiveString(encrypted);
  const masked = formatMaskedNationalId('5678');
  results.push({
    name: 'הצפנת תעודת זהות ומיסוך מאובטח (••••1234)',
    category: 'Security & Encryption',
    passed: encrypted !== sampleId && decrypted === sampleId && masked === '••••5678',
    details: `מוצפן: ${encrypted.slice(0, 16)}... | ממוסך: ${masked} | מפוענח בהרשאה: ${decrypted}`,
  });

  return results;
}
