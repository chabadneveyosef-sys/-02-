import React, { useEffect, useState } from 'react';
import { Download, WifiOff, CheckCircle2 } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const PWAControls: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

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

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setDeferredPrompt(null);
      }
    } else {
      setShowIOSModal(true);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {!isOnline && (
        <span className="text-xs text-amber-700 font-medium flex items-center gap-1 whitespace-nowrap">
          <WifiOff className="w-3.5 h-3.5" />
          מצב אופליין פעיל (שמירה מקומית)
        </span>
      )}

      {!isInstalled && (
        <button
          type="button"
          onClick={handleInstall}
          className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          title="התקן את מערכת בית חב״ד כאפליקציה במחשב או בנייד לעבודה מהירה ובאופליין"
        >
          <Download className="w-3.5 h-3.5" />
          <span>{isIOS ? 'התקנה באייפון' : 'התקנת אפליקציה'}</span>
        </button>
      )}

      {showIOSModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl border border-slate-200 text-right">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-slate-900" />
              התקנת מערכת בית חב״ד במחשב או בנייד
            </h3>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              המערכת תומכת בהתקנה מלאה כאפליקציה עצמאית (PWA) הפועלת גם ללא חיבור לאינטרנט:
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-700 list-disc list-inside">
              <li>
                <strong>בכרום / אדג׳ במחשב:</strong> לחץ על סמל ההתקנה בשורת הכתובת למעלה (או בתפריט הדפדפן &larr; "התקן את בית חב״ד ERP").
              </li>
              <li>
                <strong>באייפון / אייפד (Safari):</strong> לחץ על כפתור ה-<strong>שיתוף (Share)</strong> בתחתית המסך ובחר <strong>"הוסף למסך הבית" (Add to Home Screen)</strong>.
              </li>
            </ul>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setShowIOSModal(false)}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
              >
                הבנתי, סגור
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
