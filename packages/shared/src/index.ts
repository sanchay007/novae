export * from './constants';
export * from './schemas';
export * from './match-rules';

export const PROMPT_CATALOG = [
  { key: 'unusual_habit', label: 'An unusual habit I have is…' },
  { key: 'sunday_ideal', label: 'My ideal Sunday looks like…' },
  { key: 'debate_me', label: 'I will debate you on…' },
  { key: 'green_flag', label: 'A green flag I look for…' },
  { key: 'simple_pleasure', label: 'A simple pleasure I never skip…' },
  { key: 'overrated', label: 'Something overrated is…' },
  { key: 'travel_dream', label: 'Next place I want to explore…' },
  { key: 'friend_describe', label: 'My friends would describe me as…' },
] as const;

export type PublicProfile = {
  userId: string;
  displayName: string;
  age: number;
  bio?: string;
  headline?: string;
  gender?: string;
  intent?: string;
  city?: string;
  interests: string[];
  dateIdeas: string[];
  photos: { id: string; url: string; sortOrder: number; verified?: boolean }[];
  prompts: { id: string; promptKey: string; answer: string; sortOrder: number }[];
  verified: boolean;
};

export type DailySparkView = {
  sparkId: string;
  status: string;
  expiresAt: string;
  whyMatched: string[];
  profile: PublicProfile;
  slotsRemaining: number;
};

export type MatchView = {
  matchId: string;
  status: string;
  whyMatched: string[];
  createdAt: string;
  other: PublicProfile;
  lastMessageAt?: string;
};
