import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('TasksController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let projectId: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    const project = await prisma.project.findFirst();
    projectId = project!.id;
  });

  afterEach(async () => {
    await app.close();
  });

  it('/tasks', async () => {
    const response = await request(app.getHttpServer()).get('/tasks').expect(200);

    expect(response.body).toHaveProperty('data');
    expect(response.body).toHaveProperty('meta');
    expect(response.body.data.length).toBeGreaterThan(0);
    response.body.data.forEach((task: any) => {
      expect(task).toHaveProperty('assignee');
      expect(task).toHaveProperty('project');
      expect(task).toHaveProperty('tags');
    });
    expect(response.body.meta).toMatchObject({ page: 1, perPage: 20 });
  });

  describe('pagination and filters', () => {
    it('respects page/perPage and pages do not overlap', async () => {
      const page1 = await request(app.getHttpServer()).get('/tasks?page=1&perPage=5').expect(200);
      const page2 = await request(app.getHttpServer()).get('/tasks?page=2&perPage=5').expect(200);

      expect(page1.body.data).toHaveLength(5);
      const ids1 = page1.body.data.map((t: any) => t.id);
      const ids2 = page2.body.data.map((t: any) => t.id);
      expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);
    });

    it('filters by status', async () => {
      const res = await request(app.getHttpServer()).get('/tasks?status=TODO&perPage=50').expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      res.body.data.forEach((t: any) => expect(t.status).toBe('TODO'));
    });

    it('combines status and projectId filters', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tasks?status=TODO&projectId=${projectId}&perPage=50`)
        .expect(200);
      res.body.data.forEach((t: any) => {
        expect(t.status).toBe('TODO');
        expect(t.projectId).toBe(projectId);
      });
    });
  });

  describe('CRUD lifecycle', () => {
    let taskId: string | undefined;

    afterEach(async () => {
      if (taskId) {
        await prisma.activity.deleteMany({ where: { taskId } });
        await prisma.task.deleteMany({ where: { id: taskId } });
        taskId = undefined;
      }
    });

    it('creates, reads, updates, and deletes a task', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/tasks').send({ title: 'E2E task', projectId }).expect(201);
      taskId = createRes.body.id;
      expect(createRes.body.status).toBe('TODO');

      await request(app.getHttpServer()).get(`/tasks/${taskId}`).expect(200);

      const updateRes = await request(app.getHttpServer())
        .put(`/tasks/${taskId}`)
        .send({ title: 'E2E task (renamed)', status: 'IN_PROGRESS' })
        .expect(200);
      expect(updateRes.body.status).toBe('IN_PROGRESS');

      await request(app.getHttpServer()).delete(`/tasks/${taskId}`).expect(200);
      await request(app.getHttpServer()).get(`/tasks/${taskId}`).expect(404);
    });

    it('does not block on email — responds well under the simulated 2s send delay', async () => {
      const user = await prisma.user.findFirst();
      const start = Date.now();
      const createRes = await request(app.getHttpServer())
        .post('/tasks')
        .send({ title: 'E2E assigned task', projectId, assigneeId: user!.id })
        .expect(201);
      taskId = createRes.body.id;
      expect(Date.now() - start).toBeLessThan(1000);
    });
  });
});