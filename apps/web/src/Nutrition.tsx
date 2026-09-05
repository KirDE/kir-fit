import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Clock3,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import { getLanguage } from "./i18n";
import { token } from "./api";
import {
  analyzeMeal,
  analysisHeaders,
  clarifyMeal,
  deletePhotoAnalysis,
  deleteNutritionEntry,
  emptyNutrients,
  localDate,
  moveLocalDate,
  nutritionDay,
  photoAnalysisJobs,
  saveNutritionEntry,
  sumItems,
} from "./nutrition";
import type {
  MealAnalysis,
  Nutrients,
  NutritionDay,
  NutritionEntry,
  NutritionItem,
  PhotoAnalysisJob,
} from "./types";

const copy = {
  en: {
    nutrition: "Nutrition",
    today: "Today",
    yesterday: "Yesterday",
    backToToday: "Back to today",
    previousDay: "Previous day",
    nextDay: "Next day",
    addFood: "Add food",
    protein: "Protein",
    calories: "Calories",
    fat: "Fat",
    carbs: "Carbs",
    fiber: "Fiber",
    remaining: "remaining",
    excess: "above target",
    targetReached: "Target reached",
    targetExceeded: "Target exceeded",
    noTarget: "Set your protein target in Settings",
    empty: "No food recorded for this day.",
    camera: "Take photo",
    gallery: "Choose photo",
    manual: "Enter manually",
    analyzing: "Estimating food and portions…",
    queued: "Photo added. Analysis continues in the background.",
    processing: "Analysis in progress",
    answerQuestions: "Answer questions",
    reviewEstimate: "Review estimate",
    analysisFailedShort: "Analysis failed — enter manually",
    queuedHint: "You can close Fit and return later.",
    cancelAnalysis: "Delete pending photo",
    estimated: "Estimated from a photo — review before saving.",
    privatePhoto: "Your photo is processed privately and is not published.",
    analysisFailed: "Photo analysis is unavailable. You can enter the meal manually.",
    offlinePhoto: "Photo analysis needs an internet connection. Manual entry still works.",
    tooLarge: "Choose an image smaller than 10 MB.",
    invalidImage: "Choose an image file.",
    questions: "A few details will improve the estimate",
    other: "Other",
    answer: "Your answer",
    continue: "Update estimate",
    editDirectly: "Edit manually",
    review: "Review meal",
    mealName: "Meal name",
    foodName: "Food",
    grams: "Estimated grams",
    consumed: "How much was eaten?",
    fullServing: "Values for the full photographed serving",
    assumptions: "Assumptions",
    uncertainty: "Uncertainty",
    addItem: "Add food item",
    save: "Save to journal",
    discardZero: "0% does not add anything. Close this form to discard it.",
    breakfast: "Breakfast",
    lunch: "Lunch",
    dinner: "Dinner",
    snack: "Snack",
    edit: "Edit",
    delete: "Delete",
    deleteTitle: "Delete this meal?",
    deleteText: "Daily totals will update immediately. This cannot be undone.",
    cancel: "Cancel",
    saveFailed: "Could not save the meal. Your changes remain on this screen.",
    loadFailed: "Could not load nutrition data.",
    retry: "Try again",
    percent: "%",
    gramShort: "g",
  },
  de: {
    nutrition: "Ernährung",
    today: "Heute",
    yesterday: "Gestern",
    backToToday: "Zurück zu heute",
    previousDay: "Vorheriger Tag",
    nextDay: "Nächster Tag",
    addFood: "Essen hinzufügen",
    protein: "Protein",
    calories: "Kalorien",
    fat: "Fett",
    carbs: "Kohlenhydrate",
    fiber: "Ballaststoffe",
    remaining: "verbleibend",
    excess: "über dem Ziel",
    targetReached: "Ziel erreicht",
    targetExceeded: "Ziel überschritten",
    noTarget: "Proteinziel in den Einstellungen festlegen",
    empty: "Für diesen Tag wurde noch kein Essen erfasst.",
    camera: "Foto aufnehmen",
    gallery: "Foto auswählen",
    manual: "Manuell eingeben",
    analyzing: "Lebensmittel und Portionen werden geschätzt…",
    queued: "Foto hinzugefügt. Die Analyse läuft im Hintergrund weiter.",
    processing: "Analyse läuft",
    answerQuestions: "Fragen beantworten",
    reviewEstimate: "Schätzung prüfen",
    analysisFailedShort: "Analyse fehlgeschlagen — manuell eingeben",
    queuedHint: "Du kannst Fit schließen und später zurückkehren.",
    cancelAnalysis: "Ausstehendes Foto löschen",
    estimated: "Vom Foto geschätzt — vor dem Speichern prüfen.",
    privatePhoto: "Das Foto wird privat verarbeitet und nicht veröffentlicht.",
    analysisFailed: "Die Fotoanalyse ist nicht verfügbar. Du kannst das Essen manuell eingeben.",
    offlinePhoto: "Die Fotoanalyse benötigt Internet. Manuelle Eingabe funktioniert weiterhin.",
    tooLarge: "Wähle ein Bild unter 10 MB.",
    invalidImage: "Wähle eine Bilddatei.",
    questions: "Ein paar Details verbessern die Schätzung",
    other: "Andere",
    answer: "Deine Antwort",
    continue: "Schätzung aktualisieren",
    editDirectly: "Manuell bearbeiten",
    review: "Mahlzeit prüfen",
    mealName: "Name der Mahlzeit",
    foodName: "Lebensmittel",
    grams: "Geschätzte Gramm",
    consumed: "Wie viel wurde gegessen?",
    fullServing: "Werte für die vollständig fotografierte Portion",
    assumptions: "Annahmen",
    uncertainty: "Unsicherheit",
    addItem: "Lebensmittel hinzufügen",
    save: "Im Tagebuch speichern",
    discardZero: "0 % wird nicht erfasst. Schließe das Formular zum Verwerfen.",
    breakfast: "Frühstück",
    lunch: "Mittagessen",
    dinner: "Abendessen",
    snack: "Snack",
    edit: "Bearbeiten",
    delete: "Löschen",
    deleteTitle: "Diese Mahlzeit löschen?",
    deleteText: "Die Tagessumme wird sofort aktualisiert. Dies kann nicht rückgängig gemacht werden.",
    cancel: "Abbrechen",
    saveFailed: "Die Mahlzeit konnte nicht gespeichert werden. Deine Änderungen bleiben erhalten.",
    loadFailed: "Ernährungsdaten konnten nicht geladen werden.",
    retry: "Erneut versuchen",
    percent: "%",
    gramShort: "g",
  },
  ru: {
    nutrition: "Питание",
    today: "Сегодня",
    yesterday: "Вчера",
    backToToday: "Вернуться к сегодня",
    previousDay: "Предыдущий день",
    nextDay: "Следующий день",
    addFood: "Добавить еду",
    protein: "Белок",
    calories: "Калории",
    fat: "Жиры",
    carbs: "Углеводы",
    fiber: "Клетчатка",
    remaining: "осталось",
    excess: "сверх нормы",
    targetReached: "Норма достигнута",
    targetExceeded: "Норма превышена",
    noTarget: "Задайте норму белка в настройках",
    empty: "За этот день еда ещё не записана.",
    camera: "Сфотографировать",
    gallery: "Выбрать фото",
    manual: "Ввести вручную",
    analyzing: "Оцениваю состав и размер порций…",
    queued: "Фото добавлено. Анализ продолжается в фоне.",
    processing: "Идёт анализ",
    answerQuestions: "Ответить на вопросы",
    reviewEstimate: "Проверить оценку",
    analysisFailedShort: "Не удалось распознать — ввести вручную",
    queuedHint: "Fit можно закрыть и вернуться позже.",
    cancelAnalysis: "Удалить необработанное фото",
    estimated: "Оценка по фотографии — проверьте перед сохранением.",
    privatePhoto: "Фото обрабатывается приватно и нигде не публикуется.",
    analysisFailed: "Анализ фото недоступен. Можно ввести блюдо вручную.",
    offlinePhoto: "Для анализа фото нужен интернет. Ручной ввод продолжает работать.",
    tooLarge: "Выберите изображение меньше 10 МБ.",
    invalidImage: "Выберите файл изображения.",
    questions: "Несколько деталей сделают оценку точнее",
    other: "Другое",
    answer: "Ваш ответ",
    continue: "Обновить оценку",
    editDirectly: "Исправить вручную",
    review: "Проверка блюда",
    mealName: "Название блюда",
    foodName: "Продукт",
    grams: "Примерный вес, г",
    consumed: "Сколько было съедено?",
    fullServing: "Значения для всей порции на фото",
    assumptions: "Предположения",
    uncertainty: "Неопределённость",
    addItem: "Добавить продукт",
    save: "Сохранить в дневник",
    discardZero: "0% ничего не добавит. Закройте форму, чтобы отменить.",
    breakfast: "Завтрак",
    lunch: "Обед",
    dinner: "Ужин",
    snack: "Перекус",
    edit: "Изменить",
    delete: "Удалить",
    deleteTitle: "Удалить приём пищи?",
    deleteText: "Итоги дня обновятся сразу. Действие нельзя отменить.",
    cancel: "Отмена",
    saveFailed: "Не удалось сохранить еду. Изменения остались на экране.",
    loadFailed: "Не удалось загрузить данные питания.",
    retry: "Повторить",
    percent: "%",
    gramShort: "г",
  },
} as const;

