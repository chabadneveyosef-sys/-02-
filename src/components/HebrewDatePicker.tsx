import React, { useState, useEffect } from 'react';
import { Calendar, Sun } from 'lucide-react';
import {
  HebrewDateTriplet,
  fromHebrewTriplet,
  isHebrewLeapYear,
  getHebrewMonthName,
} from '../lib/erp-core';
import { gematriya } from '@hebcal/core';

interface HebrewDatePickerProps {
  value?: HebrewDateTriplet | null;
  onChange: (triplet: HebrewDateTriplet, converted: ReturnType<typeof fromHebrewTriplet>) => void;
  onClear?: () => void;
  allowClear?: boolean;
  clearLabel?: string;
  compact?: boolean;
  disabled?: boolean;
  lat?: number;
  lng?: number;
  label?: string;
}

// תמיכה בבחירת שנים עבריות עד 155 שנים אחורה (למשל משנת ה'תרל"ה / 5635 ועד ה'תשצ"ה / 5795) עבור ימי הולדת ואזכרות
const HEBREW_YEARS = Array.from({ length: 161 }, (_, idx) => 5795 - idx);
const HEBREW_MONTH_ORDER = [7, 8, 9, 10, 11, 12, 13, 1, 2, 3, 4, 5, 6]; // מתשרי עד אלול

export const HebrewDatePicker: React.FC<HebrewDatePickerProps> = ({
  value,
  onChange,
  onClear,
  allowClear = false,
  clearLabel = 'ללא תאריך (פרויקט מתמשך)',
  compact = false,
  disabled = false,
  lat = 32.784,
  lng = 35.0195,
  label,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [day, setDay] = useState(value?.day || 18);
  const [month, setMonth] = useState(value?.month || 7);
  const [year, setYear] = useState(value?.year || 5787);

  useEffect(() => {
    if (value) {
      setDay(value.day || 1);
      setMonth(value.month || 7);
      setYear(value.year || 5787);
    }
  }, [value?.day, value?.month, value?.year, value]);

  const isLeap = isHebrewLeapYear(year);
  const currentConverted = fromHebrewTriplet({ day, month, year }, lat, lng);
  const isEmpty = allowClear && !value;

  const handleSelect = (newDay: number, newMonth: number, newYear: number) => {
    setDay(newDay);
    setMonth(newMonth);
    setYear(newYear);
    const conv = fromHebrewTriplet({ day: newDay, month: newMonth, year: newYear }, lat, lng);
    onChange(conv.triplet, conv);
  };

  const availableMonths = HEBREW_MONTH_ORDER.filter((m) => (m === 13 ? isLeap : true));

  return (
    <div className="relative">
      {label && <label className="block text-xs font-semibold text-slate-700 mb-1">{label}</label>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className={`flex-1 flex items-center justify-between bg-white border border-slate-300 rounded-lg text-slate-900 hover:border-slate-400 transition-colors ${
            compact ? 'px-2.5 py-1 text-xs gap-2' : 'px-3 py-2 text-sm gap-3'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          <span className="font-semibold flex items-center gap-1.5 whitespace-nowrap">
            <Calendar className={compact ? 'w-3.5 h-3.5 text-slate-600 shrink-0' : 'w-4 h-4 text-slate-600 shrink-0'} />
            <span>{isEmpty ? clearLabel : currentConverted.hebrewDisplay}</span>
          </span>
          {!isEmpty && (
            <span className="text-[11px] text-slate-500 font-mono tabular-nums whitespace-nowrap">
              {currentConverted.gregorianIso}
              {!compact ? ` · שקיעה ${currentConverted.sunsetTime}` : ''}
            </span>
          )}
        </button>
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl p-4 right-0">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-800">לוח שנה עברי לבחירת תאריך</span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              סגור ✕
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">חודש עברי</label>
              <select
                value={month}
                onChange={(e) => handleSelect(day, Number(e.target.value), year)}
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900"
              >
                {availableMonths.map((m) => (
                  <option key={m} value={m}>
                    {getHebrewMonthName(m, isLeap)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">שנה עברית</label>
              <select
                value={year}
                onChange={(e) => handleSelect(day, month, Number(e.target.value))}
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900"
              >
                {HEBREW_YEARS.map((y) => (
                  <option key={y} value={y}>
                    ה׳{gematriya(y % 1000)} ({y}) {isHebrewLeapYear(y) ? '· מעוברת' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-3">
            <label className="block text-[11px] text-slate-500 mb-1">יום בחודש (אותיות עבריות)</label>
            <div className="grid grid-cols-6 gap-1">
              {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => {
                const isSelected = !isEmpty && d === currentConverted.triplet.day;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      handleSelect(d, month, year);
                      setIsOpen(false);
                    }}
                    className={`py-1.5 text-xs rounded transition-colors ${
                      isSelected
                        ? 'bg-slate-900 text-white font-semibold'
                        : 'bg-slate-50 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {gematriya(d)}
                  </button>
                );
              })}
            </div>
          </div>

          {allowClear && onClear && (
            <div className="mb-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setIsOpen(false);
                }}
                className="w-full py-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-md transition-colors"
              >
                קבע כ&quot;ללא תאריך יעד&quot; (פרויקט מתמשך)
              </button>
            </div>
          )}

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600">
            <span>לועזי נגזר: {currentConverted.gregorianIso}</span>
            <span className="flex items-center gap-1">
              <Sun className="w-3.5 h-3.5 text-amber-600" />
              שקיעה: {currentConverted.sunsetTime}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
