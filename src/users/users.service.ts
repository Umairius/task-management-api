
import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_KEY = 'users:all';
const CACHE_TTL_MS = 60_000;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async findAll() {
    const cached = await this.cacheManager.get(CACHE_KEY);
    if (cached) return cached;

    const users = await this.prisma.user.findMany();
    await this.cacheManager.set(CACHE_KEY, users, CACHE_TTL_MS);
    return users;
  }
}