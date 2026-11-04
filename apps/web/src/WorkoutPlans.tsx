import React, { useEffect, useState } from "react";
import { ArrowUp, ArrowDown, Plus, Trash2 } from "lucide-react";
import { api } from "./api";
import { exerciseName, tr } from "./i18n";
import type { Exercise } from "./types";

type PlanEntry = { exerciseId: string; sets: number; minReps: number; maxReps: number; restSeconds: number; increment: number; measurementUnit: "kg" | "units" };
type Plan = { id: string; name: string; exercises: PlanEntry[] };
type Assignment = { weekday: number; templateId: string };
type Program = { templates: Plan[]; assignments: Assignment[]; preferredWeekdays: number[] };
export function WorkoutPlans({ exercises, weekdays }: { exercises: Exercise[]; weekdays: { value: number; name: string }[] }) {
  const [program, setProgram] = useState<Program>();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [draft, setDraft] = useState<Omit<Plan, "id"> & { id?: string }>();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [scheduleSaved, setScheduleSaved] = useState(false);
  const load = () => {
    setError("");
    api("/settings/program").then((data) => { setProgram(data); setAssignments(data.assignments); })
      .catch(() => setError(tr("workoutSettingsError")));
  };
  useEffect(load, []);
  const entryName = (id: string) => {
    const entry = exercises.find((item) => item.id === id);
    return entry ? exerciseName(entry) : id;
  };
  const changeEntry = (index: number, patch: Partial<PlanEntry>) => setDraft((current) => current && ({ ...current, exercises: current.exercises.map((entry, i) => i === index ? { ...entry, ...patch } : entry) }));
  const move = (index: number, change: number) => setDraft((current) => {
    if (!current) return current;
    const entries = [...current.exercises];
    [entries[index], entries[index + change]] = [entries[index + change], entries[index]];
    return { ...current, exercises: entries };
  });
  return <>
    <section className="card workout-plans" aria-label={tr("workoutPlans")}>
      <p className="eyebrow">{tr("workoutPlans")}</p>
      <p>{tr("planChangesFutureOnly")}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {!program && <button type="button" onClick={load}>{tr("retry")}</button>}
      {program?.templates.map((plan) => <div className="workout-plan-summary" key={plan.id}>
        <div><b>{plan.name}</b><small>{plan.exercises.length} {tr("exercises")}</small></div>
        <button type="button" disabled={busy} aria-label={`${tr("editWorkout")}: ${plan.name}`} onClick={() => { setError(""); setDraft(structuredClone(plan)); }}>{tr("editWorkout")}</button>
      </div>)}
      {!draft && program && <button type="button" className="primary" onClick={() => { setError(""); setDraft({ name: "", exercises: [] }); }}><Plus size={18} /> {tr("createWorkout")}</button>}
      {draft && <form className="workout-plan-editor" onSubmit={async (event) => {
        event.preventDefault(); if (busy) return;
        setBusy(true); setError("");
        try {
          const data = await api(draft.id ? `/settings/workouts/${draft.id}` : "/settings/workouts", {
            method: draft.id ? "PATCH" : "POST", body: JSON.stringify({ name: draft.name, exercises: draft.exercises.map(({ exerciseId, sets, minReps, maxReps, restSeconds, increment, measurementUnit }) => ({ exerciseId, sets, minReps, maxReps, restSeconds, increment, measurementUnit })) }),
          });
          setProgram(data); setDraft(undefined);
        } catch { setError(tr("workoutSettingsError")); }
        finally { setBusy(false); }
      }}>
        <label>{tr("workoutName")}<input required maxLength={80} value={draft.name} disabled={busy} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>{tr("addExercise")}<select aria-label={tr("addExercise")} value="" disabled={busy} onChange={(event) => {
          const entry = exercises.find((item) => item.id === event.target.value) as (Exercise & { defaultSets?: number; minReps?: number; maxReps?: number; defaultRestSeconds?: number }) | undefined;
          if (!entry) return;
          setDraft({ ...draft, exercises: [...draft.exercises, { exerciseId: entry.id, sets: entry.defaultSets ?? 2, minReps: entry.minReps ?? 8, maxReps: entry.maxReps ?? 12, restSeconds: entry.defaultRestSeconds ?? 90, increment: entry.defaultIncrement, measurementUnit: "kg" }] });
        }}>
          <option value="">{tr("chooseExercise")}</option>
          {exercises.filter((entry) => !draft.exercises.some((item) => item.exerciseId === entry.id)).map((entry) => <option key={entry.id} value={entry.id}>{exerciseName(entry)}</option>)}
        </select></label>
        {draft.exercises.map((entry, index) => <fieldset key={entry.exerciseId} disabled={busy} className="plan-exercise">
          <legend>{index + 1}. {entryName(entry.exerciseId)}</legend>
          <div className="plan-exercise-actions">
            <button type="button" disabled={index === 0} aria-label={`${tr("moveUp")}: ${entryName(entry.exerciseId)}`} onClick={() => move(index, -1)}><ArrowUp size={18} /></button>
            <button type="button" disabled={index === draft.exercises.length - 1} aria-label={`${tr("moveDown")}: ${entryName(entry.exerciseId)}`} onClick={() => move(index, 1)}><ArrowDown size={18} /></button>
            <button type="button" aria-label={`${tr("removeExercise")}: ${entryName(entry.exerciseId)}`} onClick={() => setDraft({ ...draft, exercises: draft.exercises.filter((_, i) => i !== index) })}><Trash2 size={18} /></button>
          </div>
          <div className="plan-exercise-inputs">
            {([["sets", tr("sets"), 1, 20, 1], ["minReps", tr("minReps"), 1, 100, 1], ["maxReps", tr("maxReps"), 1, 100, 1], ["restSeconds", tr("restTime"), 30, 600, 1], ["increment", tr("weightStep"), .001, 100, "any"]] as const).map(([key, label, min, max, step]) => <label key={key}>{label}<input type="number" required min={min} max={max} step={step} value={entry[key]} onChange={(event) => changeEntry(index, { [key]: Number(event.target.value) })} /></label>)}
            <label>{tr("loadUnit")}<select value={entry.measurementUnit} onChange={(event) => changeEntry(index, { measurementUnit: event.target.value as "kg" | "units" })}><option value="kg">{tr("kg")}</option><option value="units">{tr("units")}</option></select></label>
          </div>
        </fieldset>)}
        {!draft.exercises.length && <p>{tr("chooseAtLeastOneExercise")}</p>}
        <div className="confirm-actions"><button type="button" disabled={busy} onClick={() => setDraft(undefined)}>{tr("cancel")}</button><button className="primary" disabled={busy || !draft.name.trim() || !draft.exercises.length || draft.exercises.some((entry) => entry.minReps > entry.maxReps)}>{tr("saveWorkout")}</button></div>
      </form>}
    </section>
    <section className="card workout-schedule" aria-label={tr("trainingDays")}>
      <p className="eyebrow">{tr("trainingDays")}</p>
      {program && weekdays.map((day) => <label className="workout-day-row" key={day.value}>
        <span>{day.name}</span>
        <select aria-label={`${tr("workoutForDay")}: ${day.name}`} disabled={busy} value={assignments.find((item) => item.weekday === day.value)?.templateId || ""} onChange={(event) => {
          setScheduleSaved(false);
          setAssignments([...assignments.filter((item) => item.weekday !== day.value), ...(event.target.value ? [{ weekday: day.value, templateId: event.target.value }] : [])]);
        }}><option value="">{tr("restDay")}</option>{program.templates.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select>
      </label>)}
      {program && <button type="button" className="primary" disabled={busy || !assignments.length} onClick={async () => {
        setBusy(true); setError("");
        try { const data = await api("/settings/program", { method: "PATCH", body: JSON.stringify({ assignments }) }); setProgram(data); setAssignments(data.assignments); setScheduleSaved(true); }
        catch { setError(tr("workoutSettingsError")); }
        finally { setBusy(false); }
      }}>{scheduleSaved ? tr("saved") : tr("saveTrainingDays")}</button>}
    </section>
  </>;
}
