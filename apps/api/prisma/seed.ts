import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const exercises = [
  ['leg-press','Leg Press','Beinpresse','Жим ногами','A seated machine with a weighted platform pushed away with both legs.','Keep your back supported, knees tracking over toes, and do not lock the knees.',['Quadriceps','Glutes','Hamstrings'],'machine','compound',3,10,12,120,5],
  ['chest-press','Chest Press','Brustpresse','Жим от груди','A seated machine with handles at chest height that press forward.','Set the seat so handles align with mid-chest. Keep shoulder blades back and lower slowly.',['Chest','Triceps','Front delts'],'machine','compound',3,8,12,120,2.5],
  ['lat-pulldown','Lat Pulldown','Latzug','Тяга верхнего блока','A cable machine with an overhead bar pulled toward the upper chest.','Lean back only slightly, pull elbows down, and avoid swinging.',['Lats','Biceps','Upper back'],'cable','compound',3,8,12,120,2.5],
  ['seated-row','Seated Row','Rudern','Горизонтальная тяга','A seated cable or plate machine whose handles are pulled toward the torso.','Keep the torso stable and pull shoulder blades together without shrugging.',['Mid back','Lats','Biceps'],'cable','compound',3,8,12,120,2.5],
  ['leg-curl','Leg Curl','Beinbeuger','Сгибание ног','A seated or lying machine where the knees bend against a padded lever.','Align knees with the pivot and control the return.',['Hamstrings'],'machine','isolation',2,10,15,90,2.5],
  ['shoulder-press','Shoulder Press','Schulterpresse','Жим на плечи','A seated machine with handles pressed upward from shoulder level.','Keep ribs down and avoid locking the elbows.',['Shoulders','Triceps'],'machine','compound',2,8,12,120,2.5],
  ['triceps-pushdown','Triceps Pushdown','Trizeps am Kabel','Разгибание рук','A cable station where a bar or rope is pushed down by extending the elbows.','Pin elbows beside the torso and move only the forearms.',['Triceps'],'cable','isolation',2,10,15,90,2.5],
  ['biceps-curl','Biceps Curl','Bizeps Curl','Сгибание рук','A machine or cable station used to curl the forearms toward the shoulders.','Keep upper arms still and lower under control.',['Biceps'],'machine','isolation',2,10,15,90,2.5],
] as const;

async function main() {
  const username = process.env.APP_USERNAME || 'kirill';
  const password = process.env.APP_PASSWORD;
  if (!password || password.length < 12) throw new Error('APP_PASSWORD must contain at least 12 characters');
  const user = await prisma.user.upsert({where:{username},update:{},create:{username,passwordHash:await bcrypt.hash(password,12),displayName:'Kirill',heightCm:176,startingWeightKg:new Prisma.Decimal(99)}});
  for (let i=0;i<exercises.length;i++) {
    const [id,nameEn,nameDe,nameRu,description,instructions,targetMuscles,equipmentType,exerciseType,defaultSets,minReps,maxReps,defaultRestSeconds,defaultIncrement]=exercises[i];
    await prisma.exercise.upsert({where:{id},update:{},create:{id,nameEn,nameDe,nameRu,description,instructions,targetMuscles:[...targetMuscles],equipmentType,exerciseType,defaultSets,minReps,maxReps,defaultRestSeconds,defaultIncrement:new Prisma.Decimal(defaultIncrement),images:{create:{path:`/exercise-images/${id}.svg`,caption:`${nameEn} / ${nameDe}`,sortOrder:0,isPrimary:true}}}});
  }
  let program = await prisma.workoutProgram.findFirst({where:{userId:user.id,name:'Full Body 3× weekly'}});
  if (!program) program=await prisma.workoutProgram.create({data:{userId:user.id,name:'Full Body 3× weekly',active:true,preferredWeekdays:[3,5,0]}});
  let template = await prisma.workoutTemplate.findFirst({where:{programId:program.id,name:'Full Body'}});
  if (!template) template=await prisma.workoutTemplate.create({data:{programId:program.id,name:'Full Body'}});
  for (let i=0;i<exercises.length;i++) {
    const [exerciseId,,,,,,,,,sets,minReps,maxReps,rest,inc]=exercises[i];
    await prisma.workoutTemplateExercise.upsert({where:{templateId_exerciseId:{templateId:template.id,exerciseId}},update:{},create:{templateId:template.id,exerciseId,sortOrder:i+1,sets,minReps,maxReps,restSeconds:rest,increment:new Prisma.Decimal(inc)}});
  }
  const date = new Date(); date.setUTCHours(12,0,0,0);
  await prisma.bodyWeightEntry.upsert({where:{userId_date:{userId:user.id,date}},update:{weight:new Prisma.Decimal(94.9)},create:{userId:user.id,date,weight:new Prisma.Decimal(94.9),notes:'Initial entry'}});
}
main().finally(()=>prisma.$disconnect());
