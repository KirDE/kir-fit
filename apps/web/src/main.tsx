import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Dumbbell,
  History as HistoryIcon,
  House,
  LineChart as ChartIcon,
  Plus,
  Settings,
  Scale,
  Undo2,
  WifiOff,
  X,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api, isGuest, setGuest, setToken, token, uuid } from "./api";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { flush, queue } from "./offline";
import { getLanguage, setLanguage, tr } from "./i18n";
import type { Exercise, Session, WorkoutExercise } from "./types";
import "./styles.css";
import { registerSW } from "virtual:pwa-register";
import "./enhancements.css";
registerSW({ immediate: true });
type View = "home" | "workout" | "history" | "progress" | "weight" | "admin";
const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const localizedWeekdays = () => {
  const lang = getLanguage();
  const names = lang === "de"
    ? [
        "Sonntag",
        "Montag",
        "Dienstag",
        "Mittwoch",
        "Donnerstag",
        "Freitag",
        "Samstag",
      ]
    : lang === "ru"
      ? [
          "Воскресенье",
          "Понедельник",
          "Вторник",
          "Среда",
          "Четверг",
          "Пятница",
          "Суббота",
        ]
      : dayNames;
  const abbreviations =
    lang === "ru"
      ? ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]
      : lang === "de"
        ? ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]
        : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return [1, 2, 3, 4, 5, 6, 0].map((value) => ({
    value,
    name: names[value],
    abbreviation: abbreviations[value],
  }));
};
const localizedName = (e: Exercise) =>
  getLanguage() === "ru"
    ? e.nameRu || e.nameEn
    : getLanguage() === "de"
      ? e.nameDe
      : e.nameEn;
const localizedDescription = (e: Exercise) =>
  getLanguage() === "ru"
    ? e.descriptionRu || e.description
    : getLanguage() === "de"
      ? e.descriptionDe || e.description
      : e.description;
const localizedInstructions = (e: Exercise) =>
  getLanguage() === "ru"
    ? e.instructionsRu || e.instructions
    : getLanguage() === "de"
      ? e.instructionsDe || e.instructions
      : e.instructions;
const localizedTargets = (xs: string[]) =>
  getLanguage() === "ru"
    ? xs.map(
        (x) =>
          (
            ({
              Quadriceps: "Квадрицепсы",
              Glutes: "Ягодичные",
              Hamstrings: "Задняя поверхность бедра",
              Chest: "Грудные",
              Triceps: "Трицепс",
              "Front delts": "Передние дельты",
              Lats: "Широчайшие",
              Biceps: "Бицепс",
              "Upper back": "Верх спины",
              "Mid back": "Средняя часть спины",
              Shoulders: "Плечи",
            }) as Record<string, string>
          )[x] || x,
      )
    : xs;
