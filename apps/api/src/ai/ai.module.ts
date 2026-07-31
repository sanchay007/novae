import {
  BadRequestException,
  Body,
  Controller,
  Injectable,
  Module,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FREE_AI_SUGGESTIONS_PER_DAY,
  aiSuggestSchema,
} from '@novae/shared';
import { CurrentUser } from '../common/auth.decorators';
import { DatabaseService } from '../database/database.module';
import { ChatService } from '../chat/chat.module';
import { ProfilesService } from '../profiles/profiles.module';
import { ChatModule } from '../chat/chat.module';
import { ProfilesModule } from '../profiles/profiles.module';

@Injectable()
export class AiService {
  constructor(
    private readonly db: DatabaseService,
    private readonly chat: ChatService,
    private readonly profiles: ProfilesService,
    private readonly config: ConfigService,
  ) {}

  private async usageToday(userId: string) {
    const { rows } = await this.db.query<{ suggestions_count: number }>(
      `INSERT INTO ai_usage (user_id, usage_date, suggestions_count)
       VALUES ($1, CURRENT_DATE, 0)
       ON CONFLICT (user_id, usage_date) DO UPDATE SET suggestions_count = ai_usage.suggestions_count
       RETURNING suggestions_count`,
      [userId],
    );
    return rows[0]?.suggestions_count ?? 0;
  }

  private async bumpUsage(userId: string) {
    await this.db.query(
      `INSERT INTO ai_usage (user_id, usage_date, suggestions_count)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (user_id, usage_date)
       DO UPDATE SET suggestions_count = ai_usage.suggestions_count + 1`,
      [userId],
    );
  }

  async suggest(userId: string, matchId: string, tone: string) {
    const match = await this.chat.assertMember(matchId, userId);
    const ent = (
      await this.db.query(`SELECT * FROM entitlements WHERE user_id = $1`, [userId])
    ).rows[0];
    const used = await this.usageToday(userId);
    const limit = Number(
      this.config.get('FREE_AI_SUGGESTIONS_PER_DAY', FREE_AI_SUGGESTIONS_PER_DAY),
    );
    if (!ent?.unlimited_ai && used >= limit) {
      throw new BadRequestException('Daily AI suggestion limit reached — upgrade for more');
    }

    const otherId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;
    const other = await this.profiles.getPublicProfile(userId, otherId);
    const me = await this.profiles.getMe(userId);
    const { messages } = await this.chat.listMessages(matchId, userId, undefined, 12);

    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    let suggestions: string[];

    if (!apiKey) {
      suggestions = this.mockSuggestions(other, messages, tone);
    } else {
      suggestions = await this.llmSuggestions(
        other,
        { profile: me.profile as { display_name?: string } | null },
        messages as { body?: string | null; sender_id: string }[],
        tone,
        apiKey,
      );
    }

    await this.bumpUsage(userId);
    return {
      suggestions,
      note: 'AI drafted — you edit before sending',
      trainOnChats: this.config.get('AI_TRAIN_ON_CHATS') === 'true',
    };
  }

  private mockSuggestions(
    other: { displayName: string; headline?: string; prompts: { answer: string }[]; interests: string[] },
    messages: { body?: string | null; sender_id?: string }[],
    tone: string,
  ): string[] {
    const interest = other.interests[0] ?? 'weekend plans';
    const promptBit = other.prompts[0]?.answer?.slice(0, 60);
    const last = [...messages].reverse().find((m) => m.body)?.body;
    if (!last) {
      return [
        `Hey ${other.displayName} — your headline caught me. What's a good first spark for us?`,
        promptBit
          ? `I smiled at your prompt about "${promptBit}". Tell me more?`
          : `Coffee or a walk — which fits your vibe better?`,
        `You into ${interest}? I've been looking for someone to geek out with.`,
      ];
    }
    const tonePrefix =
      tone === 'playful'
        ? 'Okay hear me out —'
        : tone === 'witty'
          ? 'Plot twist:'
          : tone === 'direct'
            ? 'Straight up:'
            : '';
    return [
      `${tonePrefix} that makes sense — how did that start for you?`.trim(),
      `Love that. Want to continue this over ${other.interests[0] ? 'that shared interest' : 'coffee'} sometime?`,
      `Curious — what's your take on a low-key first meet this week?`,
    ];
  }

  private async llmSuggestions(
    other: {
      displayName: string;
      bio?: string;
      headline?: string;
      prompts: { promptKey: string; answer: string }[];
      interests: string[];
    },
    me: { profile: { display_name?: string; displayName?: string } | null },
    messages: { body?: string | null; sender_id: string }[],
    tone: string,
    apiKey: string,
  ): Promise<string[]> {
    const transcript = messages
      .map((m) => `${m.sender_id}: ${m.body ?? '[media]'}`)
      .join('\n');
    const system = `You help a dater draft chat replies. Return JSON {"suggestions":["...","...","..."]}.
Tone: ${tone}. Never claim to be AI in the message. Keep each under 180 chars. Do not invent facts.
User chats must not be stored for training unless explicitly allowed.`;
    const myName =
      me.profile?.display_name ?? me.profile?.displayName ?? 'User';
    const user = `Me: ${myName}
Them: ${other.displayName}
Headline: ${other.headline ?? ''}
Bio: ${other.bio ?? ''}
Interests: ${other.interests.join(', ')}
Prompts: ${other.prompts.map((p) => `${p.promptKey}: ${p.answer}`).join(' | ')}
Recent chat:
${transcript || '(no messages yet — write openers)'}`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.get('AI_MODEL', 'gpt-4o-mini'),
        temperature: 0.8,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) {
      return this.mockSuggestions(other, messages, tone);
    }
    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    try {
      const parsed = JSON.parse(data.choices[0]?.message?.content ?? '{}') as {
        suggestions?: string[];
      };
      if (parsed.suggestions?.length) return parsed.suggestions.slice(0, 3);
    } catch {
      // fall through
    }
    return this.mockSuggestions(other, messages, tone);
  }

  async embedText(text: string): Promise<number[] | null> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      // deterministic pseudo-embedding for local/dev
      const vec = new Array(64).fill(0).map((_, i) => {
        let h = 0;
        for (let c = 0; c < text.length; c++) {
          h = (h * 31 + text.charCodeAt(c) * (i + 1)) % 1000;
        }
        return (h / 1000) * 2 - 1;
      });
      return vec;
    }
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.get('EMBEDDING_MODEL', 'text-embedding-3-small'),
        input: text.slice(0, 8000),
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    return data.data[0]?.embedding ?? null;
  }
}

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('suggest')
  async suggest(
    @CurrentUser() user: { userId: string },
    @Body() body: unknown,
  ) {
    const parsed = aiSuggestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.ai.suggest(user.userId, parsed.data.matchId, parsed.data.tone);
  }
}

@Module({
  imports: [ChatModule, ProfilesModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
