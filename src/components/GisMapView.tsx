import React, { useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import {
  MapPin,
  Navigation,
  Phone,
  Plus,
  Search,
  Building2,
  Edit3,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { DonorContactRecord, VolunteerEntityRecord } from '../types/erp';
import { encryptSensitiveString } from '../lib/erp-core';

const defaultIcon = L.divIcon({
  className: 'custom-leaflet-pin',
  html: `<div style="background-color:#0f172a;color:#ffffff;width:28px;height:28px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.35);font-size:12px;font-weight:700;">ח</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

const selectedBuildingIcon = L.divIcon({
  className: 'custom-leaflet-pin-selected',
  html: `<div style="background-color:#2563eb;color:#ffffff;width:32px;height:32px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:3px solid #ffffff;box-shadow:0 3px 10px rgba(37,99,235,0.55);font-size:13px;font-weight:800;">⌂</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

const volunteerIcon = L.divIcon({
  className: 'custom-leaflet-pin-vol',
  html: `<div style="background-color:#d97706;color:#ffffff;width:28px;height:28px;border-radius:9999px;display:flex;align-items:center;justify-content:center;border:2px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.35);font-size:12px;font-weight:700;">מ</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

interface GisMapViewProps {
  donors: DonorContactRecord[];
  communityEntities: VolunteerEntityRecord[];
  canWrite: boolean;
  onUpdateDonorCoords: (donorId: string, lat: number, lng: number) => Promise<void>;
  onSaveDonor: (
    data: Omit<DonorContactRecord, 'id' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) => Promise<void>;
  onSoftDeleteDonor: (id: string) => Promise<void>;
  onAddStreetNote: (title: string, address: string, notes: string, lat: number, lng: number) => Promise<void>;
  onSelectDonor: (donorId: string) => void;
}

const MapClickCapture: React.FC<{ onPickCoords: (lat: number, lng: number) => void }> = ({ onPickCoords }) => {
  useMapEvents({
    click(e) {
      onPickCoords(Number(e.latlng.lat.toFixed(5)), Number(e.latlng.lng.toFixed(5)));
    },
  });
  return null;
};

export const GisMapView: React.FC<GisMapViewProps> = ({
  donors,
  communityEntities,
  canWrite,
  onUpdateDonorCoords,
  onSaveDonor,
  onSoftDeleteDonor,
  onAddStreetNote,
  onSelectDonor,
}) => {
  const activeDonors = donors.filter((d) => !d.deletedAt);
  const activeEntities = communityEntities.filter((e) => !e.deletedAt);

  const initialDonor = activeDonors.find((d) => typeof d.lat === 'number' && typeof d.lng === 'number');
  const [centerLat, setCenterLat] = useState(initialDonor?.lat || 32.7842);
  const [centerLng, setCenterLng] = useState(initialDonor?.lng || 35.0195);
  const [selectedLat, setSelectedLat] = useState(initialDonor?.lat || 32.7842);
  const [selectedLng, setSelectedLng] = useState(initialDonor?.lng || 35.0195);
  const [selectedBuildingAddress, setSelectedBuildingAddress] = useState(
    initialDonor?.address || 'רחוב יד לבנים, נווה יוסף, חיפה'
  );

  // Resident Add / Edit state for the selected building
  const [showResidentForm, setShowResidentForm] = useState(false);
  const [editingResidentId, setEditingResidentId] = useState<string | undefined>(undefined);
  const [resFullName, setResFullName] = useState('');
  const [resPhone, setResPhone] = useState('');
  const [resAddress, setResAddress] = useState('');
  const [resIdentifierMark, setResIdentifierMark] = useState('');
  const [resPersonalConnection, setResPersonalConnection] = useState('');

  // Street Note form state
  const [showStreetNoteForm, setShowStreetNoteForm] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteAddress, setNoteAddress] = useState('');
  const [noteText, setNoteText] = useState('');

  const [geocodingDonorId, setGeocodingDonorId] = useState<string | null>(null);
  const [layerFilter, setLayerFilter] = useState<'all' | 'donors' | 'community'>('all');

  // איתור כל הדיירים הגרים בבניין שנבחר (לפי קרבה גיאוגרפית של ~45 מטר או התאמת כתובת הבניין)
  const buildingResidents = activeDonors.filter((d) => {
    const coordMatch =
      typeof d.lat === 'number' &&
      typeof d.lng === 'number' &&
      Math.abs(d.lat - selectedLat) <= 0.00045 &&
      Math.abs(d.lng - selectedLng) <= 0.00045;
    const addrMatch =
      selectedBuildingAddress.trim() !== '' &&
      d.address.trim() !== '' &&
      d.address.trim() === selectedBuildingAddress.trim();
    return coordMatch || addrMatch;
  });

  const handleSelectBuildingLocation = async (lat: number, lng: number, knownAddress?: string) => {
    setSelectedLat(lat);
    setSelectedLng(lng);
    setShowResidentForm(false);
    setEditingResidentId(undefined);

    if (knownAddress) {
      setSelectedBuildingAddress(knownAddress);
      return;
    }

    // Check if there is an existing resident right at this spot
    const nearby = activeDonors.find(
      (d) =>
        typeof d.lat === 'number' &&
        typeof d.lng === 'number' &&
        Math.abs(d.lat - lat) <= 0.00045 &&
        Math.abs(d.lng - lng) <= 0.00045
    );
    if (nearby?.address) {
      setSelectedBuildingAddress(nearby.address);
      return;
    }

    // Reverse geocode building address from OpenStreetMap Nominatim
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=he`
      );
      const data = await res.json();
      if (data?.address) {
        const road = data.address.road || data.address.pedestrian || data.address.suburb || 'נווה יוסף';
        const houseNum = data.address.house_number ? ` ${data.address.house_number}` : '';
        const city = data.address.city || data.address.town || 'חיפה';
        setSelectedBuildingAddress(`${road}${houseNum}, ${city}`);
      } else {
        setSelectedBuildingAddress(`בניין בנקודה (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
      }
    } catch {
      setSelectedBuildingAddress(`בניין בנווה יוסף (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
    }
  };

  const openAddResidentForm = () => {
    setEditingResidentId(undefined);
    setResFullName('');
    setResPhone('');
    setResAddress(selectedBuildingAddress);
    setResIdentifierMark('');
    setResPersonalConnection('תושב הבניין');
    setShowResidentForm(true);
  };

  const openEditResidentForm = (donor: DonorContactRecord) => {
    setEditingResidentId(donor.id);
    setResFullName(donor.fullName);
    setResPhone(donor.phone);
    setResAddress(donor.address || selectedBuildingAddress);
    setResIdentifierMark(donor.identifierMark);
    setResPersonalConnection(donor.personalConnection);
    setShowResidentForm(true);
  };

  const handleSaveResidentAtBuilding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resFullName.trim() || !canWrite) return;

    const existing = editingResidentId
      ? activeDonors.find((d) => d.id === editingResidentId)
      : undefined;

    const finalAddress = resAddress.trim() || selectedBuildingAddress || 'נווה יוסף, חיפה';
    setSelectedBuildingAddress(finalAddress);

    await onSaveDonor(
      {
        fullName: resFullName.trim(),
        identifierMark: resIdentifierMark.trim() || 'תושב השכונה',
        personalConnection: resPersonalConnection.trim() || 'שכן בבניין',
        encryptedNationalId: existing?.encryptedNationalId || encryptSensitiveString('000000000'),
        nationalIdLast4: existing?.nationalIdLast4 || '0000',
        phone: resPhone.trim(),
        email: existing?.email,
        address: finalAddress,
        city: existing?.city || 'חיפה',
        lat: selectedLat,
        lng: selectedLng,
        significantDatesJson: existing?.significantDatesJson || JSON.stringify([]),
        interactionsJson: existing?.interactionsJson || JSON.stringify([]),
        nextActionText: existing?.nextActionText,
        nextActionDate: existing?.nextActionDate,
        attachmentsJson: existing?.attachmentsJson || JSON.stringify([]),
      },
      editingResidentId
    );

    setShowResidentForm(false);
    setEditingResidentId(undefined);
    setResFullName('');
    setResPhone('');
  };

  const handleGeocodeDonor = async (donor: DonorContactRecord) => {
    if (!canWrite) return;
    setGeocodingDonorId(donor.id);
    try {
      const q = encodeURIComponent(`${donor.address} ${donor.city || 'חיפה'} Israel`);
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const lat = Number(parseFloat(data[0].lat).toFixed(5));
        const lng = Number(parseFloat(data[0].lon).toFixed(5));
        await onUpdateDonorCoords(donor.id, lat, lng);
        setCenterLat(lat);
        setCenterLng(lng);
        setSelectedLat(lat);
        setSelectedLng(lng);
        setSelectedBuildingAddress(donor.address);
      } else {
        const offsetLat = Number((32.784 + (Math.random() - 0.5) * 0.006).toFixed(5));
        const offsetLng = Number((35.0195 + (Math.random() - 0.5) * 0.006).toFixed(5));
        await onUpdateDonorCoords(donor.id, offsetLat, offsetLng);
        setSelectedLat(offsetLat);
        setSelectedLng(offsetLng);
        setSelectedBuildingAddress(donor.address);
      }
    } catch {
      const offsetLat = Number((32.784 + (Math.random() - 0.5) * 0.006).toFixed(5));
      const offsetLng = Number((35.0195 + (Math.random() - 0.5) * 0.006).toFixed(5));
      await onUpdateDonorCoords(donor.id, offsetLat, offsetLng);
    } finally {
      setGeocodingDonorId(null);
    }
  };

  const handleSaveStreetNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim() || !canWrite) return;
    await onAddStreetNote(
      noteTitle.trim(),
      noteAddress.trim() || selectedBuildingAddress || 'נקודה שנבחרה על המפה',
      noteText.trim(),
      selectedLat,
      selectedLng
    );
    setNoteTitle('');
    setNoteAddress('');
    setNoteText('');
    setShowStreetNoteForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">
            מפת קהילה ובניינים (GIS) — לחץ על כל בניין לצפייה ועריכת דיירים
          </h2>
          <p className="text-sm text-slate-600">
            לחץ על מיקום של בניין או סיכה במפה כדי לראות מי גר שם, להוסיף דייר/משפחה לבניין, לערוך את פרטיהם או להסירם.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setLayerFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              layerFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            כל השכבות ({activeDonors.length + activeEntities.length})
          </button>
          <button
            type="button"
            onClick={() => setLayerFilter('donors')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              layerFilter === 'donors' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            בניינים ודיירים ({activeDonors.length})
          </button>
          <button
            type="button"
            onClick={() => setLayerFilter('community')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              layerFilter === 'community' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            מתנדבים והערות רחוב ({activeEntities.length})
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map Viewport */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden h-[580px] relative">
          <MapContainer
            center={[centerLat, centerLng]}
            zoom={16}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapClickCapture
              onPickCoords={(lat, lng) => {
                handleSelectBuildingLocation(lat, lng);
              }}
            />

            {/* סיכת הבניין הנבחר כעת */}
            <Marker position={[selectedLat, selectedLng]} icon={selectedBuildingIcon}>
              <Popup>
                <div className="text-right font-sans p-1 space-y-1">
                  <div className="font-bold text-blue-900 text-xs">הבניין שנבחר כעת:</div>
                  <div className="font-bold text-slate-900 text-sm">{selectedBuildingAddress}</div>
                  <div className="text-xs text-slate-600">
                    {buildingResidents.length} משפחות / דיירים רשומים בבניין זה
                  </div>
                </div>
              </Popup>
            </Marker>

            {(layerFilter === 'all' || layerFilter === 'donors') &&
              activeDonors
                .filter((d) => typeof d.lat === 'number' && typeof d.lng === 'number')
                .map((donor) => (
                  <Marker
                    key={donor.id}
                    position={[donor.lat!, donor.lng!]}
                    icon={defaultIcon}
                    eventHandlers={{
                      click: () => {
                        handleSelectBuildingLocation(donor.lat!, donor.lng!, donor.address);
                      },
                    }}
                  >
                    <Popup>
                      <div className="text-right font-sans p-1 space-y-1.5 min-w-[180px]">
                        <div className="font-bold text-slate-900 text-sm">{donor.fullName}</div>
                        <div className="text-xs text-slate-600">{donor.address}</div>
                        <div className="text-xs text-slate-500">{donor.identifierMark}</div>
                        {donor.phone && (
                          <div className="text-xs font-mono text-slate-700">{donor.phone}</div>
                        )}
                        <div className="flex items-center gap-1.5 pt-1">
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => {
                                handleSelectBuildingLocation(donor.lat!, donor.lng!, donor.address);
                                openEditResidentForm(donor);
                              }}
                              className="flex-1 px-2 py-1 bg-slate-100 text-slate-800 text-xs rounded hover:bg-slate-200"
                            >
                              ערוך בבניין
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onSelectDonor(donor.id)}
                            className="flex-1 px-2 py-1 bg-slate-900 text-white text-xs rounded hover:bg-slate-800"
                          >
                            כרטיס CRM
                          </button>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                ))}

            {(layerFilter === 'all' || layerFilter === 'community') &&
              activeEntities
                .filter((e) => typeof e.lat === 'number' && typeof e.lng === 'number')
                .map((ent) => (
                  <Marker key={ent.id} position={[ent.lat!, ent.lng!]} icon={volunteerIcon}>
                    <Popup>
                      <div className="text-right font-sans p-1 space-y-1">
                        <div className="font-bold text-slate-900 text-sm">{ent.titleOrName}</div>
                        <div className="text-xs text-slate-600">{ent.areaOrAddress}</div>
                        {ent.phoneOrSchedule && (
                          <div className="text-xs text-slate-500">{ent.phoneOrSchedule}</div>
                        )}
                        {ent.notes && <div className="text-xs text-slate-700 pt-1">{ent.notes}</div>}
                      </div>
                    </Popup>
                  </Marker>
                ))}
          </MapContainer>
        </div>

        {/* Right Panel: Selected Building Residents Inspector & CRUD */}
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-blue-700">
                  <Building2 className="w-4 h-4" />
                  <span>פרטי בניין ודיירים במיקום שנבחר</span>
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-1">
                  {selectedBuildingAddress}
                </h3>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                  קואורדינטות: {selectedLat}, {selectedLng}
                </div>
              </div>

              {canWrite && (
                <button
                  type="button"
                  onClick={openAddResidentForm}
                  className="px-3 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 flex items-center gap-1 shrink-0"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>+ הוסף דייר לבניין</span>
                </button>
              )}
            </div>

            {/* טופס הוספה או עריכה של דייר בבניין זה */}
            {showResidentForm && canWrite && (
              <form
                onSubmit={handleSaveResidentAtBuilding}
                className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">
                    {editingResidentId ? 'עריכת פרטי דייר בבניין' : 'הוספת דייר / משפחה חדשה לבניין זה'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowResidentForm(false);
                      setEditingResidentId(undefined);
                    }}
                    className="text-xs text-slate-500 hover:text-slate-900"
                  >
                    ביטול ✕
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                    שם הדייר / המשפחה *
                  </label>
                  <input
                    type="text"
                    required
                    value={resFullName}
                    onChange={(e) => setResFullName(e.target.value)}
                    placeholder="למשל: משפחת כהן (דירה 4)"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">טלפון</label>
                    <input
                      type="text"
                      value={resPhone}
                      onChange={(e) => setResPhone(e.target.value)}
                      placeholder="052-0000000"
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">כתובת הבניין</label>
                    <input
                      type="text"
                      value={resAddress}
                      onChange={(e) => setResAddress(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                    סימן זיהוי / דירה / הערה
                  </label>
                  <input
                    type="text"
                    value={resIdentifierMark}
                    onChange={(e) => setResIdentifierMark(e.target.value)}
                    placeholder="למשל: קומה 2, זקוקים לבדיקת מזוזות..."
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-0.5">קשר לבית חב״ד</label>
                  <input
                    type="text"
                    value={resPersonalConnection}
                    onChange={(e) => setResPersonalConnection(e.target.value)}
                    placeholder="למשל: משתתפים בהתוועדויות / ידידי השליח"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-1.5 px-3 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800"
                >
                  {editingResidentId ? 'שמור שינויים בדייר' : 'שמור דייר בבניין זה'}
                </button>
              </form>
            )}

            {/* רשימת מי גר בבניין זה */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-700">
                מי גר בבניין זה ({buildingResidents.length}):
              </div>

              {buildingResidents.length === 0 ? (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-center space-y-2">
                  <p className="text-xs text-slate-600">
                    עדיין לא רשומים דיירים או אנשי קשר במיקום בניין זה.
                  </p>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={openAddResidentForm}
                      className="px-3 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 inline-flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>הוסף דייר ראשון לבניין</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto border border-slate-200 rounded-lg">
                  {buildingResidents.map((resident) => (
                    <div
                      key={resident.id}
                      className="p-3 bg-white hover:bg-slate-50 transition-colors flex items-start justify-between gap-2"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <div className="text-sm font-bold text-slate-900 truncate">
                          {resident.fullName}
                        </div>
                        <div className="text-xs text-slate-600">{resident.identifierMark}</div>
                        <div className="text-[11px] text-slate-500">
                          קשר: {resident.personalConnection}
                        </div>
                        {resident.phone && (
                          <div className="text-xs font-mono text-slate-700 flex items-center gap-1 pt-0.5">
                            <Phone className="w-3 h-3 text-slate-400" />
                            <span>{resident.phone}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {canWrite && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditResidentForm(resident)}
                              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded"
                              title="ערוך פרטי דייר"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onSoftDeleteDonor(resident.id)}
                              className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                              title="הסר דייר מהבניין"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* רשימת כל הבניינים / הכתובות במאגר למעבר מהיר */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">כל הבניינים וכתובות התורמים</h3>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => setShowStreetNoteForm(!showStreetNoteForm)}
                  className="text-xs font-semibold text-slate-700 hover:text-slate-900 underline"
                >
                  {showStreetNoteForm ? 'סגור הערת רחוב' : '+ הערת רחוב במפה'}
                </button>
              )}
            </div>

            {showStreetNoteForm && canWrite && (
              <form
                onSubmit={handleSaveStreetNote}
                className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2"
              >
                <input
                  type="text"
                  required
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="כותרת מוקד / הערת רחוב..."
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                />
                <input
                  type="text"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="הערות שטח..."
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                />
                <button
                  type="submit"
                  className="w-full py-1.5 bg-slate-900 text-white text-xs font-semibold rounded"
                >
                  שמור הערת רחוב בנקודה הנבחרת
                </button>
              </form>
            )}

            <div className="space-y-2 max-h-52 overflow-y-auto divide-y divide-slate-100">
              {activeDonors.map((d) => {
                const hasCoords = typeof d.lat === 'number' && typeof d.lng === 'number';
                return (
                  <div key={d.id} className="pt-2 first:pt-0 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 truncate">{d.fullName}</div>
                      <div className="text-[11px] text-slate-500 truncate flex items-center gap-1">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span>{d.address}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {hasCoords ? (
                        <button
                          type="button"
                          onClick={() => {
                            setCenterLat(d.lat!);
                            setCenterLng(d.lng!);
                            handleSelectBuildingLocation(d.lat!, d.lng!, d.address);
                          }}
                          className="px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-800 rounded hover:bg-slate-200 flex items-center gap-1"
                        >
                          <Navigation className="w-3 h-3" />
                          לבניין
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={!canWrite || geocodingDonorId === d.id}
                          onClick={() => handleGeocodeDonor(d)}
                          className="px-2.5 py-1 text-xs font-medium bg-amber-50 text-amber-900 border border-amber-200 rounded hover:bg-amber-100 flex items-center gap-1"
                        >
                          <Search className="w-3 h-3" />
                          {geocodingDonorId === d.id ? 'מאתר...' : 'אתר בניין'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