function App() {
  const [authed, setAuthed] = useState(!!token() || isGuest());
  const [view, setView] = useState<View>("home");
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const f = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine && !isGuest()) flush(api);
    };
    addEventListener("online", f);
    addEventListener("offline", f);
    return () => {
      removeEventListener("online", f);
      removeEventListener("offline", f);
    };
  }, []);
  if (!authed) return <Login done={() => setAuthed(true)} />;
  return (
    <div className="app">
      {isGuest() && <div className="guest-warning">{tr("guestWarning")}</div>}
      {!online && (
        <div className="offline">
          <WifiOff size={16} /> {tr("offline")}
        </div>
      )}
      <main>
        {view === "home" && (
          <Dashboard
            start={() => setView("workout")}
            weight={() => setView("weight")}
          />
        )}{" "}
        {view === "workout" && <Workout done={() => setView("home")} />}{" "}
        {view === "history" && <History />}{" "}
        {view === "progress" && <Progress />}{" "}
        {view === "weight" && <BodyWeight />}{" "}
        {view === "admin" && (
          <Admin
            logout={() => {
              setToken(null);
              setGuest(false);
              setAuthed(false);
            }}
          />
        )}
      </main>
      {view !== "workout" && (
        <nav>
          {[
            ["home", House, tr("home")],
            ["history", HistoryIcon, tr("history")],
            ["progress", ChartIcon, tr("progress")],
            ["weight", Scale, tr("weight")],
            ["admin", Settings, tr("settings")],
          ].map(([v, I, l]: any) => (
            <button
              key={v}
              className={view === v ? "active" : ""}
              onClick={() => setView(v)}
            >
              <I />
              <span>{l}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`language-switch${compact ? " compact" : ""}`}
      aria-label={tr("language")}
    >
      {(["en", "de", "ru"] as const).map((language) => (
        <button
          type="button"
          key={language}
          className={getLanguage() === language ? "selected" : ""}
          onClick={() => {
            setLanguage(language);
            location.reload();
          }}
        >
          {language === "en" ? "EN" : language === "de" ? "DE" : "RU"}
        </button>
      ))}
    </div>
  );
}
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.55h3.24c1.9-1.75 2.98-4.33 2.98-7.42Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.98-.9 6.63-2.35l-3.25-2.55c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.93A6.02 6.02 0 0 1 6.08 12c0-.67.11-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.55l3.35-2.62Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.94c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z"
      />
    </svg>
  );
}
function Login({ done }: { done: () => void }) {
  const [u, setU] = useState("kirill"),
    [p, setP] = useState(""),
    [err, setErr] = useState(""),
    [googleReady, setGoogleReady] = useState(false),
    [passkeyBusy, setPasskeyBusy] = useState(false),
    [passkeyErr, setPasskeyErr] = useState(""),
    [needsDisplayName, setNeedsDisplayName] = useState(false),
    [displayName, setDisplayName] = useState(""),
    googleRef = useRef<any>(null);
  const passkeysSupported = typeof window.PublicKeyCredential !== "undefined";
  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return;
    const init = () => {
      const g = (window as any).google;
      if (!g) return;
      googleRef.current = g.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "openid email profile",
        callback: async ({ access_token, error }: any) => {
          if (error) {
            setErr(error);
            return;
          }
          try {
            const r = await api("/auth/google", {
              method: "POST",
              body: JSON.stringify({ accessToken: access_token }),
            });
            setGuest(false);
            setToken(r.token);
            done();
          } catch (e: any) {
            setErr(e.message);
          }
        },
      });
      setGoogleReady(true);
    };
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = init;
    document.head.appendChild(script);
    return () => script.remove();
  }, []);

  const handlePasskeyLogin = async () => {
    setPasskeyErr("");
    setPasskeyBusy(true);
    try {
      const ceremony = await api("/auth/webauthn/login-options", {
        method: "POST",
      });
      const response = await startAuthentication({
        optionsJSON: ceremony.options,
      });
      const result = await api("/auth/webauthn/login-verify", {
        method: "POST",
        body: JSON.stringify({ ceremonyId: ceremony.ceremonyId, response }),
      });
      setGuest(false);
      setToken(result.token);
      done();
    } catch (error: any) {
      setPasskeyErr(error.message || tr("passkeyLoginFailed"));
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handlePasskeyRegister = async () => {
    setPasskeyErr("");
    setPasskeyBusy(true);
    try {
      const ceremony = await api("/auth/webauthn/register-options", {
        method: "POST",
      });
      const response = await startRegistration({
        optionsJSON: ceremony.options,
      });
      const result = await api("/auth/webauthn/register-verify", {
        method: "POST",
        body: JSON.stringify({ ceremonyId: ceremony.ceremonyId, response }),
      });
      setGuest(false);
      setToken(result.token);
      setNeedsDisplayName(true);
    } catch (error: any) {
      setPasskeyErr(error.message || tr("passkeyRegistrationFailed"));
    } finally {
      setPasskeyBusy(false);
    }
  };

  if (needsDisplayName)
    return (
      <div className="login name-onboarding">
        <div className="brand">
          <Dumbbell />
          <b>Kir Fit</b>
        </div>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setPasskeyErr("");
            setPasskeyBusy(true);
            try {
              await api("/settings/profile", {
                method: "PATCH",
                body: JSON.stringify({ displayName }),
              });
              done();
            } catch (error: any) {
              setPasskeyErr(error.message || tr("profileSaveFailed"));
            } finally {
              setPasskeyBusy(false);
            }
          }}
        >
          <h1>{tr("yourName")}</h1>
          <p>{tr("namePrompt")}</p>
          <label>
            {tr("displayName")}
            <input
              autoFocus
              autoComplete="name"
              maxLength={80}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </label>
          {passkeyErr && <p className="error">{passkeyErr}</p>}
          <button className="primary" disabled={passkeyBusy}>
            {tr("saveName")}
          </button>
        </form>
      </div>
    );

  return (
    <div className="login">
      <div className="login-top">
        <div className="brand">
          <Dumbbell />
          <b>Kir Fit</b>
        </div>
      </div>
      <h1>{tr("signInTitle")}</h1>
      <div className="passkey-actions">
        <button
          className="primary passkey-button"
          disabled={!passkeysSupported || passkeyBusy}
          onClick={handlePasskeyLogin}
        >
          {tr("passkeySignIn")}
        </button>
        <button
          className="passkey-button secondary"
          disabled={!passkeysSupported || passkeyBusy}
          onClick={handlePasskeyRegister}
        >
          {tr("passkeyRegister")}
        </button>
        {!passkeysSupported && <p className="error">{tr("passkeyUnavailable")}</p>}
        {passkeyErr && <p className="error">{passkeyErr}</p>}
      </div>
      <div className="login-divider"><span>{tr("or")}</span></div>
      <button
        className="google-login"
        disabled={!googleReady}
        onClick={() =>
          googleRef.current?.requestAccessToken({ prompt: "select_account" })
        }
      >
        <GoogleMark />
        <span>{tr("signGoogle")}</span>
      </button>
      {!import.meta.env.VITE_GOOGLE_CLIENT_ID && (
        <p className="error">{tr("googleConfig")}</p>
      )}
      <button
        className="guest-button"
        onClick={() => {
          setGuest(true);
          setToken(null);
          done();
        }}
      >
        {tr("continueGuest")}
      </button>
      <details className="legacy-login">
        <summary>{tr("existingAccount")}</summary>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setErr("");
            try {
              const result = await api("/auth/login", {
                method: "POST",
                body: JSON.stringify({ username: u, password: p }),
              });
              setGuest(false);
              setToken(result.token);
              done();
            } catch (error: any) {
              setErr(error.message);
            }
          }}
        >
          <label>
            {tr("username")}
            <input
              autoComplete="username"
              value={u}
              onChange={(event) => setU(event.target.value)}
            />
          </label>
          <label>
            {tr("password")}
            <input
              type="password"
              autoComplete="current-password"
              value={p}
              onChange={(event) => setP(event.target.value)}
            />
          </label>
          {err && <p className="error">{err}</p>}
          <button className="primary">{tr("signIn")}</button>
        </form>
      </details>
      <div className="login-language-bottom">
        <LanguageSwitcher compact />
      </div>
    </div>
  );
}
function Dashboard({
  start,
  weight,
}: {
  start: () => void;
  weight: () => void;
}) {
  const [d, setD] = useState<any>();
  useEffect(() => {
    api("/dashboard").then(setD);
  }, []);
  if (!d) return <Loading />;
  const next = new Date(d.nextWorkout),
    lang = getLanguage(),
    nextDay = localizedWeekdays().find(
      (day) => day.value === next.getDay(),
    )!.name;
  return (
    <section>
      <Header title="Kir Fit" />
      <div className="hero">
        <p className="eyebrow">{tr("nextWorkout")}</p>
        <h1>{nextDay}</h1>
        <p>
          {d.template?.name || "Full Body"} · 8{" "}
          {lang === "ru" ? "упражнений" : tr("exercises").toLowerCase()}
        </p>
        <button className="primary big" onClick={start}>
          <Dumbbell /> {tr("startWorkout")}
        </button>
      </div>
      <div className="grid">
        <Card title={tr("bodyWeight")} onClick={weight}>
          <strong>
            {d.currentWeight ?? "—"} {tr("kg")}
          </strong>
          <span className={d.weightChange <= 0 ? "good" : ""}>
            {d.weightChange == null ? "—" : d.weightChange.toFixed(1)}{" "}
            {tr("kg")} {tr("fromStart")}
          </span>
        </Card>
        <Card title={tr("lastWorkout")}>
          {d.last ? (
            <>
              <strong>
                {d.last.setCount} {tr("sets").toLowerCase()}
              </strong>
              <span>
                {d.last.volume.toLocaleString()} {tr("kg")} {tr("volume")} ·{" "}
                {d.last.durationMinutes} min
              </span>
            </>
          ) : (
            <span>{tr("noWorkout")}</span>
          )}
        </Card>
      </div>
      <Card title={tr("achievements")}>
        {d.achievements.length ? (
          d.achievements.map((a: string) => (
            <div className="achievement" key={a}>
              ↗ {a}
            </div>
          ))
        ) : (
          <span>{tr("noAchievements")}</span>
        )}
      </Card>
    </section>
  );
}
function Workout({ done }: { done: () => void }) {
  const [s, setS] = useState<Session | null | undefined>(),
    [index, setIndex] = useState(0),
    [rest, setRest] = useState<number | null>(null),
    [undo, setUndo] = useState<any>();
  useEffect(() => {
    api("/workouts/active").then(async (active) => {
      if (active) setS(active);
      else {
        const d = await api("/dashboard");
        setS(
          await api("/workouts/start", {
            method: "POST",
            body: JSON.stringify({
              templateId: d.template.id,
              clientMutationId: uuid(),
              introWeeks: true,
            }),
          }),
        );
      }
    });
  }, []);
  useEffect(() => {
    if (rest === null) return;
    const id = setInterval(
      () => setRest((r) => (r === null ? null : Math.max(0, r - 1))),
      1000,
    );
    return () => clearInterval(id);
  }, [rest]);
  useEffect(() => {
    if (rest === 0) {
      navigator.vibrate?.([250, 120, 250]);
      setRest(null);
    }
  }, [rest]);
  if (s === undefined) return <Loading />;
  if (!s) return <p>{tr("startError")}</p>;
  const ex = s.exercises[index];
  const complete = ex.sets.length >= ex.plannedSets;
  const reload = () => api("/workouts/active").then(setS);
  const save = async (data: any) => {
    const mutation = uuid();
    const payload = {
      ...data,
      workoutExerciseId: ex.id,
      setNumber: ex.sets.length + 1,
      clientMutationId: mutation,
    };
    try {
      const row = await api(`/workouts/${s.id}/sets`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setUndo({ session: s.id, set: row.id });
      await reload();
    } catch {
      queue({
        id: mutation,
        path: `/workouts/${s.id}/sets`,
        init: { method: "POST", body: JSON.stringify(payload) },
      });
      await reload().catch(() => {});
    }
    setRest(ex.restSeconds);
    if (ex.sets.length + 1 >= ex.plannedSets && index < s.exercises.length - 1)
      setIndex(index + 1);
  };
  const finish = async () => {
    await api(`/workouts/${s.id}/finish`, { method: "POST", body: "{}" });
    done();
  };
  return (
    <section className="workout">
      <div className="workout-top">
        <button className="icon" onClick={done}>
          <X />
        </button>
        <div>
          <b>
            {index + 1} / {s.exercises.length}
          </b>
          <small>Full Body</small>
        </div>
        <span>
          {Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 60000)}{" "}
          min
        </span>
      </div>
      <div className="progressbar">
        <i
          style={{
            width: `${((index + (complete ? 1 : 0)) / s.exercises.length) * 100}%`,
          }}
        />
      </div>
      {rest !== null && (
        <RestTimer
          seconds={rest}
          change={(n) => setRest(Math.max(0, rest + n))}
          skip={() => setRest(null)}
        />
      )}
      <ExerciseCard ex={ex} save={save} />
      {undo && (
        <button
          className="undo"
          onClick={async () => {
            await api(`/workouts/${undo.session}/sets/${undo.set}`, {
              method: "DELETE",
            });
            setUndo(null);
            await reload();
          }}
        >
          <Undo2 /> {tr("undo")}
        </button>
      )}
      <div className="exercise-nav">
        <button disabled={index === 0} onClick={() => setIndex(index - 1)}>
          {tr("previous")}
        </button>
        {index < s.exercises.length - 1 ? (
          <button onClick={() => setIndex(index + 1)}>
            {tr("nextExercise")}
          </button>
        ) : (
          complete && (
            <button className="primary" onClick={finish}>
              {tr("finish")}
            </button>
          )
        )}
      </div>
    </section>
  );
}
function ZoomableImage({
  src,
  alt,
  compact = false,
}: {
  src: string;
  alt: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) =>
      event.key === "Escape" && setOpen(false);
    addEventListener("keydown", close);
    document.body.classList.add("lightbox-open");
    return () => {
      removeEventListener("keydown", close);
      document.body.classList.remove("lightbox-open");
    };
  }, [open]);
  return (
    <>
      <button
        type="button"
        className={`zoomable-image${compact ? " compact" : ""}`}
        aria-label={`${alt} — enlarge`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <img src={src} alt={alt} />
        <span aria-hidden="true">↗</span>
      </button>
      {open && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            className="lightbox-close"
            aria-label="Close"
            onClick={() => setOpen(false)}
          >
            <X />
          </button>
          <img
            src={src}
            alt={alt}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
function ExerciseCard({
  ex,
  save,
}: {
  ex: WorkoutExercise;
  save: (v: any) => void;
}) {
  const last: any = null;
  const [weight, setWeight] = useState<number | "">(
      last?.weight || ex.sets.at(-1)?.weight || "",
    ),
    [reps, setReps] = useState(ex.minReps),
    [rir, setRir] = useState<number | null>(null);
  useEffect(() => {
    setWeight(ex.sets.at(-1)?.weight || "");
    setReps(ex.minReps);
  }, [ex.id]);
  return (
    <div className="exercise-card">
      <ZoomableImage
        src={ex.exercise.images[0]?.path || "/icon.svg"}
        alt={ex.exercise.nameEn}
      />
      <div className="exercise-title">
        <p className="eyebrow">
          {tr("exercise")}{" "}
          {ex.sets.length + 1 > ex.plannedSets
            ? ex.plannedSets
            : ex.sets.length + 1}{" "}
          / {ex.plannedSets} {tr("sets")}
        </p>
        <h1>{localizedName(ex.exercise)}</h1>
        <h2>
          {getLanguage() === "en" ? ex.exercise.nameDe : ex.exercise.nameEn}
        </h2>
      </div>
      {ex.machine && (ex.machine.seatSetting || ex.machine.backrestSetting) && (
        <div className="machine-settings">
          {tr("seat")}: {ex.machine.seatSetting || "—"} · {tr("backrest")}:{" "}
          {ex.machine.backrestSetting || "—"}
        </div>
      )}
      <details>
        <summary>{tr("technique")}</summary>
        <p>{localizedDescription(ex.exercise)}</p>
        <p>{localizedInstructions(ex.exercise)}</p>
      </details>
      {ex.sets.length > 0 && (
        <div className="completed-sets">
          {ex.sets.map((s) => (
            <span key={s.id}>
              ✓ {s.weight} {tr("kg")} × {s.reps}
              {s.rir !== null ? ` · RIR ${s.rir}` : ""}
            </span>
          ))}
        </div>
      )}
      <div className="inputs">
        <NumberStep
          label={tr("weight")}
          value={weight}
          set={setWeight}
          step={ex.exercise.defaultIncrement || 2.5}
          suffix={tr("kg")}
        />
        <NumberStep label={tr("reps")} value={reps} set={setReps} step={1} />
      </div>
      <div className="rir">
        <span>
          RIR <small>{tr("optional")}</small>
        </span>
        {[0, 1, 2, 3, 4].map((n) => (
          <button
            key={n}
            className={rir === n ? "selected" : ""}
            onClick={() => setRir(rir === n ? null : n)}
          >
            {n === 4 ? "4+" : n}
          </button>
        ))}
      </div>
      {ex.suggestIncrease && <div className="tip">{tr("increaseTip")}</div>}
      <button
        className="primary big complete"
        disabled={
          ex.sets.length >= ex.plannedSets ||
          weight === "" ||
          weight < 0 ||
          reps < 1
        }
        onClick={() => save({ weight, reps, rir })}
      >
        {tr("completeSet")}
      </button>
    </div>
  );
}
function NumberStep({
  label,
  value,
  set,
  step,
  suffix,
}: {
  label: string;
  value: number | "";
  set: (v: any) => void;
  step: number;
  suffix?: string;
}) {
  return (
    <label className="number">
      <span>{label}</span>
      <div>
        <button
          onClick={() =>
            set(Math.max(0, +(Number(value || 0) - step).toFixed(2)))
          }
        >
          −
        </button>
        <input
          inputMode="decimal"
          type="number"
          value={value}
          onChange={(e) =>
            set(e.target.value === "" ? "" : Number(e.target.value))
          }
        />
        {suffix && <b>{suffix}</b>}
        <button onClick={() => set(+(Number(value || 0) + step).toFixed(2))}>
          +
        </button>
      </div>
    </label>
  );
}
function RestTimer({
  seconds,
  change,
  skip,
}: {
  seconds: number;
  change: (n: number) => void;
  skip: () => void;
}) {
  return (
    <div className="rest">
      <div>
        <span>{tr("rest")}</span>
        <strong>
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </strong>
      </div>
      <button onClick={() => change(-30)}>−30s</button>
      <button onClick={() => change(30)}>+30s</button>
      <button onClick={skip}>{tr("skip")}</button>
    </div>
  );
}
function History() {
  const [rows, setRows] = useState<Session[]>();
  useEffect(() => {
    api("/history").then(setRows);
  }, []);
  if (!rows) return <Loading />;
  return (
    <section>
      <Header title={tr("history")} />
      <div className="list">
        {rows.map((s) => (
          <details className="history" key={s.id}>
            <summary>
              <div>
                <b>
                  {new Date(s.finishedAt!).toLocaleDateString(getLanguage())}
                </b>
                <span>
                  {s.summary.durationMinutes} min · {s.summary.setCount}{" "}
                  {tr("sets").toLowerCase()}
                </span>
              </div>
              <strong>
                {Math.round(s.summary.volume).toLocaleString()} {tr("kg")}
              </strong>
            </summary>
            {s.exercises
              .filter((e) => e.sets.length)
              .map((e) => (
                <div className="history-ex" key={e.id}>
                  <b>{localizedName(e.exercise)}</b>
                  <span>
                    {e.sets.map((x) => `${x.weight}×${x.reps}`).join(" · ")}
                  </span>
                </div>
              ))}
          </details>
        ))}
        {!rows.length && <Empty text={tr("emptyHistory")} />}
      </div>
    </section>
  );
}
function Progress() {
  const [items, setItems] = useState<Exercise[]>(),
    [selected, setSelected] = useState<string>(),
    [data, setData] = useState<any>();
  useEffect(() => {
    api("/exercises").then((x: Exercise[]) => {
      setItems(x);
      setSelected(x[0]?.id);
    });
  }, []);
  useEffect(() => {
    if (selected) api("/exercises/" + selected + "/progress").then(setData);
  }, [selected]);
  return (
    <section>
      <Header title={tr("progress")} />
      <select value={selected} onChange={(e) => setSelected(e.target.value)}>
        {items?.map((e) => (
          <option value={e.id} key={e.id}>
            {localizedName(e)} / {e.nameEn}
          </option>
        ))}
      </select>
      {data && (
        <>
          <div className="grid">
            <Card title={tr("workingWeight")}>
              <strong>
                {data.history.at(-1)?.weight || "—"} {tr("kg")}
              </strong>
            </Card>
            <Card title={tr("bestWeight")}>
              <strong>
                {Math.max(0, ...data.history.map((x: any) => x.weight)) || "—"}{" "}
                {tr("kg")}
              </strong>
            </Card>
          </div>
          <Card title={tr("workingWeight")}>
            <Chart
              data={data.history}
              dataKey="weight"
              suffix={` ${tr("kg")}`}
            />
          </Card>
          <Card title={tr("trainingVolume")}>
            <Chart
              data={data.history}
              dataKey="volume"
              suffix={` ${tr("kg")}`}
            />
          </Card>
        </>
      )}
    </section>
  );
}
function Chart({
  data,
  dataKey,
  suffix,
}: {
  data: any[];
  dataKey: string;
  suffix: string;
}) {
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data.map((x) => ({
            ...x,
            date: new Date(x.date).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            }),
          }))}
        >
          <XAxis dataKey="date" />
          <YAxis width={45} />
          <Tooltip
            formatter={(v: any) => [
              `${Number(v).toLocaleString()}${suffix}`,
              dataKey,
            ]}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke="#caff4a"
            strokeWidth={3}
            dot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
function BodyWeight() {
  const [rows, setRows] = useState<any[]>(),
    [weight, setWeight] = useState<number | "">(""),
    [notes, setNotes] = useState("");
  const load = () => api("/body-weight").then(setRows);
  useEffect(() => {
    load();
  }, []);
  const weekly = useMemo(
    () =>
      rows && rows.length > 1
        ? (rows.at(-1).weight - rows[0].weight) /
          Math.max(
            1,
            (new Date(rows.at(-1).date).getTime() -
              new Date(rows[0].date).getTime()) /
              604800000,
          )
        : 0,
    [rows],
  );
  if (!rows) return <Loading />;
  return (
    <section>
      <Header title={tr("bodyWeight")} />
      <div className="hero compact">
        <p className="eyebrow">{tr("current")}</p>
        <h1>
          {rows.at(-1)?.weight || "—"} {tr("kg")}
        </h1>
        <p>
          {weekly > 0 ? "+" : ""}
          {weekly.toFixed(2)} {tr("kg")} {tr("average")}
        </p>
      </div>
      <Card title={tr("weightTrend")}>
        <Chart data={rows} dataKey="weight" suffix={` ${tr("kg")}`} />
      </Card>
      <Card title={tr("addEntry")}>
        <NumberStep
          label={tr("weight")}
          value={weight}
          set={setWeight}
          step={0.1}
          suffix={tr("kg")}
        />
        <label>
          {tr("note")}
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={tr("optional")}
          />
        </label>
        <button
          className="primary"
          disabled={weight === "" || weight <= 0}
          onClick={async () => {
            await api("/body-weight", {
              method: "POST",
              body: JSON.stringify({
                date: new Date().toISOString().slice(0, 10),
                weight,
                notes,
              }),
            });
            setNotes("");
            load();
          }}
        >
          <Plus /> {tr("saveWeight")}
        </button>
      </Card>
    </section>
  );
}
function Admin({ logout }: { logout: () => void }) {
  const [items, setItems] = useState<Exercise[]>();
  const [weekdays, setWeekdays] = useState<number[]>();
  const [daysSaved, setDaysSaved] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [accountSecurity, setAccountSecurity] = useState<{
    googleLinked: boolean;
    hasPasskey: boolean;
  }>();
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState("");
  const [passkeyAdded, setPasskeyAdded] = useState(false);
  const passkeysSupported = typeof window.PublicKeyCredential !== "undefined";
  const load = () => api("/exercises").then(setItems);
  useEffect(() => {
    load();
    api("/settings/program").then((x) => setWeekdays(x.preferredWeekdays));
    if (isGuest())
      api("/dashboard").then((x) => setDisplayName(x.displayName || ""));
    else
      api("/settings/profile").then((x) => {
        setDisplayName(x.displayName || "");
        setAccountSecurity({
          googleLinked: x.googleLinked,
          hasPasskey: x.hasPasskey,
        });
      });
  }, []);
  if (!items) return <Loading />;
  return (
    <section>
      <Header title={tr("settings")} subtitle={tr("programSettings")} />
      
      <Card title={tr("profile")}>
        <label>
          {tr("displayName")}
          <input
            maxLength={80}
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setProfileSaved(false);
              setProfileError("");
            }}
          />
        </label>
        {profileError && <p className="error">{profileError}</p>}
        <button
          className="primary"
          disabled={!displayName.trim()}
          onClick={async () => {
            try {
              const result = await api("/settings/profile", {
                method: "PATCH",
                body: JSON.stringify({ displayName }),
              });
              setDisplayName(result.displayName);
              setProfileSaved(true);
            } catch (error: any) {
              setProfileError(error.message || tr("profileSaveFailed"));
            }
          }}
        >
          {profileSaved ? tr("saved") : tr("saveProfile")}
        </button>
      </Card>

      {accountSecurity?.googleLinked &&
        (!accountSecurity.hasPasskey || passkeyAdded) && (
          <Card title={tr("passkeySettings")}>
            {passkeyAdded ? (
              <p>{tr("passkeyAdded")}</p>
            ) : (
              <>
                <p>{tr("addPasskeyDescription")}</p>
                {passkeyError && <p className="error">{passkeyError}</p>}
                {!passkeysSupported && (
                  <p className="error">{tr("passkeyUnavailable")}</p>
                )}
                <button
                  className="primary"
                  disabled={!passkeysSupported || passkeyBusy}
                  onClick={async () => {
                    setPasskeyError("");
                    setPasskeyBusy(true);
                    try {
                      const ceremony = await api(
                        "/settings/passkeys/register-options",
                        { method: "POST" },
                      );
                      const response = await startRegistration({
                        optionsJSON: ceremony.options,
                      });
                      await api("/settings/passkeys/register-verify", {
                        method: "POST",
                        body: JSON.stringify({
                          ceremonyId: ceremony.ceremonyId,
                          response,
                        }),
                      });
                      setAccountSecurity((current) =>
                        current ? { ...current, hasPasskey: true } : current,
                      );
                      setPasskeyAdded(true);
                    } catch (error: any) {
                      setPasskeyError(
                        error.message || tr("passkeyRegistrationFailed"),
                      );
                    } finally {
                      setPasskeyBusy(false);
                    }
                  }}
                >
                  {tr("addPasskey")}
                </button>
              </>
            )}
          </Card>
        )}

      <Card title={tr("language")}>
        <LanguageSwitcher />
      </Card>
      <Card title={tr("trainingDays")}>
        {weekdays && (
          <>
            <div className="weekday-picker">
              {localizedWeekdays().map((day) => (
                <button
                  type="button"
                  key={day.value}
                  className={weekdays.includes(day.value) ? "selected" : ""}
                  aria-label={day.name}
                  onClick={() => {
                    setDaysSaved(false);
                    setWeekdays((current) =>
                      current!.includes(day.value)
                        ? current!.length === 1
                          ? current
                          : current!.filter((x) => x !== day.value)
                        : [...current!, day.value],
                    );
                  }}
                >
                  {day.abbreviation}
                </button>
              ))}
            </div>
            <button
              className="primary"
              onClick={async () => {
                const result = await api("/settings/program", {
                  method: "PATCH",
                  body: JSON.stringify({ preferredWeekdays: weekdays }),
                });
                setWeekdays(result.preferredWeekdays);
                setDaysSaved(true);
              }}
            >
              {daysSaved ? tr("saved") : tr("saveTrainingDays")}
            </button>
          </>
        )}
      </Card>
      <Card title={tr("account")}>
        <strong>{isGuest() ? tr("guest") : "Google / Kir Fit"}</strong>
        {isGuest() && <span>{tr("dataLocal")}</span>}
        <button className="signout" onClick={logout}>
          {tr("signOut")}
        </button>
      </Card>
      <Header title={tr("exercises")} />
      {items.map((e) => (
        <details className="admin" key={e.id}>
          <summary>
            <ZoomableImage
              src={e.images[0]?.path || "/icon.svg"}
              alt={localizedName(e)}
              compact
            />
            <div>
              <b>{localizedName(e)}</b>
              <span>
                {e.nameEn} / {e.nameDe}
              </span>
            </div>
          </summary>
          <p>{localizedDescription(e)}</p>
          <p>
            <b>{tr("targets")}:</b>{" "}
            {localizedTargets(e.targetMuscles).join(", ")}
          </p>
          <label>
            {tr("note")}
            <textarea
              defaultValue={(e as any).userNotes || ""}
              onBlur={(ev) =>
                api("/exercises/" + e.id, {
                  method: "PATCH",
                  body: JSON.stringify({ userNotes: ev.target.value }),
                })
              }
            />
          </label>
        </details>
      ))}
    </section>
  );
}
function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header>
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="brandmark">
        <Dumbbell />
      </div>
    </header>
  );
}
function Card({
  title,
  children,
  onClick,
}: {
  title: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className="card" onClick={onClick}>
      <p className="eyebrow">{title}</p>
      {children}
    </div>
  );
}
function Loading() {
  return (
    <div className="loading">
      <i />
      <span>{tr("loading")}</span>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <Dumbbell />
      <p>{text}</p>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
