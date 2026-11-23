
import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth";

export type AuthenticatedUser = {
  userId: string;
  email: string;
  role: string;
};

export function getAuthenticatedUser(
  request: NextRequest
): AuthenticatedUser | null {
  try {
    const token = request.cookies.get("medisphere_token")?.value;

    if (!token) return null;

    const decoded = verifyToken(token);

    if (
      typeof decoded === "string" ||
      typeof decoded.userId !== "string" ||
      typeof decoded.email !== "string" ||
      typeof decoded.role !== "string"
    ) {
      return null;
    }

    return {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    };
  } catch {
    return null;
  }
}
