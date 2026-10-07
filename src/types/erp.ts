import {
  RoleTemplateName,
  DomainPermissionsMap,
  SensitivePermissionsMap,
} from '../lib/rbac';
import { FundSource, TransactionType, TransactionStatus } from '../lib/erp-core';

export interface BaseEntity {
  id: string;        // UUID v7
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  deletedAt?: string; // Soft Delete ISO 8601
}

export interface UserRecord extends BaseEntity {
  uid: string;
  email: string;
  displayName: string;
  username?: string;
  passwordHash?: string;
  roleTemplate: RoleTemplateName;
  isBlocked: boolean;
  sessionVersion: number;
  permissionsJson: string;          // JSON of DomainPermissionsMap
  sensitivePermissionsJson: string; // JSON of SensitivePermissionsMap
}

export interface ParsedUserRecord extends UserRecord {
  permissions: DomainPermissionsMap;
  sensitivePermissions: SensitivePermissionsMap;
}

export interface AuditLogRecord extends BaseEntity {
  actorUid: string;
  actorName: string;
  targetId: string;
  targetName: string;
  actionType: string;
  details: string;
}

export interface AnnualActivityRecord extends BaseEntity {
  title: string;
  category: string;
  hebrewDay: number;
  hebrewMonth: number;
  hebrewYear: number;
  hebrewDateDisplay: string;
  gregorianDate: string;
  sunsetTime?: string;
  locationName?: string;
  responsiblePerson?: string;
  estimatedBudgetAgorot?: number;
  isExecuted: boolean;
  templateId?: string;
  customFieldsJson?: string;
  notes?: string;
}

export type ReminderChannel = 'email' | 'desktop' | 'dashboard' | 'mobile';

export interface TaskNodeRecord extends BaseEntity {
  title: string;
  parentId?: string;
  targetDate?: string;
  hebrewDateStr?: string;
  isProject: boolean; // אוטומטית true כאשר אין targetDate
  strategicGoal?: string;
  successCriteria?: string;
  durationDays: number;
  isCompleted: boolean;
  assignee?: string;
  dependsOnIdsJson: string; // JSON string[]
  reminderDate?: string;
  reminderEmail?: string;
  reminderDaysBefore?: number;     // כמה ימים לפני תאריך הביצוע לשלוח תזכורת מקדימה
  reminderChannelsJson?: string;   // JSON of ReminderChannel[] ('email' | 'desktop' | 'dashboard' | 'mobile')
}

export interface DynamicTemplateField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select';
  required?: boolean;
  options?: string[];
}

export interface DynamicTemplateRecord extends BaseEntity {
  name: string;
  category: string;
  schemaJson: string;       // JSON of DynamicTemplateField[]
  defaultTasksJson?: string; // JSON of Array<{ title: string; durationDays: number }>
}

export interface FinancialTransactionRecord extends BaseEntity {
  type: TransactionType;
  fundSource: FundSource;
  grossAmountAgorot: number;
  feePercent: number;
  feeAmountAgorot: number;
  netAmountAgorot: number;
  status: TransactionStatus;
  category: string;
  description: string;
  donorId?: string;
  donorName?: string;
  receiptNumber?: string;
  date: string;
  hebrewDateDisplay?: string;
}

export interface SignificantHebrewDateItem {
  id: string;
  type: 'birthday' | 'anniversary' | 'yahrtzeit';
  title: string; // e.g., "יום הולדת", "אזכרת האב ר׳ משה ז״ל"
  hebrewDay: number;
  hebrewMonth: number;
  hebrewYear: number;
  notes?: string;
}

export interface DonorInteractionItem {
  id: string;
  date: string;
  type: 'home_visit' | 'phone_call' | 'meeting' | 'whatsapp';
  summary: string;
  recordedBy: string;
}

export interface DonorAttachmentItem {
  id: string;
  title: string;
  fileType: 'receipt' | 'document' | 'image';
  urlOrNote: string;
  uploadedAt: string;
}

export interface DonorContactRecord extends BaseEntity {
  fullName: string;
  identifierMark: string;     // סימן זיהוי (למשל: "בעל מאפיית הלחם, מתפלל בשבת בבוקר")
  personalConnection: string; // קשר פרטי (למשל: "ידיד קרוב של השליח משנת תשע״ח")
  encryptedNationalId: string;
  nationalIdLast4: string;
  phone: string;
  email?: string;
  address: string;
  city?: string;
  lat?: number;
  lng?: number;
  significantDatesJson?: string; // JSON of SignificantHebrewDateItem[]
  interactionsJson?: string;     // JSON of DonorInteractionItem[]
  nextActionText?: string;
  nextActionDate?: string;
  attachmentsJson?: string;      // JSON of DonorAttachmentItem[]
}

export interface VolunteerEntityRecord extends BaseEntity {
  entityType: 'volunteer' | 'regular_class' | 'street_note';
  titleOrName: string;
  phoneOrSchedule?: string;
  areaOrAddress?: string;
  lat?: number;
  lng?: number;
  notes?: string;
  isActive: boolean;
}

export interface MapDefaultLocationConfig {
  locationName: string;
  lat: number;
  lng: number;
  zoom: number;
}
