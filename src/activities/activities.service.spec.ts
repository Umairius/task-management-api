import { Test, TestingModule } from '@nestjs/testing';
import { ActivitiesService } from './activities.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ActivitiesService', () => {
  let service: ActivitiesService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      activity: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ActivitiesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ActivitiesService);
  });

  it('path param taskId wins over a conflicting query-string taskId', async () => {
    await service.findAll({ taskId: 'query-id' } as any, 'path-id');
    expect(prisma.activity.findMany.mock.calls[0][0].where.taskId).toBe('path-id');
  });

  it('falls back to the query-string taskId when no path param is given', async () => {
    await service.findAll({ taskId: 'query-id' } as any);
    expect(prisma.activity.findMany.mock.calls[0][0].where.taskId).toBe('query-id');
  });

  it('applies userId and action filters', async () => {
    await service.findAll({ userId: 'u1', action: 'UPDATE' } as any);
    expect(prisma.activity.findMany.mock.calls[0][0].where).toMatchObject({
      userId: 'u1', action: 'UPDATE',
    });
  });

  it('builds a createdAt range from createdFrom/createdTo', async () => {
    await service.findAll({ createdFrom: '2026-01-01', createdTo: '2026-02-01' } as any);
    const where = prisma.activity.findMany.mock.calls[0][0].where;
    expect(where.createdAt.gte).toEqual(new Date('2026-01-01'));
    expect(where.createdAt.lte).toEqual(new Date('2026-02-01'));
  });

  it('paginates and returns correct meta', async () => {
    prisma.activity.count.mockResolvedValue(55);
    const result = await service.findAll({ page: 3, perPage: 10 } as any);
    expect(prisma.activity.findMany.mock.calls[0][0].skip).toBe(20);
    expect(result.meta).toEqual({ page: 3, perPage: 10, total: 55, totalPages: 6 });
  });
});