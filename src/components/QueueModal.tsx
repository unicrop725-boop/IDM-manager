import { Select } from "./Select";
import { ModalCorner } from "./NotchCorner";
import { useState } from "react";
import { Clock, Wifi, Moon } from "lucide-react";
import type { QueueInfo, QueueSchedule } from "../types";

interface Props {
  queue: QueueInfo | null;
  onSave: (q: QueueInfo) => Promise<void>;
  onClose: () => void;
}

const DAYS = [
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
  { id: 0, label: "Sun" },
];

export default function QueueModal({ queue, onSave, onClose }: Props) {
  const isEditing = queue !== null;
  const [name, setName] = useState(queue?.name || "");
  const [maxConcurrent, setMaxConcurrent] = useState(queue?.maxConcurrent || 2);

  // Schedule states
  const [scheduleEnabled, setScheduleEnabled] = useState(queue?.schedule?.enabled || false);
  const [startTime, setStartTime] = useState(queue?.schedule?.startTime || "00:00:00");
  const [stopTime, setStopTime] = useState(queue?.schedule?.stopTime || "");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(queue?.schedule?.daysOfWeek || []);
  const [action, setAction] = useState(queue?.schedule?.actionAfterCompletion || "none");
  const [programPath, setProgramPath] = useState(queue?.schedule?.runProgramPath || "");
  const [wifiOnly, setWifiOnly] = useState(queue?.schedule?.wifiOnly || false);
  const [nightOnly, setNightOnly] = useState(queue?.schedule?.nightOnly || false);
  const [nightStartHour, setNightStartHour] = useState(queue?.schedule?.nightStartHour ?? 0);
  const [nightEndHour, setNightEndHour] = useState(queue?.schedule?.nightEndHour ?? 6);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (dayId: number) => {
    if (daysOfWeek.includes(dayId)) {
      setDaysOfWeek(daysOfWeek.filter((d) => d !== dayId));
    } else {
      setDaysOfWeek([...daysOfWeek, dayId]);
    }
  };

  const handleSelectAllDays = () => setDaysOfWeek([0, 1, 2, 3, 4, 5, 6]);
  const handleSelectWeekdays = () => setDaysOfWeek([1, 2, 3, 4, 5]);
  const handleSelectWeekends = () => setDaysOfWeek([6, 0]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please provide a name for the queue.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const schedule: QueueSchedule = {
        enabled: scheduleEnabled,
        startTime: scheduleEnabled && startTime.trim() ? startTime.trim() : null,
        stopTime: scheduleEnabled && stopTime.trim() ? stopTime.trim() : null,
        daysOfWeek: scheduleEnabled ? daysOfWeek : [],
        actionAfterCompletion: action,
        runProgramPath: action === "runProgram" && programPath.trim() ? programPath.trim() : null,
        wifiOnly,
        nightOnly,
        nightStartHour,
        nightEndHour,
      };

      const updatedQueue: QueueInfo = {
        id: queue?.id || `queue-${Date.now()}`,
        name: name.trim(),
        maxConcurrent: Math.max(1, maxConcurrent),
        isRunning: queue?.isRunning ?? true,
        schedule,
        createdAt: queue?.createdAt || Math.floor(Date.now() / 1000),
      };

      await onSave(updatedQueue);
      onClose();
    } catch (err) {
      setError(typeof err === "string" ? err : (err as Error).message || "Failed to save queue");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs select-none">
      <div className="notch-card w-full max-w-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-2xl text-xs text-[var(--text-secondary)]">
        <ModalCorner onClose={onClose} />
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Clock size={16} className="text-amber-400" />
            <span>{isEditing ? `Queue Settings - ${queue.name}` : "Create New Queue"}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200">
              {error}
            </div>
          )}

          {/* Name & Concurrent limit */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block font-medium text-[var(--text-secondary)]">Queue Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Night Queue, Movies"
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-sky-500 transition"
                required
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-[var(--text-secondary)]">Max Concurrent</label>
              <input
                type="number"
                min={1}
                max={16}
                value={maxConcurrent}
                onChange={(e) => setMaxConcurrent(parseInt(e.target.value, 10) || 1)}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-sky-500 transition"
              />
            </div>
          </div>

          {/* Scheduler Section */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 font-medium text-[var(--text-primary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={scheduleEnabled}
                  onChange={(e) => setScheduleEnabled(e.target.checked)}
                  className="rounded border-[var(--text-disabled)] text-sky-500"
                />
                <span>Enable Scheduler</span>
              </label>
              <span className="text-[11px] text-[var(--text-secondary)]">Automate start/stop and post-actions</span>
            </div>

            {scheduleEnabled && (
              <div className="pt-2 space-y-3 border-t border-[var(--border-subtle)]">
                {/* Time picker */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[var(--text-secondary)]">Start Time (HH:MM:SS)</label>
                    <input
                      type="text"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      placeholder="e.g. 19:30:00 or 19:30"
                      className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[var(--text-secondary)]">Stop Time (optional)</label>
                    <input
                      type="text"
                      value={stopTime}
                      onChange={(e) => setStopTime(e.target.value)}
                      placeholder="e.g. 06:00:00"
                      className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-primary)] outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                {/* Days of week */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[var(--text-secondary)]">Active Days</label>
                    <div className="flex gap-2 text-[10px] text-sky-400">
                      <button type="button" onClick={handleSelectAllDays} className="hover:underline">
                        All
                      </button>
                      <button type="button" onClick={handleSelectWeekdays} className="hover:underline">
                        Weekdays
                      </button>
                      <button type="button" onClick={handleSelectWeekends} className="hover:underline">
                        Weekends
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {DAYS.map((d) => {
                      const active = daysOfWeek.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => toggleDay(d.id)}
                          className={`flex-1 rounded-md py-1.5 font-medium transition ${
                            active
                              ? "bg-sky-500 text-black font-semibold"
                              : "border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                          }`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action After Completion */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3.5 space-y-3">
            <div>
              <label className="mb-1 block font-medium text-[var(--text-secondary)]">
                Action after queue completion
              </label>
              <Select
                value={action}
                onChange={(e) => setAction(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 text-[var(--text-primary)] outline-none focus:border-sky-500 transition"
              >
                <option value="none">None (Leave computer running)</option>
                <option value="sleep">Sleep computer</option>
                <option value="shutdown">Shut down computer</option>
                <option value="hibernate">Hibernate computer</option>
                <option value="exitApp">Exit FlowGet app</option>
                <option value="runProgram">Run external program</option>
              </Select>
            </div>

            {action === "runProgram" && (
              <div>
                <label className="mb-1 block text-[var(--text-secondary)]">Executable or script path</label>
                <input
                  type="text"
                  value={programPath}
                  onChange={(e) => setProgramPath(e.target.value)}
                  placeholder="C:\Scripts\notify.bat or custom.exe"
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2.5 py-1.5 text-[var(--text-primary)] font-mono text-[11px] outline-none focus:border-sky-500"
                />
              </div>
            )}
          </div>

          {/* Network and Night Restrictions */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3.5 space-y-2.5">
            <label className="flex items-center gap-2 font-medium text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={wifiOnly}
                onChange={(e) => setWifiOnly(e.target.checked)}
                className="rounded border-[var(--text-disabled)] text-sky-500"
              />
              <Wifi size={14} className="text-sky-400" />
              <span>Download only on Wi-Fi</span>
            </label>
            <p className="pl-6 text-[11px] text-[var(--text-secondary)]">
              Pauses or waits if connected via Ethernet, cellular data, or if Wi-Fi is disconnected.
            </p>

            <div className="pt-2 border-t border-[var(--border-subtle)]">
              <label className="flex items-center gap-2 font-medium text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={nightOnly}
                  onChange={(e) => setNightOnly(e.target.checked)}
                  className="rounded border-[var(--text-disabled)] text-sky-500"
                />
                <Moon size={14} className="text-violet-400" />
                <span>Download only at night</span>
              </label>

              {nightOnly && (
                <div className="mt-2 pl-6 flex items-center gap-2 text-[var(--text-secondary)]">
                  <span>Between</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={nightStartHour}
                    onChange={(e) => setNightStartHour(parseInt(e.target.value, 10) || 0)}
                    className="w-14 rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1 text-center text-[var(--text-primary)]"
                  />
                  <span>:00 and</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={nightEndHour}
                    onChange={(e) => setNightEndHour(parseInt(e.target.value, 10) || 6)}
                    className="w-14 rounded border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1 text-center text-[var(--text-primary)]"
                  />
                  <span>:00</span>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-sky-500 px-5 py-2 font-medium text-black hover:bg-sky-400 transition shadow-sm disabled:opacity-50"
            >
              {saving ? "Saving..." : isEditing ? "Save Queue" : "Create Queue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
