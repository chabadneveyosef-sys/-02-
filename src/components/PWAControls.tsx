import React, { useEffect, useState } from 'react';
import { Download, WifiOff, CheckCircle2, Smartphone, ShieldCheck, RefreshCw, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    ChabadNativeBridge?: {
      isNativeAndroidApp: () => boolean;
      getAppVersion: () => string;
      openServerSettings: () => void;
      showNativeToast: (msg: string) => void;
    };
  }
}

export const PWAControls: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isNativeApk, setIsNativeApk] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showApkModal, setShowApkModal] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent || '';
    setIsIOS(/iphone|ipad|ipod/i.test(ua));
    if (ua.includes('ChabadERP-Android-Native') || Boolean(window.ChabadNativeBridge)) {
      setIsNativeApk(true);
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const handleDownloadApk = () => {
    const a = document.createElement('a');
    a.href = '/api/download-apk';
    a.download = 'chabad-erp-android.apk';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleInstallPWA = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setDeferredPrompt(null);
      }
    } else {
      setShowApkModal(true);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {!isOnline && (
        <span className="text-xs text-amber-700 font-medium flex items-center gap-1 whitespace-nowrap">
          <WifiOff className="w-3.5 h-3.5" />
          מצב אופליין
        </span>
      )}

      {!isNativeApk && (
        <button
          type="button"
          onClick={() => setShowApkModal(true)}
          className="px-2.5 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-xs"
          title="הורד קובץ התקנה APK לאנדרואיד — עובד גם במכשירים ללא דפדפן ומתעדכן אוטומטית מהאתר"
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>הורדת APK לאנדרואיד</span>
        </button>
      )}

      {!isInstalled && !isNativeApk && deferredPrompt && (
        <button
          type="button"
          onClick={handleInstallPWA}
          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          title="התקן במחשב או בנייד כאפליקציית שולחן עבודה"
        >
          <Download className="w-3.5 h-3.5" />
          <span>{isIOS ? 'התקנה באייפון' : 'התקנה במחשב'}</span>
        </button>
      )}

      {showApkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl border border-slate-200 text-right space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-emerald-700" />
                הורדת אפליקציית אנדרואיד (קובץ APK עצמאי)
              </h3>
              <button
                type="button"
                onClick={() => setShowApkModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
                title="סגור"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
              <div className="text-sm font-bold text-emerald-950 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>מותאם במיוחד גם למכשירים מוגנים / ללא דפדפן!</span>
              </div>
              <p className="text-xs text-emerald-900 leading-relaxed">
                קובץ ה-APK משתמש ברכיב המערכת הפנימי של אנדרואיד ואינו דורש דפדפן חיצוני (כמו Chrome) במכשיר. האפליקציה מחוברת ישירות למסד הנתונים בענן ומתעדכנת אוטומטית בכל שינוי שנעשה באתר.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <button
                type="button"
                onClick={handleDownloadApk}
                className="flex-1 py-3 px-4 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm rounded-xl flex items-center justify-center gap-2 shadow-sm transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>הורד קובץ chabad-erp-android.apk</span>
              </button>

              {deferredPrompt && (
                <button
                  type="button"
                  onClick={handleInstallPWA}
                  className="py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>התקנה מהירה במחשב (PWA)</span>
                </button>
              )}
            </div>

            <div className="border-t border-slate-100 pt-3 space-y-2 text-xs text-slate-700">
              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 text-slate-700" />
                <span>איך מתקינים את הקובץ מהמחשב לפלאפון?</span>
              </div>
              <ol className="list-decimal list-inside space-y-1.5 text-slate-600 leading-relaxed">
                <li>
                  לחץ על הכפתור הירוק למעלה להורדת הקובץ <strong>chabad-erp-android.apk</strong> למחשב שלך.
                </li>
                <li>
                  העבר את הקובץ מהמחשב לפלאפון (באמצעות כבל USB, בלוטות׳, כרטיס זיכרון או אפליקציית העברת קבצים).
                </li>
                <li>
                  בפלאפון, פתח את <strong>"מנהל הקבצים" (Files)</strong> &larr; תיקיית ההורדות או העברות &larr; לחץ על הקובץ <strong>chabad-erp-android.apk</strong> ובחר <strong>"התקן" (Install)</strong>.
                </li>
                <li>
                  האפליקציה תופיע במסך הבית בשם <strong>"בית חב״ד ERP"</strong> ותסנכרן את כל הנתונים והעדכונים באופן אוטומטי.
                </li>
              </ol>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowApkModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
              >
                סגור חלון
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
