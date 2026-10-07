/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import {
  Calendar,
  GitBranch,
  Wallet,
  Users,
  MapPin,
  Shield,
  Search,
  Plus,
  LogOut,
  Lock,
  LayoutDashboard,
} from 'lucide-react';
import {
  auth,
  db,
  googleSignIn,
  clearCachedAccessToken,
  OperationType,
  handleFirestoreError,
  sanitizeForFirestore,
  testFirestoreConnection,
} from './lib/firebase';
import {
  generateUuidV7,
  fromGregorianDate,
  formatAgorotToIls,
} from './lib/erp-core';
import {
  getDefaultPermissionsForRole,
  hasDomainAccess,
  RoleTemplateName,
  PermissionDomain,
  AccessLevel,
  SensitivePermission,
} from './lib/rbac';
import {
  UserRecord,
  ParsedUserRecord,
  AuditLogRecord,
  AnnualActivityRecord,
  TaskNodeRecord,
  DynamicTemplateRecord,
  FinancialTransactionRecord,
  DonorContactRecord,
  VolunteerEntityRecord,
} from './types/erp';
import {
  buildSeedTemplates,
  buildSeedAnnualActivities,
  buildSeedTasks,
  buildSeedDonorsAndTransactions,
} from './lib/seed-data';
import { PWAControls } from './components/PWAControls';
import { DashboardView } from './components/DashboardView';
import { AnnualPlanView } from './components/AnnualPlanView';
import { TasksDagView } from './components/TasksDagView';
import { FinancesView } from './components/FinancesView';
import { CrmDonorsView } from './components/CrmDonorsView';
import { GisMapView } from './components/GisMapView';
import { RbacSettingsView } from './components/RbacSettingsView';

type NavTab =
  | 'dashboard'
  | 'annual_plan'
  | 'tasks_dag'
  | 'finances'
  | 'crm_donors'
  | 'gis_map'
  | 'rbac_settings';

const LOCAL_CACHE_KEY = 'chabad_erp_offline_repository_v1';