type NutritionMessage = keyof (typeof copy)["en"];
const nt = (key: NutritionMessage) => copy[getLanguage()][key];

type PendingPhotoUpload = {
  id: string;
  previewUrl: string;
  occurredOn: string;
};

const emptyItem = (): NutritionItem => ({
  id: crypto.randomUUID(),
  name: "",
  estimatedGrams: 0,
  ...emptyNutrients(),
});

const estimate = (value: any) =>
  Number(value?.estimate ?? value ?? 0) || 0;

const boundedAiText = (value: unknown, fallback: string, maxLength: number) => {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).slice(0, maxLength).trim();
};

const MAX_MEAL_TITLE_LENGTH = 72;
const photoDescriptionPrefix = /^(?:на (?:этом )?(?:фото|фотографии|изображении)\s+(?:изображ(?:е|ё)н(?:а|о|ы)?|вид(?:ен|на|но|ны))|(?:this |the )?(?:photo|image)\s+(?:shows|depicts)|(?:auf (?:dem|diesem) foto (?:ist|sind)|das foto zeigt))(?=[\s,:-]|$)[\s,:-]*/iu;

const conciseMealTitle = (value: unknown, foods: any[]) => {
  const summary = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  const foodTitle = foods
    .map((food) => typeof food?.name === "string" ? food.name.replace(/\s+/g, " ").trim() : "")
    .filter(Boolean)
    .slice(0, 2)
    .join(" + ");
  const candidate = photoDescriptionPrefix.test(summary) && foodTitle
    ? foodTitle
    : summary.replace(photoDescriptionPrefix, "").split(/[,;]|\s+[—–]\s+/u, 1)[0].trim();
  return boundedAiText(candidate, "Meal", MAX_MEAL_TITLE_LENGTH);
};

