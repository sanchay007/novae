import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  MAX_PROFILE_PHOTOS,
  updatePreferencesSchema,
  updateProfileSchema,
  upsertPromptsSchema,
} from '@novae/shared';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { v4 as uuid } from 'uuid';
import { CurrentUser } from '../common/auth.decorators';
import { DatabaseService } from '../database/database.module';

const uploadDir = join(process.cwd(), 'uploads');
if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

function ageFromBirthDate(birthDate: string | Date | null): number {
  if (!birthDate) return 0;
  const d = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

@Injectable()
export class ProfilesService {
  constructor(private readonly db: DatabaseService) {}

  async getMe(userId: string) {
    const profile = (
      await this.db.query(`SELECT * FROM profiles WHERE user_id = $1`, [userId])
    ).rows[0];
    const preferences = (
      await this.db.query(`SELECT * FROM preferences WHERE user_id = $1`, [userId])
    ).rows[0];
    const photos = (
      await this.db.query(
        `SELECT id, url, sort_order, is_verified_selfie, moderation_status
         FROM photos WHERE user_id = $1 ORDER BY sort_order ASC`,
        [userId],
      )
    ).rows;
    const prompts = (
      await this.db.query(
        `SELECT id, prompt_key, answer, sort_order FROM prompts
         WHERE user_id = $1 ORDER BY sort_order ASC`,
        [userId],
      )
    ).rows;
    const entitlements = (
      await this.db.query(`SELECT * FROM entitlements WHERE user_id = $1`, [userId])
    ).rows[0];
    return {
      profile: profile
        ? { ...profile, age: ageFromBirthDate(profile.birth_date) }
        : null,
      preferences,
      photos,
      prompts,
      entitlements,
    };
  }

  async updateProfile(userId: string, input: Record<string, unknown>) {
    const fields: string[] = [];
    const values: unknown[] = [];
    const map: Record<string, string> = {
      displayName: 'display_name',
      birthDate: 'birth_date',
      bio: 'bio',
      headline: 'headline',
      gender: 'gender',
      orientation: 'orientation',
      intent: 'intent',
      heightCm: 'height_cm',
      city: 'city',
      latitude: 'latitude',
      longitude: 'longitude',
      interests: 'interests',
      dateIdeas: 'date_ideas',
      customDateIdea: 'custom_date_idea',
      paused: 'paused',
    };
    for (const [key, col] of Object.entries(map)) {
      if (input[key] !== undefined) {
        values.push(input[key]);
        fields.push(`${col} = $${values.length}`);
      }
    }
    if (fields.length === 0) return this.getMe(userId);
    values.push(userId);
    await this.db.query(
      `UPDATE profiles SET ${fields.join(', ')}, updated_at = NOW(),
       onboarding_complete = CASE
         WHEN display_name IS NOT NULL AND birth_date IS NOT NULL AND gender IS NOT NULL
         THEN TRUE ELSE onboarding_complete END
       WHERE user_id = $${values.length}`,
      values,
    );
    await this.db.query(
      `UPDATE profiles SET onboarding_complete = (
         display_name IS NOT NULL AND birth_date IS NOT NULL AND gender IS NOT NULL
       ) WHERE user_id = $1`,
      [userId],
    );
    return this.getMe(userId);
  }

  async updatePreferences(userId: string, input: Record<string, unknown>) {
    const map: Record<string, string> = {
      genders: 'genders',
      minAge: 'min_age',
      maxAge: 'max_age',
      maxDistanceKm: 'max_distance_km',
      intents: 'intents',
      dealbreakers: 'dealbreakers',
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, col] of Object.entries(map)) {
      if (input[key] !== undefined) {
        values.push(input[key]);
        fields.push(`${col} = $${values.length}`);
      }
    }
    if (fields.length) {
      values.push(userId);
      await this.db.query(
        `UPDATE preferences SET ${fields.join(', ')}, updated_at = NOW()
         WHERE user_id = $${values.length}`,
        values,
      );
    }
    return this.getMe(userId);
  }

  async upsertPrompts(userId: string, prompts: { promptKey: string; answer: string; sortOrder?: number }[]) {
    await this.db.query(`DELETE FROM prompts WHERE user_id = $1`, [userId]);
    for (let i = 0; i < prompts.length; i++) {
      const p = prompts[i]!;
      await this.db.query(
        `INSERT INTO prompts (user_id, prompt_key, answer, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [userId, p.promptKey, p.answer, p.sortOrder ?? i],
      );
    }
    return this.getMe(userId);
  }

  async addPhoto(userId: string, filename: string) {
    const count = (
      await this.db.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM photos WHERE user_id = $1`,
        [userId],
      )
    ).rows[0]?.c;
    if (Number(count) >= MAX_PROFILE_PHOTOS) {
      throw new BadRequestException(`Max ${MAX_PROFILE_PHOTOS} photos`);
    }
    const url = `/media/${filename}`;
    const sortOrder = Number(count);
    const photo = (
      await this.db.query(
        `INSERT INTO photos (user_id, url, sort_order, moderation_status)
         VALUES ($1, $2, $3, 'approved') RETURNING *`,
        [userId, url, sortOrder],
      )
    ).rows[0];
    return photo;
  }

  async deletePhoto(userId: string, photoId: string) {
    await this.db.query(`DELETE FROM photos WHERE id = $1 AND user_id = $2`, [
      photoId,
      userId,
    ]);
    return { ok: true };
  }

  async submitPhotoVerification(userId: string, filename: string) {
    const url = `/media/${filename}`;
    await this.db.query(
      `INSERT INTO photos (user_id, url, sort_order, is_verified_selfie, moderation_status)
       VALUES ($1, $2, 99, TRUE, 'approved')`,
      [userId, url],
    );
    // MVP: auto-verify after selfie upload (replace with face-match later)
    await this.db.query(
      `UPDATE profiles SET photo_verified = TRUE, updated_at = NOW() WHERE user_id = $1`,
      [userId],
    );
    await this.db.query(
      `INSERT INTO moderation_events (user_id, kind, payload)
       VALUES ($1, 'photo_verification', $2)`,
      [userId, JSON.stringify({ url, auto: true })],
    );
    return { verified: true };
  }

  async getPublicProfile(viewerId: string, targetId: string) {
    const blocked = (
      await this.db.query(
        `SELECT 1 FROM blocks WHERE
         (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)
         LIMIT 1`,
        [viewerId, targetId],
      )
    ).rows[0];
    if (blocked) throw new BadRequestException('Profile unavailable');

    const profile = (
      await this.db.query(`SELECT * FROM profiles WHERE user_id = $1 AND paused = FALSE`, [
        targetId,
      ])
    ).rows[0];
    if (!profile) throw new BadRequestException('Profile not found');
    const photos = (
      await this.db.query(
        `SELECT id, url, sort_order FROM photos
         WHERE user_id = $1 AND is_verified_selfie = FALSE AND moderation_status = 'approved'
         ORDER BY sort_order`,
        [targetId],
      )
    ).rows;
    const prompts = (
      await this.db.query(
        `SELECT id, prompt_key, answer, sort_order FROM prompts
         WHERE user_id = $1 ORDER BY sort_order`,
        [targetId],
      )
    ).rows;
    return {
      userId: targetId,
      displayName: profile.display_name,
      age: ageFromBirthDate(profile.birth_date),
      bio: profile.bio,
      headline: profile.headline,
      gender: profile.gender,
      intent: profile.intent,
      city: profile.city,
      interests: profile.interests ?? [],
      dateIdeas: profile.date_ideas ?? [],
      customDateIdea: profile.custom_date_idea,
      photos: photos.map((ph) => ({
        id: ph.id,
        url: ph.url,
        sortOrder: ph.sort_order,
      })),
      prompts: prompts.map((p) => ({
        id: p.id,
        promptKey: p.prompt_key,
        answer: p.answer,
        sortOrder: p.sort_order,
      })),
      verified: profile.photo_verified,
    };
  }

  async touchActive(userId: string) {
    await this.db.query(
      `UPDATE profiles SET last_active_at = NOW() WHERE user_id = $1`,
      [userId],
    );
  }

  async deleteAccount(userId: string) {
    await this.db.query(`DELETE FROM users WHERE id = $1`, [userId]);
    return { ok: true };
  }

  async exportData(userId: string) {
    const me = await this.getMe(userId);
    const matches = (
      await this.db.query(`SELECT * FROM matches WHERE user_a_id = $1 OR user_b_id = $1`, [
        userId,
      ])
    ).rows;
    return { exportedAt: new Date().toISOString(), ...me, matches };
  }
}

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get('me')
  me(@CurrentUser() user: { userId: string }) {
    return this.profiles.getMe(user.userId);
  }

  @Patch('me')
  async update(
    @CurrentUser() user: { userId: string },
    @Body() body: unknown,
  ) {
    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.profiles.updateProfile(user.userId, parsed.data);
  }

  @Patch('me/preferences')
  async preferences(
    @CurrentUser() user: { userId: string },
    @Body() body: unknown,
  ) {
    const parsed = updatePreferencesSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.profiles.updatePreferences(user.userId, parsed.data);
  }

  @Put('me/prompts')
  async prompts(
    @CurrentUser() user: { userId: string },
    @Body() body: unknown,
  ) {
    const parsed = upsertPromptsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.profiles.upsertPrompts(user.userId, parsed.data.prompts);
  }

  @Post('me/photos')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: uploadDir,
        filename: (_req, file, cb) => {
          cb(null, `${uuid()}${extname(file.originalname) || '.jpg'}`);
        },
      }),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  uploadPhoto(
    @CurrentUser() user: { userId: string },
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('file required');
    return this.profiles.addPhoto(user.userId, file.filename);
  }

  @Delete('me/photos/:photoId')
  deletePhoto(
    @CurrentUser() user: { userId: string },
    @Param('photoId') photoId: string,
  ) {
    return this.profiles.deletePhoto(user.userId, photoId);
  }

  @Post('me/verify-photo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: uploadDir,
        filename: (_req, file, cb) => {
          cb(null, `verify-${uuid()}${extname(file.originalname) || '.jpg'}`);
        },
      }),
    }),
  )
  verify(
    @CurrentUser() user: { userId: string },
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('file required');
    return this.profiles.submitPhotoVerification(user.userId, file.filename);
  }

  @Get('me/export')
  export(@CurrentUser() user: { userId: string }) {
    return this.profiles.exportData(user.userId);
  }

  @Delete('me')
  delete(@CurrentUser() user: { userId: string }) {
    return this.profiles.deleteAccount(user.userId);
  }

  @Get(':userId')
  publicProfile(
    @CurrentUser() user: { userId: string },
    @Param('userId') userId: string,
  ) {
    return this.profiles.getPublicProfile(user.userId, userId);
  }
}

@Module({
  controllers: [ProfilesController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
