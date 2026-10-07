import {
  generateUuidV7,
  fromHebrewTriplet,
  calculateTransactionAmounts,
  encryptSensitiveString,
} from './erp-core';
import {
  AnnualActivityRecord,
  TaskNodeRecord,
  DynamicTemplateRecord,
  FinancialTransactionRecord,
  DonorContactRecord,
  VolunteerEntityRecord,
} from '../types/erp';

export function buildSeedTemplates(): DynamicTemplateRecord[] {
  const now = new Date().toISOString();
  const id1 = generateUuidV7(Date.now() - 60000);
  const id2 = generateUuidV7(Date.now() - 50000);

  return [
    {
      id: id1,
      name: 'תבנית התוועדות מרכזית',
      category: 'התוועדות',
      schemaJson: JSON.stringify([
        { key: 'guestSpeaker', label: 'משפיע / מרצה אורח', type: 'text', required: true },
        { key: 'expectedParticipants', label: 'צפי משתתפים', type: 'number', required: true },
        { key: 'cateringProvider', label: 'ספק קייטרינג / כיבוד', type: 'text', required: true },
        { key: 'musicalAccompaniment', label: 'ליווי מוזיקלי / ניגונים', type: 'boolean' },
        { key: 'hallSetupType', label: 'סידור שולחנות', type: 'select', options: ['שולחנות עגולים', 'שורות ספסלים', 'בופה עמידה'] },
      ]),
      defaultTasksJson: JSON.stringify([
        { title: 'תיאום משפיע אורח וסגירת תאריך', durationDays: 5 },
        { title: 'הזמנת אולם וקייטרינג בשרי', durationDays: 4 },
        { title: 'עיצוב מודעה והפצה בקבוצות הקהילה', durationDays: 3 },
        { title: 'טלפונים אישיים לתורמים ומקורבים', durationDays: 2 },
        { title: 'עריכת שולחנות והגברה ביום האירוע', durationDays: 1 },
      ]),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: id2,
      name: 'תבנית כללית לפעילות שיא / חג',
      category: 'אירוע קהילתי',
      schemaJson: JSON.stringify([
        { key: 'targetAudience', label: 'קהל יעד מרכזי', type: 'select', options: ['כלל הקהילה', 'משפחות וילדים', 'נוער', 'גמלאים'], required: true },
        { key: 'kitsCount', label: 'כמות ערכות / משלוחים לחלוקה', type: 'number', required: true },
        { key: 'securityRequired', label: 'נדרש אישור אבטחה / עירייה', type: 'boolean' },
      ]),
      defaultTasksJson: JSON.stringify([
        { title: 'רכישת ציוד וערכות חג ממרכז ההפצה', durationDays: 7 },
        { title: 'גיוס ושיבוץ מתנדבים לחלוקה לפי רחובות', durationDays: 4 },
        { title: 'אריזת ערכות בבית חב״ד', durationDays: 2 },
      ]),
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function buildSeedAnnualActivities(templates: DynamicTemplateRecord[]): AnnualActivityRecord[] {
  const now = new Date().toISOString();
  const farbrengenTemplateId = templates[0]?.id || '';
  const generalTemplateId = templates[1]?.id || '';

  const items: Array<{
    title: string;
    category: string;
    day: number;
    month: number;
    year: number;
    locationName: string;
    responsiblePerson: string;
    budgetAgorot: number;
    isExecuted: boolean;
    templateId: string;
    customFields: Record<string, unknown>;
    notes: string;
  }> = [
    {
      title: 'מבצע שופר ותפילות ראש השנה בקהילה',
      category: 'חגי תשרי',
      day: 1,
      month: 7, // תשרי
      year: 5787,
      locationName: 'בית חב״ד המרכזי ופארק השכונה',
      responsiblePerson: 'הרב מנחם כהן',
      budgetAgorot: 850000, // 8,500 ILS
      isExecuted: true,
      templateId: generalTemplateId,
      customFields: { targetAudience: 'כלל הקהילה', kitsCount: 250, securityRequired: true },
      notes: 'כולל 8 מוקדי תקיעת שופר בגינות הציבוריות',
    },
    {
      title: 'התוועדות י״ט כסלו — חג הגאולה וראש השנה לחסידות',
      category: 'התוועדות',
      day: 19,
      month: 9, // כסלו
      year: 5787,
      locationName: 'אולם האירועים השכונתי',
      responsiblePerson: 'הרב מנחם כהן',
      budgetAgorot: 1400000, // 14,000 ILS
      isExecuted: false,
      templateId: farbrengenTemplateId,
      customFields: {
        guestSpeaker: 'הרב יוסף יצחק לוי',
        expectedParticipants: 180,
        cateringProvider: 'קייטרינג גורמה כשר',
        musicalAccompaniment: true,
        hallSetupType: 'שולחנות עגולים',
      },
      notes: 'חלוקת ספרי תניא חדשים למשתתפים',
    },
    {
      title: 'מבצע חנוכה — הדלקות מרכזיות וחלוקת סופגניות',
      category: 'אירוע קהילתי',
      day: 25,
      month: 9, // כסלו
      year: 5787,
      locationName: 'מרכז מסחרי נווה יוסף',
      responsiblePerson: 'שניאור זלמן לוי',
      budgetAgorot: 1200000, // 12,000 ILS
      isExecuted: false,
      templateId: generalTemplateId,
      customFields: { targetAudience: 'משפחות וילדים', kitsCount: 500, securityRequired: true },
      notes: 'הדלקת חנוכיית ענק מדי ערב בשעה 18:00',
    },
    {
      title: 'התוועדות י״א ניסן — יום הולדת הרבי',
      category: 'התוועדות',
      day: 11,
      month: 1, // ניסן
      year: 5787,
      locationName: '', // חסר מיקום בכוונה כדי להציג סטטוס אדום (חסרים שדות חובה)
      responsiblePerson: '',
      budgetAgorot: 0,
      isExecuted: false,
      templateId: farbrengenTemplateId,
      customFields: { expectedParticipants: 120 },
      notes: 'יש להשלים שיבוץ אחראי, תקציב ואולם (מוצג באדום להשלמה)',
    },
    {
      title: 'סדר פסח קהילתי מרכזי וחלוקת מצות שמורה',
      category: 'אירוע קהילתי',
      day: 15,
      month: 1, // ניסן
      year: 5787,
      locationName: 'אולם בית חב״ד המרכזי',
      responsiblePerson: 'הרב מנחם כהן',
      budgetAgorot: 3200000, // 32,000 ILS
      isExecuted: false,
      templateId: generalTemplateId,
      customFields: { targetAudience: 'כלל הקהילה', kitsCount: 400, securityRequired: true },
      notes: 'סבסוד מיוחד לקשישים ולמשפחות ברוכות ילדים',
    },
  ];

  return items.map((item, idx) => {
    const conv = fromHebrewTriplet({ day: item.day, month: item.month, year: item.year });
    return {
      id: generateUuidV7(Date.now() - (40000 - idx * 1000)),
      title: item.title,
      category: item.category,
      hebrewDay: conv.triplet.day,
      hebrewMonth: conv.triplet.month,
      hebrewYear: conv.triplet.year,
      hebrewDateDisplay: conv.hebrewDisplay,
      gregorianDate: conv.gregorianIso,
      sunsetTime: conv.sunsetTime,
      locationName: item.locationName,
      responsiblePerson: item.responsiblePerson,
      estimatedBudgetAgorot: item.budgetAgorot,
      isExecuted: item.isExecuted,
      templateId: item.templateId,
      customFieldsJson: JSON.stringify(item.customFields),
      notes: item.notes,
      createdAt: now,
      updatedAt: now,
    };
  });
}

export function buildSeedTasks(activities?: AnnualActivityRecord[]): TaskNodeRecord[] {
  const now = new Date().toISOString();
  const farbrengenActId = activities?.[1]?.id;
  const projId = farbrengenActId || generateUuidV7(Date.now() - 30000);
  const t1Id = generateUuidV7(Date.now() - 29000);
  const t2Id = generateUuidV7(Date.now() - 28000);
  const t3Id = generateUuidV7(Date.now() - 27000);
  const t4Id = generateUuidV7(Date.now() - 26000);

  return [
    {
      id: projId,
      title: 'פרויקט הפקת התוועדות י״ט כסלו השנתית',
      targetDate: '', // ללא תאריך -> מוגדר אוטומטית כפרויקט
      isProject: true,
      strategicGoal: 'חיבור 200 תושבים מהשכונה לתורת החסידות וגיוס 15 שותפים חדשים להוראת קבע',
      successCriteria: 'אולם מלא ב-180 משתתפים לפחות, משוב חיובי ורישום בפועל של 15 תורמים',
      durationDays: 14,
      isCompleted: false,
      assignee: 'הרב מנחם כהן',
      dependsOnIdsJson: JSON.stringify([]),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: t1Id,
      title: 'סגירת אולם וקייטרינג מרכזי',
      parentId: projId,
      targetDate: '2026-11-15',
      hebrewDateStr: 'ה׳ בכסלו ה׳תשפ״ז',
      isProject: false,
      strategicGoal: 'הבטחת מקום מכובד וכיבוד עשיר',
      successCriteria: 'חוזה חתום ומקדמה משולמת',
      durationDays: 4,
      isCompleted: true,
      assignee: 'שניאור זלמן לוי',
      dependsOnIdsJson: JSON.stringify([]),
      reminderDate: '2026-11-10',
      reminderEmail: 'chabadneveyosef@gmail.com',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: t2Id,
      title: 'עיצוב והדפסת הזמנות יוקרתיות ומודעות רחוב',
      parentId: projId,
      targetDate: '2026-11-20',
      hebrewDateStr: 'י׳ בכסלו ה׳תשפ״ז',
      isProject: false,
      strategicGoal: 'מיתוג מכובד המזמין את כל גווני השכונה',
      successCriteria: '500 הזמנות מודפסות וקמפיין וואטסאפ פעיל',
      durationDays: 5,
      isCompleted: false,
      assignee: 'יוסי אברהמי',
      dependsOnIdsJson: JSON.stringify([t1Id]),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: t3Id,
      title: 'תיאום הגברה, תאורה ומסכי לד',
      parentId: projId,
      targetDate: '2026-11-22',
      hebrewDateStr: 'י״ב בכסלו ה׳תשפ״ז',
      isProject: false,
      strategicGoal: 'איכות שמע ותצוגה ללא תקלות',
      successCriteria: 'בדיקת סאונד מלאה מול הלהקה',
      durationDays: 2,
      isCompleted: false,
      assignee: 'שניאור זלמן לוי',
      dependsOnIdsJson: JSON.stringify([t1Id]),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: t4Id,
      title: 'סבב טלפונים אישיים לתורמים ואישורי הגעה VIP',
      parentId: projId,
      targetDate: '2026-11-27',
      hebrewDateStr: 'י״ז בכסלו ה׳תשפ״ז',
      isProject: false,
      strategicGoal: 'וידוא הגעה אישית של תומכי בית חב״ד',
      successCriteria: '150 אישורי הגעה מאומתים בטבלה',
      durationDays: 3,
      isCompleted: false,
      assignee: 'הרב מנחם כהן',
      dependsOnIdsJson: JSON.stringify([t2Id, t3Id]),
      reminderDate: '2026-11-25',
      reminderEmail: 'chabadneveyosef@gmail.com',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function buildSeedDonorsAndTransactions(): {
  donors: DonorContactRecord[];
  transactions: FinancialTransactionRecord[];
  communityEntities: VolunteerEntityRecord[];
} {
  const now = new Date().toISOString();
  const d1Id = generateUuidV7(Date.now() - 20000);
  const d2Id = generateUuidV7(Date.now() - 19000);
  const d3Id = generateUuidV7(Date.now() - 18000);

  const donors: DonorContactRecord[] = [
    {
      id: d1Id,
      fullName: 'אברהם יצחק גולדשטיין',
      identifierMark: 'בעל חברת הנדסה, מתפלל בשבת ליד העמוד',
      personalConnection: 'ידיד קרוב ותומך קבוע מהקמת בית חב״ד',
      encryptedNationalId: encryptSensitiveString('029384756'),
      nationalIdLast4: '4756',
      phone: '052-8441234',
      email: 'avraham.g@example.com',
      address: 'דרך יד לבנים 142, חיפה',
      city: 'חיפה',
      lat: 32.7852,
      lng: 35.0208,
      significantDatesJson: JSON.stringify([
        { id: 'sd1', type: 'birthday', title: 'יום הולדת אברהם', hebrewDay: 18, hebrewMonth: 6, hebrewYear: 5735 },
        { id: 'sd2', type: 'yahrtzeit', title: 'אזכרת אביו ר׳ שמואל ז״ל', hebrewDay: 14, hebrewMonth: 13, hebrewYear: 5776 },
      ]),
      interactionsJson: JSON.stringify([
        { id: 'in1', date: '2026-09-20', type: 'home_visit', summary: 'ביקור בית לקראת ראש השנה ומסירת דבש ומלוח שנה', recordedBy: 'הרב מנחם כהן' },
      ]),
      nextActionText: 'לתאם פגישת ברכה לקראת התוועדות י״ט כסלו',
      nextActionDate: '2026-11-10',
      attachmentsJson: JSON.stringify([
        { id: 'at1', title: 'קבלה #4021 על תרומת חגי תשרי', fileType: 'receipt', urlOrNote: 'נשלח במייל וב-WhatsApp', uploadedAt: '2026-09-25' },
      ]),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: d2Id,
      fullName: 'דודו ומשפחת אזולאי',
      identifierMark: 'בעלי מאפיית השכונה במרכז המסחרי',
      personalConnection: 'שותפים קבועים בחלוקת חלות לשבת למשפחות',
      encryptedNationalId: encryptSensitiveString('038475612'),
      nationalIdLast4: '5612',
      phone: '054-6119876',
      email: 'dudu.bakery@example.com',
      address: 'רחוב החשמל 18, חיפה',
      city: 'חיפה',
      lat: 32.7831,
      lng: 35.0179,
      significantDatesJson: JSON.stringify([
        { id: 'sd3', type: 'anniversary', title: 'יום נישואין דודו ורחל', hebrewDay: 15, hebrewMonth: 5, hebrewYear: 5762 },
      ]),
      interactionsJson: JSON.stringify([
        { id: 'in2', date: '2026-10-01', type: 'phone_call', summary: 'שיחת תודה על תרומת מאפים לשמחת בית השואבה', recordedBy: 'שניאור זלמן לוי' },
      ]),
      nextActionText: 'בדיקת חידוש תפילין לבן הבכור לקראת בר מצווה',
      nextActionDate: '2026-10-25',
      attachmentsJson: JSON.stringify([]),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: d3Id,
      fullName: 'ד״ר שמעון רוזנברג',
      identifierMark: 'רופא משפחה במרפאה השכונתית',
      personalConnection: 'משתתף קבוע בשיעור תניא ביום שלישי',
      encryptedNationalId: encryptSensitiveString('015263748'),
      nationalIdLast4: '3748',
      phone: '050-3324567',
      email: 'dr.rosenberg@example.com',
      address: 'רחוב הגיבורים 45, חיפה',
      city: 'חיפה',
      lat: 32.7875,
      lng: 35.0155,
      significantDatesJson: JSON.stringify([
        { id: 'sd4', type: 'birthday', title: 'יום הולדת ד״ר שמעון', hebrewDay: 3, hebrewMonth: 1, hebrewYear: 5730 },
      ]),
      interactionsJson: JSON.stringify([]),
      nextActionText: 'הזמנה אישית להדלקת נר ראשון של חנוכה',
      nextActionDate: '2026-12-01',
      attachmentsJson: JSON.stringify([]),
      createdAt: now,
      updatedAt: now,
    },
  ];

  // תנועות כספיות: שילוב כספים רגילים וכספי העמותה השנייה (עם ניכוי עמלה 3% אוטומטי)
  const tx1Calc = calculateTransactionAmounts(1500000, 'regular', 'income', 3); // 15,000 ILS regular
  const tx2Calc = calculateTransactionAmounts(2000000, 'second_association', 'income', 3); // 20,000 ILS second assoc -> 600 ILS fee -> 19,400 ILS net
  const tx3Calc = calculateTransactionAmounts(450000, 'regular', 'expense', 3); // 4,500 ILS expense
  const tx4Calc = calculateTransactionAmounts(600000, 'second_association', 'expense', 3); // 6,000 ILS expense
  const tx5Calc = calculateTransactionAmounts(500000, 'second_association', 'pledge', 3); // 5,000 ILS pending pledge

  const transactions: FinancialTransactionRecord[] = [
    {
      id: generateUuidV7(Date.now() - 15000),
      type: 'income',
      fundSource: 'regular',
      grossAmountAgorot: tx1Calc.grossAmountAgorot,
      feePercent: tx1Calc.feePercent,
      feeAmountAgorot: tx1Calc.feeAmountAgorot,
      netAmountAgorot: tx1Calc.netAmountAgorot,
      status: 'executed',
      category: 'תרומות חגי תשרי',
      description: 'תרומה לפעילות ראש השנה ויום כיפור',
      donorId: d1Id,
      donorName: 'אברהם יצחק גולדשטיין',
      receiptNumber: 'REC-4021',
      date: '2026-09-25',
      hebrewDateDisplay: 'י״ד בתשרי ה׳תשפ״ז',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateUuidV7(Date.now() - 14000),
      type: 'income',
      fundSource: 'second_association',
      grossAmountAgorot: tx2Calc.grossAmountAgorot,
      feePercent: tx2Calc.feePercent,
      feeAmountAgorot: tx2Calc.feeAmountAgorot,
      netAmountAgorot: tx2Calc.netAmountAgorot,
      status: 'executed',
      category: 'חסות התוועדות ושיעורים',
      description: 'תרומה שנתית דרך העמותה השנייה (בניכוי עמלת תקורה 3%)',
      donorId: d3Id,
      donorName: 'ד״ר שמעון רוזנברג',
      receiptNumber: 'SA-9082',
      date: '2026-10-01',
      hebrewDateDisplay: 'כ׳ בתשרי ה׳תשפ״ז',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateUuidV7(Date.now() - 13000),
      type: 'expense',
      fundSource: 'regular',
      grossAmountAgorot: tx3Calc.grossAmountAgorot,
      feePercent: 0,
      feeAmountAgorot: 0,
      netAmountAgorot: tx3Calc.netAmountAgorot,
      status: 'executed',
      category: 'רכישת ציוד וחגי תשרי',
      description: 'רכישת ערכות שופר, מחזורים ודבש לחלוקה',
      date: '2026-09-28',
      hebrewDateDisplay: 'י״ז בתשרי ה׳תשפ״ז',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateUuidV7(Date.now() - 12000),
      type: 'expense',
      fundSource: 'second_association',
      grossAmountAgorot: tx4Calc.grossAmountAgorot,
      feePercent: 0,
      feeAmountAgorot: 0,
      netAmountAgorot: tx4Calc.netAmountAgorot,
      status: 'executed',
      category: 'מלגות ושיעורי תורה',
      description: 'תשלום עבור הפקת חוברות לימוד ואירוח מרצים',
      date: '2026-10-03',
      hebrewDateDisplay: 'כ״ב בתשרי ה׳תשפ״ז',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateUuidV7(Date.now() - 11000),
      type: 'pledge',
      fundSource: 'second_association',
      grossAmountAgorot: tx5Calc.grossAmountAgorot,
      feePercent: tx5Calc.feePercent,
      feeAmountAgorot: tx5Calc.feeAmountAgorot,
      netAmountAgorot: tx5Calc.netAmountAgorot,
      status: 'pending',
      category: 'התחייבות לי״ט כסלו',
      description: 'התחייבות לחסות שולחן מרכזי בהתוועדות י״ט כסלו',
      donorId: d2Id,
      donorName: 'דודו ומשפחת אזולאי',
      date: '2026-11-15',
      hebrewDateDisplay: 'ה׳ בכסלו ה׳תשפ״ז',
      createdAt: now,
      updatedAt: now,
    },
  ];

  const communityEntities: VolunteerEntityRecord[] = [
    {
      id: generateUuidV7(Date.now() - 9000),
      entityType: 'volunteer',
      titleOrName: 'נתנאל ברקוביץ׳ (מתנדב שטח)',
      phoneOrSchedule: '058-7701234',
      areaOrAddress: 'אחראי חלוקת נרות שבת וערכות חג — רחוב יד לבנים',
      lat: 32.7845,
      lng: 35.0215,
      notes: 'זמין בימי שישי בבוקר ובערבי חגים עם רכב פרטי',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateUuidV7(Date.now() - 8000),
      entityType: 'regular_class',
      titleOrName: 'שיעור תניא וחסידות שבועי',
      phoneOrSchedule: 'ימי שלישי בשעה 20:30',
      areaOrAddress: 'בית חב״ד נווה יוסף, חיפה',
      lat: 32.7840,
      lng: 35.0195,
      notes: 'כולל כיבוד קל ושתייה חמה, פתוח לגברים ונשים',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateUuidV7(Date.now() - 7000),
      entityType: 'street_note',
      titleOrName: 'הערת רחוב: מרכז מסחרי נווה יוסף',
      phoneOrSchedule: 'ימי שישי 09:00-13:00',
      areaOrAddress: 'מרכז מסחרי נווה יוסף, חיפה',
      lat: 32.7836,
      lng: 35.0185,
      notes: 'מוקד מרכזי לדוכן תפילין וחלוקת עלוני שבת; יש לתאם מראש שולחן ליד המאפייה',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  return { donors, transactions, communityEntities };
}
