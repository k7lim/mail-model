import { useState, useEffect, useCallback } from "react";

type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; progress: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Fetch initial status
    window.api.updates.getStatus().then((result: { success: boolean; data?: UpdateStatus }) => {
      if (result.success && result.data) {
        setStatus(result.data);
      }
    });

    // Listen for status changes — use returned cleanup to remove only this listener
    const cleanup = window.api.updates.onStatusChanged((newStatus: UpdateStatus) => {
      setStatus(newStatus);
    });

    return cleanup;
  }, []);

  const handleViewRelease = useCallback(() => {
    window.open("https://github.com/k7lim/mail-model/releases");
  }, []);

  if (status.state !== "available" || dismissed) {
    return null;
  }

  return (
    <div className="titlebar-no-drag flex items-center gap-2 px-3 py-1.5 bg-indigo-600 dark:bg-indigo-500 rounded-lg text-sm shadow-sm">
      <svg
        className="w-4 h-4 text-white flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
        />
      </svg>
      <span className="text-white font-medium whitespace-nowrap">
        v{status.version} available
      </span>
      <button
        onClick={handleViewRelease}
        className="px-2.5 py-0.5 text-xs font-semibold text-indigo-600 dark:text-indigo-700 bg-white hover:bg-indigo-50 dark:hover:bg-indigo-100 rounded transition-colors"
      >
        View Release
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 text-indigo-200 hover:text-white transition-colors"
        title="Dismiss"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}
