import { z } from 'zod';
import {
  DATE_IDEAS,
  GENDERS,
  ORIENTATIONS,
  RELATIONSHIP_INTENTS,
  REPORT_REASONS,
  SWIPE_ACTIONS,
} from './constants';

export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be E.164 format');

export const requestOtpSchema = z.object({
  phone: phoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6),
});

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(40).optional(),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'birthDate must be YYYY-MM-DD')
    .optional(),
  bio: z.string().max(500).optional(),
  headline: z.string().max(80).optional(),
  gender: z.enum(GENDERS).optional(),
  orientation: z.enum(ORIENTATIONS).optional(),
  intent: z.enum(RELATIONSHIP_INTENTS).optional(),
  heightCm: z.number().int().min(120).max(250).optional(),
  city: z.string().max(80).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  interests: z.array(z.string().max(40)).max(15).optional(),
  dateIdeas: z.array(z.enum(DATE_IDEAS)).max(3).optional(),
  customDateIdea: z.string().max(80).optional(),
  paused: z.boolean().optional(),
});

export const updatePreferencesSchema = z.object({
  genders: z.array(z.enum(GENDERS)).min(1).optional(),
  minAge: z.number().int().min(18).max(100).optional(),
  maxAge: z.number().int().min(18).max(100).optional(),
  maxDistanceKm: z.number().int().min(1).max(500).optional(),
  intents: z.array(z.enum(RELATIONSHIP_INTENTS)).optional(),
  dealbreakers: z.array(z.string().max(60)).max(10).optional(),
});

export const promptSchema = z.object({
  promptKey: z.string().min(1).max(80),
  answer: z.string().min(1).max(300),
  sortOrder: z.number().int().min(0).max(2).optional(),
});

export const upsertPromptsSchema = z.object({
  prompts: z.array(promptSchema).max(3),
});

export const swipeSchema = z.object({
  targetUserId: z.string().uuid(),
  action: z.enum(SWIPE_ACTIONS),
  targetPhotoId: z.string().uuid().optional(),
  targetPromptId: z.string().uuid().optional(),
});

export const sparkDecisionSchema = z.object({
  sparkId: z.string().uuid(),
  accept: z.boolean(),
});

export const sendMessageSchema = z.object({
  matchId: z.string().uuid(),
  body: z.string().min(1).max(2000).optional(),
  imageUrl: z.string().url().optional(),
  voiceUrl: z.string().url().optional(),
  clientMessageId: z.string().max(64).optional(),
}).refine((v) => Boolean(v.body || v.imageUrl || v.voiceUrl), {
  message: 'Message must include body, image, or voice',
});

export const aiSuggestSchema = z.object({
  matchId: z.string().uuid(),
  tone: z.enum(['playful', 'sincere', 'witty', 'direct']).default('sincere'),
});

export const reportSchema = z.object({
  reportedUserId: z.string().uuid(),
  matchId: z.string().uuid().optional(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().max(1000).optional(),
});

export const unmatchSchema = z.object({
  matchId: z.string().uuid(),
  reason: z.string().max(200).optional(),
  anonymousFeedback: z.string().max(500).optional(),
});

export const friendSparkSchema = z.object({
  promptKey: z.string().min(1).max(80),
  answer: z.string().min(1).max(300),
  mediaUrl: z.string().url().optional(),
  mediaType: z.enum(['text', 'photo', 'voice', 'video']).default('text'),
});

export const revenueCatWebhookSchema = z.object({
  api_version: z.string().optional(),
  event: z.record(z.unknown()),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
export type SwipeInput = z.infer<typeof swipeSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type AiSuggestInput = z.infer<typeof aiSuggestSchema>;