export default function App() {
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Local username/password login support alongside Google Auth
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [localLoggedInName, setLocalLoggedInName] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setLoginError(null);
    try {
      await googleSignIn();
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request'
      ) {
        return;
      }
      setLoginError('ההתחברות לחשבון Google הופסקה או נחסמה על ידי הדפדפן.');
    }
  };

  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [selectedDonorId, setSelectedDonorId] = useState<string | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');

  // Repository State (lazy-initialized once from local cache or seed data for zero-latency / offline support)
  const seedInitial = useMemo(() => {
    const tpls = buildSeedTemplates();
    const acts = buildSeedAnnualActivities(tpls);
    const tsks = buildSeedTasks(acts);
    const dAndTx = buildSeedDonorsAndTransactions();
    return { tpls, acts, tsks, dAndTx };
  }, []);

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [templates, setTemplates] = useState<DynamicTemplateRecord[]>(() => seedInitial.tpls);
  const [activities, setActivities] = useState<AnnualActivityRecord[]>(() => seedInitial.acts);
  const [tasks, setTasks] = useState<TaskNodeRecord[]>(() => seedInitial.tsks);
  const [transactions, setTransactions] = useState<FinancialTransactionRecord[]>(
    () => seedInitial.dAndTx.transactions
  );
  const [donors, setDonors] = useState<DonorContactRecord[]>(
    () => seedInitial.dAndTx.donors
  );
  const [communityEntities, setCommunityEntities] = useState<VolunteerEntityRecord[]>(
    () => seedInitial.dAndTx.communityEntities
  );

  // Load offline repository cache on boot
  useEffect(() => {
    try {
      const cached = localStorage.getItem(LOCAL_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.templates?.length) setTemplates(parsed.templates);
        if (parsed.activities?.length) setActivities(parsed.activities);
        if (parsed.tasks?.length) setTasks(parsed.tasks);
        if (parsed.transactions?.length) setTransactions(parsed.transactions);
        if (parsed.donors?.length) setDonors(parsed.donors);
        if (parsed.communityEntities?.length) setCommunityEntities(parsed.communityEntities);
      }
    } catch {
      // Ignore corrupt local cache
    }
  }, []);

  // Persist repository state to local cache for offline continuity
  useEffect(() => {
    try {
      localStorage.setItem(
        LOCAL_CACHE_KEY,
        JSON.stringify({
          templates,
          activities,
          tasks,
          transactions,
          donors,
          communityEntities,
        })
      );
    } catch {
      // Ignore quota errors
    }
  }, [templates, activities, tasks, transactions, donors, communityEntities]);

  // Global keyboard shortcuts: Ctrl+K (Command Palette) & Ctrl+N (New entry in active module)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setShowCommandPalette(true);
        setCommandQuery('חדש');
      } else if (e.key === 'Escape') {
        setShowCommandPalette(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Auth listener & User Profile Synchronization
  useEffect(() => {
    let isMounted = true;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!isMounted) return;
      setFbUser(user);

      if (user) {
        await testFirestoreConnection();
        const isPrimaryAdmin = user.email === 'chabadneveyosef@gmail.com';
        const role: RoleTemplateName = isPrimaryAdmin ? 'admin' : 'volunteer';
        const defaults = getDefaultPermissionsForRole(role);
        const now = new Date().toISOString();

        const userDocRef = doc(db, 'users', user.uid);
        try {
          const existingSnap = await getDoc(userDocRef);
          if (!existingSnap.exists()) {
            const newUserRecord: UserRecord = {
              id: user.uid,
              uid: user.uid,
              email: user.email || '',
              displayName: user.displayName || user.email || 'שליח בית חב״ד',
              roleTemplate: role,
              isBlocked: false,
              sessionVersion: 1,
              permissionsJson: JSON.stringify(defaults.domains),
              sensitivePermissionsJson: JSON.stringify(defaults.sensitive),
              createdAt: now,
              updatedAt: now,
            };
            await setDoc(userDocRef, sanitizeForFirestore(newUserRecord));
          }
        } catch {
          // Operate with local profile if offline or rules restrict
        }
      }

      if (isMounted) {
        setAuthReady(true);
      }
    });
    return () => {
      isMounted = false;
      unsub();
    };
  }, []);

  // Parse users with RBAC maps (memoized)
  const parsedUsers: ParsedUserRecord[] = useMemo(() => {
    return users.map((u) => {
      const def = getDefaultPermissionsForRole(u.roleTemplate || 'volunteer');
      let domains = def.domains;
      let sensitive = def.sensitive;
      try {
        if (u.permissionsJson) domains = JSON.parse(u.permissionsJson);
        if (u.sensitivePermissionsJson) sensitive = JSON.parse(u.sensitivePermissionsJson);
      } catch {
        // use default
      }
      return { ...u, permissions: domains, sensitivePermissions: sensitive };
    });
  }, [users]);

  const currentUser: ParsedUserRecord = useMemo(() => {
    const found = parsedUsers.find((u) => u.uid === fbUser?.uid);
    if (found) return found;
    const isPrimaryAdmin = !fbUser || fbUser.email === 'chabadneveyosef@gmail.com';
    const role: RoleTemplateName = isPrimaryAdmin ? 'admin' : 'volunteer';
    const def = getDefaultPermissionsForRole(role);
    return {
      id: fbUser?.uid || 'local-admin',
      uid: fbUser?.uid || 'local-admin',
      email: fbUser?.email || 'chabadneveyosef@gmail.com',
      displayName: fbUser?.displayName || 'מנהל בית חב״ד',
      roleTemplate: role,
      isBlocked: false,
      sessionVersion: 1,
      permissionsJson: JSON.stringify(def.domains),
      sensitivePermissionsJson: JSON.stringify(def.sensitive),
      permissions: def.domains,
      sensitivePermissions: def.sensitive,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }, [parsedUsers, fbUser]);

  // Firestore Real-time Sync Listeners (aligned with Auth & RBAC lifecycle)
  useEffect(() => {
    if (!authReady || !fbUser) return;

    const onSyncError = (err: unknown, path: string) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unavailable') || msg.includes('offline')) {
        // Operate silently from local offline cache when Cloud Firestore is unreachable
        return;
      }
      handleFirestoreError(err, OperationType.LIST, path);
    };

    const isUserAdmin =
      fbUser.email === 'chabadneveyosef@gmail.com' || currentUser.roleTemplate === 'admin';

    const usersQuery = isUserAdmin
      ? collection(db, 'users')
      : query(collection(db, 'users'), where('uid', '==', fbUser.uid));

    const unsubUsers = onSnapshot(
      usersQuery,
      (snap) => {
        if (!snap.empty) {
          setUsers(snap.docs.map((d) => d.data() as UserRecord));
        }
      },
      (err) => onSyncError(err, 'users')
    );

    const unsubAudit = onSnapshot(
      collection(db, 'audit_logs'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as AuditLogRecord);
        list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        setAuditLogs(list);
      },
      (err) => onSyncError(err, 'audit_logs')
    );

    const unsubActivities = onSnapshot(
      collection(db, 'annual_activities'),
      (snap) => {
        if (!snap.empty) {
          setActivities(snap.docs.map((d) => d.data() as AnnualActivityRecord));
        }
      },
      (err) => onSyncError(err, 'annual_activities')
    );

    const unsubTasks = onSnapshot(
      collection(db, 'tasks'),
      (snap) => {
        if (!snap.empty) {
          setTasks(snap.docs.map((d) => d.data() as TaskNodeRecord));
        }
      },
      (err) => onSyncError(err, 'tasks')
    );

    const unsubTemplates = onSnapshot(
      collection(db, 'templates'),
      (snap) => {
        if (!snap.empty) {
          setTemplates(snap.docs.map((d) => d.data() as DynamicTemplateRecord));
        }
      },
      (err) => onSyncError(err, 'templates')
    );

    const unsubTx = onSnapshot(
      collection(db, 'transactions'),
      (snap) => {
        if (!snap.empty) {
          setTransactions(snap.docs.map((d) => d.data() as FinancialTransactionRecord));
        }
      },
      (err) => onSyncError(err, 'transactions')
    );

    const unsubDonors = onSnapshot(
      collection(db, 'donors'),
      (snap) => {
        if (!snap.empty) {
          setDonors(snap.docs.map((d) => d.data() as DonorContactRecord));
        }
      },
      (err) => onSyncError(err, 'donors')
    );

    const unsubCommunity = onSnapshot(
      collection(db, 'community_entities'),
      (snap) => {
        if (!snap.empty) {
          setCommunityEntities(snap.docs.map((d) => d.data() as VolunteerEntityRecord));
        }
      },
      (err) => onSyncError(err, 'community_entities')
    );

    return () => {
      unsubUsers();
      unsubAudit();
      unsubActivities();
      unsubTasks();
      unsubTemplates();
      unsubTx();
      unsubDonors();
      unsubCommunity();
    };
  }, [authReady, fbUser, currentUser.roleTemplate]);

  // Immediate session termination if current user becomes blocked
  useEffect(() => {
    if (currentUser.isBlocked && fbUser) {
      signOut(auth);
    }
  }, [currentUser.isBlocked, fbUser]);

  // Helper to write Audit Log
  const writeAuditLog = useCallback(
    async (actionType: string, targetId: string, targetName: string, details: string) => {
      const now = new Date().toISOString();
      const logId = generateUuidV7();
      const record: AuditLogRecord = {
        id: logId,
        actorUid: currentUser.uid,
        actorName: currentUser.displayName,
        targetId,
        targetName,
        actionType,
        details,
        createdAt: now,
        updatedAt: now,
      };
      setAuditLogs((prev) => [record, ...prev]);
      if (fbUser) {
        try {
          await setDoc(doc(db, 'audit_logs', logId), sanitizeForFirestore(record));
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `audit_logs/${logId}`);
        }
      }
    },
    [currentUser.uid, currentUser.displayName, fbUser]
  );

  // Seed initial data into Firestore if empty on first admin login
  const handleSyncSeedToCloud = async () => {
    if (!fbUser) return;
    try {
      for (const tpl of templates) {
        await setDoc(doc(db, 'templates', tpl.id), sanitizeForFirestore(tpl));
      }
      for (const act of activities) {
        await setDoc(doc(db, 'annual_activities', act.id), sanitizeForFirestore(act));
      }
      for (const t of tasks) {
        await setDoc(doc(db, 'tasks', t.id), sanitizeForFirestore(t));
      }
      for (const tx of transactions) {
        await setDoc(doc(db, 'transactions', tx.id), sanitizeForFirestore(tx));
      }
      for (const d of donors) {
        await setDoc(doc(db, 'donors', d.id), sanitizeForFirestore(d));
      }
      for (const c of communityEntities) {
        await setDoc(doc(db, 'community_entities', c.id), sanitizeForFirestore(c));
      }
      await writeAuditLog('סנכרון נתוני בסיס (Seed)', 'system', 'מסד נתונים ענן', 'סנכרון ראשוני של תבניות ונתוני בית חב״ד לענן');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'seed_sync');
    }
  };

  const todayHebrew = fromGregorianDate(new Date());

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 Zones (Brand, 4-6 Nav Links, 1-2 Primary Actions) */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-4">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('dashboard');
          }}
          className="text-xl font-bold tracking-tight text-slate-900 font-display whitespace-nowrap"
        >
          בית חב״ד ERP
        </a>

        {/* Zone 2: Clean text navigation links */}
        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap py-1 ${
              activeTab === 'dashboard' ? 'text-slate-900 font-bold border-b-2 border-slate-900' : ''
            }`}
          >
            דשבורד ראשי
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('annual_plan')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap py-1 ${
              activeTab === 'annual_plan' ? 'text-slate-900 font-bold border-b-2 border-slate-900' : ''
            }`}
          >
            תוכנית שנתית
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('tasks_dag')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap py-1 ${
              activeTab === 'tasks_dag' ? 'text-slate-900 font-bold border-b-2 border-slate-900' : ''
            }`}
          >
            תכנון משימות ו-DAG
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('finances')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap py-1 ${
              activeTab === 'finances' ? 'text-slate-900 font-bold border-b-2 border-slate-900' : ''
            }`}
          >
            כספים ועמותה שנייה
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('crm_donors')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap py-1 ${
              activeTab === 'crm_donors' ? 'text-slate-900 font-bold border-b-2 border-slate-900' : ''
            }`}
          >
            תורמים ומתנדבים
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('gis_map')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap py-1 ${
              activeTab === 'gis_map' ? 'text-slate-900 font-bold border-b-2 border-slate-900' : ''
            }`}
          >
            מפת GIS
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('rbac_settings')}
            className={`hidden xl:inline-block hover:text-slate-900 transition-colors whitespace-nowrap py-1 ${
              activeTab === 'rbac_settings' ? 'text-slate-900 font-bold border-b-2 border-slate-900' : ''
            }`}
          >
            הרשאות וגיבוי
          </button>
        </nav>

        {/* Zone 3: 1-2 primary actions */}
        <div className="flex items-center gap-3">
          <PWAControls />
          <button
            type="button"
            onClick={() => setShowCommandPalette(true)}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
            title="חיפוש מהיר וקיצורי מקשים (Ctrl+K)"
          >
            <Search className="w-3.5 h-3.5" />
            <span>חיפוש (Ctrl+K)</span>
          </button>
          {fbUser || localLoggedInName ? (
            <button
              type="button"
              onClick={() => {
                setLocalLoggedInName(null);
                clearCachedAccessToken();
                if (fbUser) signOut(auth);
              }}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>התנתק</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
            >
              התחברות מנהל לענן
            </button>
          )}
        </div>
      </header>

      {/* Sub-header context bar with Hebrew Date, Sunset & Quick Sync */}
      <div className="bg-slate-900 text-slate-200 px-6 py-2 text-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span>היום בלוח העברי: <strong>{todayHebrew.hebrewDisplay}</strong></span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">{todayHebrew.gregorianIso}</span>
          <span aria-hidden="true">·</span>
          <span>שקיעה היום (נווה יוסף, חיפה): <strong className="font-mono">{todayHebrew.sunsetTime}</strong></span>
        </div>

        <div className="flex items-center gap-3">
          <span>
            משתמש פעיל: <strong>{localLoggedInName || currentUser.displayName}</strong>
          </span>
          {fbUser && (
            <button
              type="button"
              onClick={handleSyncSeedToCloud}
              className="underline text-amber-300 hover:text-amber-200"
            >
              סנכרן נתוני התחלה לענן
            </button>
          )}
        </div>
      </div>

      {/* Mobile Navigation Bar */}
      <div className="lg:hidden flex overflow-x-auto bg-white border-b border-slate-200 px-4 py-2 gap-2">
        {[
          { id: 'dashboard', label: 'דשבורד', icon: LayoutDashboard },
          { id: 'annual_plan', label: 'תוכנית שנתית', icon: Calendar },
          { id: 'tasks_dag', label: 'משימות ו-DAG', icon: GitBranch },
          { id: 'finances', label: 'כספים', icon: Wallet },
          { id: 'crm_donors', label: 'תורמים CRM', icon: Users },
          { id: 'gis_map', label: 'מפה', icon: MapPin },
          { id: 'rbac_settings', label: 'הרשאות וגיבוי', icon: Shield },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id as NavTab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === item.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-8">
        {!fbUser && !localLoggedInName && (
          <div className="mb-6 bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-600" />
                מצב עבודה מקומי פעיל — התחבר לענן לסנכרון רב-מכשירים ואכיפת הרשאות בשרת
              </h3>
              <p className="text-xs text-slate-600">
                ניתן לעבוד כעת באופן מלא באופליין או להתחבר עם שם משתמש וסיסמה / חשבון Google לסנכרון מול הענן.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setLoginError(null);
                if (!usernameInput.trim() || !passwordInput.trim()) {
                  setLoginError('נא להזין שם משתמש וסיסמה');
                  return;
                }
                setLocalLoggedInName(usernameInput.trim());
                setUsernameInput('');
                setPasswordInput('');
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="שם משתמש"
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="סיסמה"
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-slate-800 text-white text-xs font-semibold rounded-lg hover:bg-slate-700"
              >
                כניסה
              </button>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700"
              >
                אימות Google מהיר
              </button>
              {loginError && <span className="text-xs text-red-600 w-full">{loginError}</span>}
            </form>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <DashboardView
            userName={localLoggedInName || currentUser.displayName}
            activities={activities}
            tasks={tasks}
            transactions={transactions}
            donors={donors}
            communityEntities={communityEntities}
            canWriteTasks={hasDomainAccess(currentUser.permissions, 'annual_plan_tasks', 'write')}
            onToggleTaskCompleted={async (task) => {
              const now = new Date().toISOString();
              const updated: TaskNodeRecord = {
                ...task,
                isCompleted: !task.isCompleted,
                updatedAt: now,
              };
              setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'tasks', task.id), sanitizeForFirestore(updated));
                } catch (err) {
                  handleFirestoreError(err, OperationType.UPDATE, `tasks/${task.id}`);
                }
              }
            }}
            onNavigateTab={(tab) => setActiveTab(tab)}
          />
        )}

        {activeTab === 'annual_plan' && (
          <AnnualPlanView
            activities={activities}
            templates={templates}
            tasks={tasks}
            canWrite={hasDomainAccess(currentUser.permissions, 'annual_plan_tasks', 'write')}
            defaultLocationName="חיפה - נווה יוסף"
            defaultLat={32.784}
            defaultLng={35.0195}
            onSaveActivity={async (data, existingId) => {
              const now = new Date().toISOString();
              const id = existingId || generateUuidV7();
              const existing = activities.find((a) => a.id === id);
              const record: AnnualActivityRecord = {
                ...data,
                id,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
              };
              setActivities((prev) =>
                existingId ? prev.map((a) => (a.id === id ? record : a)) : [...prev, record]
              );
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'annual_activities', id), sanitizeForFirestore(record));
                } catch (err) {
                  handleFirestoreError(err, OperationType.WRITE, `annual_activities/${id}`);
                }
              }
              return id;
            }}
            onToggleExecuted={async (act) => {
              const now = new Date().toISOString();
              const updated: AnnualActivityRecord = {
                ...act,
                isExecuted: !act.isExecuted,
                updatedAt: now,
              };
              setActivities((prev) => prev.map((a) => (a.id === act.id ? updated : a)));
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'annual_activities', act.id), sanitizeForFirestore(updated));
                } catch (err) {
                  handleFirestoreError(err, OperationType.UPDATE, `annual_activities/${act.id}`);
                }
              }
            }}
            onSoftDeleteActivity={async (id) => {
              const now = new Date().toISOString();
              const target = activities.find((a) => a.id === id);
              if (!target) return;
              const updated: AnnualActivityRecord = { ...target, deletedAt: now, updatedAt: now };
              setActivities((prev) => prev.map((a) => (a.id === id ? updated : a)));
              await writeAuditLog('מחיקה רכה של פעילות שנתית', id, target.title, 'סומן deleted_at');
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'annual_activities', id), sanitizeForFirestore(updated));
                } catch (err) {
                  handleFirestoreError(err, OperationType.UPDATE, `annual_activities/${id}`);
                }
              }
            }}
            onSaveTask={async (data, existingId) => {
              const now = new Date().toISOString();
              const id = existingId || generateUuidV7();
              const existing = tasks.find((t) => t.id === id);
              const record: TaskNodeRecord = {
                ...data,
                id,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
              };
              setTasks((prev) =>
                existingId ? prev.map((t) => (t.id === id ? record : t)) : [...prev, record]
              );
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'tasks', id), sanitizeForFirestore(record));
                } catch (err) {
                  handleFirestoreError(err, OperationType.WRITE, `tasks/${id}`);
                }
              }
            }}
            onToggleTaskCompleted={async (task) => {
              const now = new Date().toISOString();
              const updated: TaskNodeRecord = {
                ...task,
                isCompleted: !task.isCompleted,
                updatedAt: now,
              };
              setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'tasks', task.id), sanitizeForFirestore(updated));
                } catch (err) {
                  handleFirestoreError(err, OperationType.UPDATE, `tasks/${task.id}`);
                }
              }
            }}
            onSoftDeleteTask={async (id) => {
              const now = new Date().toISOString();
              const target = tasks.find((t) => t.id === id);
              if (!target) return;
              const updated: TaskNodeRecord = { ...target, deletedAt: now, updatedAt: now };
              setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'tasks', id), sanitizeForFirestore(updated));
                } catch (err) {
                  handleFirestoreError(err, OperationType.UPDATE, `tasks/${id}`);
                }
              }
            }}
          />
        )}

        {activeTab === 'tasks_dag' && (
          <TasksDagView
            tasks={tasks}
            canWrite={hasDomainAccess(currentUser.permissions, 'annual_plan_tasks', 'write')}
            onSaveTask={async (data, existingId) => {
              const now = new Date().toISOString();
              const id = existingId || generateUuidV7();
              const existing = tasks.find((t) => t.id === id);
              const record: TaskNodeRecord = {
                ...data,
                id,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
              };
              setTasks((prev) =>
                existingId ? prev.map((t) => (t.id === id ? record : t)) : [...prev, record]
              );
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'tasks', id), sanitizeForFirestore(record));
                } catch (err) {
                  handleFirestoreError(err, OperationType.WRITE, `tasks/${id}`);
                }
              }
            }}
            onToggleTaskCompleted={async (task) => {
              const now = new Date().toISOString();
              const updated: TaskNodeRecord = {
                ...task,
                isCompleted: !task.isCompleted,
                updatedAt: now,
              };
              setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'tasks', task.id), sanitizeForFirestore(updated));
                } catch (err) {
                  handleFirestoreError(err, OperationType.UPDATE, `tasks/${task.id}`);
                }
              }
            }}
            onSoftDeleteTask={async (id) => {
              const now = new Date().toISOString();
              const target = tasks.find((t) => t.id === id);
              if (!target) return;
              const updated: TaskNodeRecord = { ...target, deletedAt: now, updatedAt: now };
              setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'tasks', id), sanitizeForFirestore(updated));
                } catch (err) {
                  handleFirestoreError(err, OperationType.UPDATE, `tasks/${id}`);
                }
              }
            }}
          />
        )}

        {activeTab === 'finances' && (
          <FinancesView
            transactions={transactions}
            donors={donors}
            canReadRegular={hasDomainAccess(currentUser.permissions, 'regular_finances', 'read')}
            canWriteRegular={hasDomainAccess(currentUser.permissions, 'regular_finances', 'write')}
            canReadSecondAssoc={hasDomainAccess(currentUser.permissions, 'second_association', 'read')}
            canWriteSecondAssoc={hasDomainAccess(currentUser.permissions, 'second_association', 'write')}
            defaultFeePercent={3}
            onSaveTransaction={async (data) => {
              const now = new Date().toISOString();
              const id = generateUuidV7();
              const record: FinancialTransactionRecord = {
                ...data,
                id,
                createdAt: now,
                updatedAt: now,
              };
              setTransactions((prev) => [record, ...prev]);
              await writeAuditLog(
                `רישום תנועה כספית (${data.fundSource === 'regular' ? 'רגיל' : 'עמותה שנייה'})`,
                id,
                data.description,
                `נטו: ${formatAgorotToIls(data.netAmountAgorot)} (עמלה: ${data.feePercent}%)`
              );
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'transactions', id), sanitizeForFirestore(record));
                } catch (err) {
                  handleFirestoreError(err, OperationType.CREATE, `transactions/${id}`);
                }
              }
            }}
            onUpdateTransactionStatus={async (tx, newStatus) => {
              const now = new Date().toISOString();
              const updated: FinancialTransactionRecord = {
                ...tx,
                status: newStatus,
                updatedAt: now,
              };
              setTransactions((prev) => prev.map((t) => (t.id === tx.id ? updated : t)));
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'transactions', tx.id), sanitizeForFirestore(updated));
                } catch (err) {
                  handleFirestoreError(err, OperationType.UPDATE, `transactions/${tx.id}`);
                }
              }
            }}
            onSoftDeleteTransaction={async (id) => {
              const now = new Date().toISOString();
              const target = transactions.find((t) => t.id === id);
              if (!target) return;
              const updated: FinancialTransactionRecord = {
                ...target,
                deletedAt: now,
                updatedAt: now,
              };
              setTransactions((prev) => prev.map((t) => (t.id === id ? updated : t)));
              await writeAuditLog('מחיקה רכה של תנועה כספית', id, target.description, 'סומן deleted_at');
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'transactions', id), sanitizeForFirestore(updated));
                } catch (err) {
                  handleFirestoreError(err, OperationType.UPDATE, `transactions/${id}`);
                }
              }
            }}
          />
        )}

        {activeTab === 'crm_donors' && (
          <CrmDonorsView
            donors={donors}
            transactions={transactions}
            communityEntities={communityEntities}
            canWriteCrm={hasDomainAccess(currentUser.permissions, 'contacts_crm', 'write')}
            canRevealNationalId={currentUser.sensitivePermissions.reveal_national_id}
            selectedDonorId={selectedDonorId}
            onSelectDonorId={setSelectedDonorId}
            onSaveDonor={async (data, existingId) => {
              const now = new Date().toISOString();
              const id = existingId || generateUuidV7();
              const existing = donors.find((d) => d.id === id);
              const record: DonorContactRecord = {
                ...data,
                id,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
              };
              setDonors((prev) =>
                existingId ? prev.map((d) => (d.id === id ? record : d)) : [record, ...prev]
              );
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'donors', id), sanitizeForFirestore(record));
                } catch (err) {
                  handleFirestoreError(err, OperationType.WRITE, `donors/${id}`);
                }
              }
            }}
            onSoftDeleteDonor={async (id) => {
              const now = new Date().toISOString();
              const target = donors.find((d) => d.id === id);
              if (!target) return;
              const updated: DonorContactRecord = { ...target, deletedAt: now, updatedAt: now };
              setDonors((prev) => prev.map((d) => (d.id === id ? updated : d)));
              await writeAuditLog('מחיקה רכה של איש קשר / תורם', id, target.fullName, 'סומן deleted_at');
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'donors', id), sanitizeForFirestore(updated));
                } catch (err) {
                  handleFirestoreError(err, OperationType.UPDATE, `donors/${id}`);
                }
              }
            }}
            onLogRevealNationalId={async (donor) => {
              await writeAuditLog(
                'חשיפת תעודת זהות מוצפנת (פעולה רגישה)',
                donor.id,
                donor.fullName,
                `נחשפה ת.ז. המסתימת ב-${donor.nationalIdLast4}`
              );
            }}
            onSaveCommunityEntity={async (data) => {
              const now = new Date().toISOString();
              const id = generateUuidV7();
              const record: VolunteerEntityRecord = {
                ...data,
                id,
                createdAt: now,
                updatedAt: now,
              };
              setCommunityEntities((prev) => [record, ...prev]);
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'community_entities', id), sanitizeForFirestore(record));
                } catch (err) {
                  handleFirestoreError(err, OperationType.CREATE, `community_entities/${id}`);
                }
              }
            }}
          />
        )}

        {activeTab === 'gis_map' && (
          <GisMapView
            donors={donors}
            communityEntities={communityEntities}
            canWrite={hasDomainAccess(currentUser.permissions, 'gis_map', 'write')}
            onUpdateDonorCoords={async (donorId, lat, lng) => {
              const now = new Date().toISOString();
              const target = donors.find((d) => d.id === donorId);
              if (!target) return;
              const updated: DonorContactRecord = { ...target, lat, lng, updatedAt: now };
              setDonors((prev) => prev.map((d) => (d.id === donorId ? updated : d)));
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'donors', donorId), sanitizeForFirestore(updated));
                } catch (err) {
                  handleFirestoreError(err, OperationType.UPDATE, `donors/${donorId}`);
                }
              }
            }}
            onSaveDonor={async (data, existingId) => {
              const now = new Date().toISOString();
              const id = existingId || generateUuidV7();
              const existing = donors.find((d) => d.id === id);
              const record: DonorContactRecord = {
                ...data,
                id,
                createdAt: existing?.createdAt || now,
                updatedAt: now,
              };
              setDonors((prev) =>
                existingId ? prev.map((d) => (d.id === id ? record : d)) : [record, ...prev]
              );
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'donors', id), sanitizeForFirestore(record));
                } catch (err) {
                  handleFirestoreError(err, OperationType.WRITE, `donors/${id}`);
                }
              }
            }}
            onSoftDeleteDonor={async (id) => {
              const now = new Date().toISOString();
              const target = donors.find((d) => d.id === id);
              if (!target) return;
              const updated: DonorContactRecord = { ...target, deletedAt: now, updatedAt: now };
              setDonors((prev) => prev.map((d) => (d.id === id ? updated : d)));
              await writeAuditLog('הסרת דייר מבניין במפה (מחיקה רכה)', id, target.fullName, 'סומן deleted_at');
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'donors', id), sanitizeForFirestore(updated));
                } catch (err) {
                  handleFirestoreError(err, OperationType.UPDATE, `donors/${id}`);
                }
              }
            }}
            onAddStreetNote={async (title, address, notes, lat, lng) => {
              const now = new Date().toISOString();
              const id = generateUuidV7();
              const record: VolunteerEntityRecord = {
                id,
                entityType: 'street_note',
                titleOrName: title,
                areaOrAddress: address,
                notes,
                lat,
                lng,
                isActive: true,
                createdAt: now,
                updatedAt: now,
              };
              setCommunityEntities((prev) => [record, ...prev]);
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'community_entities', id), sanitizeForFirestore(record));
                } catch (err) {
                  handleFirestoreError(err, OperationType.CREATE, `community_entities/${id}`);
                }
              }
            }}
            onSelectDonor={(donorId) => {
              setSelectedDonorId(donorId);
              setActiveTab('crm_donors');
            }}
          />
        )}

        {activeTab === 'rbac_settings' && (
          <RbacSettingsView
            currentUser={currentUser}
            users={parsedUsers.length > 0 ? parsedUsers : [currentUser]}
            auditLogs={auditLogs}
            templates={templates}
            activities={activities}
            tasks={tasks}
            transactions={transactions}
            donors={donors}
            communityEntities={communityEntities}
            onUpdateUserRoleAndPermissions={async (
              targetUser,
              newRole,
              newIsBlocked,
              newDomains: Record<PermissionDomain, AccessLevel>,
              newSensitive: Record<SensitivePermission, boolean>
            ) => {
              const now = new Date().toISOString();
              const nextSessionVersion = newIsBlocked
                ? targetUser.sessionVersion + 1
                : targetUser.sessionVersion;
              const updated: UserRecord = {
                id: targetUser.id,
                uid: targetUser.uid,
                email: targetUser.email,
                displayName: targetUser.displayName,
                roleTemplate: newRole,
                isBlocked: newIsBlocked,
                sessionVersion: nextSessionVersion,
                permissionsJson: JSON.stringify(newDomains),
                sensitivePermissionsJson: JSON.stringify(newSensitive),
                createdAt: targetUser.createdAt,
                updatedAt: now,
              };
              setUsers((prev) => prev.map((u) => (u.id === targetUser.id ? updated : u)));
              await writeAuditLog(
                newIsBlocked !== targetUser.isBlocked ? 'שינוי סטטוס חסימת משתמש' : 'עדכון הרשאות RBAC',
                targetUser.id,
                targetUser.displayName,
                `תפקיד: ${newRole}, חסום: ${newIsBlocked}, גרסת סשן: #${nextSessionVersion}`
              );
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'users', targetUser.id), sanitizeForFirestore(updated));
                } catch (err) {
                  handleFirestoreError(err, OperationType.UPDATE, `users/${targetUser.id}`);
                }
              }
            }}
            onSaveTemplate={async (name, category, schemaJson) => {
              const now = new Date().toISOString();
              const id = generateUuidV7();
              const record: DynamicTemplateRecord = {
                id,
                name,
                category,
                schemaJson,
                createdAt: now,
                updatedAt: now,
              };
              setTemplates((prev) => [...prev, record]);
              if (fbUser) {
                try {
                  await setDoc(doc(db, 'templates', id), sanitizeForFirestore(record));
                } catch (err) {
                  handleFirestoreError(err, OperationType.CREATE, `templates/${id}`);
                }
              }
            }}
            onRestoreBackupData={async (payload) => {
              if (payload.activities) setActivities(payload.activities);
              if (payload.tasks) setTasks(payload.tasks);
              if (payload.transactions) setTransactions(payload.transactions);
              if (payload.donors) setDonors(payload.donors);
              await writeAuditLog(
                'שחזור גיבוי מלא מוצפן',
                'system',
                'כלל טבלאות המערכת',
                'שוחזרו נתונים מקובץ גיבוי מוצפן לאחר גיבוי אוטומטי מקדים'
              );
            }}
            onLogExportAction={async (format) => {
              await writeAuditLog(
                `ייצוא נתונים (${format})`,
                'system',
                'ייצוא מערכת',
                `המשתמש הפיק קובץ ייצוא בפורמט ${format}`
              );
            }}
          />
        )}
      </main>

      {/* Global Command Palette Modal (Ctrl+K / Ctrl+N) */}
      {showCommandPalette && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-20 p-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center gap-3">
              <Search className="w-5 h-5 text-slate-400" />
              <input
                type="text"
                autoFocus
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                placeholder="חפש תורם, משימה, או הקלד פקודה מהירה (Esc לסגירה)..."
                className="flex-1 text-sm text-slate-900 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowCommandPalette(false)}
                className="text-xs text-slate-400 hover:text-slate-700"
              >
                ESC
              </button>
            </div>
            <div className="p-3 max-h-80 overflow-y-auto divide-y divide-slate-100 text-xs">
              <div className="py-2 space-y-1">
                <div className="text-slate-400 font-semibold px-2">ניווט ופעולות מהירות (Ctrl+N / Ctrl+K)</div>
                {[
                  { label: 'מעבר לדשבורד הראשי ותזכורות משימות', tab: 'dashboard' as NavTab },
                  { label: 'מעבר לתוכנית שנתית ולוח עברי', tab: 'annual_plan' as NavTab },
                  { label: 'מעבר למשימות, פרויקטים ומסלול קריטי (DAG)', tab: 'tasks_dag' as NavTab },
                  { label: 'מעבר לדשבורד כספים והעמותה השנייה', tab: 'finances' as NavTab },
                  { label: 'מעבר ל-CRM תורמים ומתנדבים', tab: 'crm_donors' as NavTab },
                  { label: 'מעבר למפת GIS והערות רחוב', tab: 'gis_map' as NavTab },
                  { label: 'מעבר להרשאות RBAC, גיבוי ובדיקות יחידה', tab: 'rbac_settings' as NavTab },
                ].map((cmd, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setActiveTab(cmd.tab);
                      setShowCommandPalette(false);
                    }}
                    className="w-full text-right px-3 py-2 rounded-lg hover:bg-slate-100 font-medium text-slate-800 flex items-center justify-between"
                  >
                    <span>{cmd.label}</span>
                    <Plus className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clean Quiet Footer */}
      <footer className="bg-white border-t border-slate-200 px-6 py-4 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2">
        <div>בית חב״ד ERP — מערכת ניהול שנתית, כספים, תורמים וקהילה</div>
        <div>קיצורי מקשים: Ctrl+K לחיפוש מהיר · Ctrl+N לפעולה חדשה</div>
      </footer>
    </div>
  );
}