export const normalizeMealAnalysis = (raw: MealAnalysis | any): MealAnalysis => {
  const value = raw.result || raw.analysis || raw;
  const foods = value.items || value.foods || [emptyItem()];
  const totals = value.totals;
  const uncertaintyFromRange = totals
    ? `${estimate(totals.calories?.min)}–${estimate(totals.calories?.max)} kcal · ${estimate(totals.proteinGrams?.min)}–${estimate(totals.proteinGrams?.max)} g protein`
    : "";
  return {
    id: raw.analysisId || value.id || crypto.randomUUID(),
    // Model output is untrusted and may be longer than the editable/API fields.
    // Keep the generated values inside the same limits enforced by the form.
    title: conciseMealTitle(value.title || value.mealName || value.summary, foods),
    items: foods.map((food: any) => ({
      id: food.id || crypto.randomUUID(),
      name: boundedAiText(food.name, "Food", 120),
      estimatedGrams: estimate(
        food.estimatedGrams ?? food.amountGrams ?? food.portion?.estimatedGrams,
      ),
      calories: estimate(food.calories),
      proteinGrams: estimate(food.proteinGrams),
      fatGrams: estimate(food.fatGrams),
      carbsGrams: estimate(food.carbsGrams),
      fiberGrams: estimate(food.fiberGrams),
    })),
    assumptions: (value.assumptions || []).map((assumption: any) =>
      typeof assumption === "string" ? assumption : assumption.text,
    ),
    uncertainty:
      value.uncertainty ||
      value.uncertaintySummary ||
      uncertaintyFromRange ||
      value.overallConfidence ||
      "",
    questions: (value.questions || value.clarificationQuestions || []).map(
      (question: any) => ({
        id: question.id || crypto.randomUUID(),
        text: question.text || question.question,
        choices: question.choices || question.options || [],
        allowFreeText: true,
      }),
    ),
    clarificationRound:
      value.clarificationRound || raw.metadata?.clarificationRound || 0,
    thumbnailUrl: raw.thumbnailUrl || value.thumbnailUrl,
    providerResult: value,
  };
};

const photoJobsForDate = (jobs: PhotoAnalysisJob[], date: string) =>
  jobs.filter((job) => (job.occurredOn || localDate(new Date(job.createdAt))) === date);

