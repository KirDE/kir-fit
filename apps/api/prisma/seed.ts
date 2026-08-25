import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const exercises = [
  [
    "leg-press",
    "Leg Press",
    "Beinpresse",
    "Жим ногами",
    "A seated machine with a weighted platform pushed away with both legs.",
    "Keep your back supported, knees tracking over toes, and do not lock the knees.",
    ["Quadriceps", "Glutes", "Hamstrings"],
    "machine",
    "compound",
    3,
    10,
    12,
    120,
    5,
  ],
  [
    "chest-press",
    "Chest Press",
    "Brustpresse",
    "Жим от груди",
    "A seated machine with handles at chest height that press forward.",
    "Set the seat so handles align with mid-chest. Keep shoulder blades back and lower slowly.",
    ["Chest", "Triceps", "Front delts"],
    "machine",
    "compound",
    3,
    8,
    12,
    120,
    2.5,
  ],
  [
    "lat-pulldown",
    "Lat Pulldown",
    "Latzug",
    "Тяга верхнего блока",
    "A cable machine with an overhead bar pulled toward the upper chest.",
    "Lean back only slightly, pull elbows down, and avoid swinging.",
    ["Lats", "Biceps", "Upper back"],
    "cable",
    "compound",
    3,
    8,
    12,
    120,
    2.5,
  ],
  [
    "seated-row",
    "Seated Row",
    "Rudern",
    "Горизонтальная тяга",
    "A seated cable or plate machine whose handles are pulled toward the torso.",
    "Keep the torso stable and pull shoulder blades together without shrugging.",
    ["Mid back", "Lats", "Biceps"],
    "cable",
    "compound",
    3,
    8,
    12,
    120,
    2.5,
  ],
  [
    "leg-curl",
    "Leg Curl",
    "Beinbeuger",
    "Сгибание ног",
    "A seated or lying machine where the knees bend against a padded lever.",
    "Align knees with the pivot and control the return.",
    ["Hamstrings"],
    "machine",
    "isolation",
    2,
    10,
    15,
    90,
    2.5,
  ],
  [
    "shoulder-press",
    "Shoulder Press",
    "Schulterpresse",
    "Жим на плечи",
    "A seated machine with handles pressed upward from shoulder level.",
    "Keep ribs down and avoid locking the elbows.",
    ["Shoulders", "Triceps"],
    "machine",
    "compound",
    2,
    8,
    12,
    120,
    2.5,
  ],
  [
    "triceps-pushdown",
    "Triceps Pushdown",
    "Trizeps am Kabel",
    "Разгибание рук",
    "A cable station where a bar or rope is pushed down by extending the elbows.",
    "Pin elbows beside the torso and move only the forearms.",
    ["Triceps"],
    "cable",
    "isolation",
    2,
    10,
    15,
    90,
    2.5,
  ],
  [
    "biceps-curl",
    "Biceps Curl",
    "Bizeps Curl",
    "Сгибание рук",
    "A machine or cable station used to curl the forearms toward the shoulders.",
    "Keep upper arms still and lower under control.",
    ["Biceps"],
    "machine",
    "isolation",
    2,
    10,
    15,
    90,
    2.5,
  ],
] as const;
const germanCopy: Record<string, [string, string]> = {
  "leg-press": [
    "Sitzende Maschine mit einer Gewichtsplattform, die mit beiden Beinen weggedrückt wird.",
    "Rücken anlehnen, Knie in Richtung der Zehen führen und nicht vollständig durchstrecken.",
  ],
  "chest-press": [
    "Sitzende Maschine, deren Griffe auf Brusthöhe nach vorne gedrückt werden.",
    "Sitz so einstellen, dass die Griffe auf mittlerer Brusthöhe liegen. Schulterblätter zurückziehen und langsam absenken.",
  ],
  "lat-pulldown": [
    "Kabelzug mit oberer Stange, die zur oberen Brust gezogen wird.",
    "Nur leicht zurücklehnen, Ellbogen nach unten ziehen und nicht schwingen.",
  ],
  "seated-row": [
    "Sitzender Kabelzug oder eine Maschine, deren Griffe zum Oberkörper gezogen werden.",
    "Oberkörper ruhig halten und die Schulterblätter ohne Hochziehen zusammenführen.",
  ],
  "leg-curl": [
    "Sitzende oder liegende Maschine, bei der die Knie gegen eine gepolsterte Rolle gebeugt werden.",
    "Knie am Drehpunkt ausrichten und die Rückbewegung kontrollieren.",
  ],
  "shoulder-press": [
    "Sitzende Maschine, deren Griffe von Schulterhöhe nach oben gedrückt werden.",
    "Rippen unten halten und die Ellbogen nicht vollständig durchstrecken.",
  ],
  "triceps-pushdown": [
    "Kabelstation, an der Stange oder Seil durch Strecken der Ellbogen nach unten gedrückt werden.",
    "Ellbogen am Oberkörper fixieren und nur die Unterarme bewegen.",
  ],
  "biceps-curl": [
    "Maschine oder Kabelstation, an der die Unterarme zu den Schultern gebeugt werden.",
    "Oberarme ruhig halten und das Gewicht kontrolliert absenken.",
  ],
};
const russianCopy: Record<string, [string, string]> = {
  "leg-press": [
    "Сидячий тренажёр с платформой, которую нужно отталкивать обеими ногами.",
    "Прижмите спину к опоре, направляйте колени по линии носков и не разгибайте их до блокировки.",
  ],
  "chest-press": [
    "Сидячий тренажёр, в котором ручки на уровне груди выжимаются вперёд.",
    "Настройте сиденье так, чтобы ручки были на уровне середины груди. Сведите лопатки и опускайте вес медленно.",
  ],
  "lat-pulldown": [
    "Блочный тренажёр с верхней перекладиной, которую тянут к верхней части груди.",
    "Слегка отклонитесь назад, тяните локти вниз и не раскачивайтесь.",
  ],
  "seated-row": [
    "Сидячий блочный или рычажный тренажёр, ручки которого тянут к корпусу.",
    "Держите корпус неподвижно и сводите лопатки, не поднимая плечи.",
  ],
  "leg-curl": [
    "Сидячий или лежачий тренажёр, где ноги сгибаются в коленях против мягкого валика.",
    "Совместите колени с осью вращения и контролируйте обратное движение.",
  ],
  "shoulder-press": [
    "Сидячий тренажёр, в котором ручки выжимаются вверх от уровня плеч.",
    "Не прогибайте поясницу и не блокируйте локти.",
  ],
  "triceps-pushdown": [
    "Блочный тренажёр, где рукоять или канат опускаются вниз разгибанием локтей.",
    "Зафиксируйте локти у корпуса и двигайте только предплечьями.",
  ],
  "biceps-curl": [
    "Тренажёр или блок, в котором предплечья сгибаются по направлению к плечам.",
    "Не двигайте плечами и опускайте вес подконтрольно.",
  ],
};

