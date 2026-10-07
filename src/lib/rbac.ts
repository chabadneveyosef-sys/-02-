/**
 * מודל הרשאות גרנולארי (RBAC) לפי תחומי פעילות ופעולות רגישות
 * נאכף הן בשכבת השירות/מסד הנתונים והן בממשק המשתמש
 */

export type PermissionDomain =
  | 'annual_plan_tasks'   // תוכנית שנתית ומשימות
  | 'contacts_crm'        // אנשי קשר ותורמים
  | 'regular_finances'    // כספים רגילים
  | 'second_association'  // כספי העמותה השנייה
  | 'events_classes'      // אירועים ושיעורים קבועים
  | 'volunteers'          // מתנדבים
  | 'gis_map'             // מפה והערות רחוב
  | 'settings';           // הגדרות ותבניות

export type AccessLevel = 'none' | 'read' | 'write' | 'full';

export type SensitivePermission =
  | 'reveal_national_id'  // חשיפת תעודת זהות מוצפנת
  | 'export_data'         // ייצוא נתונים (CSV/PDF)
  | 'manage_users'        // ניהול משתמשים והרשאות
  | 'restore_backup';     // שחזור גיבוי ומיגרציה

export type RoleTemplateName = 'admin' | 'treasurer' | 'coordinator' | 'volunteer';

export type DomainPermissionsMap = Record<PermissionDomain, AccessLevel>;
export type SensitivePermissionsMap = Record<SensitivePermission, boolean>;

export const PERMISSION_DOMAIN_LABELS: Record<PermissionDomain, string> = {
  annual_plan_tasks: 'תוכנית שנתית ומשימות',
  contacts_crm: 'אנשי קשר ותורמים (CRM)',
  regular_finances: 'כספים רגילים',
  second_association: 'כספי העמותה השנייה',
  events_classes: 'אירועים ושיעורים קבועים',
  volunteers: 'מתנדבים',
  gis_map: 'מפה (GIS) והערות רחוב',
  settings: 'הגדרות מערכת ותבניות',
};

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  none: 'אין גישה',
  read: 'צפייה בלבד',
  write: 'צפייה ועריכה',
  full: 'ניהול מלא',
};

export const SENSITIVE_PERMISSION_LABELS: Record<SensitivePermission, string> = {
  reveal_national_id: 'חשיפת תעודת זהות מלאה (••••1234)',
  export_data: 'ייצוא נתונים (CSV / Excel / PDF)',
  manage_users: 'ניהול משתמשים, תפקידים וחסימות',
  restore_backup: 'שחזור גיבוי מלא והרצת מיגרציות',
};

export const ROLE_TEMPLATE_LABELS: Record<RoleTemplateName, string> = {
  admin: 'מנהל בית חב״ד (גישה מלאה)',
  treasurer: 'גזבר וכספים',
  coordinator: 'רכז פעילות וקהילה',
  volunteer: 'מתנדב פעיל',
};

export function getDefaultPermissionsForRole(role: RoleTemplateName): {
  domains: DomainPermissionsMap;
  sensitive: SensitivePermissionsMap;
} {
  switch (role) {
    case 'admin':
      return {
        domains: {
          annual_plan_tasks: 'full',
          contacts_crm: 'full',
          regular_finances: 'full',
          second_association: 'full',
          events_classes: 'full',
          volunteers: 'full',
          gis_map: 'full',
          settings: 'full',
        },
        sensitive: {
          reveal_national_id: true,
          export_data: true,
          manage_users: true,
          restore_backup: true,
        },
      };
    case 'treasurer':
      return {
        domains: {
          annual_plan_tasks: 'read',
          contacts_crm: 'write',
          regular_finances: 'full',
          second_association: 'full',
          events_classes: 'read',
          volunteers: 'read',
          gis_map: 'read',
          settings: 'read',
        },
        sensitive: {
          reveal_national_id: true,
          export_data: true,
          manage_users: false,
          restore_backup: false,
        },
      };
    case 'coordinator':
      return {
        domains: {
          annual_plan_tasks: 'full',
          contacts_crm: 'write',
          regular_finances: 'read',
          second_association: 'none',
          events_classes: 'full',
          volunteers: 'full',
          gis_map: 'write',
          settings: 'read',
        },
        sensitive: {
          reveal_national_id: false,
          export_data: true,
          manage_users: false,
          restore_backup: false,
        },
      };
    case 'volunteer':
    default:
      return {
        domains: {
          annual_plan_tasks: 'read',
          contacts_crm: 'read',
          regular_finances: 'none',
          second_association: 'none',
          events_classes: 'read',
          volunteers: 'read',
          gis_map: 'read',
          settings: 'none',
        },
        sensitive: {
          reveal_national_id: false,
          export_data: false,
          manage_users: false,
          restore_backup: false,
        },
      };
  }
}

const ACCESS_RANK: Record<AccessLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  full: 3,
};

export function hasDomainAccess(
  domains: DomainPermissionsMap | undefined,
  domain: PermissionDomain,
  requiredLevel: AccessLevel
): boolean {
  if (!domains) return false;
  const current = domains[domain] || 'none';
  return ACCESS_RANK[current] >= ACCESS_RANK[requiredLevel];
}

/**
 * מנגנון הגנה: מוודא שלא חוסמים את המשתמש הנוכחי עצמו ולא משאירים את המערכת ללא מנהל פעיל אחד לפחות
 */
export function validateUserSafetyChange(
  allUsers: Array<{ id: string; uid: string; roleTemplate: RoleTemplateName; isBlocked: boolean; deletedAt?: string }>,
  actorUid: string,
  targetUserId: string,
  newRole: RoleTemplateName,
  newIsBlocked: boolean
): { valid: boolean; errorReason?: string } {
  const targetUser = allUsers.find((u) => u.id === targetUserId && !u.deletedAt);
  if (!targetUser) {
    return { valid: false, errorReason: 'המשתמש המבוקש לא נמצא במערכת.' };
  }

  // מניעת חסימה עצמית או הורדת הרשאת מנהל מעצמך
  if (targetUser.uid === actorUid) {
    if (newIsBlocked) {
      return { valid: false, errorReason: 'הגנת מערכת: אינך יכול לחסום את החשבון של עצמך.' };
    }
    if (targetUser.roleTemplate === 'admin' && newRole !== 'admin') {
      return { valid: false, errorReason: 'הגנת מערכת: אינך יכול להסיר מעצמך הרשאת מנהל ראשי.' };
    }
  }

  // בדיקה שנותר לפחות מנהל פעיל אחד במערכת
  const activeAdminsAfterChange = allUsers.filter((u) => {
    if (u.deletedAt) return false;
    const role = u.id === targetUserId ? newRole : u.roleTemplate;
    const blocked = u.id === targetUserId ? newIsBlocked : u.isBlocked;
    return role === 'admin' && !blocked;
  });

  if (activeAdminsAfterChange.length === 0) {
    return {
      valid: false,
      errorReason: 'הגנת מערכת: לא ניתן להשאיר את בית חב״ד ללא לפחות מנהל מערכת פעיל אחד.',
    };
  }

  return { valid: true };
}
