import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { ActivityFilterDto } from './dto/activity-filter.dto';

@Injectable()
export class ActivitiesService {
  constructor(private prisma: PrismaService) {}

  private buildWhere(filterDto: ActivityFilterDto, taskId?: string): Prisma.ActivityWhereInput {
    const where: Prisma.ActivityWhereInput = {};

    if (taskId) where.taskId = taskId;
    else if (filterDto.taskId) where.taskId = filterDto.taskId;

    if (filterDto.userId) where.userId = filterDto.userId;
    if (filterDto.action) where.action = filterDto.action;

    if (filterDto.createdFrom || filterDto.createdTo) {
      where.createdAt = {
        ...(filterDto.createdFrom && { gte: new Date(filterDto.createdFrom) }),
        ...(filterDto.createdTo && { lte: new Date(filterDto.createdTo) }),
      };
    }

    return where;
  }

  async findAll(filterDto: ActivityFilterDto, taskId?: string) {
    const page = filterDto.page ?? 1;
    const perPage = filterDto.perPage ?? 20;
    const where = this.buildWhere(filterDto, taskId);

    const [data, total] = await Promise.all([
      this.prisma.activity.findMany({
        where,
        skip: (page - 1) * perPage,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.activity.count({ where }),
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
}