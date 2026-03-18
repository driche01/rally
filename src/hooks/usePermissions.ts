/**
 * usePermissions — returns what the current authenticated user can do for a trip.
 *
 * The trip creator (trips.created_by === auth user id) is always a planner with
 * full permissions. Future: respondents with is_planner = true will also receive
 * planner permissions when a member-facing app is built.
 *
 * All flags are derived synchronously from cached data — no extra network request.
 */
import { useAuthStore } from '../stores/authStore';
import { useTrip } from './useTrips';

export interface TripPermissions {
  /** True when the current user is a planner (owner or designated co-planner). */
  isPlanner: boolean;
  /** Can edit trip name, dates, destination, group size. */
  canEditTrip: boolean;
  /** Can create, edit, delete, and decide polls. */
  canManagePolls: boolean;
  /** Can add, edit, and delete itinerary blocks. */
  canManageItinerary: boolean;
  /** Can add, edit, and delete lodging options. */
  canManageLodging: boolean;
  /** Can add, edit, and delete travel legs. */
  canManageTravel: boolean;
  /** Can add, edit, and delete expenses. */
  canManageExpenses: boolean;
  /** Can promote or demote group members to/from planner status. */
  canDesignatePlanners: boolean;
  /** Can reorder dashboard entry cards. */
  canReorderCards: boolean;
}

export function usePermissions(tripId: string): TripPermissions {
  const user = useAuthStore((s) => s.user);
  const { data: trip } = useTrip(tripId);

  // The authenticated user is a planner if they created the trip.
  // (trip may be undefined while loading — default to false so UI doesn't flash edit controls)
  const isPlanner = Boolean(user && trip && user.id === trip.created_by);

  return {
    isPlanner,
    canEditTrip: isPlanner,
    canManagePolls: isPlanner,
    canManageItinerary: isPlanner,
    canManageLodging: isPlanner,
    canManageTravel: isPlanner,
    canManageExpenses: isPlanner,
    canDesignatePlanners: isPlanner,
    canReorderCards: isPlanner,
  };
}
