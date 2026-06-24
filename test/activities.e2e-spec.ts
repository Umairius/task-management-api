import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Tests run in declaration order against one shared task — mirrors the
// manual create→update→delete gate test, just made permanent.
describe('Activities (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let projectId: string;
  let taskId: string;

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
    await prisma.activity.deleteMany({ where: { taskId } });
    await app.close();
  });

  it('logs CREATE, UPDATE, DELETE as separate rows, newest first', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/tasks').send({ title: 'Activity test task', projectId }).expect(201);
    taskId = createRes.body.id;

    await request(app.getHttpServer())
      .put(`/tasks/${taskId}`).send({ title: 'Activity test task (renamed)' }).expect(200);

    await request(app.getHttpServer()).delete(`/tasks/${taskId}`).expect(200);

    const res = await request(app.getHttpServer()).get(`/tasks/${taskId}/activities`).expect(200);

    expect(res.body.data).toHaveLength(3);
    expect(res.body.data.map((a: any) => a.action)).toEqual(['DELETE', 'UPDATE', 'CREATE']);
  });

  it('activity history survives task deletion', async () => {
    await request(app.getHttpServer()).get(`/tasks/${taskId}`).expect(404);
    const res = await request(app.getHttpServer()).get(`/tasks/${taskId}/activities`).expect(200);
    expect(res.body.data.length).toBe(3);
  });

  it('CREATE diffs every set field against null', async () => {
    const res = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activities?action=CREATE`).expect(200);
    expect(res.body.data[0].changes.title).toEqual({ from: null, to: 'Activity test task' });
  });

  it('UPDATE diffs only the changed field', async () => {
    const res = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activities?action=UPDATE`).expect(200);
    expect(Object.keys(res.body.data[0].changes)).toEqual(['title']);
  });

  it('DELETE diffs every field to null', async () => {
    const res = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/activities?action=DELETE`).expect(200);
    expect(res.body.data[0].changes.title.to).toBeNull();
  });

  describe('GET /activities', () => {
    it('filters by taskId the same way the nested route does', async () => {
      const res = await request(app.getHttpServer()).get(`/activities?taskId=${taskId}`).expect(200);
      expect(res.body.data).toHaveLength(3);
    });

    it('paginates with correct meta', async () => {
      const res = await request(app.getHttpServer())
        .get(`/activities?taskId=${taskId}&page=1&perPage=2`).expect(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta).toMatchObject({ page: 1, perPage: 2, total: 3, totalPages: 2 });
    });
  });
});