async function main() {
  const username = process.env.APP_USERNAME || "kirill";
  const password = process.env.APP_PASSWORD;
  if (!password || password.length < 12)
    throw new Error("APP_PASSWORD must contain at least 12 characters");
  const user = await prisma.user.upsert({
    where: { username },
    update: {},
    create: {
      username,
      passwordHash: await bcrypt.hash(password, 12),
      displayName: "Kirill",
    },
  });
  for (let i = 0; i < exercises.length; i++) {
    const [
      id,
      nameEn,
      nameDe,
      nameRu,
      description,
      instructions,
      targetMuscles,
      equipmentType,
      exerciseType,
      defaultSets,
      minReps,
      maxReps,
      defaultRestSeconds,
      defaultIncrement,
    ] = exercises[i];
    const [descriptionDe, instructionsDe] = germanCopy[id];
    const [descriptionRu, instructionsRu] = russianCopy[id];
    const data = {
      nameEn,
      nameDe,
      nameRu,
      description,
      descriptionDe,
      descriptionRu,
      instructions,
      instructionsDe,
      instructionsRu,
      targetMuscles: [...targetMuscles],
      equipmentType,
      exerciseType,
      defaultSets,
      minReps,
      maxReps,
      defaultRestSeconds,
      defaultIncrement: new Prisma.Decimal(defaultIncrement),
    };
    await prisma.exercise.upsert({
      where: { id },
      update: data,
      create: { id, ...data },
    });
    const image = await prisma.exerciseImage.findFirst({
      where: { exerciseId: id, isPrimary: true },
    });
    if (image)
      await prisma.exerciseImage.update({
        where: { id: image.id },
        data: {
          path: `/exercise-images/${id}.webp`,
          caption: `${nameEn} / ${nameDe}`,
        },
      });
    else
      await prisma.exerciseImage.create({
        data: {
          exerciseId: id,
          path: `/exercise-images/${id}.webp`,
          caption: `${nameEn} / ${nameDe}`,
          sortOrder: 0,
          isPrimary: true,
        },
      });
  }
  let program = await prisma.workoutProgram.findFirst({
    where: { userId: user.id, name: "Full Body 3× weekly" },
  });
  if (!program)
    program = await prisma.workoutProgram.create({
      data: {
        userId: user.id,
        name: "Full Body 3× weekly",
        active: true,
        preferredWeekdays: [3, 5, 0],
      },
    });
  let template = await prisma.workoutTemplate.findFirst({
    where: { programId: program.id, name: "Full Body" },
  });
  if (!template)
    template = await prisma.workoutTemplate.create({
      data: { programId: program.id, name: "Full Body" },
    });
  for (let i = 0; i < exercises.length; i++) {
    const [exerciseId, , , , , , , , , sets, minReps, maxReps, rest, inc] =
      exercises[i];
    await prisma.workoutTemplateExercise.upsert({
      where: { templateId_exerciseId: { templateId: template.id, exerciseId } },
      update: {},
      create: {
        templateId: template.id,
        exerciseId,
        sortOrder: i + 1,
        sets,
        minReps,
        maxReps,
        restSeconds: rest,
        increment: new Prisma.Decimal(inc),
      },
    });
  }
  // Remove the former demo value. Real measurements must only be created by
  // the user; deployments and seeds must never invent health data.
  await prisma.bodyWeightEntry.deleteMany({
    where: { userId: user.id, notes: "Initial entry" },
  });
}
main().finally(() => prisma.$disconnect());
