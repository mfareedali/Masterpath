import type { Metadata } from 'next';
import { Callout, Card, PageHeader } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Download the app',
  description: 'Download the MastersPath Android app (APK), or install it from your browser on any phone.',
};

const APK = '/download/MastersPath.apk';

const ANDROID_STEPS = [
  'Tap “Download APK” below.',
  'Open the downloaded file. If Android asks, allow your browser to install apps (“Install unknown apps”).',
  'Tap Install, then Open. MastersPath appears on your home screen.',
];

export default function DownloadPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Download the app"
        subtitle="MastersPath for Android. Free, no sign-up, and we never ask for passport or ID numbers."
      />

      <Card>
        <h2 className="text-lg font-semibold">Android (APK)</h2>
        <p className="mt-1 text-sm text-muted">Version 1.0 · about 30 KB · Android 7.0 or newer</p>
        <a
          href={APK}
          download="MastersPath.apk"
          className="btn-arrow mt-4 inline-flex min-h-button w-full items-center justify-center gap-2 rounded-chip border border-chrome bg-chrome px-6 font-semibold text-on-chrome no-underline hover:border-primary hover:bg-primary sm:w-auto"
        >
          Download APK
        </a>
        <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm text-ink">
          {ANDROID_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">iPhone, or install without an APK</h2>
        <p className="mt-1 text-sm text-ink">
          iPhone: open this site in Safari, tap Share, then “Add to Home Screen”. Android Chrome: open the menu, then
          “Install app”. It works like the APK and keeps your saved shortlist offline.
        </p>
      </Card>

      <Callout tone="neutral">
        The app opens the same MastersPath website, so every fact, source and update is the same. It is not on the Play
        Store yet, which is why Android asks before installing.
      </Callout>
    </div>
  );
}
