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
  onUpdateUserRoleAndPermissions: (
    targetUser: ParsedUserRecord,
    newRole: RoleTemplateName,
    newIsBlocked: boolean,
    newDomains: Record<PermissionDomain, AccessLevel>,
    newSensitive: Record<SensitivePermission, boolean>
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
      // שמירת גיבוי אוטומטי בזיכרון המקומי לפני שחזור/מיגרציה
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
            אבטחה, הרשאות גמישות (RBAC), יומן ביקורת, גיבויים ובדיקות יחידה
          </h2>
          <p className="text-sm text-slate-600">
            4 רמות גישה לכל תחום, הרשאות רגישות נפרדות, מניעת השארת המערכת ללא מנהל פעיל, ויומן שינויים מלא.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('rbac')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'rbac' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            משתמשים והרשאות (RBAC)
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
            ייצוא, גיבוי מוצפן ועדכון גרסאות
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
          {users
            .filter((u) => !u.deletedAt)
            .map((user) => (
              <div
                key={user.id}
                className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-slate-800" />
                      <span className="font-bold text-base text-slate-900">{user.displayName}</span>
                      <span className="text-xs text-slate-500 font-mono">({user.email})</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 font-mono">
                      UUIDv7: {user.id} · גרסת סשן פעיל: #{user.sessionVersion}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div>
                      <label className="block text-[11px] text-slate-500 mb-0.5">תבנית תפקיד (נקודת מוצא):</label>
                      <select
                        disabled={!canManageUsers}
                        value={user.roleTemplate}
                        onChange={(e) =>
                          handleRoleTemplateSelect(user, e.target.value as RoleTemplateName)
                        }
                        className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white font-semibold"
                      >
                        {(Object.keys(ROLE_TEMPLATE_LABELS) as RoleTemplateName[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_TEMPLATE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </div>

                    {canManageUsers && (
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
                    )}
                  </div>
                </div>

                {/* 8 Domain Permissions Grid */}
                <div>
                  <h4 className="text-xs font-bold text-slate-700 mb-2">
                    הרשאות גרנולאריות לפי תחום (4 רמות גישה לכל תחום):
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {(Object.keys(PERMISSION_DOMAIN_LABELS) as PermissionDomain[]).map((dom) => (
                      <div key={dom} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                        <label className="block text-xs font-semibold text-slate-800 mb-1">
                          {PERMISSION_DOMAIN_LABELS[dom]}
                        </label>
                        <select
                          disabled={!canManageUsers}
                          value={user.permissions[dom] || 'none'}
                          onChange={(e) =>
                            handleDomainLevelChange(user, dom, e.target.value as AccessLevel)
                          }
                          className="w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                        >
                          {(Object.keys(ACCESS_LEVEL_LABELS) as AccessLevel[]).map((lvl) => (
                            <option key={lvl} value={lvl}>
                              {ACCESS_LEVEL_LABELS[lvl]}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 4 Sensitive Permissions */}
                <div className="pt-2 border-t border-slate-100">
                  <h4 className="text-xs font-bold text-slate-700 mb-2">
                    הרשאות נפרדות לפעולות רגישות:
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {(Object.keys(SENSITIVE_PERMISSION_LABELS) as SensitivePermission[]).map(
                      (perm) => (
                        <label
                          key={perm}
                          className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            disabled={!canManageUsers}
                            checked={Boolean(user.sensitivePermissions[perm])}
                            onChange={() => handleSensitiveToggle(user, perm)}
                          />
                          <span>{SENSITIVE_PERMISSION_LABELS[perm]}</span>
                        </label>
                      )
                    )}
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <h3 className="text-sm font-bold text-slate-900">
              יומן שינויים וביקורת אבטחה (Audit Log — בלתי ניתן למחיקה)
            </h3>
            <p className="text-xs text-slate-500">
              מתעד באופן אוטומטי כל שינוי הרשאה, חסימת משתמש, חשיפת תעודת זהות מוצפנת, ייצוא או שחזור גיבוי (מי, למי, מה, מתי).
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-4">מתי (חותמת זמן)</th>
                  <th className="py-2.5 px-4">מי ביצע</th>
                  <th className="py-2.5 px-4">סוג פעולה</th>
                  <th className="py-2.5 px-4">על מי / יעד</th>
                  <th className="py-2.5 px-4">פירוט מלא</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {log.createdAt.replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-slate-900">{log.actorName}</td>
                    <td className="py-2.5 px-4 font-semibold text-amber-900">{log.actionType}</td>
                    <td className="py-2.5 px-4 text-slate-700">{log.targetName}</td>
                    <td className="py-2.5 px-4 text-slate-600">{log.details}</td>
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
                onClick={ async () => {
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

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
            <h3 className="text-base font-bold text-slate-900">
              מדריך עדכון גרסאות פשוט ושקיפות תשתית חינמית
            </h3>
            <div className="text-xs text-slate-700 space-y-2 leading-relaxed">
              <p>
                <strong>1. איך מעדכנים גרסה בבטחה (פקודות פשוטות):</strong><br />
                לפני כל שדרוג, לחץ על <em>&quot;הורדת גיבוי מלא מוצפן&quot;</em>. המערכת בנויה ממודולים עצמאיים ושומרת אוטומטית עותק גיבוי לפני כל מיגרציה.
              </p>
              <p>
                <strong>2. מגבלות השכבה החינמית ופתרונן המובנה:</strong>
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-600">
                <li>
                  <strong>התעוררות שרת (Cold Start):</strong> נפתר באמצעות מטמון אופליין מקומי (PWA) הטוען את המסך מיידית ומסתנכרן ברקע.
                </li>
                <li>
                  <strong>מכסת קריאות יומית:</strong> קואורדינטות המפה נשמרות בבסיס הנתונים כך שלא מתבצעות קריאות Geocoding כפולות.
                </li>
                <li>
                  <strong>הכנה לאפליקציית דסקטופ ומובייל מקומית:</strong> כל הרשומות משתמשות ב-<code>UUID v7</code> ובשדות <code>created_at</code>, <code>updated_at</code>, ו-<code>deleted_at</code> (מחיקה רכה) לסנכרון חלק.
                </li>
              </ul>
            </div>
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