const nutritionTotalsWithPhotoJobs = (
  day: NutritionDay | undefined,
  jobs: PhotoAnalysisJob[],
  date: string,
) => {
  const totals = { ...(day?.totals || emptyNutrients()) };
  for (const job of photoJobsForDate(jobs, date)) {
    if (!job.result && !job.analysis) continue;
    const estimate = sumItems(normalizeMealAnalysis(job).items);
    totals.calories += estimate.calories;
    totals.proteinGrams += estimate.proteinGrams;
    totals.fatGrams += estimate.fatGrams;
    totals.carbsGrams += estimate.carbsGrams;
    totals.fiberGrams += estimate.fiberGrams;
  }
  return totals;
};

export function NutritionDashboardCard({ open }: { open: () => void }) {
  const [day, setDay] = useState<NutritionDay>();
  const [jobs, setJobs] = useState<PhotoAnalysisJob[]>([]);
  useEffect(() => {
    Promise.all([nutritionDay(localDate()), photoAnalysisJobs().catch(() => [])])
      .then(([nextDay, nextJobs]) => {
        setDay(nextDay);
        setJobs(nextJobs);
      })
      .catch(() => undefined);
  }, []);
  if (!day) return null;
  const totals = nutritionTotalsWithPhotoJobs(day, jobs, localDate());
  const percent = day.proteinTarget
    ? Math.round((totals.proteinGrams / day.proteinTarget) * 100)
    : 0;
  const difference = Math.round(day.proteinTarget - totals.proteinGrams);
  return (
    <button className="nutrition-dashboard-card" onClick={open}>
      <span>{nt("protein")}</span>
      <strong>
        {totals.proteinGrams} / {day.proteinTarget || "—"} {nt("gramShort")}
      </strong>
      <i><b style={{ width: `${Math.min(100, percent)}%` }} /></i>
      <small>
        {percent}% · {totals.calories} kcal
        {day.proteinTarget > 0 &&
          ` · ${Math.abs(difference)} ${nt("gramShort")} ${difference >= 0 ? nt("remaining") : nt("excess")}`}
      </small>
      <span className="nutrition-dashboard-add"><Plus size={18} /> {nt("addFood")}</span>
    </button>
  );
}

