import React, { useState } from 'react';
import {
  Shield,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  Lock,
  Unlock,
  FileSpreadsheet,
  Printer,
  Database,
  Code2,
  UserPlus,
  UserCheck,
  MapPin,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Clock,
} from 'lucide-react';
import {
  ParsedUserRecord,
  AuditLogRecord,
  DynamicTemplateRecord,
  AnnualActivityRecord,
  TaskNodeRecord,
  FinancialTransactionRecord,
  DonorContactRecord,
  VolunteerEntityRecord,
  MapDefaultLocationConfig,
} from '../types/erp';
import {
  PermissionDomain,
  AccessLevel,
  SensitivePermission,
  RoleTemplateName,
  PERMISSION_DOMAIN_LABELS,
  ACCESS_LEVEL_LABELS,
  SENSITIVE_PERMISSION_LABELS,
  ROLE_TEMPLATE_LABELS,
  getDefaultPermissionsForRole,
  validateUserSafetyChange,
} from '../lib/rbac';
import {
  runCoreUnitTests,
  encryptSensitiveString,
  decryptSensitiveString,
} from '../lib/erp-core';

interface RbacSettingsViewProps {
  currentUser: ParsedUserRecord;
  users: ParsedUserRecord[];
  auditLogs: AuditLogRecord[];
  templates: DynamicTemplateRecord[];
  activities: AnnualActivityRecord[];
  tasks: TaskNodeRecord[];
  transactions: FinancialTransactionRecord[];
  donors: DonorContactRecord[];
  communityEntities: VolunteerEntityRecord[];
  defaultMapLocation: MapDefaultLocationConfig;
  onUpdateDefaultMapLocation: (config: MapDefaultLocationConfig) => Promise<void>;
  onSwitchActiveUser?: (userId: string) => void;
  onRegisterNewUser: (data: {
    displayName: string;
    email: string;
    username: string;
    passwordPlain: string;
    roleTemplate: RoleTemplateName;
  }) => Promise<void>;
  onUpdateUserRoleAndPermissions: (
    targetUser: ParsedUserRecord,
    newRole: RoleTemplateName,
    newIsBlocked: boolean,
    newDomains: Record<PermissionDomain, AccessLevel>,
    newSensitive: Record<SensitivePermission, boolean>,
    newIsPendingApproval?: boolean
  ) => Promise<void>;
  onSaveTemplate: (
    name: string,
    category: string,
    schemaJson: string
  ) => Promise<void>;
  onRestoreBackupData: (payload: {
    activities?: AnnualActivityRecord[];
    tasks?: TaskNodeRecord[];
    transactions?: FinancialTransactionRecord[];
    donors?: DonorContactRecord[];
  }) => Promise<void>;
  onLogExportAction: (format: string) => Promise<void>;
}

