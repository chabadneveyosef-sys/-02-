import React, { useState, useRef } from 'react';
import {
  Plus,
  Eye,
  EyeOff,
  Phone,
  MapPin,
  Calendar,
  History,
  FileText,
  Trash2,
  UserCheck,
  Download,
  Upload,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Tag,
  Filter,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  DonorContactRecord,
  FinancialTransactionRecord,
  VolunteerEntityRecord,
  SignificantHebrewDateItem,
  DonorInteractionItem,
} from '../types/erp';
import {
  encryptSensitiveString,
  decryptSensitiveString,
  formatMaskedNationalId,
  formatAgorotToIls,
  getAnniversaryInHebrewYear,
  fromGregorianDate,
  HebrewDateTriplet,
} from '../lib/erp-core';
import { getAccessToken, googleSignIn } from '../lib/firebase';
import { HebrewDatePicker } from './HebrewDatePicker';

interface CrmDonorsViewProps {
  donors: DonorContactRecord[];
  transactions: FinancialTransactionRecord[];
  communityEntities: VolunteerEntityRecord[];
  canWriteCrm: boolean;
  canRevealNationalId: boolean;
  selectedDonorId: string | null;
  onSelectDonorId: (id: string | null) => void;
  onSaveDonor: (
    data: Omit<DonorContactRecord, 'id' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) => Promise<void>;
  onSoftDeleteDonor: (id: string) => Promise<void>;
  onLogRevealNationalId: (donor: DonorContactRecord) => Promise<void>;
  onSaveCommunityEntity: (
    data: Omit<VolunteerEntityRecord, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>;
}

const DEFAULT_CRM_TAGS = [
  'תורמים',
  'תושבי השכונה',
  'חבדניקים',
  'מתפללי בית הכנסת',
  'משתתפי שיעורים',
  'בעלי עסקים',
  'ידידי בית חב״ד',
];

const CUSTOM_TAGS_STORAGE_KEY = 'chabad_erp_custom_crm_tags_v1';

function parseDonorTags(tagsJson?: string): string[] {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x).trim()).filter(Boolean);
    }
  } catch {
    // ignore
  }
  return [];
}

