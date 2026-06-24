import { PrismaClient, TaskStatus, TaskPriority } from '@prisma/client';

const prisma = new PrismaClient();

const SEED_COUNT = parseInt(process.env.SEED_COUNT ?? '100', 10);
const SHOULD_RESET = process.argv.includes('--reset');

if (SHOULD_RESET && process.env.NODE_ENV === 'production') {
  throw new Error('--reset is blocked when NODE_ENV=production');
}

async function main() {
  if (SHOULD_RESET) {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Task", "User", "Project", "Tag" RESTART IDENTITY CASCADE;',
    );
  }

  // Create users
  const users = await Promise.all([
    prisma.user.create({ data: { email: 'john@example.com', name: 'John Doe' } }),
    prisma.user.create({ data: { email: 'jane@example.com', name: 'Jane Smith' } }),
    prisma.user.create({ data: { email: 'bob@example.com', name: 'Bob Johnson' } }),
  ]);

  // Create projects
  const projects = await Promise.all([
    prisma.project.create({ data: { name: 'Backend API' } }),
    prisma.project.create({ data: { name: 'Mobile App' } }),
    prisma.project.create({ data: { name: 'Data Migration' } }),
  ]);

  // Create tags
  const tags = await Promise.all([
    prisma.tag.create({ data: { name: 'bug' } }),
    prisma.tag.create({ data: { name: 'feature' } }),
    prisma.tag.create({ data: { name: 'enhancement' } }),
    prisma.tag.create({ data: { name: 'documentation' } }),
  ]);

  // Create tasks
  const statuses = Object.values(TaskStatus);
  const priorities = Object.values(TaskPriority);

  for (let i = 0; i < SEED_COUNT; i++) {
    await prisma.task.create({
      data: {
        title: `Task ${i + 1}`,
        description: `Description for task ${i + 1}`,
        status: statuses[Math.floor(Math.random() * statuses.length)],
        priority: priorities[Math.floor(Math.random() * priorities.length)],
        projectId: projects[Math.floor(Math.random() * projects.length)].id,
        assigneeId: Math.random() > 0.3 ? users[Math.floor(Math.random() * users.length)].id : null,
        dueDate: Math.random() > 0.5 ? new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000) : null,
        tags: {
          connect: Array(Math.floor(Math.random() * 3))
            .fill(null)
            .map(() => ({ id: tags[Math.floor(Math.random() * tags.length)].id }))
        }
      }
    });
  }

  console.log('Seed data created successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
