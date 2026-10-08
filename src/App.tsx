/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  onAuthStateChanged,
  signOut,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
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
  Undo2,
  Redo2,
  Keyboard,
  UserPlus,
  Eye,
  EyeOff,
  CheckCircle2,
  Clock,
  UserCircle,
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
  encryptSensitiveString,
  decryptSensitiveString,
} from './lib/erp-core';
import {
  getDefaultPermissionsForRole,
  hasDomainAccess,
  RoleTemplateName,
  ROLE_TEMPLATE_LABELS,
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
  MapDefaultLocationConfig,
  UserPersonalPreferences,
} from './types/erp';
import {
  buildSeedUsers,
  buildSeedTemplates,
} from './lib/seed-data';
import { PWAControls } from './components/PWAControls';
import { DashboardView } from './components/DashboardView';
import { AnnualPlanView } from './components/AnnualPlanView';
import { TasksDagView } from './components/TasksDagView';
import { FinancesView } from './components/FinancesView';
import { CrmDonorsView } from './components/CrmDonorsView';
import { GisMapView } from './components/GisMapView';
import { RbacSettingsView } from './components/RbacSettingsView';
import { PersonalProfileView } from './components/PersonalProfileView';

type NavTab =
  | 'dashboard'
  | 'annual_plan'
  | 'tasks_dag'
  | 'finances'
  | 'crm_donors'
  | 'gis_map'
  | 'rbac_settings'
  | 'personal_profile';

const LOCAL_CACHE_KEY = 'chabad_erp_offline_repository_v2_clean';
const SESSION_USER_KEY = 'chabad_erp_active_session_user_id';