export const RbacSettingsView: React.FC<RbacSettingsViewProps> = ({
  currentUser,
  users,
  auditLogs,
  templates,
  activities,
  tasks,
  transactions,
  donors,
  communityEntities,
  defaultMapLocation,
  onUpdateDefaultMapLocation,
  onSwitchActiveUser,
  onRegisterNewUser,
  onUpdateUserRoleAndPermissions,
  onSaveTemplate,
  onRestoreBackupData,
  onLogExportAction,
}) => {
  const [activeTab, setActiveTab] = useState<
    'rbac' | 'audit' | 'backup_export' | 'templates' | 'unit_tests'
  >('rbac');
  const [safetyError, setSafetyError] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);

  // New user registration state
  const [showRegisterUserForm, setShowRegisterUserForm] = useState(false);
  const [regDisplayName, setRegDisplayName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [regRole, setRegRole] = useState<RoleTemplateName>('coordinator');

  // Closed user list state — only opens for editing permissions when admin clicks a person
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  // Map Default Location quick editor inside settings
  const [mapLocName, setMapLocName] = useState(defaultMapLocation.locationName);
  const [mapLat, setMapLat] = useState(String(defaultMapLocation.lat));
  const [mapLng, setMapLng] = useState(String(defaultMapLocation.lng));
  const [mapZoom, setMapZoom] = useState(String(defaultMapLocation.zoom || 16));

  // New template state
  const [tplName, setTplName] = useState('');
  const [tplCategory, setTplCategory] = useState('אירוע קהילתי');
  const [tplFieldsJson, setTplFieldsJson] = useState(
    JSON.stringify(
      [
        { key: 'coordinatorPhone', label: 'טלפון רכז שטח', type: 'text', required: true },
        { key: 'budgetApproved', label: 'אישור תקציב ועד', type: 'boolean' },
      ],
      null,
      2
    )
  );

  const unitTestResults = runCoreUnitTests();
  const canManageUsers = currentUser.sensitivePermissions.manage_users;
  const canExport = currentUser.sensitivePermissions.export_data;
  const canRestore = currentUser.sensitivePermissions.restore_backup;

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regDisplayName.trim() || !regUsername.trim() || !regPassword.trim() || !canManageUsers) {
      return;
    }
    setSafetyError(null);
    await onRegisterNewUser({
      displayName: regDisplayName.trim(),
      email: regEmail.trim() || `${regUsername.trim()}@chabad.local`,
      username: regUsername.trim(),
      passwordPlain: regPassword.trim(),
      roleTemplate: regRole,
    });
    setRegDisplayName('');
    setRegEmail('');
    setRegUsername('');
    setRegPassword('');
    setShowRegisterUserForm(false);
    setBackupMessage(`המשתמש "${regDisplayName.trim()}" נרשם למערכת בהצלחה עם תבנית הרשאות "${ROLE_TEMPLATE_LABELS[regRole]}".`);
  };

  const handleRoleTemplateSelect = async (user: ParsedUserRecord, newRole: RoleTemplateName) => {
    setSafetyError(null);
    const check = validateUserSafetyChange(
      users,
      currentUser.uid,
      user.id,
      newRole,
      user.isBlocked
    );
    if (!check.valid) {
      setSafetyError(check.errorReason || 'פעולה אסורה');
      return;
    }
    const defaults = getDefaultPermissionsForRole(newRole);
    await onUpdateUserRoleAndPermissions(
      user,
      newRole,
      user.isBlocked,
      defaults.domains,
      defaults.sensitive
    );
  };

  const handleToggleBlockUser = async (user: ParsedUserRecord) => {
    setSafetyError(null);
    const nextBlocked = !user.isBlocked;
    const check = validateUserSafetyChange(
      users,
      currentUser.uid,
      user.id,
      user.roleTemplate,
      nextBlocked
    );
    if (!check.valid) {
      setSafetyError(check.errorReason || 'פעולה אסורה');
      return;
    }
    await onUpdateUserRoleAndPermissions(
      user,
      user.roleTemplate,
      nextBlocked,
      user.permissions,
      user.sensitivePermissions
    );
  };

  const handleDomainLevelChange = async (
    user: ParsedUserRecord,
    domain: PermissionDomain,
    level: AccessLevel
  ) => {
    setSafetyError(null);
    const updatedDomains = { ...user.permissions, [domain]: level };
    await onUpdateUserRoleAndPermissions(
      user,
      user.roleTemplate,
      user.isBlocked,
      updatedDomains,
      user.sensitivePermissions
    );
  };

  const handleSensitiveToggle = async (
    user: ParsedUserRecord,
    perm: SensitivePermission
  ) => {
    setSafetyError(null);
    const updatedSensitive = {
      ...user.sensitivePermissions,
      [perm]: !user.sensitivePermissions[perm],
    };
    await onUpdateUserRoleAndPermissions(
      user,
      user.roleTemplate,
      user.isBlocked,
      user.permissions,
      updatedSensitive
    );
  };

  // ייצוא לקובץ CSV תקני עם BOM לעברית באקסל
  const handleExportCsv = async () => {
    if (!canExport) return;
    await onLogExportAction('CSV/Excel');

    const headers = ['סוג רשומה', 'מזהה UUIDv7', 'כותרת / שם', 'תאריך', 'סכום / פרטים'];
    const rows: string[][] = [
      ...activities
        .filter((a) => !a.deletedAt)
        .map((a) => ['פעילות שנתית', a.id, a.title, a.hebrewDateDisplay, a.locationName || '']),
      ...transactions
        .filter((t) => !t.deletedAt)
        .map((t) => [
          `כספים (${t.fundSource})`,
          t.id,
          t.description,
          t.date,
          `${(t.netAmountAgorot / 100).toFixed(2)} ILS`,
        ]),
      ...donors
        .filter((d) => !d.deletedAt)
        .map((d) => ['תורם CRM', d.id, d.fullName, d.phone, d.address]),
    ];

    const csvContent =
      '\uFEFF' +
      [headers, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chabad-erp-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // גיבוי מלא מוצפן בקובץ אחד
  const handleDownloadEncryptedBackup = async () => {
    if (!canExport) return;
    await onLogExportAction('Encrypted Full Backup');

    const fullSnapshot = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      activities,
      tasks,
      transactions,
      donors,
      communityEntities,
      templates,
    };

    const encryptedPayload = encryptSensitiveString(JSON.stringify(fullSnapshot));
    const backupFileContent = JSON.stringify(
      {
        magic: 'CHABAD_ERP_ENCRYPTED_BACKUP_V1',
        createdAt: fullSnapshot.timestamp,
        cipher: encryptedPayload,
      },
      null,
      2
    );

    const blob = new Blob([backupFileContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chabad-backup-${new Date().toISOString().slice(0, 10)}.chabad-backup.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupMessage('קובץ הגיבוי המוצפן הופק והורד למחשב בהצלחה.');
  };

  const handleRestoreEncryptedFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canRestore) return;
    try {
      localStorage.setItem(
        'chabad_erp_pre_migration_auto_backup',
        JSON.stringify({ timestamp: new Date().toISOString(), activities, tasks, transactions, donors })
      );

      const text = await file.text();
      const parsedWrapper = JSON.parse(text);
      const decryptedJson = decryptSensitiveString(parsedWrapper.cipher || '');
      const restoredData = JSON.parse(decryptedJson);

      await onRestoreBackupData({
        activities: restoredData.activities,
        tasks: restoredData.tasks,
        transactions: restoredData.transactions,
        donors: restoredData.donors,
      });
      setBackupMessage('שחזור הגיבוי המוצפן הושלם בהצלחה! (נוצר גיבוי אוטומטי מקדים).');
    } catch {
      setSafetyError('שגיאה בפענוח קובץ הגיבוי. ודא שזהו קובץ גיבוי תקני של מערכת בית חב״ד.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">
            רישום משתמשים, מערך הרשאות גמיש (RBAC), יומן ביקורת וגיבוי מוצפן
          </h2>
          <p className="text-sm text-slate-600">
            רישום משתמשים חדשים למערכת, אכיפת 4 רמות גישה לכל תחום, הרשאות רגישות, מניעת השארת המערכת ללא מנהל פעיל ויומן ביקורת מלא.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveTab('rbac')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'rbac' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              משתמשים והרשאות ({users.filter((u) => !u.deletedAt).length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'audit' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              יומן שינויים וביקורת ({auditLogs.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('backup_export')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'backup_export' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              ייצוא, גיבוי ומיקום ברירת מחדל
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('templates')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'templates' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              תבניות דינמיות (JSON Schema)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('unit_tests')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'unit_tests' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              בדיקות יחידה ואדריכלות
            </button>
          </div>

          {canManageUsers && activeTab === 'rbac' && (
            <button
              type="button"
              onClick={() => setShowRegisterUserForm(!showRegisterUserForm)}
              className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 flex items-center gap-1.5 whitespace-nowrap"
            >
              <UserPlus className="w-4 h-4" />
              <span>+ רישום משתמש חדש למערכת</span>
            </button>
          )}
        </div>
      </div>

      {safetyError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between text-red-800 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <span>{safetyError}</span>
          </div>
          <button type="button" onClick={() => setSafetyError(null)} className="text-xs underline">
            סגור
          </button>
        </div>
      )}

      {backupMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-emerald-900 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{backupMessage}</span>
          </div>
          <button type="button" onClick={() => setBackupMessage(null)} className="text-xs underline">
            סגור
          </button>
        </div>
      )}

      {activeTab === 'rbac' && (
        <div className="space-y-6">
          {/* טופס רישום משתמש חדש למערכת */}
          {showRegisterUserForm && canManageUsers && (
            <form
              onSubmit={handleCreateUserSubmit}
              className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-slate-800" />
                  <span>רישום משתמש חדש והקצאת תבנית הרשאות</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setShowRegisterUserForm(false)}
                  className="text-xs text-slate-500 hover:text-slate-900"
                >
                  ביטול ✕
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    שם מלא לתצוגה *
                  </label>
                  <input
                    type="text"
                    required
                    value={regDisplayName}
                    onChange={(e) => setRegDisplayName(e.target.value)}
                    placeholder="למשל: הרב יוסף לוי"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    שם משתמש לכניסה *
                  </label>
                  <input
                    type="text"
                    required
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    placeholder="למשל: yossi"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    סיסמה ראשונית *
                  </label>
                  <div className="relative">
                    <input
                      type={showRegPassword ? 'text' : 'password'}
                      required
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="לפחות 4 תווים"
                      className="w-full px-3 py-2 pl-9 text-xs border border-slate-300 rounded-lg font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegPassword((p) => !p)}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
                      title={showRegPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
                    >
                      {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    כתובת אימייל (לסנכרון ענן)
                  </label>
                  <input
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="user@gmail.com"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    תבנית תפקיד התחלתית *
                  </label>
                  <select
                    value={regRole}
                    onChange={(e) => setRegRole(e.target.value as RoleTemplateName)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white font-semibold"
                  >
                    {(Object.keys(ROLE_TEMPLATE_LABELS) as RoleTemplateName[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_TEMPLATE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRegisterUserForm(false)}
                  className="px-4 py-1.5 text-xs text-slate-600"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="px-5 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800"
                >
                  רשום משתמש והפעל הרשאות
                </button>
              </div>
            </form>
          )}

          {/* רשימת אנשים להרשאות — רשימה סגורה, ורק כשמנהל לוחץ על איש הוא נפתח לעריכת הרשאות */}
          <div className="bg-white border border-slate-300/80 rounded-xl p-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                רשימת אנשים ומורשים במערכת (רשימה סגורה — לחץ על שם משתמש לפתיחת עריכת הרשאות)
              </h3>
              <p className="text-xs text-slate-600">
                כל הרשאות המשתמשים סגורות כברירת מחדל לשמירה על ניקיון וסדר. לחיצה של מנהל על שורת משתמש תפתח את מטריצת ההרשאות המלאה שלו.
              </p>
            </div>
            {users.some((u) => !u.deletedAt && u.isPendingApproval) && (
              <span className="text-xs font-bold text-amber-800 bg-amber-100 border border-amber-300 px-3 py-1 rounded-lg flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                ממתינים לאישור מנהל: {users.filter((u) => !u.deletedAt && u.isPendingApproval).length}
              </span>
            )}
          </div>

          <div className="space-y-3">
            {users
              .filter((u) => !u.deletedAt)
              .map((user) => {
                const isCurrentActive = user.id === currentUser.id || user.uid === currentUser.uid;
                const isExpanded = expandedUserId === user.id;
                return (
                  <div
                    key={user.id}
                    className={`bg-white border rounded-xl overflow-hidden transition-colors ${
                      user.isPendingApproval
                        ? 'border-amber-400'
                        : isCurrentActive
                        ? 'border-blue-700'
                        : 'border-slate-300/90'
                    }`}
                  >
                    {/* שורת כותרת סגורה — לחיצה של מנהל פותחת/סוגרת את עריכת ההרשאות */}
                    <div
                      onClick={() => {
                        if (canManageUsers) {
                          setExpandedUserId((prev) => (prev === user.id ? null : user.id));
                        }
                      }}
                      className={`p-4 flex flex-wrap items-center justify-between gap-4 ${
                        canManageUsers ? 'cursor-pointer hover:bg-slate-100/70' : ''
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2.5">
                        <Shield className="w-4 h-4 text-blue-900 shrink-0" />
                        <span className="font-bold text-base text-slate-900">
                          {user.displayName}
                        </span>
                        <span className="text-xs text-slate-600 font-semibold">
                          · {ROLE_TEMPLATE_LABELS[user.roleTemplate]}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">({user.email})</span>
                        {user.username && (
                          <span className="text-xs text-slate-600 font-mono">
                            · משתמש: <strong>{user.username}</strong>
                          </span>
                        )}
                        {isCurrentActive && (
                          <span className="text-xs font-bold text-emerald-700">· מחובר כעת</span>
                        )}
                        {user.isPendingApproval && (
                          <span className="text-xs font-bold text-amber-800 flex items-center gap-1">
                            · <Clock className="w-3.5 h-3.5" /> ממתין לאישור מנהל
                          </span>
                        )}
                        {user.isBlocked && !user.isPendingApproval && (
                          <span className="text-xs font-bold text-red-700">· חסום</span>
                        )}
                      </div>

                      <div
                        className="flex flex-wrap items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canManageUsers && user.isPendingApproval && (
                          <button
                            type="button"
                            onClick={async () => {
                              await onUpdateUserRoleAndPermissions(
                                user,
                                user.roleTemplate,
                                false,
                                user.permissions,
                                user.sensitivePermissions,
                                false
                              );
                              setBackupMessage(
                                `הרשמת המשתמש "${user.displayName}" אושרה על ידי מנהל המערכת וכעת הוא רשאי להיכנס.`
                              );
                            }}
                            className="px-3 py-1.5 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg flex items-center gap-1.5"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>אשר הרשמת משתמש</span>
                          </button>
                        )}

                        {onSwitchActiveUser &&
                          !isCurrentActive &&
                          !user.isBlocked &&
                          !user.isPendingApproval && (
                            <button
                              type="button"
                              onClick={() => onSwitchActiveUser(user.id)}
                              className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg flex items-center gap-1.5"
                              title="עבור לעבוד תחת משתמש זה כדי לבדוק את הרשאותיו בזמן אמת"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                              <span>הפעל כמשתמש פעיל</span>
                            </button>
                          )}

                        {canManageUsers && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedUserId((prev) => (prev === user.id ? null : user.id))
                            }
                            className="px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-lg flex items-center gap-1.5"
                          >
                            <span>{isExpanded ? 'סגור עריכת הרשאות' : 'ערוך הרשאות'}</span>
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* פאנל עריכת הרשאות נפתח רק כאשר מנהל לוחץ על האיש */}
                    {isExpanded && canManageUsers && (
                      <div className="p-6 pt-4 border-t border-slate-200 bg-slate-50/70 space-y-5">
                        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200">
                          <div className="text-xs text-slate-500 font-mono">
                            UUIDv7: {user.id} · גרסת סשן פעיל: #{user.sessionVersion}
                          </div>

                          <div className="flex flex-wrap items-center gap-3">
                            <div>
                              <label className="block text-[11px] text-slate-600 mb-0.5 font-semibold">
                                תבנית תפקיד (נקודת מוצא):
                              </label>
                              <select
                                disabled={!canManageUsers}
                                value={user.roleTemplate}
                                onChange={(e) =>
                                  handleRoleTemplateSelect(user, e.target.value as RoleTemplateName)
                                }
                                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white font-semibold"
                              >
                                {(Object.keys(ROLE_TEMPLATE_LABELS) as RoleTemplateName[]).map(
                                  (r) => (
                                    <option key={r} value={r}>
                                      {ROLE_TEMPLATE_LABELS[r]}
                                    </option>
                                  )
                                )}
                              </select>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleToggleBlockUser(user)}
                              className={`px-3 py-2 text-xs font-semibold rounded-lg flex items-center gap-1.5 ${
                                user.isBlocked
                                  ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                                  : 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
                              }`}
                            >
                              {user.isBlocked ? (
                                <>
                                  <Unlock className="w-3.5 h-3.5" />
                                  בטל חסימת משתמש
                                </>
                              ) : (
                                <>
                                  <Lock className="w-3.5 h-3.5" />
                                  חסום ונתק סשנים פעילים
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {/* 8 Domain Permissions Grid */}
                        <div>
                          <h4 className="text-xs font-bold text-slate-800 mb-2">
                            הרשאות גרנולאריות לפי תחום (4 רמות גישה לכל תחום):
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            {(Object.keys(PERMISSION_DOMAIN_LABELS) as PermissionDomain[]).map(
                              (dom) => (
                                <div
                                  key={dom}
                                  className="p-2.5 bg-white border border-slate-300/80 rounded-lg"
                                >
                                  <label className="block text-xs font-semibold text-slate-800 mb-1">
                                    {PERMISSION_DOMAIN_LABELS[dom]}
                                  </label>
                                  <select
                                    disabled={!canManageUsers}
                                    value={user.permissions[dom] || 'none'}
                                    onChange={(e) =>
                                      handleDomainLevelChange(
                                        user,
                                        dom,
                                        e.target.value as AccessLevel
                                      )
                                    }
                                    className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                                  >
                                    {(Object.keys(ACCESS_LEVEL_LABELS) as AccessLevel[]).map(
                                      (lvl) => (
                                        <option key={lvl} value={lvl}>
                                          {ACCESS_LEVEL_LABELS[lvl]}
                                        </option>
                                      )
                                    )}
                                  </select>
                                </div>
                              )
                            )}
                          </div>
                        </div>

                        {/* 4 Sensitive Permissions */}
                        <div className="pt-2 border-t border-slate-200">
                          <h4 className="text-xs font-bold text-slate-800 mb-2">
                            הרשאות נפרדות לפעולות רגישות:
                          </h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            {(
                              Object.keys(SENSITIVE_PERMISSION_LABELS) as SensitivePermission[]
                            ).map((perm) => (
                              <label
                                key={perm}
                                className="flex items-center gap-2 p-2.5 bg-white border border-slate-300/80 rounded-lg text-xs font-medium text-slate-800 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  disabled={!canManageUsers}
                                  checked={Boolean(user.sensitivePermissions[perm])}
                                  onChange={() => handleSensitiveToggle(user, perm)}
                                />
                                <span>{SENSITIVE_PERMISSION_LABELS[perm]}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <h3 className="text-sm font-bold text-slate-900">
              יומן שינויים וביקורת אבטחה (Audit Log — בלתי ניתן למחיקה)
            </h3>
            <p className="text-xs text-slate-500">
              מתעד באופן אוטומטי כל שינוי הרשאה, רישום משתמש, חסימה, חשיפת תעודת זהות מוצפנת, ביטול פעולה (Undo) או שחזור גיבוי.
            </p>
          </div>
          <div className="overflow-x-auto max-h-[620px]">
            <table className="erp-table text-right text-xs">
              <thead>
                <tr className="text-slate-700">
                  <th className="py-3 px-4 col-compact">מתי (חותמת זמן)</th>
                  <th className="py-3 px-4 col-compact">מי ביצע</th>
                  <th className="py-3 px-4 col-compact">סוג פעולה</th>
                  <th className="py-3 px-4 col-text-medium">על מי / יעד</th>
                  <th className="py-3 px-5 col-text-wide">פירוט מלא של הפעולה ביומן הביקורת</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="transition-colors">
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap align-top">
                      {log.createdAt.replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-900 whitespace-nowrap align-top">{log.actorName}</td>
                    <td className="py-3 px-4 font-bold text-amber-900 whitespace-nowrap align-top">{log.actionType}</td>
                    <td className="py-3 px-4 text-slate-800 font-medium col-text-medium align-top">{log.targetName}</td>
                    <td className="py-3 px-5 text-slate-700 col-text-wide align-top leading-relaxed">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'backup_export' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Download className="w-5 h-5 text-slate-700" />
              ייצוא קריא (Excel / CSV ו-PDF) וגיבוי מוצפן
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              ניתן לייצא את כל טבלאות המערכת לקובץ אקסל (CSV בעברית תקנית) או להדפיס לדוח PDF, וכן להוריד קובץ גיבוי מוצפן יחיד הכולל את כל הנתונים.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                disabled={!canExport}
                onClick={handleExportCsv}
                className="px-4 py-2.5 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 flex items-center gap-2 disabled:opacity-50"
              >
                <FileSpreadsheet className="w-4 h-4" />
                ייצוא נתונים ל-CSV / Excel
              </button>
              <button
                type="button"
                disabled={!canExport}
                onClick={async () => {
                  await onLogExportAction('PDF Report Print');
                  window.print();
                }}
                className="px-4 py-2.5 bg-slate-100 text-slate-900 text-xs font-semibold rounded-lg hover:bg-slate-200 flex items-center gap-2 disabled:opacity-50"
              >
                <Printer className="w-4 h-4" />
                הפקת דוח להדפסה / PDF
              </button>
              <button
                type="button"
                disabled={!canExport}
                onClick={handleDownloadEncryptedBackup}
                className="px-4 py-2.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 flex items-center gap-2 disabled:opacity-50"
              >
                <Database className="w-4 h-4" />
                הורדת גיבוי מלא מוצפן בקובץ אחד
              </button>
              <a
                href="/api/download-apk"
                download="chabad-erp-android.apk"
                className="px-4 py-2.5 bg-emerald-700 text-white text-xs font-semibold rounded-lg hover:bg-emerald-800 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                הורדת קובץ APK לאנדרואיד (ללא צורך בדפדפן)
              </a>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <label className="block text-xs font-bold text-slate-800 mb-2 flex items-center gap-1.5">
                <Upload className="w-4 h-4" />
                שחזור מגיבוי מוצפן (מבצע גיבוי אוטומטי מקדים לפני השחזור):
              </label>
              <input
                type="file"
                accept=".json"
                disabled={!canRestore}
                onChange={handleRestoreEncryptedFile}
                className="block w-full text-xs text-slate-600 file:ml-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-900 hover:file:bg-slate-200"
              />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-slate-700" />
              עריכת מיקום ברירת המחדל של המפה ושקיעת החמה
            </h3>
            <p className="text-xs text-slate-600">
              קבע את המיקום הגיאוגרפי הקבוע של בית חב״ד לטובת פתיחת מפת ה-GIS וחישוב אוטומטי של זמני שקיעת החמה בלוח העברי.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await onUpdateDefaultMapLocation({
                  locationName: mapLocName.trim() || 'חיפה - נווה יוסף',
                  lat: Number(parseFloat(mapLat).toFixed(5)) || 32.7842,
                  lng: Number(parseFloat(mapLng).toFixed(5)) || 35.0195,
                  zoom: Number(mapZoom) || 16,
                });
                setBackupMessage(`מיקום ברירת המחדל של המפה עודכן ל-"${mapLocName}" בהצלחה.`);
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">שם המיקום / השכונה</label>
                <input
                  type="text"
                  value={mapLocName}
                  onChange={(e) => setMapLocName(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">קו רוחב (Lat)</label>
                  <input
                    type="number"
                    step="0.00001"
                    value={mapLat}
                    onChange={(e) => setMapLat(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">קו אורך (Lng)</label>
                  <input
                    type="number"
                    step="0.00001"
                    value={mapLng}
                    onChange={(e) => setMapLng(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">תקריב (Zoom)</label>
                  <input
                    type="number"
                    min="8"
                    max="19"
                    value={mapZoom}
                    onChange={(e) => setMapZoom(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800"
              >
                שמור מיקום ברירת מחדל
              </button>
            </form>
          </div>
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!tplName.trim()) return;
              await onSaveTemplate(tplName.trim(), tplCategory.trim(), tplFieldsJson);
              setTplName('');
            }}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-slate-900">
              הוספת תבנית דינמית חדשה (JSON Schema — ללא צורך בשינוי קוד)
            </h3>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">שם התבנית</label>
              <input
                type="text"
                required
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                placeholder="למשל: תבנית תהלוכת ל״ג בעומר"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">קטגוריה</label>
              <input
                type="text"
                value={tplCategory}
                onChange={(e) => setTplCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                הגדרת שדות JSON Schema
              </label>
              <textarea
                rows={5}
                value={tplFieldsJson}
                onChange={(e) => setTplFieldsJson(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                dir="ltr"
              />
            </div>
            <button
              type="submit"
              className="px-5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg"
            >
              שמור תבנית דינמית
            </button>
          </form>

          <div className="space-y-3">
            {templates
              .filter((t) => !t.deletedAt)
              .map((t) => (
                <div key={t.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-900">{t.name}</span>
                    <span className="text-xs text-slate-500">{t.category}</span>
                  </div>
                  <pre
                    dir="ltr"
                    className="text-[11px] font-mono bg-slate-50 p-2.5 rounded border border-slate-100 overflow-x-auto"
                  >
                    {t.schemaJson}
                  </pre>
                </div>
              ))}
          </div>
        </div>
      )}

      {activeTab === 'unit_tests' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Code2 className="w-5 h-5 text-emerald-700" />
                תוצאות בדיקות יחידה אוטומטיות לליבה הקריטית (Unit Tests)
              </h3>
              <p className="text-xs text-slate-500">
                בדיקת אלגוריתמי DAG ומעגלים (DFS), מסלול קריטי (CPM), חישובי עמלה באגורות, המרות תאריך עברי ו-UUID v7.
              </p>
            </div>
            <span className="text-xs font-bold text-emerald-700">
              עברו בהצלחה: {unitTestResults.filter((r) => r.passed).length} / {unitTestResults.length}
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {unitTestResults.map((res, idx) => (
              <div key={idx} className="py-3 flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{res.name}</span>
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5 font-mono">{res.details}</div>
                </div>
                <span className="text-xs font-mono text-slate-500 whitespace-nowrap">
                  {res.category}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
