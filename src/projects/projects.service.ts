import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_KEY = 'projects:all';
const CACHE_TTL_MS = 60_000;

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async findAll() {
    const cached = await this.cacheManager.get(CACHE_KEY);
    if (cached) return cached;

    const projects = await this.prisma.project.findMany();
    await this.cacheManager.set(CACHE_KEY, projects, CACHE_TTL_MS);
    return projects;
}
}