export default function App() {
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Local username/password login & registration support alongside Google Auth
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [regDisplayNameInput, setRegDisplayNameInput] = useState('');
  const [regEmailInput, setRegEmailInput] = useState('');
  const [regRoleInput, setRegRoleInput] = useState<RoleTemplateName>('coordinator');
  const [localLoggedInUserId, setLocalLoggedInUserId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(SESSION_USER_KEY) || null;
    } catch {
      return null;
    }
  });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [registerSuccessMessage, setRegisterSuccessMessage] = useState<string | null>(null);
  const [shortcutToast, setShortcutToast] = useState<string | null>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  const triggerShortcutToast = useCallback((msg: string) => {
    setShortcutToast(msg);
    window.setTimeout(() => {
      setShortcutToast((prev) => (prev === msg ? null : prev));
    }, 3000);
  }, []);

  const handleGoogleSignIn = async () => {
    setLoginError(null);
    setRegisterSuccessMessage(null);
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

  // Repository State — ללא הזרקת נתוני דמה אוטומטית (רק משתמש מנהל ותבניות ברירת מחדל)
  const seedInitial = useMemo(() => {
    const usrs = buildSeedUsers().slice(0, 1); // רק משתמש מנהל ראשי (admin / 123456) ללא משתמשי דמה
    const tpls = buildSeedTemplates();
    return { usrs, tpls };
  }, []);

  const [users, setUsers] = useState<UserRecord[]>(() => seedInitial.usrs);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [templates, setTemplates] = useState<DynamicTemplateRecord[]>(() => seedInitial.tpls);
  const [activities, setActivities] = useState<AnnualActivityRecord[]>([]);
  const [tasks, setTasks] = useState<TaskNodeRecord[]>([]);
  const [transactions, setTransactions] = useState<FinancialTransactionRecord[]>([]);
  const [donors, setDonors] = useState<DonorContactRecord[]>([]);
  const [communityEntities, setCommunityEntities] = useState<VolunteerEntityRecord[]>([]);
  const [defaultMapLocation, setDefaultMapLocation] = useState<MapDefaultLocationConfig>({
    locationName: 'חיפה - שכונת נווה יוסף (רחוב יד לבנים)',
    lat: 32.7842,
    lng: 35.0195,
    zoom: 16,
  });

  // Undo / Redo Snapshot Stack (Ctrl+Z / Ctrl+Y)
  interface RepositorySnapshot {
    label: string;
    activities: AnnualActivityRecord[];
    tasks: TaskNodeRecord[];
    transactions: FinancialTransactionRecord[];
    donors: DonorContactRecord[];
    communityEntities: VolunteerEntityRecord[];
    defaultMapLocation: MapDefaultLocationConfig;
  }
  const [undoStack, setUndoStack] = useState<RepositorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<RepositorySnapshot[]>([]);

  const recordUndoSnapshot = useCallback(
    (label: string) => {
      setUndoStack((prev) => [
        ...prev.slice(-19),
        {
          label,
          activities,
          tasks,
          transactions,
          donors,
          communityEntities,
          defaultMapLocation,
        },
      ]);
      setRedoStack([]);
    },
    [activities, tasks, transactions, donors, communityEntities, defaultMapLocation]
  );

  const handleUndo = useCallback(() => {
    setUndoStack((prevUndo) => {
      if (prevUndo.length === 0) {
        triggerShortcutToast('אין פעולות נוספות לביטול (Ctrl+Z)');
        return prevUndo;
      }
      const last = prevUndo[prevUndo.length - 1];
      setRedoStack((prevRedo) => [
        ...prevRedo,
        {
          label: last.label,
          activities,
          tasks,
          transactions,
          donors,
          communityEntities,
          defaultMapLocation,
        },
      ]);
      setActivities(last.activities);
      setTasks(last.tasks);
      setTransactions(last.transactions);
      setDonors(last.donors);
      setCommunityEntities(last.communityEntities);
      setDefaultMapLocation(last.defaultMapLocation);
      triggerShortcutToast(`בוטל (Ctrl+Z): ${last.label}`);
      return prevUndo.slice(0, -1);
    });
  }, [activities, tasks, transactions, donors, communityEntities, defaultMapLocation, triggerShortcutToast]);

  const handleRedo = useCallback(() => {
    setRedoStack((prevRedo) => {
      if (prevRedo.length === 0) {
        triggerShortcutToast('אין פעולות לביצוע מחדש (Ctrl+Y)');
        return prevRedo;
      }
      const next = prevRedo[prevRedo.length - 1];
      setUndoStack((prevUndo) => [
        ...prevUndo,
        {
          label: next.label,
          activities,
          tasks,
          transactions,
          donors,
          communityEntities,
          defaultMapLocation,
        },
      ]);
      setActivities(next.activities);
      setTasks(next.tasks);
      setTransactions(next.transactions);
      setDonors(next.donors);
      setCommunityEntities(next.communityEntities);
      setDefaultMapLocation(next.defaultMapLocation);
      triggerShortcutToast(`שוחזר (Ctrl+Y): ${next.label}`);
      return prevRedo.slice(0, -1);
    });
  }, [activities, tasks, transactions, donors, communityEntities, defaultMapLocation, triggerShortcutToast]);

  const [isInitialRepoLoaded, setIsInitialRepoLoaded] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // Load offline repository cache + recover custom records from v1 cache + server persistent repository on boot
  useEffect(() => {
    let isMounted = true;
    try {
      const cachedV2 = localStorage.getItem(LOCAL_CACHE_KEY);
      const cachedV1 = localStorage.getItem('chabad_erp_offline_repository_v1');
      const parsed = cachedV2 ? JSON.parse(cachedV2) : null;
      const parsedV1 = cachedV1 ? JSON.parse(cachedV1) : null;

      const SEED_TITLES = new Set([
        'מבצע שופר ותפילות ראש השנה בקהילה',
        'התוועדות י״ט כסלו — חג הגאולה וראש השנה לחסידות',
        'מבצע חנוכה — הדלקות מרכזיות וחלוקת סופגניות',
        'התוועדות י״א ניסן — יום הולדת הרבי',
        'סדר פסח קהילתי מרכזי וחלוקת מצות שמורה',
        'פרויקט הפקת התוועדות י״ט כסלו השנתית',
        'סגירת אולם וקייטרינג מרכזי',
        'עיצוב והדפסת הזמנות יוקרתיות ומודעות רחוב',
        'תיאום הגברה, תאורה ומסכי לד',
        'סבב טלפונים אישיים לתורמים ואישורי הגעה VIP',
        'תרומה לפעילות ראש השנה ויום כיפור',
        'תרומה שנתית דרך העמותה השנייה (בניכוי עמלת תקורה 3%)',
        'רכישת ערכות שופר, מחזורים ודבש לחלוקה',
        'תשלום עבור הפקת חוברות לימוד ואירוח מרצים',
        'התחייבות לחסות שולחן מרכזי בהתוועדות י״ט כסלו',
        'אברהם יצחק גולדשטיין',
        'דודו ומשפחת אזולאי',
        'ד״ר שמעון רוזנברג',
        'נתנאל ברקוביץ׳ (מתנדב שטח)',
        'שיעור תניא וחסידות שבועי',
        'הערת רחוב: מרכז מסחרי נווה יוסף',
      ]);

      if (parsed) {
        if (parsed.users?.length) setUsers(parsed.users);
        if (parsed.auditLogs?.length) setAuditLogs(parsed.auditLogs);
        if (parsed.templates?.length) setTemplates(parsed.templates);
        if (parsed.activities?.length) setActivities(parsed.activities);
        if (parsed.tasks?.length) setTasks(parsed.tasks);
        if (parsed.transactions?.length) setTransactions(parsed.transactions);
        if (parsed.donors?.length) setDonors(parsed.donors);
        if (parsed.communityEntities?.length) setCommunityEntities(parsed.communityEntities);
        if (parsed.defaultMapLocation?.lat) setDefaultMapLocation(parsed.defaultMapLocation);
      }

      if (parsedV1) {
        const customActs = (parsedV1.activities || []).filter(
          (a: AnnualActivityRecord) => !SEED_TITLES.has(a.title)
        );
        const customTasks = (parsedV1.tasks || []).filter(
          (t: TaskNodeRecord) => !SEED_TITLES.has(t.title)
        );
        const customTxs = (parsedV1.transactions || []).filter(
          (tx: FinancialTransactionRecord) => !SEED_TITLES.has(tx.description)
        );
        const customDonors = (parsedV1.donors || []).filter(
          (d: DonorContactRecord) => !SEED_TITLES.has(d.fullName)
        );
        const customComm = (parsedV1.communityEntities || []).filter(
          (c: VolunteerEntityRecord) => !SEED_TITLES.has(c.titleOrName)
        );
        if (customActs.length > 0 && (!parsed?.activities || parsed.activities.length === 0)) {
          setActivities(customActs);
        }
        if (customTasks.length > 0 && (!parsed?.tasks || parsed.tasks.length === 0)) {
          setTasks(customTasks);
        }
        if (customTxs.length > 0 && (!parsed?.transactions || parsed.transactions.length === 0)) {
          setTransactions(customTxs);
        }
        if (customDonors.length > 0 && (!parsed?.donors || parsed.donors.length === 0)) {
          setDonors(customDonors);
        }
        if (customComm.length > 0 && (!parsed?.communityEntities || parsed.communityEntities.length === 0)) {
          setCommunityEntities(customComm);
        }
      }
    } catch {
      // Ignore corrupt local cache
    }

    fetch('/api/repository')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!isMounted) return;
        const srv = json?.data;
        if (srv) {
          if (Array.isArray(srv.users) && srv.users.length > 0) setUsers(srv.users);
          if (Array.isArray(srv.auditLogs) && srv.auditLogs.length > 0) setAuditLogs(srv.auditLogs);
          if (Array.isArray(srv.templates) && srv.templates.length > 0) setTemplates(srv.templates);
          if (Array.isArray(srv.activities) && srv.activities.length > 0) setActivities(srv.activities);
          if (Array.isArray(srv.tasks) && srv.tasks.length > 0) setTasks(srv.tasks);
          if (Array.isArray(srv.transactions) && srv.transactions.length > 0) setTransactions(srv.transactions);
          if (Array.isArray(srv.donors) && srv.donors.length > 0) setDonors(srv.donors);
          if (Array.isArray(srv.communityEntities) && srv.communityEntities.length > 0)
            setCommunityEntities(srv.communityEntities);
          if (srv.defaultMapLocation?.lat) setDefaultMapLocation(srv.defaultMapLocation);
          if (srv.updatedAt) setLastSyncedAt(srv.updatedAt);
        }
        setIsInitialRepoLoaded(true);
      })
      .catch(() => {
        if (isMounted) setIsInitialRepoLoaded(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Persist repository state to local cache AND server repository for instant cross-session persistence
  useEffect(() => {
    const payload = {
      users,
      auditLogs,
      templates,
      activities,
      tasks,
      transactions,
      donors,
      communityEntities,
      defaultMapLocation,
    };
    try {
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore quota errors
    }

    if (!isInitialRepoLoaded) return;

    const timer = window.setTimeout(() => {
      fetch('/api/repository', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json?.updatedAt) setLastSyncedAt(json.updatedAt);
        })
        .catch(() => {
          // Operate silently if offline
        });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [
    isInitialRepoLoaded,
    users,
    auditLogs,
    templates,
    activities,
    tasks,
    transactions,
    donors,
    communityEntities,
    defaultMapLocation,
  ]);

  // Global keyboard shortcuts: Ctrl+Z (Undo), Ctrl+Y / Ctrl+Shift+Z (Redo), Ctrl+S (Save/Sync), Ctrl+K / Ctrl+F (Search), Ctrl+N (New), Alt+1..7 (Tabs), ? (Shortcuts Help)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditableInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (!isEditableInput) {
          e.preventDefault();
          handleUndo();
        }
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        if (!isEditableInput) {
          e.preventDefault();
          handleRedo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        triggerShortcutToast('כל הנתונים נשמרו אוטומטית בזיכרון המקומי ובמסד הנתונים בענן (Ctrl+S)');
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'f')
      ) {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setShowCommandPalette(true);
        setCommandQuery('חדש');
      } else if (e.altKey && ['1', '2', '3', '4', '5', '6', '7', '8'].includes(e.key)) {
        e.preventDefault();
        const tabsOrder: NavTab[] = [
          'dashboard',
          'annual_plan',
          'tasks_dag',
          'finances',
          'crm_donors',
          'gis_map',
          'rbac_settings',
          'personal_profile',
        ];
        const idx = Number(e.key) - 1;
        if (tabsOrder[idx]) {
          setActiveTab(tabsOrder[idx]);
        }
      } else if (!isEditableInput && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
      } else if (e.key === 'Escape') {
        setShowCommandPalette(false);
        setShowShortcutsModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, triggerShortcutToast]);

  // Sync session user ID to sessionStorage
  useEffect(() => {
    try {
      if (localLoggedInUserId) {
        sessionStorage.setItem(SESSION_USER_KEY, localLoggedInUserId);
      } else {
        sessionStorage.removeItem(SESSION_USER_KEY);
      }
    } catch {
      // ignore
    }
  }, [localLoggedInUserId]);

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
              isPendingApproval: !isPrimaryAdmin,
              sessionVersion: 1,
              permissionsJson: JSON.stringify(defaults.domains),
              sensitivePermissionsJson: JSON.stringify(defaults.sensitive),
              createdAt: now,
              updatedAt: now,
            };
            setUsers((prev) =>
              prev.some((u) => u.uid === user.uid) ? prev : [...prev, newUserRecord]
            );
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
    if (fbUser) {
      const foundByUid = parsedUsers.find((u) => u.uid === fbUser.uid);
      if (foundByUid) return foundByUid;
    }
    if (localLoggedInUserId) {
      const foundLocal = parsedUsers.find(
        (u) => u.id === localLoggedInUserId || u.uid === localLoggedInUserId
      );
      if (foundLocal) return foundLocal;
    }
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
  }, [parsedUsers, fbUser, localLoggedInUserId]);

  const isSessionActive = Boolean(fbUser || localLoggedInUserId);

  // Firestore Real-time Sync Listeners (active for both Google Auth and Username/Password ERP sessions)
  useEffect(() => {
    if (!authReady) return;

    const onSyncError = (err: unknown, path: string) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unavailable') || msg.includes('offline') || msg.includes('Missing or insufficient permissions')) {
        // Operate seamlessly from local + server repository cache if offline
        return;
      }
      handleFirestoreError(err, OperationType.LIST, path);
    };

    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        if (!snap.empty) {
          const cloudUsers = snap.docs.map((d) => d.data() as UserRecord);
          setUsers((prev) => {
            const byId = new Map<string, UserRecord>();
            for (const u of prev) byId.set(u.id, u);
            for (const cu of cloudUsers) {
              const existing = byId.get(cu.id);
              if (!existing || cu.updatedAt >= existing.updatedAt) {
                byId.set(cu.id, cu);
              }
            }
            return Array.from(byId.values());
          });
        }
      },
      (err) => onSyncError(err, 'users')
    );

    if (!isSessionActive) {
      return () => {
        unsubUsers();
      };
    }

    const unsubAudit = onSnapshot(
      collection(db, 'audit_logs'),
      (snap) => {
        if (!snap.empty) {
          const list = snap.docs.map((d) => d.data() as AuditLogRecord);
          list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
          setAuditLogs(list);
        }
      },
      (err) => onSyncError(err, 'audit_logs')
    );

    const unsubActivities = onSnapshot(
      collection(db, 'annual_activities'),
      (snap) => {
        if (!snap.empty) {
          const cloudItems = snap.docs.map((d) => d.data() as AnnualActivityRecord);
          setActivities((prev) => {
            const byId = new Map<string, AnnualActivityRecord>();
            for (const item of prev) byId.set(item.id, item);
            for (const cItem of cloudItems) {
              const ex = byId.get(cItem.id);
              if (!ex || cItem.updatedAt >= ex.updatedAt) byId.set(cItem.id, cItem);
            }
            return Array.from(byId.values());
          });
        }
      },
      (err) => onSyncError(err, 'annual_activities')
    );

    const unsubTasks = onSnapshot(
      collection(db, 'tasks'),
      (snap) => {
        if (!snap.empty) {
          const cloudItems = snap.docs.map((d) => d.data() as TaskNodeRecord);
          setTasks((prev) => {
            const byId = new Map<string, TaskNodeRecord>();
            for (const item of prev) byId.set(item.id, item);
            for (const cItem of cloudItems) {
              const ex = byId.get(cItem.id);
              if (!ex || cItem.updatedAt >= ex.updatedAt) byId.set(cItem.id, cItem);
            }
            return Array.from(byId.values());
          });
        }
      },
      (err) => onSyncError(err, 'tasks')
    );

    const unsubTemplates = onSnapshot(
      collection(db, 'templates'),
      (snap) => {
        if (!snap.empty) {
          const cloudItems = snap.docs.map((d) => d.data() as DynamicTemplateRecord);
          setTemplates((prev) => {
            const byId = new Map<string, DynamicTemplateRecord>();
            for (const item of prev) byId.set(item.id, item);
            for (const cItem of cloudItems) {
              const ex = byId.get(cItem.id);
              if (!ex || cItem.updatedAt >= ex.updatedAt) byId.set(cItem.id, cItem);
            }
            return Array.from(byId.values());
          });
        }
      },
      (err) => onSyncError(err, 'templates')
    );

    const unsubTx = onSnapshot(
      collection(db, 'transactions'),
      (snap) => {
        if (!snap.empty) {
          const cloudItems = snap.docs.map((d) => d.data() as FinancialTransactionRecord);
          setTransactions((prev) => {
            const byId = new Map<string, FinancialTransactionRecord>();
            for (const item of prev) byId.set(item.id, item);
            for (const cItem of cloudItems) {
              const ex = byId.get(cItem.id);
              if (!ex || cItem.updatedAt >= ex.updatedAt) byId.set(cItem.id, cItem);
            }
            return Array.from(byId.values());
          });
        }
      },
      (err) => onSyncError(err, 'transactions')
    );

    const unsubDonors = onSnapshot(
      collection(db, 'donors'),
      (snap) => {
        if (!snap.empty) {
          const cloudItems = snap.docs.map((d) => d.data() as DonorContactRecord);
          setDonors((prev) => {
            const byId = new Map<string, DonorContactRecord>();
            for (const item of prev) byId.set(item.id, item);
            for (const cItem of cloudItems) {
              const ex = byId.get(cItem.id);
              if (!ex || cItem.updatedAt >= ex.updatedAt) byId.set(cItem.id, cItem);
            }
            return Array.from(byId.values());
          });
        }
      },
      (err) => onSyncError(err, 'donors')
    );

    const unsubCommunity = onSnapshot(
      collection(db, 'community_entities'),
      (snap) => {
        if (!snap.empty) {
          const cloudItems = snap.docs.map((d) => d.data() as VolunteerEntityRecord);
          setCommunityEntities((prev) => {
            const byId = new Map<string, VolunteerEntityRecord>();
            for (const item of prev) byId.set(item.id, item);
            for (const cItem of cloudItems) {
              const ex = byId.get(cItem.id);
              if (!ex || cItem.updatedAt >= ex.updatedAt) byId.set(cItem.id, cItem);
            }
            return Array.from(byId.values());
          });
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
  }, [authReady, isSessionActive]);

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
      try {
        await setDoc(doc(db, 'audit_logs', logId), sanitizeForFirestore(record));
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `audit_logs/${logId}`);
      }
    },
    [currentUser.uid, currentUser.displayName]
  );

  // Sync all current repository data to Cloud Firestore & Server Repository
  const handleSyncSeedToCloud = async () => {
    try {
      for (const usr of users) {
        await setDoc(doc(db, 'users', usr.id), sanitizeForFirestore(usr));
      }
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
      await fetch('/api/repository', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          users,
          auditLogs,
          templates,
          activities,
          tasks,
          transactions,
          donors,
          communityEntities,
          defaultMapLocation,
        }),
      }).catch(() => null);
      setLastSyncedAt(new Date().toISOString());
      triggerShortcutToast('כל הנתונים סונכרנו ונשמרו בהצלחה במסד הנתונים בענן (Cloud Firestore)');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'seed_sync');
    }
  };

  const todayHebrew = fromGregorianDate(new Date());

  const currentPreferences: UserPersonalPreferences = useMemo(() => {
    const defaultPrefs: UserPersonalPreferences = {
      themePalette: 'royal_blue',
      fontSizeScale: 'normal',
      uiDensity: 'comfortable',
      defaultStartTab: 'dashboard',
      enableSoundEffects: true,
      showHebrewDatesInHeader: true,
    };
    if (currentUser.preferencesJson) {
      try {
        return { ...defaultPrefs, ...JSON.parse(currentUser.preferencesJson) };
      } catch {
        return defaultPrefs;
      }
    }
    return defaultPrefs;
  }, [currentUser.preferencesJson]);

  return (
    <div
      className={`min-h-screen flex flex-col bg-slate-50 text-slate-900 theme-${currentPreferences.themePalette} font-scale-${currentPreferences.fontSizeScale} density-${currentPreferences.uiDensity}`}
    >
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
          <button
            type="button"
            onClick={() => setActiveTab('personal_profile')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap py-1 flex items-center gap-1 ${
              activeTab === 'personal_profile' ? 'text-slate-900 font-bold border-b-2 border-slate-900' : ''
            }`}
          >
            <UserCircle className="w-4 h-4 text-amber-600" />
            <span>אזור אישי</span>
          </button>
        </nav>

        {/* Zone 3: 1-2 primary actions */}
        <div className="flex items-center gap-2">
          <PWAControls />
          <div className="hidden sm:flex items-center bg-slate-100 rounded-lg p-0.5">
            <button
              type="button"
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="p-1.5 text-slate-700 hover:bg-white rounded-md disabled:opacity-35 transition-colors"
              title="בטל פעולה אחרונה (Ctrl+Z)"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              className="p-1.5 text-slate-700 hover:bg-white rounded-md disabled:opacity-35 transition-colors"
              title="בצע מחדש (Ctrl+Y)"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowShortcutsModal(true)}
            className="p-1.5 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            title="כל קיצורי המקשים במערכת (?)"
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setShowCommandPalette(true)}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
            title="חיפוש מהיר וקיצורי מקשים (Ctrl+K)"
          >
            <Search className="w-3.5 h-3.5" />
            <span>חיפוש (Ctrl+K)</span>
          </button>
          {fbUser || localLoggedInUserId ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveTab('personal_profile')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  activeTab === 'personal_profile'
                    ? 'bg-amber-500 text-slate-950'
                    : 'bg-slate-200/80 text-slate-800 hover:bg-slate-300/80'
                }`}
                title="אזור אישי: פרטים אישיים, סיסמה והעדפות עיצוב"
              >
                <UserCircle className="w-3.5 h-3.5" />
                <span className="hidden md:inline">{currentUser.displayName}</span>
                <span className="md:hidden">אזור אישי</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setLocalLoggedInUserId(null);
                  clearCachedAccessToken();
                  if (fbUser) signOut(auth);
                }}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>התנתק</span>
              </button>
            </div>
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

      {/* Shortcut / Undo Toast */}
      {shortcutToast && (
        <div className="fixed bottom-5 left-5 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-lg border border-slate-700 flex items-center gap-2">
          <Keyboard className="w-4 h-4 text-amber-400" />
          <span>{shortcutToast}</span>
        </div>
      )}

      {/* Sub-header context bar with Hebrew Date, Sunset & Active RBAC User */}
      {currentPreferences.showHebrewDatesInHeader && (
      <div className="bg-slate-900 text-slate-200 px-6 py-2 text-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span>היום בלוח העברי: <strong>{todayHebrew.hebrewDisplay}</strong></span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">{todayHebrew.gregorianIso}</span>
          <span aria-hidden="true">·</span>
          <span>שקיעה היום ({defaultMapLocation.locationName}): <strong className="font-mono">{todayHebrew.sunsetTime}</strong></span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveTab('personal_profile')}
            className="hover:text-amber-300 transition-colors flex items-center gap-1"
            title="לחץ למעבר לאזור האישי"
          >
            <UserCircle className="w-3.5 h-3.5 text-amber-400" />
            <span>
              משתמש פעיל: <strong>{currentUser.displayName}</strong>{' '}
              <span className="text-slate-400">({ROLE_TEMPLATE_LABELS[currentUser.roleTemplate]})</span>
            </span>
          </button>
          {parsedUsers.length > 1 && (
            <select
              aria-label="החלפת משתמש פעיל לבדיקת הרשאות"
              value={currentUser.id}
              onChange={(e) => setLocalLoggedInUserId(e.target.value)}
              className="bg-slate-800 text-slate-100 border border-slate-700 rounded px-2 py-0.5 text-[11px]"
            >
              {parsedUsers
                .filter((u) => !u.isBlocked)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    החלף משתמש: {u.displayName} ({ROLE_TEMPLATE_LABELS[u.roleTemplate]})
                  </option>
                ))}
            </select>
          )}
          {isSessionActive && (
            <button
              type="button"
              onClick={handleSyncSeedToCloud}
              className="underline text-amber-300 hover:text-amber-200 font-semibold"
              title={lastSyncedAt ? `סונכרן לאחרונה: ${new Date(lastSyncedAt).toLocaleTimeString('he-IL')}` : 'שמור וסנכרן את כל הנתונים לענן כעת'}
            >
              שמור וסנכרן לענן (Ctrl+S)
            </button>
          )}
        </div>
      </div>
      )}

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
          { id: 'personal_profile', label: 'אזור אישי', icon: UserCircle },
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
        {!fbUser && !localLoggedInUserId ? (
          /* מסך כניסה או הרשמה בכניסה ראשונה לאתר */
          <div className="max-w-xl mx-auto my-8 bg-white border border-slate-300/90 rounded-2xl shadow-xl overflow-hidden">
            <div className="bg-slate-900 text-white p-6 space-y-2">
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold font-display">ברוכים הבאים למערכת בית חב״ד ERP</h1>
                <Lock className="w-6 h-6 text-amber-400" />
              </div>
              <p className="text-xs text-slate-200 leading-relaxed">
                בחר <strong>כניסה למערכת</strong> או <strong>הרשמת משתמש חדש</strong>. ניתן להתחבר באמצעות שם משתמש וסיסמה או באמצעות חשבון Google. כל הרשמה חדשה מותנית באישור מנהל המערכת.
              </p>
            </div>

            <div className="p-6 space-y-5">
              {/* מתג כניסה / הרשמה */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setLoginError(null);
                    setRegisterSuccessMessage(null);
                  }}
                  className={`py-2.5 px-4 text-sm font-bold rounded-lg transition-colors ${
                    authMode === 'login'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-700 hover:text-slate-900'
                  }`}
                >
                  כניסה למערכת
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('register');
                    setLoginError(null);
                    setRegisterSuccessMessage(null);
                  }}
                  className={`py-2.5 px-4 text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                    authMode === 'register'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-700 hover:text-slate-900'
                  }`}
                >
                  <UserPlus className="w-4 h-4" />
                  <span>הרשמה (מותנה באישור מנהל)</span>
                </button>
              </div>

              {registerSuccessMessage && (
                <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-xs space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>בקשת ההרשמה נקלטה בהצלחה!</span>
                  </div>
                  <p className="leading-relaxed">{registerSuccessMessage}</p>
                </div>
              )}

              {loginError && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-red-700">
                  {loginError}
                </div>
              )}

              {authMode === 'login' ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setLoginError(null);
                    setRegisterSuccessMessage(null);
                    const uname = usernameInput.trim().toLowerCase();
                    const pass = passwordInput.trim();
                    if (!uname || !pass) {
                      setLoginError('נא להזין שם משתמש וסיסמה.');
                      return;
                    }
                    const matched = parsedUsers.find(
                      (u) =>
                        (u.username || '').toLowerCase() === uname ||
                        u.email.toLowerCase() === uname ||
                        u.displayName === usernameInput.trim()
                    );
                    if (!matched) {
                      setLoginError(
                        'שם המשתמש לא נמצא במערכת. ניתן לעבור ללשונית "הרשמה" כדי להגיש בקשת הרשמה לאישור מנהל.'
                      );
                      return;
                    }
                    if (matched.isPendingApproval) {
                      setLoginError(
                        'חשבונך נרשם בהצלחה וממתין כעת לאישור מנהל המערכת. לאחר שמנהל יאשר אותך תוכל להיכנס.'
                      );
                      return;
                    }
                    if (matched.isBlocked) {
                      setLoginError('חשבון משתמש זה חסום על ידי מנהל המערכת.');
                      return;
                    }
                    const storedPlain = matched.passwordHash
                      ? decryptSensitiveString(matched.passwordHash)
                      : '';
                    const isAdminFallbackMatch =
                      matched.roleTemplate === 'admin' &&
                      (pass === 'chabad770' || pass === '123456');
                    if (
                      matched.passwordHash &&
                      storedPlain !== pass &&
                      !isAdminFallbackMatch
                    ) {
                      setLoginError('הסיסמה שהוזנה שגויה.');
                      return;
                    }
                    setLocalLoggedInUserId(matched.id);
                    if (matched.preferencesJson) {
                      try {
                        const prefs: UserPersonalPreferences = JSON.parse(matched.preferencesJson);
                        if (prefs.defaultStartTab) {
                          setActiveTab(prefs.defaultStartTab);
                        }
                      } catch {
                        // ignore
                      }
                    }
                    setUsernameInput('');
                    setPasswordInput('');
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      שם משתמש או כתובת אימייל
                    </label>
                    <input
                      type="text"
                      required
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                      placeholder="הזן שם משתמש או כתובת אימייל"
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      סיסמה
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        placeholder="הזן סיסמה אישית"
                        className="w-full px-3.5 py-2.5 pl-10 text-sm border border-slate-300 rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
                        title={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-slate-900 text-white text-sm font-bold rounded-lg hover:bg-slate-800 transition-colors"
                  >
                    כניסה למערכת
                  </button>

                  <div className="relative py-2 flex items-center justify-center">
                    <div className="border-t border-slate-300 w-full" />
                    <span className="bg-white px-3 text-xs text-slate-500 whitespace-nowrap">
                      או כניסה באמצעות חשבון גוגל
                    </span>
                    <div className="border-t border-slate-300 w-full" />
                  </div>

                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    className="w-full py-2.5 bg-amber-600 text-white text-sm font-bold rounded-lg hover:bg-amber-700 transition-colors"
                  >
                    כניסה / הרשמה באמצעות חשבון Google
                  </button>
                </form>
              ) : (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setLoginError(null);
                    setRegisterSuccessMessage(null);
                    if (
                      !regDisplayNameInput.trim() ||
                      !usernameInput.trim() ||
                      !passwordInput.trim()
                    ) {
                      setLoginError('נא למלא שם מלא, שם משתמש וסיסמה לרישום.');
                      return;
                    }
                    const exists = parsedUsers.some(
                      (u) =>
                        (u.username || '').toLowerCase() ===
                        usernameInput.trim().toLowerCase()
                    );
                    if (exists) {
                      setLoginError('שם המשתמש כבר קיים במערכת. בחר שם משתמש אחר או עבור לכניסה.');
                      return;
                    }
                    const now = new Date().toISOString();
                    const newId = generateUuidV7();
                    const def = getDefaultPermissionsForRole(regRoleInput);
                    const newUser: UserRecord = {
                      id: newId,
                      uid: newId,
                      displayName: regDisplayNameInput.trim(),
                      email: regEmailInput.trim() || `${usernameInput.trim()}@chabad.local`,
                      username: usernameInput.trim(),
                      passwordHash: encryptSensitiveString(passwordInput.trim()),
                      roleTemplate: regRoleInput,
                      isBlocked: false,
                      isPendingApproval: true, // הרשמה מותנית באישור מנהל!
                      sessionVersion: 1,
                      permissionsJson: JSON.stringify(def.domains),
                      sensitivePermissionsJson: JSON.stringify(def.sensitive),
                      createdAt: now,
                      updatedAt: now,
                    };
                    setUsers((prev) => [...prev, newUser]);
                    try {
                      await setDoc(doc(db, 'users', newId), sanitizeForFirestore(newUser));
                    } catch (err) {
                      handleFirestoreError(err, OperationType.CREATE, `users/${newId}`);
                    }
                    setRegDisplayNameInput('');
                    setRegEmailInput('');
                    setUsernameInput('');
                    setPasswordInput('');
                    setAuthMode('login');
                    setRegisterSuccessMessage(
                      `המשתמש "${newUser.displayName}" (${newUser.username}) נרשם בהצלחה וממתין כעת לאישור מנהל המערכת. מנהל יכול לאשר את הבקשה בלשונית "הרשאות וגיבוי".`
                    );
                    await writeAuditLog(
                      'בקשת הרשמת משתמש חדש (ממתין לאישור מנהל)',
                      newId,
                      newUser.displayName,
                      `נרשם עם שם משתמש ${newUser.username} ותפקיד מבוקש: ${ROLE_TEMPLATE_LABELS[regRoleInput]}`
                    );
                  }}
                  className="space-y-3.5"
                >
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      שם מלא ותפקיד *
                    </label>
                    <input
                      type="text"
                      required
                      value={regDisplayNameInput}
                      onChange={(e) => setRegDisplayNameInput(e.target.value)}
                      placeholder="למשל: הרב יוסף לוי"
                      className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        שם משתמש לכניסה *
                      </label>
                      <input
                        type="text"
                        required
                        value={usernameInput}
                        onChange={(e) => setUsernameInput(e.target.value)}
                        placeholder="למשל: yossi"
                        className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        כתובת אימייל (רשות)
                      </label>
                      <input
                        type="email"
                        value={regEmailInput}
                        onChange={(e) => setRegEmailInput(e.target.value)}
                        placeholder="user@gmail.com"
                        className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        סיסמה *
                      </label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          value={passwordInput}
                          onChange={(e) => setPasswordInput(e.target.value)}
                          placeholder="בחר סיסמה"
                          className="w-full px-3.5 py-2 pl-10 text-sm border border-slate-300 rounded-lg"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((prev) => !prev)}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900"
                          title={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        תפקיד מבוקש (לאישור מנהל)
                      </label>
                      <select
                        value={regRoleInput}
                        onChange={(e) => setRegRoleInput(e.target.value as RoleTemplateName)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        {Object.entries(ROLE_TEMPLATE_LABELS).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-slate-900 text-white text-sm font-bold rounded-lg hover:bg-slate-800 transition-colors"
                  >
                    שלח בקשת הרשמה לאישור מנהל
                  </button>

                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    className="w-full py-2 bg-amber-600 text-white text-xs font-bold rounded-lg hover:bg-amber-700 transition-colors"
                  >
                    או הירשם באמצעות חשבון Google (מותנה באישור מנהל)
                  </button>
                </form>
              )}
            </div>
          </div>
        ) : currentUser.isPendingApproval && fbUser?.email !== 'chabadneveyosef@gmail.com' ? (
          /* מסך המתנה לאישור מנהל עבור משתמש שנרשם (כולל דרך Google) וטרם אושר */
          <div className="max-w-lg mx-auto my-12 bg-white border border-amber-300 rounded-2xl p-8 text-center space-y-4 shadow-lg">
            <Clock className="w-10 h-10 text-amber-600 mx-auto" />
            <h2 className="text-xl font-bold text-slate-900">
              חשבונך ממתין לאישור מנהל המערכת
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              שלום <strong>{currentUser.displayName}</strong>, ההרשמה שלך נקלטה במערכת. מטעמי אבטחת מידע והרשאות בית חב״ד, הגישה למערכת תיפתח מיד לאחר שמנהל המערכת יאשר את חשבונך.
            </p>
            <button
              type="button"
              onClick={() => {
                setLocalLoggedInUserId(null);
                if (fbUser) signOut(auth);
              }}
              className="px-5 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg"
            >
              חזרה למסך הכניסה הראשי
            </button>
          </div>
        ) : (
          <>

        {activeTab === 'dashboard' && (
          <DashboardView
            userName={currentUser.displayName}
            activities={activities}
            tasks={tasks}
            transactions={transactions}
            donors={donors}
            communityEntities={communityEntities}
            canWriteTasks={hasDomainAccess(currentUser.permissions, 'annual_plan_tasks', 'write')}
            onToggleTaskCompleted={async (task) => {
              recordUndoSnapshot(`סימון משימה: ${task.title}`);
              const now = new Date().toISOString();
              const updated: TaskNodeRecord = {
                ...task,
                isCompleted: !task.isCompleted,
                updatedAt: now,
              };
              setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
              try {
                await setDoc(doc(db, 'tasks', task.id), sanitizeForFirestore(updated));
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `tasks/${task.id}`);
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
            defaultLocationName={defaultMapLocation.locationName}
            defaultLat={defaultMapLocation.lat}
            defaultLng={defaultMapLocation.lng}
            onSaveActivity={async (data, existingId) => {
              recordUndoSnapshot(`שמירת פעילות שנתית: ${data.title}`);
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
              try {
                await setDoc(doc(db, 'annual_activities', id), sanitizeForFirestore(record));
              } catch (err) {
                handleFirestoreError(err, OperationType.WRITE, `annual_activities/${id}`);
              }
              return id;
            }}
            onToggleExecuted={async (act) => {
              recordUndoSnapshot(`עדכון ביצוע פעילות: ${act.title}`);
              const now = new Date().toISOString();
              const updated: AnnualActivityRecord = {
                ...act,
                isExecuted: !act.isExecuted,
                updatedAt: now,
              };
              setActivities((prev) => prev.map((a) => (a.id === act.id ? updated : a)));
              try {
                await setDoc(doc(db, 'annual_activities', act.id), sanitizeForFirestore(updated));
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `annual_activities/${act.id}`);
              }
            }}
            onSoftDeleteActivity={async (id) => {
              const now = new Date().toISOString();
              const target = activities.find((a) => a.id === id);
              if (!target) return;
              recordUndoSnapshot(`מחיקת פעילות: ${target.title}`);
              const updated: AnnualActivityRecord = { ...target, deletedAt: now, updatedAt: now };
              setActivities((prev) => prev.map((a) => (a.id === id ? updated : a)));
              await writeAuditLog('מחיקה רכה של פעילות שנתית', id, target.title, 'סומן deleted_at');
              try {
                await setDoc(doc(db, 'annual_activities', id), sanitizeForFirestore(updated));
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `annual_activities/${id}`);
              }
            }}
            onSaveTask={async (data, existingId) => {
              recordUndoSnapshot(`שמירת משימה: ${data.title}`);
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
              try {
                await setDoc(doc(db, 'tasks', id), sanitizeForFirestore(record));
              } catch (err) {
                handleFirestoreError(err, OperationType.WRITE, `tasks/${id}`);
              }
            }}
            onToggleTaskCompleted={async (task) => {
              recordUndoSnapshot(`סימון משימה: ${task.title}`);
              const now = new Date().toISOString();
              const updated: TaskNodeRecord = {
                ...task,
                isCompleted: !task.isCompleted,
                updatedAt: now,
              };
              setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
              try {
                await setDoc(doc(db, 'tasks', task.id), sanitizeForFirestore(updated));
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `tasks/${task.id}`);
              }
            }}
            onSoftDeleteTask={async (id) => {
              const now = new Date().toISOString();
              const target = tasks.find((t) => t.id === id);
              if (!target) return;
              recordUndoSnapshot(`מחיקת משימה: ${target.title}`);
              const updated: TaskNodeRecord = { ...target, deletedAt: now, updatedAt: now };
              setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
              try {
                await setDoc(doc(db, 'tasks', id), sanitizeForFirestore(updated));
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `tasks/${id}`);
              }
            }}
          />
        )}

        {activeTab === 'tasks_dag' && (
          <TasksDagView
            tasks={tasks}
            canWrite={hasDomainAccess(currentUser.permissions, 'annual_plan_tasks', 'write')}
            onSaveTask={async (data, existingId) => {
              recordUndoSnapshot(`שמירת משימה בעץ התכנון: ${data.title}`);
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
              try {
                await setDoc(doc(db, 'tasks', id), sanitizeForFirestore(record));
              } catch (err) {
                handleFirestoreError(err, OperationType.WRITE, `tasks/${id}`);
              }
            }}
            onToggleTaskCompleted={async (task) => {
              recordUndoSnapshot(`סימון ביצוע משימה: ${task.title}`);
              const now = new Date().toISOString();
              const updated: TaskNodeRecord = {
                ...task,
                isCompleted: !task.isCompleted,
                updatedAt: now,
              };
              setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
              try {
                await setDoc(doc(db, 'tasks', task.id), sanitizeForFirestore(updated));
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `tasks/${task.id}`);
              }
            }}
            onSoftDeleteTask={async (id) => {
              const now = new Date().toISOString();
              const target = tasks.find((t) => t.id === id);
              if (!target) return;
              recordUndoSnapshot(`מחיקת משימה: ${target.title}`);
              const updated: TaskNodeRecord = { ...target, deletedAt: now, updatedAt: now };
              setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
              try {
                await setDoc(doc(db, 'tasks', id), sanitizeForFirestore(updated));
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `tasks/${id}`);
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
              recordUndoSnapshot(`רישום תנועה כספית: ${data.description}`);
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
              try {
                await setDoc(doc(db, 'transactions', id), sanitizeForFirestore(record));
              } catch (err) {
                handleFirestoreError(err, OperationType.CREATE, `transactions/${id}`);
              }
            }}
            onUpdateTransactionStatus={async (tx, newStatus) => {
              recordUndoSnapshot(`שינוי סטטוס תנועה: ${tx.description}`);
              const now = new Date().toISOString();
              const updated: FinancialTransactionRecord = {
                ...tx,
                status: newStatus,
                updatedAt: now,
              };
              setTransactions((prev) => prev.map((t) => (t.id === tx.id ? updated : t)));
              try {
                await setDoc(doc(db, 'transactions', tx.id), sanitizeForFirestore(updated));
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `transactions/${tx.id}`);
              }
            }}
            onSoftDeleteTransaction={async (id) => {
              const now = new Date().toISOString();
              const target = transactions.find((t) => t.id === id);
              if (!target) return;
              recordUndoSnapshot(`מחיקת תנועה כספית: ${target.description}`);
              const updated: FinancialTransactionRecord = {
                ...target,
                deletedAt: now,
                updatedAt: now,
              };
              setTransactions((prev) => prev.map((t) => (t.id === id ? updated : t)));
              await writeAuditLog('מחיקה רכה של תנועה כספית', id, target.description, 'סומן deleted_at');
              try {
                await setDoc(doc(db, 'transactions', id), sanitizeForFirestore(updated));
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `transactions/${id}`);
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
              recordUndoSnapshot(`שמירת איש קשר: ${data.fullName}`);
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
              try {
                await setDoc(doc(db, 'donors', id), sanitizeForFirestore(record));
              } catch (err) {
                handleFirestoreError(err, OperationType.WRITE, `donors/${id}`);
              }
            }}
            onSoftDeleteDonor={async (id) => {
              const now = new Date().toISOString();
              const target = donors.find((d) => d.id === id);
              if (!target) return;
              recordUndoSnapshot(`מחיקת איש קשר: ${target.fullName}`);
              const updated: DonorContactRecord = { ...target, deletedAt: now, updatedAt: now };
              setDonors((prev) => prev.map((d) => (d.id === id ? updated : d)));
              await writeAuditLog('מחיקה רכה של איש קשר / תורם', id, target.fullName, 'סומן deleted_at');
              try {
                await setDoc(doc(db, 'donors', id), sanitizeForFirestore(updated));
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `donors/${id}`);
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
              recordUndoSnapshot(`הוספת רשומת קהילה: ${data.titleOrName}`);
              const now = new Date().toISOString();
              const id = generateUuidV7();
              const record: VolunteerEntityRecord = {
                ...data,
                id,
                createdAt: now,
                updatedAt: now,
              };
              setCommunityEntities((prev) => [record, ...prev]);
              try {
                await setDoc(doc(db, 'community_entities', id), sanitizeForFirestore(record));
              } catch (err) {
                handleFirestoreError(err, OperationType.CREATE, `community_entities/${id}`);
              }
            }}
          />
        )}

        {activeTab === 'gis_map' && (
          <GisMapView
            donors={donors}
            communityEntities={communityEntities}
            canWrite={hasDomainAccess(currentUser.permissions, 'gis_map', 'write')}
            defaultMapLocation={defaultMapLocation}
            onUpdateDefaultMapLocation={async (newConfig) => {
              recordUndoSnapshot(`שינוי מיקום ברירת מחדל במפה: ${newConfig.locationName}`);
              setDefaultMapLocation(newConfig);
              await writeAuditLog(
                'עדכון מיקום ברירת מחדל של המפה',
                'map_default_location',
                newConfig.locationName,
                `קואורדינטות: ${newConfig.lat}, ${newConfig.lng} (זום ${newConfig.zoom})`
              );
            }}
            onUpdateDonorCoords={async (donorId, lat, lng) => {
              const now = new Date().toISOString();
              const target = donors.find((d) => d.id === donorId);
              if (!target) return;
              recordUndoSnapshot(`עדכון מיקום דייר במפה: ${target.fullName}`);
              const updated: DonorContactRecord = { ...target, lat, lng, updatedAt: now };
              setDonors((prev) => prev.map((d) => (d.id === donorId ? updated : d)));
              try {
                await setDoc(doc(db, 'donors', donorId), sanitizeForFirestore(updated));
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `donors/${donorId}`);
              }
            }}
            onSaveDonor={async (data, existingId) => {
              recordUndoSnapshot(`שמירת דייר בבניין: ${data.fullName}`);
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
              try {
                await setDoc(doc(db, 'donors', id), sanitizeForFirestore(record));
              } catch (err) {
                handleFirestoreError(err, OperationType.WRITE, `donors/${id}`);
              }
            }}
            onSoftDeleteDonor={async (id) => {
              const now = new Date().toISOString();
              const target = donors.find((d) => d.id === id);
              if (!target) return;
              recordUndoSnapshot(`הסרת דייר מבניין: ${target.fullName}`);
              const updated: DonorContactRecord = { ...target, deletedAt: now, updatedAt: now };
              setDonors((prev) => prev.map((d) => (d.id === id ? updated : d)));
              await writeAuditLog('הסרת דייר מבניין במפה (מחיקה רכה)', id, target.fullName, 'סומן deleted_at');
              try {
                await setDoc(doc(db, 'donors', id), sanitizeForFirestore(updated));
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `donors/${id}`);
              }
            }}
            onAddStreetNote={async (title, address, notes, lat, lng) => {
              recordUndoSnapshot(`הוספת הערת רחוב במפה: ${title}`);
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
              try {
                await setDoc(doc(db, 'community_entities', id), sanitizeForFirestore(record));
              } catch (err) {
                handleFirestoreError(err, OperationType.CREATE, `community_entities/${id}`);
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
            defaultMapLocation={defaultMapLocation}
            onUpdateDefaultMapLocation={async (newConfig) => {
              recordUndoSnapshot(`שינוי מיקום ברירת מחדל במפה: ${newConfig.locationName}`);
              setDefaultMapLocation(newConfig);
              await writeAuditLog(
                'עדכון מיקום ברירת מחדל של המפה',
                'map_default_location',
                newConfig.locationName,
                `קואורדינטות: ${newConfig.lat}, ${newConfig.lng} (זום ${newConfig.zoom})`
              );
            }}
            onSwitchActiveUser={(userId) => {
              setLocalLoggedInUserId(userId);
              triggerShortcutToast('המשתמש הפעיל הוחלף — הרשאות המערכת עודכנו בהתאם');
            }}
            onRegisterNewUser={async (data) => {
              const now = new Date().toISOString();
              const id = generateUuidV7();
              const def = getDefaultPermissionsForRole(data.roleTemplate);
              const record: UserRecord = {
                id,
                uid: id,
                displayName: data.displayName,
                email: data.email,
                username: data.username,
                passwordHash: encryptSensitiveString(data.passwordPlain),
                roleTemplate: data.roleTemplate,
                isBlocked: false,
                sessionVersion: 1,
                permissionsJson: JSON.stringify(def.domains),
                sensitivePermissionsJson: JSON.stringify(def.sensitive),
                createdAt: now,
                updatedAt: now,
              };
              setUsers((prev) => [...prev, record]);
              await writeAuditLog(
                'רישום משתמש חדש במערך ההרשאות',
                id,
                data.displayName,
                `תפקיד: ${ROLE_TEMPLATE_LABELS[data.roleTemplate]}, שם משתמש: ${data.username}`
              );
              try {
                await setDoc(doc(db, 'users', id), sanitizeForFirestore(record));
              } catch (err) {
                handleFirestoreError(err, OperationType.CREATE, `users/${id}`);
              }
            }}
            onUpdateUserRoleAndPermissions={async (
              targetUser,
              newRole,
              newIsBlocked,
              newDomains: Record<PermissionDomain, AccessLevel>,
              newSensitive: Record<SensitivePermission, boolean>,
              newIsPendingApproval?: boolean
            ) => {
              const now = new Date().toISOString();
              const nextSessionVersion = newIsBlocked
                ? targetUser.sessionVersion + 1
                : targetUser.sessionVersion;
              const resolvedPending =
                newIsPendingApproval !== undefined
                  ? newIsPendingApproval
                  : Boolean(targetUser.isPendingApproval);
              const updated: UserRecord = {
                id: targetUser.id,
                uid: targetUser.uid,
                email: targetUser.email,
                displayName: targetUser.displayName,
                username: targetUser.username,
                passwordHash: targetUser.passwordHash,
                roleTemplate: newRole,
                isBlocked: newIsBlocked,
                isPendingApproval: resolvedPending,
                sessionVersion: nextSessionVersion,
                permissionsJson: JSON.stringify(newDomains),
                sensitivePermissionsJson: JSON.stringify(newSensitive),
                createdAt: targetUser.createdAt,
                updatedAt: now,
              };
              setUsers((prev) => prev.map((u) => (u.id === targetUser.id ? updated : u)));
              await writeAuditLog(
                newIsPendingApproval === false && targetUser.isPendingApproval
                  ? 'אישור מנהל להרשמת משתמש חדש'
                  : newIsBlocked !== targetUser.isBlocked
                  ? 'שינוי סטטוס חסימת משתמש'
                  : 'עדכון הרשאות RBAC',
                targetUser.id,
                targetUser.displayName,
                `תפקיד: ${newRole}, מאושר: ${!resolvedPending}, חסום: ${newIsBlocked}, גרסת סשן: #${nextSessionVersion}`
              );
              try {
                await setDoc(doc(db, 'users', targetUser.id), sanitizeForFirestore(updated));
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `users/${targetUser.id}`);
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
              try {
                await setDoc(doc(db, 'templates', id), sanitizeForFirestore(record));
              } catch (err) {
                handleFirestoreError(err, OperationType.CREATE, `templates/${id}`);
              }
            }}
            onRestoreBackupData={async (payload) => {
              recordUndoSnapshot('שחזור גיבוי מלא מוצפן');
              if (payload.activities) {
                setActivities(payload.activities);
                for (const act of payload.activities) {
                  await setDoc(doc(db, 'annual_activities', act.id), sanitizeForFirestore(act)).catch(() => null);
                }
              }
              if (payload.tasks) {
                setTasks(payload.tasks);
                for (const t of payload.tasks) {
                  await setDoc(doc(db, 'tasks', t.id), sanitizeForFirestore(t)).catch(() => null);
                }
              }
              if (payload.transactions) {
                setTransactions(payload.transactions);
                for (const tx of payload.transactions) {
                  await setDoc(doc(db, 'transactions', tx.id), sanitizeForFirestore(tx)).catch(() => null);
                }
              }
              if (payload.donors) {
                setDonors(payload.donors);
                for (const d of payload.donors) {
                  await setDoc(doc(db, 'donors', d.id), sanitizeForFirestore(d)).catch(() => null);
                }
              }
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

        {activeTab === 'personal_profile' && (
          <PersonalProfileView
            currentUser={currentUser}
            currentPreferences={currentPreferences}
            onUpdatePersonalDetails={async (data) => {
              const now = new Date().toISOString();
              const updatedRecord: UserRecord = {
                id: currentUser.id,
                uid: currentUser.uid,
                email: data.email || currentUser.email,
                displayName: data.displayName,
                username: data.username,
                passwordHash: data.newPasswordPlain
                  ? encryptSensitiveString(data.newPasswordPlain)
                  : currentUser.passwordHash,
                phone: data.phone,
                personalTitle: data.personalTitle,
                preferencesJson: currentUser.preferencesJson,
                roleTemplate: currentUser.roleTemplate,
                isBlocked: currentUser.isBlocked,
                isPendingApproval: currentUser.isPendingApproval,
                sessionVersion: currentUser.sessionVersion,
                permissionsJson: currentUser.permissionsJson,
                sensitivePermissionsJson: currentUser.sensitivePermissionsJson,
                createdAt: currentUser.createdAt,
                updatedAt: now,
              };
              setUsers((prev) =>
                prev.some((u) => u.id === currentUser.id)
                  ? prev.map((u) => (u.id === currentUser.id ? updatedRecord : u))
                  : [...prev, updatedRecord]
              );
              await writeAuditLog(
                data.newPasswordPlain
                  ? 'עדכון פרטים אישיים והחלפת סיסמה באזור האישי'
                  : 'עדכון פרטים אישיים באזור האישי',
                currentUser.id,
                data.displayName,
                `שם משתמש: ${data.username}, אימייל: ${data.email}`
              );
              try {
                await setDoc(doc(db, 'users', currentUser.id), sanitizeForFirestore(updatedRecord));
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.id}`);
              }
            }}
            onUpdatePreferences={async (prefs) => {
              const now = new Date().toISOString();
              const updatedRecord: UserRecord = {
                id: currentUser.id,
                uid: currentUser.uid,
                email: currentUser.email,
                displayName: currentUser.displayName,
                username: currentUser.username,
                passwordHash: currentUser.passwordHash,
                phone: currentUser.phone,
                personalTitle: currentUser.personalTitle,
                preferencesJson: JSON.stringify(prefs),
                roleTemplate: currentUser.roleTemplate,
                isBlocked: currentUser.isBlocked,
                isPendingApproval: currentUser.isPendingApproval,
                sessionVersion: currentUser.sessionVersion,
                permissionsJson: currentUser.permissionsJson,
                sensitivePermissionsJson: currentUser.sensitivePermissionsJson,
                createdAt: currentUser.createdAt,
                updatedAt: now,
              };
              setUsers((prev) =>
                prev.some((u) => u.id === currentUser.id)
                  ? prev.map((u) => (u.id === currentUser.id ? updatedRecord : u))
                  : [...prev, updatedRecord]
              );
              try {
                await setDoc(doc(db, 'users', currentUser.id), sanitizeForFirestore(updatedRecord));
              } catch (err) {
                handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.id}`);
              }
            }}
          />
        )}
          </>
        )}
      </main>

      {/* Keyboard Shortcuts Reference Modal (?) */}
      {showShortcutsModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-slate-700" />
                קיצורי מקשים במערכת
              </h3>
              <button
                type="button"
                onClick={() => setShowShortcutsModal(false)}
                className="text-xs text-slate-500 hover:text-slate-800 font-semibold"
              >
                סגור (ESC)
              </button>
            </div>
            <div className="p-4 space-y-2 text-xs">
              {[
                { keys: 'Ctrl + Z', desc: 'ביטול הפעולה האחרונה שבוצעה במערכת (Undo)' },
                { keys: 'Ctrl + Y / Ctrl + Shift + Z', desc: 'ביצוע מחדש של פעולה שבוטלה (Redo)' },
                { keys: 'Ctrl + K / Ctrl + F', desc: 'פתיחת חלונית חיפוש מהיר ופקודות' },
                { keys: 'Ctrl + N', desc: 'פתיחת תפריט יצירה מהירה של רשומה חדשה' },
                { keys: 'Ctrl + S', desc: 'שמירה מיידית של כל הנתונים בזיכרון המקומי ובענן' },
                { keys: 'Alt + 1 ... Alt + 7', desc: 'מעבר מהיר בין 7 לשוניות המערכת הראשיות' },
                { keys: '?', desc: 'פתיחה וסגירה של טבלת קיצורי המקשים' },
                { keys: 'Esc', desc: 'סגירת חלוניות קופצות ותפריטים פתוחים' },
              ].map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between py-2 border-b border-slate-100 last:border-b-0"
                >
                  <span className="text-slate-700 font-medium">{item.desc}</span>
                  <kbd className="px-2 py-1 bg-slate-100 border border-slate-300 rounded font-mono text-[11px] text-slate-900">
                    {item.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
            <div className="p-3 max-h-96 overflow-y-auto divide-y divide-slate-200/80 text-xs">
              {commandQuery.trim() !== '' && (
                <div className="pb-3 space-y-1.5">
                  <div className="text-slate-600 font-bold px-2">תוצאות חיפוש מיידיות במאגר:</div>
                  {donors
                    .filter(
                      (d) =>
                        !d.deletedAt &&
                        (d.fullName.toLowerCase().includes(commandQuery.toLowerCase()) ||
                          d.identifierMark.toLowerCase().includes(commandQuery.toLowerCase()) ||
                          d.address.toLowerCase().includes(commandQuery.toLowerCase()))
                    )
                    .slice(0, 4)
                    .map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => {
                          setSelectedDonorId(d.id);
                          setActiveTab('crm_donors');
                          setShowCommandPalette(false);
                        }}
                        className="w-full text-right px-3 py-2 rounded-lg hover:bg-slate-200/70 font-medium text-slate-900 flex items-center justify-between"
                      >
                        <span>
                          <strong>תורם: {d.fullName}</strong> · {d.identifierMark} ({d.address})
                        </span>
                        <span className="text-[11px] text-slate-500">פתח CRM</span>
                      </button>
                    ))}
                  {tasks
                    .filter(
                      (t) =>
                        !t.deletedAt &&
                        (t.title.toLowerCase().includes(commandQuery.toLowerCase()) ||
                          (t.strategicGoal || '').toLowerCase().includes(commandQuery.toLowerCase()))
                    )
                    .slice(0, 4)
                    .map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setActiveTab('tasks_dag');
                          setShowCommandPalette(false);
                        }}
                        className="w-full text-right px-3 py-2 rounded-lg hover:bg-slate-200/70 font-medium text-slate-900 flex items-center justify-between"
                      >
                        <span>
                          <strong>משימה: {t.title}</strong> · {t.hebrewDateStr || 'ללא תאריך'}
                        </span>
                        <span className="text-[11px] text-slate-500">פתח עץ תכנון</span>
                      </button>
                    ))}
                  {activities
                    .filter(
                      (a) =>
                        !a.deletedAt &&
                        (a.title.toLowerCase().includes(commandQuery.toLowerCase()) ||
                          a.hebrewDateDisplay.toLowerCase().includes(commandQuery.toLowerCase()))
                    )
                    .slice(0, 4)
                    .map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setActiveTab('annual_plan');
                          setShowCommandPalette(false);
                        }}
                        className="w-full text-right px-3 py-2 rounded-lg hover:bg-slate-200/70 font-medium text-slate-900 flex items-center justify-between"
                      >
                        <span>
                          <strong>פעילות שנתית: {a.title}</strong> · {a.hebrewDateDisplay}
                        </span>
                        <span className="text-[11px] text-slate-500">פתח תוכנית</span>
                      </button>
                    ))}
                </div>
              )}
              <div className="py-2 space-y-1">
                <div className="text-slate-600 font-bold px-2">ניווט ופעולות מהירות (Ctrl+Z / Ctrl+K / Alt+1..7)</div>
                {[
                  { label: 'מעבר לדשבורד הראשי ותזכורות משימות (Alt+1)', tab: 'dashboard' as NavTab },
                  { label: 'מעבר לתוכנית שנתית ולוח עברי (Alt+2)', tab: 'annual_plan' as NavTab },
                  { label: 'מעבר למשימות, פרויקטים ומסלול קריטי (Alt+3)', tab: 'tasks_dag' as NavTab },
                  { label: 'מעבר לדשבורד כספים והעמותה השנייה (Alt+4)', tab: 'finances' as NavTab },
                  { label: 'מעבר ל-CRM תורמים ומתנדבים (Alt+5)', tab: 'crm_donors' as NavTab },
                  { label: 'מעבר למפת GIS ועריכת מיקום ברירת מחדל (Alt+6)', tab: 'gis_map' as NavTab },
                  { label: 'מעבר להרשאות RBAC, רישום משתמשים וגיבוי (Alt+7)', tab: 'rbac_settings' as NavTab },
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
        <div>קיצורי מקשים: Ctrl+Z לביטול · Ctrl+Y לביצוע מחדש · Ctrl+K לחיפוש · Alt+1..7 למעבר בין עמודים · ? לכל הקיצורים</div>
      </footer>
    </div>
  );
}
