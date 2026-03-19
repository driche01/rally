import { useQuery } from '@tanstack/react-query';
import { getMyProfile, getProfileById } from '../lib/api/profile';

export const profileKeys = {
  me: () => ['profile', 'me'] as const,
  byId: (userId: string) => ['profile', userId] as const,
};

export function useMyProfile() {
  return useQuery({
    queryKey: profileKeys.me(),
    queryFn: getMyProfile,
  });
}

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: profileKeys.byId(userId ?? ''),
    queryFn: () => getProfileById(userId!),
    enabled: !!userId,
  });
}
