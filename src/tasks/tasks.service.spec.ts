import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TasksService } from './tasks.service';
import { PrismaService } from '../prisma/prisma.service';
import { MOCK_USER } from '../activities/current-user.decorator';

describe('TasksService', () => {
  let service: TasksService;
  let prisma: any;
  let tx: any;
  let eventEmitter: { emit: jest.Mock };

  const baseTask = {
    id: 't1', title: 'Task', description: null, status: 'TODO', priority: 'MEDIUM',
    dueDate: null, createdAt: new Date(), updatedAt: new Date(),
    projectId: 'p1', assigneeId: null, assignee: null,
    project: { id: 'p1', name: 'Project' }, tags: [],
  };

  beforeEach(async () => {
    tx = {
      task: { create: jest.fn(), update: jest.fn(), delete: jest.fn(), findUnique: jest.fn() },
      activity: { create: jest.fn() },
      $queryRaw: jest.fn(),
    };

    prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([baseTask]),
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue(baseTask),
      },
      $transaction: jest.fn((cb) => cb(tx)),
    };

    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(TasksService);
  });

  describe('filtering (buildWhere, via findAll)', () => {
    it('applies status, priority, assigneeId, projectId', async () => {
      await service.findAll({
        status: 'TODO', priority: 'HIGH', assigneeId: 'u1', projectId: 'p1',
      } as any);

      expect(prisma.task.findMany.mock.calls[0][0].where).toMatchObject({
        status: 'TODO', priority: 'HIGH', assigneeId: 'u1', projectId: 'p1',
      });
    });

    it('builds a dueDate range from dueDateFrom/dueDateTo', async () => {
      await service.findAll({ dueDateFrom: '2026-01-01', dueDateTo: '2026-02-01' } as any);

      const where = prisma.task.findMany.mock.calls[0][0].where;
      expect(where.dueDate.gte).toEqual(new Date('2026-01-01'));
      expect(where.dueDate.lte).toEqual(new Date('2026-02-01'));
    });

    it('omits filters that were not provided', async () => {
      await service.findAll({} as any);
      expect(prisma.task.findMany.mock.calls[0][0].where).toEqual({});
    });
  });

  describe('pagination', () => {
    it('computes skip/take and returns correct meta', async () => {
      prisma.task.count.mockResolvedValue(45);

      const result = await service.findAll({ page: 2, perPage: 20 } as any);

      expect(prisma.task.findMany.mock.calls[0][0].skip).toBe(20);
      expect(prisma.task.findMany.mock.calls[0][0].take).toBe(20);
      expect(result.meta).toEqual({ page: 2, perPage: 20, total: 45, totalPages: 3 });
    });

    it('defaults to page 1 / perPage 20', async () => {
      await service.findAll({} as any);
      expect(prisma.task.findMany.mock.calls[0][0].skip).toBe(0);
      expect(prisma.task.findMany.mock.calls[0][0].take).toBe(20);
    });
  });

  describe('create', () => {
    it('writes a CREATE activity with a full diff, inside the transaction', async () => {
      tx.task.create.mockResolvedValue(baseTask);

      await service.create({ title: 'Task', projectId: 'p1' } as any, MOCK_USER);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(tx.activity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: baseTask.id, userId: MOCK_USER.id, userName: MOCK_USER.name, action: 'CREATE',
        }),
      });
      expect(tx.activity.create.mock.calls[0][0].data.changes.title).toEqual({ from: null, to: 'Task' });
    });

    it('emits task.assigned only when the created task has an assignee', async () => {
      tx.task.create.mockResolvedValue({ ...baseTask, assignee: { email: 'a@x.com' } });

      await service.create({ title: 'Task', projectId: 'p1', assigneeId: 'u1' } as any, MOCK_USER);

      expect(eventEmitter.emit).toHaveBeenCalledWith('task.assigned', {
        email: 'a@x.com', taskTitle: 'Task',
      });
    });

    it('does not emit task.assigned without an assignee', async () => {
      tx.task.create.mockResolvedValue(baseTask);
      await service.create({ title: 'Task', projectId: 'p1' } as any, MOCK_USER);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('locks the row before reading pre-update state', async () => {
      tx.task.findUnique.mockResolvedValue(baseTask);
      tx.task.update.mockResolvedValue({ ...baseTask, title: 'Renamed' });

      await service.update('t1', { title: 'Renamed' } as any, MOCK_USER);

      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.task.findUnique.mock.invocationCallOrder[0],
      );
    });

    it('throws NotFoundException inside the transaction when the task is missing', async () => {
      tx.task.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing', { title: 'x' } as any, MOCK_USER),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.task.update).not.toHaveBeenCalled();
    });

    it('writes an UPDATE activity containing only the changed fields', async () => {
      tx.task.findUnique.mockResolvedValue(baseTask);
      tx.task.update.mockResolvedValue({ ...baseTask, title: 'Renamed', status: 'IN_PROGRESS' });

      await service.update('t1', { title: 'Renamed', status: 'IN_PROGRESS' } as any, MOCK_USER);

      const changes = tx.activity.create.mock.calls[0][0].data.changes;
      expect(Object.keys(changes).sort()).toEqual(['status', 'title']);
    });

    it('skips writing an activity row for a no-op update', async () => {
      tx.task.findUnique.mockResolvedValue(baseTask);
      tx.task.update.mockResolvedValue(baseTask);

      await service.update('t1', {} as any, MOCK_USER);

      expect(tx.activity.create).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('locks the row, deletes it, then writes a DELETE activity diffing everything to null', async () => {
      tx.task.findUnique.mockResolvedValue(baseTask);

      await service.remove('t1', MOCK_USER);

      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.task.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
      expect(tx.activity.create.mock.calls[0][0].data.changes.title).toEqual({
        from: baseTask.title, to: null,
      });
    });

    it('throws NotFoundException for a missing task without writing an activity row', async () => {
      tx.task.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing', MOCK_USER)).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.activity.create).not.toHaveBeenCalled();
    });
  });
});