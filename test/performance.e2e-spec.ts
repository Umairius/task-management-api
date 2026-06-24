import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * This is a regression tripwire, not the benchmark. supertest calls go
 * through Nest's in-process HTTP server, skipping real TCP/socket overhead —
 * its absolute numbers aren't comparable to BASELINE.md, which was captured
 * over real HTTP against a running server via scripts/load_test.py. That
 * script (now with --compare-baseline) is the authoritative "did we actually
 * beat the pre-fix numbers" check. This test exists only so `npm test` fails
 * loudly if someone reintroduces the N+1 query or drops pagination, without
 * needing the live server running.
 */
describe('Tasks list performance (regression tripwire)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a single filtered page well under an indexed-query ceiling', async () => {
    const taskCount = await prisma.task.count();
    if (taskCount < 1000) {
      console.warn(
        `Only ${taskCount} tasks seeded — run SEED_COUNT=5000 npm run seed -- --reset ` +
        'for this tripwire to mean anything close to BASELINE.md scale.',
      );
    }

    const start = Date.now();
    await request(app.getHttpServer()).get('/tasks?status=TODO&perPage=20').expect(200);
    const elapsed = Date.now() - start;

    // Deliberately generous — this catches "pagination got removed" or
    // "N+1 came back," not minor variance. Real percentiles live in
    // scripts/load_test.py.
    expect(elapsed).toBeLessThan(300);
  });
});