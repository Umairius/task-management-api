import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskFilterDto } from './dto/task-filter.dto';
import { Prisma } from '@prisma/client';
import { diffTask, toDiffable } from '../activities/activity-diff.util';
import { CurrentUserPayload } from '../activities/current-user.decorator';

const TASK_INCLUDE = {
  assignee: true,
  project: true,
  tags: true,
} satisfies Prisma.TaskInclude;

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  private buildWhere(filterDto: TaskFilterDto): Prisma.TaskWhereInput {
    const where: Prisma.TaskWhereInput = {};

    if (filterDto.status) where.status = filterDto.status;
    if (filterDto.priority) where.priority = filterDto.priority;
    if (filterDto.assigneeId) where.assigneeId = filterDto.assigneeId;
    if (filterDto.projectId) where.projectId = filterDto.projectId;

    if (filterDto.dueDateFrom || filterDto.dueDateTo) {
      where.dueDate = {
        ...(filterDto.dueDateFrom && { gte: new Date(filterDto.dueDateFrom) }),
        ...(filterDto.dueDateTo && { lte: new Date(filterDto.dueDateTo) }),
      };
    }

    return where;
  }

  async findAll(filterDto: TaskFilterDto) {
    const page = filterDto.page ?? 1;
    const perPage = filterDto.perPage ?? 20;
    const where = this.buildWhere(filterDto);

    const [data, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        include: TASK_INCLUDE,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.task.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async findOne(id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: TASK_INCLUDE,
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    return task;
  }

  async create(createTaskDto: CreateTaskDto, actor: CurrentUserPayload) {
    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          title: createTaskDto.title,
          description: createTaskDto.description,
          status: createTaskDto.status,
          priority: createTaskDto.priority,
          dueDate: createTaskDto.dueDate,
          project: { connect: { id: createTaskDto.projectId } },
          assignee: createTaskDto.assigneeId
            ? { connect: { id: createTaskDto.assigneeId } }
            : undefined,
          tags: createTaskDto.tagIds
            ? { connect: createTaskDto.tagIds.map(id => ({ id })) }
            : undefined,
        },
        include: TASK_INCLUDE,
      });

      await tx.activity.create({
        data: {
          taskId: created.id,
          taskTitle: created.title,
          userId: actor.id,
          userName: actor.name,
          action: 'CREATE',
          changes: diffTask(null, toDiffable(created)),
        },
      });

      return created;
    });

    if (task.assignee) {
      this.eventEmitter.emit('task.assigned', {
        email: task.assignee.email,
        taskTitle: task.title,
      });
    }

    return task;
  }

  async update(id: string, updateTaskDto: UpdateTaskDto, actor: CurrentUserPayload) {
    const { before, after } = await this.prisma.$transaction(async (tx) => {
      // Lock the row first so a concurrent update can't read the same
      // "before" state we're about to read — without this, two updates
      // racing each other could both diff against the same stale row.
      await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${id} FOR UPDATE`;

      const before = await tx.task.findUnique({
        where: { id },
        include: TASK_INCLUDE,
      });

      if (!before) {
        throw new NotFoundException(`Task with ID ${id} not found`);
      }

      const after = await tx.task.update({
        where: { id },
        data: {
          title: updateTaskDto.title,
          description: updateTaskDto.description,
          status: updateTaskDto.status,
          priority: updateTaskDto.priority,
          dueDate: updateTaskDto.dueDate,
          assignee: updateTaskDto.assigneeId !== undefined
            ? updateTaskDto.assigneeId
              ? { connect: { id: updateTaskDto.assigneeId } }
              : { disconnect: true }
            : undefined,
          tags: updateTaskDto.tagIds
            ? { set: updateTaskDto.tagIds.map(id => ({ id })) }
            : undefined,
        },
        include: TASK_INCLUDE,
      });

      const changes = diffTask(toDiffable(before), toDiffable(after));

      if (Object.keys(changes).length > 0) {
        await tx.activity.create({
          data: {
            taskId: after.id,
            taskTitle: after.title,
            userId: actor.id,
            userName: actor.name,
            action: 'UPDATE',
            changes,
          },
        });
      }

      return { before, after };
    });

    if (updateTaskDto.assigneeId && updateTaskDto.assigneeId !== before.assigneeId) {
      this.eventEmitter.emit('task.assigned', {
        email: after.assignee!.email,
        taskTitle: after.title,
      });
    }

    return after;
  }

  async remove(id: string, actor: CurrentUserPayload) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${id} FOR UPDATE`;

      const existing = await tx.task.findUnique({
        where: { id },
        include: TASK_INCLUDE,
      });

      if (!existing) {
        throw new NotFoundException(`Task with ID ${id} not found`);
      }

      await tx.task.delete({ where: { id } });

      await tx.activity.create({
        data: {
          taskId: existing.id,
          taskTitle: existing.title,
          userId: actor.id,
          userName: actor.name,
          action: 'DELETE',
          changes: diffTask(toDiffable(existing), null),
        },
      });
    });

    return { message: 'Task deleted successfully' };
  }
}