export const CrmDonorsView: React.FC<CrmDonorsViewProps> = ({
  donors,
  transactions,
  communityEntities,
  canWriteCrm,
  canRevealNationalId,
  selectedDonorId,
  onSelectDonorId,
  onSaveDonor,
  onSoftDeleteDonor,
  onLogRevealNationalId,
  onSaveCommunityEntity,
}) => {
  const [subTab, setSubTab] = useState<'donors' | 'volunteers_classes'>('donors');
  const [donorDisplayMode, setDonorDisplayMode] = useState<'split' | 'table'>('table');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterNextActionOnly, setFilterNextActionOnly] = useState(false);
  const [revealedIds, setRevealedIds] = useState<Record<string, string>>({});
  const [showDonorForm, setShowDonorForm] = useState(false);
  const [showEntityForm, setShowEntityForm] = useState(false);

  // Sync / Import / Export state
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isSyncingGoogle, setIsSyncingGoogle] = useState(false);
  const [showGoogleExportConfirm, setShowGoogleExportConfirm] = useState(false);
  const excelFileInputRef = useRef<HTMLInputElement | null>(null);

  // New Donor form state
  const [fullName, setFullName] = useState('');
  const [identifierMark, setIdentifierMark] = useState('');
  const [personalConnection, setPersonalConnection] = useState('');
  const [nationalIdPlain, setNationalIdPlain] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [nextActionText, setNextActionText] = useState('');
  const [nextActionDate, setNextActionDate] = useState('');
  const [sigTitle, setSigTitle] = useState('יום הולדת');
  const [sigTriplet, setSigTriplet] = useState<HebrewDateTriplet | null>(null);
  const [newDonorTags, setNewDonorTags] = useState<string[]>(['תושבי השכונה']);

  // Tags & Advanced Tag Filtering State
  const [customTags, setCustomTags] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_TAGS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [newCustomTagInput, setNewCustomTagInput] = useState('');
  const [cardNewTagInput, setCardNewTagInput] = useState('');
  const [selectedFilterTags, setSelectedFilterTags] = useState<string[]>([]);
  const [tagFilterMode, setTagFilterMode] = useState<'any' | 'all' | 'min_count' | 'exact_count'>('any');
  const [tagFilterCount, setTagFilterCount] = useState<number>(2);

  const allAvailableTags = Array.from(
    new Set([
      ...DEFAULT_CRM_TAGS,
      ...customTags,
      ...donors.flatMap((d) => parseDonorTags(d.tagsJson)),
    ])
  );

  const handleAddCustomTagToList = (tagText: string) => {
    const clean = tagText.trim();
    if (!clean) return;
    if (!allAvailableTags.includes(clean)) {
      const updated = [...customTags, clean];
      setCustomTags(updated);
      try {
        localStorage.setItem(CUSTOM_TAGS_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
    }
    setNewCustomTagInput('');
  };

  const handleToggleFilterTag = (tag: string) => {
    setSelectedFilterTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleToggleDonorTag = async (donor: DonorContactRecord, tag: string) => {
    if (!canWriteCrm) return;
    const current = parseDonorTags(donor.tagsJson);
    const exists = current.includes(tag);
    const nextTags = exists ? current.filter((t) => t !== tag) : [...current, tag];

    await onSaveDonor(
      {
        fullName: donor.fullName,
        identifierMark: donor.identifierMark,
        personalConnection: donor.personalConnection,
        encryptedNationalId: donor.encryptedNationalId,
        nationalIdLast4: donor.nationalIdLast4,
        phone: donor.phone,
        email: donor.email,
        address: donor.address,
        city: donor.city,
        lat: donor.lat,
        lng: donor.lng,
        significantDatesJson: donor.significantDatesJson,
        interactionsJson: donor.interactionsJson,
        nextActionText: donor.nextActionText,
        nextActionDate: donor.nextActionDate,
        attachmentsJson: donor.attachmentsJson,
        tagsJson: JSON.stringify(nextTags),
      },
      donor.id
    );
  };

  // Interaction log state
  const [interactionType, setInteractionType] = useState<'home_visit' | 'phone_call' | 'meeting'>('home_visit');
  const [interactionSummary, setInteractionSummary] = useState('');

  // Add significant date directly inside contact card
  const [showAddSigDateForm, setShowAddSigDateForm] = useState(false);
  const [cardSigType, setCardSigType] = useState<'birthday' | 'anniversary' | 'yahrtzeit'>('birthday');
  const [cardSigTitle, setCardSigTitle] = useState('יום הולדת');
  const [cardSigTriplet, setCardSigTriplet] = useState<HebrewDateTriplet>({ day: 18, month: 6, year: 5740 });

  // Volunteer/Class form state
  const [entityType, setEntityType] = useState<'volunteer' | 'regular_class'>('volunteer');
  const [titleOrName, setTitleOrName] = useState('');
  const [phoneOrSchedule, setPhoneOrSchedule] = useState('');
  const [areaOrAddress, setAreaOrAddress] = useState('');
  const [entityNotes, setEntityNotes] = useState('');

  const allActiveDonors = donors.filter((d) => !d.deletedAt);

  const activeDonors = allActiveDonors.filter((d) => {
    if (filterNextActionOnly && !d.nextActionText) return false;

    const donorTags = parseDonorTags(d.tagsJson);

    // סינון לפי תוויות שנבחרו או לפי מספר תוויות
    if (selectedFilterTags.length > 0) {
      const matchedCount = selectedFilterTags.filter((t) => donorTags.includes(t)).length;
      if (tagFilterMode === 'any' && matchedCount === 0) return false;
      if (tagFilterMode === 'all' && matchedCount < selectedFilterTags.length) return false;
      if (tagFilterMode === 'min_count' && matchedCount < tagFilterCount) return false;
      if (tagFilterMode === 'exact_count' && matchedCount !== tagFilterCount) return false;
    } else if (tagFilterMode === 'min_count') {
      if (donorTags.length < tagFilterCount) return false;
    } else if (tagFilterMode === 'exact_count') {
      if (donorTags.length !== tagFilterCount) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        d.fullName.toLowerCase().includes(q) ||
        d.identifierMark.toLowerCase().includes(q) ||
        d.personalConnection.toLowerCase().includes(q) ||
        d.address.toLowerCase().includes(q) ||
        d.phone.includes(q) ||
        donorTags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const selectedDonor =
    activeDonors.find((d) => d.id === selectedDonorId) || activeDonors[0] || null;

  const handleToggleRevealId = async (donor: DonorContactRecord) => {
    if (!canRevealNationalId) return;
    if (revealedIds[donor.id]) {
      const copy = { ...revealedIds };
      delete copy[donor.id];
      setRevealedIds(copy);
    } else {
      const plain = decryptSensitiveString(donor.encryptedNationalId);
      setRevealedIds({ ...revealedIds, [donor.id]: plain });
      await onLogRevealNationalId(donor);
    }
  };

  // --- ייצוא לאקסל (Excel .xlsx) ---
  const handleExportExcel = () => {
    const rows = allActiveDonors.map((d) => ({
      'שם מלא': d.fullName,
      'טלפון': d.phone,
      'אימייל': d.email || '',
      'כתובת': d.address,
      'עיר': d.city || 'חיפה',
      'סימן זיהוי': d.identifierMark,
      'קשר פרטי': d.personalConnection,
      'תוויות': parseDonorTags(d.tagsJson).join(', '),
      '4 ספרות אחרונות ת.ז.': d.nationalIdLast4,
      'הפעולה הבאה': d.nextActionText || '',
      'תאריך הפעולה הבאה': d.nextActionDate || '',
      'קו רוחב (Lat)': d.lat ?? '',
      'קו אורך (Lng)': d.lng ?? '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'אנשי קשר ותורמים');
    XLSX.writeFile(workbook, `chabad_contacts_${new Date().toISOString().slice(0, 10)}.xlsx`);
    setSyncMessage({
      type: 'success',
      text: `יוצאו בהצלחה ${rows.length} אנשי קשר לקובץ אקסל (.xlsx).`,
    });
  };

  // --- ייבוא מאקסל (Excel .xlsx / .xls / .csv) ---
  const handleImportExcelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canWriteCrm) return;
    setSyncMessage(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

      let importedCount = 0;
      for (const row of rawRows) {
        const name = String(
          row['שם מלא'] || row['שם'] || row['Full Name'] || row['Name'] || ''
        ).trim();
        if (!name) continue;

        const phoneVal = String(
          row['טלפון'] || row['נייד'] || row['Phone'] || row['Mobile'] || ''
        ).trim();
        const emailVal = String(
          row['אימייל'] || row['מייל'] || row['Email'] || ''
        ).trim();
        const addressVal = String(
          row['כתובת'] || row['רחוב'] || row['Address'] || 'נווה יוסף, חיפה'
        ).trim();
        const cityVal = String(row['עיר'] || row['City'] || 'חיפה').trim();
        const idMarkVal = String(
          row['סימן זיהוי'] || row['הערות'] || row['Notes'] || 'יובא מאקסל'
        ).trim();
        const connVal = String(
          row['קשר פרטי'] || row['קשר'] || 'ידיד בית חב״ד'
        ).trim();
        const rawId = String(
          row['תעודת זהות'] || row['ת.ז.'] || row['4 ספרות אחרונות ת.ז.'] || '000000000'
        ).trim();
        const last4 = rawId.slice(-4).padStart(4, '0');

        const rawTags = String(row['תוויות'] || row['Tags'] || '').trim();
        const parsedRowTags = rawTags
          ? rawTags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : ['תושבי השכונה'];

        await onSaveDonor({
          fullName: name,
          identifierMark: idMarkVal,
          personalConnection: connVal,
          encryptedNationalId: encryptSensitiveString(rawId),
          nationalIdLast4: last4,
          phone: phoneVal,
          email: emailVal || undefined,
          address: addressVal,
          city: cityVal,
          lat: Number(row['קו רוחב (Lat)']) || Number((32.784 + (Math.random() - 0.5) * 0.005).toFixed(5)),
          lng: Number(row['קו אורך (Lng)']) || Number((35.0195 + (Math.random() - 0.5) * 0.005).toFixed(5)),
          significantDatesJson: JSON.stringify([]),
          interactionsJson: JSON.stringify([]),
          nextActionText: String(row['הפעולה הבאה'] || '').trim() || undefined,
          attachmentsJson: JSON.stringify([]),
          tagsJson: JSON.stringify(parsedRowTags),
        });
        importedCount++;
      }

      setSyncMessage({
        type: 'success',
        text: `יובאו בהצלחה ${importedCount} אנשי קשר מתוך קובץ האקסל "${file.name}".`,
      });
    } catch (err) {
      setSyncMessage({
        type: 'error',
        text: `שגיאה בקריאת קובץ האקסל: ${err instanceof Error ? err.message : 'קובץ לא תקין'}`,
      });
    } finally {
      if (excelFileInputRef.current) {
        excelFileInputRef.current.value = '';
      }
    }
  };

  // --- השגת Access Token לחשבון Google Contacts ---
  const ensureGoogleAccessToken = async (): Promise<string | null> => {
    let token = await getAccessToken();
    if (!token) {
      const signInRes = await googleSignIn();
      token = signInRes?.accessToken || null;
    }
    return token;
  };

  // --- ייבוא מאנשי קשר של גוגל (Google Contacts People API) ---
  const handleImportFromGoogleContacts = async () => {
    if (!canWriteCrm) return;
    setIsSyncingGoogle(true);
    setSyncMessage(null);

    try {
      const token = await ensureGoogleAccessToken();
      if (!token) {
        setSyncMessage({
          type: 'error',
          text: 'נדרשת התחברות לחשבון Google כדי לייבא מאנשי הקשר של גוגל.',
        });
        return;
      }

      const res = await fetch(
        'https://people.googleapis.com/v1/people/me/connections?personFields=names,phoneNumbers,emailAddresses,addresses,biographies,organizations&pageSize=200',
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `שגיאת Google Contacts (${res.status})`);
      }

      const data = await res.json();
      const connections = Array.isArray(data.connections) ? data.connections : [];

      let importedCount = 0;
      for (const person of connections) {
        const name = person.names?.[0]?.displayName?.trim();
        if (!name) continue;

        // Avoid duplicating if same fullName & phone already exist
        const phoneVal = person.phoneNumbers?.[0]?.value?.trim() || '';
        const alreadyExists = allActiveDonors.some(
          (d) => d.fullName === name && (!phoneVal || d.phone === phoneVal)
        );
        if (alreadyExists) continue;

        const emailVal = person.emailAddresses?.[0]?.value?.trim() || '';
        const addressVal =
          person.addresses?.[0]?.formattedValue?.trim() ||
          person.addresses?.[0]?.streetAddress?.trim() ||
          'נווה יוסף, חיפה';
        const bioVal =
          person.biographies?.[0]?.value?.trim() ||
          person.organizations?.[0]?.name?.trim() ||
          'יובא מאנשי קשר של גוגל';

        await onSaveDonor({
          fullName: name,
          identifierMark: bioVal,
          personalConnection: 'סונכרן מ-Google Contacts',
          encryptedNationalId: encryptSensitiveString('000000000'),
          nationalIdLast4: '0000',
          phone: phoneVal,
          email: emailVal || undefined,
          address: addressVal,
          city: 'חיפה',
          lat: Number((32.784 + (Math.random() - 0.5) * 0.005).toFixed(5)),
          lng: Number((35.0195 + (Math.random() - 0.5) * 0.005).toFixed(5)),
          significantDatesJson: JSON.stringify([]),
          interactionsJson: JSON.stringify([]),
          attachmentsJson: JSON.stringify([]),
        });
        importedCount++;
      }

      setSyncMessage({
        type: 'success',
        text:
          importedCount > 0
            ? `יובאו בהצלחה ${importedCount} אנשי קשר חדשים מחשבון Google Contacts שלך.`
            : 'הסנכרון מול Google Contacts הושלם (כל אנשי הקשר כבר קיימים במערכת או שהרשימה ריקה).',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('popup-closed-by-user')) {
        setSyncMessage({
          type: 'error',
          text: `שגיאה בייבוא מ-Google Contacts: ${msg}`,
        });
      }
    } finally {
      setIsSyncingGoogle(false);
    }
  };

  // --- ייצוא לאנשי קשר של גוגל (עם חלונית אישור מפורשת כנדרש) ---
  const handleConfirmExportToGoogleContacts = async () => {
    setShowGoogleExportConfirm(false);
    setIsSyncingGoogle(true);
    setSyncMessage(null);

    try {
      const token = await ensureGoogleAccessToken();
      if (!token) {
        setSyncMessage({
          type: 'error',
          text: 'נדרשת התחברות לחשבון Google כדי לייצא לאנשי הקשר של גוגל.',
        });
        return;
      }

      let exportedCount = 0;
      for (const donor of allActiveDonors) {
        const payload = {
          names: [{ givenName: donor.fullName }],
          phoneNumbers: donor.phone ? [{ value: donor.phone, type: 'mobile' }] : [],
          emailAddresses: donor.email ? [{ value: donor.email, type: 'home' }] : [],
          addresses: donor.address
            ? [{ streetAddress: donor.address, city: donor.city || 'חיפה', type: 'home' }]
            : [],
          biographies: [
            {
              value: `${donor.identifierMark} | קשר: ${donor.personalConnection}`,
              contentType: 'TEXT_PLAIN',
            },
          ],
        };

        const res = await fetch('https://people.googleapis.com/v1/people:createContact', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          exportedCount++;
        }
      }

      setSyncMessage({
        type: 'success',
        text: `יוצאו בהצלחה ${exportedCount} אנשי קשר מהמערכת אל Google Contacts בחשבונך.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('popup-closed-by-user')) {
        setSyncMessage({
          type: 'error',
          text: `שגיאה בייצוא ל-Google Contacts: ${msg}`,
        });
      }
    } finally {
      setIsSyncingGoogle(false);
    }
  };

  const handleCreateDonor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !canWriteCrm) return;

    const cleanId = nationalIdPlain.trim();
    const last4 = cleanId ? cleanId.slice(-4).padStart(4, '0') : '';
    const sigDates: SignificantHebrewDateItem[] = sigTriplet
      ? [
          {
            id: 'sd_' + Date.now(),
            type: sigTitle.includes('אזכרה') ? 'yahrtzeit' : 'birthday',
            title: sigTitle.trim() || 'יום הולדת',
            hebrewDay: sigTriplet.day,
            hebrewMonth: sigTriplet.month,
            hebrewYear: sigTriplet.year,
          },
        ]
      : [];

    await onSaveDonor({
      fullName: fullName.trim(),
      identifierMark: identifierMark.trim() || 'ידיד בית חב״ד',
      personalConnection: personalConnection.trim() || 'קשר קהילתי',
      encryptedNationalId: cleanId ? encryptSensitiveString(cleanId) : '',
      nationalIdLast4: last4,
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      city: 'חיפה',
      lat: Number((32.784 + (Math.random() - 0.5) * 0.005).toFixed(5)),
      lng: Number((35.0195 + (Math.random() - 0.5) * 0.005).toFixed(5)),
      significantDatesJson: JSON.stringify(sigDates),
      interactionsJson: JSON.stringify([]),
      nextActionText: nextActionText.trim(),
      nextActionDate: nextActionDate || undefined,
      attachmentsJson: JSON.stringify([]),
      tagsJson: JSON.stringify(newDonorTags),
    });

    setFullName('');
    setIdentifierMark('');
    setPersonalConnection('');
    setNationalIdPlain('');
    setPhone('');
    setAddress('');
    setNextActionText('');
    setNextActionDate('');
    setSigTriplet(null);
    setNewDonorTags(['תושבי השכונה']);
    setShowDonorForm(false);
  };

  const handleAddInteraction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDonor || !interactionSummary.trim() || !canWriteCrm) return;

    let list: DonorInteractionItem[] = [];
    try {
      list = JSON.parse(selectedDonor.interactionsJson || '[]');
    } catch {
      list = [];
    }

    const newItem: DonorInteractionItem = {
      id: 'int_' + Date.now(),
      date: new Date().toISOString().slice(0, 10),
      type: interactionType,
      summary: interactionSummary.trim(),
      recordedBy: 'שליח / רכז CRM',
    };

    await onSaveDonor(
      {
        fullName: selectedDonor.fullName,
        identifierMark: selectedDonor.identifierMark,
        personalConnection: selectedDonor.personalConnection,
        encryptedNationalId: selectedDonor.encryptedNationalId,
        nationalIdLast4: selectedDonor.nationalIdLast4,
        phone: selectedDonor.phone,
        email: selectedDonor.email,
        address: selectedDonor.address,
        city: selectedDonor.city,
        lat: selectedDonor.lat,
        lng: selectedDonor.lng,
        significantDatesJson: selectedDonor.significantDatesJson,
        interactionsJson: JSON.stringify([newItem, ...list]),
        nextActionText: selectedDonor.nextActionText,
        nextActionDate: selectedDonor.nextActionDate,
        attachmentsJson: selectedDonor.attachmentsJson,
        tagsJson: selectedDonor.tagsJson,
      },
      selectedDonor.id
    );
    setInteractionSummary('');
  };

  const handleCreateCommunityEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titleOrName.trim() || !canWriteCrm) return;
    await onSaveCommunityEntity({
      entityType,
      titleOrName: titleOrName.trim(),
      phoneOrSchedule: phoneOrSchedule.trim(),
      areaOrAddress: areaOrAddress.trim(),
      lat: 32.7842,
      lng: 35.0198,
      notes: entityNotes.trim(),
      isActive: true,
    });
    setTitleOrName('');
    setPhoneOrSchedule('');
    setAreaOrAddress('');
    setEntityNotes('');
    setShowEntityForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">
            CRM תורמים, אנשי קשר, מתנדבים ושיעורים קבועים
          </h2>
          <p className="text-sm text-slate-600">
            ניהול תורמים ואנשי קשר עם ייבוא וייצוא דו-כיווני מ/אל <strong>Google Contacts</strong> וטבלאות <strong>Excel</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setSubTab('donors')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                subTab === 'donors' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              תורמים ואנשי קשר ({allActiveDonors.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('volunteers_classes')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                subTab === 'volunteers_classes' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              מתנדבים ושיעורים קבועים ({communityEntities.filter((c) => !c.deletedAt).length})
            </button>
          </div>

          {canWriteCrm && subTab === 'donors' && (
            <button
              type="button"
              onClick={() => setShowDonorForm(!showDonorForm)}
              className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              תורם / איש קשר חדש
            </button>
          )}

          {canWriteCrm && subTab === 'volunteers_classes' && (
            <button
              type="button"
              onClick={() => setShowEntityForm(!showEntityForm)}
              className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              מתנדב / שיעור קבוע חדש
            </button>
          )}
        </div>
      </div>

      {/* סרגל ייבוא וייצוא: Google Contacts + טבלת אקסל */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-0.5">
          <h3 className="text-sm font-bold text-slate-900">
            ייבוא וייצוא אנשי קשר (Google Contacts וטבלת Excel)
          </h3>
          <p className="text-xs text-slate-500">
            סנכרן את מאגר אנשי הקשר של בית חב״ד ישירות מול אנשי הקשר של גוגל או קובצי אקסל (.xlsx / .csv)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Excel Import */}
          <input
            ref={excelFileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleImportExcelFile}
            className="hidden"
          />
          {canWriteCrm && (
            <button
              type="button"
              onClick={() => excelFileInputRef.current?.click()}
              className="px-3 py-1.5 text-xs font-semibold bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>ייבוא מטבלת אקסל</span>
            </button>
          )}

          {/* Excel Export */}
          <button
            type="button"
            onClick={handleExportExcel}
            className="px-3 py-1.5 text-xs font-semibold bg-white text-slate-800 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>ייצוא לטבלת אקסל (.xlsx)</span>
          </button>

          {/* Google Contacts Import */}
          {canWriteCrm && (
            <button
              type="button"
              disabled={isSyncingGoogle}
              onClick={handleImportFromGoogleContacts}
              className="px-3 py-1.5 text-xs font-semibold bg-blue-50 text-blue-900 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingGoogle ? 'animate-spin' : ''}`} />
              <span>ייבוא מאנשי קשר של גוגל</span>
            </button>
          )}

          {/* Google Contacts Export */}
          <button
            type="button"
            disabled={isSyncingGoogle}
            onClick={() => setShowGoogleExportConfirm(true)}
            className="px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>ייצוא לאנשי קשר של גוגל</span>
          </button>
        </div>
      </div>

      {/* חלונית אישור מפורשת לפני ייצוא ל-Google Contacts */}
      {showGoogleExportConfirm && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-sm font-bold text-slate-900">
              אישור ייצוא {allActiveDonors.length} אנשי קשר אל Google Contacts
            </div>
            <p className="text-xs text-slate-700">
              פעולה זו תיצור רשומות אנשי קשר חדשות בחשבון Google Contacts שלך עבור {allActiveDonors.length} אנשי הקשר הפעילים במערכת. האם להמשיך?
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowGoogleExportConfirm(false)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              ביטול
            </button>
            <button
              type="button"
              onClick={handleConfirmExportToGoogleContacts}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
            >
              אשר וייצא ל-Google Contacts
            </button>
          </div>
        </div>
      )}

      {syncMessage && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-sm ${
            syncMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2 font-semibold">
            {syncMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            )}
            <span>{syncMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setSyncMessage(null)}
            className="text-xs underline"
          >
            סגור
          </button>
        </div>
      )}

      {subTab === 'donors' ? (
        <>
          {showDonorForm && canWriteCrm && (
            <form
              onSubmit={handleCreateDonor}
              className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
            >
              <h3 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-2">
                הוספת תורם / איש קשר חדש למאגר ה-CRM
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">שם מלא *</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="למשל: ר׳ ישראל ישראלי"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">סימן זיהוי *</label>
                  <input
                    type="text"
                    required
                    value={identifierMark}
                    onChange={(e) => setIdentifierMark(e.target.value)}
                    placeholder="למשל: בעל חנות אופטיקה, מתפלל בשבת"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">קשר פרטי *</label>
                  <input
                    type="text"
                    required
                    value={personalConnection}
                    onChange={(e) => setPersonalConnection(e.target.value)}
                    placeholder="למשל: ידיד אישי של השליח מתשע״ט"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    תעודת זהות (רשות — תוצפן במאגר כ-••••1234)
                  </label>
                  <input
                    type="text"
                    maxLength={9}
                    value={nationalIdPlain}
                    onChange={(e) => setNationalIdPlain(e.target.value)}
                    placeholder="לא חובה (עד 9 ספרות)"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">טלפון *</label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="052-0000000"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">כתובת מגורים (לחיבור למפה) *</label>
                  <input
                    type="text"
                    required
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="רחוב ומספר בית, עיר"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    סוג מועד עברי משמעותי (רשות: יום הולדת / אזכרה)
                  </label>
                  <input
                    type="text"
                    value={sigTitle}
                    onChange={(e) => setSigTitle(e.target.value)}
                    placeholder="למשל: יום הולדת / אזכרת האב"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="md:col-span-2">
                  <HebrewDatePicker
                    allowClear
                    clearLabel="ללא תאריך יום הולדת / אזכרה (רשות)"
                    label="תאריך עברי משמעותי (רשות — ניתן לבחור יום הולדת או אזכרה גם 150 שנה אחורה)"
                    value={sigTriplet}
                    onChange={(newTriplet) => setSigTriplet(newTriplet)}
                    onClear={() => setSigTriplet(null)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">הפעולה הבאה למעקב</label>
                  <input
                    type="text"
                    value={nextActionText}
                    onChange={(e) => setNextActionText(e.target.value)}
                    placeholder="למשל: לתאם ביקור בית לפני החג"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="md:col-span-2">
                  <HebrewDatePicker
                    allowClear
                    clearLabel="ללא תאריך יעד לפעולה הבאה"
                    label="תאריך יעד לפעולה הבאה (לוח שנה עברי)"
                    value={nextActionDate ? fromGregorianDate(nextActionDate).triplet : null}
                    onChange={(_tr, conv) => setNextActionDate(conv.gregorianIso)}
                    onClear={() => setNextActionDate('')}
                  />
                </div>
                <div className="md:col-span-3 pt-2 border-t border-slate-100">
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    תוויות שיוך לאיש הקשר (למשל: &quot;תורמים&quot;, &quot;תושבי השכונה&quot;, &quot;חבדניקים&quot; ועוד):
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {allAvailableTags.map((tag) => {
                      const active = newDonorTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() =>
                            setNewDonorTags((prev) =>
                              prev.includes(tag)
                                ? prev.filter((t) => t !== tag)
                                : [...prev, tag]
                            )
                          }
                          className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1 ${
                            active
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          <Tag className="w-3 h-3" />
                          <span>{tag}</span>
                        </button>
                      );
                    })}
                    <div className="flex items-center gap-1 mr-2">
                      <input
                        type="text"
                        value={newCustomTagInput}
                        onChange={(e) => setNewCustomTagInput(e.target.value)}
                        placeholder="תווית חדשה..."
                        className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg w-32"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const clean = newCustomTagInput.trim();
                          if (!clean) return;
                          handleAddCustomTagToList(clean);
                          if (!newDonorTags.includes(clean)) {
                            setNewDonorTags((prev) => [...prev, clean]);
                          }
                        }}
                        className="px-2.5 py-1 text-xs font-bold bg-slate-200 hover:bg-slate-300 text-slate-900 rounded-lg"
                      >
                        + הוסף תווית
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDonorForm(false)}
                  className="px-4 py-2 text-xs text-slate-600"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg"
                >
                  שמור תורם במאגר
                </button>
              </div>
            </form>
          )}

          {/* מערכת סינון מתקדמת לפי תוויות (תורמים, תושבי השכונה, חבדניקים ותוויות מותאמות אישית) */}
          <div className="bg-white border border-slate-300/90 rounded-xl p-4 space-y-3 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2.5">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-blue-800" />
                <h3 className="text-sm font-bold text-slate-900">
                  סינון אנשי קשר לפי תוויות (&quot;תורמים&quot;, &quot;תושבי השכונה&quot;, &quot;חבדניקים&quot; ועוד)
                </h3>
              </div>

              {/* הוספת תווית חדשה לרשימה לבד */}
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newCustomTagInput}
                  onChange={(e) => setNewCustomTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomTagToList(newCustomTagInput);
                    }
                  }}
                  placeholder="הוסף תווית חדשה לרשימה..."
                  className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white w-44"
                />
                <button
                  type="button"
                  onClick={() => handleAddCustomTagToList(newCustomTagInput)}
                  className="px-2.5 py-1 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>הוסף תווית</span>
                </button>
              </div>
            </div>

            {/* כפתורי בחירת תוויות לסינון (תווית אחת או יותר) */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-600 ml-1">בחר תוויות לסינון:</span>
              {allAvailableTags.map((tag) => {
                const isSelected = selectedFilterTags.includes(tag);
                const countWithTag = allActiveDonors.filter((d) =>
                  parseDonorTags(d.tagsJson).includes(tag)
                ).length;

                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleToggleFilterTag(tag)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                        : 'bg-slate-50 text-slate-800 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <Tag className="w-3.5 h-3.5" />
                    <span>{tag}</span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                        isSelected ? 'bg-slate-700 text-amber-300' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {countWithTag}
                    </span>
                  </button>
                );
              })}

              {selectedFilterTags.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFilterTags([]);
                    setTagFilterMode('any');
                  }}
                  className="px-2.5 py-1 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>נקה סינון תוויות</span>
                </button>
              )}
            </div>

            {/* בחירת אופן הסינון: אחת מהתוויות / כל התוויות שנבחרו / מספר תוויות שייבחר */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-bold text-slate-700">תנאי התאמת תוויות:</span>

                <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-slate-800">
                  <input
                    type="radio"
                    name="tagFilterMode"
                    checked={tagFilterMode === 'any'}
                    onChange={() => setTagFilterMode('any')}
                  />
                  <span>כל מי שיש לו אחת מהתוויות שנבחרו (לפחות אחת)</span>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-slate-800">
                  <input
                    type="radio"
                    name="tagFilterMode"
                    checked={tagFilterMode === 'all'}
                    onChange={() => setTagFilterMode('all')}
                  />
                  <span>רק מי שיש לו את כל התוויות שנבחרו</span>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-slate-800">
                  <input
                    type="radio"
                    name="tagFilterMode"
                    checked={tagFilterMode === 'min_count'}
                    onChange={() => setTagFilterMode('min_count')}
                  />
                  <span>לפחות מספר תוויות נבחר:</span>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer font-medium text-slate-800">
                  <input
                    type="radio"
                    name="tagFilterMode"
                    checked={tagFilterMode === 'exact_count'}
                    onChange={() => setTagFilterMode('exact_count')}
                  />
                  <span>בדיוק מספר תוויות נבחר:</span>
                </label>

                {(tagFilterMode === 'min_count' || tagFilterMode === 'exact_count') && (
                  <div className="inline-flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-300">
                    <span className="font-semibold text-slate-700">מספר תוויות:</span>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, allAvailableTags.length)}
                      value={tagFilterCount}
                      onChange={(e) => setTagFilterCount(Math.max(1, Number(e.target.value) || 1))}
                      className="w-14 px-2 py-0.5 text-xs font-mono font-bold border border-slate-300 rounded bg-white text-center"
                    />
                  </div>
                )}
              </div>

              <div className="text-slate-600 font-semibold">
                מוצגים כעת: <strong className="text-slate-900">{activeDonors.length}</strong> מתוך{' '}
                {allActiveDonors.length} אנשי קשר
              </div>
            </div>
          </div>

          {/* סרגל חיפוש ותצוגת טבלה רחבה / תצוגת כרטיס מפורט */}
          <div className="bg-white border border-slate-300/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex-1 min-w-[240px]">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="חיפוש מהיר לפי שם, סימן זיהוי, קשר פרטי, כתובת או טלפון..."
                className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer font-medium">
                <input
                  type="checkbox"
                  checked={filterNextActionOnly}
                  onChange={(e) => setFilterNextActionOnly(e.target.checked)}
                />
                <span>רק עם &quot;הפעולה הבאה&quot; פתוחה</span>
              </label>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setDonorDisplayMode('table')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                    donorDisplayMode === 'table'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:text-slate-900'
                  }`}
                >
                  טבלה רחבה מלאה
                </button>
                <button
                  type="button"
                  onClick={() => setDonorDisplayMode('split')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                    donorDisplayMode === 'split'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:text-slate-900'
                  }`}
                >
                  כרטיס תורם ופירוט
                </button>
              </div>
            </div>
          </div>

          {donorDisplayMode === 'table' && (
            <div className="bg-white border border-slate-300/90 rounded-xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto max-h-[620px]">
                <table className="erp-table text-right">
                  <thead>
                    <tr className="text-xs font-semibold text-slate-700">
                      <th className="py-3.5 px-4 col-compact">שם מלא וטלפון</th>
                      <th className="py-3.5 px-5 col-text-wide">סימן זיהוי וקשר פרטי מפורט לבית חב״ד</th>
                      <th className="py-3.5 px-5 col-text-medium">כתובת מגורים והפעולה הבאה למעקב</th>
                      <th className="py-3.5 px-4 col-compact">ת.ז. מוצפנת</th>
                      <th className="py-3.5 px-4 text-left col-compact">פעולות</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/80 text-sm">
                    {activeDonors.map((d) => (
                      <tr
                        key={d.id}
                        onClick={() => {
                          onSelectDonorId(d.id);
                        }}
                        className={`cursor-pointer ${
                          selectedDonor?.id === d.id ? 'ring-1 ring-inset ring-slate-400' : ''
                        }`}
                      >
                        <td className="py-3.5 px-4 whitespace-nowrap align-top">
                          <div className="font-bold text-slate-900 text-base">{d.fullName}</div>
                          <div className="text-xs font-mono text-slate-600 mt-0.5">{d.phone}</div>
                        </td>
                        <td className="py-3.5 px-5 col-text-wide align-top">
                          <div className="font-semibold text-slate-900 leading-snug">
                            {d.identifierMark}
                          </div>
                          <div className="text-xs text-slate-700 mt-1 leading-relaxed">
                            <strong>קשר אישי:</strong> {d.personalConnection}
                          </div>
                          <div className="flex flex-wrap items-center gap-1 mt-1.5">
                            {parseDonorTags(d.tagsJson).map((t) => (
                              <span
                                key={t}
                                className="px-2 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-800 border border-slate-300 rounded-md"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3.5 px-5 col-text-medium align-top text-xs">
                          <div className="text-slate-800 font-medium leading-snug">{d.address}</div>
                          {d.nextActionText ? (
                            <div className="text-amber-900 font-semibold mt-1 leading-relaxed">
                              הפעולה הבאה: {d.nextActionText}
                              {d.nextActionDate ? ` (${d.nextActionDate})` : ''}
                            </div>
                          ) : (
                            <div className="text-slate-500 mt-1">ללא פעולה פתוחה</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap align-top font-mono tabular-nums text-xs">
                          <div className="inline-flex items-center gap-1.5">
                            <span>
                              {formatMaskedNationalId(d.nationalIdLast4, revealedIds[d.id])}
                            </span>
                            {canRevealNationalId && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleRevealId(d);
                                }}
                                className="text-slate-600 hover:text-slate-900"
                                title="חשוף ת.ז."
                              >
                                {revealedIds[d.id] ? (
                                  <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-left whitespace-nowrap align-top">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectDonorId(d.id);
                                setDonorDisplayMode('split');
                              }}
                              className="px-2.5 py-1 text-xs font-semibold border border-slate-300 rounded hover:bg-slate-200/70 text-slate-800"
                            >
                              כרטיס מלא
                            </button>
                            {canWriteCrm && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSoftDeleteDonor(d.id);
                                }}
                                className="p-1.5 text-red-700 hover:bg-red-100/60 rounded"
                                title="מחיקה רכה"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Donors List */}
            <div className="bg-white border border-slate-300/80 rounded-xl p-4 space-y-3">
              <div className="text-xs font-bold text-slate-800 border-b border-slate-200 pb-2">
                רשימת תורמים ואנשי קשר ({activeDonors.length})
              </div>

              <div className="divide-y divide-slate-200/70 max-h-[540px] overflow-y-auto">
                {activeDonors.map((d) => {
                  const isSelected = selectedDonor?.id === d.id;
                  return (
                    <div
                      key={d.id}
                      onClick={() => onSelectDonorId(d.id)}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        isSelected ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="font-bold text-sm">{d.fullName}</div>
                      <div className={`text-xs mt-0.5 ${isSelected ? 'text-slate-300' : 'text-slate-600'}`}>
                        {d.identifierMark}
                      </div>
                      {parseDonorTags(d.tagsJson).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {parseDonorTags(d.tagsJson).map((t) => (
                            <span
                              key={t}
                              className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${
                                isSelected
                                  ? 'bg-slate-800 text-amber-300 border-slate-700'
                                  : 'bg-slate-100 text-slate-700 border-slate-200'
                              }`}
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className={`text-xs mt-1 font-mono ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {d.phone} · {d.address}
                      </div>
                      {d.nextActionText && (
                        <div
                          className={`text-[11px] mt-1.5 font-medium ${
                            isSelected ? 'text-amber-300' : 'text-amber-800'
                          }`}
                        >
                          הפעולה הבאה: {d.nextActionText}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Selected Donor Details */}
            <div className="lg:col-span-2 space-y-6">
              {selectedDonor ? (
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">{selectedDonor.fullName}</h3>
                      <p className="text-sm text-slate-700 mt-0.5">
                        <strong>סימן זיהוי:</strong> {selectedDonor.identifierMark}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        <strong>קשר פרטי:</strong> {selectedDonor.personalConnection}
                      </p>
                      {/* ניהול ושיוך תוויות לאיש הקשר הנבחר */}
                      <div className="mt-3 space-y-2">
                        <div className="text-xs font-bold text-slate-700 flex items-center gap-1">
                          <Tag className="w-3.5 h-3.5 text-blue-800" />
                          <span>תוויות משויכות (לחץ להוספה/הסרה):</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {allAvailableTags.map((tag) => {
                            const hasTag = parseDonorTags(selectedDonor.tagsJson).includes(tag);
                            return (
                              <button
                                key={tag}
                                type="button"
                                disabled={!canWriteCrm}
                                onClick={() => handleToggleDonorTag(selectedDonor, tag)}
                                className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${
                                  hasTag
                                    ? 'bg-slate-900 text-white border-slate-900'
                                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-400'
                                }`}
                              >
                                {hasTag ? `✓ ${tag}` : `+ ${tag}`}
                              </button>
                            );
                          })}
                          {canWriteCrm && (
                            <div className="inline-flex items-center gap-1">
                              <input
                                type="text"
                                value={cardNewTagInput}
                                onChange={(e) => setCardNewTagInput(e.target.value)}
                                placeholder="תווית חדשה..."
                                className="px-2 py-1 text-xs border border-slate-300 rounded-md w-28"
                              />
                              <button
                                type="button"
                                onClick={async () => {
                                  const clean = cardNewTagInput.trim();
                                  if (!clean) return;
                                  handleAddCustomTagToList(clean);
                                  setCardNewTagInput('');
                                  if (!parseDonorTags(selectedDonor.tagsJson).includes(clean)) {
                                    await handleToggleDonorTag(selectedDonor, clean);
                                  }
                                }}
                                className="px-2 py-1 text-xs font-bold bg-slate-200 hover:bg-slate-300 text-slate-900 rounded-md"
                              >
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg text-xs flex items-center gap-2">
                        <span className="text-slate-500">ת.ז. מוצפנת:</span>
                        <span className="font-mono font-bold text-slate-900 tabular-nums">
                          {formatMaskedNationalId(
                            selectedDonor.nationalIdLast4,
                            revealedIds[selectedDonor.id]
                          )}
                        </span>
                        {canRevealNationalId && (
                          <button
                            type="button"
                            onClick={() => handleToggleRevealId(selectedDonor)}
                            className="text-slate-600 hover:text-slate-900"
                            title="חשוף תעודת זהות (מתועד ביומן הביקורת)"
                          >
                            {revealedIds[selectedDonor.id] ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>

                      {canWriteCrm && (
                        <button
                          type="button"
                          onClick={() => onSoftDeleteDonor(selectedDonor.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                          title="מחיקה רכה"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Contact & Next Action */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="p-3 bg-slate-50 rounded-lg space-y-1">
                      <div className="flex items-center gap-2 text-slate-700">
                        <Phone className="w-4 h-4 text-slate-500" />
                        <span className="font-mono">{selectedDonor.phone}</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-700">
                        <MapPin className="w-4 h-4 text-slate-500" />
                        <span>{selectedDonor.address}</span>
                      </div>
                    </div>

                    <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg">
                      <div className="text-xs font-bold text-amber-900">הפעולה הבאה למעקב אישי:</div>
                      <div className="text-sm font-semibold text-slate-900 mt-0.5">
                        {selectedDonor.nextActionText || 'אין פעולה פתוחה כעת'}
                      </div>
                      {selectedDonor.nextActionDate && (
                        <div className="text-xs text-amber-800 font-mono mt-0.5">
                          תאריך יעד לתזכורת: {fromGregorianDate(selectedDonor.nextActionDate).hebrewDisplay} ({selectedDonor.nextActionDate})
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Significant Hebrew Dates (Leap-year aware, 150 years back) */}
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-slate-700" />
                        תאריכים משמעותיים עבריים (ימי הולדת, נישואין ואזכרות — עד 150 שנה אחורה)
                      </h4>
                      {canWriteCrm && (
                        <button
                          type="button"
                          onClick={() => setShowAddSigDateForm(!showAddSigDateForm)}
                          className="px-2.5 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg flex items-center gap-1"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>הוסף יום הולדת / אזכרה</span>
                        </button>
                      )}
                    </div>

                    {showAddSigDateForm && canWriteCrm && (
                      <div className="mb-3 p-3.5 bg-slate-50 border border-slate-300 rounded-xl space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">סוג מועד</label>
                            <select
                              value={cardSigType}
                              onChange={(e) => {
                                const val = e.target.value as 'birthday' | 'anniversary' | 'yahrtzeit';
                                setCardSigType(val);
                                if (val === 'birthday') setCardSigTitle('יום הולדת');
                                if (val === 'yahrtzeit') setCardSigTitle('אזכרה (יארצייט)');
                                if (val === 'anniversary') setCardSigTitle('יום נישואין');
                              }}
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                            >
                              <option value="birthday">יום הולדת</option>
                              <option value="yahrtzeit">אזכרה (יארצייט)</option>
                              <option value="anniversary">יום נישואין</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">תיאור המועד</label>
                            <input
                              type="text"
                              value={cardSigTitle}
                              onChange={(e) => setCardSigTitle(e.target.value)}
                              placeholder="למשל: אזכרת האב ר׳ משה ז״ל"
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                            />
                          </div>
                          <div>
                            <HebrewDatePicker
                              compact
                              label="בחר תאריך בלוח עברי (עד 150 שנה אחורה)"
                              value={cardSigTriplet}
                              onChange={(tr) => setCardSigTriplet(tr)}
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setShowAddSigDateForm(false)}
                            className="px-3 py-1 text-xs text-slate-600"
                          >
                            ביטול
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              let existingSigs: SignificantHebrewDateItem[] = [];
                              try {
                                existingSigs = JSON.parse(selectedDonor.significantDatesJson || '[]');
                              } catch {
                                existingSigs = [];
                              }
                              const newSig: SignificantHebrewDateItem = {
                                id: 'sd_' + Date.now(),
                                type: cardSigType,
                                title: cardSigTitle.trim() || 'מועד עברי',
                                hebrewDay: cardSigTriplet.day,
                                hebrewMonth: cardSigTriplet.month,
                                hebrewYear: cardSigTriplet.year,
                              };
                              await onSaveDonor(
                                {
                                  fullName: selectedDonor.fullName,
                                  identifierMark: selectedDonor.identifierMark,
                                  personalConnection: selectedDonor.personalConnection,
                                  encryptedNationalId: selectedDonor.encryptedNationalId,
                                  nationalIdLast4: selectedDonor.nationalIdLast4,
                                  phone: selectedDonor.phone,
                                  email: selectedDonor.email,
                                  address: selectedDonor.address,
                                  city: selectedDonor.city,
                                  lat: selectedDonor.lat,
                                  lng: selectedDonor.lng,
                                  significantDatesJson: JSON.stringify([...existingSigs, newSig]),
                                  interactionsJson: selectedDonor.interactionsJson,
                                  nextActionText: selectedDonor.nextActionText,
                                  nextActionDate: selectedDonor.nextActionDate,
                                  attachmentsJson: selectedDonor.attachmentsJson,
                                  tagsJson: selectedDonor.tagsJson,
                                },
                                selectedDonor.id
                              );
                              setShowAddSigDateForm(false);
                            }}
                            className="px-3.5 py-1 bg-slate-900 text-white text-xs font-semibold rounded-lg"
                          >
                            שמור מועד עברי
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {(() => {
                        let sigs: SignificantHebrewDateItem[] = [];
                        try {
                          sigs = JSON.parse(selectedDonor.significantDatesJson || '[]');
                        } catch {
                          sigs = [];
                        }
                        if (sigs.length === 0) {
                          return <div className="text-xs text-slate-500">לא הוגדרו תאריכים עבריים (רשות).</div>;
                        }
                        return sigs.map((s) => {
                          const thisYear = getAnniversaryInHebrewYear(
                            { day: s.hebrewDay, month: s.hebrewMonth, year: s.hebrewYear },
                            5787
                          );
                          return (
                            <div
                              key={s.id}
                              className="p-3 border border-slate-200 rounded-lg text-xs space-y-1 flex items-start justify-between"
                            >
                              <div className="space-y-1">
                                <div className="font-bold text-slate-900">{s.title}</div>
                                <div className="text-slate-700">
                                  מועד השנה (תשפ״ז): <strong>{thisYear.hebrewDisplay}</strong> (שנת המקור: {s.hebrewYear})
                                </div>
                                <div className="text-slate-500 font-mono tabular-nums">
                                  לועזי קרוב: {thisYear.gregorianIso} · שקיעה: {thisYear.sunsetTime}
                                </div>
                              </div>
                              {canWriteCrm && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const filtered = sigs.filter((x) => x.id !== s.id);
                                    await onSaveDonor(
                                      {
                                        fullName: selectedDonor.fullName,
                                        identifierMark: selectedDonor.identifierMark,
                                        personalConnection: selectedDonor.personalConnection,
                                        encryptedNationalId: selectedDonor.encryptedNationalId,
                                        nationalIdLast4: selectedDonor.nationalIdLast4,
                                        phone: selectedDonor.phone,
                                        email: selectedDonor.email,
                                        address: selectedDonor.address,
                                        city: selectedDonor.city,
                                        lat: selectedDonor.lat,
                                        lng: selectedDonor.lng,
                                        significantDatesJson: JSON.stringify(filtered),
                                        interactionsJson: selectedDonor.interactionsJson,
                                        nextActionText: selectedDonor.nextActionText,
                                        nextActionDate: selectedDonor.nextActionDate,
                                        attachmentsJson: selectedDonor.attachmentsJson,
                                        tagsJson: selectedDonor.tagsJson,
                                      },
                                      selectedDonor.id
                                    );
                                  }}
                                  className="text-slate-400 hover:text-red-600 p-1"
                                  title="הסר תאריך"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>

                  {/* Automatic Donation History from Financial Module */}
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-slate-700" />
                      היסטוריית תרומות והתחייבויות (מתעדכנת אוטומטית מהמודול הפיננסי)
                    </h4>
                    <div className="border border-slate-300/80 rounded-lg overflow-hidden">
                      <table className="erp-table text-right text-xs">
                        <thead>
                          <tr>
                            <th className="py-2.5 px-3 col-compact">תאריך</th>
                            <th className="py-2.5 px-4 col-text-wide">תיאור מפורט וקופה</th>
                            <th className="py-2.5 px-3 col-compact">קבלה</th>
                            <th className="py-2.5 px-3 col-compact">סכום ברוטו</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {transactions
                            .filter((t) => !t.deletedAt && t.donorId === selectedDonor.id)
                            .map((t) => (
                              <tr key={t.id}>
                                <td className="py-2 px-3 font-mono">{t.hebrewDateDisplay || t.date}</td>
                                <td className="py-2 px-3">
                                  {t.description} ({t.fundSource === 'regular' ? 'כספים רגילים' : 'עמותה שנייה'})
                                </td>
                                <td className="py-2 px-3 font-mono">{t.receiptNumber || 'ממתין'}</td>
                                <td className="py-2 px-3 font-mono font-bold text-emerald-700">
                                  {formatAgorotToIls(t.grossAmountAgorot)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Home Visits & Calls Tracking */}
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                      <History className="w-4 h-4 text-slate-700" />
                      מעקב קשר: ביקורי בית, שיחות ופגישות
                    </h4>
                    {canWriteCrm && (
                      <form onSubmit={handleAddInteraction} className="flex gap-2 mb-3">
                        <select
                          value={interactionType}
                          onChange={(e) =>
                            setInteractionType(e.target.value as 'home_visit' | 'phone_call' | 'meeting')
                          }
                          className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                        >
                          <option value="home_visit">ביקור בית</option>
                          <option value="phone_call">שיחת טלפון</option>
                          <option value="meeting">פגישה אישית</option>
                        </select>
                        <input
                          type="text"
                          value={interactionSummary}
                          onChange={(e) => setInteractionSummary(e.target.value)}
                          placeholder="תעד סיכום ביקור בית או שיחה..."
                          className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                        />
                        <button
                          type="submit"
                          className="px-3 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg"
                        >
                          הוסף תיעוד
                        </button>
                      </form>
                    )}
                    <div className="space-y-2">
                      {(() => {
                        let list: DonorInteractionItem[] = [];
                        try {
                          list = JSON.parse(selectedDonor.interactionsJson || '[]');
                        } catch {
                          list = [];
                        }
                        return list.map((item) => (
                          <div key={item.id} className="p-2.5 bg-slate-50 rounded-lg text-xs flex justify-between">
                            <div>
                              <strong className="text-slate-900">
                                {item.type === 'home_visit'
                                  ? 'ביקור בית'
                                  : item.type === 'phone_call'
                                  ? 'שיחת טלפון'
                                  : 'פגישה'}
                                :
                              </strong>{' '}
                              <span className="text-slate-700">{item.summary}</span>
                            </div>
                            <span className="font-mono text-slate-500">{item.date}</span>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          {showEntityForm && canWriteCrm && (
            <form
              onSubmit={handleCreateCommunityEntity}
              className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
            >
              <h3 className="text-base font-bold text-slate-900">
                הוספת מתנדב (ישות נפרדת ממשתמש מערכת) או שיעור/חוג קבוע
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">סוג רשומה</label>
                  <select
                    value={entityType}
                    onChange={(e) => setEntityType(e.target.value as 'volunteer' | 'regular_class')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="volunteer">מתנדב בקהילה</option>
                    <option value="regular_class">שיעור תורה / חוג קבוע</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">שם המתנדב / כותרת השיעור *</label>
                  <input
                    type="text"
                    required
                    value={titleOrName}
                    onChange={(e) => setTitleOrName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">טלפון / מועד קבוע</label>
                  <input
                    type="text"
                    value={phoneOrSchedule}
                    onChange={(e) => setPhoneOrSchedule(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">אזור חלוקה / מיקום</label>
                  <input
                    type="text"
                    value={areaOrAddress}
                    onChange={(e) => setAreaOrAddress(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEntityForm(false)}
                  className="px-4 py-2 text-xs text-slate-600"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg"
                >
                  שמור רשומה
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {communityEntities
              .filter((c) => !c.deletedAt)
              .map((ent) => (
                <div
                  key={ent.id}
                  className="bg-white border border-slate-200 rounded-xl p-4 flex items-start justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <UserCheck className="w-4 h-4 text-slate-700" />
                      <span className="font-bold text-slate-900">{ent.titleOrName}</span>
                    </div>
                    <div className="text-xs text-slate-600">{ent.areaOrAddress}</div>
                    {ent.phoneOrSchedule && (
                      <div className="text-xs font-mono text-slate-500">{ent.phoneOrSchedule}</div>
                    )}
                    {ent.notes && <div className="text-xs text-slate-500">{ent.notes}</div>}
                  </div>
                  <span className="text-xs text-slate-500">
                    {ent.entityType === 'volunteer'
                      ? 'מתנדב שטח'
                      : ent.entityType === 'regular_class'
                      ? 'שיעור קבוע'
                      : 'הערת רחוב'}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};
