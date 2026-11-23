
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import pool from "@/lib/db";
import { verifyToken } from "@/lib/auth";

function unauthorizedResponse() {
  const response = NextResponse.json(
    {
      success: false,
      message: "Authentication required",
    },
    { status: 401 }
  );

  response.cookies.set({
    name: "medisphere_token",
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}

export async function GET() {
  try {
    // Read authentication cookie
    const cookieStore = await cookies();
    const token = cookieStore.get("medisphere_token")?.value;

    if (!token) {
      return NextResponse.json(
        {
          success: false,
          message: "Please login first",
        },
        { status: 401 }
      );
    }

    // Verify JWT token
    let decoded;

    try {
      decoded = verifyToken(token);
    } catch {
      return unauthorizedResponse();
    }

    if (
      typeof decoded === "string" ||
      typeof decoded.userId !== "string"
    ) {
      return unauthorizedResponse();
    }

    // Get current user information from database
    const result = await pool.query(
      `SELECT
        id,
        full_name,
        email,
        role,
        phone,
        avatar_url,
        is_email_verified,
        created_at
       FROM users
       WHERE id = $1 AND is_active = TRUE
       LIMIT 1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return unauthorizedResponse();
    }

    const user = result.rows[0];

    return NextResponse.json({
      success: true,
      message: "User information retrieved successfully",
      user,
    });
  } catch (error) {
    // Let Next.js handle its internal prerendering errors
    unstable_rethrow(error);

    console.error("Get current user error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to retrieve user information",
      },
      { status: 503 }
    );
  }
}
