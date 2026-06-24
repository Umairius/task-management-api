import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmailService } from '../src/email/email.service';

describe('Failure simulations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let projectId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    projectId = (await prisma.project.findFirst())!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('serializes concurrent updates on one task — no lost or duplicated activity rows', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/tasks').send({ title: 'Race task', projectId }).expect(201);
    const id = createRes.body.id;

    const concurrency = 10;
    const titles = Array.from({ length: concurrency }, (_, i) => `Race task v${i}`);
    const responses = await Promise.all(
      titles.map((title) => request(app.getHttpServer()).put(`/tasks/${id}`).send({ title })),
    );
    responses.forEach((res) => expect(res.status).toBe(200));

    const activities = await request(app.getHttpServer())
      .get(`/tasks/${id}/activities?perPage=50`).expect(200);
    const actions = activities.body.data.map((a: any) => a.action);

    // Exactly one CREATE and exactly `concurrency` UPDATEs proves the row
    // lock worked — without it, two requests could read the same stale
    // "before" state and one update's diff would silently vanish.
    expect(actions.filter((a: string) => a === 'CREATE')).toHaveLength(1);
    expect(actions.filter((a: string) => a === 'UPDATE')).toHaveLength(concurrency);

    const finalTask = await request(app.getHttpServer()).get(`/tasks/${id}`).expect(200);
    expect(titles).toContain(finalTask.body.title);

    await prisma.activity.deleteMany({ where: { taskId: id } });
    await prisma.task.deleteMany({ where: { id } });
  });

  describe('email failure isolation', () => {
    it('does not fail task creation when the email send rejects', async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(EmailService)
        .useValue({ sendTaskAssignmentNotification: jest.fn().mockRejectedValue(new Error('SMTP down')) })
        .compile();

      const isolatedApp = moduleFixture.createNestApplication();
      isolatedApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      await isolatedApp.init();
      const isolatedPrisma = moduleFixture.get(PrismaService);
      const user = await isolatedPrisma.user.findFirst();

      const res = await request(isolatedApp.getHttpServer())
        .post('/tasks')
        .send({ title: 'Rejected-email task', projectId, assigneeId: user!.id })
        .expect(201);

      await isolatedPrisma.activity.deleteMany({ where: { taskId: res.body.id } });
      await isolatedPrisma.task.deleteMany({ where: { id: res.body.id } });
      await isolatedApp.close();
    });
  });

  // Deleted-task activity persistence is already covered as its own
  // assertion in activities.e2e-spec.ts — not duplicated here.

  // --- Everything below depends on Phase 2 (global exception filter,
  // pagination clamp/validate), which hasn't landed yet. These encode the
  // target behavior so they're ready the moment that work exists — remove
  // .skip then. Right now Prisma's P2003/P2025 bubble up as raw 500s, and
  // an unbounded page/perPage either 500s (page=0 → negative skip) or just
  // silently has no ceiling (huge perPage) rather than rejecting cleanly.

  describe.skip('invalid foreign key references (pending global exception filter)', () => {
    it('returns 404, not 500, when projectId does not exist', async () => {
      await request(app.getHttpServer())
        .post('/tasks')
        .send({ title: 'Bad ref', projectId: '00000000-0000-4000-8000-000000000000' })
        .expect(404);
    });

    it('returns 404, not 500, when assigneeId does not exist', async () => {
      await request(app.getHttpServer())
        .post('/tasks')
        .send({ title: 'Bad ref', projectId, assigneeId: '00000000-0000-4000-8000-000000000000' })
        .expect(404);
    });

    // P2002 (unique constraint) isn't directly reachable through any
    // current endpoint — Tag.name is @unique but there's no POST /tags.
    // The filter should still handle it defensively; no test exercises it yet.
  });

  describe.skip('pagination edge cases (pending clamp/validate)', () => {
    it('does not 500 on page=0', async () => {
      const res = await request(app.getHttpServer()).get('/tasks?page=0');
      expect(res.status).not.toBe(500);
    });

    it('clamps an unreasonably large perPage', async () => {
      const res = await request(app.getHttpServer()).get('/tasks?perPage=1000000');
      expect(res.body.meta.perPage).toBeLessThanOrEqual(100);
    });

    it('does not 500 on a negative perPage', async () => {
      const res = await request(app.getHttpServer()).get('/tasks?perPage=-5');
      expect(res.status).not.toBe(500);
    });
  });
});