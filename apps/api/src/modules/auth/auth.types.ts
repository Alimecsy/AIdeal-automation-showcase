import type { MembershipRole } from "@aideal/db";

export type AuthContext = {
  clerkUserId: string;
  clerkOrgId: string | null;
  orgRole: string | null;
  orgSlug: string | null;
};

export type CurrentWorkspace = {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  membership: {
    role: MembershipRole;
    status: string;
  };
  user: {
    id: string;
    clerkUserId: string;
    email: string;
    name: string | null;
  };
};
