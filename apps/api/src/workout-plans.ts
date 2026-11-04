import type { Express, Request, RequestHandler, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

const exercisesSchema = z.array(z.object({
  exerciseId: z.string().min(1), sets: z.number().int().min(1).max(20),
  minReps: z.number().int().min(1).max(100), maxReps: z.number().int().min(1).max(100),
  restSeconds: z.number().int().min(30).max(600), increment: z.number().positive().max(100),
  measurementUnit: z.enum(["kg", "units"]).default("kg"),
}).refine((e) => e.minReps <= e.maxReps)).min(1).max(50)
  .refine((items) => new Set(items.map((e) => e.exerciseId)).size === items.length);
const planSchema = z.object({ name: z.string().trim().min(1).max(80), exercises: exercisesSchema });
const assignmentsSchema = z.array(z.object({ weekday: z.number().int().min(0).max(6), templateId: z.string().min(1) }))
  .min(1).max(7).refine((items) => new Set(items.map((day) => day.weekday)).size === items.length);
export const programInclude = {
  dayAssignments: { orderBy: { weekday: "asc" as const } },
  templates: { orderBy: { id: "asc" as const }, include: {
    exercises: { orderBy: { sortOrder: "asc" as const }, include: { exercise: { include: { images: true } } } },
  } },
};
export const serializeProgram = (program: any) => ({
  preferredWeekdays: program.preferredWeekdays,
  assignments: program.dayAssignments,
  templates: program.templates.map((template: any) => ({ ...template, exercises: template.exercises.map((entry: any) => ({ ...entry, increment: Number(entry.increment) })) })),
});

export function registerWorkoutPlanRoutes(app: Express, prisma: PrismaClient, auth: RequestHandler,
  asyncRoute: (fn: (req: Request, res: Response) => Promise<any>) => RequestHandler,
  userId: (req: Request) => string) {
  const programFor = (uid: string) => prisma.workoutProgram.findFirstOrThrow({ where: { userId: uid, active: true }, include: programInclude });
  app.get("/api/settings/program", auth, asyncRoute(async (req, res) => res.json(serializeProgram(await programFor(userId(req))))));
  app.patch("/api/settings/program", auth, asyncRoute(async (req, res) => {
    const body = z.object({
      assignments: assignmentsSchema.optional(),
      preferredWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine((days) => new Set(days).size === days.length).optional(),
    }).refine((value) => !!value.assignments || !!value.preferredWeekdays).parse(req.body);
    const program = await programFor(userId(req));
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "WorkoutProgram" WHERE id = ${program.id} FOR UPDATE`;
      const current = await tx.workoutProgram.findUniqueOrThrow({ where: { id: program.id }, include: programInclude });
      const fallback = current.templates.find((t) => t.name === "Default") || current.templates[0];
      const assignments = body.assignments || body.preferredWeekdays!.map((weekday) => ({ weekday, templateId: current.dayAssignments.find((day) => day.weekday === weekday)?.templateId || fallback?.id }));
      if (!assignments.every((day) => current.templates.some((template) => template.id === day.templateId)))
        throw Object.assign(new Error("Choose a workout from your programme"), { status: 400 });
      await tx.workoutDayAssignment.deleteMany({ where: { programId: program.id } });
      await tx.workoutDayAssignment.createMany({ data: assignments.map((day) => ({ programId: program.id, weekday: day.weekday, templateId: day.templateId! })) });
      return tx.workoutProgram.update({ where: { id: program.id }, data: { preferredWeekdays: assignments.map((day) => day.weekday).sort() }, include: programInclude });
    });
    res.json(serializeProgram(updated));
  }));
  for (const method of ["post", "patch"] as const) app[method](method === "post" ? "/api/settings/workouts" : "/api/settings/workouts/:id", auth, asyncRoute(async (req, res) => {
    const body = planSchema.parse(req.body);
    const program = await programFor(userId(req));
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "WorkoutProgram" WHERE id = ${program.id} FOR UPDATE`;
      const current = method === "patch" ? await tx.workoutTemplate.findFirstOrThrow({ where: { id: String(req.params.id), programId: program.id } }) : null;
      const duplicate = await tx.workoutTemplate.findFirst({ where: { programId: program.id, name: { equals: body.name, mode: "insensitive" }, ...(current ? { id: { not: current.id } } : {}) } });
      if (duplicate) throw Object.assign(new Error("A workout with this name already exists"), { status: 409 });
      const ids = body.exercises.map((entry) => entry.exerciseId);
      if (await tx.exercise.count({ where: { id: { in: ids }, archived: false } }) !== ids.length)
        throw Object.assign(new Error("Unknown or archived equipment"), { status: 400 });
      const template = current
        ? await tx.workoutTemplate.update({ where: { id: current.id }, data: { name: body.name } })
        : await tx.workoutTemplate.create({ data: { programId: program.id, name: body.name } });
      await tx.workoutTemplateExercise.deleteMany({ where: { templateId: template.id, exerciseId: { notIn: ids } } });
      for (let i = 0; i < body.exercises.length; i++) {
        const entry = body.exercises[i]; const data = { ...entry, sortOrder: i + 1 };
        await tx.workoutTemplateExercise.upsert({
          where: { templateId_exerciseId: { templateId: template.id, exerciseId: entry.exerciseId } },
          update: data, create: { templateId: template.id, ...data },
        });
      }
      return tx.workoutProgram.findUniqueOrThrow({ where: { id: program.id }, include: programInclude });
    });
    res.status(method === "post" ? 201 : 200).json(serializeProgram(updated));
  }));
}