export function Nutrition() {
  const [date, setDate] = useState(localDate());
  const [day, setDay] = useState<NutritionDay>();
  const [jobs, setJobs] = useState<PhotoAnalysisJob[]>([]);
  const [pendingUploads, setPendingUploads] = useState<PendingPhotoUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [editor, setEditor] = useState<NutritionEntry | PhotoAnalysisJob | "new">();
  const [deleteTarget, setDeleteTarget] = useState<NutritionEntry>();
  const loadSequence = useRef(0);
  const load = (showLoading = true) => {
    const sequence = ++loadSequence.current;
    if (showLoading) setLoading(true);
    setError("");
    return Promise.all([nutritionDay(date), photoAnalysisJobs().catch(() => [])])
      .then(([nextDay, nextJobs]) => {
        if (sequence !== loadSequence.current) return;
        setDay(nextDay);
        setJobs(nextJobs);
      })
      .catch(() => {
        if (sequence === loadSequence.current) setError(nt("loadFailed"));
      })
      .finally(() => {
        if (showLoading && sequence === loadSequence.current) setLoading(false);
      });
  };
  useEffect(() => { void load(); }, [date]);
  useEffect(() => {
    if (!jobs.some((job) => job.status === "processing")) return;
    const timer = window.setInterval(() => {
      photoAnalysisJobs().then(setJobs).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [jobs]);
  const visibleJobs = useMemo(
    () => photoJobsForDate(jobs, date),
    [date, jobs],
  );
  const displayedTotals = useMemo(
    () => nutritionTotalsWithPhotoJobs(day, jobs, date),
    [date, day, jobs],
  );
  const percent = day?.proteinTarget
    ? Math.round((displayedTotals.proteinGrams / day.proteinTarget) * 100)
    : 0;
  const difference = Math.round(
    (day?.proteinTarget || 0) - displayedTotals.proteinGrams,
  );
  const grouped = useMemo(
    () =>
      (["breakfast", "lunch", "dinner", "snack"] as const)
        .map((type) => ({
          type,
          entries: day?.entries.filter((entry) => entry.mealType === type) || [],
        }))
        .filter((group) => group.entries.length),
    [day],
  );
  return (
    <section className="nutrition-page">
      <header>
        <div><h1>{nt("nutrition")}</h1><p>{formatDay(date)}</p></div>
        <div className="brandmark"><Utensils /></div>
      </header>
      <div className="nutrition-date-nav" aria-label={nt("nutrition")}>
        <button aria-label={nt("previousDay")} onClick={() => setDate(moveLocalDate(date, -1))}><ChevronLeft /></button>
        <button className="nutrition-date-current" onClick={() => setDate(localDate())} disabled={date === localDate()}>
          <strong>{formatRelativeDay(date)}</strong>
          {date !== localDate() && <small>{nt("backToToday")}</small>}
        </button>
        <button aria-label={nt("nextDay")} onClick={() => setDate(moveLocalDate(date, 1))} disabled={date >= localDate()}><ChevronRight /></button>
      </div>
      {loading ? <div className="nutrition-loading" aria-busy="true">…</div> : error ? (
        <div className="card error"><p>{error}</p><button onClick={() => load()}>{nt("retry")}</button></div>
      ) : day && (
        <>
          <div className={`nutrition-protein ${percent >= 100 ? "reached" : ""}`}>
            <div className="nutrition-progress-ring" style={{ "--progress": `${Math.min(100, percent) * 3.6}deg` } as any}>
              <span><strong>{percent}%</strong><small>{nt("protein")}</small></span>
            </div>
            <div>
              <strong>{displayedTotals.proteinGrams} / {day.proteinTarget || "—"} {nt("gramShort")}</strong>
              <span>{day.proteinTarget ? `${Math.abs(difference)} ${nt("gramShort")} ${difference >= 0 ? nt("remaining") : nt("excess")}` : nt("noTarget")}</span>
              {percent >= 100 && <em>{percent > 100 ? nt("targetExceeded") : nt("targetReached")}</em>}
            </div>
          </div>
          <MacroGrid nutrients={displayedTotals} />
          <button className="primary nutrition-add" onClick={() => setEditor("new")}><Plus /> {nt("addFood")}</button>
          {uploadError && <p className="nutrition-alert error">{uploadError}</p>}
          <div className="nutrition-entries">
            {pendingUploads.filter((upload) => upload.occurredOn === date).map((upload) => <PendingPhotoUploadCard key={upload.id} upload={upload} />)}
            {visibleJobs.map((job) => <PhotoAnalysisCard
              key={job.analysisId}
              job={job}
              onOpen={() => setEditor(job)}
              onDelete={async () => { await deletePhotoAnalysis(job.analysisId); load(); }}
            />)}
            {grouped.map((group) => (
              <div key={group.type} className="nutrition-meal-group">
                <h2>{nt(group.type)}</h2>
                {group.entries.map((entry) => (
                  <button className="nutrition-entry" key={entry.id} onClick={() => setEditor(entry)}>
                    {entry.thumbnailUrl ? <PrivateThumbnail src={entry.thumbnailUrl} /> : <span className="nutrition-entry-icon"><Utensils /></span>}
                    <span><b>{entry.title}</b><small>{new Date(entry.occurredAt).toLocaleTimeString(getLanguage(), { hour: "2-digit", minute: "2-digit" })} · {entry.consumedPercent}%</small></span>
                    <strong>{entry.proteinGrams} {nt("gramShort")}</strong>
                    <small>{entry.calories} kcal</small>
                  </button>
                ))}
              </div>
            ))}
            {!day.entries.length && !visibleJobs.length && !pendingUploads.some((upload) => upload.occurredOn === date) && <div className="nutrition-empty"><Utensils /><p>{nt("empty")}</p></div>}
          </div>
        </>
      )}
      {editor && <MealEditor
        value={editor !== "new" && "id" in editor ? editor : undefined}
        job={editor !== "new" && "analysisId" in editor ? editor : undefined}
        date={date}
        onClose={() => setEditor(undefined)}
        onUpload={(file) => {
          const upload = { id: crypto.randomUUID(), previewUrl: URL.createObjectURL(file), occurredOn: date };
          setUploadError("");
          setPendingUploads((current) => [upload, ...current]);
          setEditor(undefined);
          void analyzeMeal(file, date)
            .then(() => photoAnalysisJobs().then(setJobs))
            .catch(() => setUploadError(nt("analysisFailed")))
            .finally(() => {
              URL.revokeObjectURL(upload.previewUrl);
              setPendingUploads((current) => current.filter((item) => item.id !== upload.id));
            });
        }}
        onQueued={() => { setEditor(undefined); load(false); }}
        onSaved={() => { setEditor(undefined); load(); }}
        onDelete={editor !== "new" && "id" in editor ? () => setDeleteTarget(editor) : undefined}
      />}
      {deleteTarget && <ConfirmDelete entry={deleteTarget} onCancel={() => setDeleteTarget(undefined)} onDeleted={() => { setDeleteTarget(undefined); setEditor(undefined); load(); }} />}
    </section>
  );
}

function PendingPhotoUploadCard({ upload }: { upload: PendingPhotoUpload }) {
  return <div className="nutrition-entry nutrition-analysis-card processing" aria-live="polite" aria-busy="true">
    <div className="nutrition-analysis-open nutrition-upload-pending">
      <img src={upload.previewUrl} alt="" />
      <span><b>{nt("processing")}</b><small>{nt("analyzing")}</small></span>
      <RefreshCw className="nutrition-spin" />
    </div>
  </div>;
}

function PhotoAnalysisCard({ job, onOpen, onDelete }: {
  job: PhotoAnalysisJob;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const normalized = job.result || job.analysis
    ? normalizeMealAnalysis(job)
    : undefined;
  const totals = normalized ? sumItems(normalized.items) : undefined;
  const label = job.status === "processing"
    ? nt("processing")
    : normalized?.questions.length && normalized.clarificationRound < 1
        ? nt("answerQuestions")
        : normalized
          ? nt("reviewEstimate")
          : nt("analysisFailedShort");
  return <div className={`nutrition-entry nutrition-analysis-card ${job.status}`}>
    <button className="nutrition-analysis-open" onClick={onOpen}>
      {job.thumbnailUrl
        ? <PrivateThumbnail src={job.thumbnailUrl} />
        : <span className="nutrition-entry-icon"><Clock3 /></span>}
      <span>
        <b>{normalized?.title || nt("processing")}</b>
        <small>{label}</small>
        {totals && <small>{Math.round(totals.calories)} kcal · {Math.round(totals.proteinGrams)} {nt("gramShort")} {nt("protein").toLocaleLowerCase()}</small>}
      </span>
      {job.status === "processing" ? <RefreshCw className="nutrition-spin" /> : <ChevronRight />}
    </button>
    <button className="nutrition-analysis-delete" aria-label={nt("cancelAnalysis")} onClick={onDelete}><X /></button>
  </div>;
}

function PrivateThumbnail({ src }: { src: string }) {
  const [objectUrl, setObjectUrl] = useState<string>();
  useEffect(() => {
    if (src.startsWith("blob:") || src.startsWith("data:")) {
      setObjectUrl(src);
      return;
    }
    const controller = new AbortController();
    let createdUrl: string | undefined;
    const headers = analysisHeaders();
    fetch(src, { headers, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("thumbnail-unavailable");
        return response.blob();
      })
      .then((blob) => {
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [src]);
  return objectUrl ? (
    <img src={objectUrl} alt="" />
  ) : (
    <span className="nutrition-entry-icon"><Utensils /></span>
  );
}

function formatDay(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(getLanguage(), { weekday: "long", day: "numeric", month: "long" });
}

function formatRelativeDay(date: string) {
  if (date === localDate()) return nt("today");
  if (date === moveLocalDate(localDate(), -1)) return nt("yesterday");
  return formatDay(date);
}

function MacroGrid({ nutrients }: { nutrients: Nutrients }) {
  return <div className="nutrition-macros">
    <span><b>{Math.round(nutrients.calories)}</b><small>kcal</small></span>
    <span><b>{nutrients.fatGrams}</b><small>{nt("fat")}, {nt("gramShort")}</small></span>
    <span><b>{nutrients.carbsGrams}</b><small>{nt("carbs")}, {nt("gramShort")}</small></span>
    <span><b>{nutrients.fiberGrams}</b><small>{nt("fiber")}, {nt("gramShort")}</small></span>
  </div>;
}

function MealEditor({ value, job, date, onClose, onUpload, onQueued, onSaved, onDelete }: {
  value?: NutritionEntry;
  job?: PhotoAnalysisJob;
  date: string;
  onClose: () => void;
  onUpload: (file: File) => void;
  onQueued: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const initialAnalysis = job && (job.result || job.analysis)
    ? normalizeMealAnalysis(job)
    : undefined;
  const initialStage = value
    ? "review"
    : job?.status === "processing"
      ? "loading"
      : initialAnalysis?.questions.length && initialAnalysis.clarificationRound < 1
        ? "questions"
        : job
          ? "review"
          : "choose";
  const [stage, setStage] = useState<"choose" | "loading" | "questions" | "review">(initialStage);
  const [analysis, setAnalysis] = useState<MealAnalysis | undefined>(initialAnalysis);
  const [items, setItems] = useState<NutritionItem[]>(value?.items?.length
    ? structuredClone(value.items)
    : initialAnalysis?.items?.length
      ? structuredClone(initialAnalysis.items)
      : [emptyItem()]);
  const [title, setTitle] = useState(value?.title || initialAnalysis?.title || "");
  const [mealType, setMealType] = useState<NutritionEntry["mealType"]>(value?.mealType || "snack");
  const [consumedPercent, setConsumedPercent] = useState(value?.consumedPercent ?? 100);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState(job?.status === "manual_required" && !initialAnalysis ? nt("analysisFailed") : "");
  const [saving, setSaving] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const chooseFile = async (file?: File) => {
    if (!file) return;
    if (!navigator.onLine) { setError(nt("offlinePhoto")); return; }
    if (!file.type.startsWith("image/")) { setError(nt("invalidImage")); return; }
    if (file.size > 10 * 1024 * 1024) { setError(nt("tooLarge")); return; }
    onUpload(file);
  };
  const full = sumItems(items);
  const occurredAt =
    value?.occurredAt ||
    new Date(`${date}T${new Date().toTimeString().slice(0, 8)}`).toISOString();
  return <div className="nutrition-modal" role="dialog" aria-modal="true" aria-labelledby="meal-editor-title">
    <div className="nutrition-modal-panel">
      <div className="nutrition-modal-title"><h2 id="meal-editor-title">{stage === "review" ? nt("review") : nt("addFood")}</h2><button aria-label={nt("cancel")} onClick={onClose}><X /></button></div>
      {error && <p className="nutrition-alert error">{error}</p>}
      {stage === "choose" && <div className="nutrition-chooser">
        <input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(event) => void chooseFile(event.target.files?.[0])} />
        <input ref={galleryRef} hidden type="file" accept="image/*" onChange={(event) => void chooseFile(event.target.files?.[0])} />
        <button onClick={() => cameraRef.current?.click()}><Camera />{nt("camera")}</button>
        <button onClick={() => galleryRef.current?.click()}><ImagePlus />{nt("gallery")}</button>
        <button onClick={() => setStage("review")}><Pencil />{nt("manual")}</button>
        <p>{nt("privatePhoto")}</p>
      </div>}
      {stage === "loading" && <div className="nutrition-analyzing" aria-live="polite"><i /><p>{nt("processing")}</p><small>{nt("queuedHint")}</small></div>}
      {stage === "questions" && analysis && <><div className="nutrition-estimate"><b>{nt("estimated")}</b><MacroGrid nutrients={sumItems(analysis.items)} /></div><Clarifications analysis={analysis} answers={answers} setAnswers={setAnswers} onManual={() => setStage("review")} onContinue={async () => {
        if (analysis.clarificationRound >= 1) { setStage("review"); return; }
        setError("");
        try { await clarifyMeal(analysis, answers); onQueued(); }
        catch { setError(nt("analysisFailed")); }
      }} /></>}
      {stage === "review" && <div className="nutrition-review">
        {analysis && <div className="nutrition-estimate"><b>{nt("estimated")}</b>{analysis.uncertainty && <p><strong>{nt("uncertainty")}:</strong> {analysis.uncertainty}</p>}{analysis.assumptions.length > 0 && <details><summary>{nt("assumptions")}</summary><ul>{analysis.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}</div>}
        <label>{nt("mealName")}<input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>{nt("manual")}<select value={mealType} onChange={(event) => setMealType(event.target.value as NutritionEntry["mealType"])}>{(["breakfast", "lunch", "dinner", "snack"] as const).map(type => <option key={type} value={type}>{nt(type)}</option>)}</select></label>
        <p className="nutrition-full-serving">{nt("fullServing")}</p>
        {items.map((item, index) => <NutritionItemEditor key={item.id || index} item={item} onChange={(next) => setItems(current => current.map((old, i) => i === index ? next : old))} onRemove={items.length > 1 ? () => setItems(current => current.filter((_, i) => i !== index)) : undefined} />)}
        <button className="nutrition-add-item" onClick={() => setItems(current => [...current, emptyItem()])}><Plus />{nt("addItem")}</button>
        <MacroGrid nutrients={full} />
        <ConsumedControl value={consumedPercent} onChange={setConsumedPercent} />
        {consumedPercent === 0 && <p className="nutrition-alert">{nt("discardZero")}</p>}
        <button className="primary nutrition-save" disabled={saving || consumedPercent === 0 || !title.trim() || items.some(item => !item.name.trim())} onClick={async () => {
          setSaving(true); setError("");
          try { await saveNutritionEntry({ id: value?.id, occurredAt, mealType, title: title.trim(), consumedPercent, items, ...full, thumbnailUrl: analysis?.thumbnailUrl || value?.thumbnailUrl, assumptions: analysis?.assumptions || value?.assumptions, uncertainty: analysis?.uncertainty || value?.uncertainty, originalAnalysis: value?.originalAnalysis || analysis }); if (!token() && analysis) await deletePhotoAnalysis(analysis.id).catch(() => undefined); onSaved(); }
          catch { setError(nt("saveFailed")); setSaving(false); }
        }}>{nt("save")}</button>
        {onDelete && <button className="nutrition-delete" onClick={onDelete}><Trash2 /> {nt("delete")}</button>}
      </div>}
    </div>
  </div>;
}

function Clarifications({ analysis, answers, setAnswers, onContinue, onManual }: { analysis: MealAnalysis; answers: Record<string, string>; setAnswers: (answers: Record<string, string>) => void; onContinue: () => void; onManual: () => void }) {
  return <div className="nutrition-questions"><p>{nt("questions")}</p>{analysis.questions.map(question => <fieldset key={question.id}><legend>{question.text}</legend>{question.choices.map(choice => <label key={choice}><input type="radio" name={question.id} checked={answers[question.id] === choice} onChange={() => setAnswers({ ...answers, [question.id]: choice })} />{choice}</label>)}{question.allowFreeText !== false && <label><span>{nt("other")}</span><input placeholder={nt("answer")} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })} /></label>}</fieldset>)}<button className="primary" disabled={analysis.questions.some(question => !answers[question.id]?.trim())} onClick={onContinue}>{nt("continue")}</button><button className="nutrition-manual-link" onClick={onManual}>{nt("reviewEstimate")}</button></div>;
}

function NutritionItemEditor({ item, onChange, onRemove }: { item: NutritionItem; onChange: (item: NutritionItem) => void; onRemove?: () => void }) {
  const numeric = (key: keyof NutritionItem, value: string) => onChange({ ...item, [key]: Math.max(0, Number(value) || 0) });
  return <fieldset className="nutrition-item"><div><input aria-label={nt("foodName")} placeholder={nt("foodName")} value={item.name} maxLength={120} onChange={event => onChange({ ...item, name: event.target.value })} />{onRemove && <button aria-label={nt("delete")} onClick={onRemove}><X /></button>}</div><div className="nutrition-item-fields"><label>{nt("grams")}<input type="number" inputMode="decimal" min="0" value={item.estimatedGrams} onChange={event => numeric("estimatedGrams", event.target.value)} /></label><label>kcal<input type="number" inputMode="decimal" min="0" value={item.calories} onChange={event => numeric("calories", event.target.value)} /></label><label>{nt("protein")}, {nt("gramShort")}<input type="number" inputMode="decimal" min="0" step="0.1" value={item.proteinGrams} onChange={event => numeric("proteinGrams", event.target.value)} /></label><label>{nt("fat")}, {nt("gramShort")}<input type="number" inputMode="decimal" min="0" step="0.1" value={item.fatGrams} onChange={event => numeric("fatGrams", event.target.value)} /></label><label>{nt("carbs")}, {nt("gramShort")}<input type="number" inputMode="decimal" min="0" step="0.1" value={item.carbsGrams} onChange={event => numeric("carbsGrams", event.target.value)} /></label><label>{nt("fiber")}, {nt("gramShort")}<input type="number" inputMode="decimal" min="0" step="0.1" value={item.fiberGrams} onChange={event => numeric("fiberGrams", event.target.value)} /></label></div></fieldset>;
}

function ConsumedControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <fieldset className="nutrition-consumed"><legend>{nt("consumed")}</legend><output htmlFor="consumed-range">{value}{nt("percent")}</output><input id="consumed-range" type="range" min="0" max="100" step="1" value={value} onChange={event => onChange(Number(event.target.value))} aria-valuetext={`${value} ${nt("percent")}`} /><div>{[25,50,75,100].map(percent => <button type="button" className={value === percent ? "active" : ""} key={percent} onClick={() => onChange(percent)}>{percent}%</button>)}</div></fieldset>;
}

function ConfirmDelete({ entry, onCancel, onDeleted }: { entry: NutritionEntry; onCancel: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  return <div className="nutrition-modal confirm" role="alertdialog" aria-modal="true"><div className="nutrition-modal-panel"><h2>{nt("deleteTitle")}</h2><p>{entry.title}</p><p>{nt("deleteText")}</p><div className="nutrition-confirm-actions"><button onClick={onCancel}>{nt("cancel")}</button><button className="danger-button" disabled={busy} onClick={async () => { setBusy(true); await deleteNutritionEntry(entry.id); onDeleted(); }}>{nt("delete")}</button></div></div></div>;
}
